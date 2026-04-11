import { describe, it, expect } from 'vitest';
import { segmentIntoBlocks, suggestPlaceholders } from '../lib/wordImporter';

describe('segmentIntoBlocks', () => {
  it('retorna bloco único quando não há headings', () => {
    const blocks = segmentIntoBlocks('<p>Texto solto</p>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('Bloco único');
  });
  it('quebra em blocos por heading', () => {
    const html = '<h1>Parte A</h1><p>conteúdo A</p><h2>Parte B</h2><p>conteúdo B</p>';
    const blocks = segmentIntoBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].title).toBe('Parte A');
    expect(blocks[0].content).toContain('conteúdo A');
    expect(blocks[1].title).toBe('Parte B');
    expect(blocks[1].content).toContain('conteúdo B');
  });
});

describe('suggestPlaceholders', () => {
  it('extrai chaves de colchetes', () => {
    const keys = suggestPlaceholders('Olá [NOME DO CLIENTE], CPF [CPF].');
    expect(keys).toContain('nome_do_cliente');
    expect(keys).toContain('cpf');
  });
  it('retorna array vazio quando não há colchetes', () => {
    expect(suggestPlaceholders('Texto normal sem marcação')).toEqual([]);
  });
});
