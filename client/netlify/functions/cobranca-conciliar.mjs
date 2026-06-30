/**
 * Netlify Scheduled Function: cobranca-conciliar (12h BRT).
 * Reconcilia a conversao dos disparos: marca como RECUPERADO qualquer disparo cujo
 * cliente (CPF) tenha pago um boleto VENCIDO depois do envio. Cobre o que o webhook
 * do Asaas nao pegou (eventos perdidos). Best-effort.
 *
 * Regra (req. Paulo): "qualquer template enviado + cliente paga um boleto vencido nos
 * dias seguintes = cobranca bem-sucedida". A marcacao real (1 disparo por CPF, last-touch,
 * so boleto pago apos o vencimento) fica na RPC cobranca_marcar_pago; aqui so varremos os
 * boletos pagos recentes dos CPFs que tem disparo pendente e chamamos a RPC por boleto.
 * A janela de "Recuperado" (dias <= janela_pagamento_dias) e aplicada no KPI do painel.
 */
import { db, logAdvbox, heartbeat } from './_lib/botDb.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const digits = (s) => String(s || '').replace(/\D/g, '');

export default async () => {
  let marcados = 0, candidatos = 0;
  try {
    const desde = new Date(Date.now() - 45 * 86400000).toISOString();
    const desdeData = desde.slice(0, 10);

    // CPFs com disparo ainda pendente (enfileirado, nao pago) nos ultimos 45 dias
    const { data: pend, error } = await db.from('cobranca_disparos')
      .select('customer_cpf')
      .eq('resultado', 'enfileirado').eq('pago', false)
      .gte('disparado_em', desde);
    if (error) throw new Error(error.message);
    const cpfs = new Set((pend || []).map((p) => digits(p.customer_cpf)).filter((c) => c.length === 11));
    if (!cpfs.size) {
      await heartbeat('cobranca-conciliar', true, '0 pendentes');
      return new Response('ok');
    }

    // boletos pagos recentemente (espelho Asaas) — filtramos vencido-pago + CPF na RPC/JS
    const { data: bs, error: e2 } = await db.from('asaas_boletos')
      .select('id, customer_cpf, due_date, payment_date')
      .not('payment_date', 'is', null)
      .gte('payment_date', desdeData)
      .limit(5000);
    if (e2) throw new Error(e2.message);

    for (const b of bs || []) {
      if (!cpfs.has(digits(b.customer_cpf))) continue;          // so CPFs com disparo pendente
      if (!(b.due_date && b.payment_date > b.due_date)) continue; // so boleto VENCIDO pago
      candidatos++;
      const { data: n } = await db.rpc('cobranca_marcar_pago', { p_chave: RPC_SECRET, p_boleto_id: b.id, p_pago_em: b.payment_date });
      marcados += Number(n) || 0;
    }

    await logAdvbox('asaas', 'info', `cobranca conciliar: ${marcados} recuperados (${candidatos} candidatos / ${cpfs.size} CPFs pendentes)`, {});
    await heartbeat('cobranca-conciliar', true, `${marcados} recuperados`);
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-conciliar: ${e.message}`.slice(0, 300), {});
    await heartbeat('cobranca-conciliar', false, e.message);
  }
  return new Response('ok');
};

export const config = { schedule: '0 12 * * *' };
