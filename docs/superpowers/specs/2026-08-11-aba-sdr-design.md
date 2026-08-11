# Aba SDR — Design

> Status: **desenho aprovado pelo Paulo em 11/08/2026** (arranjo 8 do protótipo), aguardando revisão final deste documento.
> Protótipo navegável: `prototipos/sdr/index.html` · Próximo passo: plano de implementação (skill `writing-plans`).

## 1. Objetivo

O escritório vai contratar um **SDR**: uma pessoa que recebe os leads de tráfego pago no WhatsApp, faz uma qualificação breve e agenda videochamadas nas agendas das vendedoras. Esta aba é a mesa de trabalho dele.

Ela existe para resolver três coisas que hoje não têm dono:

1. **A fila.** Ninguém sabe, num só lugar, quem está esperando resposta, quem tem call hoje sem confirmar e quem conversou mas nunca foi convidado.
2. **O agendamento.** Hoje a vendedora cria o evento na própria agenda, à mão. O SDR não tem como marcar na agenda de outra pessoa sem sair do sistema.
3. **A medição.** SLA, taxa de conexão, comparecimento, remarcação e efetividade de disparo existem em pedaços espalhados, e alguns não existem.

### O que a evidência diz que precisa mudar

Números do próprio escritório, medidos no corpus de 9.493 conversas rotuladas (`projetos/sdr-agente-ia`) e no banco em 03/08/2026:

| Achado | Número |
|---|---|
| Conversas engajadas que **nunca receberam convite** para videochamada | 2.560 (27% do corpus). Quando o convite vem, **45,8% agenda** |
| Leads medidos que **nunca receberam resposta** | 75 de 217 (34,6%) desde 11/07 |
| SLA mediano de 1ª resposta | 18,3 min (20,9 min até resposta humana). **Velocidade não é o gargalo**: entre 2 min e 12h o resultado é plano |
| Comparecimento auditado no Meet (30 dias) | 81,1% (163 de 201) |
| Call marcada para o **mesmo dia** | 9,8% de falta, contra 19% quando fica para depois de dois dias |
| Cliente **calado nas 24h** antes da call | 33,9% de falta, contra 18,2% de quem responde qualquer coisa |
| Perguntar o **valor antes** de convidar | Agendamento cai de 69% para 50,7%; fechamento cai de 25,9% para 13,8% |
| Lembretes enviados no histórico | **Zero** em 2.938 agendamentos (os três campos de lembrete estão nulos em 100%) |
| Calls de hoje sem lead casado no Kommo | 2 de 9 |

---

## 2. Decisões do Paulo

Todas confirmadas durante o levantamento de 03/08 a 11/08/2026.

| # | Tema | Decisão |
|---|---|---|
| 1 | Ana (SDR de IA) | **Fica fora.** A aba é 100% para o SDR humano; o código da Ana vira peça de reaproveitamento |
| 2 | Escopo da agenda | **Só a tela interna.** A página pública de autoatendimento fica para uma fase futura |
| 3 | Tela principal | **Uma tela só**, arranjo 8 do protótipo |
| 4 | Qualificação | Resort · situação da cota · titular/cônjuge · **valor pago, coletado depois do "sim"** |
| 5 | Distribuição | Leads de maior nota vão para a **Mariana**; o resto entra em rodízio. Parametrizável |
| 6 | Lead score | Fórmula **em avaliação**. Histórico de faltas **só avisa, não derruba a nota** |
| 7 | Confirmação da manhã | Confirmou = automático · pediu remarcar = topo da fila do SDR |
| 8 | Horário de quem pediu remarcar | **Segurado até as 17h**, depois liberado sozinho |
| 9 | Base fria | O SDR monta a lista e dispara. Teto **300/dia**, reinclusão por prazo, **template por etapa do funil** |
| 10 | Templates | Criados pelo Kommo, e **todos aparecem no sistema** (os 17 atuais por cadastro espelho) |
| 11 | Conversa | Espelhada no nosso banco; **responder pelo sistema**, sem poluir campos personalizados do Kommo |
| 12 | Funil Kommo | Mover sozinho **e criar as etapas que faltam** |
| 13 | Grade | 8h–17h, **editável no sistema** |
| 14 | Permissões | Só SDR e sócios. Painel do vendedor fica para depois |
| 15 | Vendedores | Mariana, Beatriz e Emerson. **Mizael fora** (zero agendamentos no histórico) |
| 16 | Quantos SDRs | Começa com 1, preparado para vários |
| 17 | Prazo | Sem data: sistema pronto antes de a pessoa entrar |

### Descartado, com motivo

- **Responder áudio, imagem e anexo pelo sistema** — a rota de envio suporta só texto. O botão "Abrir no Kommo" continua existindo para isso.
- **Página pública de agendamento** — fase futura; o desenho não impede.
- **Mizael no rodízio** — sem histórico que justifique.
- **Faltas na nota** — decisão de 11/08: faltar pode ter sido falha do processo (nenhum lembrete jamais saiu), não do cliente.

---

## 3. Arquitetura

Três donos, sem ambiguidade. É o que evita a classe de bug mais cara nesse tipo de sistema.

- **O Kommo é dono da conversa.** Toda mensagem existe lá; nosso banco é cópia.
- **O Google Agenda é dono do horário.** Se divergir do nosso banco, o Google vence.
- **Nosso banco é dono do trabalho do SDR** — a fila, a nota, o que já foi disparado, o que foi descartado e por quê. Isso não existe em lugar nenhum hoje.

```
    KOMMO (conversa)                    GOOGLE AGENDA (horário)
      │ webhook add_message                ▲ cria/move evento + Meet
      │ (push, tempo real)                 │ lê ocupação ao vivo
      ▼                                    │
   ┌──────────────── NETLIFY FUNCTIONS ──────────────────┐
   │ espelho de mensagens · fila · agendar/remarcar      │
   │ confirmação da manhã · disparo frio · envio de texto│
   │ guardam os tokens: nada de credencial no navegador  │
   └───────────────┬──────────────────────┬──────────────┘
                   ▼                      ▼
        SUPABASE (espelho + trava)   ABA SDR (tela única)
```

### Peças novas

Sete funções de servidor (horários livres, agendar, remarcar, confirmação da manhã, disparo frio, espelho de mensagens, envio de texto) e a aba, em arquivos pequenos, **nenhum acima de ~300 linhas**.

### Peças existentes que serão reusadas, não reescritas

`_lib/kommoQueue.mjs` (fila com repetição) · `_lib/googleAgenda.mjs` (leitura de agendas) · `_lib/slaConversa.mjs` (cálculo de SLA) · `_lib/meetAudit.mjs` (presença real no Meet) · `agenda_videochamadas` (2.938 eventos espelhados) · `vw_noshow_acervo` · `_lib/comCaptura.mjs` (erro para o Monitor) · `_lib/gatilho.mjs` (trava de disparo por navegador) · `_lib/dataBrt.mjs`.

De `cbc-contratos-ana` (branch `feat/agenda-bot-ana`, nunca rodou em produção) vêm como base, com teste: `createEventComMeet()` e o cálculo de horários livres.

### Duas travas obrigatórias

Herdadas de erro já cometido neste projeto: nenhuma função nova pode ser disparada por acesso de navegador, e **todo disparo tem chave de desligamento no banco**, sem precisar de deploy para parar.

---

## 4. Modelo de dados

Dez tabelas novas, prefixo `sdr_`. Critério: **só entra aqui o que não existe em outro lugar**.

| Tabela | Para quê |
|---|---|
| `sdr_config` | Uma linha com todos os parâmetros: grade, duração, antecedência, horizonte, meta de SLA, máximo de remarcações, até quando segura o horário, teto de disparo, prazo de reinclusão, pesos da nota, piso de valor, resorts prioritários |
| `sdr_vendedores` | Mariana, Beatriz, Emerson: ativo (férias tira do rodízio na hora), quem recebe o topo da nota, agenda do Google |
| `sdr_lead_estado` | O trabalho do SDR sobre cada lead: resort, situação da cota, valor pago, titular/cônjuge, nota, "lead quente" com autoria, estado, motivo do descarte, dono |
| `sdr_mensagens` | Espelho das conversas: uma linha por mensagem, com direção, autor, tipo e horário |
| `sdr_agendamentos` | Trava e autoria do agendamento: quem marcou, quando, por qual caminho, e **de qual agendamento veio** |
| `sdr_templates` | Nome, categoria, texto, situação na Meta, para que serve e **em qual etapa do funil se aplica** |
| `sdr_disparos` | Cada disparo: filtro usado, template, quem disparou, tamanho do alvo, teto aplicado |
| `sdr_disparo_alvos` | Uma linha por pessoa em cada disparo: enviado → entregue → respondeu → agendou → compareceu/faltou → pediu parar |
| `sdr_bloqueio` | Quem nunca recebe disparo, com motivo e autoria |
| `sdr_envios` | Cada mensagem que sai pelo sistema: texto ou template, caminho usado, resultado, erro |

### Cinco decisões de modelagem

**A trava de horário é do banco, não do Google.** O Google aceita dois eventos sobrepostos sem reclamar. Uma restrição de unicidade em `sdr_agendamentos` (`vendedor_email + inicio` onde o status está ativo) resolve isso atomicamente. A ordem é obrigatória: **reserva no banco primeiro, cria no Google depois**. Invertida, dois cliques simultâneos criam duas calls no mesmo horário.

**O agendamento fica separado do espelho de videochamadas.** `agenda_videochamadas` continua sendo o retrato do que está no Google, incluindo o que a vendedora marcar pelo celular. `sdr_agendamentos` é a memória: quem marcou, por que caminho, de qual call veio. Um não substitui o outro, e é a ligação entre os dois que torna a métrica de remarcação possível.

**O bloqueio é tabela própria, não etapa do Kommo.** Se depender da etapa "Não chamar novamente", basta alguém arrastar o card por engano para a pessoa voltar a receber disparo. Uma vez bloqueado, fica bloqueado.

**A reinclusão é parâmetro, não exceção.** Como cada disparo guarda seus alvos, o sistema sabe quem já recebeu e quando. "Não dispare de novo antes de N dias" é um número editável: o Paulo reinclui a base inteira mudando esse número.

**A nota do lead é calculada, nunca gravada como verdade.** Os fatores e pesos vivem em `sdr_config`; `sdr_lead_estado` guarda só os **fatos** (resort, valor, situação, quente). Mudar a fórmula recalcula a fila inteira sem migração.

---

## 5. A tela

Uma tela só, em três faixas (a última com duas colunas), mais quatro seções que abrem no mesmo lugar.

### Faixa 1 — quatro cartões, e cada um filtra a fila

Resolver agora (pediu remarcar) · Risco de falta (calls de hoje sem confirmação) · Esperando você (conversas sem resposta nossa) · Já aconteceu hoje. Clicar filtra; clicar de novo limpa. O quarto não tem fila: ele **esmaece a agenda** e deixa visível só o que aconteceu.

### Faixa 2 — as três agendas do dia

Grade alinhada por horário, uma coluna por vendedora, abas Hoje/Amanhã. Verde: aconteceu, com a duração medida no Meet. Cinza: marcada, sem confirmação. Âmbar: pediu remarcar ou saiu do lugar. Vazio: clique agenda ali. No cabeçalho, o botão **"Confirmar os N agendados do dia"**.

### Faixa 3, coluna da esquerda — a fila

Densa, sem separar em grupos, com coluna "por quê", **badge de lead score** ao lado do nome e o selo de histórico de faltas quando existir. Busca por nome ou número do lead, filtro por grupo e por dono. Clicar na linha abre a conversa.

### Faixa 3, coluna da direita — o quadro "Sem resposta nossa"

Uma linha por conversa em que a **última mensagem foi do cliente**, ordenada da mais antiga para a mais nova. Cada linha traz: nome e nota, a última mensagem dele, um **cronômetro correndo** desde aquela mensagem, o **estado da janela de 24h** e o botão de responder. O cabeçalho diz quantas já passaram da janela.

### A conversa

Abre numa gaveta pela direita, sem tirar o SDR da fila: cabeçalho com nota, resort e horário da call → histórico de mensagens → **caixa de escrever** → Agendar videochamada · Abrir no Kommo · Descartar.

### Seções

**Funil** (kanban com as etapas reais do Kommo, cards arrastáveis) · **Disparos** (confirmação da manhã cliente a cliente e campanhas com resultado) · **Templates** · **Configuração** (só sócios).

### Permissões

| Ação | Quem |
|---|---|
| Trabalhar a fila, agendar, remarcar, responder, disparar | SDR e sócios |
| Configurar parâmetros, pesos da nota, vendedores, tetos | **Só Paulo, Bruno e Lorenza** |
| Ver os próprios agendamentos | Vendedor — **fase futura**, painel próprio |

---

## 6. Fluxos

### A. Qualificar e agendar

1. O SDR abre a conversa pela fila ou pelo quadro.
2. Conversa no WhatsApp (pelo sistema, quando cabe; no Kommo para áudio e anexo).
3. Clica em **Agendar**: escolhe resort, situação da cota e titular; o sistema sugere o vendedor pela nota (topo vai para quem estiver marcado como tal, o resto em rodízio entre os ativos) e mostra os horários livres reais das três agendas.
4. Escolhido o horário, e **só então**, aparece o campo de **valor aproximado pago** e a observação para o vendedor.
5. Ao confirmar: reserva no banco → cria o evento no Google com Meet → convida o cliente → move o lead para "Vídeo Chamada" no Kommo → o lead sai da fila.

> A ordem dos passos 4 e 5 não é estética: perguntar o valor antes do convite derruba o agendamento de 69% para 50,7%.

### B. Confirmação da manhã

Cron às 08:00 → para cada call do dia com lead casado → template com botões **Confirmo** e **Preciso remarcar**.

- **Confirmo** → o agendamento fica confirmado e o vendedor é avisado. Sem humano.
- **Preciso remarcar** → o lead vai para o topo da fila, o horário fica **em âmbar e segurado até as 17h**; passando disso é liberado sozinho e o lead cai na fila de remarcação.
- **Silêncio** → vira alerta de risco de falta.
- **Sem lead casado** → não recebe, e a tela diz por quê.

### C. Remarcar e cancelar

**Remarcar** move o evento. O link do Meet **sobrevive** e o Google reenvia o convite. Conta como reagendamento, não como falta, e o registro guarda de qual call veio. Se a remarcação trocar de vendedor, é preciso confirmar na implementação se o Meet sobrevive ao mover entre agendas; se não sobreviver, o sistema recria e manda o link novo.

**Cancelar** apaga o evento e o Google avisa o cliente. **Motivo é obrigatório.**

### D. Fim de agendamento: sete baldes, nenhum inferido

| Balde | Como o sistema sabe |
|---|---|
| Realizada | auditoria do Meet |
| Não compareceu | horário passou, ninguém entrou |
| Remarcada pelo cliente | clicou no botão do template |
| Remarcada pelo escritório | SDR ou vendedor mudou |
| Cancelada pelo cliente | pediu cancelar |
| Cancelada pelo escritório | vendedor não pôde, feriado, redistribuição |
| **Pediu remarcar e sumiu** | clicou e não escolheu horário até as 17h |

O último balde **hoje não existe**, e essa pessoa vira "no-show" na estatística. Separado, ele mede gente que respondeu, quis continuar, e o processo perdeu.

### E. Disparo para base fria

O SDR escolhe funil e etapa, o template, o prazo de reinclusão e o teto. O sistema subtrai, na tela, quem está bloqueado, quem recebeu dentro do prazo e quem já tem call marcada. Dispara ao longo do dia. Cada pessoa vira uma linha própria, e é assim que "agendou" e "compareceu" ficam ligados ao disparo que os gerou.

### F. Descarte

Motivo obrigatório, escolhido de uma lista fechada, mais a opção de bloquear disparos futuros. O lead vai para o funil "Contato Perdido" no Kommo.

---

## 7. Enviar mensagem pelo sistema

O ponto mais delicado do desenho, porque envolve dois limites que não são nossos.

### O que a Meta impõe

Fora da **janela de 24 horas** contada da última mensagem *do cliente*, só sai **template aprovado**. Em 03/08, 7 dos 8 leads sem resposta já estavam fora da janela. A tela mostra esse estado por linha, e a caixa de escrever se bloqueia sozinha, com o seletor de template no lugar. Sem isso o SDR digita e a mensagem não sai.

### O que o Kommo impõe, e os três caminhos

| Caminho | Toca em campo personalizado? | Limite |
|---|---|---|
| **Salesbot com `widget_request`** ← preferido | **Nenhum** | **80 caracteres por bolha**, até 10 bolhas por resposta. Documentado, **nunca testado na conta da CBC** |
| Rota REST `/talks/{id}/send_message` | Nenhum | **500 mensagens/mês** no plano atual. A doc cita um nível "Technical" de 10.000/mês |
| Salesbot com campo | Sim | Sem teto conhecido. Só como plano B, **reusando um dos três campos que já existem**, nunca criando outro |

**Decisão de implementação, a validar antes de codificar:**

1. Testar o `widget_request` na conta real e medir o efeito prático do limite de 80 caracteres.
2. Em paralelo, abrir chamado no Kommo perguntando se o nível "Technical" é contratável.
3. Se os dois falharem, plano B: **um campo único reaproveitado**, sobrescrito e limpo a cada envio.

Toda mensagem enviada é gravada em `sdr_envios` com o caminho usado, para que uma troca de caminho no futuro não apague o histórico.

---

## 8. Lead score

**A fórmula está em avaliação.** O desenho não depende dela: os fatores entram como pesos editáveis em `sdr_config`, e enquanto não fechar o badge mostra **"a apurar"** para quem não tem dado, em vez de exibir zero — que seria lido como julgamento.

Fatores medidos, disponíveis para entrar na conta quando o Paulo e o Bruno decidirem:

| Fator | O que os dados mostram |
|---|---|
| Valor pago na cota | Fator nº1 do tamanho do êxito (correlação 0,61 com o valor do acordo) |
| Resort | Hot Beach You agenda 59,5%, Hard Rock 57%, Barretos 53,3%; Hot Beach comum fecha 5,8%; sem resort identificado agenda 3,4% |
| Cota quitada | Agenda 49,4% e fecha 17,8%, acima da média |
| Engajamento | Áudio nas 5 primeiras mensagens: 36,1% de agendamento contra 17,2% |
| Julgamento do SDR | Botão "lead quente", que sobrepõe a nota e fica registrado com autoria |

**O histórico de faltas não entra na nota** (decisão de 11/08). Ele aparece como selo ("faltou 4×", "veio 1×") porque faltar pode ter sido falha do processo: nenhum lembrete jamais foi enviado nos 2.938 agendamentos do histórico.

---

## 9. Métricas

Todas por período e por SDR, mesmo com uma pessoa só.

**Da conversa:** tempo até a 1ª resposta (mediana) · tempo até resposta **humana** · taxa de conexão (respondeu nossa 1ª mensagem) · % que nunca recebeu resposta · conversas engajadas que não receberam convite.

**Do agendamento:** agendamentos por dia · % dos qualificados que agendam · **% de calls marcadas para menos de 24h** · distribuição por vendedor.

**Do comparecimento:** % que compareceu, auditado no Meet · % e **quantidade de remarcações** · % que pediu remarcar e sumiu · quanto tempo o cliente esperou sozinho na sala.

**Do disparo:** por campanha, enviado → entregue → respondeu → agendou → compareceu/faltou → pediu parar.

**De higiene:** % de calls sem lead casado no Kommo · leads sem resort identificado.

---

## 10. Erros e casos-limite

| Situação | Comportamento |
|---|---|
| Dois agendamentos no mesmo horário | Trava do Postgres; o segundo vê aviso e a lista recarrega |
| Google Agenda fora do ar | A tela mostra o último retrato conhecido e **bloqueia agendar**: oferecer horário sem ver a ocupação real criaria call em cima de call |
| Token do Google expirado | Faixa vermelha na aba **e e-mail para os sócios**. Já aconteceu em 23/07/2026 e ninguém percebeu na hora |
| Kommo lento ou fora | A fila segue com o que está espelhado; mover etapa e enviar mensagem ficam na fila até voltar |
| Reserva órfã | Liberada após 5 minutos |
| Evento sem lead casado | Aparece marcado, não recebe disparo, e a tela oferece casar o lead |
| Fila zerada | Estado próprio, com atalho para a base fria |
| Falha ao enviar mensagem | Gravada em `sdr_envios` com o erro; a conversa não fica dizendo que enviou |

---

## 11. Testes

**Lógica pura, em Vitest, no padrão do projeto** (`utils/__tests__` e `_lib`):

1. Cálculo de horários livres: janela semanal, duração, antecedência, vendedor inativo, evento que atravessa o fim do expediente.
2. Rodízio e roteamento por nota: topo vai para quem está marcado, pausado nunca é escolhido, empate cai no de menor carga.
3. **Trava de concorrência**: duas inserções no mesmo horário contra o banco real. *É o teste mais importante do projeto.*
4. Janela de 24h: aberta, fechada, e o caso de virar exatamente em 24h.
5. Elegibilidade de disparo: bloqueio, prazo de reinclusão, já tem call marcada, teto do dia.
6. Cálculo da nota com pesos variáveis, incluindo o caso "sem dado" que não pode virar zero.
7. Os sete baldes de fim de agendamento, com a cadeia de remarcação.

**Mockado:** todas as chamadas ao Google e ao Kommo, testando os caminhos de erro.

**Fora do escopo automatizado:** a API do Google, a aprovação de template pela Meta e o acabamento visual.

**Roteiro de verificação ao vivo antes de liberar:** agendar de ponta a ponta e conferir evento, Meet e convite · duas abas no mesmo horário · remarcar e confirmar que o Meet sobreviveu · disparar a confirmação da manhã com um lead de teste · responder pelo sistema dentro e fora da janela.

---

## 12. Pré-requisitos que dependem do Paulo

Estes travam metade da aba:

1. **Escopo de escrita no Google Agenda.** Hoje é `calendar.events.readonly`; precisa virar `calendar.events`, com o refresh token regerado. A autenticação é OAuth, não conta de serviço: a política da organização bloqueia chave de conta de serviço.
2. **Mariana, Beatriz e Emerson compartilharem a agenda** com permissão de "fazer alterações em eventos" para a conta que detém o token. Sem isso o sistema lê as agendas e não escreve.
3. **Cadastro espelho dos 17 templates** já aprovados, feito uma vez (a API do Kommo só devolve os que ela mesma criou).
4. **Aprovar as três etapas novas** no funil Venda: Em qualificação · Qualificado aguardando horário · No-show a remarcar.
5. **Fechar a fórmula do lead score** (não bloqueia o desenvolvimento, bloqueia o roteamento por nota).

---

## 13. Fora de escopo desta fase

- Página pública de autoatendimento (o desenho não impede).
- Painel próprio do vendedor.
- Responder áudio, imagem e anexo pelo sistema.
- A Ana, ou qualquer resposta automática de conversa.
- Relatório de comissionamento do SDR.

---

## 14. Riscos

| Risco | Tamanho | O que fazer |
|---|---|---|
| Limite de 80 caracteres por bolha inviabilizar a resposta pelo sistema | **Alto** | Testar antes de codificar; plano B é um campo reaproveitado |
| O Meet não sobreviver à mudança de vendedor | Médio | Testar; se cair, recriar o evento e avisar o cliente |
| Volume do espelho de mensagens | Médio | O webhook é push, não varredura; o histórico antigo entra aos poucos pelo worker existente |
| Nota de qualidade do número cair por disparo de MARKETING | Médio | Teto diário, bloqueio, prazo de reinclusão e acompanhamento por campanha |
| Token do Google expirar de novo | Baixo, já aconteceu | Alerta na aba e e-mail aos sócios |
| A fila de "sem resposta" ter falso positivo | Baixo | Cruzar com a agenda antes de exibir: dois leads marcados como sem resposta em 03/08 tinham call marcada |

---

## 15. Ordem sugerida de construção

Cada etapa entrega algo utilizável sozinha, e a ordem foi escolhida para que o que depende do Paulo não bloqueie o resto.

1. **Espelho e fila.** Webhook de mensagem, `sdr_mensagens`, `sdr_lead_estado`, a fila e o quadro "sem resposta" com cronômetro. Não depende de nada externo e já resolve o achado nº1: ninguém sabe quem está esperando.
2. **Conversa e envio.** Gaveta com histórico, caixa de escrever e a regra da janela de 24h. Antes disso, o **teste do `widget_request`** (§7).
3. **Agenda.** Horários livres, agendar, remarcar, cancelar, os sete baldes. **Depende dos pré-requisitos 1 e 2 do §12.**
4. **Confirmação da manhã.** Cron, template com botões, e o horário segurado até as 17h.
5. **Funil e etapas novas.** Kanban e movimentação automática. Depende do pré-requisito 4.
6. **Disparo para base fria.** Campanhas, travas e a medição por alvo.
7. **Configuração e nota.** Parâmetros, pesos e o roteamento por nota. Depende do pré-requisito 5.

As etapas 1, 2 e 4 sozinhas já cobrem o trabalho diário do SDR; a 3 é o que tira o agendamento da mão da vendedora.
