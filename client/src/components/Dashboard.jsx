// ─────────────────────────────────────────────────────────────────────────
// Dashboard — redesign completo (12/06/2026)
//
// Arquitetura:
//  - UMA fonte de dados: linhas slim de `contratos` (fetch + realtime).
//    A materialized view dashboard_stats deixou de alimentar a tela — ela
//    excluía arquivados enquanto o cálculo local incluía, e os números
//    divergiam na mesma página. (A MV segue existindo para outros usos.)
//  - Lógica de métricas em ./dashboard/compute.js (pura, testável).
//  - Visual em ./dashboard/widgets.jsx (tokens --cbc-*, dark mode ok).
//  - Filtros (período/resort/tipo/arquivados) valem para a página inteira;
//    métricas "do mês" e pendências operacionais são marcadas como tal.
// ─────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { supabase } from '../lib/supabase';
import { exportContratosToExcel } from '../utils/excelExport';
import { SkeletonDashboard } from './Skeleton';
import ErrorState from './ErrorState';
import { usePersistedFilter } from '../hooks/usePersistedFilters';
import { celebrations, getMonthlyGoal } from '../utils/celebrations';
import { useKpiPreferences } from '../hooks/useKpiPreferences';
import KpiPreferencesModal from './KpiPreferencesModal';
import { useAuth } from '../AuthContext';
import {
  ArrowPathIcon,
  ArrowDownTrayIcon,
  DocumentArrowDownIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { computeDashboard, normalizeContrato, resolvePeriodo } from './dashboard/compute';
import {
  KpiCard,
  StatusAssinaturasCard,
  ActionStrip,
  FunnelCard,
  MonthComparator,
  PerformanceList,
  HonorariosCard,
  TopMesCard,
  JornadaCard,
  DistribuicaoCard,
  InsightsCard,
  RecentContracts,
  FilterBar,
  EmptyScope,
  SectionTitle,
} from './dashboard/widgets';

const GeoHeatmap = lazy(() => import('./GeoHeatmap'));
const HeatmapTemporal = lazy(() => import('./HeatmapTemporal'));
const RelatorioAssinadosModal = lazy(() => import('./dashboard/RelatorioAssinadosModal'));

// Cache em módulo (#29) — evita tela vazia ao trocar de aba e voltar
let _cachedContratos = null;
// (perf-fe-7) lembra entre montagens se o cache ja e o historico completo
let _cachedFull = false;

// (perf-fe-7) Janela padrao do fetch: so os ultimos N meses por created_at.
// A grande maioria dos numeros do dashboard ja e recortada por periodo, e o
// comparador/serie mensal usam poucos meses — 18 meses cobre tudo com folga.
// O historico completo (filtro "tudo" ou periodos antigos) e carregado sob
// demanda (botao "carregar tudo") ou automaticamente quando o filtro exige.
// (#306) Comparativo mês a mês (deltas dos KPIs + comparador de meses) é restrito
// aos sócios — mesma lista do Dashboard Sócios / App.jsx.
const SOCIOS_EMAILS = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com'];

const JANELA_MESES = 18;
function inicioJanela(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() - JANELA_MESES, 1);
}

// Select slim: só o que o dashboard usa. Inclui advbox_status/drive_file_id
// (antes faltavam e os KPIs de pendência contavam TODOS os assinados) e
// arquivado_em (para o recorte correto da carteira ativa).
const SELECT_COLS = [
  'id',
  'nome_contratante1',
  'resort',
  'tipo_acao',
  'honorarios_total',
  'honorarios_percentual_exito',
  'status',
  'created_at',
  'updated_at',
  'created_by',
  'signed_at',
  'advbox_date',
  'advbox_lawsuit_id',
  'advbox_status',
  'drive_file_id',
  'peticao_distribuida_em',
  'arquivado_em',
  'dpm:dados->>dataPrimeiraMensagem',
  'oc:dados->>origemCliente',
  // (R8) contratantes p/ o GeoHeatmap reusar estes dados em vez de fazer fetch proprio
  'contratantes_j:dados->contratantes',
].join(', ');

function horaCurta(date) {
  return date ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
}

export default function Dashboard() {
  const [allContratos, setAllContratos] = useState(_cachedContratos || []);
  const [videochamadas, setVideochamadas] = useState([]); // etapas do funil vindas da agenda (vw_funil_videochamadas)
  const [loading, setLoading] = useState(!_cachedContratos);
  const [refreshing, setRefreshing] = useState(false);
  // (perf-fe-7) true quando o fetch atual ja trouxe o historico completo (sem janela)
  const [fullLoaded, setFullLoaded] = useState(_cachedFull);
  const [error, setError] = useState('');
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [realtimeOk, setRealtimeOk] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showKpiModal, setShowKpiModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  // ─── Filtros persistidos (válidos para a página inteira) ───
  const [periodo, setPeriodo] = usePersistedFilter('dashboard', 'periodo', 'tudo');
  const [dataInicio, setDataInicio] = usePersistedFilter('dashboard', 'periodoInicio', '');
  const [dataFim, setDataFim] = usePersistedFilter('dashboard', 'periodoFim', '');
  const [resort, setResort] = usePersistedFilter('dashboard', 'resort', '');
  const [tipoAcao, setTipoAcao] = usePersistedFilter('dashboard', 'tipoAcao', '');
  const [incluirArquivados, setIncluirArquivados] = usePersistedFilter('dashboard', 'incluirArquivados', false);

  const { user } = useAuth() || {};
  const kpiPrefs = useKpiPreferences(user?.email || '');
  // (#306) Comparativo mês a mês só para sócios (Paulo e Bruno)
  const canCompare = SOCIOS_EMAILS.includes((user?.email || '').toLowerCase());

  // ─── Fetch ───
  // (perf-fe-7) full=true ignora a janela e traz o historico inteiro.
  // Conservador: aplicamos tambem um teto alto de linhas (.limit) para nunca
  // estourar a resposta — em produçao a carteira esta muito abaixo disso.
  const fetchContratos = useCallback(async ({ silent = false, full = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      let query = supabase
        .from('contratos')
        .select(SELECT_COLS)
        .order('created_at', { ascending: false })
        .limit(20000);
      if (!full) {
        // (#L9) janela por created_at OU signed_at OU advbox_date: um contrato criado ha
        // mais de JANELA_MESES mas ASSINADO recentemente precisa entrar — senao subconta
        // assinaturas/meta do mes corrente (que usam a data efetiva de assinatura).
        const ini = inicioJanela().toISOString();
        query = query.or(`created_at.gte.${ini},signed_at.gte.${ini},advbox_date.gte.${ini}`);
      }
      const { data, error: dbError } = await query;
      if (dbError) throw dbError;
      const normalizados = (data || []).map(normalizeContrato);
      // (etapa funil "Distribuídos") processo distribuído = tem nº de processo no ADVBOX,
      // da view vw_processo_distribuido. Merge por advbox_lawsuit_id (flag booleana).
      try {
        const { data: dist } = await supabase.from('vw_processo_distribuido').select('lawsuit_id');
        const distSet = new Set((dist || []).map((r) => String(r.lawsuit_id)));
        for (const c of normalizados) { if (c) c.distribuido = distSet.has(String(c.advbox_lawsuit_id)); }
      } catch { /* etapa Distribuídos degrada p/ 0 se a view falhar — não derruba o dashboard */ }
      // (etapa funil "Guia Paga/JEC") processo passou da citação no ADVBOX (guia paga ou JEC),
      // do espelho do bot (vw_processo_guia_paga). Merge por advbox_lawsuit_id.
      try {
        const { data: gp } = await supabase.from('vw_processo_guia_paga').select('lawsuit_id');
        const gpSet = new Set((gp || []).map((r) => String(r.lawsuit_id)));
        for (const c of normalizados) { if (c) c.guia_paga = gpSet.has(String(c.advbox_lawsuit_id)); }
      } catch { /* etapa Guia Paga degrada p/ 0 se a view falhar */ }
      // (etapas funil "Videochamada agendada/realizada") da agenda do Google, via view sem PII.
      try {
        const { data: vc } = await supabase.from('vw_funil_videochamadas').select('status, scheduled_at');
        setVideochamadas(vc || []);
      } catch { setVideochamadas([]); /* degrada p/ 0 se a view falhar */ }
      _cachedContratos = normalizados;
      _cachedFull = full;
      setAllContratos(normalizados);
      setFullLoaded(full);
      setLastFetchAt(new Date());
    } catch {
      setError('Erro ao carregar dados do dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // (perf-fe-7) Se o filtro ativo pede dados mais antigos que a janela
  // carregada (ou "tudo"/"ano"), precisamos do historico completo. Assim os
  // KPIs/totais nunca ficam errados por causa da janela — so paga o custo do
  // fetch grande quem realmente olha periodos antigos.
  const precisaHistoricoCompleto = useMemo(() => {
    if (periodo === 'tudo' || periodo === 'ano') return true;
    const { start } = resolvePeriodo(periodo, dataInicio, dataFim);
    // sem start definido (ex.: custom sem data inicial) = sem limite inferior
    if (!start) return true;
    return start.getTime() < inicioJanela().getTime();
  }, [periodo, dataInicio, dataFim]);

  // (perf-fe-7) Primeira carga: se o cache ja era completo OU o filtro
  // restaurado exige historico, busca full direto (sem blip de janela).
  // Caso contrario, so a janela — paint rapido para o caso recorte recente.
  const precisaRef = useRef(precisaHistoricoCompleto);
  precisaRef.current = precisaHistoricoCompleto;
  useEffect(() => {
    fetchContratos({ silent: !!_cachedContratos, full: _cachedFull || precisaRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchContratos]);

  // Mantém o cache do módulo em dia (inclusive com eventos realtime)
  useEffect(() => {
    if (allContratos.length > 0) _cachedContratos = allContratos;
  }, [allContratos]);

  // (perf-fe-7) Rede de seguranca em runtime: se o usuario muda o filtro para
  // um periodo antigo e ainda nao temos o historico, carrega tudo sob demanda.
  useEffect(() => {
    if (precisaHistoricoCompleto && !fullLoaded && !loading && !refreshing) {
      fetchContratos({ silent: true, full: true });
    }
  }, [precisaHistoricoCompleto, fullLoaded, loading, refreshing, fetchContratos]);

  // ─── Realtime (nome fixo do channel — não vaza conexão) ───
  // (perf-fe-12) Em picos de muitos eventos, cada um disparava um setState e,
  // por tabela, um recalculo pesado (computeDashboard). Agora os eventos sao
  // acumulados num buffer (ref) e aplicados em lote no maximo 1x/1500ms — um
  // unico setState por janela, um unico recalculo. Mantem a sensacao de tempo
  // real (latencia <=1,5s) sem travar a tela em rajadas.
  const rtBufferRef = useRef([]);
  const rtTimerRef = useRef(null);
  useEffect(() => {
    const RT_DEBOUNCE_MS = 1500;

    const flush = () => {
      rtTimerRef.current = null;
      const eventos = rtBufferRef.current;
      if (eventos.length === 0) return;
      rtBufferRef.current = [];
      // aplica todos os eventos da janela numa unica atualizacao de estado
      setAllContratos((prev) => {
        let lista = prev;
        for (const ev of eventos) {
          if (ev.type === 'INSERT' || ev.type === 'UPDATE') {
            const row = ev.row;
            if (lista.some((c) => c.id === row.id)) {
              lista = lista.map((c) => (c.id === row.id ? { ...c, ...row } : c));
            } else {
              lista = [row, ...lista];
            }
          } else if (ev.type === 'DELETE') {
            lista = lista.filter((c) => c.id !== ev.id);
          }
        }
        return lista;
      });
    };

    const schedule = () => {
      if (rtTimerRef.current) return; // ja ha um flush agendado nesta janela
      rtTimerRef.current = setTimeout(flush, RT_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel('dashboard-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contratos' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          rtBufferRef.current.push({ type: 'INSERT', row: normalizeContrato(payload.new) });
        } else if (payload.eventType === 'UPDATE') {
          rtBufferRef.current.push({ type: 'UPDATE', row: normalizeContrato(payload.new) });
        } else if (payload.eventType === 'DELETE') {
          rtBufferRef.current.push({ type: 'DELETE', id: payload.old.id });
        }
        schedule();
      })
      .subscribe((status) => setRealtimeOk(status === 'SUBSCRIBED'));
    return () => {
      if (rtTimerRef.current) { clearTimeout(rtTimerRef.current); rtTimerRef.current = null; }
      rtBufferRef.current = [];
      supabase.removeChannel(channel);
    };
  }, []);

  // ─── Cálculo central (memoizado — substitui o debounce de 250ms) ───
  const dash = useMemo(
    () => computeDashboard(
      allContratos,
      { periodo, dataInicio, dataFim, resort, tipoAcao, incluirArquivados, videochamadas },
      getMonthlyGoal()
    ),
    [allContratos, videochamadas, periodo, dataInicio, dataFim, resort, tipoAcao, incluirArquivados]
  );

  // ─── Celebração de meta mensal (deduplicada por mês dentro de celebrations) ───
  useEffect(() => {
    if (loading) return;
    const goal = getMonthlyGoal();
    if (dash.assinadosMes >= goal && dash.assinadosMes > 0) {
      celebrations.monthlyGoal(dash.assinadosMes, goal);
    }
  }, [dash.assinadosMes, loading]);

  // ─── Navegação entre abas (evento global já usado pelo VendasPanel) ───
  const navigate = useCallback((tab) => {
    window.dispatchEvent(new CustomEvent('cbc:switchTab', { detail: { tab } }));
  }, []);

  const clearFilters = useCallback(() => {
    setPeriodo('tudo');
    setDataInicio('');
    setDataFim('');
    setResort('');
    setTipoAcao('');
    setIncluirArquivados(false);
  }, [setPeriodo, setDataInicio, setDataFim, setResort, setTipoAcao, setIncluirArquivados]);

  // ─── Exportação respeita os filtros ativos (antes exportava tudo, sempre) ───
  const handleExportExcel = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { data, error: dbError } = await supabase
        .from('contratos')
        .select('id, nome_contratante1, cpf_contratante1, email_contratante1, nome_contratante2, cpf_contratante2, resort, tipo_acao, honorarios_total, honorarios_parcelas, honorarios_valor_parcela, honorarios_percentual_exito, data_primeira_parcela, status, created_by, zapsign_doc_token, created_at, signed_at, advbox_date, arquivado_em')
        .order('created_at', { ascending: false });
      if (dbError) throw dbError;
      const ids = new Set(dash.idsFiltrados);
      const rows = (data || []).filter((r) => ids.has(r.id));
      // (R7) inclui created_by; (R10) nome do arquivo leva o recorte exportado
      await exportContratosToExcel(rows, { periodoLabel: dash.scope.periodoLabel });
    } catch (err) {
      alert('Erro ao exportar: ' + (err?.message || err));
    } finally {
      setExporting(false);
    }
  }, [dash.idsFiltrados, dash.scope.periodoLabel, exporting]);

  // ─── Estados de carregamento / erro ───
  if (loading && allContratos.length === 0) return <SkeletonDashboard />;

  if (error && allContratos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--cbc-bg)' }}>
        <ErrorState
          icon={<ExclamationTriangleIcon className="w-8 h-8 text-amber-500" aria-hidden="true" />}
          title="Não foi possível carregar o dashboard"
          message="Verifique sua conexão com a internet."
          suggestion="Se o problema persistir, recarregue a página ou tente novamente."
          onRetry={() => { setError(''); fetchContratos(); }}
        />
      </div>
    );
  }

  const ativos = dash.scope.totalLinhas - dash.scope.arquivados;
  const escopoVazio = dash.total === 0;

  // ─── Staleness do badge de tempo real ───
  // (#contraste/staleness) "Ao vivo" verde só vale quando o realtime está OK e
  // a última atualização foi recente; passados ~5min sem refresh, sinalizamos
  // como desatualizado (warning) mesmo com o canal conectado — assim o ponto
  // verde piscando não dá falsa sensação de frescor.
  const STALE_MS = 5 * 60 * 1000;
  const minutosDesdeFetch = lastFetchAt ? Math.floor((Date.now() - lastFetchAt.getTime()) / 60000) : null;
  const stale = lastFetchAt ? (Date.now() - lastFetchAt.getTime()) > STALE_MS : false;
  const aoVivo = realtimeOk && !stale;
  const statusCor = aoVivo ? 'var(--cbc-success)' : 'var(--cbc-warning)';
  const statusLabel = aoVivo ? 'Ao vivo' : (realtimeOk ? 'Desatualizado' : 'Manual');
  const statusTitle = aoVivo
    ? 'Atualização automática em tempo real ativa'
    : (realtimeOk
        ? `Última atualização há ${minutosDesdeFetch} min — clique em recarregar para atualizar`
        : 'Tempo real indisponível — use o botão atualizar');

  return (
    <div className="p-4 md:p-6 space-y-3 md:space-y-4 overflow-y-auto h-full" style={{ background: 'var(--cbc-bg)' }}>
      {/* ─── Cabeçalho da página ─── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight" style={{ color: 'var(--cbc-text-primary)' }}>
            Dashboard
          </h1>
          <div className="text-[11px] md:text-xs mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>
            Carteira ativa: <strong style={{ color: 'var(--cbc-text-secondary)' }}>{ativos}</strong> contrato{ativos === 1 ? '' : 's'}
            {dash.scope.arquivados > 0 && <> · {dash.scope.arquivados} arquivado{dash.scope.arquivados === 1 ? '' : 's'} fora das métricas</>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full"
            style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}
            title={statusTitle}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${aoVivo ? 'animate-pulse' : ''}`}
              style={{ background: statusCor }}
            />
            <span style={{ color: statusCor }}>{statusLabel}</span>
            {lastFetchAt && <span className="font-normal tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>· {horaCurta(lastFetchAt)}</span>}
          </span>
          {/* (perf-fe-7) carrega o historico completo sob demanda (janela padrao = 18 meses) */}
          {!fullLoaded && (
            <button
              type="button"
              onClick={() => fetchContratos({ silent: true, full: true })}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
              style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}
              title={`Mostrando os últimos ${JANELA_MESES} meses. Carregar todo o histórico.`}
            >
              Carregar tudo
            </button>
          )}
          <button
            type="button"
            onClick={() => fetchContratos({ silent: true, full: fullLoaded })}
            disabled={refreshing}
            className="p-2 rounded-lg cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
            style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}
            title="Recarregar dados agora"
            aria-label="Recarregar dados"
          >
            <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting || escopoVazio}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-default"
            style={{ background: 'var(--cbc-accent)', color: 'var(--cbc-bg)' }}
            title="Exporta os contratos do escopo filtrado atual"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" aria-hidden="true" />
            {exporting ? 'Exportando…' : `Excel (${dash.total})`}
          </button>
          <button
            type="button"
            onClick={() => setShowPdfModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-all hover:opacity-90"
            style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border-strong, var(--cbc-border))', color: 'var(--cbc-text-secondary)' }}
            title="Gerar relatório PDF dos contratos assinados num intervalo de datas"
          >
            <DocumentArrowDownIcon className="w-3.5 h-3.5" aria-hidden="true" />
            PDF assinados
          </button>
        </div>
      </div>

      {/* ─── Filtros ─── */}
      <FilterBar
        periodo={periodo} setPeriodo={setPeriodo}
        dataInicio={dataInicio} setDataInicio={setDataInicio}
        dataFim={dataFim} setDataFim={setDataFim}
        resort={resort} setResort={setResort}
        tipoAcao={tipoAcao} setTipoAcao={setTipoAcao}
        incluirArquivados={incluirArquivados} setIncluirArquivados={setIncluirArquivados}
        opcoes={dash.filtros}
        arquivadosCount={dash.scope.arquivados}
        onClear={clearFilters}
      />

      {/* ─── Ação necessária (operacional — sempre carteira ativa de agora) ─── */}
      <SectionTitle hint="carteira ativa de agora · não segue os filtros">Ação necessária</SectionTitle>
      <ActionStrip acoes={dash.acoes} onNavigate={navigate} />

      {/* ─── KPIs ─── */}
      <div className="flex items-center justify-between gap-2 mt-2 px-0.5">
        <SectionTitle hint={`indicadores do escopo · "no mês" = ${dash.scope.mesLabel}`}>Indicadores</SectionTitle>
        <button
          type="button"
          onClick={() => setShowKpiModal(true)}
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1.5 rounded-lg cursor-pointer transition-colors shrink-0"
          style={{ color: 'var(--cbc-text-secondary)', background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}
          title="Escolher quais indicadores aparecem"
        >
          <Cog6ToothIcon className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden md:inline">Personalizar</span>
          <span
            className="px-1.5 py-0.5 rounded-full text-[9px] font-bold"
            style={{ background: 'rgba(201,168,76,0.15)', color: 'var(--cbc-accent)' }}
          >
            {kpiPrefs.selected.length}/{kpiPrefs.allKeys.length}
          </span>
        </button>
      </div>

      {/* (merge 26/06) Status atual + Assinaturas no período num card herói só. */}
      <StatusAssinaturasCard porStatus={dash.porStatus} kpiAssinados={dash.kpis.assinados_mes} canCompare={canCompare} delay={0} />

      {kpiPrefs.selected.length === 0 ? (
        <div className="rounded-xl p-6 text-center" style={{ background: 'var(--cbc-bg-card)', border: '2px dashed var(--cbc-border-strong)' }}>
          <Cog6ToothIcon className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--cbc-text-muted)' }} aria-hidden="true" />
          <div className="text-sm font-bold mb-1" style={{ color: 'var(--cbc-text-primary)' }}>Escolha seus indicadores</div>
          <div className="text-[11px] mb-3" style={{ color: 'var(--cbc-text-muted)' }}>
            Selecione os KPIs que você quer acompanhar no Dashboard.
          </div>
          <button
            type="button"
            onClick={() => setShowKpiModal(true)}
            className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer"
            style={{ background: 'var(--cbc-accent)', color: 'var(--cbc-bg)' }}
          >
            Configurar KPIs
          </button>
        </div>
      ) : (
        <>
          {/* (merge 26/06) o herói "assinados no mês" agora vive no card Status+Assinaturas
              acima; o grid segue filtrando essa key p/ não duplicar. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 md:gap-2.5">
            {kpiPrefs.selected.filter((k) => k !== 'assinados_mes').map((k, i) => {
              const item = dash.kpis[k];
              if (!item) return null;
              return <KpiCard key={k} kpiKey={k} item={item} delay={i * 35} canCompare={canCompare} />;
            })}
          </div>
        </>
      )}

      {escopoVazio ? (
        <EmptyScope onClear={clearFilters} />
      ) : (
        <>
          {/* ─── Pipeline ─── */}
          <SectionTitle hint={dash.scope.periodoLabel}>Pipeline de contratos</SectionTitle>
          {/* Funil largura total. O Status atual foi mesclado no card herói do topo (Indicadores). */}
          <FunnelCard funil={dash.funil} delay={40} />

          {/* (12/06) Comparador de meses — independe do filtro de período.
              (#306 · 20/06) Restrito aos sócios (Paulo e Bruno). */}
          {canCompare && <MonthComparator comparador={dash.comparador} delay={140} />}

          {/* ─── Desempenho ─── */}
          <SectionTitle hint="volume, conversão e receita por recorte">Desempenho</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <PerformanceList
              title="Resorts"
              subtitle={`${dash.resorts.length} resort${dash.resorts.length === 1 ? '' : 's'} no escopo`}
              items={dash.resorts}
              delay={40}
            />
            <PerformanceList
              title="Tipos de ação"
              subtitle={`${dash.tipos.length} tipo${dash.tipos.length === 1 ? '' : 's'} no escopo`}
              items={dash.tipos}
              delay={80}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <HonorariosCard honorarios={dash.honorarios} delay={40} />
            <TopMesCard top={dash.topResortsMes} mesLabel={dash.scope.mesLabel} delay={80} />
          </div>

          {/* ─── Prazos ─── */}
          <SectionTitle hint="datas de assinatura efetivas (signed_at → ADVBOX)">Prazos da jornada</SectionTitle>
          <JornadaCard jornada={dash.jornada} delay={40} />
          <DistribuicaoCard casos={dash.distCasos} delay={80} />

          {/* ─── Insights ─── */}
          <InsightsCard insights={dash.insights} delay={40} />

          {/* ─── Geografia & ritmo ─── */}
          <SectionTitle hint="origem dos clientes e horários de pico">Geografia & ritmo</SectionTitle>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            <Suspense fallback={<div className="text-center text-xs py-6" style={{ color: 'var(--cbc-text-muted)' }}>Carregando mapa…</div>}>
              {/* (R8) reusa os contratos ja carregados — sem fetch proprio */}
              <GeoHeatmap rows={allContratos} />
            </Suspense>
            <Suspense fallback={<div className="text-center text-xs py-6" style={{ color: 'var(--cbc-text-muted)' }}>Carregando heatmap…</div>}>
              <HeatmapTemporal contratos={allContratos} />
            </Suspense>
          </div>

          {/* ─── Recentes ─── */}
          <RecentContracts recentes={dash.recentes} onNavigate={navigate} delay={40} />
        </>
      )}

      <div className="pb-2" />

      {showKpiModal && (
        <KpiPreferencesModal
          selected={kpiPrefs.selected}
          onToggle={kpiPrefs.toggle}
          onReset={kpiPrefs.reset}
          onSelectAll={() => kpiPrefs.setMany(kpiPrefs.allKeys)}
          onClose={() => setShowKpiModal(false)}
        />
      )}

      {showPdfModal && (
        <Suspense fallback={null}>
          {(() => {
            // Pré-preenche o intervalo a partir do período ativo do Dashboard
            // (filtro de created_at) — o usuário pode ajustar livremente.
            const { start, end } = resolvePeriodo(periodo, dataInicio, dataFim);
            return (
              <RelatorioAssinadosModal
                initialStart={start}
                initialEnd={end}
                onClose={() => setShowPdfModal(false)}
              />
            );
          })()}
        </Suspense>
      )}
    </div>
  );
}
