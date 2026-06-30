-- =============================================================
-- 0006 — Exclusao de contratos da lista Asaas (audit trail)
-- =============================================================
-- Resumo: adiciona 3 colunas para permitir "excluir" um contrato
-- da listagem Asaas sem deletar o contrato em si. O usuario pode
-- restaurar depois (asaas_excluded_at = null).
--
-- Comportamento esperado:
--   - asaas_excluded_at IS NULL    → contrato aparece na lista
--   - asaas_excluded_at IS NOT NULL → contrato aparece em sub-view "Excluidos"
--
-- Idempotente: usa IF NOT EXISTS.
-- Tempo estimado: <1s.
-- =============================================================

-- UP ----------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='asaas_excluded_at') THEN
    ALTER TABLE contratos ADD COLUMN asaas_excluded_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='asaas_excluded_by') THEN
    ALTER TABLE contratos ADD COLUMN asaas_excluded_by text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='asaas_excluded_reason') THEN
    ALTER TABLE contratos ADD COLUMN asaas_excluded_reason text;
  END IF;
END $$;

-- Indice partial: so contratos excluidos (acelera listagem da sub-view "Excluidos")
CREATE INDEX IF NOT EXISTS idx_contratos_asaas_excluded
  ON contratos(asaas_excluded_at DESC)
  WHERE asaas_excluded_at IS NOT NULL;

-- =============================================================
-- DOWN (reversao — comentado por padrao)
-- =============================================================

/*
DROP INDEX IF EXISTS idx_contratos_asaas_excluded;
ALTER TABLE contratos DROP COLUMN IF EXISTS asaas_excluded_at;
ALTER TABLE contratos DROP COLUMN IF EXISTS asaas_excluded_by;
ALTER TABLE contratos DROP COLUMN IF EXISTS asaas_excluded_reason;
*/

-- =============================================================
-- Verificacao apos rodar:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='contratos' AND column_name LIKE 'asaas_excluded%';
-- (esperado: 3 colunas)
-- =============================================================
