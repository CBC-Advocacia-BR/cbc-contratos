# Módulo CHAT — Portal do Cliente ↔ CBC Conversas (2026-07-01)

O cliente conversa com o escritório pela aba **Conversas** do Portal do Cliente
(este projeto). A equipe responde pelo **CBC Conversas** (projeto
`chatguru-export`, botão de balão na topbar). Substitui gradualmente o WhatsApp
(decisão: manter WhatsApp em paralelo até a migração começar).

## Arquitetura

```
Cliente (portal.html, aba Conversas)          Equipe (CBC Conversas, painel Conversas)
   │  token do portal (?t=...)                     │  cookie de sessão (login Google)
   ▼                                               ▼
/.netlify/functions/portal-chat.mjs          /api/chat  (viewer/netlify/functions/chat.mjs)
   │  service key (só servidor)                    │  service key (só servidor)
   └───────────────► Supabase ◄───────────────────┘
              RPCs public.chat_*  (EXECUTE só p/ service_role)
              Tabelas chat.threads / chat.mensagens  (RLS deny-all)
```

- **SQL canônico**: [`supabase/migration-chat-portal.sql`](supabase/migration-chat-portal.sql)
  (aplicado em 2026-07-01 como `chat_portal_cliente_v1`).
- **Segurança**: diferente do padrão `bot_allow_all` das tabelas do portal, as
  tabelas do chat têm **RLS deny-all** e as RPCs só executam com service_role.
  A chave anon (pública no bundle) **não** lê nem escreve mensagem nenhuma.
  Cliente = token de `cliente_portal_tokens` validado dentro da RPC.
  Equipe = cookie de sessão Google (@advocaciacbc.com) validado na função.
- **1 thread por cliente**, chaveada por CPF (dígitos) — sobrevive à rotação de
  token e casa com `bi_clientes`/`contratos`/ecossistema.
- **Nome do colaborador**: cada resposta grava `autor_email` + `autor_nome`
  (derivado do e-mail; ex.: `maria.silva@` → "Maria Silva") e o portal exibe o
  nome **em negrito** no balão. Auditoria em `atendimento.acessos_log`
  (ops `chat_enviar`, `chat_status`, `chat_abrir_cpf`).

## MVP (o que está ligado)

- Só **texto** (até 4.000 caracteres por mensagem).
- **Polling** (sem tempo-real ainda): portal consulta a cada 20 s com a aba
  aberta; CBC Conversas: badge/lista 30 s, conversa aberta 8 s.
- **Integrado à interface principal do CBC Conversas** (2026-07-02, pedido do
  Paulo): seção "Conversas ativas · Portal do Cliente" no TOPO da lista
  lateral; a conversa abre na MESMA área do arquivo (mesmas bolhas), com caixa
  de resposta embaixo e botão ✓ (resolver) no cabeçalho. Deep link
  `#/live/<thread_id>`. O painel modal anterior foi removido.
- Badges de não-lidas dos dois lados; "marcar como resolvida" no lado equipe.
- Iniciar conversa por CPF (lado equipe): via API (`op abrirPorCpf` em
  /api/chat) — sem botão na UI por enquanto.

## Deploy — FEITO em 2026-07-02 (produção)

- CBC Conversas: deploy prod OK (`/api/chat` no ar, gate 401 sem sessão).
- contratos-cbc: deploy `6a4620c5…` promovido; teste ponta-a-ponta do
  portal-chat passou em produção (enviar/listar/badge com token de teste,
  removido em seguida). Env criadas no site: `PORTAL_LINK_KEY` (cópia em
  `~/.cbc-portal-link-key`) e `SUPABASE_SERVICE_ROLE_KEY` (o site NÃO tinha —
  as funções antigas rodam na anon key + policies allow-all; as do chat exigem
  a service key de propósito).
- ⚠️ Incidente durante o deploy: a produção estava quebrada (502 em TODAS as
  funções) desde 2026-07-02 00:09 UTC por artefatos com prelúdio duplicado da
  Netlify (ver `client/netlify/functions/LEIA-ME-ARTEFATOS.md`). Corrigido
  (prelúdio removido dos 57 arquivos) e produção restaurada.
- ⚠️ `config.path` começando com `/.netlify/functions/` faz a Netlify
  DESCARTAR a função silenciosamente — usar a rota padrão por nome de arquivo.

## Deploy (referência)

1. **Este projeto (portal + funções)** — site Netlify `contratos-cbc`:
   - ⚠️ **CORRIGIDO 02/07**: o canônico do portal é **`client/portal.html`
     (raiz do client/)** — é ENTRY do Vite (`vite.config.js → rollupOptions.input.portal`).
     A nota anterior dizendo que `public/portal.html` era o canônico valia só
     para o vite.config de março (repo estava no main antigo em 01/07); no
     código de produção um `public/portal.html` é IGNORADO pelo build do entry.
     A versão com chat foi movida para a raiz e commitada em 02/07.
     `portal-sw.js`, `logo-navy.png` e `favicon.png` seguem em `public/` (cópia estática).
   - Funções novas: `portal-chat.mjs` (chat do cliente) e
     `kommo-portal-link.mjs` (webhook do Salesbot). Sem dependências novas.
   - Env necessária (Netlify → Site settings → Environment):
     `SUPABASE_SERVICE_ROLE_KEY` (já existe) e **`PORTAL_LINK_KEY`** (nova —
     string longa aleatória; protege o webhook do Kommo).
2. **CBC Conversas** — projeto `chatguru-export`:
   - `cd viewer && ./deploy.sh prod` (função nova `chat.mjs` + UI). Nada de
     env nova (usa o `_secrets.json` existente).
3. **Banco**: já aplicado (migração `chat_portal_cliente_v1`). Reconstrução do
   zero = rodar `supabase/migration-chat-portal.sql`.

## Bot do Kommo — disparo do link após assinatura

Endpoint pronto: `POST https://contratos-cbc.netlify.app/.netlify/functions/kommo-portal-link?k=<PORTAL_LINK_KEY>`
com corpo JSON (ou form) `{ "cpf": "...", "nome": "..." }`.

Resposta: `{ ok, link, primeiro_nome, instrucoes }` — `instrucoes` já é a
mensagem pronta com o link e o passo-a-passo de instalar o PWA.

Configuração no Kommo (feita na interface do Kommo, uma vez):
1. Salesbot novo, gatilho: lead entra no estágio **"Contrato assinado"**
   (ou o gatilho de webhook do ZapSign que move o lead).
2. Passo **"Fazer requisição" (webhook)**: POST para a URL acima, enviando o
   campo personalizado de CPF do lead.
3. Passo **"Enviar mensagem"** ao cliente usando `{{json.instrucoes}}` da
   resposta (ou montar texto próprio com `{{json.link}}`).
4. Se a resposta vier `ok:false` com `cliente_nao_encontrado`, criar tarefa
   para a equipe gerar o link manualmente (aba Portal do Cliente do admin).

Regra aplicada: reusa token ativo se existir; só cria novo se o cliente ainda
não tem. Cliente precisa existir no espelho do Advbox (`bi_clientes`).

## Escala (40 mil clientes)

- Postgres com índices por thread aguenta esse volume com folga; o custo real é
  o polling. Conta de padeiro: o que importa são clientes **com o portal aberto
  ao mesmo tempo** (não o total). 500 abas abertas simultâneas × 1 req/20 s =
  ~25 req/s — dentro do que Netlify Functions + Supabase seguram tranquilo.
- Quando a escala incomodar (ou quiserem resposta instantânea), ativar o
  Realtime (abaixo) e subir o intervalo do polling para fallback.

## Ativação futura — REGISTRADO PARA NÃO ESQUECER

### Tempo real (Supabase Realtime) — flag `CHAT_REALTIME=false` hoje
Onde: `client/public/portal.html` (const `CHAT_REALTIME`) e
`viewer/public/app.js` (const `CHAT_REALTIME`).
Passos quando for ativar:
1. `alter publication supabase_realtime add table chat.mensagens;`
2. Decidir o modelo de entrega: (a) **broadcast via servidor** (função envia
   evento após gravar — não expõe tabela) ou (b) cliente assina
   `postgres_changes` — exige policy de SELECT por cliente e repensar a auth do
   portal (hoje é token opaco, não Supabase Auth). Recomendado: (a).
3. Trocar o polling por assinatura nos dois frontends e manter o polling como
   fallback (30–60 s).

### Push no celular do cliente quando o escritório responde
A infraestrutura JÁ existe no portal (`portal_push_subs` + VAPID + web-push,
função `portal-push.mjs`; o cliente ativa os avisos na aba Meu Caso).
Falta só: após `chat_equipe_enviar`, disparar o push. Caminho sugerido:
função nova `portal-chat-notify.mjs` neste projeto (reusa o `sendPush` do
`portal-push.mjs`), chamada pelo `chat.mjs` do viewer com uma chave
compartilhada. Não implementado no MVP (decisão de 2026-07-01: escrever sem
ativar ficou restrito ao realtime; push nem escrito para não criar caminho
morto — abrir tarefa quando for a hora).

### Mídia (fotos/documentos) SEM encher o Supabase — via Google Drive
Decisão: mídia NÃO vai para Supabase Storage; vai para o **Google Drive** em
pasta por cliente. Viável e já meio pronto: `save-to-drive.mjs` já sobe PDFs de
contrato para o Drive (service account). Desenho futuro:
1. Cliente anexa → `portal-chat.mjs` recebe (multipart) → sobe ao Drive na
   pasta do cliente (por CPF) → grava na mensagem só `drive_file_id` + nome +
   tamanho (colunas novas em `chat.mensagens`).
2. Download: função gera link temporário (ou proxy stream) validando o token —
   o arquivo nunca fica público.
3. Supabase guarda só metadados (bytes ficam no Drive; custo ~zero).

## Limites conhecidos do MVP

- Sem indicador "digitando", sem recibo de leitura por mensagem (só contadores).
- `prompt()` simples para iniciar conversa por CPF no CBC Conversas.
- Permissões: qualquer conta @advocaciacbc.com responde; papéis mais finos
  (carteiras por atendente) ficam para a fase 3.
- O aviso de resposta ao cliente depende de ele abrir o portal (até o push do
  chat ser ligado). O Salesbot do Kommo pode avisar por WhatsApp durante o
  período híbrido.
