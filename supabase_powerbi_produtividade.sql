-- ============================================================
-- MIGRATION: powerbi_produtividade (02/07/2026)
-- BI de produtividade de tarefas ADVBOX para o Power BI.
--
--  1) vw_bi_tarefas ganha 3 colunas NOVAS (append no fim — create or replace
--     nao permite reordenar):
--       data_criacao_real  = created_at da tarefa no ADVBOX (payload, gravado
--                            pelo monitor/backfill a partir de 02/07/2026)
--       tempo_ciclo_dias   = data_conclusao - data_criacao_real (tempo REAL
--                            entre criacao e conclusao; a antiga data_criacao
--                            e a data AGENDADA da tarefa, nao a criacao)
--       reward             = pontos de gamificacao do ADVBOX
--     Historico repovoado pela re-execucao do backfill (fase "tarefas", que
--     passou a ATUALIZAR duplicatas — bulkUpsertSyncItems em botDb.mjs).
--
--  2) vw_bi_produtividade (NOVA): 1 linha por PESSOA x tarefa concluida —
--     plug-and-play no Power BI (sem Split Column). Inclui categoria:
--       'sistema'     = ALERTA DE TAREFA EXCLUIDA (marcador, fora das metricas)
--       'instantanea' = COMENTARIO / PUBLICACAO TRATADA* / VERIFICAR INTERNO
--                       (producao real — ~25% do volume — mas tempo 0 por
--                       natureza; separar para nao achatar as medianas)
--       'ciclo'       = demais (medir tempo faz sentido)
--
--  3) vw_bi_funil_etapas (NOVA): permanencia (dias) por etapa do processo,
--     derivada de bi_processos_log (campo='etapa') com janela LEAD; periodo
--     aberto usa now(). So mede periodos OBSERVADOS (log existe desde 10/06).
--
--  Todas com security_invoker=true (RLS do chamador) + grant ao powerbi_cbc.
-- ============================================================

-- 1) vw_bi_tarefas — mesma definicao + 3 colunas no fim
create or replace view vw_bi_tarefas as
with criadas as (
  select replace(item_key, 'task:', '') as tid, * from bot_sync_state where kind = 'task_created'
), concluidas as (
  select replace(item_key, 'taskdone:', '') as tid, * from bot_sync_state where kind = 'task_completed'
)
select
  coalesce(c.tid, d.tid)::bigint               as tarefa_id,
  coalesce(c.title, d.title)                   as tarefa,
  coalesce(c.process_number, d.process_number) as processo,
  coalesce(c.customer_name, d.customer_name)   as cliente,
  coalesce(c.lawsuit_id, d.lawsuit_id)         as processo_id_advbox,
  c.event_date                                 as data_criacao,
  case when c.payload->>'deadline' ~ '^\d{4}-\d{2}-\d{2}' then (c.payload->>'deadline')::date end as prazo,
  (select string_agg(x, ', ') from jsonb_array_elements_text(coalesce(c.payload->'users', '[]'::jsonb)) x) as responsaveis,
  d.event_date                                 as data_conclusao,
  (select string_agg(x, ', ') from jsonb_array_elements_text(coalesce(d.payload->'completed_by', '[]'::jsonb)) x) as concluida_por,
  case
    when d.tid is not null then 'concluida'
    when (case when c.payload->>'deadline' ~ '^\d{4}-\d{2}-\d{2}' then (c.payload->>'deadline')::date end) < current_date then 'atrasada'
    else 'pendente'
  end as status,
  case when d.tid is not null and c.payload->>'deadline' ~ '^\d{4}-\d{2}-\d{2}'
       then d.event_date - (c.payload->>'deadline')::date end as dias_vs_prazo,
  coalesce(c.created_at, d.created_at)         as detectado_em,
  coalesce((c.payload->>'oculto')::boolean, (d.payload->>'oculto')::boolean,
           (select tt.ocultar_cliente from bot_task_templates tt
              where upper(tt.task_name) = upper(coalesce(c.title, d.title)) limit 1),
           false) as oculta_do_cliente,
  -- ---- novas (02/07/2026) ----
  (substring(coalesce(c.payload->>'created_at', d.payload->>'created_at') from '^\d{4}-\d{2}-\d{2}'))::date as data_criacao_real,
  case when d.tid is not null then
    d.event_date - (substring(coalesce(c.payload->>'created_at', d.payload->>'created_at') from '^\d{4}-\d{2}-\d{2}'))::date
  end as tempo_ciclo_dias,
  case when coalesce(c.payload->>'reward', d.payload->>'reward') ~ '^-?\d+(\.\d+)?$'
       then coalesce(c.payload->>'reward', d.payload->>'reward')::numeric end as reward
from criadas c
full outer join concluidas d on d.tid = c.tid;

alter view vw_bi_tarefas set (security_invoker = true);

-- 2) vw_bi_produtividade — 1 linha por pessoa x tarefa concluida
create or replace view vw_bi_produtividade as
with concluidas as (
  select replace(item_key, 'taskdone:', '')::bigint as tarefa_id, *
  from bot_sync_state where kind = 'task_completed'
), criadas as (
  select replace(item_key, 'task:', '')::bigint as tarefa_id, *
  from bot_sync_state where kind = 'task_created'
)
select
  d.tarefa_id,
  d.title                                 as tarefa,
  p.pessoa,
  d.event_date                            as data_conclusao,
  date_trunc('month', d.event_date)::date as mes_conclusao,
  c.event_date                            as data_agendada,
  (substring(coalesce(c.payload->>'created_at', d.payload->>'created_at') from '^\d{4}-\d{2}-\d{2}'))::date as data_criacao_real,
  case when c.event_date is not null then d.event_date - c.event_date end as dias_vs_agendado,
  d.event_date - (substring(coalesce(c.payload->>'created_at', d.payload->>'created_at') from '^\d{4}-\d{2}-\d{2}'))::date as tempo_ciclo_dias,
  case when coalesce(c.payload->>'reward', d.payload->>'reward') ~ '^-?\d+(\.\d+)?$'
       then coalesce(c.payload->>'reward', d.payload->>'reward')::numeric end as reward,
  case
    when upper(d.title) like 'ALERTA DE TAREFA EXCLU%' then 'sistema'
    when upper(d.title) in ('COMENTÁRIO', 'COMENTARIO')
      or upper(d.title) like 'PUBLICAÇÃO TRATADA%'
      or upper(d.title) like 'PUBLICACAO TRATADA%'
      or upper(d.title) like 'VERIFICAR INTERNO%' then 'instantanea'
    else 'ciclo'
  end as categoria,
  coalesce((c.payload->>'oculto')::boolean, (d.payload->>'oculto')::boolean,
           (select tt.ocultar_cliente from bot_task_templates tt
              where upper(tt.task_name) = upper(d.title) limit 1),
           false) as oculta_do_cliente,
  d.process_number                        as processo,
  d.customer_name                         as cliente,
  d.lawsuit_id                            as processo_id_advbox
from concluidas d
cross join lateral jsonb_array_elements_text(
  case when jsonb_array_length(coalesce(d.payload->'completed_by', '[]'::jsonb)) > 0
       then d.payload->'completed_by' else '["(sem registro)"]'::jsonb end
) as p(pessoa)
left join criadas c using (tarefa_id);

alter view vw_bi_produtividade set (security_invoker = true);
grant select on vw_bi_produtividade to powerbi_cbc;

-- 3) vw_bi_funil_etapas — permanencia por etapa do processo
create or replace view vw_bi_funil_etapas as
with mud as (
  select lawsuit_id, process_number, para as etapa, detectado_em as inicio,
         lead(detectado_em) over (partition by lawsuit_id order by detectado_em, id) as fim
  from bi_processos_log
  where campo = 'etapa'
)
select
  m.lawsuit_id,
  m.process_number,
  m.etapa,
  m.inicio,
  m.fim,
  round((extract(epoch from coalesce(m.fim, now()) - m.inicio) / 86400.0)::numeric, 1) as dias_na_etapa,
  (m.fim is null)  as em_andamento,
  p.quadro,
  p.responsavel,
  p.etapa          as etapa_atual_processo
from mud m
left join bi_processos p using (lawsuit_id);

alter view vw_bi_funil_etapas set (security_invoker = true);
grant select on vw_bi_funil_etapas to powerbi_cbc;
