-- ============================================================================
-- Fix 29/06/2026 — Sync do Asaas ignorava boletos em NEGATIVACAO (DUNNING_*)
-- ----------------------------------------------------------------------------
-- Sintoma: a lista de devedores exportada do site do Asaas nao batia com o
-- sistema (Asaas mostrava 77 devedores; o sistema ~74). Diff export x espelho:
-- das 234 cobrancas em aberto, 7 estavam AUSENTES do asaas_boletos — todas em
-- negativacao, de 3 devedores, somando R$ 2.800.
--
-- Causa raiz: client/netlify/functions/_lib/asaasMirror.mjs varria so
--   STATUSES = [PENDING, OVERDUE, RECEIVED, CONFIRMED, RECEIVED_IN_CASH]
-- e nunca buscava /payments?status=DUNNING_REQUESTED|DUNNING_RECEIVED.
--
-- Correcao (codigo): STATUSES passou a incluir DUNNING_REQUESTED + DUNNING_RECEIVED;
-- PAID_STATUSES ganhou DUNNING_RECEIVED (negativacao paga = bucket pago).
--
-- Correcao (banco, este arquivo): a contagem de inadimplencia (snapshot diario)
-- e os conjuntos "aberto" da reconciliacao passam a incluir DUNNING_REQUESTED
-- (negativacao em aberto = divida). DUNNING_RECEIVED fica fora (ja foi pago).
-- Ja aplicado em producao via MCP apply_migration (migration
-- inadimplencia_incluir_dunning_requested) em 29/06/2026.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.inadimplencia_snapshot()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into inadimplencia_historico (dia, clientes, parcelas, total, maior_atraso_dias)
  select current_date,
    count(distinct coalesce(nullif(regexp_replace(coalesce(customer_cpf,''), '[^0-9]', '', 'g'), ''), customer_name)),
    count(*),
    coalesce(sum(value), 0),
    coalesce(max(current_date - due_date), 0)
  from asaas_boletos
  where status in ('OVERDUE','DUNNING_REQUESTED') or (status = 'PENDING' and due_date < current_date)
  on conflict (dia) do update set
    clientes = excluded.clientes, parcelas = excluded.parcelas,
    total = excluded.total, maior_atraso_dias = excluded.maior_atraso_dias;
$function$;

CREATE OR REPLACE FUNCTION public.asaas_mirror_stale_open(p_chave text, p_before timestamp with time zone, p_limit integer DEFAULT 120)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return coalesce((select array_agg(id) from (
    select id from asaas_boletos
    where status in ('PENDING','OVERDUE','DUNNING_REQUESTED') and (synced_at is null or synced_at < p_before)
    order by due_date limit p_limit) t), '{}');
end $function$;

CREATE OR REPLACE FUNCTION public.asaas_mirror_open_by_customer(p_chave text, p_customer_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return coalesce((select array_agg(id) from asaas_boletos
    where customer_id = p_customer_id and status in ('PENDING','OVERDUE','DUNNING_REQUESTED')), '{}');
end $function$;
