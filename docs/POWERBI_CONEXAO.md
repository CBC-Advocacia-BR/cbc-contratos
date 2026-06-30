# Conectar o Power BI (Windows) à base do escritório — passo a passo

> Tempo estimado: 20–30 min. Feito uma vez; depois tudo funciona pelo navegador.

## 1. Instalar o Power BI Desktop
- Abra a **Microsoft Store** do Windows → pesquise **Power BI Desktop** → Instalar (gratuito).
- Abra o programa e entre com a conta Microsoft do escritório.

## 2. Conectar ao banco
1. Clique em **Obter dados** (tela inicial) → escolha **Banco de dados PostgreSQL** (se não aparecer, clique em "Mais..." e pesquise "PostgreSQL").
2. Preencha:
   - **Servidor**: `aws-1-sa-east-1.pooler.supabase.com:5432`
   - **Banco de dados**: `postgres`
   - Modo de conectividade: **Importar**
3. Clique OK.

## 3. Credenciais (atenção: aba certa!)
1. Na janela de credenciais, clique na aba **"Banco de dados"** (⚠️ NÃO use a aba "Windows").
2. **Nome de usuário**: `powerbi_cbc.vygczeepvoyaehfchxko`
3. **Senha**: (pedir ao Paulo — usuário somente-leitura do BI)
4. Conectar.
5. **Se aparecer erro de certificado/criptografia**: o Power BI vai perguntar se deseja conectar sem criptografia — responda **Sim/OK**. (Se der erro direto sem perguntar: Arquivo → Opções e configurações → Configurações da fonte de dados → selecione o servidor → Editar Permissões → desmarque "Criptografar conexões" → tente de novo.)

## 4. Escolher as tabelas (só as 6 views!)
Marque SOMENTE estas (têm "vw_bi_" no nome):
- ☑ `public.vw_bi_processos`
- ☑ `public.vw_bi_tarefas`
- ☑ `public.vw_bi_andamentos`
- ☑ `public.vw_bi_funil`
- ☑ `public.vw_bi_clientes`
- ☑ `public.vw_bi_financeiro`

NÃO marque as demais (bi_*, bot_*, cron.*, net.*, extensions.*). Clique **Carregar**.

## 5. Relacionamentos (2 min)
1. Clique no ícone **Modelo** (3º na barra lateral esquerda).
2. Confira/crie as ligações (arraste o campo de uma tabela até o da outra):
   - `vw_bi_tarefas.processo_id_advbox`  →  `vw_bi_processos.lawsuit_id`
   - `vw_bi_andamentos.processo_id_advbox`  →  `vw_bi_processos.lawsuit_id`
   - `vw_bi_financeiro.lawsuit_id`  →  `vw_bi_processos.lawsuit_id`
   - `vw_bi_funil.lawsuit_id`  →  `vw_bi_processos.lawsuit_id`
   (Tipo: muitos-para-um, direção única — é o padrão sugerido.)

## 6. Tabela de calendário (recomendado, 1 min)
- Aba **Modelagem → Nova tabela** → cole:
  `Calendario = CALENDAR(DATE(2024,1,1), TODAY())`
- Ligue `Calendario[Date]` às datas principais (ex.: `vw_bi_tarefas.data_conclusao`).

## 7. Publicar
1. **Arquivo → Salvar** (ex.: `CBC-BI.pbix`).
2. Botão **Publicar** (aba Página Inicial) → escolha o workspace do escritório.

## 8. Atualização automática (no navegador, qualquer computador)
1. Acesse app.powerbi.com → workspace → no **modelo semântico** publicado, clique em **⋯ → Configurações**.
2. Em **Credenciais da fonte de dados** → Editar → método: **Básico** → mesmo usuário/senha do passo 3 → (se houver opção de criptografia, desabilite a validação, igual ao passo 3.5).
3. Em **Atualização agendada**: ative e configure **07:00 e 18:00** (os dados sincronizam às 6h30 e 17h30).

## Pronto!
A partir daqui, dashboards funcionam no navegador (Mac ou Windows). O Desktop só é
necessário de novo para mudanças estruturais no modelo.

### O que cada view contém
| View | Conteúdo |
|---|---|
| vw_bi_tarefas | tarefas com status (pendente/atrasada/concluída), responsáveis, prazos |
| vw_bi_andamentos | todas as movimentações dos processos (histórico completo) |
| vw_bi_processos | carteira: fase, quadro, advogado, honorários, partes |
| vw_bi_funil | mudanças de fase datadas (tempo por etapa — acumula ao longo dos dias) |
| vw_bi_clientes | cadastro: origem de captação, cidade/UF, perfil, nascimento |
| vw_bi_financeiro | lançamentos: receita/despesa, vencimento × pagamento |
