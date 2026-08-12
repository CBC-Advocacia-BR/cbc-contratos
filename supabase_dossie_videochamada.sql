-- Dossie institucional por e-mail ao agendar videochamada (12/08/2026).
-- Spec:  docs/superpowers/specs/2026-08-12-dossie-videochamada-email-design.md
-- Plano: docs/superpowers/plans/2026-08-12-dossie-videochamada-email.md
--
-- A RLS de agenda_videochamadas e FECHADA (PII de cliente), entao a function nao
-- le nem escreve direto: passa por estas RPCs, protegidas por BOT_RPC_SECRET, no
-- mesmo padrao do agenda_videochamadas_upsert que ja existe.

alter table public.agenda_videochamadas
  add column if not exists primeiro_visto_em timestamptz not null default now(),
  add column if not exists dossie_email_em timestamptz,
  add column if not exists dossie_email_erro text,
  add column if not exists dossie_email_tentativas smallint not null default 0;

comment on column public.agenda_videochamadas.primeiro_visto_em is
  'Quando o sync viu este evento pela PRIMEIRA vez. E o que sustenta o corte do '
  'dossie ("so vale de tal momento em diante"). Nao confundir com updated_at, que '
  'muda a cada rodada do sync e por isso nao serve de marco. O agenda_videochamadas_upsert '
  'nao toca nesta coluna no ON CONFLICT, entao ela fica congelada na primeira insercao.';

-- ── a trava contra o envio retroativo ──────────────────────────────────────
-- As 3.036 linhas que ja existiam recebem o default now() na criacao da coluna, o
-- que as faria parecer recem-vistas e, num corte mal posicionado, dispararia
-- e-mail para gente cuja videochamada aconteceu semanas atras.
--
-- Elas levam um marco de LEGADO explicito, e nao uma data aproximada: para linha
-- antiga a resposta a "foi vista antes do corte?" e inequivocamente sim, e um
-- sentinela antigo torna impossivel passar por qualquer corte realista, inclusive
-- se alguem configurar o corte com data no passado por engano.
update public.agenda_videochamadas
   set primeiro_visto_em = timestamptz '2000-01-01 00:00:00+00'
 where primeiro_visto_em >= now() - interval '10 minutes';

create index if not exists idx_agenda_dossie_pendente
  on public.agenda_videochamadas (scheduled_at)
  where dossie_email_em is null and status = 'agendada';

-- ── quem esta esperando dossie ─────────────────────────────────────────────
-- Devolve as candidatas cruas. A decisao de elegibilidade fica no codigo
-- (_lib/dossieVideochamada.mjs), que e testado; aqui so o filtro grosso que evita
-- trazer milhares de linhas do banco a cada rodada.
create or replace function public.dossie_pendentes(p_chave text, p_limite integer default 50)
returns table (
  event_id text, vendedora_email text, cliente_email text, cliente_nome text,
  status text, scheduled_at timestamptz, primeiro_visto_em timestamptz,
  titulo text, lead_id bigint, nome_kommo text,
  dossie_email_em timestamptz, dossie_email_tentativas smallint
)
language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
    select a.event_id, a.vendedora_email, a.cliente_email, a.cliente_nome,
           a.status, a.scheduled_at, a.primeiro_visto_em,
           a.raw->>'summary', a.lead_id, k.nome,
           a.dossie_email_em, a.dossie_email_tentativas
      from agenda_videochamadas a
      left join kommo_leads k on k.lead_id::bigint = a.lead_id
     where a.dossie_email_em is null
       and a.status = 'agendada'
       and a.scheduled_at > now()
       and coalesce(a.cliente_email,'') <> ''
       and a.dossie_email_tentativas < 3
     order by a.scheduled_at
     limit greatest(1, least(coalesce(p_limite, 50), 200));
end $$;

-- ── registrar o resultado ──────────────────────────────────────────────────
create or replace function public.dossie_marcar(p_chave text, p_event_id text,
                                                p_erro text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_erro is null then
    update agenda_videochamadas
       set dossie_email_em = now(), dossie_email_erro = null,
           dossie_email_tentativas = dossie_email_tentativas + 1
     where event_id = p_event_id;
  else
    -- falha NAO marca dossie_email_em: a linha volta na proxima rodada, ate o teto
    update agenda_videochamadas
       set dossie_email_erro = left(p_erro, 300),
           dossie_email_tentativas = dossie_email_tentativas + 1
     where event_id = p_event_id;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.dossie_pendentes(text, integer) from public, anon;
revoke all on function public.dossie_marcar(text, text, text) from public, anon;
