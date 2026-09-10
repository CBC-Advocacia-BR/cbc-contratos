-- SDR de IA (Ana) v6 — 08/09/2026: memoria por CONTATO (resumo de sessoes anteriores, Haiku 4.5).
-- Entra no [Contexto] de cada turno (~200 tokens) e encurta o historico cru. RLS ligada, sem
-- policies: acesso so pelas RPCs security definer + _bot_chave_ok (padrao de todo o modulo).
create table if not exists sdr_ia_memoria (
  contact_id bigint primary key, fone text, lead_id bigint,
  resumo text not null default '', fatos jsonb not null default '{}'::jsonb,
  msgs_ate timestamptz, n_msgs integer not null default 0, modelo text,
  custo_usd numeric(10,6) not null default 0,
  atualizado_em timestamptz not null default now(), criado_em timestamptz not null default now()
);
alter table sdr_ia_memoria enable row level security;
revoke all on sdr_ia_memoria from anon, authenticated;
create or replace function sdr_ia_memoria_get(p_chave text, p_contact_id bigint)
returns setof sdr_ia_memoria language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query select * from sdr_ia_memoria where contact_id = p_contact_id;
end $$;
create or replace function sdr_ia_memoria_set(p_chave text, p_row jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  insert into sdr_ia_memoria (contact_id, fone, lead_id, resumo, fatos, msgs_ate, n_msgs, modelo, custo_usd, atualizado_em)
  values ((p_row->>'contact_id')::bigint, p_row->>'fone', (p_row->>'lead_id')::bigint, coalesce(p_row->>'resumo',''), coalesce(p_row->'fatos','{}'::jsonb),
          (p_row->>'msgs_ate')::timestamptz, coalesce((p_row->>'n_msgs')::int, 0), p_row->>'modelo', coalesce((p_row->>'custo_usd')::numeric, 0), coalesce((p_row->>'atualizado_em')::timestamptz, now()))
  on conflict (contact_id) do update set
    fone = excluded.fone, lead_id = excluded.lead_id, resumo = excluded.resumo, fatos = excluded.fatos, msgs_ate = excluded.msgs_ate,
    n_msgs = excluded.n_msgs, modelo = excluded.modelo, custo_usd = sdr_ia_memoria.custo_usd + excluded.custo_usd, atualizado_em = excluded.atualizado_em;
end $$;
revoke all on function sdr_ia_memoria_get(text, bigint) from public, anon, authenticated;
revoke all on function sdr_ia_memoria_set(text, jsonb) from public, anon, authenticated;
grant execute on function sdr_ia_memoria_get(text, bigint) to anon, authenticated;
grant execute on function sdr_ia_memoria_set(text, jsonb) to anon, authenticated;
