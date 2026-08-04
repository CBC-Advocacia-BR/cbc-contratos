# CBC Contratos — Guia do Projeto

> **Documento de referência** para Claude Code navegar e desenvolver neste repositório.
> Seções 1–10 reescritas em **14/06/2026** para refletir a **v6.6.0 em produção**. O bloco "Estado atual" logo abaixo é o changelog detalhado e tem precedência sobre descrições genéricas. **Sempre valide telas/fluxo no app real antes de implementar** — UI muda rápido.

---

## ⚡ Estado atual — LEIA ANTES

### ✅ DEPLOYADO 03/08/2026 — Link Kommo conferido na ORIGEM (mata a causa do erro 226)

**Deploy `6a7086c0408f6f7b3e0fd182`** (rollback: `./rollback.sh 6a7085acbf94677b8ead8856`). **774 testes** (era 732), lint no baseline 18, smoke 200/200/200, `resolve-kommo-lead` respondendo 401/405 em produção (não 502).

Continuação direta do 226 de 02/08: aquilo tratou o **sintoma** (fila para de retentar, lista de mortos). O problema voltaria a crescer, porque **todo merge de leads duplicados no Kommo apaga o perdedor** e o `linkKommo` do contrato continua apontando para o id morto. Agora o sistema confere **na hora de colar**.

- **Sem function nova.** `resolve-kommo-lead.mjs` ganhou o modo `{ apenasExistencia: true }`, que corta logo após o `GET /leads/{id}` — o resolve completo (contato + tags + RPC do Cadastro Único + 1ª mensagem) era caro demais para rodar num `onBlur`. Reusa JWT, timeout e log já existentes.
- **Três vereditos**: `existe` · `nao_existe` (404, vazio, **ou host ≠ `advocaciacbc.kommo.com`** — link de outra conta é inalcançável pelo nosso token) · `desconhecido` (timeout/429/5xx/token vencido) que **nunca bloqueia**.
- ⚠️ **A armadilha que define o código**: `kGet` **lança exceção** em todo HTTP não-ok, então "lead não existe" (404) chega com texto quase igual a "Kommo instável" (500). Confundir quebra nos dois sentidos: tratar 500 como ausência **trava contrato legítimo** toda vez que o Kommo oscila; tratar 404 como dúvida deixa passar o lead morto. A separação mora em `_lib/kommoLink.mjs` (puro, 10 testes, com caso explícito para id que *contém* 404).
- **Auto-cura**: lead que responde e está na `kommo_leads_mortos` tem a linha **apagada** — corrigir o link no formulário já destrava o fluxo, sem o `DELETE` manual de 02/08. **De propósito não há atalho** lendo a lista antes do GET: um lead marcado por engano ficaria condenado para sempre, e a auto-cura nunca rodaria.
- **UI**: aviso ao sair do campo no `FormPanel` (tokens `--cbc-*`, com ícone — não sinaliza só por cor) e uma linha nova no `PreSendChecklist`. O portão **reusa a engrenagem que já existia**: `fail` sem `severity:'warning'` entra em `errorCount` e bloqueia o `canProceed`; `unknown` é cinza e não bloqueia (item ux-16); `loading` segura até resolver.
- **Não registra na `kommo_leads_mortos`** o que o formulário reprovar — id digitado errado poluiria a tabela e passaria a barrar trabalho legítimo. Essa lista só cresce com falha real comprovada na fila.

Spec: `docs/superpowers/specs/2026-08-03-validacao-link-kommo-design.md`.
⚠️ **Não verificado**: os estados visuais e o ida-e-volta real com o Kommo exigem sessão logada, que eu não consigo criar. Testado: lógica pura, suíte, build e carga da function em produção.

### ✅ DEPLOYADO 02/08/2026 (noite) — erro 226 do Kommo decifrado: 37 clientes sem receber nota há semanas

**Deploy `6a6fda208733aad9a735413a`** (rollback: `./rollback.sh 6a6fd8968733aad342353f42`). **732 testes** (era 722), lint no baseline 19, smoke 200/200/200, as 4 functions da cadeia respondendo 401/405 (não 502 — o import novo resolve no bundle).

🔍 **`erro 226` no `POST /leads/{id}/notes` significa "o lead NÃO EXISTE"** — é o equivalente, no endpoint de notas, do `"Lead not found"` do PATCH. Não está documentado em lugar nenhum público. **Prova**: POST no lead `999999999`, id que nunca existiu, devolve o mesmo 226. Isso derruba as duas hipóteses naturais: **não é emoji** (texto ASCII puro falha igual — o truncamento por emoji de 31/07 é real, mas só vale para CAMPO personalizado) e **não é duplicidade** (marcador inédito falha igual; a idempotência por marcador está correta). O `note_type: 4` da resposta é só o Kommo normalizando `'common'` → id numérico, não é defeito.

⚠️ **Armadilha**: `GET /leads/{id}/notes` de lead morto **não devolve 404, devolve vazio** — então `jaTemNota` retorna `false` sem lançar, o fluxo segue e só o POST estoura. Quem lê o código esperando o GET falhar primeiro se engana.

| O que era | O que virou |
|---|---|
| 289 jobs presos em 30 dias — na verdade **271 jobs distintos** (marcador único cada) em **37 leads**, ×6 tentativas ≈ **1.600 chamadas inúteis** | Erro terminal morre na **1ª** tentativa, com `[terminal:lead_inexistente]` no painel |
| A fila **enchia de novo todo dia** (o monitor cria 1 job por andamento/tarefa) | `kommo_leads_mortos` (57 leads) barra na **entrada**, em `enqueue()` |
| Cobrança para lead morto era gravada como `enfileirado` e virava "19 com erro" na aba Boletos | Vira `resultado='pulado'` + `motivo_pulo` — o bot deixa de levar a culpa |

🚨 **O impacto que ninguém via**: **42 contratos, quase todos `assinado`**, apontam para lead morto — esses clientes **pararam de receber no Kommo** as notas de andamento e de tarefa concluída, alguns há 44 dias. Causa: o `linkKommo` é digitado à mão (REGRA #4) e **congela** no contrato; quando a equipe mescla leads duplicados na UI, o merge **apaga** o perdedor. Um dos links é de outra conta (`brunoadvocaciacbccom.kommo.com`). **Lista para a equipe corrigir: `relatorios/Leads-Kommo-inexistentes-02-08-2026.md`** (271 notas e 57 cobranças perdidas).

**Como ressuscitar um lead**: corrigido o `linkKommo` do contrato, `delete from kommo_leads_mortos where lead_id='<id>'`. O cache das functions expira em 60s e o fluxo volta sozinho.
Novo: `_lib/kommoTerminal.mjs` (módulo puro, 10 testes) · SQL `supabase_kommo_leads_mortos.sql`.
⚠️ **Pendência**: cobrança pulada por lead morto fica em `cobranca_disparos.resultado='pulado'`, que **nenhuma tela exibe** hoje — está só no relatório acima.

### ✅ DEPLOYADO 02/08/2026 — auditoria (~132 itens), backup RESSUSCITADO, 11 lembretes enviados

**Deploy `6a6f551a2e9e8ce0d82e883e`** (rollback: `./rollback.sh 6a6f53dc904c29e8a2efe4c8`). Smoke 200/200, console sem erro, app conferido no navegador.

| Verificado em produção | Resultado |
|---|---|
| 🚨 **Backup do banco** | **VOLTOU** — 55 tabelas, **111.409 linhas**, 5 arquivos, todos com id do Drive. Era 25.954 linhas em 17/07; o escritório estava 16 dias sem cópia |
| Alarme "tabela fora do backup" (161/162) | **já pegou uma**: `portal_diagnostico_historico` (7 retratos semanais da saúde do portal desde 15/06 — série histórica, não se recalcula). **Já incluída**: whitelist 55 → 56, `backup_tabelas_fora()` = 0 |
| Lembretes ZapSign (item 113) | **11 enviados, 0 falhas** (não eram ~51: só 11 estão na janela de 1-120 dias) |
| Limitador compartilhado (19/41/103/109) | **1ª gravação da história** em `rate_limit_counters` — nunca havia funcionado |
| Watchdog (141/142/144) | ativo: pegou 1 cron parado e os 3 contratos sem cobrança |
| `tokens-vigia-cron` (item 128) | 1ª execução: **Kommo ok · Meta Ads ok · ZapSign ok · ADVBOX ok · Asaas ok** |
| `backup-verificar-cron` (item 162) | 1ª execução: conferiu data/ok/id-do-Drive/tamanho/cobertura e achou o problema acima |
| `db-backup-cron` (2ª camada) | **1ª execução da história**: ok, 440 linhas, 2,1 MB no bucket `cbc-backups` |
| `kommo-view-check` (item 112) | 4 contratos/rodada (era 21) |
| Saúde do Funil (230/239) | conversão **29%** com a janela explicada na tela; bloco "Atendimento ao lead" mostrando **75 de 216 leads (35%) nunca respondidos** |

⚠️ **COMO DISPARAR UM CRON À MÃO** (aprendido no primeiro disparo real):
- **`curl` para a URL pública de uma function AGENDADA sempre dá 403** — o bloqueio é na borda da Netlify, antes do código rodar, então nem a chave certa passa. Todo `?key=` de disparo manual documentado nos crons **nunca funcionou por HTTP**.
- **O caminho certo é o botão "Run now"** na página da função no painel da Netlify (Logs & metrics → Functions → *nome*). Testado e funcionando.
- Quando o disparo precisar de **parâmetro** (ex.: `?simular=1`), aí sim a lógica tem de morar num arquivo **SEM `schedule`**, com um dispatcher agendado chamando ele — foi o que se fez em `zapsign-lembrete-cron` → `zapsign-lembrete-worker` (o `backup-diario` → `backup-worker-background` já era assim).

✅ **`db-backup-cron` RESSUSCITADO** (2ª camada de backup, dentro do Supabase): rodou pela **primeira vez na história** com `ok=true, 440 linhas`, arquivo de 2,1 MB no bucket `cbc-backups`. Ele reclamava "supabase env ausente" todo dia porque faltava a URL — resolvido pelo fallback em `_lib/supabaseClient.mjs`. Agora há **duas** cópias diárias: Google Drive (55 tabelas, completa) e Supabase Storage (5 tabelas do núcleo).

**12 contratos em `enviado_zapsign` NÃO recebem lembrete**: estão sem `zapsign_sent_at` (o mais antigo é de 25/05). Sem data de envio não dá para saber se o lembrete faz sentido — precisa de conferência manual.

### ✅ DEPLOYADO 02/08/2026 (tarde) — mais 10 itens: portal escuro, acessibilidade, funil e as 2 maiores economias

**5 deploys** (rollback do último: `./rollback.sh 6a6fc6f2d70a7c76f0ffc6f7`). **716 testes** (era 695), lint no baseline 19, smoke 200/200/200 em todos.

| Item | O que mudou |
|---|---|
| **175** 🏆 | A aba Boletos **paginava 12.921 boletos em 13 idas ao banco** para somar 8 números. RPC `boletos_resumo()` devolve o agregado de **1.319 clientes em 1 requisição**. ⚠️ **Conferido cliente a cliente ANTES de trocar: 1.319 comparados, ZERO divergência**; filtro de julho bate com contagem independente; `set local role authenticated` ok; HTTP 200 no PostgREST |
| **188** | Trocar de aba **desmonta** o painel — os 4 `let _cached...` que existiam evitavam o skeleton mas **não a rede** (o `lastFetchRef` é `useRef`, zera com o componente). `utils/cacheAba.js` novo: carimbo de hora fora do React, 5 min. **Não serializa** (era por isso que os 11 mil boletos nunca eram cacheados). Logout limpa tudo — há CPF e valor em memória |
| **240** | Duração da call estava medida e ignorada. 📊 **15 pessoas ENTRARAM e saíram antes dos 5 min** e sumiam no mesmo número das 55 que nunca abriram o link — **2 delas esperaram sozinhas do início ao fim**. ⚠️ A premissa da auditoria estava meio errada: já existe corte em 300s, então call de 40s nunca contou como comparecimento |
| **241** | `vw_funil_por_vendedora` nova. Julho: Mariana 153 conferidas/78,4% · Beatriz 63/84,1% · Emerson 13/69,2%. **% só a partir de 10 calls** — com 4, "75%" e "100%" distam de UMA call |
| **277** | "Salvar", "Gerar PDF e Salvar" e "Enviar para ZapSign" eram 3 azuis-marinho quase iguais empilhados: dava para mandar ao cliente achando que só salvava. O envio ficou separado, no dourado (**7,63:1**, medido) e com ícone |
| **282** | Barra de abas virou grupo de verdade: setas/Home/End + **tabIndex móvel** (o Tab pula 12 paradas e cai no conteúdo) |
| **280** | Busca global: o foco nunca sai do campo, então as setas eram mudas → `combobox` + `aria-activedescendant`. 4 etiquetas com hex claro cravado (retângulos brancos no escuro) → `STATUS_TOKENS` |
| **276** | Os 5 blocos de progresso eram `<div onClick>` (sem foco, sem Enter); rótulo 8px→10px; seções ganharam `aria-expanded` |
| **293** | Portal do cliente era a **única tela sem modo escuro**. ⚠️ 5 `background:#fff` cravados escapariam das variáveis. Contrastes medidos: 13,1 / 7,7 / 5,09 / 8,78 |
| **294** | Coluna vazia do kanban só dizia "Vazio"; 2 iframes sem `title`; link "pular para o conteúdo"; menu de densidade prendia o teclado; **o "Salvo" era `hidden md:flex`** — quem preenche no celular nunca via a confirmação |

**Item 256 (resumo semanal por e-mail) fica FORA** — decisão do Paulo: não quer aviso por e-mail.
SQL novo: `supabase_funil_duracao_e_vendedora.sql`, `supabase_boletos_resumo_item175.sql`.

### ✅ DEPLOYADO 02/08/2026 (noite) — a vigilância que mentia por omissão (143, 145, 148, 59, 106)

**722 testes**, rollback: `./rollback.sh 6a6fd6aeafaf80ac3ada04ed`. Achados cruzando os 357 números da auditoria contra o `git log` — **79 itens nunca tinham sido citados**.

**143 + 145 + 148 são a MESMA doença** e juntos explicam por que o apagão de 16 dias do backup passou:
- **143** — o vigia percorria **quem bateu ponto**, e o heartbeat só nasce quando a function executa: cron que nunca disparou **não existia** para ele. Silêncio absoluto era lido como paz. Agora parte da lista declarativa (`CRON_SLA`) e cobra a ausência.
- **145** — o painel usava **90 min para TODOS**: cron diário ficava "atrasado" 22h30 por dia, o painel vivia em ATENÇÃO e as pessoas pararam de olhar. Mapa extraído para **`_lib/cronSla.mjs`** (fonte única do painel e do vigia) + 6 testes travando os limites.
- **148** — os **23 crons do pg_cron** não apareciam em painel nenhum → bloco novo no Monitor. Banco compartilhado: os 7 jobs de outros sistemas aparecem mas não alarmam aqui.

🚨 **E o painel novo achou um cron falhando em silêncio no primeiro carregamento**: `cleanup-old-logs` dava `ERROR: function cleanup_old_logs() is not unique` **todo dia, com ZERO sucessos**. Causa: `public.cleanup_old_logs()` e `public.cleanup_old_logs(int DEFAULT 90)` são **ambas** chamáveis sem argumento, o que torna a primeira **inalcançável pelo nome**. Ponto de entrada único `cbc_cleanup_logs_diario()` (nada apagado; a `rh.cleanup_old_logs` de outro app ficou intacta). Ao rodar: **1.827 linhas** removidas. Estrago era pequeno (~1 MB) — o problema era o silêncio.

⚠️ **Item 59: o enunciado da auditoria estava exagerado.** Ela diz "padrão de ataque conhecido em Postgres". Conferido: **nenhuma função `SECURITY DEFINER` está sem `search_path`** — as 13 são `SECURITY INVOKER`, sem escalada possível. Sobra higiene de correção. Fixadas as 13 do CBC; **não tocar** nas de extensão (pg_trgm/unaccent em `public`) nem nas de outros apps (`_prest_brl`, `fin_*`, `prest_*`, `rh.*`).

**106** — `setBackfillStatus` era ler-mesclar-regravar e duas escritas concorrentes faziam o "onde parei" **voltar atrás**. 🐛 Achado pior no caminho: **duas functions gravam a MESMA chave `kommo`** (assinatura-send e asaas-sync) — uma apagava a descoberta da outra, inclusive o `bot_id`/`field_id` de que o envio do link de assinatura depende. RPC `bot_config_merge` faz o `||` de jsonb sob o bloqueio de linha. ⚠️ A mescla de jsonb é **rasa**: em `assinatura` (objeto aninhado) a leitura prévia continua necessária; a atomicidade protege as chaves irmãs, que era a colisão real.

SQL: `supabase_crons_visiveis_item143_145_148.sql`, `supabase_search_path_item59.sql` (item 106 no fim do mesmo arquivo).

### ✅ DEPLOYADO 02/08/2026 (noite, 2ª leva) — itens 205, 209 (fatia), 214, 225

**744 testes** (eram 722), rollback: `./rollback.sh 6a6fda208733aad9a735413a`.

- **205 + 209** — a regra de "campos obrigatórios" tinha **duas implementações**: a lista do FormPanel e o `validateChecklist` do App (o portão **real** do envio, e o único caminho do atalho de teclado). ✅ **Conferi antes de mexer: elas concordam hoje** — então não reescrevi um validador que funciona, tornei-o impossível de divergir. Lista → `utils/camposObrigatorios.js`; portão → **`utils/validarContrato.js` (lógica pura, sem React)**. **12 testes comparam os dois conjuntos nos dois sentidos**. ⚠️ Importar `App.jsx` num teste puxa FormPanel com JSX em nível de módulo (`React is not defined`) — por isso a extração é a solução, não um contorno.
- **214** — a ficha do cliente dispara 6 consultas e **todas engoliam a falha**: seção vazia e "não existe" ficavam iguais na tela. Agora a ficha diz o que não carregou. `Promise.allSettled` (uma falha não impede as outras + 1 só atualização de estado).
- **225** — 3 consultas do Monitor contavam sobre amostra cortada. A pior é a **fila do Kommo, que é justamente o que estoura durante um incidente** — quanto pior a situação, mais o painel subcontaria. 📊 Hoje 331/318/163 linhas: **nenhuma trunca ainda, é prevenção**.
- **Item 244 conferido e já estava feito**.
- 📉 **Lint melhorou para 18** (2 imports órfãos sumiram com a extração) — baseline abaixado em `scripts/lint-gate.mjs` **e** no CI.

### ✅ DEPLOYADO 03/08/2026 — os 15 itens que não dependiam de decisão (308-315, 165, 167, 168, 62, 260, 288, 312, 158)

**764 testes** (eram 749), lint no baseline 18, rollback do último: `./rollback.sh 6a707364a16c540a433b6e5b`.

🔎 **Inventário confiável**: os três métodos de saber o que falta (commit / código / guia) **todos enganam** — o guia registra em FAIXAS (`219-227`), commits citam itens não feitos, e código antigo não usa a convenção "item N". O certo é unir os três **expandindo as faixas**: deu **63 pendentes reais** (221/222/223 eram falsos positivos). ⚠️ E **308-315 não são produto** — são qualidade de engenharia; produto começa no **317**.

| Item | O que mudou |
|---|---|
| **308/310/165** | Deploy local usava o `node_modules` da máquina e o CI usava `npm ci`: podiam ser árvores diferentes. Agora `npm ci` (6s). A ajuda documentava um **`--force` que nunca existiu**. Travas eram só de conteúdo → agora barram branch fora das de trabalho e **árvore suja** — e a trava **barrou o próprio deploy seguinte**, porque eu tinha apagado um arquivo sem commitar |
| **311** 🐛 | O teste que faltava revelou **defeito real**: telefone fixo saía `(11) 34567-890`. ⚠️ O teste antigo então reprovou e **estava certo** — com 7 dígitos não dá para saber se é fixo ou celular. Desempate: celular brasileiro começa com 9 |
| **288** 🐛 | `fmtDateBR` só aceita `AAAA-MM-DD` e a maioria dos casos é **timestamp** — daí as 33 chamadas soltas. `fmtData()` novo é tolerante. **O portão de lint pegou um erro meu e sério**: o CobrancaPanel tinha função LOCAL `fmtData` e a conversão reescreveu o corpo dela mesma = **recursão infinita** |
| **260** ⚠️ | **NÃO alterei a canonização.** Medido: das **200 colisões, 199 são o mesmo número com e sem o 9** — mudar quebraria 199 corretas para evitar zero. O problema é a **entrada**: `vw_telefones_suspeitos` acha **609**, sendo 288 com vários telefones no mesmo campo |
| **168** ⚠️ | `/api/version`. A 1ª versão (edge function lendo `COMMIT_REF`) respondeu **tudo nulo**: a Netlify só injeta isso em build que **ela** dispara pelo Git — aqui o deploy sai da CLI. Virou `version.json` gerado no deploy, com `arvore_suja` |
| **312** | 8 travas jurídicas que sobrevivem a um `vitest -u` distraído. ⚠️ 2 asserções minhas nasceram cegas: o contrato tem **100%/38% de CSS** e 10%/1%/50%/75% de cláusulas padrão |
| **158** | `vw_logs_unificados` (4 fontes numa linha) + bloco "Linha do tempo" no Monitor |
| **62** | 4 pares de índices idênticos em `ads_*`; conferido par a par, removidos só os avulsos |
| **313/314/309/315/167** | Dev apontava para o servidor aposentado; `.last-working-deploy` versionado; `npm run assets:webp`; README em `prototipos/`; `.env.example` reescrito como inventário real das ~35 variáveis |

SQL: `supabase_higiene_item62_260.sql` (item 158 no fim).

### ✅ DEPLOYADO 03/08/2026 (tarde) — itens 35, 36, 39, 40 (segurança que não mexe no acesso)

**774 testes**, rollback: `./rollback.sh 6a707433c749e90d42469c95`.

🔑 **Regra de triagem**: dos 10 itens de segurança (31-40), **4 não mudam como ninguém entra no sistema** e foram feitos. Os outros 6 mudam o acesso das pessoas ou exigem a conta Google do Paulo — 31 (primeiro login cria acesso), 32/33 (2FA, trava de tentativas, senha vazada), 34 (sessão em cookie), 37 (migrar o xlsx), 38 (rotacionar a URL do Apps Script).

- **35** — Boletos e Asaas gravavam até 3.000 clientes **com CPF, nome e valor de cobrança** no navegador. O cache em memória (item 188) dá a mesma velocidade e morre com a aba → o `sessionStorage` saiu. ⚠️ As telas ainda **apagam** o que versões anteriores deixaram gravado na máquina.
- **36** — o rascunho (nome/CPF/RG/endereço) sobrevivia ao logout. Apagado no **logout explícito**, nunca na expiração de sessão: sair é decisão, expirar é acidente — apagar de quem só ficou parado destruiria trabalho.
- **39** — o fallback para a chave pública era **mudo** (foi assim que o webhook do ZapSign ficou meses morto). Agora avisa alto, e `exigirChaveDeServidor()` deixa quem não pode degradar falhar com a causa escrita.
- **40** — o `/health` público entregava nomes de serviço, quais estavam fora e o **texto do erro**. Público virou `{status, servicos, fora}`; o detalhe exige a chave. ⚠️ **Os dois consumidores do detalhe foram atualizados junto** — o Monitor e o watchdog, que sem isso gravaria histórico de disponibilidade vazio.

### ✅ DEPLOYADO 03/08/2026 (noite) — itens 287 e 289: uma linguagem de ícone, um sistema de botões

**777 testes**, lint no baseline 18, rollback: `./rollback.sh 6a7131eadb3cfcd41fc115ce`. Escolha do Paulo: fazer os dois por inteiro.

**287 — ícones.** O sistema falava três línguas: Heroicons em 56 arquivos, emoji em 31, SVG próprio em alguns. O argumento não é gosto: **emoji ignora a cor do texto** (nunca acompanha o modo escuro nem o fundo do botão) e o desenho vem do **aparelho** — o mesmo aviso é amarelo no iPhone e cinza no Windows. `components/ui/Ico.jsx` novo: um componente, de-para por **significado** (aviso, ok, troféu), não por desenho. De **130 emojis para 15**.

⚠️ **A simulação salvou o trabalho de novo.** Uma varredura ingênua "tira o emoji" teria **destruído informação em 20 lugares**: `{ok ? '✓' : '✕'}` viraria `{ok ? '' : ''}`, as medalhas do ranking sumiriam, o marcador de fim de semana ficaria vazio. Regra que separou: se o texto restante tem **4+ letras** o emoji era decoração (sai); senão o emoji **era** a informação (vira ícone ou texto). As medalhas viraram troféu + a colocação **escrita** (1º/2º/3º).

🚫 **Não tocado de propósito**: os emojis do **contrato** (`contractHtml.js`) — é o documento que o cliente assina, tem 6 snapshots travando o texto, e mudá-lo é decisão de negócio, não faxina. Também ficaram: comentários de código, o ChangeLog (registro histórico) e a mensagem de boas-vindas do portal, que vai por WhatsApp **ao cliente**.

**289 — botões.** Existia `.btn-primary` (18 arquivos) e, ao lado, **31 botões com a cor navy escrita dentro do elemento**, cada um com altura, raio e texto próprios. Sistema de três tamanhos com propósito (`btn-lg` principal · padrão · `btn-sm` linha de tabela), com o **raio crescendo junto** (raio fixo parece grande demais no botão pequeno e quadrado no grande). Estados desabilitado/`aria-disabled` entraram na classe. Medido na tela: **48 / 36 / 31 px** e raios **12 / 8 / 6**, hierarquia visível de cima para baixo. **28 cores navy cravadas viraram token** — não muda um pixel hoje (o valor é o mesmo nos dois temas), mas elimina a classe de bug que apagou o modo escuro em três telas nesta auditoria.

### 🔍 Auditoria de 357 melhorias — detalhamento por onda

Auditoria completa do sistema (10 análises paralelas + linter oficial do Supabase) gerou **357 melhorias numeradas** em `docs/AUDITORIA_SISTEMA_2026-08-01.md` — **o Paulo se refere aos itens pelo NÚMERO**. ~180 aprovados; execução em ondas. Backup: `backups/20260801_094852_auditoria_ondas`. Estado no fim da sessão: **519 testes** (era 504), build e lint sem regressão (19 erros de lint são pré-existentes).

**Números que estavam ERRADOS na tela e foram corrigidos** (itens 85/219-227/229/254): criado `client/src/utils/supabasePaged.js` — **fonte única de paginação**. ⚠️ REGRA NOVA: `.limit(N)` **não levanta** o teto de 1.000 linhas do PostgREST; toda consulta que pode passar disso usa `fetchAllPaged` com **ORDER BY TOTAL** (última coluna única). Aplicado em 10 telas — o Dashboard dos Sócios calculava inadimplência e receita sobre 1.000 dos ~11 mil boletos (os mais antigos). Fuso: `ymOf()`/`ymdOf()` novos em `utils/format.js` (mês/dia local a partir de string ISO do banco; data-só passa direto) — call das 21h não cai mais no mês seguinte. Leads da Meta agora vêm do espelho **diário** quando existe (`fetchMetaAdsDiarioFunil`), com o mensal como reserva. **`client/vitest.setup.js` fixa TZ=America/Sao_Paulo** (o CI roda em UTC e daria resultado diferente do Mac).

**Banco (aplicado e validado com SET ROLE)**: `supabase_rls_satelites.sql` fechou 7 tabelas que estavam SEM RLS — `cliente_parcelas` (74.674 linhas de PII financeira), `cliente_telefones`, `kommo_pipelines`, `kommo_lead_status`, `resort_alias` e 2 backups. Antes: anon lia **e gravava**; agora: anon = 0 linhas, authenticated = tudo. `supabase_higiene_indices_retencao.sql`: 17 índices novos (o mais importante em `contratos.advbox_lawsuit_id`, que não tinha nenhum), cron `refresh-dashboard-stats` **desagendado** (recalculava uma MV órfã 288×/dia), retenção de logs em `cbc_cleanup_logs_extras()` (06h40 UTC). ⚠️ **NÃO fechar** `cron_heartbeat`, `health_history`, `bot_processed_messages`: as functions escrevem nelas com a chave anon.

**Coisas que nunca funcionaram e foram religadas**: `zapsign-webhook` exigia `SUPABASE_SERVICE_ROLE_KEY` sem fallback → **todo evento de assinatura virava 500 desde sempre** (a "atualização em tempo real" não existia). Mesma causa em `portal-chat`, `portal-nfse`, `kommo-portal-link`; para o chat foi preciso também dar `execute` a anon nas RPCs `chat_cliente_*` (migração `portal_chat_grant_anon_rpcs_cliente`).

**Cobrança de assinatura (item 113, decisão Paulo: e-mail TODO DIA)**: `zapsignService` passou a enviar `reminder_every_n_days: 1` + `date_limit_to_sign` (30d) — ⚠️ só valem na CRIAÇÃO; o `PUT` do ZapSign **não** aceita ligar lembrete em documento já criado. Para os ~51 pendentes existe `zapsign-lembrete-cron.mjs` (09h BRT) usando `POST /api/v1/docs/{token}/resend-notifications-bulk/`, com kill-switch em `bot_config.zapsign_lembrete`, teto diário, `?simular=1` e heartbeat. **O disparo em massa só roda depois do deploy** (o token só existe no Netlify).

**Vigilância (itens 141/142/144/95/96/105)**: +13 crons no `CRON_SLA` do watchdog (o backup diário era vigiado pelo cron ERRADO — `db-backup-cron`, que nunca roda); a checagem `ok===false` passou para ANTES do `continue` (cron fora da lista que falhava todo dia ficava verde); heartbeat do `advbox-monitor` saiu do despachante e foi para o worker; backup passou a aguardar o despacho; fila do Kommo parou de zerar `attempts` (job veneno circulava para sempre).

**Segurança das APIs (13/14/16/17/19/20)**: `_lib/apiAuth.mjs` novo (15 testes) — senha de fábrica publicada no repo deixou de valer, cache das respostas com CPF virou `private, no-store`, comparação em tempo constante, rate limit ligado. ⚠️ **Antes do deploy confirmar `REST_API_KEYS` e `POWERBI_API_KEY` no Netlify**: sem elas o endpoint agora se desativa (503) e o Power BI para.

**Frontend (193-196/203/206)**: a caixa "Não mandar mensagem automática" era herança do ChatGuru e **não bloqueava nada** — agora bloqueia de verdade e o rótulo diz o que faz; Ctrl+S duas vezes não duplica mais contrato (ref em vez de closure velha); ContratosTab ganhou ErrorBoundary (era a única aba sem); tela padrão respeita permissão; `console.log` com CPF/RG do OCR removido (LGPD); listas de e-mail de sócio centralizadas em `utils/acessos.js` (estavam em 6 arquivos).

**Power BI (242-245)**: `supabase_powerbi_view_fix.sql` — `vw_powerbi_contratos` ganhou `arquivado_em`/`ativo` (app e painel fechavam o mês diferente), `data_assinatura_efetiva`/`mes_assinatura` com a mesma cascata do app (**25 assinados sem `signed_at` estavam sumindo** das contagens mensais), ramo "Sem honorário (revisar)" para 0/0 e guarda regex no cast de `dataPrimeiraMensagem` (um texto malformado derrubava a view inteira e travava o refresh). ⚠️ Colunas novas sempre no FIM — o Power BI quebra se alguma some.

**Performance (169/170/174/178/179/184/186)**: `vendor-react` 77,7→57,3 kB gzip (a regra de chunks casava por acidente com `@sentry/react` e `@heroicons/react`); rascunho grava com debounce de 500 ms + `visibilitychange`/`pagehide`; 5 timers do Monitor só consultam com a aba visível; `kommo-queue-worker` de 1 → 3 min (43k → 14k invocações/mês); `_headers` cobre `/portal.html`.

**Dados (122/228)**: webhook do Asaas passou a ter **precedência de status** — evento `OVERDUE` atrasado não "despaga" mais boleto já recebido (contaminava inadimplência e régua); ticket médio conta só contratos COM honorário inicial (era diluído pelos de só-êxito e divergia da aba Tráfego).

**UX (261/262/269-271/284/285)**: modo escuro tinha campo de erro ilegível (texto quase branco sobre rosa quase branco) e anel de foco invisível — os dois corrigidos no `index.css`; `ErrorBoundary` deixou de exibir a mensagem crua do JavaScript; estados vazios pararam de citar nome de coluna do banco. `AdminPanel` agora **confere se a permissão gravou** (antes o admin achava que tinha concedido um acesso que continuou como estava); "Atualizado em" do Sócios era `new Date()` no render (mudava sozinho) e virou a hora da carga real.

**🚨 ACHADO: `ClientFormQR.jsx` está MORTO** — descoberto ao tentar ver a tela no navegador. Ninguém importa `ClientFormLink`/`ClientPublicForm` e nada lê o parâmetro `?clientForm=`: **quem escaneia o QR Code do cadastro cai na tela de login**. As melhorias dos itens 269-271 foram aplicadas mesmo assim (voltam prontas se religar) e há aviso no topo do arquivo. Religar exige decisão: tratar `?clientForm=` ANTES do gate de login, como o portal faz.

**⚠️ Item 216 da auditoria é FALSO POSITIVO** — "filtros salvos se atropelam" não acontece (testado): o JS é single-thread e o segundo timer lê o valor já gravado pelo primeiro. Não mexer em `usePersistedFilters`.

**Robôs e diagnóstico (9/15/156/157/202)**: `_lib/gatilho.mjs` novo (11 testes) — o padrão `isScheduled = ... || req.method === 'GET'` em 6 functions fazia **qualquer acesso pelo navegador disparar o robô** (no `meta-ads-sync`, um backfill de até 36 meses da Graph API, que é cota paga); agora exige o cabeçalho do agendador ou `x-bot-key`. Sourcemaps passam a ser gerados em modo `hidden` e o `deploy.sh` os **apaga antes de subir** (publicá-los entregaria o código-fonte); release do Sentry virou `__BUILD_SHA__` (era `unknown` em todo erro). No FormPanel, um estado de scroll cujo valor ninguém lia forçava re-render de 2.000 linhas a cada rolagem — removido.

**Confiança nos números (197/215/232/234)**: `utils/frescorFontes.js` novo — o funil passa a dizer **de quando são os dados** (lê `cron_heartbeat` numa consulta só) e avisa em âmbar qual fonte parou de sincronizar; percentual de comparecimento agora mostra a amostra e some abaixo de 10 eventos. O rascunho não se perde mais ao logar numa aba já aberta (a "gaveta" mudava e o formulário vazio era gravado por cima). 6 módulos sem uso foram **marcados** como inativos (não apagados — REGRA #1), e os comentários que citavam `supabaseSafe` como se protegesse as consultas foram corrigidos: ele não está ligado a nada.

**Credenciais e filas (103/107/108/128/200/248)**: `tokens-vigia-cron.mjs` novo (08h BRT) confere 1×/dia se a credencial de Kommo/Meta/ZapSign/ADVBOX/Asaas ainda é aceita e manda e-mail antes de o dado sumir da tela — o refresh do Google expirou em 23/07 e a agenda parou sem ninguém saber. `filtroInadimplencia()` virou fonte única do que é "em aberto" (o **relatório não incluía negativação** e subcontava devedores). Limitadores dos portais saíram da memória para o banco; a contagem de mensagens do Kommo parou de truncar em silêncio; o sync de leads ganhou teto de saltos.

**Dinheiro parado e trabalho que dependia do app aberto (117/120/134/155/257)**: `_lib/comCaptura.mjs` novo leva erro não tratado das 6 functions críticas (webhooks, ADVBOX, Drive, comissão, cobrança) para o console do Monitor. O watchdog passou a cobrar **contrato assinado há +3 dias sem cobrança lançada** — a regra achou **3 contratos reais, R$ 9.300, dois parados há mais de 100 dias** (Marcos Antonio Rodrigues, Valeria Aparecida Marques, Fernanda Cristina de Oliveira Evans): precisam de lançamento manual, a régua só olha daqui para frente. O `advbox-sweep-cron` ganhou **backstop do Drive** (após 6h sem ninguém arquivar, sobe o PDF assinado; DOCX seguem no navegador). Vendedor fora do `USER_MAP` deixou de cair silenciosamente no Paulo.

### 🔎 CORREÇÃO IMPORTANTE (02/08/2026, conferido no painel do Netlify)

**A `SUPABASE_SERVICE_ROLE_KEY` ESTÁ configurada.** Este guia afirmava o contrário em vários pontos — está errado. O que **não existe** é a URL: não há `SUPABASE_URL` nem `VITE_SUPABASE_URL` cadastradas no Netlify (as 19 variáveis foram conferidas uma a uma).

Isso muda o diagnóstico de tudo que estava "esperando a service role". A causa real era a URL faltando, e ela derrubava em silêncio todo módulo **sem fallback embutido**:

| Módulo | Efeito real |
|---|---|
| `db-backup-cron` | "supabase env ausente" todo dia desde que existe (2ª camada de backup nunca ligou) |
| `rate-limit` | caía para o limitador **em memória** — o limite compartilhado no banco **nunca funcionou** (`rate_limit_counters` está vazia) |
| `kommo-note` | o cache local de notas já postadas nunca gravou |
| `zapsign-webhook` | client nulo → todo evento virava 500 (a causa era a URL, não a chave) |

`_lib/botDb.mjs` sempre teve a URL como fallback embutido — por isso a maioria das functions funciona. **Corrigido no código**: `_lib/supabaseClient.mjs` ganhou o mesmo fallback, então nada disso depende mais de uma variável que ninguém sabia que faltava. A URL do projeto é pública (já vai no JavaScript do site) — não é segredo.

**`REST_API_KEYS` e `POWERBI_API_KEY` deixaram de ser bloqueio**: conferido no Netlify que `api-rest` e `api-powerbi` tiveram **zero chamadas em 7 dias**. Ninguém as usa (o Power BI lê as views direto com `powerbi_cbc`). Sem as chaves elas ficam desativadas — que é o comportamento seguro e correto.

⚠️ **`RESEND_API_KEY` não existe** — todos os alertas críticos por e-mail (vigia de credenciais, verificação do backup, watchdog) só produzem o sino no app, nunca chegam ao e-mail.

### 🚨 O BACKUP DIÁRIO NUNCA RODOU (descoberto 01/08/2026)

Ao construir a verificação do backup (item 162), a auditoria encontrou no banco:
- `bot_config.backup_status` parado em **17/07/2026, origem "manual"** (o teste de implantação);
- **nenhum** heartbeat `backup-diario` em `cron_heartbeat` — e o worker grava heartbeat tanto no sucesso quanto no erro, logo ele **nunca executou**;
- zero eventos de origem `backup` no log dos últimos 20 dias.

**O escritório está sem backup automático do banco desde 17/07** — acreditando ter backup diário. Causa provável: exatamente o **item 96** corrigido nesta auditoria (o despacho do worker era `fetch` sem `await`, com o erro engolido; a function respondia e encerrava antes do pedido sair). A correção só passa a valer **depois do deploy**.

**⚠️ CORREÇÃO 02/08/2026 — o disparo manual NÃO pode apontar para `backup-diario`.** A Netlify responde **403 a qualquer chamada HTTP externa feita a uma function AGENDADA** (bloqueio na borda, antes do código rodar — nem a chave certa passa). O `?key=` documentado no código nunca funcionou. O caminho manual é chamar o **worker**, que não é agendado:
```bash
curl -X POST "https://contratos-cbc.netlify.app/.netlify/functions/backup-worker-background" -H "x-bot-key: SUA_BOT_PANEL_KEY"
```
Mesma regra vale para qualquer cron: **se precisa ser disparado à mão, a lógica tem de morar num arquivo SEM `schedule`**, com um dispatcher agendado chamando ele (padrão `backup-diario` → `backup-worker-background`, e agora `zapsign-lembrete-cron` → `zapsign-lembrete-worker`).
Depois checar `bot_config.backup_status` (deve ter a data de hoje e `origem: manual`) e, no dia seguinte, o heartbeat `backup-diario`.

**Acentuação das telas (272)**: 185 textos visíveis corrigidos ("Profissao", "Endereco", "Gerar Procuracao", "usuarios autorizados") — inclusive na tela pública do cliente. ⚠️ A convenção "sem acento" do projeto vale para **código e comentário**, nunca para o que o usuário lê. Feito por script com de‑para de ~230 palavras, rodado em **simulação antes de aplicar** — e foi a simulação que pegou duas armadilhas que teriam ido a produção com build verde: (1) o regex de texto JSX casa com **código** (`r.dia >= range.inicio && ...` tem `>` e `<`, e viraria `range.início`, variável inexistente); (2) a passada multilinha atravessa objetos cujos valores são JSX (`SECTION_ICONS = { 'Honorarios': <Icon/> }`) e acentuaria a **chave**, quebrando o lookup em silêncio. `esta` ficou fora do de‑para de propósito (ambíguo: demonstrativo × verbo).

**Rótulos e confirmações (264/267)**: havia 150 `<label>` no projeto e **5 `htmlFor`** — clicar no rótulo não focava o campo, o preenchimento automático piorava e leitor de tela anunciava "campo sem nome". 32 rótulos ligados no FormPanel. ⚠️ Os ids do contratante levam `c${index}-` porque o **mesmo componente renderiza os dois**; id repetido quebraria a associação (o navegador liga tudo ao primeiro), pior que não ter nenhuma. `ConfirmDestructive` ganhou modo simples (`exigirDigitacao={false}`): ação irreversível exige digitar a palavra, ação reversível pede só o clique — acabaram os `confirm()` cinza do navegador nos 4 pontos que o usuário realmente encontra. 🐛 No caminho, achei que o `ConfirmDestructive` global **ignorava o `onCancel` de quem o abriu**; qualquer fluxo que esperasse a resposta ficaria pendurado ao cancelar. Corrigido.

**Importação manual e Esc nos modais (278/298)**: 🐛 os testes do `importContrato.js` acharam um bug real — `Number(v || 0)` **não protege contra texto** (`'abc' || 0` é `'abc'`, e `Number('abc')` é NaN), e NaN entra numa coluna `numeric` do Postgres sem reclamar; dali em diante qualquer soma que inclua a linha vira NaN (receita, ticket médio, projeção). Trocado por um helper `num()` que usa `Number.isFinite`. Conferido: **0 linhas com NaN hoje** — era prevenção. ⚠️ O fluxo normal (`App.jsx`) escapa por acaso, porque lá não há `Number()` e `NaN || 0` dá 0. Mais 18 testes no único caminho em que um contrato entra sem passar por formulário/validação/ZapSign. E `hooks/useModalEscape.js` novo (aplicado em 7 modais): eram 7 de 29 tratando Esc, cada um com sua cópia; o hook ignora `isComposing` (quem digita "ç" passa por composição e ali o Esc é do teclado, não do modal) e usa `stopPropagation` para um Esc não fechar dois modais empilhados.

**Testes onde não havia nenhum (296/297/300)** — **639 testes** (era 560): as 4 funções que mexem em dinheiro só passavam por checagem de sintaxe. Para testá-las sem simular servidor, a **decisão** de cada uma virou lib pura: `_lib/asaasEventos.mjs` (a regra que define se um boleto consta pago ou vencido — inclusive o webhook fora de ordem do item 122) e `_lib/comissaoCalculo.mjs` (janela de apuração dia 20→19, degrau da faixa, promoção aplicável — o resultado vira pagamento e um dia de deslize troca contratos de mês). Mais `botEngine.mjs` (o bot que fala com o cliente) e `kommo.mjs` (as extrações que decidem **para quem** a mensagem vai — id errado põe o link do cliente A na conversa do B, e o Kommo não deixa apagar nota). ⚠️ No `asaas-webhook` o status atual passou a ser lido sempre (1 consulta leve a mais por evento) em troca de decisão uniforme e do status anterior no log. `vitest.config.js` ganhou **piso de cobertura** (37/71/78, o medido com folga) e o CI passou a reprovar se cair. **Padrão a repetir:** para testar function que fala com rede, extrair a decisão para `_lib/` e deixar a function só orquestrando.

**Legibilidade e validação do formulário (274/275/286)**: o dourado da marca reprovava contraste como TEXTO — medido, `#C9A84C` sobre branco dá **2,29:1** e `#B8860B` dá 3,25:1 (mínimo 4,5:1), então números de comissão e do funil ficavam apagados. Token novo **`--cbc-gold-text`** (`#8A6A12` no claro = 5,06:1; `#F4CE46` no escuro = 11,91:1) aplicado em 15 pontos de texto. ⚠️ **Dourado sobre navy não muda** — ali passa (5,09:1) e é a marca; `#8A6A12` sobre navy daria 2,3:1, pior. No formulário, os 5 botões ficavam **desabilitados** com campo faltando e o painel que lista o que falta (com rolagem até o campo, destaque e pulso) nunca rodava porque o clique estava bloqueado — agora têm cara de inativos (`aria-disabled`) mas aceitam o clique. E campo inválido era sinalizado **só por cor**: `.input-error` ganhou símbolo de aviso (SVG embutido; o CSP barra externo e `::after` não funciona em `<input>`), com posição própria para `select` e versão clara no tema escuro, mais 25 `aria-invalid`. Conferido no navegador com o CSS real, nos dois temas. **Item 233 (data de cancelamento) foi deixado de fora de propósito**: existe 1 único contrato cancelado no banco e é um registro de teste — o escritório arquiva, não cancela, e a trilha de auditoria já recupera a data.

**Produtividade e erros na tela (247/265/266)**: `vw_bi_produtividade` contava **tarefa em dobro** quando duas pessoas concluíam juntas — 27.817 tarefas viravam 29.537 linhas (+6,18%, de 1.638 tarefas a quatro mãos). Colunas novas `peso` (=1/n), `responsaveis_na_tarefa`, `credito_compartilhado`, `atribuicao_ambigua`; **`SUM(peso)` bate exato com o espelho**. ⚠️ No Power BI a medida `[Concluídas]` passou de `COUNTROWS` para `SUM(peso)` (já corrigido em `powerbi/gerar_pbip.py`; quem tem o .pbix aberto troca uma linha ou regera) e ganhou `[Participações]` para contar linhas. Junto: "PUBLICAÇÃO TRATADA \<nome\>" creditava por primeiro nome com `LIMIT 1` — com dois colegas homônimos o crédito ia para o primeiro em ordem alfabética sem aviso; agora só atribui quando a correspondência é única. SQL: `supabase_bi_produtividade_peso.sql`. No frontend, 21 pontos mostravam a mensagem crua do banco e 9 usavam o `alert()` do navegador — viraram `friendlyError` + toast (com `console.error` preservando o erro técnico). O `ToastProvider` recriava seu objeto a cada render e envolve o app inteiro (todo consumidor de contexto re-renderizava junto) — agora memoizado.

**UX + engenharia (273/283/290/292/301-307)**: a barra de avisos guardava até 20 e mostrava **só o primeiro** — o × apagava todos (3 assinaturas na mesma hora = 2 avisos nunca lidos); agora o × descarta só o da vez. Erro de login ganhou `role="alert"` + foco e o "olhinho" da senha saiu do `tabIndex={-1}` (só funcionava com mouse). Kanban de Vendas e 18 textos do FormPanel/ImportContratoModal usavam cor **inline** (que o CSS do tema escuro não vence) → tokens `--cbc-*`. **Lint: 42 dos 82 problemas vinham de `client/backups/`** (arquivo morto lintado como vivo) — baseline real é **19 erros**, travado por `scripts/lint-gate.mjs` e pelo CI (erro novo reprova; antes era `|| echo warning`). Edge functions passaram a ser verificadas (`deno check` no CI, esbuild local) — antes não entravam em build, teste nem `node --check`. Raiz ganhou **`npm run verificar`** (testes → build → portão de lint → 114 functions → 2 edge), `.nvmrc` e `engines`. `dependabot.yml` novo + `npm audit` no CI travando só em crítica — ⚠️ `xlsx@0.18.5` tem 2 avisos sem correção no npm, mas ambos exigem **ler** planilha maliciosa e o app só escreve (zero `XLSX.read`). `.gitignore` passou a bloquear `*.xlsx/*.xls/*.csv` (havia planilha com leads reais no histórico — limpar exige force-push, decisão do Paulo). README deixou de ser o template do Vite.

**Funil e dados (230/235/239/246/259)**: a conversão lead→videochamada comparava janelas diferentes (todas as calls ÷ todos os leads) e exibia **24,4%** no lugar de **29,0%** — 1.900 leads anteriores ao registro das calls estavam no denominador; agora só os meses com as duas fontes, e a tela diz de quando vale. O **SLA de 1ª resposta**, medido desde 11/07 e nunca exibido, virou o bloco "Atendimento ao lead" da Saúde do Funil: **75 de 217 leads (34,6%) nunca receberam resposta**. Espelho da Meta ganhou checagem de sanidade do DADO (parado/vazio/buraco/gasto absurdo) porque espelho travado é visualmente idêntico a dia fraco de campanha. `vw_bi_tarefas` ganhou o alias honesto `data_agendada` e passou a usar BRT no "atrasada" (a `vw_bi_carga_atual` já usava — de 21h à meia-noite o mesmo painel dava duas contagens). O acervo de no-show passou a respeitar quem pediu para não ser contatado antes de o disparo de resgate ser ligado. SQL: `supabase_bi_noshow_optout_e_tarefas_fuso.sql`.

**Backup (161/162)**: whitelist 51 → 55 tabelas (`supabase_backup_whitelist_fix.sql`) — entraram `cliente_parcelas` (74.674 parcelas mineradas do Drive, que não vêm de API nenhuma), `cliente_telefones`, `kommo_lead_conversa` e `resort_alias` (dicionário feito à mão). RPC `backup_tabelas_fora()` + aviso no worker impedem que tabela nova fique fora em silêncio. `backup-verificar-cron.mjs` novo (segundas 08h30) confere se o backup saiu de verdade — é ele que pegaria este apagão no primeiro domingo.

**Pendências desta frente**: **rodar o backup manualmente logo após o deploy** (acima); item 1 (chave-mestra no bundle) adiado a pedido do Paulo; confirmar as 2 envs; rodar o disparo do ZapSign pós-deploy; **lançar as 3 cobranças pendentes**; ondas restantes (ver memória `auditoria-357-ondas`).

**Versão em produção: v6.6.x** (última sessão 25/06/2026). Changelog detalhado das últimas sessões abaixo.

### 🕘 Datas "hoje/mês" em UTC → local/BRT (31/07/2026, deploy `6a6d6135`) — EM PRODUÇÃO

Sequela do bug do card "Honorários lançados no mês" (corrigido no mesmo dia com `ymLocal()`): auditoria dos **61 usos** de `toISOString().slice(0,10)`/`split('T')[0]` achou **27 com o mesmo defeito** (janela 21h–24h BRT, quando o dia UTC já é amanhã) — todos corrigidos e deployados. Rollback: `./rollback.sh 6a6d4cfb7f01c7195762ab66`. Backup: `backups/20260731_235120_datas_utc_brt/`. Suíte 504/504 (11 testes novos).

- **Helpers novos**: `ymdLocal()` em `src/utils/format.js` (dia local, irmão do `ymLocal`) e **`_lib/dataBrt.mjs`** (`diaBrt(menosDias)`/`diaBrtDe(instante)`, shift fixo −3h — Brasil sem horário de verão; padrão do `metaTrafego.diaBrt`). Functions usam `diaBrt*`; frontend usa `ymdLocal`.
- **17 fixes frontend** (vencido/mês/min-max/hoje): AsaasPanel 555+1012 ("Recebido no mês" zerava às 21h), BoletosPanel 593, InadimplenciaStrip, CobrancaPanel, RelatorioBoletosModal (default caía no mês seguinte), VendasPanel 360 (promoções), VendasParametrização, LinhaCasoView, FormPanel ×3, ImportContratoModal ×2, App 706 + ContratosTab 88/2181 (**assinatura noturna entrava no ADVBOX com data +1** — signed_at → dia local), kommoResolve (`fmtDateISO` converte timestamp c/ hora p/ dia local; data-só passa direto).
- **10 fixes server** (REGRA #11, runtime é UTC): asaas-webhook 91/110 (payment_date fallback) e **169 (effectiveDate da NF — competência fiscal virava o mês)**, portal-data 400 (cliente via "vencido" 3h cedo; usa `isoDate(nowSP())`), cobranca-disparar/listar (elegibilidade), advbox-create-task (prazo da guia), advbox-sync 328 + advbox-sweep-cron 71 (data de fechamento), portal-feedback (dedup NPS por dia BRT, `gte criado_em hoje+'T00:00:00-03:00'`).
- **34 usos NÃO mexidos de propósito** (auditados como corretos): nomes de arquivo de export, aritmética pura de datas (âncora T12/`Date.UTC`), meia-noite local antes do `toISOString` (BoletosPanel 897, VendasParam 1491), já-BRT (TrafegoPanel `hojeBrt`, `metaTrafego.diaBrt`), fronteiras de janela ±1d inócuas, e **latentes de cron seguro** (snapshot 123, bot-rotina 44, backup 95, regua 48/62/70, monitor 23/274 — só rodam 03h–18h BRT; trocar por `diaBrt()` quando mexer nesses arquivos). Lista completa: memória `datas-utc-auditoria` + relatório no chat de 31/07.
- Teste do kommoResolve que esperava a data UTC de timestamp noturno foi atualizado (era o comportamento bugado codificado no teste) + teste novo travando o dia local. **Sem commit** (padrão das últimas sessões; tree principal na branch `agendamentos-design`).

### 🔢 Funil de vendas — 3 defeitos corrigidos (28/07/2026) — EM PRODUÇÃO

Paulo perguntou se os números do funil do mês estavam certos. **Não estavam**: as 4 etapas de baixo (enviados 82 / assinados 58 / distribuídos 36 / guia 28) conferiam, mas as 3 do topo estavam erradas por três causas independentes. Deploy `6a69409156c2477bd094b0ed`, rollback `./rollback.sh 6a68bee0b06da017bab6a299`. Backups: `backups/20260728_202955_funil_videochamadas_rh/` e `backups/20260728_204906_meta_leads_dupla_contagem/`. Suíte 467/467.

Julho/2026 saiu de **546 leads · CPL R$ 13,81 · 20,5% agendaram · 112 calls** para **371 · R$ 19,63 · 51,5% · 191**.

1. **Corte de 1.000 linhas do PostgREST** (a mais grave). `vw_funil_videochamadas` tem 2.883 linhas e o Dashboard buscava sem `.limit()`/`.range()` → chegava uma fatia arbitrária do heap e o funil exibia 112 agendadas / 87 realizadas no lugar de **191 / 147**. ⚠️ Um `.limit(N)` maior NÃO levanta esse teto (`db-max-rows`) — só paginação resolve. Fonte única nova **`client/src/utils/funilSources.js`** (usada pelo Dashboard E pela Saúde do Funil, que eram cópias já divergentes) pagina as 4 consultas com `.range()`. ⚠️ ORDER BY tem que ser TOTAL: 93 linhas empatam em `scheduled_at`, então cada consulta termina numa coluna única (`event_id`, `lawsuit_id`, `campaign_id`).
2. **Campanhas de VAGA/RH contadas como lead de venda**. A aba Tráfego já as excluía (`isCampanhaRh`, decisão Paulo 16/07) mas o funil não — jul/26 somava 128 currículos de "[VAGA] Advogado". Corrigido em `dashboard/compute.js` e `funnel/funnelCompute.js` importando o MESMO `isCampanhaRh` de `_lib/metaAds.mjs`; o `select` passou a trazer `campaign_name` (não vinha).
3. **Lead de formulário contado em dobro** (afetava o funil E toda a aba Tráfego). `ACTION_LEAD_FORM` SOMAVA `lead` + `leadgen_grouped` + `onsite_conversion.lead_grouped`, mas **`lead` já é o TOTAL** (`lead = onsite_conversion.lead + offsite_conversion.fb_pixel_lead`) e `lead_grouped` é o mesmo pedaço onsite com outro nome. Conferido campanha a campanha: a identidade vale em 100% das linhas com dado. Eram **3.016 leads fantasma em 25 meses** (14.979 → 11.963). `actionsToCounts` agora usa ORDEM DE PREFERÊNCIA, nunca soma. Histórico recalculado pelo `raw` já gravado (migrações `meta_leads_dupla_contagem_backup` + `_fix`): `meta_ads_mensal` 6.787→3.771 (31 linhas), `meta_ads_diario` 3.080→1.561 (260). Backup em `_backup_meta_leads_20260728_mensal`/`_diario`. **`meta_ads_breakdown` não tem coluna `raw`** → só se corrige por re-sync da API (`meta-trafego-sync?backfill=1&dias=N`, GET é livre).

**Semântica que vale saber ao ler o funil** (não são bugs, são escolhas de modelagem):
- A faixa **CONTRATOS** é troca de coorte: dali para baixo são contratos *criados* no mês, não os originados das calls do mês. Por isso não há % naquele degrau. "58 assinados" ≠ "assinamos 58 em julho" — por data de assinatura julho fechou **63**.
- **A régua de comparecimento mudou em jun/2026**: até maio o status vinha da COR da agenda (subjetivo, e existia `fechou`); de junho em diante vem da auditoria do Google Meet (`meet_status` tem precedência na view). Julho: 186 dos 191 via Meet. Não dá para comparar mês a mês direto, e a Saúde do Funil (all-time) mistura as duas réguas.
- 191 eventos = **186 pessoas** (5 remarcações pós-no-show contam 2×).
- Só **1 conta de anúncio** sincroniza (`act_969110338250520`); o BM tem 2. Se a outra rodar algo, fica fora do funil — verificar no Gerenciador.
- `vw_bi_trafego_mensal` (Power BI) é espelho puro e **inclui** campanhas de RH — quem consome filtra.

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
- ⚠️ **A COBRANÇA NÃO É AUTOMÁTICA AO ASSINAR** (este guia afirmava que era — errado, conferido no código em 02/08/2026). Só `asaas-sync.mjs` cria pagamento no Asaas, e **nenhuma function o chama**: ele é acionado apenas por tela (botão **Lançar** na aba Asaas, Boletos e importação). Alguém precisa clicar. Foi essa a causa dos 3 contratos assinados e nunca cobrados (R$ 9.300, um há 125 dias) — ver `relatorios/Cobrancas-nao-lancadas-02-08-2026.pdf`. O watchdog agora cobra esses casos (item 120).
- Boletos+PIX com parcelamento, **NF automática** via `asaas-webhook` (essa sim dispara sozinha, ao receber o pagamento), **régua de cobrança** (`cobranca-regua`)
- ⚠️ Ao lançar, o Asaas **recusa vencimento no passado**: contrato antigo com `dataPrimeiraParcela` vencida precisa de data nova antes (editável na própria linha da aba Asaas).
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
