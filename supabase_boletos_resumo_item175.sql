-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria 01/08/2026 — item 175
-- Aplicado em producao em 02/08/2026 (migracao boletos_resumo_rpc_item175)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A aba Boletos paginava ~12.921 boletos em 13 idas ao banco, uma apos a outra, para
-- calcular meia duzia de somas no navegador. Sao 1.333 clientes distintos: o servidor
-- devolve o agregado por cliente em UMA requisicao, ~10x menos dados. E a maior
-- economia de banda do aplicativo.
--
-- Esta funcao e TRADUCAO FIEL do useMemo boletoStats que rodava em BoletosPanel.jsx.
-- Regras sutis que precisam ser mantidas (qualquer desvio vira inadimplencia errada):
--   1. `total` por cliente soma TUDO (pago + pendente + vencido) e IGNORA o filtro de
--      datas — no JS ele e somado ANTES do return que aplica o filtro;
--   2. vencido exige due_date NAO NULO (`b.due_date && b.due_date < hoje`); boleto sem
--      vencimento cai em pendente;
--   3. o filtro de datas vale para vencidos (por due_date) e pagos (por payment_date,
--      caindo para due_date), NUNCA para pendentes;
--   4. removido (DELETED) e neutro (estorno/chargeback) ficam fora de tudo, inclusive
--      do total do cliente.
--
-- CONFERIDO ANTES DA TROCA (02/08/2026):
--   - totais sem filtro: 3.003 pendentes / 211 vencidos / 9.490 pagos,
--     R$ 64.944,40 vencidos, 60 clientes inadimplentes — identicos a conta antiga;
--   - comparacao cliente a cliente: 1.319 comparados, ZERO divergencia em total e
--     em vencido, nenhum cliente sobrando de um lado ou do outro;
--   - com filtro jul/2026: 32 vencidos (bate com contagem independente) e o total de
--     PENDENTES nao se move, como manda a regra 3;
--   - `set local role authenticated`: 211 / R$ 64.944,40 / 1.319 clientes (security
--     invoker respeita a RLS, e o app le como authenticated).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.boletos_resumo(
  p_due_from date default null,
  p_due_to   date default null
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with hoje as (
  select (now() at time zone 'America/Sao_Paulo')::date as d
),
base as (
  select
    b.customer_id as cid,
    coalesce(b.value, 0)::numeric as v,
    b.due_date,
    b.payment_date,
    b.status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH','DUNNING_RECEIVED') as pago,
    b.status in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED',
                 'CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL','AWAITING_RISK_ANALYSIS') as neutro,
    b.status = 'DELETED' as removido
  from public.asaas_boletos b
),
util as (
  select
    base.*,
    (not pago and due_date is not null and due_date < (select d from hoje)) as vencido,
    (not pago and (due_date is null or due_date >= (select d from hoje))) as pendente
  from base
  where not neutro and not removido
),
filtrado as (
  select
    u.*,
    case
      when u.vencido then (p_due_from is null or u.due_date >= p_due_from)
                      and (p_due_to   is null or u.due_date <= p_due_to)
      when u.pago    then (p_due_from is null or coalesce(u.payment_date, u.due_date) >= p_due_from)
                      and (p_due_to   is null or coalesce(u.payment_date, u.due_date) <= p_due_to)
      else true
    end as no_periodo
  from util u
),
por_cliente as (
  select
    cid,
    round(sum(v), 2) as total,
    round(coalesce(sum(v) filter (where vencido and no_periodo), 0), 2) as overdue_total,
    coalesce(max((select d from hoje) - due_date) filter (where vencido and no_periodo), 0) as max_overdue_days,
    max(payment_date) filter (where pago and no_periodo) as last_payment,
    bool_or(pendente)               as tem_pendente,
    bool_or(vencido and no_periodo) as tem_vencido,
    bool_or(pago and no_periodo)    as tem_pago
  from filtrado
  where cid is not null
  group by cid
),
totais as (
  select
    count(*) filter (where pendente)               as pending,
    count(*) filter (where vencido and no_periodo) as overdue,
    count(*) filter (where pago and no_periodo)    as paid,
    round(coalesce(sum(v) filter (where pendente), 0), 2)               as "totalPending",
    round(coalesce(sum(v) filter (where vencido and no_periodo), 0), 2) as "totalOverdue",
    round(coalesce(sum(v) filter (where pago and no_periodo), 0), 2)    as "totalPaid",
    count(distinct cid) filter (where vencido and no_periodo and cid is not null) as "clientsOverdue",
    coalesce(max((select d from hoje) - due_date) filter (where vencido and no_periodo), 0) as "maxOverdue"
  from filtrado
)
select jsonb_build_object(
  'totais',   (select to_jsonb(t) from totais t),
  'clientes', coalesce((select jsonb_agg(to_jsonb(c)) from por_cliente c), '[]'::jsonb),
  'linhas',   (select count(*) from filtrado),
  'em',       now()
);
$$;

comment on function public.boletos_resumo(date, date) is
  'Item 175 — agregados de boletos por cliente, para a aba Boletos parar de baixar ~13 mil '
  'linhas por visita. Traducao fiel do useMemo boletoStats do BoletosPanel.jsx: total do '
  'cliente ignora o filtro de datas, vencido exige due_date nao nulo, e o filtro so alcanca '
  'vencidos (por due_date) e pagos (por payment_date). security invoker: respeita a RLS.';

grant execute on function public.boletos_resumo(date, date) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Item 175 (parte 2) — a MESMA falha no painel vizinho
-- Aplicado em 02/08/2026 (migracao asaas_agregado_por_cliente_item175b)
-- ═══════════════════════════════════════════════════════════════════════════
-- Descoberto ao conferir a REDE do navegador depois de corrigir a aba Boletos: o painel
-- Asaas fazia o mesmo em outra escala — 3 requisicoes em lotes de 80 clientes trazendo
-- 2.114 boletos para calcular seis numeros e o pior status de cada um dos 177 clientes.
-- Traducao fiel de loadBoletoAgg (AsaasPanel.jsx). Conferido antes da troca: recebido no
-- mes, em aberto (R$ 472.030) e vencido (R$ 6.100) identicos a conta antiga; 1.996 linhas
-- consideradas viraram 167 na resposta.
create or replace function public.asaas_agregado_clientes(p_cids text[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with hoje as (
  select (now() at time zone 'America/Sao_Paulo')::date as d,
         to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM') as ym
),
b as (
  select
    x.customer_id as cid,
    coalesce(x.value, 0)::numeric as v,
    x.due_date, x.payment_date,
    x.status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH','DUNNING_RECEIVED') as pago
  from public.asaas_boletos x
  where x.customer_id = any(p_cids)
    and x.status not in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED',
                         'CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL','AWAITING_RISK_ANALYSIS','DELETED')
),
c as (
  select b.*,
    (not pago and due_date is not null and due_date < (select d from hoje)) as vencido,
    (not pago and (due_date is null or due_date >= (select d from hoje))) as pendente,
    (pago and to_char(payment_date, 'YYYY-MM') = (select ym from hoje)) as recebido_no_mes
  from b
),
por_cliente as (
  select cid,
    case when bool_or(vencido) then 'OVERDUE'
         when bool_or(pendente) then 'PENDING'
         when bool_or(pago)     then 'RECEIVED'
    end as pior_status
  from c where cid is not null group by cid
),
totais as (
  select
    round(coalesce(sum(v) filter (where recebido_no_mes), 0), 2) as "recebidoMes",
    round(coalesce(sum(v) filter (where pendente), 0), 2)        as "emAberto",
    round(coalesce(sum(v) filter (where vencido), 0), 2)         as "vencido",
    count(*) filter (where recebido_no_mes) as "nRecebidoMes",
    count(*) filter (where pendente)        as "nEmAberto",
    count(*) filter (where vencido)         as "nVencido"
  from c
)
select jsonb_build_object(
  'totais', (select to_jsonb(t) from totais t),
  'porCliente', coalesce((select jsonb_object_agg(cid, pior_status)
                          from por_cliente where pior_status is not null), '{}'::jsonb),
  'linhas', (select count(*) from c)
);
$$;

grant execute on function public.asaas_agregado_clientes(text[]) to authenticated;
