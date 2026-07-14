-- ============================================================================
-- Migração: meta_ads_leads (14/07/2026) — JÁ APLICADA via MCP apply_migration
-- Leads de campanhas Meta (insights mensais por campanha) = 1a etapa do funil.
-- Escrita: só via RPC meta_ads_upsert (security definer + BOT_RPC_SECRET),
-- mesmo padrão das asaas_mirror_*. Leitura: authenticated (aba Saúde do Funil).
-- Fonte: meta-ads-sync.mjs (cron diário 07h BRT) -> Graph API /act_.../insights
-- level=campaign, time_increment=monthly. "Lead" = conversas iniciadas
-- (onsite_conversion.messaging_conversation_started_7d) + lead forms.
-- ============================================================================
create table if not exists public.meta_ads_mensal (
  mes date not null,
  account_id text not null,
  campaign_id text not null,
  campaign_name text,
  conversas_iniciadas integer not null default 0,
  leads_form integer not null default 0,
  gasto numeric(14,2) not null default 0,
  impressoes bigint not null default 0,
  cliques bigint not null default 0,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (mes, account_id, campaign_id)
);

alter table public.meta_ads_mensal enable row level security;

drop policy if exists meta_ads_mensal_read on public.meta_ads_mensal;
create policy meta_ads_mensal_read on public.meta_ads_mensal
  for select to authenticated using (true);

create or replace function public.meta_ads_upsert(p_chave text, p_linhas jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  r jsonb;
begin
  if not _bot_chave_ok(p_chave) then
    raise exception 'acesso negado';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    insert into meta_ads_mensal (mes, account_id, campaign_id, campaign_name, conversas_iniciadas, leads_form, gasto, impressoes, cliques, raw, synced_at)
    values (
      (r->>'mes')::date,
      r->>'account_id',
      r->>'campaign_id',
      nullif(r->>'campaign_name',''),
      coalesce((r->>'conversas_iniciadas')::integer, 0),
      coalesce((r->>'leads_form')::integer, 0),
      coalesce((r->>'gasto')::numeric, 0),
      coalesce((r->>'impressoes')::bigint, 0),
      coalesce((r->>'cliques')::bigint, 0),
      r->'raw',
      now()
    )
    on conflict (mes, account_id, campaign_id) do update set
      campaign_name = coalesce(excluded.campaign_name, meta_ads_mensal.campaign_name),
      conversas_iniciadas = excluded.conversas_iniciadas,
      leads_form = excluded.leads_form,
      gasto = excluded.gasto,
      impressoes = excluded.impressoes,
      cliques = excluded.cliques,
      raw = excluded.raw,
      synced_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.meta_ads_upsert(text, jsonb) from public;
grant execute on function public.meta_ads_upsert(text, jsonb) to anon, authenticated;
