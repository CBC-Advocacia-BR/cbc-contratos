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

  it('o miolo tem as 11 paginas restantes', async () => {
    const doc = await PDFDocument.load(readFileSync(ativo('dossie-miolo.pdf')));
    expect(doc.getPageCount()).toBe(11);
  });

  it('o miolo comeca por "Como funciona a videochamada"', async () => {
    // a razao de existir da reordenacao: essa e a pagina que reduz falta, e no
    // celular quase ninguem chegava ate a setima
    const texto = await textoDaPagina(ativo('dossie-miolo.pdf'), 1);
    expect(texto).toContain('30 minutos');
    expect(texto).toContain('não é necessário tomar nenhuma decisão');
  });

  it('o miolo termina pelos contatos', async () => {
    const texto = await textoDaPagina(ativo('dossie-miolo.pdf'), 11);
    expect(texto).toContain('institucional@advocaciacbc.com');
    expect(texto).toContain('56.096.172/0001-65');
  });

  it('o miolo cabe em anexo de e-mail', () => {
    // 4,1 MB medido. O teto existe porque acima de ~10 MB varios provedores
    // recusam o anexo e o e-mail some sem erro visivel do nosso lado.
    expect(statSync(ativo('dossie-miolo.pdf')).size).toBeLessThan(6 * 1024 * 1024);
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
