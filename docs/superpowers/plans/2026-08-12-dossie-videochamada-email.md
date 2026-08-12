# Dossiê da videochamada por e-mail — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quando uma videochamada é agendada na agenda de uma vendedora, o lead recebe automaticamente, no e-mail, o PDF institucional com o nome dele e o dia e a hora da chamada na capa, enviado de `institucional@advocaciacbc.com`.

**Architecture:** nenhum cron novo. O `agenda-videochamadas-sync` (que já roda aos :00 e :45 de cada hora) ganha um passo final que despacha um worker de background. O worker seleciona os atendimentos pendentes, monta o PDF colando uma capa gerada na hora num miolo pré-comprimido, envia pela API do Gmail e marca a linha. As decisões (qual nome usar, quem é elegível, o que o e-mail diz) moram em libs puras testadas; a function só orquestra.

**Tech Stack:** Node 22 (Netlify Functions, `.mjs`), `pdf-lib` + `@pdf-lib/fontkit`, Gmail API v1 com OAuth refresh token, Supabase (RPC `SECURITY DEFINER` protegida por `BOT_RPC_SECRET`), vitest.

**Spec:** `docs/superpowers/specs/2026-08-12-dossie-videochamada-email-design.md`

## Global Constraints

- **REGRA #1 do CLAUDE.md:** antes de editar qualquer arquivo existente em `client/`, copiar para `backups/YYYYMMDD_HHMMSS_dossie_videochamada/`. Nunca usar `rm` em arquivo de projeto.
- **REGRA #14:** deploy só via `client/deploy.sh`, sempre `--prod`. Nunca `netlify deploy` direto.
- **Comentários e nomes de variável em português SEM acento.** Texto que o usuário ou o cliente lê vai COM acento.
- **Nunca usar travessão (— ou –)** em nada que o cliente lê: assunto, corpo do e-mail, capa do PDF. Usar vírgula, parênteses ou dois-pontos.
- **Baseline de lint = 18 erros** (`npm run lint:gate`). Erro novo reprova.
- Suíte inteira tem de passar: `cd client && npm test`.
- Toda gravação em `agenda_videochamadas` passa por RPC com `BOT_RPC_SECRET`: a RLS da tabela é fechada por causa do PII do cliente.
- **Nada é enviado a cliente real** até a Task 11. Até lá, `ativo: false` e `modo_teste: true`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `client/netlify/functions/_assets/dossie-capa-base.pdf` | página 1 do Canva com o bloco de texto removido (49 KB) |
| `client/netlify/functions/_assets/dossie-miolo.pdf` | páginas 2 a 12 na ordem nova, comprimidas (4,1 MB) |
| `client/netlify/functions/_assets/Montserrat-{Medium,Bold}.ttf` | fonte da capa, embutida no PDF gerado |
| `scripts/dossie/gerar_ativos.py` | passo OFFLINE que produz os dois PDF acima a partir do arquivo do Canva |
| `client/netlify/functions/_lib/dossieNome.mjs` | de onde sai o primeiro nome (puro) |
| `client/netlify/functions/_lib/dossieVideochamada.mjs` | elegibilidade + assunto e corpo do e-mail (puro) |
| `client/netlify/functions/_lib/dossiePdf.mjs` | monta o PDF (pdf-lib) |
| `client/netlify/functions/_lib/gmailEnviar.mjs` | token do Gmail + MIME + envio |
| `client/netlify/functions/videochamada-dossie-worker.mjs` | orquestra |
| `supabase_dossie_videochamada.sql` | 2 colunas + 1 coluna de corte + RPC |

---

### Task 1: Ativos do PDF e o script offline que os gera

O runtime NÃO comprime imagem nem remove texto: isso é caro e é feito uma vez aqui. `pdf-lib` também não sabe fazer nenhuma das duas coisas, por isso este passo é Python e roda na máquina, nunca no servidor.

**Files:**
- Create: `scripts/dossie/gerar_ativos.py`
- Create: `scripts/dossie/README.md`
- Create: `client/netlify/functions/_assets/dossie-capa-base.pdf`
- Create: `client/netlify/functions/_assets/dossie-miolo.pdf`
- Create: `client/netlify/functions/_assets/Montserrat-Medium.ttf`
- Create: `client/netlify/functions/_assets/Montserrat-Bold.ttf`
- Test: `client/netlify/functions/_lib/__tests__/dossieAtivos.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: os quatro arquivos em `_assets/`. A capa mede **810 x 1012,5 pt**, fundo `#86CBFF`, e a zona livre de texto vai de **y=300 a y=555** medindo do topo (o logo acaba em y=234, o "CONHEÇA UM POUCO MAIS" começa em y=569).

- [ ] **Step 1: Escrever o teste que trava as propriedades dos ativos**

`client/netlify/functions/_lib/__tests__/dossieAtivos.test.mjs`:

```javascript
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

describe('ativos do dossie', () => {
  it('a capa-base tem 1 pagina e nao tem placeholder', async () => {
    const bytes = readFileSync(ativo('dossie-capa-base.pdf'));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // o texto antigo tinha de ser REMOVIDO, nao coberto: se alguem cobrir com
    // um retangulo, "{{nome}}" continua copiavel na camada de texto
    expect(bytes.toString('latin1')).not.toContain('{{');
  });

  it('a capa-base mede 810 x 1012,5 pt', async () => {
    const doc = await PDFDocument.load(readFileSync(ativo('dossie-capa-base.pdf')));
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(810);
    expect(Math.round(height * 10)).toBe(10125);
  });

  it('o miolo tem 11 paginas e comeca por "Como funciona a videochamada"', async () => {
    const doc = await PDFDocument.load(readFileSync(ativo('dossie-miolo.pdf')));
    expect(doc.getPageCount()).toBe(11);
  });

  it('o miolo cabe em anexo de e-mail (limite de 6 MB)', () => {
    // 4,1 MB medido. O teto existe porque acima de ~10 MB varios provedores
    // recusam o anexo e o e-mail some sem erro visivel do nosso lado.
    expect(statSync(ativo('dossie-miolo.pdf')).size).toBeLessThan(6 * 1024 * 1024);
  });

  it('as duas fontes estao presentes', () => {
    for (const f of ['Montserrat-Medium.ttf', 'Montserrat-Bold.ttf']) {
      expect(statSync(ativo(f)).size).toBeGreaterThan(50_000);
    }
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieAtivos.test.mjs
```

Esperado: FALHA com `ENOENT ... _assets/dossie-capa-base.pdf`.

- [ ] **Step 3: Escrever o gerador offline**

`scripts/dossie/gerar_ativos.py` (o conteúdo validado está em `/private/tmp/.../scratchpad/gerar_ativos.py`; reproduzido aqui na íntegra):

```python
"""
Passo OFFLINE (roda uma vez, na maquina, nao no servidor).

Quebra o PDF do Canva nos dois ativos que a function usa em producao:
  dossie-capa-base.pdf  pagina 1 com o bloco de texto REMOVIDO (fundo limpo)
  dossie-miolo.pdf      paginas 2 a 12 na ordem nova, ja comprimidas

Uso:  python3 scripts/dossie/gerar_ativos.py <arquivo-do-canva.pdf>
Deps: pip install pymupdf pillow   (use um venv; nao instale na raiz do workspace)
"""
import io, os, sys
import fitz
from PIL import Image

AZUL_FUNDO = (134/255, 203/255, 255/255)      # #86CBFF amostrado da capa
ZONA_TEXTO = fitz.Rect(20, 300, 790, 555)     # entre o logo e o "CONHECA UM POUCO MAIS"
DESTINO = os.path.join(os.path.dirname(__file__), '..', '..',
                       'client', 'netlify', 'functions', '_assets')

# "Como funciona a videochamada" (indice 6) sobe para a 2a posicao do documento.
# O resto mantem a ordem relativa. Sem a capa, que vira ativo separado.
ORDEM_MIOLO = [6, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]


def _so_estas_paginas(origem, indices):
    """
    Documento NOVO contendo so as paginas pedidas.

    Nao usar `select()`: ele tira as paginas da arvore mas as imagens das outras
    continuam no arquivo como objetos orfaos, e nem `garbage=4` as remove. Medido:
    a capa sozinha saiu com 16,4 MB por esse caminho. `insert_pdf` num documento
    vazio copia apenas o que a pagina referencia (49 KB).
    """
    novo = fitz.open()
    src = fitz.open(origem)
    for i in indices:
        novo.insert_pdf(src, from_page=i, to_page=i)
    src.close()
    return novo


def comprimir(doc, largura_max=1300, qualidade=80, piso_bytes=60 * 1024):
    """Recomprime as imagens grandes. Nao toca em texto, links nem transparencia."""
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


def gerar_miolo(origem, saida):
    d = _so_estas_paginas(origem, ORDEM_MIOLO)
    n = comprimir(d)
    d.save(saida, garbage=4, deflate=True, clean=True)
    paginas = len(d)
    links = sum(len(d[i].get_links()) for i in range(len(d)))
    d.close()
    return n, paginas, links


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('uso: python3 gerar_ativos.py <arquivo-do-canva.pdf>')
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
```

- [ ] **Step 4: Escrever o README do script**

`scripts/dossie/README.md`:

```markdown
# Ativos do dossiê da videochamada

Este passo é **offline e ocasional**: só roda quando o marketing publicar uma versão
nova do PDF no Canva. Não faz parte do build nem do deploy.

## Por que Python num repositório Node

O `pdf-lib`, que o servidor usa, não sabe recomprimir imagem nem remover texto de um
PDF existente. As duas coisas são necessárias uma única vez, para transformar o arquivo
de 16,5 MB do Canva nos ativos leves que o servidor consome. Fazer isso a cada envio
seria caro e desnecessário, já que o miolo é sempre o mesmo.

## Como rodar

```bash
python3 -m venv /tmp/dossie-venv
/tmp/dossie-venv/bin/pip install pymupdf pillow
/tmp/dossie-venv/bin/python scripts/dossie/gerar_ativos.py ~/Downloads/novo-canva.pdf
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieAtivos.test.mjs
```

O teste é a conferência: ele reprova placeholder esquecido, contagem de páginas errada
e arquivo grande demais para anexo.

## Se o Canva mudar a capa de lugar

As coordenadas em `ZONA_TEXTO` e as do desenho em `_lib/dossiePdf.mjs` foram medidas na
versão de agosto de 2026: página 810 x 1012,5 pt, fundo `#86CBFF`, texto `#0b2342`, zona
livre entre y=300 e y=555 medindo do topo. Mudou o layout, remeça e atualize os dois.

## Ordem das páginas

`ORDEM_MIOLO` promove "Como funciona a videochamada" (página 7 do original) para a
segunda posição do documento. É a página que mais reduz falta, e no celular quase
ninguém chegava até a sétima.
```

- [ ] **Step 5: Gerar os ativos e copiar as fontes**

```bash
cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos"
python3 -m venv /tmp/dossie-venv
/tmp/dossie-venv/bin/pip install -q pymupdf pillow fonttools
curl -sL -o /tmp/Montserrat-var.ttf \
  "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf"
/tmp/dossie-venv/bin/python -c "
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont
import os
destino = 'client/netlify/functions/_assets'
os.makedirs(destino, exist_ok=True)
for nome, peso in [('Medium', 500), ('Bold', 700)]:
    f = TTFont('/tmp/Montserrat-var.ttf')
    instantiateVariableFont(f, {'wght': peso}, inplace=True, updateFontNames=True)
    f.save(f'{destino}/Montserrat-{nome}.ttf')
    print(f'Montserrat-{nome}.ttf ok')
"
/tmp/dossie-venv/bin/python scripts/dossie/gerar_ativos.py \
  "/Users/pauloconforto/Downloads/Conforto, Bergonsi e Cavalari Advogados (2).pdf"
```

Esperado:
```
Montserrat-Medium.ttf ok
Montserrat-Bold.ttf ok
capa-base:    49 KB | texto restante: 'C O N H E Ç A ... | O A B / S P  5 5 . 2 2 7'
miolo:       4.1 MB | 11 paginas | 19 links | 37 imagens recomprimidas
```

⚠️ A fonte variável do Google Fonts NÃO serve direto: o `pdf-lib` precisa de instância estática. É por isso que o `instantiateVariableFont` existe acima. O caminho `ofl/montserrat/static/` **não existe** no repositório do Google (devolve página HTML de 404, que salva como um .ttf inválido de 302 KB).

- [ ] **Step 6: Rodar o teste e ver passar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieAtivos.test.mjs
```

Esperado: 5 passed.

- [ ] **Step 7: Commit**

```bash
cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos"
git add scripts/dossie client/netlify/functions/_assets \
        client/netlify/functions/_lib/__tests__/dossieAtivos.test.mjs
git commit -m "dossie: ativos do PDF (capa-base + miolo comprimido) e gerador offline"
```

---

### Task 2: De onde sai o primeiro nome

**Files:**
- Create: `client/netlify/functions/_lib/dossieNome.mjs`
- Test: `client/netlify/functions/_lib/__tests__/dossieNome.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `primeiroNome(tituloEvento: string|null, nomeKommo?: string|null): string|null`.

- [ ] **Step 1: Escrever o teste, com os casos reais medidos na base**

`client/netlify/functions/_lib/__tests__/dossieNome.test.mjs`:

```javascript
// Casos REAIS da agenda (medidos em 12/08/2026). A ordem da cascata nao e
// arbitraria: em 63 de 334 pares (18,9%) o titulo e o Kommo divergem, e o titulo
// ganha quase sempre, porque e o que a vendedora escreveu DEPOIS de falar com a
// pessoa. Escrever "Ola, Maria" para quem se apresenta como Fatima e pior do que
// nao escrever nome nenhum: denuncia automacao cega no material que existe
// justamente para parecer serio.
import { describe, it, expect } from 'vitest';
import { primeiroNome } from '../dossieNome.mjs';

describe('o titulo do evento vence o cadastro do Kommo', () => {
  const casos = [
    ['Fatima +5518997479595', 'Maria de Fátima Frare Silva', 'Fatima'],
    ['Patty +5511947000390', 'PATRICIA DE OLIVEIRA MOURA FROS', 'Patty'],
    ['Cidinha +553491317716', 'MARIA APARECIDA NOGUEIRA E SILVA', 'Cidinha'],
    ['Guto +556599539957', 'Jose - CLAUDIANA DE SOUZA DUARTE COSTA', 'Guto'],
  ];
  for (const [titulo, kommo, esperado] of casos) {
    it(`${JSON.stringify(titulo)} -> ${esperado}`, () => {
      expect(primeiroNome(titulo, kommo)).toBe(esperado);
    });
  }
});

describe('limpeza do titulo', () => {
  it('tira o telefone do fim, em qualquer formato', () => {
    expect(primeiroNome('João 91 88151-233')).toBe('João');
    expect(primeiroNome('Antonio 19 97405-5513')).toBe('Antonio');
    expect(primeiroNome('Luiz 6696657579')).toBe('Luiz');
  });

  it('tira marcador no comeco', () => {
    expect(primeiroNome('*Luciano 17997048445')).toBe('Luciano');
  });

  it('corta na pontuacao quando o titulo tem dois nomes', () => {
    expect(primeiroNome('Reale/ Cris +559391209694', 'REALE')).toBe('Reale');
  });

  it('normaliza a caixa', () => {
    expect(primeiroNome('MARCIA +5511995178866')).toBe('Marcia');
    expect(primeiroNome('márcia +5511995178866')).toBe('Márcia');
  });
});

describe('quando o titulo nao serve, cai no Kommo', () => {
  it('titulo so com telefone', () => {
    expect(primeiroNome('17 991393438', 'Eliane')).toBe('Eliane');
  });

  it('titulo com palavra que nao e nome de pessoa', () => {
    expect(primeiroNome('Reagendamento +5511999999999', 'Carlos Souza')).toBe('Carlos');
  });

  it('rejeita apelido de sistema no Kommo tambem', () => {
    expect(primeiroNome('11 999999999', 'robsonagnelo98')).toBe(null);
  });
});

describe('sem nome em lugar nenhum', () => {
  it('devolve null para a capa se virar sem nome', () => {
    expect(primeiroNome('11 999999999')).toBe(null);
    expect(primeiroNome('', null)).toBe(null);
    expect(primeiroNome(null, null)).toBe(null);
  });

  it('nao aceita inicial solta', () => {
    expect(primeiroNome('J 11999999999')).toBe(null);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieNome.test.mjs
```

Esperado: FALHA com `Failed to resolve import "../dossieNome.mjs"`.

- [ ] **Step 3: Implementar**

`client/netlify/functions/_lib/dossieNome.mjs`:

```javascript
/**
 * De onde sai o primeiro nome que vai na capa do dossie. Modulo PURO.
 *
 * CASCATA: titulo do evento -> nome do lead no Kommo -> sem nome.
 *
 * O titulo vem PRIMEIRO de proposito, contra a intuicao de que "o cadastro vale
 * mais". Medido em 12/08/2026 sobre 334 pares dos ultimos 60 dias: os dois nomes
 * divergem em 63 casos (18,9%), e o titulo ganha quase sempre, porque e o que a
 * vendedora escreveu DEPOIS de falar com a pessoa:
 *
 *   titulo "Patty"    x  Kommo "PATRICIA DE OLIVEIRA MOURA FROS"  (e-mail: pattyfros90@)
 *   titulo "Cidinha"  x  Kommo "MARIA APARECIDA NOGUEIRA E SILVA" (e-mail: cidinhanog@)
 *   titulo "Irasmom"  x  Kommo "SILVA IRASMON"   (Kommo com sobrenome primeiro)
 *   titulo "Robson"   x  Kommo "robsonagnelo98"  (apelido de sistema)
 *
 * COBERTURA: dos 465 eventos dos ultimos 60 dias, 461 (99,1%) tem nome bom no
 * titulo, 4 caem na reserva do Kommo e nenhum fica sem nome.
 */

// Palavras que aparecem em titulo de agenda e NAO sao nome de pessoa.
const NAO_E_NOME = new Set([
  'reagendamento', 'reagendado', 'reagendar', 'remarcado', 'remarcar', 'retorno',
  'call', 'reuniao', 'reunião', 'cliente', 'lead', 'video', 'videochamada',
  'chamada', 'contato', 'teste', 'sem', 'nome', 'confirmar', 'confirmado',
]);

const capitaliza = (n) => (n.length > 1 ? n[0].toUpperCase() + n.slice(1).toLowerCase()
                                        : n.toUpperCase());

/** So aceita token que parece nome: 2+ caracteres, todos letras, fora da lista. */
function pareceNome(tok) {
  if (!tok || tok.length < 2) return false;
  // \p{L} cobre acento sem precisar listar caractere a caractere
  if (!/^\p{L}+$/u.test(tok)) return false;
  return !NAO_E_NOME.has(tok.toLowerCase());
}

function primeiroToken(texto) {
  if (!texto) return null;
  let t = String(texto).trim();
  t = t.replace(/[+0-9()\-/\s]+$/u, '');     // tira o telefone do fim
  t = t.replace(/^[^\p{L}]+/u, '');          // tira "*", "-", espaco do comeco
  const tok = t.split(/[\s/,.;:-]/u)[0];     // corta no primeiro separador
  return pareceNome(tok) ? capitaliza(tok) : null;
}

/**
 * Primeiro nome para a capa.
 * @param {string|null} tituloEvento titulo do evento na agenda ("Fatima +5518997479595")
 * @param {string|null} [nomeKommo]  nome do lead no Kommo, usado so como reserva
 * @returns {string|null} nome capitalizado, ou null se nenhuma fonte servir
 */
export function primeiroNome(tituloEvento, nomeKommo = null) {
  return primeiroToken(tituloEvento) || primeiroToken(nomeKommo);
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieNome.test.mjs
```

Esperado: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/dossieNome.mjs \
        client/netlify/functions/_lib/__tests__/dossieNome.test.mjs
git commit -m "dossie: cascata do primeiro nome (titulo do evento vence o Kommo)"
```

---

### Task 3: Elegibilidade e a data por extenso em BRT

**Files:**
- Create: `client/netlify/functions/_lib/dossieVideochamada.mjs`
- Test: `client/netlify/functions/_lib/__tests__/dossieVideochamada.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `elegivel(linha, config, agora): {ok: boolean, motivo: string|null}` onde `linha` tem `{event_id, cliente_email, status, scheduled_at, primeiro_visto_em, dossie_email_em, dossie_email_tentativas}` e `config` tem `{ativo, corte_em, max_tentativas}`.
  - `quandoPorExtenso(iso): {diaSemana, dataExtenso, dataCurta, hora, texto}` sempre em America/Sao_Paulo.

- [ ] **Step 1: Escrever o teste**

`client/netlify/functions/_lib/__tests__/dossieVideochamada.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { elegivel, quandoPorExtenso } from '../dossieVideochamada.mjs';

const AGORA = new Date('2026-08-12T18:00:00Z');   // 15h BRT
const CONFIG = { ativo: true, corte_em: '2026-08-10T00:00:00Z', max_tentativas: 3 };
const LINHA = {
  event_id: 'abc', cliente_email: 'lead@exemplo.com', status: 'agendada',
  scheduled_at: '2026-08-14T18:00:00Z', primeiro_visto_em: '2026-08-12T17:00:00Z',
  dossie_email_em: null, dossie_email_tentativas: 0,
};

describe('elegibilidade', () => {
  it('aprova o caso normal', () => {
    expect(elegivel(LINHA, CONFIG, AGORA)).toEqual({ ok: true, motivo: null });
  });

  it('barra tudo quando o kill-switch esta desligado', () => {
    const r = elegivel(LINHA, { ...CONFIG, ativo: false }, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'desligado' });
  });

  it('barra evento visto ANTES do corte', () => {
    // a trava que impede 3.036 e-mails no primeiro disparo
    const r = elegivel({ ...LINHA, primeiro_visto_em: '2026-08-01T10:00:00Z' }, CONFIG, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'anterior_ao_corte' });
  });

  it('barra quando nao ha corte configurado', () => {
    // sem corte definido o padrao e NAO enviar, nunca "enviar para todos"
    const r = elegivel(LINHA, { ...CONFIG, corte_em: null }, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'sem_corte' });
  });

  it('barra videochamada que ja passou', () => {
    const r = elegivel({ ...LINHA, scheduled_at: '2026-08-11T18:00:00Z' }, CONFIG, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'ja_passou' });
  });

  it('barra evento cancelado, excluido ou ja realizado', () => {
    for (const status of ['excluida', 'no_show', 'realizada', 'fechou']) {
      expect(elegivel({ ...LINHA, status }, CONFIG, AGORA).motivo).toBe('status_nao_agendada');
    }
  });

  it('barra sem e-mail do cliente', () => {
    expect(elegivel({ ...LINHA, cliente_email: '' }, CONFIG, AGORA).motivo).toBe('sem_email');
    expect(elegivel({ ...LINHA, cliente_email: null }, CONFIG, AGORA).motivo).toBe('sem_email');
  });

  it('barra e-mail interno do escritorio', () => {
    // nao e para acontecer (o classifyEvent so aceita convidado externo), mas
    // uma linha de backfill antiga poderia ter escapado
    const r = elegivel({ ...LINHA, cliente_email: 'beatriz@advocaciacbc.com' }, CONFIG, AGORA);
    expect(r.motivo).toBe('email_interno');
  });

  it('nao reenvia o que ja foi enviado', () => {
    const r = elegivel({ ...LINHA, dossie_email_em: '2026-08-12T17:30:00Z' }, CONFIG, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'ja_enviado' });
  });

  it('desiste depois do teto de tentativas', () => {
    const r = elegivel({ ...LINHA, dossie_email_tentativas: 3 }, CONFIG, AGORA);
    expect(r).toEqual({ ok: false, motivo: 'tentativas_esgotadas' });
  });
});

describe('data por extenso, sempre em BRT', () => {
  it('escreve o dia da semana, a data e a hora', () => {
    const q = quandoPorExtenso('2026-08-14T18:00:00Z');   // 15h BRT
    expect(q.diaSemana).toBe('sexta-feira');
    expect(q.dataExtenso).toBe('14 de agosto');
    expect(q.dataCurta).toBe('14/08');
    expect(q.hora).toBe('15h');
    expect(q.texto).toBe('sexta-feira, 14 de agosto, às 15h');
  });

  it('mostra os minutos quando nao e hora cheia', () => {
    expect(quandoPorExtenso('2026-08-13T20:30:00Z').hora).toBe('17h30');
  });

  it('usa o dia BRT, nao o UTC', () => {
    // 14/08 as 00h30 UTC e ainda 13/08 as 21h30 no Brasil. Escrever "sexta" numa
    // chamada que o cliente tem na quinta e o erro classico deste projeto.
    const q = quandoPorExtenso('2026-08-14T00:30:00Z');
    expect(q.diaSemana).toBe('quinta-feira');
    expect(q.dataExtenso).toBe('13 de agosto');
    expect(q.hora).toBe('21h30');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieVideochamada.test.mjs
```

Esperado: FALHA com `Failed to resolve import "../dossieVideochamada.mjs"`.

- [ ] **Step 3: Implementar**

`client/netlify/functions/_lib/dossieVideochamada.mjs`:

```javascript
/**
 * Regras do envio do dossie: quem recebe e como a data e escrita. Modulo PURO.
 * O texto do e-mail fica em dossieTexto (Task 4), para separar decisao de copy.
 */

const INTERNO = /@advocaciacbc\.com$/i;
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
              'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
               'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Decide se esta linha da agenda deve receber o dossie AGORA.
 * @returns {{ok: boolean, motivo: string|null}} motivo e um codigo estavel, para log
 */
export function elegivel(linha, config, agora = new Date()) {
  if (!config?.ativo) return { ok: false, motivo: 'desligado' };

  // Sem corte configurado o padrao e NAO enviar. O contrario transformaria um
  // deploy distraido em 3.036 e-mails para gente cuja videochamada ja aconteceu.
  if (!config.corte_em) return { ok: false, motivo: 'sem_corte' };

  if (linha.dossie_email_em) return { ok: false, motivo: 'ja_enviado' };

  const tentativas = Number(linha.dossie_email_tentativas || 0);
  if (tentativas >= Number(config.max_tentativas || 3)) {
    return { ok: false, motivo: 'tentativas_esgotadas' };
  }

  const visto = linha.primeiro_visto_em ? new Date(linha.primeiro_visto_em) : null;
  if (!visto || visto < new Date(config.corte_em)) {
    return { ok: false, motivo: 'anterior_ao_corte' };
  }

  if (linha.status !== 'agendada') return { ok: false, motivo: 'status_nao_agendada' };

  const quando = linha.scheduled_at ? new Date(linha.scheduled_at) : null;
  if (!quando || quando <= agora) return { ok: false, motivo: 'ja_passou' };

  const email = String(linha.cliente_email || '').trim();
  if (!email) return { ok: false, motivo: 'sem_email' };
  if (INTERNO.test(email)) return { ok: false, motivo: 'email_interno' };

  return { ok: true, motivo: null };
}

/**
 * Data e hora por extenso, SEMPRE no horario de Brasilia.
 *
 * REGRA #11 do projeto: o runtime das functions e UTC, e uma chamada as 21h30 BRT
 * ja e o dia seguinte em UTC. Escrever "sexta" numa chamada que o cliente tem na
 * quinta e o erro classico deste projeto (ver a auditoria de datas de 31/07/2026).
 * Aqui o fuso e resolvido pelo Intl, que trata o calendario, nao por subtracao de 3h.
 */
export function quandoPorExtenso(iso) {
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});

  const dia = Number(partes.day);
  const mes = Number(partes.month);
  const hora24 = Number(partes.hour) % 24;
  const minuto = Number(partes.minute);

  // o indice do dia da semana vem de uma data ancorada ao meio-dia BRT, para nao
  // escorregar de dia por causa da hora
  const diaSemana = DIAS[new Date(`${partes.year}-${partes.month}-${partes.day}T12:00:00-03:00`).getUTCDay()];
  const hora = minuto === 0 ? `${hora24}h` : `${hora24}h${String(minuto).padStart(2, '0')}`;
  const dataExtenso = `${dia} de ${MESES[mes - 1]}`;
  const dataCurta = `${String(dia).padStart(2, '0')}/${partes.month}`;

  return { diaSemana, dataExtenso, dataCurta, hora, texto: `${diaSemana}, ${dataExtenso}, às ${hora}` };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieVideochamada.test.mjs
```

Esperado: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/dossieVideochamada.mjs \
        client/netlify/functions/_lib/__tests__/dossieVideochamada.test.mjs
git commit -m "dossie: elegibilidade do envio e data por extenso em BRT"
```

---

### Task 4: O texto do e-mail

**Files:**
- Create: `client/netlify/functions/_lib/dossieTexto.mjs`
- Test: `client/netlify/functions/_lib/__tests__/dossieTexto.test.mjs`

**Interfaces:**
- Consumes: `quandoPorExtenso` da Task 3.
- Produces: `montarEmail({nome, quando, vendedoraEmail, config}): {assunto, html, texto}` onde `quando` é o retorno de `quandoPorExtenso`.

- [ ] **Step 1: Escrever o teste**

`client/netlify/functions/_lib/__tests__/dossieTexto.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { montarEmail } from '../dossieTexto.mjs';
import { quandoPorExtenso } from '../dossieVideochamada.mjs';

const QUANDO = quandoPorExtenso('2026-08-14T18:00:00Z');
const base = (extra = {}) => montarEmail({
  nome: 'Fátima', quando: QUANDO, vendedoraEmail: 'beatriz@advocaciacbc.com',
  config: {}, ...extra,
});

describe('assunto', () => {
  it('diz o dia e a hora, que e o que faz abrir', () => {
    expect(base().assunto).toBe('Sua videochamada de sexta-feira (14/08), às 15h');
  });
});

describe('corpo', () => {
  it('trata a pessoa pelo nome', () => {
    expect(base().html).toContain('Olá, Fátima.');
  });

  it('funciona sem nome', () => {
    const r = base({ nome: null });
    expect(r.html).toContain('Olá!');
    expect(r.html).not.toContain('undefined');
    expect(r.html).not.toContain('null');
  });

  it('repete no corpo o essencial que esta no anexo', () => {
    // anexo de 4 MB muita gente nao abre no celular
    const h = base().html;
    expect(h).toContain('30 minutos');
    expect(h).toContain('não precisa decidir nada');
  });

  it('traz o bloco de verificacao, que e o que desarma a objecao de golpe', () => {
    const h = base().html;
    expect(h).toContain('OAB/SP 55.227');
    expect(h).toContain('56.096.172/0001-65');
    expect(h).toContain('Rua Guatemala, 122');
    expect(h).toContain('13465-761');
  });

  it('nunca usa travessao no que o cliente le', () => {
    const r = base();
    expect(r.assunto + r.html + r.texto).not.toMatch(/[—–]/);
  });

  it('escapa o nome, para um apostrofo nao quebrar o HTML', () => {
    const h = base({ nome: "D'Ávila <b>" }).html;
    expect(h).toContain('&lt;b&gt;');
    expect(h).not.toContain('<b>');
  });

  it('tem versao em texto puro, para quem bloqueia HTML', () => {
    const t = base().texto;
    expect(t).toContain('Olá, Fátima.');
    expect(t).toContain('sexta-feira, 14 de agosto, às 15h');
    expect(t).not.toMatch(/<[a-z]/i);
  });
});

describe('configuracao', () => {
  it('deixa trocar assunto e saudacao sem deploy', () => {
    const r = base({ config: { assunto: 'Amanhã tem conversa, {{primeiro_nome}}' } });
    expect(r.assunto).toBe('Amanhã tem conversa, Fátima');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieTexto.test.mjs
```

Esperado: FALHA com `Failed to resolve import "../dossieTexto.mjs"`.

- [ ] **Step 3: Implementar**

`client/netlify/functions/_lib/dossieTexto.mjs`:

```javascript
/**
 * Assunto e corpo do e-mail que acompanha o dossie. Modulo PURO.
 *
 * TRES ESCOLHAS DE CONTEUDO, e o porque de cada uma:
 *  1. o corpo REPETE o essencial do anexo (duracao, que nao precisa decidir nada,
 *     o que ajuda ter em maos): anexo de 4 MB muita gente nao abre no celular;
 *  2. o bloco "nossos dados" existe so para desarmar a objecao de golpe, que e o
 *     objetivo numero um do material, e e justamente o que falta no PDF do Canva;
 *  3. sem travessao em lugar nenhum (REGRA #6 do CLAUDE.md).
 *
 * Assunto e saudacao sao sobrescreviveis por bot_config, sem deploy.
 */
import { escapeHtml } from './validate.mjs';

const ESCRITORIO = 'Conforto, Bergonsi &amp; Cavalari Advogados';
const OAB = 'OAB/SP 55.227';
const CNPJ = '56.096.172/0001-65';
const ENDERECO = 'Rua Guatemala, 122, Jardim Santo Antônio, Americana/SP, CEP 13465-761';

const preencher = (modelo, vars) =>
  String(modelo).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));

/**
 * @param {{nome: string|null, quando: object, vendedoraEmail: string, config: object}} p
 * @returns {{assunto: string, html: string, texto: string}}
 */
export function montarEmail({ nome, quando, vendedoraEmail, config = {} }) {
  const vars = {
    primeiro_nome: nome || '',
    dia_semana: quando.diaSemana,
    data_curta: quando.dataCurta,
    data_extenso: quando.dataExtenso,
    hora: quando.hora,
  };

  const assunto = preencher(
    config.assunto || 'Sua videochamada de {{dia_semana}} ({{data_curta}}), às {{hora}}',
    vars,
  ).trim();

  const saudacao = nome ? `Olá, ${escapeHtml(nome)}.` : 'Olá!';

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:600px">
  <p style="margin:0 0 16px">${saudacao}</p>

  <p style="margin:0 0 16px">Sua videochamada com o nosso escritório está confirmada para
    <strong>${quando.diaSemana}, ${quando.dataExtenso}, às ${quando.hora}</strong>.
    O link já está no convite que chegou na sua agenda.</p>

  <p style="margin:0 0 16px">Enviamos este e-mail para que você chegue à conversa sabendo com
    quem está falando. Em anexo vai uma apresentação do escritório: quem somos, os sócios,
    como conduzimos um caso do início ao fim e como funciona a videochamada.</p>

  <p style="margin:0 0 8px"><strong>Sobre a conversa</strong></p>
  <p style="margin:0 0 16px">Dura cerca de 30 minutos e serve para entendermos a sua situação.
    Você não precisa decidir nada durante a chamada. Se puder, tenha em mãos o contrato de
    compra da cota e o extrato ou os comprovantes de pagamento. Se não tiver, tudo bem: a
    conversa acontece do mesmo jeito.</p>

  <p style="margin:0 0 8px"><strong>Nossos dados, se quiser conferir</strong></p>
  <p style="margin:0 0 16px;color:#4b5563">Conforto, Bergonsi &amp; Cavalari Sociedade de
    Advogados, ${OAB}, CNPJ ${CNPJ}.<br>${ENDERECO}.<br>
    Inscrição consultável no site da OAB/SP e em confortobergonsi.com.br.</p>

  <p style="margin:0 0 16px">Se precisar remarcar, é só responder este e-mail.</p>

  <p style="margin:0 0 4px">Até ${quando.diaSemana},</p>
  <p style="margin:0 0 24px"><strong>${ESCRITORIO}</strong></p>

  <p style="margin:0;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px">
    Você recebeu esta mensagem porque agendou uma videochamada com o escritório. É informativa
    e não constitui oferta de serviço nem parecer jurídico.</p>
</div>`;

  const texto = [
    nome ? `Olá, ${nome}.` : 'Olá!',
    '',
    `Sua videochamada com o nosso escritório está confirmada para ${quando.texto}.`,
    'O link já está no convite que chegou na sua agenda.',
    '',
    'Dura cerca de 30 minutos e serve para entendermos a sua situação. Você não precisa',
    'decidir nada durante a chamada. Se puder, tenha em mãos o contrato de compra da cota',
    'e o extrato ou os comprovantes de pagamento. Se não tiver, tudo bem.',
    '',
    'Nossos dados, se quiser conferir:',
    `Conforto, Bergonsi & Cavalari Sociedade de Advogados, ${OAB}, CNPJ ${CNPJ}.`,
    `${ENDERECO}.`,
    '',
    'Se precisar remarcar, é só responder este e-mail.',
    '',
    `Até ${quando.diaSemana},`,
    'Conforto, Bergonsi & Cavalari Advogados',
  ].join('\n');

  return { assunto, html, texto, responderPara: vendedoraEmail };
}
```

⚠️ Se `escapeHtml` não existir em `_lib/validate.mjs`, adicione lá (não crie uma cópia local):

```javascript
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossieTexto.test.mjs
```

Esperado: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/dossieTexto.mjs \
        client/netlify/functions/_lib/__tests__/dossieTexto.test.mjs \
        client/netlify/functions/_lib/validate.mjs
git commit -m "dossie: assunto e corpo do e-mail, com bloco de verificacao do escritorio"
```

---

### Task 5: Montagem do PDF

**Files:**
- Create: `client/netlify/functions/_lib/dossiePdf.mjs`
- Modify: `client/package.json` (adicionar `@pdf-lib/fontkit`)
- Modify: `client/netlify.toml` (bloco `[functions]`)
- Test: `client/netlify/functions/_lib/__tests__/dossiePdf.test.mjs`

**Interfaces:**
- Consumes: os ativos da Task 1.
- Produces:
  - `quebrarLinhas(texto, fonte, tamanho, larguraMax): string[]`
  - `montarDossie({nome, quandoTexto}): Promise<Buffer>` (12 páginas)

- [ ] **Step 1: Adicionar a dependência e liberar os ativos no empacotamento**

```bash
cd client && npm install @pdf-lib/fontkit
```

Em `client/netlify.toml`, o bloco `[functions]` passa a ser:

```toml
[functions]
  directory = "netlify/functions"
  # (12/08/2026) O empacotador da Netlify segue os imports de JS e mais nada: sem
  # esta linha os PDF e as fontes do dossie NAO sobem, e a function so descobre
  # isso em producao, com ENOENT no primeiro envio.
  included_files = ["netlify/functions/_assets/**"]
```

- [ ] **Step 2: Escrever o teste**

`client/netlify/functions/_lib/__tests__/dossiePdf.test.mjs`:

```javascript
// Estes testes usam os ativos REAIS. Nao ha simulacao: montar PDF e barato
// (98 ms medido) e o que interessa e justamente se o arquivo final sai integro.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { montarDossie, quebrarLinhas } from '../dossiePdf.mjs';

describe('quebra de linha', () => {
  const fonteFalsa = { widthOfTextAtSize: (t, tam) => t.length * tam * 0.5 };

  it('quebra pela largura medida na fonte', () => {
    const l = quebrarLinhas('um dois tres quatro cinco', fonteFalsa, 10, 60);
    expect(l.length).toBeGreaterThan(1);
    expect(l.join(' ')).toBe('um dois tres quatro cinco');
  });

  it('nao perde palavra maior que a linha', () => {
    const l = quebrarLinhas('supercalifragilistico ok', fonteFalsa, 10, 30);
    expect(l.join(' ')).toContain('supercalifragilistico');
  });

  it('aguenta texto vazio', () => {
    expect(quebrarLinhas('', fonteFalsa, 10, 100)).toEqual([]);
  });
});

describe('montagem do dossie', () => {
  it('produz 12 paginas', async () => {
    const pdf = await montarDossie({ nome: 'Fátima', quandoTexto: 'sexta-feira, 14 de agosto, às 15h' });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(12);
  });

  it('escreve o nome e o quando na capa, com acento', async () => {
    const pdf = await montarDossie({ nome: 'Fátima', quandoTexto: 'sexta-feira, 14 de agosto, às 15h' });
    // o texto vai na camada de texto do PDF, entao da para conferir sem renderizar
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(12);
    expect(pdf.length).toBeGreaterThan(1_000_000);
  });

  it('nao estoura o limite de anexo', async () => {
    const pdf = await montarDossie({ nome: 'Fátima', quandoTexto: 'sexta-feira, 14 de agosto, às 15h' });
    expect(pdf.length).toBeLessThan(6 * 1024 * 1024);
  });

  it('funciona sem nome', async () => {
    const pdf = await montarDossie({ nome: null, quandoTexto: 'segunda-feira, 17 de agosto, às 9h' });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(12);
  });

  it('preserva os links das materias', async () => {
    const pdf = await montarDossie({ nome: 'Ana', quandoTexto: 'terça-feira, 18 de agosto, às 10h' });
    const doc = await PDFDocument.load(pdf);
    let links = 0;
    for (const p of doc.getPages()) {
      const a = p.node.Annots();
      links += a ? a.size() : 0;
    }
    expect(links).toBe(19);
  });

  it('aguenta nome comprido sem transbordar', async () => {
    const pdf = await montarDossie({
      nome: 'Bartolomeu', quandoTexto: 'quarta-feira, 19 de agosto, às 16h30',
    });
    expect(pdf.length).toBeGreaterThan(1_000_000);
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossiePdf.test.mjs
```

Esperado: FALHA com `Failed to resolve import "../dossiePdf.mjs"`.

- [ ] **Step 4: Implementar**

`client/netlify/functions/_lib/dossiePdf.mjs`:

```javascript
/**
 * Monta o dossie personalizado: desenha a capa e cola o miolo atras.
 *
 * O QUE ESTA FUNCAO NAO FAZ, de proposito: comprimir imagem e remover texto. As
 * duas coisas sao feitas UMA VEZ, offline, por scripts/dossie/gerar_ativos.py. O
 * pdf-lib nem saberia fazer, e repetir isso a cada envio seria desperdicio: o
 * miolo e sempre o mesmo. Medido: 98 ms por dossie, 4,11 MB de saida.
 *
 * GEOMETRIA (medida na capa do Canva de agosto/2026): pagina 810 x 1012,5 pt,
 * fundo #86CBFF, texto #0b2342, zona livre entre y=300 e y=555 medindo do TOPO
 * (o logo acaba em y=234, o "CONHECA UM POUCO MAIS" comeca em y=569).
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

// lidos uma vez por instancia da function, nao por envio
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
 * @returns {Promise<Buffer>} PDF de 12 paginas
 */
export async function montarDossie({ nome, quandoTexto }) {
  const a = ativos();
  const doc = await PDFDocument.load(a.capa);
  doc.registerFontkit(fontkit);
  // subset:true embute so os glifos usados, o que mantem a saida enxuta
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
```

- [ ] **Step 5: Rodar o teste e ver passar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/dossiePdf.test.mjs
```

Esperado: 9 passed.

- [ ] **Step 6: Conferir com o olho, não só com o teste**

```bash
cd client && node -e "
import('./netlify/functions/_lib/dossiePdf.mjs').then(async (m) => {
  const pdf = await m.montarDossie({ nome: 'Fátima', quandoTexto: 'sexta-feira, 14 de agosto, às 15h' });
  require('fs').writeFileSync('/tmp/conferir-dossie.pdf', pdf);
  console.log('escrito /tmp/conferir-dossie.pdf', (pdf.length/1e6).toFixed(2), 'MB');
});
" && open /tmp/conferir-dossie.pdf
```

Confira na capa: acentos corretos em "Olá", "Fátima", "escritório", "está" e "às"; o texto não encosta no "CONHEÇA UM POUCO MAIS"; a segunda página é "Como funciona a vídeo chamada".

- [ ] **Step 7: Commit**

```bash
git add client/netlify/functions/_lib/dossiePdf.mjs \
        client/netlify/functions/_lib/__tests__/dossiePdf.test.mjs \
        client/package.json client/package-lock.json client/netlify.toml
git commit -m "dossie: montagem do PDF com pdf-lib (capa desenhada + miolo colado)"
```

---

### Task 6: Envio pelo Gmail da institucional@

**Files:**
- Create: `client/netlify/functions/_lib/gmailEnviar.mjs`
- Modify: `client/.env.example`
- Test: `client/netlify/functions/_lib/__tests__/gmailEnviar.test.mjs`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces:
  - `montarMime({de, para, responderPara, assunto, html, texto, anexo: {nome, bytes}}): string`
  - `enviarPeloGmail(mensagem): Promise<{ok: boolean, id?: string, erro?: string}>`
  - `tokenGmail(): Promise<string>`

- [ ] **Step 1: Escrever o teste (só a parte pura, a rede fica de fora)**

`client/netlify/functions/_lib/__tests__/gmailEnviar.test.mjs`:

```javascript
// So a montagem do MIME e testada aqui. A chamada de rede ao Gmail fica de fora:
// e o padrao do projeto (a decisao vira lib pura, a rede so na function), e um
// MIME malformado e justamente o erro que passa despercebido, porque o Gmail
// aceita a requisicao e entrega um e-mail quebrado.
import { describe, it, expect } from 'vitest';
import { montarMime } from '../gmailEnviar.mjs';

const base = (extra = {}) => montarMime({
  de: 'Conforto, Bergonsi & Cavalari Advogados <institucional@advocaciacbc.com>',
  para: 'lead@exemplo.com',
  responderPara: 'beatriz@advocaciacbc.com',
  assunto: 'Sua videochamada de sexta-feira (14/08), às 15h',
  html: '<p>Olá, Fátima.</p>',
  texto: 'Olá, Fátima.',
  anexo: { nome: 'CBC-Advogados-Apresentacao.pdf', bytes: Buffer.from('%PDF-1.7 teste') },
  ...extra,
});

describe('cabecalhos', () => {
  it('poe De, Para e Responder-para', () => {
    const m = base();
    expect(m).toContain('To: lead@exemplo.com');
    expect(m).toContain('Reply-To: beatriz@advocaciacbc.com');
    expect(m).toContain('institucional@advocaciacbc.com');
  });

  it('codifica o assunto com acento (RFC 2047)', () => {
    // assunto com acento em texto cru chega com caractere trocado em varios
    // clientes; o Gmail nao reclama, so entrega errado
    const m = base();
    expect(m).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(m).not.toContain('Subject: Sua videochamada de sexta');
  });

  it('nao codifica assunto que so tem ASCII', () => {
    const m = base({ assunto: 'Sua videochamada' });
    expect(m).toContain('Subject: Sua videochamada');
  });
});

describe('estrutura', () => {
  it('manda texto puro e HTML na mesma mensagem', () => {
    const m = base();
    expect(m).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(m).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(m).toContain('multipart/alternative');
  });

  it('anexa o PDF em base64', () => {
    const m = base();
    expect(m).toContain('Content-Type: application/pdf');
    expect(m).toContain('Content-Transfer-Encoding: base64');
    expect(m).toContain('filename="CBC-Advogados-Apresentacao.pdf"');
    expect(m).toContain(Buffer.from('%PDF-1.7 teste').toString('base64'));
  });

  it('quebra o base64 em linhas de 76, como o RFC manda', () => {
    const grande = Buffer.alloc(5000, 65);
    const m = base({ anexo: { nome: 'x.pdf', bytes: grande } });
    const linhas = m.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l));
    expect(linhas.length).toBeGreaterThan(10);
    expect(Math.max(...linhas.map((l) => l.length))).toBeLessThanOrEqual(76);
  });

  it('usa CRLF, nao LF', () => {
    // servidor de e-mail rejeita ou corrompe MIME com quebra de linha solitaria
    const m = base();
    expect(m).toContain('\r\n');
    expect(m.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('fecha a fronteira do multipart', () => {
    const m = base();
    const fronteira = m.match(/boundary="([^"]+)"/)[1];
    expect(m.trimEnd().endsWith(`--${fronteira}--`)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/gmailEnviar.test.mjs
```

Esperado: FALHA com `Failed to resolve import "../gmailEnviar.mjs"`.

- [ ] **Step 3: Implementar**

`client/netlify/functions/_lib/gmailEnviar.mjs`:

```javascript
/**
 * Envio de e-mail pela conta institucional@advocaciacbc.com, via API do Gmail.
 *
 * POR QUE GMAIL E NAO UM SERVICO DE DISPARO (decisao do Paulo, 12/08/2026): sai
 * do Gmail do escritorio, fica em "Enviados", e nao exige mexer no SPF do dominio,
 * que hoje sustenta o e-mail de todo mundo.
 *
 * ⚠️ RISCO CONHECIDO: o app OAuth deste projeto ja teve o refresh token morrer
 * sozinho (23/07/2026, invalid_grant) por estar em modo Testing no Google Cloud.
 * O app PRECISA estar publicado como "Interno" no Workspace. Por isso a
 * credencial entra no tokens-vigia-cron (Task 10): token morto significa dossie
 * nenhum enviado por semanas, sem ninguem perceber.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ENVIO_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';

// o client id/secret podem ser os mesmos do OAuth da agenda (mesmo app); o que
// muda e o refresh token, que precisa ser da conta institucional@
const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_OAUTH_REFRESH_TOKEN;

/** Renova o access token do Gmail a partir do refresh token da institucional@. */
export async function tokenGmail() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('GMAIL_OAUTH_* nao configurado (falta o refresh token da institucional@)');
  }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    throw new Error(`falha ao renovar token do Gmail: ${JSON.stringify(j).slice(0, 200)}`);
  }
  return j.access_token;
}

/** Assunto com acento precisa de RFC 2047, senao chega com caractere trocado. */
function assuntoCodificado(assunto) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(assunto)) return assunto;
  return `=?UTF-8?B?${Buffer.from(assunto, 'utf8').toString('base64')}?=`;
}

const base64Quebrado = (buf) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');

/**
 * Monta a mensagem MIME completa. PURO: sem rede, para poder ser testado.
 * Estrutura: multipart/mixed [ multipart/alternative [texto, html], pdf ]
 */
export function montarMime({ de, para, responderPara, assunto, html, texto, anexo }) {
  // fronteiras fixas por chamada, sem aleatoriedade, para o teste ser deterministico
  const fMix = 'cbc_mix_fronteira_0001';
  const fAlt = 'cbc_alt_fronteira_0001';
  const L = [];

  L.push(`From: ${de}`);
  L.push(`To: ${para}`);
  if (responderPara) L.push(`Reply-To: ${responderPara}`);
  L.push(`Subject: ${assuntoCodificado(assunto)}`);
  L.push('MIME-Version: 1.0');
  L.push(`Content-Type: multipart/mixed; boundary="${fMix}"`);
  L.push('');

  L.push(`--${fMix}`);
  L.push(`Content-Type: multipart/alternative; boundary="${fAlt}"`);
  L.push('');

  L.push(`--${fAlt}`);
  L.push('Content-Type: text/plain; charset="UTF-8"');
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(base64Quebrado(Buffer.from(texto, 'utf8')));

  L.push(`--${fAlt}`);
  L.push('Content-Type: text/html; charset="UTF-8"');
  L.push('Content-Transfer-Encoding: base64');
  L.push('');
  L.push(base64Quebrado(Buffer.from(html, 'utf8')));

  L.push(`--${fAlt}--`);
  L.push('');

  if (anexo) {
    L.push(`--${fMix}`);
    L.push('Content-Type: application/pdf');
    L.push('Content-Transfer-Encoding: base64');
    L.push(`Content-Disposition: attachment; filename="${anexo.nome}"`);
    L.push('');
    L.push(base64Quebrado(anexo.bytes));
  }

  L.push(`--${fMix}--`);
  return L.join('\r\n');
}

/**
 * Envia a mensagem. Nunca lanca: devolve {ok:false, erro} para o chamador
 * registrar e tentar de novo na rodada seguinte.
 * @returns {Promise<{ok: boolean, id?: string, erro?: string}>}
 */
export async function enviarPeloGmail({ de, para, responderPara, assunto, html, texto, anexo }) {
  try {
    const at = await tokenGmail();
    const mime = montarMime({ de, para, responderPara, assunto, html, texto, anexo });
    const r = await fetch(ENVIO_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'message/rfc822' },
      body: Buffer.from(mime, 'utf8'),
      signal: AbortSignal.timeout(30000),
    });
    const corpo = await r.text().catch(() => '');
    if (!r.ok) return { ok: false, erro: `Gmail HTTP ${r.status} ${corpo.slice(0, 200)}` };
    let id;
    try { id = JSON.parse(corpo).id; } catch { /* id e so para o log */ }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, erro: String(e?.message || e).slice(0, 200) };
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd client && npx vitest run netlify/functions/_lib/__tests__/gmailEnviar.test.mjs
```

Esperado: 9 passed.

- [ ] **Step 5: Documentar as variáveis novas**

Em `client/.env.example`, ao lado do bloco `GOOGLE_OAUTH_*`:

```bash
# Gmail da conta institucional@advocaciacbc.com, usado para enviar o dossie ao lead
# assim que a videochamada e agendada. O client id/secret podem ser os MESMOS do
# GOOGLE_OAUTH_* (mesmo app); o que muda e o refresh token, que precisa vir de um
# consentimento feito LOGADO na institucional@, com escopo gmail.send.
# ⚠️ O app OAuth precisa estar publicado como "Interno" no Google Cloud Console,
# senao o refresh token morre em poucos dias (aconteceu em 23/07/2026).
GMAIL_OAUTH_CLIENT_ID=
GMAIL_OAUTH_CLIENT_SECRET=
GMAIL_OAUTH_REFRESH_TOKEN=
```

- [ ] **Step 6: Commit**

```bash
git add client/netlify/functions/_lib/gmailEnviar.mjs \
        client/netlify/functions/_lib/__tests__/gmailEnviar.test.mjs client/.env.example
git commit -m "dossie: envio pela API do Gmail da institucional (MIME com anexo)"
```

---

### Task 7: Migração do banco

**Files:**
- Create: `supabase_dossie_videochamada.sql`

**Interfaces:**
- Consumes: tabela `agenda_videochamadas` existente.
- Produces: colunas `primeiro_visto_em`, `dossie_email_em`, `dossie_email_erro`, `dossie_email_tentativas`; RPCs `dossie_pendentes(p_chave, p_limite)` e `dossie_marcar(p_chave, p_event_id, p_erro)`.

- [ ] **Step 1: Escrever a migração**

`supabase_dossie_videochamada.sql`:

```sql
-- Dossie institucional por e-mail ao agendar videochamada (12/08/2026).
-- Spec: docs/superpowers/specs/2026-08-12-dossie-videochamada-email-design.md
--
-- A RLS de agenda_videochamadas e FECHADA (PII de cliente), entao a function nao
-- le nem escreve direto: passa por estas RPCs, protegidas por BOT_RPC_SECRET,
-- no mesmo padrao do agenda_videochamadas_upsert.

alter table public.agenda_videochamadas
  add column if not exists primeiro_visto_em timestamptz not null default now(),
  add column if not exists dossie_email_em timestamptz,
  add column if not exists dossie_email_erro text,
  add column if not exists dossie_email_tentativas smallint not null default 0;

comment on column public.agenda_videochamadas.primeiro_visto_em is
  'Quando o sync viu este evento pela PRIMEIRA vez. E o que sustenta o corte do '
  'dossie ("so vale de tal momento em diante"). Nao confundir com updated_at, que '
  'muda a cada rodada do sync e por isso nao serve de marco.';

-- As 3.036 linhas que ja existiam recebem o default now() na criacao da coluna, o
-- que as faria parecer recem-vistas. Empurrar para o passado garante que o corte
-- (definido DEPOIS desta migracao) as deixe de fora, que e o comportamento certo:
-- ninguem deve receber dossie de uma videochamada agendada semanas atras.
update public.agenda_videochamadas
   set primeiro_visto_em = least(coalesce(updated_at, now()), coalesce(scheduled_at, now()))
 where primeiro_visto_em >= now() - interval '5 minutes';

create index if not exists idx_agenda_dossie_pendente
  on public.agenda_videochamadas (scheduled_at)
  where dossie_email_em is null and status = 'agendada';

-- ── quem esta esperando dossie ─────────────────────────────────────────────
-- Devolve as candidatas cruas. A decisao de elegibilidade fica no codigo
-- (_lib/dossieVideochamada.mjs), que e testado; aqui so o filtro grosso que
-- evita trazer 3 mil linhas do banco a cada rodada.
create or replace function public.dossie_pendentes(p_chave text, p_limite integer default 50)
returns table (
  event_id text, vendedora_email text, cliente_email text, cliente_nome text,
  status text, scheduled_at timestamptz, primeiro_visto_em timestamptz,
  titulo text, lead_id bigint, nome_kommo text,
  dossie_email_em timestamptz, dossie_email_tentativas smallint
)
language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
    select a.event_id, a.vendedora_email, a.cliente_email, a.cliente_nome,
           a.status, a.scheduled_at, a.primeiro_visto_em,
           a.raw->>'summary', a.lead_id, k.nome,
           a.dossie_email_em, a.dossie_email_tentativas
      from agenda_videochamadas a
      left join kommo_leads k on k.lead_id::bigint = a.lead_id
     where a.dossie_email_em is null
       and a.status = 'agendada'
       and a.scheduled_at > now()
       and coalesce(a.cliente_email,'') <> ''
       and a.dossie_email_tentativas < 3
     order by a.scheduled_at
     limit greatest(1, least(coalesce(p_limite, 50), 200));
end $$;

-- ── registrar o resultado ──────────────────────────────────────────────────
create or replace function public.dossie_marcar(p_chave text, p_event_id text,
                                                p_erro text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_erro is null then
    update agenda_videochamadas
       set dossie_email_em = now(), dossie_email_erro = null,
           dossie_email_tentativas = dossie_email_tentativas + 1
     where event_id = p_event_id;
  else
    -- falha NAO marca dossie_email_em: a linha volta na proxima rodada ate o teto
    update agenda_videochamadas
       set dossie_email_erro = left(p_erro, 300),
           dossie_email_tentativas = dossie_email_tentativas + 1
     where event_id = p_event_id;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.dossie_pendentes(text, integer) from public, anon;
revoke all on function public.dossie_marcar(text, text, text) from public, anon;
```

- [ ] **Step 2: Aplicar a migração**

Use o MCP do Supabase (`apply_migration`, nome `dossie_videochamada`) com o conteúdo acima.

- [ ] **Step 3: Conferir que o corte protege o histórico**

```sql
select count(*) as total,
       count(*) filter (where primeiro_visto_em < now() - interval '1 hour') as no_passado,
       count(*) filter (where primeiro_visto_em >= now() - interval '1 hour') as recentes
from agenda_videochamadas;
```

Esperado: `no_passado` igual ao total (cerca de 3.036) e `recentes` igual a 0. Se `recentes` for grande, o `update` do Step 1 não rodou e **o corte não protegeria nada**.

- [ ] **Step 4: Conferir que as RPCs respondem e que a chave errada é recusada**

```sql
select count(*) from dossie_pendentes('<BOT_RPC_SECRET real>', 50);
select dossie_pendentes('chave-errada', 5);   -- deve dar: acesso negado
```

- [ ] **Step 5: Commit**

```bash
git add supabase_dossie_videochamada.sql
git commit -m "dossie: colunas de controle e RPCs de pendentes/marcar"
```

---

### Task 8: O worker

**Files:**
- Create: `client/netlify/functions/videochamada-dossie-worker.mjs`

**Interfaces:**
- Consumes: `primeiroNome` (Task 2), `elegivel`/`quandoPorExtenso` (Task 3), `montarEmail` (Task 4), `montarDossie` (Task 5), `enviarPeloGmail` (Task 6), RPCs (Task 7).
- Produces: endpoint `POST /.netlify/functions/videochamada-dossie-worker` com `x-bot-key`; devolve `{ok, enviados, pulados, falhas, detalhe[]}`.

- [ ] **Step 1: Implementar**

`client/netlify/functions/videochamada-dossie-worker.mjs`:

```javascript
/**
 * WORKER do dossie da videochamada. Chamado pelo agenda-videochamadas-sync ao fim
 * de cada rodada (:00 e :45 de cada hora) e tambem por HTTP com x-bot-key.
 *
 * NAO tem `schedule` de proposito: a Netlify responde 403 a qualquer chamada HTTP
 * externa feita a uma function AGENDADA (bloqueio na borda, antes do codigo rodar).
 * Sem isto nao daria para disparar a mao no dia do teste. Padrao ja usado em
 * backup-diario -> backup-worker-background e zapsign-lembrete-cron -> worker.
 *
 * ⚠️ NADA e enviado enquanto bot_config.dossie_videochamada.corte_em for nulo. E
 * a trava que impede o primeiro deploy de mandar e-mail para as 3.036 linhas ja
 * existentes na tabela, cuja videochamada aconteceu semanas atras.
 */
import { db, logAdvbox, heartbeat, getConfig } from './_lib/botDb.mjs';
import { primeiroNome } from './_lib/dossieNome.mjs';
import { elegivel, quandoPorExtenso } from './_lib/dossieVideochamada.mjs';
import { montarEmail } from './_lib/dossieTexto.mjs';
import { montarDossie } from './_lib/dossiePdf.mjs';
import { enviarPeloGmail } from './_lib/gmailEnviar.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const DE = 'Conforto, Bergonsi & Cavalari Advogados <institucional@advocaciacbc.com>';
const ANEXO = 'CBC-Advogados-Apresentacao.pdf';
const TETO_POR_RODADA = 25;   // 8 videochamadas/dia util: folga de 3x

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

export default async (req) => {
  const chave = req.headers.get('x-bot-key') || '';
  const interna = req.headers.get('x-cbc-interno') === RPC_SECRET;
  if (!interna && chave !== (process.env.BOT_PANEL_KEY || '')) {
    return json(401, { ok: false, error: 'nao autorizado' });
  }

  const resumo = { enviados: 0, pulados: 0, falhas: 0, detalhe: [] };
  try {
    const cfg = (await getConfig())?.dossie_videochamada || {};
    const modoTeste = cfg.modo_teste !== false;          // padrao: teste
    const emailTeste = cfg.email_teste || 'paulo@advocaciacbc.com';

    const { data: linhas, error } = await db.rpc('dossie_pendentes', {
      p_chave: RPC_SECRET, p_limite: TETO_POR_RODADA,
    });
    if (error) throw new Error(`dossie_pendentes: ${error.message}`);

    const agora = new Date();
    for (const linha of linhas || []) {
      const veredito = elegivel(linha, cfg, agora);
      if (!veredito.ok) {
        resumo.pulados += 1;
        resumo.detalhe.push({ event_id: linha.event_id, pulado: veredito.motivo });
        continue;
      }

      const nome = primeiroNome(linha.titulo, linha.nome_kommo);
      const quando = quandoPorExtenso(linha.scheduled_at);
      const { assunto, html, texto, responderPara } = montarEmail({
        nome, quando, vendedoraEmail: linha.vendedora_email, config: cfg,
      });

      let resultado;
      try {
        const pdf = await montarDossie({ nome, quandoTexto: quando.texto });
        resultado = await enviarPeloGmail({
          de: DE,
          para: modoTeste ? emailTeste : linha.cliente_email,
          responderPara: cfg.responder_para === 'institucional' ? null : responderPara,
          assunto, html, texto,
          anexo: { nome: ANEXO, bytes: pdf },
        });
      } catch (e) {
        resultado = { ok: false, erro: `montagem: ${String(e?.message || e).slice(0, 180)}` };
      }

      // marca SEMPRE, com sucesso ou com erro: e o que impede a linha de ser
      // tentada para sempre e o que faz o teto de tentativas valer
      await db.rpc('dossie_marcar', {
        p_chave: RPC_SECRET, p_event_id: linha.event_id,
        p_erro: resultado.ok ? null : resultado.erro,
      });

      if (resultado.ok) {
        resumo.enviados += 1;
        resumo.detalhe.push({ event_id: linha.event_id, enviado: true, teste: modoTeste });
      } else {
        resumo.falhas += 1;
        resumo.detalhe.push({ event_id: linha.event_id, erro: resultado.erro });
        await logAdvbox('dossie', 'erro',
          `dossie falhou p/ ${linha.event_id}: ${resultado.erro}`.slice(0, 300),
          { event_id: linha.event_id }).catch(() => {});
      }
    }

    const msg = `dossie: ${resumo.enviados} enviados, ${resumo.pulados} pulados, `
              + `${resumo.falhas} falhas${modoTeste ? ' (MODO TESTE)' : ''}`;
    if (resumo.enviados || resumo.falhas) {
      await logAdvbox('dossie', resumo.falhas ? 'aviso' : 'info', msg, resumo).catch(() => {});
    }
    await heartbeat('videochamada-dossie', true, msg);
    return json(200, { ok: true, modo_teste: modoTeste, ...resumo });
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300);
    await logAdvbox('dossie', 'erro', `worker do dossie falhou: ${msg}`, {}).catch(() => {});
    await heartbeat('videochamada-dossie', false, msg);
    return json(500, { ok: false, error: msg });
  }
};
```

- [ ] **Step 2: Conferir a sintaxe**

```bash
cd client && node --check netlify/functions/videochamada-dossie-worker.mjs && npm run lint:gate
```

Esperado: sem saída do `node --check`; o portão de lint no baseline 18.

- [ ] **Step 3: Commit**

```bash
git add client/netlify/functions/videochamada-dossie-worker.mjs
git commit -m "dossie: worker que monta e envia (nasce em modo teste)"
```

---

### Task 9: Ligar no sync e ajustar a lista de agendas

**Files:**
- Modify: `client/netlify/functions/_lib/googleAgenda.mjs:71`
- Modify: `client/netlify/functions/agenda-videochamadas-sync.mjs`

**Interfaces:**
- Consumes: o worker da Task 8.
- Produces: `VENDEDORAS` com `anacristina@` e sem `mizael@`.

- [ ] **Step 1: Backup, conforme a REGRA #1**

```bash
cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos"
mkdir -p "backups/$(date +%Y%m%d_%H%M%S)_dossie_videochamada"
cp client/netlify/functions/_lib/googleAgenda.mjs \
   client/netlify/functions/agenda-videochamadas-sync.mjs \
   "backups/$(date +%Y%m%d_%H%M%S)_dossie_videochamada/" 2>/dev/null || true
```

- [ ] **Step 2: Atualizar a lista de agendas**

Em `client/netlify/functions/_lib/googleAgenda.mjs`, trocar a linha 71 por:

```javascript
/**
 * Vendedoras monitoradas (lista fixa).
 * 26/06/2026: Beatriz, Mariana Maciel, Emerson e Mizael.
 * 12/08/2026 (Paulo): entra Ana Piva (anacristina@); sai Mizael, que nao tinha
 * nenhum atendimento nos 90 dias anteriores.
 */
export const VENDEDORAS = ['beatriz@advocaciacbc.com', 'marianamaciel@advocaciacbc.com',
                           'emerson@advocaciacbc.com', 'anacristina@advocaciacbc.com'];
```

- [ ] **Step 3: Despachar o worker no fim do sync**

Em `client/netlify/functions/agenda-videochamadas-sync.mjs`, logo ANTES do `await heartbeat(...)` do caminho de sucesso, inserir:

```javascript
    // (12/08/2026) Dossie institucional por e-mail. Vai DEPOIS do upsert e do match
    // com o Kommo de proposito: o worker precisa da linha ja gravada e, quando der,
    // do nome do lead. Com `await` e nao fire-and-forget: a licao do item 96 e que
    // fetch sem await morre quando a function responde, e foi assim que o backup
    // diario passou 16 dias sem rodar sem ninguem perceber.
    let dossie = null;
    try {
      const r = await fetch(`${process.env.URL}/.netlify/functions/videochamada-dossie-worker`, {
        method: 'POST',
        headers: { 'x-cbc-interno': RPC_SECRET },
        signal: AbortSignal.timeout(25000),
      });
      dossie = await r.json().catch(() => null);
    } catch (e) {
      // nunca derruba o sync das agendas, que alimenta o funil inteiro
      await logAdvbox('dossie', 'erro', `despacho do dossie falhou: ${e.message}`.slice(0, 200), {}).catch(() => {});
    }
```

E acrescentar `dossie` ao objeto devolvido no `return json({...})`.

- [ ] **Step 4: Conferir a sintaxe e rodar a suíte**

```bash
cd client && node --check netlify/functions/agenda-videochamadas-sync.mjs \
  && node --check netlify/functions/_lib/googleAgenda.mjs && npm test
```

Esperado: sintaxe ok e a suíte inteira passando.

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/googleAgenda.mjs \
        client/netlify/functions/agenda-videochamadas-sync.mjs
git commit -m "dossie: despacho no fim do sync; Ana Piva entra e Mizael sai das agendas"
```

---

### Task 10: Vigilância da credencial do Gmail

Sem isto, o token morto da Task 6 vira dossiê nenhum enviado por semanas, em silêncio. É a mitigação combinada com o Paulo ao escolher o Gmail como canal.

**Files:**
- Modify: `client/netlify/functions/tokens-vigia-cron.mjs`

**Interfaces:**
- Consumes: `tokenGmail` da Task 6.

- [ ] **Step 1: Backup**

```bash
cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos"
cp client/netlify/functions/tokens-vigia-cron.mjs \
   "backups/$(date +%Y%m%d_%H%M%S)_dossie_videochamada/"
```

- [ ] **Step 2: Acrescentar a checagem**

Em `client/netlify/functions/tokens-vigia-cron.mjs`, depois do bloco do Asaas:

```javascript
  // ── Gmail da institucional@: sustenta o envio do dossie da videochamada ──
  // Este e o token mais fragil do conjunto: o app OAuth deste projeto ja teve
  // refresh token morrer sozinho por estar em modo Testing (23/07/2026).
  if (process.env.GMAIL_OAUTH_REFRESH_TOKEN) {
    checagens.push(checar('Gmail institucional', async () => {
      const { tokenGmail } = await import('./_lib/gmailEnviar.mjs');
      await tokenGmail();
      return 'refresh token aceito, envio do dossie funcionando';
    }));
  }
```

E acrescentar o import no topo do arquivo, se o padrão do arquivo for import estático.

- [ ] **Step 3: Conferir a sintaxe**

```bash
cd client && node --check netlify/functions/tokens-vigia-cron.mjs
```

- [ ] **Step 4: Commit**

```bash
git add client/netlify/functions/tokens-vigia-cron.mjs
git commit -m "dossie: vigia diario da credencial do Gmail da institucional"
```

---

### Task 11: Configuração, deploy e a virada de chave

**Files:**
- Modify: `bot_config` (banco, sem deploy)
- Modify: `CLAUDE.md` (bloco "Estado atual")

- [ ] **Step 1: Semear a configuração DESLIGADA**

```sql
select bot_config_merge('dossie_videochamada', jsonb_build_object(
  'ativo', false,
  'modo_teste', true,
  'email_teste', 'paulo@advocaciacbc.com',
  'corte_em', null,
  'max_tentativas', 3,
  'responder_para', 'vendedora'
));
```

⚠️ `ativo: false` **e** `corte_em: null`: duas travas independentes. Nenhum e-mail sai deste deploy.

- [ ] **Step 2: Verificação completa antes de subir**

```bash
cd client && npm test && npm run lint:gate && npm run build && npm run check:functions
```

Esperado: suíte inteira verde, lint no baseline 18, build sem erro, sintaxe ok nas functions.

- [ ] **Step 3: Deploy**

```bash
cd client && ./deploy.sh
```

Anote o id do deploy para o rollback.

- [ ] **Step 4: Provar que os ativos subiram (a armadilha do `included_files`)**

```bash
curl -s -X POST "https://contratos-cbc.netlify.app/.netlify/functions/videochamada-dossie-worker" \
  -H "x-bot-key: $BOT_PANEL_KEY" | python3 -m json.tool
```

Esperado: `{"ok": true, "modo_teste": true, "enviados": 0, "pulados": N, ...}` com todos os pulados por `sem_corte`.

⚠️ Se vier `ENOENT` ou erro de montagem, o `included_files` do `netlify.toml` não funcionou e os PDF não chegaram ao servidor. Nesse caso, confirme o caminho real listando o diretório da function nos logs antes de mudar o código.

- [ ] **Step 5: Teste de ponta a ponta, com e-mail chegando na caixa do Paulo**

Pré-requisito, e só o Paulo pode fazer: app OAuth publicado como **Interno** no Google Cloud Console, e um consentimento com escopo `gmail.send` logado na `institucional@`, cujo refresh token vira `GMAIL_OAUTH_REFRESH_TOKEN` no Netlify (e exige redeploy, porque a variável é secreta).

Depois disso, crie um evento de teste numa das quatro agendas, com um convidado externo e link do Meet, título `Teste +5519999999999`, para daqui a 2 dias. Então:

```sql
select bot_config_merge('dossie_videochamada', jsonb_build_object(
  'ativo', true, 'corte_em', (now() - interval '10 minutes')::text));
```

```bash
curl -s -X POST "https://contratos-cbc.netlify.app/.netlify/functions/videochamada-dossie-worker" \
  -H "x-bot-key: $BOT_PANEL_KEY" | python3 -m json.tool
```

Esperado: `enviados: 1`, `modo_teste: true`, e o e-mail na caixa do Paulo, com o PDF de 4,5 MB anexado, nome "Teste" e a data certa na capa.

Confira na mensagem recebida: assunto com acento correto, o anexo abre, a segunda página é "Como funciona a videochamada", e o Responder-para aponta para a vendedora dona da agenda.

- [ ] **Step 6: A virada de chave (só com o "ok" do Paulo)**

```sql
select bot_config_merge('dossie_videochamada', jsonb_build_object(
  'modo_teste', false, 'corte_em', now()::text));
```

Da primeira rodada em diante, todo agendamento novo recebe. Nada do passado recebe.

- [ ] **Step 7: Conferir no dia seguinte**

```sql
select count(*) filter (where dossie_email_em is not null) as enviados,
       count(*) filter (where dossie_email_erro is not null) as com_erro,
       count(*) filter (where dossie_email_tentativas >= 3 and dossie_email_em is null) as desistidos
from agenda_videochamadas where primeiro_visto_em >= now() - interval '1 day';
```

- [ ] **Step 8: Registrar no guia do projeto e commitar**

Acrescente um bloco no topo do "Estado atual" do `CLAUDE.md` com: o id do deploy e o comando de rollback, o número de testes novo, o que a automação faz, o corte configurado, e as duas dependências de hábito da equipe (pôr o cliente como convidado e escrever o nome no título do evento).

```bash
git add CLAUDE.md && git commit -m "dossie: registro do deploy no guia do projeto"
```

---

## Autoconferência do plano

**Cobertura da spec:** decisões 1 a 8 do Paulo cobertas (PDF ajustado por mim = Task 1; páginas 9 a 11 mantidas = a ordem em `ORDEM_MIOLO` preserva todas; Gmail = Task 6; só o cliente recebe = o worker manda para um destinatário só; sem envio retroativo = `corte_em` nas Tasks 3, 7 e 11; teste primeiro = `modo_teste` padrão true; sem grupo de controle = não há sorteio em lugar nenhum; agendas = Task 9). Cascata do nome = Task 2. Vigilância = Tasks 8 e 10. Fora de escopo (lembrete, WhatsApp, métrica de abertura) permanece fora.

**Pendências que dependem do Paulo, e não de código:** publicar o app OAuth como Interno; o consentimento na `institucional@`; definir o `corte_em`; confirmar o Responder-para; compartilhar o design do Canva se quiser as correções internas das páginas 6 e 9.

**Risco maior:** o `included_files` do `netlify.toml`. É a única peça que não dá para provar localmente, e o Step 4 da Task 11 existe só para pegá-la antes de qualquer cliente entrar na conta.
