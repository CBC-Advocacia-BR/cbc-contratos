// Testes das partes PURAS de agenda-admin.mjs (Task 10). A orquestração (JWT/Kommo/Google/
// Supabase) fica sem unit test — validada no piloto, mesmo padrão de agendaWorker.test.js.
import { describe, it, expect } from 'vitest';
import { escolherConversaPorLead, amanha10hSP } from '../../../netlify/functions/agenda-admin.mjs';

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
