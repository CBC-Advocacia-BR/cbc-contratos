# Vínculo Kommo no Novo Contrato — Design

**Data:** 2026-07-23 · **Branch:** `feat/vinculo-kommo-novo-contrato` · **Status:** aprovado pelo Paulo, aguardando plano de implementação.

## 1. Objetivo

Tornar o **link do Kommo o primeiro campo do formulário de Novo Contrato** e, ao **Vincular**, pré-preencher o máximo possível do cadastro a partir do lead (Kommo + Cadastro Único + Arquivo CBC Conversas), reduzindo digitação e erro. A camada é **aditiva e atrás de feature flag**: com a flag **desligada** o `FormPanel.jsx` é byte-idêntico ao de hoje.

## 2. Decisões do Paulo (fechadas)

- **Gate rígido**: com a flag ligada, o formulário abre travado/esmaecido até (a) **Vincular** com sucesso, ou (b) **"Preencher sem vincular"** (fluxo de exceção).
- **Link do Kommo = 1º campo** do form (novo "Passo 1 — Vínculo" no topo, acima da seção Contratante), com o layout adequado ao gate.
- **1 link por contrato**: preenche o **contratante 1** (a pessoa da conversa). Se PJ, o lead é o **representante**. O 2º contratante (casal) não tem link próprio.
- **Nome NUNCA vem do Kommo**: vem da **integração de CPF** (lead novo) ou do **Cadastro Único** (cliente conhecido). O nome de contato do Kommo é ignorado.
- **CPF**: a API de CPF só dispara em **lead novo** (sem match no Cadastro). Ao digitar o CPF, ela preenche nome (+nascimento).
- **Origem do cliente**: **não é auto-detectável** (referral do Meta não vem no Kommo — verificado; tag de origem só 2,2% dos leads; amojo exige credencial de canal que não temos). Fica **manual com default "Tráfego pago"**; se houver tag de origem no lead, aproveita.
- **Resort por tag**: match **exato** (33% dos leads têm tag de resort) com **confirmação obrigatória**; dicionário de aliases fica para uma onda posterior.
- **Prontidão** exibida como **Semáforo** (Identidade/Origem/Resort/Contrato) + selos de origem por campo. **Nome não conta como "do Kommo"**.
- **Contrato em paralelo**: reusa `LivePreview.jsx` + `contractHtml.js` (já existem).

## 3. Layout (flag on)

Ordem das seções do form passa a ser:

1. **Passo 1 — Vínculo Kommo** (novo, topo): input do link (ligado a `contratante[0].linkKommo`) + botão **Vincular** + **Semáforo** de prontidão + link discreto **"Preencher sem vincular"**. Enquanto não vincular nem usar a exceção, as seções abaixo ficam **travadas/esmaecidas**.
2. Contratante(s) — inalterada (o campo `linkKommo` interno some quando a flag está ligada, pois o link foi para o Passo 1; para o 2º contratante não há link).
3. Resort & Ação → 4. Honorários → 5. Cláusulas → 6. Dados internos → ações (Salvar/PDF/DOCX/ZapSign).

Com a flag **off**, nada disso aparece: o `linkKommo` volta a ser o campo interno do contratante, na posição de hoje.

## 4. O que o "Vincular" preenche

Chama a função nova `resolve-kommo-lead` com o `lead_id` extraído do link.

| Campo | Fonte | Observação |
|---|---|---|
| Telefone | Contato Kommo | Confiável |
| Data da 1ª mensagem | **CBC Conversas** (match por telefone) → senão criação do lead | Ver RPC §5 |
| Qualificação inteira (RG, nascimento, profissão, est. civil, gênero, endereço, e-mail) + resort | **Cadastro Único** (`clientes`, match por telefone/kommo_lead_id) | Só **cliente conhecido** (~33%). Não sobrescreve o já digitado. |
| Resort | **Tag do lead** (match exato) | Sempre com confirmação. Só se não veio do Cadastro. |
| **Nome** | **CPF** (lead novo) ou **Cadastro** (conhecido) | **Nunca do Kommo.** |
| **Origem** | Manual, default "Tráfego pago" (+ tag de origem se houver) | Não auto-detectável. |
| CPF | API de CPF, **só lead novo** | Ao digitar o CPF → preenche nome (+nascimento). |

## 5. Infra

- **Feature flag** em `bot_config` (ex.: `bot_config.kommo_vinculo = {ativo, usuarios[]}`). Off = form atual. Liga por ambiente e depois por usuário.
- **RPC nova** `atendimento.primeira_msg_por_telefone(p_tel text, p_chave text)` **SECURITY DEFINER** (o schema `atendimento` é RLS deny-all; a service role não está no Netlify do cbc-contratos). Protegida por segredo (padrão `BOT_RPC_SECRET`/asaas_mirror). Retorna `{primeira_msg timestamptz, tem_conversa bool}` casando `whatsapp_numero` pelos últimos 11 dígitos.
- **Função nova** `client/netlify/functions/resolve-kommo-lead.mjs`: extrai `lead_id`, lê **ao vivo** no Kommo (lead + contato + tags via `_lib/kommo.mjs`), casa no `clientes` (por telefone/`kommo_lead_id`), chama a RPC do CBC Conversas. Throttle pelo `kommo_queue`/limite de 15 req/min. Retorna um objeto de preenchimento + proveniência por campo.
- **Migração** `contratos.sem_kommo` (jsonb): registro da exceção `{user, ts, motivo}` + espelho em `activity_log`.
- **Reuso total** do form atual: OCR, PJ, 2 contratantes, detecção de duplicata, LivePreview — **nada removido**.

## 6. Exceção "sem Kommo"

Botão "Preencher sem vincular" → modal confirma que não há lead + coleta **motivo** + registra **quem/quando/motivo** (`contratos.sem_kommo` + `activity_log`) → libera o form manual, com carimbo da decisão no topo. É também o **fallback** se o Kommo estiver fora do ar (o gate nunca deixa o form inutilizável).

## 7. Regressão (não pode quebrar nada)

- Toda a camada atrás da flag; **flag off = snapshot byte-idêntico** do form de hoje (harness de fingerprint antes/depois).
- Partes puras (resolve/merge/proveniência) cobertas por **vitest** em `utils/__tests__`.
- Backup dos arquivos antes de editar (REGRA #1/#3); deploy só via `deploy.sh` com OK do Paulo (REGRA #4/#14); trava de deploy respeitada.

## 8. Escopo por onda

- **v1 (fatia fina):** Passo 1 (link 1º campo) + Vincular + gate + exceção + Semáforo + `resolve-kommo-lead` preenchendo telefone / 1ª msg / join Cadastro / resort-tag (confirmar). Origem manual+default. Migração + RPC + flag.
- **Ondas seguintes:** dicionário de aliases do resort (subir dos 33%); flag por usuário; origem por tag refinada; eventual persistência do resultado do resolve.

## 9. Fora de escopo (YAGNI)

Detecção de origem por campanha (inviável hoje); reescrita do form; mexer em OCR/PJ/duplicata; auto-preencher o 2º contratante.
