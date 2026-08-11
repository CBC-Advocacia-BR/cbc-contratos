-- Aba SDR, etapa 1 (11/08/2026): estado do lead + view "sem resposta" sobre o
-- espelho REAL de conversas do Kommo.
--
-- CORRECAO 11/08/2026: a tabela public.sdr_mensagens criada nesta etapa (e a
-- view vw_sdr_sem_resposta que lia dela) foram REMOVIDAS. Descobriu-se que o
-- espelho de conversas do Kommo ja existe em producao, no schema
-- `atendimento` (conversas/mensagens/kommo_talks/contatos), alimentado de 10
-- em 10 minutos pelo projeto `kommo-conversas-sync`. sdr_mensagens nunca
-- recebeu uma linha (o codigo que a alimentaria via webhook foi revertido
-- antes de ir pra producao) e foi apagada junto com seus indices. A migracao
-- que fez essa correcao foi `sdr_fase1_view_atendimento`.
--
-- CORRECAO 11/08/2026 (revisao pos-Task 6): a coluna usada pelo frontend para
-- paginar vw_sdr_sem_resposta era lead_id, e um comentario afirmava que ela
-- e unica. Nao e: 3 das 930 linhas tem lead_id nulo (nem toda conversa tem
-- lead casado no Kommo). client/src/utils/supabasePaged.js exige ORDER BY
-- numa coluna UNICA, senao pagina repete/pula linha ao passar de 1000 (hoje
-- nao estoura, mas a garantia estava errada). A view ganhou a coluna
-- conversa_id (id de atendimento.conversas, que ja e a chave do DISTINCT ON
-- da CTE "ultima" e portanto unica e sem nulo no resultado final) e o
-- frontend passou a ordenar por ela. Migracao: `sdr_view_conversa_id`.

create table if not exists sdr_lead_estado (
  lead_id        text primary key,
  resort         text,
  situacao_cota  text check (situacao_cota in ('pagando','quitada')),
  valor_pago     numeric,
  titular        text,
  quente         boolean not null default false,
  quente_por     text,
  quente_em      timestamptz,
  estado         text not null default 'novo',
  motivo_descarte text,
  descartado_por text,
  descartado_em  timestamptz,
  dono           text,
  atualizado_em  timestamptz not null default now()
);

create table if not exists sdr_config (
  id             int primary key default 1 check (id = 1),
  grade_inicio   time not null default '08:00',
  grade_fim      time not null default '17:00',
  grade_dias     int[] not null default '{1,2,3,4,5}',
  sla_meta_min   int not null default 30,
  atualizado_por text,
  atualizado_em  timestamptz not null default now()
);
insert into sdr_config (id) values (1) on conflict (id) do nothing;

-- Uma linha por conversa do Kommo cuja ULTIMA mensagem foi do cliente.
-- Fonte real: atendimento.mensagens/conversas/kommo_talks/contatos (schema de
-- outro app, `kommo-conversas-sync` - so leitura, nunca mexer nele).
--
-- A ultima mensagem sai de atendimento.mensagens, filtrando so o que veio do
-- Kommo (kommo_message_id is not null) para nao misturar o historico morto
-- do ChatGuru (desligado 09/06/2026). NAO filtramos atendimento.conversas
-- por fonte = 'kommo': a maior parte das conversas com mensagem do Kommo tem
-- conversas.fonte = 'chatguru' (comecaram no ChatGuru e continuaram no
-- Kommo depois da migracao) - filtrar por fonte descartaria a maioria das
-- conversas certas (~87% no levantamento de 11/08/2026: 930 conversas com
-- ultima mensagem do cliente contra so 290 se filtrasse por fonte).
--
-- O lead do Kommo vem de atendimento.kommo_talks (chat_id = conversas.
-- kommo_chat_id, entity_type = 'lead'). Essa tabela tem varias linhas
-- repetidas por chat_id (ate 87 no mesmo chat, quase sempre com o mesmo
-- entity_id) - por isso o DISTINCT ON pegando a mais recente por chat_id,
-- senao a conversa apareceria duplicada na view.
--
-- Sem security_invoker (padrao do Postgres, igual vw_sdr_agenda_dia logo
-- abaixo): a view roda com o dono (postgres) e enxerga atendimento.* sem
-- depender da RLS daquele schema; o acesso de quem usa o app e controlado
-- pelo grant select na propria view, so para authenticated.
--
-- conversa_id vai no FIM do select de proposito: CREATE OR REPLACE VIEW nao
-- deixa mudar nome/posicao de coluna existente, so acrescentar depois das
-- que ja existem (Postgres 42P16 se tentar na frente).
create or replace view public.vw_sdr_sem_resposta as
with ultima as (
  select distinct on (m.conversa_id)
    m.conversa_id,
    m.autor,
    m.corpo,
    m.tipo,
    m.enviada_em
  from atendimento.mensagens m
  where m.kommo_message_id is not null
  order by m.conversa_id, m.enviada_em desc
),
talk_lead as (
  select distinct on (kt.chat_id)
    kt.chat_id,
    kt.entity_id as lead_id,
    kt.contact_id
  from atendimento.kommo_talks kt
  where kt.entity_type = 'lead'
  order by kt.chat_id, kt.talk_updated_at desc nulls last, kt.talk_id desc
)
select
  tl.lead_id::text as lead_id,
  tl.contact_id::text as contact_id,
  u.corpo as ultima_mensagem,
  u.tipo as tipo,
  u.enviada_em as ultima_em,
  (extract(epoch from (now() - u.enviada_em)) / 60::numeric) as min_sem_resposta,
  (now() - u.enviada_em) < interval '24 hours' as janela_aberta,
  ct.nome as nome,
  ct.whatsapp_numero as telefone,
  e.resort,
  e.situacao_cota,
  e.valor_pago,
  e.quente,
  e.estado,
  u.conversa_id as conversa_id
from ultima u
join atendimento.conversas c on c.id = u.conversa_id
left join talk_lead tl on tl.chat_id = c.kommo_chat_id
left join atendimento.contatos ct on ct.id = c.contato_id
left join public.sdr_lead_estado e on e.lead_id = tl.lead_id::text
where u.autor = 'cliente'
  and coalesce(e.estado, 'novo') <> 'descartado';

comment on view public.vw_sdr_sem_resposta is
  'SDR fase 1: uma linha por conversa do Kommo (atendimento.mensagens/conversas/kommo_talks/contatos) cuja ultima mensagem foi do cliente. conversa_id (migracao sdr_view_conversa_id, 11/08/2026) e a chave unica real para paginar - lead_id pode ser nulo.';

grant select on public.vw_sdr_sem_resposta to authenticated;

-- A tabela agenda_videochamadas esta com RLS LIGADA e ZERO policies: quem esta logado
-- le zero linhas dela. As telas atuais so a enxergam por views que rodam com o dono do
-- banco (padrao ja usado em 19 views deste projeto). Esta view segue o mesmo caminho e
-- expoe SO o que a aba precisa: nada do payload cru do Google.
create or replace view vw_sdr_agenda_dia as
select a.event_id, a.scheduled_at, a.vendedora_email, a.cliente_nome, a.telefone,
       a.status, a.meet_status, a.lead_id, a.kommo_match
  from agenda_videochamadas a
 where coalesce(a.status,'') <> 'excluida';
grant select on vw_sdr_agenda_dia to authenticated;

alter table sdr_lead_estado enable row level security;
alter table sdr_config      enable row level security;

create policy sdr_estado_all  on sdr_lead_estado for all    to authenticated using (true) with check (true);
create policy sdr_config_read on sdr_config      for select to authenticated using (true);
create policy sdr_config_write on sdr_config     for update to authenticated using (true) with check (true);

-- ============================================================================
-- Etapa 2 (11/08/2026): historico de conversa para a gaveta da aba.
-- As mensagens vivem em atendimento.mensagens (687 mil linhas, espelho mantido pelo
-- projeto kommo-conversas-sync) e o PostgREST so expoe o schema public: sem esta view
-- a aba nao alcanca o historico. Sem security_invoker de proposito, como a view da
-- agenda: o schema atendimento e de outro app e nao tem policy para authenticated.
-- Migracao: sdr_view_mensagens
-- ============================================================================
create or replace view public.vw_sdr_mensagens as
select m.id, m.conversa_id, m.autor, m.autor_nome,
       m.corpo as texto, m.tipo, m.midia_label, m.enviada_em, m.kommo_message_id
  from atendimento.mensagens m;

grant select on public.vw_sdr_mensagens to authenticated;

comment on view public.vw_sdr_mensagens is
  'Historico de conversa para a aba SDR. Filtrar SEMPRE por conversa_id: a tabela de origem tem 687 mil linhas.';

-- ============================================================================
-- Etapa 5 (11/08/2026): funil do Kommo em kanban (so leitura).
-- Fonte: kommo_lead_status (16.575 leads com a etapa atual) + kommo_pipelines (129 etapas).
-- ATENCAO: kommo_leads.pipeline_id esta NULO nas 19 mil linhas — quem confiar nele ve um
-- funil vazio. A fonte certa e kommo_lead_status, mantida pelo kommo-conversas-sync.
-- Migracao: sdr_views_funil
-- ============================================================================
create or replace view public.vw_sdr_funil_etapas as
select p.pipeline_id, p.pipeline_nome, p.status_id, p.status_nome, p.ordem,
       count(s.lead_id) as leads
  from kommo_pipelines p
  left join kommo_lead_status s
         on s.pipeline_id = p.pipeline_id and s.status_id = p.status_id
 group by p.pipeline_id, p.pipeline_nome, p.status_id, p.status_nome, p.ordem;

create or replace view public.vw_sdr_funil_cards as
select s.lead_id::text as lead_id, s.pipeline_id, s.status_id, s.lead_updated_at,
       k.nome, k.telefone, e.resort, e.quente,
       row_number() over (partition by s.pipeline_id, s.status_id
                          order by s.lead_updated_at desc nulls last, s.lead_id desc) as posicao
  from kommo_lead_status s
  left join kommo_leads k on k.lead_id = s.lead_id::text
  left join sdr_lead_estado e on e.lead_id = s.lead_id::text
 where coalesce(e.estado, 'novo') <> 'descartado';

grant select on public.vw_sdr_funil_etapas to authenticated;
grant select on public.vw_sdr_funil_cards  to authenticated;

-- ============================================================================
-- Etapa 7 (11/08/2026): parametros de operacao e pesos da pontuacao.
-- A formula do lead score esta EM AVALIACAO (decisao do Paulo): por isso os pesos moram
-- no banco, editaveis, e a tela recalcula a fila sem deploy. O historico de faltas NAO
-- entra na nota, tambem por decisao dele.
-- Migracao: sdr_config_pontuacao
-- ============================================================================
alter table sdr_config
  add column if not exists peso_valor        int     not null default 40,
  add column if not exists peso_resort       int     not null default 35,
  add column if not exists peso_quitado      int     not null default 25,
  add column if not exists piso_valor        numeric not null default 40000,
  add column if not exists resorts_prioritarios text[] not null default
    array['Hot Beach You','Hard Rock','Barretos Country','Ondas Praia','Solar das Águas'],
  add column if not exists limiar_topo       int     not null default 70,
  add column if not exists teto_disparo_dia  int     not null default 300,
  add column if not exists dias_reinclusao   int     not null default 30,
  add column if not exists max_remarcacoes   int     not null default 2,
  add column if not exists segura_horario_ate time   not null default '17:00';

-- ============================================================================
-- Etapa 2, parte de envio (11/08/2026): mandar texto pela aba.
-- Reusa o que ja funciona em producao para cobranca e assinatura: grava o texto num
-- campo do lead e roda um Salesbot de um bloco que ecoa o campo. Conferido no Kommo em
-- 11/08: bot "CBC - Ana" (103102) e campo "CBC Ana" (2444884) ja existem e fazem isso.
-- ZERO campo novo e ZERO bot novo, que era a preocupacao do Paulo.
-- RISCO: se a Ana (desligada) for ligada, os dois escrevem no MESMO campo e um pode
-- sobrescrever o outro antes do bot rodar. Se acontecer, criar campo proprio do SDR.
-- Migracao: sdr_envios
-- ============================================================================
alter table sdr_config
  add column if not exists kommo_campo_msg_id bigint not null default 2444884,
  add column if not exists kommo_bot_msg_id   bigint not null default 103102;

create table if not exists sdr_envios (
  id bigserial primary key, lead_id text not null, conversa_id uuid, texto text not null,
  caminho text not null default 'campo+salesbot', enviado_por text,
  resultado text not null default 'enfileirado', erro text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_sdr_envios_lead on sdr_envios (lead_id, criado_em desc);
alter table sdr_envios enable row level security;
create policy sdr_envios_read on sdr_envios for select to authenticated using (true);
