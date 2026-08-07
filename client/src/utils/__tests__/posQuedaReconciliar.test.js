// Quais rotinas agendadas perderam a janela de uma queda (06/08/2026).
//
// Isto decide o que sera pedido a uma pessoa para rodar a mao. Errar para MENOS deixa o
// escritorio sem backup ou sem regua de cobranca sem ninguem saber; errar para MAIS faz
// pedirem trabalho desnecessario e, repetido, ensina a ignorar o aviso. Os dois erros
// importam, por isso os limites da janela tem teste.
import { describe, it, expect } from 'vitest';
// importa a lib PURA, nao a function: importar a function carregaria o botDb junto e o
// teste tentaria abrir conexao com o banco (padrao do projeto: decisao mora em _lib/).
import { agendadasNaJanela } from '../../../netlify/functions/_lib/reconciliacao.mjs';

// lista fixa para o teste nao quebrar quando a lista real mudar
const LISTA = [
  { nome: 'backup-diario', horaUtc: 6, critico: true },
  { nome: 'cobranca-regua', horaUtc: 13, critico: true },
  { nome: 'meta-ads-sync', horaUtc: 10, critico: false },
];
const nomes = (r) => r.map((x) => x.nome).sort();

describe('agendadasNaJanela — o que realmente perdeu o horario', () => {
  it('queda que cobre o horario da rotina pega a rotina', () => {
    // 05h30 -> 07h00: o backup das 06h00 estava dentro
    const r = agendadasNaJanela('2026-08-06T05:30:00Z', '2026-08-06T07:00:00Z', LISTA);
    expect(nomes(r)).toEqual(['backup-diario']);
  });

  it('queda que nao cobre horario nenhum devolve lista vazia', () => {
    // 14h22 -> 15h39, a queda real de 06/08: nenhuma rotina critica nesse intervalo
    const r = agendadasNaJanela('2026-08-06T14:22:00Z', '2026-08-06T15:39:00Z', LISTA);
    expect(r).toEqual([]);
  });

  it('queda longa pega varias rotinas', () => {
    const r = agendadasNaJanela('2026-08-06T05:00:00Z', '2026-08-06T14:00:00Z', LISTA);
    expect(nomes(r)).toEqual(['backup-diario', 'cobranca-regua', 'meta-ads-sync']);
  });
});

describe('agendadasNaJanela — as bordas, que e onde este tipo de codigo erra', () => {
  it('rotina que rodou ANTES da queda comecar nao entra', () => {
    // o backup rodou as 06h00; a queda so comecou as 06h05. Nao ha o que refazer.
    const r = agendadasNaJanela('2026-08-06T06:05:00Z', '2026-08-06T06:50:00Z', LISTA);
    expect(r).toEqual([]);
  });

  it('rotina marcada para DEPOIS de o banco voltar nao entra', () => {
    // queda de 05h00 a 05h50; o backup das 06h00 rodou normalmente depois
    const r = agendadasNaJanela('2026-08-06T05:00:00Z', '2026-08-06T05:50:00Z', LISTA);
    expect(r).toEqual([]);
  });

  it('rotina exatamente no instante inicial entra', () => {
    const r = agendadasNaJanela('2026-08-06T06:00:00Z', '2026-08-06T06:30:00Z', LISTA);
    expect(nomes(r)).toEqual(['backup-diario']);
  });

  it('rotina exatamente no instante final entra', () => {
    const r = agendadasNaJanela('2026-08-06T05:30:00Z', '2026-08-06T06:00:00Z', LISTA);
    expect(nomes(r)).toEqual(['backup-diario']);
  });

  it('queda que atravessa a virada do dia pega a rotina da madrugada seguinte', () => {
    const r = agendadasNaJanela('2026-08-06T23:00:00Z', '2026-08-07T07:00:00Z', LISTA);
    expect(nomes(r)).toEqual(['backup-diario']);
  });
});

describe('agendadasNaJanela — entradas defeituosas nao podem gerar pedido falso', () => {
  it('datas invalidas devolvem vazio', () => {
    expect(agendadasNaJanela('qualquer coisa', '2026-08-06T07:00:00Z', LISTA)).toEqual([]);
    expect(agendadasNaJanela('2026-08-06T05:00:00Z', 'nao-e-data', LISTA)).toEqual([]);
  });

  it('fim antes do inicio devolve vazio', () => {
    expect(agendadasNaJanela('2026-08-06T09:00:00Z', '2026-08-06T05:00:00Z', LISTA)).toEqual([]);
  });

  it('janela absurdamente longa nao trava nem explode', () => {
    const r = agendadasNaJanela('2020-01-01T00:00:00Z', '2026-08-06T00:00:00Z', LISTA);
    expect(Array.isArray(r)).toBe(true);
    expect(nomes(r)).toEqual(['backup-diario', 'cobranca-regua', 'meta-ads-sync']);
  });
});
