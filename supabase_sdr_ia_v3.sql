-- sdr_ia_v3 (08/09/2026): rastro de entrega no turno + RPC de saude da cadeia. Aplicada em producao
-- (migracao sdr_ia_v3_rastro). Ver client/scripts/ana-diagnostico.mjs para o uso.
alter table public.sdr_ia_turnos add column if not exists entrega jsonb;
-- sdr_ia_turno_gravar recriada com a coluna entrega; sdr_ia_saude(p_chave, p_horas) devolve o retrato
-- da cadeia (webhooks recebidos, saidas por motivo, turnos, custo, entregas com falha, fila, cron).
-- Corpo completo aplicado via MCP; manter este arquivo como registro da migracao.
