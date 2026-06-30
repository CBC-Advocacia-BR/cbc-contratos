/**
 * Sincroniza UM cliente específico: customer + seus payments + invoices + pix.
 * Body: { customerId: 'cus_xxx' }
 * Usado ao abrir o card do cliente no BoletosPanel.
 *
 * asaas_customers e asaas_boletos sao restritas ao role authenticated; toda
 * escrita/leitura passa pelas RPCs security definer de _lib/asaasMirror.mjs
 * (segredo BOT_RPC_SECRET) — a escrita direta com a chave anon era barrada
 * pelo RLS e falhava em silêncio.
 */
import { customerRow, customersUpsert, mirrorCache, mirrorUpdate, mirrorUpsert, mirrorOpenByCustomer, paymentRow } from './_lib/asaasMirror.mjs';

const ASAAS_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';
const HEADERS = { 'access_token': ASAAS_KEY, 'Content-Type': 'application/json' };

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

async function asaasGet(path) {
  const r = await fetch(`${ASAAS_URL}${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`asaas ${path}: ${r.status}`);
  return r.json();
}

async function promiseMap(items, mapper, concurrency = 5) {
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; try { await mapper(items[idx]); } catch {} } };
  await Promise.all(Array.from({ length: concurrency }, run));
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const customerId = body.customerId;
    if (!customerId) return new Response(JSON.stringify({ error: 'customerId required' }), { status: 400, headers: CORS });

    // 1. Customer atualizado
    const c = await asaasGet(`/customers/${customerId}`);
    await customersUpsert([customerRow(c)]);

    // 2. Todos os payments do cliente (paginado). Inclui status pagos para que
    //    boletos quitados depois da ultima sincronizacao apareçam corretamente
    //    no painel — antes ficavam congelados em PENDING/OVERDUE.
    const allPayments = [];
    for (const status of ['PENDING', 'OVERDUE', 'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']) {
      let offset = 0;
      while (true) {
        const d = await asaasGet(`/payments?customer=${customerId}&status=${status}&limit=100&offset=${offset}`);
        const list = d.data || [];
        allPayments.push(...list);
        if (!d.hasMore && list.length < 100) break;
        offset += 100;
        if (offset > 2000) break;
      }
    }

    if (allPayments.length === 0) {
      return new Response(JSON.stringify({ success: true, customer: c.id, payments: 0 }), { headers: CORS });
    }

    const paymentIds = allPayments.map(p => p.id);

    // Cache local: dados já sincronizados destes boletos (NF, PIX)
    const cache = await mirrorCache(paymentIds, []);
    const existingMap = {};
    (cache.existing || []).forEach(r => { existingMap[r.id] = r; });

    // 3. Invoices + PIX em paralelo, pulando o que já está em cache
    const invoices = {};
    const pixData = {};
    await promiseMap(allPayments, async (p) => {
      const ex = existingMap[p.id] || {};
      const calls = [];
      // NF só se ainda não autorizada
      if (!(ex.nf_status === 'AUTHORIZED' && ex.nf_pdf_url)) {
        calls.push(asaasGet(`/invoices?payment=${p.id}&limit=10`).then(r => {
          if (r.data?.length) {
            const sorted = [...r.data].sort((a, b) => (b.effectiveDate || '').localeCompare(a.effectiveDate || ''));
            invoices[p.id] = sorted[0];
          }
        }).catch(() => {}));
      }
      // PIX só se ainda não temos
      if (!ex.pix_copy_paste) {
        calls.push(asaasGet(`/payments/${p.id}/pixQrCode`).then(r => {
          pixData[p.id] = { copy: r.payload || null, qr: r.encodedImage || null };
        }).catch(() => {}));
      }
      await Promise.all(calls);
    }, 10);

    // 4. Monta rows e upsert via RPC. NF/PIX nulos NAO apagam o que ja esta
    //    no espelho: a RPC asaas_mirror_upsert faz coalesce desses campos.
    const rows = allPayments.map(p => paymentRow(
      p, { name: c.name, cpf: c.cpfCnpj }, invoices[p.id] || null, pixData[p.id] || {},
    ));
    await mirrorUpsert(rows);

    // 5. Deteccao on-demand de remocao: boletos que o espelho tem como ABERTOS
    //    (PENDING/OVERDUE) mas que o Asaas NAO devolveu nesta rodada foram
    //    excluidos/estornados la. O fetch acima ja cobre todos os status pagos,
    //    entao o que "sumiu" e excluido (deleted), estornado ou em disputa.
    //    Re-busca individual resolve o status real -> deletado vira DELETED na
    //    hora (antes so a reconciliacao agendada 06h/18h pegava isso).
    let removed = 0;
    try {
      const openIds = await mirrorOpenByCustomer(customerId);
      const fresh = new Set(paymentIds);
      const missing = openIds.filter(id => !fresh.has(id)).slice(0, 50);
      await promiseMap(missing, async (id) => {
        try {
          const p = await asaasGet(`/payments/${id}`);
          if (p.deleted) { await mirrorUpdate(id, { status: 'DELETED' }); removed++; }
          else await mirrorUpsert([paymentRow(p, { name: c.name, cpf: c.cpfCnpj })]);
        } catch (e) {
          if (String(e.message).endsWith(': 404')) { await mirrorUpdate(id, { status: 'DELETED' }); removed++; }
        }
      }, 5);
    } catch { /* best-effort: reconciliacao agendada cobre o que falhar aqui */ }

    return new Response(JSON.stringify({ success: true, customer: c.id, payments: rows.length, removed }), { headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: CORS });
  }
};
