# Cobrança — como adicionar um novo template (passo a passo)

Guia para **incluir um novo template de cobrança** (ex.: Cobrança 5) e ligá-lo no painel
de **Cobrança** (aba Boletos do CBC-Contratos). Mantido atualizado a cada template novo.

> Resumo do fluxo: **criar o template no Kommo → aprovar na Meta → criar o Salesbot →
> pegar o `bot_id` → registrar em `bot_config.cobranca.templates`**. Só depois do `bot_id`
> o painel consegue disparar.

---

## 0. Como funciona (visão geral)

- Os templates ativos ficam em **`bot_config.cobranca.templates`** (JSONB no Supabase).
  Cada item: `{ name, label, template_id, bot_id, corpo, botoes }`.
- O painel (`components/CobrancaPanel.jsx`) lê isso via `cobranca-listar` e mostra os
  templates no trilho de Cobrança. **Disparar exige `bot_id`** — sem ele, aparece "sem bot".
- O disparo (`cobranca-disparar.mjs`) **não envia o texto direto**: ele roda o **Salesbot do
  Kommo** (`bot_id`) via `POST /api/v4/bots/run`. O Salesbot é quem manda o template aprovado.
  Por isso o que importa para o envio é o **Salesbot (bot_id)**, não o `template_id` (que é
  só referência/auditoria).
- O **corpo é FIXO** (sem variável de valor/link). O boleto chega pelos **botões inline**
  ("Boleto atualizado / Já paguei / Falar com Financeiro"). Ao tocar "Boleto atualizado",
  o ramo do Salesbot avisa o **Anderson** (tarefa) e o link fica no campo de lead "Asaas"
  (field_id `2434598`), que o `cobranca_send` preenche antes de rodar o bot.

### Templates atuais (jun/2026)

| name | label | template_id (Kommo) | bot_id (Salesbot) |
|------|-------|---------------------|-------------------|
| `cobranca_1` | Cobrança 1 — Lembrete amigável | 59304 | 97854 |
| `cobranca_2` | Cobrança 2 — Empático/negociação | 59306 | 97868 |
| `cobranca_3` | Cobrança 3 — Regularização até fim do mês | 59308 | *(criar)* |
| `cobranca_4` | Cobrança 4 — Última chamada | 59310 | 97870 |

- **WABA**: Conforto Bergonsi Advogados (`1754322065533306`) · número `+55 19 98805-1878`.
- **Canal de envio**: WhatsApp "Conforto Bergonsi Advogados".
- A ordem do array (1‑2‑3‑4) define a **sugestão por faixa** nas Estágios via `PADRAO_TPL`
  em `CobrancaPanel.jsx` (`{1:0, 2:1, 3:2, 4:null}` → faixa 1→cob1, 2→cob2, 3→cob3, 4→manual).

---

## 1. Criar o template no Kommo + aprovar na Meta

1. Kommo → **Modelos de mensagem** (WhatsApp) → novo template **categoria Utilidade**,
   idioma **Português (BR)**.
2. Corpo (sem variável de valor/link) + os 3 botões de resposta rápida:
   **"Boleto atualizado"**, **"Já paguei"**, **"Falar com Financeiro"**.
3. Submeter. Vai para **"Em análise"** no Kommo e para revisão da Meta.

### Verificar se está APROVADO (importante)
- **Fonte da verdade = Meta**: WhatsApp Manager → Insights do modelo. **"Ativo"** = aprovado.
  ("Qualidade pendente" é normal para template novo sem envios — não impede.)
- ⚠️ O Kommo tem **cache atrasado**: pode mostrar **"Em análise"** mesmo já aprovado na Meta.
  O template **pode ser usado** quando a Meta aprova, **mas o Salesbot só consegue enviar
  depois que o status no Kommo sincronizar para aprovado** (costuma levar de minutos a horas).
  Antes de disparar em lote, confirme no Kommo que o modelo não está mais "Em análise".

---

## 2. Criar o Salesbot (a automação) — via Chrome, com o Kommo aberto

Não dá para criar Salesbot pela API (`POST /api/v4/bots` = 405). Faz-se na UI do Kommo.
**Jeito rápido = clonar um bot existente:**

1. Kommo → lista de **Salesbots** → no "Cobrança 1", botão **"copiar"** (clonar).
2. Renomear o clone para o nome do novo template (ex.: **"Cobrança 3"**).
3. No passo **"Enviar mensagem"** → trocar o **modelo** para o template novo (Cobrança 3).
4. **CRÍTICO p/ entregar em conversa fria** (senão roda 202 mas não entrega):
   - **Canais**: selecionar **só** o WhatsApp **"Conforto Bergonsi Advogados"** (não "Todos").
   - Ligar o toggle **"Se você nunca conversou em um canal: Tente enviar uma mensagem"**.
5. Replicar o ramo **"Boleto atualizado"**: resposta de texto + passo **Adicionar tarefa**
   para **Anderson Rafael Coutinho de Barros** (prazo Imediatamente, tipo Acompanhar,
   comentário "Cliente pediu o boleto atualizado — enviar 2ª via + PIX; link no campo Asaas").
   *(O aviso ao Anderson vale para TODOS os bots de cobrança — requisito do Paulo.)*
6. **SEM gatilho automático** (a gente dispara via API; gatilho "qualquer mensagem" foi
   recusado — dispararia pra todo mundo).
7. Salvar (fechar no X; confirmar que não pede "salvar antes de sair?").

---

## 3. Pegar o `bot_id` do Salesbot novo

- `GET /api/v4/bots` (auth `Bearer KOMMO_TOKEN`) e achar o bot pelo **nome**; o `id` é o `bot_id`.
- Alternativa: abrir o bot no Kommo e ler o id na URL.

---

## 4. Registrar no `bot_config.cobranca.templates` (Supabase)

SQL (idempotente; insere se ainda não existir e reordena por nome). Trocar os valores
de `name`/`label`/`template_id`/`bot_id`/`corpo`/`botoes`:

```sql
update bot_config
set value = jsonb_set(value, '{templates}', (
  select jsonb_agg(t order by ord) from (
    select e as t,
      case e->>'name' when 'cobranca_1' then 1 when 'cobranca_2' then 2
                      when 'cobranca_3' then 3 when 'cobranca_4' then 4
                      when 'cobranca_5' then 5 else 9 end as ord
    from jsonb_array_elements(
      coalesce(value->'templates','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'name','cobranca_5',
        'label','Cobrança 5 — <descrição>',
        'template_id', 0,                 -- id Kommo do template
        'bot_id', 0,                      -- bot_id do Salesbot (passo 3)
        'corpo','<texto do corpo>',
        'botoes', jsonb_build_array('Boleto atualizado','Já paguei','Falar com Financeiro')
      ))
    ) e
  ) s
), true), updated_at = now()
where key='cobranca'
  and not exists (select 1 from jsonb_array_elements(coalesce(value->'templates','[]'::jsonb)) x
                  where x->>'name'='cobranca_5');
```

Para **só ligar o `bot_id`** num template que já existe (ex.: depois de criar o Salesbot
de um template já registrado com `bot_id: null`):

```sql
update bot_config
set value = (
  select jsonb_set(value, '{templates}', jsonb_agg(
    case when e->>'name' = 'cobranca_3' then e || jsonb_build_object('bot_id', 97999) else e end
  )) from bot_config b2, jsonb_array_elements(b2.value->'templates') e
  where b2.key='cobranca'
), updated_at = now()
where key='cobranca';
```
*(troque `cobranca_3` e `97999` pelo template e bot_id reais.)*

---

## 5. Conferir no painel

- Abrir **Boletos → Cobrança → trilho "Cobrar"**: o template novo aparece na lista.
- Com `bot_id` preenchido, some o selo "sem bot" e o botão **Cobrar** habilita.
- **Antes do lote**: fazer 1 **disparo de teste** para um número próprio (lead cadastrado),
  conferir no WhatsApp (template + 3 botões + tarefa do Anderson ao tocar "Boleto atualizado").

---

## Checklist rápido

- [ ] Template criado no Kommo (Utilidade) + 3 botões
- [ ] **Meta = "Ativo"** (e Kommo já sincronizou, não mais "Em análise")
- [ ] Salesbot criado (clonar Cobrança 1) → modelo trocado → canal único + cold-start + tarefa Anderson
- [ ] `bot_id` obtido (`GET /api/v4/bots`)
- [ ] Registrado em `bot_config.cobranca.templates` (com `bot_id`)
- [ ] Conferido no painel + 1 disparo de teste
