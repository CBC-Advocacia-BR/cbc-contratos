-- supabase_sdr_ia_v1.sql — SDR de IA (Ana fora do horario). Telemetria por chamada,
-- fatos citaveis e RPCs security definer (padrao _bot_chave_ok / BOT_RPC_SECRET).
create table if not exists sdr_ia_turnos (
  id bigint generated always as identity primary key,
  lead_id bigint, conversation_id uuid, contact_id bigint,
  recebido_em timestamptz not null default now(),
  entrada text, entrada_tipo text,
  resposta text,
  ferramentas jsonb,
  modelo text, effort text,
  input_tokens int, cache_read_tokens int, cache_write_tokens int, output_tokens int,
  custo_usd numeric(10,6), latencia_ms int,
  stop_reason text, fallback_model text,
  situacao text,
  erro text
);
create index if not exists idx_sdr_ia_turnos_lead on sdr_ia_turnos (lead_id, recebido_em desc);
create index if not exists idx_sdr_ia_turnos_dia on sdr_ia_turnos (recebido_em desc);
alter table sdr_ia_turnos enable row level security;
revoke all on sdr_ia_turnos from anon, authenticated;

create table if not exists sdr_ia_fatos (
  chave text primary key,
  texto text not null,
  fonte text,
  verificado_por text,
  verificado_em timestamptz,
  ativo boolean not null default true
);
alter table sdr_ia_fatos enable row level security;
revoke all on sdr_ia_fatos from anon, authenticated;

-- grava um turno (linha = jsonb com as colunas acima)
create or replace function sdr_ia_turno_gravar(p_chave text, p_row jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  insert into sdr_ia_turnos (lead_id, conversation_id, contact_id, entrada, entrada_tipo, resposta, ferramentas,
    modelo, effort, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, custo_usd, latencia_ms,
    stop_reason, fallback_model, situacao, erro)
  select r.lead_id, r.conversation_id, r.contact_id, r.entrada, r.entrada_tipo, r.resposta, r.ferramentas,
    r.modelo, r.effort, r.input_tokens, r.cache_read_tokens, r.cache_write_tokens, r.output_tokens, r.custo_usd, r.latencia_ms,
    r.stop_reason, r.fallback_model, r.situacao, r.erro
  from jsonb_populate_record(null::sdr_ia_turnos, p_row) r
  returning id into v_id;
  return v_id;
end $$;

create or replace function sdr_ia_fatos_listar(p_chave text)
returns setof sdr_ia_fatos language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query select * from sdr_ia_fatos where ativo order by chave;
end $$;

-- ultimas mensagens da conversa do contato no espelho atendimento.* (ChatGuru+Kommo), em ordem cronologica
create or replace function sdr_ia_historico(p_chave text, p_contact_id bigint, p_limite int default 40)
returns table (autor text, autor_nome text, corpo text, tipo text, enviada_em timestamptz)
language plpgsql security definer set search_path = public, atendimento as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
    select * from (
      select m.autor, m.autor_nome, m.corpo, m.tipo, m.enviada_em
      from atendimento.contatos c
      join atendimento.conversas cv on cv.contato_id = c.id and cv.excluida_em is null
      join atendimento.mensagens m on m.conversa_id = cv.id
      where c.kommo_contact_id = p_contact_id
      order by m.enviada_em desc limit p_limite
    ) x order by x.enviada_em asc;
end $$;

-- conversas tocadas pela Ana no plantao e ainda nao entregues ao SDR humano
create or replace function sdr_ia_plantao_pendentes(p_chave text)
returns table (channel text, customer_id text, customer_name text, context jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query select b.channel, b.customer_id::text, b.customer_name, b.context
    from bot_conversations b
    where b.channel like 'agenda:%'
      and (b.context->>'plantao_ativo') = 'true'
      and (b.context->>'entregue_em') is null;
end $$;

revoke all on function sdr_ia_turno_gravar(text, jsonb) from public, anon, authenticated;
revoke all on function sdr_ia_fatos_listar(text) from public, anon, authenticated;
revoke all on function sdr_ia_historico(text, bigint, int) from public, anon, authenticated;
revoke all on function sdr_ia_plantao_pendentes(text) from public, anon, authenticated;
grant execute on function sdr_ia_turno_gravar(text, jsonb) to anon, authenticated;
grant execute on function sdr_ia_fatos_listar(text) to anon, authenticated;
grant execute on function sdr_ia_historico(text, bigint, int) to anon, authenticated;
grant execute on function sdr_ia_plantao_pendentes(text) to anon, authenticated;
