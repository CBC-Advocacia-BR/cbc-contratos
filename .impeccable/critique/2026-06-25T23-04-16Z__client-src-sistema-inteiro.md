---
target: sistema por inteiro (UI/UX)
total_score: 23
p0_count: 3
p1_count: 13
timestamp: 2026-06-25T23-04-16Z
slug: client-src-sistema-inteiro
---
# Critique de sistema — CBC Contratos

**Design Health: 23/40** — 23/40 — Competente com divida sistemica. Engenharia solida e prevencao de erro acima da media, mas consistencia visual, correspondencia com o vocabulario do usuario e densidade/hierarquia puxam para baixo. Bem dentro da faixa tipica (20-32) de sistemas reais em producao; o teto de ~32 esta bloqueado por problemas que se repetem identicos em 6 superficies."

## Heuristicas (Nielsen)

| # | Heuristica | Score | Issue |
|---|---|---|---|
| 1 | Visibilidade do estado do sistema | 3/4 | Forte onde importa (timeline de automacoes em Contratos, farol do Monitor, 'Ao vivo' do Dashboard), mas a frescura do realtime nao alerta quando trava e MonitorAdvbox/painel de fila escondem empty-state com return null; em Vendas duplicateWarning/signatureEstimate sao calculados mas nunca renderizados. |
| 2 | Correspondencia com o mundo real | 2/4 | Vazamento de jargao tecnico para operadores (advbox_api_log, visto, origem, kommo_queue, cron_heartbeat, ingerido, dead-letter) sem tooltip/glossario; labels SEMPRE uppercase tracked soam gritadas; nomes internos de campo aparecem crus no Monitor e em erros de validacao do FormPanel. |
| 3 | Controle e liberdade do usuario | 2/4 | Modais empilhados em Vendas (ate 4 camadas z-index sem dismissal em cascata) prendem o usuario; ZapSignModal pode fechar mid-send e perder onSaveAfterSend; Esc nao tem hierarquia; falta undo no auto-fill de CEP. |
| 4 | Consistencia e padroes | 2/4 | Mesma info de status renderizada de formas divergentes (CommissionStatus compact vs verbose), cores hardcoded (#C9A84C, #264A72, #DC2626, #F97316) ao lado de tokens, easing custom em PortalClientePanel diferente do sistema, e o swap navy->dourado do dark mode sem classe semantica nem comentario. |
| 5 | Prevencao de erros | 3/4 | FormPanel e exemplar (regex Kommo, CNPJ, CEP-cidade, data futura, bloqueio de parcela passada, lock atomico no Asaas) mas inputs numericos de comissao aceitam lixo, retry do Drive permite duplo-submit sem confirmacao, e checkbox sem label associado em Vendas. |
| 6 | Reconhecimento em vez de memorizacao | 2/4 | 12 top tabs em lista plana sem agrupamento (Miller 2.4x), matriz Admin de 14 colunas, planilha Vendas de 19-20 colunas, grafico de 24h do Portal sem rotulos de eixo, kanban de 7 colunas mostrando <2 por tela; forca varredura e memoria espacial. |
| 7 | Flexibilidade e eficiencia de uso | 2/4 | Poder-usuario sem atalhos de teclado em listas, sem bulk-action real (checkboxes so de UI), sem 'selecionar todos', sem retry em lote do Drive; datalist de 99 resorts sem busca async; navegacao por teclado quebrada (toggle nao-button no BoletosPanel). |
| 8 | Estetica e design minimalista | 2/4 | Densidade vence hierarquia: micro-tipografia 9-11px como dado critico, side-tabs border-l-4/r-4 em paineis de app, gray-on-color lavando contraste, dourado da marca ausente do light mode (UI navy-monocromatica), parede-de-texto na preview de comissao. |
| 9 | Reconhecer, diagnosticar e recuperar de erros | 3/4 | Bom: retry com poller/timeout em Contratos, fallback 'unknown' do PreSendChecklist, toasts de Vendas; ruim: erro de OCR some em 4s sem retry persistente, copiar boleto sem feedback se onToast faltar, retry do Drive sem confirmacao/contador de tentativa, jsPDF pode falhar silenciosamente. |
| 10 | Ajuda e documentacao | 2/4 | Quase nenhum onboarding ou glossario inline para um sistema denso de dominio (Kommo, ADVBOX, Asaas, Exito, Faixa, Inadimplencia, NF); RelatorioBoletosModal abre vazio sem presets/exemplos; sem dica de que 'Mais' revela 9 abas; sem tooltips nos icones de status. |

## Veredito AI-slop
O detector (35 achados deterministicos) e o LLM convergem, mas a leitura honesta exige descontar os falsos-positivos intencionais. Dos 12 side-tabs, 9 estao no contractHtml.js — que e o DOCUMENTO LEGAL impresso, nao a UI do app — entao sao intencionais e devem ser ignorados; os 5 'overused-font' (Lato) e a maioria dos 8 'bounce-easing' (springs) tambem sao marca/intencao deliberada. O que sobra, e onde detector e LLM realmente concordam, sao TRES achados sistemicos reais: (1) o dourado da marca ausente do light mode — o @theme do Tailwind remapeia --color-gold para NAVY, entao bg-gold/text-gold renderizam navy e a UI light fica navy-monocromatica, contradizendo o par navy+dourado do PRODUCT.md; o dourado real so vive no dark mode. Isso nao e 'slop' gerado por LLM, e um bug de design system, mas e o defeito de marca mais grave. (2) os 3 side-tabs REAIS de app (FormPanel/ContratosTab/BoletosPanel/MonitorPanel) mais cores hardcoded fora de token, que quebram dark mode e adicionam peso visual sem ganho de informacao. (3) gray-on-color (8 ocorrencias) lavando contraste em Asaas/Boletos/FormPanel/Portal/Admin/MonitorAdvbox — esse e o achado mais acionavel e o que mais falha WCAG. Veredito de slop genuino (grid de cards-clones, eyebrows tracked, gradient-text, prosa de IA): BAIXO. Os assessments de Novo, Contratos e Portal-Admin sao explicitamente 'no slop' — codigo artesanal, comentado, especifico de dominio. Os focos parciais de slop sao localizados: hero-KPI + bounce no Dashboard, cards de promocao com gradiente em Vendas, e o navy-dark de baixo contraste do MonitorAdvbox. Resumo: nao e um sistema 'AI slop'; e um sistema artesanal com um buraco de design-token (dourado) e tres anti-padroes de contraste/peso que se repetem por falta de um componente de status/cor unico.

## Impressao geral
Este e um produto interno maduro, de engenharia genuinamente boa, sofrendo de entropia de design system — nao de preguica. As mesmas 4-5 falhas reaparecem identicas em superficie apos superficie porque nao ha uma camada compartilhada que as resolva de uma vez: cor (dourado morto no light mode + hex hardcoded fora de token), contraste (gray-on-color, white/40 sobre navy-dark), densidade (tabelas de 14-20 colunas, micro-tipografia 9-11px), e vocabulario (jargao tecnico cru + labels uppercase gritadas). A engenharia merece credito real — prevencao de erro no FormPanel, locks atomicos, retry com poller, realtime com fallback, lazy-load com prefetch — e por isso o sistema 'some na tarefa' para o power-user que ja decorou tudo. Mas o primeiro-uso, o operador nao-tecnico e o usuario com baixa visao batem nas mesmas paredes em todo lugar. A MAIOR OPORTUNIDADE UNICA: extrair UM componente de status/cor central (StatusPill/Tone) ancorado em tokens semanticos, religar o dourado da marca ao light mode (remover o override do @theme) e proibir hex hardcoded — isso fecha de uma so vez os P0 de contraste, o bug de marca e metade das inconsistencias, em todas as 6 superficies simultaneamente. Densidade e jargao sao o segundo round, mas a cor e o ponto de alavancagem onde um fix sistemico rende mais.

## O que funciona

- Prevencao de erro no ponto de entrada e classe alta: FormPanel encadeia regex Kommo, validacao de CNPJ, match CEP-cidade, guarda de data futura/idoso, deteccao de duplicata e lock atomico no Asaas — o principio 'prevenir erro na entrada' do PRODUCT.md esta vivo e funcionando.
- Estado das automacoes em 2o plano e legivel: a timeline PROGRESS_STEPS em Contratos e o farol unificado do Monitor tornam visiveis os 7 passos de automacao (ZapSign->Drive->ADVBOX->Kommo) — atende diretamente o principio 'estado sempre visivel'.
- Arquitetura de dados e performance disciplinadas: realtime com debounce + fallback poll, memoizacao (BoletoRow/ClientCard), selects JSON-path enxutos, lazy-load com prefetch no hover, scroll restoration por aba — raro nesse nivel num app interno.
- Tokens semanticos de status (success/danger/warning/info com bg/border ajustados para dark) ja existem e sao bons — a base para o fix sistemico de cor ja esta no index.css; o problema e que metade do codigo nao a usa.

## Priority issues (3 P0, 13 P1, 24 total)

### [P0] Dourado da marca ausente do light mode (@theme remapeia --color-gold para navy)
- **Onde:** Shell (index.css:15-31), Dashboard, Vendas, Portal/Login, transversal
- **Por que:** O PRODUCT.md especifica par navy+dourado complementar, mas o @theme do Tailwind sequestra bg-gold/text-gold para renderizar NAVY; o dourado real (#C9A84C) so aparece como accent no dark mode. Resultado: toda a UI light le navy-monocromatica, sem o sinal da marca, e botoes primarios viram navy-on-navy (ex: Export em Vendas fica invisivel). E o defeito de marca mais grave e a raiz de varias inconsistencias de cor.
- **Fix:** Remover o override @theme (linhas ~15-31). Usar --cbc-gold como accent funcional no light mode e --cbc-accent no dark via classes semanticas .text-accent/.bg-accent. Auditar underlines de aba, botoes de export e accents para usar o dourado no light.
- **Comando:** /impeccable colorize

### [P0] Gray-on-color: texto/icone cinza sobre fundo colorido falha WCAG AA em multiplas superficies
- **Onde:** Asaas/Boletos (status, totais orange-600/green-600), FormPanel, PortalClientePanel (opacity-60), AdminPanel (purple-700 sobre purple-100), MonitorAdvbox (white/40 sobre navy-dark #0F2035)
- **Por que:** 8 ocorrencias no detector + achados do LLM. Razoes de contraste ~2-3:1 (minimo AA 4.5:1). Em MonitorAdvbox o console de logs fica ilegivel (~2.1:1); em Boletos o cinza sobre fundo de status some; Sam (a11y) e qualquer tela com 50% de brilho nao distinguem pendente de concluido. Em painel de cobranca/log isso e perda de informacao, nao so estetica.
- **Fix:** Regra unica: fundo claro -> fg navy; fundo escuro -> fg branco; nunca cinza sobre cor. Trocar Tailwind hardcoded (text-orange-600/green-600/purple-700) e white/40-60 por tokens --cbc-* a 100% de opacidade. Adicionar checagem de contraste >=4.5:1 no StatusPill. Testar em dark e a 50% de brilho.
- **Comando:** /impeccable colorize

### [P0] Navegacao plana de 12 top tabs / matrizes e nesting que estouram a memoria de trabalho
- **Onde:** Shell (App.jsx 12 tabs sem agrupamento), AdminPanel (matriz 14 colunas, min-w-900px), BotAdvboxPanel (9 sub-abas + 4 dimensoes de filtro no Monitor), Vendas (planilha 19-20 colunas, kanban 7 colunas)
- **Por que:** Miller 4+-1 violado em escala (12 tabs = 2.4x; matriz 14 col; planilha 20 col forca scroll horizontal infinito). Power-user decora ao longo de semanas (Alex ok), mas Jordan ve lista indiferenciada e o operador nao-tecnico nao prioriza. Mobile sofre scroll de 2.4x viewport sem indicador.
- **Fix:** Top tabs: agrupar em Core/Financeiro/Gestao/Integracao com separadores ou dropdown. Admin: card-por-usuario com 3-4 tabs-chave + 'Mais', com Grant/Revoke em lote. Bot: agrupar 9 abas em <=4 secoes. Planilha/kanban: sticky-col + smart column hiding por breakpoint, view de lista <1024px.
- **Comando:** /impeccable help

### [P1] Cores hardcoded fora do token quebram dark mode e a manutencao da marca
- **Onde:** Dashboard (#C9A84C, #264A72, RANK_COLORS), Boletos (#DC2626/#F97316/#EAB308/#16A34A nas bordas de urgencia), MonitorAdvbox (NIVEL_UI/STATUS_UI rgb), Portal (#C9A84C, #8a6f2d), Vendas (COLORS.gold misturado com bg-gold)
- **Por que:** Hex literal ignora o sistema de tokens e nao tem override de dark mode — laranja/amarelo de urgencia ficam ilegiveis no fundo escuro; se a marca atualizar o dourado, esses pontos nao acompanham. Contradiz 'marca como sinal, nao decoracao'.
- **Fix:** Substituir todo hex por var(--cbc-*). Mapear urgencia para --cbc-danger/warning/success com override dark. Definir RANK_COLORS via tokens. Auditar bg-*/text-* em Vendas para nao usar 'bg-gold' (que renderiza navy).
- **Comando:** /impeccable colorize

### [P1] Side-tab border-l-4/r-4 em paineis de APP (distinto do contractHtml legal, que e intencional)
- **Onde:** FormPanel, ContratosTab (dense-card/ContratoRow), BoletosPanel (BoletoRow), MonitorPanel
- **Por que:** Os 9 side-tabs do contractHtml.js sao o documento legal impresso = intencionais e fora de escopo. Mas os ~3 em paineis de app adicionam peso visual inconsistente com o registro minimalista navy-monocromo; o usuario varre o conteudo da linha, nao a faixa.
- **Fix:** Remover border-l-4/r-4 dos rows de app. Substituir por: borda de 2px so na linha selecionada (navy), ou ponto-accent de 1px, ou shadow+lift no hover. Onde a borda sinaliza urgencia (Boletos), mover o sinal para o StatusPill com cor tokenizada.
- **Comando:** /impeccable distill

### [P1] Easing com bounce (--cbc-spring) aplicado a fluxos serios (pagamento, modais, status)
- **Onde:** Shell (index.css:284), Dashboard (anim-slide-up/modal-in), Boletos (token global habilita uso indevido), MonitorAdvbox (JobCard/animate-pulse)
- **Por que:** PRODUCT.md exige 'sem bounce, 150-250ms'. cubic-bezier(.34,1.56,.64,1) gera overshoot em modais/sheets/status sem proposito funcional. Springs de celebracao sao marca intencional; o problema e o spring vazando para transacao/cobranca/status, onde o tom deve ser sobrio.
- **Fix:** Manter spring apenas em celebracao/onboarding. Para modais, status e transacao usar --cbc-ease-out cubic-bezier(.16,1,.3,1) a 200-240ms. Comentar no token: 'NAO usar em fluxos de pagamento/status'. Diferenciar pulse de 'aviso' (lento) vs 'problema' (rapido) no farol.
- **Comando:** /impeccable animate

### [P1] Jargao tecnico cru exposto a operadores nao-tecnicos sem tooltip ou glossario
- **Onde:** MonitorAdvbox/MonitorPanel/BotPendencias (advbox_api_log, visto, origem, kommo_queue, cron_heartbeat, ingerido, dead-letter, snapshots BI), FormPanel (toast 'avisar o Bruno', erros sem contexto PJ), Contratos (advbox_cliente/kommo nas bolinhas), Vendas/Portal (Exito, Faixa, correlacao)
- **Por que:** Secretarias/vendedores/clientes nao sao engenheiros; o principio 'a ferramenta some na tarefa' quebra quando nomes internos de campo e termos de log aparecem na UI. Erros de validacao do FormPanel nao dizem se o campo e da Empresa ou do Representante (21 X vermelhos sem contexto).
- **Fix:** Renomear para rotulos de negocio (kommo_queue->Fila de integracoes, visto->Lido, origem->Fonte, monitor_status->Sincronizacao ADVBOX). Prefixar erros com 'Contratante 1 - Empresa/Representante'. Adicionar tooltips/glossario nos termos de dominio e nas bolinhas da timeline.
- **Comando:** /impeccable clarify

### [P1] Labels SEMPRE uppercase tracked reduzem legibilidade e endurecem o tom
- **Onde:** Shell (.label-field), FormPanel, AdminPanel, Vendas, ClientFormQR (formulario publico), Contratos (archive modal)
- **Por que:** Todos os labels de formulario uppercase com tracking aumentam o tempo de parsing (~30-50ms por label) e soam 'gritados' para o primeiro-uso e para o cliente final no formulario publico; WCAG recomenda sentence case para acessibilidade cognitiva. Conflita com 'a ferramenta some na tarefa'.
- **Fix:** Mudar .label-field de uppercase para sentence case, reduzir tracking-wide para ~0.25px. Em ClientFormQR garantir que o texto-fonte seja minusculo para o CSS nao gerar 'NOME COMPLETO *' tortuoso. Manter eventual uppercase so em card-header.
- **Comando:** /impeccable typography

### [P1] Micro-tipografia (9-11px) usada como DADO critico, nao como meta-rotulo
- **Onde:** Boletos/Asaas (linhas 9-10px, totais), Vendas (planilha 9-11px, preview de comissao), Contratos (status do signatario 9-10px, contador de paginacao 10px), FormPanel/PreSendChecklist (9px em 'email para ZapSign')
- **Por que:** Sem escala tipografica consistente, dado importante (status de pagamento, email de assinatura, valor) cai em 9px enquanto rotulo secundario fica do mesmo tamanho. A arm's length / mobile exige zoom 200%. Viola 'hierarquia antes de densidade'.
- **Fix:** Definir escala (--text-xs 10, --text-sm 11, --text-base 13, --text-lg 14). Dado primario >=12-13px; rotulo 10-11px com contraste. Subir piso mobile de 9->11px. Aplicar em FormPanel, Boletos, Vendas, Contratos.
- **Comando:** /impeccable typography

### [P1] Modais empilhados sem hierarquia de dismissal
- **Onde:** Vendas (drawer -> GuiaForm -> ConfirmDestructive, ate 4 camadas z-index), ZapSignModal (fecha mid-send), AdminPanel (form em <tr colSpan> dentro de tbody)
- **Por que:** Em Vendas o usuario empilha drawer+form+confirm sem dismissal em cascata; fechar o confirm nao volta claramente ao drawer e Esc nao tem ordem. ZapSignModal permite fechar antes do onSaveAfterSend (desync de estado). No Admin o form aninhado na tabela faz o leitor de tela anunciar campos como celulas.
- **Fix:** Hierarquia de modal: filho desmonta so a si; confirm dentro de drawer volta ao drawer; Esc fecha o topo, nao todos. ZapSign: disabled no close enquanto result/loading ou persistir URLs em cache. Admin: tirar o form da tabela (card/details/modal).
- **Comando:** /impeccable harden

### [P1] Estado calculado mas nunca renderizado (feedback fantasma)
- **Onde:** FormPanel/Novo (duplicateWarning e signatureEstimate setados, nunca exibidos), MonitorAdvbox (CronHeartbeats/HealthSummary/KommoQueue retornam null vazios), PortalClientePanel/MetricasPortal (null no loading)
- **Por que:** checkDuplicate dispara e seta o aviso de CPF+resort duplicado, mas nada no render o mostra — o usuario nunca ve a deteccao de duplicata (regra de negocio #6). Secoes do Monitor somem em silencio quando vazias, sem distinguir 'carregou e esta vazio' de 'falhou'.
- **Fix:** Renderizar duplicateWarning (modal/toast 'CPF ja tem contrato com [resort] [Ver][Continuar]') e signatureEstimate. Secoes do Monitor: header sempre visivel com spinner/checkmark/erro em vez de return null.
- **Comando:** /impeccable harden

### [P1] Empty-states e onboarding fracos num sistema denso de dominio
- **Onde:** RelatorioBoletosModal (abre vazio sem presets), Dashboard (EmptyScope possivelmente com jargao), Vendas (sem glossario), Shell (sem dica de que 'Mais' revela 9 abas), Contratos (timeline com jargao sem tooltip)
- **Por que:** Help/docs e a heuristica mais fraca do sistema. Primeiro-uso (Jordan) e operador novo nao tem ponto de entrada: RelatorioBoletos sem presets 'Este mes/90 dias/Tudo', sem explicacao de filtros; sem tooltips nos termos. Em no-results so 'Nenhum encontrado' sem sugestao de ampliar.
- **Fix:** Adicionar presets de periodo e ajuda contextual no RelatorioBoletos; copy de empty-state em portugues claro com sugestao de proxima acao; tooltips/glossario nos termos de dominio; dica de onboarding para o botao 'Mais'.
- **Comando:** /impeccable help

### [P1] Touch targets e drag/hover sem fallback robusto em mobile
- **Onde:** Boletos (chevron ~12px), Vendas (checkbox ~20px, .cbc-touch-only inexistente no CSS quebra mover-card), Contratos (sync icon ~24px), Dashboard (barras de KPI clicaveis sem zona segura), Shell (dock 'Mais' so icone)
- **Por que:** Apple HIG pede 44px; chevrons/checkboxes abaixo disso. O hack .cbc-touch-only (assumido, nao presente no CSS) pode esconder o select de mover card em edge browsers, deixando o usuario sem como mover leads no kanban. Casey/Riley batem aqui.
- **Fix:** Subir alvos para 44px. Remover o hack .cbc-touch-only; em mobile mostrar select sempre. Envolver checkbox em <label> com for/id. Dar texto 'MAIS' visivel no dock. Garantir foco/teclado nos toggles (onKeyDown Enter/Space).
- **Comando:** /impeccable mobile

### [P2] Navegacao por teclado e foco invisivel/ausente
- **Onde:** Shell (tabs so com underline dourado), Contratos (focus:outline-none nos botoes, tooltip so no hover), Boletos (toggle nao-button sem onKeyDown), Vendas (sem focus trap nos modais)
- **Por que:** Power-user com teclado e Sam (a11y) ficam sem indicador de foco visivel e sem acesso a tooltips/toggles via teclado; WCAG 2.1 1.4.13 (tooltip acessivel) e foco visivel falham. Modais sem focus trap deixam o foco escapar.
- **Fix:** focus-visible:ring-2 ring-navy/40 (ou dourado no light) em tabs/botoes/selects; converter toggles em <button> com onKeyDown; tooltip tambem no focus-within; focus trap nos drawers/modais.
- **Comando:** /impeccable a11y

### [P2] GlobalSearch e modais com offset/posicionamento hardcoded
- **Onde:** Shell (GlobalSearch pt-[15vh] cria whitespace no desktop e colisao iOS), Dashboard (tooltip de MonthlySeries clipa na borda do viewport), ShortcutsGuide (header navy hardcoded ignora dark)
- **Por que:** Offset fixo de 15vh empurra a busca 288px no desktop e ignora --safe-top; tooltip sem guarda de borda corta no mobile; header de atalhos com #1B3A5C inline nao respeita --cbc-header-bg no dark.
- **Fix:** Busca: justify-center no desktop, pt-[max(var(--safe-top),12px)] no mobile. Tooltip: clamp(8px, x, 100vw-200px) ou portal. ShortcutsGuide: usar var(--cbc-header-bg).
- **Comando:** /impeccable layout

### [P2] Honorarios e filtros com modos mutuamente exclusivos sem affordance clara
- **Onde:** FormPanel (3 modos de honorario via checkbox+campos cinza em vez de radio), Boletos (5 filtros ortogonais interdependentes), RelatorioBoletos (base so visivel se tipo=detalhado)
- **Por que:** Checkbox + campos acinzentados forcam o usuario a inferir 'o que desbloqueia o que'; erro 'Percentual de Exito' sem contexto de modo. 5 filtros que se cancelam (status=pending + dueFrom futuro = 0 resultados) confundem intencao.
- **Fix:** Honorarios como radio-group (Fixo+Exito | So Inicial | So Exito) revelando campos inline; erros com contexto de modo. Filtros: divulgacao progressiva ('Filtros avancados') e preview live de contagem.
- **Comando:** /impeccable clarify

### [P2] Componentes de status duplicados e StatusPill size='sm' ilegivel
- **Onde:** Vendas (CommissionStatus compact vs verbose divergentes), Contratos (StatusPill size sm nao verificado), Boletos/Asaas (size sm = 7-10px em linhas densas)
- **Por que:** Mesma informacao com duas assinaturas visuais parece dado diferente; size='sm' a 10px bold falha legibilidade e pode falhar AA. Reforca a inconsistencia geral de status.
- **Fix:** Um unico componente de status com prop size (compact|verbose) e texto identico; size sm >=11px com fg branco/navy nunca cinza; aria-label com o significado da cor.
- **Comando:** /impeccable consistency

### [P2] Auto-fill de CEP/OCR sem feedback de override nem recuperacao
- **Onde:** FormPanel (CEP respeita edicao manual mas sem avisar; OCR-erro some em 4s sem retry)
- **Por que:** manualEditsRef pula campos editados, mas o usuario nao sabe; se o lookup acerta e a edicao erra, nao ha caminho de recuperacao. Erro de OCR vanish em 4s faz o usuario achar que funcionou com form em branco.
- **Fix:** Info-icon 'preenche Endereco/Bairro/Cidade/UF (edite para sobrepor)' com [Aplicar]/[Ignorar]; erro de OCR persistente com retry + aria-live.
- **Comando:** /impeccable harden

### [P2] Acoes de retry/copia sem confirmacao ou feedback de sucesso
- **Onde:** Monitor (retry Drive sem confirmacao/contador, permite duplo-submit), Boletos (copiar linha digitavel sem toast se onToast faltar), PreSendChecklist (MX via Google DNS sem aviso de privacidade)
- **Por que:** Operador clica retry varias vezes sem saber se enviou; copia sem feedback parece quebrado; chamada externa de DNS sem disclosure (LGPD).
- **Fix:** Retry: toast 'novo upload iniciado', desabilitar 2-3s, mostrar tentativa N/3. Copiar: onToast com fallback + timeout. MX: tooltip 'verifica dominio via DNS publico, sem armazenar'.
- **Comando:** /impeccable harden

### [P2] Banner/contexto de modo Admin inconsistente entre paineis
- **Onde:** Vendas (banner gradient gold 'Modo Admin') vs VendasParametrizacao (sem equivalente), Shell (swap navy->dourado no dark sem classe semantica)
- **Por que:** Admin transita entre paineis e perde o sinal de 'estou em modo admin'; o swap de accent no dark mode nao tem classe nem comentario que explique a intencao, ferindo consistencia.
- **Fix:** Prefixo [ADMIN] no titulo da Parametrizacao ou header navy-dark para 'restrito'; criar .text-accent/.bg-accent documentando o swap navy/dourado.
- **Comando:** /impeccable consistency

### [P2] Z-index do dock pode colidir com modais e overflow em mobile
- **Onde:** Shell (dock z-45 vs modal z-50 footer), MobileNavSheet (grid 3-col trunca 'Parametrizacao Vendas'), ViewsManager (dropdown w-72 pode sair da tela em 375px)
- **Por que:** Com PreSendChecklist aberto, a superficie do dock pode sobrepor os botoes do rodape do modal; labels longos truncam em 100px; dropdown absolute right-0 arrisca off-screen.
- **Fix:** pointer-events:none no dock quando anyModalOpen; grid 2-col <480px com MOBILE_TAB_LABELS abreviados; max-w-[min(18rem,calc(100vw-2rem))] no dropdown.
- **Comando:** /impeccable mobile

### [P3] Typos e acentos faltando em texto de UI
- **Onde:** Contratos ('Nao foi possivel'), ClientFormQR/Login ('Profissao','Uniao Estavel','usuarios','empresario'), Vendas ('Primeira Contato')
- **Por que:** PRODUCT.md enfatiza 'preciso'; acentos faltando em texto voltado ao cliente (formulario publico e login) minam a confianca para falantes PT-BR.
- **Fix:** Auditar strings voltadas ao usuario com linter PT-BR; corrigir acentos em labels, options e mensagens; rodar spell-check.
- **Comando:** /impeccable clarify

### [P3] Sinalizacao so-por-cor sem texto/forma (color-blind)
- **Onde:** Dashboard (delta pill com so seta), FormPanel (barra de progresso amber/green), Vendas (icones de status de doc sem legenda), Contratos (dots de signatario)
- **Por que:** Delta com so '▲/▼' e progresso so por cor falham para daltonicos; icones de status de documento sem legenda exigem adivinhacao.
- **Fix:** Delta como '+5%/-5%' com aria-label; progresso com glifo (✓/–/○) alem de cor; title/aria-label em cada icone de status; legenda nos cards.
- **Comando:** /impeccable a11y

### [P3] Inputs numericos sem sanitizacao/unidade e accordion sem persistencia
- **Onde:** VendasParametrizacao (preview de comissao aceita 'abc', sem min/max; 'Tempo ate sentenca' sem unidade visivel), FormPanel (estado de accordion perdido ao trocar de aba)
- **Por que:** Garbage-in no preview de calculo; falta de unidade confunde (meses? dias?); layout do form se perde em navegacao/refresh.
- **Fix:** min/max + Math.max(0,parseInt) nos numericos; decorator de unidade ('meses') ao lado do input; persistir estado de accordion em context/localStorage por contrato.
- **Comando:** /impeccable harden

## Persona red flags

**Alex (power-user / velocidade+densidade)**: Em grande parte bem servido — 12 tabs viram mnemonicas, prefetch acelera, Cmd+K/atalhos cobrem navegacao. Mas trava em produtividade real: zero atalhos de teclado em listas (sem Ctrl+A, sem bulk-action que execute — checkboxes de Vendas sao so UI), sem 'selecionar todos' persistente na paginacao, sem retry em lote do Drive (so 1-a-1), sem deeplink/share de form, datalist de 99 resorts sem busca async. Quer onboardar usuarios no Admin mas leva 14 cliques por usuario sem Grant/Revoke em lote.

**Sam (acessibilidade / contraste e leitor de tela)**: Persona mais penalizada. Gray-on-color falha AA em Asaas/Boletos/Admin/Portal/MonitorAdvbox (2-3:1); white/40 sobre navy-dark torna o console de logs ilegivel; foco invisivel (focus:outline-none, so underline dourado); tooltips so no hover (1.4.13); icones-so sem aria-label (sync, status de doc); form do Admin aninhado em <tr> anuncia campos como celulas; labels uppercase prejudicam acessibilidade cognitiva; modais sem focus trap; delta/progresso so-por-cor.

**Casey (mobile / thumb-zone)**: Alvos abaixo de 44px (chevron 12px em Boletos, checkbox 20px em Vendas, sync 24px em Contratos); scroll horizontal sem indicador em tabelas de 11-20 colunas (Asaas 930px, planilha Vendas, Admin 900px); kanban de 7 colunas mostra 1 por vez; MobileNavSheet trunca labels; dropdown de Views pode sair da tela; busca global deixa whitespace e arrisca colisao com teclado iOS; pull-to-refresh sem haptico.

**Riley (edge-cases / empty-states)**: Empty-states silenciosos: secoes do Monitor (Cron/Health/KommoQueue) somem com return null sem distinguir vazio de falha; RelatorioBoletos abre vazio sem presets e em no-results so 'Nenhum encontrado'; o hack .cbc-touch-only (ausente no CSS) pode impedir mover card no kanban em edge browsers; JSON de contexto trunca em max-h-60 sem indicador; transicao iPad landscape<->portrait mostra dock e top-tabs juntos; MX check falha em silencio em redes restritas.

**Jordan (primeiro uso / jargao)**: Sem onboarding em sistema denso. Bate em jargao por toda parte sem tooltip (Kommo, ADVBOX, Asaas, Exito, Faixa, Inadimplencia, NF, advbox_cliente, ingerido, dead-letter); toast 'avisar o Bruno' (quem?); 21 X vermelhos de validacao PJ sem dizer se e Empresa ou Representante; preview de comissao em parede de texto; labels uppercase soam hostis; nao sabe que 'Mais' revela 9 abas; form de 1850px sem 'comece aqui'.

**Sonia (secretaria, preenche formularios o dia todo)**: O FormPanel a protege bem de erros (mascaras, validacao, OCR, CEP) — mas o dia-a-dia repetitivo a castiga: labels SEMPRE uppercase gritando em cada campo aumentam fadiga de leitura; contratante e um mega-bloco de 18-27 campos sem agrupamento visual; o toggle PJ adiciona 27 campos sem badge de progresso nem auto-scroll; erro de OCR some em 4s deixando-a achar que preencheu; deteccao de duplicata roda mas nunca aparece, entao ela so descobre o retrabalho depois; micro-tipografia de 9px em dado critico ('email para ZapSign') a forca a apertar os olhos a cada envio.

**Dr. Paulo (socio, quer saude da carteira em segundos)**: O Dashboard 2.0 e bom para ele (KPIs sensiveis ao periodo, comparador de meses, funil), mas o scan-em-segundos e diluido: hero-KPI + grid de 2-6 colunas com labels em jargao (taxa_conversao, pendente_advbox, tempo_medio_assinatura) sem glossario; numeros longos (R$ 12.345.678,90) truncam em silencio em grids apertados; o badge 'Ao vivo' fica verde mesmo se o realtime morrer (ele pode olhar dado velho achando que e atual); bounce nos cards destoa do tom sobrio que ele espera de saude financeira; e o dourado da marca ausente faz o painel ler generico-navy em vez de 'CBC'.

## Minor

- O sistema de tokens semanticos de status (success/danger/warning/info com bg/border e ajuste de dark) ja existe e e bom — o trabalho nao e cria-lo, e religar metade do codigo que ainda usa hex/Tailwind hardcoded a ele.
- Os 9 side-tabs do contractHtml.js sao o documento legal impresso e devem ser explicitamente excluidos de qualquer auditoria de UI — confundi-los com slop levaria a alterar o contrato impresso.
- Lato e a fonte de marca (UI) e os springs de celebracao sao intencionais; o detector os marca como 'overused/bounce' mas eles nao sao o problema — o problema e o spring vazando para transacao/status.
- Cormorant Garamond (titulos de contrato) parece subaplicada em Contratos/Cards/Kanban (titulos caem em fonte de sistema) — restaurar a fonte de marca nos nomes de contrato reforca o sinal de 'documento legal'.
- Formatacao monetaria duplicada (BRL() em RelatorioBoletos vs fmt() em AsaasPanel) arrisca divergencia de centavos entre tela e PDF — consolidar em utils/formatting.js com toFixed(2) antes do toLocaleString.
- Keyframes inline em PortalClientePanel (<style>) com easing custom diferente do sistema — mover para index.css e alinhar ao --cbc-ease-out.
- RT_DEBOUNCE de 1500ms no Dashboard e disciplina rara — manter; so adicionar 'atualizado ha X min' e limiar de staleness (>5min -> amber).
- ReminderModal (Contratos) e FilterBar/EmptyScope/InsightsCard (Dashboard) nao foram lidos na auditoria — incluir numa rodada de follow-up para fechar a11y/overflow.
- Logo do Google inline como SVG no Login e verboso; extrair para /public e servir como <img> melhora 3G.
- O server/ modular existe mas o cutover nunca ocorreu — divida tecnica nao-UI, fora de escopo deste critique mas vale registrar.

## Perguntas

- Se voce so pudesse fazer UM fix sistemico neste trimestre, concorda que e a camada de cor (religar dourado ao light + tokenizar todo hex + um StatusPill central com contraste garantido), ja que ela fecha P0 de contraste, o bug de marca e metade das inconsistencias em todas as 6 superficies de uma vez?
- O dourado da marca foi removido do light mode de proposito (decisao estetica que voce gosta?) ou e um efeito colateral nao-intencional do remap @theme do Tailwind? A resposta muda se isso e um fix de 1 linha ou uma rediscussao de marca.
- Quem realmente abre o Monitor e o Bot ADVBOX no dia-a-dia? Se forem so voce e devs, o jargao tecnico cru e aceitavel e a prioridade cai; se secretarias/vendedores entram la, o vocabulario vira P0 de usabilidade.
- As tabelas de 14-20 colunas (Admin, planilha Vendas) sao usadas em desktop largo apenas, ou alguem precisa delas no iPad/celular? Isso decide entre 'smart column hiding' (esforco medio) e 'aceitar scroll horizontal no desktop' (zero esforco).
- Vale criar um piso tipografico e uma escala unica agora (esforco transversal) ou a densidade extrema e exatamente o que advogados/secretarias querem e mexer nisso vai gerar reclamacao de 'ficou maior, cabe menos'? Convem validar com 2-3 usuarios reais antes.
- O bounce (--cbc-spring) e parte da identidade de 'celebracao CBC' que voce quer preservar, ou pode ser aposentado fora dos confetes? Se preservar, qual a fronteira exata entre 'fluxo de celebracao' e 'fluxo de transacao'?
- A deteccao de duplicata (CPF+resort) que roda mas nunca renderiza esta deixando contratos duplicados passarem na pratica — isso conecta com o achado da memoria 'assinou mas mostra nao abriu = duplicata'? Renderizar o aviso pode atacar a raiz.
