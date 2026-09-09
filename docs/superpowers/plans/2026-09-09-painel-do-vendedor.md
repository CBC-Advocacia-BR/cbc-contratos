# Painel do Vendedor ("Meu Painel") — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development`
> (recomendada) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam
> caixas (`- [ ]`) para acompanhamento.

**Objetivo:** dar a cada closer (Mariana, Ana Piva, Beatriz, Emerson) uma aba que responde "o
que eu preciso fazer hoje", juntando agenda, cobrança de assinatura, documentação faltando,
leads em negociação e processos distribuídos.

**Arquitetura:** views no banco fazem os joins pesados; o app lê, decide com lógica pura
testada e desenha. Uma function separada traz as tags do Kommo em lote. Nenhum objeto
existente é alterado.

**Stack:** React 19 + Vite, Supabase (PostgREST), Netlify Functions (Node 22), vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-painel-do-vendedor-design.md`

## Restrições globais

Valem para TODAS as tarefas, sem repetir em cada uma:

- **REGRA #1 do projeto:** antes de editar qualquer arquivo em `client/` ou
  `netlify/functions/`, copiar para `backups/AAAAMMDD_HHMMSS_meu_painel/`. Nunca `rm`.
- **REGRA #16:** nada de alterar código sem a lista de mudanças aprovada. Este plano é a lista.
- **Datas sempre em BRT.** Frontend: `ymdLocal`/`fmtData` de `utils/format.js`. Servidor:
  `_lib/dataBrt.mjs`. Nunca `toISOString().slice(0,10)` — esse bug já apareceu 27 vezes aqui.
- **Toda consulta que pode passar de 1.000 linhas usa `fetchAllPaged`** de
  `utils/supabasePaged.js`, com **ORDER BY terminando em coluna única**. `.limit(N)` não levanta
  o teto do PostgREST.
- **Views novas com `security_invoker = true`**, padrão das `vw_bi_*`.
- **Comentários e nomes de variável sem acento; texto de tela COM acento.**
- **Migrações:** aplicar via MCP `supabase-cbc` (`apply_migration`) E salvar o `.sql`
  correspondente na raiz do repositório.
- **Nada de emoji em componente novo** — usar `components/ui/Ico.jsx` (item 287).
- **Cores só por token `--cbc-*`.** Hex cravado quebra o modo escuro.
- **Portão de qualidade antes de cada commit:** `npm run verificar` na raiz (testes → build →
  lint no baseline 18 → 148 functions → 2 edge).
- **Não tocar** em `kommo_leads`, na RPC `kommo_leads_upsert`, nem no cron `kommo-leads-sync`.

---

### Task 1: Tabelas de apoio (atribuição, descarte, tags)

**Arquivos:**
- Criar: `supabase_meu_painel.sql`
- Migração: `meu_painel_tabelas` (via MCP)

**Interfaces:**
- Produz: tabelas `vendedor_atribuicao`, `vendedor_leads_descartados`, `kommo_lead_tags`,
  consumidas pelas views das Tasks 2 a 4 e pelas Tasks 11, 13 e 14.

- [ ] **Passo 1: escrever o SQL**

Criar `supabase_meu_painel.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Painel do Vendedor ("Meu Painel") — 09/09/2026
-- Spec: docs/superpowers/specs/2026-09-09-painel-do-vendedor-design.md
--
-- 3 tabelas de apoio. Nenhuma tabela existente e alterada.
-- ⚠️ kommo_lead_tags e SEPARADA de kommo_leads de proposito: o sync diario
-- (kommo-leads-sync + RPC kommo_leads_upsert) funciona ha meses e nao deve ser
-- tocado por causa de uma coluna nova.
-- ═══════════════════════════════════════════════════════════════════════════

-- Sobrescreve o dono padrao de um lead ou contrato. UMA linha vigente por
-- entidade: o UPDATE sobrescreve, o historico fica em activity_log.
create table if not exists public.vendedor_atribuicao (
  id             bigserial primary key,
  entidade       text not null check (entidade in ('lead','contrato')),
  entidade_id    text not null,
  vendedor_email text not null,
  atribuido_por  text not null,
  atribuido_em   timestamptz not null default now(),
  motivo         text,
  unique (entidade, entidade_id)
);
comment on table public.vendedor_atribuicao is
  'Sobrescreve o dono padrao (contratos.created_by / agenda.vendedora_email) do Meu Painel.';

-- Botao "nao fechou". O lead volta se houver call realizada POSTERIOR ao descarte
-- (regra da spec 5.3) — por isso guardamos descartado_em e nao apagamos a linha.
create table if not exists public.vendedor_leads_descartados (
  id             bigserial primary key,
  lead_id        text not null,
  vendedor_email text not null,
  motivo         text not null check (motivo in ('preco','sumiu','concorrente','custas','outro')),
  observacao     text,
  descartado_por text not null,
  descartado_em  timestamptz not null default now()
);
create index if not exists idx_vld_lead on public.vendedor_leads_descartados (lead_id, descartado_em desc);
comment on table public.vendedor_leads_descartados is
  'Descarte de lead na lista de negociacao. motivo=outro exige observacao (validado no app).';

-- Espelho das tags do lead no Kommo. Preenchido sob demanda pela function
-- kommo-tags-lote; resort_resolvido ja vem passado pelo resolveResortTag.
create table if not exists public.kommo_lead_tags (
  lead_id          text primary key,
  tags             text[] not null default '{}',
  resort_resolvido text,
  atualizado_em    timestamptz not null default now()
);
comment on table public.kommo_lead_tags is
  'Tags do lead no Kommo (vivem so la, em _embedded.tags). Separada de kommo_leads de proposito.';

-- RLS: mesmo padrao das satelites (anon 0 linhas, authenticated tudo).
alter table public.vendedor_atribuicao        enable row level security;
alter table public.vendedor_leads_descartados enable row level security;
alter table public.kommo_lead_tags            enable row level security;

create policy vendedor_atribuicao_auth on public.vendedor_atribuicao
  for all to authenticated using (true) with check (true);
create policy vendedor_leads_descartados_auth on public.vendedor_leads_descartados
  for all to authenticated using (true) with check (true);
create policy kommo_lead_tags_auth on public.kommo_lead_tags
  for all to authenticated using (true) with check (true);

-- A function kommo-tags-lote grava com a chave anon (padrao botDb), entao precisa
-- de escrita propria nessa tabela — e SO nessa.
create policy kommo_lead_tags_anon_write on public.kommo_lead_tags
  for all to anon using (true) with check (true);
```

- [ ] **Passo 2: conferir que os nomes não colidem no banco compartilhado**

Rodar via MCP `supabase-cbc`:

```sql
select table_name from information_schema.tables
where table_schema='public'
  and table_name in ('vendedor_atribuicao','vendedor_leads_descartados','kommo_lead_tags');
```

Esperado: **0 linhas**. Se voltar alguma, PARE — o banco é compartilhado com Teses,
Calculadora, Penhora, Prestação e Auditoria de Audiências, e o nome precisa mudar.

- [ ] **Passo 3: aplicar a migração**

MCP `supabase-cbc` → `apply_migration`, nome `meu_painel_tabelas`, com o conteúdo do Passo 1.

- [ ] **Passo 4: validar RLS com SET ROLE**

```sql
set local role anon;
select count(*) from public.vendedor_atribuicao;         -- esperado: 0
reset role;
set local role authenticated;
select count(*) from public.vendedor_atribuicao;         -- esperado: 0 (tabela vazia, sem erro)
reset role;
```

O que importa: `anon` **não pode** dar erro de permissão nem ver linhas; `authenticated` lê sem
erro.

- [ ] **Passo 5: incluir as 3 tabelas na whitelist do backup**

Sem isso o alarme `backup_tabelas_fora()` acusa tabela nova fora do backup diário — foi assim
que a `portal_diagnostico_historico` foi pega em 02/08.

```sql
select public.backup_tabelas_fora();
```

Se as três aparecerem, acrescentar à whitelist do backup (a mesma função lista onde) e rodar de
novo até voltar vazio.

- [ ] **Passo 6: commit**

```bash
git add supabase_meu_painel.sql
git commit -m "meu painel: tabelas de atribuicao, descarte e tags do Kommo"
```

---

### Task 2: View `vw_vendedor_negociacao`

**Arquivos:**
- Modificar: `supabase_meu_painel.sql` (acrescentar ao fim)
- Migração: `meu_painel_view_negociacao`

**Interfaces:**
- Consome: `vendedor_atribuicao`, `vendedor_leads_descartados`, `kommo_lead_tags` (Task 1).
- Produz: view com as colunas `lead_id, vendedor_email, cliente_nome, telefone, ultima_call,
  calls_realizadas, calls_totais, primeira_call, resort_tag, dono_padrao, transferido,
  voltou_apos_descarte`. Consumida pelas Tasks 6 e 9.

- [ ] **Passo 1: escrever a view**

Acrescentar a `supabase_meu_painel.sql`:

```sql
-- ───────────────────────────────────────────────────────────────────────────
-- Leads em negociacao: COMPARECEU a videochamada e ainda nao tem contrato.
--
-- ⚠️ O contrato e procurado em TODOS os contratantes (jsonb_array_elements), nao
-- so no primeiro: contrato com 2 contratantes pode ter o link do Kommo no segundo,
-- e o lead ficaria eternamente na lista como se nao tivesse fechado.
--
-- ⚠️ Quem faltou (no_show) NAO entra (decisao do Paulo): a recuperacao automatica
-- por e-mail ja cuida deles.
--
-- Dono padrao = vendedora_email da call MAIS RECENTE; vendedor_atribuicao sobrescreve.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.vw_vendedor_negociacao
with (security_invoker = true) as
with realizadas as (
  select
    a.lead_id::text                                     as lead_id,
    a.vendedora_email,
    a.scheduled_at,
    a.cliente_nome,
    a.telefone,
    row_number() over (partition by a.lead_id order by a.scheduled_at desc) as rn
  from public.agenda_videochamadas a
  where a.lead_id is not null
    and coalesce(a.status, '') <> 'excluida'
    and a.meet_status = 'realizada'
    and a.scheduled_at < now()
),
agg as (
  select
    r.lead_id,
    count(*)                                            as calls_realizadas,
    min(r.scheduled_at)                                 as primeira_call
  from realizadas r
  group by r.lead_id
),
todas as (
  select a.lead_id::text as lead_id, count(*) as calls_totais
  from public.agenda_videochamadas a
  where a.lead_id is not null and coalesce(a.status, '') <> 'excluida'
  group by a.lead_id
),
leads_com_contrato as (
  select distinct
    regexp_replace(ct.value ->> 'linkKommo', '^.*/detail/([0-9]+).*$', '\1') as lead_id
  from public.contratos c
  cross join lateral jsonb_array_elements(coalesce(c.dados -> 'contratantes', '[]'::jsonb)) as ct(value)
  where coalesce(ct.value ->> 'linkKommo', '') ~ '/detail/[0-9]+'
    and coalesce(c.status, '') <> 'cancelado'
),
descarte as (
  select distinct on (lead_id) lead_id, descartado_em, motivo
  from public.vendedor_leads_descartados
  order by lead_id, descartado_em desc
)
select
  r.lead_id,
  coalesce(at.vendedor_email, r.vendedora_email)        as vendedor_email,
  r.vendedora_email                                      as dono_padrao,
  (at.vendedor_email is not null)                        as transferido,
  at.atribuido_por,
  r.cliente_nome,
  r.telefone,
  r.scheduled_at                                         as ultima_call,
  ag.calls_realizadas,
  coalesce(td.calls_totais, ag.calls_realizadas)         as calls_totais,
  ag.primeira_call,
  klt.resort_resolvido                                   as resort_tag,
  (d.lead_id is not null)                                as voltou_apos_descarte
from realizadas r
join agg ag                          on ag.lead_id = r.lead_id
left join todas td                   on td.lead_id = r.lead_id
left join descarte d                 on d.lead_id = r.lead_id
left join public.kommo_lead_tags klt on klt.lead_id = r.lead_id
left join public.vendedor_atribuicao at
       on at.entidade = 'lead' and at.entidade_id = r.lead_id
where r.rn = 1
  and not exists (select 1 from leads_com_contrato lc where lc.lead_id = r.lead_id)
  -- descartado so sai se NAO houve call realizada depois do descarte (spec 5.3)
  and (d.lead_id is null or r.scheduled_at > d.descartado_em);

grant select on public.vw_vendedor_negociacao to authenticated;
```

- [ ] **Passo 2: aplicar a migração**

MCP `apply_migration`, nome `meu_painel_view_negociacao`.

- [ ] **Passo 3: validar contra os números medidos na spec**

```sql
select vendedor_email, count(*) filter (where ultima_call >= now() - interval '7 days') d7,
       count(*) filter (where ultima_call >= now() - interval '30 days') d30
from public.vw_vendedor_negociacao group by 1 order by d7 desc;
```

Esperado (§4.6 da spec, tolerância de 1 ou 2 pela passagem do tempo):

| vendedor | 7 dias | 30 dias |
|---|---|---|
| marianamaciel@ | ~14 | ~85 |
| emerson@ | ~11 | ~37 |
| anacristina@ | ~9 | ~18 |
| beatriz@ | ~6 | ~40 |

⚠️ **Se os números vierem MAIORES que os da spec, provavelmente o `leads_com_contrato` não
casou** — confira que a regex bate com o formato real do link antes de seguir:

```sql
select count(*) from public.contratos c
cross join lateral jsonb_array_elements(coalesce(c.dados->'contratantes','[]'::jsonb)) ct(value)
where coalesce(ct.value->>'linkKommo','') ~ '/detail/[0-9]+';
```

Esperado: **mais de 350**. Se vier perto de zero, o formato do link mudou e a view está errada.

- [ ] **Passo 4: conferir que não há lead duplicado**

```sql
select lead_id, count(*) from public.vw_vendedor_negociacao group by 1 having count(*) > 1;
```

Esperado: **0 linhas**. Duplicata aqui significa que o `row_number` não isolou a call mais
recente.

- [ ] **Passo 5: commit**

```bash
git add supabase_meu_painel.sql
git commit -m "meu painel: view de leads em negociacao"
```

---

### Task 3: Views `vw_vendedor_pendencias` e `vw_vendedor_distribuidos`

**Arquivos:**
- Modificar: `supabase_meu_painel.sql`
- Migração: `meu_painel_views_pendencias_distribuidos`

**Interfaces:**
- Consome: `vendedor_atribuicao` (Task 1).
- Produz: `vw_vendedor_pendencias` (`tipo, vendedor_email, contrato_id, lawsuit_id,
  cliente_nome, desde, dias, aberturas, nunca_abriu`) e `vw_vendedor_distribuidos`
  (`contrato_id, vendedor_email, cliente_nome, process_number, distribuido_em`).
  Consumidas pelas Tasks 6, 8 e 11.

- [ ] **Passo 1: escrever as duas views**

```sql
-- ───────────────────────────────────────────────────────────────────────────
-- Pendencias do vendedor. Duas origens, uma view, coluna `tipo` separando:
--   'assinatura'  -> contrato enviado e nao assinado (com nº de aberturas do ZapSign)
--   'documentacao'-> tarefa DOCUMENTACAO FALTANDO aberta no ADVBOX
--
-- ⚠️ arquivado_em is null e obrigatorio: sem isso a lista vai de 18 para 69, contando
-- contrato que o escritorio ja deu por encerrado.
-- ⚠️ A tarefa do ADVBOX casa por NOME COMPLETO em `responsaveis`, nao por e-mail, e o
-- campo pode ter varios nomes separados por virgula (tarefa a quatro maos).
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.vw_vendedor_pendencias
with (security_invoker = true) as
-- (a) cobrar assinatura
select
  'assinatura'::text                                   as tipo,
  coalesce(at.vendedor_email, c.created_by)            as vendedor_email,
  c.id::text                                           as contrato_id,
  c.advbox_lawsuit_id::text                            as lawsuit_id,
  c.nome_contratante1                                  as cliente_nome,
  coalesce(c.zapsign_sent_at, c.updated_at)            as desde,
  greatest(0, (extract(epoch from (now() - coalesce(c.zapsign_sent_at, c.updated_at))) / 86400)::int) as dias,
  coalesce((select max((x ->> 'times_viewed')::int)
            from jsonb_array_elements(coalesce(c.zapsign_links, '[]'::jsonb)) x), 0) as aberturas,
  coalesce((select max((x ->> 'times_viewed')::int)
            from jsonb_array_elements(coalesce(c.zapsign_links, '[]'::jsonb)) x), 0) = 0 as nunca_abriu
from public.contratos c
left join public.vendedor_atribuicao at
       on at.entidade = 'contrato' and at.entidade_id = c.id::text
where c.status = 'enviado_zapsign'
  and c.arquivado_em is null

union all

-- (b) documentacao faltando
select
  'documentacao'::text                                 as tipo,
  e.email                                              as vendedor_email,
  null::text                                           as contrato_id,
  t.processo_id_advbox::text                           as lawsuit_id,
  t.cliente                                            as cliente_nome,
  t.data_criacao                                       as desde,
  greatest(0, (extract(epoch from (now() - t.data_criacao)) / 86400)::int) as dias,
  null::int                                            as aberturas,
  false                                                as nunca_abriu
from public.vw_bi_tarefas t
join (values
        ('MARIANA VIANA BERALDO MACIEL', 'marianamaciel@advocaciacbc.com'),
        ('ANA CRISTINA DE MAGALHÃES PIVA', 'anacristina@advocaciacbc.com'),
        ('BEATRIZ CASTELO CAVALCANTE',   'beatriz@advocaciacbc.com'),
        ('EMERSON CALISTA',              'emerson@advocaciacbc.com')
     ) as e(nome, email)
  on t.responsaveis ilike '%' || e.nome || '%'
where t.tarefa = 'DOCUMENTAÇÃO FALTANDO'
  and t.data_conclusao is null;

grant select on public.vw_vendedor_pendencias to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Distribuidos: contrato assinado cujo processo no ADVBOX tem a tarefa
-- DISTRIBUIR ACAO concluida E numero de processo (regra do Paulo).
--
-- ⚠️ SO 'DISTRIBUIR AÇÃO'. O generico %DISTRIBUIR% pegaria
-- 'DISTRIBUIR CUMPRIMENTO + ATUALIZAR CRM' (374 concluidas) e 'DISTRIBUIR IDPJ' (66),
-- que sao outras fases, e inflaria o placar.
--
-- Nota medida em 09/09: a 2a condicao (numero) e redundante — toda tarefa concluida
-- ja vem com numero. Mantida porque e a definicao do Paulo. O inverso NAO vale:
-- 21 processos tem numero sem a tarefa concluida.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.vw_vendedor_distribuidos
with (security_invoker = true) as
select
  c.id::text                                           as contrato_id,
  coalesce(at.vendedor_email, c.created_by)            as vendedor_email,
  c.nome_contratante1                                  as cliente_nome,
  coalesce(nullif(c.advbox_process_number, ''), p.process_number) as process_number,
  d.distribuido_em
from public.contratos c
left join public.vendedor_atribuicao at
       on at.entidade = 'contrato' and at.entidade_id = c.id::text
left join public.bi_processos p on p.lawsuit_id::text = c.advbox_lawsuit_id::text
join lateral (
  select max(t.data_conclusao) as distribuido_em
  from public.vw_bi_tarefas t
  where t.processo_id_advbox::text = c.advbox_lawsuit_id::text
    and t.tarefa = 'DISTRIBUIR AÇÃO'
    and t.data_conclusao is not null
) d on d.distribuido_em is not null
where c.status = 'assinado'
  and c.advbox_lawsuit_id is not null
  and coalesce(nullif(c.advbox_process_number, ''), p.process_number) is not null;

grant select on public.vw_vendedor_distribuidos to authenticated;
```

- [ ] **Passo 2: aplicar a migração**

MCP `apply_migration`, nome `meu_painel_views_pendencias_distribuidos`.

- [ ] **Passo 3: validar as pendências**

```sql
select tipo, vendedor_email, count(*) from public.vw_vendedor_pendencias group by 1,2 order by 1,3 desc;
```

Esperado (§4.4 e §4.5): **assinatura** = 18 no total (anacristina 7, marianamaciel 7,
beatriz 3, emerson 1); **documentacao** = 17 no total, com a Ana concentrando a maioria.

⚠️ Se `documentacao` vier **0**, o `ilike` dos nomes não casou. Diagnostique com:

```sql
select distinct responsaveis from public.vw_bi_tarefas
where tarefa='DOCUMENTAÇÃO FALTANDO' and data_conclusao is null;
```

e ajuste os nomes do `values` para os que aparecerem.

- [ ] **Passo 4: validar os distribuídos**

```sql
select vendedor_email, count(*) from public.vw_vendedor_distribuidos
where vendedor_email in ('marianamaciel@advocaciacbc.com','anacristina@advocaciacbc.com',
                         'beatriz@advocaciacbc.com','emerson@advocaciacbc.com')
group by 1 order by 2 desc;
```

Esperado: Mariana **127**, Ana **70**, Beatriz **33**, Emerson **4**.

Se algum número vier maior, quase certamente a tarefa foi casada com `ilike '%DISTRIBUIR%'` em
vez de igualdade exata com `'DISTRIBUIR AÇÃO'`.

- [ ] **Passo 5: commit**

```bash
git add supabase_meu_painel.sql
git commit -m "meu painel: views de pendencias e de processos distribuidos"
```

---

### Task 4: Lógica pura (`meuPainelCompute.js`) — TDD

**Arquivos:**
- Criar: `client/src/utils/meuPainelCompute.js`
- Testar: `client/src/utils/__tests__/meuPainelCompute.test.js`

**Interfaces:**
- Produz:
  - `agruparAgendaPorDia(eventos, agora)` → `[{ dia:'2026-09-09', rotulo:'Hoje', itens:[...] }]`
  - `marcarNovos(eventos, ultimaVisitaISO)` → mesmos eventos com `novo:boolean`
  - `ordenarNegociacao(linhas, agora)` → linhas com `diasParado:int`, do mais parado ao menos
  - `podeTransferir({ deQuem, usuarioEmail, ehSocio })` → boolean
  - `MOTIVOS_DESCARTE` → `[{ valor, rotulo }]`
  - `validarDescarte({ motivo, observacao })` → `{ ok:boolean, erro:string|null }`
- Consumido pelas Tasks 7 a 11 e 13.

- [ ] **Passo 1: escrever os testes que falham**

Criar `client/src/utils/__tests__/meuPainelCompute.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  agruparAgendaPorDia, marcarNovos, ordenarNegociacao,
  podeTransferir, validarDescarte, MOTIVOS_DESCARTE,
} from '../meuPainelCompute';

// O vitest.setup.js fixa TZ=America/Sao_Paulo — estes testes dependem disso.
const ev = (id, at, extra = {}) => ({ event_id: id, scheduled_at: at, cliente_nome: 'Cliente', ...extra });

describe('agruparAgendaPorDia', () => {
  it('agrupa por dia LOCAL e rotula hoje e amanha', () => {
    const agora = new Date('2026-09-09T15:00:00-03:00');
    const g = agruparAgendaPorDia([
      ev('a', '2026-09-09T18:00:00-03:00'),
      ev('b', '2026-09-10T09:00:00-03:00'),
      ev('c', '2026-09-09T20:00:00-03:00'),
    ], agora);
    expect(g).toHaveLength(2);
    expect(g[0].dia).toBe('2026-09-09');
    expect(g[0].rotulo).toBe('Hoje');
    expect(g[0].itens).toHaveLength(2);
    expect(g[1].rotulo).toBe('Amanhã');
  });

  it('call das 21h30 BRT fica no dia de HOJE, nao no de amanha (bug do UTC)', () => {
    const agora = new Date('2026-09-09T21:00:00-03:00'); // 10/09 00:00 UTC
    const g = agruparAgendaPorDia([ev('a', '2026-09-09T21:30:00-03:00')], agora);
    expect(g[0].dia).toBe('2026-09-09');
    expect(g[0].rotulo).toBe('Hoje');
  });

  it('lista vazia devolve array vazio', () => {
    expect(agruparAgendaPorDia([], new Date())).toEqual([]);
  });
});

describe('marcarNovos', () => {
  it('marca como novo o que foi visto pela primeira vez depois da ultima visita', () => {
    const r = marcarNovos([
      ev('a', '2026-09-10T12:00:00Z', { primeiro_visto_em: '2026-09-09T10:00:00Z' }),
      ev('b', '2026-09-10T13:00:00Z', { primeiro_visto_em: '2026-09-08T10:00:00Z' }),
    ], '2026-09-09T08:00:00Z');
    expect(r.find((x) => x.event_id === 'a').novo).toBe(true);
    expect(r.find((x) => x.event_id === 'b').novo).toBe(false);
  });

  it('sem visita anterior NADA e novo (primeiro acesso nao pinta a agenda inteira)', () => {
    const r = marcarNovos([ev('a', '2026-09-10T12:00:00Z', { primeiro_visto_em: '2026-09-09T10:00:00Z' })], null);
    expect(r[0].novo).toBe(false);
  });

  it('evento sem primeiro_visto_em nunca e novo', () => {
    const r = marcarNovos([ev('a', '2026-09-10T12:00:00Z')], '2026-01-01T00:00:00Z');
    expect(r[0].novo).toBe(false);
  });
});

describe('ordenarNegociacao', () => {
  it('calcula dias parado e ordena do mais parado ao menos', () => {
    const agora = new Date('2026-09-09T12:00:00-03:00');
    const r = ordenarNegociacao([
      { lead_id: '1', ultima_call: '2026-09-08T12:00:00-03:00' },
      { lead_id: '2', ultima_call: '2026-09-04T12:00:00-03:00' },
      { lead_id: '3', ultima_call: '2026-09-06T12:00:00-03:00' },
    ], agora);
    expect(r.map((x) => x.lead_id)).toEqual(['2', '3', '1']);
    expect(r[0].diasParado).toBe(5);
    expect(r[2].diasParado).toBe(1);
  });

  it('call de hoje conta zero dia parado', () => {
    const agora = new Date('2026-09-09T18:00:00-03:00');
    const r = ordenarNegociacao([{ lead_id: '1', ultima_call: '2026-09-09T09:00:00-03:00' }], agora);
    expect(r[0].diasParado).toBe(0);
  });

  it('sem ultima_call vai para o fim, sem quebrar', () => {
    const agora = new Date('2026-09-09T12:00:00-03:00');
    const r = ordenarNegociacao([
      { lead_id: 'sem', ultima_call: null },
      { lead_id: 'com', ultima_call: '2026-09-01T12:00:00-03:00' },
    ], agora);
    expect(r[0].lead_id).toBe('com');
    expect(r[1].diasParado).toBe(null);
  });
});

describe('podeTransferir', () => {
  it('socio transfere de qualquer um', () => {
    expect(podeTransferir({ deQuem: 'beatriz@a.com', usuarioEmail: 'paulo@a.com', ehSocio: true })).toBe(true);
  });
  it('vendedor transfere so o proprio', () => {
    expect(podeTransferir({ deQuem: 'beatriz@a.com', usuarioEmail: 'beatriz@a.com', ehSocio: false })).toBe(true);
    expect(podeTransferir({ deQuem: 'beatriz@a.com', usuarioEmail: 'emerson@a.com', ehSocio: false })).toBe(false);
  });
  it('compara e-mail sem diferenciar maiuscula', () => {
    expect(podeTransferir({ deQuem: 'Beatriz@A.com', usuarioEmail: 'beatriz@a.com', ehSocio: false })).toBe(true);
  });
});

describe('validarDescarte', () => {
  it('tem os 5 motivos combinados com o Paulo', () => {
    expect(MOTIVOS_DESCARTE.map((m) => m.valor))
      .toEqual(['preco', 'sumiu', 'concorrente', 'custas', 'outro']);
  });
  it('motivo outro exige observacao', () => {
    expect(validarDescarte({ motivo: 'outro', observacao: '' }).ok).toBe(false);
    expect(validarDescarte({ motivo: 'outro', observacao: 'foi para outro escritorio' }).ok).toBe(true);
  });
  it('demais motivos dispensam observacao', () => {
    expect(validarDescarte({ motivo: 'preco', observacao: '' }).ok).toBe(true);
  });
  it('motivo desconhecido e recusado', () => {
    expect(validarDescarte({ motivo: 'chutei', observacao: '' }).ok).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
cd client && npx vitest run src/utils/__tests__/meuPainelCompute.test.js
```

Esperado: FALHA com `Failed to resolve import "../meuPainelCompute"`.

- [ ] **Passo 3: implementar**

Criar `client/src/utils/meuPainelCompute.js`:

```javascript
// Logica pura do Meu Painel. Sem React, sem Supabase — so contas, para poder testar.
// Datas SEMPRE em hora local (o vitest.setup.js fixa TZ=America/Sao_Paulo e o runtime
// do navegador dos vendedores e BRT). Nunca toISOString().slice(0,10) aqui.
import { ymdLocal } from './format';

const MS_DIA = 86400000;

/** Agrupa eventos por dia LOCAL, com rotulo amigavel para hoje e amanha. */
export function agruparAgendaPorDia(eventos = [], agora = new Date()) {
  const hoje = ymdLocal(agora);
  const amanha = ymdLocal(new Date(agora.getTime() + MS_DIA));
  const mapa = new Map();
  for (const e of eventos || []) {
    if (!e || !e.scheduled_at) continue;
    const dia = ymdLocal(new Date(e.scheduled_at));
    if (!mapa.has(dia)) mapa.set(dia, []);
    mapa.get(dia).push(e);
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dia, itens]) => ({
      dia,
      rotulo: dia === hoje ? 'Hoje' : dia === amanha ? 'Amanhã' : null,
      itens: itens.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
    }));
}

/**
 * Marca o que apareceu desde a ultima visita.
 * Sem visita anterior nada e novo: no primeiro acesso, pintar a agenda inteira de
 * "novo" nao informa nada.
 */
export function marcarNovos(eventos = [], ultimaVisitaISO = null) {
  const corte = ultimaVisitaISO ? new Date(ultimaVisitaISO).getTime() : null;
  return (eventos || []).map((e) => ({
    ...e,
    novo: !!(corte && e?.primeiro_visto_em && new Date(e.primeiro_visto_em).getTime() > corte),
  }));
}

/** Dias parados desde a ultima call + ordenacao do mais parado ao menos. */
export function ordenarNegociacao(linhas = [], agora = new Date()) {
  const t = agora.getTime();
  return (linhas || [])
    .map((l) => ({
      ...l,
      diasParado: l?.ultima_call
        ? Math.max(0, Math.floor((t - new Date(l.ultima_call).getTime()) / MS_DIA))
        : null,
    }))
    .sort((a, b) => (b.diasParado ?? -1) - (a.diasParado ?? -1));
}

/** Socio move de qualquer um; vendedor move so o proprio. */
export function podeTransferir({ deQuem, usuarioEmail, ehSocio } = {}) {
  if (ehSocio) return true;
  const a = (deQuem || '').toLowerCase();
  const b = (usuarioEmail || '').toLowerCase();
  return !!a && a === b;
}

export const MOTIVOS_DESCARTE = [
  { valor: 'preco', rotulo: 'Preço' },
  { valor: 'sumiu', rotulo: 'Sumiu' },
  { valor: 'concorrente', rotulo: 'Contratou concorrente' },
  { valor: 'custas', rotulo: 'Custas' },
  { valor: 'outro', rotulo: 'Outro' },
];

const VALIDOS = new Set(MOTIVOS_DESCARTE.map((m) => m.valor));

/** 'outro' exige justificativa — foi a condicao do Paulo ao escolher a lista. */
export function validarDescarte({ motivo, observacao } = {}) {
  if (!VALIDOS.has(motivo)) return { ok: false, erro: 'Escolha um motivo.' };
  if (motivo === 'outro' && !String(observacao || '').trim()) {
    return { ok: false, erro: 'Diga qual foi o motivo.' };
  }
  return { ok: true, erro: null };
}
```

- [ ] **Passo 4: rodar e ver passar**

```bash
cd client && npx vitest run src/utils/__tests__/meuPainelCompute.test.js
```

Esperado: **16 testes passando**.

- [ ] **Passo 5: rodar a suíte inteira**

```bash
cd client && npx vitest run
```

Esperado: 948 + 16 = **964 passando, 0 falhas**.

- [ ] **Passo 6: commit**

```bash
git add client/src/utils/meuPainelCompute.js client/src/utils/__tests__/meuPainelCompute.test.js
git commit -m "meu painel: logica pura (agenda, novos, dias parado, descarte, transferencia)"
```

---

### Task 5: Fonte de dados (`meuPainelSources.js`)

**Arquivos:**
- Criar: `client/src/utils/meuPainelSources.js`

**Interfaces:**
- Consome: as 3 views (Tasks 2 e 3), `fetchAllPaged` de `utils/supabasePaged.js`.
- Produz: `fetchAgenda(email)`, `fetchNegociacao(email, dias)`, `fetchPendencias(email)`,
  `fetchDistribuidos(email)`, `fetchVendedores()`. Consumido pelas Tasks 6 a 11.

- [ ] **Passo 1: implementar**

Criar `client/src/utils/meuPainelSources.js`:

```javascript
// Fonte UNICA das consultas do Meu Painel (mesmo papel do utils/funilSources.js).
//
// TODA consulta pagina por fetchAllPaged: o PostgREST corta em 1000 linhas e um
// .limit() maior NAO levanta esse teto — foi assim que o funil exibiu 112 calls no
// lugar de 191 em julho/26. As listas de hoje sao pequenas (40 leads, 18 contratos),
// mas crescem com a carteira e cairiam no mesmo buraco em silencio.
//
// ⚠️ ORDER BY termina sempre em coluna UNICA (lead_id, contrato_id, event_id).
import { supabase } from '../lib/supabase';
import { fetchAllPaged } from './supabasePaged';

/** Compromissos de hoje ate +7 dias, do vendedor. */
export function fetchAgenda(email) {
  const de = new Date(); de.setHours(0, 0, 0, 0);
  const ate = new Date(de.getTime() + 8 * 86400000);
  return fetchAllPaged(() =>
    supabase.from('agenda_videochamadas')
      .select('event_id, scheduled_at, cliente_nome, telefone, lead_id, tem_meet, raw, primeiro_visto_em, meet_status')
      .eq('vendedora_email', email)
      .neq('status', 'excluida')
      .gte('scheduled_at', de.toISOString())
      .lt('scheduled_at', ate.toISOString())
      .order('scheduled_at').order('event_id'));
}

/** Leads em negociacao. `dias` = 7 (padrao) ou 30. */
export function fetchNegociacao(email, dias = 7) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  return fetchAllPaged(() =>
    supabase.from('vw_vendedor_negociacao')
      .select('lead_id, vendedor_email, dono_padrao, transferido, atribuido_por, cliente_nome, telefone, ultima_call, calls_realizadas, calls_totais, primeira_call, resort_tag, voltou_apos_descarte')
      .eq('vendedor_email', email)
      .gte('ultima_call', desde)
      .order('ultima_call').order('lead_id'));
}

/** Pendencias (assinatura + documentacao) do vendedor. */
export function fetchPendencias(email) {
  return fetchAllPaged(() =>
    supabase.from('vw_vendedor_pendencias')
      .select('tipo, vendedor_email, contrato_id, lawsuit_id, cliente_nome, desde, dias, aberturas, nunca_abriu')
      .eq('vendedor_email', email)
      .order('dias', { ascending: false }).order('cliente_nome').order('tipo'));
}

/** Distribuidos do vendedor (a tela separa mes corrente e acumulado). */
export function fetchDistribuidos(email) {
  return fetchAllPaged(() =>
    supabase.from('vw_vendedor_distribuidos')
      .select('contrato_id, vendedor_email, cliente_nome, process_number, distribuido_em')
      .eq('vendedor_email', email)
      .order('distribuido_em', { ascending: false }).order('contrato_id'));
}

/** Os quatro closers, para o seletor "ver como" dos socios. */
export function fetchVendedores() {
  return Promise.resolve([
    { email: 'marianamaciel@advocaciacbc.com', nome: 'Mariana Beraldo' },
    { email: 'anacristina@advocaciacbc.com',   nome: 'Ana Cristina Piva' },
    { email: 'beatriz@advocaciacbc.com',       nome: 'Beatriz Cavalcante' },
    { email: 'emerson@advocaciacbc.com',       nome: 'Emerson Calista' },
  ]);
}
```

⚠️ A lista de vendedores é fixa de propósito: são as **únicas quatro** agendas que existem em
`agenda_videochamadas` (medido em 09/09), e é a mesma lista do `_lib/dossieClosers.mjs`. Se
entrar um closer novo, os dois lugares mudam juntos.

- [ ] **Passo 2: envolver as consultas no cache de aba (spec §7.4)**

Trocar de aba DESMONTA o painel: sem cache, voltar ao Meu Painel cinco segundos depois refaz
as quatro consultas. Acrescentar ao fim de `meuPainelSources.js`:

```javascript
import { lerCacheAba, gravarCacheAba, idadeCacheAba, TTL_PADRAO } from './cacheAba';

/**
 * Envolve uma das consultas acima com o cache de 5 min.
 * A chave inclui o VENDEDOR: trocar de pessoa no seletor nao pode servir a lista da anterior.
 * `forcar` (botao Atualizar) ignora o cache.
 */
export async function comCache(chave, consulta, forcar = false) {
  if (!forcar) {
    const idade = idadeCacheAba(chave);
    if (idade !== null && idade < TTL_PADRAO) return lerCacheAba(chave);
  }
  return gravarCacheAba(chave, await consulta());
}

export const chaveAgenda       = (email) => `meupainel:agenda:${email}`;
export const chaveNegociacao   = (email, dias) => `meupainel:negociacao:${email}:${dias}`;
export const chavePendencias   = (email) => `meupainel:pendencias:${email}`;
export const chaveDistribuidos = (email) => `meupainel:distribuidos:${email}`;
```

⚠️ **Toda gravação invalida a chave correspondente** (regra do `cacheAba.js`): descartar um
lead ou transferir precisa passar `forcar = true` na recarga seguinte, senão o painel mostra a
linha que o vendedor acabou de tirar. O `recarga` que já circula nos componentes serve para
isso: quando `recarga > 0`, passar `forcar = true`.

Nos componentes das Tasks 7 a 11, trocar a chamada direta pelo embrulho. Exemplo na agenda:

```javascript
    comCache(chaveAgenda(vendedorEmail), () => fetchAgenda(vendedorEmail), recarga > 0)
      .then((r) => { if (vivo) { setEventos(r); setErro(null); } })
```

- [ ] **Passo 3: conferir que compila e a suíte segue verde**

```bash
cd client && npx vitest run && npm run build
```

Esperado: 964 testes passando, build sem erro.

- [ ] **Passo 4: commit**

```bash
git add client/src/utils/meuPainelSources.js
git commit -m "meu painel: consultas paginadas das views, com cache de aba de 5 min"
```

---

### Task 6: Aba registrada e esqueleto do painel

**Arquivos:**
- Criar: `client/src/components/MeuPainelPanel.jsx`
- Modificar: `client/src/App.jsx` (lazy import, prefetch, rótulos, ícone, tabAllowed, allowedTabKeys, ramo de render)
- Modificar: `client/src/components/AdminPanel.jsx` (linha na matriz)

**Interfaces:**
- Consome: `meuPainelSources` (Task 5), `SOCIOS_EMAILS` de `utils/acessos`.
- Produz: aba `meu_painel` funcionando, com seletor "ver como" para sócios e o estado
  `vendedorAlvo` que as Tasks 7 a 11 consomem.

- [ ] **Passo 1: backup dos dois arquivos que serão modificados**

```bash
cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos"
TS=$(date +%Y%m%d_%H%M%S); mkdir -p "backups/${TS}_meu_painel"
cp client/src/App.jsx client/src/components/AdminPanel.jsx "backups/${TS}_meu_painel/"
```

- [ ] **Passo 2: criar o painel com o seletor e o esqueleto das seções**

Criar `client/src/components/MeuPainelPanel.jsx`:

```jsx
// Meu Painel — a tela do closer. Spec: docs/superpowers/specs/2026-09-09-painel-do-vendedor-design.md
//
// Cada vendedor ve o proprio funil; socio escolhe de quem quer ver.
// ⚠️ Isto e VISIBILIDADE DE TELA, nao seguranca: a RLS deste banco e allow-all
// (mesma limitacao que o Dashboard Socios tinha). Ver secao 5 da spec.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { SOCIOS_EMAILS } from '../utils/acessos';
import { fetchVendedores } from '../utils/meuPainelSources';
import { fmtDataHora } from '../utils/format';

export default function MeuPainelPanel() {
  const { user } = useAuth();
  const email = (user?.email || '').toLowerCase();
  const ehSocio = SOCIOS_EMAILS.includes(email);

  const [vendedores, setVendedores] = useState([]);
  const [alvo, setAlvo] = useState(email);
  const [carregadoEm, setCarregadoEm] = useState(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => { fetchVendedores().then(setVendedores); }, []);

  // Socio que nao e vendedor comeca vendo a de maior volume, senao a tela abre vazia.
  useEffect(() => {
    if (!vendedores.length) return;
    const souVendedor = vendedores.some((v) => v.email === email);
    if (!souVendedor && ehSocio) setAlvo(vendedores[0].email);
  }, [vendedores, email, ehSocio]);

  const atualizar = useCallback(() => {
    setRecarga((n) => n + 1);
    setCarregadoEm(new Date());
  }, []);

  useEffect(() => { setCarregadoEm(new Date()); }, [alvo]);

  const nomeAlvo = useMemo(
    () => vendedores.find((v) => v.email === alvo)?.nome || alvo,
    [vendedores, alvo]);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6" style={{ background: 'var(--cbc-bg)' }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold" style={{ color: 'var(--cbc-navy)' }}>
          {ehSocio && alvo !== email ? `Painel de ${nomeAlvo}` : 'Meu Painel'}
        </h1>
        <div className="flex items-center gap-3">
          {ehSocio && (
            <label className="flex items-center gap-2 text-xs">
              <span className="uppercase tracking-wide font-bold">Ver como</span>
              <select className="input-field py-1" value={alvo} onChange={(e) => setAlvo(e.target.value)}>
                {vendedores.map((v) => <option key={v.email} value={v.email}>{v.nome}</option>)}
              </select>
            </label>
          )}
          <span className="text-xs opacity-70">
            {carregadoEm ? `Carregado às ${fmtDataHora(carregadoEm).split(' ')[1]}` : ''}
          </span>
          <button type="button" className="btn-outline btn-sm" onClick={atualizar}>Atualizar</button>
        </div>
      </div>

      {/* As secoes entram nas Tasks 7 a 11, todas recebendo `alvo` e `recarga`. */}
      <div className="space-y-4" data-alvo={alvo} data-recarga={recarga} />
    </div>
  );
}
```

- [ ] **Passo 3: registrar a aba no `App.jsx`**

Cinco edições pontuais:

```javascript
// 1) junto dos outros lazy, depois de ClientesTab
const MeuPainelPanel = lazy(() => import('./components/MeuPainelPanel'));

// 2) em TAB_PREFETCH
  meu_painel: () => import('./components/MeuPainelPanel'),

// 3) em MOBILE_TAB_LABELS, logo apos `contratos`
  meu_painel: 'Meu Painel',

// 4) em TAB_ICONS (importar ClipboardDocumentListIcon do heroicons junto dos demais)
  meu_painel: ClipboardDocumentListIcon,

// 5) em tabAllowed, antes da linha do 'funil'
    if (tab === 'meu_painel') return SOCIOS_EMAILS.includes((user?.email || '').toLowerCase())
      || !!userPerms?.tabs?.meu_painel;
```

Em `allowedTabKeys`, inserir `'meu_painel'` logo depois de `'contratos'`:

```javascript
  const allowedTabKeys = ['novo', 'contratos', 'meu_painel', 'clientes', 'dashboard', 'funil', 'trafego', 'asaas', 'boletos', 'bot', 'portal', 'monitor', 'admin'].filter(tabAllowed);
```

No rótulo das top tabs, junto dos demais `tab === ...`:

```javascript
              : tab === 'meu_painel' ? 'Meu Painel'
```

No título do cabeçalho mobile, junto dos demais `mainTab === ...`:

```javascript
                    mainTab === 'meu_painel' ? 'Meu Painel' :
```

E o ramo de render, logo depois do ramo de `clientes`:

```jsx
      ) : mainTab === 'meu_painel' && tabAllowed('meu_painel') ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonDashboard />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="meu_painel" className="flex-1 overflow-hidden page-enter"><MeuPainelPanel /></TabScrollContainer></ErrorBoundary></Suspense>
```

- [ ] **Passo 4: acrescentar a linha na matriz do Admin**

Em `client/src/components/AdminPanel.jsx`, no `TAB_LIST`, depois de `contratos` (importar
`ClipboardDocumentListIcon` junto dos outros ícones):

```javascript
  { key: 'meu_painel', label: 'Meu Painel', Icon: ClipboardDocumentListIcon },
```

- [ ] **Passo 5: verificar no navegador**

```bash
cd client && npm run build
```

Depois abrir a preview (`preview_start` name `dev`), conferir no console que **não há erro** e
que a aba aparece na barra.

- [ ] **Passo 6: commit**

```bash
git add client/src/components/MeuPainelPanel.jsx client/src/App.jsx client/src/components/AdminPanel.jsx
git commit -m "meu painel: aba registrada, seletor de vendedor para socios e esqueleto"
```

---

### Task 7: Seção Agenda (hoje + 7 dias) com marca de novo

**Arquivos:**
- Criar: `client/src/components/meupainel/AgendaProximosDias.jsx`
- Modificar: `client/src/components/MeuPainelPanel.jsx`

**Interfaces:**
- Consome: `fetchAgenda` (Task 5), `agruparAgendaPorDia` e `marcarNovos` (Task 4).
- Produz: componente `<AgendaProximosDias vendedorEmail recarga />`.

- [ ] **Passo 1: criar o componente**

```jsx
// Agenda de hoje ate +7 dias. O "novo" e discreto de proposito (decisao do Paulo):
// ponto dourado e a palavra, sem sino, sem piscar, sem som.
//
// O carimbo de "ja vi" e por USUARIO LOGADO + VENDEDOR VISUALIZADO: o Paulo olhando o
// painel da Mariana nao consome o "novo" dela.
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../AuthContext';
import { fetchAgenda } from '../../utils/meuPainelSources';
import { agruparAgendaPorDia, marcarNovos } from '../../utils/meuPainelCompute';
import { fmtData } from '../../utils/format';

const chaveVisita = (usuario, alvo) => `cbc_meupainel_visita:${usuario}:${alvo}`;

function horaBR(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function AgendaProximosDias({ vendedorEmail, recarga }) {
  const { user } = useAuth();
  const usuario = (user?.email || '').toLowerCase();
  const [eventos, setEventos] = useState([]);
  const [erro, setErro] = useState(null);
  const [visitaAnterior, setVisitaAnterior] = useState(null);

  useEffect(() => {
    if (!vendedorEmail) return;
    let vivo = true;
    // le a visita anterior ANTES de gravar a de agora
    let anterior = null;
    try { anterior = localStorage.getItem(chaveVisita(usuario, vendedorEmail)); } catch { /* privado */ }
    setVisitaAnterior(anterior);
    fetchAgenda(vendedorEmail)
      .then((r) => { if (vivo) { setEventos(r); setErro(null); } })
      .catch((e) => { if (vivo) setErro(e.message || 'falha ao carregar a agenda'); });
    try { localStorage.setItem(chaveVisita(usuario, vendedorEmail), new Date().toISOString()); } catch { /* privado */ }
    return () => { vivo = false; };
  }, [vendedorEmail, recarga, usuario]);

  const dias = useMemo(
    () => agruparAgendaPorDia(marcarNovos(eventos, visitaAnterior), new Date()),
    [eventos, visitaAnterior]);

  if (erro) return <div className="card p-4 text-sm" style={{ color: 'var(--cbc-danger)' }}>Agenda: {erro}</div>;

  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide mb-3">Agenda dos próximos 7 dias</h2>
      {dias.length === 0 && <p className="text-sm opacity-70">Nenhum compromisso marcado até {fmtData(new Date(Date.now() + 7 * 86400000))}.</p>}
      {dias.map((d) => (
        <div key={d.dia} className="mb-3 last:mb-0">
          <h3 className="text-xs font-bold uppercase tracking-wide opacity-70 mb-1">
            {d.rotulo || fmtData(d.dia, { weekday: 'short', day: '2-digit', month: '2-digit' })}
          </h3>
          <ul className="space-y-1">
            {d.itens.map((e) => (
              <li key={e.event_id} className="flex items-center gap-2 text-sm">
                <span className="font-mono">{horaBR(e.scheduled_at)}</span>
                <span className="flex-1 truncate">{e.cliente_nome || 'Sem nome'}</span>
                {e.novo && (
                  <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--cbc-gold-text)' }}>
                    <span aria-hidden="true">●</span> novo
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Passo 2: montar no painel**

Em `MeuPainelPanel.jsx`, importar e trocar a `<div>` vazia do esqueleto:

```jsx
import AgendaProximosDias from './meupainel/AgendaProximosDias';
// ...
      <div className="space-y-4">
        <AgendaProximosDias vendedorEmail={alvo} recarga={recarga} />
      </div>
```

- [ ] **Passo 3: verificar no navegador**

Abrir a aba, conferir que a agenda carrega sem erro no console. Como há poucos compromissos
futuros (§4.2), o normal é ver poucas linhas ou a mensagem de vazio — **não é bug**.

- [ ] **Passo 4: commit**

```bash
git add client/src/components/meupainel/AgendaProximosDias.jsx client/src/components/MeuPainelPanel.jsx
git commit -m "meu painel: agenda de 7 dias com marca discreta de compromisso novo"
```

---

### Task 8: Faixas de pendência (assinatura e documentação)

**Arquivos:**
- Criar: `client/src/components/meupainel/FaixaPendencias.jsx`
- Modificar: `client/src/components/MeuPainelPanel.jsx`

**Interfaces:**
- Consome: `fetchPendencias` (Task 5).
- Produz: `<FaixaPendencias vendedorEmail recarga />`.

- [ ] **Passo 1: criar o componente**

```jsx
// Duas faixas de pendencia, e so aparecem se houver o que fazer (decisao do Paulo).
// 'nunca abriu' ganha destaque porque e o sinal mais forte de contrato esquecido:
// hoje sao 3 de 18.
import { useState, useEffect, useMemo } from 'react';
import { fetchPendencias } from '../../utils/meuPainelSources';

function Linha({ p }) {
  return (
    <li className="flex items-center gap-3 py-1.5 text-sm border-b last:border-0" style={{ borderColor: 'var(--cbc-border)' }}>
      <span className="flex-1 truncate">{p.cliente_nome || 'Sem nome'}</span>
      {p.tipo === 'assinatura' && (
        p.nunca_abriu
          ? <span className="text-xs font-bold" style={{ color: 'var(--cbc-danger)' }}>nunca abriu</span>
          : <span className="text-xs opacity-80">{p.aberturas}{p.aberturas === 1 ? ' abertura' : ' aberturas'}</span>
      )}
      <span className="text-xs opacity-70 whitespace-nowrap">{p.dias}{p.dias === 1 ? ' dia' : ' dias'}</span>
    </li>
  );
}

export default function FaixaPendencias({ vendedorEmail, recarga }) {
  const [linhas, setLinhas] = useState([]);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!vendedorEmail) return;
    let vivo = true;
    fetchPendencias(vendedorEmail)
      .then((r) => { if (vivo) { setLinhas(r); setErro(null); } })
      .catch((e) => { if (vivo) setErro(e.message || 'falha ao carregar as pendencias'); });
    return () => { vivo = false; };
  }, [vendedorEmail, recarga]);

  const assinatura = useMemo(() => linhas.filter((l) => l.tipo === 'assinatura'), [linhas]);
  const documentacao = useMemo(() => linhas.filter((l) => l.tipo === 'documentacao'), [linhas]);

  if (erro) return <div className="card p-4 text-sm" style={{ color: 'var(--cbc-danger)' }}>Pendências: {erro}</div>;
  if (!assinatura.length && !documentacao.length) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {assinatura.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Cobrar assinatura ({assinatura.length})</h2>
          <ul>{assinatura.map((p) => <Linha key={p.contrato_id} p={p} />)}</ul>
        </section>
      )}
      {documentacao.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Documentação faltando ({documentacao.length})</h2>
          <ul>{documentacao.map((p) => <Linha key={`${p.lawsuit_id}-${p.cliente_nome}`} p={p} />)}</ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Passo 2: montar no painel**

```jsx
import FaixaPendencias from './meupainel/FaixaPendencias';
// dentro da div de secoes, depois da agenda:
        <FaixaPendencias vendedorEmail={alvo} recarga={recarga} />
```

- [ ] **Passo 3: conferir contra o banco**

Com a aba aberta como Ana Cristina (via seletor de sócio), a faixa de assinatura deve mostrar
**7** e a de documentação a maioria dos **17**. Se der divergência, comparar com:

```sql
select tipo, count(*) from public.vw_vendedor_pendencias
where vendedor_email='anacristina@advocaciacbc.com' group by 1;
```

- [ ] **Passo 4: commit**

```bash
git add client/src/components/meupainel/FaixaPendencias.jsx client/src/components/MeuPainelPanel.jsx
git commit -m "meu painel: faixas de cobrar assinatura e documentacao faltando"
```

---

### Task 9: Lista de leads em negociação com link para o Kommo

**Arquivos:**
- Criar: `client/src/components/meupainel/ListaNegociacao.jsx`
- Modificar: `client/src/components/MeuPainelPanel.jsx`

**Interfaces:**
- Consome: `fetchNegociacao` (Task 5), `ordenarNegociacao` (Task 4).
- Produz: `<ListaNegociacao vendedorEmail recarga onDescartar onTransferir />`; os dois
  callbacks são preenchidos nas Tasks 10 e 12.

- [ ] **Passo 1: criar o componente**

```jsx
// Corpo do painel: quem compareceu a videochamada e ainda nao tem contrato.
// Quem FALTOU nao entra (decisao do Paulo) — a recuperacao de no-show cuida deles.
//
// O nome e o link para a conversa no Kommo, em outra aba. rel="noopener" e obrigatorio:
// sem ele a pagina aberta ganha acesso a window.opener.
import { useState, useEffect, useMemo } from 'react';
import { fetchNegociacao } from '../../utils/meuPainelSources';
import { ordenarNegociacao } from '../../utils/meuPainelCompute';
import { fmtData } from '../../utils/format';

const urlKommo = (leadId) => `https://advocaciacbc.kommo.com/leads/detail/${leadId}`;

export default function ListaNegociacao({ vendedorEmail, recarga, onDescartar, onTransferir }) {
  const [linhas, setLinhas] = useState([]);
  const [dias, setDias] = useState(7);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!vendedorEmail) return;
    let vivo = true;
    setCarregando(true);
    fetchNegociacao(vendedorEmail, dias)
      .then((r) => { if (vivo) { setLinhas(r); setErro(null); } })
      .catch((e) => { if (vivo) setErro(e.message || 'falha ao carregar os leads'); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [vendedorEmail, recarga, dias]);

  const ordenadas = useMemo(() => ordenarNegociacao(linhas, new Date()), [linhas]);

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">
          Em negociação ({ordenadas.length})
        </h2>
        <label className="flex items-center gap-2 text-xs">
          <span className="uppercase tracking-wide">Período</span>
          <select className="input-field py-1" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={7}>últimos 7 dias</option>
            <option value={30}>últimos 30 dias</option>
          </select>
        </label>
      </div>

      {erro && <p className="text-sm" style={{ color: 'var(--cbc-danger)' }}>{erro}</p>}
      {!erro && !carregando && ordenadas.length === 0 && (
        <p className="text-sm opacity-70">
          Nenhum lead em negociação nos últimos {dias} dias. Aparecem aqui os clientes que
          compareceram à videochamada e ainda não têm contrato.
        </p>
      )}

      <ul className="divide-y" style={{ borderColor: 'var(--cbc-border)' }}>
        {ordenadas.map((l) => (
          <li key={l.lead_id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <a href={urlKommo(l.lead_id)} target="_blank" rel="noopener noreferrer"
               className="font-bold underline decoration-dotted"
               style={{ color: 'var(--cbc-navy)' }}>
              {l.cliente_nome || `Lead ${l.lead_id}`}
            </a>
            {l.telefone && <span className="opacity-80">{l.telefone}</span>}
            {l.resort_tag && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--cbc-bg-subtle)' }}>{l.resort_tag}</span>}
            {l.calls_totais > 1 && <span className="text-xs opacity-70">{l.calls_totais}ª conversa</span>}
            {l.voltou_apos_descarte && <span className="text-xs font-bold" style={{ color: 'var(--cbc-gold-text)' }}>voltou</span>}
            {l.transferido && <span className="text-xs opacity-70">recebido de {l.dono_padrao?.split('@')[0]}</span>}
            <span className="text-xs opacity-70 whitespace-nowrap">
              {l.diasParado === 0 ? 'hoje' : `há ${l.diasParado} ${l.diasParado === 1 ? 'dia' : 'dias'}`}
              {' · '}{fmtData(l.ultima_call)}
            </span>
            <span className="ml-auto flex gap-2">
              <button type="button" className="btn-outline btn-sm" onClick={() => onTransferir?.(l)}>Transferir</button>
              <button type="button" className="btn-outline btn-sm" onClick={() => onDescartar?.(l)}>Não fechou</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Passo 2: montar no painel**

```jsx
import ListaNegociacao from './meupainel/ListaNegociacao';
// depois das pendencias:
        <ListaNegociacao vendedorEmail={alvo} recarga={recarga} />
```

- [ ] **Passo 3: conferir no navegador**

Com o seletor em Mariana, a lista deve trazer ~14 linhas em 7 dias e ~85 em 30. Clicar num
nome abre o Kommo em outra aba. Console sem erro.

- [ ] **Passo 4: commit**

```bash
git add client/src/components/meupainel/ListaNegociacao.jsx client/src/components/MeuPainelPanel.jsx
git commit -m "meu painel: lista de leads em negociacao com link para a conversa do Kommo"
```

---

### Task 10: Botão "não fechou" com motivo

**Arquivos:**
- Criar: `client/src/components/meupainel/ModalNaoFechou.jsx`
- Modificar: `client/src/components/MeuPainelPanel.jsx`

**Interfaces:**
- Consome: `MOTIVOS_DESCARTE` e `validarDescarte` (Task 4), tabela
  `vendedor_leads_descartados` (Task 1), `useModalEscape` de `hooks/useModalEscape`.
- Produz: `<ModalNaoFechou lead vendedorEmail onFechar onPronto />`.

- [ ] **Passo 1: criar o modal**

```jsx
// Descarte de lead. 'Outro' exige justificativa (condicao do Paulo ao escolher a lista).
// O lead volta sozinho se houver call realizada depois do descarte — a view cuida disso.
import { useState } from 'react';
import { useAuth } from '../../AuthContext';
import { supabase } from '../../lib/supabase';
import { useModalEscape } from '../../hooks/useModalEscape';
import { MOTIVOS_DESCARTE, validarDescarte } from '../../utils/meuPainelCompute';
import { friendlyError } from '../../utils/friendlyError';

export default function ModalNaoFechou({ lead, vendedorEmail, onFechar, onPronto }) {
  const { user } = useAuth();
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  useModalEscape(!!lead, onFechar);

  if (!lead) return null;

  async function salvar() {
    const v = validarDescarte({ motivo, observacao });
    if (!v.ok) { setErro(v.erro); return; }
    setSalvando(true);
    try {
      const { error } = await supabase.from('vendedor_leads_descartados').insert({
        lead_id: String(lead.lead_id),
        vendedor_email: vendedorEmail,
        motivo,
        observacao: observacao.trim() || null,
        descartado_por: (user?.email || '').toLowerCase(),
      });
      if (error) throw error;
      onPronto?.();
      onFechar?.();
    } catch (e) {
      setErro(friendlyError(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }}>
      <div className="card w-full max-w-md p-5" role="dialog" aria-modal="true" aria-label="Marcar lead como não fechado">
        <h2 className="text-base font-bold mb-1">{lead.cliente_nome || `Lead ${lead.lead_id}`}</h2>
        <p className="text-xs opacity-70 mb-4">Sai da lista de negociação. Volta sozinho se agendar nova conversa.</p>

        <fieldset className="mb-3">
          <legend className="text-xs font-bold uppercase tracking-wide mb-1">Motivo</legend>
          {MOTIVOS_DESCARTE.map((m) => (
            <label key={m.valor} className="flex items-center gap-2 py-1 text-sm">
              <input type="radio" name="motivo" value={m.valor}
                     checked={motivo === m.valor}
                     onChange={() => { setMotivo(m.valor); setErro(null); }} />
              {m.rotulo}
            </label>
          ))}
        </fieldset>

        {motivo === 'outro' && (
          <label className="block mb-3">
            <span className="text-xs font-bold uppercase tracking-wide">Qual foi o motivo</span>
            <input className="input-field w-full mt-1" value={observacao}
                   onChange={(e) => { setObservacao(e.target.value); setErro(null); }}
                   autoFocus maxLength={200} />
          </label>
        )}

        {erro && <p className="text-sm mb-3" style={{ color: 'var(--cbc-danger)' }}>{erro}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline btn-sm" onClick={onFechar}>Cancelar</button>
          <button type="button" className="btn-primary btn-sm" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Passo 2: ligar no painel**

```jsx
import ModalNaoFechou from './meupainel/ModalNaoFechou';
// estado:
  const [descartando, setDescartando] = useState(null);
// na lista:
        <ListaNegociacao vendedorEmail={alvo} recarga={recarga} onDescartar={setDescartando} />
// no fim do JSX, antes de fechar a div raiz:
      <ModalNaoFechou lead={descartando} vendedorEmail={alvo}
        onFechar={() => setDescartando(null)} onPronto={atualizar} />
```

- [ ] **Passo 3: testar o caminho completo em produção-espelho**

Com um lead real de teste: clicar "Não fechou", escolher "Outro" **sem** preencher (deve
recusar), preencher e confirmar. Conferir no banco:

```sql
select * from public.vendedor_leads_descartados order by descartado_em desc limit 3;
```

Depois conferir que o lead **sumiu** da lista ao clicar em Atualizar.

- [ ] **Passo 4: commit**

```bash
git add client/src/components/meupainel/ModalNaoFechou.jsx client/src/components/MeuPainelPanel.jsx
git commit -m "meu painel: botao nao fechou com motivo obrigatorio"
```

---

### Task 11: Placar de distribuídos

**Arquivos:**
- Criar: `client/src/components/meupainel/PlacarDistribuidos.jsx`
- Modificar: `client/src/components/MeuPainelPanel.jsx`

**Interfaces:**
- Consome: `fetchDistribuidos` (Task 5), `ymLocal` de `utils/format`.
- Produz: `<PlacarDistribuidos vendedorEmail recarga />`.

- [ ] **Passo 1: criar o componente**

```jsx
// Placar de processos distribuidos: mes corrente + acumulado, com a lista ao clicar.
// Conta pela data de CONCLUSAO da tarefa DISTRIBUIR ACAO (decisao do Paulo).
//
// ⚠️ ymLocal e nao toISOString: distribuicao concluida as 21h30 BRT pertence ao mes
// local, nao ao mes UTC do dia seguinte.
import { useState, useEffect, useMemo } from 'react';
import { fetchDistribuidos } from '../../utils/meuPainelSources';
import { ymLocal, fmtData } from '../../utils/format';

export default function PlacarDistribuidos({ vendedorEmail, recarga }) {
  const [linhas, setLinhas] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!vendedorEmail) return;
    let vivo = true;
    fetchDistribuidos(vendedorEmail)
      .then((r) => { if (vivo) { setLinhas(r); setErro(null); } })
      .catch((e) => { if (vivo) setErro(e.message || 'falha ao carregar os distribuidos'); });
    return () => { vivo = false; };
  }, [vendedorEmail, recarga]);

  const mesAtual = ymLocal(new Date());
  const doMes = useMemo(
    () => linhas.filter((l) => l.distribuido_em && ymLocal(new Date(l.distribuido_em)) === mesAtual),
    [linhas, mesAtual]);

  if (erro) return <div className="card p-4 text-sm" style={{ color: 'var(--cbc-danger)' }}>Distribuídos: {erro}</div>;

  return (
    <section className="card p-4">
      <button type="button" className="w-full flex items-center justify-between gap-3 text-left"
              onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <h2 className="text-sm font-bold uppercase tracking-wide">Processos distribuídos</h2>
        <span className="text-sm">
          <strong style={{ color: 'var(--cbc-gold-text)' }}>{doMes.length}</strong> este mês
          <span className="opacity-60"> · {linhas.length} no total</span>
        </span>
      </button>

      {aberto && (
        <ul className="mt-3 divide-y" style={{ borderColor: 'var(--cbc-border)' }}>
          {linhas.length === 0 && <li className="py-2 text-sm opacity-70">Nenhum processo distribuído ainda.</li>}
          {linhas.map((l) => (
            <li key={l.contrato_id} className="py-1.5 flex items-center gap-3 text-sm">
              <span className="flex-1 truncate">{l.cliente_nome}</span>
              <span className="font-mono text-xs opacity-80">{l.process_number}</span>
              <span className="text-xs opacity-70 whitespace-nowrap">{fmtData(l.distribuido_em)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Passo 2: montar no painel**

```jsx
import PlacarDistribuidos from './meupainel/PlacarDistribuidos';
// por ultimo na lista de secoes:
        <PlacarDistribuidos vendedorEmail={alvo} recarga={recarga} />
```

- [ ] **Passo 3: conferir o total contra o banco**

Com o seletor em Mariana, o acumulado deve ser **127**. Conferir com a consulta do Passo 4 da
Task 3.

- [ ] **Passo 4: commit**

```bash
git add client/src/components/meupainel/PlacarDistribuidos.jsx client/src/components/MeuPainelPanel.jsx
git commit -m "meu painel: placar de processos distribuidos no mes e acumulado"
```

---

### Task 12: Tags do Kommo em lote (resort do lead)

**Arquivos:**
- Criar: `client/netlify/functions/kommo-tags-lote.mjs`
- Modificar: `client/src/components/meupainel/ListaNegociacao.jsx`

**Interfaces:**
- Consome: `resolveResortTag` de `client/src/utils/kommoResolve.js` (lógica já em produção),
  `kommoGet` de `_lib/kommo.mjs`, tabela `kommo_lead_tags` (Task 1).
- Produz: endpoint `POST /.netlify/functions/kommo-tags-lote` com corpo `{ leadIds: string[] }`
  devolvendo `{ ok:true, atualizados:int }`.

⚠️ **A lógica do resolvedor não pode ser duplicada.** `resolveResortTag` vive em
`client/src/utils/kommoResolve.js` e as functions não importam do `src/`. Copiar o algoritmo
criaria duas cópias que divergem — foi exatamente assim que nasceu o bug do Edmar (dois mapas
ADVBOX). **Antes de escrever a function, mover a parte pura (`resolveResortTag`,
`RESORTS_BY_LEN`, `RESORT_FIRST_WORD`, `RESORT_ALIASES`, `norm`) para
`client/netlify/functions/_lib/resortTag.mjs` e fazer o `kommoResolve.js` importar de lá**,
mantendo os 10 testes existentes verdes.

- [ ] **Passo 1: extrair o resolvedor para `_lib/resortTag.mjs`**

Mover as funções puras citadas acima. Em `client/src/utils/kommoResolve.js`, substituir as
definições por:

```javascript
export { resolveResortTag, resortsDistintos } from '../../netlify/functions/_lib/resortTag.mjs';
```

- [ ] **Passo 2: rodar os testes existentes do kommoResolve**

```bash
cd client && npx vitest run src/utils/__tests__/kommoResolve.test.js
```

Esperado: **passam sem alteração**. Se falharem, a extração levou junto algo que dependia do
módulo original — reverta e mova em pedaços menores.

- [ ] **Passo 3: escrever a function**

```javascript
/**
 * Tags dos leads em lote, para o Meu Painel mostrar o resort de quem ainda nao tem contrato.
 *
 * POR QUE EM LOTE: a lista de negociacao tem ate ~85 leads por vendedor. Uma chamada por
 * lead estouraria o Kommo; o filtro filter[id][] aceita ate 250 de uma vez, entao uma
 * requisicao resolve a tela inteira.
 *
 * POR QUE ESPELHAR: sem cache, cada F5 do painel bate no Kommo de novo.
 *
 * ⚠️ Grava so em kommo_lead_tags. NAO tocar em kommo_leads nem na RPC kommo_leads_upsert:
 * o sync diario funciona ha meses e nao deve depender disto.
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { kommoGet } from './_lib/kommo.mjs';
import { resolveResortTag } from './_lib/resortTag.mjs';

const JSONH = { 'Content-Type': 'application/json' };
const resp = (s, b) => new Response(JSON.stringify(b), { status: s, headers: JSONH });
const TETO = 250;      // limite do filter[id][] do Kommo
const VALIDADE_H = 24; // tag muda pouco; 24h evita rebater no Kommo a cada F5

export default async (req) => {
  if (req.method !== 'POST') return resp(405, { error: 'use POST' });

  let corpo = {};
  try { corpo = await req.json(); } catch { return resp(400, { error: 'corpo invalido' }); }
  const pedidos = [...new Set((corpo.leadIds || []).map(String).filter(Boolean))].slice(0, TETO);
  if (!pedidos.length) return resp(200, { ok: true, atualizados: 0 });

  // so busca o que esta velho ou nunca foi buscado
  const corte = new Date(Date.now() - VALIDADE_H * 3600000).toISOString();
  const { data: frescos } = await db.from('kommo_lead_tags')
    .select('lead_id').in('lead_id', pedidos).gte('atualizado_em', corte);
  const jaTem = new Set((frescos || []).map((r) => r.lead_id));
  const buscar = pedidos.filter((id) => !jaTem.has(id));
  if (!buscar.length) return resp(200, { ok: true, atualizados: 0, cache: pedidos.length });

  let leads = [];
  try {
    const qs = buscar.map((id) => `filter[id][]=${encodeURIComponent(id)}`).join('&');
    const j = await kommoGet(`/leads?${qs}&limit=${TETO}`);
    leads = j?._embedded?.leads || [];
  } catch (e) {
    // Kommo fora nao pode derrubar o painel: o resort e enfeite, o resto da tela vale.
    await logAdvbox('kommo', 'aviso', `kommo-tags-lote: ${String(e.message || e).slice(0, 200)}`, { pedidos: buscar.length });
    return resp(200, { ok: false, atualizados: 0, motivo: 'kommo_indisponivel' });
  }

  const linhas = leads.map((l) => {
    const tags = (l?._embedded?.tags || []).map((t) => t?.name).filter(Boolean);
    const resorts = [...new Set(tags.map(resolveResortTag).filter(Boolean))];
    return {
      lead_id: String(l.id),
      tags,
      // 2 resorts distintos na mesma lista = ambiguo; nao adivinha (mesma regra do Vincular)
      resort_resolvido: resorts.length === 1 ? resorts[0] : null,
      atualizado_em: new Date().toISOString(),
    };
  });

  if (linhas.length) {
    const { error } = await db.from('kommo_lead_tags').upsert(linhas, { onConflict: 'lead_id' });
    if (error) return resp(500, { error: error.message });
  }
  return resp(200, { ok: true, atualizados: linhas.length });
};

export const config = { path: '/.netlify/functions/kommo-tags-lote' };
```

- [ ] **Passo 4: chamar da lista de negociação**

Em `ListaNegociacao.jsx`, depois do `fetchNegociacao` resolver, pedir as tags que faltam e
recarregar uma vez:

```javascript
      .then(async (r) => {
        if (!vivo) return;
        setLinhas(r); setErro(null);
        const semTag = r.filter((l) => !l.resort_tag).map((l) => l.lead_id);
        if (!semTag.length) return;
        try {
          const resp = await fetch('/.netlify/functions/kommo-tags-lote', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadIds: semTag }),
          });
          const j = await resp.json();
          if (vivo && j?.atualizados > 0) {
            const novo = await fetchNegociacao(vendedorEmail, dias);
            if (vivo) setLinhas(novo);
          }
        } catch { /* resort e enfeite: falhar aqui nao pode quebrar a lista */ }
      })
```

- [ ] **Passo 5: conferir a sintaxe das functions e a suíte**

```bash
cd client && npm run check:functions && npx vitest run
```

Esperado: `functions: sintaxe ok em 149 arquivos` e a suíte verde.

- [ ] **Passo 6: commit**

```bash
git add client/netlify/functions/kommo-tags-lote.mjs client/netlify/functions/_lib/resortTag.mjs client/src/utils/kommoResolve.js client/src/components/meupainel/ListaNegociacao.jsx
git commit -m "meu painel: resort do lead pela tag do Kommo, buscada em lote"
```

---

### Task 13: Transferência de lead entre vendedores

**Arquivos:**
- Criar: `client/src/components/meupainel/ModalTransferir.jsx`
- Criar: `client/netlify/functions/vendedor-transferir.mjs`
- Modificar: `client/src/components/MeuPainelPanel.jsx`

**Interfaces:**
- Consome: `podeTransferir` (Task 4), `vendedor_atribuicao` (Task 1), `enqueueKommo` de
  `_lib/kommo.mjs`.
- Produz: endpoint `POST /.netlify/functions/vendedor-transferir` com corpo
  `{ leadId, paraEmail, motivo }`.

⚠️ **Passo bloqueante antes de qualquer escrita no Kommo:** o usuário `15284979` aparece em
todas as agendas com 3.982 leads e ninguém sabe quem é (spec §4.8). Ler `GET /users` da API do
Kommo, montar a tabela id → nome → e-mail e **mostrar ao Paulo** antes de ligar a troca de
responsável. Escrever responsável errado no CRM é difícil de desfazer.

- [ ] **Passo 1: descobrir os usuários reais do Kommo**

Criar `<scratchpad>/kommo_users.mjs` (scratchpad da sessão, NÃO versionar):

```javascript
// Lista os usuarios do Kommo para confirmar o mapa e-mail -> id antes de escrever no CRM.
// ⚠️ `netlify env:get` e flaky (memoria kommo-token-runbook); use a API de contas com o
// token pessoal em ~/.cbc-netlify-token, ou rode isto de dentro de uma function temporaria.
const TOKEN = process.env.KOMMO_TOKEN;
if (!TOKEN) { console.error('exporte KOMMO_TOKEN antes de rodar'); process.exit(1); }
const r = await fetch('https://advocaciacbc.kommo.com/api/v4/users?limit=250', {
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
});
if (!r.ok) { console.error('kommo respondeu', r.status); process.exit(1); }
const j = await r.json();
for (const u of j?._embedded?.users || []) {
  console.log(String(u.id).padEnd(12), (u.name || '').padEnd(38), u.email || '');
}
```

Rodar com `node <scratchpad>/kommo_users.mjs` e comparar com o mapa da spec:

| Vendedora | id esperado |
|---|---|
| Ana Piva | 15297463 |
| Emerson | 15562427 |
| Beatriz | 15297507 |
| Mariana | 15297447 |

**Mostrar o resultado ao Paulo, inclusive quem é o 15284979, e só seguir com a confirmação
dele.** Se algum id divergir, corrigir o mapa do Passo 2 antes de continuar.

- [ ] **Passo 2: escrever a function**

```javascript
/**
 * Transfere um lead (e tudo que nasceu dele) de um vendedor para outro.
 *
 * TRAVAS, nesta ordem:
 *  1) sessao real do Supabase (db.auth.getUser), nunca flag vinda do navegador;
 *  2) socio move de qualquer um; vendedor move so o proprio lead.
 *
 * O reflexo no Kommo vai pela FILA (kommo_queue): se o Kommo estiver fora, completa
 * depois em vez de perder a troca.
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { enqueueKommo, drainNow } from './_lib/kommo.mjs';

const JSONH = { 'Content-Type': 'application/json' };
const resp = (s, b) => new Response(JSON.stringify(b), { status: s, headers: JSONH });

const SOCIOS = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com', 'lorenza@advocaciacbc.com'];

// Confirmado pelo Paulo em 09/09/2026 (spec 4.8). Conferir no GET /users antes de usar.
const KOMMO_USER = {
  'marianamaciel@advocaciacbc.com': 15297447,
  'anacristina@advocaciacbc.com':   15297463,
  'beatriz@advocaciacbc.com':       15297507,
  'emerson@advocaciacbc.com':       15562427,
};

export default async (req) => {
  if (req.method !== 'POST') return resp(405, { error: 'use POST' });

  let c = {};
  try { c = await req.json(); } catch { return resp(400, { error: 'corpo invalido' }); }
  const leadId = String(c.leadId || '').trim();
  const paraEmail = String(c.paraEmail || '').trim().toLowerCase();
  if (!leadId) return resp(400, { error: 'lead nao informado' });
  if (!KOMMO_USER[paraEmail]) return resp(400, { error: 'destinatario nao e um closer conhecido' });

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return resp(401, { error: 'sem sessao' });
  const { data: u, error: authErr } = await db.auth.getUser(jwt);
  const quem = (u?.user?.email || '').toLowerCase();
  if (authErr || !quem) return resp(401, { error: 'sessao invalida — faca login de novo' });

  const ehSocio = SOCIOS.includes(quem);
  if (!ehSocio) {
    const { data: dono } = await db.from('vw_vendedor_negociacao')
      .select('vendedor_email').eq('lead_id', leadId).maybeSingle();
    if (!dono || dono.vendedor_email?.toLowerCase() !== quem) {
      return resp(403, { error: 'voce so pode transferir os seus proprios leads' });
    }
  }

  const { error } = await db.from('vendedor_atribuicao').upsert({
    entidade: 'lead', entidade_id: leadId,
    vendedor_email: paraEmail, atribuido_por: quem,
    atribuido_em: new Date().toISOString(),
    motivo: String(c.motivo || '').slice(0, 200) || null,
  }, { onConflict: 'entidade,entidade_id' });
  if (error) return resp(500, { error: error.message });

  // reflexo no Kommo, pela fila
  try {
    const job = await enqueueKommo('lead_field', {
      leadId, responsibleUserId: KOMMO_USER[paraEmail],
    }, { dedupeKey: `transfer:${leadId}:${paraEmail}` });
    drainNow(job).catch(() => { /* a fila retenta sozinha */ });
  } catch (e) {
    await logAdvbox('kommo', 'aviso', `transferencia gravada, Kommo pendente: ${String(e.message || e).slice(0, 200)}`, { leadId });
  }

  await logAdvbox('kommo', 'info', `lead ${leadId} transferido para ${paraEmail} por ${quem}`, { leadId, paraEmail, quem });
  return resp(200, { ok: true });
};

export const config = { path: '/.netlify/functions/vendedor-transferir' };
```

⚠️ Conferir em `_lib/kommo.mjs` se `opLeadField` aceita `responsibleUserId`; a linha 146 já
monta `body[0].responsible_user_id`. Se o parâmetro tiver outro nome no `enqueueKommo`, ajustar
aqui — **não** alterar a lib, que serve à cobrança e ao link de assinatura.

- [ ] **Passo 3: criar o modal**

```jsx
// Transferir lead. Socio move de qualquer um; vendedor move so o proprio.
import { useState } from 'react';
import { useAuth } from '../../AuthContext';
import { supabase } from '../../lib/supabase';
import { useModalEscape } from '../../hooks/useModalEscape';
import { friendlyError } from '../../utils/friendlyError';

export default function ModalTransferir({ lead, vendedores, deQuem, onFechar, onPronto }) {
  const { user } = useAuth();
  const [para, setPara] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  useModalEscape(!!lead, onFechar);

  if (!lead) return null;
  const opcoes = vendedores.filter((v) => v.email !== deQuem);

  async function enviar() {
    if (!para) { setErro('Escolha para quem vai.'); return; }
    setSalvando(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const r = await fetch('/.netlify/functions/vendedor-transferir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token || ''}` },
        body: JSON.stringify({ leadId: String(lead.lead_id), paraEmail: para, motivo }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'falha ao transferir');
      onPronto?.(); onFechar?.();
    } catch (e) {
      setErro(friendlyError(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }}>
      <div className="card w-full max-w-md p-5" role="dialog" aria-modal="true" aria-label="Transferir lead">
        <h2 className="text-base font-bold mb-1">{lead.cliente_nome || `Lead ${lead.lead_id}`}</h2>
        <p className="text-xs opacity-70 mb-4">
          Vai junto tudo que nasceu deste lead: contrato, cobrança de assinatura e o crédito no
          placar. O responsável no Kommo também muda.
        </p>
        <label className="block mb-3">
          <span className="text-xs font-bold uppercase tracking-wide">Para</span>
          <select className="input-field w-full mt-1" value={para} onChange={(e) => { setPara(e.target.value); setErro(null); }}>
            <option value="">escolha...</option>
            {opcoes.map((v) => <option key={v.email} value={v.email}>{v.nome}</option>)}
          </select>
        </label>
        <label className="block mb-3">
          <span className="text-xs font-bold uppercase tracking-wide">Motivo (opcional)</span>
          <input className="input-field w-full mt-1" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
        </label>
        {erro && <p className="text-sm mb-3" style={{ color: 'var(--cbc-danger)' }}>{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline btn-sm" onClick={onFechar}>Cancelar</button>
          <button type="button" className="btn-primary btn-sm" onClick={enviar} disabled={salvando}>
            {salvando ? 'Transferindo...' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Passo 4: ligar no painel**

```jsx
import ModalTransferir from './meupainel/ModalTransferir';
// estado:
  const [transferindo, setTransferindo] = useState(null);
// na lista:
        <ListaNegociacao vendedorEmail={alvo} recarga={recarga}
          onDescartar={setDescartando} onTransferir={setTransferindo} />
// junto do outro modal:
      <ModalTransferir lead={transferindo} vendedores={vendedores} deQuem={alvo}
        onFechar={() => setTransferindo(null)} onPronto={atualizar} />
```

⚠️ O botão "Transferir" da lista só aparece quando `podeTransferir({ deQuem: l.vendedor_email,
usuarioEmail: email, ehSocio })` for verdadeiro — passar `ehSocio` e `email` como props da
`ListaNegociacao` e envolver o botão nessa condição.

- [ ] **Passo 5: testar as travas em produção**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://contratos-cbc.netlify.app/.netlify/functions/vendedor-transferir
```

Esperado: **401** (sem sessão), nunca 502. Depois, logado, testar o caminho feliz com um lead
de teste e conferir:

```sql
select * from public.vendedor_atribuicao order by atribuido_em desc limit 3;
select kind, status, payload->>'leadId' from kommo_queue order by id desc limit 3;
```

- [ ] **Passo 6: commit**

```bash
git add client/src/components/meupainel/ModalTransferir.jsx client/netlify/functions/vendedor-transferir.mjs client/src/components/MeuPainelPanel.jsx client/src/components/meupainel/ListaNegociacao.jsx
git commit -m "meu painel: transferencia de lead entre vendedores, com reflexo no Kommo"
```

---

### Task 14: Verificação final e deploy

**Arquivos:** nenhum novo.

- [ ] **Passo 1: portão completo**

```bash
cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos" && npm run verificar
```

Esperado: suíte verde (964+), build ok, `Lint estavel: 18 erros (baseline 18)`,
`functions: sintaxe ok em 150 arquivos`, `edge functions: sintaxe ok`.

- [ ] **Passo 2: conferir a cobertura e o piso**

```bash
cd client && npm run test:coverage
```

O piso está em 41/74/80. Se a cobertura tiver subido, **subir o piso junto** em
`vitest.config.js` — piso que fica para trás vira enfeite.

- [ ] **Passo 3: conferir no navegador, nas duas contas**

Com a preview local: entrar como vendedor (só vê o próprio painel, sem seletor) e como sócio
(seletor com os quatro nomes). Conferir modo claro e escuro. Console sem erro.

- [ ] **Passo 4: deploy**

```bash
cd client && ./deploy.sh
```

Esperado: smoke `200/200/200`.

- [ ] **Passo 5: conferir em produção**

```bash
curl -s https://contratos-cbc.netlify.app/version.json
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://contratos-cbc.netlify.app/.netlify/functions/vendedor-transferir
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://contratos-cbc.netlify.app/.netlify/functions/kommo-tags-lote
```

Esperado: `arvore_suja: false`; `vendedor-transferir` **401**; `kommo-tags-lote` **400**
(corpo inválido). Qualquer **502** significa import quebrado no bundle.

- [ ] **Passo 6: liberar a permissão para os quatro closers**

```sql
update public.user_permissions
   set tabs = tabs || '{"meu_painel": true}'::jsonb
 where email in ('marianamaciel@advocaciacbc.com','anacristina@advocaciacbc.com',
                 'beatriz@advocaciacbc.com','emerson@advocaciacbc.com');
```

- [ ] **Passo 7: atualizar o guia e o ChangeLog**

No `client/src/components/ChangeLog.jsx`, no topo do array `VERSIONS`:

```javascript
  {
    version: '6.8.0',
    date: '<data do deploy>',
    title: 'Meu Painel: a tela de trabalho do vendedor',
    changes: [
      { type: 'new', text: 'Aba "Meu Painel": agenda dos próximos 7 dias, contratos esperando assinatura (com quantas vezes o cliente abriu), documentação faltando e os leads em negociação, tudo numa tela só' },
      { type: 'new', text: 'Clicar no nome do lead abre a conversa dele no Kommo em outra aba' },
      { type: 'new', text: 'Botão "não fechou" tira o lead da lista pedindo o motivo (preço, sumiu, contratou concorrente, custas ou outro) — o lead volta sozinho se marcar nova conversa' },
      { type: 'new', text: 'Transferir lead para outro vendedor: leva junto o contrato, a cobrança de assinatura e o crédito no placar, e troca o responsável no Kommo' },
      { type: 'new', text: 'Placar de processos distribuídos no mês e no total, contado pela conclusão da tarefa DISTRIBUIR AÇÃO no ADVBOX' },
      { type: 'improve', text: 'Compromisso que apareceu na agenda desde a sua última visita fica marcado com um ponto dourado, sem sino nem alarme' },
    ],
  },
```

No `CLAUDE.md`, acrescentar o bloco da feature no topo da seção "Estado atual", antes do bloco
de 14/08, registrando: os números medidos que sustentaram o desenho (§4 da spec), a decisão do
`created_by` como dono, a redundância da régua de distribuído e a pendência do usuário Kommo
`15284979`.

- [ ] **Passo 8: commit final**

```bash
git add CLAUDE.md client/src/components/ChangeLog.jsx client/vitest.config.js
git commit -m "meu painel: guia, changelog e piso de cobertura"
```

---

## Ordem de execução e dependências

```
Task 1 (tabelas)
  ├─ Task 2 (view negociacao) ─┐
  └─ Task 3 (views pend/distr) ─┤
Task 4 (logica pura) ───────────┤
                                ├─ Task 5 (sources) ─ Task 6 (aba) ─┬─ Task 7 (agenda)
                                                                    ├─ Task 8 (pendencias)
                                                                    ├─ Task 9 (negociacao) ─┬─ Task 10 (nao fechou)
                                                                    │                       ├─ Task 12 (tags)
                                                                    │                       └─ Task 13 (transferencia)
                                                                    └─ Task 11 (placar)
                                                                                     Task 14 (verificacao e deploy)
```

Tasks 4 e 1 podem começar em paralelo. As Tasks 7, 8, 9 e 11 são independentes entre si depois
da Task 6.
