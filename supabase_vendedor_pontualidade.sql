-- Migração: vendedor_pontualidade (aplicada em produção via apply_migration em 24/07/2026)
-- Pontualidade do vendedor na videochamada (Regra B do Paulo):
--   atraso = entrada_do_vendedor - GREATEST(horario_agendado, entrada_do_lead), quando > 0.
--   Mede quanto o lead esperou; ancora no horario quando o lead chega adiantado.
-- Fonte dos horarios: agenda_videochamadas.meet_participantes[].entrou (epoch), gravado
-- pela auditoria do Meet (meet-auditoria-sync). Grao = 1 linha por call auditada.
--
-- Acesso: view Power BI so p/ powerbi_cbc; RPC so p/ socios (paulo@/bruno@ via JWT).

create or replace view public.vw_bi_vendedor_pontualidade as
with j as (
  select
    event_id, vendedora_email, scheduled_at, cliente_nome, status,
    extract(epoch from scheduled_at) as sched_ep,
    (select min((p->>'entrou')::bigint) from jsonb_array_elements(meet_participantes) p where (p->>'interno')::boolean = false) as lead_ep,
    (select min((p->>'entrou')::bigint) from jsonb_array_elements(meet_participantes) p where (p->>'interno')::boolean = true ) as vend_ep
  from public.agenda_videochamadas
  where meet_participantes is not null and status <> 'excluida'
)
select
  event_id,
  vendedora_email,
  split_part(vendedora_email, '@', 1) as vendedor,
  scheduled_at,
  cliente_nome,
  to_timestamp(lead_ep) as lead_entrou,
  to_timestamp(vend_ep) as vendedor_entrou,
  (lead_ep is not null) as tem_lead,
  (lead_ep is not null and vend_ep is null) as vendedor_nao_entrou,
  case when lead_ep is not null and vend_ep is not null and vend_ep > greatest(sched_ep, lead_ep)
       then (vend_ep - greatest(sched_ep, lead_ep))::int else 0 end as atraso_seg,
  (lead_ep is not null and vend_ep is not null and vend_ep > greatest(sched_ep, lead_ep)) as houve_atraso
from j;

grant select on public.vw_bi_vendedor_pontualidade to powerbi_cbc;

-- RPC gated: so paulo@ e bruno@ (confere o e-mail no JWT do chamador). Nao-socio => vazio.
create or replace function public.vendedor_pontualidade(p_dias int default 180)
returns setof public.vw_bi_vendedor_pontualidade
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) not in ('paulo@advocaciacbc.com', 'bruno@advocaciacbc.com') then
    return; -- acesso restrito aos socios: retorna vazio
  end if;
  return query
    select * from public.vw_bi_vendedor_pontualidade v
    where v.scheduled_at >= now() - (p_dias || ' days')::interval
      and v.scheduled_at < now()
    order by v.scheduled_at desc;
end
$function$;

grant execute on function public.vendedor_pontualidade(int) to anon, authenticated;
