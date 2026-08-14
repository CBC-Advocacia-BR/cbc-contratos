// Os ativos do dossie sao arquivos binarios versionados, gerados por um passo
// OFFLINE (scripts/dossie/gerar_ativos.py). Este teste e a rede de seguranca de
// quem regenerar depois: pega placeholder esquecido, pagina fora de ordem e
// arquivo grande demais para anexo de e-mail, que sao os tres jeitos de estragar
// isto sem ninguem perceber ate o cliente receber.
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const ativo = (n) => fileURLToPath(new URL(`../../_assets/${n}`, import.meta.url));

/**
 * Texto REAL da camada de texto da pagina.
 *
 * ⚠️ Nao trocar por uma busca nos bytes crus do arquivo. A primeira versao deste
 * teste procurava "{{" em `bytes.toString('latin1')` e reprovava um ativo correto:
 * o conteudo do PDF vai comprimido, e a chance de os dois bytes 0x7B aparecerem
 * por acaso em 49 KB de dado comprimido passa de 50%. Foram achadas 2 ocorrencias,
 * ambas no meio de stream binario.
 */
async function textoDaPagina(caminho, numero = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(caminho)), useSystemFonts: false,
  }).promise;
  const conteudo = await (await doc.getPage(numero)).getTextContent();
  return conteudo.items.map((i) => i.str).join(' ');
}

describe('ativos do dossie', () => {
  it('a capa-base tem 1 pagina', async () => {
    const doc = await PDFDocument.load(readFileSync(ativo('dossie-capa-base.pdf')));
    expect(doc.getPageCount()).toBe(1);
  });

  it('a capa-base nao tem placeholder na camada de texto', async () => {
    // o texto antigo tinha de ser REMOVIDO por redacao, nao coberto por um
    // retangulo: coberto, "{{nome}}" continua selecionavel e copiavel
    const texto = await textoDaPagina(ativo('dossie-capa-base.pdf'));
    expect(texto).not.toContain('{{');
    expect(texto).not.toContain('vídeo chamada');
    expect(texto).not.toContain('agendada');
  });

  it('a capa-base preserva o que nao era para sair', async () => {
    // a redacao apaga uma ZONA: se a moldura estiver errada, ela come o logo,
    // a chamada de rodape ou o numero da OAB, e o teste tem de gritar
    const texto = await textoDaPagina(ativo('dossie-capa-base.pdf'));
    expect(texto.replace(/\s+/g, '')).toContain('CONHEÇAUMPOUCOMAIS');
    expect(texto.replace(/\s+/g, '')).toContain('OAB/SP55.227');
  });

  it('a capa-base mede 810 x 1012,5 pt', async () => {
    const doc = await PDFDocument.load(readFileSync(ativo('dossie-capa-base.pdf')));
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(810);
    expect(Math.round(height * 10)).toBe(10125);
  });

  it('a capa-base e leve (o select() da PyMuPDF deixava 16 MB de lixo)', () => {
    expect(statSync(ativo('dossie-capa-base.pdf')).size).toBeLessThan(300 * 1024);
  });

  it('o miolo tem as 10 paginas comuns a todos os closers', async () => {
    const doc = await PDFDocument.load(readFileSync(ativo('dossie-miolo.pdf')));
    expect(doc.getPageCount()).toBe(10);
  });

  it('o miolo NAO leva pagina de closer nenhum', async () => {
    // as duas personalizadas (apresentacao e "como funciona") moram nos arquivos
    // por closer; se uma vazar para o miolo, todo cliente veria o rosto da
    // mesma pessoa, qualquer que fosse a agenda
    const doc = await PDFDocument.load(readFileSync(ativo('dossie-miolo.pdf')));
    for (let i = 1; i <= doc.getPageCount(); i += 1) {
      const texto = await textoDaPagina(ativo('dossie-miolo.pdf'), i);
      expect(texto, `pagina ${i}`).not.toContain('Quem irá te atender');
      expect(texto, `pagina ${i}`).not.toContain('minutos e é conduzida');
    }
  });

  it('o miolo comeca pelo "Sobre" e termina pelos contatos', async () => {
    // texto justificado: o Canva separa as palavras com varios espacos
    const inicio = (await textoDaPagina(ativo('dossie-miolo.pdf'), 1)).replace(/\s+/g, ' ');
    expect(inicio).toContain('Desde 2017');
    const fim = await textoDaPagina(ativo('dossie-miolo.pdf'), 10);
    expect(fim).toContain('institucional@advocaciacbc.com');
    expect(fim).toContain('56.096.172/0001-65');
  });

  it('o miolo cabe em anexo de e-mail', () => {
    // 4,1 MB medido. O teto existe porque acima de ~10 MB varios provedores
    // recusam o anexo e o e-mail some sem erro visivel do nosso lado.
    expect(statSync(ativo('dossie-miolo.pdf')).size).toBeLessThan(6 * 1024 * 1024);
  });

  it('o generico existe, com a duracao certa e sem rosto de closer no texto', async () => {
    // e ele que salva o dia em que entrar um closer novo, ou alguem sair
    const doc = await PDFDocument.load(readFileSync(ativo('dossie-videochamada-generico.pdf')));
    expect(doc.getPageCount()).toBe(1);
    const texto = await textoDaPagina(ativo('dossie-videochamada-generico.pdf'), 1);
    expect(texto).toContain('10 a 15 minutos');
    expect(texto).not.toContain('30 minutos');
    expect(texto).toContain('chamada?');   // o titulo sobreviveu a redacao
  });

  it('as duas fontes estao presentes e sao TTF de verdade', () => {
    // o caminho ofl/montserrat/static/ do Google devolve HTML de 404, que o curl
    // salva como um .ttf invalido de 302 KB: daria erro so na hora de embutir
    for (const f of ['Montserrat-Medium.ttf', 'Montserrat-Bold.ttf']) {
      const bytes = readFileSync(ativo(f));
      expect(bytes.length).toBeGreaterThan(50_000);
      expect(bytes.subarray(0, 4).toString('hex')).toBe('00010000'); // assinatura TrueType
    }
  });
});

describe('as 2 paginas de cada closer', () => {
  it.each(['anacristina', 'beatriz', 'emerson', 'mariana'])('%s', async (slug) => {
    const arquivo = ativo(`dossie-closer-${slug}.pdf`);

    const doc = await PDFDocument.load(readFileSync(arquivo));
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(810);
    expect(Math.round(height * 10)).toBe(10125);

    // 1a: quem ira te atender, com o tratamento e sem sobra do nome antigo
    const apresentacao = (await textoDaPagina(arquivo, 1)).replace(/\s+/g, ' ');
    expect(apresentacao).toContain('Quem irá te atender');
    // "D R A." ou "D R." (o espaco entre R e A tambem e literal aqui: o nome sai
    // do Canva com um espaco entre cada letra)
    expect(apresentacao).toMatch(/D R( A)?\./);

    // 2a: como funciona, com a duracao remendada e o titulo intacto
    const chamada = await textoDaPagina(arquivo, 2);
    expect(chamada).toContain('10 a 15 minutos');
    expect(chamada).not.toContain('30 minutos');
    expect(chamada).toContain('chamada?');
    expect(chamada).toContain('não é necessário tomar nenhuma decisão');

    // leve: sao 4 arquivos, e todos viajam no bundle da function
    expect(statSync(arquivo).size).toBeLessThan(1.5 * 1024 * 1024);
  });
});
