/**
 * Netlify Function: portal-data
 * Backend do PORTAL DO CLIENTE (versao teste, acesso por token na URL).
 * GET ?t=<token>  ->  { cliente, processos[ {fase, andamentos traduzidos...} ],
 *                       pagamentos { resumo, pendentes[], pagos[] } }
 *
 * Fontes (tudo do espelho local — rapido e sem rate limit):
 *  - cliente_portal_tokens (acesso) · bi_processos (carteira)
 *  - bot_sync_state (andamentos, traduzidos pelo glossario do bot)
 *  - bot_stage_templates (texto da fase + ocultar_cliente)
 *  - asaas_boletos (pagos/pendentes, boleto + PIX copia-e-cola)
 *    fallback: API Asaas ao vivo para PIX faltante (max 3/req)
 */
import { db, getGlossary } from './_lib/botDb.mjs';
import { glossaryTranslate } from './_lib/botEngine.mjs';
import { checkRateLimitShared, rateLimitResponse } from './rate-limit.mjs';

const ASAAS_KEY = process.env.ASAAS_API_KEY || '';
const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, no-store' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });
const digits = (s) => String(s || '').replace(/\D/g, '');
const PAGOS = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------- calendário forense (Americana/SP) ----------
// Páscoa pelo algoritmo de Meeus — feriados móveis sem manutenção anual.
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31),
    dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}
const FERIADOS_FIXOS = {
  '04-21': 'Tiradentes', '05-01': 'Dia do Trabalho',
  '06-13': 'Santo Antônio — padroeiro de Americana (feriado municipal)',
  '07-09': 'Revolução Constitucionalista (feriado estadual de SP)',
  '08-27': 'Aniversário de Americana (feriado municipal)',
  '09-07': 'Independência do Brasil', '10-12': 'Nossa Senhora Aparecida',
  '11-02': 'Finados', '11-15': 'Proclamação da República', '11-20': 'Dia da Consciência Negra',
};
const nowSP = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Nome do feriado/recesso numa data (ou null) — sem fins de semana.
function feriadoNome(d) {
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (mmdd >= '12-20' || mmdd <= '01-20') return 'Recesso do Judiciário';
  if (FERIADOS_FIXOS[mmdd]) return FERIADOS_FIXOS[mmdd];
  const ano = d.getFullYear(), p = pascoa(ano);
  const dif = Math.round((Date.UTC(ano, d.getMonth(), d.getDate()) - p) / 86400000);
  if (dif === -48 || dif === -47) return 'Carnaval';
  if (dif === -2) return 'Sexta-feira Santa';
  if (dif === 60) return 'Corpus Christi';
  return null;
}
// Dia útil = não é fim de semana, feriado nem recesso.
function ehDiaUtil(d) {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !feriadoNome(d);
}
function proximoDiaUtil(base) {
  const d = new Date(base); let guard = 0;
  do { d.setDate(d.getDate() + 1); guard++; } while (!ehDiaUtil(d) && guard < 40);
  return d;
}
function recessoOuFeriado() {
  const sp = nowSP();
  const nome = feriadoNome(sp);
  if (!nome) return null;
  if (nome.startsWith('Recesso')) {
    const mmdd = `${String(sp.getMonth() + 1).padStart(2, '0')}-${String(sp.getDate()).padStart(2, '0')}`;
    return { nome, recesso: true, ate: `20/01/${mmdd >= '12-20' ? sp.getFullYear() + 1 : sp.getFullYear()}` };
  }
  return { nome };
}
// Aviso proativo: PRÓXIMO feriado/recesso dentro da janela (7d pontual, 14d recesso).
// Anuncia só o 1º dia de uma sequência (não repete em feriados emendados / recesso longo).
function calendarioProativo() {
  const sp = nowSP();
  if (feriadoNome(sp)) return null; // hoje já é feriado — o banner de recesso/feriado cobre
  for (let i = 1; i <= 14; i++) {
    const d = new Date(sp); d.setDate(d.getDate() + i);
    const nome = feriadoNome(d);
    if (!nome) continue;
    const prev = new Date(d); prev.setDate(prev.getDate() - 1);
    if (feriadoNome(prev)) continue; // dia no meio de uma sequência já iniciada
    const janela = nome.startsWith('Recesso') ? 14 : 7;
    if (i <= janela) return { nome, em: isoDate(d), dias: i, recesso: nome.startsWith('Recesso') };
    return null; // próximo evento está além da janela
  }
  return null;
}

// ---------- classificador determinístico de evento crítico (sem IA) ----------
// Mapeia o título do andamento (já normalizado) num ENUM emocional. Ordem
// importa: o mais específico primeiro. 'improceden' casa antes de 'proceden'.
function classifyEvent(title) {
  const t = String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!t) return null;
  if (/transit.*julgad|baixa definitiva/.test(t)) return 'transito_em_julgado';
  if (/parcialmente (proceden|deferi)|(senten|julg|decis|acordao).*parcial/.test(t)) return 'sentenca_parcial';
  if (/(senten|julg|decis|acordao).*(improceden|indeferi|desfavor|nego provimento|negar provimento|denego)/.test(t)) return 'sentenca_desfavoravel';
  if (/(senten|julg|decis|acordao).*(proceden|deferi|favoravel|dou provimento|condena|acolho)/.test(t)) return 'sentenca_favoravel';
  if (/homolog.*acordo|acordo homolog|conciliac|autocompos/.test(t)) return 'acordo';
  if (/alvara|levantament|requisitori|precatori|expedicao de alvara/.test(t)) return 'cumprimento';
  if (/audiencia|sessao de julgamento|pericia/.test(t)) return 'audiencia';
  if (/recurso|apelac|agravo|embarg/.test(t)) return 'recurso';
  if (/cita(c|d)|mandado de citacao/.test(t)) return 'citacao';
  return null;
}
// Evento "seguro para o cliente": nunca revela má notícia sozinho (decisão do
// Paulo). Sentença desfavorável/parcial -> card neutro 'decisao_neutra'.
function eventoCard(ev) {
  if (ev === 'sentenca_favoravel') return 'sentenca_favoravel';
  if (ev === 'sentenca_desfavoravel' || ev === 'sentenca_parcial') return 'decisao_neutra';
  if (ev === 'citacao') return 'citacao';
  if (ev === 'audiencia') return 'audiencia';
  if (ev === 'acordo') return 'acordo';
  return null;
}
// Silêncio saudável: tipo de espera derivado da etapa (para gerar a frase certa).
function tipoEspera(p) {
  const t = `${p.quadro || ''} ${p.etapa || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/audien/.test(t)) return 'audiencia';
  if (/perici|laudo|dilig/.test(t)) return 'pericia';
  if (/conclus|sentenc|julgad|decis|despach|vista dos autos/.test(t)) return 'juiz';
  if (/cita|contesta|defesa|prazo|replic|manifest|intima|impugn/.test(t)) return 'parte';
  return null;
}

// Explicador "Por que a Justiça é lenta (e por que isso não é abandono)".
// Estático e perene; o escritório pode sobrescrever em bot_config 'portal_explicador'
// (chave 'itens' = [{t, d}]). Conteúdo escrito uma vez, sem manutenção recorrente.
const EXPLICADOR_DEFAULT = [
  { t: 'A maior parte do tempo, seu caso está na fila do juiz', d: 'Em cada vara há milhares de processos para poucos juízes, e a lei manda analisar cada um na sua vez. Esse tempo de fila é o que mais pesa — não é falta de andamento, é a estrutura do Judiciário.' },
  { t: 'Os prazos da lei existem para proteger você', d: 'Cada etapa tem prazos garantidos às partes (defesa, manifestação, recurso). Eles podem parecer demora, mas são o que garante que tudo seja feito com segurança e sem risco de anulação.' },
  { t: 'Silêncio do tribunal não é abandono', d: 'Mesmo quando o sistema fica dias parado, nós verificamos o seu processo automaticamente todos os dias úteis. No instante em que algo se move, aparece aqui para você.' },
  { t: 'Quando é a nossa vez, agimos rápido', d: 'Toda tarefa que depende do escritório é cumprida dentro do prazo — quase sempre antes dele. O que não controlamos é o tempo de resposta do juiz e da outra parte.' },
];

// Educação por marco da jornada — DEFAULTS prontos; o escritório pode
// sobrescrever tudo em bot_config key 'portal_educacao' (aba Config do bot).
const EDU_DEFAULT = {
  0: {
    entenda: 'Seu contrato está assinado e nossa equipe está preparando a estratégia do seu caso: análise dos documentos, fundamentos jurídicos e elaboração da petição inicial.',
    nao_acontece: 'Nesta fase não há audiência nem prazos correndo contra você. Você não precisa comparecer a lugar nenhum.',
    faq: [['Preciso enviar mais documentos?', 'Se algo for necessário, nossa equipe entra em contato direto com você — não precisa adivinhar.'], ['Quanto tempo até a ação ser protocolada?', 'Depende da preparação de cada caso. O marco "Distribuição" da jornada acima acende automaticamente quando acontecer.']],
  },
  1: {
    entenda: 'Sua ação foi protocolada na Justiça e recebeu número oficial. Agora o processo entra na fila do tribunal para os primeiros despachos do juiz.',
    nao_acontece: 'Ainda não há audiência marcada e você não precisa ir ao fórum. A espera nesta fase é normal e esperada — é a fila natural do Judiciário.',
    faq: [['O que é a distribuição?', 'É o registro oficial da ação na Justiça: o caso ganha número de processo e um juiz responsável.'], ['Posso viajar tranquilo(a)?', 'Pode. Se qualquer coisa precisar de você, avisamos com antecedência.']],
  },
  2: {
    entenda: 'A outra parte está sendo (ou já foi) oficialmente comunicada do processo e tem prazo legal para apresentar defesa. Depois, nossa equipe responde tecnicamente a cada argumento.',
    nao_acontece: 'Você não precisa fazer nada — a troca de prazos e petições desta fase acontece entre os advogados e o tribunal.',
    faq: [['A outra parte pode evitar a citação?', 'A lei tem mecanismos para citar mesmo quem se esquiva — é mais comum demorar do que falhar.'], ['E se eles se defenderem?', 'É o esperado e já faz parte da estratégia: respondemos ponto a ponto.']],
  },
  3: {
    entenda: 'O processo está na fase de decisão: o juiz analisa os argumentos das duas partes. Depois da sentença ainda pode haver recurso — etapa comum e prevista.',
    nao_acontece: 'Não há nada pendente do seu lado. O ritmo aqui é o da fila de decisões do tribunal — e seguimos acompanhando todos os dias.',
    faq: [['A sentença encerra o caso?', 'Quase: qualquer parte pode recorrer, e seguimos atuando até a decisão definitiva (trânsito em julgado).'], ['Recurso é má notícia?', 'Não necessariamente — é etapa normal do processo e já entra nos nossos planos.']],
  },
  4: {
    entenda: 'Cumprimento de sentença: a decisão a seu favor agora vira dinheiro. Esta é a fase de cálculos, expedição de alvará ou requisição de pagamento e liberação dos valores — uma das etapas mais demoradas, por depender do tribunal e do banco.',
    nao_acontece: 'O mérito já está vencido a seu favor. A demora aqui é a burocracia de liberação (tribunal e banco), não falta de andamento — e não depende de nenhuma ação sua.',
    faq: [['Por que demora para o dinheiro sair?', 'Após a decisão, o valor passa por cálculo, conferência e liberação pelo tribunal e pelo banco. Cada etapa tem um prazo próprio — acompanhamos todas e avisamos a cada avanço.'], ['Preciso fazer algo para receber?', 'Não. Se em algum momento for preciso um dado seu (como uma conta para depósito), nós entramos em contato. Tudo o que houver aparece aqui e na aba Acordo.']],
  },
  5: {
    entenda: 'Êxito: seu caso chegou ao fim com resultado. Os valores foram liberados e o processo caminha para o encerramento definitivo.',
    nao_acontece: 'Não há mais nada pendente do seu lado. Foi um prazer cuidar do seu caso — e seguimos à disposição para o que precisar.',
    faq: [['O caso ainda pode mudar?', 'Após o trânsito em julgado e a liberação dos valores, o resultado é definitivo. Eventuais acertos finais aparecem nas abas Pagamentos e Acordo.'], ['Posso indicar o escritório?', 'Ficamos honrados. Há um espaço de indicação no portal — e seguimos por perto para qualquer necessidade futura.']],
  },
};
function montaEducacao(cfgEdu) {
  const out = {};
  for (let m = 0; m <= 5; m++) {
    const o = (cfgEdu || {})[`m${m}`] || {};
    let faq = EDU_DEFAULT[m].faq;
    if (o.faq_texto && String(o.faq_texto).trim()) {
      faq = String(o.faq_texto).split('\n').map(l => l.split('|').map(s => s.trim())).filter(p => p[0] && p[1]);
    }
    out[m] = {
      entenda: (o.entenda || '').trim() || EDU_DEFAULT[m].entenda,
      nao_acontece: (o.nao_acontece || '').trim() || EDU_DEFAULT[m].nao_acontece,
      faq,
    };
  }
  return out;
}

// Jornada do processo (6 marcos): Contratacao -> Distribuicao -> Citacao ->
// Sentenca -> Cumprimento de sentenca -> Exito. Derivada do quadro + etapa do
// ADVBOX. Ordem dos testes importa (do mais avancado ao mais inicial).
function jornadaIndice(p) {
  const txt = `${p.quadro || ''} ${p.etapa || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = String(p.quadro || '').toUpperCase();
  // 5 = Exito (encerrado / valores recebidos)
  if (q === 'ARQUIVAMENTO' || /arquiv|encerr|exito|quitad|repasse|prestacao de contas|baixa definitiva/.test(txt)) return 5;
  // 4 = Cumprimento de sentenca (execucao / recebimento do valor) — fase longa
  if (q === 'FINANCEIRO' || /cumpriment|execu|levantament|alvar|penhora|requisitori|precatori/.test(txt)) return 4;
  // 3 = Sentenca / recurso
  if (q === 'RECURSAL' || /senten|julgad|julgament|recurso|apelac|agravo|embarg|transit|acordo|homolog/.test(txt)) return 3;
  // 2 = Citacao / instrucao
  if (/cita|contesta|replica|audien|perici|instru|saneament|impugna/.test(txt)) return 2;
  // 1 = Distribuicao
  if (p.process_number || q === 'JUDICIAL' || /protocolad|distribu|ajuiz|custas/.test(txt)) return 1;
  return 0;
}

export default async (req) => {
  // (seg-12 / auditoria #77) rate limit COMPARTILHADO por IP ANTES de processar (funcao
  // publica do portal). Bucket 'portal', ~40/min — conta entre instancias, dificultando
  // enumeracao de token/PII (o em-memoria antigo contava do zero em cada instancia).
  const rl = await checkRateLimitShared(req, { bucket: 'portal', max: 40, windowSeconds: 60 });
  if (!rl.allowed) return rateLimitResponse();

  const url = new URL(req.url);
  const token = (url.searchParams.get('t') || '').trim();
  if (!token || token.length < 16) return json({ erro: 'acesso_invalido' }, 401);

  try {
    // 1) valida o token
    const { data: tk } = await db.from('cliente_portal_tokens').select('*')
      .eq('token', token).eq('ativo', true).maybeSingle();
    if (!tk) return json({ erro: 'acesso_invalido' }, 401);
    db.from('cliente_portal_tokens')
      .update({ acessos: (tk.acessos || 0) + 1, ultimo_acesso: new Date().toISOString() })
      .eq('token', token).then(() => {});
    db.rpc('portal_reg_acesso').then(() => {}); // (#47) contador diário de acessos

    const nome = tk.nome || '';
    const primeiro = nome.trim().split(/\s+/)[0];
    const cpf = digits(tk.cpf);
    const cpfFmt = cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : (tk.cpf || '');
    const cpfList = [...new Set([tk.cpf, cpfFmt, cpf].filter(Boolean))].map(v => `"${v}"`).join(',');

    // 2) processos do cliente (carteira espelhada) + templates de fase + glossario
    //    + acordo ativo na prestacao de contas (RPC valida o token e faz o match
    //    por processo/cumprimento/CPF dentro do banco — calculos e restrita)
    // Promise.allSettled: uma fonte que falhe degrada SO a propria secao,
    // nunca derruba o portal inteiro (#19 robustez).
    // (portal-1) casar processos pelo ID do cliente (identificador unico) em vez de
    // pelo NOME — antes um homonimo podia ver o caso de outra pessoa (vazamento LGPD).
    // O token guarda advbox_customer_id; o snapshot preenche bi_processos.customer_ids.
    // Fallback por nome SO para processos ainda nao indexados (customer_ids null), p/
    // nao deixar o portal vazio antes do proximo snapshot — esses serao corrigidos no
    // proximo ciclo. Processos ja indexados que NAO contem este id ficam de fora.
    const custId = Number(tk.advbox_customer_id);
    const nomeSafe = String(nome).replace(/[,()*]/g, ' ').trim();
    const colsProc = 'lawsuit_id, process_number, tipo, etapa, stages_id, quadro, responsavel, process_date';
    const processosQuery = (Number.isFinite(custId) && custId > 0)
      ? db.from('bi_processos').select(colsProc)
          .or(`customer_ids.cs.{${custId}},and(customer_ids.is.null,clientes.ilike.*${nomeSafe}*)`).limit(8)
      : db.from('bi_processos').select(colsProc).ilike('clientes', `%${nome}%`).limit(8);
    const settled = await Promise.allSettled([
      processosQuery,
      db.from('bot_stage_templates').select('stages_id, template, proximos_passos, prazo_medio, ocultar_cliente, active, nome_cliente'),
      getGlossary(),
      db.rpc('portal_acordo', { p_token: token }),
      db.rpc('portal_atividades', { p_token: token }),
      db.from('bot_config').select('key, value').in('key', ['portal_equipe', 'portal_educacao', 'monitor_status', 'portal_review', 'portal_contato', 'portal_explicador']),
      db.from('bot_sync_state').select('id', { count: 'exact', head: true })
        .eq('kind', 'task_completed')
        .gte('event_date', new Date().toISOString().slice(0, 8) + '01'),
      db.rpc('portal_instituicao'),
      db.from('portal_faq').select('pergunta, resposta').eq('ativo', true).order('ordem').limit(30),
      db.from('portal_perguntas').select('pergunta, resposta, status, criado_em, respondida_em')
        .eq('token', token).order('criado_em', { ascending: false }).limit(6),
      // contrato do cliente (CPF do titular em qualquer dos contratantes)
      cpf ? db.from('contratos')
        .select('tipo_acao, resort, status, honorarios_total, honorarios_parcelas, honorarios_valor_parcela, honorarios_percentual_exito, signed_at, created_at')
        .is('arquivado_em', null)
        .or(`cpf_contratante1.in.(${cpfList}),cpf_contratante2.in.(${cpfList})`)
        .order('created_at', { ascending: false }).limit(3)
        : Promise.resolve({ data: [] }),
      db.rpc('portal_funil'), // prova social: distribuição por marco da jornada
    ]);
    const R = settled.map(s => (s.status === 'fulfilled' ? s.value : null));
    const procs = R[0]?.data || [];
    const stages = R[1]?.data || [];
    const glossary = R[2] || [];
    const acordo = R[3]?.data || null;
    const atividades = R[4]?.data || null;
    const cfgRows = R[5]?.data || [];
    const tarefasMes = R[6]?.count || 0;
    const instituicao = R[7]?.data || null;
    const faq = R[8]?.data || [];
    const minhasPerguntas = R[9]?.data || [];
    const cts = R[10]?.data || [];
    const funil = R[11]?.data || {}; // { '0':n, ... '5':n } por marco da jornada

    const cfgMap = {};
    for (const r of cfgRows || []) cfgMap[r.key] = r.value || {};
    const eqCfg = { value: cfgMap.portal_equipe || {} };
    const monitorStatus = cfgMap.monitor_status || {};

    const ct = (cts || [])[0];
    const contrato = ct ? {
      tipo: ct.tipo_acao || '',
      resort: ct.resort || '',
      status: ct.status || '',
      honorarios_total: Number(ct.honorarios_total) || null,
      parcelas: ct.honorarios_parcelas || null,
      valor_parcela: Number(ct.honorarios_valor_parcela) || null,
      exito_pct: Number(ct.honorarios_percentual_exito) || null,
      assinado_em: ct.signed_at || null,
      outros_contratos: Math.max(0, (cts || []).length - 1),
    } : null;
    const stageMap = new Map((stages || []).map(s => [Number(s.stages_id), s]));

    // 3) andamentos traduzidos (espelho local — ja inclui historico completo)
    const ids = (procs || []).map(p => p.lawsuit_id);
    let movs = [];
    if (ids.length) {
      try {
        const { data } = await db.from('bot_sync_state')
          .select('lawsuit_id, event_date, title, payload, event_class, title_cliente')
          .eq('kind', 'movement').in('lawsuit_id', ids)
          .order('event_date', { ascending: false }).limit(300);
        movs = data || [];
      } catch (e) { console.error('[portal-data movs]', e?.message); }
    }

    const processos = (procs || []).map(p => {
      const st = stageMap.get(Number(p.stages_id));
      const oculta = !!st?.ocultar_cliente;
      const movsP = movs.filter(m => m.lawsuit_id === p.lawsuit_id);
      const andamentos = movsP.slice(0, 15)
        .map(m => ({
          data: m.event_date,
          // prefere a tradução persistida (sync); senão glossário inline; fallback neutro
          // NUNCA expõe o juridiquês cru se tudo falhar (#3)
          texto: m.title_cliente || glossaryTranslate(m.title || '', glossary) || 'Movimentação processual registrada',
          original: undefined, // nao expomos o texto tecnico no portal
          fonte: m.payload?.header || null,
        }));
      // evento critico mais recente (card de citacao/sentenca/audiencia/acordo).
      // Sentenca desfavoravel/parcial vira 'decisao_neutra' (nao revela sozinho).
      let evento = null;
      if (!oculta) {
        for (const m of movsP) { const ev = eventoCard(m.event_class || classifyEvent(m.title)); if (ev) { evento = { tipo: ev, data: m.event_date }; break; } }
      }
      const atv = (atividades || {})[String(p.lawsuit_id)] || null;
      const jornada = jornadaIndice(p);
      return {
        jornada,
        // prova social: quantos OUTROS processos do escritório estão no mesmo marco
        mesma_fase: Math.max(0, (Number(funil[String(jornada)]) || 0) - 1),
        rapidez: jornada >= 1, // processos judiciais exibem o selo de ritmo
        numero: p.process_number || 'em distribuição',
        tipo: p.tipo || '',
        fase: oculta ? 'Em andamento com nossa equipe' : (st?.nome_cliente || p.etapa || ''),
        quadro: oculta ? '' : (p.quadro || ''),
        fase_texto: (st?.active !== false && st?.template) || '',
        proximos_passos: (st?.active !== false && st?.proximos_passos) || '',
        prazo_medio: st?.prazo_medio || '',
        distribuido_em: p.process_date || null,
        // contador de valor: trabalho da equipe + ultima atividade visivel
        // (#16) etapa oculta: contadores ficam, mas o nome da tarefa nao aparece
        atividades: atv ? {
          tarefas_concluidas: atv.tarefas_concluidas || 0,
          movimentos: atv.movimentos || 0,
          mov_mes: atv.mov_mes || 0,
          atv_mes: atv.atv_mes || 0,
          publicacoes: atv.publicacoes || 0,
          horas: Number(atv.horas) || 0,
          vez: atv.vez || null,            // 'escritorio' | 'tribunal' (regra: tarefa pendente => escritório)
          vez_dias: atv.vez_dias ?? null,  // dias desde o último andamento
          audiencia: oculta ? null : (atv.audiencia || null),
          ultima: oculta ? null : (atv.ultima || null),
        } : null,
        espera: oculta ? null : tipoEspera(p),   // silêncio saudável: tipo de espera
        evento,                                   // card de evento crítico recente
        andamentos,
      };
    });

    // 4) pagamentos (espelho Asaas local)
    let pendentes = [], pagos = [];
    if (cpf) {
      // asaas_boletos e restrita ao role authenticated — a RPC security definer
      // portal_boletos devolve apenas os boletos do titular do token (CPF
      // normalizado no banco), sem abrir a tabela para a chave anon.
      let bols = [];
      try { const r = await db.rpc('portal_boletos', { p_token: token }); bols = r.data || []; }
      catch (e) { console.error('[portal-data boletos]', e?.message); }
      for (const b of bols) {
        const item = {
          valor: Number(b.value) || 0,
          vencimento: b.due_date,
          pago_em: b.payment_date,
          descricao: b.description || 'Parcela de honorários',
          parcela: b.installment_number && b.installment_total ? `${b.installment_number}/${b.installment_total}` : null,
          boleto_url: b.bank_slip_url || b.invoice_url || null,
          pix: b.pix_copy_paste || null,
          nf_url: b.nf_pdf_url || null,
          vencido: b.status === 'OVERDUE' || (b.due_date && !PAGOS.has(b.status) && b.due_date < new Date().toISOString().slice(0, 10)),
          _id: b.id,
        };
        if (PAGOS.has(b.status)) pagos.push(item);
        else if (['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'].includes(b.status)) pendentes.push(item);
      }
      pagos.sort((a, b2) => String(b2.pago_em || '').localeCompare(String(a.pago_em || '')));

      // fallback: PIX faltante em pendentes -> busca ao vivo no Asaas (max 3)
      if (ASAAS_KEY) {
        const semPix = pendentes.filter(p => !p.pix && p._id).slice(0, 3);
        for (const p of semPix) {
          try {
            const r = await fetch(`https://api.asaas.com/v3/payments/${p._id}/pixQrCode`, {
              headers: { 'access_token': ASAAS_KEY },
            });
            if (r.ok) { const d = await r.json(); p.pix = d.payload || null; }
          } catch { /* segue sem pix */ }
        }
      }
      pendentes.forEach(p => delete p._id);
      pagos.forEach(p => delete p._id);
    }

    const totalPago = pagos.reduce((s, p) => s + p.valor, 0);
    const totalPendente = pendentes.reduce((s, p) => s + p.valor, 0);
    const temVencida = pendentes.some(p => p.vencido);
    // #12 agradecimento: pagamento confirmado nos ultimos 6 dias
    const ultimoPago = pagos[0];
    const pagamentoRecente = (ultimoPago && ultimoPago.pago_em && (Date.now() - Date.parse(ultimoPago.pago_em) < 6 * 86400000))
      ? { em: ultimoPago.pago_em, valor: ultimoPago.valor } : null;
    // #17 so-exito: sem honorarios iniciais e com percentual de exito
    const soExito = !!(contrato && (!contrato.honorarios_total || contrato.honorarios_total === 0) && contrato.exito_pct > 0);

    return json({
      cliente: { nome, primeiro_nome: primeiro.charAt(0) + primeiro.slice(1).toLowerCase() },
      processos,
      acordo: acordo || null,
      contrato,
      equipe: { fotos: (eqCfg?.value?.fotos || []).filter(Boolean).slice(0, 8) },
      escritorio: { tarefas_mes: tarefasMes || 0, mes: MESES[new Date().getMonth()] },
      // vigilância: prova diária de que o caso está sendo observado
      vigilancia: {
        ultima_verificacao: monitorStatus.last_run || null,
        dias_monitoramento: Math.max(1, Math.floor((Date.now() - Date.parse('2026-06-09')) / 86400000)),
        proxima_verificacao: isoDate(proximoDiaUtil(nowSP())), // próximo dia útil (#7)
      },
      recesso: recessoOuFeriado(),
      calendario_proativo: calendarioProativo(), // aviso antes de feriado/recesso
      tem_vencida: temVencida,                   // selo "nada pendente do seu lado"
      pagamento_recente: pagamentoRecente,       // #12 agradecimento
      so_exito: soExito,                         // #17 "você só paga se ganhar"
      contato: {
        whatsapp: digits((cfgMap.portal_contato || {}).whatsapp) || null,
        horario: (cfgMap.portal_contato || {}).horario || 'em horário comercial',
      },
      explicador: (Array.isArray((cfgMap.portal_explicador || {}).itens) && cfgMap.portal_explicador.itens.length)
        ? cfgMap.portal_explicador.itens : EXPLICADOR_DEFAULT,
      review_url: (cfgMap.portal_review || {}).url || null,
      faq: faq || [],
      minhas_perguntas: minhasPerguntas || [],
      push_chave: process.env.VAPID_PUBLIC_KEY || null,
      educacao: montaEducacao(cfgMap.portal_educacao),
      instituicao: instituicao || null,
      glossario: (glossary || [])
        .filter(g => g.active !== false && g.term && g.translation && String(g.term).length >= 4 && (g.match_type || 'contains') !== 'regex')
        .slice(0, 80).map(g => ({ t: g.term, d: g.translation })),
      pagamentos: {
        resumo: {
          total_pago: totalPago, total_pendente: totalPendente,
          qtd_pagos: pagos.length, qtd_pendentes: pendentes.length,
          proximo_vencimento: pendentes.find(p => !p.vencido)?.vencimento || null,
        },
        pendentes, pagos: pagos.slice(0, 24),
      },
      gerado_em: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[portal-data]', err);
    return json({ erro: 'indisponivel' }, 500);
  }
};

export const config = { path: '/.netlify/functions/portal-data' };
