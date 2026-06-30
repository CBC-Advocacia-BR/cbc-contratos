/**
 * Netlify Function (HTTP): roda a conciliação de cobrança SOB DEMANDA (botão do painel),
 * sem esperar o cron de 12h. Mesma lógica do cobranca-conciliar: marca como recuperado
 * qualquer disparo cujo CPF pagou um boleto vencido depois do envio.
 * Auth: BOT_PANEL_KEY (header x-bot-key ou body.key). Retorna { recuperados }.
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
    const desde = new Date(Date.now() - 45 * 86400000).toISOString();
    const desdeData = desde.slice(0, 10);
    const { data: pend, error } = await db.from('cobranca_disparos')
      .select('customer_cpf').eq('resultado', 'enfileirado').eq('pago', false).gte('disparado_em', desde);
    if (error) throw new Error(error.message);
    const cpfs = new Set((pend || []).map((p) => digits(p.customer_cpf)).filter((c) => c.length === 11));
    if (!cpfs.size) return json({ ok: true, recuperados: 0 });

    const { data: bs, error: e2 } = await db.from('asaas_boletos')
      .select('id, customer_cpf, due_date, payment_date')
      .not('payment_date', 'is', null).gte('payment_date', desdeData).limit(5000);
    if (e2) throw new Error(e2.message);

    let recuperados = 0;
    for (const b of bs || []) {
      if (!cpfs.has(digits(b.customer_cpf))) continue;
      if (!(b.due_date && b.payment_date > b.due_date)) continue;
      const { data: n } = await db.rpc('cobranca_marcar_pago', { p_chave: RPC_SECRET, p_boleto_id: b.id, p_pago_em: b.payment_date });
      recuperados += Number(n) || 0;
    }
    await logAdvbox('asaas', 'info', `cobranca conciliar-now: ${recuperados} recuperados`, {});
    return json({ ok: true, recuperados });
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-conciliar-now: ${e.message}`.slice(0, 200), {});
    return json({ ok: false, error: e.message }, 500);
  }
};
