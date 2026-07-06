-- Migração: disparo automatico de links de assinatura via Kommo/WhatsApp (02/07/2026)
-- Spec: docs/superpowers/specs/2026-07-02-assinatura-whatsapp-kommo-design.md
-- Aditiva: coluna de resultado do disparo (1 disparo por contrato, lock atomico via
-- UPDATE condicional WHERE kommo_assinatura IS NULL — REGRA #3).
-- Shape: { status: processando|ok|parcial|fora_janela|erro, checked_at, started_at,
--          leads: [{ leadId, contratantes: [nome], resultado: enviado|fora_janela|erro,
--                    sent_at?, last_msg_at?, erro? }] }

ALTER TABLE public.contratos ADD COLUMN IF NOT EXISTS kommo_assinatura jsonb;

-- Seed da config (kill-switch nasce DESLIGADO; copy editavel sem redeploy).
-- Aplicado tambem via UPDATE em bot_config (key 'kommo', subchave 'assinatura'):
--   { ativo:false, field_id:null, field_name:'CBC Assinatura', bot_id:null,
--     bot_name:'CBC - Link Assinatura', janela_margem_min:60, msg_1, msg_2 }
