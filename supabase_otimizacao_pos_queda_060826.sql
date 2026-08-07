-- ─────────────────────────────────────────────────────────────────────────
-- OTIMIZACAO APOS A QUEDA DE 06/08/2026 (aplicado em producao no mesmo dia)
--
-- CONTEXTO
-- Em 06/08/2026, das 11h22 as 12h39 BRT, o Postgres travou por exaustao de memoria
-- (maquina Micro, 1 GB de RAM, hospedando 17 schemas e ~7 sistemas do escritorio). Como
-- o Auth depende do banco, NENHUM sistema fazia login: 75 minutos com o escritorio
-- inteiro parado. O gatilho foram duas consultas analiticas rodadas pelo acesso
-- administrativo, que varreram `atendimento.mensagens` (501 MB) seis vezes cada.
--
-- CRITERIO DE ESCOLHA (pedido do Paulo): nada que trave tabela, altere dado ou mude o
-- que os aplicativos enxergam. As quatro mudancas abaixo passam nesse crivo.
--
-- O QUE FOI DELIBERADAMENTE DEIXADO DE FORA, e por que:
--   * Remover "indices sem uso": dos 772 com idx_scan = 0, a maioria sao PRIMARY KEY e
--     UNIQUE, que nao existem para acelerar busca e sim para impedir duplicidade (ex.:
--     fin_extrato_linhas_fingerprint_key impede lancamento financeiro em dobro). Sobram
--     2 candidatos reais somando 10,8 MB, e um deles (idx_mensagens_autor_nome) E usado
--     pelo filtro por atendente de atendimento.buscar_mensagens — so nao aparece porque
--     a busca inteira foi usada 5 vezes em 20 dias. Nao compensa o risco.
--   * Espacar refresh_mv_dashboard_kpis (a cada 5 min): medido, custa 28 ms por execucao
--     e 162 s em 20 dias. Irrelevante, e mexeria em rotina de outro sistema.
--   * VACUUM FULL em contratos_audit (70 MB para 9.376 linhas): recupera espaco mas
--     TRAVA a tabela inteira enquanto roda. Contraria o criterio.
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1) INDICE POR DATA EM atendimento.mensagens ──────────────────────────
-- Nao existia indice algum por data, e atendimento.buscar_mensagens aceita filtro de
-- periodo (d_ini/d_fim): toda busca com data varria os 501 MB.
-- CONCURRENTLY = nao bloqueia leitura nem escrita. Levou 7 segundos; ocupa 15 MB.
--
-- MEDIDO antes:  Parallel Seq Scan, custo 54.815
-- MEDIDO depois: Index Scan, custo 47, tempo real 1,6 ms, lendo 2 blocos do disco
create index concurrently if not exists idx_mensagens_enviada_em
  on atendimento.mensagens (enviada_em desc);


-- ── 2) LIMPEZA AUTOMATICA MAIS FREQUENTE NA MAIOR TABELA ─────────────────
-- O gatilho padrao dispara com 20% da tabela suja; em 684 mil linhas isso exige 143.776
-- linhas mortas, patamar que quase nunca chegava: a limpeza rodou 1 UNICA vez em 20
-- dias, com 88.234 linhas mortas paradas (12,8% da tabela).
-- Roda em segundo plano; nao bloqueia leitura nem escrita.
--
-- MEDIDO: o ajuste disparou a limpeza em ~1 minuto e as 88.234 linhas mortas foram a 0.
-- Gatilho: de 143.776 para 35.981 linhas.
alter table atendimento.mensagens set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);


-- ── 3) TETO DE TEMPO POR CONSULTA NO ACESSO ADMINISTRATIVO ───────────────
-- Os aplicativos ja tinham teto (anon 3s, authenticated 8s, contas _ro 30s). O acesso
-- administrativo, usado pelo editor de SQL e pela Management API, era o UNICO ilimitado
-- — e foi por ele que vieram as consultas que derrubaram o banco.
--
-- ⚠️ POR QUE 300s E NAO 60s: os 24 robos do pg_cron rodam com este MESMO papel
-- (`postgres`). Medido em 20 dias, o mais lento e o comparador-triagem-diario, com 18,4s
-- de pior caso. 300s da 16x de folga sobre ele e ainda acomoda manutencao (criacao de
-- indice, vacuum), que um teto de 60s quebraria — inclusive a criacao do indice do
-- item 1 acima. E corta consulta pendurada: durante a queda houve uma de 938 segundos.
--
-- ⚠️ HONESTIDADE SOBRE O ALCANCE: as duas consultas de 06/08 levaram 13,4s e 23,7s, ou
-- seja, este teto NAO as teria cortado. O que provavelmente matou a maquina foi uma
-- terceira consulta, maior, que nao chegou a ser registrada porque o coletor de logs
-- morreu junto. O teto reduz o risco; nao o elimina. Contra estouro de memoria em poucos
-- segundos, o que protege e maquina maior e nao rodar analise pesada em producao.
alter role postgres set statement_timeout = '300s';


-- ── 4) REGISTRO DE CONSULTAS LENTAS (RASTREABILIDADE) ────────────────────
-- log_min_duration_statement estava em -1 no banco todo: consulta nenhuma era
-- registrada. Foi por isso que deu para datar a queda mas nao identificar de imediato a
-- origem. Aplicado SO neste papel para nao gerar volume de log dos aplicativos.
alter role postgres set log_min_duration_statement = '5s';


-- ── 5) BACKUP DESTRAVADO (aplicado 06/08 a noite, aprovacao Paulo) ───────
-- Descoberto durante a investigacao da contratos_audit: o backup diario completo
-- (55 tabelas -> Drive) estava FALHANDO desde 05/08 com
--   "backup_dump contratos_audit@8000: canceling statement due to statement timeout".
-- Causa: o worker chama a RPC via PostgREST (papel authenticated, teto 8s) e o lote
-- final da contratos_audit — pular 8.000 linhas carregando before_data/after_data
-- (duas copias do contrato por linha) — nao cabia em 8s. O vigia alarmou de hora em
-- hora... dentro do proprio banco, onde ninguem olha (mesma cegueira da queda).
-- O SET na funcao vale so durante a execucao dela; nenhum outro caminho muda.
--
-- TESTADO: o lote exato que falhava (offset 8000, 13,5 MB) saiu em 1,0s apos o fix.
alter function public.backup_dump(text, text, integer, integer)
  set statement_timeout = '120s';
-- ⚠️ Correcao definitiva pendente: paginar por "ultimo id visto" (keyset) em vez de
-- OFFSET — o custo do OFFSET cresce com a tabela e o problema voltaria um dia.

-- ── 6) SINCRONIZACAO DO CADASTRO FORA DO EXPEDIENTE (decisao Paulo 06/08) ─
-- core.cadastro_sync_diario le ~478 MB do disco por rodada. A rodada da manha saia
-- as 8h BRT, lavando o cache da maquina de 1 GB bem na chegada da equipe.
-- Novos horarios (BRT): 5h e 21h. Em UTC:
--   select cron.alter_job(23, schedule => '0 8 * * *');  -- cadastro-sync-manha (5h BRT)
--   select cron.alter_job(24, schedule => '0 0 * * *');  -- cadastro-sync-noite (21h BRT)


-- ─────────────────────────────────────────────────────────────────────────
-- VERIFICACAO POS-APLICACAO (tudo conferido em producao em 06/08/2026):
--   * as 4 funcoes do CBC Conversas responderam (listar_contatos, listar_arquivadas,
--     buscar_mensagens com e sem filtro de periodo);
--   * os 24 robos do banco seguiram com status 'succeeded', zero falhas em 20 min;
--   * 4 sites no ar (contratos, portal, conversas, prestacao) com HTTP 200;
--   * REST e Auth do Supabase em 200; /api/health com "healthy" e 0 servicos fora.
--
-- CUSTO: +15 MB de indice. O banco foi de 1.035 MB para 1.050 MB.
-- ─────────────────────────────────────────────────────────────────────────
