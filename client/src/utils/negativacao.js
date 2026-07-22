// Negativação Serasa (22/07/2026) — lógica PURA de candidatos.
//
// A partir do espelho de boletos, calcula quem está inadimplente há mais de N dias
// (padrão 90) e é candidato a negativação no Serasa via Asaas. A negativação mira a
// cobrança VENCIDA mais antiga do cliente. "pronto" = existe uma cobrança-alvo; a
// validação dos dados exigidos pelo Serasa (telefone/endereço/número/bairro/CEP) é
// AUTORITATIVA no backend, que busca o cadastro real do Asaas antes de disparar —
// por isso não pré-bloqueamos aqui (o espelho local é esparso e daria falso-negativo).

const OPEN = new Set(['OVERDUE']); // negativação mira a cobrança VENCIDA

const diasEntre = (isoDue, hojeMs) => {
  if (!isoDue) return null;
  const d = new Date(isoDue + 'T12:00:00').getTime();
  if (Number.isNaN(d)) return null;
  return Math.floor((hojeMs - d) / 86400000);
};

/**
 * @param {object} p
 * @param {Array} p.boletos linhas do espelho asaas_boletos (status, due_date, value, customer_id, customer_cpf, customer_name, id)
 * @param {number} [p.hojeMs] Date.now() injetável (testes)
 * @param {number} [p.minDias] limite de atraso (padrão 90)
 * @returns {Array<{customerId,cpf,nome,diasAtraso,parcelasVencidas,totalVencido,paymentIdMaisAntigo,pronto}>}
 */
export function computeNegativacaoCandidates({ boletos, hojeMs = Date.now(), minDias = 90 }) {
  const grupos = new Map();
  for (const b of (boletos || [])) {
    if (!b || !OPEN.has(b.status)) continue;
    const key = b.customer_id || b.customer_cpf;
    if (!key) continue;
    let g = grupos.get(key);
    if (!g) {
      g = { customerId: b.customer_id || null, cpf: b.customer_cpf || null, nome: b.customer_name || '',
        parcelasVencidas: 0, totalVencido: 0, maisAntigoDue: null, paymentIdMaisAntigo: null };
      grupos.set(key, g);
    }
    g.parcelasVencidas += 1;
    g.totalVencido = Math.round((g.totalVencido + (Number(b.value) || 0)) * 100) / 100;
    if (!g.nome && b.customer_name) g.nome = b.customer_name;
    if (b.due_date && (!g.maisAntigoDue || b.due_date < g.maisAntigoDue)) {
      g.maisAntigoDue = b.due_date;
      g.paymentIdMaisAntigo = b.id || null; // cobrança que será negativada (a mais antiga)
    }
  }

  const out = [];
  for (const g of grupos.values()) {
    const dias = diasEntre(g.maisAntigoDue, hojeMs);
    if (dias == null || dias <= minDias) continue;
    out.push({
      customerId: g.customerId, cpf: g.cpf, nome: g.nome,
      diasAtraso: dias, parcelasVencidas: g.parcelasVencidas, totalVencido: g.totalVencido,
      paymentIdMaisAntigo: g.paymentIdMaisAntigo,
      // "pronto" = temos uma cobrança-alvo + o id do cliente; dados do Serasa são
      // validados no backend (autoritativo). Sem customerId/payment não dá p/ negativar.
      pronto: !!(g.customerId && g.paymentIdMaisAntigo),
    });
  }
  return out.sort((a, b) => b.diasAtraso - a.diasAtraso);
}

// Custo fixo da negativação CREDIT_BUREAU no Asaas (confirmado nas 32 existentes: R$ 9,90/un, sem taxa de cancelamento).
export const NEGATIVACAO_FEE = 9.9;

export function resumoNegativacao(candidatos) {
  const prontos = candidatos.filter((c) => c.pronto);
  return {
    total: candidatos.length,
    prontos: prontos.length,
    faltamDados: candidatos.length - prontos.length,
    totalEmAberto: Math.round(candidatos.reduce((s, c) => s + (c.totalVencido || 0), 0)),
    custoTodosProntos: Math.round(prontos.length * NEGATIVACAO_FEE * 100) / 100,
  };
}
