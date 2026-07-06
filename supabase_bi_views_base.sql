-- ============================================================================
-- supabase_bi_views_base.sql
-- SNAPSHOT versionado das views de BI / Power BI (auditoria #65).
--
-- Extraido de PRODUCAO em 06/07/2026 via pg_get_viewdef (somente leitura).
-- Motivo: as views-base do painel (vw_bi_processos, vw_bi_clientes,
-- vw_bi_financeiro, vw_bi_funil, vw_bi_andamentos, vw_powerbi_contratos e as
-- vw_processo_*/vw_funil_videochamadas) NAO estavam versionadas em nenhum
-- arquivo do repo — so existiam dentro do banco. Se o banco corromper ou
-- precisar de um 2o ambiente, este arquivo reconstroi TODO o modelo BI na
-- ordem correta de dependencia.
--
-- Idempotente (CREATE OR REPLACE). NAO aplique cegamente em producao — este e
-- um snapshot de referencia/recuperacao. Valide contra o estado atual antes de
-- rodar (algumas destas views tambem sao (re)criadas por migracoes
-- supabase_powerbi_*.sql; em caso de divergencia, a migracao mais recente vence).
--
-- security_invoker preservado conforme producao (true nas views BI que respeitam
-- a RLS do leitor; false nas 2 que rodam como owner). Grants de powerbi_cbc no fim.
-- ============================================================================

-- ============================================================
-- vw_bi_andamentos  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_andamentos WITH (security_invoker = true) AS
 SELECT lawsuit_id AS processo_id_advbox,
    process_number AS processo,
    customer_name AS cliente,
    event_date AS data,
    title AS andamento,
    payload ->> 'header'::text AS tribunal,
    ((payload ->> 'backfill'::text)::boolean) IS TRUE AS veio_do_backfill,
    created_at AS detectado_em
   FROM bot_sync_state
  WHERE kind = 'movement'::text;

-- ============================================================
-- vw_bi_clientes  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_clientes WITH (security_invoker = true) AS
 SELECT customer_id,
    nome,
    cpf_cnpj,
    email,
    celular,
    telefone,
    cidade,
    uf,
    profissao,
    estado_civil,
    genero,
    nascimento,
    origem,
    criado_em_advbox,
    qtd_processos,
    atualizado_em
   FROM bi_clientes;

-- ============================================================
-- vw_bi_financeiro  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_financeiro WITH (security_invoker = true) AS
 SELECT transaction_id,
    tipo,
    vencimento,
    pagamento,
    competencia,
    valor,
    descricao,
    responsavel,
    categoria,
    lawsuit_id,
    processo,
    cliente,
    cpf_cnpj,
    banco_debito,
    banco_credito,
    centro_custo,
    atualizado_em
   FROM bi_financeiro;

-- ============================================================
-- vw_bi_processos  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_processos WITH (security_invoker = true) AS
 SELECT lawsuit_id,
    process_number,
    protocol_number,
    folder,
    process_date,
    tipo,
    grupo,
    quadro,
    etapa,
    stages_id,
    responsavel,
    fees_expec,
    fees_money,
    contingency,
    status_closure,
    exit_production,
    exit_execution,
    clientes,
    parte_contraria,
    criado_em_advbox,
    atualizado_em
   FROM bi_processos;

-- ============================================================
-- vw_bi_funil  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_funil WITH (security_invoker = true) AS
 SELECT l.id,
    l.lawsuit_id,
    l.process_number,
    l.campo,
    l.de,
    l.para,
    l.detectado_em,
    p.etapa AS etapa_atual,
    p.quadro,
    p.responsavel
   FROM bi_processos_log l
     LEFT JOIN bi_processos p USING (lawsuit_id);

-- ============================================================
-- vw_bi_funil_etapas  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_funil_etapas WITH (security_invoker = true) AS
 WITH mud AS (
         SELECT bi_processos_log.lawsuit_id,
            bi_processos_log.process_number,
            bi_processos_log.para AS etapa,
            bi_processos_log.detectado_em AS inicio,
            lead(bi_processos_log.detectado_em) OVER (PARTITION BY bi_processos_log.lawsuit_id ORDER BY bi_processos_log.detectado_em, bi_processos_log.id) AS fim
           FROM bi_processos_log
          WHERE bi_processos_log.campo = 'etapa'::text
        )
 SELECT m.lawsuit_id,
    m.process_number,
    m.etapa,
    m.inicio,
    m.fim,
    round(EXTRACT(epoch FROM COALESCE(m.fim, now()) - m.inicio) / 86400.0, 1) AS dias_na_etapa,
    m.fim IS NULL AS em_andamento,
    p.quadro,
    p.responsavel,
    p.etapa AS etapa_atual_processo
   FROM mud m
     LEFT JOIN bi_processos p USING (lawsuit_id);

-- ============================================================
-- vw_bi_tarefas  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_tarefas WITH (security_invoker = true) AS
 WITH criadas AS (
         SELECT replace(bot_sync_state.item_key, 'task:'::text, ''::text) AS tid,
            bot_sync_state.id,
            bot_sync_state.kind,
            bot_sync_state.item_key,
            bot_sync_state.lawsuit_id,
            bot_sync_state.process_number,
            bot_sync_state.customer_name,
            bot_sync_state.title,
            bot_sync_state.event_date,
            bot_sync_state.payload,
            bot_sync_state.kommo_lead_id,
            bot_sync_state.kommo_note_posted,
            bot_sync_state.communicated,
            bot_sync_state.communicated_at,
            bot_sync_state.created_at,
            bot_sync_state.event_class,
            bot_sync_state.title_cliente,
            bot_sync_state.title_cliente_origem
           FROM bot_sync_state
          WHERE bot_sync_state.kind = 'task_created'::text
        ), concluidas AS (
         SELECT replace(bot_sync_state.item_key, 'taskdone:'::text, ''::text) AS tid,
            bot_sync_state.id,
            bot_sync_state.kind,
            bot_sync_state.item_key,
            bot_sync_state.lawsuit_id,
            bot_sync_state.process_number,
            bot_sync_state.customer_name,
            bot_sync_state.title,
            bot_sync_state.event_date,
            bot_sync_state.payload,
            bot_sync_state.kommo_lead_id,
            bot_sync_state.kommo_note_posted,
            bot_sync_state.communicated,
            bot_sync_state.communicated_at,
            bot_sync_state.created_at,
            bot_sync_state.event_class,
            bot_sync_state.title_cliente,
            bot_sync_state.title_cliente_origem
           FROM bot_sync_state
          WHERE bot_sync_state.kind = 'task_completed'::text
        )
 SELECT COALESCE(c.tid, d.tid)::bigint AS tarefa_id,
    COALESCE(c.title, d.title) AS tarefa,
    COALESCE(c.process_number, d.process_number) AS processo,
    COALESCE(c.customer_name, d.customer_name) AS cliente,
    COALESCE(c.lawsuit_id, d.lawsuit_id) AS processo_id_advbox,
    c.event_date AS data_criacao,
        CASE
            WHEN (c.payload ->> 'deadline'::text) ~ '^\d{4}-\d{2}-\d{2}'::text THEN (c.payload ->> 'deadline'::text)::date
            ELSE NULL::date
        END AS prazo,
    ( SELECT string_agg(x.value, ', '::text) AS string_agg
           FROM jsonb_array_elements_text(COALESCE(c.payload -> 'users'::text, '[]'::jsonb)) x(value)) AS responsaveis,
    d.event_date AS data_conclusao,
    ( SELECT string_agg(x.value, ', '::text) AS string_agg
           FROM jsonb_array_elements_text(COALESCE(d.payload -> 'completed_by'::text, '[]'::jsonb)) x(value)) AS concluida_por,
        CASE
            WHEN d.tid IS NOT NULL THEN 'concluida'::text
            WHEN
            CASE
                WHEN (c.payload ->> 'deadline'::text) ~ '^\d{4}-\d{2}-\d{2}'::text THEN (c.payload ->> 'deadline'::text)::date
                ELSE NULL::date
            END < CURRENT_DATE THEN 'atrasada'::text
            ELSE 'pendente'::text
        END AS status,
        CASE
            WHEN d.tid IS NOT NULL AND (c.payload ->> 'deadline'::text) ~ '^\d{4}-\d{2}-\d{2}'::text THEN d.event_date - ((c.payload ->> 'deadline'::text)::date)
            ELSE NULL::integer
        END AS dias_vs_prazo,
    COALESCE(c.created_at, d.created_at) AS detectado_em,
    COALESCE((c.payload ->> 'oculto'::text)::boolean, (d.payload ->> 'oculto'::text)::boolean, ( SELECT tt.ocultar_cliente
           FROM bot_task_templates tt
          WHERE upper(tt.task_name) = upper(COALESCE(c.title, d.title))
         LIMIT 1), false) AS oculta_do_cliente,
    "substring"(COALESCE(c.payload ->> 'created_at'::text, d.payload ->> 'created_at'::text), '^\d{4}-\d{2}-\d{2}'::text)::date AS data_criacao_real,
        CASE
            WHEN d.tid IS NOT NULL THEN d.event_date - "substring"(COALESCE(c.payload ->> 'created_at'::text, d.payload ->> 'created_at'::text), '^\d{4}-\d{2}-\d{2}'::text)::date
            ELSE NULL::integer
        END AS tempo_ciclo_dias,
        CASE
            WHEN COALESCE(c.payload ->> 'reward'::text, d.payload ->> 'reward'::text) ~ '^-?\d+(\.\d+)?$'::text THEN COALESCE(c.payload ->> 'reward'::text, d.payload ->> 'reward'::text)::numeric
            ELSE NULL::numeric
        END AS reward
   FROM criadas c
     FULL JOIN concluidas d ON d.tid = c.tid;

-- ============================================================
-- vw_powerbi_contratos  (security_invoker=false — le a base contratos como owner)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_powerbi_contratos AS
 SELECT id,
    created_at,
    updated_at,
    nome_contratante1,
    cpf_contratante1,
    email_contratante1,
    nome_contratante2,
    cpf_contratante2,
    resort,
    tipo_acao,
    honorarios_total,
    honorarios_parcelas,
    honorarios_valor_parcela,
    honorarios_percentual_exito,
    data_primeira_parcela,
    status,
    created_by,
    updated_by,
    zapsign_sent_at,
    signed_at,
    advbox_date,
    observacoes_internas,
    advbox_status,
    sexo_contratante1,
    sexo_contratante2,
    dados ->> 'origemCliente'::text AS origem_cliente,
    dados ->> 'dataPrimeiraMensagem'::text AS data_primeira_mensagem,
        CASE
            WHEN NULLIF(dados ->> 'dataPrimeiraMensagem'::text, ''::text) IS NOT NULL AND signed_at IS NOT NULL THEN signed_at::date - ((dados ->> 'dataPrimeiraMensagem'::text)::date)
            ELSE NULL::integer
        END AS jornada_compra_dias,
        CASE
            WHEN zapsign_sent_at IS NOT NULL AND signed_at IS NOT NULL THEN round(EXTRACT(epoch FROM signed_at - zapsign_sent_at) / 86400.0, 1)
            ELSE NULL::numeric
        END AS tempo_assinatura_dias,
    to_char(created_at, 'YYYY-MM'::text) AS mes_criacao,
    to_char(created_at, 'YYYY'::text) AS ano_criacao,
        CASE
            WHEN COALESCE(honorarios_total, 0::numeric) > 0::numeric AND COALESCE(honorarios_percentual_exito, 0::numeric) > 0::numeric THEN 'Iniciais + Exito'::text
            WHEN COALESCE(honorarios_total, 0::numeric) = 0::numeric AND COALESCE(honorarios_percentual_exito, 0::numeric) > 0::numeric THEN 'Somente Exito'::text
            ELSE 'Somente Iniciais'::text
        END AS tipo_honorario
   FROM contratos c;

-- ============================================================
-- vw_funil_videochamadas  (security_invoker=false)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_funil_videochamadas AS
 SELECT event_id,
    vendedora_email,
    status,
    color_id,
    scheduled_at,
    tem_meet
   FROM agenda_videochamadas;

-- ============================================================
-- vw_processo_distribuicao  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_processo_distribuicao WITH (security_invoker = true) AS
 SELECT processo_id_advbox::text AS lawsuit_id,
    max(data_conclusao) AS distribuido_em
   FROM vw_bi_tarefas
  WHERE upper(btrim(tarefa)) = 'DISTRIBUIR AÇÃO'::text AND data_conclusao IS NOT NULL AND processo_id_advbox IS NOT NULL
  GROUP BY processo_id_advbox;

-- ============================================================
-- vw_processo_distribuido  (security_invoker=false)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_processo_distribuido AS
 SELECT DISTINCT lawsuit_id::text AS lawsuit_id
   FROM bi_processos p
  WHERE process_number IS NOT NULL AND btrim(process_number) <> ''::text AND (EXISTS ( SELECT 1
           FROM contratos c
          WHERE c.advbox_lawsuit_id = p.lawsuit_id::text));

-- ============================================================
-- vw_processo_guia_paga  (security_invoker=false)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_processo_guia_paga AS
 WITH qualificados AS (
         SELECT bi_processos.lawsuit_id::text AS lawsuit_id
           FROM bi_processos
          WHERE (bi_processos.quadro = ANY (ARRAY['JUDICIAL'::text, 'RECURSAL'::text, 'EXECUÇÃO/COBRANÇA'::text])) AND bi_processos.etapa IS DISTINCT FROM 'AÇÃO PROTOCOLADA/INICIADA'::text AND bi_processos.lawsuit_id IS NOT NULL
        UNION
         SELECT vw_bi_tarefas.processo_id_advbox::text AS processo_id_advbox
           FROM vw_bi_tarefas
          WHERE vw_bi_tarefas.data_conclusao IS NOT NULL AND vw_bi_tarefas.processo_id_advbox IS NOT NULL AND upper(btrim(vw_bi_tarefas.tarefa)) = 'AGENDAR AUDIÊNCIA'::text
        UNION
         SELECT q.lid
           FROM ( SELECT vw_bi_tarefas.processo_id_advbox::text AS lid,
                    bool_or(upper(btrim(vw_bi_tarefas.tarefa)) = 'AVISAR CLIENTE DISTRIBUIÇÃO'::text) AS avisar,
                    bool_or(upper(btrim(vw_bi_tarefas.tarefa)) = 'GERAR + ENVIAR GUIA DE CUSTAS'::text) AS guia,
                    bool_or(upper(btrim(vw_bi_tarefas.tarefa)) = 'CUSTAS ANTES DA DISTRIBUIÇÃO'::text) AS custas_antes,
                    bool_or(upper(btrim(vw_bi_tarefas.tarefa)) = 'ACOMPANHAR PAGAMENTO'::text) AS acompanhar
                   FROM vw_bi_tarefas
                  WHERE vw_bi_tarefas.data_conclusao IS NOT NULL AND vw_bi_tarefas.processo_id_advbox IS NOT NULL
                  GROUP BY vw_bi_tarefas.processo_id_advbox) q
          WHERE q.avisar AND (q.guia OR q.custas_antes) AND q.acompanhar
        )
 SELECT DISTINCT lawsuit_id
   FROM qualificados ql
  WHERE (EXISTS ( SELECT 1
           FROM contratos c
          WHERE c.advbox_lawsuit_id = ql.lawsuit_id));

-- ============================================================
-- vw_bi_produtividade  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_produtividade WITH (security_invoker = true) AS
 WITH concluidas AS (
         SELECT replace(bot_sync_state.item_key, 'taskdone:'::text, ''::text)::bigint AS tarefa_id,
            bot_sync_state.id,
            bot_sync_state.kind,
            bot_sync_state.item_key,
            bot_sync_state.lawsuit_id,
            bot_sync_state.process_number,
            bot_sync_state.customer_name,
            bot_sync_state.title,
            bot_sync_state.event_date,
            bot_sync_state.payload,
            bot_sync_state.kommo_lead_id,
            bot_sync_state.kommo_note_posted,
            bot_sync_state.communicated,
            bot_sync_state.communicated_at,
            bot_sync_state.created_at,
            bot_sync_state.event_class,
            bot_sync_state.title_cliente,
            bot_sync_state.title_cliente_origem
           FROM bot_sync_state
          WHERE bot_sync_state.kind = 'task_completed'::text
        ), criadas AS (
         SELECT replace(bot_sync_state.item_key, 'task:'::text, ''::text)::bigint AS tarefa_id,
            bot_sync_state.id,
            bot_sync_state.kind,
            bot_sync_state.item_key,
            bot_sync_state.lawsuit_id,
            bot_sync_state.process_number,
            bot_sync_state.customer_name,
            bot_sync_state.title,
            bot_sync_state.event_date,
            bot_sync_state.payload,
            bot_sync_state.kommo_lead_id,
            bot_sync_state.kommo_note_posted,
            bot_sync_state.communicated,
            bot_sync_state.communicated_at,
            bot_sync_state.created_at,
            bot_sync_state.event_class,
            bot_sync_state.title_cliente,
            bot_sync_state.title_cliente_origem
           FROM bot_sync_state
          WHERE bot_sync_state.kind = 'task_created'::text
        )
 SELECT d.tarefa_id,
    d.title AS tarefa,
    pf.pessoa_final AS pessoa,
    d.event_date AS data_conclusao,
    date_trunc('month'::text, d.event_date::timestamp with time zone)::date AS mes_conclusao,
    c.event_date AS data_agendada,
    "substring"(COALESCE(c.payload ->> 'created_at'::text, d.payload ->> 'created_at'::text), '^\d{4}-\d{2}-\d{2}'::text)::date AS data_criacao_real,
        CASE
            WHEN c.event_date IS NOT NULL THEN d.event_date - c.event_date
            ELSE NULL::integer
        END AS dias_vs_agendado,
    d.event_date - "substring"(COALESCE(c.payload ->> 'created_at'::text, d.payload ->> 'created_at'::text), '^\d{4}-\d{2}-\d{2}'::text)::date AS tempo_ciclo_dias,
        CASE
            WHEN COALESCE(c.payload ->> 'reward'::text, d.payload ->> 'reward'::text) ~ '^-?\d+(\.\d+)?$'::text THEN COALESCE(c.payload ->> 'reward'::text, d.payload ->> 'reward'::text)::numeric
            ELSE NULL::numeric
        END AS reward,
        CASE
            WHEN upper(d.title) ~~ 'ALERTA DE TAREFA EXCLU%'::text OR (upper(d.title) = ANY (ARRAY['COMENTÁRIO'::text, 'COMENTARIO'::text])) THEN 'sistema'::text
            WHEN upper(d.title) ~~ 'PUBLICAÇÃO TRATADA%'::text OR upper(d.title) ~~ 'PUBLICACAO TRATADA%'::text OR upper(d.title) ~~ 'VERIFICAR INTERNO%'::text THEN 'instantanea'::text
            ELSE 'ciclo'::text
        END AS categoria,
    COALESCE((c.payload ->> 'oculto'::text)::boolean, (d.payload ->> 'oculto'::text)::boolean, ( SELECT tt.ocultar_cliente
           FROM bot_task_templates tt
          WHERE upper(tt.task_name) = upper(d.title)
         LIMIT 1), false) AS oculta_do_cliente,
    d.process_number AS processo,
    d.customer_name AS cliente,
    d.lawsuit_id AS processo_id_advbox,
    COALESCE(e.equipe, 'operacional'::text) AS equipe,
    upper(d.title) ~~ '%REFAZER%'::text OR upper(d.title) ~~ 'CORRIGIR PRESTA%'::text AS retrabalho
   FROM concluidas d
     CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
            WHEN jsonb_array_length(COALESCE(d.payload -> 'completed_by'::text, '[]'::jsonb)) > 0 THEN d.payload -> 'completed_by'::text
            ELSE '["(sem registro)"]'::jsonb
        END) p(pessoa)
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN upper(d.title) ~~ 'PUBLICAÇÃO TRATADA%'::text OR upper(d.title) ~~ 'PUBLICACAO TRATADA%'::text THEN COALESCE(( SELECT e2.pessoa
                       FROM bi_equipes e2
                      WHERE e2.equipe = 'operacional'::text AND split_part(e2.pessoa, ' '::text, 1) = TRIM(BOTH FROM regexp_replace(upper(d.title), '^PUBLICA[ÇC][ÃA]O TRATADA\s*'::text, ''::text))
                      ORDER BY e2.pessoa
                     LIMIT 1), p.pessoa)
                    ELSE p.pessoa
                END AS pessoa_final) pf
     LEFT JOIN criadas c USING (tarefa_id)
     LEFT JOIN bi_equipes e ON e.pessoa = pf.pessoa_final;

-- ============================================================
-- vw_bi_distribuicao  (security_invoker=true)
-- ============================================================
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
    COALESCE(p.process_date IS NOT NULL AND p.process_date::timestamp with time zone::date < p.criado_em_advbox::timestamp with time zone::date, false) AS cadastro_retroativo
   FROM bi_processos p
     LEFT JOIN dist_tarefa dt USING (lawsuit_id);

-- ============================================================
-- vw_bi_carga_atual  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_carga_atual WITH (security_invoker = true) AS
 SELECT t.tarefa_id,
    t.tarefa,
    TRIM(BOTH FROM p.pessoa) AS pessoa,
    COALESCE(e.equipe, 'operacional'::text) AS equipe,
    t.status,
    t.data_criacao AS data_agendada,
    t.data_criacao_real,
    t.prazo,
    GREATEST(0, h.hoje - COALESCE(t.data_criacao_real, t.data_criacao)) AS dias_em_aberto,
        CASE
            WHEN GREATEST(0, h.hoje - COALESCE(t.data_criacao_real, t.data_criacao)) <= 7 THEN '0-7 dias'::text
            WHEN GREATEST(0, h.hoje - COALESCE(t.data_criacao_real, t.data_criacao)) <= 30 THEN '8-30 dias'::text
            ELSE 'mais de 30 dias'::text
        END AS faixa_aging,
    t.data_criacao > h.hoje AS agendada_para_futuro,
    t.processo,
    t.cliente,
    t.processo_id_advbox,
    t.oculta_do_cliente,
        CASE
            WHEN t.data_criacao IS NULL THEN 'sem data'::text
            WHEN t.data_criacao < h.hoje THEN
            CASE
                WHEN (( SELECT count(*) AS count
                   FROM generate_series((t.data_criacao + 1)::timestamp with time zone, (h.hoje - 1)::timestamp with time zone, '1 day'::interval) g(g)
                  WHERE EXTRACT(isodow FROM g.g) < 6::numeric)) >= 1 THEN 'vencida'::text
                ELSE 'carencia (1 dia util)'::text
            END
            WHEN t.data_criacao = h.hoje THEN 'para hoje'::text
            WHEN t.data_criacao <= (h.hoje + 7) THEN 'proximos 7 dias'::text
            ELSE 'mais adiante'::text
        END AS situacao_agenda,
    COALESCE(( SELECT count(*) AS count
           FROM generate_series((t.data_criacao + 1)::timestamp with time zone, (h.hoje - 1)::timestamp with time zone, '1 day'::interval) g(g)
          WHERE EXTRACT(isodow FROM g.g) < 6::numeric), 0::bigint)::integer AS dias_uteis_atraso
   FROM vw_bi_tarefas t
     JOIN bot_tarefas_abertas_snapshot snap ON snap.task_id = t.tarefa_id
     CROSS JOIN LATERAL ( SELECT (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date AS hoje) h
     CROSS JOIN LATERAL regexp_split_to_table(COALESCE(NULLIF(t.responsaveis, ''::text), '(sem responsavel)'::text), ',\s*'::text) p(pessoa)
     LEFT JOIN bi_equipes e ON e.pessoa = TRIM(BOTH FROM p.pessoa)
  WHERE (t.status = ANY (ARRAY['pendente'::text, 'atrasada'::text])) AND (upper(t.tarefa) <> ALL (ARRAY['COMENTÁRIO'::text, 'COMENTARIO'::text]));

-- ============================================================
-- vw_bi_tarefas_pre_distribuicao  (security_invoker=true)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_bi_tarefas_pre_distribuicao WITH (security_invoker = true) AS
 WITH marco AS (
         SELECT d.lawsuit_id,
            LEAST(d.distribuido_em, d.tarefa_distribuir_concluida) AS marco_distribuicao,
            d.criado_em,
            d.cadastro_retroativo
           FROM vw_bi_distribuicao d
          WHERE d.distribuido
        )
 SELECT pr.tarefa_id,
    pr.tarefa,
    pr.pessoa,
    pr.data_conclusao,
    pr.mes_conclusao,
    pr.data_agendada,
    pr.data_criacao_real,
    pr.dias_vs_agendado,
    pr.tempo_ciclo_dias,
    pr.reward,
    pr.categoria,
    pr.oculta_do_cliente,
    pr.processo,
    pr.cliente,
    pr.processo_id_advbox,
    pr.equipe,
    pr.retrabalho,
    m.marco_distribuicao AS distribuido_em,
    m.marco_distribuicao - pr.data_conclusao AS dias_antes_da_distribuicao,
    m.criado_em,
    pr.data_conclusao - m.criado_em AS dias_desde_criacao,
    m.cadastro_retroativo
   FROM vw_bi_produtividade pr
     JOIN marco m ON m.lawsuit_id = pr.processo_id_advbox
  WHERE pr.data_conclusao <= m.marco_distribuicao AND upper(pr.tarefa) !~~ 'DISTRIBUIR%'::text;

-- ============================================================================
-- GRANTS (Power BI le-somente via usuario powerbi_cbc — ver memoria
-- powerbi-credencial-bi). Confirme a lista antes de aplicar; incluidas as views
-- que o painel consome hoje.
-- ============================================================================
-- GRANT SELECT ON public.vw_bi_processos, public.vw_bi_clientes,
--   public.vw_bi_financeiro, public.vw_bi_funil, public.vw_bi_funil_etapas,
--   public.vw_bi_andamentos, public.vw_bi_tarefas, public.vw_bi_produtividade,
--   public.vw_bi_distribuicao, public.vw_bi_carga_atual,
--   public.vw_bi_tarefas_pre_distribuicao, public.vw_powerbi_contratos,
--   public.vw_funil_videochamadas, public.vw_processo_distribuicao,
--   public.vw_processo_distribuido, public.vw_processo_guia_paga
--   TO powerbi_cbc;
