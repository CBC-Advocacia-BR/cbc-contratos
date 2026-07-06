# Sugestões pós-Bot/BI — 10/06/2026

> Complementa SUGESTOES_MELHORIAS.md (356 itens, abril) e SUGESTOES_INEDITAS.md.
> Foco: o que ficou POSSÍVEL com a fundação construída em 09-10/06 (bot ADVBOX,
> espelho de BI no Supabase, log central de integrações, Power BI conectado).
> Esforço: ⚡ horas · 🔨 1-3 dias · 🏗 projeto (1+ semana)

## A. Destravar o que JÁ está pronto (maior retorno/esforço do mundo)
1. ⚡ **Criar o Salesbot no Kommo** (2 min manuais) — o bot de WhatsApp inteiro está pronto esperando isso.
2. ⚡ **Parametrizar Judicial + Recursal** (etapas) e os ~20 tipos de tarefa mais comuns — transforma a resposta do bot de "boa" em "excelente".
3. ⚡ **Dashboard Power BI v1**: 4 visuais (produtividade por pessoa, tarefas atrasadas, carteira por fase, receita×despesa) — os dados já estão lá.
4. ⚡ **Ativar tradutor IA do bot** (1 env var ANTHROPIC_API_KEY) — cobre os andamentos fora do glossário, com cache (custo ~centavos).
5. ⚡ **Aniversários automáticos**: bi_clientes.nascimento + bot → parabéns via WhatsApp (1 função agendada).

## B. Radar jurídico (em cima do espelho de dados)
6. 🔨 **Alerta de processos parados**: sem andamento há 90+ dias → lista semanal por advogado responsável (nota no Kommo ou e-mail). Query pronta no vw_bi_andamentos.
7. 🔨 **SLA por etapa**: com o vw_bi_funil acumulando, definir tempo-alvo por quadro e alertar processos acima do percentil 90.
8. 🔨 **Detector de sentença/decisão**: monitor identifica termos-chave (sentença, julgado, trânsito) → alerta especial ao advogado + sugestão de mensagem ao cliente.
9. 🔨 **Radar de prazos fatais**: date_deadline das tarefas + publications → agenda crítica diária no painel/WhatsApp do responsável.
10. 🏗 **Inteligência por parte contrária**: tempo médio, fase típica, comportamento de cada resort/construtora (parte_contraria já estruturada) — preparação de negociação e priorização.
11. 🔨 **Ranking de comarcas/varas por velocidade** (andamentos × processos) — expectativa realista por região para calibrar o que o bot fala de prazo.
12. 🔨 **Processos "gêmeos"**: mesmo cliente ou mesma parte em ações correlatas — sinalizar conexões para aproveitamento de provas/teses.

## C. Cliente final
13. 🏗 **Portal do cliente** (página pública com token): timeline traduzida, fase, próximos passos, financeiro — os dados já estão no Supabase; é "só" frontend. QR code no contrato assinado levando ao portal.
14. 🔨 **Resumo mensal automático via bot** para clientes ativos (mata a ansiedade e as ligações).
15. 🔨 **Push proativo de andamento relevante** (fase 2 natural do bot — código do monitor já detecta; falta o disparo via Salesbot p/ não-testadores com opt-in).
16. 🔨 **Extrato financeiro no bot**: "quanto já paguei? quanto falta?" via bi_financeiro + Asaas.
17. 🔨 **NPS pós-marco** (audiência/sentença) com botões no bot → detrator vira tarefa para sócio.
18. ⚡ **Mensagem de encerramento** no trânsito em julgado/arquivamento com pedido de avaliação no Google.

## D. Gestão e produtividade
19. 🔨 **Briefing de segunda 7h** para sócios (WhatsApp/e-mail): produção da semana, atrasadas, novos clientes, receita, processos parados — gerado das views.
20. ⚡ **Capturar o `reward`** (pontos de gamificação) no sync de tarefas → ranking ponderado igual ao do ADVBOX, mas cruzável com tudo no Power BI.
21. 🔨 **Carga de trabalho por advogado**: tarefas abertas por responsável + alerta de sobrecarga/ociosidade.
22. 🔨 **Tarefas órfãs**: criadas há 30+ dias, sem prazo e sem conclusão — limpeza mensal.
23. 🏗 **Funil de negócio completo**: lead (Kommo) → contrato → assinatura → distribuição (DataJud) → êxito (ADVBOX) → receita (Asaas) — taxa de conversão e tempo em cada elo, numa view só.

## E. Financeiro
24. 🔨 **Conciliação tripla de honorários**: contrato (valor acordado) × Asaas (recebido) × ADVBOX fees_money — divergências viram alerta.
25. 🔨 **Margem por tese/resort**: receita - custas (categoria "guia de custas" do bi_financeiro) por tipo de ação — onde o escritório ganha de verdade.
26. 🔨 **Custas não reembolsadas**: pagas pelo escritório sem contrapartida de reembolso — relatório de recuperação.
27. 🏗 **Previsão de caixa**: parcelas Asaas futuras + fees_expec ponderado pela fase do funil (probabilidade por etapa).
28. 🔨 **Inadimplência preditiva**: padrão de atraso por cliente no Asaas → régua de cobrança diferenciada.

## F. IA aplicada (trilhos prontos: chave + cache + dados)
29. 🔨 **Resumo executivo do processo** (1 parágrafo, IA, atualizado a cada mudança de fase) — exibido no widget do Kommo e no futuro portal.
30. 🔨 **Triagem de intimações por urgência**: publications → IA classifica (prazo fatal? sentença? rotina?) → fila priorizada.
31. 🏗 **Q&A interno**: "quantos processos do resort X em recurso?" — chat interno (aba no sistema) que consulta as views com IA (text-to-SQL controlado, só leitura).
32. 🏗 **Análise de sentimento das conversas Kommo** → score de risco de churn por cliente.
33. 🏗 **Minuta-rascunho de peça intermediária** a partir do andamento + tese (humano sempre revisa) — começa por réplicas e manifestações simples.

## G. Bot — rota para produção
34. 🔨 **Rollout gradual**: flag por cliente (testadores → grupo piloto real → geral), com kill-switch que já existe.
35. 🔨 **Cache de resposta** (snapshot local em vez de consulta ao vivo) — remove o teto de rate limit para escala total.
36. 🔨 **Handoff inteligente**: insatisfação detectada → transfere pro humano no Kommo com resumo da conversa (bot_messages tem tudo).
37. ⚡ **Métricas do bot no painel**: taxa de resolução sem humano, perguntas mais frequentes, horários de pico (bot_messages já loga).

## H. Segurança e infraestrutura (os estruturais — validados na auditoria)
38. 🏗 **RLS de verdade** + SUPABASE_SERVICE_ROLE_KEY no Netlify — o item nº 1 de segurança (101 tabelas allow-all). Projeto de uma sessão dedicada, sistema por sistema.
39. ⚡ **Rotacionar tokens expostos**: ADVBOX (no bundle), KOMMO (chat de 02/06), Netlify (deploy.sh) — e mover para env/proxy.
40. ⚡ **Segredo no webhook Kommo** (header validado) — hoje aberto.
41. ⚡ **Enforce SSL no Supabase** depois de instalar o certificado CA no Power BI.
42. ⚡ **Backup do bot_config + templates** (parametrização é trabalho manual valioso) — export diário junto do backup existente.
43. 🔨 **Testes automatizados do motor do bot** — funções puras (classifyIntent, glossaryTranslate, render) são triviais de testar; protegem as parametrizações de regressão.
44. ⚡ **Retenção programada**: bot_messages >6m, advbox_api_log >6m, novidades comunicadas >12m (padrão log_cleanup_fn já existe).
45. ⚡ **UptimeRobot** (ou similar) no /api/health + alerta WhatsApp se o sistema cair fora do horário.

## I. Núcleo de contratos (pendências antigas que continuam valendo ouro)
46. 🔨 **Webhook nativo do ZapSign** no lugar do polling (maior economia de banda do sistema; pendência documentada).
47. ⚡ **Lembrete de contrato não assinado** (3 e 7 dias) via nota/tarefa Kommo — o dado `times_viewed` já existe.
48. 🔨 **Esteira pós-assinatura**: checklist automático de distribuição com prazos (protocolar em X dias, juntar custas, etc.) criando tarefas no ADVBOX.
49. ⚡ **Domínio próprio** contratos.advocaciacbc.com (+ Cloudflare na frente).
50. 🔨 **Validação de duplicidade ampliada**: além de CPF+resort, checar contra bi_processos (cliente já tem ação igual no ADVBOX?).

## Top 5 recomendados para começar (ordem)
1. Salesbot no Kommo (#1) — destrava o teste real do bot, 2 minutos
2. Dashboard Power BI v1 (#3) — materializa todo o valor do backfill
3. Processos parados (#6) — radar de risco imediato com dado que já existe
4. Rotação de tokens + segredo no webhook (#39/#40) — higiene barata
5. Briefing de segunda para sócios (#19) — gestão sentindo o valor toda semana
