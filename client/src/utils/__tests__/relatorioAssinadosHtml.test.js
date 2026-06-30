import { describe, it, expect } from 'vitest';
import { buildAssinadosReportHtml } from '../relatorioAssinadosHtml';

const sample = [
  { nome: 'Maria Aparecida da Silva', cidade: 'Balneário Camboriú', uf: 'sc', signed: new Date('2026-06-22T10:00:00') },
  { nome: 'João Pedro Nogueira', cidade: 'Curitiba', uf: 'PR', signed: new Date('2026-06-19T10:00:00') },
];

describe('buildAssinadosReportHtml', () => {
  it('monta o cabeçalho da marca e o título', () => {
    const html = buildAssinadosReportHtml(sample, {});
    expect(html).toContain('CBC ADVOGADOS');
    expect(html).toContain('Contratos assinados');
  });

  it('renderiza uma linha por contrato, numeradas', () => {
    const html = buildAssinadosReportHtml(sample, {});
    const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    const dataRows = (tbody.match(/<tr/g) || []).length;
    expect(dataRows).toBe(2);
    expect(html).toContain('Maria Aparecida da Silva');
    expect(html).toContain('João Pedro Nogueira');
    expect(html).toContain('Total: <strong style="color:#1B3A5C;">2</strong> contratos');
  });

  it('compõe Cidade/UF com UF em maiúsculas', () => {
    const html = buildAssinadosReportHtml(sample, {});
    expect(html).toContain('Balneário Camboriú/SC');
    expect(html).toContain('Curitiba/PR');
  });

  it('formata a data de assinatura em pt-BR', () => {
    const html = buildAssinadosReportHtml(sample, {});
    expect(html).toContain('22/06/2026');
    expect(html).toContain('19/06/2026');
  });

  it('escapa HTML em nomes (evita injeção/quebra)', () => {
    const html = buildAssinadosReportHtml(
      [{ nome: 'Fulano & <b>Cia</b>', cidade: 'X', uf: 'SP', signed: new Date('2026-01-01T10:00:00') }],
      {}
    );
    expect(html).toContain('Fulano &amp; &lt;b&gt;Cia&lt;/b&gt;');
    expect(html).not.toContain('<b>Cia</b>');
  });

  it('mostra travessão quando não há cidade', () => {
    const html = buildAssinadosReportHtml(
      [{ nome: 'Sem Cidade', cidade: '', uf: '', signed: new Date('2026-01-01T10:00:00') }],
      {}
    );
    // a célula de cidade fica com o travessão
    expect(html).toContain('>—</td>');
  });

  it('estado vazio quando não há linhas', () => {
    const html = buildAssinadosReportHtml([], {});
    expect(html).toContain('Nenhum contrato assinado neste período.');
    expect(html).toContain('Total: <strong style="color:#1B3A5C;">0</strong> contratos');
  });

  it('rótulo de período: intervalo completo', () => {
    const html = buildAssinadosReportHtml(sample, { inicioLabel: '01/05/2026', fimLabel: '23/06/2026' });
    expect(html).toContain('01/05/2026 a 23/06/2026');
  });

  it('rótulo de período: só início', () => {
    const html = buildAssinadosReportHtml(sample, { inicioLabel: '01/05/2026' });
    expect(html).toContain('a partir de 01/05/2026');
  });

  it('rótulo de período: só fim', () => {
    const html = buildAssinadosReportHtml(sample, { fimLabel: '23/06/2026' });
    expect(html).toContain('até 23/06/2026');
  });

  it('rótulo de período: sem datas', () => {
    const html = buildAssinadosReportHtml(sample, {});
    expect(html).toContain('todo o período');
  });

  it('singular quando há 1 contrato', () => {
    const html = buildAssinadosReportHtml([sample[0]], {});
    expect(html).toContain('1</strong> contrato'); // sem "s"
    expect(html).toContain('1 registro');
  });
});
