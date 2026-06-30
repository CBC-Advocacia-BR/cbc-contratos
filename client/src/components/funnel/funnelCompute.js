// (#17) Logica PURA da "Saude do Funil" — testavel (vitest), sem React/SDK.
// Funil: Criados -> Enviados (ZapSign) -> Assinados, com conversoes, tempos por etapa
// (MEDIANA, robusta a outliers), gargalos (enviados ha muito tempo sem assinar) e
// tendencia mensal de conversao. Datas/assinatura seguem a regra efetiva do projeto.

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

export function computeFunnel(contratos, now = new Date(), videochamadas = []) {
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
