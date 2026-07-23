-- Melhoria (23/07/2026): "cliente esperou o vendedor" + presenca por uniao de intervalos.
-- Aditiva. Nova coluna meet_cliente_esperou_seg + RPC agenda_meet_upsert passa a gravar o campo.

alter table agenda_videochamadas
  add column if not exists meet_cliente_esperou_seg integer;

create or replace function public.agenda_meet_upsert(p_chave text, p_rows jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  update agenda_videochamadas a set
    meet_conferido_em        = now(),
    meet_cliente_presente    = x.cliente_presente,
    meet_cliente_seg         = x.cliente_seg,
    meet_cliente_esperou_seg = x.cliente_esperou_seg,
    meet_status              = x.meet_status,
    meet_participantes       = x.participantes
  from jsonb_to_recordset(p_rows) as x(event_id text, cliente_presente boolean,
        cliente_seg integer, cliente_esperou_seg integer, meet_status text, participantes jsonb)
  where a.event_id = x.event_id and coalesce(a.status,'') <> 'excluida';
  get diagnostics n = row_count;
  return n;
end $fn$;
