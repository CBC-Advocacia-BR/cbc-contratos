/**
 * Monta o dossie personalizado: desenha a capa e cola o miolo atras.
 *
 * O QUE ESTA FUNCAO NAO FAZ, de proposito: comprimir imagem e remover texto. As
 * duas coisas sao feitas UMA VEZ, offline, por scripts/dossie/gerar_ativos.py. O
 * pdf-lib nem saberia fazer, e repetir isso a cada envio seria desperdicio: o
 * miolo e sempre o mesmo. Medido: 98 ms por dossie, 4,1 MB de saida, 19 links
 * das materias preservados.
 *
 * GEOMETRIA (medida na capa do Canva de agosto/2026): pagina 810 x 1012,5 pt,
 * fundo #86CBFF, texto #0b2342, zona livre entre y=300 e y=555 medindo do TOPO
 * (o logo acaba em y=234, o "CONHECA UM POUCO MAIS" comeca em y=569). Mudou o
 * layout no Canva, remeça e atualize aqui E no gerar_ativos.py.
 */
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NAVY = rgb(0x0b / 255, 0x23 / 255, 0x42 / 255);
const ALT_PAGINA = 1012.5;
const X = 52;
const LARGURA_TEXTO = 718;

// o pdf-lib mede o y a partir de BAIXO; as coordenadas acima foram medidas de
// cima. Uma unica conversao aqui evita errar o sinal em cada uso.
const doTopo = (y) => ALT_PAGINA - y;

const caminhoAtivo = (n) => fileURLToPath(new URL(`../_assets/${n}`, import.meta.url));

// lidos uma vez por instancia da function, nao a cada envio
let cache = null;
function ativos() {
  if (!cache) {
    cache = {
      capa: readFileSync(caminhoAtivo('dossie-capa-base.pdf')),
      miolo: readFileSync(caminhoAtivo('dossie-miolo.pdf')),
      media: readFileSync(caminhoAtivo('Montserrat-Medium.ttf')),
      bold: readFileSync(caminhoAtivo('Montserrat-Bold.ttf')),
    };
  }
  return cache;
}

/** Quebra o texto em linhas que cabem na largura, medindo na fonte real. */
export function quebrarLinhas(texto, fonte, tamanho, larguraMax) {
  const linhas = [];
  let atual = '';
  for (const palavra of String(texto).split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= larguraMax) {
      atual = tentativa;
    } else {
      if (atual) linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/**
 * @param {{nome: string|null, quandoTexto: string}} p
 * @returns {Promise<Buffer>} PDF de 12 paginas, pronto para anexar
 */
export async function montarDossie({ nome, quandoTexto }) {
  const a = ativos();
  const doc = await PDFDocument.load(a.capa);
  doc.registerFontkit(fontkit);
  // subset:true embute so os glifos usados, o que mantem a saida enxuta.
  // A fonte inteira precisa estar aqui (e nao o subconjunto que veio do Canva)
  // porque um nome com "Ç" ou "Õ" fora do subconjunto sairia EM BRANCO.
  const med = await doc.embedFont(a.media, { subset: true });
  const bold = await doc.embedFont(a.bold, { subset: true });
  const pagina = doc.getPage(0);

  pagina.drawText(nome ? `Olá, ${nome}.` : 'Olá!', {
    x: X, y: doTopo(348), size: 34, font: bold, color: NAVY,
  });

  const corpo = 'Sua videochamada com o escritório Conforto, Bergonsi & Cavalari '
              + 'Advogados está confirmada para:';
  quebrarLinhas(corpo, med, 25, LARGURA_TEXTO).forEach((linha, i) => {
    pagina.drawText(linha, { x: X, y: doTopo(400 + i * 33), size: 25, font: med, color: NAVY });
  });

  pagina.drawText(quandoTexto, { x: X, y: doTopo(512), size: 29, font: bold, color: NAVY });

  const src = await PDFDocument.load(a.miolo);
  const paginas = await doc.copyPages(src, src.getPageIndices());
  for (const p of paginas) doc.addPage(p);

  doc.setTitle('Conforto, Bergonsi & Cavalari Advogados');
  doc.setAuthor('Conforto, Bergonsi & Cavalari Sociedade de Advogados');
  doc.setSubject('Apresentação institucional');
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}
