# Aba "Tráfego" — Meta Ads dentro do CBC Contratos (design)

**Data:** 14/07/2026 · **Aprovado por:** Paulo (entrevista em 3 rodadas + OK no desenho)
**Contexto:** a integração Meta já existe (token system user `cbccontratosbi` nunca-expira nas envs `META_ADS_TOKEN`/`META_AD_ACCOUNT_ID`; espelho mensal `meta_ads_mensal` alimenta o funil desde 14/07). Esta spec cria a aba operacional de tráfego pago.

## 1. Objetivo

Aba "Tráfego" no app com: campanhas ativas e performance, melhores criativos (CTR, CPL, leads, hook rate), fadiga de criativo, série diária, ponte comercial mensal (anúncio → contrato) e ações de gestão (pausar/reativar campanha, editar orçamento diário) — para melhorar as decisões de mídia e o comercial sem sair do sistema.

## 2. Decisões fechadas na entrevista (14/07)

| Tema | Decisão |
|---|---|
| Acesso à aba | Permissão RBAC normal (`user_permissions.tabs.trafego`), gerenciável no Admin; seed de fábrica: paulo@, bruno@, lorenza@advocaciacbc.com |
| Conta | Só `act_969110338250520` (CA - CBC Distratos); multi-conta fica preparado via env `META_AD_ACCOUNT_IDS` (fora da v1) |
| Ações | Leitura + **pausar/reativar campanha** + **editar orçamento diário** |
| Quem executa ações | Somente Paulo, Bruno e Lorenza (lista `TRAFEGO_ACAO_EMAILS`); demais usuários da aba veem botões desabilitados |
| Ponte comercial | Sim, na v1: bloco mensal agregado (leads → videochamadas → enviados → assinados + custo por assinado) |
| Rankings/destaques | Criativos por CTR **e** por CPL/leads; hook rate de vídeo; frequência+fadiga; série diária |
| Atualização | Cron diário + botão "Atualizar agora" (dia corrente ao vivo) |
| Período padrão | Últimos 7 dias com comparação vs 7 anteriores; presets 14/30/90, mês atual, mês passado, custom |
| Criativos | Card com miniatura + nome + link para o Gerenciador |
| Alertas | Automáticos (sino in-app + e-mail ao trio), limites default editáveis na aba |
| Drill-down | Campanha → anúncio (2 níveis; conjuntos/públicos fora da v1) |
| Nome da aba | **Tráfego** (tab key `trafego`) |

## 3. Arquitetura

**Espelho híbrido** (abordagem A+): sync diário grava métricas no Supabase (a aba lê do banco — rápido, com histórico e alertas); o botão "Atualizar agora" chama a function que busca **só o dia corrente** ao vivo na Graph API e upserta. O token da Meta **nunca** vai ao navegador; toda leitura/ação passa por Netlify Functions.

## 4. Dados (Supabase — RLS fechada, escrita só via RPC `SECURITY DEFINER` + `BOT_RPC_SECRET`, padrão asaas_mirror)

- **`meta_campanhas`** (PK campaign_id): account_id, nome, status efetivo (ACTIVE/PAUSED/...), objetivo, orcamento_diario (R$), updated_at, raw.
- **`meta_anuncios`** (PK ad_id): campaign_id, nome, status efetivo, thumbnail_url, permalink (Gerenciador), updated_at, raw. Thumbnails expiram — o sync diário re-grava as URLs.
- **`meta_ads_diario`** (PK dia+level+entity_id): level `campaign`|`ad`, campaign_id, dia (date), gasto, conversas_iniciadas, leads_form, impressoes, alcance, cliques, cliques_link, frequencia, video_3s (3-second video plays), raw(actions). CTR/CPM/CPL/hook são **derivados no compute**, nunca armazenados.
- **Retenção**: diário mantido por 400 dias (limpeza no cron); mensal (`meta_ads_mensal`) segue como está para o funil/histórico longo.
- **Config**: `bot_config` chave `meta_trafego` = `{ alertas: { ativo, cpl_mult (2.0), cpl_gasto_min_dia (100), queda_leads_pct (50), destinatarios[] }, atualizado_em, atualizado_por }`.
- **Leitura**: policy SELECT para `authenticated` nas 3 tabelas (a aba é RBAC-gated; quem tem a aba vê tudo dela).
- **RPC**: `meta_trafego_upsert(p_chave, p_campanhas, p_anuncios, p_diario)` — upsert dos 3 conjuntos numa chamada.

## 5. Functions

### `meta-trafego-sync.mjs`
- **Cron `10 10 * * *`** (07h10 BRT, após o mensal): catálogo de campanhas+anúncios (status/orçamento/thumbnail), insights diários dos últimos 3 dias (corrige atribuição tardia), limpeza >400d, avaliação de **alertas**, log no Monitor (`advbox_api_log`, origem `meta`).
- **Modos manuais**: `GET ?hoje=1` ("Atualizar agora": catálogo + dia corrente) e `GET ?backfill=1&dias=N` (1ª carga, default 90, cap 400). Padrão de auth do kommo-leads-sync (GET/scheduled livre — upsert idempotente sem exposição de dado; POST exige `BOT_PANEL_KEY`).
- **Alertas** (avaliados 1×/dia no cron, com dados de ontem; anti-flood: 1 alerta por tipo+campanha por dia):
  1. **CPL estourado**: CPL de ontem > `cpl_mult` × média 28d **e** gasto de ontem ≥ `cpl_gasto_min_dia`.
  2. **Entrega zerada**: campanha ACTIVE com gasto 0 ontem.
  3. **Queda de leads**: leads dos últimos 7d < `queda_leads_pct`% dos 7d anteriores (nível conta).
  - Canal: infra existente do watchdog (#6) — notificação in-app + e-mail aos `destinatarios` (default: trio).

### `meta-trafego-action.mjs`
- **POST** `{ acao: 'pausar'|'reativar'|'orcamento'|'config', campaign_id?, valor? }` — `config` grava os limites de alerta em `bot_config.meta_trafego` (mesma trava de trio; é a única via de escrita da config).
- **Auth dupla no servidor**: (1) `Authorization: Bearer <JWT Supabase>` validado via `auth.getUser` — identifica o usuário real; (2) e-mail ∈ `TRAFEGO_ACAO_EMAILS` (paulo, bruno, lorenza — constante na function). Sem JWT válido ou fora da lista → 403.
- Executa na Graph API (`status=PAUSED|ACTIVE` / `daily_budget` em centavos), lê o estado ANTES, grava auditoria em `activity_log` (quem, ação, campanha, antes→depois) + log no Monitor, e upserta o novo estado em `meta_campanhas` (a aba reflete na hora).

## 6. Frontend — aba "Tráfego" (13ª aba)

- **Registro**: tab key `trafego` em App.jsx (TABS + lazy load + prefetch), MobileNavSheet herda via `tabAllowed`; matriz do AdminPanel ganha a coluna; migração SQL liga a permissão para os 3 e-mails (demais ficam sem, admin liga quando quiser).
- **Arquivos**: `components/TrafegoPanel.jsx` (orquestração+visual) + `components/trafego/compute.js` (**lógica pura testada**: agregação por período, deltas vs período anterior, métricas derivadas — CTR = cliques_link ÷ impressões; CPM = gasto ÷ impressões × 1000; CPL = gasto ÷ leads; **hook rate = video_3s ÷ impressões**, só para anúncios com vídeo — rankings, badge de fadiga, série diária, dados do bloco comercial) + `components/trafego/api.js` (chamadas às functions).
- **Layout** (desktop e mobile, tokens `--cbc-*`, dark ok):
  1. Header: seletor de período (default 7d, comparação automática) · botão **Atualizar agora** (chama `?hoje=1`, spinner, refetch) · carimbo do último sync.
  2. KPIs com delta: gasto, leads, CPL, CTR, CPM, frequência média.
  3. Série diária: leads × gasto × CPL por dia (SVG no padrão dos gráficos do Dashboard).
  4. Campanhas: tabela ordenável (status, orçamento/dia, gasto, leads, CPL, CTR, tendência 7d, badge atenção); filtro "mostrar pausadas"; menu de ações por linha (⏸/▶/💰 com modal de confirmação mostrando antes→depois) — botões desabilitados fora do trio.
  5. Criativos: cards com miniatura+nome+link; abas de ranking **Top CTR** · **Top CPL** · **Mais leads** · **Hook rate** (vídeos); badge **"saturando"** = frequência ≥ 3,5 no período **e** CTR < 70% do período anterior (regra no compute, constantes nomeadas).
  6. **Do anúncio ao contrato** (mensal, últimos 6 meses): leads Meta → videochamadas → enviados → assinados + custo por contrato assinado (fontes: `meta_ads_mensal` + `vw_funil_videochamadas` + `contratos`; mesmo recorte mensal do funil). Nota fixa: agregado por mês-calendário; atribuição lead-a-lead virá com o espelho Kommo.
  7. Alertas: card com limites editáveis (grava em `bot_config.meta_trafego` via function, só trio) + últimos alertas disparados.

## 7. Segurança

- Token Meta só no servidor (functions); frontend nunca vê.
- Ações com validação de identidade **no servidor** (JWT), não por flag do cliente; lista de e-mails no código da function.
- Tabelas novas fechadas ao `anon`; escrita só via RPC com `BOT_RPC_SECRET`.
- Auditoria completa de qualquer ação de escrita na conta de anúncios.

## 8. Fora da v1 (explícito)

Conjuntos/públicos (3º nível), conta CBC Tributário, atribuição lead-a-lead (depende do espelho Kommo — projeto separado), Google Ads, automação de verba (copiloto apenas recomenda em versão futura; nunca mexe sozinho).

## 9. Testes e validação

- TDD em `trafego/compute.js` e extensões do parser `_lib/metaAds.mjs` (linhas diárias, video_3s, catálogos) — vitest, RED→GREEN.
- Validação com dados reais: backfill 90d rodado e conferido contra o Gerenciador (gasto/leads de 2-3 campanhas por amostragem) antes do deploy.
- Ações testadas em produção com uma campanha de teste/pausada (pausar→reativar; orçamento ajustado e revertido), com Paulo acompanhando.
- Suíte completa + lint + deploy único via `deploy.sh` (smoke + auto-rollback), backup prévio, rollback documentado.

## 10. Riscos e mitigação

- **Rate limit Meta**: sync diário + refresh manual ficam muito abaixo do limite; retry com backoff já padronizado (herda do meta-ads-sync).
- **Thumbnail expira**: re-gravada a cada sync diário; se 403 no `<img>`, card mostra placeholder com link.
- **Divergência vs Gerenciador**: atribuição da Meta atualiza por ~3 dias — o cron re-sincroniza D-1..D-3; rodapé da aba explica.
- **Ação indevida**: dupla trava (JWT + lista) + confirmação + auditoria + reversibilidade (pausar/orçamento são reversíveis com 1 clique).
