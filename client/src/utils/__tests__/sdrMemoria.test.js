import { describe, it, expect } from 'vitest';
import { unificarHistorico, historicoAposMemoria, memoriaEstaVelha, montarPromptMemoria, parseMemoria, linhaMemoria, gerarMemoria } from '../../../netlify/functions/_lib/sdrMemoria.mjs';
import { montarMensagens } from '../../../netlify/functions/_lib/sdrPrompt.mjs';

const t = (min) => new Date(Date.UTC(2026, 8, 8, 18, min)).toISOString();

describe('unificarHistorico', () => {
  it('funde o log da Ana com o espelho sem duplicar e em ordem', () => {
    const espelho = [{ autor: 'cliente', corpo: 'oi', enviada_em: t(0) }, { autor: 'atendente', autor_nome: 'Mizael', corpo: 'Bom dia', enviada_em: t(1) }];
    const bot = [{ direction: 'out', text: 'Oi! Me chamo Ana', created_at: t(2) }, { direction: 'in', text: 'oi', created_at: t(0) }];
    const h = unificarHistorico(espelho, bot);
    expect(h.map((m) => m.corpo)).toEqual(['oi', 'Bom dia', 'Oi! Me chamo Ana']);
    expect(h[2].autor).toBe('atendente'); expect(h[2].autor_nome).toBe('Ana');
  });
  it('respeita o cap e ignora datas invalidas', () => {
    const espelho = Array.from({ length: 50 }, (_, i) => ({ autor: 'cliente', corpo: `m${i}`, enviada_em: t(i) }));
    expect(unificarHistorico(espelho, [{ direction: 'in', text: 'x', created_at: 'nao-data' }], 40)).toHaveLength(40);
  });
});

describe('historicoAposMemoria / memoriaEstaVelha', () => {
  const hist = Array.from({ length: 20 }, (_, i) => ({ autor: 'cliente', corpo: `m${i}`, enviada_em: t(i) }));
  it('sem memoria devolve tudo; com memoria, so o que veio depois (minimo 10)', () => {
    expect(historicoAposMemoria(hist, null)).toHaveLength(20);
    expect(historicoAposMemoria(hist, { msgs_ate: t(5) })).toHaveLength(14);
    expect(historicoAposMemoria(hist, { msgs_ate: t(17) })).toHaveLength(10);
  });
  it('memoria velha = 24h+ e 5+ mensagens novas', () => {
    const agora = new Date(Date.UTC(2026, 8, 10, 18, 0));
    expect(memoriaEstaVelha(null, hist, agora)).toBe(false);
    expect(memoriaEstaVelha({ atualizado_em: t(0), msgs_ate: t(10) }, hist, agora)).toBe(true);
    expect(memoriaEstaVelha({ atualizado_em: t(0), msgs_ate: t(17) }, hist, agora)).toBe(false);
    expect(memoriaEstaVelha({ atualizado_em: agora.toISOString(), msgs_ate: t(0) }, hist, agora)).toBe(false);
  });
});

describe('prompt e parse da memoria', () => {
  it('monta o prompt com o resumo anterior e as mensagens', () => {
    const { system, user } = montarPromptMemoria({ anterior: 'Era X', mensagens: [{ autor: 'cliente', corpo: 'quero sair', enviada_em: t(0) }], nomeContato: 'Paulo' });
    expect(system).toMatch(/SOMENTE com JSON/); expect(user).toMatch(/RESUMO ANTERIOR/); expect(user).toMatch(/LEAD: quero sair/);
  });
  it('parseMemoria tolera texto em volta e rejeita lixo', () => {
    expect(parseMemoria('aqui: {"resumo":"ok","fatos":{"nome":"Paulo"}} fim')).toEqual({ resumo: 'ok', fatos: { nome: 'Paulo' } });
    expect(parseMemoria('nada')).toBeNull();
  });
  it('gerarMemoria usa o cliente injetado e calcula custo do Haiku', async () => {
    const client = { messages: { create: async () => ({ model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: '{"resumo":"Lead do Ondas, paga há anos.","fatos":{"resort":"ONDAS PRAIA","pendencias":["e-mail"]}}' }], usage: { input_tokens: 2000, output_tokens: 300 } }) } };
    const g = await gerarMemoria({ client, mensagens: [] });
    expect(g.resumo).toMatch(/Ondas/); expect(g.custo_usd).toBeCloseTo(0.0035, 6);
  });
  it('linhaMemoria vai para o contexto com data e pendencias', () => {
    expect(linhaMemoria({ resumo: 'R', msgs_ate: '2026-09-01T10:00:00Z', fatos: { pendencias: ['e-mail'] } })).toMatch(/até 01\/09\/2026.*R Pendências: e-mail/);
    expect(linhaMemoria(null)).toBeNull();
  });
});

describe('cache incremental do historico', () => {
  it('marca o ultimo bloco do historico com cache_control e nao o contexto do turno', () => {
    const historico = [{ autor: 'cliente', corpo: 'oi', enviada_em: t(0) }, { autor: 'atendente', corpo: 'Oi!', enviada_em: t(1) }];
    const m = montarMensagens({ historico, textoAtual: 'Ondas', contexto: '[ctx]' });
    const assistente = m[m.length - 2];
    expect(assistente.role).toBe('assistant');
    expect(assistente.content[assistente.content.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    const ultimo = m[m.length - 1];
    expect(ultimo.content[ultimo.content.length - 1].cache_control).toBeUndefined();
  });
  it('sem historico nada e marcado', () => {
    const m = montarMensagens({ historico: [], textoAtual: 'oi', contexto: '[ctx]' });
    expect(JSON.stringify(m)).not.toMatch(/cache_control/);
  });
});
