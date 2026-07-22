// Logica PURA da ficha "Linha do Caso" (aba Clientes, 21/07/2026).
// Monta a espinha cronologica + satelites a partir de: row (lista), info (vw_cliente_360_full),
// acoes (cliente_acoes_drive_list), lc (RPC cliente_linha_caso) e mapas auxiliares.
// Sem React e sem I/O — testado em __tests__/linhaCaso.test.js.

const MS_DIA = 24 * 60 * 60 * 1000;

export const reaisLC = (v) => (v == null ? null
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

export function dataBRLC(iso) {
  if (!iso) return null;
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return null;
  return `${d}/${m}/${y}`;
}

function diasEntre(aIso, bIso) {
  const a = new Date(String(aIso).slice(0, 10) + 'T12:00:00');
  const b = new Date(String(bIso).slice(0, 10) + 'T12:00:00');
  return Math.round((b - a) / MS_DIA);
}

export function idadeDe(nascimento, hoje) {
  if (!nascimento) return null;
  const n = new Date(String(nascimento).slice(0, 10) + 'T12:00:00');
  const h = new Date(String(hoje).slice(0, 10) + 'T12:00:00');
  let a = h.getFullYear() - n.getFullYear();
  const m = h.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && h.getDate() < n.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

// Aniversario: dias ate o proximo (0 = hoje). So vira chip quando <= 30.
export function aniversarioInfo(nascimento, hoje) {
  if (!nascimento) return null;
  const n = new Date(String(nascimento).slice(0, 10) + 'T12:00:00');
  const h = new Date(String(hoje).slice(0, 10) + 'T12:00:00');
  let prox = new Date(h.getFullYear(), n.getMonth(), n.getDate(), 12);
  if (prox < h) prox = new Date(h.getFullYear() + 1, n.getMonth(), n.getDate(), 12);
  const dias = Math.round((prox - h) / MS_DIA);
  return { dias, fara: prox.getFullYear() - n.getFullYear(), data: `${String(n.getDate()).padStart(2, '0')}/${String(n.getMonth() + 1).padStart(2, '0')}` };
}

// Prescricao decenal: corre da compra; PARA no ajuizamento (regra Paulo 16/07).
export function prescricaoDe(compraIso, ajuizadoIso, hojeIso) {
  if (!compraIso) return null;
  const fim = ajuizadoIso || hojeIso;
  if (!fim) return null;
  const dias = diasEntre(compraIso, fim);
  if (dias < 0) return null;
  const anos = dias / 365.25;
  const pct = Math.min(100, Math.round((anos / 10) * 100));
  return {
    pct,
    anosTxt: `${anos.toFixed(1).replace('.', ',')} de 10 anos`,
    interrompida: !!ajuizadoIso,
    alerta: !ajuizadoIso && pct >= 80,
  };
}

// telefone: compara os 8 digitos finais (DDD pode variar de formato)
export function telefoneDiverge(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (da.length < 8 || db.length < 8) return false;
  return da.slice(-8) !== db.slice(-8);
}

const ordemTipo = { marco: 0, etapa: 1, tribunal: 2, equipe: 3, financeiro: 4, relacionamento: 5 };

// Monta os eventos datados da espinha (passado). "hoje" e "futuro" saem separados.
export function buildEventos({ acoes = [], lc = {}, hoje }) {
  const ev = [];
  const push = (data, tipo, titulo, sub, extra) => {
    const d = data ? String(data).slice(0, 10) : null;
    if (!d || d > hoje) return;
    ev.push({ data: d, tipo, titulo, sub: sub || null, ...(extra || {}) });
  };

  const procs = Array.isArray(lc.processos) ? lc.processos : [];
  const ajuizado = procs.map((p) => p.distribuido).filter(Boolean).sort()[0] || null;

  // compras das cotas (+ prescricao por cota — vai junto no evento)
  for (const a of acoes) {
    if (a.fora_censo) continue;
    push(a.data_contrato_compra, 'marco', `Compra da cota — ${a.resort || 'resort a identificar'}`,
      [a.unidade_cota, a.valor_pago != null ? `valor pago ${reaisLC(a.valor_pago)}` : null].filter(Boolean).join(' · '),
      { prescricao: prescricaoDe(a.data_contrato_compra, ajuizado, hoje), resort: a.resort });
  }

  // contrato CBC: app (rico) ou pre-sistema (data_contrato da mina)
  const app = lc.contrato_app || null;
  if (app) {
    if (app.primeira_msg) push(app.primeira_msg, 'relacionamento', `Primeiro contato${app.origem ? ` — via ${app.origem}` : ''}`, 'inicio da conversa com o escritorio');
    if (lc.kommo?.criado) push(lc.kommo.criado, 'relacionamento', 'Lead criado no Kommo', lc.kommo.lead_id ? `lead ${lc.kommo.lead_id}` : null);
    if (app.criado) push(app.criado, 'marco', 'Contrato CBC criado', app.vendido_por ? `por ${app.vendido_por}` : null);
    if (app.assinado) push(app.assinado, 'marco', 'Contrato assinado (ZapSign)',
      app.aberturas ? `cliente abriu ${app.aberturas}x antes de assinar` : null);
  } else {
    const dContrato = acoes.map((a) => a.data_contrato).filter(Boolean).sort()[0];
    if (dContrato) push(dContrato, 'marco', 'Contrato CBC assinado', 'contrato pre-sistema · fonte: Drive');
    if (lc.kommo?.criado) push(lc.kommo.criado, 'relacionamento', 'Lead criado no Kommo', lc.kommo.lead_id ? `lead ${lc.kommo.lead_id}` : null);
  }

  // processo: distribuicao + marcos ADVBOX
  for (const p of procs) {
    push(p.distribuido, 'marco', 'Acao distribuida', `processo ${p.numero || ''}`.trim(),
      { interrompePrescricao: true });
    push(p.criado_advbox, 'equipe', 'Caso criado no ADVBOX', p.responsavel ? `responsavel: ${p.responsavel}` : null);
    push(p.entrou_execucao, 'etapa', 'Entrou em Execucao/Cobranca', null);
    push(p.saiu_execucao, 'etapa', 'Saiu da Execucao', 'sentenca em cumprimento');
  }

  // mudancas de etapa datadas (monitor, desde 10/06)
  for (const m of (Array.isArray(lc.mudancas) ? lc.mudancas : [])) {
    if (m.campo === 'etapa') push(m.quando, 'etapa', `Etapa: ${m.para}`, m.de ? `antes: ${m.de}` : null);
    else if (m.campo === 'quadro') push(m.quando, 'etapa', `Quadro: ${m.de || '—'} → ${m.para}`, null);
  }

  // andamentos do tribunal (ja vem limitado a 8)
  for (const a of (Array.isArray(lc.andamentos) ? lc.andamentos : [])) {
    push(a.data, 'tribunal', a.texto || 'Andamento', a.tribunal || null);
  }

  // tarefas da equipe concluidas (visiveis)
  for (const t of (Array.isArray(lc.tarefas) ? lc.tarefas : [])) {
    push(t.concluida, 'equipe', t.nome || 'Tarefa concluida', t.quem ? `por ${t.quem}` : null);
  }

  // recuperacao (MLE)
  for (const m of (Array.isArray(lc.mles) ? lc.mles : [])) {
    push(m.protocolo, 'financeiro', 'MLE protocolado', 'mandado de levantamento eletronico');
    if (m.recebido_em) push(m.recebido_em, 'financeiro', `${reaisLC(m.valor_recebido)} recebidos`,
      m.banco ? `via MLE · conta ${m.banco}` : 'via MLE', { destaque: true });
    if (m.repassado_em) push(m.repassado_em, 'financeiro', `Repasse feito — ${reaisLC(m.valor_repassado)}`, null, { destaque: true });
  }

  // dedupe grosseiro (mesma data+titulo) e ordenacao
  const seen = new Set();
  const out = ev.filter((e) => {
    const k = `${e.data}|${e.titulo}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (ordemTipo[a.tipo] ?? 9) - (ordemTipo[b.tipo] ?? 9)));
  return out;
}

// No HOJE + proximos passos + pendencias/chips — o "estado" da ficha.
export function buildLinhaCaso({ row, info, acoes = [], lc = {}, hoje }) {
  const eventos = buildEventos({ acoes, lc, hoje });
  const procs = Array.isArray(lc.processos) ? lc.processos : [];
  const proc = procs[0] || null;
  const etapa = lc.etapa_atual || (proc ? { etapa: proc.etapa, quadro: proc.quadro, dias: null } : null);

  // recuperacao pendente = MLE recebido sem repasse
  const mlePend = (Array.isArray(lc.mles) ? lc.mles : []).find((m) => m.recebido_em && !m.repassado_em) || null;

  const acoesCenso = acoes.filter((a) => !a.fora_censo);
  const totalInvestido = acoesCenso.reduce((s, a) => s + (Number(a.valor_pago) || 0), 0) || null;
  const percExito = acoesCenso.map((a) => Number(a.honorarios_perc)).find((v) => v > 0) ?? null;

  const chips = [];
  if (info?.tem_portal && lc.portal && !(lc.portal.acessos > 0)) {
    chips.push({ tipo: 'warn', txt: 'Portal: nunca acessou', acao: 'reenviar' });
  }
  if (lc.kommo?.tel_diverge) chips.push({ tipo: 'warn', txt: 'Telefone divergente no Kommo' });
  if (!row?.kommo && !lc.kommo) chips.push({ tipo: 'mut', txt: 'Kommo sem vinculo' });
  if (!lc.contrato_app && acoesCenso.length > 0) chips.push({ tipo: 'mut', txt: 'Contrato pre-sistema (Drive)' });
  const aniv = aniversarioInfo(row?.nascimento || info?.nascimento, hoje);
  if (aniv && aniv.dias <= 30) chips.push({ tipo: 'info', txt: `Aniversario em ${aniv.dias === 0 ? 'HOJE' : aniv.dias + ' dias'} (faz ${aniv.fara})` });
  for (const a of acoesCenso) {
    const pr = prescricaoDe(a.data_contrato_compra, procs.map((p) => p.distribuido).filter(Boolean).sort()[0] || null, hoje);
    if (pr?.alerta) chips.push({ tipo: 'danger', txt: `Prescricao ${pr.pct}% — ${a.resort || 'cota'} sem acao ajuizada` });
  }

  const futuros = [];
  if (info?.proximo_venc) futuros.push({ data: info.proximo_venc, titulo: 'Proximo vencimento de parcela' });
  if (mlePend) futuros.push({ data: null, titulo: `Repassar ${reaisLC(mlePend.valor_cliente)} a cliente`, urgente: true });

  return {
    eventos,
    hojeNode: {
      quadro: etapa?.quadro || null,
      etapa: etapa?.etapa || null,
      diasNaEtapa: etapa?.dias ?? null,
      processo: proc?.numero || null,
      responsavel: proc?.responsavel || null,
      tarefasAbertas: lc.tarefas_abertas ?? null,
      emExecucao: /EXEC/i.test(etapa?.quadro || ''),
      repassePendente: mlePend ? {
        valorCliente: mlePend.valor_cliente, valorEscritorio: mlePend.valor_escritorio,
        recebidoEm: mlePend.recebido_em, diasAguardando: mlePend.recebido_em ? diasEntre(mlePend.recebido_em, hoje) : null,
      } : null,
    },
    futuros,
    chips,
    investimento: { total: totalInvestido, percExito, cotas: acoesCenso.length },
    andamentosTotal: lc.andamentos_total ?? 0,
  };
}
