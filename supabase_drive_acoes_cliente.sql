-- supabase_drive_acoes_cliente.sql — Ações mineradas do Google Drive por cliente.
-- Mutirão único (07/2026): para cada pasta-ação do Drive (Paulo 1/2 -> Resort -> Cliente),
-- guarda resort, VALOR PAGO que consta na inicial (desatualizado), unidade/cota, link da
-- pasta, cônjuge e o vínculo com a ação real no ADVBOX (lawsuit_id / nº do processo).
-- Casamento com o cliente por CPF (o CPF está na inicial). 1 linha por pasta-ação.
--
-- RLS FECHADA (PII), como public.clientes. App lê via RPC SECURITY DEFINER
-- cliente_acoes_drive_list(p_uid) — mesmo padrão de cliente_dados_bancarios.
-- Gravação do backfill: só o orquestrador, via service role (bypassa RLS).
-- Aplicar via MCP (migração drive_acoes_cliente).

create table if not exists public.cliente_acoes_drive (
  id                     uuid primary key default gen_random_uuid(),
  cpf                    text not null,                 -- só dígitos (autor principal)
  cliente_id             uuid,                          -- -> public.clientes.id quando casa
  nome_autor             text,
  conjuge_cpf            text,                          -- só dígitos
  conjuge_nome           text,
  resort                 text,                          -- balde/pasta-mãe do Drive
  reu_resort             text,                          -- razão social da ré na inicial
  tipo_acao              text,
  unidade_cota           text,                          -- nº da fração / bloco / torre
  valor_pago             numeric(14,2),                 -- SÓ o que consta na inicial (desatualizado)
  valor_pago_texto       text,                          -- frase-fonte (auditoria)
  data_contrato_compra   date,                          -- data da compra da cota
  is_recurso             boolean not null default false,
  drive_bucket           text,                          -- "Paulo 1" / "Paulo 2" / ...
  drive_folder_id        text not null,
  drive_folder_link      text,
  inicial_file_id        text,
  inicial_file_name      text,
  advbox_lawsuit_id      bigint,
  advbox_process_number  text,
  advbox_tipo            text,
  advbox_etapa           text,
  advbox_qtd_processos   int,
  advbox_status          text,                          -- vinculado | sem_processo | multiplas_conferir
  process_number         text,                          -- CNJ visto na inicial (bruto)
  confidence             text,                          -- alta | media | baixa
  needs_review           boolean not null default false,
  review_reason          text,
  extraido_em            timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint cliente_acoes_drive_folder_uniq unique (drive_folder_id)
);

create index if not exists idx_cad_cpf        on public.cliente_acoes_drive (cpf);
create index if not exists idx_cad_cliente    on public.cliente_acoes_drive (cliente_id);
create index if not exists idx_cad_lawsuit    on public.cliente_acoes_drive (advbox_lawsuit_id);

alter table public.cliente_acoes_drive enable row level security;
-- Sem policy => fechada p/ anon/authenticated. Leitura do app só pela RPC definer abaixo.

-- Leitura pela ficha do cliente: traz as ações do próprio CPF + do cônjuge vinculado.
create or replace function public.cliente_acoes_drive_list(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_cpf text;
  v_conj_uid uuid;
  v_conj_cpf text;
  v_out jsonb;
begin
  select regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g'), conjuge_uid
    into v_cpf, v_conj_uid
    from public.clientes where id = p_uid;
  if v_cpf is null then v_cpf := ''; end if;

  if v_conj_uid is not null then
    select regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g')
      into v_conj_cpf from public.clientes where id = v_conj_uid;
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.valor_pago desc nulls last, t.resort), '[]'::jsonb)
    into v_out
  from (
    select id, resort, reu_resort, tipo_acao, unidade_cota, nome_autor,
           conjuge_nome, valor_pago, valor_pago_texto, data_contrato_compra,
           is_recurso, drive_folder_link, inicial_file_name,
           advbox_lawsuit_id, advbox_process_number, advbox_tipo, advbox_etapa,
           advbox_qtd_processos, advbox_status, process_number,
           confidence, needs_review, review_reason
    from public.cliente_acoes_drive
    where cliente_id = p_uid
       or (length(v_cpf) = 11 and (cpf = v_cpf or conjuge_cpf = v_cpf))
       or (v_conj_cpf is not null and length(v_conj_cpf) = 11 and (cpf = v_conj_cpf or conjuge_cpf = v_conj_cpf))
  ) t;

  return v_out;
end $$;

revoke all on function public.cliente_acoes_drive_list(uuid) from public;
grant execute on function public.cliente_acoes_drive_list(uuid) to authenticated;
