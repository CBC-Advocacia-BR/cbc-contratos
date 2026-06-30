/**
 * Netlify Function: Asaas integration
 * Actions: create-customer, find-customer, create-payment, list-payments, list-invoices
 */
import { createClient } from '@supabase/supabase-js';

const ASAAS_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';
const HEADERS = { 'access_token': ASAAS_KEY, 'Content-Type': 'application/json' };

// (16/06/2026) Emissao automatica de NF (scheduleInvoice). Ficou suspensa por algumas
// horas em 16/06 por falta do "Codigo de servico municipal" na config fiscal do Asaas;
// config corrigida e NFs conferidas (Asaas + prefeitura) -> REATIVADA. Flag mantida
// como kill-switch: para desligar, trocar para false e fazer deploy.
const NF_AUTOMATICA_ATIVA = true;

// (fix C 01/06/2026) Supabase client para gravar em asaas_error_log quando algo falha.
const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function logError(source, message, context = {}) {
  try {
    await supabase.from('asaas_error_log').insert({ source, message, context });
  } catch { /* nao bloqueia o flow se logging falhar */ }
}

// (chatguru removal 2026-05) sendChatGuruMessage + CHATGURU_* removidos.
// Comunicacao de boleto criado agora e manual via conversa Kommo.

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

async function asaasGet(path) {
  const resp = await fetch(`${ASAAS_URL}${path}`, { headers: HEADERS });
  return resp.json();
}

async function asaasPost(path, body) {
  const resp = await fetch(`${ASAAS_URL}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data.errors || data));
  return data;
}

// Find customer by CPF
async function findCustomer(cpf) {
  const clean = cpf.replace(/\D/g, '');
  const result = await asaasGet(`/customers?cpfCnpj=${clean}`);
  return result.data?.length > 0 ? result.data[0] : null;
}

// Create customer
async function createCustomer(c) {
  const body = {
    name: c.nome,
    cpfCnpj: (c.cpf || '').replace(/\D/g, ''),
    email: c.email || undefined,
    mobilePhone: (c.telefone || '').replace(/\D/g, ''),
    address: c.endereco || undefined,
    addressNumber: c.numero || undefined,
    province: c.bairro || undefined,
    postalCode: (c.cep || '').replace(/\D/g, ''),
    notificationDisabled: false,
  };
  return await asaasPost('/customers', body);
}

// Create installment payment
async function createPayment(customerId, honorarios, contractId, description) {
  const total = Number(honorarios.total) || 0;
  const parcelas = Number(honorarios.parcelas) || 1;
  const dueDate = honorarios.dataPrimeiraParcela; // YYYY-MM-DD

  if (!dueDate || total <= 0) throw new Error('Dados de honorários inválidos: total e data primeira parcela são obrigatórios.');

  // (fix A 01/06/2026) Valida data >= hoje. Sem isto, ASAAS rejeitava silenciosamente
  // (vide caso Celso Moreira de Paiva — customer criado, payment falhou pq data passada).
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T12:00:00');
  if (due < today) {
    throw new Error(`Data de vencimento já passou (${dueDate}). Atualize "Data primeira parcela" no contrato e tente novamente.`);
  }

  const body = {
    customer: customerId,
    billingType: 'BOLETO', // Boleto + PIX automatico (sem cartao de credito)
    dueDate,
    description: description || 'Honorários advocatícios - CBC',
    externalReference: contractId || undefined,
    fine: { value: 10, type: 'PERCENTAGE' },
    interest: { value: 1 },
  };

  if (parcelas > 1) {
    body.totalValue = total;
    body.installmentCount = parcelas;
  } else {
    body.value = total;
  }

  return await asaasPost('/payments', body);
}

// Schedule invoice for payment (nota fiscal on payment confirmation)
async function scheduleInvoice(paymentId, customerName) {
  if (!NF_AUTOMATICA_ATIVA) return null; // NF suspensa em 16/06/2026 (ver flag no topo)
  try {
    const body = {
      payment: paymentId,
      serviceDescription: `Prestação de serviços advocatícios - ${customerName}`,
      observations: 'NF emitida automaticamente após confirmação de pagamento.',
      effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION', // Emitir SOMENTE após pagamento
    };
    return await asaasPost('/invoices', body);
  } catch {
    return null;
  }
}

// List payments for a customer or by external reference
async function listPayments(query) {
  let path = '/payments?limit=100';
  if (query.customerId) path += `&customer=${query.customerId}`;
  if (query.externalReference) path += `&externalReference=${query.externalReference}`;
  if (query.dateCreatedGe) path += `&dateCreated[ge]=${query.dateCreatedGe}`;
  if (query.dateCreatedLe) path += `&dateCreated[le]=${query.dateCreatedLe}`;
  if (query.status) path += `&status=${query.status}`;
  return await asaasGet(path);
}

import { checkRateLimit, rateLimitResponse } from './rate-limit.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const rl = checkRateLimit(req);
  if (!rl.allowed) return rateLimitResponse();

  try {
    const { action, ...payload } = await req.json();

    switch (action) {
      case 'find-customer': {
        const customer = await findCustomer(payload.cpf);
        return new Response(JSON.stringify({ success: true, customer }), { headers: CORS });
      }

      case 'create-customer': {
        let customer = await findCustomer(payload.contratante.cpf);
        if (!customer) {
          customer = await createCustomer(payload.contratante);
        }
        return new Response(JSON.stringify({ success: true, customer, existing: !!customer.id }), { headers: CORS });
      }

      case 'create-payment': {
        // Find or create customer
        const c = payload.contratante;
        let customer = await findCustomer(c.cpf);
        if (!customer) customer = await createCustomer(c);

        const clientName = c.nome;
        const resort = payload.resort || '';
        const desc = `Honorários iniciais referentes ao processo de distrato contra ${resort} - ${clientName}`;

        // (fix D 01/06/2026) Tenta criar payment dentro de try/catch separado.
        // Se falhar, retornamos customer.id mesmo assim — pra que o frontend possa
        // gravar `asaas_customer_id` no banco e nao gerar customer orfao no Asaas
        // (vide caso Celso: customer criado mas DB sem registro porque payment falhou).
        let payment;
        try {
          payment = await createPayment(customer.id, payload.honorarios, payload.contractId, desc);
        } catch (paymentErr) {
          // (fix C 01/06/2026) Loga erro em asaas_error_log para troubleshoot.
          await logError('asaas-sync:create-payment', paymentErr.message, {
            contractId: payload.contractId,
            cpf: c.cpf,
            customerId: customer.id,
            honorarios: payload.honorarios,
          });
          // Retorna customer mas com payment_error para que UI saiba e grave customer_id.
          return new Response(JSON.stringify({
            success: false,
            customer,
            payment_error: paymentErr.message,
            error: paymentErr.message,
          }), { headers: CORS });
        }

        return new Response(JSON.stringify({
          success: true,
          customer,
          payment,
          installmentId: payment.installment || null,
        }), { headers: CORS });
      }

      case 'list-payments': {
        const result = await listPayments(payload);
        return new Response(JSON.stringify({ success: true, ...result }), { headers: CORS });
      }

      case 'list-invoices': {
        // Lista NFs de um pagamento ou installment
        let path = '/invoices?limit=100';
        if (payload.paymentId) path += `&payment=${payload.paymentId}`;
        if (payload.installmentId) path += `&installment=${payload.installmentId}`;
        if (payload.customerId) path += `&customer=${payload.customerId}`;
        const result = await asaasGet(path);
        return new Response(JSON.stringify({ success: true, ...result }), { headers: CORS });
      }

      case 'get-installment-details': {
        // Busca pagamentos + NFs de um installment de uma vez (para drawer)
        const installmentId = payload.installmentId;
        if (!installmentId) return new Response(JSON.stringify({ error: 'installmentId required' }), { status: 400, headers: CORS });
        const [payments, invoices] = await Promise.all([
          asaasGet(`/payments?installment=${installmentId}&limit=100`),
          asaasGet(`/invoices?installment=${installmentId}&limit=100`),
        ]);
        return new Response(JSON.stringify({
          success: true,
          payments: payments.data || [],
          invoices: invoices.data || [],
        }), { headers: CORS });
      }

      case 'list-month': {
        // List all payments created this month
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const dateGe = `${year}-${month}-01`;
        const nextMonth = now.getMonth() === 11 ? `${year + 1}-01-01` : `${year}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;
        const result = await asaasGet(`/payments?limit=100&dateCreated[ge]=${dateGe}&dateCreated[le]=${nextMonth}&order=desc`);
        return new Response(JSON.stringify({ success: true, ...result }), { headers: CORS });
      }

      case 'create-single': {
        // Create single custom billing (boleto avulso)
        let customer = await findCustomer(payload.cpf);
        if (!customer && payload.contratante) customer = await createCustomer(payload.contratante);
        if (!customer) throw new Error('Cliente não encontrado');

        const body = {
          customer: customer.id,
          billingType: 'BOLETO',
          value: Number(payload.value),
          dueDate: payload.dueDate,
          description: payload.description || 'Cobrança avulsa - CBC',
          externalReference: payload.contractId || undefined,
          fine: { value: 10, type: 'PERCENTAGE' },
          interest: { value: 1 },
        };
        const payment = await asaasPost('/payments', body);
        await scheduleInvoice(payment.id, customer.name || '');
        return new Response(JSON.stringify({ success: true, customer, payment }), { headers: CORS });
      }

      case 'schedule-invoices': {
        // Schedule NF for existing payments (by customer ID or installment ID)
        let payments = [];
        if (payload.installmentId) {
          const result = await asaasGet(`/payments?installment=${payload.installmentId}`);
          payments = result.data || [];
        } else if (payload.customerId) {
          const result = await asaasGet(`/payments?customer=${payload.customerId}&status=PENDING`);
          payments = result.data || [];
        }
        const results = [];
        for (const p of payments) {
          const inv = await scheduleInvoice(p.id, payload.customerName || 'Cliente');
          results.push({ paymentId: p.id, invoice: inv, dueDate: p.dueDate });
        }
        return new Response(JSON.stringify({ success: true, scheduled: results.length, results }), { headers: CORS });
      }

      case 'create-single-payment': {
        // Create a single custom payment (boleto avulso)
        let customer = await findCustomer(payload.cpf);
        if (!customer && payload.contratante) customer = await createCustomer(payload.contratante);
        if (!customer) return new Response(JSON.stringify({ error: 'Cliente não encontrado' }), { status: 400, headers: CORS });

        const body = {
          customer: customer.id,
          billingType: 'BOLETO',
          value: Number(payload.value),
          dueDate: payload.dueDate,
          description: payload.description || 'Cobrança avulsa - CBC',
          fine: { value: 10, type: 'PERCENTAGE' },
          interest: { value: 1 },
        };
        const payment = await asaasPost('/payments', body);
        const inv = await scheduleInvoice(payment.id, payload.customerName || 'Cliente');
        return new Response(JSON.stringify({ success: true, payment, invoice: inv }), { headers: CORS });
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: CORS });
    }
  } catch (err) {
    // (fix C 01/06/2026) Log generico para erros nao-tratados especificamente
    await logError('asaas-sync:catch', err.message, {});
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/.netlify/functions/asaas-sync' };
