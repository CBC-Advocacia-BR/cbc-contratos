-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria 01/08/2026 — itens 143, 145 e 148 (a vigilancia que mentia)
-- Aplicado em producao em 02/08/2026
--   migracoes: cleanup_old_logs_desambiguar_item148, pg_cron_status_visivel_item148
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 148 (a) — ACHADO: o cron `cleanup-old-logs` (jobid 15, 06h30 UTC) FALHAVA TODO DIA com
--   ERROR: function cleanup_old_logs() is not unique
-- e tinha ZERO execucoes bem-sucedidas em toda a janela de log retida (desde 26/07).
-- CAUSA: duas funcoes em `public` atendem a uma chamada sem argumentos —
--   public.cleanup_old_logs()                              -> activity_log, automation_log, contratos_audit
--   public.cleanup_old_logs(retention_days int DEFAULT 90)  -> action_log, audit_log, automation_log,
--                                                              contratos_audit, _legacy_chatguru_log
-- Como a segunda tem valor padrao, as duas casam com `cleanup_old_logs()` e o Postgres se
-- recusa a escolher — o que torna a versao sem parametro INALCANCAVEL pelo nome.
-- ESTRAGO: pequeno (~840 linhas vencidas, ~1 MB). Era prevencao. Ao rodar a correcao,
-- 1.827 linhas foram removidas (650 activity_log, 987 contratos_audit, 128 automation_log,
-- 62 audit_log). Nenhuma funcao foi apagada e a `rh.cleanup_old_logs()` de outro sistema
-- do escritorio ficou intacta.

create or replace function public.cbc_cleanup_logs_diario()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_activity int := 0;
  v_resto jsonb;
begin
  v_resto := public.cleanup_old_logs(90);
  delete from public.activity_log where created_at < now() - interval '90 days';
  get diagnostics v_activity = row_count;
  return jsonb_build_object('activity_log', v_activity, 'demais', v_resto, 'em', now());
end;
$$;

comment on function public.cbc_cleanup_logs_diario() is
  'Item 148 — ponto de entrada unico da limpeza diaria de logs. Existe porque '
  'public.cleanup_old_logs() e public.cleanup_old_logs(int DEFAULT 90) sao ambas '
  'chamaveis sem argumento, o que tornava a chamada ambigua e fazia o cron falhar todo '
  'dia desde (pelo menos) 26/07/2026. Nao apague as duas originais sem conferir quem '
  'mais as chama.';

-- reaponta o job para o ponto de entrada unico
select cron.alter_job(15, command => 'SELECT public.cbc_cleanup_logs_diario();');

-- ───────────────────────────────────────────────────────────────────────────
-- 148 (b) — os 23 crons do pg_cron nao apareciam em painel nenhum. Agora o Monitor
-- mostra todos. O banco e COMPARTILHADO: `do_cbc` separa os jobs deste sistema dos
-- outros do escritorio, que aparecem (para nao parecerem inexistentes) mas nao alarmam.
create or replace function public.cbc_pg_cron_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'cron', 'pg_temp'
as $$
with ult as (
  select distinct on (jobid) jobid, status, start_time, left(return_message, 300) as msg
  from cron.job_run_details
  order by jobid, start_time desc
)
select coalesce(jsonb_agg(to_jsonb(x) order by x.do_cbc desc, x.jobname), '[]'::jsonb)
from (
  select
    j.jobid, j.jobname, j.schedule, j.active,
    u.status as ultimo_status,
    u.start_time as ultima_execucao,
    case when u.status = 'succeeded' then null else u.msg end as ultimo_erro,
    (j.jobname not like 'teses-%' and j.jobname not like 'cbc_produtividade%'
     and j.jobname not like 'comparador-%' and j.jobname not like 'auth-%'
     and j.jobname not like 'mv-task-costs%') as do_cbc,
    (u.start_time is null) as nunca_rodou,
    round(extract(epoch from (now() - u.start_time)) / 60.0) as minutos_desde
  from cron.job j
  left join ult u on u.jobid = j.jobid
) x;
$$;

comment on function public.cbc_pg_cron_status() is
  'Item 148 — retrato dos crons do pg_cron para o Monitor do app. O banco e compartilhado: '
  'do_cbc=false marca jobs de outros sistemas do escritorio, que aparecem no painel mas nao '
  'devem gerar alarme aqui.';

grant execute on function public.cbc_pg_cron_status() to authenticated;
