-- ============================================================================
-- supabase_powerbi_fix_dias_distribuir.sql   (auditoria #66)
--
-- PROBLEMA: em vw_bi_distribuicao, a flag `distribuido` fica TRUE se houver
-- process_date OU a tarefa DISTRIBUIR AÇÃO concluida, MAS `dias_ate_distribuir`
-- so e calculado a partir de process_date. Processos distribuidos apenas pela
-- tarefa (sem process_date) contam como Distribuidos mas contribuem NULL para a
-- mediana. A medida DAX "Dias ate Distribuir = MEDIAN(dias_ate_distribuir)"
-- ignora os NULLs em silencio => a mediana sai calculada sobre um subconjunto,
-- podendo parecer mais rapida (ou mais lenta) do que a realidade.
--
-- CORRECAO: adiciona a coluna `dias_ate_distribuir_efetivo`, medida a partir do
-- MARCO REAL de distribuicao — o mesmo LEAST(process_date, tarefa_distribuir_concluida)
-- que a vw_bi_tarefas_pre_distribuicao ja usa. Assim "Distribuidos" e "Dias ate
-- Distribuir" passam a medir EXATAMENTE o mesmo universo de processos.
--
-- No Power BI: reaponte a medida [Dias ate Distribuir (mediana)] para
--   MEDIAN(Distribuicao[dias_ate_distribuir_efetivo])
-- (a coluna antiga `dias_ate_distribuir` fica preservada para nao quebrar nada).
--
-- Coluna nova ANEXADA NO FIM (auditoria #74): CREATE OR REPLACE mantendo a ordem
-- das colunas existentes evita recriar/reordenar o modelo do Power BI.
-- security_invoker=true preservado. NAO aplicado automaticamente — validar e rodar
-- via MCP apply_migration quando aprovado (a vw_bi_tarefas_pre_distribuicao depende
-- desta view, mas apenas ANEXAR coluna e permitido pelo CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_bi_distribuicao WITH (security_invoker = true) AS
 WITH dist_tarefa AS (
         SELECT bot_sync_state.lawsuit_id,
            min(bot_sync_state.event_date) AS tarefa_distribuir_concluida
           FROM bot_sync_state
          WHERE bot_sync_state.kind = 'task_completed'::text AND upper(bot_sync_state.title) ~~ 'DISTRIBUIR AÇÃO%'::text
          GROUP BY bot_sync_state.lawsuit_id
        )
 SELECT p.lawsuit_id,
    p.process_number,
    p.tipo,
    p.grupo,
    p.quadro,
    p.etapa,
    p.responsavel,
    p.clientes,
    p.criado_em_advbox::timestamp with time zone::date AS criado_em,
    p.process_date::timestamp with time zone::date AS distribuido_em,
    dt.tarefa_distribuir_concluida,
        CASE
            WHEN p.process_date IS NOT NULL THEN p.process_date::timestamp with time zone::date - p.criado_em_advbox::timestamp with time zone::date
            ELSE NULL::integer
        END AS dias_ate_distribuir,
        CASE
            WHEN dt.tarefa_distribuir_concluida IS NOT NULL THEN dt.tarefa_distribuir_concluida - p.criado_em_advbox::timestamp with time zone::date
            ELSE NULL::integer
        END AS dias_ate_tarefa_distribuir,
    p.process_date IS NOT NULL OR dt.tarefa_distribuir_concluida IS NOT NULL AS distribuido,
        CASE
            WHEN p.process_date IS NULL AND dt.tarefa_distribuir_concluida IS NULL THEN CURRENT_DATE - p.criado_em_advbox::timestamp with time zone::date
            ELSE NULL::integer
        END AS dias_aguardando,
    COALESCE(p.process_date IS NOT NULL AND p.process_date::timestamp with time zone::date < p.criado_em_advbox::timestamp with time zone::date, false) AS cadastro_retroativo,
    -- (auditoria #66) marco REAL de distribuicao = o que vier primeiro entre a data
    -- de distribuicao (process_date) e a conclusao da tarefa DISTRIBUIR AÇÃO.
    -- LEAST ignora NULLs no Postgres, entao cobre os 3 casos (so process_date,
    -- so tarefa, ou ambos). NULL quando o processo ainda nao foi distribuido.
        CASE
            WHEN p.process_date IS NOT NULL OR dt.tarefa_distribuir_concluida IS NOT NULL
              THEN LEAST(p.process_date::timestamp with time zone::date, dt.tarefa_distribuir_concluida) - p.criado_em_advbox::timestamp with time zone::date
            ELSE NULL::integer
        END AS dias_ate_distribuir_efetivo
   FROM bi_processos p
     LEFT JOIN dist_tarefa dt USING (lawsuit_id);

-- Sanidade sugerida apos aplicar (compara os dois universos):
--   SELECT count(*) FILTER (WHERE distribuido)                          AS distribuidos,
--          count(dias_ate_distribuir)                                   AS com_dias_antigo,
--          count(dias_ate_distribuir_efetivo)                           AS com_dias_efetivo,
--          percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_ate_distribuir)          AS mediana_antiga,
--          percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_ate_distribuir_efetivo)  AS mediana_efetiva
--   FROM public.vw_bi_distribuicao;
