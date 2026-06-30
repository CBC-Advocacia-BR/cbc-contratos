/**
 * Netlify Function: Asaas Webhook receiver
 * Triggered by Asaas when payment status changes.
 * When payment is confirmed (RECEIVED/CONFIRMED), creates an invoice (NF).
 *
 * Configure in Asaas: Integrações > Webhooks > URL: https://contratos-cbc.netlify.app/.netlify/functions/asaas-webhook
 * Events: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_RECEIVED_IN_CASH
 */

import { mirrorUpdate, mirrorUpsert, paymentRow, nfClaim, nfRelease } from './_lib/asaasMirror.mjs';
import { logAdvbox, db } from './_lib/botDb.mjs';

const ASAAS_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';
const HEADERS = { 'access_token': ASAAS_KEY, 'Content-Type': 'application/json' };

// (16/06/2026) Emissao automatica de NF: ao receber/confirmar pagamento, emite a NF
// (POST /invoices). Ficou suspensa por algumas horas em 16/06 (faltava o "Codigo de
// servico municipal" na config fiscal do Asaas); config corrigida e NFs conferidas no
// Asaas + sistema da prefeitura -> REATIVADA. Flag mantida como kill-switch: para
// desligar de novo, trocar para false e fazer deploy.
const NF_AUTOMATICA_ATIVA = true;

// Mapeia evento Asaas -> status final do boleto em asaas_boletos
const EVENT_TO_STATUS = {
  PAYMENT_RECEIVED: 'RECEIVED',
  PAYMENT_CONFIRMED: 'CONFIRMED',
  PAYMENT_RECEIVED_IN_CASH: 'RECEIVED_IN_CASH',
  PAYMENT_OVERDUE: 'OVERDUE',
  PAYMENT_DELETED: 'DELETED',
  PAYMENT_REFUNDED: 'REFUNDED',
  PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK_REQUESTED',
  PAYMENT_CHARGEBACK_DISPUTE: 'CHARGEBACK_DISPUTE',
};

async function asaasPost(path, body) {
  const resp = await fetch(`${ASAAS_URL}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  return resp.json();
}

async function asaasGet(path) {
  const resp = await fetch(`${ASAAS_URL}${path}`, { headers: HEADERS });
  return resp.json();
}

export default async (req) => {
  // Asaas sends POST with payment event data
  if (req.method === 'GET') {
    return new Response('Asaas webhook endpoint active', { status: 200 });
  }

  try {
    // (bug-8) Autenticacao do webhook. O token estava com um DEFAULT fixo no
    // codigo (publico no repo) -> qualquer um podia forjar "pagamento confirmado"
    // e disparar NF. Agora:
    //  - se ASAAS_WEBHOOK_TOKEN estiver configurado no Netlify: EXIGE match exato
    //    (o segredo do codigo deixa de ser um bypass valido);
    //  - se NAO estiver configurado: NAO quebra producao (continua processando),
    //    mas registra um aviso para o Paulo configurar a env + o painel do Asaas.
    // PENDENCIA: setar ASAAS_WEBHOOK_TOKEN (forte) no Netlify e no Asaas para fechar de vez.
    const ENV_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;
    const token = req.headers.get('asaas-access-token') || req.headers.get('access_token') || '';
    if (ENV_TOKEN) {
      if (token !== ENV_TOKEN) {
        console.log('Asaas webhook: token inválido/ausente — ignorado');
        return new Response(JSON.stringify({ ok: true, ignored: 'auth' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    } else {
      console.warn('Asaas webhook: ASAAS_WEBHOOK_TOKEN nao configurado — processando sem validacao forte (configurar no Netlify)');
      try { await logAdvbox('asaas', 'aviso', 'webhook Asaas sem ASAAS_WEBHOOK_TOKEN configurado — vulneravel a evento forjado; configurar env + painel Asaas', {}); } catch { /* best-effort */ }
    }

    const body = await req.json();
    const event = body.event;
    const payment = body.payment;

    console.log('Asaas webhook:', event, payment?.id);

    if (!payment?.id) {
      return new Response(JSON.stringify({ ok: true, noPayment: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Atualiza status no espelho para QUALQUER evento mapeado (pago, vencido,
    // estornado, chargeback, etc.) via RPC asaas_mirror_update — escrita direta
    // com anon e bloqueada por RLS e falhava em silencio.
    const newStatus = EVENT_TO_STATUS[event];
    if (newStatus) {
      try {
        const update = { status: newStatus };
        if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(newStatus)) {
          update.payment_date = payment.paymentDate || payment.clientPaymentDate || new Date().toISOString().slice(0, 10);
        }
        const n = await mirrorUpdate(payment.id, update);
        // boleto ainda nao existia no espelho (criado depois do ultimo sync) -> upsert completo
        if (!n) await mirrorUpsert([paymentRow(payment)]);
      } catch (e) {
        console.error('webhook mirror update:', e.message);
        await logAdvbox('asaas', 'erro', `webhook ${event} ${payment.id}: ${e.message}`.slice(0, 300), { event });
      }
    } else if (['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_RESTORED'].includes(event)) {
      // boleto novo/alterado em tempo real (se o webhook do Asaas enviar esses eventos)
      try { await mirrorUpsert([paymentRow(payment)]); }
      catch (e) { await logAdvbox('asaas', 'erro', `webhook ${event} ${payment.id}: ${e.message}`.slice(0, 300), { event }); }
    }

    // (cobranca 29/06) conversao em tempo real: se este boleto for o ancora de algum
    // disparo de cobranca, marca pago/pago_em. Best-effort — nao derruba o webhook/NF.
    if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(newStatus)) {
      try {
        const pagoEm = payment.paymentDate || payment.clientPaymentDate || new Date().toISOString().slice(0, 10);
        await db.rpc('cobranca_marcar_pago', { p_chave: process.env.BOT_RPC_SECRET || '', p_boleto_id: payment.id, p_pago_em: pagoEm });
      } catch (e) { await logAdvbox('asaas', 'aviso', `cobranca_marcar_pago ${payment.id}: ${e.message}`.slice(0, 200), {}); }
    }

    // (18/06/2026) Espelha o link do carne (parcelamento) no campo "Asaas" do lead
    // Kommo desse cliente, em tempo real. Best-effort: nao bloqueia nem derruba o
    // webhook/NF. So dispara quando o espelho acima mudou (status mapeado ou boleto
    // criado/alterado), pois e quando o conteudo do campo pode mudar (ex.: ultima
    // parcela paga -> "Quitado").
    if (payment.customer && (newStatus || ['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_RESTORED'].includes(event))) {
      try {
        await fetch(`${process.env.URL || 'https://contratos-cbc.netlify.app'}/.netlify/functions/kommo-asaas-sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: payment.customer, key: process.env.BOT_PANEL_KEY || 'cbc-bot-2026' }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* best-effort: a varredura 2x/dia cobre o que falhar aqui */ }
    }

    // (16/06/2026) NF automatica suspensa (ver flag NF_AUTOMATICA_ATIVA no topo). O
    // espelho de status do boleto ja foi atualizado acima; paramos antes de emitir NF.
    if (!NF_AUTOMATICA_ATIVA) {
      return new Response(JSON.stringify({ ok: true, statusUpdated: !!newStatus, nfDesativada: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Apenas confirmacoes de pagamento disparam emissao de NF
    if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'].includes(event)) {
      return new Response(JSON.stringify({ ok: true, statusUpdated: !!newStatus, skippedNF: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // (#23) Trava atomica ANTES de emitir NF — evita NF DUPLICADA quando dois eventos do
    // mesmo pagamento (RECEIVED + CONFIRMED) chegam quase juntos e ambos passam pelo check
    // de invoice abaixo. O espelho do boleto ja foi upsertado acima, entao a linha existe.
    // Best-effort: se a trava falhar (RPC indisponivel), prossegue e confia no check de
    // invoice (degrada ao comportamento anterior, nunca pior).
    let nfClaimed = true;
    try { nfClaimed = await nfClaim(payment.id); }
    catch (e) { console.error('asaas-webhook nfClaim:', e.message); nfClaimed = true; }
    if (!nfClaimed) {
      return new Response(JSON.stringify({ ok: true, nfEmEmissao: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Get payment details to find customer name
    const paymentDetail = await asaasGet(`/payments/${payment.id}`);
    let customerName = 'Cliente';
    if (paymentDetail?.customer) {
      const customerDetail = await asaasGet(`/customers/${paymentDetail.customer}`);
      customerName = customerDetail?.name || 'Cliente';
    }

    // Check if invoice already exists for this payment
    const existingInvoices = await asaasGet(`/invoices?payment=${payment.id}`);
    if (existingInvoices?.data?.length > 0) {
      console.log('Invoice already exists for payment', payment.id);
      return new Response(JSON.stringify({ ok: true, alreadyExists: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Create invoice with today as effective date (payment already confirmed)
    const today = new Date().toISOString().split('T')[0];
    const invoiceBody = {
      payment: payment.id,
      serviceDescription: `Prestação de serviços advocatícios - ${customerName}`,
      observations: `NF referente ao pagamento confirmado em ${today}`,
      effectiveDate: today,
    };

    const invoice = await asaasPost('/invoices', invoiceBody);
    console.log('Invoice created:', invoice?.id, 'for payment:', payment.id);

    // (observ-6) Antes, se a emissao de NF falhasse, o erro so ia pro console e
    // respondia "ok" — pagamento recebido e NF nunca saia, sem ninguem saber.
    // Agora registra a falha (com o id do pagamento) p/ aparecer no Monitor e
    // permitir reemissao manual. Asaas devolve {errors:[...]} ou sem id quando falha.
    if (!invoice?.id) {
      // (#23) emissao falhou -> libera a trava p/ permitir reemissao num proximo evento.
      try { await nfRelease(payment.id); } catch { /* best-effort */ }
      const motivo = invoice?.errors?.[0]?.description || invoice?.error || 'sem id retornado';
      await logAdvbox('asaas', 'erro',
        `NF NAO emitida p/ pagamento ${payment.id} (${customerName}): ${motivo}`.slice(0, 300),
        { payment_id: payment.id, event, nf_pendente: true });
    }

    return new Response(JSON.stringify({ ok: true, invoiceId: invoice?.id, nfOk: !!invoice?.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200, // Always return 200 to Asaas to prevent retries
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/.netlify/functions/asaas-webhook' };
