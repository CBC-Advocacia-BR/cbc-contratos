"""
Passo OFFLINE (roda uma vez, na maquina, nao no servidor).

Quebra os PDFs do Canva nos ativos que a function usa em producao:

  dossie-capa-base.pdf           pagina 1 com o bloco de texto REMOVIDO (fundo limpo)
  dossie-miolo.pdf               as 10 paginas iguais para todo mundo, ja comprimidas
  dossie-closer-<slug>.pdf       2 paginas do closer: "quem ira te atender" + "como funciona"
  dossie-videochamada-generico.pdf   "como funciona" sem closer, para agenda nao cadastrada

Uso:
  python3 scripts/dossie/gerar_ativos.py \\
      --closer anacristina=Ana.pdf --closer beatriz=Beatriz.pdf \\
      --closer emerson=Emerson.pdf --closer mariana=Mariana.pdf \\
      [--base Ana.pdf] [--generico dossie-sem-closer.pdf]

Deps: pip install pymupdf pillow   (use um venv; nao instale na raiz do workspace)

Cada closer tem o SEU PDF de 13 paginas exportado do Canva, e 11 dessas 13 sao
identicas nos quatro arquivos. Guardar quatro documentos inteiros custaria ~16 MB e,
pior, faria uma correcao numa pagina comum precisar ser refeita quatro vezes. Entao o
comum sai de UM arquivo (--base) e do arquivo de cada closer so vem o que e dele.

Em producao a function so desenha o texto na capa-base e cola as paginas atras. Nao
ha compressao nem redacao em tempo de envio: isso e caro e ja esta feito aqui.
"""
import io, os, sys
import fitz
from PIL import Image

AZUL_FUNDO = (134/255, 203/255, 255/255)      # #86CBFF amostrado da capa
ZONA_TEXTO = fitz.Rect(20, 300, 790, 555)     # entre o logo e o "CONHECA UM POUCO MAIS"

# Paginas do export de 13 paginas (1-based, como o Canva mostra):
#   1  capa                          -> vira dossie-capa-base.pdf
#   2  quem ira te atender  (CLOSER) -> vai para dossie-closer-<slug>.pdf
#   8  como funciona        (CLOSER) -> idem, com o remendo da duracao
#   as outras                        -> dossie-miolo.pdf, NA ORDEM ORIGINAL
#
# ⚠️ A ordem original e mantida por decisao do Paulo (14/08/2026). A versao anterior
# promovia "como funciona" para a 2a posicao; com a pagina do closer ocupando aquele
# lugar, a promocao deixou de fazer sentido.
PAG_CLOSER_NOME = 1        # indice 0-based da pagina "quem ira te atender"
PAG_CLOSER_CHAMADA = 7     # indice 0-based da pagina "como funciona a videochamada"
ORDEM_MIOLO = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]

# ⚠️ Espelho de client/netlify/functions/_lib/dossieClosers.mjs, que e a fonte
# unica em producao. Divergir daqui quebra o e-mail (que le o .mjs) contra o PDF
# (que sai daqui). O teste dossieClosers.test.mjs compara os dois lados lendo a
# camada de texto do PDF gerado: se alguem mudar so um, o teste reprova.
CLOSERS = {
    'anacristina': ('Dra.', 'Ana Cristina Piva'),
    'beatriz':     ('Dra.', 'Beatriz Cavalcante'),
    'emerson':     ('Dr.',  'Emerson Calista'),
    'mariana':     ('Dra.', 'Mariana Beraldo'),
}

DESTINO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                       'client', 'netlify', 'functions', '_assets')
FONTE_MEDIUM = os.path.join(DESTINO, 'Montserrat-Medium.ttf')


def comprimir(doc, largura_max=1300, qualidade=80, piso_bytes=60 * 1024):
    n, vistos = 0, set()
    for pno in range(len(doc)):
        for img in doc.get_page_images(pno, full=True):
            xref = img[0]
            if xref in vistos:
                continue
            vistos.add(xref)
            try:
                info = doc.extract_image(xref)
            except Exception:
                continue
            raw = info['image']
            if len(raw) < piso_bytes or info.get('smask'):
                continue
            try:
                im = Image.open(io.BytesIO(raw)).convert('RGB')
            except Exception:
                continue
            if im.width > largura_max:
                im = im.resize((largura_max, max(1, int(im.height * largura_max / im.width))),
                               Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=qualidade, optimize=True)
            if buf.tell() >= len(raw) * 0.9:
                continue
            doc.update_stream(xref, buf.getvalue(), new=False, compress=False)
            doc.xref_set_key(xref, 'Width', str(im.width))
            doc.xref_set_key(xref, 'Height', str(im.height))
            doc.xref_set_key(xref, 'ColorSpace', '/DeviceRGB')
            doc.xref_set_key(xref, 'BitsPerComponent', '8')
            doc.xref_set_key(xref, 'Filter', '/DCTDecode')
            doc.xref_set_key(xref, 'DecodeParms', 'null')
            n += 1
    return n


def _so_estas_paginas(origem, indices):
    """
    Documento NOVO contendo so as paginas pedidas.

    Nao usar `select()`: ele tira as paginas da arvore mas as imagens das outras
    continuam no arquivo como objetos orfaos, e nem `garbage=4` as remove. Medido:
    a capa sozinha saiu com 16,4 MB por esse caminho. `insert_pdf` num documento
    vazio copia apenas o que a pagina referencia.
    """
    novo = fitz.open()
    src = fitz.open(origem)
    for i in indices:
        novo.insert_pdf(src, from_page=i, to_page=i)
    src.close()
    return novo


def gerar_capa_base(origem, saida):
    d = _so_estas_paginas(origem, [0])
    # REDACAO, nao retangulo por cima: cobrir deixaria "{{nome}}" copiavel na
    # camada de texto. images/graphics NONE p/ nao arrastar o fundo, o logo nem a seta.
    d[0].add_redact_annot(ZONA_TEXTO, fill=AZUL_FUNDO)
    d[0].apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                          graphics=fitz.PDF_REDACT_LINE_ART_NONE)
    comprimir(d)
    d.save(saida, garbage=4, deflate=True, clean=True)
    sobrou = d[0].get_text()
    d.close()
    return sobrou


# ── nome do closer com tratamento ────────────────────────────────────────────
# Decisao do Paulo (14/08/2026): os closers sao apresentados como Dr. e Dra., no
# PDF e no e-mail. A linha inteira e reescrita (e nao so prefixada) porque o Canva
# escreve o nome com espaco entre cada letra, e enfiar "Dra." numa linha ja
# composta desalinharia a centralizacao.
#
# Geometria medida na pagina "quem ira te atender" de agosto/2026:
NOME_ZONA = fitz.Rect(150, 276, 760, 330)   # so a linha do nome; o titulo acaba em y=274,3
NOME_CENTRO_X = 451.25                       # centro das 4 versoes, identico nas quatro
NOME_BASE_Y = 314.13                         # linha de base do texto original
NOME_LARGURA_MAX = 500.0                     # o bloco de titulo mede ~508; 500 da folga
NOME_TAMANHO_MAX = 35.36                     # o maior que o Canva usou (nome curto)
NOME_FUNDO = (13 / 255, 55 / 255, 86 / 255)  # #0D3756 amostrado ao lado do nome


def espacar(texto):
    """
    'Dra. Ana Piva' -> 'D R A.  A N A  P I V A'

    Um espaco entre letras e dois entre palavras, que e como o Canva compos as
    quatro versoes. A pontuacao NAO ganha espaco antes: 'D R A .' fica com cara
    de erro de digitacao.
    """
    palavras = []
    for palavra in texto.split():
        buf = ''
        for ch in palavra:
            if ch.isalnum():
                buf += (' ' if buf and buf[-1] != ' ' else '') + ch
            else:
                buf += ch
        palavras.append(buf)
    return '  '.join(palavras)


def escrever_nome(page, tratamento, nome):
    """Apaga a linha do nome e reescreve com o tratamento na frente."""
    page.add_redact_annot(NOME_ZONA, fill=NOME_FUNDO)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                          graphics=fitz.PDF_REDACT_LINE_ART_NONE)

    linha = espacar(f'{tratamento} {nome}'.upper())
    font = fitz.Font(fontfile=FONTE_MEDIUM)
    tamanho = NOME_TAMANHO_MAX
    while font.text_length(linha, tamanho) > NOME_LARGURA_MAX and tamanho > 12:
        tamanho -= 0.25
    largura = font.text_length(linha, tamanho)

    # TextWriter, e nao insert_text: ver a nota em _justificar()
    escritor = fitz.TextWriter(page.rect, color=(1, 1, 1))
    escritor.append((NOME_CENTRO_X - largura / 2, NOME_BASE_Y), linha,
                    font=font, fontsize=tamanho)
    escritor.write_text(page)
    return linha, tamanho


# ── remendo da duracao da videochamada ───────────────────────────────────────
# Decisao do Paulo (12/08/2026): a conversa dura de 10 a 15 minutos, nao 30. O
# e-mail ja diz isso; sem este remendo o anexo contradiria o proprio e-mail.
#
# Isto e paliativo. O certo e o marketing corrigir no Canva; quando o arquivo novo
# chegar, apague esta secao e rode o gerador de novo. ⚠️ Os exports de 14/08 (um
# por closer) voltaram a dizer "30 minutos": o remendo continua necessario, agora
# nos quatro arquivos.
#
# Geometria medida na versao de agosto/2026 da pagina, conferida de novo nos
# exports de 14/08 (origem do paragrafo em y=465,52, x de 91,6 a 791,9):
DUR_ZONA = fitz.Rect(85.6, 443.0, 797.9, 534.0)   # ⚠️ comeca em 443: o titulo desce ate 442,3
DUR_X0, DUR_X1 = 91.6, 791.9
DUR_TAMANHO = 22.5
DUR_BASE_Y = 465.5
DUR_ENTRELINHA = 28.7
DUR_FUNDO = (13 / 255, 55 / 255, 86 / 255)        # #0D3756
DUR_TEXTO = ('A videochamada dura de 10 a 15 minutos e é conduzida por um '
             'profissional da nossa equipe, com suporte jurídico quando necessário.')


def _justificar(page, font, linhas, largura):
    """
    Ultima linha a esquerda; as demais esticadas ate a margem, como o Canva faz.

    ⚠️ Escreve com TextWriter, e nao com page.insert_text. Os dois desenham igual
    na tela, mas o insert_text produziu texto que o pdfjs NAO consegue extrair:
    o poppler e o proprio PyMuPDF liam, o pdfjs devolvia a pagina inteira sem o
    paragrafo. Isso quebraria a selecao de texto, a busca e o leitor de tela em
    todo visualizador baseado em pdfjs, que inclui pre-visualizacao de webmail.
    Pego pelo teste de ativos, que confere justamente pelo pdfjs.
    """
    espaco = font.text_length(' ', DUR_TAMANHO)
    escritor = fitz.TextWriter(page.rect, color=(1, 1, 1))
    for i, palavras in enumerate(linhas):
        y = DUR_BASE_Y + i * DUR_ENTRELINHA
        ultima = i == len(linhas) - 1
        sobra = largura - font.text_length(' '.join(palavras), DUR_TAMANHO)
        extra = 0 if (ultima or len(palavras) < 2) else sobra / (len(palavras) - 1)
        x = DUR_X0
        for palavra in palavras:
            escritor.append((x, y), palavra, font=font, fontsize=DUR_TAMANHO)
            x += font.text_length(palavra, DUR_TAMANHO) + espaco + extra
    escritor.write_text(page)


def corrigir_duracao(page):
    """Troca '30 minutos' por '10 a 15 minutos' reescrevendo o paragrafo inteiro."""
    if '30 minutos' not in page.get_text():
        print('  aviso: a pagina nao diz "30 minutos"; remendo da duracao IGNORADO')
        return False

    page.add_redact_annot(DUR_ZONA, fill=DUR_FUNDO)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                          graphics=fitz.PDF_REDACT_LINE_ART_NONE)

    largura = DUR_X1 - DUR_X0
    font = fitz.Font(fontfile=FONTE_MEDIUM)
    linhas, atual = [], []
    for palavra in DUR_TEXTO.split():
        teste = atual + [palavra]
        if font.text_length(' '.join(teste), DUR_TAMANHO) <= largura or not atual:
            atual = teste
        else:
            linhas.append(atual)
            atual = [palavra]
    if atual:
        linhas.append(atual)
    if len(linhas) > 3:
        raise SystemExit(f'ERRO: o texto novo ocupa {len(linhas)} linhas e so cabem 3')

    _justificar(page, font, linhas, largura)
    return True


def gerar_miolo(origem, saida):
    d = _so_estas_paginas(origem, ORDEM_MIOLO)
    if any('30 minutos' in d[i].get_text() for i in range(len(d))):
        raise SystemExit('ERRO: a pagina da videochamada entrou no miolo comum; '
                         'ela e do closer, confira ORDEM_MIOLO')
    n = comprimir(d)
    d.save(saida, garbage=4, deflate=True, clean=True)
    paginas, links = len(d), sum(len(d[i].get_links()) for i in range(len(d)))
    d.close()
    return n, paginas, links


def gerar_closer(origem, saida, slug):
    """As 2 paginas do closer: nome com tratamento + videochamada com a duracao certa."""
    tratamento, nome = CLOSERS[slug]
    d = _so_estas_paginas(origem, [PAG_CLOSER_NOME, PAG_CLOSER_CHAMADA])
    linha, tamanho = escrever_nome(d[0], tratamento, nome)
    corrigir_duracao(d[1])
    n = comprimir(d)
    d.save(saida, garbage=4, deflate=True, clean=True)
    conferido = d[0].get_text()
    d.close()
    assert linha in conferido, f'o nome nao ficou legivel na camada de texto: {conferido!r}'
    return linha, tamanho, n


def gerar_generico(origem, saida):
    """
    A pagina "como funciona" SEM closer, para agenda que nao esta no mapa.

    Existe para o dia em que entrar alguem novo, ou alguem sair: sem ela o envio
    quebraria em silencio para essa pessoa, ou pior, mandaria o rosto do colega
    errado. Sai de um export do Canva anterior aos PDFs por closer.

    A pagina e achada pelo CONTEUDO, e nao por indice: o export generico tem uma
    contagem de paginas diferente da dos exports por closer.
    """
    src = fitz.open(origem)
    # "vídeo chamada" sozinho tambem casa com a CAPA ("você tem uma vídeo chamada
    # agendada"), entao o titulo inteiro e que identifica a pagina
    achadas = [i for i in range(len(src))
               if 'Como funciona' in src[i].get_text() and 'vídeo chamada' in src[i].get_text()]
    src.close()
    if len(achadas) != 1:
        raise SystemExit(f'ERRO: achei {len(achadas)} paginas de videochamada em {origem}; '
                         'esperava exatamente 1')
    d = _so_estas_paginas(origem, achadas)
    corrigir_duracao(d[0])
    comprimir(d)
    d.save(saida, garbage=4, deflate=True, clean=True)
    d.close()


def _args(argv):
    closers, base, generico = {}, None, None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--closer':
            i += 1
            slug, _, caminho = argv[i].partition('=')
            if slug not in CLOSERS:
                sys.exit(f'slug desconhecido: {slug}. Conhecidos: {", ".join(CLOSERS)}')
            closers[slug] = caminho
        elif a == '--base':
            i += 1
            base = argv[i]
        elif a == '--generico':
            i += 1
            generico = argv[i]
        else:
            sys.exit(f'argumento desconhecido: {a}\n{__doc__}')
        i += 1
    if not closers:
        sys.exit(__doc__)
    return closers, base or next(iter(closers.values())), generico


if __name__ == '__main__':
    closers, base, generico = _args(sys.argv[1:])
    os.makedirs(DESTINO, exist_ok=True)

    capa = os.path.join(DESTINO, 'dossie-capa-base.pdf')
    sobrou = gerar_capa_base(base, capa)
    assert '{{' not in sobrou, f'placeholder sobrou na capa-base: {sobrou!r}'
    print('capa-base: %5.0f KB | texto restante: %r' %
          (os.path.getsize(capa) / 1e3, sobrou.strip().replace(chr(10), ' | ')))

    miolo = os.path.join(DESTINO, 'dossie-miolo.pdf')
    n, paginas, links = gerar_miolo(base, miolo)
    print('miolo:     %5.1f MB | %d paginas | %d links | %d imagens recomprimidas' %
          (os.path.getsize(miolo) / 1e6, paginas, links, n))

    for slug, caminho in closers.items():
        saida = os.path.join(DESTINO, f'dossie-closer-{slug}.pdf')
        linha, tamanho, n = gerar_closer(caminho, saida, slug)
        print('closer %-12s %5.1f MB | %-42s (%.2f pt) | %d imagens' %
              (slug + ':', os.path.getsize(saida) / 1e6, linha, tamanho, n))

    if generico:
        saida = os.path.join(DESTINO, 'dossie-videochamada-generico.pdf')
        gerar_generico(generico, saida)
        print('generico:  %5.1f MB' % (os.path.getsize(saida) / 1e6))
    elif not os.path.exists(os.path.join(DESTINO, 'dossie-videochamada-generico.pdf')):
        print('⚠️ sem dossie-videochamada-generico.pdf: agenda fora do mapa ficaria sem '
              'a pagina "como funciona". Rode de novo com --generico <export sem closer>.')
