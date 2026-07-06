-- ============================================================================
-- supabase_kommo_note_log.sql   (auditoria #85)
-- Cache de idempotencia das notas do Kommo (marker por lead) para o kommo-note nao
-- precisar paginar ate 10k notas do Kommo so p/ checar duplicidade.
--
-- Seguro deployar o codigo ANTES desta migracao: sem a tabela, cacheTemNota() retorna
-- null e o kommo-note cai na paginacao (comportamento atual). Aplicar quando aprovado.
--
-- Sem PII sensivel (so id do lead + marcador tecnico). As functions usam a chave anon,
-- entao a policy libera anon — consistente com as demais tabelas bot_* do projeto.
-- ============================================================================

create table if not exists public.kommo_note_log (
  lead_id   text        not null,
  marker    text        not null,
  posted_at timestamptz not null default now(),
  primary key (lead_id, marker)
);

alter table public.kommo_note_log enable row level security;

drop policy if exists kommo_note_log_all on public.kommo_note_log;
create policy kommo_note_log_all on public.kommo_note_log
  for all to anon, authenticated
  using (true) with check (true);
