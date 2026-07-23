-- Fase 2 comparecimento Meet (23/07/2026): colunas derivadas do log de auditoria do Meet
-- (Admin Reports API) + RPC de escrita SO das colunas meet_* + view reconciliada.
-- Aditiva e retrocompativel: antes do 1o sync, meet_status e NULL e a view devolve status
-- identico ao atual (coalesce(null,status)=status). A cor deixa de ser necessaria; a equipe
-- para de colorir. "Negocio fechado" vem do funil de contratos, nao da cor azul.

-- 1) Colunas derivadas do log (aditivas)
alter table agenda_videochamadas
  add column if not exists meet_conferido_em     timestamptz,
  add column if not exists meet_cliente_presente boolean,
  add column if not exists meet_cliente_seg      integer,
  add column if not exists meet_status           text,
  add column if not exists meet_participantes    jsonb;

-- 2) RPC: grava SO as colunas meet_* (nunca toca em status/cor). So atualiza linhas
--    existentes e NUNCA uma linha 'excluida' (evento apagado fica fora das contagens).
create or replace function public.agenda_meet_upsert(p_chave text, p_rows jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  update agenda_videochamadas a set
    meet_conferido_em     = now(),
    meet_cliente_presente = x.cliente_presente,
    meet_cliente_seg      = x.cliente_seg,
    meet_status           = x.meet_status,
    meet_participantes    = x.participantes
  from jsonb_to_recordset(p_rows) as x(event_id text, cliente_presente boolean,
        cliente_seg integer, meet_status text, participantes jsonb)
  where a.event_id = x.event_id and coalesce(a.status,'') <> 'excluida';
  get diagnostics n = row_count;
  return n;
end $fn$;

-- 3) View reconciliada: o log VENCE a cor; protege so 'excluida'. IMPORTANTE: create or replace
--    view so permite ANEXAR colunas no fim, entao mantemos as 6 originais na ordem
--    (event_id, vendedora_email, status, color_id, scheduled_at, tem_meet) e anexamos
--    status_cor/meet_status/origem_status no final. O frontend le 'status' (sem mudanca de codigo).
create or replace view public.vw_funil_videochamadas as
select
  event_id,
  vendedora_email,
  case when status = 'excluida' then 'excluida'
       else coalesce(meet_status, status) end as status,
  color_id,
  scheduled_at,
  tem_meet,
  status      as status_cor,
  meet_status,
  case when meet_status is not null then 'meet' else 'cor' end as origem_status
from agenda_videochamadas;

-- ROLLBACK (se necessario):
--   drop function if exists public.agenda_meet_upsert(text, jsonb);
--   create or replace view public.vw_funil_videochamadas as
--     select event_id, vendedora_email, status, color_id, scheduled_at, tem_meet
--     from agenda_videochamadas;
--   -- (as colunas meet_* podem ficar; sao inertes sem os jobs)
