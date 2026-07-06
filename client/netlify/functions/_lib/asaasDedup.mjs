/**
 * Anti-duplicidade de lancamento Asaas (2026-07-06).
 *
 * Logica PURA (sem rede/DB) usada por asaas-sync (action `create-payment`) para
 * avisar, ANTES de criar uma nova cobranca, que o cliente ja tem parcelamento em
 * aberto no Asaas. Decisao do Paulo (06/07/2026): avisar e deixar confirmar
 * (NAO bloquear de vez) e o gatilho e "parcela em aberto" (PENDING/OVERDUE).
 *
 * Motivo: auditoria achou 25 clientes com parcelamento duplicado (a maioria
 * criada a mao no painel do Asaas — que trava de codigo por contrato nao pega).
 * Ver docs/superpowers/specs/2026-07-06-asaas-anti-duplicidade-design.md.
 */

// Status que contam como "parcela em aberto" (nao paga, nao removida).
export const OPEN_STATUSES = ['PENDING', 'OVERDUE'];

// Remove o prefixo "Parcela X de Y." da descricao do boleto do Asaas.
function stripParcelaPrefix(desc) {
  return String(desc || '').replace(/^Parcela\s+\d+\s+de\s+\d+\.?\s*/i, '').trim();
}

/**
 * Recebe a lista de payments do Asaas (idealmente ja filtrada por
 * status=PENDING/OVERDUE, mas o filtro e reaplicado aqui por seguranca) e
 * devolve 1 resumo por grupo que tem ao menos uma parcela em aberto.
 *
 * @param {Array<object>} payments payments crus da API do Asaas
 * @returns {Array<{installmentId:string|null, key:string, openCount:number,
 *   installmentTotal:number|null, openValue:number, firstDue:string|null,
 *   lastDue:string|null, description:string}>} ordenado por 1o vencimento
 */
export function summarizeOpenParcelamentos(payments) {
  if (!Array.isArray(payments) || payments.length === 0) return [];

  const groups = new Map();
  for (const p of payments) {
    if (!p || !OPEN_STATUSES.includes(p.status)) continue;
    // parcelamento agrupa por `installment`; avulso (sem installment) por payment id
    const instId = p.installment || null;
    const key = instId || `single:${p.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        installmentId: instId,
        key,
        openCount: 0,
        installmentTotal: p.installmentCount || null,
        openValue: 0,
        firstDue: null,
        lastDue: null,
        description: stripParcelaPrefix(p.description),
      };
      groups.set(key, g);
    }
    g.openCount += 1;
    g.openValue = Math.round((g.openValue + (Number(p.value) || 0)) * 100) / 100;
    const due = p.dueDate || null;
    if (due) {
      if (!g.firstDue || due < g.firstDue) g.firstDue = due;
      if (!g.lastDue || due > g.lastDue) g.lastDue = due;
    }
    // preenche descricao/total se o 1o payment do grupo nao tinha
    if (!g.description) g.description = stripParcelaPrefix(p.description);
    if (g.installmentTotal == null && p.installmentCount) g.installmentTotal = p.installmentCount;
  }

  return [...groups.values()].sort((a, b) => {
    const av = a.firstDue || '9999-12-31';
    const bv = b.firstDue || '9999-12-31';
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
}
