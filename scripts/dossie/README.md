# Ativos do PDF de apresentação da videochamada

Este passo é **offline e ocasional**: só roda quando o marketing publicar uma versão
nova no Canva. Não faz parte do build nem do deploy.

Desde 14/08/2026 **cada closer tem o seu PDF**, exportado do Canva com a foto dele.
Dos 13 páginas de cada arquivo, **11 são idênticas nos quatro**. O script quebra isso
em `client/netlify/functions/_assets/`:

| Ativo | O que é |
|---|---|
| `dossie-capa-base.pdf` | página 1 com o bloco de texto **removido**, fundo limpo (49 KB) |
| `dossie-miolo.pdf` | as 10 páginas iguais para todo mundo, recomprimidas (3,9 MB) |
| `dossie-closer-<slug>.pdf` | 2 páginas do closer: "quem irá te atender" + "como funciona" (~0,5 MB cada) |
| `dossie-videochamada-generico.pdf` | "como funciona" sem closer, para agenda fora do mapa (0,4 MB) |

Guardar os quatro documentos completos custaria ~16 MB e, pior, faria uma correção
numa página comum precisar ser refeita quatro vezes.

Em produção, `_lib/dossiePdf.mjs` desenha o nome e a data na capa-base e cola o resto
na ordem do Canva: **capa · closer · miolo 1-5 · closer (como funciona) · miolo 6-10**.
Leva ~100 ms e sai com 4,4 MB.

## Quem é quem

O mapa agenda → closer é `client/netlify/functions/_lib/dossieClosers.mjs`, e é ele
que manda: o e-mail lê de lá. O `CLOSERS` deste diretório (dentro do `gerar_ativos.py`)
é um **espelho**, porque é o Python que escreve o nome dentro do PDF.

Divergir faria o e-mail dizer um nome e o anexo mostrar outro. O teste
`dossieClosers.test.mjs` compara os dois lados lendo a camada de texto do PDF gerado,
então a divergência reprova em vez de chegar ao cliente.

## Por que Python num repositório Node

O `pdf-lib`, que o servidor usa, não sabe recomprimir imagem nem remover texto de um
PDF existente. As duas coisas são necessárias uma única vez, para transformar os
17 MB do Canva em algo que caiba num anexo de e-mail. Fazer isso a cada envio seria
desperdício, já que o miolo é sempre o mesmo.

## Como rodar

```bash
python3 -m venv /tmp/dossie-venv
/tmp/dossie-venv/bin/pip install pymupdf pillow
/tmp/dossie-venv/bin/python scripts/dossie/gerar_ativos.py \
  --base ~/Downloads/Ana.pdf \
  --closer anacristina=~/Downloads/Ana.pdf \
  --closer beatriz=~/Downloads/Beatriz.pdf \
  --closer emerson=~/Downloads/Emerson.pdf \
  --closer mariana=~/Downloads/Mariana.pdf
cd client && npx vitest run netlify/functions/_lib/__tests__/dossiePdf.test.mjs \
                            netlify/functions/_lib/__tests__/dossieClosers.test.mjs
```

`--base` é de onde saem a capa e as 10 páginas comuns; qualquer um dos quatro serve.
O `--generico` só precisa ser passado quando houver um export **sem** foto de closer;
sem ele o arquivo genérico que já está em `_assets/` é mantido.

O teste é a conferência: reprova placeholder esquecido, ordem de página errada, nome
divergente do mapa em JS, "30 minutos" sobrevivente e arquivo grande demais para
anexo. Rode sempre depois de regenerar.

## Armadilhas já pagas

**Cobrir não é apagar.** O bloco de texto antigo precisa ser removido por *redação*
(`add_redact_annot` + `apply_redactions`), não por um retângulo da cor do fundo por
cima. Visualmente fica igual, mas com o retângulo o `{{nome}}` continua na camada de
texto: quem selecionasse e copiasse leria o placeholder, e um leitor de tela o
anunciaria. Vale igual para a linha do nome do closer, que é reescrita com o `Dra.`.

**`select()` deixa lixo.** Tirar páginas com `doc.select()` remove elas da árvore mas
deixa as imagens das outras como objetos órfãos, e nem `garbage=4` os remove: a capa
sozinha saiu com 16,4 MB por esse caminho. Por isso o script monta um documento novo
com `insert_pdf`, que copia só o que a página referencia.

**`page.insert_text` produz texto que o pdfjs não extrai.** O poppler e a própria
PyMuPDF liam; o pdfjs devolvia a página sem o parágrafo, o que quebraria seleção,
busca e leitor de tela em todo visualizador baseado nele, inclusive pré-visualização
de webmail. Por isso o script escreve com `fitz.TextWriter`.

**A fonte do Google Fonts é variável.** O `pdf-lib` precisa de instância estática, e o
caminho `ofl/montserrat/static/` **não existe** no repositório do Google (devolve uma
página HTML de 404 que o `curl` salva como um `.ttf` inválido de 302 KB). As fontes em
`_assets/` foram geradas com `fontTools.varLib.instancer` a partir de
`Montserrat[wght].ttf`, nos pesos 500 e 700.

## Se o Canva mudar o layout

Coordenadas medidas em agosto de 2026 e conferidas nos exports de 14/08. Página
**810 x 1012,5 pt**.

| Onde | O quê |
|---|---|
| capa | fundo `#86CBFF`, texto `#0b2342`, zona livre **y=300 a 555** (o logo acaba em 234, o "CONHEÇA UM POUCO MAIS" começa em 569) |
| nome do closer | fundo `#0D3756`, centro em **x=451,25**, linha de base **y=314,13**, largura máxima 500 pt |
| duração | fundo `#0D3756`, caixa **y=443 a 534** (⚠️ começa em 443 porque o título desce até 442,3), x de 91,6 a 791,9, corpo 22,5 pt, entrelinha 28,7 |

Mudou o layout, remeça e atualize aqui **e** em `_lib/dossiePdf.mjs`.

## Ordem das páginas

A ordem do Canva é mantida (decisão do Paulo, 14/08/2026). A versão anterior promovia
"Como funciona a videochamada" para a segunda posição; com a página do closer ocupando
aquele lugar, a promoção deixou de fazer sentido: as duas primeiras páginas depois da
capa já respondem *quem é essa pessoa* e *o que vai acontecer comigo*.

## O remendo da duração

Os exports do Canva dizem "cerca de 30 minutos" e o e-mail diz "de 10 a 15 minutos"
(decisão do Paulo, 12/08/2026). O script reescreve o parágrafo inteiro nos quatro
arquivos. **É paliativo**: o certo é o marketing corrigir no Canva. Quando o arquivo
novo chegar sem "30 minutos", `corrigir_duracao` avisa que ignorou o remendo, e aí a
seção pode ser apagada.
