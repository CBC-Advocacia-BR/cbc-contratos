-- =====================================================================
-- REMOCAO DAS ABAS Minhas Vendas / Socios / SDR — parte do BANCO
-- 09/09/2026
--
-- ⚠️ NAO APLICADO. Decisao do Paulo em 09/09: o codigo saiu, o banco fica.
-- Este arquivo existe para o dia em que ele quiser descartar tambem os dados.
-- Rodar SO depois de conferir que o backup diario do dia esta no Drive
-- (bot_config.backup_status com a data de hoje).
--
-- Estado medido em 09/09/2026, antes de qualquer remocao:
--   vendas_guias_custas ............... 0 linhas
--   vendas_documentos_enviados ........ 0
--   vendas_leads_rapidos .............. 0
--   vendas_metas ...................... 0
--   vendas_promocoes_sazonais ......... 0
--   vendas_comissoes_detalhe .......... 0
--   sdr_envios ........................ 0
--   sdr_lead_estado ................... 0
--   vendas_comissoes_mensais .......... 2   <- unico dado de trabalho
--   vendas_advbox_mapping ............. 7   (seed)
--   vendas_comissao_regras ............ 1   (config)
--   vendas_documentos_requisitos ...... 10  (seed)
--   vendas_documentos_tipos ........... 12  (seed)
--   vendas_expectativa_honorarios ..... 22  (seed)
--   sdr_config ........................ 1   (config)
--
-- ⚠️ AS TABELAS sdr_ia_* NAO ENTRAM AQUI. Elas sao do projeto "SDR IA Ana",
-- tem dados (31 turnos, 4 fatos, 2 memorias, 1 reserva), sao escritas por
-- fora deste repositorio e NAO tem relacao com a aba SDR removida.
-- =====================================================================

begin;

-- ── 1. Views de leitura do SDR ───────────────────────────────────────
-- Sao apenas leitura sobre agenda_videochamadas, kommo_* e atendimento.mensagens.
-- ⚠️ Conferir antes se algum OUTRO app do escritorio as consome:
--   select * from pg_depend d join pg_rewrite r on r.oid = d.objid
--   where d.refobjid = 'public.vw_sdr_sem_resposta'::regclass;
drop view if exists public.vw_sdr_sem_resposta;
drop view if exists public.vw_sdr_agenda_dia;
drop view if exists public.vw_sdr_mensagens;
drop view if exists public.vw_sdr_funil_etapas;
drop view if exists public.vw_sdr_funil_cards;

-- ── 2. Tabelas do SDR (fila e config da aba, nao a IA) ───────────────
drop table if exists public.sdr_envios;
drop table if exists public.sdr_lead_estado;
drop table if exists public.sdr_config;

-- ── 3. Tabelas de Vendas / comissoes ─────────────────────────────────
-- Ordem importa: detalhe referencia mensais.
drop table if exists public.vendas_comissoes_detalhe;
drop table if exists public.vendas_comissoes_mensais;
drop table if exists public.vendas_comissao_regras;
drop table if exists public.vendas_promocoes_sazonais;
drop table if exists public.vendas_metas;
drop table if exists public.vendas_expectativa_honorarios;
drop table if exists public.vendas_guias_custas;
drop table if exists public.vendas_documentos_enviados;
drop table if exists public.vendas_documentos_requisitos;
drop table if exists public.vendas_documentos_tipos;
drop table if exists public.vendas_leads_rapidos;
drop table if exists public.vendas_advbox_mapping;

-- ⚠️ Se o backup diario tiver whitelist dessas tabelas, tirar de la tambem,
-- senao a RPC backup_tabelas passa a reclamar de tabela inexistente:
--   select * from public.backup_tabelas_fora();

commit;


-- =====================================================================
-- LIMPEZA DAS PERMISSOES (independente, pode rodar sozinha)
--
-- 7 usuarios ainda carregam as chaves das abas removidas no jsonb de
-- user_permissions. Nada as le desde 09/09 — e higiene, nao correcao.
-- ⚠️ user_permissions e COMPARTILHADA com o app `produtividade`; este
-- update mexe SO nas 3 chaves abaixo, nunca na linha inteira.
-- =====================================================================

-- Conferir antes:
-- select email, tabs->>'vendas', tabs->>'parametrizacao_vendas', tabs->>'sdr'
--   from user_permissions
--  where tabs ?| array['vendas','parametrizacao_vendas','sdr'];

update public.user_permissions
   set tabs = tabs - 'vendas' - 'parametrizacao_vendas' - 'sdr'
 where tabs ?| array['vendas','parametrizacao_vendas','sdr'];

-- Conferir depois (deve voltar 0 linhas):
-- select count(*) from user_permissions
--  where tabs ?| array['vendas','parametrizacao_vendas','sdr'];


-- =====================================================================
-- COLUNAS ORFAS EM `contratos` — DEIXADAS DE PROPOSITO
--
-- kanban_col, advbox_stage e advbox_step ficaram sem quem escreva
-- (advbox-vendas-sync) e sem quem leia (VendasPanel). NAO estao no drop
-- acima: remover coluna e destrutivo e elas guardam o ultimo estado
-- conhecido de cada processo no ADVBOX. Se um dia quiser:
--   alter table public.contratos drop column kanban_col;
--   alter table public.contratos drop column advbox_stage;
--   alter table public.contratos drop column advbox_step;
-- =====================================================================


-- =====================================================================
-- HEARTBEATS ORFAOS (higiene, opcional — NAO aplicado)
--
-- `commission-calculator` e `advbox-vendas-sync` deixaram 2 linhas paradas em
-- cron_heartbeat (a ultima execucao de cada um, ambas com ok=true).
--
-- ⚠️ CONFERIDO EM 09/09: elas NAO produzem alarme. No monitor-watchdog a
-- checagem `hb.ok === false` roda ANTES do `if (!sla) continue`, entao um
-- heartbeat orfao com ok=FALSE viraria aviso diario eterno sobre robo que nao
-- existe mais. Como os dois estao com ok=true, o laco passa direto.
-- Se um dia remover um cron cujo ultimo heartbeat esteja com erro, APAGUE a
-- linha junto — senao o Monitor reclama para sempre.
--
-- delete from public.cron_heartbeat
--  where job in ('commission-calculator', 'advbox-vendas-sync');
-- =====================================================================
