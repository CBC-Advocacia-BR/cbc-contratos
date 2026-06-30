# Otimização Supabase — 30/04/2026

Sessão de otimização do projeto Supabase `vygczeepvoyaehfchxko`.

**Estado inicial**: DB 414 MB, 161 tabelas, 459 índices.
**Causa raiz**: 2 setIntervals de 30s no front + trigger de audit gravando OLD/NEW completos a cada UPDATE → ~30k–80k UPDATEs/dia em 14 contratos, gerando ~165 MB/dia de lixo em `contratos_audit`.

---

## Backups gerados

| Backup | Local |
|---|---|
| `App.jsx` + `ContratosTab.jsx` | `projetos/cbc-contratos/backups/plano_A_20260430_063307/` |
| Cópia fallback front | `/tmp/App.jsx.bak_20260430_063307`, `/tmp/ContratosTab.jsx.bak_20260430_063307` |
| Snapshot DDL das policies RLS | `public._rls_optim_backup_20260430` (tabela no banco) |
| Definição da função `audit_contratos_trigger` original | inline neste doc (Item 1) |

---

## Item 3 — Front: removido poll duplicado + diff guard + intervalo 30s→2min

**Arquivos**: `client/src/App.jsx`, `client/src/components/ContratosTab.jsx`
**Deploy**: produção em `https://contratos-cbc.netlify.app` (deploy id 69f322a24dc1becfdde6f71f às 06:33 BRT 30/04/2026).

### Mudanças
1. `App.jsx:500-509` — adicionado guard `JSON.stringify(prev) === JSON.stringify(next)` antes do `UPDATE contratos SET zapsign_links`.
2. `App.jsx:696` — `setInterval(runAutomations, 30000)` → `setInterval(runAutomations, 120000)` (2 min).
3. `ContratosTab.jsx:818-822` — guard idêntico antes do UPDATE.
4. `ContratosTab.jsx:863-870` — **removido** o segundo `setInterval` de 30s; mantido apenas `syncZapSign()` no mount.

### Rollback
```bash
cp "projetos/cbc-contratos/backups/plano_A_20260430_063307/App.jsx" \
   "projetos/cbc-contratos/client/src/App.jsx"
cp "projetos/cbc-contratos/backups/plano_A_20260430_063307/ContratosTab.jsx" \
   "projetos/cbc-contratos/client/src/components/ContratosTab.jsx"
cd projetos/cbc-contratos/client && ./deploy.sh
```
Ou rollback Netlify: `cd client && ./rollback.sh 69f15f9db593ed2fa12e5ace`

---

## Item 1 — Trigger `audit_contratos_trigger` ignora UPDATEs onde só `updated_at` mudou

**Função alterada**: `public.audit_contratos_trigger()`

### Versão original (rollback)
```sql
CREATE OR REPLACE FUNCTION public.audit_contratos_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_email text;
  v_changed_fields text[];
BEGIN
  v_user_email := audit_get_user_email();

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO contratos_audit(contrato_id, action, user_email, after_data)
    VALUES (NEW.id, 'insert', v_user_email, to_jsonb(NEW));
    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.arquivado_em IS NULL AND NEW.arquivado_em IS NOT NULL THEN
      INSERT INTO contratos_audit(contrato_id, action, user_email, before_data, after_data)
      VALUES (NEW.id, 'archive', v_user_email, to_jsonb(OLD), to_jsonb(NEW));
    ELSIF OLD.arquivado_em IS NOT NULL AND NEW.arquivado_em IS NULL THEN
      INSERT INTO contratos_audit(contrato_id, action, user_email, before_data, after_data)
      VALUES (NEW.id, 'unarchive', v_user_email, to_jsonb(OLD), to_jsonb(NEW));
    ELSE
      IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
        SELECT array_agg(key) INTO v_changed_fields
        FROM jsonb_each(to_jsonb(NEW)) n
        WHERE n.value IS DISTINCT FROM (to_jsonb(OLD)->n.key);

        INSERT INTO contratos_audit(contrato_id, action, user_email, before_data, after_data, changed_fields)
        VALUES (NEW.id, 'update', v_user_email, to_jsonb(OLD), to_jsonb(NEW), v_changed_fields);
      END IF;
    END IF;
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO contratos_audit(contrato_id, action, user_email, before_data)
    VALUES (OLD.id, 'delete', v_user_email, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;
```

### Versão nova
Mesma função mas com bloco extra que calcula `v_significant_fields` (sem `updated_at`) e só insere se houve mudança real além de `updated_at`. `changed_fields` continua incluindo `updated_at` (para compatibilidade com queries existentes).

---

## Item 2A — DELETE de updates fantasmas + VACUUM FULL

```sql
DELETE FROM public.contratos_audit
WHERE action='update' AND changed_fields = ARRAY['updated_at'];
-- 61.116 linhas removidas
VACUUM FULL public.contratos_audit;
```

**Resultado**: contratos_audit caiu de 573 MB → 234 MB. DB total: 414 → 297 MB.

### Rollback
Não há — dados eram audits "fantasmas" (UPDATEs sem mudança real). Se necessário recuperar: backup automático Supabase (Point-in-Time Restore disponível via dashboard).

---

## Item 2B — DELETE de pseudo-zapsign (executado depois)

```sql
DELETE FROM public.contratos_audit
WHERE action='update'
  AND changed_fields @> ARRAY['updated_at','zapsign_links']
  AND array_length(changed_fields,1) = 2
  AND changed_at < NOW() - INTERVAL '1 hour';
VACUUM FULL public.contratos_audit;
```

**Justificativa**: ~41.540 linhas onde só `updated_at` + `zapsign_links` "mudaram" — mesmo padrão dos updates fantasmas, só que o JSONB do zapsign_links variou em ordem de campos. Sem valor histórico real.

### Rollback
Não há. Backup PITR Supabase é a opção.

---

## Item 4 — Cron retention `cron.job_run_details`

```sql
SELECT cron.schedule(
  'cron-job-details-cleanup',
  '15 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '7 days'$$
);
-- jobid: 10
```
Plus DELETE imediato dos registros >7 dias.

### Rollback
```sql
SELECT cron.unschedule('cron-job-details-cleanup');
```

---

## Item 6 — 33 RLS policies otimizadas (`auth.uid()` → `(SELECT auth.uid())`)

Reduz CPU em queries grandes — Postgres avalia a função uma vez por query em vez de uma por linha.

**Snapshot completo do DDL antigo**: `public._rls_optim_backup_20260430` (33 linhas, schema: `schemaname, tablename, policyname, permissive, roles_text, cmd, qual, with_check, backed_up_at`).

### Rollback
Cada policy pode ser restaurada via:
```sql
-- Exemplo: restaurar policy 'teses_favorites_read'
SELECT * FROM public._rls_optim_backup_20260430
WHERE schemaname='public' AND tablename='teses_favorites' AND policyname='teses_favorites_read';
-- Pegar qual e with_check, então:
DROP POLICY teses_favorites_read ON public.teses_favorites;
CREATE POLICY teses_favorites_read ON public.teses_favorites
  AS PERMISSIVE FOR SELECT TO <roles>
  USING (<qual original>);
```

Para restaurar TODAS de uma vez:
```sql
-- Script abaixo restaura tudo do backup (executar em DO $$)
-- Disponível em "rollback completo do item 6" no fim deste doc
```

---

## Fase A — Pseudo-zapsign limpo (executado)

DELETE + VACUUM FULL conforme item 2B acima. **DB 297 MB → 65 MB**.
contratos_audit: 234 MB → 1.1 MB (155 linhas restantes — só audits "reais").

---

## Fase B — Índices unused — DECISÃO: NÃO REMOVER

~150 índices `idx_*` com `idx_scan=0`, mas todos em tabelas com volume baixo ou em desenvolvimento (`cbc_*`, `teses_*`, `calc_*`). pg_stat_user_indexes foi possivelmente resetado recentemente. Custo total ~2 MB. Risco de remoção (penalidade futura quando tabelas crescerem) maior que benefício imediato. **Não atende ao critério "sem atrapalhar"**, então não foi aplicado.

### Rollback
N/A — nada foi alterado.

---

## Fase C — 49 índices em FKs sem cobertura

Criados via `DO $$` iterando `pg_constraint` (contype='f') e gerando `CREATE INDEX IF NOT EXISTS` com nome `idx_fk_<conname>` (truncado a 60 chars).

### Rollback
```sql
-- Lista todos os índices criados nesta fase
SELECT 'DROP INDEX IF EXISTS ' || schemaname || '.' || indexname || ';' AS rollback_cmd
FROM pg_indexes
WHERE indexname LIKE 'idx_fk_%'
  AND schemaname IN ('public','produtividade');
-- Execute o output para reverter
```

---

## Fase D — ANALYZE global

```sql
ANALYZE;
```
Atualiza estatísticas do query planner para todas as tabelas. Sem rollback (operação de leitura).

---

## Fase E — Hardening de segurança (5 ERRORs do advisor → 0)

### E1 — RLS habilitado em 3 tabelas + DROP da tabela de backup

```sql
-- Tabela de backup das policies do item 6 (conteúdo salvo em backups/rls_optim_backup_20260430.json)
DROP TABLE IF EXISTS public._rls_optim_backup_20260430;

ALTER TABLE public.asaas_boletos ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_all_asaas_boletos ON public.asaas_boletos
  AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.asaas_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_all_asaas_sync_state ON public.asaas_sync_state
  AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_read_audit_log ON public.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
-- audit_log: writes só via service_role (bypass automático)
```

**Smoke test executado**: anon retorna array vazio nas 3 tabelas (RLS funcionando). authenticated mantém compat (USING true).

### Rollback E1
```sql
DROP POLICY auth_all_asaas_boletos ON public.asaas_boletos;
ALTER TABLE public.asaas_boletos DISABLE ROW LEVEL SECURITY;

DROP POLICY auth_all_asaas_sync_state ON public.asaas_sync_state;
ALTER TABLE public.asaas_sync_state DISABLE ROW LEVEL SECURITY;

DROP POLICY auth_read_audit_log ON public.audit_log;
ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;
```
A tabela `_rls_optim_backup_20260430` não pode ser revertida diretamente, mas o conteúdo está em `backups/rls_optim_backup_20260430.json`.

### E2 — View `contratos_ativos` agora respeita RLS

```sql
ALTER VIEW public.contratos_ativos SET (security_invoker = true);
```
Antes: bypassava RLS de `contratos`. Depois: respeita RLS de quem consulta.

### Rollback E2
```sql
ALTER VIEW public.contratos_ativos SET (security_invoker = false);
```

### E3 — `search_path` fixado em 18 funções

Funções afetadas: `calc_update_timestamp`, `aud_update_timestamp`, `cbc_set_updated_at`, `handle_new_user_permissions`, `audit_get_user_email`, `audit_is_admin`, `aud_hearings_audit_trigger`, `update_updated_at_column`, `update_updated_at`, `calculos_tsv_update`, `acordos_tsv_update`, `vendas_touch_updated_at`, `crm_touch_updated_at`, `notify_scan_complete`, `block_non_admin_delete_contratos`, `arquivar_contrato`, `desarquivar_contrato`, `audit_contratos_trigger`.

Aplicado `ALTER FUNCTION ... SET search_path = public, pg_temp` em cada uma.

### Rollback E3
```sql
ALTER FUNCTION public.<nome>() RESET search_path;
-- (repetir pra cada função, ou usar DO $$ inverso)
```

### E4 — REVOKE EXECUTE de funções trigger-only

13 funções tiveram acesso revogado para anon/authenticated/public (continuam funcionando como triggers porque Postgres não checa privilégio de role no trigger):
`audit_contratos_trigger`, `block_non_admin_delete_contratos`, `handle_new_user_permissions`, `aud_hearings_audit_trigger`, `audit_get_user_email`, `update_updated_at`, `update_updated_at_column`, `calc_update_timestamp`, `aud_update_timestamp`, `cbc_set_updated_at`, `vendas_touch_updated_at`, `crm_touch_updated_at`, `calculos_tsv_update`, `acordos_tsv_update`.

### Rollback E4
```sql
GRANT EXECUTE ON FUNCTION public.<nome>() TO anon, authenticated;
-- (repetir pra cada função)
```

---

## Fase F — Tunning fino

### F1 — Autovacuum agressivo em `contratos_audit`

Default Postgres só dispara vacuum em ~20% de mudança. Para audit table de alto turnover, baixei pra 5%.

```sql
ALTER TABLE public.contratos_audit SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_threshold = 100
);
```

### Rollback F1
```sql
ALTER TABLE public.contratos_audit RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_analyze_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_threshold
);
```

---

## Estado final do banco

| Métrica | Inicial (manhã 30/04) | Final |
|---|---:|---:|
| **Tamanho total do DB** | 414 MB | **65 MB** (-84%) |
| `contratos_audit` (linhas) | 62.981 | 155 |
| `contratos_audit` (tamanho) | 352 MB | 1,1 MB |
| Pollers de 30s rodando | 2 | 0 |
| Frequência de UPDATEs em contratos | ~30k–80k/dia | ~50–200/dia |
| Policies RLS otimizadas | 0 | 33 |
| Índices em FK (cobertura) | faltavam 49 | 0 faltando |
| RLS habilitado em tabelas críticas | 0 ERRORs | 4 ERRORs corrigidos |
| `function_search_path_mutable` | 18 WARNs | 0 |
| Crons de retenção | 0 | 1 (`cron-job-details-cleanup`) |

## Fase G — Higiene adicional (executada depois)

### G1 — VACUUM (não FULL) em tabelas com bloat moderado
```sql
VACUUM (ANALYZE) public.asaas_boletos;   -- era 10,4% dead
VACUUM (ANALYZE) produtividade.tasks;    -- era 16,1% dead
VACUUM (ANALYZE) public.acordos;         -- era 59,4% dead (96 rows)
```
**Rollback**: N/A (operação idempotente).

### G2 — Autovacuum agressivo em `public.contratos`
Tabela "quente" do sistema; estatísticas frescas = planner melhor.
```sql
ALTER TABLE public.contratos SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_threshold = 50
);
```
> ℹ️ `cron.job_run_details` foi tentado mas não temos permissão (owned pelo Supabase).

**Rollback**:
```sql
ALTER TABLE public.contratos RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_analyze_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_threshold
);
```

### G3 — Refresh + cron diário da MV `produtividade.mv_task_costs`
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY produtividade.mv_task_costs;
SELECT cron.schedule(
  'mv-task-costs-refresh',
  '0 7 * * *',  -- 04:00 BRT (após sync ADVBOX das 06:00)
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY produtividade.mv_task_costs$$
);
-- jobid: 11
```
**Rollback**:
```sql
SELECT cron.unschedule('mv-task-costs-refresh');
```

---

## Fase H — Categoria A: melhorias risco-zero (06/05/2026)

### H1 — `COMMENT ON` em tabelas/schemas principais
14 tabelas + 2 schemas com comentários explicativos (contexto, RLS status, integrações). Documentação centralizada no banco — útil pra novos devs e Claude em sessões futuras.

**Rollback**: `COMMENT ON TABLE x IS NULL`.

### H2 — Limpeza de refresh tokens revogados
```sql
DELETE FROM auth.refresh_tokens
WHERE revoked = true AND updated_at < NOW() - INTERVAL '7 days';
-- 1.096 linhas removidas (1.407 → 311)

VACUUM (ANALYZE) auth.refresh_tokens;

SELECT cron.schedule(
  'auth-revoked-tokens-cleanup',
  '30 3 * * 0',  -- Domingos 00:30 BRT
  $$DELETE FROM auth.refresh_tokens WHERE revoked = true AND updated_at < NOW() - INTERVAL '7 days'$$
);
-- jobid: 21
```

**Rollback**: `SELECT cron.unschedule('auth-revoked-tokens-cleanup');` (DELETE não tem rollback).

### H3 — Diff guard em `advbox-vendas-sync.mjs`
**Arquivo**: `client/netlify/functions/advbox-vendas-sync.mjs`
**Backup**: `backups/A3_advbox_diff_20260506_204737/`
**Deploy**: 69fbd337e2104e1d4b5a73d8 (06/05 às 20:47 BRT)

Mudanças:
1. Linha ~158-167: adicionado `if (c.advbox_stage !== stage || c.advbox_step !== step)` antes do UPDATE no caso "sem mapeamento" (evita audit spam quando ADVBOX devolve mesmos valores).
2. Linha ~175-183: removido `updated_at: new Date().toISOString()` (trigger BEFORE já faz).

**Rollback**:
```bash
cp backups/A3_advbox_diff_20260506_204737/advbox-vendas-sync.mjs \
   client/netlify/functions/
cd client && ./deploy.sh
# ou: ./rollback.sh 69fb9d7f3e6f923e90ea1b56
```

### H4 — Cache de `pg_timezone_names` no front — NÃO APLICÁVEL
Investigação revelou: o front **não** chama `pg_timezone_names`. Os 38 calls × 700ms vêm de fora da aplicação (provavelmente Supabase Studio ou alguma extensão). Sem código a otimizar.

---

## O que NÃO foi feito (e por quê)

1. **Remoção de ~150 índices unused**: tabelas em desenvolvimento, custo trivial, risco de penalty futuro.
2. **Reescrita do audit pra gravar só `changed_fields` (item 8 original)**: muda semântica do log, requer aprovação separada.
3. **Webhook ZapSign nativo (C3)**: mudança arquitetural maior, ficou pra outro momento.
4. **75 `rls_policy_always_true` warnings**: são policies legítimas tipo `aud_profiles.auth_read USING (true)` (perfil é público pra todos os usuários logados). Não são bug — só design.
5. **`extension_in_public` (`pg_trgm`, `pg_net`)**: mover pra schema próprio quebraria queries existentes que dependem do search_path padrão. Aceitável.
6. **`auth_leaked_password_protection`**: configuração de Auth no dashboard Supabase, não SQL — Paulo precisa habilitar manualmente em **Project Settings → Auth → "Have I Been Pwned"**.
7. **`public_bucket_allows_listing` em `teses-assets`**: bucket de assets públicos por design.


