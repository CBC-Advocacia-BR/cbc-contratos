-- =============================================================
-- Colunas de controle de retry do Drive upload (v6.2.0)
-- =============================================================
-- Rodar no Supabase SQL Editor. Idempotente.
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='drive_attempts') THEN
    ALTER TABLE contratos ADD COLUMN drive_attempts integer DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='drive_last_attempt_at') THEN
    ALTER TABLE contratos ADD COLUMN drive_last_attempt_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='drive_last_error') THEN
    ALTER TABLE contratos ADD COLUMN drive_last_error text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='drive_failed_reason') THEN
    ALTER TABLE contratos ADD COLUMN drive_failed_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='drive_error_code') THEN
    ALTER TABLE contratos ADD COLUMN drive_error_code text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contratos_drive_file_id ON contratos(drive_file_id) WHERE drive_file_id IN ('uploading','failed');
CREATE INDEX IF NOT EXISTS idx_contratos_drive_last_attempt ON contratos(drive_last_attempt_at) WHERE drive_last_attempt_at IS NOT NULL;

-- =============================================================
-- FIM
-- =============================================================
