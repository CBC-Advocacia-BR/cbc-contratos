# Análise geral + sugestões — 11/06/2026 (pós-portal)

> Complementa SUGESTOES_POSBOT_20260610.md (50 itens). Foco no que ficou
> possível com o que foi construído em 09–11/06: espelho ADVBOX + Asaas em
> tempo real, bot com financeiro e métricas, portal do cliente completo
> (jornada, equipe, pagamentos, acordo, contrato), aba admin com diagnóstico
> de vínculos e relatórios PDF/Excel.
> Esforço: ⚡ horas · 🔨 1–3 dias · 🏗 projeto

## O ecossistema hoje (forças)
1. **Espelho de dados unificado**: ADVBOX (3,1k processos, 76k eventos),
   Asaas (11,7k boletos, tempo real via webhook), contratos, Kommo —
   tudo no mesmo Supabase, com log central no Monitor.
2. **Portal do cliente** mobile-first com história de valor coerente
   (jornada → equipe age → prazo cumprido → você não precisa fazer nada).
3. **Autoatendimento** em camadas: portal (self-service silencioso), bot
   WhatsApp (perguntas), equipe (exceções).
4. **Diagnóstico de integridade**: a aba admin mostra exatamente o que
   impede cada cliente de ter a experiência completa.

## Fragilidades estruturais (em ordem de risco)
1. Chaves no bundle/repo: Asaas key, anon key, Netlify token, BOT_PANEL_KEY
   via VITE_ (público por construção). RLS allow-all em ~100 tabelas.
2. Vínculo por NOME (`bi_processos.clientes ilike`) — homônimos e abreviações
   podem vazar processo de terceiro no portal. CPF ausente em 1.475 clientes.
3. Ninguém é AVISADO quando algo quebra — o Monitor mostra, mas é passivo
   (o sync de boletos ficou 9 dias parado sem ninguém notar).
4. Zero testes automatizados nos motores (bot, jornada, extrato, diagnóstico).
5. `asaas_customers` segue quebrado por RLS (chip de task pendente).

---

## A. Portal do cliente — próximo nível
1. ⚡ **QR Code do portal no contrato assinado** — o cliente já sai do
   onboarding com o link no bolso (lib de QR já existe no projeto).
2. ⚡ **Envio em massa dos 834 links prontos** — botão "enviar todos via
   WhatsApp" com fila (wa.me não automatiza; usar ChatGuru/Kommo API).
3. 🔨 **Login leve**: CPF + código de 6 dígitos via WhatsApp (tabela de
   tokens já é a base) — mata o risco de link vazado e habilita divulgação aberta.
4. 🔨 **Notificação de novidade**: monitor detecta andamento relevante →
   Salesbot manda "novidade no seu processo: [link do portal]" (opt-in).
5. ⚡ **Meta tags WhatsApp** (og:title/og:image) no portal.html — o link
   compartilhado vira um cartão bonito com o selo CBC.
6. 🔨 **Documentos do caso no portal**: petição inicial e sentença para
   download (Drive já integrado; só expor com segurança por token).
7. 🔨 **Tempo investido**: converter tarefas em horas estimadas por tipo
   ("nossa equipe já dedicou ~14h ao seu caso") — tabela de pesos por task.
8. ⚡ **Acordo concluído**: aba Acordo em modo "histórico" quando status=pago
   (hoje some — cliente perde o comprovante visual da prestação).
9. 🔨 **PWA**: manifest + ícone "instalar na tela inicial" — o portal vira
   "aplicativo do escritório" sem custo de app store.
10. 🏗 **Resumo executivo por IA** por mudança de fase (1 parágrafo humano,
    cache em bot_ai_cache) — exibido no portal e no widget Kommo.
11. ⚡ **Pesquisa de satisfação de 1 toque** no rodapé do portal (👍/👎 +
    comentário) gravando em tabela própria — NPS contínuo sem fricção.
12. 🔨 **Indique um amigo**: bloco no portal com link wa.me pré-escrito —
    cliente satisfeito virando canal de aquisição (origem rastreável).

## B. Bot — rota para produção
13. ⚡ **Criar o Salesbot no Kommo** (continua sendo o destrave nº 1 — 2 min).
14. 🔨 **Bot responde com link do portal**: toda resposta de andamento
    termina com "veja tudo em detalhe no seu portal: [link]" (gera token
    on-the-fly se não existir).
15. 🔨 **Rollout gradual**: flag por cliente (testadores → piloto 20 clientes
    → geral), kill-switch já existe.
16. ⚡ **Parametrizar Judicial + Recursal** (etapas) — transforma a resposta
    de "boa" em "excelente"; a aba Pendências mostra o que falta.
17. 🔨 **Métricas → ação**: alerta semanal com as top perguntas sem intenção
    cadastrada (fallbacks) — backlog automático de melhoria do bot.
18. 🔨 **Extrato pelo bot ganha botões** (Kommo suporta botões no Salesbot):
    "2ª via" | "PIX" | "Falar com financeiro".
19. 🏗 **Bot proativo de cobrança suave**: 3 dias antes do vencimento, manda
    boleto+PIX pelo WhatsApp (régua configurável; corta inadimplência na origem).
20. 🔨 **Handoff com resumo**: ao escalar para humano, postar nota no Kommo
    com as últimas 5 mensagens da conversa (bot_messages tem tudo).

## C. Financeiro e cobrança
21. 🔨 **Régua de cobrança automatizada**: D+1, D+7, D+15 do vencimento →
    WhatsApp com PIX (o relatório de inadimplência vira motor, não só foto).
22. ⚡ **Alerta de novo inadimplente**: cliente entra na lista → notificação
    no Monitor + e-mail (hoje só aparece se alguém gerar o relatório).
23. 🔨 **Painel de inadimplência vivo** (aba Boletos): os números do
    relatório como cards permanentes com tendência (↑↓ vs mês anterior).
24. 🔨 **Conciliação contrato × Asaas**: honorarios_total do contrato vs soma
    de boletos criados — divergência = parcela não gerada (receita esquecida).
25. 🔨 **Renegociação assistida**: botão no relatório de inadimplência que
    cria as novas parcelas no Asaas e exclui as antigas (fluxo hoje é manual).
26. ⚡ **Inadimplência no briefing de segunda** (quando existir — item 19 do
    doc anterior): total, novos da semana, recuperados.
27. 🏗 **Previsão de caixa**: parcelas futuras Asaas + fees_expec ponderado
    por fase do funil (probabilidade por etapa da jornada).
28. 🔨 **Recibo automático pós-pagamento**: webhook RECEIVED → WhatsApp
    "recebemos sua parcela X/Y, obrigado!" (o evento já chega em tempo real).

## D. Dados, BI e qualidade do espelho
29. ⚡ **Corrigir asaas_customers** (chip pendente) — mesmo padrão de RPC.
30. 🔨 **Capturar quem CONCLUIU a tarefa**: o monitor pode guardar
    users[].completed do /posts — hoje "última atividade" usa fallback do
    responsável designado (backfill não tem o nome).
31. 🔨 **Mutirão de CPF**: exportar os 1.475 sem CPF (botão já existe) +
    rotina da equipe; cada CPF preenchido destrava Asaas+portal+contrato.
32. ⚡ **bi_clientes.eh_pf persistido** (coluna calculada pelo snapshot) — o
    filtro PJ passa a valer para Power BI e futuras queries sem repetir regex.
33. 🔨 **Vínculo por ID, não por nome**: tabela cliente_processo
    (customer_id × lawsuit_id) alimentada pelo snapshot via /lawsuits
    customers[] — elimina o risco de homônimo no portal (segurança real).
34. 🔨 **Dashboard Power BI v1** (segue pendente): produtividade, atrasadas,
    carteira por fase, receita×despesa — os dados estão prontos há 2 dias.
35. ⚡ **Retenção programada**: advbox_api_log e bot_messages > 6 meses →
    limpeza mensal (padrão log_cleanup já existe no sistema).
36. 🔨 **Snapshot diário do funil**: gravar contagem por etapa/dia
    (bi_funil_historico) — habilita análise de velocidade e gargalo por fase.

## E. Segurança e confiabilidade
37. ⚡ **Segredo no webhook Kommo** (header validado) — hoje aberto; 15 min.
38. ⚡ **Rotacionar e tirar do bundle**: Asaas key (já está em env — remover
    fallback hardcoded do código), Netlify token do deploy.sh, KOMMO token.
39. 🔨 **Separar a chave do portal-admin** da BOT_PANEL_KEY (a VITE_ é
    pública por construção; ações de admin merecem chave server-side própria
    ou sessão Supabase Auth do usuário logado).
40. 🔨 **Alertas ativos do Monitor**: erro nível 'erro' em advbox_api_log →
    WhatsApp/e-mail para você (UptimeRobot no /api/health como segunda camada).
41. ⚡ **Watchdog do sync Asaas**: igual ao do backfill ADVBOX — se
    asaas_sync_status.heartbeat > 14h, redispara e loga aviso.
42. 🔨 **Testes dos motores puros**: jornadaIndice, _cliente_pf,
    classifyIntent, glossaryTranslate, numBR — ~1 dia, protege as
    parametrizações de regressão para sempre.
43. 🏗 **RLS de verdade por sistema** (o nº 1 estrutural): service key no
    Netlify + políticas reais tabela a tabela — projeto de uma sessão dedicada.
44. ⚡ **Backup das parametrizações**: export diário de bot_config +
    templates + flags (trabalho manual valioso, hoje sem cópia).

## F. Operação interna
45. 🔨 **Aba admin: histórico de envios** — registrar quando o link foi
    enviado (clique no WhatsApp) e mostrar "enviado em X" no card do cliente.
46. ⚡ **Filtro "nunca acessou"** na visão geral do portal admin — quem
    recebeu link e não abriu merece reenvio.
47. 🔨 **Acessos do portal como métrica**: gráfico de acessos/dia + ranking
    de clientes mais engajados (tabela já grava acessos/ultimo_acesso).
48. 🔨 **Diagnóstico agendado**: rodar portal_diagnostico 1×/semana e gravar
    histórico — ver se as inconsistências estão caindo (gestão por número).
49. ⚡ **Permissão "portal" pré-ligada** para o perfil admin no user_permissions
    (hoje cada usuário precisa ser habilitado manualmente).
50. 🔨 **Página de status interna**: /status com o farol dos 6 jobs (monitor,
    snapshot, sync boletos, webhook, bot, backfill) para a equipe consultar
    sem entrar no sistema.

## G. Crescimento
51. 🔨 **Vídeo-tutorial de 60s do portal** (link na 1ª mensagem de envio) —
    adoção é o que transforma o portal em redução real de ligações.
52. ⚡ **Assinatura de e-mail/WhatsApp da equipe** com link do portal do
    cliente — todo contato vira lembrete do canal.
53. 🏗 **Portal como argumento de venda**: seção no site institucional +
    print no material das vendedoras ("acompanhe seu processo 24h pelo celular").
54. 🔨 **Pesquisa pós-êxito com review Google** no encerramento (momento de
    máxima satisfação; o gatilho de fase já existe no monitor).

## Top 7 para a próxima sessão (ordem sugerida)
1. **#33 vínculo por ID** — único risco real de privacidade do portal; resolve homônimos de vez
2. **#13 Salesbot** — 2 minutos manuais que destravam o bot inteiro
3. **#40 alertas ativos** — o sistema já se vigia; falta ele te chamar
4. **#3 login leve por CPF+código** — pré-requisito para divulgar o portal em massa
5. **#21 régua de cobrança** — transforma R$ 61,7k em aberto em fluxo de recuperação
6. **#31 mutirão de CPF** — cada CPF preenchido destrava 3 integrações
7. **#42 testes dos motores** — barato agora, impagável depois
