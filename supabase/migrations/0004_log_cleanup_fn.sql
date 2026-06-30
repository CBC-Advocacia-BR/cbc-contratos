-- =============================================================
-- 0004 — Funcao de limpeza de logs antigos (NAO agendada)
-- =============================================================
-- Resumo: cria funcao `cleanup_old_logs(retention_days)` que apaga
-- registros mais antigos que N dias das tabelas de log.
--
-- IMPORTANTE: esta migration APENAS CRIA a funcao. NAO AGENDA
-- nenhuma execucao automatica. A funcao precisa ser invocada
-- manualmente ou via pg_cron quando voce decidir.
--
-- Motivacao: tabelas action_log, audit_log, contratos_audit,
-- automation_log tendem a crescer linearmente. Sem limpeza,
-- vao consumir espaco e degradar performance.
--
-- Idempotente: CREATE OR REPLACE.
-- Tempo estimado: <1s para criar; tempo de execucao depende do
-- volume das tabelas.
-- =============================================================

-- UP ----------------------------------------------------------

CREATE OR REPLACE FUNCTION cleanup_old_logs(retention_days integer DEFAULT 90)
RETURNS jsonb AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted_action int := 0;
  v_deleted_audit int := 0;
  v_deleted_contratos_audit int := 0;
  v_deleted_automation int := 0;
  v_deleted_chatguru_log int := 0;
  v_table_exists boolean;
BEGIN
  v_cutoff := now() - (retention_days || ' days')::interval;

  -- action_log
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'action_log') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM action_log WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_action = ROW_COUNT;
  END IF;

  -- audit_log
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM audit_log WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_audit = ROW_COUNT;
  END IF;

  -- contratos_audit
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contratos_audit') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM contratos_audit WHERE changed_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_contratos_audit = ROW_COUNT;
  END IF;

  -- automation_log
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'automation_log') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM automation_log WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_automation = ROW_COUNT;
  END IF;

  -- chatguru_log
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chatguru_log') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM chatguru_log WHERE sent_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_chatguru_log = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'cutoff_date', v_cutoff,
    'retention_days', retention_days,
    'deleted', jsonb_build_object(
      'action_log', v_deleted_action,
      'audit_log', v_deleted_audit,
      'contratos_audit', v_deleted_contratos_audit,
      'automation_log', v_deleted_automation,
      'chatguru_log', v_deleted_chatguru_log
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Restringir execucao: apenas service_role e admins.
REVOKE ALL ON FUNCTION cleanup_old_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_old_logs(integer) TO service_role;

-- =============================================================
-- COMO USAR (manualmente)
-- =============================================================
-- Dry-run mental: rode primeiro com retention 9999 dias para ver
-- volume das tabelas sem deletar nada.
--
-- Para ver os volumes ANTES de qualquer cleanup:
--   SELECT 'action_log', count(*) FROM action_log
--   UNION ALL SELECT 'audit_log', count(*) FROM audit_log
--   UNION ALL SELECT 'contratos_audit', count(*) FROM contratos_audit;
--
-- Para limpar registros >90 dias (recomendado):
--   SELECT cleanup_old_logs(90);
--
-- Para limpar registros >180 dias (mais conservador):
--   SELECT cleanup_old_logs(180);
--
-- =============================================================
-- AGENDAMENTO AUTOMATICO (opcional, NAO ATIVADO POR ESTA MIGRATION)
-- =============================================================
-- Se quiser agendar via pg_cron (precisa habilitar a extensao no
-- painel Supabase: Database → Extensions → pg_cron), execute:
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule(
--     'cleanup-old-logs-weekly',
--     '0 3 * * 0',                       -- domingo as 03:00
--     $$ SELECT cleanup_old_logs(90); $$
--   );
--
-- Para desagendar:
--   SELECT cron.unschedule('cleanup-old-logs-weekly');
-- =============================================================

-- =============================================================
-- DOWN (reversao — comentado por padrao)
-- =============================================================

/*
DROP FUNCTION IF EXISTS cleanup_old_logs(integer);
*/
