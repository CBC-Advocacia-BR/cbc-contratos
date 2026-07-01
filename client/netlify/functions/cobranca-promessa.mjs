/**
 * Netlify Function (HTTP): promessa de pagamento (#34).
 * Auth: BOT_PANEL_KEY (header x-bot-key ou body.key).
 *
 * Body:
 *   { action: 'list' }                      -> { promessas: [{customer_cpf, data_promessa, por}] }
 *   { action: 'set', cpf, data, userEmail } -> grava (data null/'' remove a promessa do CPF)
 */
import { db, logAdvbox } from './_lib/botDb.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const digits = (s) => String(s || '').replace(/\D/g, '');
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-bot-key' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const body = await req.json().catch(() => ({}));
  const key = req.headers.get('x-bot-key') || body.key || '';
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ ok: false, error: 'unauthorized' }, 401);

  try {
    if (body.action === 'list') {
      const { data, error } = await db.rpc('cobranca_promessa_listar', { p_chave: RPC_SECRET });
      if (error) throw new Error(error.message);
      return json({ ok: true, promessas: data || [] });
    }
    // set
    const cpf = digits(body.cpf);
    if (cpf.length !== 11) return json({ ok: false, error: 'cpf invalido' }, 400);
    const data = body.data ? String(body.data).slice(0, 10) : null;
    const por = String(body.userEmail || '').slice(0, 120);
    const { data: r, error } = await db.rpc('cobranca_promessa_set', { p_chave: RPC_SECRET, p_cpf: cpf, p_data: data, p_por: por });
    if (error) throw new Error(error.message);
    await logAdvbox('asaas', 'info', `cobranca promessa ${data ? 'set ' + data : 'limpa'} cpf ***${cpf.slice(-4)}`, {});
    return json({ ok: true, ...(r || {}) });
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-promessa: ${e.message}`.slice(0, 200), {});
    return json({ ok: false, error: e.message }, 500);
  }
};
