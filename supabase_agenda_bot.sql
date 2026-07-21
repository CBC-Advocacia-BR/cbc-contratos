-- Migração agenda_bot_v1 — bot Ana (spec 2026-07-21). Aditiva; idempotente.
alter table agenda_videochamadas add column if not exists lead_id bigint;
alter table agenda_videochamadas add column if not exists telefone text;
-- origem ('ana'/'manual' = quem criou o agendamento) difere de source ('live'/'backfill' = fonte do sync).
alter table agenda_videochamadas add column if not exists origem text not null default 'manual';
alter table agenda_videochamadas add column if not exists lembrete_1h_em timestamptz;
alter table agenda_videochamadas add column if not exists lembrete_t0_em timestamptz;
alter table agenda_videochamadas add column if not exists noshow_msg_em timestamptz;
create index if not exists idx_agenda_vc_origem_sched on agenda_videochamadas(origem, scheduled_at);

-- Config da Ana (1 key; painel edita direto — bot_config tem policy bot_allow_all)
insert into bot_config (key, value) values ('agenda_bot', jsonb_build_object(
  'ativo', false,
  'modo_teste', true,
  'llm', jsonb_build_object('modelo','claude-sonnet-5','max_tokens',700,'confianca_minima',0.6),
  'stt', jsonb_build_object('provedor','groq','modelo','whisper-large-v3-turbo','max_minutos',3),
  'gatilhos', jsonb_build_array(
     jsonb_build_object('pipeline_id',13916619,'status_ids',jsonb_build_array(107389179)),
     jsonb_build_object('pipeline_id',13760367,'status_ids','todas')
  ),
  'kommo', jsonb_build_object('campo_ana_id',null,'salesbot_id',null,'salesbot_template_id',null,
     'etapa_agendado', jsonb_build_object('pipeline_id',13760367,'status_id',106167799),
     'etapa_perdido',  jsonb_build_object('pipeline_id',13788547,'status_id',106478007),
     'campo_investimento_id',2436424,'campo_preferencia_id',2436418),
  'vendedoras', jsonb_build_array(
     jsonb_build_object('email','marianamaciel@advocaciacbc.com','nome','Mariana','user_id',15297447,'peso',60,'ativa',true),
     jsonb_build_object('email','beatriz@advocaciacbc.com','nome','Beatriz','user_id',15297507,'peso',20,'ativa',true),
     jsonb_build_object('email','emerson@advocaciacbc.com','nome','Emerson','user_id',15562427,'peso',20,'ativa',true)
  ),
  'regras', jsonb_build_object('dias',jsonb_build_array(1,2,3,4,5),'hora_inicio','08:00','hora_fim','17:00',
     'granularidade_min',30,'antecedencia_min_minutos',60,'horizonte_dias_uteis',5,'almoco',null,
     'slots_por_oferta',2,'max_recusas',2,'max_reagendamentos',2,'duracao_evento_min',30,
     'silencio_humano_horas',24,'janela_margem_min',60,'feriados',jsonb_build_array()),
  'mensagens', jsonb_build_object(
     'abertura', E'Olá! Sou a *Ana, assistente do escritório Conforto, Bergonsi e Cavalari*, escritório especializado em cancelamento de contratos. Estou aqui para te ajudar 😊\nMe conta: *o que vem acontecendo com a sua cota* que te fez buscar o cancelamento?',
     'qual_resort', 'Entendi! Qual é o *resort/empreendimento* da sua cota?',
     'qual_situacao', 'Você *ainda está pagando* ou *já quitou* a cota?',
     'qual_valor', 'Quanto *aproximadamente já foi pago*? Pode ser um valor estimado.',
     'pitch_oferta', E'Nesse caso você consegue iniciar o *processo de distrato* para devolver a cota ao resort e *restituir o que já foi pago, corrigido monetariamente*. 📍 O próximo passo é uma *videochamada* com nossa equipe: leva ~10 minutos, *não tem custo nenhum* e explicamos como funciona o processo, encargos e etc.\nTenho *{{slot1}}* ou *{{slot2}}* disponíveis. Qual prefere? (ou me diga outro horário)',
     'oferta_slots', 'Consigo te encaixar em *{{slot1}}* ou *{{slot2}}*. Qual prefere?',
     'confirmado', E'*Ok, agendado {{dia}} às {{hora}}!* Vamos te mandar uma mensagem antes com o link da videochamada. Até lá! 😊',
     'slot_ocupado', 'Esse horário acabou de ser preenchido 😅 Consigo *{{slot1}}* ou *{{slot2}}*. Qual prefere?',
     'lembrete_1h', 'Passando para lembrar da nossa videochamada hoje às {{hora}} 😊 Tudo certo?',
     'lembrete_t0', 'Temos um atendimento agendado agora. Segue o link do Google Meet para videochamada: {{link}}',
     'noshow', E'Não conseguimos falar hoje 😕 Podemos *reagendar*? Tenho *{{slot1}}* ou *{{slot2}}*.',
     'preco', E'Não consigo te passar um preço, pois trabalhamos de uma forma diferente.\n👉 Realizamos a videochamada, entendemos a sua situação com o resort e aí sim, vemos a melhor forma de seguir com a ação judicial, tanto em valores quanto em andamentos.\nTenho *{{slot1}}* ou *{{slot2}}* disponíveis 😊',
     'pede_texto', 'Consegue me escrever em poucas palavras? Assim já te encaminho mais rápido 😊',
     'handoff', 'Perfeito! Já estou chamando alguém da equipe para falar com você por aqui 😊',
     'impasse', 'Sem problema! Vou pedir para a equipe combinar um horário com você por aqui, tudo bem?'
  )
)) on conflict (key) do nothing;

-- View p/ o painel (padrão vw_funil_videochamadas; equipe autenticada vê a agenda da Ana)
create or replace view vw_agenda_painel as
  select event_id, vendedora_email, cliente_nome, status, scheduled_at,
         lead_id, telefone, origem, lembrete_1h_em, lembrete_t0_em, noshow_msg_em
  from agenda_videochamadas;
grant select on vw_agenda_painel to authenticated;
revoke all on vw_agenda_painel from anon, public;

-- Métricas do funil da Ana (contagens; conversas via bot_conversations channel 'agenda:%')
create or replace function agenda_bot_metricas(p_de date, p_ate date)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'conversas_iniciadas', (select count(*) from bot_conversations where channel like 'agenda:%'
        and created_at >= p_de and created_at < p_ate + 1),
    'qualificadas', (select count(*) from bot_conversations where channel like 'agenda:%'
        and created_at >= p_de and created_at < p_ate + 1
        and coalesce(context->'dados'->>'situacao','') <> ''),
    'oferta_feita', (select count(*) from bot_conversations where channel like 'agenda:%'
        and created_at >= p_de and created_at < p_ate + 1
        and context->>'etapa' in ('oferta','negociacao','confirmado','pos_noshow','encerrada')),
    'agendadas', (select count(*) from agenda_videochamadas where origem='ana'
        and updated_at >= p_de and updated_at < p_ate + 1),
    'realizadas', (select count(*) from agenda_videochamadas where origem='ana'
        and status in ('realizada','fechou') and scheduled_at >= p_de and scheduled_at < p_ate + 1),
    'no_show', (select count(*) from agenda_videochamadas where origem='ana'
        and status='no_show' and scheduled_at >= p_de and scheduled_at < p_ate + 1),
    'fechou', (select count(*) from agenda_videochamadas where origem='ana'
        and status='fechou' and scheduled_at >= p_de and scheduled_at < p_ate + 1),
    'handoffs', (select count(*) from bot_conversations where channel like 'agenda:%'
        and created_at >= p_de and created_at < p_ate + 1 and context->>'etapa'='handoff'),
    'por_vendedora', (select coalesce(jsonb_object_agg(vendedora_email, n), '{}'::jsonb) from (
        select vendedora_email, count(*) n from agenda_videochamadas
        where origem='ana' and scheduled_at >= p_de and scheduled_at < p_ate + 1
        group by vendedora_email) t),
    'tempo_resposta_med_seg', (select coalesce(percentile_cont(0.5) within group (order by extract(epoch from (m_out.created_at - m_in.created_at))),0)
        from bot_messages m_in join bot_messages m_out
          on m_out.conversation_id = m_in.conversation_id and m_out.direction='out'
         and m_out.id = (select min(id) from bot_messages x where x.conversation_id=m_in.conversation_id and x.direction='out' and x.id > m_in.id)
        join bot_conversations c on c.id = m_in.conversation_id
        where c.channel like 'agenda:%' and m_in.direction='in'
          and m_in.created_at >= p_de and m_in.created_at < p_ate + 1)
  );
$$;
grant execute on function agenda_bot_metricas(date, date) to authenticated;
revoke all on function agenda_bot_metricas(date, date) from anon, public;

-- Ajuste pré-voo: agenda_videochamadas_upsert fazia insert/upsert coluna a coluna e não
-- propagava lead_id/telefone/origem (confirmado via pg_proc.prosrc antes de aplicar esta
-- migração) — sem este ajuste, qualquer sync existente (ex.: calendar sync) que chame esta
-- RPC continuaria gravando linhas sem essas colunas, e um upsert subsequente sem esses
-- campos reverteria origem='ana' para 'manual' (quebrando agenda_bot_metricas). Assinatura
-- (p_chave text, p_rows jsonb) e o mecanismo de validação da chave (_bot_chave_ok) preservados
-- verbatim; demais 9 colunas originais mantidas com o mesmo comportamento (excluded.col direto).
create or replace function agenda_videochamadas_upsert(p_chave text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  insert into agenda_videochamadas
    (event_id, vendedora_email, cliente_email, cliente_nome, status, color_id, scheduled_at, tem_meet, raw,
     lead_id, telefone, origem, updated_at)
  select x.event_id, x.vendedora_email, x.cliente_email, x.cliente_nome, x.status, x.color_id,
         nullif(x.scheduled_at,'')::timestamptz, coalesce(x.tem_meet,false), x.raw,
         x.lead_id, x.telefone, coalesce(x.origem,'manual'), now()
  from jsonb_to_recordset(p_rows) as x(event_id text, vendedora_email text, cliente_email text,
         cliente_nome text, status text, color_id text, scheduled_at text, tem_meet boolean, raw jsonb,
         lead_id bigint, telefone text, origem text)
  on conflict (event_id) do update set
    vendedora_email=excluded.vendedora_email, cliente_email=excluded.cliente_email,
    cliente_nome=excluded.cliente_nome, status=excluded.status, color_id=excluded.color_id,
    scheduled_at=excluded.scheduled_at, tem_meet=excluded.tem_meet, raw=excluded.raw,
    lead_id=coalesce(excluded.lead_id, agenda_videochamadas.lead_id),
    telefone=coalesce(excluded.telefone, agenda_videochamadas.telefone),
    origem=coalesce(excluded.origem, agenda_videochamadas.origem),
    updated_at=now();
  get diagnostics n = row_count;
  return n;
end
$$;

-- agenda_bot_v1_3: CRITICAL sweep×férias — sweep escopado por vendedoras (camada 2 de defesa;
-- camada 1 = resolverAgendas em agenda-videochamadas-sync.mjs, que resolve a lista de agendas
-- a consultar SEM filtrar por `ativa`, pois `ativa` governa slots, não o espelho). Sem esta
-- camada 2, qualquer motivo que reduzisse a lista de agendas consultadas numa rodada (bug,
-- config malformada, falha parcial) faria o sweep abaixo apagar (status='excluida') TODOS os
-- atendimentos da janela cujo event_id não veio nesta rodada — inclusive de vendedoras que nem
-- deveriam ter sido tocadas, não só as que ficaram de fora por engano.
--
-- Corpo ATUAL de produção capturado em 21/07 via
-- `select pg_get_functiondef(oid) from pg_proc where proname='agenda_videochamadas_sweep'`
-- (esta função não existia em NENHUM .sql do repo até este append — reprodutibilidade).
-- Validação `_bot_chave_ok` e toda a lógica original preservadas verbatim; único acréscimo é o
-- parâmetro `p_vendedoras` (default null = comportamento antigo, sem filtro) e o `and` extra no
-- where. `create or replace` exige a MESMA assinatura da função existente; como `p_vendedoras`
-- entra com DEFAULT, a assinatura é NOVA (overload de 5 args) e o Postgres a trataria como uma
-- função distinta da de 4 args — convivendo as duas, uma chamada nomeando só os 4 args originais
-- ficaria ambígua entre "a de 4 args" e "a de 5 args com o 5º no default". Por isso a de 4 args é
-- removida explicitamente antes do create.
drop function if exists agenda_videochamadas_sweep(text, timestamptz, timestamptz, text[]);

create or replace function agenda_videochamadas_sweep(
  p_chave text, p_win_ini timestamptz, p_win_fim timestamptz, p_event_ids text[],
  p_vendedoras text[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_event_ids is null or array_length(p_event_ids, 1) is null then return 0; end if;
  update agenda_videochamadas v
     set status = 'excluida', updated_at = now()
   where v.source = 'live'
     and v.scheduled_at >= p_win_ini
     and v.scheduled_at <= p_win_fim
     and v.status <> 'excluida'
     and not (v.event_id = any(p_event_ids))
     and (p_vendedoras is null or v.vendedora_email = any(p_vendedoras));
  get diagnostics n = row_count;
  return n;
end
$$;

-- agenda_bot_v1_4: RPCs do cron de lembretes/no-show (Task 9, agenda-bot-cron.mjs).
-- Mesmo padrao de todas as RPCs deste arquivo: security definer + validacao _bot_chave_ok,
-- sem grants extras (default PUBLIC execute — mesmo tratamento de agenda_videochamadas_upsert/
-- sweep acima), chamadas pelo cron com a anon key + BOT_RPC_SECRET.

-- Videochamadas da Ana ainda 'agendada' na janela de atuacao do cron (roda a cada 5min):
-- T-30min a T+75min do horario marcado — cobre os 3 gatilhos (lembrete 1h, link T0, no-show
-- T+10..T+30) com folga para eventuais atrasos/skips de execucao do cron.
create or replace function agenda_bot_pendencias(p_chave text)
returns setof agenda_videochamadas
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query select * from agenda_videochamadas
    where origem = 'ana' and status = 'agendada'
      and scheduled_at between now() - interval '30 minutes' and now() + interval '75 minutes';
end
$$;

-- Marca (= now()) o timestamp de um lembrete/no-show ja disparado, p/ o cron nao repetir o
-- mesmo envio na proxima rodada. p_campo validado por whitelist EXPLICITA e setado por
-- IF/ELSIF explicito (uma coluna por vez) — NUNCA concatenado em SQL dinamico, o que evitaria
-- injecao via nome de coluna mas trocaria um risco conhecido/controlado por superficie nova.
create or replace function agenda_bot_marcar(p_chave text, p_event_id text, p_campo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  if p_campo not in ('lembrete_1h_em', 'lembrete_t0_em', 'noshow_msg_em') then
    raise exception 'campo invalido: %', p_campo;
  end if;
  if p_campo = 'lembrete_1h_em' then
    update agenda_videochamadas set lembrete_1h_em = now() where event_id = p_event_id;
  elsif p_campo = 'lembrete_t0_em' then
    update agenda_videochamadas set lembrete_t0_em = now() where event_id = p_event_id;
  elsif p_campo = 'noshow_msg_em' then
    update agenda_videochamadas set noshow_msg_em = now() where event_id = p_event_id;
  end if;
end
$$;
