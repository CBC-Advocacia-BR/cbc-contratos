-- SDR de IA (Ana) v4 — 08/09/2026
-- 1) sdr_ia_historico: janela de 30 dias. Sem janela, as 40 mensagens mais recentes do contato
--    traziam cobranca/boleto de meses atras e a Ana concluia "ja e cliente" (piloto 08/09).
-- 2) sdr_ia_cadastro_por_fone: quem diz se o telefone e de cliente e o cadastro unico
--    (cliente_telefones -> clientes.eh_cliente), nao o historico de mensagens.
create or replace function sdr_ia_historico(p_chave text, p_contact_id bigint, p_limite int default 40)
returns table (autor text, autor_nome text, corpo text, tipo text, enviada_em timestamptz)
language plpgsql security definer set search_path = public, atendimento as $$
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  return query
    select * from (
      select m.autor, m.autor_nome, m.corpo, m.tipo, m.enviada_em
      from atendimento.contatos c
      join atendimento.conversas cv on cv.contato_id = c.id and cv.excluida_em is null
      join atendimento.mensagens m on m.conversa_id = cv.id
      where c.kommo_contact_id = p_contact_id
        and m.enviada_em >= now() - interval '30 days'
      order by m.enviada_em desc limit p_limite
    ) x order by x.enviada_em asc;
end $$;

create or replace function sdr_ia_cadastro_por_fone(p_chave text, p_fone text)
returns table (eh_cliente boolean, nome text, empreendimentos text, relacao text)
language plpgsql security definer set search_path = public as $$
declare
  v11 text; v10 text; vsem9 text;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  v11 := right(regexp_replace(coalesce(p_fone,''), '\D', '', 'g'), 11);   -- DDD + 9 + 8
  if length(v11) < 10 then return; end if;
  v10 := right(v11, 10);                                                    -- sem o DDD? nao: DDD+8 quando veio sem 9
  vsem9 := case when length(v11) = 11 then substr(v11, 1, 2) || substr(v11, 4) else v11 end;
  return query
    select c.eh_cliente, c.nome, c.empreendimentos, c.relacao
    from public.cliente_telefones t
    join public.clientes c on c.id = t.cliente_uid
    where c.fundido_em is null and c.eh_cliente = true
      and (
        right(regexp_replace(t.fone, '\D', '', 'g'), 11) = v11
        or regexp_replace(t.fone, '\D', '', 'g') = vsem9
        or right(regexp_replace(t.fone, '\D', '', 'g'), 10) = v10
      )
    order by t.principal desc nulls last, t.visto_em desc nulls last
    limit 1;
end $$;

revoke all on function sdr_ia_cadastro_por_fone(text, text) from public, anon, authenticated;
grant execute on function sdr_ia_cadastro_por_fone(text, text) to anon, authenticated;
