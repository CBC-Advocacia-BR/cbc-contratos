// ymLocal (31/07/2026) — mes "YYYY-MM" em HORA LOCAL, nunca UTC.
// Bug original: card "Honorarios lancados no mes" (AsaasPanel) usava
// toISOString().slice(0,7); apos as 21h BRT do ultimo dia do mes o UTC ja
// esta no mes seguinte => card zerava e "mes passado" pulava para o retrasado
// (31/07 22h mostrou 0 em julho e junho como mes passado).
import { describe, it, expect } from 'vitest';
import { ymLocal, ymdLocal } from '../format.js';

describe('ymLocal', () => {
  it('noite de fim de mes continua no mes local (cenario do bug)', () => {
    // 31/07/2026 22:18 local — em BRT o toISOString() daria 2026-08
    expect(ymLocal(new Date(2026, 6, 31, 22, 18))).toBe('2026-07');
  });

  it('dia comum', () => {
    expect(ymLocal(new Date(2026, 6, 15, 10, 0))).toBe('2026-07');
  });

  it('zero-pad de mes < 10', () => {
    expect(ymLocal(new Date(2026, 2, 5))).toBe('2026-03');
  });

  it('mes anterior na virada de ano (janeiro -> dezembro)', () => {
    const jan = new Date(2027, 0, 31, 23, 0);
    const anterior = new Date(jan.getFullYear(), jan.getMonth() - 1, 1);
    expect(ymLocal(anterior)).toBe('2026-12');
  });
});

describe('ymdLocal', () => {
  it('noite continua no dia local (22h18 de 31/07 nao vira 01/08)', () => {
    expect(ymdLocal(new Date(2026, 6, 31, 22, 18))).toBe('2026-07-31');
  });

  it('dia comum', () => {
    expect(ymdLocal(new Date(2026, 6, 15, 10, 0))).toBe('2026-07-15');
  });

  it('zero-pad de mes e dia', () => {
    expect(ymdLocal(new Date(2026, 2, 5))).toBe('2026-03-05');
  });

  it('sem argumento usa agora e tem formato YYYY-MM-DD', () => {
    expect(ymdLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
