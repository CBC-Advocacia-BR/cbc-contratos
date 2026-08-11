# Aba SDR — Etapa 1: espelho de mensagens e fila

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o sistema saber, a qualquer momento, quem escreveu para o escritório e ainda não foi respondido, e mostrar isso numa aba nova com fila priorizada e cronômetro por conversa.

**Architecture:** O Kommo dispara webhook a cada mensagem; uma função de fundo grava a mensagem no Supabase (`sdr_mensagens`). A aba lê esse espelho, cruza com `kommo_leads` e `agenda_videochamadas`, e monta a fila no navegador com lógica pura e testada. Nenhuma escrita no Kommo e nenhuma escrita no Google nesta etapa: só leitura e espelho.

**Tech Stack:** Netlify Functions (Node 22, `.mjs`), Supabase (Postgres + RLS), React 19 + Vite, Vitest, Tailwind com tokens `--cbc-*`.

## Global Constraints

- **Backup antes de editar** qualquer arquivo em `client/` ou `netlify/functions/`: copiar para `backups/YYYYMMDD_HHMMSS_sdr_etapa1/` (REGRA #1 do projeto).
- **Nunca usar `rm`** em arquivo de projeto.
- **Comentário e nome de variável sem acento**; texto que o usuário lê, com acento.
- **Extensão `.mjs`** para função Netlify; função de fundo tem nome terminando em `-background`.
- **Datas server-side em BRT**: usar `_lib/dataBrt.mjs`, nunca `toISOString().slice(0,10)`.
- **Consulta que pode passar de 1.000 linhas usa `fetchAllPaged`** de `client/src/utils/supabasePaged.js`, com ORDER BY em coluna única.
- **Nenhum arquivo novo acima de ~300 linhas.**
- **Nenhuma função nova pode ser disparada por acesso de navegador**: usar `_lib/gatilho.mjs`.
- Testes rodam com `cd client && npx vitest run <arquivo>`.
- Verificação final do projeto: `npm run verificar` na raiz (testes → build → portão de lint → functions → edge).

---

### Task 1: Tabelas do espelho e do estado do lead

**Files:**
- Create: `supabase_sdr_fase1.sql` (raiz do repositório, é o histórico versionado das migrações)
- Aplicar via MCP `supabase-cbc` → `apply_migration` com nome `sdr_fase1`

**Interfaces:**
- Consumes: nada
- Produces: tabelas `sdr_mensagens`, `sdr_lead_estado`, `sdr_config`; views `vw_sdr_sem_resposta` e `vw_sdr_agenda_dia`

- [ ] **Step 1: Escrever o arquivo da migração**

Criar `supabase_sdr_fase1.sql`:

```sql
-- Aba SDR, etapa 1 (11/08/2026): espelho de mensagens do Kommo + estado do lead.
-- PII: sdr_mensagens guarda texto de conversa. RLS fecha para anon.

create table if not exists sdr_mensagens (
  id             bigserial primary key,
  kommo_msg_id   text unique,              -- idempotencia do webhook
  lead_id        text,
  contact_id     text,
  direcao        text not null check (direcao in ('in','out')),
  autor_id       bigint,                   -- created_by do Kommo; 0/null = robo
  autor_nome     text,
  tipo           text default 'texto',     -- texto|audio|imagem|documento|outro
  texto          text,
  criado_em      timestamptz not null,
  gravado_em     timestamptz not null default now()
);
create index if not exists idx_sdr_msg_lead_tempo on sdr_mensagens (lead_id, criado_em desc);
create index if not exists idx_sdr_msg_contato_tempo on sdr_mensagens (contact_id, criado_em desc);

create table if not exists sdr_lead_estado (
  lead_id        text primary key,
  resort         text,
  situacao_cota  text check (situacao_cota in ('pagando','quitada')),
  valor_pago     numeric,
  titular        text,
  quente         boolean not null default false,
  quente_por     text,
  quente_em      timestamptz,
  estado         text not null default 'novo',
  motivo_descarte text,
  descartado_por text,
  descartado_em  timestamptz,
  dono           text,
  atualizado_em  timestamptz not null default now()
);

create table if not exists sdr_config (
  id             int primary key default 1 check (id = 1),
  grade_inicio   time not null default '08:00',
  grade_fim      time not null default '17:00',
  grade_dias     int[] not null default '{1,2,3,4,5}',
  sla_meta_min   int not null default 30,
  atualizado_por text,
  atualizado_em  timestamptz not null default now()
);
insert into sdr_config (id) values (1) on conflict (id) do nothing;

-- Uma linha por conversa cuja ULTIMA mensagem foi do cliente.
create or replace view vw_sdr_sem_resposta
with (security_invoker = true) as
with ultima as (
  select distinct on (lead_id)
         lead_id, contact_id, direcao, texto, tipo, criado_em
    from sdr_mensagens
   where lead_id is not null
   order by lead_id, criado_em desc
)
select u.lead_id, u.contact_id, u.texto as ultima_mensagem, u.tipo, u.criado_em as ultima_em,
       extract(epoch from (now() - u.criado_em))/60 as min_sem_resposta,
       (now() - u.criado_em) < interval '24 hours' as janela_aberta,
       k.nome, k.telefone, e.resort, e.situacao_cota, e.valor_pago, e.quente, e.estado
  from ultima u
  left join kommo_leads k on k.lead_id = u.lead_id
  left join sdr_lead_estado e on e.lead_id = u.lead_id
 where u.direcao = 'in'
   and coalesce(e.estado,'novo') <> 'descartado';

-- A tabela agenda_videochamadas esta com RLS LIGADA e ZERO policies: quem esta logado
-- le zero linhas dela. As telas atuais so a enxergam por views que rodam com o dono do
-- banco (padrao ja usado em 19 views deste projeto). Esta view segue o mesmo caminho e
-- expoe SO o que a aba precisa: nada do payload cru do Google.
create or replace view vw_sdr_agenda_dia as
select a.event_id, a.scheduled_at, a.vendedora_email, a.cliente_nome, a.telefone,
       a.status, a.meet_status, a.lead_id, a.kommo_match
  from agenda_videochamadas a
 where coalesce(a.status,'') <> 'excluida';
grant select on vw_sdr_agenda_dia to authenticated;

alter table sdr_mensagens   enable row level security;
alter table sdr_lead_estado enable row level security;
alter table sdr_config      enable row level security;

create policy sdr_msg_read    on sdr_mensagens   for select to authenticated using (true);
create policy sdr_estado_all  on sdr_lead_estado for all    to authenticated using (true) with check (true);
create policy sdr_config_read on sdr_config      for select to authenticated using (true);
create policy sdr_config_write on sdr_config     for update to authenticated using (true) with check (true);
```

- [ ] **Step 2: Aplicar a migração**

Usar o MCP `supabase-cbc`, ferramenta `apply_migration`, com `name: "sdr_fase1"` e o SQL acima.

- [ ] **Step 3: Conferir que anon não lê e authenticated lê**

Rodar via MCP `execute_sql`:

```sql
set local role anon;
select count(*) from sdr_mensagens;
```

Esperado: erro de permissão ou 0 linhas. Depois:

```sql
set local role authenticated;
select count(*) from sdr_mensagens;
```

Esperado: `0` sem erro. E, na mesma sessao, conferir que a agenda passou a ser legivel:

```sql
set local role authenticated;
select count(*) from vw_sdr_agenda_dia;
```

Esperado: numero maior que zero (o espelho tem 2.938 eventos). Se vier 0, a view saiu como
`security_invoker` por engano e a aba nao vai enxergar call nenhuma.

- [ ] **Step 4: Commit**

```bash
git add supabase_sdr_fase1.sql
git commit -m "sdr etapa 1: tabelas do espelho de mensagens e estado do lead"
```

---

### Task 2: Ler o payload do webhook do Kommo (lógica pura)

**Files:**
- Create: `client/netlify/functions/_lib/kommoMensagem.mjs`
- Test: `client/netlify/functions/_lib/__tests__/kommoMensagem.test.mjs`

**Interfaces:**
- Consumes: nada
- Produces: `parseMensagemKommo(contentType, raw)` → `{ ok: boolean, msg?: {kommo_msg_id, lead_id, contact_id, direcao, autor_id, autor_nome, tipo, texto, criado_em}, motivo?: string }`

**Contexto que o implementador precisa:** o Kommo manda `add_message` como `application/x-www-form-urlencoded` com chaves aninhadas no formato `message[add][0][...]`. O corpo tem `type` (`incoming`/`outgoing`), `text`, `created_at` (unix em segundos), `entity_id` (o lead), `contact_id`, `author[id]` e `author[name]`. Mensagem de áudio ou imagem chega com `text` vazio e um `attachment[type]`.

- [ ] **Step 1: Escrever o teste que falha**

```javascript
import { describe, it, expect } from 'vitest';
import { parseMensagemKommo } from '../kommoMensagem.mjs';

const form = (o) => new URLSearchParams(o).toString();

describe('parseMensagemKommo', () => {
  it('le uma mensagem recebida do cliente', () => {
    const raw = form({
      'message[add][0][id]': 'abc-123',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': 'Bom dia, quero cancelar minha cota',
      'message[add][0][created_at]': '1754308800',
      'message[add][0][entity_id]': '22337966',
      'message[add][0][contact_id]': '99887766',
      'message[add][0][author][id]': '0',
      'message[add][0][author][name]': 'Eduardo Paleari',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(true);
    expect(r.msg.kommo_msg_id).toBe('abc-123');
    expect(r.msg.direcao).toBe('in');
    expect(r.msg.lead_id).toBe('22337966');
    expect(r.msg.contact_id).toBe('99887766');
    expect(r.msg.texto).toBe('Bom dia, quero cancelar minha cota');
    expect(r.msg.criado_em).toBe('2026-08-04T12:00:00.000Z');
  });

  it('mensagem nossa vira direcao out', () => {
    const raw = form({
      'message[add][0][id]': 'def-456',
      'message[add][0][type]': 'outgoing',
      'message[add][0][text]': 'Ola, tudo bem?',
      'message[add][0][created_at]': '1754308800',
      'message[add][0][entity_id]': '22337966',
      'message[add][0][author][id]': '15297447',
      'message[add][0][author][name]': 'Mariana Beraldo',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.msg.direcao).toBe('out');
    expect(r.msg.autor_id).toBe(15297447);
    expect(r.msg.autor_nome).toBe('Mariana Beraldo');
  });

  it('audio sem texto vira tipo audio, nao mensagem vazia', () => {
    const raw = form({
      'message[add][0][id]': 'ghi-789',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': '',
      'message[add][0][attachment][type]': 'voice',
      'message[add][0][created_at]': '1754308800',
      'message[add][0][entity_id]': '22337966',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(true);
    expect(r.msg.tipo).toBe('audio');
    expect(r.msg.texto).toBe('[Áudio]');
  });

  it('payload sem mensagem devolve motivo, nunca lanca', () => {
    expect(parseMensagemKommo('application/x-www-form-urlencoded', 'foo=bar').ok).toBe(false);
    expect(parseMensagemKommo('application/json', '{}').ok).toBe(false);
    expect(parseMensagemKommo('', '').ok).toBe(false);
  });

  it('mensagem sem lead_id nao entra no espelho', () => {
    const raw = form({
      'message[add][0][id]': 'jkl-000',
      'message[add][0][type]': 'incoming',
      'message[add][0][text]': 'oi',
      'message[add][0][created_at]': '1754308800',
    });
    const r = parseMensagemKommo('application/x-www-form-urlencoded', raw);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/lead/i);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/kommoMensagem.test.mjs`
Expected: FAIL com "Failed to resolve import ... kommoMensagem.mjs"

- [ ] **Step 3: Escrever a implementação mínima**

Criar `client/netlify/functions/_lib/kommoMensagem.mjs`:

```javascript
/**
 * Le o payload do webhook add_message do Kommo e devolve UMA mensagem pronta
 * para o espelho (tabela sdr_mensagens). Modulo PURO: sem rede, sem banco.
 *
 * O Kommo manda form-urlencoded com chaves aninhadas:
 *   message[add][0][id] / [type] / [text] / [created_at] / [entity_id] / [contact_id]
 *   message[add][0][author][id] / [author][name] / [attachment][type]
 */

const TIPO_POR_ANEXO = {
  voice: 'audio', audio: 'audio', picture: 'imagem', file: 'documento', video: 'video',
};
const ROTULO = { audio: '[Áudio]', imagem: '[Imagem]', documento: '[Documento]', video: '[Vídeo]' };

/** @returns {{ok:boolean, msg?:object, motivo?:string}} */
export function parseMensagemKommo(contentType, raw) {
  if (!raw) return { ok: false, motivo: 'corpo vazio' };
  if ((contentType || '').includes('json')) return { ok: false, motivo: 'payload json nao suportado' };

  let p;
  try { p = new URLSearchParams(raw); } catch { return { ok: false, motivo: 'corpo ilegivel' }; }
  const g = (k) => p.get(`message[add][0]${k}`);

  const id = g('[id]');
  const tipoKommo = g('[type]');
  if (!id || !tipoKommo) return { ok: false, motivo: 'sem mensagem no payload' };

  const leadId = g('[entity_id]');
  if (!leadId) return { ok: false, motivo: 'mensagem sem lead' };

  const anexo = g('[attachment][type]');
  const tipo = anexo ? (TIPO_POR_ANEXO[anexo] || 'outro') : 'texto';
  const texto = (g('[text]') || '').trim() || ROTULO[tipo] || '';

  const seg = Number(g('[created_at]'));
  const criadoEm = Number.isFinite(seg) && seg > 0
    ? new Date(seg * 1000).toISOString()
    : new Date().toISOString();

  return {
    ok: true,
    msg: {
      kommo_msg_id: id,
      lead_id: String(leadId),
      contact_id: g('[contact_id]') ? String(g('[contact_id]')) : null,
      direcao: tipoKommo === 'incoming' ? 'in' : 'out',
      autor_id: Number(g('[author][id]')) || null,
      autor_nome: g('[author][name]') || null,
      tipo,
      texto,
      criado_em: criadoEm,
    },
  };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/kommoMensagem.test.mjs`
Expected: PASS, 5 testes

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/kommoMensagem.mjs client/netlify/functions/_lib/__tests__/kommoMensagem.test.mjs
git commit -m "sdr etapa 1: leitura pura do webhook add_message do Kommo"
```

---

### Task 3: Gravar a mensagem no espelho

**Files:**
- Create: `client/netlify/functions/sdr-mensagem-worker-background.mjs`
- Modify: `client/netlify/functions/kommo-advbox-webhook.mjs` (acrescentar o segundo despacho, sem tocar no primeiro)

**Interfaces:**
- Consumes: `parseMensagemKommo` da Task 2; `supa` de `_lib/supabaseClient.mjs`; `logAdvbox` de `_lib/botDb.mjs`
- Produces: linhas em `sdr_mensagens`

**Contexto:** `kommo-advbox-webhook.mjs` hoje repassa o corpo cru para `advbox-bot-worker-background`. O espelho **não pode** depender do bot: se um falhar, o outro continua. Por isso o webhook passa a despachar para os dois, em paralelo, e nenhum despacho pode derrubar o outro.

- [ ] **Step 1: Backup do arquivo que será modificado**

```bash
DIR="backups/$(date +%Y%m%d_%H%M%S)_sdr_etapa1"   # uma variavel: dois $(date) podem cair em segundos diferentes
mkdir -p "$DIR"
cp client/netlify/functions/kommo-advbox-webhook.mjs "$DIR/"
```

- [ ] **Step 2: Escrever o worker**

Criar `client/netlify/functions/sdr-mensagem-worker-background.mjs`:

```javascript
/**
 * Grava no espelho (sdr_mensagens) cada mensagem que o Kommo avisa por webhook.
 * Function de FUNDO: o webhook responde ao Kommo em ~2s e este worker processa depois.
 *
 * Idempotente: sdr_mensagens.kommo_msg_id e unico, entao reentrega do mesmo evento
 * nao duplica. Nunca lanca: erro vira log no console do Monitor (origem 'sdr').
 */
import { parseMensagemKommo } from './_lib/kommoMensagem.mjs';
import { supa } from './_lib/supabaseClient.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

export default async (req) => {
  let body = {};
  try { body = await req.json(); } catch { /* corpo invalido */ }

  const r = parseMensagemKommo(body.contentType, body.raw);
  if (!r.ok) {
    return new Response(JSON.stringify({ ok: true, ignorado: r.motivo }), { status: 200 });
  }
  if (!supa) {
    await logAdvbox('sdr', 'erro', 'espelho sem supabase configurado', { lead: r.msg.lead_id });
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }

  const { error } = await supa
    .from('sdr_mensagens')
    .upsert(r.msg, { onConflict: 'kommo_msg_id', ignoreDuplicates: true });

  if (error) {
    await logAdvbox('sdr', 'erro', 'falha ao gravar mensagem no espelho', {
      lead: r.msg.lead_id, erro: error.message,
    });
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true, lead: r.msg.lead_id }), { status: 200 });
};
```

- [ ] **Step 3: Acrescentar o segundo despacho no webhook**

Em `client/netlify/functions/kommo-advbox-webhook.mjs`, logo **depois** do bloco `try { await fetch(... advbox-bot-worker-background ...) }` existente, acrescentar:

```javascript
  // (sdr etapa 1) o espelho de mensagens NAO pode depender do bot: despacho separado,
  // e a falha de um nunca derruba o outro.
  try {
    await fetch(`${SELF_URL}/.netlify/functions/sdr-mensagem-worker-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, raw }),
    });
  } catch (e) {
    console.error('[kommo-advbox-webhook] falha ao despachar espelho SDR:', e.message);
  }
```

- [ ] **Step 4: Conferir que as duas funções carregam**

Run: `cd client && node --check netlify/functions/sdr-mensagem-worker-background.mjs && node --check netlify/functions/kommo-advbox-webhook.mjs`
Expected: sem saída (sem erro de sintaxe)

- [ ] **Step 5: Rodar a suíte inteira para garantir que nada quebrou**

Run: `cd client && npx vitest run`
Expected: PASS, sem teste novo falhando

- [ ] **Step 6: Commit**

```bash
git add client/netlify/functions/sdr-mensagem-worker-background.mjs client/netlify/functions/kommo-advbox-webhook.mjs
git commit -m "sdr etapa 1: webhook grava mensagem no espelho, em paralelo ao bot"
```

---

### Task 4: Trazer o histórico recente para o espelho

**Files:**
- Create: `client/netlify/functions/sdr-espelho-backfill.mjs`
- Create: `client/netlify/functions/sdr-espelho-worker-background.mjs`

**Interfaces:**
- Consumes: `kommoGet` de `_lib/kommo.mjs`; `supa`; `logAdvbox`; `ehAgendado` de `_lib/gatilho.mjs`
- Produces: linhas em `sdr_mensagens` para leads já existentes

**Contexto que o implementador precisa:** lição registrada em 02/07/2026 — os eventos de chat **não voltam** filtrando por lead; é preciso filtrar por **contato**. O padrão está em `kommo-sla-worker-background.mjs`, que faz exatamente isso:
`/events?filter[type]=incoming_chat_message&filter[entity]=contact&filter[entity_id]=<contactId>&filter[created_at][from]=<unix>&limit=100&page=N`.
Os dois tipos a buscar são `incoming_chat_message` e `outgoing_chat_message`.

- [ ] **Step 1: Escrever o despachante**

Criar `client/netlify/functions/sdr-espelho-backfill.mjs`:

```javascript
/**
 * Despacha o backfill do espelho de mensagens. Sem schedule: e chamado a mao,
 * pelo botao "Run now" do painel da Netlify ou por HTTP com a chave.
 *
 * GET ?key=<BOT_PANEL_KEY>&dias=1..30
 * Padrao do site: function sincrona estoura em ~26s, por isso aqui so despacha.
 */
export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  if (!process.env.BOT_PANEL_KEY || key !== process.env.BOT_PANEL_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'chave invalida' }), { status: 401 });
  }
  const dias = Math.min(Math.max(Number(url.searchParams.get('dias')) || 7, 1), 30);
  const base = process.env.URL || `${url.protocol}//${url.host}`;

  fetch(`${base}/.netlify/functions/sdr-espelho-worker-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dias }),
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true, despachado: { dias } }), { status: 202 });
};
```

- [ ] **Step 2: Escrever o worker**

Criar `client/netlify/functions/sdr-espelho-worker-background.mjs`:

```javascript
/**
 * Backfill do espelho: para cada lead recente do funil Venda, busca os eventos de
 * chat do CONTATO e grava no sdr_mensagens.
 *
 * ATENCAO (licao de 02/07/2026): os events NAO retornam filtrando por lead. So por
 * contato. Mesmo caminho usado pelo kommo-sla-worker-background.
 */
import { kommoGet } from './_lib/kommo.mjs';
import { supa } from './_lib/supabaseClient.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

const PIPELINE_VENDA = 13760367;
const TIPOS = [['incoming_chat_message', 'in'], ['outgoing_chat_message', 'out']];

async function eventosDoContato(contactId, desdeUnix, tipo) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const d = await kommoGet(
      `/events?filter[type]=${tipo}&filter[entity]=contact&filter[entity_id]=${contactId}`
      + `&filter[created_at][from]=${desdeUnix}&limit=100&page=${page}`
    ).catch(() => null);
    const evs = d?._embedded?.events || [];
    out.push(...evs);
    if (evs.length < 100) break;
  }
  return out;
}

export default async (req) => {
  let dias = 7;
  try { ({ dias = 7 } = await req.json()); } catch { /* usa o padrao */ }
  if (!supa) {
    await logAdvbox('sdr', 'erro', 'backfill do espelho sem supabase configurado', {});
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }

  const desdeUnix = Math.floor((Date.now() - dias * 86400000) / 1000);
  const leads = await kommoGet(
    `/leads?filter[pipeline_id]=${PIPELINE_VENDA}&filter[created_at][from]=${desdeUnix}&limit=250&with=contacts`
  ).catch(() => null);
  const lista = leads?._embedded?.leads || [];

  let gravadas = 0;
  for (const lead of lista) {
    const contato = lead?._embedded?.contacts?.[0];
    if (!contato) continue;
    for (const [tipo, direcao] of TIPOS) {
      const evs = await eventosDoContato(contato.id, desdeUnix, tipo);
      const linhas = evs.map((e) => ({
        kommo_msg_id: `ev-${e.id}`,
        lead_id: String(lead.id),
        contact_id: String(contato.id),
        direcao,
        autor_id: Number(e.created_by) || null,
        autor_nome: null,
        tipo: 'texto',
        texto: e?.value_after?.[0]?.message?.text || '',
        criado_em: new Date(Number(e.created_at) * 1000).toISOString(),
      })).filter((l) => l.texto);
      if (!linhas.length) continue;
      const { error } = await supa
        .from('sdr_mensagens')
        .upsert(linhas, { onConflict: 'kommo_msg_id', ignoreDuplicates: true });
      if (!error) gravadas += linhas.length;
    }
  }

  await logAdvbox('sdr', 'info', 'backfill do espelho concluido', { leads: lista.length, gravadas, dias });
  return new Response(JSON.stringify({ ok: true, leads: lista.length, gravadas }), { status: 200 });
};
```

- [ ] **Step 3: Conferir sintaxe**

Run: `cd client && node --check netlify/functions/sdr-espelho-backfill.mjs && node --check netlify/functions/sdr-espelho-worker-background.mjs`
Expected: sem saída

- [ ] **Step 4: Commit**

```bash
git add client/netlify/functions/sdr-espelho-backfill.mjs client/netlify/functions/sdr-espelho-worker-background.mjs
git commit -m "sdr etapa 1: backfill do espelho de mensagens por contato"
```

---

### Task 5: As regras da fila (lógica pura, no navegador)

**Files:**
- Create: `client/src/utils/sdrRegras.js`
- Test: `client/src/utils/__tests__/sdrRegras.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `grupoDoLead(lead, agora)` → `'risco'|'call'|'espera'|'semconvite'|'falta'|null`
  - `ordenarFila(leads, agora)` → array ordenado
  - `janelaAberta(ultimaEntradaISO, agora)` → boolean
  - `minutosSemResposta(ultimaEntradaISO, agora)` → number
  - `fmtEspera(minutos)` → string tipo `'7d 00h'` ou `'04h 53m'`

**Regra de negócio, com o porquê (vem do §1 e §6 do spec):**
a ordem da fila é risco → call → espera → semconvite → falta, e dentro de cada grupo o mais antigo primeiro. `janelaAberta` é falso a partir de 24h contadas da última mensagem **do cliente**: fora dela, a Meta só aceita template.

- [ ] **Step 1: Escrever o teste que falha**

```javascript
import { describe, it, expect } from 'vitest';
import { grupoDoLead, ordenarFila, janelaAberta, minutosSemResposta, fmtEspera } from '../sdrRegras.js';

const AGORA = new Date('2026-08-03T17:05:00-03:00');
const hMenos = (h) => new Date(AGORA.getTime() - h * 3600000).toISOString();

describe('janelaAberta', () => {
  it('aberta antes de 24h', () => expect(janelaAberta(hMenos(23.9), AGORA)).toBe(true));
  it('fechada exatamente em 24h', () => expect(janelaAberta(hMenos(24), AGORA)).toBe(false));
  it('fechada depois de 24h', () => expect(janelaAberta(hMenos(30), AGORA)).toBe(false));
  it('sem data devolve false, nunca lanca', () => expect(janelaAberta(null, AGORA)).toBe(false));
});

describe('minutosSemResposta', () => {
  it('conta em minutos inteiros', () => expect(minutosSemResposta(hMenos(2), AGORA)).toBe(120));
  it('sem data devolve null', () => expect(minutosSemResposta(null, AGORA)).toBe(null));
});

describe('fmtEspera', () => {
  it('abaixo de um dia mostra horas e minutos', () => expect(fmtEspera(293)).toBe('04h 53m'));
  it('acima de um dia mostra dias e horas', () => expect(fmtEspera(10082)).toBe('7d 00h'));
  it('zero e valor invalido nao quebram', () => {
    expect(fmtEspera(0)).toBe('00h 00m');
    expect(fmtEspera(null)).toBe('—');
  });
});

describe('grupoDoLead', () => {
  it('quem pediu remarcar vem antes de tudo', () => {
    expect(grupoDoLead({ pediu_remarcar_em: hMenos(8), call_em: hMenos(-2) }, AGORA)).toBe('risco');
  });
  it('call de hoje sem confirmacao', () => {
    expect(grupoDoLead({ call_em: hMenos(-2), confirmado: false }, AGORA)).toBe('call');
  });
  it('call ja confirmada sai da fila', () => {
    expect(grupoDoLead({ call_em: hMenos(-2), confirmado: true }, AGORA)).toBe(null);
  });
  it('cliente falou por ultimo e ninguem respondeu', () => {
    expect(grupoDoLead({ ultima_em: hMenos(30), ultima_direcao: 'in' }, AGORA)).toBe('espera');
  });
  it('conversou, foi respondido e nunca recebeu convite', () => {
    expect(grupoDoLead({ ultima_em: hMenos(30), ultima_direcao: 'out', total_mensagens: 11 }, AGORA)).toBe('semconvite');
  });
  it('faltou na ultima call', () => {
    expect(grupoDoLead({ faltou_em: hMenos(96) }, AGORA)).toBe('falta');
  });
  it('lead descartado nunca entra na fila', () => {
    expect(grupoDoLead({ estado: 'descartado', ultima_em: hMenos(30), ultima_direcao: 'in' }, AGORA)).toBe(null);
  });
});

describe('ordenarFila', () => {
  it('respeita a ordem dos grupos e, dentro do grupo, o mais antigo primeiro', () => {
    const fila = ordenarFila([
      { id: 'b', ultima_em: hMenos(30), ultima_direcao: 'in' },
      { id: 'c', faltou_em: hMenos(96) },
      { id: 'a', pediu_remarcar_em: hMenos(8) },
      { id: 'd', ultima_em: hMenos(44), ultima_direcao: 'in' },
    ], AGORA);
    expect(fila.map((l) => l.id)).toEqual(['a', 'd', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd client && npx vitest run src/utils/__tests__/sdrRegras.test.js`
Expected: FAIL com "Failed to resolve import ... sdrRegras.js"

- [ ] **Step 3: Escrever a implementação**

Criar `client/src/utils/sdrRegras.js`:

```javascript
/**
 * Regras puras da fila do SDR. Sem React, sem rede, sem Supabase: so decisao.
 *
 * A ordem existe por evidencia, nao por gosto (ver spec §1):
 *  - quem pediu para remarcar tem horario segurado e some as 17h;
 *  - call de hoje sem confirmacao falta 33,9% das vezes contra 18,2%;
 *  - passar de 12h sem resposta derruba o agendamento de ~32% para 21,8%;
 *  - conversa engajada sem convite e o maior vazamento do funil (2.560 casos).
 */

const ORDEM = { risco: 0, call: 1, espera: 2, semconvite: 3, falta: 4 };
const MS_24H = 24 * 3600 * 1000;

const ms = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** A janela da Meta fecha em 24h contadas da ultima mensagem DO CLIENTE. */
export function janelaAberta(ultimaEntradaISO, agora = new Date()) {
  const t = ms(ultimaEntradaISO);
  if (t === null) return false;
  return agora.getTime() - t < MS_24H;
}

export function minutosSemResposta(ultimaEntradaISO, agora = new Date()) {
  const t = ms(ultimaEntradaISO);
  if (t === null) return null;
  return Math.floor((agora.getTime() - t) / 60000);
}

export function fmtEspera(minutos) {
  if (minutos === null || minutos === undefined || !Number.isFinite(minutos)) return '—';
  const d = Math.floor(minutos / 1440);
  const h = Math.floor((minutos % 1440) / 60);
  const m = Math.floor(minutos % 60);
  const dois = (n) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${dois(h)}h` : `${dois(h)}h ${dois(m)}m`;
}

/** @returns {'risco'|'call'|'espera'|'semconvite'|'falta'|null} */
export function grupoDoLead(lead, agora = new Date()) {
  if (!lead || lead.estado === 'descartado') return null;
  if (lead.pediu_remarcar_em) return 'risco';
  if (lead.call_em && !lead.confirmado) return 'call';
  if (lead.call_em && lead.confirmado) return null;
  if (lead.ultima_direcao === 'in' && lead.ultima_em) return 'espera';
  if (lead.ultima_direcao === 'out' && (lead.total_mensagens || 0) >= 4) return 'semconvite';
  if (lead.faltou_em) return 'falta';
  return null;
}

/** Ordena por grupo e, dentro do grupo, do mais antigo para o mais novo. */
export function ordenarFila(leads, agora = new Date()) {
  const carimbo = (l) => ms(l.pediu_remarcar_em) ?? ms(l.ultima_em) ?? ms(l.faltou_em) ?? ms(l.call_em) ?? 0;
  return (leads || [])
    .map((l) => ({ lead: l, grupo: grupoDoLead(l, agora) }))
    .filter((x) => x.grupo)
    .sort((a, b) => (ORDEM[a.grupo] - ORDEM[b.grupo]) || (carimbo(a.lead) - carimbo(b.lead)))
    .map((x) => x.lead);
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd client && npx vitest run src/utils/__tests__/sdrRegras.test.js`
Expected: PASS, 16 testes

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/sdrRegras.js client/src/utils/__tests__/sdrRegras.test.js
git commit -m "sdr etapa 1: regras puras da fila, com teste"
```

---

### Task 6: Leitura dos dados da aba

**Files:**
- Create: `client/src/components/sdr/api.js`

**Interfaces:**
- Consumes: `supabase` de `../../lib/supabase`; `fetchAllPaged` de `../../utils/supabasePaged`
- Produces:
  - `carregarSemResposta()` → array de linhas de `vw_sdr_sem_resposta`
  - `carregarCallsDoDia(diaISO)` → array de `agenda_videochamadas` do dia
  - `carregarMensagens(leadId)` → array de `sdr_mensagens` daquele lead, do mais antigo para o mais novo
  - `descartarLead(leadId, motivo, quem)` → grava em `sdr_lead_estado`

**Contexto:** `vw_sdr_sem_resposta` hoje tem dezenas de linhas, mas o espelho cresce. Toda consulta que pode passar de 1.000 linhas usa `fetchAllPaged` com ORDER BY em coluna única (regra do projeto; o Dashboard já quebrou por causa disso).

- [ ] **Step 1: Escrever o módulo**

Criar `client/src/components/sdr/api.js`:

```javascript
/**
 * Leitura dos dados da aba SDR. So consulta: nenhuma escrita no Kommo e nenhuma
 * escrita no Google nesta etapa.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllPaged } from '../../utils/supabasePaged';

/** Conversas cuja ultima mensagem foi do cliente, da mais antiga para a mais nova.
 *  ATENCAO: fetchAllPaged recebe uma FUNCAO que monta a consulta (ela chama .range()
 *  em cada pagina). E o ORDER BY precisa ser TOTAL, por isso lead_id, que e unico. */
export async function carregarSemResposta() {
  return fetchAllPaged(() =>
    supabase.from('vw_sdr_sem_resposta').select('*').order('lead_id', { ascending: true })
  );
}

/** Calls de um dia (YYYY-MM-DD).
 *  Le a VIEW, nunca a tabela: agenda_videochamadas esta com RLS ligada e sem policy,
 *  entao consultar a tabela direto devolve zero linhas sem erro nenhum. */
export async function carregarCallsDoDia(diaISO) {
  const { data, error } = await supabase
    .from('vw_sdr_agenda_dia')
    .select('event_id, vendedora_email, cliente_nome, scheduled_at, status, meet_status, lead_id, kommo_match')
    .gte('scheduled_at', `${diaISO}T00:00:00-03:00`)
    .lt('scheduled_at', `${diaISO}T23:59:59-03:00`)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Historico de uma conversa, do mais antigo para o mais novo. */
export async function carregarMensagens(leadId) {
  const { data, error } = await supabase
    .from('sdr_mensagens')
    .select('id, direcao, autor_nome, tipo, texto, criado_em')
    .eq('lead_id', String(leadId))
    .order('criado_em', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data || [];
}

/** Descarte exige motivo: e ele que separa lead ruim de lead mal atendido. */
export async function descartarLead(leadId, motivo, quem) {
  if (!motivo) throw new Error('motivo obrigatorio');
  const { error } = await supabase.from('sdr_lead_estado').upsert({
    lead_id: String(leadId),
    estado: 'descartado',
    motivo_descarte: motivo,
    descartado_por: quem || null,
    descartado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'lead_id' });
  if (error) throw error;
}
```

- [ ] **Step 2: Conferir que o módulo compila junto com o build**

Run: `cd client && npx vite build`
Expected: build sem erro (o módulo ainda não é importado por ninguém, então basta não quebrar)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/sdr/api.js
git commit -m "sdr etapa 1: leitura dos dados da aba"
```

---

### Task 7: A aba, com fila e quadro de sem resposta

**Files:**
- Create: `client/src/components/SdrPanel.jsx`
- Create: `client/src/components/sdr/QuadroSemResposta.jsx`
- Create: `client/src/components/sdr/FilaSdr.jsx`

**Interfaces:**
- Consumes: `carregarSemResposta`, `carregarCallsDoDia`, `carregarMensagens` da Task 6; `ordenarFila`, `janelaAberta`, `minutosSemResposta`, `fmtEspera` da Task 5
- Produces: componente `SdrPanel` (export default), usado pela Task 8

**Referência visual:** `prototipos/sdr/index.html`, arranjo 8. Cores só por token `--cbc-*`; nada de hex cravado, senão o modo escuro quebra (já aconteceu três vezes nesta base).

- [ ] **Step 1: Escrever o quadro de sem resposta**

Criar `client/src/components/sdr/QuadroSemResposta.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { janelaAberta, minutosSemResposta, fmtEspera } from '../../utils/sdrRegras';

/** Uma linha por conversa cuja ultima mensagem foi do cliente. A mais antiga no topo. */
export default function QuadroSemResposta({ linhas, onAbrir }) {
  const [, setTique] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTique((n) => n + 1), 60000); // o cronometro anda de minuto em minuto
    return () => clearInterval(t);
  }, []);

  const agora = new Date();
  const ordenadas = [...(linhas || [])].sort(
    (a, b) => new Date(a.ultima_em) - new Date(b.ultima_em)
  );
  const fora = ordenadas.filter((l) => !janelaAberta(l.ultima_em, agora)).length;

  if (!ordenadas.length) {
    return (
      <div className="card p-8 text-center" style={{ color: 'var(--cbc-text-muted)' }}>
        <strong className="block text-lg" style={{ color: 'var(--cbc-text-primary)' }}>Ninguém esperando</strong>
        Todas as conversas abertas já foram respondidas.
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--cbc-border)' }}>
        <h2 className="font-bold">Sem resposta nossa</h2>
        <span className="text-xs" style={{ color: 'var(--cbc-text-muted)' }}>
          {ordenadas.length} conversas, a mais antiga no topo
        </span>
        {fora > 0 && (
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
            {fora} fora da janela de 24h
          </span>
        )}
      </div>
      {ordenadas.map((l) => {
        const min = minutosSemResposta(l.ultima_em, agora);
        const aberta = janelaAberta(l.ultima_em, agora);
        return (
          <button key={l.lead_id} type="button" onClick={() => onAbrir(l)}
            className="w-full text-left grid gap-3 px-4 py-2 border-t hover:bg-[var(--cbc-bg-subtle)]"
            style={{ borderColor: 'var(--cbc-border)', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1.5fr) 110px 96px' }}>
            <span className="font-bold text-sm truncate">{l.nome || `lead ${l.lead_id}`}</span>
            <span className="text-xs truncate" style={{ color: 'var(--cbc-text-muted)' }}>{l.ultima_mensagem}</span>
            <span className="text-sm font-bold text-right tabular-nums"
              style={{ color: min >= 1440 ? 'var(--cbc-danger)' : min >= 720 ? 'var(--cbc-warning)' : 'inherit' }}>
              {fmtEspera(min)}
            </span>
            <span className="text-[11px] font-bold text-center px-2 py-0.5 rounded-full self-center"
              style={aberta
                ? { background: 'var(--cbc-success-bg)', color: 'var(--cbc-success)' }
                : { background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
              {aberta ? 'janela aberta' : 'só template'}
            </span>
          </button>
        );
      })}
      <div className="px-4 py-2 text-[11px] border-t" style={{ borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-muted)' }}>
        O relógio conta desde a última mensagem do cliente. Passando de 24 horas a Meta fecha a janela e só sai template aprovado.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Escrever a fila**

Criar `client/src/components/sdr/FilaSdr.jsx`:

```jsx
import { fmtEspera, minutosSemResposta } from '../../utils/sdrRegras';

const ROTULO = {
  risco: ['pediu remarcar', 'var(--cbc-danger)'],
  call: ['call hoje sem confirmar', 'var(--cbc-warning)'],
  espera: ['esperando resposta', 'var(--cbc-danger)'],
  semconvite: ['nunca foi convidado', 'var(--cbc-gold-text)'],
  falta: ['faltou', 'var(--cbc-text-muted)'],
};

export default function FilaSdr({ leads, grupos, onAbrir }) {
  if (!leads?.length) {
    return (
      <div className="card p-8 text-center" style={{ color: 'var(--cbc-text-muted)' }}>
        <strong className="block text-lg" style={{ color: 'var(--cbc-text-primary)' }}>Fila zerada</strong>
        Nada pendente agora.
      </div>
    );
  }
  const agora = new Date();
  return (
    <div className="card">
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--cbc-border)' }}>
        <h2 className="font-bold">Fila</h2>
        <span className="text-xs" style={{ color: 'var(--cbc-text-muted)' }}>{leads.length} pendências</span>
      </div>
      {leads.map((l) => {
        const [texto, cor] = ROTULO[grupos[l.lead_id]] || ['', 'var(--cbc-text-muted)'];
        const min = minutosSemResposta(l.ultima_em, agora);
        return (
          <button key={l.lead_id} type="button" onClick={() => onAbrir(l)}
            className="w-full text-left grid gap-3 px-4 py-2 border-t hover:bg-[var(--cbc-bg-subtle)]"
            style={{ borderColor: 'var(--cbc-border)', gridTemplateColumns: 'minmax(0,1.4fr) 150px 90px' }}>
            <span className="font-bold text-sm truncate">{l.nome || `lead ${l.lead_id}`}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cor }}>{texto}</span>
            <span className="text-sm font-bold text-right tabular-nums">{fmtEspera(min)}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Escrever a aba**

Criar `client/src/components/SdrPanel.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { carregarSemResposta, carregarCallsDoDia } from './sdr/api';
import { ordenarFila, grupoDoLead } from '../utils/sdrRegras';
import { ymdLocal } from '../utils/format';
import QuadroSemResposta from './sdr/QuadroSemResposta';
import FilaSdr from './sdr/FilaSdr';

export default function SdrPanel() {
  const [linhas, setLinhas] = useState([]);
  const [calls, setCalls] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const hoje = ymdLocal(new Date());
      const [sr, cs] = await Promise.all([carregarSemResposta(), carregarCallsDoDia(hoje)]);
      setLinhas(sr); setCalls(cs);
    } catch (e) {
      setErro('Não consegui carregar a fila. ' + (e?.message || ''));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // a fila junta o espelho de conversas com as calls do dia
  const { fila, grupos } = useMemo(() => {
    const agora = new Date();
    const porLead = new Map();
    linhas.forEach((l) => porLead.set(String(l.lead_id), {
      ...l, ultima_direcao: 'in', total_mensagens: 0,
    }));
    calls.forEach((c) => {
      if (!c.lead_id) return;
      const k = String(c.lead_id);
      porLead.set(k, { ...(porLead.get(k) || { lead_id: k, nome: c.cliente_nome }), call_em: c.scheduled_at, confirmado: false });
    });
    const todos = [...porLead.values()];
    const ordenada = ordenarFila(todos, agora);
    const g = {};
    ordenada.forEach((l) => { g[l.lead_id] = grupoDoLead(l, agora); });
    return { fila: ordenada, grupos: g };
  }, [linhas, calls]);

  if (carregando) return <div className="p-6" style={{ color: 'var(--cbc-text-muted)' }}>Carregando a fila...</div>;

  return (
    <div className="p-4 max-w-[1860px] mx-auto">
      {erro && (
        <div className="mb-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>{erro}</div>
      )}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <FilaSdr leads={fila} grupos={grupos} onAbrir={() => {}} />
        <QuadroSemResposta linhas={linhas} onAbrir={() => {}} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Conferir que o build passa**

Run: `cd client && npx vite build`
Expected: build sem erro

- [ ] **Step 5: Commit**

```bash
git add client/src/components/SdrPanel.jsx client/src/components/sdr/QuadroSemResposta.jsx client/src/components/sdr/FilaSdr.jsx
git commit -m "sdr etapa 1: aba com fila e quadro de conversas sem resposta"
```

---

### Task 8: Ligar a aba no sistema

**Files:**
- Modify: `client/src/App.jsx` (lazy, prefetch, rótulo, ícone, `allowedTabKeys`, render)
- Modify: `client/src/components/AdminPanel.jsx` (a matriz de permissões precisa listar a aba nova)

**Interfaces:**
- Consumes: `SdrPanel` da Task 7
- Produces: aba `sdr` visível para quem tiver `user_permissions.tabs.sdr` e para os sócios

**Contexto:** o gate de aba é `tabAllowed(tab)` em `App.jsx:1238`. Quem não tem `userPerms.tabs` cai numa lista mínima; quem tem, vale `userPerms.tabs[tab]`. A aba **Sócios** e a **Saúde do Funil** usam gate por e-mail (`SOCIOS_EMAILS`). Para o SDR o gate é o normal por permissão, mais os sócios sempre.

- [ ] **Step 1: Backup dos arquivos**

```bash
DIR="backups/$(date +%Y%m%d_%H%M%S)_sdr_aba"
mkdir -p "$DIR"
cp client/src/App.jsx client/src/components/AdminPanel.jsx "$DIR/"
```

- [ ] **Step 2: Registrar a aba no App.jsx**

Cinco pontos, todos em `client/src/App.jsx`:

```javascript
// 1) junto dos outros lazy (perto da linha 47)
const SdrPanel = lazy(() => import('./components/SdrPanel'));

// 2) no mapa de prefetch (perto da linha 60), com o MESMO caminho do lazy
  sdr: () => import('./components/SdrPanel'),

// 3) no mapa de rotulos (perto da linha 149)
  sdr: 'SDR',

// 4) no mapa de icones (perto da linha 172). NAO usar ChatBubbleLeftRightIcon: ja e o
//    icone da aba Bot. Acrescentar QueueListIcon na lista de import do @heroicons/react/24/outline
//    (o bloco de import termina na linha 137) e usar:
  sdr: QueueListIcon,

// 5) em allowedTabKeys (linha 1248), depois de 'funil'
  'sdr',
```

E dentro de `tabAllowed`, antes do `return userPerms.tabs[tab]`:

```javascript
    // sócio sempre ve a aba do SDR: e dele a leitura do funil
    if (tab === 'sdr' && SOCIOS_EMAILS.includes((user?.email || '').toLowerCase())) return true;
```

E no render das abas, junto dos outros `mainTab === '...'`:

```jsx
      ) : mainTab === 'sdr' && tabAllowed('sdr') ? (
        <ErrorBoundary><SdrPanel /></ErrorBoundary>
```

- [ ] **Step 3: Acrescentar a aba na matriz do Admin**

Em `client/src/components/AdminPanel.jsx` existe a lista de abas da matriz de permissões, no formato `{ key, label, Icon }` (a linha do Tráfego está na linha 33). Acrescentar, logo depois dela:

```javascript
  { key: 'sdr', label: 'SDR', Icon: QueueListIcon },
```

E incluir `QueueListIcon` no import de `@heroicons/react/24/outline` do mesmo arquivo.

> Sem este passo o admin não consegue conceder a permissão, e a aba fica invisível para o SDR mesmo estando publicada.

- [ ] **Step 4: Conferir build e lint**

Run: `cd client && npx vite build && npm run lint`
Expected: build sem erro; lint **sem erro novo** (o portão do projeto trava em 18 erros pré-existentes)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd client && npx vitest run`
Expected: PASS, incluindo os testes das tasks 2 e 5

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx client/src/components/AdminPanel.jsx
git commit -m "sdr etapa 1: registrar a aba SDR e a permissao"
```

---

### Task 9: Verificar e publicar

**Files:** nenhum arquivo novo

- [ ] **Step 1: Verificação completa do projeto**

Run: `npm run verificar` (na raiz)
Expected: testes verdes, build ok, portão de lint no baseline, functions e edge functions carregando

- [ ] **Step 2: Publicar**

Run: `cd client && ./deploy.sh`
Expected: deploy concluído; anotar o id do deploy anterior para rollback (`./rollback.sh <id>`)

- [ ] **Step 3: Cadastrar o webhook do espelho no Kommo**

O webhook `add_message` já existe e aponta para `kommo-advbox-webhook`, que agora despacha para os dois destinos. **Nada a fazer no Kommo**, mas conferir no painel: Configurações → Integrações → Webhooks, o evento "Mensagem recebida" continua ativo.

- [ ] **Step 4: Trazer o histórico recente**

Rodar o backfill de 7 dias, pelo botão "Run now" na página da função no painel da Netlify (Logs & metrics → Functions → `sdr-espelho-backfill`) ou por HTTP com a chave:

```bash
curl "https://contratos-cbc.netlify.app/.netlify/functions/sdr-espelho-backfill?key=SUA_BOT_PANEL_KEY&dias=7"
```

Expected: `{"ok":true,"despachado":{"dias":7}}`

> ⚠️ Lembrete registrado no guia: `curl` para função **agendada** sempre dá 403 na borda da Netlify. Esta função não tem `schedule`, justamente por isso.

- [ ] **Step 5: Conferir que o espelho encheu**

Via MCP `supabase-cbc` → `execute_sql`:

```sql
select count(*) mensagens,
       count(distinct lead_id) leads,
       min(criado_em) mais_antiga,
       max(criado_em) mais_nova
  from sdr_mensagens;
select count(*) sem_resposta from vw_sdr_sem_resposta;
```

Expected: `mensagens` maior que zero e `sem_resposta` com um número plausível (em 03/08 eram 10 conversas).

- [ ] **Step 6: Conferir a aba no navegador**

Abrir https://contratos-cbc.netlify.app com um usuário que tenha a permissão, ir na aba SDR e verificar: a fila carrega, o quadro mostra a mais antiga no topo, o cronômetro anda e o selo de janela aparece verde para quem falou há menos de 24h.

- [ ] **Step 7: Mandar uma mensagem de teste**

Mandar uma mensagem de WhatsApp para o número do escritório a partir de um telefone de teste e conferir, em até um minuto, que ela aparece em `sdr_mensagens` e que o lead sobe para o topo do quadro.

---

## O que esta etapa NÃO faz

Fica explícito para não haver surpresa na revisão: nada de agendar, remarcar, cancelar, responder pelo sistema, disparar template, mexer em etapa do Kommo ou calcular lead score. Tudo isso são as etapas 2 a 7 do §15 do spec, cada uma com plano próprio.
