// ─────────────────────────────────────────────────────────────────────────
// Dashboard compute — lógica pura de dados (redesign 12/06/2026)
//
// Fonte única de verdade: linhas slim da tabela `contratos` + realtime.
// Regras de precisão (corrigem bugs da versão anterior):
//  - Contratos ARQUIVADOS ficam fora de todas as métricas por padrão
//    (toggle "incluir arquivados" nos filtros). Antes, a tela misturava
//    números com arquivados (cálculo local) e sem (materialized view).
//  - Data de assinatura efetiva: signed_at → advbox_date → updated_at.
//    31 contratos antigos não têm signed_at; advbox_date é gravado minutos
//    após a assinatura. updated_at puro era usado antes e infla os prazos
//    (automações DataJud/Kommo atualizam as linhas continuamente).
//  - Funil é CUMULATIVO (criados ⊇ enviados ⊇ assinados), não contagem de
//    status atual — antes a "conversão" passava de 100%.
//  - Opções de filtro derivam sempre do conjunto completo, não do filtrado.
//  - Métricas "do mês" são sempre do mês corrente (ignoram filtro de
//    período) e devem ser rotuladas com o nome do mês na UI.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 86400000;
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ─── Helpers de data ───
export function getSignedDate(c) {
  if (!c || c.status !== 'assinado') return null;
  const iso = c.signed_at || c.advbox_date || c.updated_at;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function monthKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabelOf(key) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return key;
  return `${MESES_CURTOS[m - 1]}/${String(y).slice(2)}`;
}

export function monthLabelLong(d) {
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const sum = (arr, fn) => arr.reduce((s, x) => s + (fn ? fn(x) : x), 0);
const pctDelta = (atual, anterior) => (anterior > 0 ? Math.round(((atual - anterior) / anterior) * 100) : null);

// ─── Normalização de linha (fetch slim ou evento realtime com `dados` completo) ───
export function normalizeContrato(row) {
  if (!row) return null;
  const { dpm, oc, dados, ...rest } = row;
  const d = dados && typeof dados === 'object' ? dados : {};
  return {
    ...rest,
    // (R8) preserva contratantes p/ o GeoHeatmap — fetch traz `contratantes_j` (alias);
    // eventos realtime trazem `dados.contratantes`. Cobre os dois.
    contratantes_j: rest.contratantes_j ?? d.contratantes ?? null,
    dados: {
      dataPrimeiraMensagem: d.dataPrimeiraMensagem ?? dpm ?? '',
      origemCliente: d.origemCliente ?? oc ?? '',
    },
  };
}

// ─── Período → intervalo de datas (sobre created_at, no fuso local) ───
export const PERIODOS = [
  { key: 'tudo', label: 'Tudo' },
  { key: 'mes', label: 'Este mês' },
  { key: 'mes_passado', label: 'Mês passado' },
  { key: '90d', label: '90 dias' },
  { key: 'ano', label: 'Este ano' },
  { key: 'custom', label: 'Personalizado' },
];

export function resolvePeriodo(periodo, dataInicio, dataFim, now = new Date()) {
  switch (periodo) {
    case 'mes':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null, label: 'Este mês' };
    case 'mes_passado': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end, label: 'Mês passado' };
    }
    case '90d':
      return { start: new Date(now.getTime() - 90 * DAY_MS), end: null, label: 'Últimos 90 dias' };
    case 'ano':
      return { start: new Date(now.getFullYear(), 0, 1), end: null, label: `Ano de ${now.getFullYear()}` };
    case 'custom': {
      const start = dataInicio ? new Date(`${dataInicio}T00:00:00`) : null;
      const end = dataFim ? new Date(`${dataFim}T23:59:59.999`) : null;
      return { start, end, label: 'Período personalizado' };
    }
    default:
      return { start: null, end: null, label: 'Todo o período' };
  }
}

// ─── Classificação de honorários ───
// ambos: valor inicial + % êxito | exito: só % | iniciais: só valor | nenhum: 0/0 (cadastro a revisar)
function tipoHonorario(c) {
  const total = Number(c.honorarios_total) || 0;
  const exito = Number(c.honorarios_percentual_exito) || 0;
  if (total > 0 && exito > 0) return 'ambos';
  if (total === 0 && exito > 0) return 'exito';
  if (total > 0 && exito === 0) return 'iniciais';
  return 'nenhum';
}

function contaHonorarios(lista) {
  const out = { ambos: 0, exito: 0, iniciais: 0, nenhum: 0 };
  lista.forEach((c) => { out[tipoHonorario(c)]++; });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Cálculo principal
// filters: { periodo, dataInicio, dataFim, resort, tipoAcao, incluirArquivados }
// goal: meta mensal (celebrations.getMonthlyGoal)
// ─────────────────────────────────────────────────────────────────────────
export function computeDashboard(all, filters = {}, goal = 15, now = new Date()) {
  const lista = Array.isArray(all) ? all : [];
  const ativos = lista.filter((c) => !c.arquivado_em);
  const universe = filters.incluirArquivados ? lista : ativos;

  // Escopo sem período (para opções de filtro e métricas mensais)
  const scopeSemPeriodo = universe.filter((c) =>
    (!filters.resort || c.resort === filters.resort) &&
    (!filters.tipoAcao || c.tipo_acao === filters.tipoAcao)
  );

  const range = resolvePeriodo(filters.periodo, filters.dataInicio, filters.dataFim, now);
  const filtered = scopeSemPeriodo.filter((c) => {
    if (!range.start && !range.end) return true;
    const d = new Date(c.created_at);
    if (range.start && d < range.start) return false;
    if (range.end && d > range.end) return false;
    return true;
  });

  // ─── Opções de filtro (sempre do conjunto completo, nunca do filtrado) ───
  const filtros = {
    resorts: [...new Set(universe.map((c) => c.resort).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    tipos: [...new Set(universe.map((c) => c.tipo_acao).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };

  // ─── Status / funil cumulativo ───
  const porStatus = { rascunho: 0, enviado_zapsign: 0, assinado: 0, cancelado: 0 };
  filtered.forEach((c) => { porStatus[c.status] = (porStatus[c.status] || 0) + 1; });
  const total = filtered.length;
  const assinadosList = filtered.filter((c) => c.status === 'assinado');
  // Enviados "alguma vez": quem está enviado agora + quem já assinou
  // (assinatura pressupõe envio; cancelados sem token não são mensuráveis)
  const enviadosEver = porStatus.enviado_zapsign + porStatus.assinado;
  const funil = {
    criados: total,
    enviados: enviadosEver,
    assinados: porStatus.assinado,
    pctEnvio: total > 0 ? Math.round((enviadosEver / total) * 100) : null,
    pctAssinatura: enviadosEver > 0 ? Math.round((porStatus.assinado / enviadosEver) * 100) : null,
    pctGeral: total > 0 ? Math.round((porStatus.assinado / total) * 100) : null,
  };

  // ─── Etapa "Distribuídos" — processo distribuído = tem nº de processo no ADVBOX ───
  // Sinal COMPLETO (flag c.distribuido, da view vw_processo_distribuido) — substitui a tarefa
  // "DISTRIBUIR AÇÃO" (marcada incompleta: 64 de 123) que fazia o funil ALARGAR (Guia Paga > Dist.).
  // Estado ATUAL no escopo dos contratos (cohort do período), igual ao Guia Paga. Guia Paga ⊆ Dist.
  funil.distribuidos = filtered.filter((c) => c.status === 'assinado' && c.distribuido).length;

  // distRange SEGUE o período selecionado ("Tudo" = tudo; não cai mais no mês corrente). Usado pelas
  // etapas de videochamada — contadas por DATA DO EVENTO (não cohort de contrato).
  const distRange = range;
  const noIntervalo = (d, r) => {
    if (!d) return false;
    const t = new Date(String(d).slice(0, 10) + 'T12:00:00').getTime();
    if (r.start && t < r.start.getTime()) return false;
    if (r.end && t > r.end.getTime()) return false;
    return true;
  };

  // ─── Etapa "Guia Paga/JEC" (passou da citação no ADVBOX — guia paga ou JEC) ───
  // Subconjunto dos ASSINADOS do período (cohort criado-no-período) que já passaram da citação.
  // Estado ATUAL do processo (flag c.guia_paga, merge da view vw_processo_guia_paga; sem data própria).
  funil.guiaPaga = filtered.filter((c) => c.status === 'assinado' && c.guia_paga).length;

  // ─── Etapas de videochamada (TOPO do funil) — Agendada / Realizada ───
  // Vêm das agendas do Google (status pela cor), tabela agenda_videochamadas via
  // vw_funil_videochamadas. Contadas por DATA DO EVENTO (scheduled_at) na mesma janela
  // (distRange). Agendada = todos os atendimentos; Realizada = cor Manjericão. NÃO são
  // filtradas por resort/tipo (a call não tem resort ainda). pctComparecimento = realizada/agendada.
  if (Array.isArray(filters.videochamadas)) {
    // Pavão ("fechou") conta como realizada; "excluida" (apagada) sai da base; chamadas FUTURAS
    // (ainda não aconteceram) saem do comparecimento e entram só como "a realizar" — senão o % fica
    // diluído por calls que nem ocorreram.
    const nowMs = now.getTime();
    const vcTodas = filters.videochamadas.filter((v) => v.scheduled_at && noIntervalo(v.scheduled_at, distRange));
    const vcValidas = vcTodas.filter((v) => v.status !== 'excluida');
    const vcAconteceram = vcValidas.filter((v) => new Date(v.scheduled_at).getTime() <= nowMs);
    funil.agendadas = vcAconteceram.length;
    funil.realizadas = vcAconteceram.filter((v) => v.status === 'realizada' || v.status === 'fechou').length;
    funil.futuras = vcValidas.length - vcAconteceram.length;
    funil.excluidas = vcTodas.length - vcValidas.length;
    funil.pctComparecimento = funil.agendadas > 0 ? Math.round((funil.realizadas / funil.agendadas) * 100) : null;
  }

  // ─── Janela de indicadores (12/06/2026 — pedido do Paulo) ───
  // SEM filtro de período: indicadores "do mês" usam o mês corrente (como antes).
  // COM filtro de período: os indicadores de assinatura/receita/cancelamento
  // passam a refletir AS DATAS SELECIONADAS (janela = range do filtro, pela
  // data EFETIVA de assinatura), com delta vs o período anterior equivalente.
  const mesAtualKey = monthKeyOf(now);
  const mesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mesAnteriorKey = monthKeyOf(mesAnterior);
  const hasPeriodo = !!(range.start || range.end);

  const assinadosComData = scopeSemPeriodo
    .filter((c) => c.status === 'assinado')
    .map((c) => ({ c, dt: getSignedDate(c) }))
    .filter((x) => x.dt);

  // ─── Janela de meses contínua (Comparador + card de Honorários) ───
  // Do 1º contrato (criação do sistema) até o mês atual, SEM buracos (meses vazios
  // entram como zero p/ a série/gráfico não ter saltos), com teto nos últimos 12 meses.
  const mesesContinuos = (() => {
    const keys = scopeSemPeriodo.map((c) => monthKeyOf(new Date(c.created_at))).filter(Boolean).sort();
    const primeira = keys[0] || mesAtualKey;
    const [py, pm] = primeira.split('-').map(Number);
    let cursor = new Date(py, pm - 1, 1);
    const piso = new Date(now.getFullYear(), now.getMonth() - 11, 1); // últimos 12 meses
    if (cursor < piso) cursor = piso;
    const fim = new Date(now.getFullYear(), now.getMonth(), 1);
    const out = [];
    while (cursor <= fim) {
      const k = monthKeyOf(cursor);
      out.push({ key: k, label: monthLabelOf(k) });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  })();

  // Janela atual + janela anterior equivalente (para o delta)
  let janela;
  let janelaAnterior;
  if (hasPeriodo && range.start) {
    const fim = range.end || now;
    janela = { start: range.start, end: fim, label: range.label };
    if (filters.periodo === 'mes' || filters.periodo === 'mes_passado') {
      const pStart = new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1);
      // (#22) se a janela atual e um mes PARCIAL (mes corrente ate hoje), recorta o mes
      // anterior ao MESMO trecho decorrido — senao o delta compara parcial vs mes cheio e
      // subestima o periodo atual. Mes ja completo ("mes passado") compara cheio vs cheio.
      const fimMesAtual = new Date(range.start.getFullYear(), range.start.getMonth() + 1, 0, 23, 59, 59, 999);
      const diasMesAnterior = new Date(range.start.getFullYear(), range.start.getMonth(), 0).getDate();
      const pEnd = fim < fimMesAtual
        ? new Date(range.start.getFullYear(), range.start.getMonth() - 1, Math.min(fim.getDate(), diasMesAnterior), 23, 59, 59, 999)
        : new Date(range.start.getFullYear(), range.start.getMonth(), 0, 23, 59, 59, 999);
      janelaAnterior = { start: pStart, end: pEnd };
    } else if (filters.periodo === 'ano') {
      // Ano anterior, mesmo trecho decorrido (jan→hoje vs jan→mesmo dia do ano passado)
      const pStart = new Date(range.start.getFullYear() - 1, 0, 1);
      // (#L11) clampa o dia ao ultimo dia valido do mes no ano anterior — senao 29/02 de um
      // ano bissexto estoura para 01/03 no ano anterior (nao bissexto).
      const diaClamp = Math.min(now.getDate(), new Date(range.start.getFullYear() - 1, now.getMonth() + 1, 0).getDate());
      const pEnd = new Date(range.start.getFullYear() - 1, now.getMonth(), diaClamp, 23, 59, 59, 999);
      janelaAnterior = { start: pStart, end: pEnd };
    } else {
      const dur = fim.getTime() - range.start.getTime();
      janelaAnterior = { start: new Date(range.start.getTime() - dur - 1), end: new Date(range.start.getTime() - 1) };
    }
  } else if (hasPeriodo && range.end) {
    // (fix review 12/06) Só "data fim" preenchida: janela = tudo até a data
    // fim. Antes caía no mês corrente, mas os rótulos diziam "no período" —
    // números e rótulo discordavam. Sem período anterior comparável (delta nulo).
    janela = { start: new Date(0), end: range.end, label: range.label };
    janelaAnterior = { start: new Date(0), end: new Date(0) };
  } else {
    // Sem período: mês corrente vs mês anterior
    janela = { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now, label: monthLabelLong(now) };
    // (#22) mes corrente ate hoje vs MESMO trecho do mes anterior (parcial vs parcial).
    const diasMesAnt = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    janelaAnterior = {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), diasMesAnt), 23, 59, 59, 999),
    };
  }
  const inJanela = (dt, j) => dt >= j.start && dt <= j.end;

  const assinadosJanelaList = assinadosComData.filter((x) => inJanela(x.dt, janela)).map((x) => x.c);
  const assinadosJanelaAntList = assinadosComData.filter((x) => inJanela(x.dt, janelaAnterior)).map((x) => x.c);
  const receitaJanela = sum(assinadosJanelaList, (c) => Number(c.honorarios_total) || 0);
  const receitaJanelaAnt = sum(assinadosJanelaAntList, (c) => Number(c.honorarios_total) || 0);
  const canceladosJanela = scopeSemPeriodo.filter((c) => {
    if (c.status !== 'cancelado') return false;
    // (#L10) APROXIMACAO: nao existe coluna de "data de cancelamento"; usamos updated_at
    // como proxy. updated_at e tocado por automacoes (advbox/drive/asaas), entao a data do
    // cancelamento pode ser posterior ao cancelamento real. Trocar por coluna dedicada se criada.
    const d = new Date(c.updated_at || c.created_at);
    return inJanela(d, janela);
  }).length;

  // Assinaturas do MÊS CORRENTE de verdade (independente de filtro) —
  // alimenta a celebração de meta e o KPI de meta quando a janela não é um mês.
  // (varredura 15/06) usa `ativos` (escritório inteiro), não `assinadosComData`
  // (que vem de scopeSemPeriodo e honra resort/tipo/arquivados): a meta mensal é
  // global e estava subcontando quando havia um filtro de resort ativo.
  const assinadosMesCorrente = ativos
    .filter((c) => c.status === 'assinado')
    .map((c) => getSignedDate(c))
    .filter((dt) => dt && monthKeyOf(dt) === mesAtualKey).length;

  // A janela é exatamente um mês calendário? (meta mensal faz sentido)
  const janelaEhMesCalendario =
    janela.start.getDate() === 1 &&
    monthKeyOf(janela.start) === monthKeyOf(janela.end);
  const metaJanelaCount = janelaEhMesCalendario ? assinadosJanelaList.length : assinadosMesCorrente;
  const metaJanelaLabel = janelaEhMesCalendario ? monthLabelLong(janela.start) : monthLabelLong(now);

  // Top resorts da janela — por data de ASSINATURA efetiva
  const topMap = {};
  assinadosJanelaList.forEach((c) => { if (c.resort) topMap[c.resort] = (topMap[c.resort] || 0) + 1; });
  const topResortsMes = Object.entries(topMap)
    .map(([resort, count]) => ({ resort, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ─── Comparador de meses (12/06/2026) — agregados mensais completos ───
  // Sempre sobre o escopo SEM período (o usuário escolhe os meses livremente),
  // respeitando resort/tipo/arquivados.
  const cmpMap = {};
  const cmpTouch = (key) => {
    if (!cmpMap[key]) cmpMap[key] = { key, criados: 0, assinados: 0, receita: 0, criadosAssinados: 0 };
    return cmpMap[key];
  };
  scopeSemPeriodo.forEach((c) => {
    const m = cmpTouch(monthKeyOf(new Date(c.created_at)));
    m.criados++;
    if (c.status === 'assinado') m.criadosAssinados++;
  });
  assinadosComData.forEach(({ c, dt }) => {
    const m = cmpTouch(monthKeyOf(dt));
    m.assinados++;
    m.receita += Number(c.honorarios_total) || 0;
  });
  // Garante que TODO mês da janela contínua exista (mesmo vazio) p/ aparecer nos dropdowns.
  mesesContinuos.forEach((m) => cmpTouch(m.key));
  const comparador = {
    meses: [...mesesContinuos].reverse(), // recentes primeiro (últimos 12 meses)
    dados: Object.fromEntries(Object.entries(cmpMap).map(([k, m]) => [k, {
      ...m,
      ticket: m.assinados > 0 ? m.receita / m.assinados : null,
      conversaoCohort: m.criados > 0 ? Math.round((m.criadosAssinados / m.criados) * 100) : null,
    }])),
  };

  // ─── Pendências operacionais (sempre carteira ATIVA, ignoram todos os filtros) ───
  const aguardando = ativos.filter((c) => c.status === 'enviado_zapsign');
  const aguardandoAntigos = aguardando.filter((c) => (now - new Date(c.created_at)) / DAY_MS >= 3);
  const rascunhosAntigos = ativos.filter((c) =>
    c.status === 'rascunho' && (now - new Date(c.created_at)) / DAY_MS >= 7
  );
  const assinadosAtivos = ativos.filter((c) => c.status === 'assinado');
  // CORREÇÃO: advbox_status/drive_file_id agora vêm no select (antes eram
  // undefined e TODOS os assinados contavam como pendentes)
  const pendAdvbox = assinadosAtivos.filter((c) => c.advbox_status !== 'ok').length;
  const driveFailed = assinadosAtivos.filter((c) => c.drive_file_id === 'failed').length;
  const pendDrive = assinadosAtivos.filter((c) => !c.drive_file_id || c.drive_file_id === 'failed' || c.drive_file_id === 'uploading').length;
  const pipelineAberto = sum(aguardando, (c) => Number(c.honorarios_total) || 0);

  const acoes = {
    aguardando: aguardando.length,
    aguardandoAntigos: aguardandoAntigos.length,
    rascunhosAntigos: rascunhosAntigos.length,
    pendAdvbox,
    pendDrive,
    driveFailed,
  };

  // ─── KPIs (valores brutos; ícone/cor ficam na camada visual) ───
  const ticketMedio = assinadosList.length > 0
    ? sum(assinadosList, (c) => Number(c.honorarios_total) || 0) / assinadosList.length
    : null;

  const temposAssinatura = assinadosList
    .map((c) => {
      const dt = getSignedDate(c);
      if (!dt) return null;
      return (dt - new Date(c.created_at)) / DAY_MS;
    })
    .filter((d) => d !== null && d >= 0 && d < 365);
  const tempoMedioAssinatura = temposAssinatura.length > 0
    ? temposAssinatura.reduce((s, d) => s + d, 0) / temposAssinatura.length
    : null;
  // (R9) mediana = leitura mais honesta do tempo tipico (a media infla com outliers)
  const tempoMedianaAssinatura = median(temposAssinatura);

  const mesLabel = monthLabelLong(now);
  const janelaLabel = janela.label;
  const kpis = {
    assinados_mes: {
      label: hasPeriodo ? 'Assinaturas no período' : 'Assinados no mês',
      value: assinadosJanelaList.length,
      delta: pctDelta(assinadosJanelaList.length, assinadosJanelaAntList.length),
      sub: `${janelaLabel} · vs período anterior`, fmt: 'int',
    },
    valor_mes: {
      label: hasPeriodo ? 'Receita do período' : 'Receita do mês',
      value: receitaJanela,
      delta: pctDelta(receitaJanela, receitaJanelaAnt),
      sub: `${assinadosJanelaList.length} contrato${assinadosJanelaList.length === 1 ? '' : 's'} · ${janelaLabel}`, fmt: 'brl',
    },
    meta_mensal: {
      label: 'Meta mensal', value: `${metaJanelaCount}/${goal}`,
      progress: goal > 0 ? Math.min(100, Math.round((metaJanelaCount / goal) * 100)) : 0,
      sub: goal > 0 ? `${Math.min(100, Math.round((metaJanelaCount / goal) * 100))}% da meta · ${metaJanelaLabel}` : metaJanelaLabel,
      fmt: 'raw',
    },
    total_contratos: { label: 'Contratos no escopo', value: total, sub: range.label, fmt: 'int' },
    total_assinados: {
      label: 'Assinados no escopo', value: porStatus.assinado,
      sub: funil.pctGeral !== null ? `${funil.pctGeral}% dos criados` : '', fmt: 'int',
    },
    taxa_conversao: {
      label: 'Conversão de enviados', value: funil.pctAssinatura,
      sub: `${porStatus.assinado} de ${enviadosEver} enviados`, fmt: 'pct',
    },
    ticket_medio: hasPeriodo
      ? {
        label: 'Ticket médio (iniciais)',
        value: assinadosJanelaList.length > 0 ? receitaJanela / assinadosJanelaList.length : null,
        sub: `assinaturas de ${janelaLabel}`, fmt: 'brl',
      }
      : { label: 'Ticket médio (iniciais)', value: ticketMedio, sub: 'contratos assinados no escopo', fmt: 'brl' },
    tempo_medio_assinatura: {
      label: 'Criação → assinatura', value: tempoMedioAssinatura !== null ? `${tempoMedioAssinatura.toFixed(1)}d` : null,
      sub: tempoMedianaAssinatura !== null ? `mediana ${tempoMedianaAssinatura}d · metade assina em até isso` : 'tempo médio no escopo',
      fmt: 'raw',
    },
    pendente_zapsign: {
      label: 'Aguardando assinatura', value: acoes.aguardando,
      sub: acoes.aguardandoAntigos > 0 ? `${acoes.aguardandoAntigos} há mais de 3 dias` : 'carteira ativa',
      alert: acoes.aguardandoAntigos > 0, fmt: 'int',
    },
    pipeline_aberto: {
      label: 'Honorários a assinar', value: pipelineAberto,
      sub: `${acoes.aguardando} contrato${acoes.aguardando === 1 ? '' : 's'} enviado${acoes.aguardando === 1 ? '' : 's'}`, fmt: 'brl',
    },
    pendente_advbox: {
      label: 'Pendentes ADVBOX', value: pendAdvbox,
      sub: pendAdvbox > 0 ? 'ver aba Monitor' : 'tudo sincronizado', alert: pendAdvbox > 0, fmt: 'int',
    },
    pendente_drive: {
      label: 'Pendentes Drive', value: pendDrive,
      sub: driveFailed > 0 ? `${driveFailed} com falha` : (pendDrive > 0 ? 'upload em andamento' : 'tudo arquivado'),
      alert: driveFailed > 0, fmt: 'int',
    },
    cancelados_mes: {
      label: hasPeriodo ? 'Cancelados no período' : 'Cancelados no mês',
      value: canceladosJanela, sub: janelaLabel, fmt: 'int',
    },
    top_resort_mes: {
      label: hasPeriodo ? 'Top resort do período' : 'Top resort do mês',
      value: topResortsMes[0]?.resort || '—',
      sub: topResortsMes[0] ? `${topResortsMes[0].count} assinado${topResortsMes[0].count === 1 ? '' : 's'} · ${janelaLabel}` : janelaLabel,
      fmt: 'raw',
    },
  };

  // ─── Série mensal (criados / assinados / receita) ───
  const serieMap = {};
  const touchMes = (key) => {
    if (!serieMap[key]) serieMap[key] = { key, label: monthLabelOf(key), criados: 0, assinados: 0, receita: 0 };
    return serieMap[key];
  };
  filtered.forEach((c) => { touchMes(monthKeyOf(new Date(c.created_at))).criados++; });
  assinadosList.forEach((c) => {
    const dt = getSignedDate(c);
    if (!dt) return;
    const m = touchMes(monthKeyOf(dt));
    m.assinados++;
    m.receita += Number(c.honorarios_total) || 0;
  });
  // Preenche meses vazios entre o primeiro e o atual (série contínua)
  const keys = Object.keys(serieMap).sort();
  if (keys.length > 0) {
    const [fy, fm] = keys[0].split('-').map(Number);
    const cursor = new Date(fy, fm - 1, 1);
    const fim = new Date(now.getFullYear(), now.getMonth(), 1);
    while (cursor <= fim) {
      touchMes(monthKeyOf(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  const serieMensal = Object.values(serieMap).sort((a, b) => a.key.localeCompare(b.key)).slice(-13);

  // ─── Desempenho por resort / tipo de ação ───
  const aggBy = (keyFn) => {
    const map = {};
    filtered.forEach((c) => {
      const k = keyFn(c);
      if (!k) return;
      if (!map[k]) map[k] = { label: k, total: 0, assinados: 0, receita: 0 };
      map[k].total++;
      if (c.status === 'assinado') {
        map[k].assinados++;
        map[k].receita += Number(c.honorarios_total) || 0;
      }
    });
    return Object.values(map)
      .map((r) => ({ ...r, taxa: r.total > 0 ? Math.round((r.assinados / r.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'));
  };
  const resorts = aggBy((c) => c.resort);
  const tipos = aggBy((c) => c.tipo_acao);

  // ─── Honorários ───
  // todos/assinados = agregado do escopo GLOBAL (card recolhido respeita o filtro de período).
  // serie = evolução por mês (independe do período; "todos" por mês de CRIAÇÃO, "assinados" por
  // mês de ASSINATURA efetiva) na janela contínua dos últimos 12 meses — alimenta o filtro de
  // mês integrado e o gráfico de linha do card expandido.
  const honMes = { assinados: {}, todos: {} };
  const touchHon = (bucket, key) => {
    if (!honMes[bucket][key]) honMes[bucket][key] = { ambos: 0, exito: 0, iniciais: 0, nenhum: 0 };
    return honMes[bucket][key];
  };
  scopeSemPeriodo.forEach((c) => { touchHon('todos', monthKeyOf(new Date(c.created_at)))[tipoHonorario(c)]++; });
  assinadosComData.forEach(({ c, dt }) => { touchHon('assinados', monthKeyOf(dt))[tipoHonorario(c)]++; });
  const honSerie = (bucket) => mesesContinuos.map((m) => ({
    key: m.key,
    label: m.label,
    ...(honMes[bucket][m.key] || { ambos: 0, exito: 0, iniciais: 0, nenhum: 0 }),
  }));
  const honorarios = {
    todos: contaHonorarios(filtered),
    assinados: contaHonorarios(assinadosList),
    meses: mesesContinuos,
    serie: { todos: honSerie('todos'), assinados: honSerie('assinados') },
  };

  // ─── Jornada de compra (1ª mensagem → assinatura) — usa assinatura efetiva ───
  const jornadaCasos = [];
  assinadosList.forEach((c) => {
    const primMsg = c.dados?.dataPrimeiraMensagem;
    const dt = getSignedDate(c);
    if (!primMsg || !dt) return;
    const inicio = new Date(`${primMsg}T12:00:00`);
    if (Number.isNaN(inicio.getTime())) return;
    const dias = Math.round((dt - inicio) / DAY_MS);
    if (dias >= 0 && dias < 365) {
      jornadaCasos.push({ nome: c.nome_contratante1 || 'N/I', resort: c.resort || 'N/I', dias });
    }
  });
  const jornadaDias = jornadaCasos.map((j) => j.dias);
  const jornada = {
    casos: jornadaCasos,
    total: jornadaCasos.length,
    media: avg(jornadaDias),
    mediana: median(jornadaDias),
    min: jornadaDias.length ? Math.min(...jornadaDias) : null,
    max: jornadaDias.length ? Math.max(...jornadaDias) : null,
  };

  // ─── Tempo até distribuição (assinatura → petição protocolada) ───
  // Exporta casos brutos; agregações (média/mediana REAIS por recorte) ficam
  // no widget — corrige a "mediana" que antes era média ponderada de médias.
  const distCasos = [];
  assinadosList.forEach((c) => {
    if (!c.peticao_distribuida_em) return;
    const inicio = getSignedDate(c);
    if (!inicio) return;
    const fim = new Date(`${c.peticao_distribuida_em}T12:00:00`);
    if (Number.isNaN(fim.getTime())) return;
    const dias = Math.round((fim - inicio) / DAY_MS);
    if (dias < 0 || dias > 730) return;
    distCasos.push({
      resort: c.resort || 'N/I',
      tipo: c.tipo_acao || 'N/I',
      nome: c.nome_contratante1 || 'N/I',
      dias,
    });
  });

  // ─── Insights automáticos (correlações + anomalias, corrigidos) ───
  const insights = [];

  // 1. Taxa de assinatura por origem do cliente
  const origemStats = {};
  filtered.forEach((c) => {
    const origem = c.dados?.origemCliente || 'N/I';
    if (!origemStats[origem]) origemStats[origem] = { total: 0, assinados: 0 };
    origemStats[origem].total++;
    if (c.status === 'assinado') origemStats[origem].assinados++;
  });
  const origemRank = Object.entries(origemStats)
    .filter(([, v]) => v.total >= 3)
    .map(([origem, v]) => ({ origem, total: v.total, taxa: Math.round((v.assinados / v.total) * 100) }))
    .sort((a, b) => b.taxa - a.taxa);
  if (origemRank.length >= 2) {
    const best = origemRank[0];
    const worst = origemRank[origemRank.length - 1];
    if (best.taxa >= worst.taxa + 10) {
      insights.push({
        kind: 'positivo', icon: 'chart',
        texto: `Clientes de ${best.origem} assinam ${best.taxa - worst.taxa} p.p. mais que ${worst.origem}`,
        detalhe: `${best.origem}: ${best.taxa}% (${best.total}) · ${worst.origem}: ${worst.taxa}% (${worst.total})`,
      });
    }
  }

  // 2. Velocidade de assinatura por resort — assinatura efetiva (antes: updated_at)
  const velResort = {};
  assinadosList.forEach((c) => {
    const dt = getSignedDate(c);
    if (!dt) return;
    const dias = Math.round((dt - new Date(c.created_at)) / DAY_MS);
    if (dias < 0 || dias > 90) return;
    const r = c.resort || 'N/I';
    (velResort[r] = velResort[r] || []).push(dias);
  });
  const velRank = Object.entries(velResort)
    .filter(([, v]) => v.length >= 3)
    .map(([resort, dias]) => ({ resort, media: avg(dias), count: dias.length }))
    .sort((a, b) => a.media - b.media);
  if (velRank.length >= 2) {
    const fast = velRank[0];
    const slow = velRank[velRank.length - 1];
    if (slow.media - fast.media >= 2) {
      insights.push({
        kind: 'info', icon: 'bolt',
        texto: `${fast.resort} assina em média ${slow.media - fast.media} dias mais rápido que ${slow.resort}`,
        detalhe: `${fast.resort}: ${fast.media}d (${fast.count}) · ${slow.resort}: ${slow.media}d (${slow.count})`,
      });
    }
  }

  // 3. Conversão por tipo de honorário
  const convPorTipo = {};
  filtered.forEach((c) => {
    const t = tipoHonorario(c);
    if (!convPorTipo[t]) convPorTipo[t] = { total: 0, assinados: 0 };
    convPorTipo[t].total++;
    if (c.status === 'assinado') convPorTipo[t].assinados++;
  });
  const honLabels = { ambos: 'Iniciais + Êxito', exito: 'Somente Êxito', iniciais: 'Somente Iniciais', nenhum: 'Sem honorários' };
  const convRank = Object.entries(convPorTipo)
    .filter(([k, v]) => k !== 'nenhum' && v.total >= 3)
    .map(([k, v]) => ({ label: honLabels[k], taxa: Math.round((v.assinados / v.total) * 100), total: v.total }))
    .sort((a, b) => b.taxa - a.taxa);
  if (convRank.length >= 2 && convRank[0].taxa >= convRank[convRank.length - 1].taxa + 10) {
    const a = convRank[0];
    const z = convRank[convRank.length - 1];
    insights.push({
      kind: 'positivo', icon: 'money',
      texto: `Contratos "${a.label}" convertem ${a.taxa - z.taxa} p.p. mais que "${z.label}"`,
      detalhe: `${a.label}: ${a.taxa}% (${a.total}) · ${z.label}: ${z.taxa}% (${z.total})`,
    });
  }

  // 4. Dia da semana com mais assinaturas — assinatura efetiva
  const diasNome = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const porDia = [0, 0, 0, 0, 0, 0, 0];
  assinadosComData.forEach(({ dt }) => { porDia[dt.getDay()]++; });
  const maxDia = Math.max(...porDia);
  if (maxDia >= 3) {
    const idx = porDia.indexOf(maxDia);
    insights.push({
      kind: 'info', icon: 'calendar',
      texto: `${diasNome[idx].charAt(0).toUpperCase() + diasNome[idx].slice(1)} é o dia com mais assinaturas (${maxDia})`,
      detalhe: diasNome.map((d, i) => `${d.slice(0, 3)}: ${porDia[i]}`).join(' · '),
    });
  }

  // 5. Tempo de resposta (1ª mensagem → criação do contrato) vs conversão
  const resposta = [];
  filtered.forEach((c) => {
    const primMsg = c.dados?.dataPrimeiraMensagem;
    if (!primMsg || !c.created_at) return;
    const diffDias = (new Date(c.created_at) - new Date(`${primMsg}T12:00:00`)) / DAY_MS;
    if (diffDias > 0 && diffDias < 30) {
      resposta.push({ dias: diffDias, assinado: c.status === 'assinado' });
    }
  });
  if (resposta.length >= 8) {
    const rapidos = resposta.filter((t) => t.dias <= 3);
    const lentos = resposta.filter((t) => t.dias > 7);
    if (rapidos.length >= 3 && lentos.length >= 3) {
      const taxaR = Math.round((rapidos.filter((t) => t.assinado).length / rapidos.length) * 100);
      const taxaL = Math.round((lentos.filter((t) => t.assinado).length / lentos.length) * 100);
      if (Math.abs(taxaR - taxaL) >= 10) {
        insights.push({
          kind: taxaR > taxaL ? 'positivo' : 'alerta', icon: 'clock',
          texto: `Contrato criado em até 3 dias após o 1º contato: ${taxaR}% assinam · acima de 7 dias: ${taxaL}%`,
          detalhe: `Rápidos (≤3d): ${rapidos.length} · Lentos (>7d): ${lentos.length}`,
        });
      }
    }
  }

  // 6. Anomalia de ritmo mensal — projeção pro-rata do mês atual vs mês anterior
  // (a versão anterior lia campos inexistentes e nunca disparava)
  const criadosMesAtual = serieMap[mesAtualKey]?.criados || 0;
  const criadosMesAnterior = serieMap[mesAnteriorKey]?.criados || 0;
  const diaDoMes = now.getDate();
  const diasNoMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (!filters.periodo || filters.periodo === 'tudo') {
    if (criadosMesAnterior >= 5 && diaDoMes >= 7) {
      const projecao = Math.round((criadosMesAtual / diaDoMes) * diasNoMes);
      const delta = pctDelta(projecao, criadosMesAnterior);
      if (delta !== null && delta <= -30) {
        insights.push({
          kind: 'alerta', icon: 'down',
          texto: `Ritmo de criação ${Math.abs(delta)}% abaixo do mês anterior`,
          detalhe: `Projeção: ${projecao} vs ${criadosMesAnterior} em ${monthLabelOf(mesAnteriorKey)} (${criadosMesAtual} até dia ${diaDoMes})`,
        });
      } else if (delta !== null && delta >= 50) {
        insights.push({
          kind: 'positivo', icon: 'up',
          texto: `Ritmo de criação ${delta}% acima do mês anterior`,
          detalhe: `Projeção: ${projecao} vs ${criadosMesAnterior} em ${monthLabelOf(mesAnteriorKey)} (${criadosMesAtual} até dia ${diaDoMes})`,
        });
      }
    }
    // 7. Sem contratos novos há 3+ dias (carteira ativa)
    if (ativos.length > 10) {
      const ultimo = ativos.reduce((m, c) => Math.max(m, new Date(c.created_at).getTime()), 0);
      const diasSem = Math.floor((now.getTime() - ultimo) / DAY_MS);
      if (diasSem >= 3) {
        insights.push({
          kind: 'alerta', icon: 'warn',
          texto: `Nenhum contrato novo há ${diasSem} dias`,
          detalhe: 'Último cadastro: ' + new Date(ultimo).toLocaleDateString('pt-BR'),
        });
      }
    }
    // 8. Resort novo com volume no mês
    const resortsMesAtual = {};
    const resortsMesAnt = new Set();
    universe.forEach((c) => {
      const k = monthKeyOf(new Date(c.created_at));
      if (k === mesAtualKey && c.resort) resortsMesAtual[c.resort] = (resortsMesAtual[c.resort] || 0) + 1;
      if (k === mesAnteriorKey && c.resort) resortsMesAnt.add(c.resort);
    });
    Object.entries(resortsMesAtual).forEach(([resort, count]) => {
      if (!resortsMesAnt.has(resort) && count >= 3) {
        insights.push({
          kind: 'info', icon: 'new',
          texto: `Resort "${resort}" apareceu com ${count} contratos este mês`,
          detalhe: 'Sem contratos no mês anterior',
        });
      }
    });
  }

  // ─── Insights adicionais (válidos em qualquer recorte) — enriquecem o pool
  //     para o botão "gerar mais insights" do card rotacionar entre vários ───
  const fmtBrlInt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  // 9. Conversão geral do escopo
  if (filtered.length >= 10) {
    const assinTot = filtered.filter((c) => c.status === 'assinado').length;
    const taxa = Math.round((assinTot / filtered.length) * 100);
    insights.push({
      kind: taxa >= 60 ? 'positivo' : 'info', icon: 'chart',
      texto: `Conversão geral do escopo: ${taxa}% assinaram`,
      detalhe: `${assinTot} de ${filtered.length} contratos no recorte`,
    });
  }

  // 10. Resort de maior volume no escopo
  const volResort = {};
  filtered.forEach((c) => { const r = c.resort || 'N/I'; if (r !== 'N/I') volResort[r] = (volResort[r] || 0) + 1; });
  const topVolResort = Object.entries(volResort).sort((a, b) => b[1] - a[1])[0];
  if (topVolResort && filtered.length >= 10 && topVolResort[1] >= 3) {
    const pct = Math.round((topVolResort[1] / filtered.length) * 100);
    insights.push({
      kind: 'info', icon: 'chart',
      texto: `${topVolResort[0]} lidera em volume: ${topVolResort[1]} contratos (${pct}% do escopo)`,
      detalhe: `${Object.keys(volResort).length} resorts no recorte`,
    });
  }

  // 11. Ticket médio dos assinados
  const ticketsAssin = assinadosList.map((c) => Number(c.honorarios_total) || 0).filter((v) => v > 0);
  if (ticketsAssin.length >= 5) {
    const tm = Math.round(ticketsAssin.reduce((s, v) => s + v, 0) / ticketsAssin.length);
    const maior = Math.max(...ticketsAssin);
    insights.push({
      kind: 'info', icon: 'money',
      texto: `Ticket médio dos assinados: ${fmtBrlInt(tm)}`,
      detalhe: `${ticketsAssin.length} contratos com honorário inicial · maior: ${fmtBrlInt(maior)}`,
    });
  }

  // 12. Melhor mês de receita na série
  if (serieMensal && serieMensal.length >= 2) {
    const best = serieMensal.reduce((m, x) => (x.receita > (m?.receita || 0) ? x : m), null);
    if (best && best.receita > 0) {
      insights.push({
        kind: 'positivo', icon: 'up',
        texto: `Maior receita: ${best.label} (${fmtBrlInt(best.receita)})`,
        detalhe: `${best.assinados} assinado(s) no mês`,
      });
    }
  }

  // 13. Tipo de ação mais frequente
  const volTipo = {};
  filtered.forEach((c) => { const t = c.tipo_acao || 'N/I'; if (t !== 'N/I') volTipo[t] = (volTipo[t] || 0) + 1; });
  const topTipo = Object.entries(volTipo).sort((a, b) => b[1] - a[1])[0];
  if (topTipo && filtered.length >= 10 && topTipo[1] >= 3) {
    insights.push({
      kind: 'info', icon: 'bolt',
      texto: `Ação mais frequente: "${topTipo[0]}" (${topTipo[1]} contratos)`,
      detalhe: `${Object.keys(volTipo).length} tipos de ação no recorte`,
    });
  }

  // 14. Taxa de cancelamento
  const canceladosN = filtered.filter((c) => c.status === 'cancelado').length;
  if (filtered.length >= 15 && canceladosN > 0) {
    const taxaCanc = Math.round((canceladosN / filtered.length) * 100);
    if (taxaCanc >= 5) {
      insights.push({
        kind: 'alerta', icon: 'warn',
        texto: `Taxa de cancelamento: ${taxaCanc}% (${canceladosN} cancelados)`,
        detalhe: 'Cancelados ficam fora das demais métricas',
      });
    }
  }

  // ─── Recentes (filtered já vem ordenado por created_at desc) ───
  const recentes = filtered.slice(0, 20);

  return {
    scope: {
      totalLinhas: lista.length,
      arquivados: lista.length - ativos.length,
      incluirArquivados: !!filters.incluirArquivados,
      periodoLabel: range.label,
      mesLabel,
      janelaLabel,
      hasPeriodo,
    },
    filtros,
    total,
    porStatus,
    funil,
    acoes,
    kpis,
    serieMensal,
    resorts,
    tipos,
    honorarios,
    topResortsMes,
    jornada,
    distCasos,
    insights,
    recentes,
    idsFiltrados: filtered.map((c) => c.id),
    // Mês corrente de verdade (independe de filtros de período) — celebração de meta
    assinadosMes: assinadosMesCorrente,
    comparador,
  };
}
