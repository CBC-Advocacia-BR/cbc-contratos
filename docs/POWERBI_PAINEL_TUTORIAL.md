# Painel CBC no Power BI — tutorial completo (do zero)

> Para quem **nunca usou o Power BI**. Tempo total: ~2h na primeira vez (dá para fazer em partes — salve o arquivo e continue depois). Feito uma vez, o painel se atualiza sozinho.
>
> Tudo do lado do banco **já está pronto** (views calculadas, usuário de leitura). Você só vai clicar e arrastar.

> ⚡ **ATALHO (02/07/2026): existe o painel PRONTO em arquivo** — `powerbi/CBC-Painel-PowerBI-v5.zip` no repositório (formato clássico `model.bim`, abre em qualquer Power BI Desktop sem ativar nada; versões anteriores arquivadas em backups). Leve o ZIP para o Windows, extraia tudo e abra `CBC-Painel.pbip` (instruções no `LEIA-ME.txt` dentro do ZIP): as 6 páginas, medidas e conexão já vêm montadas; só clicar em **Atualizar** e informar usuário/senha (Etapa 2.4). Este tutorial segue valendo para **entender e editar** o painel — e como plano B se o arquivo der qualquer erro ao abrir.

---

## O que você vai construir

Um arquivo `CBC-Painel.pbix` com 6 páginas (abas embaixo, como no Excel):

| Página | Responde |
|---|---|
| **1. Produtividade** | quantas tarefas concluídas, por quem, em quanto tempo |
| **2. Retrabalho** | quantas REFAZER e quem mais refez |
| **3. Distribuição** | quanto tempo da criação do processo até distribuir + esteira de tarefas até lá |
| **4. Carga atual** | quantas tarefas abertas cada pessoa/equipe tem AGORA |
| **5. Comercial** | contratos criados→assinados por vendedor + videochamadas (sem valores R$) |
| **6. Carteira** | processos por quadro/etapa, tempo em cada etapa, clientes por origem/UF |

## Antes de começar (checklist)

- [ ] Um PC com **Windows** (o Power BI Desktop não existe para Mac — depois de publicado, você acompanha pelo navegador em qualquer computador)
- [ ] Conta Microsoft com e-mail do escritório — não tem? Crie grátis na Etapa 8.0 (e-mail pessoal gmail/hotmail não serve para publicar)
- [ ] Usuário e senha do banco: usuário `powerbi_cbc.vygczeepvoyaehfchxko` (a senha está guardada comigo — é só pedir "qual a senha do Power BI?")

---

## Etapa 1 — Instalar o Power BI Desktop (5 min)

1. No Windows, abra a **Microsoft Store** (menu Iniciar → digite "Store").
2. Pesquise **Power BI Desktop** → **Instalar** (é gratuito).
3. Abra o programa e entre com a conta Microsoft do escritório (botão **Entrar** no canto superior direito).

## Etapa 2 — Conectar ao banco (5 min)

1. Na tela inicial, clique em **Obter dados** → escolha **Banco de dados PostgreSQL** (se não aparecer na lista, clique em **Mais...** e pesquise "PostgreSQL").
2. Preencha:
   - **Servidor**: `aws-1-sa-east-1.pooler.supabase.com:5432`
   - **Banco de dados**: `postgres`
   - Modo de conectividade: **Importar** (já vem marcado)
3. Clique **OK**.
4. Na janela de credenciais, clique na aba **"Banco de dados"** à esquerda (⚠️ NÃO use a aba "Windows"):
   - **Nome de usuário**: `powerbi_cbc.vygczeepvoyaehfchxko`
   - **Senha**: (a que você guardou)
5. Clique **Conectar**.
6. Se aparecer aviso de **criptografia/certificado**, responda **OK/Sim** para conectar assim mesmo. (Se der erro direto: Arquivo → Opções e configurações → Configurações da fonte de dados → selecione o servidor → Editar Permissões → desmarque "Criptografar conexões" → tente de novo.)

## Etapa 3 — Escolher as tabelas (5 min)

Na janela **Navegador**, marque SOMENTE estas 10 (use a busca no topo para achar rápido):

- ☑ `public.vw_bi_produtividade` — tarefas concluídas, por pessoa
- ☑ `public.vw_bi_carga_atual` — tarefas abertas agora, por pessoa
- ☑ `public.vw_bi_distribuicao` — régua criação→distribuição por processo
- ☑ `public.vw_bi_tarefas_pre_distribuicao` — tarefas feitas antes de distribuir
- ☑ `public.vw_bi_funil_etapas` — tempo de permanência em cada etapa
- ☑ `public.vw_bi_processos` — carteira de processos
- ☑ `public.vw_bi_andamentos` — movimentações dos processos
- ☑ `public.bi_clientes` — cadastro de clientes (origem, cidade/UF)
- ☑ `public.vw_powerbi_contratos` — contratos do sistema CBC
- ☑ `public.vw_funil_videochamadas` — videochamadas de vendas

Clique **Carregar** e aguarde (1–3 min na primeira vez).

### 3.1 Renomear as tabelas (facilita TUDO daqui pra frente)

No painel **Dados** à direita, clique com o botão direito em cada tabela → **Renomear**:

| Nome que veio | Renomear para |
|---|---|
| public vw_bi_produtividade | `Produtividade` |
| public vw_bi_carga_atual | `CargaAtual` |
| public vw_bi_distribuicao | `Distribuicao` |
| public vw_bi_tarefas_pre_distribuicao | `PreDistribuicao` |
| public vw_bi_funil_etapas | `FunilEtapas` |
| public vw_bi_processos | `Processos` |
| public vw_bi_andamentos | `Andamentos` |
| public bi_clientes | `Clientes` |
| public vw_powerbi_contratos | `Contratos` |
| public vw_funil_videochamadas | `Videochamadas` |

> Os textos de fórmula das próximas etapas usam esses nomes — se pular a renomeação, as fórmulas não colam certo.

## Etapa 4 — Criar a tabela de calendário (2 min)

O calendário permite filtrar tudo por período de forma consistente.

1. Menu superior **Modelagem** → **Nova tabela**.
2. Na barra de fórmula que abre, cole e dê Enter:
   ```
   Calendario = CALENDAR(DATE(2025,1,1), TODAY())
   ```
3. Com a tabela `Calendario` selecionada no painel Dados, menu **Modelagem** → **Marcar como tabela de datas** → escolha a coluna `Date` → OK.

## Etapa 5 — Ligar o calendário às tabelas (3 min)

1. Clique no ícone **Modelo** (o 3º na barra lateral esquerda, parece um organograma).
2. Arraste o campo `Date` da tabela `Calendario` e solte em cima de:
   - `Produtividade` → campo `data_conclusao`
   - `Distribuicao` → campo `distribuido_em`
   - `PreDistribuicao` → campo `data_conclusao`
3. Em cada janelinha que abrir, só confirme **OK** (muitos-para-um é o padrão).

> A `CargaAtual` fica **sem** ligação de propósito: ela é a foto de AGORA, não deve ser filtrada por período.

4. Volte para o modo relatório (1º ícone da barra lateral).

## Etapa 6 — Criar as medidas (10 min)

Medida = número calculado (ex.: "% em dia"). Para criar: clique com o **botão direito na tabela indicada** no painel Dados → **Nova medida** → apague o que estiver na barra de fórmula, **cole a linha** e dê Enter. Repita para cada uma.

Na tabela **Produtividade**:
```
Concluídas = COUNTROWS(Produtividade)
```
```
Tempo Mediano (dias) = MEDIAN(Produtividade[tempo_ciclo_dias])
```
```
Tempo Médio (dias) = AVERAGE(Produtividade[tempo_ciclo_dias])
```
```
% Em Dia = DIVIDE(CALCULATE([Concluídas], Produtividade[dias_vs_agendado] <= 0), CALCULATE([Concluídas], NOT ISBLANK(Produtividade[dias_vs_agendado])))
```
```
Qtde Retrabalho = CALCULATE([Concluídas], Produtividade[retrabalho] = TRUE())
```
> A coluna `retrabalho` já vem marcada do banco: toda tarefa REFAZER* + CORRIGIR PRESTAÇÃO DE CONTAS (definição confirmada pelo Paulo em 02/07/2026). O nome da medida precisa ser "Qtde Retrabalho" mesmo — o Power BI não aceita medida com o mesmo nome de uma coluna da tabela.
```
Taxa Retrabalho Inicial = DIVIDE(CALCULATE([Concluídas], Produtividade[tarefa] = "REFAZER INICIAL"), CALCULATE([Concluídas], Produtividade[tarefa] = "FAZER INICIAL"))
```

Na tabela **CargaAtual**:
```
Tarefas Abertas = COUNTROWS(CargaAtual)
```
```
Vencidas = CALCULATE(COUNTROWS(CargaAtual), CargaAtual[situacao_agenda] = "vencida")
```
```
Tarefas Vencidas = CALCULATE(DISTINCTCOUNT(CargaAtual[tarefa_id]), CargaAtual[situacao_agenda] = "vencida")
```
> `Vencidas` conta atribuições (tarefa com 2 responsáveis = 2) — use nos gráficos POR PESSOA. `Tarefas Vencidas` conta tarefas únicas — use nos CARTÕES de total.

Na tabela **Distribuicao**:
```
Distribuídos = CALCULATE(COUNTROWS(Distribuicao), Distribuicao[distribuido] = TRUE())
```
```
Dias até Distribuir (mediana) = MEDIAN(Distribuicao[dias_ate_distribuir])
```
```
Aguardando Distribuição = CALCULATE(COUNTROWS(Distribuicao), Distribuicao[distribuido] = FALSE(), ALL(Calendario))
```

Dica de formatação: com a medida selecionada, no menu **Medida** dá para definir % (para "% Em Dia") e casas decimais.

## Etapa 7 — Montar as páginas

Como funciona a mecânica (vale para tudo):
- **Inserir um visual**: clique no ícone dele no painel **Visualizações** → aparece um quadro vazio na tela → redimensione pelos cantos.
- **Preencher**: com o visual selecionado, **arraste campos** do painel Dados para os "poços" (Eixo X, Eixo Y, Valores...) do painel Visualizações.
- **Filtrar só um visual**: com ele selecionado, arraste um campo para **Filtros neste visual**.
- **Filtrar a página inteira**: arraste para **Filtros nesta página**.
- **Renomear a página**: duplo clique na aba lá embaixo.

### Página 1 — Produtividade

1. **4 cartões** (ícone "Cartão", o 123): um para cada medida — `[Concluídas]`, `[Tempo Mediano (dias)]`, `[% Em Dia]`, `[Tarefas Vencidas]`. Alinhe no topo.
2. **Gráfico de colunas empilhadas**: Eixo X = `Calendario[Date]` (clique na setinha do campo no poço → escolha **Hierarquia de datas** e deixe só Ano e Mês); Eixo Y = `[Concluídas]`; Legenda = `Produtividade[categoria]`. Isso mostra a produção mensal separando tarefas "de ciclo" das instantâneas.
3. **Gráfico de barras empilhadas** (ranking): Eixo Y = `Produtividade[pessoa]`; Eixo X = `[Concluídas]`. Ele já ordena do maior pro menor.
4. **Matriz** (ícone de tabela quadriculada): Linhas = `pessoa`; Colunas = `categoria`; Valores = `[Concluídas]`.
5. **Segmentação de dados** (ícone de funil com quadrado) — insira 3: uma com `Calendario[Date]` (vira controle deslizante de período), uma com `Produtividade[equipe]`, uma com `Produtividade[categoria]`.

> Leitura certa: a categoria **instantanea** (COMENTÁRIO, PUBLICAÇÃO TRATADA…) é ~25% da produção mas tem tempo 0 por natureza. Para analisar TEMPO, filtre categoria = **ciclo**; para analisar VOLUME, use tudo. A categoria **sistema** (alertas de exclusão) pode ficar sempre de fora: arraste `categoria` para **Filtros nesta página** e desmarque `sistema`.

### Página 2 — Retrabalho

1. Nova página (botão **+** embaixo). Arraste `Produtividade[retrabalho]` para **Filtros nesta página** → marque só **True**. (A marcação já vem pronta do banco: REFAZER* + CORRIGIR PRESTAÇÃO DE CONTAS.)
2. **Cartões**: `[Qtde Retrabalho]` e `[Taxa Retrabalho Inicial]` (formate como %).
3. **Barras empilhadas**: Eixo Y = `pessoa`; Eixo X = `[Concluídas]`; Legenda = `tarefa` → quem mais refez, e o quê.
4. **Colunas**: Eixo X = `Calendario[Date]` (Ano/Mês); Eixo Y = `[Concluídas]` → retrabalho ao longo do tempo.
5. **Tabela** (ícone de tabela simples): colunas `tarefa`, `pessoa`, `data_conclusao`, `processo`, `cliente` → o detalhe de cada refazer.

### Página 3 — Distribuição

1. Nova página. Arraste `Distribuicao[cadastro_retroativo]` para **Filtros nesta página** → marque só **False** (exclui processos antigos importados, que distorcem a régua). Arraste também `PreDistribuicao[cadastro_retroativo]` → **False** (o primeiro filtro só vale para a tabela Distribuicao).
2. **Cartões**: `[Dias até Distribuir (mediana)]`, `[Distribuídos]`, `[Aguardando Distribuição]`.
3. **Gráfico de linhas**: Eixo X = `Calendario[Date]` (Ano/Mês); Eixo Y = `[Dias até Distribuir (mediana)]` → a régua está melhorando ou piorando mês a mês.
4. **Barras — a ESTEIRA (onde o tempo mora)**: tabela `PreDistribuicao` — Eixo Y = `tarefa`; Eixo X = `dias_desde_criacao` e, na setinha do campo, agregação **Mediana** → em que dia de vida do processo cada tarefa é concluída. Leitura de hoje: as primeiras tarefas (FAZER INICIAL, ANALISAR DOCUMENTAÇÃO) só acontecem por volta do **dia 22** — o gargalo é a **espera para começar**, não a execução.
5. **Barras — velocidade de execução**: duplique o visual acima e troque o Eixo X por `tempo_ciclo_dias`, agregação **Média** → quanto tempo cada tarefa leva depois que começa (hoje: 0–2 dias na maioria).
6. **Tabela** (fila de espera): campos da `Distribuicao` → `process_number`, `clientes`, `criado_em`, `dias_aguardando`, `etapa`; arraste `distribuido` para **Filtros neste visual** e marque só **False**; clique no cabeçalho `dias_aguardando` para ordenar do maior. → Quem está esperando distribuição há mais tempo.

### Página 4 — Carga atual (tempo real)

1. Nova página. **Cartões**: `[Tarefas Abertas]` e `[Atrasadas]`.
2. **Barras empilhadas**: Eixo Y = `CargaAtual[pessoa]`; Eixo X = `[Tarefas Abertas]`; Legenda = `CargaAtual[situacao_agenda]` → a carga de cada um separada em **vencida / para hoje / próximos 7 dias / mais adiante** (a visão da coordenadora).
3. **Segmentações**: `CargaAtual[equipe]`, `CargaAtual[situacao_agenda]` e `CargaAtual[faixa_aging]`.
4. **Tabela**: `pessoa`, `tarefa`, `cliente`, `processo`, `data_agendada`, `situacao_agenda`, `dias_em_aberto` — ordene por `dias_em_aberto`.

> **Como ler esta página (regras de 02/07/2026)**: a carga considera **só tarefas realmente abertas no ADVBOX agora** (o monitor grava um "retrato" dos IDs abertos a cada sincronização — tarefas excluídas ou remarcadas no ADVBOX são refletidas); **COMENTÁRIO não conta como tarefa**; **"vencida" = 1+ dia ÚTIL completo de atraso** (o 1º dia útil após a data agendada aparece como "carencia (1 dia util)"; sáb/dom não contam; feriados não são considerados). "Tempo real" = a última sincronização do espelho (**6h30 e 17h30**, seg–sex).

### Página 5 — Comercial (sem R$)

1. Nova página. **Funil** (ícone de funil) com a tabela `Contratos`: Categoria = `status`; Valores = `id` (vira "Contagem de id" sozinho) → rascunho → enviado → assinado.
2. **Barras**: Eixo Y = `Contratos[created_by]`; Eixo X = `id` (Contagem) → contratos por vendedor. Duplique e troque o Eixo X por `tempo_assinatura_dias` com agregação **Média** → velocidade de assinatura por vendedor.
3. **Colunas** com `Videochamadas`: Eixo X = `scheduled_at` (Ano/Mês); Eixo Y = `event_id` (Contagem); Legenda = `status` → agendadas × realizadas por mês. Segmentação: `vendedora_email`.
4. **Colunas** com `Contratos`: Eixo X = `origem_cliente`; Eixo Y = `id` (Contagem) → de onde vêm os clientes.

### Página 6 — Carteira e etapas

1. **Barras**: `Processos[quadro]` × Contagem de `lawsuit_id` → a carteira por quadro.
2. **Barras** com `FunilEtapas`: Eixo Y = `etapa`; Eixo X = `dias_na_etapa` (agregação **Média**) → onde os processos passam mais tempo. *(Esse histórico começou em 10/06/2026 — vai ficando mais confiável a cada mês.)*
3. **Colunas** com `Andamentos`: Eixo X = `data` (Ano/Mês); Eixo Y = Contagem de `andamento` → ritmo de movimentação da carteira.
4. **Treemap** (retângulos) com `Clientes`: Categoria = `origem`; Valores = Contagem de `customer_id` → captação. Outro com `uf` para geografia.

### 8.0 · Não tem conta Microsoft corporativa? Crie grátis (5 min, uma vez)

O Power BI da nuvem NÃO aceita e-mail pessoal (gmail/hotmail), mas aceita **qualquer e-mail de domínio de empresa** — mesmo que o e-mail seja hospedado no Google, como o do escritório:

1. Acesse **app.powerbi.com** → "Experimente grátis"/"Criar conta".
2. Digite seu e-mail do escritório (ex.: `paulo@advocaciacbc.com`) → a Microsoft envia um **código de verificação** para essa caixa (chega no seu Gmail normal).
3. Informe o código, crie uma senha e preencha o nome. Avisos como "criaremos uma organização para você" ou convite para chamar colegas podem ser pulados — é normal (cria-se um espaço Microsoft do domínio, gratuito).
4. No Power BI **Desktop**, clique em **Entrar** (canto superior direito) com esse e-mail/senha → o botão Publicar passa a funcionar.

> Colegas com e-mail @advocaciacbc.com podem criar conta do mesmo jeito e caem no mesmo espaço do domínio — útil se um dia contratarem o Pro para compartilhar pelo navegador.

## Etapa 8 — Publicar e agendar a atualização (10 min)

1. **Arquivo → Salvar como** → `CBC-Painel.pbix` (guarde esse arquivo — é a "fonte" do painel).
2. Botão **Publicar** (aba Página Inicial) → escolha **Meu workspace** → aguarde "Êxito!".
3. Acesse **app.powerbi.com** no navegador (qualquer computador, inclusive Mac) → Meu workspace → abra o relatório para conferir.
4. Agendar atualização: em Meu workspace, passe o mouse no **modelo semântico** "CBC-Painel" → **⋯ → Configurações**:
   - **Credenciais da fonte de dados** → Editar credenciais → método **Básico** → mesmo usuário/senha da Etapa 2 → (se houver opção de criptografia, desabilite a validação) → Entrar.
   - **Atualização agendada** → Ativar → adicione os horários **07:00 e 18:00** → Aplicar.

### Licença: o que muda entre grátis e Pro

- Com a conta **grátis** você faz TUDO deste tutorial e vê o painel no navegador — mas **só você**.
- Para o Bruno (ou outros) verem pelo navegador, **os dois lados** precisam de licença **Pro** (~US$ 14/usuário/mês) — aí você publica num workspace compartilhado do escritório.
- **Nunca** use "Publicar na Web (público)" — expõe dados de clientes na internet.
- Alternativa a custo zero: enviar o arquivo `.pbix` para a pessoa abrir no Power BI Desktop dela (os dados vêm juntos; ela clica em Atualizar para dados novos).

## Manutenção e dúvidas rápidas

- **Classificar equipes**: hoje as 24 pessoas estão como "operacional" na tabela `bi_equipes` do banco. Me diga quem é de **vendas** que eu ajusto — o painel reflete na próxima atualização. Nomes novos entram automaticamente como "operacional".
- **Dados desatualizados?** O espelho sincroniza 6h30/17h30 (seg–sex). O Power BI busca às 7h/18h. Fora disso, o botão **Atualizar** no Desktop força a leitura do banco.
- **Erro "max clients reached ... pool_size: 15" (ou OLE DB 0x80040E4E) ao Atualizar**: o banco aceita 15 conexões e o Power BI tentou baixar as tabelas todas juntas. Arquivo → Opções → **Arquivo Atual → Carregamento de Dados** → desmarque **"Habilitar carregamento paralelo de tabelas"** → OK → feche e reabra o Power BI → Atualizar (as tabelas baixam uma a uma, 2–4 min).
- **Erro de credencial ao atualizar**: refaça a Etapa 8.4 (a senha é a mesma).
- **Quero mudar um gráfico**: abra o `.pbix` no Desktop, mude, clique Publicar de novo (substitui).
- **Não encontro uma view na lista**: confira se está na aba de credenciais "Banco de dados" (não "Windows") e se o usuário está certo.
- Referência técnica das views: `docs/POWERBI_CONEXAO.md` e migrações `supabase_powerbi_*.sql`.
