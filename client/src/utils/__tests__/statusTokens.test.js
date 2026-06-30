// Defesa da inadimplencia (#extract-base): garante que os buckets de pagamento
// DERIVADOS de STATUS_TOKENS reproduzem exatamente os arrays manuais que viviam
// no BoletosPanel antes da extracao. Se alguem mudar um bucket por engano, o
// calculo de inadimplencia muda silenciosamente — este teste pega isso.
import { describe, it, expect } from 'vitest';
import {
  PAID_STATUSES,
  NEUTRAL_STATUSES,
  REMOVED_STATUSES,
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
