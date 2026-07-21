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
const COR_STATUS = { '10': 'realizada', '11': 'no_show', '7': 'fechou' };

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
  if (!daAna && (!externo || !temMeet)) return null; // regra antiga preservada p/ eventos manuais
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
    raw: { summary: ev.summary || null, htmlLink: ev.htmlLink || null, colorId: ev.colorId || null },
  };
}

/** Vendedoras monitoradas (fallback quando bot_config.agenda_bot.vendedoras estiver vazio). */
export const VENDEDORAS = ['beatriz@advocaciacbc.com', 'marianamaciel@advocaciacbc.com', 'emerson@advocaciacbc.com', 'mizael@advocaciacbc.com'];

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

/** Cria evento com Google Meet + extendedProperties (marca de origem 'ana'). Lança em erro. */
export async function createEventComMeet({ calendarId, inicioISO, fimISO, titulo, descricao, leadId, telefone, nome, accessToken }) {
  const r = await fetch(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: titulo, description: descricao,
      start: { dateTime: inicioISO, timeZone: 'America/Sao_Paulo' }, end: { dateTime: fimISO, timeZone: 'America/Sao_Paulo' },
      conferenceData: { createRequest: { requestId: `cbc-ana-${leadId}-${Date.parse(inicioISO)}` } },
      extendedProperties: { private: { cbc_origem: 'ana', cbc_lead_id: String(leadId || ''), cbc_telefone: telefone || '', cbc_nome: nome || '' } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`createEvent ${calendarId}: ${j.error.message}`);
  const meetLink = j.hangoutLink || j.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null;
  return { eventId: j.id, meetLink };
}

/** Reagenda (PATCH) o horário de um evento existente. Lança em erro. */
export async function patchEventHorario({ calendarId, eventId, inicioISO, fimISO, accessToken }) {
  const r = await fetch(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: { dateTime: inicioISO, timeZone: 'America/Sao_Paulo' }, end: { dateTime: fimISO, timeZone: 'America/Sao_Paulo' } }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`patchEvent: ${j.error.message}`);
}

/** Cancela (DELETE) um evento. Tolera 404/410 (já não existe/já foi excluído). Lança em outros erros. */
export async function cancelEvent({ calendarId, eventId, accessToken }) {
  const r = await fetch(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000),
  });
  if (![200, 204, 404, 410].includes(r.status)) throw new Error(`cancelEvent HTTP ${r.status}`);
}
