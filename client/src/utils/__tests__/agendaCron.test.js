// Teste da decisao PURA do cron da Ana (agenda-bot-cron.mjs): qual lembrete disparar dado
// quantos minutos faltam para o horario marcado + quais lembretes ja foram enviados. A
// orquestracao (RPCs, Kommo, Calendar, janela de 24h da Meta) fica sem unit test — validada
// no piloto (Task 15), mesmo padrao de agenda-bot-worker-background.mjs/agendaWorker.test.js.
import { describe, it, expect } from 'vitest';
import { decidirLembrete } from '../../../netlify/functions/agenda-bot-cron.mjs';

const vc = (over = {}) => ({ status: 'agendada', lembrete_1h_em: null, lembrete_t0_em: null, noshow_msg_em: null, ...over });

describe('decidirLembrete', () => {
  it('dispara lembrete_1h entre 60 e 40 minutos antes, se ainda nao marcado', () => {
    expect(decidirLembrete(vc(), 60)).toBe('lembrete_1h');
    expect(decidirLembrete(vc(), 50)).toBe('lembrete_1h');
    expect(decidirLembrete(vc(), 41)).toBe('lembrete_1h');
  });

  it('nao repete lembrete_1h se ja marcado', () => {
    expect(decidirLembrete(vc({ lembrete_1h_em: '2026-07-21T10:00:00Z' }), 50)).toBe(null);
  });

  it('fora da janela de 60..40 nao dispara lembrete_1h (limites exclusivos)', () => {
    expect(decidirLembrete(vc(), 61)).toBe(null);
    expect(decidirLembrete(vc(), 40)).toBe(null);
  });

  it('dispara lembrete_t0 entre 2min antes e 5min depois, se ainda nao marcado', () => {
    expect(decidirLembrete(vc(), 2)).toBe('lembrete_t0');
    expect(decidirLembrete(vc(), 0)).toBe('lembrete_t0');
    expect(decidirLembrete(vc(), -4)).toBe('lembrete_t0');
  });

  it('nao repete lembrete_t0 se ja marcado', () => {
    expect(decidirLembrete(vc({ lembrete_t0_em: '2026-07-21T10:00:00Z' }), 0)).toBe(null);
  });

  it('fora da janela de T0 nao dispara (limites exclusivos)', () => {
    expect(decidirLembrete(vc(), 3)).toBe(null);
    expect(decidirLembrete(vc(), -5)).toBe(null);
  });

  it('dispara noshow entre 10 e 30 minutos depois, se ainda agendada e nao marcado', () => {
    expect(decidirLembrete(vc(), -10)).toBe('noshow');
    expect(decidirLembrete(vc(), -20)).toBe('noshow');
    expect(decidirLembrete(vc(), -29)).toBe('noshow');
  });

  it('nao repete noshow se ja marcado', () => {
    expect(decidirLembrete(vc({ noshow_msg_em: '2026-07-21T10:00:00Z' }), -20)).toBe(null);
  });

  it('nao dispara noshow se o status ja mudou (ex.: realizada/fechou/cancelada por outro fluxo)', () => {
    expect(decidirLembrete(vc({ status: 'realizada' }), -20)).toBe(null);
  });

  it('fora da janela de noshow nao dispara (limites exclusivos)', () => {
    expect(decidirLembrete(vc(), -9)).toBe(null);
    expect(decidirLembrete(vc(), -30)).toBe(null);
  });

  it('nenhuma janela bate -> null (ex.: faltando 3h, ou ja passou de 30min do horario)', () => {
    expect(decidirLembrete(vc(), 180)).toBe(null);
    expect(decidirLembrete(vc(), -180)).toBe(null);
  });
});
