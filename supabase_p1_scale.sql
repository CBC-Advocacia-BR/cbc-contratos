-- =============================================================
-- ESCALABILIDADE FASE 1 (v6.5.0)
-- =============================================================
-- 1. Indices estrategicos (busca, filtros, ordenacao)
-- 2. Materialized view dashboard_stats (refresh 5min)
-- 3. Particionamento/retencao logs via pg_cron (limpeza diaria)
-- 4. Extensoes pg_trgm (busca fuzzy) e pg_cron
-- Idempotente.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- PARTE 1: Extensoes
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─────────────────────────────────────────────────────────────
-- PARTE 2: Indices em contratos (queries frequentes)
-- ─────────────────────────────────────────────────────────────

-- Listagem padrao filtrada por status
CREATE INDEX IF NOT EXISTS idx_contratos_status_created
  ON contratos(status, created_at DESC)
  WHERE arquivado_em IS NULL;

-- Listagem por vendedora (aba Minhas Vendas)
CREATE INDEX IF NOT EXISTS idx_contratos_vendedora_status
  ON contratos(vendedora_email, status, signed_at DESC)
  WHERE arquivado_em IS NULL;

-- Filtro por resort
CREATE INDEX IF NOT EXISTS idx_contratos_resort_status
  ON contratos(resort, status)
  WHERE arquivado_em IS NULL;

-- Busca fuzzy por nome (trigram)
CREATE INDEX IF NOT EXISTS idx_contratos_nome1_trgm
  ON contratos USING gin (nome_contratante1 gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contratos_nome2_trgm
  ON contratos USING gin (nome_contratante2 gin_trgm_ops)
  WHERE nome_contratante2 IS NOT NULL;

-- Busca por CPF (formatado e numerico)
CREATE INDEX IF NOT EXISTS idx_contratos_cpf1
  ON contratos(cpf_contratante1)
  WHERE cpf_contratante1 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contratos_cpf2
  ON contratos(cpf_contratante2)
  WHERE cpf_contratante2 IS NOT NULL;

-- Detecao de duplicatas (cpf+resort)
CREATE INDEX IF NOT EXISTS idx_contratos_cpf_resort
  ON contratos(cpf_contratante1, resort);

-- Filtros por data de assinatura
CREATE INDEX IF NOT EXISTS idx_contratos_signed_at
  ON contratos(signed_at DESC)
  WHERE signed_at IS NOT NULL;

-- (Removido) idx_contratos_signed_month — date_trunc(timestamptz) e STABLE,
-- nao IMMUTABLE, entao Postgres rejeita em index expression.
-- Solucao: a materialized view dashboard_stats ja agrega por mes.
-- Se necessario no futuro, criar generated column STORED ou usar
-- expressao IMMUTABLE como to_char(signed_at AT TIME ZONE 'UTC', 'YYYY-MM').

-- ZapSign polling (busca frequente em status='enviado_zapsign')
CREATE INDEX IF NOT EXISTS idx_contratos_zapsign_polling
  ON contratos(zapsign_doc_token)
  WHERE status = 'enviado_zapsign' AND zapsign_doc_token IS NOT NULL;

-- Drive automation (assinados sem upload)
CREATE INDEX IF NOT EXISTS idx_contratos_drive_pending
  ON contratos(id)
  WHERE status = 'assinado' AND drive_file_id IS NULL;

-- Tipo de acao (filtro Dashboard)
CREATE INDEX IF NOT EXISTS idx_contratos_tipo_acao
  ON contratos(tipo_acao)
  WHERE arquivado_em IS NULL;

-- Origem cliente (analytics)
CREATE INDEX IF NOT EXISTS idx_contratos_origem
  ON contratos(origem_cliente, created_at DESC)
  WHERE origem_cliente IS NOT NULL;

-- Importados manualmente (filtro)
CREATE INDEX IF NOT EXISTS idx_contratos_imported
  ON contratos(imported_at DESC)
  WHERE imported_manually = true;

-- ─────────────────────────────────────────────────────────────
-- PARTE 3: Indices em tabelas de log (queries de monitor)
-- ─────────────────────────────────────────────────────────────

-- automation_log
CREATE INDEX IF NOT EXISTS idx_automation_log_action_status
  ON automation_log(action, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_log_contract
  ON automation_log(contract_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_log_recent_errors
  ON automation_log(created_at DESC)
  WHERE status IN ('error', 'failed_manual');

-- activity_log
CREATE INDEX IF NOT EXISTS idx_activity_log_user_time
  ON activity_log(user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_action_time
  ON activity_log(action, created_at DESC);

-- contratos_audit (criada na v6.3.0)
CREATE INDEX IF NOT EXISTS idx_contratos_audit_action_time
  ON contratos_audit(action, changed_at DESC);

-- ─────────────────────────────────────────────────────────────
-- PARTE 4: Materialized view dashboard_stats
-- ─────────────────────────────────────────────────────────────

DROP MATERIALIZED VIEW IF EXISTS dashboard_stats;

CREATE MATERIALIZED VIEW dashboard_stats AS
WITH base AS (
  SELECT * FROM contratos WHERE arquivado_em IS NULL
),
mes_atual AS (
  SELECT *
  FROM base
  WHERE signed_at >= date_trunc('month', now())
    AND signed_at < date_trunc('month', now()) + interval '1 month'
),
mes_anterior AS (
  SELECT *
  FROM base
  WHERE signed_at >= date_trunc('month', now()) - interval '1 month'
    AND signed_at < date_trunc('month', now())
),
por_mes AS (
  SELECT
    date_trunc('month', signed_at)::date AS mes,
    count(*) AS total,
    sum(coalesce(honorarios_total, 0))::numeric AS receita
  FROM base
  WHERE signed_at IS NOT NULL
    AND signed_at >= now() - interval '12 months'
  GROUP BY 1
),
por_resort AS (
  SELECT
    resort,
    count(*) AS total,
    sum(coalesce(honorarios_total, 0))::numeric AS receita,
    count(*) FILTER (WHERE status = 'assinado') AS assinados
  FROM base
  WHERE resort IS NOT NULL
  GROUP BY 1
),
por_tipo AS (
  SELECT
    tipo_acao,
    count(*) AS total,
    sum(coalesce(honorarios_total, 0))::numeric AS receita_iniciais,
    avg(coalesce(honorarios_percentual_exito, 0))::numeric AS pct_exito_medio
  FROM base
  WHERE tipo_acao IS NOT NULL
  GROUP BY 1
)
SELECT
  -- KPIs basicos
  (SELECT count(*) FROM base) AS total_contratos,
  (SELECT count(*) FROM base WHERE status = 'rascunho') AS rascunhos,
  (SELECT count(*) FROM base WHERE status = 'enviado_zapsign') AS enviados,
  (SELECT count(*) FROM base WHERE status = 'assinado') AS assinados,
  (SELECT count(*) FROM base WHERE status = 'cancelado') AS cancelados,

  -- Mes atual vs anterior
  (SELECT count(*) FROM mes_atual) AS assinados_mes,
  (SELECT count(*) FROM mes_anterior) AS assinados_mes_anterior,
  (SELECT coalesce(sum(honorarios_total), 0)::numeric FROM mes_atual) AS receita_mes,
  (SELECT coalesce(sum(honorarios_total), 0)::numeric FROM mes_anterior) AS receita_mes_anterior,

  -- Pendencias automacao
  (SELECT count(*) FROM base WHERE status = 'assinado' AND advbox_status IS NULL) AS pendente_advbox,
  (SELECT count(*) FROM base WHERE status = 'assinado' AND drive_file_id IS NULL) AS pendente_drive,
  (SELECT count(*) FROM base WHERE drive_file_id = 'failed') AS drive_failed,

  -- Series temporais e agregados
  (SELECT json_agg(row_to_json(p) ORDER BY p.mes)
     FROM (SELECT mes, total, receita FROM por_mes) p) AS serie_mensal,
  (SELECT json_agg(row_to_json(r) ORDER BY r.total DESC)
     FROM (SELECT resort, total, receita, assinados FROM por_resort LIMIT 20) r) AS top_resorts,
  (SELECT json_agg(row_to_json(t) ORDER BY t.total DESC)
     FROM (SELECT tipo_acao, total, receita_iniciais, pct_exito_medio FROM por_tipo) t) AS por_tipo_acao,

  -- Importados manualmente
  (SELECT count(*) FROM base WHERE imported_manually = true) AS importados,

  -- Metadados
  now() AS computed_at;

-- (Indice unico removido — era necessario apenas para CONCURRENTLY,
-- que removemos por simplicidade. View tem 1 linha so.)

-- Permitir leitura por authenticated
GRANT SELECT ON dashboard_stats TO authenticated;
GRANT SELECT ON dashboard_stats TO anon;

-- ─────────────────────────────────────────────────────────────
-- PARTE 5: Funcao para refresh
-- ─────────────────────────────────────────────────────────────

-- Nota: CONCURRENTLY removido. Exige indice unico em coluna real
-- (nao em expressao). Como a view tem 1 linha so, refresh dura ~50ms;
-- o lock breve nao impacta na pratica.
CREATE OR REPLACE FUNCTION refresh_dashboard_stats() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW dashboard_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION refresh_dashboard_stats TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- PARTE 6: pg_cron — refresh dashboard a cada 5min
-- ─────────────────────────────────────────────────────────────

-- Remover schedule anterior se existir (idempotencia)
SELECT cron.unschedule('refresh-dashboard-stats')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-dashboard-stats');

SELECT cron.schedule(
  'refresh-dashboard-stats',
  '*/5 * * * *',
  $$ SELECT refresh_dashboard_stats(); $$
);

-- ─────────────────────────────────────────────────────────────
-- PARTE 7: Retencao automatica de logs (TTL)
-- ─────────────────────────────────────────────────────────────

-- Funcao limpeza
CREATE OR REPLACE FUNCTION cleanup_old_logs() RETURNS jsonb AS $$
DECLARE
  v_automation_ok integer;
  v_activity integer;
  v_audit integer;
  v_started timestamptz := now();
BEGIN
  -- automation_log: manter erros 6 meses, OKs 90 dias
  WITH del_ok AS (
    DELETE FROM automation_log
    WHERE status = 'ok' AND created_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_automation_ok FROM del_ok;

  -- automation_log erros: manter 6 meses
  DELETE FROM automation_log
  WHERE status IN ('error','failed_manual')
    AND created_at < now() - interval '180 days';

  -- activity_log: manter 90 dias (tudo)
  WITH del_act AS (
    DELETE FROM activity_log WHERE created_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_activity FROM del_act;

  -- contratos_audit: manter 1 ano para insert/update normais; archive/delete = forever
  WITH del_audit AS (
    DELETE FROM contratos_audit
    WHERE action IN ('insert','update')
      AND changed_at < now() - interval '365 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_audit FROM del_audit;

  RETURN jsonb_build_object(
    'started_at', v_started,
    'finished_at', now(),
    'automation_log_ok_deleted', v_automation_ok,
    'activity_log_deleted', v_activity,
    'contratos_audit_deleted', v_audit
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_old_logs TO authenticated;

-- pg_cron — limpeza diaria 03:30 BRT (06:30 UTC)
SELECT cron.unschedule('cleanup-old-logs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-logs');

SELECT cron.schedule(
  'cleanup-old-logs',
  '30 6 * * *',
  $$ SELECT cleanup_old_logs(); $$
);

-- ─────────────────────────────────────────────────────────────
-- PARTE 8: ANALYZE (atualiza estatisticas do otimizador)
-- ─────────────────────────────────────────────────────────────

ANALYZE contratos;
ANALYZE automation_log;
ANALYZE activity_log;
ANALYZE contratos_audit;

-- Refresh inicial da view
SELECT refresh_dashboard_stats();

-- =============================================================
-- POS-EXECUCAO: VERIFICAR
-- =============================================================
-- Indices criados:
--   SELECT indexname, tablename FROM pg_indexes WHERE schemaname='public' AND tablename='contratos' ORDER BY indexname;
--
-- pg_cron jobs ativos:
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--
-- Conferir dashboard_stats:
--   SELECT * FROM dashboard_stats;
-- =============================================================
