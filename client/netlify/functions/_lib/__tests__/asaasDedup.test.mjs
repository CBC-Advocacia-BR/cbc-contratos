// (anti-duplicidade Asaas, 2026-07-06) Logica pura da checagem de parcelamento
// em aberto ANTES de lancar uma nova cobranca. Fonte unica: _lib/asaasDedup.mjs,
// usada pela function asaas-sync (action create-payment). Um erro aqui deixa passar
// cobranca DUPLICADA ou gera falso-positivo que trava lancamento legitimo.
import { describe, it, expect } from 'vitest';
import { summarizeOpenParcelamentos, OPEN_STATUSES } from '../asaasDedup.mjs';

// helper para montar payment do Asaas
const pay = (o) => ({
  id: o.id || 'pay_x',
  value: o.value ?? 275,
  status: o.status || 'PENDING',
  dueDate: o.dueDate || '2026-05-20',
  description: o.description || 'Parcela 1 de 12. Honorarios iniciais - Fulano',
  installment: 'installment' in o ? o.installment : 'inst_a',
  installmentNumber: o.installmentNumber ?? 1,
  installmentCount: 'installmentCount' in o ? o.installmentCount : 12,
});

describe('summarizeOpenParcelamentos', () => {
  it('lista vazia -> sem alertas', () => {
    expect(summarizeOpenParcelamentos([])).toEqual([]);
    expect(summarizeOpenParcelamentos(null)).toEqual([]);
    expect(summarizeOpenParcelamentos(undefined)).toEqual([]);
  });

  it('parcelamento com parcelas em aberto -> 1 grupo resumido', () => {
    const res = summarizeOpenParcelamentos([
      pay({ id: 'p1', status: 'OVERDUE', dueDate: '2026-05-20', value: 275 }),
      pay({ id: 'p2', status: 'PENDING', dueDate: '2026-06-20', value: 275 }),
      pay({ id: 'p3', status: 'PENDING', dueDate: '2026-07-20', value: 275 }),
    ]);
    expect(res).toHaveLength(1);
    const g = res[0];
    expect(g.installmentId).toBe('inst_a');
    expect(g.openCount).toBe(3);
    expect(g.openValue).toBe(825);
    expect(g.installmentTotal).toBe(12);
    expect(g.firstDue).toBe('2026-05-20');
    expect(g.lastDue).toBe('2026-07-20');
    // descricao sem o prefixo "Parcela X de Y"
    expect(g.description).toBe('Honorarios iniciais - Fulano');
  });

  it('ignora parcelas pagas/deletadas — so conta em aberto', () => {
    const res = summarizeOpenParcelamentos([
      pay({ id: 'p1', status: 'RECEIVED', value: 275 }),
      pay({ id: 'p2', status: 'DELETED', value: 275 }),
      pay({ id: 'p3', status: 'CONFIRMED', value: 275 }),
      pay({ id: 'p4', status: 'PENDING', dueDate: '2026-08-20', value: 275 }),
    ]);
    expect(res).toHaveLength(1);
    expect(res[0].openCount).toBe(1);
    expect(res[0].openValue).toBe(275);
  });

  it('grupo 100% quitado/sem abertos -> nao alerta', () => {
    const res = summarizeOpenParcelamentos([
      pay({ id: 'p1', status: 'RECEIVED' }),
      pay({ id: 'p2', status: 'RECEIVED' }),
    ]);
    expect(res).toEqual([]);
  });

  it('boleto avulso aberto (sem installment) entra como grupo proprio', () => {
    const res = summarizeOpenParcelamentos([
      pay({ id: 'avulso1', installment: null, installmentCount: null, status: 'PENDING', value: 500, description: 'Cobranca avulsa - CBC' }),
    ]);
    expect(res).toHaveLength(1);
    expect(res[0].installmentId).toBeNull();
    expect(res[0].openCount).toBe(1);
    expect(res[0].openValue).toBe(500);
    expect(res[0].installmentTotal).toBeNull();
  });

  it('dois parcelamentos distintos -> 2 grupos ordenados por 1o vencimento', () => {
    const res = summarizeOpenParcelamentos([
      pay({ id: 'b1', installment: 'inst_b', dueDate: '2027-01-20', status: 'PENDING' }),
      pay({ id: 'a1', installment: 'inst_a', dueDate: '2026-05-20', status: 'PENDING' }),
      pay({ id: 'a2', installment: 'inst_a', dueDate: '2026-06-20', status: 'PENDING' }),
    ]);
    expect(res).toHaveLength(2);
    expect(res[0].installmentId).toBe('inst_a'); // vence antes
    expect(res[1].installmentId).toBe('inst_b');
  });

  it('OPEN_STATUSES = PENDING + OVERDUE', () => {
    expect(OPEN_STATUSES).toContain('PENDING');
    expect(OPEN_STATUSES).toContain('OVERDUE');
    expect(OPEN_STATUSES).not.toContain('RECEIVED');
    expect(OPEN_STATUSES).not.toContain('DELETED');
  });
});
