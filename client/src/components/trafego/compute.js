// (aba Trafego 14/07/2026, v2 16/07/2026) Logica PURA da aba — testavel (vitest),
// sem React/SDK. Deriva KPIs com comparacao, serie diaria (com media movel),
// campanhas/criativos/conjuntos, retencao de video, fadiga e previsao de
// saturacao, rankings (melhores E piores), breakdowns, temas, anomalias,
// resumo em linguagem natural, recomendacoes e a ponte comercial expandida.
// REGRA v2 (decisao Paulo 16/07): campanhas de VAGA (RH) ficam FORA de toda a
// captacao — so aparecem flagadas na tabela.
import { isCampanhaRh } from '../../../netlify/functions/_lib/metaAds.mjs';

export { isCampanhaRh };

export const FREQ_SATURACAO = 3.5;          // frequencia a partir da qual o criativo "cansa"
export const QUEDA_CTR_FADIGA = 0.7;        // saturando se CTR atual < 70% do periodo anterior
export const MIN_IMPRESSOES_RANKING = 500;  // anti-ruido: menos que isso nao ranqueia
export const RANKING_TOP = 5;
export const ATENCAO_CPL_MULT = 2;          // campanha em atencao se CPL > 2x a media da conta
export const ATENCAO_CPL_GASTO_MIN = 50;    // ...com gasto minimo no periodo (anti-ruido)
export const PIORES_GASTO_MIN = 50;         // ranking dos piores: gasto minimo p/ ser julgado
export const DONUT_TOP = 6;

// origens de contrato que contam como "veio da Meta" (dados->origemCliente)
export const ORIGENS_META = ['facebook', 'instagram', 'trafego pago', 'tráfego pago', 'anuncio', 'anúncio', 'meta', 'whatsapp'];

const num = (v) => Number(v) || 0;
const leadsDe = (r) => num(r.conversas_iniciadas) + num(r.leads_form);
const r1 = (v) => Math.round(v * 10) / 10;

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
  const a = {
    gasto: 0, leads: 0, impressoes: 0, alcance: 0, cliques: 0, cliquesLink: 0,
    video3s: 0, thruplay: 0, p25: 0, p50: 0, p75: 0, p100: 0, freqPeso: 0, freqImpr: 0,
  };
  for (const r of rows) {
    a.gasto += num(r.gasto);
    a.leads += leadsDe(r);
    a.impressoes += num(r.impressoes);
    a.alcance += num(r.alcance);
    a.cliques += num(r.cliques);
    a.cliquesLink += num(r.cliques_link);
    a.video3s += num(r.video_3s);
    a.thruplay += num(r.video_thruplay);
    a.p25 += num(r.video_p25);
    a.p50 += num(r.video_p50);
    a.p75 += num(r.video_p75);
    a.p100 += num(r.video_p100);
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
    videoThruplay: a.thruplay,
    videoP25: a.p25, videoP50: a.p50, videoP75: a.p75, videoP100: a.p100,
    cpl: a.leads > 0 ? a.gasto / a.leads : null,
    ctr: a.impressoes > 0 ? (a.cliquesLink / a.impressoes) * 100 : null,
    cpm: a.impressoes > 0 ? (a.gasto / a.impressoes) * 1000 : null,
    cpc: a.cliquesLink > 0 ? a.gasto / a.cliquesLink : null,
    frequencia: a.freqImpr > 0 ? a.freqPeso / a.freqImpr : null,
    hookRate: a.video3s > 0 && a.impressoes > 0 ? (a.video3s / a.impressoes) * 100 : null,
  };
}

const deltaPct = (atual, prev) => (prev > 0 ? ((atual - prev) / prev) * 100 : null);

/** (v2 #71) Curva semanal de um criativo: ctr/freq/leads por semana (fadiga visual). */
export function computeCurvaCriativo(diario, adId) {
  const rows = (diario || []).filter((r) => r.level === 'ad' && r.entity_id === adId && r.dia);
  if (!rows.length) return [];
  const dias = rows.map((r) => r.dia).sort();
  const fim = dias[dias.length - 1];
  const semanas = {};
  for (const r of rows) {
    const diff = Math.floor((new Date(fim + 'T12:00:00') - new Date(r.dia + 'T12:00:00')) / 86400000);
    const idx = Math.floor(diff / 7); // 0 = semana mais recente
    (semanas[idx] = semanas[idx] || []).push(r);
  }
  return Object.keys(semanas)
    .map(Number)
    .sort((a, b) => b - a) // mais antiga primeiro
    .map((idx) => {
      const agg = agregar(semanas[idx]);
      return { semana: `S-${idx}`, ctr: agg.ctr, frequencia: agg.frequencia, leads: agg.leads, gasto: agg.gasto };
    });
}

/** (v2 #177 v1) Temas por regra de nomenclatura: 1o marcador [TAG] do nome do anuncio. */
export function computeTemas(criativos) {
  const grupos = {};
  for (const c of criativos || []) {
    const m = String(c.nome || '').match(/^\s*\[([^\]]{1,16})\]/);
    const tema = m ? m[1].toUpperCase() : 'Outros';
    const g = (grupos[tema] = grupos[tema] || { tema, n: 0, gasto: 0, leads: 0, impressoes: 0, cliquesLink: 0 });
    g.n += 1;
    g.gasto += num(c.gasto);
    g.leads += num(c.leads);
    g.impressoes += num(c.impressoes);
    g.cliquesLink += num(c.cliquesLink);
  }
  return Object.values(grupos)
    .map((g) => ({
      ...g,
      cpl: g.leads > 0 ? g.gasto / g.leads : null,
      ctr: g.impressoes > 0 ? (g.cliquesLink / g.impressoes) * 100 : null,
    }))
    .sort((a, b) => b.gasto - a.gasto);
}

export function computeTrafego({ diario, campanhas, anuncios, conjuntos = [], inicio, fim, hoje = null, metas = null, comparar = null }) {
  const rows = (diario || []).filter((r) => r && r.dia);

  // ─── (v2 #48) RH/vagas fora de toda a captacao ───
  const rhIds = new Set((campanhas || []).filter((c) => isCampanhaRh(c.nome)).map((c) => c.campaign_id));
  const capta = (r) => !rhIds.has(r.campaign_id);

  const campRows = rows.filter((r) => r.level === 'campaign' && capta(r));
  const adRows = rows.filter((r) => r.level === 'ad' && capta(r));
  const adsetRows = rows.filter((r) => r.level === 'adset' && capta(r));

  // periodo anterior: custom (v2 #80) ou mesma duracao imediatamente antes
  const dur = Math.round((new Date(fim + 'T12:00:00') - new Date(inicio + 'T12:00:00')) / 86400000) + 1;
  const prevFim = comparar?.fim || addDias(inicio, -1);
  const prevInicio = comparar?.inicio || addDias(prevFim, -(dur - 1));

  const campAtual = campRows.filter((r) => noRange(r.dia, inicio, fim));
  const campPrev = campRows.filter((r) => noRange(r.dia, prevInicio, prevFim));

  // ─── KPIs da conta ───
  const atual = agregar(campAtual);
  const prev = agregar(campPrev);

  // (v2 #35) leads de hoje (dia corrente, se sincronizado)
  const leadsHoje = hoje ? campRows.filter((r) => r.dia === hoje).reduce((s, r) => s + leadsDe(r), 0) : null;

  // (v2 #14) share da maior campanha no periodo
  const porCampanhaLeads = {};
  for (const r of campAtual) porCampanhaLeads[r.campaign_id] = (porCampanhaLeads[r.campaign_id] || 0) + leadsDe(r);
  const maiores = Object.values(porCampanhaLeads).sort((a, b) => b - a);
  const shareMaiorCampanha = atual.leads > 0 && maiores.length ? Math.round((maiores[0] / atual.leads) * 100) : null;

  const kpis = {
    ...atual,
    leadsHoje,
    shareMaiorCampanha,
    prev,
    delta: {
      gasto: deltaPct(atual.gasto, prev.gasto),
      leads: deltaPct(atual.leads, prev.leads),
      cpl: atual.cpl != null && prev.cpl != null ? deltaPct(atual.cpl, prev.cpl) : null,
      ctr: atual.ctr != null && prev.ctr != null ? deltaPct(atual.ctr, prev.ctr) : null,
      cpm: atual.cpm != null && prev.cpm != null ? deltaPct(atual.cpm, prev.cpm) : null,
    },
  };

  // ─── (v2 #8/#10) meta mensal + projecao (mes corrente, precisa de `hoje`) ───
  let metaMensal = null;
  if (hoje) {
    const mesKey = hoje.slice(0, 7);
    const mtd = campRows.filter((r) => r.dia.slice(0, 7) === mesKey && r.dia <= hoje);
    const aggMtd = agregar(mtd);
    const diaN = Number(hoje.slice(8, 10));
    const diasNoMes = new Date(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0).getDate();
    const metaLeads = Number(metas?.leads_mes) || null;
    metaMensal = {
      mes: mesKey,
      leads: aggMtd.leads,
      gasto: aggMtd.gasto,
      metaLeads,
      pct: metaLeads > 0 ? Math.round((aggMtd.leads / metaLeads) * 100) : null,
      projecaoLeads: diaN > 0 ? Math.round((aggMtd.leads / diaN) * diasNoMes) : null,
      projecaoGasto: diaN > 0 ? (aggMtd.gasto / diaN) * diasNoMes : null,
    };
  }

  // ─── Serie diaria (conta) com media movel 7d (v2 #17) ───
  const leadsPorDia = {};
  for (const r of campRows) leadsPorDia[r.dia] = (leadsPorDia[r.dia] || 0) + leadsDe(r);
  const porDia = {};
  for (const r of campAtual) {
    const acc = (porDia[r.dia] = porDia[r.dia] || { dia: r.dia, gasto: 0, leads: 0 });
    acc.gasto += num(r.gasto);
    acc.leads += leadsDe(r);
  }
  const serie = Object.values(porDia)
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((s) => {
      let soma = 0;
      let n = 0;
      for (let k = 0; k < 7; k++) {
        const diaK = addDias(s.dia, -k);
        if (leadsPorDia[diaK] != null) { soma += leadsPorDia[diaK]; n++; }
      }
      return { ...s, cpl: s.leads > 0 ? s.gasto / s.leads : null, mm7: n > 0 ? soma / n : null };
    });

  // ─── Campanhas (todas, com flag rh; metricas so contam p/ nao-RH) ───
  const cplConta = atual.cpl;
  const listaCampanhas = (campanhas || []).map((c) => {
    const rh = rhIds.has(c.campaign_id);
    const minhasTodas = rows.filter((r) => r.level === 'campaign' && r.entity_id === c.campaign_id);
    const minhas = minhasTodas.filter((r) => noRange(r.dia, inicio, fim));
    const agg = agregar(minhas);
    const t1 = minhasTodas.filter((r) => noRange(r.dia, addDias(fim, -6), fim));
    const t0 = minhasTodas.filter((r) => noRange(r.dia, addDias(fim, -13), addDias(fim, -7)));
    const leads1 = t1.reduce((s, r) => s + leadsDe(r), 0);
    const leads0 = t0.reduce((s, r) => s + leadsDe(r), 0);
    const lHoje = hoje ? minhasTodas.filter((r) => r.dia === hoje).reduce((s, r) => s + leadsDe(r), 0) : null;
    let atencao = null;
    if (!rh) {
      if (c.status === 'ACTIVE' && agg.gasto === 0) atencao = 'zerada';
      else if (agg.leads > 0 && cplConta != null && agg.gasto >= ATENCAO_CPL_GASTO_MIN && agg.cpl > ATENCAO_CPL_MULT * cplConta) atencao = 'cpl';
    }
    return { ...c, ...agg, rh, leadsHoje: lHoje, tendencia7d: deltaPct(leads1, leads0), atencao };
  }).sort((a, b) => (a.rh === b.rh ? b.gasto - a.gasto : a.rh ? 1 : -1));

  // ─── (v2 #29) donut de gasto por campanha (top N + outras; RH fora) ───
  const donutBase = listaCampanhas.filter((c) => !c.rh && c.gasto > 0);
  const donut = donutBase.slice(0, DONUT_TOP).map((c) => ({ campaign_id: c.campaign_id, nome: c.nome, gasto: c.gasto, leads: c.leads }));
  const resto = donutBase.slice(DONUT_TOP).reduce((s, c) => s + c.gasto, 0);
  if (resto > 0) donut.push({ campaign_id: 'outras', nome: 'Outras', gasto: resto, leads: donutBase.slice(DONUT_TOP).reduce((s, c) => s + c.leads, 0) });

  // ─── Criativos (RH fora; retencao, fadiga, previsao de saturacao) ───
  const adPrev = adRows.filter((r) => noRange(r.dia, prevInicio, prevFim));
  const listaCriativos = (anuncios || [])
    .filter((a) => !rhIds.has(a.campaign_id))
    .map((a) => {
      const minhas = adRows.filter((r) => r.entity_id === a.ad_id && noRange(r.dia, inicio, fim));
      const agg = agregar(minhas);
      const aggPrev = agregar(adPrev.filter((r) => r.entity_id === a.ad_id));
      const saturando = agg.frequencia != null && agg.frequencia >= FREQ_SATURACAO
        && agg.ctr != null && aggPrev.ctr != null && aggPrev.ctr > 0
        && agg.ctr < QUEDA_CTR_FADIGA * aggPrev.ctr;
      // (v2 #56/#58) retencao em % das impressoes + queda hook->thruplay
      const retencao = agg.impressoes > 0 && agg.videoP25 > 0 ? {
        p25: (agg.videoP25 / agg.impressoes) * 100,
        p50: (agg.videoP50 / agg.impressoes) * 100,
        p75: (agg.videoP75 / agg.impressoes) * 100,
        p100: (agg.videoP100 / agg.impressoes) * 100,
      } : null;
      const thruplayRate = agg.videoThruplay > 0 && agg.impressoes > 0 ? (agg.videoThruplay / agg.impressoes) * 100 : null;
      const quedaHook = agg.videoThruplay > 0 && agg.video3s > 0 ? (agg.videoThruplay / agg.video3s) * 100 : null;
      // (v2 #72) previsao: inclinacao da frequencia semana vs semana -> dias ate FREQ_SATURACAO
      let saturaEmDias = null;
      const fAtual = agg.frequencia;
      const fAnt = aggPrev.frequencia;
      if (fAtual != null && fAnt != null && fAtual > fAnt) {
        if (fAtual >= FREQ_SATURACAO) saturaEmDias = 0;
        else {
          const porDiaFreq = (fAtual - fAnt) / Math.max(dur, 1);
          if (porDiaFreq > 0) saturaEmDias = Math.min(Math.ceil((FREQ_SATURACAO - fAtual) / porDiaFreq), 999);
        }
      }
      return { ...a, ...agg, saturando: !!saturando, retencao, thruplayRate, quedaHook, saturaEmDias };
    })
    .sort((a, b) => b.gasto - a.gasto);

  // ─── Rankings (anti-ruido) + piores (v2 #54) ───
  const base = listaCriativos.filter((c) => c.gasto > 0 && c.impressoes >= MIN_IMPRESSOES_RANKING);
  const elegiveisPiores = base.filter((c) => c.leads > 0 && c.gasto >= PIORES_GASTO_MIN);
  const cplsOrdenados = elegiveisPiores.map((c) => c.cpl).sort((a, b) => a - b);
  const meio = Math.floor(cplsOrdenados.length / 2);
  const mediana = !cplsOrdenados.length ? null
    : cplsOrdenados.length % 2 ? cplsOrdenados[meio]
    : (cplsOrdenados[meio - 1] + cplsOrdenados[meio]) / 2;
  const rankings = {
    ctr: base.filter((c) => c.ctr != null).sort((a, b) => b.ctr - a.ctr).slice(0, RANKING_TOP),
    cpl: base.filter((c) => c.leads > 0).sort((a, b) => a.cpl - b.cpl).slice(0, RANKING_TOP),
    leads: base.filter((c) => c.leads > 0).sort((a, b) => b.leads - a.leads).slice(0, RANKING_TOP),
    hook: base.filter((c) => c.hookRate != null).sort((a, b) => b.hookRate - a.hookRate).slice(0, RANKING_TOP),
    piores: mediana != null
      ? elegiveisPiores.filter((c) => c.cpl > mediana).sort((a, b) => b.cpl - a.cpl).slice(0, RANKING_TOP)
      : [],
  };

  // ─── (v2 #121) conjuntos/publicos do periodo ───
  const listaConjuntos = (conjuntos || [])
    .filter((s) => !rhIds.has(s.campaign_id))
    .map((s) => ({ ...s, ...agregar(adsetRows.filter((r) => r.entity_id === s.adset_id && noRange(r.dia, inicio, fim))) }))
    .filter((s) => s.gasto > 0 || s.status === 'ACTIVE')
    .sort((a, b) => b.gasto - a.gasto);

  // ─── (v2 #176) anomalias: z-score do CPL diario (28d ate fim) ───
  const anomalias = [];
  const janela28 = campRows.filter((r) => noRange(r.dia, addDias(fim, -27), fim));
  const cplDia = {};
  for (const r of janela28) {
    const acc = (cplDia[r.dia] = cplDia[r.dia] || { gasto: 0, leads: 0 });
    acc.gasto += num(r.gasto);
    acc.leads += leadsDe(r);
  }
  const pontos = Object.entries(cplDia)
    .filter(([, v]) => v.leads > 0 && v.gasto > 0)
    .map(([dia, v]) => ({ dia, cpl: v.gasto / v.leads }));
  if (pontos.length >= 8) {
    const media = pontos.reduce((s, p) => s + p.cpl, 0) / pontos.length;
    const varianca = pontos.reduce((s, p) => s + (p.cpl - media) ** 2, 0) / pontos.length;
    const desvio = Math.sqrt(varianca);
    if (desvio > 0) {
      for (const p of pontos) {
        const z = (p.cpl - media) / desvio;
        if (Math.abs(z) >= 2) anomalias.push({ dia: p.dia, cpl: p.cpl, z: r1(z) });
      }
      anomalias.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    }
  }

  return {
    kpis, serie, metaMensal, donut,
    campanhas: listaCampanhas, criativos: listaCriativos, conjuntos: listaConjuntos,
    rankings, anomalias: anomalias.slice(0, 5),
    periodo: { inicio, fim, prevInicio, prevFim },
  };
}

/** (v2 #174) Resumo do periodo em linguagem natural (sobre o retorno do computeTrafego). */
export function montarResumoPeriodo(t) {
  if (!t?.kpis) return '';
  const k = t.kpis;
  const fmtBRL = (v) => `R$ ${Math.round(v || 0).toLocaleString('pt-BR')}`;
  const partes = [];
  const varLeads = k.delta.leads != null ? ` (${k.delta.leads >= 0 ? '+' : ''}${Math.round(k.delta.leads)}% vs período anterior)` : '';
  partes.push(`O período trouxe ${k.leads.toLocaleString('pt-BR')} leads${varLeads}, com ${fmtBRL(k.gasto)} investidos${k.cpl != null ? ` e CPL de R$ ${k.cpl.toFixed(2)}` : ''}.`);
  const top = (t.donut || [])[0];
  if (top && t.kpis.shareMaiorCampanha != null) {
    partes.push(`A campanha "${top.nome}" concentrou ${t.kpis.shareMaiorCampanha}% dos leads.`);
  }
  if (t.anomalias?.length) {
    const a = t.anomalias[0];
    partes.push(`Atenção: ${a.dia.slice(8)}/${a.dia.slice(5, 7)} fugiu da curva (CPL R$ ${a.cpl.toFixed(2)}).`);
  }
  const sat = (t.criativos || []).filter((c) => c.saturando).length;
  if (sat > 0) partes.push(`${sat} criativo(s) dando sinal de saturação.`);
  return partes.join(' ');
}

/** (v2 #175) Recomendacoes por regra transparente (nunca mexe sozinho — so sugere). */
export function computeRecomendacoes(t) {
  const recs = [];
  const k = t?.kpis;
  if (!k) return recs;
  for (const c of t.campanhas || []) {
    if (c.rh) continue;
    if (c.atencao === 'cpl') {
      recs.push({ tipo: 'reduzir', campaign_id: c.campaign_id, texto: `Rever "${c.nome}": CPL R$ ${c.cpl.toFixed(2)} está bem acima da média da conta (R$ ${k.cpl?.toFixed(2)}). Considere reduzir orçamento ou trocar criativos.` });
    } else if (c.atencao === 'zerada') {
      recs.push({ tipo: 'verificar', campaign_id: c.campaign_id, texto: `"${c.nome}" está ativa e não gastou no período — verificar entrega/rejeição no Gerenciador.` });
    } else if (!c.rh && c.leads > 0 && k.cpl != null && c.gasto >= 100 && c.cpl < 0.7 * k.cpl) {
      recs.push({ tipo: 'escalar', campaign_id: c.campaign_id, texto: `"${c.nome}" está pagando R$ ${c.cpl.toFixed(2)} por lead (abaixo da média) — candidata a escalar orçamento em +20%.` });
    }
  }
  for (const cr of t.criativos || []) {
    if (cr.saturando) recs.push({ tipo: 'trocar_criativo', ad_id: cr.ad_id, texto: `Criativo "${cr.nome}" saturando (frequência ${cr.frequencia?.toFixed(1)}, CTR caindo) — preparar substituto.` });
  }
  if (t.anomalias?.length) {
    const a = t.anomalias[0];
    recs.push({ tipo: 'investigar', texto: `Investigar o dia ${a.dia.slice(8)}/${a.dia.slice(5, 7)}: CPL R$ ${a.cpl.toFixed(2)} fora da curva (z=${a.z}).` });
  }
  return recs;
}

/** Data efetiva de assinatura (mesma regra do funil): signed_at -> advbox_date -> updated_at. */
function dataAssinatura(c) {
  if (!c || c.status !== 'assinado') return null;
  return c.signed_at || c.advbox_date || c.updated_at || null;
}

/**
 * Ponte comercial mensal "do anuncio ao contrato" (agregado por mes-calendario).
 * v2: custos por etapa, taxas de conversao, ticket/receita, origem Meta e payback
 * pelo RECEBIDO no Asaas (boletos pagos dos CPFs da coorte de assinados do mes).
 */
export function computeComercialMensal({ mensal, videochamadas, contratos, boletosPagos = [], meses = 6, agora = new Date() }) {
  const chaves = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    chaves.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const ativos = (contratos || []).filter((c) => c && c.status !== 'cancelado' && !c.arquivado_em);
  const ehOrigemMeta = (origem) => {
    const o = String(origem || '').toLowerCase();
    return !!o && ORIGENS_META.some((m) => o.includes(m));
  };

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
    const assinadosLista = ativos.filter((c) => {
      const dt = dataAssinatura(c);
      return dt && String(dt).slice(0, 7) === mes;
    });
    const assinados = assinadosLista.length;
    const receita = assinadosLista.reduce((s, c) => s + num(c.honorarios_total), 0);
    const comValor = assinadosLista.filter((c) => num(c.honorarios_total) > 0);
    const ticketMedio = comValor.length ? receita / comValor.length : null;
    const assinadosMeta = assinadosLista.filter((c) => ehOrigemMeta(c.origem)).length;
    // (v2 #91) payback: boletos PAGOS (qualquer data) dos CPFs da coorte do mes
    const cpfs = new Set(assinadosLista.map((c) => String(c.cpf || '').replace(/\D/g, '')).filter(Boolean));
    const recebido = (boletosPagos || []).reduce((s, b) => {
      const cpf = String(b.cpf || '').replace(/\D/g, '');
      return cpfs.has(cpf) ? s + num(b.valor) : s;
    }, 0);
    return {
      mes, leads, gasto, videochamadas: vcs, enviados, assinados,
      custoPorAssinado: assinados > 0 ? gasto / assinados : null,
      custoPorVideochamada: vcs > 0 ? gasto / vcs : null,
      custoPorEnviado: enviados > 0 ? gasto / enviados : null,
      taxaLeadVc: leads > 0 ? r1((vcs / leads) * 100) : null,
      taxaVcEnviado: vcs > 0 ? r1((enviados / vcs) * 100) : null,
      taxaEnviadoAssinado: enviados > 0 ? r1((assinados / enviados) * 100) : null,
      receita,
      ticketMedio,
      assinadosMeta,
      recebido,
      paybackPct: gasto > 0 && recebido > 0 ? Math.round((recebido / gasto) * 100) : null,
    };
  });
}
