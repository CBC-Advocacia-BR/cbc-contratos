// (auditoria 01/08/2026 — item 288) O formatador unico existe porque `fmtDateBR` so
// aceitava 'AAAA-MM-DD' e a maioria dos casos reais e timestamp — misturar os dois
// produz "Invalid Date" na tela do usuario. Estes testes travam a tolerancia e, o mais
// importante, o meio-dia que impede a data de voltar um dia.
import { describe, it, expect } from 'vitest';
import { fmtData, fmtDataHora } from '../format';

describe('fmtData — aceita os formatos que existem no sistema', () => {
  it('data-so nao volta um dia (a armadilha do fuso)', () => {
    // '2026-08-03' lido como UTC vira 02/08 no Brasil; a ancora do meio-dia impede
    expect(fmtData('2026-08-03')).toBe('03/08/2026');
    expect(fmtData('2026-01-01')).toBe('01/01/2026');
    expect(fmtData('2026-12-31')).toBe('31/12/2026');
  });

  it('timestamp completo usa o dia LOCAL', () => {
    // 03/08 as 00h30 em Brasilia = 03/08 03:30 UTC
    expect(fmtData('2026-08-03T03:30:00Z')).toBe('03/08/2026');
    // 02/08 as 23h BRT = 03/08 02:00 UTC — o dia local ainda e 2
    expect(fmtData('2026-08-03T02:00:00Z')).toBe('02/08/2026');
  });

  it('aceita objeto Date', () => {
    expect(fmtData(new Date('2026-08-03T15:00:00Z'))).toBe('03/08/2026');
  });

  it('vazio, nulo e invalido viram travessao, nunca "Invalid Date"', () => {
    for (const v of [null, undefined, '', 'abc', '0000-00-00', {}]) {
      expect(fmtData(v)).toBe('—');
    }
  });

  it('repassa opcoes de formato', () => {
    expect(fmtData('2026-08-03', { month: 'short', year: 'numeric' })).toMatch(/ago/i);
  });
});

describe('fmtDataHora', () => {
  it('mostra dia e hora', () => {
    expect(fmtDataHora('2026-08-03T15:30:00Z')).toMatch(/03\/08\/2026/);
  });
  it('vazio e invalido viram travessao', () => {
    expect(fmtDataHora(null)).toBe('—');
    expect(fmtDataHora('xyz')).toBe('—');
  });
});
