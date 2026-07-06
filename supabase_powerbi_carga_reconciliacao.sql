-- ============================================================
-- MIGRATION: powerbi_carga_reconciliacao (02/07/2026, decisoes Paulo)
-- Motivo: "vencidas" da Carga Atual inflado (829 atribuicoes/722 tarefas) —
-- o espelho nao sabia de REMARCACOES (data antiga ficava valendo) nem de
-- EXCLUSOES (tarefa apagada no ADVBOX nunca gera evento de conclusao).
--
--  1) bot_tarefas_abertas_snapshot (NOVA): retrato dos task_ids ABERTOS
--     AGORA no ADVBOX, reescrito a cada rodada do monitor (upsert com
--     timestamp + delete dos antigos — nunca fica vazio no meio).
--     SEED inicial = abertas do espelho (sem regressao ate a 1a rodada).
--  2) vw_bi_carga_atual v3:
--     - INNER JOIN no retrato (so tarefas realmente abertas agora);
--     - COMENTARIO fora ("nao consideramos como tarefa" — Paulo 02/07);
--     - situacao_agenda com CARENCIA: "vencida" so com >=1 dia UTIL
--       completo de atraso (dia seguinte = 'carencia (1 dia util)');
--       sab/dom nao contam; feriados nao considerados;
--     - +coluna dias_uteis_atraso (append).
--  3) vw_bi_produtividade: COMENTARIO muda de 'instantanea' p/ 'sistema'
--     — a medida [Concluídas] do painel exclui 'sistema', entao comentarios
--     saem de TODAS as contagens sem apagar o dado do BI.
--     (PUBLICACAO TRATADA e VERIFICAR INTERNO seguem 'instantanea'.)
--  Monitor (advbox-monitor-worker-background.mjs) atualizado no mesmo dia:
--  upsert slim das abertas conhecidas (remarcacao) + gravacao do retrato.
-- ============================================================

-- 1) Retrato das abertas
create table if not exists bot_tarefas_abertas_snapshot (
  task_id bigint primary key,
  lawsuit_id bigint,
  atualizado_em timestamptz not null default now()
);
alter table bot_tarefas_abertas_snapshot enable row level security;
drop policy if exists bot_allow_all on bot_tarefas_abertas_snapshot;
create policy bot_allow_all on bot_tarefas_abertas_snapshot for all using (true) with check (true);
grant select on bot_tarefas_abertas_snapshot to powerbi_cbc;

-- Seed: estado atual do espelho (a 1a rodada do monitor substitui pelo real)
insert into bot_tarefas_abertas_snapshot (task_id, lawsuit_id)
select distinct t.tarefa_id, t.processo_id_advbox
from vw_bi_tarefas t
where t.status in ('pendente', 'atrasada')
on conflict (task_id) do nothing;

-- 2) Carga Atual v3
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
    when t.data_criacao < current_date then
      case when (select count(*) from generate_series(t.data_criacao + 1, current_date - 1, interval '1 day') g
                  where extract(isodow from g) < 6) >= 1
           then 'vencida'
           else 'carencia (1 dia util)'
      end
    when t.data_criacao = current_date then 'para hoje'
    when t.data_criacao <= current_date + 7 then 'proximos 7 dias'
    else 'mais adiante'
  end as situacao_agenda,
  coalesce((select count(*) from generate_series(t.data_criacao + 1, current_date - 1, interval '1 day') g
             where extract(isodow from g) < 6), 0)::int as dias_uteis_atraso
from vw_bi_tarefas t
join bot_tarefas_abertas_snapshot snap on snap.task_id = t.tarefa_id
cross join lateral regexp_split_to_table(coalesce(nullif(t.responsaveis, ''), '(sem responsavel)'), ',\s*') as p(pessoa)
left join bi_equipes e on e.pessoa = trim(p.pessoa)
where t.status in ('pendente', 'atrasada')
  and upper(t.tarefa) not in ('COMENTÁRIO', 'COMENTARIO');

alter view vw_bi_carga_atual set (security_invoker = true);

-- 3) Produtividade: COMENTARIO -> categoria 'sistema'
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
    when upper(d.title) like 'ALERTA DE TAREFA EXCLU%'
      or upper(d.title) in ('COMENTÁRIO', 'COMENTARIO') then 'sistema'
    when upper(d.title) like 'PUBLICAÇÃO TRATADA%'
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

-- ------------------------------------------------------------
-- ADENDO (mesma noite): migração powerbi_carga_fuso_brt — a view usava
-- current_date (UTC); entre 21h e 00h BRT o "hoje" pulava de dia e os
-- grupos deslocavam (REGRA #11: datas em BRT). Trocado por
-- (now() at time zone 'America/Sao_Paulo')::date via lateral h.hoje.
-- Definição vigente completa: ver migração powerbi_carga_fuso_brt.
-- ------------------------------------------------------------
