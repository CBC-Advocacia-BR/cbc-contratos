/**
 * Calculadora de Comissao Mensal — Modulo de Vendas (Fase 7)
 * ------------------------------------------------------------------
 * Cron: todo dia 20 as 03:05 UTC (= 00:05 BRT do dia 20)
 * O periodo comissionavel fecha no dia 19 23:59:59 do mes corrente, entao
 * rodar logo apos meia-noite BRT garante todos os dados consolidados.
 *
 * Invocacao manual (POST):
 *   /.netlify/functions/commission-calculator
 *     -> calcula periodo corrente baseado em new Date()
 *   /.netlify/functions/commission-calculator?month=YYYY-MM
 *     -> calcula o periodo que TERMINA naquele mes
 *        ex: month=2026-04 => periodo 2026-03-20 a 2026-04-19
 *
 * Processo:
 *   1. Carrega config (vendas_comissao_regras id=1)
 *   2. Busca todas as duplas vendedora+assistente via user_permissions
 *   3. Para cada dupla, busca contratos elegiveis no periodo
 *      (assinados + distribuidos + guia paga + juntada + nao cancelados)
 *   4. Classifica por tipo (iniciais/exito) e aplica pesos
 *      (FDS=2, promocao sazonal pode multiplicar/equiparar)
 *   5. Aplica faixas cumulativas (1-20, 21-40, 41-60, 61+)
 *   6. Aplica bonus de R$ 1.000 (para CADA uma) se peso_total >= 100
 *   7. Split 70/30 entre vendedora e assistente
 *   8. UPSERT em vendas_comissoes_mensais + INSERTs em vendas_comissoes_detalhe
 *
 * Regra de cancelamento:
 *   - Contrato cancelado ANTES de distribuido+guia paga -> nao conta
 *   - Contrato cancelado DEPOIS de distribuido+guia paga -> conta (mantem comissao)
 *   A elegibilidade ja exige distribuido+guia paga+juntada, entao o filtro
 *   efetivo eh "status != 'cancelado' OU (cancelado APOS distribuicao+guia)"
 *   — optamos pela leitura conservadora: contrato cancelado nao conta no
 *   calculo, a nao ser que ja tenha sido pago anteriormente (comissao ja
 *   materializada em periodo anterior).
 * ------------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

// ─── DEFAULTS (mesmos valores do SQL) ───────────────────────────────
const DEFAULT_CONFIG = {
  faixas_iniciais: [
    { min: 1, max: 20, valor: 90 },
    { min: 21, max: 40, valor: 100 },
    { min: 41, max: 60, valor: 110 },
    { min: 61, max: null, valor: 120 },
  ],
  faixas_exito: [
    { min: 1, max: 20, valor: 20 },
    { min: 21, max: 40, valor: 30 },
    { min: 41, max: 60, valor: 40 },
    { min: 61, max: null, valor: 50 },
  ],
  multiplicador_fim_semana: 2.0,
  bonus_contratos_threshold: 100,
  bonus_valor: 1000,
  split_vendedora_pct: 0.70,
  split_assistente_pct: 0.30,
  periodo_inicio_dia: 20,
};

// ─── HELPERS DE PERIODO ─────────────────────────────────────────────

// Converte "YYYY-MM" em periodo {start, end} onde end = dia (diaInicio-1) do mes informado
// e start = dia diaInicio do mes anterior.
// Ex: month="2026-04", diaInicio=20 -> start="2026-03-20", end="2026-04-19"
function getPeriodFromMonth(yyyymm, diaInicio = 20) {
  const [year, month] = yyyymm.split('-').map(Number);
  // mes 1-12 => Date UTC mes eh 0-11
  const endDate = new Date(Date.UTC(year, month - 1, diaInicio - 1, 23, 59, 59));
  const startDate = new Date(Date.UTC(year, month - 2, diaInicio, 0, 0, 0));
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

// Descobre o periodo corrente baseado na data passada (default: agora).
// - Se hoje <  dia de inicio: periodo termina no dia (diaInicio-1) deste mes
// - Se hoje >= dia de inicio: periodo termina no dia (diaInicio-1) do proximo mes
function currentPeriodFromDate(date = new Date(), diaInicio = 20) {
  const d = new Date(date);
  const day = d.getUTCDate();
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1; // 1-12

  if (day < diaInicio) {
    return getPeriodFromMonth(`${year}-${String(month).padStart(2, '0')}`, diaInicio);
  }
  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return getPeriodFromMonth(`${year}-${String(month).padStart(2, '0')}`, diaInicio);
}

// ─── LOGICA DE FAIXAS ───────────────────────────────────────────────

// Dado um array de faixas [{min,max,valor}, ...] e um contador cumulativo,
// retorna {faixa: "min-max", valor: R$}
function getFaixa(faixas, count) {
  if (!Array.isArray(faixas)) return null;
  for (const f of faixas) {
    const min = Number(f.min);
    const max = f.max === null || f.max === undefined ? null : Number(f.max);
    if (count >= min && (max === null || count <= max)) {
      return {
        faixa: `${min}-${max ?? '+'}`,
        valor: Number(f.valor) || 0,
      };
    }
  }
  return null;
}

// ─── LOADERS ────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const { data, error } = await supabase
      .from('vendas_comissao_regras')
      .select('*')
      .eq('id', 1)
      .single();
    if (error || !data) return DEFAULT_CONFIG;
    // Mescla com defaults para garantir todos os campos
    return {
      ...DEFAULT_CONFIG,
      ...data,
      faixas_iniciais: data.faixas_iniciais || DEFAULT_CONFIG.faixas_iniciais,
      faixas_exito: data.faixas_exito || DEFAULT_CONFIG.faixas_exito,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function loadDuplas() {
  const { data: users, error } = await supabase
    .from('user_permissions')
    .select('email, display_name, perfil_vendas, vendedora_parceira_email')
    .not('perfil_vendas', 'is', null);

  if (error || !users) return [];

  const vendedoras = users.filter((u) => u.perfil_vendas === 'vendedora');
  const assistentes = users.filter((u) => u.perfil_vendas === 'assistente');

  return vendedoras.map((v) => {
    const assistente = assistentes.find(
      (a) => (a.vendedora_parceira_email || '').toLowerCase() === (v.email || '').toLowerCase(),
    );
    return { vendedora: v, assistente: assistente || null };
  });
}

async function loadPromocoesAtivas(start, end) {
  try {
    const { data } = await supabase
      .from('vendas_promocoes_sazonais')
      .select('*')
      .eq('ativo', true)
      .gte('data_fim', start)
      .lte('data_inicio', end);
    return data || [];
  } catch {
    return [];
  }
}

// Verifica se a promocao eh aplicavel ao contrato (resort, tipo_acao, datas)
function isPromocaoAplicavel(promo, contrato) {
  const sigDate = (contrato.signed_at || '').slice(0, 10);
  if (!sigDate) return false;
  if (sigDate < promo.data_inicio || sigDate > promo.data_fim) return false;
  if (promo.resort_filtro && promo.resort_filtro !== contrato.resort) return false;
  if (promo.tipo_acao_filtro && promo.tipo_acao_filtro !== contrato.tipo_acao) return false;
  return true;
}

// (perf-be-5) Carrega TODOS os contratos assinados do periodo de UMA vez (sem
// filtrar por vendedora) e o mapa de guias correspondente de UMA vez, antes do
// loop de duplas. Substitui as 2 queries em serie que rodavam por dupla.
// Retorna { contratosPorVendedora: Map<emailLower, contrato[]>, guiasMap }.
async function loadDadosPeriodo(start, end) {
  const { data: contratos, error } = await supabase
    .from('contratos')
    .select(
      'id, nome_contratante1, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, signed_at, status, vendedora_email, fim_de_semana_atendimento, promocao_sazonal_id, peticao_distribuida_em, kanban_col',
    )
    .eq('status', 'assinado')
    .gte('signed_at', `${start}T00:00:00`)
    .lte('signed_at', `${end}T23:59:59`);

  const contratosPorVendedora = new Map();
  const guiasMap = {};
  if (error || !contratos || contratos.length === 0) {
    return { contratosPorVendedora, guiasMap };
  }

  // Agrupa por vendedora_email EXATO (a query antiga usava .eq case-sensitive,
  // entao nao normalizamos aqui para manter o resultado identico)
  for (const c of contratos) {
    const key = c.vendedora_email || '';
    if (!contratosPorVendedora.has(key)) contratosPorVendedora.set(key, []);
    contratosPorVendedora.get(key).push(c);
  }

  // Busca TODAS as guias do periodo de uma vez (so dos contratos carregados)
  const ids = contratos.map((c) => c.id);
  if (ids.length > 0) {
    const { data: guias } = await supabase
      .from('vendas_guias_custas')
      .select('contrato_id, paga_em, juntada_em')
      .in('contrato_id', ids);
    for (const g of guias || []) {
      guiasMap[g.contrato_id] = g;
    }
  }

  return { contratosPorVendedora, guiasMap };
}

// (perf-be-5) Filtra em memoria os contratos elegiveis de uma vendedora.
// Mantem os MESMOS criterios de antes (resultado identico):
//   - status = 'assinado' (ja filtrado na query do periodo)
//   - signed_at dentro do periodo (ja filtrado na query do periodo)
//   - distribuido: peticao_distribuida_em IS NOT NULL OR kanban_col = 'guia_juntada'
//   - guia paga: vendas_guias_custas.paga_em IS NOT NULL
//   - guia juntada: vendas_guias_custas.juntada_em IS NOT NULL
function loadContratosElegiveis(vendedoraEmail, dadosPeriodo) {
  const { contratosPorVendedora, guiasMap } = dadosPeriodo;
  const contratos = contratosPorVendedora.get(vendedoraEmail || '') || [];
  if (contratos.length === 0) return [];

  // Filtro de distribuicao
  const distribuidos = contratos.filter(
    (c) => !!c.peticao_distribuida_em || c.kanban_col === 'guia_juntada',
  );
  if (distribuidos.length === 0) return [];

  // Filtrar por guia paga + juntada
  return distribuidos.filter((c) => {
    const g = guiasMap[c.id];
    return g && g.paga_em && g.juntada_em;
  });
}

// ─── CALCULO POR DUPLA ──────────────────────────────────────────────

async function calculateDupla(dupla, config, promos, start, end, dadosPeriodo) {
  // (perf-be-5) filtra em memoria a partir dos dados ja pre-carregados do periodo
  const contratos = loadContratosElegiveis(dupla.vendedora.email, dadosPeriodo);

  const contratosIniciais = [];
  const contratosExito = [];
  const detalhes = [];
  let pesoTotal = 0;

  for (const c of contratos) {
    // Aplicar promocao se houver
    const promoAplicavel = promos.find((p) => isPromocaoAplicavel(p, c));

    const hasIniciais = Number(c.honorarios_total || 0) > 0;
    const hasExito = Number(c.honorarios_percentual_exito || 0) > 0;
    const isExitoOnly = !hasIniciais && hasExito;

    let tipoOriginal = isExitoOnly ? 'exito' : 'iniciais';
    let tipoEfetivo = tipoOriginal;

    // Promocao "equiparar_exito_iniciais": contrato so-exito conta como iniciais
    if (
      promoAplicavel?.regra?.tipo === 'equiparar_exito_iniciais' &&
      tipoOriginal === 'exito'
    ) {
      tipoEfetivo = 'iniciais';
    }

    // Peso do contrato (FDS + promocao multiplicador)
    let peso = 1.0;
    if (c.fim_de_semana_atendimento) {
      peso *= Number(config.multiplicador_fim_semana || 2.0);
    }
    if (promoAplicavel?.regra?.tipo === 'multiplicador') {
      peso *= Number(promoAplicavel.regra.valor || 2.0);
    }

    pesoTotal += peso;

    const entry = {
      contrato: c,
      tipoOriginal,
      tipoEfetivo,
      peso,
      promo: promoAplicavel || null,
    };
    if (tipoEfetivo === 'iniciais') contratosIniciais.push(entry);
    else contratosExito.push(entry);
  }

  // Ordenar cronologicamente para aplicar faixas cumulativas
  contratosIniciais.sort((a, b) =>
    (a.contrato.signed_at || '').localeCompare(b.contrato.signed_at || ''),
  );
  contratosExito.sort((a, b) =>
    (a.contrato.signed_at || '').localeCompare(b.contrato.signed_at || ''),
  );

  // ─── Aplicar faixas de iniciais ───
  let acumuladoIniciais = 0;
  let subtotalIniciais = 0;
  let bonusExtraPromos = 0;

  for (const e of contratosIniciais) {
    // Unidades: arredondar peso para cima (fds=2 conta como 2 posicoes)
    const unidades = Math.max(1, Math.ceil(Number(e.peso) || 1));
    for (let i = 0; i < unidades; i++) {
      acumuladoIniciais++;
      const faixa = getFaixa(config.faixas_iniciais, acumuladoIniciais);
      if (!faixa) continue;
      subtotalIniciais += faixa.valor;
      detalhes.push({
        contrato_id: e.contrato.id,
        tipo_comissao: 'iniciais',
        faixa_aplicada: faixa.faixa,
        valor_base: faixa.valor,
        fim_de_semana: !!e.contrato.fim_de_semana_atendimento,
        promocao_sazonal_id: e.promo?.id || null,
        peso_aplicado: 1.0,
        valor_final: faixa.valor,
        elegivel: true,
      });
    }
    // Promocao valor_fixo: adiciona extra por contrato
    if (e.promo?.regra?.tipo === 'valor_fixo' && Number(e.promo.regra.valor || 0) > 0) {
      bonusExtraPromos += Number(e.promo.regra.valor);
    }
  }

  // ─── Aplicar faixas de exito ───
  let acumuladoExito = 0;
  let subtotalExito = 0;

  for (const e of contratosExito) {
    const unidades = Math.max(1, Math.ceil(Number(e.peso) || 1));
    for (let i = 0; i < unidades; i++) {
      acumuladoExito++;
      const faixa = getFaixa(config.faixas_exito, acumuladoExito);
      if (!faixa) continue;
      subtotalExito += faixa.valor;
      detalhes.push({
        contrato_id: e.contrato.id,
        tipo_comissao: 'exito',
        faixa_aplicada: faixa.faixa,
        valor_base: faixa.valor,
        fim_de_semana: !!e.contrato.fim_de_semana_atendimento,
        promocao_sazonal_id: e.promo?.id || null,
        peso_aplicado: 1.0,
        valor_final: faixa.valor,
        elegivel: true,
      });
    }
    if (e.promo?.regra?.tipo === 'valor_fixo' && Number(e.promo.regra.valor || 0) > 0) {
      bonusExtraPromos += Number(e.promo.regra.valor);
    }
  }

  // ─── Bonus 100 contratos ───
  // Baseado no total de UNIDADES (ja considera FDS + multiplicadores sazonais)
  const totalUnidades = acumuladoIniciais + acumuladoExito;
  const bonusAplicado = totalUnidades >= Number(config.bonus_contratos_threshold || 100);
  const bonusUnit = bonusAplicado ? Number(config.bonus_valor || 1000) : 0;

  // ─── Split ───
  // bruto_comissao = subtotal_iniciais + subtotal_exito + bonus_extra_promos (valor_fixo)
  // vendedora recebe (bruto * split_v) + bonus100
  // assistente recebe (bruto * split_a) + bonus100 (se dupla existir)
  // subtotal_bonus na tabela representa o TOTAL pago de bonus (dupla = 2x)
  const brutoComissao = subtotalIniciais + subtotalExito + bonusExtraPromos;
  const temAssistente = !!dupla.assistente;
  const splitV = Number(config.split_vendedora_pct || 0.7);
  const splitA = Number(config.split_assistente_pct || 0.3);

  const valorVendedora = brutoComissao * splitV + bonusUnit;
  const valorAssistente = temAssistente ? brutoComissao * splitA + bonusUnit : 0;
  const subtotalBonusTotal = bonusUnit * (temAssistente ? 2 : 1);

  return {
    vendedora_email: dupla.vendedora.email,
    assistente_email: dupla.assistente?.email || null,
    periodo_inicio: start,
    periodo_fim: end,
    contratos_count: contratos.length,
    contratos_iniciais_count: contratosIniciais.length,
    contratos_exito_count: contratosExito.length,
    contratos_fds_count: contratos.filter((c) => c.fim_de_semana_atendimento).length,
    peso_total: Number(pesoTotal.toFixed(2)),
    bonus_100_aplicado: bonusAplicado,
    subtotal_iniciais: Number(subtotalIniciais.toFixed(2)),
    subtotal_exito: Number(subtotalExito.toFixed(2)),
    subtotal_bonus: Number(subtotalBonusTotal.toFixed(2)),
    total_bruto: Number((brutoComissao + subtotalBonusTotal).toFixed(2)),
    valor_vendedora: Number(valorVendedora.toFixed(2)),
    valor_assistente: Number(valorAssistente.toFixed(2)),
    detalhes,
  };
}

// ─── PERSISTENCIA ───────────────────────────────────────────────────

async function saveComissao(result) {
  // UPSERT manual (busca existing + update ou insert)
  const { data: existing } = await supabase
    .from('vendas_comissoes_mensais')
    .select('id')
    .eq('vendedora_email', result.vendedora_email)
    .eq('periodo_inicio', result.periodo_inicio)
    .maybeSingle();

  // Separa detalhes do registro principal
  const main = { ...result };
  delete main.detalhes;
  // Backup JSONB completo do calculo
  main.detalhes = result; // coluna `detalhes jsonb` na tabela

  // Corrigindo nome conflitante: a coluna `detalhes` na tabela mensais eh jsonb
  // e serve para backup completo. O array detalhes[] vai para a tabela secundaria.
  const mainRecord = {
    vendedora_email: result.vendedora_email,
    assistente_email: result.assistente_email,
    periodo_inicio: result.periodo_inicio,
    periodo_fim: result.periodo_fim,
    contratos_count: result.contratos_count,
    contratos_iniciais_count: result.contratos_iniciais_count,
    contratos_exito_count: result.contratos_exito_count,
    contratos_fds_count: result.contratos_fds_count,
    peso_total: result.peso_total,
    bonus_100_aplicado: result.bonus_100_aplicado,
    subtotal_iniciais: result.subtotal_iniciais,
    subtotal_exito: result.subtotal_exito,
    subtotal_bonus: result.subtotal_bonus,
    total_bruto: result.total_bruto,
    valor_vendedora: result.valor_vendedora,
    valor_assistente: result.valor_assistente,
    detalhes: {
      calculado_em: new Date().toISOString(),
      detalhes_count: result.detalhes.length,
      resumo: {
        iniciais: result.contratos_iniciais_count,
        exito: result.contratos_exito_count,
        fds: result.contratos_fds_count,
        peso_total: result.peso_total,
      },
    },
    calculada_em: new Date().toISOString(),
  };

  let comissaoId;
  if (existing?.id) {
    comissaoId = existing.id;
    const { error: updErr } = await supabase
      .from('vendas_comissoes_mensais')
      .update(mainRecord)
      .eq('id', existing.id);
    if (updErr) throw new Error(`update failed: ${updErr.message}`);
    // Remove detalhes antigos antes de reinserir
    await supabase.from('vendas_comissoes_detalhe').delete().eq('comissao_id', existing.id);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('vendas_comissoes_mensais')
      .insert(mainRecord)
      .select('id')
      .single();
    if (insErr) throw new Error(`insert failed: ${insErr.message}`);
    comissaoId = inserted?.id;
  }

  if (comissaoId && result.detalhes.length > 0) {
    const detalhesRows = result.detalhes.map((d) => ({
      ...d,
      comissao_id: comissaoId,
    }));
    // Insert em batches para evitar payload gigante
    const BATCH = 100;
    for (let i = 0; i < detalhesRows.length; i += BATCH) {
      const slice = detalhesRows.slice(i, i + BATCH);
      const { error } = await supabase.from('vendas_comissoes_detalhe').insert(slice);
      if (error) throw new Error(`insert detalhes failed: ${error.message}`);
    }
  }

  return comissaoId;
}

// ─── HANDLER PRINCIPAL ──────────────────────────────────────────────

export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', {
      status: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const url = new URL(req.url);
    const monthParam = url.searchParams.get('month');

    const config = await loadConfig();

    const periodo = monthParam
      ? getPeriodFromMonth(monthParam, config.periodo_inicio_dia)
      : currentPeriodFromDate(new Date(), config.periodo_inicio_dia);

    const { start, end } = periodo;

    const duplas = await loadDuplas();
    const promos = await loadPromocoesAtivas(start, end);
    // (perf-be-5) carrega TODOS os contratos + guias do periodo de uma vez,
    // antes do loop; dentro do loop so filtramos em memoria por dupla
    const dadosPeriodo = await loadDadosPeriodo(start, end);

    const resumo = {
      periodo: { start, end },
      duplas_total: duplas.length,
      duplas_processadas: 0,
      total_comissao_bruta: 0,
      total_vendedoras: 0,
      total_assistentes: 0,
      resultados: [],
      erros: [],
    };

    for (const dupla of duplas) {
      try {
        const result = await calculateDupla(dupla, config, promos, start, end, dadosPeriodo);
        await saveComissao(result);
        resumo.duplas_processadas++;
        resumo.total_comissao_bruta += result.total_bruto;
        resumo.total_vendedoras += result.valor_vendedora;
        resumo.total_assistentes += result.valor_assistente;
        resumo.resultados.push({
          vendedora: dupla.vendedora.email,
          assistente: dupla.assistente?.email || null,
          contratos: result.contratos_count,
          bruto: result.total_bruto,
          vendedora_valor: result.valor_vendedora,
          assistente_valor: result.valor_assistente,
          bonus_100: result.bonus_100_aplicado,
        });
      } catch (e) {
        resumo.erros.push({
          vendedora: dupla.vendedora.email,
          erro: e.message,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, ...resumo }), {
      status: 200,
      headers: CORS,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 5),
      }),
      { status: 500, headers: CORS },
    );
  }
};

// Cron: todo dia 20 as 03:05 UTC (00:05 BRT)
// Formato: minuto hora dia mes dia_da_semana
export const config = {
  schedule: '5 3 20 * *',
};
