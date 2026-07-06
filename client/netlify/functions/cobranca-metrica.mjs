/**
 * Netlify Function (HTTP GET): metrica de ENVIO AUTOMATICO de boleto pela cobranca.
 * Auth: BOT_PANEL_KEY (header x-bot-key ou ?key=). Query: ?dias=7 (default).
 *
 * Retorna, dos disparos de cobranca dos ultimos N dias (via kommo_queue):
 *   { total, entregues, erros, pendentes, ultimo, ultimo_erro }
 * Usado pela aba Boletos para mostrar se o boleto esta sendo enviado automaticamente
 * pelo bot (entregue) ou dando erro. (cobranca 06/07/2026)
 */
import { db } from './_lib/botDb.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const url = new URL(req.url);
  const key = req.headers.get('x-bot-key') || url.searchParams.get('key') || '';
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  const dias = Math.min(90, Math.max(1, parseInt(url.searchParams.get('dias') || '7', 10) || 7));
  try {
    const { data, error } = await db.rpc('cobranca_metrica_envio', { p_chave: RPC_SECRET, p_dias: dias });
    if (error) throw new Error(error.message);
    const m = (Array.isArray(data) ? data[0] : data) || {};
    return json({
      ok: true, dias,
      total: m.total || 0,
      entregues: m.entregues || 0,
      erros: m.erros || 0,
      pendentes: m.pendentes || 0,
      ultimo: m.ultimo || null,
      ultimo_erro: m.ultimo_erro || null,
    });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
};
