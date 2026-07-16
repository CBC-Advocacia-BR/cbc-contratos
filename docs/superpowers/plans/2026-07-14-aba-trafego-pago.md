# Aba "Tráfego" (Meta Ads) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (execução inline nesta sessão). Spec de referência (fonte da verdade de requisitos): `docs/superpowers/specs/2026-07-14-aba-trafego-pago-design.md`. Passos em checkbox.

**Goal:** Aba "Tráfego" no CBC Contratos: campanhas/criativos Meta com performance, rankings, alertas, ponte comercial mensal e ações (pausar/orçamento) restritas ao trio.

**Architecture:** Espelho híbrido — `meta-trafego-sync` (cron 07h10 + GET ?hoje=1/?backfill=1) grava catálogos e métricas diárias em 3 tabelas via RPC `meta_trafego_upsert`; a aba lê do Supabase e deriva métricas em `trafego/compute.js` (puro/testado); `meta-trafego-action` executa pausar/reativar/orçamento/config com JWT + lista de e-mails.

**Tech Stack:** Netlify Functions (.mjs, Node 22), Graph API v23, Supabase (RLS + RPC security definer + BOT_RPC_SECRET), React 19 + tokens `--cbc-*`, vitest.

## Global Constraints

- Backup em `backups/YYYYMMDD_HHMMSS_motivo/` antes de editar qualquer arquivo existente (REGRA #1/#3).
- Comentários em português sem acento em código; strings de UI com acento.
- Token Meta NUNCA no frontend; leitura da aba só via tabelas (authenticated), escrita só via RPC/functions.
- TDD: teste RED antes de implementação em todo módulo puro; snapshots existentes intactos.
- Deploy único no final via `client/deploy.sh` (nunca netlify direto). Commits frequentes em PT-BR.
- Conta v1: `act_969110338250520`. Trio de ação/custo: paulo@, bruno@, lorenza@advocaciacbc.com.

---

### Task 1: Migração `meta_trafego` (tabelas + RPCs + permissão da aba)

**Files:** Create `supabase_meta_trafego.sql` (raiz); aplicar via MCP `apply_migration`.

**Produces (interfaces):**
- Tabelas: `meta_campanhas(campaign_id pk, account_id, nome, status, objetivo, orcamento_diario numeric, updated_at, raw)`; `meta_anuncios(ad_id pk, campaign_id, account_id, nome, status, thumbnail_url, permalink, updated_at, raw)`; `meta_ads_diario(dia date, level text check in campaign|ad, entity_id, campaign_id, account_id, gasto, conversas_iniciadas, leads_form, impressoes, alcance, cliques, cliques_link, frequencia numeric, video_3s, raw, synced_at, pk(dia,level,entity_id))`.
- RLS: SELECT p/ authenticated nas 3; nada p/ anon.
- RPC `meta_trafego_upsert(p_chave text, p_campanhas jsonb, p_anuncios jsonb, p_diario jsonb, p_limpar boolean default false) returns jsonb` — upserta os 3 conjuntos, `p_limpar` apaga diário > 400 dias; gate `_bot_chave_ok`.
- RPC `meta_trafego_series(p_chave text, p_dias int) returns jsonb` — `{conta:[{dia,gasto,leads}], ontem_campanhas:[{campaign_id,nome,gasto,leads,status}]}` p/ o motor de alertas (function lê sem abrir RLS).
- Seed: `update user_permissions set tabs = tabs || '{"trafego":true}' where email in (trio)`.

- [ ] Aplicar migração via MCP; conferir com SELECT (3 tabelas vazias, RPCs existem, permissão dos 3 e-mails).
- [ ] Gravar `supabase_meta_trafego.sql`; commit.

### Task 2: Parsers + motor de alertas puros (`_lib/metaAds.mjs`) — TDD

**Files:** Modify `client/netlify/functions/_lib/metaAds.mjs`; Test `client/src/utils/__tests__/metaAds.test.js`.

**Produces:**
- `campaignToRow(c, accountId)` → linha meta_campanhas (daily_budget centavos→R$; effective_status).
- `adToRow(ad, accountId)` → linha meta_anuncios (creative.thumbnail_url, preview_shareable_link).
- `insightToDiario(row, level, accountId)` → linha meta_ads_diario (dia=date_start; video_3s = action_type `video_view`; conversas/forms reusam actionsToCounts; inline_link_clicks→cliques_link).
- `avaliarAlertasTrafego(series, config)` → `[{tipo:'cpl_estourado'|'entrega_zerada'|'queda_leads', campanha?, mensagem, valor, limite}]`; regras da spec §5 (cpl_mult×média 28d com gasto mín.; ACTIVE gasto 0 ontem; leads 7d < pct% dos 7d anteriores). Config default: `{cpl_mult:2, cpl_gasto_min_dia:100, queda_leads_pct:50}`.

- [ ] Testes RED (fixtures Graph reais simplificadas; casos: budget centavos, vídeo ausente, alerta dispara/não dispara em cada regra, anti-ruído do gasto mínimo).
- [ ] Implementar; GREEN; lint; commit.

### Task 3: Function `meta-trafego-sync.mjs`

**Files:** Create `client/netlify/functions/meta-trafego-sync.mjs`.

**Consumes:** parsers da Task 2; `db`/`logAdvbox` (botDb); RPCs da Task 1; padrão graphGet com retry do `meta-ads-sync.mjs`.
**Produces:** cron `10 10 * * *`; `GET ?hoje=1` (catálogos + insights do dia corrente); `GET ?backfill=1&dias=N` (default 90, cap 400, paginação time_increment=1 em janelas ≤90d); cron diário = catálogos + D-1..D-3 + `p_limpar` + alertas (via `meta_trafego_series` + `avaliarAlertasTrafego` + notificação in-app/e-mail no MESMO mecanismo do watchdog — ler `advbox-backfill-watchdog.mjs` e reusar; anti-flood: 1 notificação por tipo+campanha+dia, chave em bot_config `meta_trafego_alert_log`). Config de alertas lida de `bot_config['meta_trafego']` (default da Task 2).

- [ ] Implementar; lint; testar local com `vite-node` um dry-run de parsing (sem gravar: flag `?dry=1` retorna contagens).
- [ ] Commit.

### Task 4: Function `meta-trafego-action.mjs`

**Files:** Create `client/netlify/functions/meta-trafego-action.mjs`.

**Produces:** POST `{acao, campaign_id?, valor?}`; auth = `Authorization: Bearer <jwt>` → `db.auth.getUser(jwt)` → e-mail ∈ `TRAFEGO_ACAO_EMAILS`; ações: `pausar`/`reativar` (`POST graph /{id} status=`), `orcamento` (`daily_budget` centavos; valor em R$ no body), `config` (merge em bot_config `meta_trafego`); lê estado ANTES, grava `activity_log` (action `trafego_<acao>`, detalhes antes→depois, user_email) + `logAdvbox('meta','info',...)`; upserta estado novo em `meta_campanhas` via RPC; respostas 401/403/400 claras.

- [ ] Implementar; lint; commit. (Teste real fica na Task 8, com campanha pausada.)

### Task 5: `trafego/compute.js` — TDD

**Files:** Create `client/src/components/trafego/compute.js`; Test `client/src/utils/__tests__/trafegoCompute.test.js`.

**Produces:**
- `computeTrafego({diario, campanhas, anuncios, inicio, fim, agora})` → `{ kpis:{gasto,leads,cpl,ctr,cpm,frequencia, prev:{...}, delta:{...}}, serie:[{dia,gasto,leads,cpl}], campanhas:[{...catalogo, gasto,leads,cpl,ctr,tendencia7d, atencao:null|'cpl'|'zerada'}], criativos:[{...catalogo, gasto,leads,cpl,ctr,hookRate,frequencia,saturando}], rankings:{ctr:[],cpl:[],leads:[],hook:[]} }`.
- Regras: CTR=cliques_link/impressões; CPM=gasto/impr×1000; CPL=gasto/leads; hookRate=video_3s/impressões (null sem vídeo); `saturando` = freq≥3.5 && ctrAtual<0.7×ctrAnterior (constantes exportadas `FREQ_SATURACAO`, `QUEDA_CTR_FADIGA`); período anterior = mesma duração imediatamente antes; rankings só com gasto>0 e impressões>500 (anti-ruído, constante `MIN_IMPRESSOES_RANKING`).
- `computeComercialMensal({mensal, videochamadas, contratos, meses=6})` → `[{mes, leads, gasto, videochamadas, enviados, assinados, custoPorAssinado}]` (mesmas regras de datas do funil: videochamada por scheduled_at, enviado por zapsign_sent_at, assinado pela data efetiva).

- [ ] Testes RED (fixtures determinísticas; deltas, rankings, fadiga liga/desliga, anti-ruído, comercial com mês sem dado).
- [ ] Implementar; GREEN; lint; commit.

### Task 6: Aba (UI) + registro

**Files:** Create `client/src/components/TrafegoPanel.jsx`, `client/src/components/trafego/api.js`; Modify `client/src/App.jsx` (TABS/lazy/prefetch), `client/src/components/AdminPanel.jsx` (coluna trafego na matriz).

**Consumes:** compute da Task 5; tabelas Task 1; functions Tasks 3-4.
**Produces:** aba key `trafego`, rótulo "Tráfego", 7 blocos da spec §6; fetch: 3 tabelas meta_* + `meta_ads_mensal` + `vw_funil_videochamadas` + contratos slim (`id,status,created_at,zapsign_sent_at,signed_at,advbox_date,updated_at,arquivado_em`); botão Atualizar (`api.atualizarAgora()` → sync?hoje=1 → refetch); ações com modal de confirmação (antes→depois) via `api.executarAcao()` mandando o JWT da sessão; botões de ação desabilitados fora do trio (UX; servidor é quem manda); config de alertas editável (só trio); mobile: cards empilham, tabela com scroll-x; dark ok.

- [ ] Implementar painel + api + registro; lint; build local ok; commit.

### Task 7: Backfill + validação de dados

- [ ] Deploy (necessário p/ rodar functions) — `./deploy.sh` com suite verde.
- [ ] `GET meta-trafego-sync?backfill=1&dias=90`; conferir volumetria via SQL.
- [ ] **Validação cruzada automática**: soma(meta_ads_diario level=campaign por mês) ≈ meta_ads_mensal (tolerância 2% — atribuição móvel); relatar divergências.
- [ ] Espiar thumbnails (SELECT 3 URLs, abrir 1) e permalink.

### Task 8: Teste real das ações + encerramento

- [ ] Com campanha JÁ PAUSADA: `orcamento` +R$1 e reverter; `pausar` idempotente. NUNCA reativar campanha sozinho. Conferir auditoria em activity_log + estado no Gerenciador.
- [ ] Suite completa + lint; smoke pós-deploy; screenshot da aba (proto ou produção logada se possível).
- [ ] CLAUDE.md (bloco Estado atual) + memória + MEMORY.md; commit final.
