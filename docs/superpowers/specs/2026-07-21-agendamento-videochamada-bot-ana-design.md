# Aba "Agendamento Videochamada" + bot "Ana" (Kommo → Google Meet) — Design — 2026-07-21

**Objetivo:** um chatbot ("Ana") atende leads novos no WhatsApp via Kommo, qualifica com o
playbook comprovado do escritório, oferece horários REAIS das agendas das vendedoras, cria o
evento com Google Meet na agenda da vendedora sorteada, confirma, lembra e trata no-show —
tudo administrado numa aba nova do CBC Contratos, com **todas as mensagens e regras
parametrizáveis** e **painel de métricas**.

**Base da análise:** 13.884 conversas do ChatGuru (out/2023→jun/2026) —
`projetos/chatguru-export/docs/analise-funil-videochamada-2026-07-21.md`. Números-chave:
1ª resposta mediana **6,5 h**; **38,5 h** até "agendado"; ~49% reagendam; no-show real (cor da
agenda) = **124/511 ≈ 24%**; playbook que converte = oferta com **slot específico** no chat.

## Decisões já tomadas (Paulo, 21/07)

1. **Persona B**: “Sou a **Ana**, assistente do escritório Conforto, Bergonsi e Cavalari,
   escritório especializado em cancelamento de contratos.” (Coincide com atendentes reais
   históricas “Ana”/“Ana Piva” — soa natural no WhatsApp do escritório.)
2. Vendedora principal = **Mariana Beraldo** (marianamaciel@) — fica com a **maioria** dos
   atendimentos (pesos configuráveis; default 60/20/20 com Beatriz e Emerson).
3. Escopo: **leads novos (funil Venda) + respostas dos funis de Disparo**.
4. Implementação **dentro do CBC Contratos** (sem site novo): aba + functions no site
   `contratos-cbc.netlify.app`. Carga estimada ≈ +12k invocações/mês (folga enorme).
5. Regras de agenda **ok e parametrizáveis**; tratamento de erro ok; testes ok.
6. **Emerson confirmado** (agenda emerson@advocaciacbc.com entra no monitoramento) e
   **horários seg–sex 8h–17h** confirmados.
7. **IA no atendimento desde a v1**: transcrição dos áudios dos leads + interpretação das
   mensagens por LLM (ver §Motor com IA e §Custos de IA). Aprovado pelo Paulo em 21/07
   ("ligar transcrição por IA… para que a IA faça o primeiro atendimento e qualificação
   e agendasse/reagendasse").
8. **Templates WhatsApp (WABA) para fora da janela de 24h**: criar e usar templates
   aprovados pela Meta para lembretes/reagendamento após 24h (pedido do Paulo), em vez
   do fallback só-tarefa-manual.
9. **Pausa automática da Ana quando um humano responder manualmente** — já na v1.

## O que JÁ EXISTE e será reutilizado (nada disso é novo)

| Peça | Onde | Uso pela Ana |
|---|---|---|
| Webhook "Mensagem recebida" do Kommo → worker background | `kommo-advbox-webhook.mjs` → `advbox-bot-worker-background.mjs` | mesmo padrão: webhook novo `kommo-agenda-webhook` → `agenda-bot-worker-background` (Kommo exige resposta ~2s) |
| Envio de mensagem ao lead: grava campo custom + `POST /bots/run` (Salesbot 1 bloco `{{lead.cf.ID}}`) | validado na cobrança e na assinatura (`_lib/kommo.mjs`: `setLeadField`, `runSalesbot`, fila `kommo_queue`) | todas as falas da Ana |
| Checagem da **janela de 24h da Meta** por CONTATO (`filter[entity]=contact` — lição 02/07) | `kommo-assinatura-send.mjs` | lembretes T-1h/T-0: fora da janela → fallback (tarefa p/ vendedora) |
| Leitura das agendas Google (OAuth refresh token, envs `GOOGLE_OAUTH_*`) | `_lib/googleAgenda.mjs` + `agenda-videochamadas-sync.mjs` (cron 45min) | base do free/busy; ganha ESCRITA (criar/mover/cancelar evento) |
| Tabela `agenda_videochamadas` (status pela COR: 10=realizada, 11=no-show, 7=fechou) + RPCs upsert/sweep | migração `agenda_videochamadas` | continua sendo a fonte dos desfechos; ganha colunas de vínculo com lead |
| `bot_config` (key/value jsonb) + RBAC `user_permissions.tabs.*` + console do Monitor (`logAdvbox`) | infra do Bot ADVBOX | config da aba, permissão `tabs.agenda`, logs origem `agenda` |
| Estado de conversa (`bot_conversations`/`bot_messages`/`bot_processed_messages`) | Bot ADVBOX | mesmas tabelas, `channel` próprio (`agenda:<telefone>`) |
| Modo teste por telefone (`bot_testers`) | Bot ADVBOX | Ana nasce respondendo SÓ testadores; kill-switch geral |

## Arquitetura

```
Lead (WhatsApp) ⇄ Kommo (WABA)
      │ webhook add_message (novo endpoint ?secret=)
      ▼
kommo-agenda-webhook (sync, ~2s) ──▶ agenda-bot-worker-background (15 min)
                                       │  engine puro `_lib/agendaEngine.mjs` (máquina de estados,
                                       │  mensagens/regras vindas de bot_config.agenda_bot)
                                       ├─ responde: setLeadField(campo "CBC Ana") + runSalesbot
                                       ├─ slots: googleAgenda.freeBusy(3 agendas) + pesos
                                       ├─ agendar: cria evento c/ Meet na agenda da vendedora
                                       │   (extendedProperties.private.cbc_lead_id = lead)
                                       └─ Kommo: etapa "Vídeo Chamada", responsável, campos, tarefa
agenda-bot-cron (*/5) ── lembretes T-1h/T-0 (link Meet), no-show T+10, pós-no-show reagenda
agenda-videochamadas-sync (existente) ── continua lendo cores/desfechos (agora tb. eventos do bot)
Aba "Agendamento Videochamada" (React) ⇄ function `agenda-admin.mjs` (config/métricas/ações)
```

**Motor conversacional próprio** (não o construtor visual do Kommo): o Salesbot do Kommo fica
sendo só o "carteiro" (1 bloco que exibe o campo). Motivo: exigência de **mensagens 100%
parametrizáveis na aba** + lógica de slots impossível no builder + padrão já validado 2×.

## Motor com IA (híbrido: máquina de estados + LLM intérprete)

Divisão de responsabilidades — desenhada para um escritório de advocacia (zero
alucinação nas falas):

- **Máquina de estados** (código puro, testado) decide **o que fazer** em cada etapa
  (perguntar, ofertar slots, confirmar, lembrar, handoff) e **o que dizer** — as falas saem
  SEMPRE dos templates editáveis da aba, nunca de texto livre do modelo.
- **LLM (intérprete)** faz o que regex não faz: extrai da mensagem livre do lead a
  **intenção + dados estruturados** — resort citado, pagando/quitou, valor aproximado,
  aceite/recusa/contraproposta de horário ("pode ser 4ª às 9h?"), pedido de preço, pedido
  de humano, fora-de-escopo. Saída em JSON estrito (structured outputs); baixa confiança →
  handoff. Também resume a conversa no campo do lead para a vendedora chegar contextualizada.
- **Transcrição de áudio**: a API da Anthropic **não aceita áudio**; usar um STT dedicado —
  default **OpenAI Whisper** (`whisper-1`, ~US$ 0,006/min) ou alternativa **Groq**
  (`whisper-large-v3-turbo`, ~US$ 0,04/hora, ~9× mais barato). Chave em env
  (`OPENAI_API_KEY` ou `GROQ_API_KEY`); áudio baixado via URL de mídia do Kommo, limite de
  duração configurável (default 3 min; acima disso → "consegue me resumir por escrito?").
- Config na aba: modelo LLM, transcrição on/off, limite de duração, limiar de confiança.
  Cache de prompt (playbook fixo no system prompt) para reduzir custo ~90% no input repetido.

### Custos de IA (volumes REAIS da base; preços de 21/07/2026)

Premissas medidas: 500–800 conversas novas/mês (histórico ChatGuru) + respostas de
disparos ≈ **~1.000 conversas/mês** na Ana; ~6 mensagens de lead interpretadas por
conversa (mediana até agendar); ~3,5 áudios/conversa × ~1 min (histórico: 49,5 mil áudios
em 13,9 mil conversas); ~3k tokens de entrada por chamada (playbook cacheado) + ~250 de saída.

| Item | Modelo/preço (por MTok in/out) | Custo/mês estimado |
|---|---|---|
| Interpretação | **Haiku 4.5** ($1/$5) | ~US$ 12 (~R$ 65) |
| Interpretação | **Sonnet 5** ($3/$15; promo $2/$10 até 31/08/26) | ~US$ 36 (~R$ 200); na promo ~US$ 24 |
| Interpretação | Opus 4.8 ($5/$25) | ~US$ 60 (~R$ 330) |
| Transcrição | Whisper OpenAI ($0,006/min × ~3.500 min) | ~US$ 21 (~R$ 115) |
| Transcrição | Groq turbo (~$0,04/h) | ~US$ 2–3 (~R$ 15) |

**Total esperado: R$ 80–320/mês** conforme a combinação (escala linear com o volume de
leads; dobrou o disparo, dobra o custo). Referência de valor: 1 cliente fechado ≈ R$ 3.300
de honorários de entrada. **Recomendação: Sonnet 5** na interpretação (melhor pt-BR
coloquial/robustez, custo irrisório no volume atual) — Haiku 4.5 como opção de economia,
trocável na aba sem deploy.

## Fluxo conversacional da Ana (estados; textos default = templates da casa)

Gatilho: mensagem recebida de contato cujo lead está em (funil, etapa) configurados
(default: Venda/"Leads de entrada" + funis de Disparo nas etapas de resposta) E bot ativo
E telefone em `bot_testers` (enquanto modo teste).

0. `abertura` — 1ª resposta (segundos, 24/7):
   > Olá! Sou a **Ana, assistente do escritório Conforto, Bergonsi e Cavalari**, escritório
   > especializado em cancelamento de contratos. Estou aqui para te ajudar 😊
   > Me conta: **o que vem acontecendo com a sua cota** que te fez buscar o cancelamento?
   (áudio recebido → transcreve (STT, ver §Motor com IA) e segue o fluxo normal; falha na
   transcrição/áudio > limite → "Consegue me escrever em poucas palavras? 😊")
1. `qual_resort` — "Qual é o **resort/empreendimento** da sua cota?" (texto livre; salva)
2. `qual_situacao` — "Você **ainda está pagando** ou **já quitou** a cota?" (botões se canal
   suportar; aceita texto)
3. `qual_valor` — "Quanto **aproximadamente já foi pago**? Pode ser um valor estimado."
   → grava campo Kommo **"Investimento na cota"** (2436424)
4. `pitch_oferta` — micro-pitch + oferta com 2 slots REAIS:
   > Nesse caso você consegue iniciar o **processo de distrato** para devolver a cota ao resort
   > e **restituir o que já foi pago, corrigido monetariamente**. 📍 O próximo passo é uma
   > **videochamada** com nossa equipe: leva ~10 minutos, **não tem custo nenhum** e explicamos
   > como funciona o processo, encargos e etc.
   > Tenho **{{slot1}}** ou **{{slot2}}** disponíveis. Qual prefere? (ou me diga outro horário)
5. `negociacao` — cliente contrapropõe → oferece o slot livre mais próximo do pedido;
   2 recusas/impasse → grava "Preferência de Horário" (2436418) + tarefa p/ vendedora + handoff.
6. `confirmado` — "**Ok, agendado {{dia}} às {{hora}}!** Vamos te mandar uma mensagem antes
   com o link da videochamada. Até lá! 😊" → cria evento + Kommo (etapa/responsável/tarefa).
7. Lembretes (cron): **T-1h** "Passando para lembrar da nossa videochamada hoje às {{hora}} 😊
   Tudo certo?" · **T-0** (texto atual da casa) "Temos um atendimento agendado agora. Segue o
   link do Google Meet para videochamada: {{link}}".
8. `no_show` — T+10min sem entrar (vendedora marca cor vermelha OU botão na aba):
   "Não conseguimos falar hoje 😕 Podemos **reagendar**? Tenho {{slot1}} ou {{slot2}}." —
   máx. N ciclos (default 2) → etapa "Cemitério antes da videochamada" + tarefa.
9. Guard-rails permanentes: pergunta de **preço** → deflexão padrão da casa ("Não consigo te
   passar um preço, pois trabalhamos de uma forma diferente…"); pedido de humano/fora do script
   por 2 turnos → **handoff** (tarefa + nota no lead + Ana silencia); humano assumiu (mensagem
   manual detectada ou pausa pela aba) → Ana silencia no lead por 24h (configurável).

Estado por lead em `bot_conversations` (channel `agenda:<telefone>`); toda mensagem em
`bot_messages`; idempotência por `bot_processed_messages` (padrão existente).

## Agendamento (slots, pesos, evento)

- **Slots**: free/busy das agendas ativas na janela configurada (default: seg–sex 08–17h,
  granularidade 30min, antecedência mín. 1h, horizonte 5 dias úteis, almoço configurável,
  buffer 0min, limite/dia por vendedora opcional). Preferência do algoritmo: mesmo dia →
  dia seguinte (padrão que converte hoje). Oferece 2 opções (config).
- **Sorteio ponderado**: entre vendedoras LIVRES no slot; pesos default Mariana 60 /
  Beatriz 20 / Emerson 20 (tabela na aba; férias = peso 0 ou toggle inativa).
- **Evento**: `POST calendars/{vendedora}/events?conferenceDataVersion=1` com
  `conferenceData.createRequest` (gera Meet), summary "Videochamada — {{nome do lead}}
  (CBC/Ana)", description com telefone + link do lead no Kommo,
  `extendedProperties.private.cbc_lead_id/cbc_telefone/cbc_origem=ana`. **Sem convidado
  externo na v1** (e-mail só é coletado pós-call hoje).
- `classifyEvent` (googleAgenda.mjs) passa a aceitar TAMBÉM eventos com
  `extendedProperties.private.cbc_origem` (hoje exige convidado externo + Meet — eventos da
  Ana não têm convidado). `VENDEDORAS` sai do código e vira config (inclui **Emerson** —
  hoje o sync monitora só Beatriz e Mariana).
- `agenda_videochamadas` ganha colunas: `lead_id bigint`, `telefone text`, `origem text`
  ('ana'|'manual'), `lembrete_1h_em`/`lembrete_t0_em timestamptz` (migração aditiva).
- Reagendar/cancelar = PATCH/DELETE do evento + atualização da linha + mensagens.

## Janela de 24h da Meta (lembretes) — com templates WABA

Dentro da janela do CONTATO (checagem padrão `kommo-assinatura-send`, margem 60min):
mensagem normal via campo+Salesbot. **Fora da janela: enviar TEMPLATE WABA aprovado**
(decisão Paulo 21/07):

- Criar no canal WhatsApp do Kommo os templates (categoria **Utility** — lembrete de
  compromisso; aprovação Meta tipicamente minutos–48h): `ana_lembrete_1h` ("Olá {{1}}!
  Passando para lembrar da nossa videochamada hoje às {{2}} 😊 Tudo certo?"),
  `ana_link_meet` ("Temos um atendimento agendado agora. Segue o link da videochamada:
  {{1}}") e `ana_reagendar` ("Olá {{1}}, não conseguimos falar no horário marcado.
  Podemos reagendar? Me responde aqui e já combinamos 😊").
- Envio via Salesbot dedicado com bloco de template (disparado por `bots/run`) ou pelo
  recurso de templates do canal WABA do Kommo — mecanismo exato validado na F0.
- Custo Meta (Brasil, aprox.): utility ≈ US$ 0,008/msg (~R$ 0,05) → dezenas de reais/mês
  no pior caso. Lead que responde ao template reabre a janela e a conversa volta ao normal.
- Fallback (template reprovado/falha): nota `CBC.agenda.manual:<event_id>` + tarefa p/ a
  vendedora (padrão assinatura).
- Como o padrão da casa é agendar para o mesmo dia/dia seguinte, a maioria dos T-1h/T-0
  ainda cai dentro da janela — o template é a rede de segurança dos agendamentos distantes.

## Aba "Agendamento Videochamada" (tab key `agenda`, RBAC `tabs.agenda`)

`components/AgendaPanel.jsx` + `components/agenda/*` (sub-abas, padrão BotAdvboxPanel):

1. **Métricas** (default) — período selecionável:
   - **Taxa de conexão**: % de 1ª mensagem de lead RESPONDIDA e tempo mediano de resposta
     (antes × depois da Ana; fonte `bot_messages` + horário do webhook);
   - Funil da Ana: conversas iniciadas → qualificadas (3 respostas) → oferta feita →
     **agendadas** → realizadas / no-show / fechou (cores da `agenda_videochamadas`) —
     com taxas de conversão entre etapas;
   - Tempo mediano lead→agendado e lead→call; reagendamentos por agendamento;
   - Por vendedora: agendadas/realizadas/no-show/fechou + % de ocupação da janela;
   - Handoffs p/ humano (motivo: pediu humano, preço, impasse de horário, fuga do script);
   - Por origem: funil Venda × cada funil de Disparo.
2. **Agenda** — próximas videochamadas (hoje/semana), status ao vivo, ações: reagendar,
   cancelar, marcar desfecho (espelha a cor no Calendar), abrir lead no Kommo.
3. **Mensagens** — TODOS os textos da Ana editáveis (variáveis `{{nome}}`, `{{slot1}}`,
   `{{slot2}}`, `{{dia}}`, `{{hora}}`, `{{link}}`), com preview e "restaurar padrão".
   Salvo em `bot_config.agenda_bot.mensagens` (sem redeploy).
4. **Regras de agenda** — janela de dias/horários, granularidade, antecedência mínima,
   horizonte, almoço, buffer, limite/dia, nº de slots por oferta, ciclos de reagendamento,
   feriados (lista manual).
5. **Vendedoras** — e-mail da agenda, peso %, ativa/inativa (férias), teto diário.
6. **Conversas** — log das conversas da Ana (estado, últimas mensagens, botão
   **pausar/retomar bot no lead**, forçar handoff).
7. **Config** — kill-switch geral, modo teste (`bot_testers`), funis/etapas gatilho,
   ids Kommo (campo "CBC Ana", salesbot, webhook secret), transcrição de áudio on/off,
   janela de silêncio pós-humano.
8. **Simulador** — conversar com a Ana no painel (sem WhatsApp), padrão Bot ADVBOX.

## Setup Kommo (uma vez, manual/assistido)

1. Campo textarea de lead **"CBC Ana"** (auto-provisionável via API, padrão assinatura).
2. Salesbot **"CBC - Ana"** de 1 bloco exibindo `{{lead.cf.<id>}}` — criado na UI (POST
   /bots = 405), SEM gatilho de etapa; id vai na Config.
3. Webhook **add_message** → `/.netlify/functions/kommo-agenda-webhook?secret=<novo>`
   (coexiste com o do Bot ADVBOX; cada worker filtra o seu público: Ana = lead em
   funil/etapa gatilho; ADVBOX = testadores pós-venda. Colisão tratada: se ambos
   respondessem, prioridade da Ana em funis de venda — regra no worker).
4. Etapas destino: "Vídeo Chamada" 106167799 (Venda 13760367); perdido →
   "Cemitério antes da videochamada" 106478007 (Contato Perdido 13788547).

## Google (uma vez)

- Conferir ESCOPO do refresh token atual (`GOOGLE_OAUTH_*`): se for somente-leitura,
  re-consentir com `https://www.googleapis.com/auth/calendar.events`.
- Cada vendedora compartilha a própria agenda com a conta do token com permissão
  **"Fazer alterações nos eventos"** (Emerson incluído). Sem Admin Console/DWD.
- Validar na prática: criar evento com Meet numa agenda compartilhada (fase 0 do plano).

## Dados (migração `agenda_bot_v1`, aditiva)

- `agenda_videochamadas`: + `lead_id`, `telefone`, `origem`, `lembrete_1h_em`, `lembrete_t0_em`.
- `bot_config` keys novas: `agenda_bot` (ativo, modo_teste, gatilhos, mensagens, regras,
  vendedoras/pesos, kommo ids, silencio_horas, transcricao).
- RPCs (SECURITY DEFINER + `BOT_RPC_SECRET`, padrão da casa) p/ upsert/consulta da aba;
  RLS fechada (PII de lead). Leitura de métricas via RPC `agenda_bot_metricas(periodo)`.

## Segurança / LGPD

- Telefone/nome do lead só em tabelas com RLS fechada; aba lê via function autenticada
  (JWT Supabase, padrão `tabs.*`). Webhook com `?secret=` (env `AGENDA_WEBHOOK_SECRET`).
- Ana nunca pede documento/dado sensível; coleta = resort, situação de pagamento, valor
  aproximado (dados que o lead já dá hoje por WhatsApp). Aviso de assistente virtual na
  1ª mensagem (persona B é explícita: "assistente").
- Kill-switch geral + modo teste por telefone antes de abrir ao público (padrão Bot ADVBOX).

## Riscos / validações de fase 0

1. Escopo do token Google pode ser read-only → re-consentimento (10 min, Paulo).
2. Criação de Meet em agenda compartilhada — validar 1 evento real antes de tudo.
3. `bots/run` dispara a fala num lead: já validado (cobrança/assinatura), mas conferir
   entrega em conversa NOVA (lead que nunca recebeu mensagem manual).
4. **Auto-pausa quando humano responde manualmente (v1, decisão Paulo)**: antes de cada
   fala da Ana, o worker consulta os eventos `outgoing_chat_message` do CONTATO desde a
   última fala da Ana (mesma events API da checagem de janela; lição 02/07: filtrar por
   contato, não por lead) e compara com o log `bot_messages` — mensagem enviada que a Ana
   não mandou = humano assumiu → Ana silencia no lead (24h configuráveis) + nota. Camadas
   extras: pausa manual na aba + auto-pausa quando o lead sai da etapa gatilho. Validar na
   F0 que o evento aparece para mensagens digitadas pelo vendedor no Kommo.
5. Concorrência de slot (2 leads escolhendo o mesmo): re-checar free/busy no ato de criar;
   se ocupou, oferecer próximo slot ("esse horário acabou de ser preenchido 😅").
6. Templates WABA: aprovação da Meta pode demorar/reprovar → submeter na F0; fallback
   tarefa-manual cobre o intervalo.
7. STT externo (Whisper/Groq) fora do ar → Ana pede "pode me escrever?" e loga no Monitor.

## Fases de implementação

- **F0 — validações e preparo**: escopo/re-consent do token Google; criar 1 evento real
  com Meet em agenda compartilhada; validar `bots/run` em conversa nova; validar evento
  `outgoing_chat_message` de mensagem manual; **submeter os 3 templates WABA à aprovação**;
  configurar chaves (`ANTHROPIC_API_KEY` p/ interpretação, `OPENAI_API_KEY`/`GROQ_API_KEY`
  p/ transcrição); migração `agenda_bot_v1` + seeds de config (mensagens default deste doc).
- **F1 — motor + webhook + agendamento** (engine puro testado; intérprete LLM com
  structured outputs; worker; criação de evento; Kommo moves). Modo teste com
  `bot_testers`. Simulador.
- **F2 — cron de lembretes/no-show** + janela Meta + templates WABA + reagendamento +
  auto-pausa por mensagem manual.
- **F3 — aba completa** (métricas, mensagens, regras, vendedoras, conversas, config).
- **F4 — piloto**: funil "Teste Paulo" (13916619) + telefones testadores → revisar copy →
  ligar no funil Venda; Disparos por último (volume de rajada).
- Deploy sempre via `client/deploy.sh` (regra 02/07); testes unitários do engine, das
  regras de slot e do parser de intenções (lógica pura, padrão da casa).

## Perguntas finais — RESPONDIDAS (Paulo, 21/07)

1. **Emerson**: ✅ sim — agenda emerson@advocaciacbc.com entra no monitoramento.
2. **Horários**: ✅ seg–sex 08h–17h, parametrizável na aba.
3. **Áudio/IA**: ✅ transcrição por IA desde a v1 + IA na qualificação/agendamento
   (custos na seção §Custos de IA).
4. **Fora da janela de 24h**: ✅ criar **templates WABA** e disparar após as 24h
   (seção §Janela de 24h); fallback tarefa-manual mantido como rede de segurança.
5. **Auto-pausa com resposta manual**: ✅ na v1 (risco/validação nº 4).
