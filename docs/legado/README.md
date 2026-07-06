# Legado (inerte)

SQLs de sistemas já **removidos**, movidos da raiz em 06/07/2026 (auditoria #28) por
serem referência histórica inerte:

- `supabase_chatguru_automations.sql` — automações do **ChatGuru**, substituído pelo
  **Kommo** em 23/05/2026. Não roda mais nada.
- `supabase_leads.sql` — schema da antiga aba **Leads**, removida.

⚠️ **Limpeza do CÓDIGO do ChatGuru ainda PENDENTE** (não feita nesta sessão por exigir
validação do Paulo): a flag `naoMandarMensagem` ainda tem um checkbox no `FormPanel.jsx`
(sem efeito, mas visível — remover exige decisão de UI), e o parsing de `chatguruLink`
em `utils/importContrato.js` só deve sair **se não houver QR codes antigos em circulação**
(confirmar com o Paulo). Refs a `chatguru` espalhadas em App.jsx, AdminPanel, AsaasPanel,
ImportContratoModal, ContratosTab, ChangeLog.
