-- ============================================================
-- Migracao: backup_drive (17/07/2026)
-- Backup automatico diario do CBC Contratos -> Google Drive.
--
-- Contexto: o backup antigo (server/ + S3, cron 03h) foi aposentado em
-- 20/06/2026 junto com o server/ (auditoria #87). O incidente do Supabase
-- de 17/07/2026 (projeto 3h24 fora do ar, sa-east-1) mostrou que o sistema
-- dependia 100% do backup gerenciado. Este e o backup proprio novo:
-- functions backup-diario (cron 06:00 UTC = 03h BRT) + backup-worker-background.
--
-- RPCs SECURITY DEFINER protegidas por BOT_RPC_SECRET (helper _bot_chave_ok),
-- mesmo padrao do espelho Asaas. Whitelist FIXA: o banco e COMPARTILHADO
-- entre varios apps do escritorio — so tabelas do CBC Contratos entram.
-- Espelhos re-geraveis de APIs externas (asaas_boletos/customers, bi_*,
-- meta_*, kommo_leads, bot_sync_state etc.) ficam DE FORA por serem
-- reconstruiveis via backfill; o que entra e o insubstituivel.
-- ============================================================

create or replace function _backup_whitelist()
returns text[] language sql immutable as $$
  select array[
    -- nucleo do negocio
    'contratos','contratos_audit','contrato_comentarios','empreendimentos',
    -- acesso / sistema
    'user_permissions','user_views','user_reminders','user_notification_prefs',
    'notifications','activity_log','audit_log','automation_log',
    -- cadastro unico / mapeamentos
    'client_mapping','clientes','cliente_acoes_drive','asaas_customer_notes',
    -- cobranca (dados proprios; espelho asaas fica fora)
    'inadimplencia_historico','cobranca_regua','cobranca_disparos',
    -- funil / agenda
    'agenda_videochamadas','bi_equipes',
    -- bot ADVBOX (curadoria manual + conversas; espelho bot_sync_state fica fora)
    'bot_config','bot_glossary','bot_intents','bot_stage_templates','bot_task_templates',
    'bot_testers','bot_conversations','bot_messages','bot_cliente_fone','bot_secrets',
    -- vendas / comissoes
    'vendas_comissoes_mensais','vendas_comissoes_detalhe','vendas_comissao_regras',
    'vendas_metas','vendas_documentos_tipos','vendas_documentos_requisitos',
    'vendas_documentos_enviados','vendas_guias_custas','vendas_expectativa_honorarios',
    'vendas_promocoes_sazonais','vendas_leads_rapidos','vendas_advbox_mapping',
    -- portal do cliente
    'portal_tokens','cliente_portal_tokens','portal_faq','portal_perguntas',
    'portal_comentarios','portal_nps','portal_push_subs','portal_cliente_flags'
  ];
$$;

-- Lista as tabelas do backup com contagem de linhas (pula as que nao existirem).
create or replace function backup_tabelas(p_chave text)
returns table(tabela text, linhas bigint)
language plpgsql security definer set search_path = public as $$
declare
  t text; n bigint;
begin
  if not _bot_chave_ok(p_chave) then
    raise exception 'acesso negado';
  end if;
  foreach t in array _backup_whitelist() loop
    if to_regclass('public.'||t) is not null then
      execute format('select count(*) from %I', t) into n;
      tabela := t; linhas := n;
      return next;
    end if;
  end loop;
end $$;

-- Exporta uma pagina (max 1000 linhas) de uma tabela da whitelist como jsonb.
-- Paginacao estavel por "order by 1" (primeira coluna = PK em todas as tabelas da lista).
create or replace function backup_dump(p_chave text, p_tabela text, p_offset integer default 0, p_limit integer default 1000)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  resultado jsonb;
begin
  if not _bot_chave_ok(p_chave) then
    raise exception 'acesso negado';
  end if;
  if not (p_tabela = any(_backup_whitelist())) then
    raise exception 'tabela fora da whitelist: %', p_tabela;
  end if;
  if to_regclass('public.'||p_tabela) is null then
    return '[]'::jsonb;
  end if;
  execute format(
    'select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select * from %I order by 1 offset %s limit %s) x',
    p_tabela, greatest(p_offset, 0), least(greatest(p_limit, 1), 1000)
  ) into resultado;
  return resultado;
end $$;
