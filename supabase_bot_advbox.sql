-- ============================================================
-- BOT ADVBOX (autoatendimento Kommo x ADVBOX) — versao de teste
-- Rodar no Supabase SQL Editor (projeto vygczeepvoyaehfchxko)
-- Criado em 09/06/2026. Todas as tabelas sao novas (aditivo, sem
-- alteracao em tabelas existentes).
-- ============================================================

-- Config geral (chave/valor JSONB)
create table if not exists bot_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Respostas parametrizadas por etapa (stage) do ADVBOX
create table if not exists bot_stage_templates (
  id bigint generated always as identity primary key,
  stages_id bigint not null,                 -- id da etapa no ADVBOX (GET /settings)
  stage_name text not null default '',
  template text not null default '',         -- corpo da resposta (placeholders {{...}})
  proximos_passos text not null default '',  -- texto "o que acontece agora"
  prazo_medio text not null default '',      -- expectativa de prazo desta fase
  ocultar_cliente boolean not null default false, -- bot nao revela o nome desta etapa
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (stages_id)
);

-- Textos por tipo de tarefa do ADVBOX ("o que o escritorio esta fazendo")
create table if not exists bot_task_templates (
  id bigint generated always as identity primary key,
  task_id bigint not null,                   -- id do tipo de tarefa no ADVBOX (GET /settings)
  task_name text not null default '',
  texto_pendente text not null default '',   -- ex.: "estamos elaborando o recurso"
  texto_concluida text not null default '',  -- ex.: "protocolamos a peticao inicial"
  notificar boolean not null default false,  -- sugerir comunicacao ao cliente quando concluida
  ocultar_cliente boolean not null default false, -- nunca mostrar ao cliente (vai p/ BI mesmo assim)
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (task_id)
);

-- Glossario juridiques -> linguagem simples (deterministico)
create table if not exists bot_glossary (
  id bigint generated always as identity primary key,
  term text not null,                        -- termo/trecho a procurar no andamento
  match_type text not null default 'contains' check (match_type in ('contains','exact','regex')),
  translation text not null,                 -- texto em linguagem simples
  priority int not null default 100,         -- menor = aplicado primeiro
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Cache de traducoes feitas por IA (evita pagar 2x pelo mesmo andamento)
create table if not exists bot_ai_cache (
  hash text primary key,                     -- sha-ish do texto original
  source text not null,
  translation text not null,
  created_at timestamptz not null default now()
);

-- Classificador de intencao (palavras-chave -> acao)
create table if not exists bot_intents (
  id bigint generated always as identity primary key,
  intent_key text not null unique,           -- ex.: andamento, audiencia, financeiro, humano
  name text not null,
  keywords text[] not null default '{}',     -- match por palavra (sem acento, minusculas)
  action text not null default 'template' check (action in ('andamento','audiencia','tarefas','template','humano')),
  response_template text not null default '',-- usado quando action = template/humano
  priority int not null default 100,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Testadores: telefones autorizados a conversar com o bot via WhatsApp/Kommo.
-- O bot SO responde a numeros cadastrados aqui (modo teste — clientes reais nunca recebem resposta).
create table if not exists bot_testers (
  id bigint generated always as identity primary key,
  phone text not null unique,                -- somente digitos, com DDI (ex.: 5519999999999)
  name text not null default '',
  email text not null default '',
  advbox_customer_id bigint,                 -- cliente ADVBOX que o testador esta "encarnando"
  advbox_customer_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Estado de conversa (simulador e WhatsApp)
create table if not exists bot_conversations (
  id bigint generated always as identity primary key,
  channel text not null unique,              -- 'sim:<uuid>' ou 'wa:<phone>'
  customer_id bigint,
  customer_name text not null default '',
  context jsonb not null default '{}'::jsonb, -- {awaiting, options[], selected_lawsuit_id, ...}
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bot_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint references bot_conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  text text not null default '',
  intent text,
  meta jsonb not null default '{}'::jsonb,   -- tokens, latencia, lawsuit_id, erro...
  created_at timestamptz not null default now()
);
create index if not exists idx_bot_messages_conv on bot_messages(conversation_id, created_at);

-- Novidades detectadas no ADVBOX (andamentos / tarefas) + estado de comunicacao
create table if not exists bot_sync_state (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('movement','task_created','task_completed')),
  item_key text not null,                    -- chave idempotente
  lawsuit_id bigint,
  process_number text,
  customer_name text,
  title text not null default '',            -- texto bruto do andamento/tarefa
  event_date date,
  payload jsonb not null default '{}'::jsonb,
  kommo_lead_id bigint,
  kommo_note_posted boolean not null default false,
  communicated boolean not null default false, -- ja foi comunicado ao cliente?
  communicated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, item_key)
);
create index if not exists idx_bot_sync_pending on bot_sync_state(communicated, created_at desc);
create index if not exists idx_bot_sync_lawsuit on bot_sync_state(lawsuit_id);

-- ============================================================
-- RLS — mesmo padrao atual do projeto (anon + authenticated).
-- ATENCAO: apertar quando SUPABASE_SERVICE_ROLE_KEY estiver no Netlify
-- (mesma pendencia das policies temp_anon_* do Asaas).
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['bot_config','bot_stage_templates','bot_task_templates','bot_glossary',
                           'bot_ai_cache','bot_intents','bot_testers','bot_conversations',
                           'bot_messages','bot_sync_state']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "bot_allow_all" on %I', t);
    execute format('create policy "bot_allow_all" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- ============================================================
-- SEEDS
-- ============================================================

-- Config padrao
insert into bot_config (key, value) values
  ('geral', jsonb_build_object(
    'saudacao', E'Olá, {{primeiro_nome}}! 👋 Aqui é o assistente virtual da CBC Advogados.',
    'nao_identificado', E'Não consegui localizar seu cadastro pelo seu número de telefone. Pode me informar o CPF do titular do contrato? (somente números)',
    'multi_processo', E'Encontrei {{qtd}} processos no seu nome. Sobre qual deles você quer saber?\n\n{{lista}}\n\nResponda com o número da opção (ex.: 1).',
    'sem_novidade', E'Não houve movimentação nova no seu processo desde {{data_ultimo_andamento}}. Fique tranquilo(a): nosso sistema verifica seu processo todos os dias, automaticamente, e nós te avisaremos assim que houver qualquer novidade. ✅',
    'fallback', E'Desculpe, não entendi. Você pode perguntar, por exemplo:\n1️⃣ Como está meu processo?\n2️⃣ Tenho alguma audiência marcada?\n3️⃣ Falar com meu advogado',
    'despedida', E'Qualquer dúvida é só chamar! A CBC Advogados agradece a confiança. 🤝'
  )),
  ('template_andamento', jsonb_build_object(
    'corpo', E'📋 *Processo {{processo}}* ({{tipo}})\n\n*Fase atual:* {{fase}}\n\n*Últimas movimentações:*\n{{timeline}}\n\n{{texto_fase}}\n\n{{em_andamento}}{{proximos_passos}}',
    'linha_timeline', E'• {{data}} — {{texto}}',
    'titulo_em_andamento', E'🛠 *O que estamos fazendo agora:*\n',
    'titulo_concluidas', E'✅ *O que já fizemos recentemente:*\n'
  )),
  ('kommo', jsonb_build_object(
    'bot_id', null,
    'field_id_contato', null,
    'field_id_lead', null,
    'entidade_preferida', 'lead',
    'ativo', false
  )),
  ('ia', jsonb_build_object(
    'ativa', false,
    'modelo', 'claude-opus-4-8',
    'instrucao', 'Traduza o andamento processual abaixo para linguagem simples e acolhedora, em 1 frase curta, sem juridiques, em portugues do Brasil. Nao invente informacoes. Responda APENAS com a frase traduzida.'
  )),
  ('monitor', jsonb_build_object(
    'tarefas_ignoradas', jsonb_build_array('alerta de tarefa excluida','publicacao tratada','comentario','verificar interno')
  ))
on conflict (key) do nothing;

-- Intencoes padrao
insert into bot_intents (intent_key, name, keywords, action, response_template, priority) values
  ('andamento', 'Andamento do processo',
    array['andamento','processo','novidade','noticia','atualizacao','atualizacoes','como esta','como anda','andou','mexeu','movimentacao','movimento','status','posicao','juiz','sentenca','decisao','resultado','ganhamos','ganhei','perdemos','demora','demorando','previsao','prazo'],
    'andamento', '', 10),
  ('audiencia', 'Audiência / agenda',
    array['audiencia','pericia','depoimento','testemunha','comparecer','data marcada','agendado','agendada','forum','quando vai ser'],
    'audiencia', '', 20),
  ('tarefas', 'O que o escritório está fazendo',
    array['o que estao fazendo','o que voces estao fazendo','trabalhando','providencia','providencias','andamento do escritorio','fizeram algo','fizeram alguma coisa'],
    'tarefas', '', 30),
  ('financeiro', 'Financeiro / honorários',
    array['boleto','pagamento','pagar','parcela','honorario','honorarios','pix','fatura','cobranca','valor','quanto devo','quanto falta'],
    'template', E'Sobre pagamentos e honorários, nossa equipe financeira pode te ajudar com todos os detalhes. Vou encaminhar sua mensagem para eles — você receberá retorno ainda hoje em horário comercial. 💰', 40),
  ('documento', 'Documentos',
    array['documento','documentos','contrato','procuracao','copia','enviar arquivo','mandar arquivo','comprovante'],
    'template', E'Para envio ou solicitação de documentos, basta enviá-los aqui mesmo nesta conversa que nossa equipe recebe automaticamente. Se precisar de uma cópia de algum documento, me diga qual e encaminharei o pedido à equipe. 📎', 50),
  ('humano', 'Falar com advogado',
    array['falar com advogado','falar com o advogado','meu advogado','minha advogada','falar com o doutor','falar com a doutora','falar com o dr','falar com alguem','atendente','humano','pessoa de verdade','ligar','telefone','reclamacao','reclamar','insatisfeito','absurdo','demora demais','ninguem responde','ninguem me responde'],
    'humano', E'Entendi! Já encaminhei sua solicitação para o advogado responsável pelo seu caso, que vai te responder o mais breve possível (em até 1 dia útil). Se for urgente, você também pode ligar para o escritório. 👨‍⚖️', 5)
on conflict (intent_key) do nothing;

-- Glossario inicial (de-para dos andamentos mais comuns)
insert into bot_glossary (term, translation, priority) values
  ('Conclusos para despacho', 'O processo está com o juiz para análise. Isso é um passo normal e positivo: significa que ele está na fila de decisões.', 10),
  ('Conclusos para decisão', 'O processo está nas mãos do juiz aguardando uma decisão.', 10),
  ('Conclusos para sentença', 'O processo está com o juiz para a sentença — a decisão principal do caso. É uma das etapas mais importantes!', 5),
  ('Concluso', 'O processo está com o juiz para análise.', 90),
  ('Distribuído', 'O processo foi registrado na Justiça e recebeu um juiz responsável. É o pontapé inicial!', 10),
  ('Juntada de petição', 'Um documento foi adicionado oficialmente ao processo.', 30),
  ('Juntada de AR', 'O comprovante de entrega de uma notificação foi anexado ao processo.', 30),
  ('Juntada', 'Um documento novo foi anexado ao processo.', 95),
  ('Citação', 'A outra parte foi oficialmente comunicada sobre o processo.', 20),
  ('Citado', 'A outra parte foi oficialmente comunicada sobre o processo.', 20),
  ('Intimação', 'A Justiça emitiu uma comunicação oficial no processo.', 40),
  ('Audiência designada', 'Foi marcada uma audiência no seu processo! Em breve entraremos em contato com todas as orientações.', 5),
  ('Audiência de conciliação', 'Foi agendada uma audiência de conciliação — uma tentativa de acordo entre as partes.', 10),
  ('Contestação', 'A outra parte apresentou a defesa dela. Isso é esperado e já estamos analisando os argumentos.', 15),
  ('Réplica', 'Apresentamos nossa resposta à defesa da outra parte.', 15),
  ('Sentença procedente', 'Excelente notícia: o juiz decidiu a favor! Vamos te explicar os próximos passos.', 1),
  ('Julgado procedente', 'Excelente notícia: o juiz decidiu a favor! Vamos te explicar os próximos passos.', 1),
  ('Sentença', 'O juiz proferiu a sentença — a decisão principal do caso. Nossa equipe já está analisando.', 8),
  ('Recurso', 'Há um recurso em andamento — o caso está sendo reavaliado por instância superior.', 25),
  ('Apelação', 'O caso subiu para o tribunal para ser reavaliado (fase de apelação).', 25),
  ('Embargos de declaração', 'Foi pedido um esclarecimento sobre a decisão do juiz. É um procedimento comum e rápido.', 25),
  ('Trânsito em julgado', 'O processo chegou ao fim definitivo: não cabe mais recurso. 🎉', 1),
  ('Transitado em julgado', 'O processo chegou ao fim definitivo: não cabe mais recurso. 🎉', 1),
  ('Baixa definitiva', 'O processo foi encerrado e arquivado definitivamente.', 10),
  ('Arquivado', 'O processo foi arquivado.', 60),
  ('Expedição de alvará', 'Ótima notícia: foi autorizada a liberação de valores no seu processo! 💰', 1),
  ('Alvará', 'Há liberação de valores em andamento no seu processo.', 15),
  ('Penhora', 'Foram bloqueados bens/valores da outra parte para garantir o pagamento.', 15),
  ('Bacenjud', 'A Justiça fez uma busca de valores nas contas da outra parte.', 20),
  ('Sisbajud', 'A Justiça fez uma busca de valores nas contas da outra parte.', 20),
  ('Cumprimento de sentença', 'Estamos na fase de execução: cobrando na prática o que foi decidido na sentença.', 10),
  ('Carga ao advogado', 'Nosso escritório retirou o processo para análise detalhada.', 40),
  ('Vista à parte', 'O processo está com uma das partes para manifestação.', 40),
  ('Despacho', 'O juiz deu um encaminhamento ao processo (despacho).', 80),
  ('Suspenso', 'O processo está temporariamente suspenso — assim que voltar a andar, te avisamos.', 30),
  ('Redistribuído', 'O processo mudou de vara ou de juiz responsável. Isso não prejudica o andamento.', 30),
  ('Ato ordinatório', 'O cartório fez um encaminhamento administrativo de rotina no processo.', 70),
  ('Publicado', 'Uma decisão ou ato do processo foi publicado oficialmente.', 80),
  ('Mandado', 'A Justiça emitiu uma ordem oficial (mandado) no processo.', 60),
  ('Perícia', 'O processo está em fase de perícia — análise técnica feita por especialista nomeado pelo juiz.', 15),
  ('Decorrido prazo', 'O prazo dado à outra parte terminou — o processo agora segue para a próxima etapa.', 25),
  ('Manifestação', 'Uma das partes apresentou um posicionamento no processo.', 60),
  ('Petição protocolada', 'Nossa equipe apresentou um documento oficial no processo.', 30)
on conflict do nothing;

-- ============================================================
-- VIEWS PARA BI (Power BI conecta via PostgreSQL nativo)
-- vw_bi_tarefas: 1 linha por tarefa com status pendente/atrasada/concluida
-- vw_bi_andamentos: andamentos historicos + incrementais
-- (aplicadas em 10/06/2026)
-- ============================================================
create or replace view vw_bi_tarefas as
with criadas as (
  select replace(item_key, 'task:', '') as tid, * from bot_sync_state where kind = 'task_created'
), concluidas as (
  select replace(item_key, 'taskdone:', '') as tid, * from bot_sync_state where kind = 'task_completed'
)
select
  coalesce(c.tid, d.tid)::bigint               as tarefa_id,
  coalesce(c.title, d.title)                   as tarefa,
  coalesce(c.process_number, d.process_number) as processo,
  coalesce(c.customer_name, d.customer_name)   as cliente,
  coalesce(c.lawsuit_id, d.lawsuit_id)         as processo_id_advbox,
  c.event_date                                 as data_criacao,
  case when c.payload->>'deadline' ~ '^\d{4}-\d{2}-\d{2}' then (c.payload->>'deadline')::date end as prazo,
  (select string_agg(x, ', ') from jsonb_array_elements_text(coalesce(c.payload->'users', '[]'::jsonb)) x) as responsaveis,
  d.event_date                                 as data_conclusao,
  (select string_agg(x, ', ') from jsonb_array_elements_text(coalesce(d.payload->'completed_by', '[]'::jsonb)) x) as concluida_por,
  case
    when d.tid is not null then 'concluida'
    when (case when c.payload->>'deadline' ~ '^\d{4}-\d{2}-\d{2}' then (c.payload->>'deadline')::date end) < current_date then 'atrasada'
    else 'pendente'
  end as status,
  case when d.tid is not null and c.payload->>'deadline' ~ '^\d{4}-\d{2}-\d{2}'
       then d.event_date - (c.payload->>'deadline')::date end as dias_vs_prazo,
  coalesce(c.created_at, d.created_at)         as detectado_em,
  coalesce((c.payload->>'oculto')::boolean, (d.payload->>'oculto')::boolean,
           (select tt.ocultar_cliente from bot_task_templates tt
              where upper(tt.task_name) = upper(coalesce(c.title, d.title)) limit 1),
           false) as oculta_do_cliente
from criadas c
full outer join concluidas d on d.tid = c.tid;

create or replace view vw_bi_andamentos as
select
  lawsuit_id as processo_id_advbox, process_number as processo, customer_name as cliente,
  event_date as data, title as andamento, payload->>'header' as tribunal,
  (payload->>'backfill')::boolean is true as veio_do_backfill, created_at as detectado_em
from bot_sync_state
where kind = 'movement';

-- Views de BI respeitam o RLS do consultante (fix advisor security_definer_view, 10/06)
alter view vw_bi_tarefas set (security_invoker = true);
alter view vw_bi_andamentos set (security_invoker = true);

-- ============================================================
-- PORTAL DO CLIENTE (versao teste, 10/06/2026)
-- Acesso por token na URL (/portal?t=...); base para o futuro login.
-- ============================================================
create table if not exists cliente_portal_tokens (
  token text primary key,
  advbox_customer_id bigint,
  nome text not null,
  cpf text,
  ativo boolean not null default true,
  acessos integer not null default 0,
  ultimo_acesso timestamptz,
  criado_em timestamptz not null default now()
);
alter table cliente_portal_tokens enable row level security;
drop policy if exists bot_allow_all on cliente_portal_tokens;
create policy bot_allow_all on cliente_portal_tokens for all using (true) with check (true);

-- Boletos do titular do token, sem abrir asaas_boletos (restrita a authenticated)
-- para a chave anon: security definer + match de CPF normalizado no banco.
create or replace function public.portal_boletos(p_token text)
returns setof public.asaas_boletos
language sql
security definer
set search_path = public
stable
as $$
  select b.*
  from public.asaas_boletos b
  join public.cliente_portal_tokens t
    on t.token = p_token and t.ativo
  where regexp_replace(coalesce(b.customer_cpf, ''), '\D', '', 'g')
      = regexp_replace(coalesce(t.cpf, ''), '\D', '', 'g')
    and regexp_replace(coalesce(t.cpf, ''), '\D', '', 'g') <> ''
  order by b.due_date;
$$;
revoke all on function public.portal_boletos(text) from public;
grant execute on function public.portal_boletos(text) to anon, authenticated;

-- ============================================================
-- ESPELHO ASAAS + BOT FINANCEIRO + MÉTRICAS (11/06/2026)
-- Migrations: asaas_mirror_rpcs_bot_extrato_metricas,
--             asaas_mirror_cache_e_reconciliacao
-- asaas_boletos/asaas_sync_state são restritas a authenticated e as
-- functions Netlify usam anon -> toda escrita/leitura passa por RPCs
-- security definer destravadas pelo segredo BOT_RPC_SECRET (env Netlify),
-- guardado em bot_secrets (RLS sem policies: invisível via API).
-- Funções: _bot_chave_ok, asaas_mirror_upsert, asaas_mirror_update,
--          asaas_mirror_state, asaas_mirror_cache, asaas_mirror_stale_open,
--          bot_extrato(p_chave, p_customer_id), bot_metricas(p_dias)
-- Intent nova: financeiro (boleto, pix, quanto devo...) action='financeiro'
-- DDL completa nas migrations do Supabase (list_migrations).

-- PORTAL v2 (11/06/2026): acordo da Prestação de Contas no portal.
-- RPC portal_acordo(p_token) security definer (migration portal_acordo_rpc):
-- valida o token, casa calculos.status='pendente' por nº de processo OU
-- cumprimento (dígitos, mín. 13) contra bi_processos do titular, fallback CPF
-- (dados->c1CPF/c2CPF). calculos segue restrita a authenticated.
-- Gestão de links: aba "Portal do Cliente" (permissão tabs.portal) +
-- function portal-admin.mjs (tokens em cliente_portal_tokens).
