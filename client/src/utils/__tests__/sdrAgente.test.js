import { describe, it, expect } from 'vitest';
import { rodarAgente, custoUsd } from '../../../netlify/functions/_lib/sdrAgente.mjs';

const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 };
function clienteFalso(respostas) {
  let i = 0; const pedidos = [];
  return { pedidos, beta: { messages: { create: async (p) => { pedidos.push(p); return respostas[i++]; } } } };
}

describe('rodarAgente', () => {
  it('executa a ferramenta, devolve o resultado e termina no texto final', async () => {
    const client = clienteFalso([
      { model: 'claude-opus-5', stop_reason: 'tool_use', usage, content: [{ type: 'text', text: 'Deixa eu ver.' }, { type: 'tool_use', id: 't1', name: 'consultar_horarios', input: { preferencia: 'manha', a_partir_de: null } }] },
      { model: 'claude-opus-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Tenho segunda 8h30 ou 9h.' }] },
    ]);
    const executar = async (nome, input) => `slots: ${nome}:${input.preferencia}`;
    const r = await rodarAgente({ client, system: [{ type: 'text', text: 's' }], tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }], executar });
    expect(r.texto).toBe('Tenho segunda 8h30 ou 9h.');
    expect(r.stop_reason).toBe('end_turn');
    expect(r.chamadas).toHaveLength(1);
    expect(r.chamadas[0]).toMatchObject({ nome: 'consultar_horarios', ok: true });
    const p2 = client.pedidos[1];
    expect(p2.messages[p2.messages.length - 1].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', content: 'slots: consultar_horarios:manha' });
    expect(p2.model).toBe('claude-opus-5');
    expect(p2.betas).toContain('server-side-fallback-2026-07-01');
    expect(p2.fallbacks).toBe('default');
    expect(p2.output_config).toEqual({ effort: 'low' });
  });
  it('ferramenta que lanca vira tool_result com is_error', async () => {
    const client = clienteFalso([
      { model: 'claude-opus-5', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 't1', name: 'agendar', input: {} }] },
      { model: 'claude-opus-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Não consegui reservar agora.' }] },
    ]);
    const r = await rodarAgente({ client, system: [], tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }], executar: async () => { throw new Error('google fora'); } });
    expect(r.chamadas[0].ok).toBe(false);
    expect(client.pedidos[1].messages.at(-1).content[0].is_error).toBe(true);
    expect(r.texto).toBe('Não consegui reservar agora.');
  });
  it('recusa devolve texto null e stop_reason refusal', async () => {
    const client = clienteFalso([{ model: 'claude-opus-5', stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'x' }, usage, content: [] }]);
    const r = await rodarAgente({ client, system: [], tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }], executar: async () => '' });
    expect(r.texto).toBeNull();
    expect(r.stop_reason).toBe('refusal');
  });
  it('estoura maxIter sem loop infinito', async () => {
    const resp = { model: 'claude-opus-5', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 't', name: 'consultar_horarios', input: {} }] };
    const client = clienteFalso([resp, resp, resp]);
    const r = await rodarAgente({ client, system: [], tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }], executar: async () => 'x', maxIter: 2 });
    expect(r.stop_reason).toBe('max_iter');
    expect(r.iteracoes).toHaveLength(2);
  });
});

describe('custoUsd', () => {
  it('soma pelas tarifas do modelo (opus 5: 5/25, cache read 0.5, cache write 1h 10)', () => {
    const c = custoUsd([{ model: 'claude-opus-5', usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 } }]);
    expect(c).toBeCloseTo((1000 * 5 + 100 * 25 + 6000 * 0.5) / 1e6, 8);
  });
});
