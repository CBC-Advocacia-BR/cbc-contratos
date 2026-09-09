# Painel do Vendedor ("Meu Painel") — design

**Data:** 09/09/2026
**Pedido:** Paulo Conforto
**Estado:** desenho aprovado em conversa; nada implementado.

---

## 1. O problema

Os quatro closers (Mariana Beraldo, Ana Cristina Piva, Beatriz Cavalcante, Emerson Calista)
não têm nenhuma tela que responda "o que eu preciso fazer hoje". A informação existe, mas
espalhada em quatro lugares que não conversam: a agenda no Google, a conversa no Kommo, o
contrato no sistema e a tarefa no ADVBOX.

A aba "Minhas Vendas" que existia até 09/09/2026 não resolvia isso e foi removida no mesmo
dia por nunca ter sido usada (todas as tabelas de trabalho estavam vazias). Este painel **não
é a volta daquela aba**: aquela era comissão, guia de custas e kanban de carteira; esta é
operação de negociação. Nada do que foi removido volta.

## 2. O que o vendedor faz, na ordem (ditado pelo Paulo)

1. Faz o contrato
2. Cobra a assinatura
3. Contrato assinado
4. Junta a documentação necessária para a ação
   - faltando algo, o operacional lança a tarefa `DOCUMENTAÇÃO FALTANDO` no ADVBOX **para o vendedor**
5. Espera o operacional montar e distribuir
6. Ação distribuída
7. Sendo justiça comum, o vendedor envia e cobra a guia de custas
8. **Venda concluída** = processo protocolado e guia paga

O vendedor age nas etapas 2, 4 e 7. As demais são espera.

## 3. Escopo desta versão

A v1 cobre as etapas **2 e 4**, a agenda e o placar de distribuídos. A etapa 7 (guia de
custas) fica **fora**, ver §9.

---

## 4. Medições que sustentam o desenho

Tudo abaixo foi medido no banco em 09/09/2026, antes de decidir qualquer coisa.

### 4.1 Não existe hoje ligação contrato ↔ vendedor

`contratos.vendedora_email` está **NULL nos 370 contratos** dos últimos 120 dias. A coluna
existe e nunca foi preenchida. Quem funciona é `created_by`, que cobre 367 dos 370:

| created_by | contratos | pendentes | assinados |
|---|---|---|---|
| marianamaciel@ | 196 | 34 | 157 |
| anacristina@ | 106 | 23 | 82 |
| beatriz@ | 54 | 10 | 44 |
| emerson@ | 7 | 2 | 5 |

A coluna "pendentes" acima é bruta (120 dias, **incluindo arquivados**). A pendência real que
vai para a tela são 18, ver §4.5.

⚠️ **O Emerson tem 63 calls em 30 dias e 7 contratos em 120.** Quem atende nem sempre é quem
digita. É o que motiva a transferência do §6.

### 4.2 As quatro agendas são exatamente as quatro vendedoras

`agenda_videochamadas.vendedora_email` só tem esses quatro valores. Volume futuro é **baixo**:
15 compromissos marcados no total (Mariana 6, Ana 4, Emerson 3, Beatriz 2). O painel precisa
ficar honesto com pouca coisa na tela, não desenhado para agenda cheia.

Cobertura nos últimos 30 dias: 314 de 320 eventos têm `lead_id` (98%), 318 têm telefone.
`meet_status`: 226 realizadas, 60 no-show, 20 sem conferência.

### 4.3 A régua de "distribuído" do Paulo funciona, e uma das duas condições é redundante

Regra pedida: tarefa `DISTRIBUIR AÇÃO` concluída **e** número de processo vinculado.

Medido sobre os assinados: **a tarefa concluída sempre vem acompanhada de número**. Exigir as
duas coisas dá exatamente o mesmo resultado que exigir só a tarefa:

| created_by | assinados | tarefa OK | tem número | regra completa |
|---|---|---|---|---|
| marianamaciel@ | 182 | 127 | 148 | **127** |
| anacristina@ | 120 | 70 | 96 | **70** |
| beatriz@ | 51 | 33 | 39 | **33** |
| emerson@ | 5 | 4 | 4 | **4** |

O inverso não vale: 21 processos têm número sem a tarefa concluída. A tarefa é o critério que
manda. **A regra fica com as duas condições assim mesmo**, porque é a definição do Paulo e não
custa nada; a redundância está documentada aqui para quem for ler a view e estranhar.

⚠️ `%DISTRIBUIR%` genérico NÃO serve: `DISTRIBUIR CUMPRIMENTO + ATUALIZAR CRM` (374 concluídas)
e `DISTRIBUIR IDPJ` (66) são outras fases e inflariam o placar. Só `DISTRIBUIR AÇÃO`.

### 4.4 As tarefas do vendedor já existem no ADVBOX, atribuídas nominalmente

Tarefas **abertas** hoje: Ana 38, Mariana 12, Beatriz 9, Emerson 2. Por tipo:
`ACOMPANHAR PAGAMENTO` 18 · `DOCUMENTAÇÃO FALTANDO` 17 · `PROCEDIMENTO REGISTRADORES` 12 ·
`AVISAR CLIENTE DISTRIBUIÇÃO` 7 · `CUSTAS ANTES DA DISTRIBUIÇÃO` 4 · `SOLICITAR DOCUMENTOS` 3.

Nada precisa ser inventado: a fonte é `vw_bi_tarefas`, casando por `responsaveis` (nome
completo, não e-mail).

### 4.5 A pendência de assinatura é pequena e o dado de abertura está limpo

Contratos `enviado_zapsign` **não arquivados**: 18 no total (Ana 7, Mariana 7, Beatriz 3,
Emerson 1). Desses, **3 nunca foram abertos**; o recordista foi aberto 7 vezes sem assinar.
Fonte: `contratos.zapsign_links[].times_viewed`.

### 4.6 A lista de negociação: 40 leads com janela de 7 dias

Quem compareceu à call e não tem contrato:

| Vendedor | 7 dias | 30 dias |
|---|---|---|
| Mariana | 14 | 85 |
| Emerson | 11 | 37 |
| Ana | 9 | 18 |
| Beatriz | 6 | 40 |
| **total** | **40** | **180** |

Decisão do Paulo: **abrir em 7 dias**, com seletor para 30. A janela de 30 traria 180 nomes
acumulados, boa parte já morta, porque o botão de descarte nunca existiu.

### 4.7 Resort do lead: só por tag do Kommo, e as tags não estão espelhadas

Não há como derivar resort de lead sem contrato:
`kommo_leads` não guarda tags, e dos 220 leads em negociação **nenhum tem CPF** no espelho
(o CPF só é coletado quando vira contrato), então o caminho por `clientes.empreendimentos` não
existe.

A fonte é a **tag do lead no Kommo**, que vive só lá (`_embedded.tags`). Medição de 23/07/2026:
66,7% dos leads têm alguma tag, **32,9% têm tag igual a nome de resort exato**. Já existe em
produção o resolvedor `utils/kommoResolve.js → resolveResortTag()`, que limpa tag suja
(`Acordos Particular-Ondas Praia` → Ondas Praia, `ATRIUM` → Atrium Thermas) e cobre parte das
parciais além dos 32,9%.

⚠️ **Expectativa a manter baixa: o resort vai aparecer vazio na maioria das linhas.** É limite
da fonte, não do painel.

### 4.8 Mapa e-mail → usuário do Kommo (deduzido e confirmado pelo Paulo)

Cruzando os leads da agenda de cada uma com `kommo_leads.responsavel`:

| Vendedora | Usuário Kommo | Concentração |
|---|---|---|
| Ana Piva | `15297463` | 83% |
| Emerson | `15562427` | 63% |
| Beatriz | `15297507` | 56% |
| Mariana | `15297447` | 54% |

⚠️ **Pendência de implementação:** o usuário `15284979` aparece em TODAS as agendas (17% a 27%)
e tem 3.982 leads. Ninguém sabe quem é. **Antes de ligar a escrita no Kommo, ler `GET /users`
da API e mostrar ao Paulo o nome real de cada id, inclusive esse.** Escrever responsável errado
no CRM é estrago difícil de desfazer.

---

## 5. A tela

Aba **"Meu Painel"**, logo depois de Contratos. Desenhada para computador; não pode quebrar no
celular, mas não recebe tratamento mobile próprio (decisão do Paulo).

**Quem vê o quê:** cada vendedor vê o próprio funil. Paulo, Bruno e Lorenza (`SOCIOS_EMAILS`)
veem um seletor "ver como: Mariana / Ana / Beatriz / Emerson".

⚠️ **Isto é visibilidade de tela, não segurança.** A RLS deste banco é allow-all: o painel
esconde o funil dos colegas na interface, mas a chave pública do app continua permitindo ler
tudo. Mesma limitação que o Dashboard Sócios tinha. Fechar a RLS é outro projeto.

### 5.1 Agenda (hoje + 7 dias)

Compromissos agrupados por dia: hora, nome do cliente, link do Meet.

**Alerta sutil de compromisso novo:** o evento cujo `primeiro_visto_em` é posterior à última
visita do vendedor ao painel ganha um ponto dourado e a palavra "novo". Some quando ele abre a
aba. Nada pisca, nada apita, nada vai para o sino. O carimbo da última visita fica em
`localStorage`, com chave por **usuário logado + vendedor visualizado**: o Paulo olhando o
painel da Mariana não consome o "novo" dela, e cada sócio tem o seu próprio carimbo por
vendedor.

### 5.2 Pendências (aparecem só se houver o que fazer)

| Faixa | Fonte | Mostra |
|---|---|---|
| Cobrar assinatura | `contratos` status `enviado_zapsign`, não arquivado | cliente, dias desde o envio, **nº de aberturas** ou "nunca abriu" em destaque |
| Documentação faltando | `vw_bi_tarefas`, tarefa `DOCUMENTAÇÃO FALTANDO` aberta | cliente, há quanto tempo espera |

Só essas duas nesta versão (decisão do Paulo). As outras tarefas do ADVBOX (acompanhar
pagamento, avisar cliente da distribuição) ficam de fora.

### 5.3 Leads em negociação (corpo do painel)

**Definição:** compareceu à videochamada (`meet_status = 'realizada'`) nos últimos 7 dias,
não tem contrato e não foi descartado. Ordenado do mais parado para o mais recente.

Quem **faltou** à call fica de fora (decisão do Paulo). Os no-shows já têm a recuperação
automática por e-mail cuidando deles.

Cada linha traz:
- **nome, que é o link** para a conversa do Kommo, aberto em outra aba
- telefone
- há quantos dias foi a call
- resort deduzido da tag, quando existe (§4.7)
- histórico: se já foi atendido antes, quantas vezes

**Botão "não fechou"** pede o motivo e tira da lista:
`Preço` · `Sumiu` · `Contratou Concorrente` · `Custas` · `Outro` (com especificação
**obrigatória**).

**Botão "transferir para"** — ver §6.

**Lead descartado que agenda de novo volta para a lista.** O descarte vale para a call que o
originou: se houver videochamada realizada com data POSTERIOR ao descarte, o lead reaparece
(com a etiqueta "voltou"). Sem essa regra, um cliente que sumiu e depois procurou o escritório
de novo ficaria invisível para sempre.

### 5.4 Placar de distribuídos

"Distribuídos em setembro: N" ao lado do acumulado. Conta pela **data de conclusão da tarefa
`DISTRIBUIR AÇÃO`**. Clicar abre a lista com cliente e número do processo.

### 5.5 Atualização

Carrega ao abrir a aba, com a hora da carga visível, e um botão "atualizar". Sem
auto-refresh e sem realtime: o Monitor já mostrou que timer esquecido em aba aberta consulta o
banco o dia inteiro à toa. As agendas continuam sincronizando sozinhas a cada 15 minutos por
trás.

---

## 6. Transferência de lead entre vendedores

Pedido do Paulo, e é o que fecha o buraco do `created_by` (§4.1).

**Um mecanismo só resolve os dois casos:** a tabela `vendedor_atribuicao` sobrescreve o dono
padrão. Transferir um lead leva junto tudo o que nasceu dele — o contrato, a pendência de
assinatura e o crédito no placar de distribuídos.

- **Vendedor** transfere um lead **seu** para outro vendedor.
- **Paulo e Bruno** transferem qualquer um.
- **Sem aceite:** cai direto na tela de quem recebeu, marcado como "recebido de fulano".
- **Reflete no Kommo:** troca o `responsible_user_id` do lead, usando o mapa do §4.8, pela fila
  `kommo_queue` (se o Kommo estiver fora, completa depois em vez de perder).
- Toda transferência grava quem moveu, para quem, quando e por quê.

---

## 7. Arquitetura

Abordagem escolhida: **views no banco + consultas do frontend**, o padrão que o projeto já usa
nas 16 `vw_bi_*` e no `funilSources.js`. As alternativas foram descartadas: RPC única concentra
regra de negócio em PL/pgSQL sem teste e transforma ajuste de layout em migração; function
agregadora com Kommo ao vivo deixa o painel refém da estabilidade do Kommo, que é exatamente o
acoplamento que derrubou as agendas em julho.

### 7.1 Banco (6 objetos novos, nada alterado)

| Objeto | Papel |
|---|---|
| `vw_vendedor_negociacao` | agenda × contratos × descarte × atribuição |
| `vw_vendedor_pendencias` | enviados não assinados (com aberturas) + `DOCUMENTAÇÃO FALTANDO` |
| `vw_vendedor_distribuidos` | assinados com `DISTRIBUIR AÇÃO` concluída + número |
| `vendedor_atribuicao` | sobrescreve o dono: entidade (lead/contrato), id, vendedor, quem moveu, quando, motivo |
| `vendedor_leads_descartados` | lead, vendedor, motivo, observação, quem, quando |
| `kommo_lead_tags` | espelho das tags, preenchido sob demanda |

⚠️ **Não mexer em `kommo_leads` nem na RPC `kommo_leads_upsert`.** Tabela separada para as tags
custa quase nada e evita tocar num sync diário que funciona há meses.

Views com `security_invoker = true`, seguindo o padrão das `vw_bi_*`.

### 7.2 Function

`kommo-tags-lote.mjs` — recebe até 250 lead_ids, faz **uma** chamada ao Kommo
(`GET /leads?filter[id][]=...`), passa pelo `resolveResortTag` existente e grava em
`kommo_lead_tags`. Uma requisição por carregamento do painel, não 180.

### 7.3 Frontend

```
components/MeuPainelPanel.jsx        orquestração
components/meupainel/
  AgendaProximosDias.jsx
  FaixaPendencias.jsx
  ListaNegociacao.jsx
  PlacarDistribuidos.jsx
  ModalNaoFechou.jsx
  ModalTransferir.jsx
utils/meuPainelCompute.js            lógica pura, testada
utils/meuPainelSources.js            consultas paginadas
```

`meuPainelCompute.js` concentra o que dá para testar sem servidor: dias parado, o que conta
como compromisso novo, ordenação, agrupamento por dia, elegibilidade de transferência.

### 7.4 Três cuidados que a história deste projeto exige

1. **Datas em BRT.** `ymdLocal`/`fmtData` no frontend, `_lib/dataBrt` no servidor. O bug das
   21h (dia UTC já é amanhã) apareceu 27 vezes nesta base.
2. **Paginação com ordenação total.** `fetchAllPaged` de `utils/supabasePaged.js`. `.limit(N)`
   não levanta o teto de 1.000 linhas do PostgREST, e as views podem passar disso.
3. **Cache de aba.** `utils/cacheAba.js`, 5 minutos. Trocar de aba desmonta o painel.

### 7.5 Permissão

`user_permissions.tabs.meu_painel`, mais acesso automático para `SOCIOS_EMAILS`. Linha nova na
matriz do AdminPanel.

---

## 8. Testes

Seguindo o padrão do projeto (vitest, lógica pura em `utils/__tests__/`):

- `meuPainelCompute.test.js` — dias parado com virada de dia às 21h BRT, detecção de
  compromisso novo, ordenação, agrupamento, quem pode transferir para quem.
- Casos de borda que já sabemos existir: lead sem `lead_id` (6 em 320), contrato sem
  `zapsign_links`, tarefa com dois responsáveis (`responsaveis` traz nomes separados por
  vírgula), lead com duas tags de resort distintas (não adivinha, deixa vazio).
- As views são validadas por consulta comparativa antes de entrar, como foi feito no item 175
  (1.319 clientes comparados um a um antes de trocar a fonte da aba Boletos).

---

## 9. Fora desta versão, e por quê

| Item | Motivo |
|---|---|
| **Guia de custas / venda concluída** | Definição já fechada com o Paulo: `JUNTAR CUSTAS` concluída. Mas o bloco de pendência não foi pedido para a v1, e a tabela própria de guias está vazia desde sempre. Entra na v2 com a definição já pronta. |
| Remarcar no-show | 46 casos em 30 dias. O Paulo tirou do escopo: a recuperação automática por e-mail já cuida. |
| Demais tarefas do ADVBOX | 44 das 61 abertas ficam fora (acompanhar pagamento, avisar cliente, registradores). Só documentação faltando entra. |
| Comissão, metas, kanban de carteira | Era a aba removida em 09/09. Não volta. |
| Celular | Só computador nesta versão. |
| Fechar a RLS | Projeto separado, ver §5. |

---

## 10. Riscos assumidos

1. **`created_by` é a chave do dono.** Contrato digitado por outra pessoa nasce na tela errada.
   A transferência (§6) é o remédio, mas exige alguém perceber e clicar.
2. **Tag cobre cerca de um terço dos leads.** Resort vazio na maioria das linhas.
3. **Visibilidade de tela, não segurança.** §5.
4. **A faixa de documentação depende de atribuição nominal no ADVBOX.** Tarefa atribuída a uma
   equipe genérica não aparece para ninguém. Hoje as 17 estão nominais.
5. **O usuário Kommo `15284979` é desconhecido.** Ler `GET /users` e confirmar com o Paulo antes
   de qualquer escrita no CRM. §4.8.
