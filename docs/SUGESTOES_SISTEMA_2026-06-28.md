# CBC Contratos — Sugestões de Melhoria do Sistema

> Auditoria multi-agente de 28/06/2026. **819 sugestões** em 26 categorias.
> Cada item: explicação simples · benefício · impacto/esforço · onde mexe.

Legenda — **Impacto**: alto/médio/baixo (quanto resolve). **Esforço**: baixo/médio/alto (trabalho pra fazer).


## 1. Seguranca & Privacidade  *(34)*

**1. Fechar a 'porta aberta' do banco (RLS allow-all)**  `impacto alto · esforço alto`
O banco hoje tem uma regra que diz 'qualquer um pode ler e escrever tudo'. A chave publica que vai no site (anon key) consegue, por isso, baixar TODOS os contratos, CPFs e dados de clientes, e ate alterar permissoes. Quem souber abrir o site e olhar o codigo dele consegue isso de fora, sem login.
*Benefício:* Impede vazamento de toda a base de clientes (CPF, contratos, valores) e alteracoes nao autorizadas. E o buraco mais grave do sistema.  
*Onde:* supabase_setup.sql (policy 'Allow all for anon' na tabela contratos) + user_permissions e demais tabelas; precisa coordenar com os outros apps que dividem o banco

**2. Proteger o atalho do ZapSign (criar/cancelar assinatura sem senha)**  `impacto alto · esforço baixo`
O arquivo zapsign-proxy.mjs nao pede nenhuma senha nem chave. Qualquer pessoa na internet pode chamar esse endereco e criar, cancelar ou baixar documentos de assinatura usando o token do escritorio. Verifiquei o arquivo inteiro: nao ha nenhuma verificacao de autorizacao.
*Benefício:* Evita que estranhos cancelem assinaturas em andamento, baixem contratos assinados de clientes ou gastem creditos do ZapSign do escritorio.  
*Onde:* client/netlify/functions/zapsign-proxy.mjs (sem checagem de chave nem limite de uso)

**3. Exigir que so admin de verdade troque permissoes**  `impacto alto · esforço medio`
A tela de Admin grava as permissoes (quem pode ver cada aba, quem e admin) usando a chave publica direto no banco. A unica 'tranca' e o site esconder a tela de quem nao e admin — mas isso e so visual. Com a chave publica e a regra allow-all, qualquer um consegue se dar admin master por fora do site.
*Benefício:* Garante que apenas o Paulo e admins reais mudem quem ve o que; impede que um funcionario (ou estranho) eleve os proprios poderes.  
*Onde:* client/src/components/AdminPanel.jsx (update direto em user_permissions) — proteger via RLS ou mover para uma function com service role

**4. Tirar a chave do banco de dentro do codigo das functions**  `impacto medio · esforço baixo`
Em api-rest.mjs e api-powerbi.mjs a URL e a chave do Supabase estao escritas direto no codigo (nao vem de variavel de ambiente). Se o codigo vazar ou alguem ler o site, a chave fica exposta de forma fixa, dificil de trocar.
*Benefício:* Permite trocar a chave rapidamente se ela vazar, sem reescrever codigo; reduz a superficie de exposicao.  
*Onde:* client/netlify/functions/api-rest.mjs e api-powerbi.mjs (SUPABASE_KEY fixa no arquivo) + fallback em client/src/lib/supabase.js

**5. Trocar as senhas-padrao fracas das APIs internas**  `impacto alto · esforço baixo`
Tres servicos usam senhas previsiveis quando ninguem configurou outra: 'cbc-api-2026' (API REST), 'cbc-powerbi-2026' (Power BI) e 'cbc-bot-2026' (bot). Como esses nomes estao no codigo, qualquer um pode adivinhar e usar. Vi que o proprio asaas-webhook chama outro servico com 'cbc-bot-2026' fixo.
*Benefício:* Impede que pessoas de fora puxem dados de contratos pela API ou acionem o bot/sincronizacoes usando a senha obvia.  
*Onde:* client/netlify/functions/api-rest.mjs, api-powerbi.mjs, advbox-bot-reply.mjs, portal-admin.mjs e asaas-webhook.mjs (defaults 'cbc-*-2026')

**6. Fechar os webhooks que aceitam qualquer chamada (fail-open)**  `impacto alto · esforço baixo`
Os webhooks do ZapSign e do Asaas, quando a senha de validacao nao esta configurada, processam qualquer mensagem que chega. No Asaas isso significa que alguem poderia forjar um 'pagamento confirmado' e disparar emissao de nota fiscal. O proprio codigo avisa isso nos comentarios.
*Benefício:* Evita notas fiscais emitidas indevidamente e mudancas de status forjadas; protege a contabilidade e a integridade dos contratos.  
*Onde:* client/netlify/functions/asaas-webhook.mjs (ASAAS_WEBHOOK_TOKEN) e zapsign-webhook.mjs (ZAPSIGN_WEBHOOK_SECRET) — configurar os segredos e mudar para fail-closed

**7. Nao guardar CPF em cache publico da internet**  `impacto medio · esforço baixo`
A consulta de CPF (cpf-lookup) guarda a resposta — que inclui nome e data de nascimento — por 30 dias no cache compartilhado da Netlify, e a 'chave' desse cache e o proprio CPF na URL. Isso coloca dado pessoal num armazenamento que nao e pensado para privacidade e expoe o CPF na URL.
*Benefício:* Reduz risco de LGPD: dado pessoal sensivel deixa de ficar parado num cache publico acessivel por URL previsivel.  
*Onde:* client/netlify/functions/cpf-lookup.mjs (Cache-Control 'public, s-maxage=2592000' com ?cpf= na URL)

**8. Nao colocar CPF e nome nos enderecos (URLs) das chamadas**  `impacto medio · esforço medio`
A API REST e a busca aceitam CPF e nome direto na URL (ex.: ?cpf=123 e ?search=joao). Enderecos com dado pessoal acabam gravados em logs de servidor, historico de navegador e cache. Esses registros viram copias de dados sensiveis espalhadas em lugares que ninguem controla.
*Benefício:* Diminui o rastro de CPF/nome em logs e historicos; melhora conformidade com a LGPD.  
*Onde:* client/netlify/functions/api-rest.mjs (?cpf=, ?search=) e api-powerbi.mjs — preferir busca via corpo (POST) e mascarar nos logs

**9. Reduzir o que a API REST devolve (hoje entrega tudo)**  `impacto medio · esforço baixo`
O endpoint /contratos/:id faz 'SELECT *' e devolve o registro inteiro do contrato, incluindo o campo 'dados' com TODOS os dados pessoais (RG, endereco, telefone, nascimento, links de CRM). Quem tiver a chave da API (que hoje e fraca) baixa o dossie completo de cada cliente.
*Benefício:* Mesmo que a chave vaze, o estrago e menor: o integrador externo so recebe os campos realmente necessarios, nao o dossie inteiro.  
*Onde:* client/netlify/functions/api-rest.mjs (rota GET /contratos/:id com select('*'))

**10. Melhorar a deteccao de login suspeito (hoje e facil de driblar)**  `impacto medio · esforço medio`
O aviso de 'login em horario incomum' usa o relogio do navegador do proprio usuario (new Date().getHours()), que qualquer um pode mudar. E o alerta so e gravado num registro com a regra allow-all, ou seja, pode ser lido/apagado por qualquer um com a chave publica. Na pratica, o controle protege pouco.
*Benefício:* Torna o alerta de acesso indevido confiavel e a trilha de auditoria intocavel — util para descobrir contas comprometidas.  
*Onde:* client/src/AuthContext.jsx (checkLoginAnomaly usa hora local + grava em activity_log allow-all)

**11. Trocar o limitador de chamadas por um que funcione de verdade**  `impacto medio · esforço medio`
O 'freio' que limita 30 chamadas por minuto guarda a contagem na memoria de cada instancia do servidor. Como a Netlify usa varias instancias ao mesmo tempo, o atacante so precisa cair em instancias diferentes para furar o limite. Na consulta de CPF, que custa R$0,25 por vez, isso pode virar conta alta ou ataque.
*Benefício:* Protege contra abuso da consulta paga de CPF e de forca-bruta em tokens do portal; evita custo e sobrecarga.  
*Onde:* client/netlify/functions/rate-limit.mjs (Map em memoria por instancia) — usar um armazenamento compartilhado (KV/Redis)

**12. Rotacionar os tokens que ja foram expostos**  `impacto alto · esforço baixo`
Varios tokens de servicos externos (Kommo, ADVBOX, consulta de CPF) ja foram expostos antes — em chat ou no proprio site. Mesmo que o codigo tenha sido limpo, o token antigo continua valido ate ser trocado no painel do servico. Token valido na mao errada = acesso ao CRM e a consultas pagas.
*Benefício:* Anula o estrago de exposicoes passadas; sem isso, limpar o codigo nao adianta porque a 'chave' antiga ainda abre a porta.  
*Onde:* Painel de variaveis da Netlify: KOMMO_TOKEN, VITE_ADVBOX_TOKEN, VITE_CPF_API_TOKEN (e conferir ASAAS/ZAPSIGN) — trocar no servico e na env

**13. Dar validade e limite aos links do Portal do Cliente**  `impacto medio · esforço medio`
O link do Portal do Cliente carrega um token na URL e da acesso a processos, boletos e dados do cliente. Hoje o token nao tem data de expiracao e a unica protecao contra tentativas e o freio por IP (que e fraco, como citado). Um link reenviado por engano, ou que vaze em um print, fica valendo para sempre.
*Benefício:* Limita a janela de risco se um link vazar; reduz exposicao de dados de cliente por link antigo esquecido.  
*Onde:* client/netlify/functions/portal-data.mjs e portal-admin.mjs (cliente_portal_tokens: sem expiracao/limite de tentativas)

**14. Proteger o canal de upload para o Google Drive**  `impacto medio · esforço medio`
O envio dos contratos assinados para o Drive passa por um endereco do Google Apps Script que esta fixo no codigo e nao parece exigir senha. Quem descobrir esse endereco pode tentar enviar arquivos para a pasta do escritorio ou abusar dele. O endereco esta visivel no codigo da function.
*Benefício:* Evita que terceiros injetem arquivos na pasta do Drive do escritorio ou usem o canal indevidamente.  
*Onde:* client/netlify/functions/save-to-drive.mjs (APPS_SCRIPT_URL fixo) — adicionar segredo compartilhado no Apps Script

**15. Configurar a chave de servico do Supabase (service role)**  `impacto alto · esforço medio`
Hoje varias automacoes do servidor gravam no banco usando a mesma chave publica do site. Isso obriga manter a regra allow-all (o buraco grave) para elas funcionarem. Com a 'chave de servico' configurada, as automacoes escrevem com poder proprio e o banco pode finalmente ser trancado para o publico.
*Benefício:* Destrava o fechamento da RLS allow-all sem quebrar as automacoes; separa o poder do servidor do poder do navegador.  
*Onde:* Netlify env SUPABASE_SERVICE_ROLE_KEY (nao configurada) — usada por zapsign-webhook.mjs e demais functions de escrita

**16. Restringir o CORS '*' nos endpoints com dados de cliente**  `impacto baixo · esforço baixo`
Quase todas as functions respondem com 'Access-Control-Allow-Origin: *', que significa 'qualquer site pode me chamar'. Para endpoints que devolvem dados de cliente (portal, API REST, Power BI), isso facilita que uma pagina maliciosa puxe os dados pelo navegador de um funcionario logado.
*Benefício:* Reduz a chance de outro site abusar das APIs usando a sessao/IP do escritorio; defesa em profundidade.  
*Onde:* Headers CORS em portal-data.mjs, api-rest.mjs, api-powerbi.mjs, advbox-bot-reply.mjs (Allow-Origin '*')

**17. Limpar dados pessoais que ficam parados no navegador**  `impacto baixo · esforço baixo`
O rascunho do contrato (com nome, CPF, endereco do cliente) e salvo no proprio navegador via localStorage para nao perder o trabalho. Em computador compartilhado do escritorio, esse dado fica guardado e visivel para o proximo que usar a maquina, mesmo apos o logout.
*Benefício:* Evita que dados de um cliente fiquem acessiveis ao proximo usuario do mesmo computador; melhora a privacidade no dia a dia.  
*Onde:* client/src/ContractContext.jsx (localStorage com dados do contrato) — limpar no logout e/ou avisar em maquina compartilhada

**18. Evitar registrar dados pessoais nos logs das automacoes**  `impacto baixo · esforço medio`
Varias functions usam console.log com dados que podem incluir nome, CPF ou ID de cliente. Esses registros ficam guardados nos logs da Netlify por tempo indeterminado e quem tem acesso ao painel ve tudo. Quanto menos dado pessoal nos logs, menor o risco se o painel de logs for acessado indevidamente.
*Benefício:* Reduz copias de dados pessoais espalhadas em logs; facilita conformidade com a LGPD.  
*Onde:* client/netlify/functions/*.mjs (varios console.log) — mascarar CPF/nome antes de logar

**19. Forcar HTTPS e cabecalhos de seguranca no site**  `impacto baixo · esforço baixo`
Vale conferir se o site envia os cabecalhos de protecao do navegador (forcar HTTPS sempre, impedir que o site seja aberto dentro de um iframe de terceiros, e restringir de onde vem scripts). Sao 'avisos' que o navegador respeita para dificultar varios tipos de ataque. O arquivo public/_headers e o lugar disso.
*Benefício:* Protege contra captura de sessao em conexao insegura e ataques de 'clique sequestrado' (clickjacking) com baixo esforco.  
*Onde:* client/public/_headers (HSTS, X-Frame-Options/CSP, Referrer-Policy) — validar/adicionar

**20. Encerrar sessoes automaticamente e revisar duracao do token**  `impacto baixo · esforço medio`
O login fica guardado no navegador e a sessao do Supabase se renova sozinha. Em escritorio com computadores compartilhados, vale ter um tempo de inatividade que faz logout sozinho, para uma sessao esquecida nao ficar aberta indefinidamente para o proximo usuario.
*Benefício:* Reduz risco de alguem assumir a sessao de um colega que esqueceu de sair; protege especialmente as contas admin.  
*Onde:* client/src/AuthContext.jsx (sessao Supabase persistida, sem timeout de inatividade)

**21. Tirar a 'chave-mestra' do Portal de dentro do site**  `impacto alto · esforço medio`
A mesma senha do painel do Bot (`VITE_BOT_PANEL_KEY`, hoje 'cbc-bot-2026') vai junto no codigo do site e e ela que autoriza a funcao `portal-admin` a GERAR e RENOVAR links de acesso de qualquer cliente. Quem abrir o codigo do site (visivel no navegador) descobre essa senha e pode criar para si mesmo um link de portal de qualquer cliente — vendo CPF, processos e cobrancas.
*Benefício:* Impede que um estranho fabrique acessos ao portal e leia dados de clientes que nao deviam.  
*Onde:* client/src/components/PortalClientePanel.jsx (VITE_BOT_PANEL_KEY) + netlify/functions/portal-admin.mjs

**22. Dar validade e renovar o link do Portal a cada acesso**  `impacto alto · esforço medio`
O link do cliente vai na propria URL (`/portal?t=...`) e nunca expira nem muda. Se o cliente encaminha esse link num grupo de WhatsApp, tira print ou troca de celular, qualquer pessoa que veja o endereco entra no lugar dele para sempre (CPF, andamento dos processos, boletos). Em portal-data.mjs nao ha checagem de validade — so 'ativo=true'.
*Benefício:* Um link vazado deixa de ser uma porta aberta permanente aos dados do cliente.  
*Onde:* client/netlify/functions/portal-data.mjs + tabela cliente_portal_tokens

**23. Parar de cachear contratos com CPF no cache publico da Netlify**  `impacto medio · esforço baixo`
A API de integracao (`api-rest`) responde GETs com `Cache-Control: public, s-maxage=120`, ou seja, manda o cache compartilhado da Netlify guardar a resposta. Essas respostas trazem nome e CPF dos contratantes. Dado pessoal de cliente nao deveria ficar parado num cache que e compartilhado por toda a rede.
*Benefício:* Evita que listas com CPF de clientes fiquem guardadas em cache que voce nao controla.  
*Onde:* client/netlify/functions/api-rest.mjs (GET_CACHE)

**24. Nao mandar a senha das APIs internas pela URL**  `impacto medio · esforço baixo`
As funcoes `api-rest`, `api-powerbi` e o painel do bot aceitam a senha de acesso tanto no cabecalho quanto coladas no endereco (`?api_key=...`, `?key=...`). Tudo que vai na URL costuma ficar registrado em logs de servidor, historico e proxies. Ou seja, a senha pode acabar gravada em varios lugares sem querer. Aceitar so pelo cabecalho elimina esse vazamento.
*Benefício:* A senha de quem puxa dados (Power BI, integradores) para de ser registrada em logs por engano.  
*Onde:* client/netlify/functions/api-rest.mjs, api-powerbi.mjs, advbox-bot-reply.mjs

**25. Comparar senhas de forma que nao 'denuncie' o tamanho certo**  `impacto baixo · esforço baixo`
As funcoes conferem a senha com uma comparacao comum (`token !== KEY`). Esse tipo de comparacao para de checar no primeiro caractere errado, e medindo o tempo de resposta da um pequeno palpite de quantos caracteres ja estao certos (ataque de tempo). O certo e usar uma comparacao 'de tempo constante' (timingSafeEqual), que e o padrao para conferir segredos.
*Benefício:* Fecha uma brecha tecnica que ajudaria alguem a adivinhar as senhas internas aos poucos.  
*Onde:* client/netlify/functions/api-rest.mjs, api-powerbi.mjs, portal-admin.mjs, advbox-bot-reply.mjs

**26. Validar quem entra de verdade pelo carimbo do servidor, nao pela hora do computador do usuario**  `impacto medio · esforço medio`
A deteccao de 'login estranho' usa a hora do RELOGIO do proprio computador de quem entra (`new Date().getHours()` no navegador) e pergunta a localizacao a um site externo (ipapi.co). Quem quer escapar so muda o relogio do PC ou usa uma VPN; e o IP do funcionario ainda e enviado a um terceiro. O ideal e fazer essa checagem no servidor, com a hora e o IP reais.
*Benefício:* A deteccao de acesso suspeito passa a ser confiavel e para de entregar o IP do time a um site de fora.  
*Onde:* client/src/AuthContext.jsx (checkLoginAnomaly)

**27. Esconder o CPF na busca de clientes do painel do Portal**  `impacto medio · esforço baixo`
Quando alguem busca um cliente para gerar o link do Portal, a funcao `portal-admin` devolve o CPF completo de cada resultado para a tela. Como essa funcao e protegida por aquela senha fraca/exposta do bot, o CPF de muitos clientes pode sair facil. Para escolher o cliente basta mostrar o CPF mascarado (ex: 123.***.***-09) — o numero inteiro nao precisa trafegar.
*Benefício:* Mesmo se a senha do painel vazar, o estrago de CPF exposto fica muito menor.  
*Onde:* client/netlify/functions/portal-admin.mjs (action 'search')

**28. Trocar o webhook por assinatura de verdade (HMAC), nao um 'segredo' no cabecalho**  `impacto alto · esforço medio`
Os avisos automaticos de ZapSign e Asaas conferem so um texto-segredo no cabecalho — e hoje funcionam mesmo SEM segredo (fail-open). O padrao seguro e a assinatura HMAC: o provedor assina o conteudo da mensagem com uma chave, e voce confere a assinatura. Assim ninguem consegue forjar um 'pagamento confirmado' (que dispara emissao de NF) nem um 'contrato assinado'.
*Benefício:* Bloqueia mensagens falsas que poderiam emitir nota fiscal ou marcar contrato como assinado indevidamente.  
*Onde:* client/netlify/functions/asaas-webhook.mjs, zapsign-webhook.mjs

**29. Adicionar o cabecalho que diz ao navegador para nao 'entregar' o link do Portal**  `impacto medio · esforço baixo`
Quando o cliente abre um link de dentro do Portal (ex: clica num boleto ou num site externo), o navegador pode enviar a pagina anterior — que contem o token secreto na URL — para o outro site (cabecalho Referer). O site `_headers` ja tem uma politica de referrer geral, mas a pagina do Portal precisa de uma mais rigida (no-referrer) para o token nunca vazar para terceiros.
*Benefício:* Garante que o codigo de acesso do cliente nao escape para sites externos quando ele navega.  
*Onde:* client/public/_headers (regra para /portal) + portal.html

**30. Pedir ao Google para nao indexar a pagina do Portal do Cliente**  `impacto baixo · esforço baixo`
O Portal e publico (acesso so pelo token na URL). Sem um aviso de 'nao indexar' (noindex), existe o risco de algum link com token acabar listado em buscadores, expondo dados do cliente a qualquer um que pesquisar. Um cabecalho X-Robots-Tag: noindex na rota do portal evita isso.
*Benefício:* Reduz a chance de dados de cliente aparecerem em resultados de busca da internet.  
*Onde:* client/public/_headers (rota /portal) / portal-manifest.mjs

**31. Reforcar senha e ativar 2 fatores no login do sistema**  `impacto alto · esforço medio`
O login usa so e-mail e senha (sem segundo fator) e nao ha regra visivel de senha forte. Como qualquer login da acesso a contratos, CPFs e financeiro do escritorio, vale exigir senha minima decente e ligar o segundo fator (codigo no app/SMS) que o Supabase ja oferece — principalmente para os administradores.
*Benefício:* Uma senha vazada de um funcionario deixa de ser suficiente para invadir o sistema todo.  
*Onde:* client/src/components/LoginScreen.jsx + config de Auth no Supabase

**32. Apagar a 'foto' de CPF que fica guardada por 30 dias no cache**  `impacto medio · esforço baixo`
A consulta de CPF (`cpf-lookup`) guarda o resultado de SUCESSO no cache compartilhado da Netlify por 30 dias, com a chave sendo o proprio numero de CPF. Isso significa que nome e data de nascimento de uma pessoa real ficam guardados nesse cache. Economiza centavos por consulta, mas e dado pessoal sensivel parado num cache de rede. Melhor manter so no navegador de quem consultou.
*Benefício:* Evita estoque de nome+nascimento de clientes num cache que voce nao controla.  
*Onde:* client/netlify/functions/cpf-lookup.mjs (Cache-Control s-maxage)

**33. Limitar a chamada externa por CONTA, nao so por endereco de internet**  `impacto medio · esforço medio`
O freio de chamadas (`rate-limit`) conta por IP e e guardado so na memoria de cada instancia da funcao. Como a Netlify roda varias instancias e o IP pode mudar (celular, redes compartilhadas), o limite e furado: vira muitas instancias, cada uma com seu proprio contador. Para a consulta de CPF (que custa dinheiro por chamada) convem um freio central de verdade e tambem por token/cliente, nao so por IP.
*Benefício:* Evita conta inflada na API de CPF e abuso de quem troca de IP para furar o limite.  
*Onde:* client/netlify/functions/rate-limit.mjs + cpf-lookup.mjs / portal-pergunta.mjs

**34. Restringir o que a API de integracao consegue ler e fazer**  `impacto medio · esforço medio`
A funcao `api-rest`, com uma unica senha, deixa LISTAR contratos (com CPF), abrir UM contrato com TODOS os campos (`select('*')`, incluindo observacoes internas) e ainda CRIAR contratos. Uma so chave faz tudo. O certo e separar permissoes (so leitura x escrita), nunca devolver o registro inteiro e esconder campos internos. Se ninguem de fora usa essa API hoje, vale ate desligar.
*Benefício:* Uma chave vazada para de dar poder total sobre os contratos do escritorio.  
*Onde:* client/netlify/functions/api-rest.mjs (GET /contratos/:id e POST)


## 2. Performance do Frontend  *(29)*

**35. Preview do contrato vira PDF a cada pausa de digitacao (desktop)**  `impacto alto · esforço medio`
No computador, toda vez que alguem para de digitar por 1,2 segundo, o sistema gera um PDF completo do contrato so para mostrar a previa do lado direito. Isso usa muito processador e pode travar a tela enquanto a pessoa preenche. No celular ja foi resolvido (mostra HTML rolavel). Daria para fazer o mesmo no desktop: mostrar o HTML do contrato direto, e so gerar PDF de verdade quando a pessoa clicar em 'Preview do PDF' ou 'Baixar'.
*Benefício:* Formulario muito mais leve e fluido ao digitar; menos travadas e menos consumo de bateria em notebooks  
*Onde:* client/src/components/LivePreview.jsx (caminho desktop com generatePdf/html2canvas) e App.jsx (handlePdfPreview)

**36. O 'motor de PDF' carrega o jspdf duas vezes (dobra o peso)**  `impacto medio · esforço medio`
O sistema gera PDF de duas formas: na tela principal e dentro de um 'trabalhador em segundo plano' (worker). Cada um carrega sua propria copia da biblioteca de PDF. No build de producao isso aparece como dois arquivos grandes (um de ~792 KB e outro de ~399 KB) com codigo praticamente repetido. Configurando o empacotador para os dois compartilharem a mesma copia, baixa-se quase 400 KB de download desnecessario.
*Benefício:* Menos megabytes baixados pelo usuario e menos consumo de banda do plano Netlify  
*Onde:* client/src/workers/pdfWorker.js + vite.config.js (manualChunks) — jspdf duplicado entre worker e jspdf.es.min

**37. A lista de chunks 'pesados' do build esta com nomes que nao batem**  `impacto medio · esforço baixo`
No arquivo de configuracao existe uma lista que deveria evitar que arquivos grandes (PDF, OCR, Excel) sejam pre-carregados antes da hora. Mas os nomes nessa lista (ex: 'vendor-pdf', 'vendor-ocr', 'tesseract') nao correspondem aos nomes reais que o empacotador gerou (ex: 'jspdf.es.min', 'html2canvas', 'es-'). Ou seja, parte da otimizacao nao esta fazendo efeito. Ajustar os nomes (ou agrupar essas libs em chunks nomeados) faz a economia funcionar de verdade.
*Benefício:* Carregamento inicial mais rapido — o navegador deixa de baixar bibliotecas pesadas que so seriam usadas depois  
*Onde:* client/vite.config.js (modulePreload.resolveDependencies, lista HEAVY_LAZY vs nomes reais em dist/assets)

**38. O leitor de documentos (OCR) nao e desligado depois de usar**  `impacto medio · esforço medio`
Quando alguem usa a leitura automatica da CNH, o sistema liga um 'motor de OCR' que carrega o idioma portugues e o nucleo de reconhecimento na memoria. Hoje o codigo usa o atalho 'recognize', que cria esse motor toda vez e nunca o desliga depois. Em uso repetido (varios cadastros seguidos), a memoria vai enchendo. Trocar para criar o motor uma vez, reusar e desligar (terminate) ao terminar evita esse acumulo.
*Benefício:* Menos uso de memoria e menos risco da aba ficar lenta apos varios cadastros com OCR  
*Onde:* client/src/utils/ocrService.js (Tesseract.recognize sem createWorker/terminate)

**39. Biblioteca de listas virtuais incluida mas nunca usada**  `impacto baixo · esforço baixo`
O sistema instala e importa a biblioteca 'react-window' (que serve para listas enormes) na aba de Contratos, mas o proprio comentario no codigo diz que ela nao e usada ali. Esse import morto adiciona peso ao arquivo da aba sem nenhum beneficio. Remover o import (e a dependencia, se nao for usada em mais lugar nenhum) enxuga o pacote.
*Benefício:* Arquivo da aba Contratos menor para baixar; dependencia a menos para manter  
*Onde:* client/src/components/ContratosTab.jsx (import FixedSizeList as List, linha 6) e package.json

**40. O formulario inteiro re-renderiza a cada tecla digitada**  `impacto medio · esforço alto`
Todos os campos do formulario (e a previa) leem o mesmo 'pacotao' de dados do contrato. Como esse pacote inteiro muda a cada letra digitada, o React precisa re-desenhar o formulario todo a cada tecla. Os formularios dos contratantes ja foram isolados (memo), mas o resto (clausulas, honorarios, secoes) ainda re-renderiza junto. Dividir o estado ou memoizar mais blocos reduz esse retrabalho.
*Benefício:* Digitacao mais responsiva, especialmente em maquinas mais fracas e no celular  
*Onde:* client/src/ContractContext.jsx (estado unico 'data') + FormPanel.jsx (secoes que consomem 'data' inteiro)

**41. A automacao em segundo plano roda em TODAS as abas abertas ao mesmo tempo**  `impacto medio · esforço medio`
A cada 5 minutos o sistema varre o banco e dispara integracoes (ZapSign, ADVBOX, Drive). Ja existe uma protecao para nao rodar com a aba escondida. Mas se a mesma pessoa tiver 3 abas do sistema VISIVEIS (ou em monitores diferentes), as 3 fazem a mesma varredura e podem brigar pelas mesmas travas, gastando consultas e invocacoes em dobro. Eleger so 'uma aba lider' (via BroadcastChannel/localStorage) elimina esse desperdicio.
*Benefício:* Menos consultas ao banco e menos invocacoes de funcao quando a pessoa tem multiplas abas abertas  
*Onde:* client/src/App.jsx (useEffect runAutomations, POLL_INTERVAL_MS)

**42. Detalhe do contrato e busca completa baixam o JSONB inteiro**  `impacto baixo · esforço baixo`
A lista de contratos ja foi otimizada para nao baixar o campo gigante 'dados' (JSON com tudo). Porem, quando se abre o detalhe de um contrato ou quando o realtime atualiza o item aberto, o codigo usa 'select(*)', que volta a puxar esse campo pesado. Para a maioria das telas de detalhe so alguns campos sao mostrados — selecionar so o necessario deixa a abertura mais rapida.
*Benefício:* Abrir o detalhe de um contrato fica mais rapido e gasta menos banda  
*Onde:* client/src/components/ContratosTab.jsx (handleViewDetail e realtime UPDATE, ambos com select('*'))

**43. Dashboard pode baixar ate 20.000 contratos com o endereco de cada cliente**  `impacto medio · esforço alto`
Ao abrir 'historico completo', o Dashboard pede ate 20 mil linhas e, junto, traz 'contratantes' (com endereco) de cada uma so para montar o mapa por estado. Conforme a carteira cresce, isso vira um download grande de uma vez. Daria para calcular a contagem por estado no banco (uma view/RPC que ja devolve 'UF: quantidade') em vez de baixar o endereco de todo mundo para o navegador somar.
*Benefício:* Dashboard abre mais rapido e usa menos banda a medida que a base cresce  
*Onde:* client/src/components/Dashboard.jsx (SELECT_COLS com contratantes_j:dados->contratantes, GeoHeatmap)

**44. Geracao de PDF usa imagem (foto) das paginas, gerando arquivos pesados e lentos**  `impacto alto · esforço alto`
O PDF do contrato e feito 'tirando uma foto' do HTML (html2canvas) e colando como imagem dentro do PDF. Isso e lento, esquenta o processador e gera arquivos maiores e com texto que nao da para selecionar/copiar. Para um documento que e basicamente texto, gerar o PDF como texto de verdade (ex: com a propria geracao DOCX/HTML->PDF textual) seria mais rapido e leve. E uma mudanca grande, mas resolve a raiz da lentidao do preview e do envio.
*Benefício:* PDFs menores, gerados mais rapido, com texto pesquisavel; menos travamento da tela  
*Onde:* client/src/utils/pdfGenerator.js (html2canvas + jspdf addImage)

**45. Confete e celebracoes disparam consultas extras ao banco em todas as abas**  `impacto baixo · esforço baixo`
Quando um contrato e assinado, cada aba aberta com o sistema dispara o confete E faz consultas para ver se bateu marco (100, 500...) e meta do mes. Como o realtime avisa todas as abas, varias fazem essas mesmas contagens ao mesmo tempo. Limitar a celebracao a uma aba (a mesma 'lider' da automacao) evita consultas repetidas a cada assinatura.
*Benefício:* Menos consultas ao banco por assinatura quando ha varias abas/usuarios online  
*Onde:* client/src/App.jsx (canal realtime 'contratos-status', bloco de celebracoes com select count)

**46. Busca global carrega a biblioteca de busca de forma fixa**  `impacto baixo · esforço baixo`
A janela de busca global (Cmd+K) ja e carregada sob demanda, mas dentro dela a biblioteca 'fuse.js' e importada de forma fixa. Isso esta ok porque a aba toda e lazy. Vale confirmar que o fuse.js so e baixado quando a busca abre de fato (e nao junto com algo do carregamento inicial), e que a base de contratos pesquisada nao recarrega tudo a cada abertura. Um pequeno ajuste garante que a busca nunca pese no arranque do app.
*Benefício:* Garante que o arranque do app nao carregue a biblioteca de busca sem necessidade  
*Onde:* client/src/components/GlobalSearch.jsx (import Fuse from 'fuse.js')

**47. Indicador 'Salvo ha X' e badge do Portal rodam timers continuos**  `impacto baixo · esforço baixo`
O cabecalho tem um relogio que atualiza 'Salvo ha 30s' a cada 10 segundos e um contador de duvidas do Portal que consulta o banco a cada 2 minutos — mesmo quando a aba esta em segundo plano. Sao custos pequenos, mas somados ao longo do dia geram re-renderizacoes e consultas a toa. Pausar esses timers quando a aba esta escondida (igual ja e feito com o health-check) elimina o desperdicio.
*Benefício:* Menos re-renderizacoes e menos consultas quando a aba nao esta sendo olhada  
*Onde:* client/src/App.jsx (AutosaveIndicator setInterval 10s; useEffect portalPendentes setInterval 120s)

**48. Lista de contratos some/recoloca elementos pesados no hover de cada linha**  `impacto baixo · esforço medio`
Cada linha da lista ja monta o conteudo de um tooltip (mini-ficha com CPF, resort, valor) escondido, mesmo antes de passar o mouse. Em listas com muitos itens, isso significa muito HTML criado de antemao. Renderizar o tooltip so quando o mouse realmente passa (ou usar um unico tooltip compartilhado) deixa a lista mais leve para desenhar e rolar.
*Benefício:* Lista de contratos rola mais suave, especialmente em paginas com muitos itens  
*Onde:* client/src/components/ContratosTab.jsx (ContratoRow — bloco group-hover/name com a mini-ficha)

**49. Worker de PDF e bem-vindo, mas html2canvas continua travando a tela principal**  `impacto medio · esforço baixo`
Parte da geracao de PDF ja foi movida para um 'trabalhador em segundo plano', o que e otimo. Porem, a etapa mais cara (a 'foto' do HTML com html2canvas) precisa rodar na tela principal e ainda e a que mais trava. Enquanto a solucao definitiva (PDF textual) nao vem, da para suavizar: reduzir a escala da foto (scale 2 -> 1.5) e a qualidade do JPEG so no PREVIEW ao vivo, mantendo alta qualidade so no PDF final enviado/baixado.
*Benefício:* Previa ao vivo gerada mais rapido e com menos travamento, sem perder qualidade no documento final  
*Onde:* client/src/utils/pdfGenerator.js (html2canvas scale:2 e toDataURL('image/jpeg',0.92))

**50. Contexto do contrato recria o objeto de funcoes mesmo so mexendo no texto**  `impacto medio · esforço alto`
O 'cofre' de dados do contrato (ContractContext) ja foi memoizado, o que e bom. Mas como o objeto 'data' inteiro e uma das dependencias, qualquer letra digitada recria o pacote que e passado para todos os componentes que consomem o contexto, forcando-os a reavaliar. Separar os DADOS (que mudam muito) das FUNCOES (que nunca mudam) em dois contextos faz so quem usa os dados re-renderizar, e nao quem so usa as funcoes.
*Benefício:* Componentes que so usam acoes (botoes, secoes estaveis) param de re-renderizar a cada tecla  
*Onde:* client/src/ContractContext.jsx (value unico com data + todas as funcoes)

**51. Atualizacao em tempo real de um contrato 're-incha' a linha da lista**  `impacto medio · esforço baixo`
A lista de contratos guarda so um resumo de cada contrato (para ser leve). Mas quando um contrato muda em tempo real, o sistema joga de volta na lista a versao COMPLETA (com todo o cadastro pesado dentro). Aos poucos a lista vai ficando pesada de novo, mesmo tendo sido feita pra ser leve.
*Benefício:* Mantem a lista leve e fluida o dia inteiro, sem ela engordar a cada mudanca  
*Onde:* client/src/components/ContratosTab.jsx (handler de UPDATE do realtime, ~linha 1138 — o '{...c, ...row}' traz o JSONB 'dados' inteiro)

**52. Preview do contrato e gerado em resolucao de impressao (2x), nao de tela**  `impacto medio · esforço baixo`
Para mostrar a previa do contrato na tela, o sistema tira uma 'foto' das paginas no DOBRO da resolucao (qualidade de impressao). Mas o que aparece e so uma previa de tela — nao precisa dessa qualidade toda. Isso dobra o trabalho e a memoria gasta a cada pausa de digitacao.
*Benefício:* Previa aparece mais rapido e gasta menos memoria/bateria  
*Onde:* client/src/utils/pdfGenerator.js (html2canvas com 'scale: 2') — usar escala menor no caminho de PREVIEW, manter 2x so na geracao final p/ ZapSign

**53. Leitor de PDF do OCR e baixado de um site externo toda vez**  `impacto medio · esforço baixo`
Quando alguem envia uma CNH em PDF para leitura automatica, o sistema baixa na hora uma ferramenta de PDF de um site externo (cdnjs). Se esse site estiver lento ou fora do ar, a leitura trava ou falha. E o sistema ja TEM uma ferramenta de PDF instalada internamente.
*Benefício:* Leitura de documento mais confiavel e sem depender de site de terceiros  
*Onde:* client/src/utils/ocrService.js (pdfToImage carrega pdf.js de cdnjs.cloudflare.com; ja existe pdf-lib/pdf no projeto)

**54. Leitura de CNH recria o 'motor de OCR' do zero a cada documento**  `impacto medio · esforço medio`
O programa que le o texto da CNH (OCR) e montado e o idioma portugues e recarregado por completo TODA vez que se le um documento. Para quem cadastra varios clientes seguidos, cada leitura paga esse custo de 'esquentar o motor' de novo, deixando lento.
*Benefício:* Da primeira leitura em diante, ler a CNH fica bem mais rapido  
*Onde:* client/src/utils/ocrService.js (usa Tesseract.recognize one-shot; criar um worker reutilizavel com createWorker e mante-lo aquecido)

**55. Foto da CNH em alta resolucao e lida sem reduzir antes**  `impacto medio · esforço medio`
Celulares modernos tiram fotos enormes (12+ megapixels). Essa foto gigante e entregue inteira para o leitor de texto, que se arrasta nela. Reduzir a foto antes (texto de CNH le bem em tamanho menor) acelera muito sem perder precisao.
*Benefício:* Leitura da CNH varias vezes mais rapida, principalmente no celular  
*Onde:* client/src/utils/ocrService.js (antes do Tesseract.recognize, redimensionar a imagem para ~1500-2000px de largura via canvas)

**56. Abrir um contrato da lista baixa a ficha completa duas vezes**  `impacto baixo · esforço baixo`
Quando voce abre o detalhe de um contrato e ele muda em tempo real (ex.: assinou), o sistema vai ao banco buscar a ficha COMPLETA de novo — mesmo a atualizacao em tempo real ja tendo trazido os dados. E uma ida ao banco extra que poderia ser evitada.
*Benefício:* Menos consultas ao banco e detalhe abre/atualiza mais rapido  
*Onde:* client/src/components/ContratosTab.jsx (handler UPDATE do realtime, ~linha 1141, faz select('*') do contrato selecionado a cada mudanca)

**57. Gerar PDF faz dezenas de 'medicoes' da pagina travando a tela**  `impacto medio · esforço medio`
Para o texto nao ser cortado entre paginas, o sistema mede a posicao de cada paragrafo e empurra os que cairiam na quebra — repetindo isso ate 30 vezes. Cada medicao forca o navegador a recalcular o desenho da tela. Em contratos longos isso trava a interface por instantes.
*Benefício:* Tela fica menos travada ao gerar o contrato, especialmente os longos  
*Onde:* client/src/utils/pdfGenerator.js (funcao avoidPageBreaks, loop com getBoundingClientRect — medir todos os elementos de uma vez antes de empurrar, em vez de reiniciar a cada ajuste)

**58. Foto da CNH e lida em formato pesado (PNG) na conversao de PDF**  `impacto baixo · esforço baixo`
Quando a CNH vem em PDF, o sistema converte a pagina para imagem usando o formato PNG, que e pesado. Para leitura de texto (OCR) um formato mais leve (JPEG) serve igual e ocupa muito menos memoria, ajudando celulares mais simples.
*Benefício:* Menos memoria usada e conversao mais leve em aparelhos fracos  
*Onde:* client/src/utils/ocrService.js (pdfToImage usa canvas.toBlob com 'image/png'; trocar por 'image/jpeg' com qualidade ~0.9)

**59. A biblioteca de busca difusa entra no pacote inicial mesmo sem buscar**  `impacto baixo · esforço baixo`
A ferramenta que faz a busca 'inteligente' (acha mesmo com erro de digitacao) e carregada junto com a tela de busca. Como ela so e usada quando a pessoa realmente digita algo, da pra carregar so na hora da primeira busca, deixando a abertura mais leve.
*Benefício:* Busca global abre mais rapido; biblioteca so carrega quando usada  
*Onde:* client/src/components/GlobalSearch.jsx (import fixo de fuse.js no topo; trocar por import dinamico na 1a busca)

**60. Cada paragrafo do contrato vira uma 'fatia' de imagem repetida no PDF**  `impacto medio · esforço alto`
Ao montar o PDF, o sistema cria uma copia da imagem da pagina inteira para CADA pagina (com recorte diferente). Em contratos de muitas paginas isso multiplica o tamanho e o tempo. Da pra recortar de verdade a imagem por pagina em vez de repetir a foto completa varias vezes.
*Benefício:* Arquivos PDF menores e geracao mais rapida em contratos longos  
*Onde:* client/src/utils/pdfGenerator.js (montagem do array 'images' reusa o mesmo dataUrl com offset; recortar por pagina reduziria o peso por pagina)

**61. A varredura automatica em 2o plano nao espera a tela aparecer**  `impacto baixo · esforço baixo`
A rotina que verifica assinaturas a cada 5 minutos roda assim que a aba esta visivel. Em aparelhos lentos ou no primeiro carregamento, ela pode competir com a montagem da tela, deixando a abertura mais 'dura'. Atrasar a primeira rodada (alguns segundos) deixa a tela aparecer primeiro.
*Benefício:* Abertura do sistema mais suave, sobretudo no celular  
*Onde:* client/src/App.jsx (useEffect de runAutomations, ~linha 603 — adiar a 1a execucao com um pequeno atraso/requestIdleCallback)

**62. A lista de contratos pode crescer sem limite na memoria conforme rola**  `impacto baixo · esforço alto`
A rolagem infinita vai empilhando contratos na tela e nenhum e descartado. Quem deixa a aba aberta e rola muito acumula centenas de cartoes vivos ao mesmo tempo, deixando a aba pesada com o tempo (o codigo ate cita que avaliou virtualizar, mas decidiu nao usar).
*Benefício:* Aba aguenta sessoes longas sem ficar lenta acumulando cartoes  
*Onde:* client/src/components/ContratosTab.jsx (contratos.map ~linha 1751, sem virtualizacao nem teto; considerar 'soltar' paginas antigas fora da tela)

**63. Conversao do PDF da CNH renderiza em resolucao alta demais**  `impacto baixo · esforço baixo`
Ao transformar o PDF da CNH em imagem para leitura, o sistema amplia a pagina em 2x. Some isso com a falta de reducao depois, e a imagem fica enorme. Para ler texto de documento, uma ampliacao menor ja basta e e bem mais leve.
*Benefício:* Conversao e leitura da CNH em PDF ficam mais rapidas e leves  
*Onde:* client/src/utils/ocrService.js (pdfToImage usa getViewport({ scale: 2 }); reduzir a escala para o necessario ao OCR)


## 3. Performance de Backend & Banco  *(33)*

**64. Encolher a tabela de auditoria (63 MB para guardar 190 contratos)**  `impacto medio · esforço medio`
Cada vez que alguem edita um contrato, o sistema guarda uma COPIA INTEIRA do contrato antes e depois (~5 KB por edicao). Como ja existe uma coluna que lista exatamente quais campos mudaram, da pra guardar so o valor antigo e novo DESSES campos, e nao o contrato todo.
*Benefício:* Tabela de auditoria sai de 63 MB para poucos MB; backups mais rapidos e leitura do historico mais leve.  
*Onde:* Gatilho 'audit_contratos_trigger' no Supabase + tabela contratos_audit (colunas before_data/after_data)

**65. Limpar auditoria antiga mais cedo (hoje so apaga depois de 1 ano)**  `impacto baixo · esforço baixo`
A rotina de limpeza so apaga registros de auditoria de insercao/edicao com mais de 365 dias. Como toda edicao guarda o contrato inteiro, a tabela so vai crescer ate o fim do ano. Reduzir para 180 dias (mantendo arquivamentos/exclusoes para sempre, que tem valor juridico) controla o crescimento muito antes.
*Benefício:* Banco para de inchar; a tabela de auditoria fica num tamanho previsivel.  
*Onde:* Funcao cleanup_old_logs em supabase_p1_scale.sql (interval '365 days' no DELETE de contratos_audit)

**66. Worker da fila Kommo roda toda hora cheia mesmo com fila vazia**  `impacto baixo · esforço baixo`
O processador da fila de mensagens para o Kommo (kommo-queue-worker) dispara A CADA MINUTO, 1.440 vezes por dia, mesmo quando nao ha nada para enviar. Na maioria das vezes ele so consulta o banco e nao acha trabalho. Da pra rodar a cada 2-3 minutos e disparar na hora quando algo entra na fila (o codigo ja tenta enviar na hora).
*Benefício:* Corta centenas de execucoes diarias inuteis; menos consumo de funcao e menos consultas vazias no banco.  
*Onde:* client/netlify/functions/kommo-queue-worker.mjs (schedule '* * * * *')

**67. Limpar a fila Kommo: registros 'done' e 'failed' nunca somem**  `impacto baixo · esforço baixo`
A tabela kommo_queue acumula tudo que ja foi processado (288 'concluidos' e 18 'falhos' guardados desde junho). Como o worker varre essa tabela toda hora, ela so cresce. Falta uma limpeza periodica dos 'done' antigos (ex.: mais de 7 dias).
*Benefício:* Fila enxuta e rapida de varrer; evita que a tabela cresca sem limite e degrade o worker.  
*Onde:* kommo_queue (Supabase) + _lib/kommoQueue.mjs (sem rotina de purge de 'done')

**68. Power BI ainda recalcula tudo na hora em vez de usar o resumo pronto**  `impacto medio · esforço medio`
Quando o Power BI pede o painel (table=dashboard), a funcao baixa TODOS os contratos e soma tudo em codigo a cada chamada. Ja existe um resumo pre-calculado no banco (a view dashboard_stats) e uma view nova (vw_powerbi_contratos). Apontar o Power BI para essas fontes elimina o recalculo.
*Benefício:* Resposta do BI quase instantanea e sem ler a tabela inteira a cada consulta.  
*Onde:* client/netlify/functions/api-powerbi.mjs (bloco table === 'dashboard')

**69. Atualizacao do resumo do dashboard a cada 5 min e exagerada**  `impacto baixo · esforço baixo`
Existe um resumo pre-calculado (dashboard_stats) que o banco recalcula automaticamente a cada 5 minutos, dia e noite. Com apenas 190 contratos e telas que ja calculam ao vivo, isso e trabalho repetido sem ganho. Reduzir para a cada 30-60 min (ou recalcular so apos uma assinatura) economiza processamento do banco compartilhado.
*Benefício:* Menos carga constante no banco que e dividido com varios outros sistemas do escritorio.  
*Onde:* pg_cron 'refresh-dashboard-stats' em supabase_p1_scale.sql ('*/5 * * * *')

**70. Faltam indices em chaves de ligacao das tabelas de Vendas e Portal**  `impacto medio · esforço baixo`
Varias tabelas (comissoes, documentos de vendas, leads, notificacoes, comentarios, views salvas, portal) tem colunas que apontam para outra tabela mas SEM indice. Quando essas tabelas crescerem, juntar os dados vai ficar lento. O proprio diagnostico do Supabase aponta 153 casos desses (parte e do CBC).
*Benefício:* Consultas que cruzam tabelas (comissoes por contrato, documentos por vendedor) continuam rapidas conforme o volume cresce.  
*Onde:* Supabase: vendas_comissoes_detalhe, vendas_documentos_*, vendas_leads_rapidos, notifications, contrato_comentarios, user_views, portal_access_log, portal_tokens

**71. Filtro de periodo do Dashboard usa 3 datas, mas so 1 tem indice**  `impacto baixo · esforço baixo`
O Dashboard busca contratos por data de criacao OU assinatura OU data ADVBOX. Hoje so a data de assinatura tem indice; 'data ADVBOX' nao tem nenhum. Com a carteira pequena (190 contratos) nao pesa, mas conforme crescer essa busca vai varrer a tabela inteira. Criar um indice na coluna advbox_date resolve preventivamente.
*Benefício:* Mantem o carregamento do Dashboard rapido quando o numero de contratos multiplicar.  
*Onde:* Supabase contratos.advbox_date (sem indice) + Dashboard.jsx linha ~150 (.or com 3 colunas)

**72. Indices da tabela espelho do Kommo quase nao sao usados**  `impacto baixo · esforço baixo`
A tabela kommo_leads tem indices que custam espaco e tornam cada gravacao mais lenta, mas quase nunca sao consultados: o indice de CPF (campo que o Kommo nem preenche, foi confirmado morto) teve so 3 usos, e o de contato 5 usos, ocupando 1 MB cada. Vale remover o de CPF e revisar o de contato.
*Benefício:* Gravacao diaria do espelho Kommo (17.900 leads) fica mais rapida e libera ~1 MB de indice inutil.  
*Onde:* Supabase: idx_kommo_leads_cpf e idx_kommo_leads_contact em kommo_leads

**73. Regras de seguranca repetidas deixam toda consulta mais lenta**  `impacto medio · esforço medio`
O diagnostico do Supabase aponta 305 casos de 'varias regras de permissao sobrepostas' e 78 casos onde a funcao de autenticacao e re-avaliada linha a linha. Isso faz o banco trabalhar mais em CADA leitura. Consolidar as regras e cachear a funcao de auth (envolver em 'select') reduz esse custo. Parte e do banco compartilhado, mas as tabelas do CBC podem ser tratadas.
*Benefício:* Toda consulta as tabelas afetadas fica mais leve, sem mudar o comportamento.  
*Onde:* Supabase: policies RLS em contratos, asaas_*, bi_*, portal_*, vendas_* (advisor: multiple_permissive_policies / auth_rls_initplan)

**74. Limite de seguranca de 20.000 linhas no Dashboard sem paginacao**  `impacto baixo · esforço medio`
O Dashboard pede ate 20.000 contratos de uma vez. Hoje sao 190, entao funciona, mas e um teto fixo: se um dia passar disso, os numeros ficam silenciosamente errados (o banco corta em 1.000 por padrao, contornado aqui pelo limite alto). O ideal e o Dashboard usar o resumo agregado do banco em vez de baixar contrato por contrato.
*Benefício:* Evita um erro silencioso futuro nos KPIs e reduz o volume baixado pelo navegador.  
*Onde:* client/src/components/Dashboard.jsx (.limit(20000)) — preferir dashboard_stats/agregados

**75. Limite de envios ao ADVBOX esta na metade do permitido**  `impacto baixo · esforço baixo`
O sistema so faz 15 chamadas por minuto ao ADVBOX, sendo que o limite e 30. Foi posto baixo de proposito para nunca brigar com outras integracoes. Quando o robo do WhatsApp ou o backfill processam muitos processos, isso deixa tudo mais lento. Da pra subir para ~20-22/min com seguranca, ja que ha controle de fila e espera automatica em caso de bloqueio.
*Benefício:* Backfill e sincronizacoes pesadas do ADVBOX terminam mais rapido, sem risco real de estourar o limite.  
*Onde:* client/netlify/functions/_lib/advbox.mjs (_maxPerMin = 15)

**76. Sincronizacao do Asaas dispara ate 8 chamadas simultaneas por bloco**  `impacto medio · esforço baixo`
Ao espelhar boletos, para cada bloco de 100 o sistema busca clientes, notas fiscais e PIX em ate 8 chamadas paralelas. Em blocos cheios isso vira rajadas que ja causaram bloqueio temporario (erro 429) do Asaas, exigindo esperas de 15s. Reduzir a concorrencia para 4-5 deixa o ritmo mais estavel e, no total, costuma ser ate mais rapido por evitar os bloqueios.
*Benefício:* Sync de boletos mais estavel, com menos bloqueios e menos esperas longas do Asaas.  
*Onde:* client/netlify/functions/_lib/asaasMirror.mjs (promiseMap concurrency=8 em processBlock)

**77. DataJud atualiza contrato por contrato com varias idas ao banco**  `impacto baixo · esforço medio`
A rotina diaria do DataJud percorre ate 500 processos e, para cada um, faz varias gravacoes separadas no banco (signed_at, numero do processo, fase...). Sao centenas de pequenas escritas. Juntar as atualizacoes de cada contrato numa unica gravacao reduz bastante o vai-e-vem com o banco.
*Benefício:* Rotina do DataJud termina mais rapido e com menos pressao no banco compartilhado.  
*Onde:* client/netlify/functions/datajud-refresh.mjs (multiplos supabase.update dentro do loop)

**78. Funcoes que rodam apos a assinatura sofrem 'partida a frio'**  `impacto baixo · esforço baixo`
As funcoes mais sensiveis ao tempo (mandar para ADVBOX e arquivar no Drive logo apos assinar) foram TIRADAS do aquecimento periodico por economia. O resultado e que, se ninguem usa o sistema ha um tempo, a primeira assinatura espera 1-3s a mais ate a funcao 'acordar'. Vale reavaliar manter so a advbox-sync aquecida nos horarios comerciais.
*Benefício:* Primeira assinatura do dia processa sem atraso perceptivel, sem custo grande de aquecimento.  
*Onde:* client/netlify/functions/keep-warm.mjs (FUNCTIONS_TO_WARM sem advbox-sync/save-to-drive)

**79. Dois vigias rodam a cada 30 min e quase sempre nao fazem nada**  `impacto baixo · esforço baixo`
Existem dois 'vigias' (monitor-watchdog e advbox-backfill-watchdog) que rodam a cada 30 minutos so para checar se algo travou. Na maior parte do tempo nao ha nada travado. Podem ir para a cada 60 min, ou um deles ser absorvido pelo outro, reduzindo execucoes pela metade.
*Benefício:* Menos execucoes agendadas repetidas; mesma seguranca de recuperar travas.  
*Onde:* client/netlify/functions/monitor-watchdog.mjs e advbox-backfill-watchdog.mjs ('*/30 * * * *')

**80. Painel de boletos baixa todos os boletos para a tela em paginas**  `impacto medio · esforço medio`
A aba Boletos carrega clientes e boletos em paginas de 1.000 e monta tudo no navegador (ja sao 12.234 boletos). Conforme isso cresce, a tela fica pesada para abrir. Calcular os totais e a faixa de inadimplencia direto no banco (uma funcao que ja existe para alguns casos) evita trazer tudo para o navegador.
*Benefício:* Aba Boletos abre rapido mesmo com a carteira crescendo; menos dados trafegados.  
*Onde:* client/src/components/BoletosPanel.jsx (paginacao .range em asaas_boletos/asaas_customers)

**81. Buscar PIX faltante no Portal e feito um de cada vez**  `impacto baixo · esforço baixo`
Quando o cliente abre o Portal e algum boleto pendente esta sem o codigo PIX, o sistema busca no Asaas ate 3 PIX, mas um apos o outro (sequencial). Buscar os 3 ao mesmo tempo deixa o carregamento do Portal um pouco mais rapido para o cliente.
*Benefício:* Portal do cliente carrega um pouco mais rapido quando ha PIX faltando.  
*Onde:* client/netlify/functions/portal-data.mjs (loop 'for (const p of semPix)' por volta da linha 410)

**82. Token anonimo do Supabase chumbado no codigo das funcoes**  `impacto baixo · esforço baixo`
Varias funcoes do servidor tem a chave do banco e a URL escritas direto no codigo (api-powerbi, datajud-refresh). Alem do ponto de seguranca, isso impede usar uma chave de servico com mais permissao e bater no problema conhecido de regras de acesso. Centralizar via variavel de ambiente facilita trocar a chave e melhorar permissoes sem editar varios arquivos.
*Benefício:* Permite no futuro usar a chave de servico (mais rapida, sem barreira de RLS) e trocar credenciais sem mexer no codigo.  
*Onde:* client/netlify/functions/api-powerbi.mjs e datajud-refresh.mjs (SUPABASE_KEY/URL hardcoded)

**83. Resumo da fila Kommo no Monitor le ate 2.000 linhas para contar**  `impacto baixo · esforço baixo`
Para mostrar o status da fila no Monitor, o sistema baixa ate 2.000 registros e conta no codigo. Um simples 'contar por status' direto no banco (com count) traz so os numeros, sem baixar as linhas. Pequeno hoje, mas cresce junto com a fila.
*Benefício:* Painel do Monitor abre instantaneo e nao baixa dados a toa.  
*Onde:* client/netlify/functions/_lib/kommoQueue.mjs (queueStats, .limit(2000))

**84. Crons quebrados por falta de chave: lembretes e webhook ZapSign**  `impacto alto · esforço baixo`
Duas pecas do sistema (o disparo de lembretes a cada 15 min e o aviso instantaneo de assinatura do ZapSign) so funcionam se uma chave especial (SUPABASE_SERVICE_ROLE_KEY) estiver configurada no Netlify. Hoje ela NAO esta. O codigo de reminder-cron retorna erro e para; o webhook ZapSign tambem. Ou seja: lembretes provavelmente nao saem e o aviso em tempo real de assinatura nao chega (so o robo de 5 min cobre).
*Benefício:* Religa lembretes e o aviso instantaneo de assinatura; para de gastar uma execucao a cada 15 min que so dá erro.  
*Onde:* reminder-cron.mjs e zapsign-webhook.mjs (exigem SUPABASE_SERVICE_ROLE_KEY no Netlify)

**85. Mapa de leads do Kommo pode ser cortado silenciosamente em 1000**  `impacto medio · esforço baixo`
A funcao que liga cada processo do ADVBOX ao lead do Kommo (usada para postar as notas automaticas) busca TODOS os contratos sem dizer um limite. O Supabase devolve no maximo 1000 linhas por vez, sem avisar. Hoje sao ~190 contratos, entao funciona; mas quando passar de 1000 os contratos mais novos vao sumir desse mapa e parar de receber nota no Kommo, sem nenhum erro aparente.
*Benefício:* Evita uma falha invisivel e dificil de diagnosticar quando a base crescer; garante que toda nota continue saindo.  
*Onde:* _lib/botDb.mjs (funcao getLawsuitLeadMap, sem .limit / paginacao)

**86. DataJud reconsulta TODO contrato assinado todo dia, mesmo sem novidade**  `impacto medio · esforço medio`
O robo do DataJud roda 1x/dia e, para CADA contrato assinado nao arquivado, faz uma ida ao ADVBOX buscar os detalhes do processo (ate 500 por rodada), mesmo que aquele processo nao tenha mudado nada ha meses. Isso consome o limite de chamadas do ADVBOX e cresce junto com a base.
*Benefício:* Menos chamadas ao ADVBOX, rodada mais rapida, sobra folga no limite compartilhado da conta.  
*Onde:* datajud-refresh.mjs (loop que faz advboxLawsuit por linha sem pular processos ja estaveis/distribuidos)

**87. Catalogo do ADVBOX (149 etapas/216 tarefas) recarregado a cada partida a frio**  `impacto medio · esforço medio`
O bot guarda na memoria o catalogo de etapas e tarefas do ADVBOX por 10 minutos. Mas essa memoria some sempre que a funcao 'esfria' (fica ociosa) e sobe de novo. Como o portal do cliente e o bot rodam em instancias diferentes e esporadicas, na pratica esse catalogo pesado e buscado do ADVBOX muitas vezes ao dia em vez de raramente.
*Benefício:* Menos chamadas pesadas ao ADVBOX e respostas mais rapidas do portal/bot.  
*Onde:* _lib/advbox.mjs (getSettings com cache so em memoria; guardar tambem em bot_config com validade)

**88. Fila Kommo reivindica jobs um por um (varias idas ao banco)**  `impacto baixo · esforço medio`
O worker da fila do Kommo, para pegar um lote de tarefas, primeiro lista os candidatos e depois faz uma atualizacao separada para CADA um, marcando como 'em processamento'. Sao muitas idas ao banco por rodada. Como ele roda a cada minuto, esse vai-e-volta se acumula.
*Benefício:* Menos consultas ao banco por rodada; worker mais rapido e mais barato.  
*Onde:* _lib/kommoQueue.mjs (claimBatch: select + UPDATE por linha; trocar por uma reivindicacao em lote)

**89. Limite do ADVBOX e contado por instancia, nao pela conta toda**  `impacto medio · esforço alto`
O controle que segura as chamadas ao ADVBOX em 15 por minuto vale apenas dentro de uma copia da funcao. Quando varias automacoes (bot, monitor, datajud, snapshot) rodam ao mesmo tempo, cada uma tem seu proprio contador de 15 — somadas, podem passar do teto real de 30/min da conta e levar bloqueio (erro 429).
*Benefício:* Evita bloqueios temporarios do ADVBOX que travam varias integracoes de uma vez.  
*Onde:* _lib/advbox.mjs (throttle em memoria por instancia; precisaria de um contador compartilhado no banco)

**90. Portal do Cliente remonta tudo a cada acesso, sem cache**  `impacto medio · esforço medio`
Toda vez que um cliente abre o portal, o sistema refaz a pagina inteira do zero: processos, andamentos traduzidos, pagamentos, feriados, FAQ. Nada e guardado por alguns minutos. Se o mesmo cliente recarregar, ou varios abrirem juntos, tudo e recalculado de novo, incluindo buscas ao vivo de PIX no Asaas.
*Benefício:* Portal abre mais rapido e gera menos consultas/chamadas externas em horarios de pico.  
*Onde:* portal-data.mjs (resposta com Cache-Control no-store; poderia cachear por token por alguns minutos)

**91. Tabela de andamentos do bot cresce sem nunca limpar**  `impacto medio · esforço baixo`
Desde que o backfill passou a gravar TUDO (andamentos e tarefas, ate os ocultos) na tabela bot_sync_state, ela so cresce. Nao ha rotina que apague linhas antigas ja comunicadas. Com ~5.300 tarefas/mes entrando, essa tabela vira uma das maiores e deixa as consultas dela mais lentas com o tempo.
*Benefício:* Mantem as consultas do monitor/portal rapidas e o banco enxuto.  
*Onde:* bot_sync_state (sem rotina de expurgo; criar limpeza de itens antigos ja comunicados)

**92. Cache de traducao por IA e conversas do bot sem expiracao**  `impacto baixo · esforço baixo`
As tabelas que guardam traducoes feitas pela IA (bot_ai_cache) e o historico de conversas/mensagens do bot (bot_conversations/bot_messages) crescem indefinidamente. Nenhuma tem uma rotina para apagar registros velhos que ja nao servem mais.
*Benefício:* Evita inchaço lento do banco e mantem buscas dessas tabelas rapidas.  
*Onde:* bot_ai_cache, bot_conversations, bot_messages (supabase_bot_advbox.sql; sem politica de retencao)

**93. Endpoint 'dashboard' do Power BI varre todos os contratos por chamada**  `impacto medio · esforço medio`
O endereco que o Power BI usa no modo 'dashboard' busca a tabela inteira de contratos e soma tudo na hora, sem limite e sem usar um resumo pronto. Tem um cache de 5 minutos, mas quando ele expira a varredura completa acontece de novo. Vai ficando mais pesado conforme a base cresce.
*Benefício:* Respostas mais rapidas para o Power BI e menos carga no banco.  
*Onde:* api-powerbi.mjs (ramo table=dashboard: select de contratos inteiro agregado em JS)

**94. Power BI nao recebe a contagem total para paginar direito**  `impacto baixo · esforço baixo`
Quando o Power BI puxa os contratos em paginas, a funcao devolve so a quantidade daquela pagina, nao o total geral. Sem saber o total, a ferramenta pode parar cedo demais ou puxar paginas a mais por tentativa, gastando chamadas a toa.
*Benefício:* Paginacao correta e previsivel; menos chamadas desperdicadas.  
*Onde:* api-powerbi.mjs (ramo table=contratos: pedir count exato e devolver o total)

**95. Vigia do monitor le historico e batimentos a cada 30 min sem necessidade**  `impacto baixo · esforço baixo`
Alem dos dois vigias ja citados, o monitor-watchdog roda a cada 30 minutos e sempre le ate 60 linhas de historico de saude mais a tabela de batimentos de todos os robos, mesmo quando esta tudo verde e nada mudou. E trabalho repetido na maioria das vezes.
*Benefício:* Menos leituras periodicas constantes; libera um pouco de execucao e banco.  
*Onde:* monitor-watchdog.mjs (le history + cron_heartbeat toda rodada; so agir quando houver mudanca)

**96. Reconciliacao do Asaas busca pagamento a pagamento na API**  `impacto baixo · esforço medio`
Quando o sistema confere boletos 'abertos' que sumiram da varredura, ele bate na API do Asaas um por um (em paralelo de 6), ate 150-400 por rodada, para descobrir o status atual de cada um. E correto, mas e muita chamada externa repetida toda vez que algo nao confere.
*Benefício:* Menos chamadas ao Asaas e rodada de sincronizacao mais leve.  
*Onde:* _lib/asaasMirror.mjs (reconcileStaleOpen: 1 GET /payments/{id} por boleto)


## 4. Arquitetura & Divida Tecnica  *(31)*

**97. Remover funcoes 'fantasma' que continuam publicadas no servidor**  `impacto medio · esforço baixo`
Existem 5 funcoes ainda ativas no ar (chatguru-send, chatguru-queue-processor, chatguru-trigger-evaluator, webhook-lead e advbox-lawsuit-refresh) cujo codigo-fonte ja foi apagado. Elas viraram 'zumbis': continuam respondendo a chamadas mas ninguem consegue mais ler/corrigir o que fazem.
*Benefício:* Fecha pontos de entrada esquecidos (risco de seguranca), evita confusao e cobranca de execucao a toa.  
*Onde:* client/.netlify/functions/ (zips sem .mjs correspondente em client/netlify/functions/)

**98. Quebrar o 'cerebro de automacoes' do App.jsx em um modulo proprio**  `impacto alto · esforço alto`
Dentro do App.jsx existe uma unica funcao gigante (runAutomations, ~280 linhas, linhas 604-880) que sozinha verifica assinaturas no ZapSign, dispara ADVBOX, manda pro Google Drive e escreve notas no Kommo. Esta tudo amontoado num arquivo de tela, dificil de testar e de mexer sem medo.
*Benefício:* Permite corrigir uma automacao sem arriscar quebrar a tela; possibilita testes automaticos dessa logica critica.  
*Onde:* client/src/App.jsx (runAutomations) -> mover p/ client/src/utils/automations.js

**99. Dividir a tela 'Contratos Salvos', hoje um arquivo de 2.165 linhas**  `impacto alto · esforço alto`
O ContratosTab.jsx tem um unico componente principal com 46 'estados/efeitos' empilhados e 1.380 linhas, alem de 7 mini-componentes colados no mesmo arquivo. E o tipo de arquivo onde uma mudanca pequena pode quebrar coisas distantes sem aviso.
*Benefício:* Menos bugs ao alterar, carregamento mais leve e codigo que um novo desenvolvedor entende mais rapido.  
*Onde:* client/src/components/ContratosTab.jsx

**100. Separar o formulario de cadastro do contratante (arquivo de 2.010 linhas)**  `impacto alto · esforço alto`
O FormPanel.jsx mistura, num so lugar, leitura de CNH por foto (OCR), busca de CEP, busca de CNPJ, busca de cliente por nome, validacao e desenho da tela. O componente interno ContratanteFormBase concentra quase tudo isso. E muito para um arquivo so.
*Benefício:* Cada pedaco (OCR, CEP, CNPJ) passa a ser testavel e reutilizavel; o formulario fica mais facil de evoluir.  
*Onde:* client/src/components/FormPanel.jsx (ContratanteFormBase)

**101. Criar um unico ponto de conexao com o banco para as funcoes do servidor**  `impacto medio · esforço medio`
Pelo menos 10 funcoes do servidor abrem a conexao com o banco Supabase por conta propria, copiando o mesmo trecho de codigo (7 de um jeito, 3 de outro). Quando precisar trocar uma configuracao (ex.: a chave de servico de seguranca que esta pendente), sera preciso editar dezenas de arquivos.
*Benefício:* Uma so mudanca passa a valer para tudo; facilita aplicar a chave de servico que ja esta pendente ha tempo.  
*Onde:* client/netlify/functions/*.mjs -> novo client/netlify/functions/_lib/supabase.mjs

**102. Unificar as duas versoes da funcao de envio ao Google Drive**  `impacto medio · esforço medio`
Existem save-to-drive.mjs (271 linhas) e save-to-drive-direct.mjs (129 linhas), que fazem essencialmente o mesmo trabalho de subir arquivo pro Drive em dois caminhos diferentes. Duas versoes do mesmo recurso tendem a desandar (uma e corrigida, a outra fica para tras).
*Benefício:* Garante que toda correcao de envio ao Drive valha para todos os fluxos, sem 'cura pela metade'.  
*Onde:* client/netlify/functions/save-to-drive.mjs e save-to-drive-direct.mjs

**103. Consolidar as funcoes duplicadas de sincronizar boletos do Asaas**  `impacto medio · esforço medio`
Ha asaas-sync-boletos.mjs e asaas-sync-boletos-background.mjs convivendo, alem de asaas-sync.mjs e asaas-sync-customer(s). Sao varias versoes 'parecidas' do mesmo assunto de cobranca. Isso aumenta a chance de uma corrigir um bug e a outra continuar com ele.
*Benefício:* Uma fonte unica para a sincronizacao de cobrancas reduz inconsistencias e custo de manutencao.  
*Onde:* client/netlify/functions/asaas-sync*.mjs

**104. Centralizar a lista de campos obrigatorios do contratante**  `impacto medio · esforço baixo`
A regra de quais campos sao obrigatorios (nome, CPF, Link Kommo, etc.) aparece copiada no FormPanel, no App.jsx e na tela de checklist pre-envio. Se uma regra mudar (como ja aconteceu com o Link Kommo virando obrigatorio), e preciso lembrar de alterar em 3 lugares — e e facil esquecer um.
*Benefício:* Evita o cenario classico de 'o formulario aceita mas o checklist barra' (ou vice-versa) por divergencia de regras.  
*Onde:* client/src/components/FormPanel.jsx (CONTRATANTE_FIELDS_PF/PJ), App.jsx (validateChecklist), PreSendChecklist.jsx

**105. Acertar o numero da versao do projeto (hoje diz 0.0.0)**  `impacto baixo · esforço baixo`
O arquivo de configuracao do projeto (package.json) marca a versao como '0.0.0', enquanto a versao real (v6.6.x) so existe escrita dentro do codigo da tela de novidades (ChangeLog.jsx). Isso confunde qualquer ferramenta ou pessoa que tente saber 'que versao esta no ar'.
*Benefício:* Rastreabilidade: deploys, rollbacks e logs passam a bater com a versao oficial, sem ambiguidade.  
*Onde:* client/package.json e client/src/components/ChangeLog.jsx

**106. Mover os mini-componentes de botao para fora do ContratosTab**  `impacto medio · esforço medio`
Botoes como AdvboxSyncButton, SaveToDriveButton e DownloadSignedButton estao escritos dentro do mesmo arquivo gigante da lista de contratos. Cada um carrega sua propria logica de chamada de servico. Tirados para arquivos proprios, ficam menores, testaveis e reutilizaveis em outras telas (ex.: Cards/Kanban).
*Benefício:* Reaproveitamento entre as visoes Lista/Cards/Kanban e arquivos menores e mais seguros de editar.  
*Onde:* client/src/components/ContratosTab.jsx (AdvboxSyncButton, SaveToDriveButton, DownloadSignedButton)

**107. Padronizar como o frontend chama as funcoes do servidor**  `impacto baixo · esforço baixo`
Em alguns pontos o codigo chama o caminho longo '/.netlify/functions/...' direto (ex.: dentro do App.jsx) e em outros usa o atalho padronizado (API/apiEndpoints). Misturar os dois jeitos dificulta trocar de provedor ou adicionar um proxy de seguranca depois.
*Benefício:* Um unico jeito de chamar o backend simplifica futuras mudancas de infraestrutura e seguranca.  
*Onde:* client/src/App.jsx (fetch '/.netlify/functions/advbox-sync') vs client/src/utils/apiEndpoints.js

**108. Limpar os arquivos legados de ChatGuru e Leads que ainda poluem o repositorio**  `impacto baixo · esforço baixo`
A integracao ChatGuru e a aba Leads foram desativadas, mas ainda existem varios arquivos espalhados (supabase_chatguru_automations.sql, supabase_leads.sql, migration 0005_chatguru_legacy.sql e copias soltas). Eles nao fazem nada hoje, so confundem quem procura o que esta de fato em uso.
*Benefício:* Menos ruido: buscas no codigo deixam de tropecar em coisa morta e o projeto fica mais honesto sobre o que usa.  
*Onde:* supabase_chatguru_automations.sql, supabase_leads.sql, supabase/migrations/0005_chatguru_legacy.sql

**109. Decidir o destino do backend antigo (server/) que foi removido pela metade**  `impacto medio · esforço medio`
A pasta server/ (o servidor Node com Puppeteer/backup S3) foi apagada do projeto mas ainda e descrita no guia como existente, e havia um plano nunca concluido de migrar de um arquivo unico (monolito) para uma versao modular. Esse 'meio do caminho' deixa duvida sobre quem faz o backup diario hoje.
*Benefício:* Clareza operacional: confirma se o backup diario continua rodando e elimina um plano de migracao abandonado.  
*Onde:* server/ (removido do repo) e secao 'server' do CLAUDE.md

**110. Extrair a logica de re-tentativa do Drive para um modulo testado**  `impacto medio · esforço medio`
As regras de quando tentar de novo o envio ao Drive (max 3 tentativas, lock orfao, erros que nao adianta repetir) estao parte como constantes soltas no topo do App.jsx e parte em driveRetry.js. Concentrar tudo num lugar so, com testes, protege uma das automacoes mais delicadas do sistema.
*Benefício:* Reduz risco de loop infinito ou de contrato 'preso' sem ir pro Drive; logica critica fica coberta por teste.  
*Onde:* client/src/App.jsx (DRIVE_* consts, isTransientDriveError) e client/src/utils/driveRetry.js

**111. Reduzir o App.jsx (1.742 linhas) extraindo os 'ouvintes' globais**  `impacto medio · esforço alto`
O App.jsx acumula muitos efeitos colaterais globais (atalhos de teclado, health-check, contadores, eventos de janela) — sao mais de 40 trechos do tipo. Esse arquivo virou o 'porao' onde tudo cai. Mover esses ouvintes para hooks dedicados deixa o arquivo principal enxuto.
*Benefício:* App principal mais leve e estavel; cada comportamento global passa a poder ser ligado/desligado isoladamente.  
*Onde:* client/src/App.jsx (multiplos useEffect com window listeners e setInterval)

**112. Separar logica pura de calculo da parte visual nos paineis grandes**  `impacto medio · esforço alto`
O Dashboard ja deu o bom exemplo: separou 'conta' (compute.js) de 'desenho' (widgets.jsx). Os demais paineis grandes (Contratos, FormPanel, Asaas/Boletos) ainda misturam calculo e tela no mesmo arquivo. Aplicar o mesmo padrao do Dashboard nesses paineis traz consistencia.
*Benefício:* Calculos viram testaveis sem abrir o navegador e a equipe segue um unico padrao ja validado.  
*Onde:* client/src/components/ContratosTab.jsx, FormPanel.jsx, BoletosPanel.jsx (espelhar dashboard/compute.js)

**113. Garantir que o lint cubra todo o codigo (ha erros pre-existentes ignorados)**  `impacto baixo · esforço medio`
O proprio historico do projeto cita que o MonitorPanel tem 12 erros de lint 'pre-existentes' que ficaram para tras. Quando se acostuma a conviver com erros, eles deixam de ser sinal de alerta e bugs reais se escondem no meio do barulho.
*Benefício:* O verificador automatico volta a ser confiavel e passa a pegar problemas reais antes do deploy.  
*Onde:* client/src/components/MonitorPanel.jsx e client/eslint.config.js

**114. Criar testes automaticos para o fluxo central de status do contrato**  `impacto alto · esforço alto`
Hoje so existem alguns testes em utils/__tests__. O coracao do sistema — a passagem rascunho -> enviado -> assinado e os disparos de ADVBOX/Drive/Asaas — nao tem teste automatico. Cada deploy depende de testar na mao, o que e lento e deixa brechas.
*Benefício:* Confianca para mexer no fluxo principal sem medo de quebrar a cadeia de assinatura/cobranca silenciosamente.  
*Onde:* client/src/utils/__tests__/ (ampliar p/ fluxo de status e automacoes)

**115. Adotar de vez o 'escudo' de consultas ao banco que ja existe**  `impacto medio · esforço medio`
Existe um utilitario (supabaseSafe.js) que protege as consultas ao banco com tempo-limite e avisa o usuario quando o banco esta lento. Foi criado para ser usado aos poucos, mas so 2 telas o usam — as outras 51 falam com o banco 'no cru', sem essa rede de seguranca.
*Benefício:* Quando o banco engasga, todas as telas avisam e nao travam, em vez de so duas.  
*Onde:* client/src/utils/supabaseSafe.js (so 2 de ~51 arquivos o usam)

**116. Ter UM unico historico oficial de mudancas no banco**  `impacto medio · esforço medio`
Hoje as alteracoes do banco estao guardadas em DOIS lugares diferentes: 11 arquivos soltos na raiz (supabase_*.sql) e uma pasta numerada (supabase/migrations/). Quem for entender o banco nao sabe qual e a versao verdadeira.
*Benefício:* Menos risco de aplicar uma mudanca errada ou perder o controle do que ja foi feito no banco.  
*Onde:* raiz (supabase_*.sql) vs supabase/migrations/

**117. Unificar a logica de re-tentativa do Google Drive (esta em dois lugares)**  `impacto medio · esforço medio`
Foi criado um modulo (driveRetry.js) para cuidar das re-tentativas de envio ao Drive, mas ele so faz a parte de 'resetar'. O cerebro que decide quando vale re-tentar continua copiado dentro do App.jsx (linha 83). Sao duas copias da mesma regra, que podem divergir.
*Benefício:* Uma so regra de re-tentativa, testavel — evita que envios ao Drive comecem a falhar de formas diferentes.  
*Onde:* client/src/App.jsx (isTransientDriveError, ~L83) vs client/src/utils/driveRetry.js

**118. Criar um 'cabecalho padrao' para as funcoes do servidor (CORS)**  `impacto baixo · esforço baixo`
O mesmo trecho de permissao de acesso ('Access-Control-Allow-Origin') esta copiado e colado em 35 funcoes do servidor. Se um dia precisar mudar a regra de seguranca, sao 35 lugares para arrumar um a um.
*Benefício:* Mudar a regra de acesso em um lugar so; menos chance de uma funcao ficar com a regra errada.  
*Onde:* client/netlify/functions/*.mjs (35 ocorrencias)

**119. Tirar os numeros 'magicos' do ADVBOX de dentro das funcoes**  `impacto medio · esforço baixo`
Ja existe um arquivo central com os codigos do ADVBOX (advboxMaps.mjs), mas alguns codigos fixos (como o do advogado responsavel, 241495) ainda estao digitados soltos no meio de duas funcoes. Se um codigo mudar, e facil esquecer de atualizar todos.
*Benefício:* Um lugar so para os codigos do ADVBOX — evita processo lancado com responsavel ou tipo errado.  
*Onde:* client/netlify/functions/advbox-sync.mjs e advbox-create-task.mjs

**120. Unir as DUAS conferencias de 'formulario completo'**  `impacto medio · esforço medio`
O sistema checa se o cadastro esta completo em dois lugares com codigos separados: um na tela do formulario (isFormComplete) e outro na hora de enviar para assinatura (validateChecklist no App). Como sao independentes, um pode liberar e o outro barrar — confundindo a secretaria.
*Benefício:* O botao de salvar e o gate de envio passam a concordar sempre; menos 'por que nao deixa enviar?'.  
*Onde:* client/src/App.jsx (validateChecklist) e client/src/components/FormPanel.jsx (isFormComplete)

**121. Quebrar o formulario do contratante, que mistura cadastro + OCR + buscas**  `impacto medio · esforço alto`
O 'miolo' do cadastro de uma pessoa (ContratanteFormBase) tem ~730 linhas e faz coisa demais ao mesmo tempo: campos de Pessoa Fisica e Juridica, leitura da CNH por foto, busca de CEP, busca de CNPJ e validacao de CPF. Tudo junto fica dificil de mexer sem quebrar.
*Benefício:* Alterar uma parte (ex: a leitura da CNH) sem risco de quebrar o resto do cadastro.  
*Onde:* client/src/components/FormPanel.jsx (ContratanteFormBase, ~L314-1043)

**122. Apagar de vez os restos do ChatGuru e do 'Leads'**  `impacto baixo · esforço baixo`
O ChatGuru (envio de WhatsApp antigo) e a aba de Leads foram desligados, mas sobraram arquivos do banco no repositorio (supabase_chatguru_automations.sql, 0005_chatguru_legacy.sql, supabase_leads.sql). Eles nao fazem nada, so confundem quem le o projeto.
*Benefício:* Repositorio mais limpo; ninguem perde tempo (nem reativa por engano) algo que ja morreu.  
*Onde:* raiz: supabase_chatguru_automations.sql, supabase_leads.sql; supabase/migrations/0005_chatguru_legacy.sql

**123. Evitar que uma funcao do servidor chame a outra 'por fora' pela internet**  `impacto medio · esforço medio`
Algumas funcoes do servidor, em vez de chamar outra diretamente, fazem um pedido pela internet para o proprio site (ex: asaas-webhook chamando kommo-asaas-sync por URL). Isso e mais lento e quebra se o endereco do site mudar ou a rede falhar no meio.
*Benefício:* Integracoes (Asaas->Kommo) mais rapidas e que nao falham por causa de rede entre as proprias funcoes.  
*Onde:* client/netlify/functions/asaas-webhook.mjs (~L113) e outras que chamam /.netlify/functions/

**124. Comecar a ter testes nas telas, nao so nos calculos**  `impacto medio · esforço alto`
Os 11 testes automaticos que existem cobrem so as 'contas' (calculos, mascaras). Nenhuma TELA tem teste. As telas gigantes (formulario, contratos) sao justamente as que mais quebram quando se mexe nelas, e nada avisa.
*Benefício:* Mexer no formulario ou na lista de contratos sem medo: o teste avisa antes de ir pro ar quebrado.  
*Onde:* client/src/components/ (0 testes) vs client/src/utils/__tests__ (11)

**125. Centralizar os 'nomes de status' do contrato em um lugar so**  `impacto medio · esforço medio`
As palavras de status ('assinado', 'enviado_zapsign', 'rascunho', 'cancelado') aparecem digitadas a mao em mais de 100 pontos do codigo. Um erro de digitacao (ex: 'assinou' em vez de 'assinado') passa despercebido e quebra contagem ou automacao silenciosamente.
*Benefício:* Impossivel digitar um status errado; renomear ou adicionar status fica trivial e seguro.  
*Onde:* client/src (~103 ocorrencias de 'assinado'/'enviado_zapsign'/'rascunho'/'cancelado')

**126. Padronizar os 'carregamentos sob demanda' espalhados no App.jsx**  `impacto baixo · esforço baixo`
Em varios pontos o App.jsx carrega geradores de PDF/assinatura na hora (await import) com o caminho escrito a mao, repetido. Se um arquivo for renomeado, esses pontos quebram um a um, e e facil esquecer.
*Benefício:* Um ponto unico para carregar PDF/assinatura; renomear arquivos sem cacar referencias soltas.  
*Onde:* client/src/App.jsx (await import de pdfGenerator/zapsignService, ~L812/1107/1124/1147)

**127. Faxina nos pacotes 'fantasma' que sobram na pasta de build**  `impacto medio · esforço baixo`
Na pasta de build local do Netlify sobraram pacotes (.zip) de funcoes que NAO existem mais no codigo (advbox-lawsuit-refresh, chatguru-*, webhook-lead). Vale confirmar se alguma delas ainda esta publicada no servidor respondendo sozinha, e limpar.
*Benefício:* Garante que nenhuma funcao 'morta-viva' fique rodando ou recebendo dados as escondidas.  
*Onde:* client/.netlify/functions/ (zips sem fonte: advbox-lawsuit-refresh, chatguru-*, webhook-lead)


## 5. UX — Formulario de Novo Contrato  *(31)*

**128. Botao 'Salvar Rascunho' sem validacao total**  `impacto alto · esforço medio`
Hoje os botoes Salvar/Gerar PDF so funcionam quando TODOS os campos estao preenchidos (isFormComplete em FormPanel.jsx). Se a secretaria comecou a digitar e precisa parar no meio, nao consegue salvar o que ja fez (so fica o rascunho automatico no proprio navegador, que some em outro computador). Falta um botao explicito para salvar parcialmente no banco como rascunho.
*Benefício:* Evita perder trabalho e permite continuar o cadastro de outro computador/celular.  
*Onde:* client/src/components/FormPanel.jsx (botoes de acao no fim + isFormComplete)

**129. Erros so aparecem quando se clica em Salvar/Enviar**  `impacto medio · esforço medio`
A lista vermelha detalhada de 'campos obrigatorios faltando' (validationErrors) so e calculada ao apertar um botao de acao. Antes disso, o usuario ve apenas as bolinhas de progresso, mas nao sabe exatamente QUAL campo de QUAL contratante esta vazio sem rolar e procurar.
*Benefício:* A pessoa corrige o que falta na hora, sem caca ao tesouro nem tentativa e erro.  
*Onde:* client/src/components/FormPanel.jsx (validateForm / validationErrors)

**130. Lista de erros nao leva direto ao campo com um clique**  `impacto medio · esforço medio`
Quando aparece a lista de campos faltando (ex: 'CPF', 'Cidade'), cada item e so um texto. Clicar nele nao rola a tela ate o campo. A pessoa precisa achar manualmente. As bolinhas de progresso ja rolam para a secao; os itens da lista de erro poderiam fazer o mesmo, indo direto ao campo exato.
*Benefício:* Correcao de erros fica muito mais rapida, principalmente com 2 contratantes.  
*Onde:* client/src/components/FormPanel.jsx (painel validationErrors)

**131. Botao habilitado mas envio bloqueado por formato do Link Kommo**  `impacto medio · esforço baixo`
O que libera os botoes (isFormComplete) so checa se o Link Kommo tem algum texto. Mas a validacao real (validateForm) exige o formato exato '.../leads/detail/NUMERO'. Resultado: o botao 'Enviar' aparece ativo, a pessoa clica, e so entao recebe o erro. O mesmo vale para data da 1a parcela ja vencida. O ideal e o botao refletir essas regras desde o inicio.
*Benefício:* Acaba a confusao de 'o botao estava ativo mas deu erro'.  
*Onde:* client/src/components/FormPanel.jsx (isFormComplete vs validateForm)

**132. Validacao de e-mail nao avisa quando esta errado**  `impacto alto · esforço baixo`
No campo de e-mail, o sistema mostra um 'check' verde quando o e-mail e valido, mas quando esta errado (ex: faltou o ponto no final) ele simplesmente nao mostra nada — nenhum aviso vermelho enquanto se digita. Como o e-mail e o endereco para onde vai o convite de assinatura, um erro aqui faz o cliente nunca receber o contrato.
*Benefício:* Pega e-mail digitado errado antes de o convite ZapSign se perder.  
*Onde:* client/src/components/FormPanel.jsx (useFieldValidation, caso 'email')

**133. RG sem nenhuma checagem de tamanho minimo**  `impacto baixo · esforço baixo`
O campo RG aceita praticamente qualquer coisa (a mascara so limpa caracteres estranhos) e a validacao so verifica se nao esta vazio. Um RG com 2 digitos passa. Falta um aviso visual simples quando o RG parece curto demais para ser real.
*Benefício:* Reduz RG digitado pela metade indo parar no contrato e no ADVBOX.  
*Onde:* client/src/utils/masks.js (maskRG) e validation.js

**134. Sugestao de cliente do historico nao avisa se o resort e diferente**  `impacto medio · esforço medio`
Ao buscar por nome, a lista mostra clientes anteriores e preenche tudo ao clicar. Mas se o cliente ja tem contrato para o MESMO resort que esta sendo cadastrado, isso so vira aviso de duplicata depois. Mostrar ali, na propria sugestao, um sinalzinho 'ja tem contrato neste resort' evitaria recadastro indevido.
*Benefício:* Evita criar contrato duplicado antes mesmo de preencher o resto.  
*Onde:* client/src/components/FormPanel.jsx (searchClientByName / lista de sugestoes)

**135. OCR da CNH nao mostra o que conseguiu ler antes de aplicar**  `impacto medio · esforço alto`
Quando le a foto da CNH, o sistema preenche os campos direto e os destaca por 3 segundos. Se leu algo errado (comum em foto tremida), o erro ja entrou no formulario e o destaque some rapido. Uma previa do tipo 'li: Nome X, CPF Y — confirmar?' deixaria a pessoa revisar antes de aplicar.
*Benefício:* Reduz dados errados vindos de foto ruim entrando no contrato.  
*Onde:* client/src/components/FormPanel.jsx (processCNHFile)

**136. Destaque de campos preenchidos pelo OCR/CEP dura pouco**  `impacto baixo · esforço baixo`
Os campos que o sistema preencheu automaticamente (por CNH ou CEP) ficam destacados so por 2-3 segundos. Quem desviou o olhar nao percebe quais campos foram preenchidos por ele e quais pela maquina, e pode confiar cegamente em dado automatico. Manter um marcador mais persistente (ex: pequena etiqueta 'auto') ajudaria a conferir.
*Benefício:* A pessoa sabe o que conferir com mais atencao.  
*Onde:* client/src/components/FormPanel.jsx (ocrFields / ocrClass / applyCepResult)

**137. Mensagem 'Preencha todos os campos para salvar' e generica**  `impacto medio · esforço baixo`
Quando o formulario nao esta completo, aparece so um aviso amarelo dizendo 'Preencha todos os campos para salvar', sem dizer quantos nem quais faltam. As bolinhas de progresso mostram 'X/Y' por secao, mas o aviso final poderia dizer direto 'faltam 3 campos: CPF do contratante 2, Cidade, Origem'.
*Benefício:* Tira a duvida do que ainda falta sem clicar e gerar erro.  
*Onde:* client/src/components/FormPanel.jsx (bloco 'Preencha todos os campos')

**138. Conferencia de e-mail e CEP-cidade so acontece no fim, no envio**  `impacto medio · esforço medio`
A checagem se o e-mail realmente existe (dominio) e se o CEP bate com a cidade so roda na tela de pre-envio (PreSendChecklist), na hora de mandar pro ZapSign. Para quem so vai salvar/gerar PDF, esses avisos nunca aparecem. Rodar a checagem de CEP x cidade junto ao campo, durante o preenchimento, pegaria o erro mais cedo.
*Benefício:* Endereco e e-mail errados sao pegos no preenchimento, nao na ponta.  
*Onde:* client/src/components/PreSendChecklist.jsx (verifyCEPCity/verifyEmailMX) e FormPanel.jsx

**139. Numero do endereco aceita texto livre sem padrao**  `impacto baixo · esforço baixo`
O campo 'Numero' do endereco e texto livre (inputMode numerico, mas nada impede letras). 'S/N' e valido, mas tambem entra coisa colada por engano. Como o numero vai pro endereco do contrato e do boleto, um aviso leve quando o campo tem caracteres estranhos evitaria endereco torto.
*Benefício:* Endereco mais confiavel no contrato e na cobranca.  
*Onde:* client/src/components/FormPanel.jsx (campo numero / handle)

**140. Reordenar clausulas por toque tem so setas, sem visao do todo**  `impacto baixo · esforço medio`
No celular/iPad as clausulas se reordenam com setinhas para cima/baixo, uma posicao por vez. Reordenar uma clausula do fim para o comeco exige muitos toques. Um modo 'mover para o topo / para o fim' ou arrastar simplificado ajudaria em contratos com varias clausulas avulsas.
*Benefício:* Montar a ordem das clausulas no celular fica menos cansativo.  
*Onde:* client/src/components/FormPanel.jsx (moveClausulaBy / botoes touch)

**141. Sem aviso ao trocar de contratante 2 para 1 (dados somem)**  `impacto medio · esforço baixo`
Se a pessoa selecionou '2 Contratantes', preencheu o segundo, e depois clica em '1 Contratante', os dados do segundo deixam de ser usados sem nenhum aviso. Em caso de clique errado, da pra perder bastante digitacao. Um aviso rapido ('o contratante 2 sera ignorado, confirma?') evitaria perda acidental.
*Benefício:* Protege contra perder o cadastro do segundo contratante por um clique.  
*Onde:* client/src/components/FormPanel.jsx (botoes 1/2 contratantes -> updateData numContratantes)

**142. Honorario personalizado nao avisa valores incoerentes**  `impacto medio · esforço baixo`
No modo de valor personalizado, da pra digitar total e parcelas livremente. Nada impede, por exemplo, 100 parcelas ou valor de parcela em centavos. Como isso gera os boletos do Asaas automaticamente, um aviso simples para numeros estranhos (parcelas acima de um limite razoavel, ou valor por parcela muito baixo) evitaria cobranca errada.
*Benefício:* Reduz risco de gerar dezenas de boletos errados sem querer.  
*Onde:* client/src/components/FormPanel.jsx (honorarios personalizado)

**143. Campo Profissao nao se ajusta sozinho ao genero ao ser escolhido da lista**  `impacto baixo · esforço baixo`
O sistema ja ajusta a profissao ao genero quando se muda o Sexo, mas se a pessoa escolher a profissao na lista de sugestoes (datalist) APOS definir o sexo, vem a forma neutra com '(a)' (ex: 'Advogado(a)'). Ajustar tambem nesse momento deixaria o contrato com a forma certa ('Advogada').
*Benefício:* Contrato sai com a profissao no genero correto, sem edicao manual.  
*Onde:* client/src/components/FormPanel.jsx (handle 'profissao' / adjustProfissaoGender)

**144. Aviso de data vencida da 1a parcela so aparece depois de digitada**  `impacto baixo · esforço baixo`
O campo da 1a parcela ja bloqueia datas passadas no seletor (min=hoje), mas quem cola uma data antiga ve o erro so depois. Como o Asaas recusa boleto com vencimento no passado, vale reforcar com um lembrete proximo ao campo de que a data precisa ser futura, antes de tentar enviar.
*Benefício:* Evita o envio falhar la na frente por data de cobranca invalida.  
*Onde:* client/src/components/FormPanel.jsx (input dataPrimeiraParcela)

**145. Secao de Clausulas comeca fechada e sem indicacao de conflitos**  `impacto medio · esforço baixo`
A secao 'Clausulas do Contrato' abre fechada por padrao e a bolinha de progresso dela e sempre verde ('done: true'). Se ha um conflito entre clausulas (detectado pelo ConflictDetector), o aviso aparece embaixo, fora da secao fechada. A pessoa pode nem perceber. Mostrar um sinal de alerta no cabecalho da secao quando ha conflito chamaria a atencao.
*Benefício:* Conflitos de clausula param de passar despercebidos.  
*Onde:* client/src/components/FormPanel.jsx (Section Clausulas / ConflictDetector)

**146. Selecionar cliente do historico apaga o que ja foi digitado**  `impacto alto · esforço medio`
Quando voce escolhe um cliente da lista de sugestoes (ou a busca por CPF acha no historico), o sistema sobrescreve TODOS os campos com o que estava salvo antes — inclusive limpando campos que voce acabou de digitar, se no cadastro antigo eles estavam vazios. Hoje isso acontece em silencio, sem avisar nem deixar desfazer.
*Benefício:* Evita perder dados recem-digitados e retrabalho de redigitar  
*Onde:* FormPanel.jsx — funcoes fillFromClient e o trecho de historico em handleCPFValidate

**147. Recuperar rascunho apos fechar o navegador sem querer**  `impacto alto · esforço medio`
Se a aba fechar, o computador travar ou a luz cair no meio do preenchimento, nao ha um aviso ao voltar dizendo 'voce tinha um contrato em andamento, quer continuar?'. O formulario guarda dados no navegador, mas nao oferece recuperar de forma visivel — a pessoa pode achar que perdeu tudo e comecar do zero.
*Benefício:* Da seguranca de que nenhum preenchimento longo se perde  
*Onde:* FormPanel.jsx + ContractContext.jsx (estado salvo no navegador)

**148. O destaque de 'campos obrigatorios vazios' nao funciona**  `impacto medio · esforço baixo`
Ao clicar em Salvar com campos faltando, o sistema tenta piscar os campos vazios procurando uma marca tecnica ('data-required') que nao existe em nenhum campo do formulario. Resultado: esse efeito de pulsar nunca acontece de verdade — e codigo que parece ajudar mas nao ajuda.
*Benefício:* Faz o destaque visual realmente apontar o que falta preencher  
*Onde:* FormPanel.jsx — handleValidatedAction (busca por '[data-required]')

**149. Erro ao gerar Word aparece em caixa cinza que trava a tela**  `impacto baixo · esforço baixo`
Se der erro ao exportar o contrato em Word (DOCX), aparece aquela caixinha cinza padrao do navegador ('alert') que bloqueia tudo ate clicar OK. O resto do sistema ja usa avisos discretos (toast) que somem sozinhos. Esse ponto ficou fora do padrao e parece mais assustador do que precisa.
*Benefício:* Mensagem de erro mais suave e no mesmo estilo do resto  
*Onde:* FormPanel.jsx — botao 'Exportar DOCX' (uso de alert)

**150. Bolinha de Clausulas fica sempre verde mesmo havendo conflito**  `impacto medio · esforço baixo`
Na barra de progresso do topo, a etapa 'Clausulas' aparece sempre como concluida (verde), mesmo quando o sistema detectou conflitos entre clausulas logo abaixo. A pessoa olha o topo, ve tudo verde e nem percebe que ha um alerta de conflito para resolver.
*Benefício:* Alinha o sinal verde com a existencia de conflitos reais  
*Onde:* FormPanel.jsx — useFormProgress (secao Clausulas com done fixo em true)

**151. Conflitos de clausula ficam escondidos com a secao fechada**  `impacto medio · esforço baixo`
A secao de Clausulas comeca recolhida e a contagem de conflitos so aparece dentro dela. Como o cabecalho fechado nao mostra um aviso ('2 conflitos aqui dentro'), a pessoa pode nunca abrir essa secao e enviar o contrato sem ver o problema.
*Benefício:* Torna conflitos visiveis mesmo sem abrir a secao  
*Onde:* FormPanel.jsx — cabecalho da Section 'Clausulas do Contrato' + ConflictDetector

**152. Dados lidos da CNH e do CPF aparecem no console do navegador**  `impacto medio · esforço baixo`
Ao ler a CNH (OCR) e ao buscar CPF, o sistema imprime os dados lidos no 'console' (a area de bastidores do navegador). Sao dados pessoais do cliente (nome, CPF, etc.) ficando registrados ali sem necessidade. Nao aparece na tela, mas e melhor nao deixar dado pessoal nesses registros.
*Benefício:* Reduz exposicao de dados pessoais (LGPD) sem custo de UX  
*Onde:* FormPanel.jsx — console.log em processCNHFile (resposta do OCR)

**153. O email do cliente que vai receber a assinatura nao e destacado (Pessoa Fisica)**  `impacto medio · esforço baixo`
Para empresa, o campo de e-mail mostra o aviso 'e-mail que assina' deixando claro para onde o convite do ZapSign vai. Para pessoa fisica esse aviso nao existe — entao um e-mail errado so e percebido quando o cliente reclama que nao recebeu nada. Vale deixar claro, ao lado do campo, que e ali que chega o link de assinatura.
*Benefício:* Diminui assinaturas que nao chegam por e-mail digitado errado  
*Onde:* FormPanel.jsx — campo E-mail do contratante (caso Pessoa Fisica)

**154. Falta um resumo do valor total e parcelas dos honorarios**  `impacto medio · esforço baixo`
Na secao de honorarios, ao escolher um valor ou digitar um personalizado, nao ha uma frase-resumo clara tipo 'Total R$ X em 6x de R$ Y, primeira em 10/07'. A informacao fica espalhada entre botoes e campos. Um resuminho ajuda a conferir de relance antes de gerar o contrato.
*Benefício:* Conferencia rapida do combinado financeiro, menos erro de valor  
*Onde:* FormPanel.jsx — Section 'Honorarios Advocaticios'

**155. Nao da para pular de um erro para o proximo**  `impacto medio · esforço medio`
Quando ha varios campos faltando, o sistema rola so ate o primeiro. Em um formulario longo com dois contratantes, a pessoa corrige um, mas precisa cacar manualmente os outros. Os erros listados na caixa vermelha tambem nao sao clicaveis para levar ao campo. Botoes 'proximo erro' / clicar no erro economizariam muita rolagem.
*Benefício:* Corrigir tudo mais rapido, sem procurar campo por campo  
*Onde:* FormPanel.jsx — painel 'Campos obrigatorios faltando' e handleValidatedAction

**156. Percentual de exito permite colar valor acima de 100%**  `impacto baixo · esforço baixo`
O campo de percentual de exito tem limites de 1 a 100, mas esses limites so valem para as setinhas; colando ou digitando '150' o sistema aceita. Um percentual impossivel passa para o contrato sem alerta na hora.
*Benefício:* Impede percentual invalido de entrar no contrato  
*Onde:* FormPanel.jsx — campo percentualExito na Section de Honorarios

**157. Mensagem 'sem creditos' na busca de CPF nao oferece proximo passo**  `impacto baixo · esforço medio`
Quando a consulta de CPF fica sem creditos, aparece um aviso pedindo para preencher o nome a mao e avisar o Bruno. Mas nao ha um atalho para isso (ex: botao para copiar um aviso, ou link). A pessoa precisa lembrar de avisar por fora, e as vezes esquece — e a consulta segue quebrada para os proximos.
*Benefício:* Acelera a recarga de creditos e evita ficar sem busca de CPF  
*Onde:* FormPanel.jsx — handleCPFValidate, caso SEM_CREDITOS

**158. Trocar entre Pessoa Fisica e Empresa nao avisa que os campos mudam**  `impacto baixo · esforço baixo`
Ao alternar o tipo do contratante para Empresa, surge um bloco grande de dados da empresa e os campos de pessoa passam a significar 'representante legal'. Quem nao conhece pode se confundir achando que perdeu dados ou que precisa repreencher. Um aviso curto explicando a mudanca reduziria a duvida.
*Benefício:* Menos confusao ao usar o modo Empresa pela primeira vez  
*Onde:* FormPanel.jsx — botoes Pessoa Fisica / Pessoa Juridica do contratante


## 6. UX — Lista e Gestao de Contratos  *(29)*

**159. Filtro rapido "Precisa de atencao"**  `impacto alto · esforço medio`
Hoje, para achar contratos com problema (envio ao Drive falhou, ADVBOX deu erro, ou assinado mas sem processo), a pessoa precisa abrir um por um e olhar os alertas vermelhos. Falta um botao que mostre so esses contratos numa lista. Sao campos que ja existem no banco (drive_file_id='failed', advbox_status='error').
*Benefício:* A secretaria ve num clique tudo que travou nas automacoes, em vez de descobrir por acaso ou so quando o cliente reclama.  
*Onde:* client/src/components/ContratosTab.jsx (barra de filtros de status, ~linha 1561)

**160. Habilitar arrastar cartoes no Kanban para mudar status**  `impacto medio · esforço alto`
As colunas Rascunho/Enviado/Assinado/Cancelado existem mas sao so para olhar — nao da para arrastar um cartao de uma coluna para outra. O proprio codigo diz "drag-drop futuro". Um Kanban que nao deixa mover frustra quem espera essa interacao.
*Benefício:* Permite mover/cancelar contratos visualmente, do jeito que todo mundo espera de um Kanban.  
*Onde:* client/src/components/contratos/KanbanView.jsx

**161. Marcador de comentarios na linha colapsada**  `impacto medio · esforço medio`
Os comentarios internos so aparecem depois de abrir o contrato. Na lista nao da para saber se um contrato tem conversa nem se ha mencao para voce. Mostrar um icone com a contagem (ex.: balao com "3") na linha resolveria isso.
*Benefício:* A equipe ve onde ja existe discussao sem abrir cada contrato, e ninguem perde uma mencao @ dirigida a ele.  
*Onde:* client/src/components/ContratosTab.jsx (ContratoRow, ~linha 557) + contratos/ContractComments.jsx

**162. Acoes em massa alem de arquivar (reenviar ADVBOX, exportar selecionados)**  `impacto medio · esforço medio`
No modo selecao so existe "Arquivar selecionados". Quando varios contratos assinados ficam pendentes no ADVBOX, nao da para reprocessar todos de uma vez — tem que abrir um a um. O mesmo vale para exportar so os selecionados.
*Benefício:* Resolve filas de pendencia em lote, economizando dezenas de cliques quando algo trava em varios contratos.  
*Onde:* client/src/components/ContratosTab.jsx (toolbar de selecao, ~linha 1660-1685)

**163. Exportar a lista filtrada para Excel direto na aba Contratos**  `impacto medio · esforço baixo`
O export para Excel existe no Dashboard, mas nesta tela (onde a pessoa de fato filtra contratos por nome/resort/status) nao ha botao de exportar. Quem precisa de uma planilha do que esta vendo tem que ir para outra aba e refazer os filtros.
*Benefício:* Tira relatorio do que esta na tela na hora, sem trocar de aba nem repetir filtros.  
*Onde:* client/src/components/ContratosTab.jsx (cabecalho de busca, ~linha 1530) + utils/excelExport.js

**164. Buscar tambem por tipo de acao e por quem criou**  `impacto medio · esforço baixo`
A busca cobre nome, CPF e resort, mas nao o tipo de acao (ex.: "distrato") nem o autor do contrato. Quem digita "distrato" ou o nome de um vendedor nao acha nada, mesmo existindo. Sao colunas que ja vem no resultado (tipo_acao, created_by).
*Benefício:* A busca encontra mais coisas do jeito que a pessoa pensa, sem precisar lembrar o nome exato do cliente.  
*Onde:* client/src/components/ContratosTab.jsx (montagem do filtro .or, ~linha 911-929)

**165. Corrigir o badge "Não abriu" usar status real do ZapSign**  `impacto medio · esforço medio`
O selo "Não abriu" aparece quando o numero de visualizacoes e zero, mas isso confunde em casos de contrato duplicado (a memoria do projeto registra clientes que assinaram mas a tela diz "nao abriu"). Vale diferenciar "sem dados de visualizacao" de "realmente nao abriu" e alertar quando o mesmo CPF+resort tem outro contrato.
*Benefício:* Evita decisoes erradas (cobrar quem ja assinou outro contrato) e reduz mal-entendidos com o cliente.  
*Onde:* client/src/components/ContratosTab.jsx (SignerName, ~linha 455)

**166. Download de assinados em ZIP unico (resolver bloqueio no iPhone)**  `impacto medio · esforço medio`
Ao baixar um contrato assinado, o sistema dispara varios downloads em sequencia (contrato, procuracao, relatorio). O proprio codigo avisa que no Safari/iPhone so o primeiro arquivo baixa — os outros sao bloqueados. Juntar tudo num unico arquivo .zip resolveria.
*Benefício:* No celular (onde muita gente trabalha) a pessoa passa a receber todos os documentos, nao so o primeiro.  
*Onde:* client/src/components/ContratosTab.jsx (DownloadSignedButton, ~linha 169-178)

**167. Tornar visivel o que cada bolinha da timeline significa**  `impacto medio · esforço baixo`
A linha de bolinhas (Salvo, Aguardando, Assinado, Pasta, Cliente ADVBOX, Processo ADVBOX, Kommo) mostra cor mas nao explica o estado nem a data de cada etapa ao passar o mouse / tocar. Quem nao conhece o fluxo nao entende por que uma bolinha esta apagada.
*Benefício:* Qualquer pessoa entende em que pe esta o contrato e quando cada etapa aconteceu, sem precisar perguntar.  
*Onde:* client/src/components/ContratosTab.jsx (ContractProgressBar / AutomationPipeline, ~linha 476)

**168. Resumo de contadores por status no topo da lista**  `impacto baixo · esforço medio`
Os botoes de filtro (Todos, Rascunhos, Enviados, Assinados, Cancelados) nao mostram quantos contratos ha em cada um. A pessoa so descobre clicando. Colocar a contagem dentro de cada botao (ex.: "Enviados 12") da uma visao geral imediata.
*Benefício:* Mostra de relance quantos contratos estao esperando assinatura ou ja assinaram, sem abrir cada filtro.  
*Onde:* client/src/components/ContratosTab.jsx (chips de status, ~linha 1561-1574)

**169. Botao "limpar" no campo de busca**  `impacto baixo · esforço baixo`
O campo de busca tem so a lupa. Para apagar o que digitou, a pessoa precisa selecionar e deletar manualmente. Um "x" dentro do campo para limpar com um toque e um padrao que todo mundo conhece e ajuda no celular.
*Benefício:* Apagar a busca fica num toque, principalmente no celular onde selecionar texto e chato.  
*Onde:* client/src/components/ContratosTab.jsx (input de busca, ~linha 1533-1540)

**170. Mostrar progresso e cor de status tambem nos modos Cards e Kanban**  `impacto medio · esforço medio`
Nos modos Cards e Kanban o cartao mostra nome, resort, valor e status, mas nao a linha de automacoes (Drive, ADVBOX, Kommo) nem destaque para o que falhou. So a visao Lista mostra isso. Quem prefere Cards/Kanban perde essa informacao importante.
*Benefício:* Quem usa Cards ou Kanban tambem ve de relance o que esta pendente, sem ter que voltar para a Lista.  
*Onde:* client/src/components/contratos/CardsView.jsx e KanbanView.jsx

**171. Indicar contratos com prioridade idoso na lista**  `impacto medio · esforço medio`
O sistema ja detecta cliente com 60+ anos como prioridade no formulario, mas a lista de contratos nao mostra nenhum sinal disso. Um selinho "Idoso" na linha ajudaria a tratar esses casos com a urgencia devida (prazos legais sao menores).
*Benefício:* A equipe nao esquece de priorizar processos de idosos, que tem tramitacao mais rapida por lei.  
*Onde:* client/src/components/ContratosTab.jsx (ContratoRow, badges ~linha 557-588)

**172. Botao de copiar/abrir todos os links de assinatura pendentes em massa**  `impacto medio · esforço medio`
Hoje, para reenviar links de quem ainda nao assinou, a pessoa abre cada contrato "Enviado" e copia o link individualmente. Um botao na linha (ou em lote) que copia so os links pendentes agilizaria a cobranca de assinatura via Kommo.
*Benefício:* Cobrar assinatura de varios clientes de uma vez vira questao de segundos.  
*Onde:* client/src/components/ContratosTab.jsx (SignerName/links de assinatura, ~linha 415 e 1834)

**173. Confirmacao mais leve para arquivar 1 contrato**  `impacto baixo · esforço baixo`
Arquivar um unico contrato hoje exige passar por um modal de motivo e ainda digitar a palavra "ARQUIVAR". Como arquivar e reversivel pelo admin, esse atrito todo (digitar a palavra) e exagerado para um item so — pode ser so um "Confirmar". A digitacao faz sentido para exclusao permanente, nao para arquivar.
*Benefício:* Arquivar fica rapido no dia a dia, sem perder a protecao nos casos realmente perigosos (exclusao).  
*Onde:* client/src/components/ContratosTab.jsx (handleArchive, ~linha 1345-1375)

**174. Lembrar a ultima visao (Lista/Cards/Kanban) e voltar para ela ao clicar num cartao**  `impacto baixo · esforço medio`
Ao clicar num cartao no modo Cards ou Kanban, o sistema joga a pessoa para o modo Lista para abrir o detalhe e nao volta. Quem trabalha em Kanban perde o contexto a cada clique. O ideal e abrir o detalhe sem trocar de visao, ou ter um "voltar ao Kanban".
*Benefício:* Quem prefere Cards/Kanban mantem seu modo de trabalho em vez de ser jogado para a Lista toda hora.  
*Onde:* client/src/components/ContratosTab.jsx (onCardClick dos modos, ~linha 1742-1745)

**175. Mostrar a idade de cada contrato pendente na linha**  `impacto alto · esforço baixo`
Hoje a linha so mostra a data de criacao. Um contrato enviado para assinatura ontem fica visualmente igual a um parado ha 30 dias. A ideia e exibir um selo tipo 'enviado ha 12 dias' (ficando laranja/vermelho conforme envelhece) ao lado do status, para os pendentes saltarem aos olhos.
*Benefício:* A equipe enxerga na hora o que esta encalhado e cobra o cliente antes do contrato esfriar.  
*Onde:* client/src/components/ContratosTab.jsx (componente ContratoRow, area do status/datas)

**176. Filtrar a lista por resort e por periodo de data**  `impacto alto · esforço medio`
Os botoes de filtro de cima so filtram por status (rascunho, enviado, assinado). Mas o sistema ja tem o resort e a data de cada contrato a mao. Daria para adicionar um seletor de resort e um de periodo (este mes, ultimos 30 dias) para achar 'todos do resort X assinados em junho'.
*Benefício:* Encontrar um grupo de contratos vira questao de 2 cliques em vez de rolar a lista inteira.  
*Onde:* client/src/components/ContratosTab.jsx (barra de filtros + a query fetchPage)

**177. Filtro 'Criados por mim' / por pessoa da equipe**  `impacto medio · esforço medio`
Cada contrato guarda quem o criou (aparece o nome em azul na linha). Mas nao da para filtrar por isso. Um botao rapido 'Meus contratos' e um seletor de autor deixariam cada secretaria/vendedor ver so o que e dela sem se perder no volume dos outros.
*Benefício:* Cada pessoa foca na propria carteira; reduz ruido e erro de mexer no contrato do colega.  
*Onde:* client/src/components/ContratosTab.jsx (filtros + query fetchPage, campo created_by)

**178. Navegar entre contratos com as setas do teclado**  `impacto medio · esforço medio`
Para abrir o detalhe de cada contrato hoje e preciso clicar um por um com o mouse. Adicionar navegacao por seta para cima/baixo para mover a selecao e Enter para abrir tornaria a revisao de varios contratos em sequencia muito mais rapida, especialmente no fim do dia.
*Benefício:* Revisar 20 contratos vira um fluxo continuo de teclado, sem tirar a mao do mouse a cada item.  
*Onde:* client/src/components/ContratosTab.jsx (lista de ContratoRow + handleViewDetail)

**179. Rolar o contrato recem-aberto para a posicao visivel**  `impacto baixo · esforço baixo`
Quando voce clica num contrato no meio da lista, ele se expande no lugar, mas o detalhe pode abrir parte fora da tela, obrigando a rolar para baixo. Fazer a tela centralizar automaticamente o contrato aberto economiza esse ajuste manual toda vez.
*Benefício:* O conteudo que voce quer ler aparece pronto na frente, sem rolagem extra.  
*Onde:* client/src/components/ContratosTab.jsx (handleViewDetail / bloco do detalhe expandido)

**180. Destacar a linha quando algo muda ao vivo (ex.: cliente assinou)**  `impacto medio · esforço medio`
O sistema ja atualiza a lista em tempo real quando um contrato muda. Mas a mudanca acontece em silencio. Um breve realce verde/amarelo na linha que acabou de mudar (ex.: passou para 'Assinado' ou o cliente abriu o link) chamaria a atencao para a novidade.
*Benefício:* Quem esta de olho na tela percebe na hora a assinatura ou abertura, sem precisar conferir manualmente.  
*Onde:* client/src/components/ContratosTab.jsx (handler de UPDATE do Supabase Realtime + ContratoRow)

**181. Subgrupos no Kanban dos assinados (ex.: por mes ou por situacao no ADVBOX)**  `impacto medio · esforço medio`
No quadro Kanban, a coluna 'Assinado' acumula tudo para sempre e fica gigante e inutil com o tempo. Quebrar essa coluna por mes de assinatura, ou separar 'ja foi pro ADVBOX' de 'pendente', deixaria o quadro util de novo.
*Benefício:* O Kanban volta a ser uma visao operacional em vez de uma pilha infinita.  
*Onde:* client/src/components/contratos/KanbanView.jsx

**182. Marcar visualmente os contratos travados nas automacoes**  `impacto alto · esforço medio`
As bolinhas mostram o progresso (assinado, pasta, ADVBOX, Kommo), mas um contrato assinado ha dias que nunca subiu pro Drive ou pro ADVBOX nao se distingue dos saudaveis na lista fechada. Um selo 'Automacao travada' na propria linha (sem precisar expandir) levaria a equipe direto ao problema.
*Benefício:* Erros de integracao deixam de passar despercebidos por dias e sao resolvidos cedo.  
*Onde:* client/src/components/ContratosTab.jsx (ContratoRow + getCompletedSteps)

**183. Mostrar quantos comentarios internos cada contrato tem, sem abrir**  `impacto medio · esforço medio`
Os comentarios da equipe so aparecem depois de expandir o contrato. Um pequeno balao com o numero de comentarios na linha fechada avisaria que ha discussao ali (ex.: 'cliente pediu prazo'), incentivando a abrir e ler antes de agir.
*Benefício:* Notas importantes do colega param de ficar escondidas; menos retrabalho e ligacao repetida.  
*Onde:* client/src/components/ContratosTab.jsx (select da lista + ContratoRow) e contrato_comentarios

**184. Visao 'Cards' e 'Kanban' tambem abrir o detalhe no lugar**  `impacto medio · esforço alto`
Hoje, clicar num card no modo Cards ou Kanban joga voce de volta para o modo Lista para ver o detalhe. Isso e desnorteante. Permitir abrir o detalhe em um painel lateral/modal sem trocar de modo manteria a pessoa onde ela estava.
*Benefício:* Quem prefere Cards/Kanban nao e expulso do modo escolhido a cada clique.  
*Onde:* client/src/components/ContratosTab.jsx + contratos/CardsView.jsx + contratos/KanbanView.jsx

**185. Botao 'Atualizar status' que diz quantos mudaram**  `impacto baixo · esforço baixo`
O botao de sincronizar ZapSign (icone de seta circular) gira em silencio e nao avisa o resultado. Trocar por um feedback claro ('2 contratos passaram para assinado' ou 'nada novo') daria confianca de que a verificacao rodou.
*Benefício:* A equipe sabe se vale a pena reabrir um contrato, em vez de ficar adivinhando.  
*Onde:* client/src/components/ContratosTab.jsx (funcao syncZapSign + botao da barra de busca)

**186. Resumo claro do que esta arquivado (motivo e quem arquivou)**  `impacto baixo · esforço baixo`
Ao ligar 'Ver arquivados', aparece a lista mas o motivo do arquivamento fica escondido num tooltip. Mostrar o motivo direto na linha ('Arquivado: cliente desistiu') e permitir filtrar por motivo ajudaria a auditar o que foi descartado e por que.
*Benefício:* Fica facil revisar e justificar contratos descartados sem caca ao tesouro.  
*Onde:* client/src/components/ContratosTab.jsx (ContratoRow, badge de arquivado + filtros)

**187. Evitar baixar o mesmo PDF assinado de novo do zero**  `impacto baixo · esforço medio`
O botao 'Baixar' do contrato assinado busca o arquivo do ZapSign e separa as paginas toda vez que e clicado, o que demora. Guardar por alguns minutos o resultado ja gerado (ou avisar 'preparando...') evitaria espera repetida quando a pessoa clica de novo ou erra o local de salvar.
*Benefício:* Download mais rapido na segunda tentativa e menos chamadas as integracoes.  
*Onde:* client/src/components/ContratosTab.jsx (componente DownloadSignedButton)


## 7. UX — Dashboard & BI  *(35)*

**188. Unificar o funil do Dashboard dos Sócios com o do Dashboard principal**  `impacto alto · esforço medio`
Hoje existem dois funis diferentes na mesma plataforma: o do Dashboard principal (com videochamadas, distribuídos, guia paga) e o do Dashboard dos Sócios, que ainda mostra uma etapa 'Leads (pipeline)' cujo número é falso — o próprio código diz que é só uma aproximação igual ao total de contratos. Isso dá a impressão de um funil que na verdade não existe. O ideal é o Sócios reusar exatamente o mesmo cálculo do funil principal, para os dois baterem.
*Benefício:* Números consistentes entre as duas telas e fim de uma etapa inventada que pode enganar a leitura de conversão  
*Onde:* client/src/components/SociosDashboard.jsx (computeSociosStats, bloco do Funil ~linha 1749) reusando client/src/components/dashboard/compute.js

**189. Corrigir cores fixas que quebram o modo escuro no Dashboard dos Sócios**  `impacto medio · esforço medio`
O Dashboard principal já foi todo migrado para usar 'cores do tema' (que se adaptam a claro/escuro), mas o Dashboard dos Sócios ainda tem dezenas de cores escritas na mão (azul-marinho, verde, dourado, fundos de etiquetas). No modo escuro, textos e fundos podem ficar com contraste ruim ou ilegíveis. A auditoria interna já apontou esse padrão como bug.
*Benefício:* Leitura confortável e profissional no modo escuro, sem texto sumindo no fundo  
*Onde:* client/src/components/SociosDashboard.jsx (várias cores #1B3A5C, #16A34A, #C9A84C, #DC2626 e badges inline)

**190. Fazer o mapa geográfico e o heatmap de horários seguirem os filtros da página**  `impacto medio · esforço baixo`
Quando você filtra o Dashboard por período, resort ou tipo de ação, quase tudo se ajusta — menos o bloco de 'Distribuição geográfica' e o 'heatmap de horários', que continuam mostrando a carteira inteira. Isso confunde: o resto da tela fala de um recorte e esses dois falam de outro. Eles deveriam respeitar o mesmo filtro.
*Benefício:* Coerência visual: a página inteira conta a mesma história do recorte escolhido  
*Onde:* client/src/components/Dashboard.jsx (passa allContratos cru para GeoHeatmap e HeatmapTemporal em vez do conjunto filtrado dash.idsFiltrados)

**191. Permitir filtrar por data de assinatura, não só por data de criação**  `impacto alto · esforço medio`
O filtro de período da página só olha a data em que o contrato foi criado. Mas a maioria dos indicadores importantes (receita, assinaturas, ticket) usa a data em que foi assinado. Resultado: um contrato criado em janeiro e assinado em março pode aparecer ou sumir de um jeito que não bate com a intuição. Um botãozinho para escolher 'filtrar por criação' ou 'por assinatura' resolveria.
*Benefício:* Relatórios de faturamento e produção do mês ficam exatos e sem surpresa  
*Onde:* client/src/components/dashboard/compute.js (filtragem em filtered usa sempre created_at) + FilterBar em widgets.jsx

**192. Clicar num resort/tipo da lista de desempenho deveria aplicar o filtro**  `impacto medio · esforço baixo`
Nas listas 'Resorts' e 'Tipos de ação' do Dashboard, cada linha tem barra e percentual, mas clicar nelas não faz nada. O natural é: clico num resort e a página toda passa a mostrar só aquele resort. Isso transforma a lista numa ferramenta de exploração rápida em vez de só um quadro estático.
*Benefício:* Exploração de dados muito mais rápida, sem ter que descer até o seletor de filtro  
*Onde:* client/src/components/dashboard/widgets.jsx (PerformanceList) ligando ao setResort/setTipoAcao do Dashboard.jsx

**193. Não rebuscar a tabela inteira ao exportar Excel**  `impacto baixo · esforço baixo`
Ao clicar em 'Excel', o sistema faz uma nova busca de TODOS os contratos no banco e depois descarta os que estão fora do filtro. Como os dados do recorte já estão carregados na tela, isso é trabalho dobrado e deixa a exportação mais lenta do que precisa, ainda mais conforme a carteira cresce.
*Benefício:* Exportação mais rápida e menos carga no banco de dados  
*Onde:* client/src/components/Dashboard.jsx (handleExportExcel refaz select completo)

**194. Dar ao Dashboard dos Sócios a mesma janela de carregamento do principal**  `impacto medio · esforço medio`
O Dashboard principal carrega por padrão só os últimos 18 meses e oferece um botão 'Carregar tudo' — isso deixa a tela abrir rápido. O Dashboard dos Sócios busca todos os contratos de uma vez, sem janela nem limite. Com o tempo isso vai ficando mais pesado para abrir, especialmente no celular.
*Benefício:* Abertura mais rápida da tela dos sócios e menos tráfego de dados  
*Onde:* client/src/components/SociosDashboard.jsx (fetchAll faz select sem janela/limit)

**195. Marcar visualmente quando os números mostram só os últimos 18 meses**  `impacto medio · esforço baixo`
O Dashboard mostra por padrão apenas a janela recente, mas alguém olhando um indicador como 'total no escopo' pode achar que é o histórico completo. Falta um aviso claro do tipo 'mostrando últimos 18 meses — carregar tudo' perto dos números afetados, não só no botão lá em cima, para ninguém tirar conclusão errada de um total parcial.
*Benefício:* Evita decisões baseadas em um total que parece completo mas não é  
*Onde:* client/src/components/Dashboard.jsx (estado fullLoaded; reforçar rótulo perto dos KPIs de total)

**196. Permitir ver todos os insights de uma vez, não só de 4 em 4**  `impacto baixo · esforço baixo`
O card de 'Insights automáticos' mostra 4 por vez e tem um botão 'gerar mais' que troca os 4 atuais por outros, em rodízio. Quem quer ter a visão completa precisa ficar clicando e tentando lembrar o que já passou. Um modo 'ver todos' (lista expandida) deixaria o sócio ler tudo de uma vez quando quiser.
*Benefício:* Leitura completa dos padrões detectados sem ficar adivinhando o que já passou  
*Onde:* client/src/components/dashboard/widgets.jsx (InsightsCard, janela rotativa)

**197. Liberar o comparador de meses e os deltas para mais perfis**  `impacto medio · esforço baixo`
As setinhas de variação 'vs mês anterior' e o comparador de dois meses só aparecem para Paulo e Bruno. Um advogado ou gerente que abre o Dashboard vê os números sem nenhuma referência se subiu ou caiu. Não é dado sensível (é só volume e conversão), então valeria liberar pelo menos os deltas para os demais usuários, ou para quem tem a aba Dashboard.
*Benefício:* Toda a equipe percebe tendência (subindo/caindo) sem depender de um sócio  
*Onde:* client/src/components/Dashboard.jsx (canCompare via SOCIOS_EMAILS) e widgets.jsx (KpiCard/HeroKpi)

**198. Adicionar seletor de período nas seções de Equipe e Operacional dos Sócios**  `impacto medio · esforço medio`
A 'Produtividade por advogado' e o funil operacional dos Sócios mostram sempre só o mês atual, sem como navegar para meses anteriores. Já as seções de comissão têm aquele seletor de período com setinhas. Padronizar e dar o mesmo seletor para as outras seções deixaria comparar 'como foi mês passado' sem precisar de outra ferramenta.
*Benefício:* Análise histórica da equipe direto na tela, sem exportar nada  
*Onde:* client/src/components/SociosDashboard.jsx (seções Operacional e Equipe usam mês corrente fixo)

**199. Avisar quando a 'Jornada de compra' está vazia por falta de preenchimento**  `impacto baixo · esforço baixo`
O card 'Jornada de compra' (dias da 1ª mensagem até a assinatura) depende de um campo opcional no contrato que muitas vezes não é preenchido. Quando está vazio o card só some ou mostra '—', sem explicar que a causa é o campo em branco. Uma frase curta tipo 'X% dos contratos do recorte não têm a data da 1ª mensagem' ajudaria a entender e a cobrar o preenchimento.
*Benefício:* Transparência sobre por que a métrica está incompleta e estímulo a preencher o campo  
*Onde:* client/src/components/dashboard/widgets.jsx (JornadaCard, estado vazio) + compute.js (jornada)

**200. Mostrar a projeção 'até o fim do mês' nos gráficos de mês corrente**  `impacto medio · esforço medio`
Gráficos como o de crescimento ano-a-ano (YoY) e a produção mensal mostram o mês atual com uma barra baixa, porque o mês ainda não acabou — o que parece uma queda assustadora quando na verdade é só o mês incompleto. Marcar o mês corrente como 'parcial' ou desenhar uma linha pontilhada de projeção evita o susto e a leitura errada.
*Benefício:* Ninguém entra em pânico achando que o mês despencou quando ele só não terminou  
*Onde:* client/src/components/SociosDashboard.jsx (gráfico YoY) e dashboard/compute.js/widgets.jsx (série mensal)

**201. Exportar o Dashboard dos Sócios completo (PDF/print) para reuniões**  `impacto medio · esforço medio`
O Dashboard principal já gera 'PDF de assinados' e Excel. O dos Sócios só exporta CSV solto por widget de comissão. Para levar a uma reunião de sócios, hoje é preciso tirar print de cada seção. Um botão de 'imprimir/PDF da visão completa' (ou ao menos um layout amigável para impressão) facilitaria muito o uso executivo.
*Benefício:* Material de reunião pronto em um clique, sem montar prints manualmente  
*Onde:* client/src/components/SociosDashboard.jsx (sem export consolidado)

**202. Tornar os números clicáveis levando ao recorte exato (drill-down navegável)**  `impacto medio · esforço medio`
Os cards de 'Ação necessária' já levam para abas, mas a maioria leva à aba sem já filtrar. Por exemplo, clicar em 'aguardando há 3+ dias' deveria abrir Contratos JÁ filtrado por enviados antigos. Hoje cai na lista geral e a pessoa precisa refazer o filtro lá. Passar o contexto do filtro na navegação fecha esse laço.
*Benefício:* Da percepção do problema à ação corretiva em um clique, sem refiltrar  
*Onde:* client/src/components/dashboard/widgets.jsx (ActionStrip onNavigate) + App.jsx (evento cbc:switchTab carregando filtro)

**203. Padronizar o donut e os funis com a mesma escala e legenda em todas as telas**  `impacto baixo · esforço medio`
O funil aparece em 3 lugares (Dashboard, Saúde do Funil, Sócios) com larguras de barra, pisos mínimos e rótulos calculados de jeitos um pouco diferentes. Para quem alterna entre as telas, a mesma realidade parece ter formas diferentes. Centralizar a forma de desenhar barra/percentual num único componente deixaria tudo visualmente consistente.
*Benefício:* Aparência uniforme do funil em todo o sistema, menos retrabalho de manutenção  
*Onde:* client/src/components/dashboard/widgets.jsx (FunnelCard), FunnelHealthPanel.jsx (FunilBarra), SociosDashboard.jsx (funil)

**204. Indicar claramente o que é 'estimativa' vs 'dado real' nos números**  `impacto medio · esforço baixo`
Vários números são aproximações que o código admite internamente: a data de cancelamento usa a 'última atualização' como substituta, a etapa Guia Paga é 'estado atual sem data própria', a receita futura é uma projeção. Para o usuário, tudo parece igualmente exato. Um pequeno selo de 'estimativa' ou um ícone de informação com a explicação evita que uma projeção seja tratada como fato.
*Benefício:* Decisões mais seguras, separando o que é certo do que é projeção  
*Onde:* client/src/components/dashboard/compute.js (canceladosJanela usa updated_at; guia_paga) e SociosDashboard.jsx (receita futura projetada)

**205. Dar um seletor de quantos meses comparar / período no comparador de meses**  `impacto baixo · esforço medio`
O comparador compara exatamente dois meses escolhidos em listas. Para enxergar tendência, seria útil também um modo rápido tipo 'este trimestre vs trimestre anterior' ou comparar contra a média dos últimos 3 meses, em vez de só mês cheio contra mês cheio. Isso reduz a chance de comparar um mês atípico contra outro atípico e tirar conclusão precipitada.
*Benefício:* Comparações mais estáveis e menos enganadas por um mês fora da curva  
*Onde:* client/src/components/dashboard/widgets.jsx (MonthComparator) + compute.js (comparador)

**206. Mostrar valor financeiro (R$) nas etapas do funil, não só quantidade**  `impacto medio · esforço medio`
O funil mostra quantos contratos avançam em cada etapa, mas não o quanto de honorários está parado em cada degrau. Para o sócio, saber que 'tem R$ X em contratos enviados aguardando assinatura' é tão importante quanto o número de contratos. O sistema já tem o KPI 'honorários a assinar' — levar esse valor para dentro do funil enriquece muito a leitura.
*Benefício:* Visão de quanto dinheiro está preso em cada etapa, ajudando a priorizar follow-up  
*Onde:* client/src/components/dashboard/widgets.jsx (FunnelCard) + compute.js (funil, já há pipelineAberto)

**207. Tratar o ranking de cidades/UF para não esconder concentração relevante**  `impacto baixo · esforço baixo`
No mapa por cidade só aparecem as 20 primeiras antes de 'mostrar todas', e o ranking é puro volume. Falta um corte simples mostrando, por exemplo, que 'top 3 estados = 70% dos clientes' ou o percentual de cada UF sobre o total. Esse tipo de leitura de concentração é mais útil estrategicamente do que uma lista longa de cidades.
*Benefício:* Enxergar de onde realmente vem a maioria dos clientes de relance  
*Onde:* client/src/components/GeoHeatmap.jsx (byEstado/byCidade, bloco de resumo)

**208. Deixar claro que 'Receita' conta só honorários iniciais, não o êxito**  `impacto alto · esforço baixo`
Em todo o Dashboard (KPI de receita, ticket médio, lista de Resorts, comparador de meses) o número de 'Receita' soma apenas os honorários iniciais (valor fixo). Os honorários de êxito — que muitas vezes são a maior parte do valor de um caso — ficam de fora, e isso só aparece numa letrinha pequena entre parênteses. Quem bate o olho pensa que é a receita total do escritório.
*Benefício:* Evita que sócio leia o número como receita total e tome decisão errada; sinceridade do dado  
*Onde:* client/src/components/dashboard/compute.js (ticket_medio, receita) e widgets.jsx (PerformanceList, MonthComparator)

**209. Mostrar também o potencial de êxito (%) ao lado da receita inicial**  `impacto alto · esforço medio`
Como a receita exibida ignora os honorários de êxito, o Dashboard nunca mostra o tamanho real do que o escritório pode ganhar. Daria para somar, ao lado da receita inicial, uma estimativa do êxito contratado (percentual × valor de referência) ou ao menos quantos contratos têm êxito pactuado, para o sócio ver os dois lados.
*Benefício:* Visão financeira completa: o que já entra vs o que pode entrar  
*Onde:* client/src/components/dashboard/compute.js + HonorariosCard/KpiCard em widgets.jsx

**210. Trocar os emojis de medalha do ranking por ícones do sistema**  `impacto baixo · esforço baixo`
No Dashboard dos Sócios, o pódio de duplas usa os emojis de medalha de ouro/prata/bronze escritos direto no código. O guia do projeto pede ícones da biblioteca padrão (heroicons) em vez de emojis, porque emoji aparece diferente em cada aparelho/sistema e destoa do visual sóbrio do escritório.
*Benefício:* Visual consistente entre aparelhos e alinhado à identidade  
*Onde:* client/src/components/SociosDashboard.jsx (seção Equipe, ranking top 3)

**211. Avisar de forma visível que os números mostram só os últimos 18 meses**  `impacto medio · esforço baixo`
Por desempenho, o Dashboard carrega só os últimos 18 meses por padrão e oferece um botão 'Carregar tudo'. Mas o usuário só descobre que está vendo um recorte se passar o mouse por cima do botão. Quem não percebe pode achar que um total está 'errado'. Um aviso fixo (ex.: faixa discreta 'mostrando últimos 18 meses — carregar histórico') tornaria isso óbvio.
*Benefício:* Elimina a sensação de 'número errado' e a dúvida sobre o que está sendo contado  
*Onde:* client/src/components/Dashboard.jsx (cabeçalho, botão 'Carregar tudo')

**212. Permitir exportar/baixar o mapa geográfico e o heatmap de horários**  `impacto baixo · esforço baixo`
O mapa de clientes por estado/cidade e o mapa de calor de horários de pico são úteis para reuniões, mas não dá para baixar nem em imagem nem em planilha — diferente do resto do Dashboard, que tem Excel e PDF. Um botão de exportar (CSV da tabela por UF/cidade e por hora) fecharia essa lacuna.
*Benefício:* Dados de geografia e ritmo aproveitáveis fora da tela, em apresentações  
*Onde:* client/src/components/GeoHeatmap.jsx e HeatmapTemporal.jsx

**213. Mostrar contratos 'sem honorários cadastrados' em vez de escondê-los**  `impacto medio · esforço baixo`
O cálculo de honorários já separa uma categoria 'Sem honorários' (contratos com valor zerado ou em branco), mas o card só destaca os três modelos pagantes — então um contrato sem nenhum valor lançado fica invisível no Dashboard. Mostrar essa contagem ajuda a flagrar contratos que esqueceram de preencher o financeiro.
*Benefício:* Pega contratos com financeiro em branco antes de virar prejuízo silencioso  
*Onde:* client/src/components/dashboard/widgets.jsx (HonorariosCard, dataset.nenhum)

**214. Deixar explícito que o topo do funil (videochamadas) e o resto não falam do mesmo grupo**  `impacto medio · esforço baixo`
No funil principal, as etapas de 'videochamada agendada/realizada' são contadas por data do evento e somam tudo o que já houve, enquanto 'enviados' e 'assinados' seguem o período e o grupo de contratos filtrado. As barras ficam na mesma escala visual, então parece que a videochamada vira contrato na sequência — mas são bases diferentes. Já existe uma divisória, mas o aviso poderia ser mais claro (ex.: 'períodos/grupos diferentes — não é conversão direta').
*Benefício:* Evita ler uma 'conversão' que não existe entre call e contrato  
*Onde:* client/src/components/dashboard/widgets.jsx (FunnelCard, scopeBreak) e FunnelHealthPanel.jsx

**215. Mostrar quando os dados do Dashboard dos Sócios e da Saúde do Funil foram atualizados**  `impacto medio · esforço baixo`
O Dashboard principal tem um selo 'Ao vivo / Desatualizado / Manual' com o horário da última atualização. O Dashboard dos Sócios e a Saúde do Funil não mostram nada disso — você não sabe se está olhando um número de agora ou de horas atrás. Um carimbo de 'atualizado às HH:MM' nesses painéis daria a mesma confiança.
*Benefício:* Confiança no número antes de decidir; igual ao Dashboard principal  
*Onde:* client/src/components/SociosDashboard.jsx e FunnelHealthPanel.jsx

**216. Ordenar os insights automáticos por gravidade e fixar os mais importantes**  `impacto medio · esforço medio`
Os insights automáticos (padrões e alertas) aparecem em blocos de quatro e o botão 'gerar mais' simplesmente troca por outros quatro, em rodízio. Um alerta crítico pode ficar 'escondido' na segunda leva. Ordenar pelos mais graves primeiro (alertas vermelhos no topo) e permitir fixar um insight evitaria perder o que importa.
*Benefício:* O alerta mais sério nunca fica fora da primeira tela  
*Onde:* client/src/components/dashboard/compute.js (array insights) e widgets.jsx (InsightsCard)

**217. Padronizar 'média' vs 'mediana' e explicar a diferença para o leitor**  `impacto baixo · esforço baixo`
A 'Jornada de compra' mostra prazos por média, a 'Tempo até distribuição' mostra média e mediana, e a Saúde do Funil usa só mediana. Para um advogado, 'mediana' não é óbvio. Vale uniformizar (ou mostrar os dois sempre) e adicionar uma explicação curta tipo 'mediana = o caso do meio, ignora extremos' num ícone de ajuda.
*Benefício:* Números de prazo comparáveis entre cards e compreensíveis  
*Onde:* client/src/components/dashboard/widgets.jsx (JornadaCard, DistribuicaoCard) e FunnelHealthPanel.jsx

**218. Tornar a 'Jornada de compra' por resort clicável, igual à de distribuição**  `impacto baixo · esforço medio`
No card 'Tempo até distribuição' dá para clicar num resort e ver os processos por dentro (drill-down). No card 'Jornada de compra', as barras por resort não são clicáveis — você vê a média mas não consegue abrir quais contratos puxaram o número para cima. Aplicar o mesmo comportamento dos dois deixaria a experiência consistente.
*Benefício:* Mesma capacidade de investigar o porquê do número nos dois cards de prazo  
*Onde:* client/src/components/dashboard/widgets.jsx (JornadaCard vs DistribuicaoCard)

**219. Evitar que as barras do funil estourem a largura no celular**  `impacto baixo · esforço baixo`
As barras do funil têm uma largura mínima fixa (90px). Em telas estreitas de celular, quando há várias etapas com rótulo grande ('Contratos enviados para assinatura'), o texto pode espremer ou vazar. Vale revisar essa largura mínima e o tamanho do rótulo no modo celular para o funil caber bem na tela pequena.
*Benefício:* Funil legível no celular, sem texto cortado  
*Onde:* client/src/components/dashboard/widgets.jsx (FunnelCard, minWidth: 90)

**220. Mostrar a meta também no comparativo, não só no mês corrente**  `impacto medio · esforço medio`
A barra de progresso da meta mensal aparece no card herói do mês atual. Mas quando o sócio compara dois meses (comparador) ou filtra um período passado, não há referência de 'bateu a meta daquele mês ou não'. Mostrar a meta vigente de cada mês comparado contextualizaria se o resultado foi bom ou ruim.
*Benefício:* Saber se cada mês comparado atingiu o objetivo, não só o número cru  
*Onde:* client/src/components/dashboard/widgets.jsx (MonthComparator) e compute.js (comparador)

**221. Dar um resumo em uma frase no topo do Dashboard ('como estamos hoje')**  `impacto medio · esforço medio`
O Dashboard abre direto em cartões e filtros. Falta uma frase de abertura que resuma o momento ('Você assinou X de Y contratos da meta este mês; Z aguardando há mais de 3 dias'). Isso dá leitura imediata para quem abre rápido no celular, antes de mergulhar nos cards.
*Benefício:* Leitura instantânea da situação sem precisar interpretar vários cards  
*Onde:* client/src/components/Dashboard.jsx (cabeçalho) usando dados de dash.acoes/dash.kpis

**222. Diferenciar visualmente quando um card está vazio por filtro vs por falta de dado**  `impacto baixo · esforço baixo`
Vários cards (Jornada, Distribuição, Top do mês) mostram 'sem dados no escopo' tanto quando o filtro atual não traz nada quanto quando o campo de origem nunca foi preenchido nos contratos. São causas bem diferentes: uma se resolve mudando o filtro, a outra exige preencher o cadastro. Mensagens distintas (com um botão 'limpar filtro' quando for o caso) evitam confusão.
*Benefício:* Usuário entende se o problema é o filtro ou o cadastro, e como agir  
*Onde:* client/src/components/dashboard/widgets.jsx (JornadaCard, DistribuicaoCard, TopMesCard)


## 8. UX — Navegacao & Fluxo Geral  *(29)*

**223. Guia de atalhos esta incompleto (faltam 4 atalhos reais)**  `impacto medio · esforço baixo`
A janela 'Atalhos do Teclado' lista 9 atalhos, mas o sistema na verdade tem mais: Ctrl+K (busca), Ctrl+Z (desfazer) e Esc (fechar/sair do modo foco) funcionam mas nao aparecem na lista. Quem abre o guia para aprender nunca descobre esses recursos.
*Benefício:* As pessoas passam a usar a busca rapida e o desfazer, que hoje ficam escondidos.  
*Onde:* client/src/components/ShortcutsGuide.jsx

**224. Aba lembrada pode abrir vazia quando o usuario perde acesso**  `impacto medio · esforço baixo`
O sistema lembra a ultima aba aberta. Se um usuario estava na aba 'Boletos' e depois perde a permissao, ao voltar o sistema cai silenciosamente no Dashboard, mas nenhuma aba fica marcada como ativa no topo, dando a impressao de que algo travou. Falta validar a aba salva contra as abas permitidas.
*Benefício:* Evita a sensacao de tela 'quebrada' e mantem a navegacao sempre coerente.  
*Onde:* client/src/App.jsx (estado mainTab, linhas 458-463 e fallback de render)

**225. Atalhos de aba so cobrem 3 das 12 abas**  `impacto baixo · esforço medio`
Existem atalhos Ctrl+1, Ctrl+2 e Ctrl+3 para as 3 primeiras abas, mas as outras 9 (Asaas, Boletos, Monitor, etc.) nao tem atalho. Quem usa muito o Asaas ou Boletos precisa sempre clicar. Daria para abrir a busca de comandos com as abas ou criar um seletor rapido de abas.
*Benefício:* Usuarios avancados (socios) trocam de aba sem tirar a mao do teclado.  
*Onde:* client/src/App.jsx (handler de atalhos, linhas 959-975)

**226. Busca global so encontra contratos, nao abas nem acoes**  `impacto alto · esforço medio`
O Ctrl+K abre uma busca que so procura contratos por nome/CPF/data. Num sistema com 12 abas e dezenas de funcoes, seria muito mais util se a mesma caixa tambem deixasse digitar 'dashboard' ou 'novo contrato' e pular direto pra aba/acao — virando um 'centro de comando'.
*Benefício:* Uma unica caixa resolve 'pra onde ir' e 'o que fazer', reduzindo cliques.  
*Onde:* client/src/components/GlobalSearch.jsx

**227. As 12 abas no topo sobrecarregam visualmente**  `impacto medio · esforço alto`
No desktop, todas as 12 abas ficam lado a lado numa linha so. Ja existe um separador sutil entre grupos, mas a lista plana ainda e muita informacao de uma vez. Agrupar visualmente (ex.: 'Criar', 'Analise', 'Financeiro', 'Gestao') com rotulos ou um menu para abas menos usadas reduziria a carga mental.
*Benefício:* Fica mais facil achar a aba certa; menos 'parede de botoes'.  
*Onde:* client/src/App.jsx (barra de abas, linhas 1413-1458)

**228. Trocar de aba apaga a busca/posicao sem volta facil**  `impacto baixo · esforço medio`
O sistema guarda a posicao de rolagem por aba, o que e otimo, mas nao ha um botao 'voltar' para desfazer uma troca de aba acidental. Quem clica errado precisa lembrar de onde veio. Um historico simples de navegacao (botao voltar) ajudaria, especialmente no celular.
*Benefício:* Recuperacao rapida de cliques errados, menos frustacao.  
*Onde:* client/src/App.jsx (controle de mainTab)

**229. Aviso de 'rascunho nao salvo' e facil de perder**  `impacto alto · esforço baixo`
Ao sair da aba Novo com um contrato preenchido mas nao salvo, aparece um aviso pequeno no cabecalho por 6 segundos. Como e discreto e some sozinho, a pessoa pode nao ver e achar que o trabalho foi salvo. Vale destacar mais (cor, ou um indicador persistente 'rascunho local') ate salvar.
*Benefício:* Reduz risco de perder cadastros preenchidos por engano.  
*Onde:* client/src/App.jsx (aviso de troca de aba, linhas 1176-1185)

**230. Mensagens de status no cabecalho competem por espaco e somem rapido**  `impacto medio · esforço medio`
Mensagens como 'Contrato salvo!', 'Erro ao salvar' e 'Rascunho nao salvo' aparecem todas no mesmo cantinho do cabecalho, truncadas no celular, e desaparecem em 3 segundos. Mensagens importantes (erros) merecem um lugar fixo e mais visivel, separado dos avisos rotineiros.
*Benefício:* Erros criticos param de passar despercebidos.  
*Onde:* client/src/App.jsx (saveMsg no header, linhas 1272-1274)

**231. Botao 'Novo' no celular nao avisa que vai limpar o formulario**  `impacto medio · esforço baixo`
No desktop, o botao flutuante '+' (novo contrato) limpa o formulario sem perguntar. No celular, o item 'Novo' do dock troca de aba mas, dependendo do estado, pode confundir sobre se mantem ou nao o que estava preenchido. Padronizar: sempre confirmar antes de descartar um rascunho em andamento.
*Benefício:* Ninguem perde um cadastro pela metade ao tocar em 'Novo'.  
*Onde:* client/src/App.jsx (FAB linha 1602 e dock 'novo' linha 1691)

**232. Celebracoes podem atrapalhar quem esta trabalhando concentrado**  `impacto baixo · esforço medio`
Quando um contrato e assinado, dispara confete, banner, troca de favicon e som de notificacao — bonito, mas pode interromper alguem que esta no meio de um cadastro importante. Falta uma opcao para 'modo silencioso' das celebracoes (manter o registro, reduzir o estardalhaço).
*Benefício:* Respeita o foco sem tirar a comemoracao de quem gosta dela.  
*Onde:* client/src/utils/celebrations.js + App.jsx (canal realtime, linhas 526-600)

**233. Funcionalidades novas nao se anunciam — descoberta depende de sorte**  `impacto medio · esforço medio`
Existe um 'changelog' (historico de versoes) com um sininho de versao nova, mas recursos como busca por data, modo foco, comparador de meses ou a aba Bot so sao descobertos por acaso. Pequenas dicas contextuais (ex.: um balao 'Novidade' na primeira vez que a aba aparece) aumentariam o uso real do que ja foi construido.
*Benefício:* O time aproveita recursos que hoje ficam parados por desconhecimento.  
*Onde:* client/src/App.jsx + client/src/components/ChangeLog.jsx

**234. Modo foco e atalhos uteis ficam escondidos no celular/iPad**  `impacto medio · esforço medio`
O 'modo foco' (esconder o preview para preencher melhor) e o guia de atalhos so existem no desktop. No celular e iPad o header foi enxugado e esses recursos sumiram. Como o iPad e um dispositivo de trabalho real aqui, valeria oferecer ao menos o modo foco/tela cheia do formulario no toque.
*Benefício:* Preenchimento mais confortavel no iPad, onde muita gente cadastra.  
*Onde:* client/src/App.jsx (modo foco linhas 1537-1549, header touch)

**235. O 'Mais' do dock mobile esconde abas importantes em segundo plano**  `impacto medio · esforço medio`
No celular/iPad o dock so mostra Novo, Salvos e Dashboard fixos; tudo o mais (Asaas, Boletos, Monitor, Admin...) fica atras do botao 'Mais'. Quem usa Boletos ou Asaas todo dia precisa de 2 toques sempre. Permitir personalizar quais 3 abas ficam fixas no dock resolveria por usuario.
*Benefício:* Cada pessoa deixa a vista as abas que mais usa.  
*Onde:* client/src/App.jsx (dock, linhas 1682-1714) + MobileNavSheet.jsx

**236. Indicador de aba ativa some quando cai no fallback do Dashboard**  `impacto medio · esforço baixo`
O codigo que decide qual aba mostrar termina num 'senao mostra Dashboard'. Se o nome da aba salva nao bater com nenhuma condicao, o Dashboard aparece mas a aba 'Dashboard' nao fica marcada como ativa no topo — o usuario ve conteudo sem saber em que aba esta. Garantir que a aba destacada e o conteudo mostrado sejam sempre a mesma coisa.
*Benefício:* Elimina a confusao de 'estou vendo o Dashboard mas nada esta selecionado'.  
*Onde:* client/src/App.jsx (cadeia de render de abas, linhas 1552-1576)

**237. Notificacoes e celebracoes empilham banners no topo da tela**  `impacto baixo · esforço medio`
Banner de login anomalo, banner de Supabase lento, barra de notificacao verde e banner de celebracao podem aparecer todos juntos, empurrando o conteudo pra baixo e poluindo a visao. Um unico 'centro de avisos' com prioridade evitaria que a tela fique cheia de faixas concorrentes.
*Benefício:* Tela mais limpa e avisos na ordem certa de importancia.  
*Onde:* client/src/App.jsx (banners, linhas 1217-1473)

**238. Busca global no celular nao mostra resultados recentes ao abrir**  `impacto medio · esforço baixo`
Ao abrir a busca (Ctrl+K ou lupa), a caixa fica vazia ate digitar 2 letras. Como o sistema ja carrega os 500 contratos mais recentes na memoria, daria pra mostrar de cara os ultimos contratos abertos/criados, virando um atalho rapido sem precisar digitar nada.
*Benefício:* Acesso de 1 clique aos contratos recentes, util no dia a dia.  
*Onde:* client/src/components/GlobalSearch.jsx (estado inicial, linhas 50-51 e 173-175)

**239. Atalhos de teclado disparam mesmo fora da aba certa**  `impacto medio · esforço baixo`
Os atalhos Cmd+S (salvar), Cmd+Enter (enviar) e Cmd+P (gerar PDF) funcionam em qualquer aba. Se a pessoa esta vendo Boletos ou o Dashboard e aperta Cmd+S por reflexo, o sistema tenta salvar um contrato vazio e mostra uma mensagem de erro confusa, sem que ela tenha feito nada de errado.
*Benefício:* Evita acoes acidentais e mensagens de erro sem sentido fora da tela de contrato.  
*Onde:* client/src/App.jsx (bloco de keyboard shortcuts, casos s/Enter/p)

**240. So da pra desfazer a ultima acao, e sem avisar que perdeu as anteriores**  `impacto medio · esforço medio`
O sistema guarda apenas UMA acao para desfazer (Cmd+Z). Se a pessoa arquiva dois contratos seguidos, o primeiro ja nao pode mais ser desfeito — e ela nao recebe nenhum aviso de que aquela chance passou. Some silenciosamente.
*Benefício:* Mais seguranca ao trabalhar rapido; ninguem perde a janela de desfazer sem perceber.  
*Onde:* client/src/hooks/useUndo.js + UndoToast

**241. Nao da para voltar para a aba anterior com um clique**  `impacto medio · esforço medio`
Quando a pessoa pula do Dashboard para um contrato especifico e quer voltar de onde veio, precisa procurar a aba de novo na barra. Nao existe um 'voltar' que lembre o caminho que ela fez entre as abas.
*Benefício:* Navegacao mais fluida entre telas, menos cliques para retomar o que estava fazendo.  
*Onde:* client/src/App.jsx (estado mainTab — guardar tab anterior)

**242. Sair do sistema nao pede confirmacao**  `impacto medio · esforço baixo`
O botao de sair (canto superior direito) desconecta na hora, com um clique so. Se houver um rascunho de contrato preenchido e ainda nao salvo, esse trabalho some junto com a sessao, sem nenhuma pergunta de 'tem certeza?'.
*Benefício:* Evita logout acidental e perda de um cadastro em andamento.  
*Onde:* client/src/App.jsx (botao logout no header)

**243. O contador de duvidas do Portal nao aparece no celular**  `impacto medio · esforço medio`
Quando ha duvidas de clientes sem resposta no Portal, aparece uma bolinha laranja com o numero — mas so na barra de abas do computador. No celular e iPad (que usam o menu 'Mais' do dock), esse alerta fica invisivel, entao quem usa no celular nunca ve que tem cliente esperando.
*Benefício:* Quem usa no celular tambem ve que ha clientes aguardando resposta.  
*Onde:* client/src/components/MobileNavSheet.jsx + dock 'Mais' no App.jsx

**244. Avisos de status no topo nao sao lidos por leitores de tela**  `impacto baixo · esforço baixo`
As mensagens 'Contrato salvo!', 'Erro ao salvar', etc., aparecem como texto no cabecalho mas nao sao anunciadas para quem usa leitor de tela (acessibilidade). Uma pessoa com baixa visao salva o contrato e nao recebe confirmacao sonora de que deu certo.
*Benefício:* Sistema acessivel a pessoas com deficiencia visual; confirmacao audivel das acoes.  
*Onde:* client/src/App.jsx (span do saveMsg no header)

**245. O navegador pede permissao de notificacao logo ao abrir**  `impacto medio · esforço baixo`
Assim que o sistema carrega, o navegador ja dispara aquele popup 'permitir notificacoes?'. Como aparece antes da pessoa entender o que ganha com isso, a maioria clica em 'bloquear' por reflexo — e depois nunca mais recebe o aviso de contrato assinado.
*Benefício:* Mais gente aceita as notificacoes porque o pedido vem na hora certa (ex: ao enviar o 1o contrato).  
*Onde:* client/src/App.jsx (Notification.requestPermission no mount do canal realtime)

**246. Quem usa celular nunca fica sabendo das novidades de versao**  `impacto baixo · esforço baixo`
O aviso de 'nova versao' e o historico de mudancas so aparecem no cabecalho do computador. No celular eles ficam escondidos dentro do menu 'Mais'. Quem trabalha so pelo celular nunca descobre uma funcao nova a nao ser por acaso.
*Benefício:* Todos ficam sabendo das melhorias, independentemente do aparelho.  
*Onde:* client/src/App.jsx (NewVersionBanner, oculto por !isMobile) + MobileNavSheet

**247. Trocar para uma aba pesada nao mostra que esta carregando direito**  `impacto baixo · esforço medio`
Ao abrir abas grandes (Dashboard, Contratos, Bot), aparece uma tela esqueleto generica, mas em conexao lenta a pessoa fica olhando sem saber se clicou certo ou se travou. Nao ha uma indicacao clara de 'estou abrindo a aba X'.
*Benefício:* Reduz a sensacao de travamento e cliques repetidos em conexao lenta.  
*Onde:* client/src/App.jsx (Suspense/TabFallback ao trocar de aba)

**248. O 'modo foco' so existe no computador e nao e lembrado**  `impacto baixo · esforço baixo`
O modo foco (esconde o preview e amplia o formulario) so aparece na versao de computador e volta ao normal toda vez que a pessoa troca de aba e retorna. Quem gosta de trabalhar concentrado precisa religar manualmente a cada vez.
*Benefício:* Quem prefere o modo foco nao precisa reativar toda hora; experiencia consistente.  
*Onde:* client/src/App.jsx (estado focusMode — persistir em localStorage)

**249. A barra de abas nao mostra em que grupo a pessoa esta**  `impacto baixo · esforço medio`
As 12 abas estao separadas por traços sutis em grupos (Criar, Analise, Financeiro...), mas esses grupos nao tem nome visivel. A pessoa ve uma fileira longa de botoes sem entender que 'Asaas' e 'Boletos' sao do mesmo assunto (dinheiro) e 'Bot' e 'Portal' de outro.
*Benefício:* Facilita encontrar a aba certa; reduz o esforco de procurar na lista longa.  
*Onde:* client/src/App.jsx (cbc-toptabs, logica de groupStart)

**250. O atalho que abre a busca (Cmd+K) nao tem dica visivel na tela**  `impacto medio · esforço baixo`
A busca global so abre com Cmd+K ou pela lupa no celular. No computador, nao ha nenhum campo ou icone de lupa no cabecalho que convide a buscar — quem nao decorou o atalho simplesmente nao sabe que a busca existe.
*Benefício:* Mais gente descobre e usa a busca, que hoje fica escondida atras de um atalho.  
*Onde:* client/src/App.jsx (header desktop — adicionar gatilho visivel da busca)

**251. O aviso de 'rascunho nao salvo' e so um texto que some em 6 segundos**  `impacto medio · esforço medio`
Quando a pessoa sai da aba Novo com um contrato preenchido sem salvar, aparece um aviso no topo que desaparece sozinho em 6 segundos. Se ela estava lendo outra coisa, perde o aviso e pode achar que o trabalho esta seguro quando na verdade so existe naquele navegador.
*Benefício:* O alerta de trabalho nao salvo fica visivel ate ser resolvido; menos perda de cadastros.  
*Onde:* client/src/App.jsx (efeito prevTabRef/saveMsg ao sair da aba novo)


## 9. Mobile & Responsividade  *(29)*

**252. Celular deitado (paisagem) fica sem o menu de baixo**  `impacto medio · esforço baixo`
Quando o celular e virado na horizontal, a tela passa de 640px e o sistema acha que e um tablet: esconde o menu flutuante de baixo e tenta mostrar as 11 abas no topo, que nao cabem e ficam espremidas/cortadas. O advogado perde a navegacao facil.
*Benefício:* Garante que o celular deitado continue com o menu de baixo (dock + Mais), sem abas cortadas  
*Onde:* client/src/App.jsx (dockVisible: linha ~1168) + client/src/hooks/useDeviceType.js (classificacao por largura)

**253. Dois criterios diferentes para 'e celular?' brigam entre si**  `impacto medio · esforço baixo`
Existem duas regras conflitantes no codigo: uma diz 'celular = menos de 768px' (useIsMobile) e outra 'celular = ate 640px' (useDeviceType). Na faixa entre 641 e 767px o app fica confuso (mostra o menu de baixo mas se comporta como tablet). Unificar evita comportamentos estranhos em telas medias.
*Benefício:* Comportamento previsivel em qualquer tamanho de tela, menos bugs de layout  
*Onde:* client/src/App.jsx (useIsMobile linha 317) — alinhar com useDeviceType

**254. No preview do contrato no celular nao da pra dar 'pinca' pra ampliar**  `impacto medio · esforço medio`
A previa do contrato no celular foi feita travada (sem toque), entao so da pra ampliar pelos botoes +/-. O gesto natural de juntar/afastar os dedos (pinca), que todo mundo usa, nao funciona e nao da pra selecionar/copiar texto da previa.
*Benefício:* Leitura do contrato no celular fica natural, como num PDF normal  
*Onde:* client/src/components/LivePreview.jsx (iframe com pointerEvents:'none', linha ~258)

**255. Faltam botoes 'tirar foto' na leitura da CNH pelo celular**  `impacto medio · esforço baixo`
O campo que le a CNH por foto (OCR) aceita arquivo, mas nao abre direto a camera traseira do celular. No celular, o cliente/assistente tem que escolher 'galeria' e procurar a foto. Um pequeno ajuste faz o botao ja abrir a camera apontando pro documento.
*Benefício:* Cadastro por foto da CNH fica 1 toque mais rapido no celular  
*Onde:* client/src/components/FormPanel.jsx (input file da CNH, linha 700) — adicionar capture='environment'

**256. Formulario publico do cliente nao tem campo de telefone e nao respeita o modo escuro**  `impacto alto · esforço medio`
O formulario que o cliente preenche pelo QR Code no proprio celular (ClientFormQR) nao pede telefone (que e dado obrigatorio do contrato) e usa cores fixas claras — se o celular estiver no modo escuro, fica com contraste ruim/ileto. Como e a primeira impressao do cliente, vale caprichar.
*Benefício:* Coleta o telefone na hora e o formulario fica legivel em qualquer celular  
*Onde:* client/src/components/ClientFormQR.jsx (lista de campos e inputClass, linha ~248)

**257. Teclado do celular pode esconder o campo que o cliente esta digitando**  `impacto medio · esforço medio`
Quando o cliente toca num campo e o teclado sobe, nao ha nada que role a tela pra manter o campo visivel acima do teclado (e do menu de baixo). Em celulares menores, o campo ativo pode ficar escondido atras do teclado. Da pra detectar o teclado (visualViewport) e rolar automaticamente.
*Benefício:* Cliente sempre ve o que esta digitando, menos abandono do formulario  
*Onde:* client/src/components/ClientFormQR.jsx e FormPanel.jsx (sem tratamento de visualViewport hoje)

**258. Codigo de barra lateral (sidebar) do iPad existe no CSS mas nunca aparece**  `impacto baixo · esforço medio`
Ha um estilo completo de menu lateral para iPad na horizontal (.sidebar-rail) que reserva ate 240px da tela, mas ele nunca e desenhado — no iPad deitado o sistema usa as abas no topo. Ou se ativa esse menu lateral (melhor uso do espaco do iPad), ou se remove o codigo morto pra nao confundir.
*Benefício:* Menos codigo morto e/ou melhor aproveitamento da tela do iPad  
*Onde:* client/src/index.css (.sidebar-rail linhas 1256-1290) sem uso em App.jsx

**259. A previa so vira 'modo toque' quando a pagina abre, nao quando muda o dispositivo**  `impacto baixo · esforço baixo`
A decisao de usar a previa em HTML (modo celular/tablet) e tomada uma unica vez, no carregamento. Se a janela mudar (girar o iPad, conectar a um monitor, ou testar redimensionando), a previa pode continuar no modo errado ate recarregar a pagina.
*Benefício:* Previa sempre no formato certo, sem precisar recarregar  
*Onde:* client/src/components/LivePreview.jsx (IS_TOUCH_PREVIEW fixo no carregamento, linha 36)

**260. Menu 'Mais' (todas as abas) sem gesto de arrastar pra fechar**  `impacto baixo · esforço medio`
O painel que sobe de baixo com todas as abas tem uma 'alcinha' visual (aquele tracinho no topo) sugerindo que pode ser arrastado pra baixo pra fechar — mas o gesto nao funciona, so fecha pelo X ou tocando fora. Quem usa celular espera arrastar. Adicionar o gesto deixa mais natural.
*Benefício:* Fechar o menu fica intuitivo, como em apps nativos  
*Onde:* client/src/components/MobileNavSheet.jsx (alcinha cbc-navsheet-grab decorativa)

**261. Trocar de aba no celular nao tem gesto de deslizar**  `impacto baixo · esforço medio`
No celular, trocar entre Formulario, Contrato e Procuracao (o controle de 3 botoes) so funciona tocando. Nao da pra deslizar o dedo pra esquerda/direita entre as visoes, que e o gesto que todo mundo espera em celular. Um gesto de swipe deixaria a navegacao do contrato muito mais fluida.
*Benefício:* Navegacao por gestos, sensacao de app nativo  
*Onde:* client/src/App.jsx (segmented control mobile, linha ~1482) + LivePreview

**262. Validar que nenhum botao importante fica menor que o dedo (44px)**  `impacto baixo · esforço medio`
Existem varias excecoes que liberam botoes menores que o minimo recomendado pela Apple (botoes com classe 'no-touch-min' e 'btn-mini', usados na barra de zoom da previa, por exemplo). Em alguns desses, no celular, o alvo de toque fica pequeno e dificil de acertar. Vale revisar caso a caso quais excecoes realmente fazem sentido no celular.
*Benefício:* Menos toques errados, menos frustracao no celular  
*Onde:* client/src/index.css (regras :not(.btn-mini):not(.no-touch-min)) + LivePreview.jsx

**263. Deteccao de tamanho de tela demora ate 100ms e pode 'piscar'**  `impacto baixo · esforço baixo`
Ao girar o aparelho ou redimensionar, o app espera 100ms (e um quadro de animacao) antes de reajustar o layout. Esse atraso pode causar um pequeno 'pulo' visual. Em troca de orientacao (retrato/paisagem), reagir um pouco mais rapido deixaria a transicao mais limpa.
*Benefício:* Giro de tela mais suave, sem piscadas de layout  
*Onde:* client/src/hooks/useDeviceType.js (debounce de 100ms, linha 78)

**264. Heuristica do iPad pode falhar em modelos novos/futuros**  `impacto baixo · esforço baixo`
O sistema reconhece o iPad Air por medidas exatas de tela (1366x1024, 1180x820 etc.) cravadas no codigo. Modelos novos da Apple, com resolucoes diferentes, podem nao ser reconhecidos como iPad e cair no layout errado. Vale usar uma deteccao mais geral (e tablet + toque) em vez de medidas fixas.
*Benefício:* Funciona em iPads futuros sem precisar atualizar o codigo  
*Onde:* client/src/hooks/useDeviceType.js (matchesIpad13Dims, linha ~47)

**265. Modo escuro do iframe de previa pode mostrar o contrato com fundo branco gritante**  `impacto baixo · esforço baixo`
No modo escuro, a previa do contrato (que e sempre branca, como o papel) fica como um retangulo branco forte no meio da tela escura — incomoda os olhos a noite. Da pra adicionar uma moldura/sombra suave ou um leve escurecimento de borda para suavizar o contraste sem alterar o documento.
*Benefício:* Previa mais confortavel no modo escuro, especialmente a noite  
*Onde:* client/src/index.css (:root.dark iframe, linha 462) + LivePreview.jsx

**266. Indicador de 'qual secao estou editando' na previa some no celular**  `impacto baixo · esforço medio`
No celular, quando o usuario esta no Formulario e olha a previa, o aviso 'Editando: tal secao' so existe na tela de previa — mas no celular voce ve uma coisa de cada vez (Formulario OU Contrato). Entao esse vinculo visual util (que destaca o trecho sendo preenchido) se perde no celular. Vale repensar como mostrar esse contexto quando as duas telas nao aparecem juntas.
*Benefício:* Cliente/assistente entende qual parte do contrato esta mexendo, mesmo no celular  
*Onde:* client/src/components/LivePreview.jsx (bloco activeSection, linha ~235) no fluxo mobile do App.jsx

**267. Numeros pequenos (Dashboard/heatmap) ainda podem ficar apertados no celular**  `impacto baixo · esforço medio`
Existe uma regra que aumenta letras de 7-9px para 9-10px no celular, mas 10px ainda e bem pequeno para tabelas densas como o mapa de calor e os KPIs do Dashboard. No celular, esses numeros podem ficar dificeis de ler para quem nao tem visao perfeita. Vale revisar os menores blocos numericos.
*Benefício:* Dashboard mais legivel no celular para todos  
*Onde:* client/src/index.css (piso tipografico, linhas 1548-1552) + componentes dashboard/widgets.jsx

**268. Menu 'Mais' nao fecha com botao Voltar do Android nem com Esc**  `impacto medio · esforço baixo`
O menu de todas as abas (MobileNavSheet.jsx) so fecha tocando no fundo escuro ou no X. No Android, apertar 'Voltar' do celular fecha o app ou troca de tela em vez de so fechar o menu; e no iPad com teclado, a tecla Esc nao fecha. O esperado e que 'Voltar' sempre feche o painel aberto primeiro.
*Benefício:* Comportamento que o usuario espera do celular; evita sair do sistema sem querer  
*Onde:* client/src/components/MobileNavSheet.jsx (adicionar listener de Escape e de historico/popstate)

**269. Fundo da tela rola por tras do menu 'Mais' e dos modais no celular**  `impacto medio · esforço baixo`
Quando o painel 'Mais' (ou um modal) abre no celular, a pagina de tras continua rolando junto com o dedo. O cliente as vezes 'perde' a posicao do conteudo principal sem perceber. O padrao em celular e travar a rolagem do fundo enquanto a janela esta aberta.
*Benefício:* Evita confusao e rolagem acidental; sensacao de app nativo  
*Onde:* client/src/App.jsx (travar rolagem do body quando showNavSheet/anyModalOpen) + index.css

**270. A aba ativa some do menu de baixo quando voce esta em Boletos/Monitor/Admin**  `impacto medio · esforço medio`
O menu fixo de baixo so mostra Novo, Salvos e Dashboard. Se voce esta em qualquer outra aba (ex: Boletos), nenhum dos botoes fica aceso, so o 'Mais' fica destacado de forma generica. Quem nao lembra onde esta fica perdido. Poderia mostrar o nome/icone da aba atual no proprio dock.
*Benefício:* Usuario sempre sabe em qual aba esta sem abrir o menu  
*Onde:* client/src/App.jsx (logica do dock-floating e item 'Mais')

**271. A 'previa em modo toque' e decidida uma unica vez quando o sistema carrega**  `impacto baixo · esforço baixo`
O codigo da previa (LivePreview.jsx) decide se e celular/touch so na primeira vez que a tela abre (a constante IS_TOUCH_PREVIEW). Se voce liga o iPad num monitor com mouse, ou abre as ferramentas de desenvolvedor, a previa pode ficar no modo errado ate atualizar a pagina. Deveria reagir a mudanca como o resto do sistema.
*Benefício:* Previa sempre no modo certo (toque x mouse) sem precisar recarregar  
*Onde:* client/src/components/LivePreview.jsx (constante IS_TOUCH_PREVIEW no topo)

**272. Formulario do cliente nao tem campo de numero da casa separado**  `impacto medio · esforço baixo`
No formulario publico (ClientFormQR.jsx) o cliente digita rua e numero tudo no mesmo campo 'endereco' (com a dica 'Rua, numero'). Isso mistura os dados e dificulta usar o endereco depois em contrato/cobranca. O ideal e ter um campo 'Numero' proprio, com teclado numerico, como ja existe no formulario interno.
*Benefício:* Endereco padronizado e limpo que vai certo pro contrato e Asaas  
*Onde:* client/src/components/ClientFormQR.jsx (secao de endereco)

**273. Campo de estado (UF) e digitado livre no formulario do cliente**  `impacto medio · esforço baixo`
No formulario publico o cliente digita o estado a mao num campo de 2 letras. Ele pode escrever errado ('SedP', 'sao paulo') e o sistema aceita. Como o sistema exige um dos 27 estados validos, deveria oferecer uma lista para escolher, igual ao campo de estado civil que ja e uma lista.
*Benefício:* Acaba com UF invalida que trava o contrato la na frente  
*Onde:* client/src/components/ClientFormQR.jsx (campo uf)

**274. Busca de CEP no formulario do cliente nao avisa 'buscando' nem 'nao encontrei'**  `impacto medio · esforço baixo`
Quando o cliente digita o CEP no formulario publico, o sistema busca o endereco em segundo plano, mas nao mostra nada na tela (nem 'carregando', nem erro se o CEP nao existir). No celular, com internet lenta, o cliente acha que travou e desiste ou digita tudo errado. Falta um aviso simples de status.
*Benefício:* Menos abandono do formulario e menos endereco errado  
*Onde:* client/src/components/ClientFormQR.jsx (handleCEP / busca ViaCEP)

**275. O menu 'Mais' fica preso em 3 colunas mesmo no iPad largo**  `impacto baixo · esforço baixo`
O painel de todas as abas (MobileNavSheet) sempre mostra os botoes em 3 colunas, independente do tamanho. Num iPad deitado da pra caber 4 ou 5 colunas confortavelmente, deixando tudo mais arejado e menos rolagem. Em telas pequenas, manter 3 (ou cair pra 2 nos celulares bem estreitos).
*Benefício:* Aproveita o espaco do iPad; menos rolagem pra achar a aba  
*Onde:* client/src/components/MobileNavSheet.jsx (grid-cols-3 fixo)

**276. Foco do teclado nao 'entra' no menu 'Mais' ao abrir**  `impacto baixo · esforço medio`
Quando o painel 'Mais' abre, quem usa teclado (iPad com teclado, ou leitor de tela) continua com o foco la atras na pagina, podendo navegar por botoes escondidos atras do painel. O correto e o foco ir pro painel ao abrir e ficar preso nele ate fechar (focus trap), como num modal de verdade.
*Benefício:* Acessibilidade e navegacao por teclado corretas no iPad  
*Onde:* client/src/components/MobileNavSheet.jsx

**277. Avisos (toasts) podem nascer em cima do 'entalhe' do iPhone**  `impacto baixo · esforço baixo`
Os avisos que aparecem no topo (cbc-toast-stack) usam uma distancia fixa do topo. No celular eles ja descem um pouco pela area segura, mas no iPhone com entalhe e quando a barra de busca aparece no topo, o aviso pode encostar/sobrepor esses elementos. Vale checar a folga real em iPhone com notch.
*Benefício:* Avisos sempre legiveis, sem encostar na camera/barra  
*Onde:* client/src/index.css (.cbc-toast-stack, @media max-width:640px)

**278. O codigo de barras lateral do iPad (sidebar-rail) esta no CSS mas o estado de dispositivo nao alimenta ele**  `impacto baixo · esforço medio`
Existe um menu lateral bonito previsto pro iPad deitado (sidebar-rail no CSS), e o sistema ja sabe detectar iPad (useDeviceType com isIpadAir13). Mas hoje o iPad deitado usa as abas de cima normais e o menu lateral nunca e ligado. Ou se conecta os dois (aproveitando o detector que ja existe), ou se remove o CSS morto pra nao confundir.
*Benefício:* Decisao clara: usar o menu lateral do iPad ou limpar codigo nao usado  
*Onde:* client/src/index.css (.sidebar-rail) + client/src/App.jsx + hooks/useDeviceType.js

**279. Tirar foto da CNH abre a galeria, nao a camera, no celular**  `impacto medio · esforço baixo`
No celular, ao enviar a foto da CNH, o campo de arquivo nao pede a camera diretamente — abre a galeria e o usuario tem que achar a foto. Em campo, o vendedor quer apontar e fotografar na hora. Adicionar a dica 'usar camera traseira' faz o celular abrir a camera direto.
*Benefício:* Captura da CNH muito mais rapida no atendimento presencial  
*Onde:* client/src/components/FormPanel.jsx (input de upload da CNH/OCR)

**280. Botoes do dock tem texto, mas alguns icones do dock sao pequenos para o dedo no toque**  `impacto baixo · esforço baixo`
Os itens do menu de baixo tem altura boa (52px), mas os icones sao desenhados em 20px (w-5 h-5) com o texto embaixo, deixando a area de toque visual menor que o recomendado. Em iPhone pequeno, aumentar levemente o icone/area de toque reduz erro de toque na troca de abas.
*Benefício:* Menos toques errados ao navegar pelo celular  
*Onde:* client/src/App.jsx (dock-floating-item, icones w-5 h-5) + index.css (.dock-floating-item)


## 10. Acessibilidade  *(36)*

**281. Ligar cada rotulo ao seu campo no formulario (htmlFor/id)**  `impacto alto · esforço medio`
No formulario de novo contrato, os textos como 'CPF', 'Nome Completo', 'E-mail' aparecem em cima dos campos so visualmente. Eles nao estao tecnicamente 'amarrados' ao campo. Para um leitor de tela (programa que le a tela em voz alta para deficientes visuais) e para quem clica no rotulo, isso nao funciona. Basta dar um identificador a cada campo e apontar o rotulo para ele.
*Benefício:* Leitor de tela anuncia o nome certo do campo; clicar no rotulo foca o campo; menos erros de digitacao.  
*Onde:* client/src/components/FormPanel.jsx (todos os <label className='label-field'> e <input>/<select>)

**282. Mostrar mensagem de erro em texto ao lado do campo invalido**  `impacto alto · esforço medio`
Hoje, quando um campo esta errado (ex: CPF invalido), o sistema so deixa a borda vermelha (classe 'input-error'). Quem nao enxerga bem cores nao percebe, e o leitor de tela nao avisa o que esta errado nem por que. Adicionar uma frase curta ('CPF invalido') visivel embaixo do campo, marcada para ser lida em voz, resolve.
*Benefício:* Usuario entende exatamente o que corrigir, sem depender so da cor vermelha.  
*Onde:* client/src/components/FormPanel.jsx (objeto 'errors' + inputs com input-error)

**283. Marcar campos invalidos como invalidos para o leitor de tela (aria-invalid)**  `impacto medio · esforço baixo`
Junto com a borda vermelha, falta um aviso 'invisivel' que diz ao leitor de tela: este campo esta com erro. E uma pequena marcacao tecnica (aria-invalid) que faz o programa de leitura anunciar 'invalido' ao chegar no campo. Complementa a mensagem de erro em texto.
*Benefício:* Pessoa cega sabe na hora qual campo precisa de correcao ao navegar pelo formulario.  
*Onde:* client/src/components/FormPanel.jsx (inputs com classe input-error)

**284. Anunciar o erro de login em voz (role alert) na tela de entrada**  `impacto medio · esforço baixo`
Na tela de login, quando da 'E-mail ou senha incorretos', a frase aparece numa caixinha vermelha que treme. Mas ela nao esta marcada como 'aviso urgente', entao o leitor de tela nao le essa mensagem automaticamente. Marcar essa caixa como alerta faz o programa anunciar o erro assim que ele surge.
*Benefício:* Usuario com leitor de tela descobre por que o login falhou, sem ficar perdido.  
*Onde:* client/src/components/LoginScreen.jsx (div de erro, linha ~131)

**285. Nao usar so cor (verde/vermelho) para indicar secao completa**  `impacto medio · esforço baixo`
No formulario, cada secao tem uma bolinha verde (completa) ou vermelha (faltando dados). Quem tem daltonismo (dificuldade de distinguir verde de vermelho) nao consegue diferenciar. Ja existe um contador tipo '5/8' ao lado; vale acrescentar um icone diferente (check vs alerta) ou um texto 'completo/incompleto' para o leitor de tela, em vez de depender so da cor.
*Benefício:* Quem nao distingue cores entende o progresso do preenchimento.  
*Onde:* client/src/components/FormPanel.jsx (componente Section, bolinha done; linha ~260)

**286. Dizer ao leitor de tela se a secao esta aberta ou fechada (aria-expanded)**  `impacto medio · esforço baixo`
As secoes do formulario (Contratantes, Resort, Honorarios...) abrem e fecham ao clicar no titulo. Visualmente uma setinha gira. Mas falta a marcacao 'aria-expanded' que avisa ao leitor de tela se aquela secao esta aberta ou recolhida. Sem isso, a pessoa cega nao sabe se ja abriu a secao.
*Benefício:* Navegacao do formulario fica clara para quem usa leitor de tela.  
*Onde:* client/src/components/FormPanel.jsx (botao do componente Section, linha ~248)

**287. Aumentar o tamanho de fonte minimo na tela de login**  `impacto medio · esforço baixo`
A tela de login usa textos de 10 e 11 pixels (rotulos 'E-mail', 'Senha', 'Lembrar de mim', 'Esqueci a senha'). Isso e bem menor que o recomendado e dificil para quem tem visao reduzida ou ja tem certa idade. Subir esses textos para pelo menos 12-13px melhora muito a leitura sem quebrar o visual.
*Benefício:* Login mais legivel para todos, especialmente usuarios mais velhos.  
*Onde:* client/src/components/LoginScreen.jsx (classes text-[10px]/text-[11px])

**288. Revisar contraste das abas inativas no topo (texto branco esmaecido)**  `impacto medio · esforço baixo`
Na barra de abas do topo (desktop), as abas que nao estao selecionadas usam texto branco com so 55% de opacidade sobre o azul-marinho. Isso provavelmente fica abaixo do contraste minimo recomendado, deixando os nomes das abas dificeis de ler. Subir a opacidade (ex: 70-75%) deixa os rotulos legiveis sem perder o destaque da aba ativa.
*Benefício:* Nomes das abas ficam legiveis para quem tem baixa visao.  
*Onde:* client/src/App.jsx (cbc-toptabs, classe text-white/55, linha ~1440)

**289. Adicionar link 'Pular para o conteudo' no inicio da pagina**  `impacto medio · esforço baixo`
Quem navega so com teclado (Tab) precisa passar por todos os botoes do cabecalho e abas antes de chegar ao conteudo principal toda vez. Um link invisivel 'Pular para o conteudo' (que aparece so quando focado com Tab) leva direto a area de trabalho, economizando muitos toques de teclado.
*Benefício:* Usuarios de teclado e leitor de tela chegam ao trabalho muito mais rapido.  
*Onde:* client/src/App.jsx (topo do layout, antes do header)

**290. Marcar a area principal e o cabecalho como regioes (landmarks)**  `impacto medio · esforço baixo`
Leitores de tela permitem 'pular' entre as grandes regioes de uma pagina (cabecalho, menu, conteudo principal, rodape) se elas estiverem marcadas. Hoje o conteudo principal nao esta envolvido por uma marca de 'conteudo principal' (<main>). Envolver a area de trabalho num <main> e o topo num <header> facilita muito a navegacao por regioes.
*Benefício:* Pessoa cega navega entre as grandes areas do sistema com um comando so.  
*Onde:* client/src/App.jsx (estrutura geral do layout)

**291. Transformar as abas do topo em abas 'de verdade' com teclado**  `impacto medio · esforço medio`
As abas do topo sao botoes comuns. O padrao de acessibilidade para abas espera que voce navegue entre elas com as setas do teclado e que cada uma seja marcada como 'aba' (role=tab dentro de role=tablist). O segmented control Formulario/Contrato/Procuracao ja faz parte disso; as abas principais nao. Padronizar melhora a navegacao por teclado e o anuncio em voz.
*Benefício:* Navegacao por teclado entre abas fica previsivel e anunciada corretamente.  
*Onde:* client/src/App.jsx (cbc-toptabs, botoes de aba, linha ~1414-1450)

**292. Garantir foco preso e tecla Esc em todas as janelas (modais)**  `impacto medio · esforço alto`
Quando abre uma janela de confirmacao (ex: 'Limpar formulario?', enviar ZapSign, etc.), o foco do teclado deveria ficar 'preso' dentro dela ate o usuario fechar, e Esc deveria fechar. Em parte das janelas isso nao acontece de forma consistente: ao apertar Tab, o foco escapa para a pagina de tras, confundindo quem usa teclado/leitor de tela. Padronizar (foco inicial no botao principal, Tab circula dentro, Esc fecha) em todos os modais resolve.
*Benefício:* Usuarios de teclado nao se perdem 'atras' das janelas abertas.  
*Onde:* client/src/components/FormPanel.jsx (modal Limpar) e demais modais (ConfirmDestructive, ZapSignModal, ImportContratoModal)

**293. Dar 'rotulo de voz' a campos que so tem placeholder**  `impacto medio · esforço baixo`
Alguns campos guiam o usuario so pelo texto cinza de exemplo dentro do campo (placeholder), que some quando voce comeca a digitar e nem sempre e lido pelo leitor de tela. Onde o rotulo visivel ja existe, a ligacao rotulo-campo (sugestao 1) resolve; onde nao existe rotulo visivel, vale adicionar um aria-label descritivo para o campo nunca ficar 'sem nome'.
*Benefício:* Nenhum campo fica sem identificacao para quem usa leitor de tela.  
*Onde:* client/src/components/FormPanel.jsx (inputs com apenas placeholder)

**294. Avisar o resultado da leitura da CNH (OCR) em voz**  `impacto baixo · esforço medio`
Ao tirar foto/enviar a CNH, o sistema preenche varios campos automaticamente e os pisca em azul. Para quem nao enxerga, nada disso e percebido. Um aviso curto e falado, tipo 'Documento lido, 6 campos preenchidos, confira', faz a pessoa saber que o preenchimento automatico aconteceu e que precisa revisar.
*Benefício:* Usuario cego sabe que o OCR funcionou e que deve conferir os dados.  
*Onde:* client/src/components/FormPanel.jsx (fluxo handleCNHUpload + classe ocr-highlight)

**295. Reduzir o foco azul generico em botoes ja escuros e checar contraste do contorno**  `impacto medio · esforço baixo`
O contorno azul que aparece ao navegar por teclado (focus-visible) e bom e deve continuar. Vale conferir se em alguns fundos (azul-marinho, dourado) esse contorno azul tem contraste suficiente para ser visto. Em botoes navy o azul pode 'sumir'. Ajustar a cor/espessura do contorno conforme o fundo garante que o foco esteja sempre visivel.
*Benefício:* Quem navega por teclado sempre ve onde esta o foco, em qualquer botao.  
*Onde:* client/src/index.css (*:focus-visible e botoes, linhas ~234-243)

**296. Permitir aumentar a fonte do app inteiro sem quebrar o layout**  `impacto medio · esforço alto`
Muitos textos usam tamanhos fixos minusculos (9px, 10px, 11px) espalhados pelo sistema. Quando o usuario aumenta a fonte do navegador para enxergar melhor, parte desses textos nao acompanha porque estao 'travados'. Migrar os tamanhos mais criticos para uma escala que responde ao ajuste do usuario (ja existe a opcao de densidade) deixa o sistema utilizavel para baixa visao.
*Benefício:* Usuario consegue ampliar os textos do sistema para ler com conforto.  
*Onde:* client/src/index.css (tokens de tamanho) e classes text-[9px]/[10px]/[11px] nos componentes

**297. Garantir alvo de toque de 44px tambem fora do mobile**  `impacto medio · esforço baixo`
A regra que garante botoes grandes o suficiente para o dedo (44x44 pixels) hoje so vale em telas estreitas (ate 768px). Em tablets em modo paisagem e telas touch maiores, varios botoes pequenos (icones do cabecalho, setas de reordenar clausula, olho da senha) ficam abaixo disso. Estender o alvo minimo para todas as telas de toque (e nao so as estreitas) facilita o uso.
*Benefício:* Menos toques errados em tablets e telas sensiveis ao toque grandes.  
*Onde:* client/src/index.css (@media max-width:768px touch targets, linha ~246) e botoes de icone pequenos

**298. Dar nome de voz ao botao de mostrar/ocultar senha sem tira-lo do teclado**  `impacto baixo · esforço baixo`
Na tela de login, o botao do 'olho' que mostra a senha esta com tabIndex=-1, ou seja, e pulado quando se navega so por teclado. Ele tem um bom rotulo de voz, mas quem usa so o teclado nao consegue acessa-lo para revelar a senha. Permitir o foco por teclado nesse botao da a mesma funcao a todos.
*Benefício:* Usuario de teclado tambem consegue revelar a senha para conferir.  
*Onde:* client/src/components/LoginScreen.jsx (botao showPwd, tabIndex={-1}, linha ~190)

**299. Avisar mudancas importantes de estado em voz (assinou, salvou, sincronizou)**  `impacto baixo · esforço medio`
O sistema tem muitas automacoes e celebracoes visuais (confete ao bater meta, banner 'PRA CIMA CBC', favicon mudando ao assinar). Nada disso e percebido por quem nao enxerga. Criar uma pequena area 'falada' que anuncia eventos-chave ('Contrato assinado', 'Salvo com sucesso') dá a mesma informacao em voz, sem poluir a tela.
*Benefício:* Usuario cego acompanha os marcos importantes do contrato em voz.  
*Onde:* client/src/App.jsx (automacoes globais e celebracoes)

**300. Suporte a modo de alto contraste do sistema (prefers-contrast)**  `impacto baixo · esforço medio`
O app ja respeita quem pede menos animacoes (prefers-reduced-motion) e tem modo escuro, o que e otimo. Falta atender quem liga o 'alto contraste' no proprio computador/celular. Adicionar um ajuste que reforce bordas e escureça textos secundarios quando o sistema operacional pede alto contraste ajuda usuarios com baixa visao severa.
*Benefício:* Pessoas que usam alto contraste do sistema veem o app com bordas e textos mais fortes.  
*Onde:* client/src/index.css (adicionar bloco @media (prefers-contrast: more))

**301. Verificar contraste do dourado (gold) quando usado como texto**  `impacto baixo · esforço baixo`
A cor dourada (#C9A84C) e linda como detalhe, mas como cor de texto sobre fundo claro ela costuma ter contraste baixo (texto 'lavado'). Onde o dourado for usado em palavras/numeros (e nao so em linhas decorativas), vale escurecer um pouco ou reservar o dourado so para detalhes nao textuais, mantendo a identidade visual.
*Benefício:* Textos em dourado deixam de ser dificeis de ler.  
*Onde:* client/src/index.css (--cbc-gold) e usos de texto dourado (ex: LoginScreen hr, headers)

**302. Indicar campos obrigatorios tambem por texto, nao so pelo asterisco**  `impacto baixo · esforço baixo`
Os campos obrigatorios sao marcados com um asterisco (*) ao lado do nome. O asterisco e pequeno e nem sempre e anunciado claramente pelo leitor de tela como 'obrigatorio'. Acrescentar a marcacao tecnica de obrigatorio (aria-required) e, na primeira vez, uma legenda '* campo obrigatorio' deixa isso explicito para todos.
*Benefício:* Fica claro para todos quais campos precisam ser preenchidos.  
*Onde:* client/src/components/FormPanel.jsx (labels com '*' e inputs obrigatorios)

**303. Tornar o botao de progresso navegavel pelo teclado**  `impacto medio · esforço baixo`
No topo do formulario ha 5 barrinhas (Contratantes, Resort, Honorarios, etc.) que, ao clicar, rolam ate aquela secao. Hoje elas sao caixas comuns (div com onClick) que o teclado nao consegue alcancar nem ativar com Enter. So funcionam com mouse.
*Benefício:* Quem usa so o teclado (ou leitor de tela) tambem consegue pular direto para a secao desejada.  
*Onde:* FormPanel.jsx (barra de progresso, por volta da linha 1298) — trocar a div clicavel por um botao de verdade

**304. Esconder de verdade os campos das secoes fechadas**  `impacto alto · esforço baixo`
Quando uma secao do formulario esta recolhida (ex.: Clausulas comeca fechada), o conteudo apenas encolhe visualmente (altura zero), mas continua existindo para o leitor de tela e para a tecla Tab. A pessoa cega ouve campos de uma secao que parece fechada e o cursor 'some' dentro de uma area invisivel.
*Benefício:* O leitor de tela e a navegacao por teclado passam a respeitar o que esta aberto ou fechado, sem confusao.  
*Onde:* index.css (.section-content.collapsed, linha 149) e FormPanel.jsx (componente Section, linha 271) — aplicar hidden/display:none quando fechado

**305. Dar nome e papel de botao ao envio da CNH (OCR)**  `impacto medio · esforço baixo`
O botao que abre a foto da CNH para leitura automatica e so um rotulo escrito 'CNH' colado a um campo de arquivo invisivel. Para o leitor de tela isso fica vago: nao diz claramente que e um botao de 'enviar foto da habilitacao para preencher os dados'.
*Benefício:* O usuario entende exatamente o que aquele controle faz antes de acionar.  
*Onde:* FormPanel.jsx (label da CNH e input file, linhas 693-700)

**306. Agrupar as escolhas '1/2 Contratantes' e o tipo de honorario como opcoes de verdade**  `impacto medio · esforço medio`
As escolhas de quantos contratantes (1 ou 2) e do tipo de honorario (Iniciais / Exito / Ambos) sao botoes que mudam de cor quando selecionados. Visualmente da pra ver qual esta ativo, mas o leitor de tela nao avisa que e um conjunto de opcoes nem qual esta marcada.
*Benefício:* Pessoas com leitor de tela entendem que precisam escolher uma opcao e ouvem qual esta selecionada.  
*Onde:* FormPanel.jsx (botoes de numero de contratantes, linha 1323; botoes de modo de honorario, ~linha 737)

**307. Nao roubar o foco automatico nos primeiros campos**  `impacto baixo · esforço baixo`
A tela de login leva o cursor automaticamente para o e-mail e o formulario de contrato leva para o CPF (autoFocus). Esse 'pulo' automatico pode atrapalhar quem usa leitor de tela, que perde o anuncio do titulo da pagina, e quem amplia a tela, que e levado para um ponto inesperado.
*Benefício:* A pessoa comeca a leitura pelo inicio da tela, sem ser jogada no meio do formulario.  
*Onde:* LoginScreen.jsx (input de e-mail, linha 160) e FormPanel.jsx (input de CPF, ~linha 835)

**308. Avisar em voz o resultado da leitura da foto (barra de progresso)**  `impacto medio · esforço baixo`
Enquanto a CNH e lida, aparece uma barra de progresso ('Iniciando', 'Lendo', 'Extraido!'). Esse texto muda na tela, mas nao e anunciado para quem usa leitor de tela, que fica sem saber se terminou ou deu erro.
*Benefício:* Quem nao enxerga a barra recebe o aviso de andamento e conclusao por voz.  
*Onde:* FormPanel.jsx (ProgressBar do OCR e textos 'Lendo/Extraido/Erro', linhas 699 e 707-713)

**309. Transformar dica que aparece so passando o mouse em texto sempre visivel**  `impacto baixo · esforço baixo`
O campo 'Link Kommo' guarda a explicacao de como preencher dentro de um title (aquela tarja que so surge ao parar o mouse em cima). Quem usa teclado ou celular nunca ve essa dica, e leitores de tela tratam title de forma inconsistente.
*Benefício:* A instrucao de preenchimento fica acessivel para todos, nao so para quem usa mouse.  
*Onde:* FormPanel.jsx (input do Link Kommo com title=, linha 962)

**310. Garantir alvo de toque de 44px nos botoes de reordenar clausula**  `impacto baixo · esforço baixo`
No celular, as setinhas para cima/baixo que reordenam as clausulas tem so 32 pixels (marcadas com 'no-touch-min', que desliga o tamanho minimo). Botoes pequenos demais sao dificeis de acertar com o dedo, principalmente para quem tem tremor ou baixa coordenacao.
*Benefício:* As setas ficam faceis de tocar sem errar o alvo no celular.  
*Onde:* FormPanel.jsx (botoes 'Mover clausula', linhas 1685 e 1688 — classe no-touch-min com w-8 h-8)

**311. Anunciar quando o sistema preenche campos sozinho (genero, OCR, busca por CPF)**  `impacto medio · esforço medio`
Quando voce escolhe o sexo, ou le a CNH, ou busca por CPF, o sistema preenche varios campos automaticamente (profissao, estado civil, endereco). Visualmente eles brilham em azul, mas o leitor de tela nao avisa que 'varios campos foram preenchidos', entao a pessoa cega nao percebe a mudanca.
*Benefício:* Quem usa leitor de tela percebe que o formulario foi preenchido sozinho e pode conferir os dados.  
*Onde:* FormPanel.jsx (preenchimento automatico por sexo/OCR/CPF; classe ocr-highlight em index.css linha 128)

**312. Conferir o contraste do contorno de foco no modo escuro**  `impacto medio · esforço baixo`
No modo escuro, a 'moldura' que marca o item selecionado pelo teclado e dourada (botoes) ou azul-marinho (campos). Sobre fundos escuros, esse contorno pode ficar com pouco contraste e dificil de enxergar — justamente quem depende dele para saber onde esta.
*Benefício:* Quem navega por teclado sempre ve com clareza onde esta o cursor, mesmo no tema escuro.  
*Onde:* index.css (focus-visible com --cbc-gold/--cbc-navy, linhas 1331-1339; tokens dark, linhas 380-385)

**313. Suavizar a transicao global de cor que afeta todo o app**  `impacto baixo · esforço baixo`
Existe uma regra que aplica uma animacao de cor em absolutamente todos os elementos da pagina (linha 187 do CSS). Alem de pesar, ela faz a tela inteira 'piscar' a cada troca de tema ou de aba, o que incomoda pessoas sensiveis a movimento e pode causar desconforto visual.
*Benefício:* Menos cintilacao na tela e melhor desempenho, especialmente para quem e sensivel a movimento.  
*Onde:* index.css (regra '.dark *, *' com transition, linha 187)

**314. Dar um endereco fixo (id) e foco automatico para a faixa de erro de login**  `impacto medio · esforço baixo`
Quando o login falha, aparece uma faixa vermelha tremendo ('E-mail ou senha incorretos'). O tremor pode incomodar quem tem sensibilidade a movimento, e a mensagem nao recebe o foco — quem usa leitor de tela precisa procura-la na tela em vez de ouvi-la na hora.
*Benefício:* O erro de login e percebido na hora por todos, sem depender de enxergar a faixa piscar.  
*Onde:* LoginScreen.jsx (bloco de erro com animate-shake, linhas 131-136)

**315. Permitir colar a senha e nao bloquear o botao de mostrar/ocultar no teclado**  `impacto baixo · esforço baixo`
O olhinho que mostra/oculta a senha esta com tabIndex=-1, ou seja, e pulado pela tecla Tab — quem navega so por teclado nao consegue chegar nele. Vale revisar para que esse controle seja alcancavel pelo teclado.
*Benefício:* Usuarios de teclado conseguem revelar a senha para conferir o que digitaram.  
*Onde:* LoginScreen.jsx (botao do olho com tabIndex=-1, linhas 190-192)

**316. Indicar a secao concluida tambem com texto, nao so bolinha verde/vermelha**  `impacto medio · esforço baixo`
O cabecalho de cada secao tem uma bolinha verde (completa) ou vermelha (faltando). Quem nao distingue bem verde de vermelho (daltonismo) ou usa leitor de tela so percebe 'um ponto colorido', sem saber se a secao esta pronta.
*Benefício:* Todo mundo entende se a secao esta completa, mesmo sem distinguir as cores.  
*Onde:* FormPanel.jsx (bolinha de status no cabecalho da Section, linha 260)


## 11. Design System & Dark Mode  *(31)*

**317. Corrigir o dourado que virou azul no sistema de cores**  `impacto alto · esforço medio`
No arquivo de estilos, o bloco @theme define o dourado (--color-gold) com o MESMO codigo do azul-marinho. Ou seja: qualquer botao ou texto que pede a cor 'dourada' (classes bg-gold, text-gold, bg-gold-dark) aparece AZUL na tela, nao dourado. Ao mesmo tempo, muitas telas usam o dourado de verdade (#C9A84C) escrito na mao. O resultado e um dourado que aparece em alguns lugares e some em outros, sem regra.
*Benefício:* Identidade visual navy/dourado consistente e previsivel; o dourado para de aparecer 'as vezes'.  
*Onde:* client/src/index.css (bloco @theme, linhas 20-22) + botoes que usam bg-gold como FormPanel.jsx:1400

**318. Unificar os dois 'azul-marinho' diferentes que estao em uso**  `impacto medio · esforço medio`
O sistema tem DOIS azuis-marinho quase iguais sendo usados como se fossem a cor da marca: #1B3A5C (usado 182 vezes) e #1A2E52 (usado 91 vezes). Eles sao levemente diferentes, entao titulos, valores e nomes de cliente ficam com tons de azul ligeiramente distintos dependendo da tela. Deveria existir um unico azul oficial.
*Benefício:* Aparencia mais profissional e coesa; ninguem percebe 'dois azuis' sutis.  
*Onde:* Telas que usam #1A2E52, principalmente client/src/components/ContratosTab.jsx (visao Cards)

**319. Trocar cores fixas por tokens para o modo escuro funcionar na tela de cadastro**  `impacto alto · esforço medio`
A tela de Novo Contrato (FormPanel) escreve cores diretamente no codigo (ex.: cor do texto azul fixo). Cores escritas assim NAO mudam no modo escuro — o sistema so consegue trocar cores quando elas usam as variaveis --cbc-*. Por isso, no modo escuro, varios titulos e rotulos dessa tela continuam azul-marinho sobre fundo escuro, ficando dificeis de ler.
*Benefício:* Modo escuro legivel na tela mais usada do dia a dia.  
*Onde:* client/src/components/FormPanel.jsx (varios style={{color:'#1B3A5C'}})

**320. Corrigir badges de status que nao acompanham o modo escuro**  `impacto medio · esforço medio`
As etiquetas coloridas de status (verde 'sucesso', vermelho 'erro', amarelo 'enviando') na lista de contratos usam tons claros fixos de fundo (verde-clarinho, vermelho-clarinho). No modo escuro esses fundos claros continuam claros, criando manchas berrantes que destoam do resto da tela escura.
*Benefício:* Etiquetas de status bonitas e legiveis tambem no modo escuro.  
*Onde:* client/src/components/ContratosTab.jsx (linhas ~127-129, 296, 319-323)

**321. Padronizar a familia de cores de status (verde/vermelho/amarelo) num so lugar**  `impacto medio · esforço medio`
Existem varios verdes diferentes para 'sucesso' (#D1FAE5, #E8F5E9, #065F46, #2E7D32) e varios vermelhos para 'erro' espalhados pelas telas. Cada tela inventou o seu tom. Ja existe um conjunto oficial pronto (--cbc-success, --cbc-danger etc.) que deveria ser a unica fonte dessas cores.
*Benefício:* Verde sempre o mesmo verde; manutencao muito mais simples.  
*Onde:* Transversal; concentrado em ContratosTab.jsx, VendasPanel.jsx, AsaasPanel.jsx

**322. Padronizar o espacamento das letras nos rotulos em maiusculas (eyebrows)**  `impacto baixo · esforço baixo`
Os pequenos rotulos em letra maiuscula (tipo 'TOTAL DE CONTRATOS') usam espacamentos de letra diferentes em cada lugar: as vezes tracking-[1.2px], as vezes [1.4px], as vezes 'wide', as vezes 'wider'. Sao diferencas pequenas, mas o olho percebe que 'algo nao esta alinhado'. Definir 1 ou 2 padroes fixos resolve.
*Benefício:* Rotulos com ritmo visual uniforme em todo o painel.  
*Onde:* client/src/components/dashboard/widgets.jsx (varios tracking-[...])

**323. Uniformizar a tipografia de titulos: usar Cormorant Garamond de forma consistente**  `impacto baixo · esforço medio`
A fonte de prestigio do escritorio (Cormorant Garamond) e aplicada em alguns titulos escrevendo o nome da fonte na mao, tela por tela (Portal, Bot, relatorios), enquanto a maioria dos titulos usa a fonte comum. Nao ha regra clara de 'quando usar a fonte elegante'. Criar uma classe unica (ex.: .cbc-heading-serif) deixaria isso consistente.
*Benefício:* Hierarquia de titulos clara e identidade visual mais sofisticada.  
*Onde:* client/src/index.css + componentes que escrevem fontFamily:'Cormorant Garamond' inline

**324. Levar o azul-da-marca a virar dourado no modo escuro tambem nos textos diretos**  `impacto medio · esforço medio`
O sistema ja tem uma regra esperta: no modo escuro, o azul-marinho da marca vira dourado (combina melhor com fundo escuro). Mas essa troca so funciona para textos que usam a CLASSE de cor; textos que tem a cor azul escrita direto no codigo (a maioria em FormPanel/ContratosTab) ficam de fora e continuam azul. Migrar esses textos para a variavel resolve junto com o modo escuro.
*Benefício:* Acento dourado coerente no modo escuro em todas as telas.  
*Onde:* client/src/index.css (regra :root.dark .text-navy) + FormPanel.jsx/ContratosTab.jsx

**325. Revisar contraste de textos secundarios pequenos (datas, legendas)**  `impacto medio · esforço baixo`
Muitos detalhes pequenos (CPF, resort, data de criacao) usam um cinza claro (classe text-gray-400). Ja houve um ajuste para melhorar a leitura, mas varios desses textos minusculos sobre fundo claro ficam no limite do que se consegue ler com conforto, especialmente para quem tem mais de 60 anos (perfil comum do escritorio).
*Benefício:* Leitura mais facil das informacoes de apoio; menos cansaco visual.  
*Onde:* client/src/components/ContratosTab.jsx (linhas ~558-560) e demais usos de text-gray-400

**326. Padronizar os estados de foco (contorno ao navegar pelo teclado)**  `impacto baixo · esforço baixo`
Quando alguem navega com a tecla Tab, aparece um contorno ao redor do botao/campo. Hoje ha tres regras de contorno diferentes no sistema: uma azul, uma dourada e uma navy, dependendo do componente. Isso confunde e quem usa teclado nunca sabe que cor esperar. Definir um unico padrao de foco deixaria tudo previsivel e mais acessivel.
*Benefício:* Acessibilidade consistente para quem usa teclado.  
*Onde:* client/src/index.css (regras *:focus-visible nas linhas ~235-243 e ~1331-1339)

**327. Cobrir o modo escuro na visao de Cards de contratos**  `impacto medio · esforço medio`
A visao em Cards da aba Contratos usa cores fixas (azul #1A2E52 nos nomes e valores, cinzas claros nos rotulos) e quase nao tem regras de modo escuro proprias. Como sao cores escritas na mao, no modo escuro os cards ficam com texto azul/cinza sobre fundo escuro — baixa legibilidade justo num lugar onde se le valores de honorarios.
*Benefício:* Cards legiveis e bonitos no modo escuro.  
*Onde:* client/src/components/ContratosTab.jsx (bloco da visao Cards, ~linhas 534-540)

**328. Padronizar fundo, borda e cor das etiquetas 'pills' (arquivado, importado, etc.)**  `impacto medio · esforço medio`
As pequenas etiquetas arredondadas (ex.: 'Arquivado', 'Importado', cabecalhos azuis EEF4FF) cada uma tem seu proprio par de cor de fundo + cor de texto escrito na mao. Sao varios tons levemente diferentes do mesmo conceito. Criar um componente unico de 'pill' com variantes (neutra, info, sucesso, alerta) padronizaria todas de uma vez e ja resolveria o modo escuro delas.
*Benefício:* Etiquetas consistentes e faceis de manter; modo escuro de brinde.  
*Onde:* client/src/components/ContratosTab.jsx (linhas ~187, 296, 351, 570) e FormPanel.jsx:1344

**329. Padronizar cantos arredondados e sombras usando os tokens ja existentes**  `impacto baixo · esforço medio`
O sistema ja tem medidas oficiais de arredondamento (--cbc-radius) e de sombra (--cbc-shadow), mas muitas telas usam valores soltos do Tailwind (rounded-lg, rounded-xl, shadow-md) sem seguir essas medidas. O efeito e que cards parecidos tem cantos e sombras levemente diferentes entre abas.
*Benefício:* Cartoes e caixas com aparencia uniforme em todo o app.  
*Onde:* client/src/index.css (tokens prontos) + cards em FormPanel.jsx, ContratosTab.jsx, widgets.jsx

**330. Revisar as caixas de aviso amarelas/laranja para o modo escuro**  `impacto baixo · esforço baixo`
Avisos importantes na tela de cadastro (ex.: alerta de idoso, conflito de clausula) usam fundo amarelo-claro com texto marrom escritos na mao (#FFF8ED / #92400E). No modo escuro esses fundos claros continuam claros, virando faixas berrantes. Existem ja tokens de 'warning' que se adaptam ao tema.
*Benefício:* Avisos visiveis sem destoar no modo escuro.  
*Onde:* client/src/components/FormPanel.jsx (linhas ~1271 e ~1913)

**331. Decidir e documentar o papel do dourado funcional (acento) na interface**  `impacto medio · esforço baixo`
O dourado e a cor de prestigio da marca, mas hoje aparece de forma aleatoria: as vezes em barra de funil, as vezes num botao, as vezes num separador de login. Falta uma regra de 'onde o dourado pode e nao pode aparecer'. Definir isso (ex.: dourado so para celebracao/destaque, nunca para acao comum) deixa a marca mais forte e evita poluicao visual. Isso ja foi levantado como decisao em aberto na auditoria de 20/06.
*Benefício:* Marca navy/dourado com proposito claro, sem dourado 'jogado'.  
*Onde:* Transversal: LoginScreen.jsx, FunnelHealthPanel.jsx, FormPanel.jsx, BoletosPanel.jsx

**332. Centralizar as cores em tons de cinza dos textos/bordas em variaveis**  `impacto medio · esforço alto`
As telas usam dezenas de cinzas do Tailwind direto (text-gray-400/500/600/700, border-gray-200/300). Hoje o modo escuro so funciona porque o arquivo de estilos 'remenda' cada um desses cinzas com !important. E uma lista enorme e fragil: qualquer cinza novo que alguem use sem estar na lista quebra no escuro. Migrar gradualmente esses usos para as variaveis --cbc-text-* / --cbc-border tornaria o sistema robusto.
*Benefício:* Modo escuro deixa de depender de 'remendos' e para de quebrar com mudancas novas.  
*Onde:* client/src/index.css (bloco de overrides :root.dark, linhas ~783-883) + uso amplo nos componentes

**333. Corrigir os apelidos de cor 'gold' do Tailwind que renderizam azul**  `impacto medio · esforço baixo`
No arquivo de tema, as cores chamadas 'gold' e 'accent' foram apontadas para o azul-marinho. Entao quando um botao pede a classe 'fundo dourado' (bg-gold), ele aparece azul. No FormPanel (linha 1400) ha um botao assim: deveria ser dourado e sai azul.
*Benefício:* Botao volta a ter a cor pretendida; elimina pegadinha onde 'gold' significa azul  
*Onde:* client/src/index.css (bloco @theme, --color-gold/--color-accent) + client/src/components/FormPanel.jsx:1400

**334. Cantos arredondados em pixels fixos ignorando os tokens de raio**  `impacto baixo · esforço medio`
O sistema ja tem tres tamanhos oficiais de cantos arredondados (12/18/24px nas variaveis --cbc-radius). Mas muitos elementos usam classes soltas tipo 'rounded-lg', 'rounded-xl', 'rounded-2xl' misturadas. O resultado e cartoes e botoes com cantos levemente diferentes lado a lado.
*Benefício:* Cartoes e botoes ficam com o mesmo arredondamento, aparencia mais cuidada  
*Onde:* client/src/index.css (tokens --cbc-radius existem mas quase nao sao usados) + classes rounded-* em FormPanel/ContratosTab

**335. Fundo/borda do tom dourado fixos em rgba quebram no modo escuro**  `impacto medio · esforço baixo`
No painel do Dashboard, o tom 'accent' (dourado) tem a letra na cor-token (que vira um dourado mais claro no escuro), mas o fundo e a borda foram escritos com um dourado fixo rgba(201,168,76). No modo escuro a letra muda e o fundo nao, ficando descasado.
*Benefício:* Selo/barra dourada fica harmonica no modo escuro, sem letra e fundo de tons diferentes  
*Onde:* client/src/components/dashboard/widgets.jsx:48 (TONES.accent) + criar --cbc-accent-bg/--cbc-accent-border em index.css

**336. Tons decorativos (roxo/ciano/laranja) fixos somem no modo escuro**  `impacto medio · esforço medio`
Alem do dourado, ha tons decorativos roxo, ciano e laranja escritos com cor fixa no Dashboard (linhas 49-51). Eles nao escurecem nem clareiam no modo escuro como os tons de status, entao ficam com contraste fraco a noite.
*Benefício:* Graficos e selos coloridos do Dashboard ficam legiveis tambem no modo escuro  
*Onde:* client/src/components/dashboard/widgets.jsx:49-51 (violet/cyan/orange) — criar tokens correspondentes em index.css

**337. Fonte de titulo Cormorant escrita 'na mao' em cada arquivo**  `impacto baixo · esforço medio`
A fonte elegante dos titulos (Cormorant Garamond) e digitada solta em pelo menos 8 telas (Portal, Bot, Boletos, etc.). Pior: a variavel oficial de fonte de titulo (--font-heading) aponta para Lato, nao para a Cormorant. Quem mexer no futuro nao sabe qual e a fonte 'oficial' de titulo.
*Benefício:* Uma so fonte de titulo definida em um lugar; trocar/ajustar vira mudanca unica  
*Onde:* client/src/index.css (--font-heading) + 8 usos inline 'Cormorant Garamond, serif' em PortalClientePanel, BotAdvboxPanel, RelatorioBoletosModal, bot/BotMetricas, FunnelHealthPanel

**338. Cores de status de envio (verde/vermelho/amarelo) fixas no ContratosTab**  `impacto medio · esforço baixo`
Os selos de 'enviado/erro/enviando' na aba Contratos usam cores escritas a mao (ex.: fundo #D1FAE5 verde-claro, letra #065F46). Elas nao usam as variaveis de status do sistema, entao no modo escuro ficam claras demais e destoam dos mesmos selos no Dashboard.
*Benefício:* Selos de status iguais em todas as abas e corretos no modo escuro  
*Onde:* client/src/components/ContratosTab.jsx:127-128, 319-322, 351, 1579

**339. Transparencia de botao desabilitado varia de 25% a 60%**  `impacto baixo · esforço baixo`
Quando um botao fica desligado (cinza, sem clique), ele clareia. Mas esse 'quanto clareia' esta inconsistente: ora 25%, ora 30, 40, 50, 60%. O usuario percebe alguns botoes 'meio apagados' e outros 'quase invisiveis' sem motivo.
*Benefício:* Botoes desligados ficam com a mesma aparencia em todo o sistema  
*Onde:* client/src/components/FormPanel.jsx e ContratosTab.jsx (disabled:opacity-25/30/40/50/60)

**340. Cores de aviso de data de nascimento fixas, fora do modo escuro**  `impacto baixo · esforço baixo`
A faixinha de aviso embaixo da data de nascimento (idoso, data invalida, etc.) tem fundo e letra escritos a mao no CSS (ex.: vermelho #FEF2F2/#B91C1C). Nao ha versao para modo escuro, entao no escuro esses avisos ficam claros e gritantes demais.
*Benefício:* Avisos de data ficam suaves e legiveis tambem no modo escuro  
*Onde:* client/src/index.css:978-981 (.cbc-date-warning.is-error/is-warning/is-info/is-senior)

**341. Botoes de copia rapida do 2o contratante com azul fixo (sem modo escuro)**  `impacto baixo · esforço baixo`
Os botoes tracejados de 'copiar dados do 1o contratante' usam azul-marinho fixo (#1B3A5C) e fundo azul-claro fixo no hover. No modo escuro continuam claros, virando manchas brilhantes no formulario escuro.
*Benefício:* Atalhos de copia ficam integrados ao tema escuro do formulario  
*Onde:* client/src/index.css:999-1024 (.cbc-copy-btn e variantes)

**342. Anel de foco com duas cores diferentes brigando entre si**  `impacto medio · esforço baixo`
Ao navegar pelo teclado (Tab), o contorno que destaca o item esta definido duas vezes: em um trecho do CSS ele e azul (#3B82F6) e em outro e dourado/azul-marinho do tema. Dependendo do elemento, o mesmo sistema mostra contornos de cores diferentes.
*Benefício:* Navegacao por teclado com destaque visual consistente e na cor da marca  
*Onde:* client/src/index.css:235-243 (azul #3B82F6) versus :1330-1339 (gold/navy) — regras conflitantes

**343. Caixinha de OCR e validacao usam azul/verde/vermelho fixos**  `impacto baixo · esforço baixo`
Quando o sistema preenche um campo lendo a CNH, ele pisca em azul (#3B82F6); campo valido fica verde fixo, invalido vermelho fixo. Sao cores cravadas que nao seguem as variaveis do sistema nem o modo escuro, fugindo da identidade navy/dourado.
*Benefício:* Feedback de preenchimento alinhado a paleta da marca e ao modo escuro  
*Onde:* client/src/index.css:128-141 (.ocr-highlight, .input-valid, .input-invalid)

**344. Tooltips globais com fundo cinza fixo fora do tema**  `impacto baixo · esforço baixo`
As dicas que aparecem ao passar o mouse (tooltips) usam um cinza-chumbo fixo (#1f2937) tanto no modo claro quanto no escuro. No modo claro fica um balaozinho muito escuro destoando; e a cor nao vem de nenhuma variavel do sistema.
*Benefício:* Dicas com aparencia coerente nos dois modos e centralizadas num token  
*Onde:* client/src/index.css:582-605 (.cbc-tooltip::after/::before)

**345. Transicao de cor aplicada a TODOS os elementos da tela**  `impacto medio · esforço medio`
Existe uma regra que manda animar cor/fundo/borda em 'todo elemento da pagina' (o seletor coringa *). Isso pesa em telas com muitos itens (listas grandes de boletos/contratos) e faz cores 'arrastarem' ao rolar. O ideal e animar so o que precisa (ao trocar de tema).
*Benefício:* Telas com listas grandes ficam mais leves e sem rastros de cor ao rolar  
*Onde:* client/src/index.css:187-189 (.dark *, * { transition: ... })

**346. Banner de comemoracao e splash com dourado antigo (#C9A84C/#B8860B)**  `impacto baixo · esforço baixo`
A faixa dourada de 'contrato assinado' e a tela de abertura usam o dourado antigo escrito a mao (#C9A84C, #B8860B). Como o sistema agora tem variavel de dourado que se adapta ao tema, esses pontos ficaram para tras com o tom antigo, fora de sintonia com o resto.
*Benefício:* Dourado da comemoracao e da abertura igual ao usado no resto do app  
*Onde:* client/src/index.css:725-727 (.celebration-banner) e :920-938 (splash-tagline/loader)

**347. Cabecalhos de cartao com azul fixo no CSS em vez de token**  `impacto baixo · esforço baixo`
As faixas de titulo dos cartoes (.card-header) tem o azul-marinho cravado direto no CSS (#1B3A5C e #0F2035). Se um dia o azul da marca mudar, esses cabecalhos nao acompanham, e no modo escuro eles nao usam o token de cabecalho ja existente (--cbc-header-bg).
*Benefício:* Cabecalhos seguem a cor de marca central e o modo escuro automaticamente  
*Onde:* client/src/index.css:80-89 (.card-header / .card-header-dark) — usar var(--cbc-header-bg)


## 12. Integracao ADVBOX (CRM juridico)  *(30)*

**348. Colocar timeout nos envios (POST) ao ADVBOX**  `impacto alto · esforço baixo`
Quando o sistema CRIA cliente e processo no ADVBOX (os dois envios mais importantes), o codigo nao tem um 'tempo maximo de espera'. As buscas tem (15 segundos), mas os envios nao. Se o ADVBOX travar nesse momento, o nosso sistema fica esperando ate o Netlify desligar a tarefa no meio, deixando o contrato preso no estado 'processando'.
*Benefício:* Evita contrato 'preso' quando o ADVBOX engasga; falha rapido e o retry automatico cuida  
*Onde:* client/netlify/functions/advbox-sync.mjs (POST /customers linha ~175 e POST /lawsuits linha ~273)

**349. Reaproveitar o controle de ritmo/retry nos ENVIOS ao ADVBOX**  `impacto alto · esforço medio`
Ja existe um modulo bem feito (_lib/advbox.mjs) que segura o ritmo das chamadas (no maximo 15 por minuto), tenta de novo quando o ADVBOX responde 'muitas requisicoes' (429) e tem um 'disjuntor' que para de insistir quando a API esta fora do ar. Mas isso so e usado nas BUSCAS. Os ENVIOS (criar cliente/processo) usam fetch cru, sem nenhuma dessas protecoes. Como a conta ADVBOX e compartilhada com outros sistemas do escritorio, um envio pode ser recusado por excesso e nao tenta de novo.
*Benefício:* Envios deixam de falhar silenciosamente quando varias integracoes coincidem  
*Onde:* advbox-sync.mjs, advbox-create-task.mjs, advbox-vendas-sync.mjs, datajud-refresh.mjs (todos usam fetch cru)

**350. Avisar quando o e-mail do responsavel nao esta na lista**  `impacto medio · esforço baixo`
Cada advogado tem um numero de identificacao no ADVBOX, mapeado por e-mail numa lista fixa dentro do codigo. Se um contrato chega com um e-mail que NAO esta nessa lista (vendedor novo, e-mail diferente), o sistema atribui o processo ao Paulo silenciosamente, sem avisar ninguem. O processo acaba no responsavel errado e ninguem percebe.
*Benefício:* Para de atribuir processo ao responsavel errado sem ninguem saber  
*Onde:* advbox-sync.mjs funcao getResponsavelId (linha ~212) — registrar aviso em advbox_api_log

**351. Tirar a lista de advogados de dentro do codigo**  `impacto medio · esforço medio`
A tabela que liga e-mail do advogado ao numero dele no ADVBOX (USER_MAP, 9 pessoas) esta escrita dentro do programa. Para incluir um advogado novo, mudar e-mail ou tirar alguem que saiu, hoje e preciso um desenvolvedor editar e republicar o sistema. Se isso ficasse numa tabela do banco (ou em bot_config), o Paulo/admin ajustaria pela tela.
*Benefício:* Admin gerencia quem e responsavel sem depender de deploy  
*Onde:* advbox-sync.mjs USER_MAP (linha ~200) — mover para tabela Supabase ou bot_config

**352. Atualizar o cadastro do cliente que ja existe no ADVBOX**  `impacto medio · esforço medio`
Quando o cliente ja esta cadastrado no ADVBOX, o sistema apenas reaproveita o cadastro antigo e nem tenta corrigir dados. Se o cliente mudou de telefone, endereco ou e-mail no contrato novo, essas informacoes nao chegam ao ADVBOX. O comentario no codigo diz 'a API nao permite editar', mas o sistema JA usa edicao (PUT) de processos em outro ponto — vale testar editar o cliente tambem.
*Benefício:* Dados de contato no CRM ficam atualizados em vez de congelados na 1a vez  
*Onde:* advbox-sync.mjs createCustomer (bloco de cliente existente, linha ~185-191 e comentario linha 194)

**353. Gravar o numero do processo assim que o ADVBOX devolver**  `impacto baixo · esforço medio`
Ao criar o processo, o ADVBOX as vezes ja devolve dados uteis (numero/pasta). Hoje o advbox-sync so guarda o ID interno do processo; o numero oficial so e buscado depois, num outro robo (datajud-refresh, que roda 1x por dia as 8h). Capturar o que ja vem na resposta de criacao adianta a informacao e reduz uma busca extra na conta ADVBOX (que e limitada).
*Benefício:* Numero do processo aparece mais cedo e gasta menos cota da API  
*Onde:* advbox-sync.mjs createLawsuit (resposta da POST /lawsuits, linha ~282) — persistir campos extras

**354. Fortalecer a protecao contra task de guia duplicada**  `impacto medio · esforço medio`
Quando a vendedora marca 'guia juntada', o sistema cria uma tarefa no ADVBOX. A protecao contra criar a mesma tarefa duas vezes vive apenas na memoria do servidor por 10 segundos — se o Netlify abrir duas copias da funcao (acontece sob carga), as duas passam e cria-se tarefa em dobro nos autos. Uma trava no banco (igual a que ja existe para o ADVBOX sync) resolveria de vez.
*Benefício:* Elimina tarefa duplicada 'juntar guia' nos processos  
*Onde:* advbox-create-task.mjs (dedup em memoria recentCalls, linha ~46-58)

**355. Avisar quando andamento/tarefa nao casa com nenhum lead Kommo**  `impacto medio · esforço baixo`
O robo que le novidades dos processos (andamentos e tarefas) so posta aviso no Kommo se conseguir ligar o processo a um lead. Quando NAO consegue (processo sem lead mapeado), ele simplesmente nao avisa ninguem — e isso some sem registro. Contar quantos processos ficaram 'sem lead' e mostrar no Monitor ajuda a achar buracos no mapeamento.
*Benefício:* Da visibilidade de quantas novidades nao chegaram ao cliente por falta de vinculo  
*Onde:* advbox-monitor-worker-background.mjs funcao maybeNote (linha ~65-71)

**356. Cron do monitor sem 'minuto magico' colidindo com outras integracoes**  `impacto baixo · esforço baixo`
O monitor e o espelho de BI rodam todos na mesma conta ADVBOX que tem limite de 30 chamadas por minuto, compartilhada com Asaas, vendas-sync, datajud etc. Varios robos disparam em horarios cheios (06h30, 17h30, exatamente no minuto :30 ou :00). Espalhar os horarios em minutos diferentes (ex.: :07, :23) reduz a chance de todos baterem na API ao mesmo tempo e levarem 429.
*Benefício:* Menos recusas por excesso quando varios robos disparam juntos  
*Onde:* advbox-monitor.mjs / advbox-snapshot / advbox-vendas-sync / datajud-refresh (campos schedule)

**357. Watchdog para o monitor/espelho que travou no meio**  `impacto medio · esforço medio`
Ja existe um vigia (watchdog) que religa o backfill quando ele para. Mas o monitor e o espelho de BI (que sao o coracao do bot e do Power BI) nao tem vigia. Se uma rodada travar ou o ADVBOX ficar fora do ar na hora, a carteira do BI fica desatualizada ate a proxima rodada sem ninguem ser alertado. Um vigia que checa 'ultima rodada ha quanto tempo' e avisa no Monitor fecha esse ponto cego.
*Benefício:* BI e bot nao ficam silenciosamente desatualizados por uma rodada travada  
*Onde:* novo watchdog ou estender advbox-backfill-watchdog.mjs lendo bot_config.monitor_status/snapshot_status

**358. Persistir as origens/tipos de acao do ADVBOX em vez de IDs fixos**  `impacto medio · esforço medio`
Os numeros que ligam 'origem do lead' e 'tipo de acao' aos IDs do ADVBOX estao cravados no codigo (advboxMaps.mjs). Ja aconteceu de um tipo faltar e o processo ir para 'OUTROS' (o bug 'Revisao de Distrato'). Como o sistema ja sincroniza o catalogo do ADVBOX para detectar etapas/tarefas novas, daria para tambem checar se algum tipo de acao usado no formulario sumiu ou mudou de numero, e avisar no Monitor.
*Benefício:* Detecta quando um tipo de acao do formulario nao existe mais no ADVBOX  
*Onde:* _lib/advboxMaps.mjs (mapas fixos) + cruzar com getSettings()/syncCatalog no monitor

**359. Confirmar o resultado real do envio do cliente ao ADVBOX**  `impacto alto · esforço medio`
Quando o ADVBOX recusa criar um cliente, o sistema assume que e por duplicidade (CPF/nome ja existe) e tenta achar o cliente existente. Mas a recusa pode ser por OUTRO motivo (campo invalido, e-mail mal formado) e ai ele acha 'qualquer cliente parecido' e segue como se desse certo. Olhar a mensagem de erro de verdade (so tratar como duplicata quando for mesmo duplicata) evita ligar o processo ao cliente errado.
*Benefício:* Evita anexar processo ao cliente errado quando o erro nao era duplicidade  
*Onde:* advbox-sync.mjs createCustomer tratamento de erro (linha ~179-188)

**360. Mover lead no Kommo mesmo em retry quando ja existe processo**  `impacto medio · esforço baixo`
A movimentacao do lead no Kommo (e a nota de resumo) so acontece quando um processo NOVO e criado. No retry, quando o processo ja existia (existingLawsuitId reaproveitado), o codigo entra no caminho 'reused' e PODE pular o Kommo se a 1a tentativa tinha falhado so no Kommo (ex.: token 401 naquele momento). Garantir que o passo do Kommo rode tambem no reaproveitamento fecha esse furo.
*Benefício:* Lead nao fica 'parado' no Kommo quando so o Kommo falhou na 1a vez  
*Onde:* advbox-sync.mjs bloco 'if (existingLawsuitId)' linha ~392 vs bloco Kommo linha ~416

**361. Detectar processo apagado/arquivado no ADVBOX no sync de vendas**  `impacto baixo · esforço medio`
O robo que acompanha a fase do processo (vendas-sync) busca o detalhe de cada processo no ADVBOX. Se um processo for apagado ou arquivado la, a busca falha e ele apenas conta como 'fetch_fail' e segue — o contrato continua mostrando a fase antiga para sempre. Distinguir 'nao encontrei (404)' de 'erro temporario' e marcar o contrato ajuda a limpar a esteira de vendas.
*Benefício:* Kanban de vendas para de mostrar fase fantasma de processo que sumiu  
*Onde:* advbox-vendas-sync.mjs fetchLawsuit (linha ~91) e contagem fetch_fail (linha ~138)

**362. Limitar o tamanho do advbox_data guardado em cada contrato**  `impacto baixo · esforço baixo`
Toda resposta do ADVBOX (incluindo lista de avisos e dados dos clientes) e gravada inteira no contrato (campo advbox_data) e reaproveitada no retry. Com o tempo isso pode inchar a tabela de contratos e ainda carrega no retry um pacote maior do que o necessario. Guardar so o essencial (ids do processo e dos clientes) deixa o banco mais leve e os retries mais previsiveis.
*Benefício:* Tabela de contratos mais enxuta e retries mais limpos  
*Onde:* App.jsx (gravacao advbox_data linha ~708) + advbox-sync.mjs resposta final (linha ~449)

**363. Registrar de forma central as falhas dos envios ao ADVBOX**  `impacto medio · esforço baixo`
As buscas do bot/monitor ja escrevem erros num log central (advbox_api_log) que aparece no painel Monitor. Mas o advbox-sync (criar cliente/processo) so escreve na automation_log e devolve warnings na resposta — esses erros nao aparecem na 'Central ADVBOX' do Monitor junto com o resto. Mandar tambem para o log central da uma unica tela onde o Paulo ve TODOS os problemas da integracao.
*Benefício:* Uma so tela mostra todas as falhas ADVBOX (busca e envio)  
*Onde:* advbox-sync.mjs (usar logAdvbox tambem nos catch de createCustomer/createLawsuit, hoje so vira warning)

**364. Travar a 'janela de 3 dias' do monitor para nao perder andamentos**  `impacto medio · esforço medio`
O monitor busca andamentos dos ultimos 3 dias. Se uma rodada falhar e a seguinte tambem demorar, um andamento de 4 dias atras nunca mais e captado (a janela ja passou por ele). Guardar a data da ultima rodada bem-sucedida e abrir a janela a partir dela (em vez de fixos 3 dias) garante que nada cai no vazio, mesmo apos falhas seguidas.
*Benefício:* Nenhum andamento processual e perdido apos uma sequencia de falhas  
*Onde:* advbox-monitor-worker-background.mjs (janela start=hoje-3dias, linha ~53-54)

**365. Validar campos obrigatorios antes de enviar ao ADVBOX**  `impacto medio · esforço medio`
O envio monta o cliente/processo a partir do que veio no contrato e dispara direto. Se faltar algo que o ADVBOX exige (CPF vazio, UF invalida, data fora do formato), so descobrimos quando a API recusa, gerando um retry que vai falhar de novo eternamente. Uma checagem rapida antes de enviar (e marcar como 'erro definitivo, nao retentar') evita o contrato ficar batendo na porta do ADVBOX a cada 5 minutos para sempre.
*Benefício:* Para o retry infinito de contratos com dado invalido e aponta o que corrigir  
*Onde:* advbox-sync.mjs antes dos POST (createCustomer linha ~150 / createLawsuit linha ~220)

**366. Tirar a chave secreta do banco de dentro do codigo**  `impacto alto · esforço baixo`
Em dois arquivos da integracao ADVBOX (advbox-create-task e advbox-vendas-sync), a chave de acesso ao banco esta escrita LITERALMENTE no codigo como ultimo recurso, caso a configuracao oficial falhe. E como deixar a senha do cofre colada na parede atras do quadro.
*Benefício:* Some um ponto de vazamento de credencial; obriga o sistema a usar a chave configurada de forma segura, e nao uma copia exposta.  
*Onde:* client/netlify/functions/advbox-create-task.mjs (linha ~30) e advbox-vendas-sync.mjs (linha ~34)

**367. Unificar o 'cliente ADVBOX' num so lugar**  `impacto alto · esforço medio`
Hoje existem TRES conexoes separadas com o ADVBOX no codigo (uma no advbox-sync, outra no advbox-create-task, outra no advbox-vendas-sync), cada uma com seu proprio endereco, token e regras. Quando uma muda e as outras nao, nasce um bug silencioso — foi exatamente o que aconteceu com a 'Revisao de Distrato'. O ideal e todas usarem a mesma base ja pronta (_lib/advbox.mjs).
*Benefício:* Acaba o risco de copias divergindo; controle de ritmo, timeout e retry passam a valer para todos os envios de uma vez.  
*Onde:* advbox-sync.mjs, advbox-create-task.mjs, advbox-vendas-sync.mjs vs _lib/advbox.mjs

**368. Nao confiar no 'primeiro da lista' ao buscar cliente por CPF**  `impacto alto · esforço baixo`
Quando o sistema busca um cliente no ADVBOX pelo CPF e o filtro do ADVBOX devolve resultados que NAO batem exatamente, o codigo acaba pegando o primeiro nome que aparecer (o tal 'list[0]'). Num caso ruim, isso pode anexar o processo ao cliente ERRADO. Melhor: se nenhum bater certinho com o CPF/CNPJ, tratar como 'nao encontrado'.
*Benefício:* Evita ligar um contrato ao cliente errado no CRM juridico — erro caro de desfazer.  
*Onde:* advbox-sync.mjs findCustomerByCPF/findCustomerByIdentification (list[0]) e _lib/advbox.mjs findCustomerByCPF

**369. Impedir CPF/CNPJ repetido na lista de partes do processo**  `impacto baixo · esforço baixo`
Ao criar o processo, o sistema junta os IDs de todos os contratantes (customers_id). Se dois contratantes tiverem o mesmo documento (ex.: por erro de digitacao igual), o mesmo cliente pode ser colocado duas vezes como parte. Vale remover repetidos antes de enviar.
*Benefício:* Processo no ADVBOX sai limpo, sem a mesma pessoa listada duas vezes como parte.  
*Onde:* advbox-sync.mjs createLawsuit (customers.map(c => c.id))

**370. Avisar quando o ADVBOX rejeitar a data de assinatura/cadastro**  `impacto medio · esforço baixo`
O processo e criado mandando a data que o cliente assinou (status_closure) e a data da 1a mensagem (created_at). Se essas datas vierem estranhas (ex.: futuro, ou formato torto), o ADVBOX pode IGNORAR esses campos sem reclamar, e o processo fica com data errada sem ninguem notar. Vale validar as datas antes de enviar e registrar quando algo nao bate.
*Benefício:* Datas de fechamento corretas alimentam o funil, comissoes e o Dashboard sem distorcer numeros.  
*Onde:* advbox-sync.mjs createLawsuit (body.status_closure / body.created_at)

**371. Criar a tarefa inicial no ADVBOX ja na assinatura**  `impacto medio · esforço medio`
Hoje, quando o contrato e assinado, o sistema cria o cliente e o processo no ADVBOX, mas NAO cria automaticamente a primeira tarefa para o operacional (ex.: 'fazer inicial'). Isso so acontece manualmente depois (a tarefa de juntar guia). O operacional depende de olhar o estagio. Criar a tarefa de abertura automaticamente fecha esse buraco.
*Benefício:* Nenhum processo recem-assinado fica 'parado' esperando alguem perceber que precisa comecar.  
*Onde:* advbox-sync.mjs (apos createLawsuit) usando o padrao de advbox-create-task.mjs

**372. Confirmar que o worker do monitor realmente comecou**  `impacto medio · esforço medio`
O monitor agendado apenas 'dispara' o trabalho pesado e ja diz que deu certo (heartbeat true), sem checar se o worker de fato iniciou. Se o disparo falhar de leve, o sistema acha que sincronizou mas nada rodou — e ninguem ve. Vale registrar 'disparado' como pendente e so confirmar quando o worker gravar o resultado (monitor_status).
*Benefício:* Acaba o falso 'tudo certo'; uma sincronizacao que nao rodou fica visivel no painel Monitor.  
*Onde:* advbox-monitor.mjs (heartbeat antes de confirmar) + monitor-worker-background.mjs (monitor_status)

**373. Repetir os ENVIOS ao ADVBOX quando der erro temporario**  `impacto medio · esforço medio`
As BUSCAS no ADVBOX ja tentam de novo automaticamente quando o servidor responde 'ocupado' (429) ou cai por um instante. Mas os ENVIOS (criar cliente, criar processo, criar tarefa) NAO tentam de novo: na primeira falha temporaria, desistem. Como criar e a parte mais importante, vale dar o mesmo tratamento de nova tentativa.
*Benefício:* Menos contratos travando em 'erro ADVBOX' por uma falha de segundos, reduzindo retrabalho.  
*Onde:* advbox-sync.mjs (POST /customers, /lawsuits), advbox-create-task.mjs (POST /posts)

**374. Sincronizar o estagio de vendas respeitando o limite do ADVBOX**  `impacto medio · esforço baixo`
A sincronizacao do funil de vendas percorre TODOS os contratos assinados e consulta o ADVBOX um a um, sem o 'freio' de ritmo que as outras integracoes usam. Conforme a carteira cresce, isso pode estourar o limite do ADVBOX (erro 429) e atrapalhar o bot e o monitor que usam a mesma conta.
*Benefício:* Funil de vendas continua atualizando sem brigar por cota com bot, monitor e backfill.  
*Onde:* advbox-vendas-sync.mjs run() (loop fetchLawsuit sem throttle)

**375. Centralizar a regra de genero/profissao (evitar copia divergente)**  `impacto baixo · esforço medio`
A logica que adivinha sexo e ajusta a profissao para o masculino (ex.: 'advogada' -> 'advogado') esta escrita dentro do advbox-sync e tambem existe no formulario do frontend. Sao duas copias da mesma regra — se uma melhora e a outra nao, o cliente entra no ADVBOX com genero/profissao diferente do que aparece no contrato. Vale ter uma fonte unica, como ja foi feito com os mapas de origem/tipo de acao.
*Benefício:* Cliente fica consistente entre contrato e CRM; manutencao em um lugar so.  
*Onde:* advbox-sync.mjs detectGender/profissaoMasculino vs logica equivalente no FormPanel

**376. Salvar o lawsuit_id antes de tentar mover o lead no Kommo**  `impacto medio · esforço medio`
No fluxo de assinatura, o processo e criado no ADVBOX e LOGO em seguida tenta mover o lead no Kommo, tudo na mesma chamada. Se a chamada inteira cair entre criar o processo e o sistema gravar o lawsuit_id no banco, o processo existe no ADVBOX mas o sistema 'esquece' o numero dele — e no proximo retry pode criar de novo. Gravar o lawsuit_id assim que ele nasce (antes do Kommo) deixa a operacao mais a prova de falha.
*Benefício:* Reduz o risco raro de processo duplicado quando a operacao e cortada no meio.  
*Onde:* advbox-sync.mjs (retorno do createLawsuit -> persistir) + App.jsx (gravacao do advbox_lawsuit_id)

**377. Permitir trocar estagio inicial e responsavel sem mexer no codigo**  `impacto baixo · esforço medio`
O estagio inicial do processo (ASSINADO AUTOMACAO) e o responsavel padrao (Paulo) estao 'cravados' como numeros fixos no codigo. Se o escritorio reorganizar o funil no ADVBOX ou quiser que outro advogado receba os novos processos, hoje precisa alterar codigo e publicar. Mover isso para uma configuracao (igual ja existe para o operacional, via variavel de ambiente) deixa ajustavel pelo painel/config.
*Benefício:* Mudancas operacionais comuns deixam de exigir desenvolvedor e novo deploy.  
*Onde:* advbox-sync.mjs (STAGE_ASSINADO_AUTOMACAO, RESPONSAVEL_PADRAO)


## 13. Integracao Kommo (CRM comercial)  *(29)*

**378. Rotear o 'mover lead ao assinar' pela fila compartilhada**  `impacto alto · esforço medio`
Quando um contrato e assinado, o sistema move o lead no Kommo usando uma conexao direta (funcao advbox-sync.mjs), que NAO passa pela fila nem tem nova tentativa automatica. Ja existe um sistema de fila pronto (kommo.mjs com moveLeadStage) que tenta de novo sozinho se o Kommo estiver ocupado. Bastava o advbox-sync usar esse caminho.
*Benefício:* Se o Kommo recusar a chamada (limite de uso/instabilidade), o lead nao deixa de ser movido — a fila reenvia sozinha. Hoje so vira um aviso e depende de retry manual.  
*Onde:* client/netlify/functions/advbox-sync.mjs (funcao moverLeadKommo) -> usar moveLeadStage de _lib/kommo.mjs

**379. Rotear as notas automaticas (#14 resumo, #16 processo, #1 fase) pela fila**  `impacto alto · esforço medio`
As notas que aparecem no lead do Kommo (resumo do negocio, numero do processo, mudanca de fase) sao postadas por chamada direta na funcao kommo-note, sem fila e sem retry. Se o Kommo estiver ocupado naquele segundo, a nota simplesmente nao sai e ninguem reenvia.
*Benefício:* Garante que toda nota importante chega ao CRM mesmo com instabilidade momentanea do Kommo, sem perder informacao para o time comercial.  
*Onde:* advbox-sync.mjs, datajud-refresh.mjs (chamadas a kommo-note) -> usar postNote de _lib/kommo.mjs

**380. Unificar a logica de notas: kommo-note deveria usar o cliente compartilhado**  `impacto medio · esforço alto`
Existem hoje DUAS implementacoes do Kommo: a funcao kommo-note.mjs (com seu proprio controle de token, sem espacamento entre chamadas e sem retry de limite) e a biblioteca _lib/kommo.mjs (mais nova, com espacamento, retry e fila). A nota acaba sendo postada pela versao antiga. Manter duas versoes ja causou bug parecido no passado (caso do Edmar, no ADVBOX).
*Benefício:* Uma fonte unica de verdade evita que uma copia conserte um problema e a outra continue com ele. Reduz risco de bugs sutis e facilita manutencao.  
*Onde:* client/netlify/functions/kommo-note.mjs vs _lib/kommo.mjs

**381. Adicionar retry de limite (429) na busca de notas existentes**  `impacto medio · esforço baixo`
Antes de postar uma nota, o sistema le todas as notas do lead para nao duplicar. Essa leitura (funcao jaTemNota) NAO tem nova tentativa quando o Kommo responde 'muitas chamadas' (429). Se isso acontecer, a nota e descartada e re-tentada so no proximo ciclo — e em leads com milhares de notas a leitura pode ser longa e custosa.
*Benefício:* Menos notas atrasadas e menos chamadas desperdicadas; a leitura ganha a mesma robustez de espera/retry que o resto da integracao ja tem.  
*Onde:* client/netlify/functions/kommo-note.mjs (funcao jaTemNota)

**382. Postar a nota 'abriu e nao assinou' na hora, via webhook do ZapSign**  `impacto medio · esforço medio`
A nota que avisa 'o cliente abriu o contrato mas nao assinou' so e checada de 30 em 30 minutos por uma rotina agendada (kommo-view-check). O ZapSign ja avisa em tempo real quando alguem visualiza (o webhook ja recebe times_viewed). Da para postar a nota no instante que o cliente abre, em vez de esperar ate meia hora.
*Benefício:* O vendedor recebe o gatilho de follow-up quase na hora em que o cliente demonstrou interesse — momento mais quente para fechar.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs + kommo-view-check.mjs

**383. Guardar o ID do lead em coluna propria, nao so dentro do JSON**  `impacto medio · esforço medio`
O sistema descobre o lead do Kommo extraindo o numero de uma URL guardada dentro do campo JSON 'dados' do contrato (linkKommo). Toda funcao repete esse mesmo recorte de texto. Se um vendedor colar o link num formato diferente, a integracao inteira para para aquele cliente, em silencio.
*Benefício:* Uma coluna kommo_lead_id no contrato deixa as buscas mais rapidas e confiaveis, e permite alertar quando o link esta num formato invalido em vez de falhar calado.  
*Onde:* tabela contratos (nova coluna) + extrairLeadId usado em advbox-sync, kommo-note, datajud-refresh, kommo-view-check

**384. Trocar as senhas-padrao fracas das funcoes Kommo**  `impacto alto · esforço baixo`
Varias funcoes (kommo-asaas-sync, kommo-leads-sync, kommo-queue-worker) aceitam, como senha de protecao, o valor padrao 'cbc-bot-2026' quando a variavel de ambiente nao esta configurada. Esse valor esta no codigo e qualquer um que veja o repositorio pode usar para disparar essas rotinas.
*Benefício:* Fecha uma porta de acesso indevido as integracoes (que mexem no CRM e na cobranca). Risco baixo de configurar e alto de deixar como esta.  
*Onde:* BOT_PANEL_KEY nas funcoes kommo-asaas-sync.mjs, kommo-leads-sync.mjs, kommo-queue-worker.mjs

**385. Capturar a origem do lead (UTM/anuncio) no contrato**  `impacto medio · esforço medio`
Hoje o codigo nao guarda de onde o lead veio (qual anuncio do Facebook/Google, campanha, etc.) — esses campos existem no Kommo mas chegam praticamente vazios. Ao puxar o lead na hora de mover/notar, da para ler os campos de origem que existirem e gravar no contrato.
*Benefício:* Comeca a ligar 'contrato assinado' com 'anuncio que trouxe o cliente', base para medir retorno de marketing por campanha no Dashboard.  
*Onde:* client/netlify/functions/_lib/kommo.mjs (getLeadsByIds) + gravacao no contrato

**386. Devolver a conversao real ao Facebook quando o contrato e assinado (CAPI)**  `impacto alto · esforço alto`
Quando um lead que veio de anuncio do Facebook assina, o Facebook nao fica sabendo — entao ele nao aprende a achar mais clientes parecidos. A 'Conversions API' (CAPI) e o canal oficial para mandar esse aviso de volta. O Kommo ja tem suporte nativo a isso e os pre-requisitos estao OK (ver memoria).
*Benefício:* Anuncios passam a otimizar para quem realmente assina contrato (nao so quem manda mensagem), reduzindo custo por cliente fechado.  
*Onde:* novo gatilho no fluxo de assinatura (advbox-sync/zapsign-webhook) -> CAPI nativa do Kommo

**387. Rotina diaria que aponta leads duplicados no Kommo**  `impacto medio · esforço medio`
A API do Kommo nao mescla leads duplicados automaticamente (so da para mesclar na tela manualmente). Mas o sistema ja tem um espelho dos leads (kommo_leads, por telefone+nome). Da para uma rotina varrer esse espelho e listar os prováveis duplicados num painel, para a secretaria mesclar na mao.
*Benefício:* Evita que o mesmo cliente vire dois leads (cobranca, notas e historico espalhados), sem precisar caca-los manualmente.  
*Onde:* client/netlify/functions/kommo-leads-sync.mjs (espelho kommo_leads) + nova rotina/painel

**388. Suportar mais de um link de cobranca no campo Asaas do lead**  `impacto medio · esforço medio`
O campo 'Asaas' do lead (que recebe o link do carne de boletos) e do tipo URL e so cabe UM link. Quando o cliente tem mais de um parcelamento aberto, o sistema grava so o primeiro e perde os outros. O tipo do campo no Kommo nao da para mudar; a saida e criar um campo de texto que aceite varias linhas.
*Benefício:* Cliente com varios parcelamentos passa a ter todos os links de cobranca visiveis no CRM, evitando boletos esquecidos.  
*Onde:* client/netlify/functions/kommo-asaas-sync.mjs (logica isUrlField) + campo no Kommo

**389. Confirmar que a nota foi mesmo postada antes de marcar como feita**  `impacto medio · esforço baixo`
Na nota de mudanca de fase (datajud-refresh), o sistema chama a funcao de nota mas trata qualquer resposta 'ok' como sucesso — inclusive o caso em que a nota NAO foi postada porque a checagem de duplicidade estava indisponivel (kommo-note devolve ok:false nesse caso, mas o codigo nao distingue bem). Vale garantir que so se marque 'fase notificada' quando posted:true ou a nota ja existia.
*Benefício:* Evita que uma mudanca de fase do processo deixe de virar nota no CRM por causa de uma falha momentanea, sem ninguem perceber.  
*Onde:* client/netlify/functions/datajud-refresh.mjs (gravacao de advbox_fase_notificada)

**390. Painel de saude da integracao Kommo no Monitor**  `impacto medio · esforço medio`
Hoje os erros do Kommo caem no log geral (advbox_api_log) misturados com tudo. Como o Kommo move leads, posta notas e enfileira escritas, vale uma secao propria no Monitor mostrando: tamanho da fila, nota mais antiga parada, erros 401 (token expirado) e ultima vez que cada rotina rodou.
*Benefício:* O time enxerga rapido quando o token do Kommo caiu ou a fila travou, em vez de descobrir pelo cliente reclamando.  
*Onde:* client/src/components/MonitorPanel.jsx + queueStats de _lib/kommoQueue.mjs

**391. Alertar automaticamente quando o token do Kommo expira (401)**  `impacto alto · esforço medio`
O token do Kommo ja caiu antes (erro 401) e quando isso acontece TODAS as automacoes do CRM param caladas — leads nao movem, notas nao saem. Hoje so se descobre olhando log ou pelo cliente. Da para detectar o 401 e disparar um aviso na hora (notificacao/email para o Paulo).
*Benefício:* Reduz o tempo em que o CRM fica 'mudo' de horas/dias para minutos, evitando perda de follow-up comercial.  
*Onde:* _lib/kommo.mjs (kommoFetch) + advbox-sync.mjs / kommo-note.mjs (tratar status 401)

**392. Reaproveitar a leitura de notas para evitar GETs repetidos**  `impacto baixo · esforço medio`
Quando varias notas sao postadas no mesmo lead em sequencia (ex.: resumo + processo), cada uma le toda a lista de notas do lead do zero para checar duplicidade. Em leads muito ativos isso multiplica chamadas ao Kommo. Da para ler as notas uma vez por lead e reaproveitar no mesmo ciclo.
*Benefício:* Menos chamadas ao Kommo (menos risco de bater no limite) e notas postadas mais rapido.  
*Onde:* client/netlify/functions/kommo-note.mjs (jaTemNota) + chamadas em lote

**393. Centralizar os IDs fixos do Kommo (funil, etapa, campos) num so lugar**  `impacto baixo · esforço baixo`
Numeros fixos do Kommo — funil Venda (13760367), etapa ADVBOX (106388919), campo Drive, campo Asaas, campo BOT_RESPOSTA — estao espalhados como numeros soltos em varias funcoes. Se o escritorio renomear/recriar uma etapa no Kommo, e preciso cacar esses numeros em arquivos diferentes.
*Benefício:* Mudancas de configuracao do CRM viram uma alteracao num unico arquivo, com menos risco de esquecer uma cópia e quebrar parte da integracao.  
*Onde:* constantes em advbox-sync.mjs, kommo-asaas-sync.mjs -> centralizar em _lib/kommo.mjs

**394. Deduplicar a movimentacao de lead por contrato, nao so por execucao**  `impacto baixo · esforço baixo`
Quando um contrato tem varios contratantes apontando para o MESMO lead, o codigo evita mover duas vezes naquela execucao (usa um Set 'seen'). Mas se o sync rodar de novo (retry), ele torna a mover/notar. O PATCH e idempotente, porem a nota de resumo depende so do marcador. Vale uma trava por contrato para nao reprocessar o Kommo a cada retry do ADVBOX.
*Benefício:* Menos chamadas repetidas ao Kommo em retries e historico do lead mais limpo, sem reprocessamento desnecessario.  
*Onde:* client/netlify/functions/advbox-sync.mjs (bloco Kommo, controle por contrato)

**395. Migrar o advbox-sync para a fila Kommo (parar de chamar o Kommo por fora)**  `impacto alto · esforço medio`
Quando um contrato e assinado, o sistema move o lead e escreve o link do Drive no Kommo usando um caminho ANTIGO e direto (funcao moverLeadKommo no arquivo advbox-sync.mjs), que nao passa pela fila compartilhada nem pelo controle de velocidade. So as notas e o campo Asaas usam a fila nova. Resultado: nesse momento critico (assinatura) o sistema pode bater no limite do Kommo e a movimentacao falhar sem retentativa organizada.
*Benefício:* Movimentacao do lead ao assinar fica tao confiavel quanto o resto; uma fila so para tudo.  
*Onde:* client/netlify/functions/advbox-sync.mjs (moverLeadKommo, linhas ~295-315 e bloco ~415-444)

**396. Conferir a conta do Kommo antes de mover o lead (evitar mexer no lead errado)**  `impacto medio · esforço baixo`
A funcao que move o lead ao assinar (moverLeadKommo) so pega o NUMERO do lead do link e sempre manda o comando para a conta advocaciacbc.kommo.com, sem checar se o link era realmente dessa conta. O sync do Asaas ja faz essa checagem de 'host' (de qual conta e o link) e pula links de outra conta; a movimentacao do lead NAO faz. Se algum dia colarem um link de outra conta Kommo, o sistema moveria um lead aleatorio com aquele mesmo numero.
*Benefício:* Elimina o risco de alterar o lead errado por causa de um link de outra conta.  
*Onde:* client/netlify/functions/advbox-sync.mjs (moverLeadKommo) vs. extrairHostKommo em _lib/kommo.mjs

**397. Postar a nota 'abriu e nao assinou' na hora pelo webhook do ZapSign**  `impacto medio · esforço medio`
O ZapSign avisa o sistema toda vez que o cliente ABRE o contrato (campo times_viewed chega no webhook), e o sistema ja grava isso no banco. Mas a nota de follow-up 'abriu e nao assinou' so e postada por uma rotina que roda de 30 em 30 minutos. Aproveitando o aviso de abertura que ja chega, da para postar a nota quase instantaneamente, no momento em que o cliente abriu.
*Benefício:* Vendedor recebe o sinal de follow-up na hora certa, nao com ate 30 min de atraso.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (linha ~99, ja le times_viewed) + kommo-view-check.mjs

**398. Alertar quando notas/movimentacoes ficam encalhadas na fila do Kommo**  `impacto medio · esforço baixo`
A fila de escritas do Kommo tenta varias vezes e, se esgotar, marca o item como 'failed' (falhou de vez). Hoje isso so vira um aviso discreto no log; ninguem e avisado ativamente. Uma nota importante (resumo do negocio, processo distribuido) pode simplesmente nunca ter sido postada e ninguem percebe. Vale um alerta visivel (no Monitor ou por e-mail) quando houver itens 'failed' ou um item 'pendente' ha muito tempo.
*Benefício:* Nenhuma nota/movimentacao some em silencio; o time fica sabendo e corrige.  
*Onde:* client/netlify/functions/_lib/kommoQueue.mjs (queueStats ja calcula falhas e oldestPending) + painel do Monitor

**399. Reprocessar automaticamente itens que falharam de vez na fila**  `impacto medio · esforço baixo`
Quando um item da fila do Kommo estoura as 6 tentativas, ele fica parado como 'failed' para sempre, mesmo que o problema tenha sido temporario (Kommo fora do ar por uma hora, token expirado e depois trocado). Hoje so da para reprocessar manualmente. Uma rotina diaria poderia re-empurrar esses 'failed' uma vez, ou um botao 'tentar de novo' no painel resolveria o caso comum (problema ja passou).
*Benefício:* Itens que falharam por causa temporaria voltam sozinhos quando o Kommo normaliza.  
*Onde:* client/netlify/functions/_lib/kommoQueue.mjs (status 'failed', MAX_ATTEMPTS=6) + kommo-queue-worker.mjs

**400. Padronizar a captura de origem do lead (campo estruturado em vez de texto livre)**  `impacto medio · esforço medio`
A origem do cliente e preenchida a mao num campo unico ('Origem do Cliente') no formulario. Como e uma escolha solta, fica dificil cruzar depois com a campanha/anuncio que de fato gerou o lead. Da para puxar a origem real direto do Kommo (campos de fonte/UTM que ja existem no lead pelo linkKommo) ou ao menos travar as opcoes do dropdown numa lista fixa, para o BI conseguir agrupar por canal.
*Benefício:* Saber de verdade qual canal traz cliente que assina, sem digitacao livre baguncando o relatorio.  
*Onde:* client/src/components/FormPanel.jsx (origemCliente, linhas ~1782-1786) + leitura do lead Kommo

**401. Job que aponta leads duplicados a partir do espelho Kommo ja existente**  `impacto medio · esforço medio`
O sistema ja copia os leads do Kommo para uma tabela propria (kommo-leads-sync.mjs grava telefone/nome/email de cada lead). Falta uma rotina que use esse espelho para apontar telefones repetidos (o mesmo cliente com varios leads), gerando uma lista de candidatos a mesclar. Como a API do Kommo nao mescla sozinha, pelo menos a LISTA pronta ja economiza muito o trabalho manual de caca-duplicata.
*Benefício:* Lista pronta de leads duplicados sem garimpar a mao; CRM mais limpo.  
*Onde:* client/netlify/functions/kommo-leads-sync.mjs (tabela kommo_leads por telefone) + nova rotina/relatorio

**402. Tornar as notas idempotentes por conteudo, nao so pelo marcador no fim do texto**  `impacto medio · esforço medio`
Para nao duplicar nota, o sistema procura um 'marcador' (ex: — CBC.resumo) no FIM do texto da nota. Se alguem editar a nota no Kommo e mexer no fim, ou se o texto for cortado, o marcador some e a nota pode ser postada de novo (e o Kommo NAO deixa apagar nota duplicada). Guardar tambem no proprio sistema 'ja postei a nota X no lead Y' (uma marca no banco, como ja existe para a #18) deixa a protecao a prova de edicao manual.
*Benefício:* Zero risco de nota repetida no lead mesmo se editarem o texto no Kommo.  
*Onde:* client/netlify/functions/kommo-note.mjs (jaTemNota, busca '— marker' no texto)

**403. Reduzir as ate 40 paginas de leitura de notas antes de cada nota**  `impacto medio · esforço medio`
Antes de postar uma nota, o sistema pode varrer ate 40 paginas de notas do lead (ate 10 mil notas) procurando o marcador, para nao duplicar. Em leads muito antigos/movimentados isso e lento e consome chamadas ao Kommo. Guardar no banco quais marcadores ja foram postados em cada lead (uma marca por contrato) evita quase toda essa varredura — a leitura vira excecao, nao regra.
*Benefício:* Postar nota fica mais rapido e gasta menos chamadas ao Kommo.  
*Onde:* client/netlify/functions/kommo-note.mjs (loop 'for page <= 40')

**404. Suportar mais de um link de cobranca quando o campo Asaas e do tipo URL**  `impacto baixo · esforço medio`
Quando o cliente tem mais de um parcelamento Asaas em aberto, o campo 'Asaas' do lead so guarda UM link (porque, sendo do tipo URL, o Kommo so aceita uma URL). O segundo carne fica de fora, com so uma observacao no relatorio. Como o tipo do campo no Kommo nao da para mudar, a saida e criar um segundo campo de link no Kommo (ou um campo de texto) para caber todos os carnes do cliente.
*Benefício:* Cliente com varios parcelamentos tem TODOS os carnes a um clique no lead.  
*Onde:* client/netlify/functions/kommo-asaas-sync.mjs (isUrlField, linhas ~102-114)

**405. Centralizar e versionar os IDs fixos do Kommo (funil, etapa, campos)**  `impacto baixo · esforço baixo`
Numeros fixos do Kommo (funil Venda 13760367, etapa ADVBOX 106388919, campo Drive, campo Asaas) estao espalhados e cravados em mais de um arquivo. O campo Asaas ja e descoberto pelo nome e cacheado; os demais sao chumbados no codigo. Se o escritorio renomear uma etapa ou recriar um campo no Kommo, varios pontos quebram de uma vez e e dificil achar todos. Juntar tudo num lugar so (e, idealmente, descobrir pelo nome como ja faz o campo Asaas) deixa a manutencao segura.
*Benefício:* Mudou algo no Kommo? Ajusta num lugar so, sem cacar numero por todo o codigo.  
*Onde:* advbox-sync.mjs (KOMMO_PIPELINE_VENDA/KOMMO_STAGE_ADVBOX/KOMMO_FIELD_DRIVE) + _lib/kommo.mjs

**406. Registrar no contrato em qual etapa do Kommo o lead ficou (auditoria da movimentacao)**  `impacto baixo · esforço baixo`
Hoje o sistema marca que 'moveu o lead' (campo kommo.moved), mas nao guarda o resultado real: para qual etapa foi, se ja estava la, se deu erro de permissao. Quando o vendedor diz 'o lead nao mudou de coluna', nao da para conferir rapido o que o sistema tentou fazer. Guardar a etapa de origem/destino e o status da tentativa no proprio contrato facilita o diagnostico sem ter que ler logs.
*Benefício:* Resposta imediata para 'por que esse lead nao avancou' sem caçar em log.  
*Onde:* client/netlify/functions/advbox-sync.mjs (bloco kommo = { moved, ... }, linha ~444)


## 14. Integracao Asaas (cobranca/financeiro)  *(31)*

**407. Risco de NF duplicada entre dois caminhos diferentes**  `impacto alto · esforço medio`
Hoje a Nota Fiscal e emitida por DOIS lugares ao mesmo tempo: quando o boleto e criado, o sistema pede ao Asaas para emitir a NF 'na confirmacao do pagamento' (agendada); e quando o pagamento entra, o webhook tambem manda emitir a NF na hora. Se os dois funcionarem, sai NF em dobro. Hoje so nao da problema porque o caminho do contrato (parcelado) nao agenda NF, mas qualquer mexida quebra esse equilibrio fragil.
*Benefício:* Evita NF fiscal emitida duas vezes para o mesmo pagamento, que da dor de cabeca com a prefeitura e com o cliente  
*Onde:* asaas-sync.mjs (scheduleInvoice, effectiveDatePeriod ON_PAYMENT_CONFIRMATION) + asaas-webhook.mjs (POST /invoices). Escolher UM caminho unico de emissao

**408. Chave secreta do banco escrita dentro do codigo**  `impacto alto · esforço baixo`
No arquivo asaas-sync.mjs existe uma chave de acesso ao banco de dados (Supabase) escrita direto no codigo-fonte, usada como 'plano B' caso a variavel de ambiente nao esteja configurada. Codigo-fonte e copiado/versionado, entao essa chave fica exposta a quem tiver acesso ao repositorio.
*Benefício:* Reduz risco de vazamento de credencial do banco; obriga a usar a variavel segura do Netlify  
*Onde:* asaas-sync.mjs linha 19 (SUPABASE_KEY com fallback de chave fixa) — remover o fallback e exigir a env

**409. Boletos do contrato dependem so do webhook para gerar NF**  `impacto alto · esforço baixo`
Quando o cliente assina e o sistema cria a cobranca parcelada (create-payment), ele NAO agenda a NF. A nota so sai se o webhook do Asaas chegar avisando do pagamento. Se aquele webhook falhar ou nao estiver configurado para aquele evento, o pagamento entra mas a NF nunca e emitida — e ninguem percebe automaticamente.
*Benefício:* Garante que todo pagamento de contrato gere NF, mesmo se o webhook falhar  
*Onde:* asaas-sync.mjs caso 'create-payment' — chamar scheduleInvoice como ja e feito em 'create-single'

**410. Webhook do Asaas ainda aceita evento sem senha forte**  `impacto alto · esforço baixo`
O endereco que recebe os avisos de pagamento do Asaas so exige senha SE a variavel ASAAS_WEBHOOK_TOKEN estiver configurada. Hoje ela nao esta, entao o proprio codigo avisa que esta 'aberto'. Na pratica, alguem que descubra o endereco poderia forjar um 'pagamento confirmado' e disparar emissao de NF indevida.
*Benefício:* Fecha a porta para um falso 'pagamento confirmado' gerar NF e baixar boleto sem dinheiro entrar  
*Onde:* asaas-webhook.mjs (bloco de auth ENV_TOKEN) — configurar ASAAS_WEBHOOK_TOKEN no Netlify e no painel Asaas

**411. Texto e descricao da NF sao genericos e fixos**  `impacto medio · esforço baixo`
A descricao do servico na NF emitida pelo webhook e sempre 'Prestacao de servicos advocaticios - [nome]', sem o resort, o numero do contrato ou o tipo de acao. Para o financeiro e para o cliente, a nota fica pobre e dificil de conferir com o contrato correspondente.
*Benefício:* NF mais clara, mais facil de bater com o contrato e justificar fiscalmente  
*Onde:* asaas-webhook.mjs (invoiceBody.serviceDescription) e asaas-sync.mjs (scheduleInvoice) — incluir resort/contrato

**412. Multa e juros do boleto estao fixos no codigo (10% e 1%)**  `impacto baixo · esforço medio`
Todo boleto sai com 10% de multa e 1% de juros ao mes, valores cravados no codigo. Se o escritorio quiser mudar a politica de cobranca, ou aplicar regra diferente por tipo de honorario, hoje so mexendo no codigo e fazendo novo deploy.
*Benefício:* Permite ajustar politica de multa/juros sem programador, e diferenciar por caso  
*Onde:* asaas-sync.mjs (createPayment, create-single, create-single-payment: fine 10% / interest 1%) — mover para config

**413. Falha ao emitir NF nao avisa o cliente nem reativa sozinha**  `impacto medio · esforço medio`
Quando a emissao da NF falha, o sistema registra o erro num log interno (Monitor) e libera a trava — mas ninguem e avisado ativamente e nao ha nova tentativa automatica. Na pratica, uma NF que falhou pode ficar parada ate alguem olhar o Monitor manualmente.
*Benefício:* NFs que falharam nao ficam esquecidas; o financeiro e avisado e pode reemitir  
*Onde:* asaas-webhook.mjs (bloco !invoice?.id, logAdvbox nf_pendente) — adicionar fila de reemissao ou alerta/painel de 'NFs pendentes'

**414. Sincronizar boletos de um cliente nao trata limite de chamadas do Asaas**  `impacto medio · esforço baixo`
Quando voce abre o card de um cliente, o sistema busca todos os boletos, notas e PIX dele no Asaas em paralelo. Se o Asaas responder 'muitas chamadas, espere' (erro 429), essa funcao nao tenta de novo — diferente do sync de fundo, que ja respira e tenta outra vez. Resultado: alguns boletos podem nao atualizar na hora.
*Benefício:* Card do cliente abre com dados completos mesmo quando o Asaas esta sobrecarregado  
*Onde:* asaas-sync-customer.mjs (asaasGet sem retry de 429) — aplicar o mesmo tratamento de 429 do asaasMirror.mjs

**415. CPF/CNPJ nao e validado antes de criar cliente no Asaas**  `impacto medio · esforço baixo`
Ao criar o cliente no Asaas, o sistema so tira a pontuacao do CPF mas nao confere se ele e valido. Um CPF digitado errado cria um cliente 'torto' no Asaas, gera boleto e depois nao bate com o cadastro — virando cliente duplicado ou orfao, problema que ja apareceu antes (caso Celso citado no codigo).
*Benefício:* Menos clientes duplicados/invalidos no Asaas e menos retrabalho de conciliacao  
*Onde:* asaas-sync.mjs (createCustomer / findCustomer) — validar checksum de CPF/CNPJ antes de chamar o Asaas

**416. Sync ao abrir o card busca clientes sem boleto repetidamente**  `impacto baixo · esforço baixo`
Toda vez que voce abre o card de um cliente no painel de Boletos, o sistema chama o Asaas para atualizar aquele cliente — mesmo que ele acabou de ser atualizado ou nao tenha nada novo. Para clientes muito acessados isso gasta chamadas a toa e deixa a abertura mais lenta.
*Benefício:* Card abre mais rapido e gasta menos chamadas ao Asaas  
*Onde:* BoletosPanel.jsx (ClientCard.loadBoletos chama asaas-sync-customer sempre) — pular se sincronizado ha pouco (ex.: <5 min via synced_at)

**417. Taxa de inadimplencia pode enganar por nao olhar so o periodo certo**  `impacto medio · esforço medio`
A inadimplencia mostrada e 'vencido dividido por (vencido + pago)' usando todo o historico. Boletos pagos de anos atras entram na conta e 'diluem' a inadimplencia atual, deixando o numero parecer melhor do que e no mes corrente. So fica certo se a pessoa lembrar de usar o filtro de datas.
*Benefício:* Indicador de inadimplencia mais honesto e comparavel mes a mes  
*Onde:* BoletosPanel.jsx (stats useMemo, calculo inadimp) e AsaasPanel — oferecer recorte por periodo padrao (ex.: ultimos 90 dias)

**418. Sincronizacao completa de clientes sem limite de seguranca de chamadas**  `impacto baixo · esforço medio`
O sync diario de clientes percorre todos os clientes do Asaas em sequencia, ate 200 blocos. Conforme a base cresce (ja sao ~1.300+), isso consome cada vez mais chamadas em sequencia e pode esbarrar no limite do Asaas ou demorar, sem nenhum freio entre os blocos.
*Benefício:* Sync de clientes mais estavel conforme a carteira cresce, sem estourar limite do Asaas  
*Onde:* asaas-sync-customers.mjs (runFullSync, loop de processBlock sem throttle nem retry 429)

**419. PDFs de descritivo e NF sao baixados na hora, podem travar o navegador**  `impacto baixo · esforço medio`
O botao 'Descritivo + NFs' baixa todas as notas fiscais do cliente uma a uma e junta tudo num PDF dentro do proprio navegador. Para um cliente com muitas parcelas pagas, isso pode demorar e travar a aba. Tambem nao avisa quais NFs falharam ao baixar — elas simplesmente somem do PDF final.
*Benefício:* Geracao de relatorio mais confiavel e que avisa quando alguma NF nao entrou  
*Onde:* BoletosPanel.jsx (mergeStatementAndNFs) — informar NFs que falharam e/ou limitar/avisar em volumes grandes

**420. Conferencia de NF nao tem visao geral de 'pagos sem nota'**  `impacto medio · esforço medio`
Hoje da para ver a NF boleto a boleto, mas nao existe uma tela que liste rapidamente TODOS os pagamentos recebidos que ainda estao sem nota fiscal emitida. Isso e exatamente o que o financeiro precisa para garantir que nenhuma NF ficou para tras.
*Benefício:* O financeiro enxerga de uma vez tudo que recebeu mas ainda nao tem NF, e age  
*Onde:* AsaasPanel.jsx / BoletosPanel.jsx — nova visao 'Pagos sem NF' a partir de asaas_boletos (status pago + nf_number nulo)

**421. Sync manual no painel para no primeiro erro e perde o progresso**  `impacto baixo · esforço medio`
O botao 'Sync Asaas' do painel processa clientes e boletos em blocos. Se um bloco der erro no meio, ele joga uma mensagem de erro e para tudo — o que ja foi sincronizado fica, mas o resto da rodada nao termina e a pessoa precisa comecar de novo.
*Benefício:* Sincronizacao manual termina mesmo com uma falha pontual no meio  
*Onde:* BoletosPanel.jsx (manualSync, throw que interrompe o while) — registrar o bloco com erro e continuar

**422. Reconciliacao de boletos 'sumidos' depende de janela de 90 dias**  `impacto baixo · esforço medio`
O sync de fundo so olha boletos pagos dos ultimos 90 dias para economizar chamadas. Boletos pendentes/vencidos antigos sao reconferidos por outra rotina, mas um boleto muito antigo que foi pago ou excluido fora dessa janela pode demorar a refletir o status real no painel.
*Benefício:* Status dos boletos antigos fica correto mais rapido, evitando 'vencido' que ja foi pago  
*Onde:* asaasMirror.mjs (PAID_LOOKBACK_DAYS=90, processBlock) e reconcileStaleOpen — ampliar/ajustar a janela ou rodar full periodicamente

**423. Senha das RPCs do banco com valor fraco padrao**  `impacto medio · esforço baixo`
As gravacoes do espelho de boletos passam por funcoes protegidas do banco que exigem um segredo (BOT_RPC_SECRET). Em varios lugares do sistema aparece um valor padrao fraco ('cbc-bot-2026') quando a variavel nao esta setada. Se esse padrao acabar valendo, qualquer um que o conheca poderia chamar as gravacoes.
*Benefício:* Garante que as gravacoes financeiras so aconteçam com segredo forte e configurado  
*Onde:* asaas-webhook.mjs e BoletosPanel.jsx (BOT_PANEL_KEY/'cbc-bot-2026') + confirmar BOT_RPC_SECRET forte no Netlify

**424. Boleto avulso nao passa pela trava anti-duplicidade**  `impacto baixo · esforço medio`
Os contratos tem uma trava que impede lançar a cobranca duas vezes por engano. Mas a criacao de boleto avulso (create-single / create-single-payment) nao tem essa protecao — um duplo clique ou reenvio pode gerar dois boletos avulsos identicos para o mesmo cliente.
*Benefício:* Evita boleto avulso cobrado em dobro por clique repetido  
*Onde:* asaas-sync.mjs (casos create-single e create-single-payment, sem lock como o de create-payment no AsaasPanel)

**425. Chave do banco fixa no codigo do asaas-sync**  `impacto alto · esforço baixo`
No arquivo asaas-sync.mjs, a chave de acesso ao banco de dados (a chave anonima do Supabase) esta escrita por extenso dentro do codigo, como 'reserva' caso a variavel de ambiente nao exista. Como esse codigo fica num repositorio, a chave fica visivel para quem tiver acesso a ele.
*Benefício:* Reduz risco de vazamento da chave e evita que uma chave antiga (que pode ter sido trocada) continue sendo usada silenciosamente.  
*Onde:* client/netlify/functions/asaas-sync.mjs (linha 19)

**426. Boleto avulso nao aparece na hora no painel**  `impacto medio · esforço baixo`
Quando o escritorio cria uma cobranca avulsa (acoes 'create-single' e 'create-single-payment' no asaas-sync.mjs), o boleto e gerado no Asaas mas NAO e gravado no espelho local do sistema. Ele so vai aparecer na tela de Boletos na proxima sincronizacao automatica (6h ou 18h) ou quando alguem abrir o card do cliente.
*Benefício:* O boleto recem-criado aparece imediatamente na lista, evitando confusao de 'criei e nao aparece'.  
*Onde:* client/netlify/functions/asaas-sync.mjs (create-single / create-single-payment)

**427. Endpoint da linha digitavel sem nenhuma protecao**  `impacto medio · esforço baixo`
A funcao asaas-boleto-code.mjs devolve a linha digitavel e o codigo de barras de qualquer boleto so com o id do pagamento, sem exigir login nem senha. Quem descobrir o endereco dessa funcao e um id de boleto consegue puxar dados de cobranca de terceiros.
*Benefício:* Impede que pessoas de fora consultem dados de boletos de clientes.  
*Onde:* client/netlify/functions/asaas-boleto-code.mjs

**428. Cobranca pode ficar 'travada' se o navegador fechar no meio**  `impacto medio · esforço medio`
Ao lancar uma cobranca, o sistema marca o contrato como 'lancando' antes de chamar o Asaas, e so destrava se der erro NA MESMA tela. Se o operador fechar o navegador ou cair a internet no meio, o contrato fica travado em 'lancando' para sempre e ninguem consegue mais lancar a cobranca dele.
*Benefício:* Evita contratos presos sem cobranca, que hoje exigiriam correcao manual no banco.  
*Onde:* client/src/components/AsaasPanel.jsx (LaunchBtn, asaas_status launching)

**429. Abrir o card do cliente dispara sincronizacao pesada toda vez**  `impacto medio · esforço baixo`
Cada vez que alguem abre o card de um cliente na tela de Boletos, o sistema chama o Asaas e varre TODOS os boletos do cliente em 5 status, pagina por pagina, mais notas fiscais e PIX de cada um. Sem nenhum intervalo minimo: abrir/fechar/reabrir repete tudo, gastando chamadas do Asaas e podendo deixar a tela lenta.
*Benefício:* Menos chamadas ao Asaas e card abrindo mais rapido, sem risco de bater no limite da API.  
*Onde:* client/src/components/BoletosPanel.jsx (loadBoletos) + asaas-sync-customer.mjs

**430. Dados do cliente no Asaas nunca sao atualizados depois de criados**  `impacto medio · esforço medio`
Quando o sistema vai lancar uma cobranca e o cliente ja existe no Asaas, ele apenas reaproveita o cadastro antigo (funcao findCustomer) e nunca atualiza email, telefone ou endereco. Se o cliente mudou de email/telefone no contrato novo, o boleto e as notificacoes continuam indo para os dados antigos do Asaas.
*Benefício:* Boletos e avisos chegam no contato certo do cliente, reduzindo inadimplencia por 'nao recebi'.  
*Onde:* client/netlify/functions/asaas-sync.mjs (findCustomer/createCustomer)

**431. Webhook sempre responde 'ok', mesmo quando falha de verdade**  `impacto medio · esforço medio`
O recebedor de avisos do Asaas (asaas-webhook.mjs) sempre responde 'recebido com sucesso', mesmo quando a gravacao do status do boleto falha ou ocorre um erro inesperado. Isso e proposital para o Asaas nao ficar reenviando, mas significa que um pagamento que falhou ao ser registrado simplesmente se perde, sem reprocessamento.
*Benefício:* Permite reprocessar pagamentos que falharam ao gravar, em vez de perde-los silenciosamente.  
*Onde:* client/netlify/functions/asaas-webhook.mjs (catch e mirror update)

**432. Dois jeitos diferentes de agendar a nota fiscal**  `impacto medio · esforço medio`
A nota fiscal pode ser agendada por dois caminhos: no momento de lancar a cobranca (scheduleInvoice com 'ON_PAYMENT_CONFIRMATION', em asaas-sync.mjs) E quando o pagamento e confirmado (POST no webhook). Os textos de descricao e as observacoes da NF sao diferentes entre os dois, entao a mesma situacao pode gerar notas com conteudo divergente, alem do risco ja conhecido de duplicidade.
*Benefício:* Nota fiscal sempre com o mesmo texto e logica unica, mais facil de auditar na prefeitura.  
*Onde:* client/netlify/functions/asaas-sync.mjs (scheduleInvoice) vs asaas-webhook.mjs

**433. Sincronizacao de clientes e de boletos no mesmo horario**  `impacto baixo · esforço baixo`
Tanto a varredura de clientes quanto a de boletos estao agendadas para as 6h (e a de boletos tambem as 18h). Como rodam quase ao mesmo tempo e ambas batem muito na API do Asaas, podem competir pelo limite de chamadas e uma atrapalhar a outra.
*Benefício:* Sincronizacoes nao competem entre si, reduzindo erros de 'limite excedido' de madrugada.  
*Onde:* asaas-sync-customers.mjs (0 9) e asaas-sync-boletos.mjs (0 9,21)

**434. Codigo PIX guardado pode ficar desatualizado**  `impacto baixo · esforço medio`
O sistema busca o codigo PIX (copia-e-cola) de um boleto so uma vez e guarda; depois nunca mais atualiza enquanto ja tiver um valor salvo. Se o vencimento do boleto mudar ou o Asaas regenerar o PIX, o cliente pode receber um codigo PIX antigo que nao funciona mais.
*Benefício:* Evita que o cliente tente pagar com um PIX invalido e a cobranca atrase.  
*Onde:* _lib/asaasMirror.mjs (needPix) e asaas-sync-customer.mjs

**435. Taxa de inadimplencia distorcida pelo recorte de 90 dias**  `impacto medio · esforço medio`
A sincronizacao automatica so traz boletos PAGOS dos ultimos 90 dias, mas os boletos VENCIDOS antigos continuam no espelho. Como a taxa de inadimplencia e calculada como vencido dividido por (vencido + pago), faltar os pagos antigos faz o numero parecer pior do que e na visao geral do painel.
*Benefício:* Indicador de inadimplencia mais fiel, evitando decisoes baseadas em numero inflado.  
*Onde:* _lib/asaasMirror.mjs (PAID_LOOKBACK_DAYS) + BoletosPanel.jsx (calculo inadimp)

**436. Nome e CPF do cliente podem ficar congelados no espelho**  `impacto baixo · esforço medio`
Na sincronizacao em bloco de boletos, quando o cliente ja esta em cache, o sistema reaproveita o nome e CPF que ja tinha guardado e nao confere se mudaram no Asaas. Se o cadastro do cliente foi corrigido no Asaas (ex: nome digitado errado), o painel de Boletos pode continuar mostrando o dado antigo por tempo indefinido.
*Benefício:* Relatorios e descritivos saem com o nome correto do cliente.  
*Onde:* _lib/asaasMirror.mjs (knownCustomers em processBlock)

**437. Sync manual no painel nao segue para o proximo status apos travar**  `impacto baixo · esforço medio`
No botao 'Sync Asaas' do painel, o laco so avanca enquanto a resposta vier com o MESMO status atual; ao terminar um status (PENDING, OVERDUE...) ele depende da resposta 'next' apontar certo, e qualquer resposta inesperada faz parar naquele status sem aviso claro de que faltaram os demais. O usuario pode achar que sincronizou tudo quando parou no meio.
*Benefício:* Garante que a sincronizacao manual sempre cubra todos os status, sem buracos silenciosos.  
*Onde:* client/src/components/BoletosPanel.jsx (manualSync, laco de phases)


## 15. Integracao ZapSign (assinatura)  *(29)*

**438. Ativar o segredo do webhook do ZapSign (fechar a porta aberta)**  `impacto alto · esforço baixo`
Hoje o sistema aceita avisos de assinatura vindos do ZapSign sem conferir uma senha secreta no cabecalho da mensagem. O codigo ja sabe checar essa senha, mas a variavel ZAPSIGN_WEBHOOK_SECRET nao foi configurada, entao ele apenas registra um aviso e segue. Basta criar essa senha no Netlify e colar a mesma no painel do ZapSign.
*Benefício:* Impede que alguem de fora finja eventos de assinatura e mexa nos seus contratos. Defesa em camadas.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (linha 16, 46-53) + env ZAPSIGN_WEBHOOK_SECRET no Netlify e painel ZapSign

**439. Botao de reenviar lembrete de assinatura para o cliente**  `impacto alto · esforço medio`
O sistema ja tem a funcao pronta para pedir ao ZapSign que reenvie o convite de assinatura (resendSignerNotification), mas ela NAO esta ligada a nenhum botao na tela. Hoje, se o cliente nao assina, a secretaria so consegue copiar o link de novo manualmente. Faltou colocar um botao 'Reenviar' ao lado de cada contratante pendente.
*Benefício:* Acelera assinaturas paradas com um clique, sem trabalho manual nem refazer o documento.  
*Onde:* client/src/components/ContratosTab.jsx (componente SignerName) usando resendSignerNotification de utils/zapsignService.js

**440. Botao de cancelar documento no ZapSign**  `impacto medio · esforço medio`
Quando um contrato e enviado com erro (email errado, valor errado), hoje o documento continua vivo no ZapSign e o cliente pode acabar assinando a versao errada. A funcao de cancelar (cancelZapSignDoc) ja existe no codigo mas nunca foi conectada a um botao. Falta um botao 'Cancelar no ZapSign' nos contratos enviados.
*Benefício:* Evita que o cliente assine documento errado; mantem a lista do ZapSign limpa.  
*Onde:* client/src/components/ContratosTab.jsx usando cancelZapSignDoc de utils/zapsignService.js

**441. Definir prazo de validade do link de assinatura**  `impacto medio · esforço baixo`
O ZapSign permite mandar uma data limite para o cliente assinar (date_limit_to_sign), mas o sistema nunca envia esse parametro. Sem prazo, links ficam abertos para sempre e nao ha senso de urgencia. Da para configurar, por exemplo, 7 dias.
*Benefício:* Cria urgencia (cliente assina mais rapido) e fecha links velhos automaticamente, reduzindo risco.  
*Onde:* client/src/utils/zapsignService.js (objeto body do sendToZapSign, ~linha 19)

**442. Tratar evento de link expirado vindo do ZapSign**  `impacto medio · esforço baixo`
O comentario do webhook lista o evento 'doc_expired' (documento venceu), mas o codigo so trata assinatura e recusa. Se um documento vence no ZapSign, o sistema nunca fica sabendo e o contrato permanece eternamente como 'aguardando assinatura'.
*Benefício:* O contrato deixa de ficar 'preso' como pendente para sempre; a equipe ve que precisa reenviar.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (logica de newStatus, linhas 104-115)

**443. Ativar lembretes automaticos nativos do ZapSign**  `impacto medio · esforço baixo`
O ZapSign tem um recurso de mandar lembretes automaticos por conta propria (parametro de reminder/frequencia) para quem nao assinou. O sistema nao liga isso no envio. Hoje a cobranca depende de alguem lembrar manualmente.
*Benefício:* O proprio ZapSign cobra o cliente sozinho, aumentando taxa de assinatura sem esforco da equipe.  
*Onde:* client/src/utils/zapsignService.js (parametros do create no sendToZapSign)

**444. Webhook nao dispara ADVBOX/Drive/Asaas na hora — fica esperando ate 5 min**  `impacto alto · esforço medio`
Quando o webhook do ZapSign marca um contrato como 'assinado' em tempo real, ele NAO chama o cadastro no ADVBOX, o arquivamento no Drive nem a cobranca. Isso so acontece na varredura do navegador a cada 5 minutos, e SO se alguem estiver com o sistema aberto. Se ninguem estiver com a aba aberta, pode demorar muito.
*Benefício:* Cliente, processo e cobranca disparam em segundos apos assinar, 24h, sem depender de alguem com o sistema aberto.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (apos marcar 'assinado') chamando advbox-sync / save-to-drive

**445. Repassar o nome do signatario que recusou para entender o cancelamento**  `impacto baixo · esforço baixo`
Quando alguem recusa assinar, o contrato vira 'cancelado', mas nao se registra QUEM recusou nem o motivo. Depois fica dificil saber por que aquele contrato caiu. O ZapSign manda esses dados no payload e poderiam ser salvos.
*Benefício:* Da rastreabilidade: a equipe ve quem recusou e quando, ajudando a recuperar a venda.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (ramo anyRefused, linhas 110-114)

**446. O fallback do proxy Edge dobra o tempo de espera em falhas**  `impacto baixo · esforço baixo`
O sistema tenta primeiro o caminho rapido (Edge) com limite de 8 segundos; se falhar, tenta o caminho antigo SEM limite de tempo. Numa instabilidade do ZapSign, o usuario pode esperar 8s + um tempo indefinido travado, sem aviso. Vale colocar tambem um limite no segundo caminho.
*Benefício:* Evita que a tela fique 'pensando' por muito tempo quando o ZapSign esta lento.  
*Onde:* client/src/utils/apiEndpoints.js (funcao callWithFallback, fetch do fallbackPath)

**447. Mostrar 'Aberto ha X / Aguardando ha Y dias' no contrato**  `impacto medio · esforço baixo`
A tela mostra quantas vezes o cliente abriu (times_viewed) e a ultima visualizacao, mas nao diz ha quantos dias o documento esta parado aguardando. Um contrato enviado ha 10 dias sem assinar deveria saltar aos olhos com um destaque de cor.
*Benefício:* A equipe enxerga rapidamente os contratos 'esquecidos' e age antes de perder a venda.  
*Onde:* client/src/components/ContratosTab.jsx (SignerName / ContractProgressBar, usar updated_at vs hoje)

**448. Salvar o link do PDF assinado no banco apos a assinatura**  `impacto medio · esforço medio`
Quando o contrato e assinado, o sistema baixa o PDF assinado do ZapSign na hora de arquivar no Drive, mas nao guarda no banco o endereco do arquivo assinado. Se o Drive falhar, ninguem tem o link direto do documento final sem ir no painel do ZapSign.
*Benefício:* O documento assinado fica sempre a um clique, mesmo se o arquivamento no Drive der problema.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (gravar doc.signed_file no update do contrato)

**449. O split do PDF depende de uma contagem de paginas que pode quebrar silenciosamente**  `impacto medio · esforço baixo`
A separacao do PDF assinado em Contrato + Procuracao usa um numero de paginas calculado na hora do envio (pdf_page_split). Se esse calculo vier vazio ou errado, o codigo simplesmente junta tudo num arquivo so, sem avisar ninguem. Convem registrar um alerta quando isso acontece para alguem conferir.
*Benefício:* Evita arquivar contrato e procuracao grudados sem ninguem perceber; facilita corrigir.  
*Onde:* client/netlify/functions/save-to-drive.mjs (ramo else da etapa 2, linha 219-221)

**450. Confirmar visualmente que o webhook do ZapSign esta realmente configurado e ativo**  `impacto medio · esforço medio`
O sistema assume que o webhook do ZapSign esta ligado (por isso reduziu a varredura para 5 min). Mas nao ha nada na tela do Monitor mostrando 'ultimo evento recebido do ZapSign ha X'. Se alguem desligar o webhook no painel do ZapSign, o sistema fica lento e ninguem percebe.
*Benefício:* Detecta rapidamente se a integracao de tempo real caiu, antes que vire problema.  
*Onde:* client/src/components/MonitorPanel.jsx + um carimbo de data no zapsign-webhook.mjs

**451. Padronizar o limite de tempo nas chamadas ao ZapSign no servidor**  `impacto baixo · esforço baixo`
Algumas chamadas ao ZapSign tem limite de tempo (a do kommo-view-check tem 15s), mas a re-busca do webhook (fetchDocFromZapSign) NAO tem limite nenhum. Se a API do ZapSign travar, essa funcao pode ficar pendurada e estourar o tempo da execucao.
*Benefício:* Evita travamentos e custos de execucao desnecessarios quando o ZapSign esta lento.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (fetchDocFromZapSign, linha 27)

**452. Evitar gerar um novo documento ZapSign a cada clique de reenvio**  `impacto medio · esforço medio`
O envio usa um codigo estavel por contrato (external_id) para o ZapSign reconhecer reenvio, MAS isso so funciona se o contrato ja tiver sido salvo (tiver data.id). Se a secretaria clicar em enviar antes de salvar, cada clique cria um documento NOVO no ZapSign, gerando duplicatas e confundindo qual link mandar.
*Benefício:* Acaba com documentos duplicados no ZapSign e a duvida de 'qual link e o certo'.  
*Onde:* client/src/components/ZapSignModal.jsx (contratoId: data.id, linha 144) — garantir salvar antes de enviar

**453. Recuperar contratos que assinaram enquanto o sistema estava sem service role key**  `impacto alto · esforço baixo`
O webhook usa a chave de servico do Supabase (SUPABASE_SERVICE_ROLE_KEY) que, segundo a documentacao, ainda nao esta configurada. Se ela faltar, o webhook responde erro 500 e o ZapSign pode parar de reenviar aquele evento, deixando contratos assinados sem virar 'assinado' no sistema.
*Benefício:* Garante que nenhuma assinatura real seja perdida por falta de configuracao no servidor.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (linha 14, 55-57) + configurar SUPABASE_SERVICE_ROLE_KEY

**454. Mensagem de erro mais especifica quando o email do signatario e rejeitado**  `impacto baixo · esforço baixo`
O tradutor de erros do ZapSign agrupa varios casos de '422/400' numa unica frase generica sobre email/CPF. Mas o ZapSign costuma dizer exatamente qual campo falhou (ex.: email invalido, telefone faltando). Da para mostrar o detalhe util em vez de pedir para 'conferir tudo'.
*Benefício:* A secretaria corrige o campo certo na hora, sem ficar procurando o que esta errado.  
*Onde:* client/src/components/ZapSignModal.jsx (funcao traduzErroZapSign, linhas 23-25)

**455. Registrar no Monitor as assinaturas que chegam pelo webhook**  `impacto medio · esforço baixo`
Quando a assinatura entra pelo webhook (em tempo real), o sistema atualiza o contrato mas NAO escreve nada no log de automacoes — so um aviso no console do servidor, que ninguem ve. Ja a via lenta (varredura de 5 min) registra tudo. Resultado: na aba Monitor parece que nada aconteceu, mesmo o contrato tendo virado assinado.
*Benefício:* Rastreabilidade: o Monitor passa a mostrar TODA assinatura, nao so as que chegam pela varredura lenta.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (inserir em automation_log apos o update, igual ao App.jsx faz)

**456. Guardar o link do contrato assinado no momento exato da assinatura**  `impacto medio · esforço baixo`
O webhook ja busca o documento completo no ZapSign (que inclui o endereco do PDF final assinado), mas joga essa informacao fora. Hoje, para pegar o PDF assinado, o sistema precisa consultar o ZapSign de novo mais tarde. Bastava salvar o endereco que ja veio em maos.
*Benefício:* Menos consultas ao ZapSign e acesso instantaneo ao PDF assinado (Drive, conferencia, reenvio ao cliente).  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (campo doc.signed_file -> coluna nova em contratos)

**457. Unificar a 'traducao' dos signatarios que existe copiada em 3 lugares**  `impacto medio · esforço medio`
A logica que transforma a resposta do ZapSign nos campos do contrato (quem assinou, quando, quantas vezes abriu) esta escrita identica em tres arquivos: webhook, varredura do App e o servico do frontend. Quando alguem corrige um e esquece os outros, o sistema passa a se comportar diferente dependendo do caminho — foi exatamente esse tipo de divergencia que causou um bug serio no passado (caso Edmar).
*Benefício:* Uma fonte unica evita que correcoes futuras se apliquem so a metade dos casos.  
*Onde:* zapsign-webhook.mjs + App.jsx (bloco PART 1) + utils/zapsignService.js -> extrair para um _lib compartilhado

**458. Tratar de fato os eventos de documento apagado e link expirado**  `impacto medio · esforço medio`
O webhook diz, nos comentarios, que recebe eventos de 'documento apagado' e 'link expirado', mas no codigo ele so olha se cada signatario assinou ou recusou — ignora completamente o tipo do evento. Entao se voce apagar um documento no painel do ZapSign, o contrato continua eternamente como 'enviado, aguardando' aqui dentro.
*Benefício:* Contratos parados deixam de ficar 'fantasmas' no aguardando para sempre.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (ler body.event_type para doc_deleted/doc_expired)

**459. Limpar contratos 'aguardando assinatura' que ja morreram**  `impacto medio · esforço medio`
Todo contrato em 'enviado, aguardando' e consultado no ZapSign a cada 5 minutos, para sempre — mesmo os de meses atras que o cliente nunca vai assinar. Isso vai acumulando consultas inuteis e polui as listas. Falta um corte: depois de X dias sem assinar, marcar como 'expirado/desistiu' e parar de consultar.
*Benefício:* Menos consultas desperdicadas ao ZapSign e listas de pendencia que refletem a realidade.  
*Onde:* App.jsx (PART 1 do polling, filtro por idade) + status novo tipo 'expirado'

**460. Avisar quando UM de dois signatarios ja assinou (assinatura parcial)**  `impacto medio · esforço medio`
Em contratos com dois contratantes, hoje so existe o estado 'todos assinaram' ou 'aguardando'. Se o marido assinou e a esposa nao, ninguem e avisado dessa assinatura parcial — o operador nao sabe que falta so uma pessoa para cobrar especificamente.
*Benefício:* Permite cobrar exatamente quem falta, acelerando o fechamento de contratos com 2+ pessoas.  
*Onde:* zapsign-webhook.mjs / App.jsx (detectar 'algum assinou mas nem todos') + notificacao

**461. Permitir corrigir o e-mail do signatario sem refazer o documento**  `impacto medio · esforço medio`
Ao enviar, o sistema trava nome e e-mail do signatario ('lock_email'). Se a secretaria digitou o e-mail errado, nao da para so corrigir o destinatario: precisa apagar e gerar um documento novo do zero. Um campo para reenviar com e-mail corrigido (recriando so quando necessario) economizaria esse retrabalho.
*Benefício:* Erro de digitacao no e-mail vira um ajuste rapido, nao um documento refeito inteiro.  
*Onde:* utils/zapsignService.js (lock_email) + ZapSignModal.jsx + proxy (fluxo de correcao)

**462. Oferecer autenticacao mais forte (SMS/selfie) para contratos de alto valor**  `impacto medio · esforço medio`
Hoje todo contrato e assinado apenas 'desenhando na tela' (assinaturaTela), sem comprovar a identidade de quem assinou. Para contratos de valor alto ou clientes de risco, o ZapSign permite exigir um codigo por SMS ou uma selfie. Isso aumenta a forca probatoria da assinatura se o contrato for questionado na Justica.
*Benefício:* Mais seguranca juridica em assinaturas que podem ser contestadas, sem mudar o fluxo padrao.  
*Onde:* utils/zapsignService.js (auth_mode fixo 'assinaturaTela') + opcao no ZapSignModal.jsx

**463. Evitar que o ZapSign e a secretaria mandem o link em dose dupla**  `impacto baixo · esforço baixo`
O sistema manda o ZapSign disparar e-mail ao cliente ('disable_signer_emails: false'), mas a regra interna do escritorio e que a secretaria envia o link manualmente pelo WhatsApp/Kommo. Resultado: o cliente pode receber a cobranca duas vezes (e-mail automatico + WhatsApp), o que confunde. Vale decidir um canal so e desligar o outro.
*Benefício:* Comunicacao com o cliente mais limpa, sem mensagem duplicada gerando confusao.  
*Onde:* utils/zapsignService.js (flag disable_signer_emails)

**464. Travar o tipo do documento (download) no proxy para nao baixar lixo**  `impacto baixo · esforço baixo`
O proxy do ZapSign aceita varias acoes (criar, status, cancelar, baixar, reenviar) sem conferir se os dados necessarios vieram. Por exemplo, uma chamada de 'baixar' sem o codigo do documento monta uma URL quebrada e bate no ZapSign do mesmo jeito. Validar os campos minimos de cada acao antes de chamar a API evita chamadas invalidas e erros confusos.
*Benefício:* Menos chamadas invalidas ao ZapSign e mensagens de erro mais claras.  
*Onde:* client/netlify/edge-functions/zapsign-proxy.ts (validar payload por acao antes do fetch)

**465. Confirmar a divisao do PDF assinado pelo conteudo, nao so pela contagem de paginas**  `impacto medio · esforço alto`
Quando o contrato assinado e arquivado, o sistema separa 'contrato' e 'procuracao' confiando que o contrato tem exatamente N paginas (numero calculado no envio). Se o PDF final vier com uma pagina a mais ou a menos (rodape do ZapSign, quebra diferente), a separacao corta no lugar errado e a procuracao pode ficar incompleta no Drive — sem ninguem perceber.
*Benefício:* Arquivos no Drive sempre completos e cortados no ponto certo, mesmo se o PDF mudar de tamanho.  
*Onde:* client/netlify/functions/save-to-drive.mjs (splitPdfWithReport — validar marcador no texto, nao so contractPages)

**466. Mostrar no modal de envio quando o cliente recusou e por que**  `impacto medio · esforço medio`
Se o cliente clica em 'recusar assinar' no ZapSign, o contrato vira 'cancelado' silenciosamente — a equipe so descobre olhando a lista e estranhando. O ZapSign costuma trazer um motivo da recusa. Exibir 'Fulano recusou: <motivo>' transforma uma recusa silenciosa em algo acionavel (ligar para o cliente, refazer).
*Benefício:* A equipe reage a recusas em vez de so ver o contrato sumir das estatisticas.  
*Onde:* zapsign-webhook.mjs (capturar motivo da recusa) + exibir em ContratosTab/ZapSignModal


## 16. Automacoes & Resiliencia  *(30)*

**467. Impedir que a varredura de automacoes se sobreponha a si mesma**  `impacto medio · esforço baixo`
A cada 5 minutos o sistema varre os contratos para sincronizar ZapSign, ADVBOX e Drive. Se uma varredura demorar mais de 5 minutos (banco lento, muitos contratos), a proxima comeca antes da anterior terminar, e as duas mexem nos mesmos contratos ao mesmo tempo. Falta uma 'trava' simples (uma marca de 'ja estou rodando') que faca a nova varredura esperar a anterior acabar.
*Benefício:* Evita trabalho duplicado e disputas entre duas varreguras simultaneas no mesmo navegador, deixando os logs mais limpos.  
*Onde:* client/src/App.jsx (funcao runAutomations, ~linha 604 — falta um useRef de 'em execucao')

**468. Coordenar varredura entre abas/navegadores abertos**  `impacto alto · esforço medio`
A varredura roda dentro do navegador de quem esta com o sistema aberto. Se cinco pessoas (ou cinco abas) estao com o app aberto, as cinco varrem os mesmos contratos a cada 5 minutos, multiplicando chamadas ao ADVBOX, ao Drive e ao banco. Embora as travas no banco evitem duplicar o resultado final, sobra muita chamada desperdicada. Daria para eleger so uma aba como 'a que varre' (via uma marca compartilhada entre abas) ou mover essa varredura inteira para o servidor.
*Benefício:* Corta chamadas repetidas, reduz custo de banda/invocacoes e tira carga do ADVBOX/Drive.  
*Onde:* client/src/App.jsx (runAutomations + setInterval ~linha 885)

**469. Mover a sincronizacao ADVBOX/Drive de vez para o servidor**  `impacto alto · esforço medio`
Hoje, se ninguem estiver com o sistema aberto, os contratos assinados nao entram no ADVBOX nem sobem ao Drive ate alguem abrir o app — porque essa logica vive no navegador (App.jsx). A nota '#18 abriu e nao assinou' ja foi movida para o servidor por causa disso; o mesmo deveria valer para ADVBOX e Drive. Uma funcao agendada (igual a kommo-view-check) faria essa varredura 24h, sem depender de ninguem estar logado.
*Benefício:* Garante que assinaturas viram processo no ADVBOX e arquivo no Drive mesmo de madrugada/fim de semana, sem app aberto.  
*Onde:* client/src/App.jsx (PART 2 da runAutomations) -> nova function agendada em client/netlify/functions/

**470. Colocar limite de tempo na chamada do navegador ao advbox-sync**  `impacto medio · esforço baixo`
Quando o navegador dispara a sincronizacao com o ADVBOX (fetch para advbox-sync), nao ha um tempo-limite. Se o ADVBOX travar e nao responder, essa chamada pode ficar pendurada e segurar a varredura inteira. As funcoes do servidor ja usam limite de 15s nas chamadas externas; o disparo a partir do navegador deveria ter o mesmo cuidado (AbortSignal com timeout).
*Benefício:* Evita que um contrato 'travado' congele toda a fila de automacoes do navegador.  
*Onde:* client/src/App.jsx (fetch('/.netlify/functions/advbox-sync'), ~linha 689)

**471. Separar a 'trava' do ADVBOX da data real de assinatura**  `impacto medio · esforço medio`
Ao iniciar o sync do ADVBOX, o sistema grava o horario atual em 'advbox_date' so para servir de relogio da trava (saber se o processo 'travou' ha mais de 5min). Mas 'advbox_date' tambem e usado como dado de negocio (data do sync). Misturar 'relogio da trava' com 'data oficial' e fragil: um retry mexe na data, e a recuperacao de trava depende de um campo que tem outro significado. O ideal e ter um campo so para o horario da trava (ex.: advbox_lock_at), separado da data exibida.
*Benefício:* Recuperacao de processos travados fica mais confiavel e a data mostrada para o usuario para de oscilar a cada tentativa.  
*Onde:* client/src/App.jsx (claim do ADVBOX ~linhas 671-710) + coluna nova em contratos

**472. Registrar 'batida de ponto' nas automacoes principais que hoje nao tem**  `impacto alto · esforço medio`
O Monitor sabe se um robo parou de rodar porque cada robo 'bate o ponto' (heartbeat) ao terminar. Mas varias automacoes criticas NAO batem ponto: advbox-sync, save-to-drive, zapsign-webhook, asaas-webhook, kommo-view-check, commission-calculator e advbox-vendas-sync. Se uma delas parar ou comecar a falhar em silencio, o Monitor nao acusa. Adicionar a batida de ponto (heartbeat) nessas funcoes fecha esse ponto cego.
*Benefício:* O Monitor passa a avisar quando uma automacao importante para de funcionar, em vez de descobrir tarde pelo cliente reclamando.  
*Onde:* client/netlify/functions/{advbox-sync,save-to-drive,zapsign-webhook,asaas-webhook,kommo-view-check,commission-calculator,advbox-vendas-sync}.mjs

**473. Vigiar no watchdog todos os crons, nao so cinco**  `impacto medio · esforço baixo`
O vigia (monitor-watchdog) so cobra horario de 5 robos: datajud, reminder, asaas-boletos, asaas-customers e advbox-monitor. Crons importantes como commission-calculator (comissao do mes, roda dia 20), advbox-vendas-sync, kommo-view-check e datajud nao tem prazo definido na lista de vigilancia. Se um deles silenciar, ninguem e avisado. Basta acrescenta-los ao mapa de prazos (CRON_SLA) do watchdog.
*Benefício:* Cobertura completa de vigilancia: qualquer robo que parar de rodar gera alerta no Monitor.  
*Onde:* client/netlify/functions/monitor-watchdog.mjs (mapa CRON_SLA, ~linha 13)

**474. Guardar o motivo de cada erro da rotina DataJud, nao so a contagem**  `impacto medio · esforço baixo`
A rotina que descobre quando o processo foi distribuido (datajud-refresh) processa ate 500 contratos por vez. Quando um contrato da erro, o sistema apenas soma +1 num contador ('erros') e segue. Se 30 contratos falharem, voce sabe que foram 30, mas nao QUAIS nem POR QUE. Guardar o id e a mensagem de cada falha (no log de automacao) permite investigar casos reais.
*Benefício:* Facilita achar e corrigir processos que nunca atualizam a data de distribuicao, em vez de so ver um numero.  
*Onde:* client/netlify/functions/datajud-refresh.mjs (catch dentro do for, ~linha 246)

**475. Colocar tempo-limite no download do PDF assinado no Drive**  `impacto medio · esforço baixo`
Ao arquivar o contrato assinado, o servidor baixa o PDF do ZapSign com um fetch sem tempo-limite. Se o ZapSign ficar lento, esse download pode segurar a funcao ate o limite da Netlify estourar, gastando o tempo todo e podendo deixar a trava 'uploading' presa. As chamadas ADVBOX ja usam 15s; o download do PDF deveria ter o mesmo (AbortSignal.timeout).
*Benefício:* Evita que um ZapSign lento prenda o arquivamento e deixe o contrato 'enroscado' em uploading.  
*Onde:* client/netlify/functions/save-to-drive.mjs (fetch(signedFileUrl), ~linha 199)

**476. Configurar a chave de servico (service role) para as funcoes gravarem direito**  `impacto alto · esforço baixo`
Varias funcoes do servidor (datajud-refresh, por exemplo) gravam no banco usando a chave publica 'anon', porque a chave de servico (SUPABASE_SERVICE_ROLE_KEY) nunca foi configurada. Isso ja causou contornos como o do Asaas. Algumas funcoes (reminder-cron, zapsign-webhook) ate exigem essa chave e simplesmente 'desistem com erro 500' se ela faltar. Configurar a chave deixa as gravacoes server-side confiaveis e tira a dependencia de remendos.
*Benefício:* Automacoes gravam de forma confiavel e param de depender de contornos frageis; reduz falhas silenciosas por permissao.  
*Onde:* Configuracao no Netlify (env SUPABASE_SERVICE_ROLE_KEY) — afeta reminder-cron.mjs, zapsign-webhook.mjs, datajud-refresh.mjs e outras

**477. Tornar fail-closed o webhook do ZapSign (configurar o segredo)**  `impacto medio · esforço baixo`
O webhook que recebe avisos de assinatura do ZapSign hoje funciona sem senha (o segredo ZAPSIGN_WEBHOOK_SECRET nao esta configurado) — ele apenas avisa no log. Esta mitigado porque o codigo re-consulta o ZapSign antes de agir, mas o certo e configurar o segredo no Netlify e no painel ZapSign para so aceitar chamadas legitimas. E uma trava de seguranca de baixa complexidade que ja esta meio pronta no codigo.
*Benefício:* Fecha a porta para chamadas forjadas no webhook de assinatura, com defesa em profundidade.  
*Onde:* client/netlify/functions/zapsign-webhook.mjs (~linha 46) + env ZAPSIGN_WEBHOOK_SECRET no Netlify

**478. Numerar as tentativas do ADVBOX como ja se faz no Drive**  `impacto medio · esforço medio`
O arquivamento no Drive tem um sistema maduro: conta tentativas, para depois de 3, distingue erro 'transitorio' (rede/deploy) de erro 'definitivo', e se auto-cura depois de 6h. O ADVBOX nao tem isso: quando falha, vira 'error' e fica sendo retentado a cada varredura para sempre, sem contar tentativas nem distinguir tipo de erro. Se um contrato tem um problema definitivo (ex.: CPF invalido no ADVBOX), ele vai bater na API repetidamente sem nunca 'desistir' nem sinalizar 'precisa de gente'.
*Benefício:* Para de martelar o ADVBOX com casos sem solucao automatica e deixa claro quais contratos precisam de intervencao manual.  
*Onde:* client/src/App.jsx (bloco ADVBOX da runAutomations, ~linhas 671-724)

**479. Evitar dois robos ADVBOX rodando ao mesmo tempo (monitor + snapshot)**  `impacto medio · esforço medio`
O ADVBOX tem limite de chamadas por minuto. O sistema ja teve o cuidado de rodar o monitor e o snapshot 'em sequencia, nunca em paralelo'. Mas o disparo do monitor (advbox-monitor) chama o worker em background sem esperar resposta e sem nenhuma trava de 'so um por vez'. Se o cron e um disparo manual pelo painel acontecerem juntos, podem rodar dois ao mesmo tempo e estourar o limite do ADVBOX. Uma trava simples de instancia unica (igual a do backfill) evitaria isso.
*Benefício:* Reduz risco de bater no limite do ADVBOX e ter chamadas recusadas (429) quando ha disparo manual + cron juntos.  
*Onde:* client/netlify/functions/advbox-monitor.mjs + advbox-monitor-worker-background.mjs

**480. Marcar contrato 'enroscado em uploading' como precisa-de-atencao quando esgotar tentativas**  `impacto medio · esforço baixo`
Quando a trava do Drive fica orfã (presa em 'uploading' por mais de 5min) e ja gastou as 3 tentativas, o codigo marca como 'failed' e segue. Isso esta correto, mas esse contrato so reaparece na auto-cura de 6h. Nao ha um sinal claro e imediato no Monitor de 'este contrato assinado nunca subiu ao Drive e desistiu'. Um indicador visivel (badge/contador no Monitor) faria esses casos nao passarem despercebidos por horas.
*Benefício:* Contratos assinados que falharam em arquivar no Drive ficam visiveis na hora, em vez de so depois de 6h.  
*Onde:* client/src/App.jsx (caminho 'failed' do Drive ~linhas 749-765) + MonitorPanel

**481. Reduzir o pula-pula de chamadas internas entre funcoes (kommo-note)**  `impacto baixo · esforço medio`
Funcoes do servidor como datajud-refresh e kommo-view-check chamam a propria kommo-note fazendo um fetch para o proprio site (uma funcao chamando outra pela internet). Isso adiciona uma 'ida e volta' de rede e um ponto extra de falha (cold-start, timeout) a cada nota. Como ambas vivem no mesmo projeto, poderiam compartilhar uma biblioteca em _lib/ (como ja fazem advbox.mjs e kommo.mjs) e chamar a logica direto, sem passar pela rede.
*Benefício:* Menos latencia, menos invocacoes e menos chances de uma nota falhar por timeout de rede interna.  
*Onde:* client/netlify/functions/datajud-refresh.mjs (~linha 170) e kommo-view-check.mjs (~linha 60) -> _lib/kommo.mjs

**482. Padronizar tempo-limite e numero de tentativas das chamadas externas**  `impacto medio · esforço medio`
Cada funcao trata limite de tempo e re-tentativa do seu jeito: advbox-sync usa 15s; save-to-drive tem retry proprio (2s, 5s) para o Apps Script mas sem timeout no download; o navegador nao usa timeout nenhum; datajud nao retenta. Sem um padrao, uns servicos sao resilientes e outros nao. Criar um pequeno utilitario compartilhado de 'fetch com timeout + N tentativas com espera crescente' e usa-lo em todas as integracoes deixaria o comportamento uniforme e previsivel.
*Benefício:* Comportamento de rede consistente em todas as automacoes; menos falhas por timeout e menos codigo repetido.  
*Onde:* Novo helper em client/netlify/functions/_lib/ usado por advbox-sync, save-to-drive, datajud-refresh, kommo-view-check

**483. Avisar quando a fila do Kommo nao consegue esvaziar a tempo**  `impacto baixo · esforço baixo`
A fila do Kommo e drenada por um robo que roda a cada minuto, mas com uma janela curta de 8 segundos por execucao. Se entrarem muitos jobs de uma vez (ou o Kommo ficar lento), pode ser que a fila cresca mais rapido do que esvazia. Hoje so ha aviso quando ha falha individual; falta um alerta de 'a fila esta acumulando' (ex.: mais de X jobs parados ha mais de Y minutos), para perceber represamento antes que notas/links demorem demais.
*Benefício:* Detecta cedo quando a integracao com o Kommo esta represando, antes do cliente sentir atraso nas notas.  
*Onde:* client/netlify/functions/kommo-queue-worker.mjs + monitor-watchdog.mjs

**484. Robo de servidor que destrava contratos 'presos' sozinho**  `impacto alto · esforço medio`
Hoje, quando um arquivamento no Drive ou o lancamento no ADVBOX trava no meio (fica marcado como 'uploading' ou 'processing'), so o navegador conserta isso — e so se alguem estiver com o sistema aberto. Se ninguem abrir o app no fim de semana, o contrato fica preso. A sugestao e criar uma rotina no servidor (cron) que faca essa limpeza de travas orfas 24h por dia, independente de ter gente olhando.
*Benefício:* Contrato nunca fica esquecido travado por falta de alguem com o app aberto  
*Onde:* Nova Netlify Function agendada espelhando a logica de auto-cura de App.jsx (linhas ~727-808: 'uploading'/'processing')

**485. Lembrete pode disparar duas vezes; tornar a notificacao a prova de repeticao**  `impacto medio · esforço baixo`
A rotina de lembretes insere a notificacao e depois marca o lembrete como concluido em dois passos separados. Se a rotina rodar duas vezes ao mesmo tempo, ou se falhar entre um passo e outro, o mesmo lembrete pode gerar duas notificacoes. Basta inserir a notificacao usando uma 'chave unica' (ex.: id do lembrete + horario) para o banco recusar duplicatas automaticamente.
*Benefício:* O usuario nao recebe o mesmo lembrete repetido  
*Onde:* reminder-cron.mjs linhas 65-83 (insert em notifications sem chave de deduplicacao)

**486. Padronizar a chave de acesso ao banco na rotina DataJud**  `impacto medio · esforço baixo`
A rotina que acompanha a distribuicao dos processos (DataJud) usa uma chave 'comum' do banco escrita direto no codigo, enquanto as outras rotinas do servidor usam a chave de servico (mais forte e estavel). Isso faz a DataJud gravar de um jeito diferente das demais, sujeito as travas de seguranca do banco que ja sao um problema conhecido. Alinhar com as outras rotinas deixa o comportamento previsivel e remove uma chave fixa do codigo.
*Benefício:* Gravacoes da DataJud ficam confiaveis e iguais as demais rotinas  
*Onde:* datajud-refresh.mjs linhas 32-34 (anon key fixa no codigo em vez de SUPABASE_SERVICE_ROLE_KEY)

**487. Limitar quantos contratos a varredura do navegador processa por rodada**  `impacto medio · esforço baixo`
A varredura de automacoes do navegador busca TODOS os contratos pendentes de uma vez e tenta processar cada um na hora, dentro da pagina aberta. Se acumular um lote grande (ex.: depois de uma queda), isso pode travar a tela e estourar o tempo da rodada. Colocar um teto (ex.: 10 por vez) faz o trabalho ser feito em partes, sem engasgar o navegador da secretaria.
*Benefício:* App nao trava ao processar uma fila grande de pendencias  
*Onde:* App.jsx linha 656-665 (consulta de 'needsProcessing' sem .limit)

**488. Colocar tempo-limite no download do PDF dentro da funcao do Drive**  `impacto medio · esforço baixo`
Quando o servidor arquiva o contrato no Drive, ele primeiro baixa o PDF assinado do ZapSign e depois envia ao Google. Nenhuma dessas duas chamadas tem tempo-limite no servidor — se o ZapSign ou o Google ficarem lentos, a funcao fica pendurada ate o limite do Netlify e morre sem explicacao clara. Colocar um tempo-limite explicito em cada chamada faz o erro ser rapido e identificavel.
*Benefício:* Arquivamento falha rapido e com motivo claro em vez de pendurar  
*Onde:* save-to-drive.mjs linha 199 (fetch do PDF) e 112/124 (callAppsScriptOnce) sem AbortController

**489. Dar a mesma protecao de retentativa ao arquivamento manual de contratos**  `impacto baixo · esforço baixo`
Quando voce importa um contrato assinado por fora e o sistema arquiva no Drive, ele usa uma funcao 'irma' que NAO tem a logica de tentar de novo em caso de falha temporaria do Google — diferente do fluxo automatico, que ja ganhou isso. Resultado: uma instabilidade passageira do Google faz a importacao manual falhar a toa. Basta reaproveitar a mesma logica de retentativa que ja existe no fluxo principal.
*Benefício:* Importacao manual deixa de falhar por soluco passageiro do Google  
*Onde:* save-to-drive-direct.mjs callAppsScript (linhas 28-57) sem o wrapper de retry que existe em save-to-drive.mjs

**490. Avisar quando a rotina DataJud nao termina de checar todos os processos**  `impacto medio · esforço baixo`
A rotina diaria do DataJud percorre ate 500 processos, um por um, fazendo varias consultas externas por processo. Se o conjunto crescer ou as consultas ficarem lentas, a rotina pode ser cortada pelo tempo-limite antes de terminar — e o relatorio dela ainda mostra 'sucesso', porque so conta o que deu tempo. Vale registrar se ela chegou ao fim ou foi cortada, para nao dar falsa sensacao de que esta tudo em dia.
*Benefício:* Voce sabe se a checagem de distribuicao ficou pela metade  
*Onde:* datajud-refresh.mjs run() linhas 126-252 (laco sequencial ate 500 sem marcar conclusao parcial)

**491. Repetir no DataJud o tratamento de 'muitas requisicoes' que o robo do bot ja tem**  `impacto medio · esforço medio`
O ADVBOX as vezes responde 'calma, requisicoes demais' (erro 429). A rotina do bot ja sabe esperar e tentar de novo nesse caso, mas a rotina do DataJud nao — ela simplesmente desiste daquele processo e segue. Em dia de pico, isso faz varias distribuicoes deixarem de ser registradas silenciosamente. Aplicar a mesma espera-e-retenta resolve.
*Benefício:* Menos distribuicoes perdidas em dias de pico do ADVBOX  
*Onde:* datajud-refresh.mjs advboxLawsuit/advboxDistributionFromTasks (90-118) sem retry de 429 (existe em advGet do bot)

**492. Garantir um unico DataJud rodando por vez**  `impacto baixo · esforço baixo`
A rotina do DataJud pode ser disparada pelo horario agendado E manualmente por um botao ao mesmo tempo. Como ela faz muitas chamadas ao ADVBOX, duas execucoes simultaneas dobram o consumo e podem brigar entre si gravando os mesmos contratos. Uma trava simples ('ja estou rodando, espere') evita o atropelo, como ja existe no backfill do bot.
*Benefício:* Evita duas rodadas do DataJud se atropelando e gastando dobrado  
*Onde:* datajud-refresh.mjs export default (254-271) sem lock de instancia unica (padrao ja usado no backfill via bot_config)

**493. Conferir signatarios pendentes com menos frequencia que o resto**  `impacto baixo · esforço baixo`
A cada 5 minutos o navegador consulta o ZapSign de TODOS os contratos ainda nao assinados. Como o ZapSign ja avisa em tempo real por webhook quando alguem assina, essa varredura repetida e quase sempre redundante e gasta chamadas a toa quando ha muitos contratos abertos. Da pra espacar essa parte (ex.: a cada 30 min) sem perder nada, ja que o webhook cobre o caso real.
*Benefício:* Menos chamadas externas e menor custo, sem atraso real  
*Onde:* App.jsx PART 1 (linhas 610-653), hoje no mesmo intervalo de 5min do resto

**494. Separar o 'tudo certo' de cada automacao em vez de um sucesso unico**  `impacto medio · esforço medio`
Quando um contrato assina, o sistema dispara varias coisas em sequencia: cria cliente e processo no ADVBOX, move o lead no Kommo, posta notas. Hoje, se o cliente foi criado mas a nota do Kommo falhou, isso vira so um 'aviso' que pode passar batido. Marcar cada etapa com seu proprio estado (feita / pendente / falhou) deixa visivel exatamente o que ficou para tras em cada contrato, sem caçar no log.
*Benefício:* Voce ve por contrato exatamente qual etapa ficou pendente  
*Onde:* App.jsx PART 2 ADVBOX (685-723): hoje so um campo advbox_status 'ok'/'error' agrega tudo

**495. Reagendar lembrete recorrente e marcar disparo de forma atomica**  `impacto medio · esforço medio`
Para lembretes que repetem (diario/semanal), a rotina insere a notificacao e depois muda a data do proximo disparo em passos separados. Se falhar no meio, o lembrete pode notificar mas nao reagendar (some) — ou reagendar sem notificar. Fazer os dois numa unica operacao garante que ou tudo acontece, ou nada, sem lembrete perdido nem pulado.
*Benefício:* Lembrete recorrente nunca some nem pula um ciclo  
*Onde:* reminder-cron.mjs linhas 76-83 (insert + update em passos separados, sem transacao)

**496. Registrar 'batida de ponto' nas automacoes que rodam so no navegador**  `impacto medio · esforço baixo`
As rotinas do servidor ja deixam um registro de 'rodei e estou viva' (heartbeat). Mas o trabalho pesado de ADVBOX e Drive depois da assinatura roda dentro do navegador de quem esta com o app aberto — e isso nao deixa nenhuma 'batida de ponto'. Se ninguem abrir o app por horas, nada avisa que as automacoes pararam. Um registro simples de ultima varredura bem-sucedida tornaria essa lacuna visivel no Monitor.
*Benefício:* Fica visivel quando as automacoes pararam por falta de app aberto  
*Onde:* App.jsx runAutomations (602-887) nao grava heartbeat; comparar com botDb heartbeat usado pelos crons


## 17. Observabilidade & Monitoramento  *(36)*

**497. SLOs de ADVBOX/Drive/ZapSign estao quase sempre vazios (medem a tabela errada)**  `impacto alto · esforço medio`
O painel de 'Objetivos de Nivel de Servico' calcula o sucesso de ADVBOX, Drive e ZapSign lendo a tabela automation_log. Mas as automacoes que realmente fazem esse trabalho (advbox-sync, save-to-drive, zapsign-webhook) NAO gravam nada nessa tabela — so duas funcoes secundarias gravam. Resultado: esses indicadores aparecem 'Sem dados' ou com numeros enganosos, dando uma falsa sensacao de que nao ha o que medir.
*Benefício:* Os indicadores de sucesso das automacoes passam a refletir a realidade, permitindo ver de fato quanto cada integracao esta falhando.  
*Onde:* netlify/functions/advbox-sync.mjs, save-to-drive.mjs, zapsign-webhook.mjs (passar a gravar em automation_log) + client/src/components/HealthSlos.jsx

**498. Ninguem e avisado quando uma integracao cai — so quem abre a aba Monitor ve**  `impacto alto · esforço medio`
Hoje, quando o Kommo, ADVBOX ou Asaas saem do ar, o sistema apenas registra o problema num log dentro da aba Monitor. Se ninguem abrir essa aba, o erro pode passar dias despercebido (foi o que aconteceu com o token do Kommo, que ficou 3 dias quebrado). O robo que vigia (monitor-watchdog) ja detecta a queda, mas so escreve no log, sem mandar aviso para fora.
*Benefício:* Voce e avisado no celular/email no momento da falha, em vez de descobrir dias depois com cliente reclamando.  
*Onde:* netlify/functions/monitor-watchdog.mjs (adicionar disparo de push/email no bloco 'caiu' e 'crons_parados')

**499. Aviso de queda so dispara na transicao, entao se nasce quebrado nunca alerta**  `impacto alto · esforço baixo`
O robo de vigilancia so manda alerta quando um servico passa de 'funcionando' para 'caiu'. Se o servico ja estava caido desde a primeira checagem (por exemplo, token vencido apos um deploy), nunca houve transicao e o alerta nunca acontece — fica quebrado em silencio. Falta um lembrete periodico (ex: a cada algumas horas) enquanto continuar caido.
*Benefício:* Falhas que comecam quebradas ou que persistem nao escapam mais do radar.  
*Onde:* netlify/functions/monitor-watchdog.mjs (logica de alerta na linha 'if (!r2.ok && prev[r2.service] !== false)')

**500. Chave do Supabase exposta em texto no codigo do health check**  `impacto baixo · esforço baixo`
No arquivo do health check, a chave publica do banco esta escrita diretamente no codigo em vez de vir de uma variavel de ambiente como nas outras funcoes. Mesmo sendo a chave 'publica', misturar credencial no codigo dificulta troca-la e foge do padrao do resto do sistema. Deveria ler de process.env como o ADVBOX_TOKEN e os demais.
*Benefício:* Padroniza a forma de guardar credenciais e facilita rotacionar a chave sem mexer no codigo.  
*Onde:* netlify/functions/health.mjs (constantes SUPABASE_URL e SUPABASE_KEY no topo)

**501. Health check fica 'meio cego' quando um token esta ausente (responde 401 e marca OK)**  `impacto medio · esforço medio`
O health check considera saudavel qualquer resposta HTTP de sucesso. Mas se um token (Kommo, ADVBOX, ZapSign) estiver vazio ou errado, alguns servicos podem responder de formas que nem sempre sao tratadas como erro, e o painel pode pintar verde mesmo com a integracao quebrada. Vale checar tambem o corpo da resposta (ex: conta valida, lista retornada) e nao so o codigo HTTP.
*Benefício:* Reduz 'falso verde' — o painel passa a confiar mais no que mostra como saudavel.  
*Onde:* netlify/functions/health.mjs (funcoes checkService de cada integracao)

**502. Detector de 'travado/loop' nao mostra ha quanto tempo nem age sozinho**  `impacto medio · esforço medio`
A aba Monitor avisa quando um contrato fica preso em 'processando' ha mais de 5 minutos, mas e so um aviso visual: nao mostra exatamente ha quantos minutos esta preso nem oferece um botao para forcar a liberacao da trava. Quem ve precisa ir no banco resolver na mao. Um botao 'destravar e tentar de novo' (como ja existe no 'Drive falhou') resolveria na propria tela.
*Benefício:* Resolve travamentos em um clique, sem precisar de suporte tecnico.  
*Onde:* client/src/components/MonitorPanel.jsx (componente LoopDetector)

**503. Console de logs do navegador some quando a aba e fechada e nao chega a ninguem**  `impacto medio · esforço baixo`
O 'Console Logs' da aba Monitor captura erros que acontecem na tela do usuario, mas guarda no maximo 50 e apenas na memoria do navegador daquela pessoa — fechou a aba, perdeu tudo. Esses erros nao vao para lugar nenhum centralizado. Como o Sentry ja esta no projeto, esses mesmos erros poderiam ser enviados para la, ficando consultaveis por todos.
*Benefício:* Erros de tela de qualquer usuario ficam registrados de forma permanente e centralizada.  
*Onde:* client/src/components/MonitorPanel.jsx (bloco LOG_BUFFER / interceptacao de console.error)

**504. Sentry pode estar desligado em producao sem ninguem perceber**  `impacto medio · esforço baixo`
O Sentry (ferramenta que captura erros do sistema) so liga se a variavel VITE_SENTRY_DSN estiver configurada; caso contrario, fica desativado silenciosamente, registrando apenas um aviso no console. Nao ha indicacao nenhuma no app de que o rastreamento de erros esta ON ou OFF. Pode haver semanas sem capturar erro nenhum simplesmente porque a chave nao foi posta.
*Benefício:* Garante que o sistema de captura de erros esta de fato ligado, evitando 'silencio' enganoso.  
*Onde:* client/src/main.jsx (bloco SENTRY_ENABLED) + indicador no MonitorPanel ou MonitorAdvbox

**505. Uptime do SLO e calculado so com amostras da sessao aberta (numero nao confiavel)**  `impacto medio · esforço baixo`
O indicador 'Uptime API' soma apenas as poucas medicoes feitas enquanto a aba esta aberta na memoria do navegador. Se voce abriu agora, ele tem 1-2 amostras e mostra 100% ou 0% facilmente. Existe uma tabela health_history (gravada pelo robo a cada 30 min, 24h por dia) que daria um uptime real — o painel deveria ler dela em vez das amostras momentaneas.
*Benefício:* O numero de disponibilidade passa a ser real (dias de historico) em vez de um chute da sessao atual.  
*Onde:* client/src/components/HealthSlos.jsx (calculo de uptime/latency via healthSamples) → usar health_history

**506. Falta uma metrica de uso: quem usa o sistema, quais abas, com que frequencia**  `impacto medio · esforço medio`
Hoje da pra ver a saude tecnica (servicos no ar, filas), mas nao ha nenhuma visao de USO: quantos usuarios ativos por dia, quais abas sao mais acessadas, horarios de pico, quantos contratos criados por pessoa. Esse tipo de metrica ajuda a decidir onde investir e a perceber quando alguem parou de usar uma funcao importante. Ja existe a tabela activity_log que poderia alimentar um pequeno painel.
*Benefício:* Voce enxerga a adocao real do sistema e detecta quedas de uso de funcoes importantes.  
*Onde:* Nova secao em client/src/components/MonitorPanel.jsx lendo activity_log (e active_sessions)

**507. Cada secao da aba Monitor faz sua propria busca em loop — muitas requisicoes repetidas**  `impacto baixo · esforço medio`
A aba Monitor tem mais de dez blocos (saude dos robos, fila Kommo, erros Asaas, auditoria, dead-letter, etc.), e cada um abre seu proprio temporizador e faz suas proprias consultas ao banco a cada 15-60 segundos, independentes uns dos outros. Com a aba aberta o dia todo, isso vira um volume grande de chamadas. Centralizar as buscas (uma rodada coordenada) reduziria carga no banco e bandwidth.
*Benefício:* Menos consumo de banco e bandwidth com a aba Monitor aberta o dia todo.  
*Onde:* client/src/components/MonitorPanel.jsx e MonitorAdvbox.jsx (varios useEffect com setInterval independentes)

**508. Health check e watchdog tem listas de servicos separadas que podem desencontrar**  `impacto baixo · esforço medio`
O health check pinga 6 servicos. O robo de vigilancia tem uma lista separada de prazos por cron (CRON_SLA) escrita a mao. Quando uma integracao nova entra ou uma sai (como aconteceu com o ChatGuru e a regua de cobranca), e preciso lembrar de atualizar em varios lugares, e e facil esquecer — gerando 'falso alarme' ou 'ponto cego'. Uma fonte unica da lista de servicos/crons evitaria isso.
*Benefício:* Evita falsos alarmes e pontos cegos quando integracoes entram ou saem.  
*Onde:* netlify/functions/health.mjs (lista de checks) e monitor-watchdog.mjs (CRON_SLA)

**509. Painel de filas mostra o que esta preso, mas nao o tempo medio de processamento**  `impacto medio · esforço medio`
As 'Filas de Automacao' mostram quantos contratos estao aguardando ADVBOX, Drive, assinatura, etc. Mas nao mostram quanto tempo, em media, cada etapa esta levando ultimamente (ex: 'Drive normalmente conclui em 40s, hoje esta em 4min'). Esse tempo medio e o melhor sinal precoce de que algo esta degradando antes de virar erro. Daria pra calcular a partir dos timestamps que ja existem.
*Benefício:* Detecta lentidao crescente das automacoes antes de virarem falha completa.  
*Onde:* client/src/components/MonitorPanel.jsx (componente AutomationQueue) + dados de signed_at/updated_at/advbox_date

**510. Erros do Asaas e do ADVBOX ficam em telas/tabelas separadas, sem visao unica**  `impacto medio · esforço medio`
Os erros de cobranca ficam em asaas_error_log (um bloco), os erros das integracoes ADVBOX/Kommo em advbox_api_log (outro bloco), e os erros de contrato em outro lugar. Para saber 'o que esta dando errado no sistema hoje', precisa olhar varios cantos da aba. Um unico feed cronologico de erros (juntando as fontes, filtravel por origem) daria a foto completa de uma vez.
*Benefício:* Uma so lista para entender tudo que falhou hoje, sem cacar em varios blocos.  
*Onde:* client/src/components/MonitorPanel.jsx (unificar AsaasErrorLog + advbox_api_log + ErrorLog num feed)

**511. Nao ha verificacao de que os webhooks (ZapSign/Asaas/Kommo) estao realmente chegando**  `impacto alto · esforço medio`
Boa parte das automacoes depende de 'avisos' que chegam de fora (webhooks): o ZapSign avisa quando assinam, o Asaas quando pagam. Se um desses webhooks parar de chegar (config removida, URL trocada), o sistema simplesmente para de reagir e ninguem ve — nao ha erro, so silencio. Um indicador 'ultimo webhook recebido ha X' por canal acenderia vermelho quando um deles ficar mudo tempo demais.
*Benefício:* Detecta quando um canal de aviso externo para de chegar, antes de acumular contratos parados.  
*Onde:* netlify/functions/zapsign-webhook.mjs / asaas-webhook.mjs / kommo-advbox-webhook.mjs (registrar ultimo recebimento) + painel no Monitor

**512. Keep-warm aquece so 2 funcoes, mas as criticas pos-assinatura sofrem cold start**  `impacto baixo · esforço baixo`
O keep-warm mantem 'aquecidas' apenas health e zapsign-proxy. As funcoes que rodam logo apos a assinatura (advbox-sync, save-to-drive) foram tiradas de proposito porque 'o usuario ja espera'. Mas hoje muitas assinaturas chegam por webhook a qualquer hora, sem ninguem esperando na tela; um cold start de 1-3s ali pode contribuir para travas e timeouts. Vale reavaliar se essas duas merecem voltar, ao menos em horario comercial.
*Benefício:* Reduz lentidao e risco de timeout nas automacoes que disparam apos a assinatura.  
*Onde:* netlify/functions/keep-warm.mjs (lista FUNCTIONS_TO_WARM)

**513. Sem monitoramento externo: se o site inteiro cair, o proprio monitor cai junto**  `impacto medio · esforço baixo`
Todo o monitoramento vive dentro do proprio sistema (aba Monitor e crons no Netlify). Se o site ou o Netlify ficarem fora do ar, nao ha nada de fora vigiando para avisar voce — o vigia esta dentro do predio que pegou fogo. Um servico externo gratuito de uptime (que pinga a URL de fora a cada poucos minutos e manda email/SMS se cair) cobriria esse ponto cego.
*Benefício:* Voce e avisado mesmo quando o site inteiro sai do ar, situacao em que o monitor interno tambem cai.  
*Onde:* Configuracao externa (UptimeRobot/BetterStack) apontando para /api/health — fora do codigo

**514. Logs (advbox_api_log, health_history) podem crescer sem limpeza automatica**  `impacto baixo · esforço baixo`
Varias tabelas de observabilidade recebem registros continuamente: advbox_api_log (todos os workers gravam), health_history (a cada 30 min, 24h por dia), automation_log. Nao ha sinal de uma rotina que apague registros antigos. Com o tempo isso incha o banco compartilhado e deixa as consultas do painel mais lentas. Uma limpeza periodica (ex: manter so 30-60 dias) mantem tudo enxuto.
*Benefício:* Mantem o banco leve e a aba Monitor rapida ao longo dos meses.  
*Onde:* Nova rotina/cron de limpeza (ou TTL) sobre advbox_api_log, health_history, automation_log

**515. O farol verde 'Tudo OK' pode mentir porque ignora robos atrasados e webhooks mudos**  `impacto medio · esforço baixo`
O grande semaforo do topo do Monitor ('Tudo OK / Atencao') so olha o health dos servicos e os contratos travados. Ele NAO considera se um robo agendado deixou de rodar (esta numa secao separada) nem se um webhook parou de chegar. Entao da pra ver 'Tudo OK' em verde enquanto, na pratica, um robo esta parado ha horas logo abaixo. O farol deveria incluir esses sinais para ser confiavel de relance.
*Benefício:* O semaforo do topo vira um resumo confiavel de verdade, sem contradizer o que esta abaixo.  
*Onde:* client/src/components/MonitorPanel.jsx (funcao buildActionItems / UnifiedStatusHeader) — incluir cron_heartbeat

**516. Sem alerta de consumo de bandwidth/invocacoes do Netlify dentro do app**  `impacto baixo · esforço medio`
O sistema tem limites de plano (bandwidth e numero de execucoes de funcoes). Existe um script manual check-bandwidth.sh, mas nada no proprio app avisa quando o consumo se aproxima do limite. Como os crons e o keep-warm geram milhares de execucoes por mes, um estouro de plano pode acontecer sem aviso previo. Um pequeno indicador de uso/limite no Monitor antecipa o problema.
*Benefício:* Evita surpresa de estouro de plano e custos extras, com aviso antecipado.  
*Onde:* Nova secao no Monitor consumindo a API do Netlify (mesma fonte do check-bandwidth.sh)

**517. A maioria dos robos agendados nao bate ponto — o vigia nao consegue ve-los**  `impacto alto · esforço medio`
Existem 18 tarefas agendadas (robos), mas so 5 registram que rodaram numa lista de 'batidas de ponto' (cron_heartbeat). Os outros 13 — como o que sincroniza boletos do Asaas, o que importa leads do Kommo e o de videochamadas — nunca aparecem la. Basta adicionar uma linha em cada robo dizendo 'rodei agora'.
*Benefício:* Se um desses robos parar (ex: parou de importar boletos), o sistema percebe e avisa, em vez de ficar dias quieto.  
*Onde:* netlify/functions/asaas-sync-boletos.mjs, asaas-sync-customers.mjs, kommo-leads-sync.mjs, agenda-videochamadas-sync.mjs, kommo-asaas-sync.mjs, clientes-reconciliar.mjs (chamar heartbeat() do _lib/botDb.mjs)

**518. Tres dos cinco indicadores de qualidade (SLO) medem uma tabela que ninguem preenche**  `impacto alto · esforço medio`
O painel de 'metas de servico' calcula o sucesso de ZapSign, Drive e ADVBOX olhando a tabela automation_log. So que quase nada grava nessa tabela hoje (so duas funcoes secundarias). Entao esses tres medidores ficam vazios ou enganosos porque a fonte de dados nao e alimentada pelo fluxo real de assinatura.
*Benefício:* Os indicadores de qualidade passam a refletir a realidade, em vez de mostrar '—' ou numeros falsos.  
*Onde:* client/src/components/HealthSlos.jsx (le automation_log) + funcoes do fluxo de assinatura que deveriam gravar la (zapsign-webhook, save-to-drive, advbox-sync)

**519. Ninguem registra quando os webhooks chegam — nao da pra saber se pararam**  `impacto alto · esforço medio`
Os 3 webhooks (ZapSign avisa assinatura, Asaas avisa pagamento, Kommo dispara o bot) nao guardam em lugar nenhum a hora da ultima vez que dispararam. Se o ZapSign parar de avisar (configuracao quebrada), tudo passa a depender so do robo que verifica de tempos em tempos, e ninguem nota o silencio. Bastava gravar 'ultimo webhook recebido: X' por origem.
*Benefício:* Detecta na hora quando um aviso externo importante parou de chegar, antes de virar 'cade a assinatura/pagamento?'.  
*Onde:* netlify/functions/zapsign-webhook.mjs, asaas-webhook.mjs, kommo-advbox-webhook.mjs + nova linha no painel Monitor

**520. O painel nao mostra se o Sentry (cacador de erros) esta ligado**  `impacto medio · esforço baixo`
O Sentry so liga se a chave VITE_SENTRY_DSN estiver configurada; sem ela, ele fica desativado e a unica pista e um aviso no console do navegador, que ninguem ve. O Monitor deveria ter um indicadorzinho 'Sentry: ativo/desligado' para confirmar de relance que os erros estao sendo capturados.
*Benefício:* Garante que erros dos usuarios estao sendo gravados — sem isso, o sistema pode estar 'cego' a falhas sem ninguem saber.  
*Onde:* client/src/components/MonitorPanel.jsx (ler import.meta.env.VITE_SENTRY_DSN e mostrar status); fonte em main.jsx

**521. O painel SLO joga fora o historico cada vez que a aba e fechada**  `impacto medio · esforço medio`
As barras de Uptime e Latencia sao calculadas so com as amostras coletadas enquanto a aba Monitor fica aberta (guardadas na memoria do navegador, ultimas 30). Fechou a aba, zerou. Mas ja existe a tabela health_history sendo gravada pelo robo a cada 30 min — bastaria o painel ler dela para ter uptime real de dias/semanas em vez de minutos.
*Benefício:* Uptime e latencia passam a ser numeros confiaveis e historicos, nao um retrato dos ultimos minutos da sessao.  
*Onde:* client/src/components/HealthSlos.jsx (trocar healthSamples in-memory por leitura de health_history)

**522. Cada secao do Monitor faz seu proprio relogio — sao 8+ buscas repetidas em loop**  `impacto medio · esforço alto`
Abrindo a aba Monitor, varios blocos disparam buscas em paralelo cada um com seu proprio temporizador (uns a cada 15s, outros 30s, outros 60s): saude dos robos, saude por servico, fila Kommo, erros do Asaas, historico, auditoria, dead-letter. Isso multiplica requisicoes e consumo. Daria para centralizar num unico relogio e compartilhar os dados.
*Benefício:* Menos requisicoes ao banco, pagina mais leve e menos gasto de cota — sem perder informacao.  
*Onde:* client/src/components/MonitorPanel.jsx e MonitorAdvbox.jsx (multiplos setInterval independentes)

**523. O detector de loop nunca conserta sozinho — so mostra o problema**  `impacto medio · esforço medio`
Quando um contrato fica travado mais de 5 min ('processando' ADVBOX ou 'enviando' Drive), o painel mostra um aviso amarelo, mas nao oferece nenhum botao para destravar nem aciona o auto-conserto. A pessoa ve o alerta e nao tem o que fazer ali — tem que ir cacar o contrato em outra tela.
*Benefício:* Transforma um aviso 'morto' em acao: um clique para destravar/re-tentar, resolvendo na hora.  
*Onde:* client/src/components/MonitorPanel.jsx (componente LoopDetector — hoje so lista, sem botao)

**524. O console de eventos some quando os erros ficam 'velhos' demais**  `impacto medio · esforço baixo`
O painel de eventos da Central ADVBOX so puxa os 80 eventos mais recentes, sem filtro de data nem botao de carregar mais. Num dia de muita atividade, um erro importante de algumas horas atras pode sumir da tela empurrado pelos eventos novos, mesmo sem ter sido lido. Falta paginacao ou 'ver mais antigos'.
*Benefício:* Erros nao se perdem na rolagem — da para investigar o que aconteceu mesmo horas depois.  
*Onde:* client/src/components/MonitorAdvbox.jsx (advbox_api_log limitado a 80, sem 'carregar mais')

**525. Sem aviso ativo: o Monitor so alerta para quem ja esta com a aba aberta**  `impacto alto · esforço medio`
Toda a deteccao de problema (servico fora do ar, robo parado, erro nao lido) so aparece para quem abre a aba Monitor. Ja existe a infraestrutura de notificacoes (notifications + push do Portal) usada para outras coisas. Bastava o robo vigia (monitor-watchdog), que ja roda a cada 30 min, gravar uma notificacao para o Paulo quando algo cai — assim chega sozinho.
*Benefício:* O dono fica sabendo de uma queda sem precisar ficar olhando o painel; reduz tempo de sistema quebrado.  
*Onde:* netlify/functions/monitor-watchdog.mjs (ja detecta 'caiu'/'crons_parados', so falta gravar em notifications)

**526. O painel de filas conta o que esta preso, mas nao quanto tempo demora normalmente**  `impacto baixo · esforço medio`
O bloco 'Filas de Automacao' mostra quantos contratos estao em cada fila (aguardando assinatura, fila ADVBOX, fila Drive). Mas nao mostra o tempo medio que cada etapa leva nem se uma fila esta lenta hoje comparada ao normal. So o numero, sem velocidade. Daria para calcular o tempo medio de processamento a partir das datas que ja existem.
*Benefício:* Diferencia 'fila grande mas andando rapido' de 'fila travando' — diagnostico mais util.  
*Onde:* client/src/components/MonitorPanel.jsx (componente AutomationQueue — hoje so contagem)

**527. O 'Console Logs' do navegador captura erros mas nao os manda para lugar nenhum**  `impacto medio · esforço medio`
Existe um capturador que guarda os ultimos 50 erros/avisos que aparecem no console do navegador do usuario, mas eles ficam so na memoria daquela aba e somem ao fechar. Como o Sentry pode estar desligado, esses erros locais nao chegam a ninguem. Daria para enviar os erros de console mais graves para a tabela de log do banco (advbox_api_log) ou para o Sentry.
*Benefício:* Erros que so o usuario ve no navegador passam a ser registrados para analise depois.  
*Onde:* client/src/components/MonitorPanel.jsx (LOG_BUFFER / LogPanel — captura mas nao persiste)

**528. O alerta de capacidade tem limites do plano antigo e nunca avisa de verdade**  `impacto medio · esforço medio`
O bloco 'Alertas de Capacidade' tem comentarios dizendo '125 mil chamadas/mes (gratis)' e '500MB de banco' — limites do plano gratuito antigo (hoje a conta e Pro, com cotas bem maiores). Pior: ele so olha a lentidao do health check, nunca o consumo real de chamadas, banda ou tamanho do banco. Entao nunca avisa de estouro de cota de verdade.
*Benefício:* Evita surpresa de fim de mes com cota estourada; corrige numeros desatualizados que enganam.  
*Onde:* client/src/components/MonitorPanel.jsx (componente CapacityAlerts, comentarios com limites do free tier)

**529. O farol 'Tudo OK' do topo ignora os robos e webhooks — pode mentir**  `impacto medio · esforço medio`
O semaforo grande no topo do Monitor (o circulo 'Tudo OK / Atencao') so olha dois sinais: os servicos do health check e os contratos com automacao travada. Ele NAO considera robos agendados parados nem webhooks silenciosos (que ficam no banner logo abaixo). Entao da pra ter o farol verde enquanto um robo importante esta morto. Os dois deveriam usar a mesma lista de problemas.
*Benefício:* O sinal verde passa a significar mesmo 'tudo certo', em vez de uma falsa tranquilidade.  
*Onde:* client/src/components/MonitorPanel.jsx (buildActionItems/UnifiedStatusHeader nao incluem crons nem webhooks que o MonitorAlerts ja conhece)

**530. Falta uma trilha de uso: quem entra, quando e em quais abas**  `impacto baixo · esforço medio`
O sistema registra login anomalo (fora de horario/pais), mas nao guarda um uso normal: quais abas as pessoas mais usam, em que horarios, quem esta ativo. Ja existe a tabela activity_log e active_sessions. Um painelzinho simples de 'usuarios ativos hoje / abas mais acessadas' ajudaria a entender o sistema e a decidir o que vale melhorar.
*Benefício:* Da visao de quem usa o que — orienta onde investir esforco e ajuda a notar abandono de funcoes.  
*Onde:* client/src/components/MonitorPanel.jsx (nova secao lendo activity_log/active_sessions, que ja existem)

**531. Os logs de eventos crescem para sempre sem limpeza automatica**  `impacto medio · esforço baixo`
Tabelas como advbox_api_log e health_history recebem registros o tempo todo (a cada 30 min, a cada robo) e nada apaga os antigos. Com meses, ficam enormes, deixam as buscas do painel mais lentas e ocupam espaco do banco compartilhado. Uma rotina simples (no proprio robo vigia que ja roda a cada 30 min) poderia apagar registros com mais de, digamos, 60-90 dias.
*Benefício:* Painel continua rapido e o banco nao incha com historico que ninguem mais consulta.  
*Onde:* netlify/functions/monitor-watchdog.mjs (ja roda a cada 30 min — bom lugar p/ um DELETE de retencao em advbox_api_log/health_history)

**532. O vigia externo cai junto com o site — falta um monitor de fora**  `impacto alto · esforço baixo`
Quase tudo que vigia o sistema roda dentro do proprio Netlify (robos, health check, painel). Se o site inteiro cair, o vigia cai junto e ninguem e avisado. Vale ligar um servico externo gratuito (tipo UptimeRobot) batendo na URL /api/health a cada poucos minutos — quando ele nao responder, manda email/WhatsApp de fora. O endpoint /health ja existe e ja retorna 'saudavel/degradado'.
*Benefício:* Garante aviso mesmo numa queda total, quando o monitor interno tambem esta fora.  
*Onde:* Servico externo apontando para /.netlify/functions/health (ja pronto em netlify/functions/health.mjs) — configuracao, sem codigo


## 18. Testes, Qualidade & CI/CD  *(32)*

**533. Tornar o LINT um portão obrigatório (hoje ele só avisa)**  `impacto alto · esforço medio`
No robô que confere o código a cada mudança (CI no GitHub), o teste de qualidade de código (lint) está configurado para só dar um aviso e NUNCA reprovar — mesmo com 20 erros parados há tempos. É como um detector de fumaça que apita mas nunca chama os bombeiros. O próprio comentário no arquivo diz 'vira portão depois que o baseline for zerado', e isso nunca foi feito.
*Benefício:* Impede que erros novos entrem no sistema sem ninguém ver; força a equipe a manter o código limpo.  
*Onde:* .github/workflows/ci.yml (linha 40, o 'npm run lint || echo warning') + zerar os 20 erros antes

**534. Corrigir os 20 erros de lint que estão parados há meses**  `impacto medio · esforço medio`
O sistema tem 20 erros e 19 avisos de qualidade de código que já existem há tempo e foram 'tolerados'. A maioria são padrões do React que podem causar telas piscando ou travando (ex.: UndoToast.jsx e App.jsx atualizam a tela de um jeito que dispara renderizações em cascata). Enquanto esse 'lixo acumulado' existe, é impossível ligar o portão de qualidade da sugestão anterior.
*Benefício:* Some o lixo acumulado, evita pequenos travamentos de tela e libera o portão de qualidade.  
*Onde:* client/src/components/UndoToast.jsx, App.jsx, Toast.jsx, PreSendChecklist.jsx, hooks/useEmpreendimentos.js

**535. Testar a detecção de contrato duplicado (CPF + Resort)**  `impacto alto · esforço medio`
A REGRA #6 diz que ao criar um contrato o sistema deve avisar se já existe outro contrato para o mesmo CPF no mesmo resort. Essa função (checkDuplicate em duplicateDetector.js) NÃO tem nenhum teste automático. Se ela quebrar numa atualização, vão nascer contratos duplicados silenciosamente — exatamente o problema 'assinou mas mostra não abriu' que já aconteceu (anotado nas memórias).
*Benefício:* Garante que o aviso de duplicata nunca pare de funcionar; evita contratos repetidos.  
*Onde:* client/src/utils/duplicateDetector.js (sem teste em __tests__/)

**536. Cobrir com testes os módulos das Netlify Functions (servidor)**  `impacto alto · esforço alto`
Toda a parte 'do servidor' que conversa com ADVBOX, Kommo, Asaas e ZapSign (49 funções + 9 bibliotecas em netlify/functions) tem ZERO testes automáticos — só o mapa de tipos de ação (advboxMaps) é testado. São justamente essas funções que lançam processo no CRM, emitem boleto e nota fiscal. Um erro aqui é dinheiro e processo errado no mundo real.
*Benefício:* Protege as integrações que mexem com dinheiro e CRM, onde um bug custa caro.  
*Onde:* client/netlify/functions/_lib/ (asaasMirror, kommo, botEngine, advbox) — só advboxMaps tem teste

**537. Ligar relatório de cobertura de testes (quanto do código é testado)**  `impacto medio · esforço baixo`
Hoje ninguém sabe a porcentagem real do código que está protegida por testes. O Vitest (a ferramenta de teste) consegue gerar esse número com um comando, mas não está configurado. Sem isso, é só 'achismo' dizer se o sistema está bem testado. Uma estimativa rápida: de ~38 arquivos de 'utils', só 11 têm teste.
*Benefício:* Mostra em número onde faltam testes e impede que a cobertura caia sem ninguém notar.  
*Onde:* client/vitest.config.js (adicionar bloco coverage) + script no package.json

**538. Testar o cálculo de comissão das vendedoras**  `impacto alto · esforço medio`
O cálculo de comissão (commissionClient.js, que roda todo dia 20) decide quanto cada vendedora recebe, incluindo a regra do período que começa no dia 20. Não há nenhum teste cobrindo isso. Se a conta da virada de mês sair errada, alguém recebe a mais ou a menos e ninguém percebe até a reclamação.
*Benefício:* Garante que ninguém receba comissão errada por um bug silencioso na conta.  
*Onde:* client/src/utils/commissionClient.js (função getCurrentPeriodoInicio e cálculos)

**539. Testar a importação de contrato assinado externo**  `impacto medio · esforço medio`
Quando um contrato é assinado fora do sistema e importado, a função checkAutomacaoRequisitos (importContrato.js) decide o que dispara depois (ADVBOX, Drive etc.). Essa lógica de 312 linhas não tem teste. Como ela escolhe quais automações rodar, um erro pode deixar de lançar processo no CRM ou disparar duas vezes.
*Benefício:* Evita que contratos importados pulem etapas ou disparem automações erradas.  
*Onde:* client/src/utils/importContrato.js

**540. Criar um teste de fumaça automático mais completo após o deploy**  `impacto medio · esforço alto`
Hoje, depois de publicar, o deploy.sh só confere se a página inicial e a função 'health' respondem. O resto do checklist (login, abas críticas, gerar contrato) é feito na mão, lendo um documento de 5 minutos. Dá para automatizar uns 4-5 testes que abrem o site real e clicam nas abas principais, avisando na hora se algo quebrou.
*Benefício:* Pega telas quebradas em segundos, sem depender de alguém lembrar de testar na mão.  
*Onde:* client/deploy.sh (smoke atual cobre só home+health) + docs/SMOKE_CHECKLIST.md (hoje manual)

**541. Permitir testes de componentes de tela (React), hoje impossíveis**  `impacto medio · esforço medio`
A configuração de testes está em modo 'node' (sem navegador simulado), então só dá para testar funções de cálculo — nunca uma tela ou botão. Componentes importantes como o formulário de contrato, o checklist de envio e os modais não podem ser testados de jeito nenhum hoje. Trocar para o modo 'jsdom' destrava esses testes.
*Benefício:* Abre a porta para testar telas e formulários, não só contas isoladas.  
*Onde:* client/vitest.config.js (environment: 'node' → 'jsdom') + instalar testing-library

**542. Adicionar verificação automática antes de cada commit (pre-commit)**  `impacto medio · esforço baixo`
Não existe um 'porteiro' no computador do desenvolvedor que rode lint e testes ANTES de salvar o código no histórico. Isso significa que código com erro só é pego lá no robô do GitHub, ou pior, já no deploy. Uma ferramenta simples (husky + lint-staged) roda a checagem nos arquivos alterados em segundos, antes de tudo.
*Benefício:* Pega erros no minuto em que são escritos, antes de chegarem ao deploy.  
*Onde:* client/package.json (sem husky/lint-staged hoje) + nova pasta .husky

**543. Avisar automaticamente quando uma biblioteca tiver falha de segurança**  `impacto medio · esforço baixo`
O sistema usa dezenas de bibliotecas de terceiros (React, Supabase, jsPDF, OCR etc.). Quando alguma delas descobre uma brecha de segurança, hoje ninguém é avisado. O GitHub tem um robô gratuito (Dependabot) que abre um aviso e até propõe a correção sozinho. Não há arquivo de configuração dele no projeto.
*Benefício:* Mantém as bibliotecas seguras e atualizadas sem precisar checar na mão.  
*Onde:* .github/ (criar dependabot.yml — não existe) + rodar 'npm audit' no CI

**544. Testar a geração e a divisão do PDF assinado em páginas**  `impacto medio · esforço medio`
Depois da assinatura, o sistema corta o PDF em contrato + procuração + relatório (REGRA #20, em pdfGenerator.js e no save-to-drive). Essa lógica de cortar nas páginas certas não tem teste. Se o corte errar, o cliente recebe a procuração junto do contrato ou faltando páginas — e isso já deu problema antes (DOCX com cláusulas 1/2 faltando, anotado no histórico).
*Benefício:* Garante que cada documento arquivado tenha as páginas certas, sempre.  
*Onde:* client/src/utils/pdfGenerator.js (317 linhas, sem teste) + lógica de split no save-to-drive

**545. Travar a versão do Node usada nos testes e no deploy**  `impacto baixo · esforço baixo`
O robô do GitHub usa Node 22, mas a máquina onde se roda o deploy.sh pode ter outra versão (o histórico menciona 'testado com 24.14'). Quando as versões divergem, um teste pode passar num lugar e falhar no outro, ou o build sair diferente. Um arquivo simples (.nvmrc) fixa a versão para todo mundo usar a mesma.
*Benefício:* Evita o clássico 'na minha máquina funcionava'; deixa testes e build previsíveis.  
*Onde:* raiz do client/ (criar .nvmrc) — CI já usa Node 22 mas local não está travado

**546. Testar a montagem da chamada ao ZapSign (envio para assinatura)**  `impacto medio · esforço medio`
A função que monta e dispara o documento para assinatura (sendToZapSign em zapsignService.js) é o coração do fluxo. Não há teste verificando se ela monta a lista de assinantes e os dados certos antes de enviar. Como o envio para o cliente passa por aqui, um erro silencioso pode mandar o contrato para o assinante errado ou sem um dos contratantes.
*Benefício:* Protege o passo mais visível para o cliente: receber o contrato certo para assinar.  
*Onde:* client/src/utils/zapsignService.js (6 funções exportadas, nenhuma testada)

**547. Testar o roteamento de endereços de API (/api com plano B)**  `impacto medio · esforço baixo`
O sistema chama as funções do servidor por um caminho curto (/api/...) e, se falhar, tenta um caminho reserva (/.netlify/functions/...). Essa lógica de 'plano A e plano B' está em apiEndpoints.js e não tem teste. Se ela escolher o caminho errado, integrações inteiras (assinatura, cobrança) podem parar sem mensagem clara de erro.
*Benefício:* Garante que o 'plano B' das chamadas de servidor realmente funcione quando precisar.  
*Onde:* client/src/utils/apiEndpoints.js (67 linhas, sem teste)

**548. Guardar o histórico de quais testes rodaram em cada deploy**  `impacto baixo · esforço baixo`
O robô do GitHub roda os testes mas não guarda um relatório consultável (quais passaram, quanto tempo levou) como 'artefato'. Quando algo der errado em produção, é útil olhar para trás e ver exatamente o que foi testado naquele deploy. É uma configuração pequena no robô que sobe esse relatório.
*Benefício:* Cria um rastro de auditoria: dá para provar o que foi testado em cada versão publicada.  
*Onde:* .github/workflows/ci.yml (adicionar upload-artifact do relatório de testes)

**549. Fazer o robô de CI também checar a pasta do servidor Node**  `impacto baixo · esforço medio`
O robô do GitHub (ci.yml) só roda build, teste e lint dentro de client/. A pasta server/ (Express, Puppeteer, backup em S3, ~monolito index.js) fica de fora — nenhum lint ou teste passa por ela. Como ela faz o backup diário e gera PDF no servidor, um erro lá passa totalmente despercebido pelo CI.
*Benefício:* Estende a rede de proteção para a parte de backup e PDF do servidor, hoje cega.  
*Onde:* .github/workflows/ci.yml (só roda em working-directory: client) + server/

**550. Anotar o ID do deploy anterior também no rollback automático**  `impacto baixo · esforço baixo`
O deploy.sh salva o último deploy bom num arquivo (.last-working-deploy) para reverter rápido. Mas se forem feitos dois deploys seguidos, o arquivo é sobrescrito e o 'bom' antigo se perde. Guardar os últimos 3-5 IDs num pequeno histórico evita ficar caçando o ID certo no painel da Netlify numa emergência.
*Benefício:* Acelera a reversão em uma emergência, sem caçar o ID certo no painel.  
*Onde:* client/deploy.sh (escreve .last-working-deploy) + rollback.sh

**551. Travar o que falta no rollback automatico para nao reverter para uma versao errada**  `impacto alto · esforço baixo`
O rollback usa um arquivo (.last-working-deploy) gravado pelo deploy. Hoje o rollback NAO confere se aquele ID realmente esta vivo na Netlify nem mostra a data/mensagem do deploy antes de restaurar. Se o arquivo estiver desatualizado, voce pode voltar para uma versao antiga errada sem perceber.
*Benefício:* Evita reverter o sistema para uma versao errada num momento de panico (site fora do ar).  
*Onde:* client/rollback.sh

**552. Testar o detector de duplicatas e o tempo estimado de assinatura**  `impacto medio · esforço medio`
O arquivo duplicateDetector.js decide se um cliente ja tem contrato (CPF + resort) e estima quanto tempo a assinatura demora. E logica de negocio importante e nao tem nenhum teste. Um teste fixaria o comportamento esperado para que mudancas futuras nao quebrem o aviso de duplicata.
*Benefício:* Garante que o aviso de cliente repetido continue funcionando ao longo das mudancas.  
*Onde:* client/src/utils/duplicateDetector.js (sem teste)

**553. Proteger o snapshot do contrato contra mudancas silenciosas**  `impacto alto · esforço baixo`
Ja existe um teste que tira uma foto (snapshot) do HTML do contrato gerado. O risco e que, ao rodar o teste com a flag de atualizar, a foto seja regravada automaticamente e mudancas indevidas no texto do contrato passem despercebidas. Vale travar no CI para que o snapshot NUNCA seja atualizado sozinho la (so localmente, com revisao humana).
*Benefício:* Impede que o texto juridico do contrato mude sem alguem revisar de proposito.  
*Onde:* client/src/utils/__tests__/__snapshots__/contractHtml.test.js.snap + ci.yml

**554. Cobrir com teste a importacao de contrato assinado externo (validacao de requisitos)**  `impacto medio · esforço medio`
importContrato.js tem uma funcao que confere se um contrato importado tem tudo que a automacao precisa (checkAutomacaoRequisitos) antes de mandar pro ADVBOX/Drive. Sem teste, e facil quebrar essa conferencia e deixar passar um contrato incompleto, que depois falha la na frente.
*Benefício:* Evita que contratos importados pela metade travem ADVBOX, Drive ou cobranca depois.  
*Onde:* client/src/utils/importContrato.js (checkAutomacaoRequisitos, processImport)

**555. Fixar a versao do Node tambem no deploy e no ambiente local, nao so no CI**  `impacto medio · esforço baixo`
O robo do GitHub (CI) usa Node 22, mas o deploy.sh e a maquina local usam o Node que estiver instalado. Se sua maquina tiver outra versao, o build local pode passar e o de producao falhar (ou vice-versa). Um arquivo .nvmrc + o campo engines no package.json deixam todo mundo na mesma versao.
*Benefício:* Acaba o 'na minha maquina funciona' entre CI, deploy e seu computador.  
*Onde:* client/package.json (engines) + novo client/.nvmrc

**556. Avisar quando uma biblioteca tiver falha de seguranca conhecida**  `impacto medio · esforço baixo`
O sistema usa dezenas de bibliotecas (React, jsPDF, xlsx, etc.). Volta e meia descobrem falhas de seguranca nelas. Hoje ninguem e avisado. Um passo simples no robo de CI (npm audit) ou o Dependabot do GitHub avisa automaticamente quando uma dessas bibliotecas tem problema conhecido.
*Benefício:* Voce fica sabendo de risco de seguranca em biblioteca antes de virar incidente.  
*Onde:* .github/workflows/ci.yml (ou Dependabot)

**557. Smoke test pos-deploy mais esperto: hoje aceita ate erro 404 como 'ok'**  `impacto medio · esforço baixo`
O teste automatico depois do deploy so verifica se a home responde e se a funcao 'health' responde — e ele considera ate 404 (pagina nao encontrada) como aceitavel para o health. Isso pode mascarar uma funcao quebrada. Vale checar o conteudo real da resposta do health (ex.: que ele diz 'ok') e nao so o codigo.
*Benefício:* Pega problema de backend logo apos o deploy, em vez de descobrir com o usuario reclamando.  
*Onde:* client/deploy.sh (bloco [smoke])

**558. Ligar relatorio de cobertura para enxergar o que NAO esta testado**  `impacto medio · esforço baixo`
Hoje rodam ~12 arquivos de teste, mas ninguem sabe qual fatia do codigo eles cobrem. Ligando a cobertura (vitest --coverage) voce ganha um numero e uma lista do que ainda esta sem teste, para priorizar (ex.: comissao, cobranca, geracao de PDF).
*Benefício:* Mostra em numeros onde o sistema esta desprotegido, guiando onde investir.  
*Onde:* client/vitest.config.js + package.json

**559. Testar o calculo de comissao das vendedoras (logica de dinheiro sem teste)**  `impacto alto · esforço medio`
commissionClient.js participa do calculo de comissao, que vira dinheiro pago. Nao tem teste. Um erro aqui paga a mais ou a menos para a equipe. Mesmo alguns testes de cenarios comuns (com e sem meta batida, faixas) ja dariam muita seguranca.
*Benefício:* Protege calculos que viram pagamento real para a equipe de vendas.  
*Onde:* client/src/utils/commissionClient.js (sem teste)

**560. Testar os modulos compartilhados das Netlify Functions (_lib), que ja sao testaveis**  `impacto alto · esforço medio`
As funcoes de servidor compartilham 9 modulos em netlify/functions/_lib (advbox, kommo, asaasMirror, botEngine, etc.). Hoje so 1 deles (advboxMaps) tem teste — e ele ja prova que o vitest consegue testar essa pasta. Os outros (montar chamada ADVBOX, traducao do bot, espelho Asaas) carregam logica critica sem rede de protecao.
*Benefício:* Cobre o miolo das integracoes (CRM, cobranca, bot) que hoje so e testado em producao.  
*Onde:* client/netlify/functions/_lib/*.mjs

**561. Fazer o CI verificar a pasta do servidor Node, hoje totalmente fora do robo**  `impacto baixo · esforço medio`
O robo de CI so entra na pasta client/. A pasta server/ (Puppeteer, OCR, backup S3) nunca e instalada nem checada pelo CI. Se alguem quebrar o server, so se descobre na hora de rodar o backup. Vale ao menos instalar dependencias e rodar um check (lint/sintaxe) no server.
*Benefício:* Evita que o backup diario e a geracao de PDF do servidor quebrem sem ninguem ver.  
*Onde:* .github/workflows/ci.yml + server/

**562. Verificacao automatica antes de cada commit (pre-commit) para nao comitar codigo quebrado**  `impacto baixo · esforço medio`
Hoje da para comitar codigo que nao passa no lint nem nos testes; so o CI pega depois. Um gancho de pre-commit (ex.: husky + lint-staged) roda lint/teste nos arquivos alterados antes de gravar o commit, segurando o erro na origem.
*Benefício:* Pega o erro no seu computador, antes de subir, economizando rodadas de CI.  
*Onde:* client/ (husky/lint-staged) + package.json

**563. Corrigir os 20 erros de lint travados para poder tornar o lint obrigatorio**  `impacto medio · esforço medio`
Existem 20 erros de lint parados ha meses (em App.jsx, AuthContext, Dashboard, AdminPanel, etc.). Enquanto eles existirem, o CI nao pode bloquear por lint — vive 'so avisando'. Zerar esse baseline destrava transformar o lint num portao de verdade, que e o que impede bug de escapar.
*Benefício:* Destrava o lint como guardiao real, em vez de aviso ignorado.  
*Onde:* client/eslint.config.js + arquivos listados pelo npm run lint

**564. Testar o wrapper de seguranca de consultas ao banco (timeout/degradacao)**  `impacto baixo · esforço medio`
supabaseSafe.js protege as consultas ao banco com tempo-limite e dispara o aviso de 'sistema lento' na tela. E uma peca de resiliencia que, se quebrar silenciosamente, faz a tela travar sem aviso. Vale um teste simulando consulta lenta e consulta que estoura o tempo.
*Benefício:* Garante que o aviso de 'banco lento' realmente apareca quando precisa.  
*Onde:* client/src/utils/supabaseSafe.js (sem teste)


## 19. Portal do Cliente  *(31)*

**565. Links do portal nunca expiram (risco de vazamento)**  `impacto alto · esforço medio`
O link de acesso ao portal funciona para sempre, sem senha. Se um cliente reencaminhar o link (ou o celular for perdido/vendido), qualquer pessoa com aquele endereco ve processo, pagamentos e valores do acordo indefinidamente. Hoje a unica forma de cortar acesso e a equipe lembrar de 'Desativar' manualmente.
*Benefício:* Reduz a exposicao de dados sensiveis de clientes (LGPD) e limita o estrago de um link vazado.  
*Onde:* cliente_portal_tokens (sem coluna de validade) + portal-data.mjs / portal-admin.mjs

**566. Aviso automatico para clientes que receberam link e nunca abriram**  `impacto alto · esforço medio`
A tela ja mostra um filtro 'Nunca acessou', mas o reenvio depende de alguem clicar manualmente em cada cliente. Muitos links viram 'letra morta'. Daria para o sistema lembrar a equipe (ou ate enviar um WhatsApp/push de cortesia) apos X dias sem acesso.
*Benefício:* Mais clientes realmente usando o portal, menos ligacoes perguntando 'como ta meu processo'.  
*Onde:* PortalClientePanel.jsx (LinksAtivos, filtro 'nunca') + uma nova rotina agendada

**567. Notificacao por push so e oferecida na aba 'Meu caso'**  `impacto medio · esforço baixo`
O convite para ativar avisos no celular aparece apenas na primeira aba e some quando o cliente navega. Quem entra direto em Pagamentos pode nunca ver. E nao ha uma segunda chance de oferecer se o cliente ignorou.
*Benefício:* Mais clientes ativam avisos = portal vira canal proativo em vez de algo que o cliente esquece.  
*Onde:* portal.html (montaPush + render: bloco 'push' so visivel quando aba==='proc')

**568. Geracao do PDF de extrato depende de servidor externo (cdnjs)**  `impacto medio · esforço medio`
Para gerar o extrato de honorarios em PDF, o portal baixa uma biblioteca de um site externo (cdnjs) toda vez. Se esse site estiver fora do ar, lento ou bloqueado pela rede do cliente, o botao falha. Tambem nao ha verificacao de integridade do arquivo baixado.
*Benefício:* Extrato funciona de forma confiavel e mais segura, sem depender de terceiros.  
*Onde:* portal.html (carregaJsPDF aponta para cdnjs.cloudflare.com)

**569. Copia do portal offline guarda dados pessoais sem protecao no celular**  `impacto medio · esforço medio`
Para funcionar sem internet, o portal salva no celular uma copia completa dos dados (nome, processos, pagamentos). Fica gravado em texto aberto no navegador e nunca e apagado, mesmo depois que o link e desativado.
*Benefício:* Menos dados sensiveis parados no aparelho do cliente, melhor postura de privacidade (LGPD).  
*Onde:* portal.html (localStorage 'cbc_payload' em montaTudo/fetch) + portal-sw.js (cache 'cbc-portal-v1')

**570. Marcar termos juridicos a cada render pesa em historicos longos**  `impacto baixo · esforço medio`
Para sublinhar palavras juridicas na linha do tempo, o portal testa ate 80 termos do glossario em cada movimentacao, toda vez que a tela e redesenhada. Em processos com historico grande, isso pode deixar a navegacao travada em celulares mais simples.
*Benefício:* Portal mais fluido para clientes com aparelhos modestos e processos antigos.  
*Onde:* portal.html (funcao marcaTermos, chamada dentro do map da timeline)

**571. Painel da equipe nao mostra perguntas e NPS dentro da mesma area de gestao**  `impacto medio · esforço medio`
A visao geral exibe NPS e engajamento, mas o detrator (cliente insatisfeito) so vira tarefa no Kommo e um log no Monitor. Na propria tela do portal nao ha uma lista clara de 'clientes insatisfeitos para acompanhar', que e justamente o que evita perder cliente.
*Benefício:* A equipe age rapido sobre quem deu nota baixa, melhorando retencao.  
*Onde:* PortalClientePanel.jsx (EngajamentoNps) + portal-feedback.mjs (detratores)

**572. Cliente nao recebe confirmacao quando a equipe responde, se nao estiver com push ativo**  `impacto medio · esforço medio`
Quando a equipe responde uma duvida, o sistema tenta avisar por push. Mas se o cliente nao ativou avisos (maioria), a resposta fica parada no portal sem ninguem avisar. Poderia haver um aviso por WhatsApp/Kommo automatico nesse caso.
*Benefício:* Cliente realmente fica sabendo que foi respondido, fechando o ciclo de atendimento.  
*Onde:* PortalClientePanel.jsx (PerguntasComPush -> portal-push) + integracao Kommo

**573. Pesquisa de satisfacao (NPS) some por 30 dias so naquele aparelho**  `impacto baixo · esforço medio`
Depois que o cliente avalia (ou e mostrado o NPS), o controle de 'nao mostrar de novo' fica guardado so no navegador daquele celular. Se ele abrir em outro aparelho ou limpar os dados, a pesquisa reaparece e pode irritar/coletar resposta duplicada.
*Benefício:* Pesquisa mais respeitosa com o cliente e dados de NPS mais limpos.  
*Onde:* portal.html (montaNps usa localStorage 'cbc_nps_em') — mover controle para o banco por token

**574. Token de acesso tambem e aceito pelo endereco '#' (hash) sem necessidade**  `impacto baixo · esforço baixo`
O portal le o codigo de acesso tanto da parte normal do link quanto da parte depois do '#'. Aceitar dois formatos aumenta a chance de links estranhos circularem e dificulta auditar como o acesso foi compartilhado. O ideal e padronizar em um formato so.
*Benefício:* Comportamento de acesso mais previsivel e mais facil de rastrear.  
*Onde:* portal.html (linha que monta 'token' a partir de location.search e location.hash)

**575. Sem registro de quem (na equipe) gerou, renovou ou desativou cada link**  `impacto medio · esforço baixo`
Qualquer pessoa com acesso a aba pode gerar, renovar ou desativar links de portal, mas nao fica gravado quem fez o que e quando. Em caso de duvida ('por que esse cliente perdeu o acesso?') nao da para auditar.
*Benefício:* Rastreabilidade interna e responsabilizacao, util em escritorio com varias secretarias.  
*Onde:* portal-admin.mjs (acoes create/rotate/toggle) — gravar autor da acao

**576. Acesso a aba protegido por uma unica 'chave de bot' compartilhada**  `impacto alto · esforço medio`
A aba do portal conversa com o servidor usando uma chave fixa embutida no sistema (a mesma do bot). Se essa chave vazar, alguem de fora poderia listar clientes e gerar/desativar links. Ela tem ate um valor padrao fraco quando nao configurada.
*Benefício:* Fecha uma porta de acesso indevido a dados de clientes e a geracao de links.  
*Onde:* PortalClientePanel.jsx (VITE_BOT_PANEL_KEY default 'cbc-bot-2026') + portal-admin.mjs (x-bot-key)

**577. Conteudo do portal e so em portugues, sem opcao de fonte/contraste persistente**  `impacto medio · esforço medio`
O portal tem botoes A+/A- para aumentar a letra, mas pelo que se ve a preferencia nao fica salva entre visitas, e nao ha modo de alto contraste. Para clientes idosos (publico frequente em multipropriedade) isso pesa na experiencia.
*Benefício:* Portal mais acessivel para o publico idoso, reduzindo frustracao e ligacoes de ajuda.  
*Onde:* portal.html (controles .a11y no header) — persistir preferencia por token/localStorage

**578. Busca de cliente na aba depende do espelho do ADVBOX estar atualizado**  `impacto baixo · esforço baixo`
Quando a equipe busca um cliente para gerar link, o sistema procura no 'espelho' do ADVBOX. Se o cliente foi cadastrado ha pouco e o espelho ainda nao sincronizou, ele simplesmente 'nao existe' na busca, sem explicar o porque. Falta uma mensagem orientando a aguardar o proximo sync ou sincronizar.
*Benefício:* Menos confusao da equipe achando que o cliente sumiu; expectativa correta.  
*Onde:* PortalClientePanel.jsx (estado 'Nenhum cliente encontrado') + portal-admin.mjs (search em bi_clientes)

**579. Mensagem de WhatsApp do link e fixa, sem espaco para personalizar por escritorio/campanha**  `impacto baixo · esforço baixo`
O texto enviado ao cliente junto com o link e o mesmo para todos, escrito no codigo. Nao da para a equipe ajustar tom, incluir nome do advogado responsavel ou adaptar para uma campanha sem mexer no codigo.
*Benefício:* Comunicacao mais pessoal e flexivel, sem precisar de programador para pequenas mudancas.  
*Onde:* PortalClientePanel.jsx (funcao waLink, texto fixo) — tornar editavel via bot_config

**580. Beacon de metricas pode perder eventos em alguns navegadores**  `impacto baixo · esforço medio`
O portal coleta cliques e tempo de uso e envia em 'lotes'. Em alguns celulares, ao fechar a aba rapido, parte desses dados se perde (o envio nao chega). As estatisticas de uso ficam subestimadas, o que distorce decisoes baseadas nelas.
*Benefício:* Metricas de uso mais confiaveis para guiar melhorias do portal.  
*Onde:* portal.html (flushEv/sendBeacon, visibilitychange/pagehide) + portal-track.mjs

**581. Renovar link nao avisa o cliente que o link antigo parou de funcionar**  `impacto baixo · esforço baixo`
Quando a equipe 'Renova' um link, o antigo deixa de valer na hora. Se o cliente tinha o link antigo salvo/instalado na tela inicial, ele simplesmente para de abrir, sem nenhuma explicacao para o cliente. Seria bom o portal antigo mostrar 'seu acesso foi atualizado, peca o novo link'.
*Benefício:* Evita cliente achando que o escritorio 'sumiu' quando o link velho para de funcionar.  
*Onde:* portal-admin.mjs (criarLink desativa tokens antigos) + portal.html (estado de erro 'Acesso nao encontrado')

**582. Falha em uma das fontes degrada silenciosamente sem sinalizar a equipe**  `impacto medio · esforço medio`
O portal monta a tela a partir de varias fontes (processos, pagamentos, acordo). Se uma falha, aquela secao fica vazia e o cliente nem percebe — mas a equipe tambem nao fica sabendo. Um cliente pode ver 'sem pagamentos' so porque o espelho do Asaas falhou naquele momento.
*Benefício:* Evita o cliente receber informacao incompleta sem ninguem perceber.  
*Onde:* portal-data.mjs (Promise.allSettled, secoes que viram null em caso de erro)

**583. Co-titular (2o contratante) enxerga TODOS os boletos do titular**  `impacto alto · esforço medio`
O portal liga o cliente aos pagamentos pelo CPF, e busca o contrato tanto no 1o quanto no 2o contratante. Quem assina junto (cônjuge, sócio) vê o extrato financeiro completo do outro, mesmo que a cobrança não seja dele.
*Benefício:* Evita expor dados financeiros de uma pessoa para outra (LGPD) e conversas constrangedoras entre familiares/sócios.  
*Onde:* portal-data.mjs (busca de contratos e boletos por cpf_contratante1/2); portal-feedback.mjs e portal-pergunta.mjs (mesma varredura)

**584. Tela de erro não tem botão direto para o WhatsApp do escritório**  `impacto medio · esforço baixo`
Quando o link está inativo ou incompleto, o portal mostra 'fale com o escritório pelo WhatsApp' como texto, mas não carrega o número nem oferece um botão. O cliente fica sem saída clara e pode achar que foi enganado.
*Benefício:* Cliente frustrado vira contato imediato em vez de desistir ou ligar reclamando.  
*Onde:* portal.html (função erroEstado, ~linha 558)

**585. Link desativado ou renovado continua mandando notificações no celular antigo**  `impacto alto · esforço baixo`
Ao desativar ou renovar o link de um cliente, as notificações por push presas ao link antigo não são apagadas. O aparelho que tinha o link velho pode seguir recebendo avisos do caso, mesmo sem acesso.
*Benefício:* Fecha um vazamento de informação e evita avisar quem não deveria mais ter acesso.  
*Onde:* portal-admin.mjs (ações toggle e criarLink — não limpam portal_push_subs do token)

**586. Pesquisa de cada pergunta/NPS varre TODOS os contratos do banco**  `impacto medio · esforço medio`
Cada vez que um cliente envia uma pergunta ou uma avaliação, o sistema baixa a lista de contratantes de todos os contratos ativos para achar o lead no Kommo. Conforme o volume cresce, isso fica lento e custa recursos à toa.
*Benefício:* Resposta mais rápida ao cliente e menos carga no servidor à medida que a base aumenta.  
*Onde:* portal-pergunta.mjs e portal-feedback.mjs (loop sobre todos os contratos para extrair linkKommo)

**587. Pesquisa de satisfação aparece já na primeira visita, antes de qualquer experiência**  `impacto medio · esforço baixo`
O pedido de nota (NPS) surge logo no primeiro acesso, mesmo que o cliente ainda não tenha visto nenhum andamento. Avaliar 'no escuro' gera notas aleatórias e não reflete o serviço.
*Benefício:* Notas mais honestas e úteis; cliente não se sente cobrado a opinar sem motivo.  
*Onde:* portal.html (função montaNps, ~linha 1116 — só checa intervalo de 30 dias, não maturidade do caso)

**588. Cliente não consegue baixar o próprio contrato e procuração pelo portal**  `impacto medio · esforço medio`
O portal mostra o andamento e os pagamentos, mas não oferece o PDF do contrato assinado nem da procuração. O cliente precisa pedir por WhatsApp toda vez que quer uma cópia.
*Benefício:* Menos pedidos manuais à secretaria e mais autonomia/transparência para o cliente.  
*Onde:* portal-data.mjs (poderia expor link do Drive já arquivado) + portal.html (nova seção de documentos)

**589. Histórico do processo trava em 15 movimentações, sem como ver o resto**  `impacto baixo · esforço medio`
O portal traz no máximo 15 andamentos por processo e o botão 'ver mais' só expande o que já veio. Processos antigos têm a história cortada e o cliente nunca alcança os eventos mais velhos.
*Benefício:* Cliente com caso longo vê a trajetória completa, reforçando a sensação de acompanhamento.  
*Onde:* portal-data.mjs (slice(0,15) dos andamentos) + portal.html (botão ver-mais)

**590. Painel não mostra quando o link foi enviado x quando foi aberto pela 1a vez**  `impacto medio · esforço baixo`
A equipe vê 'nunca acessou' ou 'acessado há X dias', mas não sabe há quanto tempo o link existe sem abrir. Não dá para distinguir 'gerado hoje' de 'mandado há 3 semanas e ignorado'.
*Benefício:* Permite priorizar quem realmente está esquecendo o link e medir adesão de verdade.  
*Onde:* PortalClientePanel.jsx (LinksAtivos usa só acessos/ultimo_acesso) + portal-admin.mjs (já tem criado_em, falta usar/exibir)

**591. Resumo em voz fala sempre 'tudo caminhando bem', mesmo em caso parado/crítico**  `impacto baixo · esforço baixo`
O botão 'Ouvir resumo' começa com a frase fixa 'tudo caminhando bem', ignorando se há decisão recente, pendência ou silêncio longo. Em voz, isso pode soar falso justamente quando o cliente está ansioso.
*Benefício:* Mensagem falada coerente com a situação real evita quebra de confiança.  
*Onde:* portal.html (função ouvirResumo, ~linha 977 — frase de abertura hardcoded)

**592. Não há um aviso recorrente leve quando há novidade e o push está desligado**  `impacto medio · esforço medio`
Se o cliente não ativou as notificações, ele só descobre uma novidade abrindo o portal por conta própria. Não existe um lembrete suave (ex.: badge ou mensagem) destacando 'há algo novo desde sua última visita'.
*Benefício:* Cliente sem push ainda percebe que vale a pena reabrir, sem precisar de WhatsApp manual.  
*Onde:* portal.html (montaTudo — comparar última visita salva no aparelho com data do último andamento)

**593. Tradução de andamento jurídico não tem botão 'não entendi / está errado'**  `impacto baixo · esforço medio`
Os andamentos são traduzidos automaticamente para linguagem simples, mas se a tradução sair confusa ou errada o cliente não tem como sinalizar. A equipe nunca fica sabendo das traduções ruins.
*Benefício:* Melhora contínua do glossário com base no que confunde o cliente real.  
*Onde:* portal.html (timeline de eventos) + reaproveitar portal-pergunta.mjs como canal de feedback

**594. Ícone do app instalado fica embaçado (manifest aponta para imagens em tamanho errado)**  `impacto baixo · esforço baixo`
Ao instalar o portal na tela inicial, o manifest declara ícones de 192 e 512 pixels apontando para arquivos que na verdade são 1080x1080. O celular redimensiona na marra e o ícone pode sair desalinhado ou borrado.
*Benefício:* App do cliente com ícone nítido passa imagem mais profissional do escritório.  
*Onde:* portal-manifest.mjs (icons sizes 192/512 referenciam favicon.png/logo-navy.png de 1080px)

**595. Saudação 'Bom dia/Boa noite' usa o relógio do celular, não o fuso do Brasil**  `impacto baixo · esforço baixo`
A saudação no topo é calculada pela hora local do aparelho. Um cliente viajando no exterior, ou com o celular em fuso errado, recebe 'Boa noite' às 10h da manhã, quebrando a sensação de cuidado.
*Benefício:* Detalhe pequeno que mantém o portal sempre coerente e cuidadoso.  
*Onde:* portal.html (montaTudo, ~linha 1262 — new Date().getHours() sem timezone America/Sao_Paulo)


## 20. Bot ADVBOX (WhatsApp)  *(31)*

**596. Pausar o bot quando o cliente pede atendimento humano**  `impacto alto · esforço baixo`
Quando o cliente pede para falar com uma pessoa, o sistema marca a conversa como 'escalada' mas continua respondendo sozinho na proxima mensagem. O atendente humano e o robo acabam falando ao mesmo tempo com o cliente.
*Benefício:* Evita a situacao constrangedora do robo respondendo por cima do advogado/secretaria; o cliente sente que foi realmente atendido por gente.  
*Onde:* botEngine.mjs (handleMessage le conversation.escalated no inicio e pausa por X minutos; campo escalated ja existe mas nunca e lido)

**597. Colocar limite de tempo (timeout) na traducao por IA**  `impacto medio · esforço baixo`
A chamada para a IA traduzir o juridiques nao tem prazo maximo. Se a API da IA travar, a resposta do cliente fica pendurada ate o servidor desistir, e o cliente espera sem receber nada.
*Benefício:* Garante que o cliente sempre recebe uma resposta rapida (com ou sem traducao perfeita), em vez de ficar no vacuo.  
*Onde:* botEngine.mjs (funcao aiTranslate, fetch para api.anthropic.com sem AbortSignal.timeout, ao contrario de advbox.mjs e kommo.mjs que ja tem)

**598. Traduzir os andamentos em paralelo, nao um de cada vez**  `impacto medio · esforço medio`
Quando o glossario nao reconhece os termos, o bot pede a IA para traduzir cada linha do andamento uma de cada vez, em fila. Numa timeline de varias linhas isso soma e deixa a resposta lenta.
*Benefício:* Resposta de andamento chega bem mais rapido para o cliente, especialmente em processos com muito movimento.  
*Onde:* botEngine.mjs (buildLawsuitAnswer faz await dentro do loop de movements; trocar por traducoes em paralelo com Promise.all)

**599. Avisar o admin quando uma regra de glossario (regex) esta quebrada**  `impacto medio · esforço baixo`
No glossario da para escrever uma regra avancada (regex). Se ela tiver um erro de digitacao, o sistema simplesmente ignora em silencio e aquele termo nunca e traduzido — ninguem percebe que a regra parou de funcionar.
*Benefício:* O escritorio descobre na hora que uma regra de traducao esta com defeito, em vez de o cliente receber juridiques por meses sem ninguem saber.  
*Onde:* botEngine.mjs e botApi.js (glossaryTranslate/glossaryTranslateLocal: catch silencioso no new RegExp) + validar a regex ao salvar em BotGlossario.jsx

**600. Tolerar erros de digitacao na deteccao de intencao**  `impacto alto · esforço medio`
O bot so entende o pedido do cliente se a palavra estiver escrita exatamente como cadastrada. 'audiencia' escrito como 'audiencia' (sem acento ja funciona), mas 'audienca' ou 'proceso' caem no 'nao entendi'. Cliente do WhatsApp erra muito a digitacao.
*Benefício:* Menos clientes caindo no fallback ('nao entendi'), menos frustracao e menos necessidade de escalar para humano.  
*Onde:* botEngine.mjs e botApi.js (classifyIntent/classifyIntentLocal usam apenas includes exato; adicionar tolerancia de digitacao tipo distancia de edicao)

**601. Proteger o bot contra repeticao/loop de mensagens do mesmo numero**  `impacto medio · esforço medio`
Se um cliente (ou um problema tecnico) disparar muitas mensagens em poucos segundos, o bot processa todas e consome a cota da API do ADVBOX/IA. Existe protecao contra mensagem duplicada, mas nao contra rajada de mensagens diferentes.
*Benefício:* Protege a cota das APIs e o custo da IA; evita que um numero sozinho derrube o atendimento dos outros clientes.  
*Onde:* advbox-bot-worker-background.mjs (depois do dedup por msgId, somar um limite de N mensagens por telefone por minuto)

**602. Validar o nome do modelo de IA antes de usar**  `impacto baixo · esforço baixo`
O campo do modelo de IA na tela de Config e texto livre. Se alguem digitar errado o nome do modelo, a traducao por IA para de funcionar silenciosamente e ninguem e avisado.
*Benefício:* Evita derrubar a traducao inteligente por um simples erro de digitacao numa caixa de texto.  
*Onde:* BotConfig.jsx (campo ia.modelo como texto livre) + botEngine.mjs (aiTranslate nao registra erro quando o modelo e invalido)

**603. Trocar a chave de acesso fraca do painel do bot**  `impacto alto · esforço baixo`
O painel e o simulador do bot usam uma senha padrao fraca e previsivel ('cbc-bot-2026') embutida no codigo do site. Quem souber dela pode consultar dados de clientes e processos pela API do bot.
*Benefício:* Fecha uma porta de acesso a dados sensiveis de clientes (CPF, processos, financeiro) por uma senha facil de adivinhar.  
*Onde:* botApi.js (default 'cbc-bot-2026') e advbox-bot-reply.mjs (KEY = BOT_PANEL_KEY) — configurar VITE_BOT_PANEL_KEY/BOT_PANEL_KEY fortes no Netlify

**604. Buscar o testador por telefone direto no banco**  `impacto baixo · esforço baixo`
Para saber se um numero e de um testador, o sistema baixa a lista inteira de testadores e compara um por um no codigo. Hoje sao poucos, mas e um jeito ineficiente que piora conforme cresce.
*Benefício:* Resposta mais rapida e menos carga no banco a cada mensagem recebida no WhatsApp.  
*Onde:* botDb.mjs (findTesterByPhone busca todos com select('*') e itera no JS; usar consulta filtrada por telefone)

**605. Confirmar a identidade do cliente antes de mostrar dados sensiveis**  `impacto medio · esforço medio`
Quando o WhatsApp do cliente bate com o cadastro, o bot ja mostra processos e financeiro sem pedir nenhuma confirmacao. Se alguem usar o celular de outra pessoa (familiar, numero reaproveitado), ve dados que nao deveria.
*Benefício:* Reduz risco de vazar dados de processo e cobranca para a pessoa errada; reforca a protecao de dados (LGPD).  
*Onde:* botEngine.mjs (passo 4 identifica por telefone via bot_fone_lookup e ja libera tudo; pedir confirmacao leve, ex. ultimos digitos do CPF, para dados financeiros)

**606. Avisar o cliente que a mensagem foi recebida enquanto o bot consulta**  `impacto baixo · esforço medio`
Como consultar o ADVBOX demora alguns segundos, o cliente fica sem resposta nenhuma ate tudo ficar pronto. No WhatsApp esse silencio passa sensacao de que ninguem viu a mensagem.
*Benefício:* Cliente sente que foi atendido na hora; menos gente repetindo a mensagem por achar que nao chegou.  
*Onde:* advbox-bot-worker-background.mjs (enviar um 'so um instante, ja vou verificar' imediato antes de handleMessage, que pode levar segundos)

**607. Lembrar o atendente humano se ninguem assumir o cliente escalado**  `impacto medio · esforço medio`
Quando o cliente pede atendimento humano, o sistema cria uma tarefa no Kommo, mas nao ha nada que cobre se essa tarefa for esquecida. O cliente pode ficar esperando sem retorno.
*Benefício:* Evita cliente abandonado depois de pedir ajuda — protege a reputacao e a satisfacao do escritorio.  
*Onde:* advbox-bot-worker-background.mjs (escalonamento cria createKommoTask, mas nao ha verificacao posterior; uma rotina poderia checar tarefas de handoff nao concluidas)

**608. Deixar o robo entender numeros do menu mesmo fora de hora**  `impacto baixo · esforço medio`
Os atalhos por numero (1, 2, 3, 4) so funcionam no momento certo. Se o cliente responde '3' depois de um tempo (passou dos 30 minutos da conversa), o bot ja nao sabe a que aquilo se referia e responde estranho.
*Benefício:* Conversa mais natural; o cliente nao precisa adivinhar se ainda esta 'dentro do menu'.  
*Onde:* botEngine.mjs (ATALHO_MENU so vale se !ctx.awaiting; botDb.mjs zera awaiting apos 30min de TTL, deixando numeros soltos sem contexto)

**609. Mostrar no painel quais andamentos cairam na traducao por IA**  `impacto baixo · esforço medio`
Quando o glossario nao reconhece um termo, a IA traduz e guarda em cache. Nao ha uma tela mostrando esses termos novos, que seriam exatamente os que valeria cadastrar no glossario manualmente para ficar mais barato e consistente.
*Benefício:* Melhoria continua do glossario com dados reais; menos dependencia (e custo) da IA ao longo do tempo.  
*Onde:* bot_ai_cache (preenchido por setAiCache em botEngine.mjs) sem tela no painel; criar visao em BotGlossario.jsx ou BotMetricas.jsx

**610. Tratar telefone compartilhado por varios clientes com mais clareza**  `impacto baixo · esforço baixo`
Quando um mesmo telefone aparece para varios clientes (casal, familia), o bot pede o CPF para desambiguar — mas a mensagem nao explica o porque. O cliente pode achar invasivo receber pedido de CPF.
*Benefício:* Cliente entende por que precisa informar o CPF e colabora; menos abandono nessa etapa.  
*Onde:* botEngine.mjs (passo 4: quando idx.length > 1 cai no fluxo de CPF sem mensagem explicativa especifica)

**611. Permitir testar a resposta de audiencia/financeiro no simulador sem cliente real**  `impacto baixo · esforço medio`
O simulador depende de buscar um cliente real do ADVBOX para testar. Para validar so o texto de respostas de audiencia ou financeiro, seria util um modo de teste com dados ficticios, sem mexer em ninguem real.
*Benefício:* Equipe consegue ajustar e revisar os textos do bot com seguranca, sem precisar de um caso real e sem risco de tocar em dados de cliente.  
*Onde:* BotSimulator.jsx + advbox-bot-reply.mjs (action chat sempre consulta ADVBOX ao vivo; adicionar modo mock)

**612. Registrar metrica de quanto a IA esta sendo usada e quanto custa**  `impacto baixo · esforço medio`
A traducao por IA tem custo por uso. Hoje nao ha um numero claro de quantas traducoes por IA acontecem por mes, entao fica dificil saber se vale a pena ou se o cache esta funcionando bem.
*Benefício:* Controle de custo e visibilidade — da para decidir com dados se a IA compensa e ajustar o glossario para reduzir gastos.  
*Onde:* botEngine.mjs (aiTranslate nao contabiliza hits/misses) + BotMetricas.jsx (acrescentar painel de uso da IA)

**613. Avisar o cliente sobre o horario de atendimento ao escalar para humano**  `impacto baixo · esforço baixo`
O bot ja calcula se o retorno sera 'hoje' ou 'no proximo dia util', o que e otimo. Mas vale deixar ainda mais claro o horario comercial real do escritorio na mensagem de escalonamento, para alinhar a expectativa do cliente.
*Benefício:* Cliente fica com a expectativa correta de quando sera atendido; menos cobrancas de 'ninguem me respondeu'.  
*Onde:* botEngine.mjs (funcao fraseRetorno ja existe; enriquecer com o horario comercial configuravel via bot_config)

**614. Bot ficar em silencio depois que o cliente pediu atendente**  `impacto alto · esforço baixo`
Quando o cliente pede para falar com uma pessoa, o sistema marca a conversa como 'escalada', mas o robo NAO le essa marca e continua respondendo todas as mensagens seguintes. Basta verificar essa marca no inicio do processamento e ficar quieto (ou so avisar 'ja chamei a equipe') ate o atendente assumir.
*Benefício:* Evita o robo atrapalhar enquanto o cliente ja esta esperando um humano  
*Onde:* botEngine.mjs (funcao handleMessage le o campo 'escalated' da conversa)

**615. Detectar quando um atendente humano ja respondeu no WhatsApp**  `impacto alto · esforço medio`
Hoje o robo so ignora mensagens marcadas como 'saida'. Se um atendente entra na conversa pelo Kommo e responde, o robo nao percebe e pode responder por cima, criando confusao de duas vozes. Da para checar se houve resposta humana recente no lead antes de o robo falar e, nesse caso, ficar em silencio por um tempo.
*Benefício:* Impede o robo de competir com o atendente na mesma conversa  
*Onde:* advbox-bot-worker-background.mjs (antes de responder, checar ultima mensagem humana no Kommo)

**616. Proteger dados financeiros e processos no Simulador do painel**  `impacto alto · esforço medio`
O simulador deixa qualquer usuario com a chave do painel buscar QUALQUER cliente por nome/CPF e ver o extrato financeiro completo (parcelas, valores pagos, atrasos) e os processos dele. Isso e dado sensivel (LGPD). Vale restringir o extrato financeiro a admins ou registrar quem consultou o que, criando uma trilha de auditoria.
*Benefício:* Reduz risco de vazamento de dados pessoais e atende a LGPD  
*Onde:* advbox-bot-reply.mjs + botEngine.mjs (respostaFinanceira/getExtrato)

**617. Nao mostrar audiencias que ja passaram**  `impacto medio · esforço baixo`
Quando o cliente pergunta sobre audiencia, o robo lista qualquer compromisso do tipo audiencia/pericia que esteja em aberto no sistema, SEM checar se a data ja passou. Pode acabar dizendo 'voce tem audiencia em [data passada]'. Basta filtrar para mostrar so datas de hoje em diante.
*Benefício:* Evita informacao errada que confunde e assusta o cliente  
*Onde:* botEngine.mjs (funcao buildAudienciaAnswer, filtro de data futura)

**618. Esconder tarefas internas tambem na resposta de audiencia**  `impacto medio · esforço baixo`
A configuracao de 'ocultar do cliente' (que voce usa para nao mostrar tarefas tecnicas internas) e aplicada na resposta de andamento, mas a resposta de audiencia NAO usa esse filtro. Uma tarefa interna marcada como audiencia poderia escapar e ir para o cliente. Aplicar o mesmo filtro de visibilidade ali fecha essa brecha.
*Benefício:* Mantem a regra de privacidade consistente em todas as respostas  
*Onde:* botEngine.mjs (buildAudienciaAnswer deve usar getVisibilityConfig/isHiddenFromClient)

**619. Usar a despedida que voce ja configurou**  `impacto baixo · esforço baixo`
Existe um campo de configuracao 'Despedida' editavel no painel, mas o robo nunca o usa: quando o cliente diz 'obrigado' ou 'tchau', cai no 'nao entendi'. Reconhecer essas palavras e responder com a despedida deixa a conversa mais natural e fecha bem o atendimento.
*Benefício:* Conversa termina educadamente em vez de um 'nao entendi' frio  
*Onde:* botEngine.mjs (handleMessage) + campo 'despedida' do BotConfig.jsx

**620. Saudacao nao deve aparecer no meio da conversa**  `impacto baixo · esforço baixo`
O robo trata 'oi', 'bom dia' etc. e responde a saudacao completa mesmo no meio de uma conversa ja em andamento. Se o cliente escreve 'oi, quando e minha audiencia?' ele pode receber a saudacao em vez da resposta. Reconhecer a saudacao apenas como abertura (e seguir para a pergunta real, se houver) deixa o dialogo mais fluido.
*Benefício:* Evita repetir saudacao e ignorar a pergunta real do cliente  
*Onde:* botEngine.mjs (regra de saudacao no fim de handleMessage)

**621. Versionar o cache de traducao por IA**  `impacto medio · esforço baixo`
As traducoes feitas pela IA ficam guardadas so pelo texto original. Se voce trocar o modelo ou melhorar a instrucao de traducao, o robo continua devolvendo a traducao antiga e errada do cache, sem como invalidar. Incluir o modelo/versao da instrucao na chave do cache faz traducoes novas substituirem as velhas automaticamente.
*Benefício:* Permite corrigir/melhorar traducoes sem ficar preso a versoes antigas  
*Onde:* botEngine.mjs (hashText do aiTranslate) + bot_ai_cache (botDb.mjs)

**622. Validar a regra de glossario (regex) ao salvar no painel**  `impacto medio · esforço baixo`
No painel do glossario da para escolher o tipo 'regex' (uma formula de busca avancada). Se a formula tiver erro de digitacao, o robo simplesmente ignora aquele termo em silencio na hora de traduzir e o atendente nunca fica sabendo. Testar a formula no momento de salvar e avisar 'formula invalida' evita criar regras que nunca funcionam.
*Benefício:* Impede regras de traducao quebradas que falham caladas  
*Onde:* BotGlossario.jsx (validar match_type='regex' antes de salvar)

**623. Limitar o tamanho da mensagem antes de processar**  `impacto baixo · esforço baixo`
O texto que chega do WhatsApp e classificado e, se nao casar, mandado inteiro para a IA traduzir. Uma mensagem enorme (cliente colando um documento) gasta tempo e dinheiro de IA atoa e pode estourar o tempo limite. Cortar o texto num tamanho razoavel antes de processar protege custo e velocidade.
*Benefício:* Evita custo de IA e lentidao com mensagens gigantes  
*Onde:* botEngine.mjs (handleMessage, antes de classifyIntent/translateMovement)

**624. Sair do 'nao entendi' em loop chamando um humano**  `impacto medio · esforço medio`
Se o cliente faz a mesma pergunta de um jeito que o robo nao entende, ele recebe 'nao entendi, reformule' indefinidamente e pode ficar frustrado sem saida. Apos 2 ou 3 'nao entendi' seguidos, o robo deveria oferecer falar com um atendente automaticamente.
*Benefício:* Cliente nao fica preso conversando com um robo que nao ajuda  
*Onde:* botEngine.mjs (contar fallbacks consecutivos no contexto da conversa)

**625. Limpar a tabela de mensagens ja processadas**  `impacto baixo · esforço baixo`
Para nao responder duas vezes a mesma mensagem, o sistema guarda o ID de cada mensagem ja tratada numa tabela. Essa tabela so cresce e nunca e limpa; com o tempo fica enorme e pesa no banco. Apagar registros com mais de alguns dias (um robo de limpeza simples) resolve, ja que duplicatas so chegam em segundos.
*Benefício:* Evita a tabela crescer para sempre e pesar no banco  
*Onde:* bot_processed_messages (gravado em advbox-bot-worker-background.mjs); adicionar limpeza periodica

**626. Busca de testador por telefone mais segura e direta**  `impacto medio · esforço medio`
Para achar o testador pelo telefone, o sistema carrega TODOS os testadores e compara um por um em codigo, aceitando ate quando um numero 'termina com' o outro. Isso pode casar o telefone errado (ex.: numeros que terminam igual) e nao escala. Uma busca direta e exata no banco por variacoes do numero e mais segura e rapida.
*Benefício:* Reduz risco de identificar o testador errado pelo telefone  
*Onde:* botDb.mjs (funcao findTesterByPhone) + tabela bot_testers


## 21. Comissoes & Vendas  *(38)*

**627. Corrigir o que conta como 'Elegivel' na tela da vendedora (bate com o pagamento real)**  `impacto alto · esforço baixo`
Na tela Minhas Vendas, um contrato vira 'Elegivel' quando tem peticao distribuida + guia paga. Mas o calculo oficial mensal so paga se a guia tambem estiver marcada como 'juntada'. Resultado: a vendedora ve contratos como 'vai pagar' que no fim do mes nao entram, gerando reclamacao.
*Benefício:* A previsao na tela passa a refletir o que sera realmente pago, evitando frustracao e discussao sobre comissao.  
*Onde:* client/src/components/VendasPanel.jsx (comissaoPrevia, PlanilhaRow.comissaoStatus e ContractDrawer.commStatus — todos so checam guia.paga_em)

**628. Fazer a 'comissao prevista' usar a mesma conta do calculo oficial**  `impacto alto · esforço medio`
A barra 'Minha comissao prevista do mes' usa uma formula simplificada e diferente da function que fecha a comissao de verdade. Ela soma iniciais+exito para todo contrato (mesmo os que so tem um), usa uma unica faixa em vez das faixas acumuladas, e aplica o desconto de split tambem sobre o bonus. Os numeros nunca vao bater com o contracheque.
*Benefício:* A vendedora confia no numero da tela porque ele e igual ao que vai receber.  
*Onde:* client/src/components/VendasPanel.jsx (useMemo comissaoPrevia) vs client/netlify/functions/commission-calculator.mjs (calculateDupla)

**629. Mostrar na tela a comissao OFICIAL ja calculada, nao so a previsao**  `impacto alto · esforço medio`
Existe uma tabela com a comissao fechada do mes (vendas_comissoes_mensais) e ate uma funcao pronta para le-la (loadComissaoCalculada), mas a tela nunca mostra esse numero — so a previsao chutada. A vendedora nao consegue ver o valor consolidado do mes anterior.
*Benefício:* Vendedora e socios veem o valor oficial fechado (com detalhamento por contrato), sem depender de planilha externa.  
*Onde:* client/src/utils/commissionClient.js (helpers ja existem, sem uso) + nova secao em VendasPanel.jsx

**630. Confirmar se o bonus de R$ 1.000 e mesmo dobrado (paga cheio para vendedora E assistente)**  `impacto alto · esforço baixo`
No calculo oficial, ao bater a meta de contratos o bonus de R$ 1.000 e somado INTEIRO para a vendedora e mais R$ 1.000 INTEIRO para a assistente — ou seja, o escritorio paga R$ 2.000 por dupla. Pode ser intencional, mas precisa ser confirmado porque dobra o custo do bonus.
*Benefício:* Evita pagar o dobro do bonus por engano (ou documenta que e proposital).  
*Onde:* client/netlify/functions/commission-calculator.mjs (valorVendedora/valorAssistente somam bonusUnit cheio para cada um)

**631. Criar o botao 'Marcar comissao como paga' (o status existe mas nao tem tela)**  `impacto medio · esforço medio`
A tabela de comissoes ja tem os campos status ('calculada','paga','revisao'), paga_em e paga_por, mas nao ha nenhuma tela para o Paulo marcar uma comissao como paga ou em revisao. Hoje nao da pra saber pelo sistema quem ja foi pago.
*Benefício:* Controle de quem ja recebeu a comissao do mes, direto no sistema, sem planilha paralela.  
*Onde:* vendas_comissoes_mensais (campos status/paga_em/paga_por ja existem) — falta UI, provavelmente no painel dos Socios ou em Parametrizacao

**632. Corrigir o SQL oficial: a coluna do lead rapido mudou de 'chatguru_link' para 'kommo_link'**  `impacto medio · esforço baixo`
O codigo grava e le o campo 'kommo_link' nos leads rapidos, mas o arquivo SQL oficial ainda cria a coluna antiga 'chatguru_link'. Em producao funciona (deve ter sido ajustado a mao), mas se alguem recriar o banco a partir do SQL, o botao 'Novo Lead' quebra. A documentacao do banco esta defasada.
*Benefício:* Evita uma quebra silenciosa numa eventual reinstalacao/migracao e mantem o SQL como fonte confiavel.  
*Onde:* supabase_vendas_comissoes.sql (PARTE 14, coluna chatguru_link) vs client/src/components/VendasPanel.jsx (kommo_link)

**633. Recalcular comissao com 1 clique e baixar o detalhamento em Excel**  `impacto medio · esforço medio`
Hoje, recalcular a comissao de um periodo so e possivel chamando a funcao por fora (URL). Nao ha botao para o admin disparar o recalculo de um mes especifico nem exportar o detalhamento contrato a contrato (que ja e gravado em vendas_comissoes_detalhe).
*Benefício:* Paulo fecha e confere a folha de comissao do mes sozinho, com o detalhe por contrato para auditar.  
*Onde:* client/src/utils/commissionClient.js (recalcComissao/loadComissaoDetalhes prontos) — falta botao em VendasParametrizacaoPanel.jsx (ComissaoTab)

**634. Avisar quando a coluna do kanban for sobrescrita pela sincronizacao do ADVBOX**  `impacto baixo · esforço medio`
Quando a pessoa arrasta um cartao de coluna manualmente, o aviso diz que a sincronizacao noturna do ADVBOX vai sobrescrever. Mas isso confunde: o movimento manual parece 'nao colar'. Seria melhor o cartao mostrar de onde veio o status (manual x ADVBOX) ou travar o arrasto para contratos que ja seguem o ADVBOX.
*Benefício:* A vendedora entende por que o cartao 'volta' e para de tentar mover manualmente o que o ADVBOX controla.  
*Onde:* client/src/components/VendasPanel.jsx (handleMoveColuna) + client/netlify/functions/advbox-vendas-sync.mjs

**635. Trocar o upload de documentos guardado dentro do banco por armazenamento de arquivos**  `impacto medio · esforço alto`
Os documentos do cliente (RG, comprovantes etc.) sao salvos como texto gigante dentro do proprio banco de dados (base64), com limite de 5MB e um aviso 'TODO' no codigo. Isso incha o banco, deixa as consultas lentas e e fragil. O proprio codigo ja marca que deveria usar o Supabase Storage.
*Benefício:* Banco mais leve e rapido, uploads maiores e mais confiaveis, e download direto dos arquivos.  
*Onde:* client/src/components/VendasPanel.jsx (DocUploadButton, comentario TODO(storage)) gravando em vendas_documentos_enviados.arquivo_url

**636. Mostrar na planilha quais documentos faltam (hoje a coluna 'Docs' fica sempre vazia)**  `impacto medio · esforço medio`
Na planilha de vendas existe uma coluna 'Docs', mas ela sempre mostra um traco — o calculo real so acontece quando voce abre o drawer lateral. A vendedora nao consegue ver rapidamente quem esta com documentacao pendente direto na lista.
*Benefício:* Identificacao imediata de contratos travados por falta de documento, sem abrir um por um.  
*Onde:* client/src/components/VendasPanel.jsx (PlanilhaRow: docsLabel = '—' fixo)

**637. Calcular a previsao de comissao usando a data certa (assinatura, nao a de criacao)**  `impacto medio · esforço baixo`
Na previsao da tela, quando o contrato ainda nao tem data de assinatura, o sistema usa a data de criacao para decidir se ele cai no mes. Como a comissao depende da assinatura, isso pode colocar contratos no periodo errado. O calculo oficial ja usa so a data de assinatura.
*Benefício:* Os contratos aparecem no mes correto da comissao, alinhado com o calculo oficial.  
*Onde:* client/src/components/VendasPanel.jsx (comissaoPrevia e contratosFiltrados usam c.signed_at || c.created_at)

**638. Acabar com a inconsistencia das pastas fixas (Bruno 1, Bruno 2, Paulo 2)**  `impacto baixo · esforço medio`
As 'pastas' de processo estao escritas direto no codigo (apenas tres opcoes fixas) e tambem travadas no banco. Se o escritorio criar uma pasta nova ou outro advogado, e preciso mexer no codigo e no banco. Deveria ser configuravel na Parametrizacao, como as outras listas.
*Benefício:* Adicionar/remover pastas vira tarefa de configuracao, sem precisar de programador.  
*Onde:* client/src/components/VendasPanel.jsx (const PASTAS) + supabase_vendas_comissoes.sql (CHECK pasta IN ...)

**639. Mostrar progresso da meta tambem para a propria vendedora (hoje so o admin ve)**  `impacto medio · esforço medio`
A barra de '% atingido' da meta so existe na tela de Parametrizacao, visivel ao admin. A vendedora, na sua aba Minhas Vendas, nao ve quanto falta para bater a meta do mes nem o quanto ja realizou.
*Benefício:* Motiva a equipe mostrando o quanto falta para a meta e o bonus, direto na tela dela.  
*Onde:* client/src/components/VendasParametrizacaoPanel.jsx (MetasTab tem o dado) — replicar resumo em VendasPanel.jsx

**640. Avisar/alertar promocoes que vao expirar e mostrar o impacto delas**  `impacto baixo · esforço medio`
As promocoes sazonais ja mostram 'faltam X dias', mas nao ha aviso ativo quando uma promocao esta acabando, nem um resumo de quantos contratos cada promocao ja beneficiou. O Paulo so descobre o impacto manualmente.
*Benefício:* Decisao melhor sobre renovar ou encerrar promocoes, com base em quantos contratos ela rendeu.  
*Onde:* client/src/components/VendasParametrizacaoPanel.jsx (PromocoesTab) + cruzamento com contratos.promocao_sazonal_id

**641. Validar as faixas de comissao ao salvar (evitar buracos ou sobreposicoes)**  `impacto medio · esforço baixo`
No editor de faixas (ex.: 1-20, 21-40...), nada impede o admin de salvar faixas com buraco (ex.: pular de 20 direto para 41) ou sobrepostas. Se houver buraco, contratos naquela quantidade ficam com valor zero sem ninguem perceber.
*Benefício:* Impede configuracao errada que zeraria a comissao de algumas faixas silenciosamente.  
*Onde:* client/src/components/VendasParametrizacaoPanel.jsx (FaixasEditor / handleSave da ComissaoTab)

**642. Tratar contratos sem vendedora definida (nao somem da comissao em silencio)**  `impacto alto · esforço medio`
A comissao agrupa os contratos pelo campo 'vendedora_email' exato. Se esse campo estiver vazio ou com um e-mail escrito diferente (maiuscula/minuscula), o contrato simplesmente nao entra em nenhuma comissao e ninguem e avisado.
*Benefício:* Nenhum contrato assinado fica de fora da comissao por causa de e-mail vazio ou digitado diferente.  
*Onde:* client/netlify/functions/commission-calculator.mjs (loadDadosPeriodo agrupa por vendedora_email exato, sem normalizar nem reportar orfaos)

**643. Padronizar a regra do periodo do dia 20 (front e back calculam de jeitos diferentes)**  `impacto medio · esforço medio`
A definicao do periodo mensal (que comeca dia 20) e recalculada em pelo menos quatro lugares diferentes, cada um com seu codigo: a tela de vendas, a de metas, o helper do cliente e a function oficial. Pequenas diferencas (fuso horario, dia de virada) podem fazer um contrato cair em meses diferentes dependendo da tela.
*Benefício:* Mesma resposta em todas as telas sobre 'a qual mes esse contrato pertence', sem divergencia.  
*Onde:* getPeriodoMes (VendasPanel.jsx), periodo (MetasTab), getCurrentPeriodoInicio (commissionClient.js), getPeriodFromMonth (commission-calculator.mjs)

**644. Fechar a seguranca das tabelas de comissao (hoje qualquer usuario logado ve tudo)**  `impacto alto · esforço alto`
As regras de acesso das tabelas de vendas/comissao liberam para qualquer usuario autenticado ler e escrever tudo. Na pratica, uma assistente poderia ler a comissao de outra dupla, ou ate alterar as regras globais de comissao. Dados sensiveis de remuneracao deveriam ser restritos.
*Benefício:* Protege valores de comissao e regras (so a propria dupla e admins veem/editam o que e seu).  
*Onde:* supabase_vendas_comissoes.sql (PARTE 15 — policies 'auth_all' FOR ALL para authenticated em todas as tabelas vendas_*)

**645. Marcar o lead rapido como convertido quando vira contrato**  `impacto baixo · esforço medio`
Quando a vendedora clica em 'Gerar contrato' a partir de um lead rapido, o sistema abre o formulario, mas nao registra que aquele lead virou contrato (o campo convertido_contrato_id fica vazio). O lead pode continuar aparecendo como pendente e gerar contagem duplicada.
*Benefício:* Evita lead 'fantasma' na coluna Novo Lead e permite medir taxa de conversao de lead em contrato.  
*Onde:* client/src/components/VendasPanel.jsx (NovoLeadCard/LeadRapidoCard handleConvert/handleGerarContrato; campo convertido_contrato_id nunca preenchido)

**646. Permitir a assistente ver as vendas mesmo sem a parceira configurada**  `impacto baixo · esforço baixo`
A aba so carrega contratos da assistente se ela tiver uma 'vendedora parceira' definida em user_permissions. Se esse vinculo estiver faltando, a tela fica vazia sem explicar direito o motivo. Falta um aviso claro de 'peca ao Paulo para vincular sua dupla'.
*Benefício:* Menos chamados de 'minha tela esta vazia' e diagnostico claro de configuracao faltando.  
*Onde:* client/src/components/VendasPanel.jsx (vendedoraEmail para assistente depende de userPerms.vendedora_parceira_email)

**647. Limpar o cache da lista de vendas ao trocar de vendedora (modo admin)**  `impacto baixo · esforço baixo`
A lista de vendas guarda um cache na memoria para reaparecer rapido ao voltar para a aba. No modo admin, ao trocar 'ver como' de uma vendedora para outra, esse cache pode mostrar por um instante os contratos da vendedora anterior antes de atualizar.
*Benefício:* Evita exibir dados da pessoa errada por alguns segundos no modo admin (privacidade e confusao).  
*Onde:* client/src/components/VendasPanel.jsx (_cachedVendasContratos global compartilhado entre filtros)

**648. Lembrete automatico de guia paga mas ainda nao juntada**  `impacto medio · esforço medio`
Um contrato so vira comissao quando a guia e marcada como 'juntada'. Hoje, se a vendedora paga a guia mas esquece de marcar a juntada, a comissao simplesmente nao sai e ninguem e avisado. Um lembrete (badge/alerta) de 'guia paga ha X dias, falta juntar' resolveria.
*Benefício:* Garante que comissoes ja conquistadas nao sejam perdidas por esquecimento de marcar a juntada.  
*Onde:* client/src/components/VendasPanel.jsx (ContractDrawer guia: paga_em preenchido + juntada_em vazio) — virar alerta na lista

**649. Exportar o Excel respeitando a privacidade e com a comissao oficial por linha**  `impacto baixo · esforço baixo`
O botao Export gera uma planilha com telefone e link do cliente, mas nao traz o valor de comissao calculado oficialmente por contrato. Alem disso, no modo admin 'visao consolidada' a planilha mistura todas as vendedoras sem coluna de quem vendeu.
*Benefício:* Planilha mais util para conferencia da folha de comissao e com a coluna de vendedora no modo consolidado.  
*Onde:* client/src/components/VendasPanel.jsx (handleExport — nao inclui vendedora_email nem valor de comissao por contrato)

**650. Mostrar o impacto da promocao no preview da comissao**  `impacto medio · esforço medio`
A tela de teste da comissao (Parametrizacao > Comissao) so simula contratos normais e de fim de semana. Promocoes do tipo 'valor fixo extra' ou 'multiplicador' nao aparecem na simulacao, entao o admin nao consegue ver quanto uma promocao realmente custa ou rende antes de ativar.
*Benefício:* Decidir promocoes com o numero na frente, sem surpresa no fechamento do mes.  
*Onde:* VendasParametrizacaoPanel.jsx (ComissaoTab, bloco Preview ~linha 893-1075)

**651. Validar as datas da promocao (fim depois do inicio) ao salvar**  `impacto medio · esforço baixo`
Ao cadastrar uma promocao, da pra colocar uma data de fim ANTES da data de inicio sem nenhum aviso. Uma promocao assim nunca pega contrato nenhum e fica 'morta' na lista sem ninguem perceber.
*Benefício:* Evita promocao quebrada que parece ativa mas nunca se aplica.  
*Onde:* VendasParametrizacaoPanel.jsx (PromocoesTab.handleSave ~linha 1199)

**652. Avisar quando duas promocoes valem para o mesmo contrato**  `impacto medio · esforço medio`
O calculo aplica a PRIMEIRA promocao que casar com o contrato (resort/tipo/data) e ignora as outras silenciosamente. Se duas promocoes pegarem o mesmo periodo e resort, ninguem sabe qual venceu. Falta um aviso de sobreposicao no cadastro.
*Benefício:* Transparencia sobre qual promocao foi efetivamente paga.  
*Onde:* commission-calculator.mjs (isPromocaoAplicavel + promos.find ~linha 182,272)

**653. Guardar historico de quem mudou as regras de comissao**  `impacto alto · esforço medio`
As faixas, o split 70/30 e o bonus sao salvos por cima da configuracao anterior (id=1) sem guardar quem mudou nem o valor antigo. Sendo dinheiro de comissao, qualquer alteracao (intencional ou erro) fica sem rastro para conferencia depois.
*Benefício:* Auditoria do que mudou na regra de pagamento e quando.  
*Onde:* VendasParametrizacaoPanel.jsx (ComissaoTab.handleSave, upsert id=1 ~linha 877)

**654. Validar as faixas novas que o botao 'Faixa' cria**  `impacto alto · esforço medio`
O botao 'Adicionar faixa' chuta automaticamente um intervalo (ex: 41 a 60) baseado so na ultima linha. Se o admin mexer nos numeros, da pra deixar buracos (ex: faixa termina em 40 e a proxima comeca em 45) ou faixas que se cruzam, e o calculo simplesmente nao acha valor para os contratos no buraco.
*Benefício:* Evita contrato 'sem faixa' que entra com comissao zero.  
*Onde:* VendasParametrizacaoPanel.jsx (FaixasEditor.add/update ~linha 1100-1158)

**655. Mostrar a matriz de Expectativa de Honorarios alem dos 40 resorts**  `impacto medio · esforço baixo`
A matriz de expectativa corta a lista em 40 resorts (resorts.slice(0,40)) para nao ficar gigante. Resorts depois do 40 simplesmente nao aparecem para preencher, sem nenhum aviso. O escritorio tem ~99 resorts, entao muitos ficam de fora.
*Benefício:* Permite parametrizar todos os resorts, nao so os primeiros.  
*Onde:* VendasParametrizacaoPanel.jsx (ExpectativaTab, resortsAtivos ~linha 1822)

**656. Preencher a Expectativa de Honorarios com dados reais ja assinados**  `impacto medio · esforço alto`
Hoje os valores medios, percentual e tempo da matriz sao digitados na mao, um por um. O sistema ja tem os contratos assinados com honorarios e datas; daria pra sugerir automaticamente a media real por resort+tipo como ponto de partida, em vez de planilha em branco.
*Benefício:* Expectativa baseada no historico real, com menos digitacao.  
*Onde:* VendasParametrizacaoPanel.jsx (ExpectativaTab.load ~linha 1755) + tabela contratos

**657. Definir e acompanhar meta tambem da dupla (vendedora + assistente)**  `impacto medio · esforço medio`
As metas so existem para vendedoras. O assistente, que recebe 30%, nao tem meta nem barra de progresso propria em lugar nenhum. A dupla trabalha junto mas so metade dela enxerga objetivo.
*Benefício:* Assistente passa a ter alvo claro e motivacao visivel.  
*Onde:* VendasParametrizacaoPanel.jsx (MetasTab, filtro perfil_vendas='vendedora' ~linha 1506)

**658. Parar de importar leads da tabela antiga de Meta Ads**  `impacto baixo · esforço medio`
O botao 'Importar lead existente' ainda le a tabela 'leads' (antiga integracao Meta Ads/Make), que o proprio codigo marca como legado e pode ser apagada a qualquer momento. Quando isso acontecer, o botao mostra lista vazia sem explicar. Hoje os leads chegam pelo Kommo.
*Benefício:* Tira fonte morta e confusa do fluxo de novo lead.  
*Onde:* VendasPanel.jsx (ImportLeadModal, supabase.from('leads') ~linha 1789-1806)

**659. Evitar lead rapido duplicado (mesmo telefone/cliente)**  `impacto baixo · esforço baixo`
Ao criar uma ficha rapida de lead ou importar um lead, nao ha conferencia se ja existe um lead rapido ou contrato com o mesmo telefone. Da pra cadastrar o mesmo cliente varias vezes na coluna 'Novo Lead', poluindo o kanban e a contagem.
*Benefício:* Kanban limpo, sem o mesmo cliente repetido.  
*Onde:* VendasPanel.jsx (NovoLeadCard.handleSaveFichaRapida + ImportLeadModal.handleImport ~linha 1635,1808)

**660. Avisar quantos requisitos serao apagados ao excluir um tipo de documento**  `impacto baixo · esforço baixo`
Ao deletar um tipo de documento do catalogo, o aviso diz que 'requisitos que o usam serao apagados tambem' mas nao mostra QUANTOS nem de quais combinacoes resort+tipo. O admin pode apagar sem saber o estrago. Mostrar a contagem antes de confirmar.
*Benefício:* Decisao consciente antes de apagar regras de documento.  
*Onde:* VendasParametrizacaoPanel.jsx (CatalogoDocumentosModal.handleDelete ~linha 627)

**661. Conectar o valor da guia de custas ao boleto/cobranca do cliente**  `impacto medio · esforço alto`
A guia de custas hoje tem valor digitado e datas (emitida/paga/juntada) controladas na mao no drawer. Nao ha ligacao com o Asaas, onde o cliente efetivamente paga. Marcar 'paga' depende de alguem lembrar de marcar, e a comissao so libera com isso. Da pra puxar a confirmacao de pagamento de forma mais automatica.
*Benefício:* Comissao destrava sozinha quando o cliente realmente paga.  
*Onde:* VendasPanel.jsx (GuiaForm + secao Guia ~linha 2088-2196), integracao Asaas

**662. Padronizar a data usada nos filtros (assinatura, nao 'assinatura ou criacao')**  `impacto medio · esforço baixo`
O filtro de mes da planilha de vendas usa 'data de assinatura, ou se nao tiver, a data de criacao' como referencia. Ja o calculo oficial e as metas usam so a data de assinatura. Isso faz contratos aparecerem em meses diferentes dependendo da tela, confundindo a conferencia.
*Benefício:* Mesmo contrato cai sempre no mesmo mes em todas as telas.  
*Onde:* VendasPanel.jsx (contratosFiltrados, ref = signed_at || created_at ~linha 433)

**663. Deixar a barra de comissao prevista funcionar para o assistente sozinho**  `impacto baixo · esforço baixo`
A barra superior 'Minha comissao prevista' aplica o split de 30% se o usuario for assistente, mas o assistente so ve dados se a parceira (vendedora) estiver configurada. Sem isso, a barra fica zerada sem explicar. Vale um aviso claro de 'configure sua dupla' em vez de R$ 0,00 silencioso.
*Benefício:* Assistente entende por que nao ve numero, em vez de achar que zerou.  
*Onde:* VendasPanel.jsx (comissaoPrevia / vendedoraEmail do assistente ~linha 270-276,477)

**664. Mostrar para a vendedora quanto falta para cada faixa e para o bonus de 100**  `impacto medio · esforço medio`
A vendedora ve a comissao prevista, mas nao ve que esta a poucos contratos de pular para a faixa melhor (ex: de R$ 100 para R$ 110 por contrato no contrato 41) ou perto do bonus de R$ 1.000 (threshold 100). Um aviso de 'faltam X contratos para subir de faixa' incentiva a fechar mais no mes.
*Benefício:* Estimula a vendedora a buscar o proximo degrau de ganho.  
*Onde:* VendasPanel.jsx (barra comissaoPrevia ~linha 815-850), faixas de regras


## 22. Notificacoes & Alertas  *(28)*

**665. Sino so mostra lembretes — avisar tambem assinaturas, mencoes e erros**  `impacto alto · esforço medio`
Hoje o sininho de notificacoes (o icone no topo) so recebe lembretes pessoais. Quando um contrato e assinado, alguem te marca num comentario com @, ou uma automacao do ADVBOX/Drive falha, nada aparece no sino — esses eventos passam batido ou somem num banner rapido. A tela de Preferencias ate lista esses eventos, mas eles nunca chegam ao sino.
*Benefício:* A equipe deixa de perder avisos importantes; tudo fica num lugar so e com historico.  
*Onde:* client/src/hooks/useNotifications.js + criar gravacao na tabela 'notifications' a partir de App.jsx (assinatura), ContractComments.jsx (mencao) e advbox-sync (erro)

**666. @mencao em comentario nao avisa ninguem**  `impacto alto · esforço medio`
Quando um colega escreve '@fulano@email' num comentario do contrato, o sistema guarda a marcacao mas nao envia aviso nenhum para a pessoa mencionada. Ela so descobre se abrir aquele contrato por acaso.
*Benefício:* Conversas internas viram acao de verdade; ninguem fica esperando resposta que nunca chega.  
*Onde:* client/src/components/contratos/ContractComments.jsx (handleSubmit) — criar notificacao para cada email mencionado

**667. Preferencias de notificacao nao funcionam de verdade**  `impacto medio · esforço medio`
A janelinha de 'Preferencias de notificacao' deixa o usuario marcar quais eventos quer receber, mas essas escolhas sao salvas e nunca consultadas por nada. Ou seja, marcar/desmarcar nao muda absolutamente nada hoje. Os canais E-mail e Push aparecem como '(em breve)' ha tempos.
*Benefício:* Cada pessoa recebe so o que importa pra ela, sem ruido; a tela passa a cumprir o que promete.  
*Onde:* client/src/components/NotificationPrefsModal.jsx + ler 'user_notification_prefs' antes de gravar em 'notifications'

**668. Nao existe lista para ver ou cancelar lembretes agendados**  `impacto medio · esforço medio`
Quando voce cria um lembrete ('me lembrar amanha 9h de tal contrato'), ele e salvo, mas nao ha nenhuma tela para ver os lembretes pendentes, editar ou cancelar. Se errou a data ou nao quer mais, fica preso — vai disparar de qualquer jeito.
*Benefício:* Controle real sobre os proprios lembretes; evita avisos errados ou indesejados.  
*Onde:* client/src/components/ReminderModal.jsx (so insere) — criar uma listagem/edicao de 'user_reminders'

**669. Aniversario de cliente nao gera nenhum aviso**  `impacto medio · esforço medio`
O sistema ja guarda a data de nascimento de cada cliente, mas nao faz nada com isso. Um aviso automatico no dia (ou na vespera) do aniversario permitiria um contato simpatico — algo que fideliza e abre porta para novos servicos, especialmente num escritorio com muitos clientes.
*Benefício:* Relacionamento mais proximo com o cliente a custo quase zero; oportunidade comercial.  
*Onde:* Novo cron (estilo reminder-cron.mjs) lendo data de nascimento de bi_clientes/contratos.dados.contratantes -> notificacao + nota Kommo

**670. Sem alerta de prazo processual / vencimento de etapa**  `impacto alto · esforço alto`
O sistema acompanha as fases do processo (DataJud + ADVBOX) e avisa o CLIENTE no Kommo, mas nao gera nenhum alerta interno do tipo 'esse processo esta parado ha X dias' ou 'prazo se aproximando'. A equipe juridica nao tem um radar de prazos dentro do proprio sistema.
*Benefício:* Reduz risco de perder prazo (que em advocacia e gravissimo); equipe age antes de virar problema.  
*Onde:* netlify/functions/datajud-refresh.mjs e dados de bi_processos -> regras de prazo + notificacao interna

**671. Inadimplencia nao dispara aviso — so aparece se alguem abrir a aba**  `impacto alto · esforço medio`
Os cartoes de inadimplencia (clientes em atraso, total em aberto, maior atraso) so aparecem para quem abre a aba Boletos. Nao ha um aviso ativo quando a inadimplencia sobe muito, quando um cliente novo entra em atraso, ou quando alguem passa de 30/60/90 dias. A informacao existe mas e passiva.
*Benefício:* Cobranca mais rapida = mais dinheiro recuperado; problema e visto cedo.  
*Onde:* client/src/components/InadimplenciaStrip.jsx (so exibe) + cron usando inadimplencia_historico -> notificacao quando cruzar limites

**672. Banner de assinatura some e nao deixa rastro**  `impacto medio · esforço baixo`
Quando um contrato e assinado, aparece um banner comemorativo no canto, mas ele e temporario e fica so na memoria do navegador de quem esta com o sistema aberto naquele instante. Quem nao estava online perde o aviso, e nao ha registro permanente no sino.
*Benefício:* Ninguem perde a noticia de uma assinatura, mesmo chegando depois.  
*Onde:* client/src/App.jsx (realtime 'contratos-status', setNotifications em memoria) -> tambem gravar em 'notifications'

**673. Nenhum canal de e-mail ou WhatsApp para avisos da equipe**  `impacto alto · esforço alto`
Todos os avisos internos vivem dentro do sistema (e mal). Se a pessoa nao esta com o site aberto, nao fica sabendo de nada. Um e-mail ou WhatsApp para casos criticos (erro de automacao, contrato assinado, prazo) garantiria que o aviso chega mesmo fora do sistema. Hoje nao existe nenhum envio de e-mail no projeto.
*Benefício:* Avisos criticos chegam mesmo com o sistema fechado; menos coisa cai no vazio.  
*Onde:* Criar function de envio (e-mail/WhatsApp via Kommo) acionada pelo reminder-cron e pelos eventos criticos

**674. Erros de automacao so aparecem para quem entra na aba Monitor**  `impacto alto · esforço medio`
A faixa de alertas do Monitor mostra automacoes quebradas (foi assim que o token do Kommo ficou 3 dias caido sem ninguem ver). Mas ela so e vista por quem abre o Monitor. Esses erros deveriam virar notificacao no sino do(s) admin(s) e, idealmente, um e-mail, para nao depender de alguem 'passar por la'.
*Benefício:* Problema de integracao e descoberto em horas, nao em dias.  
*Onde:* client/src/components/MonitorAlerts.jsx (passivo) + advbox_api_log/cron_heartbeat -> notificacao ativa para admins

**675. Lembrete recorrente nao avisa quando esta perto de disparar nem agrupa**  `impacto baixo · esforço medio`
Os lembretes disparam na hora marcada, sem nenhum aviso de 'esta chegando'. Alem disso, se varios lembretes caem juntos, viram varias notificacoes separadas. Faltam opcoes simples como 'me avise 1 dia antes' e juntar lembretes do mesmo contrato.
*Benefício:* Lembretes mais uteis e menos repetitivos; menos enxurrada de avisos.  
*Onde:* client/netlify/functions/reminder-cron.mjs + client/src/components/ReminderModal.jsx

**676. Notificacoes nunca expiram nem sao limpas automaticamente**  `impacto baixo · esforço baixo`
O sino guarda ate 100 notificacoes e o usuario precisa apagar uma a uma (ou 'marcar tudo como lida'). Com o tempo isso acumula coisa velha e irrelevante. Faltam: limpeza automatica de avisos antigos ja lidos e um botao 'limpar lidas'.
*Benefício:* Sino sempre limpo e relevante; menos trabalho manual.  
*Onde:* client/src/hooks/useNotifications.js + um cron de limpeza na tabela 'notifications'

**677. Sino nao agrupa nem prioriza — tudo tem o mesmo peso**  `impacto baixo · esforço medio`
No sino, um erro grave de automacao aparece igualzinho a um lembrete simples e a um aviso informativo. Nao da para filtrar por tipo, nem ver primeiro o que e urgente. Para quem recebe muitos avisos, vira uma lista confusa.
*Benefício:* O usuario ve primeiro o que importa; menos chance de o urgente se perder.  
*Onde:* client/src/components/NotificationCenter.jsx (lista plana, sem filtro/ordenacao por urgencia)

**678. Push existe so para o cliente — equipe interna nao tem push no celular**  `impacto medio · esforço alto`
Ja existe notificacao push (aquela que aparece no celular mesmo com o app fechado) funcionando, mas APENAS para o cliente final no Portal. A equipe interna nao tem push nenhum: depende de estar com o site aberto. Daria para reaproveitar a mesma estrutura para a equipe.
*Benefício:* Avisos chegam no celular do time mesmo sem o sistema aberto.  
*Onde:* Reaproveitar web-push/VAPID de netlify/functions/portal-push.mjs para usuarios internos (nova tabela de assinaturas + envio)

**679. Toast (avisos rapidos) nao tem som nem vibracao em momentos importantes**  `impacto baixo · esforço baixo`
Os avisinhos que aparecem no canto (ex.: 'Contrato salvo', 'Falha ao enviar') sao so visuais e somem em 3 segundos. Em acoes criticas (uma assinatura chegando, um erro de envio), um som curto ou vibracao no celular ajudaria a chamar atencao de quem nao esta olhando direto para a tela.
*Benefício:* Eventos importantes chamam mais atencao, especialmente no celular.  
*Onde:* client/src/components/Toast.jsx (hoje so visual, sem audio/vibrate)

**680. Contrato enviado e parado ('abriu e nao assinou') nao alerta a equipe**  `impacto medio · esforço medio`
O sistema ja detecta quando o cliente abriu o link mas nao assinou e avisa o cliente no Kommo. Mas nao avisa o vendedor/responsavel interno de que aquela venda esfriou. Um aviso tipo 'contrato de Fulano enviado ha 3 dias sem assinatura' ajudaria a cobrar o fechamento.
*Benefício:* Mais contratos fechados; vendas paradas sao retomadas a tempo.  
*Onde:* Reaproveitar a logica de 'gargalos' do funil (FunnelHealthPanel) ou polling do App.jsx -> notificacao para o responsavel

**681. Lembrete dispara em horario absurdo (de madrugada, no fim de semana)**  `impacto medio · esforço baixo`
Quando voce cria um lembrete 'diario' as 22h de uma noite, ele vai te incomodar TODA noite as 22h para sempre. E nao existe nenhuma trava de 'horario de trabalho' — um lembrete pode cair as 3h da manha ou no domingo. O robo (reminder-cron.mjs) so olha 'ja passou da hora?' e dispara, sem perguntar se e hora boa.
*Benefício:* Avisos chegam so em horario de expediente; a equipe nao e treinada a ignorar o sino por receber aviso em hora ruim.  
*Onde:* client/netlify/functions/reminder-cron.mjs (e ReminderModal.jsx)

**682. Quem cria o lembrete em outro fuso/computador erra a hora**  `impacto baixo · esforço baixo`
O 'Amanha 9h' e os horarios sao calculados pelo relogio DO COMPUTADOR de quem cria, nao pelo horario de Brasilia do escritorio. Se alguem mexer no sistema de um celular configurado em outro fuso, ou se o relogio do PC estiver errado, o lembrete dispara na hora errada. O resto do sistema ja padroniza tudo em horario de Brasilia, menos isso.
*Benefício:* Lembrete sempre cai na hora certa de Brasilia, igual ao resto do sistema.  
*Onde:* client/src/components/ReminderModal.jsx (computeFireAt)

**683. Avisos importantes nao 'piscam' na aba do navegador quando voce esta em outra tela**  `impacto medio · esforço baixo`
Quando um contrato e assinado ou um robo falha e voce esta com o sistema aberto numa aba de fundo (vendo e-mail, por exemplo), nada chama sua atencao: o titulo da aba nao muda e nao aparece um aviso do navegador. O sistema ja pede permissao de notificacao e ja usa isso para o 'PRA CIMA CBC', mas so para assinatura — poderia reaproveitar para os outros avisos e para mudar o titulo da aba (ex: '(2) CBC Contratos').
*Benefício:* Voce percebe o aviso sem precisar estar olhando a aba certa.  
*Onde:* client/src/App.jsx (bloco Notification ~linha 586)

**684. O mesmo aviso pode aparecer dezenas de vezes (sem 'nao repetir')**  `impacto medio · esforço medio`
O sistema nao tem nenhuma trava contra avisos repetidos: se um robo falhar a cada 15 minutos, ele cria um aviso novo a cada 15 minutos, e o sino vira uma pilha do mesmo problema. Diferente da nota do Kommo, que ja tem controle de 'nao duplicar', a tabela de notificacoes nao guarda uma 'chave' por evento para agrupar ou ignorar repeticoes.
*Benefício:* Sino limpo, um aviso por assunto em vez de 30 iguais; menos ruido.  
*Onde:* tabela notifications + client/netlify/functions/reminder-cron.mjs

**685. Aviso de tarefa pendente continua aparecendo mesmo depois de resolvida**  `impacto medio · esforço medio`
Se o sistema te avisa 'contrato X esperando assinatura' e o cliente assina logo depois, o aviso antigo nao some sozinho — ele fica la, ja velho e sem sentido, ate alguem apagar na mao. Notificacoes deveriam poder 'se cancelar' quando a situacao que as gerou foi resolvida.
*Benefício:* Sino mostra so o que ainda precisa de acao, sem avisos falsos de coisa ja feita.  
*Onde:* client/src/hooks/useNotifications.js + quem cria a notificacao

**686. Nao da para adiar um aviso ('me lembre de novo daqui a 2h')**  `impacto medio · esforço baixo`
No sino, um aviso so pode ser marcado como lido ou apagado. Nao existe o botao 'adiar' (soneca) que todo app de lembrete tem. Se voce ve o lembrete mas nao pode resolver agora, a unica saida e deixar ele la marcado como nao-lido (e ai some o efeito) ou apagar e perder.
*Benefício:* Voce nao perde tarefas que viu mas nao pode fazer no momento; o aviso volta na hora certa.  
*Onde:* client/src/components/NotificationCenter.jsx + ReminderModal

**687. Mudanca de fase do processo so avisa o CLIENTE, nunca a equipe**  `impacto medio · esforço medio`
Quando o processo muda de fase ou e distribuido (o robo datajud-refresh.mjs detecta isso), o sistema posta uma nota no Kommo e avisa o cliente — mas o advogado responsavel NAO recebe nenhum aviso interno. Voce so descobre se entrar no ADVBOX ou no Kommo. O dado ja esta na mao do sistema no momento certo; falta um aviso interno.
*Benefício:* O responsavel sabe na hora que o processo andou, sem caçar no ADVBOX.  
*Onde:* client/netlify/functions/datajud-refresh.mjs

**688. Inadimplencia que piora nao avisa ninguem — so quem abrir a aba Boletos ve**  `impacto medio · esforço medio`
O sistema ja grava todo dia um retrato da inadimplencia (quem deve, quanto, ha quantos dias). Mas se ela disparar de uma semana para outra, ninguem e avisado: o numero so aparece para quem por acaso abrir a aba Boletos. E a regua de cobranca (que mandava lembrete D+1/D+7/D+15) esta DESLIGADA hoje. Daria para gerar um aviso quando a inadimplencia cruzar um limite.
*Benefício:* O socio e avisado quando a carteira piora, em vez de descobrir tarde.  
*Onde:* client/netlify/functions/cobranca-regua.mjs + InadimplenciaStrip.jsx

**689. Cada um ve so o proprio aviso — nao existe aviso para o time todo**  `impacto medio · esforço medio`
Toda notificacao e amarrada a UM e-mail (user_email). Nao da para mandar um aviso para 'todos os admins' ou 'a equipe de vendas' de uma vez. Se um robo critico cair, so quem estiver olhando a aba Monitor percebe; ninguem recebe no sino a menos que o aviso seja criado individualmente para cada pessoa.
*Benefício:* Avisos criticos chegam ao grupo certo sem depender de uma pessoa especifica estar online.  
*Onde:* tabela notifications + client/src/hooks/useNotifications.js

**690. O sistema nunca diz 'esta tudo limpo' no sino**  `impacto baixo · esforço baixo`
Quando nao ha notificacao, o sino so mostra 'Sem notificacoes ainda' — neutro, parece que pode estar quebrado. A faixa do Monitor faz isso bem (mostra um verde 'tudo operando normalmente' que confirma que esta vigiando). O sino poderia ter o mesmo gesto de confianca: deixar claro que voce esta em dia, nao que o aviso falhou.
*Benefício:* Tranquilidade: voce sabe que viu tudo, em vez de desconfiar que o sino travou.  
*Onde:* client/src/components/NotificationCenter.jsx

**691. Sino nao separa 'precisa de acao' de 'so informativo'**  `impacto medio · esforço medio`
Hoje um erro de robo que exige acao urgente e um aviso informativo ficam misturados na mesma lista, na mesma cor de fundo, ordenados so por data. Nao da para filtrar por 'so erros' ou 'so lembretes', nem ver primeiro o que e grave. A faixa do Monitor ja sabe ordenar 'erro antes de aviso' — o sino poderia herdar essa logica e ganhar abas/filtros simples.
*Benefício:* Voce resolve primeiro o que importa e nao perde um erro grave no meio de informativos.  
*Onde:* client/src/components/NotificationCenter.jsx

**692. Lista cresce ate 100 e some o resto, sem 'carregar mais' nem busca**  `impacto baixo · esforço medio`
O sino carrega no maximo 100 avisos e ponto — se passar disso, os mais antigos somem da tela e nao ha botao 'ver mais' nem campo de busca. Como nada e apagado automaticamente, a tabela so engorda no banco, mas voce nunca consegue rolar ate um aviso de duas semanas atras pelo sino.
*Benefício:* Voce consegue achar um aviso antigo quando precisa, sem ele sumir de vez.  
*Onde:* client/src/hooks/useNotifications.js (limit 100)


## 23. Onboarding, Estados Vazios & Erros  *(34)*

**693. Mensagem de erro do OCR da CNH que ensina o que fazer**  `impacto alto · esforço baixo`
Quando a leitura automatica da CNH falha, o sistema mostra so a palavra 'Erro' num botaozinho. A pessoa nao sabe se foi a foto, o arquivo ou o sistema. Trocar por uma frase que ajude: 'Nao consegui ler. Tente uma foto mais nitida, com boa luz e a CNH reta, ou preencha os campos a mao.'
*Benefício:* A secretaria resolve sozinha em vez de travar ou pedir ajuda; menos cadastros abandonados.  
*Onde:* client/src/components/FormPanel.jsx (estado ocrStatus 'error', ~linha 500 e 699)

**694. Padronizar avisos: trocar os 'alert()' e 'confirm()' do navegador pelo visual do sistema**  `impacto medio · esforço medio`
Em uns 15 pontos (excluir cobranca, arquivar contrato, exportar, gerar Word, etc.) ainda aparece aquela janelinha cinza feia do navegador, totalmente fora do visual CBC. O sistema ja tem um aviso bonito (Toast) e uma confirmacao elegante (ConfirmDestructive). Basta usar eles em vez do alert/confirm do navegador.
*Benefício:* Aparencia profissional e consistente; confirmacoes destrutivas ganham a protecao de digitar para confirmar.  
*Onde:* ContratosTab.jsx, AsaasPanel.jsx, SociosDashboard.jsx, VendasPanel.jsx, FormPanel.jsx, AdminPanel.jsx, PortalClientePanel.jsx, contratos/ViewsManager.jsx e ContractComments.jsx

**695. Tela amigavel quando o usuario nao tem acesso a uma aba**  `impacto medio · esforço baixo`
Se alguem (ou um link salvo) cair numa aba sem permissao, o sistema simplesmente joga a pessoa no Dashboard sem explicar nada — parece um bug. Mostrar uma tela curta: 'Voce nao tem acesso a esta area. Fale com um administrador se precisar.'
*Benefício:* Evita confusao e chamados de 'sumiu minha tela'; deixa claro que e questao de permissao.  
*Onde:* client/src/App.jsx (cadeia de render das abas, fallback final ~linha 1574)

**696. Tela de boas-vindas para usuario novo (primeiro acesso)**  `impacto medio · esforço medio`
Quem entra pela primeira vez cai direto no formulario sem nenhuma orientacao. Um cartao rapido de boas-vindas ('Bem-vindo ao CBC Contratos — comece criando um contrato ou veja os ja salvos') com 2 ou 3 atalhos ajuda a pessoa a se situar.
*Benefício:* Reduz a curva de aprendizado de secretarias e vendedores novos; menos treinamento manual.  
*Onde:* client/src/App.jsx (apos carregar permissoes do usuario) + novo componente de boas-vindas

**697. Erro de secao (ErrorBoundary) sem mostrar termo tecnico para o usuario**  `impacto medio · esforço baixo`
Quando uma aba quebra, aparece a mensagem tecnica crua do erro (ex: 'Cannot read properties of undefined'), que assusta e nao ajuda. Mostrar um texto humano ('Esta secao teve um problema. Tente recarregar.') e guardar o detalhe tecnico so para o suporte/Sentry.
*Benefício:* Transmite confianca em vez de parecer sistema quebrado; o detalhe tecnico continua disponivel para diagnostico.  
*Onde:* client/src/App.jsx (classe ErrorBoundary, ~linha 295-307)

**698. Botao 'Recarregar pagina' no erro de secao, alem de 'Tentar novamente'**  `impacto medio · esforço baixo`
Hoje o erro de uma aba so oferece 'Tentar novamente', que muitas vezes mostra o mesmo erro de novo porque o estado quebrado continua. Adicionar um 'Recarregar pagina' resolve a maioria dos casos de tela travada.
*Benefício:* A pessoa se desenrola sozinha quando 'tentar de novo' nao adianta.  
*Onde:* client/src/App.jsx (classe ErrorBoundary, render do fallback)

**699. Mensagem mais util quando o login falha por motivo que nao seja senha errada**  `impacto medio · esforço baixo`
O login trata bem 'e-mail ou senha incorretos', mas qualquer outro problema (sem internet, servico fora do ar, e-mail nao confirmado) cai numa mensagem tecnica em ingles. Mapear os casos comuns para frases claras em portugues e sugerir o que fazer.
*Benefício:* Evita que a pessoa ache que esqueceu a senha quando o problema e a conexao ou o cadastro.  
*Onde:* client/src/components/LoginScreen.jsx (catch do handleLogin, ~linha 45-48)

**700. Aviso claro e fixo quando o sistema esta sem internet**  `impacto medio · esforço baixo`
Hoje, sem internet, aparece so um pequeno 'Offline' no canto, facil de nao ver — e a pessoa pode achar que salvou algo que ficou so na fila local. Um aviso mais visivel ('Sem conexao — suas alteracoes serao enviadas quando a internet voltar') deixa a situacao explicita.
*Benefício:* Evita a sensacao de 'perdi meu trabalho' e dimensiona a expectativa de quando vai sincronizar.  
*Onde:* client/src/App.jsx (indicador isOnline ~linha 1267 + fila offline ~linha 1060)

**701. Usar o componente de erro bonito (ErrorState) que ja existe nas demais abas**  `impacto medio · esforço medio`
Existe um componente pronto e amigavel de erro (ErrorState), com icone, explicacao e botao 'Tentar novamente', mas so o Dashboard usa. Asaas, Boletos, Monitor e outras abas, quando falham ao carregar, mostram so um texto cinza ou nada. Reaproveitar o ErrorState nelas padroniza a experiencia.
*Benefício:* Toda aba que falha oferece o mesmo caminho claro de recuperacao, sem retrabalho de codigo.  
*Onde:* client/src/components/ErrorState.jsx (ja existe) aplicado em AsaasPanel.jsx, BoletosPanel.jsx, MonitorPanel.jsx, VendasPanel.jsx

**702. Estado vazio do Asaas/Boletos com explicacao de por que esta vazio**  `impacto baixo · esforço baixo`
Quando nao ha boletos sincronizados, aparece 'Nenhum cliente sincronizado. Clique em Sync Asaas'. Falta dizer o que esse botao faz e quanto tempo leva. Um texto de uma linha ('Puxa os boletos do Asaas para o sistema — leva alguns segundos') tira a inseguranca de clicar.
*Benefício:* A pessoa entende que precisa sincronizar e o que vai acontecer, sem medo de quebrar algo.  
*Onde:* client/src/components/BoletosPanel.jsx (~linha 1342) e AsaasPanel.jsx

**703. Explicar de forma clara o erro ao gerar PDF/DOCX do contrato**  `impacto medio · esforço baixo`
Se a geracao do Word falha, aparece 'Erro ao gerar DOCX: ' seguido de um texto tecnico no alert do navegador. Trocar por uma mensagem no padrao do sistema com sugestao ('Nao consegui gerar o arquivo. Tente de novo; se persistir, avise o suporte').
*Benefício:* Momento critico (entregar o contrato) deixa de assustar com erro tecnico cru.  
*Onde:* client/src/components/FormPanel.jsx (~linha 1943, alert do catch de DOCX)

**704. Ajuda contextual (tooltip) nos campos e botoes que geram duvida**  `impacto medio · esforço medio`
Alguns campos importantes ja tem dica ao passar o mouse (ex: Link Kommo), mas varios nao: os modos de honorario (Apenas Iniciais / Êxito / Iniciais+Êxito), 'prioridade idoso', ou o que cada botao de automacao faz. Pequenas dicas explicativas (icone de '?') reduzem erro de preenchimento.
*Benefício:* Menos contratos preenchidos errado e menos perguntas repetidas a colegas mais experientes.  
*Onde:* client/src/components/FormPanel.jsx (componente Tooltip ja existe, ~linha 205; secoes Honorarios ~1487 e Contratantes)

**705. Toque acidental no fundo dos modais de confirmacao nao deve cancelar**  `impacto baixo · esforço baixo`
Em alguns modais, clicar fora (no fundo escurecido) cancela a acao. No celular e facil tocar fora sem querer e perder o que estava fazendo. Em telas de confirmacao importante, exigir o clique no botao Cancelar de proposito.
*Benefício:* Evita perder dados ou cancelar envio por toque acidental, principalmente no celular.  
*Onde:* client/src/components/ConfirmDestructive.jsx (~linha 71, onClick do backdrop) e demais modais

**706. Indicar progresso e tempo nas sincronizacoes longas (Sync Asaas, recalculo de comissoes)**  `impacto medio · esforço medio`
Acoes que demoram (sincronizar boletos, recalcular comissoes) hoje mostram pouco ou nenhum sinal de andamento. A pessoa fica na duvida se travou e clica de novo. Um indicador 'Sincronizando... isso pode levar ate 1 minuto' resolve.
*Benefício:* Evita cliques repetidos e a sensacao de sistema travado em operacoes demoradas.  
*Onde:* client/src/components/BoletosPanel.jsx (botao Sync Asaas), AsaasPanel.jsx e SociosDashboard.jsx (recalculo ~linha 498)

**707. Confirmacao com aviso claro antes de subir arquivo ao Drive de novo**  `impacto baixo · esforço baixo`
Ao reenviar arquivos ao Google Drive de um contrato que ja tem pasta, aparece um confirm do navegador avisando que vai duplicar. E uma decisao importante (pode baguncar a pasta do cliente) e merece a confirmacao visual do sistema, destacando o risco de duplicar.
*Benefício:* Reduz duplicacao de arquivos no Drive do cliente e a confusao que isso gera depois.  
*Onde:* client/src/components/ContratosTab.jsx (~linha 276, confirm de reenvio ao Drive)

**708. Estado vazio das abas de gestao (Portal, Bot, Param. Vendas) com 'como comecar'**  `impacto baixo · esforço medio`
Abas de configuracao (Portal do Cliente, Bot, Parametrizacao de Vendas) podem aparecer praticamente vazias para quem nunca configurou. Em vez de so 'Nenhum item cadastrado', um passo-a-passo curto ('1. Cadastre X  2. Depois Y') guia o primeiro uso.
*Benefício:* Quem configura pela primeira vez sabe por onde comecar, sem depender de manual a parte.  
*Onde:* client/src/components/VendasParametrizacaoPanel.jsx (varios estados vazios ~linha 483, 1300), PortalClientePanel.jsx, bot/*

**709. Resumo amigavel quando o envio ao ADVBOX/Drive falha (no Monitor e na lista)**  `impacto medio · esforço medio`
Quando uma automacao (ADVBOX, Drive, Kommo) falha, o detalhe costuma vir em formato tecnico (JSON) ou so um status 'erro'. Mostrar uma frase humana do que aconteceu e o que fazer ('Falha ao lancar no ADVBOX — clique em Tentar novamente; se repetir, avise o suporte') ajuda quem nao e tecnico.
*Benefício:* A secretaria entende a falha e consegue reagir sem precisar de alguem que leia codigo.  
*Onde:* client/src/components/ContratosTab.jsx (timeline de automacoes/retry) e MonitorPanel.jsx / MonitorAdvbox.jsx

**710. Confirmar antes de limpar todo o formulario de contrato**  `impacto medio · esforço baixo`
Existe um botao de 'Limpar todos os dados do formulario'. Se for clicado sem confirmacao, todo o preenchimento se perde de uma vez. Pedir uma confirmacao rapida ('Apagar tudo que foi digitado neste contrato?') evita acidentes.
*Benefício:* Evita perder um cadastro inteiro por um clique errado, especialmente no celular.  
*Onde:* client/src/components/FormPanel.jsx (~linha 1281, botao Limpar formulario)

**711. Mensagem de 'sessao expirada' clara em vez de erros soltos**  `impacto medio · esforço medio`
Quando o login expira por inatividade, varias acoes comecam a falhar silenciosamente ou com erros genericos. Detectar esse caso e mostrar 'Sua sessao expirou — entre novamente' com botao para refazer login deixa tudo obvio.
*Benefício:* A pessoa entende na hora que so precisa logar de novo, em vez de achar que o sistema bugou.  
*Onde:* client/src/AuthContext.jsx + tratamento de erros de chamadas autenticadas no App.jsx

**712. Tornar o estado vazio do Dashboard acolhedor para quem ainda nao tem contratos**  `impacto baixo · esforço baixo`
Para um usuario novo, o Dashboard pode aparecer cheio de zeros e graficos vazios, passando impressao de sistema sem dados. Um aviso leve ('Seus numeros aparecem aqui assim que houver contratos — crie o primeiro') orienta melhor.
*Benefício:* Primeira impressao positiva e clara, em vez de uma tela de zeros sem explicacao.  
*Onde:* client/src/components/Dashboard.jsx (quando nao ha contratos no periodo) + dashboard/widgets.jsx

**713. Aviso visivel quando o envio automatico ao ADVBOX/Drive falha em segundo plano**  `impacto alto · esforço baixo`
Quando um contrato assinado e enviado sozinho ao ADVBOX ou ao Google Drive e da erro, o sistema so anota a falha no banco (status 'error') e nao avisa ninguem na tela. A pessoa so descobre se for olhar o Monitor. Bastaria mostrar um aviso discreto ('1 contrato nao subiu pro ADVBOX, veja em Contratos') quando a automacao de fundo falhar.
*Benefício:* Evita que contrato assinado fique sem processo no ADVBOX ou sem pasta no Drive por dias sem ninguem perceber  
*Onde:* client/src/App.jsx (laco de automacao ~linhas 700-830, onde grava advbox_status='error' e drive_last_error)

**714. Tela 'Novo Contrato' com guia de primeiros passos quando o formulario esta em branco**  `impacto medio · esforço medio`
Hoje quem abre 'Novo Contrato' pela primeira vez ve um formulario gigante em branco, sem nenhuma orientacao de por onde comecar (ler CNH, buscar por CPF, ou digitar). A previa do contrato ao lado tambem fica vazia sem explicar o porque. Um cartao curto com 3 passos ('1. Leia a CNH ou busque o CPF / 2. Confira os dados / 3. Gere e envie') guiaria o usuario novo.
*Benefício:* Reduz a curva de aprendizado de secretarias e vendedores novos  
*Onde:* client/src/components/FormPanel.jsx (topo do formulario) e client/src/components/LivePreview.jsx (estado vazio)

**715. Erro de OCR da CNH virar so um rotulo 'Erro' nao ajuda; mostrar o que houve e o que fazer**  `impacto medio · esforço baixo`
Quando a leitura da CNH falha, o botao apenas vira 'Erro' por alguns segundos e o usuario nao sabe se a foto estava ruim, se era um PDF invalido, ou se nenhum campo foi reconhecido. Vale distinguir 'nao consegui ler nenhum dado, tente uma foto mais nitida' de 'arquivo nao suportado' e oferecer 'tentar de novo' ou 'preencher a mao'.
*Benefício:* Menos abandono e menos retrabalho ao digitalizar documentos  
*Onde:* client/src/components/FormPanel.jsx (funcao processCNHFile, ~linhas 467-511, ramo de erro)

**716. Aba Contratos sem rede de seguranca contra travamento (falta ErrorBoundary)**  `impacto alto · esforço baixo`
Todas as abas (Dashboard, Asaas, Monitor...) tem uma 'rede de seguranca' que mostra 'Algo deu errado nesta secao' se a tela quebrar, mas justamente a aba Contratos (a mais usada) nao tem essa protecao. Se algo quebrar nela, o usuario pode ver uma tela branca sem botao de recuperar.
*Benefício:* Evita tela branca na aba mais critica do dia a dia  
*Onde:* client/src/App.jsx (linha 1553, o bloco da aba 'contratos' nao esta envolvido por ErrorBoundary, diferente das demais)

**717. A rede de seguranca de erro pode ficar 'presa' ao trocar de aba**  `impacto medio · esforço baixo`
Quando uma secao quebra e mostra 'Algo deu errado', esse estado de erro so some se a pessoa clicar em 'Tentar novamente'. Se ela trocar de aba e voltar, o erro continua aparecendo mesmo que o problema ja tenha passado. O ideal e a tela se recuperar sozinha ao sair e voltar da aba.
*Benefício:* Usuario nao fica 'preso' num erro que ja se resolveu  
*Onde:* client/src/App.jsx (classe ErrorBoundary, linhas 284-311, falta resetar hasError quando a aba muda)

**718. Mensagem tecnica do erro aparece direto para o usuario na rede de seguranca**  `impacto medio · esforço baixo`
Quando uma secao quebra, a tela mostra a mensagem tecnica crua do erro (ex.: 'Cannot read properties of undefined'), que assusta e nao ajuda o advogado ou a secretaria. Melhor mostrar uma frase amigavel e esconder o detalhe tecnico atras de um 'ver detalhes' para quem for reportar o problema.
*Benefício:* Tela de erro deixa de parecer 'quebrada' e fica profissional  
*Onde:* client/src/App.jsx (ErrorBoundary, linha 301 mostra this.state.error?.message direto)

**719. Convite ao 'O que ha de novo' para quem nunca viu (onboarding das novidades)**  `impacto medio · esforço medio`
O sistema ja sabe avisar quando ha uma versao nova (banner no topo), mas um usuario que entra pela primeira vez nao tem um convite claro para conhecer o que o sistema faz. Um 'tour' curto de boas-vindas na primeira sessao (com opcao de pular), reaproveitando a estrutura do changelog, apresentaria as abas principais.
*Benefício:* Acelera a adocao por funcionarios novos sem treinamento presencial  
*Onde:* client/src/components/ChangeLog.jsx (ja tem controle de 'visto' por localStorage) + client/src/App.jsx (header)

**720. Estados vazios das abas tecnicas mostram comandos de banco para o usuario final**  `impacto medio · esforço baixo`
Em varias telas (Socios, Parametrizacao de Vendas), quando faltam dados a mensagem diz coisas como 'Rode supabase_vendas_comissoes.sql' ou 'as tabelas ainda nao existem no banco'. Isso e instrucao de programador exibida para advogado. Deveria dizer algo como 'Este modulo ainda nao foi ativado, fale com o suporte' e esconder o jargao.
*Benefício:* Telas vazias deixam de expor termos tecnicos e parecer 'erro do sistema'  
*Onde:* client/src/components/SociosDashboard.jsx (linhas 586, 1248, 1406) e VendasParametrizacaoPanel.jsx (linhas 242, 264)

**721. Previa do contrato (LivePreview) sem mensagem amigavel quando ainda nao da pra gerar**  `impacto baixo · esforço baixo`
Enquanto o formulario nao tem dados suficientes, a previa do contrato ao lado pode ficar vazia ou com texto incompleto sem explicar por que. Uma frase tipo 'Preencha nome, resort e honorarios para ver a previa do contrato aqui' orientaria o que falta, em vez de deixar um espaco morto.
*Benefício:* Usuario entende que a previa depende do preenchimento, nao esta 'quebrada'  
*Onde:* client/src/components/LivePreview.jsx (estado quando faltam campos minimos)

**722. Aba 'Saude do Funil' e abas novas sem orientacao quando ainda nao ha dados**  `impacto baixo · esforço baixo`
A aba nova 'Saude do Funil' (e situacoes parecidas no Bot e Portal) pode aparecer vazia em periodos sem movimento, sem dizer se 'nao ha dados ainda' ou se 'o filtro escondeu tudo'. Vale um estado vazio que explique o motivo e, se for o caso, sugira ampliar o periodo.
*Benefício:* Evita a duvida 'sera que o sistema parou de funcionar?'  
*Onde:* client/src/components/FunnelHealthPanel.jsx e components/bot/BotNovidades.jsx (estados sem registros)

**723. Confirmar antes de fechar o envio ao ZapSign clicando fora do modal**  `impacto medio · esforço baixo`
O modal de envio para assinatura fecha assim que a pessoa clica em qualquer area fora dele. Num fluxo importante como esse (mandar contrato para o cliente assinar), um clique acidental no fundo pode fechar a janela e fazer a pessoa achar que cancelou. Vale ou nao fechar pelo fundo, ou pedir uma confirmacao rapida.
*Benefício:* Reduz fechamentos acidentais no passo mais sensivel do fluxo  
*Onde:* client/src/components/ZapSignModal.jsx (linha 185, backdrop fecha direto no onClick)

**724. Aviso claro de cada campo que faltou no checklist de envio, em vez de so contar quantos**  `impacto medio · esforço medio`
Antes de enviar para assinatura, o sistema avisa por exemplo '3 campos obrigatorios faltando', mas nem sempre leva a pessoa direto ao primeiro campo vazio nem lista quais sao por nome de forma simples. Listar 'falta: CEP, telefone e Link Kommo do contratante 1' e clicar para pular ate ele economiza tempo de cacar o campo.
*Benefício:* Menos idas e vindas para descobrir o que falta antes de enviar  
*Onde:* client/src/components/PreSendChecklist.jsx (linha 231) e FormPanel.jsx (validacao ~linha 1220)

**725. Spinner generico 'Carregando...' nas abas pesadas poderia indicar o que esta carregando**  `impacto baixo · esforço baixo`
Quando uma aba pesada abre, aparece um spinner com 'Carregando...' sem contexto. Em conexoes lentas isso parece travado. Trocar por uma frase do tipo 'Carregando seus contratos...' / 'Montando o painel...' (ja existem esqueletos para a maioria) deixa a espera menos ansiosa.
*Benefício:* Espera parece mais curta e menos como travamento  
*Onde:* client/src/App.jsx (funcao TabFallback, linhas 347-356, fallback sem skeleton)

**726. Confirmar antes de descartar dados ao gerar nova previa de PDF/recarregar o formulario**  `impacto medio · esforço medio`
Acoes que substituem o trabalho atual (carregar outro contrato, limpar a leitura de CNH ja preenchida) nem sempre confirmam que o que estava na tela vai ser sobrescrito. O sistema ja tem um componente bonito de confirmacao (ConfirmDestructive); vale usa-lo nesses pontos para evitar perda acidental de preenchimento.
*Benefício:* Evita perder dados ja digitados por um clique apressado  
*Onde:* client/src/components/FormPanel.jsx (troca de contrato carregado) reaproveitando components/ConfirmDestructive.jsx


## 24. Novas Funcionalidades  *(30)*

**727. Envio em lote para assinatura (ZapSign)**  `impacto alto · esforço medio`
Hoje cada contrato e enviado para assinatura um por um, abrindo a janela do ZapSign individualmente. A ideia e poder selecionar varios contratos prontos na lista e mandar todos para assinatura de uma vez, com uma barra de progresso.
*Benefício:* A secretaria envia 20 contratos com 1 clique em vez de 20 fluxos manuais; menos tempo e menos erro humano.  
*Onde:* client/src/components/ContratosTab.jsx (selecao em massa ja existe), client/src/components/ZapSignModal.jsx e client/src/utils/zapsignService.js

**728. Modelos de contrato salvos por resort e tipo de acao**  `impacto alto · esforço alto`
As clausulas hoje vem de uma lista fixa no codigo. A ideia e o escritorio poder cadastrar 'modelos' (combinacao pronta de clausulas, escopo e honorarios) por resort e tipo de acao, e ao criar um contrato escolher o modelo que ja preenche tudo.
*Benefício:* Padroniza contratos, evita esquecer clausula importante e acelera muito a criacao de casos repetidos.  
*Onde:* client/src/data/clausulas.js (CLAUSULAS_PADRAO/TIPOS_ACAO), client/src/components/FormPanel.jsx, nova tabela Supabase (ex: contrato_modelos)

**729. Biblioteca de clausulas avulsas reutilizaveis**  `impacto medio · esforço medio`
Hoje da para adicionar uma clausula avulsa digitando na hora, mas ela nao fica guardada. A ideia e ter um 'banco de clausulas' onde o advogado salva textos que usa com frequencia (foro, parcelamento especial, etc.) e insere com 1 clique.
*Benefício:* Para de redigitar as mesmas clausulas; garante texto juridico revisado e identico em todos os contratos.  
*Onde:* client/src/components/FormPanel.jsx (addClausulaAvulsa), nova tabela Supabase (clausulas_biblioteca)

**730. Painel de prazos e audiencias do advogado**  `impacto alto · esforço alto`
O sistema ja le do ADVBOX/DataJud a fase do processo, mas nao mostra prazos nem audiencias para a equipe. A ideia e uma tela/aba que liste audiencias, pericias e prazos proximos por processo, ordenados por data.
*Benefício:* Evita perder prazo ou audiencia; centraliza o que hoje so esta no ADVBOX e exige abrir outro sistema.  
*Onde:* client/netlify/functions/datajud-refresh.mjs (ja puxa stage/fase), nova aba em client/src/components/, tabela contratos

**731. Lembretes automaticos por evento, nao so manuais**  `impacto alto · esforço medio`
Hoje o lembrete e criado manualmente para cada contrato. A ideia e regras automaticas: 'avisar se um contrato esta enviado ha 3 dias e ainda nao foi assinado', 'avisar X dias antes de uma audiencia'. O sistema cria o lembrete sozinho.
*Benefício:* Ninguem precisa lembrar de criar lembrete; contratos parados e prazos viram alerta automatico.  
*Onde:* client/src/components/ReminderModal.jsx + tabela user_reminders + client/netlify/functions/reminder-cron.mjs

**732. Assistente de IA para revisar contrato antes de enviar**  `impacto alto · esforço alto`
Antes de mandar para assinatura, um botao usa IA para revisar o contrato gerado e apontar problemas: nome em branco, valor de honorario incoerente, clausula conflitante, dado faltando. So sugere — o advogado decide.
*Benefício:* Pega erros que o checklist atual nao pega (incoerencias de texto), reduzindo retrabalho e contrato errado assinado.  
*Onde:* client/src/components/PreSendChecklist.jsx, nova Netlify Function usando ANTHROPIC_API_KEY (ja existe no projeto p/ o bot)

**733. Relatorios gerenciais em PDF por periodo**  `impacto medio · esforço medio`
Hoje so existe o PDF de 'contratos assinados'. A ideia e relatorios prontos para imprimir/enviar: producao por vendedor, receita por resort, inadimplencia do mes, funil do periodo — tudo em PDF com a marca do escritorio.
*Benefício:* O socio gera um relatorio bonito para reuniao ou contador sem precisar montar planilha na mao.  
*Onde:* client/src/utils/relatorioAssinadosHtml.js (modelo a replicar), client/src/components/Dashboard.jsx e SociosDashboard.jsx

**734. Busca avancada com filtros combinados e salvos**  `impacto medio · esforço medio`
A busca global hoje encontra por nome, CPF ou data. A ideia e uma busca avancada que combina varios filtros (ex: 'resort X + tipo acao Y + assinado entre tais datas + honorario acima de Z') e permite salvar essa busca para reusar.
*Benefício:* Encontrar rapidamente um grupo de casos para acao em lote ou relatorio, sem rolar a lista inteira.  
*Onde:* client/src/components/GlobalSearch.jsx e ContratosTab.jsx (ja tem user_views/filtros salvos)

**735. Duplicar contrato como base para um novo**  `impacto medio · esforço baixo`
Quando entra um cliente parecido (mesmo resort, mesmo tipo de acao) ou um segundo contrato do mesmo cliente, hoje preenche tudo de novo. A ideia e um botao 'Usar como base' que copia um contrato existente para um novo, ja preenchido para ajustar.
*Benefício:* Cria contratos semelhantes em segundos; muito util para clientes recorrentes e mesmo empreendimento.  
*Onde:* client/src/components/ContratosTab.jsx (handleLoadContract) + ContractContext.jsx

**736. Multiplos rascunhos nomeados (nao so um por usuario)**  `impacto medio · esforço medio`
Hoje o rascunho fica salvo so no navegador e e um unico por pessoa — abrir um novo contrato pode sobrescrever o anterior. A ideia e poder ter varios rascunhos nomeados, salvos na nuvem, que qualquer maquina abre.
*Benefício:* A secretaria toca varios contratos em paralelo sem medo de perder o trabalho ao trocar de computador.  
*Onde:* client/src/ContractContext.jsx (chave cbc_rascunho_ no localStorage), nova tabela Supabase (contrato_rascunhos)

**737. Aniversarios e datas-chave dos clientes**  `impacto medio · esforço baixo`
Os dados de nascimento ja sao coletados e ate ja existe a base de clientes. A ideia e uma agenda que mostra aniversariantes do dia/semana para o escritorio mandar uma mensagem — um toque de relacionamento que fideliza.
*Benefício:* Fortalece o relacionamento com cliente a custo quase zero; ja foi levantado no CLAUDE.md como ideia nao feita.  
*Onde:* base bi_clientes/clientes (nascimento ja existe), nova mini-aba ou widget em client/src/components/Dashboard.jsx

**738. Historico de versoes visivel do contrato**  `impacto medio · esforço medio`
O sistema ja registra alteracoes (contratos_audit) no banco, mas isso nao aparece na tela. A ideia e mostrar, dentro do contrato, 'quem mudou o que e quando', com possibilidade de ver o texto anterior.
*Benefício:* Da rastreabilidade juridica e resolve discussao de 'quem alterou esse honorario'; o dado ja existe, falta exibir.  
*Onde:* tabela contratos_audit (ja gravada), nova secao na expansao de client/src/components/ContratosTab.jsx

**739. Exportar contrato e procuracao em pacote unico para o cliente**  `impacto medio · esforço medio`
Hoje gera PDF e DOCX separados. A ideia e um botao 'Enviar pacote ao cliente' que junta contrato + procuracao + instrucoes num unico arquivo/link, pronto para mandar pelo WhatsApp/Kommo.
*Benefício:* Cliente recebe tudo organizado de uma vez; menos idas e vindas e menos confusao de arquivo.  
*Onde:* client/src/utils/contractHtml.js (generateFullDocumentHTML ja existe), pdfGenerator.js, integracao Kommo existente

**740. Geracao de minuta de peticao inicial a partir do contrato**  `impacto alto · esforço alto`
Com os dados do cliente, resort e tipo de acao ja estruturados, uma IA pode gerar um rascunho de peticao inicial (qualificacao das partes, fatos basicos, pedidos) para o advogado revisar — nunca para protocolar sozinho.
*Benefício:* Adianta o trabalho juridico repetitivo; o advogado parte de um rascunho em vez da folha em branco.  
*Onde:* dados ja estruturados em contratos (dados JSONB), nova Netlify Function com ANTHROPIC_API_KEY

**741. Integracao com Google Agenda para prazos e reunioes**  `impacto medio · esforço medio`
Ja existe sincronizacao com Google Agenda para videochamadas. A ideia e estender: jogar automaticamente para a agenda do advogado os prazos, audiencias e lembretes do sistema, e marcar reunioes de assinatura.
*Benefício:* O advogado ve tudo no calendario que ja usa no celular, sem abrir o sistema; reaproveita integracao existente.  
*Onde:* client/netlify/functions/agenda-videochamadas-sync.mjs (integracao Google ja existe), tabela user_reminders/contratos

**742. Linha do tempo unificada do cliente (360 graus)**  `impacto alto · esforço alto`
Hoje os dados de um cliente estao espalhados (contrato, boletos Asaas, andamento ADVBOX, notas Kommo). A ideia e uma tela que junta tudo em uma unica linha do tempo: assinou, foi cobrado, pagou, processo distribuiu, mudou de fase.
*Benefício:* Atendimento responde qualquer pergunta do cliente numa tela so, sem pular entre 4 sistemas.  
*Onde:* client/src/components/ContratosTab.jsx (drawer existente), dados de contratos/asaas_boletos/bi_processos/advbox_data

**743. Modo de criacao rapida por planilha (importar lote de clientes)**  `impacto alto · esforço alto`
Para acoes coletivas com muitos clientes do mesmo resort, a ideia e importar uma planilha (Excel/CSV) com os dados das pessoas e gerar varios contratos de uma vez a partir de um modelo.
*Benefício:* Transforma horas de digitacao em minutos quando entra um lote grande de clientes do mesmo empreendimento.  
*Onde:* client/src/utils/importContrato.js e excelExport.js (ja lidam com import/export), FormPanel.jsx, novo modal de importacao em lote

**744. Notificacoes proativas de etapas para o cliente por WhatsApp**  `impacto alto · esforço medio`
As notas no Kommo ja avisam mudancas de fase internamente. A ideia e o cliente receber automaticamente um WhatsApp amigavel em marcos importantes (contrato assinado, processo distribuido, audiencia marcada), sem o time precisar lembrar.
*Benefício:* Cliente fica tranquilo e informado sozinho, reduzindo ligacoes de 'e o meu processo?' para a equipe.  
*Onde:* client/netlify/functions/kommo-note.mjs e datajud-refresh.mjs (ganchos de fase ja existem), integracao Kommo/WhatsApp

**745. Confirmação de recebimento e leitura do contrato pelo cliente**  `impacto alto · esforço baixo`
Hoje o sistema já sabe que o cliente 'abriu e não assinou' (campo times_viewed do ZapSign, usado na nota Kommo #18). Daria para transformar isso numa tela: uma lista mostrando quem recebeu, quem abriu, quantas vezes, e há quantas horas o link está parado sem assinatura.
*Benefício:* A secretaria sabe exatamente em quem cobrar a assinatura, em vez de esperar no escuro.  
*Onde:* ContratosTab.jsx (timeline de automacoes) + dado times_viewed do ZapSign ja existente

**746. Reenvio inteligente do link de assinatura que expirou ou parou**  `impacto alto · esforço medio`
Quando um contrato fica dias enviado e não assinado, o sistema poderia oferecer um botão 'reenviar com novo link' que gera nova assinatura no ZapSign e registra a tentativa. Diferente de só reabrir: ele guarda quantas vezes já foi reenviado e avisa quando o caso virou 'perdido' (ex.: 3 reenvios sem resposta).
*Benefício:* Recupera vendas que esfriam por esquecimento e separa o que ainda vale insistir do que já é caso perdido.  
*Onde:* ZapSignModal.jsx + utils/zapsignService.js + status do contrato

**747. Calculadora de cenários de honorários dentro do formulário**  `impacto medio · esforço medio`
No formulário de honorários (FormPanel, seção Honorarios), o advogado preenche valor, parcelas e percentual de êxito manualmente. Daria para ter um simulador ao lado: digita o valor da causa esperado e ele mostra na hora quanto o escritório recebe em cada cenário (só iniciais, só êxito, ou os dois) e o total estimado, ajudando a fechar o melhor formato na frente do cliente.
*Benefício:* Fecha negociação mais rápido e evita propor honorário que dá prejuízo.  
*Onde:* FormPanel.jsx (section-honorarios) + data/clausulas.js (PERCENTUAIS_EXITO)

**748. Cláusula de reajuste anual das parcelas (IPCA/IGP-M) opcional**  `impacto medio · esforço baixo`
As cláusulas de honorários (clausulas.js, cláusula 3) hoje fixam parcelas em valor nominal, sem previsão de correção. Para contratos longos (muitas parcelas), uma opção que insere automaticamente a correção anual por um índice escolhido protege o escritório da inflação ao longo do parcelamento.
*Benefício:* Evita perda silenciosa de receita em contratos parcelados por muitos meses.  
*Onde:* client/src/data/clausulas.js + utils/contractHtml.js (texto da parte fixa)

**749. Geração de aditivo contratual (renegociação/parcelamento de inadimplente)**  `impacto alto · esforço medio`
Quando um cliente fica inadimplente (já detectado no BoletosPanel/InadimplenciaStrip), hoje não há jeito de gerar um documento de renegociação. Um botão 'gerar aditivo' pegaria os dados do contrato original e produziria um termo de novo parcelamento já pronto para assinar no ZapSign, sem redigitar tudo.
*Benefício:* Recupera dinheiro parado com um documento formal, sem retrabalho de redigitar o contrato.  
*Onde:* BoletosPanel.jsx / InadimplenciaStrip.jsx + utils/docxGenerator.js

**750. Painel 'Pendências do dia' unificado para a secretaria**  `impacto alto · esforço medio`
As ações de cobrar assinatura, conferir nota fiscal, refazer ADVBOX que falhou e responder pergunta do cliente estão espalhadas por abas diferentes (Contratos, Boletos, Monitor, Portal). Uma única tela 'caixa de entrada de tarefas' juntaria tudo que precisa de ação humana hoje, em ordem de urgência.
*Benefício:* A equipe deixa de pular entre 6 abas e nada importante cai no esquecimento.  
*Onde:* Nova aba/painel cruzando ContratosTab, BoletosPanel, MonitorPanel, PortalClientePanel

**751. Checklist de documentos por cliente com status visível**  `impacto medio · esforço medio`
Existe a base de requisitos de documentos em Vendas (vendas_documentos_*), mas falta uma visão por contrato mostrando, tipo lista de tarefas, quais documentos o cliente já entregou e quais faltam (RG, comprovante de pagamento do timeshare, contrato do resort), com aviso de pendência.
*Benefício:* Ninguém ajuíza um caso com documento faltando nem fica perguntando ao cliente o que já foi enviado.  
*Onde:* VendasPanel.jsx (vendas_documentos_*) + ContratosTab.jsx

**752. Modo de pré-cadastro pelo próprio cliente antes da reunião**  `impacto alto · esforço medio`
Já existe o formulário público por QR (ClientFormQR.jsx) que o cliente preenche. Daria para evoluir para um link enviado antes da reunião onde o cliente sobe a foto da CNH e do contrato do resort; quando o advogado abrir o caso, os dados já vêm pré-preenchidos pelo OCR, e ele só revisa.
*Benefício:* A reunião começa com tudo digitado, economizando 10-15 min por cliente e reduzindo erro de digitação.  
*Onde:* ClientFormQR.jsx + utils/ocrService.js

**753. Biblioteca de respostas-padrão para perguntas do cliente no Portal**  `impacto medio · esforço baixo`
No Portal do Cliente já chegam perguntas (portal_perguntas). Uma biblioteca de respostas prontas e reutilizáveis ('quando recebo?', 'meu processo travou?') que a secretaria escolhe com um clique, em vez de redigitar a mesma explicação toda vez, padroniza o atendimento.
*Benefício:* Respostas mais rápidas, consistentes e sem erro, aliviando a secretaria.  
*Onde:* PortalClientePanel.jsx (portal_perguntas)

**754. Indicação/referência de cliente com rastreio (programa 'indique um amigo')**  `impacto medio · esforço medio`
O cliente satisfeito é a melhor fonte de novos casos no nicho de timeshare. Um link de indicação único por cliente (parecido com os tokens do Portal já existentes) que, quando um indicado vira contrato, credita a indicação ao cliente original, criaria um canal de captação medível dentro do próprio sistema.
*Benefício:* Cria um canal de novos clientes barato e mensurável, aproveitando quem já confia no escritório.  
*Onde:* PortalClientePanel.jsx (tokens) + tabela contratos (origem do cliente)

**755. Comparador 'antes x depois' de versões do contrato**  `impacto medio · esforço medio`
O sistema já guarda auditoria de campos com valor jurídico (contratos_audit). Falta uma tela que mostre, lado a lado, o que mudou entre uma versão e outra de um contrato (qual cláusula foi alterada, qual valor mudou e por quem), em linguagem simples.
*Benefício:* Em qualquer questionamento futuro, dá para provar exatamente o que foi acordado e quando.  
*Onde:* contratos_audit + ContratosTab.jsx

**756. Detecção de capacidade/conflito antes de assinar (idoso, mesmo CPF como parte contrária)**  `impacto medio · esforço medio`
Já existe alerta de prioridade idoso (≥60). Daria para juntar num 'farol de risco' antes do envio ao ZapSign: cliente muito idoso (sugere assistência/testemunha), CPF que já aparece em outro caso, ou dados que não batem entre CNH e o que foi digitado.
*Benefício:* Evita contrato anulável por vício de capacidade e problemas éticos de conflito de interesse.  
*Onde:* PreSendChecklist.jsx + utils/validation.js


## 25. Dados, Consistencia & Integridade  *(29)*

**757. Consertar o alerta de contrato duplicado (esta quebrado)**  `impacto alto · esforço baixo`
O sistema deveria avisar quando o mesmo CPF ja tem contrato no mesmo resort, mas o aviso nunca aparece. O motivo: o CPF e guardado no banco com pontos e tracos (433.501.258-67) e a busca de duplicata procura so os numeros (43350125867) — nunca encontram um ao outro. Confirmei ao vivo: ha 8 pares de contratos duplicados (mesmo CPF + mesmo resort) que passaram sem alerta.
*Benefício:* Evita contrato e cobranca em duplicidade para o mesmo cliente; restaura uma protecao que hoje so existe na aparencia.  
*Onde:* client/src/utils/duplicateDetector.js (funcao checkDuplicate, linha 25) e client/src/components/FormPanel.jsx

**758. Padronizar o CPF/CNPJ no banco (so numeros) com migracao unica**  `impacto alto · esforço medio`
Hoje todos os 190 contratos guardam o CPF com pontuacao. Isso quebra buscas, comparacoes entre sistemas (Asaas/ADVBOX guardam so numeros) e a deteccao de duplicata. O ideal e gravar sempre so os 11/14 digitos no banco e mostrar formatado so na tela. Precisa de uma migracao que limpe os 190 ja existentes e ajuste o codigo que salva.
*Benefício:* Faz CPF bater entre todos os sistemas e corrige duplicata, busca e reconciliacao de uma vez so.  
*Onde:* client/src/App.jsx (buildContratoRow, linha 199) + client/src/utils/importContrato.js + migracao SQL na tabela contratos

**759. Criar uma trava no banco contra contrato duplicado**  `impacto medio · esforço medio`
Mesmo corrigindo o aviso na tela, dois operadores podem salvar o mesmo contrato ao mesmo tempo (o aviso so avisa, nao bloqueia). Uma regra no proprio banco (indice unico parcial por CPF+resort para contratos nao cancelados) garante que o banco recuse o segundo de forma automatica, como ultima linha de defesa.
*Benefício:* Impede fisicamente a duplicata mesmo em cliques simultaneos ou falha do aviso visual.  
*Onde:* migracao SQL na tabela contratos (depois de limpar os 8 duplicados existentes)

**760. Preencher a data de assinatura nos 27 contratos sem ela**  `impacto medio · esforço baixo`
Encontrei 27 contratos marcados como 'assinado' que estao sem a data real de assinatura (campo signed_at vazio). Relatorios de prazo, producao mensal e comissao usam aproximacoes (cai para a data do ADVBOX ou do ultimo update) quando essa data falta, distorcendo numeros do passado.
*Benefício:* Relatorios de tempo ate assinar, producao e comissao ficam corretos no historico.  
*Onde:* tabela contratos (backfill de signed_at a partir do ZapSign/advbox_date) + client/src/App.jsx

**761. Manter o registro mestre de clientes sempre fresco e auditado**  `impacto medio · esforço medio`
A tabela 'clientes' (que unifica Asaas/Kommo/ADVBOX/contratos por CPF) e atualizada por uma rotina diaria. Hoje ela nao tem como mostrar quantos clientes ficaram sem casar com cada sistema nem quantos tiveram 'conflito de nome'. Vale expor esses contadores num painel para o escritorio enxergar a saude do cadastro unico.
*Benefício:* Da visibilidade de quantos clientes estao orfaos ou divergentes entre sistemas, antes que vire problema de cobranca.  
*Onde:* client/netlify/functions/clientes-reconciliar.mjs + um painel no Monitor lendo a tabela clientes (campos nome_conflito, em_asaas/advbox/kommo)

**762. Reconciliacao Kommo por telefone e fragil — registrar o que nao casou**  `impacto medio · esforço medio`
Como o Kommo nao preenche CPF, o cadastro unico casa o lead com o cliente pelo telefone. Telefone muda, vem com/sem DDD, com/sem o 9 — entao alguns leads nunca casam e ninguem fica sabendo. Sugiro normalizar o telefone (sempre ultimos 11 digitos) e gravar uma lista dos leads que nao casaram para revisao manual.
*Benefício:* Reduz clientes 'fantasma' no Kommo que ficam de fora do cadastro unico e do bot.  
*Onde:* client/netlify/functions/kommo-leads-sync.mjs (telOf, linha 28) + RPC clientes_reconciliar

**763. Validar telefone e data de nascimento ao salvar o contrato**  `impacto medio · esforço baixo`
O formulario exige CPF, e-mail e CEP validos, mas telefone e data de nascimento so checam 'esta preenchido'. Um telefone com digitos faltando quebra o casamento com o Kommo, e uma data de nascimento absurda (ano 1900, futuro) atrapalha a regra de prioridade idoso e os aniversarios. Vale validar formato/intervalo desses dois campos.
*Benefício:* Evita dados ruins entrando no contrato que depois quebram CRM, cobranca e alertas de idoso.  
*Onde:* client/src/utils/validation.js (validateContratante) + client/src/App.jsx (validateChecklist)

**764. Tratar o caso 'CPF do segundo contratante igual ao primeiro'**  `impacto baixo · esforço baixo`
Quando o contrato tem dois contratantes, nada impede digitar o mesmo CPF nos dois (erro de copia-cola comum). Hoje nao ha mensagem alertando. Vale comparar os CPFs dos contratantes no momento de validar.
*Benefício:* Evita procuracao/contrato com a mesma pessoa listada duas vezes por engano.  
*Onde:* client/src/App.jsx (validateChecklist) + client/src/components/FormPanel.jsx

**765. Garantir que a etapa Asaas no import nao gere boleto duplicado**  `impacto medio · esforço medio`
Na importacao manual de contrato assinado, a etapa do Asaas cria as cobrancas. Se o operador clicar de novo ou reprocessar, pode gerar boletos repetidos para o mesmo cliente, pois nao ha checagem de 'ja existe cobranca para este contrato'. Vale usar uma referencia unica (ex.: o id do contrato) e checar antes de criar.
*Benefício:* Impede o cliente receber dois carnes pela mesma divida em reprocessamentos.  
*Onde:* client/src/utils/importContrato.js (step Asaas, linha 256) + client/netlify/functions/asaas-sync.mjs (externalReference)

**766. Validar o numero de processo CNJ antes de consultar o DataJud**  `impacto medio · esforço baixo`
A rotina que busca a data de distribuicao no DataJud monta o nome do tribunal a partir do numero do processo. Se o numero vier incompleto ou mal digitado no ADVBOX, a consulta falha em silencio e o contrato fica eternamente sem data de distribuicao. Vale validar o formato do numero (20 digitos no padrao CNJ) e registrar os que estao malformados.
*Benefício:* Menos processos travados sem data de distribuicao por causa de numero errado, e visibilidade de quais corrigir.  
*Onde:* client/netlify/functions/datajud-refresh.mjs (tribunalAlias, linha 43)

**767. Tirar as chaves (DataJud e Supabase) de dentro do codigo**  `impacto baixo · esforço baixo`
A funcao do DataJud tem a chave da API do CNJ e a chave do Supabase escritas direto no arquivo, em vez de virem de variavel de ambiente como as outras. Isso dificulta trocar a chave se vazar e faz o codigo guardar segredo. Vale move-las para variaveis de ambiente do Netlify, como o resto.
*Benefício:* Mais facil rotacionar chaves e menos risco se o codigo for exposto.  
*Onde:* client/netlify/functions/datajud-refresh.mjs (linhas 29 e 33)

**768. Detectar boleto orfao: cobranca no Asaas sem contrato no sistema**  `impacto medio · esforço medio`
O sistema espelha os boletos do Asaas, mas se um boleto foi criado no Asaas por fora (manualmente) ele fica sem amarra com nenhum contrato do CBC. Hoje nao ha um relatorio que mostre 'boletos no espelho que nao pertencem a nenhum contrato'. Uma checagem periodica via CPF/contractId revela esses casos.
*Benefício:* Encontra cobrancas perdidas e garante que toda receita do Asaas tem dono no sistema.  
*Onde:* tabela asaas_boletos + client/netlify/functions/_lib/asaasMirror.mjs (cruzar external_reference com contratos)

**769. Padronizar tipo de acao e resort com lista controlada**  `impacto medio · esforço medio`
Tipo de acao e resort sao texto livre quando o usuario escolhe 'outro' (resortCustom/tipoAcaoCustom). Isso cria variacoes do mesmo nome ('Thermas Sao Pedro' vs 'Thermas São Pedro' vs 'thermas') que bagunçam relatorios, dashboards e a deteccao de duplicata. Vale normalizar (acentos/maiusculas/espacos) na hora de salvar e oferecer sugestao de resort ja existente.
*Benefício:* Relatorios por resort/tipo de acao ficam confiaveis e a duplicata por resort funciona de fato.  
*Onde:* client/src/App.jsx (buildContratoRow, resolucao de resort/tipoAcao) + tabela empreendimentos

**770. Backup automatico do banco com restauracao testada**  `impacto alto · esforço baixo`
O backup completo roda hoje pelo servidor Node (03h, local + S3), mas esse servidor 'pouco usado' segundo a documentacao, e o grosso dos dados ja vive no Supabase. Vale confirmar que o Supabase Pro tem backup diario ligado (point-in-time) e fazer um teste real de restauracao, documentando o passo a passo, porque backup nunca testado pode nao funcionar na hora H.
*Benefício:* Garante que da para recuperar os contratos se algo der muito errado, sem surpresa no pior momento.  
*Onde:* server/index.js (cron de backup) + configuracao de backup do Supabase + docs/RUNBOOK.md

**771. Auto-recuperar o campo 'CPF do cliente' faltando no espelho Asaas**  `impacto baixo · esforço baixo`
No espelho de boletos, o CPF do cliente vem de um cache; se o cliente for novo, busca na API do Asaas. Quando essa busca falha, a linha fica com customer_cpf vazio, e ai esse boleto nunca casa com o contrato nem com o cadastro unico. Vale uma varredura periodica que completa os CPFs faltantes a partir do customer_id.
*Benefício:* Boletos deixam de ficar sem CPF, melhorando inadimplencia por cliente e o cadastro unico.  
*Onde:* client/netlify/functions/_lib/asaasMirror.mjs (paymentRow/processBlock) + asaas-sync-customers.mjs

**772. Bloquear CPF de teste/sequencial alem do checksum**  `impacto baixo · esforço baixo`
A validacao de CPF ja confere os digitos verificadores (otimo), mas alguns CPFs conhecidos de teste passam por serem matematicamente validos. Vale manter uma pequena lista de CPFs notoriamente de teste/exemplo para barrar, evitando que entrem num contrato real por engano.
*Benefício:* Reduz contratos com CPF de teste que poluem cadastro, cobranca e relatorios.  
*Onde:* client/src/utils/validation.js (validateCPF)

**773. Registrar versao/historico das migracoes ja aplicadas**  `impacto baixo · esforço baixo`
Os arquivos supabase_*.sql sao o historico das mudancas de banco, mas nao ha uma tabela que registre qual ja foi aplicada e quando. Em banco compartilhado entre varios apps do escritorio, isso ajuda a saber o estado real e evitar rodar duas vezes ou esquecer uma migracao.
*Benefício:* Evita rodar migracao errada ou repetida no banco compartilhado e da rastreabilidade.  
*Onde:* raiz do projeto (supabase_*.sql) + tabela de controle de migracoes no Supabase

**774. CPF/CNPJ salvo COM pontinhos, mas a busca de duplicata procura SO numeros**  `impacto alto · esforço baixo`
Quando um contrato e salvo, o CPF vai para a coluna de busca do banco no formato '000.000.000-00' (com pontos e traco). Mas a verificacao de duplicata limpa o CPF para so numeros antes de comparar. Como um nunca e igual ao outro, a comparacao quase nunca casa.
*Benefício:* Faz o aviso de 'cliente ja tem contrato neste resort' realmente disparar, evitando contratos repetidos e cobrancas em dobro.  
*Onde:* client/src/App.jsx (buildContratoRow, linhas 199/202) + client/src/utils/duplicateDetector.js

**775. Existem DUAS funcoes que montam a linha do contrato — e elas podem divergir**  `impacto medio · esforço medio`
O cadastro normal (App.jsx) e a importacao de contrato assinado (importContrato.js) tem cada um a sua propria copia da funcao que preenche as colunas de busca (nome, CPF, resort, honorarios). Se uma for ajustada e a outra nao, contratos importados ficam com dados diferentes dos cadastrados.
*Benefício:* Garante que todo contrato — cadastrado ou importado — tenha exatamente os mesmos campos preenchidos do mesmo jeito.  
*Onde:* client/src/App.jsx::buildContratoRow e client/src/utils/importContrato.js::buildContractRow

**776. Colunas de busca podem 'envelhecer' e contradizer o dado real do contrato**  `impacto medio · esforço medio`
O contrato guarda os dados completos num campo unico (JSONB 'dados'), e separadamente copia nome/CPF/resort/valores para colunas usadas em listas e relatorios. Se alguem corrigir o dado completo depois (ou ao importar), essas colunas nao sao reescritas — Dashboard e busca passam a mostrar o valor antigo.
*Benefício:* Listas, dashboard e export Excel sempre batem com o conteudo real do contrato.  
*Onde:* Tabela contratos (colunas denormalizadas) + qualquer ponto que faca update sem reprocessar buildContratoRow

**777. Conferir todo dia se houve pagamento recebido sem nota fiscal emitida**  `impacto alto · esforço medio`
Hoje a nota fiscal e emitida na hora que o pagamento e confirmado. Se essa emissao falhar (config fiscal, fora do ar), o sistema apenas anota um erro no Monitor, mas nada volta depois para tentar de novo nem lista os casos pendentes. Um pagamento pode ficar sem nota e ninguem percebe.
*Benefício:* Nenhum cliente que pagou fica sem nota fiscal; evita problema fiscal e retrabalho manual.  
*Onde:* client/netlify/functions/asaas-webhook.mjs (so loga erro) — falta um cron de reconciliacao NF

**778. Checar coerencia dos honorarios: total tem que bater com parcelas x valor da parcela**  `impacto medio · esforço baixo`
Nada impede salvar, por exemplo, total R$ 3.000 mas '3 parcelas de R$ 800' (que daria R$ 2.400). O percentual de exito tambem nao e limitado entre 0 e 100. Esses numeros vao para o contrato, para o Asaas e para o BI.
*Benefício:* Evita boleto com valor errado e contrato com numeros que nao fecham, que geram discussao com o cliente.  
*Onde:* client/src/components/FormPanel.jsx (secao Honorarios) + validacao no salvar

**779. Datas podem 'pular um dia' por causa de fuso horario**  `impacto medio · esforço baixo`
Em varios pontos a data e montada como meio-dia ('T12:00:00') justamente para nao virar o dia, mas em outros lugares se usa data crua ou hora UTC. Isso deixa a porta aberta para data de vencimento, assinatura ou nascimento aparecer um dia antes/depois do correto.
*Benefício:* Datas de vencimento, assinatura e aniversario sempre corretas — evita boleto vencendo no dia errado.  
*Onde:* Padronizar tratamento de data em importContrato.js, asaas-sync.mjs, datajud-refresh.mjs

**780. Garantir o vinculo de mao dupla entre boleto do Asaas e contrato**  `impacto medio · esforço medio`
Ao criar a cobranca, o sistema manda o ID do contrato como 'referencia externa' no Asaas. Mas nao ha uma conferencia periodica garantindo que todo boleto pago aponte para um contrato existente e vice-versa. Se esse vinculo quebra, o boleto vira 'orfao' e a baixa/relatorio fica errada.
*Benefício:* Cada cobranca sempre sabe a qual contrato pertence — relatorios de recebimento e inadimplencia confiaveis.  
*Onde:* client/netlify/functions/asaas-sync.mjs (externalReference) + espelho asaas_boletos

**781. Padronizar e-mail (minusculo, sem espaco) antes de salvar e comparar**  `impacto medio · esforço baixo`
O e-mail e usado pelo ZapSign para enviar a assinatura e pelo Asaas para o cliente. Hoje ele e salvo do jeito que foi digitado, podendo ter espaco no fim ou letras maiusculas — o que atrapalha encontrar o mesmo cliente em sistemas diferentes e pode falhar no envio.
*Benefício:* Menos falha de envio de assinatura/cobranca e melhor casamento do mesmo cliente entre os sistemas.  
*Onde:* client/src/utils/validation.js (validateEmail) + normalizacao no buildContratoRow

**782. Espelho do Kommo guarda so o primeiro telefone do contato**  `impacto baixo · esforço medio`
Como o casamento de cliente com o Kommo e feito por telefone, e a importacao do Kommo so pega o primeiro numero de cada contato, clientes que tem celular + fixo (ou dois numeros) podem nao casar e ficar de fora do registro mestre.
*Benefício:* Mais clientes corretamente vinculados ao Kommo — menos 'cliente sem lead' e melhor automacao de WhatsApp.  
*Onde:* client/netlify/functions/kommo-leads-sync.mjs (telOf pega so phones[0])

**783. Confiar cegamente na data de assinatura que vem do ADVBOX**  `impacto baixo · esforço baixo`
A rotina do DataJud copia a 'data de fechamento' do ADVBOX direto para a data de assinatura do contrato, sem checar se e uma data plausivel (nao no futuro, nao anterior a criacao do contrato). Uma data digitada errada no ADVBOX entra no nosso sistema e distorce o tempo-ate-assinatura no Dashboard.
*Benefício:* Indicadores de jornada e tempo de assinatura ficam confiaveis, sem datas absurdas.  
*Onde:* client/netlify/functions/datajud-refresh.mjs (sigDate -> signed_at, linha 152)

**784. Numero do RG entra de qualquer jeito e nao ajuda a identificar o cliente**  `impacto baixo · esforço baixo`
O campo RG aceita praticamente qualquer texto (a mascara nem limpa de verdade). Como cada estado tem um formato, fica dificil usar o RG para conferir se e a mesma pessoa. Vale ao menos guardar so um RG 'limpo' e exigir orgao emissor/UF.
*Benefício:* Procuracao e contrato com RG mais consistente; um dado a mais para identificar a pessoa certa.  
*Onde:* client/src/utils/masks.js (maskRG) + client/src/components/FormPanel.jsx

**785. Guardar um relatorio do que NAO casou na reconciliacao de clientes**  `impacto medio · esforço medio`
Toda noite o sistema tenta unificar o mesmo cliente entre Asaas/Kommo/ADVBOX por CPF. Mas o resultado e so um numero ('X reconciliados'). Nao fica registrado quais clientes ficaram sem CPF, com CPF conflitante ou nome muito diferente — justamente os casos que precisam de olho humano.
*Benefício:* Cria uma lista de pendencias real para a equipe limpar, em vez de problemas invisiveis acumulando.  
*Onde:* client/netlify/functions/clientes-reconciliar.mjs + RPC clientes_reconciliar (retornar lista de exceções)


## 26. Documentacao & Manutenibilidade  *(34)*

**786. README do projeto ainda e o modelo generico do Vite**  `impacto alto · esforço baixo`
O arquivo README.md dentro de client/ tem apenas o texto padrao que vem com qualquer projeto novo React+Vite ('This template provides a minimal setup...'). Nao diz uma palavra sobre o CBC Contratos, como rodar, fazer deploy ou onde estao as coisas. Um programador novo (ou voce mesmo daqui a 6 meses) abre o repositorio e a primeira coisa que ve nao ensina nada sobre o sistema real.
*Benefício:* Quem chega ao codigo entende o projeto em minutos, sem depender de te perguntar tudo.  
*Onde:* client/README.md (substituir pelo conteudo real: o que e, como rodar, deploy, link pro CLAUDE.md)

**787. CLAUDE.md com numeros desatualizados (40 funcoes, na verdade sao 49)**  `impacto medio · esforço baixo`
O guia principal (CLAUDE.md) diz que ha '40 Netlify Functions', '5 bibliotecas compartilhadas' e '43 componentes'. Na realidade hoje sao 49 funcoes, 9 bibliotecas e 44 componentes. Funcoes novas inteiras (videochamadas na Agenda, fila do Kommo, reconciliacao de clientes, sincronizacao Kommo-Asaas) e bibliotecas novas (googleAgenda, nfseAmericana, advboxMaps, kommoQueue) nem aparecem na lista. Quem le o guia confia em informacao errada.
*Benefício:* O mapa do sistema volta a bater com a realidade, evitando que alguem procure ou recrie algo que ja existe.  
*Onde:* CLAUDE.md secoes 2 e 3 (contagens e lista de funcoes/_lib)

**788. .env.example so documenta backup da Amazon, falta o resto**  `impacto medio · esforço baixo`
O arquivo .env.example serve de 'lista de chaves que o sistema precisa para funcionar'. Hoje ele lista apenas as 4 variaveis do backup S3 (Amazon). Faltam TODAS as chaves criticas que o CLAUDE.md descreve: Supabase, ADVBOX, ZapSign, Asaas, Kommo, ZapSign, push do Portal etc. Quem for montar um ambiente novo nao tem como saber o que configurar sem garimpar o guia inteiro.
*Benefício:* Montar um ambiente novo (ou recuperar apos um problema) deixa de ser adivinhacao.  
*Onde:* .env.example (raiz) e criar um client/.env.example com as VITE_* e as chaves das functions

**789. Migracoes do banco de junho nao tem arquivo .sql guardado**  `impacto alto · esforço medio`
As mudancas de estrutura do banco de dados sao guardadas em arquivos supabase_*.sql na raiz. Mas o arquivo mais novo e de 11/junho. Varias mudancas feitas depois (trava de nota fiscal, colunas de videochamadas, tabela de clientes unificados, colunas do Kommo) foram aplicadas direto no banco 'pela ferramenta', sem deixar o arquivo correspondente. Se o banco precisar ser recriado ou auditado, parte da historia recente esta so na memoria do Supabase, nao no codigo.
*Benefício:* Garante que o banco inteiro possa ser reconstruido e auditado a partir do repositorio.  
*Onde:* Raiz do projeto (supabase_*.sql) — exportar as migrations de junho aplicadas via MCP

**790. Codigos cripticos no codigo (#112, R8, integ-5) sem dicionario**  `impacto medio · esforço medio`
Espalhados pelo codigo ha centenas de comentarios com marcadores tipo '(#112)', '(#96)', '(R8)', '(integ-5)', '(observ-12)'. Eles apontam para itens numerados das grandes listas de sugestoes (SUGESTOES_*.md), mas quem le o codigo nao tem como saber disso nem achar o numero correspondente facilmente. Para um leitor novo, parecem ruido. O comentario deveria explicar o PORQUE, nao referenciar um numero perdido.
*Benefício:* Comentarios passam a explicar a razao da mudanca em vez de apontar para um documento que ninguem acha.  
*Onde:* client/src/ (varios arquivos com marcadores #/R/integ/observ) + criar um indice ou substituir por texto explicativo

**791. Pasta de backups (176 MB) versionada junto com o codigo**  `impacto medio · esforço baixo`
A pasta backups/ guarda copias datadas dos arquivos antes de cada mudanca — otima pratica de seguranca. Mas ela ja tem 176 MB e contem codigo morto (o wizard antigo Stepper/steps). Apesar de o .gitignore aparentemente ignorar 'backups/', o git status mostra arquivos dentro dela sendo movidos/rastreados. Misturar 176 MB de copias historicas com o codigo vivo deixa o repositorio pesado e confunde quem tenta entender o que e codigo de verdade.
*Benefício:* Repositorio mais leve e claro; ninguem confunde backup velho com codigo atual.  
*Onde:* backups/ + .gitignore (garantir que esta de fato fora do git; mover o historico para fora do repo ou para storage)

**792. Documentos de apoio (RUNBOOK, Checklist) citam telas que nao existem mais**  `impacto medio · esforço baixo`
Os guias operacionais docs/RUNBOOK.md e docs/SMOKE_CHECKLIST.md ainda mencionam a aba 'Leads' e o 'ChatGuru', que foram removidos do sistema. O RUNBOOK fala em 'polling de Leads'. Se acontecer um problema de verdade e alguem abrir o runbook em panico, parte das instrucoes aponta para coisas que nao existem mais — exatamente na hora errada para descobrir isso.
*Benefício:* Os guias de emergencia voltam a ser confiaveis quando mais importam.  
*Onde:* docs/RUNBOOK.md e docs/SMOKE_CHECKLIST.md (remover referencias a Leads/ChatGuru)

**793. Excesso de documentos de 'sugestoes' soltos confunde o que e atual**  `impacto medio · esforço medio`
Na raiz e em docs/ existem 10+ arquivos enormes de sugestoes (SUGESTOES_MELHORIAS, SUGESTOES_AUDITORIA, SUGESTOES_PORTAL_*, SUGESTOES_INEDITAS, POSBOT...) somando mais de meio megabyte de texto. Alguns sao de meses atras e ja foram parcialmente implementados. Sem um indice dizendo 'este aqui esta valendo, aquele ja foi feito', e impossivel saber o que ainda importa — e o proprio CLAUDE.md admite que 'parte das sugestoes foi gerada a partir do guia defasado'.
*Benefício:* Para de gastar tempo relendo ideias velhas ou ja implementadas; foco no que falta.  
*Onde:* Raiz e docs/ (SUGESTOES_*.md) — criar um indice/INDICE.md marcando status: feito / pendente / descartado

**794. Arquivos legados do ChatGuru e Leads ainda no repositorio**  `impacto baixo · esforço baixo`
Os arquivos supabase_chatguru_automations.sql e supabase_leads.sql continuam na pasta, mesmo apos o ChatGuru e a aba Leads terem sido removidos do sistema. O proprio CLAUDE.md chama esses arquivos de 'legado inerte'. Eles nao fazem mal, mas dao a impressao errada de que essas funcionalidades existem, e poluem a lista de migracoes do banco para quem esta tentando entender o que esta ativo.
*Benefício:* A lista de migracoes passa a refletir so o que esta vivo, sem pistas falsas.  
*Onde:* supabase_chatguru_automations.sql e supabase_leads.sql (mover para uma subpasta _legado/ ou para backups)

**795. Arquivos de migracao sem ordem clara de aplicacao**  `impacto baixo · esforço baixo`
Os arquivos de banco se chamam supabase_setup, _v2, _upgrade, _p1_scale, _bot_advbox etc., sem numero indicando a ordem em que devem ser rodados. Para alguem recriar o banco do zero, nao ha como saber a sequencia certa olhando os nomes (precisa adivinhar pela data do arquivo). Uma numeracao (001_, 002_...) ou um README listando a ordem resolveria.
*Benefício:* Recriar o banco do zero vira um passo-a-passo claro em vez de tentativa e erro.  
*Onde:* Raiz (supabase_*.sql) — adicionar prefixo numerico ou um docs/MIGRATIONS.md com a ordem

**796. Arquivos gigantes de Vendas e Socios sem o aviso do guia**  `impacto medio · esforço baixo`
O CLAUDE.md e a avaliacao de refatoracao alertam sobre 3 'arquivos gigantes' (FormPanel ~2.000 linhas, ContratosTab ~2.165, App.jsx ~1.742). Mas dois arquivos AINDA MAIORES nao sao mencionados: VendasPanel.jsx (2.516 linhas, o maior de todos) e SociosDashboard.jsx (2.043). Eles tem o mesmo problema de 'gaveta lotada' — dificil de mexer com seguranca — e ficaram fora do radar.
*Benefício:* O plano de organizar o codigo passa a cobrir os arquivos realmente maiores, nao so os ja conhecidos.  
*Onde:* client/src/components/VendasPanel.jsx e SociosDashboard.jsx (incluir no plano de refatoracao do docs/AVALIACAO_REFATORACAO)

**797. Validacao de CPF escrita em 3 lugares diferentes**  `impacto medio · esforço baixo`
A regra que verifica se um CPF e valido aparece copiada em mais de um arquivo (a propria avaliacao de refatoracao aponta '3 copias'). Quando voce precisar mudar essa regra (por exemplo, aceitar um formato novo), tem que lembrar de mudar nos 3 lugares — e e facil esquecer um, gerando um bug em que o CPF passa numa tela e e barrado em outra. Deveria existir uma unica funcao de verdade, usada por todos.
*Benefício:* Acaba o risco de 'mudei aqui mas esqueci ali'; comportamento igual em todo o sistema.  
*Onde:* client/src/utils/validation.js (consolidar as copias de validacao de CPF)

**798. Metade dos utilitarios sem teste automatizado**  `impacto medio · esforço medio`
Existem 27 modulos utilitarios (geracao de PDF/DOCX, mascaras, OCR, calculos) e apenas 11 tem teste automatizado. Modulos sensiveis como geracao de PDF, importacao de contrato e calculo de comissao nao tem rede de seguranca. Teste automatizado e como um 'alarme' que avisa se uma mudanca quebrou algo — sem ele, so se descobre o problema quando ja esta em producao e um contrato saiu errado.
*Benefício:* Mudancas futuras avisam na hora se quebraram algo, antes de chegar ao cliente.  
*Onde:* client/src/utils/__tests__/ — priorizar pdfGenerator, importContrato, commissionClient, masks de moeda

**799. Sem um glossario das permissoes e abas (RBAC) num lugar so**  `impacto medio · esforço baixo`
Quem pode ver cada aba e controlado por chaves em user_permissions.tabs (ex: 'bot', 'funil', 'novo', 'contratos'). Essas chaves estao espalhadas pelo codigo e a relacao 'chave -> nome da aba -> quem deve ter' nao esta num lugar unico e legivel. A propria avaliacao nota que 'as permissoes estao espalhadas em 3 lugares'. Para um admin ou dev entender quem ve o que, precisa cacar no codigo.
*Benefício:* Fica obvio quais sao as abas, suas chaves e quem deve ter acesso, sem ler codigo.  
*Onde:* App.jsx (registro de abas/tabAllowed) + criar uma tabela no CLAUDE.md ou docs/RBAC.md

**800. Pasta server/ tem versao 'modular' e 'monolito' convivendo ha meses**  `impacto baixo · esforço medio`
O backend Node (server/) tem duas versoes do mesmo codigo: o arquivo monolito index.js (que e o que realmente roda) e uma pasta src/ 'modular e organizada' que foi escrita para substitui-lo, mas a troca nunca foi concluida. Quem abre essa pasta nao sabe qual e a versao real, podendo editar o arquivo errado e ver que 'nada mudou'. Isso esta documentado como divida tecnica mas segue assim.
*Benefício:* Acaba a confusao de editar a versao errada do backend; um caminho unico e claro.  
*Onde:* server/index.js vs server/src/ — decidir o cutover ou marcar claramente o src/ como nao-usado

**801. Comentarios bons no _lib, mas sem um indice das integracoes**  `impacto medio · esforço baixo`
As bibliotecas compartilhadas (client/netlify/functions/_lib/) sao bem comentadas individualmente, mas nao ha um documento curto que diga 'temos 9 bibliotecas, esta cuida do ADVBOX, esta da fila do Kommo, esta da nota fiscal de Americana'. Para entender como as automacoes conversam entre si (ADVBOX, Kommo, Asaas, Agenda), o dev precisa abrir arquivo por arquivo. Um mapa de uma pagina economizaria horas.
*Benefício:* Um novo dev entende o esqueleto das integracoes de servidor numa olhada.  
*Onde:* client/netlify/functions/_lib/ — criar um _lib/README.md de uma pagina mapeando cada biblioteca

**802. Arquivos de relatorio efemeros (.pdf, .html, hook.cache.json) misturados ao codigo**  `impacto baixo · esforço baixo`
Dentro de docs/ ha um PDF de 486 KB e um HTML de 33 KB (plano de 'messenger interno') que sao relatorios pontuais, nao documentacao viva. E dentro de _lib/ ha uma pasta escondida .impeccable/ com um hook.cache.json (cache de uma ferramenta). Esses arquivos 'de passagem' misturados com o codigo e os guias dificultam separar o que e referencia permanente do que foi gerado uma vez e esquecido.
*Benefício:* Pasta de documentacao fica so com o que e referencia de verdade, mais facil de navegar.  
*Onde:* docs/MESSENGER_INTERNO_*.pdf/.html e client/netlify/functions/_lib/.impeccable/ (arquivar ou ignorar no git)

**803. Crons e webhooks documentados so no CLAUDE.md, longe do codigo**  `impacto baixo · esforço baixo`
Os horarios das tarefas automaticas (sincronizar ADVBOX as 6h30, cobranca as 10h30 etc.) e quais webhooks o sistema recebe estao numa tabela so no CLAUDE.md. Como os horarios de verdade vivem dentro de cada funcao (.mjs), e facil mudar um horario no codigo e esquecer de atualizar a tabela — ou vice-versa. Um leitor nao sabe qual fonte e a verdadeira.
*Benefício:* Os horarios e gatilhos das automacoes param de divergir entre o guia e o codigo real.  
*Onde:* CLAUDE.md secao 8 (tabela de crons) vs schedule dentro de cada client/netlify/functions/*.mjs

**804. Cores fixas no codigo escondem dependencias e quebram o modo escuro**  `impacto medio · esforço medio`
Existem cerca de 176 cores escritas 'na mao' no codigo (ex: #1B3A5C) em vez de usar os nomes padrao do sistema (var(--cbc-navy)). Alem de quebrar o modo escuro (a avaliacao ja aponta isso), do ponto de vista de manutencao e ruim: se a marca mudar um tom, alguem tem que cacar 176 lugares. Usar sempre o 'nome' da cor deixa a regra num lugar so e o codigo mais facil de ler.
*Benefício:* Trocar uma cor da marca vira uma mudanca em um lugar, nao uma cacada por 176.  
*Onde:* client/src/components/FormPanel.jsx e ContratosTab.jsx (trocar hex por tokens --cbc-*)

**805. Faltam comentarios de 'porque' nos numeros magicos das integracoes**  `impacto medio · esforço baixo`
O codigo tem varios numeros fixos sem explicacao do que sao: IDs de etapa/funil do Kommo, IDs de campo (ex: 2433130), responsavel padrao do ADVBOX (241495), estagio 3795429. Alguns estao explicados no CLAUDE.md, mas no codigo aparecem como numeros soltos. Quem le nao sabe que '241495' e o Paulo, ou que '2392340' e 'Revisao de Distrato'. Um comentario curto ao lado de cada um evita erros perigosos (mexer no numero errado muda para onde o processo vai).
*Benefício:* Reduz o risco de alguem alterar um ID critico sem saber o que ele controla.  
*Onde:* client/netlify/functions/_lib/advboxMaps.mjs, advbox-sync.mjs e constantes de IDs Kommo

**806. Estrutura de pastas do CLAUDE.md (secao 3) defasada vs realidade**  `impacto baixo · esforço baixo`
A 'arvore de pastas' desenhada no CLAUDE.md secao 3 ainda mostra a pasta steps/ e Stepper.jsx como codigo morto presente, mas eles ja foram movidos para backups. Tambem nao mostra as subpastas novas de componentes (ui/ com StatusPill, StatusDot, HealthCard; funnel/). Quem usa a arvore como mapa acaba procurando arquivos no lugar errado.
*Benefício:* O mapa de pastas volta a corresponder ao que existe de verdade no disco.  
*Onde:* CLAUDE.md secao 3 (atualizar a arvore: remover steps/Stepper, adicionar components/ui e funnel)

**807. Sem documento 'onboarding de 1 pagina' para um dev novo**  `impacto medio · esforço baixo`
Toda a documentacao de arquitetura esta concentrada num CLAUDE.md gigante de 61 KB, escrito como changelog cronologico (otimo para a IA, denso para humano). Nao existe um 'comece por aqui' de uma pagina: o que e o sistema, como rodar local, onde estao as 3 partes (frontend / functions / banco), e os 5 arquivos mais importantes. Um dev novo (ou um substituto seu) levaria horas so para se localizar.
*Benefício:* Uma pessoa nova fica produtiva no mesmo dia, sem depender so de voce.  
*Onde:* Raiz — criar um ONBOARDING.md curto que aponta para o CLAUDE.md para detalhes

**808. REGRA #10 manda editar um arquivo que ja foi apagado**  `impacto alto · esforço baixo`
O proprio guia (CLAUDE.md) tem uma contradicao interna: a parte de cima diz que o arquivo 'advboxService.js' foi REMOVIDO, mas a Regra #10 (mais abaixo) ainda manda 'nunca alterar o mapeamento de tipo de acao sem atualizar a tabela em advboxService.js'. Esse arquivo nao existe mais — o mapa virou outro arquivo (advboxMaps.mjs). Um dev seguindo a regra ficaria perdido procurando um arquivo fantasma.
*Benefício:* Evita que alguem mexa no lugar errado e quebre a integracao com o CRM juridico (ADVBOX), que e onde os processos sao lancados.  
*Onde:* CLAUDE.md (Regra #10 e Secao 3 ainda citam advboxService.js; a real e _lib/advboxMaps.mjs)

**809. Numero da versao bate em 3 lugares e da 3 respostas diferentes**  `impacto medio · esforço baixo`
Qual e a versao do sistema hoje? O changelog da tela diz 6.6.1, o guia (CLAUDE.md) diz 6.6.0 e o arquivo tecnico package.json diz 0.0.0 (ou seja, nunca foi preenchido). Sao tres fontes que se contradizem. Quem chega novo nao sabe em qual confiar, e na hora de um problema fica dificil saber qual versao esta no ar.
*Benefício:* Uma versao unica e confiavel facilita rastrear bugs ('isso quebrou na 6.6.1') e da seriedade ao sistema.  
*Onde:* client/src/components/ChangeLog.jsx (6.6.1) x CLAUDE.md (6.6.0) x client/package.json (0.0.0)

**810. Existe uma 'caixa de pecas reutilizaveis' que o guia nem menciona**  `impacto medio · esforço baixo`
Tem uma pasta client/src/components/ui/ com pecas visuais prontas e reaproveitaveis (bolinha de status, etiqueta de status, valor em dinheiro formatado, etc.) usadas em varias telas. Mas o guia do projeto nao cita essa pasta. Um dev novo provavelmente recriaria essas pecas do zero, gerando codigo duplicado e visual inconsistente. Pior: uma dessas pecas (HealthCard) nao e usada por ninguem — e codigo morto.
*Benefício:* Documentar as pecas prontas faz o time reaproveitar em vez de reinventar, mantendo o visual igual em todo lugar.  
*Onde:* client/src/components/ui/ (6 componentes; HealthCard.jsx tem 0 usos)

**811. Bibliotecas de integracao novas estao 'invisiveis' no guia**  `impacto medio · esforço baixo`
O coracao das automacoes sao bibliotecas compartilhadas (pasta _lib). O guia diz que sao 5 (ADVBOX, Kommo, banco do bot, motor do bot, Asaas), mas hoje sao 9 — entrarem 4 novas sem registro: mapas do ADVBOX, Google Agenda, fila do Kommo e nota fiscal de Americana. Quem precisa mexer numa dessas integracoes nao sabe que elas existem nem o que cada uma faz.
*Benefício:* Mapear todas as 'engrenagens' de integracao acelera muito quem precisa consertar ou evoluir o envio de NF, agenda, ou fila do Kommo.  
*Onde:* client/netlify/functions/_lib/ (9 libs reais; CLAUDE.md cita 5)

**812. As telas mais perigosas de mexer sao as que nao tem nenhuma explicacao no topo**  `impacto medio · esforço baixo`
Alguns arquivos comecam com um cabecalho curto dizendo o que a tela faz (otimo). Mas justamente os maiores e mais arriscados — Novo Contrato, Contratos Salvos, painel de Vendas, Asaas, Boletos, Admin — comecam direto no codigo, sem uma linha explicando o que fazem nem como estao organizados por dentro. Sao os arquivos onde um erro custa mais caro, e sao os menos documentados.
*Benefício:* Um paragrafo no topo de cada tela grande poupa horas de leitura e reduz o risco de quebrar algo por nao entender o contexto.  
*Onde:* client/src/components/FormPanel.jsx, ContratosTab.jsx, VendasPanel.jsx, AsaasPanel.jsx, BoletosPanel.jsx, AdminPanel.jsx (comecam sem cabecalho)

**813. Lista de resorts vive em dois lugares (e ja tem duplicata escrita errado)**  `impacto medio · esforço medio`
Os ~99 resorts ficam fixos numa lista no codigo (clausulas.js) E tambem numa tabela do banco (empreendimentos), que e alimentada a partir do codigo. Nao esta claro qual e a 'lista oficial' — e ja ha sinais de bagunca: 'Ibiobi Smart Club' e 'Ibiomi Smartclub' parecem o mesmo resort escrito de dois jeitos. Sem uma regra clara, vao surgir mais duplicatas e nomes divergentes nos contratos.
*Benefício:* Definir a fonte oficial dos resorts evita nomes errados saindo em contrato (que tem valor juridico) e relatorios bagunçados.  
*Onde:* client/src/data/clausulas.js (RESORTS) + tabela empreendimentos (hook useEmpreendimentos.js)

**814. Dois guias quase iguais (CLAUDE.md e PRODUCT.md) sem dizer quem manda**  `impacto baixo · esforço baixo`
Existem dois documentos grandes descrevendo o produto: o CLAUDE.md (62 mil caracteres, com historico) e o PRODUCT.md (mais enxuto, focado em proposito/design). Eles se sobrepoem bastante e nenhum diz 'leia este primeiro' ou 'aquele e so um resumo'. Com o tempo um vai ficar desatualizado em relacao ao outro e ninguem vai saber qual e a verdade.
*Benefício:* Deixar claro 'PRODUCT.md = visao curta, CLAUDE.md = guia tecnico completo' evita versoes conflitantes da mesma informacao.  
*Onde:* CLAUDE.md e PRODUCT.md (raiz do projeto)

**815. A pasta de documentos nao tem um 'indice' que diga o que e atual**  `impacto medio · esforço baixo`
A pasta docs/ tem 17 arquivos (runbooks, especificacoes, avaliacoes, sugestoes) sem nenhum indice. Nao da pra saber, batendo o olho, qual e vivo, qual e historico e qual ja foi resolvido. Ex.: a avaliacao de refatoracao de 27/06 (a mais recente e relevante) nao e citada em lugar nenhum do guia principal. Um dev novo nao sabe por onde comecar a ler.
*Benefício:* Um indice de 1 tela (com 'comece por aqui' e status de cada doc) corta o tempo de entendimento do sistema pela metade.  
*Onde:* docs/ (17 arquivos, sem README/indice; AVALIACAO_REFATORACAO_2026-06.md nao referenciado no CLAUDE.md)

**816. Um PDF de 475 KB e seu clone em HTML estao no repositorio sem ninguem usar**  `impacto baixo · esforço baixo`
Dentro de docs/ ha um plano de 'messenger interno' salvo em DUAS copias do mesmo conteudo — um PDF de 475 KB e um HTML de 33 KB — e nenhum dos dois e citado em qualquer outro documento. Arquivos binarios pesados assim incham o repositorio (deixam o download do projeto mais lento) e poluem as buscas, sem agregar nada ao codigo.
*Benefício:* Tirar binarios orfaos deixa o projeto mais leve e a pasta de docs mais facil de garimpar.  
*Onde:* docs/MESSENGER_INTERNO_VIABILIDADE_PLANO_20260614.pdf e .html (475 KB + 33 KB, nao referenciados)

**817. O checklist de teste manda 'avancar no wizard' que nao existe mais**  `impacto medio · esforço baixo`
O documento SMOKE_CHECKLIST (a lista de conferencias rapidas antes de subir uma versao) ainda manda checar 'o wizard mostra o Passo 1' e 'a aba Leads carrega'. So que o formulario nao e mais um wizard de passos e a aba Leads foi removida. Quem usar esse checklist vai procurar telas que sumiram e perder confianca no documento inteiro.
*Benefício:* Um checklist que bate com a tela real volta a ser util para pegar erros antes de chegar ao cliente.  
*Onde:* docs/SMOKE_CHECKLIST.md (itens 'wizard Step 1' e aba 'Leads')

**818. O nome do escritorio aparece de 4 jeitos e a sigla 'CBC' nunca e explicada**  `impacto baixo · esforço baixo`
No sistema o escritorio aparece como 'CBC Advogados', 'Conforto, Bergonsi & Cavalari Advogados' e variacoes. O guia usa 'CBC' o tempo todo mas nunca explica que CBC = Conforto, Bergonsi & Cavalari. Para quem chega de fora, a sigla e um misterio, e a falta de um nome 'oficial' unico atrapalha ate textos que vao ao cliente (PDF de boletos, mensagem do portal).
*Benefício:* Padronizar o nome (e explicar a sigla uma vez) deixa documentos ao cliente consistentes e o onboarding mais claro.  
*Onde:* CLAUDE.md (sigla nao expandida) + variacoes em App.jsx, LoginScreen.jsx, ClientFormQR.jsx, PortalClientePanel.jsx

**819. Datas no nome dos documentos viram um cemiterio de versoes**  `impacto medio · esforço medio`
Varios documentos tem a data cravada no nome do arquivo (ex.: SUGESTOES_PORTAL_20260611, _ANSIEDADE_20260611, _HOLISTICO_20260613, AUDITORIA_20260614...). Isso cria uma pilha de arquivos 'congelados no tempo' que ninguem sabe se ainda valem. Em vez de atualizar um documento, cria-se outro com data nova — e a verdade fica espalhada em meia duzia de copias parecidas.
*Benefício:* Manter um documento vivo por tema (em vez de um novo por data) evita que o time leia uma versao velha sem perceber.  
*Onde:* Raiz e docs/: 7+ arquivos com data no nome (SUGESTOES_*_2026..., AVALIACAO_REFATORACAO_2026-06.md)

