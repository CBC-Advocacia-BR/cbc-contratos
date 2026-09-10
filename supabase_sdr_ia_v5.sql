-- SDR de IA (Ana) v5 — 08/09/2026 (itens 1, 2, 3 e 6 da analise de agendamentos)
-- 1) lembrete_vespera_em: lembrete na vespera so para call marcada com 2+ dias (lead pediu o dia).
-- 2) agenda_bot_pendencias: eventos da Ana ate 25h a frente (vespera) + QUALQUER evento com
--    lead_id que a auditoria do Meet marcou como no_show nas ultimas 24h (mensagem de no-show
--    pelo WhatsApp com 2 horarios; fora da janela de 24h vira tarefa p/ envio manual).
-- 3) sdr_ia_reservas_pendentes: conversas em que a Ana guardou a mensagem do lead em horario
--    comercial (context.reserva_pendente) e o prazo venceu — o cron confere se o escritorio
--    respondeu e, se nao, re-despacha o worker com reserva:true.
-- 4) config: regras.reserva_comercial_min=15; lembrete_1h com {{link}}; lembrete_vespera;
--    dossie_videochamada.recuperacao=false (e-mail de recuperacao de no-show desligado: nao muda nada).
alter table agenda_videochamadas add column if not exists lembrete_vespera_em timestamptz;

create or replace function agenda_bot_pendencias(p_chave text)
returns setof agenda_videochamadas language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query select * from agenda_videochamadas
    where (origem = 'ana' and status = 'agendada' and scheduled_at between now() - interval '30 minutes' and now() + interval '25 hours')
       or (lead_id is not null and meet_status = 'no_show' and noshow_msg_em is null and scheduled_at between now() - interval '24 hours' and now());
end $$;

create or replace function agenda_bot_marcar(p_chave text, p_event_id text, p_campo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_campo not in ('lembrete_1h_em', 'lembrete_t0_em', 'noshow_msg_em', 'lembrete_vespera_em') then
    raise exception 'campo invalido: %', p_campo;
  end if;
  if p_campo = 'lembrete_1h_em' then update agenda_videochamadas set lembrete_1h_em = now() where event_id = p_event_id;
  elsif p_campo = 'lembrete_t0_em' then update agenda_videochamadas set lembrete_t0_em = now() where event_id = p_event_id;
  elsif p_campo = 'noshow_msg_em' then update agenda_videochamadas set noshow_msg_em = now() where event_id = p_event_id;
  elsif p_campo = 'lembrete_vespera_em' then update agenda_videochamadas set lembrete_vespera_em = now() where event_id = p_event_id;
  end if;
end $$;

create or replace function sdr_ia_reservas_pendentes(p_chave text)
returns table (channel text, context jsonb) language plpgsql security definer set search_path = public as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query select b.channel, b.context from bot_conversations b
    where b.channel like 'agenda:%'
      and (b.context->'reserva_pendente'->>'due_at') is not null
      and (b.context->'reserva_pendente'->>'due_at')::timestamptz <= now();
end $$;
revoke all on function sdr_ia_reservas_pendentes(text) from public, anon, authenticated;
grant execute on function sdr_ia_reservas_pendentes(text) to anon, authenticated;

update bot_config set value = jsonb_set(jsonb_set(jsonb_set(value,
  '{regras,reserva_comercial_min}', '15'::jsonb, true),
  '{mensagens,lembrete_1h}', to_jsonb('Passando para lembrar da nossa videochamada hoje às {{hora}} 😊 O link é este: {{link}}. Tudo certo para você?'::text), true),
  '{mensagens,lembrete_vespera}', to_jsonb('Passando para confirmar a nossa videochamada de {{quando}} 😊 Continua de pé para você?'::text), true)
where key = 'agenda_bot';
update bot_config set value = jsonb_set(value, '{recuperacao}', 'false'::jsonb, true) where key = 'dossie_videochamada';
