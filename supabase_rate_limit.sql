-- ============================================================================
-- supabase_rate_limit.sql   (auditoria #77)
-- Rate limiter COMPARTILHADO (via Postgres) para substituir o limitador em memoria
-- por-instancia (rate-limit.mjs), que na Netlify quase nao limitava (cada instancia
-- contava do zero). Protege sobretudo: cpf-lookup (chamada externa que CUSTA por uso)
-- e portal-data (enumeracao de token/PII).
--
-- Seguro deployar o codigo ANTES desta migracao: checkRateLimitShared cai para o
-- limitador em memoria se a RPC nao existir. Aplicar quando aprovado.
--
-- Janela FIXA (fixed-window): simples e barata; suficiente contra brute force/abuso.
-- ============================================================================

create table if not exists public.rate_limit_counters (
  bucket       text        not null,
  ip           text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (bucket, ip, window_start)
);

-- Atomica: incrementa e devolve o total da janela atual num unico statement.
create or replace function public.rate_limit_hit(p_bucket text, p_ip text, p_window_seconds int, p_max int)
returns table(allowed boolean, hits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into public.rate_limit_counters(bucket, ip, window_start, count)
  values (p_bucket, p_ip, w, 1)
  on conflict (bucket, ip, window_start) do update set count = rate_limit_counters.count + 1
  returning count into c;
  return query select (c <= p_max), c;
end
$$;

grant execute on function public.rate_limit_hit(text, text, int, int) to anon, authenticated;

-- RLS: a tabela e escrita/lida apenas pela RPC (security definer); nao precisa policy
-- p/ anon acessar a tabela direto. Habilita RLS sem policy = fechada ao acesso direto.
alter table public.rate_limit_counters enable row level security;

-- Retencao: janelas antigas nao sao mais consultadas. Limpar periodicamente (ex.: um
-- job diario) para a tabela nao crescer:
--   delete from public.rate_limit_counters where window_start < now() - interval '2 hours';
