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

// ─── Aba Trafego (14/07/2026): catalogos + diario + motor de alertas ─────────
// Mesma filosofia do resto do modulo: funcoes PURAS, sem IO/env, testadas em
// client/src/utils/__tests__/metaAds.test.js. A function meta-trafego-sync so
// orquestra fetch/RPC; toda conversao e regra de alerta mora aqui.

/** 3-second video plays nos insights (action_type video_view). */
const ACTION_VIDEO_3S = 'video_view';

/** Campanha do Graph (/campaigns) -> linha de meta_campanhas. Budget vem em CENTAVOS. */
export function campaignToRow(c, accountId) {
  const budget = Number(c?.daily_budget);
  return {
    campaign_id: String(c?.id || ''),
    account_id: accountId,
    nome: c?.name || '',
    status: c?.effective_status || c?.status || null,
    objetivo: c?.objective || null,
    orcamento_diario: Number.isFinite(budget) && budget > 0 ? budget / 100 : null,
  };
}

/** Anuncio do Graph (/ads com creative) -> linha de meta_anuncios. */
export function adToRow(ad, accountId) {
  return {
    ad_id: String(ad?.id || ''),
    campaign_id: String(ad?.campaign_id || ''),
    account_id: accountId,
    nome: ad?.name || '',
    status: ad?.effective_status || ad?.status || null,
    thumbnail_url: ad?.creative?.thumbnail_url || null,
    permalink: ad?.preview_shareable_link || null,
  };
}

/** Insights diarios (time_increment=1, level campaign|ad) -> linha de meta_ads_diario. */
export function insightToDiario(row, level, accountId) {
  const { conversas, leadsForm } = actionsToCounts(row?.actions);
  let video3s = 0;
  for (const a of row?.actions || []) {
    if (a?.action_type === ACTION_VIDEO_3S) video3s += Number(a.value) || 0;
  }
  const freq = Number(row?.frequency);
  return {
    dia: String(row?.date_start || '').slice(0, 10),
    level,
    entity_id: String((level === 'ad' ? row?.ad_id : row?.campaign_id) || ''),
    campaign_id: String(row?.campaign_id || ''),
    account_id: accountId,
    gasto: Number(row?.spend) || 0,
    conversas_iniciadas: conversas,
    leads_form: leadsForm,
    impressoes: Number(row?.impressions) || 0,
    alcance: Number(row?.reach) || 0,
    cliques: Number(row?.clicks) || 0,
    cliques_link: Number(row?.inline_link_clicks) || 0,
    frequencia: Number.isFinite(freq) && freq > 0 ? freq : null,
    video_3s: video3s,
    raw: { actions: row?.actions || [] },
  };
}

/** Config default dos alertas (editavel em bot_config['meta_trafego'].alertas). */
export const ALERTAS_DEFAULT = { ativo: true, cpl_mult: 2, cpl_gasto_min_dia: 100, queda_leads_pct: 50 };

/**
 * Motor de alertas. `series` = retorno da RPC meta_trafego_series:
 * { conta: [{dia, gasto, leads}...  ate ONTEM], ontem_campanhas: [{campaign_id, nome, status, gasto, leads}] }.
 * Regras (spec §5): cpl_estourado (CPL de ontem > cpl_mult x media historica, com gasto
 * minimo anti-ruido), entrega_zerada (ACTIVE com gasto 0 ontem), queda_leads (7d < pct% dos
 * 7d anteriores). Serie curta = sem alerta (falta de dado nao e incidente).
 */
export function avaliarAlertasTrafego(series, config = {}) {
  const cfg = { ...ALERTAS_DEFAULT, ...config };
  const alertas = [];
  const conta = [...(series?.conta || [])].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));

  // 1) CPL estourado — ontem vs media dos dias anteriores (>= 7 dias de historico)
  if (conta.length >= 8) {
    const ontem = conta[conta.length - 1];
    const historico = conta.slice(0, -1);
    const gastoHist = historico.reduce((s, d) => s + (Number(d.gasto) || 0), 0);
    const leadsHist = historico.reduce((s, d) => s + (Number(d.leads) || 0), 0);
    const gastoOntem = Number(ontem.gasto) || 0;
    const leadsOntem = Number(ontem.leads) || 0;
    if (leadsHist > 0 && leadsOntem > 0 && gastoOntem >= cfg.cpl_gasto_min_dia) {
      const mediaCpl = gastoHist / leadsHist;
      const cplOntem = gastoOntem / leadsOntem;
      if (cplOntem > cfg.cpl_mult * mediaCpl) {
        alertas.push({
          tipo: 'cpl_estourado',
          mensagem: `CPL de ontem R$ ${cplOntem.toFixed(2)} — acima de ${cfg.cpl_mult}x a média (limite R$ ${(cfg.cpl_mult * mediaCpl).toFixed(2)})`,
          valor: cplOntem,
          limite: cfg.cpl_mult * mediaCpl,
        });
      }
    }
  }

  // 2) Entrega zerada — campanha ATIVA que nao gastou nada ontem
  for (const c of series?.ontem_campanhas || []) {
    if (c?.status === 'ACTIVE' && (Number(c.gasto) || 0) === 0) {
      alertas.push({
        tipo: 'entrega_zerada',
        campanha: c.nome || c.campaign_id,
        campaign_id: c.campaign_id,
        mensagem: `Campanha "${c.nome || c.campaign_id}" está ATIVA mas não gastou nada ontem (entrega zerada)`,
        valor: 0,
        limite: null,
      });
    }
  }

  // 3) Queda de leads — ultimos 7 dias vs 7 anteriores (>= 14 dias de serie)
  if (conta.length >= 14) {
    const ult7 = conta.slice(-7).reduce((s, d) => s + (Number(d.leads) || 0), 0);
    const ant7 = conta.slice(-14, -7).reduce((s, d) => s + (Number(d.leads) || 0), 0);
    const limite = ant7 * (cfg.queda_leads_pct / 100);
    if (ant7 > 0 && ult7 < limite) {
      alertas.push({
        tipo: 'queda_leads',
        mensagem: `Leads da semana caíram para ${ult7} — abaixo de ${cfg.queda_leads_pct}% da semana anterior (${ant7})`,
        valor: ult7,
        limite,
      });
    }
  }

  return alertas;
}
