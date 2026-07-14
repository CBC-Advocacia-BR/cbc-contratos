/**
 * Modulo PURO (sem IO/env) — parsing dos insights de campanha da Meta Marketing API
 * para as linhas mensais gravadas em meta_ads_mensal (via RPC meta_ads_upsert).
 * Testado em client/src/utils/__tests__/metaAds.test.js (mesmo padrao do
 * assinaturaWhatsapp.mjs: logica testavel separada da function com IO).
 *
 * "Lead" de campanha click-to-WhatsApp = conversa iniciada atribuida ao anuncio
 * (action_type onsite_conversion.messaging_conversation_started_7d — e o numero
 * de "resultados" que o Gerenciador de Anuncios mostra). Campanhas de formulario
 * (lead ads) contam em leads_form.
 */

export const ACTION_CONVERSA = 'onsite_conversion.messaging_conversation_started_7d';
export const ACTION_LEAD_FORM = ['lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped'];

const LEAD_FORM_SET = new Set(ACTION_LEAD_FORM);

/** Soma conversas iniciadas e lead forms de um array `actions` dos insights. */
export function actionsToCounts(actions) {
  let conversas = 0;
  let leadsForm = 0;
  for (const a of actions || []) {
    const v = Number(a?.value) || 0;
    if (a?.action_type === ACTION_CONVERSA) conversas += v;
    else if (LEAD_FORM_SET.has(a?.action_type)) leadsForm += v;
  }
  return { conversas, leadsForm };
}

/** 1o dia do mes (UTC) em YYYY-MM-01. */
export function ymFirstDay(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Converte 1 linha de insights (level=campaign, time_increment=monthly) na linha da RPC. */
export function insightRowToLinha(row, accountId) {
  const { conversas, leadsForm } = actionsToCounts(row?.actions);
  return {
    mes: `${String(row?.date_start || '').slice(0, 7)}-01`,
    account_id: accountId,
    campaign_id: String(row?.campaign_id || ''),
    campaign_name: row?.campaign_name || '',
    conversas_iniciadas: conversas,
    leads_form: leadsForm,
    gasto: Number(row?.spend) || 0,
    impressoes: Number(row?.impressions) || 0,
    cliques: Number(row?.clicks) || 0,
    raw: { actions: row?.actions || [] },
  };
}
