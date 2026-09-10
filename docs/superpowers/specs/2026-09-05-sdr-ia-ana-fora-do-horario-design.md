# SDR de IA "Ana" fora do horário comercial: desenho

> Status: **rascunho para aprovação do Paulo** (05/09/2026). Base: estudo `projetos/sdr-agente-ia/custo-2026-09/RELATORIO-SDR-IA-CUSTO-2026-09-05.md` (volumes, custo, funil do chatbot e do Mizael) e relatório de 28/07 (`projetos/sdr-agente-ia/RELATORIO.md`).
> Próximo passo após aprovação: plano de implementação (skill `writing-plans`).

## 1. Decisões do Paulo (05/09/2026)

| # | Tema | Decisão |
|---|---|---|
| 1 | Horário | A IA atende **só fora do horário comercial**: noites de dia útil, sábados, domingos e feriados. De dia o SDR humano (Mizael) segue como está. |
| 2 | Agendas | Os **melhores leads vão para a Mariana**; os demais em rodízio Beatriz/Emerson. **Não há closer no fim de semana**: a IA agenda para o próximo dia útil. |
| 3 | Persona | **Ana**, assistente do escritório, com aviso de atendimento automatizado. |
| 4 | Escopo da conversa | **Só acolhe e agenda.** Explicação do distrato em linhas gerais fica para uma fase seguinte. |
| 5 | Mídia de resposta | **Só texto.** |
| 6 | Base fria e reativação | **Depois.** |
| 7 | Modelo | **Claude Opus 5, raciocínio adaptativo em esforço baixo.** |

## 2. Objetivo e métrica

Fechar o buraco medido entre 17/08 e 05/09: dos leads que aceitam a videochamada no chatbot **fora do horário**, só 41% (noites) e 40% (fins de semana) recebem o link do Meet, com mediana de 12,7 h e 28,5 h até um humano aparecer. No horário comercial são 51% em 18 min.

**Métrica primária:** % de handoffs fora do horário que viram evento com Meet (hoje 40 a 41%; meta do piloto: igualar ou superar os 51% do horário comercial).

**Secundárias:** tempo do "sim" ao Meet (hoje 12,7 h / 28,5 h; meta: minutos), % de faltas nas calls agendadas pela IA (base 21%), % de leads escalados para humano, custo por lead (R$ 1,65 no cenário base).

## 3. O que a IA faz e o que não faz (v1)

**Faz, fora do horário:**

1. Assume o lead **depois que o roteiro fixo do Salesbot termina**, em três situações: (a) o lead disse "manhã" ou "tarde" e recebeu "vou reservar o seu horário" (handoff); (b) o roteiro escalou ("vou verificar isso e já te respondo", etapa Precisa de humano); (c) lead com call marcada que escreve para remarcar ou cancelar, ou que faltou (Não compareceu).
2. Conversa em texto livre: responde o que o lead perguntou dentro do escopo (quem somos, onde estamos, como é a videochamada, quanto tempo leva, se tem custo, se pode ser pelo WhatsApp), coleta o que faltou da qualificação (resort, situação da cota, titular, valor pago **depois** do sim), e propõe **dois horários concretos**.
3. Agenda: cria o evento com Meet na agenda da closer certa, com o lead como convidado, envia o link, move o lead para "Videochamada agendada" no funil SDR, preenche os campos no Kommo e registra o resumo em nota.
4. Remarca e cancela a partir da conversa (até 2 remarcações; depois escala).
5. Escala para humano quando: o lead pede, faz pergunta jurídica de mérito, expõe caso fora do padrão (cota herdada, falecimento, processo em andamento, advogado da outra parte), demonstra irritação, ou a conversa não avança em 2 turnos.
6. Ao virar o horário comercial, entrega o que ficou aberto: nota no lead com resumo e próximo passo, e a etapa correta no funil, para o Mizael pegar na fila da aba SDR.

**Não faz na v1:**

- Não substitui o roteiro fixo desde a saudação (fica para a v2, depois de medir). Motivo: o roteiro converte bem até o "sim" (78% dos convidados aceitam) e o Kommo só roda um bot por lead de cada vez; entrar depois do roteiro evita colisão.
- Não fala de honorários, valores de causa, chance de êxito ou prazos de processo. Deflete para a videochamada com a frase da casa.
- Não afirma regra sobre cota quitada por resort (só quando existir tabela escrita).
- Não manda áudio, imagem ou anexo. Não inicia conversa fria. Não manda mensagem entre 23h e 7h por iniciativa própria (só responde).
- Não responde no horário comercial, nem quando um humano falou na conversa nas últimas 24 h.
- Não cita número de processos ou resultados que não estejam na tabela verificada (`sdr_ia_fatos`).

## 4. Arquitetura

Reaproveita a Ana (`cbc-contratos-ana`, branch `feat/agenda-bot-ana`) e troca o cérebro: sai a máquina de estados (`agendaEngine` + `agendaInterprete`), entra um loop de agente com ferramentas. Tudo o mais (webhook, fila do Kommo, agenda, Meet, transcrição, cron, config, testes) permanece.

```
Lead (WhatsApp Cloud API oficial, número da CBC)
   │ mensagem
   ▼
KOMMO ── webhook add_message ──► kommo-agenda-webhook.mjs (ACK < 2 s, despacha)
   ▲                                       │
   │ campo "CBC Ana" + Salesbot 103102     ▼
   │ (dentro da janela de 24 h)   agenda-bot-worker-background.mjs (até 15 min)
   │ template aprovado (fora)      ├─ filtros: ativo · fora do horário · gatilho · humano calou · dedupe
   │                               ├─ áudio → Groq Whisper (já existe) · imagem → Claude lê (novo, só p/ extrair resort/valor)
   │                               ├─ contexto: histórico (atendimento.mensagens + bot_messages), etapa, tags, estado
   │                               ├─ Claude Opus 5 + 6 ferramentas (prefixo em cache, esforço baixo)  ← NOVO (_lib/sdrAgente.mjs)
   │                               ├─ executa ferramentas: Google Agenda, Kommo (fila), Supabase
   └───────────────────────────────┴─ grava turno + usage + custo (sdr_ia_turnos)
                                                │
agenda-bot-cron.mjs (5 min): lembrete 1 h, link no T0, no-show, entrega da manhã ──┘
```

**Donos dos dados** (mesma regra da aba SDR de 11/08): Kommo é dono da conversa; Google Agenda é dono do horário; nosso banco é dono do trabalho da IA (estado, turnos, custo, decisões).

### 4.1 Componentes

| Componente | Estado | Mudança |
|---|---|---|
| `kommo-agenda-webhook.mjs` | pronto | nenhuma |
| `agenda-bot-worker-background.mjs` | pronto | trocar o bloco "interpreta + decide" pelo loop do agente; adicionar filtro de horário e leitura de imagem |
| `_lib/sdrAgente.mjs` | **novo** | prompt, definição das ferramentas, loop com Anthropic SDK, cache, telemetria |
| `_lib/sdrFerramentas.mjs` | **novo** | implementação das 6 ferramentas sobre libs existentes |
| `_lib/sdrNota.mjs` | **novo** | nota de qualificação e roteamento (Mariana × rodízio) |
| `_lib/agendaSlots.mjs`, `googleAgenda.mjs`, `kommo.mjs`, `botDb.mjs` | prontos | `gerarSlots` ganha "próximo dia útil" e "primeiro horário livre" |
| `agenda-bot-cron.mjs` | pronto | ganha a "entrega da manhã" (§6) |
| `agendaEngine.mjs`, `agendaInterprete.interpretar` | prontos | **saem** (ficam em `backups/`); `transcrever` permanece |
| Tabelas `bot_conversations`, `bot_messages`, `agenda_videochamadas`, `bot_config.agenda_bot` | em produção | estado continua em `bot_conversations.context` |
| `sdr_ia_turnos` | **nova** | telemetria por chamada |
| `sdr_ia_fatos` | **nova** | tabela verificada de números citáveis (Paulo preenche) |
| `sdr_config` (aba SDR) | em produção | fonte da grade de horário (8h às 17h, seg a sex) e feriados |

### 4.2 Quando a IA está "de plantão"

`foraDoHorario(agora)` = fora de `sdr_config.grade_inicio..grade_fim` nos `grade_dias`, ou feriado (`agenda_bot.regras.feriados`). Avaliado a cada mensagem, em America/Sao_Paulo.

- Mensagem chega às 17h01 de sexta: IA responde.
- Mensagem chega às 7h59 de segunda: IA responde. Às 8h00: humano.
- Conversa iniciada pela IA às 7h40 e o lead responde às 8h10: a IA **não** responde; a entrega da manhã (§6) já colocou o lead na fila do Mizael com o resumo.
- Lembretes de call (1 h antes, link no horário) continuam saindo em qualquer horário, pois são do cron e não conversa.

### 4.3 Gatilhos (o que faz a IA olhar para um lead)

Além de `foraDoHorario`, a IA só age se o lead estiver no funil **SDR** (pipeline 14170107) ou **Teste Paulo** (13916619, piloto) e:

| Situação | Sinal | Etapa do lead |
|---|---|---|
| Handoff do roteiro | última mensagem do escritório é "Combinado, … Vou reservar o seu horário" e não há Meet enviado | Em qualificação / Follow up (bot) |
| Escalonamento do roteiro | última mensagem do escritório é "Vou verificar isso e já te respondo" | Precisa de humano (109397011) |
| Remarcar / cancelar | lead escreve e tem evento futuro em `agenda_videochamadas` | Videochamada agendada (109397019) |
| Faltou | cron marcou no-show e o lead escreve depois | Não compareceu (109397023) |

Lead em etapa terminal (142/143), "Cliente" (111135391) ou "Não quer agendar" (110972323): a IA não age. Lead no funil Venda ou Pós Venda: não age (é cliente ou está com closer).

Se o `bots/run` do megafone devolver "outro bot em execução" (o roteiro ainda não terminou), a resposta vai para a fila com nova tentativa em 60 s, até 5 vezes; depois, nota no lead e desiste do turno.

## 5. O agente

### 5.1 Modelo e chamada

- `claude-opus-5`, `thinking: {type: "adaptive"}`, `output_config: {effort: "low"}`, `max_tokens: 1024`, streaming desnecessário (respostas curtas).
- `fallbacks: "default"` com o beta `server-side-fallback-2026-07-01` (recusa de segurança cai para outro modelo em vez de deixar o lead sem resposta).
- Prompt caching: `tools` + `system` (persona, regras, tabela de resorts, FAQ, `sdr_ia_fatos`) com `cache_control` de 1 h; o histórico entra em `messages`. Alvo: prefixo de ~6.000 tokens, `cache_read_input_tokens > 0` a partir da segunda chamada da hora.
- Ferramentas com `strict: true`. Parse do `input` sempre por `JSON.parse`.
- Custo registrado por chamada em `sdr_ia_turnos` a partir de `response.usage`.
- Antes de codar: ler `typescript/claude-api/README.md` e `tool-use.md` da skill `claude-api` (SDK `@anthropic-ai/sdk`, projeto `.mjs`).

### 5.2 Persona e regras (resumo do que vai no prompt)

- "Ana, assistente da equipe do escritório Conforto, Bergonsi e Cavalari". Primeira mensagem de cada plantão inclui: "sou um atendimento automatizado; a qualquer momento você pode pedir para falar com a equipe".
- Tom: cordial, direto, sem jargão, uma pergunta por mensagem, mensagens de até ~300 caracteres, sem emoji em excesso, português do Brasil. Nunca "vou verificar e te respondo" sem prazo.
- Ordem: responder o que o lead perguntou → propor horário **antes** de perguntar valor → depois do sim, valor pago e titular → e-mail → confirmar e enviar o link.
- Horários: dois mais próximos possíveis, manhã primeiro; à noite de dia útil, o primeiro horário da manhã seguinte; sábado e domingo, o primeiro da segunda-feira (ou próximo dia útil). Aceita contraproposta dentro de 5 dias úteis. Nunca marca fora da grade.
- Cônjuge / "preciso falar com alguém": convida o casal para a mesma call.
- Honorários, valor da causa, êxito, prazo: frase da casa (`mensagens.preco`) e volta para a oferta de horário.
- "Prefiro pelo WhatsApp": explica que a videochamada é de 10 minutos, sem custo, e que é o padrão porque a advogada precisa ver os documentos; oferece horário. Se insistir, escala.
- Não é lead (advogado da outra parte, candidato a vaga, fornecedor, cliente com processo): `encerrar` com o motivo e etapa correta.
- Qualquer dado sensível (saúde, dívida, família) só é registrado se o lead trouxer espontaneamente e nunca é comentado.

### 5.3 Ferramentas

| Ferramenta | Entrada | O que faz | Sobre o que já existe |
|---|---|---|---|
| `consultar_horarios` | `preferencia` (manhã/tarde/qualquer), `a_partir_de` (ISO, opcional) | devolve até 3 slots livres, já respeitando grade, feriados, antecedência e a closer que o roteamento escolheu | `gerarSlots` + `freeBusy` |
| `agendar` | `slot_id`, `email`, `nome` | reserva atômica, cria evento com Meet na agenda da closer, convida o lead, grava `agenda_videochamadas` (origem `ana`), move para Videochamada agendada, devolve link e data formatada | `createEventComMeet`, `agenda_videochamadas_upsert`, `moveLeadStage` |
| `remarcar` | `slot_id` | move o evento (mesma closer se possível), reseta lembretes, até 2 vezes | `patchEventHorario`, `agenda_videochamadas_reset_reagendamento` |
| `cancelar` | `motivo` | cancela o evento, move para Não quer agendar ou mantém em Follow up (bot) conforme o motivo | `cancelEvent` |
| `registrar_qualificacao` | `resort`, `situacao_cota`, `titular`, `valor_pago`, `observacoes` | grava em `bot_conversations.context` e nos campos do Kommo (Investimento na cota, Preferência de Horário, CBC Ana); calcula a nota de roteamento | `setLeadField` |
| `escalar_para_humano` | `motivo`, `resumo` | move para Precisa de humano, cria tarefa para o SDR, nota com resumo, manda ao lead a mensagem de transição com o prazo real ("a equipe responde a partir das 8h") | `moveLeadStage`, `createKommoTask`, `postNote` |
| `encerrar` | `motivo` (nao_e_lead / nao_quer / ja_e_cliente / outro) | move para a etapa correspondente e encerra o plantão da IA para esse lead | `moveLeadStage` |

Cada ferramenta devolve texto curto para o modelo ("3 horários: seg 08/09 08:30 (Mariana) …") e grava o efeito no banco antes de responder ao lead. Falha em ferramenta: o modelo recebe `is_error: true` e responde com transparência ("não consegui reservar agora, a equipe confirma às 8h") e escala.

### 5.4 Roteamento: os melhores leads para a Mariana

Nota calculada em `registrar_qualificacao` (parâmetros em `bot_config.agenda_bot.roteamento`, editáveis sem deploy):

| Sinal | Pontos (padrão inicial) |
|---|---:|
| Resort com histórico de conversão alta (Hot Beach You, Hard Rock, Barretos, Solar das Águas, Ondas, Thermas, Praias do Lago) | +2 |
| Cota quitada | +1 |
| Valor pago informado ≥ R$ 30 mil | +1 |
| Lead mandou áudio nas primeiras mensagens (sinal de temperatura medido em 28/07) | +1 |
| Resort não identificado | −2 |

Nota ≥ 3 → agenda da Mariana (se houver horário nos próximos 2 dias úteis; senão o próximo livre dela e, se o lead recusar, rodízio). Nota < 3 → rodízio ponderado Beatriz/Emerson (pesos atuais 20/20, editáveis). Limiar e pontos são hipótese inicial; o piloto mede e o Paulo ajusta.

## 6. Cadência e a "entrega da manhã"

- **Lembrete 1 h antes e link no horário**: já prontos no cron da Ana (templates WABA `ana_lembrete_1h` e `ana_link_meet` fora da janela).
- **Confirmação da manhã com botão**: já em produção (aba SDR). A IA só passa a tratar a resposta "remarcar" quando ela chegar fora do horário.
- **No-show**: cron detecta pela auditoria do Meet; se o lead responder fora do horário, a IA oferece dois horários novos (medido em 28/07 como o melhor gatilho de reagendamento).
- **Entrega da manhã** (novo, no cron, às `grade_inicio`): para cada lead que a IA tocou no plantão e não fechou (sem Meet, sem encerrar), posta nota `CBC.ana.plantao:<data>` com resumo em 3 linhas (quem é, o que quer, o que falta) e garante a etapa certa. A fila da aba SDR já ordena por "aguardando resposta"; o Mizael vê tudo às 8h.

## 7. Dados

**Novas:**

```sql
create table sdr_ia_turnos (
  id bigint generated always as identity primary key,
  lead_id bigint, conversation_id uuid, contact_id bigint,
  recebido_em timestamptz not null default now(),
  entrada text, entrada_tipo text,               -- texto | audio | imagem
  resposta text,
  ferramentas jsonb,                               -- [{nome, input, ok, ms}]
  modelo text, effort text,
  input_tokens int, cache_read_tokens int, cache_write_tokens int, output_tokens int,
  custo_usd numeric(10,6), latencia_ms int,
  stop_reason text, fallback_model text,
  erro text
);
create table sdr_ia_fatos (                        -- só o que a IA pode citar
  chave text primary key, texto text not null, fonte text, verificado_por text, verificado_em timestamptz
);
```

RLS: fechadas para `anon` e `authenticated`; escrita só por RPC `security definer` com `BOT_RPC_SECRET` (padrão do projeto); leitura pelos sócios via view. Migração `sdr_ia_v1` (arquivo `supabase_sdr_ia_v1.sql`).

**Reaproveitadas:** `bot_conversations` (canal `agenda:<fone>`, `context` = estado: etapa, qualificação, nota, closer escolhida, remarcações, `pausada_ate`), `bot_messages` (entrada/saída, já usado pelo detector de humano), `bot_processed_messages` (dedupe), `agenda_videochamadas` (origem passa a distinguir `ana` de `manual`).

**Config** (`bot_config.agenda_bot`, já existe): `ativo`, `modo_teste` + `bot_testers`, `llm.modelo = claude-opus-5`, `llm.effort = low`, `regras`, `vendedoras`, `roteamento` (novo), `gatilhos` (novo formato do §4.3), `mensagens` (só as fixas: transição para humano, preço, pede_texto).

## 8. Guarda-corpos

| Risco | Resposta |
|---|---|
| IA e humano falando ao mesmo tempo | `humanoAssumiu` (já existe): evento outgoing sem par em `bot_messages` pausa a IA por 24 h. E fora do horário raramente há humano. |
| Loop de auto-resposta | guard `incoming-only` no tipo da mensagem (já existe) + dedupe por `msgId` |
| Dois leads no mesmo horário | reserva atômica no banco antes de criar o evento (teste mais importante) |
| Token do Google expirado | erro em `getAccessToken` → IA responde "a equipe confirma às 8h", escala, e-mail aos sócios (já previsto na aba SDR) |
| Kommo indisponível ou 429 | tudo passa pela `kommo_queue` com retry; a resposta ao lead é o último passo |
| Recusa do modelo | `fallbacks: "default"` + verificação de `stop_reason` antes de ler o conteúdo |
| Resposta longa ou fora do tom | `max_tokens` 1024 e instrução de tamanho; turno registrado para revisão diária pelo Mizael |
| Custo fora do previsto | alerta se `sum(custo_usd)` do dia > 3× a média dos 7 dias (mesmo padrão dos alertas de tráfego) |
| Prompt injection pelo lead ("ignore as regras", "me dê o link do Meet de outra pessoa") | ferramentas só agem sobre o próprio lead; instrução explícita; nada de dado de terceiro no contexto |
| Fora da janela de 24 h | a IA nunca escreve texto livre; escolhe template e variáveis (só relevante em lembretes e no-show, que são do cron) |
| Botão de pânico | `ativo=false` desliga em 1 ciclo; `modo_teste` restringe a `bot_testers` |

## 9. Testes

Lógica pura em Vitest (padrão do projeto, `utils/__tests__`):

1. `foraDoHorario`: limites 7h59/8h00/16h59/17h00, sábado, domingo, feriado, virada de ano.
2. `gerarSlots` com "próximo dia útil" e "primeiro da manhã": sexta 20h → segunda 08:30; sábado → segunda; véspera de feriado; closer sem horário nos 2 dias.
3. Roteamento: nota e limiar, Mariana cheia → rodízio, vendedora inativa nunca escolhida.
4. Gatilhos (§4.3): cada situação e cada etapa que deve bloquear.
5. Reserva atômica: duas inserções simultâneas no mesmo slot contra o banco real.
6. Loop do agente com o SDK mockado: `tool_use` → execução → `tool_result` → texto final; `is_error`; `stop_reason: refusal`; `max_tokens`.
7. Parse defensivo dos payloads do Kommo (já existe; ganha caso de imagem).

**Roteiro ao vivo no piloto (funil "Teste Paulo", `bot_testers`)**, 8 cenários: lead quente que aceita; "quanto custa?"; cônjuge; já tem advogado; áudio; imagem do contrato; não é lead; pede remarcar. Você e o Mizael leem as transcrições em `sdr_ia_turnos`.

## 10. Piloto e ordem de construção

1. **Semana 1**: migração `sdr_ia_v1`; `sdrAgente.mjs` + `sdrFerramentas.mjs`; troca no worker; testes 1 a 7; rebase do branch da Ana sobre `main` (25 commits à frente, 81 atrás; conflitos esperados só em `kommo.mjs` e testes).
2. **Semana 2**: piloto fechado no "Teste Paulo" com os 8 cenários; ajustes de prompt; entrega da manhã no cron.
3. **Semana 3**: ligar no funil SDR real só fora do horário, `modo_teste=false`. Mizael revisa amostra diária (10 conversas) por 2 semanas. Métricas do §2 comparadas com 17/08 a 05/09.
4. Depois de 2 semanas estáveis: decidir v2 (IA desde a saudação, substituindo o roteiro) e Sonnet 5 numa amostra.

## 11. Pré-requisitos que dependem do Paulo (bloqueiam o passo 3)

1. Consentimento OAuth do Google com `calendar.events` (escrita) e refresh token novo em `GOOGLE_OAUTH_REFRESH_TOKEN`; Mariana, Beatriz e Emerson compartilham a agenda com "fazer alterações em eventos".
2. `ANTHROPIC_API_KEY` no Netlify (site contratos-cbc) e créditos na conta (US$ 40 iniciais).
3. Conferir no Kommo que o campo "CBC Ana" (2444884) e o Salesbot 103102 de um bloco ainda existem e o bloco exibe `{{lead.cf.2444884}}`.
4. Submeter à Meta os templates `ana_lembrete_1h`, `ana_link_meet`, `ana_reagendar`.
5. Preencher `sdr_ia_fatos` (números que a Ana pode citar) e a frase de honorários; confirmar limiar de roteamento (§5.4).
6. Cadastrar os testadores em `bot_testers` e autorizar as mensagens de teste.

## 12. Fora de escopo (registrado para as próximas fases)

Voz e áudio de resposta · explicação do distrato em linhas gerais · base fria e reativação (limbo, cemitérios) · IA no horário comercial · IA desde a saudação (v2) · painel próprio das closers · comissionamento.

## 13. Riscos

| Risco | Tamanho | Mitigação |
|---|---|---|
| O roteiro fixo ainda "segura" o lead quando a IA quer falar (um bot por lead) | Médio | retry de 60 s × 5; medir a frequência no piloto; se alta, antecipar a v2 |
| Lead chega no sábado e a call de segunda "esfria" (2 dias = 28,8% de falta) | Médio | confirmação com botão + lembrete 1 h; a IA pede resposta explícita ("me confirma com um ok?"), pois quem responde não falta |
| Prompt fala demais ou de forma genérica | Médio | revisão diária de 10 conversas pelo Mizael nas 2 primeiras semanas; ajuste de prompt sem deploy (config) |
| Token do Google expira de novo | Baixo, já ocorreu | alerta por e-mail + fallback "a equipe confirma às 8h" |
| Rebase do branch da Ana | Baixo | branch de backup já existe (`backup/pre-rebase-agenda-20260721`); só os `.mjs` da Ana mudam |
