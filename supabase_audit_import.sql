-- =============================================================
-- AUDITORIA DE CONTRATOS + SOFT DELETE + IMPORT MANUAL (v6.3.0)
-- =============================================================
-- Cria audit trail completo + protege contra DELETE acidental
-- + suporte a contratos importados manualmente.
-- Idempotente: pode rodar varias vezes.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- PARTE 1: Soft delete + flags de import
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='arquivado_em') THEN
    ALTER TABLE contratos ADD COLUMN arquivado_em timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='arquivado_por') THEN
    ALTER TABLE contratos ADD COLUMN arquivado_por text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='arquivado_motivo') THEN
    ALTER TABLE contratos ADD COLUMN arquivado_motivo text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='imported_manually') THEN
    ALTER TABLE contratos ADD COLUMN imported_manually boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='imported_by') THEN
    ALTER TABLE contratos ADD COLUMN imported_by text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='imported_at') THEN
    ALTER TABLE contratos ADD COLUMN imported_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='import_advbox_customer_id') THEN
    ALTER TABLE contratos ADD COLUMN import_advbox_customer_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='import_advbox_lawsuit_id') THEN
    ALTER TABLE contratos ADD COLUMN import_advbox_lawsuit_id text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contratos_arquivado ON contratos(arquivado_em) WHERE arquivado_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contratos_imported ON contratos(imported_manually) WHERE imported_manually = true;

-- ─────────────────────────────────────────────────────────────
-- PARTE 2: Tabela de auditoria
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contratos_audit (
  id bigserial PRIMARY KEY,
  contrato_id uuid,
  action text NOT NULL CHECK (action IN ('insert','update','delete','archive','unarchive')),
  user_email text,
  before_data jsonb,
  after_data jsonb,
  changed_fields text[],
  ip_address text,
  changed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contratos_audit_contrato ON contratos_audit(contrato_id);
CREATE INDEX IF NOT EXISTS idx_contratos_audit_changed_at ON contratos_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_contratos_audit_action ON contratos_audit(action);
CREATE INDEX IF NOT EXISTS idx_contratos_audit_user ON contratos_audit(user_email);

-- RLS — auth pode ler, sistema escreve
ALTER TABLE contratos_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_audit" ON contratos_audit;
CREATE POLICY "auth_read_audit" ON contratos_audit FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "auth_insert_audit" ON contratos_audit;
CREATE POLICY "auth_insert_audit" ON contratos_audit FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────
-- PARTE 3: Funcao auxiliar — extrai email do JWT
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_get_user_email() RETURNS text AS $$
DECLARE
  email_value text;
BEGIN
  BEGIN
    email_value := current_setting('request.jwt.claim.email', true);
    IF email_value IS NULL OR email_value = '' THEN
      email_value := current_setting('request.jwt.claims', true)::json->>'email';
    END IF;
    IF email_value IS NULL OR email_value = '' THEN
      email_value := 'system';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    email_value := 'system';
  END;
  RETURN email_value;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────
-- PARTE 4: Funcao auxiliar — verifica se usuario e admin
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_is_admin(check_email text) RETURNS boolean AS $$
DECLARE
  is_adm boolean;
BEGIN
  IF check_email IS NULL OR check_email = 'system' THEN
    RETURN false;
  END IF;
  SELECT COALESCE(is_admin, false) INTO is_adm
  FROM user_permissions
  WHERE email = check_email
  LIMIT 1;
  RETURN COALESCE(is_adm, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- PARTE 5: Trigger de auditoria (AFTER)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_contratos_trigger() RETURNS TRIGGER AS $$
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
    -- Detecta arquivamento (UPDATE arquivado_em de NULL → not null)
    IF OLD.arquivado_em IS NULL AND NEW.arquivado_em IS NOT NULL THEN
      INSERT INTO contratos_audit(contrato_id, action, user_email, before_data, after_data)
      VALUES (NEW.id, 'archive', v_user_email, to_jsonb(OLD), to_jsonb(NEW));
    -- Desarquivamento
    ELSIF OLD.arquivado_em IS NOT NULL AND NEW.arquivado_em IS NULL THEN
      INSERT INTO contratos_audit(contrato_id, action, user_email, before_data, after_data)
      VALUES (NEW.id, 'unarchive', v_user_email, to_jsonb(OLD), to_jsonb(NEW));
    ELSE
      -- Update normal — registra somente se houve mudanca real
      IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
        -- Lista de colunas que mudaram
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_audit_contratos ON contratos;
CREATE TRIGGER tr_audit_contratos
AFTER INSERT OR UPDATE OR DELETE ON contratos
FOR EACH ROW EXECUTE FUNCTION audit_contratos_trigger();

-- ─────────────────────────────────────────────────────────────
-- PARTE 6: Trigger BEFORE DELETE — bloqueia se nao for admin
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION block_non_admin_delete_contratos() RETURNS TRIGGER AS $$
DECLARE
  v_user_email text;
  v_is_admin boolean;
BEGIN
  v_user_email := audit_get_user_email();

  -- Permite delete vindo de service_role (system, jobs, scripts admin)
  IF v_user_email = 'system' THEN
    RETURN OLD;
  END IF;

  v_is_admin := audit_is_admin(v_user_email);

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'DELETE bloqueado: apenas admins podem excluir contratos. Use arquivamento (UPDATE arquivado_em).'
    USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_block_delete_contratos ON contratos;
CREATE TRIGGER tr_block_delete_contratos
BEFORE DELETE ON contratos
FOR EACH ROW EXECUTE FUNCTION block_non_admin_delete_contratos();

-- ─────────────────────────────────────────────────────────────
-- PARTE 7: View — contratos ativos (nao arquivados)
-- Conveniencia: usar `contratos_ativos` em queries que ignoram arquivados
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW contratos_ativos AS
SELECT * FROM contratos WHERE arquivado_em IS NULL;

-- ─────────────────────────────────────────────────────────────
-- PARTE 8: Funcao para arquivar (RPC) — preferida sobre UPDATE direto
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION arquivar_contrato(
  p_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_user_email text;
  v_result jsonb;
BEGIN
  v_user_email := audit_get_user_email();

  UPDATE contratos
  SET arquivado_em = now(),
      arquivado_por = v_user_email,
      arquivado_motivo = p_motivo
  WHERE id = p_id AND arquivado_em IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato nao encontrado ou ja arquivado' USING ERRCODE = '42P01';
  END IF;

  RETURN jsonb_build_object('success', true, 'id', p_id, 'arquivado_por', v_user_email, 'arquivado_em', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION desarquivar_contrato(p_id uuid) RETURNS jsonb AS $$
DECLARE
  v_user_email text;
  v_is_admin boolean;
BEGIN
  v_user_email := audit_get_user_email();
  v_is_admin := audit_is_admin(v_user_email);

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas admins podem desarquivar' USING ERRCODE = '42501';
  END IF;

  UPDATE contratos
  SET arquivado_em = NULL,
      arquivado_por = NULL,
      arquivado_motivo = NULL
  WHERE id = p_id AND arquivado_em IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato nao encontrado ou nao arquivado';
  END IF;

  RETURN jsonb_build_object('success', true, 'id', p_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION arquivar_contrato TO authenticated;
GRANT EXECUTE ON FUNCTION desarquivar_contrato TO authenticated;

-- =============================================================
-- FIM
-- =============================================================
