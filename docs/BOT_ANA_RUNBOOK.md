# Bot Ana — Agendamento de Videochamada — Runbook de deploy e piloto

Bot que atende leads no WhatsApp via Kommo, qualifica com IA (transcrição + interpretação),
agenda videochamadas com Google Meet na agenda das advogadas, lembra/reagenda e trata no-show.
Administrado pela aba **"Agenda Ana"** do CBC Contratos.

- **Código:** completo e revisado (branch `feat/agenda-bot-ana`, 468 testes passando). Nasce **DESLIGADO**: `bot_config.agenda_bot.ativo=false`, `modo_teste=true` (só responde telefones em `bot_testers`).
- **Spec:** `docs/superpowers/specs/2026-07-21-agendamento-videochamada-bot-ana-design.md`
- **Plano/execução:** `docs/superpowers/plans/2026-07-21-agenda-bot-ana.md`

## Arquitetura (o que roda)

```
Lead (WhatsApp) → Kommo → webhook add_message → kommo-agenda-webhook → agenda-bot-worker-background
  worker: filtros (ativo/testador/gatilho/pausa/humano) → transcreve áudio → interpreta (Claude tool-use)
          → máquina de estados (agendaEngine) → slots reais (freeBusy 3 agendas) → cria evento+Meet
          → move lead p/ "Vídeo Chamada" + tarefa + campos
agenda-bot-cron (*/5): lembrete T-1h, link Meet T-0, no-show T+10 (janela 24h Meta; template WABA fora dela)
agenda-videochamadas-sync (existente, */45): lê a COR do evento → status (realizada/no_show/fechou)
Aba "Agenda Ana" (AgendaPanel): métricas, agenda, conversas, simulador, e parametrização total
  → agenda-admin (JWT + tabs.agenda): reagendar/cancelar/desfecho/simular/pausar
```

Config única em `bot_config.agenda_bot` (editável 100% pela aba, sem deploy).
Migrações SQL aplicadas: `agenda_bot_v1` → `v1_2_revokes` → `v1_3_sweep_vendedoras` → `v1_4_cron_rpcs` → `v1_5_reset_reagendamento` (todas no `supabase_agenda_bot.sql`).

## Pré-requisitos [PAULO] — fazer ANTES do piloto

1. **CRÍTICO — re-consentir o OAuth do Google com escopo de ESCRITA.** O `GOOGLE_OAUTH_REFRESH_TOKEN` atual é *readonly* (`calendar.events.readonly`) — sem escrita, o bot não cria/edita evento nenhum. Re-autorizar com `https://www.googleapis.com/auth/calendar.events` (OAuth Playground ou o fluxo do escritório) e re-setar `GOOGLE_OAUTH_REFRESH_TOKEN` no Netlify.
2. **Compartilhar as 3 agendas** (`marianamaciel@`, `beatriz@`, `emerson@advocaciacbc.com`) com a conta dona do token, permissão **"Fazer alterações nos eventos"**. (Emerson quase certamente ainda não está.)
3. **Criar o Salesbot "CBC - Ana"** na UI do Kommo (POST /bots não existe na API): 1 bloco de Mensagem exibindo `{{lead.cf.2444884}}` (campo "CBC Ana", já criado), SEM gatilho de etapa. Copiar o `bot_id` da URL e gravar:
   `update bot_config set value = jsonb_set(value,'{kommo,salesbot_id}', to_jsonb(<BOT_ID>::int)) where key='agenda_bot';`
4. **Submeter os 3 templates WABA** (categoria Utility, pt_BR) no canal WhatsApp do Kommo: `ana_lembrete_1h` ({{1}}=nome,{{2}}=hora), `ana_link_meet` ({{1}}=link), `ana_reagendar` ({{1}}=nome) — corpos na spec §Janela de 24h. Apurar o mecanismo de disparo (bloco de template no Salesbot) e gravar o id em `kommo.salesbot_template_id`. Enquanto não aprovados, o cron cai no fallback tarefa-manual (não quebra).
5. **Envs no Netlify** (site contratos-cbc): `ANTHROPIC_API_KEY` (interpretação) e `GROQ_API_KEY` **ou** `OPENAI_API_KEY` (transcrição de áudio). `AGENDA_WEBHOOK_SECRET` já está setado (foi rotacionado — ler com `netlify env:get AGENDA_WEBHOOK_SECRET`).

## Deploy

1. **Resolver o entrelaçamento de git antes de mergear:** o branch `feat/agenda-bot-ana` contém 2 commits de Asaas de outra sessão (`e161c66`,`24a3ce1`) que já foram cherry-picked para `melhorias-auditoria-2026-07` (`9b5ceec`,`206512a`). Antes de integrar, `git rebase --onto melhorias-auditoria-2026-07 24a3ce1 feat/agenda-bot-ana` para dropar os 2 (evita duplicata/conflito). Depois conferir `npm test` e `git log`.
2. Deploy **SÓ via `client/deploy.sh`** (regra do incidente 02/07 — nunca `netlify deploy` direto).
3. **Registrar o webhook no Kommo** (só agora, pós-deploy — o endpoint precisa existir): add_message → `https://contratos-cbc.netlify.app/.netlify/functions/kommo-agenda-webhook?secret=<AGENDA_WEBHOOK_SECRET>`. Coexiste com o webhook do Bot ADVBOX; cada worker filtra o seu público.

## Piloto (funil "Teste Paulo" 13916619, com `ativo:true` + `modo_teste:true`)

Cadastrar seu telefone em `bot_testers`. Percorrer, conferindo em cada passo o Monitor (origem `agenda`) e a aba:
1. Qualificação por **texto** → oferta de 2 slots → aceitar → conferir **evento+Meet** na agenda da vendedora sorteada + lead movido p/ "Vídeo Chamada" + tarefa.
2. Repetir com **áudio** (valida transcrição + os nomes reais dos campos de anexo do webhook — ver "validar no piloto" abaixo).
3. **Contraproposta** de horário; **pergunta de preço** (deflexão); **"quero falar com uma pessoa"** (handoff).
4. Responder manualmente como vendedor → a Ana deve **pausar** naquele lead.
5. **Lembretes**: agendar p/ +70min e esperar o cron (T-1h e T-0 com link).
6. **No-show**: não entrar; marcar o evento de **vermelho** (no_show) na agenda; ver a oferta de reagendamento; aceitar → conferir que os **lembretes do novo horário disparam** (o fix da revisão final).
7. **Fora da janela de 24h**: com template aprovado, ver o template; sem, ver a tarefa-manual.

Depois: ajustar as **mensagens** na aba (sub-aba Mensagens) até ficar no tom certo. Só então virar
`modo_teste:false` (Venda inteiro) e, por último, ligar os gatilhos dos funis de Disparo.

## A validar no piloto (itens que só a API viva confirma)

- **Nomes reais dos campos do webhook `add_message`**: anexo (link/tipo), id da mensagem, e o campo de texto do evento `outgoing_chat_message` (sustenta a detecção de "humano assumiu"). O worker tem fallbacks defensivos + loga o `raw` em erro — capturar 1 webhook real e podar as grafias.
- **Janela de 24h por CONTATO** (`GET /events?filter[entity]=contact`) retorna evento? (mesmo padrão do `kommo-assinatura-send`, mas confirmar p/ o público da Ana — se retornar vazio, todo lembrete cai no fallback template/tarefa).
- **`bots/run`** dispara a fala em conversa nova (lead frio)?
- **Schema `strict` + `type:[string,null]`** aceito pela API Anthropic na 1ª chamada real (senão trocar p/ `anyOf`).
- **`setEventColor(null)`** limpa a cor no Google (só testável com escopo de escrita).

## Known-issues documentados (não bloqueiam o piloto)

- Reagendar via patch com escrita OK: se `patchEventHorario`/`setEventColor` falhar, há fallback ao lead (fechado na revisão final).
- Cron `at-least-once`: se `marcar()` falhar após enviar, um lembrete pode duplicar no tick seguinte (pior caso: 1 mensagem repetida).
- Escrita concorrente na config (2 sessões salvando) sem lock otimista — last-write-wins.
- Métrica "por origem" (Venda × Disparo) prometida na spec ainda não agregada na RPC (o dado é gravado; falta o SELECT).
- Editor de `gatilhos` (funis/etapas) só por SQL (Venda + Teste Paulo já vêm seedados).
- RLS **desabilitada** (pré-existente, fora do escopo do bot) em `cron_heartbeat`, `health_history`, `bot_processed_messages`, `resort_alias` — decidir se fecha.
