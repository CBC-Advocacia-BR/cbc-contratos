// O teste que existe para uma falha especifica: o nome do closer e escrito em DOIS
// lugares (o mapa deste modulo, que alimenta o e-mail, e o gerador em Python, que
// escreve dentro do PDF). Se um mudar e o outro nao, o e-mail diz um nome e o anexo
// mostra outro, na frente do cliente. Aqui os dois lados sao comparados lendo a
// camada de texto do PDF gerado de verdade.
import { describe, it, expect } from 'vitest';
import { CLOSERS, closerDaAgenda } from '../dossieClosers.mjs';
import { montarDossie } from '../dossiePdf.mjs';

// ⚠️ o pdfjs devolve a linha em pedacos e a juncao nao reproduz o espacamento
// exato do Canva (que separa palavras com DOIS espacos). Comparar espaco a espaco
// reprovaria um PDF correto, entao os brancos sao normalizados dos dois lados.
const semBrancos = (t) => t.replace(/\s+/g, ' ').trim();

async function textoDaPagina(bytes, numero) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const conteudo = await (await doc.getPage(numero)).getTextContent();
  return semBrancos(conteudo.items.map((i) => i.str).join(' '));
}

/** 'Dra. Ana Piva' -> 'D R A.  A N A  P I V A' (como o Canva compoe a linha) */
const espacar = (t) => t.toUpperCase().split(/\s+/)
  .map((p) => [...p].reduce((acc, ch) => acc + (/[\p{L}\p{N}]/u.test(ch)
    ? (acc && !acc.endsWith(' ') ? ' ' : '') + ch : ch), ''))
  .join('  ');

describe('mapa de agendas', () => {
  it('resolve as quatro agendas monitoradas', () => {
    for (const email of Object.keys(CLOSERS)) {
      expect(closerDaAgenda(email), email).not.toBeNull();
    }
  });

  it('nao se importa com maiuscula nem espaco em volta', () => {
    expect(closerDaAgenda('  Beatriz@AdvocaciaCBC.com  ')?.slug).toBe('beatriz');
  });

  it('agenda desconhecida devolve null, e nao um closer qualquer', () => {
    // a trava que evita mandar o rosto do colega errado
    for (const e of ['mizael@advocaciacbc.com', 'paulo@advocaciacbc.com', '', null, undefined]) {
      expect(closerDaAgenda(e)).toBeNull();
    }
  });

  it('deriva artigo e pronome do tratamento, sem campo separado', () => {
    expect(closerDaAgenda('emerson@advocaciacbc.com')).toMatchObject({
      completo: 'Dr. Emerson Calista', nomeCurto: 'Dr. Emerson', artigo: 'o', pronome: 'Ele',
    });
    expect(closerDaAgenda('marianamaciel@advocaciacbc.com')).toMatchObject({
      completo: 'Dra. Mariana Beraldo', nomeCurto: 'Dra. Mariana', artigo: 'a', pronome: 'Ela',
    });
  });

  it('todo slug e minusculo e sem espaco: ele vira nome de arquivo', () => {
    for (const c of Object.values(CLOSERS)) {
      expect(c.slug, c.nome).toMatch(/^[a-z]+$/);
    }
  });

  it('so usa Dr. ou Dra.', () => {
    for (const c of Object.values(CLOSERS)) {
      expect(['Dr.', 'Dra.'], c.nome).toContain(c.tratamento);
    }
  });
});

describe('o PDF diz o mesmo nome que o e-mail', () => {
  it('confere os quatro, lendo a camada de texto do arquivo gerado', async () => {
    for (const email of Object.keys(CLOSERS)) {
      const c = closerDaAgenda(email);
      const pdf = await montarDossie({
        nome: 'Ana', quandoTexto: 'Sexta-feira, 14 de agosto, às 15h', closerSlug: c.slug,
      });
      expect(await textoDaPagina(pdf, 2), email).toContain(semBrancos(espacar(c.completo)));
    }
  }, 30000);
});
