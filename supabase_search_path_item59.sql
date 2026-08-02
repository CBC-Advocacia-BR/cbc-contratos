-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria 01/08/2026 — item 59 (search_path fixado)
-- Aplicado em producao em 02/08/2026 (migracao search_path_fixado_item59)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ CORRECAO AO ENUNCIADO DA AUDITORIA: ela descreve isto como "risco de sombreamento
-- de objetos (padrao de ataque conhecido em Postgres)". Conferido no banco: **nenhuma
-- funcao SECURITY DEFINER esta sem search_path** — as 13 abaixo sao todas SECURITY
-- INVOKER, ou seja, rodam com os privilegios de quem chama e nao permitem escalada.
-- O que resta e higiene de CORRECAO, nao de privilegio: uma funcao que resolve nome de
-- tabela sem qualificar depende do search_path de quem a chama, e um chamador com
-- search_path diferente pode faze-la ler ou gravar no objeto errado.
--
-- NAO SAO TOCADAS (de proposito):
--   - funcoes das extensoes pg_trgm e unaccent instaladas em `public` (gtrgm_*,
--     word_similarity*, unaccent*, similarity*, set_limit, show_limit, show_trgm, gin_*):
--     pertencem as extensoes, nao a este projeto;
--   - funcoes de OUTROS aplicativos do escritorio neste banco compartilhado
--     (`_prest_brl`, `fin_email`, `fin_lancamento_guard`, `prest_user_permissions_touch`,
--     `rh.cleanup_old_logs`).
--
-- ALTER FUNCTION ... SET search_path nao muda corpo nem assinatura. Conferido depois:
-- _backup_whitelist() segue devolvendo text[] com 56 tabelas; cbc_tel_canonico,
-- cbc_fone_key e fn_tel_key seguem normalizando '(19) 99999-8888' para '1999998888';
-- bot_metricas, portal_funil e portal_instituicao seguem devolvendo jsonb.

alter function public._backup_whitelist()                  set search_path = public, pg_temp;
alter function public._cliente_pf(text, text, text)         set search_path = public, pg_temp;
alter function public._fone_chave(text)                     set search_path = public, pg_temp;
alter function public.bot_metricas(integer)                 set search_path = public, pg_temp;
alter function public.cbc_clientes_touch_updated_at()       set search_path = public, pg_temp;
alter function public.cbc_fone_key(text)                    set search_path = public, pg_temp;
alter function public.cbc_tel_canonico(text)                set search_path = public, pg_temp;
alter function public.contratos_sync_flat_cols()            set search_path = public, pg_temp;
alter function public.fn_tel_key(text)                      set search_path = public, pg_temp;
alter function public.fone_chave(text)                      set search_path = public, pg_temp;
alter function public.portal_funil()                        set search_path = public, pg_temp;
alter function public.portal_instituicao()                  set search_path = public, pg_temp;
alter function public.trg_set_zapsign_sent_at()             set search_path = public, pg_temp;

-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria 01/08/2026 — item 106 (gravacao de status que se sobrescrevia)
-- Aplicado em 02/08/2026 (migracao bot_config_merge_atomico_item106)
-- ═══════════════════════════════════════════════════════════════════════════
-- `setBackfillStatus` LIA, mesclava em JavaScript e REGRAVAVA. Entre a leitura e a
-- gravacao cabe outra escrita: worker e watchdog gravando juntos faziam o "onde parei"
-- voltar atras, e o backfill reprocessava (ou pulava) um trecho sem ninguem perceber.
-- Achado no caminho: DUAS functions gravam a MESMA chave `kommo` (kommo-assinatura-send
-- e kommo-asaas-sync), entao uma apagava a descoberta da outra — inclusive o bot_id e o
-- field_id de que o envio do link de assinatura por WhatsApp depende.
-- Provado no banco: duas escritas concorrentes que antes se atropelariam agora resultam
-- em {"fase":"andamentos","cursor":10,"heartbeat":"ok"} — as duas sobrevivem.
create or replace function public.bot_config_merge(
  p_chave text, p_key text, p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_valor jsonb;
begin
  if not public._bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_key is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'parametros invalidos';
  end if;
  insert into public.bot_config (key, value, updated_at)
  values (p_key, p_patch, now())
  on conflict (key) do update
    set value = coalesce(public.bot_config.value, '{}'::jsonb) || excluded.value,
        updated_at = now()
  returning value into v_valor;
  return v_valor;
end;
$$;

comment on function public.bot_config_merge(text, text, jsonb) is
  'Item 106 — mescla atomica de um pedaco de configuracao/estado em bot_config. Substitui '
  'o padrao ler-mesclar-regravar do setBackfillStatus, em que duas escritas concorrentes '
  '(worker e watchdog) faziam o cursor do backfill voltar atras em silencio.';

revoke all on function public.bot_config_merge(text, text, jsonb) from public, anon;
