-- Migração `dossie_claim_atomico`, aplicada em 14/08/2026.
--
-- REGRA #3 do projeto: toda automação que pode disparar mais de uma vez usa lock
-- atômico. As três filas do e-mail da videochamada (dossiê, lembrete, recuperação)
-- eram SELECT-depois-UPDATE: duas rodadas do worker sobrepostas selecionavam a
-- mesma linha e o cliente recebia o mesmo e-mail duas vezes.
--
-- A janela é estreita (a rodada para em ~25 s e o cron é de 15 min), mas ela abre
-- toda vez que alguém dispara o worker à mão logo depois do cron, que é exatamente
-- o que acontece em dia de mudança.
--
-- A reserva agora acontece DENTRO da própria consulta: quem seleciona já carimba
-- `<fila>_lock_em`, e `for update skip locked` resolve o empate de transações
-- simultâneas. A reserva expira em 10 minutos, para o caso de o worker morrer no
-- meio da rodada.
--
-- ⚠️ Sem parâmetro novo de propósito. Acrescentar um `p_lock_min` criaria uma
-- SEGUNDA assinatura chamável sem argumento, e as duas ficariam ambíguas pelo nome.
-- Foi esse o defeito do `cleanup_old_logs` (ERROR: function is not unique, todo dia,
-- com zero sucessos). Os 10 minutos ficam cravados.
--
-- Conferido em produção, dentro de uma transação revertida: `dossie_pendentes`
-- devolveu 1 linha na primeira chamada e 0 na segunda; a linha ficou com
-- `dossie_lock_em` preenchido e `dossie_email_em` intacto. Mesmo resultado em
-- `lembrete_pendentes` (6 e 0).

alter table agenda_videochamadas
  add column if not exists dossie_lock_em      timestamptz,
  add column if not exists lembrete_lock_em    timestamptz,
  add column if not exists recuperacao_lock_em timestamptz;

comment on column agenda_videochamadas.dossie_lock_em is
  'reserva do worker ao selecionar para envio; expira em 10 min (worker que morreu no meio)';

-- ── 1. DOSSIE ────────────────────────────────────────────────────────────────
create or replace function public.dossie_pendentes(p_chave text, p_limite integer default 50)
returns table(event_id text, vendedora_email text, cliente_email text, cliente_nome text,
              status text, scheduled_at timestamptz, primeiro_visto_em timestamptz,
              titulo text, lead_id bigint, nome_kommo text, meet_link text,
              dossie_email_em timestamptz, dossie_email_tentativas smallint,
              email_aviso_em timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
    with reservados as (
      update agenda_videochamadas a
         set dossie_lock_em = now()
       where a.event_id in (
         select b.event_id
           from agenda_videochamadas b
          where b.dossie_email_em is null
            and b.status = 'agendada'
            and b.scheduled_at > now()
            and coalesce(b.cliente_email,'') <> ''
            and b.dossie_email_tentativas < 3
            and (b.dossie_lock_em is null or b.dossie_lock_em < now() - interval '10 minutes')
          order by b.scheduled_at
          limit greatest(1, least(coalesce(p_limite, 50), 200))
          for update skip locked
       )
      returning a.*
    )
    select r.event_id, r.vendedora_email, r.cliente_email, r.cliente_nome,
           r.status, r.scheduled_at, r.primeiro_visto_em,
           r.raw->>'summary', r.lead_id, k.nome, r.raw->>'meetLink',
           r.dossie_email_em, r.dossie_email_tentativas, r.email_aviso_em
      from reservados r
      left join kommo_leads k on k.lead_id::bigint = r.lead_id
     order by r.scheduled_at;
end $function$;

create or replace function public.dossie_marcar(p_chave text, p_event_id text, p_erro text default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_erro is null then
    update agenda_videochamadas
       set dossie_email_em = now(), dossie_email_erro = null, dossie_lock_em = null,
           dossie_email_tentativas = dossie_email_tentativas + 1
     where event_id = p_event_id;
  else
    -- solta a reserva: o teto de 3 tentativas ja limita a insistencia
    update agenda_videochamadas
       set dossie_email_erro = left(p_erro, 300), dossie_lock_em = null,
           dossie_email_tentativas = dossie_email_tentativas + 1
     where event_id = p_event_id;
  end if;
  get diagnostics n = row_count;
  return n;
end $function$;

-- ── 2. LEMBRETE ──────────────────────────────────────────────────────────────
create or replace function public.lembrete_pendentes(p_chave text, p_horas numeric default 3,
                                                     p_limite integer default 50)
returns table(event_id text, vendedora_email text, cliente_email text,
              scheduled_at timestamptz, titulo text, lead_id bigint, nome_kommo text,
              meet_link text, primeiro_visto_em timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
    with reservados as (
      update agenda_videochamadas a
         set lembrete_lock_em = now()
       where a.event_id in (
         select b.event_id
           from agenda_videochamadas b
          where b.lembrete_em is null
            and b.status = 'agendada'
            and b.scheduled_at > now()
            and b.scheduled_at <= now() + make_interval(mins => (p_horas * 60)::int)
            and coalesce(b.cliente_email,'') <> ''
            and (b.lembrete_lock_em is null or b.lembrete_lock_em < now() - interval '10 minutes')
          order by b.scheduled_at
          limit greatest(1, least(coalesce(p_limite, 50), 200))
          for update skip locked
       )
      returning a.*
    )
    select r.event_id, r.vendedora_email, r.cliente_email,
           r.scheduled_at, r.raw->>'summary', r.lead_id, k.nome,
           r.raw->>'meetLink', r.primeiro_visto_em
      from reservados r
      left join kommo_leads k on k.lead_id::bigint = r.lead_id
     order by r.scheduled_at;
end $function$;

create or replace function public.lembrete_marcar(p_chave text, p_event_id text, p_erro text default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_erro is null then
    update agenda_videochamadas
       set lembrete_em = now(), lembrete_erro = null, lembrete_lock_em = null
     where event_id = p_event_id;
  else
    -- falha nao marca lembrete_em: volta na rodada seguinte enquanto a janela durar
    update agenda_videochamadas
       set lembrete_erro = left(p_erro, 300), lembrete_lock_em = null
     where event_id = p_event_id;
  end if;
  get diagnostics n = row_count;
  return n;
end $function$;

-- ── 3. RECUPERACAO ───────────────────────────────────────────────────────────
create or replace function public.recuperacao_pendentes(p_chave text, p_limite integer default 25)
returns table(event_id text, vendedora_email text, cliente_email text,
              scheduled_at timestamptz, titulo text, lead_id bigint, nome_kommo text,
              primeiro_visto_em timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
    with reservados as (
      update agenda_videochamadas a
         set recuperacao_lock_em = now()
       where a.event_id in (
         select b.event_id
           from agenda_videochamadas b
          where b.recuperacao_em is null
            and coalesce(b.cliente_email,'') <> ''
            and b.scheduled_at < now() - interval '12 hours'
            and b.scheduled_at > now() - interval '7 days'
            -- (a) + (b): faltou pelo Meet E a cor nao contradiz; ou, sem auditoria,
            -- a vendedora afirmou a falta pela cor
            and (
              (b.meet_status = 'no_show' and coalesce(b.status,'') not in ('realizada','fechou','excluida'))
              or (b.meet_status is null and b.status = 'no_show')
            )
            -- (c) ja remarcou sozinho
            and not exists (
              select 1 from agenda_videochamadas c
               where lower(c.cliente_email) = lower(b.cliente_email)
                 and c.scheduled_at > b.scheduled_at
                 and c.status = 'agendada'
            )
            and (b.recuperacao_lock_em is null or b.recuperacao_lock_em < now() - interval '10 minutes')
          order by b.scheduled_at desc
          limit greatest(1, least(coalesce(p_limite, 25), 100))
          for update skip locked
       )
      returning a.*
    )
    select r.event_id, r.vendedora_email, r.cliente_email,
           r.scheduled_at, r.raw->>'summary', r.lead_id, k.nome, r.primeiro_visto_em
      from reservados r
      left join kommo_leads k on k.lead_id::bigint = r.lead_id
     order by r.scheduled_at desc;
end $function$;

create or replace function public.recuperacao_marcar(p_chave text, p_event_id text, p_erro text default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_erro is null then
    update agenda_videochamadas
       set recuperacao_em = now(), recuperacao_erro = null, recuperacao_lock_em = null
     where event_id = p_event_id;
  else
    update agenda_videochamadas
       set recuperacao_erro = left(p_erro, 300), recuperacao_lock_em = null
     where event_id = p_event_id;
  end if;
  get diagnostics n = row_count;
  return n;
end $function$;

-- Conferência de que não sobrou reserva presa (rodar se desconfiar de e-mail parado):
--   select event_id, dossie_lock_em, lembrete_lock_em, recuperacao_lock_em
--     from agenda_videochamadas
--    where coalesce(dossie_lock_em, lembrete_lock_em, recuperacao_lock_em) < now() - interval '1 hour';
