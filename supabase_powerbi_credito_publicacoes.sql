-- ============================================================
-- MIGRATION: powerbi_credito_publicacoes (02/07/2026, decisoes Paulo)
--  1) bi_equipes: HELOISA VITORIA GONCALVES e JOAO VITOR PERRES ROCHA
--     -> equipe 'desligado' (demitidos; historico preservado e filtravel).
--  2) vw_bi_produtividade v4: CREDITO das "PUBLICACAO TRATADA <NOME>" vai
--     para a PESSOA DO TITULO (Luany/Grazie/Mariana Lacerda) — o perfil
--     PUBLIS CBC e gerenciado pela controladoria e nao deve levar o credito.
--     Resolucao dinamica: 1o nome do titulo casado com bi_equipes
--     (equipe='operacional' — desambigua as duas Marianas); sem match,
--     mantem quem concluiu. A equipe passa a ser a da pessoa creditada.
--  Obs (pergunta Paulo): categoria 'sistema' = COMENTARIO + ALERTA DE
--  TAREFA EXCLUIDA — ambas JA fora de todas as contagens do painel
--  (a medida [Concluídas] exclui 'sistema' desde a fase 2/3).
-- ============================================================

update bi_equipes set equipe = 'desligado', atualizado_em = now()
 where pessoa in ('HELOISA VITÓRIA GONÇALVES', 'JOÃO VITOR PERRES ROCHA');

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
  pf.pessoa_final                         as pessoa,
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
cross join lateral (
  select case
    when upper(d.title) like 'PUBLICAÇÃO TRATADA%' or upper(d.title) like 'PUBLICACAO TRATADA%' then
      coalesce((select e2.pessoa from bi_equipes e2
                 where e2.equipe = 'operacional'
                   and split_part(e2.pessoa, ' ', 1) =
                       trim(regexp_replace(upper(d.title), '^PUBLICA[ÇC][ÃA]O TRATADA\s*', ''))
                 order by e2.pessoa limit 1), p.pessoa)
    else p.pessoa
  end as pessoa_final
) pf
left join criadas c using (tarefa_id)
left join bi_equipes e on e.pessoa = pf.pessoa_final;

alter view vw_bi_produtividade set (security_invoker = true);
