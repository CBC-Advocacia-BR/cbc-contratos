// Leitura das agendas do Google (OAuth, somente leitura) p/ as etapas de videochamada no funil.
// Credenciais via env (GOOGLE_OAUTH_*). Módulo PURO de integração — sem Supabase aqui.
// Atendimento de venda = evento com convidado EXTERNO (≠ @advocaciacbc.com) E link de Meet.
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

/** Classifica um evento. Retorna a linha do atendimento, ou null se NÃO for atendimento de venda. */
export function classifyEvent(ev, vendedoraEmail) {
  if (!ev || ev.status === 'cancelled') return null;
  const externo = (ev.attendees || []).find((a) => a.email && !INTERNO.test(a.email) && !a.resource);
  const temMeet = !!(ev.hangoutLink || (ev.conferenceData && (ev.conferenceData.entryPoints || []).length));
  if (!externo || !temMeet) return null; // não é atendimento de venda
  const scheduledAt = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
  return {
    event_id: ev.id,
    vendedora_email: vendedoraEmail,
    cliente_email: (externo.email || '').toLowerCase(),
    cliente_nome: externo.displayName || null,
    status: COR_STATUS[ev.colorId] || 'agendada',
    color_id: ev.colorId || null,
    scheduled_at: scheduledAt,
    tem_meet: temMeet,
    raw: { summary: ev.summary || null, htmlLink: ev.htmlLink || null, colorId: ev.colorId || null },
  };
}

/** Vendedoras monitoradas (lista fixa — decisão do Paulo 26/06). */
export const VENDEDORAS = ['beatriz@advocaciacbc.com', 'marianamaciel@advocaciacbc.com', 'emerson@advocaciacbc.com', 'mizael@advocaciacbc.com'];
