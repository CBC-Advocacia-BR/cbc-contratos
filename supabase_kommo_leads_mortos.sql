-- ============================================================================
-- kommo_leads_mortos — leads que NAO EXISTEM mais no Kommo (02/08/2026)
-- ============================================================================
-- Motivo: 289 jobs presos em kommo_queue.status='failed' em 30 dias. 271 deles com
-- erro 226 do Kommo, concentrados em 37 leads. Provado por probe em producao (POST de
-- nota no lead 999999999, que nunca existiu, devolve o MESMO 226) que:
--
--   erro 226 no POST /leads/{id}/notes  ==  "o lead nao existe"
--
-- E o equivalente, no endpoint de notas, do "Lead not found" que o PATCH devolve. Nao
-- e emoji (texto ASCII puro falha igual) nem duplicidade (marcador inedito falha igual).
--
-- Lead que nao existe nunca volta a existir: as 6 tentativas por job eram desperdicio
-- (~1.600 chamadas inuteis a API). Pior, o monitor ADVBOX cria um job NOVO por andamento
-- e por tarefa, entao a fila voltava a encher todo dia mesmo com o retry corrigido.
-- Esta tabela e a lista consultada por kommoQueue.enqueue() p/ barrar na ENTRADA.
--
-- De onde vem lead morto: o linkKommo e digitado a mao no formulario (REGRA #4) e
-- congela em contratos.dados->contratantes[].linkKommo. Quando a equipe mescla leads
-- duplicados na UI do Kommo, o merge APAGA o lead perdedor e o contrato fica apontando
-- para um id que nao existe mais. Tambem ha link de outra conta (brunoadvocaciacbccom).
--
-- COMO RESSUSCITAR: corrigido o linkKommo do contrato para o lead sobrevivente, apagar
-- a linha daqui. O cache em memoria das functions expira em 60s e o fluxo volta sozinho.
--   delete from public.kommo_leads_mortos where lead_id = '<id>';
-- ============================================================================

create table if not exists public.kommo_leads_mortos (
  lead_id       text primary key,
  motivo        text not null default 'lead_inexistente',
  primeiro_erro timestamptz not null default now(),
  ultimo_erro   timestamptz not null default now(),
  -- so a parte diagnostica do erro; o corpo da nota (nome do cliente, nº do processo)
  -- e cortado fora em kommoQueue.detalheSemPii() antes de gravar.
  detalhe       text
);

comment on table public.kommo_leads_mortos is
  'Leads inexistentes no Kommo (erro 226 / Lead not found). Consultada por kommoQueue.enqueue() para nao enfileirar trabalho fadado a falhar. Apagar a linha ressuscita o lead.';

alter table public.kommo_leads_mortos enable row level security;

-- Mesma politica da kommo_queue (tabela irma): as Netlify Functions escrevem aqui e
-- caem para a chave anon quando SUPABASE_SERVICE_ROLE_KEY nao esta no runtime. Fechar
-- so p/ authenticated faria a trava parar de funcionar EM SILENCIO — exatamente o modo
-- de falha que este projeto ja levou varias vezes (ver memoria crons-falha-silenciosa).
drop policy if exists kommo_leads_mortos_all on public.kommo_leads_mortos;
create policy kommo_leads_mortos_all on public.kommo_leads_mortos
  for all to authenticated, anon using (true) with check (true);

create index if not exists idx_kommo_leads_mortos_ultimo on public.kommo_leads_mortos (ultimo_erro desc);
