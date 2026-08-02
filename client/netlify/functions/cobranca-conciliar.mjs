/**
 * Netlify Scheduled Function: cobranca-conciliar (12h BRT).
 * Reconcilia a conversao dos disparos: marca como RECUPERADO qualquer disparo cujo
 * cliente (CPF) tenha pago um boleto VENCIDO depois do envio. Cobre o que o webhook
 * do Asaas nao pegou (eventos perdidos). Best-effort.
 *
 * Regra (req. Paulo): "qualquer template enviado + cliente paga um boleto vencido nos
 * dias seguintes = cobranca bem-sucedida". A marcacao real (1 disparo por CPF, last-touch,
 * so boleto pago apos o vencimento) fica na RPC cobranca_marcar_pago.
 * A janela de "Recuperado" (dias <= janela_pagamento_dias) e aplicada no KPI do painel.
 *
 * (auditoria 01/08/2026 — item 99) A LOGICA saiu daqui para `_lib/conciliarCobranca.mjs`:
 * era identica a do `cobranca-conciliar-now.mjs` (o botao do painel) e, com duas copias,
 * uma correcao feita numa nunca chegava na outra — a mesma origem do bug do mapa do
 * ADVBOX. Este arquivo agora so agenda, chama e registra.
 */
import { logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { conciliarCobranca } from './_lib/conciliarCobranca.mjs';

export default async () => {
  try {
    const { marcados, candidatos, cpfsPendentes } = await conciliarCobranca();
    if (!cpfsPendentes) {
      await heartbeat('cobranca-conciliar', true, '0 pendentes');
      return new Response('ok');
    }
    await logAdvbox('asaas', 'info',
      `cobranca conciliar: ${marcados} recuperados (${candidatos} candidatos / ${cpfsPendentes} CPFs pendentes)`, {});
    await heartbeat('cobranca-conciliar', true, `${marcados} recuperados`);
  } catch (e) {
    await logAdvbox('asaas', 'erro', `cobranca-conciliar: ${e.message}`.slice(0, 300), {});
    await heartbeat('cobranca-conciliar', false, e.message);
  }
  return new Response('ok');
};

export const config = { schedule: '0 12 * * *' };
