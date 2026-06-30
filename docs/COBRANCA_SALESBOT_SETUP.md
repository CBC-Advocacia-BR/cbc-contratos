# Guia — Criar o Salesbot de Cobrança no Kommo

Passo a passo para criar o bot que (1) envia o template de cobrança e (2) responde
automaticamente quando o cliente toca os botões. Depois de criado, o painel
**Boletos → Cobrança** dispara esse bot sob demanda.

---

## 0. Pré-requisitos (já prontos — não precisa fazer nada)

- **Templates UTILITY aprovados na Meta:** Cobrança 1 (id `59304`), Cobrança 2 (`59306`), Cobrança 4 (`59310`). (Cobrança 3 / `59308` ainda em análise.)
- **Campo de lead "Asaas" (id `2434598`)** — o sistema **grava nele o link do boleto** (página Asaas com 2ª via + PIX atualizados) no momento do disparo.
- **Painel + backend** já publicados: o botão "Cobrar" chama `POST /api/v4/bots/run` com o `bot_id` do template escolhido. Só falta existir o bot.

> Comece com **um bot só, para a Cobrança 1**. Dá para estrear e testar; depois clona para a 2 e a 4.

---

## 1. Abrir o construtor de Salesbot

No Kommo (`advocaciacbc.kommo.com`):

1. Menu **Leads** → abra o funil **"Venda"**.
2. No topo do funil, clique em **Automatizar** (Automate).
3. Em **Bots / Salesbot**, clique em **+ Criar bot** (ou "Adicionar" → "Bot" → "Criar novo").
4. Abre o **construtor visual** (blocos arrastáveis). Dê o nome **`Cobrança 1`** (o nome importa — é por ele que eu puxo o `bot_id`).

> O caminho exato dos menus pode variar um pouco conforme a versão do Kommo. O que importa é chegar no **construtor visual de Salesbot**. Se quiser, eu abro o seu Kommo e te mostro a tela exata.

---

## 2. Bloco 1 — Enviar o template

1. Adicione o bloco **Enviar mensagem**.
2. Em **canal/origem**, escolha **WhatsApp** (sua WABA).
3. Marque a opção de enviar **Modelo / Template** e selecione **Cobrança 1**.
   - O `{{contact.first_name}}` e os 3 botões já vêm dentro do template — não precisa redigitar.

---

## 3. Bloco 2 — Aguardar a resposta do cliente

1. Depois do envio, adicione o passo **Aguardar a resposta do cliente** (o bot pausa até o cliente responder ou tocar um botão).
2. (Opcional) Defina um tempo limite (ex.: 3 dias) para encerrar o bot se não houver resposta.

> Quando o cliente toca um botão (quick-reply), o texto do botão volta como **mensagem** dele — e isso **abre a janela de 24h**, liberando responder com **texto livre** (sem novo template).

---

## 4. Bloco 3 — Ramificar por botão (Condição)

Adicione um bloco **Condição** olhando a **mensagem recebida** (a resposta do cliente). Crie 3 ramos:

| Se a resposta contém… | Ação do bot |
|---|---|
| **"Boleto"** (Boleto atualizado) | **Enviar mensagem**: `Claro! Segue seu boleto atualizado (2ª via + PIX): {{lead.cf.2434598}}` — insira o campo **"Asaas"** pelo seletor de campos do bot (é o `2434598`). |
| **"paguei"** (Já paguei) | **Enviar mensagem**: `Que ótimo! 🙏 Pode nos enviar o comprovante aqui mesmo?` (opcional: criar **tarefa** para o Financeiro conferir). |
| **"Financeiro"** (Falar com Financeiro) | **Transferir o lead** para o usuário do Financeiro (ou criar tarefa "Cliente quer falar com Financeiro"). |

> Dica: use "contém" em vez de "igual a" — assim pequenas variações de texto ainda casam.

---

## 5. Salvar e ativar

1. **Salvar** o bot.
2. Confirme que ele está **ativo**.
3. Confira o nome final (**`Cobrança 1`**).

---

## 6. Ligar no painel (eu faço)

Me avise que o bot foi criado. Eu rodo `GET /api/v4/bots`, acho o **`bot_id`** pelo nome e coloco em `bot_config.cobranca.templates`. A partir daí o botão **"Cobrar"** do painel passa a disparar a Cobrança 1 de verdade.

---

## 7. Teste controlado (antes de abrir pro resto)

1. No painel **Boletos → Cobrança**, filtre **1 devedor de teste** (idealmente um lead seu / seu número cadastrado).
2. Clique **Cobrar** → **Pré-visualizar** → **Disparar**.
3. Confira no WhatsApp: chegou o template? Toque **"Boleto atualizado"** → deve chegar o link.
4. Se OK, libere para o grupo.

---

## 8. Cobrança 2 e 4

- Jeito simples: **clonar** o bot "Cobrança 1", renomear para **`Cobrança 2`** / **`Cobrança 4`** e trocar o template no Bloco 1 (e ajustar os textos das respostas se quiser).
- Jeito avançado (1 bot só): um bot com condição inicial que escolhe o template — mais trabalhoso de montar; só se preferir um `bot_id` único.

---

## Referência rápida

| Item | Valor |
|---|---|
| Conta Kommo | `advocaciacbc.kommo.com` (API v4) |
| Funil / etapa | Venda `13760367` |
| Template Cobrança 1 / 2 / 4 | `59304` / `59306` / `59310` |
| Campo do link do boleto | "Asaas" → `lead.cf.2434598` |
| Endpoint que dispara | `POST /api/v4/bots/run` (via fila `kommo_queue`, kind `cobranca_send`) |
| Config | `bot_config.cobranca.templates[].bot_id` (preenchido após criar o bot) |
