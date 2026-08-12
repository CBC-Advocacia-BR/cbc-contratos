"""
Passo OFFLINE (roda uma vez, na maquina, nao no servidor).

Quebra o PDF do Canva nos dois ativos que a function usa em producao:
  dossie-capa-base.pdf  pagina 1 com o bloco de texto REMOVIDO (fundo limpo)
  dossie-miolo.pdf      paginas 2 a 12 na ordem nova, ja comprimidas

Uso:  python3 scripts/dossie/gerar_ativos.py <arquivo-do-canva.pdf>
Deps: pip install pymupdf pillow   (use um venv; nao instale na raiz do workspace)

Em producao a function so desenha o texto na capa-base e cola o miolo atras.
Nao ha compressao nem redacao em tempo de envio: isso e caro e ja esta feito aqui.
"""
import io, os, sys
import fitz
from PIL import Image

AZUL_FUNDO = (134/255, 203/255, 255/255)      # #86CBFF amostrado da capa
ZONA_TEXTO = fitz.Rect(20, 300, 790, 555)     # entre o logo e o "CONHECA UM POUCO MAIS"

# "Como funciona a videochamada" (indice 6) sobe para a 2a posicao do documento.
# O resto mantem a ordem relativa. Sem a capa, que vira ativo separado.
ORDEM_MIOLO = [6, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]

DESTINO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                       'client', 'netlify', 'functions', '_assets')


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


# ── remendo da duracao da videochamada ───────────────────────────────────────
# Decisao do Paulo (12/08/2026): a conversa dura de 10 a 15 minutos, nao 30. O
# e-mail ja diz isso; sem este remendo o anexo contradiria o proprio e-mail, na
# pagina que foi promovida para a 2a posicao justamente por ser a mais lida.
#
# Isto e paliativo. O certo e o marketing corrigir no Canva; quando o arquivo novo
# chegar, apague esta secao e rode o gerador de novo.
#
# Geometria medida na versao de agosto/2026 da pagina:
DUR_ZONA = fitz.Rect(85.6, 443.0, 797.9, 534.0)   # ⚠️ comeca em 443: o titulo desce ate 442,3
DUR_X0, DUR_X1 = 91.6, 791.9
DUR_TAMANHO = 22.5
DUR_BASE_Y = 465.5
DUR_ENTRELINHA = 28.7
DUR_FUNDO = (13 / 255, 55 / 255, 86 / 255)        # #0D3756
DUR_FONTE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                         'client', 'netlify', 'functions', '_assets',
                         'Montserrat-Medium.ttf')
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
    font = fitz.Font(fontfile=DUR_FONTE)
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
    corrigir_duracao(d[0])   # a pagina da videochamada e a 1a do miolo
    n = comprimir(d)
    d.save(saida, garbage=4, deflate=True, clean=True)
    paginas, links = len(d), sum(len(d[i].get_links()) for i in range(len(d)))
    d.close()
    return n, paginas, links


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('uso: python3 scripts/dossie/gerar_ativos.py <arquivo-do-canva.pdf>')
    origem = sys.argv[1]
    os.makedirs(DESTINO, exist_ok=True)
    capa = os.path.join(DESTINO, 'dossie-capa-base.pdf')
    miolo = os.path.join(DESTINO, 'dossie-miolo.pdf')

    sobrou = gerar_capa_base(origem, capa)
    assert '{{' not in sobrou, f'placeholder sobrou na capa-base: {sobrou!r}'
    n, paginas, links = gerar_miolo(origem, miolo)

    print('capa-base: %5.0f KB | texto restante: %r' %
          (os.path.getsize(capa) / 1e3, sobrou.strip().replace(chr(10), ' | ')))
    print('miolo:     %5.1f MB | %d paginas | %d links | %d imagens recomprimidas' %
          (os.path.getsize(miolo) / 1e6, paginas, links, n))
