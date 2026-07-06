/**
 * Netlify Function: kommo-note
 * Posta uma nota (note_type=common) num lead do Kommo de forma IDEMPOTENTE.
 * Antes de postar, busca as notas do lead e procura o `marker`; se ja existir,
 * nao duplica. Usado por:
 *   - advbox-sync       (#14 resumo do negocio ao assinar)
 *   - datajud-refresh   (#16 processo distribuido / numero do processo)
 *   - App.jsx polling   (#18 abriu o contrato e nao assinou)
 *
 * Body (JSON): { leadId? , linkKommo? , marker , text }
 *   - leadId OU linkKommo (extrai o id de .../leads/detail/{id})
 *   - marker: string curta e unica por tipo de nota (ex: "CBC.resumo")
 *   - text:   corpo da nota (o marker e anexado de forma discreta no fim)
 */

import { supa } from './_lib/supabaseClient.mjs';

const KOMMO_TOKEN = process.env.KOMMO_TOKEN || '';
const KOMMO_BASE = 'https://advocaciacbc.kommo.com/api/v4';

// (auditoria #85) cache de idempotencia no Supabase: evita paginar ate 10k notas do
// Kommo so p/ checar duplicidade. Fonte de verdade continua sendo a paginacao (fallback
// em cache-miss). Se a tabela nao existir / sem env -> retorna null (desconhecido) e cai
// na paginacao — seguro de deployar antes da migracao kommo_note_log.
async function cacheTemNota(leadId, marker) {
  if (!supa) return null;
  try {
    const { data, error } = await supa.from('kommo_note_log')
      .select('lead_id').eq('lead_id', String(leadId)).eq('marker', marker).limit(1).maybeSingle();
    if (error) return null;
    return !!data;
  } catch { return null; }
}
async function cacheRegistra(leadId, marker) {
  if (!supa) return;
  try {
    await supa.from('kommo_note_log')
      .upsert({ lead_id: String(leadId), marker, posted_at: new Date().toISOString() }, { onConflict: 'lead_id,marker' });
  } catch { /* best-effort: se falhar, a paginacao continua sendo a rede de seguranca */ }
}

function extrairLeadId(input) {
  if (!input) return null;
  const s = String(input);
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/leads\/detail\/(\d+)/);
  return m ? m[1] : null;
}

async function jaTemNota(leadId, marker) {
  // (integ-data-7) match EXATO do marcador. A nota e gravada com "— <marker>" no FIM
  // do texto; antes o JSON.stringify(...).includes(marker) casava por substring, entao
  // 'CBC.fase:Inicial' batia com 'CBC.fase:Inicial Recursal' e a nota nao era postada.
  const needle = `— ${marker}`;
  // (varredura 15/06) pagina ate achar o marcador ou esgotar — antes lia so as
  // ultimas 250 notas, entao num lead com >250 notas o marcador antigo nao era
  // encontrado e a nota era RE-postada (Kommo nao deixa apagar duplicata).
  // (#L16) teto elevado 8->40 paginas (2k->10k notas): leads muito ativos passavam
  // do limite antigo e re-postavam. O early-exit (notes.length < 250) ja encerra cedo
  // na grande maioria; o teto e so trava de seguranca contra loop infinito.
  for (let page = 1; page <= 40; page++) {
    const r = await fetch(`${KOMMO_BASE}/leads/${leadId}/notes?limit=250&page=${page}&order[id]=desc`, {
      headers: { 'Authorization': `Bearer ${KOMMO_TOKEN}` },
    });
    if (r.status === 204) return false; // lead sem (mais) notas
    if (!r.ok) throw new Error(`GET notes HTTP ${r.status}`);
    const d = await r.json();
    const notes = d?._embedded?.notes || [];
    if (notes.length === 0) return false;
    if (notes.some(n => String(n?.params?.text || '').trimEnd().endsWith(needle))) return true;
    if (notes.length < 250) return false; // ultima pagina
  }
  return false;
}

async function postNota(leadId, text) {
  const r = await fetch(`${KOMMO_BASE}/leads/${leadId}/notes`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KOMMO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ note_type: 'common', params: { text } }]),
  });
  if (!r.ok) {
    const e = await r.text().catch(() => '');
    throw new Error(`POST note HTTP ${r.status} ${e.slice(0, 150)}`);
  }
  return r.json().catch(() => ({}));
}

export default async (req) => {
  const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: { ...H, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  try {
    if (!KOMMO_TOKEN) return new Response(JSON.stringify({ ok: false, error: 'KOMMO_TOKEN ausente' }), { status: 200, headers: H });
    const { leadId, linkKommo, marker, text } = await req.json();
    const id = extrairLeadId(leadId || linkKommo);
    if (!id || !marker || !text) {
      return new Response(JSON.stringify({ ok: false, error: 'leadId/linkKommo, marker e text sao obrigatorios' }), { status: 200, headers: H });
    }
    // (auditoria #85) FAST-PATH: se o cache do Supabase ja sabe que a nota foi postada,
    // pula a paginacao cara no Kommo. Kommo nao deixa apagar nota, entao "posted" no cache
    // e sempre verdade (nunca gera falso-positivo).
    const cached = await cacheTemNota(id, marker);
    if (cached === true) {
      return new Response(JSON.stringify({ ok: true, posted: false, reason: 'nota ja existe (cache)', leadId: id }), { status: 200, headers: H });
    }
    // cache-miss ou indisponivel: pagina como fallback (fonte de verdade).
    let existe = false;
    try { existe = await jaTemNota(id, marker); }
    catch {
      // (integ-data-7) se a checagem de duplicidade falhar (429/500 transitorio), NAO
      // posta — a API do Kommo nao deixa apagar nota, entao postar viraria duplicata
      // permanente. Devolve ok:false p/ o caller re-tentar num proximo ciclo.
      return new Response(JSON.stringify({ ok: false, posted: false, reason: 'checagem de duplicidade indisponivel — nao postado p/ evitar duplicata' }), { status: 200, headers: H });
    }
    if (existe) {
      await cacheRegistra(id, marker); // backfill do cache p/ nao paginar de novo
      return new Response(JSON.stringify({ ok: true, posted: false, reason: 'nota ja existe', leadId: id }), { status: 200, headers: H });
    }
    await postNota(id, `${text}\n\n— ${marker}`);
    await cacheRegistra(id, marker);
    return new Response(JSON.stringify({ ok: true, posted: true, leadId: id }), { status: 200, headers: H });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 200, headers: H });
  }
};

export const config = { path: '/.netlify/functions/kommo-note' };
