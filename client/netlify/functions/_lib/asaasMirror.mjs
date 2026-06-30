/**
 * Espelho Asaas -> Supabase (asaas_boletos + asaas_customers), compartilhado entre:
 *  - asaas-sync-boletos.mjs (modo manual em blocos, usado pelo painel)
 *  - asaas-sync-boletos-background.mjs (agendado + backfill encadeado)
 *  - asaas-webhook.mjs (atualizacao em tempo real)
 *  - asaas-sync-customers.mjs / asaas-sync-customer.mjs (espelho de clientes)
 *
 * asaas_boletos e asaas_customers sao restritas ao role authenticated; as
 * functions usam a chave anon, entao TODA escrita/leitura passa pelas RPCs
 * security definer (asaas_mirror_* / asaas_customers_upsert) destravadas
 * pelo segredo BOT_RPC_SECRET.
 */
import { db } from './botDb.mjs';

export const ASAAS_URL = 'https://api.asaas.com/v3';
const ASAAS_KEY = process.env.ASAAS_API_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

// (fix 29/06/2026) Inclui os status de NEGATIVACAO (DUNNING_*). Antes o sync varria
// so 5 status e nunca buscava /payments?status=DUNNING_REQUESTED|DUNNING_RECEIVED, entao
// boletos negativados no Asaas nao chegavam ao espelho (so sobreviviam se ja estivessem
// como OVERDUE e um webhook os atualizasse). Causava lista de inadimplentes menor que a
// do Asaas. DUNNING_REQUESTED = negativacao em aberto (continua divida); DUNNING_RECEIVED
// = negativacao paga (entra no bucket PAID, coerente com o fix de 31/05).
export const STATUSES = ['PENDING', 'OVERDUE', 'DUNNING_REQUESTED', 'DUNNING_RECEIVED', 'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
export const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
export const PAID_LOOKBACK_DAYS = 90;
export const BLOCK_SIZE = 100;

export async function asaasGet(path) {
  // (integ-5) timeout p/ nao pendurar a function se o Asaas ficar lento
  const r = await fetch(`${ASAAS_URL}${path}`, { headers: { 'access_token': ASAAS_KEY }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    const err = new Error(`Asaas ${path.split('?')[0]}: ${r.status} ${txt.slice(0, 180)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function promiseMap(items, mapper, concurrency = 8) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { results[idx] = await mapper(items[idx], idx); }
      catch (e) { results[idx] = { __err: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ---------- escrita via RPC ----------
export async function mirrorUpsert(rows) {
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.rpc('asaas_mirror_upsert', {
      p_chave: RPC_SECRET, p_rows: rows.slice(i, i + 200),
    });
    if (error) throw new Error(`asaas_mirror_upsert: ${error.message}`);
  }
  return rows.length;
}

export async function customersUpsert(rows) {
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.rpc('asaas_customers_upsert', {
      p_chave: RPC_SECRET, p_rows: rows.slice(i, i + 200),
    });
    if (error) throw new Error(`asaas_customers_upsert: ${error.message}`);
  }
  return rows.length;
}

export async function mirrorUpdate(id, set) {
  const { data, error } = await db.rpc('asaas_mirror_update', { p_chave: RPC_SECRET, p_id: id, p_set: set });
  if (error) throw new Error(`asaas_mirror_update: ${error.message}`);
  return data;
}

export async function mirrorState(key, value) {
  const { error } = await db.rpc('asaas_mirror_state', { p_chave: RPC_SECRET, p_key: key, p_value: value });
  if (error) throw new Error(`asaas_mirror_state: ${error.message}`);
}

// (#23) Trava atomica de emissao de NF por pagamento. Retorna true SO p/ quem pegou a
// trava (UPDATE condicional). Evita NF duplicada em eventos concorrentes do mesmo pagamento.
export async function nfClaim(id) {
  const { data, error } = await db.rpc('asaas_nf_claim', { p_chave: RPC_SECRET, p_id: id });
  if (error) throw new Error(`asaas_nf_claim: ${error.message}`);
  return data === true;
}

// Libera a trava de NF (usado quando a emissao falha, p/ permitir reemissao num proximo evento).
export async function nfRelease(id) {
  const { error } = await db.rpc('asaas_nf_release', { p_chave: RPC_SECRET, p_id: id });
  if (error) throw new Error(`asaas_nf_release: ${error.message}`);
}

export async function mirrorStaleOpen(before, limit = 120) {
  const { data, error } = await db.rpc('asaas_mirror_stale_open', {
    p_chave: RPC_SECRET, p_before: before, p_limit: limit,
  });
  if (error) throw new Error(`asaas_mirror_stale_open: ${error.message}`);
  return data || [];
}

// ids dos boletos abertos (PENDING/OVERDUE) de UM cliente no espelho — base da
// reconciliacao on-demand de remocao no asaas-sync-customer.
export async function mirrorOpenByCustomer(customerId) {
  const { data, error } = await db.rpc('asaas_mirror_open_by_customer', {
    p_chave: RPC_SECRET, p_customer_id: customerId,
  });
  if (error) throw new Error(`asaas_mirror_open_by_customer: ${error.message}`);
  return data || [];
}

export async function mirrorCache(ids, customerIds) {
  const { data, error } = await db.rpc('asaas_mirror_cache', {
    p_chave: RPC_SECRET, p_ids: ids, p_customer_ids: customerIds,
  });
  if (error) throw new Error(`asaas_mirror_cache: ${error.message}`);
  return data || { existing: [], customers: [] };
}

// ---------- linha do espelho a partir do payment da API ----------
export function paymentRow(p, cust = {}, inv = null, pix = {}) {
  return {
    id: p.id,
    customer_id: p.customer,
    customer_name: cust.name || null,
    customer_cpf: cust.cpf || null,
    value: p.value,
    net_value: p.netValue,
    status: p.status,
    due_date: p.dueDate,
    payment_date: p.paymentDate || p.clientPaymentDate || null,
    description: p.description || null,
    external_reference: p.externalReference || null,
    bank_slip_url: p.bankSlipUrl || null,
    invoice_url: p.invoiceUrl || null,
    nf_pdf_url: inv?.pdfUrl || null,
    nf_xml_url: inv?.xmlUrl || null,
    nf_number: inv?.number || null,
    nf_status: inv?.status || null,
    pix_copy_paste: pix.copy || null,
    pix_qr_code: pix.qr || null,
    installment_id: p.installment || null,
    installment_number: p.installmentNumber || null,
    installment_total: p.installmentCount || null,
    billing_type: p.billingType || null,
    date_created: p.dateCreated || null,
    updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };
}

// ---------- linha do espelho a partir do customer da API ----------
export function customerRow(c) {
  return {
    id: c.id,
    name: c.name || null,
    cpf_cnpj: c.cpfCnpj || null,
    email: c.email || null,
    phone: c.phone || null,
    mobile_phone: c.mobilePhone || null,
    address: [c.address, c.addressNumber, c.complement, c.province].filter(Boolean).join(', ') || null,
    city: c.city || null,
    state: c.state || null,
    postal_code: c.postalCode || null,
    date_created: c.dateCreated || null,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Processa UM bloco (status + offset) da API -> upsert no espelho.
 * opts.full: ignora o recorte de 90 dias dos status pagos (backfill completo).
 */
export async function processBlock(status, offset, opts = {}) {
  let extraFilter = '';
  if (PAID_STATUSES.has(status) && !opts.full) {
    const since = new Date(Date.now() - PAID_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    extraFilter = `&paymentDate[ge]=${since}`;
  }
  const data = await asaasGet(`/payments?limit=${BLOCK_SIZE}&offset=${offset}&status=${status}&order=desc${extraFilter}`);
  const payments = data.data || [];
  const hasMore = data.hasMore === true || payments.length === BLOCK_SIZE;
  if (!payments.length) return { rows: 0, hasMore: false };

  const customerIds = [...new Set(payments.map(p => p.customer).filter(Boolean))];
  const paymentIds = payments.map(p => p.id);

  // cache local: PIX/NF/customers ja conhecidos
  const cache = await mirrorCache(paymentIds, customerIds);
  const existingMap = {};
  (cache.existing || []).forEach(r => { existingMap[r.id] = r; });
  const knownCustomers = {};
  (cache.customers || []).forEach(r => {
    if (r.customer_id) knownCustomers[r.customer_id] = { name: r.customer_name, cpf: r.customer_cpf };
  });

  // customers desconhecidos -> API
  const unknownCustIds = customerIds.filter(id => !knownCustomers[id]);
  const fetched = await promiseMap(unknownCustIds, async (id) => {
    const c = await asaasGet(`/customers/${id}`);
    return { id, name: c.name, cpf: c.cpfCnpj };
  });
  fetched.forEach(c => { if (c && c.id) knownCustomers[c.id] = { name: c.name, cpf: c.cpf }; });

  // notas fiscais: so para quem ainda nao tem NF autorizada no cache
  const invoicesMap = {};
  const needInvoice = paymentIds.filter(pid => {
    const ex = existingMap[pid];
    return !(ex && ex.nf_status === 'AUTHORIZED' && ex.nf_pdf_url);
  });
  await promiseMap(needInvoice, async (pid) => {
    const r = await asaasGet(`/invoices?payment=${pid}&limit=10`);
    if (r.data && r.data.length) {
      const sorted = [...r.data].sort((a, b) => (b.effectiveDate || '').localeCompare(a.effectiveDate || ''));
      invoicesMap[pid] = sorted[0];
    }
  });

  // PIX copia-e-cola: so pendentes/vencidos sem PIX em cache
  const needPix = payments.filter(p =>
    (p.status === 'PENDING' || p.status === 'OVERDUE') && !existingMap[p.id]?.pix_copy_paste);
  const pixMap = {};
  await promiseMap(needPix, async (p) => {
    const r = await asaasGet(`/payments/${p.id}/pixQrCode`);
    pixMap[p.id] = { copy: r.payload || null, qr: r.encodedImage || null };
  });

  const rows = payments.map(p => paymentRow(p, knownCustomers[p.customer] || {}, invoicesMap[p.id] || null, pixMap[p.id] || {}));
  await mirrorUpsert(rows);
  return { rows: rows.length, hasMore };
}

export function nextBlock(status, offset, hasMore) {
  if (hasMore) return { status, offset: offset + BLOCK_SIZE };
  const idx = STATUSES.indexOf(status);
  if (idx < STATUSES.length - 1) return { status: STATUSES[idx + 1], offset: 0 };
  return null;
}

/**
 * Reconciliacao: pendentes/vencidos do espelho que o sync NAO viu nesta rodada
 * (pagos por outra via, excluidos, reembolsados...) -> re-busca individual.
 */
export async function reconcileStaleOpen(chainStart, limit = 120) {
  const ids = await mirrorStaleOpen(chainStart, limit);
  let updated = 0, errors = 0;
  // (perf-be-13) reconcilia em paralelo controlado (promiseMap, 6 de cada vez) em
  // vez de 1-a-1 com pausa fixa de 250ms — encurta de minutos para segundos, sem
  // estourar o burst limit do Asaas.
  const res = await promiseMap(ids, async (id) => {
    try {
      let p;
      try { p = await asaasGet(`/payments/${id}`); }
      catch (e) {
        if (e.status === 429) { // rate limit: respira e tenta 1x de novo
          await new Promise(r => setTimeout(r, 15000));
          p = await asaasGet(`/payments/${id}`);
        } else throw e;
      }
      // pagamento EXCLUIDO no Asaas mantem o status original + deleted:true
      if (p.deleted) await mirrorUpdate(id, { status: 'DELETED' });
      else await mirrorUpsert([paymentRow(p)]);
      return { ok: true };
    } catch (e) {
      if (e.status === 404) { await mirrorUpdate(id, { status: 'DELETED' }); return { ok: true }; }
      return { __err: e.message };
    }
  }, 6);
  for (const r of res) { if (r && r.ok) updated++; else errors++; }
  return { checked: ids.length, updated, errors };
}
