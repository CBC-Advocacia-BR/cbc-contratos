// Leitura E escrita das agendas do Google (OAuth) p/ as etapas de videochamada no funil.
// Credenciais via env (GOOGLE_OAUTH_*). Módulo PURO de integração — sem Supabase aqui.
// Atendimento de venda = evento com convidado EXTERNO (≠ @advocaciacbc.com) E link de Meet
// (agendamento manual), OU evento marcado via extendedProperties.private.cbc_origem='ana'
// (agendado pela Ana — sem convidado externo no Calendar). Ver classifyEvent().
// Status pela cor do evento (colorId): Manjericão(10)=realizada, Tomate(11)=no-show,
// Pavão(7)=fechou, padrão=agendada.

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_URL = 'https://www.googleapis.com/calendar/v3';

const INTERNO = /@advocaciacbc\.com$/i;
// Exportado (Task 10, agenda-admin.mjs): a acao 'desfecho' deriva o colorId a partir do MESMO
// mapa (invertido), em vez de duplicar os 3 pares status<->cor em outro arquivo.
export const COR_STATUS = { '10': 'realizada', '11': 'no_show', '7': 'fechou' };

/** Renova o access token a partir do refresh token (env). */
export async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) throw new Error('GOOGLE_OAUTH_* nao configurado no ambiente');
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('falha ao renovar token Google: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

/** Lê TODOS os eventos de uma agenda na janela [timeMin, timeMax] — paginado. */
export async function listEvents(calendarId, timeMin, timeMax, accessToken) {
  const out = [];
  let pageToken = null;
  let guard = 0;
  do {
    const u = new URL(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events`);
    u.searchParams.set('singleEvents', 'true');
    u.searchParams.set('maxResults', '250');
    u.searchParams.set('timeMin', timeMin);
    u.searchParams.set('timeMax', timeMax);
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (j.error) throw new Error(`calendar ${calendarId}: ${j.error.message}`);
    out.push(...(j.items || []));
    pageToken = j.nextPageToken || null;
  } while (pageToken && ++guard < 40); // trava de seguranca (40 paginas = 10k eventos)
  return out;
}

/**
 * Endereço do Meet do evento.
 *
 * O `hangoutLink` é o campo direto, mas nem todo evento com conferência o traz:
 * quando a conferência é criada pela API, o endereço só aparece em
 * `conferenceData.entryPoints`, no ponto de entrada de vídeo. Por isso as duas
 * fontes, nesta ordem.
 */
export function linkDoMeet(ev) {
  if (ev?.hangoutLink) return ev.hangoutLink;
  const pontos = ev?.conferenceData?.entryPoints || [];
  const video = pontos.find((p) => p.entryPointType === 'video' && p.uri);
  return video ? video.uri : null;
}

/** Classifica um evento. Retorna a linha do atendimento, ou null se NÃO for atendimento de venda.
 *  Duas origens contam: (a) convidado EXTERNO + link de Meet (agendamento manual, regra antiga);
 *  (b) evento marcado pela Ana via extendedProperties.private.cbc_origem='ana' (sem convidado
 *  externo — a Ana não convida o cliente no Calendar, so usa o Meet). */
export function classifyEvent(ev, vendedoraEmail) {
  if (!ev || ev.status === 'cancelled') return null;
  const priv = ev.extendedProperties?.private || {};
  const daAna = priv.cbc_origem === 'ana';
  const externo = (ev.attendees || []).find((a) => a.email && !INTERNO.test(a.email) && !a.resource);
  const temMeet = !!(ev.hangoutLink || (ev.conferenceData && (ev.conferenceData.entryPoints || []).length));
  // Contrato explícito (intencional, não é bug): evento da Ana (daAna=true) NUNCA é descartado
  // aqui, mesmo sem convidado externo e sem Meet — `tem_meet` fica `false` na linha, mas o
  // atendimento aparece no painel. Visibilidade no painel > invisibilidade: é preferível a
  // equipe ver um agendamento da Ana sem Meet (ex.: createEventComMeet falhou ao criar a
  // conferência, ou o campo ainda não propagou) do que ele sumir silenciosamente do funil.
  // Só eventos manuais (daAna=false) continuam exigindo convidado externo + Meet (regra antiga
  // preservada, byte a byte, para esse ramo).
  if (!daAna && (!externo || !temMeet)) return null;
  const scheduledAt = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
  return {
    event_id: ev.id, vendedora_email: vendedoraEmail,
    cliente_email: (externo?.email || '').toLowerCase() || null,
    cliente_nome: externo?.displayName || priv.cbc_nome || null,
    status: COR_STATUS[ev.colorId] || 'agendada', color_id: ev.colorId || null,
    scheduled_at: scheduledAt, tem_meet: temMeet,
    origem: daAna ? 'ana' : 'manual',
    lead_id: priv.cbc_lead_id ? Number(priv.cbc_lead_id) : null,
    telefone: priv.cbc_telefone || null,
    // (12/08/2026) `meetLink` entra no raw, e não numa coluna nova, de propósito:
    // o upsert já grava o raw inteiro e o sobrescreve a cada rodada, então em até
    // 15 minutos TODOS os eventos da janela passam a ter o link, sem migração e
    // sem mexer na RPC. É o que sustenta o botão "Entrar na videochamada" do
    // lembrete do dia: sem ele o lembrete perde justamente o que importa.
    raw: {
      summary: ev.summary || null,
      htmlLink: ev.htmlLink || null,
      colorId: ev.colorId || null,
      meetLink: linkDoMeet(ev),
    },
  };
}

/**
 * Vendedoras monitoradas (lista fixa).
 * 26/06/2026: Beatriz, Mariana Maciel, Emerson e Mizael.
 * 12/08/2026 (decisão do Paulo): entra Ana Piva (anacristina@); sai Mizael, que
 * não tinha nenhum atendimento nos 90 dias anteriores.
 * Serve de fallback quando bot_config.agenda_bot.vendedoras estiver vazio/ausente.
 */
export const VENDEDORAS = ['beatriz@advocaciacbc.com', 'marianamaciel@advocaciacbc.com', 'emerson@advocaciacbc.com', 'anacristina@advocaciacbc.com'];

/** free/busy em lote. Retorna { email: [{start,end}] } (agendas com erro => []). */
export async function freeBusy(emails, timeMin, timeMax, accessToken) {
  const r = await fetch(`${CAL_URL.replace('/calendar/v3', '')}/calendar/v3/freeBusy`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, items: emails.map((id) => ({ id })) }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`freeBusy: ${j.error.message}`);
  const out = {};
  for (const e of emails) out[e] = j.calendars?.[e]?.errors ? [] : (j.calendars?.[e]?.busy || []);
  return out;
}

/** Cria evento com Google Meet + extendedProperties (marca de origem 'ana'). Lança em erro.
 *  `convidados` (Task 9, SDR de IA Ana): lista de e-mails convidados ao evento (o lead, ao
 *  agendar via Ana) — quando não vazia, pede `sendUpdates=all` p/ o Google mandar o convite. */
export async function createEventComMeet({ calendarId, inicioISO, fimISO, titulo, descricao, leadId, telefone, nome, accessToken, convidados = [] }) {
  const url = `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1${convidados.length ? '&sendUpdates=all' : ''}`;
  const r = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: titulo, description: descricao,
      start: { dateTime: inicioISO, timeZone: 'America/Sao_Paulo' }, end: { dateTime: fimISO, timeZone: 'America/Sao_Paulo' },
      ...(convidados.length ? { attendees: convidados.map((email) => ({ email })) } : {}),
      // Nonce (Date.now().toString(36)) evita colisão de requestId quando um slot é cancelado e
      // recriado em seguida para o mesmo leadId+horário — sem o nonce, o Google trataria o
      // segundo POST como idempotente ao primeiro (mesmo requestId) e devolveria a conferência
      // JÁ CANCELADA em vez de criar uma nova.
      conferenceData: { createRequest: { requestId: `cbc-ana-${leadId}-${Date.parse(inicioISO)}-${Date.now().toString(36)}` } },
      extendedProperties: { private: { cbc_origem: 'ana', cbc_lead_id: String(leadId || ''), cbc_telefone: telefone || '', cbc_nome: nome || '' } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`createEvent ${calendarId}: ${j.error.message}`);
  const meetLink = j.hangoutLink || j.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null;
  return { eventId: j.id, meetLink };
}

/** Reagenda (PATCH) o horário de um evento existente. Lança em erro.
 *  notificar=true envia e-mail aos convidados (usado pela Ana, cujo lead e convidado); painel/admin mantem o padrao silencioso. */
export async function patchEventHorario({ calendarId, eventId, inicioISO, fimISO, accessToken, notificar = false }) {
  const url = `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}${notificar ? '?sendUpdates=all' : ''}`;
  const r = await fetch(url, {
    method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: { dateTime: inicioISO, timeZone: 'America/Sao_Paulo' }, end: { dateTime: fimISO, timeZone: 'America/Sao_Paulo' } }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`patchEvent: ${j.error.message}`);
}

/** Marca o desfecho (PATCH do colorId) de um evento existente. Mesmo padrão de patchEventHorario
 *  (sem checar r.ok — só j.error — e sem tolerância especial de status HTTP). Usado pela ação
 *  'desfecho' de agenda-admin.mjs (10=realizada, 11=no_show, 7=fechou — ver COR_STATUS acima);
 *  o agenda-videochamadas-sync.mjs espelha a cor -> status na próxima rodada (até 45min).
 *  colorId null/undefined LIMPA a cor do evento (usado ao reagendar — revisão final #2): manda
 *  `{ colorId: null }` (JSON null de verdade) no corpo. Antes fazia `String(colorId)` sempre —
 *  com null isso virava a STRING "null", que o Google rejeitaria (não é um colorId válido
 *  1-11), lançando erro em vez de limpar a cor. */
export async function setEventColor({ calendarId, eventId, colorId, accessToken }) {
  const corpo = { colorId: colorId === null || colorId === undefined ? null : String(colorId) };
  const r = await fetch(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`setEventColor: ${j.error.message}`);
}

/** Cancela (DELETE) um evento. Tolera 404/410 (já não existe/já foi excluído). Lança em outros erros.
 *  notificar=true envia e-mail aos convidados (usado pela Ana, cujo lead e convidado); painel/admin mantem o padrao silencioso. */
export async function cancelEvent({ calendarId, eventId, accessToken, notificar = false }) {
  const url = `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}${notificar ? '?sendUpdates=all' : ''}`;
  const r = await fetch(url, {
    method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000),
  });
  if (![200, 204, 404, 410].includes(r.status)) throw new Error(`cancelEvent HTTP ${r.status}`);
}