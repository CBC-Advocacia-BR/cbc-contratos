import { describe, it, expect } from 'vitest';
import { foraDoHorario, proximoInicioExpediente, gradeDeConfig, ehJanelaEntrega } from '../../../netlify/functions/_lib/sdrHorario.mjs';

// datas em UTC; SP = UTC-3 em setembro (sem horario de verao)
const sp = (s) => new Date(`${s}-03:00`);
const grade = { inicio: '08:00', fim: '17:00', dias: [1, 2, 3, 4, 5] };

describe('foraDoHorario', () => {
  it('dia util 07:59 = fora; 08:00 = dentro; 16:59 = dentro; 17:00 = fora', () => {
    expect(foraDoHorario(sp('2026-09-07T07:59:00'), grade)).toBe(true);   // segunda
    expect(foraDoHorario(sp('2026-09-07T08:00:00'), grade)).toBe(false);
    expect(foraDoHorario(sp('2026-09-07T16:59:00'), grade)).toBe(false);
    expect(foraDoHorario(sp('2026-09-07T17:00:00'), grade)).toBe(true);
  });
  it('sabado e domingo sao fora em qualquer hora', () => {
    expect(foraDoHorario(sp('2026-09-05T10:00:00'), grade)).toBe(true);
    expect(foraDoHorario(sp('2026-09-06T10:00:00'), grade)).toBe(true);
  });
  it('feriado e fora mesmo em dia util', () => {
    expect(foraDoHorario(sp('2026-09-07T10:00:00'), grade, ['2026-09-07'])).toBe(true);
  });
});

describe('proximoInicioExpediente', () => {
  it('sexta 20h -> segunda 08:00', () => {
    const d = proximoInicioExpediente(sp('2026-09-04T20:00:00'), grade);
    expect(d.toISOString()).toBe(sp('2026-09-07T08:00:00').toISOString());
  });
  it('sabado -> segunda 08:00; segunda feriado -> terca 08:00', () => {
    expect(proximoInicioExpediente(sp('2026-09-05T11:00:00'), grade).toISOString()).toBe(sp('2026-09-07T08:00:00').toISOString());
    expect(proximoInicioExpediente(sp('2026-09-05T11:00:00'), grade, ['2026-09-07']).toISOString()).toBe(sp('2026-09-08T08:00:00').toISOString());
  });
  it('dentro do expediente devolve o proprio instante', () => {
    const d = sp('2026-09-07T10:00:00');
    expect(proximoInicioExpediente(d, grade).toISOString()).toBe(d.toISOString());
  });
});

describe('gradeDeConfig', () => {
  it('normaliza time do postgres (08:00:00) e usa regras como fallback', () => {
    expect(gradeDeConfig({ grade_inicio: '08:00:00', grade_fim: '17:00:00', grade_dias: [1, 2, 3, 4, 5] }, {}))
      .toEqual({ inicio: '08:00', fim: '17:00', dias: [1, 2, 3, 4, 5] });
    expect(gradeDeConfig(null, { hora_inicio: '09:00', hora_fim: '18:00', dias: [1, 2, 3] }))
      .toEqual({ inicio: '09:00', fim: '18:00', dias: [1, 2, 3] });
  });
});

describe('ehJanelaEntrega', () => {
  it('true so nos 5 min apos o inicio da grade em dia util', () => {
    expect(ehJanelaEntrega(sp('2026-09-07T08:02:00'), grade)).toBe(true);
    expect(ehJanelaEntrega(sp('2026-09-07T08:06:00'), grade)).toBe(false);
    expect(ehJanelaEntrega(sp('2026-09-06T08:02:00'), grade)).toBe(false);
  });
});
