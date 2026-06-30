# Bot ADVBOX — Setup da versão de teste (06/2026)

Autoatendimento de andamentos processuais: o cliente pergunta no WhatsApp (Kommo) e o bot
responde consultando o ADVBOX, com textos 100% parametrizáveis no painel **Bot ADVBOX** do
CBC-Contratos. Esta é a **versão de teste**: no WhatsApp o bot só responde a números
cadastrados na aba *Testadores* — clientes reais nunca recebem resposta automática.

## O que foi implementado

| Peça | Onde |
|---|---|
| Painel "Bot ADVBOX" (8 abas) | `client/src/components/BotAdvboxPanel.jsx` + `client/src/components/bot/*` |
| Motor do bot (identifica, classifica, responde) | `client/netlify/functions/_lib/botEngine.mjs` |
| Clientes ADVBOX/Kommo + acesso ao banco | `client/netlify/functions/_lib/{advbox,kommo,botDb}.mjs` |
| API do painel/simulador/widget | `client/netlify/functions/advbox-bot-reply.mjs` |
| Webhook Kommo (mensagem recebida) | `client/netlify/functions/kommo-advbox-webhook.mjs` |
| Worker do WhatsApp (background) | `client/netlify/functions/advbox-bot-worker-background.mjs` |
| Monitor de andamentos/tarefas (cron 09h/18h) | `client/netlify/functions/advbox-monitor.mjs` + `advbox-monitor-worker-background.mjs` |
| Tabelas + seeds (glossário, intenções, config) | `supabase_bot_advbox.sql` |
| Widget do cartão do lead (Kommo) | `kommo-widget/` |

Funcionalidades: simulador de chat (qualquer cliente/processo do ADVBOX), suporte a clientes
com vários processos (lista numerada), tradutor de juridiquês (glossário + IA opcional),
"o que o escritório está fazendo" (tarefas pendentes/concluídas com textos parametrizáveis),
classificador de intenção, notas automáticas no Kommo (andamento / tarefa criada / concluída),
alerta de novidade não comunicada, botão de resposta pronta (painel e widget).

## Passo 1 — Banco (Supabase)

Rodar `supabase_bot_advbox.sql` no SQL Editor do projeto `vygczeepvoyaehfchxko`.
É aditivo: só cria tabelas `bot_*` e seeds (glossário com ~40 termos, 6 intenções, mensagens padrão).

## Passo 2 — Variáveis de ambiente (Netlify)

```bash
netlify env:set BOT_PANEL_KEY "<chave-forte>" --site d7b38821-22e9-4308-8fda-a8f124a65b72
netlify env:set VITE_BOT_PANEL_KEY "<mesma-chave>" --site d7b38821-22e9-4308-8fda-a8f124a65b72
# opcional — tradutor por IA:
netlify env:set ANTHROPIC_API_KEY "sk-ant-..." --site d7b38821-22e9-4308-8fda-a8f124a65b72
```

Sem configurar, a chave padrão é `cbc-bot-2026` (mesmo padrão fraco das outras functions — trocar).
`ADVBOX_TOKEN` e `KOMMO_TOKEN` já existem no site (reaproveitados).

## Passo 3 — Permissão no painel

Admin → usuários → ativar a aba **Bot ADVBOX** para quem vai testar.
O **Simulador já funciona neste ponto** (não depende de nada do Kommo): busque qualquer
cliente por nome/CPF ou processo por número CNJ e converse como se fosse o cliente.

## Passo 4 — WhatsApp real (Kommo) — para testar do celular

1. **Campo personalizado** `BOT_RESPOSTA` (tipo *Área de texto*) no **Lead** (e opcionalmente no
   Contato). Anote o `field_id` (aparece na URL/ajax do Kommo ou via
   `GET /api/v4/leads/custom_fields`).
2. **Salesbot** novo, simples: um único bloco de mensagem exibindo o placeholder do campo —
   `{{lead.cf.<FIELD_ID>}}` (ou `{{contact.cf.<FIELD_ID>}}` se usar contato). Salve e anote o
   **ID do bot** (aparece na URL do editor).
3. **Webhook**: Configurações → Integrações → Webhooks → URL
   `https://contratos-cbc.netlify.app/.netlify/functions/kommo-advbox-webhook`
   com o evento **"Mensagem recebida"** (incoming chat message).
4. No painel **Bot ADVBOX → Config → Integração Kommo**: preencher *ID do Salesbot*,
   *field_id* e marcar **Bot ativo no WhatsApp**.
5. **Testadores**: cadastrar seu celular pessoal (com DDI, ex.: `5519...`) e vincular a um
   cliente do ADVBOX. Pelo WhatsApp também dá para trocar com `#cliente <nome|cpf>`,
   `#processo <nº CNJ>`, `#reset`, `#ajuda`.
6. Mandar mensagem do celular para o número do escritório → o bot identifica o testador,
   consulta o ADVBOX, grava a resposta no campo e dispara o Salesbot.

> Fluxo técnico: o Kommo não tem endpoint de "enviar mensagem" — o caminho oficial é
> `POST /api/v4/bots/run`. Por isso a resposta vai num campo personalizado que o Salesbot exibe.

## Passo 5 — Monitor (notas automáticas + novidades)

Roda sozinho às 09h e 18h BRT (cron Netlify), ou manualmente no painel (aba *Novidades* →
"Rodar monitor agora"). Ele:
- busca andamentos novos (`GET /last_movements`, janela de 3 dias, idempotente);
- busca tarefas criadas/concluídas (`GET /posts`);
- grava tudo em `bot_sync_state` (alimenta o alerta de "não comunicado");
- posta **nota no lead do Kommo** para processos criados pelo sistema
  (mapa `contratos.advbox_lawsuit_id` → `dados.contratantes[].linkKommo`), com marker
  idempotente (`CBC.bot.mov:*`, `CBC.bot.tarefa:*`, `CBC.bot.tarefaok:*`).

## Passo 6 — Widget no cartão do lead (opcional, beta)

1. `cd kommo-widget && zip -r ../cbc-bot-widget.zip .`
2. Kommo → Configurações → Integrações → **Criar integração privada** → aba Widget → subir o zip.
   (O Kommo pode exigir imagens de logo no zip; se reclamar, adicionar PNGs em `images/`.)
3. Nas configurações do widget: `api_url` = `https://contratos-cbc.netlify.app/.netlify/functions/advbox-bot-reply`
   e `api_key` = valor de `BOT_PANEL_KEY`.
4. No cartão do lead aparece: fase do processo, novidades não comunicadas, botão
   **Copiar resposta pronta** e **Marcar como comunicado**.

> O widget é a parte mais "beta" (o upload de widgets do Kommo costuma pedir ajustes de
> manifest/imagens). Tudo que ele mostra também está disponível na aba *Novidades* do painel.

## Limitações conhecidas / a validar

1. **Filtros de data do `GET /posts`** (`created_start/created_end`, `completed_start/completed_end`)
   têm nomes a confirmar na doc do ADVBOX — o monitor tem fallback (busca sem filtro e filtra
   localmente), mas vale validar com o suporte.
2. **Placeholder `{{lead.cf.#id#}}` no Salesbot**: confirmado na doc para leads; para contato
   usar a entidade "lead" como preferida (default) se não funcionar.
3. Rate limit ADVBOX: 30 GETs/min — o cliente HTTP interno faz throttle, mas com MUITOS
   testadores simultâneos as respostas podem demorar alguns segundos a mais.
4. RLS das tabelas `bot_*` está aberta (mesmo padrão atual do projeto) — apertar junto com a
   pendência geral do `SUPABASE_SERVICE_ROLE_KEY`.
5. Webhook do Kommo não é autenticado (mesma situação do kommo-drive-sync); o risco é baixo
   porque o worker só age para telefones de testadores.

## Roteiro de teste sugerido

1. Simulador: buscar um cliente com 1 processo → "como está meu processo?" → conferir fase,
   timeline traduzida e tarefas.
2. Simulador: cliente com 2+ processos → conferir lista numerada e seleção.
3. Glossário: colar andamentos reais na caixa de teste e completar os termos que faltarem.
4. Etapas: escrever os textos de cada etapa do funil ADVBOX (o GET /settings preenche a lista).
5. Intenções: testar frases reais de clientes na caixa de teste.
6. WhatsApp: cadastrar o celular, mandar "oi" e repetir os testes 1–2 por lá.
7. Novidades: rodar o monitor, conferir notas no Kommo e o alerta de não comunicado.
