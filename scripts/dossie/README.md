# Ativos do dossiê da videochamada

Este passo é **offline e ocasional**: só roda quando o marketing publicar uma versão
nova do PDF no Canva. Não faz parte do build nem do deploy.

Ele transforma o arquivo do Canva nos dois ativos que o servidor consome, em
`client/netlify/functions/_assets/`:

| Ativo | O que é |
|---|---|
| `dossie-capa-base.pdf` | página 1 com o bloco de texto **removido**, fundo limpo (49 KB) |
| `dossie-miolo.pdf` | páginas 2 a 12 na ordem nova, imagens recomprimidas (4,1 MB) |

Em produção, `_lib/dossiePdf.mjs` só desenha o nome e a data na capa-base e cola o
miolo atrás. Leva 98 ms.

## Por que Python num repositório Node

O `pdf-lib`, que o servidor usa, não sabe recomprimir imagem nem remover texto de um
PDF existente. As duas coisas são necessárias uma única vez, para transformar o arquivo
de 16,5 MB do Canva em algo que caiba num anexo de e-mail. Fazer isso a cada envio
seria desperdício, já que o miolo é sempre o mesmo.

## Como rodar

```bash
python3 -m venv /tmp/dossie-venv
/tmp/dossie-venv/bin/pip install pymupdf pillow
/tmp/dossie-venv/bin/python scripts/dossie/gerar_ativos.py ~/Downloads/novo-canva.pdf
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieAtivos.test.mjs
```

O teste é a conferência: ele reprova placeholder esquecido, contagem de páginas errada
e arquivo grande demais para anexo. Rode sempre depois de regenerar.

## Armadilhas já pagas

**Cobrir não é apagar.** O bloco de texto antigo precisa ser removido por *redação*
(`add_redact_annot` + `apply_redactions`), não por um retângulo da cor do fundo por
cima. Visualmente fica igual, mas com o retângulo o `{{nome}}` continua na camada de
texto: quem selecionasse e copiasse leria o placeholder, e um leitor de tela o
anunciaria.

**`select()` deixa lixo.** Tirar páginas com `doc.select()` remove elas da árvore mas
deixa as imagens das outras como objetos órfãos, e nem `garbage=4` os remove: a capa
sozinha saiu com 16,4 MB por esse caminho. Por isso o script monta um documento novo
com `insert_pdf`, que copia só o que a página referencia.

**A fonte do Google Fonts é variável.** O `pdf-lib` precisa de instância estática, e o
caminho `ofl/montserrat/static/` **não existe** no repositório do Google (devolve uma
página HTML de 404 que o `curl` salva como um `.ttf` inválido de 302 KB). As fontes em
`_assets/` foram geradas com `fontTools.varLib.instancer` a partir de
`Montserrat[wght].ttf`, nos pesos 500 e 700.

## Se o Canva mudar o layout

As coordenadas em `ZONA_TEXTO` aqui e as do desenho em `_lib/dossiePdf.mjs` foram
medidas na versão de agosto de 2026: página **810 x 1012,5 pt**, fundo `#86CBFF`, texto
`#0b2342`, zona livre entre **y=300 e y=555** medindo do topo (o logo acaba em y=234, o
"CONHEÇA UM POUCO MAIS" começa em y=569). Mudou o layout, remeça e atualize os dois.

## Ordem das páginas

`ORDEM_MIOLO` promove "Como funciona a videochamada" (página 7 do original) para a
segunda posição do documento. É a página que mais reduz falta, porque é a única que
explica a conversa em si, e no celular quase ninguém chegava até a sétima.
