-- supabase_sdr_ia_v2.sql — revisao final do SDR de IA (Ana fora do horario).
-- Aplicar DEPOIS de supabase_sdr_ia_v1.sql. Todas as RPCs seguem o padrao da casa:
-- security definer + validacao _bot_chave_ok(p_chave) (BOT_RPC_SECRET), execute so p/ anon e
-- authenticated (as functions falam com a anon key + segredo). O JS foi escrito para funcionar
-- ANTES e DEPOIS desta migracao: sem estas RPCs ele apenas registra aviso e segue (fail-open),
-- com a unica excecao da grade, que cai no fallback cfg.regras.

-- =====================================================================================
-- I1 — reserva atomica de slot (evita duas videochamadas no mesmo horario da mesma closer)
-- =====================================================================================
-- O free/busy do Google e um cheque OTIMISTA: entre consultar e criar o evento cabe outro
-- turno (ou outro lead) pegando o mesmo horario, e o Google aceita os dois. A chave primaria
-- (vendedora_email, inicio) e o que serializa isso de verdade.
create table if not exists sdr_ia_reservas (
  vendedora_email text not null,
  inicio timestamptz not null,
  lead_id bigint not null,
  criado_em timestamptz not null default now(),
  primary key (vendedora_email, inicio)
);
create index if not exists idx_sdr_ia_reservas_lead on sdr_ia_reservas (lead_id);
alter table sdr_ia_reservas enable row level security;
revoke all on sdr_ia_reservas from anon, authenticated;

-- true  = reserva e deste lead (acabou de ser criada OU ja era dele: idempotente no retry)
-- false = o horario ja esta reservado por OUTRO lead
-- Limpa reservas antigas (slot no passado) na mesma chamada: sem isso a tabela cresceria para
-- sempre e um horario nunca mais poderia ser reusado depois de um cancelamento perdido.
create or replace function sdr_ia_reservar(p_chave text, p_vendedora text, p_inicio timestamptz, p_lead bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_dono bigint;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  delete from sdr_ia_reservas where inicio < now() - interval '1 day';
  insert into sdr_ia_reservas (vendedora_email, inicio, lead_id)
  values (p_vendedora, p_inicio, p_lead)
  on conflict (vendedora_email, inicio) do nothing;
  if found then return true; end if;
  select r.lead_id into v_dono from sdr_ia_reservas r
   where r.vendedora_email = p_vendedora and r.inicio = p_inicio;
  return coalesce(v_dono = p_lead, false);
end $$;

-- devolve o horario ao pool (cancelamento, remarcacao, rollback). Best-effort no chamador.
create or replace function sdr_ia_liberar(p_chave text, p_vendedora text, p_inicio timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  delete from sdr_ia_reservas where vendedora_email = p_vendedora and inicio = p_inicio;
end $$;

-- =====================================================================================
-- I2 — teto de custo por lead nas ultimas 24h
-- =====================================================================================
create or replace function sdr_ia_custo_lead_24h(p_chave text, p_lead bigint)
returns numeric language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  select coalesce(sum(t.custo_usd), 0) into v from sdr_ia_turnos t
   where t.lead_id = p_lead and t.recebido_em > now() - interval '24 hours';
  return v;
end $$;

-- =====================================================================================
-- M5 — grade do SDR por RPC (fecha a leitura anon de sdr_config)
-- =====================================================================================
create or replace function sdr_ia_grade(p_chave text)
returns table (grade_inicio time, grade_fim time, grade_dias int[])
language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  -- casts explicitos: sdr_config e tabela de OUTRO sistema (nao nasce em nenhum .sql daqui) e
  -- as colunas podem ser time/text e int[]/smallint[]. O cast normaliza sem exigir DDL la.
  return query select c.grade_inicio::time, c.grade_fim::time, c.grade_dias::int[] from sdr_config c where c.id = 1;
end $$;

-- a policy da v1 liberava a LINHA INTEIRA de sdr_config p/ a anon key (que vai no bundle do
-- site). A grade agora sai pela RPC acima, com os 3 campos e mais nada.
drop policy if exists sdr_config_read_anon on public.sdr_config;

revoke all on function sdr_ia_reservar(text, text, timestamptz, bigint) from public, anon, authenticated;
revoke all on function sdr_ia_liberar(text, text, timestamptz) from public, anon, authenticated;
revoke all on function sdr_ia_custo_lead_24h(text, bigint) from public, anon, authenticated;
revoke all on function sdr_ia_grade(text) from public, anon, authenticated;
grant execute on function sdr_ia_reservar(text, text, timestamptz, bigint) to anon, authenticated;
grant execute on function sdr_ia_liberar(text, text, timestamptz) to anon, authenticated;
grant execute on function sdr_ia_custo_lead_24h(text, bigint) to anon, authenticated;
grant execute on function sdr_ia_grade(text) to anon, authenticated;

-- =====================================================================================
-- I4 — agenda_bot_metricas contando o vocabulario REAL do SDR de IA
-- =====================================================================================
-- Corpo copiado de supabase_agenda_bot.sql, com 3 contadores corrigidos. Motivo: o funil da
-- Ana passou a ser decidido por um agente com ferramentas, e o estado da conversa nao usa mais
-- `dados->situacao` nem a maquina de `etapa` ('oferta'/'negociacao'/'handoff'); nada escreve
-- essas chaves hoje, entao "qualificadas", "oferta_feita" e "handoffs" eram sempre ZERO.
--   qualificadas = registrar_qualificacao gravou a situacao da cota
--   oferta_feita = consultar_horarios devolveu ao menos um horario (slots_ofertados)
--   handoffs     = escalar_para_humano marcou context->>'escalado'
-- Assinatura e demais contadores preservados verbatim (AgendaViews.jsx consome este jsonb).
create or replace function agenda_bot_metricas(p_de date, p_ate date)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'conversas_iniciadas', (select count(*) from bot_conversations where channel like 'agenda:%'
        and created_at >= p_de and created_at < p_ate + 1),
    'qualificadas', (select count(*) from bot_conversations where channel like 'agenda:%'
        and created_at >= p_de and created_at < p_ate + 1
        and context->'dados'->>'situacao_cota' is not null),
    'oferta_feita', (select count(*) from bot_conversations where channel like 'agenda:%'
        and created_at >= p_de and created_at < p_ate + 1
        and jsonb_array_length(coalesce(context->'slots_ofertados','[]'::jsonb)) > 0),
    'agendadas', (select count(*) from agenda_videochamadas where origem='ana'
        and updated_at >= p_de and updated_at < p_ate + 1),
    'realizadas', (select count(*) from agenda_videochamadas where origem='ana'
        and status in ('realizada','fechou') and scheduled_at >= p_de and scheduled_at < p_ate + 1),
    'no_show', (select count(*) from agenda_videochamadas where origem='ana'
        and status='no_show' and scheduled_at >= p_de and scheduled_at < p_ate + 1),
    'fechou', (select count(*) from agenda_videochamadas where origem='ana'
        and status='fechou' and scheduled_at >= p_de and scheduled_at < p_ate + 1),
    'handoffs', (select count(*) from bot_conversations where channel like 'agenda:%'
        and created_at >= p_de and created_at < p_ate + 1 and (context->>'escalado') = 'true'),
    'por_vendedora', (select coalesce(jsonb_object_agg(vendedora_email, n), '{}'::jsonb) from (
        select vendedora_email, count(*) n from agenda_videochamadas
        where origem='ana' and scheduled_at >= p_de and scheduled_at < p_ate + 1
        group by vendedora_email) t),
    'tempo_resposta_med_seg', (select coalesce(percentile_cont(0.5) within group (order by extract(epoch from (m_out.created_at - m_in.created_at))),0)
        from bot_messages m_in join bot_messages m_out
          on m_out.conversation_id = m_in.conversation_id and m_out.direction='out'
         and m_out.id = (select min(id) from bot_messages x where x.conversation_id=m_in.conversation_id and x.direction='out' and x.id > m_in.id)
        join bot_conversations c on c.id = m_in.conversation_id
        where c.channel like 'agenda:%' and m_in.direction='in'
          and m_in.created_at >= p_de and m_in.created_at < p_ate + 1)
  );
$$;
grant execute on function agenda_bot_metricas(date, date) to authenticated;
revoke all on function agenda_bot_metricas(date, date) from anon, public;
