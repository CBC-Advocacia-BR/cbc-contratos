-- =============================================================
-- 0003 — Triggers updated_at faltantes
-- =============================================================
-- Resumo: garante que toda tabela com coluna `updated_at` tem
-- trigger BEFORE UPDATE atualizando o campo automaticamente.
--
-- Tabelas afetadas:
--   - user_profiles (existe coluna, faltava trigger)
--
-- HISTORICO: a versao original tambem criava trigger em
-- chatguru_schedule_config — essa tabela foi dropada pela migration
-- 0005 (ChatGuru removal 23/05/2026), entao o trecho foi removido.
--
-- Idempotente: DROP TRIGGER IF EXISTS antes de criar.
-- Tempo estimado: <1s.
-- =============================================================

-- UP ----------------------------------------------------------

-- A funcao update_updated_at() ja existe (criada em supabase_setup.sql).
-- Apenas adicionamos triggers nas tabelas que faltavam.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at'
  ) THEN
    CREATE FUNCTION update_updated_at() RETURNS TRIGGER AS $f$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;
  END IF;
END $$;

-- user_profiles ------------------------------------------------
DROP TRIGGER IF EXISTS user_profiles_updated_at ON user_profiles;
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- (chatguru removal 2026-05) trigger chatguru_schedule_config_updated_at removido

-- =============================================================
-- DOWN (reversao — comentado por padrao)
-- =============================================================

/*
DROP TRIGGER IF EXISTS user_profiles_updated_at ON user_profiles;
*/

-- =============================================================
-- Verificacao apos rodar:
-- SELECT event_object_table, trigger_name, action_timing
-- FROM information_schema.triggers
-- WHERE trigger_name LIKE '%updated_at%'
-- ORDER BY event_object_table;
-- =============================================================
