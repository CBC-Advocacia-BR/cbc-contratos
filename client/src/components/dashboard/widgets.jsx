// ─────────────────────────────────────────────────────────────────────────
// Dashboard widgets — camada visual (redesign 12/06/2026)
// Todos os componentes usam tokens --cbc-* (funcionam em light E dark mode;
// a versão anterior usava hex fixos que quebravam no modo escuro).
// Lógica de dados fica em ./compute.js — aqui só apresentação + estado local.
// ─────────────────────────────────────────────────────────────────────────
import React, { useState, useMemo } from 'react';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  CalendarDaysIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  BoltIcon,
  SparklesIcon,
  EnvelopeIcon,
  PencilSquareIcon,
  ClockIcon,
  ScaleIcon,
  FolderIcon,
  TrophyIcon,
  FireIcon,
  ClipboardDocumentListIcon,
  BanknotesIcon,
  FunnelIcon,
  XMarkIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { PERIODOS } from './compute';
import { formatCurrency, fmtKpiValue } from './format';

// Pares de cor que funcionam nos dois temas (fundo translúcido + texto da var)
// (#extract-base 20/06) success/danger/warning/info/muted agora leem os tokens
// de superficie --cbc-*-bg/-border (fonte unica, compartilhada com StatusPill).
// Valores light identicos aos anteriores (paridade); accent/violet/cyan/orange
// permanecem literais (decisao: nao mexer nessas cores decorativas nesta rodada).
const TONES = {
  success: { fg: 'var(--cbc-success)', bg: 'var(--cbc-success-bg)', border: 'var(--cbc-success-border)' },
  danger: { fg: 'var(--cbc-danger)', bg: 'var(--cbc-danger-bg)', border: 'var(--cbc-danger-border)' },
  warning: { fg: 'var(--cbc-warning)', bg: 'var(--cbc-warning-bg)', border: 'var(--cbc-warning-border)' },
  info: { fg: 'var(--cbc-info)', bg: 'var(--cbc-info-bg)', border: 'var(--cbc-info-border)' },
  accent: { fg: 'var(--cbc-accent)', bg: 'rgba(201,168,76,0.12)', border: 'rgba(201,168,76,0.32)' },
  violet: { fg: '#8B5CF6', bg: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.28)' },
  cyan: { fg: '#0EA5E9', bg: 'rgba(14,165,233,0.10)', border: 'rgba(14,165,233,0.28)' },
  orange: { fg: '#F97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.28)' },
  muted: { fg: 'var(--cbc-text-muted)', bg: 'var(--cbc-neutral-bg)', border: 'var(--cbc-neutral-border)' },
};
export { TONES };

// Faixa de prazo → tom (jornada ≤7/15/30; distribuição ≤30/60/120)
// (#extract-base 20/06) 3a faixa: laranja → warning (âmbar forte), reservando o
// vermelho só p/ o estado realmente crítico (decisão Paulo).
function faixaTone(dias, faixas) {
  if (dias <= faixas[0]) return TONES.success;
  if (dias <= faixas[1]) return TONES.warning;
  if (dias <= faixas[2]) return TONES.warning;
  return TONES.danger;
}

// ─── Card base ───
export function DashCard({ title, subtitle, right, children, delay = 0, className = '' }) {
  return (
    <section
      className={`rounded-xl p-4 md:p-5 anim-slide-up ${className}`}
      style={{
        background: 'var(--cbc-bg-card)',
        border: '1px solid var(--cbc-border)',
        boxShadow: 'var(--cbc-shadow)',
        animationDelay: `${delay}ms`,
        animationFillMode: 'both',
      }}
    >
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-[11px] md:text-xs font-bold uppercase tracking-[1.2px]" style={{ color: 'var(--cbc-text-secondary)' }}>
              {title}
            </h3>
            {subtitle && (
              <div className="text-[10px] md:text-[11px] mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>{subtitle}</div>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// Título de seção da página (entre grupos de cards)
export function SectionTitle({ children, hint }) {
  return (
    <div className="flex items-baseline gap-2 mt-2 px-0.5">
      <h2 className="text-sm md:text-base font-bold tracking-tight" style={{ color: 'var(--cbc-text-primary)' }}>
        {children}
      </h2>
      {hint && <span className="text-[10px] md:text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>{hint}</span>}
    </div>
  );
}

// ─── KPI cards (personalizáveis) ───
const KPI_VISUAL = {
  assinados_mes: { Icon: CheckCircleIcon, tone: 'success' },
  valor_mes: { Icon: CurrencyDollarIcon, tone: 'accent' },
  meta_mensal: { Icon: TrophyIcon, tone: 'accent' },
  total_contratos: { Icon: ClipboardDocumentListIcon, tone: 'info' },
  total_assinados: { Icon: CheckCircleIcon, tone: 'success' },
  taxa_conversao: { Icon: ChartBarIcon, tone: 'info' },
  ticket_medio: { Icon: BanknotesIcon, tone: 'violet' },
  tempo_medio_assinatura: { Icon: ClockIcon, tone: 'cyan' },
  pendente_zapsign: { Icon: EnvelopeIcon, tone: 'info' },
  pipeline_aberto: { Icon: BanknotesIcon, tone: 'cyan' },
  pendente_advbox: { Icon: ScaleIcon, tone: 'warning' },
  pendente_drive: { Icon: FolderIcon, tone: 'orange' },
  cancelados_mes: { Icon: ExclamationTriangleIcon, tone: 'danger' },
  top_resort_mes: { Icon: FireIcon, tone: 'orange' },
};

// canCompare gateia a pílula de delta (comparativo mês a mês) — só sócios.
export function KpiCard({ kpiKey, item, delay = 0, canCompare = true }) {
  const visual = KPI_VISUAL[kpiKey] || { Icon: ChartBarIcon, tone: 'info' };
  const tone = TONES[item.alert ? 'danger' : visual.tone] || TONES.info;
  const Icon = visual.Icon;
  const valor = fmtKpiValue(item);
  return (
    <div className="kpi-card-glass anim-slide-up" style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}>
      <span aria-hidden="true" className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full opacity-80" style={{ background: tone.fg }} />
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <div className="text-[10px] font-bold uppercase tracking-[1.2px] leading-tight" style={{ color: 'var(--cbc-text-secondary)' }}>
          {item.label}
        </div>
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: tone.bg }}>
          <Icon className="w-3.5 h-3.5" style={{ color: tone.fg }} aria-hidden="true" />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <div className="text-lg md:text-xl lg:text-[21px] font-bold tracking-tight truncate max-w-full tabular-nums" style={{ color: tone.fg }} title={valor}>
          {valor}
        </div>
        {canCompare && item.delta !== null && item.delta !== undefined && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
            style={item.delta >= 0
              ? { background: TONES.success.bg, color: TONES.success.fg }
              : { background: TONES.danger.bg, color: TONES.danger.fg }}
            title="Variação vs mês anterior"
          >
            {item.delta >= 0 ? '▲' : '▼'} {Math.abs(item.delta)}%
          </span>
        )}
      </div>
      {typeof item.progress === 'number' && (
        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--cbc-border)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${item.progress}%`, background: item.progress >= 100 ? 'var(--cbc-success)' : 'var(--cbc-accent)' }}
          />
        </div>
      )}
      {item.sub && <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--cbc-text-muted)' }} title={item.sub}>{item.sub}</div>}
    </div>
  );
}

// ─── KPI herói (destaque do topo) ───────────────────────────────────────
// Renderiza UM indicador em escala grande (o mais importante do dashboard):
// rótulo pequeno, número gigante (clamp ~40-46px), delta como pílula forte e
// barra de meta quando há progress. Layout largo (largura cheia), card branco
// com borda fina + acento navy no topo. Reusa o mesmo `item` dos KpiCards.
// canCompare gateia o delta "vs período anterior" (comparativo) — só sócios.
export function HeroKpi({ kpiKey, item, delay = 0, canCompare = true }) {
  if (!item) return null;
  const visual = KPI_VISUAL[kpiKey] || { Icon: ChartBarIcon, tone: 'info' };
  const tone = TONES[item.alert ? 'danger' : visual.tone] || TONES.info;
  const Icon = visual.Icon;
  const valor = fmtKpiValue(item);
  const hasProgress = typeof item.progress === 'number';
  const deltaUp = item.delta >= 0;
  const deltaTone = deltaUp ? TONES.success : TONES.danger;
  // sem comparativo, o "· vs período anterior" do subtítulo fica órfão — remove.
  const subTxt = canCompare ? item.sub : (item.sub || '').replace(/\s*·?\s*vs per[ií]odo anterior/i, '').trim();
  return (
    <section
      className="relative rounded-xl overflow-hidden anim-slide-up"
      style={{
        background: 'var(--cbc-bg-card)',
        border: '1px solid var(--cbc-border)',
        boxShadow: 'var(--cbc-shadow)',
        animationDelay: `${delay}ms`,
        animationFillMode: 'both',
      }}
    >
      {/* acento navy no topo */}
      <span aria-hidden="true" className="absolute top-0 left-0 right-0 h-1" style={{ background: 'var(--cbc-accent)' }} />
      <div className="p-3.5 md:p-4 pt-4 md:pt-4 flex items-center gap-3.5 md:gap-4 flex-wrap md:flex-nowrap">
        {/* selo do ícone */}
        <div
          className="w-11 h-11 md:w-12 md:h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
        >
          <Icon className="w-5 h-5 md:w-6 md:h-6" style={{ color: tone.fg }} aria-hidden="true" />
        </div>

        {/* número + rótulo + delta */}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] md:text-[11px] font-bold uppercase tracking-[1.4px]" style={{ color: 'var(--cbc-text-secondary)' }}>
            {item.label}
          </div>
          <div className="flex items-end gap-2.5 flex-wrap mt-0.5">
            <span
              className="font-bold leading-none tracking-tight tabular-nums"
              style={{ color: 'var(--cbc-text-primary)', fontSize: 'clamp(28px, 5vw, 36px)' }}
              title={valor}
            >
              {valor}
            </span>
            {canCompare && item.delta !== null && item.delta !== undefined && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full mb-1 shrink-0"
                style={{ background: deltaTone.bg, color: deltaTone.fg, border: `1px solid ${deltaTone.border}` }}
                title="Variação vs período anterior"
              >
                {deltaUp ? <ArrowTrendingUpIcon className="w-3 h-3" aria-hidden="true" /> : <ArrowTrendingDownIcon className="w-3 h-3" aria-hidden="true" />}
                {Math.abs(item.delta)}%
              </span>
            )}
          </div>
          {subTxt && (
            <div className="text-[10px] md:text-[11px] mt-1" style={{ color: 'var(--cbc-text-muted)' }}>{subTxt}</div>
          )}
        </div>

        {/* barra de meta (quando houver progress) */}
        {hasProgress && (
          <div className="w-full md:w-44 shrink-0">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>Meta</span>
              <span
                className="text-[13px] font-bold tabular-nums"
                style={{ color: item.progress >= 100 ? TONES.success.fg : 'var(--cbc-text-primary)' }}
              >
                {item.progress}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, item.progress)}%`, background: item.progress >= 100 ? 'var(--cbc-success)' : 'var(--cbc-accent)' }}
              />
            </div>
            {typeof item.projecao === 'number' && (
              <div className="text-[10px] mt-1 leading-tight" style={{ color: 'var(--cbc-text-muted)' }} title="Projeção de fechamento do mês pelo ritmo atual">
                Projeção do mês:{' '}
                <b style={{ color: item.projecao >= (item.metaGoal || 0) ? TONES.success.fg : TONES.warning.fg }}>{item.projecao}</b>
                {item.faltam > 0 ? ` · faltam ${item.faltam}` : ' · no ritmo 🎯'}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Ação necessária (sempre carteira ativa; ignora filtros) ───
export function ActionStrip({ acoes, onNavigate }) {
  const items = [];
  if (acoes.aguardandoAntigos > 0) {
    items.push({
      Icon: ExclamationTriangleIcon, tone: TONES.danger, tab: 'contratos',
      value: acoes.aguardandoAntigos,
      label: 'aguardando há 3+ dias',
      hint: 'Vale um follow-up — abrir Contratos',
    });
  }
  if (acoes.aguardando - acoes.aguardandoAntigos > 0) {
    items.push({
      Icon: EnvelopeIcon, tone: TONES.info, tab: 'contratos',
      value: acoes.aguardando - acoes.aguardandoAntigos,
      label: 'aguardando assinatura',
      hint: 'Enviados recentemente — abrir Contratos',
    });
  }
  if (acoes.pendAdvbox > 0) {
    items.push({
      Icon: BoltIcon, tone: TONES.warning, tab: 'monitor',
      value: acoes.pendAdvbox,
      label: 'assinados sem ADVBOX',
      hint: 'Processo ainda não lançado no ADVBOX — abrir Monitor para reprocessar',
    });
  }
  if (acoes.driveFailed > 0) {
    items.push({
      Icon: BoltIcon, tone: TONES.danger, tab: 'monitor',
      value: acoes.driveFailed,
      label: 'falhas no Drive',
      hint: 'Arquivo não subiu ao Google Drive — abrir Monitor para reprocessar',
    });
  }
  if (acoes.rascunhosAntigos > 0) {
    items.push({
      Icon: PencilSquareIcon, tone: TONES.warning, tab: 'contratos',
      value: acoes.rascunhosAntigos,
      label: 'rascunhos há 7+ dias',
      hint: 'Finalizar ou arquivar — abrir Contratos',
    });
  }

  if (items.length === 0) {
    return (
      <div
        className="rounded-xl p-3 flex items-center gap-2.5 anim-slide-up"
        style={{ background: TONES.success.bg, border: `1px solid ${TONES.success.border}` }}
      >
        <CheckCircleIcon className="w-6 h-6 shrink-0" style={{ color: TONES.success.fg }} aria-hidden="true" />
        <div>
          <div className="text-xs font-bold" style={{ color: TONES.success.fg }}>Operação em dia</div>
          <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
            Nenhuma pendência na carteira ativa neste momento.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 anim-slide-up">
      {items.map((item, i) => {
        const Icon = item.Icon;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onNavigate?.(item.tab)}
            title={item.hint}
            className="rounded-xl p-3 flex items-center gap-3 text-left cursor-pointer transition-transform hover:scale-[1.015] active:scale-[0.99]"
            style={{ background: item.tone.bg, border: `1px solid ${item.tone.border}` }}
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: item.tone.bg }}>
              <Icon className="w-5 h-5" style={{ color: item.tone.fg }} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-lg font-bold leading-none tabular-nums" style={{ color: item.tone.fg }}>{item.value}</span>
              <span className="text-[11px] font-bold ml-1.5" style={{ color: item.tone.fg }}>{item.label}</span>
              <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--cbc-text-muted)' }}>{item.hint}</div>
            </div>
            <ChevronRightIcon className="w-4 h-4 shrink-0 opacity-50" style={{ color: item.tone.fg }} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

// ─── Funil cumulativo (barras centralizadas, largura decrescente) ────────
// Funil "de verdade": 3 etapas (criados ⊇ enviados ⊇ assinados) como barras
// centradas que afunilam. A queda % entre etapas aparece no degrau; a
// conversão total (criação → assinatura) fica em destaque no rodapé.
export function FunnelCard({ funil, delay = 0 }) {
  // (videochamadas) etapas do TOPO vindas da agenda — contadas por data do evento.
  const temVideo = typeof funil.agendadas === 'number';
  // (leads Meta 14/07/2026) 1a etapa: leads das campanhas (conversas iniciadas + forms),
  // mensal, respeitando o período do filtro. Sem dados no período, a etapa some.
  const temLeads = typeof funil.leadsMeta === 'number';
  const etapas = [
    ...(temLeads ? [
      {
        label: 'Leads de campanha (Meta)', valor: funil.leadsMeta, cor: 'var(--cbc-gold)', pct: null,
        nota: `${formatCurrency(funil.leadsMetaGasto)} investidos · CPL ${formatCurrency(funil.leadsMetaCpl, { cents: true })}`,
      },
    ] : []),
    ...(temVideo ? [
      { label: 'Videochamada agendada', valor: funil.agendadas, cor: 'var(--cbc-info)', pct: temLeads ? funil.pctLeadAgendada : null, pctLabel: 'dos leads agendaram', nota: funil.futuras > 0 ? `+${funil.futuras} a realizar nos próximos dias` : null },
      { label: 'Videochamada realizada', valor: funil.realizadas, cor: 'var(--cbc-info)', pct: funil.pctComparecimento, pctLabel: 'compareceram' },
    ] : []),
    { label: 'Contratos enviados para assinatura', valor: funil.enviados, cor: 'var(--cbc-navy-light)', pct: null, scopeBreak: temVideo || temLeads },
    { label: 'Assinados', valor: funil.assinados, cor: 'var(--cbc-success)', pct: funil.pctAssinatura },
  ];
  // ESCALA ÚNICA p/ TODAS as barras (etapas + Distribuídos + Guia Paga): largura ∝ valor, com o
  // maior valor do funil = 100%. Assim a barra de 62 é sempre maior que a de 52, e assim por diante.
  const max = Math.max(funil.leadsMeta || 0, funil.agendadas || 0, funil.enviados, funil.assinados, funil.distribuidos || 0, funil.guiaPaga || 0, 1);
  const pctTone = (p) => (p >= 70 ? TONES.success : p >= 40 ? TONES.warning : TONES.danger);
  return (
    <DashCard
      title="Funil de conversão"
      subtitle="Cumulativo: quem assinou conta como enviado"
      delay={delay}
      right={funil.pctAssinatura !== null && funil.pctAssinatura !== undefined && (
        <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: TONES.success.bg, color: TONES.success.fg, border: `1px solid ${TONES.success.border}` }}>
          {funil.pctAssinatura}% envio → assinatura
        </span>
      )}
    >
      <div className="flex flex-col items-stretch">
        {etapas.map((e, i) => {
          // largura proporcional ao valor; piso visível p/ etapas com algo > 0
          const widthPct = Math.max((e.valor / max) * 100, e.valor > 0 ? 16 : 6);
          const tone = e.pct !== null ? pctTone(e.pct) : null;
          return (
            <div key={e.label}>
              {/* degrau entre etapas. scopeBreak = troca do funil de calls p/ o de contratos
                  (cohorts diferentes) → divisória neutra, sem % enganoso. */}
              {i > 0 && (e.scopeBreak ? (
                <div className="flex items-center justify-center py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-muted)' }}>
                    contratos
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1.5 py-1">
                  <svg className="w-3 h-3" style={{ color: tone ? tone.fg : 'var(--cbc-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={tone
                      ? { background: tone.bg, color: tone.fg }
                      : { color: 'var(--cbc-text-muted)' }}
                  >
                    {e.pct !== null ? `${Number(e.pct).toLocaleString('pt-BR')}% ${e.pctLabel || 'avançam'}` : '—'}
                  </span>
                </div>
              ))}
              {/* barra centralizada — afunila */}
              <div className="flex justify-center">
                <div
                  className="h-12 rounded-lg flex items-center justify-center gap-2 px-3 transition-all"
                  style={{ width: `${widthPct}%`, minWidth: 90, background: e.cor }}
                  title={`${e.label}: ${e.valor}`}
                >
                  <span className="text-lg font-bold leading-none text-white drop-shadow-sm tabular-nums">{e.valor}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white/85 truncate">{e.label}</span>
                </div>
              </div>
              {e.nota && (
                <div className="text-center text-[10px] font-semibold pt-1" style={{ color: 'var(--cbc-text-muted)' }}>{e.nota}</div>
              )}
            </div>
          );
        })}

        {/* Etapa "Distribuídos" — processo distribuído = tem nº de processo no ADVBOX
            (sinal completo; subconjunto dos assinados e ⊇ Guia Paga). */}
        {typeof funil.distribuidos === 'number' && (
          <div className="mt-1">
            <div className="flex items-center justify-center gap-1.5 py-1">
              <svg className="w-3 h-3" style={{ color: 'var(--cbc-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-muted)' }}>
                têm nº de processo no ADVBOX
              </span>
            </div>
            <div className="flex justify-center">
              <div className="h-12 rounded-lg flex items-center justify-center gap-2 px-3 transition-all"
                style={{ width: `${Math.max((funil.distribuidos / max) * 100, funil.distribuidos > 0 ? 16 : 6)}%`, minWidth: 90, background: 'linear-gradient(100deg, var(--cbc-navy), var(--cbc-gold))' }}
                title={`Distribuídos: ${funil.distribuidos}`}>
                <span className="text-lg font-bold leading-none text-white drop-shadow-sm tabular-nums">{funil.distribuidos}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/85 truncate">Distribuídos</span>
              </div>
            </div>
          </div>
        )}

        {/* Etapa "Guia Paga/JEC" — passou da citação no ADVBOX (guia paga ou JEC). Estado atual
            do processo (sem data própria), por isso vem com nota. */}
        {typeof funil.guiaPaga === 'number' && (
          <div className="mt-1">
            <div className="flex items-center justify-center gap-1.5 py-1">
              <svg className="w-3 h-3" style={{ color: 'var(--cbc-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-muted)' }}>
                guia paga / JEC · citação, audiência ou custas
              </span>
            </div>
            <div className="flex justify-center">
              <div className="h-12 rounded-lg flex items-center justify-center gap-2 px-3 transition-all"
                style={{ width: `${Math.max((funil.guiaPaga / max) * 100, funil.guiaPaga > 0 ? 16 : 6)}%`, minWidth: 90, background: 'var(--cbc-gold-dark, #B8860B)' }}
                title={`Guia Paga/JEC: ${funil.guiaPaga}`}>
                <span className="text-lg font-bold leading-none text-white drop-shadow-sm tabular-nums">{funil.guiaPaga}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/85 truncate">Guia Paga/JEC</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* conversão total destacada */}
      <div
        className="mt-4 pt-3 flex items-center justify-between gap-3"
        style={{ borderTop: '1px solid var(--cbc-border)' }}
      >
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>
          Conversão total
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold leading-none tabular-nums" style={{ color: funil.pctAssinatura !== null && funil.pctAssinatura >= 40 ? TONES.success.fg : 'var(--cbc-text-primary)' }}>
            {funil.pctAssinatura !== null && funil.pctAssinatura !== undefined ? `${funil.pctAssinatura}%` : '—'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>dos enviados assinaram</span>
        </span>
      </div>
    </DashCard>
  );
}

// ─── Donut de status atual ───
const STATUS_META = {
  rascunho: { label: 'Rascunhos', cor: '#9CA3AF' },
  enviado_zapsign: { label: 'Enviados', cor: 'var(--cbc-info)' },
  assinado: { label: 'Assinados', cor: 'var(--cbc-success)' },
  cancelado: { label: 'Cancelados', cor: 'var(--cbc-danger)' },
};

export function StatusDonut({ porStatus, delay = 0 }) {
  const data = Object.entries(STATUS_META)
    .map(([key, meta]) => ({ ...meta, value: porStatus[key] || 0 }))
    .filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const pctAssin = Math.round(((porStatus.assinado || 0) / total) * 100);
  const size = 100;
  const strokeWidth = 17;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  // Faixa compacta horizontal: donut (esq) + legenda + % assinados (âncora à dir).
  // Altura natural — não estica mais p/ igualar o funil (que agora é largura total).
  return (
    <DashCard title="Status atual" subtitle="Situação de cada contrato no escopo" delay={delay}>
      <div className="flex items-center gap-5 md:gap-7 flex-wrap">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} role="img" aria-label="Distribuição por status">
            {data.map((d, i) => {
              const dashLength = (d.value / total) * circumference;
              const seg = (
                <circle
                  key={i} cx={size / 2} cy={size / 2} r={radius} fill="none"
                  stroke={d.cor} strokeWidth={strokeWidth}
                  strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                  strokeDashoffset={-offset}
                  style={{ transition: 'stroke-dasharray 0.6s ease' }}
                />
              );
              offset += dashLength;
              return seg;
            })}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center flex-col">
            <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>{total}</span>
            <span className="text-[9px] uppercase font-bold tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>contratos</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 min-w-[150px]">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.cor }} />
              <span className="text-[11px] w-20" style={{ color: 'var(--cbc-text-secondary)' }}>{d.label}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>{d.value}</span>
              <span className="text-[10px] tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>({Math.round((d.value / total) * 100)}%)</span>
            </div>
          ))}
        </div>
        <div className="ml-auto text-right pr-1">
          <div className="text-3xl md:text-4xl font-bold tabular-nums leading-none" style={{ color: TONES.success.fg }}>{pctAssin}%</div>
          <div className="text-[10px] uppercase font-bold tracking-wide mt-1" style={{ color: 'var(--cbc-text-muted)' }}>assinados</div>
        </div>
      </div>
    </DashCard>
  );
}

// ─── Status atual + Assinaturas no período (merge — card herói de 2 zonas) ───
// Junta a distribuição por status (donut + enviados/assinados) com o KPI herói
// "assinaturas no período" (valor + delta vs período anterior, mesmo `item` dos KpiCards).
// Faixa navy no topo; empilha no mobile com divisória horizontal.
export function StatusAssinaturasCard({ porStatus, kpiAssinados, canCompare = true, delay = 0 }) {
  const data = Object.entries(STATUS_META)
    .map(([key, meta]) => ({ ...meta, value: porStatus[key] || 0 }))
    .filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  const size = 104;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const item = kpiAssinados;
  const valor = item ? fmtKpiValue(item) : null;
  const tone = item && item.alert ? TONES.danger : TONES.success;
  const deltaUp = item && item.delta >= 0;
  const deltaTone = deltaUp ? TONES.success : TONES.danger;
  const subTxt = item ? (canCompare ? item.sub : (item.sub || '').replace(/\s*·?\s*vs per[ií]odo anterior/i, '').trim()) : '';
  const hasProgress = item && typeof item.progress === 'number';

  return (
    <section
      className="relative rounded-xl overflow-hidden anim-slide-up"
      style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', boxShadow: 'var(--cbc-shadow)', animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <span aria-hidden="true" className="absolute top-0 left-0 right-0 h-1" style={{ background: 'var(--cbc-accent)' }} />
      <div className="p-4 md:p-5 pt-5 flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-0">
        {/* Zona A — Status atual */}
        <div className="flex items-center gap-4 md:gap-5 lg:flex-1 lg:pr-6">
          {total > 0 ? (
            <>
              <div className="relative shrink-0" style={{ width: size, height: size }}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} role="img" aria-label="Distribuição por status">
                  {data.map((d, i) => {
                    const dashLength = (d.value / total) * circumference;
                    const seg = (
                      <circle
                        key={i} cx={size / 2} cy={size / 2} r={radius} fill="none"
                        stroke={d.cor} strokeWidth={strokeWidth}
                        strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                        strokeDashoffset={-offset}
                        style={{ transition: 'stroke-dasharray 0.6s ease' }}
                      />
                    );
                    offset += dashLength;
                    return seg;
                  })}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>{total}</span>
                  <span className="text-[9px] uppercase font-bold tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>contratos</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[1.4px] mb-0.5" style={{ color: 'var(--cbc-text-secondary)' }}>Status atual</div>
                {data.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.cor }} />
                    <span className="text-[11px] w-20" style={{ color: 'var(--cbc-text-secondary)' }}>{d.label}</span>
                    <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>{d.value}</span>
                    <span className="text-[10px] tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>({Math.round((d.value / total) * 100)}%)</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-xs py-4" style={{ color: 'var(--cbc-text-muted)' }}>Sem contratos no escopo.</div>
          )}
        </div>

        {/* divisória + Zona B — Assinaturas no período (só quando há o KPI) */}
        {item && (
          <>
            <div className="hidden lg:block w-px self-stretch shrink-0" style={{ background: 'var(--cbc-border)' }} aria-hidden="true" />
            <div className="lg:hidden h-px w-full" style={{ background: 'var(--cbc-border)' }} aria-hidden="true" />
            <div className="flex items-center gap-3.5 md:gap-4 lg:flex-1 lg:pl-6">
            <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
              <CheckCircleIcon className="w-5 h-5 md:w-6 md:h-6" style={{ color: tone.fg }} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] md:text-[11px] font-bold uppercase tracking-[1.4px]" style={{ color: 'var(--cbc-text-secondary)' }}>{item.label}</div>
              <div className="flex items-end gap-2.5 flex-wrap mt-0.5">
                <span className="font-bold leading-none tracking-tight tabular-nums" style={{ color: 'var(--cbc-text-primary)', fontSize: 'clamp(28px, 5vw, 36px)' }} title={valor}>{valor}</span>
                {canCompare && item.delta !== null && item.delta !== undefined && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full mb-1 shrink-0" style={{ background: deltaTone.bg, color: deltaTone.fg, border: `1px solid ${deltaTone.border}` }} title="Variação vs período anterior">
                    {deltaUp ? <ArrowTrendingUpIcon className="w-3 h-3" aria-hidden="true" /> : <ArrowTrendingDownIcon className="w-3 h-3" aria-hidden="true" />}
                    {Math.abs(item.delta)}%
                  </span>
                )}
              </div>
              {subTxt && <div className="text-[10px] md:text-[11px] mt-1" style={{ color: 'var(--cbc-text-muted)' }}>{subTxt}</div>}
              {hasProgress && (
                <div className="mt-2 max-w-[240px]">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>Meta</span>
                    <span className="text-[12px] font-bold tabular-nums" style={{ color: item.progress >= 100 ? TONES.success.fg : 'var(--cbc-text-primary)' }}>{item.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, item.progress)}%`, background: item.progress >= 100 ? 'var(--cbc-success)' : 'var(--cbc-accent)' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─── Comparador de meses (12/06/2026) ───
// Compara dois meses lado a lado: criados, assinaturas, receita, ticket e
// conversão do cohort. Independe do filtro de período (o usuário escolhe).
const CMP_METRICAS = [
  { key: 'criados', label: 'Contratos criados', fmt: 'int' },
  { key: 'assinados', label: 'Assinaturas', fmt: 'int' },
  { key: 'receita', label: 'Receita (iniciais)', fmt: 'brl' },
  { key: 'ticket', label: 'Ticket médio', fmt: 'brl' },
  { key: 'conversaoCohort', label: 'Conversão dos criados', fmt: 'pct', deltaPp: true },
];

function fmtCmp(v, fmt) {
  if (v === null || v === undefined) return '—';
  if (fmt === 'brl') return formatCurrency(v);
  if (fmt === 'pct') return `${v}%`;
  return Number(v).toLocaleString('pt-BR');
}

export function MonthComparator({ comparador, delay = 0 }) {
  const meses = comparador?.meses || [];
  const [mesA, setMesA] = useState(meses[1]?.key || meses[0]?.key || '');
  const [mesB, setMesB] = useState(meses[0]?.key || '');
  if (meses.length < 2) return null;

  // (fix review 12/06) Se o mês selecionado sumir do conjunto (mudança de
  // filtro de resort/tipo), cai no padrão em vez de exibir colunas vazias
  const mesAEf = comparador.dados[mesA] ? mesA : (meses[1]?.key || meses[0]?.key);
  const mesBEf = comparador.dados[mesB] ? mesB : meses[0]?.key;
  const dadosA = comparador.dados[mesAEf];
  const dadosB = comparador.dados[mesBEf];
  const labelOf = (k) => meses.find((m) => m.key === k)?.label || k;

  const selectStyle = {
    background: 'var(--cbc-bg-subtle)',
    border: '1px solid var(--cbc-border)',
    color: 'var(--cbc-text-primary)',
  };

  return (
    <DashCard
      title="Comparador de meses"
      subtitle="Assinaturas pela data efetiva · conversão = % do que foi criado no mês e já assinou"
      delay={delay}
      right={
        <div className="flex items-center gap-1.5 flex-wrap">
          <select value={mesAEf} onChange={(e) => setMesA(e.target.value)} aria-label="Mês de referência"
            className="text-[11px] px-2 py-1.5 rounded-lg cursor-pointer focus:outline-none" style={selectStyle}>
            {meses.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <ArrowRightIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--cbc-text-muted)' }} aria-hidden="true" />
          <select value={mesBEf} onChange={(e) => setMesB(e.target.value)} aria-label="Mês comparado"
            className="text-[11px] px-2 py-1.5 rounded-lg cursor-pointer focus:outline-none" style={selectStyle}>
            {meses.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
      }
    >
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--cbc-border)' }}>
            <th className="text-left py-2 pr-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Métrica</th>
            <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-muted)' }}>{labelOf(mesAEf)}</th>
            <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{labelOf(mesBEf)}</th>
            <th className="text-right py-2 pl-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {CMP_METRICAS.map((m, idx) => {
            const a = dadosA?.[m.key] ?? null;
            const b = dadosB?.[m.key] ?? null;
            let delta = null;
            let deltaTxt = '—';
            if (a !== null && b !== null) {
              if (m.deltaPp) {
                delta = b - a;
                deltaTxt = `${delta >= 0 ? '+' : ''}${delta} p.p.`;
              } else if (a > 0) {
                delta = Math.round(((b - a) / a) * 100);
                deltaTxt = `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%`;
              } else if (b > 0) {
                delta = 100;
                deltaTxt = 'novo';
              }
            }
            return (
              <tr key={m.key} style={{ borderBottom: '1px solid var(--cbc-border)', background: idx % 2 ? 'var(--cbc-bg-subtle)' : 'transparent' }}>
                <td className="py-2 pl-2 pr-2 rounded-l-lg" style={{ color: 'var(--cbc-text-secondary)' }}>{m.label}</td>
                <td className="py-2 px-2 text-right tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>{fmtCmp(a, m.fmt)}</td>
                <td className="py-2 px-2 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>{fmtCmp(b, m.fmt)}</td>
                <td className="py-2 pl-2 pr-2 text-right rounded-r-lg">
                  {delta === null ? (
                    <span className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>—</span>
                  ) : (
                    <span
                      className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={delta >= 0
                        ? { background: TONES.success.bg, color: TONES.success.fg }
                        : { background: TONES.danger.bg, color: TONES.danger.fg }}
                    >
                      {deltaTxt}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DashCard>
  );
}

// ─── Lista de desempenho (resorts / tipos de ação) ───
export function PerformanceList({ title, subtitle, items, delay = 0, initial = 8 }) {
  const [expanded, setExpanded] = useState(false);
  if (!items || items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, initial);
  const maxTotal = Math.max(...items.map((r) => r.total), 1);
  return (
    <DashCard title={title} subtitle={subtitle} delay={delay}>
      <div className="space-y-1.5">
        {visible.map((r) => (
          <div key={r.label} className="flex items-center gap-2" title={`${r.label}: ${r.assinados} assinados de ${r.total} (${r.taxa}%) · ${formatCurrency(r.receita)} em iniciais`}>
            <span className="text-[11px] w-24 sm:w-32 md:w-40 truncate shrink-0" style={{ color: 'var(--cbc-text-secondary)' }}>{r.label}</span>
            <div className="flex-1 h-4 rounded-full overflow-hidden relative" style={{ background: 'var(--cbc-bg-subtle)' }}>
              <div className="h-full rounded-full absolute inset-y-0 left-0" style={{ width: `${(r.total / maxTotal) * 100}%`, background: 'rgba(37,99,235,0.22)' }} />
              <div className="h-full rounded-full absolute inset-y-0 left-0" style={{ width: `${(r.assinados / maxTotal) * 100}%`, background: 'var(--cbc-success)' }} />
            </div>
            <span className="text-[11px] font-bold w-14 text-right shrink-0 tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>
              {r.assinados}/{r.total}
            </span>
            <span
              className="text-[11px] font-bold w-10 text-right shrink-0 tabular-nums"
              style={{ color: r.taxa >= 70 ? TONES.success.fg : r.taxa >= 40 ? TONES.warning.fg : 'var(--cbc-text-secondary)' }}
            >
              {r.taxa}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: '1px solid var(--cbc-border)' }}>
        <span className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Barra azul = criados · verde = assinados · % = taxa de assinatura
        </span>
        {items.length > initial && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[10px] font-bold uppercase cursor-pointer hover:underline"
            style={{ color: 'var(--cbc-accent)' }}
          >
            {expanded ? 'Mostrar menos' : `Mostrar todos (${items.length})`}
          </button>
        )}
      </div>
    </DashCard>
  );
}

// ─── Honorários (toggle Assinados | Todos) ───
const HON_META = [
  { key: 'ambos', label: 'Iniciais + Êxito', desc: 'valor fixo + % de êxito', tone: 'success', Icon: CheckCircleIcon },
  { key: 'exito', label: 'Somente Êxito', desc: 'apenas ad exitum', tone: 'violet', Icon: SparklesIcon },
  { key: 'iniciais', label: 'Somente Iniciais', desc: 'apenas valor fixo', tone: 'warning', Icon: ClipboardDocumentListIcon },
];

// Chip de mês do filtro integrado (ativo = navy, contraste forte; inativo = neutro).
function MesChip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors whitespace-nowrap"
      style={active
        ? { background: 'var(--cbc-navy)', color: '#fff', border: '1px solid var(--cbc-navy)' }
        : { background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-secondary)', border: '1px solid var(--cbc-border)' }}
    >
      {label}
    </button>
  );
}

// Gráfico de linha (SVG na mão, token-driven) — evolução dos 3 modelos por mês.
// X = meses · Y = quantidade. Clicar numa coluna seleciona o mês (marcador + circulos maiores).
const HON_LINES = [
  { key: 'ambos', label: 'Iniciais + Êxito', color: 'var(--cbc-success)' },
  { key: 'exito', label: 'Só Êxito', color: TONES.violet.fg },
  { key: 'iniciais', label: 'Só Iniciais', color: 'var(--cbc-warning)' },
];
function HonorariosLineChart({ serie, mesSel, onPickMes }) {
  const W = 720, H = 196, padL = 26, padR = 14, padT = 12, padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = serie.length;
  const maxY = Math.max(1, ...serie.flatMap((m) => [m.ambos, m.exito, m.iniciais]));
  const x = (i) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => padT + (1 - v / maxY) * innerH;
  const selIdx = mesSel ? serie.findIndex((m) => m.key === mesSel) : -1;
  const colW = innerW / Math.max(n, 1);

  return (
    <div className="anim-slide-up">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} role="img"
        aria-label="Evolução dos modelos de honorários por mês">
        {[0, 0.5, 1].map((t) => {
          const gv = Math.round(maxY * t);
          const gy = y(gv);
          return (
            <g key={t}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--cbc-border)" strokeWidth="1" strokeDasharray={t === 0 ? '0' : '3 4'} opacity={t === 0 ? 1 : 0.7} />
              <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize="9" fill="var(--cbc-text-muted)">{gv}</text>
            </g>
          );
        })}
        {selIdx >= 0 && (
          <line x1={x(selIdx)} y1={padT} x2={x(selIdx)} y2={padT + innerH} stroke="var(--cbc-accent)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.75" />
        )}
        {serie.map((m, i) => {
          if (n > 8 && i % 2 !== 0 && i !== n - 1) return null;
          return (
            <text key={m.key} x={x(i)} y={H - 7} textAnchor="middle" fontSize="9"
              fill={i === selIdx ? 'var(--cbc-text-primary)' : 'var(--cbc-text-muted)'} fontWeight={i === selIdx ? 700 : 400}>
              {m.label}
            </text>
          );
        })}
        {HON_LINES.map((ln) => (
          <g key={ln.key}>
            <polyline points={serie.map((m, i) => `${x(i)},${y(m[ln.key])}`).join(' ')}
              fill="none" stroke={ln.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            {serie.map((m, i) => (
              <circle key={i} cx={x(i)} cy={y(m[ln.key])} r={i === selIdx ? 3.6 : 2.2}
                fill={ln.color} stroke="var(--cbc-bg-card)" strokeWidth="1" />
            ))}
          </g>
        ))}
        {serie.map((m, i) => (
          <rect key={m.key} x={x(i) - colW / 2} y={padT} width={colW} height={innerH} fill="transparent"
            className="cursor-pointer" onClick={() => onPickMes(mesSel === m.key ? null : m.key)}>
            <title>{`${m.label} — Iniciais+Êxito ${m.ambos} · Só Êxito ${m.exito} · Só Iniciais ${m.iniciais}`}</title>
          </rect>
        ))}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-1.5 flex-wrap">
        {HON_LINES.map((ln) => (
          <span key={ln.key} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--cbc-text-secondary)' }}>
            <span className="w-3.5 h-[3px] rounded-full" style={{ background: ln.color }} /> {ln.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HonorariosCard({ honorarios, delay = 0 }) {
  const [modo, setModo] = useState('assinados');     // assinados | todos
  const [expanded, setExpanded] = useState(false);
  const [mesSel, setMesSel] = useState(null);        // null = todos os meses
  const serie = honorarios.serie?.[modo] || [];
  const meses = honorarios.meses || [];
  const labelMes = (k) => meses.find((m) => m.key === k)?.label || k;

  // Recolhido: agregado do escopo GLOBAL (respeita o filtro de período do topo).
  // Expandido: o filtro de mês integrado ajusta o período do card (null = série inteira).
  const aggSerie = serie.reduce(
    (a, m) => ({ ambos: a.ambos + m.ambos, exito: a.exito + m.exito, iniciais: a.iniciais + m.iniciais, nenhum: a.nenhum + m.nenhum }),
    { ambos: 0, exito: 0, iniciais: 0, nenhum: 0 },
  );
  const mesData = mesSel ? serie.find((m) => m.key === mesSel) : null;
  const dataset = !expanded ? honorarios[modo] : (mesData || aggSerie);
  const totalSet = HON_META.reduce((s, m) => s + (dataset[m.key] || 0), 0) + (dataset.nenhum || 0);

  const subtitle = !expanded
    ? (modo === 'assinados' ? 'Contratos assinados no escopo' : 'Todos os contratos do escopo')
    : `${modo === 'assinados' ? 'Assinados' : 'Criados'} · ${mesSel ? `em ${labelMes(mesSel)}` : 'todos os meses'}`;

  const toggle = (
    <div className="flex rounded-lg p-0.5" style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)' }} onClick={(e) => e.stopPropagation()}>
      {[{ k: 'assinados', l: 'Assinados' }, { k: 'todos', l: 'Todos' }].map((opt) => (
        <button
          key={opt.k}
          type="button"
          onClick={() => setModo(opt.k)}
          className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase cursor-pointer transition-all"
          style={modo === opt.k ? { background: 'var(--cbc-accent)', color: 'var(--cbc-bg)' } : { color: 'var(--cbc-text-muted)' }}
        >
          {opt.l}
        </button>
      ))}
    </div>
  );

  return (
    <DashCard title="Modelos de honorários" subtitle={subtitle} delay={delay} right={toggle} className={expanded ? 'lg:col-span-2' : ''}>
      {/* recolhido: corpo inteiro é clicável (abre); expandido: controles próprios + recolher */}
      <div
        onClick={!expanded ? () => setExpanded(true) : undefined}
        className={!expanded ? 'cursor-pointer group' : ''}
        role={!expanded ? 'button' : undefined}
        tabIndex={!expanded ? 0 : undefined}
        onKeyDown={!expanded ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true); } } : undefined}
      >
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          {HON_META.map((m) => {
            const tone = TONES[m.tone];
            const count = dataset[m.key] || 0;
            const pct = totalSet > 0 ? Math.round((count / totalSet) * 100) : 0;
            const Icon = m.Icon;
            return (
              <div key={m.key} className="text-center p-3 rounded-lg" style={{ background: tone.bg, border: `1px solid ${tone.border}` }} title={m.desc}>
                <Icon className="w-6 h-6 mx-auto mb-1" style={{ color: tone.fg }} aria-hidden="true" />
                <div className="text-xl font-bold tabular-nums" style={{ color: tone.fg }}>{count}</div>
                <div className="text-[10px] font-bold uppercase leading-tight" style={{ color: tone.fg }}>{m.label}</div>
                <div className="text-[10px] mt-0.5 tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>{pct}% do conjunto</div>
              </div>
            );
          })}
        </div>
        {(dataset.nenhum || 0) > 0 && (
          <div className="mt-2 text-[10px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: TONES.muted.bg, color: 'var(--cbc-text-muted)' }}>
            <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {dataset.nenhum} contrato{dataset.nenhum === 1 ? '' : 's'} sem honorários cadastrados — revisar preenchimento.
          </div>
        )}

        {!expanded ? (
          <div className="mt-3 pt-2 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wide group-hover:opacity-80 transition-opacity"
            style={{ borderTop: '1px solid var(--cbc-border)', color: 'var(--cbc-accent)' }}>
            <ChartBarIcon className="w-3.5 h-3.5" aria-hidden="true" /> Ver evolução mensal
            <ChevronDownIcon className="w-3.5 h-3.5" aria-hidden="true" />
          </div>
        ) : (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--cbc-border)' }}>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 -mx-0.5 px-0.5">
              <MesChip active={mesSel === null} onClick={() => setMesSel(null)} label="Todos" />
              {meses.map((m) => (
                <MesChip key={m.key} active={mesSel === m.key} onClick={() => setMesSel(mesSel === m.key ? null : m.key)} label={m.label} />
              ))}
            </div>
            <HonorariosLineChart serie={serie} mesSel={mesSel} onPickMes={setMesSel} />
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-2 mx-auto flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide cursor-pointer hover:underline"
              style={{ color: 'var(--cbc-text-muted)' }}
            >
              <ChevronUpIcon className="w-3.5 h-3.5" aria-hidden="true" /> Recolher
            </button>
          </div>
        )}
      </div>
    </DashCard>
  );
}

// ─── Top resorts do mês (assinaturas efetivas) ───
// Pódio (ouro/prata/bronze) — paleta de medalha intencional. O ouro lê o token
// --cbc-gold (adapta ao dark); prata/bronze ficam literais (cores de medalha,
// não-status). 4º+ caem no navy-light (token).
const RANK_COLORS = ['var(--cbc-gold)', '#8A93A3', '#A66A35', 'var(--cbc-navy-light)', 'var(--cbc-navy-light)'];

export function TopMesCard({ top, mesLabel, delay = 0 }) {
  return (
    <DashCard title="Top resorts do mês" subtitle={`Assinaturas em ${mesLabel}`} delay={delay}>
      {(!top || top.length === 0) ? (
        <div className="text-center py-6 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Nenhuma assinatura registrada neste mês ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {top.map((r, i) => {
            const max = top[0]?.count || 1;
            return (
              <div key={r.resort} className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 text-white"
                  style={{ background: RANK_COLORS[i] || RANK_COLORS[3] }}
                  aria-label={`${i + 1}º lugar`}
                >
                  {i + 1}
                </span>
                <span className="text-[11px] w-36 truncate shrink-0 font-medium" style={{ color: 'var(--cbc-text-secondary)' }}>{r.resort}</span>
                <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${(r.count / max) * 100}%`, background: RANK_COLORS[i] || RANK_COLORS[3] }} />
                </div>
                <span className="text-[11px] font-bold w-7 text-right tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>{r.count}</span>
              </div>
            );
          })}
        </div>
      )}
    </DashCard>
  );
}

// ─── Chips de resumo numérico (jornada / distribuição) ───
function StatChip({ valor, label, tone = TONES.info }) {
  return (
    <div className="text-center px-2 py-2.5 rounded-lg" style={{ background: tone.bg }}>
      <div className="text-xl md:text-2xl font-bold tabular-nums" style={{ color: tone.fg }}>{valor ?? '—'}</div>
      <div className="text-[10px] font-bold uppercase mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>{label}</div>
    </div>
  );
}

function FaixaLegenda({ faixas }) {
  const items = [
    { tone: TONES.success, label: `Até ${faixas[0]}d` },
    { tone: TONES.warning, label: `${faixas[0] + 1}–${faixas[1]}d` },
    // (#extract-base 20/06) 3a faixa alinhada com faixaTone (laranja -> warning)
    { tone: TONES.warning, label: `${faixas[1] + 1}–${faixas[2]}d` },
    { tone: TONES.danger, label: `+${faixas[2]}d` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 mt-3 pt-2" style={{ borderTop: '1px solid var(--cbc-border)' }}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: it.tone.fg }} /> {it.label}
        </span>
      ))}
    </div>
  );
}

// ─── Jornada de compra (1ª mensagem → assinatura) ───
const JORNADA_FAIXAS = [7, 15, 30];

export function JornadaCard({ jornada, delay = 0 }) {
  const porResort = useMemo(() => {
    const map = {};
    (jornada.casos || []).forEach((c) => { (map[c.resort] = map[c.resort] || []).push(c.dias); });
    return Object.entries(map)
      .map(([resort, dias]) => ({
        resort,
        media: Math.round(dias.reduce((s, d) => s + d, 0) / dias.length),
        count: dias.length,
      }))
      .sort((a, b) => a.media - b.media);
  }, [jornada.casos]);

  if (!jornada.total) {
    return (
      <DashCard title="Jornada de compra" subtitle="1ª mensagem até a assinatura" delay={delay}>
        <div className="text-center py-6 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Sem dados no escopo — depende do campo &quot;Data da 1ª mensagem&quot; preenchido no contrato.
        </div>
      </DashCard>
    );
  }

  const maxMedia = Math.max(...porResort.map((r) => r.media), 1);
  return (
    <DashCard title="Jornada de compra" subtitle="Dias entre a 1ª mensagem do cliente e a assinatura" delay={delay}>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
        <StatChip valor={jornada.media} label="Média (dias)" tone={TONES.info} />
        <StatChip valor={jornada.mediana} label="Mediana" tone={TONES.violet} />
        <StatChip valor={jornada.min} label="Mais rápido" tone={TONES.success} />
        <StatChip valor={jornada.max} label="Mais lento" tone={TONES.danger} />
        <StatChip valor={jornada.total} label="Contratos" tone={TONES.muted} />
      </div>
      {porResort.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--cbc-text-muted)' }}>Média por resort</div>
          {porResort.map((r) => {
            const tone = faixaTone(r.media, JORNADA_FAIXAS);
            return (
              <div key={r.resort} className="flex items-center gap-2">
                <span className="text-[11px] w-24 sm:w-32 md:w-40 truncate shrink-0" style={{ color: 'var(--cbc-text-secondary)' }}>{r.resort}</span>
                <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                  <div
                    className="h-full rounded-full flex items-center justify-end pr-1.5 transition-all"
                    style={{ width: `${Math.max((r.media / maxMedia) * 100, 12)}%`, background: tone.fg }}
                  >
                    <span className="text-[10px] font-bold text-white tabular-nums">{r.media}d</span>
                  </div>
                </div>
                <span className="text-[10px] w-8 text-right shrink-0 tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>{r.count}×</span>
              </div>
            );
          })}
          <FaixaLegenda faixas={JORNADA_FAIXAS} />
        </div>
      )}
    </DashCard>
  );
}

// ─── Tempo até distribuição (assinatura → petição protocolada) ───
const DIST_FAIXAS = [30, 60, 120];
const medianOf = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function DistribuicaoCard({ casos, delay = 0 }) {
  const [resortFilter, setResortFilter] = useState('');
  const [drill, setDrill] = useState(null);

  const porResort = useMemo(() => {
    const map = {};
    (casos || []).forEach((c) => { (map[c.resort] = map[c.resort] || []).push(c.dias); });
    return Object.entries(map)
      .map(([resort, dias]) => ({
        resort,
        media: Math.round(dias.reduce((s, d) => s + d, 0) / dias.length),
        count: dias.length,
      }))
      .sort((a, b) => a.media - b.media);
  }, [casos]);

  const subset = useMemo(
    () => (resortFilter ? (casos || []).filter((c) => c.resort === resortFilter) : (casos || [])),
    [casos, resortFilter]
  );

  // Estatísticas REAIS do recorte (a versão antiga mostrava média ponderada
  // rotulada de "mediana" e min/máx das médias quando filtrado por resort)
  const stats = useMemo(() => {
    const dias = subset.map((c) => c.dias);
    return {
      total: dias.length,
      media: dias.length ? Math.round(dias.reduce((s, d) => s + d, 0) / dias.length) : null,
      mediana: medianOf(dias),
      min: dias.length ? Math.min(...dias) : null,
      max: dias.length ? Math.max(...dias) : null,
    };
  }, [subset]);

  const pivot = useMemo(() => {
    const map = {};
    subset.forEach((c) => {
      map[c.resort] = map[c.resort] || {};
      (map[c.resort][c.tipo] = map[c.resort][c.tipo] || []).push(c);
    });
    return Object.entries(map)
      .map(([resort, tipos]) => ({
        resort,
        tipos: Object.entries(tipos)
          .map(([tipo, lista]) => ({
            tipo,
            media: Math.round(lista.reduce((s, c) => s + c.dias, 0) / lista.length),
            count: lista.length,
            contratos: [...lista].sort((a, b) => a.dias - b.dias),
          }))
          .sort((a, b) => a.media - b.media),
      }))
      .sort((a, b) => a.resort.localeCompare(b.resort, 'pt-BR'));
  }, [subset]);

  return (
    <DashCard
      title="Tempo até distribuição"
      subtitle={<>Da assinatura até a ação protocolada — preenchido pelo ADVBOX/DataJud <span style={{ opacity: 0.7 }}>(ideia do Mizael)</span></>}
      delay={delay}
      right={porResort.length > 0 && (
        <select
          value={resortFilter}
          onChange={(e) => { setResortFilter(e.target.value); setDrill(null); }}
          className="text-[11px] px-2.5 py-1.5 rounded-lg cursor-pointer focus:outline-none"
          style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}
          aria-label="Filtrar por resort"
        >
          <option value="">Todos os resorts</option>
          {porResort.map((r) => <option key={r.resort} value={r.resort}>{r.resort}</option>)}
        </select>
      )}
    >
      {(!casos || casos.length === 0) ? (
        <div className="text-center py-6 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Aguardando a primeira distribuição no escopo. O prazo é registrado automaticamente quando a tarefa
          &quot;DISTRIBUIR AÇÃO&quot; é concluída no ADVBOX ou o DataJud confirma o ajuizamento.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
            <StatChip valor={stats.media} label="Média (dias)" tone={TONES.info} />
            <StatChip valor={stats.mediana} label="Mediana" tone={TONES.violet} />
            <StatChip valor={stats.min} label="Mais rápido" tone={TONES.success} />
            <StatChip valor={stats.max} label="Mais lento" tone={TONES.danger} />
            <StatChip valor={stats.total} label="Processos" tone={TONES.muted} />
          </div>

          {!resortFilter && porResort.length > 1 && (
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--cbc-text-muted)' }}>
                Média por resort — clique para detalhar
              </div>
              <div className="space-y-1.5">
                {porResort.map((r) => {
                  const tone = faixaTone(r.media, DIST_FAIXAS);
                  const maxMedia = Math.max(...porResort.map((x) => x.media), 1);
                  return (
                    <div key={r.resort} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setResortFilter(r.resort); setDrill(null); }}
                        className="text-[11px] w-36 md:w-44 truncate shrink-0 text-left cursor-pointer hover:underline"
                        style={{ color: 'var(--cbc-text-secondary)' }}
                        title={`Detalhar ${r.resort}`}
                      >
                        {r.resort}
                      </button>
                      <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max((r.media / maxMedia) * 100, 4)}%`, background: tone.fg }} />
                      </div>
                      <span className="text-[11px] font-bold w-12 text-right shrink-0 tabular-nums" style={{ color: tone.fg }}>{r.media}d</span>
                      <span className="text-[10px] w-8 text-right shrink-0 tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>({r.count})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {pivot.length > 0 && (
            <div className="overflow-x-auto">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>
                  {resortFilter ? `Tipos de ação — ${resortFilter}` : 'Resort × tipo de ação'} (média em dias · clique para ver contratos)
                </div>
                {resortFilter && (
                  <button
                    type="button"
                    onClick={() => { setResortFilter(''); setDrill(null); }}
                    className="text-[10px] font-bold cursor-pointer hover:underline"
                    style={{ color: 'var(--cbc-accent)' }}
                  >
                    Limpar filtro
                  </button>
                )}
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--cbc-border)' }}>
                    {!resortFilter && <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Resort</th>}
                    <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Tipo de ação</th>
                    <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Média</th>
                    <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>Qtd</th>
                  </tr>
                </thead>
                <tbody>
                  {pivot.flatMap((r) =>
                    r.tipos.map((t, j) => {
                      const tone = faixaTone(t.media, DIST_FAIXAS);
                      const drillKey = `${r.resort}|${t.tipo}`;
                      const isOpen = drill === drillKey;
                      return (
                        <React.Fragment key={drillKey}>
                          <tr
                            className="cursor-pointer transition-colors"
                            style={{ borderBottom: '1px solid var(--cbc-border)' }}
                            onClick={() => setDrill(isOpen ? null : drillKey)}
                            title="Clique para ver os contratos"
                          >
                            {!resortFilter && (
                              <td className="py-2 px-2" style={{ color: 'var(--cbc-text-secondary)' }}>{j === 0 ? r.resort : ''}</td>
                            )}
                            <td className="py-2 px-2" style={{ color: 'var(--cbc-text-secondary)' }}>
                              <span className="inline-flex items-center gap-1">
                                <ChevronRightIcon
                                  className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                                  style={{ color: 'var(--cbc-text-muted)' }}
                                  aria-hidden="true"
                                />
                                {t.tipo}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-right font-bold tabular-nums" style={{ color: tone.fg }}>{t.media}d</td>
                            <td className="py-2 px-2 text-right tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>{t.count}</td>
                          </tr>
                          {isOpen && t.contratos.length > 0 && (
                            <tr>
                              <td colSpan={resortFilter ? 3 : 4} className="p-0">
                                <div
                                  className="ml-4 my-1 py-1.5 px-3 rounded-r-lg"
                                  style={{ background: 'var(--cbc-bg-subtle)', borderLeft: '2px solid var(--cbc-accent)' }}
                                >
                                  {t.contratos.map((dc, k) => (
                                    <div key={k} className="flex items-center justify-between py-0.5 text-[10px]">
                                      <span style={{ color: 'var(--cbc-text-secondary)' }}>{dc.nome}</span>
                                      <span className="font-bold tabular-nums" style={{ color: faixaTone(dc.dias, DIST_FAIXAS).fg }}>{dc.dias}d</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
              <FaixaLegenda faixas={DIST_FAIXAS} />
            </div>
          )}
        </>
      )}
    </DashCard>
  );
}

// ─── Insights automáticos ───
const INSIGHT_ICONS = {
  chart: ChartBarIcon,
  bolt: BoltIcon,
  money: CurrencyDollarIcon,
  calendar: CalendarDaysIcon,
  down: ArrowTrendingDownIcon,
  up: ArrowTrendingUpIcon,
  new: SparklesIcon,
  warn: ExclamationTriangleIcon,
  clock: ClockIcon,
};
const INSIGHT_TONES = { positivo: TONES.success, alerta: TONES.warning, info: TONES.info };

const INSIGHTS_PER_PAGE = 4;

export function InsightsCard({ insights, delay = 0 }) {
  const [offset, setOffset] = useState(0);
  if (!insights || insights.length === 0) return null;
  const temMais = insights.length > INSIGHTS_PER_PAGE;
  const n = Math.min(INSIGHTS_PER_PAGE, insights.length);
  // janela rotativa: "gerar mais" avança o offset e dá a volta (substitui os atuais)
  const visiveis = Array.from({ length: n }, (_, i) => insights[(offset + i) % insights.length]);
  const ini = (offset % insights.length) + 1;
  const fim = ((offset + n - 1) % insights.length) + 1;

  return (
    <DashCard
      title="Insights automáticos"
      subtitle={temMais
        ? `Padrões e alertas detectados · mostrando ${ini}–${fim} de ${insights.length}`
        : `Padrões e alertas detectados · ${insights.length} no total`}
      delay={delay}
      right={<MagnifyingGlassIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-muted)' }} aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {visiveis.map((ins, i) => {
          const tone = INSIGHT_TONES[ins.kind] || TONES.info;
          const Icon = INSIGHT_ICONS[ins.icon] || ChartBarIcon;
          return (
            <div key={`${offset}-${i}`} className="p-3 rounded-lg flex items-start gap-2.5 anim-slide-up" style={{ background: tone.bg, border: `1px solid ${tone.border}`, animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}>
              <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: tone.fg }} aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[11px] font-bold leading-snug" style={{ color: tone.fg }}>{ins.texto}</div>
                {ins.detalhe && <div className="text-[10px] mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>{ins.detalhe}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {temMais && (
        <button
          type="button"
          onClick={() => setOffset((o) => (o + INSIGHTS_PER_PAGE) % insights.length)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wide py-2 rounded-lg cursor-pointer transition-colors hover:brightness-95"
          style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}
          title="Mostra os próximos insights, substituindo os atuais"
        >
          <SparklesIcon className="w-3.5 h-3.5" aria-hidden="true" /> Gerar mais insights
        </button>
      )}
    </DashCard>
  );
}

// ─── Últimos contratos ───
const RECENTES_PER_PAGE = 5;
const STATUS_PILL = {
  assinado: { label: 'Assinado', tone: TONES.success },
  enviado_zapsign: { label: 'Enviado', tone: TONES.info },
  rascunho: { label: 'Rascunho', tone: TONES.muted },
  cancelado: { label: 'Cancelado', tone: TONES.danger },
};

export function RecentContracts({ recentes, onNavigate, delay = 0 }) {
  const [page, setPage] = useState(1);
  if (!recentes || recentes.length === 0) return null;
  const totalPages = Math.ceil(recentes.length / RECENTES_PER_PAGE);
  const safePage = Math.min(page, totalPages);
  const paged = recentes.slice((safePage - 1) * RECENTES_PER_PAGE, safePage * RECENTES_PER_PAGE);

  return (
    <DashCard
      title="Últimos contratos"
      subtitle={`${recentes.length} mais recentes do escopo`}
      delay={delay}
      right={
        <button
          type="button"
          onClick={() => onNavigate?.('contratos')}
          className="text-[10px] font-bold uppercase cursor-pointer hover:underline inline-flex items-center gap-1"
          style={{ color: 'var(--cbc-accent)' }}
        >
          Abrir Contratos <ArrowRightIcon className="w-3 h-3" aria-hidden="true" />
        </button>
      }
    >
      <div className="space-y-2">
        {paged.map((c) => {
          const st = STATUS_PILL[c.status] || STATUS_PILL.rascunho;
          const assinadoEm = c.status === 'assinado' && (c.signed_at || c.advbox_date)
            ? new Date(c.signed_at || c.advbox_date).toLocaleDateString('pt-BR')
            : null;
          return (
            <div key={c.id} className="p-2.5 rounded-lg" style={{ background: 'var(--cbc-bg-subtle)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold truncate" style={{ color: 'var(--cbc-text-primary)' }}>{c.nome_contratante1}</span>
                    <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ background: st.tone.bg, color: st.tone.fg }}>
                      {st.label}
                    </span>
                    {c.arquivado_em && (
                      <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ background: TONES.muted.bg, color: TONES.muted.fg }}>
                        Arquivado
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--cbc-text-muted)' }}>{c.resort} · {c.tipo_acao}</div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-bold block tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>{formatCurrency(c.honorarios_total)}</span>
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>
                    Criado {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </span>
                  {assinadoEm && (
                    <span className="text-[10px] block" style={{ color: TONES.success.fg }}>Assinado {assinadoEm}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-3 pt-3" style={{ borderTop: '1px solid var(--cbc-border)' }}>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="w-7 h-7 rounded flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-default text-xs"
            style={{ color: 'var(--cbc-text-muted)' }}
            aria-label="Página anterior"
          >‹</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || (p >= safePage - 1 && p <= safePage + 1))
            .map((p, idx, arr) => {
              const showDots = idx > 0 && p - arr[idx - 1] > 1;
              return (
                <span key={p}>
                  {showDots && <span className="text-xs px-0.5" style={{ color: 'var(--cbc-text-muted)' }}>…</span>}
                  <button
                    type="button"
                    onClick={() => setPage(p)}
                    className="w-7 h-7 rounded text-[10px] font-bold cursor-pointer transition-all"
                    style={p === safePage
                      ? { background: 'var(--cbc-accent)', color: 'var(--cbc-bg)' }
                      : { color: 'var(--cbc-text-muted)' }}
                    aria-label={`Página ${p}`}
                    aria-current={p === safePage ? 'page' : undefined}
                  >{p}</button>
                </span>
              );
            })}
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="w-7 h-7 rounded flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-default text-xs"
            style={{ color: 'var(--cbc-text-muted)' }}
            aria-label="Próxima página"
          >›</button>
        </div>
      )}
    </DashCard>
  );
}

// ─── Barra de filtros ───
export function FilterBar({
  periodo, setPeriodo,
  dataInicio, setDataInicio,
  dataFim, setDataFim,
  resort, setResort,
  tipoAcao, setTipoAcao,
  incluirArquivados, setIncluirArquivados,
  opcoes, arquivadosCount,
  onClear,
}) {
  const hasFilters = (periodo && periodo !== 'tudo') || resort || tipoAcao || incluirArquivados;
  return (
    <div
      className="rounded-xl p-3 md:p-4"
      style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', boxShadow: 'var(--cbc-shadow)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <FunnelIcon className="w-3.5 h-3.5" style={{ color: 'var(--cbc-text-muted)' }} aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-[1px]" style={{ color: 'var(--cbc-text-muted)' }}>
            Filtros — aplicam a toda a página
          </span>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-bold uppercase cursor-pointer hover:underline inline-flex items-center gap-1"
            style={{ color: 'var(--cbc-danger)' }}
          >
            <XMarkIcon className="w-3 h-3" aria-hidden="true" /> Limpar filtros
          </button>
        )}
      </div>

      {/* Período */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2.5" role="group" aria-label="Período (data de criação)">
        {PERIODOS.map((p) => {
          const active = (periodo || 'tudo') === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriodo(p.key)}
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-all"
              style={active
                ? { background: 'var(--cbc-accent)', color: 'var(--cbc-bg)', boxShadow: 'var(--cbc-shadow)' }
                : { background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-secondary)', border: '1px solid var(--cbc-border)' }}
              aria-pressed={active}
            >
              {p.label}
            </button>
          );
        })}
        {periodo === 'custom' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="rounded-lg px-2 py-1 text-[11px] focus:outline-none"
              style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}
              aria-label="Data inicial"
            />
            <span className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>até</span>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="rounded-lg px-2 py-1 text-[11px] focus:outline-none"
              style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}
              aria-label="Data final"
            />
          </div>
        )}
      </div>

      {/* Resort / tipo / arquivados */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={resort}
          onChange={(e) => setResort(e.target.value)}
          className="flex-1 min-w-[150px] max-w-[260px] rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none"
          style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}
          aria-label="Filtrar por resort"
        >
          <option value="">Todos os resorts ({opcoes.resorts.length})</option>
          {opcoes.resorts.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={tipoAcao}
          onChange={(e) => setTipoAcao(e.target.value)}
          className="flex-1 min-w-[150px] max-w-[260px] rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:outline-none"
          style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}
          aria-label="Filtrar por tipo de ação"
        >
          <option value="">Todos os tipos de ação ({opcoes.tipos.length})</option>
          {opcoes.tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase cursor-pointer select-none"
          style={incluirArquivados
            ? { background: TONES.warning.bg, color: TONES.warning.fg, border: `1px solid ${TONES.warning.border}` }
            : { background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-muted)', border: '1px solid var(--cbc-border)' }}
          title="Contratos arquivados ficam fora das métricas por padrão"
        >
          <input
            type="checkbox"
            checked={!!incluirArquivados}
            onChange={(e) => setIncluirArquivados(e.target.checked)}
            className="w-3.5 h-3.5 cursor-pointer accent-[var(--cbc-gold)]"
          />
          Incluir arquivados{arquivadosCount > 0 ? ` (${arquivadosCount})` : ''}
        </label>
      </div>
    </div>
  );
}

// ─── Escopo vazio ───
export function EmptyScope({ onClear }) {
  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{ background: 'var(--cbc-bg-card)', border: '1px dashed var(--cbc-border-strong)' }}
    >
      <FunnelIcon className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--cbc-text-muted)' }} aria-hidden="true" />
      <div className="text-sm font-bold mb-1" style={{ color: 'var(--cbc-text-primary)' }}>Nenhum contrato neste recorte</div>
      <div className="text-[11px] mb-4" style={{ color: 'var(--cbc-text-muted)' }}>
        Ajuste o período ou remova filtros para voltar a ver os dados.
      </div>
      <button
        type="button"
        onClick={onClear}
        className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer"
        style={{ background: 'var(--cbc-accent)', color: 'var(--cbc-bg)' }}
      >
        Limpar filtros
      </button>
    </div>
  );
}
