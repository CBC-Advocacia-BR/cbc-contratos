# API ADVBOX — Referência completa dos 20 endpoints (validada ao vivo)

> Verificado contra a conta da CBC em 10/06/2026. Base: `https://app.advbox.com.br/api/v1`,
> header `Authorization: Bearer {ADVBOX_TOKEN}`. Paginação por `limit`/`offset` com `totalCount`
> na resposta. Limites: **30 GET/min** (usamos 15), **500 POST/dia por rota**, **500 PUT/dia**.
> Filtros sempre combinados com **E** (AND); filtros de data exigem o **par** start+end.
> `204` = vazio (não é erro). Datas geralmente `YYYY-MM-DD` (exceções anotadas).

## CLIENTES

### 1. `GET /customers`
Lista clientes com filtros: `name` (parcial), `phone`, `cellphone`, `identification` (CPF/CNPJ),
`document`, `email`, `city`, `state`, `occupation`, `created_start/created_end`.
Campos: id, name, identification, document, cellphone, phone, email, gender, civil_status,
occupation, endereço completo (street, postalcode, region, city, state, country), birthdate,
number_ctps/pis/cid, notes, **origin** (origem de captação!), created_at,
**lawsuits[]** {lawsuit_id, process_number, protocol_number}.
**Uso atual**: identificação do cliente no bot (por telefone/CPF). **BI**: ROI por origem,
geografia, perfil, crescimento da base. Total na conta: **2.696**.

### 2. `POST /customers`
Cria cliente. Obrigatórios: `users_id`, `customers_origins_id`, `name`.
Pegadinhas: bloqueia CPF **e nome** duplicados; CEP exige hífen (`99999-999`).
**Uso atual**: advbox-sync cria o cliente quando o contrato é assinado.

### 3. `GET /customers/{id}`
Um cliente + processos. Mesmo shape do item 1. Obs.: o campo `notes` costuma guardar links
(ex.: chat do ChatGuru legado).
**Uso atual**: bot carrega a identidade ativa da conversa.

### 4. `GET /customers/birthdays`
Aniversariantes (validado: retorna lista no mesmo shape de customers; 45 registros hoje).
**Uso futuro**: parabéns automáticos via bot (já mapeado no plano de ideias).

## PROCESSOS

### 5. `GET /lawsuits`
Carteira completa (paginada; `totalCount` = **3.161**). 22+ filtros (process_number,
protocol_number, customer, responsible, stage, type, datas...).
Campos: id, **process_number** (CNJ), protocol_number, folder (máx 30 chars),
**process_date** (distribuição), **fees_expec / fees_money / contingency** (R$ esperado,
recebido, contingência), type_lawsuit_id + **type**, group_id + **group**, **stages_id + stage**
(etapa), **step** (quadro do funil), **responsible_id + responsible** (advogado),
created_at, status_closure, **exit_production** (trânsito em julgado), **exit_execution**
(arquivamento), notes, **customers[]** {customer_id, name, identification, **origin**:
"ESCRITORIO" ou **"PARTE CONTRARIA"** (réus!)}.
**Uso atual**: backfill varre por aqui; bot busca por nº CNJ. **BI**: a mina de ouro —
carteira por fase/advogado, honorários, duração, ranking de réus.

### 6. `POST /lawsuits`
Cria processo. Obrigatórios: `users_id`, `customers_id[]` (mín. 1), `stages_id`,
`type_lawsuits_id`. O `process_number` é validado contra as bases do Judiciário
(não aceita número fictício). **Uso atual**: advbox-sync na assinatura do contrato.

### 7. `GET /lawsuits/{id}`
Um processo (shape do item 5). **Uso atual**: resposta do bot (fase, tipo, responsável).

### 8. `PUT /lawsuits/{id}`
Atualiza processo (fase, honorários, etc.). 500/dia. **Não usamos** (evitamos escrever no ADVBOX).

### 9. `GET /history/{lawsuit_id}`
Tarefas DE UM processo; filtro `status=pending|completed`. **Sem paginação** (ignora limit/offset).
Campos por item: task (tipo), date, date_deadline, local, users[] {name, completed...}.
**Uso atual**: seção "o que estamos fazendo / o que já fizemos" das respostas do bot
(com a lista de tarefas ignoradas aplicada).

### 10. `GET /movements/{lawsuit_id}`
TODOS os andamentos de um processo (histórico completo, sem filtro de data).
Campos: lawsuit_id, **date**, **title** (texto do andamento), **header** (tribunal, ex. "TJMG"),
process_number, protocol_number, customers (string). Origem TRIBUNAL (robôs) ou MANUAL.
⚠️ Retorna **204** quando vazio; token inválido pode redirecionar 302.
**Uso atual**: timeline do bot (traduzida pelo glossário) e backfill do histórico.

### 11. `POST /lawsuits/movement`
Cria andamento manual. ⚠️ Data em **DD/MM/YYYY** (diferente do resto). Path alternativo
`/movements` aparece na doc — a validar. **Não usamos.**

### 12. `GET /last_movements`
Último andamento de cada processo no período (`date_start`+`date_end`, paginado).
Mesmo shape do item 10. **Uso atual**: é o coração do monitor incremental (2×/dia).

## TAREFAS

### 13. `GET /posts`
Tarefas. **Default lista só as ABERTAS** (740 hoje). Filtros: 4 pares de data
(date, created, deadline, **completed** — validado funcionando: 5.326/30d, 18.768/12m),
`user_id`, `user_name`, `task_id`, `id`, `lawsuit_id`. Paginado com totalCount.
Campos: id, date, date_deadline, **task** (tipo), **reward** (pontos da gamificação!),
notes, local, lawsuits_id, created_at, lawsuit {process_number, customers[]},
**users[] {user_id, name, completed (datetime|null), important, urgent}** — a conclusão é
**por usuário**, não da tarefa.
**Uso atual**: monitor (criadas/concluídas, paginado) e backfill. **BI**: produtividade,
atrasos, pontuação por pessoa.

### 14. `POST /posts`
Cria tarefa. `display_schedule: true` põe na agenda (com start/end date/time e local).
Pegadinhas: bloqueia duplicada (mesmo tipo+processo+data); `guests` deve ser **array**
(inteiro causa 500). **Uso atual**: advbox-create-task (fluxo de contratos).

## PUBLICAÇÕES

### 15. `GET /publications/{lawsuit_id}`
Intimações/publicações de Diário Oficial e sistemas (PJe/Eproc/Projudi) de UM processo
(validado: process_number, start, date_deadline, local, created_at, author, responsible,
customers, texto). ⚠️ Não existe endpoint global — só por processo (caro para varrer tudo).
**Uso potencial**: alertas de intimação relevante para o cliente; BI só se necessário.

## FINANCEIRO

### 16. `GET /transactions`
Lançamentos (totalCount **1.045**). Filtros: lawsuit_id, category, responsible, customer_name,
debit_bank, cost_center, description, process_number, identification, ranges de
created/date_due/date_payment, competence (MM/YYYY).
Campos (validados): id, **entry_type** (income|expense), **date_due**, **date_payment**,
**competence**, **amount**, description (em MAIÚSCULAS), responsible, **category**,
lawsuit_id + process_number, name + identification (cliente), debit_bank/credit_bank,
**cost_center**.
**BI**: receita×despesa, inadimplência (due vs payment), margem por processo/tese, fluxo de caixa.

### 17. `GET /transactions/{id}` — um lançamento (shape acima).

### 18. `POST /transactions`
Cria lançamento. Pegadinhas: `amount: 0` → erro 500; `lawsuits_id` exige `customers_id` junto;
`date_payment` não pode ser futura; `entry_type` deve casar com o tipo da categoria
(income↔CRÉDITO, expense↔DÉBITO). **Não usamos.**

### 19. `PUT /transactions/{id}` — atualiza lançamento. **Não usamos.**

## CONFIGURAÇÕES

### 20. `GET /settings`
Todos os IDs/dimensões da conta: **users** (equipe), **origins** (origens de captação),
**tasks** (216 tipos, com reward), **stages** (149 etapas, com **step** = quadro),
**lawsuit_types** (tipos de ação), **financial** {banks, categories, cost_centers, departments}.
**Uso atual**: abas Etapas/Tarefas do painel + sincronização do catálogo (detecção de
inclusões/exclusões). **BI**: tabelas-dimensão.

## O que a API NÃO oferece
- Webhooks (eventos push) — por isso o monitor é por varredura
- Documentos/arquivos da Nuvem
- Agenda como entidade (só via posts com display_schedule)
- Intimações globais (só por processo)
- DELETE em qualquer recurso; concluir tarefa via API
- Detalhes de contratos de honorários e timesheet
