# Agendamentos — Fase 1: Núcleo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o núcleo do agendamento — tabelas, cálculo de horários livres, escrita no Google Agenda e os quatro endpoints — de modo que criar, remarcar e classificar um atendimento já funcione por chamada direta, antes de existir qualquer tela.

**Architecture:** O Google Agenda é a fonte da verdade; o Supabase é espelho e trava de concorrência. Toda conversa com o Google acontece em Netlify Functions, que guardam o token OAuth. A ordem de gravação é sempre **reserva no Postgres → evento no Google**, porque o Google aceita eventos sobrepostos sem reclamar e não serve como trava.

**Tech Stack:** Netlify Functions (Node ESM `.mjs`) · Supabase Postgres · Google Calendar API v3 (OAuth com refresh token) · Vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-agendamentos-design.md`

## Global Constraints

- **O Google Agenda é a fonte da verdade.** O Supabase nunca é dono do agendamento. Se divergir, o Google vence.
- **Ordem obrigatória: reserva no banco → evento no Google.** Nunca o contrário.
- **O token do Google nunca vai ao navegador.** Só as Netlify Functions falam com a API.
- **Falha no envio à Meta nunca bloqueia o agendamento.** Só enfileira em `ads_capi_events` e segue.
- **Testes:** Vitest com `environment: 'node'` e `globals: false` — todo teste importa `{ describe, it, expect }` de `vitest` explicitamente. Nomes de teste em português, como o resto do projeto.
- **Padrão dos arquivos:** ESM `.mjs`, cabeçalho em comentário explicando propósito e quem chama, seguindo `kommo-note.mjs` e `googleAgenda.mjs`.
- **Nenhum arquivo novo acima de ~300 linhas.**
- **Fusos:** tudo gravado em `timestamptz`; conversão só na exibição.
- **Sem aviso de privacidade em nada voltado ao cliente** — decisão registrada do Paulo (spec §11).

## ⚠️ Bloqueio conhecido antes da Task 4

As Tasks 1–3 são independentes do Google e podem ser feitas já. **As Tasks 4–8 só funcionam ao vivo depois que o Paulo fizer duas coisas** (spec §9):

1. Trocar o escopo de `calendar.events.readonly` para `calendar.events` e regerar o refresh token
2. As quatro vendedoras compartilharem a agenda com permissão de *"fazer alterações em eventos"*

Os testes das Tasks 4–8 são **mockados** e passam sem isso. A verificação ao vivo (Task 8, Step 6) fica bloqueada até o Paulo concluir.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase_agendamentos.sql` | **novo** — as três tabelas e a trava de unicidade |
| `client/netlify/functions/_lib/agendaSlots.mjs` | **novo** — cálculo puro de horários livres |
| `client/netlify/functions/_lib/agendaRodizio.mjs` | **novo** — escolha da vendedora, puro |
| `client/netlify/functions/_lib/googleAgenda.mjs` | **modificar** — ganha freebusy e escrita |
| `client/netlify/functions/agenda-slots.mjs` | **novo** — endpoint de horários livres |
| `client/netlify/functions/agenda-criar.mjs` | **novo** — reserva + cria no Google + enfileira CAPI |
| `client/netlify/functions/agenda-status.mjs` | **novo** — grava a cor do resultado |
| `client/netlify/functions/agenda-remarcar.mjs` | **novo** — move o evento |

---

### Task 1: Tabelas e configuração inicial

**Files:**
- Create: `supabase_agendamentos.sql`

**Interfaces:**
- Produces: tabelas `agenda_config`, `agenda_vendedores`, `agenda_agendamentos`; a restrição `agenda_agendamentos_slot_uniq`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase_agendamentos.sql` na raiz de `cbc-contratos/` (mesmo lugar dos outros `supabase_*.sql`):

```sql
-- Agendamentos (Fase 1). Spec: docs/superpowers/specs/2026-07-28-agendamentos-design.md
-- O Google Agenda e a FONTE DA VERDADE. Estas tabelas sao parametro, cadastro e TRAVA.
-- A trava existe porque o Google aceita eventos sobrepostos sem reclamar.

create table if not exists public.agenda_config (
  id                smallint primary key default 1,
  duracao_min       int  not null default 30,
  buffer_min        int  not null default 10,
  antecedencia_min  int  not null default 120,
  janela_dias       int  not null default 14,
  janela_semanal    jsonb not null default
    '{"1":[["09:00","12:00"],["13:30","18:00"]],
      "2":[["09:00","12:00"],["13:30","18:00"]],
      "3":[["09:00","12:00"],["13:30","18:00"]],
      "4":[["09:00","12:00"],["13:30","18:00"]],
      "5":[["09:00","12:00"],["13:30","18:00"]]}'::jsonb,
  lembretes_min     int[] not null default '{1440,60}',
  atualizado_por    text,
  atualizado_em     timestamptz not null default now(),
  constraint agenda_config_linha_unica check (id = 1)
);
comment on column public.agenda_config.janela_semanal is
  'Chave = dia da semana ISO (1=segunda ... 7=domingo). Valor = faixas [inicio,fim] em HH:MM.';

insert into public.agenda_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.agenda_vendedores (
  email       text primary key,
  nome        text not null,
  ativo       boolean not null default true,
  slug        text unique,
  criado_em   timestamptz not null default now()
);
comment on column public.agenda_vendedores.ativo is
  'false = pausada (ferias). Sai do rodizio na hora, sem apagar o link dela.';

insert into public.agenda_vendedores (email, nome, slug) values
  ('beatriz@advocaciacbc.com',       'Beatriz',        'beatriz'),
  ('marianamaciel@advocaciacbc.com', 'Mariana Maciel', 'mariana'),
  ('emerson@advocaciacbc.com',       'Emerson',        'emerson'),
  ('mizael@advocaciacbc.com',        'Mizael',         'mizael')
on conflict (email) do nothing;

create table if not exists public.agenda_agendamentos (
  id                 uuid primary key default gen_random_uuid(),
  vendedor_email     text not null references public.agenda_vendedores(email),
  inicio             timestamptz not null,
  fim                timestamptz not null,
  status             text not null default 'reservado',
  google_event_id    text,
  meet_link          text,
  cliente_nome       text,
  cliente_telefone   text,
  cliente_email      text,
  cliente_cpf        text,
  cliente_cep        text,
  cliente_nascimento date,
  origem             text not null default 'interno',
  link_slug          text,
  criado_por         text,
  kommo_lead_id      text,
  fbp                text,
  fbc                text,
  client_ip          text,
  user_agent         text,
  capi_event_id      text,
  token_remarcacao   text unique,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint agenda_agendamentos_status_ck
    check (status in ('reservado','confirmado','cancelado','remarcado')),
  constraint agenda_agendamentos_origem_ck
    check (origem in ('publico','interno'))
);

-- A TRAVA: um horario, um agendamento. So vale para o que esta vivo.
create unique index if not exists agenda_agendamentos_slot_uniq
  on public.agenda_agendamentos (vendedor_email, inicio)
  where status in ('reservado','confirmado');

create index if not exists agenda_agendamentos_periodo_idx
  on public.agenda_agendamentos (inicio)
  where status in ('reservado','confirmado');

revoke all on public.agenda_config, public.agenda_vendedores,
  public.agenda_agendamentos from anon, authenticated;
```

- [ ] **Step 2: Aplicar no Supabase**

Aplicar o arquivo inteiro via MCP do Supabase (`apply_migration`, nome `agendamentos_fase1`).

- [ ] **Step 3: Verificar que a trava funciona de verdade**

Este é o teste mais importante da Task. Rodar em uma transação que dá rollback:

```sql
begin;
insert into agenda_agendamentos (vendedor_email, inicio, fim, status)
values ('beatriz@advocaciacbc.com', '2099-01-01 10:00+00', '2099-01-01 10:30+00', 'reservado');
-- a segunda TEM que falhar:
insert into agenda_agendamentos (vendedor_email, inicio, fim, status)
values ('beatriz@advocaciacbc.com', '2099-01-01 10:00+00', '2099-01-01 10:30+00', 'reservado');
rollback;
```

Esperado: a segunda inserção falha com `duplicate key value violates unique constraint "agenda_agendamentos_slot_uniq"`. Se ela **passar**, a trava não está funcionando e nada mais deste plano é seguro.

- [ ] **Step 4: Verificar que cancelado libera o horário**

```sql
begin;
insert into agenda_agendamentos (vendedor_email, inicio, fim, status)
values ('beatriz@advocaciacbc.com', '2099-01-02 10:00+00', '2099-01-02 10:30+00', 'cancelado');
insert into agenda_agendamentos (vendedor_email, inicio, fim, status)
values ('beatriz@advocaciacbc.com', '2099-01-02 10:00+00', '2099-01-02 10:30+00', 'reservado');
rollback;
```

Esperado: as duas passam — cancelado não bloqueia o horário.

- [ ] **Step 5: Commit**

```bash
git add supabase_agendamentos.sql
git commit -m "feat(agenda): tabelas de agendamento com trava de concorrencia"
```

---

### Task 2: Cálculo de horários livres

**Files:**
- Create: `client/netlify/functions/_lib/agendaSlots.mjs`
- Test: `client/netlify/functions/_lib/__tests__/agendaSlots.test.mjs`

**Interfaces:**
- Produces: `calcularSlots({ config, ocupacao, agora, ateDias })` → `string[]` de inícios em ISO 8601 UTC.
  - `config`: `{ duracao_min, buffer_min, antecedencia_min, janela_semanal }`
  - `ocupacao`: `[{ inicio: string ISO, fim: string ISO }]`
  - `agora`: `Date`
  - `ateDias`: `number`

- [ ] **Step 1: Escrever os testes que falham**

Criar `client/netlify/functions/_lib/__tests__/agendaSlots.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { calcularSlots } from '../agendaSlots.mjs';

// Quarta-feira, 07/01/2026, 08:00 em Brasilia (UTC-3) = 11:00 UTC
const AGORA = new Date('2026-01-07T11:00:00Z');
const CONFIG = {
  duracao_min: 30,
  buffer_min: 10,
  antecedencia_min: 120,
  janela_semanal: { '3': [['09:00', '12:00']] }, // so quarta, 9h-12h
};

describe('calcularSlots', () => {
  it('gera slots de 30min dentro da janela, respeitando a antecedencia minima', () => {
    // agora = 08:00 BRT, antecedencia 120min => o primeiro valido e 10:00 BRT
    const r = calcularSlots({ config: CONFIG, ocupacao: [], agora: AGORA, ateDias: 1 });
    expect(r).toEqual([
      '2026-01-07T13:00:00.000Z', // 10:00 BRT
      '2026-01-07T13:40:00.000Z', // 10:40 BRT (30 + 10 de buffer)
      '2026-01-07T14:20:00.000Z', // 11:20 BRT
    ]);
  });

  it('nao oferece horario que encavala em compromisso existente', () => {
    const ocupacao = [{ inicio: '2026-01-07T13:00:00Z', fim: '2026-01-07T13:30:00Z' }];
    const r = calcularSlots({ config: CONFIG, ocupacao, agora: AGORA, ateDias: 1 });
    expect(r).not.toContain('2026-01-07T13:00:00.000Z');
    expect(r).toContain('2026-01-07T13:40:00.000Z');
  });

  it('nao oferece slot que ultrapassa o fim da janela', () => {
    // ultimo slot possivel comeca 11:20 BRT e termina 11:50 — 11:40 nao cabe
    const r = calcularSlots({ config: CONFIG, ocupacao: [], agora: AGORA, ateDias: 1 });
    const ultimo = new Date(r[r.length - 1]);
    expect(ultimo.getTime() + 30 * 60000).toBeLessThanOrEqual(
      new Date('2026-01-07T15:00:00Z').getTime()
    );
  });

  it('dia sem janela configurada nao gera slot nenhum', () => {
    const so_segunda = { ...CONFIG, janela_semanal: { '1': [['09:00', '12:00']] } };
    const r = calcularSlots({ config: so_segunda, ocupacao: [], agora: AGORA, ateDias: 1 });
    expect(r).toEqual([]);
  });

  it('ocupacao que cobre a janela inteira zera os slots', () => {
    const ocupacao = [{ inicio: '2026-01-07T12:00:00Z', fim: '2026-01-07T15:00:00Z' }];
    const r = calcularSlots({ config: CONFIG, ocupacao, agora: AGORA, ateDias: 1 });
    expect(r).toEqual([]);
  });

  it('respeita a janela de dias para frente', () => {
    const semanal = { ...CONFIG, janela_semanal: { '3': [['09:00', '12:00']], '4': [['09:00', '10:00']] } };
    const r = calcularSlots({ config: semanal, ocupacao: [], agora: AGORA, ateDias: 2 });
    // inclui quinta (08/01)
    expect(r.some((s) => s.startsWith('2026-01-08'))).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/agendaSlots.test.mjs`
Expected: FAIL — `Failed to resolve import "../agendaSlots.mjs"`

- [ ] **Step 3: Implementar**

Criar `client/netlify/functions/_lib/agendaSlots.mjs`:

```javascript
/**
 * Calculo PURO de horarios livres. Sem rede, sem Supabase — por isso e testavel
 * direto no Vitest. Consumido por agenda-slots.mjs.
 *
 * Regra: para cada dia dentro da janela, gera slots de `duracao_min` espacados de
 * `duracao_min + buffer_min`, dentro das faixas de `janela_semanal`, descartando
 * o que colide com `ocupacao` ou fere a antecedencia minima.
 *
 * Tudo em UTC internamente. A janela_semanal e expressa em horario de Brasilia.
 */

const TZ_OFFSET_MIN = -180; // America/Sao_Paulo, sem horario de verao desde 2019

/** Converte 'HH:MM' de Brasilia num Date UTC para o dia informado. */
function horaBrasiliaParaUtc(diaUtc, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(diaUtc);
  d.setUTCHours(h, m, 0, 0);
  return new Date(d.getTime() - TZ_OFFSET_MIN * 60000);
}

/** Dia da semana ISO (1=segunda .. 7=domingo) no fuso de Brasilia. */
function diaSemanaBrasilia(dataUtc) {
  const local = new Date(dataUtc.getTime() + TZ_OFFSET_MIN * 60000);
  const dow = local.getUTCDay(); // 0=domingo
  return dow === 0 ? 7 : dow;
}

function colide(inicio, fim, ocupacao) {
  return ocupacao.some((o) => {
    const oi = new Date(o.inicio).getTime();
    const of = new Date(o.fim).getTime();
    return inicio.getTime() < of && fim.getTime() > oi;
  });
}

export function calcularSlots({ config, ocupacao = [], agora, ateDias }) {
  const duracao = config.duracao_min * 60000;
  const passo = (config.duracao_min + config.buffer_min) * 60000;
  const minimo = new Date(agora.getTime() + config.antecedencia_min * 60000);
  const out = [];

  for (let d = 0; d < ateDias; d++) {
    const dia = new Date(agora.getTime() + d * 86400000);
    const faixas = config.janela_semanal[String(diaSemanaBrasilia(dia))] || [];

    for (const [de, ate] of faixas) {
      const abre = horaBrasiliaParaUtc(dia, de);
      const fecha = horaBrasiliaParaUtc(dia, ate);

      for (let t = abre.getTime(); t + duracao <= fecha.getTime(); t += passo) {
        const inicio = new Date(t);
        const fim = new Date(t + duracao);
        if (inicio < minimo) continue;
        if (colide(inicio, fim, ocupacao)) continue;
        out.push(inicio.toISOString());
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/agendaSlots.test.mjs`
Expected: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/agendaSlots.mjs client/netlify/functions/_lib/__tests__/agendaSlots.test.mjs
git commit -m "feat(agenda): calculo puro de horarios livres com testes"
```

---

### Task 3: Escolha da vendedora (rodízio)

**Files:**
- Create: `client/netlify/functions/_lib/agendaRodizio.mjs`
- Test: `client/netlify/functions/_lib/__tests__/agendaRodizio.test.mjs`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `escolherVendedora({ candidatas, preferida, contagemRecente })` → `string` (e-mail) ou `null`.
  - `candidatas`: `string[]` de e-mails livres naquele horário e com `ativo = true`
  - `preferida`: `string | null` — e-mail da dona do link direcionado
  - `contagemRecente`: `{ [email]: number }` — quantos agendamentos cada uma já tem no período

- [ ] **Step 1: Escrever os testes que falham**

Criar `client/netlify/functions/_lib/__tests__/agendaRodizio.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { escolherVendedora } from '../agendaRodizio.mjs';

describe('escolherVendedora', () => {
  it('usa a preferida quando ela esta entre as candidatas', () => {
    const r = escolherVendedora({
      candidatas: ['a@x.com', 'b@x.com'],
      preferida: 'b@x.com',
      contagemRecente: { 'a@x.com': 0, 'b@x.com': 99 },
    });
    expect(r).toBe('b@x.com');
  });

  it('cai para o rodizio quando a preferida nao tem horario', () => {
    const r = escolherVendedora({
      candidatas: ['a@x.com', 'c@x.com'],
      preferida: 'b@x.com',
      contagemRecente: { 'a@x.com': 5, 'c@x.com': 2 },
    });
    expect(r).toBe('c@x.com'); // menor carga
  });

  it('distribui para quem tem menos agendamentos', () => {
    const r = escolherVendedora({
      candidatas: ['a@x.com', 'b@x.com', 'c@x.com'],
      preferida: null,
      contagemRecente: { 'a@x.com': 3, 'b@x.com': 1, 'c@x.com': 7 },
    });
    expect(r).toBe('b@x.com');
  });

  it('desempata de forma estavel pelo e-mail', () => {
    const r = escolherVendedora({
      candidatas: ['z@x.com', 'a@x.com'],
      preferida: null,
      contagemRecente: { 'z@x.com': 2, 'a@x.com': 2 },
    });
    expect(r).toBe('a@x.com');
  });

  it('sem candidatas devolve null', () => {
    expect(escolherVendedora({ candidatas: [], preferida: 'b@x.com', contagemRecente: {} })).toBeNull();
  });

  it('trata vendedora sem contagem como zero', () => {
    const r = escolherVendedora({
      candidatas: ['a@x.com', 'nova@x.com'],
      preferida: null,
      contagemRecente: { 'a@x.com': 4 },
    });
    expect(r).toBe('nova@x.com');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/agendaRodizio.test.mjs`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

Criar `client/netlify/functions/_lib/agendaRodizio.mjs`:

```javascript
/**
 * Escolha PURA da vendedora. Consumido por agenda-criar.mjs.
 *
 * Decisao do Paulo (28/07/2026): SEM peso. O link generico distribui igual entre
 * as ativas; a priorizacao acontece so pelo link direcionado (julgamento humano).
 * Para equilibrar de fato, "igual" aqui significa MENOR CARGA no periodo — nao
 * sorteio, que concentraria por azar.
 */

export function escolherVendedora({ candidatas = [], preferida = null, contagemRecente = {} }) {
  if (!candidatas.length) return null;
  if (preferida && candidatas.includes(preferida)) return preferida;

  return [...candidatas].sort((a, b) => {
    const ca = contagemRecente[a] ?? 0;
    const cb = contagemRecente[b] ?? 0;
    if (ca !== cb) return ca - cb;
    return a.localeCompare(b); // desempate estavel
  })[0];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/agendaRodizio.test.mjs`
Expected: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add client/netlify/functions/_lib/agendaRodizio.mjs client/netlify/functions/_lib/__tests__/agendaRodizio.test.mjs
git commit -m "feat(agenda): escolha da vendedora por menor carga com testes"
```

---

### Task 4: Escrita no Google Agenda

**Files:**
- Modify: `client/netlify/functions/_lib/googleAgenda.mjs`
- Test: `client/netlify/functions/_lib/__tests__/googleAgendaPayload.test.mjs`

**Interfaces:**
- Consumes: `getAccessToken()` já existente no mesmo arquivo.
- Produces:
  - `montarEventoPayload({ inicio, fim, clienteNome, clienteEmail, clienteTelefone })` → objeto do corpo da requisição (puro, testável)
  - `freeBusy(calendarIds, timeMin, timeMax, accessToken)` → `{ [calendarId]: [{inicio, fim}] }`
  - `criarEvento(calendarId, payload, accessToken)` → `{ id, hangoutLink }`
  - `moverEvento(calendarId, eventId, destinoCalendarId, accessToken)` → `{ id }`
  - `definirCor(calendarId, eventId, colorId, accessToken)` → `void`
  - `remarcarEvento(calendarId, eventId, inicio, fim, accessToken)` → `void`

> **Atenção:** `VENDEDORAS` e as funções existentes (`getAccessToken`, `listEvents`, `classifyEvent`) **não podem ser alteradas** — `agenda-videochamadas-sync.mjs` depende delas.

- [ ] **Step 1: Escrever o teste do payload (a parte pura)**

Criar `client/netlify/functions/_lib/__tests__/googleAgendaPayload.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { montarEventoPayload } from '../googleAgenda.mjs';

describe('montarEventoPayload', () => {
  const base = {
    inicio: '2026-01-07T13:00:00.000Z',
    fim: '2026-01-07T13:30:00.000Z',
    clienteNome: 'Maria Silva',
    clienteEmail: 'maria@exemplo.com',
  };

  it('poe o cliente como convidado', () => {
    const p = montarEventoPayload(base);
    expect(p.attendees).toEqual([{ email: 'maria@exemplo.com' }]);
  });

  it('pede a criacao de um Meet', () => {
    const p = montarEventoPayload(base);
    expect(p.conferenceData.createRequest).toBeTruthy();
    expect(p.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
  });

  it('NAO define cor — colorId nulo e o status "agendada" do funil', () => {
    const p = montarEventoPayload(base);
    expect(p.colorId).toBeUndefined();
  });

  it('usa o padrao "Nome +telefone" no titulo, igual aos eventos manuais', () => {
    const p = montarEventoPayload({ ...base, clienteTelefone: '5511999998888' });
    expect(p.summary).toBe('Maria Silva +5511999998888');
  });

  it('sem telefone, o titulo fica so com o nome', () => {
    const p = montarEventoPayload(base);
    expect(p.summary).toBe('Maria Silva');
  });
});
```

> O título segue `Nome +telefone` de propósito: é o formato que os eventos manuais já usam e do qual `fn_capi_enqueue_videochamada` extrai o primeiro nome (spec §10).

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/googleAgendaPayload.test.mjs`
Expected: FAIL — `montarEventoPayload is not a function`

- [ ] **Step 3: Implementar as funções de escrita**

Acrescentar ao final de `client/netlify/functions/_lib/googleAgenda.mjs` (sem tocar no que já existe):

```javascript
// ---------------------------------------------------------------------------
// ESCRITA (Fase 1 dos Agendamentos). Exige escopo calendar.events (NAO o
// .readonly) e que a agenda esteja compartilhada com permissao de alteracao.
// ---------------------------------------------------------------------------

/** Monta o corpo do evento. PURO — testado em __tests__/googleAgendaPayload.test.mjs */
export function montarEventoPayload({ inicio, fim, clienteNome, clienteEmail, clienteTelefone }) {
  const payload = {
    // mesmo formato dos eventos manuais: o sync extrai o primeiro nome daqui
    summary: clienteTelefone ? `${clienteNome} +${clienteTelefone}` : clienteNome,
    start: { dateTime: inicio },
    end: { dateTime: fim },
    conferenceData: {
      createRequest: {
        requestId: `cbc-${inicio}-${clienteEmail}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };
  if (clienteEmail) payload.attendees = [{ email: clienteEmail }];
  return payload; // colorId ausente de proposito = "agendada"
}

/** Ocupacao real das agendas no periodo. */
export async function freeBusy(calendarIds, timeMin, timeMax, accessToken) {
  const r = await fetch(`${CAL_URL}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, items: calendarIds.map((id) => ({ id })) }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error('freeBusy: ' + JSON.stringify(j.error).slice(0, 200));
  const out = {};
  for (const id of calendarIds) {
    out[id] = (j.calendars?.[id]?.busy || []).map((b) => ({ inicio: b.start, fim: b.end }));
  }
  return out;
}

export async function criarEvento(calendarId, payload, accessToken) {
  const u = new URL(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events`);
  u.searchParams.set('conferenceDataVersion', '1');
  u.searchParams.set('sendUpdates', 'all'); // o Google envia o convite
  const r = await fetch(u, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error('criarEvento: ' + JSON.stringify(j.error).slice(0, 200));
  return { id: j.id, hangoutLink: j.hangoutLink || null };
}

export async function remarcarEvento(calendarId, eventId, inicio, fim, accessToken) {
  const u = new URL(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  u.searchParams.set('sendUpdates', 'all');
  const r = await fetch(u, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: { dateTime: inicio }, end: { dateTime: fim } }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error('remarcarEvento: ' + JSON.stringify(j.error).slice(0, 200));
}

export async function definirCor(calendarId, eventId, colorId, accessToken) {
  const u = `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const r = await fetch(u, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ colorId: String(colorId) }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error('definirCor: ' + JSON.stringify(j.error).slice(0, 200));
}

/**
 * Move o evento para outra agenda (redistribuicao de ferias).
 * A VERIFICAR ao vivo: se o link do Meet sobrevive a transferencia (spec §5D).
 * Se nao sobreviver, o chamador precisa recriar o evento em vez de mover.
 */
export async function moverEvento(calendarId, eventId, destinoCalendarId, accessToken) {
  const u = new URL(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move`);
  u.searchParams.set('destination', destinoCalendarId);
  u.searchParams.set('sendUpdates', 'all');
  const r = await fetch(u, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error('moverEvento: ' + JSON.stringify(j.error).slice(0, 200));
  return { id: j.id };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/googleAgendaPayload.test.mjs`
Expected: PASS — 5 testes.

- [ ] **Step 5: Garantir que o sync antigo não quebrou**

Run: `cd client && npx vitest run`
Expected: PASS em toda a suíte. Se algum teste de `googleAgenda` existente falhar, a alteração tocou no que não devia.

- [ ] **Step 6: Commit**

```bash
git add client/netlify/functions/_lib/googleAgenda.mjs client/netlify/functions/_lib/__tests__/googleAgendaPayload.test.mjs
git commit -m "feat(agenda): escrita no Google Agenda (criar, remarcar, cor, mover)"
```

---

### Task 5: Endpoint de horários livres

**Files:**
- Create: `client/netlify/functions/agenda-slots.mjs`

**Interfaces:**
- Consumes: `calcularSlots` (Task 2), `freeBusy` e `getAccessToken` (Task 4), `supa` de `_lib/supabaseClient.mjs`.
- Produces: `GET /.netlify/functions/agenda-slots?slug=<opcional>` → `{ ok, slots: [{ inicio, vendedores: string[] }] }`

O endpoint **nunca revela de quem é o horário** — só devolve quantos/quais internamente para o `agenda-criar` decidir. O campo `vendedores` não vai para a página pública; ela usa só `inicio`.

- [ ] **Step 1: Implementar**

```javascript
/**
 * Netlify Function: agenda-slots
 * Devolve os horarios livres para a pagina publica e para a aba interna.
 * Le a config e as vendedoras ATIVAS do Supabase, a ocupacao real do Google,
 * e cruza com o calculo puro de agendaSlots.mjs.
 *
 * Query: ?slug=mariana  (opcional — link direcionado)
 * Resposta: { ok, slots: [{ inicio, vendedores: [email] }] }
 */

import { supa } from './_lib/supabaseClient.mjs';
import { getAccessToken, freeBusy } from './_lib/googleAgenda.mjs';
import { calcularSlots } from './_lib/agendaSlots.mjs';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  try {
    const slug = new URL(req.url).searchParams.get('slug');

    const [{ data: cfg }, { data: vends }] = await Promise.all([
      supa.from('agenda_config').select('*').eq('id', 1).single(),
      supa.from('agenda_vendedores').select('email, slug').eq('ativo', true),
    ]);
    if (!cfg || !vends?.length) return json({ ok: false, error: 'configuracao ausente' }, 500);

    const agora = new Date();
    const ate = new Date(agora.getTime() + cfg.janela_dias * 86400000);
    const emails = vends.map((v) => v.email);

    const token = await getAccessToken();
    const ocupacaoPorAgenda = await freeBusy(emails, agora.toISOString(), ate.toISOString(), token);

    // Um mapa inicio -> quem esta livre
    const mapa = new Map();
    for (const email of emails) {
      const livres = calcularSlots({
        config: cfg,
        ocupacao: ocupacaoPorAgenda[email] || [],
        agora,
        ateDias: cfg.janela_dias,
      });
      for (const inicio of livres) {
        if (!mapa.has(inicio)) mapa.set(inicio, []);
        mapa.get(inicio).push(email);
      }
    }

    // Link direcionado: se a dona tem horario proprio, mostra so os dela.
    // Se nao tem NENHUM, cai para os das outras — sem sinalizar nada (spec decisao #11).
    const preferida = slug ? vends.find((v) => v.slug === slug)?.email : null;
    let slots = [...mapa.entries()].map(([inicio, vendedores]) => ({ inicio, vendedores }));
    if (preferida) {
      const dela = slots.filter((s) => s.vendedores.includes(preferida));
      if (dela.length) slots = dela;
    }
    slots.sort((a, b) => a.inicio.localeCompare(b.inicio));

    return json({ ok: true, slots });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
};
```

- [ ] **Step 2: Verificar que responde**

Com o `netlify dev` rodando:

Run: `curl -s "http://localhost:8888/.netlify/functions/agenda-slots" | head -c 300`
Expected: JSON com `"ok":true` e um array `slots`. Se vier `ok:false` com erro de escopo do Google, é o bloqueio conhecido — as Tasks 1–3 continuam válidas.

- [ ] **Step 3: Commit**

```bash
git add client/netlify/functions/agenda-slots.mjs
git commit -m "feat(agenda): endpoint de horarios livres"
```

---

### Task 6: Endpoint de criação

**Files:**
- Create: `client/netlify/functions/agenda-criar.mjs`

**Interfaces:**
- Consumes: `escolherVendedora` (Task 3), `criarEvento` / `montarEventoPayload` / `getAccessToken` / `freeBusy` (Task 4).
- Produces: `POST /.netlify/functions/agenda-criar` com corpo
  `{ inicio, clienteNome, clienteTelefone, clienteEmail, slug?, origem, criadoPor?, fbp?, fbc?, userAgent?, cpf?, cep?, nascimento? }`
  → `{ ok, id, vendedor, meetLink, tokenRemarcacao }` ou `{ ok:false, motivo:'ocupado' }`

- [ ] **Step 1: Implementar**

```javascript
/**
 * Netlify Function: agenda-criar
 * ORDEM OBRIGATORIA: reserva no Postgres -> evento no Google. Nunca o contrario:
 * o Google aceita eventos sobrepostos sem reclamar e nao serve como trava.
 *
 * Falha ao criar no Google => a reserva e LIBERADA (status cancelado), para o
 * horario nao ficar preso.
 *
 * O envio para a Meta e enfileirado e NUNCA bloqueia o agendamento.
 */

import { randomUUID } from 'node:crypto';
import { supa } from './_lib/supabaseClient.mjs';
import { getAccessToken, freeBusy, criarEvento, montarEventoPayload } from './_lib/googleAgenda.mjs';
import { escolherVendedora } from './_lib/agendaRodizio.mjs';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'use POST' }, 405);
  const b = await req.json().catch(() => ({}));

  // --- validacao no SERVIDOR, nao so no front ---
  const tel = soDigitos(b.clienteTelefone);
  if (!b.inicio || !b.clienteNome || !tel) return json({ ok: false, error: 'campos obrigatorios' }, 400);
  if (tel.length < 10 || tel.length > 13) return json({ ok: false, error: 'telefone invalido' }, 400);
  if (b.clienteEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.clienteEmail))
    return json({ ok: false, error: 'e-mail invalido' }, 400);

  const { data: cfg } = await supa.from('agenda_config').select('*').eq('id', 1).single();
  const inicio = new Date(b.inicio);
  const fim = new Date(inicio.getTime() + cfg.duracao_min * 60000);

  // antecedencia REAVALIADA aqui: a tela pode ter ficado aberta
  if (inicio.getTime() - Date.now() < cfg.antecedencia_min * 60000)
    return json({ ok: false, motivo: 'tarde_demais' }, 409);

  // --- ja existe agendamento vivo para esse telefone? oferece remarcar ---
  const { data: jaTem } = await supa
    .from('agenda_agendamentos')
    .select('id, inicio, token_remarcacao')
    .eq('cliente_telefone', tel)
    .in('status', ['reservado', 'confirmado'])
    .gte('inicio', new Date().toISOString())
    .maybeSingle();
  if (jaTem) return json({ ok: false, motivo: 'ja_agendado', agendamento: jaTem }, 409);

  // --- quem esta livre neste horario ---
  const { data: vends } = await supa.from('agenda_vendedores').select('email, slug').eq('ativo', true);
  const token = await getAccessToken();
  const ocupacao = await freeBusy(vends.map((v) => v.email), inicio.toISOString(), fim.toISOString(), token);
  const candidatas = vends
    .map((v) => v.email)
    .filter((e) => !(ocupacao[e] || []).length);
  if (!candidatas.length) return json({ ok: false, motivo: 'ocupado' }, 409);

  const { data: cargas } = await supa
    .from('agenda_agendamentos')
    .select('vendedor_email')
    .in('status', ['reservado', 'confirmado'])
    .gte('inicio', new Date(Date.now() - 7 * 86400000).toISOString());
  const contagemRecente = {};
  for (const c of cargas || []) contagemRecente[c.vendedor_email] = (contagemRecente[c.vendedor_email] || 0) + 1;

  const preferida = b.slug ? vends.find((v) => v.slug === b.slug)?.email : null;
  const vendedor = escolherVendedora({ candidatas, preferida, contagemRecente });
  if (!vendedor) return json({ ok: false, motivo: 'ocupado' }, 409);

  // --- 1) RESERVA (a trava decide quem ganha) ---
  const capiEventId = `agd_${randomUUID()}`;
  const tokenRemarcacao = randomUUID();
  const { data: reserva, error: errReserva } = await supa
    .from('agenda_agendamentos')
    .insert({
      vendedor_email: vendedor,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      status: 'reservado',
      cliente_nome: b.clienteNome,
      cliente_telefone: tel,
      cliente_email: b.clienteEmail || null,
      cliente_cpf: soDigitos(b.cpf) || null,
      cliente_cep: soDigitos(b.cep) || null,
      cliente_nascimento: b.nascimento || null,
      origem: b.origem === 'publico' ? 'publico' : 'interno',
      link_slug: b.slug || null,
      criado_por: b.criadoPor || null,
      fbp: b.fbp || null,
      fbc: b.fbc || null,
      client_ip: req.headers.get('x-nf-client-connection-ip') || null,
      user_agent: b.origem === 'publico' ? (b.userAgent || null) : null,
      capi_event_id: capiEventId,
      token_remarcacao: tokenRemarcacao,
    })
    .select('id')
    .single();

  if (errReserva) {
    // 23505 = unique_violation => alguem ganhou a corrida
    if (errReserva.code === '23505') return json({ ok: false, motivo: 'ocupado' }, 409);
    return json({ ok: false, error: errReserva.message }, 500);
  }

  // --- 2) EVENTO NO GOOGLE ---
  try {
    const payload = montarEventoPayload({
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      clienteNome: b.clienteNome,
      clienteEmail: b.clienteEmail,
      clienteTelefone: tel,
    });
    const ev = await criarEvento(vendedor, payload, token);
    await supa
      .from('agenda_agendamentos')
      .update({ status: 'confirmado', google_event_id: ev.id, meet_link: ev.hangoutLink, atualizado_em: new Date().toISOString() })
      .eq('id', reserva.id);

    return json({ ok: true, id: reserva.id, vendedor, meetLink: ev.hangoutLink, tokenRemarcacao });
  } catch (e) {
    // libera a reserva para o horario nao ficar preso
    await supa.from('agenda_agendamentos').update({ status: 'cancelado' }).eq('id', reserva.id);
    return json({ ok: false, error: 'falha ao criar no Google: ' + String(e.message || e) }, 502);
  }
};
```

> O envio à Meta **não** está aqui de propósito: entra no Plano 3, junto com a página pública, para não misturar responsabilidades. As colunas `fbp`/`fbc`/`client_ip`/`capi_event_id` já são gravadas agora para o Plano 3 só ler.

- [ ] **Step 2: Verificar a corrida de verdade**

Com `netlify dev` rodando, disparar duas requisições **simultâneas** para o mesmo horário:

```bash
BODY='{"inicio":"2026-02-04T13:00:00.000Z","clienteNome":"Teste Um","clienteTelefone":"11999990001","clienteEmail":"t1@exemplo.com","origem":"interno"}'
BODY2='{"inicio":"2026-02-04T13:00:00.000Z","clienteNome":"Teste Dois","clienteTelefone":"11999990002","clienteEmail":"t2@exemplo.com","origem":"interno"}'
curl -s -X POST localhost:8888/.netlify/functions/agenda-criar -d "$BODY" &
curl -s -X POST localhost:8888/.netlify/functions/agenda-criar -d "$BODY2" &
wait
```

Expected: uma resposta com `"ok":true` e outra com `"motivo":"ocupado"`. **Duas respostas `ok:true` significam que a trava não está funcionando** — parar e revisar a Task 1.

- [ ] **Step 3: Limpar o teste**

```sql
delete from agenda_agendamentos where cliente_telefone in ('11999990001','11999990002');
```

E apagar os eventos criados na agenda de teste do Google.

- [ ] **Step 4: Commit**

```bash
git add client/netlify/functions/agenda-criar.mjs
git commit -m "feat(agenda): endpoint de criacao com trava de concorrencia"
```

---

### Task 7: Endpoint de status (cor)

**Files:**
- Create: `client/netlify/functions/agenda-status.mjs`

**Interfaces:**
- Consumes: `definirCor` e `getAccessToken` (Task 4).
- Produces: `POST /.netlify/functions/agenda-status` com `{ id, status }` onde `status ∈ realizada | no_show | fechou` → `{ ok }`

- [ ] **Step 1: Implementar**

```javascript
/**
 * Netlify Function: agenda-status
 * Grava o resultado do atendimento como COR no Google — que continua sendo a
 * fonte da verdade lida pelo funil (agenda-videochamadas-sync.mjs).
 * Mapa identico ao COR_STATUS do googleAgenda.mjs.
 */

import { supa } from './_lib/supabaseClient.mjs';
import { getAccessToken, definirCor } from './_lib/googleAgenda.mjs';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

const COR = { realizada: '10', no_show: '11', fechou: '7' };

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'use POST' }, 405);
  const { id, status } = await req.json().catch(() => ({}));
  const colorId = COR[status];
  if (!id || !colorId) return json({ ok: false, error: 'id e status validos sao obrigatorios' }, 400);

  const { data: ag } = await supa
    .from('agenda_agendamentos')
    .select('vendedor_email, google_event_id')
    .eq('id', id)
    .maybeSingle();
  if (!ag?.google_event_id) return json({ ok: false, error: 'agendamento sem evento no Google' }, 404);

  try {
    const token = await getAccessToken();
    await definirCor(ag.vendedor_email, ag.google_event_id, colorId, token);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 502);
  }
};
```

- [ ] **Step 2: Verificar**

Criar um agendamento de teste, chamar o endpoint e conferir no Google que a cor mudou:

```bash
curl -s -X POST localhost:8888/.netlify/functions/agenda-status \
  -d '{"id":"<uuid do agendamento>","status":"realizada"}'
```

Expected: `{"ok":true}` e o evento verde (cor 10) na agenda.

- [ ] **Step 3: Commit**

```bash
git add client/netlify/functions/agenda-status.mjs
git commit -m "feat(agenda): endpoint de status grava cor no Google"
```

---

### Task 8: Endpoint de remarcação

**Files:**
- Create: `client/netlify/functions/agenda-remarcar.mjs`

**Interfaces:**
- Consumes: `remarcarEvento`, `freeBusy`, `getAccessToken` (Task 4).
- Produces: `POST /.netlify/functions/agenda-remarcar` com `{ token, novoInicio }` → `{ ok, inicio }`

- [ ] **Step 1: Implementar**

```javascript
/**
 * Netlify Function: agenda-remarcar
 * Acessada pelo cliente via token do e-mail (sem login) ou pela aba interna.
 *
 * NAO gera um segundo Lead na Meta: o capi_event_id do agendamento original e
 * preservado de proposito, senao a mesma pessoa contaria duas vezes (spec §5C).
 */

import { supa } from './_lib/supabaseClient.mjs';
import { getAccessToken, freeBusy, remarcarEvento } from './_lib/googleAgenda.mjs';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'use POST' }, 405);
  const { token: tokenRemarcacao, novoInicio } = await req.json().catch(() => ({}));
  if (!tokenRemarcacao || !novoInicio) return json({ ok: false, error: 'token e novoInicio obrigatorios' }, 400);

  const { data: ag } = await supa
    .from('agenda_agendamentos')
    .select('*')
    .eq('token_remarcacao', tokenRemarcacao)
    .in('status', ['reservado', 'confirmado'])
    .maybeSingle();
  if (!ag) return json({ ok: false, error: 'agendamento nao encontrado' }, 404);

  const { data: cfg } = await supa.from('agenda_config').select('*').eq('id', 1).single();
  const inicio = new Date(novoInicio);
  const fim = new Date(inicio.getTime() + cfg.duracao_min * 60000);

  if (inicio.getTime() - Date.now() < cfg.antecedencia_min * 60000)
    return json({ ok: false, motivo: 'tarde_demais' }, 409);

  const token = await getAccessToken();
  const ocupacao = await freeBusy([ag.vendedor_email], inicio.toISOString(), fim.toISOString(), token);
  if ((ocupacao[ag.vendedor_email] || []).length) return json({ ok: false, motivo: 'ocupado' }, 409);

  // a trava vale aqui tambem: o UPDATE dispara o mesmo indice unico
  const { error: errUpd } = await supa
    .from('agenda_agendamentos')
    .update({ inicio: inicio.toISOString(), fim: fim.toISOString(), atualizado_em: new Date().toISOString() })
    .eq('id', ag.id);
  if (errUpd) {
    if (errUpd.code === '23505') return json({ ok: false, motivo: 'ocupado' }, 409);
    return json({ ok: false, error: errUpd.message }, 500);
  }

  try {
    await remarcarEvento(ag.vendedor_email, ag.google_event_id, inicio.toISOString(), fim.toISOString(), token);
  } catch (e) {
    // desfaz no banco para nao divergir do Google (que continua sendo a verdade)
    await supa.from('agenda_agendamentos')
      .update({ inicio: ag.inicio, fim: ag.fim }).eq('id', ag.id);
    return json({ ok: false, error: String(e.message || e) }, 502);
  }

  return json({ ok: true, inicio: inicio.toISOString() });
};
```

- [ ] **Step 2: Verificar que o Lead não é duplicado**

```sql
select capi_event_id, inicio, atualizado_em
from agenda_agendamentos where token_remarcacao = '<token>';
```

Expected: o `capi_event_id` é **o mesmo** de antes da remarcação; só `inicio`, `fim` e `atualizado_em` mudaram.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `cd client && npx vitest run`
Expected: PASS, sem regressão.

- [ ] **Step 4: Commit**

```bash
git add client/netlify/functions/agenda-remarcar.mjs
git commit -m "feat(agenda): endpoint de remarcacao preservando o capi_event_id"
```

- [ ] **Step 5: Verificação ao vivo (bloqueada até o Paulo liberar o Google)**

Só executável depois do escopo `calendar.events` e do compartilhamento das agendas:

1. `agenda-slots` devolve horários coerentes com a agenda real
2. `agenda-criar` cria o evento **na agenda certa**, com Meet, e o convite chega ao cliente
3. Duas chamadas simultâneas → uma ganha, a outra recebe `ocupado`
4. `agenda-status` pinta o evento e o `agenda-videochamadas-sync` classifica igual
5. `agenda-remarcar` move o evento e o convite é reenviado

---

### Task 9: Rede de segurança — reserva órfã e alerta de token

Duas exigências do spec §6 que a auto-revisão pegou faltando. Ambas são de correção, não de conforto.

**Files:**
- Modify: `client/netlify/functions/agenda-criar.mjs`
- Modify: `client/netlify/functions/_lib/googleAgenda.mjs`
- Test: `client/netlify/functions/_lib/__tests__/agendaOrfa.test.mjs`

**Interfaces:**
- Produces: `reservaExpirada(criadoEm, agora, limiteMin)` → `boolean` (puro, exportado de `agendaSlots.mjs`)

#### Por que a reserva órfã importa

Se o processo morrer entre a reserva (Task 6, passo 1) e a criação no Google (passo 2), aquele horário fica **bloqueado para sempre** pela trava de unicidade — e nenhum cliente consegue mais agendá-lo. O spec define o limite em **5 minutos**.

- [ ] **Step 1: Escrever o teste da regra de expiração**

Criar `client/netlify/functions/_lib/__tests__/agendaOrfa.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { reservaExpirada } from '../agendaSlots.mjs';

const AGORA = new Date('2026-01-07T12:00:00Z');

describe('reservaExpirada', () => {
  it('reserva de 6 minutos atras esta expirada', () => {
    expect(reservaExpirada('2026-01-07T11:54:00Z', AGORA, 5)).toBe(true);
  });
  it('reserva de 2 minutos atras ainda vale', () => {
    expect(reservaExpirada('2026-01-07T11:58:00Z', AGORA, 5)).toBe(false);
  });
  it('exatamente no limite ainda vale', () => {
    expect(reservaExpirada('2026-01-07T11:55:00Z', AGORA, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/agendaOrfa.test.mjs`
Expected: FAIL — `reservaExpirada is not a function`

- [ ] **Step 3: Implementar a função pura**

Acrescentar ao final de `client/netlify/functions/_lib/agendaSlots.mjs`:

```javascript
/**
 * Uma reserva presa em 'reservado' bloqueia o horario pela trava de unicidade.
 * Isso acontece se o processo morrer entre a reserva e a criacao no Google.
 * Spec §6: limite de 5 minutos.
 */
export function reservaExpirada(criadoEm, agora, limiteMin) {
  return agora.getTime() - new Date(criadoEm).getTime() > limiteMin * 60000;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd client && npx vitest run netlify/functions/_lib/__tests__/agendaOrfa.test.mjs`
Expected: PASS — 3 testes.

- [ ] **Step 5: Limpar as órfãs em `agenda-criar`**

Em `client/netlify/functions/agenda-criar.mjs`, logo depois de ler a config (antes de qualquer verificação de disponibilidade), inserir:

```javascript
  // Libera reservas presas: se o processo morreu antes de criar no Google, o
  // horario ficaria bloqueado para sempre pela trava de unicidade. Auto-curativo,
  // sem depender de cron.
  await supa
    .from('agenda_agendamentos')
    .update({ status: 'cancelado' })
    .eq('status', 'reservado')
    .lt('criado_em', new Date(Date.now() - 5 * 60000).toISOString());
```

- [ ] **Step 6: Verificar que a órfã é liberada**

```sql
-- cria uma orfa artificial, com 10 minutos de idade
insert into agenda_agendamentos (vendedor_email, inicio, fim, status, criado_em)
values ('beatriz@advocaciacbc.com', '2026-03-04 13:00+00', '2026-03-04 13:30+00',
        'reservado', now() - interval '10 minutes');
```

Depois chamar `agenda-criar` para **esse mesmo horário** e conferir que retorna `ok:true` — a órfã foi liberada e o horário voltou a ficar disponível.

Limpar: `delete from agenda_agendamentos where inicio = '2026-03-04 13:00+00';`

- [ ] **Step 7: Alerta de token expirado**

O spec §6 registra que o token **já expirou uma vez, em 23/07, sem ninguém perceber** — na época só parava o sync; agora pararia a página pública de aceitar agendamento.

Em `client/netlify/functions/_lib/googleAgenda.mjs`, dentro de `getAccessToken`, trocar a linha do erro por:

```javascript
  if (!j.access_token) {
    const msg = 'falha ao renovar token Google: ' + JSON.stringify(j).slice(0, 200);
    // Nao deixar falhar em silencio: em 23/07 o token expirou e ninguem viu.
    try {
      const { supa } = await import('./supabaseClient.mjs');
      await supa.from('cron_heartbeat').upsert(
        { job: 'google-agenda-token', ok: false, detail: 'token do Google expirou ou foi revogado', updated_at: new Date().toISOString() },
        { onConflict: 'job' }
      );
    } catch { /* alerta e best-effort: nunca mascara o erro original */ }
    throw new Error(msg);
  }
```

> Usa o `cron_heartbeat`, que o `MonitorAlerts.jsx` já lê e renderiza na faixa vermelha da aba Monitor — mesmo caminho usado pelo alerta da CAPI. Zero tela nova.

- [ ] **Step 8: Verificar o alerta**

Simular com um refresh token inválido em ambiente local:

```bash
GOOGLE_OAUTH_REFRESH_TOKEN=invalido npx netlify dev
curl -s localhost:8888/.netlify/functions/agenda-slots
```

Expected: resposta com erro **e** uma linha em `cron_heartbeat` com `job='google-agenda-token'` e `ok=false`.

```sql
select job, ok, detail from cron_heartbeat where job = 'google-agenda-token';
```

- [ ] **Step 9: Rodar a suíte e commitar**

```bash
cd client && npx vitest run
git add client/netlify/functions/_lib/agendaSlots.mjs \
        client/netlify/functions/_lib/__tests__/agendaOrfa.test.mjs \
        client/netlify/functions/agenda-criar.mjs \
        client/netlify/functions/_lib/googleAgenda.mjs
git commit -m "feat(agenda): libera reserva orfa e alerta quando o token do Google expira"
```

---

## Fora deste plano

| Item | Onde entra |
|---|---|
| Aba interna, calendário, modais | Plano 2 |
| Página pública, pixel, envio à Meta, botões "Adicionar à agenda" | Plano 3 |
| Tela de configuração, pausa, redistribuição, push do Google, limite por IP | Plano 4 |
