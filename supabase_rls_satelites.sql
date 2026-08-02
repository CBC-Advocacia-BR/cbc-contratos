-- ============================================================================
-- supabase_rls_satelites.sql
-- Migracao `rls_satelites_cadastro_e_espelhos` — APLICADA em 01/08/2026.
-- (auditoria 01/08/2026 — itens 45/49/50, achado nº 1 do linter oficial do Supabase)
--
-- O QUE RESOLVE: 7 tabelas estavam com RLS DESLIGADA, ou seja, legiveis E GRAVAVEIS
-- por qualquer pessoa com a chave anonima do Supabase — que e publica por design
-- (vai dentro do JavaScript do site). Entre elas, 74 mil parcelas financeiras e 5 mil
-- telefones de clientes. A tabela-mae `clientes` tinha sido fechada quando o cadastro
-- unico nasceu; as satelites criadas depois ficaram de fora.
--
-- POR QUE NAO QUEBRA NADA (conferido antes de aplicar):
--   * o app nunca le nem escreve essas tabelas direto (varredura no src/ e netlify/);
--   * as escritas vem de funcoes SECURITY DEFINER (parcelas_ingest,
--     fn_kommo_pipelines_upsert, fn_kommo_lead_status_upsert) e de jobs pg_cron que
--     rodam como dono da tabela — ambos ignoram RLS;
--   * a unica view dependente, vw_noshow_acervo, e SECURITY DEFINER.
--
-- VALIDADO APOS APLICAR (SET ROLE):
--   anon          -> 0 linhas em todas (fechado)
--   authenticated -> 74.674 parcelas / 5.129 telefones / 16.165 status / 106 alias
--                    e vw_noshow_acervo com 615 linhas (intacta)
--
-- ⚠️ AINDA ABERTAS DE PROPOSITO (nao mexer sem antes resolver a causa):
--   bot_processed_messages, cron_heartbeat, health_history — as Netlify Functions
--   ESCREVEM nelas usando a chave anonima (porque SUPABASE_SERVICE_ROLE_KEY nunca foi
--   configurada). Fechar agora mataria o bot e todo o monitoramento. O caminho e:
--   (a) configurar a service role, ou (b) trocar essas escritas por RPC definer com
--   BOT_RPC_SECRET, como ja foi feito no espelho do Asaas.
-- ============================================================================

-- ── PII do cadastro unico ────────────────────────────────────────────────────
alter table public.cliente_parcelas  enable row level security;
alter table public.cliente_telefones enable row level security;

drop policy if exists cliente_parcelas_auth_read on public.cliente_parcelas;
create policy cliente_parcelas_auth_read on public.cliente_parcelas
  for select to authenticated using (true);

drop policy if exists cliente_telefones_auth_read on public.cliente_telefones;
create policy cliente_telefones_auth_read on public.cliente_telefones
  for select to authenticated using (true);

-- ── Espelhos do Kommo e dicionario de resorts ───────────────────────────────
-- Menos sensiveis, mas com RLS off o anon podia ENVENENA-LOS: alterar o status de um
-- lead no espelho ou o de-para de resort corrompe funil, monitor e reconciliacao.
alter table public.kommo_pipelines   enable row level security;
alter table public.kommo_lead_status enable row level security;
alter table public.resort_alias      enable row level security;

drop policy if exists kommo_pipelines_auth_read on public.kommo_pipelines;
create policy kommo_pipelines_auth_read on public.kommo_pipelines
  for select to authenticated using (true);

drop policy if exists kommo_lead_status_auth_read on public.kommo_lead_status;
create policy kommo_lead_status_auth_read on public.kommo_lead_status
  for select to authenticated using (true);

drop policy if exists resort_alias_auth_read on public.resort_alias;
create policy resort_alias_auth_read on public.resort_alias
  for select to authenticated using (true);

-- ── Backups da migracao de 28/07 (item 50) ──────────────────────────────────
-- Copias de seguranca do fix da dupla contagem de leads. Ninguem precisa le-las pela
-- API: RLS ligada e NENHUMA policy = fechadas para anon e authenticated (so o dono e o
-- service role acessam). Seguem disponiveis para auditoria via SQL.
alter table public._backup_meta_leads_20260728_mensal enable row level security;
alter table public._backup_meta_leads_20260728_diario enable row level security;

-- ── ROLLBACK (se algo inesperado quebrar) ───────────────────────────────────
-- alter table public.cliente_parcelas  disable row level security;
-- alter table public.cliente_telefones disable row level security;
-- alter table public.kommo_pipelines   disable row level security;
-- alter table public.kommo_lead_status disable row level security;
-- alter table public.resort_alias      disable row level security;
-- alter table public._backup_meta_leads_20260728_mensal disable row level security;
-- alter table public._backup_meta_leads_20260728_diario disable row level security;
