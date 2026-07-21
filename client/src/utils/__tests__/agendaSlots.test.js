import { describe, it, expect } from 'vitest';
import { gerarSlots, sortearVendedora, slotMaisProximo, formatarSlot, dentroDoExpediente } from '../../../netlify/functions/_lib/agendaSlots.mjs';

const REGRAS = { dias: [1,2,3,4,5], hora_inicio: '08:00', hora_fim: '17:00', granularidade_min: 30,
  antecedencia_min_minutos: 60, horizonte_dias_uteis: 5, almoco: null, slots_por_oferta: 2,
  duracao_evento_min: 30, feriados: [] };
const V = ['a@x.com', 'b@x.com'];
// terça-feira 10h00 São Paulo (UTC-3)
const AGORA = new Date('2026-07-21T13:00:00Z');

describe('gerarSlots', () => {
  it('gera slots :00/:30 dentro do expediente, respeitando antecedência mínima', () => {
    const slots = gerarSlots({ regras: REGRAS, busyPorVendedora: { 'a@x.com': [], 'b@x.com': [] }, agora: AGORA });
    expect(slots.length).toBeGreaterThan(0);
    const first = slots[0];
    expect(first.inicio.getTime()).toBeGreaterThanOrEqual(AGORA.getTime() + 60 * 60000);
    for (const s of slots) {
      const local = new Date(s.inicio.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      expect([0, 30]).toContain(local.getMinutes());
      expect(dentroDoExpediente(s.inicio, REGRAS)).toBe(true);
    }
  });
  it('exclui vendedora ocupada e slot sem ninguém livre', () => {
    const busy = { 'a@x.com': [{ start: '2026-07-21T14:00:00Z', end: '2026-07-21T15:00:00Z' }], 'b@x.com': [] };
    const slots = gerarSlots({ regras: REGRAS, busyPorVendedora: busy, agora: AGORA });
    const das11 = slots.find((s) => s.inicio.toISOString() === '2026-07-21T14:00:00.000Z'); // 11h local
    expect(das11.vendedoras).toEqual(['b@x.com']);
    const busyAll = { 'a@x.com': busy['a@x.com'], 'b@x.com': busy['a@x.com'] };
    const slots2 = gerarSlots({ regras: REGRAS, busyPorVendedora: busyAll, agora: AGORA });
    expect(slots2.find((s) => s.inicio.toISOString() === '2026-07-21T14:00:00.000Z')).toBeUndefined();
  });
  it('pula fim de semana e feriado', () => {
    const sexta17 = new Date('2026-07-24T19:30:00Z'); // sexta 16h30 local
    const slots = gerarSlots({ regras: { ...REGRAS, feriados: ['2026-07-27'] }, busyPorVendedora: { 'a@x.com': [] }, agora: sexta17 });
    // próximo dia útil não-feriado = terça 28/07
    const dias = new Set(slots.map((s) => s.inicio.toISOString().slice(0, 10)));
    expect(dias.has('2026-07-25')).toBe(false);
    expect(dias.has('2026-07-26')).toBe(false);
    expect(dias.has('2026-07-27')).toBe(false);
  });
});

describe('sortearVendedora', () => {
  it('é determinístico por seed e respeita peso 100/0', () => {
    const vends = [{ email: 'a@x.com', peso: 100, ativa: true }, { email: 'b@x.com', peso: 0, ativa: true }];
    expect(sortearVendedora(vends, ['a@x.com', 'b@x.com'], 'lead-1')).toBe('a@x.com');
  });
  it('ignora inativa e quem não está livre', () => {
    const vends = [{ email: 'a@x.com', peso: 60, ativa: false }, { email: 'b@x.com', peso: 20, ativa: true }];
    expect(sortearVendedora(vends, ['a@x.com', 'b@x.com'], 's')).toBe('b@x.com');
    expect(sortearVendedora(vends, ['a@x.com'], 's')).toBe(null);
  });
});

describe('slotMaisProximo/formatarSlot', () => {
  it('acha o mais próximo do pedido', () => {
    const slots = [{ inicio: new Date('2026-07-22T12:00:00Z') }, { inicio: new Date('2026-07-22T17:00:00Z') }];
    expect(slotMaisProximo(slots, '2026-07-22T16:00:00Z').inicio.toISOString()).toBe('2026-07-22T17:00:00.000Z');
    expect(slotMaisProximo([], '2026-07-22T16:00:00Z')).toBe(null);
  });
  it('formata pt-BR relativo', () => {
    expect(formatarSlot(new Date('2026-07-21T17:30:00Z'), AGORA)).toBe('hoje às 14h30');
    expect(formatarSlot(new Date('2026-07-22T12:00:00Z'), AGORA)).toBe('amanhã às 9h');
    expect(formatarSlot(new Date('2026-07-23T13:00:00Z'), AGORA)).toBe('quinta (23/07) às 10h');
  });
});
