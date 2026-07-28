# Auth do Meet + Agenda via Service Account (fim da fragilidade de 7 dias)

**Goal:** trocar o refresh token de usuário (app OAuth "Testing" → expira ~7 dias, derruba Meet + agenda) por uma **service account com delegação em todo o domínio (DWD)** — que gera access token sem token de usuário revogável. Nunca mais expira/quebra.

**Por que:** o token atual (`GOOGLE_OAUTH_REFRESH_TOKEN`, compartilhado por Meet e agenda) morre periodicamente (invalid_grant) porque o app OAuth está em modo Testing/não-verificado com escopo sensível `admin.reports`. Além disso, trocar o valor exige redeploy (var marcada "secret"). A SA elimina os dois problemas.

## Arquitetura
- A SA assina um **JWT (RS256)** com sua chave privada e troca por um access token, **impersonando** um usuário do domínio (DWD).
- **Meet (auditoria):** impersona um **admin** (`paulo@advocaciacbc.com`), escopo `admin.reports.audit.readonly`.
- **Agenda:** impersona **cada vendedora** (lê a própria agenda dela), escopo `calendar.readonly`.
- Novo módulo `_lib/googleServiceAuth.mjs` com `getSaAccessToken(subject, scope)`; substitui o `getAccessToken` (refresh token) nos dois fluxos.
- Envs novas: `GOOGLE_SA_KEY` (JSON da chave, secret) + `GOOGLE_SA_ADMIN_SUBJECT` (`paulo@advocaciacbc.com`). O `GOOGLE_OAUTH_REFRESH_TOKEN` vira **fallback** até validar, depois pode sair.

---

## PARTE A — VOCÊ (Google Cloud + Admin console) · ~10 min

- [ ] **1. Criar a service account.** Google Cloud Console → um projeto **que você administra** (pode criar um novo, ex. "cbc-integracoes") → *IAM e administrador → Contas de serviço → Criar*. Nome: `cbc-google-audit`. Anote o **e-mail** dela (`…@….iam.gserviceaccount.com`).
- [ ] **2. Gerar a chave JSON.** Na SA → aba *Chaves → Adicionar chave → Criar nova chave → JSON* → baixa o arquivo. **É a credencial; guarde bem** (não cole no chat).
- [ ] **3. Ativar a delegação.** Na SA (ou nos detalhes) → habilitar **"Delegação em todo o domínio do Google Workspace"**. Anote o **"Client ID" (numérico)** da SA.
- [ ] **4. Habilitar as APIs no projeto:** *APIs e serviços → Biblioteca* → ativar **Admin SDK API** e **Google Calendar API**.
- [ ] **5. Autorizar a delegação no Workspace.** admin.google.com → *Segurança → Controles de API → Delegação em todo o domínio* → **Adicionar** → cole o **Client ID (numérico)** da SA e, em escopos, cole (separados por vírgula):
      `https://www.googleapis.com/auth/admin.reports.audit.readonly,https://www.googleapis.com/auth/calendar.readonly`
      → **Autorizar**.
- [ ] **6. Netlify env** (site contratos-cbc → Environment variables):
      - `GOOGLE_SA_KEY` = **conteúdo inteiro do JSON** da chave (marque *Contains secret values*).
      - `GOOGLE_SA_ADMIN_SUBJECT` = `paulo@advocaciacbc.com`.
      - (Deixe o `GOOGLE_OAUTH_REFRESH_TOKEN` como está por enquanto — fallback.)
- [ ] **7. Me avise "SA pronta"** com o **e-mail da SA** e o **Client ID** (esses não são segredo; o **JSON não**, esse fica só no Netlify).

---

## PARTE B — EU (código, depois do seu "SA pronta") · com deploy no seu OK

### Task B1: `_lib/googleServiceAuth.mjs` (TDD)
- Create: `client/netlify/functions/_lib/googleServiceAuth.mjs`
- Test: `client/src/utils/__tests__/googleServiceAuth.test.js`
- `getSaAccessToken(subject, scope)`: monta JWT `{iss: sa_email, sub: subject, scope, aud: token_uri, iat, exp}`, assina RS256 com a `private_key` do `GOOGLE_SA_KEY`, POST `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` no token endpoint, retorna access_token. Cache em memória por subject+scope (~50 min).
- Testável: construção do claim/JWT (header/payload base64url, campos) com uma chave de teste; o fetch é mockável.

### Task B2: Meet passa a usar a SA
- Modify: `_lib/meetAudit.mjs` — `getAccessToken` passa a `getSaAccessToken(process.env.GOOGLE_SA_ADMIN_SUBJECT, 'https://www.googleapis.com/auth/admin.reports.audit.readonly')`. Fallback: se `GOOGLE_SA_KEY` ausente, usa o refresh token antigo.

### Task B3: Agenda passa a usar a SA (impersona cada vendedora)
- Modify: `_lib/googleAgenda.mjs` — `listEvents(calendarId, …)` obtém o token via `getSaAccessToken(calendarId /* = a vendedora */, 'https://www.googleapis.com/auth/calendar.readonly')` e lê a agenda dela. O sync passa a pegar 1 token por vendedora (impersonando cada uma). Fallback: refresh token antigo se `GOOGLE_SA_KEY` ausente.

### Task B4: deploy + validação
- `./deploy.sh` (com seu OK) → rodar `meet-auditoria-sync` e `agenda-videochamadas-sync` → confirmar `ok:true`. Depois de validado, o `GOOGLE_OAUTH_REFRESH_TOKEN` pode ser removido.

## Notas / rollback
- Manter o caminho do refresh token como **fallback** enquanto valida (código escolhe SA se `GOOGLE_SA_KEY` existir, senão refresh token). Zero downtime.
- A SA nunca precisa de redeploy ao rotacionar (não rotaciona); e o JSON key só troca se você regenerar.
- Se a agenda hoje lê todas as vendedoras com 1 token (calendários compartilhados), com a SA cada vendedora é impersonada individualmente — mais correto e robusto.
