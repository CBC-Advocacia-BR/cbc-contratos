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

-- ROLLBACK:
--   ALTER TABLE public.contratos DROP COLUMN IF EXISTS sem_kommo;
--   DROP FUNCTION IF EXISTS atendimento.primeira_msg_por_telefone(text, text);
