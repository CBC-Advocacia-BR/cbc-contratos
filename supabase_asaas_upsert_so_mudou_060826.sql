-- ─────────────────────────────────────────────────────────────────────────
-- GRAVAR SO O QUE MUDOU — piloto na asaas_boletos (06/08/2026, aprovacao Paulo)
-- Migracao aplicada via MCP: `asaas_upsert_so_grava_mudanca`
--
-- Contexto: auditoria de 06/08 mediu que 53,8% de TODA a escrita em disco do banco
-- (3,7 GB de 6,8 GB em 20 dias) vem de rotinas que regravam linhas identicas.
-- Nesta tabela: 201.498 regravacoes para 13.030 boletos em 20 dias.
--
-- Regra nova no ON CONFLICT: grava quando algum DADO efetivo mudou (IS DISTINCT FROM
-- coluna a coluna, com a MESMA semantica de coalesce do SET) OU quando a ultima
-- gravacao tem mais de 20h (mantem o `synced_at` andando para o stale_open, que
-- escolhe o que re-verificar na API por esse carimbo). Nunca gera MAIS gravacoes
-- que o comportamento antigo. updated_at/synced_at fora da comparacao de proposito
-- (o cliente os carimba com a hora atual em toda linha).
--
-- PROVA DE EQUIVALENCIA (06/08, rodada em transacao revertida — nada persistiu):
--   a) dados identicos+carimbo fresco -> 0 gravacoes           [ok]
--   b) um campo mudou                 -> 1 gravacao, valor novo [ok]
--   d) campo direto vira NULO         -> 1 gravacao             [ok]
--   e) campo coalesce vem nulo        -> 0 gravacoes, NF intacta[ok]
--   f) carimbo >20h, dados identicos  -> 1 gravacao (stale ok)  [ok]
--   c) id inedito                     -> insercao               [ok]
--
-- Baseline p/ verificacao pos-sync (contador n_tup_upd): 201.505 em 06/08 23h41 UTC.
-- Proxima sincronizacao natural: 07/08 09h UTC (06h BRT). Expectativa: gravacoes do
-- ciclo caem de ~5.000 para centenas (mudancas reais + carimbos vencidos).
-- Rollback: backups/20260806_203949_asaas_upsert_so_mudou/asaas_mirror_upsert_ANTERIOR.sql
-- Conferido antes: NENHUM chamador usa o retorno da RPC (asaasMirror.mjs so checa error)
-- e a tabela nao tem gatilhos nem esta na publicacao do Realtime.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.asaas_mirror_upsert(p_chave text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  if not _bot_chave_ok(p_chave) then raise exception 'acesso negado'; end if;
  insert into asaas_boletos
  select * from jsonb_populate_recordset(null::asaas_boletos, p_rows)
  on conflict (id) do update set
    customer_id = coalesce(excluded.customer_id, asaas_boletos.customer_id),
    customer_name = coalesce(excluded.customer_name, asaas_boletos.customer_name),
    customer_cpf = coalesce(excluded.customer_cpf, asaas_boletos.customer_cpf),
    value = excluded.value, net_value = excluded.net_value,
    status = excluded.status, due_date = excluded.due_date, payment_date = excluded.payment_date,
    description = coalesce(excluded.description, asaas_boletos.description),
    external_reference = excluded.external_reference,
    bank_slip_url = excluded.bank_slip_url, invoice_url = excluded.invoice_url,
    nf_pdf_url = coalesce(excluded.nf_pdf_url, asaas_boletos.nf_pdf_url),
    nf_xml_url = coalesce(excluded.nf_xml_url, asaas_boletos.nf_xml_url),
    nf_number = coalesce(excluded.nf_number, asaas_boletos.nf_number),
    nf_status = coalesce(excluded.nf_status, asaas_boletos.nf_status),
    pix_copy_paste = coalesce(excluded.pix_copy_paste, asaas_boletos.pix_copy_paste),
    pix_qr_code = coalesce(excluded.pix_qr_code, asaas_boletos.pix_qr_code),
    installment_id = excluded.installment_id, installment_number = excluded.installment_number,
    installment_total = excluded.installment_total, billing_type = excluded.billing_type,
    date_created = excluded.date_created, updated_at = excluded.updated_at, synced_at = excluded.synced_at
  where
    ( coalesce(excluded.customer_id,   asaas_boletos.customer_id),
      coalesce(excluded.customer_name, asaas_boletos.customer_name),
      coalesce(excluded.customer_cpf,  asaas_boletos.customer_cpf),
      excluded.value, excluded.net_value, excluded.status, excluded.due_date, excluded.payment_date,
      coalesce(excluded.description, asaas_boletos.description),
      excluded.external_reference, excluded.bank_slip_url, excluded.invoice_url,
      coalesce(excluded.nf_pdf_url,     asaas_boletos.nf_pdf_url),
      coalesce(excluded.nf_xml_url,     asaas_boletos.nf_xml_url),
      coalesce(excluded.nf_number,      asaas_boletos.nf_number),
      coalesce(excluded.nf_status,      asaas_boletos.nf_status),
      coalesce(excluded.pix_copy_paste, asaas_boletos.pix_copy_paste),
      coalesce(excluded.pix_qr_code,    asaas_boletos.pix_qr_code),
      excluded.installment_id, excluded.installment_number, excluded.installment_total,
      excluded.billing_type, excluded.date_created )
    is distinct from
    ( asaas_boletos.customer_id, asaas_boletos.customer_name, asaas_boletos.customer_cpf,
      asaas_boletos.value, asaas_boletos.net_value, asaas_boletos.status, asaas_boletos.due_date,
      asaas_boletos.payment_date, asaas_boletos.description, asaas_boletos.external_reference,
      asaas_boletos.bank_slip_url, asaas_boletos.invoice_url, asaas_boletos.nf_pdf_url,
      asaas_boletos.nf_xml_url, asaas_boletos.nf_number, asaas_boletos.nf_status,
      asaas_boletos.pix_copy_paste, asaas_boletos.pix_qr_code, asaas_boletos.installment_id,
      asaas_boletos.installment_number, asaas_boletos.installment_total, asaas_boletos.billing_type,
      asaas_boletos.date_created )
    or asaas_boletos.synced_at is null
    or asaas_boletos.synced_at < now() - interval '20 hours';
  get diagnostics n = row_count;
  return n;
end $function$;
