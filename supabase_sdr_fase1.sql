-- Aba SDR, etapa 1 (11/08/2026): espelho de mensagens do Kommo + estado do lead.
-- PII: sdr_mensagens guarda texto de conversa. RLS fecha para anon.

create table if not exists sdr_mensagens (
  id             bigserial primary key,
  kommo_msg_id   text unique,              -- idempotencia do webhook
  lead_id        text,
  contact_id     text,
  direcao        text not null check (direcao in ('in','out')),
  autor_id       bigint,                   -- created_by do Kommo; 0/null = robo
  autor_nome     text,
  tipo           text default 'texto',     -- texto|audio|imagem|documento|outro
  texto          text,
  criado_em      timestamptz not null,
  gravado_em     timestamptz not null default now()
);
create index if not exists idx_sdr_msg_lead_tempo on sdr_mensagens (lead_id, criado_em desc);
create index if not exists idx_sdr_msg_contato_tempo on sdr_mensagens (contact_id, criado_em desc);

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

-- Uma linha por conversa cuja ULTIMA mensagem foi do cliente.
create or replace view vw_sdr_sem_resposta
with (security_invoker = true) as
with ultima as (
  select distinct on (lead_id)
         lead_id, contact_id, direcao, texto, tipo, criado_em
    from sdr_mensagens
   where lead_id is not null
   order by lead_id, criado_em desc
)
select u.lead_id, u.contact_id, u.texto as ultima_mensagem, u.tipo, u.criado_em as ultima_em,
       extract(epoch from (now() - u.criado_em))/60 as min_sem_resposta,
       (now() - u.criado_em) < interval '24 hours' as janela_aberta,
       k.nome, k.telefone, e.resort, e.situacao_cota, e.valor_pago, e.quente, e.estado
  from ultima u
  left join kommo_leads k on k.lead_id = u.lead_id
  left join sdr_lead_estado e on e.lead_id = u.lead_id
 where u.direcao = 'in'
   and coalesce(e.estado,'novo') <> 'descartado';

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

alter table sdr_mensagens   enable row level security;
alter table sdr_lead_estado enable row level security;
alter table sdr_config      enable row level security;

create policy sdr_msg_read    on sdr_mensagens   for select to authenticated using (true);
create policy sdr_estado_all  on sdr_lead_estado for all    to authenticated using (true) with check (true);
create policy sdr_config_read on sdr_config      for select to authenticated using (true);
create policy sdr_config_write on sdr_config     for update to authenticated using (true) with check (true);
