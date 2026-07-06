-- ============================================================
-- MIGRATION: powerbi_esteira_retrabalho (02/07/2026)
-- Ajustes pos-decisoes do Paulo (mesma sessao do painel):
--
--  1) vw_bi_produtividade: +coluna RETRABALHO (boolean, append) —
--     definicao oficial: tarefas REFAZER* + CORRIGIR PRESTACAO DE CONTAS
--     (Paulo confirmou 02/07 que "NF - REFAZER PREST CONTAS" nao existe;
--      o retrabalho de prestacao e CORRIGIR PRESTACAO DE CONTAS).
--  2) vw_bi_carga_atual: +coluna SITUACAO_AGENDA (append) — visao da
--     coordenadora: vencida / para hoje / proximos 7 dias / mais adiante
--     (baseada na data AGENDADA da tarefa aberta).
--  3) vw_bi_tarefas_pre_distribuicao: RECRIADA (drop+create — precisou
--     porque produtividade ganhou coluna no meio do pr.*) agora com a
--     ESTEIRA COMPLETA: criado_em do processo, dias_desde_criacao
--     (= em que dia de vida do processo a tarefa foi concluida — a
--     mediana disso por tarefa, em ordem, revela o GARGALO antes da
--     distribuicao) e cadastro_retroativo para filtrar importados.
--     Marco de distribuicao = process_date (principal, decisao Paulo)
--     ou tarefa DISTRIBUIR ACAO, o que vier primeiro.
-- ============================================================

-- 1) vw_bi_produtividade + retrabalho ---------------------------------------
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
  d.lawsuit_id                            as processo_id_advbox,
  coalesce(e.equipe, 'operacional')       as equipe,
  (upper(d.title) like '%REFAZER%' or upper(d.title) like 'CORRIGIR PRESTA%') as retrabalho
from concluidas d
cross join lateral jsonb_array_elements_text(
  case when jsonb_array_length(coalesce(d.payload->'completed_by', '[]'::jsonb)) > 0
       then d.payload->'completed_by' else '["(sem registro)"]'::jsonb end
) as p(pessoa)
left join criadas c using (tarefa_id)
left join bi_equipes e on e.pessoa = p.pessoa;

alter view vw_bi_produtividade set (security_invoker = true);

-- 2) vw_bi_carga_atual + situacao_agenda -------------------------------------
create or replace view vw_bi_carga_atual as
select
  t.tarefa_id,
  t.tarefa,
  trim(p.pessoa)                        as pessoa,
  coalesce(e.equipe, 'operacional')     as equipe,
  t.status,
  t.data_criacao                        as data_agendada,
  t.data_criacao_real,
  t.prazo,
  greatest(0, current_date - coalesce(t.data_criacao_real, t.data_criacao)) as dias_em_aberto,
  case
    when greatest(0, current_date - coalesce(t.data_criacao_real, t.data_criacao)) <= 7 then '0-7 dias'
    when greatest(0, current_date - coalesce(t.data_criacao_real, t.data_criacao)) <= 30 then '8-30 dias'
    else 'mais de 30 dias'
  end as faixa_aging,
  (t.data_criacao > current_date)       as agendada_para_futuro,
  t.processo,
  t.cliente,
  t.processo_id_advbox,
  t.oculta_do_cliente,
  case
    when t.data_criacao is null then 'sem data'
    when t.data_criacao < current_date then 'vencida'
    when t.data_criacao = current_date then 'para hoje'
    when t.data_criacao <= current_date + 7 then 'proximos 7 dias'
    else 'mais adiante'
  end as situacao_agenda
from vw_bi_tarefas t
cross join lateral regexp_split_to_table(coalesce(nullif(t.responsaveis, ''), '(sem responsavel)'), ',\s*') as p(pessoa)
left join bi_equipes e on e.pessoa = trim(p.pessoa)
where t.status in ('pendente', 'atrasada');

alter view vw_bi_carga_atual set (security_invoker = true);

-- 3) vw_bi_tarefas_pre_distribuicao — esteira completa -----------------------
drop view if exists vw_bi_tarefas_pre_distribuicao;
create view vw_bi_tarefas_pre_distribuicao as
with marco as (
  select d.lawsuit_id,
         least(d.distribuido_em, d.tarefa_distribuir_concluida) as marco_distribuicao,
         d.criado_em,
         d.cadastro_retroativo
  from vw_bi_distribuicao d
  where d.distribuido
)
select
  pr.*,
  m.marco_distribuicao                       as distribuido_em,
  (m.marco_distribuicao - pr.data_conclusao) as dias_antes_da_distribuicao,
  m.criado_em,
  (pr.data_conclusao - m.criado_em)          as dias_desde_criacao,
  m.cadastro_retroativo
from vw_bi_produtividade pr
join marco m on m.lawsuit_id = pr.processo_id_advbox
where pr.data_conclusao <= m.marco_distribuicao
  and upper(pr.tarefa) not like 'DISTRIBUIR%';

alter view vw_bi_tarefas_pre_distribuicao set (security_invoker = true);
grant select on vw_bi_tarefas_pre_distribuicao to powerbi_cbc;
