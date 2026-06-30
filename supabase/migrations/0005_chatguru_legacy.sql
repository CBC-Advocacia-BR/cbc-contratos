-- =============================================================
-- 0005 — Remocao do ChatGuru: tabelas legacy + renomeacao de colunas
-- =============================================================
-- Resumo: ChatGuru foi removido em 23/05/2026 (v6.4.0). Comunicacao
-- agora e manual via Kommo. Esta migration:
--
--   1. RENOMEIA chatguru_log -> _legacy_chatguru_log (preserva historico)
--   2. RENOMEIA chatguru_queue -> _legacy_chatguru_queue (preserva)
--   3. DROPA chatguru_templates, chatguru_triggers, chatguru_schedule_config
--      (sem dados a preservar — eram apenas configs/templates)
--   4. RENOMEIA colunas chatguru_* em outras tabelas (neutras)
--   5. ATUALIZA dados JSONB de contratos: linkChatguru -> linkKommo
--   6. ATUALIZA cleanup_old_logs() — remove referencia a chatguru_log
--   7. DROPA triggers updated_at de tabelas que foram dropadas
--
-- IMPORTANTE: rodar ANTES do deploy do frontend novo. O frontend novo
-- ja referencia os nomes novos (kommo_link, linkKommo, status_envio,
-- erro_envio). Rodar isto antes evita downtime.
--
-- Idempotente: usa IF EXISTS / IF NOT EXISTS onde possivel.
-- Tempo estimado: <5s para conta com poucos milhares de rows.
-- =============================================================

-- UP ----------------------------------------------------------

BEGIN;

-- 1. Preservar historico em tabelas _legacy_
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chatguru_log' AND table_schema = 'public') THEN
    ALTER TABLE chatguru_log RENAME TO _legacy_chatguru_log;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chatguru_queue' AND table_schema = 'public') THEN
    ALTER TABLE chatguru_queue RENAME TO _legacy_chatguru_queue;
  END IF;
END $$;

-- 2. Drop tabelas que nao tem dados a preservar
-- (CASCADE pq podem ter FKs incoming de _legacy_chatguru_queue para
--  chatguru_triggers/templates — vamos manter as FKs apontando, ja que
--  _legacy_ vai ser read-only de qualquer jeito.)
-- Antes de drop: dropar FKs que apontam para essas tabelas a partir de _legacy_
DO $$
BEGIN
  -- Constraint do _legacy_chatguru_queue para chatguru_triggers/templates
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chatguru_queue_trigger_id_fkey') THEN
    ALTER TABLE _legacy_chatguru_queue DROP CONSTRAINT chatguru_queue_trigger_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chatguru_queue_template_id_fkey') THEN
    ALTER TABLE _legacy_chatguru_queue DROP CONSTRAINT chatguru_queue_template_id_fkey;
  END IF;
  -- Constraint do _legacy_chatguru_log para chatguru_queue
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chatguru_log_queue_id_fkey') THEN
    ALTER TABLE _legacy_chatguru_log DROP CONSTRAINT chatguru_log_queue_id_fkey;
  END IF;
END $$;

DROP TABLE IF EXISTS chatguru_templates CASCADE;
DROP TABLE IF EXISTS chatguru_triggers CASCADE;
DROP TABLE IF EXISTS chatguru_schedule_config CASCADE;
DROP FUNCTION IF EXISTS chatguru_templates_updated_at();

-- 3. Renomear colunas em outras tabelas (agnostico ao provedor)
DO $$
BEGIN
  -- leads.chatguru_status -> status_envio
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'chatguru_status') THEN
    ALTER TABLE leads RENAME COLUMN chatguru_status TO status_envio;
  END IF;
  -- leads.chatguru_erro -> erro_envio
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'chatguru_erro') THEN
    ALTER TABLE leads RENAME COLUMN chatguru_erro TO erro_envio;
  END IF;
  -- vendas_leads_rapidos.chatguru_link -> kommo_link
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendas_leads_rapidos' AND column_name = 'chatguru_link') THEN
    ALTER TABLE vendas_leads_rapidos RENAME COLUMN chatguru_link TO kommo_link;
  END IF;
  -- vendas_comissoes.chatguru_link -> kommo_link (se existir)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendas_comissoes' AND column_name = 'chatguru_link') THEN
    ALTER TABLE vendas_comissoes RENAME COLUMN chatguru_link TO kommo_link;
  END IF;
END $$;

-- 4. Migrar dados JSONB: contratos.dados.contratantes[].linkChatguru -> linkKommo
-- Atualiza apenas linhas que tem o campo legado preenchido.
-- jsonb_set + path para cada elemento do array contratantes.
DO $$
DECLARE
  contrato_record RECORD;
  contratante_idx integer;
  contratantes_arr jsonb;
  contratante jsonb;
  updated_arr jsonb;
  link_value text;
BEGIN
  FOR contrato_record IN
    SELECT id, dados
    FROM contratos
    WHERE dados->'contratantes' IS NOT NULL
      AND jsonb_typeof(dados->'contratantes') = 'array'
      AND dados::text LIKE '%linkChatguru%'
  LOOP
    contratantes_arr := contrato_record.dados->'contratantes';
    updated_arr := '[]'::jsonb;
    FOR contratante_idx IN 0 .. jsonb_array_length(contratantes_arr) - 1 LOOP
      contratante := contratantes_arr -> contratante_idx;
      link_value := contratante->>'linkChatguru';
      IF link_value IS NOT NULL THEN
        contratante := contratante - 'linkChatguru';
        -- So define linkKommo se ainda nao existe (preserva valor novo)
        IF NOT (contratante ? 'linkKommo') THEN
          contratante := jsonb_set(contratante, '{linkKommo}', to_jsonb(link_value));
        END IF;
      END IF;
      updated_arr := updated_arr || jsonb_build_array(contratante);
    END LOOP;
    UPDATE contratos
    SET dados = jsonb_set(dados, '{contratantes}', updated_arr)
    WHERE id = contrato_record.id;
  END LOOP;
END $$;

-- 5. Atualizar funcao cleanup_old_logs() — remove referencia a chatguru_log
-- (a versao nova so deleta de tabelas que ainda existem)
CREATE OR REPLACE FUNCTION cleanup_old_logs(retention_days integer DEFAULT 90)
RETURNS jsonb AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted_action int := 0;
  v_deleted_audit int := 0;
  v_deleted_contratos_audit int := 0;
  v_deleted_automation int := 0;
  v_deleted_legacy_chatguru_log int := 0;
  v_table_exists boolean;
BEGIN
  v_cutoff := now() - (retention_days || ' days')::interval;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'action_log') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM action_log WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_action = ROW_COUNT;
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM audit_log WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_audit = ROW_COUNT;
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contratos_audit') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM contratos_audit WHERE changed_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_contratos_audit = ROW_COUNT;
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'automation_log') INTO v_table_exists;
  IF v_table_exists THEN
    DELETE FROM automation_log WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted_automation = ROW_COUNT;
  END IF;

  -- (chatguru removal 2026-05) chatguru_log virou _legacy_chatguru_log — retencao 1 ano
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_legacy_chatguru_log') INTO v_table_exists;
  IF v_table_exists AND retention_days < 365 THEN
    -- Para _legacy_, retencao minima de 1 ano (parametro ignorado)
    DELETE FROM _legacy_chatguru_log WHERE sent_at < now() - interval '365 days';
    GET DIAGNOSTICS v_deleted_legacy_chatguru_log = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'cutoff_date', v_cutoff,
    'retention_days', retention_days,
    'deleted', jsonb_build_object(
      'action_log', v_deleted_action,
      'audit_log', v_deleted_audit,
      'contratos_audit', v_deleted_contratos_audit,
      'automation_log', v_deleted_automation,
      '_legacy_chatguru_log', v_deleted_legacy_chatguru_log
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- =============================================================
-- DOWN (reversao — comentado por padrao)
-- =============================================================
-- ATENCAO: reverter eh dificil porque tabelas dropadas (templates,
-- triggers, schedule_config) nao podem ser recriadas com dados.
-- A reversao abaixo recria estrutura vazia + renomeia de volta:
--
/*
BEGIN;
-- Renomeacao reversa
ALTER TABLE _legacy_chatguru_log RENAME TO chatguru_log;
ALTER TABLE _legacy_chatguru_queue RENAME TO chatguru_queue;
ALTER TABLE leads RENAME COLUMN status_envio TO chatguru_status;
ALTER TABLE leads RENAME COLUMN erro_envio TO chatguru_erro;
ALTER TABLE vendas_leads_rapidos RENAME COLUMN kommo_link TO chatguru_link;
ALTER TABLE vendas_comissoes RENAME COLUMN kommo_link TO chatguru_link;
-- Tabelas dropadas: rodar manualmente supabase_chatguru_automations.sql
-- JSONB: rodar UPDATE inverso (linkKommo -> linkChatguru)
COMMIT;
*/

-- =============================================================
-- Verificacao apos rodar:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema='public' AND table_name LIKE '%chatguru%';
-- (esperado: apenas _legacy_chatguru_log e _legacy_chatguru_queue)
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='leads' AND column_name LIKE '%envio%';
-- (esperado: status_envio, erro_envio)
--
-- SELECT count(*) FROM contratos WHERE dados::text LIKE '%linkChatguru%';
-- (esperado: 0)
--
-- SELECT count(*) FROM contratos WHERE dados::text LIKE '%linkKommo%';
-- (esperado: equivalente ao total de contratos com link preenchido)
-- =============================================================
