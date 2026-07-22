import { describe, it, expect } from 'vitest';
import { computeNegativacaoCandidates, resumoNegativacao, NEGATIVACAO_FEE, computeRecuperado } from '../negativacao';

// hoje fixo p/ testes determinísticos: 2026-07-22 12:00
const HOJE = new Date('2026-07-22T12:00:00').getTime();
const dueAtrasDias = (n) => new Date(HOJE - n * 86400000).toISOString().slice(0, 10);

describe('computeNegativacaoCandidates', () => {
  it('cliente com vencido há 120 dias vira candidato; oldest payment é o alvo', () => {
    const boletos = [
      { status: 'OVERDUE', due_date: dueAtrasDias(120), value: 300, customer_id: 'cus_1', customer_name: 'Ana', id: 'pay_velho' },
      { status: 'OVERDUE', due_date: dueAtrasDias(90), value: 300, customer_id: 'cus_1', customer_name: 'Ana', id: 'pay_novo' },
    ];
    const r = computeNegativacaoCandidates({ boletos, hojeMs: HOJE });
    expect(r).toHaveLength(1);
    expect(r[0].diasAtraso).toBe(120);
    expect(r[0].parcelasVencidas).toBe(2);
    expect(r[0].totalVencido).toBe(600);
    expect(r[0].paymentIdMaisAntigo).toBe('pay_velho');
    expect(r[0].valorMaisAntigo).toBe(300); // valor da parcela negativada (não o total 600)
    expect(r[0].pronto).toBe(true);
  });

  it('exatamente 90 dias NÃO entra (precisa passar de 90)', () => {
    const boletos = [{ status: 'OVERDUE', due_date: dueAtrasDias(90), value: 300, customer_id: 'c', customer_name: 'B', id: 'p' }];
    expect(computeNegativacaoCandidates({ boletos, hojeMs: HOJE })).toHaveLength(0);
  });

  it('91 dias entra', () => {
    const boletos = [{ status: 'OVERDUE', due_date: dueAtrasDias(91), value: 300, customer_id: 'c', customer_name: 'B', id: 'p' }];
    expect(computeNegativacaoCandidates({ boletos, hojeMs: HOJE })).toHaveLength(1);
  });

  it('só conta OVERDUE — pendente/pago do mesmo cliente não afeta o alvo nem o total', () => {
    const boletos = [
      { status: 'OVERDUE', due_date: dueAtrasDias(100), value: 300, customer_id: 'c', customer_name: 'B', id: 'p1' },
      { status: 'PENDING', due_date: dueAtrasDias(10), value: 300, customer_id: 'c', customer_name: 'B', id: 'p2' },
      { status: 'RECEIVED', due_date: dueAtrasDias(200), value: 300, customer_id: 'c', customer_name: 'B', id: 'p3' },
    ];
    const r = computeNegativacaoCandidates({ boletos, hojeMs: HOJE });
    expect(r[0].parcelasVencidas).toBe(1);
    expect(r[0].totalVencido).toBe(300);
  });

  it('sem customerId ou sem cobrança-alvo: pronto=false (não dá p/ negativar)', () => {
    const semId = [{ status: 'OVERDUE', due_date: dueAtrasDias(150), value: 300, customer_cpf: '123', customer_name: 'B', id: 'p' }];
    expect(computeNegativacaoCandidates({ boletos: semId, hojeMs: HOJE })[0].pronto).toBe(false);
    const comId = [{ status: 'OVERDUE', due_date: dueAtrasDias(150), value: 300, customer_id: 'c', customer_name: 'B', id: 'p' }];
    expect(computeNegativacaoCandidates({ boletos: comId, hojeMs: HOJE })[0].pronto).toBe(true);
  });

  it('ordena por atraso desc', () => {
    const boletos = [
      { status: 'OVERDUE', due_date: dueAtrasDias(100), value: 1, customer_id: 'a', customer_name: 'A', id: 'p' },
      { status: 'OVERDUE', due_date: dueAtrasDias(300), value: 1, customer_id: 'b', customer_name: 'B', id: 'p' },
      { status: 'OVERDUE', due_date: dueAtrasDias(200), value: 1, customer_id: 'd', customer_name: 'D', id: 'p' },
    ];
    const r = computeNegativacaoCandidates({ boletos, hojeMs: HOJE });
    expect(r.map((x) => x.diasAtraso)).toEqual([300, 200, 100]);
  });

});

describe('resumoNegativacao', () => {
  it('custo = nº de prontos × R$ 9,90', () => {
    const cand = [
      { pronto: true, totalVencido: 1000 }, { pronto: true, totalVencido: 500 }, { pronto: false, totalVencido: 300 },
    ];
    const r = resumoNegativacao(cand);
    expect(r.total).toBe(3);
    expect(r.prontos).toBe(2);
    expect(r.faltamDados).toBe(1);
    expect(r.totalEmAberto).toBe(1800);
    expect(r.custoTodosProntos).toBe(19.8);
    expect(NEGATIVACAO_FEE).toBe(9.9);
  });
});

describe('computeRecuperado', () => {
  const dunning = (payment, requestDate) => ({ payment, requestDate });
  const boleto = (id, customer_id, value, payment_date) => ({ id, customer_id, value, payment_date });

  it('parcela paga dentro de 60d após a negativação conta como recuperado', () => {
    const r = computeRecuperado({
      dunnings: [dunning('pay_neg', '2026-05-01')],
      custByPayment: new Map([['pay_neg', 'cus_1']]),
      paidBoletos: [
        boleto('b1', 'cus_1', 300, '2026-05-20'), // 19 dias depois -> conta
        boleto('b2', 'cus_1', 300, '2026-06-15'), // 45 dias depois -> conta
      ],
    });
    expect(r.valorRecuperado).toBe(600);
    expect(r.boletosRecuperados).toBe(2);
    expect(r.clientesRecuperados).toBe(1);
  });

  it('pagamento ANTES da negativação ou depois de 60d não conta', () => {
    const r = computeRecuperado({
      dunnings: [dunning('pay_neg', '2026-05-01')],
      custByPayment: { pay_neg: 'cus_1' },
      paidBoletos: [
        boleto('b0', 'cus_1', 300, '2026-04-20'), // antes -> não
        boleto('b3', 'cus_1', 300, '2026-07-15'), // 75 dias -> não
        boleto('b1', 'cus_1', 300, '2026-05-10'), // dentro -> sim
      ],
    });
    expect(r.valorRecuperado).toBe(300);
    expect(r.boletosRecuperados).toBe(1);
  });

  it('exatamente 60 dias entra; 61 não', () => {
    const base = { dunnings: [dunning('p', '2026-05-01')], custByPayment: { p: 'c' } };
    expect(computeRecuperado({ ...base, paidBoletos: [boleto('b', 'c', 100, '2026-06-30')] }).valorRecuperado).toBe(100); // 60d
    expect(computeRecuperado({ ...base, paidBoletos: [boleto('b', 'c', 100, '2026-07-01')] }).valorRecuperado).toBe(0);   // 61d
  });

  it('dedup: mesmo boleto em janelas de 2 negativações do mesmo cliente conta 1×', () => {
    const r = computeRecuperado({
      dunnings: [dunning('pA', '2026-05-01'), dunning('pB', '2026-05-10')],
      custByPayment: { pA: 'c', pB: 'c' },
      paidBoletos: [boleto('b1', 'c', 300, '2026-05-20')],
    });
    expect(r.valorRecuperado).toBe(300);
    expect(r.boletosRecuperados).toBe(1);
  });

  it('só conta pagamento do cliente da negativação (não de outro)', () => {
    const r = computeRecuperado({
      dunnings: [dunning('pay_neg', '2026-05-01')],
      custByPayment: { pay_neg: 'cus_1' },
      paidBoletos: [boleto('b', 'cus_OUTRO', 500, '2026-05-15')],
    });
    expect(r.valorRecuperado).toBe(0);
  });

  it('negativação sem requestDate ou sem cliente resolvido é ignorada; datetime ISO no pagamento funciona', () => {
    expect(computeRecuperado({ dunnings: [dunning('p', null)], custByPayment: { p: 'c' }, paidBoletos: [boleto('b', 'c', 1, '2026-05-05')] }).valorRecuperado).toBe(0);
    expect(computeRecuperado({ dunnings: [dunning('p', '2026-05-01')], custByPayment: {}, paidBoletos: [boleto('b', 'c', 1, '2026-05-05')] }).valorRecuperado).toBe(0);
    expect(computeRecuperado({ dunnings: [dunning('p', '2026-05-01')], custByPayment: { p: 'c' }, paidBoletos: [boleto('b', 'c', 250, '2026-05-05T14:30:00Z')] }).valorRecuperado).toBe(250);
  });

  it('sem dados retorna zeros', () => {
    const r = computeRecuperado({ dunnings: [], custByPayment: new Map(), paidBoletos: [] });
    expect(r).toEqual({ valorRecuperado: 0, boletosRecuperados: 0, clientesRecuperados: 0 });
  });
});
