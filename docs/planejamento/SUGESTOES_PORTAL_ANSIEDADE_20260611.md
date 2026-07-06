# Portal do Cliente — análise focada em ANSIEDADE × VALOR (11/06/2026)

> Lente única desta análise: o que faz o cliente sair do portal MAIS CALMO
> e MAIS convencido de que o escritório vale o que ele paga.
> Esforço: ⚡ horas · 🔨 1–3 dias · 🏗 projeto

## Diagnóstico: onde a ansiedade nasce (e o que o portal já cobre)

O portal já entrega: fase em destaque + jornada visual, "tudo sob controle",
selo de ritmo, equipe em ação (contadores + prazo judicial), timeline
traduzida com explicação "movimentação ≠ tarefa", pagamentos com PIX,
acordo, NPS. **Os 4 gatilhos de ansiedade que ainda ficam abertos:**

1. **O silêncio** — quando NADA acontece por semanas, o portal hoje não diz
   nada ativamente. É exatamente quando o cliente liga.
2. **O "quando?"** — não há previsão temporal: quanto falta? quanto tempo é
   normal? O `prazo_medio` existe mas depende de parametrização manual.
3. **A ausência de gente** — números transmitem competência, mas calma vem
   de pessoas: rosto, voz, mensagem pessoal, canal de desabafo.
4. **A falta de comemoração** — marcos vencidos passam em silêncio; nada
   marca o progresso emocionalmente.

---

## A. Domar o tempo (a raiz de ~80% da ansiedade)
1. 🔨 **"Tempo nesta fase" com régua de normalidade**: "há 45 dias nesta
   etapa — processos como o seu ficam de 60 a 120 dias". Calculado dos dados
   REAIS do escritório (bi_processos_log + bi_funil_historico já gravam isso).
2. 🔨 **Previsão do próximo marco em faixa**: "a citação costuma acontecer
   entre julho e setembro" — mediana ± quartis por etapa/comarca, sempre em
   faixa (nunca data exata = nunca promessa quebrada).
3. ⚡ **"Verificado hoje às 6h30 ✓"** — carimbo real do último monitor no topo
   da timeline. Prova diária de vigilância; o silêncio vira "vigiado e sem
   novidade", não "esquecido".
4. ⚡ **Tratamento ativo do silêncio**: 15+ dias sem movimentação → card
   automático "Sem novidades — e isso é normal nesta fase. Seguimos
   verificando todos os dias." (o bot já tem essa lógica; portar ao portal).
5. ⚡ **Banner de recesso forense**: em dezembro/janeiro e feriadões, explicar
   que o tribunal para — antecipa a pergunta antes dela virar ligação.
6. 🔨 **"O que NÃO vai acontecer agora"**: por fase, lista do que o cliente
   NÃO precisa esperar/temer ("nesta fase não há audiência; você não será
   chamado ao fórum") — campo novo na parametrização de etapas.
7. 🔨 **Marcos futuros fantasma na timeline**: depois do último andamento,
   itens em cinza claro com o que vem pela frente — o futuro visível acalma.
8. 🔨 **"Você está no mês X de uma jornada média de Y meses"** — barra de
   progresso temporal global do caso (dados próprios da carteira).

## B. Presença humana (números informam; pessoas acalmam)
9. ⚡ **Foto de quem fez a última atividade** ao lado do nome (mapa
   colaborador→foto na config; já temos o primeiro nome).
10. 🔨 **"Mensagem da equipe"** — campo livre POR PROCESSO que a equipe
    escreve do painel ("Oi Maria, protocolei sua réplica ontem à tarde.
    Agora aguardamos o juiz. — Luany"). O recurso mais barato e mais
    poderoso de toda esta lista.
11. 🔨 **Áudio do advogado em marcos importantes** (30-60s estilo WhatsApp):
    sentença saiu → áudio humano explicando. Voz reduz ansiedade como texto
    nenhum consegue.
12. ⚡ **"Dra. Luany cuida desta fase"** — vincular responsável→foto+OAB no
    card da fase (sem expor sobrenome se preferir).
13. 🔨 **Botão "Quero conversar"** com acolhimento: abre WhatsApp com
    mensagem pré-escrita "Oi, sou a Maria, queria entender melhor meu
    processo" — do lado do escritório, etiqueta de prioridade. Validar o
    sentimento em vez de bloqueá-lo.
14. 🏗 **Vídeos de 90s por marco da jornada** (5 vídeos, uma tarde de
    gravação): advogado explicando cada fase em linguagem humana — tocados
    direto no portal na fase correspondente.

## C. Progresso visível (transformar espera em avanço)
15. 🔨 **Datas reais nos marcos vencidos da jornada**: "Distribuição ✓
    12/03" (bi_processos_log tem as datas das mudanças de etapa).
16. ⚡ **Streak de vigilância**: "seu processo foi verificado 47 dias
    seguidos" — o contador do monitor virando segurança emocional.
17. 🔨 **Resumo do mês automático**: card "Junho no seu processo" — mesmo
    sem andamento: "verificamos 22 dias, analisamos 2 publicações, sua fase
    seguiu dentro do prazo normal". Reframing do "nada aconteceu".
18. 🔨 **Celebração de marco com confete dourado** (a lib de confetti JÁ está
    no projeto): jornada avançou → micro-festa de 2s + mensagem "Etapa
    vencida! 🎉". Memorável e compartilhável.
19. 🏗 **Tela de êxito**: processo encerrado com vitória → página
    comemorativa com a história do caso (linha do tempo completa, valores,
    agradecimento) + convite para avaliar no Google no pico da alegria.

## D. Valor do serviço tangível (justificar honorários sem falar de preço)
20. 🔨 **Horas dedicadas estimadas**: tabela de peso por tipo de tarefa →
    "nossa equipe já dedicou ~14 horas ao seu caso". Honorário vira hora
    trabalhada visível.
21. ⚡ **Bastidores do caso**: publicações lidas, prazos monitorados,
    petições elaboradas — contadores específicos do processo (os kinds do
    espelho já permitem).
22. 🔨 **Vitórias da carteira (agregado)**: "em 2026 o CBC já obteve X
    sentenças favoráveis em casos de multipropriedade" — social proof sem
    expor ninguém (bi_processos_log detecta sentenças).
23. ⚡ **Autoridade de nicho no rodapé**: "300+ casos de multipropriedade
    conduzidos · OAB/SP 55227 · desde XXXX" — números reais da carteira.
24. 🏗 **Relatório anual do caso em PDF** (dezembro): documento bonito com
    tudo que foi feito no ano — artefato físico do valor, o cliente guarda
    e mostra.
25. 🔨 **Depoimentos rotativos** de clientes (com consentimento, do NPS 9-10
    + comentário) — prova social dentro do próprio portal.
26. ⚡ **"O que você não precisou fazer"**: card ocasional — "este mês você
    não precisou ler 3 publicações em juridiquês nem contar prazos; nós
    fizemos isso por você."

## E. Controle nas mãos do cliente (autonomia reduz ansiedade)
27. 🏗 **Central de documentos**: contrato assinado, procuração, petição
    inicial, sentença — download direto (Drive já integrado ao sistema).
28. 🔨 **"Pergunte aqui"**: campo de pergunta assíncrona → vira tarefa no
    Kommo com SLA visível ("respondemos em até 1 dia útil") + resposta
    aparece no portal. Tira a pergunta do impulso da ligação.
29. 🔨 **Preferência de contato**: "como prefere ser avisado? só marcos
    importantes / toda novidade / resumo mensal" — o cliente escolhe o
    volume; o escritório aprende quem é ansioso.
30. ⚡ **Atualizar telefone/e-mail pelo portal** (gera tarefa de confirmação
    interna) — cadastro vivo sem fricção.
31. ⚡ **Extrato financeiro em PDF** com 1 toque (recibo consolidado).
32. 🔨 **Calendário de parcelas do ano** — visão anual; previsibilidade
    financeira também é anti-ansiedade.

## F. Pagamentos sem constrangimento
33. ⚡ **Aviso suave pré-vencimento**: banner "sua parcela vence em 3 dias"
    (amigável, sem vermelho) quando faltar ≤5 dias.
34. ⚡ **Comprovante por parcela paga** (download/print do histórico).
35. 🔨 **"Preciso conversar sobre meus pagamentos"** — botão sem vergonha no
    rodapé dos pagamentos, tom acolhedor → financeiro prioriza (combina com
    a régua: prevenção antes da cobrança).
36. ⚡ **Reta final celebrada**: barra de quitação ≥80% ganha mensagem
    "Falta pouco! 🎉" — terminar de pagar vira conquista, não alívio.

## G. Confiança estrutural
37. ⚡ **"Como protegemos seus dados"** — mini-página LGPD em linguagem
    humana + quem tem acesso ao link.
38. ⚡ **Carimbo de sincronização por seção** ("pagamentos atualizados hoje
    às 18h") — dado fresco percebido.
39. 🔨 **Primeira visita guiada**: na 1ª abertura, 3 tooltips ("aqui você
    acompanha a fase", "aqui ficam seus boletos", "aqui seu acordo") +
    carta de boas-vindas do escritório.
40. ⚡ **Modo família**: aviso de que o link pode ser compartilhado com
    cônjuge/filhos (multipropriedade costuma ser decisão familiar) — menos
    retrabalho de explicação para o cliente.

## H. Medir a missão (ansiedade como métrica)
41. ⚡ **Pulso pós-visita de 1 toque**: "saiu mais tranquilo(a) desta página?
    😌 / 😐 / 😟" — métrica direta da missão do portal, por fase.
42. 🔨 **IA nos comentários do NPS**: classificar temas de ansiedade
    (demora? dinheiro? falta de contato?) → backlog automático mensal.
43. 🔨 **Correlação acessos × ligações**: cruzar acessos do portal com
    atendimentos do Kommo — provar com número que o portal reduz ligação
    (e mostrar isso para a equipe comprar a ideia).
44. ⚡ **Alerta de detrator**: NPS ≤6 → notificação imediata no Monitor +
    tarefa de ligação ativa do sócio em 24h. Detrator atendido rápido vira
    promotor.

## I. Pequenos toques de classe (delight barato)
45. ⚡ **Saudação por período**: "Boa noite, Maria" em vez de "Olá" — custo
    zero, percepção de cuidado.
46. ⚡ **Aniversário**: banner discreto "Feliz aniversário, Maria! 🎂 — equipe
    CBC" (bi_clientes.nascimento já existe).
47. ⚡ **Modo escuro automático** (prefers-color-scheme) — paleta navy
    noturna já combina com a identidade.
48. 🔨 **Compartilhar marco**: "petição protocolada" com botão de
    compartilhar imagem bonita no WhatsApp — o cliente divulga o escritório
    ao comemorar.
49. ⚡ **Frase de fechamento rotativa no rodapé**: pequenas mensagens de
    confiança ("Seu caso tem nome, rosto e responsável — não é um número").
50. 🏗 **Linha de cuidado pós-êxito**: 30 dias após encerrar, mensagem "como
    você está? precisa de algo?" — fideliza e gera indicação no momento de
    gratidão.

## Top 8 (maior efeito anti-ansiedade por esforço)
1. **#3 "Verificado hoje ✓"** — 1 hora de trabalho, mata o medo de abandono
2. **#10 Mensagem da equipe por processo** — o mais humano por real investido
3. **#1 Régua de normalidade temporal** — responde "o quando" com dado próprio
4. **#4 Tratamento ativo do silêncio** — age exatamente no gatilho da ligação
5. **#15 Datas nos marcos vencidos** — progresso vira fato, não promessa
6. **#18 Confete no marco** — a lib já existe; emoção memorável de graça
7. **#44 Alerta de detrator** — transforma o NPS em ação, não em relatório
8. **#28 "Pergunte aqui" com SLA** — canaliza a ansiedade para um lugar com resposta garantida

═══════════════════════════════════════════════════════════════
# PARTE 2 — Revisão com critério ZERO trabalho extra (11/06, noite)
Decisão do Paulo: B/C/D/E/F descartados. Tudo deve nascer dos dados
que a API do ADVBOX já entrega, sem rotina nova para o time.

## A — Como parametrizar "Domar o tempo" (100% automático)
| Item | Fonte de dado (já coletada) | Cálculo automático |
|---|---|---|
| Régua de normalidade | bi_processos (process_date) + etapa atual | percentis (p25–p90) da idade dos processos que estão HOJE na mesma etapa → "processos nesta fase têm tipicamente X–Y meses" |
| Régua v2 (tempo NA fase) | bi_processos_log (começou 10/06) | em ~60-90 dias o log acumula transições reais → tempo-na-etapa exato, troca automática |
| Previsão do próximo marco | bi_processos_log transições | mediana etapa→próxima etapa, exibida em FAIXA (nunca data) |
| "Verificado hoje ✓" | bot_config.monitor_status.last_run | portal-data lê e exibe — zero novo |
| Silêncio tratado | geral.sem_novidade (já parametrizado no bot) | portar o MESMO template para o portal quando daysSince>15 |
| Recesso forense | tabela fixa no código (recesso 20/12–20/01 é lei; feriados nacionais hardcoded p/ 5 anos) | banner automático por data |
| "O que NÃO vai acontecer" | índice da jornada (0-4) | 5 textos default escritos UMA vez (pelo Claude), por marco — o time só sobrescreve SE quiser |
| Marcos fantasma | jornadaIndice já calculado | marcos seguintes em cinza com texto fixo |
| "Mês X de jornada de Y" | process_date + mediana de idade dos processos encerrados (Arquivamento) | automático da carteira |

## Mais 22 sugestões zero-esforço (dados ADVBOX/espelho + código)
51. ⚡ Saudação por período ("Boa noite, Maria") — relógio do navegador.
52. ⚡ Modo escuro automático (prefers-color-scheme) — paleta navy noturna.
53. ⚡ Aniversário automático (bi_clientes.nascimento) — banner 🎂 no dia.
54. ⚡ Confete dourado no avanço de etapa — compara índice da jornada com o
    último visto (localStorage); lib já instalada.
55. ⚡ Streak de vigilância ("verificado há 47 dias úteis seguidos") —
    derivado do monitor_status, contador sintético.
56. 🔨 Resumo do mês GERADO POR CÓDIGO ("Em junho: 4 movimentações
    acompanhadas, 2 publicações analisadas, fase dentro do prazo normal") —
    counts do bot_sync_state por mês; texto montado por template fixo.
57. 🔨 Vitórias agregadas automáticas: regex de sentença/acordo/êxito nos
    títulos de movimentos do mês → "X resultados favoráveis na carteira em
    junho" (agregado, sem expor casos).
58. ⚡ Autoridade por números do espelho no rodapé: "Acompanhamos N processos
    ativos · M tarefas concluídas em 2026" — contadores reais.
59. 🔨 "Publicações analisadas no seu caso": as tarefas OCULTAS (publicação
    tratada/comentário) viram contador agregado anônimo — trabalho invisível
    finalmente visível, sem revelar conteúdo.
60. 🔨 Horas dedicadas com PESOS DEFAULT embutidos (petição 2h, audiência 3h,
    publicação 15min...) — heurística pronta, refinável depois, zero rotina.
61. 🔨 "Concluímos tarefas em média X dias antes do prazo" — payload.deadline
    × completed_at quando existirem (prova estatística do selo de prazo).
62. 🔨 Próxima audiência/perícia automática: task_created com título de
    audiência e data futura → card de destaque com data.
63. 🔨 Glossário-tooltip na timeline: os 43 termos do glossário do bot
    sublinhados com explicação no toque — reuso direto.
64. 🔨 "Entenda esta fase": 5 textos educativos default por marco da jornada
    (escritos uma vez) exibidos em accordion — sobrescrever é opcional.
65. 🔨 Mini-FAQ por marco (3 perguntas/respostas default por fase, fixas).
66. ⚡ Pulso de 1 toque pós-visita ("saiu mais tranquilo? 😌😐😟") → grava
    junto do NPS; ninguém precisa operar nada.
67. ⚡ Alerta de detrator automático: NPS ≤6 → nota no lead Kommo + log no
    Monitor (o atendimento que JÁ aconteceria, só que antes da reclamação).
68. ⚡ Frases de confiança rotativas no rodapé (fixas no código).
69. ⚡ Carta de boas-vindas no 1º acesso (texto fixo, localStorage).
70. ⚡ Carimbo de sincronização por seção (timestamps que já existem).
71. ⚡ Indicador "monitoramento ativo" (ponto verde pulsando + última
    verificação) — tecnologia como autoridade.
72. ⚡ Count-up nos contadores (números sobem de 0 ao valor em 600ms) —
    percepção de sistema vivo.

## UI — tranquilidade e autoridade (12 mudanças concretas)
73. **Inverter a hierarquia emocional do card da fase**: hoje "RÉPLICA
    PROTOCOLADA" grita em serif 27px — termo técnico assusta. Promover uma
    LINHA DE STATUS HUMANA calculada ("Tudo caminhando bem ✓", verde, serif
    grande) e rebaixar o nome técnico a subtítulo discreto.
74. **Suavizar o vermelho de VENCIDO** nos pagamentos: tom terroso + microcopy
    acolhedor ("em atraso — podemos ajudar?") — vermelho puro envergonha e
    o cliente envergonhado some.
75. **Banner "verificado hoje ✓" fixo no topo** — o elemento de tranquilidade
    mais importante deve ser o primeiro pixel visível.
76. **Botão A+/A− de tamanho de letra** — público 45-70 anos; controle simples
    no canto, gigante em acessibilidade percebida.
77. **Crossfade de 200ms entre abas** — troca seca parece sistema frágil;
    transição suave parece produto premium.
78. **Filete duplo dourado no selo CBC** + OAB visível no cabeçalho (não só
    rodapé) — heráldica discreta = autoridade tradicional.
79. **Voz editorial única**: padronizar microcopy em "nós cuidamos / você não
    precisa fazer nada" e trocar "processo" por "seu caso" nos títulos.
80. **Divisores linha-ouro entre seções** — cadência de leitura calma
    (o olho descansa entre blocos).
81. **Números tabulares com count-up** nos contadores de valor (já são
    tabulares; falta a animação).
82. **Fotos da equipe em duotone navy** (filtro CSS) — coesão visual e tom
    institucional sem produção de foto profissional.
83. **Estados vazios sempre com próximo passo** ("ainda sem audiência — quando
    houver, aparece aqui e te avisamos") — nunca beco sem saída.
84. **Modo escuro navy-noturno** — além de conforto, escuro+dourado = luxo.

## Ordem sugerida de implementação (tudo zero-esforço p/ o time)
1. Banner "verificado hoje ✓" (#75/A3) + carimbos de seção (#70)
2. Hierarquia emocional do card da fase (#73) + status humano calculado
3. Régua de normalidade automática (A1) + "o que não vai acontecer" default (A6)
4. Silêncio tratado + recesso (A4/A5)
5. Confete de marco (#54) + datas nos marcos (A/15 da parte 1)
6. Educação por fase + glossário-tooltip (#63/64)
7. Pulso 😌 + alerta de detrator (#66/67)
8. A+/A−, dark mode, crossfade, count-up (#76/52/77/72)

═══════════════════════════════════════════════════════════════
# PARTE 3 — Novas sugestões (11/06, noite) — ansiedade ↓ + tempo do escritório ↑
Critério mantido: zero rotina nova para o time; tudo nasce dos dados/motores
que já existem. ★ = aposta alta.

## A. Autoatendimento inteligente (a pergunta morre no portal)
85. 🏗★ **O bot DENTRO do portal**: campo "Tire sua dúvida" que usa o MESMO
    motor do WhatsApp (intents + glossário + extrato + templates) — o cérebro
    já existe e já está parametrizado; o portal vira o segundo canal. A
    pergunta que viraria ligação morre na página, com resposta na hora.
86. 🔨 **"Perguntas de outros clientes"**: as perguntas mais frequentes do bot
    (bot_messages agrupa sozinho) viram FAQ viva no portal — respondida uma
    vez, lida por mil.
87. 🔨★ **Tradução por IA na timeline do portal**: andamentos que o glossário
    não cobre passam pelo MESMO aiTranslate com cache do bot (custo: centavos,
    1× por texto). Cliente que entende não pergunta. Só falta a
    ANTHROPIC_API_KEY no Netlify.
88. ⚡ **Baixar resumo do caso em PDF** (gerado no navegador do cliente):
    fase, jornada, linha do tempo, pagamentos — mata o "me manda um resumo
    por escrito" que consome a equipe.
89. ⚡ **Busca na linha do tempo** (filtrar andamentos por palavra) — casos
    longos com 100+ eventos ficam navegáveis sem pedir ajuda.
90. ⚡ **Horário de atendimento com status ao vivo** ("Aberto agora · até
    17h") — evita ligação/mensagem fora de hora e a frustração de não ser
    respondido.

## B. Antecipação e transparência (a raiz da ansiedade)
91. 🔨★ **"De quem é a vez"**: regex no último andamento decide — petição
    protocolada/juntada → "⏳ Aguardando o tribunal há X dias"; intimação/
    despacho recebido → "🖋 Com a nossa equipe". A demora ganha um culpado
    visível (quase sempre o tribunal) e o cliente para de achar que é
    abandono. 100% automático.
92. 🔨★ **"Precisamos de você" dinâmico**: hoje o "você não precisa fazer
    nada" é fixo; detectar por regex tarefas pendentes que envolvem o cliente
    (ex.: AGUARDANDO DOCUMENTO/ASSINATURA DO CLIENTE) e trocar a faixa verde
    por uma dourada com a instrução. O portal passa a ser confiável nos dois
    sentidos — e a equipe para de cobrar documento por telefone.
93. 🔨 **"Você não está sozinho"**: "acompanhamos N casos do mesmo tipo que o
    seu" (count por tipo/resort na carteira) — pertencimento acalma, sem
    prometer resultado (cuidado ético: nunca % de êxito como promessa).
94. ⚡ **Próximo marco com expectativa honesta**: sob a jornada, "próximo
    marco: Sentença — sem data marcada; é a fila do tribunal, e avisamos no
    momento em que sair".
95. 🔨 **Mapa de constância** (estilo GitHub): mini-calendário do ano com um
    quadradinho dourado em cada dia que houve atividade no caso — prova
    visual de que nunca houve abandono, dados já no espelho.

## C. Retorno e engajamento (o portal que chama de volta)
96. 🔨★ **"O que mudou desde sua última visita"**: localStorage guarda o
    último acesso → badge "2 novidades desde a sua última visita" + eventos
    novos destacados em dourado na timeline. Recompensa o retorno e
    substitui a checagem por telefone.
97. 🏗★ **Notificações push do PWA**: "novidade no seu caso — toque para
    ver" disparada pelo monitor (web push gratuito, sem app store). O cliente
    para de checar compulsivamente E de ligar — o portal avisa. Projeto de
    uma sessão (service worker + VAPID + opt-in).
98. ⚡ **Hint de instalação na 1ª visita**: "adicione à tela inicial" com
    seta para o menu do navegador — link nunca mais se perde (e "perdi o
    link" é atendimento que a equipe faz hoje).
99. ⚡ **"Perdeu o link?"** na tela de acesso inválido: botão wa.me direto
    para o escritório com mensagem pronta — transforma erro em atendimento
    de 10 segundos.
100. ⚡ **Compartilhar com a família**: botão que envia o link do portal por
     WhatsApp para cônjuge/filhos — multipropriedade é decisão familiar; cada
     familiar informado é uma ligação a menos.

## D. Conforto e história
101. ⚡★ **"Ouvir resumo" (voz)**: botão ▶ que lê em voz alta a situação do
     caso (speechSynthesis nativo do celular, custo zero) — público 50-70
     anos adora; acessibilidade real.
102. 🔨★ **"Sua história até aqui" por IA**: narrativa de 4-5 linhas do caso
     inteiro ("Você nos procurou em maio/2025... hoje aguardamos a citação"),
     gerada 1× por mudança de fase com cache. Transforma dados em história —
     e história acalma mais que status.
103. ⚡ **Modo offline do PWA**: guardar o último payload no localStorage e
     exibi-lo sem internet com aviso "dados da sua última visita" — o portal
     nunca "quebra" na frente do cliente.
104. ⚡ **Frases de confiança rotativas** no rodapé (pendente da Parte 2).

## E. Backlog anterior que segue valendo (não implementado ainda)
- Régua de normalidade temporal + "mês X de Y" (A1/A8) — o anti-"quando?" definitivo
- Datas reais nos marcos vencidos da jornada (15)
- Confete dourado no avanço de etapa (54) — lib já instalada
- Card ativo de silêncio >15 dias no portal (A4)
- Pulso 😌/😐/😟 pós-visita (66) e alerta de detrator NPS≤6 → nota no Kommo (67)
- Aniversário do cliente (53) e carta de boas-vindas no 1º acesso (69)
- IA classificando temas dos comentários do NPS (backlog de melhoria automático)

## Top 8 desta rodada (impacto ÷ esforço)
1. **#91 "De quem é a vez"** — transfere a culpa da demora para onde ela mora
2. **#96 "O que mudou desde sua última visita"** — retorno recompensado, telefone esquecido
3. **#92 "Precisamos de você" dinâmico** — o portal vira canal de cobrança de documento (libera a equipe)
4. **#85 Bot dentro do portal** — um cérebro, dois canais, zero parametrização extra
5. **#102 História do caso por IA** — o upgrade emocional mais barato que existe
6. **#101 Ouvir resumo** — uma tarde de código, diferencial enorme para o público 50+
7. **#87 Tradução IA na timeline** — compreensão total = menos perguntas
8. **#97 Push do PWA** — o fim definitivo da checagem ansiosa (projeto maior)
