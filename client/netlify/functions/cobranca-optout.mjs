/**
 * Netlify Function (HTTP): marca/desmarca um devedor como "nao perturbe" (opt-out).
 * Auth: BOT_PANEL_KEY (header x-bot-key ou body.key).
 *
 * Body: { cpf: string, on: boolean }
 * Grava em bot_config.cobranca.optout_cpfs (via RPC cobranca_optout_set, SECURITY DEFINER).
 * Quando on=true, o avaliarElegibilidade (cobranca-listar/disparar) passa a pular esse
 * CPF com motivo 'opt_out' — mesmo que o operador o selecione, NAO sera enviado.
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { digits } from './_lib/cobranca.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const body = await req.json().catch(() => ({}));
  const key = req.headers.get('x-bot-key') || body.key || '';
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  const cpf = digits(body.cpf);
  const on = body.on === true;
  if (cpf.length !== 11) return json({ ok: false, error: 'cpf invalido' }, 400);

  try {
    const { data, error } = await db.rpc('cobranca_optout_set', { p_chave: RPC_SECRET, p_cpf: cpf, p_on: on });
    if (error) throw new Error(error.message);
    await logAdvbox('asaas', 'info', `cobranca opt-out ${on ? 'ON' : 'OFF'} cpf ***${cpf.slice(-4)}`, {});
    return json({ ok: true, ...(data || {}) });
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-optout: ${e.message}`.slice(0, 200), {});
    return json({ ok: false, error: e.message }, 500);
  }
};
