// Defesa da inadimplencia (#extract-base): garante que os buckets de pagamento
// DERIVADOS de STATUS_TOKENS reproduzem exatamente os arrays manuais que viviam
// no BoletosPanel antes da extracao. Se alguem mudar um bucket por engano, o
// calculo de inadimplencia muda silenciosamente — este teste pega isso.
import { describe, it, expect } from 'vitest';
import {
  PAID_STATUSES,
  NEUTRAL_STATUSES,
  REMOVED_STATUSES,
  OPEN_STATUSES,
  filtroInadimplencia,
  pagamentoBucket,
  STATUS_TOKENS,
} from '../../lib/statusTokens';

const ORIG_PAID = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'];
const ORIG_NEUTRAL = [
  'REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL', 'AWAITING_RISK_ANALYSIS',
];
const ORIG_REMOVED = ['DELETED'];

const sorted = (a) => [...a].sort();

describe('statusTokens — paridade de buckets com BoletosPanel original', () => {
  it('PAID identico ao array original', () => {
    expect(sorted(PAID_STATUSES)).toEqual(sorted(ORIG_PAID));
  });
  it('NEUTRAL identico ao array original', () => {
    expect(sorted(NEUTRAL_STATUSES)).toEqual(sorted(ORIG_NEUTRAL));
  });
  it('REMOVED identico ao array original', () => {
    expect(sorted(REMOVED_STATUSES)).toEqual(sorted(ORIG_REMOVED));
  });
  it('OPEN = inadimplencia: PENDING/OVERDUE/DUNNING_REQUESTED nao sao pago/neutro/removido', () => {
    for (const s of ['PENDING', 'OVERDUE', 'DUNNING_REQUESTED']) {
      expect(pagamentoBucket(s)).toBe('OPEN');
      expect(PAID_STATUSES).not.toContain(s);
      expect(NEUTRAL_STATUSES).not.toContain(s);
      expect(REMOVED_STATUSES).not.toContain(s);
    }
  });
  it('todo status do mapa tem bucket valido', () => {
    for (const k of Object.keys(STATUS_TOKENS.pagamento)) {
      expect(['PAID', 'OPEN', 'NEUTRAL', 'REMOVED']).toContain(STATUS_TOKENS.pagamento[k].bucket);
    }
  });
});

// (auditoria 01/08/2026 — item 248) Filtro canonico de inadimplencia.
// Antes, InadimplenciaStrip, CobrancaPanel e RelatorioBoletosModal escreviam a MAO a
// mesma expressao — e ja tinham divergido: o relatorio NAO incluia DUNNING_REQUESTED
// (negativacao), entao ele subcontava inadimplentes em relacao as outras duas telas.
describe('filtroInadimplencia — fonte unica do que e "em aberto"', () => {
  const HOJE = '2026-08-01';

  it('inclui todos os status do bucket OPEN', () => {
    const f = filtroInadimplencia(HOJE);
    for (const s of OPEN_STATUSES) {
      if (s === 'PENDING') continue; // PENDING entra so com vencimento passado
      expect(f).toContain(`status.eq.${s}`);
    }
  });

  it('inclui DUNNING_REQUESTED (o que faltava no relatorio)', () => {
    expect(filtroInadimplencia(HOJE)).toContain('status.eq.DUNNING_REQUESTED');
  });

  it('PENDING so conta quando o vencimento ja passou', () => {
    const f = filtroInadimplencia(HOJE);
    expect(f).toContain(`and(status.eq.PENDING,due_date.lt.${HOJE})`);
    // PENDING nunca pode aparecer como termo SOLTO no nivel de cima (senao boleto que
    // ainda nem venceu entraria na inadimplencia). A ancora de inicio/virgula evita casar
    // com o `status.eq.PENDING` que vive DENTRO do and(...).
    expect(f).not.toMatch(/(^|,)status\.eq\.PENDING(,|$)/);
  });

  it('nao inclui status de pago/removido', () => {
    const f = filtroInadimplencia(HOJE);
    for (const s of PAID_STATUSES) expect(f).not.toContain(`status.eq.${s}`);
    for (const s of REMOVED_STATUSES) expect(f).not.toContain(`status.eq.${s}`);
  });
});
