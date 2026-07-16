// (aba Trafego 14/07/2026) Logica PURA da aba — testavel (vitest), sem React/SDK.
// Recebe as linhas de meta_ads_diario (level campaign|ad) + catalogos e deriva
// KPIs com comparacao de periodo, serie diaria, metricas por campanha/criativo,
// fadiga e rankings. Formulas (spec §6): CTR = cliques_link/impressoes;
// CPM = gasto/impressoes*1000; CPL = gasto/leads; hook = video_3s/impressoes.

export const FREQ_SATURACAO = 3.5;          // frequencia a partir da qual o criativo "cansa"
export const QUEDA_CTR_FADIGA = 0.7;        // saturando se CTR atual < 70% do periodo anterior
export const MIN_IMPRESSOES_RANKING = 500;  // anti-ruido: menos que isso nao ranqueia
export const RANKING_TOP = 5;
export const ATENCAO_CPL_MULT = 2;          // campanha em atencao se CPL > 2x a media da conta
export const ATENCAO_CPL_GASTO_MIN = 50;    // ...com gasto minimo no periodo (anti-ruido)

const num = (v) => Number(v) || 0;
const leadsDe = (r) => num(r.conversas_iniciadas) + num(r.leads_form);

function addDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function noRange(dia, inicio, fim) {
  return dia >= inicio && dia <= fim;
}

/** Soma um conjunto de linhas diarias em um agregado com metricas derivadas. */
function agregar(rows) {
  const a = { gasto: 0, leads: 0, impressoes: 0, alcance: 0, cliques: 0, cliquesLink: 0, video3s: 0, freqPeso: 0, freqImpr: 0 };
  for (const r of rows) {
    a.gasto += num(r.gasto);
    a.leads += leadsDe(r);
    a.impressoes += num(r.impressoes);
    a.alcance += num(r.alcance);
    a.cliques += num(r.cliques);
    a.cliquesLink += num(r.cliques_link);
    a.video3s += num(r.video_3s);
    if (r.frequencia != null && num(r.impressoes) > 0) {
      a.freqPeso += Number(r.frequencia) * num(r.impressoes);
      a.freqImpr += num(r.impressoes);
    }
  }
  return {
    gasto: a.gasto,
    leads: a.leads,
    impressoes: a.impressoes,
    alcance: a.alcance,
    cliques: a.cliques,
    cliquesLink: a.cliquesLink,
    video3s: a.video3s,
    cpl: a.leads > 0 ? a.gasto / a.leads : null,
    ctr: a.impressoes > 0 ? (a.cliquesLink / a.impressoes) * 100 : null,
    cpm: a.impressoes > 0 ? (a.gasto / a.impressoes) * 1000 : null,
    frequencia: a.freqImpr > 0 ? a.freqPeso / a.freqImpr : null,
    hookRate: a.video3s > 0 && a.impressoes > 0 ? (a.video3s / a.impressoes) * 100 : null,
  };
}

const deltaPct = (atual, prev) => (prev > 0 ? ((atual - prev) / prev) * 100 : null);

export function computeTrafego({ diario, campanhas, anuncios, inicio, fim }) {
  const rows = (diario || []).filter((r) => r && r.dia);
  const campRows = rows.filter((r) => r.level === 'campaign');
  const adRows = rows.filter((r) => r.level === 'ad');

  // periodo anterior de MESMA duracao, imediatamente antes
  const dur = Math.round((new Date(fim + 'T12:00:00') - new Date(inicio + 'T12:00:00')) / 86400000) + 1;
  const prevFim = addDias(inicio, -1);
  const prevInicio = addDias(prevFim, -(dur - 1));

  const campAtual = campRows.filter((r) => noRange(r.dia, inicio, fim));
  const campPrev = campRows.filter((r) => noRange(r.dia, prevInicio, prevFim));

  // ─── KPIs da conta (so level=campaign — linhas de anuncio dobrariam a soma) ───
  const atual = agregar(campAtual);
  const prev = agregar(campPrev);
  const kpis = {
    ...atual,
    prev,
    delta: {
      gasto: deltaPct(atual.gasto, prev.gasto),
      leads: deltaPct(atual.leads, prev.leads),
      cpl: atual.cpl != null && prev.cpl != null ? deltaPct(atual.cpl, prev.cpl) : null,
      ctr: atual.ctr != null && prev.ctr != null ? deltaPct(atual.ctr, prev.ctr) : null,
    },
  };

  // ─── Serie diaria (conta) ───
  const porDia = {};
  for (const r of campAtual) {
    const acc = (porDia[r.dia] = porDia[r.dia] || { dia: r.dia, gasto: 0, leads: 0 });
    acc.gasto += num(r.gasto);
    acc.leads += leadsDe(r);
  }
  const serie = Object.values(porDia)
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((s) => ({ ...s, cpl: s.leads > 0 ? s.gasto / s.leads : null }));

  // ─── Campanhas (catalogo + agregado do periodo + tendencia + atencao) ───
  const cplConta = atual.cpl;
  const listaCampanhas = (campanhas || []).map((c) => {
    const minhas = campAtual.filter((r) => r.entity_id === c.campaign_id);
    const agg = agregar(minhas);
    // tendencia: leads dos 7 dias ate `fim` vs os 7 anteriores (independe do inicio)
    const t1 = campRows.filter((r) => r.entity_id === c.campaign_id && noRange(r.dia, addDias(fim, -6), fim));
    const t0 = campRows.filter((r) => r.entity_id === c.campaign_id && noRange(r.dia, addDias(fim, -13), addDias(fim, -7)));
    const leads1 = t1.reduce((s, r) => s + leadsDe(r), 0);
    const leads0 = t0.reduce((s, r) => s + leadsDe(r), 0);
    let atencao = null;
    if (c.status === 'ACTIVE' && agg.gasto === 0) atencao = 'zerada';
    else if (agg.leads > 0 && cplConta != null && agg.gasto >= ATENCAO_CPL_GASTO_MIN && agg.cpl > ATENCAO_CPL_MULT * cplConta) atencao = 'cpl';
    return { ...c, ...agg, tendencia7d: deltaPct(leads1, leads0), atencao };
  }).sort((a, b) => b.gasto - a.gasto);

  // ─── Criativos (catalogo + agregado + hook + fadiga) ───
  const adPrev = adRows.filter((r) => noRange(r.dia, prevInicio, prevFim));
  const listaCriativos = (anuncios || []).map((a) => {
    const agg = agregar(adRows.filter((r) => r.entity_id === a.ad_id && noRange(r.dia, inicio, fim)));
    const aggPrev = agregar(adPrev.filter((r) => r.entity_id === a.ad_id));
    const saturando = agg.frequencia != null && agg.frequencia >= FREQ_SATURACAO
      && agg.ctr != null && aggPrev.ctr != null && aggPrev.ctr > 0
      && agg.ctr < QUEDA_CTR_FADIGA * aggPrev.ctr;
    return { ...a, ...agg, saturando: !!saturando };
  }).sort((a, b) => b.gasto - a.gasto);

  // ─── Rankings (anti-ruido: gasto > 0 e impressoes minimas) ───
  const base = listaCriativos.filter((c) => c.gasto > 0 && c.impressoes >= MIN_IMPRESSOES_RANKING);
  const rankings = {
    ctr: base.filter((c) => c.ctr != null).sort((a, b) => b.ctr - a.ctr).slice(0, RANKING_TOP),
    cpl: base.filter((c) => c.leads > 0).sort((a, b) => a.cpl - b.cpl).slice(0, RANKING_TOP),
    leads: base.filter((c) => c.leads > 0).sort((a, b) => b.leads - a.leads).slice(0, RANKING_TOP),
    hook: base.filter((c) => c.hookRate != null).sort((a, b) => b.hookRate - a.hookRate).slice(0, RANKING_TOP),
  };

  return { kpis, serie, campanhas: listaCampanhas, criativos: listaCriativos, rankings, periodo: { inicio, fim, prevInicio, prevFim } };
}

/** Data efetiva de assinatura (mesma regra do funil): signed_at -> advbox_date -> updated_at. */
function dataAssinatura(c) {
  if (!c || c.status !== 'assinado') return null;
  return c.signed_at || c.advbox_date || c.updated_at || null;
}

/**
 * Ponte comercial mensal "do anuncio ao contrato" (agregado por mes-calendario):
 * leads Meta -> videochamadas -> contratos enviados -> assinados + custo/assinado.
 * Atribuicao lead-a-lead vira com o espelho Kommo (fora da v1).
 */
export function computeComercialMensal({ mensal, videochamadas, contratos, meses = 6, agora = new Date() }) {
  const chaves = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    chaves.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const ativos = (contratos || []).filter((c) => c && c.status !== 'cancelado' && !c.arquivado_em);

  return chaves.map((mes) => {
    let leads = 0;
    let gasto = 0;
    for (const m of mensal || []) {
      if (String(m.mes).slice(0, 7) === mes) {
        leads += num(m.conversas_iniciadas) + num(m.leads_form);
        gasto += num(m.gasto);
      }
    }
    const vcs = (videochamadas || []).filter((v) => v.scheduled_at && v.status !== 'excluida' && String(v.scheduled_at).slice(0, 7) === mes).length;
    const enviados = ativos.filter((c) => c.zapsign_sent_at && String(c.zapsign_sent_at).slice(0, 7) === mes).length;
    const assinados = ativos.filter((c) => {
      const d = dataAssinatura(c);
      return d && String(d).slice(0, 7) === mes;
    }).length;
    return { mes, leads, gasto, videochamadas: vcs, enviados, assinados, custoPorAssinado: assinados > 0 ? gasto / assinados : null };
  });
}
