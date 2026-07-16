// (aba Trafego 14/07/2026 · v2 16/07/2026) Trafego pago Meta — onda de 64 melhorias.
// Spec: docs/superpowers/specs/2026-07-14-aba-trafego-pago-design.md
// v2: layout full-width (margens do Dashboard), RH/vagas fora da captacao, metas e
// projecao, serie com CPL+MM7, donut, tabela ordenavel c/ lote, criativos completos
// (retencao/fadiga/previsao/piores/temas), conjuntos e breakdowns, comercial expandido
// (custos/taxas/ticket/origem/payback Asaas), resumo+recomendacoes+anomalias, alertas
// configuraveis c/ destinatarios, exports (xlsx/csv/pdf), desfazer, skeleton, mobile.
// Logica pura testada em trafego/compute.js; token Meta so no servidor.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { usePersistedFilter } from '../hooks/usePersistedFilters';
import {
  ArrowPathIcon, PauseCircleIcon, PlayCircleIcon, BanknotesIcon,
  ExclamationTriangleIcon, ArrowTopRightOnSquareIcon, BellAlertIcon,
  ArrowDownTrayIcon, LightBulbIcon, XMarkIcon, ChevronUpDownIcon,
} from '@heroicons/react/24/outline';
import {
  computeTrafego, computeComercialMensal, computeCurvaCriativo, computeTemas,
  montarResumoPeriodo, computeRecomendacoes, FREQ_SATURACAO,
} from './trafego/compute';
import { atualizarAgora, executarAcao } from './trafego/api';

const SERIF = "'Cormorant Garamond', Georgia, serif";
const TRAFEGO_ACAO_EMAILS = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com', 'lorenza@advocaciacbc.com'];
const BOLETO_PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'];

const fmtInt = (n) => (n || 0).toLocaleString('pt-BR');
const fmtBRL = (v, casas = 0) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas }));
const fmtPct = (v, casas = 1) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`);
const fmtMes = (ym) => (ym ? `${ym.slice(5)}/${ym.slice(2, 4)}` : '—');
const fmtNum = (v, casas = 2) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: casas }));

function diaStr(d) { return d.toISOString().slice(0, 10); }
function hojeBrt() { return new Date(Date.now() - 3 * 3600 * 1000); }

const PERIODOS = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'ontem', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
  { key: '14d', label: '14 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'mes', label: 'Mês atual' },
  { key: 'mes_passado', label: 'Mês passado' },
  { key: 'custom', label: 'Período livre' },
];

function rangeDoPeriodo(key, customIni, customFim) {
  const hoje = hojeBrt();
  const fim = diaStr(hoje);
  if (key === 'custom' && customIni && customFim) return { inicio: customIni, fim: customFim };
  if (key === 'hoje') return { inicio: fim, fim };
  if (key === 'ontem') { const o = diaStr(new Date(hoje.getTime() - 86400000)); return { inicio: o, fim: o }; }
  if (key === 'mes') return { inicio: `${fim.slice(0, 7)}-01`, fim };
  if (key === 'mes_passado') {
    const m = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
    const ultimo = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 0));
    return { inicio: diaStr(m), fim: diaStr(ultimo) };
  }
  const dias = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[key] || 7;
  return { inicio: diaStr(new Date(hoje.getTime() - (dias - 1) * 86400000)), fim };
}

function DeltaBadge({ valor, invertido = false }) {
  if (valor == null) return null;
  const bom = invertido ? valor < 0 : valor > 0;
  const cor = valor === 0 ? 'var(--cbc-text-muted, #6B7280)' : bom ? 'var(--cbc-success, #16A34A)' : 'var(--cbc-danger, #DC2626)';
  return (
    <span className="text-[11px] font-bold tabular-nums" style={{ color: cor }}>
      {valor > 0 ? '▲' : '▼'} {Math.abs(valor).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
    </span>
  );
}

function KpiCard({ label, valor, delta, invertido, hint, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`rounded-2xl p-3.5 flex flex-col gap-0.5 text-left ${onClick ? 'cursor-pointer btn-press' : 'cursor-default'}`}
      style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
      <span className="text-[10px] font-bold uppercase tracking-[1.2px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>{label}</span>
      <span className="leading-none tabular-nums" style={{ fontFamily: SERIF, fontSize: '1.75rem', fontWeight: 700, color: 'var(--cbc-text-primary, #1B3A5C)' }}>{valor}</span>
      <span className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
        <DeltaBadge valor={delta} invertido={invertido} />{hint}
      </span>
    </button>
  );
}

/** Grafico diario v2: barras leads + MM7 tracejada + linhas gasto e CPL (escalas proprias). */
function SerieChart({ serie }) {
  if (!serie.length) return <div className="text-[12px] py-6 text-center" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Sem dados no período.</div>;
  const W = 1000; const H = 190; const pad = 8;
  const maxLeads = Math.max(...serie.map((s) => s.leads), ...serie.map((s) => s.mm7 || 0), 1);
  const maxGasto = Math.max(...serie.map((s) => s.gasto), 1);
  const maxCpl = Math.max(...serie.map((s) => s.cpl || 0), 1);
  const bw = (W - pad * 2) / serie.length;
  const y = (v, max) => H - 22 - (v / max) * (H - 44);
  const linha = (get, max) => serie.map((s, i) => (get(s) == null ? null : `${pad + i * bw + bw / 2},${y(get(s), max)}`)).filter(Boolean).join(' ');
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 620 }} role="img" aria-label="Leads, gasto e CPL por dia">
        {serie.map((s, i) => (
          <rect key={s.dia} x={pad + i * bw + 2} y={y(s.leads, maxLeads)} width={Math.max(bw - 4, 2)} height={H - 22 - y(s.leads, maxLeads)} rx="2"
            fill="var(--cbc-gold, #C9A84C)" opacity="0.8">
            <title>{`${s.dia.slice(8)}/${s.dia.slice(5, 7)}: ${s.leads} leads · ${fmtBRL(s.gasto)} · CPL ${fmtBRL(s.cpl, 2)} · MM7 ${fmtNum(s.mm7, 1)}`}</title>
          </rect>
        ))}
        <polyline points={linha((s) => s.mm7, maxLeads)} fill="none" stroke="var(--cbc-gold-dark, #B8860B)" strokeWidth="2" strokeDasharray="5,4" opacity="0.95" />
        <polyline points={linha((s) => s.gasto, maxGasto)} fill="none" stroke="var(--cbc-navy-light, #264A72)" strokeWidth="2" opacity="0.9" />
        <polyline points={linha((s) => s.cpl, maxCpl)} fill="none" stroke="var(--cbc-danger, #DC2626)" strokeWidth="1.6" opacity="0.75" />
        {serie.map((s, i) => (serie.length <= 31 || i % 7 === 0) && (
          <text key={`t${s.dia}`} x={pad + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--cbc-text-muted, #9CA3AF)">{s.dia.slice(8)}</text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 text-[10px] pt-1" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1" style={{ background: 'var(--cbc-gold, #C9A84C)' }} />Leads/dia</span>
        <span><span className="inline-block w-4 h-0.5 align-middle mr-1 border-t-2 border-dashed" style={{ borderColor: 'var(--cbc-gold-dark, #B8860B)' }} />Média móvel 7d</span>
        <span><span className="inline-block w-4 h-0.5 align-middle mr-1" style={{ background: 'var(--cbc-navy-light, #264A72)' }} />Gasto</span>
        <span><span className="inline-block w-4 h-0.5 align-middle mr-1" style={{ background: 'var(--cbc-danger, #DC2626)' }} />CPL</span>
      </div>
    </div>
  );
}

/** (v2 #29) Donut de gasto por campanha. */
function Donut({ dados }) {
  const total = dados.reduce((s, d) => s + d.gasto, 0);
  if (!total) return null;
  const CORES = ['var(--cbc-navy, #1B3A5C)', 'var(--cbc-gold, #C9A84C)', 'var(--cbc-navy-light, #264A72)', 'var(--cbc-gold-dark, #B8860B)', 'var(--cbc-info, #2563EB)', 'var(--cbc-success, #16A34A)', 'var(--cbc-text-muted, #9CA3AF)'];
  const R = 40; const C = 2 * Math.PI * R;
  const fatias = dados.reduce((acc, d) => {
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].frac : 0;
    acc.push({ d, frac: d.gasto / total, offset });
    return acc;
  }, []);
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0" role="img" aria-label="Gasto por campanha">
        {fatias.map(({ d, frac, offset }, i) => (
          <circle key={d.campaign_id} cx="50" cy="50" r={R} fill="none" stroke={CORES[i % CORES.length]} strokeWidth="16"
            strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-offset * C} transform="rotate(-90 50 50)">
            <title>{`${d.nome}: ${fmtBRL(d.gasto)} (${Math.round(frac * 100)}%)`}</title>
          </circle>
        ))}
      </svg>
      <ul className="text-[11px] space-y-1 min-w-0">
        {dados.map((d, i) => (
          <li key={d.campaign_id} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CORES[i % CORES.length] }} />
            <span className="truncate" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{d.nome}</span>
            <span className="tabular-nums shrink-0" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{Math.round((d.gasto / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SecTitle({ children, extra }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-[11px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>{children}</div>
      {extra}
    </div>
  );
}

const RANKING_TABS = [
  { key: 'ctr', label: 'Top CTR' },
  { key: 'cpl', label: 'Melhor CPL' },
  { key: 'leads', label: 'Mais leads' },
  { key: 'hook', label: 'Hook rate' },
  { key: 'piores', label: 'Piores' },
  { key: 'todos', label: 'Ver todos' },
];

const COLS_CAMPANHA = [
  { key: 'nome', label: 'Campanha', right: false },
  { key: 'status', label: 'Status', right: false },
  { key: 'orcamento_diario', label: 'Orç./dia', right: true },
  { key: 'gasto', label: 'Gasto', right: true },
  { key: 'leads', label: 'Leads', right: true },
  { key: 'leadsHoje', label: 'Hoje', right: true },
  { key: 'cpl', label: 'CPL', right: true },
  { key: 'ctr', label: 'CTR', right: true },
  { key: 'cpm', label: 'CPM', right: true },
  { key: 'tendencia7d', label: '7d', right: true },
];

export default function TrafegoPanel() {
  const { user } = useAuth() || {};
  const podeOperar = TRAFEGO_ACAO_EMAILS.includes((user?.email || '').toLowerCase());

  // (v2 #81/#142) periodo e ranking persistidos por usuario
  const [periodo, setPeriodo] = usePersistedFilter('trafego', 'periodo', '7d');
  const [rankTab, setRankTab] = usePersistedFilter('trafego', 'rankTab', 'ctr');
  const [customIni, setCustomIni] = usePersistedFilter('trafego', 'customIni', '');
  const [customFim, setCustomFim] = usePersistedFilter('trafego', 'customFim', '');
  const [cmpAtivo, setCmpAtivo] = useState(false);
  const [cmpIni, setCmpIni] = useState('');
  const [cmpFim, setCmpFim] = useState('');

  const [campanhas, setCampanhas] = useState([]);
  const [anuncios, setAnuncios] = useState([]);
  const [conjuntos, setConjuntos] = useState([]);
  const [diario, setDiario] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [mensal, setMensal] = useState([]);
  const [videochamadas, setVideochamadas] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [boletosPagos, setBoletosPagos] = useState([]);
  const [alertCfg, setAlertCfg] = useState(null);
  const [metas, setMetas] = useState({});
  const [ultimoSync, setUltimoSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [undo, setUndo] = useState(null); // (v2 #112) { texto, payload }
  const [mostrarRh, setMostrarRh] = useState(false);
  const [sort, setSort] = useState({ key: 'gasto', asc: false });
  const [filtroCampanhaCriativo, setFiltroCampanhaCriativo] = useState('');
  const [buscaCriativo, setBuscaCriativo] = useState('');
  const [verTodosLimite, setVerTodosLimite] = useState(24);
  const [criativoAberto, setCriativoAberto] = useState(null);
  const [selecionadas, setSelecionadas] = useState(new Set()); // (v2 #115)
  const [modalOrcamento, setModalOrcamento] = useState(null);
  const [valorOrcamento, setValorOrcamento] = useState('');
  const [confirmacao, setConfirmacao] = useState(null);
  const [executando, setExecutando] = useState(false);
  const pullRef = useRef({ y: 0, ativo: false });

  const logLento = useCallback(async (ms) => {
    // (v2 #199) fetch lento vira aviso no console do Monitor
    try { await supabase.from('advbox_api_log').insert({ origem: 'meta', nivel: 'aviso', mensagem: `aba Trafego: carregamento lento (${(ms / 1000).toFixed(1)}s)`, contexto: { ms } }); } catch { /* silencioso */ }
  }, []);

  const fetchData = useCallback(async () => {
    setErr('');
    const t0 = performance.now();
    try {
      const corte = diaStr(new Date(Date.now() - 200 * 86400000));
      const pagina = async (query) => {
        const out = [];
        for (let de = 0; de < 30000; de += 1000) {
          const { data, error } = await query.range(de, de + 999);
          if (error) throw error;
          out.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        return out;
      };
      const buscarDiario = () => pagina(
        supabase.from('meta_ads_diario')
          .select('dia, level, entity_id, campaign_id, gasto, conversas_iniciadas, leads_form, impressoes, alcance, cliques, cliques_link, frequencia, video_3s, video_thruplay, video_p25, video_p50, video_p75, video_p100, synced_at')
          .gte('dia', corte)
          .order('dia', { ascending: true }).order('level', { ascending: true }).order('entity_id', { ascending: true })
      );
      const buscarBreakdown = () => pagina(
        supabase.from('meta_ads_breakdown')
          .select('dia, tipo, chave, gasto, conversas_iniciadas, leads_form, impressoes, cliques_link')
          .gte('dia', corte)
          .order('dia', { ascending: true }).order('tipo', { ascending: true }).order('chave', { ascending: true })
      );
      // (v2 #91) boletos pagos p/ payback (paginado; so colunas necessarias)
      const buscarBoletos = () => pagina(
        supabase.from('asaas_boletos')
          .select('customer_cpf, value, status')
          .in('status', BOLETO_PAGO)
          .order('id', { ascending: true })
      );
      const [camp, ads, sets, dia2, bd, men, vc, ctr, cfg, bol] = await Promise.all([
        supabase.from('meta_campanhas').select('*').order('nome'),
        supabase.from('meta_anuncios').select('ad_id, campaign_id, nome, status, thumbnail_url, permalink'),
        supabase.from('meta_conjuntos').select('adset_id, campaign_id, nome, status, orcamento_diario'),
        buscarDiario(),
        buscarBreakdown(),
        supabase.from('meta_ads_mensal').select('mes, conversas_iniciadas, leads_form, gasto'),
        supabase.from('vw_funil_videochamadas').select('status, scheduled_at'),
        supabase.from('contratos').select("id, status, zapsign_sent_at, signed_at, advbox_date, updated_at, arquivado_em, honorarios_total, cpf_contratante1, origem:dados->>origemCliente").order('created_at', { ascending: false }).limit(20000),
        supabase.from('bot_config').select('value').eq('key', 'meta_trafego').maybeSingle(),
        buscarBoletos(),
      ]);
      setCampanhas(camp.data || []);
      setAnuncios(ads.data || []);
      setConjuntos(sets.data || []);
      setDiario(dia2);
      setBreakdown(bd);
      setMensal(men.data || []);
      setVideochamadas(vc.data || []);
      setContratos((ctr.data || []).map((c) => ({ ...c, cpf: c.cpf_contratante1 })));
      setBoletosPagos(bol.map((b) => ({ cpf: b.customer_cpf, valor: b.value })));
      setAlertCfg({ ativo: true, cpl_mult: 2, cpl_gasto_min_dia: 100, queda_leads_pct: 50, freq_alta: 3, gasto_sem_lead_min: 150, ...(cfg.data?.value?.alertas || {}) });
      setMetas(cfg.data?.value?.metas || {});
      setUltimoSync(dia2.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), '') || null);
      const ms = performance.now() - t0;
      if (ms > 5000) logLento(ms);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
      try { Sentry.captureException(e, { tags: { aba: 'trafego' } }); } catch { /* sem sentry */ }
    } finally {
      setLoading(false);
    }
  }, [logLento]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hoje = diaStr(hojeBrt());
  const range = useMemo(() => rangeDoPeriodo(periodo, customIni, customFim), [periodo, customIni, customFim]);
  const comparar = useMemo(() => (cmpAtivo && cmpIni && cmpFim ? { inicio: cmpIni, fim: cmpFim } : null), [cmpAtivo, cmpIni, cmpFim]);

  const t = useMemo(
    () => computeTrafego({ diario, campanhas, anuncios, conjuntos, inicio: range.inicio, fim: range.fim, hoje, metas, comparar }),
    [diario, campanhas, anuncios, conjuntos, range, hoje, metas, comparar]
  );
  const comercial = useMemo(
    () => computeComercialMensal({ mensal, videochamadas, contratos, boletosPagos, meses: 6 }),
    [mensal, videochamadas, contratos, boletosPagos]
  );
  const resumo = useMemo(() => montarResumoPeriodo(t), [t]);
  const recs = useMemo(() => computeRecomendacoes(t), [t]);
  const temas = useMemo(() => computeTemas(t.criativos), [t]);

  // (v2 #124-127) breakdowns agregados no periodo
  const bdAgg = useMemo(() => {
    const out = { age_gender: {}, region: {}, platform_position: {} };
    for (const r of breakdown) {
      if (r.dia < range.inicio || r.dia > range.fim) continue;
      const g = (out[r.tipo][r.chave] = out[r.tipo][r.chave] || { chave: r.chave, gasto: 0, leads: 0, impressoes: 0 });
      g.gasto += Number(r.gasto) || 0;
      g.leads += (Number(r.conversas_iniciadas) || 0) + (Number(r.leads_form) || 0);
      g.impressoes += Number(r.impressoes) || 0;
    }
    const lista = (tipo) => Object.values(out[tipo]).map((g) => ({ ...g, cpl: g.leads > 0 ? g.gasto / g.leads : null })).sort((a, b) => b.leads - a.leads);
    const pos = lista('platform_position');
    const cplMedio = pos.length ? pos.reduce((s, p) => s + p.gasto, 0) / Math.max(pos.reduce((s, p) => s + p.leads, 0), 1) : null;
    return {
      idade: lista('age_gender').slice(0, 10),
      regiao: lista('region').slice(0, 10),
      posicao: pos.slice(0, 10).map((p) => ({ ...p, caro: p.cpl != null && cplMedio != null && p.gasto >= 50 && p.cpl > 1.5 * cplMedio })),
    };
  }, [breakdown, range]);

  // tabela de campanhas: sort (v2 #31) + grupo RH
  const campanhasOrdenadas = useMemo(() => {
    const arr = t.campanhas.filter((c) => (mostrarRh ? true : !c.rh) && (c.status === 'ACTIVE' || c.gasto > 0 || mostrarRh));
    const dir = sort.asc ? 1 : -1;
    return [...arr].sort((a, b) => {
      if (a.rh !== b.rh) return a.rh ? 1 : -1;
      const va = a[sort.key]; const vb = b[sort.key];
      if (typeof va === 'string' || typeof vb === 'string') return dir * String(va || '').localeCompare(String(vb || ''), 'pt-BR');
      return dir * ((va ?? -Infinity) - (vb ?? -Infinity));
    });
  }, [t.campanhas, mostrarRh, sort]);

  const criativosFiltrados = useMemo(() => {
    let base = rankTab === 'todos' ? t.criativos.filter((c) => c.impressoes > 0) : t.rankings[rankTab] || [];
    if (filtroCampanhaCriativo) base = base.filter((c) => c.campaign_id === filtroCampanhaCriativo);
    if (buscaCriativo) base = base.filter((c) => (c.nome || '').toLowerCase().includes(buscaCriativo.toLowerCase()));
    return rankTab === 'todos' ? base.slice(0, verTodosLimite) : base;
  }, [t, rankTab, filtroCampanhaCriativo, buscaCriativo, verTodosLimite]);

  const handleAtualizar = useCallback(async () => {
    setRefreshing(true); setMsg('');
    try {
      const r = await atualizarAgora();
      setMsg(`Atualizado: ${r.diario} linha(s) do dia sincronizadas.`);
      await fetchData();
    } catch (e) { setErr(`Atualizar falhou: ${e.message}`); }
    finally { setRefreshing(false); setTimeout(() => setMsg(''), 5000); }
  }, [fetchData]);

  // (v2 #149) pull-to-refresh no mobile
  const onTouchStart = (e) => { const el = e.currentTarget; pullRef.current = { y: e.touches[0].clientY, ativo: el.scrollTop <= 0 }; };
  const onTouchEnd = (e) => {
    if (!pullRef.current.ativo || refreshing) return;
    const dy = (e.changedTouches?.[0]?.clientY || 0) - pullRef.current.y;
    if (dy > 90) handleAtualizar();
  };

  const executa = async (payload, undoInfo) => {
    setExecutando(true); setErr('');
    try {
      await executarAcao(payload);
      setMsg('Feito.');
      if (undoInfo) setUndo(undoInfo);
      setConfirmacao(null); setModalOrcamento(null); setSelecionadas(new Set());
      await fetchData();
    } catch (e) { setErr(`Ação falhou: ${e.message}`); }
    finally { setExecutando(false); setTimeout(() => setMsg(''), 6000); }
  };

  const handleAcao = async () => {
    if (!confirmacao) return;
    const { acao, campanha, valor, lote } = confirmacao;
    if (lote) {
      // (v2 #115) pausar em lote — sequencial, com auditoria individual
      setExecutando(true); setErr('');
      try {
        for (const c of lote) await executarAcao({ acao: 'pausar', campaign_id: c.campaign_id });
        setMsg(`${lote.length} campanha(s) pausada(s).`);
        setUndo({ texto: `Pausou ${lote.length} campanha(s)`, desfazer: lote.map((c) => ({ acao: 'reativar', campaign_id: c.campaign_id })) });
        setConfirmacao(null); setSelecionadas(new Set());
        await fetchData();
      } catch (e) { setErr(`Lote falhou: ${e.message}`); }
      finally { setExecutando(false); }
      return;
    }
    const undoInfo = acao === 'pausar'
      ? { texto: `Pausou "${campanha.nome}"`, desfazer: [{ acao: 'reativar', campaign_id: campanha.campaign_id }] }
      : acao === 'reativar'
        ? { texto: `Reativou "${campanha.nome}"`, desfazer: [{ acao: 'pausar', campaign_id: campanha.campaign_id }] }
        : acao === 'orcamento' && campanha.orcamento_diario
          ? { texto: `Orçamento de "${campanha.nome}" → ${fmtBRL(valor)}`, desfazer: [{ acao: 'orcamento', campaign_id: campanha.campaign_id, valor: campanha.orcamento_diario }] }
          : null;
    await executa({ acao, campaign_id: campanha.campaign_id, valor }, undoInfo);
  };

  const desfazer = async () => {
    if (!undo) return;
    const passos = undo.desfazer;
    setUndo(null);
    setExecutando(true);
    try {
      for (const p of passos) await executarAcao(p);
      setMsg('Desfeito.');
      await fetchData();
    } catch (e) { setErr(`Desfazer falhou: ${e.message}`); }
    finally { setExecutando(false); }
  };

  const salvarConfig = async (patch) => {
    setExecutando(true); setErr('');
    try {
      const r = await executarAcao({ acao: 'config', ...patch });
      if (r.alertas) setAlertCfg(r.alertas);
      if (r.metas) setMetas(r.metas);
      setMsg('Configuração salva.');
    } catch (e) { setErr(`Salvar falhou: ${e.message}`); }
    finally { setExecutando(false); setTimeout(() => setMsg(''), 5000); }
  };

  // (v2 #168/#169/#170) exports
  const exportarExcel = async () => {
    const XLSX = await import('xlsx');
    const linhas = campanhasOrdenadas.map((c) => ({
      Campanha: c.nome, Status: c.status, RH: c.rh ? 'sim' : '', 'Orçamento/dia': c.orcamento_diario,
      Gasto: c.gasto, Leads: c.leads, CPL: c.cpl, 'CTR %': c.ctr, CPM: c.cpm, 'Tendência 7d %': c.tendencia7d,
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Campanhas');
    XLSX.writeFile(wb, `trafego_campanhas_${range.inicio}_a_${range.fim}.xlsx`);
  };
  const exportarCsv = () => {
    const rows = diario.filter((r) => r.dia >= range.inicio && r.dia <= range.fim);
    const head = 'dia;level;entity_id;campaign_id;gasto;leads;impressoes;cliques_link;frequencia;video_3s';
    const body = rows.map((r) => [r.dia, r.level, r.entity_id, r.campaign_id, r.gasto, (r.conversas_iniciadas || 0) + (r.leads_form || 0), r.impressoes, r.cliques_link, r.frequencia ?? '', r.video_3s].join(';')).join('\n');
    const blob = new Blob([`${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trafego_diario_${range.inicio}_a_${range.fim}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportarPdf = async () => {
    const { downloadPdf } = await import('../utils/pdfGenerator');
    const k = t.kpis;
    const html = `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif; color:#1B3A5C; padding:8px 4px;">
        <div style="font-size:9pt; letter-spacing:1.5px; color:#718096;">CONFORTO, BERGONSI &amp; CAVALARI — TRÁFEGO PAGO</div>
        <h1 style="font-family:Georgia,serif; font-size:20pt; margin:6px 0 2px;">Relatório de Tráfego</h1>
        <div style="font-size:10pt; color:#5A6A85; margin-bottom:14px;">Período ${range.inicio.split('-').reverse().join('/')} a ${range.fim.split('-').reverse().join('/')} · conta CA - CBC Distratos</div>
        <table style="width:100%; border-collapse:collapse; margin-bottom:12px;">
          <tr>${[['Investido', fmtBRL(k.gasto)], ['Leads', fmtInt(k.leads)], ['CPL', fmtBRL(k.cpl, 2)], ['CTR', fmtPct(k.ctr, 2)], ['CPM', fmtBRL(k.cpm, 2)]].map(([l, v]) => `<td style="border:1px solid #E2E8F0; padding:8px 10px; text-align:center;"><div style="font-size:8pt; color:#5A6A85; text-transform:uppercase;">${l}</div><div style="font-size:14pt; font-weight:bold;">${v}</div></td>`).join('')}</tr>
        </table>
        <p style="font-size:10.5pt; line-height:1.6;">${resumo}</p>
        <h2 style="font-size:12pt; margin:14px 0 6px;">Campanhas (captação)</h2>
        <table style="width:100%; border-collapse:collapse; font-size:9.5pt;">
          <tr style="background:#F2F4F8;">${['Campanha', 'Gasto', 'Leads', 'CPL', 'CTR'].map((h) => `<th style="border:1px solid #E2E8F0; padding:5px 8px; text-align:left;">${h}</th>`).join('')}</tr>
          ${t.campanhas.filter((c) => !c.rh && c.gasto > 0).slice(0, 12).map((c) => `<tr>${[c.nome, fmtBRL(c.gasto), fmtInt(c.leads), fmtBRL(c.cpl, 2), fmtPct(c.ctr, 2)].map((v, i) => `<td style="border:1px solid #E2E8F0; padding:4px 8px; ${i > 0 ? 'text-align:right;' : ''}">${v}</td>`).join('')}</tr>`).join('')}
        </table>
        ${recs.length ? `<h2 style="font-size:12pt; margin:14px 0 6px;">Recomendações</h2><ul style="font-size:10pt; line-height:1.5;">${recs.slice(0, 6).map((r) => `<li>${r.texto}</li>`).join('')}</ul>` : ''}
        <div style="font-size:8pt; color:#9CA3AF; margin-top:16px;">Gerado pela aba Tráfego do CBC Contratos. Campanhas de vaga (RH) fora dos números de captação.</div>
      </div>`;
    await downloadPdf(html, `relatorio_trafego_${range.fim}.pdf`);
  };

  const scrollPara = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // (v2 #141) skeleton
  if (loading) {
    return (
      <div className="h-full overflow-y-auto" style={{ background: 'var(--cbc-bg, #F0F4F8)' }}>
        <div className="p-3 md:p-5 space-y-4">
          <div className="skeleton h-9 w-72 rounded-xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
          </div>
          <div className="skeleton h-52 rounded-3xl" />
          <div className="skeleton h-72 rounded-3xl" />
        </div>
      </div>
    );
  }

  const semDados = !diario.length;
  const chipStyle = (ativo) => (ativo
    ? { background: 'var(--cbc-navy, #1B3A5C)', color: '#fff', boxShadow: '0 2px 8px -2px rgba(15,32,53,.5)' }
    : { background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-primary, #1B3A5C)' });

  return (
    <div className="h-full overflow-y-auto page-enter tabular-nums" style={{ background: 'var(--cbc-bg, #F0F4F8)' }}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* (v2) full-width com margens pequenas, como o Dashboard */}
      <div className="p-3 md:p-5 space-y-4">

        {/* Cabecalho */}
        <header className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 style={{ fontFamily: SERIF, fontSize: '2.2rem', fontWeight: 700, lineHeight: 1, color: 'var(--cbc-text-primary, #1B3A5C)' }}>Tráfego</h1>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              CA - CBC Distratos · {ultimoSync ? `último sync ${new Date(ultimoSync).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'aguardando 1º sync'} · vagas/RH fora da captação
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {PERIODOS.map((p) => (
              <button key={p.key} onClick={() => setPeriodo(p.key)}
                className="px-2.5 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wide cursor-pointer transition-all btn-press"
                style={chipStyle(periodo === p.key)}>
                {p.label}
              </button>
            ))}
            <button onClick={handleAtualizar} disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wide cursor-pointer transition-all btn-press"
              style={{ background: 'var(--cbc-gold, #C9A84C)', color: '#1B3A5C' }}>
              <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" /> Atualizar
            </button>
            <div className="flex items-center gap-1">
              <button onClick={exportarExcel} title="Exportar campanhas (Excel)" aria-label="Exportar campanhas em Excel" className="p-1.5 rounded-lg cursor-pointer btn-press" style={{ border: '1px solid var(--cbc-border, #E5E7EB)', background: 'var(--cbc-bg-card, #fff)' }}>
                <ArrowDownTrayIcon className="w-4 h-4" style={{ color: 'var(--cbc-success, #16A34A)' }} aria-hidden="true" />
              </button>
              <button onClick={exportarCsv} title="Exportar diário bruto (CSV)" aria-label="Exportar diário em CSV" className="px-2 py-1.5 rounded-lg cursor-pointer btn-press text-[10px] font-bold" style={{ border: '1px solid var(--cbc-border, #E5E7EB)', background: 'var(--cbc-bg-card, #fff)', color: 'var(--cbc-text-muted, #6B7280)' }}>CSV</button>
              <button onClick={exportarPdf} title="Relatório executivo (PDF)" aria-label="Gerar relatório PDF" className="px-2 py-1.5 rounded-lg cursor-pointer btn-press text-[10px] font-bold" style={{ border: '1px solid var(--cbc-border, #E5E7EB)', background: 'var(--cbc-bg-card, #fff)', color: 'var(--cbc-text-muted, #6B7280)' }}>PDF</button>
            </div>
          </div>
        </header>

        {/* (v2 #78/#80) periodo livre + comparacao custom */}
        {(periodo === 'custom' || cmpAtivo) && (
          <div className="flex items-end gap-3 flex-wrap rounded-2xl p-3" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
            {periodo === 'custom' && (
              <>
                <label className="flex flex-col gap-1 text-[10.5px] font-bold uppercase" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  De<input type="date" className="input-field" value={customIni} onChange={(e) => setCustomIni(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-[10.5px] font-bold uppercase" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  Até<input type="date" className="input-field" value={customFim} onChange={(e) => setCustomFim(e.target.value)} />
                </label>
              </>
            )}
            <label className="flex items-center gap-2 text-[11px] font-semibold cursor-pointer pb-2" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
              <input type="checkbox" checked={cmpAtivo} onChange={(e) => setCmpAtivo(e.target.checked)} /> Comparar com período específico
            </label>
            {cmpAtivo && (
              <>
                <label className="flex flex-col gap-1 text-[10.5px] font-bold uppercase" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  De<input type="date" className="input-field" value={cmpIni} onChange={(e) => setCmpIni(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-[10.5px] font-bold uppercase" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  Até<input type="date" className="input-field" value={cmpFim} onChange={(e) => setCmpFim(e.target.value)} />
                </label>
              </>
            )}
          </div>
        )}

        {(err || msg) && (
          <div className="rounded-xl px-4 py-2.5 text-[13px] font-semibold"
            style={err
              ? { background: 'color-mix(in srgb, var(--cbc-danger, #DC2626) 10%, transparent)', color: 'var(--cbc-danger, #DC2626)' }
              : { background: 'color-mix(in srgb, var(--cbc-success, #16A34A) 10%, transparent)', color: 'var(--cbc-success, #15803D)' }}>
            {err || msg}
          </div>
        )}

        {/* (v2 #112) desfazer */}
        {undo && (
          <div className="rounded-xl px-4 py-2.5 text-[13px] font-semibold flex items-center justify-between gap-3"
            style={{ background: 'color-mix(in srgb, var(--cbc-info, #2563EB) 10%, transparent)', color: 'var(--cbc-info, #2563EB)' }}>
            <span>{undo.texto}.</span>
            <span className="flex items-center gap-2">
              <button onClick={desfazer} disabled={executando} className="px-3 py-1 rounded-lg font-bold uppercase text-[11px] cursor-pointer btn-press" style={{ background: 'var(--cbc-info, #2563EB)', color: '#fff' }}>Desfazer</button>
              <button onClick={() => setUndo(null)} aria-label="Fechar" className="cursor-pointer"><XMarkIcon className="w-4 h-4" aria-hidden="true" /></button>
            </span>
          </div>
        )}

        {semDados && (
          <div className="rounded-2xl p-6 text-[13px]" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-muted, #6B7280)' }}>
            Ainda não há métricas no espelho. Clique em <strong>Atualizar</strong> — o histórico completo chega com o backfill/cron diário.
          </div>
        )}

        {/* KPIs (clicaveis) */}
        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          <KpiCard label="Investido" valor={fmtBRL(t.kpis.gasto)} delta={t.kpis.delta.gasto} hint="vs anterior" onClick={() => scrollPara('sec-serie')} />
          <KpiCard label="Leads" valor={fmtInt(t.kpis.leads)} delta={t.kpis.delta.leads} hint={t.kpis.leadsHoje != null ? `${t.kpis.leadsHoje} hoje` : ''} onClick={() => scrollPara('sec-serie')} />
          <KpiCard label="CPL" valor={fmtBRL(t.kpis.cpl, 2)} delta={t.kpis.delta.cpl} invertido hint="custo por lead" onClick={() => scrollPara('sec-campanhas')} />
          <KpiCard label="CTR" valor={fmtPct(t.kpis.ctr, 2)} delta={t.kpis.delta.ctr} hint="cliques no link" onClick={() => scrollPara('sec-criativos')} />
          <KpiCard label="CPM" valor={fmtBRL(t.kpis.cpm, 2)} delta={t.kpis.delta.cpm} invertido hint="mil impressões" onClick={() => scrollPara('sec-criativos')} />
          <KpiCard label="CPC link" valor={fmtBRL(t.kpis.cpc, 2)} hint="por clique" onClick={() => scrollPara('sec-criativos')} />
          <KpiCard label="Frequência" valor={fmtNum(t.kpis.frequencia)} hint={`satura ≥ ${FREQ_SATURACAO}`} onClick={() => scrollPara('sec-criativos')} />
          <KpiCard label="Concentração" valor={fmtPct(t.kpis.shareMaiorCampanha, 0)} hint="na maior campanha" onClick={() => scrollPara('sec-campanhas')} />
        </section>

        {/* (v2 #8/#10) meta do mes + projecao */}
        {t.metaMensal && (
          <section className="rounded-3xl p-4 md:p-5 flex flex-col gap-2" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <SecTitle>Meta de leads · {fmtMes(t.metaMensal.mes)}</SecTitle>
              <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                <span><strong style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtInt(t.metaMensal.leads)}</strong> até agora</span>
                <span>projeção <strong style={{ color: 'var(--cbc-gold-dark, #B8860B)' }}>{fmtInt(t.metaMensal.projecaoLeads)}</strong></span>
                {podeOperar && (
                  <label className="flex items-center gap-1.5">meta:
                    <input type="number" className="input-field w-24 !py-1" defaultValue={metas.leads_mes || ''} placeholder="ex. 600"
                      onBlur={(e) => { const v = Number(e.target.value) || null; if (v !== (metas.leads_mes || null)) salvarConfig({ metas: { leads_mes: v } }); }} />
                  </label>
                )}
              </div>
            </div>
            {t.metaMensal.metaLeads ? (
              <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)' }} role="progressbar"
                aria-valuenow={t.metaMensal.pct} aria-valuemin="0" aria-valuemax="100" aria-label="Progresso da meta de leads">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(t.metaMensal.pct, 100)}%`, background: t.metaMensal.pct >= 100 ? 'var(--cbc-success, #16A34A)' : 'linear-gradient(90deg, var(--cbc-gold, #C9A84C), var(--cbc-gold-dark, #B8860B))' }} />
              </div>
            ) : (
              <div className="text-[11.5px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Defina a meta mensal de leads para acompanhar o progresso aqui.</div>
            )}
            {t.metaMensal.metaLeads ? <div className="text-[11px] font-bold" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>{t.metaMensal.pct}% da meta de {fmtInt(t.metaMensal.metaLeads)}</div> : null}
          </section>
        )}

        {/* (v2 #174/#175/#176) resumo, recomendacoes e anomalias */}
        {(resumo || recs.length > 0) && (
          <section className="rounded-3xl p-4 md:p-5 space-y-2.5" style={{ background: 'linear-gradient(120deg, var(--cbc-navy, #1B3A5C), var(--cbc-navy-dark, #0F2035))', color: '#fff' }}>
            <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[1.5px] opacity-80">
              <LightBulbIcon className="w-4 h-4" aria-hidden="true" /> Leitura do período
            </div>
            <p className="text-[13.5px] leading-relaxed">{resumo}</p>
            {recs.length > 0 && (
              <ul className="space-y-1.5">
                {recs.slice(0, 5).map((r, i) => (
                  <li key={i} className="text-[12.5px] leading-snug flex gap-2">
                    <span style={{ color: 'var(--cbc-gold, #C9A84C)' }}>➜</span><span className="opacity-95">{r.texto}</span>
                  </li>
                ))}
              </ul>
            )}
            {t.anomalias.length > 0 && (
              <div className="text-[11px] opacity-75">Dias fora da curva (z≥2): {t.anomalias.map((a) => `${a.dia.slice(8)}/${a.dia.slice(5, 7)} (CPL ${fmtBRL(a.cpl, 2)})`).join(' · ')}</div>
            )}
          </section>
        )}

        {/* Serie + donut */}
        <section id="sec-serie" className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 rounded-3xl p-4 md:p-5" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <SecTitle>Dia a dia <span className="font-normal normal-case tracking-normal">({range.inicio.slice(8)}/{range.inicio.slice(5, 7)} – {range.fim.slice(8)}/{range.fim.slice(5, 7)})</span></SecTitle>
            <div className="mt-3"><SerieChart serie={t.serie} /></div>
          </div>
          <div className="rounded-3xl p-4 md:p-5" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <SecTitle>Gasto por campanha</SecTitle>
            <div className="mt-3"><Donut dados={t.donut} /></div>
          </div>
        </section>

        {/* Campanhas */}
        <section id="sec-campanhas" className="rounded-3xl overflow-hidden" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="px-4 md:px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <SecTitle>Campanhas</SecTitle>
            <div className="flex items-center gap-3 flex-wrap text-[11px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              {podeOperar && selecionadas.size > 0 && (
                <button onClick={() => setConfirmacao({ lote: campanhasOrdenadas.filter((c) => selecionadas.has(c.campaign_id) && c.status === 'ACTIVE') })}
                  className="px-3 py-1 rounded-lg font-bold uppercase text-[10.5px] cursor-pointer btn-press"
                  style={{ background: 'color-mix(in srgb, var(--cbc-warning, #D97706) 15%, transparent)', color: 'var(--cbc-warning, #B45309)' }}>
                  Pausar {selecionadas.size} selecionada(s)
                </button>
              )}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={mostrarRh} onChange={(e) => setMostrarRh(e.target.checked)} /> mostrar vagas/RH e pausadas
              </label>
            </div>
          </div>
          {/* desktop: tabela ordenavel · mobile (v2 #148): cards */}
          <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
            <table className="w-full text-[12px]" style={{ minWidth: 900 }}>
              <thead>
                <tr className="text-left text-[9.5px] uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  {podeOperar && <th className="pl-4 py-2 w-8"><span className="sr-only">Selecionar</span></th>}
                  {COLS_CAMPANHA.map((col) => (
                    <th key={col.key} className={`px-2.5 py-2 ${col.right ? 'text-right' : ''}`}>
                      <button className="inline-flex items-center gap-0.5 uppercase font-bold cursor-pointer" onClick={() => setSort((s) => ({ key: col.key, asc: s.key === col.key ? !s.asc : false }))}>
                        {col.label}<ChevronUpDownIcon className={`w-3 h-3 ${sort.key === col.key ? 'opacity-100' : 'opacity-30'}`} aria-hidden="true" />
                      </button>
                    </th>
                  ))}
                  <th className="px-2.5 py-2 text-right pr-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {campanhasOrdenadas.map((c) => (
                  <tr key={c.campaign_id} style={{ borderTop: '1px solid var(--cbc-border, #E5E7EB)', opacity: c.rh ? 0.65 : 1 }}>
                    {podeOperar && (
                      <td className="pl-4 py-2">
                        <input type="checkbox" aria-label={`Selecionar ${c.nome}`} checked={selecionadas.has(c.campaign_id)}
                          onChange={(e) => setSelecionadas((s) => { const n = new Set(s); if (e.target.checked) n.add(c.campaign_id); else n.delete(c.campaign_id); return n; })} />
                      </td>
                    )}
                    <td className="px-2.5 py-2">
                      <div className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                        <span className="truncate max-w-[320px]" title={c.nome}>{c.nome}</span>
                        {c.rh && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0" style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)', color: 'var(--cbc-text-muted, #6B7280)' }}>RH</span>}
                        {c.atencao && (
                          <span title={c.atencao === 'zerada' ? 'Ativa sem gasto no período' : 'CPL bem acima da média'} className="shrink-0">
                            <ExclamationTriangleIcon className="w-4 h-4" style={{ color: 'var(--cbc-warning, #D97706)' }} aria-hidden="true" />
                          </span>
                        )}
                        <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=969110338250520&selected_campaign_ids=${c.campaign_id}`} target="_blank" rel="noreferrer"
                          title="Abrir no Gerenciador" aria-label={`Abrir ${c.nome} no Gerenciador`} className="shrink-0">
                          <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 opacity-50" aria-hidden="true" />
                        </a>
                      </div>
                    </td>
                    <td className="px-2.5 py-2">
                      <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full"
                        style={c.status === 'ACTIVE'
                          ? { background: 'color-mix(in srgb, var(--cbc-success, #16A34A) 14%, transparent)', color: 'var(--cbc-success, #15803D)' }
                          : { background: 'var(--cbc-bg-subtle, #F3F4F6)', color: 'var(--cbc-text-muted, #6B7280)' }}>
                        {c.status === 'ACTIVE' ? 'ATIVA' : c.status === 'PAUSED' ? 'PAUSADA' : (c.status || '—')}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-right">{fmtBRL(c.orcamento_diario)}</td>
                    <td className="px-2.5 py-2 text-right font-semibold">{fmtBRL(c.gasto)}</td>
                    <td className="px-2.5 py-2 text-right">{fmtInt(c.leads)}</td>
                    <td className="px-2.5 py-2 text-right" style={{ color: 'var(--cbc-gold-dark, #B8860B)' }}>{c.leadsHoje ? `+${c.leadsHoje}` : '—'}</td>
                    <td className="px-2.5 py-2 text-right">{fmtBRL(c.cpl, 2)}</td>
                    <td className="px-2.5 py-2 text-right">{fmtPct(c.ctr, 2)}</td>
                    <td className="px-2.5 py-2 text-right">{fmtBRL(c.cpm, 2)}</td>
                    <td className="px-2.5 py-2 text-right"><DeltaBadge valor={c.tendencia7d} /></td>
                    <td className="px-2.5 py-2 pr-4">
                      <div className="flex items-center justify-end gap-1">
                        {c.status === 'ACTIVE' ? (
                          <button disabled={!podeOperar} title={podeOperar ? 'Pausar' : 'Só sócios + Lorenza'} aria-label={`Pausar ${c.nome}`}
                            onClick={() => setConfirmacao({ acao: 'pausar', campanha: c })}
                            className="p-1 rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed btn-press" style={{ border: '1px solid var(--cbc-border, #E5E7EB)' }}>
                            <PauseCircleIcon className="w-4.5 h-4.5" style={{ color: 'var(--cbc-warning, #D97706)', width: 18, height: 18 }} aria-hidden="true" />
                          </button>
                        ) : (
                          <button disabled={!podeOperar} title={podeOperar ? 'Reativar' : 'Só sócios + Lorenza'} aria-label={`Reativar ${c.nome}`}
                            onClick={() => setConfirmacao({ acao: 'reativar', campanha: c })}
                            className="p-1 rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed btn-press" style={{ border: '1px solid var(--cbc-border, #E5E7EB)' }}>
                            <PlayCircleIcon style={{ color: 'var(--cbc-success, #16A34A)', width: 18, height: 18 }} aria-hidden="true" />
                          </button>
                        )}
                        <button disabled={!podeOperar} title={podeOperar ? 'Orçamento diário' : 'Só sócios + Lorenza'} aria-label={`Editar orçamento de ${c.nome}`}
                          onClick={() => { setModalOrcamento(c); setValorOrcamento(c.orcamento_diario ? String(c.orcamento_diario) : ''); }}
                          className="p-1 rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed btn-press" style={{ border: '1px solid var(--cbc-border, #E5E7EB)' }}>
                          <BanknotesIcon style={{ color: 'var(--cbc-navy-light, #264A72)', width: 18, height: 18 }} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sm:hidden divide-y" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
            {campanhasOrdenadas.map((c) => (
              <div key={c.campaign_id} className="p-3.5 space-y-1.5" style={{ opacity: c.rh ? 0.65 : 1 }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{c.nome}</span>
                  <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={c.status === 'ACTIVE' ? { background: 'color-mix(in srgb, var(--cbc-success, #16A34A) 14%, transparent)', color: 'var(--cbc-success, #15803D)' } : { background: 'var(--cbc-bg-subtle, #F3F4F6)', color: 'var(--cbc-text-muted, #6B7280)' }}>
                    {c.status === 'ACTIVE' ? 'ATIVA' : 'PAUSADA'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  <span>Gasto <strong style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtBRL(c.gasto)}</strong></span>
                  <span>Leads <strong style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtInt(c.leads)}</strong></span>
                  <span>CPL <strong style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtBRL(c.cpl, 2)}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Criativos */}
        <section id="sec-criativos" className="rounded-3xl p-4 md:p-5" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <SecTitle>Criativos</SecTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <input className="input-field !py-1 w-40" placeholder="buscar anúncio…" value={buscaCriativo} onChange={(e) => setBuscaCriativo(e.target.value)} aria-label="Buscar criativo" />
              <select className="input-field !py-1 w-44" value={filtroCampanhaCriativo} onChange={(e) => setFiltroCampanhaCriativo(e.target.value)} aria-label="Filtrar por campanha">
                <option value="">Todas as campanhas</option>
                {t.campanhas.filter((c) => !c.rh).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.nome}</option>)}
              </select>
              <div className="flex gap-1">
                {RANKING_TABS.map((r) => (
                  <button key={r.key} onClick={() => setRankTab(r.key)}
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide cursor-pointer btn-press"
                    style={rankTab === r.key
                      ? (r.key === 'piores' ? { background: 'var(--cbc-danger, #DC2626)', color: '#fff' } : { background: 'var(--cbc-navy, #1B3A5C)', color: '#fff' })
                      : { background: 'var(--cbc-bg-subtle, #F3F4F6)', color: 'var(--cbc-text-muted, #6B7280)' }}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {criativosFiltrados.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Nenhum criativo elegível com os filtros atuais.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {criativosFiltrados.map((a, i) => (
                  <button key={a.ad_id} type="button" onClick={() => setCriativoAberto(a)}
                    className="rounded-2xl overflow-hidden flex flex-col text-left cursor-pointer btn-press"
                    style={{ border: '1px solid var(--cbc-border, #E5E7EB)', background: 'var(--cbc-bg-card, #fff)' }}>
                    <div className="relative" style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)', aspectRatio: '1.91/1' }}>
                      {a.thumbnail_url && <img src={a.thumbnail_url} alt={a.nome} className="w-full h-full object-cover" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                      {rankTab !== 'todos' && <span className="absolute top-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(15,32,53,.78)', color: '#fff' }}>#{i + 1}</span>}
                      {a.saturando && <span className="absolute top-1.5 right-1.5 text-[8.5px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--cbc-warning, #D97706)', color: '#fff' }}>saturando</span>}
                    </div>
                    <div className="p-2 flex flex-col gap-0.5 flex-1">
                      <div className="text-[11px] font-semibold leading-tight truncate" title={a.nome} style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{a.nome}</div>
                      <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                        {fmtInt(a.leads)} leads · CPL {fmtBRL(a.cpl, 2)} · CTR {fmtPct(a.ctr, 2)}
                      </div>
                      <div className="text-[9.5px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                        {fmtBRL(a.gasto)}{a.hookRate != null ? ` · hook ${fmtPct(a.hookRate, 0)}` : ''}{a.saturaEmDias != null && a.saturaEmDias <= 14 ? ` · satura ~${a.saturaEmDias}d` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {rankTab === 'todos' && t.criativos.filter((c) => c.impressoes > 0).length > verTodosLimite && (
                <div className="text-center pt-3">
                  <button onClick={() => setVerTodosLimite((v) => v + 24)} className="btn-outline px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase cursor-pointer">Carregar mais</button>
                </div>
              )}
            </>
          )}
          {/* (v2 #177) temas por nomenclatura */}
          {temas.length > 1 && (
            <div className="mt-4 pt-3" style={{ borderTop: '1px dashed var(--cbc-border, #E5E7EB)' }}>
              <SecTitle>Temas de criativo <span className="font-normal normal-case tracking-normal">(pela tag do nome — ex.: [VD])</span></SecTitle>
              <div className="flex gap-2 flex-wrap mt-2">
                {temas.slice(0, 8).map((tm) => (
                  <div key={tm.tema} className="rounded-xl px-3 py-2 text-[11px]" style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)' }}>
                    <div className="font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{tm.tema} <span className="font-normal" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>×{tm.n}</span></div>
                    <div style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>{fmtInt(tm.leads)} leads · CPL {fmtBRL(tm.cpl, 2)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* (v2 #121/#124-127) conjuntos + breakdowns */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-3xl p-4 md:p-5" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <SecTitle>Conjuntos (públicos)</SecTitle>
            <div className="mt-2" style={{ overflowX: 'auto' }}>
              <table className="w-full text-[11.5px]" style={{ minWidth: 480 }}>
                <thead><tr className="text-left text-[9.5px] uppercase" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  <th className="py-1.5 pr-2">Conjunto</th><th className="py-1.5 px-2 text-right">Gasto</th><th className="py-1.5 px-2 text-right">Leads</th><th className="py-1.5 px-2 text-right">CPL</th><th className="py-1.5 px-2 text-right">CTR</th>
                </tr></thead>
                <tbody>
                  {t.conjuntos.slice(0, 12).map((s) => (
                    <tr key={s.adset_id} style={{ borderTop: '1px solid var(--cbc-border, #E5E7EB)' }}>
                      <td className="py-1.5 pr-2 truncate max-w-[220px]" title={s.nome} style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{s.nome}</td>
                      <td className="py-1.5 px-2 text-right">{fmtBRL(s.gasto)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtInt(s.leads)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtBRL(s.cpl, 2)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtPct(s.ctr, 2)}</td>
                    </tr>
                  ))}
                  {!t.conjuntos.length && <tr><td colSpan="5" className="py-3 text-[11px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Sem dados de conjuntos ainda (chegam no próximo sync).</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-3xl p-4 md:p-5 space-y-3" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <SecTitle>Quem responde aos anúncios</SecTitle>
            {['idade', 'regiao', 'posicao'].map((tipo) => (
              <div key={tipo}>
                <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  {tipo === 'idade' ? 'Idade · gênero' : tipo === 'regiao' ? 'Região (UF/cidade)' : 'Posicionamento'}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {(bdAgg[tipo] || []).slice(0, 6).map((b) => (
                    <span key={b.chave} className="text-[10.5px] px-2 py-1 rounded-lg inline-flex items-center gap-1.5"
                      style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)', color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                      <strong>{b.chave}</strong> {fmtInt(b.leads)} leads · CPL {fmtBRL(b.cpl, 2)}
                      {b.caro && <span className="text-[8.5px] font-bold px-1 py-0.5 rounded uppercase" style={{ background: 'var(--cbc-danger, #DC2626)', color: '#fff' }} title="CPL 50%+ acima da média — candidato a excluir">caro</span>}
                    </span>
                  ))}
                  {!(bdAgg[tipo] || []).length && <span className="text-[11px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Sem dados no período.</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Comercial expandido */}
        <section id="sec-comercial" className="rounded-3xl overflow-hidden" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="px-4 md:px-5 py-3.5" style={{ borderBottom: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <SecTitle>Do anúncio ao contrato <span className="font-normal normal-case tracking-normal">(mês-calendário · payback = recebido no Asaas dos assinados do mês)</span></SecTitle>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-[11.5px]" style={{ minWidth: 1080 }}>
              <thead>
                <tr className="text-left text-[9.5px] uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  <th className="px-4 py-2">Mês</th>
                  <th className="px-2 py-2 text-right">Leads</th>
                  <th className="px-2 py-2 text-right">Vídeo</th>
                  <th className="px-2 py-2 text-right">Enviados</th>
                  <th className="px-2 py-2 text-right">Assinados</th>
                  <th className="px-2 py-2 text-right">via Meta</th>
                  <th className="px-2 py-2 text-right">Funil</th>
                  <th className="px-2 py-2 text-right">R$/vídeo</th>
                  <th className="px-2 py-2 text-right">R$/enviado</th>
                  <th className="px-2 py-2 text-right">R$/assinado</th>
                  <th className="px-2 py-2 text-right">Ticket</th>
                  <th className="px-2 py-2 text-right">Receita</th>
                  <th className="px-2 py-2 text-right pr-4">Payback</th>
                </tr>
              </thead>
              <tbody>
                {comercial.map((m) => {
                  const maxF = Math.max(m.leads, 1);
                  return (
                    <tr key={m.mes} style={{ borderTop: '1px solid var(--cbc-border, #E5E7EB)' }}>
                      <td className="px-4 py-2 font-semibold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtMes(m.mes)}</td>
                      <td className="px-2 py-2 text-right">{fmtInt(m.leads)} <span className="text-[9px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{m.taxaLeadVc != null ? `${fmtNum(m.taxaLeadVc, 1)}%→` : ''}</span></td>
                      <td className="px-2 py-2 text-right">{fmtInt(m.videochamadas)} <span className="text-[9px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{m.taxaVcEnviado != null ? `${fmtNum(m.taxaVcEnviado, 1)}%→` : ''}</span></td>
                      <td className="px-2 py-2 text-right">{fmtInt(m.enviados)} <span className="text-[9px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{m.taxaEnviadoAssinado != null ? `${fmtNum(m.taxaEnviadoAssinado, 1)}%→` : ''}</span></td>
                      <td className="px-2 py-2 text-right font-semibold">{fmtInt(m.assinados)}</td>
                      <td className="px-2 py-2 text-right" title="Assinados com origem de anúncio no cadastro">{fmtInt(m.assinadosMeta)}</td>
                      <td className="px-2 py-2 text-right">
                        <span className="inline-flex items-end gap-px h-4" aria-hidden="true">
                          {[m.leads, m.videochamadas, m.enviados, m.assinados].map((v, i) => (
                            <span key={i} className="inline-block w-1.5 rounded-sm" style={{ height: `${Math.max((v / maxF) * 16, 2)}px`, background: i === 3 ? 'var(--cbc-success, #16A34A)' : 'var(--cbc-navy-light, #264A72)' }} />
                          ))}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">{fmtBRL(m.custoPorVideochamada, 0)}</td>
                      <td className="px-2 py-2 text-right">{fmtBRL(m.custoPorEnviado, 0)}</td>
                      <td className="px-2 py-2 text-right font-bold" style={{ color: 'var(--cbc-gold-dark, #B8860B)' }}>{fmtBRL(m.custoPorAssinado, 0)}</td>
                      <td className="px-2 py-2 text-right">{fmtBRL(m.ticketMedio, 0)}</td>
                      <td className="px-2 py-2 text-right">{fmtBRL(m.receita, 0)}</td>
                      <td className="px-2 py-2 pr-4 text-right font-bold" style={{ color: m.paybackPct != null && m.paybackPct >= 100 ? 'var(--cbc-success, #16A34A)' : 'var(--cbc-text-primary, #1B3A5C)' }}>{m.paybackPct != null ? `${m.paybackPct}%` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 md:px-5 py-2 text-[10px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
            "via Meta" usa a origem preenchida no cadastro do contrato; atribuição lead a lead virá com o espelho Kommo.
          </div>
        </section>

        {/* Alertas */}
        <section id="sec-alertas" className="rounded-3xl p-4 md:p-5 flex flex-col gap-3" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
            <BellAlertIcon className="w-4 h-4" aria-hidden="true" /> Alertas automáticos <span className="font-normal normal-case tracking-normal">(sino + e-mail diário · resumo toda segunda 08h)</span>
          </div>
          {alertCfg && (
            <div className="flex items-end gap-4 flex-wrap text-[12px]">
              <label className="flex items-center gap-2 font-semibold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                <input type="checkbox" checked={!!alertCfg.ativo} disabled={!podeOperar} onChange={(e) => setAlertCfg({ ...alertCfg, ativo: e.target.checked })} /> Ativos
              </label>
              {[['cpl_mult', 'CPL estoura acima de (× média)', 0.1], ['cpl_gasto_min_dia', 'Gasto mín. no dia (R$)', 10], ['queda_leads_pct', 'Queda de leads (%)', 5], ['freq_alta', 'Frequência alta (≥)', 0.1], ['gasto_sem_lead_min', 'Gasto sem lead (R$)', 10]].map(([k, label, step]) => (
                <label key={k} className="flex flex-col gap-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  {label}
                  <input type="number" step={step} className="input-field w-28" disabled={!podeOperar} value={alertCfg[k]} onChange={(e) => setAlertCfg({ ...alertCfg, [k]: Number(e.target.value) })} />
                </label>
              ))}
              <label className="flex flex-col gap-1 min-w-[260px] flex-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                Destinatários (e-mails separados por vírgula)
                <input type="text" className="input-field" disabled={!podeOperar}
                  value={(alertCfg.destinatarios || TRAFEGO_ACAO_EMAILS).join(', ')}
                  onChange={(e) => setAlertCfg({ ...alertCfg, destinatarios: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              </label>
              {podeOperar && (
                <button onClick={() => salvarConfig({ alertas: alertCfg })} disabled={executando}
                  className="btn-primary px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide cursor-pointer btn-press">
                  Salvar
                </button>
              )}
            </div>
          )}
          <p className="text-[10.5px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
            Tipos: CPL da conta e por campanha, entrega zerada, gasto sem lead, queda semanal por campanha, criativo saturando, frequência alta — e o positivo de melhor CPL. 1× por tipo/campanha por dia.
          </p>
        </section>

        <p className="text-[10px] text-center pb-2" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
          Métricas da Meta atualizam retroativamente por ~3 dias. Leads = conversas iniciadas + formulários. Campanhas de vaga (RH) ficam fora de toda a captação. Dias no fuso BRT.
        </p>
      </div>

      {/* Modal detalhe do criativo (v2 #71/#56/#72/#75) */}
      {criativoAberto && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(15,32,53,.55)' }} onClick={() => setCriativoAberto(null)}>
          <div className="w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-2xl p-5 space-y-3" style={{ background: 'var(--cbc-bg-card, #fff)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{criativoAberto.nome}</div>
                <div className="text-[11px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>{fmtInt(criativoAberto.leads)} leads · CPL {fmtBRL(criativoAberto.cpl, 2)} · CTR {fmtPct(criativoAberto.ctr, 2)} · freq {fmtNum(criativoAberto.frequencia)}</div>
              </div>
              <button onClick={() => setCriativoAberto(null)} aria-label="Fechar" className="cursor-pointer"><XMarkIcon className="w-5 h-5" style={{ color: 'var(--cbc-text-muted, #6B7280)' }} aria-hidden="true" /></button>
            </div>
            {criativoAberto.thumbnail_url && <img src={criativoAberto.thumbnail_url} alt="" className="w-full rounded-xl" style={{ maxHeight: 200, objectFit: 'cover' }} />}
            {criativoAberto.saturando && (
              <div className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ background: 'color-mix(in srgb, var(--cbc-warning, #D97706) 12%, transparent)', color: 'var(--cbc-warning, #B45309)' }}>
                Saturando: frequência {fmtNum(criativoAberto.frequencia)} com CTR em queda — prepare um substituto.
              </div>
            )}
            {criativoAberto.saturaEmDias != null && !criativoAberto.saturando && (
              <div className="text-[12px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>No ritmo atual, satura em ~{criativoAberto.saturaEmDias} dia(s).</div>
            )}
            {criativoAberto.retencao && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Retenção do vídeo (% das impressões)</div>
                <div className="flex items-end gap-2 h-20">
                  {[['3s', criativoAberto.hookRate], ['25%', criativoAberto.retencao.p25], ['50%', criativoAberto.retencao.p50], ['75%', criativoAberto.retencao.p75], ['100%', criativoAberto.retencao.p100]].map(([l, v]) => (
                    <div key={l} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9.5px] font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtPct(v, 0)}</span>
                      <div className="w-full rounded-t" style={{ height: `${Math.max((v || 0), 2)}%`, minHeight: 2, background: 'var(--cbc-gold, #C9A84C)' }} />
                      <span className="text-[9px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{l}</span>
                    </div>
                  ))}
                </div>
                {criativoAberto.quedaHook != null && <div className="text-[10.5px] mt-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>Do gancho (3s) ao ThruPlay: {fmtPct(criativoAberto.quedaHook, 0)} seguram.</div>}
              </div>
            )}
            {(() => {
              const curva = computeCurvaCriativo(diario, criativoAberto.ad_id);
              if (curva.length < 2) return null;
              const maxCtr = Math.max(...curva.map((s) => s.ctr || 0), 0.1);
              return (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Curva de fadiga (CTR semana a semana)</div>
                  <div className="flex items-end gap-1.5 h-16">
                    {curva.map((s) => (
                      <div key={s.semana} className="flex-1 flex flex-col items-center gap-0.5" title={`${s.semana}: CTR ${fmtPct(s.ctr, 2)} · freq ${fmtNum(s.frequencia)}`}>
                        <div className="w-full rounded-t" style={{ height: `${Math.max(((s.ctr || 0) / maxCtr) * 100, 3)}%`, minHeight: 2, background: 'var(--cbc-navy-light, #264A72)' }} />
                        <span className="text-[8.5px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{s.semana}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {criativoAberto.permalink && (
              <a href={criativoAberto.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-navy-light, #264A72)' }}>
                Ver anúncio no Facebook <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Modal de confirmacao (acoes) */}
      {(confirmacao || modalOrcamento) && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(15,32,53,.55)' }}
          onClick={() => { if (!executando) { setConfirmacao(null); setModalOrcamento(null); } }}>
          <div className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--cbc-bg-card, #fff)' }} onClick={(e) => e.stopPropagation()}>
            {modalOrcamento && !confirmacao ? (
              <>
                <div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>Editar orçamento diário</div>
                <div className="text-[12.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  <strong>{modalOrcamento.nome}</strong> · atual: {fmtBRL(modalOrcamento.orcamento_diario)}
                </div>
                {/* (v2 #113) presets rapidos */}
                {modalOrcamento.orcamento_diario > 0 && (
                  <div className="flex gap-2">
                    {[-25, 10, 25].map((p) => (
                      <button key={p} className="px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer btn-press"
                        style={{ border: '1px solid var(--cbc-border, #E5E7EB)', color: p < 0 ? 'var(--cbc-danger, #DC2626)' : 'var(--cbc-success, #15803D)' }}
                        onClick={() => setValorOrcamento(String(Math.max(1, Math.round(modalOrcamento.orcamento_diario * (1 + p / 100)))))}>
                        {p > 0 ? `+${p}%` : `${p}%`}
                      </button>
                    ))}
                  </div>
                )}
                <input type="number" min="1" step="1" className="input-field" autoFocus value={valorOrcamento}
                  onChange={(e) => setValorOrcamento(e.target.value)} placeholder="Novo valor em R$/dia" />
                <div className="flex justify-end gap-2">
                  <button className="btn-outline px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer" onClick={() => setModalOrcamento(null)}>Cancelar</button>
                  <button className="btn-primary px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer"
                    disabled={!Number(valorOrcamento) || Number(valorOrcamento) < 1}
                    onClick={() => setConfirmacao({ acao: 'orcamento', campanha: modalOrcamento, valor: Number(valorOrcamento) })}>
                    Continuar
                  </button>
                </div>
              </>
            ) : confirmacao && (
              <>
                <div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>Confirmar ação na conta de anúncios</div>
                <div className="text-[13px] leading-relaxed" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                  {confirmacao.lote && <>Pausar <strong>{confirmacao.lote.length}</strong> campanha(s) selecionada(s)? Elas param de veicular imediatamente.</>}
                  {confirmacao.acao === 'pausar' && <>Pausar <strong>{confirmacao.campanha.nome}</strong>? Para de veicular imediatamente.</>}
                  {confirmacao.acao === 'reativar' && <>Reativar <strong>{confirmacao.campanha.nome}</strong>? Volta a gastar o orçamento ({fmtBRL(confirmacao.campanha.orcamento_diario)}/dia).</>}
                  {confirmacao.acao === 'orcamento' && <>Orçamento de <strong>{confirmacao.campanha.nome}</strong>: {fmtBRL(confirmacao.campanha.orcamento_diario)} → <strong>{fmtBRL(confirmacao.valor)}</strong>/dia?</>}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Registrada em auditoria (quem/quando/antes→depois) e reversível pelo botão Desfazer.</div>
                <div className="flex justify-end gap-2">
                  <button className="btn-outline px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer" disabled={executando}
                    onClick={() => { setConfirmacao(null); setModalOrcamento(null); }}>Cancelar</button>
                  <button className="btn-primary px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer" disabled={executando} onClick={handleAcao}>
                    {executando ? 'Executando…' : 'Confirmar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
