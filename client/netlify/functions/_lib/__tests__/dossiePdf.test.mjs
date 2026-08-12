// Estes testes usam os ativos REAIS. Nao ha simulacao: montar o dossie custa
// 98 ms, e o que interessa e justamente se o arquivo final sai integro.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { montarDossie, quebrarLinhas } from '../dossiePdf.mjs';

const QUANDO = 'sexta-feira, 14 de agosto, às 15h';

/** Texto real da camada de texto, via pdfjs (o pdf-lib nao extrai texto). */
async function textoDaPagina(bytes, numero = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const conteudo = await (await doc.getPage(numero)).getTextContent();
  return conteudo.items.map((i) => i.str).join(' ');
}

describe('quebra de linha', () => {
  const fonteFalsa = { widthOfTextAtSize: (t, tam) => t.length * tam * 0.5 };

  it('quebra pela largura medida na fonte, sem perder palavra', () => {
    const l = quebrarLinhas('um dois tres quatro cinco', fonteFalsa, 10, 60);
    expect(l.length).toBeGreaterThan(1);
    expect(l.join(' ')).toBe('um dois tres quatro cinco');
  });

  it('nao engole palavra maior que a linha inteira', () => {
    const l = quebrarLinhas('supercalifragilistico ok', fonteFalsa, 10, 30);
    expect(l.join(' ')).toContain('supercalifragilistico');
  });

  it('aguenta texto vazio', () => {
    expect(quebrarLinhas('', fonteFalsa, 10, 100)).toEqual([]);
  });
});

describe('montagem do dossie', () => {
  it('produz as 12 paginas', async () => {
    const pdf = await montarDossie({ nome: 'Fátima', quandoTexto: QUANDO });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(12);
  });

  it('escreve o nome e o quando na capa, com acento', async () => {
    const pdf = await montarDossie({ nome: 'Fátima', quandoTexto: QUANDO });
    const texto = await textoDaPagina(pdf, 1);
    expect(texto).toContain('Olá, Fátima.');
    expect(texto).toContain('sexta-feira, 14 de agosto, às 15h');
    expect(texto).toContain('escritório');
  });

  it('nao deixa placeholder na capa', async () => {
    const pdf = await montarDossie({ nome: 'Ana', quandoTexto: QUANDO });
    expect(await textoDaPagina(pdf, 1)).not.toContain('{{');
  });

  it('funciona sem nome', async () => {
    const pdf = await montarDossie({ nome: null, quandoTexto: 'segunda-feira, 17 de agosto, às 9h' });
    const texto = await textoDaPagina(pdf, 1);
    expect(texto).toContain('Olá!');
    expect(texto).not.toContain('null');
    expect(texto).not.toContain('undefined');
  });

  it('mantem a videochamada como segunda pagina', async () => {
    const pdf = await montarDossie({ nome: 'Ana', quandoTexto: QUANDO });
    const texto = await textoDaPagina(pdf, 2);
    expect(texto).toContain('30 minutos');
  });

  it('preserva os 19 links das materias', async () => {
    const pdf = await montarDossie({ nome: 'Ana', quandoTexto: QUANDO });
    const doc = await PDFDocument.load(pdf);
    let links = 0;
    for (const p of doc.getPages()) {
      const anots = p.node.Annots();
      links += anots ? anots.size() : 0;
    }
    expect(links).toBe(19);
  });

  it('nao estoura o limite de anexo', async () => {
    const pdf = await montarDossie({ nome: 'Fátima', quandoTexto: QUANDO });
    expect(pdf.length).toBeLessThan(6 * 1024 * 1024);
    expect(pdf.length).toBeGreaterThan(1_000_000);
  });

  it('aguenta nome comprido e caracteres fora do subconjunto do Canva', async () => {
    // a razao de embutir a fonte INTEIRA: o subconjunto que veio do Canva nao
    // tem todos os glifos, e um nome com C-cedilha sairia em branco
    const pdf = await montarDossie({ nome: 'Conceição', quandoTexto: QUANDO });
    expect(await textoDaPagina(pdf, 1)).toContain('Olá, Conceição.');
  });

  it('e rapido o bastante para rodar dentro do cron', async () => {
    const t0 = Date.now();
    await montarDossie({ nome: 'Ana', quandoTexto: QUANDO });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
