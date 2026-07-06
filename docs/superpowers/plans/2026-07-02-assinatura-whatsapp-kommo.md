# Disparo WhatsApp (Kommo) + Faixa M2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao enviar contrato ao ZapSign, disparar o(s) link(s) de assinatura pelo WhatsApp via Kommo (Salesbot) somente dentro da janela de 24h, com faixa de status M2 no detalhe do contrato.

**Architecture:** Módulo puro (`_lib/assinaturaWhatsapp.mjs`) faz pareamento/agrupamento/mensagens/janela; function HTTP (`kommo-assinatura-send.mjs`) orquestra com lock atômico e grava `contratos.kommo_assinatura`; envio real via job composto na fila `kommo_queue` (alias `assinatura_send` = mesma op da cobrança); UI lê a coluna no detalhe (select `*`).

**Tech Stack:** Netlify Functions (.mjs, Node 22), Supabase (PostgREST via botDb.db), fila kommo_queue, React 19 (ContratosTab), vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-assinatura-whatsapp-kommo-design.md` (decisões do Paulo: 1 msg por lead com todos os links; SEM re-tentativa automática; SEM botão "Tentar de novo"; 1 disparo por contrato).
- REGRA #1/#3: backup em `backups/20260702_132531_assinatura_whatsapp/` antes de editar arquivo existente. NUNCA `rm`.
- Kill-switch `bot_config.kommo.assinatura.ativo` nasce **false**. Deploy fora de escopo (só via deploy.sh, decisão do Paulo).
- Sem commits git (Paulo não pediu); entrega = working tree + backups.
- Comentários em português sem acentos; strings de UI com acentos. Tokens `--cbc-*` na UI (dark-safe).
- Config em `bot_config.kommo.assinatura`: `{ativo, field_id, field_name:'CBC Assinatura', bot_id, bot_name:'CBC - Link Assinatura', janela_margem_min:60, msg_1, msg_2}`.
- Shape de `contratos.kommo_assinatura`: `{status:'processando'|'ok'|'parcial'|'fora_janela'|'erro', checked_at, started_at?, leads:[{leadId, contratantes:[string], resultado:'enviado'|'fora_janela'|'erro', sent_at?, last_msg_at?, erro?}]}`.

---

### Task 0: Backups + migração + seed de config

**Files:**
- Create: `backups/20260702_132531_assinatura_whatsapp/` (cópias de App.jsx, ContratosTab.jsx, kommo.mjs)
- Create: `supabase_assinatura_whatsapp.sql` (raiz)
- DB: coluna `contratos.kommo_assinatura jsonb` + seed `bot_config.kommo.assinatura`

- [ ] **Step 1:** `mkdir -p backups/20260702_132531_assinatura_whatsapp && cp client/src/App.jsx client/src/components/ContratosTab.jsx client/netlify/functions/_lib/kommo.mjs backups/20260702_132531_assinatura_whatsapp/`
- [ ] **Step 2:** Aplicar via MCP `apply_migration` (name `assinatura_whatsapp`): `ALTER TABLE public.contratos ADD COLUMN IF NOT EXISTS kommo_assinatura jsonb;` e salvar o mesmo SQL (com comentário de contexto) em `supabase_assinatura_whatsapp.sql`.
- [ ] **Step 3:** Seed via `execute_sql`:
```sql
UPDATE bot_config SET value = jsonb_set(value, '{assinatura}', '{"ativo": false, "field_id": null, "field_name": "CBC Assinatura", "bot_id": null, "bot_name": "CBC - Link Assinatura", "janela_margem_min": 60, "msg_1": "Olá, {nome}! 😊 Seu contrato com a CBC Advogados está pronto para assinatura digital. É rápido e pode ser feito pelo celular:\n👉 {link}\nQualquer dúvida, é só responder por aqui.", "msg_2": "Olá! 😊 O contrato de vocês com a CBC Advogados está pronto. Cada um assina pelo seu próprio link:\n{links}\nQualquer dúvida, é só responder por aqui."}'::jsonb, true), updated_at = now() WHERE key = 'kommo';
```
- [ ] **Step 4:** Verificar: `SELECT value->'assinatura' FROM bot_config WHERE key='kommo';` e `SELECT column_name FROM information_schema.columns WHERE table_name='contratos' AND column_name='kommo_assinatura';`

### Task 1: Módulo puro + testes (TDD)

**Files:**
- Create: `client/netlify/functions/_lib/assinaturaWhatsapp.mjs`
- Test: `client/src/utils/__tests__/assinaturaWhatsapp.test.js`

**Interfaces (Produces):**
- `extrairLeadIdAssinatura(linkKommo) -> string|null`
- `parearSigners(signers, contratantes) -> [{signer, contratante, leadId}]` (match por email → nome → índice; PJ usa emailEmpresa)
- `agruparPorLead(pares) -> {grupos: Map<leadId,[{nome, link}]>, invalidos: [nome]}`
- `primeiroNome(nome) -> 'Maria'`
- `montarMensagem(itens, {msg_1, msg_2}) -> string` (1 item usa msg_1 com {nome}/{link}; 2+ usa msg_2 com {links} = linhas `✍️ *Nome*: link`)
- `janelaAberta(lastMsgIso, nowIso, margemMin) -> {aberta: bool, horas: number|null}` (sem lastMsg → fechada)

- [ ] **Step 1:** Escrever `assinaturaWhatsapp.test.js` (casos: pareamento por email/PJ/nome/índice; mesmo lead → 1 grupo com 2 itens; leads distintos → 2 grupos; linkKommo inválido → invalidos; msg 1 link exata; msg 2 links exata com os 2 links presentes e sem duplicação; janela: 22h atrás aberta, 23h30 com margem 60 fechada, null fechada).
- [ ] **Step 2:** `npx vitest run src/utils/__tests__/assinaturaWhatsapp.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar `assinaturaWhatsapp.mjs` (módulo 100% puro, sem imports).
- [ ] **Step 4:** `npx vitest run src/utils/__tests__/assinaturaWhatsapp.test.js` → PASS. Rodar suíte inteira: `npx vitest run` → sem regressão.

### Task 2: Alias do job composto na fila

**Files:**
- Modify: `client/netlify/functions/_lib/kommo.mjs:167` (mapa OPS)

**Interfaces (Produces):** kind `assinatura_send` aceito por `runKommoOp`/worker com payload `{leadId, fieldId, value, botId}` (idêntico a `cobranca_send`).

- [ ] **Step 1:** Em OPS: `assinatura_send: opCobrancaSend` (com comentário curto). Worker (`kommo-queue-worker`) passa a aceitar o kind sem outra mudança.

### Task 3: Function `kommo-assinatura-send.mjs`

**Files:**
- Create: `client/netlify/functions/kommo-assinatura-send.mjs`

**Interfaces:**
- Consumes: `db/getConfig/logAdvbox/heartbeat` (botDb), `kommoGet/enqueueKommo/drainNow/postNote/kommoConfigured/findCustomFieldByName` (kommo.mjs), módulo puro Task 1.
- Produces: `POST {contratoId}` + header `x-bot-key` → `{ok, status, leads}` | `{skipped}`; grava `contratos.kommo_assinatura`; loga em advbox_api_log (origem 'kommo').

- [ ] **Step 1:** Implementar (esqueleto real):
```js
// auth BOT_PANEL_KEY (padrao cobranca-disparar) -> 401
// cfg = (await getConfig()).kommo?.assinatura; if (!cfg?.ativo) return {skipped:'flag off'}
// LOCK atomico: update contratos set kommo_assinatura={status:'processando',started_at} where id=X and kommo_assinatura is null and status='enviado_zapsign' select('id, zapsign_links, dados') -> 0 linhas = sai
// ensureField(): cfg.field_id || findCustomFieldByName('CBC Assinatura') || POST /leads/custom_fields [{name,type:'textarea'}] -> upsert bot_config.kommo.assinatura.field_id
// ensureBot(): cfg.bot_id || GET /bots (procura por nome) -> cacheia; sem bot -> resultado 'erro' claro
// pares=parearSigners; {grupos, invalidos}=agruparPorLead
// para cada lead: last=GET /events?filter[entity]=lead&filter[entity_id][]=ID&filter[type]=incoming_chat_message&limit=1 -> janelaAberta(last, now, margem)
//   aberta: montarMensagem -> enqueueKommo('assinatura_send', {leadId, fieldId, value, botId}, {dedupeKey:`assinatura:${contratoId}:${leadId}`, source:'assinatura'}) -> drainNow(job.id)
//   fechada: postNote(leadId, `CBC.assinatura.manual:${contratoId}`, aviso vendedor) -> resultado 'fora_janela'
// status final: todos enviado->'ok'; nenhum->'fora_janela'/'erro'; misto->'parcial'
// update final kommo_assinatura por id; logAdvbox + heartbeat('kommo-assinatura')
// try/catch geral: grava {status:'erro', erro} (nunca deixa 'processando' orfao)
```
- [ ] **Step 2:** `node --check` no arquivo. Sem cron (`config` sem schedule).

### Task 4: Gancho no App.jsx

**Files:**
- Modify: `client/src/App.jsx:1591-1596` (onSaveAfterSend)

- [ ] **Step 1:** Capturar retorno e disparar fire-and-forget com `keepalive:true` + `x-bot-key: import.meta.env.VITE_BOT_PANEL_KEY`; nova mensagem: `'Contrato enviado para ZapSign. Dentro da janela de 24h o link segue automático pelo WhatsApp — confira a faixa no contrato.'`. Sem retry em polling (decisão nº 3).
- [ ] **Step 2:** `npx eslint src/App.jsx` sem erro novo.

### Task 5: UI M2 no ContratosTab

**Files:**
- Modify: `client/src/components/ContratosTab.jsx` (novo componente local `WhatsAppAssinaturaStrip` + render acima do painel de links ~1833; selos WA nas linhas ~1846-1869)

**Interfaces (Consumes):** `detail.kommo_assinatura` (shape das Global Constraints), `detail.dados.contratantes[].linkKommo`.

- [ ] **Step 1:** Componente com estados: `processando` (neutro "Verificando janela do WhatsApp…"), `ok` (verde, chips ✓ nome·hora), `parcial|fora_janela` (âmbar: título "WhatsApp não enviado: fora da janela de 24h", texto de envio manual SEM menção a reenvio automático, chips por contratante, ações **Abrir conversa** = linkKommo target _blank + **Copiar link**), `erro` (âmbar com texto de erro técnico + mesmas ações). Tokens: `var(--cbc-success*/warning*)`.
- [ ] **Step 2:** Selo `WA ✓` / `WA manual` por linha de link (função `waStatusForSigner(ka, signerName)` — casa por nome dentro de `leads[].contratantes`).
- [ ] **Step 3:** `npx eslint src/components/ContratosTab.jsx` sem erro novo.

### Task 6: Verificação + coerência dos mockups + docs

**Files:**
- Modify: `prototipos/assinatura-whatsapp-aviso/m2-faixa-no-contrato.html` e artifact (remover "Tentar de novo"/"tenta de novo sozinho"/re-tentativa; refletir comportamento final)
- Modify: `CLAUDE.md` (bloco Estado atual: entrada curta da feature, flag OFF)

- [ ] **Step 1:** `npx vitest run` (suíte toda) → PASS.
- [ ] **Step 2:** `npm run build` → sucesso.
- [ ] **Step 3:** Atualizar m2 + artifact (redeploy mesma URL) + CLAUDE.md + memória da sessão.
- [ ] **Step 4:** Relatório final ao Paulo com checklist de ativação (criar Salesbot → ligar flag → teste real → deploy via deploy.sh).

## Self-Review

- Cobertura do spec: lock/idempotência (T3), agrupamento 1-msg-por-lead (T1/T3), sem retry (T4 sem polling; T5 sem botão; T6 limpa mockup), janela+margem (T1/T3), nota interna (T3), auto-provisionamento campo/bot (T3), flag OFF (T0), UI M2 (T5), testes (T1), migração aditiva (T0). Sem placeholders; tipos/nomes consistentes entre tasks.
