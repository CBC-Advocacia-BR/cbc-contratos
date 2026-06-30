// (#356) Dashboard de Saude com SLOs
// Objetivos de Nivel de Servico — mede taxa de sucesso das automacoes
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
// (#126) Edge Function helper com fallback para Function antiga
import { API } from '../utils/apiEndpoints';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  BoltIcon,
  ShieldCheckIcon,
  ChartBarSquareIcon,
} from '@heroicons/react/24/outline';

const SLO_DEFS = [
  { key: 'uptime', name: 'Uptime API', target: 99.5, unit: '%', desc: 'Health check / .netlify/functions/health (30 dias)' },
  { key: 'latency', name: 'Latencia < 1s', target: 95, unit: '%', desc: '% de requests com tempo abaixo de 1000ms' },
  { key: 'zapsign', name: 'Sucesso ZapSign', target: 98, unit: '%', desc: 'Envios para assinatura sem erro' },
  { key: 'drive', name: 'Sucesso Drive Upload', target: 97, unit: '%', desc: 'Contratos com documento salvo no Drive' },
  { key: 'advbox', name: 'Sucesso ADVBOX', target: 97, unit: '%', desc: 'Processos criados no ADVBOX sem erro' },
];

function statusFromValue(val, target) {
  if (val === null || val === undefined || Number.isNaN(val)) return 'unknown';
  if (val >= target) return 'ok';
  if (val >= target * 0.97) return 'warn'; // ~95-99% do alvo
  return 'bad';
}

const STATUS_COLOR = {
  ok: { bg: '#F0FDF4', text: '#16A34A', label: 'No alvo' },
  warn: { bg: '#FEF3C7', text: '#D97706', label: 'Atencao' },
  bad: { bg: '#FEE2E2', text: '#DC2626', label: 'Fora do alvo' },
  unknown: { bg: '#F3F4F6', text: '#6B7280', label: 'Sem dados' },
};

function Bar({ value, target, color }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  const targetPct = Math.max(0, Math.min(100, target));
  return (
    <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      {/* Linha do alvo */}
      <div className="absolute top-0 bottom-0" style={{
        left: `${targetPct}%`,
        width: '2px',
        background: 'rgba(0,0,0,0.35)',
      }} />
    </div>
  );
}

function MiniChart({ series, color }) {
  if (!series || series.length === 0) {
    return <div className="h-6" />;
  }
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const range = Math.max(max - min, 1);
  const w = 120; const h = 28;
  const pts = series.map((v, i) => {
    const x = (i / Math.max(series.length - 1, 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" points={pts.join(' ')} />
    </svg>
  );
}

export default function HealthSlos() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [automationRows, setAutomationRows] = useState([]);
  const [healthSamples, setHealthSamples] = useState([]);

  useEffect(() => {
    let mounted = true;
    async function fetchAll() {
      setLoading(true);
      setError('');
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        // automation_log (ultimos 30d)
        const { data: autoData } = await supabase
          .from('automation_log')
          .select('action, status, created_at')
          .gte('created_at', thirtyDaysAgo)
          .limit(5000);
        if (mounted) setAutomationRows(autoData || []);

        // asaas_error_log referenciado apenas para monitoramento futuro (nao usado hoje)
        try {
          await supabase
            .from('asaas_error_log')
            .select('created_at')
            .gte('created_at', sevenDaysAgo)
            .limit(500);
        } catch { /* tabela pode nao existir */ }

        // health live — uma amostragem simples agora
        try {
          const start = Date.now();
          // (#126) Migrado para Edge Function /api/health (timeout 8s ja embutido no helper)
          const resp = await API.health();
          const ok = resp.ok;
          const ms = Date.now() - start;
          if (mounted) {
            setHealthSamples(prev => {
              const next = [...prev, { ok, ms, ts: Date.now() }];
              return next.slice(-30);
            });
          }
        } catch {
          if (mounted) {
            setHealthSamples(prev => {
              const next = [...prev, { ok: false, ms: 0, ts: Date.now() }];
              return next.slice(-30);
            });
          }
        }
      } catch (e) {
        console.error('[HealthSlos]', e);
        if (mounted) setError('Erro ao carregar SLOs');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchAll();
    const t = setInterval(fetchAll, 120000); // 2min
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const slos = useMemo(() => {
    // Computa por SLO
    const byDay = (days = 7) => {
      // returns fn(list, predicate)
      return (rows, actionFilter) => {
        const counts = new Array(days).fill(0).map(() => ({ ok: 0, err: 0 }));
        const now = Date.now();
        rows.forEach(r => {
          if (actionFilter && r.action !== actionFilter) return;
          const t = new Date(r.created_at).getTime();
          const dayIdx = Math.floor((now - t) / 86400000);
          if (dayIdx < 0 || dayIdx >= days) return;
          const slot = counts[days - 1 - dayIdx]; // mais antigo primeiro
          if (r.status === 'ok') slot.ok++;
          else slot.err++;
        });
        return counts.map(c => {
          const total = c.ok + c.err;
          return total > 0 ? (c.ok / total) * 100 : null;
        });
      };
    };

    const dayCalc = byDay(7);

    // ZapSign: automation_log (action=zapsign)
    const zapRows = automationRows.filter(r => r.action === 'zapsign');
    const zapOk = zapRows.filter(r => r.status === 'ok').length;
    const zapTotal = zapRows.length;
    const zapPct = zapTotal > 0 ? (zapOk / zapTotal) * 100 : null;
    const zapSeries = dayCalc(automationRows, 'zapsign').filter(x => x !== null);

    // Drive
    const drvRows = automationRows.filter(r => r.action === 'drive');
    const drvOk = drvRows.filter(r => r.status === 'ok').length;
    const drvTotal = drvRows.length;
    const drvPct = drvTotal > 0 ? (drvOk / drvTotal) * 100 : null;
    const drvSeries = dayCalc(automationRows, 'drive').filter(x => x !== null);

    // ADVBOX
    const advRows = automationRows.filter(r => r.action === 'advbox');
    const advOk = advRows.filter(r => r.status === 'ok').length;
    const advTotal = advRows.length;
    const advPct = advTotal > 0 ? (advOk / advTotal) * 100 : null;
    const advSeries = dayCalc(automationRows, 'advbox').filter(x => x !== null);

    // Uptime — usa samples in-memory do ciclo + assume 100 sem amostra negativa
    const upOk = healthSamples.filter(s => s.ok).length;
    const upTotal = healthSamples.length;
    const upPct = upTotal > 0 ? (upOk / upTotal) * 100 : null;
    const upSeries = healthSamples.map(s => s.ok ? 100 : 0).slice(-7);

    // Latency — % amostras < 1000ms
    const fastCount = healthSamples.filter(s => s.ok && s.ms > 0 && s.ms < 1000).length;
    const latPct = upTotal > 0 ? (fastCount / upTotal) * 100 : null;
    const latSeries = healthSamples.map(s => s.ms < 1000 && s.ok ? 100 : 0).slice(-7);

    return {
      uptime: { value: upPct, target: 99.5, total: upTotal, ok: upOk, series: upSeries },
      latency: { value: latPct, target: 95, total: upTotal, ok: fastCount, series: latSeries },
      zapsign: { value: zapPct, target: 98, total: zapTotal, ok: zapOk, series: zapSeries },
      drive: { value: drvPct, target: 97, total: drvTotal, ok: drvOk, series: drvSeries },
      advbox: { value: advPct, target: 97, total: advTotal, ok: advOk, series: advSeries },
    };
  }, [automationRows, healthSamples]);

  if (loading && automationRows.length === 0 && healthSamples.length === 0) {
    return (
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheckIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-muted)' }} />
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>
            Objetivos de Nivel de Servico (SLOs)
          </div>
        </div>
        <div className="skeleton h-40 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4"
      style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-muted)' }} />
          <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>
            Objetivos de Nivel de Servico (SLOs)
          </h3>
        </div>
        <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Baseado em <code>automation_log</code> (30d) e amostras <code>/health</code> ao vivo
        </div>
      </div>

      {error && (
        <div className="mb-2 text-[11px] text-red-500 inline-flex items-center gap-1">
          <ExclamationTriangleIcon className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      <div className="space-y-2">
        {SLO_DEFS.map(def => {
          const s = slos[def.key];
          const val = s?.value ?? null;
          const status = statusFromValue(val, def.target);
          const sc = STATUS_COLOR[status];
          const barColor = status === 'ok' ? '#16A34A' : status === 'warn' ? '#D97706' : status === 'bad' ? '#DC2626' : '#9CA3AF';

          // Error budget calc (simplificado): budget = 100 - target; consumido = 100 - value
          const budget = 100 - def.target;
          const consumed = val !== null ? Math.max(0, 100 - val) : 0;
          const remaining = val !== null ? Math.max(0, budget - consumed) : null;
          const remainingPct = budget > 0 && remaining !== null ? Math.min(100, (remaining / budget) * 100) : null;

          return (
            <div key={def.key}
              className="rounded-lg p-3 border"
              style={{ background: 'var(--cbc-bg-subtle, #FAFAFA)', borderColor: 'var(--cbc-border)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{def.name}</span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{ background: sc.bg, color: sc.text }}>
                      {sc.label}
                    </span>
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>{def.desc}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold" style={{ color: barColor }}>
                    {val !== null ? `${val.toFixed(1)}%` : '—'}
                  </div>
                  <div className="text-[9px]" style={{ color: 'var(--cbc-text-muted)' }}>Meta {def.target}{def.unit}</div>
                </div>
              </div>

              <div className="mb-2">
                <Bar value={val || 0} target={def.target} color={barColor} />
              </div>

              <div className="flex items-center justify-between gap-4 flex-wrap">
                {/* Mini chart (7 dias) */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <BoltIcon className="w-3 h-3 shrink-0" style={{ color: 'var(--cbc-text-muted)' }} />
                  <div className="flex-1 min-w-0 max-w-[180px]">
                    <MiniChart series={s?.series || []} color={barColor} />
                  </div>
                  <span className="text-[9px] shrink-0" style={{ color: 'var(--cbc-text-muted)' }}>7d</span>
                </div>
                {/* Error budget */}
                <div className="text-[10px] shrink-0" style={{ color: 'var(--cbc-text-muted)' }}>
                  Budget restante:
                  <span className="ml-1 font-bold"
                    style={{ color: remainingPct === null ? 'var(--cbc-text-muted)' : remainingPct > 50 ? '#16A34A' : remainingPct > 20 ? '#D97706' : '#DC2626' }}>
                    {remainingPct !== null ? `${remainingPct.toFixed(0)}%` : '—'}
                  </span>
                </div>
                {/* Total amostras */}
                <div className="text-[10px] shrink-0" style={{ color: 'var(--cbc-text-muted)' }}>
                  Amostras: <span className="font-bold">{s?.total || 0}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t flex items-start gap-2 text-[10px]"
        style={{ borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-muted)' }}>
        <ChartBarSquareIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div>
          <div>
            <span className="font-bold">Como ler:</span> verde = no alvo, amarelo = dentro de 97% do alvo, vermelho = fora.
          </div>
          <div className="mt-0.5">
            <span className="font-bold">Error budget:</span> quanto ainda pode falhar este periodo antes de estourar a meta.
          </div>
        </div>
      </div>
    </div>
  );
}
