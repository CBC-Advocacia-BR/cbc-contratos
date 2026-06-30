# Rollback Playbook

Como reverter cada tipo de mudança em <5 minutos.

---

## 1. Frontend (deploy Netlify)

**Sintoma**: site quebrado, branca, erro de console em produção.

```bash
cd client
./rollback.sh
```

Sem argumento, usa `.last-working-deploy` (gravado pelo `deploy.sh` antes de cada deploy novo).

Para deploy específico:
```bash
./rollback.sh 6234abc...   # deploy_id da Netlify
```

Para listar deploys recentes e escolher:
```bash
./rollback.sh   # sem .last-working-deploy → mostra os 10 últimos
```

**Tempo**: ~30s para ativar; ~2 min para CDN propagar.

---

## 2. Função Netlify isolada

**Sintoma**: uma função específica retornando 5xx (ex: `asaas-sync` quebrado mas o resto do site OK).

Opção A — **rollback do deploy inteiro** (mesmo procedimento da seção 1).

Opção B — **fix forward**: editar a função, commitar, `./deploy.sh`. Mais rápido se for um typo.

Não há "rollback só da função"; deploy Netlify é atômico.

---

## 3. SQL Supabase

### 3a. Mudança era idempotente e tem `DOWN` script

Toda migration nova vem com `-- DOWN` no fim do mesmo arquivo. Rodar **apenas o bloco DOWN** no Supabase SQL Editor.

Exemplo:
```sql
-- UP
CREATE INDEX IF NOT EXISTS idx_x ON contratos(...);

-- DOWN
DROP INDEX IF EXISTS idx_x;
```

### 3b. Mudança apagou ou alterou dados

Restaurar do backup feito **antes** da migration:

1. Localizar o dump em `backups/YYYYMMDD_HHMMSS_pre_migration_X/<tabela>_dump.sql`
2. No Supabase SQL Editor:
   ```sql
   BEGIN;
   -- Para cada tabela afetada:
   DELETE FROM <tabela> WHERE <linhas-novas-criadas-pela-migration>;
   -- Reinserir do dump (cole o conteúdo do arquivo .sql aqui)
   COMMIT;
   ```
3. Validar com `SELECT COUNT(*)` que voltou ao número original.

### 3c. Caso catastrófico (drop table, truncate)

- Supabase free tier: backup diário automático (últimos 7 dias). Abrir ticket no suporte.
- Supabase com PITR (pago): point-in-time restore via painel.

**Por isso toda migration deve ser idempotente e nunca DROP/TRUNCATE sem backup verificado.**

---

## 4. Variável de ambiente Netlify

**Sintoma**: env var nova quebrou função.

1. Painel Netlify → Site Settings → Environment Variables
2. Editar a variável → restaurar valor anterior (anotado no batch antes da mudança)
3. **Trigger redeploy** (Site Overview → Deploys → "Trigger deploy" → "Clear cache and deploy site")

**Tempo**: ~3 min.

---

## 5. Mudança em `_headers`, `netlify.toml`, `vite.config.js`

Esses arquivos são deploy-time. Rollback = redeployar versão anterior:

```bash
cd client
git log --oneline -- public/_headers   # achar commit anterior
git show <hash>:client/public/_headers > public/_headers   # restaurar
./deploy.sh
```

Ou rollback completo do deploy (seção 1).

---

## 6. Mudança no `server/` (backend Node)

Atualmente o `server/` não está em produção ativa (validar com Paulo). Se estiver:

```bash
cd server
git log --oneline
git revert <hash>   # cria commit reverso
# Restart do processo (depende de onde está hospedado — Render? PM2?)
```

---

## Checklist universal pós-rollback

Após qualquer rollback:

1. Rodar `docs/SMOKE_CHECKLIST.md` completo
2. Avisar usuários ativos no WhatsApp se afetou >5 min
3. Anotar incidente em `docs/INCIDENTS.md` (criar se não existir):
   - Data/hora
   - O que mudou
   - O que quebrou
   - Como detectou
   - Tempo até rollback
   - Causa raiz
   - Como evitar próxima vez

---

## Tempos-alvo

| Tipo | Detectar | Rollback | Validar |
|---|---|---|---|
| Frontend deploy | <5 min (smoke) | <2 min | <2 min |
| Função Netlify | <10 min (Sentry) | <2 min | <2 min |
| SQL idempotente | <30 min | <5 min | <5 min |
| SQL destrutivo | imediato | varia | varia |
| Env var | <5 min | <3 min | <3 min |

Total alvo: **detectar + rollback + validar < 15 min** para mudanças frontend.
