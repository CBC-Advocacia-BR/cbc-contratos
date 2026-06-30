-- =============================================================
-- 0002 — Indices compostos para performance de listagem
-- =============================================================
-- Resumo: adiciona indice composto (status, created_at DESC) que
-- acelera as queries mais frequentes em ContratosTab e Dashboard,
-- onde filtramos por status e ordenamos pela data de criacao.
--
-- Antes deste indice, o Postgres usa idx_contratos_status (b-tree
-- simples) + sort em memoria. Com o indice composto, o resultado
-- vem ja ordenado direto do indice.
--
-- Idempotente: usa IF NOT EXISTS.
-- Tempo estimado: <1s (poucos milhares de linhas).
-- =============================================================

-- UP ----------------------------------------------------------

-- Listagem por status ordenada por data (Dashboard, ContratosTab)
CREATE INDEX IF NOT EXISTS idx_contratos_status_created
  ON contratos (status, created_at DESC)
  WHERE arquivado_em IS NULL;

-- Listagem por usuario criador ordenada (filtro "meus contratos")
CREATE INDEX IF NOT EXISTS idx_contratos_created_by_at
  ON contratos (created_by, created_at DESC)
  WHERE arquivado_em IS NULL;

-- Filtragem temporal pura (Dashboard "este mes", "este ano")
-- Sem WHERE arquivado IS NULL pq Dashboard pode mostrar arquivados
-- quando filtro de "incluir arquivados" estiver ativo.
CREATE INDEX IF NOT EXISTS idx_contratos_resort_created
  ON contratos (resort, created_at DESC)
  WHERE arquivado_em IS NULL;

-- =============================================================
-- DOWN (reversao — comentado por padrao)
-- =============================================================

/*
DROP INDEX IF EXISTS idx_contratos_status_created;
DROP INDEX IF EXISTS idx_contratos_created_by_at;
DROP INDEX IF EXISTS idx_contratos_resort_created;
*/

-- =============================================================
-- Verificacao apos rodar:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'contratos'
--   AND indexname LIKE 'idx_contratos_%_created%';
-- =============================================================
