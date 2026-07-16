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

/** Soma o value de um campo de video (*_watched_actions vem como array de actions). */
function videoField(row, campo) {
  let total = 0;
  for (const a of row?.[campo] || []) total += Number(a?.value) || 0;
  return total;
}

/** Insights diarios (time_increment=1, level campaign|adset|ad) -> linha de meta_ads_diario. */
export function insightToDiario(row, level, accountId) {
  const { conversas, leadsForm } = actionsToCounts(row?.actions);
  let video3s = 0;
  for (const a of row?.actions || []) {
    if (a?.action_type === ACTION_VIDEO_3S) video3s += Number(a.value) || 0;
  }
  const freq = Number(row?.frequency);
  const entity = level === 'ad' ? row?.ad_id : level === 'adset' ? row?.adset_id : row?.campaign_id;
  return {
    dia: String(row?.date_start || '').slice(0, 10),
    level,
    entity_id: String(entity || ''),
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
    video_thruplay: videoField(row, 'video_thruplay_watched_actions'),
    video_p25: videoField(row, 'video_p25_watched_actions'),
    video_p50: videoField(row, 'video_p50_watched_actions'),
    video_p75: videoField(row, 'video_p75_watched_actions'),
    video_p100: videoField(row, 'video_p100_watched_actions'),
    raw: { actions: row?.actions || [] },
  };
}

// ─── v2 (16/07/2026): RH fora da captacao, adsets, breakdowns, video ─────────

/**
 * Campanhas de VAGA (RH — curriculos p/ o escritorio) nao tem relacao com
 * vendas/contratos (decisao Paulo 16/07): saem de TODOS os numeros de captacao
 * (KPIs, serie, rankings, comercial e alertas). Deteccao pelo nome: prefixo
 * marcado ([VAGA]/[VAGAS]/[RH]) ou nome comecando com "vaga".
 */
export function isCampanhaRh(nome) {
  const n = String(nome || '').trim().toLowerCase();
  if (!n) return false;
  return /^\[?\s*(vagas?|rh)\b/.test(n);
}

/** Conjunto (adset) do Graph -> linha de meta_conjuntos. Budget em centavos. */
export function adsetToRow(s, accountId) {
  const budget = Number(s?.daily_budget);
  return {
    adset_id: String(s?.id || ''),
    campaign_id: String(s?.campaign_id || ''),
    account_id: accountId,
    nome: s?.name || '',
    status: s?.effective_status || s?.status || null,
    orcamento_diario: Number.isFinite(budget) && budget > 0 ? budget / 100 : null,
  };
}

const GENERO_PT = { female: 'feminino', male: 'masculino', unknown: 'desconhecido' };

/** Linha de insights com breakdown (age_gender | region | platform_position) -> meta_ads_breakdown. */
export function breakdownToLinha(row, tipo, accountId) {
  const { conversas, leadsForm } = actionsToCounts(row?.actions);
  let chave = '';
  if (tipo === 'age_gender') chave = `${row?.age || '?'} · ${GENERO_PT[row?.gender] || row?.gender || '?'}`;
  else if (tipo === 'region') chave = row?.region || '?';
  else chave = `${row?.publisher_platform || '?'} · ${row?.platform_position || '?'}`;
  return {
    dia: String(row?.date_start || '').slice(0, 10),
    tipo,
    chave,
    account_id: accountId,
    gasto: Number(row?.spend) || 0,
    conversas_iniciadas: conversas,
    leads_form: leadsForm,
    impressoes: Number(row?.impressions) || 0,
    cliques_link: Number(row?.inline_link_clicks) || 0,
  };
}

/** Config default dos alertas (editavel em bot_config['meta_trafego'].alertas). */
export const ALERTAS_DEFAULT = { ativo: true, cpl_mult: 2, cpl_gasto_min_dia: 100, queda_leads_pct: 50, freq_alta: 3, gasto_sem_lead_min: 150 };

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

  // media de CPL da conta (historico sem ontem) — usada nas regras por campanha
  let mediaCplConta = null;
  if (conta.length >= 8) {
    const hist = conta.slice(0, -1);
    const g = hist.reduce((s, d) => s + (Number(d.gasto) || 0), 0);
    const l = hist.reduce((s, d) => s + (Number(d.leads) || 0), 0);
    if (l > 0) mediaCplConta = g / l;
  }

  // 2) Entrega zerada — campanha ATIVA que nao gastou nada ontem (RH/vagas fora)
  for (const c of series?.ontem_campanhas || []) {
    if (isCampanhaRh(c?.nome)) continue;
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

  // 2b) (v2 #100) CPL por CAMPANHA ontem >> media da conta (gasto minimo, RH fora)
  if (mediaCplConta != null) {
    for (const c of series?.ontem_campanhas || []) {
      if (isCampanhaRh(c?.nome)) continue;
      const gasto = Number(c?.gasto) || 0;
      const leads = Number(c?.leads) || 0;
      if (gasto >= cfg.cpl_gasto_min_dia && leads > 0) {
        const cpl = gasto / leads;
        if (cpl > cfg.cpl_mult * mediaCplConta) {
          alertas.push({
            tipo: 'cpl_campanha',
            campanha: c.nome || c.campaign_id,
            campaign_id: c.campaign_id,
            mensagem: `Campanha "${c.nome || c.campaign_id}": CPL de ontem R$ ${cpl.toFixed(2)} — ${cfg.cpl_mult}x acima da média da conta (R$ ${mediaCplConta.toFixed(2)})`,
            valor: cpl,
            limite: cfg.cpl_mult * mediaCplConta,
          });
        }
      }
    }
  }

  // 2c) (v2 #102) Conta gastou ontem acima do minimo e nao trouxe NENHUM lead
  if (conta.length >= 1) {
    const ontem = conta[conta.length - 1];
    const gastoOntem = Number(ontem?.gasto) || 0;
    if (gastoOntem >= cfg.gasto_sem_lead_min && (Number(ontem?.leads) || 0) === 0) {
      alertas.push({
        tipo: 'zero_leads_gasto',
        mensagem: `Ontem a conta gastou R$ ${gastoOntem.toFixed(2)} e não registrou NENHUM lead — verificar campanhas/WhatsApp`,
        valor: gastoOntem,
        limite: cfg.gasto_sem_lead_min,
      });
    }
  }

  // 2d) (v2 #103) POSITIVO: ontem foi o melhor CPL da serie (com gasto minimo)
  if (conta.length >= 8) {
    const cpls = conta
      .map((d) => ((Number(d.leads) || 0) > 0 && (Number(d.gasto) || 0) >= cfg.cpl_gasto_min_dia ? (Number(d.gasto) || 0) / Number(d.leads) : null));
    const cplOntem = cpls[cpls.length - 1];
    const historicos = cpls.slice(0, -1).filter((v) => v != null);
    if (cplOntem != null && historicos.length >= 5 && cplOntem < Math.min(...historicos)) {
      alertas.push({
        tipo: 'melhor_cpl',
        positivo: true,
        mensagem: `🎉 Melhor CPL da série: ontem fechou em R$ ${cplOntem.toFixed(2)} — menor custo por lead dos últimos ${conta.length} dias`,
        valor: cplOntem,
        limite: Math.min(...historicos),
      });
    }
  }

  // 2e) (v2 #109) Queda de leads POR CAMPANHA: 7d < pct% dos 7d anteriores (volume minimo, RH fora)
  for (const c of series?.campanhas_14d || []) {
    if (isCampanhaRh(c?.nome)) continue;
    const l7 = Number(c?.leads_7d) || 0;
    const l7ant = Number(c?.leads_7d_ant) || 0;
    const limite = l7ant * (cfg.queda_leads_pct / 100);
    if (l7ant >= 20 && l7 < limite) {
      alertas.push({
        tipo: 'queda_leads_campanha',
        campanha: c.nome || c.campaign_id,
        campaign_id: c.campaign_id,
        mensagem: `Campanha "${c.nome || c.campaign_id}": leads da semana caíram para ${l7} (semana anterior: ${l7ant})`,
        valor: l7,
        limite,
      });
    }
  }

  // 2f) (v2 #73) Criativo saturando: freq alta E CTR desabando na semana (gasto relevante)
  for (const a of series?.criativos_14d || []) {
    const freq = Number(a?.freq) || 0;
    const ctrA = Number(a?.ctr_atual) || 0;
    const ctrP = Number(a?.ctr_anterior) || 0;
    if (freq >= 3.5 && ctrP > 0 && ctrA < 0.7 * ctrP && (Number(a?.gasto_7d) || 0) >= 50) {
      alertas.push({
        tipo: 'criativo_saturando',
        campaign_id: a.ad_id,
        mensagem: `Criativo "${a.nome || a.ad_id}" (${a.campanha || '—'}) saturando: frequência ${freq.toFixed(1)} e CTR caiu de ${ctrP.toFixed(2)}% para ${ctrA.toFixed(2)}% — hora de trocar`,
        valor: freq,
        limite: 3.5,
      });
    }
  }

  // 2g) (v2 #101) Frequencia media da conta (ponderada por gasto 7d) acima do limite
  const cri = series?.criativos_14d || [];
  if (cri.length) {
    let peso = 0;
    let soma = 0;
    for (const a of cri) {
      const g = Number(a?.gasto_7d) || 0;
      const f = Number(a?.freq) || 0;
      if (g > 0 && f > 0) { soma += f * g; peso += g; }
    }
    if (peso > 0) {
      const freqMedia = soma / peso;
      if (freqMedia >= cfg.freq_alta) {
        alertas.push({
          tipo: 'frequencia_alta',
          mensagem: `Frequência média da conta em ${freqMedia.toFixed(1)} (limite ${cfg.freq_alta}) — público começando a saturar; considerar públicos/criativos novos`,
          valor: freqMedia,
          limite: cfg.freq_alta,
        });
      }
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

/**
 * (v2 #104) Resumo semanal (segunda de manha): semana fechada vs anterior +
 * top campanhas por leads. RH/vagas fora. `series` = meta_trafego_series(14).
 * Retorna { assunto, linhas[] } pronto p/ sendAlertEmail.
 */
export function montarResumoSemanal(series) {
  const conta = [...(series?.conta || [])].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
  const at = conta.slice(-7);
  const ant = conta.slice(-14, -7);
  const soma = (arr, k) => arr.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const leads = soma(at, 'leads');
  const leadsAnt = soma(ant, 'leads');
  const gasto = soma(at, 'gasto');
  const gastoAnt = soma(ant, 'gasto');
  const cpl = leads > 0 ? gasto / leads : null;
  const cplAnt = leadsAnt > 0 ? gastoAnt / leadsAnt : null;
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

  const linhas = [
    `Leads da semana: ${leads} (${pct(leads, leadsAnt) == null ? 'sem base' : (pct(leads, leadsAnt) >= 0 ? '+' : '') + pct(leads, leadsAnt) + '%'} vs semana anterior: ${leadsAnt})`,
    `Investimento: R$ ${gasto.toFixed(2)} (semana anterior: R$ ${gastoAnt.toFixed(2)})`,
    `CPL: ${cpl != null ? 'R$ ' + cpl.toFixed(2) : '—'}${cplAnt != null ? ` (anterior: R$ ${cplAnt.toFixed(2)})` : ''}`,
  ];

  const top = (series?.campanhas_14d || [])
    .filter((c) => !isCampanhaRh(c?.nome) && (Number(c?.leads_7d) || 0) > 0)
    .sort((a, b) => (Number(b.leads_7d) || 0) - (Number(a.leads_7d) || 0))
    .slice(0, 3);
  for (const c of top) {
    const cplC = (Number(c.gasto_7d) || 0) > 0 && (Number(c.leads_7d) || 0) > 0 ? (Number(c.gasto_7d) / Number(c.leads_7d)).toFixed(2) : '—';
    linhas.push(`• ${c.nome}: ${c.leads_7d} leads · CPL R$ ${cplC}`);
  }

  return { assunto: `📊 Tráfego da semana: ${leads} leads · R$ ${gasto.toFixed(0)} investidos`, linhas };
}
