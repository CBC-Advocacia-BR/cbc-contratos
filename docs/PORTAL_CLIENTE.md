# Portal do Cliente — versão teste (10/06/2026)

Página pública, mobile-first, onde o cliente acompanha o processo e os pagamentos.
Acesso por link com token (sem login por enquanto — a tabela de tokens é a base
do futuro login).

## Acesso
```
https://contratos-cbc.netlify.app/portal?t=<token>
```
Token de teste ativo: cliente CRISTIANE LEITE DE OLIVEIRA (2 processos, 18 parcelas em aberto).

## O que o cliente vê
- **Meu processo**: fase atual (com texto parametrizado da aba Bot ADVBOX → Etapas,
  respeitando "ocultar do cliente"), quadro, advogado responsável, próximos passos
  e linha do tempo com andamentos traduzidos pelo glossário do bot.
- **Pagamentos**: total pago / em aberto, parcelas pendentes com **Copiar PIX**
  (copia-e-cola) e **Ver boleto** (link Asaas), status Pago/Em aberto/Vencido,
  e histórico de pagamentos.

## Arquitetura
| Peça | Onde | Papel |
|---|---|---|
| `client/portal.html` | entrada extra do Vite | página autocontida (sem React, ~21 KB) |
| `client/netlify/functions/portal-data.mjs` | Netlify Function | valida token e monta o JSON |
| `cliente_portal_tokens` | Supabase | tokens (ativo, contador de acessos) |
| `portal_boletos(p_token)` | função SQL `security definer` | devolve só os boletos do titular do token — `asaas_boletos` continua fechada para anon |

Dados vêm 100% do espelho local (bi_processos, bot_sync_state, asaas_boletos) —
zero chamadas ao ADVBOX por visita. Fallback: PIX faltante busca ao vivo no Asaas
(máx. 3 por requisição, exige `ASAAS_API_KEY`).

## Criar token para outro cliente
```sql
insert into cliente_portal_tokens (token, advbox_customer_id, nome, cpf)
values (
  encode(gen_random_bytes(16), 'hex'),   -- gera o token
  <customer_id do ADVBOX>,
  '<NOME EXATO como está em bi_processos.clientes>',
  '<CPF com ou sem pontuação>'
) returning token;
```
Desativar acesso: `update cliente_portal_tokens set ativo = false where token = '...'`.

## Próximos passos sugeridos
- Login do cliente (CPF + código via WhatsApp) usando esta mesma tabela
- QR code do portal no contrato assinado (sugestão #13 do SUGESTOES_POSBOT)
- Notificação pelo bot quando houver novidade: "veja no seu portal"

## Atualização 11/06/2026 — aba admin + Acordo

### Aba "Portal do Cliente" no sistema (gestão dos links)
Nova aba no gerador de contratos (permissão `tabs.portal` no Admin):
busca por nome/CPF (espelho `bi_clientes`), mostra a situação do link
(ativo/sem link/desativado, acessos, último acesso), e ações:
**Copiar link**, **Enviar no WhatsApp** (mensagem pronta com o link),
**Renovar** (o antigo deixa de funcionar) e **Desativar**.
- Backend: `client/netlify/functions/portal-admin.mjs` (auth `x-bot-key`)
- Frontend: `client/src/components/PortalClientePanel.jsx`

### Aba "Acordo" no portal (Prestação de Contas)
Se o cliente tem acordo **ativo** (status `pendente` na tabela `calculos` do
sistema de Prestação de Contas — mesma base Supabase), aparece a 3ª aba
"Acordo" no portal: tipo (levantamento de alvará), processo, data que o valor
caiu em conta, distribuição (recebido − honorários − custas ± correção ±
outros ajustes, sempre fechando a conta) e o **valor líquido para o cliente**
em destaque. Acordos `pago` não exibem a aba (regra: só ativo).
- Vínculo: nº do processo OU nº do cumprimento de sentença (dígitos, mín. 13)
  contra `bi_processos` do cliente; fallback por CPF (`c1CPF`/`c2CPF` do
  cálculo). **Recomendação**: preencher o CPF no sistema de Prestação de
  Contas (os campos já existem) — torna o vínculo imune a divergência de
  número de processo.
- RPC: `portal_acordo(p_token)` security definer (migration `portal_acordo_rpc`)
  — `calculos` continua fechada para anon.

### Escalabilidade (medido em 11/06/2026)
- Página: estática no CDN (~21 KB) — custo zero por cliente.
- Por visita: 1 invocação de function + 1 conjunto de queries no espelho.
- Plano Pro Netlify: 125k invocações/mês compartilhadas ⇒ portal suporta
  dezenas de milhares de visitas/mês sem esforço. Supabase: tokens/acordos
  são KB — irrelevante perto dos 8 GB.
- Alavancas futuras (se o uso explodir): consolidar as ~6 queries numa única
  RPC `portal_payload`; cache CDN curto (`Netlify-CDN-Cache-Control`,
  s-maxage 120–300s); migrar `portal-data` para Edge Function (2M invocações).

## Atualização 11/06/2026 (v3)
- **Card "Seu contrato"** no topo da aba Pagamentos: tipo de ação, resort,
  honorários iniciais (total + parcelamento), % de êxito, **pago até o
  momento** e barra de progresso de quitação. Fonte: tabela `contratos`
  (match por CPF do titular em contratante 1 ou 2).
- **Aba Acordo**: já era exibida apenas com acordo ativo; corrigido bug de CSS
  em que o botão oculto podia aparecer no rodapé (`.nav-btn[hidden]` e
  `.badge[hidden]` agora forçam `display:none`).
- **Visão geral na aba admin "Portal do Cliente"** (RPC `portal_diagnostico`):
  contadores, lista de TODOS os clientes prontos para gerar link (CPF +
  processo, sem link ativo; com selos Asaas/Kommo e geração na própria linha)
  e inconsistências de vínculo com orientação de correção:
  cliente sem CPF no ADVBOX · cliente sem cobranças no Asaas · contrato sem
  link Kommo · contrato sem processo ADVBOX · CPF do contrato fora do ADVBOX.

## Atualização 11/06/2026 (v4)
- **"Nossa equipe em ação"** no portal (aba Meu processo): contadores de
  tarefas concluídas e movimentações acompanhadas + **última atividade da
  equipe com nome de quem fez** (RPC `portal_atividades`; tarefas ocultas
  contam no número mas nunca aparecem nomeadas). Campo "Advogado responsável"
  removido a pedido.
- **Flag "só êxito"** (`portal_cliente_flags`): cliente sem honorários
  iniciais sai da divergência "sem Asaas" com 1 clique; contratos com
  honorários R$ 0 + % de êxito são excluídos automaticamente (34 detectados).
- **Exportação PDF e Excel** das divergências completas (até 5.000 por
  categoria, RPC `portal_diagnostico_export`): botões na aba admin; Excel com
  uma aba por categoria, PDF formatado CBC.

## Atualização 11/06/2026 (v5) — valor percebido + relatórios
- **Jornada do processo** (portal): stepper Contrato → Distribuição → Citação
  → Sentença → Êxito, derivado do quadro+etapa do ADVBOX (função
  `jornadaIndice` em portal-data.mjs), com selo permanente
  "✦ avançando acima do ritmo médio".
- **"Tudo sob controle"**: faixa verde no card da fase — o cliente não
  precisa fazer nada; reduz ansiedade/ligações.
- **Autoridade institucional**: "Em <mês>, nossa equipe já concluiu X tarefas
  processuais" (contagem real de task_completed no mês, do espelho).
- **Fotos da equipe**: seção "Quem cuida do seu caso" lê
  `bot_config.portal_equipe = {"fotos": ["url1", ...]}` (máx. 8; oculta se
  vazio). Para ativar: subir as fotos (quadradas) em qualquer URL pública e
  atualizar a key via SQL ou painel.
- **Relatório de boletos (aba Boletos do sistema)**: botão "Relatório" abre
  modal com filtros — período por vencimento OU pagamento, status
  (todos/pagos/em aberto/pendentes/vencidos), cliente (nome/CPF) — e gera
  **PDF paisagem** e **Excel** (abas Resumo + Boletos, até 5.000 linhas).
  Componente: `RelatorioBoletosModal.jsx` (leitura autenticada direta).

## Atualização 11/06/2026 (v6) — somente pessoa física + linguagem
- **Filtro pessoa física em tudo**: o ADVBOX cadastra partes contrárias
  (empresas) como clientes; agora origem "PARTE CONTRÁRIA", documentos com
  14 dígitos (CNPJ) e nomes com termos de PJ (LTDA, S/A, SPE, EIRELI,
  EMPREENDIMENT..., função SQL `_cliente_pf`) ficam fora do diagnóstico, dos
  exports e da busca da aba admin. Efeito: 2.701 → 2.367 clientes reais.
- **Portal**: colaborador aparece só com o primeiro nome; explicação sob a
  Linha do tempo de que movimentações são registros normais do tribunal e não
  exigem ação; selo "todas antes do prazo judicial" no card de tarefas
  concluídas.

## Atualização 11/06/2026 (v7) — relatório de inadimplência
- Modal "Relatório" da aba Boletos ganhou o tipo **"Inadimplência por
  cliente"**: agrupa por CPF os boletos vencidos (status OVERDUE + PENDING com
  vencimento passado), mostrando **total em aberto (ordenado do maior para o
  menor)**, nº de parcelas vencidas, 1º vencimento e **dias desde o primeiro
  inadimplemento**. PDF paisagem (resumo em vermelho: clientes, parcelas,
  total, maior atraso) e Excel (abas Resumo + Inadimplentes). Filtros de
  período (vencimento) e cliente opcionais. Referência em 11/06: 63 clientes,
  205 parcelas, R$ 61.734, maior atraso 333 dias.

## Atualização 11/06/2026 (v8) — lote de 18 melhorias
**Portal**: og:tags p/ cartão bonito no WhatsApp (#5) · aba Acordo em modo
"Concluída" quando status=pago (#8) · PWA instalável (manifest dinâmico com
token via portal-manifest.mjs) (#9) · pesquisa NPS 0-10 + sugestões no rodapé
(portal-feedback.mjs → portal_nps; reexibe a cada 30 dias) (#11) · bloco
"Indique um amigo" com wa.me e rastreio "Indicação de <nome>" (#12).
**Bot**: etapa oculta esconde TODAS as tarefas da resposta (#16; 148 etapas
listadas na aba Etapas, ocultar por toggle) · menu financeiro 1-4 (2ª via,
PIX, parcelas, falar com financeiro) com atalhos por palavra e por número do
menu inicial (#18) · handoff posta nota no Kommo com resumo das últimas 8
mensagens (#20) · rotina semanal loga as perguntas sem resposta no Monitor
(bot-rotina-semanal.mjs, seg 7h) (#17).
**Cobrança**: régua D+1/7/15 (cobranca-regua.mjs, dia útil 10h30; nota no
lead LIGADA, WhatsApp DESLIGADO até bot_config.regua.ativo=true) (#21) ·
cards vivos de inadimplência com tendência na aba Boletos
(InadimplenciaStrip; histórico diário em inadimplencia_historico) (#23).
**Dados**: "quem concluiu" usa payload.completed_by do monitor (#30) ·
telefone na lista sem-CPF p/ mutirão (#31) · bi_clientes.eh_pf persistido
(snapshot + backfill) (#32) · bi_funil_historico diário por quadro/etapa (#36).
**Admin**: seção Links ativos com filtro "nunca acessou" + copiar/WhatsApp
(#46) · card de engajamento (acessos/dia 14d + top clientes; contador em
portal_acessos_diario) (#47) · retrato semanal do diagnóstico em
portal_diagnostico_historico (#48) · permissão portal pré-ligada p/ admins (#49).
**Guardado para produção** (#14): bot responder com link do portal — esperar
fim da fase de testes.

## Atualização 11/06/2026 (v11) — tranquilidade + autoridade, zero esforço
- **Calendário forense automático**: recesso 20/12–20/01 (CPC art. 220),
  feriados nacionais + móveis (Páscoa por algoritmo de Meeus: Carnaval,
  Sexta Santa, Corpus Christi), estadual SP (09/07) e municipais de
  Americana (13/06 Santo Antônio, 27/08 aniversário). Banner explica que o
  fórum não funciona — manutenção zero.
- **Vigilância**: faixa verde "Verificado hoje às HH:MM ✓ · monitoramento
  automático há N dias" (monitor_status.last_run) com ponto pulsante.
- **Trabalho invisível → valor**: "~X h de trabalho dedicadas" (pesos default
  por tipo de tarefa na RPC portal_atividades v3), "N publicações oficiais
  analisadas" (tarefas ocultas viram valor agregado), card "Mês no seu caso"
  (movimentações + atividades do mês, gerado por código).
- **Autoridade real no rodapé**: RPC portal_instituicao — processos ativos,
  tarefas concluídas no ano, casos conduzidos até a fase de êxito.
- **Educação parametrizável**: "Entenda esta fase", "O que NÃO vai acontecer"
  e FAQ por marco da jornada — defaults prontos no código; aba Config do Bot
  ganhou seção "Portal — educação por fase" (vazio = padrão; FAQ no formato
  `Pergunta? | Resposta`). Glossário-tooltip: termos sublinhados na timeline
  mostram a definição no toque (reuso dos 43 termos do bot).
- **Compromisso marcado**: audiência/perícia futura detectada automaticamente
  vira card de destaque.
- **UI de tranquilidade/autoridade**: hierarquia emocional invertida (status
  humano calculado em verde — "Tudo caminhando bem / Novidades recentes /
  Reta final / Sob vigilância diária" — e a fase técnica como subtítulo),
  saudação por período, A+/A− de fonte (3 níveis persistidos), crossfade entre
  abas, selo com filete duplo + OAB no cabeçalho, voz "seu caso", divisores
  dourados, count-up nos números, fotos da equipe em duotone navy, "vencido"
  suavizado (tom terroso), modo escuro navy-noturno automático, estados
  vazios com próximo passo.

## Atualização 11/06/2026 (v12) — identidade única de luz
- **Dark mode REMOVIDO por completo** (decisão de marca): o portal renderiza
  sempre o tema marfim/navy/dourado, mesmo com o celular em modo escuro —
  verificado com preferência escura emulada.
- Refinos de elegância/confiança: **filete dourado fixo no topo** (papel
  timbrado), foco visível dourado em todos os controles (teclado/
  acessibilidade), hover dourado nos botões A+/A−, ícone de balança em SVG no
  banner de recesso (sem emoji), varredura de emojis do chrome da UI
  (mantidos apenas glifos tipográficos como ✓ e ✦), separadores dourados na
  linha de horas/publicações, divisor linha-ouro no rodapé.

## Atualização 11/06/2026 (v13) — NPS → Google + ajuste visual
- **Nota 9 ou 10 no NPS** → aparece na hora o convite "Avaliações públicas
  ajudam outras famílias a nos encontrar" com o botão **★★★★★ Avaliar no
  Google** (abre em nova aba); o convite se repete na tela de agradecimento
  pós-envio. Notas ≤8 não veem o convite (detrator não é mandado ao Google).
- **URL da avaliação é configurável**: bot_config key `portal_review`
  ({"url": ...}). Atual: link de busca Google com o ID do escritório
  (/g/11sm_yxqgv) abrindo o painel de avaliações. **Upgrade recomendado**:
  no Google Business Profile (Pedir avaliações) copiar o link curto
  `g.page/r/.../review` — abre a caixa de 5 estrelas direto — e atualizar a
  key (1 UPDATE, sem deploy).
- **Filete dourado fixo do topo removido** a pedido.

## Atualização 12/06/2026 (v14) — aba Dúvidas, push e autosserviço
- **Aba "Dúvidas" no portal** (4º item da navegação): FAQ pública (tabela
  portal_faq, 4 seeds), **"Pergunte aqui"** (cria registro + tarefa no lead
  Kommo com SLA de 1 dia útil; resposta da equipe aparece no portal com
  status Aguardando/Respondida) e "Suas perguntas".
- **Aba admin Portal do Cliente** ganhou: Perguntas dos clientes (responder),
  FAQ CRUD, Educação por fase (movida do BotConfig) e card de correlação
  acessos × mensagens Kommo (contatos coletados 1×/dia na régua, melhor
  esforço — verificar se o KOMMO_TOKEN tem escopo de events).
- **"De quem é a vez"** (regra do Paulo): tarefa ADVBOX pendente → chip
  dourado "Com a nossa equipe agora"; sem tarefa → chip verde "Aguardando o
  tribunal há X dias" (RPC portal_atividades v4, pendentes = task: sem taskdone:).
- **Push do PWA**: portal-sw.js (push + clique + fallback offline de
  navegação), opt-in no portal ("Ativar avisos de novidade"), assinaturas em
  portal_push_subs, envio no monitor (web-push + VAPID nas envs) quando há
  movimento novo no caso do cliente. Validar ponta a ponta num celular real.
- **Extrato de honorários em PDF** (aba Pagamentos → "Baixar extrato em
  PDF"): gerado no aparelho com logo, totais e tabela de pagos (jsPDF via CDN).
- **Lembrete no calendário** por parcela: iOS → arquivo .ics com alarme;
  Android/desktop → Google Calendar pré-preenchido (detecção por user-agent).
- **Modo família**: card com navigator.share/wa.me do próprio link.
- **Frases de confiança rotativas** no rodapé (por dia do ano) e **modo
  offline** (payload em localStorage; banner "dados da sua última visita").

## Atualização 12/06/2026 (v15) — carteira de casos (multi-processo)
- Cliente com 2+ processos deixou de ver chips com números CNJ crus: agora
  abre com **"N casos sob nossos cuidados"** (resumo consolidado: quantos com
  novidade na semana, quantos na reta final) e **cards ricos** em carrossel
  com snap: "Caso X de N", apelido legível (tipo da ação), status colorido
  (Caminhando bem / Novidade recente / Reta final / Sob vigilância diária),
  fase + quadro, CNJ discreto e badge dourada "novidade" (andamento ≤7 dias).
- Card selecionado ganha moldura e filete dourados; pontinhos indicam a
  posição no arrasto; **o caso escolhido fica memorizado** (localStorage) e o
  cliente volta direto nele na próxima visita.
- Caso único: nada muda (a carteira só aparece com 2+).

## Atualização 12/06/2026 (v16) — overhaul 10/10 UX/UI (ultracode)
Auditoria de design em 6 lentes paralelas (tipografia/cor, layout/hierarquia,
microinterações, a11y/WCAG, mobile/touch, voz/conteúdo) — notas iniciais
6.5–7. ~50 correções consolidadas, aplicadas em 5 camadas + conversão global
px→rem. Backup pré-overhaul: `backups/20260611_214805_portal_v16_design/`.

**Correção crítica**: A+/A− estava quebrado — o root mudava em %, mas TODAS
as 93 declarações `font-size` eram px fixos. Convertidas para rem (perl);
agora o controle de fonte funciona de verdade (16→18px verificado).

**Acessibilidade/WCAG**: `--ink-faint` #5A6D82 (4.8:1, era 3.2:1),
novo token `--gold-text` #7E5F26 (5.3:1) para dourado-como-texto,
`--warn` #8F5A18 (5.1:1). Alvos de toque ≥44px (NPS 48px, A+/A− 44px,
Ouvir 44px, lembrete-calendário 48px, extrato 44px, termo com hit-area
expandida via ::after + teclado Enter/Espaço + role=button).

**Hierarquia/layout**: header -45px (301→256), firma+OAB fundidos numa
linha, selo 48px com anel duplo unificado, h1 30px. Aba Pagamentos
reordenada ação-primeiro: resumo → próximas parcelas → contrato → histórico
("pago até o momento" movido para a legenda da barra). Nav visível desde o
load (skeleton fiel ao conteúdo no lugar do spinner). Caudas de marketing
(push/família/NPS/indicar) só na aba do caso.

**Microinterações**: stagger real de entrada (delay 55ms/el, máx 440ms),
crossfade só em troca de aba (scroll preservado em re-render), dots da
carteira em "pílula" que morfa (18px ativo), toast 7s, NPS em grade 6×2
com botões 48px e radiogroup ARIA.

**Voz**: plural() correto em todo lugar (fim de "(s)/(ões)"), "calma" virou
nota discreta (sem banner verde), frontispício na aba Dúvidas ("Canal direto
com a equipe"), copy do push degenerizada, indicação virou link pontilhado
discreto.

Rollback do deploy: `./rollback.sh 6a2b5574caf7adf6f7aa8817`.

## Atualização 14/06/2026 (v17) — lote ansiedade & tempo (3 waves, deploy direto)
Rollback do deploy: `./rollback.sh 6a2cd5ddd79a628d1148ceec`.

**Wave 1 — tranquilidade + robustez (sem migration):**
- **Jornada de 6 marcos**: Contrato → Distribuição → Citação → Sentença →
  **Cumprimento de sentença** → Êxito (a fase longa de receber agora é explícita).
- **Cards de evento crítico** (classificador regex inline, sem IA): sentença
  favorável = card-herói com contenção ("vitória ≠ dinheiro na conta; vem o
  cumprimento"); sentença desfavorável/parcial = **card neutro que não revela**
  o resultado; citação e acordo desmistificados.
- **Microcopy do silêncio saudável** (juiz/parte/perícia) + selo **"Nada
  pendente do seu lado"** com contador de dias + selo de aviso quando há boleto
  vencido/audiência próxima.
- **Tradução**: fallback neutro — o juridiquês cru nunca aparece (decisão: só
  glossário, IA desligada).
- **Calendário proativo** (avisa antes de feriado/recesso), "próxima
  verificação no próximo dia útil", reframe do recesso ("pausa que protege").
- **Pagamento confirmado** (banner "recebemos — não precisa mandar
  comprovante"), **só-êxito** ("você só paga se ganhar"), **WhatsApp 1-clique**
  contextualizado, **explicador "por que a Justiça demora"** na aba Dúvidas.
- **Robustez** `Promise.allSettled` (uma fonte que falha não derruba o portal).
- **NPS detrator (≤6) → tarefa automática no Kommo**.

**Wave 2 — prova social + dados:**
- **`portal_funil()`** (espelha a jornada em SQL) → **"Você não está sozinho —
  N outros clientes do escritório estão nesta mesma fase agora"** (≥5).
- Coluna `bot_stage_templates.nome_cliente` (nome humano da fase; portal lê com
  fallback) e colunas `bot_sync_state.event_class/title_cliente` (preparadas;
  portal-data classifica/traduz inline por ora).

**Wave 3 — métricas/analytics (o ranking de funções pedido):**
- Beacon leve no portal (`navigator.sendBeacon`): views de aba, cliques nas
  funções e tempo na página. **LGPD by design**: envia só token + tipo de
  evento (nada de nome/CPF).
- Função `portal-track` + RPC `portal_track` (valida token) + tabela
  `portal_eventos` (RLS sem policies) + RPC `portal_metricas`.
- Painel admin (aba Portal do Cliente) ganhou **ranking de funções mais
  usadas, horários de pico, tempo médio e retenção**.

**Config**: WhatsApp do escritório em `bot_config.portal_contato`
(5519988051878). **Diferido** (sem impacto visível): popular
`event_class/title_cliente` no worker de sync (otimização para push futuro).
