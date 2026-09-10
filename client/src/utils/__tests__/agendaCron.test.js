// Teste da decisao PURA do cron da Ana (agenda-bot-cron.mjs): qual lembrete disparar dado
// quantos minutos faltam para o horario marcado + quais lembretes ja foram enviados. A
// orquestracao (RPCs, Kommo, Calendar, janela de 24h da Meta) fica sem unit test — validada
// no piloto (Task 15), mesmo padrao de agenda-bot-worker-background.mjs/agendaWorker.test.js.
import { describe, it, expect } from 'vitest';
import { decidirLembrete, resumoPlantao } from '../../../netlify/functions/agenda-bot-cron.mjs';

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

  it('lembrete_t0 fica DESLIGADO por padrao (um lembrete so, 08/09/2026) e liga com opts.t0', () => {
    expect(decidirLembrete(vc(), 2)).toBe(null);
    expect(decidirLembrete(vc(), 0)).toBe(null);
    expect(decidirLembrete(vc(), 0, { t0: true })).toBe('lembrete_t0');
    expect(decidirLembrete(vc(), -4, { t0: true })).toBe('lembrete_t0');
  });

  it('lembrete_vespera so com opts.vespera (call marcada com 2+ dias), 24h antes, uma vez', () => {
    expect(decidirLembrete(vc(), 24 * 60)).toBe(null);
    expect(decidirLembrete(vc(), 24 * 60, { vespera: true })).toBe('lembrete_vespera');
    expect(decidirLembrete(vc(), 24 * 60 - 19, { vespera: true })).toBe('lembrete_vespera');
    expect(decidirLembrete(vc(), 24 * 60 - 20, { vespera: true })).toBe(null);
    expect(decidirLembrete(vc({ lembrete_vespera_em: '2026-07-21T10:00:00Z' }), 24 * 60, { vespera: true })).toBe(null);
  });

  it('nao repete lembrete_t0 se ja marcado', () => {
    expect(decidirLembrete(vc({ lembrete_t0_em: '2026-07-21T10:00:00Z' }), 0)).toBe(null);
  });

  it('fora da janela de T0 nao dispara (limites exclusivos)', () => {
    expect(decidirLembrete(vc(), 3)).toBe(null);
    expect(decidirLembrete(vc(), -5)).toBe(null);
  });

  it('noshow so quando a auditoria do Meet confirmou (meet_status=no_show), 10min+ depois, uma vez', () => {
    expect(decidirLembrete(vc(), -15)).toBe(null); // agenda ainda 'agendada' nao basta
    expect(decidirLembrete(vc({ meet_status: 'no_show' }), -15)).toBe('noshow');
    expect(decidirLembrete(vc({ meet_status: 'no_show' }), -600)).toBe('noshow');
    expect(decidirLembrete(vc({ meet_status: 'no_show' }), -5)).toBe(null);
    expect(decidirLembrete(vc({ meet_status: 'no_show', noshow_msg_em: '2026-07-21T10:00:00Z' }), -15)).toBe(null);
    expect(decidirLembrete(vc({ meet_status: 'realizada' }), -15)).toBe(null);
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

describe('resumoPlantao', () => {
  it('3 linhas: quem, o que quer, o que falta', () => {
    const s = resumoPlantao({ nome: 'Diomar', dados: { resort: 'Praias do Lago', situacao_cota: 'quitada', valor_pago: 40000 }, nota: 3, situacao: 'handoff', agendamento: { inicio: null }, escalado: false });
    expect(s.split('\n')).toHaveLength(3);
    expect(s).toContain('Diomar');
    expect(s).toContain('Praias do Lago');
    expect(s).toMatch(/falta/i);
  });
  it('com videochamada marcada diz que esta agendada', () => {
    const s = resumoPlantao({ nome: 'X', dados: {}, agendamento: { inicio: '2026-09-07T11:30:00Z', vendedora: 'marianamaciel@advocaciacbc.com' } });
    expect(s).toMatch(/agendad/i);
  });
});
