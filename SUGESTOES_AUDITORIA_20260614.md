# CBC Contratos — Auditoria de Melhorias e Otimizações

> Auditoria multi-agente de 14/06/2026. **251 sugestões** em **15 dimensões**, cada agente lendo o código real (não o CLAUDE.md). Formato de cada item: `(impacto / esforço / risco)`.

## Índice
- **Performance — Frontend** (15)
- **Performance — Backend & Banco** (16)
- **Segurança** (18)
- **UX & Fluxos** (20)
- **Mobile** (14)
- **Integridade de Dados & Regras de Negócio** (15)
- **Qualidade de Código & Dívida Técnica** (17)
- **Observabilidade & Confiabilidade** (15)
- **Resiliência das Integrações** (19)
- **Acessibilidade** (14)
- **Custo & Infraestrutura** (16)
- **Arquitetura & Alto Nível** (16)
- **Dashboard, Relatórios & BI** (17)
- **Portal do Cliente & Bot WhatsApp** (20)
- **Testes & CI/CD** (19)

## Performance — Frontend

### 1. Lista de contratos cresce sem limite no DOM (react-window importado mas nunca usado)
`alto / medio / medio`

**O que é:** Na aba 'Contratos', a lista importa a biblioteca de virtualizacao 'react-window' (FixedSizeList) no topo do arquivo, mas NUNCA a usa: o codigo de fato renderiza 'contratos.map(...)' criando um cartao de verdade no navegador para cada contrato (ContratosTab.jsx linha 1560). Como a tela carrega de 50 em 50 com botao 'carregar mais', depois de algumas paginas o navegador esta segurando 200, 300, 500 cartoes completos na memoria ao mesmo tempo. Resultado: rolagem travada, digitar na busca fica lento e o celular esquenta. A correcao e usar de verdade o FixedSizeList que ja esta importado (ou remover o import morto e virtualizar), renderizando so as ~15 linhas visiveis na tela.

**Ganho:** Rolagem fluida e busca instantanea mesmo com centenas de contratos carregados; menos memoria e bateria no celular

**Onde:** client/src/components/ContratosTab.jsx (import linha 2, render linha 1560)

### 2. Cada linha da lista de contratos nao e um componente memoizado
`medio / medio / baixo`

**O que é:** Ainda na aba 'Contratos', cada linha da lista e escrita inline dentro do 'map' (um bloco enorme de JSX por contrato). Hoje, qualquer mudancinha de estado na tela (abrir um detalhe, marcar um checkbox de selecao, chegar um evento em tempo real) faz o React re-desenhar TODAS as linhas, mesmo as que nao mudaram. Extraindo a linha para um componente proprio embrulhado em React.memo (igual ja foi feito certo no AsaasPanel e no CardsView), so a linha que realmente mudou e re-desenhada. Isso e o complemento natural da virtualizacao acima.

**Ganho:** Marcar/selecionar e abrir detalhes fica instantaneo; some o engasgo quando chega atualizacao em tempo real

**Onde:** client/src/components/ContratosTab.jsx (bloco do contratos.map, ~linha 1560-1760)

### 3. Preview do contrato gera um PDF inteiro a cada 0,7s enquanto se digita (no desktop)
`alto / medio / medio`

**O que é:** No formulario de novo contrato (desktop), o preview ao lado e um PDF real gerado por html2canvas + jsPDF. Esse processo 'tira uma foto' do contrato inteiro e monta o PDF na thread principal do navegador — exatamente a thread que tambem responde ao teclado. A cada pausa de 0,7s na digitacao isso roda de novo, do zero (LivePreview.jsx linha 130). Em maquinas mais fracas da equipe, da pra sentir a digitacao 'engasgando'. No celular ja foi resolvido (mostra HTML leve em vez de PDF). A sugestao e fazer o mesmo no desktop: mostrar o HTML do contrato (que ja existe e e usado no mobile) durante a digitacao, e so gerar o PDF de verdade quando o usuario clicar para baixar/enviar. Alternativa menos radical: aumentar o debounce de 700ms para ~1200ms e so regenerar quando o campo perde o foco.

**Ganho:** Digitar o contrato fica leve e sem travadas, principalmente em notebooks mais simples; economia grande de CPU

**Onde:** client/src/components/LivePreview.jsx (geracao PDF linhas 108-139)

### 4. O formulario inteiro (e o preview) re-renderiza ao digitar em qualquer campo de um contratante
`medio / medio / baixo`

**O que é:** O bloco de cada contratante (ContratanteForm, FormPanel.jsx linha 303) e um componente comum, sem React.memo. Como ele recebe funcoes e objetos novos a cada render do FormPanel, digitar uma letra em 'nome' re-desenha o formulario todo, incluindo o segundo contratante e recalcula o progresso. Combinado com o item do PDF acima, cada tecla custa caro. Embrulhar ContratanteForm em React.memo e estabilizar os callbacks (useCallback) corta esse trabalho pela metade quando ha 2 contratantes.

**Ganho:** Formulario responde na hora ao digitar, especialmente com 2 contratantes; menos trabalho desperdicado por tecla

**Onde:** client/src/components/FormPanel.jsx (ContratanteForm linha 303 e seus handlers)

### 5. Busca global (Cmd+K) carrega a biblioteca fuse.js no carregamento inicial do app
`medio / baixo / baixo`

**O que é:** O componente da busca global (GlobalSearch) e importado de forma fixa no topo do App.jsx (linha 10) e ele importa a biblioteca de busca difusa 'fuse.js' tambem de forma fixa (GlobalSearch.jsx linha 2). Ou seja, fuse.js entra no pacote que TODO usuario baixa ao abrir o sistema, mesmo quem nunca aperta Cmd+K. Trocando o import de GlobalSearch por lazy/dynamic (so carrega quando a busca abre), o app inicial fica menor e abre mais rapido — exatamente o padrao que ja e usado para Dashboard, Asaas, etc.

**Ganho:** App abre mais rapido e baixa menos dados na primeira visita; menos consumo de banda Netlify

**Onde:** client/src/App.jsx (import linha 10) + client/src/components/GlobalSearch.jsx

### 6. Modal de novidades (ChangeLog) e seu historico viajam no pacote inicial
`medio / baixo / baixo`

**O que é:** O App.jsx importa de forma fixa o ChangeLog.jsx (550 linhas) junto com a lista completa de todas as versoes (constante VERSIONS), o NotificationCenter, o ActivityFeed e varios modais (App.jsx linhas 84, 102-104). Sao telas que o usuario abre raramente (ou nunca), mas o codigo delas e baixado e processado por todo mundo na abertura. Tornar esses modais 'lazy' (carregar so quando abrem) reduz o tempo ate o app ficar utilizavel.

**Ganho:** Primeira tela aparece mais rapido; menos JavaScript para o navegador processar no inicio

**Onde:** client/src/App.jsx (imports linhas 84, 102-104 — ChangeLog, NotificationCenter, ActivityFeed, NotificationPrefsModal)

### 7. Dashboard e Dashboard Socios baixam a tabela inteira de contratos sem limite
`medio / medio / medio`

**O que é:** Tanto o Dashboard (Dashboard.jsx linha 114-116) quanto o Dashboard dos Socios (SociosDashboard.jsx linha 1483-1486) fazem um SELECT da tabela 'contratos' SEM nenhum '.range()' ou '.limit()' — ou seja, trazem TODAS as linhas existentes de uma vez. Hoje funciona porque o escritorio tem poucos milhares, mas isso cresce indefinidamente: a cada novo contrato a tela fica um pouco mais pesada para abrir e para recalcular. Como a maioria dos numeros do Dashboard ja e filtrada por periodo, da pra buscar so a janela relevante (ex.: ultimos 12-18 meses) com filtro de data no servidor, e oferecer 'carregar historico completo' sob demanda.

**Ganho:** Dashboards continuam abrindo rapido mesmo daqui a 2-3 anos; menos dados trafegados e menos calculo no navegador

**Onde:** client/src/components/Dashboard.jsx (linha 114) e client/src/components/SociosDashboard.jsx (linha 1483)

### 8. Fonte do Google (Cormorant + Lato) bloqueia a primeira pintura da tela
`medio / baixo / baixo`

**O que é:** No index.html, as fontes do Google sao carregadas por um <link rel="stylesheet"> normal (linha 21). Esse tipo de link e 'bloqueante': o navegador espera baixar o CSS das fontes antes de mostrar a tela, o que adia o primeiro desenho — sentido como uma pausa em branco no inicio, principalmente em conexao de celular. Trocar para carregamento nao-bloqueante (tecnica media=print/onload, ou preload da fonte com display=swap, ou auto-hospedar as fontes) faz a interface aparecer antes e as fontes 'chegarem' logo em seguida.

**Ganho:** Tela aparece visivelmente mais rapido na abertura, com menos espera em branco no celular

**Onde:** client/index.html (link de fontes, linha 21)

### 9. Logos e favicon servidos em PNG pesado em vez do WebP que ja existe
`baixo / baixo / baixo`

**O que é:** Ja existem versoes WebP (bem menores) de todos os logos e do favicon na pasta public (logo-navy.webp ~12KB vs logo-navy.png ~20KB), mas varios pontos ainda apontam para o PNG: o favicon no index.html (linhas 5-6) usa favicon.png, o BoletosPanel busca '/logo-white.png' (linha 294) para o relatorio. A tela de login ja faz certo (usa <picture> com webp + fallback). Padronizar para WebP com fallback nos pontos restantes economiza banda em cada carregamento.

**Ganho:** Carrega menos bytes de imagem em toda visita; favicon e logos aparecem mais rapido

**Onde:** client/index.html (linhas 5-6) e client/src/components/BoletosPanel.jsx (linha 294)

### 10. Detalhe de venda recarrega documentos com SELECT '*' por contrato (consulta pesada repetida)
`baixo / baixo / baixo`

**O que é:** No painel 'Minhas Vendas', ao recarregar a documentacao de um contrato no drawer, faz-se 'vendas_documentos_enviados.select("*")' filtrado por contrato (VendasPanel.jsx linha 2071). Varios pontos do app ainda usam select('*') que traz todas as colunas, inclusive as que a tela nem mostra. Listar so as colunas usadas (id, tipo, status, data, url...) reduz o tamanho da resposta e a memoria. Vale a mesma revisao para os varios select('*') do VendasPanel e do SociosDashboard.

**Ganho:** Abas de Vendas e Socios respondem mais rapido e gastam menos dados; menos memoria no navegador

**Onde:** client/src/components/VendasPanel.jsx (linha 2071 e outros select('*')) e SociosDashboard.jsx

### 11. Lista de clientes em Boletos nao e virtualizada (renderiza todos os cartoes)
`medio / medio / baixo`

**O que é:** Na aba 'Boletos', a lista de clientes usa 'filteredCustomers.map(...)' renderizando um ClientCard de verdade para cada cliente (BoletosPanel.jsx linha 1247). O ClientCard ja esta memoizado (otimo), mas se o escritorio tem muitos clientes com boletos, ainda assim sao centenas de cartoes no DOM ao mesmo tempo. Como a aba Asaas ja usa FixedSizeList com sucesso, da pra aplicar a mesma virtualizacao aqui para renderizar so o que esta na tela.

**Ganho:** Aba Boletos abre e rola suave mesmo com muitos clientes; menos memoria

**Onde:** client/src/components/BoletosPanel.jsx (filteredCustomers.map, linha 1247)

### 12. Dashboard recalcula tudo a cada evento em tempo real, sem agrupar (debounce)
`medio / baixo / baixo`

**O que é:** O Dashboard escuta mudancas em tempo real na tabela 'contratos' (Dashboard.jsx linha 137-153) e a cada evento atualiza o estado, o que dispara o recalculo pesado de todos os KPIs/funil/heatmaps via computeDashboard (linha 157). Em momentos de pico (ex.: varias assinaturas/automacoes acontecendo juntas, ou um sync em massa), isso pode disparar muitos recalculos seguidos e travar a tela por instantes. Agrupar os eventos com um pequeno debounce (ex.: recalcular no maximo 1x a cada 1-2s) elimina o efeito 'metralhadora' sem perder a sensacao de tempo real.

**Ganho:** Dashboard nao trava em momentos de muitos updates simultaneos; calculo pesado roda menos vezes

**Onde:** client/src/components/Dashboard.jsx (realtime linha 137 + computeDashboard linha 157)

### 13. Cada contratante recalcula o HTML completo do contrato a cada tecla (preview)
`baixo / medio / baixo`

**O que é:** O LivePreview monta o HTML inteiro do contrato com useMemo dependente de 'data' (LivePreview.jsx linha 92). Como o objeto 'data' inteiro muda a cada tecla, o HTML completo (que inclui todas as clausulas, partes, honorarios) e reconstruido a cada digito antes mesmo de virar PDF/iframe. Para contratos longos isso e trabalho repetido. Vale memoizar partes estaveis do HTML (cabecalho, clausulas que nao dependem do campo sendo digitado) ou so reconstruir quando os campos relevantes mudam, reduzindo o custo por tecla.

**Ganho:** Menos processamento por tecla no formulario, complementando a troca PDF->HTML no desktop

**Onde:** client/src/components/LivePreview.jsx (linha 92) + client/src/utils/contractHtml.js

### 14. Tela de login carrega FormPanel, ContratosTab e LivePreview antes de logar
`medio / medio / medio`

**O que é:** O App.jsx importa de forma fixa (nao-lazy) os componentes pesados FormPanel (~1800 linhas), ContratosTab (~2000 linhas) e LivePreview (App.jsx linhas 6-9). Isso significa que o usuario baixa e o navegador processa esse codigo todo MESMO na tela de login, antes de ter acesso a qualquer aba. Como sao componentes grandes e ja existe o padrao lazy para as outras abas, transformar Novo/Contratos em lazy (ou ao menos adiar para depois do login) acelera a primeira tela, que para a maioria e o login.

**Ganho:** Tela de login e o primeiro acesso ficam visivelmente mais rapidos; menos JS processado por quem ainda nem entrou

**Onde:** client/src/App.jsx (imports fixos linhas 6-9: FormPanel, LivePreview, ContratosTab)

### 15. Detalhe expandido na lista de Boletos filtra/ordena boletos do cliente a cada render
`baixo / baixo / baixo`

**O que é:** Ao expandir um cliente em Boletos, o codigo filtra e ordena os boletos daquele cliente inline dentro do JSX (BoletosPanel.jsx linha 640: 'boletos.filter(...)' e em seguida ordenacoes). Esse filtro/ordenacao roda toda vez que o componente re-renderiza, mesmo sem mudar nada. Envolver esses calculos em useMemo (dependendo do cliente e do filtro) evita refazer o trabalho a cada re-render, util quando um cliente tem muitos boletos.

**Ganho:** Expandir clientes com muitos boletos fica mais rapido e estavel

**Onde:** client/src/components/BoletosPanel.jsx (linha 640, filtro/ordenacao inline no detalhe)

## Performance — Backend & Banco

### 1. datajud-refresh: 1 chamada ao ADVBOX por contrato, todo dia, mesmo nos já resolvidos
`alto / medio / medio`

**O que é:** A rotina diária que descobre quando um processo foi distribuído (datajud-refresh.mjs) busca TODOS os contratos assinados (até 500) e, para CADA um, faz uma chamada ao ADVBOX para pegar o detalhe do processo — INCLUSIVE para os contratos que JÁ têm a data de distribuição preenchida (esses só atualizam um campo e seguem). Hoje são ~148 ativos, mas isso cresce sem parar: a cada novo contrato assinado a rotina fica mais lenta e gasta mais cota da API ADVBOX (que tem limite). O que melhora: filtrar no banco para só processar quem realmente falta resolver (peticao_distribuida_em IS NULL) e, para os já resolvidos que só precisam de signed_at/fase, fazer uma passada separada e enxuta. Resultado: a rotina fica rápida e estável mesmo com milhares de contratos.

**Ganho:** Rotina diária deixa de crescer linearmente; menos consumo da cota da API ADVBOX e menor risco de bater no rate limit (429) junto com as outras integrações

**Onde:** client/netlify/functions/datajud-refresh.mjs (função run, linha ~127 em diante: o loop chama advboxLawsuit por linha mesmo quando row.peticao_distribuida_em já existe)

### 2. Monitor do Bot grava andamento por andamento (deveria gravar em lote)
`alto / alto / medio`

**O que é:** Quando o monitor do ADVBOX roda (2x/dia), ele percorre milhares de andamentos e tarefas e, para CADA item, faz uma gravação individual no banco para checar se é novidade (função recordSyncItem). A tabela já tem quase 77 mil linhas; a cada rodada são milhares de idas-e-voltas ao banco em sequência, o que deixa a rotina lenta e perto do limite de tempo (15 min). O detalhe: o próprio código JÁ TEM uma função de gravação em lote pronta (bulkRecordSyncItems, usada no backfill), mas o monitor não a usa nos loops principais. O que melhora: juntar os itens de cada página e gravar de uma vez (em lotes), reduzindo milhares de chamadas para dezenas. A lógica de 'só posta nota no Kommo para o que é novo' continua, comparando o que voltou como inserido de fato.

**Ganho:** Rotina do monitor termina muito mais rápido e com folga de tempo; menos carga no banco compartilhado

**Onde:** client/netlify/functions/advbox-monitor-worker-background.mjs (3 loops com recordSyncItem item a item) + reutilizar bulkRecordSyncItems de _lib/botDb.mjs

### 3. Faltam índices em chaves estrangeiras de Vendas, Portal e comentários (confirmado pelo Supabase)
`medio / baixo / baixo`

**O que é:** O próprio painel de saúde do banco (advisor de performance do Supabase, consultado agora ao vivo) aponta várias tabelas do sistema sem índice nas colunas de ligação entre tabelas: vendas_comissoes_detalhe (comissao_id e contrato_id), vendas_documentos_enviados (contrato_id), user_views (user_id), user_reminders (contrato_id), portal_access_log (token_id) e contrato_comentarios (user_id). Sem esses índices, toda vez que o sistema cruza essas tabelas (abrir uma comissão e seus detalhes, listar documentos de um contrato, abrir os comentários de um contrato) o banco varre a tabela inteira. Hoje passa porque o volume é pequeno, mas o painel de comissões já insere centenas de linhas por mês. O que melhora: criar esses índices (comando rápido, sem downtime) faz essas telas responderem instantaneamente conforme os dados crescem.

**Ganho:** Telas de Comissões, Documentos de Vendas e Comentários ficam rápidas e param de degradar com o crescimento

**Onde:** Banco Supabase (migration nova): índices em vendas_comissoes_detalhe(comissao_id), vendas_comissoes_detalhe(contrato_id), vendas_documentos_enviados(contrato_id), user_views(user_id), user_reminders(contrato_id), portal_access_log(token_id), contrato_comentarios(user_id)

### 4. Cada abertura do Portal do Cliente faz uma varredura de 18 mil linhas para contar tarefas do mês
`medio / baixo / baixo`

**O que é:** Toda vez que um cliente abre o Portal, o sistema conta quantas tarefas a equipe concluiu no mês (para mostrar 'a equipe trabalhou X tarefas'). Medi essa consulta ao vivo: ela percorre 18.307 linhas e descarta 15.995 para chegar no número, porque a tabela de eventos (bot_sync_state) não tem um índice que combine 'tipo do evento' com 'data'. Isso pesa em CADA acesso do portal. O que melhora: criar um índice por (kind, event_date) transforma essa varredura num pulo direto para o mês corrente. A consulta cai de ~17 ms percorrendo milhares de linhas para praticamente instantânea, e a tabela tem quase 77 mil linhas hoje (só vai crescer).

**Ganho:** Portal do Cliente abre mais rápido e a consulta não piora com o crescimento da tabela de eventos

**Onde:** Banco: índice composto em bot_sync_state(kind, event_date) — consulta em client/netlify/functions/portal-data.mjs linha ~247 (contagem de task_completed do mês)

### 5. Calculadora de comissões consulta o banco várias vezes por vendedora, em série
`medio / medio / baixo`

**O que é:** A rotina mensal de comissões (commission-calculator.mjs) percorre cada dupla vendedora+assistente UMA POR VEZ e, para cada uma, faz duas consultas ao banco (contratos elegíveis + guias de custas) esperando uma terminar para começar a outra. Com poucas vendedoras isso é tolerável, mas é trabalho serial desnecessário: dá para buscar TODOS os contratos do período de uma vez (uma consulta), todas as guias de uma vez (uma consulta) e depois separar por vendedora em memória. O que melhora: a rotina passa de 'N×2 consultas em fila' para '2 consultas grandes', terminando muito mais rápido e com menos pressão no banco no dia 20 de cada mês.

**Ganho:** Fechamento de comissões roda em segundos em vez de proporcional ao número de vendedoras; menos chamadas ao banco

**Onde:** client/netlify/functions/commission-calculator.mjs (loop em duplas -> calculateDupla -> loadContratosElegiveis faz query por dupla, linhas ~199-235 e ~523-525)

### 6. advbox-sync baixa a lista INTEIRA de clientes do ADVBOX quando há CPF duplicado
`medio / baixo / baixo`

**O que é:** Na hora de criar um cliente no ADVBOX após a assinatura, se o CPF já existir, o código (advbox-sync.mjs, função findCustomerByCPF) baixa a lista COMPLETA de clientes do ADVBOX e procura o CPF na mão — em vez de pedir só aquele CPF. Isso é lento e gasta cota da API à toa. O detalhe curioso: a biblioteca compartilhada do bot (_lib/advbox.mjs) JÁ tem a versão certa, que pergunta direto pelo CPF (?identification=...). Ou seja, basta usar a função correta que já existe. O que melhora: a busca por CPF vira instantânea e não depende do tamanho da base de clientes do escritório.

**Ganho:** Criação de cliente/processo após assinatura mais rápida e sem baixar listões; menos risco de timeout e de bater o rate limit do ADVBOX

**Onde:** client/netlify/functions/advbox-sync.mjs (findCustomerByCPF na linha ~108 faz GET /customers sem filtro) — substituir pelo filtro ?identification= já usado em _lib/advbox.mjs linha ~90

### 7. Régua de cobrança reconstrói o mapa de clientes a cada faixa (D+1/D+7/D+15)
`medio / baixo / baixo`

**O que é:** A rotina de cobrança (cobranca-regua.mjs) precisa saber, para cada boleto vencido, qual é o lead no Kommo daquele cliente. Para isso ela baixa TODOS os contratos não arquivados (com o JSON dos contratantes) e monta um mapa CPF→lead. O problema: isso está DENTRO do laço das faixas de cobrança, então o mesmo listão de contratos é baixado e processado até 3 vezes na mesma execução. Além disso, ela consulta o banco uma vez POR boleto para ver se já cobrou. O que melhora: montar o mapa de clientes UMA vez antes do laço, e checar 'já cobrados' de uma vez só (uma consulta para todos os boletos da faixa). Resultado: menos leitura repetida do banco e rotina mais leve.

**Ganho:** Rotina de cobrança lê os contratos uma vez só (não 3) e faz menos consultas; mais rápida e mais barata em banco

**Onde:** client/netlify/functions/cobranca-regua.mjs (o SELECT de contratos + montagem de leadPorCpf está dentro do for de etapas, linhas ~63-84; checagem de cobranca_regua por boleto na linha ~90)

### 8. Sincronização diária de clientes do Asaas baixa TODOS de novo (sem incremental) e fora de função background
`medio / medio / medio`

**O que é:** Todo dia às 6h a rotina asaas-sync-customers.mjs baixa e regrava TODOS os clientes do Asaas, do zero, em sequência (até 20 mil em blocos de 100), mesmo que quase nenhum tenha mudado. Pior: ela roda como função normal (não 'background'), que tem teto de tempo menor — se a base crescer, ela pode estourar o tempo e travar o espelho. O que melhora: (a) transformar em incremental, baixando só quem mudou desde a última sincronização (ou usando filtro de data), e (b) rodar como função background encadeada como já é feito no sync de boletos. Resultado: sincronização muito mais curta e sem risco de estourar o tempo.

**Ganho:** Sync de clientes Asaas fica curto e seguro; some o risco de travar conforme a base cresce

**Onde:** client/netlify/functions/asaas-sync-customers.mjs (runFullSync faz varredura completa serial; é função agendada comum, não background) — espelhar o padrão de asaas-sync-boletos-background.mjs

### 9. Endpoint do Power BI baixa todos os contratos e soma no JavaScript em vez de pedir o resumo ao banco
`baixo / medio / baixo`

**O que é:** A função api-powerbi.mjs, quando pedem 'dashboard', baixa TODOS os contratos do banco (todas as linhas) e calcula os totais por status/resort/mês/usuário/origem em JavaScript. O banco faria essas somas muito mais rápido e devolvendo só o resultado (poucas linhas) em vez de trafegar a tabela inteira. O sistema já tem cache de 5 min nesse endpoint, o que ajuda, mas a cada recálculo ainda puxa tudo. O que melhora: criar uma view de agregação no banco (GROUP BY) e fazer o endpoint só ler dela — menos dados trafegados e resposta mais rápida, sobretudo conforme o número de contratos cresce.

**Ganho:** Relatórios Power BI respondem mais rápido e trafegam muito menos dados; menos carga no banco a cada atualização

**Onde:** client/netlify/functions/api-powerbi.mjs (branch table==='dashboard', linhas ~82-111: select de todos os contratos + agregação em JS)

### 10. Snapshot de BI carrega a carteira inteira na memória e roda 3 sincronizações grandes em fila
`baixo / alto / medio`

**O que é:** A rotina que espelha os cadastros do ADVBOX para o BI (advbox-snapshot-worker-background.mjs) faz três coisas grandes uma após a outra: processos, clientes e financeiro — cada uma percorrendo páginas da API até esgotar, sempre em série. Além disso, para detectar mudanças de fase, ela carrega a tabela bi_processos INTEIRA na memória no começo. Hoje funciona (3 mil processos), mas é o tipo de coisa que vai apertando. O que melhora: (a) em vez de baixar a tabela toda, comparar via banco/upsert que retorna o que mudou, e (b) confirmar que o cap de páginas (MAX_PAGES=100) está dimensionado para o volume real para não cortar dados silenciosamente. É uma otimização preventiva, de baixa urgência, mas vale registrar.

**Ganho:** Snapshot de BI fica com pegada de memória menor e mais previsível conforme a carteira cresce

**Onde:** client/netlify/functions/advbox-snapshot-worker-background.mjs (carrega bi_processos inteira em 'prev' na linha ~67; 3 blocos seriais de paginação)

### 11. Portal do Cliente busca o cliente por 'nome contém' numa tabela sem índice de texto
`baixo / baixo / baixo`

**O que é:** O Portal do Cliente acha os processos do cliente procurando 'clientes CONTÉM <nome>' na tabela bi_processos. Medi ao vivo: como não há índice de texto nessa coluna, o banco varre a tabela. Hoje é rápido porque são só 3.185 processos e a busca para nos 8 primeiros, mas para um nome raro o banco varre tudo, e a tabela cresce a cada novo processo. O que melhora: criar um índice de texto (trigram/GIN) na coluna 'clientes' de bi_processos, igual já existe para os nomes na tabela de contratos. Assim a busca do portal continua rápida mesmo com a carteira muito maior. Otimização preventiva de baixo custo.

**Ganho:** Abertura do Portal continua rápida conforme a carteira de processos cresce, sem varrer a tabela

**Onde:** Banco: índice GIN trigram em bi_processos(clientes) — consulta em client/netlify/functions/portal-data.mjs linha ~239 (.ilike clientes)

### 12. Polling de automações roda no navegador de cada usuário e baixa o JSON completo do contrato
`medio / alto / medio`

**O que é:** A cada 5 minutos, o navegador de TODOS os usuários logados roda a mesma rotina de automações (verifica ZapSign, dispara ADVBOX e Drive). Já existe um filtro que reduz quem é trazido (QW#7), mas para os contratos que precisam de processamento ela ainda baixa a coluna 'dados' (o JSON inteiro do contrato, que é grande) por usuário logado. Com 5 secretárias logadas, são 5 navegadores fazendo o mesmo trabalho e baixando os mesmos JSONs. O que melhora: mover essa automação para uma função agendada no servidor (ou um lock que escolhe só um navegador 'líder' por vez), de modo que o trabalho seja feito UMA vez, no servidor, e não multiplicado por usuário. Isso economiza banda e tira processamento dos navegadores.

**Ganho:** O trabalho de automação deixa de ser multiplicado pelo número de usuários logados; menos banda e menos JSON grande trafegado

**Onde:** client/src/App.jsx (runAutomations com setInterval de 300000ms, linha ~847; PART 2 seleciona a coluna 'dados' completa na linha ~631)

### 13. Espelho de boletos do Asaas reconcilia um a um, com pausa fixa, em série
`baixo / medio / medio`

**O que é:** Na sincronização de boletos, a etapa de reconciliação (asaasMirror.mjs, reconcileStaleOpen) refaz a busca dos boletos 'abertos que não foram vistos' UM POR UM, esperando cada chamada terminar e ainda dando uma pausa fixa de 250 ms entre cada um. Em uma fila de 150-400 boletos, isso vira minutos só de espera. As outras partes do mesmo arquivo já usam um helper de paralelismo controlado (promiseMap, 8 de cada vez), mas a reconciliação não. O que melhora: aplicar o mesmo paralelismo controlado (respeitando o limite do Asaas) à reconciliação, encurtando bastante essa etapa sem risco de estourar a API.

**Ganho:** Reconciliação de boletos termina bem mais rápido; menos chance de a sincronização precisar se 'encadear' por falta de tempo

**Onde:** client/netlify/functions/_lib/asaasMirror.mjs (reconcileStaleOpen, linhas ~225-249: for serial com setTimeout 250ms) — reaproveitar o promiseMap já existente no mesmo arquivo

### 14. Monitor monta o mapa processo→lead lendo todos os contratos com o JSON dos contratantes
`baixo / medio / baixo`

**O que é:** O monitor (e outras rotinas) montam um mapa 'qual lead do Kommo pertence a cada processo' lendo TODOS os contratos com advbox_lawsuit_id e extraindo o link do Kommo de dentro do JSON dos contratantes (getLawsuitLeadMap em _lib/botDb.mjs). Puxar o JSON dos contratantes de todos os contratos é mais pesado do que precisa: o link do Kommo poderia viver numa coluna simples (ex.: kommo_lead_id) preenchida na assinatura, deixando essa leitura trivial. O que melhora: gravar o lead do Kommo numa coluna dedicada quando o contrato é processado, e o mapa passa a ser uma leitura enxuta de duas colunas, sem abrir JSON. Otimização incremental, mas tira peso de uma função que roda 2x/dia.

**Ganho:** Mapa processo→lead fica leve e rápido; menos JSON grande lido a cada rodada do monitor e da régua

**Onde:** client/netlify/functions/_lib/botDb.mjs (getLawsuitLeadMap, linha ~267: select de dados->contratantes de todos os contratos) — gancho de preenchimento em advbox-sync.mjs

### 15. Keep-warm e crons sobrepostos: revisar para economizar invocações e banda
`baixo / baixo / baixo`

**O que é:** A função keep-warm 'acorda' funções críticas a cada 10 minutos para evitar lentidão de partida a frio (cold start). Hoje ela aquece health e zapsign-proxy. Vale revisar dois pontos: (1) a função health também é chamada pelo indicador do cabeçalho a cada 2 min com a aba aberta, então enquanto houver alguém usando o sistema ela já está quente — o keep-warm de 10 min pode ser afrouxado para 15 min sem prejuízo, cortando ~1/3 das invocações; (2) confirmar que as duas funções aquecidas respondem ao OPTIONS sem rodar lógica de negócio (para o ping ser realmente barato). É um ajuste fino de custo, não de funcionalidade.

**Ganho:** Menos invocações e banda gastas em manutenção de aquecimento, sem piora perceptível de partida a frio

**Onde:** client/netlify/functions/keep-warm.mjs (schedule '*/10 * * * *', linha ~78) — cruzar com health-check de 120s em client/src/App.jsx linha ~872

### 16. Funções serverless recriam o cliente Supabase e repetem a chave anon no código
`baixo / baixo / baixo` `JÁ CONHECIDO`

**O que é:** Várias funções (datajud-refresh, commission-calculator, asaas-sync, api-powerbi) criam o cliente Supabase no topo do arquivo com a URL e a chave anon escritas à mão (hardcoded), cada uma do seu jeito. Isso tem dois efeitos: (1) manutenção espalhada — quando a service role finalmente for configurada, é preciso editar arquivo por arquivo; (2) inconsistência — algumas já leem process.env.SUPABASE_SERVICE_ROLE_KEY e outras não, então o dia em que a chave for adicionada, parte continua gravando como anon. O que melhora: padronizar todas para importarem o cliente único de _lib/botDb.mjs (que já faz o fallback service-role→anon). Ganho de manutenção e consistência, e prepara o terreno para fechar o buraco de segurança da RLS de uma vez.

**Ganho:** Um único ponto para trocar a chave do banco; consistência entre funções e caminho aberto para ativar a service role sem caçar arquivos

**Onde:** client/netlify/functions/datajud-refresh.mjs (linha ~31), commission-calculator.mjs (~40), asaas-sync.mjs (~12), api-powerbi.mjs (~9) — centralizar no client Supabase de _lib/botDb.mjs

## Segurança

### 1. Proxy do ZapSign sem nenhuma senha — qualquer pessoa na internet pode cancelar/criar assinaturas
`alto / baixo / medio`

**O que é:** O endereco /api/zapsign (arquivo netlify/edge-functions/zapsign-proxy.ts e a versao netlify/functions/zapsign-proxy.mjs) aceita qualquer requisicao POST sem pedir senha alguma. Como o token do ZapSign fica guardado no servidor e e usado automaticamente, qualquer estranho que descubra esse endereco (e ele esta no codigo do site, e publico) pode mandar 'action: cancel' com o codigo de um documento para APAGAR um contrato em assinatura, ou 'action: create' para disparar pedidos de assinatura usando a conta paga do escritorio. Hoje nao ha nenhuma barreira. A correcao e exigir um cabecalho secreto (igual o 'x-bot-key' que outras funcoes ja usam) ou validar a sessao do usuario logado antes de repassar pro ZapSign.

**Ganho:** Impede que terceiros apaguem contratos em assinatura ou gastem a cota paga do ZapSign do escritorio; protege a integridade juridica dos documentos.

**Onde:** client/netlify/edge-functions/zapsign-proxy.ts e client/netlify/functions/zapsign-proxy.mjs

### 2. Upload pro Google Drive (save-to-drive) sem senha — pode encher o Drive do escritorio com lixo
`medio / baixo / baixo`

**O que é:** As funcoes save-to-drive.mjs e save-to-drive-direct.mjs nao checam nenhuma senha. Elas baixam um PDF do ZapSign e jogam dentro de uma pasta do Google Drive do escritorio (via Apps Script). Qualquer pessoa que descubra o endereco pode chamar a funcao repetidamente, poluir as pastas dos clientes com arquivos, e consumir a cota do Apps Script ate ele parar de funcionar (negacao de servico). A correcao e a mesma das outras: exigir um cabecalho secreto compartilhado entre o app e a funcao, ou validar a sessao do usuario.

**Ganho:** Evita que estranhos poluam as pastas dos clientes no Drive e derrubem a automacao de arquivamento.

**Onde:** client/netlify/functions/save-to-drive.mjs e save-to-drive-direct.mjs

### 3. Criar tarefa no ADVBOX (advbox-create-task) e postar nota no Kommo (kommo-note) sem senha
`medio / baixo / baixo`

**O que é:** Duas funcoes que escrevem nos CRMs do escritorio nao pedem senha: advbox-create-task.mjs (cria tarefas no ADVBOX usando o token da conta) e kommo-note.mjs (posta notas em leads do Kommo). Quem souber os enderecos pode criar tarefas falsas para a equipe ou escrever notas falsas dentro dos leads comerciais — bagunca operacional e possivel fraude (ex: nota dizendo 'cliente desistiu'). Detalhe agravante do Kommo: a API v4 NAO deixa apagar notas (so da pra criar), entao notas falsas ficam para sempre no historico do lead. A correcao e exigir um cabecalho secreto nessas duas funcoes (as chamadas internas server-to-server passam a enviar o segredo).

**Ganho:** Protege os CRMs (ADVBOX e Kommo) contra criacao de tarefas e notas falsas que sujariam o historico dos clientes de forma irreversivel.

**Onde:** client/netlify/functions/advbox-create-task.mjs e kommo-note.mjs

### 4. Webhook do Kommo (bot WhatsApp) nao verifica de quem veio — pode ser forjado
`medio / medio / baixo`

**O que é:** A funcao kommo-advbox-webhook.mjs recebe a mensagem que o cliente mandou no WhatsApp e repassa pro robo responder. Ela nao confere NENHUMA prova de que a chamada veio mesmo do Kommo: aceita qualquer POST e ja dispara o processamento (que consulta o ADVBOX e gasta cota de API). Um atacante pode mandar mensagens falsas em loop, fazendo o robo responder coisas erradas e queimar o limite de requisicoes do ADVBOX. O ideal e validar um segredo combinado (token na URL do webhook ou assinatura) antes de aceitar — o Kommo permite incluir um parametro secreto na URL do webhook que a funcao confere.

**Ganho:** Impede que estranhos injetem mensagens falsas no robo de WhatsApp e esgotem a cota da API do ADVBOX.

**Onde:** client/netlify/functions/kommo-advbox-webhook.mjs (e o worker advbox-bot-worker-background.mjs)

### 5. Injecao de filtro no banco via busca de nome (PostgREST .or/.ilike com texto cru)
`alto / medio / baixo`

**O que é:** Varios lugares montam o filtro do banco juntando texto digitado pelo usuario direto na string (ex: portal-admin.mjs linha 113 `nome.ilike.%${q}%`, api-rest.mjs linha 81, e no frontend GlobalSearch/FormPanel/RelatorioBoletos). O Supabase interpreta virgulas, parenteses e o caractere `*` dentro dessas strings como SINTAXE de filtro, nao como texto. Em portal-admin o codigo so remove virgula e parenteses (`replace(/[,()]/g,' ')`) mas NAO remove o `*` nem `.`, entao um valor como `*` ou `nome.not.is.null` pode alterar a logica da consulta e, no minimo, fazer a busca retornar registros que nao deveria. Como o banco esta com RLS aberta, isso amplifica vazamento de dados. A correcao e escapar/remover tambem `*`, `.`, `:` e aspas, ou usar o filtro estruturado (passar o valor por parametro em vez de concatenar) — e idealmente migrar essas buscas para uma RPC security-definer que valida no banco (o portal ja faz isso com portal_boletos).

**Ganho:** Evita que um texto de busca manipulado distorca as consultas e exponha registros indevidos; reduz a superficie de vazamento enquanto a RLS nao e fechada.

**Onde:** netlify/functions/portal-admin.mjs (l.113), api-rest.mjs (l.80-81); src/components/GlobalSearch.jsx, FormPanel.jsx, RelatorioBoletosModal.jsx, ContratosTab.jsx, bot/BotNovidades.jsx

### 6. Token do webhook do Asaas fixo no codigo como reserva (qualquer um le no GitHub)
`alto / baixo / baixo`

**O que é:** O asaas-webhook.mjs valida o token do webhook assim: `process.env.ASAAS_WEBHOOK_TOKEN || 'cbc_webhook_asaas_nf_automatica_2026_prod'`. O problema e a parte depois do `||`: se a variavel de ambiente nao estiver configurada na Netlify, o sistema aceita esse texto fixo que esta escrito no codigo. Como o codigo esta no repositorio, esse 'segredo' nao e segredo nenhum — qualquer um que veja o codigo pode forjar um evento de 'pagamento confirmado' e fazer o sistema emitir uma Nota Fiscal de um pagamento que nao aconteceu. A correcao e remover o valor fixo de reserva e fazer a funcao RECUSAR (em vez de aceitar) quando a variavel nao estiver configurada.

**Ganho:** Impede que estranhos forjem confirmacoes de pagamento e disparem emissao de Nota Fiscal falsa (problema fiscal e contabil).

**Onde:** client/netlify/functions/asaas-webhook.mjs (linha 49)

### 7. Webhook do ZapSign so confere o segredo se ele estiver configurado (e ainda nao esta)
`medio / baixo / baixo`

**O que é:** O zapsign-webhook.mjs so valida o cabecalho secreto SE a variavel ZAPSIGN_WEBHOOK_SECRET existir (`if (WEBHOOK_SECRET) {...}`). Se ela nao estiver configurada na Netlify — e pelo padrao do codigo, provavelmente nao esta — a funcao aceita qualquer chamada. O atenuante e que a funcao re-consulta o ZapSign de verdade antes de confiar no que recebeu (bom!), mas um atacante ainda consegue, no minimo, descobrir quais tokens de documento existem no banco e forcar consultas. A correcao e configurar o ZAPSIGN_WEBHOOK_SECRET na Netlify e no painel do ZapSign, e tornar a validacao obrigatoria (recusar quando o segredo nao bater, sem o 'if' opcional).

**Ganho:** Garante que so o ZapSign de verdade dispare mudancas de status de contrato; fecha sondagem de tokens de documento.

**Onde:** client/netlify/functions/zapsign-webhook.mjs (linhas 16, 42-47)

### 8. Controle de acesso por aba e so 'enfeite' — todo usuario logado le tudo do banco
`alto / alto / medio` `JÁ CONHECIDO`

**O que é:** No App.jsx, quem ve cada aba (Asaas, Boletos, Admin, Socios etc.) e decidido so no navegador, pela tabela user_permissions. Mas a seguranca de verdade teria que estar no banco. Como a RLS esta aberta (problema ja conhecido), qualquer usuario logado — mesmo uma secretaria sem permissao de Admin ou de Boletos — pode abrir o console do navegador e consultar diretamente as tabelas contratos, asaas_boletos, user_permissions etc. com a chave publica, vendo dados que a interface esconderia. Ou seja, esconder a aba nao protege o dado. Enquanto a RLS allow-all nao for fechada, o esconde-aba da uma falsa sensacao de seguranca. A correcao definitiva e fechar a RLS por papel (atado ao user_permissions); enquanto isso, ao menos documentar que o gating de aba e cosmetico.

**Ganho:** Deixa claro que dados financeiros e de permissoes precisam de RLS real; orienta a priorizacao do fechamento da RLS para que o RBAC pare de ser apenas visual.

**Onde:** client/src/App.jsx (tabAllowed, l.1101-1106) + RLS das tabelas no Supabase

### 9. Rascunho de contrato guarda CPF, RG e endereco em texto puro no navegador (localStorage)
`medio / baixo / baixo`

**O que é:** O ContractContext.jsx salva TODO o rascunho do contrato no localStorage do navegador, incluindo dados sensiveis dos clientes: CPF, RG, data de nascimento, endereco completo, telefone, email. Esses dados ficam em texto legivel e PERMANECEM la mesmo depois do logout (nada e apagado ao sair). Em um computador compartilhado do escritorio, a proxima pessoa que usar aquele navegador (ou qualquer extensao maliciosa instalada) consegue ler os dados do ultimo cliente. Pela LGPD isso e exposicao desnecessaria de dado pessoal. A correcao minima e LIMPAR o rascunho do localStorage no logout (AuthContext.signOut); idealmente guardar so o minimo necessario e nao os documentos completos.

**Ganho:** Reduz exposicao de dados pessoais (CPF/RG/endereco) em maquinas compartilhadas e melhora conformidade com a LGPD.

**Onde:** client/src/ContractContext.jsx (l.78-95) e client/src/AuthContext.jsx (signOut, l.117)

### 10. Token do ZapSign sendo gravado no localStorage por codigo morto (Step7ZapSign)
`baixo / baixo / baixo`

**O que é:** O arquivo src/steps/Step7ZapSign.jsx grava o token do ZapSign no localStorage (`localStorage.setItem(ZAPSIGN_TOKEN_KEY, apiToken)`). Esse token e uma credencial sensivel que da acesso a conta de assinatura do escritorio. Guardar credencial em localStorage e ruim porque qualquer script na pagina (inclusive um XSS) consegue ler. A boa noticia e que a pasta steps/ e codigo morto (o wizard antigo nao e mais usado), entao a correcao mais limpa e simplesmente REMOVER a pasta steps/ inteira — some o risco e ainda limpa divida tecnica. Confirmar antes que nada importa mais essa pasta.

**Ganho:** Elimina o armazenamento de uma credencial sensivel no navegador e remove codigo morto de uma vez.

**Onde:** client/src/steps/Step7ZapSign.jsx (e toda a pasta client/src/steps/)

### 11. Site sem Content-Security-Policy (CSP) — XSS teria via livre
`medio / medio / medio`

**O que é:** O arquivo public/_headers define varios cabecalhos de seguranca (X-Frame-Options, HSTS etc.), mas NAO define um Content-Security-Policy. O CSP e a rede de protecao contra XSS: ele lista de quais lugares o navegador pode carregar scripts e para onde pode mandar dados. Sem ele, se algum dia entrar um XSS (e o portal do cliente monta HTML com innerHTML em varios pontos, e o painel exibe textos vindos do ADVBOX/Kommo), o codigo malicioso roda sem restricao e pode roubar a sessao e enviar dados pra fora. A correcao e adicionar um cabecalho Content-Security-Policy restritivo no _headers (comecar em modo 'report-only' para nao quebrar nada, depois endurecer), e um especifico mais apertado para o /portal.

**Ganho:** Cria uma barreira de contencao: mesmo que um XSS apareca, ele fica limitado e nao consegue exfiltrar a sessao com facilidade.

**Onde:** client/public/_headers (e client/netlify.toml [[headers]])

### 12. Limitador de requisicoes (rate limit) so esta ligado em UMA funcao
`medio / medio / baixo`

**O que é:** Existe um limitador de requisicoes em rate-limit.mjs (max 30/min por IP), mas ele so e usado na asaas-sync.mjs. As funcoes que mais precisam — cpf-lookup (cada chamada custa R$0,25 na API externa!), portal-data, portal-pergunta, advbox-bot-reply, os webhooks publicos — NAO tem limite nenhum. Alguem pode chamar cpf-lookup em loop e gerar uma conta alta na API de CPF, ou martelar portal-data tentando adivinhar tokens. Alem disso, o limitador atual e 'por instancia' (cada copia da funcao tem sua propria contagem), entao na pratica vaza. A correcao e aplicar rate limiting nas funcoes publicas/caras e, para um limite confiavel entre instancias, usar um armazenamento compartilhado (ex: tabela no Supabase ou Netlify Blobs com contagem por IP/token).

**Ganho:** Evita custo inesperado na API de CPF e ataques de forca bruta nos tokens do portal; protege as cotas das integracoes.

**Onde:** client/netlify/functions/rate-limit.mjs + cpf-lookup.mjs, portal-data.mjs, portal-pergunta.mjs, advbox-bot-reply.mjs

### 13. Chave da API do DataJud (CNJ) escrita fixa dentro do codigo
`baixo / baixo / baixo`

**O que é:** Em datajud-refresh.mjs (linha 28) a chave da API publica do DataJud do CNJ esta escrita direto no codigo (`const DATAJUD_KEY = 'APIKey ...'`). Diferente do padrao das outras integracoes (que leem de variavel de ambiente), essa fica versionada no repositorio. Mesmo sendo uma API publica do CNJ, e ma pratica deixar credencial no codigo: se o repositorio vazar ou virar publico, a chave vaza junto, e nao da pra trocar sem mexer no codigo e fazer deploy. A correcao e mover para uma variavel de ambiente DATAJUD_KEY na Netlify, igual aos outros tokens.

**Ganho:** Permite trocar a chave sem alterar codigo e evita expor credencial no historico do repositorio.

**Onde:** client/netlify/functions/datajud-refresh.mjs (linha 28)

### 14. Todas as funcoes liberam CORS para qualquer site (Access-Control-Allow-Origin: *)
`baixo / medio / baixo`

**O que é:** Praticamente todas as funcoes respondem com 'Access-Control-Allow-Origin: *', ou seja, qualquer site na internet pode chamar essas APIs a partir do navegador de um usuario. Para as APIs internas do sistema (portal-admin, advbox-bot-reply, save-to-drive, asaas-sync), isso e desnecessario e amplia a superficie: um site malicioso aberto pelo funcionario poderia tentar chamar essas funcoes. O ideal e restringir o Allow-Origin ao dominio do proprio sistema (https://contratos-cbc.netlify.app) nas funcoes internas, deixando o '*' apenas onde realmente precisa ser publico (ex: o portal do cliente, que e acessado por link). Combinar isso com a autenticacao por cabecalho secreto reduz bastante o risco.

**Ganho:** Reduz a chance de outro site abusar das APIs internas atraves do navegador do funcionario; defesa em camadas junto com a autenticacao.

**Onde:** client/netlify/functions/* (CORS) — em especial portal-admin.mjs, advbox-bot-reply.mjs, api-rest.mjs, api-powerbi.mjs

### 15. API REST/Power BI publicas com chave-padrao fraca e devolvendo CPF e dados sensiveis
`alto / baixo / medio` `JÁ CONHECIDO`

**O que é:** As funcoes api-rest.mjs e api-powerbi.mjs sao APIs publicas protegidas so por uma chave que, se a variavel de ambiente nao estiver setada, vira o texto fixo 'cbc-api-2026' / 'cbc-powerbi-2026' (escrito no codigo). Com essa chave fraca, qualquer um lista TODOS os contratos com CPF, email, honorarios e ate observacoes_internas (api-powerbi inclui esse campo de notas internas no retorno!). Pior: a chave pode ir na URL (`?api_key=`), o que faz ela aparecer em logs de servidor e historico. As correcoes: (1) remover os defaults fracos e recusar se a env nao existir; (2) NAO devolver observacoes_internas nem CPF completo no payload de BI; (3) aceitar a chave so por cabecalho, nunca pela URL; (4) se a api-rest nao tiver integrador externo usando, desligar a funcao.

**Ganho:** Fecha um vazamento direto de base de clientes (CPF, honorarios, notas internas) por uma chave adivinhavel; reduz superficie removendo API sem uso.

**Onde:** client/netlify/functions/api-rest.mjs (l.16,37) e api-powerbi.mjs (l.11,29,47)

### 16. Endpoints publicos do portal escrevem no banco so com o token na URL, sem limite de tentativa
`medio / medio / baixo`

**O que é:** As funcoes do portal do cliente (portal-pergunta, portal-feedback, portal-track, portal-push) sao acessiveis sem login — validam apenas o token de 32 caracteres que vem na URL. Isso esta razoavelmente bem feito (token longo, valida 'ativo', limites de 3 perguntas), MAS nao ha rate limiting nenhum: um atacante pode tentar adivinhar tokens em alta velocidade, ou usar um token valido vazado (ex: cliente reenviou o link num grupo de WhatsApp) para floodar perguntas/NPS e criar tarefas falsas no Kommo (portal-pergunta cria tarefa no CRM). Como o token aparece na URL, ele tambem fica em historico de navegador e logs de proxy. Correcoes: aplicar rate limit por IP/token nessas funcoes; e considerar tornar o token revogavel/expirado por tempo (hoje so ha o flag 'ativo').

**Ganho:** Evita abuso dos formularios do portal (spam de perguntas/NPS, tarefas falsas no CRM) e dificulta adivinhacao de tokens.

**Onde:** client/netlify/functions/portal-pergunta.mjs, portal-feedback.mjs, portal-track.mjs, portal-push.mjs

### 17. Geracao do HTML do contrato nao escapa os dados do cliente (risco de quebra/injecao no PDF)
`baixo / baixo / baixo`

**O que é:** Em src/utils/contractHtml.js, os dados do contratante (nome, profissao, endereco, complemento etc.) sao colados direto dentro do HTML do contrato sem escapar caracteres especiais (ex: `<strong>${c.nome.toUpperCase()}</strong>, ... ${c.profissao}`). Se um nome ou complemento contiver `<` ou `>` (digitado por engano ou colado de um documento), isso pode quebrar a formatacao do contrato gerado ou, no preview ao vivo (LivePreview/iframe), ser interpretado como HTML. Como esse HTML alimenta tanto o preview na tela quanto o PDF/DOCX final do contrato, vale a pena escapar os valores do cliente antes de inserir (uma funcao simples que troca < > & por entidades), garantindo que o que o cliente digitou nunca vire marcacao.

**Ganho:** Garante que nomes/enderecos com caracteres especiais nao corrompam o contrato gerado nem injetem HTML no preview; documento juridico sempre integro.

**Onde:** client/src/utils/contractHtml.js (funcao qualificacao l.18-23 e demais interpolacoes)

### 18. Deteccao de login anomalo depende de servico externo e nao bloqueia nada
`baixo / medio / baixo`

**O que é:** O AuthContext.jsx chama um servico externo (ipapi.co) para descobrir o pais do IP e, com base nisso e no horario, registra um 'login anomalo' no activity_log. Dois problemas de seguranca: (1) o IP e o pais do funcionario sao enviados a um servico de terceiros gratuito a cada login (questao de privacidade e dependencia de terceiro que pode cair ou ser bloqueado); (2) a deteccao so REGISTRA e mostra um aviso — nao exige segundo fator nem bloqueia. Ou seja, se a conta de alguem for invadida, o sistema apenas anota. Vale avaliar mover a geolocalizacao para o servidor (a Netlify ja fornece o pais do request sem servico externo, via context.geo) e, para contas de admin, considerar uma camada extra de verificacao em acessos suspeitos.

**Ganho:** Evita enviar IP de funcionarios a um terceiro e abre caminho para uma resposta real (e nao so registro) a acessos suspeitos, especialmente em contas admin.

**Onde:** client/src/AuthContext.jsx (l.13-16, deteccao via ipapi.co)

## UX & Fluxos

### 1. Erro de salvar e mascarado como "Salvo offline" (some sem deixar rastro)
`alto / medio / baixo`

**O que é:** Quando voce clica em Salvar e o banco recusa (ex: regra de permissao, campo invalido, conflito), o sistema NAO mostra o erro real. Ele simplesmente engole qualquer falha e mostra 'Salvo offline' (App.jsx, handleSaveContract, linha ~1013-1016: o catch joga TUDO na fila offline). O contrato vai pra uma fila no navegador daquele computador. Se a pessoa fechar a aba ou trocar de maquina, o trabalho some e ninguem percebe — porque a tela disse que estava tudo bem. O certo e distinguir 'sem internet' (ai sim fila offline) de 'o banco recusou' (ai mostrar o motivo e deixar a pessoa corrigir/tentar de novo).

**Ganho:** Acaba com a perda silenciosa de contratos. A secretaria ve o problema real na hora em vez de achar que salvou e descobrir dias depois que sumiu.

**Onde:** client/src/App.jsx (handleSaveContract ~968-1018) e syncOfflineQueue ~167

### 2. ZapSign envia, mas se o registro nao salvar a tela mente que deu tudo certo
`alto / medio / baixo`

**O que é:** No fluxo de enviar pra assinatura: primeiro o documento e criado no ZapSign, depois o sistema tenta gravar no banco o token e o status 'enviado_zapsign' (App.jsx ~1481-1486). Se essa gravacao cair no mesmo catch de 'offline' acima, o documento JA EXISTE no ZapSign, mas o sistema continua mostrando o contrato como rascunho — e ainda exibe a mensagem 'Contrato enviado para ZapSign'. Resultado: cliente recebe link pra assinar, mas o contrato nao aparece como enviado na lista, ninguem acompanha, e da pra reenviar duplicado.

**Ganho:** Garante que todo envio ao ZapSign fique registrado e rastreavel. Evita documento orfao e reenvio em duplicidade.

**Onde:** client/src/App.jsx (onSaveAfterSend ~1481) + handleSaveContract

### 3. Sem credito de CPF: mostra check verde de 'valido' e ainda trava com um alerta de navegador
`medio / baixo / baixo`

**O que é:** Quando os creditos da consulta de CPF acabam, o sistema faz duas coisas erradas (FormPanel.jsx ~562-566): pinta o status como 'valid' (bolinha verde, dando a impressao errada de que o CPF foi conferido) e dispara um alert() do navegador ('Creditos... Avisar o Bruno!!!') que congela a tela ate clicar OK. O alert e feio, bloqueante e quebra o ritmo de cadastro. O certo e um aviso discreto (toast/banner amarelo) dizendo 'consulta indisponivel, preencha o nome manualmente' — sem fingir que validou.

**Ganho:** A pessoa entende que precisa digitar o nome na mao e nao fica confiando num check verde falso. Cadastro nao trava.

**Onde:** client/src/components/FormPanel.jsx (handleCPFValidate ~562-566)

### 4. Carregar um contrato no formulario apaga o rascunho atual sem avisar
`medio / baixo / baixo`

**O que é:** Na aba Contratos, o botao 'Carregar no Formulario' (ContratosTab.jsx ~1840) joga os dados do contrato escolhido por cima de tudo que estiver no formulario (App.jsx handleLoadContract ~1020 chama updateData direto, sem checar se ja havia algo preenchido). Se a secretaria estava no meio de um cadastro novo e clica pra dar uma olhada em outro contrato, perde tudo que digitou. Deveria avisar 'Voce tem um cadastro em andamento — substituir?' quando o formulario nao esta vazio.

**Ganho:** Evita perda de trabalho por um clique. Da seguranca pra navegar entre contratos sem medo.

**Onde:** client/src/App.jsx (handleLoadContract ~1020) e ContratosTab.jsx (botao Carregar ~1840)

### 5. Formulario nao deixa claro se voce esta criando um contrato novo ou editando um existente
`medio / baixo / baixo`

**O que é:** Quando voce carrega um contrato salvo no formulario, nada na tela diz 'voce esta editando o contrato do Joao'. O botao continua escrito 'Salvar Contrato' (FormPanel.jsx ~1714), igualzinho a quando se cria do zero — quando na verdade ele vai ATUALIZAR o contrato existente (App.jsx ~976). A unica pista e o indicador de presenca, que so aparece se outra pessoa estiver na mesma tela. Falta um banner tipo 'Editando: Joao da Silva — Resort X' e trocar o texto do botao para 'Atualizar Contrato'.

**Ganho:** Acaba a confusao de 'achei que estava criando um novo e sobrescrevi o antigo'. A pessoa sabe exatamente o que o botao vai fazer.

**Onde:** client/src/components/FormPanel.jsx (cabecalho do form ~1084 e botao Salvar ~1707-1715)

### 6. Busca global (Cmd+K) acha o contrato mas o clique nao abre nada
`medio / baixo / baixo`

**O que é:** Voce abre a busca, digita o nome, aparece o resultado, clica — e o sistema so troca pra aba 'Contratos Salvos' sem abrir, destacar ou filtrar pelo contrato que voce escolheu (App.jsx ~1488: onSelectContract apenas faz setMainTab('contratos')). Ai voce tem que procurar de novo na lista. O clique na busca deveria levar direto ao contrato (abrir o detalhe ou ao menos filtrar a lista por ele).

**Ganho:** A busca passa a economizar tempo de verdade em vez de exigir uma segunda procura manual.

**Onde:** client/src/App.jsx (~1488, onSelectContract da GlobalSearch)

### 7. Confirmacao de 'Sim, Limpar' fala que nao da pra desfazer, mas existe Cmd+Z no sistema
`medio / medio / baixo`

**O que é:** Ao limpar o formulario, o modal diz 'Esta acao nao pode ser desfeita' (FormPanel.jsx ~1777). Mas o sistema tem um mecanismo de Desfazer (Cmd+Z, useUndo) usado em outras acoes. Limpar o formulario inteiro — a acao mais destrutiva do cadastro — nao oferece desfazer. O ideal seria, ao limpar, mostrar um toast 'Formulario limpo — Desfazer' por alguns segundos (igual ja existe pra arquivar contrato), guardando os dados antigos pra restaurar.

**Ganho:** Quem limpou por engano recupera tudo num clique, sem ter que redigitar o cadastro inteiro.

**Onde:** client/src/components/FormPanel.jsx (handleClearForm ~955 e modal ~1766) + hooks/useUndo.js

### 8. A lista de contratos so ordena por data de criacao — nao da pra ordenar por nome, valor ou data de assinatura
`medio / medio / baixo`

**O que é:** A lista de Contratos Salvos vem sempre fixa em 'mais recentes primeiro' (ContratosTab.jsx ~773, order created_at desc), sem nenhuma opcao de mudar. Quem precisa achar 'os contratos de maior valor', 'os que assinaram esta semana' ou ordenar por nome do cliente nao consegue — tem que rolar tudo. Falta um seletor de ordenacao (Nome A-Z, Maior valor, Assinados recentemente, Mais antigos).

**Ganho:** Encontrar contratos por outro criterio que nao a data fica rapido. Util pra cobranca, conferencia e relatorios do dia a dia.

**Onde:** client/src/components/ContratosTab.jsx (fetchPage ~772-773)

### 9. Mensagem de sucesso ao salvar some em 3 segundos e e facil de perder
`baixo / baixo / baixo`

**O que é:** Depois de salvar, a confirmacao ('Contrato salvo!') aparece como um texto pequeno no topo e some sozinha em 3 segundos (App.jsx setSaveMsg + setTimeout 3000, ~1011). Em telas grandes a pessoa esta olhando pra parte de baixo (onde estao os botoes) e nem ve. Pra uma acao tao importante, valia um feedback mais visivel e perto do botao: um toast verde maior, ou o proprio botao virar 'Salvo!' por um instante com um check.

**Ganho:** A pessoa tem certeza de que salvou, em vez de clicar de novo na duvida (gerando salvamento/duplicacao desnecessaria).

**Onde:** client/src/App.jsx (handleSaveContract, setSaveMsg ~985-1011)

### 10. 'Gerar PDF e Salvar' forca o download do arquivo, mesmo quando a pessoa so quer registrar
`baixo / medio / baixo`

**O que é:** O botao 'Gerar PDF e Salvar' (App.jsx handlePdfSave ~1049) sempre baixa um arquivo .pdf pro computador automaticamente, alem de salvar no banco. Quem so queria registrar o contrato (sem precisar do arquivo no Downloads) acaba com a pasta de Downloads cheia de PDFs. Ja existe um botao separado de 'Gerar PDF e Salvar' e um de 'Salvar Contrato' — mas o de PDF nao deixa escolher entre 'so visualizar', 'so salvar no sistema' ou 'baixar'. Separar 'baixar PDF' de 'salvar no sistema' deixaria o fluxo mais limpo.

**Ganho:** Menos arquivos repetidos na pasta de Downloads e menos confusao sobre qual botao faz o que.

**Onde:** client/src/App.jsx (handlePdfSave ~1049-1067) e FormPanel.jsx (botoes ~1716)

### 11. Trocar de aba no meio de um cadastro nao avisa que ha dados nao salvos no banco
`medio / medio / baixo`

**O que é:** O formulario guarda rascunho no proprio navegador (localStorage, ContractContext), o que e bom. Mas se a pessoa sai da aba 'Novo' sem ter clicado em Salvar, nada avisa que aquilo ainda nao foi pro banco (so esta no navegador daquela maquina). Em outro computador o trabalho nao existe. Um aviso discreto ('Rascunho so neste navegador — clique em Salvar pra registrar') ou um aviso ao trocar de aba com dados nao salvos evitaria surpresas.

**Ganho:** A pessoa entende a diferenca entre 'rascunho local' e 'salvo no sistema', reduzindo o 'sumiu o que eu fiz'.

**Onde:** client/src/App.jsx (troca de mainTab) e ContractContext.jsx (autosave localStorage ~91-95)

### 12. Erros do ZapSign aparecem com texto tecnico cru pro usuario
`medio / medio / baixo`

**O que é:** Se o envio ao ZapSign falha, a tela mostra a mensagem de erro tecnica direto da API (ZapSignModal.jsx ~133 e ~202: exibe err.message sem traducao). O usuario ve coisas como 'Request failed with status code 422' ou textos em ingles, sem saber o que fazer. Faltam mensagens em portugues simples por tipo de erro mais comum (ex: 'E-mail do contratante invalido', 'Sem conexao — tente de novo', 'Documento muito grande') com orientacao do proximo passo.

**Ganho:** A secretaria entende o erro e resolve sozinha (ex: corrige o e-mail) em vez de chamar o suporte ou desistir.

**Onde:** client/src/components/ZapSignModal.jsx (catch ~133, exibicao ~201-203) e utils/zapsignService.js

### 13. Clicar fora do modal de envio do ZapSign pode fechar a tela no meio do envio
`baixo / baixo / baixo`

**O que é:** O modal de envio fecha ao clicar no fundo escuro (ZapSignModal.jsx ~149: onClick={onClose} no backdrop). Como o envio (gerar PDF + subir pro ZapSign) leva alguns segundos, um clique acidental fora do quadro durante esse tempo fecha a janela e a pessoa perde a visao do progresso e do resultado (links de assinatura). O backdrop deveria ignorar cliques enquanto loading=true.

**Ganho:** Ninguem perde os links de assinatura por um clique fora do quadro durante o envio.

**Onde:** client/src/components/ZapSignModal.jsx (~149, onClick do backdrop)

### 14. Atalho Cmd+S salva sem validar e sem dizer nada se o formulario estiver incompleto
`medio / baixo / baixo`

**O que é:** O atalho de teclado Cmd+S chama handleSaveContract direto (App.jsx ~921), pulando a validacao detalhada que o botao 'Salvar' faz (handleValidatedAction no FormPanel). Como o save engole erros como 'offline', apertar Cmd+S num formulario incompleto pode mandar um registro pela metade pra fila offline sem nenhum aviso visivel. O atalho deveria passar pela mesma validacao do botao e dar o mesmo feedback.

**Ganho:** O atalho de salvar se comporta igual ao botao — sem registros pela metade indo pra fila escondida.

**Onde:** client/src/App.jsx (keyboard handler, case 's' ~921)

### 15. Datas (1a mensagem, 1a parcela, nascimento) sao dificeis de digitar no formato do navegador
`baixo / medio / baixo`

**O que é:** Os campos de data usam o seletor padrao do navegador (type=date, ex: FormPanel.jsx ~795, ~1366, ~1598). No Chrome em portugues isso ainda exige clicar/digitar mes-dia-ano numa ordem que confunde muita gente, e nao aceita colar '14/06/2026'. Para a 'Data da Primeira Mensagem' nao ha nem validacao de que nao pode ser data futura. Vale: validar data futura onde faz sentido, e considerar um atalho 'Hoje' / 'Ontem' pra agilizar o preenchimento mais comum.

**Ganho:** Cadastro mais rapido e menos datas erradas (ex: ano trocado), principalmente no campo de primeira mensagem usado todo dia.

**Onde:** client/src/components/FormPanel.jsx (inputs date ~795, ~1366, ~1598)

### 16. Verificacao de e-mail e CEP no pre-envio depende de internet e some quando falha
`medio / baixo / baixo`

**O que é:** No checklist pre-envio, a checagem de e-mail (DNS) e de CEP-vs-cidade (FormPanel/PreSendChecklist.jsx ~12-47) assume 'valido' silenciosamente quando a consulta externa falha (catch retorna {valid:true} ou null). Ou seja: se a API externa cair, o sistema diz que esta tudo certo mesmo sem ter conferido nada — dando falsa seguranca antes de enviar pra assinatura. Deveria mostrar 'nao foi possivel verificar' (estado neutro/cinza) em vez de marcar como aprovado.

**Ganho:** O advogado nao confia num 'verificado' que na verdade nao verificou nada, evitando enviar contrato com e-mail errado.

**Onde:** client/src/components/PreSendChecklist.jsx (verifyEmailMX ~22, verifyCEPCity ~44)

### 17. Mascara de telefone trata fixo de 10 digitos como celular (formato fica torto)
`baixo / baixo / baixo`

**O que é:** A mascara de telefone (utils/masks.js maskPhone ~21) sempre assume o padrao de celular: coloca o traco depois do 5o digito apos o DDD. Para telefone fixo (10 digitos, ex: (62) 3333-4444) o numero fica formatado errado, tipo (62) 33334-444. Como o telefone vai pro contrato e pode ir pro cadastro do ADVBOX/Kommo, isso deixa o dado com cara errada. A mascara deveria detectar 10 vs 11 digitos e posicionar o traco certo.

**Ganho:** Telefones fixos aparecem formatados corretamente no contrato e nos cadastros, passando profissionalismo.

**Onde:** client/src/utils/masks.js (maskPhone ~21-27)

### 18. Selecao de resort entre ~99 opcoes nao tem busca por digitacao
`medio / medio / baixo`

**O que é:** O campo de Resort/Empreendimento e um select com perto de 99 opcoes (data/clausulas.js RESORTS ~55, usado no FormPanel ~1177). Rolar uma lista enorme pra achar o resort certo e lento e propenso a erro. Um campo com busca/autocomplete (digitar 'gran' e filtrar) seria muito mais rapido, ainda mais no celular onde o select nativo de 99 itens e horrivel.

**Ganho:** Selecionar o resort correto vira questao de digitar 3 letras, em vez de rolar uma lista gigante.

**Onde:** client/src/components/FormPanel.jsx (select de Resort ~1177-1180) e data/clausulas.js (RESORTS)

### 19. O botao 'Copiar' de campo do Contratante 1 nao avisa quando o campo de origem esta vazio de forma clara no fluxo
`baixo / baixo / baixo`

**O que é:** Ao montar o Contratante 2, ha botoes de copiar dados do Contratante 1 (FormPanel.jsx copyFrom ~582). Se o campo de origem esta vazio, mostra um toast de aviso (bom), mas os botoes 'Copiar endereco', 'Copiar contato' etc. ficam sempre habilitados mesmo quando o Contratante 1 ainda nao tem aquele dado — entao a pessoa clica, recebe um aviso, clica de novo. Desabilitar (ou esconder) o botao quando nao ha o que copiar evita o clique inutil.

**Ganho:** Menos cliques que nao fazem nada; a interface deixa claro o que esta disponivel pra copiar.

**Onde:** client/src/components/FormPanel.jsx (copyFrom e botoes de copia ~582-609)

### 20. Nao da pra reordenar nem renomear as opcoes de honorario predefinidas, e o valor da parcela so calcula numa direcao
`baixo / medio / baixo`

**O que é:** Nos honorarios manuais, voce digita o total e o numero de parcelas e o 'valor da parcela' e calculado e fica somente-leitura (FormPanel.jsx ~1344-1360). Mas e comum o vendedor pensar ao contrario: 'quero parcela de R$300, quantas parcelas dao no total?'. Hoje nao da pra digitar o valor da parcela. Permitir editar qualquer um dos tres campos (total, parcelas, valor da parcela) e recalcular os outros tornaria o preenchimento muito mais natural pra quem negocia por valor de parcela.

**Ganho:** O vendedor monta o honorario do jeito que negociou com o cliente (por valor de parcela), sem ter que fazer conta de cabeca.

**Onde:** client/src/components/FormPanel.jsx (inputs de honorario ~1344-1360)

## Mobile

### 1. Modais que estouram a tela no iPhone (só um tamanho foi corrigido)
`medio / baixo / baixo`

**O que é:** No celular, o navegador Safari mostra/esconde a barra de endereço, então a altura real visível muda. O sistema corrigiu isso só para os modais marcados como '90% da tela' (em index.css, linha 1448, só o 'max-h-[90vh]' vira 'dvh'). Mas vários modais usam outros tamanhos (85%, 80%, 60%) que NÃO foram corrigidos: o relatório de NF/PIX dos boletos (BoletosPanel.jsx:169 e AsaasPanel.jsx:235), a parametrização de vendas (VendasParametrizacaoPanel.jsx:649), o painel dos sócios (SociosDashboard.jsx:421) e o changelog (ChangeLog.jsx:474). Nesses, o rodapé com os botões pode cair atrás da barra do Safari e o usuário não consegue clicar em 'Salvar'/'Fechar' sem dar zoom.

**Ganho:** Os botões de ação dentro desses modais sempre ficam clicáveis no iPhone, sem o usuário precisar lutar com a tela. Evita travas em ações importantes (gerar relatório, salvar parametrização).

**Onde:** client/src/components/BoletosPanel.jsx:169, AsaasPanel.jsx:235, VendasParametrizacaoPanel.jsx:649, SociosDashboard.jsx:421, ChangeLog.jsx:474 — e a regra em client/src/index.css:1448 (cobrir 85vh/80vh/75vh/60vh com dvh)

### 2. Campo de e-mail capitaliza a primeira letra no iPhone (inclusive no formulário do cliente)
`alto / baixo / baixo`

**O que é:** Em TODOS os campos de e-mail do sistema, falta a configuração que diz ao iPhone 'não coloque maiúscula automática nem corrija o texto'. Resultado: ao digitar um e-mail no celular, o iOS coloca a primeira letra em maiúscula (Joao@... em vez de joao@...) e tenta 'corrigir' o que foi digitado. Isso vale para o cadastro de contratante (FormPanel.jsx:783), a tela de login (LoginScreen.jsx:155), o painel admin (AdminPanel.jsx:198), a importação (ImportContratoModal.jsx) e — o mais crítico — o formulário público que o PRÓPRIO CLIENTE preenche pelo QR code (ClientFormQR.jsx:274). E-mail com maiúscula no começo causa falha de envio do contrato e de cobrança.

**Ganho:** O cliente e a equipe digitam o e-mail certo de primeira no celular, sem maiúscula indevida nem autocorreção. Menos contrato/boleto voltando por e-mail errado.

**Onde:** client/src/components/ClientFormQR.jsx:274 (prioridade — é o cliente digitando), FormPanel.jsx:783, LoginScreen.jsx:155, AdminPanel.jsx:198, ImportContratoModal.jsx:739/807, MonitorPanel.jsx:673 — adicionar autoCapitalize="none" autoCorrect="off" spellCheck={false}

### 3. Reordenar cláusulas no celular conflita com a rolagem da tela
`medio / baixo / baixo`

**O que é:** Cada cláusula do contrato é uma caixa marcada como 'arrastável' (atributo draggable em FormPanel.jsx:1453), pensada para o mouse do computador. Para o toque foram adicionados botões de setinha (cima/baixo), o que é ótimo. Mas o atributo 'arrastável' continua LIGADO no celular. Quando o usuário segura o dedo na cláusula para rolar a lista, o iOS pode interpretar como 'arrastar' (que não faz nada no Safari) em vez de rolar — gerando uma sensação de tela travada/'grudada'. O certo é desligar o 'arrastável' em aparelhos de toque (já existe a deteção 'hover:none' usada nas setinhas).

**Ganho:** A lista de cláusulas rola suave no celular, sem a tela 'agarrar' o dedo. Reordenação fica 100% pelos botões de setinha, que já funcionam.

**Onde:** client/src/components/FormPanel.jsx:1453 — condicionar draggable a não-touch (ex.: draggable={!isTouchDevice})

### 4. Tabelas do Dashboard dos Sócios ficam ilegíveis no celular (colunas espremem em vez de rolar)
`medio / medio / baixo`

**O que é:** O Dashboard dos Sócios tem muitas tabelas com letra minúscula (texto de 11px) e várias colunas. Diferente de outras telas (Admin, Asaas, Vendas) que ganharam uma 'largura mínima' forçando rolagem lateral, as tabelas dos Sócios usam 'largura total' SEM largura mínima (várias em SociosDashboard.jsx, ex.: linhas 632, 777, 1061, 1407, 1702). No celular, em vez de a tabela rolar para o lado mantendo as colunas legíveis, ela se espreme: os números ficam grudados e cortados. Como o painel dos Sócios é liberado por e-mail e os sócios costumam abrir no celular, isso atrapalha quem mais decide.

**Ganho:** O sócio consegue ler receita, ranking e funil no celular rolando a tabela para o lado, com os números inteiros e alinhados, em vez de uma sopa de dígitos espremidos.

**Onde:** client/src/components/SociosDashboard.jsx (tabelas nas linhas ~632, 777, 1061, 1098, 1277, 1407, 1702, 1878) — adicionar max-sm:min-w-[XXXpx] em cada <table> dentro do overflow-x-auto

### 5. Teclado errado nos campos de dinheiro e parcelas dos honorários
`baixo / baixo / baixo`

**O que é:** Os campos 'Total (R$)', 'Parcelas' e 'Percentual' usam type=number (FormPanel.jsx:1344, 1352, 1384). No iPhone, esse tipo abre um teclado numérico, mas SEM vírgula/ponto fácil para centavos e, em alguns casos, mostra notação estranha. Para valores em reais o ideal é inputMode="decimal" (teclado com vírgula) e, para número de parcelas, inputMode="numeric". Hoje digitar R$ 3.500,00 ou um valor com centavos no celular é mais difícil do que precisa ser.

**Ganho:** Digitar valores de honorários e parcelas no celular fica rápido e natural, com o teclado certo aparecendo (com vírgula para reais).

**Onde:** client/src/components/FormPanel.jsx:1344 (Total R$), 1352 (Parcelas), 1384 (Percentual) — acrescentar inputMode adequado

### 6. Faltam as teclas 'Próximo/Avançar' no teclado durante o preenchimento (enterKeyHint)
`baixo / medio / baixo`

**O que é:** Em formulários longos no celular, é possível pedir ao teclado para mostrar um botão 'Avançar'/'Concluir'/'Enviar' no lugar do 'Enter' genérico (atributo enterKeyHint). Hoje isso só existe em duas telas (busca e ContratosTab). Nos formulários principais — cadastro de contratante (FormPanel) e, principalmente, o formulário público do cliente (ClientFormQR) — não tem. Sem isso, o cliente preenche um campo, não sabe que botão apertar, e fica confuso entre fechar o teclado e ir para o próximo campo.

**Ganho:** O cliente e a equipe preenchem o formulário mais rápido no celular: o teclado mostra 'Avançar' campo a campo e 'Enviar' no último, guiando o dedo.

**Onde:** client/src/components/ClientFormQR.jsx (campos do form público) e FormPanel.jsx (campos do contratante) — adicionar enterKeyHint="next" nos campos e enterKeyHint="send"/"done" no último

### 7. Tela do formulário público usa altura '100vh' antiga (some um pedaço no iPhone)
`baixo / baixo / baixo`

**O que é:** O formulário público do cliente (ClientFormQR.jsx, linhas 235 e 250) e suas telas de carregamento usam 'min-h-screen' (altura de tela 100vh, a forma antiga). No iPhone, 100vh é MAIOR que a área realmente visível por causa da barra do Safari, então o conteúdo centralizado fica deslocado para baixo e parte pode ficar escondida atrás da barra. O resto do app já migrou para a unidade nova (dvh) que respeita a área visível; este formulário público ficou para trás.

**Ganho:** A tela que o cliente vê ao escanear o QR fica centralizada corretamente no iPhone, sem conteúdo cortado pela barra do navegador. Melhora a primeira impressão do cliente.

**Onde:** client/src/components/ClientFormQR.jsx:235 e :250 — trocar min-h-screen por min-h-[100dvh]

### 8. Botão de capturar documento (CNH) não abre a câmera direto no celular
`baixo / baixo / baixo`

**O que é:** O botão de leitura de CNH/documento (OCR) usa um seletor de arquivo comum (FormPanel.jsx:637, accept="image/*,.pdf"). No celular isso abre o menu 'galeria/arquivos/câmera', exigindo toques extras. Para um fluxo de cadastro presencial (cliente na frente do advogado), seria mais rápido um botão dedicado com 'capture="environment"', que abre direto a câmera traseira. Hoje, capturar a CNH na hora dá mais trabalho do que precisaria.

**Ganho:** No atendimento presencial, fotografar a CNH do cliente vira um toque que já abre a câmera, agilizando o cadastro com OCR.

**Onde:** client/src/components/FormPanel.jsx:637 — oferecer uma segunda opção de input com capture="environment" (mantendo o upload de arquivo/PDF atual)

### 9. Lista de resultados da busca global pode passar do teclado no celular
`baixo / baixo / baixo`

**O que é:** A busca global (Cmd+K / lupa no celular) abre uma caixa a 15% do topo da tela e a lista de resultados tem altura fixa de 350px (GlobalSearch.jsx:152 e 169). Quando o teclado do celular sobe, a soma 'espaço do topo + caixa de busca + 350px de resultados' pode ultrapassar a área visível, escondendo os últimos resultados atrás do teclado num iPhone pequeno (SE/mini). O ideal é a altura da lista se ajustar à tela disponível (usar dvh) em vez de um número fixo.

**Ganho:** No celular, todos os resultados da busca aparecem acima do teclado, sem precisar fechar o teclado para ver o que foi encontrado.

**Onde:** client/src/components/GlobalSearch.jsx:169 (max-h-[350px]) e :152 (pt-[15vh]) — usar altura relativa à viewport visível no phone

### 10. Portal do cliente (página pública) não reage ao teclado e capitaliza a pergunta
`medio / baixo / baixo`

**O que é:** A página pública do portal (client/portal.html), que o cliente abre no celular para acompanhar o processo, tem a tag de viewport SEM 'interactive-widget=resizes-content' (linha 5) — diferente do app principal, que tem. Sem isso, ao abrir o teclado para escrever uma pergunta ou o NPS (textareas nas linhas 871 e 1123), o conteúdo não se reorganiza e o campo pode ficar escondido atrás do teclado. Além disso, esses campos de texto não desligam a capitalização/autocorreção. É a tela com mais clientes finais entrando pelo celular.

**Ganho:** O cliente consegue escrever a pergunta ou o feedback no celular vendo o que digita (campo acima do teclado) e sem o iOS atrapalhar com correções. Portal passa uma imagem mais profissional.

**Onde:** client/portal.html:5 (meta viewport) e textareas em :871 e :1123 — alinhar a meta com a do app principal e revisar capitalização

### 11. Faixa de filtros dos Boletos vira uma 'salada' no celular (datas e divisores quebrando linha)
`baixo / medio / baixo`

**O que é:** A barra de filtros dos Boletos (BoletosPanel.jsx, ~linha 1180) tem 'flex-wrap' (então não estoura a tela — isso está OK), mas ela junta muitos controles em sequência: chips de status, dois campos de data ('vencimento entre ... e ...'), dois menus suspensos e barrinhas divisórias verticais. No celular, esses elementos quebram em várias linhas de forma desorganizada, com os divisores verticais (h-4 w-px) e os rótulos soltos perdendo o sentido. Funciona, mas fica visualmente confuso e difícil de operar com o dedo.

**Ganho:** Filtrar boletos no celular fica mais claro: agrupar os filtros em blocos empilhados (status / período / atraso / ordenação) em vez de uma fileira que quebra sozinha.

**Onde:** client/src/components/BoletosPanel.jsx:~1180 (bloco flex-wrap dos filtros) — reorganizar em grupos empilhados no breakpoint phone

### 12. Campo CPF do formulário público aceita digitação livre demais (sem limite e sem máscara visível)
`medio / baixo / baixo`

**O que é:** No formulário público do cliente (ClientFormQR.jsx:265), o CPF é um campo type=text com teclado numérico (inputMode="numeric"), mas SEM aplicar máscara (000.000.000-00) enquanto o cliente digita e sem maxLength. O cliente pode digitar dígitos demais ou em formato torto. No cadastro interno (FormPanel) já existe a máscara maskCPF; no formulário do cliente, não. CPF mal formatado quebra a busca, a deduplicação e o envio para ZapSign/ADVBOX.

**Ganho:** O cliente digita o CPF já formatado e com a quantidade certa de dígitos, reduzindo cadastros com CPF inválido que travam contrato e cobrança lá na frente.

**Onde:** client/src/components/ClientFormQR.jsx:265 (CPF) e :269 (RG) — aplicar a mesma máscara usada no FormPanel e limitar tamanho

### 13. O dock flutuante fica visível ao redor dos modais centralizados no celular
`baixo / medio / medio`

**O que é:** O dock de navegação (Novo/Salvos/Dashboard/Mais) foi corretamente colocado ATRÁS dos modais em z-index (z-45 vs z-50, index.css:1154), então não cobre mais os botões. Porém, como os modais são centralizados com um fundo translúcido, o dock continua APARECENDO nas bordas inferiores por trás do modal. Visualmente fica poluído e o usuário pode tentar tocar no dock (que está bloqueado pelo fundo do modal) e achar que travou. O ideal é o dock se esconder enquanto um modal está aberto.

**Ganho:** Quando um modal abre no celular, a tela fica limpa e focada na tarefa; o usuário não se confunde tentando tocar no dock por baixo do modal.

**Onde:** client/src/App.jsx:1573 (render do dock) — ocultar o dock quando houver modal aberto (já existem estados como showShortcuts, showNavSheet, modais de cada aba)

### 14. useDeviceType só atualiza o tipo de aparelho a cada 100ms com debounce — rotação/teclado podem atrasar o layout
`baixo / medio / medio`

**O que é:** O 'detector de aparelho' (useDeviceType.js) recalcula se é celular/tablet/desktop com um atraso (debounce de 100ms + rAF). Ao girar o iPhone/iPad ou ao abrir/fechar o teclado (que muda a altura), o layout pode demorar um instante para se ajustar, e em certos casos (a própria documentação cita testes onde o resize 'não re-tiera') o app pode ficar momentaneamente no modo errado — por exemplo, mostrando top tabs em vez do dock logo após girar. Vale ouvir também o evento de mudança das media queries (matchMedia) e o visualViewport, que disparam de forma mais confiável que o resize no iOS.

**Ganho:** Ao girar o aparelho ou abrir o teclado, a interface se reorganiza na hora certa (dock, abas, preview), sem aquele meio segundo de layout 'quebrado'.

**Onde:** client/src/hooks/useDeviceType.js (listeners de resize/orientationchange) — adicionar listeners de matchMedia('(pointer:coarse)'/'(orientation)') e window.visualViewport

## Integridade de Dados & Regras de Negócio

### 1. signed_at nao e preenchido quando o contrato e assinado (so no import manual)
`alto / baixo / baixo`

**O que é:** Quando um contrato e assinado de verdade pelo ZapSign, o sistema marca o status como 'assinado' mas NAO grava a data/hora real da assinatura na coluna signed_at. Isso acontece nos tres caminhos que confirmam assinatura: o polling de 5min (App.jsx linha 614-617), o webhook do ZapSign (zapsign-webhook.mjs linha 102-112) e o sync manual da aba Contratos (ContratosTab.jsx linha 905-910). Em todos, a data que o ZapSign devolve (signedAt de cada signatario) ja esta carregada na variavel updatedLinks, mas e jogada fora. So o fluxo de IMPORTACAO MANUAL (importContrato.js linha 67) grava signed_at corretamente. Resultado: a maioria dos contratos assinados normalmente fica com signed_at vazio, e o Dashboard tem que 'adivinhar' a data usando um fallback (signed_at -> advbox_date -> updated_at), o que distorce relatorios de tempo ate assinatura, producao mensal e comissoes. O CLAUDE.md ja admite '31 assinados antigos nao tem signed_at' — mas a causa raiz nunca foi corrigida, entao o problema continua crescendo. A correcao e simples: nas tres transicoes para 'assinado', gravar signed_at com a data do ultimo signatario que assinou (ou agora() como fallback).

**Ganho:** Relatorios de prazo de assinatura, producao mensal e comissoes passam a usar a data REAL de assinatura, nao uma aproximacao. Acaba o conserto eterno de dados faltantes.

**Onde:** client/src/App.jsx (linha ~616), client/netlify/functions/zapsign-webhook.mjs (linha ~108), client/src/components/ContratosTab.jsx (linha ~907)

### 2. Botao manual 'Enviar ADVBOX' nao usa trava — pode criar cliente e processo DUPLICADOS
`alto / medio / baixo`

**O que é:** Existem dois caminhos que mandam o contrato para o ADVBOX: (1) o robo automatico de 5 em 5 minutos (App.jsx), que ANTES de chamar marca o contrato como 'processing' com uma trava atomica (so um processa por vez); e (2) o botao manual 'Enviar ADVBOX' na aba Contratos (ContratosTab.jsx, AdvboxSyncButton, linha 60), que dispara DIRETO, sem nenhuma trava. Se alguem clicar nesse botao no exato momento em que o robo automatico tambem esta processando o mesmo contrato (janela de ate alguns segundos), os DOIS chamam o advbox-sync ao mesmo tempo. O advbox-sync ate evita cliente duplicado (procura pelo CPF), mas NAO evita PROCESSO (lawsuit) duplicado — ele sempre cria um lawsuit novo. Resultado: o mesmo cliente fica com dois processos identicos no CRM juridico, bagunçando a carteira e o BI. A correcao e fazer o botao manual usar a mesma trava 'processing' (UPDATE condicional) que o robo usa, antes de chamar o ADVBOX.

**Ganho:** Elimina o risco de processos juridicos duplicados no ADVBOX quando o robo e a pessoa agem ao mesmo tempo. Carteira e BI confiaveis.

**Onde:** client/src/components/ContratosTab.jsx (AdvboxSyncButton, linha 51-78) vs client/src/App.jsx (claim atomico linha 653-657)

### 3. Botao 'Lancar' cobranca no Asaas nao verifica se ja existe boleto — risco de cobranca em dobro
`alto / medio / baixo`

**O que é:** Na aba Asaas, o botao 'Lancar' cria a cobranca (boleto) do cliente chamando asaas-sync 'create-payment'. O problema: essa funcao SEMPRE cria um boleto novo no Asaas, sem nunca perguntar antes 'ja existe um boleto para este contrato?'. A unica protecao e o estado local 'loading'/'done' do botao na tela — que nao protege se: a pessoa abrir a tela em dois computadores, recarregar a pagina e clicar de novo, ou se houver uma falha parcial (o boleto foi criado no Asaas mas o banco nao registrou asaas_status='launched'). Em qualquer um desses casos, o cliente recebe DOIS boletos do mesmo valor — um problema serio de dinheiro e de imagem. O proprio asaas-sync ja recebe o contractId e o grava como externalReference no Asaas; bastaria, antes de criar, fazer um listPayments por externalReference=contractId e, se ja houver um, devolver o existente em vez de criar outro.

**Ganho:** Acaba o risco de cobrar o cliente duas vezes. Lancar a cobranca vira uma operacao segura mesmo com clique duplo, dois dispositivos ou falha parcial.

**Onde:** client/netlify/functions/asaas-sync.mjs (case 'create-payment', linha 148-188) e client/src/components/AsaasPanel.jsx (funcao go, linha 92-137)

### 4. Edicao de contrato salva offline vira DUPLICATA em vez de atualizar o original
`medio / medio / baixo`

**O que é:** Quando voce edita um contrato que JA existe e o salvamento falha (queda de internet), o sistema joga os dados numa 'fila offline' no navegador (App.jsx linha 1014). Quando a internet volta, essa fila e sincronizada SEMPRE com um INSERT — ou seja, cria um contrato NOVO (App.jsx linha 173, syncOfflineQueue). O problema: o id do contrato original nao e guardado na fila (buildContratoRow nem inclui o id), entao uma edicao que caiu offline reaparece como um contrato DUPLICADO no lugar de atualizar o que ja existia. Isso gera dois registros do mesmo cliente/resort, bagunça a deteccao de duplicatas, infla estatisticas e confunde quem ve a lista. A correcao e guardar o savedContractId na fila offline e, na sincronizacao, fazer UPDATE quando houver id e INSERT so quando for contrato novo.

**Ganho:** Edicoes feitas sem internet voltam para o contrato certo, sem criar copias fantasma. Lista e estatisticas continuam limpas.

**Onde:** client/src/App.jsx (syncOfflineQueue linha 167-179, handleSaveContract catch linha 1013-1016, buildContratoRow linha 182-208)

### 5. Webhook do ZapSign e do Asaas dependem de uma chave que nao esta configurada — assinaturas em tempo real podem estar falhando em silencio
`alto / baixo / baixo` `JÁ CONHECIDO`

**O que é:** O webhook do ZapSign (zapsign-webhook.mjs) so funciona com a SUPABASE_SERVICE_ROLE_KEY: se ela nao existir, o handler responde erro 500 logo no inicio (linha 49-51) e NAO atualiza nada. O CLAUDE.md afirma que essa chave NAO esta configurada no Netlify. Se isso estiver correto, o webhook 'em tempo real' que deveria ser a fonte principal de atualizacao de status esta retornando erro a cada evento, e o sistema esta sobrevivendo apenas pelo polling de 5 em 5 minutos — ou seja, ha ate 5 minutos de atraso e dependencia de alguem ter o app aberto. Vale auditar nos logs de funcao do Netlify se o zapsign-webhook esta de fato gravando (status 200) ou estourando 500. Se estiver quebrado, ou se configura a chave, ou se faz o webhook cair para a chave anon (como as outras funcoes ja fazem). Mesma logica vale para confirmar que o asaas-webhook (que emite NF) esta usando a chave certa para escrever no espelho.

**Ganho:** Garante que assinaturas e pagamentos sejam refletidos na hora, sem depender do robo de 5min nem de ter o app aberto. Evita um ponto cego silencioso.

**Onde:** client/netlify/functions/zapsign-webhook.mjs (linha 14, 49-51); confirmar via logs do Netlify

### 6. Data de assinatura enviada ao ADVBOX e sempre 'hoje', nao a data real em que o cliente assinou
`medio / baixo / baixo`

**O que é:** Quando o robo automatico cria o processo no ADVBOX (App.jsx linha 662), ele envia dataAssinatura = new Date() (a data de HOJE, momento em que o robo rodou), e nao a data em que o cliente realmente assinou no ZapSign. O advbox-sync usa essa data como status_closure (data de fechamento do negocio). Como o robo so roda de 5 em 5 minutos e os webhooks podem ter atraso, na pratica a data de fechamento ate fica proxima — MAS, se um contrato ficou pendente de processamento por horas (lock orfao, erro de ADVBOX que so resolveu no dia seguinte, app fechado), a data de fechamento no ADVBOX fica errada por dias. Pior: o datajud-refresh depois usa esse status_closure do ADVBOX para BACKFILL do signed_at do proprio sistema (datajud-refresh.mjs linha 150) — entao o erro se propaga de volta. O ideal e enviar a data real de assinatura (do signed_at / do ZapSign) em vez de new Date().

**Ganho:** Data de fechamento do negocio no ADVBOX e nos relatorios reflete quando o cliente assinou de fato, nao quando o robo conseguiu processar. Comissoes e BI por periodo ficam corretos.

**Onde:** client/src/App.jsx (linha 662, body do advbox-sync) e client/netlify/functions/advbox-sync.mjs (linha 326, dataFechamento)

### 7. Notas no Kommo podem duplicar quando a verificacao de 'ja existe' falha
`medio / baixo / baixo`

**O que é:** A funcao kommo-note evita duplicar notas no CRM comercial: antes de postar, ela busca as notas do lead e checa se ja existe uma com o mesmo marcador. O problema esta na linha 65 (kommo-note.mjs): se essa verificacao FALHAR (por exemplo um erro 429 de excesso de requisicoes ou um 500 temporario do Kommo), o codigo simplesmente ignora o erro e POSTA A NOTA MESMO ASSIM ('se a checagem falhar, segue e posta'). Como o proprio CLAUDE.md diz que a API do Kommo NAO permite apagar notas, cada falha transitoria na verificacao vira uma nota duplicada permanente no lead do cliente. Alem disso, o casamento do marcador usa 'inclui o texto' (linha 35), entao um marcador como 'CBC.fase:Inicial' pode bater com 'CBC.fase:Inicial Recursal' por engano. A correcao: quando a verificacao de duplicidade falhar, NAO postar (tratar como 'provavelmente ja existe') e usar comparacao exata do marcador.

**Ganho:** Para de poluir os leads no Kommo com notas repetidas que nao podem ser apagadas. Vendedores veem um historico limpo.

**Onde:** client/netlify/functions/kommo-note.mjs (jaTemNota linha 27-36, fallback linha 65)

### 8. ADVBOX marca o contrato como 'ok' mesmo quando so o cliente foi criado e o processo falhou parcialmente
`medio / medio / medio`

**O que é:** O advbox-sync cria PRIMEIRO o cliente e DEPOIS o processo. Se o processo (lawsuit) falhar, ele vira um aviso (warning) e a funcao retorna success:true com o customer criado. O App.jsx ja foi corrigido (QW#2) para so marcar 'ok' se tambem houver lawsuit.id — bom. POREM, quando o advbox-sync e re-tentado depois (porque ficou 'error'), ele cria o cliente DE NOVO. Como o cliente ja existe, o ADVBOX retorna erro de duplicado e a funcao acha o cliente existente pelo CPF (linha 163-166) — ok. Mas o findCustomerByCPF (linha 108) baixa a LISTA INTEIRA de clientes do ADVBOX e procura na memoria, o que e fragil e lento conforme a base cresce, e pode falhar/expirar em uma base grande, fazendo o retry travar para sempre em 'error'. Vale: (a) usar busca por CPF na API do ADVBOX em vez de baixar tudo, e (b) guardar o advbox_customer_id no banco apos a 1a criacao, para o retry pular direto para a criacao do processo sem recriar o cliente.

**Ganho:** Retry de ADVBOX para de recriar clientes e de depender de baixar a base inteira. Contratos que falharam no meio se completam de forma confiavel.

**Onde:** client/netlify/functions/advbox-sync.mjs (findCustomerByCPF linha 108-124, createCustomer linha 159-167, fluxo principal linha 333-372)

### 9. Deteccao de duplicata nao funciona para resort 'Outro' (digitado a mao)
`baixo / medio / baixo`

**O que é:** Ao criar contrato, o sistema avisa se aquele CPF + Resort ja tem contrato (duplicateDetector.js). A checagem compara a coluna 'resort' do banco com o resort do formulario. Mas quando o usuario escolhe 'Outro' e digita um nome de resort livre, esse nome vai para a coluna resort com a grafia exata que a pessoa digitou. Como a comparacao e por igualdade exata (eq), dois contratos do mesmo cliente para o mesmo resort 'Outro' digitado com qualquer diferenca (acento, espaco, maiuscula, 'Resort X' vs 'resort x') NAO sao detectados como duplicata. Alem disso, a deteccao so verifica cpf_contratante1 e cpf_contratante2 nas COLUNAS flat — se o contrato antigo tiver o CPF so dentro do JSON 'dados' (importados/legados), tambem escapa. O aviso de duplicata, que ja e so um alerta (nao bloqueia, por regra), fica menos confiavel justamente nos casos de digitacao livre.

**Ganho:** O alerta de 'cliente ja tem contrato neste resort' passa a pegar tambem os resorts digitados a mao, evitando contratos em dobro por engano.

**Onde:** client/src/utils/duplicateDetector.js (checkDuplicate linha 11-49)

### 10. Colunas 'planas' do contrato (CPF, honorarios, resort) podem ficar desatualizadas em relacao ao JSON 'dados'
`medio / alto / medio`

**O que é:** Cada contrato e salvo de duas formas ao mesmo tempo: o objeto completo no campo JSON 'dados' E uma copia de alguns campos em colunas separadas (cpf_contratante1, honorarios_total, resort, etc), montadas pelo buildContratoRow. Essas colunas planas sao a fonte de muitos relatorios e da deteccao de duplicatas. O risco: varios pontos do sistema fazem UPDATE so de 'dados' (ou so de algumas colunas) sem reescrever as colunas planas correspondentes — por exemplo, edicoes pontuais, imports, ou ajustes via automacao. Quando isso acontece, o relatorio mostra um valor de honorario antigo enquanto o contrato (em 'dados') tem outro, ou o CPF da coluna nao bate com o CPF do JSON. Como nao ha uma 'fonte unica da verdade' garantida por banco, esses desencontros passam despercebidos. A solucao mais robusta e um gatilho (trigger) no Postgres que, a cada gravacao de 'dados', recalcula as colunas planas a partir do JSON — assim elas nunca divergem, independentemente de quem escreveu.

**Ganho:** Garante que o que aparece nos relatorios (valor, CPF, resort) seja sempre igual ao conteudo real do contrato, eliminando divergencias silenciosas.

**Onde:** client/src/App.jsx (buildContratoRow linha 182-208) + um trigger novo na tabela contratos (Supabase)

### 11. Recusa de assinatura cancela o contrato cedo demais (quando ha 2 signatarios)
`medio / baixo / medio`

**O que é:** No webhook do ZapSign (zapsign-webhook.mjs linha 99 e 104-105), se QUALQUER signatario aparecer com status 'refused', o contrato inteiro vira 'cancelado'. Em contratos com 2 contratantes (marido e esposa, por exemplo), basta um deles recusar — talvez por engano ou por ter clicado errado — para o contrato ser cancelado automaticamente, mesmo que o outro ja tenha assinado e a situacao ainda seja recuperavel. Status 'cancelado' tem efeitos: sai das estatisticas, sai da deteccao de duplicatas, e nao volta sozinho. Vale revisar se a recusa de UM signatario deve mesmo cancelar tudo na hora, ou se deveria virar um estado de alerta ('assinatura recusada — verificar') que a equipe trata manualmente, evitando cancelamentos automaticos indevidos.

**Ganho:** Evita cancelar contratos bons por uma recusa acidental de um dos signatarios. A equipe decide o que fazer em vez do robo cancelar sozinho.

**Onde:** client/netlify/functions/zapsign-webhook.mjs (linha 99, 104-112)

### 12. Regua de cobranca: checa-e-insere sem trava, pode mandar lembranca duplicada ao cliente
`medio / baixo / baixo`

**O que é:** A regua de cobranca (cobranca-regua.mjs) decide se ja cobrou aquele boleto naquela etapa fazendo um SELECT (linha 90-91) e, se nao achou, faz um INSERT no final (linha 123). Entre o SELECT e o INSERT ha uma janela: se a funcao rodar duas vezes proximas (re-trigger, retry, ou execucao concorrente), as duas podem nao achar o registro e as duas inserem — resultando em DUAS notas no Kommo e/ou dois WhatsApps para o mesmo cliente sobre a mesma parcela. Como o insert nao e um upsert com chave unica (boleto_id + etapa), nada impede a duplicidade no banco. A correcao e criar uma restricao unica (boleto_id, etapa) na tabela cobranca_regua e trocar o insert por upsert com onConflict — assim o banco garante 'uma vez por boleto/etapa' mesmo sob concorrencia.

**Ganho:** Cliente nao recebe a mesma cobranca duas vezes. A garantia de 'uma lembranca por etapa' passa a ser do banco, nao de uma checagem fragil.

**Onde:** client/netlify/functions/cobranca-regua.mjs (linha 90-92 e 123-126) + constraint unica na tabela cobranca_regua

### 13. Prioridade idoso usa um calculo de idade impreciso (anos com 365,25 dias)
`baixo / baixo / baixo`

**O que é:** Para acionar o alerta de 'prioridade de idoso' (60+), o advbox-sync calcula a idade dividindo a diferenca de tempo por 365,25 dias (advbox-sync.mjs linha 220). Isso e uma aproximacao: para alguem que faz 60 anos exatamente nesses dias, o calculo pode dar 59 ou 60 dependendo de anos bissextos acumulados, fazendo o sistema NAO pedir a prioridade de quem ja tem direito (ou pedir para quem ainda nao tem). O mesmo padrao aparece em outros pontos do app que calculam idade. Como prioridade de idoso e um direito processual relevante (e a Regra #12 do projeto), vale calcular a idade pela data de aniversario de verdade (comparando ano/mes/dia), nao por divisao aproximada.

**Ganho:** O pedido de prioridade de idoso passa a sair certinho para todo cliente com 60+ no dia, sem erro de borda. Direito do cliente garantido.

**Onde:** client/netlify/functions/advbox-sync.mjs (linha 218-224)

### 14. Sem garantia de unicidade no banco para token do ZapSign e id de pagamento do Asaas
`medio / baixo / baixo`

**O que é:** Varias automacoes localizam o contrato pelo zapsign_doc_token (webhook) e o espelho do Asaas usa o id do pagamento como chave. O sistema confia que esses valores sao unicos, mas se nao houver restricao UNIQUE no banco para zapsign_doc_token (em contratos) e para os ids no espelho (asaas_boletos), uma falha ou re-processamento pode criar dois contratos com o mesmo token, e o webhook do ZapSign usa maybeSingle() — que estoura erro se achar mais de um, parando a atualizacao em silencio. Garantir UNIQUE em zapsign_doc_token e nas chaves do espelho transforma uma possivel inconsistencia silenciosa em algo que o banco impede na origem. Vale auditar quais dessas restricoes ja existem e adicionar as que faltam.

**Ganho:** O banco impede dois contratos com o mesmo documento ZapSign e dois espelhos do mesmo boleto, fechando uma porta para inconsistencias que hoje so apareceriam como bug estranho.

**Onde:** Tabela contratos (coluna zapsign_doc_token) e asaas_boletos (id) no Supabase; uso em zapsign-webhook.mjs (maybeSingle linha 71)

### 15. Drive marcado 'failed' so re-tenta se houver data de ultima tentativa — falhas antigas sem data ficam presas
`medio / medio / baixo`

**O que é:** O upload para o Google Drive tem auto-cura: um upload 'failed' volta a tentar depois de 6 horas (App.jsx linha 736-743). Mas essa logica calcula a idade da falha a partir de drive_last_attempt_at; se esse campo estiver vazio (Infinity), a condicao 'idadeFalha > 6h' ate passa e cura — ok nesse ponto. O risco real esta na combinacao com o limite de tentativas: quando o lock orfao e liberado mas drive_attempts ja bateu o maximo (linha 713-728), o contrato vira 'failed' permanente e so a regra das 6h o ressuscita. Se por algum motivo a data de tentativa nao for atualizada corretamente em todos os caminhos, alguns contratos podem nunca mais tentar subir os PDFs assinados para a pasta do cliente — ficando sem o documento arquivado sem ninguem perceber. Vale um relatorio/alerta no Monitor listando contratos assinados ha mais de X dias que continuam sem drive_file_id valido (nem 'saved'), para nenhum cair no esquecimento.

**Ganho:** Nenhum contrato assinado fica sem os PDFs arquivados no Drive sem alguem ser avisado. Visibilidade sobre uploads que falharam de vez.

**Onde:** client/src/App.jsx (logica Drive linha 691-838); novo alerta no Monitor (MonitorPanel.jsx / MonitorAdvbox.jsx)

## Qualidade de Código & Dívida Técnica

### 1. Bug real: variavel 'd' indefinida no log de erro do upload pro Drive (App.jsx)
`alto / baixo / baixo`

**O que é:** Quando o sistema TENTA salvar o documento assinado no Google Drive e DA ERRADO, o codigo que registra o erro usa uma variavel chamada 'd' que so existe dentro do bloco de sucesso (linha 777). No bloco de erro (linha 832) essa variavel nao existe mais, entao a linha que tenta gravar o nome do cliente no log quebra com um erro de programacao. Como esse trecho esta dentro de um 'try/catch' vazio, a falha fica ESCONDIDA: o log do erro do Drive simplesmente nao e gravado, e voce perde a informacao de qual cliente falhou no envio pro Drive bem na hora em que mais precisa dela. O conserto e usar 'c.dados' em vez de 'd' na linha 832.

**Ganho:** Para de perder o registro de quais contratos falharam no envio ao Google Drive — a equipe passa a ver no Monitor exatamente quem nao subiu e por que, em vez de descobrir tarde.

**Onde:** client/src/App.jsx linha 832 (campo client_name no insert de automation_log dentro do catch do upload Drive)

### 2. Codigo morto: pasta steps/ (wizard antigo de 7 telas) ainda no projeto
`medio / baixo / baixo` `JÁ CONHECIDO`

**O que é:** Existe uma pasta inteira (client/src/steps/ com Step1 a Step7) que era o formulario antigo em formato de 'assistente de 7 passos'. Esse formato foi substituido pelo formulario de pagina unica (FormPanel) e NENHUM desses arquivos e importado em lugar nenhum hoje — confirmei buscando todos os imports. Sao ~33 KB de codigo que ninguem usa, mas que ainda aparece no lint (gera erros), confunde quem le o codigo achando que e o formulario de verdade, e entra nas buscas. Alguns desses arquivos foram ate 'tocados' por engano no redesign mobile (datas de 12/06), o que mostra como geram trabalho a toa.

**Ganho:** Menos confusao para quem mexe no codigo (ninguem mais edita o arquivo errado), build/lint mais limpos, repositorio menor.

**Onde:** client/src/steps/ (Step1NumContratantes ate Step7ZapSign) — apagar a pasta inteira

### 3. Codigo morto: componente Stepper.jsx nunca usado
`baixo / baixo / baixo` `JÁ CONHECIDO`

**O que é:** O arquivo client/src/components/Stepper.jsx (a barra de progresso do wizard antigo) tambem nao e importado por nenhum lugar — e gemeo da pasta steps/. Fica la apenas como peso morto. Vale remover junto com a pasta steps/.

**Ganho:** Mesma limpeza: um arquivo a menos para confundir e manter.

**Onde:** client/src/components/Stepper.jsx

### 4. 113 erros e 17 avisos de lint acumulados — o 'npm run lint' nunca fica verde
`alto / medio / baixo`

**O que é:** Rodando o verificador de qualidade (eslint) hoje, ele aponta 130 problemas: 42 blocos 'catch' vazios (erros engolidos sem avisar ninguem), 39 variaveis declaradas e nunca usadas, 11 escapes desnecessarios em buscas de texto, 8 casos de mudar estado dentro de efeito (pode deixar a tela mais lenta) e 3 erros graves de variavel/constante indefinida (incluindo o bug do Drive citado acima). Como o lint sempre 'estoura', a equipe se acostuma a ignora-lo, entao um erro NOVO de verdade passa despercebido no meio dos antigos. A correcao e fazer um mutirao para zerar esses 130 e so entao manter o lint travando o deploy.

**Ganho:** O verificador volta a ser util: quando ele apita, e porque tem algo novo errado de verdade — vira uma rede de seguranca antes de cada publicacao.

**Onde:** client/ (130 problemas em ~28 arquivos; ver 'npm run lint'). Destaques: ZapSignModal.jsx, ocrService.js, contractHtml.js, App.jsx, hooks/useDarkMode|useDensity|useCepLookup

### 5. 42 blocos 'catch {}' vazios escondem erros silenciosamente
`medio / medio / baixo`

**O que é:** Em 42 pontos do codigo (frontend e funcoes do servidor) ha o padrao 'tente fazer isto; se der erro, nao faca nada' — literalmente um bloco vazio. Isso significa que falhas reais (gravar um log, salvar rascunho, postar uma nota no Kommo, enviar progresso do OCR) acontecem e desaparecem sem deixar rastro. Quando algo 'simplesmente nao funcionou' e ninguem sabe por que, normalmente e um desses. O ideal e, no minimo, registrar o erro (console.warn ou gravar no log de erros) em cada um desses pontos, em vez de engolir.

**Ganho:** Quando algo falhar, voce vai conseguir descobrir o motivo em vez de ficar no escuro — menos 'fantasmas' que ninguem consegue reproduzir.

**Onde:** client/src/ e client/netlify/functions/ — 43 ocorrencias de catch vazio (ex.: App.jsx multiplas, AuthContext.jsx:59 e :118, ocrService.js:78, ContractContext.jsx)

### 6. Chave de acesso ao banco escrita 'na mao' (copiada) em 8 funcoes do servidor
`medio / baixo / baixo`

**O que é:** O token longo de acesso ao banco (a 'anon key') esta digitado como texto fixo dentro de 8 funcoes serverless (api-rest, api-powerbi, health, datajud-refresh, asaas-sync, e outras), em vez de ser lido de uma variavel de ambiente unica. A URL do banco tambem aparece copiada em 8 arquivos. Problema pratico: no dia em que essa chave precisar ser TROCADA (e ela vai, faz parte da pendencia de seguranca conhecida), sera preciso editar 8 arquivos um a um — e basta esquecer um para o sistema parar de funcionar parcialmente. A solucao e ler tudo de process.env num unico ponto (uma mini-funcao compartilhada em _lib/) e remover as copias.

**Ganho:** Trocar a chave do banco vira uma mudanca de 1 lugar, sem risco de esquecer um arquivo e quebrar uma integracao no meio.

**Onde:** client/netlify/functions/{api-rest,api-powerbi,health,datajud-refresh,asaas-sync,advbox-create-task,advbox-vendas-sync,commission-calculator}.mjs — centralizar num helper em _lib/

### 7. Status do contrato ('assinado', 'enviado_zapsign'...) espalhados como texto solto em ~100 lugares
`medio / medio / baixo`

**O que é:** Os nomes dos estados do contrato sao escritos como texto cru pelo codigo todo: 'assinado' aparece 57 vezes, 'enviado_zapsign' 21, 'cancelado' 14, 'rascunho' 8. Nao existe um arquivo unico que diga 'estes sao os status validos'. Isso e perigoso porque um erro de digitacao (ex.: 'assinando' em vez de 'assinado') nao e pego por ninguem e o contrato 'some' das contagens. Tambem dificulta mudar um nome de status no futuro. A correcao e criar um arquivo constants/contrato.js com STATUS = {RASCUNHO, ENVIADO, ASSINADO, CANCELADO} e usar essas constantes no lugar do texto solto.

**Ganho:** Acaba o risco de digitar um status errado e o contrato sumir dos relatorios; mudar regras de status passa a ser seguro e centralizado.

**Onde:** client/src/ — criar client/src/constants/contrato.js e substituir os literais nos ~30 arquivos que usam status

### 8. Formatacao de dinheiro (R$) reimplementada em ~24 telas diferentes
`baixo / medio / baixo`

**O que é:** Ja existe uma funcao pronta 'formatCurrency' em dashboard/format.js, mas ela so e usada no Dashboard. As outras ~24 telas (Boletos, Asaas, Vendas, Socios, Monitor, busca global, etc.) cada uma escreve do seu jeito o codigo de formatar valor em reais (toLocaleString com 'currency'). Resultado: o mesmo valor pode aparecer 'R$ 1.000' numa tela e 'R$ 1.000,00' em outra, e qualquer ajuste (ex.: esconder centavos) precisa ser feito 24 vezes. A solucao e mover formatCurrency para um util compartilhado (utils/format.js) e usar em todas as telas.

**Ganho:** Valores em reais ficam iguais no sistema inteiro e qualquer mudanca de formato e feita uma vez so.

**Onde:** client/src/components/dashboard/format.js (mover para utils/) e os ~24 arquivos que chamam toLocaleString('pt-BR') com currency

### 9. Servidor: versao modular completa existe em server/src/ mas roda o monolito de 1355 linhas
`medio / alto / medio` `JÁ CONHECIDO`

**O que é:** A pasta server/ tem DUAS versoes do backend: o arquivo unico index.js com 1355 linhas (o que realmente roda hoje, via 'node index.js') E uma versao reorganizada em server/src/ com tudo separado em rotas, servicos, middleware e jobs (17 rotas, 6 servicos prontos). A reorganizacao foi feita mas a 'virada de chave' nunca aconteceu — o index.js nem importa o src/. Ou seja, mantem-se duas copias do mesmo backend, e correcoes precisam ser feitas em dobro (ou esquecidas numa das versoes). E preciso decidir: ou completar a virada para server/src/ (apontando o start para ele e apagando o index.js), ou apagar o server/src/ se ele estiver obsoleto.

**Ganho:** Acaba a manutencao dupla e a duvida de 'qual versao do servidor esta valendo' — uma fonte unica de verdade.

**Onde:** server/index.js (monolito ativo) vs server/src/* (modular, nunca ativado); server/package.json aponta start para index.js

### 10. Funcoes Asaas quase duplicadas: sync-boletos vs sync-boletos-background, sync-customer vs sync-customers
`baixo / medio / medio` `JÁ CONHECIDO`

**O que é:** Na pasta de funcoes serverless ha pares com nomes parecidos que fazem coisas sobrepostas: asaas-sync-boletos.mjs e asaas-sync-boletos-background.mjs, asaas-sync-customer.mjs e asaas-sync-customers.mjs, alem do asaas-sync.mjs (12 KB). Parte da logica ja foi extraida para a lib compartilhada _lib/asaasMirror.mjs (bom), mas ainda sobra codigo repetido entre os arquivos e e dificil saber qual e o ponto de entrada 'oficial'. Vale revisar esses 5 arquivos, consolidar o que e identico em asaasMirror e deixar claro qual funcao e o gatilho e qual e o trabalhador de fundo.

**Ganho:** Menos chance de corrigir um bug de cobranca em um arquivo e esquecer o gemeo; fica obvio qual funcao faz o que.

**Onde:** client/netlify/functions/asaas-sync.mjs, asaas-sync-boletos.mjs, asaas-sync-boletos-background.mjs, asaas-sync-customer.mjs, asaas-sync-customers.mjs

### 11. Componentes gigantes: VendasPanel 2505, ContratosTab 2041, FormPanel 1798, App.jsx 1633 linhas
`medio / alto / medio` `JÁ CONHECIDO`

**O que é:** Varios arquivos de tela passaram de 'grandes' para 'enormes': VendasPanel tem 2505 linhas e 41 pedacos de estado (useState), ContratosTab 2041, SociosDashboard 2022, VendasParametrizacao 2019, FormPanel 1798 (25 estados) e o App.jsx 1633 (31 estados). Arquivos desse tamanho sao dificeis de entender por inteiro, qualquer mudanca tem risco alto de efeito colateral, e ate o editor/IA fica mais lento neles. O Dashboard ja foi quebrado em compute.js (logica) + widgets.jsx (visual) + format.js — esse mesmo padrao deveria ser aplicado: extrair a logica de calculo e os sub-blocos visuais de VendasPanel, ContratosTab e FormPanel para arquivos menores e testaveis.

**Ganho:** Mudancas ficam mais seguras e rapidas, e da pra testar a logica isolada — exatamente o ganho que o Dashboard 2.0 ja teve.

**Onde:** client/src/components/{VendasPanel,ContratosTab,SociosDashboard,VendasParametrizacaoPanel,FormPanel}.jsx e client/src/App.jsx

### 12. Leitura da sessao do usuario fragil: chave do banco escrita 'na mao' no ContractContext
`medio / baixo / baixo`

**O que é:** Para salvar o rascunho separado por usuario, o ContractContext le diretamente a chave 'sb-vygczeepvoyaehfchxko-auth-token' do navegador, com o codigo do projeto (vygczeepvoyaehfchxko) escrito dentro do texto. Se algum dia o projeto Supabase mudar (ou a versao da biblioteca mudar o nome dessa chave), essa leitura falha em silencio e TODOS os rascunhos passam a cair no mesmo balde 'anon' (um usuario veria rascunho do outro, ou perderia o seu). O certo e pedir a sessao pela propria biblioteca do Supabase (supabase.auth.getSession / getUser) em vez de cavar no armazenamento do navegador.

**Ganho:** Rascunhos por usuario param de depender de um detalhe interno fragil — menos risco de rascunho trocado ou perdido numa atualizacao.

**Onde:** client/src/ContractContext.jsx (funcao getStorageKey, linha 8) — e outros 12 pontos que leem auth.getSession manualmente

### 13. Imports e variaveis nao usados (39 casos), incluindo no fluxo de assinatura
`baixo / baixo / baixo`

**O que é:** O lint aponta 39 variaveis/imports declarados e nunca usados. Alguns sao so sujeira inofensiva, mas eles confundem: por exemplo o ZapSignModal.jsx importa 'generateFullDocumentHTML' que nao usa, dando a falsa impressao de que aquela tela monta o documento completo. Em contractHtml.js ha 'getTipoAcaoResumo', 'numero' e 'complemento' calculados e jogados fora — pode indicar uma logica de endereco que ficou pela metade. Limpar esses casos (e investigar os do contractHtml, que podem ser bug) deixa o codigo honesto sobre o que realmente faz.

**Ganho:** Codigo que reflete o que de fato acontece — menos pistas falsas para quem investiga um problema, e possivel descoberta de logica incompleta.

**Onde:** client/src/components/ZapSignModal.jsx:3, client/src/utils/contractHtml.js:26/224/225, e outros (39 no total via lint)

### 14. Numeros 'magicos' nos tempos de automacao espalhados pelo App.jsx
`baixo / baixo / baixo`

**O que é:** Os intervalos de tempo das automacoes estao como numeros crus no meio do codigo: 120000, 10000, 30000, 3000, 4800, 5200, 5800 e o polling principal. Para quem le, '120000' nao diz nada (sao 2 minutos); e se o Paulo pedir 'deixa o sistema checar a cada 3 minutos em vez de 5', e preciso cacar esses numeros um por um e torcer pra nao trocar o errado. O ideal e dar nomes a eles no topo (ex.: POLL_INTERVAL_MS = 5 * 60 * 1000, CELEBRATION_DELAY_MS = 4800) para ficar legivel e ajustavel num lugar so.

**Ganho:** Fica claro o que cada tempo significa e ajustar a frequencia das automacoes vira trivial, sem risco de trocar o numero errado.

**Onde:** client/src/App.jsx (setInterval/setTimeout nas linhas 297, 461, 477, 509-528 e o polling principal de automacoes)

### 15. Projeto sem tipagem (sem TypeScript) e quase sem testes nas areas criticas
`medio / alto / baixo` `JÁ CONHECIDO`

**O que é:** O sistema inteiro e JavaScript puro, sem TypeScript e sem checagem de tipos (nao ha tsconfig nem PropTypes). Isso significa que erros como 'passei o campo errado' ou 'esse valor podia ser nulo' so aparecem em producao, com o usuario na frente. Alem disso, dos 26 utilitarios so 6 tem teste automatizado — e justamente os mais perigosos (advboxService que cria processos no CRM, zapsignService que envia para assinatura, importContrato, pdfGenerator) NAO tem teste nenhum. Caminho de baixo custo e alto retorno: (1) adicionar testes vitest para advboxService e zapsignService primeiro; (2) opcionalmente ligar checagem de tipos via JSDoc + 'checkJs' sem reescrever para TS.

**Ganho:** Pega erros antes de chegar ao cliente, sobretudo nas integracoes que criam processo no ADVBOX e mandam contrato pra assinar — onde um erro custa caro.

**Onde:** client/ (sem tsconfig); client/src/utils/__tests__ cobre so 6 de 26 utils — faltam advboxService, zapsignService, importContrato, pdfGenerator, duplicateDetector

### 16. Refresh do React quebrado por arquivos que misturam componente + funcoes/constantes exportadas
`baixo / medio / baixo`

**O que é:** Seis arquivos (ContractContext, AuthContext, Toast, UndoToast, ChangeLog) exportam ao mesmo tempo um componente de tela E funcoes/constantes auxiliares no mesmo arquivo. Isso desliga o 'hot reload' do React durante o desenvolvimento (a tela recarrega do zero a cada salvar, em vez de atualizar so o pedaco mudado) e e exatamente o que esses erros de lint apontam. Separando os helpers/constantes em arquivos proprios (ex.: um contractDefaults.js, um toastHelpers.js), o desenvolvimento volta a ser fluido e some mais um lote de erros do lint.

**Ganho:** Desenvolvimento mais rapido (a tela atualiza na hora ao salvar) e menos ruido no verificador de qualidade.

**Onde:** client/src/ContractContext.jsx, AuthContext.jsx, components/Toast.jsx, UndoToast.jsx, ChangeLog.jsx (erros react-refresh/only-export-components)

### 17. Limpeza/validacao de CPF reescrita em 8+ arquivos diferentes
`baixo / medio / baixo`

**O que é:** A logica de 'tirar pontuacao do CPF' e 'validar CPF' aparece reimplementada em pelo menos 8 lugares (App.jsx, apiLookup, importContrato, validation, advboxService, duplicateDetector, PreSendChecklist, BoletosPanel, FormPanel). Ja existe um utils/validation.js, mas nem todos usam. Se a regra de validacao mudar (ou tiver um bug), e preciso achar e corrigir em todos esses pontos — e e facil deixar um para tras, fazendo a mesma tela aceitar um CPF que outra rejeita. Consolidar tudo em utils/validation.js (limparCpf, validarCpf, formatarCpf) e usar em todo lugar resolve.

**Ganho:** Um CPF e tratado igual no sistema inteiro; corrigir a regra de validacao e feito uma vez so.

**Onde:** client/src/utils/validation.js (centralizar) e os 8+ arquivos que repetem replace(/\D/g) e checagem de CPF

## Observabilidade & Confiabilidade

### 1. Sentry so pega telas que quebram, nao os erros que o codigo engole
`alto / medio / baixo`

**O que é:** O Sentry (servico que avisa quando da erro no sistema) so esta plugado em um lugar: quando uma aba inteira trava e mostra tela de 'Ocorreu um erro'. Mas o codigo esta cheio de 'try/catch' que capturam erros e nao fazem nada (ex.: falha ao postar nota no Kommo, falha ao salvar no Drive, falha de PDF). Em todo o app NUNCA se chama Sentry.captureException — eu procurei e nao existe uma unica chamada. Resultado: o erro acontece, o cliente fica sem o documento/cobranca, e ninguem fica sabendo. A correcao e chamar Sentry.captureException nos pontos onde hoje so tem console.error (automacoes do App.jsx, geracao de PDF/DOCX, envio ZapSign).

**Ganho:** Voce passa a saber dos erros que hoje somem em silencio, em vez de descobrir pelo cliente reclamando dias depois.

**Onde:** client/src/main.jsx (so init), client/src/App.jsx (~linhas 625, 683-686, 835), client/src/components/FormPanel.jsx e utils/pdfGenerator.js

### 2. Se um agendamento (cron) parar de rodar, ninguem percebe
`alto / medio / baixo`

**O que é:** O sistema tem varios 'robos' que rodam sozinhos em horario marcado: lembretes a cada 15min, atualizacao de processos (DataJud) 1x/dia, calculo de comissoes dia 20, regua de cobranca em dias uteis. Nenhum desses avisa que rodou. Se a Netlify desligar um deles, ou se ele comecar a falhar todo dia, o sistema continua aparentemente normal — mas as comissoes nao saem, os lembretes nao disparam, as cobrancas param. Eu confirmei que so o monitor do ADVBOX registra 'ultima execucao'; os outros nao gravam nada. A correcao e cada cron gravar um 'batimento cardiaco' (heartbeat) numa tabela ao terminar, e um vigia diario comparar com o esperado.

**Ganho:** Voce descobre em horas (nao em semanas) se um robo importante parou, evitando comissao/cobranca/lembrete que simplesmente nao aconteceu.

**Onde:** client/netlify/functions/{datajud-refresh,reminder-cron,commission-calculator,cobranca-regua,asaas-sync-customers,keep-warm}.mjs

### 3. Metade das automacoes nao deixa rastro nenhum no banco (so no console)
`alto / medio / baixo`

**O que é:** Existe uma tabela de log central (advbox_api_log) que aparece no painel Monitor, mas so a familia do Bot/ADVBOX e do Asaas-sync escrevem nela. Eu conferi funcao por funcao: datajud-refresh, reminder-cron, commission-calculator, save-to-drive, keep-warm e zapsign-proxy NAO escrevem nada no banco — os erros vao para o 'console' da Netlify, que ninguem abre no dia a dia e que some depois de alguns dias. Na pratica metade da sua infraestrutura e uma caixa-preta. A correcao e fazer essas funcoes chamarem o mesmo logAdvbox() (ou uma tabela equivalente) ao terminar e ao falhar.

**Ganho:** Tudo que os robos fazem (e quando falham) fica visivel no painel Monitor que voce ja tem, sem precisar abrir log tecnico da Netlify.

**Onde:** client/netlify/functions/datajud-refresh.mjs, reminder-cron.mjs, commission-calculator.mjs, save-to-drive.mjs, zapsign-proxy.mjs

### 4. Nenhum erro vira aviso para um humano — tudo so 'fica gravado'
`alto / medio / baixo`

**O que é:** Quando algo falha, na melhor das hipoteses vira uma linha numa tabela do banco (advbox_api_log, automation_log, asaas_error_log). Mas nada avisa uma pessoa. Ninguem recebe email, WhatsApp ou notificacao quando uma assinatura falha em ir pro ADVBOX, quando uma nota fiscal nao e emitida, ou quando o health check aponta um servico fora do ar. Voce so ve se entrar na aba Monitor e procurar. A correcao e um alerta proativo: quando aparecer erro de nivel 'erro' nas tabelas de log, ou quando o health der 'degraded', mandar uma mensagem (email via funcao, ou nota no proprio Kommo/numero seu) com o resumo.

**Ganho:** Voce e avisado na hora que algo critico falha, em vez de depender de abrir o painel por acaso ou do cliente reclamar.

**Onde:** client/netlify/functions/health.mjs + nova funcao agendada que le advbox_api_log/automation_log/asaas_error_log e dispara o alerta

### 5. Automacoes criticas dependem do app estar ABERTO no navegador de alguem
`alto / alto / medio`

**O que é:** Boa parte do que dispara apos a assinatura (checar status no ZapSign, mandar pro ADVBOX, salvar no Drive, nota 'abriu e nao assinou' no Kommo) roda dentro do App.jsx, num laco a cada 5 minutos no NAVEGADOR. Isso significa: se ninguem estiver com o sistema aberto, nada acontece. De noite, fim de semana, ou se todos fecharem a aba, um contrato assinado pode ficar parado sem ir pro ADVBOX/Drive ate alguem abrir o app. O webhook do ZapSign existe, mas ele depende da SUPABASE_SERVICE_ROLE_KEY (que nao esta configurada) e so atualiza o status — nao dispara ADVBOX/Drive. A correcao e mover esse laco para uma funcao agendada no servidor (cron Netlify) que roda independente de navegador, com trava atomica como ja existe.

**Ganho:** Contratos assinados sao processados 24/7 mesmo com todos offline; some o risco de um caso 'esquecido' por horas porque ninguem estava com o sistema aberto.

**Onde:** client/src/App.jsx (laco runAutomations, setInterval 300000) -> nova Netlify Function agendada

### 6. Falha ao emitir Nota Fiscal no webhook do Asaas some sem deixar rastro
`alto / baixo / baixo`

**O que é:** Quando o cliente paga, o webhook do Asaas tenta emitir a NF automaticamente. Mas se a chamada de criacao da NF (asaasPost('/invoices')) der erro, o codigo so faz console.log e responde 'ok' para o Asaas — nao grava o erro em lugar nenhum e nao tenta de novo. Ou seja: um pagamento pode ser recebido e a NF simplesmente nao sair, sem nenhum aviso. Diferente do trecho de cima (que ja loga erro de espelho de boleto), a parte da NF nao tem captura de erro. A correcao e registrar a falha de emissao de NF em log (com o id do pagamento) e marcar para uma nova tentativa.

**Ganho:** Voce passa a ter lista de pagamentos sem NF emitida (problema fiscal/contabil real) em vez de descobrir so na conferencia manual.

**Onde:** client/netlify/functions/asaas-webhook.mjs (linhas 94-124, criacao de invoice sem logAdvbox/retry)

### 7. Nao existe fila de re-tentativa (dead-letter) para automacoes que falharam de vez
`alto / medio / baixo`

**O que é:** Hoje, quando uma automacao falha apos as tentativas (ex.: ADVBOX deu erro nao-recuperavel, ou Drive falhou 3x), o contrato simplesmente fica marcado como 'error' e para por ai. Nao ha uma 'caixa de itens que falharam' que uma pessoa revise e re-dispare em lote. O retry existe so item a item, manual, dentro de cada tela. A correcao e uma tabela/visao 'dead-letter' que junta todos os contratos com automacao em erro ha mais de X horas, com botao 'reprocessar todos', e que apareca destacada no Monitor.

**Ganho:** Nada que falhou fica perdido: tudo cai numa lista unica de 'pendencias de automacao' que voce limpa de uma vez, em vez de cacar caso a caso.

**Onde:** client/src/components/MonitorPanel.jsx (hoje so LoopDetector e cards de fila) + automation_log

### 8. O painel de SLOs mostra 'uptime de 30 dias' que na verdade sao so amostras da sessao
`medio / medio / baixo`

**O que é:** A aba Monitor tem um quadro bonito de 'Objetivos de Servico' (SLOs) prometendo 'Uptime 99,5% em 30 dias' e 'Latencia em 30 dias'. Mas, lendo o codigo, esses numeros de uptime/latencia vem de no maximo 30 medicoes feitas ao vivo enquanto a aba esta aberta — nada e guardado no banco. Quando voce fecha e reabre, comeca do zero. Ou seja, o numero exibido nao representa 30 dias de verdade e pode dar uma falsa sensacao de seguranca. A correcao e gravar cada medicao de health (data, ok/erro, tempo) numa tabela e calcular o SLO a partir do historico real.

**Ganho:** O indicador de disponibilidade passa a ser confiavel (historico de verdade) em vez de um numero que reinicia toda vez que a tela abre.

**Onde:** client/src/components/HealthSlos.jsx (linhas 104-135, healthSamples slice(-30) em memoria) + tabela nova de health_history

### 9. Detector de loops e health check so funcionam com a aba Monitor aberta
`medio / medio / baixo`

**O que é:** A deteccao de 'contrato travado ha mais de 5 min' (LoopDetector) e a checagem de servicos fora do ar rodam dentro do componente da tela Monitor, no navegador. Se ninguem estiver com essa aba aberta, nada e checado e nada e detectado. Um contrato pode ficar travado a noite inteira e o 'detector' nunca rodar. A correcao e mover essa logica para uma funcao agendada no servidor que, ao encontrar contrato travado ou servico fora, ja gera um alerta (ver item de alertas) — a tela vira so a visualizacao do que o servidor ja detectou.

**Ganho:** Travamentos e quedas sao detectados mesmo sem ninguem olhando a tela, e geram aviso automatico.

**Onde:** client/src/components/MonitorPanel.jsx (LoopDetector linha 161, CapacityAlerts linha 193)

### 10. Stack traces do Sentry vem embaralhados (sem source maps)
`medio / baixo / baixo`

**O que é:** Mesmo que o Sentry capture um erro de tela, o build de producao esta com 'sourcemap: false'. Isso faz o relatorio de erro chegar com nomes embaralhados (ex.: 'a.b is not a function' na linha 1 de um arquivo gigante minificado), praticamente impossivel de entender. Os source maps sao o 'mapa' que traduz o codigo embaralhado de volta para o codigo legivel. A correcao e gerar e enviar os source maps so para o Sentry (sem expo-los publicamente, usando o plugin oficial do Sentry no Vite), e configurar a versao (release) a cada deploy.

**Ganho:** Quando der erro, voce (ou o desenvolvedor) ve exatamente o arquivo e a linha, resolvendo em minutos em vez de horas de adivinhacao.

**Onde:** client/vite.config.js (sourcemap: false, linha 72) + client/src/main.jsx (release usa VITE_APP_VERSION que nao esta setada)

### 11. Sentry pode estar DESLIGADO em producao sem ninguem perceber
`medio / baixo / baixo`

**O que é:** O Sentry so liga se a variavel VITE_SENTRY_DSN estiver configurada na Netlify. Eu nao encontrei essa variavel referenciada no netlify.toml nem no deploy.sh — se ela nao estiver setada no painel da Netlify, o Sentry esta simplesmente desligado e o codigo so escreve um aviso no console do navegador ('Sentry desabilitado'). Ou seja, e bem possivel que voce ache que tem monitoramento de erros e na verdade nao tenha nada. A correcao e verificar se a env var existe na Netlify e, no proprio painel Monitor, mostrar um indicador 'Monitoramento de erros: ATIVO/INATIVO' lendo essa configuracao, para nunca ficar no escuro sem saber.

**Ganho:** Voce tem certeza se o monitoramento de erros esta realmente ligado, em vez de uma falsa sensacao de cobertura.

**Onde:** client/src/main.jsx (linhas 11-12, SENTRY_ENABLED) + netlify.toml/deploy.sh (env nao referenciada)

### 12. Quando uma integracao externa cai, o sistema nao tem plano B (circuit breaker)
`medio / alto / medio`

**O que é:** Se o ADVBOX, o Kommo ou o Asaas ficarem fora do ar, as funcoes continuam tentando bater neles a cada disparo, gastando tempo e podendo travar/lentificar tudo, e gerando montanhas de erro repetido no log. Nao ha um 'disjuntor' (circuit breaker) que detecte 'esse servico esta fora, vou parar de tentar por 10 min e marcar para reprocessar depois'. O health check ja sabe dizer quem esta fora, mas esse sinal nao e usado para pausar automacoes. A correcao e, quando o health (ou N falhas seguidas) indicar que um servico caiu, segurar os disparos para aquele servico por um tempo e enfileirar para retry, em vez de martelar o servico morto.

**Ganho:** Uma queda da ADVBOX/Asaas para de virar uma avalanche de erros e lentidao; o sistema espera o servico voltar e retoma sozinho.

**Onde:** client/netlify/functions/_lib/advbox.mjs, kommo.mjs, asaasMirror.mjs + sinal de health.mjs

### 13. Logs sem identificador de rastreio dificultam ligar 'erro X' ao 'contrato Y'
`medio / medio / baixo`

**O que é:** As funcoes logam mensagens soltas ('falha ao postar resumo', 'ADVBOX error') sem um identificador comum (request id / correlation id) que costure todos os passos de UM mesmo contrato/pagamento. Quando algo da errado num contrato, voce nao consegue, num so lugar, ver a sequencia: chegou no webhook -> tentou ADVBOX -> falhou no Drive. Vira garimpo manual cruzando varias tabelas e horarios. A correcao e gerar um id por evento (ex.: contrato_id + timestamp) e incluir em todos os logs daquele fluxo, e exibir agrupado no Monitor.

**Ganho:** Investigar 'o que aconteceu com o contrato do cliente Fulano' vira um filtro unico, em vez de juntar pedacos de log a mao.

**Onde:** client/netlify/functions/_lib/botDb.mjs (logAdvbox - sem campo de trace) + App.jsx automation_log inserts

### 14. Health check nao mede o Drive/Apps Script real nem guarda historico de quedas
`medio / medio / baixo`

**O que é:** O endpoint /health checa Supabase, ADVBOX, Kommo, Asaas, ZapSign e Apps Script — bom — mas ele e sempre 'sob demanda' (so responde quando alguem pergunta) e nada e guardado. Nao existe um registro 'as 14h o ADVBOX ficou fora por 20 min'. Sem isso voce nao consegue provar disponibilidade, nem ver padrao ('o Asaas cai toda madrugada'). Alem disso o resultado nao alimenta os SLOs reais (ver item do SLO). A correcao e uma funcao agendada (ex.: a cada 5-10 min) que chama o /health, grava o resultado numa tabela e, se mudou de 'ok' para 'fora', dispara alerta.

**Ganho:** Voce ganha um historico real de quedas por servico (uptime de verdade) e e avisado no momento em que algo cai, nao so quando abre a tela.

**Onde:** client/netlify/functions/health.mjs (so on-demand, com Cache-Control 60s) + nova funcao agendada de probe

### 15. Webhook do ZapSign falha em silencio porque depende de chave que nao esta configurada
`medio / baixo / baixo` `JÁ CONHECIDO`

**O que é:** O recebimento em tempo real das assinaturas (zapsign-webhook) so funciona se a SUPABASE_SERVICE_ROLE_KEY estiver configurada na Netlify — e ela nao esta (pendencia ja conhecida). Sem ela, o webhook responde erro 500 e o ZapSign nao consegue atualizar o status na hora; o sistema so percebe a assinatura no laco do navegador (que, como vimos, depende de alguem com o app aberto). O problema de observabilidade e que essa falha do webhook nao gera nenhum aviso — ela so 'nao funciona'. Marco como ja conhecido por causa da chave, mas o ponto novo aqui e: faltam log e alerta de que o webhook esta retornando 500.

**Ganho:** Enquanto a chave nao e configurada, ao menos voce fica sabendo que o caminho em tempo real esta quebrado, em vez de assumir que esta tudo certo.

**Onde:** client/netlify/functions/zapsign-webhook.mjs (linhas 49-51 retornam 500 sem log/alerta)

## Resiliência das Integrações

### 1. Automações de ADVBOX, Drive e Kommo dependem do navegador aberto
`alto / alto / medio`

**O que é:** Hoje, quando um contrato é assinado, o cadastro do cliente no ADVBOX, o salvamento dos PDFs no Google Drive e a nota 'abriu e não assinou' no Kommo só acontecem se alguém estiver com o sistema CBC Contratos aberto na tela (é um laço que roda a cada 5 minutos DENTRO do navegador, em client/src/App.jsx, função runAutomations, linha ~564). Se a equipe fechar o computador no fim do dia, ou o contrato for assinado de madrugada/fim de semana, nada dispara: o processo só é criado quando alguém reabre o sistema. O único que tem rede de segurança real é o ZapSign (tem webhook próprio). Mover esse laço para uma função agendada no servidor (Netlify cron, igual ao datajud-refresh) faz tudo rodar 24h por dia sem depender de ninguém estar com a tela aberta.

**Ganho:** Processos e pastas criados na hora, mesmo de madrugada/fim de semana/feriado — sem depender de a equipe estar com o sistema aberto. Acaba o atraso de horas no cadastro ADVBOX.

**Onde:** client/src/App.jsx (runAutomations, ~linha 564) + criar netlify/functions/automacoes-cron.mjs (schedule)

### 2. Webhook do bot WhatsApp pode responder a mesma mensagem duas vezes
`medio / medio / baixo`

**O que é:** Quando o Kommo manda uma mensagem do cliente para o sistema (netlify/functions/kommo-advbox-webhook.mjs), não há nenhum controle para evitar processar a MESMA mensagem mais de uma vez. O Kommo, como qualquer serviço de webhook, reenvia o evento se não receber resposta rápida o suficiente — e o sistema responde 'ok' só DEPOIS de já ter despachado o trabalho. Resultado: o bot pode responder duas (ou mais) vezes a mesma pergunta do cliente no WhatsApp, parecendo travado/repetitivo. A correção é guardar o ID da mensagem do Kommo numa tabela e ignorar se já foi processada (idempotência), como já é feito com as notas via 'marker'.

**Ganho:** Bot deixa de mandar respostas duplicadas no WhatsApp do cliente — atendimento mais profissional e menos consumo de chamadas ADVBOX/IA.

**Onde:** client/netlify/functions/kommo-advbox-webhook.mjs e advbox-bot-worker-background.mjs

### 3. Criar processo no ADVBOX não verifica se o processo já existe (risco de duplicar)
`medio / medio / baixo`

**O que é:** A função que cria o processo no ADVBOX ao assinar (netlify/functions/advbox-sync.mjs, função createLawsuit) SEMPRE faz um 'criar novo processo', sem nunca checar se aquele cliente já tem um processo daquele tipo. Para o CLIENTE há proteção (se o CPF já existe, reusa), mas para o PROCESSO não. Se a automação rodar duas vezes para o mesmo contrato (por exemplo: o navegador tenta, a resposta se perde na rede, e o retry tenta de novo), o ADVBOX ganha DOIS processos idênticos para o mesmo cliente. Hoje o controle de duplicidade fica só no banco (lock de advbox_status), mas se esse lock falhar, não há segunda barreira no lado do ADVBOX. Antes de criar, buscar processo existente pelo cliente+tipo e reusar.

**Ganho:** Evita processos duplicados no CRM jurídico, que confundem a equipe, distorcem o BI e exigem limpeza manual.

**Onde:** client/netlify/functions/advbox-sync.mjs (createLawsuit, ~linha 198)

### 4. Reenvio ao ZapSign pode gerar documento de assinatura duplicado
`medio / baixo / baixo`

**O que é:** Quando o sistema manda um contrato para o ZapSign (utils/zapsignService.js, sendToZapSign), ele usa um identificador externo 'external_id' que muda a cada clique (cbc-' + horário atual). Isso significa que o ZapSign NÃO tem como saber que é o mesmo contrato. Se a operadora clicar duas vezes, ou a internet cair depois de criar o documento mas antes da resposta chegar, e ela tentar de novo, o cliente recebe DOIS pedidos de assinatura do mesmo contrato no WhatsApp/e-mail — confuso e nada profissional. Usar um external_id estável baseado no ID do contrato (ex: 'cbc-contrato-{id}') permite ao ZapSign recusar a segunda cópia, ou ao sistema detectar a duplicata.

**Ganho:** Cliente nunca recebe dois links de assinatura do mesmo contrato. Menos confusão e menos retrabalho da equipe cancelando documentos duplicados.

**Onde:** client/src/utils/zapsignService.js (sendToZapSign, external_id ~linha 21) e ZapSignModal.jsx

### 5. Chamadas às APIs externas não têm tempo-limite (podem pendurar a função)
`medio / baixo / baixo`

**O que é:** Quase todas as chamadas para ADVBOX, Kommo, Asaas e Google Apps Script usam 'fetch' sem um tempo-limite (timeout). Se uma dessas APIs ficar lenta ou pendurada (acontece com o Apps Script e o ADVBOX), a função do servidor fica esperando até estourar o limite máximo do Netlify (10-26s) e morre sem deixar rastro claro, gastando tempo de execução e, no caso do Drive, podendo deixar o 'lock' preso. Só o ZapSign na ponta do cliente e o save-to-drive têm AbortSignal.timeout. Adicionar um timeout explícito (ex: 15s) em cada fetch externo nas libs _lib/advbox.mjs, _lib/kommo.mjs e _lib/asaasMirror.mjs faz a função falhar rápido e de forma controlada (com mensagem de erro útil) em vez de travar.

**Ganho:** Quando uma API externa engasga, o sistema falha rápido com mensagem clara e tenta de novo, em vez de travar e gastar o tempo da função à toa.

**Onde:** client/netlify/functions/_lib/advbox.mjs (advGet), _lib/kommo.mjs (kGet), _lib/asaasMirror.mjs (asaasGet)

### 6. Busca de cliente por CPF no ADVBOX baixa a lista inteira de clientes
`medio / baixo / baixo`

**O que é:** Na função de assinatura (netlify/functions/advbox-sync.mjs, findCustomerByCPF, ~linha 108), quando o ADVBOX recusa criar um cliente por CPF já existente, o código baixa TODOS os clientes do ADVBOX (GET /customers sem filtro) e procura o CPF na memória. Conforme a carteira cresce (milhares de clientes), isso fica lento, consome a cota de 15 requisições/minuto e pode até estourar o tempo da função — bem na hora crítica do cadastro pós-assinatura. A lib compartilhada _lib/advbox.mjs já tem uma busca correta por filtro (/customers?identification=...). Basta a advbox-sync usar a busca filtrada em vez de baixar tudo.

**Ganho:** Cadastro pós-assinatura volta a ser rápido e confiável mesmo com a carteira grande, sem desperdiçar a cota de chamadas do ADVBOX.

**Onde:** client/netlify/functions/advbox-sync.mjs (findCustomerByCPF, ~linha 108-124)

### 7. Mapa de tipo de ação no navegador está desatualizado em relação ao do servidor
`medio / medio / baixo`

**O que é:** Existe DUAS cópias da tabela que traduz 'tipo de ação' e 'origem' para os números internos do ADVBOX: uma no navegador (src/utils/advboxService.js) e outra no servidor (netlify/functions/advbox-sync.mjs). Elas já estão diferentes — por exemplo, o getTipoAcaoId do servidor não cobre 'Cota quitada', 'Dano moral' nem 'Execução Honorários' por palavra-chave que o do navegador cobre. Se alguém alterar uma e esquecer a outra, um processo pode ser criado com o tipo errado no CRM jurídico, sem ninguém perceber. O arquivo src/utils/advboxService.js inclusive ainda usa o token exposto no navegador e parece não ser mais o caminho principal (o fluxo real é a function advbox-sync). Consolidar numa fonte única ou remover a cópia morta do frontend elimina o risco de divergência.

**Ganho:** Acaba o risco de um processo ser criado com tipo/origem errado no ADVBOX por causa de duas tabelas que saem de sincronia.

**Onde:** client/src/utils/advboxService.js vs client/netlify/functions/advbox-sync.mjs (ORIGEM_MAP/TIPO_ACAO_MAP)

### 8. Webhook do Asaas só confere um token estático no cabeçalho (forjável)
`alto / baixo / baixo`

**O que é:** O webhook que recebe os avisos de pagamento do Asaas (netlify/functions/asaas-webhook.mjs) confere apenas um token fixo de texto enviado num cabeçalho (e tem um valor padrão fraco escrito no próprio código: 'cbc_webhook_asaas_nf_automatica_2026_prod'). Quem descobrir esse texto consegue forjar um evento de 'pagamento confirmado' e fazer o sistema emitir Nota Fiscal e marcar boletos como pagos indevidamente. O Asaas oferece assinatura/validação mais forte. No mínimo, mover esse token para variável de ambiente obrigatória (sem default no código) e exigir que ele exista. Hoje, se a env var não estiver setada, o sistema aceita o token padrão conhecido.

**Ganho:** Impede que alguém de fora forje pagamentos confirmados e dispare emissão de NF e baixa de boletos sem o dinheiro ter entrado.

**Onde:** client/netlify/functions/asaas-webhook.mjs (~linha 49, ASAAS_WEBHOOK_TOKEN default)

### 9. Webhook do ZapSign aceita qualquer chamada se o segredo não estiver configurado
`medio / baixo / baixo`

**O que é:** O webhook que confirma assinaturas (netlify/functions/zapsign-webhook.mjs) só valida a chamada SE a variável ZAPSIGN_WEBHOOK_SECRET estiver configurada. Se ela não estiver (o código avisa que é 'opcional mas recomendado'), qualquer um que conheça o endereço pode mandar um evento dizendo que um documento foi assinado. Como o handler re-consulta o ZapSign de verdade antes de mudar o status (bom!), o estrago é limitado, mas ainda assim um atacante poderia forçar consultas e ações. Tornar o segredo obrigatório (recusar se não houver) fecha a brecha, e é barato.

**Ganho:** Garante que só o ZapSign de verdade consegue avisar 'documento assinado' ao sistema — proteção da etapa mais sensível (a assinatura).

**Onde:** client/netlify/functions/zapsign-webhook.mjs (~linha 16, 42-47)

### 10. Nenhum alerta quando uma integração externa cai ou o token expira
`alto / medio / baixo`

**O que é:** Existe uma função de 'saúde' (health.mjs) que testa ADVBOX, Kommo, Asaas, ZapSign e Apps Script, mas ela só mostra o resultado quando alguém abre a aba Monitor no sistema. Não há nada que AVISE ativamente quando uma integração começa a falhar — por exemplo, se o token do Kommo expirar (já aconteceu de precisar rotacionar), ou se o ZapSign começar a retornar erro 401, ninguém é notificado; os contratos simplesmente param de virar processo/nota e isso só é descoberto dias depois, na conferência manual. Criar uma função agendada (a cada hora) que chama o health e, se algo estiver 'error', registra no advbox_api_log e/ou manda um aviso (e-mail/push/nota) transforma falhas silenciosas em alertas imediatos.

**Ganho:** A equipe descobre na hora quando uma integração cai ou um token expira, em vez de só perceber dias depois que contratos pararam de ser processados.

**Onde:** client/netlify/functions/health.mjs + criar netlify/functions/health-alert-cron.mjs

### 11. Tentativas (retry) das integrações não têm espera progressiva (backoff)
`medio / medio / baixo`

**O que é:** Quando uma chamada falha e o sistema tenta de novo, ele em vários pontos tenta imediatamente ou com espera fixa. No ADVBOX, o retry de erro 429 (limite atingido) espera 12s e 24s — razoável — mas a maioria dos outros retries (Drive, ADVBOX no polling do App.jsx, Kommo) ou não existem ou repetem em intervalo fixo. Quando uma API está sobrecarregada, bombardear com tentativas no mesmo ritmo só piora. O padrão recomendado é 'espera crescente com variação aleatória' (backoff exponencial com jitter): 2s, depois 5s, depois 12s, etc., com um pouco de aleatoriedade para não bater tudo ao mesmo tempo. Centralizar isso num helper reutilizável melhora a recuperação de todas as integrações de uma vez.

**Ganho:** Quando uma API externa está sobrecarregada, o sistema espera de forma inteligente e se recupera sozinho, em vez de insistir e piorar a situação.

**Onde:** client/netlify/functions/_lib/advbox.mjs, _lib/kommo.mjs, _lib/asaasMirror.mjs e App.jsx (retries)

### 12. URL do Google Apps Script (upload ao Drive) está cravada no código sem retry
`medio / baixo / baixo`

**O que é:** O endereço do Google Apps Script que faz o upload dos PDFs para o Drive está escrito direto dentro de save-to-drive.mjs (uma URL longa começando com script.google.com/macros/...). Se esse script for republicado (ganha uma URL nova) ou ficar fora do ar, TODO o salvamento no Drive quebra e exige alterar código + deploy para consertar — não dá para trocar pelo painel. Além disso, a chamada ao Apps Script não tem retry: uma falha temporária do Google (que é comum nesse serviço) já conta como tentativa gasta. Mover a URL para uma variável de ambiente (trocável sem deploy) e adicionar 1-2 retentativas com espera para erros temporários do Apps Script deixa o salvamento no Drive bem mais robusto.

**Ganho:** Salvamento no Drive aguenta instabilidade do Google e a URL pode ser trocada sem mexer no código — menos contratos presos sem pasta.

**Onde:** client/netlify/functions/save-to-drive.mjs (APPS_SCRIPT_URL ~linha 12, callAppsScript ~linha 109)

### 13. Config netlify.toml ainda aponta para função ChatGuru que foi removida
`baixo / baixo / baixo`

**O que é:** O arquivo de configuração netlify.toml ainda tem um mapeamento de rota '/api/chatguru-send' apontando para uma edge function 'chatguru-send' que NÃO existe mais (a pasta edge-functions só tem health.ts e zapsign-proxy.ts; o ChatGuru foi removido em maio/2026). Isso não derruba o site, mas pode causar erro no deploy (Netlify reclamando de função inexistente) ou gerar respostas de erro estranhas se algo ainda chamar essa rota. É uma limpeza simples: remover esse bloco do netlify.toml.

**Ganho:** Deploy mais limpo e sem erros falsos; remove referência morta que pode confundir quem mexer na configuração depois.

**Onde:** client/netlify.toml (bloco edge_functions /api/chatguru-send)

### 14. datajud-refresh e health gravam/leem como anon com chave cravada no código
`medio / baixo / baixo` `JÁ CONHECIDO`

**O que é:** As funções datajud-refresh.mjs e health.mjs trazem a chave pública (anon) do Supabase escrita direto no arquivo, e a datajud-refresh GRAVA no banco usando essa chave anon (atualiza peticao_distribuida_em, signed_at, fases). Isso depende inteiramente das permissões abertas (RLS allow-all, já conhecida) para funcionar — ou seja, é mais uma função que escreveria errado/seria bloqueada quando a segurança do banco for finalmente fechada. Quando a SUPABASE_SERVICE_ROLE_KEY for configurada (pendência conhecida), essas funções precisam passar a usá-la via variável de ambiente, senão vão parar de gravar silenciosamente. Vale mapear datajud-refresh junto das outras (advbox-sync também usa anon) para não virar uma falha surpresa.

**Ganho:** Quando a segurança do banco for fechada, a busca de distribuição (DataJud) e o monitor de saúde continuam funcionando, em vez de quebrar de surpresa.

**Onde:** client/netlify/functions/datajud-refresh.mjs (~linha 31-33) e health.mjs (~linha 7-8)

### 15. Cache de configurações do ADVBOX vive na memória e pode ficar desatualizado
`baixo / baixo / baixo`

**O que é:** A lib _lib/advbox.mjs guarda as 'configurações da conta' (lista de usuários, etapas, tarefas — getSettings) numa variável de memória que dura enquanto a função estiver 'quente'. Em funções de longa duração (o backfill encadeia blocos de 12 minutos), se a equipe criar uma nova etapa/tarefa no ADVBOX no meio do processo, o bot/monitor continua usando a lista antiga até a função reiniciar. Para o bot do cliente isso pode significar mostrar 'etapa desconhecida'. Adicionar um tempo de validade ao cache (ex: re-buscar após alguns minutos) garante que as configurações fiquem razoavelmente frescas sem perder a vantagem do cache.

**Ganho:** Bot e monitor reconhecem etapas/tarefas novas do ADVBOX sem precisar esperar a função reiniciar — menos 'etapa desconhecida' para o cliente.

**Onde:** client/netlify/functions/_lib/advbox.mjs (getSettings, _settings ~linha 58-62)

### 16. Cadeia de webhooks dispara o worker sem confirmar que ele recebeu
`medio / medio / baixo`

**O que é:** Vários webhooks (kommo-advbox-webhook, advbox-monitor, asaas-sync-boletos) seguem o padrão 'recebo o evento e disparo uma função de fundo (background) com fetch, e respondo ok'. O problema: esse fetch que dispara o worker não é verificado — se ele falhar (cold start, rede interna do Netlify), o sistema mesmo assim responde 'ok' para quem chamou, e o trabalho simplesmente nunca acontece, sem deixar rastro. Por exemplo, uma mensagem do cliente no WhatsApp pode ser 'aceita' mas o bot nunca rodar. Conferir se o disparo do worker deu certo (status 202) e, se não, registrar no advbox_api_log, dá visibilidade a esses sumiços silenciosos.

**Ganho:** Mensagens e eventos que 'somem' entre o webhook e o processamento passam a ser registrados em vez de desaparecer sem ninguém saber.

**Onde:** client/netlify/functions/kommo-advbox-webhook.mjs, advbox-monitor.mjs, asaas-sync-boletos.mjs

### 17. Consulta de CPF/CNPJ não trata 'sem créditos' nem lentidão de forma visível
`baixo / baixo / baixo`

**O que é:** A função cpf-lookup.mjs, quando a API de CPF está sem créditos ou retorna erro, responde de forma 'segura' (valid:true, nome vazio) para não quebrar o formulário — o que é bom para a tela, mas significa que ninguém fica sabendo que a conta da API de CPF zerou o saldo. A equipe passa a preencher nomes na mão sem entender por que o preenchimento automático parou. Registrar o caso 'SEM_CREDITOS' num log (advbox_api_log) ou num indicador no Monitor avisa que é hora de recarregar a API de CPF, antes que a equipe perceba pela ausência do recurso. Também não há timeout: se a cpfcnpj.com.br ficar lenta, o cadastro trava esperando.

**Ganho:** A equipe é avisada quando a API de CPF fica sem saldo (em vez de só notar que parou de preencher sozinho) e o cadastro não trava se ela ficar lenta.

**Onde:** client/netlify/functions/cpf-lookup.mjs (~linha 38, sem-créditos e fetch sem timeout)

### 18. Nota Kommo 'abriu e não assinou' (#18) só dispara com o app aberto
`medio / medio / baixo` `JÁ CONHECIDO`

**O que é:** A nota automática que avisa no Kommo quando o cliente abriu o link mas não assinou (#18, marker CBC.abriu) roda DENTRO do navegador, no laço do App.jsx (~linha 591). Como o próprio código e a documentação já reconhecem, ela 'só funciona com o app aberto'. Na prática, o melhor momento para o vendedor fazer um follow-up (o cliente acabou de abrir o contrato) frequentemente passa em branco porque ninguém estava com o sistema aberto naquele minuto. O ZapSign já tem webhook próprio (zapsign-webhook.mjs) que recebe os eventos de visualização em tempo real no servidor — mover essa nota #18 para lá faz o aviso de follow-up sair sempre, na hora certa, sem depender de tela aberta.

**Ganho:** O vendedor recebe o aviso de 'cliente abriu e não assinou' sempre na hora certa, aumentando a chance de fechar a assinatura com um follow-up no momento quente.

**Onde:** client/src/App.jsx (~linha 591-612) -> mover para client/netlify/functions/zapsign-webhook.mjs

### 19. Falhas das notas/movimentações no Kommo viram só warning e somem no console
`medio / baixo / baixo`

**O que é:** No fluxo de assinatura (advbox-sync.mjs), quando mover o lead no Kommo ou postar a nota de resumo falha, o erro vira apenas um 'warning' no resultado e, na prática, em vários pontos cai num 'catch' vazio (best-effort). O App.jsx melhorou parte disso registrando warnings do Kommo no automation_log, mas a chamada à kommo-note dentro da própria advbox-sync (linha ~392) e em datajud-refresh está envolta em 'catch {}' silencioso — se o token do Kommo expirar, as notas param de ser postadas e isso não aparece em lugar nenhum centralizado. Encaminhar essas falhas de Kommo para o advbox_api_log (já usado pelo bot/Asaas) dá um único lugar para ver 'o Kommo está com problema'.

**Ganho:** Falhas de integração com o Kommo (token expirado, etc.) ficam visíveis num só painel em vez de desaparecer, evitando semanas de leads parados sem ninguém notar.

**Onde:** client/netlify/functions/advbox-sync.mjs (~linha 392-396), datajud-refresh.mjs (kommo-note catches), kommo-note.mjs

## Acessibilidade

### 1. Associar cada rótulo (label) ao seu campo no formulário de contrato e no formulário público do cliente
`alto / medio / baixo`

**O que é:** Hoje, no formulário de criação de contrato (FormPanel) e no formulário público que o cliente preenche (ClientFormQR), os rótulos como 'CPF', 'Nome Completo', 'E-mail' são apenas texto solto em cima da caixa de digitação — não estão tecnicamente ligados ao campo. Eu confirmei no código: nenhum desses rótulos usa a ligação 'htmlFor/id'. Na prática isso quebra três coisas: (1) quem usa leitor de tela (cego/baixa visão) ouve 'caixa de texto, em branco' sem saber que aquele campo é o CPF; (2) clicar no texto do rótulo não foca o campo (atalho que todo mundo espera); (3) o preenchimento automático do navegador fica menos confiável. O conserto é mecânico: dar um id ao input e apontar o label para ele.

**Ganho:** Pessoas com deficiência visual conseguem preencher contratos e o formulário público; clicar no rótulo passa a focar o campo; autofill mais confiável. Reduz risco jurídico de inacessibilidade num sistema usado por terceiros (clientes).

**Onde:** client/src/components/FormPanel.jsx (todos os blocos label-field + input/select), client/src/components/ClientFormQR.jsx (13 labels sem htmlFor)

### 2. Tornar os erros de validação 'audíveis' (aria-invalid + mensagem ligada ao campo)
`alto / medio / baixo`

**O que é:** Quando um campo do contrato está errado/vazio, o sistema só pinta a borda de vermelho e o fundo levemente rosa (classe 'input-error'). Confirmei no código que não existe texto de erro ao lado de cada campo, nem os atributos 'aria-invalid' e 'aria-describedby'. Quem enxerga percebe a cor; quem usa leitor de tela ou é daltônico não recebe nenhum aviso — o campo soa idêntico a um campo válido. Como 'vermelho = erro' é justamente a combinação de cor que daltônicos mais confundem, a informação se perde. O ideal é, além da cor, marcar o input como inválido para a tecnologia assistiva e mostrar um texto curto ('CPF inválido') vinculado ao campo.

**Ganho:** Daltônicos e usuários de leitor de tela passam a saber qual campo está errado e por quê; menos contratos enviados com dado faltando; preenchimento mais rápido para todos (a mensagem diz o que corrigir).

**Onde:** client/src/components/FormPanel.jsx (classe input-error nos ~17 campos), CSS .input-error em client/src/index.css

### 3. Padronizar acessibilidade dos modais (papel de diálogo + Esc + foco preso dentro)
`alto / medio / baixo`

**O que é:** O sistema tem dois padrões de modal convivendo. Alguns (ConfirmDestructive, MobileNavSheet, DriveFolderModal) já estão bem feitos: anunciam-se como 'diálogo', fecham com Esc e têm título lido pelo leitor de tela. Outros, igualmente importantes, não têm nada disso. Confirmei que o modal de envio ao ZapSign (ZapSignModal), o guia de atalhos (ShortcutsGuide), o modal de lembrete (ReminderModal), o de preferências de KPI (KpiPreferencesModal), o de preferências de notificação (NotificationPrefsModal) e o relatório de boletos (RelatorioBoletosModal) não declaram 'role=dialog/aria-modal', não fecham com a tecla Esc e não 'prendem' o foco do teclado dentro deles. Resultado: ao abrir, o usuário de teclado continua tabulando os botões atrás do modal, e o leitor de tela não avisa que entrou numa caixa de diálogo.

**Ganho:** Navegação por teclado e leitor de tela funciona em todos os pop-ups; fechar com Esc vira padrão consistente; foco não 'vaza' para trás do modal. Menos confusão para todos os usuários.

**Onde:** client/src/components/ZapSignModal.jsx, ShortcutsGuide.jsx, ReminderModal.jsx, KpiPreferencesModal.jsx, NotificationPrefsModal.jsx, RelatorioBoletosModal.jsx

### 4. Prender o foco do teclado dentro do modal aberto e devolvê-lo ao fechar (focus trap + restore)
`medio / medio / baixo`

**O que é:** Mesmo nos modais que já têm 'role=dialog', confirmei que nenhum componente do projeto implementa o 'focus trap' — ou seja, quando o usuário aperta Tab dentro de um pop-up, o foco escapa para os elementos da tela de fundo. E ao fechar o modal, o foco não volta para o botão que o abriu, ficando 'perdido' no topo da página. Para quem navega só por teclado (e para leitores de tela), isso torna fácil se perder: você fecha um aviso e não sabe onde está na tela. A correção é um pequeno utilitário/hook reutilizável que mantém o Tab circulando entre os elementos do modal e guarda o elemento anterior para restaurar o foco no fechamento.

**Ganho:** Usuário de teclado nunca 'sai' do modal por acidente e sempre volta ao ponto de origem ao fechar; experiência previsível para leitores de tela. Beneficia também usuários avançados que preferem teclado ao mouse.

**Onde:** client/src/hooks/ (criar useFocusTrap), aplicado em todos os modais (ConfirmDestructive, ZapSignModal, GlobalSearch, ShortcutsGuide, etc.)

### 5. Anunciar progresso de OCR, geração de PDF e 'Gerando...' para leitores de tela
`medio / baixo / baixo`

**O que é:** Ao ler a CNH (OCR), enviar ao ZapSign ou gerar o preview do contrato, a tela mostra textos como 'Lendo...', 'Gerando PDF', 'Processando documento' e uma barra de progresso. Confirmei que o componente ProgressBar tem o 'role=progressbar' (bom), mas as etapas e os textos de status NÃO estão dentro de uma região 'aria-live'. Isso significa que, para quem usa leitor de tela, esses avisos são silenciosos — a pessoa não sabe se o sistema está trabalhando, travou ou terminou. Como OCR e geração de PDF podem levar vários segundos, é exatamente o momento em que o usuário mais precisa de feedback. Basta envolver esses textos numa região que 'fala' as mudanças.

**Ganho:** Usuários de leitor de tela sabem quando o OCR/PDF está processando e quando terminou, em vez de ficar no escuro durante 5-15 segundos. Reduz envios duplicados por achar que 'não funcionou'.

**Onde:** client/src/components/FormPanel.jsx (bloco ocrProgress ~linha 645), client/src/components/ZapSignModal.jsx (SendProgress), client/src/components/LivePreview.jsx ('Gerando...')

### 6. Não comunicar estado apenas por cor: badges de status e timeline de automações
`medio / baixo / baixo`

**O que é:** O status do contrato e a 'timeline de automações' (as bolinhas Salvo→Aguardando→Assinado→Pasta→ADVBOX→Kommo) comunicam o andamento principalmente por cor: bolinha azul-marinho = feito, cinza = pendente, âmbar pulsando = aguardando. Confirmei no código (ContratosTab, PROGRESS_STEPS) que o estado 'feito/pendente' depende da cor de fundo e da presença do ícone — não há texto como 'concluído'/'pendente' que o leitor de tela leia, nem a lista é marcada como tal. Daltônicos (8% dos homens) podem não distinguir as bolinhas, e leitores de tela não anunciam quais passos já aconteceram. A solução é adicionar um rótulo textual de estado em cada passo (ex.: aria-label 'ADVBOX: concluído') e tratar a timeline como uma lista de etapas.

**Ganho:** Daltônicos e usuários de leitor de tela entendem em que pé está cada contrato (assinado? já foi pro Drive? já caiu no ADVBOX?) sem depender de enxergar a cor. Informação crítica do dia a dia fica acessível.

**Onde:** client/src/components/ContratosTab.jsx (timeline PROGRESS_STEPS ~linha 458; badges de status), client/src/components/contratos/ (CardsView/KanbanView)

### 7. Dar semântica de busca (combobox/listbox) e anunciar resultados na Busca Global
`medio / medio / baixo`

**O que é:** A Busca Global (Cmd+K) já tem boa navegação por setas e Enter, e fecha com Esc — confirmei no código. Mas faltam três coisas de acessibilidade: (1) o campo de busca não tem rótulo acessível (só um placeholder, que leitores de tela tratam de forma inconsistente); (2) a estrutura não usa os papéis 'combobox'/'listbox/option' que avisam o leitor de tela 'isto é uma busca com sugestões e você está no item 3 de 10'; (3) a contagem de resultados ('Nenhum resultado', 'Buscando...') não está numa região que fala. Para um cego, hoje a busca é praticamente um campo mudo: ele digita e não recebe retorno de quantos contratos apareceram nem qual está selecionado.

**Ganho:** Usuários de leitor de tela conseguem usar a busca rápida de contratos com retorno falado ('10 resultados', 'item selecionado'); o modal também ganha papel de diálogo. Ferramenta central do app fica utilizável sem visão.

**Onde:** client/src/components/GlobalSearch.jsx (input ~linha 159, container ~linha 152, lista de resultados ~linha 169)

### 8. Transformar as abas principais em um conjunto de abas acessível (role=tablist/tab)
`medio / medio / baixo`

**O que é:** A barra superior com as 12 abas (Novo, Contratos, Dashboard, Asaas...) usa botões com 'aria-current=page', o que é razoável, mas não declara a estrutura de abas que o leitor de tela espera ('isto é uma lista de abas, você está na aba 4 de 12, aba selecionada'). Confirmei que o seletor menor de visualização do contrato (Formulário/Contrato/Procuração) JÁ faz isso corretamente com role=tablist/tab/aria-selected — ou seja, o padrão bom existe no projeto, só não foi aplicado à navegação principal. Padronizar dá ao usuário de leitor de tela o anúncio correto e a navegação por setas entre abas, que é o comportamento esperado.

**Ganho:** Leitores de tela anunciam corretamente a navegação principal ('aba Dashboard, 5 de 12') e permitem mover entre abas com as setas. Consistência com o padrão que o app já usa no seletor de preview.

**Onde:** client/src/App.jsx (top tabs ~linha 1320-1343; comparar com role=tablist já usado ~linha 1381)

### 9. Adicionar um 'pular para o conteúdo' e revisar a ordem de tabulação do cabeçalho
`medio / baixo / baixo`

**O que é:** Não existe um link 'pular para o conteúdo principal' (skip link) no início da página. Para quem navega por teclado ou leitor de tela, isso significa ter que passar por logo, busca, modo escuro, densidade, atalhos, notificações e todas as abas antes de chegar ao formulário ou à lista de contratos — toda vez. Um único link invisível que aparece ao apertar Tab ('Pular para o conteúdo') resolve. Aproveitando, vale conferir a ordem de tabulação do cabeçalho, que tem muitos botões só-ícone seguidos, para garantir que a sequência do Tab faça sentido visualmente (esquerda→direita, cima→baixo).

**Ganho:** Usuários de teclado/leitor de tela chegam ao conteúdo em 1 tecla em vez de ~20; navegação diária muito mais rápida para quem não usa mouse.

**Onde:** client/src/App.jsx (topo do layout, antes do header ~linha 1180; landmark <main> no container de conteúdo)

### 10. Verificar e corrigir contraste de texto 'suave' no modo escuro (e claro)
`medio / baixo / baixo`

**O que é:** O sistema usa tokens de cor para texto secundário e 'apagado'. No modo escuro, '--cbc-text-muted' é #6B7280 (cinza médio) — confirmei que é o MESMO cinza usado no modo claro. Sobre fundos escuros 'sutis' (#111827) esse cinza fica com contraste no limite ou abaixo do mínimo recomendado (WCAG AA 4.5:1), deixando rótulos, datas, legendas e textos de '9-10px' difíceis de ler para pessoas com baixa visão ou em telas com brilho baixo. Vale rodar um teste de contraste nos tokens de texto secundário/muted (claro e escuro) e clarear o 'muted' do dark mode. Também há muito texto em tamanhos minúsculos (7-10px) que, combinado a contraste fraco, agrava o problema.

**Ganho:** Textos secundários (datas, legendas, status, valores) ficam legíveis para baixa visão e em ambientes claros; reduz cansaço visual de todos. Aproxima o app da conformidade WCAG AA.

**Onde:** client/src/index.css (--cbc-text-muted/--cbc-text-secondary em :root e :root.dark ~linhas 311-340)

### 11. Dar rótulo acessível e melhorar contraste dos botões só-ícone de ação
`baixo / baixo / baixo`

**O que é:** Há vários botões que são apenas um ícone, sem texto visível. A maioria já tem 'aria-label' (bom — confirmei vários), mas alguns dependem só do atributo 'title' (que não é lido de forma confiável por todos os leitores de tela e some no toque). Exemplos no preview do contrato: os botões de zoom (− % +) e de navegação de página (‹ ›) usam apenas 'title' e símbolos, sem aria-label. Para quem usa leitor de tela, eles soam como 'botão' sem nome. Padronizar: todo botão só-ícone recebe um aria-label descritivo ('Aumentar zoom', 'Próxima página').

**Ganho:** Todos os controles só-ícone passam a ter nome falado pelo leitor de tela; controles de zoom/navegação do preview ficam utilizáveis sem visão. Consistência com o resto do app que já usa aria-label.

**Onde:** client/src/components/LivePreview.jsx (toolbar de zoom/página ~linhas 249-258), e varredura geral de <button> com title mas sem aria-label

### 12. Garantir alvo de toque mínimo (44px) e foco visível nos controles pequenos do preview e toolbars
`baixo / baixo / baixo`

**O que é:** O redesenho mobile já garantiu alvos de 44px em telas de toque para a maioria dos controles (confirmei a regra no CSS). Porém alguns controles pequenos fora do fluxo principal escaparam: os botões de zoom/página do LivePreview têm 20-24px (w-5/w-6) e foram marcados em parte como 'no-touch-min'. Para pessoas com tremor, artrite ou dedos grandes, acertar um botão de 20px é frustrante. Além disso, esses mesmos botões pequenos têm foco pouco visível. Vale revisar os pontos que ficaram abaixo de 44px em toque e reforçar o contorno de foco.

**Ganho:** Pessoas com limitação motora (e qualquer um no celular) acertam os botões pequenos do preview/toolbars; foco visível ajuda quem navega por teclado. Menos toques errados e frustração.

**Onde:** client/src/components/LivePreview.jsx (botões w-5/w-6 da toolbar), client/src/index.css (regras pointer:coarse / touch-target)

### 13. Anunciar mudanças de aba e carregamento de seção para leitores de tela
`baixo / medio / baixo`

**O que é:** Quando o usuário troca de aba (ex.: de 'Novo' para 'Dashboard'), a tela inteira muda, mas nada é anunciado para o leitor de tela — a pessoa não sabe que o conteúdo trocou nem para onde foi o foco. O mesmo vale para as abas com 'lazy loading' que mostram um spinner enquanto carregam. Confirmei que há um 'role=status/aria-live=polite' num indicador de loading global (bom), mas a troca de aba em si não move o foco para o novo conteúdo nem anuncia o título da seção. A correção é, ao trocar de aba, mover o foco para o cabeçalho do novo painel (ou anunciar o nome da aba numa região live).

**Ganho:** Usuários de leitor de tela percebem a troca de seção e são levados ao início do novo conteúdo, em vez de ficarem 'presos' no botão da aba. Navegação coerente entre as 12 abas.

**Onde:** client/src/App.jsx (handler de setMainTab ~linha 1338; container do conteúdo da aba)

### 14. Revisar contraste das mensagens de erro/sucesso e estados de validação (vermelho-sobre-rosa, verde-sobre-verde)
`baixo / baixo / baixo`

**O que é:** Vários avisos usam texto colorido sobre fundo da mesma família: erro em vermelho #DC2626 sobre rosa, sucesso verde sobre verde-claro, e badges com texto colorido. Em alguns casos o texto é pequeno (10-12px) e o contraste fica no limite. Especificamente, a borda de campo válido (#22C55E) e inválido (#EF4444) é usada como ÚNICO sinal em alguns lugares, e a cor sozinha já é problema para daltônicos (item separado trata disso). Aqui o foco é garantir que, onde houver texto de aviso, ele tenha contraste suficiente (AA) com o fundo colorido. Vale uma passada com medidor de contraste nas caixas de erro do login, do FormPanel e dos toasts.

**Ganho:** Avisos de erro e sucesso ficam legíveis para baixa visão; mensagens críticas (login falhou, campo inválido) não se perdem. Conformidade AA nos estados de feedback.

**Onde:** client/src/index.css (.input-error/.input-valid/.input-invalid ~linhas 96-130), client/src/components/LoginScreen.jsx (caixa de erro ~linha 132), client/src/components/Toast.jsx (TYPE_STYLES)

## Custo & Infraestrutura

### 1. Tabela de auditoria contratos_audit está com 61 MB e nunca é limpa (sem retenção)
`alto / baixo / baixo`

**O que é:** Hoje: a tabela contratos_audit, que guarda o histórico de cada alteração de contrato, já tem 10.510 linhas e ocupa 61 MB — sendo que só existem 163 contratos reais. Em maio/2026 sozinho entraram 9.517 linhas (47 MB), antes do filtro do gatilho ter sido ajustado. Essas linhas antigas continuam paradas no banco ocupando espaço para sempre. O que melhora: criar uma rotina automática (cron) que apaga registros de auditoria com mais de 12 meses (ou arquiva em formato compactado). Isso libera ~55 MB de imediato e impede que o banco compartilhado (8 GB no plano Pro, mas dividido com vários apps do escritório) cresça sem controle. É a maior tabela do CBC Contratos hoje, fora a de boletos.

**Ganho:** Libera ~55 MB de imediato e estanca o maior vetor de crescimento de banco do sistema; reduz backup S3 e tempo de dump.

**Onde:** Supabase: tabela public.contratos_audit. Criar função SQL de purga + cron (pg_cron) ou nova Netlify Function agendada; gatilho atual audit_contratos_trigger.

### 2. Polling de automações (a cada 5 min) roda em TODOS os usuários e não pausa com a aba em segundo plano
`alto / baixo / baixo`

**O que é:** Hoje: o App.jsx tem um polling global (linha 847, setInterval de 300000ms) que, a cada 5 minutos, busca contratos pendentes no Supabase e chama as Edge Functions de ZapSign para TODOS os usuários logados ao mesmo tempo — mesmo quando a aba do navegador está minimizada ou em segundo plano. O health-check ao lado (linha 856) já tem a proteção 'if (document.hidden) return', mas o polling principal NÃO tem. O que melhora: adicionar o mesmo gate de 'document.hidden' (ou a API Page Visibility) ao polling de automações. Com 5-6 pessoas com a aba aberta o dia todo, isso elimina facilmente dezenas de milhares de invocações de função e consultas ao banco por mês que não servem para nada quando ninguém está olhando a tela.

**Ganho:** Corta uma grande fatia de invocações de Edge Function e queries Supabase sem perder nada (webhook ZapSign já atualiza em tempo real); economiza bandwidth e CPU dos navegadores.

**Onde:** client/src/App.jsx, useEffect do polling global (linhas 564-849), especialmente o setInterval(runAutomations, 300000).

### 3. Trabalho duplicado: cada usuário logado refaz o MESMO polling de ZapSign/ADVBOX
`alto / alto / medio`

**O que é:** Hoje: o polling do App.jsx é executado independentemente no navegador de cada pessoa logada. Se 5 pessoas estão online, as 5 fazem a mesma varredura de contratos pendentes e as mesmas chamadas de status ao ZapSign para os mesmos contratos, a cada 5 minutos. É trabalho compartilhado sendo repetido 5 vezes — gasta invocações de função e cota da API ZapSign à toa, e ainda gera condições de corrida (vários tentando escrever o mesmo registro). O que melhora: mover essa varredura para uma única Netlify Function agendada (cron) no servidor, que roda uma vez para todos, e deixar o navegador apenas escutando atualizações via Realtime do Supabase. Já existe o zapsign-webhook fazendo a maior parte em tempo real; o polling do cliente vira redundante.

**Ganho:** Elimina N cópias do mesmo trabalho (uma por usuário) reduzindo a um único cron; menos chamadas à API ZapSign, menos invocações e menos escrita concorrente no banco.

**Onde:** client/src/App.jsx (polling, linhas 564-849) → migrar para netlify/functions (cron único) + Realtime no cliente.

### 4. PDF é regerado a cada tecla no Live Preview do desktop (jsPDF + html2canvas pesados)
`medio / medio / baixo`

**O que é:** Hoje: no desktop, o Live Preview gera um PDF completo via jsPDF + html2canvas com debounce de apenas 700ms (LivePreview.jsx linha 130). Cada pausa de digitação durante o preenchimento do formulário dispara a renderização de um PDF inteiro — operação cara de CPU. No mobile isso já foi resolvido (usa HTML rolável), mas o desktop ainda paga esse custo a cada edição. O que melhora: no desktop, espelhar a abordagem do mobile e mostrar o HTML do contrato (mesma fonte do PDF) durante a edição, gerando o PDF de verdade só quando o usuário clica em 'Gerar PDF' ou pausa por mais tempo (ex.: 1500ms). Isso reduz drasticamente o uso de CPU do navegador (bateria em notebooks) e o carregamento dos chunks pesados de PDF durante a digitação.

**Ganho:** Menos CPU/bateria nos navegadores dos usuários e menos pressão sobre os chunks de PDF (que somam ~1,5 MB) durante o fluxo de criação.

**Onde:** client/src/components/LivePreview.jsx (debounce de 700ms na linha 130; IS_TOUCH_PREVIEW já tem o caminho HTML pronto para reaproveitar).

### 5. Bundle de PDF muito grande (pdfWorker 779 KB + jsPDF 399 KB + html2canvas 199 KB) carregado no navegador
`medio / alto / medio`

**O que é:** Hoje: o build tem chunks enormes — pdfWorker-*.js com 779 KB, jspdf 399 KB, html2canvas 199 KB, além de es-*.js de 510 KB. Toda geração de PDF acontece no navegador do usuário, o que obriga a baixar esses arquivos pesados (mesmo com cache, é bandwidth no primeiro acesso de cada versão e CPU local). O que melhora: avaliar mover a geração de PDF final (no envio ao ZapSign / arquivamento) para uma Netlify Function ou para o server/ que já tem Puppeteer instalado, deixando no cliente apenas o preview leve em HTML. Isso reduz o tamanho do bundle baixado por todos os usuários e tira carga de CPU dos navegadores, especialmente em máquinas fracas e celulares.

**Ganho:** Reduz o peso do bundle baixado por cada usuário e move a geração pesada de PDF para onde ela é mais barata e previsível (servidor).

**Onde:** client/dist/assets (pdfWorker, jspdf.es.min, html2canvas); origem em client/src/utils/pdfGenerator.js; alternativa em server/ (Puppeteer 24.40 já presente).

### 6. error_log com 7.206 linhas e sem retenção definida
`medio / baixo / baixo`

**O que é:** Hoje: a tabela error_log acumulou 7.206 linhas (2,7 MB) e não há rotina de limpeza visível. Logs de erro são úteis por algumas semanas, mas registros de meses atrás raramente são consultados e só engordam o banco compartilhado e os backups. O mesmo vale, em menor escala, para automation_log, activity_log e advbox_api_log. O que melhora: definir uma política única de retenção (ex.: manter 90 dias de error_log/automation_log/activity_log/advbox_api_log e apagar o resto via cron). Centralizar isso numa única função de manutenção evita que cada tabela de log cresça indefinidamente.

**Ganho:** Mantém as tabelas de log num tamanho estável, reduz backup e dump, e melhora a performance de consultas que varrem esses logs no Monitor.

**Onde:** Supabase: public.error_log, automation_log, activity_log, advbox_api_log. Uma função de purga agendada cobre todas.

### 7. keep-warm a cada 10 min pode ser reduzido para 15 min (e questionar se ainda é necessário)
`baixo / baixo / baixo`

**O que é:** Hoje: a função keep-warm roda a cada 10 minutos (144 invocações/dia) disparando OPTIONS para health e zapsign-proxy só para evitar cold-start. Mas health e zapsign-proxy hoje são EDGE Functions (rodam em Deno no edge, com cold-start mínimo), então o aquecimento periódico de funções serverless tradicionais pode estar aquecendo a coisa errada. O próprio comentário no arquivo já sugere '*/15'. O que melhora: (1) reduzir o schedule para '*/15 * * * *' (de 144 para 96 invocações/dia, -33%), e (2) revisar se ainda faz sentido aquecer Edge Functions — se não, a função keep-warm inteira pode ser desativada. Cada invocação ainda dispara sub-requisições que contam como hits.

**Ganho:** Reduz em até 33% as invocações do keep-warm (e potencialmente elimina a função se as Edge Functions não precisarem de aquecimento).

**Onde:** client/netlify/functions/keep-warm.mjs (schedule '*/10 * * * *', FUNCTIONS_TO_WARM aponta para health/zapsign-proxy que são Edge).

### 8. Health-check do header dispara uma chamada de função a cada 2 min por usuário
`baixo / baixo / baixo`

**O que é:** Hoje: além do polling de automações, há um health-check (App.jsx linha 872) que chama a Edge Function /api/health a cada 120 segundos para acender a bolinha verde/amarela/vermelha no cabeçalho. Ele já pausa quando a aba está oculta (bom), mas com a aba aberta são 30 chamadas/hora por usuário só para um indicador visual. O que melhora: aumentar o intervalo para 5 min (a saúde dos serviços raramente muda em 2 min e o impacto de descobrir uma falha 3 min depois é mínimo) e/ou só checar quando o usuário interage. Isso reduz invocações da função health sem prejuízo prático.

**Ganho:** Reduz em ~60% as invocações da função health por usuário ativo, mantendo o indicador útil.

**Onde:** client/src/App.jsx, useEffect do health check (setInterval(checkHealth, 120000), linha 872).

### 9. Tesseract.js baixa o motor OCR e o idioma português da CDN em todo uso
`baixo / medio / baixo`

**O que é:** Hoje: o OCR de CNH usa Tesseract.js, que carrega o 'core' e o arquivo de idioma (por.traineddata, vários MB) de uma CDN externa a cada sessão de OCR, e o pdf.worker é puxado do cdnjs (ocrService.js linha 104). Isso é bandwidth de download repetido toda vez que uma secretária usa o OCR, e depende de CDN de terceiros (cloudflare) que pode cair. O server/ já tem o por.traineddata local. O que melhora: hospedar os assets do Tesseract (core wasm + traineddata + pdf.worker) no próprio site/Netlify com cache imutável, em vez de baixar da CDN externa toda vez. Garante cache eficiente, não depende de terceiros e reduz latência do primeiro OCR.

**Ganho:** Cacheia os assets pesados do OCR com headers imutáveis do próprio site, evitando re-download da CDN externa e removendo dependência de terceiros.

**Onde:** client/src/utils/ocrService.js (loadTesseract; workerSrc apontando para cdnjs na linha ~104). Assets já existem em server/por.traineddata.

### 10. asaas_boletos cresce sem teto (12.005 linhas / 11 MB) — avaliar retenção de boletos antigos
`medio / medio / baixo`

**O que é:** Hoje: o espelho de boletos asaas_boletos já tem 12.005 linhas e 11 MB, é a 2ª maior tabela do CBC Contratos, e cresce a cada sync 2x/dia. Boletos de anos anteriores, já pagos e fechados, continuam sendo sincronizados e armazenados integralmente. O que melhora: definir até onde o espelho precisa ir (ex.: manter no banco apenas boletos dos últimos 24 meses ou apenas os não-pagos + pagos recentes) e arquivar/descartar o resto, além de garantir que o sync incremental não reescreva linhas antigas sem mudança. Para um escritório, dados financeiros antigos podem ir para um arquivo morto (Excel/Drive) em vez de ficar no banco quente.

**Ganho:** Controla o crescimento da 2ª maior tabela e reduz o volume reescrito a cada sync, economizando banco e processamento.

**Onde:** Supabase: public.asaas_boletos; netlify/functions/asaas-sync-boletos.mjs e asaas-sync-boletos-background.mjs.

### 11. Espelho de BI (bi_processos + bi_clientes + bi_financeiro + logs) já soma ~7 MB e cresce diariamente
`medio / medio / baixo`

**O que é:** Hoje: o snapshot diário para Power BI alimenta bi_processos (3.185 linhas/2,5 MB), bi_clientes (2.734/1,1 MB), bi_financeiro (1.074), bi_processos_log e bi_funil_historico — todos crescendo todo dia útil. O bi_processos_log (diário de mudanças) tende a crescer linearmente para sempre. O que melhora: confirmar que os upserts realmente atualizam linhas existentes (em vez de inserir duplicatas) e definir retenção para as tabelas de LOG do BI (bi_processos_log, bi_funil_historico), mantendo só o período que o Power BI realmente consome. Tabelas de fato (snapshot) podem permanecer; os diários históricos é que precisam de teto.

**Ganho:** Evita que o conjunto de BI vire o próximo grande consumidor de banco; mantém o Power BI leve e rápido.

**Onde:** Supabase: bi_processos_log, bi_funil_historico (e vw_bi_*); netlify/functions/advbox-snapshot-worker-background.mjs.

### 12. api-powerbi serve dados via Netlify Function em vez de view direta no Supabase
`baixo / medio / baixo`

**O que é:** Hoje: a função api-powerbi.mjs roda no Netlify e responde os dados ao Power BI (com cache de 300s). Toda atualização do relatório no Power BI gasta uma invocação de função + execução. Como o Supabase já expõe REST/views (vw_bi_*), o Power BI poderia consultar diretamente uma view materializada, sem passar pela função. O que melhora: migrar api-powerbi para uma view (já planejado no roadmap interno) elimina a função do caminho, economiza invocações Netlify e simplifica a infra. Bônus: tira mais um endpoint com chave default fraca da superfície.

**Ganho:** Elimina invocações de função a cada refresh do Power BI e reduz uma peça de infra a manter.

**Onde:** client/netlify/functions/api-powerbi.mjs → migrar para view materializada Supabase (vw_bi_* já existem).

### 13. Imagens duplicadas em PNG+WebP no public/ — servir só WebP economiza bandwidth
`baixo / baixo / baixo`

**O que é:** Hoje: em public/ existem versões PNG (20 KB cada) e WebP (12 KB cada) de favicon, logo-navy e logo-white. Se o app ainda referencia os PNG em algum lugar, está servindo 20 KB onde 12 KB bastariam, e o favicon.png tem cache de apenas 7 dias (_headers), enquanto poderia ser mais agressivo. O que melhora: padronizar o uso de WebP (com fallback só onde necessário), remover os PNG não usados e aumentar o cache do favicon. São economias pequenas por requisição, mas o favicon e logos são baixados por todo visitante, inclusive na página pública do portal e no formulário público (ClientFormQR).

**Ganho:** Reduz bytes por carregamento em ativos baixados por todos os visitantes (incl. páginas públicas), com cache mais longo.

**Onde:** client/public/ (favicon/logo .png vs .webp); client/public/_headers (favicon.png max-age=604800).

### 14. 10 subscriptions de Realtime do Supabase espalhadas — auditar canais não fechados
`medio / medio / baixo`

**O que é:** Hoje: há 10 pontos no código que abrem canais Realtime do Supabase (App, BoletosPanel, AsaasPanel, ContratosTab, Dashboard, ClientFormQR, ContractComments, useEmpreendimentos, usePresence, useNotifications). O Realtime do plano Pro tem limite de conexões/mensagens simultâneas, e canais que não são fechados corretamente (cleanup do useEffect) ou que escutam tabelas muito 'barulhentas' consomem cota e podem vazar conexões quando o usuário troca de aba várias vezes. O que melhora: auditar cada um para garantir removeChannel no cleanup, escopo de filtro (não escutar a tabela inteira quando só um registro importa) e, onde possível, consolidar. Isso protege a cota de Realtime do banco compartilhado e evita conexões zumbis.

**Ganho:** Evita vazamento de conexões Realtime e consumo desnecessário da cota compartilhada do plano Pro.

**Onde:** client/src/App.jsx, components/{BoletosPanel,AsaasPanel,ContratosTab,Dashboard,ClientFormQR}.jsx, components/contratos/ContractComments.jsx, hooks/{useEmpreendimentos,usePresence,useNotifications}.js.

### 15. ContratosTab e Dashboard usam SELECT * em pontos quentes, puxando colunas pesadas
`baixo / baixo / baixo`

**O que é:** Hoje: apesar das otimizações de 31/05 que enxugaram alguns selects, ainda há '.select(*)' em caminhos quentes — ContratosTab linha 967 (recarrega o contrato inteiro a cada evento Realtime, incluindo o JSONB 'dados' e 'advbox_data') e linha 1103 (export). Como o Realtime dispara em qualquer mudança, baixar '*' a cada evento traz colunas grandes que a tela nem usa. O que melhora: trocar os '*' restantes por listas explícitas de colunas (como já é feito na listagem principal na linha 772). Em bandwidth Supabase isso reduz o tráfego por evento; em CPU do navegador, menos dado para processar. É a mesma técnica já validada no Dashboard.

**Ganho:** Reduz bytes transferidos do Supabase a cada evento Realtime e em exports, e alivia processamento no navegador.

**Onde:** client/src/components/ContratosTab.jsx (select('*') nas linhas ~967 e ~1103).

### 16. Backup diário completo no server/ + S3 sobe tabelas que poderiam ser excluídas do dump
`baixo / baixo / baixo`

**O que é:** Hoje: o server/ faz backup diário às 03h (contratos + clausulas + audit_log) gravando local e em S3. Como contratos_audit/error_log estão inchados (ver itens acima), o backup carrega esse peso morto todo dia para o S3, gastando armazenamento e transferência S3 que crescem junto. O que melhora: depois de aplicar retenção nos logs/audit, o backup naturalmente encolhe; além disso, vale revisar se o backup precisa incluir as tabelas de auditoria/log integralmente (geralmente backup de auditoria pode ser semanal/compactado, não diário completo) e se backups antigos no S3 têm lifecycle policy (expiração automática) para não acumular indefinidamente.

**Ganho:** Reduz tamanho e custo de armazenamento/transferência S3 e o tempo do backup diário, especialmente após a limpeza de logs.

**Onde:** server/index.js (cron 03:00 BRT, backup contratos/clausulas/audit_log → local + S3); bucket S3 cbc-contratos-backups (lifecycle policy).

## Arquitetura & Alto Nível

### 1. Tirar as automações críticas (ADVBOX, Drive, Asaas, nota Kommo) de dentro do navegador e movê-las para o webhook/servidor
`alto / alto / medio`

**O que é:** Hoje, quando um contrato é assinado, quem dispara a criação do cliente e do processo no ADVBOX, o arquivamento no Google Drive e a cobrança no Asaas é um laço de polling que roda DENTRO do navegador de quem está logado (App.jsx, a cada 5 minutos). Verifiquei: o webhook do ZapSign (zapsign-webhook.mjs) só muda o status para 'assinado' — ele NÃO dispara ADVBOX, Drive nem Asaas. Ou seja: se ninguém estiver com o sistema aberto no navegador, o contrato assinado fica parado, sem virar processo, sem ir pro Drive e sem gerar boleto, até alguém abrir o app. À noite, em feriado ou fim de semana, tudo trava. A correção é fazer o próprio webhook do ZapSign (que já roda no servidor 24h) chamar essas automações assim que o contrato é assinado. Isso é a mãe de várias melhorias: deixa o sistema confiável de verdade, independente de ter alguém olhando a tela.

**Ganho:** Contratos assinados viram processo/cobrança/arquivo na hora, 24h por dia, sem depender de um humano com o app aberto. Acaba a maior fonte de atrasos e 'sumiços' silenciosos.

**Onde:** client/src/App.jsx (laço runAutomations, linhas 564-690) + client/netlify/functions/zapsign-webhook.mjs (precisa passar a chamar advbox-sync, save-to-drive e a régua Asaas)

### 2. Configurar a SUPABASE_SERVICE_ROLE_KEY e remover a chave anônima 'chumbada' dentro do código das funções
`alto / baixo / medio` `JÁ CONHECIDO`

**O que é:** Várias funções do servidor (asaas-sync.mjs, health.mjs, api-rest.mjs, api-powerbi.mjs, datajud-refresh.mjs) têm a chave pública anônima do Supabase ESCRITA DIRETO no código como valor padrão — encontrei o token literal repetido em pelo menos 5 arquivos. Isso existe porque a chave de serviço (a 'chave mestra' que deveria ser usada no servidor) nunca foi configurada no Netlify. Consequência prática dupla: (1) as funções operam com permissão de visitante anônimo, o que obriga aquelas regras temporárias 'temp_anon' abertas no banco; e (2) a chave fica fixa no código-fonte, então qualquer cópia do repositório carrega o segredo. Configurar a chave de serviço no Netlify e apagar esses valores padrão destrava o fechamento de segurança do banco inteiro.

**Ganho:** Destrava o fechamento real das permissões do banco (RLS) e tira segredos de dentro do código. É o pré-requisito que sozinho viabiliza várias outras correções de segurança.

**Onde:** client/netlify/functions/asaas-sync.mjs:13, health.mjs:8, api-rest.mjs:15, api-powerbi.mjs:10, datajud-refresh.mjs:32 (chave anon literal) + variável SUPABASE_SERVICE_ROLE_KEY no painel do Netlify

### 3. Exigir autenticação nas funções que disparam ações reais (ADVBOX, Drive, Asaas, Kommo)
`alto / medio / medio`

**O que é:** Confirmei lendo o código: funções como advbox-sync.mjs e save-to-drive.mjs aceitam qualquer chamada POST sem verificar QUEM está chamando — não checam token de usuário, nem segredo, nem nada. Como elas estão publicadas na internet, qualquer pessoa que descubra o endereço (que está no bundle do site, é público) pode disparar a criação de clientes/processos no ADVBOX ou uploads no Drive à vontade. Só duas funções (api-rest e api-powerbi) pedem uma chave, e mesmo assim a chave padrão é fraca. O certo é exigir o token do usuário logado (Supabase já entrega esse token) OU um segredo compartilhado em cada função que faz ação que custa dinheiro/cria dado externo, e recusar quem não apresentar.

**Ganho:** Impede que terceiros (ou robôs) acionem cadastros falsos no CRM jurídico, uploads indevidos no Drive ou cobranças. Protege as integrações pagas de abuso.

**Onde:** client/netlify/functions/advbox-sync.mjs, save-to-drive.mjs, save-to-drive-direct.mjs, kommo-note.mjs, cobranca-regua.mjs (nenhuma valida o chamador hoje)

### 4. Mover os tokens VITE_* (ADVBOX e CPF) para proxies no servidor e tirá-los do bundle do site
`alto / medio / baixo` `JÁ CONHECIDO`

**O que é:** O sistema usa VITE_ADVBOX_TOKEN e VITE_CPF_API_TOKEN no código do frontend. Tudo que tem prefixo VITE_ vai junto para dentro do arquivo JavaScript que o navegador baixa — qualquer visitante consegue abrir o código do site e ler esses tokens em texto puro. Isso significa que o token do ADVBOX (CRM jurídico, com dados de clientes) e o da API de CPF estão expostos. A solução estrutural é criar pequenas funções 'proxy' no servidor (como já existe o zapsign-proxy) que guardam o token só do lado servidor e o frontend chama o proxy em vez de chamar a API externa direto. Aí o token nunca sai do servidor.

**Ganho:** Tira segredos valiosos das mãos de qualquer visitante do site. Permite rotacionar os tokens depois sem precisar reconstruir o frontend.

**Onde:** client/src/utils/advboxService.js e client/src/utils/apiLookup.js (uso de VITE_ADVBOX_TOKEN / VITE_CPF_API_TOKEN) — criar proxies em netlify/functions espelhando o padrão do zapsign-proxy

### 5. Criar uma biblioteca compartilhada de 'resposta padrão' das funções (CORS, formato de erro, logging) em vez de copiar e colar em cada uma
`medio / medio / baixo`

**O que é:** Cada uma das ~40 funções define do seu jeito o cabeçalho de CORS, o formato da resposta de erro e o que loga. Encontrei pelo menos 27 funções repetindo manualmente 'Access-Control-Allow-Origin' e formatos de resposta diferentes (umas devolvem {ok:false,error}, outras {error}, outras texto). Isso gera bugs sutis (o frontend nunca sabe ao certo o formato), dificulta padronizar segurança (hoje todas liberam CORS para '*', qualquer site) e torna impossível mudar um comportamento de uma vez só. Uma única função utilitária em _lib/ que monta a resposta, trata erro e loga de forma uniforme reduz código duplicado e padroniza o tratamento de falha de toda a plataforma.

**Ganho:** Erros tratados do mesmo jeito em toda a API, frontend mais previsível, e mudanças de segurança (ex.: restringir CORS) feitas num lugar só.

**Onde:** client/netlify/functions/_lib/ (criar um helper de resposta) + as ~40 funções .mjs que hoje repetem CORS/erro manualmente

### 6. Centralizar as tabelas de mapeamento do ADVBOX (tipo de ação, responsável, estágio) num lugar só
`medio / baixo / baixo`

**O que é:** As tabelas que traduzem 'Ação de cobrança' para o ID 2151644, o responsável padrão 241495 e o estágio 3795429 estão escritas duas vezes: uma em client/netlify/functions/_lib/advbox.mjs (e advbox-sync.mjs) e outra cópia em client/src/utils/advboxService.js. Quando o escritório criar um novo tipo de ação ou trocar o responsável, é preciso lembrar de alterar nos dois lugares — e o do frontend (advboxService.js), pelo que verifiquei, nem é mais importado em lugar nenhum (virou código morto que confunde). A solução é ter um único arquivo-fonte desses mapeamentos e apagar a cópia morta.

**Ganho:** Acaba o risco de o ADVBOX cadastrar processo com tipo/responsável errado por causa de mapeamentos desencontrados. Menos código para manter.

**Onde:** client/netlify/functions/_lib/advbox.mjs vs client/src/utils/advboxService.js (TIPO_ACAO_MAP, RESPONSAVEL_PADRAO=241495, STAGE_ASSINADO_AUTOMACAO=3795429 duplicados)

### 7. Adotar TypeScript de forma gradual nos pontos de risco (geração de contrato, automações, integrações)
`medio / alto / baixo`

**O que é:** O projeto inteiro é JavaScript puro — não há checagem de tipos. Em um sistema que gera contratos jurídicos e cadastra dados em CRM/cobrança, isso é arriscado: um campo escrito errado (ex.: 'contratante' vs 'contratantes', ou um número que vira texto) só aparece quando já deu problema com o cliente, sem aviso. Dá para adotar TypeScript de forma gradual (ele convive com o JS atual) começando pelos módulos mais críticos: o gerador de contrato/DOCX, o laço de automações do App.jsx, e as libs de integração (advbox, kommo, asaas). O Supabase ainda consegue gerar os tipos das tabelas automaticamente, o que cobre os erros mais comuns (nome de coluna errado).

**Ganho:** O computador passa a avisar erros de campo/tipo ANTES de ir para produção, em vez de o cliente descobrir um contrato com dado trocado. Menos bug silencioso nas integrações.

**Onde:** client/ (sem tsconfig hoje) — começar por src/utils/contractHtml.js, docxGenerator.js, src/App.jsx (automações) e netlify/functions/_lib/*.mjs

### 8. Criar um ambiente de testes (staging) separado da produção
`alto / alto / baixo`

**O que é:** Hoje só existe produção: o deploy.sh manda direto para o site ao vivo (--prod) e não há contexto de staging configurado no netlify.toml. Toda mudança vai para cima dos usuários e dos dados reais de clientes. Para um sistema que mexe com contratos, cobrança e CRM, isso é perigoso — não há onde testar com segurança antes de afetar o escritório. O ideal é ter um segundo site Netlify (staging) apontando para um banco/projeto de teste, onde dá para experimentar mudanças e integrações (ADVBOX, Asaas, ZapSign em modo sandbox) sem risco. O sistema irmão de Prestação de Contas já faz isso (tem site de teste 'testeprestacao'), então o padrão existe na casa.

**Ganho:** Permite testar mudanças e novas integrações sem risco de bagunçar contratos, cobranças ou o CRM reais. Reduz drasticamente a chance de um bug chegar no cliente.

**Onde:** client/deploy.sh (só --prod) + client/netlify.toml (sem contexts de staging) — criar site Netlify de teste e projeto Supabase de teste

### 9. Unificar o histórico de migrations do banco — hoje há dois sistemas paralelos e desencontrados
`medio / medio / medio`

**O que é:** Existem DOIS lugares concorrentes guardando alterações do banco: os arquivos supabase_*.sql na raiz (setup, v2, upgrade, p1_scale, bot_advbox, vendas...) e a pasta supabase/migrations/ com arquivos numerados (0002, 0003... 0006). Eles não conversam: não dá para saber, olhando o repositório, qual é o estado real do banco nem em que ordem aplicar. Como o banco é COMPARTILHADO com vários outros apps do escritório, esse descontrole é especialmente perigoso. A solução é padronizar tudo no sistema de migrations do Supabase CLI (a pasta supabase/migrations), numerado e idempotente, e tratar os .sql da raiz como histórico arquivado. Assim, recriar ou auditar o banco vira algo confiável.

**Ganho:** Passa a existir uma 'fonte da verdade' única e ordenada do banco. Em caso de problema ou recriação, dá para reconstruir o estado com segurança — crítico num banco usado por vários sistemas.

**Onde:** raiz: supabase_*.sql (10 arquivos) vs supabase/migrations/ (0002-0006) — consolidar no padrão Supabase CLI

### 10. Separar os dados do CBC Contratos do banco compartilhado (schema próprio ou projeto próprio)
`alto / alto / alto`

**O que é:** O Supabase é compartilhado entre vários apps do escritório (Teses, Calculadora, Penhora, Prestação de Contas, Auditoria...) todos no mesmo banco, distinguidos só por prefixo no nome das tabelas. Isso cria três problemas estruturais: (1) qualquer regra de segurança aberta em um app pode vazar para os outros; (2) um app pesado pode degradar o desempenho dos demais; (3) é fácil um deploy errado mexer na tabela do app vizinho. A direção estrutural é isolar: no mínimo colocar as tabelas do CBC num 'schema' próprio (uma divisória dentro do mesmo banco) e, idealmente, avaliar um projeto Supabase dedicado. É uma mudança grande, mas é a que mais reduz o risco de um sistema derrubar/expor o outro.

**Ganho:** Isola falhas e vazamentos: um problema no CBC Contratos para de poder afetar Prestação de Contas, Teses, etc. (e vice-versa). Segurança e desempenho deixam de ser 'tudo ou nada'.

**Onde:** Supabase projeto vygczeepvoyaehfchxko (compartilhado) — tabelas contratos, asaas_*, bot_*, vendas_*, portal_*, bi_* convivem com teses_*, calc_*, penhora_*, prest_*

### 11. Criar uma biblioteca de componentes visuais reutilizáveis (botão, card, modal, input) em vez de repetir estilos em telas gigantes
`medio / alto / baixo`

**O que é:** As telas estão enormes e cada uma reimplementa seus próprios botões, cards, modais e inputs com classes soltas: VendasPanel tem 2505 linhas, ContratosTab 2041, SociosDashboard 2022, FormPanel 1798. Não existe uma pasta de componentes-base (não há src/components/ui). Resultado: um mesmo botão é escrito de formas levemente diferentes em cada tela, mudanças de visual precisam ser feitas em dezenas de lugares, e o risco de inconsistência é alto (o redesenho mobile teve que caçar tudo manualmente). Extrair um conjunto pequeno de componentes-base (Botão, Card, Modal, Input, Tabela) que usam os tokens --cbc-* já existentes daria consistência e encolheria muito essas telas.

**Ganho:** Visual consistente em todo o sistema, mudanças de aparência feitas num lugar só, telas menores e mais fáceis de manter. Acelera qualquer redesenho futuro.

**Onde:** client/src/components/ (sem pasta ui/) — extrair de VendasPanel.jsx (2505 linhas), ContratosTab.jsx (2041), SociosDashboard.jsx (2022), FormPanel.jsx (1798)

### 12. Adicionar 'feature flags' para ligar/desligar funcionalidades sem precisar reconstruir e reimplantar o site
`medio / medio / baixo`

**O que é:** Não há um mecanismo de chaves de funcionalidade (feature flags). Quando uma novidade arriscada vai ao ar (como o Bot ADVBOX, o redesenho mobile, ou uma integração nova), não existe um botão para ligar/desligar na hora se der problema — a única saída é fazer rollback de deploy inteiro (rollback.sh), o que desfaz TUDO, inclusive coisas boas que foram juntas. Com flags simples (uma tabela de config no banco, que o app já usa para outras coisas via bot_config), dá para liberar uma função só para o Paulo primeiro, ou desligar uma integração problemática em segundos sem mexer no código. Isso muda a forma de lançar coisas: vira gradual e reversível.

**Ganho:** Lançar novidades arriscadas com rede de segurança: ligar para poucos usuários, e desligar na hora se der ruim — sem rollback geral nem novo deploy.

**Onde:** client/src/App.jsx (controle de abas/automações) — apoiar numa tabela de config (padrão já usado em bot_config) lida no boot do app

### 13. Decidir o destino do backend server/ (Node monolito vs modular) — concluir o cutover ou aposentá-lo
`baixo / medio / baixo` `JÁ CONHECIDO`

**O que é:** A pasta server/ tem um arquivo monolítico de produção (index.js, 55 mil bytes) e uma versão modular paralela (index.modular.js + src/) que, segundo o próprio cabeçalho do arquivo, nunca passou pelo 'cutover' (a troca). Ou seja: existe código duplicado, um em uso e outro pela metade, parado há tempo. Isso confunde qualquer manutenção (qual é o verdadeiro?) e mantém dependências pesadas (Puppeteer, Tesseract) num componente 'pouco usado'. A decisão estrutural é: ou finalizar a migração para o modular e aposentar o monolito, ou — já que quase tudo migrou para as Netlify Functions — avaliar desativar o server/ de vez, movendo as poucas tarefas que ainda dependem dele (backup S3, render PDF server-side) para funções/crons.

**Ganho:** Acaba a ambiguidade de 'qual backend é o real', reduz código morto e dependências pesadas, e simplifica o mapa do sistema para quem for dar manutenção.

**Onde:** server/index.js (monolito ativo, 55KB) vs server/index.modular.js + server/src/* (modular incompleto, cutover nunca feito)

### 14. Ligar de verdade o limitador de abuso (rate-limit) e a checagem do lint no CI
`medio / medio / baixo`

**O que é:** Duas defesas estruturais existem no projeto mas estão desligadas. Primeiro: há uma função rate-limit.mjs (que serviria para barrar excesso de chamadas/abuso nas funções), mas, pelo que verifiquei, ela não é chamada por nenhuma outra função — está parada. Segundo: o CI (GitHub Actions) roda o lint, mas só como 'aviso' — ele NÃO bloqueia, por causa de um acúmulo de ~35 erros conhecidos de baseline. Na prática, novos erros de código entram sem barreira. As correções estruturais: (a) plugar o rate-limit nas funções públicas mais sensíveis (cpf-lookup, portal-*, as que disparam ação externa), e (b) zerar o baseline do lint e transformá-lo em portão obrigatório, para que o CI passe a impedir código quebrado de chegar à produção.

**Ganho:** Defesas que já existem passam a funcionar: proteção contra abuso/flood nas funções e barreira automática que impede código com erro de subir. Qualidade e segurança deixam de depender de disciplina manual.

**Onde:** client/netlify/functions/rate-limit.mjs (definido mas não usado) + .github/workflows/ci.yml (lint marcado como 'informativo até zerar baseline')

### 15. Limpar referências mortas de configuração (edge function chatguru-send inexistente, código morto steps/ e Stepper)
`baixo / baixo / baixo`

**O que é:** Há referências apontando para coisas que não existem mais, o que confunde manutenção e pode quebrar em silêncio. No netlify.toml ainda há uma edge function declarada em /api/chatguru-send apontando para 'chatguru-send' — mas o ChatGuru foi removido e essa função não existe na pasta (só health.ts e zapsign-proxy.ts existem). Além disso, a pasta steps/ (Step1 a Step7, o wizard antigo) e o componente Stepper.jsx são código morto confirmado — não são importados em lugar nenhum, mas continuam sendo lidos como se fossem a tela atual, gerando documentação e raciocínio errados. Limpar essas referências (tirar o bloco chatguru do netlify.toml e remover steps/ + Stepper.jsx com backup) deixa o mapa do sistema condizente com a realidade.

**Ganho:** O sistema passa a refletir o que realmente existe: menos confusão para quem dá manutenção e zero risco de uma rota apontar para uma função fantasma.

**Onde:** client/netlify.toml (bloco [[edge_functions]] /api/chatguru-send — função não existe) + client/src/steps/Step1-7 e client/src/components/Stepper.jsx (não importados)

### 16. Reduzir o acoplamento das funções com a URL do site (process.env.URL chumbado como produção)
`baixo / baixo / baixo`

**O que é:** Várias funções de servidor chamam outras funções construindo a URL com process.env.URL e, quando ela falta, caem num valor fixo 'https://contratos-cbc.netlify.app' (vi isso em advbox-monitor, advbox-backfill, asaas-sync-boletos, advbox-sync e outras). Isso amarra o servidor à produção: se for criado um ambiente de teste (staging), essas funções vão continuar chamando a produção por engano, misturando os dois mundos. Como o passo de criar staging é recomendado, vale corrigir junto: garantir que a URL venha sempre do ambiente correto e que o valor padrão chumbado não aponte cegamente para produção. É uma higiene que evita que teste vire produção sem ninguém perceber.

**Ganho:** Permite que um ambiente de teste funcione de verdade, sem suas funções 'vazarem' chamadas para a produção. Torna o staging confiável.

**Onde:** client/netlify/functions/advbox-monitor.mjs:9, advbox-backfill-background.mjs:28, advbox-monitor-worker-background.mjs:200, asaas-sync-boletos-background.mjs:19 (SELF_URL/BASE_URL com fallback fixo de produção)

## Dashboard, Relatórios & BI

### 1. Corrigir a API Power BI: ela exporta colunas VAZIAS (origem do cliente e 1ª mensagem = sempre nulas)
`alto / baixo / baixo`

**O que é:** O Power BI puxa os dados pela função `api-powerbi.mjs`. Ela lê as colunas `origem_cliente` e `data_primeira_mensagem` da tabela — mas confirmei no banco de produção que essas duas colunas estão 100% vazias (0 de 163 contratos). O dado real do escritório fica guardado dentro do campo JSON `dados` (em `dados->>origemCliente` e `dados->>dataPrimeiraMensagem`), que está 100% preenchido. Consequência: no Power BI a coluna 'origem do cliente' aparece em branco, o agrupamento 'por_origem' fica vazio, e o cálculo 'jornada_compra_dias' (1ª mensagem → assinatura) dá sempre nulo. O dono acha que tem esses dados no BI, mas não tem.

**Ganho:** Faz o Power BI finalmente enxergar de onde vêm os clientes (Facebook/Google/Instagram) e o tempo de jornada de compra — métricas que hoje saem em branco. Sem isso, qualquer painel de marketing no Power BI está mentindo.

**Onde:** client/netlify/functions/api-powerbi.mjs (linhas 47, 60-77 e 86-108): trocar `origem_cliente`/`data_primeira_mensagem` por `dados->>origemCliente` e `dados->>dataPrimeiraMensagem` no select e nos cálculos enriquecidos.

### 2. Taxa de Êxito do Dashboard dos Sócios é sempre ~100% (matematicamente quebrada)
`alto / baixo / baixo`

**O que é:** No Dashboard dos Sócios, a 'Taxa de Êxito (6 meses)' é calculada como assinados ÷ (assinados + cancelados). Mas confirmei no banco que NUNCA existe contrato cancelado (0 de 163) — a equipe não usa o status 'cancelado' na prática, simplesmente arquiva. Resultado: o denominador é sempre só os assinados, então a taxa dá quase sempre 100%. É um número bonito e inútil que passa falsa segurança aos sócios.

**Ganho:** Substituir por uma métrica honesta (ex.: % de contratos criados nos últimos 6 meses que chegaram a assinar, contando arquivados-sem-assinar como perda) dá aos sócios a real taxa de fechamento — que é o número que de fato importa para decidir investimento em vendas.

**Onde:** client/src/components/SociosDashboard.jsx, função computeSociosStats (linhas 283-289): redefinir a base de cálculo usando criados vs assinados (e arquivados como perda) em vez de assinados vs cancelados.

### 3. Dashboard dos Sócios e Dashboard principal mostram números diferentes para a MESMA coisa
`alto / medio / baixo`

**O que é:** Os dois dashboards calculam a data de assinatura de formas diferentes. O Dashboard principal usa `signed_at → advbox_date → updated_at` (corrigido em junho). O Dashboard dos Sócios ainda usa o jeito ANTIGO `signed_at → updated_at → created_at`, sem o passo do ADVBOX. Como 31 dos 140 contratos assinados não têm `signed_at`, esses 31 caem no `updated_at` — que é mexido toda hora pelas automações (DataJud, Kommo) — e a data de assinatura fica errada/inflada. Além disso, o Sócios inclui contratos arquivados nas contas (não filtra `arquivado_em`), enquanto o principal os exclui. Logo, receita do mês, ranking e YoY divergem entre as duas telas.

**Ganho:** Os sócios e a operação passam a ver os MESMOS números. Hoje, abrir as duas abas mostra valores diferentes de receita e contagem, o que destrói a confiança em qualquer dashboard.

**Onde:** client/src/components/SociosDashboard.jsx: reaproveitar `getSignedDate` de components/dashboard/compute.js (linha 214 redefine `signedDate` localmente) e aplicar o filtro de arquivados no fetch (linha 1483-1488).

### 4. Previsão de receita real (forecast), que hoje não existe em lugar nenhum
`alto / medio / baixo`

**O que é:** Nenhum dashboard projeta receita futura de verdade. O Sócios tem só uma 'projeção até o fim do mês' que apenas soma boletos pendentes que vencem neste mês — isso é fluxo de caixa de curtíssimo prazo, não previsão. Não há nada que diga 'no ritmo atual, fechamos o trimestre em X'. Com 163 contratos e ~13 meses de histórico já dá para projetar com regressão simples sobre a série mensal de receita assinada (que já está calculada em compute.js como serieMensal/comparador).

**Ganho:** O dono passa a ter um número de 'para onde vamos' (próximos 1-3 meses) com base no histórico real, não só 'o que já está na conta'. É a diferença entre dirigir olhando o retrovisor e olhando a estrada.

**Onde:** client/src/components/dashboard/compute.js (reusar serieMensal já calculada) + novo widget em dashboard/widgets.jsx; ou seção própria no SociosDashboard.jsx.

### 5. LTV por cliente e receita REALIZADA (não só honorários iniciais do contrato)
`alto / alto / medio`

**O que é:** Todas as métricas de receita usam `honorarios_total` do contrato — ou seja, o valor PREVISTO de honorários iniciais. Mas o que o cliente de fato pagou está nos 12.005 boletos do Asaas (com `net_value` e `payment_date` 100% preenchidos, e `customer_cpf` 100% preenchido, que dá para casar com o CPF do contrato). Hoje ninguém cruza essas duas bases. Não existe métrica de 'quanto cada cliente já gerou de receita realizada', nem LTV, nem total recebido vs contratado.

**Ganho:** Mostra a receita que realmente entrou no caixa (líquida de taxas), por cliente e por resort, e identifica quem paga em dia vs quem só assinou e não pagou. É a métrica financeira mais importante que o sistema tem dado para gerar e simplesmente não gera.

**Onde:** Cruzar `contratos.cpf_contratante1` com `asaas_boletos.customer_cpf` (ambos 100% preenchidos); usar `net_value` + `payment_date`. Novo card no SociosDashboard.jsx, seção Financeira.

### 6. Conversão por vendedor(a) está errada: atribui a assinatura a quem editou por último, não a quem vendeu
`alto / baixo / baixo`

**O que é:** Na seção 'Produtividade por Advogado' do Dashboard dos Sócios, os contratos ASSINADOS são atribuídos por `updated_by` (quem mexeu por último no registro). Como as automações (DataJud, ADVBOX, Kommo) atualizam os contratos depois de assinados, o `updated_by` frequentemente NÃO é o vendedor — pode ser um robô ou outra pessoa. Os 'criados' usam `created_by` (correto), mas os 'assinados' e o ticket médio por pessoa ficam distorcidos. Além disso só conta o mês corrente, então no início do mês a tabela fica quase vazia.

**Ganho:** O ranking de equipe passa a refletir quem realmente fechou cada venda, e não quem teve a última automação rodada no registro. Sem isso, comissão e mérito podem ir para a pessoa errada.

**Onde:** client/src/components/SociosDashboard.jsx, computeSociosStats (linhas 300-307): atribuir assinados por `created_by` (o vendedor que criou) e oferecer seletor de período em vez de fixar mês corrente.

### 7. Análise de sazonalidade: quais meses do ano historicamente vendem mais
`medio / medio / baixo`

**O que é:** O sistema tem o histórico mensal mas não há nenhuma visão de sazonalidade — 'janeiro e julho são fracos, março é forte', por exemplo. O YoY do Sócios só compara este ano com o ano passado mês a mês, mas não consolida o padrão sazonal (média por mês do calendário ao longo de todos os anos). Para um escritório que depende de timeshare/resort, sazonalidade de férias é determinante.

**Ganho:** Ajuda a planejar metas e campanhas (reforçar vendas antes dos meses fracos, dimensionar equipe nos picos). Hoje o planejamento é no feeling, sem o padrão sazonal explícito.

**Onde:** client/src/components/dashboard/compute.js (agregar serieMensal por mês-do-calendário) + widget novo; ou seção Estratégico do SociosDashboard.jsx.

### 8. Análise de cohort: das pessoas que entraram em cada mês, quantas (e em quanto tempo) assinaram
`medio / alto / baixo`

**O que é:** O comparador de meses já calcula uma 'conversaoCohort' (criados de um mês que viraram assinados), mas é só um número por mês, sem a curva de maturação. Não há visão de cohort de verdade: 'dos contratos criados em março, X% assinou no 1º mês, Y% até o 2º mês...'. Isso revela se a conversão demora a maturar (cliente assina 2-3 meses depois) — informação que muda como se mede um mês 'ruim' que ainda vai converter.

**Ganho:** Evita o erro de declarar um mês fraco cedo demais: mostra que parte da safra ainda vai assinar. Dá uma leitura muito mais justa do desempenho de vendas recente.

**Onde:** client/src/components/dashboard/compute.js (estender a lógica de cohort já existente nas linhas 250-275) + tabela/heatmap de cohort em widgets.jsx.

### 9. Alertas proativos por e-mail/push, não só quando alguém abre o dashboard
`medio / medio / baixo`

**O que é:** O compute.js gera bons insights automáticos (ritmo de criação caindo 30%, 'nenhum contrato há X dias', resort novo, etc.), mas eles só aparecem se a pessoa ABRIR a aba Dashboard e olhar. Não há nenhum envio proativo. Os mesmos sinais poderiam virar um resumo diário/semanal (push do portal já existe via web-push, ou e-mail) para os sócios.

**Ganho:** Os sócios são avisados de uma queda de ritmo ou de contratos parados sem precisar lembrar de abrir o sistema. Insight que ninguém vê não vale nada.

**Onde:** Reusar os insights de compute.js num cron Netlify (já há keep-warm/reminder-cron como modelo) disparando web-push (VAPID já configurado) ou e-mail.

### 10. Rótulo errado e valor bruto na faixa de inadimplência do Dashboard dos Sócios
`medio / baixo / baixo`

**O que é:** Dois problemas no card de inadimplência do Sócios: (1) a terceira faixa é rotulada '+60d' mas a lógica joga nela tudo que passa de 60 dias E também o que está entre 61-90+, e os rótulos visuais dizem 'até 30d / 31-60d / +60d' enquanto o código usa cortes <=30, <=60, resto — então um boleto de 75 dias e um de 200 dias caem juntos sem distinção; (2) os valores somam o campo `value` (bruto), mas o realista para caixa é `net_value` (líquido de taxas Asaas), que está 100% preenchido. A inadimplência mostrada é maior do que o impacto real no caixa.

**Ganho:** Faixas de atraso corretas (quanto está 'recuperável' vs 'praticamente perdido' acima de 90 dias) e valor líquido real. Inadimplência é número sensível — errar a faixa muda a decisão de cobrança.

**Onde:** client/src/components/SociosDashboard.jsx, computeSociosStats (linhas 247-259): adicionar faixa 90+, alinhar rótulos no render (linhas 1678-1690) e usar net_value.

### 11. Comparador de meses só compara mês cheio com mês cheio — falta comparar 'mês até hoje vs mesmo período do mês passado'
`medio / medio / baixo`

**O que é:** O comparador de meses novo é ótimo para meses fechados, mas comparar o mês corrente (parcial, ex.: dia 14) contra um mês anterior inteiro é injusto e induz a conclusão errada ('estamos muito atrás'). Os KPIs por janela já fazem a comparação pró-rata, mas o widget comparador de meses não oferece a opção 'até o mesmo dia'. Para o mês em andamento, o comparador apto é o pró-rata.

**Ganho:** Evita o susto recorrente de olhar dia 10 do mês e achar que as vendas despencaram, quando na verdade o mês só começou. Comparação justa = decisão calma.

**Onde:** client/src/components/dashboard/widgets.jsx, MonthComparator (linha 487) + dados em compute.js: oferecer modo 'até o dia X' quando um dos meses é o corrente.

### 12. GeoHeatmap mostra contagem por estado, mas não receita por estado nem ticket médio regional
`medio / baixo / baixo`

**O que é:** O mapa geográfico já carrega `honorarios_total` por contratante (campo `valor` em GeoHeatmap.jsx) mas só USA a contagem de contratos para ordenar e exibir. A receita por UF e o ticket médio por região ficam calculados mas escondidos. Saber que 'SP traz 30 contratos mas RJ traz menos contratos de ticket mais alto' é estratégico para onde investir em marketing.

**Ganho:** Revela quais estados/regiões geram mais DINHEIRO, não só mais volume. Pode mudar a alocação de verba de aquisição. O dado já está carregado — só falta mostrar.

**Onde:** client/src/components/GeoHeatmap.jsx (linhas 73-91): já agrega `valor` por UF; expor receita e ticket médio na visão de estado/cidade.

### 13. Tabela 'dashboard' da API Power BI não exporta receita nem assinaturas agregadas
`medio / baixo / baixo`

**O que é:** O endpoint `api-powerbi?table=dashboard` devolve só contagens (por status, resort, tipo, mês, usuário, origem). Não há somatório de honorários por mês, nem contagem de assinados por mês de assinatura, nem receita por resort. Quem monta painel financeiro no Power BI precisa baixar TODOS os contratos e recalcular do zero, em vez de receber agregados prontos. E, como visto, 'por_origem' vem vazio por causa do bug da coluna.

**Ganho:** Power BI recebe agregados financeiros prontos (receita/mês, assinados/mês, ticket médio/resort), deixando os relatórios mais rápidos e sem o analista ter que refazer a conta de receita manualmente.

**Onde:** client/netlify/functions/api-powerbi.mjs, bloco `table === 'dashboard'` (linhas 82-112): adicionar somas de honorarios_total por mês de assinatura e por resort.

### 14. Painel de qualidade de dados (data quality) para os campos que alimentam o BI
`medio / medio / baixo`

**O que é:** Vários campos que o BI depende estão parcialmente ou totalmente vazios e ninguém é avisado: `signed_at` falta em 31 dos 140 assinados; `peticao_distribuida_em` só existe em 50 de 163 (logo o 'tempo até distribuição' cobre <1/3 da carteira); as colunas top-level `origem_cliente`/`data_primeira_mensagem` estão 100% vazias. Não há nenhuma tela mostrando 'X% dos contratos estão sem campo Y'. Os dashboards exibem médias e prazos sobre buracos sem sinalizar a cobertura.

**Ganho:** Os sócios passam a saber QUANTO de cada métrica é confiável (ex.: 'tempo até distribuição baseado em só 31% dos casos'). Hoje uma média calculada sobre 30% da base é apresentada como se fosse a verdade da carteira inteira.

**Onde:** Novo card 'Qualidade dos dados' no Dashboard ou Monitor, lendo cobertura de signed_at, peticao_distribuida_em, honorarios, origem (via dados JSONB) — base em compute.js.

### 15. Aposentar de vez a materialized view dashboard_stats (ou documentar que está órfã)
`baixo / baixo / baixo`

**O que é:** A MV `dashboard_stats` ainda existe no banco e foi tirada da tela do Dashboard em junho (o próprio comentário no Dashboard.jsx diz isso), mas continua sendo mantida/atualizada para 'outros usos'. Confirmei que ela existe. O risco é alguém (ou a api-powerbi futura) voltar a ler dela achando que está fresca, e ela divergir do cálculo ao vivo — exatamente o bug de 'números diferentes na mesma tela' que já aconteceu antes. Ou está sendo atualizada à toa (custo), ou pode enganar quem a consultar.

**Ganho:** Elimina uma fonte de verdade duplicada e divergente. Ou se confirma que ninguém usa e remove (economia/limpeza), ou se documenta claramente quem consome para não virar pegadinha de novo.

**Onde:** Banco Supabase (MV dashboard_stats) + verificar consumidores (api-powerbi.mjs, api-rest.mjs, snapshot workers). Decidir manter documentado ou dropar.

### 16. Insight de receita: o Dashboard só analisa CONVERSÃO, nunca o VALOR dos contratos que escapam
`medio / medio / baixo`

**O que é:** Todos os insights automáticos de compute.js olham taxa de assinatura, velocidade e dias da semana — nunca o dinheiro. Não há insight do tipo 'os contratos enviados e não assinados há +3 dias somam R$ X em honorários parados' por resort, nem 'o resort A converte pouco mas tem ticket alto, vale priorizar follow-up'. O `pipeline_aberto` (honorários a assinar) é só um KPI total, sem recorte por resort/vendedor que mostre ONDE está o dinheiro parado.

**Ganho:** Direciona o esforço de follow-up para onde tem mais dinheiro parado, não só para onde tem mais contratos. Um contrato de R$ 50k parado importa mais que três de R$ 2k.

**Onde:** client/src/components/dashboard/compute.js, bloco de insights (linhas 486-655): adicionar insight de valor em risco no pipeline, com recorte por resort.

### 17. Exportação Excel do Dashboard não inclui as métricas calculadas (jornada, tempo até assinatura, receita realizada)
`baixo / baixo / baixo`

**O que é:** O export do Excel (handleExportExcel no Dashboard.jsx) baixa colunas cruas do contrato (nome, CPF, honorários, datas) mas não inclui os campos derivados que o próprio dashboard calcula: dias de jornada (1ª mensagem→assinatura), tempo criação→assinatura, tipo de honorário, mês de assinatura efetiva. Quem exporta para analisar fora tem que recalcular tudo de novo no Excel.

**Ganho:** O Excel exportado já vem com as colunas analíticas prontas, do mesmo jeito que aparecem no dashboard — sem o usuário ter que refazer fórmulas. Coerência entre o que se vê e o que se exporta.

**Onde:** client/src/components/Dashboard.jsx (handleExportExcel, linhas 190-208) e client/src/utils/excelExport.js: enriquecer linhas com os campos derivados de compute.js.

## Portal do Cliente & Bot WhatsApp

### 1. Portal mostra processos pelo NOME do cliente, não pelo CPF — risco de homônimo ver caso de outra pessoa
`alto / medio / medio`

**O que é:** O link do portal é gerado para um CPF específico (cliente_portal_tokens guarda o CPF), mas na hora de buscar os processos o sistema procura por NOME ('ilike clientes %NOME%' em bi_processos). Se existirem dois clientes com nome igual ou parecido (ex.: 'MARIA SILVA', 'JOSÉ SANTOS' — muito comum), o portal de uma pessoa pode listar processos, andamentos e até a fase do caso de OUTRA pessoa. Como o portal não tem senha (o token é o acesso), isso é um vazamento real de dado sensível entre clientes. A correção: fazer o match por CPF (já temos o CPF no token e o customer_id do ADVBOX), filtrando os processos pelo cliente certo, e nunca só pelo nome.

**Ganho:** Elimina o risco de um cliente ver o processo de outro (vazamento de dado sensível), protege o escritório de problema sério de LGPD e de quebra de sigilo.

**Onde:** client/netlify/functions/portal-data.mjs (linha ~241, .ilike('clientes', `%${nome}%`)) — usar advbox_customer_id do token + bi_processos por customer_id, com CPF como reforço

### 2. Bot do WhatsApp também busca processos pelo nome — mesmo risco de mostrar caso errado
`alto / medio / medio`

**O que é:** Igual ao portal, o bot identifica o cliente (por telefone ou CPF) mas depois busca os processos por NOME ('bot_processos' com p_nome). Quem se identificou corretamente pode acabar recebendo informação de um homônimo. Como o bot responde no WhatsApp do cliente, o erro é entregue direto na conversa. A correção é a mesma: depois de identificar o cliente, buscar os processos pelo identificador único dele (customer_id do ADVBOX), não pelo nome.

**Ganho:** Garante que o bot só fale do processo da pessoa certa, evitando passar informação processual de terceiros pelo WhatsApp.

**Onde:** client/netlify/functions/_lib/botEngine.mjs (linha ~443, db.rpc('bot_processos', { p_nome: customerName })) — trocar para busca por customer_id

### 3. Links do portal nunca expiram e não têm validade — um link vazado dá acesso eterno
`alto / medio / baixo`

**O que é:** O token do portal não tem data de expiração: a tabela cliente_portal_tokens só tem 'ativo' true/false, sem campo de validade. Um link compartilhado por engano (encaminhado no WhatsApp da família, print, e-mail) continua funcionando para sempre, e dá acesso a processo, pagamentos, código PIX e acordo do cliente. Hoje só dá para revogar manualmente, link por link. Sugestão: adicionar um prazo de validade (ex.: renovação automática a cada X meses ou expiração após Y dias de inatividade) e revogação automática quando o caso é arquivado. O link continua simples para o cliente, mas deixa de ser uma chave permanente.

**Ganho:** Reduz a janela de risco de um link vazado e dá controle real sobre quem ainda tem acesso, sem trabalho manual.

**Onde:** supabase_bot_advbox.sql (tabela cliente_portal_tokens — adicionar coluna de expiração) + client/netlify/functions/portal-data.mjs (validação do token) + portal-admin.mjs (rotação)

### 4. Portal e bot não têm limite de requisições (rate limit) — abertos a tentativa de adivinhar tokens em massa
`medio / baixo / baixo`

**O que é:** Existe um utilitário de rate limit pronto (rate-limit.mjs), mas NENHUMA function do portal ou do bot o usa. O token tem 32 caracteres, então adivinhar por força bruta é difícil, mas hoje nada impede milhares de tentativas por segundo (sondar tokens, floodar perguntas/NPS, ou simplesmente abusar das chamadas que disparam consultas ao Asaas e ao banco). Aplicar o rate limit (por IP) nos endpoints públicos portal-data, portal-pergunta, portal-feedback, portal-push e no webhook do bot fecha essa porta com pouco esforço.

**Ganho:** Protege contra abuso, varredura de tokens e sobrecarga, sem afetar o uso normal do cliente.

**Onde:** client/netlify/functions/rate-limit.mjs (já existe, não importado em lugar nenhum) — usar em portal-data.mjs, portal-pergunta.mjs, portal-feedback.mjs, portal-push.mjs, kommo-advbox-webhook.mjs

### 5. Geração do PIX ao vivo trava o carregamento do portal e o acopla à disponibilidade do Asaas
`medio / medio / baixo`

**O que é:** Quando falta o código PIX de uma parcela no espelho local, o portal-data busca AO VIVO na API do Asaas (até 3 chamadas), uma após a outra, dentro da requisição que monta a tela do cliente. Se o Asaas estiver lento ou fora do ar, o portal inteiro fica lento ou pode dar erro — mesmo nas seções que não têm nada a ver com pagamento. Melhor: gerar/guardar o PIX no momento do sync de boletos (em segundo plano) e, se faltar na hora, deixar o portal carregar normalmente e buscar o PIX só quando o cliente clicar em 'pagar por PIX'.

**Ganho:** Portal abre rápido e estável mesmo quando o Asaas está instável; o cliente nunca vê a tela travada por causa de um código de pagamento.

**Onde:** client/netlify/functions/portal-data.mjs (linhas ~390-401, loop de fetch pixQrCode dentro da resposta)

### 6. Bot promete 'retorno ainda hoje em horário comercial' sem saber se é fim de semana, feriado ou madrugada
`medio / baixo / baixo`

**O que é:** Quando o cliente pede atendimento humano ou aparece como detrator, o bot responde 'você receberá retorno ainda hoje em horário comercial'. Mas isso é uma frase fixa: o bot não verifica a hora nem o dia. Se o cliente escreve sábado à noite ou num feriado (e o portal já tem um calendário forense completo, com feriados de Americana/SP!), a promessa fica falsa e gera frustração. Sugestão: reaproveitar a lógica de dia útil que já existe no portal-data para o bot dizer a coisa certa ('retornamos no próximo dia útil', 'amanhã pela manhã' etc.).

**Ganho:** Evita prometer o que não será cumprido fora do expediente, aumentando a confiança do cliente na comunicação automática.

**Onde:** client/netlify/functions/_lib/botEngine.mjs (linha ~250, respostaFinanceira opção 4, e bloco de 'humano' ~492) — reaproveitar ehDiaUtil/proximoDiaUtil de portal-data.mjs

### 7. Quando o cliente pede humano, o bot só cria tarefa no CRM — ninguém é avisado na hora
`alto / medio / baixo`

**O que é:** No escalonamento (cliente quer falar com pessoa, ou financeiro, ou deu nota baixa de NPS), o bot cria uma tarefa no Kommo com prazo de 1 dia útil e posta uma nota de resumo. Mas isso depende de alguém abrir o Kommo e ver a tarefa — não há aviso ativo (notificação interna no sistema, e-mail, ou marcação visual no Monitor). Um cliente irritado pode ficar horas/dias esperando. Sugestão: além da tarefa, gerar uma notificação interna no próprio sistema (já existe a tabela notifications e o NotificationCenter) e/ou um destaque no painel, para a equipe agir rápido nos handoffs e detratores.

**Ganho:** Reduz o tempo de resposta a clientes que pediram ajuda humana ou estão insatisfeitos, evitando que o pedido se perca numa lista de tarefas.

**Onde:** client/netlify/functions/advbox-bot-worker-background.mjs (bloco result.escalate ~92) e portal-feedback.mjs (detrator ~47) — inserir em notifications/NotificationCenter

### 8. Push do portal compara cliente x novidade só pelo NOME — pode notificar a pessoa errada ou ninguém
`medio / medio / baixo`

**O que é:** Quando há novidade num processo, o monitor decide para quem mandar a notificação push comparando o NOME do dono do token com o NOME do cliente do processo ('clientesNovidade.some(c => c.includes(nome))'). Isso tem dois problemas: homônimos podem receber aviso de processo alheio, e nomes com pequena diferença (acento, abreviação, ordem) podem não casar e o cliente certo não recebe nada. O ideal é casar pelo identificador do cliente (advbox_customer_id, que já está salvo tanto no token quanto na inscrição de push), não por texto de nome.

**Ganho:** Garante que o aviso de novidade chegue ao dono certo do processo e não a um homônimo — confiabilidade e privacidade.

**Onde:** client/netlify/functions/advbox-monitor-worker-background.mjs (bloco PUSH do portal ~150-176, comparação por nome)

### 9. Texto técnico cru pode escapar para o cliente quando o glossário e a IA falham
`medio / baixo / baixo`

**O que é:** A tradução de um andamento tenta, nesta ordem: tradução salva, glossário, IA e, se tudo falhar, devolve o TÍTULO ORIGINAL (juridiquês cru). No portal há proteção (cai em 'Movimentação processual registrada'), mas no BOT do WhatsApp o translateMovement retorna o texto técnico original quando nada casa. Ou seja: o cliente pode receber no WhatsApp um andamento em juridiquês puro, exatamente o que o produto quer evitar. Sugestão: alinhar o bot ao portal, com um texto neutro de fallback quando não houver tradução, e registrar os termos não traduzidos para o escritório completar o glossário.

**Ganho:** Cliente nunca recebe texto jurídico incompreensível pelo WhatsApp; e o escritório descobre quais termos faltam traduzir.

**Onde:** client/netlify/functions/_lib/botEngine.mjs (translateMovement ~80, retorna 'title' como fallback; usado em buildLawsuitAnswer ~150)

### 10. Termos não traduzidos não são registrados — o glossário só cresce na sorte de alguém perceber
`medio / medio / baixo`

**O que é:** Quando um andamento não casa com nenhum termo do glossário e a IA está desligada, o sistema simplesmente segue sem traduzir. Não há nenhum registro de 'este termo apareceu e não soube traduzir'. Resultado: o glossário só melhora quando alguém, por acaso, nota uma tradução faltando. Sugestão: gravar numa lista (ou na própria advbox_api_log) os títulos de andamento que ficaram sem tradução, e mostrar no painel do bot uma aba 'termos pendentes de tradução' com contagem. Assim o escritório cobre os casos mais frequentes primeiro.

**Ganho:** Transforma o glossário num sistema que aprende: a equipe vê exatamente o que falta traduzir e prioriza o que mais aparece para os clientes.

**Onde:** client/netlify/functions/_lib/botEngine.mjs (translateMovement/glossaryTranslate) + um novo painel em client/src/components/bot/ (ao lado de BotGlossario.jsx)

### 11. Perguntas e NPS do portal varrem TODOS os contratos para achar o lead do Kommo
`medio / baixo / baixo`

**O que é:** Quando um cliente faz uma pergunta no portal ou responde o NPS, o sistema, para criar a tarefa no Kommo, carrega TODOS os contratos não arquivados (com o campo pesado dados->contratantes) e procura o CPF na memória da função. Isso é lento e desperdiça banco a cada pergunta/avaliação, e tende a piorar conforme a base cresce. Como já existe a coluna cpf_contratante1/2 nos contratos, dá para filtrar direto no banco pelo CPF do cliente e trazer só o registro certo.

**Ganho:** Pergunta e NPS respondem mais rápido e param de pesar no banco compartilhado, especialmente com a base crescendo.

**Onde:** client/netlify/functions/portal-pergunta.mjs (~44) e portal-feedback.mjs (~51) — filtrar contratos por cpf_contratante no banco em vez de varrer tudo

### 12. Pergunta do cliente vira tarefa só se houver link Kommo no contrato — sem isso, ninguém é avisado
`medio / baixo / baixo`

**O que é:** A pergunta enviada pelo portal sempre é gravada no banco (portal_perguntas), mas a tarefa de acompanhamento no Kommo só é criada se aquele cliente tiver um linkKommo preenchido no contrato. Para casos antigos ou sem link, a pergunta fica parada esperando alguém abrir a aba 'Portal do Cliente' no sistema e perceber. Não há aviso ativo. Sugestão: garantir um aviso interno (notificação no sistema) para TODA pergunta nova, independente de ter lead no Kommo, e mostrar um contador de perguntas pendentes no menu.

**Ganho:** Nenhuma pergunta de cliente fica sem resposta por falta de vínculo no CRM; a equipe sempre é avisada.

**Onde:** client/netlify/functions/portal-pergunta.mjs (tarefa Kommo é condicional ao leadId ~55) — adicionar notificação interna sempre; contador em client/src/components/PortalClientePanel.jsx

### 13. Nota do detrator de NPS é igual à da pergunta — não há fluxo de retenção diferenciado
`medio / medio / baixo`

**O que é:** Quando um cliente dá nota baixa de NPS (detrator, 0-6), o sistema cria uma tarefa genérica no Kommo de 1 dia útil. Mas um detrator é justamente o cliente em risco de sair, reclamar publicamente ou virar problema. Hoje ele entra na mesma fila de uma pergunta qualquer. Sugestão: tratar detrator com prioridade própria (tarefa marcada como urgente, aviso para o sócio/responsável, e idealmente um pedido de desculpas/contato proativo padronizado). O NPS já está sendo coletado; falta usar o sinal.

**Ganho:** Cliente insatisfeito é contatado rápido e com cuidado, reduzindo cancelamentos e reclamações públicas (que afetam reputação do escritório).

**Onde:** client/netlify/functions/portal-feedback.mjs (bloco nota <= 6 ~47) — prioridade/destinatário diferenciado + aba de detratores em PortalClientePanel.jsx

### 14. Dados do cliente ficam guardados em texto puro no navegador (offline) sem aviso nem expiração
`medio / baixo / baixo`

**O que é:** Para funcionar offline, o portal salva o payload completo do cliente (nome, processos, andamentos, valores, parcelas) em localStorage, em texto puro e sem prazo de validade. Em celular ou computador compartilhado, qualquer pessoa que abra o navegador pode encontrar esses dados, mesmo sem o link. Sugestão: limitar o que é guardado offline (só o essencial para a última tela), apagar esse cache ao detectar inatividade prolongada, e avisar no rodapé que os dados ficam no aparelho. É um ajuste de privacidade barato.

**Ganho:** Reduz exposição de dados do processo em aparelhos compartilhados e deixa o portal mais alinhado com a LGPD.

**Onde:** client/portal.html (~1343 localStorage.setItem('cbc_payload', ...) e ~1349 leitura do cache)

### 15. Chamada de IA (tradutor) usa modelo fixo no código e não tem limite de gasto
`baixo / baixo / baixo`

**O que é:** Se a tradução por IA for ligada (ANTHROPIC_API_KEY), o bot chama o modelo definido em config, mas o código tem 'claude-opus-4-8' como padrão fixo — um modelo caro — e não há nenhum teto de gasto nem aviso de custo. Como há cache (bot_ai_cache), o impacto é amortecido, mas num pico de termos novos (ex.: backfill ou muitos processos) o custo pode disparar sem ninguém perceber. Sugestão: usar por padrão um modelo mais barato/rápido para tradução curta, expor a escolha no painel com aviso de custo, e registrar quantas traduções por IA foram feitas no período (já dá para somar no cache).

**Ganho:** Mantém a qualidade da tradução com custo previsível, sem surpresa na fatura da IA.

**Onde:** client/netlify/functions/_lib/botEngine.mjs (aiTranslate ~57-78, modelo padrão 'claude-opus-4-8') + BotConfig.jsx (seção IA)

### 16. O webhook do bot não valida a origem — qualquer um pode disparar respostas
`medio / baixo / baixo`

**O que é:** O endpoint kommo-advbox-webhook aceita qualquer POST e repassa para o worker do bot. Não há verificação de assinatura nem de origem (existe a env WEBHOOK_SECRET no projeto, mas não é usada aqui). Como o bot está em modo teste (só responde a telefones cadastrados), o risco prático é limitado hoje, mas quando for ativado para clientes reais um terceiro poderia injetar mensagens forjadas ou floodar o processamento. Sugestão: validar uma chave/assinatura no webhook antes de despachar o worker.

**Ganho:** Impede que terceiros disparem o bot ou sobrecarreguem o processamento quando ele estiver ativo para clientes reais.

**Onde:** client/netlify/functions/kommo-advbox-webhook.mjs (sem validação de origem) — usar WEBHOOK_SECRET ou validar o token do Kommo

### 17. Bot ainda depende de passos manuais no Kommo para funcionar de verdade (Salesbot, bot_id, testadores)
`medio / baixo / baixo`

**O que é:** Pela leitura do código, o envio da resposta ao WhatsApp depende de: gravar a resposta num campo do lead e disparar um 'Salesbot' do Kommo (kommoCfg.bot_id). Se o bot_id não estiver configurado, a resposta é só GRAVADA e NUNCA ENVIADA (há um console.error, mas nada que avise o operador). Hoje o sistema depende de configuração manual no Kommo que, se faltar, faz o bot 'engolir' respostas silenciosamente. Sugestão: validar essa configuração no painel (Config) com um diagnóstico claro ('faltam: bot_id / field_id / Salesbot') e alertar no Monitor quando uma resposta for gerada mas não enviada.

**Ganho:** Evita que o bot processe e nunca entregue a resposta por configuração faltando, e mostra exatamente o que falta para ativar.

**Onde:** client/netlify/functions/advbox-bot-worker-background.mjs (~84-89, bot_id ausente => só grava) + diagnóstico em client/src/components/bot/BotConfig.jsx e MonitorAdvbox.jsx

### 18. Bot guarda contexto da conversa por só 30 minutos — cliente que volta depois 'perde o fio'
`baixo / baixo / baixo`

**O que é:** O estado da conversa do bot (qual cliente, qual processo escolhido, o que estava aguardando) expira em 30 minutos. No WhatsApp é comum o cliente responder horas depois. Quando isso acontece, o bot zera o 'aguardando' e pode pedir CPF de novo ou não lembrar o processo que ele estava vendo, parecendo que 'não presta atenção'. Sugestão: manter a IDENTIFICAÇÃO do cliente por muito mais tempo (ela é segura, vem do telefone/CPF) e expirar só o estado de menu/escolha pendente. Assim o cliente que volta no dia seguinte continua identificado.

**Ganho:** Conversa mais natural: o cliente não precisa se reidentificar a cada retorno, melhorando a experiência no WhatsApp.

**Onde:** client/netlify/functions/_lib/botDb.mjs (getConversation, TTL de 30 min ~68-73) — separar TTL de identidade do TTL de 'awaiting'

### 19. Cliente do portal não consegue ver perguntas anteriores nem receber a resposta de forma ativa
`medio / medio / baixo`

**O que é:** O portal mostra as últimas 6 perguntas do cliente com a resposta da equipe, mas o cliente só descobre que foi respondido se voltar e abrir o portal — não há aviso (o push existente é só para novidade processual, não para resposta de pergunta). Para um cliente ansioso, ficar voltando para checar é exatamente a fonte de ansiedade que o portal quer reduzir. Sugestão: quando a equipe responde uma pergunta na aba 'Portal do Cliente', disparar o mesmo push do portal ('Respondemos sua pergunta') para quem ativou avisos.

**Ganho:** Cliente é avisado quando sua dúvida é respondida, fechando o ciclo de comunicação sem ele precisar ficar conferindo.

**Onde:** client/src/components/PortalClientePanel.jsx (responder pergunta) + reusar o envio de push do advbox-monitor-worker-background.mjs / portal-push.mjs

### 20. Token do portal aparece na URL e é logado/compartilhável — falta um aviso de uso e revogação fácil pelo cliente
`baixo / baixo / baixo`

**O que é:** O acesso ao portal é totalmente pelo token na URL (contratos-cbc.netlify.app/portal?t=...). Esse formato vaza facilmente: fica no histórico do navegador, em prints, em encaminhamentos. Não há nenhuma orientação ao cliente ('não compartilhe este link') nem um jeito do próprio cliente sinalizar 'perdi/comprometi meu link'. Sugestão (complementa a expiração): adicionar no rodapé do portal um aviso curto de que o link é pessoal e um botão 'meu link foi comprometido' que avisa o escritório para rotacionar. Barato e melhora a postura de segurança percebida.

**Ganho:** Conscientiza o cliente a não compartilhar o link e dá um caminho rápido para revogar acesso comprometido.

**Onde:** client/portal.html (rodapé) + ação de rotação já existente em portal-admin.mjs (action 'rotate')

## Testes & CI/CD

### 1. O CI nunca roda: o arquivo de automacao nao esta no GitHub
`alto / baixo / baixo`

**O que é:** PROBLEMA HOJE: existe um arquivo de CI (.github/workflows/ci.yml) que deveria rodar build+lint automaticamente a cada alteracao enviada ao GitHub, MAS ele nunca foi enviado para o repositorio — no Git ele aparece como 'nao rastreado' (??) e o ultimo commit literalmente se chama 'Remove workflow file for push compatibility'. Ou seja: a rede de seguranca automatica que o CLAUDE.md diz existir NAO existe. Hoje nada e verificado automaticamente quando o codigo muda. O QUE MELHORA: commitar e enviar o ci.yml faz o GitHub rodar build e lint sozinho em cada mudanca, pegando erros antes de chegarem na producao, sem depender de ninguem lembrar de rodar a mao.

**Ganho:** Verificacao automatica de toda mudanca de codigo (build quebrado e erros pegos antes da producao), sem esforco humano.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/.github/workflows/ci.yml (existe localmente mas 'git ls-files .github/' retorna vazio = nao versionado; git status mostra '?? .github/')

### 2. O deploy publica em producao sem rodar lint nem testes
`alto / baixo / baixo`

**O que é:** PROBLEMA HOJE: o script de deploy (client/deploy.sh) faz apenas 'npm run build' antes de publicar direto na producao. Ele NAO roda os testes (npm test) nem o lint (npm run lint). Como o build do Vite passa mesmo com codigo logicamente errado (ele so verifica se compila), da pra subir para producao um calculo de honorario quebrado, uma mascara de CPF defeituosa ou um contrato com texto errado — e os 6 arquivos de teste que ja existem nem sao executados. O QUE MELHORA: adicionar 'npm test' (e idealmente 'npm run lint') como etapa obrigatoria no deploy.sh ANTES do passo de publicar faz o deploy abortar sozinho se algum teste falhar, impedindo que um bug conhecido va ao ar.

**Ganho:** Deploy aborta automaticamente se um teste quebrar — barreira final antes da producao usada por advogados e clientes reais.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/deploy.sh (passo '[2/4] Rodando build...' chama so 'npm run build'; nenhuma chamada a 'npm test')

### 3. O CI nao roda os testes que ja existem (so build e lint)
`alto / baixo / baixo`

**O que é:** PROBLEMA HOJE: mesmo o ci.yml local so faz duas coisas: build e lint. Os 6 arquivos de teste (validation, masks, contractHtml, extenso, genderDetector, clausulaConflicts) NUNCA sao executados pela automacao — nem localmente no CI, nem no deploy. Eles so rodam se alguem digitar 'npm test' manualmente, o que na pratica quase nao acontece. Entao os testes que ja foram escritos com esforco estao 'mortos': nao protegem nada. O QUE MELHORA: adicionar um passo 'npm test' no ci.yml (e torna-lo um portao que bloqueia) faz cada um desses testes valer a pena de verdade, alertando assim que alguem quebrar uma regra ja coberta (ex: formato de CPF, valor por extenso no contrato).

**Ganho:** Os testes ja escritos passam a efetivamente proteger o codigo, em vez de existirem so no papel.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/.github/workflows/ci.yml (job 'build-and-lint' tem so 'npm run build' e 'npm run lint'; nao ha passo 'npm test'). Testes em client/src/utils/__tests__/

### 4. O calculo de comissao dos vendedores (dinheiro real) nao tem nenhum teste
`alto / medio / baixo`

**O que é:** PROBLEMA HOJE: a funcao commission-calculator.mjs decide quanto cada vendedora e assistente recebe de comissao todo mes. A logica e complexa: pesos por tipo de contrato, multiplicador de fim de semana (FDS=2), promocoes sazonais, faixas cumulativas (1-20, 21-40, 41-60, 61+), bonus de R$ 1.000 quando o peso passa de 100, e divisao 70/30 entre vendedora e assistente. Tudo isso roda automaticamente todo dia 20 e NAO tem um unico teste. Se uma faixa estiver com a conta errada ou o bonus disparar na hora errada, alguem recebe a mais ou a menos e ninguem percebe ate reclamarem. O QUE MELHORA: criar testes que rodam essa logica com casos conhecidos (ex: 'vendedora com 21 contratos no fim de semana deve receber X') garante que qualquer mudanca futura no calculo seja conferida automaticamente, evitando erro em pagamento.

**Ganho:** Garante que o calculo de pagamento de comissao esteja sempre correto — erro aqui mexe diretamente no bolso da equipe.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/netlify/functions/commission-calculator.mjs (faixas cumulativas, FDS=2, bonus R$1000, split 70/30 — zero testes). Conviria extrair a matematica pura para _lib/ para poder testar sem banco.

### 5. A separacao do PDF assinado (contrato/procuracao/relatorio) nao tem teste
`alto / medio / baixo`

**O que é:** PROBLEMA HOJE: depois que o cliente assina, a funcao save-to-drive.mjs corta o PDF unico em pedacos — as primeiras N paginas viram o contrato, as seguintes a procuracao, e o relatorio da ZapSign vai junto. Essa logica (splitPdfWithReport) usa contagem de paginas e indices; se o numero de paginas do contrato mudar (ex: contrato com 2 contratantes fica mais longo), o corte pode pegar a pagina errada e arquivar no Google Drive um contrato cortado ou uma procuracao com pagina do contrato dentro. Nao ha teste verificando que o corte cai nas paginas certas. O QUE MELHORA: um teste que monta um PDF de exemplo com paginas marcadas e confere se cada pedaco saiu com as paginas corretas evita arquivar documento juridico errado no Drive.

**Ganho:** Evita que contrato/procuracao sejam arquivados cortados ou trocados no Google Drive — documentos com valor juridico.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/netlify/functions/save-to-drive.mjs (funcao splitPdfWithReport, linhas ~70-95, usa pdf-lib e indices de pagina — sem teste)

### 6. O valor por extenso do contrato (ex: 'mil e duzentos reais') so e testado de raspao
`alto / baixo / baixo`

**O que é:** PROBLEMA HOJE: a funcao valorExtenso (em extenso.js) escreve os valores do contrato por extenso — algo que tem peso juridico, porque o contrato assinado diz 'R$ 1.200,00 (um mil e duzentos reais)'. Hoje ela so e testada indiretamente, dentro de um teste de HTML do contrato inteiro, com pouquissimos valores. Casos delicados nao sao verificados: valor com centavos ('e cinquenta centavos'), valor exatamente 1 real (singular 'real' vs 'reais'), valor so de centavos, milhares ('dois mil'), e arredondamento. Um erro de plural ou centavo no contrato e constrangedor e questionavel juridicamente. O QUE MELHORA: testes diretos cobrindo dezenas desses casos garantem que o texto do contrato saia gramaticalmente e numericamente correto sempre.

**Ganho:** Garante que os valores escritos por extenso nos contratos estejam corretos — evita erro gramatical/numerico em documento juridico.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/src/utils/extenso.js (valorExtenso, formatCurrency) — coberto so indiretamente por contractHtml.test.js, sem teste dedicado de casos de borda

### 7. As 41 funcoes serverless (automacoes) nao tem nenhum teste automatizado
`alto / alto / baixo`

**O que é:** PROBLEMA HOJE: o coracao das automacoes vive em 41 funcoes Netlify (.mjs) — enviar pro ADVBOX, arquivar no Drive, mover lead no Kommo, sincronizar boletos do Asaas, bot do WhatsApp, etc. Nenhuma delas tem teste. Hoje a unica forma de saber se mudou alguma coisa e disparar a automacao de verdade em producao e olhar o resultado. Isso e arriscado: um ajuste pequeno no advbox-sync ou no kommo-note pode parar de criar processos ou mover leads, e so se descobre quando algo deixa de funcionar com cliente real. O QUE MELHORA: extrair a logica pura (sem chamadas de rede) dessas funcoes para os arquivos _lib/ e testa-la com entradas fixas permite verificar o comportamento sem tocar producao — comecando pelas mais criticas (advbox-sync, save-to-drive, commission-calculator, kommo-note).

**Ganho:** Permite mudar automacoes com seguranca, verificando o comportamento sem disparar integracoes reais em producao.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/netlify/functions/*.mjs (41 funcoes + _lib/ com advbox/kommo/botDb/botEngine/asaasMirror — find por '*.test*' em netlify/ retorna vazio)

### 8. Nao existe medicao de cobertura: ninguem sabe o que esta testado
`medio / baixo / baixo`

**O que é:** PROBLEMA HOJE: nao ha nenhuma ferramenta medindo quanto do codigo os testes cobrem. Na pratica, dos ~26 arquivos de utilidades e 41 funcoes, so 6 tem algum teste — provavelmente menos de 5% do codigo. Mas isso e estimativa: sem um relatorio de cobertura, e impossivel saber com seguranca quais partes criticas estao desprotegidas e priorizar. O QUE MELHORA: ligar a cobertura do vitest (vitest run --coverage) gera um relatorio mostrando, arquivo por arquivo, o que esta coberto e o que nao esta. Isso transforma 'achismo' em uma lista clara de prioridades e permite, depois, exigir um minimo de cobertura nas partes que importam (contrato, honorarios, comissao).

**Ganho:** Da visibilidade real de quais partes criticas estao sem teste, transformando a estrategia de testes de 'achismo' em decisao baseada em dados.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/vitest.config.js (sem bloco 'coverage'; package.json nao tem @vitest/coverage-v8 nas devDependencies)

### 9. Nenhum teste de ponta a ponta (E2E) do fluxo do usuario no navegador
`alto / alto / baixo`

**O que é:** PROBLEMA HOJE: nao existe nenhum teste automatizado que abra o app num navegador e faca o caminho real do usuario (login, preencher contrato, validar campos, gerar PDF, enviar pra assinatura). O CLAUDE.md descreve 'E2E logado' feito a mao em cada sessao — ou seja, e uma pessoa clicando e conferindo, o que e lento, nao se repete sozinho e some quando a sessao acaba. Telas como o FormPanel (~1750 linhas, com OCR, mascaras, validacoes, deteccao de idoso/duplicata) sao 100% manuais. O QUE MELHORA: adicionar uma ferramenta como Playwright com 5-10 fluxos-chave grava esses caminhos de uma vez; eles passam a rodar sozinhos (inclusive no CI) e pegam quebras de tela e de validacao antes do deploy.

**Ganho:** Pega quebras de fluxo do usuario (formulario, validacao, geracao de PDF) automaticamente, sem depender de clicar a mao toda vez.

**Onde:** App: /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/src (FormPanel.jsx, App.jsx, LoginScreen.jsx) — nenhuma dependencia de Playwright/Cypress no package.json

### 10. O lint nao bloqueia o deploy e convive com ~35 erros 'de baseline'
`medio / medio / baixo`

**O que é:** PROBLEMA HOJE: o proprio ci.yml admite que o lint e 'so informativo' porque existem ~35 erros conhecidos no codigo (citados tambem no CLAUDE.md, ex: 12 erros no MonitorPanel). Como ha esses 35 erros tolerados, e impossivel distinguir um erro NOVO (introduzido agora, talvez um bug) de um antigo — todos viram ruido e o lint deixa de proteger. O QUE MELHORA: zerar/consertar esse baseline (ou registra-lo formalmente para o lint so reclamar de NOVOS problemas) e entao tornar o lint um portao obrigatorio. Assim, qualquer variavel nao usada, hook mal escrito ou import quebrado introduzido numa mudanca trava o deploy na hora.

**Ganho:** O lint volta a ter valor: erros novos (potenciais bugs) sao bloqueados, em vez de se perderem no meio de 35 erros antigos tolerados.

**Onde:** Baseline citado em /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/.github/workflows/ci.yml (comentario '~35 erros de baseline') e CLAUDE.md (MonitorPanel '12 lint errors pre-existentes'). Config: client/eslint.config.js

### 11. Nao ha smoke test pos-deploy: o site pode subir quebrado e ninguem ve
`medio / baixo / baixo`

**O que é:** PROBLEMA HOJE: depois que o deploy.sh publica, ele so imprime 'DEPLOY CONCLUIDO' e o link — nao verifica se o site realmente carregou nem se as funcoes principais respondem. Se um deploy subir com uma pagina branca, login quebrado ou a funcao 'health' fora do ar, isso so e descoberto quando um usuario reclama. O QUE MELHORA: adicionar ao fim do deploy.sh um conjunto de checagens rapidas (smoke test) — por exemplo, bater na URL de producao e confirmar que retorna 200, e chamar /.netlify/functions/health e /api/zapsign confirmando que respondem — faz o proprio deploy avisar 'subiu quebrado, faca rollback' em segundos. Ja existe o rollback.sh para reverter, falta o gatilho automatico.

**Ganho:** Detecta deploy quebrado em segundos (e sugere rollback) em vez de depender de um usuario reclamar que o sistema parou.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/deploy.sh (passo '[4/4]' e final — nenhuma verificacao de saude apos publicar). Existe rollback.sh, mas o disparo e manual. Funcao health em netlify/edge-functions/health.ts

### 12. A tabela tipo de acao -> ID do ADVBOX nao tem teste de protecao
`medio / baixo / baixo`

**O que é:** PROBLEMA HOJE: em advboxService.js existe uma tabela fixa que liga cada tipo de acao a um numero do ADVBOX (ex: 'Acao de cobranca' -> 2151644, 'Dano moral' -> 2187482). O CLAUDE.md inclusive marca isso como REGRA #10 ('nunca alterar sem atualizar a tabela'). A funcao ainda tenta 'adivinhar' por texto parecido (normaliza acentos, casa por regex). Se alguem mexer nessa tabela ou na normalizacao, um contrato pode ser lancado no ADVBOX com o tipo de processo ERRADO, e isso so aparece la na frente, no acompanhamento processual. O QUE MELHORA: um teste simples que confere 'tipo X sempre vira ID Y' (e que entradas com acento/maiuscula/erro de digitacao caem no ID certo) trava qualquer alteracao acidental nessa tabela critica.

**Ganho:** Impede que contratos sejam lancados no CRM juridico com o tipo de processo errado por uma mudanca acidental na tabela de mapeamento.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/src/utils/advboxService.js (TIPO_ACAO_MAP linhas ~28-37 e getTipoAcaoId com normalizacao/regex, linhas ~150+) — sem teste

### 13. Mascaras de telefone e RG e a deteccao de duplicatas estao sem teste suficiente
`medio / baixo / baixo`

**O que é:** PROBLEMA HOJE: o arquivo masks.js formata CPF, CEP, telefone e RG. Os testes existentes focam em CPF/CEP, mas telefone (que tem formato variavel — fixo 10 digitos vs celular 11) e RG (que aceita letras e pontos) sao os mais propensos a bug e estao pouco cobertos. Alem disso, o duplicateDetector.js (que avisa se ja existe contrato com aquele CPF+Resort — REGRA #6) NAO tem nenhum teste, apesar de evitar contrato duplicado. Se a deteccao falhar, cria-se contrato em dobro sem aviso. O QUE MELHORA: completar os testes de mascara (telefone fixo x celular, RG com letra) e criar testes para o detector de duplicatas garante que esses dois 'porteiros' do formulario continuem funcionando.

**Ganho:** Garante que telefones/RGs sejam formatados certo e que o aviso de contrato duplicado realmente dispare — evitando cadastro com dado torto ou contrato em dobro.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/src/utils/masks.js (maskPhone, maskRG pouco cobertos) e src/utils/duplicateDetector.js (sem nenhum teste — confirmado: nao ha arquivo de teste para ele)

### 14. A geracao do DOCX (Word) do contrato e da procuracao nao tem teste
`medio / medio / baixo`

**O que é:** PROBLEMA HOJE: alem do PDF, o sistema gera o contrato e a procuracao em Word (.docx) por dois caminhos separados (docxGenerator.js, ~436 linhas, REGRA #19). O HTML do contrato tem testes de 'snapshot' (foto do resultado), mas o DOCX nao tem nenhum. Como o DOCX e montado com a biblioteca docx por uma logica propria, ele pode divergir do contrato em HTML/PDF — por exemplo, faltar uma clausula avulsa, errar o nome do contratante em maiusculas ou perder o segundo contratante — sem que ninguem perceba, porque ninguem abre o Word gerado a cada mudanca. O QUE MELHORA: testes que geram o DOCX e conferem que os pontos-chave aparecem (nome em maiusculas, CPF formatado, resort, valor por extenso, clausulas, 2o contratante) garantem que a versao Word continue batendo com o contrato real.

**Ganho:** Evita que a versao Word do contrato/procuracao saia diferente do PDF (clausula faltando, contratante errado) sem ninguem notar.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/src/utils/docxGenerator.js (generateContractDocxBlob, generateProcuracaoDocxBlob) — sem teste; contraste com contractHtml.test.js que cobre so o HTML

### 15. A importacao de contrato assinado externo (parsing) nao e testada
`medio / medio / baixo`

**O que é:** PROBLEMA HOJE: importContrato.js (~303 linhas) processa contratos assinados fora do sistema e checa requisitos de automacao (checkAutomacaoRequisitos) antes de disparar ADVBOX/Drive/Asaas. Se esse parsing extrair errado um campo (CPF, valor, contratante) ou liberar a automacao sem todos os requisitos, dispara-se uma cadeia de integracoes (cria processo, cobra boleto) com dado errado — e desfazer isso depois e trabalhoso. Hoje nada testa esse caminho. O QUE MELHORA: testes com exemplos de contratos importados (um completo, um faltando requisito, um com campo torto) garantem que o sistema so dispare as automacoes quando os dados estiverem realmente completos e corretos.

**Ganho:** Evita disparar cobranca e abertura de processo a partir de uma importacao com dados incompletos ou errados.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/src/utils/importContrato.js (processImport, checkAutomacaoRequisitos) — sem teste

### 16. Os testes de contrato sao 'fotos' (snapshots) que podem ser aprovadas no automatico
`medio / baixo / baixo`

**O que é:** PROBLEMA HOJE: boa parte da cobertura do contrato sao testes de 'snapshot' — eles tiram uma foto do HTML gerado e comparam com a foto salva. O risco e cultural: quando o teste de snapshot acusa diferenca, a saida facil e rodar 'atualizar snapshots' e aceitar a nova foto sem ler — inclusive aceitando um erro de verdade (ex: honorario que sumiu do texto). Snapshot e otimo para pegar mudanca inesperada, mas pessimo como unica garantia de que o conteudo esta CORRETO. O QUE MELHORA: complementar (nao substituir) os snapshots com assercoes explicitas das regras de negocio — 'tem que conter o percentual de exito', 'tem que ter as 12 parcelas', 'NAO pode ter R$ ___ em branco', 'singular/plural certo' — torna o teste resistente a aprovacao distraida.

**Ganho:** Reduz o risco de um erro real no contrato passar batido porque o snapshot foi 'atualizado' sem ninguem conferir.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/src/utils/__tests__/contractHtml.test.js + __snapshots__/contractHtml.test.js.snap (varios blocos sao 'toMatchSnapshot'; ha algumas invariantes, mas poucas)

### 17. Sem testes de validacao de webhooks (ZapSign, Asaas, Kommo) que recebem dados de fora
`medio / medio / baixo`

**O que é:** PROBLEMA HOJE: o sistema recebe 'avisos automaticos' (webhooks) de fora — ZapSign avisa que assinou, Asaas avisa que pagou, Kommo dispara o bot. Essas funcoes (zapsign-webhook, asaas-webhook, kommo-advbox-webhook) processam dados que vem da internet e disparam acoes importantes (marcar contrato como assinado, emitir nota fiscal). Nao ha teste verificando o que acontece com um aviso malformado, repetido, ou sem a assinatura de seguranca (WEBHOOK_SECRET). Sem isso, um payload estranho pode quebrar o processamento ou disparar acao indevida. O QUE MELHORA: testes que mandam payloads de exemplo (valido, duplicado, sem segredo, com campo faltando) para a logica do webhook garantem que ele aceite o certo, ignore o invalido e nao processe duas vezes o mesmo evento.

**Ganho:** Garante que os avisos automaticos de assinatura e pagamento sejam processados de forma segura e sem duplicar acoes.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/netlify/functions/zapsign-webhook.mjs, asaas-webhook.mjs, kommo-advbox-webhook.mjs — sem teste; idealmente isolar parsing/validacao em _lib/

### 18. Travar o tamanho dos bundles para nao estourar de mansinho
`baixo / baixo / baixo`

**O que é:** PROBLEMA HOJE: o deploy.sh ja imprime os 10 maiores arquivos JS gerados, mas isso e so informativo — ninguem olha a cada deploy. Esse app carrega bibliotecas pesadas (jsPDF, html2canvas, Tesseract OCR, docx, xlsx); se uma importacao errada fizer um bundle gigante entrar na pagina inicial, o app fica lento no celular dos clientes (e o CLAUDE.md ja teve trabalho removendo Leaflet/file-saver por isso) e ainda consome a banda do plano Netlify. O QUE MELHORA: adicionar uma checagem que FALHA o build se algum bundle principal passar de um limite (ex: 'main' acima de X KB) transforma 'crescimento silencioso' em um alarme — forcando a investigar antes de subir um app pesado.

**Ganho:** Impede que o app fique lento no celular do cliente por causa de um bundle inchado que entrou sem ninguem notar.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/deploy.sh (passo '[3/4] Tamanhos dos bundles' so imprime 'du -sh', nao falha). Pode virar um passo no ci.yml/vite com limite rigido

### 19. Sem testes para o bot do WhatsApp (botEngine) que conversa com clientes reais
`medio / medio / baixo`

**O que é:** PROBLEMA HOJE: o bot ADVBOX×Kommo tem um motor de regras (netlify/functions/_lib/botEngine.mjs + botDb.mjs) que interpreta o que o cliente escreve no WhatsApp (busca por nome/CPF/CNJ, escolhe processo, traduz andamentos, decide o que ocultar do cliente, escalona pra humano). Isso e logica pura e perfeita para testar — mas nao tem teste. Como ele fala direto com o cliente, um erro pode vazar termo tecnico que deveria estar oculto, responder o processo errado em caso de multiplos, ou nao escalonar quando deveria. O QUE MELHORA: testes com mensagens de exemplo ('quero saber do meu processo', um CPF, 'falar com atendente') verificando a resposta e a decisao do bot garantem que mudancas no motor nao quebrem o atendimento nem exponham algo indevido ao cliente.

**Ganho:** Garante que o bot responda certo e nao exponha informacao tecnica oculta ao cliente, mesmo apos mudancas no motor de regras.

**Onde:** /Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/netlify/functions/_lib/botEngine.mjs e botDb.mjs (isHiddenFromClient, getVisibilityConfig, parsing de intencoes) — sem teste
