/**
 * Netlify Scheduled Function: cobranca-conciliar (12h BRT).
 * Reconcilia a conversao dos disparos: para cada disparo 'enfileirado' ainda nao pago,
 * se o boleto-ancora ja consta com payment_date no espelho, marca pago/pago_em.
 * Cobre o que o webhook do Asaas nao pegou (eventos perdidos). Best-effort.
 */
import { db, logAdvbox, heartbeat } from './_lib/botDb.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

export default async () => {
  let ancoras = 0, marcados = 0;
  try {
    const desde = new Date(Date.now() - 45 * 86400000).toISOString();
    const { data: pend, error } = await db.from('cobranca_disparos')
      .select('boleto_ancora_id')
      .eq('resultado', 'enfileirado').eq('pago', false)
      .not('boleto_ancora_id', 'is', null)
      .gte('disparado_em', desde);
    if (error) throw new Error(error.message);

    const ids = [...new Set((pend || []).map((p) => p.boleto_ancora_id))];
    ancoras = ids.length;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data: bs } = await db.from('asaas_boletos')
        .select('id, payment_date').in('id', chunk).not('payment_date', 'is', null);
      for (const b of bs || []) {
        const { data: n } = await db.rpc('cobranca_marcar_pago', { p_chave: RPC_SECRET, p_boleto_id: b.id, p_pago_em: b.payment_date });
        if (n) marcados += Number(n) || 0;
      }
    }
    await logAdvbox('asaas', 'info', `cobranca conciliar: ${marcados} marcados pagos (${ancoras} ancoras pendentes)`, {});
    await heartbeat('cobranca-conciliar', true, `${marcados} pagos`);
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-conciliar: ${e.message}`.slice(0, 300), {});
    await heartbeat('cobranca-conciliar', false, e.message);
  }
  return new Response('ok');
};

export const config = { schedule: '0 12 * * *' };
