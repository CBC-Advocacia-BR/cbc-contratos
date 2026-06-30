# 📋 Catálogo de Sugestões de Melhoria — CBC Contratos

> **356 sugestões** organizadas em 12 dimensões, com explicação simples de cada uma.
> Gerado em 31/05/2026. Cada item tem uma tag `[impacto · esforço]` para ajudar a priorizar.
> Contexto de escala real: ~129 contratos, ~11 mil boletos, ~1.258 clientes, ~5 usuários internos.

## Como ler
- **Impacto**: o quanto melhora (alto/médio/baixo). **Esforço**: o quanto dá de trabalho (baixo/médio/alto).
- Os melhores candidatos para começar são **impacto alto + esforço baixo**.
- Há sobreposição proposital entre seções (ex: "webhook ZapSign" aparece em Performance, Integrações e DevOps) — quando uma ideia aparece em várias lentes, é sinal de que é prioritária.

## ⚠️ Notas de contexto (o que já foi feito recentemente)
Algumas sugestões abaixo já estão **parcial ou totalmente implementadas** — mantidas na lista por completude:
- ✅ Memoização React (contexts, ClientCard), select enxuto do Dashboard (JSON-path), ClientFormQR com realtime, keep-warm enxuto.
- ✅ Fix do sync de boletos (RLS), correção do cálculo de inadimplência (DUNNING_RECEIVED).
- ✅ Índices em FKs, RLS `initplan` otimizado, **redução de ~95% do ruído de auditoria**, reminder-cron 5→15min, observabilidade do sync (erros vão pro banco).
- ✅ Vazamento de WebSocket por `Date.now()` **já corrigido**; webhook ZapSign **já existe** (polling é só backup); materialized view `dashboard_stats` **já existe**.
- ⏳ **Pendente e mais importante**: fechar a RLS de `contratos` e `user_permissions` (segurança) + configurar `SUPABASE_SERVICE_ROLE_KEY`.

---

# 🏆 TOP 20 PRIORIDADES (síntese cruzada de todas as dimensões)

### 🔴 Segurança — fazer primeiro (protege dados de cliente)
1. **Fechar a RLS de `contratos` e `user_permissions`** — hoje a chave pública lê/edita todos os contratos e até quem é admin. É o buraco mais grave. `[alto · médio]`
2. **Configurar `SUPABASE_SERVICE_ROLE_KEY` no Netlify** e remover as policies temporárias `temp_anon_*`. `[alto · baixo]`
3. **Mover ADVBOX e CPF-API para proxies serverless + rotacionar os tokens já expostos** no bundle. `[alto · médio]`
4. **Validar webhooks (ZapSign/Asaas) com HMAC + idempotência** — impedir impostor e nota fiscal duplicada. `[alto · médio]`
5. **Remover defaults fracos de API key** (`cbc-powerbi-2026` etc.). `[médio · baixo]`

### 🟢 Quick wins — baixo esforço, alto impacto
6. **Tirar o JSONB `dados` da lista de Contratos** (ContratosTab) — mesmo fix já feito no Dashboard. `[alto · baixo]`
7. **Pausar os pollers quando a aba não está visível** (`visibilitychange`) — economiza banda/bateria. `[alto · baixo]`
8. **Não serializar 11 mil boletos no sessionStorage** a cada carga — trava a tela. `[alto · baixo]`
9. **Ativar e validar o Sentry de verdade** (alarme de erro sem pilha hoje). `[alto · baixo]`
10. **UptimeRobot + dead-man's switch nos crons** — detectar queda e cron silencioso (como o dos boletos). `[alto · baixo]`
11. **Alerta automático de bandwidth aos 80%** (hoje é manual). `[médio · baixo]`
12. **Rodar lint no CI antes do deploy** — parar de subir com erro. `[alto · baixo]`

### 💰 Financeiro — recuperar dinheiro parado (~R$75k em aberto)
13. **Régua de cobrança automática + PIX copia-e-cola no boleto.** `[alto · médio]`
14. **Lista "ligar hoje" + previsão de recebíveis 30/60/90 dias.** `[alto · baixo]`

### 🟡 Estruturais — médio/alto esforço, alto valor
15. **Fila de automação persistente + dead-letter + botão "reprocessar" no Monitor.** `[alto · alto]`
16. **Agregar boletos no servidor (view/RPC)** em vez de no navegador. `[alto · médio]`
17. **Ambiente de staging + CI/CD** (parar de testar em produção). `[alto · médio]`
18. **Migrar polling ZapSign → webhook como fonte da verdade.** `[alto · médio]`
19. **Testes e2e do fluxo crítico (criar→assinar→cobrar) + cobrir cálculos financeiros.** `[alto · alto]`
20. **Portal do cliente + régua de atualização processual automática.** `[alto · alto]`

---

# 1. ⚡ Performance & Escalabilidade

1. **Tirar o JSONB `dados` da lista de contratos** — A aba "Contratos" ainda baixa o campo gigante `dados` (5-20KB por linha) de cada contrato só para mostrar a lista, igual ao Dashboard fazia antes; troque por `dados->>campo` só nos 2-3 campos usados e o carregamento da lista despenca. `[impacto: alto · esforço: baixo]`
2. **Virtualizar de verdade a lista de Contratos** — O `react-window` já está importado em `ContratosTab.jsx` mas a lista continua sendo um `.map` que desenha todas as linhas de uma vez; ligar a virtualização faz o navegador desenhar só as ~20 linhas visíveis, como uma janela que mostra um pedaço da planilha por vez. `[impacto: médio · esforço: médio]`
3. **Virtualizar o Kanban e listas da aba Vendas** — `VendasPanel.jsx` (2.473 linhas) renderiza vários `.map` sobre todos os contratos ao mesmo tempo (kanban + listas + leads), sem virtualização; com o crescimento de vendas isso vira o ponto mais pesado da tela. `[impacto: médio · esforço: médio]`
4. **Não serializar 11 mil boletos no sessionStorage** — `BoletosPanel` faz `JSON.stringify` da lista inteira a cada carga; isso trava a tela por instantes porque é como reescrever uma lista telefônica inteira de uma vez — limite a 200 itens ou use IndexedDB em segundo plano. `[impacto: alto · esforço: baixo]`
5. **Agregar boletos no servidor (view/RPC), não no navegador** — O cálculo de inadimplência hoje roda em `useMemo` sobre os ~11 mil boletos no navegador; mover para uma view/RPC no Supabase entrega o número pronto em poucos KB. `[impacto: alto · esforço: médio]`
6. **Pausar pollers quando a aba não está visível** — Vários `setInterval` continuam rodando mesmo com a janela minimizada; ouvir `visibilitychange` e pausar economiza banda e bateria sem o usuário perceber. `[impacto: alto · esforço: baixo]`
7. **Consolidar os ~6 intervalos do MonitorPanel** — Junte os seis temporizadores (logs 2s, fetch 15s, load 30s, etc.) num único ciclo para reduzir as idas ao banco quando o monitor fica aberto numa TV. `[impacto: médio · esforço: médio]`
8. **Parar de reagir à lista inteira no realtime do Dashboard** — Como os KPIs vêm da materialized view, o canal que empilha cada contrato em `allContratos` virou trabalho duplicado; basta pedir um refresh leve da view. `[impacto: médio · esforço: baixo]`
9. **Filtrar o realtime por status na origem** — Aplicar `filter: status=eq.enviado_zapsign` faz o Supabase só mandar os eventos que importam, em vez de toda mudança de qualquer contrato. `[impacto: médio · esforço: baixo]`
10. **Migrar o polling do ZapSign para webhook** — Deixar o ZapSign avisar quando assina (empurrar em vez de perguntar) elimina o maior consumo de banda. `[impacto: alto · esforço: médio]`
11. **Reusar uma só conexão realtime para `contratos`** — Dashboard, ContratosTab e App.jsx abrem três canais na mesma tabela; centralizar num canal compartilhado corta conexões WebSocket pela metade. `[impacto: médio · esforço: médio]`
12. **Buscar o detalhe do contrato sem `select('*')`** — Pedir só as colunas que a tela de detalhe mostra reduz o tráfego a cada atualização ao vivo. `[impacto: baixo · esforço: baixo]`
13. **Confirmar que o Sentry carrega de forma preguiçosa** — Garantir que ele só inicialize após o app pintar a tela tira esse peso do carregamento inicial sem perder rastreamento de erros. `[impacto: médio · esforço: baixo]`
14. **Pré-carregar a aba seguinte ao passar o mouse** — Disparar o `import()` no `onMouseEnter` do botão da aba faz o código chegar "quentinho" antes do clique. `[impacto: médio · esforço: baixo]`
15. **Cachear listas com stale-while-revalidate** — Mostrar o último resultado em memória e atualizar por baixo elimina a tela em branco entre navegações. `[impacto: médio · esforço: médio]`
16. **Cache curto nas consultas ViaCEP/CPF** — Guardar resultados recentes num mapa evita repetir a mesma busca quando o usuário corrige um campo. `[impacto: baixo · esforço: baixo]`
17. **Debounce na busca da lista de Contratos** — Um atraso de ~300ms espera o usuário parar de digitar antes de ir ao banco, evitando uma rajada de consultas a cada letra. `[impacto: médio · esforço: baixo]`
18. **Quebrar os mega-componentes em pedaços** — `VendasPanel` (2.473), `SociosDashboard`, `VendasParametrizacaoPanel` (2.000+ linhas) viram chunks enormes e re-renderizam muita coisa junto. `[impacto: médio · esforço: alto]`
19. **Memoizar linhas de lista com `React.memo`** — Faz o React pular o redesenho das linhas idênticas, como não repintar paredes que já estão na cor certa. `[impacto: médio · esforço: médio]`
20. **Carregar OCR (Tesseract) só na hora de usar** — Garantir que o modelo `por.traineddata` só baixe quando o usuário realmente tira foto do documento. `[impacto: alto · esforço: baixo]`
21. **Servir logos/ícones no tamanho certo e WebP** — Definir `width/height` evita baixar imagem grande demais e o "pulo" do layout. `[impacto: baixo · esforço: baixo]`
22. **Paginar/limitar o ActivityFeed e logs** — Limitar às últimas ~30 entradas e carregar mais sob demanda mantém a tela leve. `[impacto: baixo · esforço: baixo]`
23. **Evitar reprocessar todo o array de boletos a cada tick** — Recalcular o agregado pesado só quando os dados mudam (e não a cada relógio de 30s). `[impacto: médio · esforço: baixo]`
24. **Aumentar o intervalo do polling do ClientFormQR** — Com realtime ativo dá para esticar o poll de reforço de 20s para 60s. `[impacto: baixo · esforço: baixo]`
25. **Mostrar skeleton só na primeira carga** — Manter o conteúdo antigo visível e atualizar por baixo dá percepção de velocidade muito maior do que piscar o esqueleto. `[impacto: baixo · esforço: baixo]`
26. **Trocar offsets grandes por keyset na paginação** — Paginar por "tudo antes desta data/id" mantém a velocidade constante mesmo lá no fim da lista. `[impacto: baixo · esforço: médio]`
27. **Gerar PDF/DOCX num Web Worker** — Jogar esse trabalho para um Web Worker (já existe `pdfWorker.js`) mantém a tela respondendo enquanto o documento é montado. `[impacto: médio · esforço: médio]`
28. **Não recriar funções e objetos de estilo a cada render** — Extrair com `useCallback`/constantes faz os filhos memoizados realmente pularem o redesenho. `[impacto: baixo · esforço: baixo]`
29. **Cachear no navegador as respostas das Functions de leitura** — Cabeçalho `Cache-Control`/`ETag` faz o navegador reaproveitar a resposta por alguns minutos. `[impacto: médio · esforço: baixo]`
30. **Indicadores otimistas ao enviar/salvar** — Mostrar imediatamente o novo estado (e reverter só se der erro) faz a ação parecer instantânea. `[impacto: médio · esforço: médio]`

# 2. 🗄️ Banco de Dados

1. **RLS fechada em todas as tabelas** — Ative RLS com policy explícita por tabela, mesmo que seja "só autenticado pode ver". `[alto · médio]`
2. **Política de retenção em `contratos_audit`** — Crie job que apaga (ou arquiva) registros com mais de 12 meses. `[alto · baixo]`
3. **Particionar `contratos_audit` por mês** — Use uma gaveta por mês (partição por data); descartar dados velhos vira "jogar fora a gaveta antiga". `[alto · médio]`
4. **Particionar `asaas_boletos` por ano/status** — Separe boletos pagos/antigos dos ativos para que toda consulta leia só a partição "viva". `[médio · médio]`
5. **Índice parcial para contratos ativos** — Um índice `WHERE status <> 'cancelado'` é um marcador que ignora o lixo automaticamente. `[médio · baixo]`
6. **Tipar `status` com ENUM ou CHECK** — Garante que só os valores válidos entram (evita "assinado" vs "Assinado"). `[médio · baixo]`
7. **Tirar coluna `dados` JSONB dos SELECTs de lista** — Selecione apenas as colunas exibidas, não o arquivo completo do processo. `[alto · baixo]`
8. **RPC agregada para o Dashboard** — O banco devolve os números já contados, como pedir o placar em vez de assistir o jogo todo. `[alto · médio]`
9. **Refresh agendado da materialized view `dashboard_stats`** — Um `pg_cron` que atualiza a view em horários fixos, senão mostra dados velhos. `[médio · baixo]`
10. **`REFRESH CONCURRENTLY` na materialized view** — Atualização não tranca a leitura do dashboard. `[médio · baixo]`
11. **Constraint UNIQUE para deduplicação CPF+Resort** — A tranca física que impede dois contratos iguais mesmo se o código falhar. `[médio · baixo]`
12. **Validar CPF/CEP/UF com CHECK constraint** — O banco recusa dado fora do formato, como um porteiro que confere o documento. `[médio · baixo]`
13. **Foreign keys reais entre `contratos` e `empreendimentos`** — Garante que todo contrato aponta pra um resort que existe. `[médio · médio]`
14. **Índice composto em `asaas_boletos(status, vencimento)`** — Atalho direto pra "quais boletos vencem e estão em aberto?". `[médio · baixo]`
15. **Índice de busca full-text (GIN) em contratos** — Faz a busca por nome/CPF/processo voar como o índice de um livro, em vez de `ILIKE %x%`. `[alto · médio]`
16. **Retenção em `activity_log` e `audit_log`** — Defina janela (ex: 6 meses online, resto arquivado). `[médio · baixo]`
17. **Arquivar contratos finalizados em tabela fria** — Deixa a tabela "quente" pequena e rápida, como guardar processos encerrados no arquivo morto. `[médio · alto]`
18. **`updated_at` com trigger automático** — Saber "quando isso mudou" sem depender do app lembrar. `[baixo · baixo]`
19. **Limpeza de `notifications` lidas/antigas** — Job que remove as lidas com mais de 30 dias mantém a caixa leve. `[baixo · baixo]`
20. **Índice em `notifications(user_id, lida, created_at)`** — Entrega só o que interessa pro sino do usuário. `[médio · baixo]`
21. **`SECURITY DEFINER` + `search_path` fixo nas RPCs** — Funções com privilégio elevado precisam de `search_path` travado contra ataques. `[alto · baixo]`
22. **Esquema separado por sistema no banco compartilhado** — Coloque o CBC num `schema` próprio para evitar colisão e facilitar permissões. `[médio · alto]`
23. **`FILLFACTOR` menor em tabelas muito atualizadas** — Reservar espaço na página permite atualizações "no lugar" (HOT), reduzindo inchaço. `[baixo · baixo]`
24. **Autovacuum mais agressivo em `contratos_audit`** — Passar a faxina com mais frequência onde mais suja. `[médio · baixo]`
25. **View materializada para receita/inadimplência (Sócios)** — Pré-calcular numa MV refrescada de hora em hora corta o custo das contas pesadas. `[médio · médio]`
26. **`pg_cron` para tarefas de manutenção** — Mover retenção e refresh para dentro do banco é mais confiável (roda mesmo se o Netlify cair). `[médio · baixo]`
27. **Tipos numéricos corretos em valores monetários** — `numeric(12,2)`, não `float`, senão dá erro de arredondamento que assombra a contabilidade. `[médio · médio]`
28. **Normalizar `tabs`/permissões de `user_permissions`** — Uma tabela `(user_id, tab, allowed)` torna "quem vê Leads?" uma query simples. `[baixo · médio]`
29. **`pg_stat_statements` + `EXPLAIN ANALYZE` nos selects pesados** — Ver quais queries realmente gastam tempo, como um velocímetro de onde o sistema engasga. `[alto · baixo]`
30. **Policies RLS com `(select auth.uid())`** — Avalia uma vez por query em vez de por linha, acelerando RLS em tabelas grandes. `[médio · baixo]` *(já aplicado em 3 tabelas)*

# 3. 🔒 Segurança & LGPD

1. **Travar RLS na tabela de permissões** — Crie políticas que só deixam o service role escrever em `user_permissions` (hoje qualquer um edita quem é admin). `[alto · médio]`
2. **Fechar RLS na tabela de contratos** — Só usuários autenticados acessam (hoje a chave anônima lê/escreve tudo). `[alto · médio]`
3. **Configurar SUPABASE_SERVICE_ROLE_KEY no Netlify** — A chave-mestra que deve ficar só no cofre do servidor, nunca no navegador. `[alto · baixo]`
4. **Remover token ADVBOX do bundle frontend** — Mova a chamada para uma Function que guarda o token no servidor. `[alto · médio]`
5. **Rotacionar todos os tokens já expostos** — Troque ADVBOX, CPF-API e outros, como trocar a fechadura depois de perder a chave. `[alto · baixo]`
6. **Eliminar defaults fracos de API key** — Force chave longa e aleatória via env var e recuse iniciar sem ela. `[médio · baixo]`
7. **Validar webhook com HMAC, não token simples** — Assine o payload com segredo compartilhado, como um lacre que só o remetente verdadeiro consegue fazer. `[alto · médio]`
8. **Comparar segredos com tempo constante** — Evita que o atacante "adivinhe letra por letra" pelo tempo de resposta. `[médio · baixo]`
9. **Rate limiting nas Netlify Functions** — Um teto de requisições por IP/minuto, como uma catraca que segura a multidão. `[médio · médio]`
10. **Validar e sanitizar todo input do servidor** — Valide CPF, e-mail, tamanhos com um schema (Zod) antes de gravar. `[alto · médio]`
11. **Headers de segurança no Netlify** — `CSP`, `X-Frame-Options`, etc. são grades nas janelas contra sequestro de cliques. `[médio · baixo]`
12. **HSTS para forçar HTTPS** — Garante que o navegador nunca aceite versão sem cadeado. `[médio · baixo]`
13. **Mascarar CPF/RG na interface** — Mostre `***.456.789-**` por padrão e revele sob clique. `[médio · médio]`
14. **Política de retenção e anonimização LGPD** — Não guardar dado pessoal "para sempre sem motivo". `[alto · alto]`
15. **Registro de consentimento do titular** — Guarde quando/como o cliente autorizou o uso dos dados. `[alto · médio]`
16. **Atender direitos do titular (acesso/exclusão)** — Caminho para exportar ou apagar todos os dados de um cliente que pedir. `[alto · alto]`
17. **Log de auditoria de acesso a dados sensíveis** — Registre quem visualizou/exportou contratos e CPFs, como câmera de segurança do arquivo. `[alto · médio]`
18. **Criptografar campos ultrassensíveis em repouso** — Cifrar RG/CPF (pgcrypto) para que um vazamento entregue dado embaralhado. `[alto · alto]`
19. **Backups criptografados e com acesso restrito** — Garanta SSE e bucket privado, senão o backup vira a maior porta aberta. `[alto · médio]`
20. **Testar restauração de backup periodicamente** — Backup que nunca foi restaurado é só esperança. `[médio · médio]`
21. **MFA (segundo fator) para usuários internos** — Precisar da chave E do código do celular. `[alto · médio]`
22. **Política de senha forte e expiração de sessão** — Derrube sessões inativas após um tempo. `[médio · baixo]`
23. **Princípio do menor privilégio no RBAC** — Cada usuário só vê o que seu papel exige (secretária ≠ sócio). `[médio · médio]`
24. **Mover ADVBOX/CPF-API para proxies serverless** — O navegador passa a só conversar com seu backend, nunca com a API direto. `[alto · médio]`
25. **Não logar dados pessoais em texto puro** — Mascare PII nos logs (inclusive Sentry). `[médio · médio]`
26. **Configurar scrubbing de PII no Sentry** — Para o monitoramento não virar um depósito de dados de cliente. `[médio · baixo]`
27. **Validar tamanho e tipo de uploads (OCR/PDF)** — Impede upload de arquivo malicioso disfarçado de documento. `[médio · baixo]`
28. **Expirar e proteger links de assinatura/ClientFormQR** — Validade curta e token único; um link eterno vazado expõe dados. `[médio · médio]`
29. **DPA e mapeamento de subprocessadores** — Contrato de tratamento com cada serviço que toca dados (Supabase, ZapSign, Asaas...). `[alto · alto]`
30. **Plano e canal de resposta a incidentes** — Passo a passo de "o que fazer se vazar" + notificar ANPD no prazo. `[alto · médio]`

# 4. 🎨 UX/UI, Acessibilidade & Mobile

1. **Errada sem dizer qual** — Em vez de "3 campos faltando", mostre o nome de cada campo faltante numa lista clicável que rola até ele. `[alto · médio]`
2. **Teclado certo no celular** — Force teclado numérico (`inputMode="numeric"`) em CPF, CEP e telefone. `[alto · baixo]`
3. **Leitor de tela ignora os erros** — Ligue cada mensagem de erro ao seu campo (`aria-invalid`/`aria-describedby`). `[médio · médio]`
4. **Aviso que ninguém ouve** — Coloque o resumo de erros num `aria-live` pra ser falado por leitores de tela. `[médio · baixo]`
5. **Wizard sem botão de avançar fixo** — Deixe Voltar/Avançar fixos no rodapé para não rolar até o fim. `[alto · médio]`
6. **Passo travado sem explicar** — Mostre "Faltam 2 campos" ao lado do botão desabilitado. `[alto · baixo]`
7. **Salvamento automático visível** — Selo "Rascunho salvo às 14:32" perto do título, igual ao Google Docs. `[médio · baixo]`
8. **Só 3 abas no celular** — Botão "Mais" que abre as demais abas num menu. `[alto · médio]`
9. **Preview some no celular** — Botão flutuante "Ver contrato" em tela cheia com gesto de deslizar. `[médio · médio]`
10. **OCR sem mostrar a foto** — Mostre a miniatura da foto ao lado dos campos preenchidos pra conferir. `[alto · médio]`
11. **Campo preenchido por máquina sem destaque persistente** — Brilho dourado nos campos auto-preenchidos até a pessoa tocar neles. `[médio · baixo]`
12. **Erro de rede que não ensina** — Troque erro técnico por "Não conseguimos enviar — tente de novo" com botão. `[alto · médio]`
13. **Lista vazia desanimadora** — Ilustração + frase amigável + botão "Criar primeiro contrato". `[médio · baixo]`
14. **Busca sem resultado parece quebrada** — "Nenhum contrato com 'João' — verifique a grafia" com botão limpar. `[médio · baixo]`
15. **Contraste do dourado sobre branco** — Escureça um tom em textos/ícones pequenos (está abaixo do mínimo de contraste). `[alto · baixo]`
16. **Foco invisível ao navegar por Tab** — Anel de foco visível e forte (`focus-visible`) em tudo clicável. `[alto · médio]`
17. **Cmd+K escondido** — Caixa "Buscar (Cmd+K)" visível no topo, como Notion/Linear. `[médio · baixo]`
18. **Atalhos sem mapa rápido** — Abrir o guia de atalhos com a tecla "?". `[baixo · baixo]`
19. **Dark mode com pontos claros** — Varredura para eliminar fundos brancos no tema escuro (Boletos, Vendas, Sócios). `[médio · médio]`
20. **Botão de enviar sem trava visual** — Botão vira "Enviando..." com spinner e bloqueado, pra evitar envio duplicado. `[alto · baixo]`
21. **Confirmação destrutiva também por toque** — Deslizar-para-confirmar como alternativa ao digitar "CANCELAR" no mobile. `[baixo · médio]`
22. **Progresso do passo sem rótulo falado** — "Passo 3 de 7" + `aria-current` para leitores de tela. `[médio · baixo]`
23. **Stepper aperta no celular** — Indicador compacto "Passo 3/7 — Resort" com setas. `[médio · médio]`
24. **Prioridade Idoso pouco evidente** — Selo colorido fixo "Prioridade Idoso" no topo do contrato. `[médio · baixo]`
25. **Dashboard sem explicar números** — "i" com tooltip explicando cada KPI ("Assinados nos últimos 30 dias"). `[médio · baixo]`
26. **Gráfico ilegível pra daltônicos** — Rótulos ou padrões (listras/pontos) além da cor. `[médio · médio]`
27. **Sem aviso de "salvando" ao trocar de aba** — "Você tem alterações não enviadas" se sair com formulário incompleto. `[médio · médio]`
28. **Toques pequenos demais no celular** — Aumente a área de toque dos ícones para 44px. `[alto · baixo]`
29. **Sem onboarding visual** — Tour guiado de 4 balões na primeira vez. `[médio · alto]`
30. **Respeitar "reduzir animações"** — Desligar confete/pulsos quando o sistema pede menos movimento. `[médio · baixo]`
31. **Status do contrato sem linha do tempo** — Mini linha do tempo na lista mostrando onde travou. `[alto · médio]`
32. **Cobranças sem resumo no topo** — Cartões "Em aberto: R$X · Vencidos: Y · Recebidos: Z" antes da lista. `[alto · médio]`

# 5. 🔌 Integrações Externas

1. **Cofre de tokens server-side** — Mova ADVBOX/CPF-API para env vars lidas só por functions. `[alto · médio]`
2. **Proxy único para ADVBOX** (`advbox-proxy`) — O único portão por onde os pedidos ao CRM passam. `[alto · médio]`
3. **Proxy para CPF-API com cache** — Esconde o token e evita repetir buscas. `[alto · baixo]`
4. **Chave de idempotência no ADVBOX** — "Protocolo" único por contrato para não criar processo duplicado. `[alto · médio]`
5. **Retry com espera crescente** — Tente de novo esperando 1s, 2s, 4s, como bater na porta com paciência. `[alto · médio]`
6. **Disjuntor (circuit breaker) por serviço** — Se um serviço falha muito, pare de tentar por alguns minutos. `[médio · médio]`
7. **Fila de saída persistente (outbox)** — Grave cada chamada pendente antes de enviar, para nada se perder se o servidor cair. `[alto · alto]`
8. **Fila de mortos (dead-letter)** — Pedidos que falharam tudo vão para uma "caixa de problemas" visível no Monitor. `[alto · médio]`
9. **Webhook ZapSign como fonte da verdade** — Polling de 5min só como rede de segurança. `[alto · médio]`
10. **Validar assinatura dos webhooks** — Confira um "selo" secreto para ter certeza de que veio mesmo deles. `[alto · baixo]`
11. **Idempotência nos webhooks recebidos** — Não emitir duas NFs se o Asaas reenviar o mesmo evento. `[alto · médio]`
12. **Backoff inteligente no polling ZapSign** — Verificar recém-enviados com mais frequência e antigos cada vez menos. `[médio · baixo]`
13. **Lock com expiração automática no Drive** — Cadeado com prazo de validade que se solta sozinho (fim do lock órfão). `[alto · médio]`
14. **Confirmação real do upload no Drive** — Pergunte ao Apps Script "chegou mesmo?" antes de marcar arquivado. `[médio · médio]`
15. **Verificador de consistência ADVBOX** — Cron diário que avisa se algum assinado ficou sem processo lançado. `[médio · médio]`
16. **Sync incremental do Asaas** — Buscar só o que mudou desde a última sincronização. `[alto · médio]`
17. **Reconciliação financeira Asaas** — Cron que confere se todo assinado tem cobrança e os status batem. `[médio · médio]`
18. **Respeitar limites de taxa (429/Retry-After)** — Esperar o tempo pedido em vez de insistir e ser bloqueado. `[alto · baixo]`
19. **Fila com vazão controlada** — Soltar pedidos num ritmo constante (5/s) como um pedágio. `[médio · médio]`
20. **Integração Kommo via webhook bidirecional** — Assinar cria/atualiza o lead lá e mudanças voltam, sem digitação manual. `[alto · alto]`
21. **Disparo de WhatsApp pelo Kommo** — Reativar avisos automáticos (enviado, assinado, boleto vencendo). `[alto · médio]`
22. **Painel de saúde por integração com latência** — Mostrar quanto cada serviço está demorando, não só online/offline. `[médio · baixo]`
23. **Alerta proativo de falhas** — Aviso ao Paulo quando uma integração ultrapassa X erros/hora. `[médio · médio]`
24. **Timeout explícito em toda chamada externa** — Uma API travada não congela o processo inteiro. `[alto · baixo]`
25. **DataJud com lotes e janela de erro** — Dividir em lotes e registrar quais falharam para reconsultar. `[médio · médio]`
26. **Webhook de movimentação processual (DataJud)** — Alertar o advogado quando o processo for distribuído. `[médio · alto]`
27. **Registro de auditoria de toda integração** — "Diário de bordo" de cada chamada/resposta para investigar falhas. `[médio · médio]`
28. **Repetição manual segura no Monitor** — Botão "tentar de novo" usando a mesma chave de idempotência. `[médio · baixo]`
29. **Sandbox/modo-teste por integração** — Validar mudanças sem enviar contrato/boleto real ao cliente. `[médio · médio]`
30. **Rotação programada de tokens** — Rotina e lembrete para trocar chaves periodicamente. `[alto · baixo]`

# 6. ⚖️ Funcionalidades de Negócio (Jurídico)

1. **Calculadora de chances de êxito** — Estima ao cliente a probabilidade de ganhar contra aquele resort com base no histórico, aumentando conversão. `[alto · médio]`
2. **Banco de jurisprudência por resort** — Reúne decisões favoráveis já obtidas contra cada resort para reaproveitar em petições. `[alto · médio]`
3. **Portal do cliente para acompanhar o processo** — Página onde o cliente vê a fase da ação dele, reduzindo ligações. `[alto · alto]`
4. **Régua de atualização automática ao cliente** — Mensagem em cada marco (distribuído, citado, sentença). `[alto · médio]`
5. **Modelos de petição por tipo de ação + resort** — Petições pré-montadas com dados do cliente, de horas para minutos. `[alto · médio]`
6. **Alerta de prescrição** — Avisa quando o prazo para entrar com a ação está perto de expirar. `[alto · baixo]`
7. **Esteira de leads com funil visual** — Fila novo→contatado→proposta→fechado para ninguém esquecer de dar retorno. `[alto · médio]`
8. **Gerador de proposta comercial em PDF** — Proposta personalizada antes do contrato, elevando o fechamento. `[médio · baixo]`
9. **Simulador de honorários para o cliente** — Mostra quanto pagaria nos diferentes modos, ajudando a fechar. `[médio · baixo]`
10. **Central de prazos processuais** — Painel único com todos os prazos ordenados por urgência. `[alto · médio]`
11. **Distribuição de tarefas para a equipe** — Atribuir e acompanhar quem faz o quê em cada processo. `[alto · médio]`
12. **Agrupamento de clientes do mesmo resort** — Para montar ações coletivas ou negociar acordos em bloco. `[alto · médio]`
13. **Gestão de acordos e propostas do resort** — Acompanha propostas com cálculo do que sobra ao cliente e honorários. `[médio · médio]`
14. **Histórico unificado do cliente** — Tudo do cliente numa tela (contratos, processos, cobranças, mensagens). `[alto · médio]`
15. **Pesquisa de satisfação automática (NPS)** — Identifica quem está insatisfeito antes que reclame. `[médio · baixo]`
16. **Programa de indicação de clientes** — Link/cupom para clientes satisfeitos indicarem amigos. `[alto · médio]`
17. **Onboarding guiado do novo cliente** — Sequência de boas-vindas que explica os próximos passos após assinar. `[médio · baixo]`
18. **Coletor de documentos do cliente** — Link organizado para o cliente enviar contrato do timeshare, RG, comprovantes. `[alto · médio]`
19. **Biblioteca de respostas prontas (FAQ jurídico)** — Para a secretaria responder rápido e com consistência. `[médio · baixo]`
20. **Detecção de cliente em risco de desistir** — Sinaliza quem parou de responder ou atrasou pagamento. `[médio · médio]`
21. **Relatório de produtividade por advogado** — Quantos contratos/petições/processos cada um movimentou. `[médio · baixo]`
22. **Metas e ranking da equipe** — Ranking motivacional estimulando a produzir mais. `[médio · baixo]`
23. **Agenda de audiências integrada** — Calendário com lembrete automático para advogado e cliente. `[alto · médio]`
24. **Controle financeiro de honorários de êxito** — Quanto há a receber por processo conforme as ações são ganhas. `[alto · médio]`
25. **Reativação de leads frios** — Campanha para leads que não fecharam, recuperando casos perdidos. `[médio · baixo]`
26. **Mapa de resorts mais lucrativos** — Onde focar a captação de novos clientes. `[médio · baixo]`
27. **Assinatura de aditivos e documentos avulsos** — Enviar outros documentos pelo fluxo ZapSign já existente. `[médio · baixo]`
28. **Recibos e quitação automáticos** — Recibo a cada pagamento e termo de quitação ao final. `[médio · baixo]`
29. **Modelo de petição de cumprimento de sentença** — Automatiza a execução quando a ação é ganha. `[alto · médio]`
30. **Linha do tempo do processo para o cliente** — Visual que mostra o caminho percorrido e o que falta. `[médio · médio]`
31. **Aniversários e datas-chave automáticos** — Mensagem no aniversário e em marcos, fortalecendo o relacionamento. `[baixo · baixo]`
32. **Checklist de qualidade pré-protocolo** — Verificação obrigatória antes de protocolar, reduzindo erros e devoluções. `[médio · baixo]`

# 7. 🔄 Automações & Ciclo de Vida do Contrato

1. **Trocar polling do app por cron serverless** — O "vigia" roda sozinho na nuvem 24h, mesmo de madrugada com todos dormindo. `[alto · médio]`
2. **Adotar webhook ZapSign no lugar do polling** — Campainha em vez de espiar pela janela a cada 5min. `[alto · médio]`
3. **Tabela de fila dedicada (`automation_queue`)** — Cada tarefa vira uma "ficha" com status próprio. `[alto · alto]`
4. **Chave de idempotência por tarefa** — Um ingresso que não deixa entrar duas vezes com o mesmo bilhete. `[alto · médio]`
5. **Retry com backoff exponencial** — Tentar de novo em intervalos crescentes (1, 5, 15min, 1h). `[alto · médio]`
6. **Dead-letter queue (fila dos casos perdidos)** — Tarefa vai para uma gaveta visível em vez de sumir em silêncio. `[alto · médio]`
7. **Status intermediários granulares** — `advbox_processando`, `drive_arquivando` deixam claro onde travou. `[médio · médio]`
8. **Lock com expiração explícita (lease/TTL)** — Cadeado válido até uma hora-limite, destrava sozinho. `[médio · baixo]`
9. **Heartbeat em tarefas longas (upload Drive)** — O worker "bate o ponto"; se parar, o sistema sabe que travou. `[médio · médio]`
10. **Worker único processando a fila** — Elimina a corrida de vários polls tentando a mesma coisa. `[alto · médio]`
11. **Botão "Reprocessar" por etapa no Monitor** — Reenviar só o ADVBOX ou só o Drive com um clique. `[alto · baixo]`
12. **Reprocessamento em lote da dead-letter** — Reenviar tudo de uma vez quando a API volta do ar. `[médio · baixo]`
13. **Circuit breaker por integração** — Parar de apertar o botão do elevador quebrado. `[médio · médio]`
14. **Timeout explícito em toda chamada externa** — Evita worker preso esperando para sempre. `[médio · baixo]`
15. **Orquestração como máquina de estados central** — O mapa oficial da esteira num só lugar, fácil de auditar. `[alto · alto]`
16. **Log de transição de estado** — Reconstruir "o que aconteceu com este contrato" quando algo der errado. `[médio · baixo]`
17. **Alerta proativo de tarefa parada** — Aviso automático se algo fica pendente além do esperado. `[alto · médio]`
18. **Notificação de etapa concluída** — "Contrato X arquivado no Drive", dando visibilidade do progresso. `[médio · médio]`
19. **Validação de pré-condições antes de cada etapa** — Conferir dados mínimos antes de chamar a API. `[médio · baixo]`
20. **Confirmação de efeito (read-back) pós-disparo** — Reconsultar a ADVBOX para confirmar que o processo existe. `[médio · médio]`
21. **Verificação de saúde antes de drenar a fila** — Se um serviço está fora, segura só as tarefas dele. `[médio · médio]`
22. **Painel de filas em tempo real (não polling)** — A fila atualiza sozinha via realtime. `[médio · médio]`
23. **Métrica de tempo por etapa** — Enxergar onde a esteira engasga e priorizar a correção. `[baixo · baixo]`
24. **Concorrência limitada por integração** — No máx. 3 uploads Drive por vez, sem estourar limite de API. `[médio · baixo]`
25. **Modo de pausa global (kill switch)** — Congelar toda a esteira em incidente, sem deploy de emergência. `[médio · baixo]`
26. **Reconciliação noturna de consistência** — Confere se todo assinado tem ADVBOX + Drive + Asaas; recoloca na fila se faltar. `[alto · médio]`
27. **DLQ com classificação de causa** — Diferenciar o que reprocessa automático do que precisa de humano. `[médio · médio]`
28. **Etapas pós-assinatura independentes** — Uma falhar não bloqueia as outras (ADVBOX, Drive, Asaas). `[alto · médio]`

# 8. 💰 Cobranças & Financeiro

1. **Régua de cobrança automática** — Lembretes D-3, D0, D+1, D+5, D+15 sem ninguém agir, recuperando dinheiro parado. `[alto · médio]`
2. **Link de pagamento PIX único na cobrança** — QR PIX copia-e-cola na mensagem; muita gente paga PIX na hora mas não boleto. `[alto · baixo]`
3. **Botão "renegociar dívida" para inadimplentes** — Parcelar o atraso (ex: R$75k em 3-6x), virando devedor parado em pagador. `[alto · médio]`
4. **Previsão de recebíveis** — Quanto vai entrar em 30/60/90 dias somando os boletos por vencimento. `[alto · médio]`
5. **Alerta de inadimplência por faixa de atraso** — Dívida nova recupera fácil, velha quase nunca volta — priorizar a certa. `[alto · baixo]`
6. **Negativação automática (Serasa via Asaas)** — O medo de "sujar o nome" faz pagar sem você ligar. `[alto · médio]`
7. **Conciliação automática boleto x contrato** — Nunca cobrar quem já pagou nem dar baixa errada. `[médio · médio]`
8. **Painel de "dinheiro em risco" no Dashboard de Sócios** — Total que pode virar perda destacado em vermelho. `[médio · baixo]`
9. **Taxa de inadimplência por resort** — Ver quais resorts geram mais calote para ajustar condições. `[médio · baixo]`
10. **Reenvio de boleto vencido com nova data** — 2ª via atualizada com juros/multa já calculados. `[alto · médio]`
11. **Multa e juros automáticos por atraso** — 2% + 1%/mês, recuperando valor que hoje se perde. `[médio · baixo]`
12. **Relatório de previsão vs. realizado** — Enxergar buracos de cobrança antes de virarem hábito. `[médio · médio]`
13. **Lista priorizada "ligar hoje"** — Ranking dos devedores que mais valem a pena cobrar. `[alto · baixo]`
14. **Confirmação de NF emitida no painel** — Evitar problema fiscal por NF que o webhook deixou de gerar. `[médio · baixo]`
15. **Acordo com desconto à vista** — "Pague hoje com 20% off"; receber 80% é melhor que 100% de nada. `[alto · médio]`
16. **Histórico de cobrança por cliente** — Cada lembrete/ligação/promessa num só lugar. `[médio · médio]`
17. **Alerta de queda no recebimento** — Avisar quando a entrada do mês fica abaixo da média. `[médio · baixo]`
18. **Status de saúde por cliente** — Bom/atenção/mau pagador, para tratar cada um do jeito certo. `[médio · baixo]`
19. **Cobrança de parcelas futuras automatizada** — Nenhuma parcela agendada "cai no esquecimento". `[alto · médio]`
20. **Exportação contábil pronta** — Planilha mensal no formato do contador, economizando horas. `[médio · baixo]`
21. **Aviso de boleto pago no WhatsApp** — "Recebemos seu pagamento", reduzindo dúvidas e prints. `[baixo · baixo]`
22. **Meta de recuperação de inadimplência** — Meta mensal de quanto dos R$75k recuperar, com foco no time. `[médio · baixo]`
23. **Detecção de cobrança duplicada** — Evitar cobrar em dobro (gera reembolso, atrito, risco jurídico). `[médio · baixo]`
24. **Resumo financeiro diário automático** — WhatsApp de manhã: "entrou X, vence Y, atrasados Z". `[médio · baixo]`
25. **Comissão por advogado sobre recebido** — Calcular sobre o que foi pago, não o contratado. `[médio · médio]`
26. **Reativação de boletos "esquecidos"** — Cobranças antigas PENDING que sumiram do radar. `[alto · baixo]`
27. **Ticket médio e receita por tipo de ação** — Priorizar os contratos mais lucrativos. `[médio · baixo]`
28. **Promessa de pagamento com lembrete** — Registrar "pago dia 10" e lembrar nesse dia. `[médio · baixo]`
29. **Conferência diária Asaas x sistema** — Avisar se os totais baterem diferente, pegando falhas de sync. `[médio · médio]`
30. **Score de risco de calote ao assinar** — Ajustar entrada/parcelamento para clientes de maior risco. `[médio · médio]`

# 9. 📡 Observabilidade, Confiabilidade & Resiliência

1. **Ativar e validar o Sentry de verdade** — Alarme de incêndio sem pilha hoje; force um erro de teste e veja se chega. `[alto · baixo]`
2. **Alerta automático de queda (UptimeRobot)** — Robô externo que te avisa quando o site fica fora. `[alto · baixo]`
3. **Monitorar crons com dead-man's switch** — "Se eu não avisar que rodei, dispare alarme" (Healthchecks.io). `[alto · baixo]`
4. **Logging estruturado em JSON nas Functions** — Etiquetar caixas numa mudança em vez de jogar tudo solto. `[médio · médio]`
5. **Tabela central de erros no Supabase** — "Livro de ocorrências" do sistema inteiro, consultável no Monitor. `[alto · médio]`
6. **Alerta proativo para a aba Monitor** — O sistema te empurra a notificação em vez de esperar você abrir. `[alto · médio]`
7. **Definir SLOs formais com números** — "99,5% assinam sem erro", "boleto em até 2min". `[médio · baixo]`
8. **Verificar restauração do backup (fire drill)** — Provar 1x/mês que os dados realmente voltam. `[alto · médio]`
9. **Runbook de incidente escrito** — Manual de emergência colado na parede para quando algo cai às 22h. `[médio · baixo]`
10. **Retry com backoff nas chamadas externas** — Bater de novo na porta antes de ir embora. `[alto · médio]`
11. **Circuit breaker para serviços externos** — Disjuntor que desarma para não queimar a casa. `[médio · médio]`
12. **Degradação graciosa quando integração cai** — ADVBOX fora não impede o contrato de assinar e cobrar. `[alto · médio]`
13. **Fila de retry persistente (dead-letter)** — Nada fica perdido silenciosamente. `[alto · médio]`
14. **Ambiente de staging** — Dirigir sem cinto é deploy direto em prod com clientes reais. `[alto · médio]`
15. **Deploy preview antes do `--prod`** — Subir um preview para clicar e conferir antes. `[médio · baixo]`
16. **Testes de fumaça pós-deploy** — Acender as luzes da casa depois da reforma para ver se nada queimou. `[alto · médio]`
17. **Monitorar bandwidth com alerta automático** — Evitar estourar o 1TB e o site sair do ar no fim do mês. `[médio · baixo]`
18. **Health check com profundidade** — Testar uma operação real leve, não só se a porta abre. `[médio · médio]`
19. **Alerta de contratos travados > 10 min** — Cobrança que não sai é dinheiro parado. `[alto · baixo]`
20. **Timeout explícito em TODAS as chamadas externas** — Desligar a torneira que ficou aberta. `[médio · baixo]`
21. **Backup redundante e versionado fora da AWS** — Cópia adicional contra exclusão acidental. `[médio · médio]`
22. **Validar e alertar webhooks do Asaas** — Uma NF deixa de ser emitida sem ninguém perceber, hoje. `[alto · médio]`
23. **Painel de status (verde/vermelho dos 5 serviços)** — A secretária consulta antes de abrir chamado. `[baixo · baixo]`
24. **Correlação de logs por `contrato_id` (trace)** — Rastrear toda a jornada de um contrato como uma encomenda. `[médio · médio]`
25. **Alerta de taxa de erro anômala** — Notar que muitos pacotes estão voltando, não só um. `[médio · médio]`
26. **Monitorar expiração de tokens das integrações** — Token expirado para tudo silenciosamente. `[médio · médio]`
27. **Política de retenção e rotação de logs** — Manter a aba Monitor rápida e o Supabase enxuto. `[baixo · baixo]`
28. **Registro de incidentes (post-mortem leve)** — 1 página por queda para não repetir o mesmo erro. `[médio · baixo]`

# 10. 🧰 Qualidade de Código, Testes & Manutenibilidade

1. **Ative o lint no CI antes do deploy** — O `deploy.sh` sobe direto sem rodar eslint; adicione `npm run lint && npm test` como portão. `[alto · baixo]`
2. **Zere os ~121 erros de lint de baseline** — Viram "ruído de fundo" que esconde erros novos de verdade. `[alto · médio]`
3. **Proíba `catch {}` vazio** — Erros engolidos em silêncio são alarme com o fio cortado; ative `no-empty`. `[alto · baixo]`
4. **Adote TypeScript gradual (já tem `@types/react`)** — Comece com `// @ts-check` nos `utils/` para pegar erros sem reescrever. `[alto · médio]`
5. **Gere tipos do Supabase automaticamente** — O editor avisa antes de salvar um `contrato.dados.honorario` errado. `[alto · baixo]`
6. **Quebre o `VendasPanel.jsx` (2473 linhas)** — Gaveta onde tudo foi jogado; separe em subcomponentes + hook `useVendas`. `[alto · alto]`
7. **Quebre `SociosDashboard` e `VendasParametrizacaoPanel`** — Extraia as seções em arquivos próprios. `[médio · alto]`
8. **Cutover do server modular (`index.modular.js`)** — Já tem 31 módulos prontos, mas produção roda o monolito. `[médio · médio]`
9. **Centralize o acesso ao Supabase numa camada de repositório** — 33 arquivos chamam o banco direto; vira caça ao tesouro quando uma coluna muda. `[alto · alto]`
10. **Cubra com teste os `utils` críticos** — `advboxService`, `zapsignService`, `duplicateDetector`, `pdfGenerator` geram contrato/cobrança errados se quebrarem. `[alto · médio]`
11. **Relatório de cobertura com meta mínima** — Dirigir sem velocímetro; ligue `vitest --coverage` com piso. `[médio · baixo]`
12. **Testes de componente (Testing Library)** — Os 7 steps do wizard só são testados "no olho" hoje. `[médio · médio]`
13. **2-3 testes e2e do fluxo crítico (Playwright)** — "Criar→ZapSign→assinar" é o coração do negócio e não tem rede de proteção. `[alto · alto]`
14. **Prettier para formatação automática** — Padroniza estilo e limpa os diffs do Git. `[médio · baixo]`
15. **Helper único de tratamento de erros** — `handleError(err, contexto)` central que loga no Sentry e mostra toast. `[médio · médio]`
16. **Resolva/rastreie os 88 TODO/FIXME** — Dívida invisível; converta em issues e apague os obsoletos. `[baixo · médio]`
17. **Extraia lógica do `App.jsx` para hooks** — `useAutomationPolling()` torna a lógica testável isoladamente. `[médio · médio]`
18. **Cliente HTTP unificado** — `apiClient` com retry/timeout padrão remove `fetch` duplicado nos serviços. `[médio · médio]`
19. **Compartilhe constantes frontend ↔ Functions** — IDs hardcoded em vários lugares geram bug silencioso. `[médio · médio]`
20. **PropTypes (ou tipos) nos componentes** — Aviso barato no console quando passa a prop errada. `[baixo · médio]`
21. **Template de PR com checklist** — Transforma "rodei o lint? testei?" em hábito automático. `[médio · baixo]`
22. **Audite e fixe versões das dependências** — `^` faz a receita mudar de ingrediente sozinha; use `npm ci`. `[médio · baixo]`
23. **Padronize os 21 Netlify Functions** — Um wrapper `withHandler()` comum para CORS/erros consistentes. `[médio · médio]`
24. **Documente os `utils/` com JSDoc** — Autocompletar no editor + mini-manual. `[baixo · médio]`
25. **Error Boundary reutilizável e testado** — `<TabErrorBoundary>` único em vez de copiado em cada aba. `[médio · baixo]`
26. **Isole e teste a lógica de cálculo** — Comissões e KPIs é onde um erro custa dinheiro real. `[alto · médio]`
27. **`.editorconfig` + Husky pre-commit** — Barra código com lint quebrado na origem, não no deploy. `[médio · baixo]`
28. **Padronize idioma e convenção de nomes** — Mistura PT/EN aumenta a carga mental; documente em `CONTRIBUTING.md`. `[baixo · baixo]`
29. **Hooks compartilhados para padrões de dados** — `useSupabaseList({table, filters})` elimina código duplicado. `[alto · médio]`
30. **Remova código morto e dependências não usadas** — Rode `knip`/`depcheck` e limpe o que ninguém importa. `[baixo · baixo]`

# 11. 🚀 DevOps, Deploy & Custos

1. **CI/CD com GitHub Actions** — Build e deploy automático no `git push`, como um piloto automático. `[alto · médio]`
2. **Tirar tokens do deploy.sh e do bundle** — Estão no Git e no navegador; mova para env vars secretas. `[crítico · médio]`
3. **Deploy Previews da Netlify (com limite)** — Link de teste descartável antes de ir pro ar. `[alto · baixo]`
4. **Branch de staging + Supabase separado** — Cópia "de ensaio" para validar sem mexer nos dados reais. `[alto · alto]`
5. **Migrar para Cloudflare Pages** — Banda ilimitada grátis, economiza ~R$1.200/ano. `[alto · alto]`
6. **Domínio próprio (contratos.advocaciacbc.com)** — Mais credibilidade + CDN Cloudflare na frente. `[médio · baixo]`
7. **Feature flags simples** — "Interruptor" no Supabase para testar com 1 usuário antes de liberar pra todos. `[médio · médio]`
8. **Webhook ZapSign no lugar do polling** — O maior ofensor de banda (~1.35GB/mês). `[crítico · médio]`
9. **Alerta automático de bandwidth** — Cron que avisa aos 80%, em vez de rodar manual. `[médio · baixo]`
10. **Dependabot / Renovate** — Robô que avisa atualizações de segurança das bibliotecas. `[médio · baixo]`
11. **Lockfile + versões travadas** — `npm ci` no deploy para usar exatamente o que foi testado. `[médio · baixo]`
12. **Tag de versão no Git a cada deploy** — Saber qual código está no ar e facilitar rollback preciso. `[médio · baixo]`
13. **Proxies seguros nas Functions** — Esconder ADVBOX/CPF-API do navegador. `[crítico · médio]`
14. **Smoke test pós-deploy** — Verifica automaticamente se site/login/Supabase respondem. `[alto · médio]`
15. **Rotação de tokens comprometidos** — ADVBOX e CPF-API já vazaram; gere novos. `[crítico · baixo]`
16. **Cache HTTP agressivo em todas as Functions** — Cortar execuções e banda respondendo do cache. `[médio · baixo]`
17. **RPC agregada no Supabase para o Dashboard** — Pedir o total da nota em vez de todos os cupons. `[alto · médio]`
18. **Substituir polling de Leads por realtime** — A aba recarrega 1000 linhas a cada 30s (~3GB/usuário/dia). `[alto · médio]`
19. **Corrigir vazamento de WebSocket realtime** — Nomes fixos e fechar ao sair (já parcialmente feito). `[médio · baixo]`
20. **Backup do Supabase para o S3** — Dump diário do Postgres garante recuperação se o projeto grátis falhar. `[alto · médio]`
21. **Remover defaults fracos de API key** — Force env vars obrigatórias e bloqueie o valor padrão. `[alto · baixo]`
22. **Monitoramento de uptime (UptimeRobot)** — Vigia que liga avisando que a luz da loja apagou. `[médio · baixo]`
23. **Health check do rollback** — `rollback.sh` valida que a versão anterior sobe antes de confirmar. `[médio · baixo]`
24. **Migrar api-powerbi para view** — Eliminar o reprocessamento a cada chamada. `[alto · médio]`
25. **Auditoria de tamanho do bundle no deploy** — Falhar o build se crescer demais (ex: >250KB). `[médio · baixo]`
26. **Centralizar secrets num único lugar** — Netlify env UI ou Doppler, com a regra "nunca no Git". `[alto · médio]`
27. **Dashboard de custos mensal** — Somar Netlify + Supabase + S3 + APIs num lugar só. `[médio · baixo]`
28. **Documentar runbook de recovery** — Passo a passo do "e se cair?" para qualquer um agir sob pressão. `[médio · baixo]`

# 12. 📊 Relatórios/BI, Documentação & Onboarding

1. **Relatório mensal automático por e-mail** — PDF resumo para os sócios na virada do mês, como um extrato que chega sozinho. `[alto · médio]`
2. **Runbook de recovery** — Manual de emergência do que fazer quando Supabase/ZapSign/Netlify falham. `[alto · médio]`
3. **Manual do admin** — Guia de permissões, backup e Monitor para outra pessoa além do Paulo administrar. `[alto · baixo]`
4. **Guia de onboarding de novo usuário** — Tour interativo na primeira vez, como um guia turístico. `[alto · médio]`
5. **Previsão de receita do mês** — Quanto deve entrar até dia 30, como uma previsão do tempo para o caixa. `[alto · médio]`
6. **Funil de conversão Lead → Contrato** — De 100 leads, quantos viram contrato; onde vazam clientes. `[alto · médio]`
7. **Relatório de inadimplência (aging)** — Vencidos agrupados por faixa de atraso para cobrança urgente. `[alto · médio]`
8. **Exportação agendada para Power BI** — Snapshot pronto 1x/dia em vez de puxar toda hora. `[médio · médio]`
9. **Glossário de termos e KPIs** — Todo mundo interpreta os números do mesmo jeito. `[médio · baixo]`
10. **Dicionário de dados das tabelas** — Legenda do mapa para quem mexe no banco. `[médio · médio]`
11. **Comparativo mês atual vs. anterior** — Setinha verde/vermelha "+12% vs. abril" em cada KPI. `[alto · baixo]`
12. **Ranking de produtividade da equipe** — Placar com pódio top 3, competição saudável. `[médio · baixo]`
13. **Relatório de processos sem distribuição** — Assinados há +X dias ainda não protocolados. `[alto · médio]`
14. **Analytics de uso do sistema** — Quais abas/funções são mais usadas, onde investir. `[médio · médio]`
15. **Heatmap de horário de pico** — Quando os clientes mais assinam, para disparar mensagem na hora certa. `[médio · baixo]`
16. **Exportação PDF do Dashboard** — "Baixar como PDF" para levar à reunião sem print. `[médio · baixo]`
17. **Previsão de churn/cancelamento** — Alarme antecipado de cliente insatisfeito (atraso + sem contato). `[médio · alto]`
18. **Relatório de rentabilidade por tipo de ação** — Focar no que dá mais retorno. `[alto · médio]`
19. **Base de conhecimento de FAQ** — Evita perguntas repetidas ao Paulo. `[médio · baixo]`
20. **Vídeos curtos de tutorial** — 2 minutos mostrando como criar e enviar contrato. `[médio · médio]`
21. **Alerta de meta mensal em risco** — GPS que diz "você vai chegar atrasado" na meta de 15 contratos. `[médio · baixo]`
22. **Relatório de sazonalidade anual** — Em quais meses fecha mais, para planejar campanhas. `[médio · médio]`
23. **Exportação CSV agendada para contabilidade** — Arquivo mensal de boletos pagos no formato do contador. `[médio · baixo]`
24. **Documentação das integrações (diagrama)** — Desenho do fluxo entre ZapSign, ADVBOX, Asaas, Drive. `[médio · médio]`
25. **Coortes de clientes por mês de entrada** — Quantos pagam em dia ao longo do tempo, como turmas de escola. `[médio · alto]`
26. **Painel de saúde dos dados (data quality)** — Check-up que mostra cadastros incompletos (sem CPF/telefone). `[médio · médio]`
27. **Changelog visível para usuários** — Aba "Novidades" para a equipe descobrir recursos novos. `[baixo · baixo]`
28. **Relatório de tempo de ciclo (criação → pagamento)** — Revela gargalos no processo todo. `[médio · médio]`

---

## Resumo por dimensão
| # | Dimensão | Sugestões |
|---|----------|-----------|
| 1 | Performance & Escalabilidade | 30 |
| 2 | Banco de Dados | 30 |
| 3 | Segurança & LGPD | 30 |
| 4 | UX/UI, Acessibilidade & Mobile | 32 |
| 5 | Integrações Externas | 30 |
| 6 | Funcionalidades de Negócio | 32 |
| 7 | Automações & Ciclo de Vida | 28 |
| 8 | Cobranças & Financeiro | 30 |
| 9 | Observabilidade & Resiliência | 28 |
| 10 | Qualidade de Código & Testes | 30 |
| 11 | DevOps, Deploy & Custos | 28 |
| 12 | Relatórios/BI & Documentação | 28 |
| | **TOTAL** | **356** |

> Quer atacar algum bloco? Recomendo a ordem: **Segurança (top 1-5) → Quick wins (6-12) → Financeiro (13-14) → Estruturais (15-20)**.
