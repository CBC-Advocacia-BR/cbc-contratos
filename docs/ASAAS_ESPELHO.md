# Espelho Asaas (asaas_boletos) — auditoria e arquitetura (11/06/2026)

## O que aconteceu (auditoria)
- O cron diário de boletos (6h) rodava como função **comum** e estourava o
  timeout antes de terminar — o espelho só atualizava quando alguém clicava no
  sync manual do painel (último: 02/06).
- `asaas_boletos`, `asaas_sync_state`, `asaas_error_log` e `asaas_customers`
  têm RLS apenas para `authenticated`; as functions usam a chave **anon** →
  escritas falhavam **em silêncio** (update afeta 0 linhas, sem erro).
  O webhook de pagamento também não atualizava o espelho por isso.
- Defasagem encontrada: 138 boletos criados desde 31/05 fora do espelho,
  57 pagamentos em dinheiro e 68 recebidos faltando, ~94 pendentes/vencidos
  "fantasma" (pagos/excluídos sem refletir).

## A correção
1. **RPCs `security definer` com segredo** (migrations
   `asaas_mirror_rpcs_bot_extrato_metricas` + `asaas_mirror_cache_e_reconciliacao`):
   `asaas_mirror_upsert/update/state/cache/stale_open` — escrevem no espelho
   sem abrir a tabela para anon. Segredo: env `BOT_RPC_SECRET` (Netlify) =
   `bot_secrets.value` (tabela com RLS e **zero** policies — invisível via API).
2. **`asaas-sync-boletos-background.mjs`** (novo): worker em background
   (15 min) com auto-encadeamento por orçamento de tempo, modos
   `incremental` (pendentes+vencidos completos, pagos 90d) e `full`
   (backfill total), e **reconciliação**: abertos no espelho que a rodada não
   viu são re-buscados um a um (pagos por fora/excluídos viram DELETED).
3. **`asaas-sync-boletos.mjs`**: agendada `0 9,21 * * *` (6h e 18h BRT) —
   só dispara o worker. Modo manual em blocos (painel Boletos) continua.
4. **`asaas-webhook.mjs`**: atualiza o espelho via RPC em tempo real
   (pago/vencido/estornado/chargeback) e faz upsert completo de boletos que
   ainda não existiam; preparado para PAYMENT_CREATED/UPDATED se esses
   eventos forem habilitados no painel do Asaas.
5. Erros de todas as peças vão para `advbox_api_log` com `origem='asaas'`
   → aparecem no **Monitor ADVBOX** do sistema.

## Bot: extrato financeiro (intenção `financeiro`)
- RPC `bot_extrato(p_chave, p_customer_id)`: resolve o CPF em `bi_clientes` e
  agrega `asaas_boletos` → pagos, em aberto, atrasados, próxima parcela com
  boleto e PIX copia-e-cola.
- Engine: "quanto falta pagar?" → resumo; "pix" → código copia-e-cola da
  próxima parcela. Keywords na intenção `financeiro` (aba Intenções).

## Métricas do bot (aba Métricas)
- RPC `bot_metricas(p_dias)`: taxa de resolução sem humano, conversas,
  intenções mais acionadas, perguntas mais comuns, horários de pico,
  escaladas recentes. Action `metrics` no `advbox-bot-reply`.

## Carga (verificado)
- **Asaas API**: sem limite publicado rígido; rodada incremental ≈ 40–80
  requisições 2×/dia. Backfill completo ≈ ~12k registros / ~120 páginas.
- **Netlify**: +2 invocações agendadas/dia + 1–3 elos de background; minutos
  de runtime/dia — irrelevante no plano Pro (125k inv + 100 h/mês).
- **Supabase**: espelho completo = ~11 MB para ~11,7k boletos; crescimento
  ~150 boletos/mês (~1,5 MB/ano) — irrelevante no Pro (8 GB).

## Operação
- Disparo manual: action `asaas_sync_run` no `advbox-bot-reply`
  (`{mode:'incremental'|'full'}`) ou POST direto na função background.
- Status da rodada: `bot_config` key `asaas_sync_status`.
- Pendência conhecida: `asaas_customers` (espelho de clientes) continua
  bloqueado por RLS — corrigir com o mesmo padrão de RPC.

## Cobranças excluídas × inadimplência (auditoria 11/06/2026)
- Pagamentos EXCLUÍDOS no Asaas somem das listagens da API mas mantêm o
  status original (`deleted:true` no GET individual). O pipeline marca como
  `DELETED` no espelho por duas vias: **reconciliação** (toda rodada do sync,
  6h/18h) e agora também **webhook em tempo real** — os eventos do webhook
  foram ampliados de [CONFIRMED, RECEIVED] para [CONFIRMED, RECEIVED,
  DELETED, OVERDUE, RESTORED, REFUNDED] (PUT /v3/webhooks, 11/06).
- O relatório de inadimplência filtra apenas OVERDUE + PENDING vencido —
  DELETED nunca entra.
- Auditoria completa (diff espelho × API ao vivo): os 205 vencidos do espelho
  existem todos na API — **zero excluídos contaminando a lista**. 17 clientes
  tiveram 151 cobranças excluídas (R$ 44.650, renegociações) e TODOS estão
  corretamente fora da inadimplência.
