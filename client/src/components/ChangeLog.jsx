import { useState, useEffect } from 'react';

// Key for tracking which version the user has seen
const SEEN_VERSION_KEY = 'cbc_seen_version';

const VERSIONS = [
  {
    version: '6.6.1',
    date: '18/06/2026',
    title: 'Boletos removidos não contam mais como inadimplência',
    changes: [
      { type: 'fix', text: 'Boleto excluído no Asaas deixou de aparecer como vencido/pendente e de inflar a inadimplência — 18 clientes saíram da lista de inadimplentes e R$ 8.600 sumiram do total vencido (eram só boletos removidos sendo contados como dívida)' },
      { type: 'fix', text: 'Os números de inadimplência dos cards do topo e do quadro de estatísticas voltaram a bater (o quadro contava os removidos; os cards do topo, não)' },
      { type: 'new', text: 'Boletos removidos agora aparecem numa seção "Removidos" no card do cliente, marcados como "Removido" e SEM botões de abrir boleto, copiar linha digitável ou copiar PIX' },
      { type: 'improve', text: 'Ao abrir o card do cliente, um boleto recém-excluído no Asaas já vira "Removido" na hora (antes só era detectado na sincronização das 06h/18h)' },
    ],
  },
  {
    version: '6.6.0',
    date: '12/06/2026',
    title: 'Versão mobile refeita (iPhone + iPad) + comparador de meses no Dashboard',
    changes: [
      { type: 'new', text: 'Dock ganhou o botão "Mais": TODAS as abas permitidas agora acessíveis no iPhone e iPad em pé (antes 9 abas como Boletos, Monitor e Admin eram impossíveis de abrir no celular)' },
      { type: 'new', text: 'Busca global no toque: ícone de lupa no topo e no menu "Mais" (antes só existia via Cmd+K no teclado)' },
      { type: 'new', text: 'Dashboard: COMPARADOR DE MESES — escolha dois meses e compare criados, assinaturas, receita, ticket médio e conversão, com variações %' },
      { type: 'new', text: 'Dashboard: ao filtrar por período/datas, os indicadores passam a refletir as datas selecionadas (assinaturas, receita, ticket, cancelados e top resort da janela, com comparação vs período anterior equivalente)' },
      { type: 'new', text: 'iPad em pé: aba Novo Contrato agora usa o layout de tela cheia com alternador Formulário/Contrato/Procuração (antes abria o desktop espremido)' },
      { type: 'new', text: 'Preview do contrato no toque virou HTML rolável com zoom — o PDF no iPhone/iPad só mostrava a 1ª página (limitação do Safari); de quebra, parou de gerar PDF a cada tecla no celular' },
      { type: 'new', text: 'Cláusulas com botões ↑/↓ no toque e kanban de vendas com botão "Mover" (arrastar-e-soltar não funciona no iPad/iPhone)' },
      { type: 'fix', text: 'Conteúdo não termina mais escondido atrás do dock — todas as abas ganharam o respiro automático no rodapé' },
      { type: 'fix', text: 'Modais (Enviar para ZapSign, checklist, confirmações) não ficam mais com botões cobertos pelo dock' },
      { type: 'fix', text: 'Pull-to-refresh dos contratos disparava com QUALQUER arrasto — agora só quando a lista está no topo' },
      { type: 'fix', text: 'Zoom automático do iOS eliminado nos formulários (inclusive no formulário público do cliente via QR)' },
      { type: 'fix', text: 'Ações que só apareciam com mouse (remover notificação, excluir view, lixeiras do bot) agora visíveis no toque' },
      { type: 'fix', text: 'Toasts e avisos não estouram mais a tela do iPhone nem cobrem o dock/área do gesto do iPhone' },
      { type: 'improve', text: 'Teclados certos no iPhone: CPF/RG/CEP numéricos, telefone, e-mail — e login com preenchimento automático do Chaveiro' },
      { type: 'improve', text: 'Tabelas largas (Asaas, matriz de permissões, metas) ganharam rolagem horizontal no celular em vez de espremer' },
      { type: 'improve', text: 'Notificações e feed viram painel inferior no iPhone; heatmap com coluna de dias fixa ao rolar' },
      { type: 'improve', text: 'Alvos de toque ≥44px em iPad físico e textos minúsculos (7-9px) elevados no iPhone' },
      { type: 'improve', text: 'Desktop permanece exatamente como era — todas as mudanças valem só para telas/touch móveis' },
    ],
  },
  {
    version: '6.5.0',
    date: '12/06/2026',
    title: 'Dashboard 2.0 — redesign completo + correções de precisão',
    changes: [
      { type: 'new', text: 'Dashboard redesenhado em seções claras: Ação necessária, Indicadores, Pipeline, Desempenho, Prazos, Insights, Geografia e Recentes' },
      { type: 'new', text: 'Filtros unificados no topo (período por chips, resort, tipo de ação) — valem para a página INTEIRA, com toggle para incluir arquivados' },
      { type: 'new', text: 'Produção mensal: criados × assinados lado a lado + modo Receita (honorários por mês de assinatura)' },
      { type: 'new', text: 'Cards de pendência clicáveis — navegam direto para Contratos/Monitor' },
      { type: 'new', text: 'KPIs novos: Assinados no Mês (com variação vs mês anterior), Honorários a Assinar (pipeline aberto); KPIs mortos removidos (Boletos/Leads que só mostravam "—")' },
      { type: 'new', text: 'Listas de desempenho por resort/tipo mostram criados × assinados × taxa de conversão e receita (tooltip)' },
      { type: 'new', text: 'Exportar Excel agora respeita os filtros ativos e inclui colunas "Assinado em" e "Arquivado em"' },
      { type: 'fix', text: 'Contratos ARQUIVADOS não inflam mais as métricas — antes a tela misturava números com e sem arquivados (ex.: 20 "aguardando assinatura" quando 10 eram negócios arquivados)' },
      { type: 'fix', text: 'KPIs Pendentes ADVBOX/Drive corrigidos — contavam TODOS os assinados como pendentes (colunas não vinham na consulta)' },
      { type: 'fix', text: 'Funil de conversão agora é cumulativo (criados → enviados → assinados) — antes comparava contagens de status e a "conversão" passava de 100%' },
      { type: 'fix', text: 'Datas de assinatura usam signed_at (fallback ADVBOX) — updated_at era alterado pelas automações e inflava jornada, tendência e insights' },
      { type: 'fix', text: 'Tempo até Distribuição: mediana/mín/máx do recorte filtrado agora são reais (antes "mediana" era média ponderada de médias)' },
      { type: 'fix', text: 'Anomalias automáticas voltaram a funcionar (liam campos inexistentes e nunca disparavam); ritmo mensal agora compara projeção pró-rata' },
      { type: 'fix', text: 'Top resorts do mês conta por data de ASSINATURA (antes usava data de criação)' },
      { type: 'fix', text: 'Opções de filtro não somem mais ao filtrar (eram derivadas do conjunto já filtrado)' },
      { type: 'improve', text: 'Dark mode 100% funcional no Dashboard (tokens --cbc-* em todos os cards; antes vários fundos ficavam claros no modo escuro)' },
      { type: 'improve', text: 'Distribuição geográfica deixou de baixar o JSONB inteiro de todos os contratos (só contratantes) — economia grande de banda' },
      { type: 'improve', text: 'Tipografia maior e hierarquia visual consistente; widgets duplicados de honorários fundidos em um card com alternância Assinados/Todos' },
    ],
  },
  {
    version: '6.4.0',
    date: '23/05/2026',
    title: 'ChatGuru removido — migracao para Kommo',
    changes: [
      { type: 'fix', text: 'ChatGuru removido completamente do sistema (3 functions, 1 painel, 5 tabelas legacy)' },
      { type: 'improve', text: 'Campo "Link ChatGuru" renomeado para "Link Kommo" — passa a ser opcional' },
      { type: 'improve', text: 'Notas ADVBOX agora referenciam Link Kommo em vez de ChatGuru' },
      { type: 'improve', text: 'Health check passa de 5 para 4 servicos (Supabase, Asaas, ZapSign, Google Apps Script)' },
      { type: 'improve', text: 'Barra de progresso de contratos: 7 → 6 etapas (etapa ChatGuru removida)' },
      { type: 'fix', text: 'Envio automatico de WhatsApp foi DESLIGADO — comunicacao agora e manual via Kommo' },
    ],
  },
  {
    version: '4.2.0',
    date: '12/04/2026',
    title: 'UX Premium — 34 Otimizacoes de Interface, Performance e Experiencia',
    changes: [
      { type: 'new', text: 'Design tokens CSS centralizados (--cbc-navy, --cbc-gold, etc.) para consistencia visual' },
      { type: 'new', text: 'Micro-animacoes de feedback — botoes com scale ao clicar (btn-press)' },
      { type: 'new', text: 'Transicao fluida entre abas — fade + slide ao trocar de secao' },
      { type: 'new', text: 'Breadcrumb contextual no header — CBC / Aba Atual' },
      { type: 'new', text: 'Favicon dinamico — icone muda para check verde quando contrato e assinado' },
      { type: 'new', text: 'Cards com glassmorphism — fundo translucido com blur para profundidade visual' },
      { type: 'new', text: 'Sistema de tooltip global — tooltips elegantes com seta em qualquer elemento' },
      { type: 'new', text: 'Scroll indicator vertical — barra fina mostrando posicao no formulario' },
      { type: 'new', text: 'Hover preview em contratos recentes — tooltip com resort e tipo de acao' },
      { type: 'new', text: 'Efeito ripple em botoes — onda visual ao clicar (btn-ripple)' },
      { type: 'new', text: 'Banner dourado de celebracao — "PRA CIMA CBC!" ao assinar contrato' },
      { type: 'new', text: 'Indicador de saude dos servicos — bolinha verde/amarela/vermelha no header' },
      { type: 'new', text: 'Busca por data — digitar DD/MM/AAAA ou MM/AAAA na busca global' },
      { type: 'new', text: 'Resultados de busca agrupados — Assinados, Enviados, Rascunhos com contadores' },
      { type: 'new', text: 'Error boundary por aba — crash em uma aba nao derruba a aplicacao inteira' },
      { type: 'new', text: 'Grafico de tendencia de assinaturas — sparkline mes a mes com delta %' },
      { type: 'new', text: 'Drill-down na tabela pivot — clicar expande lista de contratos individuais' },
      { type: 'improve', text: 'Contraste WCAG melhorado — textos gray-400/500 com ratio 4.5:1+' },
      { type: 'improve', text: 'Modal com backdrop blur — fundo desfocado atras de modais' },
      { type: 'improve', text: 'Shimmer direcional nos skeletons — onda da esquerda pra direita' },
      { type: 'improve', text: 'Pulse em campos obrigatorios vazios — destaque visual ao tentar salvar' },
      { type: 'improve', text: 'Section headers sticky — titulo da secao fixa no topo ao rolar' },
      { type: 'improve', text: 'React.memo em 7 componentes — StatCard, DonutChart, BarChart, TrendLine, StatusBadge, SignerName, ContractProgressBar' },
      { type: 'improve', text: 'Lazy loading de 6 abas — bundle principal reduzido de 1559KB para 527KB' },
      { type: 'improve', text: 'Cache de dados do Dashboard — sem re-fetch ao trocar de aba' },
      { type: 'improve', text: 'Debounce de 250ms nos filtros do Dashboard' },
      { type: 'improve', text: 'Skeletons especificos por componente (charts, trend, distribuicao, insights)' },
      { type: 'improve', text: 'Autosave visual — indicador "Salvo ha Xmin" no header' },
      { type: 'improve', text: 'Scroll animado — clicar na barra de progresso rola ate a secao' },
    ],
  },
  {
    version: '4.1.0',
    date: '09/04/2026',
    title: 'Dashboard — Tempo até Distribuição + integração DataJud/ADVBOX',
    changes: [
      { type: 'new', text: 'Dashboard — novo card "Tempo até Distribuição" (assinatura até petição inicial) — ideia do Mizael' },
      { type: 'new', text: 'Integração DataJud (CNJ) — busca oficial da dataAjuizamento dos processos' },
      { type: 'new', text: 'Cron automático 3x/dia (08h/13h/18h BRT) — popula datas de distribuição sem intervenção' },
      { type: 'new', text: 'Fallback ADVBOX — detecta distribuição pelo created_at da tarefa "JUNTAR CUSTAS" (auto-criada após "DISTRIBUIR AÇÃO")' },
      { type: 'new', text: 'Resumo por Resort no card de distribuição — barras clicáveis que filtram o card' },
      { type: 'new', text: 'Seletor de Resort no card — filtra KPIs e tabela para ver tempo médio por tipo de ação daquele resort' },
      { type: 'new', text: 'Tabela pivot Resort × Tipo de Ação com código de cor por faixa de prazo (≤30d / 31-60d / 61-120d / +120d)' },
      { type: 'new', text: 'KPIs de distribuição — média, mediana, mais rápido, mais lento, total de processos' },
      { type: 'improve', text: 'Dashboard — todo o dark mode removido: cards sempre com fundo branco no Windows' },
      { type: 'improve', text: 'Dashboard — tipografia aumentada (textos 8-9px → 10-11px) e padding dos cards ampliado (p-4 → p-5)' },
      { type: 'improve', text: 'Dashboard — cards com sombra sutil e transições no hover das linhas da tabela' },
      { type: 'improve', text: 'Dashboard — labels de seção com tracking-wider e cor gray-500 para melhor leitura' },
      { type: 'improve', text: 'App.jsx — passa a gravar advbox_lawsuit_id após criar processo no ADVBOX (habilita sync futuro)' },
      { type: 'improve', text: 'Cálculo de jornada usa signed_at (ADVBOX status_closure) em vez de updated_at — elimina dias negativos' },
      { type: 'fix', text: 'Dashboard — card de distribuição agora renderiza sempre (antes sumia quando vazio)' },
      { type: 'fix', text: 'Backfill de 17 contratos assinados com lawsuit_id faltante (10 via JSONB, 7 via match por customer_id no ADVBOX)' },
      { type: 'fix', text: 'Correção de 3 lawsuit_ids errados (Clarissa, Herycka, Jaqueline) que retornavam 404 no ADVBOX' },
    ],
  },
  {
    version: '4.0.0',
    date: '05/04/2026',
    title: 'Asaas Completo, ChatGuru, Monitor e Automações',
    changes: [
      { type: 'new', text: 'Aba Asaas — painel completo de cobranças com lançamento manual, filtros e relatório PDF' },
      { type: 'new', text: 'Lançamento automático de cobranças no Asaas após assinatura (Boleto + PIX)' },
      { type: 'new', text: 'Nota fiscal emitida automaticamente via webhook quando cliente paga parcela' },
      { type: 'new', text: 'Checkbox de conferência de lançamento no Asaas com nome de quem conferiu' },
      { type: 'new', text: 'ChatGuru — link de assinatura enviado automaticamente ao cliente via WhatsApp' },
      { type: 'new', text: 'ChatGuru — mensagem de cobranças lançadas enviada automaticamente' },
      { type: 'new', text: 'Checkbox "Não mandar mensagem automática" para exceções' },
      { type: 'new', text: 'Aba Monitor — painel de operações com status de todos os serviços em tempo real' },
      { type: 'new', text: 'Monitor — filas de automação (ADVBOX, Drive, Asaas, ZapSign)' },
      { type: 'new', text: 'Monitor — detector de loops (processos travados há mais de 5 min)' },
      { type: 'new', text: 'Monitor — alertas de capacidade dos serviços' },
      { type: 'new', text: 'Monitor — histórico de automações com log detalhado' },
      { type: 'new', text: 'Monitor — console de logs (erros e warnings capturados)' },
      { type: 'new', text: 'Health check endpoint — verifica Supabase, Asaas, ZapSign, ChatGuru, Drive' },
      { type: 'new', text: 'Barra de progresso de 7 etapas: Salvo → ChatGuru → Aguardando → Assinado → Pasta → Cliente ADVBOX → Processo ADVBOX' },
      { type: 'new', text: 'Visualizações do contrato pelo cliente (👁 3x · data/hora)' },
      { type: 'new', text: 'Botão 💬 WhatsApp ao lado de cada contratante para abrir ChatGuru' },
      { type: 'new', text: 'Modo Foco — esconder preview e expandir formulário em tela cheia' },
      { type: 'new', text: 'Anomaly Detection no Dashboard — detecta quedas, picos e novos resorts' },
      { type: 'new', text: 'Correlação tempo de resposta vs taxa de assinatura' },
      { type: 'new', text: 'Barras de progresso por seção no formulário (Contratantes, Resort, Honorários, Cláusulas, Internos)' },
      { type: 'new', text: 'Campo Data de Nascimento obrigatório — registra no ADVBOX' },
      { type: 'new', text: 'Prioridade de idoso — se 60+ anos, alerta automático no ADVBOX' },
      { type: 'new', text: 'DOCX da procuração e contrato salvos no Google Drive junto com PDFs' },
      { type: 'new', text: 'Descrição da cobrança no Asaas: "Honorários iniciais referentes ao processo de distrato contra [Resort]"' },
      { type: 'new', text: 'Resort como primeira linha nas anotações gerais do ADVBOX' },
      { type: 'improve', text: 'Tema sempre claro no Windows — removido dark mode completamente' },
      { type: 'improve', text: 'Aba Contratos Salvos com fundo branco, cards com sombra e melhor legibilidade' },
      { type: 'improve', text: 'Polling centralizado no App.jsx — automações rodam independente da aba' },
      { type: 'improve', text: 'Lock atômico para ADVBOX e Drive — sem duplicatas entre abas/ciclos' },
      { type: 'improve', text: 'Recovery automático de processos travados em "processing" (>5 min)' },
      { type: 'improve', text: 'Mensagens ChatGuru enviadas imediatamente no fuso de São Paulo' },
      { type: 'improve', text: 'PDF: texto não cortado entre páginas (avoidPageBreaks restaurado)' },
      { type: 'improve', text: 'Contrato e procuração renderizados separadamente (nunca se misturam)' },
      { type: 'fix', text: 'ADVBOX: colunas advbox_date e advbox_data criadas (causa real do "processing" eterno)' },
      { type: 'fix', text: 'ADVBOX: filtro NULL corrigido (.or() em vez de .in())' },
      { type: 'fix', text: 'Drive: lock atômico com .is(null) previne uploads duplicados' },
      { type: 'fix', text: 'ZapSign: tipo "completo" corrigido (era "full" — causava PDF undefined)' },
      { type: 'fix', text: 'ChatGuru: fuso horário corrigido para America/Sao_Paulo' },
      { type: 'fix', text: 'Mensagens ChatGuru não duplicam mais (verificação de save + lock)' },
      { type: 'fix', text: 'Complemento limpo ao preencher dados de cliente anterior' },
    ],
  },
  {
    version: '3.0.0',
    date: '30/03/2026',
    title: 'Asaas, Google Drive, Visual Law e Escalabilidade',
    changes: [
      { type: 'new', text: 'Painel Asaas — lançamento de cobranças de honorários com Boleto e PIX' },
      { type: 'new', text: 'Nota fiscal automática emitida somente após pagamento de cada parcela' },
      { type: 'new', text: 'Cobrança avulsa — criar boleto com valor e descrição personalizada' },
      { type: 'new', text: 'Comentários internos por contrato — equipe pode adicionar notas' },
      { type: 'new', text: 'Contrato e procuração salvos automaticamente no Google Drive após assinatura' },
      { type: 'new', text: 'PDFs separados: CONTRATO DE HONORÁRIOS ASSINADO + PROCURAÇÃO ASSINADA' },
      { type: 'new', text: 'Relatório de assinatura ZapSign incluído em ambos os PDFs' },
      { type: 'new', text: 'Botão Baixar ao lado de ASSINADO — baixa contrato e procuração separados' },
      { type: 'new', text: 'Template Visual Law — cabeçalho CBC, RESUMO, tabelas INCLUÍDO/NÃO INCLUÍDO' },
      { type: 'new', text: 'Caixa EM PALAVRAS SIMPLES na cláusula de objeto' },
      { type: 'new', text: 'Tabela HONORÁRIO FIXO / ÊXITO com callout verde na cláusula 3' },
      { type: 'new', text: 'Busca automática por nome — dropdown com clientes anteriores (3+ letras)' },
      { type: 'new', text: 'Busca por CPF preenche TODOS os 16 campos do contratante' },
      { type: 'new', text: 'Botão Limpar Formulário no topo com confirmação dupla' },
      { type: 'new', text: 'Campo Link Google Drive obrigatório' },
      { type: 'new', text: 'Campo Escritório arca com custas — remove cláusula 5 do contrato' },
      { type: 'new', text: 'Painel de erros detalhado com campos vermelhos e scroll automático' },
      { type: 'new', text: 'Hora de criação visível na aba de contratos salvos' },
      { type: 'new', text: 'Status individual de assinatura por contratante (Pendente/Assinado)' },
      { type: 'new', text: 'Clicar no contratante pendente copia link de assinatura' },
      { type: 'new', text: 'Lista de resorts sincronizada via Supabase (Contratos + Prestação de Contas)' },
      { type: 'improve', text: 'Procuração sempre em página separada (renderização independente)' },
      { type: 'improve', text: 'Texto do contrato: ação judicial em face de [Resort] (tipo ação só interno)' },
      { type: 'improve', text: 'Procuração: rescisão contratual para tudo exceto Cobrança e Dano Moral' },
      { type: 'improve', text: 'Mês do 1° vencimento por extenso no contrato' },
      { type: 'improve', text: 'Removida assistência judiciária gratuita e herdeiros/sucessores' },
      { type: 'improve', text: 'Nome da firma atualizado: CONFORTO, BERGONSI & CAVALARI' },
      { type: 'improve', text: 'ADVBOX: percentual de honorários, data cadastro = 1ª mensagem' },
      { type: 'improve', text: 'ADVBOX: observações internas enviadas para Anotações Gerais' },
      { type: 'improve', text: 'ADVBOX: sem duplicidade — lock atômico com advbox_status' },
      { type: 'improve', text: 'Contratos assinados protegidos contra exclusão (confirmação dupla)' },
      { type: 'improve', text: 'Salvar + ZapSign = mesmo registro (sem duplicar contrato)' },
      { type: 'improve', text: 'Aba Contratos com fundo branco para Windows' },
      { type: 'improve', text: 'Honorários exibidos corretamente: Sem êxito / Sem iniciais' },
      { type: 'fix', text: 'Intervalo de sync ZapSign corrigido (não multiplica mais)' },
      { type: 'fix', text: 'localStorage isolado por usuário (sem conflito entre abas)' },
      { type: 'fix', text: 'Canais Realtime com nomes únicos (sem conflito entre usuários)' },
      { type: 'fix', text: 'Debounce no botão Salvar (sem duplicar cliques rápidos)' },
      { type: 'fix', text: 'Página em branco no final do PDF eliminada' },
    ],
  },
  {
    version: '2.0.0',
    date: '25/03/2026',
    title: 'Interface Premium e Verificacoes Inteligentes',
    changes: [
      { type: 'new', text: 'Logo real do escritorio CBC no header, login e favicon do navegador' },
      { type: 'new', text: 'Sino de notificacoes com badge — veja alertas em tempo real' },
      { type: 'new', text: 'Confetti "PRA CIMA CBC!" com animacao ao assinar contrato' },
      { type: 'new', text: 'Deteccao automatica de genero pelo nome — ajusta nacionalidade, estado civil e sexo' },
      { type: 'new', text: 'Verificacao de email ativo (MX) antes do envio para ZapSign' },
      { type: 'new', text: 'Verificacao de CEP vs cidade — alerta se nao correspondem' },
      { type: 'new', text: 'Revisao final obrigatoria — checkbox "Confirmo que revisei" antes de enviar' },
      { type: 'new', text: 'Checklist pre-envio visual — cada campo verificado com icone verde/vermelho' },
      { type: 'new', text: 'Numeracao automatica de clausulas (Clausula 1a, 2a...) ajusta ao reordenar' },
      { type: 'new', text: 'Skeleton loading animado no dashboard enquanto carrega' },
      { type: 'new', text: 'Exportar contrato como DOCX (Word) editavel' },
      { type: 'new', text: 'Detector de contratos duplicados por CPF + Resort' },
      { type: 'new', text: 'Previsao de tempo ate assinatura baseada no historico' },
      { type: 'new', text: 'Endpoint JSON para Power BI com dados calculados' },
      { type: 'new', text: 'API REST publica para integracao com outros sistemas' },
      { type: 'new', text: 'Relatorio de eficiencia operacional por advogado' },
      { type: 'new', text: 'Deteccao de acesso suspeito por IP diferente' },
      { type: 'new', text: 'Conjuge registrado em anotacoes gerais no ADVBOX' },
      { type: 'improve', text: 'Icones tematicos nas secoes do formulario (contratantes, resort, honorarios, clausulas)' },
      { type: 'improve', text: 'Separador visual entre Contratante 1 e 2' },
      { type: 'improve', text: 'Animacoes de transicao suave em accordion, dark mode e modais' },
      { type: 'improve', text: 'Focus ring azul para navegacao por teclado (acessibilidade)' },
      { type: 'improve', text: 'Contraste melhorado em textos cinza (WCAG AA)' },
      { type: 'improve', text: 'Touch targets minimos de 44x44px no mobile' },
      { type: 'improve', text: 'Dark mode com transicao suave e borda no PDF' },
      { type: 'improve', text: 'Tela de login: animacao de entrada, "Esqueci a senha", "Lembrar de mim"' },
      { type: 'improve', text: 'ADVBOX: nunca deleta cliente existente — apenas reutiliza' },
      { type: 'improve', text: 'Honorarios no ADVBOX agora em campo correto (fees_money + contingency)' },
    ],
  },
  {
    version: '1.8.0',
    date: '25/03/2026',
    title: 'Formulario Avancado e ZapSign Pro',
    changes: [
      { type: 'new', text: 'Mascara automatica de telefone (00) 00000-0000' },
      { type: 'new', text: 'Campo de numero do endereco separado da rua' },
      { type: 'new', text: 'Botoes "Copiar endereco" e "Copiar telefone + chatguru" para contratante 2' },
      { type: 'new', text: 'Campo obrigatorio de celular do cliente' },
      { type: 'new', text: 'Campo obrigatorio de link do Chatguru' },
      { type: 'new', text: 'Cancelar documento no ZapSign antes da assinatura' },
      { type: 'new', text: 'Reenviar lembrete de assinatura via ZapSign' },
      { type: 'new', text: 'Download do PDF assinado do ZapSign' },
      { type: 'improve', text: 'Honorarios enviados ao ADVBOX como valor esperado do processo' },
      { type: 'improve', text: 'Advogado responsavel vinculado automaticamente ao processo no ADVBOX' },
      { type: 'improve', text: 'Observacoes internas enviadas como notas do processo no ADVBOX' },
      { type: 'improve', text: 'Endereco com numero separado no ADVBOX' },
      { type: 'improve', text: 'PDF do contrato 40% menor (compressao otimizada)' },
      { type: 'improve', text: 'Cliente existente no ADVBOX e atualizado com dados mais recentes' },
      { type: 'fix', text: 'Corrigido erro "column advbox_status does not exist" na aba de contratos' },
    ],
  },
  {
    version: '1.7.0',
    date: '25/03/2026',
    title: 'Jornada de Compra e Dados Internos',
    changes: [
      { type: 'new', text: 'Metrica de jornada de compra — dias entre 1a mensagem e assinatura' },
      { type: 'new', text: 'Media de jornada por resort com barras coloridas (verde/amarelo/vermelho)' },
      { type: 'new', text: 'Deteccao automatica de clausulas conflitantes no contrato' },
      { type: 'new', text: 'Mapa de calor geografico — de onde vem seus clientes por estado e cidade' },
      { type: 'new', text: 'Campo "Sexo" com ajuste automatico de nacionalidade' },
      { type: 'new', text: 'Campo "Data da primeira mensagem" para rastreamento de leads' },
      { type: 'new', text: 'Campo "Origem do cliente" para Power BI e ADVBOX' },
      { type: 'new', text: 'Historico de clientes — CPF ja cadastrado preenche tudo automaticamente' },
      { type: 'new', text: 'Campo de observacoes internas (nao aparece no contrato)' },
      { type: 'improve', text: 'Rate limiting e cache na API de CPF — evita desperdicio de creditos' },
    ],
  },
  {
    version: '1.6.0',
    date: '25/03/2026',
    title: 'ADVBOX, ZapSign e Novos Campos',
    changes: [
      { type: 'new', text: 'Integracao automatica com ADVBOX — cria cliente e processo ao assinar contrato' },
      { type: 'new', text: 'Botao "Enviar ADVBOX" nos contratos assinados para sincronizacao manual' },
      { type: 'new', text: 'Campo "Sexo" no formulario — ajusta nacionalidade automaticamente' },
      { type: 'new', text: 'Campo "Data da primeira mensagem" para rastreamento de leads' },
      { type: 'new', text: 'Campo "Origem do cliente" (Facebook, Google, Instagram, etc.) para Power BI' },
      { type: 'new', text: 'Proxy ZapSign via Netlify Functions — resolve erro "failed to fetch"' },
      { type: 'new', text: 'Proxy ADVBOX via Netlify Functions — contorna bloqueio Cloudflare' },
      { type: 'new', text: 'Historico de versoes com aviso de atualizacao para usuarios' },
      { type: 'improve', text: 'Data de assinatura registrada como "Data do fechamento" no ADVBOX' },
      { type: 'improve', text: 'Nome do cliente em MAIUSCULAS SEM ACENTUACAO no ADVBOX' },
      { type: 'improve', text: 'Profissao convertida para genero masculino no ADVBOX' },
      { type: 'improve', text: 'Cliente duplicado no ADVBOX e reutilizado (nao cria duplicata)' },
      { type: 'fix', text: 'Corrigido erro ao salvar contratos (colunas inexistentes removidas)' },
      { type: 'fix', text: 'Corrigido CORS no envio para ZapSign em producao' },
    ],
  },
  {
    version: '1.5.0',
    date: '25/03/2026',
    title: 'Inteligencia e Geografia',
    changes: [
      { type: 'new', text: 'Deteccao automatica de clausulas conflitantes no contrato' },
      { type: 'new', text: 'Mapa de calor geografico — veja de onde vem seus clientes por estado e cidade' },
      { type: 'new', text: 'Rate limiting e cache na API de CPF — evita desperdicio de creditos' },
      { type: 'new', text: 'Sistema de bloqueio de edicao concorrente entre advogados' },
      { type: 'new', text: 'Gerenciador de sessao unica por usuario' },
      { type: 'new', text: 'Log de acoes automatico (quem criou, editou, enviou cada contrato)' },
      { type: 'improve', text: 'Utilitarios de perfis de acesso (Admin/Advogado/Assistente)' },
    ],
  },
  {
    version: '1.4.0',
    date: '25/03/2026',
    title: 'Dashboard e Escalabilidade',
    changes: [
      { type: 'new', text: 'Ranking mensal de advogados no dashboard' },
      { type: 'new', text: 'Heatmap de horarios — descubra quando mais contratos sao criados' },
      { type: 'new', text: 'Contratos Assinados por Tipo de Honorario no dashboard' },
      { type: 'new', text: 'Top 5 empreendimentos do mes com mais assinaturas' },
      { type: 'improve', text: 'Paginacao otimizada na lista de contratos salvos' },
      { type: 'improve', text: 'Cache local com invalidacao para carregamento rapido' },
      { type: 'remove', text: 'Removido "Valor Total" dos cards do dashboard' },
    ],
  },
  {
    version: '1.3.0',
    date: '24/03/2026',
    title: 'Sem Backend — 100% Frontend',
    changes: [
      { type: 'new', text: 'Geracao de PDF direto no navegador (sem servidor)' },
      { type: 'new', text: 'Consulta de CPF direto pela API (sem intermediario)' },
      { type: 'new', text: 'OCR de CNH direto no navegador com Tesseract.js' },
      { type: 'new', text: 'Historico de clientes — CPF ja cadastrado preenche tudo automaticamente' },
      { type: 'new', text: 'Campo de observacoes internas (nao aparece no contrato)' },
      { type: 'new', text: 'QR Code para cliente preencher dados pelo celular' },
      { type: 'improve', text: 'Backend Render eliminado — zero custo de servidor' },
      { type: 'improve', text: 'Sistema 100% no Netlify + Supabase' },
    ],
  },
  {
    version: '1.2.0',
    date: '24/03/2026',
    title: 'ZapSign e Assinatura Digital',
    changes: [
      { type: 'new', text: 'Integracao com ZapSign para assinatura digital com validade juridica' },
      { type: 'new', text: 'Enviar contrato, procuracao ou ambos para assinatura' },
      { type: 'new', text: 'Links de assinatura com botao copiar na aba de contratos salvos' },
      { type: 'new', text: 'Sincronizacao automatica de status (assinado/pendente)' },
      { type: 'new', text: 'Barra de progresso: Rascunho → Salvo → Enviado → Assinado' },
      { type: 'new', text: 'Selecao multipla e exclusao em lote de contratos' },
      { type: 'improve', text: 'Token ZapSign salvo automaticamente (nao precisa digitar)' },
    ],
  },
  {
    version: '1.1.0',
    date: '24/03/2026',
    title: 'Formulario Completo e Preview em PDF',
    changes: [
      { type: 'new', text: 'Pre-visualizacao em PDF real ao lado do formulario' },
      { type: 'new', text: 'Modo somente exito (sem honorarios iniciais)' },
      { type: 'new', text: 'Modo somente honorarios iniciais (sem exito)' },
      { type: 'new', text: 'Scanner de CNH digital — preenche dados automaticamente' },
      { type: 'new', text: 'Busca automatica de endereco por CEP (ViaCEP)' },
      { type: 'new', text: 'Editor de clausulas com reordenacao por arrastar' },
      { type: 'new', text: 'Clausulas avulsas personalizadas' },
      { type: 'new', text: 'Procuracao Ad Judicia gerada separadamente' },
      { type: 'improve', text: 'Validacao em tempo real de todos os campos' },
      { type: 'improve', text: 'Mascaras automaticas para CPF, CEP e RG' },
    ],
  },
  {
    version: '1.0.0',
    date: '24/03/2026',
    title: 'Lancamento Inicial',
    changes: [
      { type: 'new', text: 'Gerador de contratos de honorarios advocaticios' },
      { type: 'new', text: 'Formulario com dados pessoais, resort, honorarios e clausulas' },
      { type: 'new', text: 'Selecao de 1 ou 2 contratantes' },
      { type: 'new', text: 'Selecao de resort e tipo de acao' },
      { type: 'new', text: 'Honorarios pre-definidos do escritorio' },
      { type: 'new', text: 'Todas as 13 clausulas padrao do escritorio' },
      { type: 'new', text: 'Tela de login com autenticacao Supabase' },
      { type: 'new', text: 'Dashboard com estatisticas e graficos' },
      { type: 'new', text: 'Aba de contratos salvos com busca e filtros' },
      { type: 'new', text: 'Atalhos de teclado (Ctrl+S, Ctrl+N, etc.)' },
      { type: 'new', text: 'Modo escuro' },
      { type: 'new', text: 'Responsivo para desktop e mobile' },
    ],
  },
];

const TYPE_STYLE = {
  new: { label: 'Novo', bg: '#ECFDF5', color: '#059669', icon: '+' },
  improve: { label: 'Melhoria', bg: '#EFF6FF', color: '#2563EB', icon: '↑' },
  fix: { label: 'Correcao', bg: '#FEF3C7', color: '#D97706', icon: '✓' },
  remove: { label: 'Removido', bg: '#FEF2F2', color: '#DC2626', icon: '−' },
};

/** Check if user has unseen version */
export function hasNewVersion() {
  try {
    const seen = localStorage.getItem(SEEN_VERSION_KEY);
    return seen !== VERSIONS[0]?.version;
  } catch { return false; }
}

/** Mark current version as seen */
export function markVersionSeen() {
  try { localStorage.setItem(SEEN_VERSION_KEY, VERSIONS[0]?.version); } catch { /* ignora */ }
}

/** Get count of changes in latest version */
export function getLatestChangesCount() {
  return VERSIONS[0]?.changes?.length || 0;
}

/** Banner component shown in the header when there's a new version */
export function NewVersionBanner({ onClick }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(hasNewVersion());
  }, []);

  if (!visible) return null;

  return (
    <button onClick={() => { onClick(); markVersionSeen(); setVisible(false); }}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer transition-all animate-pulse hover:animate-none"
      style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C95A)', color: '#1B3A5C' }}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <span className="text-[9px] font-black uppercase tracking-wide">
        Novo! v{VERSIONS[0]?.version}
      </span>
      <span className="text-[8px] font-bold opacity-70">
        ({getLatestChangesCount()} melhorias)
      </span>
    </button>
  );
}

export default function ChangeLog({ onClose }) {
  const [expanded, setExpanded] = useState(VERSIONS[0]?.version);

  // Mark as seen when opening
  useEffect(() => { markVersionSeen(); }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-glass" onClick={onClose}>
      <div className="modal-glass rounded-2xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold" style={{ color: '#1B3A5C' }}>Historico de Versoes</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">CBC Contratos — Todas as atualizacoes</p>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-lg">
              ×
            </button>
          </div>
        </div>

        {/* Versions list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {VERSIONS.map((v) => {
            const isExpanded = expanded === v.version;
            return (
              <div key={v.version} className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button
                  onClick={() => setExpanded(isExpanded ? null : v.version)}
                  className="w-full flex items-center gap-3 p-3 text-left cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-[11px] shrink-0"
                    style={{ background: '#1B3A5C' }}>
                    v{v.version.split('.')[0]}.{v.version.split('.')[1]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{v.title}</span>
                      {v === VERSIONS[0] && (
                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Atual</span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400">{v.date} — {v.changes.length} alteracoes</span>
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-1.5 border-t border-gray-100 dark:border-gray-700 pt-2">
                    {v.changes.map((c, i) => {
                      const style = TYPE_STYLE[c.type] || TYPE_STYLE.new;
                      return (
                        <div key={i} className="flex items-start gap-2 py-0.5">
                          <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                            style={{ background: style.bg, color: style.color }}>
                            {style.icon}
                          </span>
                          <span className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">{c.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 pt-2 border-t border-gray-100 dark:border-gray-700">
          <div className="text-center text-[9px] text-gray-400">
            Conforto, Bergonsi & Cavalari Advogados — Sistema de Contratos
          </div>
        </div>
      </div>
    </div>
  );
}

export { VERSIONS };
