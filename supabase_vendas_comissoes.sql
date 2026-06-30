-- =============================================================
-- MODULO DE VENDAS E COMISSOES — CBC Contratos
-- =============================================================
-- Criado em 18/04/2026
-- Executar no Supabase SQL Editor em ordem.
-- Idempotente: pode rodar varias vezes sem quebrar (IF NOT EXISTS).
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- PARTE 1: Extensoes em user_permissions (perfil vendas)
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Adicionar colunas novas se nao existirem
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permissions' AND column_name='perfil_vendas') THEN
    ALTER TABLE user_permissions ADD COLUMN perfil_vendas text CHECK (perfil_vendas IN ('vendedora','assistente') OR perfil_vendas IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permissions' AND column_name='vendedora_parceira_email') THEN
    ALTER TABLE user_permissions ADD COLUMN vendedora_parceira_email text;
  END IF;
END $$;

-- As novas tabs (vendas, comissoes_socios) ficam no JSONB `tabs` existente.
-- Atualizar o JSON de Paulo e Bruno para ter acesso a comissoes_socios:
UPDATE user_permissions
SET tabs = jsonb_set(COALESCE(tabs, '{}'::jsonb), '{comissoes_socios}', 'true'::jsonb, true)
WHERE email IN ('paulo@advocaciacbc.com', 'bruno@advocaciacbc.com');

-- ─────────────────────────────────────────────────────────────
-- PARTE 2: Colunas novas em contratos (campos de venda)
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='pasta') THEN
    ALTER TABLE contratos ADD COLUMN pasta text CHECK (pasta IN ('bruno_1','bruno_2','paulo_2') OR pasta IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='vendedora_email') THEN
    ALTER TABLE contratos ADD COLUMN vendedora_email text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='assistente_email') THEN
    ALTER TABLE contratos ADD COLUMN assistente_email text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='agenda_marcada') THEN
    ALTER TABLE contratos ADD COLUMN agenda_marcada boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='fim_de_semana_atendimento') THEN
    ALTER TABLE contratos ADD COLUMN fim_de_semana_atendimento boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='promocao_sazonal_id') THEN
    ALTER TABLE contratos ADD COLUMN promocao_sazonal_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='advbox_stage') THEN
    ALTER TABLE contratos ADD COLUMN advbox_stage text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='advbox_step') THEN
    ALTER TABLE contratos ADD COLUMN advbox_step text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='kanban_col') THEN
    ALTER TABLE contratos ADD COLUMN kanban_col text DEFAULT 'novo_lead';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contratos' AND column_name='valor_pago_cota') THEN
    ALTER TABLE contratos ADD COLUMN valor_pago_cota numeric DEFAULT 0;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contratos_vendedora ON contratos(vendedora_email);
CREATE INDEX IF NOT EXISTS idx_contratos_kanban_col ON contratos(kanban_col);
CREATE INDEX IF NOT EXISTS idx_contratos_pasta ON contratos(pasta);

-- ─────────────────────────────────────────────────────────────
-- PARTE 3: Catalogo de tipos de documentos
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_documentos_tipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  descricao text,
  categoria text, -- 'identidade', 'resort', 'financeiro', 'processual'
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Seeds iniciais (admin pode editar depois)
INSERT INTO vendas_documentos_tipos (nome, categoria, descricao) VALUES
  ('RG', 'identidade', 'Documento de identidade'),
  ('CPF', 'identidade', 'Cadastro de Pessoa Fisica'),
  ('Comprovante de Residencia', 'identidade', 'Conta recente no nome'),
  ('Certidao de Casamento', 'identidade', 'Para casados/divorciados'),
  ('Contrato de Compra Cota', 'resort', 'Contrato original com resort'),
  ('Extrato de Pagamento', 'resort', 'Historico pagamentos ao resort'),
  ('Prints WhatsApp Pedido Extrato', 'resort', 'Comprovacao tentativa obter extrato'),
  ('Boletos Pagos', 'resort', 'Ultimos boletos pagos do resort'),
  ('Email Resort', 'resort', 'Correspondencia com resort'),
  ('Comprovante Taxas', 'resort', 'Taxa manutencao, IPTU, etc.'),
  ('Guia Custas Paga', 'processual', 'Comprovante pagamento custas'),
  ('Procuracao Assinada', 'processual', 'Procuracao ad judicia')
ON CONFLICT (nome) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- PARTE 4: Requisitos de documentos por resort+tipo_acao
-- ─────────────────────────────────────────────────────────────

-- Regra PADRAO: resort = '*' (coringa), tipo_acao = '*' ou especifico
-- Regra ESPECIFICA: resort+tipo especifico, herda do padrao mas pode override
CREATE TABLE IF NOT EXISTS vendas_documentos_requisitos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort text NOT NULL,          -- '*' = padrao aplicavel a todos
  tipo_acao text NOT NULL,       -- '*' = qualquer tipo; ou 'Rescisao', 'Cobranca', etc.
  documento_tipo_id uuid REFERENCES vendas_documentos_tipos(id) ON DELETE CASCADE,
  obrigatoriedade text NOT NULL CHECK (obrigatoriedade IN ('obrigatorio','opcional','condicional')),
  condicao_doc_faltante_id uuid REFERENCES vendas_documentos_tipos(id), -- se este doc estiver faltando, o requisito atual vira obrigatorio
  condicao_descricao text,
  ordem integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (resort, tipo_acao, documento_tipo_id)
);

CREATE INDEX IF NOT EXISTS idx_vendas_doc_req_resort_tipo ON vendas_documentos_requisitos(resort, tipo_acao);

-- ─────────────────────────────────────────────────────────────
-- PARTE 5: Documentos enviados por cliente (uploads)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_documentos_enviados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid REFERENCES contratos(id) ON DELETE CASCADE,
  documento_tipo_id uuid REFERENCES vendas_documentos_tipos(id),
  arquivo_url text,
  arquivo_nome text,
  enviado_por text NOT NULL,     -- email do usuario que subiu
  enviado_em timestamptz DEFAULT now(),
  validado_por text,             -- email do operacional que validou
  validado_em timestamptz,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','validado','rejeitado')),
  observacao text
);

CREATE INDEX IF NOT EXISTS idx_vendas_doc_env_contrato ON vendas_documentos_enviados(contrato_id);

-- ─────────────────────────────────────────────────────────────
-- PARTE 6: Guias de custas processuais
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_guias_custas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid REFERENCES contratos(id) ON DELETE CASCADE,
  valor numeric NOT NULL,
  emitida_em date,
  enviada_cliente_em timestamptz,
  enviada_por text,              -- email vendedora/assistente
  paga_em date,
  comprovante_url text,
  comprovante_nome text,
  juntada_em timestamptz,        -- quando vendedora confirma que salvou na pasta
  juntada_por text,
  advbox_task_id text,           -- id da task criada no ADVBOX p/ operacional
  observacao text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendas_guias_contrato ON vendas_guias_custas(contrato_id);

-- ─────────────────────────────────────────────────────────────
-- PARTE 7: Regras de comissao (faixas)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_comissao_regras (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- row unica
  -- faixas por # contratos no mes → valor R$ por contrato
  faixas_iniciais jsonb NOT NULL DEFAULT '[
    {"min":1,"max":20,"valor":90},
    {"min":21,"max":40,"valor":100},
    {"min":41,"max":60,"valor":110},
    {"min":61,"max":null,"valor":120}
  ]',
  faixas_exito jsonb NOT NULL DEFAULT '[
    {"min":1,"max":20,"valor":20},
    {"min":21,"max":40,"valor":30},
    {"min":41,"max":60,"valor":40},
    {"min":61,"max":null,"valor":50}
  ]',
  multiplicador_fim_semana numeric NOT NULL DEFAULT 2.0,
  bonus_contratos_threshold integer NOT NULL DEFAULT 100,
  bonus_valor numeric NOT NULL DEFAULT 1000.0,
  split_vendedora_pct numeric NOT NULL DEFAULT 0.70,
  split_assistente_pct numeric NOT NULL DEFAULT 0.30,
  periodo_inicio_dia integer NOT NULL DEFAULT 20,  -- dia do mes que comeca periodo
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

INSERT INTO vendas_comissao_regras (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- PARTE 8: Promocoes sazonais
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_promocoes_sazonais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  -- regra: "contratos so-exito contam como iniciais+exito" OU multiplicador direto
  regra jsonb NOT NULL DEFAULT '{"tipo":"equiparar_exito_iniciais"}',
  -- filtros opcionais
  resort_filtro text,          -- null = todos
  tipo_acao_filtro text,       -- null = todos
  ativo boolean DEFAULT true,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_promo_datas ON vendas_promocoes_sazonais(data_inicio, data_fim, ativo);

-- ─────────────────────────────────────────────────────────────
-- PARTE 9: Metas individuais por vendedora
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_email text NOT NULL,
  periodo_inicio date NOT NULL,   -- dia 20 do mes anterior
  periodo_fim date NOT NULL,      -- dia 19 do mes corrente
  meta_contratos integer,
  meta_valor_brl numeric,
  observacao text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (vendedora_email, periodo_inicio)
);

CREATE INDEX IF NOT EXISTS idx_vendas_metas_vendedora ON vendas_metas(vendedora_email);

-- ─────────────────────────────────────────────────────────────
-- PARTE 10: Comissoes calculadas (cache mensal)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_comissoes_mensais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_email text NOT NULL,
  assistente_email text,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  contratos_count integer DEFAULT 0,
  contratos_iniciais_count integer DEFAULT 0,
  contratos_exito_count integer DEFAULT 0,
  contratos_fds_count integer DEFAULT 0,    -- fins de semana
  peso_total numeric DEFAULT 0,              -- soma ponderada (fds=2, sazonal=2)
  bonus_100_aplicado boolean DEFAULT false,
  subtotal_iniciais numeric DEFAULT 0,
  subtotal_exito numeric DEFAULT 0,
  subtotal_bonus numeric DEFAULT 0,
  total_bruto numeric DEFAULT 0,
  valor_vendedora numeric DEFAULT 0,        -- 70% do bruto + bonus
  valor_assistente numeric DEFAULT 0,       -- 30% do bruto + bonus
  status text DEFAULT 'calculada' CHECK (status IN ('calculada','paga','revisao')),
  calculada_em timestamptz DEFAULT now(),
  paga_em timestamptz,
  paga_por text,
  detalhes jsonb,                           -- backup completo do calculo
  UNIQUE (vendedora_email, periodo_inicio)
);

CREATE INDEX IF NOT EXISTS idx_comissoes_periodo ON vendas_comissoes_mensais(periodo_inicio, periodo_fim);

-- ─────────────────────────────────────────────────────────────
-- PARTE 11: Detalhe por contrato dentro da comissao
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_comissoes_detalhe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comissao_id uuid REFERENCES vendas_comissoes_mensais(id) ON DELETE CASCADE,
  contrato_id uuid REFERENCES contratos(id),
  tipo_comissao text NOT NULL CHECK (tipo_comissao IN ('iniciais','exito')),
  faixa_aplicada text,                      -- ex: "41-60"
  valor_base numeric NOT NULL,              -- ex: 110
  fim_de_semana boolean DEFAULT false,
  promocao_sazonal_id uuid,
  peso_aplicado numeric DEFAULT 1.0,        -- 1.0 ou 2.0 (fds) ou multiplicador sazonal
  valor_final numeric NOT NULL,             -- valor_base * peso
  elegivel boolean DEFAULT true,
  motivo_inelegivel text
);

CREATE INDEX IF NOT EXISTS idx_comissoes_det_comissao ON vendas_comissoes_detalhe(comissao_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_det_contrato ON vendas_comissoes_detalhe(contrato_id);

-- ─────────────────────────────────────────────────────────────
-- PARTE 12: Expectativa de honorarios (tabela de referencia)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_expectativa_honorarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort text NOT NULL,
  tipo_acao text NOT NULL,
  valor_medio_sentenca numeric,      -- R$ esperado na sentenca
  percentual_praticado numeric,      -- % do exito tipico
  tempo_medio_meses integer,         -- tempo ate sentenca
  observacao text,
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  UNIQUE (resort, tipo_acao)
);

-- ─────────────────────────────────────────────────────────────
-- PARTE 13: Mapeamento ADVBOX stage/step → coluna kanban
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_advbox_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,            -- ex: 'Negociacao', 'Judicial'
  step text NOT NULL,             -- ex: 'Fazer Inicial - Operacional'
  kanban_col text NOT NULL CHECK (kanban_col IN (
    'novo_lead','aguardando_assinatura','aguardando_documentos',
    'enviado_operacional','distribuido','aguardando_guia','guia_juntada'
  )),
  ordem integer DEFAULT 0,
  UNIQUE (stage, step)
);

-- Seeds conforme a estrutura do ADVBOX do CBC
INSERT INTO vendas_advbox_mapping (stage, step, kanban_col, ordem) VALUES
  ('Negociacao', 'Fazer Inicial - Operacional', 'enviado_operacional', 1),
  ('Negociacao', 'Documentacao Faltando - Vai...', 'aguardando_documentos', 2),
  ('Negociacao', 'Revisao Inicial', 'enviado_operacional', 3),
  ('Negociacao', 'EMITIR GUIA ANTES DA DISTRIBUI...', 'distribuido', 4),
  ('Negociacao', 'Distribuir Acao', 'distribuido', 5),
  ('Judicial', 'Aguardando citacao', 'guia_juntada', 6),
  ('Judicial', 'Aguardando Citacao', 'guia_juntada', 7)
ON CONFLICT (stage, step) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- PARTE 14: Leads rapidos (linha "Novo Lead" do kanban)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas_leads_rapidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_email text NOT NULL,
  assistente_email text,
  nome text NOT NULL,
  telefone text,
  chatguru_link text,
  observacao text,
  convertido_contrato_id uuid REFERENCES contratos(id),
  convertido_em timestamptz,
  arquivado boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_leads_vendedora ON vendas_leads_rapidos(vendedora_email, arquivado);

-- ─────────────────────────────────────────────────────────────
-- PARTE 15: RLS policies (acesso autenticado)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE vendas_documentos_tipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_documentos_requisitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_documentos_enviados ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_guias_custas ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_comissao_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_promocoes_sazonais ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_comissoes_mensais ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_comissoes_detalhe ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_expectativa_honorarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_advbox_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_leads_rapidos ENABLE ROW LEVEL SECURITY;

-- Policies abertas para auth (RLS mais granular pode vir depois)
DROP POLICY IF EXISTS "auth_all" ON vendas_documentos_tipos;
CREATE POLICY "auth_all" ON vendas_documentos_tipos FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_documentos_requisitos;
CREATE POLICY "auth_all" ON vendas_documentos_requisitos FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_documentos_enviados;
CREATE POLICY "auth_all" ON vendas_documentos_enviados FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_guias_custas;
CREATE POLICY "auth_all" ON vendas_guias_custas FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_comissao_regras;
CREATE POLICY "auth_all" ON vendas_comissao_regras FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_promocoes_sazonais;
CREATE POLICY "auth_all" ON vendas_promocoes_sazonais FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_metas;
CREATE POLICY "auth_all" ON vendas_metas FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_comissoes_mensais;
CREATE POLICY "auth_all" ON vendas_comissoes_mensais FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_comissoes_detalhe;
CREATE POLICY "auth_all" ON vendas_comissoes_detalhe FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_expectativa_honorarios;
CREATE POLICY "auth_all" ON vendas_expectativa_honorarios FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_advbox_mapping;
CREATE POLICY "auth_all" ON vendas_advbox_mapping FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "auth_all" ON vendas_leads_rapidos;
CREATE POLICY "auth_all" ON vendas_leads_rapidos FOR ALL USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────
-- PARTE 16: Trigger updated_at
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vendas_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_vendas_guias_updated_at ON vendas_guias_custas;
CREATE TRIGGER tr_vendas_guias_updated_at BEFORE UPDATE ON vendas_guias_custas
FOR EACH ROW EXECUTE FUNCTION vendas_touch_updated_at();

DROP TRIGGER IF EXISTS tr_vendas_req_updated_at ON vendas_documentos_requisitos;
CREATE TRIGGER tr_vendas_req_updated_at BEFORE UPDATE ON vendas_documentos_requisitos
FOR EACH ROW EXECUTE FUNCTION vendas_touch_updated_at();

DROP TRIGGER IF EXISTS tr_vendas_leads_updated_at ON vendas_leads_rapidos;
CREATE TRIGGER tr_vendas_leads_updated_at BEFORE UPDATE ON vendas_leads_rapidos
FOR EACH ROW EXECUTE FUNCTION vendas_touch_updated_at();

-- =============================================================
-- FIM DO SCRIPT — executar uma vez no Supabase SQL Editor.
-- Apos executar:
-- 1. Configurar dupla Mariana-Ana:
--    UPDATE user_permissions SET perfil_vendas='vendedora' WHERE email='marianamaciel@advocaciacbc.com';
--    UPDATE user_permissions SET perfil_vendas='assistente', vendedora_parceira_email='marianamaciel@advocaciacbc.com' WHERE email='anacristina@advocaciacbc.com';
--    UPDATE user_permissions SET tabs = jsonb_set(tabs, '{vendas}', 'true'::jsonb, true) WHERE email IN ('marianamaciel@advocaciacbc.com','anacristina@advocaciacbc.com');
-- 2. Acessar aba "Parametrizacao de Vendas" para definir docs padrao.
-- =============================================================
