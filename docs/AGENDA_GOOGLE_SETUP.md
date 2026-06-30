# Configuração do Google — leitura das agendas (OAuth, sem chave de conta de serviço)

> A política da organização bloqueia chaves de conta de serviço (`iam.disableServiceAccountKeyCreation`).
> Por isso usamos **OAuth** (mais seguro, sem chave). Resultado: o app lê as agendas **somente leitura**.
> Tudo feito **uma vez**. Ver o desenho em `VIDEOCHAMADAS_FUNIL_SPEC.md`.

## ⚠️ Passo 0 — estar na conta certa
No canto superior direito do navegador, troque para a conta **`paulo@advocaciacbc.com`**
(a conta do **Workspace**). NÃO use o Gmail pessoal — a integração tem que viver na conta do
escritório.

---

## Parte 1 — Projeto + ativar a API (console.cloud.google.com)

1. Abra **https://console.cloud.google.com** (logado em `paulo@advocaciacbc.com`).
2. No topo, **Selecione um projeto → Novo projeto** → nome **"CBC Agenda Funil"** → Criar.
   (Se já criou antes nessa conta, só selecione.)
3. Menu **APIs e serviços → Biblioteca** → busque **"Google Calendar API"** → **Ativar**.

## Parte 2 — Tela de permissão OAuth (UI nova "Google Auth Platform")

> O Google trocou essa tela. Agora é **"Google Auth Platform"**, com um menu à esquerda
> (Visão geral, Branding, Público-alvo, Clientes, **Acesso a dados**, …). Os itens ficam assim:

1. **Público-alvo** (menu esquerdo): tipo de usuário **Interno** (Internal). *(Interno = só contas @advocaciacbc.com, sem verificação do Google.)*
2. **Branding** (menu esquerdo): Nome do app **"CBC Agenda Funil"** + e-mail de suporte/desenvolvedor.
3. **Acesso a dados** (menu esquerdo) → botão **"Adicionar ou remover escopos"** → no filtro, cole:
   ```
   https://www.googleapis.com/auth/calendar.events.readonly
   ```
   marque ele → **Atualizar** → **Salvar**.

## Parte 3 — Criar a credencial OAuth

1. **Clientes** (menu esquerdo) → **Criar cliente** (ou o botão **"Criar um cliente OAuth"** da Visão geral).
2. Tipo de aplicativo: **Aplicativo da Web**.
3. Nome: **"CBC Agenda Funil Web"**.
4. Em **URIs de redirecionamento autorizados → Adicionar URI**, cole **exatamente**:
   ```
   https://developers.google.com/oauthplayground
   ```
5. **Criar.** Vai aparecer uma janela com **ID do cliente** e **Chave secreta do cliente** —
   **copie os dois** (guarde; vou precisar deles).

## Parte 4 — Pegar o "refresh token" (no OAuth Playground, sem código)

1. Abra **https://developers.google.com/oauthplayground** (na mesma conta `paulo@advocaciacbc.com`).
2. Clique na **engrenagem ⚙️** (canto superior direito) → marque **"Use your own OAuth credentials"**
   → cole o **Client ID** e o **Client secret** do passo 3.5. *(Deixe "Access type: Offline".)*
3. Na caixa **"Input your own scopes"** (lado esquerdo, em baixo da lista), cole:
   ```
   https://www.googleapis.com/auth/calendar.events.readonly
   ```
   → clique **Authorize APIs**.
4. Faça login/consinta com **`paulo@advocaciacbc.com`** → **Permitir**.
5. De volta ao Playground, clique **"Exchange authorization code for tokens"**.
6. Aparece o **Refresh token** (começa com `1//...`). **Copie** — é a credencial final.

## Parte 5 — Acesso às agendas das vendedoras
O token acima lê as agendas que a conta `paulo@advocaciacbc.com` **consegue ver**. Escolha **uma**:

- **(a) Recomendado — 1 toque no admin, cobre todas (inclusive futuras):**
  **admin.google.com → Apps → Google Workspace → Google Agenda → Opções de compartilhamento**
  → em compartilhamento **interno**, deixar **"Ver todos os detalhes do evento"**. Aí qualquer
  conta interna (a `paulo@`) lê os detalhes de qualquer agenda do escritório via API.
- **(b) Sem mexer no admin:** cada vendedora abre a agenda dela → **Configurações → Compartilhar
  com pessoas específicas** → adiciona **`paulo@advocaciacbc.com`** com **"Ver todos os detalhes
  do evento"** (uma vez por vendedora).

## Parte 6 — Me enviar (canal seguro, não em chat público)
1. **Client ID** (passo 3.5)
2. **Client secret** (passo 3.5)
3. **Refresh token** (passo 4.6)
4. **Lista dos e-mails @advocaciacbc.com das vendedoras** cujas agendas devo ler

> Com isso eu configuro no servidor (Netlify) e construo o robô. **Só leitura** — não cria, edita
> nem apaga nada. Pra revogar depois: myaccount.google.com → Segurança → apps com acesso → remover.
