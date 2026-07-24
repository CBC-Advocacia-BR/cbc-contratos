// Pontualidade do vendedor na videochamada (Regra B do Paulo).
// Entrada = linhas da RPC `vendedor_pontualidade` (1 por call auditada):
//   { event_id, vendedora_email, vendedor, scheduled_at, cliente_nome, lead_entrou,
//     vendedor_entrou, tem_lead, vendedor_nao_entrou, atraso_seg, houve_atraso }
// Universo da pontualidade = calls onde um LEAD entrou (tem_lead). Sem lead, o vendedor
// nao tem quem "chegar antes", entao a call nao entra no calculo.

function mediana(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function computePontualidade(rows = []) {
  const comLead = (rows || []).filter((r) => r && r.tem_lead);
  const byVend = new Map();
  for (const r of comLead) {
    const k = (r.vendedora_email || r.vendedor || '—').toLowerCase();
    if (!byVend.has(k)) byVend.set(k, { vendedor: r.vendedor || k, vendedora_email: r.vendedora_email || k, total: 0, atrasos: 0, naoEntrou: 0, _seg: [] });
    const v = byVend.get(k);
    v.total += 1;
    if (r.vendedor_nao_entrou) v.naoEntrou += 1;
    else if (r.houve_atraso) { v.atrasos += 1; v._seg.push(r.atraso_seg || 0); }
  }

  const porVendedor = [...byVend.values()].map((v) => {
    const pontual = v.total - v.atrasos - v.naoEntrou;
    const soma = v._seg.reduce((a, b) => a + b, 0);
    return {
      vendedor: v.vendedor,
      vendedora_email: v.vendedora_email,
      total: v.total,
      pontual,
      atrasos: v.atrasos,
      naoEntrou: v.naoEntrou,
      pctPontual: v.total ? Math.round((pontual / v.total) * 100) : null,
      atrasoMedianoSeg: mediana(v._seg),
      atrasoMedioSeg: v._seg.length ? Math.round(soma / v._seg.length) : null,
      piorSeg: v._seg.length ? Math.max(...v._seg) : null,
      esperaTotalSeg: soma,
    };
  }).sort((a, b) => (b.atrasos - a.atrasos) || (b.esperaTotalSeg - a.esperaTotalSeg) || a.vendedor.localeCompare(b.vendedor));

  const casos = comLead
    .filter((r) => r.houve_atraso)
    .map((r) => ({
      event_id: r.event_id, vendedor: r.vendedor, vendedora_email: r.vendedora_email,
      scheduled_at: r.scheduled_at, cliente_nome: r.cliente_nome,
      lead_entrou: r.lead_entrou, vendedor_entrou: r.vendedor_entrou, atraso_seg: r.atraso_seg || 0,
    }))
    .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

  const total = comLead.length;
  const atrasos = porVendedor.reduce((a, v) => a + v.atrasos, 0);
  const naoEntrou = porVendedor.reduce((a, v) => a + v.naoEntrou, 0);
  const geral = {
    total, atrasos, naoEntrou,
    pontual: total - atrasos - naoEntrou,
    pctPontual: total ? Math.round(((total - atrasos - naoEntrou) / total) * 100) : null,
    esperaTotalSeg: porVendedor.reduce((a, v) => a + v.esperaTotalSeg, 0),
  };
  return { porVendedor, casos, geral };
}

// duracao amigavel: 45s / 3,2min
export function fmtDur(seg) {
  if (seg == null) return '—';
  if (seg < 60) return `${Math.round(seg)}s`;
  return `${(seg / 60).toFixed(1).replace('.', ',')} min`;
}
