# Especificação — Etapas de Videochamada no Funil (Google Agenda)

> Status: **desenho aprovado, aguardando configuração do Google Workspace** (pré-requisito p/ build).
> Data: 26/06/2026. Decisões tomadas com o Paulo no brainstorming (ver "Decisões").

## 1. Objetivo

Adicionar duas etapas no **topo** do funil de conversão — **Videochamada Agendada** e **Videochamada Realizada** — alimentadas pelas **agendas do Google** das vendedoras, sem que elas precisem registrar nada novo no nosso sistema. As vendedoras já codificam o resultado do atendimento pela **cor** do evento; o sistema **lê** essa informação.

Funil resultante:

```
Agendada → Realizada → [Criados → Enviados p/ assinatura → Assinados → Distribuídos]
                         (já existem hoje)
```

## 2. Decisões (Paulo, 26/06)

- **Contas:** Google **Workspace @advocaciacbc.com** (gerenciadas) → conexão central via conta de serviço.
- **Identifica o cliente:** pelo **convidado** do evento (e-mail externo).
- **Identifica que é atendimento:** evento com **convidado externo** (cliente) **E** **link de Google Meet**.
- **Status pela cor** (edição **Business Starter** não tem relatório de presença do Meet → cor é a fonte de "realizada/no-show").
- **Onde:** no **funil do nosso sistema** (Dashboard + aba Saúde do Funil).
- **Reconciliar Pavão/Fechou** com os contratos (por e-mail do cliente).
- **Cadência:** sync **contínuo** (provisório) + **fechamento no dia 21** (snapshot oficial, imune a edições posteriores).
- **Calls:** Google Meet.

## 3. Regras de negócio

### 3.1 Identificação do atendimento de venda
Um evento conta como atendimento se, e só se:
- tem **≥1 convidado externo** (e-mail que **não** termina em `@advocaciacbc.com`) = o cliente; **E**
- tem **conferência do Google Meet** anexada (`conferenceData` com entryPoint de vídeo) — ou link `meet.google.com` na location/description.

Eventos cancelados (`status = cancelled`) são ignorados.

### 3.2 Status pela cor do evento (`colorId` da API)

| Cor (nome PT no Google) | `colorId` | Status no funil |
|---|---|---|
| Cor da Agenda (padrão) | *(ausente)* | **Agendada / pendente** |
| Manjericão (Basil) | `10` | **Realizada** |
| Tomate (Tomato) | `11` | **No-show** (não compareceu) |
| Pavão (Peacock) | `7` | **Fechou** (conferência opcional) |

> Os `colorId` serão confirmados no endpoint `colors` da API na implementação (mapeamento estável, mas verificar).

### 3.3 Contagem no funil (cumulativo)
- **Agendada (total)** = todos os atendimentos cujo evento cai no período (independe de cor — todo atendimento foi agendado).
- **Realizada** = subconjunto com cor **Manjericão**. (Agendada ⊇ Realizada.)
- **No-show** = subconjunto com cor **Tomate** (métrica auxiliar).
- **Fechou** = derivado dos **nossos contratos** (contrato assinado do cliente, casado por e-mail) — **não** depende do Pavão. Pavão entra só na reconciliação.
- Contagem por **data do evento**, respeitando o **filtro de período** da tela (igual à etapa "Distribuídos").

### 3.4 Cadência / fechamento
- Robô roda a cada ~30–60 min: número **provisório** durante o mês (vale o estado atual das cores).
- **Janela de higienização (dia 21 do mês M):** as vendedoras revisam/arrumam as cores de
  **[1º dia do mês M−1 → dia 20 do mês M]**. Exemplos:
  - **21/fev** → revisa **01/jan a 20/fev**;
  - **21/mar** → revisa **fevereiro inteiro a 20/mar**.
- **Fechamento oficial:** no dia 21 do mês M, o **mês M−1** (que acabou de ser revisado por
  inteiro) vira **"fechado"** → snapshot na tabela de histórico; não muda mais se um evento
  antigo for editado depois. O trecho do mês M (até o dia 20) é uma **prévia revisada**; o mês M
  só fecha no dia **21 do mês M+1**.
- UI marca cada mês como **"em andamento (provisório)"** vs **"fechado"**.

### 3.5 Métricas e dimensões
- **% de no-show** (taxa de não comparecimento) = `no_show / (realizada + no_show)` — percentual
  dos atendimentos que tiveram desfecho e o cliente não apareceu. (Denominador ajustável; default
  exclui os ainda pendentes.) Disponível **no total** e, futuramente, **por vendedora**.
- **Dimensão por vendedora/agenda:** o dado é capturado **por vendedora** (`vendedora_email`), e o
  backend/consultas/views são construídos para **agrupar e filtrar por agenda**. **Nesta 1ª
  implementação a UI mostra o TOTAL** (todas as agendas somadas); o **filtro por vendedora é uma
  opção futura** — a estrutura de dados e as queries já ficam prontas p/ plugar o filtro depois,
  sem rework. (YAGNI na UI agora; só a base preparada.)

## 4. Arquitetura

### 4.1 Acesso ao Google (read-only)
- **Conta de serviço** no Google Cloud com **delegação de autoridade em todo o domínio** (domain-wide delegation), escopo **`https://www.googleapis.com/auth/calendar.events.readonly`**.
- Autorizada pelo **super-admin do Workspace** (painel Admin → Segurança → Controles de API → Delegação). 
- Chave (JSON) da conta de serviço fica em **env do Netlify** (`GOOGLE_SA_KEY`), nunca no bundle do frontend.
- O robô usa a conta de serviço **personificando** (impersonate) cada vendedora p/ ler a agenda dela.

### 4.2 Robô (Netlify Function agendada)
`netlify/functions/agenda-videochamadas-sync.mjs` (cron, ex.: `*/45 * * * *`):
1. Lista as vendedoras (e-mails) — de `user_permissions` (`perfil_vendas='vendedora'`) ou config.
2. Para cada uma: `GET calendar/v3/calendars/{email}/events` na janela **[hoje−90d, hoje+30d]**, `singleEvents=true`.
3. Filtra atendimentos (3.1), extrai: `event_id`, `vendedora_email`, `cliente_email`/`cliente_nome` (convidado externo), `status` (cor → 3.2), `scheduled_at` (start), `tem_meet`.
4. **Upsert idempotente** em `agenda_videochamadas` (PK = `event_id`). Re-ler atualiza status/cor.
5. Marca eventos sumidos (não retornados) como `removido` (best-effort) p/ não inflar.

### 4.3 Tabela `agenda_videochamadas` (Supabase)
```
event_id text PRIMARY KEY
vendedora_email text
cliente_email text
cliente_nome text
status text            -- agendada | realizada | no_show | fechou
color_id text
scheduled_at timestamptz
tem_meet boolean
updated_at timestamptz default now()
raw jsonb              -- payload bruto p/ auditoria
```
- **RLS fechada** (tem PII de cliente): leitura só via view agregada/segura ou role autenticada gated. Escrita só pelo robô (service role / RPC com segredo, padrão do projeto).
- **Histórico de fechamento:** tabela `agenda_videochamadas_fechamento` — **uma linha por
  (mes, vendedora)** com `agendadas, realizadas, no_show, fechou, no_show_pct, fechado_em`. O
  **total** do mês = soma das linhas; o **filtro por vendedora** (futuro) sai daqui. Um job no
  **dia 21** (cron `0 12 21 * *`) calcula e congela o **mês M−1**. Idempotente (re-rodar no mesmo
  mês não duplica).

### 4.4 Funil (frontend)
- View/consulta agregada `vw_funil_videochamadas` (contagens por período/vendedora) **OU** fetch + compute client-side (merge), seguindo o padrão da etapa "Distribuídos".
- Dashboard (`dashboard/compute.js` + `widgets.jsx` FunnelCard) e aba **Saúde do Funil** (`funnelCompute.js` + `FunnelHealthPanel.jsx`): duas barras no topo, contadas por `scheduled_at` no período.

### 4.5 Reconciliação Pavão/Fechou ↔ contrato
- Cruza `cliente_email` dos eventos "fechou/Pavão" com `contratos` (contratante e-mail) → relatório:
  - **"fechou na agenda mas sem contrato no sistema"** (perda potencial / contrato não cadastrado);
  - **"tem contrato mas a agenda não marcou fechado"** (cor esquecida).

## 5. Segurança / privacidade
- Acesso Google **somente leitura** (`calendar.events.readonly`).
- Chave da conta de serviço só no servidor.
- `agenda_videochamadas` com **RLS fechada** (dados de cliente). Exposição ao funil só de **contagens agregadas** (não a lista de e-mails) — exceto o painel de reconciliação (gated a sócios/admin).
- Sem escrita em nenhuma agenda.

## 6. Dependências (pré-requisitos — Paulo/TI)
1. **Config no Google Workspace** (ver `docs/AGENDA_GOOGLE_SETUP.md` / passo a passo no chat): criar conta de serviço, ativar Calendar API, autorizar a delegação com o escopo read-only.
2. Entregar a **chave JSON** da conta de serviço (vai p/ env `GOOGLE_SA_KEY` no Netlify).
3. Entregar a **lista de e-mails das vendedoras** (ou confirmar que dá p/ derivar de `user_permissions`).

## 7. Sequência de implementação
1. (Paulo/TI) Config Workspace + chave + lista. ← **bloqueia o resto**
2. `agenda-videochamadas-sync` + tabela + teste com 1 agenda real (validar cores/convidados).
3. Etapas no funil (Dashboard + Saúde do Funil) + snapshot de fechamento.
4. Painel de reconciliação Pavão↔contrato.
5. Deploy + validação com as agendas reais.

## 8. Fora de escopo / futuro
- **Filtro do funil por vendedora/agenda** — o dado e as queries já saem prontos (capturado por
  `vendedora_email`); falta só ligar o seletor na UI. Implementação atual mostra o **total**.
- **% no-show por vendedora** na UI (o cálculo por vendedora já existe no histórico de fechamento).
- **Upgrade p/ Business Standard** → relatório de presença do Meet → "realizada/no-show" 100% automáticos (dispensa as cores). Sistema fica preparado p/ plugar.
- Zoom (não usado hoje).
- Escrever/alterar eventos na agenda.

## 9. Implementação real (26/06/2026) — EM PRODUÇÃO
> O acesso mudou de **conta de serviço** para **OAuth** (a org bloqueia chave de SA via `iam.disableServiceAccountKeyCreation`). Envs: `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` (conta que consentiu = paulo@, escopo `calendar.events.readonly`; compartilhamento interno ON → paulo@ lê todas as agendas @advocaciacbc.com). Vendedoras = lista fixa em `_lib/googleAgenda.mjs` (`beatriz@`, `marianamaciel@`).

- **v1** (deploy `6a3ec7f0…`): robô `agenda-videochamadas-sync.mjs` (cron `*/45`, janela [−180d,+30d]), tabela `agenda_videochamadas` (RLS fechada) + RPC `agenda_videochamadas_upsert` + view `vw_funil_videochamadas` (sem PII). Etapas Agendada→Realizada no topo dos 2 funis.
- **v1.1** (deploy `6a3ecca9…`): **Pavão (cor 7) conta como realizada** (realizadas = `realizada`+`fechou`); **exclusão de evento → status `excluida`** (sai da base) detectada por ausência via RPC `agenda_videochamadas_sweep` (só `source='live'`, guarda anti-zeragem). Coluna nova `source` (live/backfill).
- **Backfill** (deploy `6a3ece0c…`): descoberto que o fluxo convidado+Meet só começou em **junho**; pré-junho os atendimentos eram marcados **só por COR** (sem convidado/Meet). Function on-demand `agenda-videochamadas-backfill.mjs` (key-guard `x-bot-key`=BOT_RPC_SECRET; cor→status; `source='backfill'`) + RPC `agenda_videochamadas_backfill_upsert` (DO UPDATE só em backfill). Carregados **309 atendimentos** (abr+mai). Resultado: Abr 74% · Mai 72% · Jun 67% comparecimento. Jan/fev não puxados (anteriores ao sistema).
- **Limitação das linhas de backfill:** sem e-mail do cliente (não havia convidado) → alimentam só a contagem do funil, não a reconciliação por contrato.
