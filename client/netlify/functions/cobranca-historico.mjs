/**
 * Netlify Function (HTTP): historico de disparos de cobranca para o painel.
 * Auth: BOT_PANEL_KEY (header x-bot-key ou body.key).
 *
 * Retorna 1 linha por cliente×disparo (ultimos 180 dias), ja com o status de
 * entrega do Kommo (kommo_queue.status). O painel agrupa em LOTES por
 * (disparado_por + disparado_em + template) e monta a linha do tempo + funil.
 */
import { db, logAdvbox } from './_lib/botDb.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const body = await req.json().catch(() => ({}));
  const key = req.headers.get('x-bot-key') || body.key || '';
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  try {
    const { data, error } = await db.rpc('cobranca_historico', { p_chave: RPC_SECRET });
    if (error) throw new Error(error.message);
    return json({ ok: true, rows: data || [] });
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-historico: ${e.message}`.slice(0, 200), {});
    return json({ ok: false, error: e.message }, 500);
  }
};
