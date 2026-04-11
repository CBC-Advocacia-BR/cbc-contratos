-- =====================================================
-- CBC TESES — Seed inicial
-- Temas jurídicos padrão + ficha-modelo de resort vazia
-- =====================================================

-- Temas (idempotente via ON CONFLICT)
INSERT INTO public.themes (name, description, icon, color, display_order) VALUES
  ('Petição Inicial (Rescisão de Multipropriedade)', 'Ação de rescisão contratual com restituição de valores', 'FileText', '#1B3A5C', 10),
  ('Petição de Provas', 'Especificação e requerimento de provas', 'ClipboardList', '#1B3A5C', 20),
  ('Agravo de Instrumento — Conflito de Competência', 'Agravo para discussão de competência', 'Scale', '#B45309', 30),
  ('Agravo de Instrumento — Suspensão de Parcelas', 'Agravo para suspensão de cobranças', 'PauseCircle', '#B45309', 40),
  ('Apelação', 'Recurso de apelação', 'ArrowUpCircle', '#6D28D9', 50),
  ('Cumprimento de Sentença', 'Peças de cumprimento de sentença', 'CheckCircle', '#047857', 60),
  ('Impugnação a Exceção de Pré-Executividade', 'Impugnação a exceção oposta em execução', 'ShieldAlert', '#B91C1C', 70),
  ('Pedido de SISBAJUD / Teimosinha', 'Pedido de bloqueio via SISBAJUD com reiteração', 'Banknote', '#047857', 80),
  ('IDPJ', 'Incidente de Desconsideração da Personalidade Jurídica', 'GitBranch', '#B45309', 90),
  ('Contrarrazões a Embargos de Declaração', 'Contrarrazões em embargos', 'MessageSquareReply', '#1B3A5C', 100),
  ('Contrarrazões a Apelação', 'Contrarrazões recursais', 'MessageSquareReply', '#1B3A5C', 110),
  ('Manifestação contra Parcelamento (art. 916 CPC)', 'Oposição ao pedido de parcelamento em execução', 'XCircle', '#B91C1C', 120),
  ('Réplica em IDPJ', 'Réplica no incidente de desconsideração', 'Reply', '#6D28D9', 130),
  ('Pedido de Penhora', 'Requerimento de penhora de bens', 'Anchor', '#047857', 140),
  ('Habilitação de Crédito', 'Habilitação de crédito em recuperação/falência', 'ListChecks', '#6D28D9', 150),
  ('Embargos de Declaração', 'Oposição de embargos declaratórios', 'AlertCircle', '#B45309', 160),
  ('Manifestação Genérica', 'Manifestação processual de uso geral', 'FileEdit', '#6B7280', 170)
ON CONFLICT (name) DO NOTHING;

-- Ficha-modelo de resort em branco (serve como template para a coordenadora preencher)
INSERT INTO public.resorts (
  trade_name, legal_name, cnpj, category, economic_group,
  typical_defense_arguments, cbc_counter_arguments, favorable_precedents, procedural_behavior,
  internal_notes, is_active
)
SELECT
  '[MODELO] Nova ficha de resort', NULL, NULL, 'principal', NULL,
  '[{"argument":"(preencher argumento típico de defesa)","frequency":"frequente","legal_basis":""}]'::jsonb,
  '[{"defense_argument_ref":"","counter_argument":"(preencher contra-argumento consolidado)","legal_basis":"","success_rate":"alto"}]'::jsonb,
  '[{"tribunal":"","case_number":"","rapporteur":"","date":"","summary":"","theme":"","applicable_to":[]}]'::jsonb,
  '{"files_embargos":false,"requests_installments_916":false,"has_seizable_assets":false,"typical_response_time_days":null,"preferred_defense_strategy":"","observations":""}'::jsonb,
  'Ficha-modelo: duplique e preencha para cada novo resort / grupo econômico.',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.resorts WHERE trade_name = '[MODELO] Nova ficha de resort'
);
