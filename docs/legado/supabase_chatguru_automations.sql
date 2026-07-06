-- ============================================================
-- Tabelas para Automacoes ChatGuru (#233)
-- Executar no Supabase SQL Editor em ordem.
-- ============================================================

-- 1. Templates de mensagem
CREATE TABLE IF NOT EXISTS chatguru_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  texto text NOT NULL,
  tipo text DEFAULT 'individual', -- 'individual' | 'massa'
  variaveis_usadas text[] DEFAULT '{}',
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Triggers (gatilhos)
CREATE TABLE IF NOT EXISTS chatguru_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  evento text NOT NULL, -- 'contrato_enviado', 'contrato_assinado', etc.
  parametros jsonb DEFAULT '{}', -- { dias: 3, valor_minimo: 1000 }
  template_id uuid REFERENCES chatguru_templates(id) ON DELETE RESTRICT,
  condicoes jsonb DEFAULT '{}', -- { resort: 'X', valor_min: 1000 }
  ativo boolean DEFAULT true,
  ultimo_disparo timestamptz,
  proximo_disparo timestamptz,
  created_by text,
  created_at timestamptz DEFAULT now()
);

-- 3. Configuracao global de sazonalidade
CREATE TABLE IF NOT EXISTS chatguru_schedule_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- row unica
  horario_inicio time DEFAULT '09:00',
  horario_fim time DEFAULT '18:00',
  dias_semana integer[] DEFAULT '{1,2,3,4,5}', -- 0=dom, 1=seg, ..., 6=sab
  feriados date[] DEFAULT '{}',
  intervalo_min_horas integer DEFAULT 24,
  timezone text DEFAULT 'America/Sao_Paulo',
  pausado_geral boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

-- Insert row unica
INSERT INTO chatguru_schedule_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 4. Fila de mensagens agendadas
CREATE TABLE IF NOT EXISTS chatguru_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid REFERENCES chatguru_triggers(id) ON DELETE SET NULL,
  template_id uuid REFERENCES chatguru_templates(id),
  contract_id uuid REFERENCES contratos(id) ON DELETE CASCADE,
  client_name text,
  client_phone text,
  client_chatguru_link text,
  mensagem_renderizada text, -- mensagem com variaveis substituidas
  scheduled_at timestamptz NOT NULL,
  status text DEFAULT 'pending', -- 'pending' | 'sent' | 'failed' | 'cancelled' | 'skipped'
  attempts integer DEFAULT 0,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chatguru_queue_status_scheduled ON chatguru_queue(status, scheduled_at);

-- 5. Log de envios (historico)
CREATE TABLE IF NOT EXISTS chatguru_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid REFERENCES chatguru_queue(id) ON DELETE SET NULL,
  template_id uuid,
  trigger_id uuid,
  contract_id uuid,
  client_name text,
  client_phone text,
  mensagem text,
  status text, -- 'sent' | 'delivered' | 'read' | 'failed' | 'ignored'
  response_data jsonb,
  sent_at timestamptz DEFAULT now(),
  response_received_at timestamptz,
  response_text text
);
CREATE INDEX IF NOT EXISTS idx_chatguru_log_sent_at ON chatguru_log(sent_at DESC);

-- 6. Trigger de update_at em templates
CREATE OR REPLACE FUNCTION chatguru_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_chatguru_templates_updated_at ON chatguru_templates;
CREATE TRIGGER tr_chatguru_templates_updated_at
BEFORE UPDATE ON chatguru_templates
FOR EACH ROW EXECUTE FUNCTION chatguru_templates_updated_at();

-- 7. RLS policies (permitir tudo para usuarios autenticados por enquanto)
ALTER TABLE chatguru_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatguru_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatguru_schedule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatguru_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatguru_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_chatguru_templates" ON chatguru_templates;
DROP POLICY IF EXISTS "auth_all_chatguru_triggers" ON chatguru_triggers;
DROP POLICY IF EXISTS "auth_all_chatguru_schedule_config" ON chatguru_schedule_config;
DROP POLICY IF EXISTS "auth_all_chatguru_queue" ON chatguru_queue;
DROP POLICY IF EXISTS "auth_all_chatguru_log" ON chatguru_log;

CREATE POLICY "auth_all_chatguru_templates" ON chatguru_templates FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_chatguru_triggers" ON chatguru_triggers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_chatguru_schedule_config" ON chatguru_schedule_config FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_chatguru_queue" ON chatguru_queue FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_all_chatguru_log" ON chatguru_log FOR ALL USING (auth.role() = 'authenticated');
