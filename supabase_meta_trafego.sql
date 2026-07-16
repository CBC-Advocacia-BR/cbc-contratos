-- ============================================================================
-- Migração: meta_trafego (14/07/2026) — JÁ APLICADA via MCP apply_migration
-- Aba Tráfego: espelho operacional Meta Ads (catálogos + métricas diárias).
-- Escrita só via RPC meta_trafego_upsert (security definer + BOT_RPC_SECRET);
-- leitura das séries p/ alertas via meta_trafego_series. Leitura das tabelas:
-- authenticated (aba RBAC-gated por user_permissions.tabs.trafego).
-- Fonte: meta-trafego-sync.mjs (cron 07h10 BRT; ?hoje=1; ?backfill=1&dias=N).
-- Spec: docs/superpowers/specs/2026-07-14-aba-trafego-pago-design.md
-- ============================================================================

create table if not exists public.meta_campanhas (
  campaign_id text primary key,
  account_id text not null,
  nome text,
  status text,
  objetivo text,
  orcamento_diario numeric(12,2),
  updated_at timestamptz not null default now(),
  raw jsonb
);

create table if not exists public.meta_anuncios (
  ad_id text primary key,
  campaign_id text not null,
  account_id text not null,
  nome text,
  status text,
  thumbnail_url text,
  permalink text,
  updated_at timestamptz not null default now(),
  raw jsonb
);

create table if not exists public.meta_ads_diario (
  dia date not null,
  level text not null check (level in ('campaign','ad')),
  entity_id text not null,
  campaign_id text not null,
  account_id text not null,
  gasto numeric(12,2) not null default 0,
  conversas_iniciadas integer not null default 0,
  leads_form integer not null default 0,
  impressoes bigint not null default 0,
  alcance bigint not null default 0,
  cliques bigint not null default 0,
  cliques_link bigint not null default 0,
  frequencia numeric(8,3),
  video_3s bigint not null default 0,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (dia, level, entity_id)
);

create index if not exists meta_ads_diario_campanha_idx on public.meta_ads_diario (campaign_id, dia);

alter table public.meta_campanhas enable row level security;
alter table public.meta_anuncios enable row level security;
alter table public.meta_ads_diario enable row level security;

drop policy if exists meta_campanhas_read on public.meta_campanhas;
create policy meta_campanhas_read on public.meta_campanhas for select to authenticated using (true);
drop policy if exists meta_anuncios_read on public.meta_anuncios;
create policy meta_anuncios_read on public.meta_anuncios for select to authenticated using (true);
drop policy if exists meta_ads_diario_read on public.meta_ads_diario;
create policy meta_ads_diario_read on public.meta_ads_diario for select to authenticated using (true);

-- Upsert dos 3 conjuntos numa chamada; p_limpar apaga diario com mais de 400 dias.
create or replace function public.meta_trafego_upsert(
  p_chave text, p_campanhas jsonb default '[]', p_anuncios jsonb default '[]',
  p_diario jsonb default '[]', p_limpar boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  n_camp integer := 0; n_ads integer := 0; n_dia integer := 0; n_del integer := 0;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_campanhas,'[]'::jsonb)) loop
    insert into meta_campanhas (campaign_id, account_id, nome, status, objetivo, orcamento_diario, updated_at, raw)
    values (r->>'campaign_id', r->>'account_id', r->>'nome', r->>'status', r->>'objetivo',
            nullif(r->>'orcamento_diario','')::numeric, now(), r->'raw')
    on conflict (campaign_id) do update set
      account_id=excluded.account_id, nome=excluded.nome, status=excluded.status,
      objetivo=excluded.objetivo, orcamento_diario=excluded.orcamento_diario,
      updated_at=now(), raw=excluded.raw;
    n_camp := n_camp + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_anuncios,'[]'::jsonb)) loop
    insert into meta_anuncios (ad_id, campaign_id, account_id, nome, status, thumbnail_url, permalink, updated_at, raw)
    values (r->>'ad_id', r->>'campaign_id', r->>'account_id', r->>'nome', r->>'status',
            r->>'thumbnail_url', r->>'permalink', now(), r->'raw')
    on conflict (ad_id) do update set
      campaign_id=excluded.campaign_id, account_id=excluded.account_id, nome=excluded.nome,
      status=excluded.status, thumbnail_url=excluded.thumbnail_url, permalink=excluded.permalink,
      updated_at=now(), raw=excluded.raw;
    n_ads := n_ads + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_diario,'[]'::jsonb)) loop
    insert into meta_ads_diario (dia, level, entity_id, campaign_id, account_id, gasto, conversas_iniciadas,
      leads_form, impressoes, alcance, cliques, cliques_link, frequencia, video_3s, raw, synced_at)
    values ((r->>'dia')::date, r->>'level', r->>'entity_id', r->>'campaign_id', r->>'account_id',
      coalesce((r->>'gasto')::numeric,0), coalesce((r->>'conversas_iniciadas')::int,0),
      coalesce((r->>'leads_form')::int,0), coalesce((r->>'impressoes')::bigint,0),
      coalesce((r->>'alcance')::bigint,0), coalesce((r->>'cliques')::bigint,0),
      coalesce((r->>'cliques_link')::bigint,0), nullif(r->>'frequencia','')::numeric,
      coalesce((r->>'video_3s')::bigint,0), r->'raw', now())
    on conflict (dia, level, entity_id) do update set
      campaign_id=excluded.campaign_id, account_id=excluded.account_id, gasto=excluded.gasto,
      conversas_iniciadas=excluded.conversas_iniciadas, leads_form=excluded.leads_form,
      impressoes=excluded.impressoes, alcance=excluded.alcance, cliques=excluded.cliques,
      cliques_link=excluded.cliques_link, frequencia=excluded.frequencia,
      video_3s=excluded.video_3s, raw=excluded.raw, synced_at=now();
    n_dia := n_dia + 1;
  end loop;

  if p_limpar then
    delete from meta_ads_diario where dia < current_date - 400;
    get diagnostics n_del = row_count;
  end if;

  return jsonb_build_object('campanhas', n_camp, 'anuncios', n_ads, 'diario', n_dia, 'removidos', n_del);
end $$;

revoke all on function public.meta_trafego_upsert(text, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.meta_trafego_upsert(text, jsonb, jsonb, jsonb, boolean) to anon, authenticated;

-- Series p/ o motor de alertas (a function le sem abrir as tabelas ao anon).
create or replace function public.meta_trafego_series(p_chave text, p_dias integer default 28)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_conta jsonb;
  v_ontem jsonb;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;

  select coalesce(jsonb_agg(t order by t->>'dia'), '[]'::jsonb) into v_conta from (
    select jsonb_build_object('dia', dia, 'gasto', sum(gasto), 'leads', sum(conversas_iniciadas + leads_form)) as t
    from meta_ads_diario where level = 'campaign' and dia >= current_date - greatest(p_dias, 1)
    group by dia
  ) s;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_ontem from (
    select jsonb_build_object('campaign_id', d.campaign_id, 'nome', c.nome, 'status', c.status,
      'gasto', d.gasto, 'leads', d.conversas_iniciadas + d.leads_form) as t
    from meta_ads_diario d
    left join meta_campanhas c on c.campaign_id = d.campaign_id
    where d.level = 'campaign' and d.dia = current_date - 1
  ) s;

  return jsonb_build_object('conta', v_conta, 'ontem_campanhas', v_ontem);
end $$;

revoke all on function public.meta_trafego_series(text, integer) from public;
grant execute on function public.meta_trafego_series(text, integer) to anon, authenticated;

-- Permissao da aba: liga para o trio; demais usuarios ficam sem ate o admin liberar.
update public.user_permissions
set tabs = coalesce(tabs, '{}'::jsonb) || '{"trafego": true}'::jsonb
where lower(email) in ('paulo@advocaciacbc.com', 'bruno@advocaciacbc.com', 'lorenza@advocaciacbc.com');

-- ============================================================================
-- v2 (16/07/2026) — JÁ APLICADA via MCP (migração meta_trafego_v2), onda de 64
-- melhorias: colunas de retenção de vídeo (thruplay/p25..p100) no diário; level
-- 'adset' aceito; tabela meta_conjuntos; tabela meta_ads_breakdown (age_gender/
-- region/platform_position no nível da conta); meta_trafego_upsert ganha
-- p_conjuntos/p_breakdown; meta_trafego_series ganha criativos_14d (fadiga p/
-- alertas). Ver migração no histórico do Supabase para o SQL integral.
-- ============================================================================
