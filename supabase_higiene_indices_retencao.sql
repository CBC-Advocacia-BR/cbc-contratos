-- ============================================================================
-- supabase_higiene_indices_retencao.sql
-- Migracoes `higiene_indices_e_retencao_cbc` + `fix_cbc_cleanup_logs_extras_colunas`
-- APLICADAS em 01/08/2026 (auditoria — itens 57/58/59/60/61/64/77/78).
--
-- RESULTADO VALIDADO NO BANCO:
--   17 indices novos · 493 jobs concluidos limpos da fila Kommo
--   cron 'refresh-dashboard-stats' DESAGENDADO (recalculava uma MV orfa 288x/dia)
--   cron 'cbc-cleanup-logs-extras' agendado 06h40 UTC · user_views com 1 policy
--
-- ⚠️ LICAO: a 1a versao da funcao de limpeza usava `criado_em` no advbox_api_log
-- (a coluna real e `created_at`) e `updated_at` na kommo_queue (o certo e `done_at`).
-- So apareceu porque a funcao foi EXECUTADA logo apos criada — sem isso ela falharia
-- todo dia as 06h40 em silencio. Sempre rodar a funcao depois de agendar.
-- ============================================================================

-- item 64: coluna que liga contrato <-> processo (3 rotinas + view do funil) sem indice
create index if not exists idx_contratos_advbox_lawsuit_id
  on public.contratos (advbox_lawsuit_id) where advbox_lawsuit_id is not null;

-- item 61: 16 chaves estrangeiras sem indice de cobertura
create index if not exists idx_cliente_acoes_drive_eh_fase_de     on public.cliente_acoes_drive (eh_fase_de);
create index if not exists idx_cliente_parcelas_acao_id           on public.cliente_parcelas (acao_id);
create index if not exists idx_clientes_fundido_em                on public.clientes (fundido_em);
create index if not exists idx_contrato_comentarios_user_id       on public.contrato_comentarios (user_id);
create index if not exists idx_notifications_user_id              on public.notifications (user_id);
create index if not exists idx_portal_access_log_token_id         on public.portal_access_log (token_id);
create index if not exists idx_portal_tokens_escritorio_id        on public.portal_tokens (escritorio_id);
create index if not exists idx_user_reminders_contrato_id         on public.user_reminders (contrato_id);
create index if not exists idx_user_views_user_id                 on public.user_views (user_id);
create index if not exists idx_vendas_com_detalhe_comissao_id     on public.vendas_comissoes_detalhe (comissao_id);
create index if not exists idx_vendas_com_detalhe_contrato_id     on public.vendas_comissoes_detalhe (contrato_id);
create index if not exists idx_vendas_docs_env_contrato_id        on public.vendas_documentos_enviados (contrato_id);
create index if not exists idx_vendas_docs_env_tipo_id            on public.vendas_documentos_enviados (documento_tipo_id);
create index if not exists idx_vendas_docs_req_cond_id            on public.vendas_documentos_requisitos (condicao_doc_faltante_id);
create index if not exists idx_vendas_docs_req_tipo_id            on public.vendas_documentos_requisitos (documento_tipo_id);
create index if not exists idx_vendas_leads_rapidos_contrato_id   on public.vendas_leads_rapidos (convertido_contrato_id);

-- itens 57/58: MV orfa desde 12/06 — para de ser recalculada e sai da API publica
select cron.unschedule('refresh-dashboard-stats')
where exists (select 1 from cron.job where jobname='refresh-dashboard-stats');
revoke all on public.dashboard_stats from anon;

-- item 60: duas policies permissivas viram uma (mesmo efeito, metade da avaliacao)
drop policy if exists user_views_owner_all on public.user_views;
drop policy if exists user_views_shared_read on public.user_views;
create policy user_views_owner_all on public.user_views
  for all to authenticated
  using (user_id = (select auth.uid()) or coalesce(is_shared, false))
  with check (user_id = (select auth.uid()));

-- itens 77/78/59: retencao dos logs que mais crescem (search_path fixo)
create or replace function public.cbc_cleanup_logs_extras()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_out jsonb := '{}'::jsonb; v_n bigint;
begin
  delete from public.advbox_api_log where created_at < now() - interval '90 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('advbox_api_log', v_n);
  delete from public.health_history where checked_at < now() - interval '60 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('health_history', v_n);
  delete from public.kommo_queue
   where status = 'done' and coalesce(done_at, updated_at, created_at) < now() - interval '30 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('kommo_queue_done', v_n);
  delete from public.rate_limit_counters where window_start < now() - interval '2 hours';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('rate_limit_counters', v_n);
  return v_out;
end; $$;
revoke all on function public.cbc_cleanup_logs_extras() from anon, authenticated;
select cron.schedule('cbc-cleanup-logs-extras', '40 6 * * *', $$select public.cbc_cleanup_logs_extras();$$)
where not exists (select 1 from cron.job where jobname='cbc-cleanup-logs-extras');
