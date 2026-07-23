// Classificacao de comparecimento/no-show a partir dos eventos call_ended do log de
// auditoria do Meet (Admin Reports API, applicationName=meet). Reutiliza o mesmo OAuth
// da agenda (getAccessToken de googleAgenda.mjs) — o refresh token e estendido com o
// escopo admin.reports.audit.readonly. Interno = e-mail @advocaciacbc.com OU is_external=false;
// cliente = qualquer outro (inclui anonimo/telefone). Compareceu = cliente > LIMIAR_SEG.
import { getAccessToken } from './googleAgenda.mjs';
export { getAccessToken };

export const LIMIAR_SEG = 300; // 5 min
export const INTERNO_RE = /@advocaciacbc\.com$/i;
export const REPORTS_URL = 'https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/meet';

/** Achata os parametros (name/value|intValue|boolValue) de um evento num objeto. */
function paramMap(ev) {
  const m = {};
  for (const p of (ev.parameters || [])) {
    m[p.name] = p.value !== undefined ? p.value
      : (p.intValue !== undefined ? p.intValue
      : (p.boolValue !== undefined ? p.boolValue : null));
  }
  return m;
}

/** Une intervalos [ini,fim] (epoch s) e devolve o total de segundos cobertos (sem dupla contagem). */
export function uniaoSegundos(intervalos) {
  const ivs = (intervalos || []).filter((iv) => iv && iv.length === 2 && iv[1] > iv[0]).sort((a, b) => a[0] - b[0]);
  let total = 0, curIni = null, curFim = null;
  for (const [ini, fim] of ivs) {
    if (curFim === null || ini > curFim) { if (curFim !== null) total += curFim - curIni; curIni = ini; curFim = fim; }
    else if (fim > curFim) curFim = fim;
  }
  if (curFim !== null) total += curFim - curIni;
  return total;
}

/**
 * Agrupa os call_ended por calendar_event_id. Retorna { [calId]: {
 *   participantes:[{id,interno,seg,entrou}], cliente_seg, cliente_esperou_seg } }.
 * - cliente_seg = UNIAO dos intervalos de presenca dos externos (robusto a re-entradas e a
 *   varios clientes; se nao houver timestamps, cai para a maior soma por participante).
 * - cliente_esperou_seg = tempo que o cliente ficou na sala ANTES do 1o interno (vendedor) entrar
 *   (0 = vendedor entrou primeiro; presenca total do cliente se o vendedor nunca entrou; null = sem externo).
 */
export function classifyMeetItems(items) {
  const byCal = {};
  for (const it of (items || [])) {
    for (const ev of (it.events || [])) {
      if (ev.name && ev.name !== 'call_ended') continue;
      const m = paramMap(ev);
      const cal = m['calendar_event_id'];
      if (!cal) continue;
      const id = m['identifier'] || (it.actor && it.actor.email) || 'anon';
      const seg = parseInt(m['duration_seconds'] || 0, 10) || 0;
      const ini = parseInt(m['start_timestamp_seconds'] || 0, 10) || 0;
      const interno = (typeof id === 'string' && INTERNO_RE.test(id)) || m['is_external'] === false;
      const bucket = (byCal[cal] = byCal[cal] || { _p: {} });
      const cur = (bucket._p[id] = bucket._p[id] || { id, interno, seg: 0, sessoes: [] });
      cur.seg += seg;
      if (ini > 0 && seg > 0) cur.sessoes.push([ini, ini + seg]);
    }
  }
  const entrada = (p) => (p.sessoes.length ? Math.min(...p.sessoes.map((s) => s[0])) : null);
  const saida = (p) => (p.sessoes.length ? Math.max(...p.sessoes.map((s) => s[1])) : null);
  for (const cal of Object.keys(byCal)) {
    const parts = Object.values(byCal[cal]._p);
    const externos = parts.filter((p) => !p.interno);
    const internos = parts.filter((p) => p.interno);
    // presenca do cliente: uniao dos intervalos dos externos; fallback = maior soma por participante
    const uniao = uniaoSegundos(externos.flatMap((p) => p.sessoes));
    const cliente_seg = uniao > 0 ? uniao : externos.reduce((a, p) => Math.max(a, p.seg), 0);
    // espera do cliente pelo vendedor
    const extEntradas = externos.map(entrada).filter((x) => x != null);
    const intEntradas = internos.map(entrada).filter((x) => x != null);
    const extSaidas = externos.map(saida).filter((x) => x != null);
    let cliente_esperou_seg = null;
    if (extEntradas.length) {
      const primeiroExt = Math.min(...extEntradas);
      if (intEntradas.length) cliente_esperou_seg = Math.max(0, Math.min(Math.min(...intEntradas), Math.max(...extSaidas)) - primeiroExt);
      else if (extSaidas.length) cliente_esperou_seg = Math.max(0, Math.max(...extSaidas) - primeiroExt);
    }
    byCal[cal] = {
      participantes: parts.map((p) => ({ id: p.id, interno: p.interno, seg: p.seg, entrou: entrada(p) })),
      cliente_seg,
      cliente_esperou_seg,
    };
  }
  return byCal;
}

/** 'realizada' se um cliente ficou mais que o limiar; senao 'no_show'. */
export function deriveMeetStatus(entry, limiar = LIMIAR_SEG) {
  return entry && entry.cliente_seg > limiar ? 'realizada' : 'no_show';
}

/** Monta a URL do activities.list (applicationName=meet, eventName=call_ended). */
export function buildMeetUrl(startISO, endISO, pageToken) {
  const u = new URL(REPORTS_URL);
  u.searchParams.set('eventName', 'call_ended');
  u.searchParams.set('maxResults', '1000');
  if (startISO) u.searchParams.set('startTime', startISO);
  if (endISO) u.searchParams.set('endTime', endISO);
  if (pageToken) u.searchParams.set('pageToken', pageToken);
  return u.toString();
}

/** Pagina todos os call_ended da janela [startISO, endISO]. */
export async function listMeetCallEnded(accessToken, startISO, endISO) {
  const out = [];
  let pageToken = null;
  let guard = 0;
  do {
    const r = await fetch(buildMeetUrl(startISO, endISO, pageToken), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (j.error) throw new Error(`meet reports: ${j.error.message || JSON.stringify(j.error)}`);
    out.push(...(j.items || []));
    pageToken = j.nextPageToken || null;
  } while (pageToken && ++guard < 50);
  return out;
}
