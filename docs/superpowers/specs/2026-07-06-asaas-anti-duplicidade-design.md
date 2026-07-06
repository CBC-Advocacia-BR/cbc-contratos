# Anti-duplicidade no lançamento de parcelas Asaas — Design

**Data:** 2026-07-06
**Autor:** Claude Code (aprovado por Paulo Conforto)
**Branch:** melhorias-auditoria-2026-07

## Problema

Auditoria dos 12.379 boletos / 1.324 parcelamentos do espelho `asaas_boletos` encontrou
**25 clientes com parcelamentos duplicados** (2 grupos cobrindo a MESMA janela de vencimento):

- 21/25 criados **manualmente** no painel do Asaas (descrição "Distrato cota X", sem
  `external_reference`, sem contrato no sistema) — erro humano que nenhuma trava de código evita hoje.
- 4/25 criados **pelo próprio sistema**, todos **antes** de a trava atômica #24 existir (25-26/06/2026).

Causa-raiz do caso de referência (Camila da Cunha, CPF 33220970800): lançado 2× em 30/04/2026,
os dois grupos com o mesmo `external_reference` e a descrição automática do sistema — na época
**não havia trava atômica**; a única proteção era esconder o botão na tela (`contract._launched`),
que não segura duplo-clique/relançamento.

## Estado atual do código (o que já protege e o que não)

- ✅ `AsaasPanel.jsx` `LaunchBtn.go()` tem a **trava atômica #24**: `UPDATE asaas_status='launching'
  WHERE asaas_status IS NULL OR asaas_status='error'`. Bloqueia duplo-clique / relançamento do
  MESMO contrato. (Deployada ~25-26/06/2026.)
- ✅ Não há auto-lançamento de Asaas na assinatura (App.jsx). Asaas é 100% manual.
- 🐛 **Import** (`importContrato.js` STEP 4) chama `create-payment` mas **não grava** `asaas_status`/
  `asaas_payments`/`asaas_customer_id` no contrato → contrato importado fica "Pendente" na aba Asaas
  e pode ser lançado de novo (a trava só checa `asaas_status`).
- ⚠️ A trava é por `contrato.id`: 2 linhas de contrato para o mesmo cliente = 2 lançamentos possíveis.
- ⚠️ O sistema nunca consulta o Asaas antes de lançar → não pega parcelamento pré-existente (manual).

## Decisões (Paulo, 2026-07-06)

1. **Ação ao detectar duplicata:** avisar e deixar confirmar (não cria sozinho; botão
   "Lançar mesmo assim"). NÃO bloquear de vez — preserva o caso legítimo de parcelamentos
   sequenciais (35 clientes hoje têm 2 grupos consecutivos, provavelmente intencional).
2. **Gatilho do alerta:** cliente já tem parcela **em aberto** (PENDING/OVERDUE) no Asaas.

## Solução

Princípio: a checagem anti-duplicata vai no **servidor** (`asaas-sync.mjs` / `create-payment`),
não na tela — assim vale para todos os caminhos (botão + import) e consulta o Asaas de verdade
(pega inclusive parcelamentos manuais).

### Mudança 1 — Helper puro + checagem no servidor (`asaas-sync.mjs` + `_lib/asaasDedup.mjs`)

- Novo módulo puro `_lib/asaasDedup.mjs` com `summarizeOpenParcelamentos(payments)`:
  recebe a lista de payments do Asaas e retorna 1 resumo por grupo que tem ≥1 parcela em aberto:
  `{ installmentId, count, total, firstDue, lastDue, description, hasOpen }`.
  Boletos avulsos (sem installment) abertos entram como grupo próprio (`installmentId: null`,
  chaveado por payment id). Testado em vitest.
- No `create-payment`, após achar/criar o cliente e **antes** de criar a cobrança:
  - Se `payload.force !== true`: consulta `GET /payments?customer={id}&status=PENDING`
    e `status=OVERDUE`, junta, roda `summarizeOpenParcelamentos`. Se houver grupo em aberto →
    retorna `{ success:false, duplicate_warning:true, existing:[...], customer }` **sem criar**.
  - Se `payload.force === true`: pula a checagem e cria normal.
- Escopo: só `create-payment`. `create-single` / `create-single-payment` (avulsos) ficam de fora.

### Mudança 2 — Botão trata o aviso (`AsaasPanel.jsx` `LaunchBtn`)

- `go()` chama sem `force`. Se vier `duplicate_warning`:
  - **libera a trava**: `asaas_status` volta a `null` (não fica preso em "launching").
  - guarda `existing` no estado e mostra aviso inline listando os parcelamentos abertos
    (valor total, nº de parcelas, 1º→último vencimento), com **"Lançar mesmo assim"** e **"Cancelar"**.
  - "Lançar mesmo assim" → rechama `go({ force:true })` → sucesso grava `launched` como hoje.
  - "Cancelar" → limpa o aviso (trava já está `null`).
- Sucesso e erro seguem idênticos ao atual. Trava atômica #24 intacta.

### Mudança 3 — Import grava lançamento e respeita o aviso (`importContrato.js` STEP 4)

- Após `create-payment` com sucesso: persiste `asaas_status='launched'` + `asaas_payments=json.payment`
  + `asaas_customer_id=json.customer?.id` no contrato (corrige o bug de origem).
- Se voltar `duplicate_warning`: NÃO força; marca a etapa Asaas como
  "atenção: cliente já tem parcelamento ativo — não lançado" para o operador resolver na aba Asaas.

## Fora de escopo / não faço

- Não excluir, cancelar ou alterar nenhum boleto existente (os 25 casos são tratados manualmente
  no Asaas pelo Paulo/financeiro).
- Não fazer deploy — implementar, rodar lint + testes + build, e apresentar para aprovação do deploy.

## Testes

- `_lib/__tests__/asaasDedup.test.mjs`: cobre `summarizeOpenParcelamentos` — grupo de parcelamento
  com abertos, grupo 100% pago (não alerta), avulso aberto, DELETED ignorado, lista vazia,
  agrupamento por installment, ordenação de vencimentos.
- Lint + `npm run test` + `npm run build` limpos antes de apresentar.

## Arquivos tocados

- `client/netlify/functions/_lib/asaasDedup.mjs` (novo)
- `client/netlify/functions/_lib/__tests__/asaasDedup.test.mjs` (novo)
- `client/netlify/functions/asaas-sync.mjs`
- `client/src/components/AsaasPanel.jsx`
- `client/src/utils/importContrato.js`
