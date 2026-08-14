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
  it('produz as 13 paginas quando o closer e conhecido', async () => {
    const pdf = await montarDossie({ nome: 'Fátima', quandoTexto: QUANDO, closerSlug: 'mariana' });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(13);
  });

  it('produz 12 paginas na versao generica (sem a de apresentacao)', async () => {
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

  it('poe o closer na 2a pagina e a videochamada na 8a, como no Canva', async () => {
    // a ordem do export e mantida por decisao do Paulo (14/08/2026), e o e-mail
    // aponta a "segunda pagina" para o cliente achar o rosto de quem vai atender
    const pdf = await montarDossie({ nome: 'Ana', quandoTexto: QUANDO, closerSlug: 'mariana' });
    expect(await textoDaPagina(pdf, 2)).toContain('Quem irá te atender');
    expect(await textoDaPagina(pdf, 8)).toContain('10 a 15 minutos');
  });

  it('na versao generica a videochamada sobe para a 7a pagina, sem buraco', async () => {
    const pdf = await montarDossie({ nome: 'Ana', quandoTexto: QUANDO });
    expect(await textoDaPagina(pdf, 7)).toContain('10 a 15 minutos');
    expect(await textoDaPagina(pdf, 2)).not.toContain('Quem irá te atender');
  });

  it('slug desconhecido cai no generico em vez de estourar', async () => {
    // no dia em que entrar um closer novo, ou alguem sair, o envio nao pode parar
    const pdf = await montarDossie({ nome: 'Ana', quandoTexto: QUANDO, closerSlug: 'ninguem' });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(12);
  });

  it('cada closer leva o proprio nome, com o tratamento, na 2a pagina', async () => {
    // brancos normalizados: o pdfjs devolve a linha em pedacos e a juncao nao
    // reproduz os dois espacos que o Canva usa entre palavras
    const limpo = (t) => t.replace(/\s+/g, ' ');
    for (const [slug, esperado] of [['anacristina', 'D R A. A N A C R I S T I N A P I V A'],
                                    ['beatriz', 'D R A. B E A T R I Z C A V A L C A N T E'],
                                    ['emerson', 'D R. E M E R S O N C A L I S T A'],
                                    ['mariana', 'D R A. M A R I A N A B E R A L D O']]) {
      const texto = limpo(await textoDaPagina(
        await montarDossie({ nome: 'Ana', quandoTexto: QUANDO, closerSlug: slug }), 2));
      expect(texto, slug).toContain(esperado);
    }
  });

  it('nenhum closer leva a duracao velha', async () => {
    for (const slug of ['anacristina', 'beatriz', 'emerson', 'mariana', null]) {
      const pdf = await montarDossie({ nome: 'Ana', quandoTexto: QUANDO, closerSlug: slug });
      const pagina = slug ? 8 : 7;
      expect(await textoDaPagina(pdf, pagina), String(slug)).not.toContain('30 minutos');
    }
  });

  it('preserva os 19 links das materias', async () => {
    const pdf = await montarDossie({ nome: 'Ana', quandoTexto: QUANDO, closerSlug: 'mariana' });
    const doc = await PDFDocument.load(pdf);
    let links = 0;
    for (const p of doc.getPages()) {
      const anots = p.node.Annots();
      links += anots ? anots.size() : 0;
    }
    expect(links).toBe(19);
  });

  it('nao estoura o limite de anexo', async () => {
    const pdf = await montarDossie({ nome: 'Fátima', quandoTexto: QUANDO, closerSlug: 'anacristina' });
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
    await montarDossie({ nome: 'Ana', quandoTexto: QUANDO, closerSlug: 'mariana' });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('conferencia dos ativos no servidor', () => {
  it('acha todos os arquivos, inclusive um por closer', async () => {
    const { ativosDisponiveis } = await import('../dossiePdf.mjs');
    const { CLOSERS } = await import('../dossieClosers.mjs');
    const r = ativosDisponiveis();
    expect(r.ok).toBe(true);
    expect(r.faltando).toEqual([]);
    // capa + miolo + generico + 2 fontes + 1 por closer
    expect(Object.keys(r.bytes)).toHaveLength(5 + Object.keys(CLOSERS).length);
    expect(r.bytes['dossie-miolo.pdf']).toBeGreaterThan(1_000_000);
    for (const c of Object.values(CLOSERS)) {
      expect(r.bytes[`dossie-closer-${c.slug}.pdf`], c.slug).toBeGreaterThan(100_000);
    }
  });
});
