# Comparecimento/No-show automático via log de auditoria do Meet — Design

> Spec aprovada na conversa de 23/07/2026. Origem: divergência entre o número de
> "agendamentos" puxado pelo sócio e o Dashboard, que expôs que a classificação
> compareceu/no-show hoje depende da vendedora **colorir** o evento na agenda — o
> que falha (evento sem cor, cor não-padrão, backfill incompleto).

## 1. Objetivo

Classificar **automaticamente** cada videochamada de venda como **compareceu**
(cliente entrou na sala) ou **no-show** (cliente não entrou), usando dados reais
de presença do Google Meet, **sem depender da cor** que a vendedora marca na
agenda. O sinal de cor continua existindo como registro do que a vendedora
anotou, mas o **log do Meet vence** quando os dois divergem.

### Contexto validado (23/07/2026, ao vivo, conta admin do Paulo)
- A presença do Meet vem do **log de auditoria do Meet** via **Admin Reports API**
  (`activities.list`, `applicationName=meet`, `eventName=call_ended`) — que **é
  diferente** do recurso premium "acompanhamento de participação" (esse só existe
  em Business Plus+/Essentials/Enterprise).
- **Provado que funciona no nosso Business Starter**: a chamada retornou HTTP 200
  com eventos `call_ended` do Meet, de hoje, na conta `advocaciacbc.com`. **Sem
  upgrade de plano.**
- O evento `call_ended` traz, por participante: `identifier` (e-mail/telefone/ID),
  `identifier_type`, `is_external`, `duration_seconds`, `calendar_event_id`,
  `organizer_email`, `display_name`.
- **`calendar_event_id` casa com `agenda_videochamadas.event_id`** (a chave do
  nosso espelho). Essa é a peça que o protótipo (Fase 1) confirma na prática.
- Retenção do log ~6 meses → backfill parcial possível (não alcança abril/2026).

## 2. Regras de negócio (decididas pelo Paulo)

### 2.1 Regra de presença ("compareceu")
Uma videochamada é **compareceu** se, no log do Meet daquele evento, existe **pelo
menos um participante que NÃO é interno do escritório e que ficou mais de 5
minutos** (300s) na sala.

- **Interno** = participante cujo e-mail termina em `@advocaciacbc.com`.
- **Cliente (não-interno)** = qualquer participante que **não** seja interno —
  inclui explicitamente **participantes anônimos** (entraram pelo link sem conta
  Google, sem e-mail) e participantes por telefone. Ou seja: a condição de interno
  exige um e-mail `@advocaciacbc.com`; na dúvida, conta como cliente.
- **Duração** = soma dos `duration_seconds` das sessões do mesmo participante
  (um participante pode entrar/sair várias vezes). Presente se a soma > 300s.

Se **nenhum** não-interno passou de 5 min → **no-show**.
Se **não há registro** no log para o `calendar_event_id` (fora da retenção, ou
Meet não usado) → **mantém a cor atual** (não afirmamos nada).

> Limitação conhecida: vendedora que entra por conta pessoal (e-mail fora de
> `@advocaciacbc.com`) contaria como "cliente". Raro; mitigado pelo piso de 5 min
> e pelo hábito de entrar pela conta do escritório. Fica documentado.

### 2.2 Regra de reconciliação (log vence a cor)
Para cada evento com registro no log:
- não-interno > 5 min presente → **realizada** (mesmo que a cor diga no-show/sem-cor)
- nenhum não-interno > 5 min → **no-show** (mesmo que a cor esteja verde)
Sem registro no log → status permanece o da cor.
Eventos `excluida` (apagados da agenda) **permanecem fora** das contagens,
independentemente do log.

## 3. Arquitetura em duas fases

**Fase 1 — Protótipo de validação (não grava nada).** Prova o casamento e a regra
com dados recentes, para o Paulo confirmar antes de qualquer escrita.

**Fase 2 — Automação (só após validar).** Persiste o status derivado, faz backfill
e roda diariamente; o Dashboard passa a refletir o status reconciliado.

### 3.1 Autenticação (comum às duas fases)
Estender o OAuth que **já usamos para a agenda** (`GOOGLE_OAUTH_*` em
`_lib/googleAgenda.mjs`) adicionando o escopo **`admin.reports.audit.readonly`**:
1. Adicionar o escopo na tela de consentimento do OAuth client.
2. Paulo (super admin) faz **1 consentimento** incluindo agenda + reports.
3. Gerar novo **refresh token** e atualizar a env `GOOGLE_OAUTH_REFRESH_TOKEN`.
Somente leitura. Nada de service account (decisão do Paulo).

Novo lib `_lib/meetAudit.mjs` (puro): renova access token (reutiliza o padrão do
googleAgenda), pagina `activities.list` e **parseia** os `call_ended` em uma
estrutura `{ calendar_event_id -> { participantes: [{id, interno, seg}], ... } }`.
A função de classificação (participantes → compareceu/no-show) é **pura e testável**.

## 4. Fase 1 — Protótipo de validação

Function nova **`meet-auditoria-validacao.mjs`** (disparo manual, protegida por
`BOT_PANEL_KEY`, igual aos outros painéis de bot):

1. Consulta o log (`meetAudit.mjs`) dos **últimos N dias** (default 4).
2. Agrupa `call_ended` por `calendar_event_id`; aplica a regra de presença (§2.1).
3. Carrega de `agenda_videochamadas` as videochamadas do mesmo período
   (`event_id`, `status`, `color_id`, `vendedora_email`, `scheduled_at`).
4. Cruza por `event_id == calendar_event_id` e monta um **relatório JSON**:
   - `casaram` / `sem_registro_no_log` / `no_log_sem_evento_nosso`
   - por chamada: cor atual, status derivado, **divergência** e o motivo
     (participantes não-internos e suas durações)
   - agregados: nº de verdes que na real foram no-show, nº de vermelhos que
     tiveram cliente, taxa de casamento do `calendar_event_id`.
5. **Não grava nada** em `agenda_videochamadas`.

Critério de sucesso: alta taxa de casamento do `calendar_event_id` e divergências
plausíveis (ex.: a chamada da Mariana que ficou sem cor aparece com presença real).

## 5. Fase 2 — Automação (após validação)

### 5.1 Modelo de dados
Migração `meet_auditoria` — colunas novas em `agenda_videochamadas`:
- `meet_conferido_em timestamptz` — quando o log foi consultado p/ este evento
- `meet_cliente_presente boolean` — houve não-interno > 5 min
- `meet_cliente_seg int` — maior soma de duração de um participante não-interno
- `meet_status text` — `realizada` | `no_show` derivado do log (null = sem registro)
- `meet_participantes jsonb` — resumo `[{id, interno, seg}]` para auditoria

### 5.2 Reconciliação sem mexer no frontend
A view **`vw_funil_videochamadas`** passa a expor:
- `status = coalesce(meet_status, <status da cor>)` → **log vence a cor**
- `status_cor` (a cor original) e `origem_status` (`meet`|`cor`) para auditoria
Como `Dashboard.jsx`/`compute.js` já leem `status, scheduled_at` dessa view, o
Dashboard reflete o status reconciliado **sem alteração de código no frontend**.
`excluida` continua excluída na view.

### 5.3 Backfill
Function background `meet-auditoria-backfill.mjs` (lotes encadeados, cursor em
`bot_config`, padrão dos outros backfills): varre o log dia a dia para trás até o
limite de retenção (~6 meses) e grava `meet_*` nos eventos que casam. Abril/2026
provavelmente fica fora da janela (segue só com a cor).

### 5.4 Cron diário
`meet-auditoria-sync.mjs` — schedule diário (~04h BRT, `0 7 * * *`), reprocessa os
**últimos 3 dias** (idempotente: upsert por `event_id`) para pegar eventos que o
log ainda estava assentando e remarcações. Loga em `advbox_api_log` (origem
`meet`) como as demais integrações.

### 5.5 Novas vendedoras (Emerson + Mizael) — APROVADO
Incluir `emerson@advocaciacbc.com` **e** `mizael@advocaciacbc.com` na lista
`VENDEDORAS` de `googleAgenda.mjs` (hoje só `beatriz@` + `marianamaciel@`) para as
agendas deles passarem a ser espelhadas em `agenda_videochamadas` — a partir daí o
log de auditoria do Meet já os cobre automaticamente. Como esses dois e-mails
também são internos (`@advocaciacbc.com`), a regra de presença §2.1 já os trata
como "não-cliente" corretamente, sem ajuste.

## 6. Casos de borda
- **Anônimo/telefone**: sem e-mail `@advocaciacbc.com` → conta como cliente (ok).
- **Múltiplas sessões** do mesmo participante: somar `duration_seconds` por `identifier`.
- **Evento sem `calendar_event_id`** no log (Meet ad-hoc sem agenda): ignorado (não casa).
- **Evento excluído**: permanece `excluida`, fora das contagens.
- **Sem registro no log**: mantém a cor; `meet_status` = null.
- **Fuso**: casamento é por `calendar_event_id`, não por horário → imune a fuso; a
  janela da consulta usa UTC.
- **Paginação**: `activities.list` devolve ≤1000/página + `nextPageToken`; o backfill pagina.

## 7. Segurança
- Escopo novo é **somente leitura** (`admin.reports.audit.readonly`).
- Functions protegidas por `BOT_PANEL_KEY` (padrão dos painéis).
- `meet_participantes` guarda e-mails de clientes (mesma sensibilidade de
  `cliente_email` já existente) — RLS de `agenda_videochamadas` inalterada.

## 8. Testes
- **Lógica pura** (`meetAudit.mjs` classificação) em vitest: internos vs clientes,
  piso de 5 min, múltiplas sessões, anônimo, sem registro.
- **Fase 1 é o teste de integração**: o relatório do protótipo contra dados reais
  dos últimos dias, revisado pelo Paulo.

## 9. Decisões abertas / dependências do Paulo
1. Consentir o escopo do relatório e gerar o novo refresh token (setup de auth).
2. Incluir ou não a agenda do **Emerson** na Fase 2 (§5.5).
3. Confirmar o relatório da Fase 1 antes de liberar a Fase 2.

## 10. Rollback
- Fase 1 não grava nada → sem rollback.
- Fase 2: colunas são **aditivas**; a reconciliação vive na view — reverter =
  restaurar `vw_funil_videochamadas` para `status = <cor>` (o `./rollback.sh` do
  deploy reverte o código; a view tem o SQL de rollback no arquivo da migração).
