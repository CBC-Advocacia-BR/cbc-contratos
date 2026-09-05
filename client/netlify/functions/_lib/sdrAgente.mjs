// Loop do agente (Claude + ferramentas) da Ana. A parte pura (loop com cliente injetado
// e custo) e testada em src/utils/__tests__/sdrAgente.test.js; criarCliente() e I/O.
import Anthropic from '@anthropic-ai/sdk';

export const BETAS = ['server-side-fallback-2026-07-01'];
// USD por milhao de tokens (platform.claude.com/docs/en/about-claude/pricing, 05/09/2026)
export const PRECOS = {
  'claude-opus-5': { in: 5, out: 25, cr: 0.5, cw: 10 },
  'claude-opus-4-8': { in: 5, out: 25, cr: 0.5, cw: 10 },
  'claude-sonnet-5': { in: 2, out: 10, cr: 0.2, cw: 4 },
  'claude-haiku-4-5': { in: 1, out: 5, cr: 0.1, cw: 2 },
  'claude-fable-5-1': { in: 10, out: 50, cr: 0.25, cw: 20 },
};

export function criarCliente() { return new Anthropic(); } // ANTHROPIC_API_KEY do ambiente

export function custoUsd(iteracoes = [], avisos = []) {
  let usd = 0;
  for (const it of iteracoes) {
    let p = PRECOS[it.model];
    if (!p) {
      avisos.push(it.model);
      p = PRECOS['claude-opus-5'];
    }
    const u = it.usage || {};
    usd += ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.cr + (u.cache_creation_input_tokens || 0) * p.cw) / 1e6;
  }
  return usd;
}

/**
 * Roda ate maxIter chamadas: texto -> fim; tool_use -> executa TODAS as ferramentas do turno,
 * devolve os tool_result num unico user message e chama de novo. Nunca lanca por causa de
 * ferramenta (vira is_error); lanca so se a API falhar (o caller decide o que dizer ao lead).
 */
export async function rodarAgente({ client, modelo = 'claude-opus-5', effort = 'low', maxTokens = 2048, system, tools, messages = [], executar, maxIter = 6 }) {
  const msgs = [...messages];
  const iteracoes = []; const chamadas = []; const textos = [];
  let modeloFinal = modelo;
  for (let i = 0; i < maxIter; i++) {
    const resp = await client.beta.messages.create({
      model: modelo, max_tokens: maxTokens, betas: BETAS, fallbacks: 'default',
      thinking: { type: 'adaptive' }, output_config: { effort },
      system, tools, messages: msgs,
    });
    modeloFinal = resp.model || modeloFinal;
    iteracoes.push({ model: resp.model || modelo, usage: resp.usage, stop_reason: resp.stop_reason });
    if (resp.stop_reason === 'refusal') return { texto: null, stop_reason: 'refusal', stop_details: resp.stop_details || null, iteracoes, chamadas, textos, modeloFinal };
    const conteudo = resp.content || [];
    const usos = conteudo.filter((b) => b.type === 'tool_use');
    const texto = conteudo.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (texto) textos.push(texto);
    if (resp.stop_reason !== 'tool_use' || !usos.length) return { texto: texto || null, stop_reason: resp.stop_reason, stop_details: null, iteracoes, chamadas, textos, modeloFinal };
    msgs.push({ role: 'assistant', content: conteudo });
    const resultados = [];
    for (const tu of usos) {
      const t0 = Date.now(); let out; let ok = true;
      try { out = await executar(tu.name, tu.input || {}); }
      catch (e) { ok = false; out = `ERRO: ${e?.message || String(e)}`; }
      const outStr = typeof out === 'string' ? out : JSON.stringify(out ?? '');
      chamadas.push({ nome: tu.name, input: tu.input || {}, ok, ms: Date.now() - t0, resultado: outStr.slice(0, 500) });
      resultados.push({ type: 'tool_result', tool_use_id: tu.id, content: outStr, ...(ok ? {} : { is_error: true }) });
    }
    msgs.push({ role: 'user', content: resultados });
  }
  return { texto: null, stop_reason: 'max_iter', stop_details: null, iteracoes, chamadas, textos, modeloFinal };
}
