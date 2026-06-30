// (resilience 28/04) Monitor de saude do Supabase — mede latencia da query
// 1x por minuto e mostra um grafico de barras das ultimas 60 medicoes (1h).
// Persiste historico em localStorage (24h max).
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ChartBarIcon } from '@heroicons/react/24/outline';

const STORAGE_KEY = 'cbc-supabase-health-history';
const MAX_HISTORY = 1440; // 24h x 60min

export default function SupabaseHealthMonitor() {
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  });
  const [lastCheck, setLastCheck] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | ok | slow | error

  useEffect(() => {
    let cancelled = false;

    const measure = async () => {
      const start = performance.now();
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        // Query simples — so para medir latencia
        await supabase
          .from('user_permissions')
          .select('email')
          .limit(1)
          .abortSignal(ctrl.signal);
        clearTimeout(t);
        if (cancelled) return;
        const elapsed = Math.round(performance.now() - start);
        const result = { ts: Date.now(), latency: elapsed, ok: true };
        let nextStatus = 'ok';
        if (elapsed > 10000) nextStatus = 'error';
        else if (elapsed > 2000) nextStatus = 'slow';
        setStatus(nextStatus);
        setLastCheck(result);
        pushHistory(result);
      } catch (e) {
        if (cancelled) return;
        const result = { ts: Date.now(), latency: null, ok: false, error: e?.message || 'erro' };
        setStatus('error');
        setLastCheck(result);
        pushHistory(result);
      }
    };

    const pushHistory = (entry) => {
      setHistory(h => {
        const next = [...h.slice(-(MAX_HISTORY - 1)), entry];
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore quota */ }
        return next;
      });
    };

    measure();
    const id = setInterval(measure, 60_000); // 1 min
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Calcular metricas das ultimas 60 medicoes (1h)
  const last60 = history.slice(-60);
  const okSamples = last60.filter(h => h.ok);
  const avgLatency = okSamples.length
    ? Math.round(okSamples.reduce((a, b) => a + b.latency, 0) / okSamples.length)
    : null;
  const errorRate = last60.length
    ? Math.round((last60.filter(h => !h.ok).length / last60.length) * 100)
    : 0;

  const statusLabel = status === 'ok' ? 'OK'
    : status === 'slow' ? 'Lento'
    : status === 'error' ? 'ERRO'
    : '...';
  const statusColor = status === 'ok' ? 'green'
    : status === 'slow' ? 'amber'
    : status === 'error' ? 'red'
    : 'gray';

  const latencyValue = lastCheck?.latency ? `${lastCheck.latency}ms` : '—';
  const latencyColor = !lastCheck ? 'gray'
    : !lastCheck.ok ? 'red'
    : lastCheck.latency < 500 ? 'green'
    : lastCheck.latency < 2000 ? 'amber'
    : 'red';

  const errorColor = errorRate === 0 ? 'green' : errorRate < 10 ? 'amber' : 'red';

  return (
    <section className="mb-6">
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text, #1A2E52)' }}>
        <ChartBarIcon className="w-5 h-5" aria-hidden="true" />
        Saude Supabase
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <StatCard label="Status" value={statusLabel} color={statusColor} />
        <StatCard label="Latencia atual" value={latencyValue} color={latencyColor} />
        <StatCard label="Erros (1h)" value={`${errorRate}%`} color={errorColor} />
      </div>

      {/* Grafico de barras horizontal */}
      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 flex justify-between flex-wrap">
          <span>Ultimas {Math.min(history.length, 60)} medicoes (1h)</span>
          <span className="cbc-touch-only">ultima: {lastCheck ? (lastCheck.ok ? `${lastCheck.latency}ms` : 'erro') : '—'}</span>
          <span>media: {avgLatency ? `${avgLatency}ms` : '—'}</span>
        </div>
        <div className="flex items-end gap-px h-12">
          {last60.length === 0 && (
            <div className="flex-1 text-[10px] text-gray-400 text-center self-center">
              Aguardando primeira medicao...
            </div>
          )}
          {last60.map((entry, i) => {
            const h = entry.ok ? Math.min((entry.latency / 2000) * 100, 100) : 100;
            const color = !entry.ok
              ? 'bg-red-500'
              : entry.latency < 500
              ? 'bg-green-500'
              : entry.latency < 2000
              ? 'bg-amber-500'
              : 'bg-orange-600';
            const tip = `${new Date(entry.ts).toLocaleTimeString()} - ${entry.ok ? entry.latency + 'ms' : 'erro'}`;
            return (
              <div
                key={`${entry.ts}-${i}`}
                className={`flex-1 ${color} rounded-t`}
                style={{ height: `${Math.max(h, 4)}%` }}
                title={tip}
              />
            );
          })}
        </div>
      </div>

      {status === 'error' && (
        <div className="mt-3 bg-red-50 border border-red-200 p-3 rounded text-sm dark:bg-red-900/20 dark:border-red-800/50">
          <strong className="text-red-800 dark:text-red-300">Atencao</strong>
          <span className="text-red-700 dark:text-red-300">
            : Supabase nao esta respondendo. Reinicie o projeto em https://supabase.com/dashboard se persistir &gt;5 minutos.
          </span>
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value, color }) {
  const COLOR_BG = {
    green: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800/50',
    amber: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/50',
    red: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800/50',
    gray: 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700',
  };
  const COLOR_TEXT = {
    green: 'text-green-700 dark:text-green-300',
    amber: 'text-amber-700 dark:text-amber-300',
    red: 'text-red-700 dark:text-red-300',
    gray: 'text-gray-700 dark:text-gray-300',
  };
  return (
    <div className={`border rounded-lg p-3 ${COLOR_BG[color] || COLOR_BG.gray}`}>
      <div className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold ${COLOR_TEXT[color] || COLOR_TEXT.gray}`}>{value}</div>
    </div>
  );
}
