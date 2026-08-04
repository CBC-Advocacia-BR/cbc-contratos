-- =============================================================================
-- HISTORICO DE ATENDIMENTOS EM VIDEOCHAMADAS, POR EVENTO (pedido Paulo 04/08/2026)
-- Migracao aplicada em producao via MCP em 04/08/2026 (nome: historico_atendimentos).
-- Irma da vw_noshow_acervo (agregada por pessoa, serve campanha de disparo): esta
-- view e no nivel do EVENTO, 1 linha por atendimento agendado, e cobre TODAS as
-- pessoas com agenda, nao so quem faltou. Decisao do Paulo (04/08/2026): mostrar
-- o historico completo, porque 176 das 617 pessoas do acervo faltaram E
-- compareceram depois, e mostrar so a falta trataria como problema quem ja
-- voltou. Consumida pela Task 2 (funcao de consulta da tela do SDR) para exibir
-- o historico de uma pessoa no momento de agendar.
-- Desfecho segue a mesma regra da vw_noshow_acervo: meet_status vence a cor
-- (decisao do Paulo em 23/07/2026); 'excluida' nunca conta como falta.
-- Exposicao: view "security definer" (default), SELECT para authenticated e
-- powerbi_cbc; anon sem acesso (dado pessoal: telefone e nome de lead).
-- Validacao 04/08/2026 (Step 4, zero divergencia exigida contra vw_noshow_acervo,
-- mesmo metodo do item 175): pessoas_no_acervo=617, pessoas_na_view=617,
-- divergencias=0. Distribuicao de desfechos (Step 6, valores aproximados porque
-- a agenda sincroniza sozinha varias vezes ao dia): compareceu=2127, faltou=721,
-- excluida=29, agendada=25 (total 2902 linhas) -- nenhum nulo, nenhum 'remarcada'.
-- =============================================================================

-- Historico de comparecimento por pessoa, no nivel do EVENTO.
-- Irma da vw_noshow_acervo (que e agregada por pessoa e serve campanha).
-- Cobre TODAS as pessoas com agenda, nao so quem faltou: a decisao do Paulo
-- (04/08/2026) e mostrar historico completo, porque 176 das 617 pessoas do acervo
-- faltaram E compareceram, e mostrar so a falta trataria como problema quem ja
-- voltou.
create or replace view public.vw_pessoa_atendimentos as
select
  case when length(c.dd) >= 10 then left(c.dd,2)||right(c.dd,8) end as telefone,
  a.event_id,
  a.scheduled_at,
  (a.scheduled_at at time zone 'America/Sao_Paulo') as quando_brt,
  split_part(coalesce(a.vendedora_email,''),'@',1) as vendedora,
  case
    when a.status = 'excluida' then 'excluida'
    when coalesce(a.meet_status, a.status) in ('realizada','fechou') then 'compareceu'
    when coalesce(a.meet_status, a.status) = 'no_show' then 'faltou'
    else 'agendada'
  end as desfecho,
  (a.meet_status is not null) as via_meet,
  a.lead_id as kommo_lead_id,
  nullif(trim(a.cliente_nome),'') as nome
from public.agenda_videochamadas a
cross join lateral (
  -- defensivo: hoje agenda_videochamadas.telefone ja vem DDD+8, mas se um dia
  -- vier com 55 na frente a chave nao pode mudar em silencio
  select case
    when regexp_replace(coalesce(a.telefone,''),'\D','','g') ~ '^55'
         and length(regexp_replace(coalesce(a.telefone,''),'\D','','g')) >= 12
    then substr(regexp_replace(coalesce(a.telefone,''),'\D','','g'),3)
    else regexp_replace(coalesce(a.telefone,''),'\D','','g')
  end as dd
) c
where a.telefone is not null and a.telefone <> '';

comment on view public.vw_pessoa_atendimentos is
'Historico de comparecimento no nivel do evento: 1 linha por atendimento agendado, com telefone canonico DDD+8, desfecho (compareceu/faltou/excluida/agendada) e via_meet (true=auditoria do Meet, false=cor da agenda). Auto-atualizada a partir de agenda_videochamadas. Criada 04/08/2026.';

-- a funcao da Task 2 filtra por telefone e por lead; a tabela tem ~2.900 linhas hoje,
-- mas a fila do painel consulta 1x por card, entao seq scan x20 vira desperdicio
create index if not exists idx_agenda_vc_telefone on public.agenda_videochamadas (telefone);
create index if not exists idx_agenda_vc_lead on public.agenda_videochamadas (lead_id);

revoke all on public.vw_pessoa_atendimentos from anon;
grant select on public.vw_pessoa_atendimentos to authenticated;
grant select on public.vw_pessoa_atendimentos to powerbi_cbc;
