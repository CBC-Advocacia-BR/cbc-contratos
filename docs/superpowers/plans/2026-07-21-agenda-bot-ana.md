# Bot Ana + Aba "Agendamento Videochamada" — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot "Ana" que atende leads no WhatsApp via Kommo (webhook → worker), qualifica com IA (transcrição + interpretação), agenda videochamadas com Meet nas agendas Google das vendedoras, lembra/reagenda (templates WABA fora da janela), tudo administrado numa aba nova do CBC Contratos.

**Spec:** `docs/superpowers/specs/2026-07-21-agendamento-videochamada-bot-ana-design.md` (aprovada 21/07). Ler ANTES de qualquer task.

**Architecture:** Motor híbrido — máquina de estados PURA decide o que fazer e fala SEMPRE por templates de `bot_config.agenda_bot`; LLM (Claude via fetch, padrão botEngine) só interpreta a mensagem do lead em JSON estrito; STT (Groq/OpenAI Whisper) transcreve áudios. Reusa: webhook→worker background, campo custom+`bots/run` (carteiro), fila `kommo_queue`, `janelaAberta`, `googleAgenda.mjs` (ganha escrita), `bot_conversations/bot_messages` (channel `agenda:<fone>`), `bot_testers`, `logAdvbox` (origem `agenda`).

**Tech Stack:** Netlify Functions (.mjs, ESM), Supabase (anon key via `_lib/botDb.mjs`, RLS `bot_allow_all` nas `bot_*`; `agenda_videochamadas` fechada → views/RPCs), React + vitest no `client/`, APIs: Kommo v4, Google Calendar v3 (OAuth refresh token `GOOGLE_OAUTH_*`), Anthropic Messages, Groq/OpenAI audio.

## Global Constraints

- **REGRA #1 do workspace**: NUNCA `rm`/sobrescrever sem backup. Antes de modificar arquivo existente: `cp <arquivo> backups/20260721_agenda_bot/<arquivo>` (criar a pasta na 1ª vez).
- **Deploy SÓ via `client/deploy.sh`** (incidente 02/07). Nenhuma task deste plano faz deploy até a Task 15.
- Repo pode estar sujo (outra sessão). **`git add` SEMPRE com caminhos explícitos** — nunca `git add -A`/`.`.
- Branch de trabalho: `feat/agenda-bot-ana` criada a partir do branch atual (`git checkout -b feat/agenda-bot-ana`) na Task 1, passo 1. Commits frequentes nela.
- Testes: `cd client && npm test` (vitest). Testes de libs puras em `client/src/utils/__tests__/*.test.js` importando de `../../../netlify/functions/_lib/...` (padrão `advboxMaps.test.js`).
- Functions em `client/netlify/functions/`, ESM `.mjs`, sem dependências novas no `package.json` (Anthropic/Groq/Google via `fetch`, padrão da casa).
- IDs Kommo fixos: funil Venda `13760367`; etapa "Vídeo Chamada" `106167799`; funil Contato Perdido `13788547`, etapa "Cemitério antes da videochamada" `106478007`; funil "Teste Paulo" `13916619` (etapa de entrada `107389179`); campos lead: "Investimento na cota" `2436424`, "Preferência de Horário" `2436418`. Users: Mariana Beraldo `15297447`, Beatriz `15297507`, Emerson `15562427`.
- Agendas Google: `marianamaciel@advocaciacbc.com`, `beatriz@advocaciacbc.com`, `emerson@advocaciacbc.com`. Fuso: `America/Sao_Paulo`.
- Envs novas (Netlify, contexto all): `AGENDA_WEBHOOK_SECRET` (gerar forte), `ANTHROPIC_API_KEY` (interpretação), `GROQ_API_KEY` e/ou `OPENAI_API_KEY` (transcrição). Existentes reusadas: `KOMMO_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`, `BOT_RPC_SECRET`, `VITE_SUPABASE_URL/ANON_KEY`.
- Mensagens default da Ana: usar VERBATIM os textos da spec (§Fluxo conversacional e §Janela de 24h). Persona: "Sou a **Ana**, assistente do escritório Conforto, Bergonsi e Cavalari, escritório especializado em cancelamento de contratos."
- LLM default: `claude-sonnet-5` (trocável em config). Nunca gerar fala livre do LLM para o lead.

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `supabase_agenda_bot.sql` (novo, raiz do projeto) | migração `agenda_bot_v1`: colunas em `agenda_videochamadas`, seeds `bot_config`, view painel, RPCs |
| `client/netlify/functions/_lib/agendaSlots.mjs` (novo) | PURO: slots livres, sorteio ponderado, slot mais próximo, formatação pt-BR |
| `client/netlify/functions/_lib/agendaEngine.mjs` (novo) | PURO: máquina de estados + render de templates `{{var}}` |
| `client/netlify/functions/_lib/agendaInterprete.mjs` (novo) | IA: prompt/validação (puros) + `interpretar()` (fetch Anthropic) + `transcrever()` (fetch Groq/OpenAI) |
| `client/netlify/functions/_lib/googleAgenda.mjs` (MODIFICAR) | + `freeBusy`, `createEventComMeet`, `patchEventHorario`, `cancelEvent`; `classifyEvent` aceita `cbc_origem`; `VENDEDORAS` vira default |
| `client/netlify/functions/agenda-videochamadas-sync.mjs` (MODIFICAR) | agendas vindas de `bot_config.agenda_bot.vendedoras` |
| `client/netlify/functions/kommo-agenda-webhook.mjs` (novo) | recebe add_message, valida `?secret=`, despacha p/ worker |
| `client/netlify/functions/agenda-bot-worker-background.mjs` (novo) | orquestrador da conversa (até 15 min) |
| `client/netlify/functions/agenda-bot-cron.mjs` (novo) | cron `*/5`: lembretes T-1h/T-0, no-show, janela/templates |
| `client/netlify/functions/agenda-admin.mjs` (novo) | ações server da aba (reagendar/cancelar/desfecho/simulador) com JWT |
| `client/src/components/AgendaPanel.jsx` (novo) | aba, 8 sub-abas |
| `client/src/components/agenda/compute.js` (novo) | PURO: métricas do funil da Ana |
| `client/src/components/agenda/ConfigForms.jsx` (novo) | sub-abas Mensagens/Regras/Vendedoras/Config (edita `bot_config.agenda_bot`) |
| `client/src/components/agenda/Painéis.jsx` → `AgendaViews.jsx` (novo) | sub-abas Métricas/Agenda/Conversas/Simulador |
| `client/src/App.jsx` (MODIFICAR) | wiring da tab `agenda` (6 pontos, iguais à `trafego`) |
| `client/src/components/AdminPanel.jsx` (MODIFICAR) | linha na matriz RBAC |
| `client/src/utils/__tests__/agendaSlots.test.js`, `agendaEngine.test.js`, `agendaInterprete.test.js`, `agendaCompute.test.js`, `googleAgendaClassify.test.js` (novos) | testes |

**Estado da conversa** (`bot_conversations.context`, channel `agenda:<fone digits>`):
```js
// shape canônico — TODO o plano usa estes nomes
{
  etapa: 'abertura'|'qual_resort'|'qual_situacao'|'qual_valor'|'oferta'|'negociacao'|'confirmado'|'pos_noshow'|'handoff'|'encerrada',
  lead_id: 123, contact_id: 456, nome: 'Fulano',
  dados: { resort: null, situacao: null /* 'pagando'|'quitado' */, valor_aprox: null },
  slots_ofertados: [{ inicio: '2026-07-22T13:00:00-03:00', vendedora: 'marianamaciel@advocaciacbc.com' }],
  recusas: 0, reagendamentos: 0,
  agendamento: { event_id: null, inicio: null, vendedora: null, meet_link: null },
  pausada_ate: null /* ISO — humano assumiu */, origem: 'venda'|'disparo'
}
```

---

### Task 1: Migração SQL `agenda_bot_v1` (colunas, seeds, view, RPCs)

**Files:**
- Create: `supabase_agenda_bot.sql` (raiz de `projetos/cbc-contratos/`)

**Interfaces:**
- Produces: colunas novas em `agenda_videochamadas` (`lead_id bigint`, `telefone text`, `origem text default 'manual'`, `lembrete_1h_em timestamptz`, `lembrete_t0_em timestamptz`, `noshow_msg_em timestamptz`); key `agenda_bot` em `bot_config` (shape abaixo — consumido por TODAS as tasks); view `vw_agenda_painel`; RPC `agenda_bot_metricas(p_de date, p_ate date)` (grant authenticated).

- [ ] **Step 1: Branch + backup dir**

```bash
cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos"
git checkout -b feat/agenda-bot-ana
mkdir -p backups/20260721_agenda_bot
```

- [ ] **Step 2: Escrever `supabase_agenda_bot.sql`**

```sql
-- Migração agenda_bot_v1 — bot Ana (spec 2026-07-21). Aditiva; idempotente.
alter table agenda_videochamadas add column if not exists lead_id bigint;
alter table agenda_videochamadas add column if not exists telefone text;
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
```

- [ ] **Step 3: Aplicar no Supabase**

Via MCP: `mcp__supabase-cbc__apply_migration` com `name: "agenda_bot_v1"` e o SQL acima. (Sem MCP: SQL Editor do Supabase, projeto `vygczeepvoyaehfchxko`.)

- [ ] **Step 4: Verificar**

```sql
select key, value->'vendedoras' from bot_config where key='agenda_bot';
select agenda_bot_metricas(current_date - 30, current_date);
select origem, count(*) from agenda_videochamadas group by 1;
```
Expected: 1 linha de config com 3 vendedoras; jsonb de métricas (zeros em 'ana'); origens `manual` (542±).

- [ ] **Step 5: Commit**

```bash
git add supabase_agenda_bot.sql
git commit -m "feat(agenda-bot): migração agenda_bot_v1 — colunas, seeds de config, view painel, RPC métricas"
```

---

### Task 2: Validações F0 + setup externo (Google, Kommo, templates, envs)

Sem código de produção — smoke script + checklist. Itens marcados **[PAULO]** exigem ação humana; o executor prepara tudo, roda o que dá, e lista o que ficou pendente no relatório da task.

**Files:**
- Create: `client/scripts/smoke-agenda-f0.mjs`

**Interfaces:**
- Produces: confirmação de que (a) token Google escreve nas 3 agendas e cria Meet; (b) `outgoing_chat_message` aparece por CONTATO; (c) ids `campo_ana_id`/`salesbot_id` gravados em `bot_config.agenda_bot.kommo`; (d) templates WABA submetidos; (e) envs setadas.

- [ ] **Step 1: Escrever `client/scripts/smoke-agenda-f0.mjs`**

```js
// Smoke F0 do bot Ana. Roda local: node client/scripts/smoke-agenda-f0.mjs
// Lê envs do Netlify? NÃO — exportar antes: GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN, KOMMO_TOKEN.
import { getAccessToken } from '../netlify/functions/_lib/googleAgenda.mjs';

const AGENDAS = ['marianamaciel@advocaciacbc.com','beatriz@advocaciacbc.com','emerson@advocaciacbc.com'];
const at = await getAccessToken();

// 1) escopo do token: tokeninfo
const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${at}`)).json();
console.log('scope:', info.scope);
const podeEscrever = /auth\/calendar(\.events)?(\s|$)/.test(info.scope || '');
console.log(podeEscrever ? 'OK escopo de escrita' : 'FALTA re-consentir com https://www.googleapis.com/auth/calendar.events');

// 2) freeBusy nas 3 agendas
const fb = await (await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
  method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ timeMin: new Date().toISOString(), timeMax: new Date(Date.now()+864e5).toISOString(),
    items: AGENDAS.map((id) => ({ id })) }),
})).json();
for (const a of AGENDAS) console.log(a, fb.calendars?.[a]?.errors ? `ERRO ${JSON.stringify(fb.calendars[a].errors)}` : `busy=${(fb.calendars?.[a]?.busy||[]).length}`);

// 3) criar + apagar evento de TESTE com Meet na 1ª agenda ok (amanhã 20h — fora do expediente)
const ini = new Date(Date.now()+864e5); ini.setHours(20,0,0,0);
const ev = await (await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(AGENDAS[0])}/events?conferenceDataVersion=1`, {
  method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ summary: 'TESTE CBC/Ana — apagar', start: { dateTime: ini.toISOString() },
    end: { dateTime: new Date(ini.getTime()+18e5).toISOString() },
    conferenceData: { createRequest: { requestId: `cbc-ana-smoke-${ini.getTime()}` } },
    extendedProperties: { private: { cbc_origem: 'ana', cbc_lead_id: '0' } } }),
})).json();
console.log(ev.id ? `OK evento ${ev.id} meet=${ev.hangoutLink || JSON.stringify(ev.conferenceData?.entryPoints?.[0])}` : `ERRO criar: ${JSON.stringify(ev.error||ev).slice(0,300)}`);
if (ev.id) {
  const del = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(AGENDAS[0])}/events/${ev.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${at}` } });
  console.log('delete status', del.status);
}

// 4) Kommo: outgoing_chat_message por CONTATO (usar um contato com conversa recente — id via argv[2])
const contato = process.argv[2];
if (contato) {
  const r = await (await fetch(`https://advocaciacbc.kommo.com/api/v4/events?filter[type]=outgoing_chat_message&filter[entity]=contact&filter[entity_id][]=${contato}&limit=3`, {
    headers: { Authorization: `Bearer ${process.env.KOMMO_TOKEN}` } })).json().catch(() => null);
  console.log('outgoing events:', (r?._embedded?.events || []).length, (r?._embedded?.events || []).map(e => e.created_at));
} else console.log('PULA teste 4 — rode com: node ... <contact_id de teste>');
```

- [ ] **Step 2: Rodar o smoke**

Run: `cd client && GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... GOOGLE_OAUTH_REFRESH_TOKEN=... KOMMO_TOKEN=... node scripts/smoke-agenda-f0.mjs <contact_id_teste>`
(valores das envs: `netlify env:list --site d7b38821-...` ou painel Netlify do site contratos-cbc)
Expected: escopo com escrita OU instrução de re-consent **[PAULO se faltar]**; 3 agendas sem `errors` (senão **[PAULO]**: cada vendedora compartilha agenda com a conta do token com "Fazer alterações nos eventos" — Emerson certamente falta); evento criado com meet + delete 204; eventos outgoing listados (≥1 se o contato teve resposta manual recente).

- [ ] **Step 3: Criar campo "CBC Ana" no lead via API (padrão do campo BOT_RESPOSTA)**

```bash
curl -s -X POST https://advocaciacbc.kommo.com/api/v4/leads/custom_fields \
  -H "Authorization: Bearer $KOMMO_TOKEN" -H 'Content-Type: application/json' \
  -d '[{"name":"CBC Ana","type":"textarea"}]'
```
Expected: JSON com `id` novo → gravar em `bot_config.agenda_bot.kommo.campo_ana_id`:
```sql
update bot_config set value = jsonb_set(value,'{kommo,campo_ana_id}', to_jsonb(<ID>::int)) where key='agenda_bot';
```

- [ ] **Step 4 [PAULO]: Salesbot "CBC - Ana" na UI do Kommo** (POST /bots = 405, não dá via API — precedente 02/07)

Instruções exatas (mandar ao Paulo): Kommo → Configurações → Ferramentas de comunicação → Salesbot → Criar bot → nome `CBC - Ana` → 1 bloco "Mensagem" com o texto `{{lead.cf.<campo_ana_id>}}` (inserir via menu de variáveis do editor) → SEM gatilho de etapa → salvar → copiar o id do bot da URL. Gravar:
```sql
update bot_config set value = jsonb_set(value,'{kommo,salesbot_id}', to_jsonb(<BOT_ID>::int)) where key='agenda_bot';
```

- [ ] **Step 5 [PAULO]: Templates WABA (canal WhatsApp do Kommo → Templates)**

Submeter 3 templates categoria **Utility**, idioma pt_BR, corpos EXATOS da spec §Janela de 24h: `ana_lembrete_1h` ({{1}}=nome, {{2}}=hora), `ana_link_meet` ({{1}}=link), `ana_reagendar` ({{1}}=nome). Anotar como o Kommo dispara template via Salesbot (bloco WhatsApp template) → se existir, criar 2º bot `CBC - Ana Template` e gravar id em `kommo.salesbot_template_id`; registrar o mecanismo real no relatório (o cron da Task 9 usa `salesbot_template_id` se existir, senão fallback tarefa).

- [ ] **Step 6: Webhook add_message p/ o endpoint novo (via API)**

```bash
SEC=$(openssl rand -hex 24); echo "AGENDA_WEBHOOK_SECRET=$SEC"
curl -s -X POST https://advocaciacbc.kommo.com/api/v4/webhooks \
  -H "Authorization: Bearer $KOMMO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"destination\":\"https://contratos-cbc.netlify.app/.netlify/functions/kommo-agenda-webhook?secret=$SEC\",\"settings\":[\"add_message\"]}"
```
Expected: 200/201 com o webhook criado (coexiste com o do ADVBOX). Guardar `$SEC`.

- [ ] **Step 7 [PAULO ou executor com token Netlify]: Envs no Netlify**

```bash
netlify env:set AGENDA_WEBHOOK_SECRET "$SEC" --site d7b38821-...
netlify env:set ANTHROPIC_API_KEY "sk-ant-..."   # conta da API Anthropic
netlify env:set GROQ_API_KEY "gsk_..."           # ou OPENAI_API_KEY
```

- [ ] **Step 8: Commit**

```bash
git add client/scripts/smoke-agenda-f0.mjs
git commit -m "feat(agenda-bot): smoke F0 — escopo Google, freeBusy, evento+Meet, eventos outgoing Kommo"
```

---

### Task 3: `_lib/agendaSlots.mjs` (puro) + testes

**Files:**
- Create: `client/netlify/functions/_lib/agendaSlots.mjs`
- Test: `client/src/utils/__tests__/agendaSlots.test.js`

**Interfaces:**
- Produces (consumidas pelo engine/worker/cron):
  - `gerarSlots({ regras, busyPorVendedora, agora, limite=10 })` → `[{ inicio: Date, vendedoras: [email] }]` ordenado (só slots com ≥1 vendedora livre; respeita dias/horas/granularidade/antecedência/horizonte/almoço/feriados)
  - `sortearVendedora(vendedoras, emailsLivres, seed)` → email (ponderado por `peso`, só `ativa`, determinístico p/ mesmo seed)
  - `slotMaisProximo(slots, desejadoISO)` → slot ou null (menor |Δt|)
  - `formatarSlot(date, agora)` → `'hoje às 14h30'` / `'amanhã às 9h'` / `'quinta (24/07) às 10h'` (pt-BR, fuso America/Sao_Paulo)
  - `dentroDoExpediente(date, regras)` → bool

- [ ] **Step 1: Escrever os testes (falhando)** — `client/src/utils/__tests__/agendaSlots.test.js`

```js
import { describe, it, expect } from 'vitest';
import { gerarSlots, sortearVendedora, slotMaisProximo, formatarSlot, dentroDoExpediente } from '../../../netlify/functions/_lib/agendaSlots.mjs';

const REGRAS = { dias: [1,2,3,4,5], hora_inicio: '08:00', hora_fim: '17:00', granularidade_min: 30,
  antecedencia_min_minutos: 60, horizonte_dias_uteis: 5, almoco: null, slots_por_oferta: 2,
  duracao_evento_min: 30, feriados: [] };
const V = ['a@x.com', 'b@x.com'];
// terça-feira 10h00 São Paulo (UTC-3)
const AGORA = new Date('2026-07-21T13:00:00Z');

describe('gerarSlots', () => {
  it('gera slots :00/:30 dentro do expediente, respeitando antecedência mínima', () => {
    const slots = gerarSlots({ regras: REGRAS, busyPorVendedora: { 'a@x.com': [], 'b@x.com': [] }, agora: AGORA });
    expect(slots.length).toBeGreaterThan(0);
    const first = slots[0];
    expect(first.inicio.getTime()).toBeGreaterThanOrEqual(AGORA.getTime() + 60 * 60000);
    for (const s of slots) {
      const local = new Date(s.inicio.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      expect([0, 30]).toContain(local.getMinutes());
      expect(dentroDoExpediente(s.inicio, REGRAS)).toBe(true);
    }
  });
  it('exclui vendedora ocupada e slot sem ninguém livre', () => {
    const busy = { 'a@x.com': [{ start: '2026-07-21T14:00:00Z', end: '2026-07-21T15:00:00Z' }], 'b@x.com': [] };
    const slots = gerarSlots({ regras: REGRAS, busyPorVendedora: busy, agora: AGORA });
    const das11 = slots.find((s) => s.inicio.toISOString() === '2026-07-21T14:00:00.000Z'); // 11h local
    expect(das11.vendedoras).toEqual(['b@x.com']);
    const busyAll = { 'a@x.com': busy['a@x.com'], 'b@x.com': busy['a@x.com'] };
    const slots2 = gerarSlots({ regras: REGRAS, busyPorVendedora: busyAll, agora: AGORA });
    expect(slots2.find((s) => s.inicio.toISOString() === '2026-07-21T14:00:00.000Z')).toBeUndefined();
  });
  it('pula fim de semana e feriado', () => {
    const sexta17 = new Date('2026-07-24T19:30:00Z'); // sexta 16h30 local
    const slots = gerarSlots({ regras: { ...REGRAS, feriados: ['2026-07-27'] }, busyPorVendedora: { 'a@x.com': [] }, agora: sexta17 });
    // próximo dia útil não-feriado = terça 28/07
    const dias = new Set(slots.map((s) => s.inicio.toISOString().slice(0, 10)));
    expect(dias.has('2026-07-25')).toBe(false);
    expect(dias.has('2026-07-26')).toBe(false);
    expect(dias.has('2026-07-27')).toBe(false);
  });
});

describe('sortearVendedora', () => {
  it('é determinístico por seed e respeita peso 100/0', () => {
    const vends = [{ email: 'a@x.com', peso: 100, ativa: true }, { email: 'b@x.com', peso: 0, ativa: true }];
    expect(sortearVendedora(vends, ['a@x.com', 'b@x.com'], 'lead-1')).toBe('a@x.com');
  });
  it('ignora inativa e quem não está livre', () => {
    const vends = [{ email: 'a@x.com', peso: 60, ativa: false }, { email: 'b@x.com', peso: 20, ativa: true }];
    expect(sortearVendedora(vends, ['a@x.com', 'b@x.com'], 's')).toBe('b@x.com');
    expect(sortearVendedora(vends, ['a@x.com'], 's')).toBe(null);
  });
});

describe('slotMaisProximo/formatarSlot', () => {
  it('acha o mais próximo do pedido', () => {
    const slots = [{ inicio: new Date('2026-07-22T12:00:00Z') }, { inicio: new Date('2026-07-22T17:00:00Z') }];
    expect(slotMaisProximo(slots, '2026-07-22T16:00:00Z').inicio.toISOString()).toBe('2026-07-22T17:00:00.000Z');
    expect(slotMaisProximo([], '2026-07-22T16:00:00Z')).toBe(null);
  });
  it('formata pt-BR relativo', () => {
    expect(formatarSlot(new Date('2026-07-21T17:30:00Z'), AGORA)).toBe('hoje às 14h30');
    expect(formatarSlot(new Date('2026-07-22T12:00:00Z'), AGORA)).toBe('amanhã às 9h');
    expect(formatarSlot(new Date('2026-07-23T13:00:00Z'), AGORA)).toBe('quinta (23/07) às 10h');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd client && npx vitest run src/utils/__tests__/agendaSlots.test.js` → Expected: FAIL (módulo inexistente)

- [ ] **Step 3: Implementar `client/netlify/functions/_lib/agendaSlots.mjs`** (módulo PURO, sem I/O)

```js
// Slots de agenda do bot Ana — PURO (testado em src/utils/__tests__/agendaSlots.test.js).
// Todas as datas em Date UTC; regras expressas no fuso America/Sao_Paulo.
const TZ = 'America/Sao_Paulo';

function partesLocais(d) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  const dows = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, h: +g('hour'), m: +g('minute'), dow: dows[g('weekday')] };
}
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export function dentroDoExpediente(date, regras) {
  const { h, m, dow, ymd } = partesLocais(date);
  if (!regras.dias.includes(dow)) return false;
  if ((regras.feriados || []).includes(ymd)) return false;
  const min = h * 60 + m;
  if (min < hm(regras.hora_inicio) || min + (regras.duracao_evento_min || 30) > hm(regras.hora_fim)) return false;
  if (regras.almoco && min >= hm(regras.almoco.inicio) && min < hm(regras.almoco.fim)) return false;
  return true;
}

const livre = (busy, ini, fim) => !(busy || []).some((b) => new Date(b.start) < fim && new Date(b.end) > ini);

export function gerarSlots({ regras, busyPorVendedora, agora, limite = 10 }) {
  const out = [];
  const passo = (regras.granularidade_min || 30) * 60000;
  const minIni = new Date(agora.getTime() + (regras.antecedencia_min_minutos || 60) * 60000);
  // arredonda p/ próxima grade :00/:30 (em UTC funciona: SP tem offset múltiplo de 30min)
  let t = new Date(Math.ceil(minIni.getTime() / passo) * passo);
  const fimJanela = new Date(agora.getTime() + ((regras.horizonte_dias_uteis || 5) + 4) * 864e5); // folga p/ fds/feriado
  let diasUteis = new Set();
  while (t < fimJanela && out.length < limite) {
    if (dentroDoExpediente(t, regras)) {
      diasUteis.add(partesLocais(t).ymd);
      if (diasUteis.size > (regras.horizonte_dias_uteis || 5)) break;
      const fim = new Date(t.getTime() + (regras.duracao_evento_min || 30) * 60000);
      const vends = Object.keys(busyPorVendedora).filter((e) => livre(busyPorVendedora[e], t, fim));
      if (vends.length) out.push({ inicio: new Date(t), vendedoras: vends });
    }
    t = new Date(t.getTime() + passo);
  }
  return out;
}

// hash determinístico simples (seed = lead/telefone) p/ sorteio reproduzível em retry
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

export function sortearVendedora(vendedoras, emailsLivres, seed) {
  const cand = (vendedoras || []).filter((v) => v.ativa && (v.peso || 0) > 0 && emailsLivres.includes(v.email));
  if (!cand.length) return null;
  const total = cand.reduce((s, v) => s + v.peso, 0);
  let r = hash(seed) * total;
  for (const v of cand) { r -= v.peso; if (r <= 0) return v.email; }
  return cand[cand.length - 1].email;
}

export function slotMaisProximo(slots, desejadoISO) {
  if (!slots?.length || !desejadoISO) return null;
  const alvo = new Date(desejadoISO).getTime();
  return slots.reduce((best, s) => (!best || Math.abs(s.inicio - alvo) < Math.abs(best.inicio - alvo) ? s : best), null);
}

export function formatarSlot(date, agora) {
  const { h, m, ymd, dow } = partesLocais(date);
  const hora = m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  const hoje = partesLocais(agora).ymd;
  const amanha = partesLocais(new Date(agora.getTime() + 864e5)).ymd;
  if (ymd === hoje) return `hoje às ${hora}`;
  if (ymd === amanha) return `amanhã às ${hora}`;
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const [, mm, dd] = ymd.split('-');
  return `${nomes[dow]} (${dd}/${mm}) às ${hora}`;
}
```

- [ ] **Step 4: Rodar e ver passar** — `cd client && npx vitest run src/utils/__tests__/agendaSlots.test.js` → Expected: PASS (ajustar implementação até passar; NUNCA afrouxar o teste)

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/agendaSlots.mjs client/src/utils/__tests__/agendaSlots.test.js
git commit -m "feat(agenda-bot): agendaSlots puro — geração/sorteio ponderado/formatação pt-BR (TDD)"
```

---

### Task 4: `_lib/agendaEngine.mjs` (máquina de estados pura) + testes

**Files:**
- Create: `client/netlify/functions/_lib/agendaEngine.mjs`
- Test: `client/src/utils/__tests__/agendaEngine.test.js`

**Interfaces:**
- Consumes: `formatarSlot` de `agendaSlots.mjs`; shape de estado do Mapa de arquivos; interpretação da Task 5: `{ intencao, resort, situacao, valor_aprox, horario_aceito_idx, horario_proposto, pede_humano, pergunta_preco, confianca }` onde `intencao ∈ 'responde_qualificacao'|'aceita_slot'|'propoe_horario'|'recusa'|'pergunta_preco'|'pede_humano'|'saudacao'|'outro'`.
- Produces (consumidas pelo worker):
  - `aplicarTemplate(txt, vars)` → string (troca `{{chave}}`; chave ausente → '')
  - `decidir({ estado, interp, cfg, agora, slotsDisponiveis })` → `{ novoEstado, acoes }` — ações possíveis (executadas em ordem pelo worker):
    - `{ tipo:'responder', mensagem }` (texto FINAL, já renderizado)
    - `{ tipo:'buscar_slots' }` (worker gera slots e re-chama `decidir` com `slotsDisponiveis`)
    - `{ tipo:'agendar', slotIdx }` · `{ tipo:'reagendar', slotIdx }`
    - `{ tipo:'salvar_campos', campos:{investimento?:string, preferencia?:string} }`
    - `{ tipo:'handoff', motivo }` · `{ tipo:'nota', texto }`

Regras de negócio (da spec): qualificação resort→situação→valor (pula o que a interpretação já trouxe); oferta sempre com `slots_por_oferta` slots; contraproposta → `slotMaisProximo` (worker resolve o slot; engine só decide); `max_recusas` → grava "Preferência de Horário" + handoff; `pergunta_preco` → template `preco` COM slots; `pede_humano`/`confianca < minima` → handoff; estado `confirmado` + mensagem nova = possível reagendamento.

- [ ] **Step 1: Escrever testes (falhando)** — `client/src/utils/__tests__/agendaEngine.test.js`

```js
import { describe, it, expect } from 'vitest';
import { decidir, aplicarTemplate, estadoInicial } from '../../../netlify/functions/_lib/agendaEngine.mjs';

const CFG = {
  regras: { slots_por_oferta: 2, max_recusas: 2, max_reagendamentos: 2 },
  llm: { confianca_minima: 0.6 },
  mensagens: {
    abertura: 'Oi! Sou a Ana. O que houve com a sua cota?', qual_resort: 'Qual resort?',
    qual_situacao: 'Pagando ou quitou?', qual_valor: 'Quanto já pagou?',
    pitch_oferta: 'Pitch. Tenho {{slot1}} ou {{slot2}}. Qual prefere?',
    oferta_slots: 'Consigo {{slot1}} ou {{slot2}}.', confirmado: 'Ok, agendado {{dia}} às {{hora}}!',
    slot_ocupado: 'Ocupou 😅 {{slot1}} ou {{slot2}}?', preco: 'Sem preço antes. {{slot1}} ou {{slot2}}?',
    handoff: 'Chamando a equipe!', impasse: 'Equipe vai combinar!', pede_texto: 'Pode escrever?',
  },
};
const AGORA = new Date('2026-07-21T13:00:00Z');
const SLOTS = [
  { inicio: new Date('2026-07-21T17:00:00Z'), vendedoras: ['a@x.com'] },
  { inicio: new Date('2026-07-22T12:00:00Z'), vendedoras: ['b@x.com'] },
];
const interp = (x) => ({ intencao: 'outro', resort: null, situacao: null, valor_aprox: null,
  horario_aceito_idx: null, horario_proposto: null, pede_humano: false, pergunta_preco: false, confianca: 0.9, ...x });

describe('aplicarTemplate', () => {
  it('substitui e tolera chave ausente', () => {
    expect(aplicarTemplate('A {{x}} e {{y}}.', { x: '1' })).toBe('A 1 e .');
  });
});

describe('fluxo de qualificação', () => {
  it('abertura → responde com template e vai para qual_resort', () => {
    const { novoEstado, acoes } = decidir({ estado: estadoInicial({ lead_id: 1 }), interp: interp({ intencao: 'saudacao' }), cfg: CFG, agora: AGORA });
    expect(acoes).toEqual([{ tipo: 'responder', mensagem: CFG.mensagens.abertura }]);
    expect(novoEstado.etapa).toBe('qual_resort');
  });
  it('pula perguntas já respondidas (lead contou tudo de uma vez) e pede slots', () => {
    const est = { ...estadoInicial({ lead_id: 1 }), etapa: 'qual_resort' };
    const r = decidir({ estado: est, interp: interp({ intencao: 'responde_qualificacao', resort: 'Hot Beach', situacao: 'pagando', valor_aprox: 'R$ 20.000' }), cfg: CFG, agora: AGORA });
    expect(r.novoEstado.dados).toEqual({ resort: 'Hot Beach', situacao: 'pagando', valor_aprox: 'R$ 20.000' });
    expect(r.acoes[0]).toEqual({ tipo: 'salvar_campos', campos: { investimento: 'R$ 20.000' } });
    expect(r.acoes[1]).toEqual({ tipo: 'buscar_slots' });
    expect(r.novoEstado.etapa).toBe('oferta');
  });
  it('em oferta com slots disponíveis, oferta formatada e guarda slots_ofertados', () => {
    const est = { ...estadoInicial({ lead_id: 1 }), etapa: 'oferta', dados: { resort: 'X', situacao: 'pagando', valor_aprox: 'R$ 5 mil' } };
    const r = decidir({ estado: est, interp: interp({}), cfg: CFG, agora: AGORA, slotsDisponiveis: SLOTS });
    expect(r.acoes[0].tipo).toBe('responder');
    expect(r.acoes[0].mensagem).toContain('hoje às 14h');
    expect(r.acoes[0].mensagem).toContain('amanhã às 9h');
    expect(r.novoEstado.slots_ofertados).toHaveLength(2);
    expect(r.novoEstado.etapa).toBe('negociacao');
  });
});

describe('negociação', () => {
  const emNegociacao = () => ({ ...estadoInicial({ lead_id: 1 }), etapa: 'negociacao',
    dados: { resort: 'X', situacao: 'pagando', valor_aprox: 'R$ 5 mil' },
    slots_ofertados: SLOTS.map((s, i) => ({ inicio: s.inicio.toISOString(), vendedoras: s.vendedoras })) });
  it('aceite do slot 2 → agendar', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'aceita_slot', horario_aceito_idx: 1 }), cfg: CFG, agora: AGORA });
    expect(r.acoes[0]).toEqual({ tipo: 'agendar', slotIdx: 1 });
  });
  it('contraproposta → buscar_slots com desejado', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'propoe_horario', horario_proposto: '2026-07-23T13:00:00-03:00' }), cfg: CFG, agora: AGORA });
    expect(r.acoes[0]).toEqual({ tipo: 'buscar_slots', desejado: '2026-07-23T13:00:00-03:00' });
  });
  it('pergunta de preço responde template preco COM slots e não perde a etapa', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ intencao: 'pergunta_preco', pergunta_preco: true }), cfg: CFG, agora: AGORA });
    expect(r.acoes[0].mensagem).toContain('Sem preço antes');
    expect(r.acoes[0].mensagem).toContain('hoje às 14h');
    expect(r.novoEstado.etapa).toBe('negociacao');
  });
  it('2ª recusa → salvar preferência + impasse + handoff', () => {
    const est = { ...emNegociacao(), recusas: 1 };
    const r = decidir({ estado: est, interp: interp({ intencao: 'recusa' }), cfg: CFG, agora: AGORA });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['salvar_campos', 'responder', 'handoff']);
    expect(r.novoEstado.etapa).toBe('handoff');
  });
  it('confiança baixa → handoff', () => {
    const r = decidir({ estado: emNegociacao(), interp: interp({ confianca: 0.3 }), cfg: CFG, agora: AGORA });
    expect(r.acoes.some((a) => a.tipo === 'handoff')).toBe(true);
  });
  it('pede humano em qualquer etapa → responder handoff + handoff', () => {
    const r = decidir({ estado: { ...estadoInicial({ lead_id: 1 }), etapa: 'qual_valor' }, interp: interp({ pede_humano: true, intencao: 'pede_humano' }), cfg: CFG, agora: AGORA });
    expect(r.acoes.map((a) => a.tipo)).toEqual(['responder', 'handoff']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd client && npx vitest run src/utils/__tests__/agendaEngine.test.js` → FAIL

- [ ] **Step 3: Implementar `client/netlify/functions/_lib/agendaEngine.mjs`**

```js
// Máquina de estados do bot Ana — PURA (sem I/O). Falas SEMPRE via templates de cfg.mensagens.
import { formatarSlot } from './agendaSlots.mjs';

export function aplicarTemplate(txt, vars = {}) {
  return String(txt || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

export function estadoInicial({ lead_id, contact_id = null, nome = '', origem = 'venda' }) {
  return { etapa: 'abertura', lead_id, contact_id, nome,
    dados: { resort: null, situacao: null, valor_aprox: null },
    slots_ofertados: [], recusas: 0, reagendamentos: 0,
    agendamento: { event_id: null, inicio: null, vendedora: null, meet_link: null },
    pausada_ate: null, origem };
}

const varsSlots = (slots, agora) => Object.fromEntries(slots.map((s, i) => [`slot${i + 1}`, formatarSlot(new Date(s.inicio), agora)]));
const proximaPergunta = (d) => (!d.resort ? 'qual_resort' : !d.situacao ? 'qual_situacao' : !d.valor_aprox ? 'qual_valor' : null);

export function decidir({ estado, interp, cfg, agora, slotsDisponiveis = null }) {
  const M = cfg.mensagens; const e = structuredClone(estado); const acoes = [];
  const resp = (tpl, vars) => acoes.push({ tipo: 'responder', mensagem: aplicarTemplate(M[tpl], vars) });

  // guarda-corpos globais (qualquer etapa)
  if (interp.pede_humano) { resp('handoff'); acoes.push({ tipo: 'handoff', motivo: 'pediu_humano' }); e.etapa = 'handoff'; return { novoEstado: e, acoes }; }
  if ((interp.confianca ?? 1) < (cfg.llm?.confianca_minima ?? 0.6)) {
    acoes.push({ tipo: 'handoff', motivo: 'confianca_baixa' }); e.etapa = 'handoff'; return { novoEstado: e, acoes };
  }
  // absorve dados de qualificação que vieram em QUALQUER mensagem
  for (const k of ['resort', 'situacao', 'valor_aprox']) if (interp[k] && !e.dados[k]) e.dados[k] = interp[k];
  if (interp.valor_aprox && !acoes.some((a) => a.tipo === 'salvar_campos'))
    acoes.push({ tipo: 'salvar_campos', campos: { investimento: String(interp.valor_aprox) } });

  // pergunta de preço: deflexão da casa (com slots se houver/na negociação)
  if (interp.pergunta_preco) {
    if (e.slots_ofertados.length) { resp('preco', varsSlots(e.slots_ofertados, agora)); return { novoEstado: e, acoes }; }
    acoes.push({ tipo: 'buscar_slots', proposito: 'preco' });
    if (slotsDisponiveis?.length) { acoes.pop(); const s = slotsDisponiveis.slice(0, cfg.regras.slots_por_oferta); e.slots_ofertados = s.map(x => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: x.vendedoras })); e.etapa = 'negociacao'; resp('preco', varsSlots(s, agora)); }
    return { novoEstado: e, acoes };
  }

  switch (e.etapa) {
    case 'abertura': resp('abertura'); e.etapa = 'qual_resort'; return { novoEstado: e, acoes };
    case 'qual_resort': case 'qual_situacao': case 'qual_valor': {
      const falta = proximaPergunta(e.dados);
      if (falta) { resp(falta); e.etapa = falta; return { novoEstado: e, acoes }; }
      e.etapa = 'oferta';
      if (!slotsDisponiveis) { acoes.push({ tipo: 'buscar_slots' }); return { novoEstado: e, acoes }; }
      // cai no case 'oferta' abaixo
    }
    case 'oferta': {
      if (!slotsDisponiveis) { acoes.push({ tipo: 'buscar_slots' }); return { novoEstado: e, acoes }; }
      if (!slotsDisponiveis.length) { resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'sem_slots' }); e.etapa = 'handoff'; return { novoEstado: e, acoes }; }
      const s = slotsDisponiveis.slice(0, cfg.regras.slots_por_oferta);
      e.slots_ofertados = s.map((x) => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: x.vendedoras }));
      const tpl = e.dados.situacao ? 'pitch_oferta' : 'oferta_slots';
      resp(tpl, varsSlots(s, agora)); e.etapa = 'negociacao'; return { novoEstado: e, acoes };
    }
    case 'negociacao': case 'pos_noshow': {
      if (interp.intencao === 'aceita_slot' && Number.isInteger(interp.horario_aceito_idx) && e.slots_ofertados[interp.horario_aceito_idx]) {
        acoes.push({ tipo: e.etapa === 'pos_noshow' ? 'reagendar' : 'agendar', slotIdx: interp.horario_aceito_idx });
        return { novoEstado: e, acoes };
      }
      if (interp.intencao === 'propoe_horario' && interp.horario_proposto) {
        acoes.push({ tipo: 'buscar_slots', desejado: interp.horario_proposto }); return { novoEstado: e, acoes };
      }
      if (interp.intencao === 'recusa' || interp.intencao === 'outro') {
        e.recusas += 1;
        if (e.recusas >= (cfg.regras.max_recusas ?? 2)) {
          acoes.push({ tipo: 'salvar_campos', campos: { preferencia: 'lead pediu outro horário — combinar manualmente' } });
          resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'impasse_horario' }); e.etapa = 'handoff';
          return { novoEstado: e, acoes };
        }
        acoes.push({ tipo: 'buscar_slots' }); return { novoEstado: e, acoes };
      }
      resp('oferta_slots', varsSlots(e.slots_ofertados, agora)); return { novoEstado: e, acoes };
    }
    case 'confirmado': {
      if (interp.intencao === 'propoe_horario' || interp.intencao === 'recusa') {
        if ((e.reagendamentos ?? 0) >= (cfg.regras.max_reagendamentos ?? 2)) {
          resp('impasse'); acoes.push({ tipo: 'handoff', motivo: 'reagendamentos_esgotados' }); e.etapa = 'handoff';
          return { novoEstado: e, acoes };
        }
        acoes.push({ tipo: 'buscar_slots', desejado: interp.horario_proposto || null }); e.etapa = 'pos_noshow';
        return { novoEstado: e, acoes };
      }
      return { novoEstado: e, acoes }; // "obrigado", "🙏" etc.: silêncio
    }
    default: return { novoEstado: e, acoes };
  }
}

// pós-agendamento (worker chama depois de criar o evento com sucesso)
export function confirmar({ estado, slot, agora, cfg, eventId, meetLink, vendedora }) {
  const e = structuredClone(estado);
  e.agendamento = { event_id: eventId, inicio: new Date(slot.inicio).toISOString(), vendedora, meet_link: meetLink };
  if (e.etapa === 'pos_noshow') e.reagendamentos = (e.reagendamentos ?? 0) + 1;
  e.etapa = 'confirmado'; e.recusas = 0;
  const f = formatarSlot(new Date(slot.inicio), agora);
  const [dia, hora] = f.includes(' às ') ? f.split(' às ') : ['', f];
  return { novoEstado: e, mensagem: aplicarTemplate(cfg.mensagens.confirmado, { dia, hora }) };
}
```

- [ ] **Step 4: Rodar e ver passar** — `cd client && npx vitest run src/utils/__tests__/agendaEngine.test.js` → PASS. Depois suíte inteira: `npm test` → PASS (nada quebrado).

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/agendaEngine.mjs client/src/utils/__tests__/agendaEngine.test.js
git commit -m "feat(agenda-bot): agendaEngine — máquina de estados pura da Ana (TDD)"
```

---

### Task 5: `_lib/agendaInterprete.mjs` (LLM + STT) + testes das partes puras

**Files:**
- Create: `client/netlify/functions/_lib/agendaInterprete.mjs`
- Test: `client/src/utils/__tests__/agendaInterprete.test.js`

**Interfaces:**
- Consumes: `cfg.llm` (`modelo`, `max_tokens`, `confianca_minima`), `cfg.stt` (`provedor` 'groq'|'openai', `modelo`, `max_minutos`), envs `ANTHROPIC_API_KEY`, `GROQ_API_KEY`/`OPENAI_API_KEY`.
- Produces:
  - `montarPromptInterprete({ mensagem, estado, agoraISO })` → `{ system, user }` (puro)
  - `validarInterpretacao(obj)` → objeto normalizado ou `null` (puro; garante enum de `intencao`, tipos, clamps)
  - `async interpretar({ mensagem, estado, cfg })` → interpretação validada; em erro de API/parse → `{ intencao:'outro', confianca:0, erro:true }` (worker trata como confiança baixa → handoff)
  - `async transcrever({ url, cfg })` → `{ texto }` ou `{ erro }` (baixa o áudio da URL do Kommo e manda multipart p/ Groq/OpenAI)

- [ ] **Step 1: Testes das partes puras (falhando)** — `client/src/utils/__tests__/agendaInterprete.test.js`

```js
import { describe, it, expect } from 'vitest';
import { montarPromptInterprete, validarInterpretacao } from '../../../netlify/functions/_lib/agendaInterprete.mjs';

describe('montarPromptInterprete', () => {
  it('inclui contexto do estado e slots ofertados no prompt', () => {
    const { system, user } = montarPromptInterprete({
      mensagem: 'pode ser quarta às 9h?',
      estado: { etapa: 'negociacao', dados: { resort: 'Hot Beach', situacao: null, valor_aprox: null },
        slots_ofertados: [{ inicio: '2026-07-22T13:00:00.000Z' }] },
      agoraISO: '2026-07-21T13:00:00-03:00',
    });
    expect(system).toContain('JSON');
    expect(system).toContain('advocacia');           // domínio no prompt
    expect(user).toContain('pode ser quarta às 9h?');
    expect(user).toContain('negociacao');
    expect(user).toContain('2026-07-22T13:00:00.000Z');
  });
});

describe('validarInterpretacao', () => {
  it('normaliza um objeto válido', () => {
    const v = validarInterpretacao({ intencao: 'aceita_slot', horario_aceito_idx: 1, confianca: 0.93 });
    expect(v).toMatchObject({ intencao: 'aceita_slot', horario_aceito_idx: 1 });
    expect(v.pede_humano).toBe(false);
  });
  it('rejeita intencao fora do enum e clampa confiança', () => {
    expect(validarInterpretacao({ intencao: 'hackear' })).toBe(null);
    expect(validarInterpretacao({ intencao: 'outro', confianca: 7 }).confianca).toBe(1);
  });
  it('horario_proposto inválido vira null', () => {
    const v = validarInterpretacao({ intencao: 'propoe_horario', horario_proposto: 'quarta' });
    expect(v.horario_proposto).toBe(null);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/utils/__tests__/agendaInterprete.test.js` → FAIL

- [ ] **Step 3: Implementar** — `client/netlify/functions/_lib/agendaInterprete.mjs`

```js
// Intérprete IA da Ana. LLM NUNCA fala com o lead — só devolve JSON p/ o engine.
// Padrão de chamada Anthropic: fetch direto (igual botEngine.mjs). STT: Groq ou OpenAI.
const INTENCOES = ['responde_qualificacao','aceita_slot','propoe_horario','recusa','pergunta_preco','pede_humano','saudacao','outro'];

export function montarPromptInterprete({ mensagem, estado, agoraISO }) {
  const system = [
    'Você extrai dados de mensagens de WhatsApp de leads de um escritório de advocacia especializado em distrato (cancelamento) de cotas de multipropriedade/timeshare de resorts.',
    'Responda APENAS com a chamada da tool `interpretacao` (JSON). Nunca escreva texto livre.',
    'Regras: horario_proposto sempre ISO-8601 com offset -03:00 interpretando expressões relativas a AGORA;',
    'horario_aceito_idx é o índice (0-based) do slot ofertado que o lead aceitou, se aceitou;',
    'valor_aprox é a string como o lead disse (ex.: "uns 20 mil"); situacao é "pagando" ou "quitado";',
    'confianca (0-1) reflete sua certeza global. Se a mensagem for ambígua/fora do domínio, intencao="outro" e confianca baixa.',
  ].join('\n');
  const user = JSON.stringify({
    agora: agoraISO,
    etapa_da_conversa: estado.etapa,
    dados_ja_coletados: estado.dados,
    slots_ofertados: (estado.slots_ofertados || []).map((s, i) => ({ idx: i, inicio: s.inicio })),
    mensagem_do_lead: mensagem,
  });
  return { system, user };
}

const TOOL_INTERPRETACAO = {
  name: 'interpretacao', description: 'Interpretação estruturada da mensagem do lead',
  input_schema: { type: 'object', additionalProperties: false, required: ['intencao', 'confianca'],
    properties: {
      intencao: { type: 'string', enum: INTENCOES },
      resort: { type: ['string', 'null'] }, situacao: { type: ['string', 'null'], enum: ['pagando', 'quitado', null] },
      valor_aprox: { type: ['string', 'null'] },
      horario_aceito_idx: { type: ['integer', 'null'] }, horario_proposto: { type: ['string', 'null'] },
      pede_humano: { type: 'boolean' }, pergunta_preco: { type: 'boolean' },
      confianca: { type: 'number' },
    } },
};

export function validarInterpretacao(o) {
  if (!o || !INTENCOES.includes(o.intencao)) return null;
  const iso = (s) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : null);
  return {
    intencao: o.intencao,
    resort: typeof o.resort === 'string' && o.resort.trim() ? o.resort.trim() : null,
    situacao: o.situacao === 'pagando' || o.situacao === 'quitado' ? o.situacao : null,
    valor_aprox: typeof o.valor_aprox === 'string' && o.valor_aprox.trim() ? o.valor_aprox.trim() : null,
    horario_aceito_idx: Number.isInteger(o.horario_aceito_idx) && o.horario_aceito_idx >= 0 ? o.horario_aceito_idx : null,
    horario_proposto: iso(o.horario_proposto),
    pede_humano: !!o.pede_humano, pergunta_preco: !!o.pergunta_preco,
    confianca: Math.max(0, Math.min(1, Number(o.confianca) || 0)),
  };
}

export async function interpretar({ mensagem, estado, cfg }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { intencao: 'outro', confianca: 0, erro: 'sem_ANTHROPIC_API_KEY' };
  const { system, user } = montarPromptInterprete({ mensagem, estado, agoraISO: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T') + '-03:00' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: cfg.llm?.modelo || 'claude-sonnet-5', max_tokens: cfg.llm?.max_tokens || 700,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [{ ...TOOL_INTERPRETACAO, strict: true }],
        tool_choice: { type: 'tool', name: 'interpretacao' },
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json();
    if (!r.ok) return { intencao: 'outro', confianca: 0, erro: `anthropic_${r.status}:${JSON.stringify(j?.error || '').slice(0, 120)}` };
    const tu = (j.content || []).find((b) => b.type === 'tool_use');
    const v = validarInterpretacao(tu?.input);
    return v || { intencao: 'outro', confianca: 0, erro: 'parse' };
  } catch (e) { return { intencao: 'outro', confianca: 0, erro: e.message }; }
}

export async function transcrever({ url, cfg }) {
  try {
    const audio = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!audio.ok) return { erro: `download_${audio.status}` };
    const blob = await audio.blob();
    if (blob.size > 25 * 1024 * 1024) return { erro: 'muito_grande' };
    const groq = cfg.stt?.provedor !== 'openai' && process.env.GROQ_API_KEY;
    const endpoint = groq ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
    const key = groq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
    if (!key) return { erro: 'sem_chave_stt' };
    const fd = new FormData();
    fd.append('file', blob, 'audio.ogg');
    fd.append('model', cfg.stt?.modelo || (groq ? 'whisper-large-v3-turbo' : 'whisper-1'));
    fd.append('language', 'pt');
    const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    if (!r.ok) return { erro: `stt_${r.status}:${JSON.stringify(j?.error || '').slice(0, 120)}` };
    return { texto: (j.text || '').trim() };
  } catch (e) { return { erro: e.message }; }
}
```

- [ ] **Step 4: Rodar** — `npx vitest run src/utils/__tests__/agendaInterprete.test.js` → PASS; `npm test` → PASS.
Nota: `strict: true` na tool exige `additionalProperties:false` + required — já está. Se a API recusar o schema com `type: ['string','null']` em strict, trocar por `anyOf: [{type:'string'},{type:'null'}]` nos campos anuláveis e re-testar com uma chamada real na Task 15.

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/agendaInterprete.mjs client/src/utils/__tests__/agendaInterprete.test.js
git commit -m "feat(agenda-bot): intérprete IA (Anthropic tool-use estrito) + STT Groq/OpenAI"
```

---

### Task 6: Escrita no Google Calendar + `classifyEvent` p/ eventos da Ana + sync config-driven

**Files:**
- Modify: `client/netlify/functions/_lib/googleAgenda.mjs` (backup antes: `cp` p/ `backups/20260721_agenda_bot/`)
- Modify: `client/netlify/functions/agenda-videochamadas-sync.mjs` (backup antes)
- Test: `client/src/utils/__tests__/googleAgendaClassify.test.js`

**Interfaces:**
- Produces:
  - `freeBusy(emails, timeMinISO, timeMaxISO, accessToken)` → `{ email: [{start,end}] }`
  - `createEventComMeet({ calendarId, inicioISO, fimISO, titulo, descricao, leadId, telefone, accessToken })` → `{ eventId, meetLink }` (lança em erro)
  - `patchEventHorario({ calendarId, eventId, inicioISO, fimISO, accessToken })` → ok
  - `cancelEvent({ calendarId, eventId, accessToken })` → ok (DELETE; 404/410 tolerados)
  - `classifyEvent(ev, email)`: TAMBÉM aceita evento com `extendedProperties.private.cbc_origem` (sem convidado externo); linha ganha `lead_id`, `telefone`, `origem` (do extended) — sync grava nas colunas novas.
  - `agenda-videochamadas-sync`: lê `bot_config.agenda_bot.vendedoras` (ativas) e cai no export `VENDEDORAS` se config vazia.

- [ ] **Step 1: Teste do classifyEvent (falhando)** — `client/src/utils/__tests__/googleAgendaClassify.test.js`

```js
import { describe, it, expect } from 'vitest';
import { classifyEvent } from '../../../netlify/functions/_lib/googleAgenda.mjs';

const base = { id: 'ev1', status: 'confirmed', start: { dateTime: '2026-07-22T13:00:00-03:00' }, colorId: null };

describe('classifyEvent', () => {
  it('mantém: convidado externo + meet = atendimento', () => {
    const ev = { ...base, attendees: [{ email: 'cliente@gmail.com' }], hangoutLink: 'https://meet.google.com/x' };
    const r = classifyEvent(ev, 'v@advocaciacbc.com');
    expect(r).toMatchObject({ event_id: 'ev1', status: 'agendada', origem: 'manual' });
  });
  it('novo: evento da Ana SEM convidado, com extendedProperties', () => {
    const ev = { ...base, hangoutLink: 'https://meet.google.com/x',
      extendedProperties: { private: { cbc_origem: 'ana', cbc_lead_id: '123', cbc_telefone: '5511999998888' } } };
    const r = classifyEvent(ev, 'v@advocaciacbc.com');
    expect(r).toMatchObject({ origem: 'ana', lead_id: 123, telefone: '5511999998888', status: 'agendada' });
  });
  it('segue ignorando evento interno sem meet e sem marca da Ana', () => {
    expect(classifyEvent({ ...base, attendees: [{ email: 'x@advocaciacbc.com' }] }, 'v@advocaciacbc.com')).toBe(null);
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run src/utils/__tests__/googleAgendaClassify.test.js`

- [ ] **Step 3: Modificar `googleAgenda.mjs`** — (1) em `classifyEvent`, substituir o gate atual por:

```js
export function classifyEvent(ev, vendedoraEmail) {
  if (!ev || ev.status === 'cancelled') return null;
  const priv = ev.extendedProperties?.private || {};
  const daAna = priv.cbc_origem === 'ana';
  const externo = (ev.attendees || []).find((a) => a.email && !INTERNO.test(a.email) && !a.resource);
  const temMeet = !!(ev.hangoutLink || (ev.conferenceData && (ev.conferenceData.entryPoints || []).length));
  if (!daAna && (!externo || !temMeet)) return null; // regra antiga preservada p/ eventos manuais
  const scheduledAt = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
  return {
    event_id: ev.id, vendedora_email: vendedoraEmail,
    cliente_email: (externo?.email || '').toLowerCase() || null,
    cliente_nome: externo?.displayName || priv.cbc_nome || null,
    status: COR_STATUS[ev.colorId] || 'agendada', color_id: ev.colorId || null,
    scheduled_at: scheduledAt, tem_meet: temMeet,
    origem: daAna ? 'ana' : 'manual',
    lead_id: priv.cbc_lead_id ? Number(priv.cbc_lead_id) : null,
    telefone: priv.cbc_telefone || null,
    raw: { summary: ev.summary || null, htmlLink: ev.htmlLink || null, colorId: ev.colorId || null },
  };
}
```

(2) acrescentar no fim do arquivo:

```js
/** free/busy em lote. Retorna { email: [{start,end}] } (agendas com erro => []). */
export async function freeBusy(emails, timeMin, timeMax, accessToken) {
  const r = await fetch(`${CAL_URL.replace('/calendar/v3', '')}/calendar/v3/freeBusy`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, items: emails.map((id) => ({ id })) }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`freeBusy: ${j.error.message}`);
  const out = {};
  for (const e of emails) out[e] = j.calendars?.[e]?.errors ? [] : (j.calendars?.[e]?.busy || []);
  return out;
}

export async function createEventComMeet({ calendarId, inicioISO, fimISO, titulo, descricao, leadId, telefone, nome, accessToken }) {
  const r = await fetch(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: titulo, description: descricao,
      start: { dateTime: inicioISO, timeZone: 'America/Sao_Paulo' }, end: { dateTime: fimISO, timeZone: 'America/Sao_Paulo' },
      conferenceData: { createRequest: { requestId: `cbc-ana-${leadId}-${Date.parse(inicioISO)}` } },
      extendedProperties: { private: { cbc_origem: 'ana', cbc_lead_id: String(leadId || ''), cbc_telefone: telefone || '', cbc_nome: nome || '' } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`createEvent ${calendarId}: ${j.error.message}`);
  const meetLink = j.hangoutLink || j.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null;
  return { eventId: j.id, meetLink };
}

export async function patchEventHorario({ calendarId, eventId, inicioISO, fimISO, accessToken }) {
  const r = await fetch(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: { dateTime: inicioISO, timeZone: 'America/Sao_Paulo' }, end: { dateTime: fimISO, timeZone: 'America/Sao_Paulo' } }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`patchEvent: ${j.error.message}`);
}

export async function cancelEvent({ calendarId, eventId, accessToken }) {
  const r = await fetch(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000),
  });
  if (![200, 204, 404, 410].includes(r.status)) throw new Error(`cancelEvent HTTP ${r.status}`);
}
```

- [ ] **Step 4: Modificar `agenda-videochamadas-sync.mjs`** — trocar `for (const cal of VENDEDORAS)` por config-driven:

```js
import { getConfig } from './_lib/botDb.mjs';
// ... dentro do handler, antes do loop:
const cfgAll = await getConfig().catch(() => ({}));
const vendedorasCfg = (cfgAll.agenda_bot?.vendedoras || []).filter((v) => v.ativa).map((v) => v.email);
const agendas = vendedorasCfg.length ? vendedorasCfg : VENDEDORAS;
// loop: for (const cal of agendas) { ... }
```
E no RPC `agenda_videochamadas_upsert`: conferir se a RPC aceita os campos extras nas rows (`origem`, `lead_id`, `telefone`). Ver a definição no Supabase (`select prosrc from pg_proc where proname='agenda_videochamadas_upsert'`); se ela insere coluna a coluna, adicionar na migração da Task 1 um `create or replace` que inclua as novas colunas (manter assinatura `(p_chave, p_rows)`), preservando o sweep. Se ela faz `jsonb_populate_record`, nada a fazer.

- [ ] **Step 5: PASS + suíte** — `npx vitest run src/utils/__tests__/googleAgendaClassify.test.js && npm test` → PASS

- [ ] **Step 6: Commit**

```bash
git add client/netlify/functions/_lib/googleAgenda.mjs client/netlify/functions/agenda-videochamadas-sync.mjs client/src/utils/__tests__/googleAgendaClassify.test.js
git commit -m "feat(agenda-bot): escrita no Calendar (Meet+extendedProps), classifyEvent p/ eventos da Ana, sync config-driven"
```

---

### Task 7: `kommo-agenda-webhook.mjs` (despachante) 

**Files:**
- Create: `client/netlify/functions/kommo-agenda-webhook.mjs`

**Interfaces:**
- Consumes: env `AGENDA_WEBHOOK_SECRET` (Task 2 Step 6). Produces: POST interno p/ `agenda-bot-worker-background` com `{ contentType, raw }` (contrato idêntico ao do bot ADVBOX).

- [ ] **Step 1: Implementar** (clone adaptado de `kommo-advbox-webhook.mjs` — ler o original antes)

```js
/**
 * Netlify Function: kommo-agenda-webhook — bot Ana.
 * Recebe "Mensagem recebida" (add_message) do Kommo e despacha IMEDIATAMENTE
 * para a background function (Kommo exige resposta ~2s).
 * Webhook registrado na Task 2 com ?secret=<AGENDA_WEBHOOK_SECRET>.
 */
import { logAdvbox } from './_lib/botDb.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

export default async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });
  const SECRET = process.env.AGENDA_WEBHOOK_SECRET;
  if (SECRET) {
    let provided = req.headers.get('x-webhook-secret') || '';
    try { provided = provided || new URL(req.url).searchParams.get('secret') || ''; } catch { /* url invalida */ }
    if (provided !== SECRET) return new Response(JSON.stringify({ ok: true, ignored: 'auth' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  let raw = '';
  try { raw = await req.text(); } catch { /* corpo vazio */ }
  const contentType = req.headers.get('content-type') || '';
  try {
    await fetch(`${SELF_URL}/.netlify/functions/agenda-bot-worker-background`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, raw }),
    });
  } catch (e) {
    try { await logAdvbox('agenda', 'erro', `Falha ao despachar worker da Ana: ${e.message}`.slice(0, 300), { raw: String(raw).slice(0, 2000), contentType }); } catch { /* best-effort */ }
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

export const config = { path: '/.netlify/functions/kommo-agenda-webhook' };
```

- [ ] **Step 2: Commit**

```bash
git add client/netlify/functions/kommo-agenda-webhook.mjs
git commit -m "feat(agenda-bot): webhook despachante (add_message -> worker background)"
```

---

### Task 8: `agenda-bot-worker-background.mjs` (orquestrador)

**Files:**
- Create: `client/netlify/functions/agenda-bot-worker-background.mjs`

**Interfaces:**
- Consumes: `parsePayload` (copiar de `advbox-bot-worker-background.mjs` e ESTENDER p/ anexos), `getContact/extractPhones/firstLeadId/kommoGet/setLeadField/moveLeadStage/createKommoTask/postNote/runSalesbot` de `_lib/kommo.mjs`; `getConfig/db/findTesterByPhone/getConversation/upsertConversation/logMessage/logAdvbox` de `_lib/botDb.mjs`; `decidir/confirmar/estadoInicial/aplicarTemplate` do engine; `gerarSlots/sortearVendedora/slotMaisProximo` de slots; `interpretar/transcrever` do intérprete; `getAccessToken/freeBusy/createEventComMeet/patchEventHorario/cancelEvent` de googleAgenda; RPC `agenda_videochamadas_upsert`.
- Produces: resposta da Ana no lead (campo `campo_ana_id` + `runSalesbot(salesbot_id, leadId, 'leads')`), evento no Calendar, linha em `agenda_videochamadas` (origem 'ana'), moves/tarefas/notas no Kommo, estado em `bot_conversations`.

- [ ] **Step 1: Implementar o worker** (arquivo completo; ~250 linhas; seguir este esqueleto À RISCA)

```js
/**
 * Worker background do bot Ana (ate 15 min). Fluxo por mensagem recebida:
 * parse -> contato/telefone/lead -> filtros (ativo, teste, gatilho, pausa, humano)
 * -> transcreve audio -> interpreta (LLM) -> engine.decidir -> executa acoes -> persiste estado.
 */
import { getConfig, db, findTesterByPhone, getConversation, upsertConversation, logMessage, logAdvbox } from './_lib/botDb.mjs';
import { getContact, extractPhones, firstLeadId, kommoGet, setLeadField, moveLeadStage, createKommoTask, postNote, runSalesbot } from './_lib/kommo.mjs';
import { decidir, confirmar, estadoInicial, aplicarTemplate } from './_lib/agendaEngine.mjs';
import { gerarSlots, sortearVendedora, slotMaisProximo } from './_lib/agendaSlots.mjs';
import { interpretar, transcrever } from './_lib/agendaInterprete.mjs';
import { getAccessToken, freeBusy, createEventComMeet, cancelEvent } from './_lib/googleAgenda.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

// parse identico ao advbox-bot-worker + anexo (Kommo manda attachment em message[add][0][attachment][...])
function parsePayload(contentType, raw) {
  try {
    if ((contentType || '').includes('application/json')) {
      const j = JSON.parse(raw); const m = j?.message?.add?.[0] || {};
      return { text: m.text || '', contactId: m.contact_id || m.contactId || null, type: m.type || m.origin || '',
        msgId: m.id || null, anexoLink: m.attachment?.link || null, anexoTipo: m.attachment?.type || null };
    }
  } catch { /* cai no form-encoded */ }
  const params = new URLSearchParams(raw);
  const get = (k) => params.get(`message[add][0][${k}]`) || '';
  return { text: get('text'), contactId: get('contact_id') || get('element_id') || null, type: get('type'),
    msgId: get('id') || null, anexoLink: get('attachment[link]') || null, anexoTipo: get('attachment[type]') || null };
}

// dedupe (padrao bot ADVBOX: tabela bot_processed_messages, pk message_id text)
async function jaProcessada(msgId) {
  if (!msgId) return false;
  const { error } = await db.from('bot_processed_messages').insert({ message_id: `agenda:${msgId}` });
  return !!error; // conflito = ja processada
}

async function leadNoGatilho(leadId, cfg) {
  const lead = await kommoGet(`/leads/${leadId}`);
  if (!lead) return { ok: false };
  for (const g of cfg.gatilhos || []) {
    if (lead.pipeline_id !== g.pipeline_id) continue;
    if (g.status_ids === 'todas' || (Array.isArray(g.status_ids) && g.status_ids.includes(lead.status_id))) {
      return { ok: true, lead };
    }
  }
  return { ok: false, lead };
}

// humano respondeu manualmente depois da ultima fala da Ana? (spec: eventos outgoing por CONTATO)
async function humanoAssumiu(contactId, ultimaFalaAnaISO) {
  if (!contactId || !ultimaFalaAnaISO) return false;
  const r = await kommoGet(`/events?filter[type]=outgoing_chat_message&filter[entity]=contact&filter[entity_id][]=${contactId}&limit=5`);
  const eventos = r?._embedded?.events || [];
  const margemSeg = 90; // fala da propria Ana via salesbot tambem gera outgoing — ignora eventos ate 90s apos nossa fala
  return eventos.some((ev) => ev.created_at * 1000 > new Date(ultimaFalaAnaISO).getTime() + margemSeg * 1000);
}

async function falar(leadId, mensagem, cfg) {
  await setLeadField(leadId, cfg.kommo.campo_ana_id, mensagem);
  await runSalesbot(cfg.kommo.salesbot_id, leadId, 'leads');
}

async function upsertVC(row) {
  const { error } = await db.rpc('agenda_videochamadas_upsert', { p_chave: RPC_SECRET, p_rows: [row] });
  if (error) throw new Error(`upsert vc: ${error.message}`);
}

async function montarSlots(cfg, agora, desejadoISO = null) {
  const at = await getAccessToken();
  const emails = cfg.vendedoras.filter((v) => v.ativa).map((v) => v.email);
  const fim = new Date(agora.getTime() + (cfg.regras.horizonte_dias_uteis + 4) * 864e5);
  const busy = await freeBusy(emails, agora.toISOString(), fim.toISOString(), at);
  let slots = gerarSlots({ regras: cfg.regras, busyPorVendedora: busy, agora, limite: 12 });
  if (desejadoISO) { const s = slotMaisProximo(slots, desejadoISO); slots = s ? [s, ...slots.filter((x) => x !== s)] : slots; }
  return { slots, at };
}

export default async (req) => {
  const t0 = Date.now();
  try {
    const { contentType, raw } = await req.json();
    const msg = parsePayload(contentType, raw);
    const cfgAll = await getConfig();
    const cfg = cfgAll.agenda_bot;
    if (!cfg?.ativo) return new Response('inativo', { status: 200 });
    if (!msg.contactId) return new Response('sem contato', { status: 200 });
    if (await jaProcessada(msg.msgId)) return new Response('dupe', { status: 200 });

    const contato = await getContact(msg.contactId);
    const phones = extractPhones(contato);
    const fone = (phones[0] || '').replace(/\D/g, '');
    if (!fone) return new Response('sem fone', { status: 200 });

    if (cfg.modo_teste) {
      let tester = null;
      for (const ph of phones) { tester = await findTesterByPhone(ph); if (tester) break; }
      if (!tester) return new Response('nao testador', { status: 200 });
    }

    const leadId = firstLeadId(contato);
    if (!leadId) return new Response('sem lead', { status: 200 });
    const g = await leadNoGatilho(leadId, cfg);
    if (!g.ok) return new Response('fora do gatilho', { status: 200 });

    // estado
    const channel = `agenda:${fone}`;
    const conv = await getConversation(channel);
    let estado = conv?.context?.etapa ? conv.context
      : estadoInicial({ lead_id: leadId, contact_id: Number(msg.contactId), nome: contato?.name || '', origem: g.lead.pipeline_id === 13760367 ? 'venda' : 'disparo' });

    if (estado.pausada_ate && new Date(estado.pausada_ate) > new Date()) return new Response('pausada', { status: 200 });
    const ultimaFala = conv?.context?.ultima_fala_ana || null;
    if (await humanoAssumiu(msg.contactId, ultimaFala)) {
      estado.pausada_ate = new Date(Date.now() + (cfg.regras.silencio_humano_horas || 24) * 36e5).toISOString();
      await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado });
      await postNote(leadId, `CBC.agenda.pausa:${Date.now()}`, 'Ana pausada: atendente humano respondeu nesta conversa.');
      return new Response('humano assumiu', { status: 200 });
    }

    // texto da mensagem (audio -> STT)
    let texto = msg.text || '';
    if (!texto && msg.anexoLink && ['voice', 'audio', 'ptt'].includes(String(msg.anexoTipo))) {
      const t = await transcrever({ url: msg.anexoLink, cfg });
      if (t.texto) texto = t.texto;
      else { await falar(leadId, cfg.mensagens.pede_texto, cfg); await logAdvbox('agenda', 'aviso', `STT falhou: ${t.erro}`, { leadId }); return new Response('stt falhou', { status: 200 }); }
    }
    if (!texto) return new Response('sem texto', { status: 200 });
    const convId = (await upsertConversation(channel, { customer_id: leadId, customer_name: estado.nome, context: estado })).id;
    await logMessage(convId, 'in', texto, null, { msgId: msg.msgId, anexo: msg.anexoTipo || null });

    // interpreta + decide (com ate 1 re-entrada por buscar_slots)
    const agora = new Date();
    const interp = estado.etapa === 'abertura' ? { intencao: 'saudacao', confianca: 1 } : await interpretar({ mensagem: texto, estado, cfg });
    let r = decidir({ estado, interp, cfg, agora });
    let slotsCtx = null;
    if (r.acoes.some((a) => a.tipo === 'buscar_slots')) {
      const desejado = r.acoes.find((a) => a.tipo === 'buscar_slots')?.desejado || null;
      slotsCtx = await montarSlots(cfg, agora, desejado);
      r = decidir({ estado, interp, cfg, agora, slotsDisponiveis: slotsCtx.slots });
    }
    let estadoFinal = r.novoEstado;

    for (const acao of r.acoes) {
      if (acao.tipo === 'responder') {
        await falar(leadId, acao.mensagem, cfg);
        estadoFinal.ultima_fala_ana = new Date().toISOString();
        await logMessage(convId, 'out', acao.mensagem, interp.intencao, {});
      } else if (acao.tipo === 'salvar_campos') {
        if (acao.campos.investimento) await setLeadField(leadId, cfg.kommo.campo_investimento_id, acao.campos.investimento);
        if (acao.campos.preferencia) await setLeadField(leadId, cfg.kommo.campo_preferencia_id, acao.campos.preferencia);
      } else if (acao.tipo === 'agendar' || acao.tipo === 'reagendar') {
        const slot = estadoFinal.slots_ofertados[acao.slotIdx];
        const { slots, at } = slotsCtx || await montarSlots(cfg, agora);
        // revalida o slot (concorrencia): confere se ainda ha vendedora livre
        const aindaLivre = slots.find((s) => new Date(s.inicio).getTime() === new Date(slot.inicio).getTime());
        if (!aindaLivre) {
          const dois = slots.slice(0, cfg.regras.slots_por_oferta);
          estadoFinal.slots_ofertados = dois.map((x) => ({ inicio: new Date(x.inicio).toISOString(), vendedoras: x.vendedoras }));
          const vars = Object.fromEntries(dois.map((s, i) => [`slot${i + 1}`, (await import('./_lib/agendaSlots.mjs')).formatarSlot(new Date(s.inicio), agora)]));
          await falar(leadId, aplicarTemplate(cfg.mensagens.slot_ocupado, vars), cfg);
          estadoFinal.ultima_fala_ana = new Date().toISOString();
          break;
        }
        const vend = sortearVendedora(cfg.vendedoras, aindaLivre.vendedoras, String(leadId));
        const ini = new Date(slot.inicio);
        const fim = new Date(ini.getTime() + cfg.regras.duracao_evento_min * 60000);
        if (acao.tipo === 'reagendar' && estadoFinal.agendamento?.event_id) {
          await cancelEvent({ calendarId: estadoFinal.agendamento.vendedora, eventId: estadoFinal.agendamento.event_id, accessToken: at }).catch(() => {});
        }
        const { eventId, meetLink } = await createEventComMeet({ calendarId: vend, inicioISO: ini.toISOString(), fimISO: fim.toISOString(),
          titulo: `Videochamada — ${estadoFinal.nome || fone} (CBC/Ana)`,
          descricao: `Lead: https://advocaciacbc.kommo.com/leads/detail/${leadId}\nTelefone: ${fone}\nResort: ${estadoFinal.dados.resort || '?'} | Situação: ${estadoFinal.dados.situacao || '?'} | Já pagou: ${estadoFinal.dados.valor_aprox || '?'}`,
          leadId, telefone: fone, nome: estadoFinal.nome, accessToken: at });
        const c = confirmar({ estado: estadoFinal, slot: aindaLivre, agora, cfg, eventId, meetLink, vendedora: vend });
        estadoFinal = c.novoEstado;
        await falar(leadId, c.mensagem, cfg);
        estadoFinal.ultima_fala_ana = new Date().toISOString();
        await logMessage(convId, 'out', c.mensagem, 'confirmado', { eventId });
        await upsertVC({ event_id: eventId, vendedora_email: vend, cliente_email: null, cliente_nome: estadoFinal.nome || null,
          status: 'agendada', color_id: null, scheduled_at: ini.toISOString(), tem_meet: true, source: 'live',
          origem: 'ana', lead_id: leadId, telefone: fone, raw: {} });
        const vendCfg = cfg.vendedoras.find((v) => v.email === vend);
        await moveLeadStage(leadId, { pipelineId: cfg.kommo.etapa_agendado.pipeline_id, statusId: cfg.kommo.etapa_agendado.status_id });
        if (vendCfg?.user_id) await createKommoTask(leadId, 'leads', `Videochamada (Ana): ${ini.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — Meet: ${meetLink}`, Math.max(1, (ini - Date.now()) / 36e5), vendCfg.user_id);
      } else if (acao.tipo === 'handoff') {
        await createKommoTask(leadId, 'leads', `Ana pediu apoio humano (${acao.motivo}). Ver conversa e assumir.`, 1, null);
        await postNote(leadId, `CBC.agenda.handoff:${Date.now()}`, `Ana → humano. Motivo: ${acao.motivo}. Dados: ${JSON.stringify(estadoFinal.dados)}`);
      } else if (acao.tipo === 'nota') {
        await postNote(leadId, `CBC.agenda.nota:${Date.now()}`, acao.texto);
      }
    }

    await upsertConversation(channel, { customer_id: leadId, customer_name: estadoFinal.nome, context: estadoFinal });
    await logAdvbox('agenda', 'info', `Ana ${estado.etapa}→${estadoFinal.etapa} lead ${leadId} (${Date.now() - t0}ms)`, { interp: interp.intencao, conf: interp.confianca });
    return new Response('ok', { status: 200 });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `worker Ana: ${e.message}`.slice(0, 300), { stack: (e.stack || '').slice(0, 500) }).catch(() => {});
    return new Response('erro', { status: 200 });
  }
};
```

Ajustes obrigatórios ao implementar (não são opcionais):
1. Conferir a assinatura REAL de `upsertConversation` em `botDb.mjs` (retorna a linha? senão buscar `getConversation` de novo p/ obter `id`).
2. Conferir `createKommoTask(entityId, entityType, text, hoursFromNow, responsibleUserId)` — usar EXATAMENTE a assinatura de `_lib/kommo.mjs`.
3. O `import` dinâmico de `formatarSlot` no meio do loop é feio — importar no topo junto com os demais e remover o dinâmico.
4. `bot_processed_messages`: conferir nome da PK no `supabase_bot_advbox.sql` (se for `hash`/outro, adaptar `jaProcessada`).
5. `msg.anexoLink` NÃO validado ainda — na Task 15 (piloto) capturar um webhook real de áudio e ajustar os nomes dos campos do attachment se necessário (log do raw já vai p/ `advbox_api_log` no erro).

- [ ] **Step 2: Suíte inteira** — `cd client && npm test` → PASS (worker não tem teste unitário próprio; a lógica está nas libs puras já testadas).

- [ ] **Step 3: Commit**

```bash
git add client/netlify/functions/agenda-bot-worker-background.mjs
git commit -m "feat(agenda-bot): worker orquestrador — filtros, pausa por humano, STT, LLM, engine, Calendar, Kommo"
```

---

### Task 9: `agenda-bot-cron.mjs` (lembretes, no-show, janela/templates)

**Files:**
- Create: `client/netlify/functions/agenda-bot-cron.mjs`

**Interfaces:**
- Consumes: `vw`? NÃO — cron lê `agenda_videochamadas` direto via `db` (mesma anon/service do botDb; a RLS fechada de `agenda_videochamadas`… **ATENÇÃO**: se a leitura falhar por RLS com anon, criar na migração (Task 1, re-aplicar delta) uma RPC `agenda_bot_pendencias(p_chave text)` SECURITY DEFINER que devolve as linhas de origem 'ana' com lembrete pendente — o cron usa a RPC com `BOT_RPC_SECRET`. Implementar JÁ com a RPC (mais seguro):

Adicionar ao `supabase_agenda_bot.sql` (e aplicar como `agenda_bot_v1_1`):

```sql
create or replace function agenda_bot_pendencias(p_chave text)
returns setof agenda_videochamadas language sql security definer set search_path = public as $$
  select * from agenda_videochamadas
  where p_chave = current_setting('app.bot_rpc_secret', true) is not distinct from null -- placeholder, ver nota
$$;
```
**NOTA**: o projeto valida `p_chave` comparando com o secret gravado — seguir o padrão EXATO das RPCs existentes (`agenda_videochamadas_upsert` valida como? ler `select prosrc from pg_proc where proname='agenda_videochamadas_upsert'` e copiar o mecanismo de validação da chave). Corpo real:

```sql
create or replace function agenda_bot_pendencias(p_chave text)
returns setof agenda_videochamadas language plpgsql security definer set search_path = public as $$
begin
  if not bot_rpc_chave_ok(p_chave) then raise exception 'chave invalida'; end if; -- usar o MESMO helper/if das RPCs vizinhas
  return query select * from agenda_videochamadas
    where origem = 'ana' and status = 'agendada'
      and scheduled_at between now() - interval '30 minutes' and now() + interval '75 minutes';
end $$;
```
E `agenda_bot_marcar(p_chave text, p_event_id text, p_campo text)` (seta `lembrete_1h_em`/`lembrete_t0_em`/`noshow_msg_em` = now(); validar `p_campo` numa whitelist).

- [ ] **Step 1: Aplicar delta SQL** (RPCs acima, via `mcp__supabase-cbc__apply_migration`, name `agenda_bot_v1_1`) e commitar o `.sql` atualizado.

- [ ] **Step 2: Implementar o cron**

```js
/**
 * Cron do bot Ana (*\/5): p/ cada videochamada 'agendada' de origem 'ana':
 *  - T-60..T-45 e lembrete_1h_em null  -> lembrete 1h
 *  - T-2..T+5  e lembrete_t0_em null   -> link do Meet
 *  - T+10..T+30 e noshow_msg_em null e cor ainda 'agendada' -> mensagem de no-show + oferta
 * Janela Meta: dentro -> fala normal (campo+salesbot); fora -> template WABA (salesbot_template_id) ou tarefa.
 */
import { getConfig, db, logAdvbox, getConversation, upsertConversation } from './_lib/botDb.mjs';
import { setLeadField, runSalesbot, createKommoTask, postNote, kommoGet } from './_lib/kommo.mjs';
import { aplicarTemplate } from './_lib/agendaEngine.mjs';
import { formatarSlot, gerarSlots } from './_lib/agendaSlots.mjs';
import { getAccessToken, freeBusy } from './_lib/googleAgenda.mjs';
import { janelaAberta } from './_lib/assinaturaWhatsapp.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

async function ultimaMsgRecebidaISO(contactId, leadId) {
  const caminhos = [];
  if (contactId) caminhos.push(`/events?filter[type]=incoming_chat_message&filter[entity]=contact&filter[entity_id][]=${contactId}&limit=1`);
  caminhos.push(`/events?filter[type]=incoming_chat_message&filter[entity]=lead&filter[entity_id][]=${leadId}&limit=1`);
  for (const c of caminhos) {
    const r = await kommoGet(c); const ev = r?._embedded?.events?.[0];
    if (ev?.created_at) return new Date(ev.created_at * 1000).toISOString();
  }
  return null;
}

async function enviar({ vc, mensagem, template, cfg, estado }) {
  const contactId = estado?.contact_id || null;
  const last = await ultimaMsgRecebidaISO(contactId, vc.lead_id);
  const dentro = last && janelaAberta(last, new Date().toISOString(), cfg.regras.janela_margem_min ?? 60);
  if (dentro) {
    await setLeadField(vc.lead_id, cfg.kommo.campo_ana_id, mensagem);
    await runSalesbot(cfg.kommo.salesbot_id, vc.lead_id, 'leads');
    return 'normal';
  }
  if (cfg.kommo.salesbot_template_id) { // bot com bloco de template WABA (Task 2 Step 5)
    await setLeadField(vc.lead_id, cfg.kommo.campo_ana_id, mensagem); // template usa variaveis proprias; campo fica de registro
    await runSalesbot(cfg.kommo.salesbot_template_id, vc.lead_id, 'leads');
    return 'template';
  }
  await postNote(vc.lead_id, `CBC.agenda.manual:${vc.event_id}:${template}`, `Fora da janela e sem template: enviar manualmente — ${mensagem}`);
  await createKommoTask(vc.lead_id, 'leads', `Enviar manualmente (Ana, fora da janela): ${mensagem}`, 1, null);
  return 'tarefa';
}

export default async () => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const cfg = (await getConfig()).agenda_bot;
    if (!cfg?.ativo) return json({ ok: true, skip: 'inativo' });
    const { data: pend, error } = await db.rpc('agenda_bot_pendencias', { p_chave: RPC_SECRET });
    if (error) throw new Error(error.message);
    const agora = Date.now();
    let n = { lembrete1h: 0, t0: 0, noshow: 0 };
    for (const vc of pend || []) {
      const t = new Date(vc.scheduled_at).getTime();
      const min = (t - agora) / 60000;
      const canal = `agenda:${(vc.telefone || '').replace(/\D/g, '')}`;
      const conv = await getConversation(canal); const estado = conv?.context || null;
      const marcar = (campo) => db.rpc('agenda_bot_marcar', { p_chave: RPC_SECRET, p_event_id: vc.event_id, p_campo: campo });

      if (min <= 60 && min > 40 && !vc.lembrete_1h_em) {
        const hora = formatarSlot(new Date(vc.scheduled_at), new Date()).split(' às ')[1] || '';
        await enviar({ vc, cfg, estado, template: 'ana_lembrete_1h', mensagem: aplicarTemplate(cfg.mensagens.lembrete_1h, { hora }) });
        await marcar('lembrete_1h_em'); n.lembrete1h++;
      } else if (min <= 2 && min > -5 && !vc.lembrete_t0_em) {
        const link = estado?.agendamento?.meet_link || '';
        await enviar({ vc, cfg, estado, template: 'ana_link_meet', mensagem: aplicarTemplate(cfg.mensagens.lembrete_t0, { link }) });
        await marcar('lembrete_t0_em'); n.t0++;
      } else if (min <= -10 && min > -30 && !vc.noshow_msg_em && vc.status === 'agendada') {
        // oferta de reagendamento com slots reais
        const at = await getAccessToken();
        const emails = cfg.vendedoras.filter((v) => v.ativa).map((v) => v.email);
        const busy = await freeBusy(emails, new Date().toISOString(), new Date(agora + 6 * 864e5).toISOString(), at);
        const slots = gerarSlots({ regras: cfg.regras, busyPorVendedora: busy, agora: new Date(), limite: 2 });
        const vars = Object.fromEntries(slots.map((s, i) => [`slot${i + 1}`, formatarSlot(new Date(s.inicio), new Date())]));
        await enviar({ vc, cfg, estado, template: 'ana_reagendar', mensagem: aplicarTemplate(cfg.mensagens.noshow, vars) });
        if (estado) {
          estado.etapa = 'pos_noshow';
          estado.slots_ofertados = slots.map((s) => ({ inicio: new Date(s.inicio).toISOString(), vendedoras: s.vendedoras }));
          await upsertConversation(canal, { context: estado });
        }
        await marcar('noshow_msg_em'); n.noshow++;
      }
    }
    if (n.lembrete1h + n.t0 + n.noshow) await logAdvbox('agenda', 'info', `cron Ana: 1h=${n.lembrete1h} t0=${n.t0} noshow=${n.noshow}`, n);
    return json({ ok: true, ...n, pendentes: (pend || []).length });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `cron Ana: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = { schedule: '*/5 * * * *' };
```

- [ ] **Step 3: `npm test`** → PASS. **Step 4: Commit**

```bash
git add supabase_agenda_bot.sql client/netlify/functions/agenda-bot-cron.mjs
git commit -m "feat(agenda-bot): cron de lembretes/no-show com janela Meta e templates WABA"
```

---

### Task 10: `agenda-admin.mjs` (ações server da aba, JWT)

**Files:**
- Create: `client/netlify/functions/agenda-admin.mjs`

**Interfaces:**
- Consumes: padrão de auth do `meta-trafego-action.mjs` (LER o arquivo: valida JWT do Supabase via `db.auth.getUser(token)` do header `Authorization: Bearer`); libs google/kommo/botDb.
- Produces (POST JSON `{ acao, ... }`): `reagendar {event_id, novo_inicio}` (patch no Calendar + upsert vc + mensagem ao lead via campo+salesbot), `cancelar {event_id, motivo}` (cancel + status 'excluida' + etapa perdido opcional), `desfecho {event_id, status}` (status ∈ realizada|no_show|fechou → PATCH `colorId` no evento: 10|11|7 — o sync espelha), `simular {mensagem, estado}` (roda interpretar+decidir SEM tocar Kommo/Google — retorna `{interp, acoes, novoEstado}` p/ o Simulador da aba), `pausar_lead {lead_id, horas}`.

- [ ] **Step 1: Implementar** (seguir o esqueleto de auth de `meta-trafego-action.mjs` VERBATIM na parte do JWT; depois `switch (acao)` com os 5 casos usando `patchEventHorario/cancelEvent/getAccessToken`, `db.rpc('agenda_videochamadas_upsert'|'agenda_bot_marcar')`, `setLeadField/runSalesbot`, e p/ `simular`: `interpretar` + `decidir` com `slotsDisponiveis` fake `[{inicio: amanhã 10h, vendedoras:[1ª ativa]}]`).
- [ ] **Step 2: `npm test`** → PASS. **Step 3: Commit** — `git add client/netlify/functions/agenda-admin.mjs && git commit -m "feat(agenda-bot): agenda-admin — reagendar/cancelar/desfecho/simular/pausar com JWT"`

---

### Task 11: `components/agenda/compute.js` (métricas puras) + testes

**Files:**
- Create: `client/src/components/agenda/compute.js`
- Test: `client/src/utils/__tests__/agendaCompute.test.js`

**Interfaces:**
- Consumes: retorno da RPC `agenda_bot_metricas` (Task 1) + linhas de `vw_agenda_painel`.
- Produces: `computeFunilAna(metricas)` → `{ etapas: [{ chave, rotulo, n, pctDoAnterior }], taxas: { agendamento, comparecimento, fechamento }, tempoRespostaSeg }`; `agruparAgenda(linhas, agoraISO)` → `{ hoje: [], amanha: [], semana: [], passadas: [] }` (ordenadas por `scheduled_at`).

- [ ] **Step 1: Teste (falhando)** — `client/src/utils/__tests__/agendaCompute.test.js`

```js
import { describe, it, expect } from 'vitest';
import { computeFunilAna, agruparAgenda } from '../../components/agenda/compute.js';

describe('computeFunilAna', () => {
  it('monta etapas com % sobre a anterior e taxas', () => {
    const r = computeFunilAna({ conversas_iniciadas: 100, qualificadas: 60, oferta_feita: 50,
      agendadas: 30, realizadas: 18, no_show: 6, fechou: 9, handoffs: 10, tempo_resposta_med_seg: 42,
      por_vendedora: { 'a@x.com': 20, 'b@x.com': 10 } });
    expect(r.etapas.map((e) => e.n)).toEqual([100, 60, 50, 30, 18]);
    expect(r.etapas[3].pctDoAnterior).toBe(60); // 30/50
    expect(r.taxas.agendamento).toBe(30);        // 30/100
    expect(r.taxas.comparecimento).toBe(75);     // (18+... ) realizadas+fechou? NÃO: realizadas já inclui fechou na RPC? Não — ver regra abaixo
    expect(r.tempoRespostaSeg).toBe(42);
  });
});
// REGRA (fixa aqui p/ evitar ambiguidade): comparecimento = realizadas / (realizadas + no_show) * 100
// (na RPC, 'realizadas' já conta status realizada+fechou; 'fechou' é subconjunto p/ taxa de fechamento = fechou/realizadas)

describe('agruparAgenda', () => {
  it('separa hoje/amanhã/semana/passadas no fuso SP', () => {
    const agora = '2026-07-21T12:00:00-03:00';
    const g = agruparAgenda([
      { event_id: '1', scheduled_at: '2026-07-21T18:00:00-03:00', status: 'agendada' },
      { event_id: '2', scheduled_at: '2026-07-22T09:00:00-03:00', status: 'agendada' },
      { event_id: '3', scheduled_at: '2026-07-24T09:00:00-03:00', status: 'agendada' },
      { event_id: '4', scheduled_at: '2026-07-20T09:00:00-03:00', status: 'no_show' },
    ], agora);
    expect(g.hoje.map((x) => x.event_id)).toEqual(['1']);
    expect(g.amanha.map((x) => x.event_id)).toEqual(['2']);
    expect(g.semana.map((x) => x.event_id)).toEqual(['3']);
    expect(g.passadas.map((x) => x.event_id)).toEqual(['4']);
  });
});
```

- [ ] **Step 2: FAIL** → **Step 3: Implementar** `client/src/components/agenda/compute.js`

```js
// Métricas do funil da Ana — PURO (testado). Regras de taxa fixadas no teste.
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function computeFunilAna(m = {}) {
  const etapas = [
    { chave: 'iniciadas', rotulo: 'Conversas', n: m.conversas_iniciadas || 0 },
    { chave: 'qualificadas', rotulo: 'Qualificadas', n: m.qualificadas || 0 },
    { chave: 'oferta', rotulo: 'Oferta feita', n: m.oferta_feita || 0 },
    { chave: 'agendadas', rotulo: 'Agendadas', n: m.agendadas || 0 },
    { chave: 'realizadas', rotulo: 'Realizadas', n: m.realizadas || 0 },
  ].map((e, i, arr) => ({ ...e, pctDoAnterior: i ? pct(e.n, arr[i - 1].n) : 100 }));
  return {
    etapas,
    taxas: {
      agendamento: pct(m.agendadas || 0, m.conversas_iniciadas || 0),
      comparecimento: pct(m.realizadas || 0, (m.realizadas || 0) + (m.no_show || 0)),
      fechamento: pct(m.fechou || 0, m.realizadas || 0),
    },
    handoffs: m.handoffs || 0,
    porVendedora: m.por_vendedora || {},
    tempoRespostaSeg: Math.round(m.tempo_resposta_med_seg || 0),
  };
}

const ymdSP = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export function agruparAgenda(linhas = [], agoraISO) {
  const hoje = ymdSP(agoraISO);
  const amanha = ymdSP(new Date(new Date(agoraISO).getTime() + 864e5));
  const g = { hoje: [], amanha: [], semana: [], passadas: [] };
  for (const l of [...linhas].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))) {
    const d = ymdSP(l.scheduled_at);
    if (new Date(l.scheduled_at) < new Date(agoraISO) && d !== hoje) g.passadas.push(l);
    else if (d === hoje) g.hoje.push(l);
    else if (d === amanha) g.amanha.push(l);
    else g.semana.push(l);
  }
  g.passadas.reverse();
  return g;
}
```

- [ ] **Step 4: PASS + suíte** → **Step 5: Commit** — `git add client/src/components/agenda/compute.js client/src/utils/__tests__/agendaCompute.test.js && git commit -m "feat(agenda-bot): compute puro das métricas do funil da Ana (TDD)"`

---

### Task 12: Aba React — `AgendaPanel.jsx` + `ConfigForms.jsx` + `AgendaViews.jsx`

**Files:**
- Create: `client/src/components/AgendaPanel.jsx`, `client/src/components/agenda/ConfigForms.jsx`, `client/src/components/agenda/AgendaViews.jsx`

**Interfaces:**
- Consumes: `supabase` de `../lib/supabase` (client autenticado do app); `bot_config` (policy allow-all → ler/gravar direto, padrão BotAdvboxPanel); RPC `agenda_bot_metricas`; view `vw_agenda_painel`; function `/.netlify/functions/agenda-admin` (JWT: `supabase.auth.getSession()` → `Authorization: Bearer <access_token>`); `computeFunilAna/agruparAgenda`.
- Produces: componente default export `AgendaPanel` (usado pela Task 13). Sub-abas: `metricas` (default) | `agenda` | `conversas` | `simulador` | `mensagens` | `regras` | `vendedoras` | `config`.

Diretrizes visuais (obrigatórias): tokens `--cbc-*` (nunca hex inline — regra do Dashboard 2.0), dark-mode ok, mobile: sub-abas roláveis (`overflow-x-auto`); seguir a estética do `BotAdvboxPanel.jsx`/`TrafegoPanel.jsx` (LER ambos antes).

- [ ] **Step 1: `AgendaPanel.jsx`** — shell + carregamento

```jsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ConfigMensagens, ConfigRegras, ConfigVendedoras, ConfigGeral } from './agenda/ConfigForms';
import { MetricasView, AgendaView, ConversasView, SimuladorView } from './agenda/AgendaViews';

const SUBS = [
  ['metricas', 'Métricas'], ['agenda', 'Agenda'], ['conversas', 'Conversas'], ['simulador', 'Simulador'],
  ['mensagens', 'Mensagens'], ['regras', 'Regras'], ['vendedoras', 'Vendedoras'], ['config', 'Config'],
];

export default function AgendaPanel() {
  const [sub, setSub] = useState('metricas');
  const [cfg, setCfg] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('bot_config').select('value').eq('key', 'agenda_bot').single();
    if (error) setErro(error.message); else setCfg(data.value);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvarCfg = useCallback(async (novo) => {
    setSalvando(true);
    const { error } = await supabase.from('bot_config')
      .update({ value: novo, updated_at: new Date().toISOString() }).eq('key', 'agenda_bot');
    setSalvando(false);
    if (error) { setErro(error.message); return false; }
    setCfg(novo); return true;
  }, []);

  const chamarAdmin = useCallback(async (body) => {
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch('/.netlify/functions/agenda-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.session?.access_token || ''}` },
      body: JSON.stringify(body),
    });
    return r.json();
  }, []);

  if (erro) return <div className="p-6" style={{ color: 'var(--cbc-danger)' }}>Erro: {erro}</div>;
  if (!cfg) return <div className="p-6" style={{ color: 'var(--cbc-text-muted)' }}>Carregando…</div>;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6" style={{ color: 'var(--cbc-text)' }}>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold">Agendamento Videochamada — Ana</h1>
        <span className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: cfg.ativo ? 'var(--cbc-success)' : 'var(--cbc-warning)', color: 'var(--cbc-bg)' }}>
          {cfg.ativo ? (cfg.modo_teste ? 'ATIVA (modo teste)' : 'ATIVA') : 'DESLIGADA'}
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto mb-4 border-b" style={{ borderColor: 'var(--cbc-border)' }}>
        {SUBS.map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`px-3 py-2 text-sm whitespace-nowrap ${sub === k ? 'font-semibold border-b-2' : ''}`}
            style={sub === k ? { borderColor: 'var(--cbc-primary)' } : {}}>{label}</button>
        ))}
      </div>
      {sub === 'metricas' && <MetricasView />}
      {sub === 'agenda' && <AgendaView chamarAdmin={chamarAdmin} />}
      {sub === 'conversas' && <ConversasView chamarAdmin={chamarAdmin} />}
      {sub === 'simulador' && <SimuladorView chamarAdmin={chamarAdmin} cfg={cfg} />}
      {sub === 'mensagens' && <ConfigMensagens cfg={cfg} salvar={salvarCfg} salvando={salvando} />}
      {sub === 'regras' && <ConfigRegras cfg={cfg} salvar={salvarCfg} salvando={salvando} />}
      {sub === 'vendedoras' && <ConfigVendedoras cfg={cfg} salvar={salvarCfg} salvando={salvando} />}
      {sub === 'config' && <ConfigGeral cfg={cfg} salvar={salvarCfg} salvando={salvando} />}
    </div>
  );
}
```

- [ ] **Step 2: `agenda/ConfigForms.jsx`** — 4 forms controlados. Padrões: cada form clona `cfg`, edita a sub-árvore, botão "Salvar" chama `salvar(novo)`; inputs com `className` neutra + tokens. Conteúdo mínimo COMPLETO:
  - `ConfigMensagens`: um `<textarea rows={3}>` por chave de `cfg.mensagens` (label = chave; hint das variáveis `{{slot1}} {{slot2}} {{dia}} {{hora}} {{link}}`), botão "Restaurar padrão" por campo (guarda os defaults num `const DEFAULTS = {...}` importável — copiar os textos da migração Task 1).
  - `ConfigRegras`: number/checkbox inputs p/ `dias` (7 checkboxes), `hora_inicio/fim` (`<input type="time">`), `granularidade_min`, `antecedencia_min_minutos`, `horizonte_dias_uteis`, `slots_por_oferta`, `max_recusas`, `max_reagendamentos`, `duracao_evento_min`, `silencio_humano_horas`, `feriados` (textarea 1 data/linha YYYY-MM-DD), `almoco` (2 time inputs + checkbox "sem almoço" → null).
  - `ConfigVendedoras`: tabela email/nome/user_id/peso(number)/ativa(checkbox) + validação "soma dos pesos > 0"; sem adicionar/remover na v1 (editar os 3).
  - `ConfigGeral`: toggles `ativo` e `modo_teste` (com aviso vermelho ao desligar modo_teste), selects `llm.modelo` (`claude-sonnet-5`|`claude-haiku-4-5`), `stt.provedor` (`groq`|`openai`), number `llm.confianca_minima` (0–1 step .05), ids Kommo somente-leitura (campo_ana_id, salesbot_id, salesbot_template_id) com dica de onde configurar.

- [ ] **Step 3: `agenda/AgendaViews.jsx`** — 4 views. Conteúdo mínimo COMPLETO:
  - `MetricasView`: seletor de período (7/30/90 dias) → `supabase.rpc('agenda_bot_metricas', { p_de, p_ate })` → `computeFunilAna` → funil em barras horizontais (divs com width %), 3 cards de taxa, tabela por vendedora, card "tempo mediano de 1ª resposta".
  - `AgendaView`: `supabase.from('vw_agenda_painel').select('*').gte('scheduled_at', <30d atrás>)` → `agruparAgenda` → seções Hoje/Amanhã/Semana/Passadas; cada linha: hora (fuso SP), nome, telefone, vendedora, status (badge), link "abrir lead" (`https://advocaciacbc.kommo.com/leads/detail/<lead_id>`), botões: Desfecho ▾ (realizada/no_show/fechou → `chamarAdmin({acao:'desfecho',...})`), Reagendar (prompt de data/hora → `chamarAdmin({acao:'reagendar',...})`), Cancelar (confirm → `chamarAdmin({acao:'cancelar',...})`). Recarrega após ação.
  - `ConversasView`: `supabase.from('bot_conversations').select('id, channel, customer_name, context, updated_at').like('channel', 'agenda:%').order('updated_at', {ascending:false}).limit(50)` → lista com etapa (badge), dados coletados, `pausada_ate`; botão "Pausar 24h"/"Retomar" (`chamarAdmin({acao:'pausar_lead', lead_id, horas: 24|0})`); expandir → últimas 20 `bot_messages` da conversa.
  - `SimuladorView`: textarea "mensagem do lead" + JSON do estado (default `estadoInicial`-like) → `chamarAdmin({acao:'simular', mensagem, estado})` → mostra `interp` + `acoes` + `novoEstado` em `<pre>`. Aviso: "Simulação não toca Kommo/Google".

- [ ] **Step 4: Build + suíte** — `cd client && npm test && npx vite build` → PASS/build ok (sem erros de import).

- [ ] **Step 5: Commit** — `git add client/src/components/AgendaPanel.jsx client/src/components/agenda/ConfigForms.jsx client/src/components/agenda/AgendaViews.jsx && git commit -m "feat(agenda-bot): aba Agendamento Videochamada — 8 sub-abas"`

---

### Task 13: Wiring da aba (`App.jsx`, `AdminPanel.jsx`, permissões)

**Files:**
- Modify: `client/src/App.jsx` (backup antes!), `client/src/components/AdminPanel.jsx` (backup antes!)

Âncoras REAIS no `App.jsx` (linhas de 21/07 — localizar por conteúdo, não por número):
1. Mapa lazy (~l.59): junto de `trafego: () => import('./components/TrafegoPanel'),` adicionar `agenda: () => import('./components/AgendaPanel'),`
2. `MOBILE_TAB_LABELS` (~l.143): `agenda: 'Agenda Ana',`
3. `TAB_ICONS` (~l.166): `agenda: CalendarDaysIcon,` (importar de heroicons igual aos vizinhos; se não houver, usar `PhoneIcon` existente)
4. `allowedTabKeys` (~l.1243): inserir `'agenda'` depois de `'trafego'`
5. Títulos (~l.1436 e ~l.1477): `mainTab === 'agenda' ? 'Agendamento Videochamada' :` nos DOIS ternários
6. Render (~l.1608): novo branch idêntico ao da trafego:
```jsx
) : mainTab === 'agenda' && userPerms?.tabs?.agenda ? (
  <Suspense fallback={<TabFallback skeleton={<SkeletonDashboard />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="agenda" className="flex-1 overflow-hidden page-enter"><AgendaPanel /></TabScrollContainer></ErrorBoundary></Suspense>
```
(+ o `const AgendaPanel = ...` no mesmo esquema de lazy dos outros painéis)

`AdminPanel.jsx` (~l.30): adicionar `{ key: 'agenda', label: 'Agenda Ana', Icon: CalendarDaysIcon },` na lista da matriz.

- [ ] **Step 1: Aplicar as 7 edições** (6 no App + 1 no Admin). 
- [ ] **Step 2: Seed de permissão** — SQL no Supabase (mesma mecânica do seed da trafego):
```sql
update user_permissions set tabs = jsonb_set(coalesce(tabs,'{}'::jsonb), '{agenda}', 'true')
 where email in ('paulo@advocaciacbc.com','bruno@advocaciacbc.com','lorenza@advocaciacbc.com');
```
(conferir os nomes reais de tabela/colunas: `select * from user_permissions limit 1;` — se a coluna for outra, adaptar.)
- [ ] **Step 3: Validar local** — `cd client && ./start-dev.sh` (ou `npm run dev`), logar, ver a aba, abrir as 8 sub-abas, salvar uma mensagem e recarregar (persistiu?). `npm test` + `npx vite build` → PASS.
- [ ] **Step 4: Commit** — `git add client/src/App.jsx client/src/components/AdminPanel.jsx && git commit -m "feat(agenda-bot): wiring da aba agenda + RBAC"`

---

### Task 14: Piloto, deploy e documentação

**Files:**
- Modify: `CLAUDE.md` (bloco "Estado atual" — novo parágrafo), `client/netlify/functions/LEIA-ME-ARTEFATOS.md` se aplicável

- [ ] **Step 1: Pré-deploy** — checklist: envs setadas (Task 2 Step 7)? campo/salesbot ids na config (Task 2 Steps 3–5)? migrações aplicadas? `npm test` verde? `git log` limpo na branch?
- [ ] **Step 2: Merge + deploy** — `git checkout main && git merge feat/agenda-bot-ana` (ou PR, a critério do Paulo) → **conferir `git log -1` bate com o CLAUDE.md** (regra 02/07) → `cd client && ./deploy.sh prod`.
- [ ] **Step 3: Smoke produção** — (a) `curl -s https://contratos-cbc.netlify.app/.netlify/functions/agenda-bot-cron` → `{ok:true,...}`; (b) webhook: mandar "oi" do telefone de TESTE (cadastrado em `bot_testers`; lead no funil Teste Paulo) → Ana responde a abertura em <30s; (c) console do Monitor (origem `agenda`) sem erros.
- [ ] **Step 4: Piloto roteirizado (funil Teste Paulo, `ativo:true`, `modo_teste:true`)** — percorrer: qualificação completa por TEXTO → oferta → aceitar slot → conferir evento+Meet na agenda da vendedora sorteada + etapa "Vídeo Chamada" + tarefa; repetir com ÁUDIO (validar attachment do webhook — ajuste da Task 8 nota 5); contraproposta de horário; pergunta de preço; "quero falar com uma pessoa" (handoff); resposta manual de um vendedor → Ana pausa; lembretes (agendar p/ +70min e esperar cron); no-show (não entrar na call, marcar vermelho, ver oferta de reagendamento); fora da janela (template WABA — se aprovado).
- [ ] **Step 5: Ajustes de copy pelo Paulo na aba** (Mensagens) — iterar até ok.
- [ ] **Step 6: Ligar em produção** — na aba Config: `modo_teste: false` (Venda inteiro); Disparos ficam por conta dos gatilhos já configurados. Acompanhar 1 semana nas Métricas.
- [ ] **Step 7: Documentar** — parágrafo no CLAUDE.md (Estado atual): o que é, arquivos, config `agenda_bot`, ids Kommo, como pausar (kill-switch), link spec/plano. Commit + incluir no deploy seguinte.

## Self-review (executado na escrita do plano)

- Cobertura da spec: motor híbrido (T4/T5/T8), transcrição (T5/T8), slots/pesos (T3/T8), evento+Meet+extendedProps (T6/T8), classifyEvent/sync (T6), lembretes+no-show+janela+templates (T9 + setup T2), auto-pausa por humano (T8), aba com 8 sub-abas + parametrização total (T11–T13), métricas com taxa de conexão/tempos (T1 RPC + T11), Kommo setup (T2), RBAC (T13), piloto/kill-switch (T14), LGPD (RLS mantida; view painel só p/ authenticated). Gap consciente: métrica "antes × depois" usa baseline estático da análise ChatGuru — anotar no card da aba (T12, MetricasView, texto fixo).
- Placeholders: Task 10 Step 1 delega o corpo ao padrão `meta-trafego-action.mjs` com contrato completo de entrada/saída — aceitável por referenciar arquivo REAL do repo; executor deve lê-lo. Demais tasks têm código completo.
- Consistência de nomes conferida: `decidir/confirmar/estadoInicial/aplicarTemplate`, `gerarSlots/sortearVendedora/slotMaisProximo/formatarSlot/dentroDoExpediente`, `interpretar/transcrever/montarPromptInterprete/validarInterpretacao`, `freeBusy/createEventComMeet/patchEventHorario/cancelEvent`, RPCs `agenda_bot_metricas/agenda_bot_pendencias/agenda_bot_marcar`, view `vw_agenda_painel`, key `agenda_bot`, channel `agenda:<fone>`.
