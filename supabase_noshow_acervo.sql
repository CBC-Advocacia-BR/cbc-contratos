-- =============================================================================
-- ACERVO DE NO-SHOWS EM VIDEOCHAMADAS (pedido Paulo 31/07/2026)
-- Migracao aplicada em producao via MCP em 31/07/2026 (nome: noshow_acervo).
-- 1 linha por pessoa (telefone canonico DDD + 8 digitos, chave da agenda) com o
-- historico de faltas e as flags de cruzamento (compareceu depois, virou
-- contrato, ja e cliente, reagendou). Deriva 100% de agenda_videochamadas
-- (alimentada pelo sync da agenda + auditoria do Google Meet) => a view se
-- mantem atualizada sozinha, sem job novo.
-- Exposicao segue o padrao de vw_funil_videochamadas: view "security definer"
-- (default), SELECT para authenticated e powerbi_cbc, anon sem acesso.
-- Consumo pelo app: supabase.from('vw_noshow_acervo').select() (usuario logado).
-- Validacao 31/07/2026: 615 pessoas / 719 faltas; elegivel=423/492;
-- compareceu_outra_call=175/210; ja_cliente=10; virou_contrato=6; reagendado=1.
-- =============================================================================

create or replace view public.vw_noshow_acervo as
with eventos as (
  select telefone as tel, lead_id, scheduled_at,
         nullif(trim(cliente_nome),'') as cliente_nome,
         nullif(trim(cliente_email),'') as cliente_email,
         vendedora_email,
         case when status='excluida' then 'excluida' else coalesce(meet_status,status) end as st
  from public.agenda_videochamadas
  where telefone is not null and telefone <> ''
),
compareceu_tel as (select distinct tel from eventos where st in ('realizada','fechou')),
compareceu_lead as (select distinct lead_id from eventos where st in ('realizada','fechou') and lead_id is not null),
futuro_tel as (select distinct tel from eventos where st='agendada' and scheduled_at > now()),
futuro_lead as (select distinct lead_id from eventos where st='agendada' and scheduled_at > now() and lead_id is not null),
contrato_pess as (
  select case when length(x.d) >= 10 then left(x.d,2)||right(x.d,8) end as tel,
         (regexp_match(coalesce(c->>'linkKommo',''), 'leads/detail/(\d+)'))[1] as lead_txt
  from public.contratos, jsonb_array_elements(coalesce(dados->'contratantes','[]'::jsonb)) as c
  cross join lateral (
    select case when t.dd ~ '^55' and length(t.dd) >= 12 then substr(t.dd,3) else t.dd end as d
    from (select regexp_replace(coalesce(c->>'telefone',''),'\D','','g') as dd) t
  ) x
),
cli_tel as (
  select distinct left(z.d,2)||right(z.d,8) as tel
  from (
    select case when ct.fone ~ '^55' and length(ct.fone)>=12 then substr(ct.fone,3) else ct.fone end as d
    from public.cliente_telefones ct
    join public.clientes cl on cl.id = ct.cliente_uid
    where cl.eh_cliente
    union all
    select case when q.dd ~ '^55' and length(q.dd)>=12 then substr(q.dd,3) else q.dd end
    from (
      select regexp_replace(p,'\D','','g') as dd
      from public.clientes cl2, regexp_split_to_table(coalesce(cl2.telefone,''),'/') p
      where cl2.eh_cliente
    ) q where q.dd <> ''
  ) z where length(z.d) >= 10
),
cli_lead as (
  select distinct kommo_lead_id as lead_txt from public.clientes
  where eh_cliente and kommo_lead_id is not null and kommo_lead_id ~ '^\d+$'
),
ns as (
  select tel,
    count(*) filter (where st='no_show') as qtd_noshow,
    count(*) as qtd_agendamentos,
    min(scheduled_at) filter (where st='no_show') as primeiro_noshow,
    max(scheduled_at) filter (where st='no_show') as ultimo_noshow,
    (array_agg(cliente_nome order by scheduled_at desc) filter (where cliente_nome is not null))[1] as nome,
    (array_agg(cliente_email order by scheduled_at desc) filter (where cliente_email is not null))[1] as email,
    (array_agg(vendedora_email order by scheduled_at desc) filter (where st='no_show'))[1] as vendedora,
    (array_agg(lead_id order by scheduled_at desc) filter (where lead_id is not null))[1] as lead_recente,
    array_agg(distinct lead_id) filter (where lead_id is not null) as leads
  from eventos
  group by tel
  having count(*) filter (where st='no_show') > 0
),
flags as (
  select n.*, kl.telefone as tel_kommo, kl.nome as nome_kommo, kl.email as email_kommo,
    (exists(select 1 from compareceu_tel c where c.tel=n.tel)
     or exists(select 1 from compareceu_lead c where n.leads is not null and c.lead_id = any(n.leads))) as compareceu,
    (exists(select 1 from futuro_tel f2 where f2.tel=n.tel)
     or exists(select 1 from futuro_lead f2 where n.leads is not null and f2.lead_id = any(n.leads))) as reagendado_futuro,
    exists(select 1 from contrato_pess cp where cp.tel=n.tel
           or (cp.lead_txt is not null and n.leads is not null and cp.lead_txt::bigint = any(n.leads))) as tem_contrato,
    (exists(select 1 from cli_tel ct where ct.tel=n.tel)
     or exists(select 1 from cli_lead cj where n.leads is not null and cj.lead_txt::bigint = any(n.leads))) as ja_cliente
  from ns n
  left join lateral (
    select telefone, nome, email from public.kommo_leads where lead_id = n.lead_recente::text limit 1
  ) kl on true
)
select
  f.tel as telefone,
  w.whatsapp_e164,
  coalesce(f.nome, f.nome_kommo) as nome,
  coalesce(f.email, f.email_kommo) as email,
  f.lead_recente as kommo_lead_id,
  case when f.lead_recente is not null
       then 'https://advocaciacbc.kommo.com/leads/detail/'||f.lead_recente end as link_kommo,
  split_part(coalesce(f.vendedora,''),'@',1) as vendedora,
  f.qtd_noshow,
  f.primeiro_noshow,
  f.ultimo_noshow,
  f.qtd_agendamentos,
  f.compareceu,
  f.tem_contrato,
  f.ja_cliente,
  f.reagendado_futuro,
  (not f.compareceu and not f.tem_contrato and not f.ja_cliente and not f.reagendado_futuro) as elegivel_recuperacao,
  case
    when f.compareceu then 'compareceu_outra_call'
    when f.tem_contrato then 'virou_contrato'
    when f.ja_cliente then 'ja_cliente'
    when f.reagendado_futuro then 'reagendado'
    else 'elegivel'
  end as situacao
from flags f
cross join lateral (
  select case
    when f.tel_kommo is not null then
      case when length(kk.d) = 10 and substr(kk.d,3,1) in ('6','7','8','9')
           then '55'||left(kk.d,2)||'9'||substr(kk.d,3)
           else '55'||kk.d end
    when substr(f.tel,3,1) in ('6','7','8','9') then '55'||left(f.tel,2)||'9'||substr(f.tel,3)
    else '55'||f.tel
  end as whatsapp_e164
  from (select case when f.tel_kommo ~ '^55' then substr(f.tel_kommo,3) else coalesce(f.tel_kommo,'') end as d) kk
) w;

comment on view public.vw_noshow_acervo is
'Acervo de faltas (no-show) em videochamadas: 1 linha por pessoa (telefone canonico DDD+8). qtd_noshow = vezes que agendou e nao compareceu; flags compareceu/tem_contrato/ja_cliente/reagendado_futuro; elegivel_recuperacao = nenhuma flag (lista de disparo WhatsApp). Auto-atualizada a partir de agenda_videochamadas. Criada 31/07/2026.';

revoke all on public.vw_noshow_acervo from anon;
grant select on public.vw_noshow_acervo to authenticated;
grant select on public.vw_noshow_acervo to powerbi_cbc;
