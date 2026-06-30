/**
 * Fase 3 — reconciliacao do registro mestre `clientes`. Dispara a RPC
 * clientes_reconciliar (toda a logica roda no banco: upsert por CPF das 4 fontes
 * + marcacao PF/PJ + parte-contraria). Mantem o mestre fresco (deixa de ser snapshot).
 *
 * GET/scheduled = roda. POST exige key === BOT_PANEL_KEY (gatilho manual).
 */
import { db } from './_lib/botDb.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PANEL_KEY = process.env.BOT_PANEL_KEY || 'cbc-bot-2026';
const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: JSONH });
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule' || req.method === 'GET';
  if (!isScheduled) {
    const body = await req.json().catch(() => ({}));
    const key = body.key || req.headers.get('x-bot-key') || '';
    if (key !== PANEL_KEY) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSONH });
  }
  try {
    const { data, error } = await db.rpc('clientes_reconciliar', { p_chave: RPC_SECRET });
    if (error) throw new Error(error.message);
    return new Response(JSON.stringify({ ok: true, ...(data || {}) }), { headers: JSONH });
  } catch (e) {
    await logAdvbox('clientes', 'erro', `reconciliar: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: JSONH });
  }
};

// 08h30 BRT (11:30 UTC) — depois do kommo-leads-sync (11:00) e dos snapshots.
export const config = { schedule: '30 11 * * *' };
