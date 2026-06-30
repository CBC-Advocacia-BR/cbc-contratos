# Avaliação do Sistema CBC Contratos + Plano de Refatoração
**Data:** 27/06/2026 · Avaliação recursiva dos principais módulos (5 exploradores em paralelo sobre o código real)

---

## Resumo em 1 minuto (linguagem simples)

O CBC Contratos é um sistema **maduro e completo** — a fundação é boa: design system com tokens (`--cbc-*`), 49 funções de servidor bem organizadas em bibliotecas compartilhadas, e o Dashboard/funil recém-redesenhado está sólido.

Mas, como todo sistema que cresceu rápido, acumulou **dívida técnica** em 3 frentes:

1. **3 arquivos "gigantes"** que fazem coisa demais — `FormPanel` (Novo Contrato, ~2.000 linhas), `ContratosTab` (Contratos Salvos, ~2.165 linhas) e `App.jsx` (a casca do app, ~1.740 linhas). São como gavetas de arquivo lotadas: funcionam, mas achar e mudar algo é difícil e arriscado.
2. **Modo escuro quebrado em 2 telas** — o Novo Contrato e os Contratos Salvos têm ~176 cores **fixas no código** (em vez de usar os tokens). No modo escuro, isso deixa texto com contraste ruim ou ilegível. É invisível pra quem usa modo claro, mas real.
3. **O navegador faz trabalho que deveria ser do servidor** — algumas automações (principalmente o **envio ao Google Drive**) rodam dentro da aba aberta. Se o usuário fecha a aba no meio, o trabalho pode não terminar.

Nada disso é urgente nem quebra o uso diário. É **higiene** que, feita aos poucos, deixa o sistema mais fácil de evoluir, mais confiável e mais barato de manter.

> **Refatorar** = reorganizar o código **por dentro**, sem mudar o que você vê na tela. É como reorganizar uma cozinha bagunçada: os pratos saem iguais, mas cozinhar fica mais rápido e com menos erro.

---

## Parte 1 — Avaliação por módulo (simples)

### 1. Novo Contrato (`FormPanel.jsx`) — nota: ⚠️ precisa de atenção
**O que é:** a tela de criar contrato (o coração do sistema).
**O que está bom:** funciona, tem OCR de CNH, busca por CPF/nome, validação em tempo real, detecção de duplicata.
**O que poderia melhorar (simples):**
- É **um arquivo só com ~2.000 linhas** e um componente interno com **65+ "memórias" (hooks)**. Isso é muita coisa num lugar só — qualquer mudança mexe com risco.
- A **validação de CPF está escrita 3 vezes** em lugares diferentes. Se a regra muda, tem que lembrar de mudar nos 3 — fácil esquecer um e gerar bug.
- A validação geral está **espalhada em 5 camadas**.
- Tem **~40 cores fixas no código** → modo escuro fica ruim aqui.

### 2. Contratos Salvos (`ContratosTab.jsx`) — nota: ⚠️ precisa de atenção
**O que é:** a lista/gestão dos contratos (Lista / Cards / Kanban + automações).
**O que está bom:** visões múltiplas, timeline de automações, comentários em tempo real, retry de ZapSign/ADVBOX/Drive.
**O que poderia melhorar (simples):**
- Também é um **arquivo gigante (~2.165 linhas)** que governa tudo — lista, detalhe, 3 automações, 6 janelas (modais), tempo real, paginação.
- As **3 automações de retry** (reenviar ao ZapSign / ADVBOX / Drive) foram escritas cada uma do seu jeito, sem um padrão comum.
- As visões **Cards e Kanban não compartilham lógica** com a Lista — trocar de visão recarrega tudo.

### 3. A "casca" do app (`App.jsx`) — nota: ⚠️ precisa de atenção
**O que é:** o esqueleto que segura as 12 abas, o menu mobile, as permissões e as automações globais.
**O que está bom:** lazy-loading das abas, dock mobile, permissões por aba, atalhos de teclado.
**O que poderia melhorar (simples):**
- **O navegador faz trabalho pesado** a cada 5 minutos (verificar assinaturas, criar processo no ADVBOX, subir ao Drive). O **Drive é o mais crítico**: ele *trava* esperando a rede dentro da aba. Se o usuário fechar a aba, o upload pode se perder.
- O ZapSign **já tem webhook** (tempo real) no servidor — o polling do navegador virou um backup redundante.
- As permissões (quem vê o quê) estão **espalhadas em 3 lugares**.

### 4. Backend (49 funções de servidor) — nota: 🟢 bom, com duplicação pontual
**O que é:** as automações que rodam no servidor (ADVBOX, Asaas, Kommo, Portal, ZapSign, Bot, BI...).
**O que está bom:** **bem organizado** em famílias e bibliotecas compartilhadas (`_lib/`). Reutilização boa.
**O que poderia melhorar (simples):**
- Alguns trechos de lógica estão **copiados em vários lugares**: o "loop com orçamento de tempo" (Asaas + ADVBOX backfill), o padrão de "disparar trabalhador em segundo plano", e a **normalização de telefone/CPF** (em 4+ arquivos).
- O **padrão de "view de cruzamento"** (vw_processo_distribuicao / guia_paga / distribuido) e o **merge no frontend** (Dashboard + Saúde do Funil fazem o mesmo cruzamento) poderiam virar **1 utilitário só**.

### 5. Design system (consistência visual) — nota: 🟡 base ótima, aplicação irregular
**O que é:** as cores, fontes e componentes padrão.
**O que está bom:** **tokens excelentes** (claro/escuro/densidade bem definidos). O Dashboard usa quase 100% tokens.
**O que poderia melhorar (simples):**
- **~176 cores fixas no código** (principalmente Novo Contrato e Contratos Salvos) que **ignoram o modo escuro**.
- **3 estilos diferentes de botão** entre as abas (cada tela fez do seu jeito).
- **"Eyebrows" em CAIXA ALTA** em todo lugar — e isso **vai contra a própria regra do projeto** (o `index.css` diz pra usar "sentence case" porque caixa-alta é ~30-50ms mais lenta de ler).
- Tamanhos de fonte sem padrão (`text-[11px]`, `[10px]`, `[9px]`...).

---

## Parte 2 — Plano de refatoração (priorizado)

Ordenado por **impacto ÷ esforço**. Cada item é independente e pode ser feito numa sessão isolada, com backup + testes + deploy (do jeito que viemos fazendo).

### 🔴 Onda 1 — Confiabilidade e modo escuro (maior retorno)
| # | O quê | Onde | Por quê | Esforço |
|---|---|---|---|---|
| 1 | **Mover o envio ao Drive para o servidor** (job em segundo plano / cron) | `App.jsx:727-876` → função Netlify | É a única automação que *trava* o navegador; no servidor garante entrega 24/7 mesmo com a aba fechada | ~4h |
| 2 | **Trocar as ~176 cores fixas por tokens** (`#1B3A5C` → `var(--cbc-navy)` etc.) + criar tokens p/ os badges de status | `FormPanel`, `ContratosTab` | Conserta o modo escuro de verdade nas 2 telas mais usadas | ~4h |
| 3 | **Unir a validação de CPF num lugar só** | `validation.js` (consolidar as 3 cópias) | Fim dos bugs de "mudei aqui mas esqueci ali" | ~1h |

### 🟠 Onda 2 — Quebrar os "arquivos gigantes" (manutenção)
| # | O quê | Onde | Por quê | Esforço |
|---|---|---|---|---|
| 4 | Extrair o **OCR** e a **validação do formulário** para "ganchos" (hooks) reutilizáveis | `FormPanel` (OCR ~195 linhas; validação ~63) | Tira ~260 linhas do monolito; testável e reusável no import | ~3h |
| 5 | Extrair sub-componentes do Novo Contrato (Identificação PF/PJ, Cláusula, Endereço) | `FormPanel:734-815, 1634-1732` | FormPanel cai de ~2.000 → ~1.200 linhas | ~4h |
| 6 | Extrair **gancho de dados** da lista (`useContratosData`) + **construtor de query** | `ContratosTab:788-1152, 878-992` | Tira ~400 linhas de "callback hell"; tempo real mais robusto | ~4h |
| 7 | Extrair **gancho de automação** (ZapSign/Drive/ADVBOX num padrão só) | `ContratosTab` + `App.jsx` | Um lugar para todo retry, testável | ~3h |
| 8 | Extrair **registro de abas** + **permissões (RBAC)** + **atalhos** de `App.jsx` | `App.jsx:603-1576` | App.jsx cai ~30%; adicionar aba vira config, não cirurgia | ~4h |

### 🟡 Onda 3 — Backend DRY + consistência visual
| # | O quê | Onde | Por quê | Esforço |
|---|---|---|---|---|
| 9 | Extrair utilitários compartilhados (normalizar telefone/CPF, paginação, `promiseMap`) | `_lib/` (novo `utils.mjs`) | Mesma lógica em 4+ lugares → 1 só | ~1h |
| 10 | Consolidar o "loop com orçamento de tempo" e o "disparar trabalhador" | `asaasMirror.mjs` + `botDb.mjs` | Remove ~50 linhas duplicadas; retries previsíveis | ~3h |
| 11 | Um **gancho único de merge** de processo (distribuído/guia paga) no frontend | `Dashboard.jsx` + `FunnelHealthPanel.jsx` | Hoje o mesmo cruzamento está duplicado nas 2 telas | ~1.5h |
| 12 | Padronizar **botões** (1 vocabulário) + remover **CAIXA ALTA** dos labels + usar classes `.is-active` | vários | Visual consistente; segue a própria regra do projeto | ~3h |

### ⚪ Onda 4 — Limpeza (rápido, baixo risco)
- Remover código morto: `steps/`, `Stepper.jsx`, `MonthlySeries`, `HeroKpi`, `StatusDonut` (já órfãos), legado ChatGuru/Leads. *(já tem um chip de tarefa pro MonthlySeries.)*
- Cutover do `server/` modular (o `src/*` existe, o monólito `index.js` ainda roda).

**Total estimado:** ~40h de trabalho, fatiável em ~12 sessões independentes. Nenhuma muda o que o usuário vê (exceto a Onda 1 #2, que **conserta** o modo escuro, e a Onda 3 #12, que deixa o visual mais consistente).

> ⚠️ **Fora deste plano (mas mais importante):** as pendências de **segurança** já documentadas — RLS allow-all, `SUPABASE_SERVICE_ROLE_KEY` não configurada, tokens no bundle. Essas exigem você (Paulo) e coordenação; estão no `CLAUDE.md`.

---

## Parte 3 — 3 sugestões de design novas

Pensadas **dentro** da identidade CBC (navy/dourado/Cormorant + Lato, tokens `--cbc-*`) e do princípio "a ferramenta some na tarefa". Não são enfeite — cada uma resolve uma fricção real.

### 💡 1. "Linha do tempo do contrato" (jornada completa)
**Problema:** hoje, ao abrir um contrato, o status das automações é uma fileirinha de bolinhas pequenas. É difícil ver *o que* aconteceu, *quando* e *o que falhou*.
**Ideia:** uma **linha do tempo vertical** ao expandir o contrato — Criado → Enviado → Assinado → Drive → ADVBOX (cliente/processo) → Kommo → Distribuído → Guia Paga → Citação — cada passo com **data/hora, quem fez, e estado** (✓ feito / ⏳ rodando / ⚠️ falhou + botão "tentar de novo"). Cor por estado, dourado no marco atual. Atende direto o princípio #3 ("estado sempre visível"). Reaproveita o `getCompletedSteps` que já existe — só muda a apresentação.

### 💡 2. Paleta de comando (Cmd+K que faz, não só busca)
**Problema:** secretárias/vendedores fazem tarefas repetitivas e navegam por abas o tempo todo. O Cmd+K hoje só **busca contrato**.
**Ideia:** transformar o Cmd+K numa **paleta de comando** (estilo Linear/Raycast, mas na cara da CBC): além de buscar contrato/cliente, executar **ações** — "Novo contrato", "Ir para Boletos", "Enviar ao ZapSign", "Ver cobranças do cliente X", "Abrir Dashboard de junho". Digita 2-3 letras e age. Para quem usa o dia todo, é o maior ganho de velocidade possível (princípio #1). Já existe a base (GlobalSearch + fuse.js).

### 💡 3. "Cockpit do dia" (o que precisa de mim hoje)
**Problema:** o Dashboard é de **análise** (KPIs, funil, gráficos) — ótimo pro sócio, mas o operador quer saber *"o que eu preciso resolver agora"*. Hoje isso é uma faixa pequena ("Ação necessária").
**Ideia:** uma **tela inicial de operação** — um cockpit enxuto com cartões de ação: *assinaturas paradas há +3 dias*, *automações que falharam*, *boletos vencendo*, *leads pra retomar*, *meta do mês* (com a celebração que já existe). Separado do Dashboard analítico. Transforma a faixa atual num verdadeiro "centro de comando do dia". Navy de fundo + dourado nos marcos, denso mas com 1 foco claro (princípio #2).

> Posso prototipar visualmente qualquer uma das 3 (mockup na cara da CBC) antes de a gente decidir construir.
