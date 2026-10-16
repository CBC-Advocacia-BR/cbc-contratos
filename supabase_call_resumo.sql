-- =============================================================================
-- Resumo automatico da videochamada de venda pelo Claude (16/10/2026)
--
-- Le a transcricao do Meet de cada videochamada REALIZADA (agenda_videochamadas, status
-- reconciliado pelo meet-auditoria-sync), pede ao Claude a ficha do atendimento e grava aqui.
-- Opcionalmente posta a nota no lead do Kommo (bot_config.call_resumo.postar_kommo).
--
-- Function: call-resumo-cron (agenda) -> call-resumo-worker-background (trabalho).
-- Lógica pura: client/netlify/functions/_lib/callResumo.mjs.
--
-- LGPD: a transcricao NAO e copiada para o banco (fica no Drive da vendedora); guardamos
-- so o id do documento e o resultado estruturado.
-- Acesso: RLS ligada e SEM policy (mesmo padrao de agenda_videochamadas): anon e
-- authenticated nao leem. Escrita/leitura so pelas RPCs com BOT_RPC_SECRET.
--
-- Aditiva: nao altera nenhuma tabela existente. Nasce DESLIGADA (call_resumo.ativo=false).
-- =============================================================================

create table if not exists public.call_resumos (
  event_id              text primary key,             -- = agenda_videochamadas.event_id
  vendedora_email       text,
  lead_id               text,                         -- lead do Kommo (quando reconciliado)
  scheduled_at          timestamptz,
  status                text not null check (status in (
                          'ok',                 -- resumo gerado
                          'sem_atendimento',    -- o modelo leu e nao era conversa de venda
                          'sem_transcricao',    -- ainda nao gerada / transcricao desligada (re-tenta)
                          'transcricao_curta',  -- cliente entrou e saiu
                          'transcricao_longa',  -- conferir a mao (call esquecida aberta?)
                          'recusado',           -- o modelo recusou (stop_reason=refusal)
                          'erro')),             -- falha tecnica (re-tenta)
  tentativas            integer not null default 0,
  transcricao_file_id   text,
  transcricao_tipo      text,                         -- transcricao | anotacoes_gemini
  transcricao_origem    text,                         -- anexo_evento | busca_drive
  transcricao_chars     integer,
  resumo                jsonb,                        -- saida completa (ver SCHEMA em callResumo.mjs)
  temperatura           text,
  alerta_compliance     boolean not null default false,
  nota_kommo            text,
  kommo_postado_em      timestamptz,
  kommo_erro            text,
  modelo                text,
  tokens_entrada        integer,
  tokens_saida          integer,
  custo_usd             numeric(10,4),
  erro                  text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

create index if not exists idx_call_resumos_lead on public.call_resumos(lead_id);
create index if not exists idx_call_resumos_status on public.call_resumos(status, atualizado_em);
create index if not exists idx_call_resumos_compliance on public.call_resumos(scheduled_at desc) where alerta_compliance;

alter table public.call_resumos enable row level security;

-- Fila: calls realizadas nos ultimos p_dias, terminadas ha 40+ min (o Google leva alguns
-- minutos para gerar a transcricao), ainda sem resumo ou em re-tentativa espacada.
create or replace function public.call_resumo_pendentes(p_chave text, p_dias integer default 3, p_limite integer default 8)
returns table(event_id text, vendedora_email text, cliente_nome text, scheduled_at timestamptz, lead_id text, tentativas integer)
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
  select a.event_id, a.vendedora_email, a.cliente_nome, a.scheduled_at, a.lead_id::text, coalesce(r.tentativas, 0)
  from agenda_videochamadas a
  left join call_resumos r on r.event_id = a.event_id
  where coalesce(a.status, '') <> 'excluida'
    and coalesce(a.meet_status, a.status) in ('realizada', 'fechou')
    and a.scheduled_at >= now() - make_interval(days => least(greatest(p_dias, 1), 30))
    and a.scheduled_at <= now() - interval '40 minutes'
    and (r.event_id is null
         or (r.status in ('sem_transcricao', 'erro') and r.tentativas < 8
             and r.atualizado_em < now() - interval '50 minutes'))
  order by a.scheduled_at
  limit least(greatest(p_limite, 1), 50);
end $fn$;

-- Uma call especifica (reprocessamento manual), sem filtro de status/janela.
create or replace function public.call_resumo_um(p_chave text, p_event_id text)
returns table(event_id text, vendedora_email text, cliente_nome text, scheduled_at timestamptz, lead_id text, tentativas integer)
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
  select a.event_id, a.vendedora_email, a.cliente_nome, a.scheduled_at, a.lead_id::text,
         coalesce((select r.tentativas from call_resumos r where r.event_id = a.event_id), 0)
  from agenda_videochamadas a
  where a.event_id = p_event_id;
end $fn$;

-- Grava o resultado de uma tentativa (upsert; conta a tentativa).
create or replace function public.call_resumo_gravar(p_chave text, p_row jsonb)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare x call_resumos;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  x := jsonb_populate_record(null::call_resumos, p_row);
  if x.event_id is null then raise exception 'event_id obrigatorio'; end if;
  insert into call_resumos as c (event_id, vendedora_email, lead_id, scheduled_at, status, tentativas,
      transcricao_file_id, transcricao_tipo, transcricao_origem, transcricao_chars, resumo, temperatura,
      alerta_compliance, nota_kommo, modelo, tokens_entrada, tokens_saida, custo_usd, erro)
  values (x.event_id, x.vendedora_email, x.lead_id, x.scheduled_at, x.status, 1,
      x.transcricao_file_id, x.transcricao_tipo, x.transcricao_origem, x.transcricao_chars, x.resumo, x.temperatura,
      coalesce(x.alerta_compliance, false), x.nota_kommo, x.modelo, x.tokens_entrada, x.tokens_saida, x.custo_usd, x.erro)
  on conflict (event_id) do update set
      vendedora_email     = excluded.vendedora_email,
      lead_id             = excluded.lead_id,
      scheduled_at        = excluded.scheduled_at,
      status              = excluded.status,
      tentativas          = c.tentativas + 1,
      transcricao_file_id = coalesce(excluded.transcricao_file_id, c.transcricao_file_id),
      transcricao_tipo    = coalesce(excluded.transcricao_tipo, c.transcricao_tipo),
      transcricao_origem  = coalesce(excluded.transcricao_origem, c.transcricao_origem),
      transcricao_chars   = coalesce(excluded.transcricao_chars, c.transcricao_chars),
      resumo              = coalesce(excluded.resumo, c.resumo),
      temperatura         = coalesce(excluded.temperatura, c.temperatura),
      -- so um resumo novo redefine o alerta (uma tentativa com erro nao apaga o anterior)
      alerta_compliance   = case when excluded.resumo is not null then excluded.alerta_compliance else c.alerta_compliance end,
      nota_kommo          = coalesce(excluded.nota_kommo, c.nota_kommo),
      modelo              = coalesce(excluded.modelo, c.modelo),
      tokens_entrada      = coalesce(excluded.tokens_entrada, c.tokens_entrada),
      tokens_saida        = coalesce(excluded.tokens_saida, c.tokens_saida),
      custo_usd           = coalesce(excluded.custo_usd, c.custo_usd),
      erro                = excluded.erro,
      atualizado_em       = now();
end $fn$;

-- Resultado do post no Kommo.
create or replace function public.call_resumo_kommo(p_chave text, p_event_id text, p_ok boolean, p_erro text default null)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  update call_resumos set
    kommo_postado_em = case when p_ok then now() else kommo_postado_em end,
    kommo_erro       = case when p_ok then null else left(p_erro, 300) end,
    atualizado_em    = now()
  where event_id = p_event_id;
end $fn$;

-- Configuracao (kill-switch). Nasce DESLIGADA e sem postar no Kommo.
insert into public.bot_config (key, value)
values ('call_resumo', jsonb_build_object(
  'ativo', false,            -- liga/desliga a rotina inteira
  'postar_kommo', false,     -- false = so grava em call_resumos (fase de conferencia)
  'modelo', 'claude-opus-5-5',
  'esforco', 'medium',       -- low | medium | high
  'max_por_rodada', 8,
  'dias', 3))
on conflict (key) do nothing;

-- ROLLBACK:
--   drop function if exists public.call_resumo_pendentes(text, integer, integer);
--   drop function if exists public.call_resumo_um(text, text);
--   drop function if exists public.call_resumo_gravar(text, jsonb);
--   drop function if exists public.call_resumo_kommo(text, text, boolean, text);
--   drop table if exists public.call_resumos;
--   delete from public.bot_config where key = 'call_resumo';
