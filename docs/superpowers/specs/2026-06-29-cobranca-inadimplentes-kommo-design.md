# Spec — Painel de Cobrança de Inadimplentes (CBC-Contratos × Kommo)

- **Data:** 2026-06-29
- **Projeto:** cbc-contratos
- **Autor:** Paulo Conforto + Claude
- **Status:** Aprovado para virar plano de implementação

---

## 1. Objetivo

Criar, **dentro da aba Boletos do CBC-Contratos**, um painel de **Cobrança de Inadimplentes** que:

1. Lista os inadimplentes (boletos em aberto) já cruzados com o lead do Kommo.
2. Permite o operador **selecionar o público e escolher o template na hora** e disparar, sob demanda, um **template de utilidade de WhatsApp via Kommo**.
3. Mostra **métricas**: resultado das últimas cobranças, histórico de disparos e **eficácia por template** (medida por **pagamento do boleto**).

É uma feature **on-demand** (acionada por botão), não uma automação agendada. Reaproveita ao máximo os trilhos que já existem no projeto.

## 2. Decisões já fechadas (não reabrir sem necessidade)

| Tema | Decisão |
|------|---------|
| Canal de envio | **WhatsApp nativo do Kommo** (o escritório já dispara templates aprovados a clientes "frios"). |
| Onde aciona | **Botão na aba Boletos** do CBC-Contratos; pode refatorar o design da aba. |
| Métrica de eficácia | **Pagamento do boleto** — sucesso = boleto vira pago em até `janela_pagamento_dias` após o disparo. |
| Escolha do template | **"Eu escolho na hora"** — operador seleciona template + público a cada disparo. |
| Mecanismo de envio | **Salesbot do Kommo** via a fila `kommo_queue` (kind `salesbot`, já suportado). |

## 3. Contexto técnico existente (o que já está pronto — reaproveitar)

- **Frontend:** React 19 + Vite + Tailwind 4, tokens `--cbc-*` (dark-aware). Aba Boletos = `client/src/components/BoletosPanel.jsx` (+ `InadimplenciaStrip.jsx`, `BoletoRow`, `statusTokens`, `MoneyValue`, virtualização `react-window`). Tab key `boletos` (RBAC via `user_permissions.tabs`). O front fala com Supabase direto (`supabase-js`) e com funções Netlify via `/api/*` → `/.netlify/functions/*` (`utils/apiEndpoints.js`).
- **Fila Kommo:** `kommo-queue-worker.mjs` (cron `* * * * *`) drena `kommo_queue`. Kinds suportados: `lead_field`, `contact_field`, `lead_move`, `salesbot`, `task`, `note`. Helpers em `_lib/kommo.mjs`: `enqueueKommo()`, `runSalesbot()`, `setLeadField()`, `extrairLeadId()`, `findCustomFieldByName()`, `getLeadsByIds()`. Throttle ~5 req/s + backoff.
- **Régua existente (modelo de referência):** `cobranca-regua.mjs` (cron, hoje **desligada** via `REGUA_COBRANCA_ATIVA=false`) já faz, por boleto: casa o lead, (opcional) **seta campo + roda Salesbot WhatsApp**, posta nota idempotente e grava em `cobranca_regua`. O disparo manual é, em essência, uma versão UI-driven e multi-template dessa ação.
- **Dados de inadimplência:** `asaas_boletos` (corrigido em 29/06 para incluir negativação). Bucket EM ABERTO = `OVERDUE` + `DUNNING_REQUESTED` + (`PENDING` com `due_date < hoje`). PAGO = `RECEIVED`/`CONFIRMED`/`RECEIVED_IN_CASH`/`DUNNING_RECEIVED`. `payment_date` é a base da conversão. `asaas-webhook.mjs` atualiza status quase em tempo real.
- **Vínculo CPF→Lead:** `clientes.kommo_lead_id` (incompleto — ~30/93), `contratos.dados->contratantes[].linkKommo` (via `extrairLeadId`), e a tabela `kommo_leads` (17,9k: `lead_id`, `contact_id`, `cpf_cnpj`, `telefone`).
- **Consentimento (opt-in):** tabela `ads_consents` (`wa_phone`, `opt_in_source`, `opted_in_at`, `evidence`).
- **Restrição de escrita (importante):** `SUPABASE_SERVICE_ROLE_KEY` **não está configurada** → funções gravam como `anon` e esbarram no RLS. Padrão adotado no projeto (espelho Asaas): **escrever via RPC `SECURITY DEFINER` protegida por `BOT_RPC_SECRET`** (`_bot_chave_ok`). Toda escrita nova deste módulo segue esse padrão.

## 4. Arquitetura (fluxo ponta a ponta)

```
[Aba Boletos → sub-painel "Cobrança"]
  1. carrega lista de inadimplentes enriquecida  (RPC cobranca_inadimplentes)
  2. operador filtra + seleciona linhas + escolhe template (dropdown de bot_config.cobranca.templates)
  3. PREVIEW (qtd, sem-lead, opt-out, cooldown, texto resolvido)
  4. CONFIRMAR  → POST /.netlify/functions/cobranca-disparar
        UNIDADE DO DISPARO = DEVEDOR (CPF): 1 WhatsApp por devedor por disparo
        (agrega as parcelas em aberto; NUNCA 1 msg por parcela). boleto-ancora =
        boleto em aberto MAIS ANTIGO do devedor (usado no link de pagamento/variaveis).
        para cada devedor selecionado:
          a. casa o lead (clientes.kommo_lead_id → contratos.linkKommo → kommo_leads por CPF/telefone)
          b. aplica regras (cooldown, opt-out, sem-lead) → pula com motivo registrado
          c. seta variáveis do template em campos do lead (setLeadField)   [nome, total em aberto, link do boleto-ancora]
          d. enqueueKommo('salesbot', { leadId, bot_id })                   [template escolhido]
          e. RPC cobranca_disparo_registrar(...) grava 1 linha em cobranca_disparos (por devedor)
  5. kommo-queue-worker (cron 1min) drena → roda o Salesbot no Kommo → WhatsApp envia o template
  6. conversão: asaas-webhook (PAYMENT_RECEIVED/CONFIRMED) marca disparos abertos do boleto como pago;
     reconciliador agendado (cobranca-conciliar) cobre retardatários
  7. dashboard do painel lê cobranca_disparos (taxa de pagamento por template, histórico, R$ recuperado)
```

## 5. Modelo de dados

### 5.1 Nova tabela `cobranca_disparos`
**Uma linha por (devedor × disparo)** — não por parcela. Fonte única das métricas de eficácia.

| coluna | tipo | nota |
|--------|------|------|
| `id` | bigint PK | |
| `customer_cpf` | text | dígitos — chave do devedor |
| `customer_name` | text | |
| `lead_id` | bigint | lead Kommo casado (null se sem-lead) |
| `template_name` | text | nome do template/Salesbot escolhido |
| `canal` | text | default `whatsapp_kommo` |
| `boleto_ancora_id` | text | boleto em aberto mais antigo (`pay_…`) — base do link e da conversão |
| `total_em_aberto_no_disparo` | numeric | soma das parcelas em aberto do devedor (snapshot) |
| `parcelas_no_disparo` | int | nº de parcelas em aberto (snapshot) |
| `dias_atraso_no_disparo` | int | maior atraso do devedor (snapshot) |
| `resultado` | text | `enfileirado` / `pulado` / `erro` |
| `motivo_pulo` | text | `sem_lead` / `opt_out` / `cooldown` / null |
| `kommo_queue_id` | bigint | job enfileirado (rastreio) |
| `pago` | boolean | default false — boleto-âncora pago dentro da janela |
| `pago_em` | date | |
| `dias_ate_pagamento` | int | `pago_em - disparado_em::date` |
| `disparado_por` | text | email do operador |
| `disparado_em` | timestamptz | default now() |
| `dedupe_key` | text | `cpf:template:YYYYMMDD` (anti-duplo-clique) |

RLS: fechada para `anon`; leitura para `authenticated`; **escrita só via RPC `SECURITY DEFINER`**. Índices: `(customer_cpf)`, `(boleto_ancora_id)`, `(template_name)`, `(disparado_em)`, unique `(dedupe_key)`.

**Conversão:** `pago=true` quando o `boleto_ancora_id` vira pago em até `janela_pagamento_dias` após `disparado_em`. (Métrica conservadora e atribuível ao template; medir "quitou tudo" fica para a Fase 2.)

### 5.2 Config `bot_config.cobranca` (JSONB — mesmo padrão de `bot_config`)
```jsonc
{
  "janela_pagamento_dias": 7,
  "cooldown_dias": 5,
  "excluir_em_acordo": true,
  "templates": [
    { "name": "lembrete_amigavel", "label": "Lembrete amigável", "bot_id": 0,
      "variaveis": ["nome", "valor", "link_pagamento"] }
  ]
}
```
O mapeamento **template → `bot_id` do Salesbot** vive aqui (preenchido depois que os Salesbots forem criados no Kommo).

### 5.3 RPCs novas (`SECURITY DEFINER` + `BOT_RPC_SECRET`)
- `cobranca_inadimplentes(p_chave)` → lista enriquecida: boletos em aberto + lead casado (cascata) + último disparo (data/template/resultado) + flag opt-out. Base da tela.
- `cobranca_disparo_registrar(p_chave, p_rows)` → insere/atualiza linhas em `cobranca_disparos` (idempotente por `dedupe_key`).
- `cobranca_marcar_pago(p_chave, p_boleto_id, p_pago_em)` → usada pelo webhook/reconciliador.

## 6. Backend (Netlify Functions, `.mjs`)

- **Nova `cobranca-disparar.mjs`** (HTTP POST, autenticada via chave de painel como as demais). Body: `{ template, boletoIds[], dryRun? }`. Faz casamento de lead, aplica cooldown/opt-out, `setLeadField` das variáveis, `enqueueKommo('salesbot', …)`, e grava via `cobranca_disparo_registrar`. `dryRun:true` retorna o preview (quem entra, quem é pulado e por quê) **sem enfileirar**.
- **Nova `cobranca-conciliar.mjs`** (cron, ex.: `0 12 * * *`): reconcilia `cobranca_disparos.pago` lendo `asaas_boletos.payment_date` dentro da janela — pega o que o webhook não cobriu.
- **Alterar `asaas-webhook.mjs`**: nos eventos de pagamento, chamar `cobranca_marcar_pago` para o boleto pago (conversão quase em tempo real).
- **Reuso:** `_lib/kommo.mjs` (lead-match + salesbot + enqueue), `_lib/botDb.mjs` (`db.rpc`, `logAdvbox`), `kommo-queue-worker.mjs` (drenagem, intocado).

## 7. Frontend (React, na aba Boletos)

- **Novo `components/CobrancaPanel.jsx`** montado como segmento/sub-aba da aba Boletos (`BoletosPanel.jsx`), reaproveitando `InadimplenciaStrip`, `StatusPill`/`statusTokens`, `MoneyValue` e a virtualização `react-window`.
  - **Seleção:** lista de inadimplentes (RPC `cobranca_inadimplentes`) com filtros (dias de atraso, valor mín., "tem lead", "não cobrado há N dias", excluir em acordo), seleção em massa, dropdown de template.
  - **Preview/confirmação:** modal chamando `cobranca-disparar` em `dryRun` → mostra contagem, pulados (sem-lead/opt-out/cooldown) e o texto resolvido; confirma → dispara.
  - **Dashboard:** KPIs (disparos no período, taxa de pagamento em `janela_pagamento_dias`, R$ recuperado), **ranking de eficácia por template** (enviados / pagos / %), e **histórico** de disparos (tabela). Tudo nos tokens `--cbc-*`.
- Refator de design da aba Boletos liberado, desde que **desktop intocado por padrão** (regra de ouro do mobile do projeto) e dentro do design system.

## 8. Compliance (advocacia)

- Enviar **só ao próprio devedor**; nunca a terceiros (CDC art. 42 / LGPD).
- Respeitar **opt-in** (`ads_consents`) e **opt-out**; excluir quem optou por sair.
- **Cooldown** (`cooldown_dias`) por boleto evita reenvio/spam.
- Conteúdo **transacional** (dívida real e existente), sem tom de ameaça — requisito de template de utilidade da Meta.
- **Auditoria:** `cobranca_disparos.disparado_por` + `logAdvbox`.

## 9. Dependências externas (destravam o disparo — fora do código)

1. **Salesbot(s) no Kommo** configurados para enviar o(s) template(s) de utilidade aprovados (POST /bots = 405 → criação manual). Para "escolho na hora", o caminho recomendado é **um Salesbot por template** e mapear `template → bot_id` em `bot_config.cobranca.templates`.
2. **Template(s) de utilidade aprovado(s) na Meta** + seus `bot_id`.
3. Confirmar **`BOT_RPC_SECRET`** configurada (já é usada pelo espelho Asaas).
4. (Recomendado, não bloqueia) rotacionar `KOMMO_TOKEN` (exposto) antes de subir volume.

## 10. Faseamento

- **Fase 1 (MVP):** tabela `cobranca_disparos` + `bot_config.cobranca` + RPCs + `cobranca-disparar` (com `dryRun`) + `CobrancaPanel` (listar/filtrar/escolher template/preview/confirmar/enfileirar) + conversão via webhook + métricas básicas (taxa de pagamento, ranking por template, histórico).
- **Fase 2:** `cobranca-conciliar` agendado, gestão de opt-out na UI, comparador A/B head-to-head entre templates, e (opcional) religar a auto-régua logando na mesma `cobranca_disparos`.

## 11. Não-objetivos (YAGNI)

- Não medir "resposta no WhatsApp" na Fase 1 (só pagamento).
- Não disparar via Cloud API da Meta (decisão: nativo-Kommo).
- Não automatizar agendamento de cobrança (é sob demanda).
- Não criar Salesbot via API (não é possível; é manual no Kommo).

## 12. Riscos & mitigações

| Risco | Mitigação |
|------|-----------|
| Salesbot do Kommo não enviar o template como esperado | Validar com 1 disparo de teste (`bot_testers`/lead próprio) antes de liberar em massa; `dryRun` para conferir público. |
| Lead não casado para parte dos inadimplentes (~63/93) | Cascata de casamento + marcar `sem_lead` e exibir no preview; opção futura de criar lead. |
| Escrita sob RLS (sem service role) | RPCs `SECURITY DEFINER` + `BOT_RPC_SECRET` (padrão já em uso). |
| Conversão atribuída ao template errado se houver 2 disparos ao mesmo devedor | `dedupe_key` (`cpf:template:dia`) + atribuição ao disparo mais recente dentro da janela. |
| Rate limit do Kommo em disparo grande | Fila já faz throttle ~5 req/s + backoff; disparo em lote respeita isso naturalmente. |

## 13. Verificação (como saber que funcionou)

- `dryRun` lista corretamente público/pulados.
- 1 disparo de teste chega no WhatsApp como template.
- `cobranca_disparos` grava a linha; `kommo_queue` registra o job `salesbot` e o worker o marca `done`.
- Ao pagar o boleto-âncora de um devedor cobrado, `pago=true`/`pago_em` populam (via webhook) e o ranking por template atualiza.
