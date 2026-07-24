# Vínculo Kommo no Novo Contrato — Implementation Plan (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o link do Kommo o 1º campo do Novo Contrato e, ao "Vincular", pré-preencher o cadastro a partir do lead (Kommo + Cadastro Único + Arquivo CBC Conversas) — tudo aditivo e atrás de feature flag.

**Architecture:** Camada Kommo-first no `FormPanel.jsx` atrás de flag (`bot_config.kommo_vinculo`). Lógica de preenchimento é **pura e testável** (`utils/kommoResolve.js`), orquestrada por uma função Netlify (`resolve-kommo-lead.mjs`) que lê o Kommo ao vivo, casa no `clientes` e consulta o Arquivo CBC Conversas via RPC. Flag off = form byte-idêntico ao de hoje.

**Tech Stack:** React 19 + Vite, Netlify Functions (Node 22, `.mjs`), Supabase (schemas `public` + `atendimento`), vitest.

## Global Constraints

- **Nada em produção sem OK do Paulo.** Deploy só via `client/deploy.sh`. Backup antes de editar (REGRA #1/#3).
- **Flag off = form byte-idêntico ao atual** (harness de fingerprint prova).
- **Nome nunca vem do Kommo** (vem do CPF/Cadastro). **CPF só dispara em lead novo.** **Origem manual + default "Tráfego pago".**
- **1 link por contrato** → contratante 0 (a pessoa da conversa). PJ → representante.
- Comentários em português sem acento no código; strings com acento. Funções Netlify em `.mjs`.
- Segredo das RPCs: `BOT_RPC_SECRET` (padrão asaas_mirror).

---

### Task 1: Migração — coluna de exceção + RPC do Arquivo CBC Conversas

**Files:**
- Create: `supabase_vinculo_kommo.sql` (registro versionado)
- Migrations aplicadas via MCP `apply_migration` (nome `vinculo_kommo_v1`) — **só com OK explícito do Paulo (toca o schema `atendimento`, compartilhado)**

**Interfaces:**
- Produces: coluna `contratos.sem_kommo jsonb`; RPC `atendimento.primeira_msg_por_telefone(p_tel text, p_chave text) returns table(primeira_msg timestamptz, tem_conversa boolean)`.

- [ ] **Step 1: Escrever o SQL** em `supabase_vinculo_kommo.sql`:

```sql
-- coluna de registro da excecao "sem Kommo"
ALTER TABLE public.contratos ADD COLUMN IF NOT EXISTS sem_kommo jsonb;

-- RPC: 1a mensagem no Arquivo CBC Conversas (schema atendimento e RLS deny-all)
CREATE OR REPLACE FUNCTION atendimento.primeira_msg_por_telefone(p_tel text, p_chave text)
RETURNS TABLE(primeira_msg timestamptz, tem_conversa boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = atendimento, public AS $$
DECLARE t11 text;
BEGIN
  IF p_chave IS DISTINCT FROM current_setting('app.bot_rpc_secret', true)
     AND p_chave IS DISTINCT FROM '__set_by_env__' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  t11 := right(regexp_replace(coalesce(p_tel,''),'\D','','g'), 11);
  IF length(t11) < 10 THEN RETURN QUERY SELECT NULL::timestamptz, false; RETURN; END IF;
  RETURN QUERY
  SELECT min(m.enviada_em), (count(*) > 0)
  FROM atendimento.contatos c
  JOIN atendimento.conversas cv ON cv.contato_id = c.id AND cv.excluida_em IS NULL
  JOIN atendimento.mensagens m ON m.conversa_id = cv.id
  WHERE right(regexp_replace(coalesce(c.whatsapp_numero,''),'\D','','g'),11) = t11;
END $$;

REVOKE ALL ON FUNCTION atendimento.primeira_msg_por_telefone(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION atendimento.primeira_msg_por_telefone(text,text) TO authenticated, service_role;
```

> Nota: o padrão exato do segredo (`_bot_chave_ok`/`current_setting`) deve seguir o já usado nas RPCs `asaas_mirror_*` — conferir `client/netlify/functions/_lib/asaasMirror.mjs` e a definição de uma RPC existente antes de aplicar, e alinhar a checagem de `p_chave` a esse padrão.

- [ ] **Step 2: Validar em leitura** (sem aplicar destrutivo): rodar o SELECT do corpo isolado contra um telefone conhecido e conferir que retorna a 1ª msg (já validado no design: 32,7% dos clientes têm conversa).
- [ ] **Step 3: Aplicar** via `apply_migration` **após OK do Paulo**; conferir `contratos.sem_kommo` existe e a RPC responde.
- [ ] **Step 4: Commit** do arquivo `supabase_vinculo_kommo.sql`.

---

### Task 2: Feature flag `kommo_vinculo`

**Files:**
- Modify: `bot_config` (linha de config via SQL) — `{"ativo": false, "usuarios": []}`
- Create: `client/src/hooks/useKommoVinculoFlag.js`
- Test: `client/src/utils/__tests__/kommoVinculoFlag.test.js`

**Interfaces:**
- Produces: `useKommoVinculoFlag()` → `{ ativo: boolean, loading: boolean }` (lê `bot_config.kommo_vinculo`; default off; liga por `ativo` global ou e-mail em `usuarios[]`).

- [ ] **Step 1:** teste puro de `resolveFlag(config, email)` (off por default; on se `ativo` ou email em `usuarios`).
- [ ] **Step 2:** rodar → falha.
- [ ] **Step 3:** implementar `resolveFlag` puro + o hook que faz o fetch de `bot_config` (chave `kommo_vinculo`) e chama `resolveFlag`.
- [ ] **Step 4:** rodar → passa.
- [ ] **Step 5:** inserir a config `kommo_vinculo` off no `bot_config`; commit.

---

### Task 3: Lógica pura de preenchimento `utils/kommoResolve.js` (TDD)

**Files:**
- Create: `client/src/utils/kommoResolve.js`
- Test: `client/src/utils/__tests__/kommoResolve.test.js`

**Interfaces:**
- Consumes: um objeto cru `{ lead, contato, tags, cliente, primeiraMsgConversas }` (montado pela função Netlify).
- Produces:
  - `extrairLeadId(link)` → string|null
  - `montarPreenchimento(raw)` → `{ campos: {telefone?, email?, rg?, dataNascimento?, profissao?, estadoCivil?, sexo?, cep?, endereco?, numero?, bairro?, cidade?, uf?, resort?, dataPrimeiraMensagem?}, proveniencia: {campo: 'kommo'|'cadastro'|'tag'|'conversas'}, clienteConhecido: boolean, resortConfirmar: boolean }`
  - **Nunca** inclui `nome` nem `origemCliente` em `campos`.

- [ ] **Step 1: Testes** cobrindo: (a) `extrairLeadId` de `.../leads/detail/123` e de URL inválida; (b) lead novo → só `telefone` (kommo) + `dataPrimeiraMensagem` (kommo) + `resort` (tag, `resortConfirmar:true`) se houver tag; (c) cliente conhecido → qualificação inteira com proveniência `cadastro`, `clienteConhecido:true`, e `dataPrimeiraMensagem` de `conversas` quando `primeiraMsgConversas` existe; (d) **nome e origem nunca aparecem em `campos`**; (e) não sobrescreve chaves já presentes marcadas como "manter".
- [ ] **Step 2:** rodar → falha.
- [ ] **Step 3:** implementar as funções puras (mapear tag→resort por match exato contra a lista `RESORTS`; normalizar telefone; montar proveniência).
- [ ] **Step 4:** `cd client && npx vitest run utils/__tests__/kommoResolve.test.js` → passa.
- [ ] **Step 5:** commit.

---

### Task 4: Função `resolve-kommo-lead.mjs`

**Files:**
- Create: `client/netlify/functions/resolve-kommo-lead.mjs`
- Reuse: `client/netlify/functions/_lib/kommo.mjs` (leitura de lead/contato/tags), cliente Supabase server-side.

**Interfaces:**
- Consumes: POST `{ link }` (auth: sessão Supabase — `db.auth.getUser`, padrão das functions que exigem usuário).
- Produces: JSON `{ ok, preenchimento, clienteConhecido, resortConfirmar, origemSugerida:'Trafego pago', avisos[] }` usando `montarPreenchimento` (Task 3).

- [ ] **Step 1:** implementar: extrair `lead_id` → `kommoGet('/leads/{id}?with=contacts')` + tags do lead + telefone do contato (`extractPhones`); casar no `clientes` por telefone/`kommo_lead_id`; chamar a RPC `atendimento.primeira_msg_por_telefone` com `BOT_RPC_SECRET`; passar tudo para `montarPreenchimento`.
- [ ] **Step 2:** tratamento de erro **não bloqueante** (Kommo fora / lead inexistente → `{ ok:false, motivo }`, o form cai na exceção). Throttle/erros logados via `logAdvbox`/`advbox_api_log` (origem `kommo`).
- [ ] **Step 3:** teste manual local com um `lead_id` real (via `netlify dev` ou chamada direta com token) — conferir shape do retorno.
- [ ] **Step 4:** commit.

---

### Task 5: UI — Passo 1 (link 1º campo) + gate + Vincular + Semáforo (atrás da flag)

**Files:**
- Create: `client/src/components/KommoVinculo.jsx` (a seção do topo + Semáforo)
- Modify: `client/src/components/FormPanel.jsx` (render condicional pela flag; esconder o `linkKommo` interno quando flag on; travar seções)
- Reuse: tokens `--cbc-*`, `LivePreview.jsx`/`contractHtml.js` intactos.

**Interfaces:**
- Consumes: `useKommoVinculoFlag()`, `montarPreenchimento` (via a function), `updateContratante`/`updateData` do contexto.
- Produces: `<KommoVinculo />` que, ao Vincular, chama `resolve-kommo-lead`, aplica `preenchimento` via `updateContratante(0, campos)` e destrava o form.

- [ ] **Step 1:** `KommoVinculo.jsx` — input do link (bind `contratante[0].linkKommo`), botão **Vincular**, estados (idle/carregando/vinculado/erro), Semáforo (Identidade/Origem/Resort/Contrato) derivado do estado do form, e link "Preencher sem vincular".
- [ ] **Step 2:** no `FormPanel.jsx`, **só quando `flag.ativo`**: renderizar `<KommoVinculo>` no topo; ocultar o campo `linkKommo` interno do contratante 0; aplicar classe de "travado/esmaecido" nas seções até `vinculado || semKommo`. **Quando `!flag.ativo`, zero mudança** (early return do bloco novo).
- [ ] **Step 3:** aplicar o `preenchimento`: `updateContratante(0, campos)` sem sobrescrever o já digitado; origem = default "Trafego pago"; resort com badge "confirmar".
- [ ] **Step 4:** verificar no navegador (flag on) — vincular um lead de teste, ver preenchimento + gate liberando; (flag off) — form idêntico.
- [ ] **Step 5:** commit.

---

### Task 6: Exceção "sem Kommo" (registro quem/quando/motivo)

**Files:**
- Create: `client/src/components/KommoSemVinculoModal.jsx`
- Modify: `KommoVinculo.jsx` (aciona o modal), gravação em `contratos.sem_kommo` no fluxo de salvar
- Test: `client/src/utils/__tests__/semKommo.test.js` (montagem do registro puro)

**Interfaces:**
- Produces: registro `{ user, ts, motivo }` gravado em `contratos.sem_kommo` ao salvar + espelho em `activity_log`; destrava o form manual.

- [ ] **Step 1:** teste puro do builder `montarRegistroSemKommo(email, motivo, agoraISO)`.
- [ ] **Step 2:** modal (motivo obrigatório + confirmação) → seta estado `semKommo` + guarda o registro no `data`.
- [ ] **Step 3:** ao salvar o contrato, incluir `sem_kommo` no payload; espelhar em `activity_log`.
- [ ] **Step 4:** verificar fluxo no navegador; commit.

---

### Task 7: Harness de regressão (flag off = idêntico) + fechamento

**Files:**
- Create: `client/scripts/regressao-form-fingerprint.mjs` (ou reutilizar padrão de harness já usado em outras ondas)

- [ ] **Step 1:** capturar fingerprint do form (flag off) antes das mudanças (baseline) e depois — provar byte-idêntico.
- [ ] **Step 2:** rodar `npm run lint` + `npx vitest run` (suíte verde).
- [ ] **Step 3:** checklist de fumaça (docs/SMOKE_CHECKLIST.md) nas telas afetadas.
- [ ] **Step 4:** commit; **NÃO deployar** — apresentar ao Paulo para OK de deploy.

---

## Self-Review

- **Cobertura do spec:** Passo-1/gate/Semáforo (Task 5) · Vincular/preenchimento (Tasks 3-5) · nome-via-CPF & origem-manual (Task 3 exclui ambos) · CBC Conversas (Tasks 1,4) · exceção (Task 6) · flag/regressão (Tasks 2,7) · contrato paralelo (reuso, sem task). ✓
- **Placeholders:** nenhum passo com "TODO"; RPC e lib têm código real; UI tem passos concretos (o detalhe fino de JSX se resolve na execução seguindo os componentes existentes). ✓
- **Consistência de tipos:** `montarPreenchimento`/`extrairLeadId` (Task 3) são consumidos com o mesmo nome nas Tasks 4-5; RPC assinada igual nas Tasks 1 e 4. ✓
- **Riscos:** aplicar migração no schema `atendimento` (compartilhado) exige OK explícito; a checagem do segredo da RPC deve copiar o padrão asaas_mirror (conferir antes de aplicar).
