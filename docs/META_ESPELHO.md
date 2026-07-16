# Espelho Meta Ads no Supabase — dicionário de dados

> **Para quem for construir OUTRAS aplicações** (Power BI, apps internos, análises):
> tudo que a Meta Marketing API oferece de útil já está espelhado no Supabase e é
> atualizado sozinho. **Não chame a Graph API — leia estas tabelas.**
> Criado 14-16/07/2026 (aba Tráfego v1→v3). Migrações: `meta_trafego`, `meta_trafego_v2`,
> `meta_trafego_v3_espelho_completo` (+ `supabase_meta_trafego.sql` na raiz).

## Como o espelho é abastecido (ninguém precisa fazer nada)

| Rota | Quando | O que grava |
|------|--------|-------------|
| `meta-trafego-sync` (cron **07h10 BRT**) | diário | despacha o worker background |
| `meta-trafego-worker-background` | até 15 min | catálogos completos (campanhas/conjuntos/anúncios com copy), insights D-3..D-1 nos 3 níveis, breakdowns, snapshot da conta, atividades D-3..hoje, limpeza 400d, alertas |
| `meta-trafego-sync?hoje=1` | botão "Atualizar" da aba | campanhas (status/orçamento) + métricas do dia corrente + snapshot da conta |
| `meta-trafego-sync?backfill=1&dias=N` | manual (cap 400) | re-varre N dias em janelas de 10 |
| `meta-ads-sync` (cron **07h BRT**) | diário | agregado MENSAL por campanha (`meta_ads_mensal`, alimenta o funil) |
| `meta-trafego-action` | ações da aba (trio) | espelha imediatamente status/orçamento após pausar/reativar/orçamento |

Conta espelhada: `act_969110338250520` (CA - CBC Distratos). Multi-conta: env `META_AD_ACCOUNT_IDS` (vírgula).

## Tabelas

Todas com RLS: **leitura para `authenticated`**, escrita só via RPC `meta_trafego_upsert` /
`meta_ads_upsert` (SECURITY DEFINER + `BOT_RPC_SECRET`). Dinheiro sempre em **reais** (a
Graph devolve centavos; os parsers convertem). Datas de métricas em **BRT**.

### `meta_campanhas` — catálogo de campanhas (1 linha por campanha)
| Coluna | Significado |
|--------|-------------|
| `campaign_id` PK, `account_id`, `nome`, `status` (effective_status), `objetivo` | identificação |
| `orcamento_diario`, `orcamento_total` | R$; null quando o orçamento está no conjunto (ABO) |
| `criado_em`, `alterado_em`, `inicio`, `fim` | ciclo de vida (v3) |
| `buying_type`, `bid_strategy` | estratégia de compra/lance (v3) |
| `raw` jsonb | resposta integral da Graph |

### `meta_conjuntos` — catálogo de conjuntos (adsets)
Como campanhas, mais: `otimizacao` (optimization_goal), `evento_cobranca` (billing_event) e
**`publico` jsonb = targeting completo** (idades, geolocalização, públicos custom/lookalike,
interesses) — v3.

### `meta_anuncios` — catálogo de anúncios/criativos
`ad_id` PK, `campaign_id`, `nome`, `status`, `thumbnail_url` (miniatura), `permalink`
(preview), e a **copy inteira** (v3): `titulo`, `corpo`, `cta` (call_to_action_type),
`video_id`, `imagem_url`, `criado_em`/`alterado_em`, `raw`.

### `meta_ads_diario` — métricas por DIA (a tabela principal)
PK `(dia, level, entity_id)`. **`level`** = `campaign` | `adset` | `ad`; `entity_id` é o id
do nível (⚠️ ao agregar, filtre UM level — somar os três triplica).
Métricas: `gasto`, `conversas_iniciadas` (click-to-WhatsApp = "resultados" do Gerenciador),
`leads_form`, `impressoes`, `alcance`, `cliques`, `cliques_link`, `frequencia`,
`video_3s`, `video_thruplay`, `video_p25/p50/p75/p100` (retenção),
`qualidade`/`ranking_engajamento`/`ranking_conversao` (quality rankings da Meta — **só
level=ad**; preservados por coalesce), `raw.actions` (todas as actions brutas).
**Lead = conversas_iniciadas + leads_form.** Retenção: 400 dias.

### `meta_ads_breakdown` — recortes diários no nível da CONTA
PK `(dia, tipo, chave)`. `tipo` = `age_gender` (`"25-34 · feminino"`), `region` (UF/cidade),
`platform_position` (`"instagram · instagram_reels"`). Métricas básicas por recorte.

### `meta_conta_diaria` — snapshot diário da conta (v3)
PK `(dia, account_id)`: `gasto_acumulado` (all-time da conta), `saldo` (a faturar),
`limite_gasto`, `status` (1=ativa, 2=desativada, 3=inadimplente…), `moeda`, `raw`.

### `meta_atividades` — trilha do Gerenciador (v3)
Quem mudou o quê na conta (audit da própria Meta): `event_time`, `event_type`
(ex.: `update_campaign_run_status`, `update_campaign_budget`), `ator` (nome da pessoa),
`objeto`/`objeto_id`, `extra` jsonb (old/new values). Idempotente por
`(account_id, event_time, event_type, objeto_id)`.

### `meta_ads_mensal` — agregado mensal por campanha (desde jul/2024)
`mes` (dia 1), `campaign_id`, `campaign_name`, `conversas_iniciadas`, `leads_form`,
`gasto`, `impressoes`, `cliques`. Alimenta a etapa "Leads de campanha" dos funis.
Backfill de 24 meses feito em 14/07/2026.

## Views prontas para BI (grant `powerbi_cbc`)

- **`vw_bi_trafego_mensal`** — mensal + coluna `leads` e `cpl` calculados.
- **`vw_bi_trafego_diario`** — diário level=campaign com `campanha`, `status`, `objetivo`,
  flag **`rh`** (campanhas [VAGA]/RH — exclua-as de métricas comerciais) e vídeo.

No Power BI: mesmo usuário/senha das views `vw_bi_*` (doc `docs/POWERBI_CONEXAO.md`).

## Armadilhas conhecidas

1. **PostgREST corta em 1000 linhas/request** — pagine com `.range()` (o painel tem o helper `pagina()`).
2. **Campanhas de RH/vaga** (`[VAGA]…`) não são captação — use `isCampanhaRh`/flag `rh`.
3. **Custo de query da Meta é dinâmico** — se mexer nos fetchers, mantenha catálogos em páginas de 25 e insights em janelas de 10 dias.
4. O dia corrente muda o dia inteiro (frescor); D-1 para trás é estável (validado: 0,00% de divergência diário×mensal).
5. `meta_ads_diario.raw.actions` guarda TODAS as actions da Meta — dá para extrair novas métricas sem re-backfill.
