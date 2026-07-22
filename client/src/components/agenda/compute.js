// Métricas do funil da Ana — PURO (testado). Regras de taxa fixadas no teste.
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function computeFunilAna(m = {}) {
  const etapas = [
    { chave: 'iniciadas', rotulo: 'Conversas', n: m.conversas_iniciadas || 0 },
    { chave: 'qualificadas', rotulo: 'Qualificadas', n: m.qualificadas || 0 },
    { chave: 'oferta', rotulo: 'Oferta feita', n: m.oferta_feita || 0 },
    { chave: 'agendadas', rotulo: 'Agendadas', n: m.agendadas || 0 },
    { chave: 'realizadas', rotulo: 'Realizadas', n: m.realizadas || 0 },
  ].map((e, i, arr) => ({ ...e, pctDoAnterior: i ? pct(e.n, arr[i - 1].n) : 100 }));
  return {
    etapas,
    taxas: {
      agendamento: pct(m.agendadas || 0, m.conversas_iniciadas || 0),
      comparecimento: pct(m.realizadas || 0, (m.realizadas || 0) + (m.no_show || 0)),
      fechamento: pct(m.fechou || 0, m.realizadas || 0),
    },
    handoffs: m.handoffs || 0,
    porVendedora: m.por_vendedora || {},
    tempoRespostaSeg: Math.round(m.tempo_resposta_med_seg || 0),
  };
}

const ymdSP = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export function agruparAgenda(linhas = [], agoraISO) {
  const hoje = ymdSP(agoraISO);
  const amanha = ymdSP(new Date(new Date(agoraISO).getTime() + 864e5));
  const g = { hoje: [], amanha: [], semana: [], passadas: [] };
  for (const l of [...linhas].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))) {
    const d = ymdSP(l.scheduled_at);
    if (new Date(l.scheduled_at) < new Date(agoraISO) && d !== hoje) g.passadas.push(l);
    else if (d === hoje) g.hoje.push(l);
    else if (d === amanha) g.amanha.push(l);
    else g.semana.push(l);
  }
  g.passadas.reverse();
  return g;
}
