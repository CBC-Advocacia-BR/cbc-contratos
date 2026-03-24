-- =====================================================
-- CBC Contratos - Supabase Table Setup
-- Run this in the Supabase SQL Editor
-- Dashboard: https://supabase.com/dashboard/project/vygczeepvoyaehfchxko/sql
-- =====================================================

-- Table: contratos
CREATE TABLE IF NOT EXISTS contratos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Contratante 1
  nome_contratante1 TEXT NOT NULL,
  cpf_contratante1 TEXT NOT NULL,
  email_contratante1 TEXT,

  -- Contratante 2 (optional)
  nome_contratante2 TEXT,
  cpf_contratante2 TEXT,
  email_contratante2 TEXT,

  -- Contract details
  resort TEXT NOT NULL,
  tipo_acao TEXT NOT NULL,

  -- Honorarios
  honorarios_total NUMERIC,
  honorarios_parcelas INTEGER,
  honorarios_valor_parcela NUMERIC,
  honorarios_percentual_exito NUMERIC,
  data_primeira_parcela DATE,

  -- Status
  status TEXT DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviado_zapsign', 'assinado', 'cancelado')),

  -- ZapSign
  zapsign_doc_token TEXT,
  zapsign_links JSONB,

  -- Full contract data (JSON blob for complete reconstruction)
  dados JSONB NOT NULL
);

-- Indexes for search
CREATE INDEX IF NOT EXISTS idx_contratos_nome1 ON contratos USING gin (nome_contratante1 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contratos_nome2 ON contratos USING gin (nome_contratante2 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contratos_cpf1 ON contratos (cpf_contratante1);
CREATE INDEX IF NOT EXISTS idx_contratos_cpf2 ON contratos (cpf_contratante2);
CREATE INDEX IF NOT EXISTS idx_contratos_resort ON contratos (resort);
CREATE INDEX IF NOT EXISTS idx_contratos_status ON contratos (status);
CREATE INDEX IF NOT EXISTS idx_contratos_created ON contratos (created_at DESC);

-- Enable trigram extension for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- RLS policies (allow all for anon key - single-user app)
ALTER TABLE contratos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON contratos
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contratos_updated_at
  BEFORE UPDATE ON contratos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
