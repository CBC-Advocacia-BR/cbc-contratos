-- supabase_cliente_dados_bancarios.sql — RPC do cadastro único que traz os dados
-- bancários do cliente (espelho da Prestação: public.prest_dados_bancarios, por CPF).
-- Aplicada em prod via MCP em 2026-07-07 (migração cliente_dados_bancarios_rpc).
--
-- Regra: casa pelo CPF do próprio cliente (clientes.cpf_cnpj, só dígitos). Se o
-- cliente não tem conta no próprio CPF mas o CÔNJUGE vinculado (clientes.conjuge_uid)
-- tem, devolve a conta do cônjuge marcada (fonte='conjuge', conjuge_nome).
-- SECURITY DEFINER: lê clientes + prest_dados_bancarios. Grant só authenticated.

create or replace function public.cliente_dados_bancarios(p_uid uuid)
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
  v_conj_nome text;
  v_row public.prest_dados_bancarios%rowtype;
  v_fonte text := null;
begin
  select regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g'), conjuge_uid
    into v_cpf, v_conj_uid
    from public.clientes where id = p_uid;
  if v_cpf is null then return null; end if;

  -- 1) conta no CPF do próprio cliente (resposta mais recente)
  if length(v_cpf) = 11 then
    select * into v_row from public.prest_dados_bancarios
      where cpf = v_cpf order by id desc limit 1;
    if v_row.id is not null then v_fonte := 'proprio'; end if;
  end if;

  -- 2) senão, tenta a conta do cônjuge vinculado
  if v_row.id is null and v_conj_uid is not null then
    select regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g'), nome
      into v_conj_cpf, v_conj_nome
      from public.clientes where id = v_conj_uid;
    if v_conj_cpf is not null and length(v_conj_cpf) = 11 then
      select * into v_row from public.prest_dados_bancarios
        where cpf = v_conj_cpf order by id desc limit 1;
      if v_row.id is not null then v_fonte := 'conjuge'; end if;
    end if;
  end if;

  if v_row.id is null then return null; end if;

  return jsonb_build_object(
    'fonte',         v_fonte,
    'conjuge_nome',  case when v_fonte = 'conjuge' then v_conj_nome else null end,
    'titular',       v_row.nome,
    'banco',         v_row.banco,
    'agencia',       v_row.agencia,
    'conta',         v_row.conta,
    'tipo_conta',    v_row.tipo_conta,
    'tipo_pix',      v_row.tipo_pix,
    'chave_pix',     v_row.chave_pix,
    'carimbo',       v_row.carimbo,
    'atualizado_em', v_row.updated_at
  );
end $$;

revoke all on function public.cliente_dados_bancarios(uuid) from public;
grant execute on function public.cliente_dados_bancarios(uuid) to authenticated;
