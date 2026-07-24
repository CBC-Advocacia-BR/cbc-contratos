-- Migracao: Vinculo Kommo no Novo Contrato (v1)
-- ADITIVA E REVERSIVEL. Aplicar SO com OK do Paulo (toca o schema compartilhado atendimento).
-- atendimento ja e exposto ao PostgREST (o app do Arquivo CBC Conversas o usa via RPC).

-- (1) Registro da excecao "contrato sem lead no Kommo"
ALTER TABLE public.contratos ADD COLUMN IF NOT EXISTS sem_kommo jsonb;

-- (2) 1a mensagem no Arquivo CBC Conversas (schema atendimento e RLS deny-all).
--     SECURITY DEFINER + segredo BOT_RPC_SECRET (mesmo helper das RPCs asaas/meta).
CREATE OR REPLACE FUNCTION atendimento.primeira_msg_por_telefone(p_tel text, p_chave text)
RETURNS TABLE(primeira_msg timestamptz, tem_conversa boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = atendimento, public AS $$
DECLARE t11 text;
BEGIN
  IF NOT public._bot_chave_ok(p_chave) THEN RAISE EXCEPTION 'acesso negado'; END IF;
  t11 := right(regexp_replace(coalesce(p_tel,''), '\D', '', 'g'), 11);
  IF length(t11) < 10 THEN
    RETURN QUERY SELECT NULL::timestamptz, false; RETURN;
  END IF;
  RETURN QUERY
  SELECT min(m.enviada_em), (count(*) > 0)
  FROM atendimento.contatos c
  JOIN atendimento.conversas cv ON cv.contato_id = c.id AND cv.excluida_em IS NULL
  JOIN atendimento.mensagens m ON m.conversa_id = cv.id
  WHERE right(regexp_replace(coalesce(c.whatsapp_numero,''), '\D', '', 'g'), 11) = t11;
END $$;

REVOKE ALL ON FUNCTION atendimento.primeira_msg_por_telefone(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION atendimento.primeira_msg_por_telefone(text, text) TO authenticated, service_role;

-- (3) RPC combinada (aplicada 24/07): cliente do Cadastro + 1a msg do CBC Conversas de uma vez.
--     Chamada pela function via o `db` do botDb (anon + segredo) — evita createClient/JWT do caller
--     no runtime das functions (onde VITE_SUPABASE_ANON_KEY nao existe -> "supabaseKey is required").
CREATE OR REPLACE FUNCTION public.resolve_kommo_dados(p_lead text, p_tel text, p_chave text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, atendimento AS $$
DECLARE v_cliente jsonb; v_pm timestamptz; v_tem boolean := false; t11 text;
BEGIN
  IF NOT public._bot_chave_ok(p_chave) THEN RAISE EXCEPTION 'acesso negado'; END IF;
  t11 := right(regexp_replace(coalesce(p_tel,''),'\D','','g'),11);
  SELECT to_jsonb(c.*) INTO v_cliente
  FROM public.clientes c
  WHERE c.kommo_lead_id = p_lead
     OR (length(t11) >= 10 AND right(regexp_replace(coalesce(c.telefone,''),'\D','','g'),11) = t11)
  ORDER BY (c.kommo_lead_id = p_lead) DESC NULLS LAST
  LIMIT 1;
  IF length(t11) >= 10 THEN
    SELECT min(m.enviada_em), count(*)>0 INTO v_pm, v_tem
    FROM atendimento.contatos ct
    JOIN atendimento.conversas cv ON cv.contato_id=ct.id AND cv.excluida_em IS NULL
    JOIN atendimento.mensagens m ON m.conversa_id=cv.id
    WHERE right(regexp_replace(coalesce(ct.whatsapp_numero,''),'\D','','g'),11) = t11;
  END IF;
  RETURN jsonb_build_object('cliente', v_cliente, 'primeira_msg', v_pm, 'tem_conversa', coalesce(v_tem,false));
END $$;
REVOKE ALL ON FUNCTION public.resolve_kommo_dados(text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_kommo_dados(text,text,text) TO anon, authenticated, service_role;

-- ROLLBACK:
--   ALTER TABLE public.contratos DROP COLUMN IF EXISTS sem_kommo;
--   DROP FUNCTION IF EXISTS atendimento.primeira_msg_por_telefone(text, text);
--   DROP FUNCTION IF EXISTS public.resolve_kommo_dados(text, text, text);
