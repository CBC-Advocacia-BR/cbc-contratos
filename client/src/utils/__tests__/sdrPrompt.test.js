import { describe, it, expect } from 'vitest';
import { FERRAMENTAS, montarSystem, montarMensagens, contextoDoTurno } from '../../../netlify/functions/_lib/sdrPrompt.mjs';

describe('FERRAMENTAS', () => {
  it('sao 7, estritas, com additionalProperties false e required', () => {
    expect(FERRAMENTAS.map((f) => f.name)).toEqual(['consultar_horarios', 'agendar', 'remarcar', 'cancelar', 'registrar_qualificacao', 'escalar_para_humano', 'encerrar']);
    for (const f of FERRAMENTAS) {
      expect(f.strict).toBe(true);
      expect(f.input_schema.additionalProperties).toBe(false);
      expect(Array.isArray(f.input_schema.required)).toBe(true);
    }
  });
});

describe('montarSystem', () => {
  const cfg = { mensagens: { preco: 'Não consigo te passar um preço.' }, roteamento: {} };
  it('e deterministico (sem data/hora) e cacheado por 1h no ultimo bloco', () => {
    const a = montarSystem({ cfg, fatos: [{ chave: 'sede', texto: 'Sede em Americana/SP.' }] });
    const b = montarSystem({ cfg, fatos: [{ chave: 'sede', texto: 'Sede em Americana/SP.' }] });
    expect(a).toEqual(b);
    expect(a[a.length - 1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    const txt = a.map((x) => x.text).join('\n');
    expect(txt).toContain('Ana');
    expect(txt).toContain('Sede em Americana/SP.');
    expect(txt).toContain('Não consigo te passar um preço.');
    expect(txt).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

describe('montarMensagens', () => {
  it('converte historico em turnos alternados e termina com a mensagem atual + contexto', () => {
    const historico = [
      { autor: 'atendente', autor_nome: 'Salesbot', corpo: 'Olá. Você está no atendimento automático' },
      { autor: 'cliente', autor_nome: 'Fulano', corpo: 'Quero atendimento' },
      { autor: 'cliente', autor_nome: 'Fulano', corpo: 'Já quitei' },
      { autor: 'atendente', autor_nome: 'Salesbot', corpo: 'Combinado, vou reservar o seu horário' },
    ];
    const m = montarMensagens({ historico, textoAtual: 'De manhã', contexto: '[ctx]' });
    expect(m[0].role).toBe('user');
    for (let i = 1; i < m.length; i++) expect(m[i].role).not.toBe(m[i - 1].role);
    const ultimo = m[m.length - 1];
    expect(ultimo.role).toBe('user');
    expect(ultimo.content[ultimo.content.length - 1].text).toContain('De manhã');
    expect(ultimo.content[ultimo.content.length - 1].text).toContain('[ctx]');
    expect(JSON.stringify(m)).toContain('[Salesbot]');
  });
  it('anexa imagem como bloco image antes do texto', () => {
    const m = montarMensagens({ historico: [], textoAtual: '', contexto: '[ctx]', imagemBase64: 'AAAA', imagemTipo: 'image/jpeg' });
    const c = m[m.length - 1].content;
    expect(c[0].type).toBe('image');
    expect(c[0].source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
  });
});

describe('contextoDoTurno', () => {
  it('traz data/hora local, situacao, fim do plantao e o estado', () => {
    const s = contextoDoTurno({ agora: new Date('2026-09-05T21:14:00-03:00'), situacao: { acao: 'handoff' }, estado: { dados: { resort: 'Ondas' }, nota: 2, agendamento: {} }, fimPlantao: new Date('2026-09-07T08:00:00-03:00') });
    expect(s).toContain('sábado');
    expect(s).toContain('21:14');
    expect(s).toContain('handoff');
    expect(s).toContain('segunda');
    expect(s).toContain('Ondas');
  });
});
