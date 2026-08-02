# CBC Contratos — Auditoria completa do sistema: 357 melhorias

**Data:** 01/08/2026 · **Método:** 10 análises especializadas em paralelo (frontend, backend, segurança, banco de dados, UX, performance, integrações, operação, testes e produto) sobre o código real, mais o linter oficial do Supabase (453 avisos de segurança + 927 de performance do banco, filtrados para o CBC). Duplicatas entre as análises foram fundidas.

**Importante:** nada foi alterado — isto é só diagnóstico e sugestão. Cada item aponta o arquivo para conferência; antes de implementar qualquer um, ele deve ser confirmado no código e aprovado por você (REGRA #16 do projeto). Alguns achados individuais podem precisar de validação extra — foram gerados por leitura de código, não por teste em produção.

**Como ler cada item:** `(arquivo onde mexer · Impacto · Esforço)` — Impacto: quanto muda na prática (Alto/Médio/Baixo). Esforço: **P** = pequeno (até meio dia), **M** = médio (1 a 3 dias), **G** = grande (semana ou mais).

| Seção | Itens |
|---|---|
| 1. Segurança | 44 |
| 2. Banco de dados & RLS | 41 |
| 3. Backend (Netlify Functions) | 24 |
| 4. Integrações externas | 30 |
| 5. Operação, monitoramento e backup | 28 |
| 6. Performance | 24 |
| 7. Frontend / arquitetura React | 26 |
| 8. Dados, BI e funil | 42 |
| 9. UX, interface e acessibilidade | 35 |
| 10. Qualidade de engenharia | 20 |
| 11. Produto e novas funcionalidades | 42 |
| **Total** | **357** |

## Os 20 mais urgentes (minha leitura)

1. **Números de dinheiro errados HOJE no Dashboard dos Sócios** — a tela calcula inadimplência e receita sobre 1.000 dos ~11.000 boletos (item 219). Mesma família: Tráfego contando videochamadas pela metade e com campanhas de vaga infladas (220, 221).
2. **Duas tabelas com dados financeiros de clientes completamente abertas** — `cliente_parcelas` e `cliente_telefones` sem RLS: qualquer pessoa com a chave pública lê e escreve (45).
3. **A chave-mestra do sistema está publicada no site** — BOT_PANEL_KEY real no JavaScript público (1).
4. **Qualquer um pode cancelar um contrato em assinatura** — proxy do ZapSign sem senha (2).
5. **Pagamento forjado emite nota fiscal de verdade** — webhooks sem segredo configurado (10).
6. **A "assinatura em tempo real" não existe** — o webhook do ZapSign está morto desde sempre por falta de uma variável (86).
7. **Qualquer pessoa logada pode se tornar admin** — `user_permissions` allow-all (47) + RPCs poderosas sem checagem (51, 52).
8. **O backup real não é vigiado e nunca foi testado** — disparo sem confirmação (96), watchdog vigia o backup errado (141-143), whitelist congelada em 17/07 (79), restauração jamais ensaiada (160).
9. **Código de produção fora do GitHub** — o deploy atual saiu de branch de feature com arquivo nem rastreado; disco morreu = produção irrecuperável (163).
10. **Call das 21h cai no mês errado** — datas em UTC nos cálculos do funil distorcem dia e mês (227).
11. **Checkbox que promete não mandar WhatsApp… e a mensagem sai** — resquício do ChatGuru virou armadilha (193).
12. **Ctrl+S duas vezes pode duplicar contrato** (194).
13. **Upload e download livres no Drive do escritório** — duas funções sem autenticação (4, 5).
14. **Tokens do portal: legíveis por todos e válidos para sempre** (55, 56).
15. **Contrato assinado pode ficar semanas sem cobrança** — não há alerta "assinado sem boleto" (120).
16. **1.012 links de portal gerados, 15 acessados** — o portal existe e não é entregue ao cliente (340, 341).
17. **615 no-shows mapeados, 423 elegíveis, zero mensagens** — a maior alavanca comercial parada no banco (316, 317).
18. **R$ 61 mil vencidos com a régua de cobrança desligada** — religar com trilhos de segurança (324, 325).
19. **SLA de resposta medido há semanas e invisível** — 23% dos leads nunca respondidos e ninguém vê o painel (239, 318).
20. **Sem monitor externo de nada** — se a Netlify ou o agendador caírem, o silêncio parece paz (146, 168-uptime).
## 1. Segurança — 44 itens

**1. Chave-mestra do painel (BOT_PANEL_KEY) publicada no site** — A chave real (`cbc-bot-b167...`) está escrita no JavaScript que qualquer visitante baixa, sem login. Com ela dá para gerar link de portal de qualquer cliente, disparar cobranças e rodar backups. Trocar o modelo: o navegador deve usar o login do usuário (JWT), nunca uma chave fixa. `(bot/botApi.js · Alto · G)`

**2. Proxy do ZapSign aceita comandos de qualquer pessoa** — O endereço não pede senha e aceita a ação "cancelar", que apaga um contrato em assinatura, além de baixar o PDF assinado e criar documentos pagos no seu plano. Existe em DUAS cópias (function e edge). `(zapsign-proxy.mjs:8 + edge-functions/zapsign-proxy.ts:50 · Alto · P)`

**3. Consulta de CPF aberta ao público** — Qualquer um pode chamar `/api/cpf-lookup?cpf=...` e descobrir o nome do titular de qualquer CPF, gastando o crédito pago do escritório (R$ 0,25 por consulta). Falta exigir usuário logado. `(cpf-lookup.mjs:30 · Alto · P)`

**4. Upload livre no Google Drive do escritório** — `save-to-drive-direct` aceita arquivos de qualquer pessoa, sem senha e sem teto de tamanho, e grava na pasta que o chamador indicar. Dá para plantar arquivos falsos na pasta de um cliente. `(save-to-drive-direct.mjs:64 · Alto · P)`

**5. save-to-drive baixa qualquer endereço que mandarem** — A função baixa o arquivo do campo `signedFileUrl` sem conferir a origem. Deve aceitar só URLs do domínio do ZapSign e exigir autenticação. `(save-to-drive.mjs:204 · Alto · P)`

**6. Cadastro no ADVBOX sem autenticação** — A função que cria cliente e processo no CRM jurídico aceita pedidos de qualquer origem; um estranho consegue poluir o ADVBOX com processos falsos. `(advbox-sync.mjs:317 · Alto · P)`

**7. Notas no Kommo sem senha** — Qualquer pessoa pode escrever notas em qualquer lead passando só o número. Como o Kommo não permite apagar nota, o estrago é permanente. `(kommo-note.mjs:89 · Alto · P)`

**8. Funções do Asaas sem senha + boleto em cache público** — `asaas-sync-customer`, `asaas-sync` e `asaas-boleto-code` respondem sem autenticação; a última ainda marca a resposta como `public, max-age=3600`, deixando a linha digitável do boleto guardada no cache da CDN. `(asaas-boleto-code.mjs:11 · Alto · P)`

**9. Um GET no navegador dispara robôs pesados** — `asaas-sync-boletos`, `meta-trafego-sync`, `meta-ads-sync` (backfill de até 36 meses!) e `kommo-leads-sync` aceitam GET sem chave. Alguém pode ficar disparando sincronizações em loop e estourar as cotas das APIs. `(asaas-sync-boletos.mjs:25 e irmãs · Médio · P)`

**10. Webhooks aceitam qualquer remetente** — Os três webhooks (Asaas, ZapSign, Kommo) só validam assinatura "se o segredo existir" — e nenhum segredo está configurado. Um POST forjado de "pagamento confirmado" emite nota fiscal de verdade na prefeitura. Configurar os 3 segredos é urgente e barato. `(asaas-webhook.mjs:61, zapsign-webhook.mjs:53, kommo-advbox-webhook.mjs:22 · Alto · P)`

**11. Worker do bot chamável por fora** — O webhook repassa mensagens ao `advbox-bot-worker-background` sem assinar nada, e funções background têm URL pública: dá para injetar mensagens forjadas e fazer o bot responder/criar tarefas. `(advbox-bot-worker-background.mjs · Médio · M)`

**12. Crons disparáveis por qualquer um** — `advbox-monitor`, `viacep-enrich-background` e outros não conferem se a chamada veio do agendador da Netlify (cabeçalho próprio) nem pedem chave. `(advbox-monitor.mjs:14 · Médio · P)`

**13. Senhas de fábrica fracas ainda valem** — Se a variável de ambiente faltar, o código aceita `cbc-bot-2026`, `cbc-api-2026`, `cbc-powerbi-2026` — valores publicados no repositório. O certo é RECUSAR o acesso quando a env não existe, nunca cair no padrão. `(kommo-queue-worker.mjs:12, api-powerbi.mjs:11, api-rest.mjs:16 · Alto · P)`

**14. Chave de API aceita pela barra de endereço** — `?api_key=...` fica gravada em logs de servidor, histórico do navegador e cabeçalho Referer. Aceitar apenas pelo cabeçalho Authorization. `(api-rest.mjs:37, api-powerbi.mjs:29 · Médio · P)`

**15. Chave de administração viaja na URL dos crons** — O padrão `?key=<BOT_PANEL_KEY>` (backup-diario, kommo-sla-sync, meet-auditoria-backfill, kommo-portal-link) grava a chave-mestra nos logs de acesso da Netlify. Migrar para cabeçalho `x-bot-key`. `(backup-diario.mjs:22 e outros · Médio · P)`

**16. Respostas com nome e CPF guardadas em cache público** — `api-rest` e `api-powerbi` marcam as respostas como `public` por 2-5 minutos; a CDN pode devolver a resposta cacheada de um usuário autenticado para um pedido SEM chave nenhuma. Trocar para `private, no-store`. `(api-rest.mjs:28, api-powerbi.mjs:20 · Alto · P)`

**17. Detalhe do contrato devolve a linha inteira do banco** — O endpoint `GET /api/contratos/:id` usa `select('*')` e entrega observações internas, dados bancários e o JSON completo a qualquer integrador. Escolher os campos como a listagem já faz. `(api-rest.mjs:101 · Médio · P)`

**18. Log de auditoria exposto pela API do Power BI** — `table=activity_log` devolve e-mails, IPs e detalhes de login de toda a equipe para quem tiver a chave (que hoje tem default fraco). `(api-powerbi.mjs:130 · Médio · P)`

**19. APIs de integração sem limite de requisições** — Sem rate limit dá para testar chaves em massa ou baixar a base inteira em loop. O limitador já existe no projeto (`rate-limit.mjs`), só não foi ligado nesses dois arquivos. `(api-rest.mjs, api-powerbi.mjs · Médio · P)`

**20. Comparação de senha letra a letra** — As comparações `!==` permitem, em teoria, descobrir a chave medindo tempo de resposta. Usar `crypto.timingSafeEqual`. `(api-powerbi.mjs:30, portal-admin.mjs:63 · Baixo · P)`

**21. Site sem Content-Security-Policy** — Não existe regra dizendo de onde o navegador pode carregar scripts. Se um código malicioso entrar (itens 23-26), nada o impede de mandar os dados dos clientes para fora. Uma CSP bem feita é o "cinto de segurança" que falta. `(public/_headers:36 · Alto · M)`

**22. Cabeçalhos de proteção incompletos** — Falta `frame-ancestors` na CSP (o `X-Frame-Options` é o mecanismo antigo), `preload` no HSTS e regra de no-cache para `/portal.html` (hoje só a home tem). `(public/_headers:38 · Baixo · P)`

**23. Texto do contrato montado sem escapar HTML** — Nome, profissão, endereço e razão social entram direto no HTML em 57 pontos. Um cadastro contendo código (`<script>...`) executa no navegador de quem abrir o contrato — e dados chegam de fora (formulário QR, importação). Criar uma função `esc()` e aplicar em toda interpolação. `(contractHtml.js:49+ · Alto · M)`

**24. Preview do contrato roda sem isolamento** — O iframe do preview (`srcDoc`) roda na mesma origem do sistema; combinado com o item 23, um código escondido num cadastro teria acesso à sessão logada. Adicionar o atributo `sandbox` resolve. `(LivePreview.jsx:248 · Alto · P)`

**25. Gerador de PDF injeta HTML cru na página** — `container.innerHTML = htmlContent` executa qualquer conteúdo ativo embutido no contrato dentro do app. `(pdfGenerator.js:119 · Médio · P)`

**26. Escape do Portal esquece a aspa simples** — O `esc()` do portal converte `& < > "` mas não `'`, e vários atributos usam aspas simples: um dado com apóstrofo escapa do atributo e injeta código na página do cliente. `(portal.html:434 · Médio · P)`

**27. Portal guarda tudo no navegador para sempre** — Token de acesso, processos, boletos e PIX ficam no `localStorage` sem validade e sem limpeza. Em celular emprestado/compartilhado, qualquer pessoa recupera tudo depois. `(portal.html:1522 · Médio · P)`

**28. Cache do service worker sobrevive ao link desativado** — As respostas com dados pessoais ficam no cache do navegador mesmo depois de o token ser revogado no painel. `(public/portal-sw.js:34 · Baixo · P)`

**29. IP e e-mail dos advogados enviados a serviço de terceiro** — A detecção de "login estranho" consulta `ipapi.co` (sem contrato/DPA) a cada login. A Netlify já fornece a geolocalização em cabeçalho, de graça e sem vazar dado. `(AuthContext.jsx:16 · Médio · P)`

**30. Login anômalo avisa… o próprio invasor** — Se alguém entrar de outro país às 3h com a senha certa, o aviso aparece para quem entrou e vai para uma tabela que ninguém lê. Deveria notificar o admin (e-mail/sino) e, idealmente, pedir confirmação extra. `(AuthContext.jsx:22 · Médio · M)`

**31. Primeiro login cria acesso sozinho** — Quem consegue se autenticar no Supabase ganha registro de permissões na hora, sem aprovação. Se o cadastro público estiver habilitado no Auth, isso é uma porta de entrada. Trocar por fluxo de convite/aprovação. `(App.jsx:943 · Médio · P)`

**32. Sem 2º fator, sem trava de tentativas, sem regra de senha** — Só e-mail e senha protegem um sistema com 5.500 CPFs. Ligar MFA (o Supabase Auth já suporta), bloquear após N erros e exigir senha mínima são passos baratos. `(LoginScreen.jsx:19 · Alto · M)`

**33. Proteção contra senha vazada desligada** — O Supabase tem checagem automática contra o banco HaveIBeenPwned (senhas que já vazaram na internet) e ela está desativada. É literalmente 1 clique no painel do Supabase. `(Supabase Auth · Médio · P)`

**34. Sessão guardada onde script consegue ler** — O token de sessão fica no `localStorage`; qualquer código injetado rouba a sessão do advogado. Avaliar cookies httpOnly via `@supabase/ssr`. `(lib/supabase.js:9 · Médio · M)`

**35. Listas com CPF no sessionStorage** — Boletos e Asaas guardam até 3.000 clientes com CPF e valores no navegador para acelerar a tela; em máquina compartilhada, basta abrir o console para copiar. Guardar só o mínimo, criptografar ou não guardar. `(BoletosPanel.jsx:859, AsaasPanel.jsx:938 · Médio · P)`

**36. Rascunho com CPF sobrevive ao logout** — O formulário inteiro fica no `localStorage` e não é apagado quando o usuário sai do sistema. `(ContractContext.jsx:108 · Baixo · P)`

**37. Biblioteca de planilhas com falha grave conhecida** — O `xlsx@0.18.5` tem vulnerabilidades públicas (CVE-2023-30533 e ReDoS) sem correção no npm; a correção exige migrar para o pacote oficial da SheetJS ou trocar de biblioteca. `(package.json:31 · Médio · M)`

**38. URL do Apps Script funciona como chave e está no código** — A URL que dá acesso de escrita ao Drive está copiada em 4 arquivos (e no guia do projeto). Quem a tiver escreve na árvore do Drive. Mover para variável de ambiente e adicionar um segredo compartilhado validado dentro do script. `(save-to-drive*.mjs:13, health.mjs:57, backup-worker-background.mjs:21 · Médio · M)`

**39. Falta da chave de servidor é mascarada em silêncio** — Quando `SUPABASE_SERVICE_ROLE_KEY` não existe, as funções caem na chave pública sem avisar — foi assim que o webhook do ZapSign ficou morto sem ninguém saber. O fallback deveria logar um aviso gritante (ou falhar) em funções críticas. `(_lib/botDb.mjs:8 e 9 arquivos · Médio · M)`

**40. Health público entrega o mapa do sistema** — Sem senha, qualquer um vê quais serviços o escritório usa, quais estão fora e o texto do erro — reconhecimento pronto para um ataque. Resumir a resposta pública (ok/não ok) e detalhar só para logados. `(health.mjs:20 · Baixo · P)`

**41. Rate limit do chat do portal não funciona de verdade** — O contador vive na memória de cada instância da função, então o teto de 40/min quase nunca é atingido. O `portal-data` já usa a versão compartilhada no banco; o chat ficou para trás. `(portal-chat.mjs:22 · Baixo · P)`

**42. Erros devolvem detalhes internos** — O `commission-calculator` retorna as 5 primeiras linhas do stack trace; ~40 endpoints repassam `err.message` cru (nomes de tabela, caminhos). Devolver frase genérica e mandar o detalhe para o log. `(commission-calculator.mjs:588 e ~40 arquivos · Médio · M)`

**43. CORS liberado para o mundo em 46 funções** — Qualquer página da internet pode chamar as funções a partir do navegador de um usuário. A lista de origens autorizadas já existe em `_lib/http.mjs`; falta adotá-la. `(_lib/http.mjs:5 · Médio · M)`

**44. `.gitignore` não protege arquivos .env** — Um `client/.env` com tokens reais seria commitado sem aviso; e o `client/dist/` versionado já carrega o bundle com a chave do item 1 dentro do histórico do Git. `(client/.gitignore · Médio · P)`

## 2. Banco de dados & RLS — 41 itens

**45. `cliente_parcelas` e `cliente_telefones` estão SEM RLS** — As duas tabelas satélites do cadastro único (57 mil parcelas financeiras e 4.920 telefones) ficaram completamente abertas: qualquer pessoa com a chave pública do site (que está no navegador) lê E escreve. A tabela-mãe `clientes` foi trancada por PII; as filhas ficaram de fora. É o achado nº 1 do advisor oficial do Supabase. `(tabelas cliente_parcelas/cliente_telefones · Alto · P)`

**46. `contratos` com policy "Allow all" para anônimo** — A pendência nº 1 do projeto, confirmada pelo advisor: a anon key lê e escreve todos os contratos. O caminho é criar policies por usuário autenticado + service role nas functions. `(tabela contratos · Alto · G)`

**47. `user_permissions` allow-all permite auto-promoção** — Qualquer um com a chave pública pode se marcar `is_admin=true` e liberar todas as abas. Fechar exige coordenação com o app "produtividade" que compartilha a tabela — mas é o furo mais direto do sistema. `(tabela user_permissions · Alto · M)`

**48. Fila do WhatsApp aberta para anônimo** — `kommo_queue` (e `kommo_note_log`) têm policy ALL para anon+authenticated: qualquer pessoa pode INJETAR jobs na fila que o worker drena a cada minuto — ou seja, mandar mensagem de WhatsApp em nome do escritório. `(tabelas kommo_queue/kommo_note_log · Alto · P)`

**49. Mais 6 tabelas sem RLS nenhum** — `kommo_pipelines`, `kommo_lead_status`, `resort_alias`, `bot_processed_messages`, `cron_heartbeat`, `health_history`: menos PII, mas anônimo pode envenenar espelhos, heartbeats e o dicionário de resorts (corrompendo funil, monitor e reconciliação). `(6 tabelas · Médio · P)`

**50. Tabelas de backup da migração soltas na API** — `_backup_meta_leads_20260728_mensal/_diario` estão sem RLS e sem chave primária, expostas na API pública. Validado o fix de 28/07, trancar ou dropar. `(2 tabelas _backup · Médio · P)`

**51. RPCs que anônimo executa SEM nenhum segredo** — `bot_fone_lookup(telefone)`, `bot_processos(nome)`, `bot_lawsuit_resumo(id)` e `fn_capi_emails_alternativos(telefone)` devolvem dados processuais e e-mails de clientes a qualquer chamador da API. `cep_cache_gravar` e `rate_limit_hit` deixam anônimo ESCREVER no cache e manipular o anti-abuso. Exigir o segredo (`p_chave`) como as demais RPCs do app. `(RPCs no banco · Alto · M)`

**52. 99 RPCs poderosas executáveis por QUALQUER usuário logado** — `cliente_dados_bancarios`, `cliente_editar`, `cliente_fundir`, `arquivar_contrato` etc. não checam permissão por dentro: o RBAC de abas só existe na tela, não no banco. Um usuário comum com o console do navegador faz tudo o que o admin faz. `(RPCs cliente_*/arquivar_* · Médio · M)`

**53. 57 tabelas do CBC com policy "sempre verdadeiro"** — RLS ligado mas inútil (USING true), sendo 32 valendo até para anônimo: `bi_*`, `bot_*`, `portal_faq/nps/perguntas/push_subs`, `cobranca_regua`, `inadimplencia_historico` etc. Plano de fechamento por família, começando pelas que têm PII ou disparam ações. `(32+ tabelas · Alto · G)`

**54. 11 views SECURITY DEFINER para auditar** — `vw_funil_*`, `vw_noshow_acervo`, `vw_powerbi_contratos`, `vw_bi_trafego_*` etc. ignoram o RLS de quem consulta (parte é intencional, para o Power BI). O trabalho é revisar os GRANTs view a view — se `anon` tiver SELECT em alguma, é vazamento. `(11 views · Médio · M)`

**55. Tabela de tokens do portal legível por todos** — `cliente_portal_tokens` com RLS `using(true)`: com a chave pública dá para listar nome, CPF e token de TODOS os clientes — e abrir o portal de qualquer um. `(supabase_bot_advbox.sql:310 · Alto · M)`

**56. Links do portal nunca expiram** — Não há coluna de validade: o link enviado por WhatsApp vale para sempre. Criar expiração (ex.: 90 dias, renovável a cada acesso) e revogação em massa. `(cliente_portal_tokens · Alto · M)`

**57. Materialized view exposta na API com grant para anônimo** — `dashboard_stats` (receita do mês, top resorts) tem `GRANT ... TO anon` e ninguém mais a usa na tela. Remover o grant é grátis. `(supabase_p1_scale.sql:210 · Médio · P)`

**58. `dashboard_stats` é recalculada 288×/dia para ninguém** — O pg_cron refaz a MV a cada 5 minutos desde 12/06, quando o Dashboard parou de usá-la. Ou o Dashboard volta a usá-la (resolveria as consultas pesadas) ou o agendamento sai. `(supabase_p1_scale.sql:228 · Médio · P)`

**59. 10 funções sem `search_path` fixado** — `bot_metricas`, `portal_funil`, triggers e helpers de telefone: risco de sombreamento de objetos (padrão de ataque conhecido em Postgres). Fix mecânico de 1 linha por função. `(10 funções · Baixo · P)`

**60. `user_views` avalia 2 policies por SELECT** — Únicas policies permissivas múltiplas do CBC; consolidar em uma com OR. `(tabela user_views · Baixo · P)`

**61. 16 chaves estrangeiras sem índice** — `vendas_comissoes_detalhe`, `vendas_documentos_*`, `portal_access_log`, `user_reminders`, `cliente_parcelas.acao_id` etc. Joins e deletes ficam lentos à medida que crescem. Curioso: `contrato_comentarios.user_id` e `notifications.user_id` ganharam índice em 31/05 e ele sumiu no drop de índices de 10/06 — recriar. `(16 FKs · Médio · P)`

**62. 4 pares de índices duplicados na família ads_** — `ads_attribution` (2 pares), `ads_capi_events`, `ads_settings`: cada escrita atualiza dois índices idênticos. Dropar um de cada par. `(família ads_ · Baixo · P)`

**63. 18 índices nunca usados em 15 tabelas** — Custam espaço e escrita sem retorno. Cuidado: os de tabelas recém-criadas ainda podem passar a ser usados; avaliar caso a caso antes de dropar. `(15 tabelas · Baixo · P)`

**64. Coluna que liga contrato↔processo não tem índice** — `contratos.advbox_lawsuit_id` é filtrada por três rotinas e pela view `vw_processo_distribuido` (com EXISTS correlacionado); sem índice, cada consulta relê a tabela inteira. Melhor custo-benefício da lista de banco. `(tabela contratos · Alto · P)`

**65. Índices "otimizados" do p1_scale provavelmente nunca existiram** — `idx_contratos_cpf1/cpf2/tipo_acao` já existiam em versão simples quando o p1_scale tentou recriar versões parciais com o MESMO nome usando `IF NOT EXISTS` — o comando não deu erro e não fez nada. Conferir no banco e recriar com nomes novos. `(supabase_upgrade.sql:7 vs supabase_p1_scale.sql:44 · Médio · M)`

**66. Índice sobre coluna vazia** — `idx_contratos_origem` indexa `contratos.origem_cliente`, mas o dado real vive em `dados->>'origemCliente'`. Ou se preenche a coluna (backfill) ou se troca por índice de expressão sobre o JSON. `(supabase_p1_scale.sql:84 · Médio · M)`

**67. CPF gravado em dois formatos quebra a detecção de duplicata** — A tela grava `433.501.258-67`, a API grava só dígitos, e a checagem compara com dígitos — o aviso "já existe contrato para este CPF" pode nunca disparar. Uma coluna gerada `cpf_num` (só dígitos, indexada) resolve duplicata, busca e cruzamento com Asaas de uma vez. `(duplicateDetector.js:25, api-rest.mjs:80 · Alto · M)`

**68. Busca global varre a tabela inteira a cada tecla** — O `ilike` em nome tem índice trigram, mas resort e CPF não — e a busca dispara a cada 200 ms de digitação. Índices trigram nas outras colunas (ou busca só na coluna certa conforme o formato digitado). `(GlobalSearch.jsx:115 · Médio · M)`

**69. View do funil refaz junção cara a cada abertura de tela** — `vw_processo_distribuido` cruza `bi_processos` com `contratos` via EXISTS sem índice de apoio (item 64). Com o índice, o custo cai de segundos para milissegundos. `(supabase_bi_views_base.sql:315 · Alto · M)`

**70. View de no-show recalculada do zero a cada consulta** — `vw_noshow_acervo` abre o JSON de contratantes de todos os contratos, aplica regex de telefone e 4 EXISTS a cada SELECT — para um dado que muda 1× por dia. Virar materialized view atualizada pelo mesmo cron da agenda. `(supabase_noshow_acervo.sql:17 · Médio · M)`

**71. Definição antiga de view versionada em 2 arquivos** — `vw_funil_videochamadas` tem a versão obsoleta (sem precedência do Meet) em `supabase_bi_views_base.sql` e a atual em `supabase_meet_auditoria.sql`. Quem restaurar pelo arquivo errado muda a régua de comparecimento sem perceber. Marcar a antiga como superada. `(2 arquivos .sql · Médio · P)`

**72. 5 views usadas pelo app não têm arquivo .sql** — `vw_cliente_canonico`, `vw_cliente_360_full`, `vw_boletos_devedores`, `vw_advbox_correcoes_pendentes`, `vw_automacoes_dead_letter` existem só no banco. Se o projeto precisar ser recriado (quase aconteceu em 17/07), essas telas voltam quebradas sem o SQL. `(banco · Alto · M)`

**73. Migrações aplicadas via MCP sem arquivo versionado** — A trava anti-NF-duplicada (`asaas_nf_claim/_release`) e a correção do histórico Meta existem só no banco; sem arquivo, não podem ser recriadas nem auditadas. Exportar e commitar. `(migrações asaas_nf_lock, meta_leads_* · Alto · M)`

**74. Tabelas centrais sem DDL versionada** — `clientes`, `kommo_queue`, `cron_heartbeat`, `advbox_api_log`, `agenda_videochamadas`, `notifications` e outras não aparecem em nenhum CREATE TABLE do repositório. Um dump só do schema, commitado periodicamente, elimina o risco e vira documentação. `(banco · Alto · G)`

**75. Dois sistemas de migração convivendo** — 33 arquivos `supabase_*.sql` soltos na raiz + pasta `supabase/migrations/` numerada, sem lista única do que já foi aplicado. Consolidar em uma convenção (a numerada) e registrar o que está no banco. `(raiz do repo · Médio · M)`

**76. Duas funções `cleanup_old_logs` diferentes** — Uma sem argumento (p1_scale) e uma com `retention_days` (migração 0004). Se ambas existirem, a chamada agendada fica ambígua e a limpeza noturna passa a falhar em silêncio. `(2 arquivos .sql · Médio · P)`

**77. Tabelas de log crescem para sempre** — A limpeza diária só cobre 3 tabelas; ficam de fora justamente as que mais crescem: `advbox_api_log`, `asaas_error_log`, `kommo_queue` (jobs concluídos nunca saem), `health_history` (~8,6 mil linhas/mês), `bot_messages`, `kommo_note_log`. Ampliar a rotina de retenção. `(supabase_p1_scale.sql:245 · Alto · M)`

**78. Contadores de rate limit acumulam para sempre** — O DELETE de limpeza está escrito… num comentário da migração. Cada IP×janela vira linha permanente. Criar o job de limpeza. `(supabase_rate_limit.sql:47 · Médio · P)`

**79. Backup diário não cobre tudo que é insubstituível** — A whitelist de 51 tabelas congelou em 17/07: ficaram de fora `client_forms` (formulário preenchido pelo cliente!), `kommo_note_log`, `action_log` e as tabelas criadas depois (auditoria do Meet, acervo no-show, pontualidade, SLA). Perdeu o banco, perdeu esses dados. `(supabase_backup_drive.sql:20 · Alto · P)`

**80. Realtime empurra a linha inteira 4 vezes** — Quatro canais na mesma tabela `contratos` (App, Dashboard, ContratosTab, AsaasPanel) recebem cada UPDATE com as 73 colunas + JSONB `dados` — dezenas de vezes por hora, por navegador aberto. Restringir as colunas da publicação e/ou consolidar canais. `(4 componentes · Médio · M)`

**81. Campos do JSONB que mereciam coluna própria** — `dados->>'origemCliente'`, `dados->>'dataPrimeiraMensagem'` e `dados->'contratantes'` aparecem em 17 consultas abrindo o JSON em tempo real. Colunas geradas (STORED) com índice viram filtro barato. `(tabela contratos · Médio · M)`

**82. Tabelas mortas ocupando o schema** — `user_profiles`, `contratos_versoes`, `audit_log`, `webhook_configs`, `clausulas_biblioteca`, `contratos_ativos` não aparecem em nenhuma consulta do app. `user_profiles` ainda tem policy que consulta a própria tabela (padrão que causa recursão). Confirmar com os outros apps e remover. `(banco · Baixo · M)`

**83. Extensões instaladas no schema public** — `pg_trgm`, `pg_net`, `unaccent` deveriam morar em schema próprio (recomendação do advisor). `(banco · Baixo · P)`

**84. Conexões do Auth fixadas em número absoluto** — O Auth está com 10 conexões fixas; trocar para alocação percentual antes de qualquer upgrade de instância, senão o upgrade não melhora o Auth. `(config do projeto Supabase · Baixo · P)`

**85. Promover o helper de paginação a padrão do projeto** — O `fetchAllPaged()` do funil resolve o teto de 1.000 do jeito certo (com ordem total), mas está preso no módulo; Tráfego, Negativação e Boletos reimplementaram cada um o seu laço. Mover para `utils/supabasePaged.js` e usar em toda consulta que pode passar de 1.000. `(funilSources.js:26 · Médio · M)`
## 3. Backend (Netlify Functions) — 24 itens

**86. Webhook do ZapSign está morto desde sempre** — Ele exige a `SUPABASE_SERVICE_ROLE_KEY` (que nunca foi configurada) sem cair para a chave comum: toda notificação de assinatura recebe erro 500 e é descartada. Na prática a "atualização em tempo real" de assinatura NÃO existe — tudo depende do polling de 5 min com o app aberto. O conserto é o mesmo já aplicado no reminder-cron: usar o `db` do botDb. `(zapsign-webhook.mjs:14 · Alto · P)`

**87. Chat do portal, NFS-e e link do Kommo na mesma situação** — `portal-chat`, `portal-nfse` e `kommo-portal-link` também exigem a env ausente e respondem erro/`config` — três funcionalidades que provavelmente nunca funcionaram em produção. `(portal-chat.mjs:51, portal-nfse.mjs:41, kommo-portal-link.mjs:56 · Alto · P)`

**88. `/stats` das APIs agrega sobre fatia de 1.000 contratos** — `api-rest` e `api-powerbi` somam receita e contam status baixando a tabela sem paginar (o banco corta em 1.000). Quando a base crescer, o Power BI publica totais menores que a realidade. Agregar no banco (view/RPC). `(api-rest.mjs:151, api-powerbi.mjs:86 · Alto · M)`

**89. Régua de cobrança monta o mapa de leads truncado — e dentro do loop** — O mapa CPF→lead corta em 1.000 (clientes de fora viram "sem lead" e não recebem nota) e a MESMA consulta é refeita a cada etapa da régua (D+1, D+7, D+15). `(cobranca-regua.mjs:78 · Alto · P)`

**90. Mapa processo→lead do bot também corta em 1.000** — `getLawsuitLeadMap()` lê os contratos com processo sem paginar; passando de 1.000, os contratos mais novos param de receber nota automática no Kommo, sem erro nem log. `(_lib/botDb.mjs:287 · Alto · P)`

**91. Sincronização de clientes Asaas vai estourar o tempo** — O cron das 6h percorre até 200 páginas de 100 clientes em série dentro de uma function comum (teto ~26s). Virar despachante + worker background, como já foi feito para os boletos. `(asaas-sync-customers.mjs:42 · Alto · M)`

**92. DataJud: 500 contratos em fila indiana, sem cursor e fora do throttle** — Cada contrato faz 1-3 consultas externas em série no teto de 26s — a rodada morre no meio, sempre nos mesmos primeiros registros, e ainda atropela o limite de requisições do ADVBOX (derruba bot e monitor juntos). Virar worker background com marcador de onde parou e passar pelas mesmas travas de ritmo do `_lib/advbox.mjs`. `(datajud-refresh.mjs:92-249 · Alto · M)`

**93. Varredura de assinados sem orçamento de tempo** — O `advbox-sweep-cron` percorre todos os pendentes chamando o sync sem prazo máximo; com fila acumulada é morto no meio e contratos ficam presos "processando". Parar aos ~20s e continuar na próxima rodada + timeout por chamada. `(advbox-sweep-cron.mjs:43 · Médio · M)`

**94. Checagem de nota duplicada pode ler 40 páginas do Kommo** — Antes de postar, o código pode percorrer até 10 mil notas do lead, sem prazo e sem tratar bloqueio 429 — sozinho já estoura o tempo da função. Um backfill do `kommo_note_log` para os leads antigos elimina essas varreduras. `(kommo-note.mjs:61 · Médio · P)`

**95. Robô do ADVBOX se declara vivo antes de rodar** — O heartbeat é gravado no DESPACHANTE, logo após disparar o worker: se o worker morrer, o painel continua verde. É exatamente o padrão que escondeu uma falha em julho (documentado no próprio código do Asaas). Mover o heartbeat para dentro do worker. `(advbox-monitor.mjs:21 · Alto · P)`

**96. Backup diário disparado sem confirmação** — A chamada ao worker de backup não é aguardada (`await`); a função responde e encerra, e o pedido pode ser descartado antes de sair. Sendo o ÚNICO backup do banco, merece await + registro de "despachado". `(backup-diario.mjs:26 · Alto · P)`

**97. Falhas de lembrete morrem no console** — Quando um lembrete falha, o erro só vai para o console da Netlify e o heartbeat grava "tudo certo". Trocar por `logAdvbox` + heartbeat com falha para aparecer no Monitor. `(reminder-cron.mjs:78 · Médio · P)`

**98. Health e proxy ZapSign existem em duas cópias idênticas** — `health.ts` é cópia linha a linha de `health.mjs`, e `zapsign-proxy.ts` de `zapsign-proxy.mjs` — toda correção precisa ser feita duas vezes (a nota no arquivo diz "manter em sincronia"). Decidir qual fica e apagar a outra. `(edge-functions/health.ts:57 · Médio · M)`

**99. Conciliação de cobrança copiada em dois arquivos** — `cobranca-conciliar.mjs` (cron) e `cobranca-conciliar-now.mjs` (botão) têm ~20 linhas idênticas. A lógica deve morar em `_lib/cobranca.mjs` e os dois só chamarem. `(cobranca-conciliar-now.mjs:21 · Médio · P)`

**100. Escrita no ADVBOX usa fetch cru, sem retry nem throttle** — A biblioteca `_lib/advbox.mjs` tem controle de ritmo, retry e disjuntor — mas só para LEITURA. A criação de cliente e processo (o caminho mais crítico, pós-assinatura) usa fetch sem nada disso: um soluço de 1 minuto do ADVBOX vira falha da rodada. `(advbox-sync.mjs:176,274 · Alto · M)`

**101. Extração do ID da pasta do Drive copiada em 3 arquivos** — O próprio comentário avisa "DUPLICADO — manter em sincronia". Foi esse tipo de cópia divergente que causou o bug do mapa do ADVBOX. Unificar em `_lib/`. `(save-to-drive-direct.mjs:25 · Baixo · P)`

**102. Duas buscas de cliente quase iguais no mesmo arquivo** — `findCustomerByCPF` e `findCustomerByIdentification` fazem a mesma coisa; uma pode ser apagada. `(advbox-sync.mjs:91,111 · Baixo · P)`

**103. Rate limit caseiro copiado em três portais** — O mesmo bloco de 15 linhas em `portal-pergunta`, `portal-feedback` e `portal-chat`, sendo que o `rate-limit.mjs` já oferece a versão compartilhada usada pelo `portal-data`. `(portal-pergunta.mjs:18 · Baixo · P)`

**104. Busca pesada de lead por CPF duplicada em dois portais** — `portal-pergunta` e `portal-feedback` têm o mesmo bloco que baixa TODOS os contratos para achar o lead (com o mesmo corte de 1.000). Virar helper único com consulta filtrada por CPF. `(portal-pergunta.mjs:69, portal-feedback.mjs:81 · Médio · M)`

**105. Job travado volta para a fila com contador zerado** — Ao reivindicar/recuperar jobs, a fila do Kommo grava `attempts: 0` — o limite de 6 tentativas nunca é atingido nesse caminho e um job venenoso pode circular PARA SEMPRE sem virar `failed` nem gerar alerta. `(_lib/kommoQueue.mjs:45,85 · Médio · P)`

**106. Gravação de status pode se sobrescrever** — `setBackfillStatus` lê, mescla e regrava; se o worker e o watchdog gravarem ao mesmo tempo, um apaga o outro e o "onde parei" volta atrás. Mesmo padrão no sync de boletos. `(_lib/botDb.mjs:257 · Médio · M)`

**107. Contagem diária de mensagens do Kommo para em 1.000 sem avisar** — O laço para na página 4 em silêncio; em dia movimentado o número gravado fica menor que a realidade. Registrar o corte ou paginar até o fim. `(cobranca-regua.mjs:51 · Médio · P)`

**108. Sync de leads se auto-encadeia sem teto de saltos** — Cada rodada chama a si mesma para a próxima página sem aguardar nem contar saltos: se a chamada se perder, para no meio sem aviso; se o critério de fim falhar, roda sem parar. `(kommo-leads-sync.mjs:107 · Médio · P)`

**109. Miudezas de higiene do backend** — Função morta `advbox-birthdate-check` (excluir pelo painel Netlify, como explica o LEIA-ME); `setInterval` no nível do módulo em 4 funções (segura o processo à toa em serverless); renovação do token Google sem timeout e com erro despejando a resposta inteira; regra `/api/*` deveria devolver 404 quando a edge function falha (hoje volta o HTML do site com status 200, confundindo o app); tabela de crons do guia diverge do código em 3 pontos. `(vários arquivos · Baixo · P)`

## 4. Integrações externas — 30 itens

**110. Documento apagado/expirado no ZapSign trava o contrato para sempre** — Eventos `doc_deleted`/`doc_expired` fazem o webhook responder 502 sem mudar nada: o contrato fica em "aguardando assinatura" eternamente, e o ZapSign pode desativar o webhook por excesso de erro. Tratar esses eventos marcando o contrato. `(zapsign-webhook.mjs:93 · Médio · P)`

**111. Ninguém confere ZapSign × banco periodicamente** — Não há varredura que compare a lista de documentos do ZapSign com os contratos daqui: um documento criado lá e não gravado aqui (ou vice-versa) fica invisível até alguém reclamar. `(integração ZapSign · Médio · M)`

**112. Checagem "abriu e não assinou" faz até 300 chamadas a cada 30 min** — Uma chamada por contrato pendente, sem throttle nem cache do último `times_viewed`. Guardar o último valor e só consultar os que mudaram de status recentemente. `(kommo-view-check.mjs:32 · Médio · M)`

**113. Recursos do ZapSign desperdiçados: prazo, lembrete e motivo de recusa** — O documento é criado sem data-limite e sem lembrete automático do próprio ZapSign (a cobrança de quem não assina é 100% manual), e o motivo da recusa é ignorado (o contrato só vira "cancelado", sem o porquê). `(zapsignService.js:19 · Médio · M)`

**114. PDF assinado não tem cópia própria** — O documento assinado existe só no ZapSign e no Drive. Se o upload esgotar as 3 tentativas ou a conta ZapSign mudar, o escritório depende de terceiros para o documento mais importante do fluxo. Guardar cópia no Supabase Storage. `(save-to-drive.mjs:204 · Médio · M)`

**115. Throttle do ADVBOX é por instância, não global** — O contador de 15 req/min vive na memória de cada invocação; monitor, snapshot, backfill e bot rodando juntos somam muito mais. Um contador compartilhado no banco tornaria o limite real. `(_lib/advbox.mjs:18 · Alto · M)`

**116. Cota diária de escrita do ADVBOX não é contabilizada** — O limite de 500 POSTs/dia por rota está documentado, mas nada conta quantos já foram; num mutirão de contratos o cadastro começa a falhar sem aviso prévio. `(docs/ADVBOX_API_REFERENCIA.md:5 · Médio · M)`

**117. Mapa de vendedores → ADVBOX escrito à mão** — Quem não está no `USER_MAP` cai silenciosamente no responsável padrão (Paulo). Vendedor novo = processos atribuídos errado sem alerta. Mover para tabela editável + avisar quando não encontrar. `(advbox-sync.mjs:201 · Médio · P)`

**118. Clientes órfãos no ADVBOX não são detectados** — Quando parte dos contratantes é criada e o processo falha, o cliente fica lá sem processo vinculado, invisível. Uma varredura periódica listaria os casos para conserto. `(advbox-sync.mjs:369 · Médio · M)`

**119. Dados do ADVBOX pagos e não usados** — Aniversários (`/customers/birthdays`), receitas/despesas reais por processo (`/transactions`) e intimações estão mapeados na documentação como "não usamos". São relacionamento e margem que hoje não chegam a lugar nenhum. `(docs/ADVBOX_API_REFERENCIA.md:33 · Médio · M)`

**120. Contrato assinado sem cobrança lançada não dispara alerta** — O boleto só nasce quando alguém abre a aba Asaas e clica. Não existe rotina "assinado há X dias + honorários iniciais > 0 + sem cobrança". O contrato pode ficar semanas sem cobrança e ninguém nota. `(AsaasPanel.jsx:101 · Alto · M)`

**121. Webhook Asaas engole evento quando o banco está fora** — Responde 200 mesmo falhando (o Asaas não retenta) e não guarda o evento bruto. No incidente de 17/07 qualquer pagamento notificado na janela teria sumido. Gravar todos os eventos numa tabela e reprocessar os falhos. `(asaas-webhook.mjs:198 · Alto · M)`

**122. Evento atrasado pode "despagar" um boleto** — O status do webhook é gravado sem comparar com o atual: um `OVERDUE` que chega depois do `RECEIVED` volta o boleto para vencido, contaminando inadimplência e régua. Aplicar precedência de status. `(asaas-webhook.mjs:25,86 · Médio · P)`

**123. Webhook Asaas trabalha demais antes de responder** — 4 chamadas encadeadas ao Asaas + 1 ao Kommo dentro da resposta; se estourar o tempo, o Asaas PAUSA a fila de webhooks — e nada monitora essa pausa. Responder rápido e processar depois. `(asaas-webhook.mjs:120 · Médio · M)`

**124. Sem ambiente de testes do Asaas** — A URL de produção está fixa; testar régua, NF ou negativação significa mexer em cliente real. Criar env para o sandbox oficial. `(asaas-sync.mjs:9 · Médio · M)`

**125. Recursos do Asaas na mesa** — Antecipação de recebíveis, split de pagamento (comissão do vendedor direto na cobrança), recorrência/cartão e notificações configuráveis por cobrança não são usados. `(integração Asaas · Médio · G)`

**126. Disparo do link de assinatura depende da aba aberta** — A chamada é "atira e esquece" do navegador: se a aba fechar ou a rede cair, o link não é enviado e nem a nota de aviso é postada. Um cron que pega `enviado_zapsign` sem `kommo_assinatura` após alguns minutos fecha o buraco. `(App.jsx:1646 · Alto · M)`

**127. Erro passageiro consome o disparo único da assinatura** — O lock é gravado antes das chamadas; um 500 momentâneo na checagem da janela grava `erro` e o contrato nunca mais é tentado. Erro de infraestrutura deveria liberar o lock (diferente de "fora da janela", que é decisão). `(kommo-assinatura-send.mjs:110 · Médio · P)`

**128. Tokens sem vigilância proativa** — Kommo (long-lived), Meta (system user) e Google (refresh token que JÁ expirou uma vez em silêncio) só avisam quando quebram. Uma checagem diária/semanal (`/account`, `/debug_token`, refresh de teste) com alerta "vai vencer / inválido" evita descobrir pela tela vazia. `(_lib/kommo.mjs:9, meta-ads-sync.mjs:21, _lib/googleAgenda.mjs:17 · Alto · M)`

**129. Espelho do Kommo não traz a origem do lead** — `kommo_leads` guarda telefone/pipeline/status, mas nenhum campo custom (UTM/origem), tag, motivo de perda, valor ou data de fechamento. Sem isso a atribuição anúncio→lead→contrato continua impossível (pendência #92). `(kommo-leads-sync.mjs:77 · Alto · M)`

**130. Webhook do Kommo sem deduplicação** — Além do segredo não configurado (item 10), o mesmo evento reenviado dispara duas respostas do bot ao cliente. Guardar o ID do evento processado. `(kommo-advbox-webhook.mjs:22 · Médio · P)`

**131. Lead que não moveu de etapa nunca é reconciliado** — Se o job de mover o lead esgota as tentativas, vira `failed` e fica só no log. Nada compara depois "contrato assinado × lead na etapa ADVBOX" para consertar. `(advbox-sync.mjs:405 · Médio · M)`

**132. Sinais de cota da Meta ignorados** — O código só reage ao 429 depois de bloqueado; os cabeçalhos `X-Business-Use-Case-Usage` dizem o percentual consumido e permitiriam frear antes. `(meta-ads-sync.mjs:30 · Médio · P)`

**133. Segunda conta de anúncios fora do espelho** — O código aceita várias contas (`META_AD_ACCOUNT_IDS`), mas só uma está configurada. Campanha na outra conta = gasto fora do CPL e do funil, sem aviso. Configurar a segunda (ou alertar se ela gastar). `(_lib/metaTrafego.mjs:15 · Médio · P)`

**134. Upload no Drive só acontece com o app aberto** — O ADVBOX ganhou backstop no servidor (sweep-cron), mas o Drive continua exclusivamente no polling do navegador: contrato assinado sexta à noite só é arquivado quando alguém loga na segunda. Criar o mesmo backstop server-side. `(App.jsx:806 · Alto · M)`

**135. Chamadas ao Apps Script e download do PDF sem timeout** — Se o Google pendurar, a function morre no teto e o contrato fica com lock de `uploading`. Adicionar `AbortSignal.timeout` nas 3 chamadas. `(save-to-drive.mjs:117,129,204 · Médio · P)`

**136. Health check gasta o Apps Script de verdade** — Cada checagem dispara um POST real no script (que tem cota diária de execuções). Trocar por ping leve. `(health.mjs:56 · Baixo · P)`

**137. Agenda Google: só a cor do evento é lida** — O `responseStatus` dos convidados (aceitou/recusou), remarcações e alterações são ignorados — justamente os sinais que antecipariam no-show. E a leitura é por varredura de 45 min em vez do canal de push do Calendar. `(_lib/googleAgenda.mjs:51 · Médio · M)`

**138. Crédito da API de CPF acaba em silêncio** — Sem saldo, a função devolve vazio como se o CPF não tivesse dado; o formulário para de preencher sozinho e ninguém liga o alerta. Detectar o erro de saldo (código 1001) e avisar no sino/e-mail. `(cpf-lookup.mjs:50 · Médio · P)`

**139. ViaCEP e BrasilAPI sem timeout, fallback nem monitoramento** — As consultas rodam no navegador e falham devolvendo null; a BrasilAPI (CNPJ) nem aparece no health check nem na documentação de integrações. `(apiLookup.js:13 · Médio · P)`

**140. Não existe inventário de limites e custos por integração** — Documentos/mês do plano ZapSign, taxa por boleto e NF, requisições/s do Kommo, cotas do Apps Script, R$ 0,25 por CPF… nada disso está mapeado num lugar só. Sem isso não dá para prever quando uma integração bate no teto nem quanto custa cada contrato. `(docs/ · Médio · M)`

## 5. Operação, monitoramento e backup — 28 itens

**141. Metade dos robôs bate ponto no vazio** — 25 jobs gravam heartbeat, mas o vigia (`monitor-watchdog`) só conhece 12-13: `backup-diario`, `meta-ads-sync`, `meta-trafego-sync`, `kommo-asaas-sync`, `agenda-videochamadas-sync`, `advbox-vendas-sync`, `meet-auditoria-sync`, `cobranca-conciliar`, `clientes-reconciliar`, `kommo-view-check` e outros ficam SEM vigilância. Se o backup parar numa sexta, ninguém fica sabendo — igual aos crons mortos de julho. `(monitor-watchdog.mjs:14-34 · Alto · P)`

**142. Cron fora da lista nem gera alerta quando FALHA** — O `if (!sla) continue` pula o job antes de checar `ok === false`: um cron que roda todo dia e falha todo dia fica verde no e-mail. Inverter a ordem das checagens. `(monitor-watchdog.mjs:80 · Alto · P)`

**143. Cron que NUNCA rodou é invisível** — O heartbeat só ganha linha quando a função executa; um cron novo que nunca disparou (ou que o Netlify parou de agendar após um deploy) simplesmente não existe para o monitor. Precisa de uma lista DECLARATIVA de jobs esperados comparada contra quem bateu ponto. `(_lib/botDb.mjs:302 · Alto · M)`

**144. 6 funções agendadas sem heartbeat nenhum** — `kommo-sla-sync` (30 em 30 min), `kommo-leads-sync`, `bot-rotina-semanal`, `meta-trafego-weekly`, `advbox-backfill-watchdog`, `keep-warm`. Se morrerem, a descoberta é semanas depois, por um número esquisito. `(6 arquivos · Alto · P)`

**145. Painel de robôs usa prazo único de 90 min para todos** — Cron diário fica "vermelho" 22 horas por dia, então o painel vive em ATENÇÃO e você para de olhar — o efeito que escondeu os crons mortos. O prazo deve vir do mesmo mapa de SLA do watchdog. `(MonitorAdvbox.jsx:73 · Médio · P)`

**146. O vigia vigia a si mesmo** — Se o agendador da Netlify parar, o watchdog para junto e o silêncio parece paz. Um dead-man switch externo (healthchecks.io/Cronitor, grátis) avisa quando o ping deixa de chegar. `(monitor-watchdog.mjs:176 · Alto · P)`

**147. Três crons com erro crônico treinam você a ignorar alertas** — `db-backup-cron`, `advbox-sweep-cron` e `bandwidth-check-cron` registram "sem service role/sem token" todo dia. Ou configura as envs, ou desliga o agendamento — erro esperado no canal de alerta é o que faz o alerta real passar batido. `(3 arquivos · Médio · P)`

**148. Crons do próprio banco (pg_cron) fora de qualquer painel** — `refresh-dashboard-stats` (5 em 5 min) e `cleanup-old-logs` (diário) vivem no Postgres e não aparecem em lugar nenhum. Se pararem, MV velha e logs crescendo — sem aviso. `(supabase_p1_scale.sql:235 · Médio · M)`

**149. Webhooks sem registro de "último evento recebido"** — Se o ZapSign/Asaas parar de chamar (URL trocada, segredo mudado), o sintoma é indistinguível de um dia fraco. Gravar heartbeat a cada evento e alertar quando não chega nada em X horas úteis. `(3 webhooks · Alto · P)`

**150. E-mail crítico pode estar desligado sem você saber** — Sem `RESEND_API_KEY`, o `sendCriticalAlert` vira não-faz-nada silencioso e sobra só o sino (que exige o app aberto). Confirmar a env e criar um botão "disparar alerta de teste" no Monitor. `(_lib/alertEmail.mjs:10 · Alto · P)`

**151. Throttle de alerta é marcado antes de saber se o e-mail saiu** — Se o Resend falhar, você perde o alerta E fica 2 horas em silêncio forçado. Gravar o estado só após o envio confirmado. `(monitor-watchdog.mjs:162 · Médio · P)`

**152. Janela de silêncio de 2h engole o segundo problema** — O throttle é global: ADVBOX cai às 9h, backup falha às 9h30 → o segundo aviso some. Throttle por tipo de problema. `(monitor-watchdog.mjs:149 · Médio · P)`

**153. Canal de alerta único e sem escalonamento** — Tudo vai para um e-mail. Sábado à noite ninguém lê e-mail: um 2º canal push (WhatsApp via Kommo, Telegram) só para os 3-4 alertas críticos muda o tempo de descoberta de dias para minutos. `(_lib/alertEmail.mjs:11 · Alto · M)`

**154. Falta o "resumo verde" diário** — Hoje "não recebi e-mail" significa tudo certo OU o alerta morreu. Um e-mail diário curto ("18 robôs em dia · backup ok · fila 0") transforma silêncio em sinal — teria pego os crons mortos na primeira semana. `(novo cron · Alto · M)`

**155. Zero Sentry nas 78 functions** — O Sentry só existe no frontend. Erro em `advbox-sync`, `save-to-drive` ou `asaas-webhook` vai para o log da Netlify (que expira) ou depende de alguém ter chamado `logAdvbox`. Um wrapper `withSentry()` nas ~15 funções que mexem em dinheiro/contrato paga o esforço sozinho. `(netlify/functions/ · Alto · M)`

**156. Sem source maps, o Sentry mostra erro ilegível** — Tela branca chega como `a.b is not a function` em chunk minificado. Gerar sourcemap "hidden" no build e enviar no deploy. `(vite.config.js:27 · Médio · P)`

**157. Release do Sentry não bate com o deploy** — O build já injeta `__BUILD_SHA__`, mas o Sentry usa `unknown`. Com o SHA como release, dá para dizer "esse erro nasceu no deploy de ontem" — a pergunta nº 1 de todo incidente. `(src/main.jsx:18 · Médio · P)`

**158. Sem painel único de logs** — Para entender um incidente você abre 3 telas (`advbox_api_log`, `asaas_error_log`+`automation_log`, `activity_log`) e nenhuma mostra `kommo_note_log`. Uma view `vw_eventos_sistema` (UNION padronizado) e um console único com filtros dá a linha do tempo real. `(Monitor · Médio · M)`

**159. Logs da Netlify sem retenção própria** — O `console.log` das functions só existe no painel da Netlify, com retenção curta: investigação de 3 semanas atrás não tem o que ler. Configurar log drain ou gravar resumos estruturados no banco. `(Netlify · Médio · M)`

**160. Backup nunca foi restaurado nem uma vez** — Backup não testado é esperança, não backup. Ensaio trimestral: baixar o `.json.gz` do Drive, subir num projeto de teste, conferir contagens — e documentar como `docs/RESTORE.md` com os comandos exatos. `(backup-worker-background.mjs · Alto · M)`

**161. Nenhum alarme para "tabela nova fora do backup"** — Toda tabela criada de agora em diante repete o problema da whitelist congelada (item 79). O worker pode listar as tabelas do schema e avisar: "3 tabelas novas não estão na whitelist". `(backup-worker-background.mjs · Alto · P)`

**162. Ninguém confere se o arquivo do backup chegou no Drive** — O heartbeat diz "subi", mas ninguém lê a pasta. Um check semanal que lista a pasta e compara data/tamanho fecha o ciclo — e de quebra implementa a retenção (hoje a pasta cresce para sempre). `(backup-worker-background.mjs:158 · Alto · M)`

**163. Código de produção fora do GitHub** — O deploy mais recente saiu de branch de feature com arquivos nem sequer rastreados (ex.: `_lib/kommoText.mjs`) e o GitHub está dias atrás. Se o disco morrer, produção não pode ser reconstruída — é a família do incidente de 02/07. `git push` diário (ou hook no deploy.sh) + voltar o `main` a ser o espelho de produção. `(repositório · Alto · P)`

**164. Rede de segurança local (backups/, 191 MB) só existe no seu Mac** — Todos os snapshots de rollback estão fora do git. Um `.tar.gz` mensal dessa pasta no mesmo Drive do backup do banco custa 10 minutos. `(backups/ · Alto · P)`

**165. deploy.sh não impede as causas do incidente de 02/07** — As travas atuais são só de conteúdo; nada impede deployar de branch errado, com árvore suja ou sem push. Adicionar: `git status --porcelain` vazio, branch = main (ou flag explícita) e push antes do build. Também vale: rodar a suíte de testes e o `node --check` das functions antes de subir. `(deploy.sh:31 · Alto · P)`

**166. Smoke test aprova desastre e reprova deploy bom** — O `case` aceita 404 como sucesso (se a edge function sumir, passa!), e o `/api/health` devolve 503 quando uma integração EXTERNA degrada — o auto-rollback reverteria um deploy perfeito. Separar `/api/ready` (só o app) para o smoke e testar 3-4 funções críticas reais com curl. `(deploy.sh:118-135 · Alto · P)`

**167. Inventário de variáveis de ambiente não existe** — O `.env.example` só tem AWS do servidor aposentado; são ~45 envs reais entre client e functions. Uma env apagada por engano quebra em silêncio. Versionar a lista de nomes obrigatórios e comparar com `netlify env:list` no deploy. `(.env.example · Alto · M)`

**168. Operação: pacote de melhorias menores** — Expor `/api/version` (SHA+data+branch) e gravar histórico de deploys; avisar se um worker background está no meio de execução na hora do deploy (deploy mata worker); monitor externo de uptime (UptimeRobot grátis, 3 checks — desenho pronto); ligar o token do `bandwidth-check-cron` e somar invocações+storage no resumo semanal; painel "Alertas de Capacidade" hoje não mede capacidade nenhuma (ligar em dados reais ou renomear); botões "tentar de novo"/"descartar" para jobs `failed` da fila Kommo; `.last-working-deploy` guardar os 3 últimos IDs com resultado do smoke; runbooks defasados (SMOKE_CHECKLIST ainda manda testar o wizard e a aba Leads, que não existem; faltam runbooks de cron parado, restore, Kommo fora, token expirado; o INCIDENTS.md citado no RUNBOOK nunca foi criado). `(vários · Médio · M)`
## 6. Performance — 24 itens

**169. Sentry e Heroicons caem no pacote crítico por engano** — A regra de divisão de pacotes testa `id.includes('/react/')`, que casa com `@sentry/react` e `@heroicons/react`: os dois entram no chunk que TODO usuário baixa antes de ver a tela (o `vendor-sentry` planejado nunca existiu). Corrigir a ordem/regex tira ~40-60 KB comprimidos do carregamento inicial. `(vite.config.js:46-64 · Alto · P)`

**170. Formulário grava no navegador a cada tecla** — Cada letra digitada serializa o contrato inteiro (com cláusulas) e grava no localStorage, ainda relendo o token de sessão junto. Um atraso de 500 ms (debounce) deixa o formulário visivelmente mais fluido em máquina fraca e iPad. `(ContractContext.jsx:106 · Alto · P)`

**171. Tempo real do Supabase sem filtro no servidor** — O App só se interessa por contratos assinados, mas assina TODO update da tabela e descarta o resto no navegador; o Dashboard idem. Filtrar no servidor (`filter: 'status=eq.assinado'`) e reduzir as colunas publicadas corta o maior consumo silencioso de banda do Supabase. `(App.jsx:541, Dashboard.jsx:285 · Alto · M)`

**172. Minhas Vendas baixa o contrato inteiro de todos, a cada 60 segundos** — É o único painel que ainda pede o JSONB `dados` completo (Dashboard e Contratos foram corrigidos em 31/05), e repete a consulta pesada a cada minuto de aba aberta. JSON-path + intervalo maior = muitos MB a menos por dia. `(VendasPanel.jsx:288-291,410 · Alto · M)`

**173. Asaas baixa `dados` completo e ainda o grava no navegador** — O painel traz o JSON inteiro dos assinados só para ler os honorários, e serializa a lista toda no sessionStorage (algo que o BoletosPanel já deixou de fazer por travar a tela). `(AsaasPanel.jsx:929,938 · Alto · M)`

**174. Asaas refaz a consulta pesada a cada alt-tab** — Voltar do Kommo para o app = consulta completa de novo. Um "só se passaram X minutos" resolve. `(AsaasPanel.jsx:949 · Médio · P)`

**175. Boletos: 11 mil linhas baixadas em série para virar meia dúzia de somas** — A aba pagina ~11 mil boletos um bloco após o outro (12+ idas ao banco enfileiradas) e calcula os agregados no navegador. Uma view/RPC devolveria alguns KB em vez de megabytes — a maior economia de banda possível do app. `(BoletosPanel.jsx:845-935 · Alto · G)`

**176. Aba Tráfego é a mais cara do app** — São 10 consultas na abertura, três delas paginando em série (até 30 idas ao banco cada). Paralelizar as páginas ou agregar no banco. `(TrafegoPanel.jsx:245-284 · Alto · M)`

**177. Blocos de 80 boletos buscados um após o outro** — O "hero financeiro" do Asaas espera cada bloco terminar para pedir o próximo; um `Promise.all` corta o tempo para o do bloco mais lento. Mesmo padrão nas 3 consultas em série do ranking dos Sócios e do ActivityFeed. `(AsaasPanel.jsx:1015, SociosDashboard.jsx:855 · Médio · P)`

**178. Monitor tem 7 relógios consultando o banco mesmo minimizado** — Consultas a cada 15-30s continuam com a janela oculta; o App já tem a checagem `document.hidden` no health-check — é replicar aqui. `(MonitorPanel.jsx:320-831 · Alto · P)`

**179. Central de notificações recarrega tudo a cada evento** — Ao "marcar todas como lidas", N eventos disparam N recargas completas de 100 linhas, sendo que o payload do evento já traz a linha nova. `(useNotifications.js:44 · Médio · P)`

**180. Widgets do Dashboard sem memo (1.728 linhas)** — Qualquer estado local re-renderiza todos os gráficos e tabelas. Envolver os pesados em `React.memo` faz os filtros responderem na hora. `(dashboard/widgets.jsx · Alto · M)`

**181. Cada clique de filtro refaz o cálculo inteiro do Dashboard** — O compute varre todas as linhas de novo a cada mudança de período/resort. Pré-indexar por mês/resort uma vez elimina o recálculo completo. `(dashboard/compute.js:131 · Médio · M)`

**182. OCR baixa o motor de fora a cada primeira leitura** — O Tesseract puxa vários MB de WASM + idioma de CDNs de terceiros, e o PDF.js vem de outro CDN via script injetado. Servir esses arquivos do próprio site (com cache immutable) deixa a leitura de CNH bem mais rápida e independente de terceiros. `(ocrService.js:3-8,96 · Alto · M)`

**183. Logos de 1080×1080 px para um ícone de 40 px** — Favicon e logos do cabeçalho/login são PNGs grandes renderizados pequenos. Variantes de 96 px derrubam de ~20 KB para ~2 KB cada. `(public/logo-*.png · Médio · P)`

**184. Cache de HTML incompleto para rotas profundas** — A regra de no-cache só cobre `/` e `/index.html`; qualquer outra URL cai no fallback SEM essa regra — usuário pode ficar preso num HTML velho apontando para chunks que não existem mais. Adicionar bloco genérico de HTML. `(public/_headers:32 · Médio · P)`

**185. keep-warm aquece funções que o app quase não usa** — O frontend usa as versões EDGE de health e zapsign (sem cold start); os ~2.880 pings/mês nas functions antigas provavelmente não compram nada. Desligar e medir. `(keep-warm.mjs:42 · Médio · P)`

**186. Worker da fila roda 43.200 vezes por mês, quase sempre à toa** — O `kommo-queue-worker` roda a cada minuto e quase sempre encontra fila vazia. Passar para a cada 3 minutos (mantendo o disparo manual) corta 2/3 das invocações com atraso irrelevante. `(kommo-queue-worker.mjs:36 · Médio · P)`

**187. Polling de 5 min baixa mais do que precisa** — A varredura de pendências traz o `dados` completo dos assinados pendentes, roda em qualquer aba e processa os contratos UM A UM em série (um await por contrato). Selecionar só os campos usados e paralelizar com limite deixa o ciclo em segundos. `(App.jsx:604-682 · Médio · M)`

**188. Trocar de aba joga tudo fora** — A árvore de abas desmonta o painel anterior; voltar para Boletos/Asaas/Vendas rebaixa TODOS os dados. Um cache com validade (5 min) por aba — ou uma fonte única de contratos compartilhada pelas 6 abas que hoje fazem cada uma a sua consulta — elimina a maior parte das consultas repetidas do dia. `(App.jsx:1602 · Alto · G)`

**189. Só uma lista do app é virtualizada** — ContratosTab (scroll infinito acumulando) e BoletosPanel (~1.300 clientes no DOM) renderizam tudo; depois de algumas páginas o scroll engasga. `react-window` já está instalado — é usar. `(BoletosPanel.jsx:1472 · Médio · M)`

**190. CSS de 148 KB bloqueando a primeira pintura** — Um arquivo único com 58 blocos de animação, muitos exclusivos de telas específicas. Mover o CSS de painéis pesados para os módulos lazy (o ClientesTab já faz assim). `(index.css · Médio · M)`

**191. Excel e Word geram pacotes de 400 KB cada** — São lazy (certo), mas quem exporta uma planilha baixa 415 KB; há alternativas bem menores para exportação simples, e o chunk do PDF ainda se sobrepõe ao do worker (jsPDF empacotado 2×). `(vendor-excel/docx/pdf · Médio · M)`

**192. Miudezas de performance** — `select('*')` em ~40 chamadas do frontend (colunas que ninguém lê, e coluna nova pesada entra sozinha no download); fontes do Google sem self-host (2 conexões externas antes do primeiro texto); `modulePreload` cita chunk que não existe; `[build.processing]` morto no netlify.toml; monitor de saúde grava histórico no localStorage a cada minuto; `findScrollable` varre o DOM com getComputedStyle até 8× por aba. `(vários · Baixo · P)`

## 7. Frontend / arquitetura React — 26 itens

**193. Checkbox "Não mandar mensagem automática" é falsa — e agora perigosa** — A caixa vermelha do formulário é resquício do ChatGuru: NINGUÉM lê esse campo. Desde 02/07 o link de assinatura sai por WhatsApp via Kommo mesmo com a caixa marcada — o operador acredita ter bloqueado o envio e a mensagem sai. Ou remove a caixa, ou ela passa a bloquear de fato o disparo. `(FormPanel.jsx:1872 + App.jsx:1645 · Alto · P)`

**194. Ctrl+S apertado duas vezes pode duplicar o contrato** — O atalho guarda uma versão antiga da função de salvar: após o primeiro salvamento, um segundo Ctrl+S ainda "acha" que o contrato nunca foi salvo e INSERE um registro novo. Mesma família do caso Fernanda, só que duplicando. `(App.jsx:997 · Alto · P)`

**195. A tela padrão ignora as permissões** — A última opção da cadeia de abas mostra o Dashboard sem checar nada: quem tem Dashboard desmarcado no Admin vê o Dashboard mesmo assim (e o painel dispara as consultas). O dock do celular tem o mesmo problema: os 3 botões fixos não passam pelo filtro de permissão. `(App.jsx:1627,1758 · Alto · P)`

**196. A aba mais usada é a única sem "airbag"** — Todas as abas são embrulhadas em ErrorBoundary, menos Contratos Salvos: um erro ali derruba o app inteiro para tela branca. `(App.jsx:1602 · Alto · P)`

**197. Rascunho pode ser perdido no login** — O rascunho é guardado numa "gaveta" com o nome do usuário, mas o app abre a gaveta "anon" antes de saber quem entrou: quem loga numa aba já aberta não recupera o próprio rascunho e pode gravar vazio por cima. `(ContractContext.jsx:103 · Alto · M)`

**198. O sistema de Desfazer (Cmd+Z) está todo morto** — Hook, toast e atalho existem e estão documentados, mas nenhuma ação registra um "desfazer" — arquivar contrato é definitivo na prática, ao contrário do que a interface promete. Ligar de verdade (começando por arquivar) ou remover. `(App.jsx:1602-1603 · Médio · M)`

**199. Admin marca permissão sem conferir se gravou** — A matriz atualiza o quadradinho na hora e não confere o resultado da gravação: se o banco recusar, o admin sai convencido de que concedeu/revogou um acesso que continua como estava. `(AdminPanel.jsx:49 · Médio · P)`

**200. Respostas antigas do banco podem sobrescrever as novas** — Nenhum painel grande descarta respostas fora de ordem: se a consulta do filtro anterior demorar mais, ela chega DEPOIS e sobrescreve a tela com dados do filtro errado. Um "número de série" por busca (ou AbortController) resolve nos 6 painéis. `(VendasPanel.jsx:281 e demais · Médio · M)`

**201. Sugestão de nome baixa contratos inteiros a cada 3 letras** — A busca de cliente pelo nome traz 5 contratos completos (JSON inteiro) por consulta durante a digitação. Pedir só os campos dos contratantes. `(FormPanel.jsx:346 · Médio · P)`

**202. Formulário re-renderiza 2.000 linhas a cada rolagem** — Um estado de "cabeçalho fixo" é atualizado a cada scroll e nunca é usado — rolar a tela força o React a reprocessar o formulário inteiro à toa (travadinha clássica no iPad). `(FormPanel.jsx:1261 · Médio · P)`

**203. CPF, RG e endereço do cliente impressos no console** — Após o OCR da CNH, os dados extraídos vão para o console do navegador. Num escritório sujeito à LGPD, remover a linha. Há mais 2 console.log de automação no App. `(FormPanel.jsx:479, App.jsx:736,857 · Alto · P)`

**204. Sincronização do ZapSign existe em duas cópias divergentes** — O botão da aba Contratos e a varredura automática do App implementam a mesma coisa separadamente (e já usam campos diferentes). É a mesma armadilha que gerou o bug do Edmar — unificar num módulo. `(ContratosTab.jsx:1185 vs App.jsx:625 · Alto · M)`

**205. Duas listas de "campos obrigatórios"** — A checagem do botão Enviar e a do atalho são implementações separadas da mesma regra e já divergem. Campo novo precisa ser lembrado nos dois lugares. `(App.jsx:234 vs FormPanel.jsx:1144 · Médio · M)`

**206. Lista de e-mails privilegiados copiada em 6 arquivos (+1 no banco)** — Quem vê dados de sócio está escrito à mão em App, Dashboard, SociosDashboard, TrafegoPanel, ClientesTab, BoletosPanel — e a RPC de pontualidade tem OUTRA lista dentro do SQL. Mudança societária = 7 edições; esquecer uma = furo silencioso. Centralizar (arquivo único ou tabela). `(App.jsx:75 e 6 lugares · Alto · P)`

**207. O nome de cada aba vive em 5 lugares** — Menu do celular, ícones, cabeçalho, abas do desktop e matriz do Admin têm listas próprias — por isso a matriz do Admin nem lista Sócios e Saúde do Funil. Uma tabela única de configuração de abas. `(App.jsx:136+ · Médio · M)`

**208. Cinco sistemas de aviso (toast) diferentes** — Existe o Toast oficial, mas 4 telas fizeram o seu, com posição/cor/duração próprias. Consolidar num só. `(Toast.jsx + 4 painéis · Médio · M)`

**209. App.jsx é roteador, motor de automações e gerador de PDF ao mesmo tempo** — ~290 linhas de automações críticas (ZapSign/ADVBOX/Drive) moram no arquivo da tela principal. Extrair para `hooks/useAutomacoes.js` torna a lógica testável e para de arriscar o app inteiro a cada ajuste. `(App.jsx:617-905 · Alto · G)`

**210. Quebrar os 4 arquivos gigantes** — VendasPanel (2.516 linhas com 15 componentes), ContratosTab (2.353), FormPanel (2.049, com um bloco de contratante de 730 linhas) e SociosDashboard (2.043, com 4 painéis independentes) concentram risco: mexer numa parte quebra outra. Extrair em subpastas como o Dashboard já fez (compute + widgets). `(4 componentes · Médio · G)`

**211. Tela importa código da pasta do servidor** — O Dashboard importa de `netlify/functions/_lib/` para reusar a regra de campanhas de RH. A intenção (fonte única) é certa, mas se esse arquivo um dia usar algo só-de-servidor, o site para de compilar. Mover o módulo puro para pasta neutra compartilhada. `(dashboard/compute.js:22 · Médio · P)`

**212. Changelog inteiro no carregamento inicial** — As 18 versões (561 linhas) entram no primeiro download para todo mundo, e o modal de importar contrato (1.473 linhas) baixa junto com a aba Contratos mesmo sem uso. Carregar sob demanda. `(App.jsx:95, ContratosTab.jsx:11 · Médio · P)`

**213. Telas conversam por "recados" com espera cronometrada** — Abrir contrato vindo da busca (ou converter lead) troca de aba e espera 300-400 ms torcendo para a outra tela estar pronta; em máquina lenta o recado se perde e nada acontece, sem erro. Trocar por estado explícito (querystring/contexto). `(App.jsx:1017,1660 · Médio · M)`

**214. Ficha do cliente engole erros de 6 consultas** — Abrir um cliente dispara 6 buscas e todas silenciam falhas: a seção aparece vazia e o usuário conclui que o dado não existe (prestação, dados bancários, ações), quando foi só um erro de rede. Mostrar "não foi possível carregar — tentar de novo". `(ClientesTab.jsx:432 · Médio · M)`

**215. Código morto para remover** — 6 utilitários que ninguém importa (`actionLog`, `commissionClient`, `editLock`, `phone`, `sessionManager`, `supabaseSafe` — este citado em comentários como se estivesse ativo!), `config.js` apontando para o servidor aposentado, hook de rolagem duplicado, `ASAAS_USERS` e `currentStep` órfãos, 2 skeletons sem uso, prop `onPdfPreview` passada e nunca recebida, estado `validationMessage` montado e nunca exibido. `(utils/ e App.jsx · Médio · P)`

**216. Filtros salvos se atropelam** — Cada filtro grava na mesma chave do navegador com atraso de 150 ms; dois filtros mudando juntos = o último apaga o outro. O usuário volta e um filtro sumiu. `(usePersistedFilters.js:23 · Baixo · P)`

**217. Detalhes que confundem** — "Atualizado em" dos Sócios mostra a hora do desenho da tela (muda sozinho sem dado novo); a lista em tempo real insere contratos que não batem com a busca digitada; aviso de conectividade acumula timers; dois detectores de "é celular?" convivem (útil unificar no `useDeviceType`). `(SociosDashboard.jsx:1610 e outros · Baixo · P)`

**218. Contador de dúvidas do Portal roda para quem nem tem a aba** — A consulta do selo roda a cada 2 min para todos os usuários e é reiniciada (com consulta extra) a cada troca de aba. Condicionar à permissão e tirar a dependência do efeito. `(App.jsx:506 · Baixo · P)`

## 8. Dados, BI e funil — 42 itens

**219. Dashboard dos Sócios calcula dinheiro sobre 9% dos boletos** — A consulta pede TODOS os ~11 mil boletos sem paginar e o banco corta em 1.000 (os mais antigos!). Receita projetada, inadimplência e top clientes da tela dos sócios saem errados HOJE — é o mesmo defeito do funil de 28/07, em outra tela. A consulta de contratos ao lado tem o mesmo risco. `(SociosDashboard.jsx:1509,1502 · Alto · P)`

**220. Aba Tráfego conta videochamadas pela metade** — O bloco "Do anúncio ao contrato" lê a view de 2.883 linhas SEM paginação — exatamente o bug corrigido no Dashboard em 28/07, que ficou para trás aqui. Duas telas mostram números diferentes da mesma coisa. Trocar pela fonte única `funilSources.js`. `(TrafegoPanel.jsx:281 · Alto · P)`

**221. Campanhas de vaga (RH) voltaram a inflar o comercial do Tráfego** — O select de `meta_ads_mensal` do painel não traz `campaign_name`, então o filtro de RH não funciona ali: currículos de "[VAGA] Advogado" contam como lead no bloco comercial — os KPIs do topo da MESMA aba os excluem. Custo por assinado sai mais bonito do que é. `(TrafegoPanel.jsx:280 + trafego/compute.js:401 · Alto · P)`

**222. `.limit(20000)` não protege nada — 3 telas vão errar juntas** — Dashboard, Saúde do Funil e Tráfego confiam num limite que o banco ignora (teto fixo de 1.000). Com ~190 contratos hoje passa; no dia em que a base crescer, KPIs, funil e comercial subcontam em silêncio. Paginar de verdade. `(Dashboard.jsx:155, FunnelHealthPanel.jsx:71, TrafegoPanel.jsx:282 · Alto · M)`

**223. Relatórios em PDF/Excel podem omitir linhas sem avisar** — O relatório de boletos (limit 5000 → entrega 1000), o de inadimplência por cliente, o export do Dashboard e o relatório de assinados baixam tudo sem paginar: o arquivo enviado ao sócio pode faltar contratos/boletos e nada no arquivo indica o corte. `(RelatorioBoletosModal.jsx:61, Dashboard.jsx:350, RelatorioAssinadosModal.jsx:45 · Alto · M)`

**224. Régua/painéis de inadimplência limitados a 1.000 vencidos** — CobrancaPanel e InadimplenciaStrip pedem 5.000 (recebem 1.000): quando os vencidos passarem disso, o total em aberto PARA de crescer na tela. E a lista de devedores da aba Clientes trunca em 1.000 — cliente devedor aparece como em dia. `(CobrancaPanel.jsx:91, InadimplenciaStrip.jsx:46, clientesService.js:99 · Alto · P)`

**225. Monitor conta fila e saúde sobre amostras cortadas** — Painéis de saúde/fila usam `.limit(2000/5000)` e contam no navegador: se a fila do Kommo empacar com 1.500 jobs, o painel mostra "1.000" e parece estável na hora do problema. Usar `count: exact` do banco. `(MonitorAdvbox.jsx:163,245, HealthSlos.jsx:92 · Médio · P)`

**226. Botão "Kommo" some para clientes fora dos primeiros 1.000** — O mapa CPF→lead dos Boletos corta em 1.000; para os demais o atalho simplesmente não aparece, parecendo bug do Kommo. `(BoletosPanel.jsx:1144 · Médio · P)`

**227. Call das 21h cai no dia (às vezes mês) seguinte** — Os computes do funil cortam a data ISO em UTC: toda videochamada a partir das 21h de Brasília é contada no dia seguinte. A varredura UTC de 31/07 corrigiu os "hoje" do app, mas não os computes do funil — e as coortes mensais do Tráfego e da Saúde do Funil têm o mesmo defeito (`slice(0,7)`). Um contrato assinado dia 31 às 22h aparece em julho numa tela e agosto na outra. `(dashboard/compute.js:183, trafego/compute.js:405, funnelCompute.js:126 · Alto · P)`

**228. "Ticket médio" tem duas definições diferentes** — O Dashboard divide a receita por TODOS os assinados (incluindo contratos só-êxito, que valem R$ 0 de entrada); o Tráfego divide só pelos que têm valor. O mesmo mês mostra dois tickets. Padronizar (e rotular). `(dashboard/compute.js:481 vs trafego/compute.js:418 · Médio · P)`

**229. Leads mensais comparados com calls diárias** — Em qualquer período que não seja mês fechado (90 dias, personalizado), o funil soma o MÊS INTEIRO de leads contra calls do período — a taxa "% agendaram" sai errada por construção. O dado diário já existe em `meta_ads_diario`. `(dashboard/compute.js:222 · Alto · M)`

**230. Conversão lead→call da Saúde do Funil mistura períodos** — Divide calls (que só existem desde o backfill da agenda) por leads desde jul/2024: o percentual sai artificialmente baixo sem nenhum aviso de que as janelas são diferentes. `(funnelCompute.js:88 · Alto · M)`

**231. Régua de comparecimento misturada sem sinalização** — A view já diz se o status veio da auditoria do Meet ou da cor da agenda (`origem_status`), mas o funil não lê: não dá para mostrar "186 de 191 via Meet" nem separar o histórico pré-junho (outra régua). E o status antigo "fechou" (extinto em maio) infla "compareceram" nos meses antigos. `(funilSources.js:52 · Médio · P)`

**232. Percentuais sem tamanho da amostra** — "60% compareceram" pode ser 3 de 5; os insights automáticos disparam com 3 casos e soam como conclusão ("Indicação assina 30 p.p. mais que Facebook"). Mostrar o "n" e elevar o mínimo evita decisão em cima de ruído. `(dashboard/compute.js:213,648 · Médio · P)`

**233. Data de cancelamento não existe — usa-se a última mexida** — O cancelamento é datado por `updated_at`, que qualquer automação toca: o cancelamento "acontece" no mês errado. Criar coluna `cancelado_em`. `(dashboard/compute.js:337 · Médio · M)`

**234. Nenhuma tela diz de quando são os dados** — Se o sync da agenda ou da Meta parar, o funil segue exibindo números plausíveis — só que velhos. Um carimbo "dados até dd/mm hh:mm" por fonte (só o Tráfego tem) torna a defasagem visível. `(Dashboard/FunnelHealth · Alto · P)`

**235. Espelhos sem checagem de sanidade** — Os alertas avaliam o negócio (CPL alto), mas não o DADO: "sync gravou 0 linhas", "gasto 10× a média", "tabela encolheu". Espelho travado hoje se parece com dia fraco de campanha. Meia dúzia de regras baratas no worker resolve. `(_lib/metaAds.mjs:294 · Alto · M)`

**236. Recortes por idade/UF ainda podem estar com leads inflados** — A correção da dupla contagem refez mensal e diário pelo `raw`, mas `meta_ads_breakdown` não tem `raw` — só re-sync conserta. Enquanto isso, os breakdowns mostram mais leads que o resto da aba. Rodar o re-sync (`?backfill=1`). `(docs/META_ESPELHO.md:59 · Médio · M)`

**237. Conferência diário×mensal foi única — automatizar** — A validação de 0,00% de divergência foi manual, uma vez. Um job semanal comparando os agregados avisaria na hora se um dos caminhos passar a divergir. `(meta_ads_diario × mensal · Médio · M)`

**238. Mês corrente não é marcado como parcial** — O mês em andamento está sempre incompleto no espelho Meta, mas nada o distingue: gráficos comparam mês parcial com meses fechados como iguais. Uma flag/rótulo resolve. `(meta-ads-sync.mjs:11 · Médio · P)`

**239. SLA de 1ª resposta é medido há semanas e NINGUÉM vê** — O worker grava tempo até a 1ª resposta, se foi humano ou bot, e se o lead reengajou (`kommo_sla`) — e não existe tela, view de BI nem export consumindo. É exatamente a métrica de tempo comercial que falta no funil. `(kommo-sla-worker-background.mjs:107 · Alto · M)`

**240. Duração real da call coletada e ignorada** — A auditoria do Meet sabe quantos segundos o cliente ficou e quanto esperou sozinho, mas o funil só usa compareceu/não: call de 40 segundos conta igual a call de 40 minutos. `(supabase_meet_auditoria.sql · Médio · M)`

**241. Funil não abre por vendedora** — A view expõe `vendedora_email` e existe até view de pontualidade, mas nenhuma tela compara comparecimento/conversão por pessoa. `(funilSources.js:52 · Médio · M)`

**242. Power BI não consegue excluir arquivados** — `vw_powerbi_contratos` não tem `arquivado_em`: o app exclui arquivados por padrão e o Power BI não tem como — o mesmo mês fecha diferente nas duas ferramentas. `(supabase_bi_views_base.sql:247 · Alto · P)`

**243. Power BI perde assinados antigos** — A view só usa `signed_at`; o app usa a cascata `signed_at → advbox_date → updated_at`. Os 31 assinados antigos sem `signed_at` somem das contagens mensais do painel. `(supabase_bi_views_base.sql:279 · Alto · P)`

**244. Contrato 0/0 vira "Somente Iniciais" no BI** — Sem ramo para honorário zerado, cadastros a revisar se misturam a contratos reais no painel. `(supabase_bi_views_base.sql:285 · Médio · P)`

**245. Um texto fora do padrão pode derrubar o refresh do Power BI** — O cast `::date` de `dataPrimeiraMensagem` não tem guarda: um registro malformado quebra a view inteira. A `vw_bi_tarefas` já usa regex de proteção — replicar. `(supabase_bi_views_base.sql:276 · Médio · P)`

**246. Colunas com nome enganoso e réguas divergentes no BI** — `data_criacao` é na verdade a data AGENDADA (documentado, mas segue enganando) — criar alias `data_agendada`; e "atrasada" usa UTC numa view e BRT na outra: depois das 21h os visuais mostram contagens incompatíveis. `(supabase_bi_views_base.sql:204,214 vs 529 · Médio · P)`

**247. Produtividade conta tarefa em dobro e credita homônimo errado** — Tarefa com dois responsáveis multiplica a linha (a Carga Atual foi reconciliada; a produtividade não), e "PUBLICAÇÃO TRATADA" é atribuída pelo primeiro nome com LIMIT 1 — dois colegas com o mesmo nome = crédito errado sem aviso. `(supabase_bi_views_base.sql:432,437 · Médio · M)`

**248. Inadimplência definida à mão em 3 telas** — Cada tela repete o `.or(status...)` em vez de derivar da lista central `OPEN_STATUSES`: um status novo do Asaas entra no mapa e fica fora das consultas — mesma classe de divergência do funil pré-fonte-única. `(InadimplenciaStrip.jsx:46, CobrancaPanel.jsx:91, BoletosPanel.jsx · Médio · M)`

**249. Histórico de inadimplência gravado por um job que ninguém vigia** — O snapshot diário saiu do watchdog (falso-positivo de fim de semana): se falhar, o gráfico congela parecendo estabilidade. Reincluir com SLA que tolere fim de semana. `(cobranca-regua.mjs:27 · Médio · P)`

**250. LTV por cliente: o dado está pronto e a conta não é feita** — O payback do Tráfego já cruza CPF da coorte com boletos pagos; estender por cliente dá receita REALIZADA por pessoa/resort — hoje só se enxerga honorário contratado. `(trafego/compute.js:421 · Alto · M)`

**251. CAC de verdade (por cliente novo) não existe** — Há custo por lead e por assinado no mês, mas contratos do mesmo CPF contam duas vezes e não há visão por resort/campanha. Com o cadastro único, é uma conta simples. `(dashboard/compute.js:240 · Alto · M)`

**252. Curva de pagamento da coorte e risco por cliente** — Já existem assinatura, vencimentos, pagamentos e histórico de disparos: dá para responder "quanto da coorte de julho pagou em 30/60/90 dias" e criar um score simples de risco. Hoje a cobrança só olha o presente. `(asaas_boletos + cobranca_disparos · Alto · M)`

**253. Comissão nunca é comparada com receita** — A comissão é calculada por contagem/pesos, sem métrica de custo de comissão sobre o recebido do mês: ninguém vê se o mês bom de vendas foi bom de MARGEM. `(commission-calculator.mjs · Médio · M)`

**254. Origem "Formulário" não conta como Meta** — A lista de origens Meta tem "whatsapp" (que nem é opção do formulário) e NÃO tem "Formulario" (os lead forms da Meta): "assinados com origem Meta" sai menor que a realidade. `(trafego/compute.js:22 vs FormPanel.jsx:1826 · Médio · P)`

**255. Export Excel sem os campos de análise** — Sai sem origem do cliente, 1ª mensagem, vendedora, distribuído/guia paga e valor recebido — quem cruza no Excel volta ao banco. `(excelExport.js:9 · Baixo · P)`

**256. Resumo semanal só existe para Tráfego** — Segunda de manhã chega o resumo das campanhas, mas nada de assinaturas, funil e inadimplência da semana. O molde (`meta-trafego-weekly`) está pronto para clonar. `(meta-trafego-weekly.mjs · Médio · M)`

**257. Casos descartados em silêncio nas medianas** — Jornadas fora da faixa (data invertida/antiga) somem do cálculo sem contador. "N casos ignorados por data inconsistente" viraria fila de correção de cadastro. `(dashboard/compute.js:600 · Baixo · P)`

**258. Consulta morta ao log de erros do Asaas** — O painel de SLOs busca `asaas_error_log` e joga fora. Ou exibe (é sinal de espelho quebrado) ou remove. `(HealthSlos.jsx:93 · Baixo · P)`

**259. Acervo de no-show não checa quem pediu para não ser contatado** — A flag `elegivel_recuperacao` não cruza com o opt-out da cobrança: quem pediu para não receber mensagem entraria no disparo de resgate. Cruzar antes de ligar o envio. `(supabase_noshow_acervo.sql:106 · Médio · P)`

**260. Telefone "canônico" de 8 dígitos pode fundir pessoas diferentes** — Ao cortar o 9º dígito para casar formatos antigos, dois números distintos com os mesmos 8 finais viram a mesma pessoa no acervo. Usar o DDD+9 quando disponível. `(supabase_noshow_acervo.sql:31 · Baixo · M)`
## 9. UX, interface e acessibilidade — 35 itens

**261. Campo com erro fica ilegível no modo escuro** — O `.input-error` força fundo rosa-claro sem versão dark, e o texto fica cinza-claro: quem erra um campo no tema escuro vê texto quase branco sobre rosa quase branco. `(index.css:105 · Alto · P)`

**262. Anel de foco invisível no modo escuro** — O foco dos inputs usa o azul-marinho da marca, que não é ajustado no dark: quem navega por Tab à noite não enxerga onde está. `(index.css:1376 · Alto · P)`

**263. Letras de 8-9px no desktop** — O piso de fonte só vale no celular; no desktop sobraram 195 usos de `text-[9px]` e 24 de `text-[8px]`. A equipe passa o dia lendo rótulos minúsculos. `(index.css:1587 + telas · Alto · M)`

**264. Nenhum rótulo está ligado ao seu campo** — Há ~190 `<label>` e só 5 `htmlFor` no projeto: clicar no rótulo não foca o campo, o preenchimento automático piora e leitor de tela lê "campo sem nome". `(FormPanel.jsx:882 e geral · Alto · M)`

**265. Tradutor de erros existe e quase ninguém usa** — O `friendlyError` (erro técnico → português) é chamado só em 2 telas; nas outras ~25 o usuário lê a mensagem crua do banco em inglês ("duplicate key value…"). Aplicar em todo catch visível. `(utils/friendlyError.js:6 · Alto · M)`

**266. Alertas nativos do navegador para erros** — 11 lugares ainda usam `alert()`, travando a tela com a caixa cinza do sistema fora do visual do app; o toast oficial já existe. `(FormPanel.jsx:1982, Dashboard.jsx:361 · Médio · M)`

**267. Confirmação destrutiva com dois padrões** — Existe o `ConfirmDestructive` (digitar a palavra), mas 10 pontos usam o `confirm()` do navegador — inclusive excluir comentário. O usuário nunca sabe qual proteção vai receber. `(ContratosTab.jsx:1547, VendasPanel.jsx:1547 · Médio · M)`

**268. Erro nunca oferece "tentar de novo"** — O toast suporta botão de ação e nenhum `toast.error` do app o usa: quem cai numa falha de rede precisa reencontrar sozinho o botão que disparou a operação. `(Toast.jsx:6 · Médio · M)`

**269. Cliente final vê erro técnico no formulário público** — No formulário do QR Code, qualquer falha mostra a mensagem do Supabase em inglês ("new row violates row-level security policy"). O cliente desiste. `(ClientFormQR.jsx:228 · Alto · P)`

**270. Formulário público não aponta o campo que falta** — A validação escreve "Preencha nome, CPF e email" no rodapé sem marcar o campo nem levar o foco — no celular a mensagem pode nem estar visível. E o CPF não é validado (o `validateCPF` com dígito verificador já existe). `(ClientFormQR.jsx:214-216 · Alto · P)`

**271. Formulário público coleta CPF e RG sem aviso de privacidade** — Nenhuma linha diz quem recebe os dados e para quê — justamente no primeiro contato digital do cliente com o escritório (e é uma exigência da LGPD). `(ClientFormQR.jsx:246 · Médio · P)`

**272. Português sem acento espalhado pelas telas** — "Profissao", "Endereco", "Gerar Procuracao", "usuarios autorizados"… centenas de strings sem acento, algumas na tela do cliente. Passa descuido num escritório de advocacia. (A convenção "sem acento" era para o código, não para o que o usuário lê.) `(ClientFormQR.jsx:277, FormPanel.jsx:1922 e geral · Médio · M)`

**273. Erro de login não é anunciado nem recebe foco** — A caixa vermelha aparece sem `role="alert"`; quem usa leitor de tela ou zoom alto tenta de novo sem saber que já falhou. E o "olhinho" da senha tem `tabIndex={-1}` — só funciona com mouse. `(LoginScreen.jsx:131,192 · Médio · P)`

**274. Botões desabilitados sem dizer o que falta** — Com o formulário incompleto, os 5 botões apagam e só aparece "Preencha todos os campos". O painel detalhado de erros existe e nunca dispara, porque o clique está bloqueado. Deixar o botão clicável e, no clique, listar e focar o que falta. `(FormPanel.jsx:1950 · Alto · M)`

**275. Campo inválido é só uma borda vermelha** — Não há texto de erro ao lado do campo nem `aria-invalid`/`aria-describedby` em lugar nenhum: erro sinalizado só por cor exclui daltônicos e obriga a adivinhar o problema. `(FormPanel.jsx:933 · Alto · M)`

**276. Barra de progresso do formulário não funciona no teclado** — Os 5 blocos que pulam para cada seção são `<div onClick>` sem role/tabIndex, com rótulo em 8px. E os cabeçalhos das seções recolhíveis não anunciam aberto/fechado (`aria-expanded`). `(FormPanel.jsx:1316,251 · Médio · P)`

**277. Três botões azuis-marinho quase idênticos empilhados** — "Salvar", "Gerar PDF e Salvar" e "Enviar para ZapSign" são três azuis muito próximos, um embaixo do outro: é fácil enviar para assinatura achando que só estava salvando. Diferenciar cor/peso do destrutivo/definitivo. `(FormPanel.jsx:1958-2010 · Médio · M)`

**278. Modais sem Esc, sem foco preso e sem identidade de janela** — De 29 modais, só 8 têm `role="dialog"`; Importar Contrato, ZapSign, Checklist e outros não fecham com Esc; nenhum prende o Tab — o teclado "vaza" para a tela de trás, que continua ativa. Um componente base de modal resolve os três problemas de uma vez. `(ImportContratoModal.jsx:495, PreSendChecklist.jsx:221 e geral · Médio · M)`

**279. Tabelas sem cabeçalho semântico nem ordenação anunciada** — Nenhum dos ~100 `<th>` tem `scope="col"` e não existe `aria-sort`: no Tráfego o clique ordena, mas nada indica a coluna ordenada para quem não vê a setinha. `(SociosDashboard.jsx:643, TrafegoPanel.jsx:707 · Médio · M)`

**280. Busca global muda a seleção e o leitor de tela fica mudo** — A lista de resultados não usa `role="listbox"`/`aria-activedescendant`; e as etiquetas de status usam fundos claros fixos que estouram no modo escuro. `(GlobalSearch.jsx:132-148 · Baixo · P)`

**281. Barra de abas não mostra que há mais abas à direita** — Até 15 abas com scroll horizontal invisível (scrollbar oculta, sem seta/sombra): em tela menor o usuário não descobre que "Admin" ou "Param. Vendas" existem. `(App.jsx:1461 · Médio · M)`

**282. Abas não são navegáveis como grupo** — Botões soltos sem `role="tablist"`/setas: trocar de aba por teclado exige tabular por todas. `(App.jsx:1466 · Baixo · M)`

**283. Chegaram 3 avisos, você vê 1 e o X apaga os 3** — A barra de notificações só renderiza a primeira e o botão de fechar (sem `aria-label`) limpa a lista inteira: avisos morrem sem serem lidos. `(App.jsx:1511 · Médio · P)`

**284. Tela quebrada mostra mensagem de programador** — O ErrorBoundary exibe o erro cru ("Cannot read properties of undefined") em vez de orientar ("recarregue ou avise o suporte"). `(App.jsx:314 · Médio · P)`

**285. Jargão técnico na interface** — Estados vazios citando coluna do banco ("vendedora_email ainda nao foi preenchido", "as tabelas ainda não foram criadas"), tooltip com "soft delete", `aria-label` "Step N" em app 100% português. Trocar por frases de gente. `(SociosDashboard.jsx:1107,638, ContratosTab.jsx:1759 · Médio · P)`

**286. Dourado da marca reprova em contraste** — `#C9A84C` sobre branco dá ~2,2:1 (mínimo é 4,5:1): números de comissão e funil ficam apagados em monitor comum. Criar um tom mais escuro para TEXTO dourado, mantendo o atual para detalhes. `(FunnelHealthPanel.jsx:209, SociosDashboard.jsx:690 · Médio · M)`

**287. Três linguagens de ícone misturadas** — 56 arquivos usam Heroicons, 27 usam emoji (📱⚠️🎉) e vários desenham SVG próprio. Emoji muda de desenho por aparelho e destoa da sobriedade do produto. Padronizar em Heroicons. `(BoletosPanel.jsx:1159 e geral · Médio · G)`

**288. Datas e valores em 9 formatos** — Existem `fmtBRL`/`fmtDateBR` prontos, mas sobraram 32 `toLocaleDateString` e 44 `toLocaleString` soltos: na mesma tela sai "R$ 1.234" e "R$ 1.234,56". Adotar a central de formatação em todo lugar. `(utils/format.js:9 e 8+ arquivos · Médio · M)`

**289. Onze variações do botão primário** — `.btn-primary`, cor inline, classe arbitrária, token — cada aba tem um botão azul com altura/sombra/caixa próprias. Consolidar nos componentes/classes oficiais. `(index.css:66 e telas · Médio · G)`

**290. Cor da marca chumbada em estilo inline quebra o dark** — 30 usos de `#1B3A5C` em `style={{}}` no FormPanel e 18 no ImportContratoModal: o CSS do modo escuro não vence estilo inline — títulos azul-escuro sobre fundo preto. Trocar por classes/tokens. `(FormPanel.jsx:690, ImportContratoModal.jsx:505 · Alto · M)`

**291. Kanban de Vendas impossível sem mouse (ou sem toque)** — O card é `draggable` sem `tabIndex` e o botão "Mover" só existe em telas de toque: no computador, quem não consegue arrastar não move contrato de coluna. Mostrar o "Mover" também no hover/foco do desktop. `(VendasPanel.jsx:1482 · Médio · M)`

**292. Cards do kanban com branco fixo no modo escuro** — Fundo `rgba(255,255,255,0.95)` e cores fixas fora dos tokens: o quadro vira uma parede branca ofuscante no tema escuro. `(VendasPanel.jsx:1493 · Médio · P)`

**293. Portal do Cliente não tem modo escuro** — O portal define cores claras fixas sem `prefers-color-scheme`: cliente que consulta o processo à noite leva um clarão. `(portal.html:19 · Médio · M)`

**294. Miudezas de acessibilidade** — Coluna vazia do kanban só diz "Vazio" (sem orientação); iframes de preview sem `title`; falta link "pular para o conteúdo"; menu de densidade não fecha com Esc nem navega por setas; indicador de "salvo" oculto no celular (quem preenche contrato no celular nunca vê a confirmação). `(KanbanView.jsx:83, App.jsx:352,1372,1711 · Baixo · P)`

**295. Estados vazios sem próximo passo** — Vários painéis mostram "nenhum dado" sem dizer o que fazer (ex.: comissões sem configuração deveriam apontar "fale com o Paulo / configure em Param. Vendas"). Revisar os estados vazios das 15 abas com uma frase de ação cada. `(várias telas · Médio · M)`

## 10. Qualidade de engenharia (testes, CI, repositório) — 20 itens

**296. 78 funções de servidor sem NENHUM teste** — Os webhooks de dinheiro (`asaas-webhook`, `zapsign-webhook`, `cobranca-disparar`, `commission-calculator`) só passam por checagem de sintaxe. Se a lógica de "boleto pago" inverter, ninguém percebe até o cliente reclamar. Começar pelos 4 que mexem em dinheiro. `(netlify/functions/ · Alto · G)`

**297. As duas maiores bibliotecas de integração sem teste** — `_lib/kommo.mjs` (348 linhas, alterada recentemente) e `_lib/botEngine.mjs` (564): um erro de mapeamento manda mensagem errada ao lead sem alarme. `asaasMirror`, `kommoQueue`, `botDb`, `cobranca` e `nfseAmericana` idem. `(_lib/ · Alto · M)`

**298. Geradores de documento sem cobertura** — `pdfGenerator.js` (o PDF que o cliente assina, que já teve vazamento de memória corrigido sem teste de regressão) e `importContrato.js` (se errar um campo, o contrato sai errado com cara de certo). `(utils/pdfGenerator.js, utils/importContrato.js · Alto · M)`

**299. Zero testes de componente React** — 82 componentes e nenhum `.test.jsx` (testing-library nem está instalada). Nada garante que o formulário salva ou que um modal abre — só o clique manual. Começar por FormPanel (salvar) e ContratosTab (ações). `(components/ · Alto · G)`

**300. ~20 utilitários de negócio sem teste e sem piso de cobertura** — `commissionClient` (comissões), `duplicateDetector` (duplicatas), `zapsignService`, `excelExport` etc. — e o vitest não tem `thresholds`: a cobertura (38,7%) pode cair sem nada apitar. `(utils/ + vitest.config.js:26 · Médio · M)`

**301. Edge functions nunca são verificadas** — `health.ts` e `zapsign-proxy.ts` não entram no build, no `node --check` nem em `deno check` — servem `/api/health` e o proxy sem validação nenhuma. `(edge-functions/ · Médio · P)`

**302. Lint aponta para lixo e sem trava de "não piorar"** — 28 dos 55 erros vêm de `client/backups/` (arquivo morto lintado como vivo — adicionar ao ignore) e o CI engole tudo com `|| echo warning`: um erro novo passa igual ao baseline velho. `(eslint.config.js:8, ci.yml:53 · Médio · P)`

**303. README é o template do Vite** — O único README fala de "React + Vite template"; onboarding depende de ler 90 KB de CLAUDE.md. Um README real (o que é, como rodar, como deployar, onde estão as envs) custa 1 hora. `(client/README.md · Alto · P)`

**304. Sem trilho de ferramentas na raiz** — `npm test` na raiz não existe, a versão do Node não está fixada (`engines`/`.nvmrc`) e não há hook de pre-commit — a suíte leva 1,3s e não roda automaticamente em lugar nenhum hoje (o CI está parado por falta de push). `(package.json, .git/hooks · Médio · P)`

**305. CI sem cache, sem concorrência e sem cobertura** — Roda em todos os pushes E PRs (dobro de minutos), não cancela jobs antigos e nunca executa `test:coverage`. `(ci.yml:9 · Baixo · P)`

**306. Sem vigilância de dependências** — Nenhum Dependabot/`npm audit` no caminho: um CVE em `jspdf`/`xlsx`/`tesseract` ficaria anos sem aviso. `(.github/ · Médio · P)`

**307. Planilha com dados reais de leads no histórico do Git** — `exports/kommo-duplicados/*.xlsx` (7,5 MB, o maior arquivo do repo) contém leads reais e está permanentemente no histórico; e 3 planilhas de clientes estão soltas na raiz a um `git add .` de entrar. Adicionar `*.xlsx` ao gitignore e considerar limpar o histórico. `(exports/, raiz · Médio · P)`

**308. Deploy usa o node_modules que estiver na máquina** — O CI usa `npm ci` (trava as versões), mas o deploy local não reinstala: local e CI podem compilar com versões diferentes de Vite/React sem ninguém comparar. `(deploy.sh · Médio · P)`

**309. `sharp` instala 30 MB em todo build sem ser usado** — O script que o usa é manual e não está em `scripts`. Documentar como comando ou remover. `(package.json:44 · Baixo · P)`

**310. Scripts sem ajuda e com flag fantasma** — O cabeçalho do deploy.sh documenta `--force`, que não existe (o flag real é outro); nenhum script responde `--help`; e o SITE_ID está copiado em 3 scripts (trocar de site = lembrar dos 3). `(deploy.sh:5, rollback.sh:8 · Baixo · P)`

**311. Máscara de telefone fixo sem teste** — `maskPhone` só é testada com celular de 11 dígitos; telefone fixo (comum na carteira) não tem asserção nenhuma. `(masks.test.js:88 · Médio · P)`

**312. Snapshot de 854 linhas aprova mudança jurídica sem leitura** — Qualquer ajuste no contrato quebra o snapshot inteiro e o reflexo é regenerar (`-u`), reaprovando mudanças de conteúdo jurídico sem ninguém ler. Complementar com asserções pontuais nas cláusulas críticas. `(__snapshots__/contractHtml.test.js.snap · Médio · M)`

**313. Ambiente de dev aponta para servidor morto** — O proxy `/api → localhost:3001` referencia o servidor aposentado: em desenvolvimento, toda chamada `/api/*` bate numa porta morta — dev novo perde horas. `(vite.config.js:23, dev-server.mjs · Baixo · P)`

**314. `.last-working-deploy` versionado suja o git a cada deploy** — Arquivo de estado local rastreado no repositório: todo deploy gera diff e conflito em merge. Mover para o gitignore. `(client/.last-working-deploy · Médio · P)`

**315. Faxina de repositório** — `prototipos/` com 48 HTMLs (2,7 MB) misturado a código de produção; 700 KB de documentos de "sugestões" antigos e não confiáveis versionados como doc; `backups/` sem rotação nem índice. Definir o que é vivo, arquivar o resto. `(prototipos/, docs/ · Baixo · P)`

## 11. Produto e novas funcionalidades — 42 itens

**316. Disparar o resgate de no-show** — A lista está pronta e parada no banco: 615 pessoas que faltaram, 423 elegíveis sem nenhum contato depois. Falta só a mensagem sair — pelo mesmo caminho já validado da cobrança (campo do lead + Salesbot), com lote diário limitado e registro. Cada 10 resgates que voltam pagam a feature muitas vezes. `(vw_noshow_acervo + kommo_queue · Alto · M)`

**317. Lembrete automático de videochamada (véspera e 1h antes)** — As colunas de lembrete existem há 17 meses com ZERO preenchimentos, e 95% dos eventos já têm o lead do Kommo casado. Com ~25% de no-show, cada ponto recuperado é uma call a mais por semana. `(agenda_videochamadas + kommo_queue · Alto · M)`

**318. Semáforo de 1ª resposta em tempo real** — A mediana de resposta é 44 min, os 10% piores esperam 27+ horas e 23% nunca são respondidos. Um alerta "lead X sem resposta há 15 min" (sino + WhatsApp da equipe) transforma o número histórico em ação no dia. O medidor já existe (item 239); falta o aviso. `(kommo_sla + notifications · Alto · M)`

**319. Placar diário de SLA por vendedora** — "Recebidos hoje / respondidos / tempo médio" por pessoa, no molde do painel de pontualidade que já existe. O que é visível melhora sozinho. `(vw_funil_sla · Médio · P)`

**320. Follow-up automático de contrato enviado e não assinado** — Há 51 contratos aguardando assinatura (35 parados há 7+ dias, 20 há 30+). Duas cutucadas automáticas (D+2 e D+5) pelo mesmo canal do link, diferenciando quem abriu e não assinou (o sistema já sabe). É dinheiro vendido morrendo na fila. `(contratos + kommo-assinatura-send · Alto · P)`

**321. Score do lead antes da call** — Nota 0-100 para a vendedora com o que já está no banco: velocidade de resposta do lead, engajamento, campanha de origem, resort. Ajuda a decidir insistência e abordagem. `(kommo_leads + meta_ads_diario · Médio · M)`

**322. Lista única "ligar agora"** — Uma fila diária ordenada por valor misturando: no-show elegível, lead sem resposta e proposta parada. Hoje são três telas separadas e ninguém trabalha a lista inteira. `(vw_noshow_acervo + kommo_lead_conversa + contratos · Alto · M)`

**323. Alerta de "cliente esperou sozinho"** — A auditoria do Meet já registra quanto tempo o cliente ficou esperando o vendedor entrar. Aviso no mesmo dia permite pedido de desculpas e recuperação — hoje o dado só vira relatório depois do prejuízo. `(agenda_videochamadas.meet_cliente_esperou_seg · Médio · P)`

**324. Religar a régua de cobrança com trilhos de segurança** — R$ 61 mil vencidos em 203 boletos de 57 clientes com a régua DESLIGADA no código. Desenho seguro: começar só com nota interna → WhatsApp para lote pequeno diário → opt-out, intervalo mínimo entre mensagens e kill-switch sem deploy (tudo já existe no painel de cobrança, falta ligar à régua). `(cobranca-regua.mjs · Alto · M)`

**325. Aviso amigável antes do vencimento (D-3)** — 477 parcelas vencem nos próximos 30 dias (R$ 140 mil). Lembrar 3 dias antes é a cobrança mais barata que existe: sem clima de cobrança, evita o atraso na origem. Mesma mecânica da régua com sinal invertido. `(asaas_boletos PENDING · Alto · P)`

**326. Renegociação self-service no Portal** — O inadimplente escolhe entre 2-3 opções de parcelamento pré-aprovadas sem falar com ninguém (muita gente não paga por vergonha de ligar). Regras parametrizadas por faixa de atraso; boleto/PIX sai na hora pelo Asaas. `(portal-data + asaas-sync · Alto · G)`

**327. Acordo à vista com desconto por faixa de atraso** — Dívida de 90+ dias raramente volta inteira; oferta automática por faixa (10% até 60d, 20% acima de 120d) transforma carteira velha em caixa. Encaixa ao lado da negativação Serasa. `(asaas_boletos + NegativacaoPanel · Alto · M)`

**328. Sinal verde/amarelo/vermelho de risco por cliente** — Com 12,9 mil boletos de histórico dá para prever calote simples (quantas vezes atrasou, quantos dias, pagou após cobrança) e usar em dois momentos: priorizar cobrança e calibrar entrada/parcelamento de contrato novo. `(asaas_boletos + cliente_parcelas · Médio · M)`

**329. Simulador de antecipação de recebíveis** — "Posso antecipar R$ X, custo Y, recebo em Z dias" com as parcelas a vencer — informação pronta para quando faltar caixa para custas ou tráfego. `(asaas_boletos + API Asaas · Médio · M)`

**330. Promessa de pagamento que volta sozinha** — "Pago dia 10" vira registro + lembrete automático que cobra de volta se não entrou. A tabela `cobranca_promessas` existe com 1 linha — ninguém usa porque o ciclo não fecha sozinho. `(cobranca_promessas + reminder-cron · Médio · P)`

**331. Recibo automático de pagamento** — Pagamento confirmado dispara "recebemos, obrigado" com recibo no WhatsApp. Reduz prints, dúvidas e ligações. É um passo a mais no webhook que já emite a NF. `(asaas-webhook + kommo · Baixo · P)`

**332. Detector de processo parado** — São 3.452 processos espelhados com data do último andamento conhecida. Alerta de "sem movimento há 60/90 dias" evita o pior tipo de reclamação: a justa. `(bi_processos_log · Alto · M)`

**333. Central de prazos e tarefas vencidas dentro do app** — A última medição achou 800+ tarefas vencidas, visíveis só no Power BI. Trazer para o sistema, por pessoa, com aviso diário de quem está no vermelho. `(vw_bi_carga_atual · Alto · M)`

**334. Resumo mensal automático por cliente** — Uma vez por mês, cada cliente recebe em linguagem simples o que aconteceu (ou "nada mudou, é normal nesta fase"). O tradutor de andamentos e o glossário de 43 termos já existem para o bot. Antídoto mais barato contra a ligação "e o meu processo?". `(bot_config + bot_glossary + kommo · Alto · M)`

**335. Mensagem de aniversário** — 4.322 clientes com data de nascimento; a aba Clientes já calcula quem faz aniversário no mês — só não manda nada. Relacionamento barato + gancho para avaliação no Google. `(clientes.nascimento + kommo_queue · Baixo · P)`

**336. Minuta de inicial com IA a partir da ficha** — Resort, tipo de ação, valor pago, parcelas e fase já estão estruturados; gerar rascunho para o advogado revisar corta horas por processo. Começar por UM tipo de ação, com revisão humana obrigatória, medindo o tempo economizado. `(cliente_acoes_drive + clausulas.js + ANTHROPIC_API_KEY · Alto · G)`

**337. Correções do ADVBOX em um clique** — `vw_advbox_correcoes_pendentes` já aponta campo a campo o que diverge; falta o botão "corrigir" que faz o PUT e audita. Cadastro certo = cobrança, NF e petição sem retrabalho. `(vw_advbox_correcoes_pendentes · Médio · P)`

**338. Alerta de distribuição travada** — A mediana até distribuir é 23 dias e o gargalo comprovado é a ESPERA. Alertas em D+7 sem guia paga e D+15 sem distribuição atacam exatamente isso — receita adiantada. `(vw_processo_guia_paga + vendas_guias_custas · Alto · M)`

**339. Cobrar documentação faltante na primeira semana** — "Documentação faltando" hoje aparece por volta do dia 33 de vida do processo. Cruzar o que o contrato exige com o que o cliente entregou e cobrar do cliente na semana 1 (a estrutura de requisitos por tipo de ação já existe). `(vendas_documentos_* · Médio · M)`

**340. Medir e consertar a adoção do Portal** — Foram gerados 1.012 links de portal e só 15 tiveram QUALQUER acesso (~1,5%). O esforço inteiro do portal está sendo desperdiçado por falta de ENTREGA, não de produto. Primeiro: painel semanal com esse número. `(cliente_portal_tokens + portal_acessos_diario · Alto · P)`

**341. Entrega automática do link do portal ao assinar** — A função que manda o link por WhatsApp existe e depende de configuração manual. Enviar sozinho ao assinar (e reenviar em 30 dias) destrava o item anterior. `(kommo-portal-link + advbox-sync · Alto · P)`

**342. Avisar o cliente quando a fase muda** — O sistema já detecta mudança de fase e posta nota INTERNA; o cliente não fica sabendo. "Seu processo foi distribuído/sentenciado" é o momento de maior valor percebido do escritório. `(advbox_fase_notificada + kommo/push · Alto · M)`

**343. Upload de documentos pelo cliente no Portal** — Hoje documento chega por WhatsApp e alguém salva na mão. Botão de upload caindo direto na pasta certa do Drive elimina o retrabalho e acelera a distribuição. `(portal-data + save-to-drive · Alto · M)`

**344. NPS automático em marcos** — A pesquisa existe e tem 1 resposta porque nunca é pedida na hora certa. Perguntar após assinar, distribuir e sentença; nota alta vira pedido de avaliação no Google, nota baixa vira tarefa para o sócio. `(portal_nps + portal-feedback · Médio · M)`

**345. "Meu processo em um parágrafo" no Portal** — Abrir o portal com uma frase clara (onde está, o que vem, prazo típico) em vez de lista de andamentos técnicos. O texto traduzido já é produzido para o bot. `(portal-data + bot_glossary · Médio · M)`

**346. Gamificação da produtividade** — O ADVBOX devolve pontos por tarefa e o sistema grava há meses (22 mil tarefas com reward) — hoje só vira gráfico. Ranking mensal com meta e reconhecimento usa dado que já custou para coletar. `(payload.reward + vw_bi_produtividade · Médio · M)`

**347. Agenda do dia por WhatsApp para a equipe** — Toda manhã, cada pessoa recebe suas tarefas do dia, vencidas e videochamadas. Ataca a causa raiz das 800 vencidas; mesma infraestrutura de envio dos clientes. `(vw_bi_carga_atual + agenda + kommo · Alto · M)`

**348. Metas por vendedor com projeção diária** — `vendas_metas` existe e está VAZIA; hoje se descobre no dia 30 que a meta não bateu. "No ritmo atual você fecha 6 de 10" no dia 12 dá tempo de corrigir. `(vendas_metas + vw_funil_videochamadas · Alto · M)`

**349. Onboarding guiado de vendedor novo** — Roteiro de primeira semana (acessos, agenda conectada, playbook, primeira meta). Vendedor lento para produzir custa lead desperdiçado. `(user_permissions + Param. Vendas · Médio · M)`

**350. Pontualidade vira coaching semanal** — A view já mede o atraso do vendedor por call; um resumo semanal por pessoa com comparação de equipe muda comportamento sem briga. Impacto direto no no-show. `(vw_bi_vendedor_pontualidade · Médio · P)`

**351. Resumo da conversa do lead antes da call** — O histórico de WhatsApp já está espelhado no banco; 5 linhas de contexto geradas por IA ("comprou em 2019, paga R$ 480/mês, reclama de taxa") antes da videochamada é a melhoria de conversão mais barata do funil. `(schema atendimento + Claude · Alto · M)`

**352. Triagem automática das mensagens recebidas** — Classificar cada mensagem (dúvida de processo, cobrança, documento, reclamação, novo negócio) e rotear para a fila certa. O motor de intenções do bot já existe; falta a camada de classificação. `(bot_intents + worker do bot · Alto · M)`

**353. Ler o contrato do resort automaticamente** — O OCR hoje só lê CNH; extrair valor pago, cota e data do contrato de timeshare que o cliente já envia economiza minutos por caso e reduz erro na inicial (os campos de destino já existem na ficha). `(ocrService + cliente_acoes_drive · Alto · G)`

**354. Motivo de perda classificado por IA** — Saber por que o lead não fechou (preço, desconfiança, sumiu, já tinha advogado) direciona anúncio e argumentário. A vendedora quase nunca preenche; a conversa está gravada — a IA classifica em lote. `(kommo_lead_status + conversas + Claude · Médio · M)`

**355. Ligar o tradutor de andamentos por IA** — Está tudo pronto e DESLIGADO (`bot_config.ia.ativa=false`), inclusive o cache que evita custo repetido. Andamento em português comum, direto ao cliente. `(bot_config.ia + bot_ai_cache · Médio · P)`

**356. DRE simplificado do mês** — "Entrou − anúncio − comissão = sobrou", atualizado sozinho. Só nos últimos 30 dias entraram R$ 155 mil pelo Asaas, mas esse número nunca aparece ao lado do custo de mídia e das comissões — os três já estão no banco, em telas separadas. `(asaas_boletos + meta_ads_mensal + vendas_comissoes · Alto · M)`

**357. Simulador "e se eu aumentar a verba?"** — Com CPL, taxa de agendamento, comparecimento e fechamento medidos (122 meses de histórico Meta), dá para responder "com mais R$ 5 mil, quantos contratos a mais?" e mostrar onde a conta quebra (ex.: agenda das vendedoras lotada). Ferramenta de decisão, não relatório do passado. `(meta_ads_diario + funil + contratos · Médio · M)`
