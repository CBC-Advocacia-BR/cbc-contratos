import { describe, it, expect } from 'vitest';
import {
  extractPlaceholderKeys,
  escapeHtml,
  fillPlainText,
  fillHtml,
  resolveAutoSource,
  buildInitialValues,
} from '../lib/placeholders';

describe('extractPlaceholderKeys', () => {
  it('extrai chaves únicas e com espaço interno', () => {
    expect(extractPlaceholderKeys('Olá {{nome}}, processo {{ numero_processo }}. {{nome}}'))
      .toEqual(['nome', 'numero_processo']);
  });
  it('retorna array vazio quando não há placeholders', () => {
    expect(extractPlaceholderKeys('texto normal')).toEqual([]);
  });
  it('aceita pontos no nome (ex: cliente.cpf)', () => {
    expect(extractPlaceholderKeys('{{cliente.cpf}}')).toEqual(['cliente.cpf']);
  });
});

describe('escapeHtml', () => {
  it('escapa os 5 caracteres perigosos', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('trata null/undefined como string vazia', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('fillPlainText', () => {
  it('substitui chaves e ignora ausentes', () => {
    expect(fillPlainText('Olá {{nome}}, {{sobrenome}}.', { nome: 'João' })).toBe('Olá João, .');
  });
});

describe('fillHtml', () => {
  it('substitui com escape', () => {
    expect(fillHtml('<p>{{x}}</p>', { x: '<b>hi</b>' })).toBe('<p>&lt;b&gt;hi&lt;/b&gt;</p>');
  });
});

describe('resolveAutoSource', () => {
  const ctx = {
    advbox: {
      lawsuit: { process_number: '1234', classe: 'Ação Ordinária' },
      customer: { name: 'João da Silva', cpf: '123.456.789-00' },
    },
    datajud: {},
    resort: {
      legal_name: 'Resort X LTDA',
      cnpj: '00.000.000/0001-00',
      economic_group: 'Grupo Y',
      companies: [{ legal_name: 'Empresa A', cnpj: '11.111.111/0001-11' }],
      typical_defense_arguments: [{ argument: 'Argumento 1' }],
    },
  };

  it('puxa dados do advbox', () => {
    expect(resolveAutoSource('advbox_customer_name', ctx)).toBe('João da Silva');
    expect(resolveAutoSource('advbox_process_number', ctx)).toBe('1234');
  });
  it('puxa dados do resort', () => {
    expect(resolveAutoSource('resort_razao_social', ctx)).toBe('Resort X LTDA');
    expect(resolveAutoSource('resort_grupo', ctx)).toBe('Grupo Y');
  });
  it('formata empresas do grupo como lista com separador', () => {
    expect(resolveAutoSource('resort_empresas_grupo', ctx))
      .toContain('Empresa A');
  });
  it('formata argumentos de defesa com bullets', () => {
    expect(resolveAutoSource('resort_argumentos_defesa', ctx)).toContain('• Argumento 1');
  });
  it('manual retorna string vazia', () => {
    expect(resolveAutoSource('manual', ctx)).toBe('');
  });
  it('fonte desconhecida retorna vazio', () => {
    expect(resolveAutoSource('inexistente', ctx)).toBe('');
  });
});

describe('buildInitialValues', () => {
  it('pré-preenche com auto_source e default_value', () => {
    const defs = [
      { key: 'nome', auto_source: 'advbox_customer_name' },
      { key: 'nascimento', auto_source: 'manual', default_value: '2000-01-01' },
    ];
    const ctx = { advbox: { customer: { name: 'Maria' } } };
    expect(buildInitialValues(defs, ctx)).toEqual({
      nome: 'Maria',
      nascimento: '2000-01-01',
    });
  });
});
