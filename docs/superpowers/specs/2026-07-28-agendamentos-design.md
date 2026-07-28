# Aba de Agendamentos — Design

> Status: **desenho aprovado seção a seção pelo Paulo em 28/07/2026**, aguardando revisão final do spec.
> Próximo passo: plano de implementação (skill `writing-plans`).

## 1. Objetivo

Criar uma aba **Agendamentos** no CBC Contratos com dois modos de uso:

1. **Link público** — o cliente escolhe o próprio horário, e a página captura os sinais de navegador (`_fbp`, `fbc`, IP, user-agent) que hoje **não existem** em nenhum evento de Lead.
2. **Tela interna** — o comercial visualiza as quatro agendas, agenda pelo cliente, remarca e marca o resultado.

Em ambos, o evento é criado no **Google Agenda** da vendedora, com Meet, e um **Lead** é enviado à API de Conversões da Meta.

### Por que isso importa

No painel da Meta, os quatro maiores parâmetros faltantes do Lead são exatamente os que só uma página própria entrega:

| Parâmetro | Ganho estimado pela Meta |
|---|---|
| Identificação de clique (`fbc`) | +32% |
| Endereço IP | +32% |
| Agente do usuário | +32% |
| Identificação do navegador (`fbp`) | +24% |

Mais o ganho que não aparece na lista: **deduplicação navegador ↔ servidor**, disparando o pixel e a CAPI com o mesmo `event_id`. Hoje não existe em nenhum evento do CBC.

**Ressalva registrada:** o `fbc` só é capturado se a pessoa chegar à página com `fbclid` na URL — ou seja, vindo de clique em anúncio direto para lá. No fluxo atual (anúncio → WhatsApp → link enviado pela vendedora), ele **não vem**. Só entraria se um dia a campanha apontar direto para a página de agendamento.

---

## 2. Decisões do Paulo

Todas confirmadas explicitamente durante o levantamento de 28/07/2026.

| # | Tema | Decisão |
|---|---|---|
| 1 | Roteamento | **Híbrido**: link genérico com rodízio + links direcionados por vendedora |
| 2 | Regras de disponibilidade | **Uma regra global**, parametrizável no sistema — só Paulo, Bruno e Lorenza editam |
| 3 | Campos do formulário público | **Só nome, telefone e e-mail.** Sem CPF, CEP ou nascimento |
| 4 | Agendamento interno | **Tela interna + página pública**, as duas |
| 5 | Fonte da verdade | **Google Agenda**, com busca ao vivo + verificação antes de gravar + push do Google |
| 6 | Remarcação/cancelamento pelo cliente | **Só remarcar.** Cancelar exige falar com alguém |
| 7 | Avisos | **Só convite de agenda + e-mail.** WhatsApp fica fora por ora. Tempos parametrizáveis |
| 8 | Momento do envio à Meta | **No instante do agendamento**, com os sinais frescos |
| 9 | Status do atendimento | **Cor no Google + botões na aba** — as duas formas |
| 10 | Prioridade de leads | **Só link direcionado** (julgamento humano). O link genérico distribui **igual** entre as quatro |
| 11 | Nome da vendedora na página | **Não aparece** — o redirecionamento deve ser invisível ao cliente |
| 12 | Privacidade / LGPD | **Sem aviso nenhum na página** — decisão deliberada do Paulo (ver §11) |
| 13 | Fuso horário | **Detectado do cliente**, rótulo visível e trocável. Interno sempre em Brasília |
| 14 | Anti-abuso | Limite por IP + limite por telefone/e-mail (que vira oferta de remarcação) |

### Descartado com motivo

- **Campo "empreendimento"** no formulário — daria um sinal de valor forte (2× de variação na cota mediana entre resorts, dado que já existe em `vendas_expectativa_honorarios`), mas o Paulo optou por não adicionar campo. Sem ele, não há roteamento automático por qualidade; a priorização fica no julgamento humano via link direcionado.
- **WhatsApp para lembretes** — infraestrutura existe (`cobranca-disparar.mjs` via Salesbot do Kommo), mas depende do Paulo criar o Salesbot. Fora do escopo desta fase.
- **Cal.com / Calendly** — perderia o controle do pixel e a página sairia do domínio do escritório.
- **Verificação anti-robô (Turnstile)** — documentada como reserva, caso apareça abuso real.
- **Peso no rodízio** — cogitado para dar mais volume à vendedora mais experiente, descartado pelo Paulo em 28/07. O link genérico distribui igual; quem quiser direcionar usa o link específico. Se um dia voltar, é uma coluna em `agenda_vendedores` e um ajuste no sorteio.

---

## 3. Arquitetura

```
┌─ NAVEGADOR DO CLIENTE ────────────┐   ┌─ NAVEGADOR DA EQUIPE ─────────┐
│  agendar.html  (bundle próprio)   │   │  index.html  (app existente)  │
│  • escolhe dia → horário → dados  │   │  • aba Agendamentos           │
│  • pixel Meta (fbp, fbc, event_id)│   │  • tela de config (sócios)    │
└───────────────┬───────────────────┘   └───────────────┬───────────────┘
                └──────────────┬────────────────────────┘
                               ▼
         ┌─ NETLIFY FUNCTIONS (guardam o token do Google) ─┐
         │  slots · criar · remarcar · status              │
         │  redistribuir · webhook-google · renovar-canais │
         └──────┬──────────────────────────┬───────────────┘
                ▼                          ▼
      ┌─ GOOGLE AGENDA ──┐      ┌─ SUPABASE ───────────────────┐
      │ FONTE DA VERDADE │      │ agenda_config    (parâmetros)│
      │ 4 agendas + Meet │      │ agenda_vendedores            │
      └──────────────────┘      │ agenda_agendamentos (trava)  │
                                │ agenda_videochamadas(espelho)│
                                │ ads_capi_events  (fila Meta) │
                                └──────────────────────────────┘
```

### Princípios

1. **O Google manda.** O Supabase é espelho e trava, nunca dono. Se divergir, o Google vence. Isso elimina a classe inteira de bugs de sincronização bidirecional.
2. **O token nunca vai ao navegador.** Toda conversa com o Google acontece nas Netlify Functions.
3. **A trava de concorrência é do Postgres, não do Google** — o Google aceita eventos sobrepostos sem reclamar. Ordem obrigatória: **reserva no banco → cria no Google**.
4. **Três caminhos para saber de mudanças**: abrir a tela (latência zero) · push do Google (segundos) · cron de 45min existente (rede de segurança).

### Por que entrada própria do Vite

O app interno tem **~36.900 linhas só nos 82 arquivos `.jsx`** (mais 90 arquivos `.js`) e **não usa roteador** — as abas trocam por estado no `App.jsx`. Colocar a página pública dentro dele faria o cliente baixar o sistema inteiro para escolher um horário — e página lenta derruba agendamento.

`agendar.html` como segunda entrada do Vite dá bundle separado, mantendo um repositório e um deploy. Vite faz multi-página nativamente.

---

## 4. Modelo de dados

### `agenda_config` (uma linha)

`duracao_min` · `buffer_min` · `antecedencia_min` · `janela_dias` · `janela_semanal` (jsonb por dia da semana) · `lembretes_min` (int[]) · `atualizado_por` · `atualizado_em`

Valores iniciais sugeridos: 30 / 10 / 120 / 14 / seg–sex 09:00–12:00 e 13:30–18:00 / [1440, 60].

### `agenda_vendedores`

`email` (chave, bate com a agenda do Google) · `nome` · `ativo` (botão de pausa/férias) · `slug` (link direcionado)

Nasce com as quatro atuais: `beatriz@`, `marianamaciel@`, `emerson@`, `mizael@`.

### `agenda_agendamentos`

**Horário:** `vendedor_email` · `inicio` · `fim` · `status` (reservado → confirmado → cancelado/remarcado) · `google_event_id` · `meet_link`

**Cliente:** `cliente_nome` · `cliente_telefone` · `cliente_email` · (internos, opcionais) `cliente_cpf` · `cliente_cep` · `cliente_nascimento`

**Origem:** `origem` (publico/interno) · `link_slug` · `criado_por` · `kommo_lead_id`

**Meta:** `fbp` · `fbc` · `client_ip` · `user_agent` · `capi_event_id`

**Remarcação:** `token_remarcacao` (código aleatório do link do e-mail)

```sql
UNIQUE (vendedor_email, inicio) WHERE status IN ('reservado','confirmado')
```

Essa restrição é o que garante "um horário, um agendamento". O Postgres resolve atomicamente.

### Decisões de modelagem

- **Sinais do navegador ficam aqui**, não só na fila da Meta, porque a remarcação precisa reenviar com o **mesmo `capi_event_id`** — senão a Meta conta a mesma pessoa duas vezes.
- **`agenda_vendedores` separada da config** porque a lista muda com rotatividade, enquanto os parâmetros são estáveis.
- **O status (realizada/no-show/fechou) NÃO é guardado aqui** — vive na cor do evento no Google, que é a fonte da verdade. A aba lê do espelho `agenda_videochamadas` e, ao marcar, escreve a cor no Google.

### Tabelas existentes, sem alteração estrutural

- `agenda_videochamadas` — espelho de tudo que está no Google (inclui eventos criados na mão)
- `ads_capi_events` — fila da Meta, já com o sender resiliente

---

## 5. Fluxos

### A. Cliente agenda sozinho

1. Abre `/agendar` ou `/agendar/{slug}` → pixel dispara PageView, captura `_fbp` e `fbclid`→`fbc`
2. Escolhe o dia → função `slots` consulta a ocupação real do Google + aplica as regras → devolve horários **unidos**, sem revelar de quem
3. Escolhe horário, preenche nome, telefone, e-mail
4. Envia:
   1. Escolhe a vendedora (link direcionado tenta a dona primeiro; senão rodízio entre as livres, em partes iguais)
   2. **INSERT** em `agenda_agendamentos` (status `reservado`) — a trava decide quem ganha
   3. Perdeu → *"esse horário acabou de ser preenchido"* e a lista recarrega
   4. Confere a ocupação ao vivo de novo (rede contra evento criado pelo celular nos últimos segundos)
   5. Cria o evento no Google: Meet + cliente como convidado + **sem cor**
   6. `status = confirmado`, grava `google_event_id` e `meet_link`
   7. Enfileira o Lead em `ads_capi_events` com os sinais
   8. Falha no passo 5 → libera a reserva e devolve erro
5. Confirmação: resumo + botões **Adicionar ao Google Agenda** e **.ics (Apple/Outlook)**
6. Pixel dispara o Lead no navegador com o **mesmo `event_id`** do servidor

> **A ordem dos passos 4.2 e 4.5 é obrigatória: banco primeiro, Google depois.** Invertida, dois clientes simultâneos criariam eventos sobrepostos.

### B. Vendedora agenda pela aba

Mesmo caminho, com três diferenças:
- Escolhe **explicitamente** a vendedora (sem rodízio)
- Formulário tem **CPF, CEP e nascimento** como opcionais — ela pergunta na conversa, onde não há custo de fricção
- **Sem sinais de navegador** — quem está no navegador é ela; mandar o IP dela associaria o lead à pessoa errada

### C. Cliente remarca

Link do e-mail com `token_remarcacao` → escolhe novo horário → reserva o novo, move no Google, convite reenviado automaticamente.
**Não dispara segundo Lead** — reusa o `capi_event_id`.

### D. Redistribuir (férias)

1. Sócio marca a vendedora como **inativa** → sai do rodízio na hora
2. Sistema lista os atendimentos futuros dela
3. Ao confirmar, **todos a partir daquele momento** são movidos; o Google reenvia o convite atualizado
4. Sem ninguém livre no horário → sinalizado para resolução manual. O sistema **não** inventa horário nem move o cliente sem avisar

> **A verificar na implementação:** a API do Google tem endpoint de mover evento entre agendas, preservando identificador e convidados. Confirmar se o **link do Meet sobrevive**. Se não, o caminho é recriar o evento — muda o que o cliente vê, não o desenho.

### E. Marcar resultado

Botões **Realizada / Não compareceu / Fechou** gravam a cor no Google (10 / 11 / 7). O funil continua lendo a cor como sempre. Quem prefere pintar pelo celular continua podendo.

> **Cor de criação:** o sistema cria **sem cor**. Confirmado na base: `colorId` nulo = status `agendada` (73 eventos hoje nesse estado). Nenhuma convenção nova para a equipe aprender.

---

## 6. Erros e casos-limite

### Concorrência

| Situação | Comportamento |
|---|---|
| Dois clientes, mesmo horário | Trava do Postgres — o segundo vê aviso e a lista recarrega |
| Cliente e vendedora ao mesmo tempo | Mesma trava, sem caminho privilegiado |
| Dois internos editando o mesmo agendamento | *"Alguém alterou enquanto você editava"*, com o que mudou |

### Google

- **Erro ao criar** → libera a reserva na hora. Nunca fica reserva presa bloqueando horário.
- **Erro ao listar** → mostra erro. Cair para o espelho ofereceria horário já ocupado.
- **Token expirado** → ⚠️ **já aconteceu**: `agendas ja expirou uma vez (23/07) sem alerta` (comentário em `agenda-videochamadas-sync.mjs`). Antes parava o sync; agora pararia a página pública. **Alerta ativo é obrigatório.**

### Reserva órfã

Reserva em `reservado` há mais de **5 minutos** é considerada morta e liberada — senão um processo interrompido bloquearia o horário para sempre.

### Meta / CAPI

**Falha no envio nunca bloqueia o agendamento.** Só enfileira em `ads_capi_events` e segue; a fila já tem repetição e o sender isola evento problemático.

### Dados do cliente

Telefone e e-mail validados **no servidor**, não só no front. Antecedência mínima reavaliada no envio (a tela pode ter ficado aberta).

### Sem horários

*"Sem horários disponíveis nos próximos X dias"*, **sem revelar o motivo** — coerente com a decisão #11.

### Push do Google

Canais expiram → cron de renovação com alerta. Notificação repetida → tratada de forma idempotente. Endpoint é público → **valida o token do canal**.

### Anti-abuso

O endpoint fica aberto na internet; sem proteção, um script poderia entupir as quatro agendas.

- **Limite por IP** — teto de tentativas por hora
- **Limite por telefone/e-mail** — já existe agendamento ativo → avisa e **oferece remarcar** (converte o bloqueio em ação útil)

---

## 7. Telas e componentes

### Página pública

1. **Escolha do horário** — padrão Calendly: mês à esquerda, horários à direita, fuso visível e trocável. Sem nome de vendedora.
2. **Formulário** — nome completo, telefone, e-mail.
3. **Confirmação** — resumo + botões de adicionar à agenda.
4. **Remarcação** — as mesmas telas, via token.

Estados obrigatórios: sem horários · horário tomado · já existe agendamento (com botão de remarcar) · erro de comunicação.

### Aba interna

1. **Calendário da semana** — quatro colunas, uma por vendedora, com marcação de quem veio pelo link público
2. **Novo agendamento** — vendedora, horário, dados do cliente + opcionais
3. **Detalhe** — dados, link do Meet, botões de status, remarcar, cancelar
4. **Configuração** (só sócios) — parâmetros, vendedoras com pausa e link direcionado, botão de redistribuir

### Componentes

**Interno:** `AgendamentosTab` · `CalendarioSemana` · `AgendamentoModal` · `AgendamentoDetalhe` · `AgendaConfigPanel` · hooks `useAgendaSlots`, `useAgendamentos`

**Público:** `SeletorDia` · `SeletorHorario` · `FormularioCliente` · `Confirmacao` · `BotoesAdicionarAgenda`

**Limite: nenhum acima de ~300 linhas.** O sistema já tem arquivos de 2.500 linhas (`VendasPanel.jsx`) e este trabalho não vai criar mais um.

### Permissões

| Ação | Quem |
|---|---|
| Ver todas as agendas | Todos os internos |
| Criar, remarcar, cancelar, marcar status — **em qualquer agenda** | Todos os internos |
| Configurar parâmetros, cadastrar vendedoras, pausar, redistribuir | **Só Paulo, Bruno e Lorenza** |

### Acabamento visual

As skills `frontend-design:frontend-design` e `impeccable:impeccable` entram **na construção**, sobre a estrutura acima. Este documento define **o que existe**, não **como fica**. As telas passam por aprovação do Paulo antes de produção.

---

## 8. Testes

O projeto já usa **Vitest**.

**Automatizado:**
1. **Cálculo de horários livres** — janela semanal, duração, buffer, antecedência, janela de dias; dia sem janela; ocupação parcial; evento que atravessa o fim do expediente
2. **Rodízio** — distribuição igual entre as ativas; pausada nunca é escolhida; link direcionado tenta a dona primeiro e cai para as outras quando ela não tem horário
3. **Trava de concorrência** — duas inserções no mesmo horário contra o banco real. *É o teste mais importante do projeto*
4. **Reserva órfã** — liberada após 5 minutos
5. **Remarcação não duplica o Lead** — mesmo `capi_event_id`
6. **Validações no servidor**

**Mockado:** todas as chamadas ao Google. Testam-se os caminhos de erro (falha ao criar libera reserva; token expirado alerta; evento apagado marca cancelado).

**Fora do escopo automatizado:** a API do Google e o acabamento visual.

**Homologação sem sujar produção:**
- **Agenda de teste** no Google durante a homologação
- **`test_event_code`** — já existe em `ads_settings.meta_capi`; preenchido, os eventos aparecem na aba "Eventos de teste" sem entrar nas métricas reais

**Roteiro de verificação ao vivo antes de liberar:**
1. Agendamento completo → evento na agenda certa, com Meet e convite
2. Lead no Gerenciador de Eventos com `fbp`, IP e user-agent
3. Duas abas no mesmo horário → uma ganha, a outra recebe aviso
4. Remarcação → evento movido, convite reenviado, **sem** segundo Lead
5. Pausar e redistribuir → convites atualizados

---

## 9. Pré-requisitos (dependem do Paulo, bloqueiam o funcionamento)

1. **Escopo de escrita no Google.** Hoje é `calendar.events.readonly`; precisa virar `calendar.events`, com o refresh token regerado. A autenticação é **OAuth**, não conta de serviço — a política da organização bloqueia chaves de conta de serviço (`iam.disableServiceAccountKeyCreation`).
2. **Compartilhamento das agendas.** As quatro vendedoras precisam dar permissão de *"fazer alterações em eventos"* à conta que detém o token. Sem isso, o sistema não escreve na agenda delas.

---

## 10. Alinhamento com a CAPI existente

O Lead deste sistema entra na mesma fila (`ads_capi_events`) e usa o mesmo `meta-capi-sender`. Consistente com o que já está em produção:

- O `fn_capi_enqueue_videochamada` **já enfileira o Lead no agendamento** (não depois da call), o que bate com a decisão #8
- O sender já é resiliente: um evento inválido não derruba o lote
- O nome já é tratado com a regra de validação anti-contaminação; a página pública **elimina a heurística**, porque o cliente digita o nome completo

**Ganho esperado sobre o Lead atual:** nome e sobrenome corretos em 100% (hoje 57,69% e 28,85%), mais `fbp`, IP e user-agent, que hoje são 0%.

---

## 11. Nota de conformidade

O Paulo decidiu explicitamente, em 28/07/2026, que a página **não terá aviso de privacidade, banner de cookies nem caixa de consentimento**.

O ponto foi levantado e a decisão é dele, como advogado e responsável pelo escritório. Fica registrado aqui apenas para que a escolha seja rastreável — e para que, se um dia a orientação mudar, se saiba que o sistema foi construído sob essa premissa e o que precisaria ser acrescentado (aviso na página, disparo condicional do pixel).

---

## 12. Fora de escopo desta fase

- Lembretes por WhatsApp (infra existe; depende do Salesbot)
- Cancelamento pelo cliente
- Roteamento automático por valor do lead (exigiria o campo empreendimento)
- Captura de `fbc` no fluxo WhatsApp (exigiria campanha apontando direto para a página)
- Widget de assinatura do ZapSign
