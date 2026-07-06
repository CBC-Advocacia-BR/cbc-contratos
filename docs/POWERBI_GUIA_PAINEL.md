# Guia de leitura do Painel CBC — o que cada aba mostra

> Para quem **usa** o painel (Paulo, coordenadora, sócios). Como montar/editar é outro documento: `POWERBI_PAINEL_TUTORIAL.md`.

## De onde vêm os números (e quando atualizam)

`ADVBOX` → espelho no banco do escritório (**6h30 e 17h30**, seg–sex) → Power BI (Atualizar manual, ou automático **7h/18h** depois de publicado). Todas as datas em horário de Brasília. Regra prática: o painel mostra o mundo como ele era na última sincronização — o que a equipe fez à tarde entra depois das 17h30.

## Dicionário (vale para todas as abas)

| Termo | Significado |
|---|---|
| **Tarefa aberta** | criada no ADVBOX e ainda não concluída — **confirmada no retrato ao vivo** do ADVBOX (excluídas/remarcadas são refletidas a cada sincronização). Inclui o trabalho **agendado para o futuro** — aberta ≠ atrasada. |
| **situacao_agenda** | classificação da tarefa aberta pela data agendada: `vencida` · `carencia (1 dia util)` · `para hoje` · `proximos 7 dias` · `mais adiante` · `sem data`. |
| **Vencida** | data agendada passou **e** já se completou ≥1 dia ÚTIL de atraso (sáb/dom não contam; feriados não considerados). O 1º dia útil após a data aparece como **carência**. |
| **categoria** | `ciclo` = tarefa normal (abre, alguém executa, conclui — conta em volume E tempo) · `instantanea` = trabalho real que nasce pronto (PUBLICAÇÃO TRATADA*, VERIFICAR INTERNO — conta em VOLUME, mas fica fora das médias de TEMPO, senão zeraria tudo) · `sistema` = registro automático do ADVBOX, **não é trabalho** (COMENTÁRIO, ALERTA DE TAREFA EXCLUÍDA — fora de TODAS as contagens). |
| **equipe** | administrativo · operacional · vendas · sistema (robôs PUBLIS CBC/SUPORTE ADVBOX) · desligado (ex-colaboradores; histórico preservado). Nomes novos entram como "operacional". |
| **Crédito de publicações** | "PUBLICAÇÃO TRATADA LUANY/GRAZIE/MARIANA" é concluída pelo perfil PUBLIS CBC (controladoria), mas o **crédito vai para a pessoa do título**. |
| **Retrabalho** | tarefas REFAZER* + CORRIGIR PRESTAÇÃO DE CONTAS. Mede **quem refez** (o executor), não quem errou a peça original. |
| **Tempo de ciclo** | dias entre a **criação real** da tarefa no ADVBOX e a conclusão. Diferente de `dias_vs_agendado` (conclusão vs data marcada = pontualidade). |
| **Atribuição × tarefa única** | tarefa com 2 responsáveis conta 2× nos gráficos POR PESSOA (correto: está na mesa dos dois) e 1× nos totais de tarefas. |
| **Cadastro retroativo** | processo antigo importado ao ADVBOX depois de já distribuído — excluído das réguas de tempo para não distorcer. |

---

## Página 1 · Produtividade — "quanto a equipe produz"

- **Cartões**: Concluídas (exclui "sistema") · Tempo Mediano em dias (só tarefas de ciclo) · % Em Dia (concluída até a data agendada) · Tarefas Vencidas (únicas, da carga atual).
- **Colunas por mês**: produção mensal, cores separando ciclo × instantânea — dá para ver quanto da produção é peça/diligência e quanto é tratamento de publicação.
- **Barras por pessoa**: ranking de concluídas no período filtrado.
- **Matriz pessoa × categoria**: quem produz o quê.
- **Filtros**: período (calendário), equipe, categoria.

**Leitura certa**: para comparar VOLUME entre pessoas, use tudo; para comparar TEMPO, filtre categoria = ciclo. Mediana > média como referência (a média é puxada por casos extremos).

## Página 2 · Retrabalho — "o que foi refeito, por quem"

- **Cartões**: Qtde Retrabalho · Taxa Retrabalho Inicial (REFAZER INICIAL ÷ FAZER INICIAL — o % de iniciais que voltam).
- **Barras por pessoa** (cores por tipo de tarefa) e **evolução mensal**.
- **Matriz pessoa × tipo** com o detalhe.

**Leitura certa**: o número mede quem **executou** o refazimento — a pessoa que corrige pode ser justamente a mais confiável. Use a tendência mensal e a taxa como termômetro de qualidade do processo, não como culpa individual.

## Página 3 · Distribuição — "quanto tempo até distribuir e onde trava"

- **Cartões**: mediana de dias criação→distribuição (régua oficial = data de distribuição do ADVBOX) · Distribuídos · Aguardando distribuição.
- **Linha mensal**: a régua está melhorando ou piorando.
- **Esteira (barras "dia mediano no processo")**: em que dia de vida do processo cada tarefa acontece. Leitura atual: as primeiras tarefas (FAZER INICIAL, ANALISAR DOCUMENTAÇÃO) só ocorrem por volta do **dia 22** — o gargalo é a **espera para começar**, não a execução (ciclos de 0–2 dias, no gráfico ao lado).
- **Fila de espera**: processos ainda não distribuídos, ordenados por dias aguardando.

## Página 4 · Carga atual — "a mesa de cada um, agora"

- **Cartões**: Tarefas Abertas · Vencidas.
- **Barras por pessoa**, cores pela `situacao_agenda` — a visão da coordenadora: vencida / carência / hoje / próximos 7 dias / mais adiante.
- **Tabela**: o detalhe para cobrança (ordene por dias em aberto).

**Leitura certa**: aberto ≠ atrasado. ~90% da carga é **agenda futura** (audiências marcadas, acompanhamentos programados). O que exige ação: vencida + carência + hoje. COMENTÁRIO não aparece aqui (não é tarefa).

## Página 5 · Comercial — "do lead ao contrato assinado" (sem R$)

- **Funil por status** do contrato (rascunho → enviado → assinado).
- **Contratos por vendedor** e **velocidade média de assinatura** por vendedor (dias entre criar e assinar).
- **Videochamadas por mês** (agendada × realizada, por vendedora).
- **Origem dos clientes** dos contratos.

## Página 6 · Carteira — "o retrato dos 3,3 mil processos"

- **Processos por quadro** (Judicial, Execução, Recursal, Arquivamento…).
- **Tempo médio em cada etapa** (histórico observado desde 10/06/2026 — amadurece a cada mês).
- **Andamentos por mês**: o ritmo de movimentação da carteira nos tribunais.
- **Clientes por origem de captação e por UF**.

---

## Perguntas frequentes

- **O número não bate com o ADVBOX agora** → o painel mostra a última sincronização (6h30/17h30). Confira o horário; diferenças de minutos/horas são esperadas.
- **Cadê o PUBLIS CBC no ranking?** → o crédito das publicações tratadas vai para Luany/Grazie/Mariana (pessoa do título). O perfil é da controladoria e ficou na equipe "sistema".
- **Por que mediana e não média?** → metade das tarefas resolve no mesmo dia e algumas levam semanas; a média distorce, a mediana representa o caso típico.
- **Vencidas do cartão ≠ soma das barras** → o cartão conta tarefas únicas; as barras por pessoa contam atribuições (tarefa compartilhada aparece na mesa de cada responsável).
- **Alguém saiu/entrou na equipe** → avisar o Claude; desligados viram equipe "desligado" (histórico fica), novos entram como "operacional" automaticamente.

*Gerado em 02/07/2026 · fontes: views `vw_bi_*` no Supabase · dúvidas ou ajustes: falar com o Claude no projeto cbc-contratos.*
