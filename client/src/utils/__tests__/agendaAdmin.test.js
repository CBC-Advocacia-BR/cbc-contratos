// Testes das partes PURAS de agenda-admin.mjs (Task 10 + fixes pos-review). A orquestração
// (JWT/Kommo/Google/Supabase) fica sem unit test — validada no piloto, mesmo padrão de
// agendaWorker.test.js.
import { describe, it, expect } from 'vitest';
import {
  escolherConversaPorLead, amanha10hSP,
  resolverCalendarId, podeOperar, resetDesfechoAoReagendar, channelPertenceAoLead,
} from '../../../netlify/functions/agenda-admin.mjs';

describe('escolherConversaPorLead', () => {
  it('retorna null p/ lista vazia ou ausente', () => {
    expect(escolherConversaPorLead([])).toBe(null);
    expect(escolherConversaPorLead(null)).toBe(null);
    expect(escolherConversaPorLead(undefined)).toBe(null);
  });

  it('escolhe a linha unica quando so ha uma candidata', () => {
    const row = { channel: 'agenda:5511999998888', updated_at: '2026-07-20T10:00:00Z' };
    expect(escolherConversaPorLead([row])).toBe(row);
  });

  it('escolhe a mais recente por updated_at, em qualquer ordem de entrada', () => {
    const antiga = { channel: 'agenda:A', updated_at: '2026-07-01T10:00:00Z' };
    const recente = { channel: 'agenda:B', updated_at: '2026-07-20T10:00:00Z' };
    const meio = { channel: 'agenda:C', updated_at: '2026-07-10T10:00:00Z' };
    expect(escolherConversaPorLead([antiga, recente, meio])).toBe(recente);
    expect(escolherConversaPorLead([recente, antiga, meio])).toBe(recente);
  });
});

describe('amanha10hSP', () => {
  it('retorna ISO do dia seguinte as 10h, offset -03:00', () => {
    const agora = new Date('2026-07-21T18:30:00-03:00'); // terça à noite em SP
    expect(amanha10hSP(agora)).toBe('2026-07-22T10:00:00-03:00');
  });

  it('atravessa virada de mes corretamente', () => {
    const agora = new Date('2026-07-31T23:00:00-03:00');
    expect(amanha10hSP(agora)).toBe('2026-08-01T10:00:00-03:00');
  });

  it('atravessa virada de ano corretamente', () => {
    const agora = new Date('2026-12-31T12:00:00-03:00');
    expect(amanha10hSP(agora)).toBe('2027-01-01T10:00:00-03:00');
  });
});

// Fix pos-review item 1/2: cancelar/reagendar/desfecho usavam vendedora_email do BODY como
// calendarId; se divergisse do dono real do evento, cancelEvent tolera 404 e grava sucesso
// sem tocar o evento real (que fica esquecido na agenda certa).
describe('resolverCalendarId', () => {
  it('usa o real (atual.vendedora_email) quando body bate ou vem vazio', () => {
    const atual = { vendedora_email: 'beatriz@advocaciacbc.com' };
    expect(resolverCalendarId(atual, 'beatriz@advocaciacbc.com')).toEqual({ calendarId: 'beatriz@advocaciacbc.com', divergiu: false });
    expect(resolverCalendarId(atual, undefined)).toEqual({ calendarId: 'beatriz@advocaciacbc.com', divergiu: false });
    expect(resolverCalendarId(atual, '')).toEqual({ calendarId: 'beatriz@advocaciacbc.com', divergiu: false });
  });

  it('ignora o body quando diverge do real, mas sinaliza divergiu=true', () => {
    const atual = { vendedora_email: 'beatriz@advocaciacbc.com' };
    expect(resolverCalendarId(atual, 'marianamaciel@advocaciacbc.com')).toEqual({ calendarId: 'beatriz@advocaciacbc.com', divergiu: true });
  });

  it('nao sinaliza divergencia por diferenca de maiusculas/minusculas', () => {
    const atual = { vendedora_email: 'beatriz@advocaciacbc.com' };
    expect(resolverCalendarId(atual, 'BEATRIZ@advocaciacbc.com')).toEqual({ calendarId: 'beatriz@advocaciacbc.com', divergiu: false });
  });

  it('retorna calendarId null se atual nao tiver vendedora_email (nao deveria acontecer, mas nao quebra)', () => {
    expect(resolverCalendarId({}, 'x@advocaciacbc.com')).toEqual({ calendarId: null, divergiu: false });
  });
});

// Fix pos-review item 3: autorizacao so por dominio @advocaciacbc.com — precisa da permissao
// REAL (user_permissions.tabs.agenda OU is_admin), igual ao que decide se a aba aparece no front.
describe('podeOperar', () => {
  it('nega quando nao ha linha de permissao (perms null/undefined)', () => {
    expect(podeOperar(null)).toBe(false);
    expect(podeOperar(undefined)).toBe(false);
  });

  it('nega quando tabs.agenda nao esta true e is_admin nao e true', () => {
    expect(podeOperar({ is_admin: false, tabs: {} })).toBe(false);
    expect(podeOperar({ is_admin: false, tabs: { agenda: false } })).toBe(false);
    expect(podeOperar({ is_admin: false, tabs: null })).toBe(false);
  });

  it('permite quando tabs.agenda=true', () => {
    expect(podeOperar({ is_admin: false, tabs: { agenda: true } })).toBe(true);
  });

  it('permite quando is_admin=true, mesmo sem tabs.agenda', () => {
    expect(podeOperar({ is_admin: true, tabs: {} })).toBe(true);
    expect(podeOperar({ is_admin: true, tabs: null })).toBe(true);
  });
});

// Fix pos-review item 4: reagendar uma linha ja concluida (no_show/realizada/fechou) precisa
// resetar o desfecho, senao agenda_bot_metricas continua contando o atendimento ANTERIOR.
describe('resetDesfechoAoReagendar', () => {
  it('reseta status/color_id quando o status atual e um desfecho concluido', () => {
    expect(resetDesfechoAoReagendar('no_show')).toEqual({ status: 'agendada', color_id: null });
    expect(resetDesfechoAoReagendar('realizada')).toEqual({ status: 'agendada', color_id: null });
    expect(resetDesfechoAoReagendar('fechou')).toEqual({ status: 'agendada', color_id: null });
  });

  it('nao mexe em nada quando o status atual ja e agendada (ou outro)', () => {
    expect(resetDesfechoAoReagendar('agendada')).toEqual({});
    expect(resetDesfechoAoReagendar('excluida')).toEqual({});
    expect(resetDesfechoAoReagendar(undefined)).toEqual({});
  });
});

// Fix pos-review item 5: pausar_lead com channel explicito so podia rejeitar quando
// context.lead_id EXISTIA e divergia; se null/ausente, pausava a conversa errada.
describe('channelPertenceAoLead', () => {
  it('rejeita quando o lead_id do contexto e null ou ausente (nao pausa as cegas)', () => {
    expect(channelPertenceAoLead(null, 123)).toBe(false);
    expect(channelPertenceAoLead(undefined, 123)).toBe(false);
  });

  it('aceita quando bate, inclusive com tipos diferentes (number vs string)', () => {
    expect(channelPertenceAoLead(123, 123)).toBe(true);
    expect(channelPertenceAoLead(123, '123')).toBe(true);
    expect(channelPertenceAoLead('123', 123)).toBe(true);
  });

  it('rejeita quando diverge', () => {
    expect(channelPertenceAoLead(123, 456)).toBe(false);
  });
});
