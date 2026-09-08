/**
 * Worker background da Ana (ate 15 min). Desde o SDR de IA (set/2026) ela NAO e mais uma
 * maquina de estados: o turno inteiro e decidido por um agente (Claude + 7 ferramentas).
 * Fluxo por mensagem recebida: parse -> guard incoming-only -> config -> PLANTAO (so fora
 * da grade do SDR humano) -> contato/telefone/lead -> filtros (teste, gatilho, encerrado,
 * pausa, humano) -> texto (audio via STT / imagem em base64) -> historico do espelho +
 * situacao (gatilho) -> agente com ferramentas -> falar() -> telemetria (sdr_ia_turnos).
 * NUNCA derruba sem log; sempre responde 200.
 *
 * Falar ao lead so via falar() (campo do lead + Salesbot). Sem resposta do agente (recusa,
 * max_iter, erro de API) o lead recebe a mensagem de transicao e o caso vai p/ humano.
 * Invocado exclusivamente pelo despachante kommo-agenda-webhook.mjs, que posta
 * { contentType, raw } (raw = corpo original do Kommo: form-encoded OU json).
 */
import { getConfig, db, findTesterByPhone, getConversation, upsertConversation, logMessage, logAdvbox, hashKey } from './_lib/botDb.mjs';
import { getContact, extractPhones, kommoGet, setLeadField, postNote, runSalesbot } from './_lib/kommo.mjs';
import { estadoInicial } from './_lib/agendaEngine.mjs';
import { transcrever } from './_lib/agendaInterprete.mjs';
import { gradeDeConfig, foraDoHorario, proximoInicioExpediente } from './_lib/sdrHorario.mjs';
import { situacaoDoLead } from './_lib/sdrGatilhos.mjs';
import { FERRAMENTAS, montarSystem, montarMensagens, contextoDoTurno } from './_lib/sdrPrompt.mjs';
import { criarCliente, rodarAgente, custoUsd } from './_lib/sdrAgente.mjs';
import { criarExecutor } from './_lib/sdrFerramentas.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const TIPOS_AUDIO = ['voice', 'audio', 'ptt'];
// (pós-review Opus #3) etapas terminais do funil (ganho/perdido) — presentes em TODO
// pipeline do Kommo. Um gatilho "todas" não deve reativar a Ana num lead já encerrado.
export const ETAPAS_TERMINAIS = [142, 143];

// ===================== PURAS (testadas em agendaWorker.test.js) =====================

/**
 * Parse do payload do Kommo (form-encoded OU json), + campos de anexo. Defensivo:
 * o formato EXATO das chaves de attachment do Kommo so sera confirmado no piloto
 * (Task 15) — por isso tentamos varias grafias plausiveis. O raw vai p/ o log em erro.
 */
export function parsePayload(contentType, raw) {
  try {
    if ((contentType || '').includes('json')) {
      const j = JSON.parse(raw);
      const m = j?.message?.add?.[0] || j?.payload?.message?.add?.[0] || j?.message || {};
      const att = m.attachment || m.attach || {};
      return {
        text: m.text || '',
        contactId: m.contact_id || m.contactId || null,
        type: m.type || m.origin || '',
        msgId: m.chat_message_id || m.id || m.message_id || null,
        anexoLink: att.link || att.url || att.file_link || null,
        anexoTipo: att.type || att.file_type || null,
      };
    }
  } catch { /* corpo nao-json: cai no form-encoded */ }
  const params = new URLSearchParams(raw || '');
  const base = 'message[add][0]';
  const pick = (...keys) => { for (const k of keys) { const v = params.get(k); if (v) return v; } return ''; };
  return {
    text: pick(`${base}[text]`, 'unsorted[add][0][source_data][text]'),
    contactId: pick(`${base}[contact_id]`, `${base}[element_id]`) || null,
    type: pick(`${base}[type]`, `${base}[origin]`),
    msgId: pick(`${base}[chat_message_id]`, `${base}[id]`, `${base}[message_id]`) || null,
    anexoLink: pick(`${base}[attachment][link]`, `${base}[attachment][url]`, `${base}[attachment[link]]`) || null,
    anexoTipo: pick(`${base}[attachment][type]`, `${base}[attachment[type]]`) || null,
  };
}

/**
 * (seguranca — backlog Task 5) So baixamos anexo de host confiavel: URL https cujo
 * hostname contenha kommo, amocrm ou amazonaws (CDN de midia do Kommo/amoCRM).
 * Qualquer outra coisa NAO e baixada (evita SSRF via link forjado no webhook).
 */
export function anexoPermitido(link) {
  try {
    const u = new URL(String(link || ''));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ['kommo', 'amocrm', 'amazonaws'].some((h) => host.includes(h));
  } catch { return false; }
}

/** Teto de bytes p/ o pre-cheque HEAD do audio: cfg.stt.max_minutos * 1e6 (fallback 5MB). */
export function tetoBytes(cfg) {
  const min = Number(cfg?.stt?.max_minutos);
  return Number.isFinite(min) && min > 0 ? min * 1_000_000 : 5_000_000;
}

/**
 * true se o Content-Length exceder o teto. Content-Length ausente/invalido => false
 * (prossegue: o teto de 25MB dentro de transcrever() segura). NUNCA bloqueia por duvida.
 */
export function excedeTeto(contentLength, cfg) {
  const n = Number(contentLength);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n > tetoBytes(cfg);
}

/**
 * (pós-review Opus #3 + SDR de IA) Um gatilho bate no lead se o pipeline casar E (a)
 * status_ids for uma lista explícita que contenha o status atual (literal, como sempre
 * foi) OU (b) for 'todas' — ou estiver AUSENTE, que é a forma da config do SDR de IA
 * (`[{ pipeline_id }, { pipeline_id, desde_inicio }]`) — E o lead NÃO estiver numa etapa
 * terminal (ganho/perdido): nem 'todas' nem gatilho sem etapa devem reabrir a Ana num
 * lead já encerrado. Quem decide as demais etapas de saída é situacaoDoLead.
 */
export function gatilhoAtende(gatilho, lead) {
  if (!gatilho || !lead || Number(lead.pipeline_id) !== Number(gatilho.pipeline_id)) return false;
  if (Array.isArray(gatilho.status_ids)) return gatilho.status_ids.includes(lead.status_id);
  if (gatilho.status_ids == null || gatilho.status_ids === 'todas') return !ETAPAS_TERMINAIS.includes(lead.status_id);
  return false;
}

/** (defensivo — formato exato do campo de texto do evento Kommo só confirmado no piloto,
 * mesma cautela do parsePayload p/ attachment) tenta grafias plausíveis do texto de um
 * evento outgoing_chat_message; nenhuma bate => string vazia (o match cai só no Δt). */
function textoEventoKommo(ev) {
  return String(ev?.text ?? ev?.value_after?.[0]?.value ?? ev?.value_after?.[0]?.text ?? '').trim();
}

/**
 * (pós-review Opus #2) Decisão PURA: dado os últimos eventos Kommo outgoing_chat_message
 * do CONTATO e as últimas bot_messages direction='out' da conversa, diz se algum desses
 * eventos foi um humano falando (não a Ana). Um evento é "da Ana" se casar com alguma
 * bot_message por proximidade de tempo (|Δt| <= tolMs) OU por texto idêntico (ambos
 * trim). Evento sem par em NENHUMA bot_message => humano. Lista de bot_messages vazia =>
 * nenhum evento tem par => qualquer evento outgoing conta como humano.
 */
export function ehEventoHumano(eventos, mensagensAnaOut, tolMs = 120000) {
  const msgs = mensagensAnaOut || [];
  return (eventos || []).some((ev) => {
    const evMs = Number(ev?.created_at) * 1000;
    const evTxt = textoEventoKommo(ev);
    const casouComAna = msgs.some((m) => {
      const mMs = new Date(m.created_at).getTime();
      if (Number.isFinite(evMs) && Number.isFinite(mMs) && Math.abs(mMs - evMs) <= tolMs) return true;
      return !!evTxt && evTxt === String(m.text ?? '').trim();
    });
    return !casouComAna;
  });
}

/**
 * (revisao final C2) Recorta os eventos outgoing do Kommo para a janela que interessa: so o
 * que veio DEPOIS da ultima fala da Ana (com `tolMs` de folga p/ relogios distintos). Sem
 * este recorte, um evento ANTIGO sem par nas 10 ultimas bot_messages (a propria Ana num turno
 * anterior, ou um humano de dias atras) fazia ehEventoHumano devolver true para sempre, e a
 * Ana ficava pausada em toda conversa com historico. Referencia invalida/ausente => devolve
 * tudo (o fail-open de humanoAssumiu decide depois); evento sem created_at => descartado,
 * porque nao da p/ situa-lo no tempo.
 */
export function eventosDepoisDe(eventos, isoRef, tolMs = 120000) {
  const ref = Date.parse(isoRef);
  if (!Number.isFinite(ref)) return eventos || [];
  return (eventos || []).filter((ev) => {
    const ms = Number(ev?.created_at) * 1000;
    return Number.isFinite(ms) && ms > 0 && ms > ref - tolMs;
  });
}

/**
 * (pós-review Opus #5) Chave composta p/ dedupe quando o Kommo NÃO manda msgId no
 * payload — nunca fica sem dedupe. Bucket por minuto + hash do início do texto (mesmo
 * princípio do fallback do bot ADVBOX, mas namespaced 'agenda:' p/ não colidir com ele
 * na mesma tabela bot_processed_messages).
 */
export function chaveDedupeFallback(contactId, texto, agoraMs = Date.now()) {
  const minuto = Math.floor(agoraMs / 60000);
  return `agenda:c:${contactId}:${minuto}:${hashKey(String(texto || '').slice(0, 80))}`;
}

// ===================== PURAS (SDR de IA) =====================
/** Ids dos leads do contato, do mais recente (maior id) para o mais antigo. */
export function leadIdsDoContato(contato) {
  const leads = contato?._embedded?.leads || [];
  return leads.map((l) => Number(l.id)).filter((n) => Number.isFinite(n)).sort((a, b) => b - a);
}


/** Ultima fala do escritorio no espelho (o gatilho por texto le ela). null se nao houver. */
export function ultimaMsgDoEscritorio(historico) {
  for (let i = (historico || []).length - 1; i >= 0; i--) if (historico[i].autor === 'atendente') return historico[i].corpo || null;
  return null;
}

/** Meet ja enviado PELO ESCRITORIO => humano ja assumiu esse lead (silencia gatilho por texto). */
export function temMeetNoHistorico(historico) {
  return (historico || []).some((h) => h.autor === 'atendente' && /meet\.google\.com/i.test(h.corpo || ''));
}

/** O espelho (sync de 2 min) pode ja conter a mensagem que acabou de chegar: tira a duplicata. */
export function filtrarMsgAtual(historico, texto, agora) {
  const t = String(texto || '').trim();
  if (!t) return historico || [];
  return (historico || []).filter((h) => !(h.autor === 'cliente' && String(h.corpo || '').trim() === t && Math.abs(new Date(h.enviada_em) - agora) < 10 * 60000));
}

/** Tipo MIME da imagem do anexo (extensao manda; senao o tipo do Kommo). null = nao e imagem. */
export function tipoAnexoImagem(anexoTipo, link) {
  const l = String(link || '').toLowerCase();
  if (/\.png(\?|$)/.test(l)) return 'image/png';
  if (/\.webp(\?|$)/.test(l)) return 'image/webp';
  if (/\.jpe?g(\?|$)/.test(l) || ['picture', 'image', 'photo'].includes(String(anexoTipo || '').toLowerCase())) return 'image/jpeg';
  return null;
}

// ===================== I/O (orquestracao — validada no piloto) =====================

// dedupe (padrao bot ADVBOX: tabela bot_processed_messages, coluna msg_id text PK —
// confirmado em advbox-bot-worker-background.mjs). Recebe a CHAVE ja pronta e namespaced
// 'agenda:' pelo caller. Com msgId dedupa cedo; SEM msgId (pos-review Opus #5) o fallback
// composto (chaveDedupeFallback) so roda depois de resolver `texto`/STT — se rodasse aqui,
// a chave (contactId+minuto+hash('')) colidiria entre 2 audios distintos no mesmo minuto e
// descartaria uma mensagem real do lead. Nunca fica sem dedupe.
async function jaProcessada(chave) {
  if (!chave) return false;
  try {
    const { error } = await db.from('bot_processed_messages').insert({ msg_id: chave });
    if (!error) return false; // reservou agora => primeira vez
    if (error.code === '23505' || /duplicate key|already exists/i.test(error.message || '')) return true;
    // outro erro (tabela ausente, permissao): best-effort, NAO bloqueia o processamento
    await logAdvbox('agenda', 'aviso', `dedupe best-effort falhou: ${error.message}`.slice(0, 200), { chave });
    return false;
  } catch { return false; }
}

async function leadNoGatilho(leadId, cfg) {
  const lead = await kommoGet(`/leads/${leadId}`);
  if (!lead) return { ok: false };
  for (const g of cfg.gatilhos || []) {
    if (gatilhoAtende(g, lead)) return { ok: true, lead };
  }
  return { ok: false, lead };
}

// humano respondeu manualmente depois da ultima fala da Ana? (spec: eventos outgoing por
// CONTATO, cruzados com bot_messages 'out' da conversa — pos-review Opus #2: a margem cega
// de 90s tratava QUALQUER outgoing recente como "da Ana"; agora so pausa se sobrar um
// evento outgoing sem par nas mensagens que a Ana realmente mandou.)
async function humanoAssumiu(contactId, ultimaFalaAnaISO, convId) {
  if (!contactId || !ultimaFalaAnaISO) return false;
  let eventos;
  try {
    const r = await kommoGet(`/events?filter[type]=outgoing_chat_message&filter[entity]=contact&filter[entity_id][]=${contactId}&limit=5`);
    eventos = r?._embedded?.events || [];
  } catch (e) {
    // fail-open consciente (pos-review Opus #2): falha na events API NAO pausa a Ana —
    // melhor ela falar demais (lead ignora/reclama) do que a mensagem do lead ser
    // descartada por uma falha transitoria de terceiros.
    await logAdvbox('agenda', 'aviso', `humanoAssumiu: events API falhou (segue sem pausar): ${e.message}`.slice(0, 300), { contactId });
    return false;
  }
  // (revisao final C2) so o que veio DEPOIS da ultima fala da Ana; ver eventosDepoisDe.
  eventos = eventosDepoisDe(eventos, ultimaFalaAnaISO);
  if (!eventos.length) return false;
  let mensagensAnaOut = [];
  if (convId) {
    const { data } = await db.from('bot_messages').select('created_at,text')
      .eq('conversation_id', convId).eq('direction', 'out')
      .order('created_at', { ascending: false }).limit(10);
    mensagensAnaOut = data || [];
  }
  return ehEventoHumano(eventos, mensagensAnaOut);
}

async function falar(leadId, mensagem, cfg) {
  await setLeadField(leadId, cfg.kommo.campo_ana_id, mensagem);
  await runSalesbot(cfg.kommo.salesbot_id, leadId, 'leads');
}

// upsertConversation ja retorna a linha (.select().single()); fallback defensivo p/ o id
// via getConversation caso o upsert nao devolva a linha (ajuste obrigatorio #1).
async function convIdDe(channel, fields) {
  const row = await upsertConversation(channel, fields);
  if (row?.id) return row.id;
  const again = await getConversation(channel);
  return again?.id || null;
}

export default async (req) => {
  const t0 = Date.now();
  let raw = '';
  try {
    const body = await req.json();
    raw = body?.raw || '';
    const msg = parsePayload(body?.contentType, raw);
    // (pos-review Opus #4) guard incoming-only — impede a Ana de tratar a propria fala
    // (via Salesbot) ou fala de humano/bot como entrada do lead (evita loop de
    // auto-resposta). Espelha o mesmo guard do advbox-bot-worker-background.mjs.
    if (/out|robot|bot/i.test(msg.type || '')) return new Response('nao-incoming', { status: 200 });
    const cfgAll = await getConfig();
    const cfg = cfgAll.agenda_bot;
    if (!cfg?.ativo) return new Response('inativo', { status: 200 });

    // PLANTAO: a Ana so responde FORA da grade do SDR humano (sdr_config) e em feriado.
    // Dentro do expediente quem atende e a equipe — o worker sai antes de qualquer custo.
    // (revisao final M5) a grade vem por RPC security definer, nao por SELECT com a anon key:
    // a policy `sdr_config_read_anon` abria a linha inteira de config do SDR para qualquer um
    // com a chave publica (que vai no bundle do site). A RPC devolve so os 3 campos da grade.
    const { data: gradeRows, error: sdrErr } = await db.rpc('sdr_ia_grade', { p_chave: RPC_SECRET });
    const sdrCfg = Array.isArray(gradeRows) ? gradeRows[0] : gradeRows;
    if (sdrErr || !sdrCfg) await logAdvbox('agenda', 'aviso', 'grade do SDR indisponivel, usando cfg.regras', { erro: sdrErr?.message || null });
    const grade = gradeDeConfig(sdrCfg, cfg.regras);
    const agora = new Date();
    // Em modo_teste (so testadores respondem) a chave regras.teste_ignora_horario deixa o piloto
    // rodar em horario comercial sem mexer na grade do SDR humano. Fora do teste, nunca.
    const ignoraHorario = !!(cfg.modo_teste && cfg.regras?.teste_ignora_horario);
    if (!ignoraHorario && !foraDoHorario(agora, grade, cfg.regras.feriados || [])) return new Response('horario comercial', { status: 200 });

    if (!msg.contactId) return new Response('sem contato', { status: 200 });
    if (msg.msgId && await jaProcessada(`agenda:${msg.msgId}`)) return new Response('dupe', { status: 200 });

    const contato = await getContact(msg.contactId);
    const phones = extractPhones(contato);
    const fone = (phones[0] || '').replace(/\D/g, '');
    if (!fone) return new Response('sem fone', { status: 200 });

    if (cfg.modo_teste) {
      let tester = null;
      for (const ph of phones) { tester = await findTesterByPhone(ph); if (tester) break; }
      if (!tester) return new Response('nao testador', { status: 200 });
    }

    // Um contato pode ter varios leads (cliente antigo + lead novo). Escolhe o PRIMEIRO lead do
    // contato que cai num pipeline com gatilho (mais recente primeiro), em vez de so o primeiro
    // da lista — senao um contato com lead em Pos Venda nunca seria atendido pela Ana no SDR.
    const leadIds = leadIdsDoContato(contato);
    if (!leadIds.length) return new Response('sem lead', { status: 200 });
    let leadId = null; let g = { ok: false };
    for (const id of leadIds) { const r = await leadNoGatilho(id, cfg); if (r.ok) { leadId = id; g = r; break; } }
    if (!g.ok) return new Response('fora do gatilho', { status: 200 });

    // estado (o mesmo bot_conversations de sempre; origem 'sdr' desde o SDR de IA)
    const channel = `agenda:${fone}`;
    const conv = await getConversation(channel);
    let estado = conv?.context?.lead_id ? conv.context : estadoInicial({ lead_id: leadId, contact_id: Number(msg.contactId), nome: contato?.name || '', origem: 'sdr' });
    // (revisao final C1 — CRITICO) pipeline REAL do lead, renovado a cada turno: e ele, e nao
    // cfg.kommo.pipeline_sdr, que decide se as ferramentas podem mexer na etapa do funil.
    // Leads do piloto (gatilho `desde_inicio` noutro pipeline) nunca entram no funil do SDR.
    estado.pipeline_id = Number.isFinite(Number(g.lead?.pipeline_id)) ? Number(g.lead.pipeline_id) : null;
    if (estado.encerrado) return new Response('encerrado', { status: 200 });
    if (estado.pausada_ate && new Date(estado.pausada_ate) > new Date()) return new Response('pausada', { status: 200 });
    const ultimaFala = conv?.context?.ultima_fala_ana || null;
    if (await humanoAssumiu(msg.contactId, ultimaFala, conv?.id || null)) {
      estado.pausada_ate = new Date(Date.now() + (cfg.regras.silencio_humano_horas || 24) * 36e5).toISOString();
      await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });
      await postNote(leadId, `CBC.agenda.pausa:${Date.now()}`, 'Ana pausada: atendente humano respondeu nesta conversa.');
      return new Response('humano assumiu', { status: 200 });
    }

    // (revisao final I8) mensagem de "nao entendi, pode escrever?" para audio nao-processavel.
    // Antes so chamava falar() sem gravar ultima_fala_ana/log: a proxima checagem de
    // humanoAssumiu() nao tinha essa fala como referencia (ultimaFala vem do estado persistido
    // do turno ANTERIOR) e um evento outgoing qualquer no Kommo virava "humano respondeu" —
    // a Ana se autopausava por 24h so por ter pedido pro lead mandar texto. Roda cedo demais
    // p/ ter convId (so calculado depois do STT/gate de imagem): resolve a conversa sozinho.
    async function pedirTexto() {
      await falar(leadId, cfg.mensagens.pede_texto, cfg);
      estado.ultima_fala_ana = new Date().toISOString();
      await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });
      const convIdPede = await convIdDe(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });
      await logMessage(convIdPede, 'out', cfg.mensagens.pede_texto, 'pede_texto', {});
    }

    // texto da mensagem (audio -> STT, com allowlist de host + teto de bytes)
    let texto = msg.text || '';
    if (!texto && msg.anexoLink && TIPOS_AUDIO.includes(String(msg.anexoTipo))) {
      if (!anexoPermitido(msg.anexoLink)) {
        await pedirTexto();
        await logAdvbox('agenda', 'aviso', 'anexo de host nao permitido — audio nao baixado', { leadId, link: String(msg.anexoLink).slice(0, 200) });
        return new Response('anexo bloqueado', { status: 200 });
      }
      try {
        const head = await fetch(msg.anexoLink, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        if (excedeTeto(head.headers.get('content-length'), cfg)) {
          await pedirTexto();
          await logAdvbox('agenda', 'aviso', `audio acima do teto (${head.headers.get('content-length')} bytes)`, { leadId });
          return new Response('audio grande', { status: 200 });
        }
      } catch { /* HEAD falhou/sem Content-Length: prossegue — teto de 25MB do transcrever segura */ }
      const t = await transcrever({ url: msg.anexoLink, cfg });
      if (t.texto) texto = t.texto;
      else {
        await pedirTexto();
        await logAdvbox('agenda', 'aviso', `STT falhou: ${t.erro}`, { leadId, anexoTipo: msg.anexoTipo, raw: String(raw).slice(0, 1500) });
        return new Response('stt falhou', { status: 200 });
      }
    }

    // anexo nao-audio: se for imagem de host confiavel, vai p/ o modelo em base64 (o lead
    // manda print do contrato/boleto). Qualquer outro anexo continua ignorado, com log.
    let imagemBase64 = null; let imagemTipo = null;
    if (!texto && msg.anexoLink) {
      imagemTipo = tipoAnexoImagem(msg.anexoTipo, msg.anexoLink);
      if (imagemTipo && anexoPermitido(msg.anexoLink)) {
        let pular = false;
        try {
          const head = await fetch(msg.anexoLink, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
          const cl = Number(head.headers.get('content-length'));
          if (Number.isFinite(cl) && cl > 4_000_000) { pular = true; await logAdvbox('agenda', 'aviso', `imagem acima do teto (${cl} bytes)`, { leadId }); }
        } catch { /* HEAD falhou: segue p/ o GET, o teto pos-download segura */ }
        if (!pular) {
          try {
            const r = await fetch(msg.anexoLink, { signal: AbortSignal.timeout(15000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const ct = String(r.headers.get('content-type') || '');
            if (!ct.startsWith('image/')) throw new Error(`content-type ${ct || 'vazio'}`);
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length <= 4_000_000) imagemBase64 = buf.toString('base64');
            else await logAdvbox('agenda', 'aviso', `imagem acima do teto apos download (${buf.length} bytes)`, { leadId });
          } catch (e) { await logAdvbox('agenda', 'aviso', `imagem nao baixada: ${e.message}`, { leadId }); }
        }
      }
      if (!imagemBase64) await logAdvbox('agenda', 'info', 'anexo nao suportado — ignorado', { leadId, anexoTipo: msg.anexoTipo, raw: String(raw).slice(0, 1500) });
    }
    if (!texto && !imagemBase64) return new Response('sem texto', { status: 200 });
    if (TIPOS_AUDIO.includes(String(msg.anexoTipo))) estado.mandou_audio = true;
    // (pos-review Opus #5) fallback composto de dedupe (sem msgId) so AQUI — precisa do
    // `texto` ja resolvido (audio via STT incluso); rodar antes colidiria entre audios
    // distintos no mesmo minuto (ver comentario em jaProcessada). Mensagem so-imagem nao
    // tem texto: entra o link do anexo, senao 2 imagens no mesmo minuto viravam duplicata.
    if (!msg.msgId && await jaProcessada(chaveDedupeFallback(msg.contactId, texto || msg.anexoLink))) return new Response('dupe', { status: 200 });

    const convId = await convIdDe(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });
    await logMessage(convId, 'in', texto || '[imagem]', null, { msgId: msg.msgId, anexo: msg.anexoTipo || null });

    // historico do espelho (atendimento.*) + situacao (gatilho): quem decide SE a Ana fala
    // e em que modo. Sai antes de gastar token quando o roteiro do Salesbot ainda esta em curso.
    const { data: histRaw, error: histErr } = await db.rpc('sdr_ia_historico', { p_chave: RPC_SECRET, p_contact_id: Number(msg.contactId), p_limite: 40 });
    // falha aqui nao derruba o turno, mas SILENCIA a Ana nos gatilhos por texto (sem
    // historico nao ha ultima fala do escritorio) — por isso vira aviso no console.
    if (histErr) await logAdvbox('agenda', 'aviso', `historico do espelho falhou (segue sem contexto): ${histErr.message}`.slice(0, 300), { leadId });
    const historico = filtrarMsgAtual(histRaw || [], texto, agora);
    const temEventoFuturo = !!(estado.agendamento?.inicio && new Date(estado.agendamento.inicio) > agora);
    const situacao = situacaoDoLead({ lead: g.lead, cfg, ultimaMsgEscritorio: ultimaMsgDoEscritorio(historico), temEventoFuturo, temMeetEnviado: temMeetNoHistorico(historico) });
    if (!situacao) return new Response('fora dos gatilhos', { status: 200 });

    // prompt + agente
    const { data: fatos } = await db.rpc('sdr_ia_fatos_listar', { p_chave: RPC_SECRET });
    const plantaoFim = proximoInicioExpediente(agora, grade, cfg.regras.feriados || []);
    const system = montarSystem({ cfg, fatos: fatos || [] });
    const messages = montarMensagens({ historico, textoAtual: texto, contexto: contextoDoTurno({ agora, situacao, estado, fimPlantao: plantaoFim }), imagemBase64, imagemTipo });
    estado.plantao_ativo = true; estado.entregue_em = null; estado.situacao = situacao.acao;
    const exec = criarExecutor({ cfg, grade, leadId, fone, nome: estado.nome, estado, channel, agora, plantaoFim, pipelineId: estado.pipeline_id });

    // (revisao final I2) TETO DE CUSTO POR LEAD/24h. Um lead em loop (ou um ataque simples:
    // mandar mensagem sem parar de madrugada) fazia a Ana chamar o modelo indefinidamente, sem
    // nenhum limite alem do bom senso do proprio modelo. Passou do teto: nao chama o modelo,
    // manda a transicao, escala e registra o turno com stop_reason='teto_custo'.
    // Fail-open: RPC ausente (SQL v2 ainda nao aplicado) ou com erro => segue normal, com aviso.
    const tetoUsd = Number(cfg.llm?.teto_usd_lead_dia ?? 1.0);
    // tetoUsd <= 0 = teto DESLIGADO (config explicita do Paulo) — nem consulta a RPC.
    if (tetoUsd > 0) {
      const { data: gasto24h, error: gastoErr } = await db.rpc('sdr_ia_custo_lead_24h', { p_chave: RPC_SECRET, p_lead: leadId });
      if (gastoErr) await logAdvbox('agenda', 'aviso', `teto de custo nao verificado (segue): ${gastoErr.message}`.slice(0, 300), { leadId });
      else if (Number(gasto24h) >= tetoUsd) {
        const aviso = cfg.mensagens?.transicao_humano || 'Vou pedir para a nossa equipe continuar com você no próximo horário de atendimento. Obrigada pela paciência!';
        await falar(leadId, aviso, cfg);
        if (!estado.escalado) {
          try { await exec.executar('escalar_para_humano', { motivo: `teto de custo do lead atingido (US$ ${Number(gasto24h).toFixed(4)} em 24h)`, resumo: 'Ver conversa.' }); }
          catch (e) { await logAdvbox('agenda', 'erro', `escalada por teto de custo falhou: ${e.message}`.slice(0, 300), { leadId }); }
        }
        estado.ultima_fala_ana = new Date().toISOString();
        // (revisao final I9) sem pausar aqui, toda mensagem seguinte do lead (ainda dentro
        // das 24h de gasto) reprocessava o mesmo teto e mandava a MESMA transicao de novo —
        // agora o pausada_ate existente (checado logo no inicio do turno) segura o resto.
        estado.pausada_ate = new Date(Date.now() + (cfg.regras.silencio_humano_horas || 24) * 36e5).toISOString();
        await logMessage(convId, 'out', aviso, situacao.acao, { stop: 'teto_custo' });
        await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });
        const { error: tetoErr } = await db.rpc('sdr_ia_turno_gravar', { p_chave: RPC_SECRET, p_row: {
          lead_id: leadId, conversation_id: convId, contact_id: Number(msg.contactId),
          entrada: texto || null, entrada_tipo: imagemBase64 ? 'imagem' : (estado.mandou_audio && !msg.text ? 'audio' : 'texto'),
          resposta: aviso, ferramentas: [], modelo: cfg.llm?.modelo || 'claude-opus-5', effort: cfg.llm?.effort || 'low',
          input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0,
          custo_usd: 0, latencia_ms: Date.now() - t0, stop_reason: 'teto_custo', fallback_model: null,
          situacao: situacao.acao, erro: null,
        } });
        if (tetoErr) await logAdvbox('agenda', 'erro', `telemetria do teto nao gravada: ${tetoErr.message}`.slice(0, 300), { leadId, convId });
        await logAdvbox('agenda', 'aviso', `Ana(IA) teto_custo lead ${leadId}: US$ ${Number(gasto24h).toFixed(4)} em 24h (teto ${tetoUsd})`, { leadId });
        return new Response('teto de custo', { status: 200 });
      }
    }

    let r; let erroApi = null;
    try {
      r = await rodarAgente({ client: criarCliente(), modelo: cfg.llm?.modelo || 'claude-opus-5', effort: cfg.llm?.effort || 'low', maxTokens: cfg.llm?.max_tokens || 2048,
        system, tools: FERRAMENTAS, messages, executar: exec.executar });
    } catch (e) {
      erroApi = e.message;
      await logAdvbox('agenda', 'erro', `Claude falhou: ${e.message}`.slice(0, 300), { leadId });
      r = { texto: null, stop_reason: 'api_error', iteracoes: [], chamadas: [], textos: [] };
    }

    // r.texto vazio = recusa, max_iter, max_tokens sem nenhum texto, ou erro de API. O lead
    // NUNCA fica sem resposta: se o modelo chegou a escrever algo antes de estourar as
    // iteracoes, essa fala vale; senao vai a mensagem de transicao. Nos dois casos escala.
    let resposta = r.texto;
    if (!resposta) {
      const parcial = r.stop_reason === 'max_iter' ? (r.textos || []).slice(-1)[0] : null;
      resposta = parcial || cfg.mensagens?.transicao_humano || `Vou pedir para a nossa equipe continuar com você a partir de ${plantaoFim.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', hour: '2-digit', minute: '2-digit' })}. Obrigada!`;
      if (!estado.escalado) {
        try { await exec.executar('escalar_para_humano', { motivo: `agente sem resposta (${r.stop_reason})`, resumo: 'Ver conversa.' }); }
        catch (e) { await logAdvbox('agenda', 'erro', `escalada de fallback falhou: ${e.message}`.slice(0, 300), { leadId }); }
      }
    }
    // (revisao final M1) max_tokens COM texto: o lead recebe uma fala cortada no meio sem
    // ninguem saber. Registra o aviso e, quando a frase nao termina em pontuacao, marca a
    // interrupcao com reticencias — melhor um "..." honesto do que uma frase pela metade.
    if (r.stop_reason === 'max_tokens' && r.texto) {
      await logAdvbox('agenda', 'aviso', `resposta truncada por max_tokens (${r.texto.length} chars)`, { leadId });
      if (!/[.!?…:)\]"']\s*$/.test(resposta)) resposta = `${resposta}…`;
    }
    await falar(leadId, resposta, cfg);
    estado.ultima_fala_ana = new Date().toISOString();
    await logMessage(convId, 'out', resposta, situacao.acao, { stop: r.stop_reason });
    await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });

    // telemetria por chamada (sdr_ia_turnos): tokens, custo, ferramentas, latencia, stop.
    const usoTotal = (k) => r.iteracoes.reduce((s, it) => s + (it.usage?.[k] || 0), 0);
    const avisos = [];
    const custo = custoUsd(r.iteracoes, avisos);
    const { error: turnoErr } = await db.rpc('sdr_ia_turno_gravar', { p_chave: RPC_SECRET, p_row: {
      lead_id: leadId, conversation_id: convId, contact_id: Number(msg.contactId),
      entrada: texto || null, entrada_tipo: imagemBase64 ? 'imagem' : (estado.mandou_audio && !msg.text ? 'audio' : 'texto'),
      resposta, ferramentas: r.chamadas, modelo: r.modeloFinal || cfg.llm?.modelo || 'claude-opus-5', effort: cfg.llm?.effort || 'low',
      input_tokens: usoTotal('input_tokens'), cache_read_tokens: usoTotal('cache_read_input_tokens'), cache_write_tokens: usoTotal('cache_creation_input_tokens'), output_tokens: usoTotal('output_tokens'),
      custo_usd: custo, latencia_ms: Date.now() - t0, stop_reason: r.stop_reason,
      fallback_model: (r.modeloFinal && r.modeloFinal !== (cfg.llm?.modelo || 'claude-opus-5')) ? r.modeloFinal : null,
      situacao: situacao.acao, erro: erroApi,
    } });
    if (turnoErr) await logAdvbox('agenda', 'erro', `telemetria do turno nao gravada: ${turnoErr.message}`.slice(0, 300), { leadId, convId });
    await logAdvbox('agenda', 'info', `Ana(IA) ${situacao.acao} lead ${leadId} ${r.stop_reason} ${r.chamadas.map((c) => c.nome).join(',')} (${Date.now() - t0}ms)`,
      { custo_usd: custo, ...(avisos.length ? { modelos_sem_preco: avisos } : {}) });
    return new Response('ok', { status: 200 });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `worker Ana: ${e.message}`.slice(0, 300), { stack: (e.stack || '').slice(0, 500), raw: String(raw).slice(0, 1500) }).catch(() => {});
    return new Response('erro', { status: 200 });
  }
};
