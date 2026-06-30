// (#306) Dashboard Socios — Restrito a Paulo e Bruno
// Mostra visao financeira, operacional, equipe e estrategica
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { SkeletonDashboard } from './Skeleton';
import ErrorState from './ErrorState';
import {
  CurrencyDollarIcon,
  BanknotesIcon,
  ExclamationTriangleIcon,
  TrophyIcon,
  UsersIcon,
  BriefcaseIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  FunnelIcon,
  ClockIcon,
  CheckCircleIcon,
  BuildingOffice2Icon,
  ScaleIcon,
  InformationCircleIcon,
  FlagIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';

const SOCIOS_EMAILS = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com'];

function formatCurrency(val) {
  if (!val && val !== 0) return 'R$ 0,00';
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatCompactBRL(val) {
  if (!val && val !== 0) return 'R$ 0';
  const n = Number(val);
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(1).replace('.', ',')}k`;
  return formatCurrency(n);
}
function fmtPct(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  const n = Number(val);
  return `${n >= 0 ? '+' : ''}${n.toFixed(1).replace('.', ',')}%`;
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'; }
function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }
function startOfYear(d = new Date()) { return new Date(d.getFullYear(), 0, 1); }

// ─── Periodo de comissao: dia 20 do mes anterior → dia 19 do mes corrente ───
function getCommissionPeriod(anchorDate = new Date(), periodoInicioDia = 20) {
  // anchorDate define o periodo: se hoje e dia 25/abr, periodo e 20/abr-19/mai
  // Se hoje e dia 15/abr, periodo e 20/mar-19/abr
  const y = anchorDate.getFullYear();
  const m = anchorDate.getMonth();
  const d = anchorDate.getDate();
  let inicio, fim;
  if (d >= periodoInicioDia) {
    inicio = new Date(y, m, periodoInicioDia);
    fim = new Date(y, m + 1, periodoInicioDia - 1, 23, 59, 59, 999);
  } else {
    inicio = new Date(y, m - 1, periodoInicioDia);
    fim = new Date(y, m, periodoInicioDia - 1, 23, 59, 59, 999);
  }
  return { inicio, fim };
}
function formatPeriodLabel({ inicio, fim }) {
  const a = inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  const b = fim.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '');
  return `${a} → ${b}`;
}
function periodoInicioISO(p) {
  // YYYY-MM-DD
  return `${p.inicio.getFullYear()}-${String(p.inicio.getMonth() + 1).padStart(2, '0')}-${String(p.inicio.getDate()).padStart(2, '0')}`;
}
function shiftCommissionPeriod(currentInicio, delta, periodoInicioDia = 20) {
  // Move por um mes inteiro (+1 ou -1)
  const newAnchor = new Date(currentInicio.getFullYear(), currentInicio.getMonth() + delta, periodoInicioDia + 2);
  return getCommissionPeriod(newAnchor, periodoInicioDia);
}
// CSV helpers
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Section Header ───
function SectionHeader({ Icon, title, subtitle, rightSlot }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--cbc-navy, #1B3A5C)', color: 'var(--cbc-gold, #C9A84C)' }}>
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm md:text-base font-bold tracking-wide truncate"
            style={{ color: 'var(--cbc-text-primary)' }}>{title}</div>
          {subtitle && <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{subtitle}</div>}
        </div>
      </div>
      {rightSlot}
    </div>
  );
}

// ─── Card wrapper (respeita dark mode) ───
function SocioCard({ children, className = '', accent = false }) {
  return (
    <div
      className={`rounded-xl p-4 transition-shadow hover:shadow-md ${className}`}
      style={{
        background: 'var(--cbc-bg-card)',
        border: '1px solid var(--cbc-border)',
        color: 'var(--cbc-text-primary)',
        borderTop: accent ? '3px solid var(--cbc-gold, #C9A84C)' : '1px solid var(--cbc-border)',
      }}
    >
      {children}
    </div>
  );
}

// ─── Mini sparkline SVG ───
function Sparkline({ points, color = '#C9A84C', height = 36 }) {
  if (!points || points.length < 2) return <div className="h-9" />;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const w = 120;
  const h = height;
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 6) - 3;
    return `${x},${y}`;
  });
  const polyline = pts.join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={polyline} />
      {pts.map((p, i) => {
        const [x, y] = p.split(',').map(Number);
        return <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 2.5 : 1.5} fill={color} />;
      })}
    </svg>
  );
}

// ─── Accordion Section ───
function Accordion({ Icon, title, subtitle, defaultOpen = true, children, rightSlot }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--cbc-navy, #1B3A5C)', color: 'var(--cbc-gold, #C9A84C)' }}>
              <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
          )}
          <div className="text-left min-w-0">
            <div className="text-sm md:text-base font-bold tracking-wide truncate"
              style={{ color: 'var(--cbc-text-primary)' }}>{title}</div>
            {subtitle && <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{subtitle}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rightSlot}
          <svg className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-1 animate-fade-in-up">{children}</div>}
    </div>
  );
}

// ─── Calcula todos os dados derivados ───
// (bug-6) `contratosTodos` = conjunto completo (inclui arquivados); `contratos` (escopo da
// funcao abaixo) = apenas ATIVOS (arquivado_em IS NULL), igual ao Dashboard principal, para que
// receita/ranking/contagens batam. A unica metrica que precisa do conjunto completo e a taxa de
// exito (bug-5), que conta arquivados-sem-assinar como perda — essa usa `contratosTodos`.
function computeSociosStats(contratosTodos, boletos) {
  const contratos = (contratosTodos || []).filter(c => !c.arquivado_em);
  const now = new Date();
  const monStart = startOfMonth(now);
  const monEnd = endOfMonth(now);
  const prevMonStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const prevMonEnd = endOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  // (bug-6) data efetiva de assinatura igual ao Dashboard principal: signed_at -> advbox_date -> updated_at
  // (replica getSignedDate de dashboard/compute.js; created_at fica so como ultimo recurso defensivo)
  const signedDate = (c) => new Date(c.signed_at || c.advbox_date || c.updated_at || c.created_at);
  const assinados = contratos.filter(c => c.status === 'assinado');

  // ─── A. Receita mes atual vs anterior ───
  const receitaMesAtual = assinados
    .filter(c => { const d = signedDate(c); return d >= monStart && d <= monEnd; })
    .reduce((s, c) => s + (Number(c.honorarios_total) || 0), 0);
  const receitaMesPrev = assinados
    .filter(c => { const d = signedDate(c); return d >= prevMonStart && d <= prevMonEnd; })
    .reduce((s, c) => s + (Number(c.honorarios_total) || 0), 0);
  const receitaDelta = receitaMesPrev > 0 ? ((receitaMesAtual - receitaMesPrev) / receitaMesPrev) * 100 : null;

  // Sparkline ultimos 6 meses
  const sparkReceita = [];
  for (let i = 5; i >= 0; i--) {
    const s = startOfMonth(new Date(now.getFullYear(), now.getMonth() - i, 1));
    const e = endOfMonth(s);
    const r = assinados
      .filter(c => { const d = signedDate(c); return d >= s && d <= e; })
      .reduce((acc, c) => acc + (Number(c.honorarios_total) || 0), 0);
    sparkReceita.push(r);
  }

  // ─── A. Projecao de receita (boletos pending + due_date <= fim do mes) ───
  const proj = (boletos || []).filter(b => {
    if (b.status !== 'pending' && b.status !== 'PENDING') return false;
    if (!b.due_date) return false;
    const due = new Date(b.due_date + (b.due_date.length === 10 ? 'T23:59:59' : ''));
    return due >= now && due <= monEnd;
  });
  const projTotal = proj.reduce((s, b) => s + (Number(b.value) || 0), 0);
  const projCount = proj.length;

  // ─── A. Inadimplencia ───
  const inad = (boletos || []).filter(b => b.status === 'overdue' || b.status === 'OVERDUE');
  const inadTotal = inad.reduce((s, b) => s + (Number(b.value) || 0), 0);
  const inadClientes = new Set(inad.map(b => b.customer_id || b.customer || b.customer_name)).size;

  const bucket30 = [], bucket60 = [], bucket90 = [];
  inad.forEach(b => {
    const due = new Date(b.due_date);
    const days = Math.floor((now - due) / 86400000);
    if (days <= 30) bucket30.push(b);
    else if (days <= 60) bucket60.push(b);
    else bucket90.push(b);
  });

  // ─── A. Top 10 maiores contratos do ano ───
  const yearStart = startOfYear(now);
  const topContratos = [...contratos]
    .filter(c => c.status === 'assinado' && new Date(signedDate(c)) >= yearStart)
    .sort((a, b) => (Number(b.honorarios_total) || 0) - (Number(a.honorarios_total) || 0))
    .slice(0, 10);

  // ─── B. Funil ───
  const leadsCount = contratos.length; // aproximacao: usamos total de contratos como proxy de pipeline
  const criadosCount = contratos.length;
  const enviadosCount = contratos.filter(c => c.status === 'enviado_zapsign' || c.status === 'assinado').length;
  const assinadosCount = assinados.length;

  // ─── B. Tempo medio lead->assinatura ───
  const tempos = assinados.map(c => {
    const created = new Date(c.created_at);
    const signed = signedDate(c);
    const diff = (signed - created) / 86400000;
    return diff;
  }).filter(d => d >= 0 && d < 365);
  const tempoMedioDias = tempos.length ? tempos.reduce((s, d) => s + d, 0) / tempos.length : null;

  // ─── B. Taxa de conversao (6 meses) ───
  // (bug-5) Metrica honesta: dos contratos CRIADOS nos ultimos 6 meses (fora rascunhos), quantos
  // chegaram a ASSINAR. Base = criados; arquivados-sem-assinar contam como PERDA (ficam no
  // denominador mas nao no numerador). Antes era assinados/(assinados+cancelados) — como nunca ha
  // 'cancelado' (a equipe arquiva), dava quase sempre 100%. Usa `contratosTodos` (inclui arquivados).
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const recent = (contratosTodos || []).filter(c => new Date(c.created_at) >= sixMonthsAgo && c.status !== 'rascunho');
  const recentAssinados = recent.filter(c => c.status === 'assinado').length;
  const totalExitoBase = recent.length; // criados (assinados + nao-assinados, inclusive arquivados como perda)
  const taxaExito = totalExitoBase > 0 ? (recentAssinados / totalExitoBase) * 100 : null;

  // ─── C. Produtividade por advogado (mes atual) ───
  const advogados = {};
  contratos.forEach(c => {
    const created = new Date(c.created_at);
    if (created < monStart || created > monEnd) return;
    const email = (c.created_by || 'indefinido').toLowerCase();
    if (!advogados[email]) advogados[email] = { email, criados: 0, assinados: 0, ticket: 0, somaHonorarios: 0 };
    advogados[email].criados++;
  });
  assinados.forEach(c => {
    const d = signedDate(c);
    if (d < monStart || d > monEnd) return;
    const email = (c.updated_by || c.created_by || 'indefinido').toLowerCase();
    if (!advogados[email]) advogados[email] = { email, criados: 0, assinados: 0, ticket: 0, somaHonorarios: 0 };
    advogados[email].assinados++;
    advogados[email].somaHonorarios += Number(c.honorarios_total) || 0;
  });
  const advList = Object.values(advogados).map(a => ({
    ...a,
    taxaConv: a.criados > 0 ? (a.assinados / a.criados) * 100 : 0,
    ticket: a.assinados > 0 ? a.somaHonorarios / a.assinados : 0,
  })).sort((a, b) => b.assinados - a.assinados);

  const topAdv = advList.slice(0, 3);

  // ─── D. Crescimento YoY ───
  const yoyData = [];
  const yearAtual = now.getFullYear();
  const yearAnt = yearAtual - 1;
  for (let m = 0; m < 12; m++) {
    const s1 = new Date(yearAtual, m, 1); const e1 = endOfMonth(s1);
    const s2 = new Date(yearAnt, m, 1); const e2 = endOfMonth(s2);
    const atual = contratos.filter(c => {
      const d = new Date(c.created_at);
      return d >= s1 && d <= e1;
    }).length;
    const anterior = contratos.filter(c => {
      const d = new Date(c.created_at);
      return d >= s2 && d <= e2;
    }).length;
    yoyData.push({
      label: new Date(yearAtual, m, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
      atual, anterior,
    });
  }

  // ─── D. Top 5 resorts (volume + ticket medio) ───
  const resortMap = {};
  assinados.forEach(c => {
    const r = c.resort || 'N/I';
    if (!resortMap[r]) resortMap[r] = { resort: r, count: 0, soma: 0 };
    resortMap[r].count++;
    resortMap[r].soma += Number(c.honorarios_total) || 0;
  });
  const topResorts = Object.values(resortMap)
    .map(r => ({ ...r, ticket: r.count ? r.soma / r.count : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ─── D. Tipo de acao mais rentavel ───
  const tipoMap = {};
  assinados.forEach(c => {
    const t = c.tipo_acao || 'N/I';
    if (!tipoMap[t]) tipoMap[t] = { tipo: t, count: 0, soma: 0 };
    tipoMap[t].count++;
    tipoMap[t].soma += Number(c.honorarios_total) || 0;
  });
  const tiposRentaveis = Object.values(tipoMap)
    .map(t => ({ ...t, ticket: t.count ? t.soma / t.count : 0 }))
    .sort((a, b) => b.soma - a.soma);

  return {
    receita: { atual: receitaMesAtual, prev: receitaMesPrev, delta: receitaDelta, spark: sparkReceita },
    projecao: { total: projTotal, count: projCount },
    inadimplencia: { total: inadTotal, clientes: inadClientes, buckets: { b30: bucket30, b60: bucket60, b90: bucket90 } },
    topContratos,
    funil: { leads: leadsCount, criados: criadosCount, enviados: enviadosCount, assinados: assinadosCount },
    tempoMedioDias,
    taxaExito,
    advList,
    topAdv,
    yoy: yoyData,
    topResorts,
    tiposRentaveis,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// WIDGETS DE VENDAS/COMISSOES (Fase 5)
// ═══════════════════════════════════════════════════════════════════════

// ─── Seletor de periodo (dropdown mes, navegacao prev/next) ───
function PeriodPicker({ periodo, onChange, periodoInicioDia = 20 }) {
  const goPrev = () => onChange(shiftCommissionPeriod(periodo.inicio, -1, periodoInicioDia));
  const goNext = () => onChange(shiftCommissionPeriod(periodo.inicio, 1, periodoInicioDia));
  const goCurrent = () => onChange(getCommissionPeriod(new Date(), periodoInicioDia));
  return (
    <div className="inline-flex items-center gap-1 rounded-lg px-1 py-1"
      style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)' }}>
      <button onClick={goPrev} className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer" aria-label="Periodo anterior">
        <ChevronLeftIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-primary)' }} />
      </button>
      <button onClick={goCurrent} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 cursor-pointer"
        style={{ color: 'var(--cbc-text-primary)' }} title="Voltar para periodo atual">
        {formatPeriodLabel(periodo)}
      </button>
      <button onClick={goNext} className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer" aria-label="Proximo periodo">
        <ChevronRightIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-primary)' }} />
      </button>
    </div>
  );
}

// ─── Skeleton simples pros widgets ───
function WidgetSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-16 rounded-lg" style={{ background: 'var(--cbc-bg-subtle)' }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded" style={{ background: 'var(--cbc-bg-subtle)' }} />
      ))}
    </div>
  );
}

// ─── Modal simples (reutilizado por ver detalhes / drill-down) ───
function SimpleModal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className={`rounded-xl max-h-[85vh] overflow-hidden flex flex-col ${wide ? 'w-full max-w-4xl' : 'w-full max-w-xl'}`}
        style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--cbc-border)' }}>
          <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer" aria-label="Fechar">
            <XMarkIcon className="w-5 h-5" style={{ color: 'var(--cbc-text-primary)' }} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ─── Widget 1: Comissoes do Mes ───
function ComissoesMensaisWidget() {
  const { user } = useAuth();
  const [periodo, setPeriodo] = useState(() => getCommissionPeriod(new Date(), 20));
  const [comissoes, setComissoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tableMissing, setTableMissing] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(null);
  const [detalhesModal, setDetalhesModal] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const inicioISO = periodoInicioISO(periodo);
      const { data, error: err } = await supabase
        .from('vendas_comissoes_mensais')
        .select('*')
        .eq('periodo_inicio', inicioISO)
        .order('total_bruto', { ascending: false });
      if (err) {
        // Tabela pode nao existir ainda — graceful
        if (String(err.message || '').toLowerCase().includes('does not exist') || err.code === '42P01') {
          setTableMissing(true);
          setComissoes([]);
        } else throw err;
      } else {
        setTableMissing(false);
        setComissoes(data || []);
      }
    } catch (e) {
      setError(e.message || 'Erro ao carregar comissoes');
      console.error('[ComissoesMensaisWidget]', e);
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => { loadData(); }, [loadData]);

  const totals = useMemo(() => {
    const bruto = comissoes.reduce((s, c) => s + (Number(c.total_bruto) || 0), 0);
    const vend = comissoes.reduce((s, c) => s + (Number(c.valor_vendedora) || 0), 0);
    const assist = comissoes.reduce((s, c) => s + (Number(c.valor_assistente) || 0), 0);
    const contratos = comissoes.reduce((s, c) => s + (Number(c.contratos_count) || 0), 0);
    const bonus = comissoes.reduce((s, c) => s + (Number(c.subtotal_bonus) || 0), 0);
    return { bruto, vend, assist, contratos, bonus, liquido: bruto };
  }, [comissoes]);

  const handleRecalc = async () => {
    if (!window.confirm('Recalcular comissoes deste periodo? Isso substitui os valores atuais.')) return;
    setRecalcBusy(true);
    try {
      // O endpoint interpreta `month` como o mes em que o periodo TERMINA
      // (dia 19). Enviamos periodo.fim para bater com a convencao.
      const mesISO = `${periodo.fim.getFullYear()}-${String(periodo.fim.getMonth() + 1).padStart(2, '0')}`;
      const resp = await window.fetch(`/.netlify/functions/commission-calculator?month=${mesISO}`, { method: 'POST' });
      if (!resp.ok) throw new Error('Endpoint indisponivel ou retornou erro');
      await loadData();
    } catch (e) {
      window.alert('Recalculo nao disponivel: ' + (e.message || 'endpoint ausente'));
    } finally {
      setRecalcBusy(false);
    }
  };

  const handleMarkPaid = async (row) => {
    if (!window.confirm(`Marcar como paga a comissao de ${row.vendedora_email}?`)) return;
    setPayBusy(row.id);
    try {
      const { error: err } = await supabase
        .from('vendas_comissoes_mensais')
        .update({ status: 'paga', paga_em: new Date().toISOString(), paga_por: user?.email || null })
        .eq('id', row.id);
      if (err) throw err;
      await loadData();
    } catch (e) {
      window.alert('Erro ao marcar como paga: ' + (e.message || e));
    } finally {
      setPayBusy(null);
    }
  };

  const handleExportCSV = () => {
    const header = [
      'Dupla (vendedora)', 'Assistente', 'Contratos', 'Iniciais', 'Exito', 'FDS',
      'Bonus 100?', 'Subtotal Iniciais', 'Subtotal Exito', 'Subtotal Bonus',
      'Total Bruto', 'Valor Vendedora (70%)', 'Valor Assistente (30%)', 'Status'
    ];
    const rows = comissoes.map(c => [
      c.vendedora_email || '',
      c.assistente_email || '',
      c.contratos_count || 0,
      c.contratos_iniciais_count || 0,
      c.contratos_exito_count || 0,
      c.contratos_fds_count || 0,
      c.bonus_100_aplicado ? 'Sim' : 'Nao',
      Number(c.subtotal_iniciais || 0).toFixed(2).replace('.', ','),
      Number(c.subtotal_exito || 0).toFixed(2).replace('.', ','),
      Number(c.subtotal_bonus || 0).toFixed(2).replace('.', ','),
      Number(c.total_bruto || 0).toFixed(2).replace('.', ','),
      Number(c.valor_vendedora || 0).toFixed(2).replace('.', ','),
      Number(c.valor_assistente || 0).toFixed(2).replace('.', ','),
      c.status || '',
    ]);
    const fname = `comissoes_${periodoInicioISO(periodo)}.csv`;
    downloadCSV(fname, [header, ...rows]);
  };

  return (
    <div>
      {/* Controles topo */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <PeriodPicker periodo={periodo} onChange={setPeriodo} />
        <div className="flex items-center gap-2">
          <button onClick={handleRecalc} disabled={recalcBusy || tableMissing}
            className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--cbc-bg-card)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}>
            <ArrowPathIcon className={`w-3.5 h-3.5 ${recalcBusy ? 'animate-spin' : ''}`} />
            {recalcBusy ? 'Recalculando...' : 'Recalcular'}
          </button>
          <button onClick={handleExportCSV} disabled={comissoes.length === 0}
            className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--cbc-bg-card)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}>
            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button onClick={loadData} disabled={loading}
            className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-colors disabled:opacity-50"
            style={{ background: 'var(--cbc-bg-card)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}>
            Atualizar
          </button>
        </div>
      </div>

      {tableMissing && (
        <div className="rounded-lg p-3 text-[11px] mb-3"
          style={{ background: 'rgba(217,119,6,0.1)', color: '#D97706', border: '1px solid rgba(217,119,6,0.3)' }}>
          Tabelas de vendas ainda nao foram criadas no Supabase. Execute <code>supabase_vendas_comissoes.sql</code> para habilitar este modulo.
        </div>
      )}

      {error && !tableMissing && (
        <div className="rounded-lg p-3 text-[11px] mb-3"
          style={{ background: 'rgba(220,38,38,0.1)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.3)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <WidgetSkeleton rows={4} />
      ) : (
        <>
          {/* Card grande topo */}
          <SocioCard accent className="mb-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Total bruto</div>
                <div className="text-xl md:text-2xl font-bold mt-1" style={{ color: '#1B3A5C' }}>{formatCurrency(totals.bruto)}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Liquido a pagar</div>
                <div className="text-xl md:text-2xl font-bold mt-1" style={{ color: '#16A34A' }}>{formatCurrency(totals.liquido)}</div>
                {totals.bonus > 0 && (
                  <div className="text-[9px] mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>
                    (inclui bonus {formatCurrency(totals.bonus)})
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Split vendedoras (70%)</div>
                <div className="text-lg md:text-xl font-bold mt-1" style={{ color: 'var(--cbc-gold-dark)' }}>{formatCurrency(totals.vend)}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider mt-2" style={{ color: 'var(--cbc-text-secondary)' }}>Split assistentes (30%)</div>
                <div className="text-lg md:text-xl font-bold mt-0.5" style={{ color: '#1B3A5C' }}>{formatCurrency(totals.assist)}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Contratos totais</div>
                <div className="text-2xl md:text-3xl font-bold mt-1" style={{ color: 'var(--cbc-text-primary)' }}>{totals.contratos}</div>
                <div className="text-[10px] mt-1" style={{ color: 'var(--cbc-text-muted)' }}>
                  {comissoes.length} dupla(s) no periodo
                </div>
              </div>
            </div>
          </SocioCard>

          {/* Tabela detalhada por dupla */}
          <SocioCard>
            <SectionHeader Icon={UsersIcon} title="Detalhe por dupla (vendedora + assistente)" subtitle="Clique em detalhes para ver contratos" />
            {comissoes.length === 0 ? (
              <div className="text-center py-6 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
                {tableMissing ? 'Nao ha dados porque as tabelas ainda nao foram criadas.' : 'Nenhuma comissao calculada neste periodo.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* (mobile-4) min-width no phone p/ rolar lateralmente em vez de espremer 11 colunas */}
                <table className="w-full text-[11px] max-sm:min-w-[820px]">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                      <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Dupla</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Contr.</th>
                      <th className="text-center py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Faixa</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Sub. Inic.</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Sub. Exito</th>
                      <th className="text-center py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Bonus 100?</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Bruto</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Vend. 70%</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Assist. 30%</th>
                      <th className="text-center py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Status</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comissoes.map(c => {
                      const faixa = (() => {
                        const n = Number(c.contratos_count) || 0;
                        if (n >= 61) return '61+';
                        if (n >= 41) return '41-60';
                        if (n >= 21) return '21-40';
                        if (n >= 1) return '1-20';
                        return '—';
                      })();
                      return (
                        <tr key={c.id} className="border-b hover:bg-black/5 dark:hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--cbc-border)' }}>
                          <td className="py-2 px-2" style={{ color: 'var(--cbc-text-primary)' }}>
                            <div className="font-bold truncate max-w-[180px]">{c.vendedora_email}</div>
                            {c.assistente_email && <div className="text-[9px] truncate max-w-[180px]" style={{ color: 'var(--cbc-text-muted)' }}>+ {c.assistente_email}</div>}
                          </td>
                          <td className="py-2 px-2 text-right font-bold" style={{ color: '#1B3A5C' }}>{c.contratos_count || 0}</td>
                          <td className="py-2 px-2 text-center">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-secondary)' }}>{faixa}</span>
                          </td>
                          <td className="py-2 px-2 text-right" style={{ color: 'var(--cbc-text-secondary)' }}>{formatCompactBRL(c.subtotal_iniciais)}</td>
                          <td className="py-2 px-2 text-right" style={{ color: 'var(--cbc-text-secondary)' }}>{formatCompactBRL(c.subtotal_exito)}</td>
                          <td className="py-2 px-2 text-center">
                            {c.bonus_100_aplicado ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#F0FDF4', color: '#16A34A' }}>SIM</span>
                            ) : (
                              <span className="text-[9px]" style={{ color: 'var(--cbc-text-muted)' }}>—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-bold" style={{ color: '#1B3A5C' }}>{formatCurrency(c.total_bruto)}</td>
                          <td className="py-2 px-2 text-right" style={{ color: 'var(--cbc-gold-dark)' }}>{formatCompactBRL(c.valor_vendedora)}</td>
                          <td className="py-2 px-2 text-right" style={{ color: '#1B3A5C' }}>{formatCompactBRL(c.valor_assistente)}</td>
                          <td className="py-2 px-2 text-center">
                            {c.status === 'paga' ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#F0FDF4', color: '#16A34A' }}>PAGA</span>
                            ) : c.status === 'revisao' ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#D97706' }}>REVISAO</span>
                            ) : (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#EFF6FF', color: '#2563EB' }}>CALCULADA</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap">
                            <button onClick={() => setDetalhesModal(c)}
                              className="text-[9px] font-bold uppercase px-2 py-1 rounded cursor-pointer mr-1 inline-flex items-center gap-0.5"
                              style={{ background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}>
                              <EyeIcon className="w-3 h-3" /> Ver
                            </button>
                            {c.status !== 'paga' && (
                              <button onClick={() => handleMarkPaid(c)}
                                disabled={payBusy === c.id}
                                className="text-[9px] font-bold uppercase px-2 py-1 rounded cursor-pointer disabled:opacity-50"
                                style={{ background: '#16A34A', color: 'white' }}>
                                {payBusy === c.id ? '...' : 'Marcar paga'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SocioCard>
        </>
      )}

      {detalhesModal && (
        <ComissaoDetalhesModal comissao={detalhesModal} onClose={() => setDetalhesModal(null)} />
      )}
    </div>
  );
}

// ─── Modal de detalhes (lista contratos que compoem a comissao) ───
function ComissaoDetalhesModal({ comissao, onClose }) {
  const [detalhes, setDetalhes] = useState([]);
  const [contratosMap, setContratosMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('vendas_comissoes_detalhe')
          .select('*')
          .eq('comissao_id', comissao.id)
          .order('valor_final', { ascending: false });
        if (error) throw error;
        if (!active) return;
        setDetalhes(data || []);

        // Hydrate contrato info
        const contratoIds = [...new Set((data || []).map(d => d.contrato_id).filter(Boolean))];
        if (contratoIds.length) {
          const { data: cData } = await supabase
            .from('contratos')
            .select('id, nome_contratante1, resort, tipo_acao, honorarios_total, signed_at')
            .in('id', contratoIds);
          if (!active) return;
          const map = {};
          (cData || []).forEach(c => { map[c.id] = c; });
          setContratosMap(map);
        }
      } catch (e) {
        if (active) setErr(e.message || 'Erro ao carregar detalhes');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [comissao.id]);

  return (
    <SimpleModal title={`Detalhes comissao — ${comissao.vendedora_email}`} onClose={onClose} wide>
      {loading ? (
        <WidgetSkeleton rows={5} />
      ) : err ? (
        <div className="text-[11px]" style={{ color: '#DC2626' }}>{err}</div>
      ) : detalhes.length === 0 ? (
        <div className="text-center py-4 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Nenhum contrato detalhado registrado para esta comissao.
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* (mobile-4) min-width no phone p/ rolar lateralmente em vez de espremer as 9 colunas */}
          <table className="w-full text-[11px] max-sm:min-w-[700px]">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Cliente</th>
                <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Resort</th>
                <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Tipo</th>
                <th className="text-center py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Comissao</th>
                <th className="text-center py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Faixa</th>
                <th className="text-center py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>FDS</th>
                <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Base</th>
                <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Peso</th>
                <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Final</th>
              </tr>
            </thead>
            <tbody>
              {detalhes.map(d => {
                const c = contratosMap[d.contrato_id];
                return (
                  <tr key={d.id} className={`border-b ${!d.elegivel ? 'opacity-60' : ''}`} style={{ borderColor: 'var(--cbc-border)' }}>
                    <td className="py-2 px-2 truncate max-w-[160px]" style={{ color: 'var(--cbc-text-primary)' }}>
                      {c?.nome_contratante1 || d.contrato_id?.slice(0, 8) || '—'}
                    </td>
                    <td className="py-2 px-2 truncate max-w-[140px]" style={{ color: 'var(--cbc-text-secondary)' }}>{c?.resort || '—'}</td>
                    <td className="py-2 px-2 truncate max-w-[120px]" style={{ color: 'var(--cbc-text-secondary)' }}>{c?.tipo_acao || '—'}</td>
                    <td className="py-2 px-2 text-center">
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: d.tipo_comissao === 'iniciais' ? '#EFF6FF' : '#FFFBEB', color: d.tipo_comissao === 'iniciais' ? '#2563EB' : '#D97706' }}>
                        {d.tipo_comissao?.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>{d.faixa_aplicada || '—'}</td>
                    <td className="py-2 px-2 text-center">
                      {d.fim_de_semana ? <span className="text-[10px]">🏖️</span> : <span className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>—</span>}
                    </td>
                    <td className="py-2 px-2 text-right" style={{ color: 'var(--cbc-text-secondary)' }}>{formatCurrency(d.valor_base)}</td>
                    <td className="py-2 px-2 text-right font-bold" style={{ color: d.peso_aplicado > 1 ? '#C9A84C' : 'var(--cbc-text-muted)' }}>
                      x{Number(d.peso_aplicado || 1).toFixed(1)}
                    </td>
                    <td className="py-2 px-2 text-right font-bold" style={{ color: '#1B3A5C' }}>{formatCurrency(d.valor_final)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SimpleModal>
  );
}

// ─── Widget 2: Ranking de Duplas ───
function RankingDuplasWidget() {
  const [periodo, setPeriodo] = useState(() => getCommissionPeriod(new Date(), 20));
  const [comissoes, setComissoes] = useState([]);
  const [metas, setMetas] = useState([]);
  const [sparkMap, setSparkMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tableMissing, setTableMissing] = useState(false);
  const [drillDuo, setDrillDuo] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const inicioISO = periodoInicioISO(periodo);
      const { data, error } = await supabase
        .from('vendas_comissoes_mensais')
        .select('*')
        .eq('periodo_inicio', inicioISO)
        .order('contratos_count', { ascending: false });
      if (error) {
        if (String(error.message || '').toLowerCase().includes('does not exist') || error.code === '42P01') {
          setTableMissing(true);
          setComissoes([]);
          setMetas([]);
          setSparkMap({});
          return;
        }
        throw error;
      }
      setTableMissing(false);
      setComissoes(data || []);

      // Metas do periodo
      const { data: mData } = await supabase
        .from('vendas_metas')
        .select('*')
        .eq('periodo_inicio', inicioISO);
      setMetas(mData || []);

      // Historico ultimos 6 meses para sparkline
      const sparkStart = shiftCommissionPeriod(periodo.inicio, -5, 20);
      const sparkStartISO = periodoInicioISO(sparkStart);
      const { data: hData } = await supabase
        .from('vendas_comissoes_mensais')
        .select('vendedora_email, periodo_inicio, contratos_count')
        .gte('periodo_inicio', sparkStartISO)
        .lte('periodo_inicio', inicioISO)
        .order('periodo_inicio', { ascending: true });
      const map = {};
      (hData || []).forEach(h => {
        if (!map[h.vendedora_email]) map[h.vendedora_email] = [];
        map[h.vendedora_email].push(h.contratos_count || 0);
      });
      setSparkMap(map);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar ranking');
      console.error('[RankingDuplasWidget]', e);
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => { loadData(); }, [loadData]);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <PeriodPicker periodo={periodo} onChange={setPeriodo} />
        <button onClick={loadData} disabled={loading}
          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-colors disabled:opacity-50"
          style={{ background: 'var(--cbc-bg-card)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}>
          Atualizar
        </button>
      </div>

      {tableMissing && (
        <div className="rounded-lg p-3 text-[11px] mb-3"
          style={{ background: 'rgba(217,119,6,0.1)', color: '#D97706', border: '1px solid rgba(217,119,6,0.3)' }}>
          Modulo de vendas ainda nao configurado no banco.
        </div>
      )}

      {err && !tableMissing && (
        <div className="rounded-lg p-3 text-[11px] mb-3" style={{ background: 'rgba(220,38,38,0.1)', color: '#DC2626' }}>{err}</div>
      )}

      {loading ? (
        <WidgetSkeleton rows={3} />
      ) : comissoes.length === 0 ? (
        <div className="text-center py-6 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Sem duplas com comissao calculada neste periodo.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {comissoes.slice(0, 3).map((c, i) => {
            const meta = metas.find(m => m.vendedora_email === c.vendedora_email);
            const pct = meta?.meta_contratos > 0 ? Math.min((c.contratos_count / meta.meta_contratos) * 100, 150) : null;
            const barColor = pct === null ? '#9CA3AF' : pct >= 100 ? '#16A34A' : pct >= 70 ? '#C9A84C' : '#DC2626';
            const spark = sparkMap[c.vendedora_email] || [];
            return (
              <SocioCard key={c.id} accent={i === 0}>
                <div className="flex items-start gap-3 mb-2">
                  <div className="text-3xl leading-none">{medals[i]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold truncate" style={{ color: 'var(--cbc-text-primary)' }}>
                      Dupla {i + 1}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--cbc-text-muted)' }}>
                      {c.vendedora_email}
                    </div>
                    {c.assistente_email && (
                      <div className="text-[10px] truncate" style={{ color: 'var(--cbc-text-muted)' }}>
                        + {c.assistente_email}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <div className="text-[9px] uppercase font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Contratos</div>
                    <div className="text-xl font-bold" style={{ color: '#1B3A5C' }}>{c.contratos_count || 0}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Bruto</div>
                    <div className="text-xl font-bold" style={{ color: 'var(--cbc-gold-dark)' }}>{formatCompactBRL(c.total_bruto)}</div>
                  </div>
                </div>
                {meta && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-[9px]" style={{ color: 'var(--cbc-text-muted)' }}>
                      <span>Meta: {meta.meta_contratos}</span>
                      <span>{pct !== null ? `${pct.toFixed(0)}%` : '—'}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden mt-0.5" style={{ background: 'var(--cbc-bg-subtle)' }}>
                      <div className="h-full transition-all" style={{ width: `${Math.min(pct || 0, 100)}%`, background: barColor }} />
                    </div>
                  </div>
                )}
                {spark.length >= 2 && (
                  <div>
                    <div className="text-[9px] uppercase font-bold mb-0.5" style={{ color: 'var(--cbc-text-secondary)' }}>Ultimos 6 meses</div>
                    <Sparkline points={spark} color="#C9A84C" height={28} />
                  </div>
                )}
                <button onClick={() => setDrillDuo(c)}
                  className="mt-2 w-full text-[9px] font-bold uppercase py-1.5 rounded cursor-pointer transition-colors inline-flex items-center justify-center gap-1"
                  style={{ background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}>
                  <EyeIcon className="w-3 h-3" /> Drill-down
                </button>
              </SocioCard>
            );
          })}
        </div>
      )}

      {drillDuo && <DuplaDrillDownModal comissao={drillDuo} onClose={() => setDrillDuo(null)} />}
    </div>
  );
}

// ─── Drill-down da dupla ───
function DuplaDrillDownModal({ comissao, onClose }) {
  const [contratos, setContratos] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        // Contratos da vendedora no periodo
        const { data: cData } = await supabase
          .from('contratos')
          .select('id, nome_contratante1, resort, tipo_acao, honorarios_total, status, signed_at, created_at, fim_de_semana_atendimento')
          .eq('vendedora_email', comissao.vendedora_email)
          .gte('created_at', comissao.periodo_inicio)
          .lte('created_at', comissao.periodo_fim)
          .order('created_at', { ascending: false });
        // Historico 6 ultimos meses
        const sparkStart = shiftCommissionPeriod(new Date(comissao.periodo_inicio), -5, 20);
        const { data: hData } = await supabase
          .from('vendas_comissoes_mensais')
          .select('periodo_inicio, periodo_fim, contratos_count, total_bruto, valor_vendedora, status')
          .eq('vendedora_email', comissao.vendedora_email)
          .gte('periodo_inicio', periodoInicioISO(sparkStart))
          .order('periodo_inicio', { ascending: false });
        if (!active) return;
        setContratos(cData || []);
        setHistorico(hData || []);
      } catch (e) {
        console.error('[DuplaDrillDown]', e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [comissao]);

  return (
    <SimpleModal title={`Dupla: ${comissao.vendedora_email}`} onClose={onClose} wide>
      {loading ? (
        <WidgetSkeleton rows={5} />
      ) : (
        <div className="space-y-4">
          {/* Metricas resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <SocioCard>
              <div className="text-[9px] uppercase font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Contratos</div>
              <div className="text-xl font-bold" style={{ color: '#1B3A5C' }}>{comissao.contratos_count || 0}</div>
            </SocioCard>
            <SocioCard>
              <div className="text-[9px] uppercase font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Bruto</div>
              <div className="text-xl font-bold" style={{ color: 'var(--cbc-gold-dark)' }}>{formatCompactBRL(comissao.total_bruto)}</div>
            </SocioCard>
            <SocioCard>
              <div className="text-[9px] uppercase font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Vend. 70%</div>
              <div className="text-xl font-bold" style={{ color: '#16A34A' }}>{formatCompactBRL(comissao.valor_vendedora)}</div>
            </SocioCard>
            <SocioCard>
              <div className="text-[9px] uppercase font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Assist. 30%</div>
              <div className="text-xl font-bold" style={{ color: '#1B3A5C' }}>{formatCompactBRL(comissao.valor_assistente)}</div>
            </SocioCard>
          </div>

          {/* Historico */}
          {historico.length > 0 && (
            <div>
              <h4 className="text-xs font-bold mb-2" style={{ color: 'var(--cbc-text-primary)' }}>Historico ultimos 6 meses</h4>
              <div className="overflow-x-auto">
                {/* (mobile-4) min-width no phone p/ rolar lateralmente em vez de espremer as colunas */}
                <table className="w-full text-[11px] max-sm:min-w-[480px]">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                      <th className="text-left py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Periodo</th>
                      <th className="text-right py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Contratos</th>
                      <th className="text-right py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Bruto</th>
                      <th className="text-right py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Vendedora</th>
                      <th className="text-center py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map(h => (
                      <tr key={h.periodo_inicio} className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                        <td className="py-1 px-2" style={{ color: 'var(--cbc-text-primary)' }}>
                          {fmtDate(h.periodo_inicio)} → {fmtDate(h.periodo_fim)}
                        </td>
                        <td className="py-1 px-2 text-right font-bold" style={{ color: '#1B3A5C' }}>{h.contratos_count}</td>
                        <td className="py-1 px-2 text-right" style={{ color: 'var(--cbc-text-secondary)' }}>{formatCurrency(h.total_bruto)}</td>
                        <td className="py-1 px-2 text-right" style={{ color: 'var(--cbc-gold-dark)' }}>{formatCurrency(h.valor_vendedora)}</td>
                        <td className="py-1 px-2 text-center text-[9px]">{h.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Contratos do periodo */}
          <div>
            <h4 className="text-xs font-bold mb-2" style={{ color: 'var(--cbc-text-primary)' }}>Contratos do periodo ({contratos.length})</h4>
            {contratos.length === 0 ? (
              <div className="text-center py-4 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
                Nenhum contrato no periodo. (Pode ser que `vendedora_email` ainda nao foi preenchido nos contratos.)
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* (mobile-4) min-width no phone p/ rolar lateralmente em vez de espremer as 6 colunas */}
                <table className="w-full text-[11px] max-sm:min-w-[520px]">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                      <th className="text-left py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Cliente</th>
                      <th className="text-left py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Resort</th>
                      <th className="text-left py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Tipo</th>
                      <th className="text-right py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Honor.</th>
                      <th className="text-center py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Status</th>
                      <th className="text-center py-1 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>FDS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contratos.map(c => (
                      <tr key={c.id} className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                        <td className="py-1 px-2 truncate max-w-[160px]" style={{ color: 'var(--cbc-text-primary)' }}>{c.nome_contratante1 || '—'}</td>
                        <td className="py-1 px-2 truncate max-w-[140px]" style={{ color: 'var(--cbc-text-secondary)' }}>{c.resort || '—'}</td>
                        <td className="py-1 px-2 truncate max-w-[120px]" style={{ color: 'var(--cbc-text-secondary)' }}>{c.tipo_acao || '—'}</td>
                        <td className="py-1 px-2 text-right font-bold" style={{ color: '#1B3A5C' }}>{formatCurrency(c.honorarios_total)}</td>
                        <td className="py-1 px-2 text-center text-[9px]">{c.status}</td>
                        <td className="py-1 px-2 text-center">{c.fim_de_semana_atendimento ? '🏖️' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </SimpleModal>
  );
}

// ─── Widget 3: Expectativa de Honorarios ───
function ExpectativaHonorariosWidget() {
  const [contratos, setContratos] = useState([]);
  const [expectativa, setExpectativa] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const now = new Date();
        const mStart = startOfMonth(now);
        const mEnd = endOfMonth(now);
        // Contratos assinados no mes
        const { data: cData, error: cErr } = await supabase
          .from('contratos')
          .select('id, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, status, signed_at, created_at')
          .in('status', ['assinado', 'enviado_zapsign'])
          .gte('created_at', mStart.toISOString())
          .lte('created_at', mEnd.toISOString());
        if (cErr) throw cErr;
        if (!active) return;
        setContratos(cData || []);

        // Expectativas
        const { data: eData, error: eErr } = await supabase
          .from('vendas_expectativa_honorarios')
          .select('*');
        if (eErr) {
          if (String(eErr.message || '').toLowerCase().includes('does not exist') || eErr.code === '42P01') {
            if (active) setTableMissing(true);
          } else throw eErr;
        } else if (active) {
          setExpectativa(eData || []);
        }
      } catch (e) {
        if (active) setErr(e.message || 'Erro ao carregar expectativa');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Lookup expectativa por resort+tipo
  const expMap = useMemo(() => {
    const m = {};
    expectativa.forEach(e => { m[`${e.resort}||${e.tipo_acao}`] = e; });
    return m;
  }, [expectativa]);

  const computed = useMemo(() => {
    let receitaGarantida = 0;
    let receitaEsperada = 0;
    let tempoPonderado = 0;
    let tempoBase = 0;
    const pivot = {};
    contratos.forEach(c => {
      const honor = Number(c.honorarios_total) || 0;
      receitaGarantida += honor;
      const exp = expMap[`${c.resort}||${c.tipo_acao}`];
      if (exp) {
        const vm = Number(exp.valor_medio_sentenca) || 0;
        const pp = Number(exp.percentual_praticado) || 0;
        const projExito = (vm * pp) / 100;
        receitaEsperada += projExito;
        if (exp.tempo_medio_meses) {
          tempoPonderado += Number(exp.tempo_medio_meses) * projExito;
          tempoBase += projExito;
        }
        // pivot
        if (!pivot[c.resort]) pivot[c.resort] = {};
        pivot[c.resort][c.tipo_acao] = (pivot[c.resort][c.tipo_acao] || 0) + projExito;
      }
    });
    const tempoMedioPond = tempoBase > 0 ? tempoPonderado / tempoBase : 0;
    return {
      receitaGarantida,
      receitaEsperada,
      receitaFutura: receitaGarantida + receitaEsperada,
      tempoMedioPond,
      pivot,
      totalContratos: contratos.length,
      comExpectativa: contratos.filter(c => expMap[`${c.resort}||${c.tipo_acao}`]).length,
    };
  }, [contratos, expMap]);

  // Lista de resorts e tipos para tabela pivo
  const resortsLista = useMemo(() => Object.keys(computed.pivot).sort(), [computed.pivot]);
  const tiposLista = useMemo(() => {
    const set = new Set();
    Object.values(computed.pivot).forEach(row => Object.keys(row).forEach(t => set.add(t)));
    return [...set].sort();
  }, [computed.pivot]);

  return (
    <div>
      {tableMissing && (
        <div className="rounded-lg p-3 text-[11px] mb-3"
          style={{ background: 'rgba(217,119,6,0.1)', color: '#D97706', border: '1px solid rgba(217,119,6,0.3)' }}>
          Tabela de expectativa ainda nao criada. Rode <code>supabase_vendas_comissoes.sql</code>.
        </div>
      )}
      {err && !tableMissing && (
        <div className="rounded-lg p-3 text-[11px] mb-3" style={{ background: 'rgba(220,38,38,0.1)', color: '#DC2626' }}>{err}</div>
      )}
      {loading ? (
        <WidgetSkeleton rows={3} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <SocioCard accent>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Receita garantida</div>
              <div className="text-xl md:text-2xl font-bold mt-1" style={{ color: '#16A34A' }}>{formatCompactBRL(computed.receitaGarantida)}</div>
              <div className="text-[9px] mt-1" style={{ color: 'var(--cbc-text-muted)' }}>
                Iniciais ja faturadas · {computed.totalContratos} contratos do mes
              </div>
            </SocioCard>
            <SocioCard>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Expectativa exito</div>
              <div className="text-xl md:text-2xl font-bold mt-1" style={{ color: 'var(--cbc-gold-dark)' }}>{formatCompactBRL(computed.receitaEsperada)}</div>
              <div className="text-[9px] mt-1" style={{ color: 'var(--cbc-text-muted)' }}>
                Matematica da expectativa · {computed.comExpectativa} com referencia
              </div>
            </SocioCard>
            <SocioCard>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Receita futura projetada</div>
              <div className="text-xl md:text-2xl font-bold mt-1" style={{ color: '#1B3A5C' }}>{formatCompactBRL(computed.receitaFutura)}</div>
              <div className="text-[9px] mt-1" style={{ color: 'var(--cbc-text-muted)' }}>
                Tempo medio ponderado: {computed.tempoMedioPond > 0 ? `${computed.tempoMedioPond.toFixed(1)} meses` : '—'}
              </div>
            </SocioCard>
          </div>

          {/* Pivo resort x tipo */}
          <SocioCard>
            <SectionHeader Icon={BuildingOffice2Icon} title="Expectativa por Resort x Tipo de Acao" subtitle="Total projetado de exito" />
            {resortsLista.length === 0 ? (
              <div className="text-center py-4 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
                Sem expectativas cadastradas ou sem contratos casando com referencia.
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* (mobile-4) min-width no phone: matriz resort x tipo cresce com o nº de tipos, precisa rolar */}
                <table className="w-full text-[11px] max-sm:min-w-[640px]">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                      <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Resort \ Tipo</th>
                      {tiposLista.map(t => (
                        <th key={t} className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>{t}</th>
                      ))}
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resortsLista.map(r => {
                      const total = tiposLista.reduce((s, t) => s + (computed.pivot[r][t] || 0), 0);
                      return (
                        <tr key={r} className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                          <td className="py-2 px-2 font-bold truncate max-w-[160px]" style={{ color: 'var(--cbc-text-primary)' }}>{r}</td>
                          {tiposLista.map(t => (
                            <td key={t} className="py-2 px-2 text-right" style={{ color: computed.pivot[r][t] ? 'var(--cbc-text-primary)' : 'var(--cbc-text-muted)' }}>
                              {computed.pivot[r][t] ? formatCompactBRL(computed.pivot[r][t]) : '—'}
                            </td>
                          ))}
                          <td className="py-2 px-2 text-right font-bold" style={{ color: 'var(--cbc-gold-dark)' }}>{formatCompactBRL(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SocioCard>
        </>
      )}
    </div>
  );
}

// ─── Widget 4: Metas Individuais ───
function MetasIndividuaisWidget() {
  const [periodo, setPeriodo] = useState(() => getCommissionPeriod(new Date(), 20));
  const [metas, setMetas] = useState([]);
  const [comissoes, setComissoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tableMissing, setTableMissing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const inicioISO = periodoInicioISO(periodo);
      const { data: mData, error: mErr } = await supabase
        .from('vendas_metas')
        .select('*')
        .eq('periodo_inicio', inicioISO);
      if (mErr) {
        if (String(mErr.message || '').toLowerCase().includes('does not exist') || mErr.code === '42P01') {
          setTableMissing(true);
          setMetas([]);
          setComissoes([]);
          return;
        }
        throw mErr;
      }
      setTableMissing(false);
      setMetas(mData || []);

      const { data: cData } = await supabase
        .from('vendas_comissoes_mensais')
        .select('vendedora_email, contratos_count, total_bruto')
        .eq('periodo_inicio', inicioISO);
      setComissoes(cData || []);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar metas');
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const linhas = useMemo(() => {
    const byEmail = {};
    metas.forEach(m => { byEmail[m.vendedora_email] = { meta: m, realizado: null }; });
    comissoes.forEach(c => {
      if (!byEmail[c.vendedora_email]) byEmail[c.vendedora_email] = { meta: null, realizado: null };
      byEmail[c.vendedora_email].realizado = c;
    });
    return Object.entries(byEmail).map(([email, v]) => {
      const meta = v.meta || {};
      const real = v.realizado || {};
      const metaC = Number(meta.meta_contratos || 0);
      const realC = Number(real.contratos_count || 0);
      const pctC = metaC > 0 ? Math.min((realC / metaC) * 100, 200) : null;
      const metaV = Number(meta.meta_valor_brl || 0);
      const realV = Number(real.total_bruto || 0);
      const pctV = metaV > 0 ? Math.min((realV / metaV) * 100, 200) : null;
      return { email, metaC, realC, pctC, metaV, realV, pctV };
    }).sort((a, b) => (b.pctC || 0) - (a.pctC || 0));
  }, [metas, comissoes]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <PeriodPicker periodo={periodo} onChange={setPeriodo} />
        <button onClick={fetchData} disabled={loading}
          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-colors disabled:opacity-50"
          style={{ background: 'var(--cbc-bg-card)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}>
          Atualizar
        </button>
      </div>

      {tableMissing && (
        <div className="rounded-lg p-3 text-[11px] mb-3"
          style={{ background: 'rgba(217,119,6,0.1)', color: '#D97706', border: '1px solid rgba(217,119,6,0.3)' }}>
          Tabela de metas ainda nao criada. Rode <code>supabase_vendas_comissoes.sql</code> e cadastre metas na Parametrizacao.
        </div>
      )}
      {err && !tableMissing && (
        <div className="rounded-lg p-3 text-[11px] mb-3" style={{ background: 'rgba(220,38,38,0.1)', color: '#DC2626' }}>{err}</div>
      )}

      {loading ? (
        <WidgetSkeleton rows={4} />
      ) : linhas.length === 0 ? (
        <div className="text-center py-6 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Sem metas ou realizados cadastrados neste periodo. Configure metas em "Parametrizacao de Vendas".
        </div>
      ) : (
        <SocioCard>
          <div className="overflow-x-auto">
            {/* (mobile-4) min-width no phone p/ rolar lateralmente em vez de espremer as 7 colunas */}
            <table className="w-full text-[11px] max-sm:min-w-[560px]">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                  <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Vendedora</th>
                  <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Meta #</th>
                  <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Realiz. #</th>
                  <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>% Atingido</th>
                  <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Meta R$</th>
                  <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Realiz. R$</th>
                  <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>% R$</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => {
                  const colorC = l.pctC === null ? '#9CA3AF' : l.pctC >= 100 ? '#16A34A' : l.pctC >= 70 ? '#C9A84C' : '#DC2626';
                  const colorV = l.pctV === null ? '#9CA3AF' : l.pctV >= 100 ? '#16A34A' : l.pctV >= 70 ? '#C9A84C' : '#DC2626';
                  return (
                    <tr key={l.email} className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                      <td className="py-2 px-2 truncate max-w-[200px]" style={{ color: 'var(--cbc-text-primary)' }}>{l.email}</td>
                      <td className="py-2 px-2 text-right" style={{ color: 'var(--cbc-text-secondary)' }}>{l.metaC || '—'}</td>
                      <td className="py-2 px-2 text-right font-bold" style={{ color: '#1B3A5C' }}>{l.realC}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                            <div className="h-full transition-all" style={{ width: `${Math.min(l.pctC || 0, 100)}%`, background: colorC }} />
                          </div>
                          <span className="text-[10px] font-bold w-10 text-right" style={{ color: colorC }}>
                            {l.pctC !== null ? `${l.pctC.toFixed(0)}%` : '—'}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right" style={{ color: 'var(--cbc-text-secondary)' }}>{l.metaV ? formatCompactBRL(l.metaV) : '—'}</td>
                      <td className="py-2 px-2 text-right font-bold" style={{ color: '#1B3A5C' }}>{formatCompactBRL(l.realV)}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                            <div className="h-full transition-all" style={{ width: `${Math.min(l.pctV || 0, 100)}%`, background: colorV }} />
                          </div>
                          <span className="text-[10px] font-bold w-10 text-right" style={{ color: colorV }}>
                            {l.pctV !== null ? `${l.pctV.toFixed(0)}%` : '—'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SocioCard>
      )}
    </div>
  );
}

// ─── Component principal ───
export default function SociosDashboard() {
  const { user } = useAuth();
  const [contratos, setContratos] = useState([]);
  const [boletos, setBoletos] = useState([]);
  const [perfisMap, setPerfisMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [perfilFiltro, setPerfilFiltro] = useState('todos'); // todos|vendedora|assistente|advogado|socio

  // Gate de acesso — somente socios
  const allowed = useMemo(() => {
    const email = user?.email?.toLowerCase();
    return email && SOCIOS_EMAILS.includes(email);
  }, [user?.email]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Buscar contratos
      // (bug-6) +advbox_date (data efetiva de assinatura igual ao Dashboard) e +arquivado_em
      // (computeSociosStats exclui arquivados das metricas; so a taxa de conversao usa o conjunto completo)
      const { data: cData, error: cErr } = await supabase
        .from('contratos')
        .select('id, nome_contratante1, resort, tipo_acao, honorarios_total, status, created_at, updated_at, signed_at, advbox_date, arquivado_em, created_by, updated_by')
        .order('created_at', { ascending: false });
      if (cErr) throw cErr;
      setContratos(cData || []);

      // Buscar boletos (tabela asaas_boletos — tolerancia a tabela ausente)
      try {
        const { data: bData } = await supabase
          .from('asaas_boletos')
          .select('id, status, value, due_date, customer_id, customer, customer_name')
          .order('due_date', { ascending: true });
        setBoletos(bData || []);
      } catch {
        setBoletos([]);
      }

      // Buscar perfis (user_permissions) p/ coluna Perfil na tabela de produtividade
      try {
        const { data: uData } = await supabase
          .from('user_permissions')
          .select('email, is_admin, perfil_vendas');
        const map = {};
        (uData || []).forEach(u => {
          const email = (u.email || '').toLowerCase();
          if (!email) return;
          let perfil = 'advogado';
          if (u.is_admin) perfil = 'socio';
          else if (u.perfil_vendas === 'vendedora') perfil = 'vendedora';
          else if (u.perfil_vendas === 'assistente') perfil = 'assistente';
          map[email] = perfil;
        });
        setPerfisMap(map);
      } catch {
        setPerfisMap({});
      }
    } catch (err) {
      setError('Erro ao carregar dados do dashboard dos socios');
      console.error('[SociosDashboard]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) fetchAll();
    else setLoading(false);
  }, [allowed, fetchAll]);

  const stats = useMemo(() => {
    if (!contratos.length && !boletos.length) return null;
    return computeSociosStats(contratos, boletos);
  }, [contratos, boletos]);

  // ─── Gate de acesso ───
  if (!allowed) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6" style={{ background: 'var(--cbc-bg)' }}>
        <div className="max-w-md text-center">
          <BriefcaseIcon className="w-14 h-14 mx-auto mb-4" style={{ color: 'var(--cbc-gold, #C9A84C)' }} aria-hidden="true" />
          <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--cbc-text-primary)' }}>
            Acesso restrito aos socios
          </h2>
          <p className="text-sm" style={{ color: 'var(--cbc-text-secondary)' }}>
            Esta area e exclusiva dos socios da CBC. Se voce acredita que deveria ter acesso, entre em contato com o administrador.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !stats) return <SkeletonDashboard />;

  if (error) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--cbc-bg)' }}>
        <ErrorState
          icon={<ExclamationTriangleIcon className="w-8 h-8 text-amber-500" aria-hidden="true" />}
          title="Nao foi possivel carregar o dashboard"
          message="Verifique sua conexao com a internet."
          suggestion="Se o problema persistir, recarregue a pagina ou tente novamente."
          onRetry={() => { setError(''); fetchAll(); }}
        />
      </div>
    );
  }

  if (!stats) return null;

  const goldColor = '#C9A84C';
  const navyColor = '#1B3A5C';
  const successColor = '#16A34A';
  const dangerColor = '#DC2626';

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5 overflow-y-auto h-full" style={{ background: 'var(--cbc-bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: navyColor, color: goldColor }}>
            <BriefcaseIcon className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-wide" style={{ color: 'var(--cbc-text-primary)' }}>
              Dashboard dos Socios
            </h1>
            <p className="text-[11px] md:text-xs" style={{ color: 'var(--cbc-text-secondary)' }}>
              Visao estrategica — acesso restrito · Atualizado em {new Date().toLocaleString('pt-BR')}
            </p>
          </div>
        </div>
        <button
          onClick={fetchAll}
          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-colors"
          style={{ background: 'var(--cbc-bg-card)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}
        >
          Atualizar
        </button>
      </div>

      {/* ═══ NOVAS SECOES PRIORITARIAS DE VENDAS/COMISSOES ═══ */}

      {/* Comissoes do Mes */}
      <Accordion Icon={BanknotesIcon} title="Comissoes do Mes" subtitle="Fechamento mensal da dupla vendedora+assistente" defaultOpen={true}>
        <ComissoesMensaisWidget />
      </Accordion>

      {/* Ranking de Duplas */}
      <Accordion Icon={TrophyIcon} title="Ranking de Duplas" subtitle="Podio de vendas do periodo" defaultOpen={false}>
        <RankingDuplasWidget />
      </Accordion>

      {/* Expectativa de Honorarios */}
      <Accordion Icon={ChartBarIcon} title="Expectativa de Honorarios" subtitle="Projecao de receita futura por resort e tipo" defaultOpen={false}>
        <ExpectativaHonorariosWidget />
      </Accordion>

      {/* Metas Individuais */}
      <Accordion Icon={FlagIcon} title="Metas Individuais" subtitle="Realizado vs meta por vendedora" defaultOpen={false}>
        <MetasIndividuaisWidget />
      </Accordion>

      {/* ═══ SECAO A — VISAO FINANCEIRA ═══ */}
      <Accordion Icon={CurrencyDollarIcon} title="Visao Financeira" subtitle="Receita, projecoes, inadimplencia e top contratos">
        {/* Cards superiores */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {/* Receita mes atual vs anterior */}
          <SocioCard accent>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Receita do Mes</div>
                <div className="text-xl md:text-2xl font-bold mt-1" style={{ color: navyColor }}>{formatCompactBRL(stats.receita.atual)}</div>
              </div>
              {stats.receita.delta !== null && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                  style={{ background: stats.receita.delta >= 0 ? '#F0FDF4' : '#FEF2F2', color: stats.receita.delta >= 0 ? successColor : dangerColor }}>
                  {stats.receita.delta >= 0 ? <ArrowTrendingUpIcon className="w-3 h-3" /> : <ArrowTrendingDownIcon className="w-3 h-3" />}
                  {fmtPct(stats.receita.delta)}
                </span>
              )}
            </div>
            <div className="text-[10px] mb-2" style={{ color: 'var(--cbc-text-muted)' }}>
              Mes anterior: {formatCurrency(stats.receita.prev)}
            </div>
            <Sparkline points={stats.receita.spark} color={goldColor} height={32} />
            <div className="text-[9px] mt-1 text-center" style={{ color: 'var(--cbc-text-muted)' }}>6 meses</div>
          </SocioCard>

          {/* Projecao */}
          <SocioCard>
            <div className="flex items-center gap-2 mb-1">
              <BanknotesIcon className="w-4 h-4" style={{ color: successColor }} />
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Projecao ate fim do mes</div>
            </div>
            <div className="text-xl md:text-2xl font-bold mt-1" style={{ color: successColor }}>{formatCompactBRL(stats.projecao.total)}</div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--cbc-text-secondary)' }}>
              R$ {Number(stats.projecao.total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a receber ({stats.projecao.count} boletos)
            </div>
            <div className="text-[9px] mt-2" style={{ color: 'var(--cbc-text-muted)' }}>
              Baseado em boletos pendentes com vencimento ate o fim do mes
            </div>
          </SocioCard>

          {/* Inadimplencia */}
          <SocioCard>
            <div className="flex items-center gap-2 mb-1">
              <ExclamationTriangleIcon className="w-4 h-4" style={{ color: dangerColor }} />
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Inadimplencia</div>
            </div>
            <div className="text-xl md:text-2xl font-bold mt-1" style={{ color: dangerColor }}>{formatCompactBRL(stats.inadimplencia.total)}</div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--cbc-text-secondary)' }}>
              {stats.inadimplencia.clientes} cliente(s) em atraso
            </div>
            <div className="grid grid-cols-3 gap-1 mt-2">
              <div className="text-center rounded px-1 py-1" style={{ background: 'rgba(220,38,38,0.1)' }}>
                <div className="text-[11px] font-bold" style={{ color: dangerColor }}>{stats.inadimplencia.buckets.b30.length}</div>
                <div className="text-[8px]" style={{ color: 'var(--cbc-text-muted)' }}>ate 30d</div>
              </div>
              <div className="text-center rounded px-1 py-1" style={{ background: 'rgba(220,38,38,0.18)' }}>
                <div className="text-[11px] font-bold" style={{ color: dangerColor }}>{stats.inadimplencia.buckets.b60.length}</div>
                <div className="text-[8px]" style={{ color: 'var(--cbc-text-muted)' }}>31-60d</div>
              </div>
              <div className="text-center rounded px-1 py-1" style={{ background: 'rgba(220,38,38,0.28)' }}>
                <div className="text-[11px] font-bold" style={{ color: dangerColor }}>{stats.inadimplencia.buckets.b90.length}</div>
                <div className="text-[8px]" style={{ color: 'var(--cbc-text-muted)' }}>+60d</div>
              </div>
            </div>
          </SocioCard>
        </div>

        {/* Top 10 contratos do ano */}
        <SocioCard>
          <SectionHeader Icon={TrophyIcon} title={`Top 10 Maiores Contratos ${new Date().getFullYear()}`} subtitle="Ordenados por honorarios totais" />
          {stats.topContratos.length === 0 ? (
            <div className="text-center py-4 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>Nenhum contrato assinado no ano.</div>
          ) : (
            <div className="overflow-x-auto">
              {/* (mobile-4) min-width no phone p/ rolar lateralmente em vez de espremer as 5 colunas */}
              <table className="w-full text-[11px] max-sm:min-w-[460px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                    <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>#</th>
                    <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Cliente</th>
                    <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Resort</th>
                    <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Valor</th>
                    <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topContratos.map((c, i) => (
                    <tr key={c.id} className="border-b hover:bg-black/5 dark:hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--cbc-border)' }}>
                      <td className="py-2 px-2 font-bold" style={{ color: goldColor }}>{i + 1}</td>
                      <td className="py-2 px-2" style={{ color: 'var(--cbc-text-primary)' }}>{c.nome_contratante1 || '—'}</td>
                      <td className="py-2 px-2" style={{ color: 'var(--cbc-text-secondary)' }}>{c.resort || '—'}</td>
                      <td className="py-2 px-2 text-right font-bold" style={{ color: navyColor }}>{formatCurrency(c.honorarios_total)}</td>
                      <td className="py-2 px-2 text-right" style={{ color: 'var(--cbc-text-muted)' }}>{fmtDate(c.signed_at || c.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SocioCard>
      </Accordion>

      {/* ═══ SECAO B — OPERACIONAL ═══ */}
      <Accordion Icon={FunnelIcon} title="Operacional" subtitle="Funil de conversao e metricas de tempo">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Funil */}
          <SocioCard>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--cbc-text-secondary)' }}>Funil de Conversao</div>
            {(() => {
              const steps = [
                { label: 'Leads (pipeline)', count: stats.funil.leads, color: '#5E6675' },
                { label: 'Contratos Criados', count: stats.funil.criados, color: '#2563EB' },
                { label: 'Enviados ZapSign', count: stats.funil.enviados, color: navyColor },
                { label: 'Assinados', count: stats.funil.assinados, color: successColor },
              ];
              const max = Math.max(...steps.map(s => s.count), 1);
              return (
                <div className="space-y-2">
                  {steps.map((s, i, arr) => {
                    const prev = i > 0 ? arr[i - 1].count : null;
                    const conv = prev && prev > 0 ? Math.round(s.count / prev * 100) : null;
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] w-36 shrink-0 truncate" style={{ color: 'var(--cbc-text-secondary)' }}>{s.label}</span>
                          <div className="flex-1 h-7 rounded-lg overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                            <div className="h-full rounded-lg transition-all flex items-center justify-end pr-2"
                              style={{ width: `${Math.max((s.count / max) * 100, 6)}%`, background: s.color }}>
                              <span className="text-[10px] font-bold text-white">{s.count}</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold w-12 text-right shrink-0"
                            style={{ color: conv !== null ? (conv >= 50 ? successColor : dangerColor) : 'var(--cbc-text-muted)' }}>
                            {conv !== null ? `${conv}%` : '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </SocioCard>

          {/* Tempo medio + taxa exito */}
          <div className="grid grid-cols-1 gap-3">
            <SocioCard>
              <div className="flex items-center gap-2 mb-2">
                <ClockIcon className="w-4 h-4" style={{ color: navyColor }} />
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Tempo Medio Lead → Assinatura</div>
              </div>
              <div className="text-2xl md:text-3xl font-bold" style={{ color: navyColor }}>
                {stats.tempoMedioDias === null ? '—' : `${stats.tempoMedioDias.toFixed(1)}`}
                <span className="text-sm font-normal ml-1" style={{ color: 'var(--cbc-text-muted)' }}>dias</span>
              </div>
              <div className="text-[10px] mt-2" style={{ color: 'var(--cbc-text-muted)' }}>
                Media calculada de todos os contratos ja assinados
              </div>
            </SocioCard>

            <SocioCard>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircleIcon className="w-4 h-4" style={{ color: successColor }} />
                {/* (bug-5) rotulo ajustado: agora e conversao real (criados -> assinados), nao assinados/cancelados */}
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>Taxa de Conversao (6 meses)</div>
                <span title="Percentual de contratos criados nos ultimos 6 meses que chegaram a assinar. Arquivados sem assinatura contam como perda. Nao inclui rascunhos." className="cursor-help">
                  <InformationCircleIcon className="w-3.5 h-3.5" style={{ color: 'var(--cbc-text-muted)' }} />
                </span>
              </div>
              <div className="text-2xl md:text-3xl font-bold" style={{ color: successColor }}>
                {stats.taxaExito === null ? '—' : `${stats.taxaExito.toFixed(1)}%`}
              </div>
              <div className="text-[10px] mt-2" style={{ color: 'var(--cbc-text-muted)' }}>
                Criados que assinaram nos ultimos 6 meses
              </div>
            </SocioCard>
          </div>
        </div>
      </Accordion>

      {/* ═══ SECAO C — EQUIPE ═══ */}
      <Accordion Icon={UsersIcon} title="Equipe" subtitle="Produtividade e ranking do mes">
        {/* Ranking top 3 */}
        {stats.topAdv.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {['🥇', '🥈', '🥉'].map((medal, i) => {
              const a = stats.topAdv[i];
              if (!a) return <div key={i} className="hidden md:block" />;
              return (
                <SocioCard key={i} accent={i === 0}>
                  <div className="flex items-center gap-3">
                    <div className="text-3xl">{medal}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold truncate" style={{ color: 'var(--cbc-text-primary)' }}>{a.email}</div>
                      <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
                        {a.assinados} assinados · {formatCompactBRL(a.somaHonorarios)}
                      </div>
                    </div>
                  </div>
                </SocioCard>
              );
            })}
          </div>
        )}

        <SocioCard>
          <SectionHeader
            Icon={ScaleIcon}
            title="Produtividade por Advogado (mes atual)"
            subtitle="Criados, assinados, taxa e ticket medio"
            rightSlot={
              <select
                value={perfilFiltro}
                onChange={e => setPerfilFiltro(e.target.value)}
                className="text-[10px] font-bold uppercase px-2 py-1 rounded-lg cursor-pointer"
                style={{ background: 'var(--cbc-bg-card)', color: 'var(--cbc-text-primary)', border: '1px solid var(--cbc-border)' }}
                aria-label="Filtrar por perfil"
              >
                <option value="todos">Todos</option>
                <option value="socio">Socio</option>
                <option value="advogado">Advogado</option>
                <option value="vendedora">Vendedora</option>
                <option value="assistente">Assistente</option>
              </select>
            }
          />
          {(() => {
            const advListFiltered = stats.advList
              .map(a => ({ ...a, perfil: perfisMap[(a.email || '').toLowerCase()] || 'advogado' }))
              .filter(a => perfilFiltro === 'todos' || a.perfil === perfilFiltro);
            if (advListFiltered.length === 0) {
              return (
                <div className="text-center py-4 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
                  {stats.advList.length === 0 ? 'Sem atividade registrada no mes.' : 'Sem resultados para o filtro selecionado.'}
                </div>
              );
            }
            const perfilBadge = (p) => {
              const cores = {
                socio: { bg: '#FEF3C7', fg: '#D97706' },
                advogado: { bg: '#EFF6FF', fg: '#2563EB' },
                vendedora: { bg: '#F0FDF4', fg: '#16A34A' },
                assistente: { bg: '#F5F3FF', fg: '#7C3AED' },
              }[p] || { bg: 'var(--cbc-bg-subtle)', fg: 'var(--cbc-text-muted)' };
              return (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: cores.bg, color: cores.fg }}>
                  {p}
                </span>
              );
            };
            return (
              <div className="overflow-x-auto">
                {/* (mobile-4) min-width no phone p/ rolar lateralmente em vez de espremer as 6 colunas */}
                <table className="w-full text-[11px] max-sm:min-w-[540px]">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--cbc-border)' }}>
                      <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Advogado</th>
                      <th className="text-center py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Perfil</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Criados</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Assinados</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Taxa</th>
                      <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Ticket Medio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advListFiltered.map(a => (
                      <tr key={a.email} className="border-b hover:bg-black/5 dark:hover:bg-white/5 transition-colors" style={{ borderColor: 'var(--cbc-border)' }}>
                        <td className="py-2 px-2 truncate" style={{ color: 'var(--cbc-text-primary)' }}>{a.email}</td>
                        <td className="py-2 px-2 text-center">{perfilBadge(a.perfil)}</td>
                        <td className="py-2 px-2 text-right" style={{ color: 'var(--cbc-text-secondary)' }}>{a.criados}</td>
                        <td className="py-2 px-2 text-right font-bold" style={{ color: successColor }}>{a.assinados}</td>
                        <td className="py-2 px-2 text-right font-bold" style={{ color: a.taxaConv >= 50 ? successColor : a.taxaConv >= 25 ? '#D97706' : dangerColor }}>
                          {a.taxaConv.toFixed(0)}%
                        </td>
                        <td className="py-2 px-2 text-right" style={{ color: navyColor }}>{formatCurrency(a.ticket)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </SocioCard>
      </Accordion>

      {/* ═══ SECAO D — ESTRATEGICO ═══ */}
      <Accordion Icon={ChartBarIcon} title="Estrategico" subtitle="Crescimento, top resorts e acoes mais rentaveis">
        {/* Crescimento YoY */}
        <SocioCard className="mb-3">
          <SectionHeader Icon={ArrowTrendingUpIcon}
            title="Crescimento YoY"
            subtitle={`Contratos por mes — ${new Date().getFullYear()} vs ${new Date().getFullYear() - 1}`}
          />
          {(() => {
            const max = Math.max(...stats.yoy.flatMap(d => [d.atual, d.anterior]), 1);
            return (
              <div className="space-y-1">
                {stats.yoy.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] w-10 shrink-0" style={{ color: 'var(--cbc-text-secondary)' }}>{m.label}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${(m.atual / max) * 100}%`, background: goldColor }} />
                        </div>
                        <span className="text-[10px] w-6 text-right font-bold" style={{ color: goldColor }}>{m.atual}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${(m.anterior / max) * 100}%`, background: '#6B7280' }} />
                        </div>
                        <span className="text-[10px] w-6 text-right" style={{ color: 'var(--cbc-text-muted)' }}>{m.anterior}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-3 pt-2 border-t" style={{ borderColor: 'var(--cbc-border)' }}>
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--cbc-text-secondary)' }}>
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: goldColor }} />
                    {new Date().getFullYear()}
                  </span>
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--cbc-text-secondary)' }}>
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#6B7280' }} />
                    {new Date().getFullYear() - 1}
                  </span>
                </div>
              </div>
            );
          })()}
        </SocioCard>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Top 5 resorts */}
          <SocioCard>
            <SectionHeader Icon={BuildingOffice2Icon} title="Top 5 Resorts" subtitle="Volume e ticket medio" />
            {stats.topResorts.length === 0 ? (
              <div className="text-center py-4 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>Sem dados.</div>
            ) : (
              <div className="space-y-2">
                {stats.topResorts.map((r, i) => {
                  const max = stats.topResorts[0]?.count || 1;
                  return (
                    <div key={r.resort}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] truncate" style={{ color: 'var(--cbc-text-primary)' }}>
                          {i + 1}. {r.resort}
                        </span>
                        <span className="text-[10px] font-bold" style={{ color: goldColor }}>{r.count} contratos</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${(r.count / max) * 100}%`, background: navyColor }} />
                        </div>
                        <span className="text-[10px] w-20 text-right" style={{ color: 'var(--cbc-text-muted)' }}>
                          {formatCompactBRL(r.ticket)}/ct
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SocioCard>

          {/* Tipos mais rentaveis */}
          <SocioCard>
            <SectionHeader Icon={CurrencyDollarIcon} title="Tipo de Acao Mais Rentavel" subtitle="Somatorio de honorarios por tipo" />
            {stats.tiposRentaveis.length === 0 ? (
              <div className="text-center py-4 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>Sem dados.</div>
            ) : (
              <div className="space-y-2">
                {stats.tiposRentaveis.slice(0, 6).map((t, i) => {
                  const max = stats.tiposRentaveis[0]?.soma || 1;
                  return (
                    <div key={t.tipo}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] truncate" style={{ color: 'var(--cbc-text-primary)' }}>{i + 1}. {t.tipo}</span>
                        <span className="text-[10px] font-bold" style={{ color: navyColor }}>{formatCompactBRL(t.soma)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${(t.soma / max) * 100}%`, background: goldColor }} />
                        </div>
                        <span className="text-[10px] w-16 text-right" style={{ color: 'var(--cbc-text-muted)' }}>
                          Medio {formatCompactBRL(t.ticket)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SocioCard>
        </div>
      </Accordion>
    </div>
  );
}
