// diaBrt/diaBrtDe (31/07/2026) — dia BRT no runtime UTC das Functions.
// Cenario do bug: 21h-24h BRT, quando o toISOString() cru ja devolve amanha.
import { describe, it, expect } from 'vitest';
import { diaBrt, diaBrtDe } from '../dataBrt.mjs';

describe('diaBrtDe', () => {
  it('21h30 BRT ainda e o dia 31 (UTC ja virou 01/08)', () => {
    expect(diaBrtDe('2026-08-01T00:30:00Z')).toBe('2026-07-31');
  });

  it('ultimo instante antes da meia-noite BRT', () => {
    expect(diaBrtDe('2026-08-01T02:59:59Z')).toBe('2026-07-31');
  });

  it('meia-noite BRT exata ja e o dia novo', () => {
    expect(diaBrtDe('2026-08-01T03:00:00Z')).toBe('2026-08-01');
  });

  it('horario comercial: dias UTC e BRT coincidem', () => {
    expect(diaBrtDe('2026-07-31T18:00:00Z')).toBe('2026-07-31');
  });

  it('aceita Date e epoch ms', () => {
    expect(diaBrtDe(new Date('2026-08-01T01:00:00Z'))).toBe('2026-07-31');
    expect(diaBrtDe(Date.UTC(2026, 7, 1, 1, 0, 0))).toBe('2026-07-31');
  });
});

describe('diaBrt', () => {
  it('devolve YYYY-MM-DD', () => {
    expect(diaBrt()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('menosDias equivale a voltar 24h', () => {
    expect(diaBrtDe(Date.UTC(2026, 6, 31, 12) - 86400000)).toBe('2026-07-30');
  });
});
