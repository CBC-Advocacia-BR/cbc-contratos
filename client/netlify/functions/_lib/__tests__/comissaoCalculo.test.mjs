// (auditoria 01/08/2026 — item 296) Contas da comissao dos vendedores.
//
// Este calculo roda 1x por mes, sozinho, e o resultado vira PAGAMENTO. Se a janela do
// periodo deslizar um dia, contratos entram ou saem do mes errado; se a faixa escolher o
// degrau vizinho, a pessoa recebe a mais ou a menos. Nada disso da erro na tela.
import { describe, it, expect } from 'vitest';
import { getPeriodFromMonth, currentPeriodFromDate, getFaixa, isPromocaoAplicavel } from '../comissaoCalculo.mjs';

describe('getPeriodFromMonth — a janela nao e o mes civil (dia 20 a 19)', () => {
  it('agosto/2026 vai de 20/07 a 19/08', () => {
    expect(getPeriodFromMonth('2026-08')).toEqual({ start: '2026-07-20', end: '2026-08-19' });
  });

  it('janeiro puxa dezembro do ano ANTERIOR (virada de ano)', () => {
    expect(getPeriodFromMonth('2026-01')).toEqual({ start: '2025-12-20', end: '2026-01-19' });
  });

  it('marco de ano bissexto fecha certo (fevereiro tem 29)', () => {
    expect(getPeriodFromMonth('2028-03')).toEqual({ start: '2028-02-20', end: '2028-03-19' });
  });

  it('respeita um dia de inicio diferente', () => {
    expect(getPeriodFromMonth('2026-08', 1)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(getPeriodFromMonth('2026-08', 5)).toEqual({ start: '2026-07-05', end: '2026-08-04' });
  });

  it('a janela e continua: o inicio de um mes e o dia seguinte ao fim do anterior', () => {
    const jul = getPeriodFromMonth('2026-07');
    const ago = getPeriodFromMonth('2026-08');
    const diaSeguinte = new Date(Date.UTC(...jul.end.split('-').map((n, i) => (i === 1 ? +n - 1 : +n))));
    diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1);
    expect(ago.start).toBe(diaSeguinte.toISOString().slice(0, 10));
  });
});

describe('currentPeriodFromDate — em que janela cai uma data', () => {
  it('antes do dia 20, a janela fecha NESTE mes', () => {
    expect(currentPeriodFromDate(new Date('2026-08-02T12:00:00Z')))
      .toEqual({ start: '2026-07-20', end: '2026-08-19' });
  });

  it('do dia 20 em diante, a janela fecha no mes SEGUINTE', () => {
    expect(currentPeriodFromDate(new Date('2026-08-20T00:00:00Z')))
      .toEqual({ start: '2026-08-20', end: '2026-09-19' });
  });

  it('dia 19 e dia 20 caem em janelas DIFERENTES (a fronteira exata)', () => {
    const d19 = currentPeriodFromDate(new Date('2026-08-19T23:00:00Z'));
    const d20 = currentPeriodFromDate(new Date('2026-08-20T01:00:00Z'));
    expect(d19.end).toBe('2026-08-19');
    expect(d20.end).toBe('2026-09-19');
  });

  it('dezembro depois do dia 20 vira janela de janeiro do ano seguinte', () => {
    expect(currentPeriodFromDate(new Date('2026-12-27T10:00:00Z')))
      .toEqual({ start: '2026-12-20', end: '2027-01-19' });
  });
});

describe('getFaixa — o degrau da tabela de comissao', () => {
  const faixas = [
    { min: 1, max: 4, valor: 100 },
    { min: 5, max: 9, valor: 150 },
    { min: 10, max: null, valor: 250 }, // daqui para cima
  ];

  it('escolhe o degrau certo dentro da faixa', () => {
    expect(getFaixa(faixas, 3)).toEqual({ faixa: '1-4', valor: 100 });
    expect(getFaixa(faixas, 7)).toEqual({ faixa: '5-9', valor: 150 });
  });

  it('as BORDAS pertencem ao degrau (4 e 5 nao podem cair no mesmo)', () => {
    expect(getFaixa(faixas, 4).valor).toBe(100);
    expect(getFaixa(faixas, 5).valor).toBe(150);
    expect(getFaixa(faixas, 9).valor).toBe(150);
    expect(getFaixa(faixas, 10).valor).toBe(250);
  });

  it('faixa aberta no topo pega qualquer quantidade acima', () => {
    expect(getFaixa(faixas, 1000)).toEqual({ faixa: '10-+', valor: 250 });
  });

  it('quantidade abaixo do primeiro degrau devolve null (nao paga)', () => {
    expect(getFaixa(faixas, 0)).toBe(null);
  });

  it('configuracao ausente/invalida devolve null em vez de quebrar o calculo do mes', () => {
    expect(getFaixa(null, 5)).toBe(null);
    expect(getFaixa(undefined, 5)).toBe(null);
    expect(getFaixa([], 5)).toBe(null);
  });

  it('valor nao numerico vira 0 (nunca NaN dentro de um pagamento)', () => {
    expect(getFaixa([{ min: 1, max: null, valor: 'abc' }], 2).valor).toBe(0);
  });

  it('numeros gravados como TEXTO no JSON de config ainda funcionam', () => {
    expect(getFaixa([{ min: '1', max: '4', valor: '100' }], 3)).toEqual({ faixa: '1-4', valor: 100 });
  });
});

describe('isPromocaoAplicavel — a promocao vale para este contrato?', () => {
  const promo = { data_inicio: '2026-07-01', data_fim: '2026-07-31', resort_filtro: null, tipo_acao_filtro: null };
  const contrato = (over) => ({ signed_at: '2026-07-15T10:00:00Z', resort: 'ONDAS PRAIA', tipo_acao: 'Distrato', ...over });

  it('dentro do periodo, sem filtro, vale', () => {
    expect(isPromocaoAplicavel(promo, contrato())).toBe(true);
  });

  it('o primeiro e o ultimo dia CONTAM', () => {
    expect(isPromocaoAplicavel(promo, contrato({ signed_at: '2026-07-01T00:00:00Z' }))).toBe(true);
    expect(isPromocaoAplicavel(promo, contrato({ signed_at: '2026-07-31T23:59:00Z' }))).toBe(true);
  });

  it('um dia fora, de cada lado, nao vale', () => {
    expect(isPromocaoAplicavel(promo, contrato({ signed_at: '2026-06-30T23:00:00Z' }))).toBe(false);
    expect(isPromocaoAplicavel(promo, contrato({ signed_at: '2026-08-01T00:00:00Z' }))).toBe(false);
  });

  it('contrato SEM data de assinatura nunca ganha promocao', () => {
    expect(isPromocaoAplicavel(promo, contrato({ signed_at: null }))).toBe(false);
    expect(isPromocaoAplicavel(promo, contrato({ signed_at: '' }))).toBe(false);
  });

  it('filtro de resort restringe', () => {
    const so = { ...promo, resort_filtro: 'ONDAS PRAIA' };
    expect(isPromocaoAplicavel(so, contrato())).toBe(true);
    expect(isPromocaoAplicavel(so, contrato({ resort: 'HOT BEACH' }))).toBe(false);
  });

  it('filtro de tipo de acao restringe', () => {
    const so = { ...promo, tipo_acao_filtro: 'Distrato' };
    expect(isPromocaoAplicavel(so, contrato())).toBe(true);
    expect(isPromocaoAplicavel(so, contrato({ tipo_acao: 'Revisão de Distrato' }))).toBe(false);
  });

  it('os dois filtros juntos exigem os DOIS', () => {
    const so = { ...promo, resort_filtro: 'ONDAS PRAIA', tipo_acao_filtro: 'Distrato' };
    expect(isPromocaoAplicavel(so, contrato())).toBe(true);
    expect(isPromocaoAplicavel(so, contrato({ resort: 'HOT BEACH' }))).toBe(false);
    expect(isPromocaoAplicavel(so, contrato({ tipo_acao: 'Cobrança' }))).toBe(false);
  });
});
