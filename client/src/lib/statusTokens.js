// ─────────────────────────────────────────────────────────────────────────
// Base transversal de status (extract 20/06/2026)
// Fonte UNICA de verdade para rotulo + tom + icone de status, por dominio.
// Nenhum hex aqui: cada estado aponta para um "tom" semantico, e toneStyle()
// traduz o tom para os tokens CSS --cbc-* (que ja funcionam em light e dark).
//
// Antes desta base, cada tela tinha seu proprio mapa (STATUS_LABELS / STATUS_META
// / COLUMNS / STATUS do BoletosPanel ...) com cores divergentes e quebradas no
// dark. Consumidores: components/ui/StatusPill, StatusDot, HealthCard e os mapas
// derivados (PAID/NEUTRAL/REMOVED_STATUSES).
// ─────────────────────────────────────────────────────────────────────────
import {
  DocumentTextIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  BanknotesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

// Tons semanticos validos -> tokens CSS --cbc-*
export const TONE_KEYS = ['success', 'danger', 'warning', 'info', 'neutral'];

// Unica ponte tom -> CSS. Retorna { fg, bg, border } com vars dark-aware.
export function toneStyle(tone) {
  const t = TONE_KEYS.includes(tone) ? tone : 'neutral';
  const v = (n) => `var(--cbc-${n})`;
  return {
    fg: t === 'neutral' ? v('neutral') : v(t),
    bg: v(`${t}-bg`),
    border: v(`${t}-border`),
  };
}

export const STATUS_TOKENS = {
  // Fluxo do contrato (REGRA #2 — imutavel; aqui so a APRESENTACAO)
  contrato: {
    rascunho: { label: 'Rascunho', tone: 'neutral', Icon: DocumentTextIcon },
    enviado_zapsign: { label: 'Enviado', tone: 'info', Icon: PaperAirplaneIcon },
    assinado: { label: 'Assinado', tone: 'success', Icon: CheckCircleIcon },
    cancelado: { label: 'Cancelado', tone: 'danger', Icon: XCircleIcon },
  },

  // Pagamento (status Asaas) + bucket canonico p/ inadimplencia.
  // bucket: 'PAID' (dinheiro entrou) | 'OPEN' (em aberto/vencido = inadimplencia)
  //         | 'NEUTRAL' (nao conta) | 'REMOVED' (excluido no Asaas).
  pagamento: {
    PENDING: { label: 'Pendente', tone: 'warning', bucket: 'OPEN', Icon: ClockIcon },
    OVERDUE: { label: 'Vencido', tone: 'danger', bucket: 'OPEN', Icon: ExclamationTriangleIcon },
    RECEIVED: { label: 'Pago', tone: 'success', bucket: 'PAID', Icon: CheckCircleIcon },
    CONFIRMED: { label: 'Confirmado', tone: 'success', bucket: 'PAID', Icon: CheckCircleIcon },
    RECEIVED_IN_CASH: { label: 'Pago (espécie)', tone: 'success', bucket: 'PAID', Icon: BanknotesIcon },
    DUNNING_RECEIVED: { label: 'Recuperado', tone: 'success', bucket: 'PAID', Icon: CheckCircleIcon },
    DUNNING_REQUESTED: { label: 'Em negativação', tone: 'danger', bucket: 'OPEN', Icon: ExclamationTriangleIcon },
    REFUNDED: { label: 'Estornado', tone: 'neutral', bucket: 'NEUTRAL' },
    REFUND_REQUESTED: { label: 'Estorno solicitado', tone: 'neutral', bucket: 'NEUTRAL' },
    REFUND_IN_PROGRESS: { label: 'Estornando', tone: 'neutral', bucket: 'NEUTRAL' },
    CHARGEBACK_REQUESTED: { label: 'Chargeback', tone: 'neutral', bucket: 'NEUTRAL' },
    CHARGEBACK_DISPUTE: { label: 'Em disputa', tone: 'neutral', bucket: 'NEUTRAL' },
    AWAITING_CHARGEBACK_REVERSAL: { label: 'Aguard. estorno', tone: 'neutral', bucket: 'NEUTRAL' },
    AWAITING_RISK_ANALYSIS: { label: 'Análise risco', tone: 'neutral', bucket: 'NEUTRAL' },
    DELETED: { label: 'Removido', tone: 'neutral', bucket: 'REMOVED', Icon: TrashIcon },
  },

  // Saude de integracao/serviço (Monitor)
  saude: {
    ok: { label: 'OK', tone: 'success', Icon: CheckCircleIcon },
    warning: { label: 'Atenção', tone: 'warning', Icon: ExclamationTriangleIcon },
    error: { label: 'Erro', tone: 'danger', Icon: XCircleIcon },
    stale: { label: 'Defasado', tone: 'neutral', Icon: ClockIcon },
  },
};

// Lookup tolerante: chave desconhecida cai no 1o estado do dominio (neutro/seguro).
export function getStatus(domain, key) {
  const d = STATUS_TOKENS[domain] || {};
  if (d[key]) return d[key];
  const first = Object.keys(d)[0];
  return first ? d[first] : { label: String(key ?? '—'), tone: 'neutral' };
}

// ─── Buckets de pagamento DERIVADOS do mapa (fonte unica) ───
// Substituem os arrays manuais de BoletosPanel. A divisao PAID/NEUTRAL/REMOVED
// reproduz exatamente a anterior (ver teste utils/__tests__/statusTokens.test.js);
// tudo que NAO e PAID/NEUTRAL/REMOVED e 'OPEN' = inadimplencia.
const byBucket = (b) =>
  Object.keys(STATUS_TOKENS.pagamento).filter((k) => STATUS_TOKENS.pagamento[k].bucket === b);

export const PAID_STATUSES = byBucket('PAID');
export const NEUTRAL_STATUSES = byBucket('NEUTRAL');
export const REMOVED_STATUSES = byBucket('REMOVED');

export const pagamentoBucket = (status) => STATUS_TOKENS.pagamento[status]?.bucket || 'OPEN';
export const isPaidStatus = (s) => pagamentoBucket(s) === 'PAID';
export const isNeutralStatus = (s) => pagamentoBucket(s) === 'NEUTRAL';
export const isRemovedStatus = (s) => pagamentoBucket(s) === 'REMOVED';

// Saude por idade da ultima execucao (warning quando passa de 75% do limite).
export function healthStatus(lastRunIso, maxHoras = 26, temErro = false) {
  if (temErro) return 'error';
  if (!lastRunIso) return 'stale';
  const horas = (Date.now() - new Date(lastRunIso).getTime()) / 3600000;
  if (horas > maxHoras) return 'stale';
  if (horas > maxHoras * 0.75) return 'warning';
  return 'ok';
}
