// (auditoria 01/08/2026 — item 297) `_lib/botEngine.mjs` (564 linhas) e o cerebro do bot
// que responde ao CLIENTE no WhatsApp, e nao tinha um unico teste. Um erro de mapeamento
// aqui manda a mensagem errada para o cliente sem nenhum alarme: o bot responde com
// confianca, ninguem ve o erro, e o cliente recebe informacao errada sobre o processo dele.
//
// Estes testes cobrem a logica PURA (sem rede, sem banco): normalizacao, preenchimento de
// modelo, traducao de juridiques e classificacao de intencao.
import { describe, it, expect } from 'vitest';
import { normalize, render, glossaryTranslate, classifyIntent } from '../botEngine.mjs';

describe('normalize — base de TODA comparacao do bot', () => {
  it('tira acento, caixa e espaco das pontas', () => {
    expect(normalize('  CITAÇÃO Válida ')).toBe('citacao valida');
    expect(normalize('AUDIÊNCIA')).toBe('audiencia');
  });

  it('nao explode com nulo/numero (vem de campo do banco que pode estar vazio)', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
    expect(normalize(123)).toBe('123');
  });

  it('ç e til continuam casando com a forma sem acento', () => {
    expect(normalize('PUBLICAÇÃO')).toBe(normalize('PUBLICACAO'));
    expect(normalize('João')).toBe(normalize('Joao'));
  });
});

describe('render — modelo de mensagem com {{variaveis}}', () => {
  it('troca a variavel pelo valor', () => {
    expect(render('Ola {{nome}}, tudo bem?', { nome: 'Ana' })).toBe('Ola Ana, tudo bem?');
  });

  it('aceita espaco dentro das chaves e caminho com ponto', () => {
    expect(render('{{ nome }} / {{a.b}}', { nome: 'Ana', 'a.b': 'X' })).toBe('Ana / X');
  });

  it('variavel ausente vira VAZIO — nunca "undefined" na cara do cliente', () => {
    expect(render('Processo: {{numero}}.', {})).toBe('Processo: .');
    expect(render('{{x}}', { x: null })).toBe('');
    expect(render('{{x}}', { x: undefined })).toBe('');
  });

  it('zero e false SAO impressos (nao podem virar vazio)', () => {
    expect(render('{{n}} parcelas', { n: 0 })).toBe('0 parcelas');
    expect(render('{{b}}', { b: false })).toBe('false');
  });

  it('modelo nulo nao quebra', () => {
    expect(render(null, {})).toBe('');
  });
});

describe('glossaryTranslate — juridiques -> portugues do cliente', () => {
  const glossario = [
    { term: 'CITACAO', match_type: 'exact', translation: 'A outra parte foi avisada do processo.' },
    { term: 'audiencia', match_type: 'contains', translation: 'Foi marcada uma audiência.' },
    { term: '^SENTEN[CÇ]A', match_type: 'regex', translation: 'Saiu a decisão do juiz.' },
  ];

  it('exact so casa com o termo INTEIRO', () => {
    expect(glossaryTranslate('citação', glossario)).toBe('A outra parte foi avisada do processo.');
    expect(glossaryTranslate('citação por edital', glossario)).toBe(null);
  });

  it('contains casa no meio da frase e ignora acento', () => {
    expect(glossaryTranslate('Designada AUDIÊNCIA de conciliação', glossario))
      .toBe('Foi marcada uma audiência.');
  });

  it('regex e aplicada sobre o titulo ORIGINAL (com acento), sem diferenciar caixa', () => {
    expect(glossaryTranslate('Sentença publicada', glossario)).toBe('Saiu a decisão do juiz.');
    expect(glossaryTranslate('SENTENCA de mérito', glossario)).toBe('Saiu a decisão do juiz.');
  });

  it('regex invalida no cadastro NAO derruba o bot — apenas nao casa', () => {
    const ruim = [{ term: '([', match_type: 'regex', translation: 'x' }];
    expect(() => glossaryTranslate('qualquer coisa', ruim)).not.toThrow();
    expect(glossaryTranslate('qualquer coisa', ruim)).toBe(null);
  });

  it('sem match devolve null (o chamador decide entre IA e texto tecnico)', () => {
    expect(glossaryTranslate('DESPACHO DE MERO EXPEDIENTE', glossario)).toBe(null);
  });

  it('termo vazio no cadastro e ignorado (senao casaria com TUDO)', () => {
    const comVazio = [{ term: '   ', match_type: 'contains', translation: 'NAO PODE' }, ...glossario];
    expect(glossaryTranslate('Designada audiencia', comVazio)).toBe('Foi marcada uma audiência.');
  });

  it('glossario vazio devolve null', () => {
    expect(glossaryTranslate('qualquer', [])).toBe(null);
  });
});

describe('classifyIntent — o que o cliente quis dizer', () => {
  const intents = [
    { name: 'andamento', priority: 1, keywords: ['andamento', 'como esta', 'novidade'] },
    { name: 'boleto', priority: 2, keywords: ['boleto', 'pagamento', 'segunda via'] },
    { name: 'humano', priority: 0, keywords: ['atendente', 'falar com alguem'] },
  ];

  it('reconhece por palavra-chave, ignorando acento e caixa', () => {
    expect(classifyIntent('Quero saber o ANDAMENTO', intents).name).toBe('andamento');
    expect(classifyIntent('como está meu processo?', intents).name).toBe('andamento');
  });

  it('quando casa mais de uma, vence a de MENOR numero de prioridade', () => {
    // "atendente" (0) tem de vencer "boleto" (2) — pedido de humano nunca pode ser
    // atropelado por uma resposta automatica de cobranca.
    expect(classifyIntent('quero falar com atendente sobre o boleto', intents).name).toBe('humano');
  });

  it('texto sem nenhuma palavra-chave devolve null (cai no fallback)', () => {
    expect(classifyIntent('bom dia', intents)).toBe(null);
  });

  it('nao casa palavra-chave vazia (casaria com qualquer mensagem)', () => {
    const comVazia = [{ name: 'x', priority: 9, keywords: ['', '   '] }];
    expect(classifyIntent('qualquer texto', comVazia)).toBe(null);
  });

  it('lista de intencoes vazia devolve null', () => {
    expect(classifyIntent('andamento', [])).toBe(null);
  });

  it('casa palavra-chave de VARIAS palavras', () => {
    expect(classifyIntent('preciso da segunda via', intents).name).toBe('boleto');
  });
});
