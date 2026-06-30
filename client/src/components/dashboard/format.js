// Formatação numérica do Dashboard — módulo separado de widgets.jsx para
// satisfazer react-refresh/only-export-components (arquivo de componentes
// não deve exportar funções utilitárias).

export function formatCurrency(val, { cents = false } = {}) {
  const n = Number(val) || 0;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: cents ? 2 : 0,
    minimumFractionDigits: cents ? 2 : 0,
  });
}

export function formatCompactBRL(val) {
  const n = Number(val) || 0;
  if (n >= 1000) {
    return `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: n >= 100000 ? 0 : 1 })}k`;
  }
  return formatCurrency(n);
}

export function fmtKpiValue(item) {
  if (item.value === null || item.value === undefined) return '—';
  switch (item.fmt) {
    case 'brl': return formatCurrency(item.value);
    case 'pct': return `${item.value}%`;
    case 'int': return Number(item.value).toLocaleString('pt-BR');
    default: return String(item.value);
  }
}
