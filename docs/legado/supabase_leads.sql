-- ============================================================================
-- SUPABASE MIGRATION — Aba Leads (Meta Ads → Make.com → ChatGuru)
-- Rodar este arquivo no SQL Editor do Supabase painel:
-- https://supabase.com/dashboard/project/vygczeepvoyaehfchxko/sql/new
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────
-- 1. Tabela principal: leads
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at       TIMESTAMPTZ DEFAULT now(),
  nome             TEXT NOT NULL,
  telefone         TEXT NOT NULL,
  quando_comprou   TEXT CHECK (quando_comprou IN ('mais_de_um_ano','menos_de_um_ano') OR quando_comprou IS NULL),
  ainda_pagando    BOOLEAN DEFAULT true,
  campanha         TEXT,
  chatguru_status  TEXT DEFAULT 'pendente' CHECK (chatguru_status IN ('OK','erro','pendente')),
  chatguru_erro    TEXT,
  mensagem_enviada TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_telefone   ON leads (telefone);
CREATE INDEX IF NOT EXISTS idx_leads_campanha   ON leads (campanha);
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads (chatguru_status);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Policies idempotentes (DROP + CREATE)
DROP POLICY IF EXISTS "auth_read_leads"  ON leads;
DROP POLICY IF EXISTS "auth_write_leads" ON leads;

CREATE POLICY "auth_read_leads"  ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_leads" ON leads FOR ALL    TO authenticated USING (true) WITH CHECK (true);
-- A Netlify Function usa SUPABASE_SERVICE_ROLE_KEY, que faz bypass do RLS automaticamente.

-- ──────────────────────────────────────────────────────────────────────
-- 2. Tabela de config: leads_config (template da mensagem, etc.)
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads_config (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chave      TEXT UNIQUE NOT NULL,
  valor      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

ALTER TABLE leads_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_config"  ON leads_config;
DROP POLICY IF EXISTS "auth_write_config" ON leads_config;

CREATE POLICY "auth_read_config"  ON leads_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_config" ON leads_config FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- Insere template padrão (não sobrescreve se já existir)
INSERT INTO leads_config (chave, valor) VALUES
  ('mensagem_template',
   'Olá, {nome}! Aqui é da equipe CBC Advogados. Recebemos seu contato sobre o cancelamento da sua cota de multipropriedade (timeshare). Somos especialistas nesse tipo de ação e já ajudamos centenas de clientes a recuperar o dinheiro investido. Posso te explicar como funciona?')
ON CONFLICT (chave) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────
-- 3. Atualizar user_permissions para liberar aba Leads a todos
-- ──────────────────────────────────────────────────────────────────────
-- Adiciona { "leads": true } em todos os usuários existentes
UPDATE user_permissions
SET tabs = COALESCE(tabs, '{}'::jsonb) || '{"leads": true}'::jsonb
WHERE tabs IS NULL OR NOT (tabs ? 'leads');

-- ──────────────────────────────────────────────────────────────────────
-- 4. Verificação final (opcional — rodar para conferir)
-- ──────────────────────────────────────────────────────────────────────
-- SELECT count(*) AS total_leads FROM leads;
-- SELECT * FROM leads_config;
-- SELECT email, tabs FROM user_permissions WHERE tabs ? 'leads';
