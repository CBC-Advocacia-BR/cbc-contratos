# Supabase Edge Functions — CBC Contratos

Funções Edge rodando no **Supabase Edge Runtime** (Deno Deploy, global edge network).

Este diretório é um proof-of-concept (#137) — validar a função `health-check` antes de migrar
outros endpoints para fora da Netlify.

---

## Vantagens sobre Netlify Functions

| Dimensão | Netlify Functions | Supabase Edge |
|---|---|---|
| Runtime | Node.js 22.x | Deno + V8 |
| Localização | Região escolhida (us-east-1) | Global edge (multi-região) |
| Latência fria | 1-3 s (cold start) | <100 ms |
| Custo | 125k grátis, depois $$ | **500k grátis/mês** |
| Bandwidth | Conta no plano Netlify | Separado — não afeta o Netlify Pro |
| Limites | 10s execução, 1024MB RAM | 150s execução, 512MB RAM |

---

## Funções disponíveis

### `health-check`

Checa a saúde das 5 integrações externas (Asaas, ZapSign, ChatGuru, Apps Script, Supabase).

**URL (após deploy):**
```
https://vygczeepvoyaehfchxko.supabase.co/functions/v1/health-check
```

**Response:**
```json
{
  "status": "healthy",
  "services": [
    { "name": "asaas", "status": "ok", "latency": 120, "code": 200 }
  ],
  "timestamp": "2026-04-17T...",
  "runtime": "supabase-edge"
}
```

---

## Deploy — Passo a Passo

### 1. Instalar o Supabase CLI (uma vez só)

**Opção A — via Homebrew (macOS, recomendado):**
```bash
brew install supabase/tap/supabase
```

**Opção B — via npm:**
```bash
# ATENCAO: npm instalacao direta NAO e mais suportada oficialmente pelo Supabase.
# Usar apenas se Homebrew nao estiver disponivel.
npm install -g supabase
```

**Opção C — binário direto:**
Download em https://github.com/supabase/cli/releases

**Verificar instalação:**
```bash
supabase --version
# Deve mostrar algo como: 1.x.x
```

---

### 2. Fazer login no Supabase (uma vez só)

```bash
supabase login
```

Isso abre o navegador. Autorize o CLI com a conta vinculada ao projeto
`vygczeepvoyaehfchxko`. Gera um token que fica em `~/.supabase/access-token`.

> **Alternativa non-interactive:** `supabase login --token <PERSONAL_ACCESS_TOKEN>`.
> O PAT é gerado em https://supabase.com/dashboard/account/tokens.

---

### 3. Linkar o projeto remoto (uma vez só)

A partir da raiz do repositório `cbc-contratos/`:

```bash
cd supabase
supabase link --project-ref vygczeepvoyaehfchxko
```

Isso cria/atualiza `supabase/.temp/project-ref` e valida a conexão.

> Se pedir database password: obter em
> https://supabase.com/dashboard/project/vygczeepvoyaehfchxko/settings/database.

---

### 4. Deploy da função `health-check`

Ainda dentro de `cbc-contratos/supabase`:

```bash
supabase functions deploy health-check --no-verify-jwt
```

- **`--no-verify-jwt`** torna o endpoint **público** (sem precisar de Authorization
  header). Para health check faz sentido: é um endpoint de status, não expõe dados.

Saída esperada:
```
Deployed Function health-check to project vygczeepvoyaehfchxko
URL: https://vygczeepvoyaehfchxko.supabase.co/functions/v1/health-check
```

---

### 5. Testar

```bash
curl https://vygczeepvoyaehfchxko.supabase.co/functions/v1/health-check
```

Resposta esperada (200 ou 503 se algum serviço estiver degraded):
```json
{
  "status": "healthy",
  "services": [
    { "name": "asaas", "status": "ok", "latency": 120, "code": 200 },
    { "name": "zapsign", "status": "ok", "latency": 180, "code": 200 },
    { "name": "chatguru", "status": "ok", "latency": 90, "code": 200 },
    { "name": "apps_script", "status": "ok", "latency": 210, "code": 200 },
    { "name": "supabase", "status": "ok", "latency": 50, "code": 200 }
  ],
  "timestamp": "2026-04-17T20:00:00.000Z",
  "runtime": "supabase-edge"
}
```

---

### 6. Re-deploy após mudanças

```bash
cd cbc-contratos/supabase
supabase functions deploy health-check --no-verify-jwt
```

---

## Desenvolvimento local

```bash
# Dentro de cbc-contratos/supabase/
supabase functions serve health-check --no-verify-jwt

# Em outra aba:
curl http://localhost:54321/functions/v1/health-check
```

> Se não tiver Docker, use o modo puro Deno: `--no-docker`.

---

## Ver logs em produção

```bash
supabase functions logs health-check --tail
```

Ou via dashboard web:
- https://supabase.com/dashboard/project/vygczeepvoyaehfchxko/functions

---

## Migração do frontend (quando for a hora)

### Atualmente o frontend chama:
```js
// client/src/components/HealthSlos.jsx (ou onde for)
const resp = await fetch('/.netlify/functions/health');
```

### Para migrar, trocar por:
```js
const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const resp = await fetch(`${SUPABASE_URL}/functions/v1/health-check`);
```

> Não é necessário header `Authorization` se o deploy foi feito com `--no-verify-jwt`.

### Como encontrar os callers a migrar:
```bash
cd client/src
grep -rn "'/.netlify/functions/health'" .
grep -rn '"/.netlify/functions/health"' .
```

Arquivos prováveis:
- `src/components/HealthSlos.jsx`
- `src/components/MonitorPanel.jsx` (se polling de health)
- `src/App.jsx` (se indicator no header)

Procurar por strings `health` e substituir a URL.

### Após migração:
1. Fazer 1 deploy da frontend com o novo endpoint.
2. Monitorar logs por ~24h (`supabase functions logs health-check --tail`).
3. Se estável, considerar remover `client/netlify/functions/health.mjs`
   (atenção: deletar só depois de confirmar que não há mais calls).

---

## Troubleshooting

### "Function not found" após deploy
Rodar `supabase functions list` para confirmar criação. Se listada mas
retornando 404, aguardar 1-2 min para propagação do CDN global.

### "Unauthorized" no browser
Verificar se o deploy usou `--no-verify-jwt`. Se não, incluir header:
```
Authorization: Bearer <supabase anon key>
```

### "Docker daemon not running" ao rodar `serve`
Use `supabase functions serve --no-docker` (modo puro Deno sem Docker).

### Erro de CORS
A função já retorna `Access-Control-Allow-Origin: *`. Se ainda assim der erro,
provavelmente a requisição está sendo bloqueada antes de chegar à função —
verificar Network tab do DevTools.

### "Project ref not found" no `supabase link`
Rodar `supabase login` de novo. Tokens expiram após algumas semanas.

---

## Relação com as automações ChatGuru (#233)

Não são parte deste PoC, mas serão migradas em etapa futura. Por hora, os
crons `chatguru-trigger-evaluator` e `chatguru-queue-processor` continuam como
Netlify Functions (em `client/netlify/functions/`) por facilidade de configurar
schedules via `export const config = { schedule: ... }`.
