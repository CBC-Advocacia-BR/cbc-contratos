// (#17) Logica PURA da "Saude do Funil" — testavel (vitest), sem React/SDK.
// Funil: Criados -> Enviados (ZapSign) -> Assinados, com conversoes, tempos por etapa
// (MEDIANA, robusta a outliers), gargalos (enviados ha muito tempo sem assinar) e
// tendencia mensal de conversao. Datas/assinatura seguem a regra efetiva do projeto.

// (fix funil 28/07/2026) deteccao de campanha de RH: fonte unica, a mesma da aba Trafego.
import { isCampanhaRh } from '../../../netlify/functions/_lib/metaAds.mjs';
// (auditoria — item 230) mes LOCAL (BRT) a partir da string ISO do banco. Nunca usar
// slice(0,7) direto: call das 21h do dia 31 cairia no mes seguinte (o banco devolve UTC).
import { ymOf as mesLocalDe } from '../../utils/format.js';

/** contrato "ativo" no funil: nao cancelado e nao arquivado */
const ativoNoFunil = (c) => c.status !== 'cancelado' && !c.arquivado_em;

/** Data efetiva de assinatura: signed_at -> advbox_date -> updated_at (so p/ assinados) */
export function dataAssinatura(c) {
  if (!c || c.status !== 'assinado') return null;
  return c.signed_at || c.advbox_date || c.updated_at || null;
}

function diasEntre(a, b) {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
  return Number.isFinite(d) ? d : null;
}

/** Mediana real (nao media de medias — o Dashboard antigo errava isso) */
export function mediana(arr) {
  const v = (arr || []).filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);

const LIMITE_TRAVADO_DIAS = 7;

export function computeFunnel(contratos, now = new Date(), videochamadas = [], metaAds = []) {
  const ativos = (contratos || []).filter(ativoNoFunil);

  const criados = ativos.length;
  const enviados = ativos.filter((c) => c.zapsign_sent_at || c.status === 'enviado_zapsign' || c.status === 'assinado').length;
  const assinados = ativos.filter((c) => c.status === 'assinado').length;

  // Etapa "Distribuídos" — processo distribuído = tem nº de processo no ADVBOX (flag c.distribuido,
  // da view vw_processo_distribuido). Sinal completo (≥ Guia Paga) — substitui a tarefa "DISTRIBUIR
  // AÇÃO", que era incompleta e fazia o funil alargar. ALL-TIME (todos os assinados ativos).
  const distribuidos = ativos.filter((c) => c.status === 'assinado' && c.distribuido).length;

  // Etapa "Guia Paga/JEC": processo que PASSOU DA CITAÇÃO no ADVBOX (guia paga ou JEC), via flag
  // c.guia_paga (merge da view vw_processo_guia_paga). ALL-TIME (todos os assinados ativos). Pode
  // SUPERAR "Distribuídos" porque usa a etapa REAL do processo, e o Distribuídos conta pela task.
  const guiaPaga = ativos.filter((c) => c.status === 'assinado' && c.guia_paga).length;

  // Etapas de videochamada (TOPO do funil) — ALL-TIME (mesmo escopo histórico do resto da Saúde).
  // Pavão ("fechou") conta como realizada (compareceu E fechou). "excluida" (evento apagado) fica
  // fora da base. Chamadas FUTURAS (ainda não aconteceram) saem do comparecimento e entram só como
  // "a realizar".
  const nowMs = now.getTime();
  const vcValidas = (videochamadas || []).filter((v) => v.scheduled_at && v.status !== 'excluida');
  const vcAconteceram = vcValidas.filter((v) => new Date(v.scheduled_at).getTime() <= nowMs);
  const vcRealizadas = vcAconteceram.filter((v) => v.status === 'realizada' || v.status === 'fechou').length;
  const vcFuturas = vcValidas.length - vcAconteceram.length;
  const vcExcluidas = (videochamadas || []).filter((v) => v.scheduled_at && v.status === 'excluida').length;

  // (leads Meta 14/07/2026) 1a etapa do funil: leads de campanha = conversas iniciadas
  // (click-to-WhatsApp) + lead forms, dos insights mensais por campanha (meta_ads_mensal).
  // ALL-TIME desde o 1o mes com dado. Sem dados (token nao configurado / tabela vazia)
  // -> null e o painel oculta a etapa, sem quebrar o resto do funil.
  // (fix funil 28/07/2026) Campanhas de VAGA/RH sao curriculos p/ o escritorio, nao
  // clientes — MESMA regra da aba Trafego (decisao Paulo 16/07). Sem isso o acumulado
  // somava 712 candidatos como lead de venda e barateava o CPL.
  let leadsMeta = null;
  const metaRows = (metaAds || []).filter((m) => m && m.mes && !isCampanhaRh(m.campaign_name));
  if (metaRows.length) {
    const porMesMeta = {};
    let totalLeads = 0;
    let gastoTotal = 0;
    for (const m of metaRows) {
      const mes = String(m.mes).slice(0, 7);
      const leads = (Number(m.conversas_iniciadas) || 0) + (Number(m.leads_form) || 0);
      const gasto = Number(m.gasto) || 0;
      const acc = (porMesMeta[mes] = porMesMeta[mes] || { mes, leads: 0, gasto: 0 });
      acc.leads += leads;
      acc.gasto += gasto;
      totalLeads += leads;
      gastoTotal += gasto;
    }
    const mesesMeta = Object.values(porMesMeta).sort((a, b) => a.mes.localeCompare(b.mes));

    // (auditoria 01/08/2026 — item 230) A conversao lead -> videochamada precisa comparar
    // JANELAS IGUAIS. Os leads da Meta comecam em jul/2024; as videochamadas so existem a
    // partir do backfill da agenda (mar/2025). Dividir TODAS as calls por TODOS os leads
    // colocava ~1.900 leads (R$ 36 mil de investimento) no denominador sem nenhuma call
    // possivel no numerador: a tela mostrava 24,4% quando o numero comparavel e 29,0%.
    // Regra: o percentual so considera os meses em que as DUAS fontes existem.
    const mesesComCall = new Set(vcAconteceram.map((v) => mesLocalDe(v.scheduled_at)).filter(Boolean));
    const primeiroMesCall = [...mesesComCall].sort()[0] || null;
    const leadsNaJanela = primeiroMesCall
      ? mesesMeta.filter((m) => m.mes >= primeiroMesCall).reduce((s, m) => s + m.leads, 0)
      : 0;
    const callsNaJanela = primeiroMesCall
      ? vcAconteceram.filter((v) => (mesLocalDe(v.scheduled_at) || '') >= primeiroMesCall).length
      : 0;
    const mesesForaDaJanela = primeiroMesCall
      ? mesesMeta.filter((m) => m.mes < primeiroMesCall).length
      : mesesMeta.length;

    leadsMeta = {
      total: totalLeads,
      gasto: gastoTotal,
      cpl: totalLeads > 0 ? gastoTotal / totalLeads : null,
      meses: mesesMeta,
      desde: mesesMeta[0]?.mes || null,
      pctAgendada: leadsNaJanela > 0 ? pct(callsNaJanela, leadsNaJanela) : null,
      // janela em que a comparacao lead -> call e legitima (as duas fontes existem)
      janelaComparavel: primeiroMesCall
        ? { desde: primeiroMesCall, leads: leadsNaJanela, calls: callsNaJanela, mesesIgnorados: mesesForaDaJanela }
        : null,
    };
  }

  // Tempos por etapa (dias) — coletados e reduzidos por mediana
  const tCriacaoEnvio = [];
  const tEnvioAssinatura = [];
  const tJornada = [];
  for (const c of ativos) {
    if (c.zapsign_sent_at) tCriacaoEnvio.push(diasEntre(c.created_at, c.zapsign_sent_at));
    const ass = dataAssinatura(c);
    if (ass && c.zapsign_sent_at) tEnvioAssinatura.push(diasEntre(c.zapsign_sent_at, ass));
    if (ass) tJornada.push(diasEntre(c.created_at, ass));
  }

  // Gargalo: enviado ao ZapSign ha mais de N dias e ainda nao assinou
  const travadosList = ativos
    .filter((c) => c.status === 'enviado_zapsign')
    .map((c) => ({
      id: c.id,
      nome: c.nome_contratante1,
      resort: c.resort,
      dias: diasEntre(c.zapsign_sent_at || c.created_at, now),
    }))
    .filter((x) => x.dias != null && x.dias > LIMITE_TRAVADO_DIAS)
    .sort((a, b) => b.dias - a.dias)
    .map((x) => ({ ...x, dias: Math.round(x.dias) }));

  // Tendencia: ultimos 6 meses por mes de criacao, conversao = assinados/criados
  const porMes = {};
  for (const c of ativos) {
    if (!c.created_at) continue;
    const mes = String(c.created_at).slice(0, 7);
    (porMes[mes] = porMes[mes] || { mes, criados: 0, assinados: 0 }).criados++;
    if (c.status === 'assinado') porMes[mes].assinados++;
  }
  const tendencia = Object.values(porMes)
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .slice(-6)
    .map((m) => ({ ...m, conversao: pct(m.assinados, m.criados) }));

  return {
    funil: { criados, enviados, assinados },
    leadsMeta,
    videochamadas: { agendadas: vcAconteceram.length, realizadas: vcRealizadas, excluidas: vcExcluidas, futuras: vcFuturas, pct: vcAconteceram.length > 0 ? Math.round((vcRealizadas / vcAconteceram.length) * 100) : null },
    distribuidos: { total: distribuidos },
    guiaPaga,
    conversao: {
      criadoEnviado: pct(enviados, criados),
      enviadoAssinado: pct(assinados, enviados),
      criadoAssinado: pct(assinados, criados),
    },
    tempos: {
      criacaoEnvioDias: mediana(tCriacaoEnvio),
      envioAssinaturaDias: mediana(tEnvioAssinatura),
      jornadaTotalDias: mediana(tJornada),
    },
    gargalo: {
      limiteDias: LIMITE_TRAVADO_DIAS,
      travados: travadosList.length,
      lista: travadosList.slice(0, 12),
    },
    tendencia,
  };
}

/**
 * (auditoria 01/08/2026 — item 239) Resumo do SLA de 1a resposta ao lead.
 *
 * A `vw_funil_sla` ja vem agregada POR DIA. Aqui as diarias viram um retrato do
 * periodo. Detalhe que muda o numero: a mediana do periodo NAO e a media das
 * medianas diarias (dia com 2 leads pesaria igual a dia com 40) — sem as linhas
 * cruas, o mais honesto e a media PONDERADA pelos leads atendidos, e o rotulo diz
 * "tempo medio", nao "mediana".
 *
 * O que importa de verdade nao e o tempo: e `nuncaRespondidos`. Em 02/08 eram 75 de
 * 217 leads (34,6%) que simplesmente nunca receberam resposta — perda que ate hoje
 * so aparecia diluida como "conversao baixa".
 */
export function computeSla(linhas) {
  const dias = (linhas || []).filter((d) => d && d.dia && Number(d.leads_com_conversa) > 0);
  if (!dias.length) return null;

  const leads = dias.reduce((s, d) => s + (Number(d.leads_com_conversa) || 0), 0);
  const atendidos = dias.reduce((s, d) => s + (Number(d.atendidos) || 0), 0);
  const engajaram = dias.reduce((s, d) => s + (Number(d.engajaram) || 0), 0);

  const ponderada = (campo) => {
    let peso = 0;
    let soma = 0;
    for (const d of dias) {
      const v = Number(d[campo]);
      const n = Number(d.atendidos) || 0;
      if (Number.isFinite(v) && n > 0) { soma += v * n; peso += n; }
    }
    return peso > 0 ? soma / peso : null;
  };

  return {
    dias: dias.length,
    desde: dias.map((d) => String(d.dia)).sort()[0],
    leads,
    atendidos,
    nuncaRespondidos: Math.max(0, leads - atendidos),
    pctAtendidos: pct(atendidos, leads),
    pctNuncaRespondidos: pct(Math.max(0, leads - atendidos), leads),
    minutosAteResponder: ponderada('sla_mediano_min'),
    minutosAteHumano: ponderada('sla_humano_mediano_min'),
    engajaram,
    pctEngajou: pct(engajaram, atendidos),
  };
}
