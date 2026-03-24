-- =====================================================
-- CBC Contratos V2 - New tables
-- Run in Supabase SQL Editor
-- =====================================================

-- Add tags column to contratos
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  ip_address TEXT
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all audit_log" ON audit_log FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);

-- Contract Versions
CREATE TABLE IF NOT EXISTS contratos_versoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id UUID REFERENCES contratos(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  change_description TEXT,
  dados JSONB NOT NULL
);
ALTER TABLE contratos_versoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all versoes" ON contratos_versoes FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_versoes_contrato ON contratos_versoes (contrato_id, version_number DESC);

-- Clause Library
CREATE TABLE IF NOT EXISTS clausulas_biblioteca (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  titulo TEXT NOT NULL,
  texto TEXT NOT NULL,
  categoria TEXT DEFAULT 'geral',
  tags TEXT[] DEFAULT '{}',
  created_by TEXT,
  uso_count INTEGER DEFAULT 0
);
ALTER TABLE clausulas_biblioteca ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all clausulas_bib" ON clausulas_biblioteca FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER clausulas_bib_updated_at
  BEFORE UPDATE ON clausulas_biblioteca
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
