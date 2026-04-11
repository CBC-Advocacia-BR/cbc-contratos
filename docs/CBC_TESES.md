# CBC TESES

Sistema de gestão de modelos de petição e geração automatizada de DOCX/PDF
para o escritório **Conforto, Bergonsi & Cavalari Advogados**.

Este módulo convive com o sistema **CBC Contratos** dentro do mesmo repositório,
compartilhando o mesmo Vite/React e o mesmo servidor Node.

- `/` → CBC Contratos (sistema existente)
- `/teses` → CBC TESES (este módulo)

## Visão geral

Arquitetura:

- **Frontend**: React 19 + Vite + Tailwind 4, todo o código em `client/src/teses/`.
- **Banco / Auth / Storage / Realtime**: Supabase.
- **Backend proxy**: rotas `/api/teses/*` em `server/teses_routes.js` para
  comunicação com APIs externas que exigem credenciais (Advbox, DataJud)
  e conversão de DOCX→PDF via LibreOffice headless.
- **Geração DOCX**: `docx-js` rodando no browser (`client/src/teses/lib/docxGenerator.js`).
- **Roteamento interno**: hash-based (`#/models/:id`, `#/resorts/:id`, etc.),
  implementado sem dependências em `client/src/teses/router.js`.

## Setup

1. Instale as dependências atualizadas:

   ```bash
   cd client && npm install
   cd ../server && npm install
   ```

   O `client/package.json` passou a depender de `@supabase/supabase-js` e `docx`.

2. Copie `.env.example` → `.env` e preencha as variáveis:

   ```
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   ADVBOX_API_URL=https://app.advbox.com.br/api/v1
   ADVBOX_BEARER_TOKEN=...
   DATAJUD_API_URL=https://api-publica.datajud.cnj.jus.br
   DATAJUD_API_KEY=...
   ```

3. No **Supabase SQL Editor**, execute em ordem:
   - `supabase/migrations/001_cbc_teses_schema.sql`
   - `supabase/migrations/002_cbc_teses_seed.sql`

   As migrações criam 10 tabelas, índices, triggers de `updated_at`,
   funções auxiliares (`current_user_role`, `current_user_is`) e todas as
   policies de RLS para os 4 perfis de usuário.

4. Habilite o provider **Google** no Supabase Auth (opcional — a tela de
   login também aceita e-mail+senha).

5. Crie os buckets de Storage via Dashboard do Supabase:
   - `teses-models` (privado)
   - `teses-generated` (privado)
   - `teses-assets` (público, p/ timbrado)

6. Rode o dev server:

   ```bash
   npm run dev
   ```

   Abra `http://localhost:5173/teses`.

## Estrutura de código

```
client/src/teses/
├── TesesApp.jsx                 # Raiz do módulo (auth gate + roteador)
├── router.js                    # Roteador hash-based
├── contexts/
│   └── AuthContext.jsx          # Integração com supabase.auth + perfil
├── lib/
│   ├── supabaseClient.js        # Singleton + fallback stub
│   ├── advbox.js                # Cliente que bate no proxy do backend
│   ├── datajud.js               # Idem
│   ├── placeholders.js          # Extração e preenchimento de {{chaves}}
│   ├── docxGenerator.js         # Geração DOCX com docx-js
│   └── pdfGenerator.js          # DOCX→PDF via backend ou window.print
├── components/
│   ├── ui/Primitives.jsx        # Botão, Card, Input, Badge, Modal etc.
│   └── layout/Layout.jsx        # Sidebar + Header
└── pages/
    ├── Login.jsx
    ├── NoProfile.jsx
    ├── Dashboard.jsx
    ├── ModelsList.jsx
    ├── ModelEditor.jsx          # Blocos + placeholders + aprovação
    ├── ResortsList.jsx
    ├── ResortEditor.jsx         # Ficha completa + empresas do grupo
    ├── Generator.jsx            # Fluxo guiado 6 etapas
    ├── History.jsx
    ├── Notifications.jsx
    ├── Approvals.jsx
    ├── Themes.jsx
    ├── Users.jsx
    └── Settings.jsx
```

## Fluxo de dados da petição

1. **Gerador** (`Generator.jsx`) coleta nº do processo e chama
   `fetchProcessBundle()` → `GET /api/teses/advbox/lawsuits?process_number=...`
   → `GET /api/teses/advbox/movements/:id` → `GET /api/teses/advbox/customers/:id`.
2. Complementa com DataJud via `fetchDatajudProcess()`.
3. Sugere modelos aprovados cujos `trigger_keywords` aparecem nas movimentações.
4. Carrega blocos + placeholders do modelo escolhido.
5. `buildInitialValues()` pré-preenche placeholders com base no bundle e na
   ficha de resort selecionada.
6. O usuário desmarca blocos opcionais, reordena, ajusta valores, revisa a
   pré-visualização HTML e clica em "Gerar DOCX" ou "Gerar DOCX + PDF".
7. `generatePetitionDocx()` monta o DOCX com `docx-js`.
8. Se PDF for pedido, o DOCX é enviado a `POST /api/teses/docx-to-pdf`
   (LibreOffice headless). Se o backend não tiver LibreOffice instalado,
   cai no fallback `window.print()` com o HTML de pré-visualização.
9. Um registro é inserido em `generated_petitions` com todos os metadados,
   blocos selecionados, ordem usada e valores preenchidos.

## Perfis e permissões (RLS)

Implementado em `supabase/migrations/001_cbc_teses_schema.sql`:

- **admin**: tudo (inclusive gestão de usuários em `pages/Users.jsx`).
- **coordenador**: CRUD de modelos/resorts/temas, aprovação de modelos.
- **especialista**: CRUD dos próprios modelos (seus blocos e placeholders),
  submissão para aprovação.
- **operacional**: leitura de modelos aprovados + geração de petições
  (RLS restringe `generated_petitions` às próprias do usuário).

As funções `current_user_role()` e `current_user_is(roles[])` facilitam
as policies.

## Timbrado

O timbrado oficial ainda não foi entregue. O gerador de DOCX usa um
cabeçalho/rodapé placeholder em `client/src/teses/lib/docxGenerator.js`
(função `generatePetitionDocx`, blocos `Header` e `Footer`). Substitua
pelos assets corretos quando disponíveis — inclua-os em
`public/timbrado.png` e referencie via `ImageRun` do docx-js.

## Escalabilidade

- Todos os índices necessários estão nas migrações (theme_id, status,
  created_at, trigramas para busca por nome).
- Realtime já usado em `Layout.jsx` para notificações.
- Rate-limit dos proxies Advbox implementado em memória em
  `server/teses_routes.js` (30 GET/min e 500 POST/dia). Em produção
  com múltiplos workers, trocar por Redis.
- Supabase Pro recomendado para 20+ usuários simultâneos.

## Fase 7 — Polimento (implementado)

- **Editor rico** (`components/ui/RichEditor.jsx`): contenteditable com
  formatação (B/I/U, alinhamento, listas, limpar formatação) e
  **autocomplete de placeholders** ao digitar `{{` — sugere as chaves
  já definidas no modelo.
- **Drag-and-drop nativo** (`hooks/useDragList.js`): reordena blocos no
  `ModelEditor` (salvando `display_order` imediato) e na etapa 4 do
  `Generator`, sem depender de bibliotecas externas.
- **Importação de .docx via mammoth** (`lib/wordImporter.js` + botão no
  `ModelEditor`): parse do Word, segmentação por headings em blocos,
  sugestão automática de placeholders a partir de `[CAMPOS]` entre
  colchetes, upload opcional para o bucket `teses-models`.
- **Diff visual de versões** (`pages/VersionHistory.jsx` + `lib/versionDiff.js`):
  linha do tempo, seleção A/B e comparação por palavras com marcação
  verde (adicionado) / vermelho (removido) de metadados, blocos e
  placeholders. Rota `#/versions/:id`.
- **Cache offline** (`lib/offlineCache.js`): ao autenticar, sincroniza
  todos os modelos aprovados + blocos + placeholders + resorts no
  `localStorage`. O `Generator` usa `loadModelWithFallback` e um banner
  avisa o usuário quando o app detecta `navigator.onLine === false`.
  A página de configurações permite sincronizar manualmente e limpar.
- **Code-splitting**: `docxGenerator` e `mammoth` viraram dynamic imports,
  economizando ~840 KB do bundle inicial. Resultado atual:
  - chunk principal: ~906 KB (era 1.744 KB)
  - `docxGenerator`: 341 KB (lazy — só ao gerar petição)
  - `mammoth`: 495 KB (lazy — só ao importar Word)
- **Testes unitários (vitest + jsdom)**: 24 testes cobrindo
  `placeholders`, `versionDiff` e `wordImporter`. Rodar com `npm test`.

## Pontos de extensão futuros

- Integração com o módulo de cálculo para o placeholder
  `requires_calculation` (hoje é só um flag).
- Service Worker completo com `workbox` se for necessário cache de
  assets estáticos além dos dados (o localStorage já cobre os dados).
- Substituir o timbrado placeholder do `docxGenerator` pelo oficial.
