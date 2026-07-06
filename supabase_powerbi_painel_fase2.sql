-- ============================================================
-- MIGRATION: powerbi_painel_fase2 (02/07/2026)
-- Fase 2 do BI de produtividade — objetos para o painel Power BI
-- do Paulo (tutorial: docs/POWERBI_PAINEL_TUTORIAL.md).
--
--  1) bi_equipes (NOVA tabela): pessoa -> equipe (vendas/operacional).
--     Seed com todas as pessoas vistas nas tarefas; default 'operacional'
--     (Paulo ajusta quem e de vendas). Editar = UPDATE simples.
--  2) vw_bi_produtividade: +coluna equipe (append, via bi_equipes).
--  3) vw_bi_carga_atual (NOVA): tarefas ABERTAS com 1 linha por pessoa
--     (responsaveis vem concatenado na vw_bi_tarefas), aging e equipe.
--     "Tempo real" = frescor do espelho (monitor 2x/dia; 4x/dia proposto).
--  4) vw_bi_distribuicao (NOVA): 1 linha por processo — criado no ADVBOX,
--     process_date (data de distribuicao; validado: mediana de diferenca 0
--     vs tarefa DISTRIBUIR ACAO), dias ate distribuir, flag de cadastro
--     retroativo (processo antigo importado — excluir da regua).
--  5) vw_bi_tarefas_pre_distribuicao (NOVA): tarefas concluidas ANTES da
--     distribuicao do processo (esteira de entrada), com ciclo e
--     "dias antes da distribuicao".
-- ============================================================

-- 1) Tabela de equipes -----------------------------------------------------
create table if not exists bi_equipes (
  pessoa text primary key,
  equipe text not null default 'operacional',
  atualizado_em timestamptz not null default now()
);
alter table bi_equipes enable row level security;
drop policy if exists bi_equipes_all on bi_equipes;
create policy bi_equipes_all on bi_equipes for all using (true) with check (true);
grant select on bi_equipes to powerbi_cbc;

-- Seed: todas as pessoas que ja concluiram tarefa OU tem tarefa aberta
insert into bi_equipes (pessoa)
select distinct pessoa from (
  select pessoa from vw_bi_produtividade
  union
  select trim(x) from vw_bi_tarefas t
    cross join lateral regexp_split_to_table(coalesce(t.responsaveis, ''), ',\s*') x
  where t.status in ('pendente', 'atrasada') and trim(x) <> ''
) s
where pessoa is not null and pessoa <> '' and pessoa <> '(sem registro)'
on conflict (pessoa) do nothing;

-- 2) vw_bi_produtividade + equipe (append no fim) ---------------------------
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
  coalesce(e.equipe, 'operacional')       as equipe
from concluidas d
cross join lateral jsonb_array_elements_text(
  case when jsonb_array_length(coalesce(d.payload->'completed_by', '[]'::jsonb)) > 0
       then d.payload->'completed_by' else '["(sem registro)"]'::jsonb end
) as p(pessoa)
left join criadas c using (tarefa_id)
left join bi_equipes e on e.pessoa = p.pessoa;

alter view vw_bi_produtividade set (security_invoker = true);

-- 3) vw_bi_carga_atual — abertas, 1 linha por pessoa -------------------------
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
  t.oculta_do_cliente
from vw_bi_tarefas t
cross join lateral regexp_split_to_table(coalesce(nullif(t.responsaveis, ''), '(sem responsavel)'), ',\s*') as p(pessoa)
left join bi_equipes e on e.pessoa = trim(p.pessoa)
where t.status in ('pendente', 'atrasada');

alter view vw_bi_carga_atual set (security_invoker = true);
grant select on vw_bi_carga_atual to powerbi_cbc;

-- 4) vw_bi_distribuicao — regua criacao -> distribuicao ----------------------
create or replace view vw_bi_distribuicao as
with dist_tarefa as (
  select lawsuit_id, min(event_date) as tarefa_distribuir_concluida
  from bot_sync_state
  where kind = 'task_completed' and upper(title) like 'DISTRIBUIR AÇÃO%'
  group by 1
)
select
  p.lawsuit_id,
  p.process_number,
  p.tipo,
  p.grupo,
  p.quadro,
  p.etapa,
  p.responsavel,
  p.clientes,
  (p.criado_em_advbox::timestamptz)::date as criado_em,
  (p.process_date::timestamptz)::date     as distribuido_em,
  dt.tarefa_distribuir_concluida,
  case when p.process_date is not null
       then (p.process_date::timestamptz)::date - (p.criado_em_advbox::timestamptz)::date
  end as dias_ate_distribuir,
  case when dt.tarefa_distribuir_concluida is not null
       then dt.tarefa_distribuir_concluida - (p.criado_em_advbox::timestamptz)::date
  end as dias_ate_tarefa_distribuir,
  (p.process_date is not null or dt.tarefa_distribuir_concluida is not null) as distribuido,
  case when p.process_date is null and dt.tarefa_distribuir_concluida is null
       then current_date - (p.criado_em_advbox::timestamptz)::date
  end as dias_aguardando,
  coalesce(p.process_date is not null
           and (p.process_date::timestamptz)::date < (p.criado_em_advbox::timestamptz)::date,
           false) as cadastro_retroativo
from bi_processos p
left join dist_tarefa dt using (lawsuit_id);

alter view vw_bi_distribuicao set (security_invoker = true);
grant select on vw_bi_distribuicao to powerbi_cbc;

-- 5) vw_bi_tarefas_pre_distribuicao — esteira ate a distribuicao -------------
create or replace view vw_bi_tarefas_pre_distribuicao as
with marco as (
  select lawsuit_id, least(pd.d, dt.d) as distribuido_em
  from (select lawsuit_id, (process_date::timestamptz)::date as d
          from bi_processos where process_date is not null) pd
  full join (select lawsuit_id, min(event_date) as d
               from bot_sync_state
              where kind = 'task_completed' and upper(title) like 'DISTRIBUIR AÇÃO%'
              group by 1) dt using (lawsuit_id)
)
select
  pr.*,
  m.distribuido_em,
  (m.distribuido_em - pr.data_conclusao) as dias_antes_da_distribuicao
from vw_bi_produtividade pr
join marco m on m.lawsuit_id = pr.processo_id_advbox
where pr.data_conclusao <= m.distribuido_em
  and upper(pr.tarefa) not like 'DISTRIBUIR%';

alter view vw_bi_tarefas_pre_distribuicao set (security_invoker = true);
grant select on vw_bi_tarefas_pre_distribuicao to powerbi_cbc;
