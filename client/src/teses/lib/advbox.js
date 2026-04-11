// Cliente Advbox — todas as chamadas passam pelo backend (proxy),
// pois o token Bearer não pode ser exposto no browser e o CORS da
// Advbox é bloqueado para chamadas diretas do cliente.
//
// Endpoints esperados no backend (ver server/teses_routes.js):
//   GET  /api/teses/advbox/settings
//   GET  /api/teses/advbox/lawsuits?process_number=X
//   GET  /api/teses/advbox/lawsuits/:id
//   GET  /api/teses/advbox/customers/:id
//   GET  /api/teses/advbox/movements/:lawsuitId
//   GET  /api/teses/advbox/publications/:lawsuitId
//   POST /api/teses/advbox/posts
//   POST /api/teses/advbox/movements

import { API_URL } from '../../config';

async function req(path, opts = {}) {
  const r = await fetch(`${API_URL}/api/teses/advbox${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(`Advbox ${r.status}: ${msg}`);
  }
  return r.json();
}

export const advbox = {
  settings: () => req('/settings'),
  findLawsuitByNumber: (processNumber) =>
    req(`/lawsuits?process_number=${encodeURIComponent(processNumber)}`),
  getLawsuit: (id) => req(`/lawsuits/${id}`),
  getCustomer: (id) => req(`/customers/${id}`),
  getMovements: (lawsuitId) => req(`/movements/${lawsuitId}`),
  getPublications: (lawsuitId) => req(`/publications/${lawsuitId}`),
  createPost: (payload) =>
    req('/posts', { method: 'POST', body: JSON.stringify(payload) }),
  createMovement: (payload) =>
    req('/movements', { method: 'POST', body: JSON.stringify(payload) }),
};

/**
 * Busca consolidada de um processo pelo número.
 * Retorna { lawsuit, customer, movements, publications } — os campos
 * ausentes ficam null e a UI deve tratar graciosamente.
 */
export async function fetchProcessBundle(processNumber) {
  const bundle = { lawsuit: null, customer: null, movements: [], publications: [] };
  try {
    const search = await advbox.findLawsuitByNumber(processNumber);
    const lawsuit = Array.isArray(search?.data) ? search.data[0] : search?.data || search;
    if (!lawsuit) return bundle;
    bundle.lawsuit = lawsuit;
    const lawsuitId = lawsuit.id || lawsuit.lawsuit_id;
    const [movs, pubs] = await Promise.allSettled([
      advbox.getMovements(lawsuitId),
      advbox.getPublications(lawsuitId),
    ]);
    if (movs.status === 'fulfilled') bundle.movements = movs.value?.data || movs.value || [];
    if (pubs.status === 'fulfilled') bundle.publications = pubs.value?.data || pubs.value || [];
    const customerId = lawsuit.customer_id || lawsuit.customer?.id;
    if (customerId) {
      try {
        const cust = await advbox.getCustomer(customerId);
        bundle.customer = cust?.data || cust;
      } catch { /* ignore */ }
    }
  } catch (err) {
    bundle.error = err.message;
  }
  return bundle;
}
