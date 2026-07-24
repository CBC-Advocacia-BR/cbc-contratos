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

- **Spike voz (gate da v2.1)** — ✅ CONCLUÍDA 23/07: veredito **viável com ressalvas**
  (voice message *canned* via Salesbot; TTS dinâmico por turno NÃO passa no WABA
  embutido). Detalhes em `chatguru-export/docs/spike-kommo-audio-2026-07-23.md`;
  desenho da v2.1 abaixo já reflete o resultado.
- **Mineração da base (insumo v2.1/v2.2)** — ✅ CONCLUÍDA 23/07 (13.894 conversas,
  623.874 mensagens; frequências são PISO — 49,5 mil áudios não transcritos). Top
  achados: preço é a objeção nº 1 e a deflexão da casa converte (33,7% agendam em 30d);
  "quanto tempo demora?" destrava 73% (é dúvida, não recusa); reativar em **D+3–7 rende
  62% de resposta** (cai ~metade a cada semana de espera); melhor gatilho de agendamento
  = reoferta de reagendamento pós-no-show (23% agendam); blasts vendedores são
  anti-padrão comprovado (conteúdo útil rendeu 3× mais). Catálogos completos com
  verbatims em `chatguru-export/docs/mineracao-objecoes-reativacao-2026-07-23.md`.

## v2.1 — voz espelhada híbrida (ElevenLabs) — desenho pós-spike (23/07)

- **O que a spike provou**: o Salesbot tem passo nativo de *voice message* (canal WACA
  suportado; OGG/OPUS até 16 MB; o passo de voz NÃO pode ter texto/botão, senão degrada
  para arquivo baixável). Mas o anexo do passo é **estático** e não há API pública de
  envio de mídia no WABA embutido → **TTS dinâmico por turno não passa**; o que passa é
  **biblioteca de áudios canned** pré-gerados.
- **Desenho v2.1a**: biblioteca canned gerada no ElevenLabs (pt-BR, voz feminina
  consistente com a persona) para os momentos de script — apresentação com **disclosure
  gravado dentro do áudio**, transições de qualificação, convite à videochamada, top
  objeções vindas da mineração. Um bot "Ana - Voz" com um passo de voz por áudio,
  roteado por campo enum `ana_audio_key` + Condition + `bots/run` (mesmo mecanismo
  validado do texto; zero escopo/integração nova). Dados variáveis (nome, slots, link)
  vão em passo de TEXTO logo após o áudio.
- **Regra do orquestrador (espelhamento adaptado)**: lead mandou áudio E o momento tem
  canned → responde em voz; senão → texto. **Fora da janela de 24h nunca há áudio**
  (template Meta não aceita header de áudio) — retomada fria é sempre texto-template.
  Fallback: qualquer falha → texto (nunca trava).
- **Serialização de bots**: o Kommo roda um bot por entidade por vez e a conta tem 18
  bots — o orquestrador serializa voz × texto × demais disparos.
- **Gate empírico antes de codar (~1h; ENVIA mensagens de teste a número interno —
  requer go do Paulo)**: bot isolado "ZZ Teste Voz" com OGG/OPUS mono; aprovação =
  bolha PTT real (waveform/mic) em Android E iPhone; degradou para arquivo → camada
  repensada. Checklist no §8 do doc da spike.
- **Métrica extra**: % de turnos espelháveis cobertos pela biblioteca canned (mede
  quanto a limitação do áudio estático dói de verdade).
- **v2.1b (condicional)**: TTS 100% dinâmico exige **transporte próprio** (Cloud API
  direta/BSP + espelho no Kommo via canal Chats API próprio) — só se a v2.1a mover a
  taxa de resposta; casa com a visão futura do portal do cliente.
- Custo: geração canned é one-shot + regenerações eventuais — dentro dos R$ 30–150/mês.
- **Fora de escopo**: ligações telefônicas; áudio proativo (a política da Meta reforça:
  áudio não abre conversa fria).

## v2.2 — nutrição longa + objeções ampliadas

- **Gatilhos de entrada na cadência**: sumiu na qualificação (58% dos leads históricos
  morrem antes de receber oferta — o maior vazamento do funil); recusou agendar;
  no-show com ciclos de reagendamento esgotados.
- **Cadência**: D+1 até ~D+90, número/espaçamento/horários parametrizáveis na aba —
  **front-loaded por evidência da mineração**: D+3–7 rende 62% de resposta vs ~30%
  após 21 dias, então os primeiros 7 dias concentram os toques; depois espaça
  (quinzenal/mensal) com conteúdo ÚTIL (esclarecimento, serviço — que rendeu 3× mais),
  nunca blast vendedor (anti-padrões comprovados: "reajuste de honorários" 6,9%,
  "imagine recuperar…" 12,3%, case agressivo 15,6%). Toque nº 1 pós-no-show é a
  reoferta de reagendamento (23% agendam — 3–5× a média). Textos-base minerados,
  não inventados. Lead que responde **sai da cadência na hora** e volta ao fluxo
  vivo da Ana.
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
- **Objeções ampliadas** (entra nesta camada; catálogo PRONTO na mineração — 10
  objeções com verbatims + respostas que destravaram): novas intenções no intérprete —
  desconfiança/golpe (kit de prova CNPJ/site destrava 51%), "já tenho advogado",
  "vou pensar/cônjuge" (a mais letal, 18% — antídoto: converter em call CONJUNTA com
  slot fechado), "quanto tempo demora?" (resposta direta destrava 73%), "por que
  videochamada?" — cada uma com resposta-template minerada, sempre fechando com a
  trinca validação → micro-pitch de restituição → reoferta de slot; mantém handoff
  após 2 turnos sem progresso.
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

1. **Renderização PTT real não garantida por escrito no WACA** (doc do Kommo ambígua
   sobre iOS) → gate empírico da v2.1 (Android + iPhone) antes de qualquer código;
   degradou para arquivo → camada repensada.
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
