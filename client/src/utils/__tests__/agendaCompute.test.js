import { describe, it, expect } from 'vitest';
import { computeFunilAna, agruparAgenda } from '../../components/agenda/compute.js';

describe('computeFunilAna', () => {
  it('monta etapas com % sobre a anterior e taxas', () => {
    const r = computeFunilAna({ conversas_iniciadas: 100, qualificadas: 60, oferta_feita: 50,
      agendadas: 30, realizadas: 18, no_show: 6, fechou: 9, handoffs: 10, tempo_resposta_med_seg: 42,
      por_vendedora: { 'a@x.com': 20, 'b@x.com': 10 } });
    expect(r.etapas.map((e) => e.n)).toEqual([100, 60, 50, 30, 18]);
    expect(r.etapas[3].pctDoAnterior).toBe(60); // 30/50
    expect(r.taxas.agendamento).toBe(30);        // 30/100
    expect(r.taxas.comparecimento).toBe(75);     // (18+... ) realizadas+fechou? NÃO: realizadas já inclui fechou na RPC? Não — ver regra abaixo
    expect(r.tempoRespostaSeg).toBe(42);
  });
});
// REGRA (fixa aqui p/ evitar ambiguidade): comparecimento = realizadas / (realizadas + no_show) * 100
// (na RPC, 'realizadas' já conta status realizada+fechou; 'fechou' é subconjunto p/ taxa de fechamento = fechou/realizadas)

describe('agruparAgenda', () => {
  it('separa hoje/amanhã/semana/passadas no fuso SP', () => {
    const agora = '2026-07-21T12:00:00-03:00';
    const g = agruparAgenda([
      { event_id: '1', scheduled_at: '2026-07-21T18:00:00-03:00', status: 'agendada' },
      { event_id: '2', scheduled_at: '2026-07-22T09:00:00-03:00', status: 'agendada' },
      { event_id: '3', scheduled_at: '2026-07-24T09:00:00-03:00', status: 'agendada' },
      { event_id: '4', scheduled_at: '2026-07-20T09:00:00-03:00', status: 'no_show' },
    ], agora);
    expect(g.hoje.map((x) => x.event_id)).toEqual(['1']);
    expect(g.amanha.map((x) => x.event_id)).toEqual(['2']);
    expect(g.semana.map((x) => x.event_id)).toEqual(['3']);
    expect(g.passadas.map((x) => x.event_id)).toEqual(['4']);
  });
});
