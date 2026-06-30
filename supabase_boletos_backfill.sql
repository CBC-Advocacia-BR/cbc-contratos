-- ============================================================================
-- BACKFILL — corrige boletos historicos que ficaram presos como PENDING/OVERDUE
-- no Supabase mas ja foram pagos no Asaas.
--
-- Causa: ate hoje os syncs (asaas-sync-boletos / asaas-sync-customer) buscavam
-- apenas status PENDING e OVERDUE no Asaas. Quando um boleto era pago, o Asaas
-- mudava para RECEIVED mas o Supabase nunca era atualizado, inflando o painel
-- de inadimplencia (~699 boletos vencidos falsos).
--
-- Como rodar:
--   1) Abrir Supabase SQL Editor (https://supabase.com/dashboard/project/vygczeepvoyaehfchxko/sql)
--   2) Rodar STEP 1 e analisar o resultado (quantos boletos sao candidatos?)
--   3) Apos confirmar, rodar STEP 2 (resync forcado via funcao Netlify) ou
--      STEP 3 (correcao manual rapida apenas pelos boletos com payment_date).
--   4) Validar com STEP 4.
--
-- IMPORTANTE: este script NAO executa nada que destrua dados. So faz UPDATE
-- de status (campo ja editavel pelo proprio sync). Reversivel rodando o sync
-- de novo, que sobrescreve com o status atual do Asaas.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 1 — DIAGNOSTICO (so SELECT, nao altera nada)
-- Quantos boletos estao "vencidos" no Supabase mas tem payment_date preenchido?
-- (payment_date so e setado quando o Asaas marca como pago)
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  status,
  COUNT(*) AS total_boletos,
  COUNT(payment_date) AS com_payment_date,
  SUM(value) AS valor_total
FROM asaas_boletos
WHERE status IN ('PENDING', 'OVERDUE')
GROUP BY status
ORDER BY status;

-- Detalhe: amostra de 20 boletos suspeitos (PENDING/OVERDUE com payment_date)
SELECT id, customer_name, status, due_date, payment_date, value
FROM asaas_boletos
WHERE status IN ('PENDING', 'OVERDUE')
  AND payment_date IS NOT NULL
ORDER BY payment_date DESC
LIMIT 20;


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 2 — CORRECAO RAPIDA: marca como RECEIVED os boletos que ja tem
-- payment_date preenchido. Esses sao 100% seguros — payment_date so vem
-- preenchido pelo Asaas quando o pagamento foi confirmado.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE asaas_boletos
SET status = 'RECEIVED',
    updated_at = NOW(),
    synced_at = NOW()
WHERE status IN ('PENDING', 'OVERDUE')
  AND payment_date IS NOT NULL;

-- Verifica quantos foram corrigidos:
-- (Resultado deve ser proximo do diagnostico do STEP 1)


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 3 (OPCIONAL) — boletos vencidos antigos sem payment_date.
-- Esses precisam ser revalidados contra o Asaas. Para isso:
--
--   a) Listar IDs dos boletos suspeitos (vencidos ha mais de 30 dias):
-- ─────────────────────────────────────────────────────────────────────────
SELECT id, customer_name, due_date, value
FROM asaas_boletos
WHERE status IN ('PENDING', 'OVERDUE')
  AND payment_date IS NULL
  AND due_date < (CURRENT_DATE - INTERVAL '30 days')
ORDER BY due_date
LIMIT 50;

--   b) Rode o sync manual no painel "Boletos" (botao "Sync Asaas").
--      Apos a correcao do codigo (RECEIVED incluido nos STATUSES), o sync
--      vai trazer os pagos antigos automaticamente — pelo menos os dos
--      ultimos 90 dias (PAID_LOOKBACK_DAYS).


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 4 — VALIDACAO POS-BACKFILL
-- Numeros depois da correcao:
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  status,
  COUNT(*) AS qtd,
  COUNT(DISTINCT customer_id) AS clientes_unicos,
  SUM(value) AS valor_total
FROM asaas_boletos
GROUP BY status
ORDER BY qtd DESC;

-- Quantos clientes sao realmente inadimplentes hoje?
SELECT COUNT(DISTINCT customer_id) AS clientes_inadimplentes_reais
FROM asaas_boletos
WHERE status IN ('PENDING', 'OVERDUE')
  AND payment_date IS NULL
  AND due_date < CURRENT_DATE;
