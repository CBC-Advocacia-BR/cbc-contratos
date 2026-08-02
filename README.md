# CBC Contratos

Sistema interno do escritório **CBC Advogados**. Cobre o ciclo completo de um caso:
cadastro do cliente → contrato e procuração → assinatura digital → arquivamento no
Drive → lançamento no CRM jurídico → cobrança → acompanhamento processual → portal do
cliente.

**Produção:** https://contratos-cbc.netlify.app

> Este README é o **ponto de partida** (o que é, como rodar, como subir). O documento de
> referência do dia a dia — decisões, regras de negócio, histórico e armadilhas conhecidas —
> é o [`CLAUDE.md`](CLAUDE.md), e ele tem precedência sobre qualquer descrição genérica daqui.

---

## O que é, em uma frase por parte

| Parte | O que faz | Onde fica |
|---|---|---|
| **App (SPA)** | 13 abas com controle de acesso por usuário: criar contrato, acompanhar, dashboards, cobrança, tráfego pago, monitor, admin | `client/src/` |
| **Funções de servidor** | ~65 funções que falam com ZapSign, ADVBOX, Asaas, Kommo, Meta, Google Drive e DataJud; inclui os robôs agendados | `client/netlify/functions/` |
| **Portal do cliente** | Página pública onde o cliente acompanha o caso e conversa com o escritório | `client/portal.html` |
| **Banco** | PostgreSQL no Supabase, **compartilhado com outros aplicativos do escritório** | migrações em `supabase_*.sql` |

⚠️ O banco é compartilhado. Tabelas com prefixo `teses_`, `calc_`, `penhora_`, `aud_`,
`prest_` e afins **são de outros sistemas** — não mexer. Ver `CLAUDE.md` §8.

---

## Rodar na sua máquina

Precisa de **Node 22 ou superior** (a versão está fixada em `.nvmrc`).

```bash
npm install --prefix client
npm run dev
```

Abre em `http://localhost:5173`. O login é o mesmo da produção (Supabase Auth) — não
existe banco local: o ambiente de desenvolvimento fala com o banco **de verdade**.

### Comandos do dia a dia (todos a partir da raiz)

```bash
npm run verificar
```

Roda os três portões na ordem — testes, build e lint. É o mesmo trio que o CI executa;
se isso passa, o deploy tende a passar.

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o app em modo desenvolvimento |
| `npm test` | Suíte de testes (vitest) |
| `npm run test:coverage` | Testes com relatório de cobertura |
| `npm run build` | Build de produção em `client/dist/` |
| `npm run lint` | ESLint |
| `npm run deploy` | **Deploy em produção** (ver abaixo) |
| `npm run rollback` | Volta ao último deploy que funcionava |

---

## Subir para produção

> **Regra do projeto (incidente de 02/07/2026):** o deploy sai **exclusivamente** pelo
> `client/deploy.sh`. Nunca `netlify deploy` na mão. O script tem travas que abortam se o
> código for uma versão antiga, se as funções do chat sumirem ou se o portal estiver
> incompleto — travas que existem porque a produção já regrediu meses uma vez.

```bash
npm run deploy
```

Se algo der errado depois de subir:

```bash
npm run rollback
```

O identificador do último deploy bom fica em `client/.last-working-deploy`.

---

## Antes de mexer no código

Três regras que não são negociáveis (as demais estão no `CLAUDE.md`):

1. **Nunca apagar arquivo do projeto.** Antes de editar, copie para
   `backups/AAAAMMDD_HHMMSS_motivo/`. Nada de `rm`.
2. **Aprovação antes de alterar.** Liste o que pretende mudar e obtenha o "ok" antes de
   escrever código.
3. **Consulta que pode passar de 1.000 linhas usa paginação de verdade.** O PostgREST corta
   em 1.000 por requisição e `.limit(5000)` **não** levanta esse teto — use
   `utils/supabasePaged.js` (frontend) ou `_lib/paged.mjs` (servidor), sempre com ordenação
   por coluna única. Esse detalhe já fez o painel dos sócios calcular inadimplência sobre
   1.000 de 11.000 boletos.

---

## Credenciais

Nenhuma chave fica no repositório. Todas vivem nas variáveis de ambiente do Netlify
(`ADVBOX_TOKEN`, `ASAAS_API_KEY`, `ZAPSIGN_TOKEN`, `KOMMO_TOKEN`, `META_ADS_TOKEN`,
`BOT_PANEL_KEY`, `BOT_RPC_SECRET`, entre outras). A lista completa, com o que cada uma
faz, está no `CLAUDE.md` §8.

A chave anônima do Supabase **é pública por design** (vai no JavaScript do navegador) — a
proteção dos dados vem das políticas de acesso do banco, não do segredo dessa chave.

---

## Onde procurar quando algo quebra

| Situação | Documento |
|---|---|
| Algo parou em produção | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| Preciso voltar atrás | [`docs/ROLLBACK_PLAYBOOK.md`](docs/ROLLBACK_PLAYBOOK.md) |
| Conferir se o deploy ficou bom | [`docs/SMOKE_CHECKLIST.md`](docs/SMOKE_CHECKLIST.md) |
| "Loga e não carrega" em qualquer app | Runbook de incidente do Supabase (`CLAUDE.md`) |
| Robô parou de rodar | Console da aba **Monitor** no app + `cron_heartbeat` no banco |

**Registros ao vivo:** [build](https://app.netlify.com/projects/contratos-cbc/deploys) ·
[funções](https://app.netlify.com/projects/contratos-cbc/logs/functions) ·
[banco](https://supabase.com/dashboard/project/vygczeepvoyaehfchxko)
