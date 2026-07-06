# Disparo automático de links de assinatura via Kommo/WhatsApp — Design (M2)

**Data:** 02/07/2026 · **Aprovado por:** Paulo (chat desta data) · **Status:** aprovado para implementação
**Mockup escolhido:** M2 "Faixa no Contrato" (`prototipos/assinatura-whatsapp-aviso/m2-faixa-no-contrato.html`)

## Objetivo

Quando um contrato é enviado ao ZapSign, enviar automaticamente o(s) link(s) de assinatura
pelo WhatsApp através do Kommo (Salesbot), **somente se o cliente estiver dentro da janela
de 24h da Meta**. A equipe acompanha o resultado por uma faixa de status na expansão do
contrato (aba Contratos Salvos).

Reverte deliberadamente a parte da REGRA #11 que dizia "operador envia o link manualmente":
o envio passa a ser automático via Kommo (o vendedor VÊ a mensagem na conversa do lead,
diferente do ChatGuru). O envio manual continua sendo o fallback quando a janela está fechada.

## Decisões de comportamento (palavras do Paulo)

1. **Modo A**: mensagem simples via Salesbot (SEM template WABA). 1 bot único.
2. **Mesmo lead para os dois contratantes → UMA mensagem com os dois links.** Nunca duplicar.
3. **Sem re-tentativa automática.** Se estiver fora da janela de 24h no momento do disparo,
   NÃO reenviar quando a janela reabrir. Fica somente o aviso para envio manual
   (sem botão "Tentar de novo", sem varredura de retry, sem texto "o sistema tenta de novo sozinho").
4. **1 disparo por contrato** (lock atômico). Reenvios ao ZapSign não re-disparam.

## Mecânica Kommo (comprovada pela cobrança)

- Kommo não tem endpoint "enviar mensagem". Caminho: gravar texto num **campo do lead** e
  rodar um **Salesbot** de 1 bloco que ecoa `{{lead.cf.<field_id>}}` (`POST /api/v4/bots/run`).
- Job composto já existente na fila: `cobranca_send` em `_lib/kommo.mjs` (campo + bot na
  mesma operação, ordem garantida). Ganha alias `assinatura_send`.
- **Campo novo** no lead: `CBC Assinatura` (tipo textarea). Auto-provisionado: config →
  `findCustomFieldByName` → `POST /api/v4/leads/custom_fields`; field_id cacheado em
  `bot_config.kommo.assinatura` (padrão do kommo-asaas-sync).
- **Salesbot**: criado manualmente pelo Paulo no Kommo (POST /api/v4/bots = 405), nome
  `CBC - Link Assinatura`, 1 bloco exibindo o campo. A function resolve o `bot_id` pelo
  nome via `GET /api/v4/bots` e cacheia na config.

## Checagem da janela de 24h

- No momento do disparo, por lead: `GET /api/v4/events?filter[entity]=lead&
  filter[entity_id][]=<id>&filter[type]=incoming_chat_message&limit=1` → timestamp da
  última mensagem RECEBIDA do cliente.
- Janela aberta = última mensagem há menos de `24h − margem` (margem padrão 60 min,
  configurável). Sem nenhuma mensagem recebida = janela fechada.
- Falha na checagem (API fora, formato inesperado) = **não envia** (estado `erro`, mesma
  orientação de envio manual). Nunca "envia no escuro".
- ⚠️ Validar o formato exato do endpoint de events no primeiro teste real (flag OFF até lá).

## Fluxo da function `kommo-assinatura-send.mjs` (HTTP, chamada pelo App)

1. Body: `{ contratoId }`. Sem cron, sem varredura (decisão nº 3/4). Auth: mesma origem
   (função lê apenas o id e decide tudo pelo banco; sem dados sensíveis no body).
2. Kill-switch: `bot_config.kommo.assinatura.ativo !== true` → responde `{skipped}` sem tocar nada.
3. **Lock atômico** (REGRA #3): `UPDATE contratos SET kommo_assinatura = {status:'processando'...}
   WHERE id = X AND kommo_assinatura IS NULL AND status = 'enviado_zapsign' RETURNING`.
   Sem linha = já processado/estado inválido → sai (idempotente).
4. Carrega `zapsign_links` + `dados->contratantes`. Pareia signer↔contratante por e-mail
   (PJ: emailEmpresa) com fallback por nome e por ordem. Extrai `leadId` de cada
   `linkKommo` (`extrairLeadId`).
5. **Agrupa por leadId** — mesmo lead = 1 mensagem com todos os links do grupo (decisão nº 2).
6. Por lead: checa janela → aberta: monta mensagem e enfileira `assinatura_send`
   (`{leadId, fieldId, value: mensagem, botId}`, dedupeKey `assinatura:<contratoId>:<leadId>`);
   fechada: marca `fora_janela` e posta **nota interna** no lead (marker
   `CBC.assinatura.manual`) avisando o vendedor para enviar manualmente.
7. Grava resultado final em `contratos.kommo_assinatura` (jsonb):
   `{ status: 'ok'|'parcial'|'fora_janela'|'erro', checked_at, leads: [{leadId, contratantes:[nomes],
   resultado: 'enviado'|'fora_janela'|'erro', sent_at?, last_msg_at?, erro?}] }`.
8. Observabilidade: `logAdvbox('kommo', ...)` (console do Monitor) + `heartbeat`.

Contratante sem `linkKommo` válido (contratos antigos/importados): entra como `erro`
naquele lead (aviso manual), sem derrubar os demais.

## Gatilho no frontend (App.jsx)

- Em `onSaveAfterSend` do ZapSignModal (App.jsx:1592): capturar o retorno de
  `handleSaveContract` (já retorna a linha) e disparar fire-and-forget
  `fetch('/.netlify/functions/kommo-assinatura-send', {body:{contratoId}})`.
- Mensagem de status muda para refletir o disparo automático.
- Sem retry no polling de 5 min (decisão nº 3). Se o navegador morrer entre salvar e chamar
  (janela de ~1s), o contrato fica sem tentativa — comportamento igual ao de hoje (limitação aceita).

## UI — M2 (ContratosTab, detalhe expandido)

- Faixa acima do painel "Links de Assinatura", só quando `detail.kommo_assinatura` existe e
  `status !== 'assinado'`:
  - **Verde** (`ok`): "Links de assinatura enviados no WhatsApp" + chips ✓ por contratante com hora.
  - **Âmbar** (`parcial`/`fora_janela`/`erro`): "WhatsApp não enviado: fora da janela de 24h"
    (ou variação de erro), explicação, chips por contratante e ações **[Abrir conversa]**
    (linkKommo) e **[Copiar link]**. SEM "Tentar de novo".
- Selos `WA ✓` / `WA manual` por linha nos links de assinatura.
- `detail` já vem de `select('*')` → nenhuma mudança de select. Tokens `--cbc-*` (dark ok).
- Estado `processando` (2–5 s): faixa neutra "Verificando janela do WhatsApp…" (aparece se o
  usuário abrir o detalhe nesse meio-tempo).

## Banco (aditivo)

- Migração `assinatura_whatsapp`: `ALTER TABLE contratos ADD COLUMN kommo_assinatura jsonb;`
  (+ arquivo `supabase_assinatura_whatsapp.sql` na raiz).
- Seed `bot_config.kommo.assinatura` = `{ ativo: false, field_id: null, field_name: 'CBC Assinatura',
  bot_id: null, bot_name: 'CBC - Link Assinatura', janela_margem_min: 60, msg_1, msg_2 }`.
  Copy das mensagens editável na config (sem redeploy).

## Mensagens (default; {`{nome}`} = primeiro nome capitalizado)

- 1 link: "Olá, {nome}! 😊 Seu contrato com a CBC Advogados está pronto para assinatura
  digital. É rápido e pode ser feito pelo celular:\n👉 {link}\nQualquer dúvida, é só responder por aqui."
- 2+ links (mesmo lead): "Olá! 😊 O contrato de vocês com a CBC Advogados está pronto.
  Cada um assina pelo seu próprio link:\n✍️ {nome1}: {link1}\n✍️ {nome2}: {link2}\nQualquer
  dúvida, é só responder por aqui."

## Módulo puro + testes

- `netlify/functions/_lib/assinaturaWhatsapp.mjs`: parear signers↔contratantes, agrupar por
  lead, montar mensagens, decidir janela (função pura recebendo timestamps). Testado em
  `client/src/utils/__tests__/assinaturaWhatsapp.test.js` (vitest, padrão advboxMaps).

## Rollout / segurança

- Flag nasce **OFF** (`ativo:false`). Deploy não muda comportamento até ligar.
- Passos do Paulo: criar Salesbot `CBC - Link Assinatura` (1 bloco `{{lead.cf.<field_id>}}` —
  o field_id sai no log/config após o 1º setup) → ligar `ativo` → teste real com lead próprio.
- Backups em `backups/20260702_*_assinatura_whatsapp/` antes de editar arquivos existentes.
- Deploy SÓ via `client/deploy.sh`, por decisão do Paulo (não faz parte desta entrega).

## Fora de escopo (anotado para depois, se Paulo quiser)

- Baixa manual "já enviei" para a faixa âmbar virar verde (auditável).
- Template WABA (Modo B) para entrega fora da janela.
- Aviso no momento do envio dentro do modal (M1) como complemento.
