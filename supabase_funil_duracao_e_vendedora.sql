-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria 01/08/2026 — itens 240 e 241
-- Aplicado em producao em 02/08/2026 (migracao funil_duracao_call_e_por_vendedora)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 240 — DURACAO REAL DA CALL COLETADA E IGNORADA
-- A auditoria do Meet guarda desde junho/2026 quanto tempo o cliente ficou na sala
-- (meet_cliente_seg) e quanto esperou sozinho (meet_cliente_esperou_seg). O funil so
-- usava compareceu/nao. Medido no banco em 02/08 (325 calls auditadas):
--     0s ................. 55  (nunca abriram o link)
--     4s a 256s .......... 15  (ENTRARAM e sairam) <- contadas como falta
--     330s a 598s ........ 29  curtas
--     600s a 1192s ...... 154  padrao
--     1202s a 3345s ...... 72  longas
-- A regra de presenca ja cortava em 300s. O problema nao e o corte: e que as 15 que
-- entraram e sairam somem no mesmo numero das 55 que nunca apareceram, sendo leads
-- muito diferentes. Duas dessas 15 esperaram sozinhas do inicio ao fim (ninguem do
-- escritorio entrou).
--
-- 241 — FUNIL NAO ABRE POR VENDEDORA
-- vendedora_email estava exposto desde sempre e nenhuma tela comparava as pessoas.
-- amostra_suficiente (>=10 calls auditadas) impede ranquear alguem com 4 calls.
--
-- Colunas novas vao no FIM das views (o Power BI quebra se alguma some).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.vw_funil_videochamadas as
select
  event_id,
  vendedora_email,
  case when status = 'excluida' then 'excluida' else coalesce(meet_status, status) end as status,
  color_id,
  scheduled_at,
  tem_meet,
  status as status_cor,
  meet_status,
  case when meet_status is not null then 'meet' else 'cor' end as origem_status,
  meet_cliente_seg,
  meet_cliente_esperou_seg,
  case
    when meet_conferido_em is null then null
    when coalesce(meet_cliente_seg, 0) = 0 then 'nao entrou'
    when meet_cliente_seg < 300 then 'entrou e saiu'
    when meet_cliente_seg < 600 then 'curta (5-10min)'
    when meet_cliente_seg < 1200 then 'padrao (10-20min)'
    else 'longa (20min+)'
  end as duracao_faixa,
  (meet_conferido_em is not null
    and coalesce(meet_cliente_seg, 0) between 1 and 299) as conectou_e_caiu,
  (coalesce(meet_cliente_esperou_seg, 0) > 0
    and coalesce(meet_cliente_esperou_seg, 0) >= coalesce(meet_cliente_seg, 0)) as esperou_sozinho_ate_sair
from public.agenda_videochamadas;

comment on view public.vw_funil_videochamadas is
  'Videochamadas do funil. meet_status tem precedencia sobre a cor da agenda (regra Paulo). '
  'Colunas de duracao (item 240) so tem valor onde meet_conferido_em nao e nulo — antes de '
  'jun/2026 o status vinha da COR da agenda e nao ha auditoria do Meet.';

create or replace view public.vw_funil_por_vendedora as
with base as (
  select
    vendedora_email,
    date_trunc('month', scheduled_at at time zone 'America/Sao_Paulo')::date as mes,
    meet_conferido_em is not null as auditada,
    meet_cliente_presente,
    meet_cliente_seg,
    coalesce(meet_cliente_seg, 0) between 1 and 299 as caiu,
    status
  from public.agenda_videochamadas
  where vendedora_email is not null
    and coalesce(status, '') <> 'excluida'
)
select
  vendedora_email,
  mes,
  count(*)                                                  as agendadas,
  count(*) filter (where auditada)                          as auditadas,
  count(*) filter (where meet_cliente_presente)             as compareceu,
  count(*) filter (where auditada and caiu)                 as conectou_e_caiu,
  count(*) filter (where auditada and coalesce(meet_cliente_seg,0) = 0) as nao_entrou,
  round(100.0 * count(*) filter (where meet_cliente_presente)
        / nullif(count(*) filter (where auditada), 0), 1)   as pct_comparecimento,
  round((percentile_cont(0.5) within group (order by meet_cliente_seg)
         filter (where meet_cliente_presente) / 60.0)::numeric, 1) as mediana_min,
  round((avg(meet_cliente_seg) filter (where meet_cliente_presente) / 60.0)::numeric, 1) as media_min,
  (count(*) filter (where auditada) >= 10)                  as amostra_suficiente
from base
group by 1, 2;

comment on view public.vw_funil_por_vendedora is
  'Comparativo de videochamadas por vendedora e mes (item 241). Use amostra_suficiente '
  'antes de exibir pct_comparecimento: abaixo de 10 calls auditadas o numero e ruido.';

grant select on public.vw_funil_videochamadas, public.vw_funil_por_vendedora to authenticated;
grant select on public.vw_funil_por_vendedora to powerbi_cbc;
