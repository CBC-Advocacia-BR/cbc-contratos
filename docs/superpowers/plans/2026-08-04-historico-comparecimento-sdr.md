# Historico de comparecimento no painel SDR — Plano de Implementacao

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando a SDR for agendar, a tela mostra o historico de comparecimento daquela pessoa (faltas e presencas), e sugere horario mais proximo para quem ja faltou 2x ou mais.

**Architecture:** Uma view no nivel do evento (`vw_pessoa_atendimentos`) derivada de
`agenda_videochamadas`, mais uma funcao (`historico_atendimentos`) que canoniza o telefone
no banco e filtra na entrada. O prototipo SDR consome dados reais embutidos, do mesmo jeito
que ja faz hoje. Zero tabela nova, zero cron novo: o dado se mantem fresco porque deriva da
agenda que ja sincroniza.

**Tech Stack:** PostgreSQL (Supabase, projeto `vygczeepvoyaehfchxko`), MCP `supabase-cbc`
para migracao e conferencia, HTML/CSS/JS puro no prototipo (`prototipos/sdr/index.html`,
sem framework e sem build).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-04-historico-comparecimento-sdr-design.md`. Ler antes de comecar.
- **REGRA #1 (CLAUDE.md):** backup antes de editar arquivo existente. Nunca `rm`.
- **REGRA #16 (CLAUDE.md):** nao alterar nada alem do que este plano descreve.
- **Desfecho canonico:** `meet_status` vence a cor (decisao Paulo 23/07). `excluida` **nunca** conta como falta.
- **Nao existe status `remarcada`** no banco. Os valores reais sao `realizada`, `fechou`, `no_show`, `excluida`, `agendada`.
- **Exposicao:** `authenticated` e `powerbi_cbc` leem; **`anon` nao**. Dado pessoal.
- **Desempenho:** a funcao responde **abaixo de 50 ms**. Medir com `explain analyze`, nao no olho.
- **Nao tocar** em `vw_noshow_acervo`: ela continua servindo campanha. A view nova e irma, nao substituta.
- **Acentos:** o prototipo e tela de usuario, entao **texto visivel leva acento**. Codigo e comentario, nao.
- **Tokens de cor:** usar as variaveis `--cbc-*` que ja existem no arquivo. Nunca hex cravado (quebra o tema).
- **Sem commit** sem o Paulo pedir.

## File Structure

| Arquivo | Responsabilidade | Acao |
|---|---|---|
| `supabase_historico_atendimentos.sql` (raiz) | SQL versionado da view + indice + funcao, espelhando o que foi aplicado | Criar |
| `prototipos/sdr/index.html` | Painel: dados de demonstracao, selo na fila, bloco no modal | Modificar |
| `prototipos/sdr/README.md` | Registrar o que a tela passou a fazer | Modificar |
| `backups/20260804_historico_sdr/` | Copia do `index.html` antes da 1a edicao (REGRA #1) | Criar |

Migracao aplicada via MCP `apply_migration` (nome: `historico_atendimentos`), e o `.sql` da
raiz e a copia versionada, mesmo padrao de `supabase_noshow_acervo.sql`.

---

### Task 1: View de eventos + indice

**Files:**
- Create: `supabase_historico_atendimentos.sql` (raiz do projeto)
- Migration: aplicar via MCP `supabase-cbc` → `apply_migration`, nome `historico_atendimentos`

**Interfaces:**
- Consumes: tabela `public.agenda_videochamadas` (ja existe).
- Produces: `public.vw_pessoa_atendimentos` com as colunas `telefone text`, `event_id text`,
  `scheduled_at timestamptz`, `quando_brt timestamp`, `vendedora text`,
  `desfecho text` (`compareceu`/`faltou`/`excluida`/`agendada`), `via_meet boolean`,
  `kommo_lead_id bigint`, `nome text`. A Task 2 consome essa view.

- [ ] **Step 1: Escrever a conferencia que ainda falha**

Rodar via MCP `execute_sql`. Ela prova que a view nao existe:

```sql
select count(*) from public.vw_pessoa_atendimentos;
```

- [ ] **Step 2: Rodar e verificar que falha**

Esperado: `ERROR: 42P01: relation "public.vw_pessoa_atendimentos" does not exist`.

- [ ] **Step 3: Aplicar a migracao**

Via MCP `apply_migration`, nome `historico_atendimentos`:

```sql
-- Historico de comparecimento por pessoa, no nivel do EVENTO.
-- Irma da vw_noshow_acervo (que e agregada por pessoa e serve campanha).
-- Cobre TODAS as pessoas com agenda, nao so quem faltou: a decisao do Paulo
-- (04/08/2026) e mostrar historico completo, porque 176 das 617 pessoas do acervo
-- faltaram E compareceram, e mostrar so a falta trataria como problema quem ja voltou.
create or replace view public.vw_pessoa_atendimentos as
select
  case when length(c.dd) >= 10 then left(c.dd,2)||right(c.dd,8) end as telefone,
  a.event_id,
  a.scheduled_at,
  (a.scheduled_at at time zone 'America/Sao_Paulo') as quando_brt,
  split_part(coalesce(a.vendedora_email,''),'@',1) as vendedora,
  case
    when a.status = 'excluida' then 'excluida'
    when coalesce(a.meet_status, a.status) in ('realizada','fechou') then 'compareceu'
    when coalesce(a.meet_status, a.status) = 'no_show' then 'faltou'
    else 'agendada'
  end as desfecho,
  (a.meet_status is not null) as via_meet,
  a.lead_id as kommo_lead_id,
  nullif(trim(a.cliente_nome),'') as nome
from public.agenda_videochamadas a
cross join lateral (
  -- defensivo: hoje agenda_videochamadas.telefone ja vem DDD+8, mas se um dia
  -- vier com 55 na frente a chave nao pode mudar em silencio
  select case
    when regexp_replace(coalesce(a.telefone,''),'\D','','g') ~ '^55'
         and length(regexp_replace(coalesce(a.telefone,''),'\D','','g')) >= 12
    then substr(regexp_replace(coalesce(a.telefone,''),'\D','','g'),3)
    else regexp_replace(coalesce(a.telefone,''),'\D','','g')
  end as dd
) c
where a.telefone is not null and a.telefone <> '';

comment on view public.vw_pessoa_atendimentos is
'Historico de comparecimento no nivel do evento: 1 linha por atendimento agendado, com telefone canonico DDD+8, desfecho (compareceu/faltou/excluida/agendada) e via_meet (true=auditoria do Meet, false=cor da agenda). Auto-atualizada a partir de agenda_videochamadas. Criada 04/08/2026.';

-- a funcao da Task 2 filtra por telefone e por lead; a tabela tem ~2.900 linhas hoje,
-- mas a fila do painel consulta 1x por card, entao seq scan x20 vira desperdicio
--
-- ATENCAO (corrigido na execucao de 04/08): um btree simples em (telefone) NAO serve.
-- A coluna telefone da view e expressao calculada (CASE + LATERAL + regexp_replace), e o
-- planner nao empurra o filtro para o indice da coluna crua -> Seq Scan de 10,9 ms.
-- O que funciona e indice de EXPRESSAO sobre a mesma canonizacao: 0,95 ms (Index Scan).
-- Ver supabase_historico_atendimentos.sql para a forma final aplicada em producao.
create index if not exists idx_agenda_vc_lead on public.agenda_videochamadas (lead_id);

revoke all on public.vw_pessoa_atendimentos from anon;
grant select on public.vw_pessoa_atendimentos to authenticated;
grant select on public.vw_pessoa_atendimentos to powerbi_cbc;
```

- [ ] **Step 4: Conferir que os numeros batem com o acervo, pessoa a pessoa**

Esta e a conferencia que importa. Mesmo metodo usado no item 175 antes de trocar a fonte da
aba Boletos: comparar tudo e exigir **zero** divergencia.

```sql
with da_view as (
  select telefone, count(*) filter (where desfecho='faltou') as faltas
  from public.vw_pessoa_atendimentos group by telefone
)
select
  (select count(*) from public.vw_noshow_acervo) as pessoas_no_acervo,
  (select count(*) from da_view where faltas > 0) as pessoas_na_view,
  (select count(*) from public.vw_noshow_acervo a join da_view v using (telefone)
   where a.qtd_noshow <> v.faltas) as divergencias;
```

Esperado: `pessoas_no_acervo` = `pessoas_na_view`, e **`divergencias` = 0**.
Se `divergencias` > 0, parar: a regra de desfecho divergiu do acervo.

- [ ] **Step 5: Conferir o caso conhecido**

```sql
select to_char(quando_brt,'DD/MM/YY HH24:MI') as quando, vendedora, desfecho, via_meet
from public.vw_pessoa_atendimentos
where telefone = '1166161366' order by scheduled_at;
```

Esperado, exatamente 4 linhas, todas `faltou` com `marianamaciel`:
`16/12/25 16:00`, `18/12/25 10:30`, `19/12/25 13:00`, `23/12/25 10:30`.

- [ ] **Step 6: Conferir que `excluida` nao virou falta**

```sql
select desfecho, count(*) from public.vw_pessoa_atendimentos group by 1 order by 2 desc;
```

Esperado: `compareceu` ~2.166, `faltou` ~721, `excluida` ~29, `agendada` ~24.
**Nenhum valor nulo** e **nenhum `remarcada`**.

- [ ] **Step 7: Conferir a seguranca**

```sql
set local role anon;
select count(*) from public.vw_pessoa_atendimentos;
```

Esperado: `ERROR: 42501: permission denied for view vw_pessoa_atendimentos`.
Depois `reset role;`.

- [ ] **Step 8: Salvar o SQL versionado**

Criar `supabase_historico_atendimentos.sql` na raiz com **exatamente** o SQL do Step 3, mais
um cabecalho de comentario dizendo: nome da migracao (`historico_atendimentos`), data
(04/08/2026), e o resultado da conferencia do Step 4 (numeros medidos). Mesmo padrao de
`supabase_noshow_acervo.sql`.

---

### Task 2: Funcao de consulta por pessoa

**Files:**
- Modify: `supabase_historico_atendimentos.sql` (acrescentar a funcao no fim)
- Migration: aplicar via MCP `apply_migration`, nome `historico_atendimentos_fn`

**Interfaces:**
- Consumes: `public.vw_pessoa_atendimentos` (Task 1).
- Produces: `public.historico_atendimentos(p_telefone text default null, p_lead_id bigint default null) returns jsonb`.
  Formato de retorno, consumido pela Task 3 e Task 4:
  ```json
  {"faltas": 4, "comparecimentos": 0, "total": 4,
   "ultima_falta": "2025-12-23T10:30:00",
   "eventos": [{"quando":"23/12/25 10:30","vendedora":"marianamaciel","desfecho":"faltou","via_meet":false}]}
  ```
  `eventos` vem do mais recente para o mais antigo e **so** com `faltou`/`compareceu`
  (`excluida` e `agendada` ficam fora: nao sao historico de comparecimento).

- [ ] **Step 1: Escrever a conferencia que ainda falha**

```sql
select public.historico_atendimentos('5511966161366');
```

- [ ] **Step 2: Rodar e verificar que falha**

Esperado: `ERROR: 42883: function public.historico_atendimentos(unknown) does not exist`.

- [ ] **Step 3: Aplicar a funcao**

⚠️ **A funcao NAO pode ser um wrapper de `vw_noshow_acervo`.** Aquela view leva 642 ms
porque calcula os cruzamentos das 617 pessoas antes de filtrar uma. Esta filtra na entrada:
canoniza o telefone primeiro, e so entao le os eventos daquela pessoa.

```sql
-- Historico de comparecimento de UMA pessoa, pronto para a tela.
-- Aceita telefone em qualquer formato (5511966161366, (11) 96616-1366, 1166161366)
-- e canoniza DENTRO do banco: a regra tem de existir num lugar so. Este projeto ja
-- se queimou com logica duplicada que divergiu (mapas do ADVBOX, campos obrigatorios).
create or replace function public.historico_atendimentos(
  p_telefone text default null,
  p_lead_id  bigint default null
) returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with canon as (
    select case when length(d.dd) >= 10 then left(d.dd,2)||right(d.dd,8) end as tel
    from (
      select case
        when regexp_replace(coalesce(p_telefone,''),'\D','','g') ~ '^55'
             and length(regexp_replace(coalesce(p_telefone,''),'\D','','g')) >= 12
        then substr(regexp_replace(coalesce(p_telefone,''),'\D','','g'),3)
        else regexp_replace(coalesce(p_telefone,''),'\D','','g')
      end as dd
    ) d
  ),
  ev as (
    select v.quando_brt, v.vendedora, v.desfecho, v.via_meet, v.scheduled_at
    from public.vw_pessoa_atendimentos v, canon c
    where v.desfecho in ('faltou','compareceu')
      and ( (c.tel is not null and v.telefone = c.tel)
         or (p_lead_id is not null and v.kommo_lead_id = p_lead_id) )
  )
  select jsonb_build_object(
    'faltas',          count(*) filter (where desfecho='faltou'),
    'comparecimentos', count(*) filter (where desfecho='compareceu'),
    'total',           count(*),
    'ultima_falta',    max(quando_brt) filter (where desfecho='faltou'),
    'eventos', coalesce(
      jsonb_agg(jsonb_build_object(
        'quando',    to_char(quando_brt,'DD/MM/YY HH24:MI'),
        'vendedora', vendedora,
        'desfecho',  desfecho,
        'via_meet',  via_meet
      ) order by scheduled_at desc), '[]'::jsonb)
  )
  from ev;
$$;

comment on function public.historico_atendimentos(text, bigint) is
'Historico de comparecimento de uma pessoa (faltas + presencas), pronto para a tela do painel SDR. Canoniza o telefone internamente; casa por telefone OU kommo lead_id. Criada 04/08/2026.';

revoke all on function public.historico_atendimentos(text, bigint) from anon, public;
grant execute on function public.historico_atendimentos(text, bigint) to authenticated;
```

- [ ] **Step 4: Conferir o caso conhecido, nos 3 formatos de telefone**

```sql
select
  public.historico_atendimentos('5511966161366') -> 'faltas' as por_e164,
  public.historico_atendimentos('(11) 96616-1366') -> 'faltas' as por_mascara,
  public.historico_atendimentos('1166161366')      -> 'faltas' as por_canonico,
  public.historico_atendimentos(null, 18234162)    -> 'faltas' as por_lead;
```

Esperado: **`4` nas quatro colunas.** Se alguma vier diferente, a canonizacao esta errada.

- [ ] **Step 5: Conferir o caso misto (a razao de existir a decisao 1)**

```sql
select public.historico_atendimentos('1172672721');
```

Esperado: `faltas: 3`, `comparecimentos: 2`, `total: 5`, e o primeiro item de `eventos`
sendo `17/03/26 11:30` com `desfecho: compareceu` e **`via_meet: true`**.

- [ ] **Step 6: Conferir quem nunca faltou**

```sql
select public.historico_atendimentos('11999999999');
```

Esperado: `faltas: 0`, `comparecimentos: 0`, `total: 0`, `eventos: []`.
**Nao pode devolver `null`** — a tela quebraria.

- [ ] **Step 7: Medir o desempenho**

```sql
explain (analyze, format text) select public.historico_atendimentos('5511966161366');
```

Esperado: **`Execution Time` abaixo de 50 ms.** Para comparacao, a mesma consulta contra
`vw_noshow_acervo` leva 642 ms. Se passar de 50 ms, conferir se o indice
`idx_agenda_vc_telefone` da Task 1 foi criado.

- [ ] **Step 8: Conferir a seguranca**

```sql
set local role anon;
select public.historico_atendimentos('5511966161366');
```

Esperado: `ERROR: 42501: permission denied for function historico_atendimentos`.
Depois `reset role;`.

- [ ] **Step 9: Acrescentar ao SQL versionado**

Colar a funcao no fim de `supabase_historico_atendimentos.sql`, junto do tempo medido no
Step 7 como comentario.

---

### Task 3: Selo de faltas na fila do prototipo

**Files:**
- Create: `backups/20260804_historico_sdr/index.html` (copia do original, REGRA #1)
- Modify: `prototipos/sdr/index.html` (array `LEADS` ~linha 537, `linhaFila()` ~linha 708, CSS `.tag` ~linha 126)

**Interfaces:**
- Consumes: formato de `historico_atendimentos` (Task 2).
- Produces: propriedade `hist` em cada objeto de `LEADS`, no mesmo formato que a funcao
  devolve. A Task 4 le `l.hist.eventos` e `l.hist.faltas`.

⚠️ **Uma diferenca proposital entre a funcao e os dados embutidos:** a funcao devolve
`vendedora` como o usuario do e-mail (`marianamaciel`), que e o dado cru. O prototipo ja usa
nome de exibicao (`Mariana`, `Beatriz`) em todo o resto da tela, entao os dados embutidos
seguem o padrao da tela. Quando o painel virar app de verdade, vai precisar de um de-para
entre um e outro — nao e bug, e uma juncao que ainda nao existe. O campo `ultima_falta` que
a funcao devolve nao e usado por nenhuma das telas deste plano; fica disponivel para depois.

⚠️ **Descoberta que motiva esta task:** nenhum dos 17 leads de demonstracao do prototipo
tem historico de falta (conferido contra o acervo: zero resultados). Sem trazer gente de
verdade, a tela abre sem mostrar nada e o Paulo e o Bruno nao conseguem julgar.

- [ ] **Step 1: Backup antes de editar (REGRA #1)**

```bash
mkdir -p "backups/20260804_historico_sdr" && cp "prototipos/sdr/index.html" "backups/20260804_historico_sdr/index.html"
```

- [ ] **Step 2: Acrescentar os 5 leads de demonstracao ao array `LEADS`**

Em `prototipos/sdr/index.html`, dentro de `let LEADS = [` (~linha 537), acrescentar antes do
`];` que fecha o array. Sao pessoas **reais** do acervo, com historico **real** medido em
04/08/2026, seguindo o padrao do resto do prototipo:

```javascript
  {id:'h1', nome:'jhonatan', kommo:18234162, tel:'1166161366', dono:'SDR', grupo:'falta',
   quando:'23/12', vend:'Mariana', dias:224, conversa:'curto',
   hist:{faltas:4, comparecimentos:0, total:4, eventos:[
     {quando:'23/12/25 10:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'19/12/25 13:00', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'18/12/25 10:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'16/12/25 16:00', vendedora:'Mariana', desfecho:'faltou', via_meet:false}]}},
  {id:'h2', nome:'Moises Panatier', kommo:12780608, tel:'5484191059', dono:'SDR', grupo:'falta',
   quando:'03/12', vend:'Mariana', dias:244, conversa:'curto',
   hist:{faltas:4, comparecimentos:0, total:4, eventos:[
     {quando:'03/12/25 14:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'02/12/25 13:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'01/12/25 14:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'27/11/25 13:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false}]}},
  {id:'h3', nome:'verton', kommo:12782510, tel:'4799696920', dono:'SDR', grupo:'falta',
   quando:'12/12', vend:'Mariana', dias:235, conversa:'curto',
   hist:{faltas:3, comparecimentos:0, total:3, eventos:[
     {quando:'12/12/25 11:00', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'25/11/25 12:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'06/11/25 14:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false}]}},
  {id:'h4', nome:'Leonardo', kommo:12813162, tel:'1147500369', dono:'SDR', grupo:'falta',
   quando:'12/05', vend:'Mariana', dias:449, conversa:'curto',
   hist:{faltas:3, comparecimentos:1, total:4, eventos:[
     {quando:'22/05/25 14:00', vendedora:'Mariana', desfecho:'compareceu', via_meet:false},
     {quando:'12/05/25 10:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'25/04/25 16:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'23/04/25 14:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false}]}},
  {id:'h5', nome:'Marcio', kommo:16316700, tel:'1172672721', dono:'SDR', grupo:'falta',
   quando:'02/12', vend:'Mariana', dias:245, conversa:'curto',
   hist:{faltas:3, comparecimentos:2, total:5, eventos:[
     {quando:'17/03/26 11:30', vendedora:'Mariana', desfecho:'compareceu', via_meet:true},
     {quando:'02/12/25 15:00', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'28/11/25 15:00', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'24/11/25 10:30', vendedora:'Mariana', desfecho:'faltou', via_meet:false},
     {quando:'17/03/25 11:30', vendedora:'Mariana', desfecho:'compareceu', via_meet:false}]}},
```

- [ ] **Step 3: Acrescentar o CSS do selo**

Depois da linha `.tag.hot{...}` (~linha 131), acrescentar. Reusa os tokens que ja existem:

```css
.tag.faltou{background:var(--cbc-danger-bg);border-color:var(--cbc-danger-border);color:var(--cbc-danger)}
.tag.voltou{background:var(--cbc-success-bg);border-color:var(--cbc-success-border);color:var(--cbc-success)}
```

- [ ] **Step 4: Mostrar o selo em `linhaFila()`**

Em `linhaFila(l)` (~linha 708), depois da linha `if(l.quente) tags.push(...)` e **antes** de
`if(l.conf&&!l.agendado)`, acrescentar:

```javascript
  if(l.hist && l.hist.faltas > 0){
    tags.push(`<span class="tag faltou" title="Não compareceu ${l.hist.faltas} ${l.hist.faltas===1?'vez':'vezes'}">faltou ${l.hist.faltas}×</span>`);
    if(l.hist.comparecimentos > 0)
      tags.push(`<span class="tag voltou" title="Também compareceu ${l.hist.comparecimentos} ${l.hist.comparecimentos===1?'vez':'vezes'}">veio ${l.hist.comparecimentos}×</span>`);
  }
```

O selo verde ao lado do vermelho e o que impede a SDR de descartar o Leonardo e o Marcio,
que faltaram mas voltaram.

- [ ] **Step 5: Conferir no navegador**

Abrir a tela com `preview_start` apontando para `file:///Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/prototipos/sdr/index.html` (o painel e HTML puro, nao precisa de servidor). Filtrar o grupo "Faltaram" no seletor da fila. Conferir:
- os 5 leads novos aparecem na fila;
- jhonatan, Moises e verton mostram **so** o selo vermelho (`faltou 4×`, `faltou 4×`, `faltou 3×`);
- Leonardo mostra `faltou 3×` **e** `veio 1×`; Marcio mostra `faltou 3×` **e** `veio 2×`;
- nenhum dos 17 leads antigos ganhou selo;
- console sem erro.

- [ ] **Step 6: Conferir que nada mais quebrou**

Ainda no navegador: trocar de aba (Agenda, Funil, Disparos, Configuração) e voltar. A
contagem "N de M na fila" no topo tem de subir 5. Console sem erro.

---

### Task 4: Bloco de historico no modal Agendar + sugestao

**Files:**
- Modify: `prototipos/sdr/index.html` (`modalAgendar()` ~linha 1061, CSS junto do bloco `.pos-sim`)
- Modify: `prototipos/sdr/README.md`

**Interfaces:**
- Consumes: `l.hist` (Task 3).
- Produces: nada que outra task consuma. Ultima task.

- [ ] **Step 1: Acrescentar o CSS do bloco**

Junto das regras de modal (perto de `.pos-sim`), acrescentar:

```css
.hist{border:1px solid var(--cbc-border-strong);border-radius:var(--cbc-radius);padding:10px 12px;margin-bottom:12px;background:var(--cbc-bg-subtle)}
.hist h4{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--cbc-text-secondary);margin:0 0 6px}
.hist ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.hist li{display:flex;gap:8px;align-items:baseline;font-size:12px}
.hist li .qd{font-variant-numeric:tabular-nums;color:var(--cbc-text-secondary);flex:none}
.hist li .df{font-weight:700}
.hist li.f .df{color:var(--cbc-danger)}
.hist li.c .df{color:var(--cbc-success)}
.hist li .pv{font-size:10px;color:var(--cbc-text-muted)}
```

- [ ] **Step 2: Montar o bloco dentro de `modalAgendar()`**

Em `modalAgendar(id, pre, remarcandoEv)` (~linha 1061), depois da linha
`const p=pontuacao(l);` e antes de `$('#md-titulo').textContent=...`, acrescentar:

```javascript
  const h = l && l.hist && l.hist.total ? l.hist : null;
  const reincidente = !!(h && h.faltas >= 2);
  // "entra na confirmacao da manha" e dito no texto, nao virado em estado: no prototipo a
  // confirmacao da manha e uma tela de lote, sem marcador por call. Inventar um estado
  // falso aqui daria a impressao de que a regra ja existe. Ela nasce no app real.
  const blocoHist = !h ? '' : `
    <div class="hist">
      <h4>Histórico com a gente</h4>
      <ul>${h.eventos.map(e=>`
        <li class="${e.desfecho==='faltou'?'f':'c'}">
          <span class="qd">${esc(e.quando)}</span>
          <span>${esc(e.vendedora)}</span>
          <span class="df">${e.desfecho==='faltou'?'não veio':'compareceu'}</span>
          ${e.via_meet?'<span class="pv" title="Confirmado pela auditoria do Google Meet">· auditado</span>':''}
        </li>`).join('')}</ul>
      ${reincidente?`<p class="hint" style="margin:8px 0 0">Já faltou ${h.faltas} vezes. Marcar para <b>hoje ou amanhã</b> reduz a chance de faltar de novo: call no mesmo dia falta 9,8% das vezes, contra 19% depois de dois dias. Esta call já entra na confirmação da manhã.</p>`:''}
    </div>`;
```

- [ ] **Step 3: Inserir o bloco no HTML do modal**

Ainda em `modalAgendar()`, no template de `$('#md-body').innerHTML=`, inserir
`${blocoHist}` **logo depois** da linha do aviso de remarcacao
(`${remarcandoEv?...:''}`) e **antes** de `<div class="grid2">`. O historico tem de
aparecer acima dos campos, nao no fim.

- [ ] **Step 4: Aplicar a sugestao de horario para reincidente**

Ainda em `modalAgendar()`, trocar a linha `const dia=(pre&&pre.dia)||'04/08';` por:

```javascript
  const histPre = l && l.hist && l.hist.faltas >= 2;
  const dia = (pre&&pre.dia) || (histPre ? '03/08' : '04/08');
```

E na dica embaixo dos horarios (`<p class="hint">Sugerido: ...`), trocar por:

```javascript
      <p class="hint">Sugerido: <b>${sug}</b>${p&&p.n>=70?', porque a nota do lead passa de 70':', que está com menos calls no dia'}${reincidente?'. Como já faltou antes, o dia começa em <b>hoje</b>':''}.</p>
```

- [ ] **Step 5: Conferir no navegador**

Na mesma tela do preview, filtrar "Faltaram" e clicar em **Agendar** em cada um dos 5:
- **jhonatan:** bloco com as 4 linhas em vermelho, ordem `23/12` → `19/12` → `18/12` → `16/12`;
  a frase da reincidencia aparece; o dia ja abre em **Hoje, 03/08**.
- **Marcio:** 5 linhas, a primeira `17/03/26` verde escrito **compareceu** e com `· auditado`;
  as 3 do meio vermelhas; a ultima verde.
- **Leonardo:** 4 linhas, a primeira verde.
- Abrir **Agendar** num lead sem historico (ex.: Flavio Alencar): **nenhum bloco**, e o dia
  abre em Amanhã, 04/08 como antes.
- Console sem erro nos 5 casos.

- [ ] **Step 6: Conferir que a remarcacao continua funcionando**

Na aba Agenda, clicar numa call e escolher **Remarcar**. O aviso de remarcacao tem de
continuar aparecendo no topo do modal, agora com o bloco de historico embaixo dele (quando
a pessoa tiver historico). Nada pode ter sumido.

- [ ] **Step 7: Atualizar o README do prototipo**

Em `prototipos/sdr/README.md`, na secao "O que funciona de verdade", acrescentar:

```markdown
O historico de comparecimento aparece no selo da fila (`faltou 4x` / `veio 2x`) e, ao
agendar, num bloco com cada atendimento anterior: data, vendedora e se a pessoa veio,
marcando `auditado` quando o desfecho vem da auditoria do Meet e nao da cor da agenda.
Quem ja faltou 2x ou mais tem o dia sugerido puxado para hoje. Os 5 leads do grupo
"Faltaram" sao pessoas reais, com historico real medido em 04/08/2026 (view
`vw_pessoa_atendimentos` + funcao `historico_atendimentos`).
```

---

## Conferencia final (depois das 4 tasks)

- [ ] `select public.historico_atendimentos('5511966161366')` responde em menos de 50 ms
- [ ] `set local role anon` e negado na view **e** na funcao
- [ ] Divergencia contra `vw_noshow_acervo` = 0
- [ ] Os 5 leads de demonstracao mostram selo na fila e bloco no modal
- [ ] Nenhum dos 17 leads antigos mudou de comportamento
- [ ] `supabase_historico_atendimentos.sql` na raiz reflete o que esta no banco
- [ ] Console do navegador limpo nas 6 abas do painel
