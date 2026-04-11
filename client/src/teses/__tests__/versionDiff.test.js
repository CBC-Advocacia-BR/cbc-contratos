import { describe, it, expect } from 'vitest';
import { diffTextToHtml, diffModelSnapshots } from '../lib/versionDiff';

describe('diffTextToHtml', () => {
  it('marca adições e remoções', () => {
    const html = diffTextToHtml('foo bar', 'foo baz');
    expect(html).toContain('<ins');
    expect(html).toContain('<del');
  });
  it('retorna string quando há igual', () => {
    const html = diffTextToHtml('abc', 'abc');
    expect(html).toContain('abc');
    expect(html).not.toContain('<ins');
    expect(html).not.toContain('<del');
  });
  it('lida com html removendo tags', () => {
    const html = diffTextToHtml('<p>olá</p>', '<p>olá mundo</p>');
    expect(html).toContain('mundo');
  });
});

describe('diffModelSnapshots', () => {
  const snapA = {
    model: { name: 'X', fixed_header: 'H1', fixed_footer: 'F1', description: 'desc' },
    blocks: [
      { title: 'Intro', content: '<p>Velho intro</p>' },
      { title: 'Removido', content: 'bye' },
    ],
    placeholders: [{ key: 'nome' }, { key: 'cpf' }],
  };
  const snapB = {
    model: { name: 'X', fixed_header: 'H2', fixed_footer: 'F1', description: 'desc' },
    blocks: [
      { title: 'Intro', content: '<p>Novo intro</p>' },
      { title: 'Novo bloco', content: 'hi' },
    ],
    placeholders: [{ key: 'nome' }, { key: 'endereco' }],
  };

  it('detecta mudanças de metadados', () => {
    const items = diffModelSnapshots(snapA, snapB);
    expect(items.some((i) => i.kind === 'meta' && i.field === 'fixed_header')).toBe(true);
    expect(items.some((i) => i.field === 'fixed_footer')).toBe(false); // igual
  });
  it('detecta blocos alterados/adicionados/removidos', () => {
    const items = diffModelSnapshots(snapA, snapB);
    expect(items.some((i) => i.kind === 'block-changed' && i.title === 'Intro')).toBe(true);
    expect(items.some((i) => i.kind === 'block-added' && i.title === 'Novo bloco')).toBe(true);
    expect(items.some((i) => i.kind === 'block-removed' && i.title === 'Removido')).toBe(true);
  });
  it('detecta placeholders adicionados/removidos', () => {
    const items = diffModelSnapshots(snapA, snapB);
    expect(items.some((i) => i.kind === 'placeholder-added' && i.title === 'endereco')).toBe(true);
    expect(items.some((i) => i.kind === 'placeholder-removed' && i.title === 'cpf')).toBe(true);
  });
});
