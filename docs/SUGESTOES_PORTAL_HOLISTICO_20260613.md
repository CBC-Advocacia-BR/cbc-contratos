# Portal do Cliente CBC — Auditoria Holística & 493 melhorias de alto nível
*Gerado em 13/06/2026 · auditoria multi-agente (ultracode) com 20 lentes especialistas paralelas · 588 sugestões brutas → ~493 após curadoria e dedup leve.*

---

## Sumário executivo

O portal **já está num patamar alto** em estética (8,2/10), voz/copywriting (8,0) e nos
fundamentos de alívio de ansiedade (7,5). A maior margem de evolução — e o maior retorno
sobre as duas prioridades do Paulo (ansiedade↓, tempo do escritório↓) — está concentrada em
sete frentes hoje subexploradas:

| Frente | Nota atual | Por que importa |
|---|---|---|
| Momentos emocionais críticos | **4,5** | Sentença, recurso e citação são os picos de ansiedade — hoje tratados como andamento qualquer |
| Métricas & feedback contínuo | **4,5** | Não há como saber se o portal está cumprindo o objetivo (deflexão, ansiedade) sem instrumentar |
| Gestão de expectativas de prazo | **5,5** | O silêncio do tribunal é o que mais gera ligação; previsão honesta de prazo resolve na raiz |
| Engajamento & retorno | **5,5** | Trazer o cliente no momento certo (não recarregar ansioso) depende de notificação inteligente |
| Personalização & inteligência de dados | **5,5** | Os dados ADVBOX/Asaas/Kommo dão para muito mais do que hoje se extrai |
| Casos especiais & estados vazios | **5,5** | Cliente sem contrato, só-êxito, processo parado: estados vazios viram momentos de cuidado |
| Segurança, privacidade & LGPD | **5,5** | Link sem senha exige blindagem de token e percepção de segurança |

### A grande alavanca: uma "fundação de dados" destrava dezenas de sugestões

Várias das melhores ideias dependem de **4 pré-requisitos de back-end** que, feitos uma vez,
liberam dezenas de funcionalidades sem nova rotina manual:

1. **Marco de jornada determinístico** — substituir o `jornadaIndice()` por regex frágil
   (portal-data.mjs) por uma tabela canônica `stages_id → marco (0-4)`. Base de toda estimativa.
2. **Classificador de evento crítico** — ENUM emocional por andamento (sentença favorável /
   desfavorável / parcial, recurso nosso / da parte contrária, citação, audiência, acordo,
   trânsito em julgado) via regex + glossário, **sem IA**. Hoje tudo isso cai no mesmo marco 3.
3. **Cache permanente de tradução por IA** — gravar `title_cliente` em `bot_sync_state` na
   sincronização (glossário → IA com cache → original). O portal nunca mais expõe juridiquês cru.
4. **RPC de previsão estatística de prazo por fase** (`portal_previsao`) — agrega o histórico
   real do escritório e devolve uma **faixa honesta** ("casos como o seu costumam avançar em X a
   Y semanas"), nunca uma data. Snapshot mensal para não oscilar.

### ⚠️ Achado de honestidade (corrigir com prioridade)

A lente de ansiedade sinalizou que o selo **"acima do ritmo médio"** hoje é **fixo/hardcoded**,
não calculado. É um risco de credibilidade (e ético): se um cliente perceber que o selo aparece
para todos, mina toda a confiança do portal. **Recomendação:** trocar por um cálculo real a
partir do histórico (e exibir só quando verdadeiro) ou remover. Ver primeiro item de T1.

---

## Comece por aqui (top 25)

### 🔧 Fundação — faça primeiro (destrava o resto)
1. **Marco de jornada determinístico** (`stages_id → marco`) — base de toda estimativa de prazo.
2. **Classificador de evento crítico** na sincronização (ENUM emocional, sem IA).
3. **Cache permanente de tradução** (`title_cliente` em `bot_sync_state`).
4. **RPC `portal_previsao`** — faixa honesta de prazo por fase a partir do histórico real.

### ⚡ Quick wins de alto impacto
5. **Substituir o selo de ritmo falso** por cálculo honesto (ou remover) — risco ético.
6. **Resumo "Tudo que você precisa saber hoje"** no topo de *Meu caso* (fase + último fato + próximo passo).
7. **Carimbo "Conferimos seu processo hoje às 9h14"** — horário humano real da última checagem ADVBOX.
8. **"O que mudou desde sua última visita"** — selo dourado "novo" comparando `ultimo_acesso` com as datas dos andamentos.
9. **Cartão de boas-vindas na 1ª visita** + selo "Link oficial do CBC · você recebeu pelo nosso WhatsApp".
10. **Reframing inteligente do silêncio** — "Aguardando o Tribunal; é normal nesta fase e seguimos monitorando."
11. **Push amarrado à resposta da pergunta** do cliente + reenquadramento "pode parar de conferir, a gente te avisa".
12. **Carimbo "pagamento confirmado" em tempo real** (webhook Asaas → banner + push) — encerra o "será que caiu?".
13. **2ª via / reemissão de boleto vencido** em autosserviço (deflete telefonema clássico).
14. **Selo "prazo cumprido / adiantado em X dias"** por movimentação (diligência item a item).
15. **Tradução inline de termos** com "?" tocável em cada andamento técnico.
16. **Botão flutuante de WhatsApp** (rota de fuga 1-clique) via Kommo, já identificando o cliente pelo token.
17. **Cliente só-êxito:** trocar "Tudo em dia" por **"Você só paga se ganhar"**.
18. **Stale-while-revalidate do payload** (render instantâneo do cache) + precache do app shell no Service Worker.
19. **`Promise.allSettled` no agregador** — falha parcial de uma fonte não derruba o portal inteiro.
20. **`Referrer-Policy: no-referrer`** (não vazar o token em links externos) + **expiração/rotação automática** do token.

### 🎯 Alto impacto (próxima onda)
21. **Protocolo de Sentença Desfavorável/Parcial** — nunca expor o cliente sozinho à má notícia; enquadrar + próximos passos + contato.
22. **Card-herói de Sentença Favorável** com contenção de expectativa (vitória ≠ dinheiro na conta hoje).
23. **Mini-stepper "Quando o dinheiro chega"** na aba Acordo (Sentença → Cálculo → Alvará → Banco → Sua conta).
24. **Índice de Ansiedade do Cliente** + **funil de deflexão por cliente** (métricas internas que pilotam tudo).
25. **Oferta proativa e gentil de renegociação** no portal para inadimplentes (reduz trabalho de cobrança).

---

## Como ler as seções

Cada sugestão traz tags entre parênteses: **(ansiedade · tempo do escritório · esforço · auto)**.
- **ansiedade / tempo:** impacto esperado (alto / médio / baixo).
- **esforço:** custo de implementação (baixo / médio / alto).
- **auto:** se roda sozinha a partir dos dados existentes (sim = zero rotina manual recorrente — o ideal do Paulo).

As seções estão agrupadas em 6 grandes temas. Dentro de cada tema, sub-blocos de *Quick wins*,
*Alto impacto* e *Estratégico / futuro*.

---

## Notas de maturidade por lente (0-10)

| Nota | Lente |
|---|---|
| 4.5 | Momentos emocionais criticos |
| 4.5 | Metricas, feedback e melhoria continua |
| 5.5 | Gestao de expectativas sobre prazos da justica |
| 5.5 | Engajamento, notificacoes e retorno |
| 5.5 | Personalizacao e inteligencia de dados |
| 5.5 | Casos especiais e estados vazios |
| 5.5 | Seguranca, privacidade e LGPD |
| 6.5 | Traducao de juridiques para linguagem leiga |
| 6.5 | Autosservico e deflexao de perguntas |
| 6.5 | Acessibilidade e inclusao |
| 6.5 | Mobile, performance e PWA |
| 6.5 | Escalabilidade e operacao zero-manutencao |
| 7.5 | Ansiedade por resultado — psicologia e comunicacao |
| 7.5 | Novas funcionalidades de valor |
| 7.5 | Microinteracoes e motion design |
| 7.5 | Pagamentos e financeiro |
| 8 | Copywriting e voz da marca |
| 8.2 | UX visual, hierarquia e estetica |

> *(As lentes "Onboarding" e "Confiança/autoridade" caíram por rate-limit na rodada principal e foram reprocessadas à parte — ver subseções dentro de "Tempo do escritório" e "Confiança, autoridade & inteligência de dados".)*

---


## Ansiedade, emoção & comunicação

O eixo central de todas as lentes deste tema: o cliente leigo de uma comarca do interior abre o portal querendo responder uma única pergunta tácita — "vai dar certo, e quando?". Tudo aqui converte incerteza em horizonte, silêncio em prova de vigilância e juridiquês em frase humana, sempre a partir de dados ADVBOX/Asaas/Kommo já espelhados, sem nova rotina manual. Itens marcados com (*) consolidam variantes quase idênticas vindas de lentes diferentes.

### 1. Fundação de dados (pré-requisitos que destravam o resto)

**Estratégico / futuro**
- **Marco de jornada determinístico (stages_id → marco)** — Substituir o `jornadaIndice()` baseado em regex frágil (portal-data.mjs L107-113) por tabela canônica `stages_id → marco_jornada (0-4)` preenchida uma vez. Pré-requisito de confiabilidade de toda estimativa de prazo. (ansiedade: médio · tempo: baixo · esforço: médio · auto: sim)
- **Classificador de evento crítico na sincronização** — RPC/coluna que classifica cada andamento (`bot_sync_state kind=movement`) num ENUM emocional (sentenca_favoravel/desfavoravel/parcial, recurso_nosso, recurso_da_parte_contraria, citacao, audiencia_designada, acordo_homologado, transito_em_julgado, inicio_cumprimento) via regex + dicionário `bot_glossary`, sem IA. Hoje `jornadaIndice()` joga sentença/recurso/embargos todos no marco 3 sem distinguir vitória de derrota. Fundação de todos os cards de momento. (ansiedade: alto · tempo: alto · esforço: alto · auto: sim)
- **Fallback de tradução por IA com cache permanente** — No worker de sync, aplicar a cascata `translateMovement()` já existente (glossário → IA com cache em `bot_ai_cache` → título original) e gravar o resultado numa coluna nova `title_cliente` em `bot_sync_state`. IA roda 1x por andamento novo no cron existente; o portal nunca mais expõe o título técnico cru do tribunal. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Catálogo de significado por andamento (`bot_movement_meaning`)** — Tabela `regex/contains do título → {significado_curto, exige_acao}`; o worker anexa a cada andamento um campo `significado` ("rotina, nada muda para você" / "boa notícia, o juiz analisou seu pedido" / "atenção: marcaram uma data"). ~40 padrões cobrem 90% dos casos; alimenta a timeline, o badge rotina/marco e o "Não entendi". (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Detector de juridiquês não-traduzido (qualidade do glossário)** — Quando um título cai no fallback `|| m.title`, registrar em `glossario_lacunas` (título normalizado, contagem, datas). A rotina semanal já existente agrega o top de termos não traduzidos no Monitor. Backlog automático, encaixa no cron de segunda. (ansiedade: médio · tempo: alto · esforço: baixo · auto: sim)
- **Rascunho automático de tradução para lacunas (IA + fila de aprovação)** — A rotina semanal chama a IA 1x por lacuna recorrente para gerar rascunho de tradução leiga + definição e pré-popular `bot_glossary` com `active=false`. A equipe só revisa e ativa — manutenção vira revisão de fila, não redação. (ansiedade: médio · tempo: alto · esforço: médio · auto: sim)
- **Painel admin de calibração de prazos** — Aba read-only que mostra, por fase/tipo, a faixa de prazo que o portal exibe e o N amostral, com botão "ocultar estimativa nesta fase" quando N<10. Destrava a adoção das estimativas estatísticas sem rotina: a equipe olha uma vez para liberar. (ansiedade: baixo · tempo: médio · esforço: médio · auto: sim)
- **Indicador de confiança da tradução (interno)** — Gravar `fonte_traducao` ('glossario'|'ia'|'original') em `bot_sync_state`; no painel, sinalizar traduções por IA não revisadas e títulos crus ainda expostos. Telemetria que alimenta o backlog do glossário. (ansiedade: baixo · tempo: médio · esforço: baixo · auto: sim)
- **Pré-visualização do glossário/educação como o cliente vê** — Embutir no painel admin um preview que renderiza o componente real do portal (mesmo CSS, accordion, tooltip). Garante qualidade da tradução antes de publicar. (ansiedade: baixo · tempo: médio · esforço: médio · auto: não)

### 2. Estimativa de prazo & horizonte temporal (o maior alívio de ansiedade)

**Alto impacto**
- **Previsão estatística real por fase ("casos como o seu")** (*) — RPC que agrega o histórico real do escritório (`bi_funil_historico` + `event_date`) por quadro/etapa e devolve um INTERVALO honesto: "casos semelhantes nesta fase costumam avançar em torno de X a Y semanas — você está no dia N". Sempre faixa, nunca data; snapshot mensal para não oscilar; moldura "cada caso é único". Consolida as três variantes de RPC de estimativa por fase. (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Expectativa diferenciada por tipo de ação** — Segmentar a estimativa por `tipo` de ação além da fase (RPC agrega por tipo+stages_id), para que quem está num tipo naturalmente mais lento receba expectativa calibrada ("ações deste tipo costumam ser mais longas — é esperado"). (ansiedade: médio · tempo: médio · esforço: médio · auto: sim)
- **Linha "próxima novidade esperada" com janela visual** — Da mediana de intervalo entre andamentos consecutivos do próprio processo, exibir faixa suave "pela cadência do seu caso, a próxima movimentação tende a ocorrer entre [mês] e [mês]. Você será avisado automaticamente". Acalma o impulso de recarregar. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Contagem regressiva tranquila para o próximo marco previsível** — Quando há prazo legal conhecido em curso (ex.: defesa de 15 dias após citação), mostrar "próxima movimentação esperada por volta de [mês]"; em fases sem prazo definido, não inventar — "sem prazo fixo nesta fase; avisamos assim que houver novidade". (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **"Quando o dinheiro chega" — previsibilidade do levantamento no Acordo** (*) — Mini-stepper do dinheiro na aba Acordo: "Sentença/Acordo → Cálculo homologado → Alvará expedido → Em liberação pelo banco → Na sua conta", com o ponto atual aceso pelo status do acordo (Supabase prestação) + jornada, e tempo típico por etapa ("é burocracia do banco, não depende de você"). Deflete o telefonema clássico. (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Estimativa de "quanto falta" no pós-sentença de êxito** — Substituir o prazo médio textual por estimativa calculada do próprio escritório: "casos como o seu costumam levar cerca de N meses entre a sentença e o recebimento", sempre com faixa. (ansiedade: alto · tempo: médio · esforço: alto · auto: sim)
- **"O que esperar nos próximos 3 meses" gerado por fase** — Mini-card "Olhando para frente" combina fase atual + faixa de prazo numa previsão narrativa honesta do trimestre, dando uma janela mental para não checar o portal todo dia. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Estimativa que se atualiza e mostra que melhorou** — Snapshot mensal da estimativa de prazo restante por caso; quando encurta, mostrar "boa notícia: a previsão para seu caso encurtou desde o mês passado". Se piorar, fica silencioso (não mente, não alarma). (ansiedade: alto · tempo: médio · esforço: alto · auto: sim)

**Quick wins**
- **Marco da jornada com DATA real de cada etapa** — Anexar a cada marco "done" a data em que foi atingido (do primeiro andamento que cruzou o índice, ou `process_date` para Distribuição) e, ao tocar no atual, "você está nesta fase desde DD/MM". (ansiedade: médio · tempo: baixo · esforço: médio · auto: sim)
- **Indicador de "idade do processo" com benchmark positivo** — "Seu processo foi distribuído há X; processos como o seu costumam durar [faixa] — você está [no começo/meio/reta final] desse caminho". Dá escala e perspectiva ao tempo decorrido. (ansiedade: médio · tempo: médio · esforço: médio · auto: sim)
- **"Prazo médio" textual vira calendário concreto** — Quando `prazo_medio` tiver padrão numérico de dias, derivar faixa de data a partir do último andamento ("a próxima novidade costuma chegar entre 12/jul e 11/ago"). Parsing simples, sem dado novo. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Fallback honesto quando faltam dados** — Amostra insuficiente → nada de faixa numérica: "ainda é cedo para estimar prazos com segurança; por ora, você não precisa fazer nada e estamos acompanhando". Lógica no próprio RPC. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)

### 3. Progresso visível dentro e ao longo da jornada

**Alto impacto**
- **Barra de progresso intra-fase ("você está aqui")** — Sob o ponto atual da jornada, mini-barra preenchida por `dias_na_fase / mediana_da_fase`: "esta fase normalmente leva ~X semanas; você já percorreu Z%". Acima de 100% vira "na reta final desta fase, pode avançar a qualquer momento". Reusa countUp/rAF. (ansiedade: alto · tempo: baixo · esforço: médio · auto: sim)
- **Termômetro de progresso temporal ponderado** (*) — Barra/anel de % de avanço da jornada ponderado pela duração típica de cada fase (não linear, pesos do histórico), na paleta navy/dourado: "seu caso já percorreu ~X% do caminho típico". Evita a falsa matemática de "2 de 5 = 40%". Consolida as variantes de comparativo de progresso pessoal. (ansiedade: alto · tempo: baixo · esforço: médio · auto: sim)
- **Distinção visual "tempo do tribunal" vs "tempo do escritório" na jornada** — Colorir trechos por responsável (verde suave = aguardando tribunal, dourado = ação do escritório) com legenda "a maior parte do tempo o caso está legitimamente na fila da Justiça — e nesses períodos vigiamos todos os dias". Realoca a percepção da fonte da lentidão. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)

**Quick wins**
- **Termômetro emocional "o que esperar agora" por fase** — Indicador visual de 3 estados (Período de espera tranquilo / Fase ativa do escritório / Reta final) derivado de marco + de-quem-é-a-vez, acima do accordion educativo. Comunica em 1 segundo para quem não lê textos longos. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Estimativa visual de "distância até o resultado" na carteira** — No multi-processo, leitura agregada "no conjunto, seus casos já percorreram em média ~X% do caminho", com mini-anel. (ansiedade: médio · tempo: baixo · esforço: médio · auto: sim)

### 4. Reframing do silêncio & da espera (silêncio ≠ abandono)

**Alto impacto**
- **Reframing do silêncio calibrado pelo dado** — Contextualizar `vez_dias` contra a mediana da fase: dentro do normal → "aguardando o tribunal — dentro do tempo normal desta fase"; acima → "a fila do tribunal está mais lenta nesta fase; seguimos monitorando todos os dias e cobramos quando cabe a nós". Nunca alarmar. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Contador "tempo nesta fase" com moldura de normalidade** (*) — "Você está na fase [X] há N dias — dentro do esperado para este tipo de ação"; ao ultrapassar a faixa típica, troca para "esta fase às vezes se estende; nossa equipe já está monitorando". A barra nunca enche de vermelho. Consolida as variantes de contador de fase. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Mensagem de silêncio saudável ("quanto mais quieto, melhor às vezes")** — Quando `vez=='tribunal'` e `vez_dias` alto, mapear `stages_id → tipo de espera` (decisão/prazo da parte/perícia) e gerar a frase certa: "estamos aguardando o juiz decidir — é a fase em que o silêncio costuma ser sinal de que tudo segue seu curso". (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **"Tempo desde a última atualização" reenquadrado como cuidado** — Quando a última ação da equipe for antiga MAS `vez=='tribunal'`: "neste momento o próximo passo cabe ao tribunal — por isso não há ação recente nossa. Continuamos verificando diariamente e agimos assim que for a nossa vez". Diferencia "parado" de "aguardando corretamente". (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Diário do caso: cartões de continuidade entre andamentos distantes** (*) — Quando o gap entre dois eventos > X dias, inserir item neutro na timeline "período de análise do tribunal — monitoramos seu caso N vezes neste intervalo, sem pendências para você"; se coincidir com recesso, explicitar. Transforma vazio em prova de vigilância. Consolida as variantes de "gaps explicados". (ansiedade: alto · tempo: baixo · esforço: médio · auto: sim)
- **Tradução positiva de andamentos de espera** — Para padrões que significam espera (decurso de prazo, conclusão, aguardando), o campo `significado` traduz em positivo: "o relógio do processo está correndo a seu favor — esse prazo precisa passar antes do próximo passo". (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)

**Quick wins**
- **Microcopy do "de quem é a vez" tranquilizadora** (*) — Sob o chip, linha condicional: tribunal → "a bola está com o juiz agora. Essa espera é normal e seguimos de olho todos os dias"; escritório → "estamos com uma tarefa em aberto e já cuidando dela". Texto derivado de `vez`/`vez_dias`. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Selo "sem prazo correndo contra você"** — Pill verde permanente por fase: "nenhum prazo depende de você agora", derivada de `stages_id` + de-quem-é-a-vez. Remove o medo latente de "perder prazo por inação própria". (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Contador "dias sem nenhuma pendência sua"** — "Há N dias seu caso segue sem nenhuma pendência da sua parte" (reseta só quando surge pendência real). Enquadramento positivo de uma métrica de tranquilidade. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)

### 5. Calendário forense & sazonalidade

**Quick wins**
- **Calendário forense proativo ("próximos dias sem expediente")** — Usar o algoritmo de feriados móveis já implementado para avisar ANTES: "de [data] a [data] o fórum não funciona (Corpus Christi / recesso). É normal não haver movimentação". Pré-arma a expectativa antes do silêncio. (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Faixa de vigilância com próximo dia útil explícito** — Acrescentar à barra "Verificado hoje": "próxima verificação automática: [próximo dia útil], pois o fórum não funciona em [sábado/feriado]". Garante continuidade percebida do monitoramento. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Lembrete sazonal calmante no recesso** — Enriquecer o card de recesso com contagem regressiva ("os prazos voltam a correr em N dias, dia 20/01") e push único automático por período. `recessoOuFeriado()` já calcula tudo. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Reframe do recesso como "pausa que protege você"** — Além de "prazos suspensos", acrescentar "durante o recesso nenhum prazo corre contra você — é uma pausa que vale para os dois lados". Converte pausa ansiosa em algo protetor. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)

### 6. Momentos emocionais críticos (cards de evento)

**Alto impacto**
- **Card-herói de Sentença Favorável com contenção de expectativa** — Quando o classificador detecta sentença favorável, card navy/dourado com microanimação (respeita `prefers-reduced-motion`): "saiu a decisão e foi favorável a você". Abaixo, em tom de autoridade, "favorável não significa dinheiro na conta hoje" + o que vem a seguir, para evitar o clássico "ganhei, cadê meu dinheiro". (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Protocolo de Sentença Desfavorável/Parcial — nunca expor o cliente sozinho** — Nunca mostrar o texto cru na timeline; card sóbrio (sem vermelho, sem dourado de festa): "a decisão desta fase já foi analisada pela nossa equipe. Existem próximos passos e já estamos cuidando deles" + chip "Com a nossa equipe agora" forçado + CTA WhatsApp contextual. Termo técnico suavizado até a equipe ter contato. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Diferenciar "recurso nosso" de "recurso da parte contrária"** — Emocionalmente opostos: recurso_nosso → "continuamos lutando por você"; recurso_da_parte_contraria → "é esperado e não muda o que já foi reconhecido; seguimos defendendo". Hoje o regex trata qualquer "recurso" igual. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Acordo homologado — rastreador "seu dinheiro está a caminho"** — Cabeçalho de celebração sóbria + stepper de liquidação na aba Acordo: "Acordo homologado → Alvará expedido → Valor levantado → Repasse a você", passo atual aceso automaticamente. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Trânsito em julgado — selo "agora é definitivo e seu"** — Detectar e exibir selo de encerramento positivo: "a decisão do seu caso se tornou DEFINITIVA — ninguém mais pode recorrer". O fim da ansiedade do "e se reverterem?". (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Janela de prazo recursal como contagem positiva** — Após sentença: "período de eventuais recursos: até DD/MM. Acompanhamos diariamente; se nada for apresentado, o resultado se consolida". Data estimada da sentença + 15 dias úteis CPC usando a engine de calendário forense. (ansiedade: alto · tempo: baixo · esforço: médio · auto: sim)
- **Modo "véspera de audiência" (D-3 a D-0)** — Quando faltam ≤3 dias, promover o card de audiência ao topo absoluto com data, hora, endereço, modo e "você não precisa preparar nada sozinho". No dia seguinte: "sua audiência aconteceu. Estamos analisando o que foi definido". (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Estado pós-audiência inteligente (o limbo do "e agora?")** — Entre a data da audiência passar e o próximo andamento cair, card-ponte por janela de data: "sua audiência aconteceu em DD/MM. O que foi tratado está sendo formalizado pelo tribunal; normalmente aparece aqui em alguns dias". Evita o WhatsApp por puro nervosismo. (ansiedade: alto · tempo: alto · esforço: baixo · auto: sim)
- **Marco "Êxito" com expectativa de tempo ATÉ o dinheiro cair** — Card "ganhar e receber são duas etapas" explicando cumprimento/levantamento com faixa realista do histórico de acordos, conectado à aba Acordo. Previne o "já ganhei, cadê meu dinheiro?". (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Indicador "de quem é a vez" forçado ao escritório em evento crítico** — Logo após sentença ou citação, forçar `vez='escritorio'` por janela curta com "analisando a decisão do seu caso", para o cliente nunca sentir que a bola ficou parada no momento mais sensível. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Mensagem de fechamento de fase — celebrar cada avanço de marco** — Detectar (jornada atual vs último valor em localStorage) quando o caso sobe de marco e exibir banner celebratório sóbrio: "boa notícia: seu caso avançou para [marco] — um passo importante a caminho do resultado". (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Reframe do recurso como etapa normal e prevista** — Quando jornada chega a Sentença/Êxito e há recurso na timeline: "recurso é parte normal do caminho — não apaga o que já conquistamos. Adiciona em média [faixa do histórico] de tempo, e seguimos atuando". (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)

**Quick wins**
- **Card de Citação — desmistificar o momento que mais assusta o leigo** — Quando detectada citação: "a outra parte foi oficialmente notificada do seu processo. Isso é um passo positivo — a Justiça colocou seu caso em movimento". (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Realce visual do evento crítico DENTRO da timeline** — Eventos classificados como críticos ganham ponto maior, borda dourada e micro-rótulo "Marco do caso", com o texto já suavizado. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Badge "rotina" vs "marco" na timeline + filtro** — Selo discreto cinza (rotina, recolhível) vs dourado (marco), com opção "mostrar só os marcos importantes". Reduz a sensação de caos. Deriva do catálogo de significado. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Transição visual suave ao entrar em estado crítico** — Card-herói desliza do topo após ~600ms (saudação normal primeiro), ainda mais lento e sem cor de alarme no desfavorável. A notícia chega "acompanhada", nunca como soco visual. (ansiedade: médio · tempo: nenhum · esforço: baixo · auto: sim)
- **Supressão inteligente de termos ansiogênicos perto de marco** — Quando "penhora/bloqueio/expedição de mandado" estão ligados a marco positivo (cumprimento a favor do cliente), reescrever para a perspectiva do cliente: "iniciamos a cobrança do valor que você tem a receber". Estende o `glossaryTranslate` com regras sensíveis ao contexto. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Card de "acordo proposto/em negociação" antes da homologação** — Se detectada audiência de conciliação ou proposta: "há um movimento de acordo no seu caso. Nossa equipe vai orientar você sobre os termos — a decisão final é sempre sua". Reforça autonomia. (ansiedade: médio · tempo: médio · esforço: médio · auto: sim)

**Estratégico / futuro**
- **"Cofre do momento" — agregação dos eventos críticos** — Seção colapsável "Momentos do seu caso" que lista só os eventos críticos classificados, cada um com texto tranquilizador e data, separados do ruído da timeline. (ansiedade: médio · tempo: médio · esforço: médio · auto: sim)
- **Linha do tempo emocional pessoal (replay dos marcos vividos)** — Para reta final/êxito: "sua jornada: distribuído em X, citação em Y, sentença favorável em Z, agora recebendo". Transforma ansiedade acumulada em narrativa de conquista. (ansiedade: médio · tempo: baixo · esforço: médio · auto: sim)
- **Mensagem proativa de "prazo do tribunal estourado" com cuidado** — Quando o tribunal excede o prazo legal: "o tribunal ainda não se manifestou no prazo previsto — é comum dado o volume, e quando se justifica nossa equipe já peticiona cobrando andamento". Transforma revolta em prova de ação. (ansiedade: alto · tempo: médio · esforço: alto · auto: sim)
- **Aviso proativo de marco lento com tom de cuidado** — Ao ultrapassar o percentil 90 do histórico: "sabemos que esta fase está levando mais que o usual. Isso acontece e não significa problema — quer que nossa equipe te explique? [Pedir um retorno]" cai no "Pergunte aqui" com tag prioritária. Deflete a ligação ansiosa. (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)

### 7. Compromissos: audiência, perícia e calendário

**Quick wins**
- **Contagem regressiva + .ics para audiência/perícia** (*) — Reaproveitar o helper ICS/Google Calendar das parcelas (detecção iOS/Android, VALARM) no card de audiência, com contagem viva ("faltam N dias") e mini-checklist de preparo por fase na semana do evento. Consolida as três variantes desta ideia. (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Copy de countdown + reasseguramento de preparo** — "Faltam N dias para [compromisso]. Perto da data, ligamos para te explicar exatamente o que esperar e como se preparar. Até lá, você não precisa fazer nada." Usa `atividades.audiencia` já detectada. (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)

### 8. Pagamentos & dinheiro (alívio financeiro)

**Alto impacto**
- **Confirmação destacada de pagamento recebido + recibo por parcela** (*) — Parcela que transita para pago (<72h) gera banner verde celebratório no topo de Pagamentos: "recebemos seu pagamento de R$ X em DD/MM — obrigado, está tudo certo" com check animado e botão "Baixar recibo desta parcela" (jsPDF já carregado). Deflete a ligação "vocês receberam meu pagamento?". (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Parcela vencida com acolhimento + ação, não punição** (*) — Trocar a pill vermelha "Vencido" por card acolhedor "esta parcela passou do vencimento — acontece. Você pode pagar agora pelo PIX/boleto abaixo (já atualizado) ou falar com a gente para reorganizar" + WhatsApp contextual. Remove o medo de "perdi o caso por causa do atraso". (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Copy da nota de acordo "em andamento" com prazo e reasseguramento** — "Essa conferência existe para proteger você — garantir que cada valor está exato antes de cair na sua conta. Costuma levar poucos dias úteis e nós chamamos você. Você não precisa fazer nada agora." (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)

**Quick wins**
- **Traduzir status do boleto Asaas para linguagem humana** — Mapa estático dos enums Asaas: `AWAITING_RISK_ANALYSIS` → "pagamento em conferência pelo banco — pode levar 1 dia"; `RECEIVED` → "pagamento confirmado, obrigado!". Cobre estados de borda que hoje vazam código cru. (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Comprovante de marco emocional em PDF** — Em acordo homologado ou trânsito em julgado, "Comprovante do marco" sóbrio (jsPDF + logo) com nome, processo e a frase do marco. Objeto tangível de tranquilidade/orgulho, sem expor peça sigilosa. (ansiedade: médio · tempo: baixo · esforço: médio · auto: sim)

### 9. Canal humano & handoff automático (Kommo/WhatsApp)

**Alto impacto**
- **WhatsApp 1-clique para o escritório, contextualizado** (*) — Botão persistente discreto com `wa.me` do número real e mensagem pré-montada ("Olá, sou [nome], processo [número]..."), copy de convite ("atendemos em horário comercial e respondemos com calma cada dúvida"). A simples presença visível do canal humano reduz ansiedade (efeito rede de segurança). Consolida as variantes de CTA WhatsApp. (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **CTA de WhatsApp condicionado a momentos críticos** — Além do botão fixo, "Falar com a equipe sobre esta decisão" SOMENTE nos cards críticos (sentença, especialmente desfavorável/parcial, e acordo), concentrando o contato humano onde importa. (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Tarefa/nota automática no Kommo em evento crítico (handoff sem rotina)** — Quando o monitor detecta sentença, citação ou audiência designada, criar tarefa no lead Kommo ("Cliente X teve sentença — fazer contato proativo") com SLA, prioridade alta no desfavorável. Reusa o caminho do `portal-feedback`. (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Mensagem proativa de WhatsApp via Salesbot run em evento crítico** — Para sentença, audiência designada e acordo homologado, disparar Salesbot run (como na régua de cobrança): "houve uma novidade importante no seu caso. Veja com calma no seu portal: [link]". Sem ninguém digitar. (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **NPS detrator dispara acolhimento automático** — Nota ≤6 mostra na hora "sentimos muito que sua experiência não esteja boa — queremos te ouvir" + WhatsApp 1-clique e cria nota/tarefa no Kommo. Transforma frustração em contato. (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)

**Estratégico / futuro**
- **Modo "aguardando contato" que sincroniza portal e equipe** — No desfavorável/parcial, após criar a tarefa Kommo, o card reflete "nossa equipe vai falar com você em breve" e, quando a tarefa é concluída, "já conversamos com você sobre esta decisão". Fecha o loop emocional (depende do escopo do KOMMO_TOKEN). (ansiedade: alto · tempo: médio · esforço: alto · auto: sim)
- **Pesquisa de sentimento de 1 toque após evento crítico** — "Essa notícia ficou clara para você? Sim / Tenho dúvidas"; "Tenho dúvidas" dispara nota/tarefa no Kommo. Captura o detrator emocional no momento de risco, sem esperar o ciclo de 30 dias do NPS. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)

### 10. Push & "pode parar de conferir"

**Alto impacto**
- **Push amarrado à resposta da pergunta do cliente** — Quando a equipe responde em `portal_perguntas` (`respondida_em`), disparar Web Push para o token + Realtime no portal para atualizar sem refresh. O gatilho é o ato de responder que a equipe já faz. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Push com TOM por tipo de evento** — Montar o corpo do push pelo classificador: favorável → "boa notícia no seu caso"; audiência → "lembrete: sua audiência é em X dias"; desfavorável/recurso → neutro-cuidadoso "há uma atualização importante; nossa equipe já está acompanhando". Nunca alarmante. (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Reenquadrar o opt-in de push como alívio, não tecnologia** (*) — "Pode parar de ficar conferindo: deixe que a gente te avisa no celular assim que algo se mover. Sem novidade = está tudo certo, é normal." Após ativar, estado de paz "avisos ligados — agora é só esperar tranquilo". Combate o hábito de recarregar. (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Push de "check-in" em silêncios longos (anti-abandono)** — Cron que, após N dias sem andamento e com push ativo, envia "tudo certo com seu caso — verificamos hoje, sem novidades do tribunal ainda. Continuamos de olho". Frequência limitada (ex.: a cada 21 dias) para não virar spam. (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)

### 11. Personalização da vigilância & da novidade

**Alto impacto**
- **"Última verificação do SEU processo" (não só do monitor global)** — Derivar por processo o timestamp da última leitura daquele `lawsuit_id` e exibir "seu caso foi verificado [hoje às HH:MM / ontem]". Aumenta a sensação de vigilância individual; mantém a barra global como fallback. (ansiedade: alto · tempo: baixo · esforço: médio · auto: sim)
- **Novidade calibrada por "visto/lido"** (*) — Marcar em localStorage a última visita e o último andamento visto; "novidade" passa a ser "apareceu desde sua última visita" (até ser visto), com marcador "novo" que some após visualizado e pulsa no bottom-nav para eventos críticos. Calibra a sensação de novidade ao comportamento real. (ansiedade: médio · tempo: baixo · esforço: médio · auto: sim)

**Quick wins**
- **Microcopy "Conferimos seu processo hoje"** — Trocar "Verificado" por verbo humano em 1ª pessoa do plural; no toque, tooltip "todo dia útil um robô lê as publicações do seu processo e avisa nossa equipe se algo precisa de atenção". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **"Você não está sozinho": prova social de casos na mesma fase** — Linha discreta agregada e anônima de `bi_processos`: "outros N clientes do escritório estão nesta mesma fase agora — o ritmo do seu caso está dentro do esperado". Normaliza a espera e reforça autoridade. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)

### 12. Ritmo honesto (substituir o selo falso)

**Alto impacto**
- **Selo de ritmo HONESTO calculado** (*) — Substituir o badge hardcoded "avançando acima do ritmo médio" (`p.rapidez = jornada>=1`, portal-data.mjs L210) por RPC `portal_ritmo_fase` que compara o caso contra a mediana real do mesmo `stages_id`/quadro. Exibir o selo dourado só no quartil mais rápido; média → "seu caso segue o ritmo típico"; lento → não alarmar, "esta fase costuma levar mais tempo — é normal, estamos acompanhando". Verdade calibrada sustenta autoridade. Consolida as três variantes (lentes de ansiedade, prazos e momentos críticos). (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Selo de ritmo calculado no momento da sentença** — No pico positivo, "seu caso chegou à sentença em N meses — mais rápido que a média de casos semelhantes do escritório", quando verdadeiro; quando não, simplesmente não exibir. (ansiedade: médio · tempo: baixo · esforço: médio · auto: sim)

**Quick wins**
- **Copy interina honesta do selo de ritmo** — Enquanto o cálculo real não existe, suavizar para "seu caso está dentro do bom ritmo — e seguimos empurrando cada etapa". Evita prometer velocidade sem mentir. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)

### 13. Educação por fase & mapa do caminho

**Alto impacto**
- **Painel "o que vem depois desta fase" (o caminho até o resultado)** — Accordion determinístico listando as próximas etapas a partir do marco atual, com 1 linha e tempo típico cada ("após a sentença: possível recurso ~X meses → cumprimento → levantamento"). Dá o mapa inteiro, reduzindo o medo do desconhecido. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Explicador "Por que a Justiça é lenta (e por que isso não é abandono)"** — Accordion fixo com 3-4 pontos curtos (volume por juiz, prazos legais obrigatórios, análise do magistrado, "90% do tempo o processo está legitimamente na fila"), fechando com "enquanto isso, nós vigiamos todos os dias". Conteúdo estático via `bot_config`. (ansiedade: alto · tempo: alto · esforço: baixo · auto: sim)
- **FAQ contextual que aparece SÓ no momento do evento** — Bloco disparado pelo evento recém-ocorrido: após sentença favorável, "Ganhei, e agora?", "Quando recebo?", "A outra parte pode recorrer?"; após audiência, "O que foi decidido?". Desvia exatamente as perguntas que disparam ao WhatsApp nos picos. Mapeia evento → bloco de `portal_educacao`. (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Tradução do nome técnico da fase ADVBOX para nome humano** — Coluna `nome_cliente` em `bot_stage_templates` (ao lado de `ocultar_cliente`): "Aguardando manifestação" → "Esperando o juiz decidir", "Cumprimento de sentença" → "Recebendo o que você ganhou". Determinístico, editável no painel. (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)

**Quick wins**
- **Analogias do dia a dia por fase** — Campo `analogia` fixo por marco em `portal_educacao`: Distribuição = "como tirar a senha no banco: seu caso entrou na fila do juiz"; Citação = "avisamos a outra parte, como entregar uma carta registrada". Escrito 1x. (ansiedade: alto · tempo: médio · esforço: baixo · auto: não)
- **Modo "cada caso é único" anti-comparação** — Bloco estático "por que seu caso pode levar tempo diferente do de outra pessoa" (tipo de ação, comarca/vara, comportamento da outra parte). Neutraliza a comparação com o vizinho/parente. (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Card de autoridade temporal ("o que depende de nós, fazemos antes do prazo")** — "X tarefas concluídas, todas dentro do prazo judicial (média de Y dias antes do limite)", de `atividades.tarefas_concluidas` + folga média. Desloca a fonte da espera para o sistema, não o time. (ansiedade: médio · tempo: médio · esforço: médio · auto: sim)
- **Linha do tempo com "capítulos" do caso** — Agrupar visualmente eventos próximos sob título-capítulo leigo derivado da jornada ("Capítulo: provando o seu direito", "Capítulo: recebendo o que você ganhou"). Transforma lista técnica em história. (ansiedade: médio · tempo: médio · esforço: médio · auto: sim)

### 14. Tradução de juridiquês & glossário

**Alto impacto**
- **Linha "O que isso significa para você" por andamento** — Sob cada evento da timeline, frase em itálico do campo `significado` com cor (cinza=rotina, dourado=avanço, verde=ação). Resolve a lacuna do "tradução termo a termo, mas e daí?". (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)
- **Resumo do caso "em uma frase de criança de 12 anos"** — Gerar 1x por andamento novo (IA + cache) uma frase única: "em resumo: seu processo está esperando o juiz analisar os documentos que enviamos — é normal e não exige nada de você", baseada em fase + último andamento + de-quem-é-a-vez. Exibida no topo do card de situação. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Glossário-tooltip em TODAS as abas (Acordo, FAQ, contrato, pagamentos)** (*) — Extrair `marcaTermos()` (portal.html L432) para função genérica e aplicá-la onde a carga emocional financeira é maior. Reusa `state.dados.glossario` e o handler de toque. Consolida as quatro variantes desta ideia. (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Traduzir a aba Acordo: "para onde foi cada real"** (*) — Micro-explicação leiga fixa por tipo de linha: honorários → "a parte do escritório, combinada no contrato"; custas → "taxas que o processo cobra"; correção monetária → "reajuste pela inflação do período, a seu favor". Transparência radical = confiança. Consolida com a variante de copywriting. (ansiedade: alto · tempo: alto · esforço: baixo · auto: sim)
- **Modo "Explica como se eu tivesse 5 anos" por andamento (sob demanda)** — Link discreto "Não entendi" em cada evento mostra o `significado` detalhado pré-gerado; só o resíduo vira pergunta humana pré-preenchida. Deflexão real para os ~40 padrões catalogados. (ansiedade: alto · tempo: alto · esforço: médio · auto: sim)

**Quick wins**
- **Tradução do "de quem é a vez" em linguagem de espera concreta** — Mapear `vez`+`vez_dias`: "tribunal/15 dias" → "o juiz está com seu caso na fila de análise — esse tempo é normal nesta fase"; "escritório" → "estamos preparando o próximo passo agora". (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Traduzir "honorários de êxito" com exemplo numérico** — "Exemplo: se no final você receber R$ 10.000, R$ X (Y%) seriam honorários e R$ Z ficariam com você", de `honorarios_percentual_exito`. Desfaz o medo de "pago sobre o valor da causa". (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Glossário visual: ícone "ⓘ" tocável + coachmark** — Substituir/complementar o sublinhado pontilhado por selo "ⓘ" dourado de 16px após o termo, com coachmark único na primeira visita. Idosos descobrem o glossário em vez de achar por acaso. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Glossário inline persistente (popover, não toast de 7s)** — Trocar o toast efêmero por popover ancorado que permanece até fechar (toque fora ou X), respeitando A+/A-. Para idosos lerem com calma. (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **Incluir termos regex do glossário no tooltip** — portal-data.mjs L301 descarta termos `regex` (os mais ricos). Enviar `palavra_exibida`/flag `re` ao front para cobertura total sem manutenção. (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **Traduzir siglas de tribunais e órgãos** — TJSP → "Tribunal de Justiça de SP", DJe → "Diário Oficial da Justiça", Vara Cível → "a sala do juiz responsável", aplicando `marcaTermos` também sobre "Fonte:". Lista pequena e estável. (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **Traduzir o jargão de valor ("publicações analisadas")** — "Publicações oficiais" → tooltip "avisos que o tribunal divulga todo dia útil — nós lemos todos para não perder nada do seu caso". Reforça valor sem jargão. (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **Tom de voz único na tradução automática** — Embutir um guia de tom (positivo, claro, sem diminutivos, tranquilizador com autoridade) como instrução-mãe no prompt da IA (`iaCfg.instrucao`) e checklist no preview. Configuração 1x. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)

**Estratégico / futuro**
- **Cartão "Dicionário do meu caso"** — Cruzar os termos do glossário que de fato apareceram nos andamentos daquele cliente num card recolhível "as palavras que aparecem no seu processo". Interseção feita no front. (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Camada de tradução de título de documento (quando o espelho capturar anexos)** — Preparar o catálogo "Petição inicial" → "o pedido que abriu seu processo", "Despacho" → "uma ordem do juiz". Habilitável quando anexos existirem. (ansiedade: médio · tempo: médio · esforço: médio · auto: sim)

### 15. Copywriting, voz da marca & TTS

**Alto impacto**
- **Corrigir o resumo falado: TTS afirma "tudo caminhando bem" sempre** — A primeira frase fixa do `ouvirResumo()` contradiz o `statusHumano(p)`. Montar a frase a partir do mesmo status já exibido na tela. Alinha voz falada e escrita; sustenta a confiança do público idoso. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Nomear o responsável humano do caso** — Usar `p.responsavel` (já no espelho): "seu caso está nas mãos de [Primeiro Nome], com o apoio da equipe CBC". Cliente ansioso quer um nome de referência, não um time anônimo. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Resumo falado expandido para Pagamentos e Acordo** (*) — Estender o `SpeechSynthesis` pt-BR para resumir, sob demanda, Pagamentos ("você já quitou X de Y, próxima parcela em DD/MM, nada vencido") e Acordo ("valor líquido R$ X, status em andamento"), com botão "Ouvir" contextual. Atinge o público idoso nas abas de maior carga emocional. Consolida as variantes de TTS por aba e TTS com prazo. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **"Ouvir resumo" adaptativo ao momento crítico** — Em evento crítico, o áudio incorpora o evento: "boa notícia: saiu a sentença e foi favorável. Isso significa... Os próximos passos são...". Reusa o motor de TTS, muda só o texto. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Saudação com micro-contexto do que mudou** (*) — Sub-linha gerada por código: andamento desde o último acesso → "tem novidade desde a sua última visita"; senão → "nada novo precisa de você hoje — tudo seguindo seu curso". Responde a pergunta tácita no topo. Consolida as variantes de saudação dinâmica e tom sensível ao momento. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Microcopy "expectativa de próxima novidade" a partir do prazo médio** — Transformar `prazo_medio` em frase visível: "pelo ritmo desta fase, a próxima novidade costuma vir em torno de [prazo]. Se chegar antes, você é avisado na hora". (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Copy do "Outros ajustes" do acordo com transparência** — Rotular "Outros valores do processo" + `<small>` "pequenas diferenças como taxas bancárias, atualizações ou descontos já combinados. Qualquer dúvida, é só perguntar que detalhamos". Convida ao diálogo em vez de esconder. (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)

**Quick wins**
- **Reescrever rótulos frios em linguagem humana** — "Movimentações/acompanhadas e analisadas" → "Passos do processo acompanhados"; "Linha do tempo" → "Tudo que aconteceu no seu caso". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Padronizar a personalidade dos toasts** — Guia de voz único (1ª pessoa do plural, gentil, começa pelo que deu certo): "Ops, parece que você está sem internet. Tente de novo em instantes." / "Não consegui copiar sozinho — segure o dedo no código". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Aquecer os estados de erro** — "Não conseguimos abrir agora. Pode ser a sua internet oscilando. Tente de novo em um minuto — seus dados estão seguros"; link inativo → "este link expirou por segurança. Chame a gente que enviamos um novo na hora". (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Humanizar os estados vazios com voz coerente** — Fórmula "normalizar + agir por você + nada a fazer": timeline → "ainda silêncio por aqui — e isso é bom. Começo de processo costuma ser quieto. No primeiro movimento, ele aparece aqui sozinho e você é avisado". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Frase de fecho calorosa por aba** — Pagamentos → "cada pagamento aqui é registrado e você pode baixar o comprovante quando quiser"; Acordo → "conferimos cada centavo antes de qualquer repasse"; Dúvidas → "nenhuma pergunta é boba. Estamos aqui para isso". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Subtítulo dinâmico do header** — Sem pendência → "tudo seguindo seu curso. Pode acompanhar com tranquilidade"; com novidade → "você tem novidade para ver hoje". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Resumo consolidado da carteira em voz humana** — "Cuidamos de N casos seus. X tiveram novidade esta semana e Y já estão na reta final — o resto segue sob vigilância diária"; X=0 → "nenhum precisa de você esta semana". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Legenda de uma linha por marco do stepper** — Sob o marco atual: Citação → "agora a outra parte foi formalmente avisada e precisa responder". 5 strings conectando visual e significado sem abrir accordion. (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Confirmação humana do "Pergunte aqui"** — Status "Recebida — nossa equipe já vai responder" (em vez de "Aguardando") e, na resposta, prefixar "Resposta da nossa equipe:". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Copy do CTA de avaliação Google estendido ao detrator** — Nota ≤6 (e 7-8) → "obrigado pela sinceridade. Sua avaliação já chegou para a nossa equipe e vamos olhar com atenção. Se quiser, conte aqui o que faltou". (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Copy de "tempo nesta fase" humano** — "Seu caso está nesta fase há N [semanas/meses] — dentro do esperado para este tipo de ação". Reframa duração como normalidade. (ansiedade: alto · tempo: médio · esforço: médio · auto: sim)
- **Confirmação concreta do "Adicionar lembrete"** — iOS → "Pronto! Toque no arquivo que baixou e escolha Adicionar ao Calendário"; Android → "Abrimos o Google Agenda para você — é só tocar em Salvar". (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **Mensagem de compartilhar/indicar com orgulho, não venda** — Família → "quero que você acompanhe junto comigo o nosso caso. É só abrir, sem senha:"; indicar → "se conhece alguém que precisa de um escritório que explica tudo de verdade, ficaremos honrados com a indicação". (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **Copy do PDF do extrato com voz da marca** — Rodapé → "este extrato foi gerado para você pelo Portal do Cliente CBC Advogados. Qualquer dúvida sobre os valores, estamos à disposição"; título → "Seu extrato de pagamentos". (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **Rótulos de aba mais acolhedores** — "Dúvidas" → "Ajuda" ou "Falar com a gente" (sugere acolhimento, não problema); avaliar "Meus boletos". (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **Copy convidativa do "Ouvir resumo"** — "Prefere ouvir? Toque para a gente ler o resumo do seu caso em voz alta"; rótulo → "Ouvir o resumo do meu caso". Recurso de acessibilidade subutilizado por falta de copy. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Plurais e números com voz natural** — "Nenhuma parcela em aberto" em vez de "0 parcelas"; "Uma novidade esta semana" em vez de "1 novidade". (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)

**Estratégico / futuro**
- **Coerência de capitalização e nomenclatura da marca** — Mini guia de voz (sempre 1ª pessoa do plural; "a gente" no caloroso, "nossa equipe/escritório" na autoridade; cliente sempre "você"; nunca "usuário") aplicado a todas as strings. Trabalho único. (ansiedade: baixo · tempo: baixo · esforço: médio · auto: sim)
- **Frase de fé rotativa ampliada e ancorada em prova** — Expandir para ~12-15 frases verificáveis ("cada andamento do seu processo passa por olhos humanos, não só por um robô") e algumas focadas em paciência/prazo, indexadas pelo dia do ano. Reduz repetição e o ar de slogan. (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)

### 16. Onboarding, segurança percebida & disclaimer

**Quick wins**
- **Onboarding de primeira visita ("tour de 20 segundos")** (*) — Overlay leve dispensável (flag em localStorage por token), respeitando `prefers-reduced-motion`, com 3 passos que combinam orientação de uso + calibração de tempo + compreensão: "aqui você vê a situação do seu caso", "toque nas palavras sublinhadas para a tradução", "linhas cinza são rotina; douradas são novidades", abrindo com "tudo o que você precisa saber sobre seu caso, sem precisar ligar". Consolida as quatro variantes de onboarding (ansiedade, prazos, copy, tradução). (ansiedade: alto · tempo: médio · esforço: baixo · auto: sim)
- **Microcopy de segurança que explica o "sem senha"** — "Seu link é único e pessoal, como uma chave só sua. Por isso você entra sem senha. Não compartilhe com quem você não queira que veja seu caso". Tranquiliza o cliente desconfiado/idoso. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)
- **Disclaimer anti-promessa persistente e elegante** — Micro-rodapé discreto perto de qualquer número de prazo: "as estimativas baseiam-se em casos semelhantes; cada processo segue seu próprio ritmo e a Justiça não garante datas". Em itálico Cormorant, dourado suave, não alarmante. Protege o escritório. (ansiedade: médio · tempo: médio · esforço: baixo · auto: sim)
- **Selo "Nada pendente do seu lado" global e persistente** — Chip discreto e fixo (verde) sempre que não houver parcela vencida nem documento solicitado nem audiência em <7 dias; muda para "Há 1 item para você" (deep-link) só quando realmente houver. Reduz a ruminação "será que estou esquecendo algo". (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Tradução de estados vazios/transitórios de borda** — "Em distribuição" → "em distribuição (o sistema do tribunal ainda está registrando seu número — é normal nos primeiros dias)". Amplia o texto de `vProcesso`/`erroEstado`. (ansiedade: médio · tempo: baixo · esforço: baixo · auto: sim)

### 17. Deflexão de perguntas (autosserviço inteligente)

**Alto impacto**
- **Auto-resposta instantânea do "Pergunte aqui" quando já coberto no FAQ** — Match leve de similaridade contra `portal_faq` + educação por fase no próprio `portal-pergunta.mjs`; com alta confiança, responder na hora "encontramos isto que pode te ajudar agora: [...]" e ainda registrar para a equipe confirmar. Reduz ansiedade (resposta imediata) e libera tempo (menos perguntas repetidas), sem conteúdo novo. (ansiedade: médio · tempo: alto · esforço: médio · auto: sim)

---

## Tempo do escritorio & autosservico

Curadoria de 99 sugestoes brutas (3 lentes) reduzidas a 52 ideias unicas. O fio condutor: cada item deflete uma pergunta antes que ela vire ligacao ou tarefa manual, transformando dados ja existentes (ADVBOX/Asaas/Kommo/Prestacao) em autosservico tranquilizador. Onde havia duplicatas quase identicas entre lentes, mantive a melhor versao e citei as variantes.

---

### 1. Resposta-instantanea e deflexao na propria duvida
O objetivo desta sub-secao e: o cliente encontra a resposta sem abrir 30 sanfonas e sem ligar.

**Quick wins**
- **Busca instantanea na aba Duvidas** — Campo search-as-you-type (JS vanilla, sem backend) que filtra em tempo real sobre todo o corpus ja carregado (portal_faq + educacao[0..4] + glossario), normaliza acentos, destaca o trecho e mostra "X respostas para sua busca"; zero resultado pre-preenche o "Pergunte aqui". (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **Chips de pergunta de 1-toque** — Acima do textarea, chips contextualizados pela fase ("Quando devo esperar novidade?", "Como esta meu pagamento?", "Preciso fazer algo agora?"); chip com resposta no FAQ mostra na hora (deflexao direta), chip sem resposta vira pergunta bem-formada para a equipe. (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **Auto-resposta instantanea no "Pergunte aqui"** — Antes de gravar, matching leve por tokens/palavras-chave contra portal_faq + educacao[fase]; se confianca alta, devolve "Talvez isto ja responda..." com botoes "Resolveu, obrigado" (encerra, NAO cria tarefa Kommo) ou "Quero falar com a equipe". Cada "Resolveu" e uma tarefa que o time nao abriu. (consolida 3 variantes das tres lentes) (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Historico pesquisavel das proprias perguntas** — Expandir "Suas perguntas" (hoje so 6) com busca local e "ver todas", destacando respondidas; antes de enviar nova, se houver match com uma ja respondida do proprio cliente, sugerir "Voce ja perguntou algo parecido — veja a resposta". (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)

**Alto impacto**
- **FAQ dinamico priorizado por fase e tipo de acao** — Reordenar/etiquetar portal_faq pela jornada atual (p.jornada) e tipo de acao, com selo "Mais provavel para o seu momento" no topo; tags por marco/tipo viram colunas opcionais no CRUD de FAQ ja existente, com fallback ao comportamento atual. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Bloco "Duvidas comuns de quem esta na sua fase"** — Alimentado automaticamente das perguntas mais frequentes ja respondidas (portal_perguntas status Respondida), agrupadas por marco e anonimizadas; deflexao coletiva sem produzir conteudo novo. (ansiedade: baixo · tempo: alto · esforco: medio · auto: sim)

---

### 2. Tranquilizacao e compreensao no proprio conteudo
Antecipar o medo e explicar o jargao item a item, exatamente onde ele aparece.

**Quick wins**
- **Resumo "Tudo que voce precisa saber hoje"** — Cartao no topo de Meu caso com 1 frase de veredito ("Esta tudo em ordem — sem pendencias suas") + 3 bullets dinamicos (proxima novidade esperada, proximo pagamento, se ha algo a fazer); consolida o que ja existe espalhado e mata a ligacao-conforto de "so queria saber se esta tudo bem". (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Explicacao por toque em cada numero da quebra do acordo** — Cada linha da distribuicao (recebido, honorarios, custas, correcao, ajustes) ganha icone de ajuda com toast em linguagem simples derivado dos proprios campos do calculo ("Honorarios: o combinado em contrato, X% — so sobre o que voce recebeu"; "Correcao: o reajuste pela inflacao, a SEU favor"). (ansiedade: alto · tempo: alto · esforco: baixo · auto: sim)
- **Glossario-tooltip em todas as abas** — Generalizar a funcao glossariza (hoje so na timeline) para rodar tambem em Acordo, Pagamentos, FAQ e card de contrato; mesmo dado (state.dados.glossario), zero esforco, deflete o "o que significa alvara/levantamento?". (consolida 2 variantes) (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Cartao "O que NAO vai acontecer" em Pagamentos e Acordo** — Reaproveitar o componente de educacao para mini-blocos de tranquilizacao parametrizaveis via bot_config ("Atrasar nao apaga seu pagamento; e so reemitir"; "O valor liquido ja considera todos os descontos — sem surpresas"). (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Mini-FAQ proativo de honorarios de exito no card de contrato** — Texto fixo e tranquilizador ("O exito so e cobrado se voce ganhar e somente sobre o valor que entrar para voce"; "Sem exito, nao ha esse honorario"; "O parcelamento inicial nao muda"); antecipa a duvida financeira mais sensivel e deflete a ligacao para o socio. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **"Ouvir resumo" (TTS) tambem em Pagamentos e Acordo** — Estender o SpeechSynthesis ja implementado para narrar o resumo financeiro ("Voce ja pagou R$ X; ha N parcelas em aberto, a proxima vence DD/MM") e do acordo ("Seu valor liquido e R$ Y, previsto para DD/MM"). (consolida 2 variantes) (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Recesso/feriado personalizado pela fase** — Em vez do aviso generico, conectar com a situacao: prazo correndo ("seu prazo esta suspenso e volta DD/MM — nada se perde"), aguardando decisao ("a fila pausa e retoma DD/MM"), acordo a receber ("o repasse pode levar alguns dias a mais por causa do recesso bancario"). (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Badge de progresso percentual da jornada** — Anel/barra "Seu caso ja percorreu ~N% do caminho" com micro-copy por faixa ("Bem encaminhado", "Reta final a vista"), derivado do jornadaIndice ja existente. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Carteira multi-processo consolidada** — No resumo do carrossel, ranquear casos por estagio/atividade e destacar "Seu caso mais avancado: [tipo] na reta final" + "Os demais sob vigilancia, sem acao necessaria"; visao executiva tranquilizadora para quem tem varios processos. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Termometro/reframe de relevancia em cada andamento** — Classificar cada andamento por codigo/palavras-chave (regra deterministica sobre termos ja traduzidos) em selos: "Rotina — nada a fazer" (verde), "Avanco do seu caso" (dourado), "Acompanhando de perto" (neutro); para termos sensiveis ("recurso", "contestacao", "improcedencia parcial") anexar selo "Etapa normal e prevista — ja faz parte da estrategia". Configuravel via campo "tranquilizador" no glossario. (consolida 2 variantes) (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **"Por que esta demorando" quando o caso esta parado** — Quando vez_dias ultrapassa um limiar por fase, cartao educativo automatico "Por que esta fase costuma demorar" (reaproveita educacao) + reforco da vigilancia ("verificamos todo dia util; quando o tribunal se mover, voce e avisado"); antecipa a ligacao de abandono percebido. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Linha do tempo PREVISTA dos proximos marcos** — Abaixo do stepper, secao "O caminho a frente" com 1-2 marcos futuros em estilo fantasma (pontilhado, "~tempo estimado", sem data exata) usando educacao da fase + mediana; deixa explicito que ha um plano. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Transparencia "quem cuidou do seu acordo"** — Linha discreta na aba Acordo "Calculo conferido por [nome] em DD/MM" + historico "Atualizado em DD/MM" a partir de activity_log/saved_by da Prestacao; reforca responsabilidade humana no momento de maior desconfianca (dinheiro). Somente leitura. (ansiedade: alto · tempo: baixo · esforco: baixo · auto: sim)
- **Simulador transparente de valor a receber** — Quando em execucao/exito mas sem acordo lancado, card "Como seu valor sera calculado" usando o honorarios_percentual_exito do proprio contrato (bruto − honorarios − custas + correcao), claramente ilustrativo; reduz a ansiedade financeira na espera. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Previsao estatistica real de tempo por fase** — RPC portal_previsao agregando bi_funil_historico + bi_processos do escritorio para a mediana de dias por quadro/etapa; exibir "Casos como o seu nesta fase costumam avancar em ~N a M dias" como faixa (nunca data exata) com barra de progresso temporal (dias decorridos vs mediana). Recalculavel via cron diario. (consolida 3 variantes — a melhor e o RPC completo) (ansiedade: alto · tempo: alto · esforco: alto · auto: sim)
- **Mapeamento deterministico stages_id -> marco de jornada** — Coluna marco_jornada (0-4) em bot_stage_templates editavel no painel de Etapas; portal-data usa o valor canonico e cai no regex so como fallback. Base barata que aumenta a precisao de jornada, previsao e selo de ritmo de uma vez. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Selo de ritmo calculado de verdade (substituir heuristica)** — Calcular dias na fase atual (ultimo movimento que mudou stages_id, via bot_sync_state) vs mediana do escritorio (bi_funil_historico); exibir "Seu caso esta nesta fase ha N dias" e acender o selo de ritmo SOMENTE quando realmente abaixo da mediana. Honestidade gera autoridade. (ansiedade: medio · tempo: baixo · esforco: alto · auto: sim)
- **Retrospectiva "Seu caso em numeros"** — Agregar de bot_sync_state total de andamentos acompanhados, tarefas concluidas, publicacoes analisadas, horas dedicadas e dias sob vigilancia; opcao de PDF "Relatorio do seu caso" (jsPDF) para guardar/compartilhar. Comunica valor acumulado e justifica honorarios. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)

---

### 3. Documentos, comprovantes e pagamentos em autosservico
Deflexao pura de "me manda o recibo / a 2a via / a declaracao".

**Quick wins**
- **Banner de confirmacao de pagamento recebido** — Detectar parcela que virou pago nos ultimos N dias (payment_date recente) e exibir banner verde no topo de Pagamentos: "Recebemos seu pagamento de R$ X em DD/MM — esta tudo certo, voce nao precisa fazer nada"; some sozinho. 100% espelho Asaas, mata o "voces receberam meu boleto?". Variante "celebracao com micro-check" respeitando prefers-reduced-motion. (consolida 2 variantes) (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Recibo/comprovante por parcela paga (PDF no aparelho)** — Botao "Baixar comprovante" gerando recibo individual via jsPDF (logo, dados, valor, data, descricao, n. da cobranca Asaas); link direto para a NF quando houver nf_pdf_url. Autosservico puro do "me manda o recibo". (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)

**Alto impacto**
- **2a via / reemissao de boleto vencido em autosservico** — Para parcela vencida, botao "Gerar 2a via atualizada" chamando o Asaas ao vivo (a function ja tem ASAAS_API_KEY e busca pixQrCode) com novo vencimento e texto positivo ("Sem problema — aqui esta sua 2a via, pode pagar quando puder"). Regulariza sozinho, zero tarefa e zero constrangimento. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Pagina "Vamos resolver juntos" para o vencido** — Card sereno (nao cobranca seca) com 2a via, PIX atualizado copiavel e, se config permitir, escolher nova data de pagamento que grava intencao no banco e cria UMA nota no Kommo; converte cobranca em autosservico. (consolida 2 variantes) (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Confirmacao/atualizacao de dados cadastrais e bancarios** — Mini-formulario seguro (telefone, e-mail e, com acordo a repassar, chave PIX/banco/agencia/conta) que grava em tabela protegida e cria UMA nota no lead Kommo para conferir; validacao no front. Elimina a rodada de ligacoes para coletar conta e reduz erro de digitacao. (consolida 2 variantes) (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Declaracao de acompanhamento processual sob demanda** — Botao que gera no aparelho (jsPDF) uma declaracao com timbre CBC, nome, n. do processo, tipo de acao, fase e data (dados do payload); resolve usos informais (INSS, financiamento) e direciona ao WhatsApp para versao assinada formal. (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)
- **Aba "Documentos do seu caso"** — Lista de arquivos com download seguro (link assinado, nunca expondo o storage): comecar pelo que ja existe (contrato assinado ZapSign, comprovantes/NF Asaas) e crescer quando o espelho ADVBOX capturar peticoes/decisoes; selo em linguagem simples do que e cada peca. Deflexao forte de "me envia o documento". (consolida 2 variantes) (ansiedade: medio · tempo: alto · esforco: alto · auto: sim)

---

### 4. Acessibilidade e onboarding (adocao do publico leigo/idoso)
Reduzir a barreira de uso e a ligacao-de-socorro inicial.

**Quick wins**
- **Modo alto contraste** — Terceiro botao de acessibilidade ao lado de A+/A-, persistido em localStorage (padrao cbc_fonte), reforcando contraste de texto/bordas e tamanho de toque sem dark mode (so classe no html, sem dependencias). Quem nao enxerga bem usa sozinho. (consolida 2 variantes) (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Onboarding de primeira visita (tour leve)** — Overlay de 3-4 passos na primeira visita (flag localStorage tipo cbc_onboarded) em linguagem simples ("Aqui voce ve seu caso", "Aqui seus pagamentos", "Aqui tira duvidas sem ligar"), com dica de instalar o app/ativar avisos e opcao "Ouvir" reusando SpeechSynthesis. (consolida 3 variantes) (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **Deep-link de aba/secao por URL** — Suportar ?t=TOKEN&aba=pagamentos ou &foco=acordo (e hash #pagamentos vindo do push) que abre a aba certa e rola ate o card; habilita a equipe (e o bot) a responder "sua 2a via esta aqui: ...", transformando a pergunta numa visita autossuficiente. (consolida 2 variantes) (ansiedade: baixo · tempo: alto · esforco: baixo · auto: sim)

---

### 5. Compromissos e prazos (audiencia / pericia)
Dado ja detectado (portal_atividades.audiencia), uso hoje incompleto.

**Quick wins**
- **Contagem regressiva + lembrete .ics no compromisso** — No card de audiencia/pericia, "Faltam N dias" + botao "Adicionar ao calendario" reusando o gerador .ics/Google ja usado nas parcelas (VALARM 1 dia antes), com instrucoes claras ("compareca com documento; chegue 15 min antes"). Mata a ligacao de confirmacao de data e do "o que levar". (consolida 2 variantes) (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)

---

### 6. Fechar o loop da resposta (realtime) — push e estado
A resposta da equipe so aparece no proximo carregamento; o cliente reabre o portal ou liga "ja responderam?".

**Quick wins**
- **Push em tempo real quando a pergunta e respondida** — Reaproveitar a infra Web Push (portal_push_subs + VAPID + monitor): quando status muda para "Respondida" em portal_perguntas, trigger/scheduled dispara "Sua pergunta foi respondida — toque para ver"; idempotente por id da pergunta, com fallback Salesbot WhatsApp se sem push. (consolida 3 variantes) (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Estado "Pergunta sendo analisada" com SLA visivel** — No item Aguardando, "Recebida em DD/MM as HH:MM · Respondemos ate [proximo dia util]" usando o calendario forense ja existente (recessoOuFeriado); transparencia reduz reenvios e a ligacao de "recebeu minha pergunta?". (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)

**Alto impacto**
- **Rascunho automatico de resposta no admin (revisao humana)** — Ao abrir pergunta pendente, sugerir rascunho por match contra portal_faq + educacao da fase (e, se disponivel, Netlify AI Gateway para parafrasear no tom CBC); a equipe revisa e envia em 1 clique. Encurta a unica tarefa manual recorrente sem remover o canal humano. (ansiedade: baixo · tempo: alto · esforco: alto · auto: sim)

---

### 7. Contato humano de baixo atrito
Quando o cliente decide falar, que ele chegue identificado e com contexto.

**Quick wins**
- **Botao/FAB "Falar no WhatsApp" 1-clique contextualizado** — Botao persistente (numero do escritorio em bot_config, key portal_contato) que abre wa.me com mensagem pre-preenchida pelo payload: nome, ultimos 4 digitos do processo, fase atual e aba/link ("Ola, sou [nome], processo final [XXXX], queria falar sobre..."). Hoje so existe wa.me de indicacao/familia. Reduz o ping-pong e identifica o cliente no Kommo pelo telefone. (consolida 2 variantes) (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **"Ultimo contato humano" via leitura do Kommo** — Card discreto "Voce falou com nossa equipe em DD/MM" (getContact best-effort por telefone/CPF, cacheado no espelho) e "Nossa equipe ja esta com uma tarefa em andamento sobre seu caso"; degrada silenciosamente se o KOMMO_TOKEN nao tiver escopo. (ansiedade: medio · tempo: medio · esforco: alto · auto: sim)

---

### 8. Notificacao proativa por evento (push/WhatsApp/e-mail)
Converter o silencio em reasseguranca e celebrar os marcos positivos, sem rotina nova.

**Quick wins**
- **Push contextual por tipo de evento** — No loop de novidadesPush, classificar o title traduzido (glossaryTranslate) em 3-4 buckets ("Boa noticia no seu caso" p/ sentenca/acordo/exito; "Sua audiencia foi marcada"; "Andamento de rotina — nada a fazer"; "Atualizacao no seu caso") em vez do corpo generico unico; tudo derivado do glossario/templates. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Deep-link de notificacao para a secao exata** — Incluir hash de destino no payload do push (#pagamentos, #duvidas) para o SW abrir a aba certa e scrollar ao card, em vez de cair sempre na raiz; baixo custo, alto retorno de relevancia. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Onboarding push no primeiro acesso** — Quando acessos==1, bottom-sheet elegante explicando o portal em 3 frases com CTA unico "Quero ser avisado de novidades" que dispara o subscribe; aumenta drasticamente o opt-in do canal mais barato. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Re-prompt de push no momento de maior valor** — Para quem negou/ignorou (permission denied faz o card sumir para sempre), reexibir prompt contextual logo apos um evento de alto valor ("Quer ser avisado na hora da proxima novidade boa como esta?"), cap de 1 a cada 60 dias em localStorage. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Badge dinamico no icone do PWA** — navigator.setAppBadge no SW ao receber push e clearAppBadge ao abrir o portal, contando novidades nao vistas; reengajamento passivo de custo zero com degradacao graciosa onde nao houver suporte. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Push de confirmacao de pagamento (gatilho Asaas)** — No webhook PAYMENT_RECEIVED/CONFIRMED (ou diff do asaas-sync), identificar o token pelo CPF e disparar "Recebemos seu pagamento de R$ X — obrigado! Esta tudo em dia"; reusa o match nome/CPF do monitor. Deflexao direta de "voces receberam?". (ansiedade: alto · tempo: alto · esforco: medio · auto: sim)
- **Fallback inteligente: WhatsApp via Kommo quando sem push** — Para cliente com novidade SEM push_sub ativo mas COM linkKommo, enfileirar Salesbot run com a mesma mensagem contextual (so eventos relevantes, cap diario), reusando runSalesbot + leadMap; cobertura quase universal. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Lembrete proativo de audiencia em D-7/D-2/D-1** — Scheduled diaria varre atividades.audiencia e dispara push/WhatsApp ("Sua audiencia e em N dias — perto da data nossa equipe orienta voce, voce nao precisa fazer nada agora"); idempotente por (lawsuit, data, etapa_d). (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Notificacao de marco de jornada atingido** — Persistir o ultimo jornada_indice notificado por lawsuit; quando o monitor detecta que subiu, push "Seu caso avancou: agora esta na fase X". Raro = alto sinal, baixo ruido. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Notificacao de acordo "o valor caiu / esta a caminho"** — Scheduled diff detecta transicao de status do acordo (pendente->pago em portal_acordo) e dispara push/WhatsApp "Seu acordo foi finalizado — veja o valor liquido no portal" com deep-link; maior gatilho emocional positivo, hoje mudo. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Digest semanal "o que andou no seu caso"** — Scheduled (sexta de manha) monta, por token com push ativo, resumo curto de atividades (mov_mes/atv_mes/vez); mesmo "nada de novo" vira "seguimos vigiando — tudo sob controle". So dispara se nao houve push de movimento; cap 1/semana. (consolida 2 variantes) (ansiedade: alto · tempo: alto · esforco: medio · auto: sim)
- **Lembrete de parcela A VENCER em D-3 (preventivo)** — Scheduled diaria: boletos PF com due_date = hoje+3 disparam "Sua parcela de R$ X vence em 3 dias — toque para pagar agora"; idempotente por boleto, reduz vencidos na origem (menos regua) e e percebido como cuidado. (ansiedade: baixo · tempo: alto · esforco: medio · auto: sim)
- **Resgate de vencido como notificacao gentil (D+1)** — Quando a regua dispara D+1, alem da nota interna, push "Sua parcela venceu — tudo bem, aqui esta a 2a via e o PIX para resolver em 1 minuto" com deep-link para a parcela; converte cobranca em autosservico. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Aviso de fim de recesso/feriado forense** — Scheduled detecta a borda (recessoOuFeriado ja calcula as datas) e, no 1o dia util pos-recesso, dispara "O Judiciario voltou ao normal e ja estamos acompanhando seu caso de novo"; antecipa a onda de ligacoes. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Convite proativo de review Google no pico de satisfacao** — Quando o monitor/acordo detecta exito/repasse concluido para quem ja foi promotor (NPS>=9), UM push/WhatsApp "Que alegria essa conquista! Se puder, conte sua experiencia no Google" com review_url; cap rigido de 1 por cliente. (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **E-mail transacional como terceiro trilho** — Fallback de ultima instancia (Resend/SendGrid) para eventos de alto sinal (sentenca, audiencia, pagamento) usando o e-mail do cadastro ADVBOX, template ivory/navy/dourado; so dispara se nao houver push nem WhatsApp ativo. (ansiedade: medio · tempo: medio · esforco: alto · auto: sim)
- **Lembrete de calendario via Notification Triggers (offline)** — Para quem ativou push, agendar notificacao local via TimestampTrigger/showTrigger no SW para vesperas de vencimento/audiencia (aparelho avisa offline, infra zero); mantem o botao .ics onde a API nao existir. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Aviso de novo documento disponivel** — Preparar o gatilho desde ja: ao detectar novo anexo/PDF espelhado para um lawsuit, push "Um novo documento do seu caso esta disponivel" com deep-link; pluga a nova fonte quando o espelho de arquivos entrar. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)

---

### 9. Higiene, governanca e saude do canal de notificacao
Sustentam tudo da secao anterior; sem isso o canal apodrece ou vira spam.

**Quick wins**
- **Tarefa/nota automatica no Kommo para NPS detrator** — Em portal-feedback.mjs, ao receber nota <=6, criar tarefa no lead Kommo ("Cliente avaliou N — acompanhar", SLA 1 dia util) via createKommoTask com o comentario; transforma detrator em retencao sem nova rotina. (consolida 2 variantes) (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Healthcheck de entregabilidade de push** — Scheduled diaria verifica chaves VAPID presentes, % de subs 404/410 nas ultimas 24h e zero envios apesar de novidades; envia a uma subscription sentinela do escritorio e loga "aviso" no Monitor admin se falhar. Impede que o canal morra em silencio. (consolida 2 variantes) (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)

**Alto impacto**
- **Quiet hours / janela util para todo envio proativo** — Helper emJanela() que so libera push/WhatsApp entre 08h-20h dia util (America/Sao_Paulo); eventos fora da janela ficam em fila (coluna agendado_para) e saem no proximo slot. Aplicar a monitor, regua e reengajamento; parametrizavel em bot_config. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Frequency cap por cliente com agregacao** — Tabela notificacao_log (token, canal, enviado_em) com quota (ex.: 1 push/dia, 2/semana); ao exceder, AGREGAR ("Seu caso teve 3 novidades hoje — veja o resumo") em vez de varios pushes. Mantem o canal saudavel. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Dedup de notificacao entre canais** — Chave canonica (token+tipo+referencia) gravada em notificacao_log no envio em QUALQUER canal; todos os emissores consultam antes de disparar, garantindo 1 evento = 1 notificacao no melhor canal (push > WhatsApp > e-mail). (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Read-receipt loop: suprimir o que o cliente ja viu** — Registrar por token o maior event_date visto (beacon no boot do portal.html para endpoint leve) e, antes de notificar, nao enviar se event_date <= visto_ate; sincroniza notificacao com leitura real, nao so com a idade do dado. Mesma base alimenta o badge "Novo desde sua ultima visita" honesto. (consolida 2 variantes) (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Preferencias de notificacao no portal** — Mini-tela "Como voce quer ser avisado" com toggles por categoria (rotina / so importantes / pagamentos / audiencias) salvos em portal_pref_notif; monitor/regua respeitam. Reduz opt-out total e e percebido como respeito premium. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Toggle de canal por gatilho no painel admin (sem SQL)** — Switches por gatilho (push de andamento/pagamento, audiencia D-7/2/1, digest, reengajamento) gravando em bot_config key "notificacoes"; todas as functions leem essa config, destravando o rollout sem deploy nem SQL. (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Telemetria de deflexao (buscas/chips/FAQ)** — Beacon de eventos anonimos de autosservico (termo buscado, chip tocado, FAQ aberto, "isto resolveu?") em tabela leve + ranking admin "duvidas mais buscadas que NAO tem boa resposta"; vira backlog automatico de FAQ/educacao. (ansiedade: baixo · tempo: alto · esforco: medio · auto: sim)
- **Micro-feedback "isto te tranquilizou?" por card** — Botoes sim/nao discretos em cards-chave (educacao, previsao, reframe) gravando em portal_microfeedback com a chave do card; mede o objetivo #1 (aliviar ansiedade) por conteudo, sem questionario. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Painel de saude do engajamento de notificacoes** — Cruzar notificacao_log com ultimo_acesso pos-envio para estimar taxa de abertura por tipo de gatilho ("push de sentenca = 78% abrem em 2h; rotina = 12%"); insumo para silenciar gatilhos ineficazes sem achismo. (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)

---

### 10. Onboarding e reengajamento automatizado (gargalos de tempo do time)
Os maiores gargalos manuais restantes: gerar/enviar o link e recuperar quem sumiu.

**Alto impacto**
- **Reengajamento automatico de quem nunca acessou** — Scheduled semanal pega tokens com acessos=0 ha >3 dias (ou ultimo_acesso > 21 dias) com linkKommo e dispara UMA mensagem via Salesbot run ("Voce ja pode acompanhar seu caso sem precisar ligar — e so tocar no link"); cap de 1 reenvio gravado em tabela para idempotencia. (consolida 2 variantes) (ansiedade: alto · tempo: alto · esforco: medio · auto: sim)
- **Reengajamento de cliente lapso (ativo antes, sumiu 30+ dias)** — Scheduled mensal: tokens com ultimo_acesso entre 30-90 dias que tiveram novidade recebem 1 toque suave ("Faz um tempo que voce nao da uma olhada — seu caso teve novidades"); cap de 1 a cada 30 dias. Reativa habito de autosservico. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Cadencia de boas-vindas em 3 toques (2 semanas)** — Drip lendo criado_em do token: D+1 "seu portal esta pronto, veja sua jornada"; D+4 "sabia que da pra ouvir o resumo do seu caso?"; D+10 "ative os avisos e nunca mais precise ligar". Cada toque idempotente, via push ou Salesbot. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Geracao + envio automatico do link ao novo cliente** — Scheduled diaria detecta PF novos com CPF+processo (contratos.signed_at recentes ou bi_processos novos) sem token ativo, gera o token via portal-admin e dispara a mensagem de boas-vindas com o link via Salesbot run; liga/desliga por bot_config. Elimina o maior gargalo manual de onboarding. (ansiedade: baixo · tempo: alto · esforco: alto · auto: sim)
- **Indicacao com recompensa transparente (NPS 9-10)** — Para promotores (dado ja em portal_nps), card mais forte no agradecimento "Voce confia na CBC? Indique alguem que precisa" com mensagem WhatsApp pronta e marker/UTM opcional para a equipe acompanhar no Kommo; aproveita o pico de satisfacao. (ansiedade: nenhum · tempo: medio · esforco: baixo · auto: sim)

### Onboarding e primeira visita

> Lente reprocessada à parte (caiu por rate-limit na rodada principal). Alavanca descoberta: o backend já incrementa `tk.acessos` e grava `tk.ultimo_acesso` a cada visita — base perfeita para distinguir 1ª visita / retorno / re-onboarding. Hoje **não existe nenhuma UI de boas-vindas, prompt de instalação PWA, validação de confiança do link nem diferenciação de primeira visita**.

#### Quick wins

- **Cartão de boas-vindas só na 1ª visita** — Detectar `tk.acessos === 1` e exibir, acima do conteúdo, "Bem-vindo(a), {primeiro_nome}. Este é o seu portal seguro do CBC — acompanhe seu caso quando quiser." Some sozinho a partir da 2ª visita. (ansiedade: alto · tempo: medio · esforço: baixo · auto: sim)
- **Selo "Link oficial do CBC Advogados"** — Micro-selo com cadeado + OAB/SP 55227 + "Você recebeu este link pelo nosso WhatsApp" para validar a confiança de quem desconfia de link sem senha. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Explicação "Por que não tem senha?"** — Linha tocável que abre toast: "O link é único e pessoal, como uma chave só sua — por isso é seguro e não precisa decorar senha." Mata a objeção nº1 do leigo. (ansiedade: alto · tempo: medio · esforço: baixo · auto: sim)
- **Subtítulo "o que é isto" na estreia** — Frase de enquadramento na 1ª visita: "Seu painel particular — atualizado sozinho todos os dias úteis. Nada para preencher." (ansiedade: medio · tempo: medio · esforço: baixo · auto: sim)
- **Dica "salve este link" pós-carga** — Toast único: "Salve este link nos favoritos ou fixe na tela inicial — é seu acesso permanente." Evita o cliente perder o link e reabrir chamado no WhatsApp. (ansiedade: medio · tempo: alto · esforço: baixo · auto: sim)
- **Rótulo de aba mais explícito na estreia** — Na 1ª sessão, pulsar suavemente a aba "Meu caso" e mostrar "Toque aqui embaixo para ver Pagamentos e Dúvidas". (ansiedade: baixo · tempo: medio · esforço: baixo · auto: sim)
- **"Quem cuida do seu caso" na estreia** — Usar `responsavel` (já vem em `bi_processos`, hoje não exibido) para um card "Quem cuida do seu caso: Dr(a). {responsavel}" na primeira tela, criando vínculo humano imediato. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Re-boas-vindas para quem some** — Se `ultimo_acesso` > ~45 dias: "Que bom te ver de novo, {primeiro_nome}. Enquanto você esteve fora, cuidamos de tudo — veja o resumo abaixo." (ansiedade: alto · tempo: medio · esforço: baixo · auto: sim)
- **"O que mudou desde sua última visita"** — Comparar `ultimo_acesso` com as datas dos andamentos e marcar com selo dourado "novo" os eventos posteriores, para o retornante não reler tudo. (ansiedade: alto · tempo: alto · esforço: medio · auto: sim)
- **Primeira tela sem pedir nada** — Adiar NPS/push/indicação para a 2ª+ visita (checar `tk.acessos`), deixando a primeira impressão limpa e acolhedora. (ansiedade: medio · tempo: baixo · esforço: baixo · auto: sim)

#### Alto impacto

- **Tour leve de 3 passos opt-in** — Overlay suave (só 1ª visita, botão "Pular") com 3 balões: "situação do caso" → "pagamentos" → "dúvidas". Fecha sozinho e nunca reaparece (`localStorage`). (ansiedade: medio · tempo: alto · esforço: medio · auto: sim)
- **Resumo falado de boas-vindas (voz nativa)** — Reaproveitar o `speechSynthesis` já existente: "Ouvir um resumo do seu caso em 30 segundos" gera o texto dos dados — sem ninguém gravar áudio. Acolhe idoso e quem tem dificuldade de leitura. (ansiedade: alto · tempo: medio · esforço: baixo · auto: sim)
- **Banner de instalar como app (PWA) na hora certa** — Capturar `beforeinstallprompt` e, da 2ª visita em diante, "Tenha o CBC na tela inicial — abre com um toque"; no iOS, instruções ilustradas de "Compartilhar → Adicionar à Tela de Início". (ansiedade: medio · tempo: alto · esforço: medio · auto: sim)
- **Estado de estreia para caso recém-distribuído** — Sem andamentos ainda, em vez do vazio: "Seu caso acabou de entrar no nosso radar. A partir de agora, cada movimento aparece aqui sozinho — pode confiar." (ansiedade: alto · tempo: medio · esforço: baixo · auto: sim)
- **Primeiro acesso confirma entendimento, não pede dados** — Um único toque "Entendi, obrigado" registra (via `tk.acessos` ou POST leve) que o cliente leu, dando ao escritório sinal de leitura sem ligar para confirmar. (ansiedade: medio · tempo: alto · esforço: medio · auto: sim)
- **"Como ler esta tela" contextual nos números** — "?" tocáveis ao lado de "Tarefas concluídas", "Movimentações" e da jornada — onboarding just-in-time em vez de tudo de uma vez. (ansiedade: medio · tempo: medio · esforço: medio · auto: sim)
- **Expectativa de cadência logo na estreia** — "Este portal se atualiza sozinho todo dia útil — você não precisa voltar todo dia; a gente te avisa quando houver novidade." Reduz o recarregar ansioso. (ansiedade: alto · tempo: alto · esforço: baixo · auto: sim)
- **Onboarding adaptado por faixa de jornada** — Se entra já em "Reta final"/"Êxito" (`jornada >= 4`), o tom muda ("Você chegou na parte boa"); se entra no início, foca em paciência e monitoramento. (ansiedade: alto · tempo: medio · esforço: medio · auto: sim)
- **Prova social na 1ª tela** — Puxar `instituicao` (processos ativos / tarefas no ano / casos em êxito) para um card de credibilidade no topo — autoridade antes do cliente decidir se confia. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)

#### Estratégico / futuro

- **Detecção de "link encaminhado para a pessoa errada"** — Token nunca visto + nome não casa com nada salvo → "Não é você, {primeiro_nome}? Fale com o escritório". Protege privacidade no modo família. (ansiedade: medio · tempo: medio · esforço: alto · auto: sim)
- **Onboarding sazonal de recesso** — Se a estreia cai no recesso (`j.recesso`), o card explica "Você está chegando no recesso do Judiciário — é normal ficar quieto até {data}; seu caso segue monitorado." (ansiedade: alto · tempo: medio · esforço: baixo · auto: sim)
- **Splash de "primeira vez" com promessa do portal** — Aparece só uma vez antes do conteúdo: brasão CBC + "Tudo do seu processo, num só lugar. Sem senha, sem ligação, sem juridiquês." Revela o conteúdo com fade. (ansiedade: medio · tempo: medio · esforço: medio · auto: sim)
- **Re-onboarding após mudança de fase** — Se `jornada`/`fase` mudou desde o `ultimo_acesso`: "Novidade importante: seu caso avançou de {fase anterior} para {fase atual}". Transforma o retorno num momento de valor. (ansiedade: alto · tempo: alto · esforço: alto · auto: sim)
- **Checagem de saúde do link antes de assustar** — Diferenciar "link incompleto" (faltou parte do `?t=` ao copiar do WhatsApp) de "link expirado", com botão WhatsApp pré-preenchido "Meu link parece incompleto". (ansiedade: alto · tempo: alto · esforço: medio · auto: sim)
- **Acolhimento extra para idoso (letra grande)** — Na estreia, oferecer "Prefere a letra maior?" com um toque que já aciona o `A+` existente no nível máximo, persistido. (ansiedade: medio · tempo: medio · esforço: medio · auto: sim)
- **1ª visita sincronizada com Kommo/WhatsApp** — Assim que o cliente abre o link pela 1ª vez (`acessos: 1`), disparar via Kommo um WhatsApp "Vimos que você acessou seu portal — qualquer dúvida, responda aqui", fechando o loop sem esforço da equipe. (ansiedade: alto · tempo: alto · esforço: alto · auto: sim)


---

## Confianca, autoridade & inteligencia de dados

Este tema reune toda a inteligencia que ja existe no espelho ADVBOX/Asaas/Kommo e a transforma em alivio de ansiedade, prova de autoridade e tempo liberado para a equipe. Dividido em duas grandes frentes: **(A) Personalizacao e inteligencia de dados** (o que o cliente ve) e **(B) Metricas, feedback e melhoria continua** (como sabemos que esta funcionando e como o sistema se autocorrige). Tudo derivado de dados existentes, zero rotina manual nova.

---

### A. Personalizacao e inteligencia de dados (o que o cliente ve)

#### A.1 — Ancoras temporais & previsibilidade (o coracao do alivio de ansiedade)

**Quick wins**
- **Tempo nesta fase** — Derivar `entrou_na_fase_em` do `bi_processos_log` e exibir "Seu caso esta nesta fase ha N dias" no card de status. Da uma ancora concreta em vez de "aguardando". (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Saude de dados do proprio caso** — Mostrar por processo "Seu processo foi verificado hoje as HH:MM" a partir do `bot_sync_state` do `lawsuit_id` dele, substituindo o "Verificado hoje" global. Prova de vigilancia personalizada e muito mais convincente. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Contagem regressiva + .ics para audiencia/pericia** — No card "Compromisso marcado", adicionar "faltam N dias" e reaproveitar o botao .ics/Google Calendar ja usado em parcelas. Reuso de codigo, deflexao de "quando e mesmo minha audiencia?". (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)

**Alto impacto**
- **Previsao honesta da proxima janela de movimentacao** — A partir do intervalo mediano entre andamentos da fase atual (historico do escritorio), estimar uma JANELA ("a proxima novidade costuma chegar entre DD/MM e DD/MM"), nunca data unica, recalculada a cada visita e enquadrada como estimativa, nao prazo judicial. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Reframing inteligente do silencio** — Quando nao ha andamento ha mais que o intervalo mediano da fase, gerar automaticamente "Nesta fase, e tipico passar semanas sem movimentacao publica — seguimos vigiando todos os dias". Transforma o vazio em explicacao. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Estimativa de duracao TOTAL restante** — Somar as medianas das fases ainda nao concluidas (coorte por tipo de acao) para projetar uma faixa de horizonte total ("casos parecidos costumam levar mais X a Y meses a partir daqui"), sempre como faixa ampla com disclaimer. O maior alivio de ansiedade por resultado. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Comparativo de coorte honesto** — RPC `portal_coorte` que calcula mediana e p25-p75 de dias-na-fase dos casos do proprio escritorio que ja passaram por ela: "A maioria nesta fase leva entre X e Y dias; o seu esta em N (dentro do esperado)". Estatistico, sem promessa. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Linha do tempo PROJETADA dos proximos marcos** — Acrescentar marcos futuros esmaecidos ao stepper com estimativa de quando (mediana da coorte do mesmo tipo de acao), rotulados "estimativa, sujeita ao ritmo do tribunal". Transforma incerteza em mapa. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Termometro de progresso percentual** — Barra dourada fina sob o stepper: marcos concluidos + fracao do marco atual (dias na fase / mediana), com teto honesto de ~90% antes do exito. Da sensacao de avanco continuo mesmo em meses parados. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Score de previsibilidade como nivel de confianca** — Calcular confianca (alto/medio/baixo) pelo n da coorte e exibir junto das estimativas ("boa confianca, baseada em N casos parecidos"). Evita prometer onde os dados sao escassos. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)

#### A.2 — Autoridade honesta & selos calculados

- **Selo de ritmo CALCULADO** — Substituir a heuristica fixa `(jornada >= 1)`: so acender "avancando acima do ritmo medio" quando o caso REALMENTE estiver acima da mediana da coorte; caso contrario, omitir silenciosamente em vez de inflar. (ansiedade: medio · tempo: nenhum · esforco: medio · auto: sim)
- **Benchmark de exito por tipo de acao** — RPC que conta quantos casos do tipo do cliente (`exit_*` preenchido) ja chegaram ao desfecho: "Ja conduzimos N casos de [sua acao] ate o fim". Prova social sob medida, sem expor terceiros. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Card "Sua jornada conosco"** — "Ao seu lado ha N anos · M casos acompanhados", derivado de `signed_at`/`process_date`. Reforca pertencimento e autoridade. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

#### A.3 — Leitura inteligente dos andamentos & educacao

- **Deteccao de andamento RELEVANTE vs rotina** — Classificar cada `title` por palavras-chave (reuso `bot_glossary`/intents) em marco importante / movimentacao / expediente, destacando marcos com badge dourado e recolhendo rotina sob "movimentacoes de rotina (N)". (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **"O que mudou desde sua ultima visita"** — Comparar `ultimo_acesso` (salvo antes de atualizar) com `event_date` e marcar "Novo desde sua ultima visita" + resumo no topo. Substitui a heuristica fraca de "novidade <= 7 dias". (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Glossario contextual inteligente** — Estender o sublinhado a todas as abas (Acordo, FAQ, educacao) e priorizar os termos que de fato aparecem nos andamentos/fase DAQUELE cliente. Reuso do regex existente. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Educacao por TIPO DE ACAO, nao so por marco** — Permitir override de educacao por (tipo_acao x marco) com fallback ao texto generico; 1 conjunto por tipo recorrente, reaproveitado. Comunicacao muito mais pertinente. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Texto do "Ouvir resumo" enriquecido** — Injetar no TTS as frases ja calculadas ("ha N dias nesta fase, dentro do tipico"; "proxima movimentacao nas proximas semanas"). So concatenar dados ja no payload; mantem o recurso util para idosos. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)

#### A.4 — Inteligencia financeira (transmitir valor)

- **Oferta proativa de 2a via/renegociacao ao vencido** — Para parcela vencida, bloco acolhedor "Vimos que venceu — sem problema, aqui esta a 2a via (boleto/PIX); se precisar reorganizar, fale com a gente". Reusa `boleto_url`/PIX + CTA WhatsApp; deflexao da ligacao de cobranca. (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **Pontualidade como ativo de relacionamento** — Selo discreto e positivo "Voce esta 100% em dia — obrigado pela parceria" calculado de `payment_date` vs `due_date`. Puro reforco positivo; nunca expor quem atrasou. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Projecao do cronograma de quitacao** — "Faltam N parcelas · previsao de quitacao: mes/ano" + mini-projecao do saldo decrescente, derivado dos boletos Asaas. Da senso de fim e controle. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Distribuicao do acordo com mini-grafico** — Donut/barra empilhada em SVG inline da quebra do `portal_acordo` (recebido, honorarios, custas, liquido). Deflexao de "me explica esse calculo de novo". (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Resumo do exito ESPERADO (fees_expec/contingency)** — Em contratos de exito, faixa conservadora "estimativa de causa: ordem de R$ X (pleiteado, nao garantido)" com glossario e flag para ocultar quando nao convier. Concretude sem prometer resultado. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)

#### A.5 — Momentos de valor & sinais comportamentais

- **Deteccao de exito e celebracao automatica** — Quando `bi_processos_log` registrar transicao para exito/encerramento favoravel, disparar estado de celebracao ("Conquistamos uma etapa decisiva no seu caso") + push, direcionando para a aba Acordo. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Push positivo quando o caso ACELERA** — Quando uma transicao de quadro/etapa representar AVANCO de marco (jornadaIndice subiu), disparar push especifico "Seu caso avancou para a fase de Sentenca". Reforco de valor no momento certo. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Tom adaptado ao perfil de ansiedade** — Quando a frequencia de acesso for muito alta, exibir bloco extra-tranquilizador no topo ("Percebemos que voce acompanha de perto — otimo; nesta fase as novidades sao espacadas e nada exige acao sua") que nao aparece para esporadicos. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Contexto do ultimo contato humano via Kommo** — Se o `KOMMO_TOKEN` tiver escopo de events/notes, exibir "Seu ultimo contato com a equipe foi em DD/MM" no rodape do card de equipe. Humaniza; falha graciosamente sem escopo. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Insight de carteira multi-processo** — Linha de inteligencia no consolidado: "Seu caso mais proximo do desfecho: [tipo] (marco X) · mais recente: [tipo]". Ajuda o leigo a priorizar atencao sem ligar. (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)
- **Resumo anual "seu ano no caso"** — Card-retrospectiva sazonal (dez/jan): "Em 2026: N movimentacoes, M tarefas, avancou da fase A para B", somado do `bot_sync_state`/`bi_processos_log`. Reforco de valor anual sem producao manual. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)

> **Nota de overlap:** a ideia de "nota de risco silenciosa para a equipe" (indice de atencao por acesso anomalo + vencido + NPS + silencio, gerando tarefa Kommo) e a melhor versao do gancho comportamental — ela aparece consolidada como **"Indice de Ansiedade do Cliente"** na frente B.3, que cobre o mesmo sinal de forma mais completa.

---

### B. Metricas, feedback e melhoria continua (como sabemos que funciona)

#### B.1 — Fundacao de telemetria (pre-requisito de quase tudo abaixo)

- **Endpoint unico de telemetria (`portal-event`) com sendBeacon** — Function POST anonima validada por token que grava `{evento, aba, meta}` em `portal_eventos`; helper `track(ev,meta)` no front plugado nos handlers existentes (troca de aba, "Ver historico", "Ouvir resumo", "Copiar PIX", "Ver boleto", glossario). E a fundacao de TODA medicao desta lente. (ansiedade: baixo · tempo: alto · esforco: medio · auto: sim)
- **Beacon de erro/JS-crash** — `window.onerror` + captura de fetch falho enviando (sem PII) para `portal-event` evento=erro com stack curto; agregar "sessoes com erro nas ultimas 24h". Evita perder cliente em silencio quando o portal quebra. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Scroll-depth e tempo-na-aba** — IntersectionObserver + Page Visibility para capturar quais cards entraram na viewport e por quanto tempo, respondendo "a timeline e lida? a aba Acordo e vista?". Distingue quem leu de quem so abriu. (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)
- **Segmentacao por dispositivo/idade aproximada** — Capturar anonimamente SO, viewport, uso de A+/A- e TTS para responder "que % precisa de fonte grande / le por voz" e direcionar acessibilidade por evidencia. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Telemetria do "Ouvir resumo" (TTS) e A+/A-** — Plugar eventos no toggle do TTS e nos botoes de fonte para saber se o publico idoso usa esses recursos e justificar expandi-los com dado. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

#### B.2 — Prova de impacto (as duas constraints de ferro, em numeros)

**Alto impacto**
- **Funil de deflexao por cliente** — RPC `portal_deflexao` cruzando, por cliente, acessos ao portal x perguntas no "Pergunte aqui" x mensagens recebidas no Kommo, calculando a taxa de autosservico (abriu e NAO perguntou em 30 dias). A prova quantitativa da tese central do projeto. (ansiedade: nenhum · tempo: alto · esforco: medio · auto: sim)
- **Painel de FAQ nao coberto (mineracao de perguntas)** — Na rotina semanal, agregar perguntas de `portal_perguntas` por similaridade e avisar no Monitor "top 5 temas perguntados sem FAQ". Vira backlog automatico de FAQ que reduz perguntas futuras. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Deflexao financeira: extratos baixados e PIX copiados** — Plugar eventos nos botoes ja existentes e exibir "N extratos e N PIX copiados este mes = N pedidos manuais evitados". Quantifica diretamente o tempo liberado. (ansiedade: baixo · tempo: alto · esforco: baixo · auto: sim)
- **KPI consolidado "O portal cumpre seus objetivos?"** — Painel-resumo no admin: adocao, autosservico/deflexao, NPS e tendencia, downloads de 2a via, lembretes de calendario, horas economizadas estimadas. O north-star da diretoria, so de dados existentes. (ansiedade: baixo · tempo: alto · esforco: medio · auto: sim)
- **Relatorio mensal automatico a diretoria** — Cron mensal (padrao scheduled functions) que monta os KPIs do mes e posta no Monitor / envia por e-mail. A diretoria recebe a prova de valor passivamente. (ansiedade: nenhum · tempo: alto · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **Efeito do portal na inadimplencia** — RPC medindo, entre vencidos, a % paga DEPOIS de o cliente acessar Pagamentos / copiar PIX vs quem nao acessou (`asaas_boletos.payment_date` + `portal_eventos`). KPI financeiro de ROI. (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)
- **Eficacia do reframing** — Cruzar exibicao do "Resumo do mes"/aviso de recesso (evento) com ausencia de pergunta ansiosa nos 30 dias seguintes, provando se o reframing reduz "meu processo parou?". (ansiedade: alto · tempo: medio · esforco: alto · auto: sim)

#### B.3 — Adocao, retencao & reengajamento

- **Funil de ativacao do link (coorte)** — RPC `portal_ativacao_coorte` de `cliente_portal_tokens`: dos que receberam o link, quantos abriram em 24h, em 7 dias, e viraram recorrentes. Mostra onde o link "morre". (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)
- **Reengajamento automatico de quem "nunca acessou"** — Cron que, para tokens criados ha >=3 dias sem acesso, dispara um lembrete unico (nota Kommo/Salesbot, respeitando toggles). Fecha o loop metrica->acao, elimina o mutirao manual de reenvio. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Cohort de retencao mensal** — Curva de retencao por coorte (% que voltou no mes 2, 3...) de `cliente_portal_tokens` + `portal_acessos_diario`. Retencao alta = portal vira habito = menos contato. (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)
- **Taxa de instalacao PWA e opt-in de push** — Capturar `appinstalled` e o resultado do `subscribe` e exibir % de clientes que instalaram/ativaram avisos. KPI de profundidade de adocao, hoje invisivel. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Indice de Ansiedade do Cliente (Anxiety Score)** — Score por cliente em SQL (frequencia anormal de acessos, perguntas repetidas, NPS baixo, silencio longo + muitos acessos), materializado em `portal_ansiedade_score` pela rotina diaria; adapta a comunicacao no portal e lista "clientes ansiosos esta semana" + tarefa Kommo proativa. Antecipa a ligacao ansiosa sem garimpo manual. (ansiedade: alto · tempo: medio · esforco: alto · auto: sim)

#### B.4 — Loop de feedback -> acao (NPS, micro-feedback, SLA)

**Quick wins**
- **NPS detrator dispara tarefa no Kommo** — Em `portal-feedback.mjs`, quando nota <= 8, criar automaticamente tarefa/nota no lead ("avaliou com nota X — acompanhar") reusando `createKommoTask`. Transforma detrator passivo em acao de retencao. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Tempo ate a resposta + cumprimento do SLA** — De `criado_em`/`respondida_em` em `portal_perguntas`, RPC de mediana e % dentro do SLA, marcando perguntas estourando o prazo. Protege a promessa "respondemos em ate 1 dia util". (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Alerta de queda/tendencia de NPS** — Snapshot semanal em `portal_nps_historico` e comparacao com a semana anterior; se cair X pontos ou surgirem N detratores, avisar no Monitor. NPS passa de painel passivo a alerta. (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)
- **Comentario de NPS roteado ao Monitor com sentimento** — Classificar comentario por palavras-chave (elogio/critica/duvida) e, se acionavel, postar no Monitor com link para o cliente. Aproveita texto que o cliente ja escreve. (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)
- **Tagueamento de NPS por fase e tipo de acao** — Gravar junto a nota o marco da jornada e o tipo de acao (ja no payload), permitindo ver "clientes na fase de Citacao avaliam pior". Diagnostico preciso de onde a ansiedade aperta. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)

**Alto impacto**
- **Micro-feedback por secao ("Isso te ajudou?")** — Par de botoes joinha-cima/baixo nos cards-chave gravando em `portal_eventos` (evento=feedback_secao). Alimenta ranking no admin de quais textos educativos realmente reduzem duvida. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Feedback "ainda tenho duvida" apos a educacao da fase** — Botao ao final do accordion que grava o contexto (fase, tipo) e pre-abre o "Pergunte aqui". O admin ve em qual fase a educacao deixa mais gente com duvida. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **A/B de textos de educacao por fase** — Registrar versao/hash do texto junto ao micro-feedback + scroll-depth para comparar qual redacao teve mais joinha-cima e menos perguntas subsequentes. Melhoria data-driven sem produzir conteudo novo. (ansiedade: medio · tempo: medio · esforco: alto · auto: sim)
- **Deteccao de "cliente travado" para FAQ proativo** — Detectar padroes de confusao (entra/sai da mesma aba, abre o glossario muitas vezes no mesmo termo) e exibir contextualmente uma dica/FAQ na sessao + agregar "pontos de friccao" no admin. (ansiedade: medio · tempo: medio · esforco: alto · auto: sim)

#### B.5 — Confiabilidade & qualidade do dado

- **Health-check de entrega de Web Push** — Na rotina semanal, comparar assinaturas em `portal_push_subs` com pushes efetivamente entregues; se a taxa cair abaixo do limiar, avisar no Monitor. Garante que o canal de aviso nao morra em silencio. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Loop de qualidade da traducao de andamentos** — Na ingestao, marcar andamentos com alta densidade de termos juridicos NAO cobertos pelo glossario e agregar na rotina semanal "termos novos sem traducao". Backlog automatico para ampliar a clareza. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Indice de completude do payload por cliente** — Metrica de quantas secoes vieram preenchidas (contrato, boletos, acordo), agregada no admin para detectar clientes recebendo experiencia pobre por dado faltante. Mede a EXPERIENCIA entregue, nao so o cadastro. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)

### Confiança, autoridade e prova social

> Lente reprocessada à parte (caiu por rate-limit na rodada principal). **Nota ética importante:** todas as ideias evitam promessa de resultado e mercantilização. Itens com números agregados ("N processos ativos", "100% dos prazos") devem usar fraseado factual e descritivo, nunca comparativo-competitivo com outros escritórios, para respeitar o Provimento da OAB sobre publicidade.

#### Quick wins

- **Carimbo de "última verificação" com horário humano** — Em vez de "verificado há X dias", "Conferimos seu processo hoje às 9h14" usando o timestamp real da última checagem ADVBOX. Horário exato passa vigilância concreta, não promessa. (ansiedade: alto · tempo: baixo · esforço: baixo · auto: sim)
- **Tempo de casa do escritório** — Linha sóbria no rodapé: "Acompanhando causas em Americana e região desde [ano]". Autoridade sem mercantilização. (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **"Quem cuida do seu caso"** — Cartão com nome/foto (slot já existe) do(s) colaborador(es) que aparecem nos andamentos ADVBOX deste processo, com a função. Personaliza com dado real, zero esforço. (ansiedade: medio · tempo: baixo · esforço: baixo · auto: sim)
- **Contagem de andamentos só deste processo** — "Já registramos 23 movimentações no seu processo até aqui." Número crescente e específico, prova de trabalho contínuo. (ansiedade: alto · tempo: medio · esforço: baixo · auto: sim)
- **Selo de pagamento seguro (Asaas)** — Junto do boleto/PIX, micro-selo "Cobrança oficial via Asaas — instituição de pagamento autorizada". Reduz medo de golpe. (ansiedade: medio · tempo: medio · esforço: baixo · auto: sim)
- **Tradução de termos jurídicos inline** — Cada termo técnico do andamento ("conclusos", "saneador", "trânsito em julgado") com um "?" que abre explicação leiga de uma frase. Competência percebida + alívio. (ansiedade: alto · tempo: medio · esforço: medio · auto: sim)

#### Alto impacto

- **Linha do tempo do "trabalho invisível"** — Timeline dos andamentos ADVBOX já concluídos, com ênfase no que o escritório FEZ (petições protocoladas, prazos cumpridos), não no que falta. Torna visível o esforço que o cliente não vê. (ansiedade: alto · tempo: alto · esforço: medio · auto: sim)
- **Selo "prazo cumprido" por movimentação** — Em cada tarefa concluída antes do prazo, micro-etiqueta "Dentro do prazo" / "Adiantado em X dias". Prova de diligência item a item, não só agregada. (ansiedade: alto · tempo: medio · esforço: medio · auto: sim)
- **Painel de prestação de contas transparente** — Quando há acordo, exibir valores recebidos, repassados e honorários de forma clara e auditável. Transparência radical sobre dinheiro = confiança máxima. (ansiedade: alto · tempo: alto · esforço: medio · auto: sim)
- **Recibo automático de cada pagamento** — Ao quitar boleto/PIX (Asaas), o portal mostra "Pagamento recebido em DD/MM" com comprovante. Encerra a ansiedade do "será que caiu?". (ansiedade: alto · tempo: alto · esforço: medio · auto: sim)
- **Comparativo de ritmo por fase, ancorado em dado** — Além do contador mensal, "Nesta fase, processos costumam ter X andamentos; o seu já tem Y". Dedicação acima da média, factual. (ansiedade: medio · tempo: medio · esforço: medio · auto: sim)
- **Histórico de contato registrado** — Linha do tempo discreta de interações Kommo/WhatsApp ("Falamos com você em DD/MM"), provando que o escritório responde e não some. (ansiedade: alto · tempo: medio · esforço: medio · auto: sim)

#### Estratégico / futuro

- **Selo de integridade do dado** — "Informações sincronizadas diretamente do sistema oficial do escritório" com cadeado. Posiciona o portal como espelho fiel, não vitrine de marketing. (ansiedade: medio · tempo: baixo · esforço: medio · auto: sim)
- **Resumo "seu caso em 3 linhas"** — Bloco no topo que sintetiza fase + último andamento + próximo passo em linguagem leiga. Orientação imediata para o leigo/idoso ansioso. (ansiedade: alto · tempo: alto · esforço: alto · auto: parcial)
- **Marco de aniversário do caso** — "Estamos cuidando do seu processo há 1 ano e 3 meses" (da data de início). Reforça constância e relacionamento de longo prazo. (ansiedade: medio · tempo: baixo · esforço: baixo · auto: sim)
- **Página "como protegemos seus dados"** — Seção sóbria: dados vêm de sistemas oficiais, link é criptografado e individual, nada é compartilhado. Segurança percebida para público desconfiado. (ansiedade: medio · tempo: baixo · esforço: medio · auto: não)
- **Selo de pontualidade acumulada** — "100% dos prazos judiciais cumpridos em dia" calculado do histórico ADVBOX daquele cliente. Confiabilidade dura, baseada em fato. (ansiedade: alto · tempo: medio · esforço: medio · auto: sim)
- **Comprovação de protocolo** — Quando o ADVBOX registra protocolo de petição: "Petição protocolada em DD/MM — nº do protocolo". Prova documental do trabalho concreto. (ansiedade: alto · tempo: alto · esforço: medio · auto: sim)
- **Contato direto sem fricção** — Botão "Falar com quem cuida do meu caso" que abre WhatsApp via Kommo já identificando o cliente pelo token. Reduz ansiedade e libera tempo (chega contextualizado). (ansiedade: alto · tempo: medio · esforço: medio · auto: sim)
- **Selo OAB por colaborador** — Ao lado de cada advogado exibido, o número de inscrição na OAB. Autoridade formal e checável, sóbria, conforme ética. (ansiedade: baixo · tempo: baixo · esforço: baixo · auto: sim)
- **"Visto pela equipe" passivo** — Andamento novo entra → marca discreta "Analisado pela equipe em DD/MM" derivada de a tarefa ADVBOX correspondente ter sido tratada. Mostra que nada passa batido. (ansiedade: alto · tempo: medio · esforço: alto · auto: parcial)


---

## Design, estetica & microinteracoes

O tema reune o acabamento visual de "papelaria juridica premium" e a camada de movimento que transforma dado bruto (ADVBOX/Asaas/Kommo) em deleite e alivio. Tudo abaixo e automatizavel a partir dos dados ja existentes e zero esforco recorrente da equipe. As microinteracoes de maior peso comparam o payload atual com um snapshot em `localStorage` para mostrar ao cliente, sem nenhuma acao do time, **o que mudou desde a ultima visita** — o coracao do alivio de ansiedade.

### 1. Sistema de design (tokens & consistencia)

Refactors de base que fazem todas as outras microinteracoes "falarem o mesmo idioma" e parecerem de um design system maduro.

**Quick wins**
- **Tokens de motion unificados** — criar `--ease-out`, `--ease-spring`, `--dur-fast/med/slow` no `:root` e refatorar as ~15 transitions/animations soltas (.12s/.15s/.18s/.2s/.25s) para usa-los; base que padroniza ritmo e facilita o reduced-motion global. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Consistencia de raio de borda** — mapear raios orfaos (10px no nps-n, 11px no .nao, 6px no quadro-tag) para os tokens `--r`/`--r-sub`/`--r-in` ou adicionar `--r-pill`/`--r-chip`; coerencia de cantos sinaliza maturidade premium. (ansiedade: nenhum · tempo: nenhum · esforco: baixo · auto: sim)
- **Hierarquia de sombra em camadas** — trocar o `--shadow` unico por 3 niveis (`--elev-1` cards normais, `--elev-2` status/destaque, `--elev-3` nav/toast) com tom navy; aplicar `--elev-2` ao `.fase-card` e `.ac-destaque` para o card principal flutuar. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Numeros em lining/tabular figures** — carregar Cormorant com `font-feature-settings 'lnum' 1,'tnum' 1` (ou variante SC) nos grandes valores R$, alinhando-os como um extrato bancario premium. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **Escala tipografica modular** — substituir os tamanhos orfaos derivados de px (0.65625rem, 0.71875rem, etc.) por variaveis `--fs-3xs..--fs-3xl` (razao ~1.16); padroniza ritmo vertical e faz o A+/A- escalar tudo proporcionalmente. (ansiedade: nenhum · tempo: nenhum · esforco: medio · auto: sim)
- **Ritmo vertical via tokens de spacing** — definir escala `--sp-1..--sp-8` (4/8/12/16/24/32/40/48) e substituir margens soltas (14px, 12px, 26px...), dando cadencia editorial e reduzindo o aspecto "colado" de alguns blocos. (ansiedade: nenhum · tempo: nenhum · esforco: medio · auto: sim)

### 2. Identidade visual & textura "papel timbrado"

Acabamentos que reforcam o codigo de cartorio/papelaria juridica sem poluir o texto nem custar dado.

**Quick wins**
- **Capitular dourada no nome da saudacao** — renderizar a primeira letra do primeiro nome como drop cap Cormorant ~2.6rem dourada (so quando nome >=3 letras), reforcando o monograma. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Hierarquia de peso no h1 da saudacao** — saudacao temporal em peso 500/ink-soft e o NOME em 600 ink/dourado, criando o ponto onde o olho pousa; personalizacao = acolhimento. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Marca d'agua de monograma CBC no card de status** — SVG do monograma em outline dourado a ~4% no canto inferior do `.fase-card`, abaixo do conteudo via z-index; profundidade de papel timbrado, zero dado. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Textura de papel (grao) sobre o ivory** — sobrepor noise SVG feTurbulence a ~2-3% (multiply) ao fundo de pontos, dando tatilidade de papel de cartorio em telas grandes; 100% CSS, sem requests. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **CNJ formatado com mascara tabular** — aplicar a mascara oficial NNNNNNN-DD.AAAA.J.TR.OOOO em JS e renderizar em fonte tabular com segmentos em cor sutil (ink vs ink-faint), virando um "numero de matricula" elegante que transmite oficialidade. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Botao primario navy polido** — gradiente vertical sutil (#1B3A5C->#0F2035), borda interna clara (inset highlight) e estado :hover com sombra navy, alinhando ao acabamento do card de Acordo. (ansiedade: nenhum · tempo: nenhum · esforco: baixo · auto: sim)
- **Divisores com ornamento central (fleuron)** — nas transicoes de secao mais importantes, usar um pequeno losango/fleuron dourado entre dois filetes — marcador classico de papelaria juridica. (ansiedade: nenhum · tempo: nenhum · esforco: baixo · auto: sim)

**Alto impacto**
- **Estados vazios ilustrados com line-art dourado** — desenhar 3-4 SVGs (documento lacrado, balanca, cofre) coerentes com os icones do nav acima de "Tudo em dia"/"Processo sendo preparado"/"Nenhum acordo ativo"; eleva o cuidado percebido em telas que o cliente ansioso ve muito. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Selo de cera/lacre no Acordo concluido** — quando `concluido===true`, sobrepor um selo SVG circular estilo lacre dourado (com "CBC" e leve rotacao) ao canto do `.ac-destaque`, reforcando "fechado, oficial, garantido" no auge emocional. (ansiedade: medio · tempo: nenhum · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **Duotone navy coeso nas fotos da equipe** — trocar o filtro atual (grayscale+sepia+hue-rotate) por um duotone real via SVG `feColorMatrix` (sombras->navy, luzes->ivory/dourado), garantindo o mesmo tom editorial independente da foto-fonte. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Tema iconografico por tipo de acao** — derivar de `p.tipo` um glifo de marca-d'agua diferente por familia (trabalhista, civel, previdenciario, consumidor), mesma paleta, com fallback neutro; personalidade sem fragmentar a identidade. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Transicao de cor do header por periodo do dia** — acompanhar a saudacao (manha/tarde/noite) com variacao quase imperceptivel na textura de pontos ou no tom do selo CBC (transition longa), sem dark mode (so estados diurnos). (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Header com condensacao ao rolar** — encolher o selo CBC e fixar uma mini-barra sticky (monograma + primeiro nome) ao descer, liberando area e ancorando a marca; IntersectionObserver + CSS sticky, sem parallax em reduced-motion. (ansiedade: baixo · tempo: nenhum · esforco: alto · auto: sim)

### 3. Card de status, jornada & "de quem e a vez"

O nucleo do alivio: o cliente abre o portal sobretudo para ver "como esta meu caso".

**Quick wins**
- **Faixa lateral com gradiente de status** — a barra de 4px do `.fase-card` passa a refletir `statusHumano`: dourada na novidade/reta final, verde-oliva (`var(--ok)`) quando "tudo caminhando bem"; o olho le a cor antes do texto. (ansiedade: medio · tempo: nenhum · esforco: baixo · auto: sim)
- **Pill "de quem e a vez" com icone e micro-animacao** — adicionar icone (pessoas/predio-balanca) aos chips `.vez` e um micro-pulso dourado discreto no estado "com a nossa equipe agora", comunicando quem age sem ler. (ansiedade: medio · tempo: nenhum · esforco: baixo · auto: sim)
- **Botao "Ouvir resumo" como acao primaria sutil** — tira-lo da disputa visual na linha `.fase-acoes`: chip dourado outline com icone de onda, abaixo do status, label "Ouvir resumo do meu caso"; melhora descoberta (essencial para idosos). (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Respiracao sutil no card quando esta tudo calmo** — em estado verde ("Sob vigilancia diaria"/"Tudo caminhando bem"), aplicar respiracao discreta (scale 1->1.03->1, 4s) na faixa dourada ou no check; transmite "sistema vivo, cuidando". (ansiedade: alto · tempo: nenhum · esforco: baixo · auto: sim)
- **Barra de progresso da jornada animando do valor antigo ao novo** — guardar `p.jornada` por token; se o marco avancou, preencher os pontos "done" em sequencia (120ms cada) e a linha conectora crescendo de scaleX(0)->1. O cliente literalmente VE seu processo avancar entre visitas. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Contagem regressiva animada para audiencia/pericia** — no card "Compromisso marcado", anel SVG de progresso (dias vs janela 90d) com count-up reverso na 1a pintura e pulso suave quando faltam <=7 dias; reusa count-up e pulse existentes. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Barra continua + aura no marco atual do stepper** — fina barra de progresso sob o track preenchida ate a fracao exata entre marcos (ex.: 62% rumo ao proximo) e gradiente radial dourado atras do `j-dot` atual; sensacao de movimento e proximidade do exito. (ansiedade: medio · tempo: nenhum · esforco: medio · auto: sim)
- **Selo "avancando acima do ritmo medio" celebratorio** — quando `p.rapidez` e verdadeiro, faze-lo entrar com shimmer dourado percorrendo o texto uma vez + leve scale spring, marcado como visto para nao repetir; valoriza autoridade no momento certo. (ansiedade: medio · tempo: nenhum · esforco: baixo · auto: sim)

### 4. Timeline (linha do tempo do caso)

Transformar a lista cronologica plana numa "historia se desenrolando".

**Quick wins**
- **Primeiro evento como mini-card destacado** — o evento mais recente vira mini-card fundo gold-faint com label "mais recente" e ponto maior, para saltar aos olhos de quem abre so para ver "o que mudou"; os demais seguem minimalistas. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Linha da timeline que se desenha ao entrar** — animar o traco vertical dourado (mask/clip-path crescendo top->bottom em ~600ms) quando a aba Meu Caso pinta, com cada ponto fazendo um pop 80ms apos a linha alcanca-lo; "historia sendo contada". (ansiedade: medio · tempo: nenhum · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Agrupamento por mes (cabecalhos serif)** — quando o mes/ano muda entre eventos, inserir mini-cabecalho ("Junho 2026" em Cormorant italico, ink-faint) a esquerda da linha; estrutura editorial que quebra a parede de texto em historicos longos. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Transicao FLIP ao expandir/recolher** — ao abrir "Ver historico completo", medir altura antes/depois e animar `height` (.35s ease) para os eventos extras deslizarem em vez de pular, com os novos entrando no stagger `.entra`. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Reveal sequencial em cascata** — animar cada `.evento` com reveal escalonado proprio (translateY+fade, ~40ms entre eventos, teto baixo) quando a aba pinta, e so os novos ao expandir; reaproveita o padrao de stagger. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)

### 5. Pagamentos & financeiro (Asaas)

O dado mais emocional alem do status: quanto falta, quanto ja pagou, o que entrou.

**Quick wins**
- **Cards de resumo com tratamento de "cartao" tonal** — fundo tonal suave (ok-bg ~40% no Ja pago, warn-bg ~40% no Em aberto) e pequeno icone duotone no canto, diferenciando visualmente os dois cards brancos identicos. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Cor graduada por proximidade do vencimento** — terceiro estado "vence em breve" (<=3 dias): pill ambar suave entre gold-faint e warn-bg com micro-texto "vence em N dias", calculado de `b.vencimento`; hierarquia de urgencia sem alarmar. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Barra de honorarios que preenche animada ao entrar** — animar a largura do `.barra i` de 0% ate o % quitado (.9s cubic-bezier) quando o card "Seu contrato" entra no viewport, sincronizado ao count-up do valor pago. (ansiedade: medio · tempo: nenhum · esforco: baixo · auto: sim)
- **Rolagem de digito na badge de pendencias** — quando a contagem muda entre visitas (ex.: 2->1 porque pagou), roll vertical do digito (~300ms) e, se zerou, scale-out + micro-check; progresso financeiro deleitoso a partir do diff. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Count-up nos valores financeiros (R$)** — estender a engine countUp (hoje so inteiros de "Nossa equipe em acao") aos valores BRL de pagamentos.resumo (Ja pago / Em aberto) e ao "Valor liquido para voce" do Acordo, com formatter monetario por frame; da cerimonia ao numero que mais importa. (ansiedade: medio · tempo: nenhum · esforco: baixo · auto: sim) — *consolida duas sugestoes quase identicas (lentes visual e motion); usar a versao motion que reusa a engine existente.*
- **Carimbo "pagamento confirmado" quando o Asaas confirma** — comparar status pendente->pago vs snapshot `cbc_payload`; tocar UMA animacao de selo (circulo navy scale-in spring + check desenhado por stroke-dashoffset + leve "thud"), marcada em localStorage para nunca repetir; transforma o dado do webhook em deleite de alivio, 100% automatico. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **"Tudo em dia" celebratorio ao zerar pendencias** — quando `pagamentos.pendentes` fica vazio E havia pendencias antes (diff de snapshot), o estado vazio entra com check grande desenhado por stroke + frase em fade-up + brilho dourado que desvanece; momento de fechamento positivo. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)

**Estrategico / futuro**
- **PDF do extrato com progresso real por etapa** — substituir o loading generico do botao (jsPDF via CDN) por barra/anel com micro-labels ("Carregando.../Montando seu extrato.../Pronto") e, ao concluir, check verde + confete dourado discreto (3-4 particulas); reduz ansiedade de espera. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)

### 6. Acordo (aba de maior valor emocional)

**Alto impacto**
- **Waterfall da distribuicao do acordo** — em "Como o valor se distribui", animar cada linha (recebido − honorarios − custas ± ajustes = liquido) em stagger, com barra horizontal proporcional preenchendo da direita, culminando no count-up do "Valor liquido para voce"; torna transparente como se chega ao numero do bolso do cliente. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)

### 7. Navegacao, abas & orientacao (leigos/idosos)

**Quick wins**
- **Feedback tatil (haptics) em acoes-chave** — `navigator.vibrate` curto (8-15ms) ao copiar PIX, selecionar NPS, confirmar pergunta e no carimbo de pagamento; fallback visual no iOS; camada sensorial de "aconteceu" que tira a duvida do leigo. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Transicao A+/A- suave** — animar `font-size` raiz (.25s ease) entre os degraus 100/112.5/125% em vez de salto, dando feedback claro de que mudou (importante para idosos); reduced-motion cai para instantaneo. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Transicao de aba direcional (slide)** — trocar o crossfade simples por slide horizontal curto (translateX ±12px conforme a aba destino esta a direita/esquerda na nav) + fade, dando modelo mental espacial; reduced-motion cai pro fade atual. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Pulso na aba que tem novidade (nav-dot)** — ponto dourado pulsante no icone da aba inativa com conteudo novo desde a ultima visita (resposta na Duvidas, movimentacao no Caso), que some ao visitar; guia ate a novidade sem texto, via diff de snapshot. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Nav inferior com indicador deslizante (pill)** — pseudo-elemento navy que desliza (translateX, spring) ate o botao ativo ao trocar de aba, em vez de aparecer/sumir; microinteracao de app nativo polido, fallback instantaneo em reduced-motion. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Onboarding-coachmark na 1a visita** — sequencia leve de 2-3 coachmarks com halo pulsante percorrendo a bottom-nav e legenda curta ("Aqui voce ve seu caso / pagamentos / tira duvidas"), fade+translate, sem modal; resolve a lacuna de onboarding com texto fixo. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)

### 8. "O que mudou desde sua ultima visita" (diff de snapshot)

O mecanismo transversal de maior retorno: compara o payload atual com `cbc_payload` em localStorage e da visibilidade ao novo, sem nenhum trabalho da equipe.

**Alto impacto**
- **Highlight "novo desde sua ultima visita" com glow que desvanece** — eventos e cards novos desde o ultimo acesso recebem realce dourado temporario (box-shadow/background gold-faint em fade-out ~2.5s) + micro-selo "novo" com badgeIn; resolve a lacuna "sem indicacao de visto" do lado do cliente. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Transicao de resposta da pergunta (Aguardando -> Respondida)** — quando o status de `minhas_perguntas` muda no diff, morph/crossfade do pill (warn->ok) e o bloco `.pq-resposta` expandindo via height com glow dourado momentaneo; torna a chegada da resposta um momento visivel sem depender de refresh manual. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Transicao offline->online** — ao reconectar e o fetch suceder, deslizar o banner offline para cima, dar um pop de re-confirmacao no badge "Verificado hoje" e aplicar o glow "novo" nos dados que mudaram; comunica "voltamos a te monitorar ao vivo". (ansiedade: medio · tempo: nenhum · esforco: medio · auto: sim)

### 9. Formularios & compartilhamento (Duvidas, Indicar, Modo familia)

**Quick wins**
- **Microfeedback de "link copiado/compartilhado"** — nos botoes de `navigator.share`/wa.me, reusar a linguagem do PIX copiado: morph para check verde com "Link pronto para enviar" por ~3s; confirma ao leigo que funcionou, sobretudo no fallback wa.me que abre outro app. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Microanimacao de "enviado" no Pergunte aqui** — o botao colapsa para circulo com spinner navy, vira check verde (stroke-draw) e expande para "Enviado"; a nova pergunta entra na lista deslizando no stagger; confirma sem duvida que a pergunta chegou. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **Glossario como popover ancorado ao termo** — trocar/complementar o toast de 7s por popover ancorado a palavra (fade+translateY 4px, seta apontando, sublinhado pontilhado->solido no toque); deixa claro para leigos a qual palavra a definicao pertence. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)

### 10. Carrossel multi-caso (carteira)

**Quick wins**
- **Affordance de swipe na 1a visita** — se houver >1 caso, na primeira visita o carrossel da um "peek" animado (desliza ~24px e volta, ease-out 500ms) e os dots pulsam uma vez, comunicando a leigos/idosos que da pra arrastar; respeita reduced-motion. (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **Coverflow: card central com elevacao, vizinhos com escala/saturacao reduzida** — estender o rAF de sync de dots ja existente para escalar o card central (1.0 vs .96) e dessaturar os laterais conforme o scroll-snap; foco visual claro de qual caso esta ativo. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim) — *consolida duas sugestoes quase identicas (lentes visual e motion); manter a versao motion que reusa o handler de scroll existente.*

### 11. Feedback do sistema, loading & acessibilidade

**Quick wins**
- **Toast com icone contextual e barra de tempo** — diferenciar o toast navy unico: icone a esquerda (check verde sucesso, info dourado glossario, alerta erro) e fina barra dourada que esvazia indicando o tempo restante (util no glossario de 7s). (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)

**Alto impacto**
- **Contraste AA garantido no ink-faint** — escurecer `--ink-faint` ~1 passo (ex.: #4E6076) e nunca usa-lo abaixo de 0.75rem para texto informativo; mantem a suavidade mas garante legibilidade ao sol e para idosos. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Skeletons fieis a forma do conteudo** — modelar os skeletons na anatomia real (card de status com faixa lateral + titulo largo + 3 linhas; stepper de 5 pontos; dois quadrados de pagamento) reusando o shimmer existente; reduz o layout shift percebido quando os dados chegam. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim) — *consolida duas sugestoes identicas (lentes visual e motion).*

**Estrategico / futuro**
- **Reveal on view para secoes longas** — usar IntersectionObserver para que blocos abaixo da dobra so animem `.entra` ao entrar no viewport, em vez de desperdicarem a animacao fora de tela; mantem o frescor do movimento ao rolar. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Visualizador (equalizer) no "Ouvir resumo"** — micro-onda de 3-4 barrinhas oscilando por CSS enquanto o SpeechSynthesis fala (param no onend) e highlight rolante por frase via evento `boundary`; reforca para idosos/leigos que o portal esta "lendo pra eles". (ansiedade: medio · tempo: nenhum · esforco: medio · auto: sim)
- **Pull-to-refresh com selo CBC girando** — ao puxar no topo (PWA mobile), revelar o selo circular que gira proporcional ao arrasto e, ao soltar, completa um giro suave enquanto refaz o fetch; da controle ao cliente ansioso com deleite de marca, sem botao feio; giro desligado em reduced-motion. (ansiedade: medio · tempo: baixo · esforco: alto · auto: sim)

---

## Acessibilidade, mobile & robustez

Curadoria de 65 sugestoes brutas (3 pares quase identicos fundidos) em 63 ideias, organizadas por sub-tema. Cada item traz selo de impacto, esforco e automacao. Foco do tema: garantir que o cliente leigo, idoso, em celular fraco ou rede ruim NUNCA veja uma tela quebrada, vazia sem explicacao, ou um conteudo que ele nao consegue ler/tocar — e que nada disso crie rotina manual para a equipe.

### 1. Contraste, cor e legibilidade

**Quick wins**
- **Corrigir tokens que reprovam no WCAG AA** — `--ink-faint` (#5A6D82) em legendas e `--gold` (#B99249) usado como TEXTO ficam abaixo de 4.5:1; escurecer apenas onde a cor e texto pequeno, mantendo o dourado claro so em bordas/icones. Preserva a identidade e ajuda idosos. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Cor nunca como unico sinal (status/pills/dots)** — chips `.vez`, `dotc` de status e pills de pagamento (pago/pendente/vencido) diferenciam so por cor; adicionar icone/forma (check, relogio, alerta) para daltonicos e baixa visao. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Contraste e leitura do destaque navy do acordo** — `.ac-destaque` (gradiente navy + branco) e o valor liquido precisam ser inequivocos: adicionar `aria-label` ('Valor liquido para voce: R$ X'), garantir AAA do branco e versao solida sem gradiente no modo alto contraste. (ansiedade: alto · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Modo de alto contraste opcional (toggle AAA)** — terceiro botao ao lado do A+/A- que ativa `.alto-contraste` (persistido em localStorage), reforcando ivory/navy ate WCAG AAA. Sem dark mode. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Respeitar prefers-contrast e forced-colors do SO** — `@media (prefers-contrast: more)` e suporte a forced-colors (alto contraste do Windows/celular) reforcando bordas e corrigindo `forced-color-adjust` nos botoes navy. Detecta a preferencia do aparelho sozinho. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)

### 2. Leitor de tela, teclado e estrutura ARIA

**Quick wins**
- **Anunciar troca de aba (live region)** — `aria-live=polite` oculta que anuncia o nome da aba aberta a cada troca de `#conteudo` ('Pagamentos, 2 parcelas em aberto'), reusando contadores ja calculados. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Skip link 'Ir para o conteudo' e landmarks completos** — `<a href=#conteudo>` visivel ao focar, regioes com role/aria-label e `<h2>` oculto por aba para headings navegaveis. Puro HTML/CSS. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Botoes de pagamento com aria-label completo** — 'Copiar PIX'/'Ver boleto'/'Adicionar lembrete' repetem identicos; gerar rotulo unico por parcela ('Copiar PIX da parcela de R$ X com vencimento DD/MM') usando dados de `pagamentos.pendentes`. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Feedback de 'PIX copiado' anunciado por SR** — texto explicito no toast role=status ('Codigo PIX da parcela de R$ X copiado, cole no app do banco') e aria-label dinamico no botao. Tranquiliza que da para pagar. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Badge de pendencias com texto, nao so numero** — `badge-pend` vira 'Pagamentos 2' ambiguo para o SR; dar `aria-label` '2 parcelas em aberto' e esconder o numero puro com aria-hidden. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Foco e leitura ao expandir 'Ver historico completo'** — adicionar `aria-expanded`/`aria-controls` ao botao ver-mais e, ao expandir, focar o 1o evento novo ou anunciar 'N movimentacoes a mais exibidas'. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Acordeoes de educacao com semantica consistente** — nos `<details>/<summary>` por fase, refletir estado com texto oculto 'expandir/recolher' e garantir foco no summary ao fechar; mantem o visual do '+'. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Resumo textual da jornada (stepper) para SR** — texto sr-only/aria-label no `j-track` ('Etapa 3 de 5: Citacao concluida, fase atual Sentenca') + `aria-current=step`, derivado de `p.jornada`. Comunica avanco a quem nao ve a barra. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Documentar idioma e abreviacoes (lang/abbr)** — envolver CNJ, 'OAB/SP', 'PIX', 'CPC art.220' em `<abbr title>` e soletrar o numero do processo em blocos para conferencia, evitando leitura errada pelo TTS/SR. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Imagens da equipe com alt individualizado** — trocar o alt generico 'Integrante da equipe CBC' por `{nome, papel}` ('Dra. Fulana, advogada responsavel'), estendendo o schema de `portal_equipe` em bot_config. Soma autoridade + a11y. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Contadores animados quietos para SR/reduced-motion** — marcar `[data-count]` com aria-hidden durante a contagem e expor o valor final num irmao sr-only estavel (ou pintar direto quando ha SR/redux), evitando releituras que distraem. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Tabs reais (role=tablist/tab/tabpanel) com foco gerenciado** — converter a barra inferior de `aria-pressed` para padrao ARIA Tabs: tabs com `aria-controls`, navegacao por setas e foco movido ao painel (tabindex=-1 + focus) na troca. Tudo client-side. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Carrossel de casos navegavel por teclado** — `aria-roledescription='carrossel de casos'`, botoes 'caso anterior/proximo' visiveis (ajudam tambem quem tem dificuldade motora de arrastar) e Tab/setas centralizando o caso. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **NPS como radiogroup teclavel com setas** — roving tabindex entre as 11 notas, `aria-checked` e rotulos com significado ('Nota 0 de 10, nada satisfeito' ... 'Nota 10, totalmente satisfeito'). Inclui teclado/SR na pesquisa. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Ordem de DOM coerente entre conteudo e servicos** — push/familia/nps/indicar estao no DOM apos o `<footer>` mas exibidos por display conforme a aba; reordenar para que a leitura siga a ordem visual (conteudo, servicos, rodape) com landmarks. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Teste automatizado de a11y no deploy (axe-core headless)** — passo Node com axe-core + Playwright apontando para portal.html com token de teste, falhando o deploy dev em violacoes serias/criticas. Roda sozinho, protege a a11y ao longo do tempo. (ansiedade: nenhum · tempo: medio · esforco: medio · auto: sim)

### 3. Leitura em voz (TTS) e linguagem simples

**Alto impacto**
- **Estender 'Ouvir resumo' a todas as abas E estados vazios** — hoje o TTS so existe e so le 'Meu caso' ativo; generalizar para um botao 'Ouvir' por aba (pagamentos, acordo) que monta o texto do conteudo ja renderizado, e tambem narrar estados especiais ('Seu processo esta sendo preparado, voce nao precisa fazer nada agora'). Reaproveita SpeechSynthesis. *(funde duas sugestoes equivalentes de TTS)* (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Glossario tambem nas abas Acordo, Duvidas e card de fase** — `marcaTermos` so roda na timeline de 'Meu caso'; aplicar a mesma marcacao (reusando `state.dados.glossario`) em 'Como o valor se distribui', no FAQ e no texto da fase. Reduz ansiedade do leigo no portal todo. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Linguagem simples auditada nos textos automaticos** — camada que, para cada termo tecnico em texto fixo ('distribuido', 'cumprimento de sentenca'), oferece versao leiga entre parenteses, controlada por tabela em bot_config (mesmo padrao do glossario, editavel sem deploy). Beneficia baixa escolaridade. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)

**Quick wins / refinamentos**
- **Controles de velocidade/pausa na leitura** — mini-botoes mais devagar/mais rapido (rate 0.7-1.1 persistido) e `speechSynthesis.pause()/resume()`, com destaque visual do trecho lido via `onboundary`. So API nativa. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Glossario persistente (popover ancorado em vez de toast de 7s)** — trocar o toast que some por um disclosure: o termo vira `<button aria-expanded>` que abre um bloco inline fechavel, com `aria-describedby`. Permanece ate o usuario fechar, navegavel e relido. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)

### 4. Toque, gestos e ergonomia mobile

**Quick wins**
- **Alvos de toque 44px e gap 8px (maos tremulas/idosas)** — auditar nav-btn no layout 'quatro', botoes NPS estreitos em grid de 6 colunas, dots do carrossel (6px), termos do glossario e links de rodape; garantir minimo 44x44 com hitbox invisivel e scroll-snap consistente. *(funde duas auditorias de alvos de toque)* (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Persistir fonte ampliada antes do 1o paint e permitir pinch-zoom** — aplicar `cbc_fonte` inline no `<head>` para nao 'pular' ao reabrir, e nunca usar `maximum-scale=1` (manter pinch-zoom). Ajuste de meta + script inline minimo. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Bottom nav respeitando safe-area e teclado** — `padding-bottom: env(safe-area-inset-bottom)` na propria nav e encolher/esconder a nav quando o teclado abre (visualViewport API) para o textarea de 'Pergunte aqui' nao ficar coberto. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Pull-to-refresh nativo na aba do caso** — ao puxar >70px com scrollY=0, spinner dourado e refaz portal-data com diff suave (reusa o SWR), sem flash de tela inteira; respeita prefers-reduced-motion. Gesto familiar de app. (ansiedade: medio · tempo: nenhum · esforco: medio · auto: sim)

### 5. Velocidade percebida e robustez de rede

**Quick wins / fundacao**
- **Timeout + AbortController + retry no fetch de dados** — envolver o fetch de portal-data num AbortController de ~6s; ao estourar, cair no payload cacheado (banner 'mostrando sua ultima versao') e tentar 1 retry silencioso. Falha rapida em vez de skeleton infinito em rede movel. (ansiedade: alto · tempo: nenhum · esforco: baixo · auto: sim)
- **Skeleton com timeout ('demorando mais que o normal')** — timer client-side: aos 8s troca o shimmer por 'Estamos reunindo as informacoes do seu caso — so um instante' e aos 15s oferece 'tentar de novo' + cache offline. Evita sensacao de portal quebrado. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Skeletons com forma/altura reais (zero salto)** — modelar cada skeleton com a altura aproximada do conteudo final (status, timeline, cards de pagamento) e crossfade sem mudar altura. Carregamento estavel e premium, menos reflow/jank. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Reservar dimensoes (width/height/aspect-ratio) para zerar CLS** — definir tamanho em todas as `<img>` e `min-height` nos containers assincronos (vigia-box, equipe-fotos, cards de pagamento) para o conteudo nao pular e o dedo nao errar o alvo. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Servir imagens em WebP + Netlify Image CDN** — trocar logo/favicon PNG pelos `.webp` ja existentes em /public e passar fotos da equipe por `/.netlify/images?...&w=120&fm=webp&q=70`. Reduz 60-80% dos bytes sem mudar o visual. (ansiedade: nenhum · tempo: nenhum · esforco: baixo · auto: sim)
- **content-visibility:auto abaixo da dobra** — aplicar `content-visibility:auto` + `contain-intrinsic-size` em blocos pesados fora da dobra (timeline longa, accordions, equipe, rodape). Ganho de TBT/INP em celular modesto, zero mudanca visual. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)

**Alto impacto**
- **Stale-while-revalidate do payload (render instantaneo do cache)** — pintar imediatamente com o `cbc_payload` do localStorage (<24h) e disparar o fetch em paralelo; ao chegar, diff e atualiza so os blocos mudados com toast 'Atualizado agora'. Portal preenchido em <300ms percebidos. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Refresh automatico ao reabrir o app (visibilitychange)** — em `visibilitychange` visible, se passou >15min, refaz portal-data em background com diff suave + toast. O cliente que volta ve o estado fresco sem recarregar. (ansiedade: alto · tempo: baixo · esforco: baixo · auto: sim)
- **Self-hospedar fontes (Cormorant + Lato woff2)** — baixar os woff2 subset latin para /public, `@font-face` local com `font-display:swap` e `preload` dos 2 pesos. Servidos do mesmo dominio (TLS ja aberta) e cacheados immutable; corta ~300-600ms de TTFB de fonte em mobile. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Indicador discreto de status de conexao/atualizacao** — selo ao lado de 'Verificado hoje': 'Atualizando...', 'Atualizado agora', 'Exibindo sua ultima versao' com data relativa, reusando eventos online/offline e o ciclo de fetch. Transparencia temporal = menos ansiedade. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Lazy-render das abas inativas** — montar so 'Meu caso' no load e montar Pagamentos/Acordo/Duvidas sob demanda na 1a vez que sao tocadas (memoizar). Menos DOM inicial = primeiro toque mais rapido. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Prefetch inteligente da aba Pagamentos quando ha parcela vencendo** — se o payload indica parcela vencida/vencendo, pre-montar Pagamentos em `requestIdleCallback` apos a 1a pintura e priorizar buscar o PIX. Quando o cliente toca, ja esta pronto. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Degradacao adaptativa por Save-Data / rede lenta** — ler `navigator.connection.saveData`/`effectiveType`; em 2g/save-data, mostrar iniciais em vez de fotos, desligar count-up e adiar a 2a leva de blocos. Economiza dados de quem mais precisa, automatico. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)

**Estrategico / futuro**
- **Render progressivo: status antes do resto do payload** — dividir em `portal-data-core` (cliente+processo+status+timeline, rapido) que pinta primeiro e um 2o fetch para Pagamentos com fallback Asaas ao vivo. O cliente ve 'seu caso esta bem' em <1s mesmo com Asaas lento. (ansiedade: alto · tempo: baixo · esforco: alto · auto: sim)
- **Cache CDN de portal-data com revalidacao por token** — trocar `private,no-store` por `Netlify-CDN-Cache-Control` com s-maxage curto + cache tag por token + SWR, purgando a tag quando o monitor detecta movimento (gatilho de push ja existe). Respostas <100ms da edge, custo Supabase despenca. (ansiedade: medio · tempo: baixo · esforco: alto · auto: sim)
- **Compressao Brotli + split critico do CSS inline** — confirmar Brotli na entrega do portal.html e mover CSS nao-critico (abas secundarias, accordions, rodape) para `<style>` injetada apos a 1a pintura, mantendo so o critico inline. Primeira pintura mais leve. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Orcamento de performance + Lighthouse CI no deploy.sh** — Lighthouse CI (preset mobile, throttling 3G) contra o preview com budget (LCP<2.5s, TBT<200ms, peso), falhando o deploy se estourar. Roda automatico, protege a performance a longo prazo. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)

### 6. PWA, service worker e offline

**Quick wins**
- **Cache-busting do portal.html e do portal-sw.js** — adicionar no `_headers` `Cache-Control: no-cache` (revalida via ETag) para portal.html e o SW, mantendo assets internos immutable. Garante que o deploy chega ao cliente no proximo carregamento. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Versionar e limpar caches antigos no SW (activate)** — no `activate`, listar `caches.keys()` e deletar tudo != versao corrente, com bump por hash de build. Mantem o armazenamento do celular enxuto. (ansiedade: nenhum · tempo: nenhum · esforco: baixo · auto: sim)
- **Icones PWA reais (192/512 + maskable)** — gerar PNGs reais 192/512 do selo CBC e uma versao maskable com safe-zone (`purpose:'any'` e `'maskable'`), em vez de reaproveitar o favicon de ~20KB. Icone nitido = sensacao de 'app de verdade'. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Atalhos do PWA (shortcuts) para Pagamentos e Duvidas** — `shortcuts` no manifest dinamico ('Meus pagamentos' #pagamentos, 'Duvidas' #duvidas) e ler o hash no load para abrir a aba direto. Acesso de 1 toque via long-press do icone. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

**Alto impacto**
- **Precache do app shell no SW (install cache.addAll)** — no `install`, `cache.addAll(['/portal.html', favicon, logo, CSS critico])` versionado e servir o shell cache-first revalidando atras. Garante que o app instalado SEMPRE abre, mesmo no 1o uso offline. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Cache do payload no SW (Cache Storage) alem do localStorage** — interceptar GET de portal-data e aplicar SWR na Cache Storage, devolvendo a copia na hora e atualizando atras; versionar e expirar no `activate`. Ate falha de JS ou 1a pintura offline tem dados. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Notificacao push acionavel (abre direto no caso/parcela)** — incluir no payload do push a URL com token e ancora (`/portal?t=TOKEN#caso` ou `#pagamentos`); o SW ja le `data.url`. Push leva ao ponto exato em 1 toque, sem cair em 'Link incompleto'. (ansiedade: alto · tempo: baixo · esforco: baixo · auto: sim)
- **Botao 'Copiar PIX' robusto a clipboard bloqueado** — detectar falha de `navigator.clipboard` (Safari/WebView/contexto inseguro) e cair num fallback de selecao nativa ('Toque e segure para copiar'); confirmar copia real antes do feedback de sucesso. Evita ligacao por codigo vazio. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **Fila offline de envios com Background Sync** — gravar POSTs de pergunta/NPS/feedback numa fila (IndexedDB) e reenviar ao voltar online ('online' + Background Sync), com pill 'Sera enviado quando voltar a conexao'. Zero perda de mensagem, zero retrabalho da equipe. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Prompt de instalacao contextual e elegante** — capturar `beforeinstallprompt` e, apos a 2a visita, mostrar card 'Tenha seu processo na tela inicial, como um app'; no iOS, instrucao ilustrada de Compartilhar > Adicionar a Tela de Inicio. Persistir dispensa. Destrava retencao/push. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Fluxo de update controlado do SW ('nova versao disponivel')** — SW novo entra em waiting; o portal detecta `updatefound`/`controllerchange` e mostra toast 'Nova versao — toque para atualizar' que chama skipWaiting via postMessage + reload. Evita misturar assets antigos/novos. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Pre-renderizar/inlinar o QR Code PIX** — gerar o QR no cliente a partir do copia-e-cola PIX (lib QR ~3KB sob demanda) em vez de baixar a imagem base64 do Asaas. Funciona offline com o ultimo payload e elimina uma chamada externa no caminho de pagamento. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Health-check automatizado de push end-to-end** — cron diario que envia push de teste a um subscription sentinela e verifica 201; em 410/expired/erro VAPID avisa no Monitor admin e limpa subscriptions mortas. O maior canal de reducao de ansiedade nunca quebra em silencio. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)

### 7. Onboarding e orientacao do leigo

**Alto impacto**
- **Botao flutuante de WhatsApp do escritorio (rota de fuga 1-clique)** — botao `wa.me` persistente com `aria-label` claro, alvo 44px+ e numero vindo de bot_config (sem hardcode). Maior rede de seguranca para o idoso que se perde; atende a11y e deflete ligacoes. (ansiedade: alto · tempo: alto · esforco: baixo · auto: sim)
- **Onboarding de primeira visita acessivel (so no 1o acesso)** — usar `tk.acessos` (ja incrementado no backend) + flag em localStorage para exibir, so na 1a visita, um card/overlay leve em linguagem simples ('Aqui embaixo voce troca de secao · toque em Ouvir resumo · use A+'), dispensavel e lido pelo TTS. *(funde duas sugestoes de tour inicial)* (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)

### 8. Estados de erro e fallback

**Alto impacto**
- **Estados de erro que nunca deixam o cliente em frente fria** — transformar os 3 erros de `erroEstado()` em 'momentos de cuidado': SEMPRE um botao `wa.me`, texto empatico por causa ('seu link pode ter expirado — toque que reenviamos' vs 'estamos com instabilidade'), e selo CBC + nome da firma preservados para nao parecer pagina quebrada/golpe. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Token expirado/rotacionado se auto-recupera por WhatsApp** — distinguir no backend token `ativo=false` de token inexistente; no front, em vez do beco sem saida, oferecer 'Pedir um novo link agora' (wa.me pre-montado ou `portal-pergunta` categoria='reenvio_link'), reusando a infra de tarefa Kommo (SLA 1 dia). (ansiedade: alto · tempo: alto · esforco: medio · auto: sim)
- **Falha parcial nao derruba o portal inteiro** — trocar o `Promise.all` (catch unico = 500 total) por `Promise.allSettled`: renderizar tudo que voltou e, por bloco que falhou, mostrar micro-estado 'Esta informacao esta carregando, atualize em instantes'. Resiliencia pura. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Cache offline tambem em erro 500 (nao so falha de rede)** — unificar: ante QUALQUER falha (rede OU 500 'indisponivel'), tentar primeiro o cache do mesmo token e so cair em erro duro se nao houver cache. O cliente ansioso ve o caso de ontem em vez de tela preta. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Boundary de render: erro de JS nao vira pagina em branco** — envolver `render()` e cada `vSecao` em try/catch que, ao falhar (ex.: shape inesperado de acordo, regex de glossario), mostra o cache offline ou um card calmo 'Tivemos um problema ao montar esta parte — toque para tentar de novo' e loga sem dado sensivel. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)

**Quick wins**
- **Banner offline anunciado e com instrucao acessivel** — inserir o banner offline numa `role=status` com linguagem simples ('Voce esta sem internet. Estamos mostrando as informacoes salvas do dia X. Quando a internet voltar, atualizamos sozinhos.'). Reuso do `cbc_payload`. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Pagina de erro mantem identidade visual e PWA** — garantir que toda tela de erro/vazio (inclusive 'Link incompleto' sem token) carregue selo CBC, nome da firma, fundo ivory, fontes e meta-tags coerentes, para que link torto via WhatsApp nao pareca golpe. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)

### 9. Estados vazios e casos especiais (dados ausentes/incompletos)

**Alto impacto**
- **Cliente so-exito: 'Tudo em dia' vira 'Voce so paga se ganhar'** — detectar contrato so-de-exito (CPF, zero boletos, flag_so_exito) e renderizar card dedicado: 'Seu contrato e de exito: voce so paga honorarios sobre o que receber, ao final. Por isso nao ha parcelas — e nem havera enquanto o caso correr.' (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Processo distribuindo mostra contrato + equipe, nao vazio seco** — enriquecer 'Seu processo esta sendo preparado' (processos vazio) com 'Contrato assinado em DD/MM · nossa equipe esta montando a estrategia', jornada no marco 0 aceso, card de educacao da fase 0 e fotos da equipe. Onboarding caloroso. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Processo parado ha meses tem reframe honesto** — `statusHumano` colapsa qualquer caso >30 dias em 'Sob vigilancia diaria'; criar faixa >120 dias que NOMEIA a quietude e a explica pela fase ('Processos nesta fase costumam ter longos periodos de espera na fila — e normal e esperado; seguimos verificando todo dia'), puxando `prazo_medio`. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Boleto vencido vira oferta proativa, nao acusacao** — alem da pill vermelha, destacar PIX/2a via em primeiro plano + botao discreto 'Preciso de mais prazo' que cria tarefa/nota no Kommo (reusa portal-pergunta). Reduz constrangimento do cliente e cobranca manual. (ansiedade: alto · tempo: alto · esforco: medio · auto: sim)
- **Aba Acordo: pos-conclusao vira registro historico** — quando o acordo ja foi concluido e some da RPC, manter a aba com 'Sua prestacao de contas foi concluida em DD/MM — guarde como comprovante' em vez de sumir a aba e o cliente achar que perdeu o dinheiro. Ajuste no RPC para devolver o ultimo pago. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Conta do acordo que nao fecha: nunca mostrar numero que nao soma** — se `valor_recebido`/`valor_cliente` vier nulo/zero (calculo em rascunho), NAO mostrar a tabela de distribuicao; trocar por 'Seu acordo esta em conferencia final; os valores aparecem aqui assim que fecharem'. Protege a autoridade. (ansiedade: alto · tempo: baixo · esforco: baixo · auto: sim)
- **Caso encerrado com exito: tela de encerramento celebratoria** — detectar quadro ARQUIVAMENTO/encerrado e mostrar 'Seu caso foi concluido — obrigado por confiar na CBC' com jornada 100% acesa, resumo do conquistado e convite suave ao NPS/indicacao, em vez de seguir 'aguardando tribunal'. Fecha o ciclo emocional. (ansiedade: alto · tempo: baixo · esforco: medio · auto: sim)
- **Pergunta respondida fora do portal: badge na aba Duvidas** — sem realtime, badge numerico contando perguntas `status='respondida'` que o cliente ainda nao 'viu' (visto por id em localStorage). Ao voltar, percebe na hora que tem resposta nova. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Audiencia com data passada nao fica presa na tela** — se a data da audiencia < hoje, NAO mostrar como 'marcado'; opcionalmente 'Sua audiencia de DD/MM ja foi realizada — em breve trazemos os proximos passos'. Evita o panico de 'perdi minha audiencia?'. (ansiedade: alto · tempo: baixo · esforco: baixo · auto: sim)
- **Pagamento confirmado na sessao, nao a divida ainda aberta** — apos 'Copiar PIX', avisar 'Pagamentos via PIX podem levar alguns minutos para aparecer como confirmados'; ao reabrir, comparar com o cache anterior e destacar 'Pagamento confirmado!' quando a parcela migra pendente->pago. Diff local sobre `cbc_payload`. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Nome do cliente nao bate: sinal silencioso ao admin** — se o token tem CPF/advbox_customer_id mas zero processos (divergencia de match por ilike), alem do estado de onboarding, gravar `portal_vinculo_suspeito` para a equipe revisar. Cliente nao ve erro; escritorio corrige sem reclamacao. (ansiedade: alto · tempo: alto · esforco: medio · auto: sim)

**Quick wins**
- **Estado vazio de pagamentos diferencia tres situacoes** — separar 'Honorarios 100% quitados, obrigado pela confianca' / so-exito / 'Suas parcelas serao geradas em breve e aparecem aqui automaticamente', por `honorarios_total` vs `total_pago` vs ausencia de contrato. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Timeline vazia distingue 'recem-distribuido' de 'sem espelho'** — para o caso novo, complementar 'Ainda nao ha movimentacoes' com a expectativa da fase ('as primeiras movimentacoes costumam levar X — fila normal do tribunal', do `prazo_medio`) e 'Distribuido ha N dias'. Da contexto temporal. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Caso 100% oculto nao parece fantasma** — se TODOS os processos tem `ocultar_cliente=true`, mostrar card intencional 'Por estrategia processual, alguns detalhes ficam reservados — mas estamos cuidando de tudo; o resumo mostra o ritmo do trabalho'. Mantem autoridade, evita sensacao de bug. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Multi-processo: resumo nao esconde casos parados** — adicionar terceira contagem tranquilizadora ('N em fase de espera normal do tribunal', cor neutra/verde, ancorada na explicacao da fase) para clientes com casos longos sem movimento. Transparencia que acalma. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **'Aguardando o tribunal ha N dias' com numero alto vira reframe** — acima de ~90 dias, trocar o contador cru de `vez_dias` por 'Aguardando o tribunal — fase de espera normal nesta etapa', sem exibir o numero alarmante. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Recesso convive com timeline vazia sem redundancia** — quando ha recesso/feriado ativo, o estado vazio da timeline cede a vez ('Durante o recesso e esperado nao haver movimentacao — retoma em DD/MM') em vez de duplicar 'nada se move'. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Estado vazio de FAQ aproveita as FAQs por fase** — quando `portal_faq` esta vazio, popular a aba Duvidas com `educacao[jornada].faq` (EDU_DEFAULT) em vez de 'Em breve'. O cliente nunca ve aba oca. Reuso puro de dado. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Cliente sem contrato casado mostra card neutro** — quando ha processo e pagamentos mas nenhum contrato (CPF divergente), mostrar 'Os detalhes do seu contrato estao com nossa equipe — qualquer duvida sobre honorarios e so perguntar' em vez de omitir o card e o cliente achar que 'nao tem contrato'. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Datas invalidas nunca viram 'Invalid Date' ou '999 dias'** — endurecer `dataBR`/`diasDesde` para, em data nao-parseavel, omitir o campo ('data nao informada' ou esconder a linha) em vez de exibir lixo e disparar status errado. Protege a estetica premium contra dados sujos. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Saudacao resiste a primeiro_nome vazio/estranho** — normalizar no backend: remover pronomes ('DR.', 'SRA.'), capitalizar CAIXA ALTA e, se vazio/suspeito, usar fallback caloroso e neutro sem 'cliente' generico. Protege a primeira impressao. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Limite de 8 processos: avisar truncamento** — detectar quando o `.limit(8)` foi atingido (pedir count) e mostrar nota discreta 'Mostrando seus 8 casos principais — fale com a equipe para ver os demais' + wa.me. Transparencia, evita achar que um caso sumiu. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **PIX/boleto ausente nunca deixa parcela sem acao** — se faltam PIX e boleto (fallback Asaas cobre so 3/request, `boleto_url` pode ser null), mostrar 'Solicitar 2a via' (wa.me/tarefa Kommo) em vez de um card mudo. Nenhuma parcela fica sem caminho de pagamento. (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **Equipe sem fotos nao deixa buraco no card 'Quem cuida'** — fallback elegante por iniciais/monograma dos responsaveis (de `bi_processos`) ou selo 'Equipe CBC dedicada ao seu caso', para o card nunca sumir por falta de upload. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **'Sem dado' vs 'dado zero' nos contadores da equipe** — para o caso novo com `atividades=null`, mostrar 'Sua estrategia esta sendo montada — os indicadores aparecem aqui assim que a equipe iniciar' em vez do silencio, distinguindo 'ainda nao comecou' de 'sem dado'. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)

**Estrategico / futuro**
- **Healthcheck silencioso de portal vazio (alerta ao escritorio)** — quando o payload monta 'oco' (processos=0 E contrato=null E pagamentos=0) para token valido, gravar `portal_acessos_vazios`; a rotina semanal de qualidade lista para a equipe corrigir o vinculo. Cliente nunca ve nada. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)

---

## Financeiro, seguranca & operacao

Este tema reune as ideias que tocam o bolso do cliente, a confianca no sistema e a sustentabilidade tecnica do portal. A logica e simples: o cliente precisa pagar sem atrito e sem medo, sentir que seus dados estao seguros, e o escritorio precisa que tudo isso rode sozinho conforme a base cresce. As tres frentes se reforcam — um pagamento confirmado em tempo real alivia ansiedade, deflete uma ligacao e so funciona se a infra aguentar o pico.

### 1. Pagamentos e financeiro

#### Quick wins
- **Recibo de quitacao por parcela (1 toque)** — Botao em cada card do historico que gera no aparelho (jsPDF) um recibo individual com logo, valor, data e nº do documento; se houver NF, link para ela. (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **Recibo consolidado do acordo em PDF** — Botao na aba Acordo que gera no aparelho a prestacao de contas (valor recebido, honorarios, custas, correcao, liquido), espelhando a tela. Deflexao do "me manda por escrito". (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **QR Code PIX visual** — Renderizar o QR a partir do pix_copy_paste com lib client-side leve, para quem nao consegue colar (idosos, pagamento em outro aparelho). (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)
- **Reframing do "Vencido" para "Aguardando pagamento"** — Trocar a pill vermelha por tom ambar com subtexto "venceu em DD/MM — ainda da tempo de regularizar". Mantem o dado real, convida em vez de culpar. (ansiedade: alto · tempo: baixo · esforco: baixo · auto: sim)
- **Botao WhatsApp contextual em parcela vencida** — "Falar sobre esta parcela" com wa.me do escritorio (key portal_whatsapp) e texto pre-preenchido. Canal 1-clique sem cobranca ativa. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Previsao do proximo vencimento + calendario unico** — Pill neutra "Sua proxima parcela vence em N dias" no topo, e botao que gera um unico .ics com todas as pendentes (hoje so faz 1 por vez). (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Status de processamento PIX/boleto transparente** — Mapear estados intermediarios do Asaas (AWAITING_RISK_ANALYSIS -> "em analise pelo banco") em micro-copy claro. Evita o contato "paguei e nao baixou". (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Glossario-tooltip financeiro** — Estender o sublinhado pontilhado + toast para termos como honorarios de exito, custas, correcao, levantamento, nas abas Pagamentos e Acordo. (ansiedade: medio · tempo: medio · esforco: baixo · auto: sim)
- **Selo "Pagamentos 100% em dia"** — Quando nao ha vencidas e ha historico de pagos, selo elegante com micro-copy de gratidao. Reforco positivo derivado dos dados. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Total economizado/recuperado em destaque** — Card navy "Resultado do seu caso: voce recebeu R$ X" quando ha acordo concluido, posicionando honorarios como proporcionais ao ganho. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Mensagem de gratidao pos-quitacao dos honorarios** — Ao detectar total_pago >= honorarios_total, card "Honorarios quitados — agora seguimos 100% no resultado". Marco emocional positivo. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Ouvir resumo financeiro (TTS)** — Botao que le total pago, em aberto, proxima parcela e como pagar via PIX. Acessibilidade financeira para idosos/leigos. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Confirmacao explicita de "sem pendencias" com data** — No estado "Tudo em dia", acrescentar "Conferido com o banco hoje as HH:MM" usando o timestamp do sync Asaas. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Indicador de quanto falta para o exito justificar o investimento** — Card sutil "Voce ja investiu R$ X — o desfecho esta na reta final", ligando total_pago ao status humano. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Badge de pendencias mais informativo** — Badge fica ambar (vs neutro) quando ha vencida; ao tocar, a aba abre rolada na parcela mais urgente. (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)

#### Alto impacto
- **Celebracao de pagamento confirmado em tempo real** — Web Push "Recebemos seu pagamento de R$ X, obrigado!" no webhook, e banner verde efemero no topo da aba quando ha pagamento de hoje. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Oferta proativa e gentil de renegociacao** — Quando ha vencida ha >X dias, card calmo "Precisa de mais prazo? Estamos aqui" com WhatsApp ou registro de intencao via Kommo. Transforma cobranca em acolhimento. (ansiedade: alto · tempo: alto · esforco: medio · auto: sim)
- **Atualizacao otimista pos-PIX ("Ja paguei")** — Apos copiar o PIX, estado "Aguardando confirmacao do banco — alguns minutos" + polling leve que troca para "Pago" quando o status muda. Acalma a janela ate confirmar. (ansiedade: alto · tempo: medio · esforco: medio · auto: sim)
- **Lembrete automatico de parcela a vencer (D-3/D-1)** — Web Push gentil antes do vencimento, reaproveitando a regua com sinal invertido. Previne a inadimplencia em vez de remediar. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Captura do comprovante oficial Asaas (transactionReceiptUrl)** — Salvar o comprovante bancario real no espelho e exibir "Comprovante oficial" no card de pago. Deflexao total do "me manda o comprovante". (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Confirmacao de dados bancarios do acordo no portal** — Formulario seguro "confirme onde quer receber" que grava no Supabase + cria nota/tarefa no Kommo. Elimina a rodada manual de coleta por cliente. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Explicacao "por que meu liquido e esse"** — Accordion "Entenda como chegamos ao seu valor liquido" com texto parametrizavel, explicando cada deducao. Antecipa a duvida que mais gera contato no repasse. (ansiedade: alto · tempo: medio · esforco: baixo · auto: sim)
- **Segunda via inteligente de boleto vencido** — Para vencida, priorizar o PIX (sempre valido) e, se preciso, gerar 2a via atualizada via API Asaas. Deflexao do pedido de segunda via. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Comprovante de pagamento aceito (upload pelo cliente)** — Botao "Ja paguei — enviar comprovante" para quem pagou por fora do Asaas; sobe ao storage e cria tarefa no Kommo. Centraliza o vai-e-vem do WhatsApp. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Historico financeiro anual / informe para IR** — Seletor de ano no gerador de extrato PDF + "Informe de pagamentos do ano X" com dados do escritorio prontos para o IR. Deflexao sazonal recorrente. (ansiedade: baixo · tempo: alto · esforco: baixo · auto: sim)
- **Onboarding financeiro de primeira visita** — Coachmark unico "Pagou pelo PIX/boleto daqui? A baixa e automatica, nao precisa nos avisar." Reduz de cara o principal contato pos-pagamento. (ansiedade: medio · tempo: alto · esforco: baixo · auto: sim)
- **Aviso de boleto recem-emitido** — No PAYMENT_CREATED, Push "Nova parcela disponivel — vence em DD/MM". Garante que toda cobranca chega ao cliente na emissao. (ansiedade: baixo · tempo: alto · esforco: medio · auto: sim)
- **Reengajamento de link nunca acessado COM pendencia** — Cruzar tokens nunca acessados com vencidos e disparar 1 WhatsApp via Salesbot com o link e a parcela aberta. Prioriza onde o risco e maior. (ansiedade: baixo · tempo: alto · esforco: medio · auto: sim)

#### Estrategico / futuro
- **Linha do tempo financeira (todas as parcelas previstas)** — Mini-stepper de parcelas (1..N de honorarios_parcelas) marcando pagas/atual/futuras com data prevista, sob "Seu contrato". Da sensacao de progresso. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Transparencia do detalhe das custas** — Se o calculo tiver itens de custas em JSONB, exibir sub-accordion "Ver detalhe das custas"; senao, tooltip explicando tipos comuns. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Resumo financeiro consolidado para multi-processo** — Agrupar parcelas por contrato com subtotais por caso quando ha mais de um. Evita "paguei isso de qual processo?". (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **NPS detrator financeiro vira tarefa no Kommo** — Quando NPS <=6 e ha vencida/acordo recente, criar nota/tarefa "insatisfeito + pendencia financeira". Recuperacao sem monitorar painel. (ansiedade: baixo · tempo: medio · esforco: baixo · auto: sim)
- **Painel admin de toggles da regua e flags financeiras** — Secao admin com on/off para regua.ativo, etapas D+, percentual de desconto a vista e portal_whatsapp. Habilita automacoes sem SQL nem deploy. (ansiedade: nenhum · tempo: medio · esforco: baixo · auto: sim)
- **Antecipacao com desconto (quitar parcelas futuras)** — Card opcional "Quer quitar de uma vez?" que soma futuras com desconto configuravel e gera PIX unico. So aparece se a flag estiver ligada. (ansiedade: baixo · tempo: medio · esforco: alto · auto: sim)

### 2. Seguranca, privacidade e LGPD

#### Quick wins (correcoes de cabecalho e front, alto retorno)
- **Referrer-Policy no-referrer** — Hoje nao existe; com o token na query string, qualquer link externo (wa.me, Google, Asaas) recebe a URL completa com token no Referer. Adicionar meta tag + header no /portal. Fecha o vetor de vazamento mais provavel. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Limpar o token da URL apos carregar** — history.replaceState para remover ?t= da barra e do historico; manter o token so em memoria/sessionStorage. Evita vazamento em print/celular compartilhado. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Cabecalhos de seguranca HTTP (CSP, frame-ancestors, nosniff)** — Nao ha nenhum hoje; sem frame-ancestors o portal e embutivel (clickjacking), sem CSP um XSS exfiltra o token. Adicionar CSP restritiva, X-Frame-Options DENY, X-Content-Type-Options nosniff, Permissions-Policy minima. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **X-Robots-Tag noindex no portal-data e /portal** — A resposta JSON nao tem o header; crawlers sem JS podem indexar URL com token. Adicionar noindex, nofollow, noarchive. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Restringir CORS ao dominio proprio** — Trocar Access-Control-Allow-Origin "*" por allowlist (dominio de prod + teste). Como o token e o unico segredo, fecha as APIs ao proprio app. (ansiedade: nenhum · tempo: nenhum · esforco: baixo · auto: sim)
- **Mascarar CPF e dados sensiveis por padrao** — Exibir CPF mascarado (123.***.**9-00) e valores com "tocar para revelar". Minimizacao em tela (CSS blur + toggle), so front. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Bloquear cache compartilhado/proxy do HTML** — Garantir Cache-Control: private, no-store e Vary no /portal e /portal.html (so /index.html tem hoje). Fecha o canto de cache cross-user. (ansiedade: nenhum · tempo: nenhum · esforco: baixo · auto: sim)
- **SRI + travamento de versao das CDNs** — Adicionar integrity (SHA-384) + crossorigin e fixar versao exata nos scripts CDN (jsPDF/xlsx). Casado com a CSP, garante que so o codigo esperado execute. (ansiedade: nenhum · tempo: nenhum · esforco: baixo · auto: sim)
- **Aviso de privacidade e base legal (LGPD art. 9)** — details "Privacidade e seus dados" em Duvidas com texto fixo: dados tratados, finalidade, compartilhamento (Asaas/ADVBOX/Kommo/Google), base legal e direitos. Transparencia sem rotina. (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Selo visivel de seguranca/criptografia** — Icone de cadeado + "Conexao segura e link exclusivo seu" com tooltip em linguagem simples. Reduz a ansiedade de "sera que e golpe/vazou". (ansiedade: medio · tempo: nenhum · esforco: baixo · auto: sim)
- **Educar contra phishing** — Aviso fixo perto de Pagamentos: "Nunca pedimos senha ou pagamento em conta de terceiros; os boletos/PIX sao sempre em nome de CBC Advogados". Anti-fraude pura. (ansiedade: medio · tempo: baixo · esforco: baixo · auto: sim)
- **Painel "Seus acessos recentes"** — Linha discreta no rodape "Este link foi aberto N vezes · ultimo acesso DD/MM HH:MM", a partir de dados de telemetria existentes. Transmite seguranca e da controle ao titular. (ansiedade: medio · tempo: nenhum · esforco: baixo · auto: sim)
- **Link de indicacao 100% livre de PII** — Garantir por codigo (e lint que falha o build) que nenhuma mensagem de indicacao a terceiros inclua token, CPF, processo ou valores — so o link institucional. (ansiedade: nenhum · tempo: baixo · esforco: baixo · auto: sim)
- **Texto neutro em todos os canais de saida** — Auditar para que push, .ics, manifest e og:description nunca revelem a natureza sensivel do caso a terceiros ("Novidade no seu processo", "Compromisso CBC"). (ansiedade: baixo · tempo: baixo · esforco: baixo · auto: sim)
- **Auto-bloqueio por inatividade / tela compartilhada** — Auto-blur "Toque para ver de novo" apos N minutos sem interacao e ao perder foco. So front, respeitando prefers-reduced-motion. (ansiedade: baixo · tempo: nenhum · esforco: baixo · auto: sim)
- **Politica de retencao de perguntas/NPS/feedbacks** — Scheduled de purga/anonimizacao de respostas com mais de X meses, mantendo metrica agregada. Cumpre limitacao temporal da LGPD; so SQL + cron. (ansiedade: nenhum · tempo: baixo · esforco: baixo · auto: sim)

#### Alto impacto (escrita de codigo / backend)
- **Expiracao/rotacao automatica do token (TTL + sliding)** — Coluna expira_em; portal-data recusa expirado e renova a validade a cada acesso legitimo (+90 dias). Cron diario caduca os esquecidos. Cliente ativo nunca percebe; link vazado morre sozinho. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Sanitizar/escapar todo texto do espelho antes do DOM** — Auditar pontos de innerHTML (andamento traduzido, descricao de boleto, nome, respostas) e trocar por textContent/helper esc(). Com a CSP, fecha o XSS que rouba o token. (ansiedade: nenhum · tempo: nenhum · esforco: medio · auto: sim)
- **Nao persistir o payload sensivel em localStorage em claro** — Hoje grava CPF/valores/andamentos em texto puro sem expirar. Reduzir o cache a subconjunto nao sensivel, OU cifrar via WebCrypto, OU expirar em 7 dias. (ansiedade: baixo · tempo: nenhum · esforco: medio · auto: sim)
- **Desativacao automatica do token quando o caso encerra** — Quando todos os processos estao arquivados ha >X dias sem boleto pendente, marcar ativo=false. Reduz a superficie de exposicao sem rotina manual (LGPD). (ansiedade: nenhum · tempo: medio · esforco: medio · auto: sim)
- **Botao "Desconfio que vazou" que revoga em 1 toque** — Auto-servico em Duvidas: nova function portal-revogar marca ativo=false e cria tarefa no Kommo pedindo reenvio. Cliente neutraliza vazamento, equipe so reemite. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Limpar dados sensiveis ao revogar/expirar** — Ao detectar token invalido, portal-data responde { purge:true } que faz o front limpar localStorage, cancelar a PushSubscription e o SW limpar caches. Revogar realmente apaga o acesso. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Rate limiting / anti-enumeracao** — Throttle por IP em portal-data e endpoints de escrita (sem limite hoje); 401 generico em tempo constante. Protege contra abuso e custo de um token vazado em loop. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Detector de acesso anomalo** — Fingerprint leve por acesso (hash UA + faixa IP /24 + dia); scheduled sinaliza no Monitor tokens com muitos /24 distintos no dia ou UF diferente. So alerta interno, permite rotacionar links comprometidos. (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)
- **Auto-servico de direitos do titular (LGPD art. 18)** — "Baixar meus dados" (PDF/JSON de portabilidade) e "Solicitar revisao/exclusao" que cria tarefa no Kommo com SLA. Atende acesso/portabilidade/eliminacao como fluxo automatico. (ansiedade: baixo · tempo: medio · esforco: medio · auto: sim)
- **Validar Origin nas escritas e amarrar push ao token vigente** — No monitor, conferir que o token da subscription ainda esta ativo antes de enviar push (senao apagar); exigir Origin da allowlist nos POSTs; registrar tentativas invalidas. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Minimizar PII nas exportacoes admin** — Mascarar CPF por padrao no export PDF/Excel; exigir confirmacao para "exportar com CPF completo"; marcar cabecalho de confidencialidade + data/usuario. Reduz a janela de vazamento em lote. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Registro de auditoria (audit log) append-only** — portal_audit_log grava criacao/rotacao/revogacao de token, 1º acesso de novo dispositivo, exportacao e tentativas invalidas, com timestamp e ator. Evidencia para LGPD e investigacao. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)

#### Estrategico / futuro
- **Verificacao leve de identidade no 1º acesso (4 ultimos do CPF)** — Gate opcional em novo dispositivo, configuravel (so casos de valor alto/acordo). Eleva a barra sem virar senha nem criar rotina. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **"Modo familia" com link de visao reduzida** — Token-derivado de escopo reduzido (so status e proxima novidade, sem CPF/financeiro) para o botao "Para a sua familia". Minimizacao por design mantendo o engajamento. (ansiedade: baixo · tempo: baixo · esforco: alto · auto: sim)
- **Confirmacao cifrada de dados bancarios (fora do WhatsApp)** — Campo seguro no portal gravado cifrado, legivel so pelo financeiro (RPC security definer), com registro de consentimento. Tira dado bancario do canal nao cifrado. (ansiedade: medio · tempo: medio · esforco: alto · auto: sim)
- **Recibo de quitacao assinado-no-servidor (anti-falsificacao)** — Comprovante gerado na function com codigo de verificacao/hash e URL publica /verificar?c=CODIGO contra o Asaas espelhado. Valor probatorio, protege contra adulteracao. (ansiedade: medio · tempo: baixo · esforco: alto · auto: sim)
- **Token de uso unico para a 1ª abertura via WhatsApp** — A equipe envia link de ATIVACAO efemero que, ao abrir, troca por sessao no dispositivo e queima. O token permanente nunca trafega reaproveitavel pelo WhatsApp. (ansiedade: baixo · tempo: medio · esforco: alto · auto: sim)
- **Token do PWA invisivel (start_url limpo)** — Guardar o token no IndexedDB e usar start_url /portal que o recupera no boot, em vez de gravar o token no SO/backup ao instalar. (ansiedade: nenhum · tempo: nenhum · esforco: medio · auto: sim)
- **Healthcheck/canary de exposicao** — Scheduled semanal que confere se os headers de seguranca seguem presentes pos-deploy, busca URLs com ?t= indexadas e valida 401 em token invalido. Seguranca monitorada, nao "configurei e esqueci". (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)

### 3. Escalabilidade e operacao zero-manutencao

#### Quick wins
- **Segredos fora do codigo (remover anon/JWT hardcoded)** — botDb.mjs/health.mjs tem a anon key no fonte e caem para anon se faltar a service role — RLS bloqueia e o portal "misteriosamente" fica vazio. Exigir as envs no boot e usar service role consistentemente. (ansiedade: nenhum · tempo: baixo · esforco: baixo · auto: sim)
- **Pool de conexoes Postgres (pooler/transaction mode)** — Garantir que todas as functions usem a porta 6543 do pooler, nao a conexao direta. Em pico de acessos evita "too many connections" — falha que so aparece na escala. (ansiedade: nenhum · tempo: baixo · esforco: baixo · auto: sim)
- **Edge Function + cache no portal-manifest e assets do PWA** — Migrar o manifest (gerado por function a cada abertura) para Edge com cache forte. Tira carga de algo essencialmente estatico e acelera a instalacao. (ansiedade: nenhum · tempo: baixo · esforco: baixo · auto: sim)
- **Consolidar a malha de crons (orcamento de invocacoes)** — Auditar keep-warm a cada 10min, reminder 15min, watchdog 30min + ~8 syncs; unir watchdogs, rever frequencias. Reduz o custo-base que existe mesmo com zero clientes. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)

#### Alto impacto
- **RPC unica portal_payload + cache CDN com SWR** — Consolidar as ~11 queries + 6 RPCs num roundtrip e servir do edge (s-maxage + stale-while-revalidate, cache-tag por token). Cliente ansioso recarrega varias vezes; 95% das visitas passam a vir da borda. (ansiedade: medio · tempo: medio · esforco: alto · auto: sim)
- **Match deterministico de carteira (fim do ilike %nome%)** — Vincular processos por advbox_customer_id (ou tabela ponte) em vez de string; onde inevitavel, indice GIN trigram. Escala para milhares e fecha o risco de homonimos verem o caso um do outro. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Tirar a chamada Asaas ao vivo do hot path** — Persistir pix_copy_paste no espelho no momento do sync (asaas-sync 2x/dia); o portal so le do banco. O fallback ao vivo vira excecao rara — pagina sempre carrega na velocidade do espelho. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Rate-limit e blindagem por token** — 60 req/5min via Netlify Blobs/tabela leve, validar formato e devolver 429 com Retry-After. Impede que um token vazado vire vetor de custo descontrolado. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Watchdog de frescor (alerta quando um cron para)** — Scheduled diaria que le os last_run e, se monitor/asaas/datajud passam do SLA, dispara UM alerta interno. A operacao zero-manutencao so e real se a falha grita sozinha. (ansiedade: medio · tempo: medio · esforco: medio · auto: sim)
- **Degradacao graciosa por fonte (Promise.allSettled)** — Isolar cada bloco em try/catch, marcar campos null e sinalizar _parcial. Uma RPC com bug nao tira o portal inteiro do ar para todos. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **SLA interno e budget por chamada externa** — Promise.race com timeout curto (RPC 2.5s, Asaas 1.5s) tratando estouro como bloco indisponivel. Tempo de resposta previsivel por design, independente do volume simultaneo. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Geracao e envio automatico do link ao novo cliente** — Trigger pos-assinatura (hook no zapsign-webhook) que gera o token e enfileira o envio via Salesbot, idempotente. Elimina o maior gargalo manual restante. (ansiedade: baixo · tempo: alto · esforco: alto · auto: sim)
- **Mapa deterministico stages_id -> marco da jornada** — Coluna marco_jornada em bot_stage_templates (derivada da regex na 1a vez, depois fixavel). Renomear etapa no ADVBOX deixa de quebrar a jornada/stepper em massa. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Estimativa de prazo por fase calculada do historico real** — RPC/MV que calcula "casos como o seu nesta fase levaram em media N dias" a partir do historico do escritorio, recalculada 1x/dia. Maior alivio de ansiedade por resultado, e melhora sozinha com a base. (ansiedade: alto · tempo: baixo · esforco: alto · auto: sim)
- **Realtime/SSE para resposta de pergunta e confirmacao de pagamento** — Supabase Realtime filtrado por token, em vez de polling. Cliente ve a resposta/"pagamento confirmado" aparecer sozinho; servidor nao paga por poll de milhares de abas. (ansiedade: alto · tempo: baixo · esforco: alto · auto: sim)
- **Lembrete .ics automatico de audiencia/pericia** — portal_atividades ja detecta o compromisso; reusar a engenharia de .ics/contagem regressiva (hoje so para parcelas). Cliente sente que nada passa batido. (ansiedade: alto · tempo: baixo · esforco: baixo · auto: sim)
- **Reengajamento automatico de quem "nunca acessou"** — Cron semanal que dispara 1-2 lembretes via Salesbot para tokens com >3 dias e acessos=0, marcando reengajado_em. Converte relatorio passivo em deflexao real. (ansiedade: medio · tempo: alto · esforco: medio · auto: sim)
- **Auto-resposta de perguntas cobertas pelo FAQ** — Matcher (similaridade/embedding sobre portal_faq + educacao) responde com a resposta canonica marcada como assistente, abrindo tarefa humana so com baixa confianca. A unica rotina manual deixa de escalar com os clientes. (ansiedade: medio · tempo: alto · esforco: alto · auto: sim)

#### Estrategico / futuro
- **Push escalavel: fila + concorrencia limitada + dedupe** — Resolver tokens afetados via JOIN (nao cruzar arrays em JS), Promise pool de ~20, dedupe por token, log em portal_push_log. Pronto para volume sem estourar memoria do worker. (ansiedade: baixo · tempo: nenhum · esforco: alto · auto: sim)
- **Healthcheck ponta-a-ponta do push (VAPID + entrega real)** — Adicionar ao watchdog um push sintetico para uma assinatura-canario e medir taxa de erro 4xx/5xx. Garante que o canal proativo realmente funciona em escala. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Idempotencia e backoff nas notas Kommo do monitor** — Pool de concorrencia, retry com backoff em 429/5xx e marcar nota pendente para reprocessar. Evita perda silenciosa de comunicacao no CRM em dias de muito volume. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Particionar/limitar o crescimento de bot_sync_state** — Indice composto (kind, lawsuit_id, event_date desc), particionar por ano ou tabela "quente" de 18 meses, mover task_completed antigas para agregados. Mantem a timeline rapida com a base crescendo. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Pre-agregar contadores "Nossa equipe em acao" em view diaria** — Materializar tarefas_concluidas/movimentos por lawsuit (hoje calculado a cada visita) via monitor ou cron noturno. Custo de CPU proporcional a clientes, nao a visitas x clientes. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Cache de traducao do glossario por andamento** — Persistir title_cliente ja traduzido no bot_sync_state na ingestao, reusando bot_ai_cache. Traduzir 1x em vez de a cada leitura blinda contra mudanca de glossario em massa. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Purga seletiva de cache por token quando ha novidade** — Quando o monitor detecta novidade, emitir purge de cache-tag por token. Permite TTL de borda generoso sem nunca mostrar dado velho de um caso que acabou de andar. (ansiedade: medio · tempo: baixo · esforco: medio · auto: sim)
- **Circuit breaker no fallback Asaas/ADVBOX** — Apos K falhas seguidas, abrir o circuito por alguns minutos e servir so o espelho, fechando sozinho quando a API volta. Protege a latencia do portal de uma dependencia externa degradada. (ansiedade: baixo · tempo: baixo · esforco: medio · auto: sim)
- **Orcamento de tempo na varredura do monitor** — Checar Date.now() e parar com cursor salvo para retomar, em vez de so um teto de paginas. Garante que o sync sempre converge, mesmo com volume crescente. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Orcamento e alerta de custo Netlify/Supabase** — Cron mensal que le metricas de uso e alerta ao passar de ~70% do tier, com quebra por funcao. Transforma custo em algo observado em vez de surpresa. (ansiedade: nenhum · tempo: medio · esforco: medio · auto: sim)
- **Dashboard de saude do portal (SLO)** — RPC portal_saude que agrega frescor de cada espelho, erro do monitor, p95 do portal-data, entrega de push, % de tokens nunca acessados, numa aba admin somente-leitura. (ansiedade: nenhum · tempo: alto · esforco: medio · auto: sim)
- **Versionar o schema (migrations)** — Adotar supabase migrations versionadas no repo para todas as RPCs/policies do portal. Permite recriar em DR, abrir branch de teste e onboard de outro dev deterministicamente. (ansiedade: nenhum · tempo: medio · esforco: medio · auto: sim)
- **Auditar e fixar RLS das tabelas lidas pelo portal** — RLS restritiva por padrao (anon sem acesso) em todas as tabelas sensiveis, com so as RPCs security-definer expondo o necessario, confirmado por get_advisors periodico. (ansiedade: nenhum · tempo: baixo · esforco: medio · auto: sim)
- **Snapshot diario do payload por token (fallback no backend)** — Cron grava 1x/dia o payload de cada token em Netlify Blobs; se o portal-data falhar, uma Edge serve o snapshot com banner "dados de DD/MM". Cliente nunca ve tela de erro. (ansiedade: medio · tempo: baixo · esforco: alto · auto: sim)

> Nota de dedup: a expiracao/rotacao de token aparecia em duas lentes (Seguranca e Operacao) — consolidada na versao de Seguranca (TTL + sliding window), que ja cobre a desativacao de orfaos por arquivamento e inatividade. O rate-limit por token tambem vinha duplicado; mantida a versao operacional (60 req/5min via Blobs) como implementacao canonica, com a nota anti-enumeracao da lente de Seguranca anexada a ela. A confirmacao de dados bancarios do acordo aparece em duas formas — a versao "agilizar repasse" (financeiro, esforco medio) e a versao cifrada (seguranca, esforco alto); mantidas ambas como caminho incremental.
