-- =====================================================
-- CBC TESES — Schema completo
-- Sistema de gestão de modelos e geração de petições
-- =====================================================
-- Execute no Supabase SQL Editor.
-- Depende do schema auth padrão do Supabase (auth.users).
-- =====================================================

-- Extensões úteis
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================
-- 1. profiles (complementa auth.users)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'coordenador', 'especialista', 'operacional')),
  avatar_url TEXT,
  themes TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- =====================================================
-- 2. themes (temas jurídicos)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  color TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_themes_active ON public.themes(is_active, display_order);

-- =====================================================
-- 3. models (modelos de petição)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id UUID NOT NULL REFERENCES public.themes(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'em_revisao', 'aprovado', 'obsoleto')),
  version INT NOT NULL DEFAULT 1,
  parent_version_id UUID REFERENCES public.models(id),

  fixed_header TEXT,
  fixed_footer TEXT,
  requires_resort_data BOOLEAN DEFAULT true,
  requires_calculation BOOLEAN DEFAULT false,

  trigger_movements TEXT[] DEFAULT '{}',
  trigger_keywords TEXT[] DEFAULT '{}',

  imported_file_url TEXT,

  created_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  review_comments TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_models_theme ON public.models(theme_id);
CREATE INDEX IF NOT EXISTS idx_models_status ON public.models(status);
CREATE INDEX IF NOT EXISTS idx_models_name_trgm ON public.models USING gin (name gin_trgm_ops);

-- =====================================================
-- 4. model_blocks (blocos modulares)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.model_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,

  content TEXT NOT NULL DEFAULT '',
  content_type TEXT DEFAULT 'rich_text' CHECK (content_type IN ('rich_text', 'imported_docx')),

  is_required BOOLEAN DEFAULT false,
  is_default_selected BOOLEAN DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  group_name TEXT,

  mutually_exclusive_group TEXT,
  depends_on_block_id UUID REFERENCES public.model_blocks(id),

  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blocks_model ON public.model_blocks(model_id, display_order);

-- =====================================================
-- 5. placeholders (campos variáveis)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.placeholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,

  key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'text', 'textarea', 'number', 'currency', 'date', 'select', 'multi_select'
  )),

  auto_source TEXT CHECK (auto_source IN (
    'advbox_customer_name', 'advbox_customer_cpf', 'advbox_customer_cnpj',
    'advbox_process_number', 'advbox_process_type', 'advbox_process_stage',
    'advbox_responsible', 'advbox_folder',
    'datajud_classe', 'datajud_assunto', 'datajud_vara', 'datajud_comarca',
    'datajud_juiz', 'datajud_data_distribuicao',
    'resort_razao_social', 'resort_cnpj', 'resort_endereco', 'resort_grupo',
    'resort_empresas_grupo', 'resort_argumentos_defesa', 'resort_contra_argumentos',
    'manual'
  )),

  is_required BOOLEAN DEFAULT true,
  default_value TEXT,
  options JSONB,
  validation_regex TEXT,
  help_text TEXT,

  display_order INT DEFAULT 0,

  UNIQUE(model_id, key)
);

CREATE INDEX IF NOT EXISTS idx_placeholders_model ON public.placeholders(model_id, display_order);

-- =====================================================
-- 6. resorts (fichas de resort / grupo econômico)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.resorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  trade_name TEXT NOT NULL,
  legal_name TEXT,
  cnpj TEXT,
  address TEXT,
  city TEXT,
  state TEXT,

  category TEXT NOT NULL DEFAULT 'principal' CHECK (category IN ('principal', 'pontual')),
  economic_group TEXT,

  typical_defense_arguments JSONB DEFAULT '[]',
  cbc_counter_arguments JSONB DEFAULT '[]',
  favorable_precedents JSONB DEFAULT '[]',
  procedural_behavior JSONB DEFAULT '{}',

  internal_notes TEXT,

  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resorts_category ON public.resorts(category);
CREATE INDEX IF NOT EXISTS idx_resorts_economic_group ON public.resorts(economic_group);
CREATE INDEX IF NOT EXISTS idx_resorts_trade_trgm ON public.resorts USING gin (trade_name gin_trgm_ops);

-- =====================================================
-- 7. resort_companies (empresas do grupo econômico)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.resort_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id UUID NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,

  legal_name TEXT NOT NULL,
  cnpj TEXT,
  company_type TEXT CHECK (company_type IN ('holding', 'spe', 'securitizadora', 'operadora', 'incorporadora', 'administradora', 'outra')),
  relationship_description TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resort_companies_resort ON public.resort_companies(resort_id);

-- =====================================================
-- 8. generated_petitions (petições geradas)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.generated_petitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  model_id UUID NOT NULL REFERENCES public.models(id),
  model_version INT NOT NULL,
  resort_id UUID REFERENCES public.resorts(id),
  generated_by UUID NOT NULL REFERENCES public.profiles(id),

  process_number TEXT,
  advbox_lawsuit_id INT,
  customer_name TEXT,
  customer_identification TEXT,

  selected_blocks UUID[] DEFAULT '{}',
  block_order UUID[] DEFAULT '{}',
  filled_placeholders JSONB DEFAULT '{}',

  docx_file_url TEXT,
  pdf_file_url TEXT,

  advbox_task_created BOOLEAN DEFAULT false,
  advbox_task_id INT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generated_model ON public.generated_petitions(model_id);
CREATE INDEX IF NOT EXISTS idx_generated_user ON public.generated_petitions(generated_by);
CREATE INDEX IF NOT EXISTS idx_generated_process ON public.generated_petitions(process_number);
CREATE INDEX IF NOT EXISTS idx_generated_date ON public.generated_petitions(created_at DESC);

-- =====================================================
-- 9. model_versions (histórico de versões)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.model_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  version_number INT NOT NULL,

  snapshot JSONB NOT NULL,

  change_description TEXT,
  changed_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(model_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_versions_model ON public.model_versions(model_id, version_number DESC);

-- =====================================================
-- 10. notifications
-- =====================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (type IN (
    'model_submitted',
    'model_approved',
    'model_rejected',
    'model_updated',
    'model_obsoleted',
    'resort_updated'
  )),

  title TEXT NOT NULL,
  message TEXT,
  reference_type TEXT,
  reference_id UUID,

  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(recipient_id) WHERE is_read = false;

-- =====================================================
-- Triggers: atualizar updated_at automaticamente
-- =====================================================
CREATE OR REPLACE FUNCTION public.tg_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','themes','models','model_blocks','placeholders','resorts','resort_companies']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_%s_updated_at ON public.%s', t, t);
    EXECUTE format('CREATE TRIGGER tg_%s_updated_at BEFORE UPDATE ON public.%s FOR EACH ROW EXECUTE FUNCTION public.tg_update_updated_at()', t, t);
  END LOOP;
END $$;

-- =====================================================
-- Helper: verifica role do usuário corrente
-- =====================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.current_user_is(roles TEXT[])
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = ANY(roles)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =====================================================
-- Row Level Security
-- =====================================================

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_read ON public.profiles;
CREATE POLICY profiles_read ON public.profiles
  FOR SELECT USING (true);
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id OR public.current_user_is(ARRAY['admin']));
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE USING (auth.uid() = id OR public.current_user_is(ARRAY['admin']));

-- themes
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS themes_read ON public.themes;
CREATE POLICY themes_read ON public.themes FOR SELECT USING (true);
DROP POLICY IF EXISTS themes_write ON public.themes;
CREATE POLICY themes_write ON public.themes FOR ALL
  USING (public.current_user_is(ARRAY['admin','coordenador']))
  WITH CHECK (public.current_user_is(ARRAY['admin','coordenador']));

-- models
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS models_read ON public.models;
CREATE POLICY models_read ON public.models FOR SELECT USING (true);
DROP POLICY IF EXISTS models_insert ON public.models;
CREATE POLICY models_insert ON public.models FOR INSERT
  WITH CHECK (public.current_user_is(ARRAY['admin','coordenador','especialista']));
DROP POLICY IF EXISTS models_update ON public.models;
CREATE POLICY models_update ON public.models FOR UPDATE
  USING (
    public.current_user_is(ARRAY['admin','coordenador'])
    OR (public.current_user_is(ARRAY['especialista']) AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS models_delete ON public.models;
CREATE POLICY models_delete ON public.models FOR DELETE
  USING (public.current_user_is(ARRAY['admin','coordenador']));

-- model_blocks
ALTER TABLE public.model_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blocks_read ON public.model_blocks;
CREATE POLICY blocks_read ON public.model_blocks FOR SELECT USING (true);
DROP POLICY IF EXISTS blocks_write ON public.model_blocks;
CREATE POLICY blocks_write ON public.model_blocks FOR ALL
  USING (
    public.current_user_is(ARRAY['admin','coordenador'])
    OR EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = model_blocks.model_id
        AND m.created_by = auth.uid()
        AND public.current_user_is(ARRAY['especialista'])
    )
  )
  WITH CHECK (
    public.current_user_is(ARRAY['admin','coordenador'])
    OR EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = model_blocks.model_id
        AND m.created_by = auth.uid()
        AND public.current_user_is(ARRAY['especialista'])
    )
  );

-- placeholders
ALTER TABLE public.placeholders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS placeholders_read ON public.placeholders;
CREATE POLICY placeholders_read ON public.placeholders FOR SELECT USING (true);
DROP POLICY IF EXISTS placeholders_write ON public.placeholders;
CREATE POLICY placeholders_write ON public.placeholders FOR ALL
  USING (
    public.current_user_is(ARRAY['admin','coordenador'])
    OR EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = placeholders.model_id
        AND m.created_by = auth.uid()
        AND public.current_user_is(ARRAY['especialista'])
    )
  )
  WITH CHECK (
    public.current_user_is(ARRAY['admin','coordenador'])
    OR EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = placeholders.model_id
        AND m.created_by = auth.uid()
        AND public.current_user_is(ARRAY['especialista'])
    )
  );

-- resorts
ALTER TABLE public.resorts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resorts_read ON public.resorts;
CREATE POLICY resorts_read ON public.resorts FOR SELECT USING (true);
DROP POLICY IF EXISTS resorts_write ON public.resorts;
CREATE POLICY resorts_write ON public.resorts FOR ALL
  USING (public.current_user_is(ARRAY['admin','coordenador']))
  WITH CHECK (public.current_user_is(ARRAY['admin','coordenador']));

-- resort_companies
ALTER TABLE public.resort_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resort_companies_read ON public.resort_companies;
CREATE POLICY resort_companies_read ON public.resort_companies FOR SELECT USING (true);
DROP POLICY IF EXISTS resort_companies_write ON public.resort_companies;
CREATE POLICY resort_companies_write ON public.resort_companies FOR ALL
  USING (public.current_user_is(ARRAY['admin','coordenador']))
  WITH CHECK (public.current_user_is(ARRAY['admin','coordenador']));

-- generated_petitions
ALTER TABLE public.generated_petitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS petitions_read ON public.generated_petitions;
CREATE POLICY petitions_read ON public.generated_petitions FOR SELECT
  USING (
    generated_by = auth.uid()
    OR public.current_user_is(ARRAY['admin','coordenador'])
  );
DROP POLICY IF EXISTS petitions_insert ON public.generated_petitions;
CREATE POLICY petitions_insert ON public.generated_petitions FOR INSERT
  WITH CHECK (generated_by = auth.uid());

-- model_versions
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS versions_read ON public.model_versions;
CREATE POLICY versions_read ON public.model_versions FOR SELECT USING (true);
DROP POLICY IF EXISTS versions_write ON public.model_versions;
CREATE POLICY versions_write ON public.model_versions FOR INSERT
  WITH CHECK (public.current_user_is(ARRAY['admin','coordenador','especialista']));

-- notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_read ON public.notifications;
CREATE POLICY notifications_read ON public.notifications FOR SELECT
  USING (recipient_id = auth.uid());
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE
  USING (recipient_id = auth.uid());
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications FOR INSERT
  WITH CHECK (true);

-- =====================================================
-- Storage buckets (execute manualmente no dashboard
-- ou via cliente admin caso prefira):
--   - teses-models       (DOCX importados)
--   - teses-generated    (petições geradas)
--   - teses-assets       (timbrado, logos)
-- =====================================================
