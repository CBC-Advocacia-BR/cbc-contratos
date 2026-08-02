// (auditoria 01/08/2026 — itens 240 e 241) A auditoria do Meet media ha meses quanto
// tempo o cliente ficou na call, e o funil so usava compareceu/nao. Estes testes travam
// as duas regras que dependem disso: o que conta como "entrou e saiu" (nao e no-show, e
// nao e comparecimento) e a partir de quantas calls faz sentido comparar duas pessoas.
import { describe, it, expect } from 'vitest';
import { computeDuracaoCalls, computeFunilPorVendedora } from '../../components/funnel/funnelCompute';

const call = (over = {}) => ({
  status: 'realizada', origem_status: 'meet',
  duracao_faixa: 'padrao (10-20min)', conectou_e_caiu: false, meet_cliente_seg: 900, ...over,
});

describe('computeDuracaoCalls — item 240', () => {
  it('so olha o que passou pela auditoria do Meet', () => {
    // eventos julgados pela COR da agenda (ate maio/2026) nao tem duracao nenhuma
    const porCor = [{ status: 'realizada', origem_status: 'cor', duracao_faixa: null }];
    expect(computeDuracaoCalls(porCor)).toBe(null);
    expect(computeDuracaoCalls([])).toBe(null);
    expect(computeDuracaoCalls(null)).toBe(null);
  });

  it('separa as tres duracoes das calls que aconteceram', () => {
    const r = computeDuracaoCalls([
      call({ duracao_faixa: 'curta (5-10min)', meet_cliente_seg: 400 }),
      call({ duracao_faixa: 'padrao (10-20min)', meet_cliente_seg: 900 }),
      call({ duracao_faixa: 'padrao (10-20min)', meet_cliente_seg: 1000 }),
      call({ duracao_faixa: 'longa (20min+)', meet_cliente_seg: 1800 }),
    ]);
    expect(r.realizadas).toBe(4);
    expect([r.curta, r.padrao, r.longa]).toEqual([1, 2, 1]);
    expect(r.pctCurta).toBeCloseTo(25, 5);
  });

  it('"entrou e saiu" NAO conta como call realizada nem como quem nunca apareceu', () => {
    const r = computeDuracaoCalls([
      call({ duracao_faixa: 'entrou e saiu', conectou_e_caiu: true, meet_cliente_seg: 43 }),
      call({ duracao_faixa: 'nao entrou', meet_cliente_seg: 0 }),
      call(),
    ]);
    expect(r.conectouECaiu).toBe(1);
    expect(r.naoEntrou).toBe(1);
    expect(r.realizadas).toBe(1);      // so a call de 15 min
    expect(r.auditadas).toBe(3);       // mas as 3 passaram pela auditoria
  });

  it('mediana ignora quem entrou e saiu (senao a duracao tipica despenca)', () => {
    // 4s no meio de calls de 15-20 min puxaria a mediana para baixo e diria que a
    // videochamada tipica do escritorio e curta, o que seria falso
    const r = computeDuracaoCalls([
      call({ meet_cliente_seg: 900 }),
      call({ meet_cliente_seg: 1200 }),
      call({ meet_cliente_seg: 4, duracao_faixa: 'entrou e saiu', conectou_e_caiu: true }),
    ]);
    expect(r.medianaMin).toBe(17.5); // (900+1200)/2 = 1050s
  });
});

describe('computeFunilPorVendedora — item 241', () => {
  const linha = (over = {}) => ({
    vendedora_email: 'a@cbc.com', mes: '2026-07-01', agendadas: 20, auditadas: 20,
    compareceu: 16, conectou_e_caiu: 1, nao_entrou: 3, mediana_min: 16, ...over,
  });

  it('soma os meses da mesma pessoa', () => {
    const r = computeFunilPorVendedora([
      linha({ mes: '2026-06-01', auditadas: 10, compareceu: 8 }),
      linha({ mes: '2026-07-01', auditadas: 20, compareceu: 16 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].auditadas).toBe(30);
    expect(r[0].compareceu).toBe(24);
    expect(r[0].pctComparecimento).toBeCloseTo(80, 5);
  });

  it('abaixo de 10 calls auditadas NAO exibe percentual', () => {
    // com 4 calls, 75% e 100% distam de UMA call — ranquear pessoas com isso e injusto
    const r = computeFunilPorVendedora([linha({ auditadas: 4, compareceu: 3 })]);
    expect(r[0].amostraSuficiente).toBe(false);
    expect(r[0].pctComparecimento).toBe(null);
    expect(r[0].auditadas).toBe(4); // a contagem crua continua visivel
  });

  it('duracao media pondera pelas calls do mes, nao pela media das medianas', () => {
    // 1 mes com 1 call de 30min e outro com 19 de 10min nao dao 20min de media
    const r = computeFunilPorVendedora([
      linha({ mes: '2026-06-01', auditadas: 1, compareceu: 1, mediana_min: 30 }),
      linha({ mes: '2026-07-01', auditadas: 19, compareceu: 19, mediana_min: 10 }),
    ]);
    expect(r[0].duracaoMediaMin).toBe(11); // (30*1 + 10*19)/20
  });

  it('filtra por mes quando pedido', () => {
    const r = computeFunilPorVendedora([
      linha({ mes: '2026-06-01', auditadas: 99 }),
      linha({ mes: '2026-07-01', auditadas: 20 }),
    ], '2026-07');
    expect(r[0].auditadas).toBe(20);
  });

  it('ordena por volume de calls auditadas, nao por percentual', () => {
    const r = computeFunilPorVendedora([
      linha({ vendedora_email: 'pouco@cbc.com', auditadas: 12, compareceu: 12 }),
      linha({ vendedora_email: 'muito@cbc.com', auditadas: 150, compareceu: 100 }),
    ]);
    expect(r.map((x) => x.email)).toEqual(['muito@cbc.com', 'pouco@cbc.com']);
  });

  it('sem linhas devolve null', () => {
    expect(computeFunilPorVendedora([])).toBe(null);
    expect(computeFunilPorVendedora(null)).toBe(null);
    expect(computeFunilPorVendedora([{ vendedora_email: null }])).toBe(null);
  });
});
