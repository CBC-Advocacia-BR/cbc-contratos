import { describe, it, expect } from 'vitest';
import { montarPromptInterprete, validarInterpretacao } from '../../../netlify/functions/_lib/agendaInterprete.mjs';

describe('montarPromptInterprete', () => {
  it('inclui contexto do estado e slots ofertados no prompt', () => {
    const { system, user } = montarPromptInterprete({
      mensagem: 'pode ser quarta às 9h?',
      estado: { etapa: 'negociacao', dados: { resort: 'Hot Beach', situacao: null, valor_aprox: null },
        slots_ofertados: [{ inicio: '2026-07-22T13:00:00.000Z' }] },
      agoraISO: '2026-07-21T13:00:00-03:00',
    });
    expect(system).toContain('JSON');
    expect(system).toContain('advocacia');           // domínio no prompt
    expect(user).toContain('pode ser quarta às 9h?');
    expect(user).toContain('negociacao');
    expect(user).toContain('2026-07-22T13:00:00.000Z');
  });
});

describe('validarInterpretacao', () => {
  it('normaliza um objeto válido', () => {
    const v = validarInterpretacao({ intencao: 'aceita_slot', horario_aceito_idx: 1, confianca: 0.93 });
    expect(v).toMatchObject({ intencao: 'aceita_slot', horario_aceito_idx: 1 });
    expect(v.pede_humano).toBe(false);
  });
  it('rejeita intencao fora do enum e clampa confiança', () => {
    expect(validarInterpretacao({ intencao: 'hackear' })).toBe(null);
    expect(validarInterpretacao({ intencao: 'outro', confianca: 7 }).confianca).toBe(1);
  });
  it('horario_proposto inválido vira null', () => {
    const v = validarInterpretacao({ intencao: 'propoe_horario', horario_proposto: 'quarta' });
    expect(v.horario_proposto).toBe(null);
  });
});
