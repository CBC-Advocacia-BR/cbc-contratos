-- ============================================================================
-- MÓDULO CHAT — Portal do Cliente (cbc-contratos) ↔ CBC Conversas (chatguru-export)
-- 2026-07-01. Canônico: este arquivo. Aplicado via Supabase MCP (apply_migration).
--
-- DELTA v2 (2026-07-02, migração `chat_portal_cpf_fallback_v2`): tokens sem CPF
-- (caso ANDRESSA BICK) quebravam o envio do cliente. Backfill de
-- cliente_portal_tokens.cpf a partir de bi_clientes + função
-- public.chat_token_cpf(p_token) (resolve CPF do token com fallback no espelho
-- Advbox) usada por chat_cliente_enviar/listar/badge. As versões abaixo dessas
-- 3 funções são a v1; a definição v2 vigente está no histórico de migrações do
-- Supabase (supabase_migrations.schema_migrations).
--
-- SEGURANÇA (deliberadamente diferente do padrão bot_allow_all do portal):
--   · Tabelas no schema `chat` com RLS deny-all — anon/authenticated NÃO acessam.
--   · Todo acesso via RPCs public.chat_* (SECURITY DEFINER), com EXECUTE
--     revogado de public/anon/authenticated e concedido só a service_role.
--   · As Netlify Functions (portal-chat.mjs no cbc-contratos; chat.mjs no
--     viewer do chatguru-export) usam a service key e são as únicas portas.
--   · Cliente se autentica pelo token de public.cliente_portal_tokens
--     (validado DENTRO da RPC — o token nunca dá acesso direto ao banco).
--
-- REALTIME (não ativado — ver docs CHAT-PORTAL.md, seção "Ativação futura"):
--   O MVP usa polling. Para ativar depois:
--     alter publication supabase_realtime add table chat.mensagens;
--   e criar policies de SELECT por cliente (exige repensar auth do portal).
-- ============================================================================

create schema if not exists chat;

-- 1 thread por cliente (CPF em dígitos é a chave de negócio; casa com
-- cliente_portal_tokens.cpf e com atendimento.contatos via telefone/ecossistema)
create table if not exists chat.threads (
  id                    uuid primary key default gen_random_uuid(),
  cpf                   text not null unique,          -- só dígitos
  nome                  text,
  advbox_customer_id    bigint,
  status                text not null default 'aberta',   -- aberta | resolvida
  criada_em             timestamptz not null default now(),
  ultima_msg_em         timestamptz,
  ultima_msg_texto      text,
  ultima_msg_autor      text,                          -- cliente | escritorio
  nao_lidas_escritorio  int not null default 0,        -- p/ badge no CBC Conversas
  nao_lidas_cliente     int not null default 0         -- p/ badge no portal
);

create table if not exists chat.mensagens (
  id           bigint generated always as identity primary key,
  thread_id    uuid not null references chat.threads(id) on delete cascade,
  autor        text not null check (autor in ('cliente','escritorio')),
  autor_email  text,                                   -- e-mail do colaborador (autor=escritorio)
  autor_nome   text,                                   -- nome exibido em negrito no portal
  corpo        text not null check (length(corpo) between 1 and 4000),
  criada_em    timestamptz not null default now()
);

create index if not exists idx_chat_msg_thread_id on chat.mensagens (thread_id, id);
create index if not exists idx_chat_threads_ultima on chat.threads (ultima_msg_em desc nulls last);
create index if not exists idx_chat_threads_nao_lidas on chat.threads (nao_lidas_escritorio) where nao_lidas_escritorio > 0;

-- RLS deny-all: sem policies = nega tudo p/ anon/authenticated
alter table chat.threads   enable row level security;
alter table chat.mensagens enable row level security;

revoke all on schema chat from public, anon, authenticated;
revoke all on all tables    in schema chat from public, anon, authenticated;
revoke all on all sequences in schema chat from public, anon, authenticated;

grant usage on schema chat to service_role;
grant all on all tables    in schema chat to service_role;
grant all on all sequences in schema chat to service_role;

alter default privileges in schema chat grant all on tables    to service_role;
alter default privileges in schema chat grant all on sequences to service_role;

-- ============================================================================
-- RPCs (em public porque `chat` não está nos "Exposed schemas" do PostgREST;
-- as tabelas continuam trancadas no schema chat)
-- ============================================================================

-- ---- LADO CLIENTE (portal) --------------------------------------------------

-- Envia mensagem do cliente. Token do portal é a credencial.
create or replace function public.chat_cliente_enviar(p_token text, p_corpo text)
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
declare
  v_tk record; v_cpf text; v_thread uuid; v_corpo text; v_id bigint; v_em timestamptz;
begin
  v_corpo := btrim(coalesce(p_corpo, ''));
  if length(v_corpo) < 1 then return jsonb_build_object('ok', false, 'erro', 'vazio'); end if;
  if length(v_corpo) > 4000 then return jsonb_build_object('ok', false, 'erro', 'longo'); end if;

  select t.cpf, t.nome, t.advbox_customer_id into v_tk
    from public.cliente_portal_tokens t
   where t.token = p_token and t.ativo = true limit 1;
  if not found then return jsonb_build_object('ok', false, 'erro', 'token'); end if;

  v_cpf := regexp_replace(coalesce(v_tk.cpf, ''), '\D', '', 'g');
  if v_cpf = '' then return jsonb_build_object('ok', false, 'erro', 'cpf'); end if;

  insert into chat.threads (cpf, nome, advbox_customer_id)
  values (v_cpf, v_tk.nome, v_tk.advbox_customer_id)
  on conflict (cpf) do update set nome = coalesce(chat.threads.nome, excluded.nome)
  returning id into v_thread;

  insert into chat.mensagens (thread_id, autor, corpo)
  values (v_thread, 'cliente', v_corpo)
  returning id, criada_em into v_id, v_em;

  update chat.threads set
    ultima_msg_em = v_em, ultima_msg_texto = left(v_corpo, 160),
    ultima_msg_autor = 'cliente',
    nao_lidas_escritorio = nao_lidas_escritorio + 1,
    status = 'aberta'
  where id = v_thread;

  return jsonb_build_object('ok', true, 'id', v_id, 'thread_id', v_thread, 'criada_em', v_em);
end $$;

-- Lista mensagens da thread do cliente (incremental via p_apos) e zera o
-- contador de não-lidas do cliente (abrir a aba = ler).
create or replace function public.chat_cliente_listar(p_token text, p_apos bigint default 0)
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
declare
  v_tk record; v_cpf text; v_thread chat.threads%rowtype; v_msgs jsonb;
begin
  select t.cpf into v_tk
    from public.cliente_portal_tokens t
   where t.token = p_token and t.ativo = true limit 1;
  if not found then return jsonb_build_object('ok', false, 'erro', 'token'); end if;

  v_cpf := regexp_replace(coalesce(v_tk.cpf, ''), '\D', '', 'g');
  select * into v_thread from chat.threads where cpf = v_cpf limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'mensagens', '[]'::jsonb, 'nao_lidas', 0);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'autor', m.autor, 'autor_nome', m.autor_nome,
           'corpo', m.corpo, 'criada_em', m.criada_em) order by m.id), '[]'::jsonb)
    into v_msgs
    from (select * from chat.mensagens
           where thread_id = v_thread.id and id > coalesce(p_apos, 0)
           order by id limit 300) m;

  update chat.threads set nao_lidas_cliente = 0
   where id = v_thread.id and nao_lidas_cliente > 0;

  return jsonb_build_object('ok', true, 'thread_id', v_thread.id,
    'status', v_thread.status, 'mensagens', v_msgs);
end $$;

-- Só o badge (sem marcar como lida): o portal chama no carregamento inicial.
create or replace function public.chat_cliente_badge(p_token text)
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
declare v_tk record; v_cpf text; v_n int;
begin
  select t.cpf into v_tk
    from public.cliente_portal_tokens t
   where t.token = p_token and t.ativo = true limit 1;
  if not found then return jsonb_build_object('ok', false, 'erro', 'token'); end if;
  v_cpf := regexp_replace(coalesce(v_tk.cpf, ''), '\D', '', 'g');
  select nao_lidas_cliente into v_n from chat.threads where cpf = v_cpf limit 1;
  return jsonb_build_object('ok', true, 'nao_lidas', coalesce(v_n, 0));
end $$;

-- ---- LADO EQUIPE (CBC Conversas) -------------------------------------------

create or replace function public.chat_equipe_threads(p_lim int default 60, p_off int default 0)
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
declare v_total bigint; v_rows jsonb;
begin
  select count(*) into v_total from chat.threads;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'cpf', t.cpf, 'nome', t.nome, 'status', t.status,
           'ultima_msg_em', t.ultima_msg_em, 'ultima_msg_texto', t.ultima_msg_texto,
           'ultima_msg_autor', t.ultima_msg_autor, 'nao_lidas', t.nao_lidas_escritorio)
           order by t.ultima_msg_em desc nulls last), '[]'::jsonb)
    into v_rows
    from (select * from chat.threads
           order by ultima_msg_em desc nulls last
           limit greatest(1, least(coalesce(p_lim,60), 200))
           offset greatest(0, coalesce(p_off,0))) t;
  return jsonb_build_object('ok', true, 'total', v_total, 'threads', v_rows);
end $$;

create or replace function public.chat_equipe_mensagens(p_thread uuid, p_apos bigint default 0)
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
declare v_msgs jsonb; v_t chat.threads%rowtype;
begin
  select * into v_t from chat.threads where id = p_thread;
  if not found then return jsonb_build_object('ok', false, 'erro', 'thread'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'autor', m.autor, 'autor_nome', m.autor_nome,
           'autor_email', m.autor_email, 'corpo', m.corpo, 'criada_em', m.criada_em)
           order by m.id), '[]'::jsonb)
    into v_msgs
    from (select * from chat.mensagens
           where thread_id = p_thread and id > coalesce(p_apos, 0)
           order by id limit 500) m;

  update chat.threads set nao_lidas_escritorio = 0
   where id = p_thread and nao_lidas_escritorio > 0;

  return jsonb_build_object('ok', true, 'thread', jsonb_build_object(
    'id', v_t.id, 'cpf', v_t.cpf, 'nome', v_t.nome, 'status', v_t.status),
    'mensagens', v_msgs);
end $$;

create or replace function public.chat_equipe_enviar(
  p_thread uuid, p_corpo text, p_email text, p_nome text)
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
declare v_corpo text; v_id bigint; v_em timestamptz;
begin
  v_corpo := btrim(coalesce(p_corpo, ''));
  if length(v_corpo) < 1 then return jsonb_build_object('ok', false, 'erro', 'vazio'); end if;
  if length(v_corpo) > 4000 then return jsonb_build_object('ok', false, 'erro', 'longo'); end if;
  if not exists (select 1 from chat.threads where id = p_thread) then
    return jsonb_build_object('ok', false, 'erro', 'thread');
  end if;

  insert into chat.mensagens (thread_id, autor, autor_email, autor_nome, corpo)
  values (p_thread, 'escritorio', lower(coalesce(p_email,'')), coalesce(p_nome,''), v_corpo)
  returning id, criada_em into v_id, v_em;

  update chat.threads set
    ultima_msg_em = v_em, ultima_msg_texto = left(v_corpo, 160),
    ultima_msg_autor = 'escritorio',
    nao_lidas_cliente = nao_lidas_cliente + 1
  where id = p_thread;

  return jsonb_build_object('ok', true, 'id', v_id, 'criada_em', v_em);
end $$;

-- Abre (ou encontra) a thread de um cliente pelo CPF — permite a equipe
-- iniciar a conversa antes do cliente escrever.
create or replace function public.chat_equipe_abrir_por_cpf(p_cpf text, p_nome text default null)
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
declare v_cpf text; v_id uuid;
begin
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf) not in (11, 14) then return jsonb_build_object('ok', false, 'erro', 'cpf'); end if;
  insert into chat.threads (cpf, nome) values (v_cpf, p_nome)
  on conflict (cpf) do update set nome = coalesce(chat.threads.nome, excluded.nome)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'thread_id', v_id);
end $$;

create or replace function public.chat_equipe_status(p_thread uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
begin
  if p_status not in ('aberta','resolvida') then
    return jsonb_build_object('ok', false, 'erro', 'status');
  end if;
  update chat.threads set status = p_status where id = p_thread;
  if not found then return jsonb_build_object('ok', false, 'erro', 'thread'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Badge global p/ o CBC Conversas (threads com msgs de cliente não lidas)
create or replace function public.chat_equipe_resumo()
returns jsonb
language plpgsql security definer set search_path = chat, public
as $$
declare v_threads bigint; v_nao_lidas bigint;
begin
  select count(*), coalesce(sum(nao_lidas_escritorio), 0)
    into v_threads, v_nao_lidas
    from chat.threads where nao_lidas_escritorio > 0;
  return jsonb_build_object('ok', true, 'threads_pendentes', v_threads, 'mensagens_nao_lidas', v_nao_lidas);
end $$;

-- ---- Grants: EXECUTE só p/ service_role -------------------------------------
revoke execute on function public.chat_cliente_enviar(text, text)            from public, anon, authenticated;
revoke execute on function public.chat_cliente_listar(text, bigint)          from public, anon, authenticated;
revoke execute on function public.chat_cliente_badge(text)                   from public, anon, authenticated;
revoke execute on function public.chat_equipe_threads(int, int)              from public, anon, authenticated;
revoke execute on function public.chat_equipe_mensagens(uuid, bigint)        from public, anon, authenticated;
revoke execute on function public.chat_equipe_enviar(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.chat_equipe_abrir_por_cpf(text, text)      from public, anon, authenticated;
revoke execute on function public.chat_equipe_status(uuid, text)             from public, anon, authenticated;
revoke execute on function public.chat_equipe_resumo()                       from public, anon, authenticated;

grant execute on function public.chat_cliente_enviar(text, text)             to service_role;
grant execute on function public.chat_cliente_listar(text, bigint)           to service_role;
grant execute on function public.chat_cliente_badge(text)                    to service_role;
grant execute on function public.chat_equipe_threads(int, int)               to service_role;
grant execute on function public.chat_equipe_mensagens(uuid, bigint)         to service_role;
grant execute on function public.chat_equipe_enviar(uuid, text, text, text)  to service_role;
grant execute on function public.chat_equipe_abrir_por_cpf(text, text)       to service_role;
grant execute on function public.chat_equipe_status(uuid, text)              to service_role;
grant execute on function public.chat_equipe_resumo()                        to service_role;
