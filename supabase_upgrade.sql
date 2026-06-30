-- =============================================
-- CBC Contratos — Upgrade SQL
-- Execute no Supabase Dashboard > SQL Editor
-- =============================================

-- 1. ÍNDICES PARA PERFORMANCE (200+ contratos/mês)
CREATE INDEX IF NOT EXISTS idx_contratos_cpf1 ON contratos (cpf_contratante1);
CREATE INDEX IF NOT EXISTS idx_contratos_cpf2 ON contratos (cpf_contratante2);
CREATE INDEX IF NOT EXISTS idx_contratos_resort ON contratos (resort);
CREATE INDEX IF NOT EXISTS idx_contratos_status ON contratos (status);
CREATE INDEX IF NOT EXISTS idx_contratos_created_at ON contratos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contratos_created_by ON contratos (created_by);
CREATE INDEX IF NOT EXISTS idx_contratos_tipo_acao ON contratos (tipo_acao);

-- 2. TABELA DE FORMULÁRIO DO CLIENTE (QR Code)
CREATE TABLE IF NOT EXISTS client_forms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  form_id text NOT NULL,
  nome text,
  nacionalidade text DEFAULT 'brasileiro(a)',
  profissao text,
  estado_civil text,
  rg text,
  cpf text,
  email text,
  endereco text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_forms_form_id ON client_forms (form_id);

-- Permitir acesso público para INSERT (cliente sem login)
ALTER TABLE client_forms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can insert client_forms" ON client_forms;
CREATE POLICY "Anyone can insert client_forms" ON client_forms FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated can read client_forms" ON client_forms;
CREATE POLICY "Authenticated can read client_forms" ON client_forms FOR SELECT USING (auth.role() = 'authenticated');

-- 3. TABELA DE PERFIS DE ACESSO
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  nome text,
  role text DEFAULT 'advogado' CHECK (role IN ('admin', 'advogado', 'assistente')),
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read all profiles" ON user_profiles;
CREATE POLICY "Users can read all profiles" ON user_profiles FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can update profiles" ON user_profiles;
CREATE POLICY "Admins can update profiles" ON user_profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);
DROP POLICY IF EXISTS "Auto insert on signup" ON user_profiles;
CREATE POLICY "Auto insert on signup" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Inserir perfis para usuários existentes (ajustar emails conforme necessário)
INSERT INTO user_profiles (id, email, nome, role)
SELECT id, email, COALESCE(raw_user_meta_data->>'nome', split_part(email, '@', 1)), 'admin'
FROM auth.users
WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.users.id)
ON CONFLICT (id) DO NOTHING;

-- 4. TABELA DE SESSÕES ATIVAS (sessão única)
CREATE TABLE IF NOT EXISTS active_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  device_info text,
  started_at timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now()
);
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own session" ON active_sessions;
CREATE POLICY "Users manage own session" ON active_sessions FOR ALL USING (auth.uid() = user_id);

-- 5. TABELA DE LOG DE AÇÕES (histórico detalhado)
CREATE TABLE IF NOT EXISTS action_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  user_email text,
  action text NOT NULL, -- 'create', 'edit', 'send_zapsign', 'signed', 'delete', 'view', 'export'
  contrato_id uuid REFERENCES contratos(id) ON DELETE SET NULL,
  details jsonb DEFAULT '{}',
  ip_address text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_action_log_user ON action_log (user_id);
CREATE INDEX IF NOT EXISTS idx_action_log_contrato ON action_log (contrato_id);
CREATE INDEX IF NOT EXISTS idx_action_log_created ON action_log (created_at DESC);
ALTER TABLE action_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read action_log" ON action_log;
CREATE POLICY "Authenticated can read action_log" ON action_log FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated can insert action_log" ON action_log;
CREATE POLICY "Authenticated can insert action_log" ON action_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 6. COLUNA DE BLOQUEIO DE EDIÇÃO CONCORRENTE
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS editing_by text;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS editing_since timestamptz;

-- 7. COLUNA DE OBSERVAÇÕES INTERNAS
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS observacoes_internas text;

-- 8. WEBHOOK CONFIGURAÇÃO (para notificações externas)
CREATE TABLE IF NOT EXISTS webhook_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  url text NOT NULL,
  events text[] DEFAULT '{"status_change"}',
  active boolean DEFAULT true,
  secret text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE webhook_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage webhooks" ON webhook_configs;
CREATE POLICY "Admins manage webhooks" ON webhook_configs FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 9. FUNCTION: Registrar ação automaticamente
CREATE OR REPLACE FUNCTION log_contrato_action()
RETURNS trigger AS $$
BEGIN
  INSERT INTO action_log (user_id, user_email, action, contrato_id, details)
  VALUES (
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    CASE
      WHEN TG_OP = 'INSERT' THEN 'create'
      WHEN TG_OP = 'UPDATE' AND NEW.status != OLD.status THEN
        CASE NEW.status
          WHEN 'enviado_zapsign' THEN 'send_zapsign'
          WHEN 'assinado' THEN 'signed'
          WHEN 'cancelado' THEN 'cancel'
          ELSE 'edit'
        END
      ELSE 'edit'
    END,
    NEW.id,
    jsonb_build_object('status_old', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE null END, 'status_new', NEW.status)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_contrato ON contratos;
CREATE TRIGGER trg_log_contrato
  AFTER INSERT OR UPDATE ON contratos
  FOR EACH ROW EXECUTE FUNCTION log_contrato_action();

-- 10. HABILITAR REALTIME para contratos (só mudanças de status)
ALTER PUBLICATION supabase_realtime ADD TABLE contratos;

SELECT 'Upgrade concluido com sucesso!' AS resultado;
