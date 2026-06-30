# Supabase Migrations

Migrations versionadas. Rodar **em ordem numérica** no Supabase SQL Editor.

## Histórico (já aplicado em produção)

Os SQLs antigos na **raiz do repositório** ja foram aplicados manualmente. Servem como histórico:

| Arquivo (raiz) | Aplicado | Conteúdo |
|---|---|---|
| `supabase_setup.sql` | ✅ | Tabela `contratos`, índices base, RLS, trigger `updated_at` |
| `supabase_v2.sql` | ✅ | `audit_log`, `contratos_versoes`, `clausulas_biblioteca`, coluna `tags`, `created_by` |
| `supabase_upgrade.sql` | ✅ | Índices extra, `client_forms`, `user_profiles`, `active_sessions`, `action_log`, `webhook_configs`, trigger de log |
| `supabase_leads.sql` | ✅ | `leads`, `leads_config` |
| `supabase_audit_import.sql` | ✅ | Soft-delete (`arquivado_*`), `contratos_audit`, `block_non_admin_delete`, RPC `arquivar_contrato` |
| `supabase_chatguru_automations.sql` | ⚠ Verificar | `chatguru_templates`, `_triggers`, `_schedule_config`, `_queue`, `_log` |
| `supabase_drive_retry_columns.sql` | ✅ | Colunas `drive_attempts`, `drive_last_attempt_at`, `drive_last_error`, etc. |
| `supabase_vendas_comissoes.sql` | ⚠ Verificar | Sistema de vendas (440 linhas) |

> Para verificar se um SQL foi aplicado, conferir no Supabase Studio: **Database → Tables**.

## Pendentes (rodar manualmente nesta ordem)

| Arquivo | Descrição | Tempo |
|---|---|---|
| `0002_perf_indexes.sql` | Índice composto `(status, created_at DESC)` | <1s |
| `0003_updated_at_triggers.sql` | Trigger `updated_at` em `user_profiles` | <1s |
| `0004_log_cleanup_fn.sql` | Função de limpeza de logs antigos (não agendada) | <1s |

## Como rodar

1. Abrir https://supabase.com/dashboard/project/vygczeepvoyaehfchxko/sql
2. Copiar conteúdo do arquivo (apenas o bloco `-- UP`)
3. Colar e executar
4. Verificar mensagem de sucesso

## Como reverter

Cada arquivo tem um bloco `-- DOWN` no final, comentado. Para reverter:

1. Abrir o mesmo arquivo
2. Copiar **só o bloco DOWN**
3. Executar no SQL Editor

## Convenção para próximas migrations

Nome: `NNNN_descricao_curta.sql` (4 dígitos sequenciais).

Estrutura mínima:
```sql
-- =============================================================
-- NNNN — Título descritivo
-- =============================================================
-- Resumo: o que faz e por quê
-- Idempotente: pode rodar varias vezes sem efeito colateral
-- Tempo estimado: <Ns
-- =============================================================

-- UP

<comandos>

-- =============================================================
-- DOWN (reversao — comentado por padrao)
-- =============================================================

/*
<comandos de reversao>
*/
```

## Boas práticas

- **Idempotência**: usar `IF NOT EXISTS`, `OR REPLACE`, `DROP IF EXISTS`
- **Sem destrutivo sem confirmar**: nunca `DROP TABLE`, `TRUNCATE`, `DELETE` em massa sem flag explícita
- **Backup antes de migrations destrutivas**: dump local da tabela afetada
- **Tempo estimado** no cabeçalho — aviso se for longo
- **Não combinar mudanças não-relacionadas** no mesmo arquivo
