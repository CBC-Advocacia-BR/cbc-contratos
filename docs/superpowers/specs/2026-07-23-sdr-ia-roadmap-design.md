# SDR de IA da CBC — roadmap em camadas sobre o bot Ana — Design — 2026-07-23

**Objetivo:** evoluir a Ana (bot de agendamento de videochamada, spec 2026-07-21) para o
**SDR de IA completo** do escritório: recepção instantânea de todo lead do WhatsApp/Kommo,
conexão e autoridade, agendamento com contorno de objeções, voz, confirmação/remarcação
persistente, nutrição longa de leads frios e atualização de funil/campos no Kommo.

**Relação com os outros docs:** este é o guarda-chuva. Cada camada abaixo vira sua própria
spec → plano → implementação (padrão superpowers), como a Ana foi. Nada aqui refaz o que a
Ana v1 já cobre — spec em `2026-07-21-agendamento-videochamada-bot-ana-design.md`, operação
em `docs/BOT_ANA_RUNBOOK.md`.

## Decisões do Paulo (23/07)

1. **Piloto da Ana v1 primeiro**; o SDR evolui por camadas sobre o mesmo motor
   (não é projeto paralelo nem reescrita).
2. **Voz = áudios no WhatsApp** (não ligações), com a **regra do espelhamento**:
   lead mandou áudio → Ana responde em áudio; mandou texto → responde em texto.
3. **Nutrição longa e persistente**: toques de D+1 até ~D+90 com conteúdos variados
   (autoridade, cases, urgência), com guarda-corpos de spam/LGPD.
4. Roadmap em camadas aprovado: piloto → (spike de áudio + mineração da base, em
   paralelo) → v2.1 voz espelhada → v2.2 nutrição + objeções ampliadas.

## Visão SDR × o que a Ana v1 já cobre

| Atividade da visão | Situação na Ana v1 |
|---|---|
| Responder todo lead do Kommo/WhatsApp, 24/7 | ✅ webhook `add_message` → resposta em segundos |
| Recepcionar e criar conexão | ✅ persona "Ana, assistente do escritório" |
| Autoridade no distrato de multipropriedade | 🟡 micro-pitch nos templates; reforço = editar na aba (sem deploy) |
| Agendar videochamada no Meet | ✅ slots reais (free/busy 3 agendas) + evento com Meet |
| Contornar objeções | 🟡 preço (deflexão da casa) + negociação de horário; demais → handoff em 2 turnos |
| Sugerir horários por disponibilidade | ✅ 2 slots + contraproposta do lead |
| Distribuição entre vendedores | ✅ sorteio ponderado 60/20/20, editável |
| Confirmar antes do atendimento | ✅ lembretes T-1h e T-0 com link (template WABA fora da janela 24h) |
| Remarcar não atendidos | 🟡 no-show → reagenda até 2 ciclos → Cemitério |
| Nutrir/reaquecer lead sumido | ❌ não existe → **camada v2.2** |
| Mover etapas no funil | ✅ "Vídeo Chamada" / "Cemitério antes da videochamada" |
| Preencher campos no Kommo | ✅ Investimento na cota, Preferência de Horário, resumo p/ vendedora |

Voz (falar) também não existe na v1 — a Ana só OUVE áudio (transcrição STT) → **camada v2.1**.

## Camada 0 — piloto da Ana v1 (agora; sem código novo)

Itens 1–3 do runbook (Google + Salesbot) já concluídos em 22/07. Resta:

- **[PAULO]** submeter os 3 templates WABA *Utility* no canal WhatsApp do Kommo
  (`ana_lembrete_1h`, `ana_link_meet`, `ana_reagendar` — corpos na spec da Ana §Janela de 24h);
  o criador fica no fluxo do CANAL WhatsApp/integração, não em /chats/tools/templates/.
- **[PAULO]** setar envs no Netlify (site contratos-cbc): `ANTHROPIC_API_KEY` +
  `GROQ_API_KEY` **ou** `OPENAI_API_KEY`.
- **[dev]** `git rebase --onto` para dropar os 2 commits Asaas duplicados (`e161c66`,
  `24a3ce1`), merge, deploy via `client/deploy.sh`, registrar webhook `add_message`.
- **Piloto**: roteiro de 7 cenários do runbook no funil "Teste Paulo" (13916619) →
  calibrar copy na sub-aba Mensagens → funil Venda → Disparos por último.

## Frentes paralelas ao piloto (investigação; custo ~zero)

- **Spike voz (gate da v2.1)**: o Kommo entrega áudio OGG/opus como *voice note* ao lead?
  Caminhos a apurar: bloco de anexo no Salesbot × files API × amojo/chat API (o token
  atual NÃO tem escopo de chat). Sem envio a lead real; só docs + GETs.
  Saída: `chatguru-export/docs/spike-kommo-audio-2026-07-23.md`.
- **Mineração da base (insumo v2.1/v2.2)**: nas 13.884 conversas, catalogar (a) objeções
  reais pré-agendamento + as respostas da equipe que converteram; (b) mensagens de
  reativação pós-silêncio (≥3 dias) que trouxeram o lead de volta, com padrões e taxa
  aproximada de resposta. Saída:
  `chatguru-export/docs/mineracao-objecoes-reativacao-2026-07-23.md`.

## v2.1 — voz espelhada (ElevenLabs)

- **Regra determinística** na máquina de estados: a modalidade da ÚLTIMA mensagem do lead
  define a da resposta. Nenhuma decisão de IA; o conteúdo continua saindo SEMPRE de template.
- Cada template ganha uma **variante falada** (texto escrito ≠ texto que soa natural
  falado), editável na aba como hoje, com "restaurar padrão". TTS ElevenLabs pt-BR
  (voz feminina consistente com a persona), enviado como voice note.
- **Transparência mantida**: a Ana segue se apresentando como assistente do escritório —
  com voz sintética, o disclosure é ainda mais importante (OAB/LGPD).
- **Fallback**: falha de TTS ou de entrega de áudio → responde em texto (nunca trava).
- **Gate de entrada**: spike positiva. Se o Kommo não entregar voice note de verdade,
  a camada é repensada (áudio como arquivo comum descaracteriza a experiência).
- Custo estimado: R$ 30–150/mês no volume atual (assinatura ElevenLabs + geração;
  mitigável com cache de áudio por template+variáveis).
- **Fora de escopo**: ligações telefônicas; áudio proativo (abrir em áudio com quem só escreve).

## v2.2 — nutrição longa + objeções ampliadas

- **Gatilhos de entrada na cadência**: sumiu na qualificação (58% dos leads históricos
  morrem antes de receber oferta — o maior vazamento do funil); recusou agendar;
  no-show com ciclos de reagendamento esgotados.
- **Cadência**: D+1 até ~D+90, número/espaçamento/horários parametrizáveis na aba;
  eixos de conteúdo: autoridade (líder em distrato), prova social/cases, esclarecimento
  do processo, urgência leve. Textos-base MINERADOS da própria base (frente paralela),
  não inventados. Lead que responde **sai da cadência na hora** e volta ao fluxo vivo da Ana.
- **Reciclagem retroativa do Cemitério** (base antiga, pré-Ana): opção de alto valor,
  decidir escopo e volume na spec da camada (risco de spam maior em base fria antiga).
- **Guarda-corpos (inegociáveis)**:
  - fora da janela de 24h → só template **Marketing** aprovado pela Meta
    (~R$ 0,30–0,45/msg; confirmar preço vigente na spec da camada);
  - **opt-out imediato**: "pare"/"sair"/"não quero" → silencia, marca campo no Kommo,
    nunca mais entra em cadência;
  - teto de frequência por lead + teto diário global de envios;
  - monitor do **quality rating** do número WABA com **kill-switch automático** da
    nutrição (rating caiu → pausa) — número denunciado derruba o WhatsApp inteiro
    do escritório;
  - horário comercial apenas; sem toques em fim de semana (parametrizável).
- **Objeções ampliadas** (entra nesta camada; mesma mineração): novas intenções no
  intérprete — desconfiança/golpe, "já tenho advogado", cônjuge decide, "vou pensar",
  "por que videochamada?" — cada uma com resposta-template minerada das conversas que
  converteram; mantém handoff após 2 turnos sem progresso.
- **Kommo**: etapa própria de nutrição (ex.: "Em nutrição" — criar na spec da camada),
  toques logados como notas no lead, campo de motivo-da-perda para atribuição.
- Custo Meta no pior caso: R$ 0,5–2,5 mil/mês (depende das paradas por resposta/opt-out);
  medir com teto baixo no início e escalar com dados.

## Métricas de sucesso (aba Métricas já cobre a maior parte)

- 1ª resposta: mediana histórica 6,5 h → **segundos**;
- lead→oferta: > 42% histórico; oferta→agendado: > 59%; no-show: < 24%;
- v2.1: taxa de resposta após mensagem em áudio × após texto (espelhamento deve
  aumentar conexão);
- v2.2: % de leads em cadência que reagendam (meta numérica definida após 30 dias de
  dados do piloto) e opt-outs/denúncias abaixo do limiar de segurança do rating.

## Riscos

1. **Envio de áudio pelo Kommo inviável como voice note** → spike decide antes de
   qualquer código; sem voice note real, v2.1 é repensada.
2. **Quality rating do número WABA** (nutrição longa) → guarda-corpos acima; segundo
   número é plano B extremo, não default.
3. **Meta reprovar templates Marketing** minerados → reescrever mantendo o sentido;
   fallback tarefa-manual continua existindo.
4. **Voz sintética confundida com humano** → disclosure na apresentação mantida sempre.
5. **Custo linear com volume** (IA, TTS e Meta) → tetos parametrizáveis e medição por camada.

## Não-escopo (por ora)

- Ligações telefônicas (ElevenLabs Agents/telefonia).
- Fine-tuning de modelo (não existe para Claude; a "aprendizagem" da base = playbook
  minerado + templates editáveis + ajustes contínuos na aba).
- Nutrição por outros canais (e-mail/SMS).
- Portal do cliente (visão separada, doc próprio em chatguru-export).

## Próximos passos

1. [PAULO] templates WABA utility + envs de API → destrava o piloto (Camada 0).
2. [dev] rebase/merge/deploy/webhook → rodar o roteiro do piloto com o Paulo.
3. Frentes paralelas → resultados alimentam as specs das camadas.
4. Spec detalhada v2.1 (pós-spike) → writing-plans → implementação.
5. Spec detalhada v2.2 (pós-mineração + dados do piloto) → writing-plans → implementação.
