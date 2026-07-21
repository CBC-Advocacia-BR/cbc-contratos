/**
 * Worker background do bot Ana (ate 15 min). Fluxo por mensagem recebida:
 * parse -> contato/telefone/lead -> filtros (ativo, teste, gatilho, pausa, humano)
 * -> transcreve audio (com allowlist + teto) -> interpreta (LLM) -> engine.decidir
 * -> executa acoes -> persiste estado. NUNCA derruba sem log; sempre responde 200.
 *
 * Falas ao lead SO via templates/engine (cfg.mensagens) — nunca string solta.
 * Invocado exclusivamente pelo despachante kommo-agenda-webhook.mjs, que posta
 * { contentType, raw } (raw = corpo original do Kommo: form-encoded OU json).
 */
import { getConfig, db, findTesterByPhone, getConversation, upsertConversation, logMessage, logAdvbox } from './_lib/botDb.mjs';
import { getContact, extractPhones, firstLeadId, kommoGet, setLeadField, moveLeadStage, createKommoTask, postNote, runSalesbot } from './_lib/kommo.mjs';
import { decidir, confirmar, estadoInicial, aplicarTemplate } from './_lib/agendaEngine.mjs';
import { gerarSlots, sortearVendedora, slotMaisProximo, formatarSlot } from './_lib/agendaSlots.mjs';
import { interpretar, transcrever } from './_lib/agendaInterprete.mjs';
import { getAccessToken, freeBusy, createEventComMeet, cancelEvent } from './_lib/googleAgenda.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const TIPOS_AUDIO = ['voice', 'audio', 'ptt'];

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

// ===================== I/O (orquestracao — validada no piloto) =====================

// dedupe (padrao bot ADVBOX: tabela bot_processed_messages, coluna msg_id text PK —
// confirmado em advbox-bot-worker-background.mjs; o esqueleto do brief dizia message_id).
async function jaProcessada(msgId) {
  if (!msgId) return false;
  try {
    const { error } = await db.from('bot_processed_messages').insert({ msg_id: `agenda:${msgId}` });
    if (!error) return false; // reservou agora => primeira vez
    if (error.code === '23505' || /duplicate key|already exists/i.test(error.message || '')) return true;
    // outro erro (tabela ausente, permissao): best-effort, NAO bloqueia o processamento
    await logAdvbox('agenda', 'aviso', `dedupe best-effort falhou: ${error.message}`.slice(0, 200), { msgId });
    return false;
  } catch { return false; }
}

async function leadNoGatilho(leadId, cfg) {
  const lead = await kommoGet(`/leads/${leadId}`);
  if (!lead) return { ok: false };
  for (const g of cfg.gatilhos || []) {
    if (lead.pipeline_id !== g.pipeline_id) continue;
    if (g.status_ids === 'todas' || (Array.isArray(g.status_ids) && g.status_ids.includes(lead.status_id))) {
      return { ok: true, lead };
    }
  }
  return { ok: false, lead };
}

// humano respondeu manualmente depois da ultima fala da Ana? (spec: eventos outgoing por CONTATO)
async function humanoAssumiu(contactId, ultimaFalaAnaISO) {
  if (!contactId || !ultimaFalaAnaISO) return false;
  const r = await kommoGet(`/events?filter[type]=outgoing_chat_message&filter[entity]=contact&filter[entity_id][]=${contactId}&limit=5`);
  const eventos = r?._embedded?.events || [];
  const margemSeg = 90; // a propria fala da Ana via salesbot tambem gera outgoing — ignora ate 90s apos nossa fala
  return eventos.some((ev) => ev.created_at * 1000 > new Date(ultimaFalaAnaISO).getTime() + margemSeg * 1000);
}

async function falar(leadId, mensagem, cfg) {
  await setLeadField(leadId, cfg.kommo.campo_ana_id, mensagem);
  await runSalesbot(cfg.kommo.salesbot_id, leadId, 'leads');
}

async function upsertVC(row) {
  const { error } = await db.rpc('agenda_videochamadas_upsert', { p_chave: RPC_SECRET, p_rows: [row] });
  if (error) throw new Error(`upsert vc: ${error.message}`);
}

// upsertConversation ja retorna a linha (.select().single()); fallback defensivo p/ o id
// via getConversation caso o upsert nao devolva a linha (ajuste obrigatorio #1).
async function convIdDe(channel, fields) {
  const row = await upsertConversation(channel, fields);
  if (row?.id) return row.id;
  const again = await getConversation(channel);
  return again?.id || null;
}

async function montarSlots(cfg, agora, desejadoISO = null) {
  const at = await getAccessToken();
  const emails = cfg.vendedoras.filter((v) => v.ativa).map((v) => v.email);
  const fim = new Date(agora.getTime() + (cfg.regras.horizonte_dias_uteis + 4) * 864e5);
  const busy = await freeBusy(emails, agora.toISOString(), fim.toISOString(), at);
  let slots = gerarSlots({ regras: cfg.regras, busyPorVendedora: busy, agora, limite: 12 });
  if (desejadoISO) { const s = slotMaisProximo(slots, desejadoISO); slots = s ? [s, ...slots.filter((x) => x !== s)] : slots; }
  return { slots, at };
}

export default async (req) => {
  const t0 = Date.now();
  let raw = '';
  try {
    const body = await req.json();
    raw = body?.raw || '';
    const msg = parsePayload(body?.contentType, raw);
    const cfgAll = await getConfig();
    const cfg = cfgAll.agenda_bot;
    if (!cfg?.ativo) return new Response('inativo', { status: 200 });
    if (!msg.contactId) return new Response('sem contato', { status: 200 });
    if (await jaProcessada(msg.msgId)) return new Response('dupe', { status: 200 });

    const contato = await getContact(msg.contactId);
    const phones = extractPhones(contato);
    const fone = (phones[0] || '').replace(/\D/g, '');
    if (!fone) return new Response('sem fone', { status: 200 });

    if (cfg.modo_teste) {
      let tester = null;
      for (const ph of phones) { tester = await findTesterByPhone(ph); if (tester) break; }
      if (!tester) return new Response('nao testador', { status: 200 });
    }

    const leadId = firstLeadId(contato);
    if (!leadId) return new Response('sem lead', { status: 200 });
    const g = await leadNoGatilho(leadId, cfg);
    if (!g.ok) return new Response('fora do gatilho', { status: 200 });

    // estado
    const channel = `agenda:${fone}`;
    const conv = await getConversation(channel);
    let estado = conv?.context?.etapa ? conv.context
      : estadoInicial({ lead_id: leadId, contact_id: Number(msg.contactId), nome: contato?.name || '', origem: g.lead.pipeline_id === 13760367 ? 'venda' : 'disparo' });

    if (estado.pausada_ate && new Date(estado.pausada_ate) > new Date()) return new Response('pausada', { status: 200 });
    const ultimaFala = conv?.context?.ultima_fala_ana || null;
    if (await humanoAssumiu(msg.contactId, ultimaFala)) {
      estado.pausada_ate = new Date(Date.now() + (cfg.regras.silencio_humano_horas || 24) * 36e5).toISOString();
      await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });
      await postNote(leadId, `CBC.agenda.pausa:${Date.now()}`, 'Ana pausada: atendente humano respondeu nesta conversa.');
      return new Response('humano assumiu', { status: 200 });
    }

    // texto da mensagem (audio -> STT, com allowlist de host + teto de bytes)
    let texto = msg.text || '';
    if (!texto && msg.anexoLink && TIPOS_AUDIO.includes(String(msg.anexoTipo))) {
      if (!anexoPermitido(msg.anexoLink)) {
        await falar(leadId, cfg.mensagens.pede_texto, cfg);
        await logAdvbox('agenda', 'aviso', 'anexo de host nao permitido — audio nao baixado', { leadId, link: String(msg.anexoLink).slice(0, 200) });
        return new Response('anexo bloqueado', { status: 200 });
      }
      try {
        const head = await fetch(msg.anexoLink, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        if (excedeTeto(head.headers.get('content-length'), cfg)) {
          await falar(leadId, cfg.mensagens.pede_texto, cfg);
          await logAdvbox('agenda', 'aviso', `audio acima do teto (${head.headers.get('content-length')} bytes)`, { leadId });
          return new Response('audio grande', { status: 200 });
        }
      } catch { /* HEAD falhou/sem Content-Length: prossegue — teto de 25MB do transcrever segura */ }
      const t = await transcrever({ url: msg.anexoLink, cfg });
      if (t.texto) texto = t.texto;
      else {
        await falar(leadId, cfg.mensagens.pede_texto, cfg);
        await logAdvbox('agenda', 'aviso', `STT falhou: ${t.erro}`, { leadId, anexoTipo: msg.anexoTipo, raw: String(raw).slice(0, 1500) });
        return new Response('stt falhou', { status: 200 });
      }
    }
    // anexo presente mas nao-audio (ou campos de attachment ainda nao mapeados): loga o raw
    // p/ o piloto ajustar os nomes dos campos, e segue como "sem texto".
    if (!texto && msg.anexoLink) {
      await logAdvbox('agenda', 'info', 'mensagem com anexo nao-audio/ sem texto — ignorada (validar campos no piloto)', { leadId, anexoTipo: msg.anexoTipo, raw: String(raw).slice(0, 1500) });
    }
    if (!texto) return new Response('sem texto', { status: 200 });

    const convId = await convIdDe(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });
    await logMessage(convId, 'in', texto, null, { msgId: msg.msgId, anexo: msg.anexoTipo || null });

    // interpreta + decide (com ate 1 re-entrada por buscar_slots)
    const agora = new Date();
    const interp = estado.etapa === 'abertura' ? { intencao: 'saudacao', confianca: 1 } : await interpretar({ mensagem: texto, estado, cfg });
    let r = decidir({ estado, interp, cfg, agora });
    let slotsCtx = null;
    if (r.acoes.some((a) => a.tipo === 'buscar_slots')) {
      const desejado = r.acoes.find((a) => a.tipo === 'buscar_slots')?.desejado || null;
      slotsCtx = await montarSlots(cfg, agora, desejado);
      r = decidir({ estado, interp, cfg, agora, slotsDisponiveis: slotsCtx.slots });
    }
    let estadoFinal = r.novoEstado;

    for (const acao of r.acoes) {
      if (acao.tipo === 'responder') {
        await falar(leadId, acao.mensagem, cfg);
        estadoFinal.ultima_fala_ana = new Date().toISOString();
        await logMessage(convId, 'out', acao.mensagem, interp.intencao, {});
      } else if (acao.tipo === 'salvar_campos') {
        if (acao.campos.investimento) await setLeadField(leadId, cfg.kommo.campo_investimento_id, acao.campos.investimento);
        if (acao.campos.preferencia) await setLeadField(leadId, cfg.kommo.campo_preferencia_id, acao.campos.preferencia);
      } else if (acao.tipo === 'agendar' || acao.tipo === 'reagendar') {
        const slot = estadoFinal.slots_ofertados[acao.slotIdx];
        const { slots, at } = slotsCtx || await montarSlots(cfg, agora);
        // revalida o slot (concorrencia): confere se ainda ha vendedora livre nesse horario
        const aindaLivre = slots.find((s) => new Date(s.inicio).getTime() === new Date(slot.inicio).getTime());
        if (!aindaLivre) {
          const dois = slots.slice(0, cfg.regras.slots_por_oferta);
          estadoFinal.slots_ofertados = dois.map((x) => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: [...x.vendedoras] }));
          const vars = Object.fromEntries(dois.map((s, i) => [`slot${i + 1}`, formatarSlot(new Date(s.inicio), agora)]));
          await falar(leadId, aplicarTemplate(cfg.mensagens.slot_ocupado, vars), cfg);
          estadoFinal.ultima_fala_ana = new Date().toISOString();
          break;
        }
        const vend = sortearVendedora(cfg.vendedoras, aindaLivre.vendedoras, String(leadId));
        if (!vend) {
          // nenhuma vendedora elegivel (peso 0 / inativa) — nao fabrica fala; alerta a equipe.
          await logAdvbox('agenda', 'aviso', 'sem vendedora elegivel p/ o slot (peso/ativa) — handoff', { leadId, inicio: slot.inicio });
          await createKommoTask(leadId, 'leads', 'Ana nao achou vendedora p/ o horario aceito. Combinar manualmente.', 1, null);
          await postNote(leadId, `CBC.agenda.handoff:${Date.now()}`, 'Ana -> humano. Sem vendedora elegivel p/ o slot aceito.');
          break;
        }
        const ini = new Date(slot.inicio);
        const fim = new Date(ini.getTime() + cfg.regras.duracao_evento_min * 60000);
        if (acao.tipo === 'reagendar' && estadoFinal.agendamento?.event_id) {
          await cancelEvent({ calendarId: estadoFinal.agendamento.vendedora, eventId: estadoFinal.agendamento.event_id, accessToken: at }).catch(() => {});
        }
        const { eventId, meetLink } = await createEventComMeet({ calendarId: vend, inicioISO: ini.toISOString(), fimISO: fim.toISOString(),
          titulo: `Videochamada — ${estadoFinal.nome || fone} (CBC/Ana)`,
          descricao: `Lead: https://advocaciacbc.kommo.com/leads/detail/${leadId}\nTelefone: ${fone}\nResort: ${estadoFinal.dados.resort || '?'} | Situação: ${estadoFinal.dados.situacao || '?'} | Já pagou: ${estadoFinal.dados.valor_aprox || '?'}`,
          leadId, telefone: fone, nome: estadoFinal.nome, accessToken: at });
        const c = confirmar({ estado: estadoFinal, slot: aindaLivre, agora, cfg, eventId, meetLink, vendedora: vend });
        estadoFinal = c.novoEstado;
        await falar(leadId, c.mensagem, cfg);
        estadoFinal.ultima_fala_ana = new Date().toISOString();
        await logMessage(convId, 'out', c.mensagem, 'confirmado', { eventId });
        await upsertVC({ event_id: eventId, vendedora_email: vend, cliente_email: null, cliente_nome: estadoFinal.nome || null,
          status: 'agendada', color_id: null, scheduled_at: ini.toISOString(), tem_meet: true, source: 'live',
          origem: 'ana', lead_id: leadId, telefone: fone, raw: {} });
        const vendCfg = cfg.vendedoras.find((v) => v.email === vend);
        await moveLeadStage(leadId, { pipelineId: cfg.kommo.etapa_agendado.pipeline_id, statusId: cfg.kommo.etapa_agendado.status_id });
        if (vendCfg?.user_id) await createKommoTask(leadId, 'leads', `Videochamada (Ana): ${ini.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — Meet: ${meetLink}`, Math.max(1, (ini - Date.now()) / 36e5), vendCfg.user_id);
      } else if (acao.tipo === 'handoff') {
        await createKommoTask(leadId, 'leads', `Ana pediu apoio humano (${acao.motivo}). Ver conversa e assumir.`, 1, null);
        await postNote(leadId, `CBC.agenda.handoff:${Date.now()}`, `Ana → humano. Motivo: ${acao.motivo}. Dados: ${JSON.stringify(estadoFinal.dados)}`);
      } else if (acao.tipo === 'nota') {
        await postNote(leadId, `CBC.agenda.nota:${Date.now()}`, acao.texto);
      }
    }

    await upsertConversation(channel, { customer_id: leadId, customer_name: estadoFinal.nome, context: estadoFinal });
    await logAdvbox('agenda', 'info', `Ana ${estado.etapa}→${estadoFinal.etapa} lead ${leadId} (${Date.now() - t0}ms)`, { interp: interp.intencao, conf: interp.confianca });
    return new Response('ok', { status: 200 });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `worker Ana: ${e.message}`.slice(0, 300), { stack: (e.stack || '').slice(0, 500), raw: String(raw).slice(0, 1500) }).catch(() => {});
    return new Response('erro', { status: 200 });
  }
};
