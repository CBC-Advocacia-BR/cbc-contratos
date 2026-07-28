# Comparecimento/No-show via log de auditoria do Meet — Fase 2 (plano)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos usam checkbox (`- [ ]`).

**Goal:** persistir o status de comparecimento derivado do log de auditoria do Meet em `agenda_videochamadas`, reconciliar dentro da view (Dashboard reflete sozinho), fazer backfill do histórico e manter atualizado por cron diário.

**Architecture:** um cron diário lê `call_ended` do log de auditoria (Admin Reports API, mesmo refresh token da agenda estendido com o escopo do relatório), classifica presença de cliente por `calendar_event_id` e grava colunas `meet_*` em `agenda_videochamadas` via RPC SECURITY DEFINER. A view `vw_funil_videochamadas` passa a expor `status` reconciliado (log vence a cor), então nada muda no frontend.

**Tech Stack:** Netlify Functions (Node 22, `.mjs`), Supabase (Postgres + RPC SECURITY DEFINER), vitest. Spec: `docs/superpowers/specs/2026-07-23-comparecimento-videochamadas-meet-design.md`.

## Global Constraints

- Deploy SÓ via `client/deploy.sh` (nunca `netlify deploy` direto).
- Backup do arquivo antes de editar (REGRA #1): copiar para `backups/YYYYMMDD_HHMMSS_meet_fase2/`.
- Escritas em `agenda_videochamadas` só via RPC `SECURITY DEFINER` + `BOT_RPC_SECRET` (RLS fechada por PII). Helper de chave: `_bot_chave_ok(p_chave)`.
- O sync do Meet **NUNCA escreve a coluna `status`** (essa é a cor, gravada pelo sync da agenda). Só escreve `meet_*`. A reconciliação vive na VIEW.
- **Interno** = participante com e-mail terminando em `@advocaciacbc.com` **OU** `is_external === false`. **Cliente** = qualquer outro (inclui anônimo/telefone).
- **Compareceu** = existe cliente com soma de `duration_seconds` > **300s** (constante `LIMIAR_SEG = 300`).
- A view reconcilia `status = coalesce(meet_status, status)`, guardando só **`excluida`** (evento apagado nunca reentra). A cor **deixa de ser necessária** (decisão Paulo 23/07: a equipe para de colorir). "Negócio fechado" NÃO vem da cor azul — vem do funil de contratos (criado→enviado→assinado). O azul ("fechou") só era contado como "realizada" mesmo, então o log o cobre.
- `getAccessToken` reutilizado de `_lib/googleAgenda.mjs` (mesmo `GOOGLE_OAUTH_REFRESH_TOKEN`, que a Task 0 estende com o escopo do relatório).

---

## Task 0 (PRÉ-REQUISITO MANUAL — Paulo, com auxílio): refresh token com os 2 escopos

Sem isso, o sync retorna 403 (o token atual só tem o escopo da agenda). **Não é código** — é env.

- [ ] No Google Cloud Console, no OAuth client cujo `client_id` está em `GOOGLE_OAUTH_CLIENT_ID`, adicionar `https://developers.google.com/oauthplayground` em **Authorized redirect URIs**. Rotacionar o client secret (foi exposto em chat) e anotar client_id/secret.
- [ ] No OAuth Playground → engrenagem → marcar **"Use your own OAuth credentials"** → colar client_id + client_secret.
- [ ] Step 1 → campo "Input your own scopes" → colar os **dois** escopos separados por espaço:
  `https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/admin.reports.audit.readonly`
  → Authorize APIs → consentir com **paulo@advocaciacbc.com**.
- [ ] Step 2 → "Exchange authorization code for tokens" → copiar o **refresh_token**.
- [ ] Netlify → env do site → setar `GOOGLE_OAUTH_REFRESH_TOKEN` = novo refresh token; `GOOGLE_OAUTH_CLIENT_SECRET` = secret rotacionado. Confirmar `GOOGLE_OAUTH_CLIENT_ID`.
- [ ] Verificar que o sync da agenda continua ok após trocar (o escopo calendar.readonly segue presente).

> Validação de que o token serve: rodar a Task 4 (`?key=…&dias=4`) e conferir `casados > 0`.

---

## Task 1: lógica pura de classificação (`_lib/meetAudit.mjs`)

**Files:**
- Create: `client/netlify/functions/_lib/meetAudit.mjs`
- Test: `client/src/utils/__tests__/meetAudit.test.js`

**Interfaces:**
- Produces:
  - `LIMIAR_SEG = 300`
  - `classifyMeetItems(items: object[]) : Record<string, {participantes:{id:string,interno:boolean,seg:number}[], cliente_seg:number}>` — agrupa `call_ended` por `calendar_event_id`, somando `duration_seconds` por participante; `cliente_seg` = maior soma entre participantes NÃO-internos.
  - `deriveMeetStatus(entry, limiar=LIMIAR_SEG) : 'realizada'|'no_show'` — `realizada` se `entry.cliente_seg > limiar`, senão `no_show`.
  - `INTERNO_RE = /@advocaciacbc\.com$/i`

- [ ] **Step 1: Write the failing test**

```javascript
// client/src/utils/__tests__/meetAudit.test.js
import { describe, it, expect } from 'vitest';
import { classifyMeetItems, deriveMeetStatus } from '../../../netlify/functions/_lib/meetAudit.mjs';

// fixture com o formato REAL do call_ended (parametros name/value|intValue|boolValue)
const mk = (calId, id, ext, seg) => ({
  id: { time: '2026-07-23T12:00:00.000Z' },
  actor: { email: id.includes('@') ? id : undefined },
  events: [{ name: 'call_ended', parameters: [
    { name: 'calendar_event_id', value: calId },
    { name: 'identifier', value: id },
    { name: 'is_external', boolValue: ext },
    { name: 'duration_seconds', intValue: String(seg) },
  ] }],
});

describe('classifyMeetItems + deriveMeetStatus', () => {
  it('cliente externo > 5min => realizada', () => {
    const by = classifyMeetItems([
      mk('EV1', 'marianamaciel@advocaciacbc.com', false, 1500),
      mk('EV1', 'cliente@gmail.com', true, 1188),
    ]);
    expect(by.EV1.cliente_seg).toBe(1188);
    expect(deriveMeetStatus(by.EV1)).toBe('realizada');
  });

  it('só interno => no_show', () => {
    const by = classifyMeetItems([ mk('EV2', 'beatriz@advocaciacbc.com', false, 900) ]);
    expect(by.EV2.cliente_seg).toBe(0);
    expect(deriveMeetStatus(by.EV2)).toBe('no_show');
  });

  it('cliente anônimo (sem email, is_external true) conta como cliente', () => {
    const by = classifyMeetItems([
      mk('EV3', 'emerson@advocaciacbc.com', false, 800),
      { events: [{ name: 'call_ended', parameters: [
        { name: 'calendar_event_id', value: 'EV3' },
        { name: 'identifier', value: 'anon-abc123' },
        { name: 'is_external', boolValue: true },
        { name: 'duration_seconds', intValue: '600' },
      ] }] },
    ]);
    expect(deriveMeetStatus(by.EV3)).toBe('realizada');
  });

  it('cliente < 5min => no_show', () => {
    const by = classifyMeetItems([
      mk('EV4', 'mizael@advocaciacbc.com', false, 1000),
      mk('EV4', 'cliente2@hotmail.com', true, 200),
    ]);
    expect(deriveMeetStatus(by.EV4)).toBe('no_show');
  });

  it('soma múltiplas sessões do mesmo cliente', () => {
    const by = classifyMeetItems([
      mk('EV5', 'cliente3@gmail.com', true, 200),
      mk('EV5', 'cliente3@gmail.com', true, 200),
    ]);
    expect(by.EV5.cliente_seg).toBe(400);
    expect(deriveMeetStatus(by.EV5)).toBe('realizada'); // 400 > 300
  });

  it('ignora item sem calendar_event_id', () => {
    const by = classifyMeetItems([{ events: [{ name: 'call_ended', parameters: [
      { name: 'identifier', value: 'x@y.com' }, { name: 'duration_seconds', intValue: '999' },
    ] }] }]);
    expect(Object.keys(by).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/meetAudit.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Write minimal implementation**

```javascript
// client/netlify/functions/_lib/meetAudit.mjs
// Classificacao de comparecimento/no-show a partir dos eventos call_ended do
// log de auditoria do Meet (Admin Reports API). Modulo PURO (sem rede aqui,
// exceto listMeetCallEnded na Task 2). Interno = @advocaciacbc.com ou is_external=false.
export const LIMIAR_SEG = 300;
export const INTERNO_RE = /@advocaciacbc\.com$/i;

function paramMap(ev) {
  const m = {};
  for (const p of (ev.parameters || [])) {
    m[p.name] = p.value !== undefined ? p.value
      : (p.intValue !== undefined ? p.intValue
      : (p.boolValue !== undefined ? p.boolValue : null));
  }
  return m;
}

/** Agrupa call_ended por calendar_event_id somando duracao por participante. */
export function classifyMeetItems(items) {
  const byCal = {};
  for (const it of (items || [])) {
    for (const ev of (it.events || [])) {
      if (ev.name && ev.name !== 'call_ended') continue;
      const m = paramMap(ev);
      const cal = m['calendar_event_id'];
      if (!cal) continue;
      const id = m['identifier'] || (it.actor && it.actor.email) || 'anon';
      const seg = parseInt(m['duration_seconds'] || 0, 10) || 0;
      const interno = (typeof id === 'string' && INTERNO_RE.test(id)) || m['is_external'] === false;
      const bucket = (byCal[cal] = byCal[cal] || { _p: {} });
      const cur = (bucket._p[id] = bucket._p[id] || { id, interno, seg: 0 });
      cur.seg += seg;
    }
  }
  // consolida: participantes[] + cliente_seg (maior soma entre nao-internos)
  for (const cal of Object.keys(byCal)) {
    const parts = Object.values(byCal[cal]._p);
    const clienteSeg = parts.filter((p) => !p.interno).reduce((a, p) => Math.max(a, p.seg), 0);
    byCal[cal] = { participantes: parts, cliente_seg: clienteSeg };
  }
  return byCal;
}

export function deriveMeetStatus(entry, limiar = LIMIAR_SEG) {
  return entry && entry.cliente_seg > limiar ? 'realizada' : 'no_show';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/meetAudit.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/meetAudit.mjs client/src/utils/__tests__/meetAudit.test.js
git commit -m "feat(meet): logica pura de classificacao comparecimento/no-show (TDD)"
```

---

## Task 2: fetch paginado do log (`listMeetCallEnded`)

**Files:**
- Modify: `client/netlify/functions/_lib/meetAudit.mjs` (append)
- Test: `client/src/utils/__tests__/meetAudit.test.js` (append)

**Interfaces:**
- Consumes: `getAccessToken` de `./googleAgenda.mjs`.
- Produces: `listMeetCallEnded(accessToken:string, startISO:string, endISO?:string) : Promise<object[]>` — pagina `activities.list` (applicationName=meet, eventName=call_ended) e concatena `items`.
- Produces: `REPORTS_URL = 'https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/meet'`

- [ ] **Step 1: Write the failing test** (testa a montagem da URL sem rede real, via fetch stub)

```javascript
// append em meet_audit.test.js
import { buildMeetUrl } from '../../../netlify/functions/_lib/meetAudit.mjs';
describe('buildMeetUrl', () => {
  it('monta a URL com eventName, startTime e pageToken', () => {
    const u = buildMeetUrl('2026-07-20T00:00:00Z', '2026-07-24T00:00:00Z', 'TK');
    expect(u).toContain('/applications/meet');
    expect(u).toContain('eventName=call_ended');
    expect(u).toContain('startTime=2026-07-20T00%3A00%3A00Z');
    expect(u).toContain('endTime=2026-07-24T00%3A00%3A00Z');
    expect(u).toContain('pageToken=TK');
    expect(u).toContain('maxResults=1000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/meetAudit.test.js -t buildMeetUrl`
Expected: FAIL (`buildMeetUrl` não existe).

- [ ] **Step 3: Write minimal implementation** (append em `meetAudit.mjs`)

```javascript
import { getAccessToken } from './googleAgenda.mjs'; // no topo do arquivo, junto aos outros imports/exports

export const REPORTS_URL = 'https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/meet';

export function buildMeetUrl(startISO, endISO, pageToken) {
  const u = new URL(REPORTS_URL);
  u.searchParams.set('eventName', 'call_ended');
  u.searchParams.set('maxResults', '1000');
  if (startISO) u.searchParams.set('startTime', startISO);
  if (endISO) u.searchParams.set('endTime', endISO);
  if (pageToken) u.searchParams.set('pageToken', pageToken);
  return u.toString();
}

/** Pagina todos os call_ended da janela. */
export async function listMeetCallEnded(accessToken, startISO, endISO) {
  const out = [];
  let pageToken = null; let guard = 0;
  do {
    const r = await fetch(buildMeetUrl(startISO, endISO, pageToken), {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (j.error) throw new Error(`meet reports: ${j.error.message || JSON.stringify(j.error)}`);
    out.push(...(j.items || []));
    pageToken = j.nextPageToken || null;
  } while (pageToken && ++guard < 50);
  return out;
}
```
> `getAccessToken` fica re-exportado por conveniência: `export { getAccessToken } from './googleAgenda.mjs';`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/meetAudit.test.js`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/meetAudit.mjs client/src/utils/__tests__/meetAudit.test.js
git commit -m "feat(meet): fetch paginado dos call_ended do log de auditoria"
```

---

## Task 3: migração `meet_auditoria` (colunas + RPC + view)

**Files:**
- Create: `supabase_meet_auditoria.sql` (na raiz, registro da migração)
- Apply: via MCP Supabase `apply_migration` name `meet_auditoria`

**Interfaces:**
- Produces: colunas `meet_conferido_em, meet_cliente_presente, meet_cliente_seg, meet_status, meet_participantes` em `agenda_videochamadas`.
- Produces: RPC `agenda_meet_upsert(p_chave text, p_rows jsonb) returns integer`.
- Produces: `vw_funil_videochamadas` recriada com `status` reconciliado.

- [ ] **Step 1: Escrever o SQL** (`supabase_meet_auditoria.sql`)

```sql
-- Fase 2 comparecimento Meet: colunas derivadas do log de auditoria + RPC + view reconciliada.
alter table agenda_videochamadas
  add column if not exists meet_conferido_em    timestamptz,
  add column if not exists meet_cliente_presente boolean,
  add column if not exists meet_cliente_seg      integer,
  add column if not exists meet_status           text,
  add column if not exists meet_participantes    jsonb;

-- Grava SO as colunas meet_* (nunca toca em status/cor). So atualiza linhas existentes
-- e nunca uma linha 'excluida' (evento apagado fica fora das contagens).
create or replace function public.agenda_meet_upsert(p_chave text, p_rows jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  update agenda_videochamadas a set
    meet_conferido_em    = now(),
    meet_cliente_presente = x.cliente_presente,
    meet_cliente_seg      = x.cliente_seg,
    meet_status           = x.meet_status,
    meet_participantes    = x.participantes
  from jsonb_to_recordset(p_rows) as x(event_id text, cliente_presente boolean,
        cliente_seg integer, meet_status text, participantes jsonb)
  where a.event_id = x.event_id and coalesce(a.status,'') <> 'excluida';
  get diagnostics n = row_count;
  return n;
end $fn$;

-- View reconciliada: log vence a cor, MAS preserva 'excluida' e 'fechou'.
create or replace view public.vw_funil_videochamadas as
select
  event_id,
  vendedora_email,
  case
    when status = 'excluida' then 'excluida'
    else coalesce(meet_status, status)
  end as status,
  status      as status_cor,
  meet_status,
  case when meet_status is not null then 'meet' else 'cor' end as origem_status,
  color_id,
  scheduled_at,
  tem_meet
from agenda_videochamadas;
```

- [ ] **Step 2: Aplicar a migração** (MCP Supabase)

`apply_migration(name='meet_auditoria', query=<conteudo do .sql>)`
Expected: sem erro.

- [ ] **Step 3: Verificar** (MCP `execute_sql`)

```sql
select column_name from information_schema.columns
where table_name='agenda_videochamadas' and column_name like 'meet_%';
select pg_get_viewdef('public.vw_funil_videochamadas'::regclass, true);
```
Expected: 5 colunas meet_*; a view com o CASE.

- [ ] **Step 4: Commit**

```bash
git add supabase_meet_auditoria.sql
git commit -m "feat(meet): migracao colunas meet_* + RPC agenda_meet_upsert + view reconciliada"
```

---

## Task 4: cron diário (`meet-auditoria-sync.mjs`)

**Files:**
- Create: `client/netlify/functions/meet-auditoria-sync.mjs`

**Interfaces:**
- Consumes: `getAccessToken, listMeetCallEnded, classifyMeetItems, deriveMeetStatus` de `_lib/meetAudit.mjs`; `db, logAdvbox` de `_lib/botDb.mjs`.
- HTTP: GET; manual `?key=<BOT_PANEL_KEY>&dias=N`; cron sem key.

- [ ] **Step 1: Implementar**

```javascript
// client/netlify/functions/meet-auditoria-sync.mjs
// Cron de hora em hora: le call_ended do log de auditoria do Meet dos ultimos N dias,
// classifica presenca de cliente por calendar_event_id e grava meet_* em agenda_videochamadas.
// NUNCA escreve 'status' (isso e a cor). Manual: ?key=<BOT_PANEL_KEY>&dias=N (default 1).
// Log silencioso: so registra no Monitor quando houve atualizacao ou erro.
import { db, logAdvbox } from './_lib/botDb.mjs';
import { getAccessToken, listMeetCallEnded, classifyMeetItems, deriveMeetStatus } from './_lib/meetAudit.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';

export default async (req) => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const url = new URL(req.url);
    const manual = url.searchParams.get('key');
    if (manual && manual !== PANEL_KEY) return json({ ok: false, error: 'chave invalida' }, 401);
    const dias = Math.min(parseInt(url.searchParams.get('dias') || '1', 10) || 1, 40);

    const at = await getAccessToken();
    const startISO = new Date(Date.now() - dias * 864e5).toISOString();
    const items = await listMeetCallEnded(at, startISO);
    const byCal = classifyMeetItems(items);

    const rows = Object.entries(byCal).map(([event_id, e]) => ({
      event_id,
      cliente_presente: e.cliente_seg > 300,
      cliente_seg: e.cliente_seg,
      meet_status: deriveMeetStatus(e),
      participantes: e.participantes,
    }));

    let atualizados = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await db.rpc('agenda_meet_upsert', { p_chave: RPC_SECRET, p_rows: rows.slice(i, i + 200) });
      if (error) throw new Error('upsert: ' + error.message);
      atualizados += data || 0;
    }
    if (atualizados > 0) await logAdvbox('meet', 'info', `meet-auditoria: ${atualizados} videochamadas atualizadas de ${rows.length} conferencias (${items.length} call_ended, ${dias}d)`, { items: items.length, conferencias: rows.length, atualizados, dias }).catch(() => {});
    return json({ ok: true, items: items.length, conferencias: rows.length, atualizados });
  } catch (e) {
    await logAdvbox('meet', 'erro', `meet-auditoria falhou: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = { schedule: '0 * * * *' }; // de hora em hora (janela de 1 dia, carga desprezivel)
```

- [ ] **Step 2: Lint**

Run: `cd client && npm run lint -- netlify/functions/meet-auditoria-sync.mjs`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add client/netlify/functions/meet-auditoria-sync.mjs
git commit -m "feat(meet): cron diario meet-auditoria-sync (grava meet_*)"
```

---

## Task 5: backfill do histórico (`meet-auditoria-backfill.mjs`)

**Files:**
- Create: `client/netlify/functions/meet-auditoria-backfill.mjs`

**Interfaces:**
- Consumes: mesmos libs da Task 4. Cursor em `bot_config` chave `meet_backfill_status`.
- HTTP: GET `?key=<BOT_PANEL_KEY>` (dispara/continua). Processa 1 mês por hop e re-dispara até o piso.

**Notas:** retenção do log ~6 meses → alcança ~jan/2026, cobrindo TODO o histórico da agenda (que começa em ~mar/2026). Piso = `2026-03-01`.

- [ ] **Step 1: Implementar**

```javascript
// client/netlify/functions/meet-auditoria-backfill.mjs
// Backfill do comparecimento Meet, 1 mes por hop (chained). Anda de hoje para tras ate o piso.
// Cursor em bot_config.meet_backfill_status. Manual/continuacao: ?key=<BOT_PANEL_KEY>.
import { db, logAdvbox } from './_lib/botDb.mjs';
import { getAccessToken, listMeetCallEnded, classifyMeetItems, deriveMeetStatus } from './_lib/meetAudit.mjs';

const PANEL_KEY = process.env.BOT_PANEL_KEY || '';
const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const PISO_ISO = '2026-03-01T00:00:00.000Z';

async function getCursor() {
  const { data } = await db.from('bot_config').select('value').eq('key', 'meet_backfill_status').maybeSingle();
  return (data && data.value) || null;
}
async function setCursor(v) {
  await db.from('bot_config').upsert({ key: 'meet_backfill_status', value: v }, { onConflict: 'key' });
}

export default async (req) => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const url = new URL(req.url);
    if ((url.searchParams.get('key') || '') !== PANEL_KEY) return json({ ok: false, error: 'chave invalida' }, 401);

    let cur = await getCursor();
    let fim = cur && cur.proximo_fim ? new Date(cur.proximo_fim) : new Date();
    const ini = new Date(fim.getTime() - 31 * 864e5);
    if (fim.getTime() <= new Date(PISO_ISO).getTime()) {
      await setCursor({ ...(cur || {}), done: true, terminado_em: null });
      return json({ ok: true, done: true });
    }

    const at = await getAccessToken();
    const items = await listMeetCallEnded(at, ini.toISOString(), fim.toISOString());
    const byCal = classifyMeetItems(items);
    const rows = Object.entries(byCal).map(([event_id, e]) => ({
      event_id, cliente_presente: e.cliente_seg > 300, cliente_seg: e.cliente_seg,
      meet_status: deriveMeetStatus(e), participantes: e.participantes,
    }));
    let atualizados = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await db.rpc('agenda_meet_upsert', { p_chave: RPC_SECRET, p_rows: rows.slice(i, i + 200) });
      if (error) throw new Error('upsert: ' + error.message);
      atualizados += data || 0;
    }
    const proximo_fim = ini.toISOString();
    await setCursor({ proximo_fim, ultimo_intervalo: [ini.toISOString(), fim.toISOString()], atualizados, done: false });
    await logAdvbox('meet', 'info', `backfill Meet ${ini.toISOString().slice(0,10)}..${fim.toISOString().slice(0,10)}: ${rows.length} conferencias, ${atualizados} atualizadas`, { atualizados }).catch(() => {});

    // re-dispara o proximo hop (fire-and-forget)
    fetch(`${process.env.URL}/.netlify/functions/meet-auditoria-backfill?key=${encodeURIComponent(PANEL_KEY)}`).catch(() => {});
    return json({ ok: true, intervalo: [ini.toISOString(), fim.toISOString()], atualizados, proximo_fim });
  } catch (e) {
    await logAdvbox('meet', 'erro', `backfill Meet falhou: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = {}; // sem cron: so manual/chained
```

- [ ] **Step 2: Lint** — `cd client && npm run lint -- netlify/functions/meet-auditoria-backfill.mjs` → sem erros novos.
- [ ] **Step 3: Commit**

```bash
git add client/netlify/functions/meet-auditoria-backfill.mjs
git commit -m "feat(meet): backfill encadeado do comparecimento (piso mar/2026)"
```

---

## Task 6: incluir Emerson + Mizael nas agendas espelhadas

**Files:**
- Modify: `client/netlify/functions/_lib/googleAgenda.mjs:71`

- [ ] **Step 1: Editar a lista**

De:
```javascript
export const VENDEDORAS = ['beatriz@advocaciacbc.com', 'marianamaciel@advocaciacbc.com'];
```
Para:
```javascript
export const VENDEDORAS = ['beatriz@advocaciacbc.com', 'marianamaciel@advocaciacbc.com', 'emerson@advocaciacbc.com', 'mizael@advocaciacbc.com'];
```

- [ ] **Step 2: Commit**

```bash
git add client/netlify/functions/_lib/googleAgenda.mjs
git commit -m "feat(agenda): espelhar tambem as agendas de Emerson e Mizael"
```

---

## Task 7: deploy + validação em produção

- [ ] **Step 1: Backup dos arquivos tocados** para `backups/YYYYMMDD_HHMMSS_meet_fase2/` (REGRA #1).
- [ ] **Step 2: Rodar a suíte** — `cd client && npx vitest run` → verde.
- [ ] **Step 3: Deploy** — `cd client && ./deploy.sh` (anotar o deploy id p/ rollback).
- [ ] **Step 4: Testar o sync manual** — `GET https://contratos-cbc.netlify.app/.netlify/functions/meet-auditoria-sync?key=<BOT_PANEL_KEY>&dias=4` → esperar `atualizados > 0`.
- [ ] **Step 5: Conferir a reconciliação** (MCP `execute_sql`):

```sql
select status, status_cor, meet_status, origem_status, count(*)
from vw_funil_videochamadas
where scheduled_at >= now() - interval '4 days'
group by 1,2,3,4 order by count(*) desc;
```
Esperar: linhas com `origem_status='meet'` onde `meet_status` preencheu casos antes 'agendada'/sem-cor; `excluida` e `fechou` intactos.

- [ ] **Step 6: Backfill** — `GET .../meet-auditoria-backfill?key=<BOT_PANEL_KEY>` e acompanhar `bot_config.meet_backfill_status` até `done:true`. Depois re-conferir o Dashboard (aba Dashboard, etapas Agendada/Realizada) — o % de comparecimento passa a refletir o log.
- [ ] **Step 7: Rollback documentado** — se algo quebrar: `cd client && ./rollback.sh <deploy_anterior>`; a view volta com `create or replace view ... as select ... status ...` (versão sem CASE) — incluir esse SQL no `supabase_meet_auditoria.sql` como comentário de rollback.

---

## Self-review (cobertura da spec)
- Regra de presença (não-@advocaciacbc.com >5min, anônimo=cliente) → Task 1 (testes). ✅
- Reconciliação log-vence-cor (`coalesce`), protege só `excluida` → Task 3. ✅ Cor aposentada (decisão Paulo 23/07: equipe não colore mais; "negócio fechado" vem do funil de contratos, não do azul — que no código só contava como "realizada").
- Colunas meet_* + RPC só-meet → Task 3. ✅
- Cron diário → Task 4. ✅ · Backfill ~6m → Task 5. ✅
- Emerson + Mizael → Task 6. ✅
- Dashboard sem mudança de frontend (view faz tudo) → Task 3 + validação Task 7. ✅
- Auth (estender OAuth) → Task 0. ✅
