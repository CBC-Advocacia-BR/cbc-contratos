# Kommo — Como parar de duplicar contatos/leads

> Diagnóstico (23/06/2026): a mesma pessoa (mesmo telefone+nome) reentra no funil e o Kommo **cria um CONTATO novo** em vez de casar com o existente. ~936 contatos recriados só na janela de junho do espelho. Dois agravantes: telefone em formatos diferentes (12 vs 13 dígitos — o "9º dígito") que derruba o match, e o Controle de Duplicatas provavelmente fraco/desligado.
>
> A API do Kommo **não mescla** registros existentes — então prevenção é config no painel + faxina periódica.

## 1. Ligar o Controle de Duplicatas (a barragem principal)
Settings/Configurações → seção **Controle de duplicatas** (Duplicate control). Referência oficial com telas: https://www.kommo.com/support/crm/duplicate-control/

Ativar os métodos de match:
- ✅ **Telefone** (essencial — é a chave que temos)
- ✅ **BIG DATA** (detecção por machine learning; é o que funde conversas de chat)
- ✅ **E-mail** (quando houver)
- ⬜ Campo personalizado **CPF** — só vale quando o campo estiver preenchido (hoje é campo morto; ver item 4)

Ação ao detectar duplicata: **"Atualizar o lead existente com os novos dados"** (NÃO "criar novo"). Assim o retorno do cliente cai no contato que já existe.

## 2. Corrigir a FONTE — mensageria/WhatsApp
A maioria dos duplicados nasce no canal de entrada criando contato novo a cada conversa.
- Em cada integração de mensageria (WhatsApp), garantir que **mensagem de número já conhecido reabre/vincula ao contato existente**, não cria outro. O Controle de Duplicatas por telefone (item 1) cobre boa parte disso, mas confira o comportamento do canal específico.
- Rode o **script de diagnóstico** (`exports/kommo-duplicados/diagnostico_fonte_kommo.cjs`) para ver o `created_by`/source/canal exato que está gerando os duplicados e mirar a correção.

## 3. Padronizar o telefone na entrada (E.164)
O match por telefone só funciona com formato consistente. Padronizar para **`+55 DDD 9XXXXXXXX`** (13 dígitos) em todo ponto que grava telefone:
- Formulários/landing pages → máscara fixa com DDI 55 e 9º dígito.
- Importações de planilha → normalizar a coluna antes de subir.
- Integrações de API → enviar sempre em E.164.

## 4. Habilitar o CPF como chave definitiva (médio prazo)
CPF é único por pessoa (telefone/nome não são). Hoje o campo CPF do Kommo está vazio.
- O **CBC Contratos tem o CPF** (obrigatório) e o `linkKommo` → dá pra gravar o CPF de volta no contato do Kommo no fluxo do contrato (gancho a construir).
- Com o campo preenchido, ative o CPF como método de match no item 1. Vira a defesa mais sólida.

## 5. Faxina periódica (rede de segurança)
Prevenção nunca é 100%.
- **Manual em lote**: Leads → menu **"..."** → **"Find duplicates"** (mescla escolhendo quais dados manter). Ref.: https://www.kommo.com/support/crm/duplicates/
- **Automático**: widget de mercado (ex.: "Automatic Duplicate Search") mescla por regra — útil porque a API não mescla.
- **Monitoramento**: relatório semanal de duplicados novos (function agendada a construir) pra nunca mais acumular milhares calado.

## Como verificar que funcionou
Depois de ativar 1–3, rodar de novo o levantamento de duplicados (mesmo método do espelho `kommo_leads` por telefone+nome) dali a ~2 semanas: o número de **contatos recriados no período** tem que despencar. Se não cair, o vazamento está na fonte (item 2) — usar o diagnóstico.
