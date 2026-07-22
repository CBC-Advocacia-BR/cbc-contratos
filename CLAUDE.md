# CBC Contratos — Guia do Projeto

> **Documento de referência** para Claude Code navegar e desenvolver neste repositório.
> Seções 1–10 reescritas em **14/06/2026** para refletir a **v6.6.0 em produção**. O bloco "Estado atual" logo abaixo é o changelog detalhado e tem precedência sobre descrições genéricas. **Sempre valide telas/fluxo no app real antes de implementar** — UI muda rápido.

---

## ⚡ Estado atual — LEIA ANTES

**Versão em produção: v6.6.x** (última sessão 25/06/2026). Changelog detalhado das últimas sessões abaixo.

### 🔧 Correções de precisão deste guia (06/07/2026 — auditoria)

Alguns números/afirmações mais abaixo estavam defasados e ficam corrigidos aqui (têm precedência):
- **62 Netlify Functions** (+ **11 libs** em `_lib/`), não "40 funções / 5 libs".
- **`server/` foi APOSENTADO** (movido para `backups/20260620_152530_server_render_aposentado/`). Logo o **backup diário 03:00 BRT em S3 NÃO existe mais**. ~~⚠️ hoje **não há backup automático do banco** (pendência crítica, auditoria #87)~~ → **RESOLVIDO 17/07/2026**: backup próprio diário no **Google Drive** (ver seção "Incidente Supabase + backup próprio" abaixo). Onde o guia disser "backup diário/S3 via `server/`", leia como **substituído pelo backup no Drive**.
- **`steps/` e `components/Stepper.jsx` já foram REMOVIDOS** (não são mais "candidatos a remoção" — só restam em `backups/`).
- Maior componente hoje = **VendasPanel.jsx (~2516 linhas)**, depois ContratosTab (~2316) e SociosDashboard (~2043); o FormPanel (~2010) **não** é o maior.

### Incidente Supabase 17/07/2026 + backup próprio no Google Drive — EM PRODUÇÃO

**Incidente**: o projeto Supabase inteiro ficou fora 15:30→18:54 BRT (3h24) por incidente da plataforma (Database + Management API degradados, sa-east-1; "Project Actions Failing Across Multiple Regions"). Sintoma: app loga e não carrega (todo REST/Auth = 522 Cloudflare; Realtime ok). Nada nosso: deploy de véspera ok, anon key válida. Desligamento ordenado + boot limpo = **zero perda de dados**; webhook Asaas não interrompeu; kommo_queue drenou sozinha; crons perdidos na janela (asaas-sync-boletos/advbox-vendas-sync/advbox-monitor) re-disparados manualmente no mesmo dia. Diagnóstico rápido de repetição: memória `supabase-incidente-runbook` (⚠️ status page pode dizer "resolved" com o projeto ainda preso na fila de requeue — conferir o projeto, não a página).

**Backup próprio → Google Drive** (pedido do Paulo pós-incidente; commit `39f0f90`, deploy `6a5aa98e`):
- **`backup-diario.mjs`** (cron `0 6 * * *` = 03h BRT, mesmo horário do backup aposentado; manual = `?key=<BOT_PANEL_KEY>`) só DESPACHA → **`backup-worker-background.mjs`** (até 15 min): exporta as tabelas da whitelist via RPCs **`backup_tabelas`/`backup_dump`** (SECURITY DEFINER + `BOT_RPC_SECRET`, whitelist FIXA de **51 tabelas não-regeráveis** — espelhos asaas/bi/meta/kommo/bot_sync_state ficam FORA, voltam por backfill), gzipa e sobe via **Apps Script** (mesmo canal do save-to-drive) na pasta **"Backups Sistema CBC"** (id `14ChK5zjMNeG9hdFAW_rSO-yRlvBFbuk4`, dentro de "Paulo 2" — o Apps Script roda como `confortopaulo@gmail.com` e só tem permissão nessa árvore). Divide em partes se >24MB de JSON; status em `bot_config.backup_status`; migração `backup_drive` (arquivo `supabase_backup_drive.sql`). Validado 17/07: 51 tabelas, ~26k linhas, 3 arquivos ~8MB, 52s (ensaio local + produção).
- ⚠️ O **`db-backup-cron.mjs`** (Onda 1, 03h BRT → Supabase Storage) **nunca rodou** ("sem service role" diário) e guardaria o backup DENTRO do próprio Supabase — mantido intocado como 2ª camada futura: liga sozinho quando `SUPABASE_SERVICE_ROLE_KEY` for configurada. `advbox-sweep-cron` (mesma causa) e `bandwidth-check-cron` ("sem token") idem — heartbeats `ok=false` diários são esses 3, não são incidente.
- Retenção: sem limpeza automática v1 (~1-2MB/dia na pasta; Apps Script não apaga arquivo). Restauração: `.json.gz` → gunzip → JSON `{tabelas: {nome: [linhas]}}`.

### Aba "Tráfego" (Meta Ads operacional) — 15/07/2026 — EM PRODUÇÃO

Pedido do Paulo com entrevista de requisitos (3 rodadas). **Spec/plano**: `docs/superpowers/{specs,plans}/2026-07-14-aba-trafego-pago*`. Rollbacks: `./rollback.sh 6a56b49767a1ec8fb817bf5c` (pré-aba) · `./rollback.sh 6a582904bd991d9fbde5ffbe` (pré-worker, aba sem background). Backup: `backups/20260715_212630_aba_trafego/`.

- **13ª aba "Tráfego"** (`TrafegoPanel.jsx` + `trafego/{compute,api}.js`, tab key `trafego`): KPIs com comparação de período (7d default), série diária SVG, tabela de campanhas (status/orçamento/CPL/tendência/badge atenção), cards de criativos com **miniatura** e rankings (Top CTR/CPL/leads/**hook rate**) + badge **"saturando"** (freq ≥3,5 e CTR caindo 30%), bloco **"Do anúncio ao contrato"** (mensal: leads→vídeo→enviados→assinados+custo/assinado) e config de alertas. Permissão RBAC `tabs.trafego` (matriz do Admin; seed = Paulo/Bruno/Lorenza).
- **Espelho diário**: tabelas `meta_campanhas` (27), `meta_anuncios` (**648**, com thumbnail/permalink), `meta_ads_diario` (dia × campanha e dia × anúncio) — migração `meta_trafego` (arquivo `supabase_meta_trafego.sql`), RPCs `meta_trafego_upsert`/`meta_trafego_series` (BOT_RPC_SECRET). Backfill 90d rodado 15/07; **validação cruzada diário×mensal: 0,00% de divergência** em mai/jun (julho difere só pelo frescor do dia corrente).
- **Functions**: `meta-trafego-sync` (cron 07h10; `?hoje=1` síncrono leve = campanhas+dia; demais modos DESPACHAM) → **`meta-trafego-worker-background`** (15 min; catálogo completo + D-1..D-3 + limpeza 400d + **alertas**; ⚠️ lição: functions síncronas deste site estouram em ~26s — catálogo de 648 anúncios não cabe) → `meta-trafego-action` (**pausar/reativar/orçamento/config**; dupla trava JWT `db.auth.getUser` + lista trio; auditoria em `activity_log` + espelho imediato). Travas 401/403 testadas em produção; mutação Graph validada em campanha PAUSADA (orçamento 30→31→30, revertido).
- **Alertas** (1×/dia por tipo+campanha, config em `bot_config.meta_trafego`): CPL ontem >2× média 28d (gasto mín. R$100), campanha ACTIVE com entrega zerada, leads 7d <50% dos 7d anteriores → sino in-app do trio + e-mail via Resend (`sendAlertEmail` novo em `_lib/alertEmail.mjs`; sem `RESEND_API_KEY` só sino).
- **Pendências**: Paulo dar 1 clique de ação real in-app (o caminho JWT completo só o trio consegue).
- **v2 (16/07/2026) — onda de 64 melhorias escolhidas pelo Paulo** (commits `trafego v2:*`; suíte 326/326): **layout full-width** (margens do Dashboard); **RH/vagas fora de TODA a captação** (`isCampanhaRh` — decisão Paulo: campanhas [VAGA] são currículos, não vendas; ficam só flagadas na tabela); KPIs +CPC/concentração/leads-hoje; **meta mensal de leads com projeção** (editável, `bot_config.meta_trafego.metas`); **Leitura do período** (resumo em linguagem natural + recomendações por regra + anomalias z-score); série com **MM7+CPL**; donut de gasto; tabela ordenável com **ações em lote + Desfazer**; criativos com **retenção de vídeo p25-p100/ThruPlay** (colunas novas), curva de fadiga, **previsão de saturação**, ranking dos **Piores**, grid completo, filtros e **temas por tag de nome**; **conjuntos (adsets)** e **breakdowns** idade/gênero/UF/posicionamento (tabela `meta_ads_breakdown`, nível conta) com badge "caro"; comercial expandido (custos por etapa, taxas, ticket, receita, **origem Meta** via dados->origemCliente, **payback = recebido no Asaas** por CPF da coorte); alertas v2 (CPL/queda por campanha, freq alta, gasto-sem-lead, positivo melhor CPL, fadiga) c/ **destinatários editáveis** + **resumo semanal** (`meta-trafego-weekly`, seg 08h); períodos Hoje/Ontem/**livre** + comparação custom + persistidos; exports **xlsx/csv/PDF executivo**; skeleton, pull-to-refresh, cards mobile; Sentry tag aba=trafego, log de fetch >5s no Monitor, **teste com fixture REAL do espelho** (08-12/07: R$ 948,40/46 leads sem RH — pegou até regex `\b`→`\y` errado no meu SQL de conferência). Migração `meta_trafego_v2`(+v2_1). Fora por dependência: #92 lead-a-lead (espelho Kommo); #177 é v1 por regra de nome.
- **v3 (16/07/2026) — espelho COMPLETO p/ outras aplicações** (pedido Paulo: "abastecer o Supabase com todos os dados possíveis"; a aba JÁ era mirror-first — v3 amplia o que o espelho captura; suíte 334/334, rollback `./rollback.sh 6a592c0cb80caae140211ae2`): migração `meta_trafego_v3_espelho_completo` — catálogos ricos (`meta_campanhas` +ciclo de vida/buying_type/bid_strategy/lifetime; `meta_conjuntos` +**targeting completo em `publico` jsonb**/otimização/datas; `meta_anuncios` +**COPY inteira** título/corpo/CTA/video_id/imagem_url; todos com `raw` integral), `meta_ads_diario` +**quality rankings** da Meta (só level=ad; coalesce preserva), **`meta_conta_diaria`** nova (snapshot diário: gasto acumulado/saldo/limite/status) e **`meta_atividades`** nova (trilha `/activities` do Gerenciador: quem pausou/alterou o quê; idempotente). RPC `meta_trafego_upsert` v3 (+p_conta/p_atividades; assinatura antiga dropada — args nomeados de código velho seguem casando via defaults). **Views p/ consumo externo**: `vw_bi_trafego_mensal`/`vw_bi_trafego_diario` (grant `powerbi_cbc`, padrão vw_powerbi_contratos). Fetchers: campanhas c/ fields completos; ads/adsets **páginas de 25** (custo dinâmico ↑ com creative/targeting); `fetchConta`+`fetchAtividades` best-effort (nunca derrubam o sync; `?hoje=1` tb grava conta). ⚠️ `graphGetCampanha` da action passou a pedir fields completos (senão pausar apagaria buying_type/datas do espelho). **v3.1 (mesmo dia)**: pedir quality_ranking no insights DIÁRIO ad-level TRAVA a Graph (timeout 25s → worker morreu MUDO no teto de 15min, sem log; diagnóstico = reproduzir cada fetch localmente c/ token da env) — rankings são atributo ATUAL do anúncio e moram em **meta_anuncios** via `fetchQuality` (level=ad, `date_preset=last_30d`, sem time_increment, 4,7s). Backfill v3.1 validado: 648 ads (563 c/ copy), 63 públicos, 1.945 atividades, conta ok, views BI respondendo. **Dicionário de dados p/ quem for consumir: `docs/META_ESPELHO.md`** (regra p/ apps novas: leem `meta_*`, nunca a Graph).

### Leads Meta no funil + endereços distintos (14/07/2026) — EM PRODUÇÃO

Dois deploys em 14/07 (rollbacks: `./rollback.sh 6a566cf085c7714d803db7db` volta ao pré-Meta; `./rollback.sh 6a4e75d250556722a133f11d` volta ao pré-endereços/08-07).

- **Endereços distintos no contrato** (commit `58d5243`): 2 contratantes PF com endereços diferentes = cada um com o próprio endereço embutido na qualificação da caixa PARTES (formato da procuração) e SEM a linha "Residentes e domiciliados em"; endereços iguais/1 contratante = byte-idêntico ao anterior (snapshots passam sem regenerar). Só `contractHtml.js` — procuração e DOCX já eram corretos. Helper `mesmoEndereco()`. Flexão de gênero ("domiciliada") ficou de fora (decisão separada).
- **1ª etapa do funil = Leads de campanha Meta** (commits `501edbc` + `113330a`, este 2º = mesma etapa no **Funil de conversão do Dashboard**, respeitando o filtro de período por mês-calendário; rollback do 2º deploy: `./rollback.sh 6a568c35a67678f83b6b8980`): integração real com a **Meta Marketing API** (Graph v23, conta `act_969110338250520` = CA - CBC Distratos). Function **`meta-ads-sync.mjs`** (cron `0 10 * * *` = 07h BRT; backfill manual `GET ?backfill=1&meses=N`, cap 36) grava insights mensais por campanha em **`meta_ads_mensal`** via RPC `meta_ads_upsert` (security definer + `BOT_RPC_SECRET`, padrão asaas_mirror; leitura só authenticated). "Lead" = `onsite_conversion.messaging_conversation_started_7d` (conversas iniciadas click-to-WhatsApp, = "resultados" do Gerenciador) + lead forms. Parser puro em `_lib/metaAds.mjs` (testado). **Saúde do Funil**: barra "Leads de campanha" no topo + investimento/CPL + conversão lead→videochamada; sem dados a seção some. Logs no console do Monitor (origem `meta`). Backfill 24m rodado: **121 linhas, jul/2024→jul/2026** (~700-1000 leads/mês em 2025-26, CPL ~R$ 6-18).
- **Credenciais Meta**: system user `cbccontratosbi` (id 61591559806238, Admin) no Business Manager Conforto Bergonsi, com as 2 contas de anúncio + app **CBC BI** (id 1013043854834445); token **NUNCA expira**, envs `META_ADS_TOKEN` + `META_AD_ACCOUNT_ID` no Netlify (multi-conta: `META_AD_ACCOUNT_IDS` separado por vírgula). ⚠️ Higiene pendente (não urgente): token saiu com escopo largo (32 permissões, inclui ads_management) — regenerar um dia só com `ads_read`; há 1 token órfão anterior do mesmo user (60d, ninguém possui — inerte, morre sozinho ou some com "Anular tokens" antes de regenerar).

### 🛑 REGRA DE DEPLOY (incidente 02/07/2026 — NUNCA REPETIR)

Em 02/07 a produção regrediu para o app de **março** (tela antiga + login morto):
o repo estava no `main` desatualizado (snapshot de 24/03) quando um `vite build`
+ deploy rodou de madrugada. Correções permanentes:

1. **Deploy SÓ via `client/deploy.sh`** — nunca `netlify deploy` direto. O script
   tem trava que aborta se o `src/` for a versão antiga (AuthContext sem Supabase),
   se as funções do chat sumirem ou se `portal.html` estiver sem a aba Conversas.
2. **`main` é o branch canônico e DEVE conter o estado de produção** (sincronizado
   em 02/07/2026). Antes de qualquer build: `git branch --show-current` e
   `git log -1` — se o código não bater com este changelog, PARE.
3. **`client/portal.html` (raiz) é o canônico do Portal do Cliente** — entry do
   Vite. O `public/portal.html` NÃO é usado pelo build (ver CHAT-PORTAL.md).
4. Funções que existem só como artefato recuperado ficam documentadas em
   `client/netlify/functions/LEIA-ME-ARTEFATOS.md`; backups do incidente em
   `backups/20260702_*`.

### Disparo de links de assinatura via WhatsApp/Kommo (02/07/2026) — EM PRODUÇÃO, flag ATIVA

**Deployado 02/07 em 2 deploys** (2º = fix da checagem de janela; rollback: `./rollback.sh 6a4690444f7bdbfc18c581d5` volta ao pré-feature). **Validado em produção** (caminho fora_janela, contrato de teste `dbc097af`, lead PC 5663434): function+lock+nota no lead+log Monitor+faixa M2 na UI, tudo conferido ao vivo. ⚠️ **Fix crítico descoberto no teste**: eventos `incoming_chat_message` NÃO retornam filtrando por lead — só por **CONTATO** (`mainContactOfLead` → `filter[entity]=contact`); a janela da Meta é por conversa/contato mesmo.

Automação aprovada pelo Paulo (reverte a parte "operador envia manualmente" da REGRA #11; via Kommo o vendedor VÊ a mensagem na conversa do lead). Spec/plano em `docs/superpowers/{specs,plans}/2026-07-02-assinatura-whatsapp-kommo*`. Backup: `backups/20260702_132531_assinatura_whatsapp/`.

- **Fluxo**: enviado ao ZapSign → App chama `kommo-assinatura-send` (fire-and-forget) → function checa a **janela de 24h da Meta** (events API do Kommo, margem 60min) → dentro: grava a mensagem no campo do lead **"CBC Assinatura"** (auto-provisionado, textarea) e roda o Salesbot via job `assinatura_send` da fila (mesma op composta da cobrança); fora: **NÃO envia e NÃO re-tenta** (decisão Paulo) — posta nota `CBC.assinatura.manual:<id>` no lead e a **faixa M2** (âmbar) no detalhe do contrato orienta o envio manual (ações: Abrir conversa/Copiar link; SEM "tentar de novo").
- **Regras**: 2 contratantes no MESMO lead = UMA mensagem com os 2 links (nunca duplicada); leads distintos = 1 mensagem personalizada cada; **1 disparo por contrato** (lock atômico `contratos.kommo_assinatura IS NULL` — coluna nova jsonb, migração `assinatura_whatsapp`).
- **Config/kill-switch**: `bot_config.kommo.assinatura` — `ativo:false` (DESLIGADO), copy `msg_1`/`msg_2` editável sem redeploy, `janela_margem_min`. **Setup Kommo FEITO em 02/07 via navegador**: campo **"CBC Assinatura" = field_id 2441560** (textarea, criado via API de sessão) e Salesbot **"CBC - Link Assinatura" = bot_id 98654** (1 bloco `{{lead.cf.2441560}}`, criado na UI, SEM gatilho de etapa — só roda via `bots/run`); ambos já gravados na config. ⚠️ `GET /api/v4/bots` retornou VAZIO via sessão — o lookup por nome da function pode não funcionar; irrelevante enquanto o `bot_id` estiver na config. Config incompleta NÃO consome o disparo único.
- **UI**: faixa M2 + selos `WA ✓`/`WA manual` por signatário (ContratosTab, detalhe; tokens `--cbc-*`, dark ok). Mockups das 5 opções: `prototipos/assinatura-whatsapp-aviso/` (M2 escolhido). Lógica pura testada: `utils/__tests__/assinaturaWhatsapp.test.js` (23 testes).
- **PENDENTE p/ ativar (Paulo)**: ligar `ativo:true` na config → teste real com lead próprio (⚠️ validar o formato do endpoint `/events` no 1º teste; conferir no console do Monitor, origem `kommo`) → deploy via `deploy.sh`. (Salesbot e campo JÁ criados em 02/07.)

### BI de produtividade de tarefas p/ Power BI (02/07/2026) — EM PRODUÇÃO

Pedido do Paulo: medir produtividade e tempo de conclusão de tarefas do ADVBOX no Power BI (a conexão já existia: `docs/POWERBI_CONEXAO.md`, usuário read-only `powerbi_cbc`). Deploy 02/07, 198 testes ok (rollback: `./rollback.sh 6a469a3a1d375a1f54e1ec10`). Backup: `backups/20260702_154947_powerbi_produtividade/`. Migração `powerbi_produtividade` (arquivo `supabase_powerbi_produtividade.sql`).

- ⚠️ **Semântica descoberta**: `vw_bi_tarefas.data_criacao` = data **AGENDADA** da tarefa (campo `date` do `/posts`), NÃO a criação — `data_conclusao − data_criacao` mede **pontualidade** (medianas 0/negativas são normais). `prazo` (deadline) só existe em 420/23k tarefas.
- **monitor + backfill** agora gravam `payload.created_at` (criação real no ADVBOX) e `payload.reward` (pontos de gamificação) nos eventos `task_created` **e** `task_completed` (tarefa criada+concluída entre duas rodadas do monitor nunca gera `task_created`).
- **botDb**: novo `bulkUpsertSyncItems` (`ignoreDuplicates:false`) — a fase "tarefas" do backfill **ATUALIZA duplicatas** (enriquece payload antigo); andamentos seguem insert-only e o monitor segue com `bulkRecordReturning` (só-novos, para não duplicar nota Kommo). `tarefas_gravadas` do painel passou a contar novos+atualizados.
- **Views**: `vw_bi_tarefas` +`data_criacao_real`/`tempo_ciclo_dias`/`reward` (append no fim); **`vw_bi_produtividade`** NOVA (1 linha por pessoa×tarefa concluída; `categoria` ciclo/instantanea/sistema — instantânea = COMENTÁRIO/PUBLICAÇÃO TRATADA/VERIFICAR INTERNO); **`vw_bi_funil_etapas`** NOVA (permanência por etapa, LEAD sobre `bi_processos_log`, períodos observados desde 10/06). Tudo `security_invoker=true` + grant `powerbi_cbc`.
- **Backfill re-rodado só na fase "tarefas"** (estado setado via SQL pulando a fase andamentos, ~40 min) para repovoar o histórico com created_at/reward. **CONCLUÍDO 02/07 19h10 UTC: 22.018/22.028 concluídas com created_at (99,95%)**.
- **Fase 2 (mesmo dia)** — migração `powerbi_painel_fase2` (arquivo `supabase_powerbi_painel_fase2.sql`): tabela **`bi_equipes`** (pessoa→equipe, 24 seed 'operacional', Paulo classifica vendas), `vw_bi_produtividade` +coluna `equipe`, **`vw_bi_carga_atual`** (abertas com 1 linha/pessoa via regexp_split, aging, equipe), **`vw_bi_distribuicao`** (criado_em→process_date; **validado: `process_date` = data de distribuição**, mediana de diferença 0 vs tarefa DISTRIBUIR AÇÃO; flag `cadastro_retroativo` p/ importados antigos; mediana 12m = 23 dias) e **`vw_bi_tarefas_pre_distribuicao`** (esteira até distribuir). Semântica: ⚠️ tarefa "NF - REFAZER PREST CONTAS" NÃO existe no ADVBOX (o próximo é CORRIGIR PRESTAÇÃO DE CONTAS); `%DISTRIBUIR%` genérico mistura DISTRIBUIR CUMPRIMENTO e infla a régua (usar DISTRIBUIR AÇÃO). **Tutorial de iniciante p/ montar o painel: `docs/POWERBI_PAINEL_TUTORIAL.md`** (6 páginas, medidas DAX prontas; também publicado como Artifact).
- **Fase 3 (mesmo dia, decisões do Paulo)** — migração `powerbi_esteira_retrabalho` (arquivo `supabase_powerbi_esteira_retrabalho.sql`): coluna **`retrabalho`** na produtividade (= REFAZER* + **CORRIGIR PRESTAÇÃO DE CONTAS**, definição confirmada; 344 all-time), **`situacao_agenda`** na carga (vencida/para hoje/próximos 7 dias/mais adiante — visão da coordenadora; em 02/07: 832 vencidas/82 hoje/439 próx.7d), `vw_bi_tarefas_pre_distribuicao` **recriada** (drop+create; base = `vw_bi_distribuicao`) com `dias_desde_criacao`+`cadastro_retroativo` = **esteira completa**. **Achado**: gargalo da distribuição NÃO é execução (ciclos 0–2 dias) e sim a **espera até a 1ª tarefa** (~dia 22 de vida do processo; mediana distribuição 12m = 23 dias); caudas = DOCUMENTAÇÃO FALTANDO (dia 33,5), ACOMPANHAR PAGAMENTO (dia 39), REFAZER INICIAL (dia 43). Régua principal = `process_date` (decisão Paulo). **Cadência do monitor MANTIDA 2×/dia** (Paulo: "não necessário nesse momento"; teto útil se mudar = 8 refresh/dia no Power BI ⇒ espelho de hora em hora + 8 slots, exige deploy pequeno). **Falta Paulo**: ditar quem é de vendas na `bi_equipes` (24 seed 'operacional'; PUBLIS CBC/SUPORTE ADVBOX são usuários de sistema).
- **Arquivo PRONTO do painel (PBIP)** — a pedido do Paulo ("só abrir no Power BI"): projeto gerado por script em **`powerbi/CBC-Painel/`** (+ **`powerbi/CBC-Painel-PowerBI-v4.zip`** p/ levar ao Windows; gerador versionado em `powerbi/gerar_pbip.py`). **v3 = formato CLÁSSICO** (SemanticModel `model.bim` TMSL + Report `report.json` legado com config stringificado) — a v1 em TMDL/PBIR falhou no Desktop do Paulo ("Missing required artifact 'model.bim'", formato novo exige preview) e a v2 caiu em colisão de nome (⚠️ lição: **medida NÃO pode ter o mesmo nome de coluna da MESMA tabela**, case-insensitive — 'Retrabalho' virou 'Qtde Retrabalho'); v3 falhou em 'Erro ao renderizar o relatório' → v4 adiciona o ESQUELETO dos .pbix reais no report.json (id numérico no root/seções/visuais, tabOrder, resourcePackages+tema base CY24SU06). v1-v3 arquivadas em `backups/20260702_163104_*`. No 1º refresh real: pooler pool_size 15 estourou (fix = desmarcar "carregamento paralelo de tabelas" no Desktop, viaja no arquivo) e `42501 permission denied for table contratos` (fix = migração `powerbi_fix_vw_contratos`: `vw_powerbi_contratos` → security_invoker=false — powerbi_cbc não lê a base sensível, só a view). Pre-flight validado 02/07 com SET ROLE powerbi_cbc: as 10 views legíveis, nenhuma vazia (Contratos=201).
- **Carga Atual reconciliada (02/07 à noite, decisões Paulo; deploy `6a46b3a2f63682b4388075f6`, 198 testes ok)** — "vencidas" estava inflado (829 atrib./722 tarefas) por 3 causas do ESPELHO: remarcação no ADVBOX não atualizava a data aqui; tarefa EXCLUÍDA nunca fecha (sem evento); responsável duplo conta 2×. Fixes: (1) monitor agora **re-upserta slim** (sem communicated/communicated_at — senão novidades antigas reaparecem) as abertas conhecidas → remarcações valem; (2) **`bot_tarefas_abertas_snapshot`** (tabela nova) = retrato dos IDs abertos AGORA, gravado por rodada (upsert+delete por timestamp, nunca vazio; pula se paginação truncar em MAX_PAGES) e `vw_bi_carga_atual` INNER JOIN nele; (3) **COMENTÁRIO fora da carga** e categoria 'sistema' na produtividade (some das contagens do painel — [Concluídas] exclui 'sistema' — sem apagar do BI); (4) **vencida = 1+ dia ÚTIL completo** de atraso (novo valor 'carencia (1 dia util)'; coluna `dias_uteis_atraso` append; sáb/dom fora, feriados não considerados). Migração `powerbi_carga_reconciliacao` (seed do retrato = espelho até a 1ª rodada). Conteúdo: 11 tabelas (10 views + Calendario calculada), 21 medidas com filtros de negócio embutidos (sem filtros de página), 3 relacionamentos, 6 páginas/39 visuais. Credenciais NÃO vão no arquivo (Paulo digita 1×; senha na memória `powerbi-credencial-bi`). Convenção: [Concluídas] exclui categoria 'sistema'; medidas de tempo só categoria 'ciclo'; medidas de Distribuicao/PreDistribuicao excluem cadastro_retroativo. Se falhar ao abrir: pedir print e corrigir o JSON (é texto). **v5** (02/07 noite): +medida [Tarefas Vencidas] (DISTINCTCOUNT, únicas) no cartão 4 da P1 (pedido Paulo: atrasadas no lugar de abertas; troca manual de 30s no arquivo já configurado — não precisa re-baixar). **Fuso BRT** na carga (migração `powerbi_carga_fuso_brt` — current_date UTC pulava de dia às 21h BRT). **Guia de leitura do painel (p/ usuário)**: `docs/POWERBI_GUIA_PAINEL.md` + Artifact próprio. Compartilhar grátis = Salvar Como **.pbix** (dados embutidos, abre sem senha; refresh pede senha); credenciais nunca são embutíveis no arquivo (design do Power BI). **Conta p/ publicar**: Power BI nuvem recusa e-mail pessoal — criar conta grátis com e-mail do domínio @advocaciacbc.com (código chega no Gmail); seção 8.0 do tutorial. **Guia de instalação em PC novo (DEFINITIVO, tabela erro→solução de tudo)**: `docs/POWERBI_INSTALACAO_NOVO_PC.md` + Artifact 🔧. Trilogia de docs: TUTORIAL (montar) · GUIA_PAINEL (ler) · INSTALACAO_NOVO_PC (instalar).

### Auditoria de bugs + melhorias (25/06/2026) — EM PRODUÇÃO

Sessão de auditoria multi-agente (50 bugs achados, **48 corrigidos** em 3 deploys) + leva de melhorias + nova aba. Backups: `backups/20260625_*`. Rollbacks: `./rollback.sh 6a3d4c1f0f77326b570f409f` (e anteriores nos backups).

- **Bug do "Revisão de Distrato"**: tipo de ação que ia ao ADVBOX como **OUTROS** (2187483) porque faltava no formulário e no mapa. Corrigido — agora é opção do dropdown (`TIPOS_ACAO`) e mapeia para o ID real **REVISÃO DE DISTRATO = 2392340** (grupo MULTIPROPRIEDADE). Os 9 IDs antigos do mapa foram conferidos contra o catálogo `/settings` ao vivo (todos certos). Lawsuit `16064935` corrigido via `PUT /lawsuits/{id}` (merge parcial). `15050313` deixado como AÇÃO DE COBRANÇA de propósito (são tipos distintos).
- **`USER_MAP` (advbox-sync.mjs)**: `grazie@` apontava p/ 242675 (ISABELA); corrigido p/ **242673** (Grazie real).
- **FONTE ÚNICA dos mapas ADVBOX**: `getOrigemId`/`getTipoAcaoId` + os mapas saíram p/ **`netlify/functions/_lib/advboxMaps.mjs`** (módulo PURO, testado em `utils/__tests__/advboxMaps.test.js`). O antigo **`client/src/utils/advboxService.js` foi REMOVIDO** (era código morto, só o teste usava) — junto saiu o **`VITE_ADVBOX_TOKEN` do bundle do frontend**. (A divergência entre as 2 cópias causou o bug do Edmar.)
- **#23 NF duplicada (race) RESOLVIDO**: migração `asaas_nf_lock` — coluna `asaas_boletos.nf_lock_at` + RPCs `asaas_nf_claim`/`asaas_nf_release` (SECURITY DEFINER, `BOT_RPC_SECRET`, auto-recupera trava órfã >10min). `asaas-webhook` reivindica a trava antes do POST `/invoices` e libera se falhar (best-effort — degrada ao check de invoice). Helpers em `_lib/asaasMirror.mjs`.
- **Nota Kommo #18 "abriu e não assinou" → SERVIDOR**: nova function agendada **`kommo-view-check.mjs`** (cron `*/30`) substitui o polling no navegador (App.jsx). Agora roda 24h sem o app aberto. Idempotente via `kommo_view_noted`.
- **`vw_powerbi_contratos`** (view nova, aditiva): Power BI pode ler os contratos direto do banco (com campos calculados: jornada, tempo até assinatura, mês/ano, tipo de honorário) em vez da function `api-powerbi`. A function segue existindo até o Power BI ser reapontado.
- **NOVA ABA "Saúde do Funil"** (`components/FunnelHealthPanel.jsx` + `funnel/funnelCompute.js`): visível **só p/ Paulo e Bruno** (gating por email = `SOCIOS_EMAILS`, igual à aba Sócios; tab key `funil`). Mostra o funil Criados→Enviados→Assinados, conversões, **tempos medianos** por etapa, gargalos (enviados há >7 dias sem assinar) e tendência mensal. Lógica pura testada (`utils/__tests__/funnelCompute.test.js`). Token-driven (`--cbc-*`, dark-mode safe).
- **Outros fixes notáveis**: `validateCPF` agora valida **checksum** (não só formato); Dashboard busca por `created_at` OU `signed_at`/`advbox_date` (não subconta assinaturas do mês); detecção de login anômalo religada (era código morto); `is_admin` sempre mantém a aba Admin (anti-lockout); DOCX baixado tinha cláusulas 1/2 faltando + título/razão-social errados (corrigidos); `detectGender` melhorado; `birthday`→`birthdate` no ADVBOX. Lista completa nas memórias da sessão (`auditoria-bugs-25-06`).

**AINDA ABERTO (exigem Paulo / coordenação):**
- **RLS allow-all em `user_permissions`** — descoberto que a tabela é **COMPARTILHADA com o app `produtividade`** (tem policies `produtividade.has_permission`). Fechar a RLS exige coordenação cross-app (risco de quebrar o outro sistema). NÃO mexido. Só foi feito o anti-lockout (L19).
- **`SUPABASE_SERVICE_ROLE_KEY`** ainda não configurada (pendência antiga). **Rotacionar** `VITE_ADVBOX_TOKEN`/`VITE_CPF_API_TOKEN` (ADVBOX já saiu do bundle, mas o token antigo segue válido até rotacionar) e `KOMMO_TOKEN`. **Configurar** `ZAPSIGN_WEBHOOK_SECRET` (hoje o webhook é fail-open, mitigado por re-verificação na API).

### Mobile 2.0 + comparador de meses (v6.6.0) — 12-13/06/2026 — EM PRODUÇÃO

Redesign mobile completo (iPhone + iPad Air M3) com regra de ouro: **desktop intocado** (tudo atrás de `max-sm:`/media queries/`pointer:coarse`/`isMobile`). Deployado 12/06 (mobile) + 13/06 (fix do pdfGenerator). Rollback do último: `./rollback.sh 6a2cbde0ad7cb2530d3310a7`. Backups: `backups/20260612_161431_mobile_redesign/` (src completo pré-mudança) + backups por área dos agentes (20260612_2011xx-2013xx).

- **Navegação**: dock ganhou 4º item **"Mais"** → `components/MobileNavSheet.jsx` (sheet com TODAS as abas permitidas via `tabAllowed`, mesma regra das top tabs). Lupa de busca no header quando `pointer:coarse`. Header phone enxuto (densidade/versão/atalhos só desktop). FAB oculto quando dock visível.
- **Estrutura**: `.dock-spacer` global no App devolve a altura do dock ao layout (token `--bottom-dock-height` enfim consumido — nada mais termina sob o dock); dock z-60→**45** (abaixo dos modais z-50); `h-screen`→`100dvh` só ≤1366px; iPad portrait usa o branch mobile da aba novo (segmented control, FormPanel fica montado ao alternar preview).
- **index.css** seção "MOBILE REDESIGN (12/06/2026)": anti-zoom corrigido p/ inputs sem `type`; touch targets 44px em `pointer:coarse` 641-1366; hover-reveal visível em `hover:none`; piso tipográfico phone (7-9px→9-10px); `.cbc-toast-stack`/`.cbc-undo-toast`/`.toast-above-dock`; `.cbc-navsheet*`; `.cbc-toptabs` (88px ≤1366 — 11 abas cabem no iPad 13" landscape); `.cbc-step-label` (timeline só bolinhas no phone); `.cbc-touch-only`/`.cbc-touch-reorder`; `.cbc-sticky-col` (dias do heatmap).
- **Touch substituindo drag/hover**: cláusulas com ↑/↓ (FormPanel), kanban Vendas com botão "Mover" (cbc-touch-only → handleMoveColuna), preview do contrato em touch = **HTML rolável (iframe srcDoc) com zoom** em vez de PDF (Safari iOS só renderiza a 1ª página; e não gera mais PDF a cada tecla no celular). inputMode/autoComplete nos campos mascarados + login.
- **Fix real**: pull-to-refresh do ContratosTab disparava com qualquer arrasto (media o container errado) — corrigido.
- **Retrofits por área** (5 agentes, gating estrito; detalhes no resultado do workflow): Asaas pan horizontal alinhado, BoletoRow 2 linhas, modais com `max-h-[85dvh]` e larguras `w-full max-w-*`, NotificationCenter/ActivityFeed viram bottom-sheet no phone, matriz do Admin com scroll-x, ClientFormQR (formulário público!) com teclados/autofill corretos.
- **Dashboard (pedido do Paulo)**: `MonthComparator` (widgets.jsx) — mês A × mês B com criados/assinaturas/receita/ticket/conversão de cohort e deltas; **KPIs sensíveis ao período**: com filtro ativo, assinaturas/receita/ticket/cancelados/top resort refletem a JANELA selecionada (data efetiva de assinatura) com delta vs janela anterior equivalente (`compute.js`: `janela`/`janelaAnterior`/`comparador`); sem filtro, comportamento anterior (mês corrente). Celebração de meta segue o mês corrente real (`assinadosMes`).
- **Validação**: harness 133 asserções vs produção (10+3 cenários, incluindo janela de período e integridade do comparador); E2E em 375×812 (dock/Mais/Boletos/dashboard/preview/busca), iPad 1024×1366 (dock+segmented) e 1366×1024 (top tabs sem overflow); regressão desktop 1440 por fingerprint de 11 abas vs baseline pré-mudança (boletos/bot/portal/admin/param byte-idênticos; deltas restantes = dados ao vivo ou intencionais) + review adversarial de diff em 3 lentes.
- ~~**Achado colateral** (pré-existente, chip de task criado): `pdfGenerator.js` vaza um div oculto (~8KB) no body a cada geração de preview de PDF.~~ **RESOLVIDO 13/06/2026 (deploy `6a2cd5ddd79a628d1148ceec`, rollback `./rollback.sh 6a2cbde0ad7cb2530d3310a7`)**: o `container` próprio do `generatePdfFromHtml` já era removido em `finally`; o vazamento real era o `<iframe class="html2canvas-container">` do html2canvas 1.4.1, que só é removido no caminho de SUCESSO (sem try/finally) — fica órfão quando a renderização lança. Fix: `container.remove()` idempotente + contador `_activeGenerations` que varre os iframes órfãos só quando não há geração em andamento (seguro com gerações concorrentes do LivePreview: debounce 700ms + troca de aba). Backup: `backups/20260613_005349_pdfgen_leak_fix/`. Validado com o módulo real (happy path + varredura de órfão + concorrência), build + lint limpos.
- Limitação conhecida: `useDeviceType` atualiza via rAF — em testes headless o resize não re-tiera (em device real funciona; rotação dispara com página visível).

### Dashboard 2.0 (v6.5.0) — 12/06/2026 — EM PRODUÇÃO

Redesign completo do Dashboard (deploy 12/06, rollback: `./rollback.sh 6a2b5a490d54f1f3ddaa6ea7`). Backup dos arquivos antigos em `backups/20260612_152405_dashboard_redesign/`.

- **Arquitetura**: `Dashboard.jsx` (orquestração) + `dashboard/compute.js` (lógica pura, testável) + `dashboard/widgets.jsx` (visual com tokens `--cbc-*`) + `dashboard/format.js` (formatadores). A MV `dashboard_stats` **não alimenta mais a tela** (segue no banco p/ api-powerbi etc.) — fonte única: linhas slim de `contratos` + realtime.
- **Regras de dados**: arquivados fora de tudo por padrão (toggle "incluir arquivados"); data de assinatura efetiva = `signed_at → advbox_date → updated_at` (31 assinados antigos não têm signed_at); funil cumulativo (criados ⊇ enviados ⊇ assinados); métricas "do mês" = mês corrente sempre, rotuladas; pendências operacionais ignoram filtros.
- **Bugs corrigidos**: números divergentes na mesma tela (MV sem arquivados × cálculo local com), KPIs Pendente ADVBOX/Drive contavam TODOS os assinados (colunas faltavam no select), anomalias mortas (liam campos inexistentes), jornada inflada por `updated_at`, "mediana" que era média ponderada de médias, top do mês por created_at, opções de filtro que encolhiam ao filtrar, dark mode quebrado (hex inline), GeoHeatmap baixava `dados` JSONB inteiro (agora só `dados->contratantes`).
- **KPIs**: `useKpiPreferences` ganhou `assinados_mes` e `pipeline_aberto`; removidos `pendente_boletos`/`leads_ativos` (mortos desde a remoção da aba Leads). Export Excel respeita filtros ativos e ganhou colunas "Assinado em"/"Arquivado em".
- **Tokens novos** em `index.css`: `--cbc-success/danger/warning/info` com override mais claro no dark mode (`:root.dark`).
- **Validação 12/06**: harness Node com 108 asserções vs produção (10 cenários de filtro) + E2E logado local (dev e bundle minificado), light/dark, desktop/mobile, drill-downs, 0 erros de console. Usuário de teste temporário criado e removido do Supabase Auth.
- O **"wizard de 7 passos"** descrito mais abaixo **não existe mais**. O formulário de criação (`FormPanel.jsx`, ~1750 linhas) hoje é um **formulário de seções numa página só**, com indicadores de progresso (bolinhas verde/vermelho) por seção.
- **`components/Stepper.jsx` é CÓDIGO MORTO** — não é importado em lugar nenhum. Candidato a remoção (não usar como referência do wizard).
- Sempre que este guia descrever telas/fluxo, **valide no app real** (ou via extensão Claude-in-Chrome logado) antes de implementar — a documentação atrás está atrasada.

### Integração Kommo (CRM) — 02/06/2026

O Kommo (`advocaciacbc.kommo.com`, API v4) deixou de ser só um link manual e passou a ter **integração de API real**. Tudo abaixo está **em produção e validado**.

**Config / credenciais**
- Env var **`KOMMO_TOKEN`** (long-lived token) configurada no Netlify (contexto `all`). Auth: `Authorization: Bearer`. Base: `https://advocaciacbc.kommo.com/api/v4`.
- IDs fixos (cravados como constantes): funil **"Venda"** `pipeline_id = 13760367`; etapa **"ADVBOX"** `status_id = 106388919`.
- ⚠️ **PENDÊNCIA DE SEGURANÇA**: o token foi exposto em chat em 02/06 — **rotacionar no Kommo e re-setar a env var** (`netlify env:set KOMMO_TOKEN ... --site d7b38821-...`). Não exige novo deploy.

**Mover lead ao assinar** (`netlify/functions/advbox-sync.mjs`)
- Depois de criar cliente + processo no ADVBOX, faz `PATCH /leads/{id}` movendo o lead para a etapa **ADVBOX/Venda**. Helpers `extrairLeadIdKommo()` + `moverLeadKommo()`.
- Idempotente (PATCH para a mesma etapa é no-op). Falha **não derruba** o ADVBOX (vira `warning`); retry via botão "retry ADVBOX" no Monitor.
- Lead extraído de `dados.contratantes[].linkKommo` (formato `.../leads/detail/{id}`).

**Bolinha "Kommo" na timeline de automações** (`components/ContratosTab.jsx`)
- 7º passo em `PROGRESS_STEPS` (`FunnelIcon`), acende quando `advbox_data.kommo.moved` tem itens. `getCompletedSteps` lê `contract.kommo_j?.moved || contract.advbox_data?.kommo?.moved`.
- Select da lista usa o alias leve **`kommo_j:advbox_data->kommo`** (não puxa `advbox_data` inteiro).
- **Backfill 02/06**: 12 contratos retroativos cujo lead já estava na etapa ADVBOX foram marcados via `advbox_data.kommo` com `source:'backfill'` (UPDATE manual).

**Função `kommo-note.mjs` (nova) — notas idempotentes**
- Posta nota (`note_type=common`) num lead **sem duplicar**: antes de postar faz `GET /leads/{id}/notes` e procura o `marker`. Body: `{ leadId | linkKommo, marker, text }`.
- ⚠️ A API v4 do Kommo **não permite apagar nota** (DELETE→405). Há notas de teste no lead `5663306` (marcadas "ignorar").
- Notas automáticas em produção (cada uma com seu marcador):
  - **#14 `CBC.resumo`** — resumo do negócio (resort, ação, honorários, custas, contratante, Drive) ao assinar. Gancho: `advbox-sync.mjs`.
  - **#16 `CBC.processo`** — número do processo + distribuição, **assim que o ADVBOX traz o `process_number`** (mais rápido que o DataJud). Gancho: `datajud-refresh.mjs`.
  - **#18 `CBC.abriu`** — "abriu o contrato e não assinou" (usa `times_viewed` do ZapSign). Gancho: polling do `App.jsx`. ⚠️ roda **no navegador** (só com o app aberto). Idempotência: coluna `kommo_view_noted`.
  - **#1 `CBC.fase:<fase>`** — mudança de fase (`stage/step`) do processo no ADVBOX. Gancho: `datajud-refresh.mjs`. Idempotência/anti-flood: coluna `advbox_fase_notificada` com **seed silencioso** (1ª leitura só registra a fase, não posta; nota só em mudanças).
- Callers server-side (`advbox-sync`, `datajud-refresh`) chamam via `${process.env.URL}/.netlify/functions/kommo-note`; o frontend chama o caminho relativo.

**Colunas novas em `contratos`** (migrations 02/06)
- `kommo_view_noted boolean` (idempotência #18) · `advbox_fase_notificada text` (estado da fase #1).

**Pendente**: migrar #18 para um gatilho server-side (webhook ZapSign) se quiser que funcione 24/7 sem app aberto. Demais ideias de integração Kommo↔sistema↔ADVBOX levantadas mas não implementadas (dezenas) — pedir a Paulo se quiser retomar.

### Bot ADVBOX (autoatendimento Kommo×ADVBOX) — 09-10/06/2026 — VERSÃO DE TESTE **EM PRODUÇÃO**

**Deploy feito em 10/06** (rollback: `./rollback.sh 6a2085d97131157b388bb672`). Automatizado via API: env `BOT_PANEL_KEY`/`VITE_BOT_PANEL_KEY` (chave forte no Netlify), campo Kommo `BOT_RESPOSTA` no lead (**field_id 2433130**), webhook `add_message` → `kommo-advbox-webhook`, field_id salvo em `bot_config.kommo`, 1ª rodada do monitor OK (26 notas postadas). **Falta (manual)**: criar Salesbot de 1 bloco exibindo `{{lead.cf.2433130}}` (POST /api/v4/bots = 405, não dá via API), colocar o bot_id no painel Config e marcar "ativo"; cadastrar testadores; opcional `ANTHROPIC_API_KEY`.

Módulo novo completo (aba "Bot ADVBOX", permissão via `user_permissions.tabs.bot`). Guia completo: **`docs/BOT_ADVBOX_SETUP.md`**.

- **Painel** `components/BotAdvboxPanel.jsx` + `components/bot/*` (8 abas: Simulador, Novidades, Etapas, Tarefas, Glossário, Intenções, Testadores, Config).
- **Functions**: `advbox-bot-reply` (API painel/widget), `kommo-advbox-webhook` (+`advbox-bot-worker-background`), `advbox-monitor` (cron 12h/21h UTC, +`advbox-monitor-worker-background`). Libs compartilhadas em `netlify/functions/_lib/` (advbox, kommo, botDb, botEngine).
- **Banco**: `supabase_bot_advbox.sql` — tabelas `bot_*` **JÁ APLICADAS** no Supabase (migration `bot_advbox_v1`) com seeds (43 termos de glossário, 6 intenções, configs).
- **Segurança do teste**: no WhatsApp o worker só responde a telefones em `bot_testers`. Envio proativo = grava campo custom + `POST /api/v4/bots/run` (Salesbot exibe `{{lead.cf.#id#}}`).
- **Pendências para ativar**: deploy (não feito — aguardando OK do Paulo), env `BOT_PANEL_KEY`/`VITE_BOT_PANEL_KEY` (default fraco `cbc-bot-2026`), config Kommo (campo BOT_RESPOSTA + Salesbot + webhook add_message), opcional `ANTHROPIC_API_KEY` p/ tradutor IA. Widget `kommo-widget/` é beta (zip manual).
- **Validado por testes reais (09/06)**: settings (149 stages/216 tasks), busca por nome/CPF/CNJ, andamento com timeline traduzida, multi-processo com seleção numerada, escalonamento, comandos `#processo`/`#cliente`/`#reset`.
- **10/06 — Central ADVBOX no Monitor (`MonitorAdvbox.jsx`)**: 1ª seção da aba Monitor — painel navy escuro com farol geral, grid das 5 integrações (Sincronização/Cadastros BI/Backfill/Catálogo/Bot WhatsApp, status por idade da última execução), botão "Testar API agora" (action `advbox_health` no advbox-bot-reply, ping cronometrado) e **console de eventos persistente**: tabela `advbox_api_log` (origem/nivel/mensagem/contexto/visto) alimentada por TODOS os workers via `logAdvbox()` (botDb) — erros expandem mostrando contexto JSON, com "marcar como visto" e filtros por nível/origem. MonitorPanel.jsx tocado minimamente (import + 1 seção; os 12 lint errors dele são pré-existentes).
- **10/06 — otimização Supabase (com rollback)**: aplicado — 6 views vw_bi_* com `security_invoker=true` (zera os ERRORs do advisor), 3 índices de FK criados, 1 search_path fixado, 11 policies auth.*() com initplan cacheado, 8 policies redundantes removidas/consolidadas, **187 índices nunca usados dropados** (estatísticas desde mar/26; bot_*/bi_* excluídos). Validado: baseline anon de 15 tabelas 100% idêntico antes/depois + bot ok. **Rollback**: `backups/20260610_130001_supabase_otimizacao/rollback_completo.sql` (tb na tabela `_rollback_otimizacao_20260610` do banco). NÃO aplicado (exige aprovação por sistema): consolidação OR das policies não-true restantes, MVs na API, bucket teses-assets, extensões em public, e o estrutural RLS allow-all (101 tabelas).
- **10/06 — espelho de cadastros p/ BI (`advbox-snapshot-worker-background`)**: disparado em sequência ao fim do monitor (6h30/17h30, nunca em paralelo — conjunto ≤15 req/min). Alimenta `bi_processos` (carteira, upsert) + `bi_processos_log` (diário de mudanças: etapa/quadro/responsável/fees_money/encerramentos → análise tempo-por-etapa), `bi_clientes`, `bi_financeiro`. Views p/ Power BI: `vw_bi_processos`, `vw_bi_funil`, `vw_bi_clientes`, `vw_bi_financeiro` (+ `vw_bi_andamentos`/`vw_bi_tarefas` já existentes). Status em `bot_config.snapshot_status`. Aniversários = derivar de `bi_clientes.nascimento` (sem GET extra). Agenda do monitor mudou p/ `30 9,20 * * 1-5` (6h30/17h30 BRT, seg–sex — janela de expediente); watchdog `*/30`. Backfill ganhou trava de instância única (body `{chain:true}` para hops; religadas manuais bloqueadas se checkpoint <3min).
- **10/06 — visibilidade por tarefa/etapa ("ocultar do cliente")**: a antiga lista de "tarefas ignoradas" virou sistema de VISIBILIDADE — **tudo entra no banco/BI**, mas itens ocultos não aparecem p/ cliente (bot/notas Kommo/novidades). Duas camadas: flag `ocultar_cliente` em `bot_task_templates` e `bot_stage_templates` (checkbox no painel, salvo na hora; etapa oculta = bot mostra "Em andamento com nossa equipe" no lugar do nome técnico) + termos automáticos em `bot_config.monitor.tarefas_ignoradas` (cobre tarefas de sistema fora do catálogo: COMENTÁRIO, ALERTA DE TAREFA EXCLUÍDA, VERIFICAR INTERNO). Helper central: `getVisibilityConfig`/`isHiddenFromClient` em botDb. Monitor grava ocultas com communicated=true + payload.oculto; backfill idem. `vw_bi_tarefas` ganhou coluna `oculta_do_cliente`. Seed: 3 tipos "PUBLICAÇÃO TRATADA *" flagados. Motivo: planilha PRODUTIVIDADE mostrou que comentários+publicações tratadas = ~25% da produção da equipe (precisam estar no BI).
- **10/06 — catálogo auto-sincronizado**: monitor sincroniza etapas/tarefas do `GET /settings` em `bot_config.catalogo` (diff de incluídas/excluídas guardado 30 dias; templates de itens excluídos são **desativados automaticamente** via `syncCatalog` em botDb). Painel `bot/BotPendencias.jsx` (topo da aba) mostra X/Y etapas e tarefas sem texto + novidades, com link p/ a sub-aba; Etapas/Tarefas ganharam filtro "só pendentes" e badges NOVA/ignorada. `advGet` agora tem retry de 429 (2x, espera 12s/24s).
- **10/06 — escala + backfill**: throttle global ADVBOX baixado para **15 req/min** (metade do limite, zero atrito com outras integrações); monitor **paginado** (volume real: ~5,3k tarefas concluídas/mês); lista de **tarefas ignoradas** em `bot_config.monitor.tarefas_ignoradas` (alerta de tarefa excluída, publicação tratada, comentário, verificar interno — vale p/ monitor, backfill e respostas do bot, editável na Config); **backfill** (`advbox-backfill-background`, lotes encadeados de 12 min com cursor em `bot_config.backfill_status`, fase andamentos→tarefas, itens como communicated=true sem nota Kommo) com **barra de progresso em tempo real** (`bot/BackfillBar.jsx`, poll 5s, pausar/retomar); Etapas agrupadas por quadro (Marketing→…→Arquivamento via campo `step`); Novidades com busca (processo/cliente) e ordenação por coluna. Supabase org está no **plano Pro** (8 GB; banco ~144 MB; backfill ≈ +150 MB — folga enorme).

### Otimizações aplicadas em 31/05/2026 (sessão de performance/escala)
Frontend (deployados e verificados em produção logado):
- **Dashboard**: select usa JSON-path (`dados->dataPrimeiraMensagem`, `dados->origemCliente`) em vez do JSONB `dados` inteiro.
- **ContratosTab**: idem — lista puxa `dados->contratantes` em vez de `dados` completo (reconstrói `{contratantes}` no map).
- **AuthContext / ContractContext**: `value` memoizado (`useMemo`).
- **BoletosPanel**: `ClientCard` em `React.memo` + handlers `useCallback`; sessionStorage não serializa mais arrays grandes (>3000 linhas).
- **ClientFormQR**: realtime + poll de fallback (60s).
- **App.jsx**: select enxuto de `user_permissions`; health-check pausa quando aba oculta.
- **keep-warm**: só aquece `health` e `zapsign-proxy`.

Banco (Supabase, via migration):
- Índices em FKs: `contrato_comentarios.user_id`, `notifications.user_id`.
- RLS `initplan`: `auth.*()` envolvido em `(select auth.*())` em `contratos_audit`, `notifications`, `contrato_comentarios`.
- **Gatilho `audit_contratos_trigger`**: passou a ignorar campos de sistema/automação (zapsign_links, advbox_*, drive_*, asaas_*, pdf_page_split) → ~95% menos linhas em `contratos_audit` (48MB→~3MB/mês). Continua auditando campos com valor jurídico.
- ~~**Policies temporárias `temp_anon_all_asaas_boletos` e `temp_anon_all_asaas_sync_state`**~~ **(SUPERADO — atualizado 16/06/2026):** o remendo de liberar o `anon` foi **descartado**. Essas policies **não existem mais** no banco. A gravação do espelho Asaas agora passa por **RPCs `SECURITY DEFINER`** (`asaas_mirror_upsert/_update/_state/_cache/_stale_open`, `asaas_customers_upsert`) protegidas pelo segredo **`BOT_RPC_SECRET`** (helper `_bot_chave_ok`) — ver `client/netlify/functions/_lib/asaasMirror.mjs`. As tabelas `asaas_boletos`/`asaas_sync_state` continuam **fechadas** para o `anon`. Não há `temp_anon_*` para remover. ⚠️ Garantir que `BOT_RPC_SECRET` siga configurada no Netlify (sem ela as RPCs lançam "acesso negado" e o sync congela).

Funções/infra:
- `reminder-cron`: `*/5` → `*/15`.
- `asaas-sync-boletos` (cron): agora grava erros no `asaas_error_log` (fim das falhas silenciosas).
- `asaas-webhook` já fazia sync incremental de boletos (destravado pelo fix de RLS acima).
- Novo: `.github/workflows/ci.yml` (build + lint no GitHub Actions). **Precisa de `git push` para ativar.**

Correções de negócio:
- **Inadimplência**: `DUNNING_RECEIVED` agora conta como **pago** (era contado como vencido, inflando o número). Sync completo de boletos refeito (estavam ~1 mês defasados por RLS).

### ⚠️ Pendências de SEGURANÇA (prioridade máxima — exigem Paulo)
1. **RLS aberta** em `contratos` e `user_permissions` (policy `Allow all`/`allow all` para role público/anon) → a chave anônima pública lê/escreve todos os contratos e a tabela de permissões. **Buraco grave.**
2. **`SUPABASE_SERVICE_ROLE_KEY` não configurada no Netlify** → funções gravam como anon. (O caso do Asaas já foi resolvido via RPC `SECURITY DEFINER` + `BOT_RPC_SECRET` — ver acima; mas configurar a service role segue sendo o caminho definitivo para as demais gravações server-side.)
3. Tokens ADVBOX/CPF-API ainda no bundle frontend (rotacionar + mover para proxies).

### Documento completo de melhorias
Ver **`docs/planejamento/SUGESTOES_MELHORIAS.md`** (movido da raiz em 06/07/2026 — auditoria #32; 356 sugestões em 12 dimensões). Obs: parte das sugestões de UX foi gerada a partir deste guia defasado e precisa ser re-validada contra o app real.

---

## 1. Visão Geral

### Objetivo do sistema
**CBC Contratos** é um sistema web interno do escritório CBC Advogados que evoluiu de um gerador de contratos para uma **plataforma end-to-end de aquisição → contrato → cobrança → acompanhamento processual → relacionamento com o cliente**. Ciclo completo automatizado:

1. Cadastro de cliente (com OCR de CNH/documentos)
2. Geração de contrato + procuração em HTML/PDF/DOCX
3. Envio para assinatura digital (ZapSign)
4. Arquivamento automático no Google Drive (PDF/DOCX separados)
5. Lançamento no CRM jurídico (ADVBOX) — cliente + processo + tarefas
6. Movimentação do lead + notas automáticas no CRM comercial (Kommo)
7. Emissão e régua de cobranças (Asaas — boletos + PIX + NF)
8. Monitoramento de distribuição e fases processuais (DataJud CNJ + ADVBOX)
9. Comissionamento de vendedores e BI da carteira (espelho ADVBOX → Power BI)
10. Portal do cliente + bot de autoatendimento WhatsApp (Kommo×ADVBOX)

### Público-alvo
- **Advogados/sócios** — criam contratos, gerenciam processos, KPIs no Dashboard, Dashboard Sócios (gated por email)
- **Secretárias/assistentes/vendedores** — preenchem formulários, acompanham assinaturas, aba "Minhas Vendas" (comissões, guias, requisitos)
- **Administradores** (is_admin=true) — Painel Admin (usuários, permissões, audit), Parametrização de Vendas
- **Clientes finais** — assinam via ZapSign, recebem cobrança Asaas, acessam o **Portal do Cliente** (acompanhamento) e conversam com o **bot WhatsApp**

### Status atual
- **Em produção ativa** — https://contratos-cbc.netlify.app
- Versão atual: **v6.6.0** (12-13/06/2026). Histórico recente no bloco "Estado atual" acima; changelog completo em `client/src/components/ChangeLog.jsx`.
- Conta Netlify: **Pro** ($20/mês, 1TB bandwidth), site `contratos-cbc` (ID `d7b38821-...`)
- Supabase: org no **plano Pro** (8 GB), projeto `vygczeepvoyaehfchxko` — **compartilhado** com vários apps do escritório (Teses, Calculadora, Penhora, Prestação de Contas, Auditoria de Audiências…); o CBC Contratos usa um subconjunto das tabelas (ver §8)
- Usuários ativos: advogados + secretárias + vendedores do escritório
- **12 abas** (RBAC por `user_permissions.tabs`): Novo, Contratos, Minhas Vendas, Dashboard, Sócios, Asaas, Boletos, Bot ADVBOX, Portal Cliente, Monitor, Admin, Param. Vendas

---

## 2. Stack Tecnológica

### Frontend (`client/`) — versões reais do `package.json`
- **React 19.2** + **Vite 8.0** (Rolldown) + **@vitejs/plugin-react 6** — SPA com roteamento em abas
- **Tailwind CSS 4.2** (`@tailwindcss/vite`) — design system com tokens `--cbc-*`
- **@supabase/supabase-js 2.100** — auth + DB + realtime
- **jsPDF 4.2 + html2canvas 1.4 + pdf-lib 1.17** — geração e split de PDF (preview touch usa HTML, não PDF)
- **docx 9.6** — contrato/procuração em Word
- **Tesseract.js 7.0** — OCR client-side (CNH/CPF/RG)
- **react-window 1.8** — virtualização (lista de boletos)
- **fuse.js 7.3** — fuzzy search (GlobalSearch)
- **canvas-confetti 1.9** — celebrações · **qrcode 1.5** — QR do Portal/ClientForm
- **web-push 3.6** — push notifications do Portal do Cliente
- **@sentry/react 10.47** — error tracking · **xlsx 0.18** — export Excel
- **@heroicons/react 2.2** — ícones (emojis substituídos)
- Dev: **eslint 9** (flat config) + plugins react-hooks/react-refresh, **vitest 3** (testes em `utils/__tests__`), **sharp** (otimização de imagem no build)
- ⚠️ **Leaflet/react-leaflet e file-saver foram REMOVIDOS** (tree-shaking 04/2026) — GeoHeatmap hoje é lista/barras, não mapa Leaflet.

### Backend (`server/`) — ⚠️ APOSENTADO (20/06/2026)
- **`server/` foi removido do repo** (movido para `backups/20260620_152530_server_render_aposentado/`). Rodava Express + node-cron (backup diário 03:00 BRT) + Puppeteer/OCR + `@aws-sdk/client-s3` (backup redundante em S3).
- ⚠️ **Consequência: NÃO há mais backup automático do banco** (o cron de backup vivia aqui). Ver pendência crítica de backup (auditoria #87) — precisa ser recriado como Netlify Scheduled Function ou via backup gerenciado do Supabase Pro.
- Referências a `server/` mais abaixo neste guia estão desatualizadas — o app hoje é 100% `client/` (SPA + Netlify Functions).

### Serverless (`client/netlify/functions/`)
- **62 Netlify Functions** em `.mjs` (Node 22) + **11 libs compartilhadas** em `_lib/` (advbox, kommo, botDb, botEngine, asaasMirror, cobranca, kommoQueue, googleAgenda, advboxMaps, nfseAmericana, assinaturaWhatsapp)
- **2 Edge Functions** (`edge-functions/health.ts`, `zapsign-proxy.ts`) — frontend chama `/api/*` com fallback p/ `/.netlify/functions/*` (`utils/apiEndpoints.js`)
- Famílias: `advbox-*` (sync/bot/monitor/backfill/snapshot/vendas), `asaas-*` (sync/webhook/boleto-code), `kommo-*` (note/advbox-webhook), `portal-*` (data/admin/feedback/pergunta/push/manifest), `zapsign-*` (proxy/webhook), `save-to-drive*`, `datajud-refresh`, `commission-calculator`, `cobranca-regua`, `reminder-cron`, `keep-warm`, `health`, `cpf-lookup`, `api-powerbi`, `api-rest`, `rate-limit`
- Crons nativos Netlify (ver §8 para schedules reais)

### Integrações externas
| Serviço | URL | Função |
|---------|-----|--------|
| **Supabase** | `vygczeepvoyaehfchxko.supabase.co` | DB + Auth + Realtime (projeto compartilhado) |
| **ZapSign** | `api.zapsign.com.br/api/v1` | Assinatura eletrônica (+ webhook nativo) |
| **ADVBOX** | `app.advbox.com.br/api/v1` | CRM jurídico (cliente/processo/tarefas/andamentos) |
| **Asaas** | `api.asaas.com/v3` | Pagamentos (boleto/PIX/NF) + webhook |
| **Kommo** | `advocaciacbc.kommo.com/api/v4` | CRM comercial: mover lead + notas + bot WhatsApp |
| **DataJud CNJ** | `api-publica.datajud.cnj.jus.br` | Distribuição/ajuizamento de processos |
| **Google Apps Script** | `script.google.com/macros/s/...` | Upload Google Drive |
| **Anthropic** (opcional) | `api.anthropic.com` | Tradutor IA do bot (`ANTHROPIC_API_KEY`) |
| **ViaCEP / CPF API** | via `apiLookup.js` / `cpf-lookup.mjs` | CEP e validação de CPF |
| ~~**ChatGuru**~~ | **REMOVIDO 23/05/2026** | substituído pelo Kommo. Arquivos legados (`supabase_chatguru_automations.sql`, env `CHATGURU_KEY`) ainda no repo mas inertes. |

### Hospedagem
- **Netlify** (Pro) — SPA + Functions + Edge — site ID `d7b38821-22e9-4308-8fda-a8f124a65b72`
- **Supabase** (Pro, compartilhado) — PostgreSQL + Auth + Realtime
- **AWS S3** — backup redundante diário (via `server/`)

---

## 3. Estrutura de Pastas

```
cbc-contratos/
├── CLAUDE.md                      ← Este arquivo (guia do projeto)
├── client/                        ← Frontend React + Vite (SPA)
│   ├── src/
│   │   ├── components/            ← 43 componentes (.jsx) + subpastas:
│   │   │   ├── bot/               ← 11 sub-paineis do Bot ADVBOX + botApi.js
│   │   │   ├── contratos/         ← CardsView, KanbanView, ViewsManager,
│   │   │   │                         ContractComments, PresenceIndicator
│   │   │   └── dashboard/         ← compute.js (lógica), widgets.jsx, format.js
│   │   ├── hooks/                 ← 13 hooks (useDeviceType, useDensity, useEmpreendimentos,
│   │   │                             useKpiPreferences, useNotifications, usePresence,
│   │   │                             useUndo, useScrollRestoration, usePersistedFilters…)
│   │   ├── utils/                 ← 26 módulos (pdfGenerator, docxGenerator, ocrService,
│   │   │   │                         zapsignService, advboxService, apiLookup, masks,
│   │   │   │                         celebrations, importContrato, commissionClient…)
│   │   │   └── __tests__/         ← testes vitest
│   │   ├── steps/                 ← Step1..7 — ⚠️ CÓDIGO MORTO (wizard antigo, não importado)
│   │   ├── data/                  ← clausulas.js (RESORTS ~99 + cláusulas-modelo)
│   │   ├── lib/                   ← Cliente Supabase
│   │   ├── App.jsx                ← Raiz da SPA (12 abas, dock mobile, automações globais — ~1560 linhas)
│   │   ├── AuthContext.jsx        ← Auth Supabase + detecção de login anômalo
│   │   ├── ContractContext.jsx    ← Estado do contrato (localStorage)
│   │   └── index.css              ← Design tokens + componentes Tailwind + seção MOBILE REDESIGN
│   ├── public/                   ← _headers, favicons, logos (webp+png), portal.html, portal-sw.js
│   ├── netlify/
│   │   ├── functions/             ← 62 funções (.mjs) + _lib/ (11 libs compartilhadas)
│   │   └── edge-functions/        ← health.ts, zapsign-proxy.ts
│   ├── dist/                      ← Build de produção (Vite)
│   ├── deploy.sh / rollback.sh / check-bandwidth.sh
│   ├── netlify.toml · vite.config.js · package.json
├── server/                        ← Backend Node.js (Puppeteer/OCR/backup S3)
│   ├── index.js (monolito) · src/* (modular, cutover pendente) · por.traineddata
├── docs/                          ← BOT_ADVBOX_SETUP, PORTAL_CLIENTE, ADVBOX_API_REFERENCIA,
│   │                                ASAAS_ESPELHO, POWERBI_CONEXAO, RUNBOOK, ROLLBACK_PLAYBOOK,
│   │                                SMOKE_CHECKLIST, SUGESTOES_*
├── backups/                       ← Backups timestamped (um por alteração crítica)
├── supabase_*.sql                 ← Migrations versionadas (setup, v2, upgrade, p1_scale,
│                                     bot_advbox, vendas_comissoes, drive_retry_columns,
│                                     boletos_backfill, audit_import; leads/chatguru = legado)
└── render.yaml                    ← Config de deploy alternativo (Render, não usado)
```
> O `client/` é a raiz do app no Netlify (build/deploy partem dele). A pasta `steps/` e `components/Stepper.jsx` são **código morto** do wizard antigo — não usar como referência.

---

## 4. Funcionalidades Implementadas

As 12 abas (gated por `user_permissions.tabs`, exceto **Sócios** que é gated por email). Lazy-loaded com prefetch no hover (`App.jsx`).

### Novo Contrato (`FormPanel.jsx` ~1750 linhas)
- **Formulário de seções numa página só** (NÃO é mais wizard de 7 steps), com bolinhas de progresso verde/vermelho por seção e Live Preview lado a lado (desktop) / segmented control Formulário-Contrato-Procuração (mobile)
- **OCR de CNH** via Tesseract (câmera ou upload, 3 fases com progresso) · **busca por CPF** preenche os campos · **busca por nome** sugere clientes do histórico
- Máscaras (CPF/CEP/telefone/RG), validação em tempo real, **detecção de gênero** ajusta profissão/estado civil, **prioridade idoso** (≥60), autocomplete CEP (ViaCEP)
- **Detecção de duplicatas** (CPF+Resort) e **conflitos entre cláusulas**; ~99 resorts + criação de novos (`empreendimentos`); cláusulas auto-geradas + avulsas, reordenáveis (drag no desktop, ↑/↓ no touch)
- Honorários: Apenas Iniciais | Apenas Êxito | Iniciais + Êxito · salvar como rascunho (localStorage, offline-first) · gerar PDF/DOCX · enviar ao ZapSign (com checklist pré-envio)

### Contratos Salvos (`ContratosTab.jsx`)
- Visões **Lista / Cards / Kanban** (`contratos/*`) + **Views salvas** por usuário (`user_views`)
- Busca, filtros (status/resort/tipo/data), "Ver arquivados", seleção em massa, **arquivar** contratos
- Expansão inline com **timeline de automações** (`PROGRESS_STEPS`: Salvo→Aguardando→Assinado→Pasta→Cliente ADVBOX→Processo ADVBOX→Kommo)
- Envio/retry ZapSign·ADVBOX·Drive individual, comentários (`contrato_comentarios`) + presença em tempo real, importar contrato assinado externo, export Excel

### Minhas Vendas (`VendasPanel.jsx`) + Param. Vendas (`VendasParametrizacaoPanel.jsx`)
- Painel do vendedor/assistente: carteira, **comissões** (`vendas_comissoes_*`), **guias de custas**, **requisitos de documentos** enviados, leads rápidos, metas, **promoções sazonais**
- Kanban com mover por toque; Param. Vendas (admin): regras de comissão, tipos/requisitos de documento, metas, expectativa de honorários, matriz resort×tipo
- Backend: `commission-calculator` (cron mensal), `advbox-vendas-sync`, `commissionClient.js`

### Dashboard (`Dashboard.jsx` + `dashboard/*`) — redesenhado 12/06 (ver topo)
- Filtros globais (período por chips, resort, tipo, incluir arquivados) que valem para a página inteira; **KPIs sensíveis ao período**; **comparador de meses**; funil cumulativo; produção mensal (criados×assinados / receita); jornada e tempo até distribuição com drill-down; insights automáticos; GeoHeatmap (lista/barras por UF, não Leaflet); HeatmapTemporal; export Excel respeitando filtros

### Dashboard Sócios (`SociosDashboard.jsx`) — gated por email (`SOCIOS_EMAILS`)
- Financeiro (receita/projeção/inadimplência/top), Operacional (funil/tempo/êxito), Equipe (produtividade/ranking), Estratégico (YoY/top resorts/ação mais rentável)

### Asaas + Boletos (`AsaasPanel.jsx`, `BoletosPanel.jsx`)
- Boletos+PIX automáticos ao assinar, parcelamento, **NF automática** via `asaas-webhook`, **régua de cobrança** (`cobranca-regua`)
- Espelho de boletos/clientes (`asaas_boletos`/`asaas_customers`), sync 2x/dia + manual; faixa de **inadimplência** (`InadimplenciaStrip`, `inadimplencia_historico`); relatório PDF; drawer de contrato; conferência de NF

### Bot ADVBOX (`BotAdvboxPanel.jsx` + `bot/*`) — autoatendimento Kommo×ADVBOX
- 8 sub-abas (Simulador, Novidades, Etapas, Tarefas, Glossário, Intenções, Testadores, Config) + Métricas/Pendências
- Responde no WhatsApp via Kommo: andamento processual traduzido, busca por nome/CPF/CNJ, multi-processo, escalonamento; visibilidade por etapa/tarefa ("ocultar do cliente"); catálogo auto-sincronizado; backfill. Guia: `docs/BOT_ADVBOX_SETUP.md`

### Portal do Cliente (`PortalClientePanel.jsx`) — gestão dos links
- Gera/gerencia tokens de acesso (`portal_tokens`/`cliente_portal_tokens`), conteúdo por seções, FAQ, perguntas do cliente, NPS, push notifications. Página pública servida por `portal.html` + functions `portal-*`. Guia: `docs/PORTAL_CLIENTE.md`

### Monitor (`MonitorPanel.jsx` + `MonitorAdvbox.jsx`)
- Central ADVBOX (farol das 5 integrações + console de eventos `advbox_api_log` + "Testar API agora"), filas de automação, detecção de loops (>5min), histórico, erros 24h, **health check** dos serviços (Supabase, Asaas, ZapSign, Apps Script — sem ChatGuru), SLOs (`HealthSlos`), `SupabaseHealthMonitor`

### Admin (`AdminPanel.jsx`) — apenas is_admin=true
- Gestão de usuários/permissões (matriz tab×usuário, grava na hora), audit log, backup/export

### Automações globais (`App.jsx`, polling a cada **5 min** = 300000ms)
1. Contratos `enviado_zapsign` → `/api/zapsign` (status) → se todos assinaram, vira `assinado` (webhook ZapSign também atualiza em tempo real)
2. Nota Kommo "abriu e não assinou" (#18, idempotente via `kommo_view_noted`)
3. Assinados sem ADVBOX → `advbox-sync` (lock atômico) · assinados com `linkGoogleDrive` sem `drive_file_id` → `save-to-drive` (retry robusto: max 3 tentativas, auto-recovery de lock órfão >5min, erros determinísticos não retentam)

### Features de UX transversais
- Dark mode (tokens `--cbc-*`), densidade ajustável, splash inline, glassmorphism, ripple, celebrações com confete (meta mensal/milestones/assinatura rápida/novo resort), favicon dinâmico ao assinar, banner "PRA CIMA CBC!", health indicator, autosave indicator, error boundaries por aba, skeletons, Undo (Cmd+Z, 10s), busca global (Cmd+K / lupa no touch), atalhos (Cmd+N/S/P/D, Cmd+1/2/3), dock flutuante mobile com "Mais" (todas as abas)

---

## 5. Funcionalidades em Andamento

> O histórico detalhado por sessão (abril→junho/2026) está no bloco **"Estado atual"** no topo deste guia e no `ChangeLog.jsx`. Aqui ficam só os fios soltos atuais.

### Pendências ABERTAS que exigem ação manual do Paulo
1. **`SUPABASE_SERVICE_ROLE_KEY` no Netlify** — sem ela várias functions gravam como anon, esbarrando no RLS allow-all. (O Asaas já contornou isso via RPC `SECURITY DEFINER` + `BOT_RPC_SECRET`; as policies `temp_anon_*` foram removidas.) Configurar a service role segue prioritário para o resto. **Prioridade.**
2. **RLS allow-all** em `contratos`, `user_permissions` e ~101 tabelas — a anon key pública lê/escreve tudo (ver §Pendências de SEGURANÇA no topo).
3. **Rotacionar tokens expostos**: `KOMMO_TOKEN` (exposto em chat 02/06), `VITE_ADVBOX_TOKEN`/`VITE_CPF_API_TOKEN` (no bundle) — e movê-los para proxies server-side.
4. **Bot ADVBOX**: criar Salesbot de 1 bloco no Kommo (exibe `{{lead.cf.2433130}}`), colar bot_id no painel Config e marcar "ativo"; cadastrar testadores; opcional `ANTHROPIC_API_KEY`.
5. ~~**Remover policies `temp_anon_all_asaas_*`**~~ **FEITO** — já removidas; Asaas grava via RPC `SECURITY DEFINER` + `BOT_RPC_SECRET` (16/06/2026).

### Dívida técnica conhecida (não urgente)
- `steps/` + `Stepper.jsx` = código morto (wizard antigo) — candidatos a remoção.
- `server/src/*` modular existe mas o cutover do monolito `index.js` nunca foi feito.
- `api-powerbi` ainda serve dados via function (migrar para view); arquivos legados ChatGuru/Leads no repo.
- Sem suíte de testes ampla (só alguns `utils/__tests__` em vitest).

### Ideias levantadas mas não implementadas
- Migrar a nota Kommo #18 ("abriu e não assinou") para webhook ZapSign server-side (hoje roda no navegador, só com o app aberto).
- Aniversários automáticos, alertas de prazo, notas internas com contexto processual.
- Dezenas de sugestões em `docs/planejamento/SUGESTOES_*.md` (movidas da raiz em 06/07 — auditoria #32; revalidar contra o app real).

---

## 6. Regras de Negócio

### REGRAS CRÍTICAS — Nunca podem ser violadas

### REGRA #1: Backup antes de alterar arquivos de produção
Antes de qualquer edição em arquivos no `client/` ou `netlify/functions/`, copiar para `backups/YYYYMMDD_HHMMSS_motivo/`. **Nunca usar `rm`** em arquivos de projeto.

### REGRA #2: Fluxo de status do contrato (imutável)
```
rascunho → enviado_zapsign → assinado
                                  ↓
                    [ADVBOX + Drive + Asaas disparam]
```
Status `cancelado` existe mas é tratado separadamente (não conta em estatísticas nem duplicatas).

### REGRA #3: Lock atômico em automações
Toda automação que pode disparar múltiplas vezes (Drive upload, ADVBOX sync) usa **lock atômico via UPDATE condicional no Supabase** para evitar processamento duplicado. Se lock ficar órfão >5min, auto-recovery libera.

### REGRA #4: Campos obrigatórios do contratante (por contratante)
Nome, nacionalidade, profissão, estado civil, RG, CPF (000.000.000-00), email, data nascimento, telefone, **Link Kommo** (URL), CEP (00000-000), UF (27 estados), endereço, número, bairro, cidade. Definidos em `CONTRATANTE_FIELDS` (FormPanel) → alimentam `isFormComplete` (botões Salvar/PDF/ZapSign ficam desabilitados se faltar qualquer um) + `validateChecklist` (App.jsx, gate de envio) + `PreSendChecklist`. **Link Kommo virou obrigatório em 14/06/2026** (antes o label/checklist diziam "opcional", contradizendo o gate que já o exigia); deve ser uma URL (`https?://...`) — habilita mover lead + notas no CRM.

### REGRA #5: Modos de honorário
- **Apenas Iniciais**: total + parcelas + data 1ª parcela obrigatórios
- **Apenas Êxito**: percentual (0-100%) obrigatório
- **Iniciais + Êxito**: todos os campos obrigatórios

### REGRA #6: Deduplicação
Ao criar contrato, verifica CPF+Resort em contratos **não cancelados**. Mostra alerta com contratos existentes (não bloqueia).

### REGRA #7: RBAC via `user_permissions`
Usuário novo recebe tabs `{novo: true, contratos: true, dashboard: true, leads: true, outros: false}` e `is_admin: false`. Apenas admins alteram flags de outros.

### REGRA #8: Paulo Conforto é admin master (`paulo@advocaciacbc.com`)
Todas as tabs ativas + `is_admin: true`. Nunca remover.

### REGRA #9: ADVBOX — responsável padrão
Todo processo novo é atribuído a **PAULO CONFORTO (ID 241495)** como responsável. Estágio inicial: **3795429 (ASSINADO AUTOMAÇÃO)** no grupo NEGOCIAÇÃO.

### REGRA #10: Tipo de ação → ID ADVBOX
Mapeamento fixo em `advboxService.js` (ex: "Ação de cobrança" → ID 2151644). Nunca alterar sem atualizar tabela de mapeamento.

### REGRA #11: Comunicação com cliente é via Kommo (ChatGuru removido)
O envio automático de WhatsApp foi **desligado** (23/05/2026). O operador envia o link de assinatura manualmente pela conversa do contratante no Kommo. As automações Kommo (mover lead, notas) e o bot WhatsApp consideram fuso America/Sao_Paulo. Datas/horas server-side sempre em BRT.

### REGRA #12: Prioridade Idoso
Cliente com idade ≥60 anos gera alerta visual automático. Data nascimento é obrigatória para cálculo.

### REGRA #13: Detecção de login anômalo
Loga em `activity_log` se login ocorrer fora de 6h-23h OU fora do Brasil (geolocalização IP). Exibe warning ao usuário.

### REGRA #14: Deploy sempre `--prod`, nunca preview
Preview deploys consomem bandwidth desnecessária. O `deploy.sh` já força `--prod`.

### REGRA #15: Netlify bandwidth
Pro plan = 1TB/mês. Monitorar com `check-bandwidth.sh`. Alerta em 80%.

### REGRA #16: Sempre listar sugestões antes de executar
**Nunca alterar código sem listar as mudanças propostas e obter aprovação explícita do Paulo.** (Regra da memória do usuário.)

### REGRA #17: Supabase — chave anon é pública
A anon key está no bundle do frontend — é por design. Segurança deve vir de **RLS policies** no banco.

### REGRA #18: Cláusula 1 (Objeto) — sempre auto-gerada
Baseada em resort + tipo de ação. Não pode ser editada manualmente no fluxo padrão.

### REGRA #19: Geração de DOCX
Contrato + procuração geram DOCX separados com templates independentes (`generateContractDocxBlob` e `generateProcuracaoDocxBlob`).

### REGRA #20: Split de PDF assinado
Após assinatura, `save-to-drive` usa `pdf-lib` para separar contrato (primeiras N páginas) + procuração (N+1 até total) + relatório ZapSign (páginas adicionais no fim).

---

## 7. Identidade Visual

### Paleta Principal
```
Navy (primária):     #1B3A5C
Navy light:          #264A72
Navy dark:           #0F2035
Gold (accent):       #C9A84C
Dark gold:           #B8860B
Creme (fundo):       #F0F4F8
Creme dark:          #E4EAF0
```

### Status
```
Success:  #16A34A (verde)
Error:    #DC2626 (vermelho)
Warning:  #D97706 (laranja)
Info:     #2563EB (azul)
```

### Tipografia
- **Cormorant Garamond** (400, 600, 700) — títulos de contratos, logo CBC
- **Lato** (300, 400, 700) — UI geral
- **Fallback**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto`
- **Tamanho base**: 15px
- **Labels**: uppercase com `tracking-wide`

### Design Tokens (`--cbc-*`)
Design system custom com variáveis CSS em `index.css`. Tempo de transição padrão: 200ms.

### Componentes-Chave

**Botões**
- `.btn-primary` — Navy + branco, uppercase, sombra
- `.btn-outline` — borda Navy 2px, hover inverte
- `.btn-press` — scale 0.96 ao clicar
- `.btn-ripple` — onda radial ao pressionar

**Cards**
- `.card` — branco, `rounded-xl`, shadow `0 1px 6px rgba(0,0,0,.09)`
- `.card-header` — Navy fundo, texto branco uppercase
- `.glass-card` — `rgba(255,255,255,0.85) + backdrop-filter blur(10px)`

**Inputs**
- `.input-field` — border gray-300, focus ring azul 2px
- `.input-error` / `.input-valid` / `.input-invalid` — estados

**Animações**
- `fadeIn`, `fadeInUp`, `slideDown` — 300ms
- `shake`, `shakeError` — validação
- `ocrPulse` 2s — auto-preenchimento
- `tabFadeIn` 250ms — troca de abas
- `celebrationSlide` 4s — banner de assinatura
- `shimmerWave` 1.8s — skeletons
- `requiredPulse` — campos obrigatórios vazios

### Padrões de Layout
- Cards: `p-4` a `p-6`
- Inputs: `py-2.5 px-3.5 rounded-lg`
- Labels: `mb-1 text-xs font-bold uppercase tracking-wide`
- **Mobile/iPad-portrait**: dock flutuante (`.dock-floating`) com 4 itens — Novo, Salvos, Dashboard e **Mais** (abre `MobileNavSheet` com todas as abas permitidas). Desktop e iPad-landscape: top tabs. Tudo que é mobile-only fica atrás de `max-sm:`/`pointer:coarse`/`isMobile`/`dockVisible` (ver §"Mobile 2.0" no topo).

---

## 8. Integrações e Configurações

### Variáveis de Ambiente (Netlify)

**Backend (Netlify Functions)**
| Variável | Descrição |
|----------|-----------|
| `ADVBOX_TOKEN` | Token ADVBOX |
| `ASAAS_API_KEY` | Key Asaas (prefixo `$aact_prod_*`) |
| `ZAPSIGN_TOKEN` | Token ZapSign |
| `KOMMO_TOKEN` | Token long-lived Kommo API v4 (mover lead + notas + bot). ⚠️ exposto em chat 02/06 — **rotacionar** |
| `BOT_PANEL_KEY` | Auth do painel/widget do Bot ADVBOX (default fraco `cbc-bot-2026`) |
| `ANTHROPIC_API_KEY` | Opcional — tradutor IA do bot |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (bypass RLS) — ⚠️ **não configurada** (functions gravam como anon) |
| `WEBHOOK_SECRET` | Valida webhooks externos |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push notifications do Portal (`web-push`) |
| `POWERBI_API_KEY` | Auth da `api-powerbi` (default fraco `cbc-powerbi-2026`) |
| `REST_API_KEYS` | Auth da `api-rest` (default fraco `cbc-api-2026`) |
| `CHATGURU_KEY` | **Legado/inerte** (ChatGuru removido) |
| `URL` | Base do site (Netlify injeta) — callers server-side de `kommo-note` etc. |

**Frontend (Vite)**
| Variável | Descrição |
|----------|-----------|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase (anon key é pública por design) |
| `VITE_ADVBOX_TOKEN` | ⚠️ **EXPOSTO** no bundle (rotacionar + mover p/ proxy) |
| `VITE_CPF_API_TOKEN` | ⚠️ **EXPOSTO** no bundle |
| `VITE_BOT_PANEL_KEY` | Espelho de `BOT_PANEL_KEY` para o painel do bot |
| `VITE_API_URL` | `http://localhost:3001` (server local, dev) |

**Backend server (S3)**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-1`, `S3_BACKUP_BUCKET=cbc-contratos-backups`

### Netlify
- **Site ID**: `d7b38821-22e9-4308-8fda-a8f124a65b72`
- **Plano**: Pro ($20/mês)
- **Token de deploy**: `nfp_NCnV8aNCqGMSJNuWjXWZR9Bdubhkvubbe458` (em `deploy.sh`)
- **URL produção**: https://contratos-cbc.netlify.app

### Supabase
- **URL**: `https://vygczeepvoyaehfchxko.supabase.co` · **Project ID**: `vygczeepvoyaehfchxko`
- ⚠️ **Banco COMPARTILHADO** entre vários apps do escritório. Prefixos de OUTROS apps (não tocar): `teses_*`, `calc_*`, `penhora_*`, `aud_*`, `dc_*`, `crm_*`, `cbc_*` (prestação/financeiro), `calculos`, `levantamentos`, `acordos`, `prest_*`. **Use sempre prefixo/nome exato ao mexer no banco.**
- **Tabelas do CBC Contratos** (por domínio):
  - Contratos: `contratos` (73 cols, JSONB `dados`), `contratos_audit`, `contrato_comentarios`, `empreendimentos`, `user_views`, `client_mapping`, `import`(audit)
  - Acesso/sistema: `user_permissions`, `user_reminders`, `user_notification_prefs`, `notifications`, `activity_log`(+archive), `audit_log`, `automation_log`, `error_log`, `integration_logs`, `active_sessions`
  - Asaas/cobrança: `asaas_boletos`, `asaas_customers`, `asaas_customer_notes`, `asaas_sync_state`, `asaas_error_log`, `asaas_access_log`, `inadimplencia_historico`, `cobranca_regua`
  - Kommo/ADVBOX: `advbox_api_log`, `contatos_kommo_diario`
  - Bot ADVBOX: `bot_config`, `bot_glossary`, `bot_intents`, `bot_stage_templates`, `bot_task_templates`, `bot_testers`, `bot_sync_state`, `bot_conversations`, `bot_messages`, `bot_ai_cache`, `bot_secrets`
  - BI (espelho ADVBOX → Power BI): `bi_processos`(+log), `bi_clientes`, `bi_financeiro`, `bi_funil_historico`, views `vw_bi_*`
  - Vendas/comissões: `vendas_comissoes_mensais`(+detalhe), `vendas_comissao_regras`, `vendas_metas`, `vendas_documentos_*`, `vendas_guias_custas`, `vendas_expectativa_honorarios`, `vendas_promocoes_sazonais`, `vendas_leads_rapidos`, `vendas_advbox_mapping`
  - Portal do Cliente: `portal_tokens`, `cliente_portal_tokens`, `portal_faq`, `portal_perguntas`, `portal_comentarios`, `portal_nps`, `portal_push_subs`, `portal_access_log`, `portal_cliente_flags`, `portal_acessos_diario`
- **RLS**: habilitado mas **allow-all** na maioria (buraco conhecido — ver §SEGURANÇA). Service role ainda não configurada; o Asaas grava via RPC `SECURITY DEFINER` + `BOT_RPC_SECRET` (as antigas `temp_anon_*` foram removidas).

### Webhooks recebidos
- `asaas-webhook` — pagamento confirmado → emite NF + sync incremental de boletos
- `zapsign-webhook` — assinatura concluída → atualiza status em tempo real (backup do polling)
- `kommo-advbox-webhook` — `add_message` do Kommo → dispara o bot (`advbox-bot-worker-background`)
- `portal-feedback` / `portal-pergunta` / `portal-push` — interações do Portal do Cliente

### Crons agendados (Netlify — `schedule` na própria function, BRT = UTC−3)
| Função | Schedule (UTC) | Quando (BRT) |
|--------|----------------|--------------|
| `advbox-monitor` | `30 9,20 * * 1-5` | 06h30 e 17h30, seg–sex (+ snapshot BI em sequência) |
| `advbox-backfill-watchdog` | `*/30 * * * *` | a cada 30 min |
| `advbox-vendas-sync` | `0 9,15,21 * * *` | 06h/12h/18h |
| `asaas-sync-customers` | `0 9 * * *` | 06h |
| `asaas-sync-boletos` | `0 9,21 * * *` | 06h e 18h |
| `cobranca-regua` | `30 13 * * 1-5` | 10h30, seg–sex |
| `commission-calculator` | `5 3 20 * *` | dia 20, 00h05 |
| `datajud-refresh` | `0 11 * * *` | 08h |
| `bot-rotina-semanal` | `0 10 * * 1` | seg 07h |
| `reminder-cron` | `*/15 * * * *` | a cada 15 min |
| `keep-warm` | `*/10 * * * *` | a cada 10 min (cold start de `health`/`zapsign-proxy`) |

### Crons Server Node — ⚠️ DESATIVADOS (server/ aposentado 20/06/2026)
- ~~Backup diário completo 03:00 BRT (contratos + clausulas + audit_log → local + S3)~~ **NÃO roda mais** — o `server/` foi removido. **Hoje não há backup automático do banco** (pendência crítica, auditoria #87). Recriar como Netlify Scheduled Function ou ativar backup gerenciado do Supabase Pro.

### Google Apps Script
- URL: `https://script.google.com/macros/s/AKfycbzEzt-t_GDTbUKrzxTLkdOMqYS0Hz_PWcYt7uBcbj7yoKqKdUr89So8gRmsVwhT0cpI5Q/exec`
- Função: recebe base64 de PDF/DOCX + folderId → upload para Google Drive

---

## 9. Como Rodar o Projeto

### Pré-requisitos
- Node.js 22+ (testado com 24.14)
- npm 10+

### Instalação
```bash
# Na raiz do projeto
npm install

# Frontend
cd client && npm install

# Backend
cd ../server && npm install
```

### Desenvolvimento (ambiente local)
```bash
# Na raiz — roda client + server em paralelo
npm run dev

# Ou individualmente:
cd client && npm run dev              # Vite em http://localhost:5173
cd server && npm run dev              # Express em http://localhost:3001
```

### Build de produção
```bash
cd client
npm run build
# Output em dist/
```

### Deploy para produção
```bash
cd client

# Opção 1: script local (recomendado)
./deploy.sh

# Opção 2: manual via Netlify CLI
NETLIFY_AUTH_TOKEN="nfp_..." npx netlify-cli deploy --prod \
  --dir=dist \
  --functions=netlify/functions \
  --site="d7b38821-22e9-4308-8fda-a8f124a65b72"
```

### Rollback
```bash
cd client
./rollback.sh                        # Usa .last-working-deploy
./rollback.sh <deploy_id>            # Rollback para deploy específico
```

### Monitoramento de bandwidth
```bash
cd client
./check-bandwidth.sh                 # Mostra uso atual + alerta se >80%
```

### Scripts Supabase (migrations versionadas — já aplicadas em produção)
As `supabase_*.sql` na raiz são o histórico de migrations. As principais já estão no banco: `setup` (contratos), `v2` (audit/versões), `upgrade` (user_permissions), `p1_scale` (índices/RLS initplan), `bot_advbox` (tabelas `bot_*`), `vendas_comissoes`, `drive_retry_columns`, `boletos_backfill`, `audit_import`. **Legado inerte**: `leads`, `chatguru_automations`. Ao criar tabela nova, prefira `apply_migration` via MCP do Supabase e adicione o `.sql` correspondente.

### Lint
```bash
cd client
npm run lint
```

---

## 10. Próximos Passos

### Prioridade ALTA — Segurança (ver detalhes no topo)
1. **Configurar `SUPABASE_SERVICE_ROLE_KEY`** no Netlify (as `temp_anon_*` do Asaas já foram removidas; gravação Asaas usa RPC `SECURITY DEFINER` + `BOT_RPC_SECRET`)
2. **Fechar RLS allow-all** em `contratos`/`user_permissions`/demais (anon key lê/escreve tudo)
3. **Rotacionar tokens** `KOMMO_TOKEN`, `VITE_ADVBOX_TOKEN`, `VITE_CPF_API_TOKEN` e mover para proxies server-side
4. **Remover defaults fracos** (`cbc-api-2026`, `cbc-powerbi-2026`, `cbc-bot-2026`)

### Prioridade MÉDIA — Performance/Infra
5. **Migrar `api-powerbi` → view Supabase** (ainda serve dados via function)
6. **Nota Kommo #18 → webhook ZapSign server-side** (hoje roda no navegador)
7. **Cutover do `server/` modular** (`src/*` pronto, monolito ainda ativo)
8. **Sentry** — confirmar ativo · **UptimeRobot**/custom domain — avaliar
9. **Suíte de testes** — só há `utils/__tests__` em vitest; ampliar

### Prioridade BAIXA — Limpeza
10. **Remover código morto**: `steps/`, `Stepper.jsx`, arquivos legados ChatGuru/Leads
11. **Consolidar funções Asaas** duplicadas (`asaas-sync*`)
12. **Remover `api-rest`** se não houver integrador externo

### Já resolvido (não repetir)
- ✅ ZapSign webhook nativo existe (`zapsign-webhook`) · realtime com nomes de canal fixos · `dados` JSONB fora dos selects de lista (Dashboard/ContratosTab) · aba Leads e LeadsTab removidas · vazamento do pdfGenerator corrigido (13/06) · dark mode aplicado · cache headers agressivos

### Documentação existente (consultar antes de reescrever)
`docs/RUNBOOK.md`, `docs/ROLLBACK_PLAYBOOK.md`, `docs/SMOKE_CHECKLIST.md`, `docs/BOT_ADVBOX_SETUP.md`, `docs/PORTAL_CLIENTE.md`, `docs/ADVBOX_API_REFERENCIA.md`, `docs/ASAAS_ESPELHO.md`, `docs/POWERBI_CONEXAO.md` + `RUNBOOK_RECOVERY.md` na raiz

---

## Referências Rápidas

### Atalhos de Teclado
- `Cmd+K` / `Ctrl+K` — Busca global
- `Cmd+N` / `Ctrl+N` — Novo contrato
- `Esc` — Fullscreen form / fechar modais

### URLs Importantes
- **Produção**: https://contratos-cbc.netlify.app
- **Admin Netlify**: https://app.netlify.com/projects/contratos-cbc
- **Supabase Studio**: https://supabase.com/dashboard/project/vygczeepvoyaehfchxko
- **Build logs**: https://app.netlify.com/projects/contratos-cbc/deploys
- **Function logs**: https://app.netlify.com/projects/contratos-cbc/logs/functions

### Contatos
- **Proprietário**: Paulo Conforto (`paulo@advocaciacbc.com`) — admin master, comunica em PT-BR
- **Desenvolvimento**: Claude Code (com aprovação explícita do Paulo antes de alterar código)

### Convenções de Código
- **Comentários**: português (sem acentos em código, com acentos em strings)
- **Commits**: mensagens em português, formato descritivo
- **Arquivos de função Netlify**: extensão `.mjs` (ESM nativo)
- **Imports dinâmicos**: usados para lazy loading (`React.lazy`)
- **Estados atômicos**: locks via UPDATE conditional no Supabase

### Regras Operacionais Críticas
- **Deploy sempre direto em produção** (`--prod`), nunca preview
- **Backup antes de editar** qualquer arquivo em `client/` ou `netlify/functions/`
- **Aprovação do Paulo** antes de qualquer alteração de código
- **Monitorar bandwidth** semanalmente via `check-bandwidth.sh`
- **Rotacionar tokens** se expostos publicamente
