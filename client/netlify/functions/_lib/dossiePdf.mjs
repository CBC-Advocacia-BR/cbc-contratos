/**
 * Monta o dossie personalizado: desenha a capa e cola o resto atras.
 *
 * O QUE ESTA FUNCAO NAO FAZ, de proposito: comprimir imagem e remover texto. As
 * duas coisas sao feitas UMA VEZ, offline, por scripts/dossie/gerar_ativos.py. O
 * pdf-lib nem saberia fazer, e repetir isso a cada envio seria desperdicio: o
 * miolo e sempre o mesmo. Medido: 98 ms por dossie, 4,1 MB de saida, 19 links
 * das materias preservados.
 *
 * O DOCUMENTO E MONTADO EM TRES PARTES, e nao guardado inteiro por closer:
 *   dossie-capa-base.pdf           1 pagina, o nome e a data sao desenhados aqui
 *   dossie-closer-<slug>.pdf       2 paginas do closer (apresentacao + como funciona)
 *   dossie-miolo.pdf               10 paginas iguais para todos
 * Guardar os quatro documentos completos custaria ~16 MB e faria uma correcao numa
 * pagina comum ter de ser refeita quatro vezes. A ordem final e a do Canva:
 * capa, closer, miolo[0..4], closer(como funciona), miolo[5..9].
 *
 * GEOMETRIA (medida na capa do Canva de agosto/2026): pagina 810 x 1012,5 pt,
 * fundo #86CBFF, texto #0b2342, zona livre entre y=300 e y=555 medindo do TOPO
 * (o logo acaba em y=234, o "CONHECA UM POUCO MAIS" comeca em y=569). Mudou o
 * layout no Canva, remeça e atualize aqui E no gerar_ativos.py.
 */
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CLOSERS } from './dossieClosers.mjs';

const NAVY = rgb(0x0b / 255, 0x23 / 255, 0x42 / 255);
const ALT_PAGINA = 1012.5;
const X = 52;
const LARGURA_TEXTO = 718;

// o pdf-lib mede o y a partir de BAIXO; as coordenadas acima foram medidas de
// cima. Uma unica conversao aqui evita errar o sinal em cada uso.
const doTopo = (y) => ALT_PAGINA - y;

/**
 * Onde procurar os ativos.
 *
 * ⚠️ Descoberto em producao (12/08/2026): `new URL('../_assets/x', import.meta.url)`
 * funciona na maquina e NAO funciona na Netlify. O empacotador junta tudo num
 * arquivo so, num diretorio que nao e o do fonte, entao o ".." aponta para outro
 * lugar; e os arquivos de `included_files` sao copiados preservando o caminho a
 * partir da raiz do build, que vira o diretorio de trabalho da lambda.
 *
 * Por isso a busca tenta os candidatos em ordem, em vez de apostar em um. A funcao
 * de conferencia devolve a lista tentada quando nao acha nada, senao o diagnostico
 * vira adivinhacao.
 */
function candidatos(n) {
  const daPasta = dirname(fileURLToPath(import.meta.url));
  return [
    join(daPasta, '..', '_assets', n),                        // fonte, sem empacotar
    join(daPasta, '_assets', n),                              // bundle ao lado de _assets
    join(process.cwd(), 'netlify', 'functions', '_assets', n), // included_files a partir da raiz
    join(process.cwd(), '_assets', n),
    join(process.cwd(), 'client', 'netlify', 'functions', '_assets', n),
  ];
}

function caminhoAtivo(n) {
  for (const c of candidatos(n)) {
    try { if (statSync(c).size > 0) return c; } catch { /* tenta o proximo */ }
  }
  const e = new Error(`ativo ${n} nao encontrado. Tentei: ${candidatos(n).join(' | ')}`);
  e.code = 'ATIVO_AUSENTE';
  throw e;
}

// lidos uma vez por instancia da function, nao a cada envio
const cache = new Map();
const lido = (n) => {
  if (!cache.has(n)) cache.set(n, readFileSync(caminhoAtivo(n)));
  return cache.get(n);
};

/** Arquivo das 2 paginas do closer, ou null para agenda fora do mapa. */
const arquivoDoCloser = (slug) => (slug ? `dossie-closer-${slug}.pdf` : null);

const NOMES_ATIVOS = ['dossie-capa-base.pdf', 'dossie-miolo.pdf',
                      'dossie-videochamada-generico.pdf',
                      'Montserrat-Medium.ttf', 'Montserrat-Bold.ttf',
                      ...Object.values(CLOSERS).map((c) => arquivoDoCloser(c.slug))];

/**
 * Todos os ativos chegaram ao servidor? (capa, miolo, generico, 2 fontes e um
 * arquivo por closer)
 *
 * Existe por causa de uma armadilha que so aparece em producao: o empacotador da
 * Netlify segue os imports de JS e ignora qualquer outro arquivo. Sem o
 * `included_files` no netlify.toml, o codigo sobe inteiro e funciona ate o primeiro
 * envio de verdade, quando estoura ENOENT. Como o worker so le os ativos ao montar
 * um PDF, um sistema desligado (ou sem pendencias) nunca revelaria a falta.
 *
 * Confere os arquivos dos closers TAMBEM: sem isso, um PDF de closer que nao subiu
 * so apareceria quando aquela pessoa especifica tivesse um agendamento, e no meio
 * de um dia de trabalho.
 *
 * Chamado a cada rodada do worker, custa um statSync por ativo e transforma uma
 * falha muda numa linha no console do Monitor.
 *
 * @returns {{ok: boolean, faltando: string[], bytes: Object<string, number>}}
 */
export function ativosDisponiveis() {
  const faltando = [];
  const bytes = {};
  for (const nome of NOMES_ATIVOS) {
    try {
      bytes[nome] = statSync(caminhoAtivo(nome)).size;
    } catch {
      faltando.push(nome);
    }
  }
  const r = { ok: faltando.length === 0, faltando, bytes };
  // Sem isto o diagnostico e "sumiu", que nao ajuda ninguem a achar o problema.
  if (!r.ok) {
    r.tentei = candidatos(NOMES_ATIVOS[0]);
    r.cwd = process.cwd();
    try { r.no_cwd = readdirSync(process.cwd()).slice(0, 25); } catch { /* sem permissao */ }
    try {
      r.na_pasta = readdirSync(dirname(fileURLToPath(import.meta.url))).slice(0, 25);
    } catch { /* idem */ }
  }
  return r;
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
 * @param {{nome: string|null, quandoTexto: string, closerSlug?: string|null}} p
 *   closerSlug ausente ou desconhecido = versao generica, sem a pagina de
 *   apresentacao e com a "como funciona" sem foto de ninguem.
 * @returns {Promise<Buffer>} PDF de 13 paginas (12 na versao generica)
 */
export async function montarDossie({ nome, quandoTexto, closerSlug = null }) {
  const doc = await PDFDocument.load(lido('dossie-capa-base.pdf'));
  doc.registerFontkit(fontkit);
  // subset:true embute so os glifos usados, o que mantem a saida enxuta.
  // A fonte inteira precisa estar aqui (e nao o subconjunto que veio do Canva)
  // porque um nome com "Ç" ou "Õ" fora do subconjunto sairia EM BRANCO.
  const med = await doc.embedFont(lido('Montserrat-Medium.ttf'), { subset: true });
  const bold = await doc.embedFont(lido('Montserrat-Bold.ttf'), { subset: true });
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

  // Um closer que nao esta no mapa nao pode virar erro nem virar o rosto do
  // colega errado: cai na versao generica, que e um documento completo, so sem a
  // pagina de apresentacao.
  const arquivo = arquivoDoCloser(closerSlug);
  const temCloser = !!arquivo && NOMES_ATIVOS.includes(arquivo);

  const miolo = await PDFDocument.load(lido('dossie-miolo.pdf'));
  const comuns = await doc.copyPages(miolo, miolo.getPageIndices());

  if (temCloser) {
    const src = await PDFDocument.load(lido(arquivo));
    const [apresentacao, comoFunciona] = await doc.copyPages(src, [0, 1]);
    doc.addPage(apresentacao);
    comuns.slice(0, 5).forEach((p) => doc.addPage(p));
    doc.addPage(comoFunciona);
    comuns.slice(5).forEach((p) => doc.addPage(p));
  } else {
    const src = await PDFDocument.load(lido('dossie-videochamada-generico.pdf'));
    const [comoFunciona] = await doc.copyPages(src, [0]);
    comuns.slice(0, 5).forEach((p) => doc.addPage(p));
    doc.addPage(comoFunciona);
    comuns.slice(5).forEach((p) => doc.addPage(p));
  }

  doc.setTitle('Conforto, Bergonsi & Cavalari Advogados');
  doc.setAuthor('Conforto, Bergonsi & Cavalari Sociedade de Advogados');
  doc.setSubject('Apresentação institucional');
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}
