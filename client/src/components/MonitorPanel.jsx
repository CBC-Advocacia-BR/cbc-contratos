import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { supabase } from '../lib/supabase';
import { SkeletonMonitor } from './Skeleton';
// (#126) Edge Function helper com fallback para Function antiga
import { API } from '../utils/apiEndpoints';
// (#356) Dashboard de SLOs
const HealthSlos = lazy(() => import('./HealthSlos'));
// (resilience 28/04) Monitor de latencia/erro do Supabase com historico 1h
import SupabaseHealthMonitor from './SupabaseHealthMonitor';
// (bot advbox 10/06) Central de integracoes ADVBOX: status dos jobs, ping da API
// e console de erros persistente (advbox_api_log)
import MonitorAdvbox from './MonitorAdvbox';
// (varredura 15/06) banner de "automacao morta" no topo — resume health/crons/erros
import MonitorAlerts from './MonitorAlerts';
// (header unificado 20/06) tom->tokens --cbc-* (dark-aware) + ponto de status
import { toneStyle } from '../lib/statusTokens';
import StatusDot from './ui/StatusDot';
import {
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  ArrowPathIcon,
  ComputerDesktopIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ScaleIcon,
  FolderIcon,
  CreditCardIcon,
  Cog6ToothIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  QueueListIcon,
  XCircleIcon,
  PlusIcon,
  PencilIcon,
  ArchiveBoxIcon,
  ArchiveBoxXMarkIcon,
  TrashIcon,
  DocumentIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';

// (#126) HEALTH_URL removido — migrado para Edge Function via API.health() abaixo
const POLL_INTERVAL = 30000;

function fmt(ms) { return ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString('pt-BR') : '—'; }

// (#extract-base 20/06) tokens --cbc-* (dark-aware) em vez de hex fixos.
const STATUS_COLOR = {
  ok: { bg: 'var(--cbc-success-bg)', text: 'var(--cbc-success)', dot: 'var(--cbc-success)', label: 'Online' },
  error: { bg: 'var(--cbc-danger-bg)', text: 'var(--cbc-danger)', dot: 'var(--cbc-danger)', label: 'Erro' },
  slow: { bg: 'var(--cbc-warning-bg)', text: 'var(--cbc-warning)', dot: 'var(--cbc-warning)', label: 'Lento' },
};

// ─── Service Status Card ───
function ServiceCard({ service }) {
  const s = service.status === 'ok'
    ? (service.ms > 2000 ? STATUS_COLOR.slow : STATUS_COLOR.ok)
    : STATUS_COLOR.error;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{service.name}</span>
        <div className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full ${service.status === 'ok' && service.ms <= 2000 ? 'animate-pulse' : ''}`}
            style={{ background: s.dot }} />
          <span className="text-[10px] font-bold uppercase" style={{ color: s.text }}>{s.label}</span>
        </div>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-2xl font-bold" style={{ color: s.text }}>{fmt(service.ms)}</span>
        {service.error && <span className="text-[9px] text-red-500 max-w-[120px] truncate">{service.error}</span>}
      </div>
    </div>
  );
}

// ─── Automation Queue ───
function AutomationQueue({ contracts }) {
  const queues = useMemo(() => {
    const advbox = contracts.filter(c => c.status === 'assinado' && c.advbox_status !== 'ok' && c.advbox_status !== 'processing');
    // (#L17) "Fila Drive" = so quem NAO tem upload — 'uploading' ja conta em driveUploading
    // (antes era contado nas duas filas). 'failed' ganha bucket proprio p/ nao sumir.
    const drive = contracts.filter(c => c.status === 'assinado' && !c.drive_file_id);
    const signing = contracts.filter(c => c.status === 'enviado_zapsign');
    const advboxProcessing = contracts.filter(c => c.advbox_status === 'processing');
    const driveUploading = contracts.filter(c => c.drive_file_id === 'uploading');
    const driveFailed = contracts.filter(c => c.drive_file_id === 'failed');
    return { advbox, drive, signing, advboxProcessing, driveUploading, driveFailed };
  }, [contracts]);

  const items = [
    { label: 'Aguardando Assinatura', count: queues.signing.length, Icon: PencilSquareIcon, color: '#F59E0B', bg: '#FEF3C7' },
    { label: 'Fila ADVBOX', count: queues.advbox.length, Icon: ScaleIcon, color: '#2563EB', bg: '#EFF6FF' },
    { label: 'ADVBOX Processando', count: queues.advboxProcessing.length, Icon: ArrowPathIcon, color: '#7C3AED', bg: '#F5F3FF' },
    { label: 'Fila Google Drive', count: queues.drive.length, Icon: FolderIcon, color: '#059669', bg: '#ECFDF5' },
    { label: 'Drive Enviando', count: queues.driveUploading.length, Icon: PaperAirplaneIcon, color: '#0891B2', bg: '#ECFEFF' },
    { label: 'Drive Falhou', count: queues.driveFailed.length, Icon: FolderIcon, color: '#DC2626', bg: '#FEF2F2' },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><ClipboardDocumentListIcon className="w-4 h-4" aria-hidden="true" /> Filas de Automação</h3>
      <div className="space-y-2">
        {items.map(q => {
          const Icon = q.Icon;
          return (
            <div key={q.label} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: q.bg }}>
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" style={{ color: q.color }} aria-hidden="true" />
                <span className="text-[11px] font-semibold" style={{ color: q.color }}>{q.label}</span>
              </div>
              <span className="text-lg font-bold" style={{ color: q.color }}>{q.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Error Log ───
function ErrorLog({ contracts }) {
  const errors = useMemo(() => {
    const list = [];
    contracts.forEach(c => {
      if (c.advbox_status === 'error') {
        list.push({ type: 'ADVBOX', name: c.nome_contratante1, id: c.id, time: c.updated_at, detail: 'Erro ao criar cliente/processo' });
      }
      // (#L18) 'uploading' e upload EM ANDAMENTO, nao erro — antes TODO upload em progresso
      // aparecia como erro ativo. Travas orfas (>5min) sao liberadas pelo auto-recovery do
      // robo (viram retry/failed) e o LoopDetector ja sinaliza loops; aqui listamos so o
      // 'failed' (desistencia) abaixo.
      // (QW#14) upload que DESISTIU (failed) — antes nao aparecia aqui, so num
      // componente de retry separado; e o caso que gera "cade a pasta no Drive?".
      if (c.drive_file_id === 'failed') {
        list.push({ type: 'Drive', name: c.nome_contratante1, id: c.id, time: c.updated_at, detail: c.drive_failed_reason || 'Upload desistiu apos retries' });
      }
    });
    return list.sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [contracts]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}>
        <ExclamationTriangleIcon className="w-4 h-4 text-red-500" aria-hidden="true" /> Erros ativos
        {errors.length > 0 && <span className="ml-2 px-2 py-0.5 rounded-full text-[9px] bg-red-100 text-red-600">{errors.length}</span>}
      </h3>
      {errors.length === 0 ? (
        <div className="text-center py-4 text-[11px] text-gray-400 inline-flex items-center gap-1 justify-center w-full"><CheckCircleIcon className="w-4 h-4 text-green-500" aria-hidden="true" /> Nenhum erro ativo</div>
      ) : (
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {errors.map((e, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors" style={{ background: 'var(--cbc-danger-bg)', border: '1px solid var(--cbc-danger-border)' }} title={e.detail || ''}>
              <span className="text-[11px] font-bold shrink-0" style={{ color: 'var(--cbc-danger)' }}>{e.type}</span>
              <span className="text-[11px] font-medium truncate" style={{ color: 'var(--cbc-text-primary)' }}>{e.name}</span>
              {e.detail && <span className="text-[11px] truncate hidden sm:block" style={{ color: 'var(--cbc-text-secondary)' }}>{e.detail}</span>}
              <span className="text-[11px] ml-auto shrink-0 tabular-nums" style={{ color: 'var(--cbc-text-secondary)' }}>{fmtTime(e.time)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Loop Detector ───
function LoopDetector({ contracts }) {
  const loops = useMemo(() => {
    return contracts.filter(c => {
      // Detect: advbox_status stuck on 'processing' for > 5 min
      if (c.advbox_status === 'processing' && c.updated_at) {
        const diff = Date.now() - new Date(c.updated_at).getTime();
        if (diff > 5 * 60 * 1000) return true;
      }
      // Detect: drive_file_id stuck on 'uploading' for > 5 min
      if (c.drive_file_id === 'uploading' && c.updated_at) {
        const diff = Date.now() - new Date(c.updated_at).getTime();
        if (diff > 5 * 60 * 1000) return true;
      }
      return false;
    });
  }, [contracts]);

  if (loops.length === 0) return null;

  return (
    <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
      <h3 className="text-sm font-bold text-amber-700 mb-2 flex items-center gap-2"><ExclamationTriangleIcon className="w-4 h-4" aria-hidden="true" /> Possíveis Loops Detectados</h3>
      {loops.map(c => (
        <div key={c.id} className="text-[11px] text-amber-600 py-1">
          <strong>{c.nome_contratante1}</strong> — {c.advbox_status === 'processing' ? 'ADVBOX travado em "processing"' : 'Drive travado em "uploading"'} há mais de 5 min
        </div>
      ))}
    </div>
  );
}

// ─── Capacity Alerts ───
function CapacityAlerts({ health }) {
  // Netlify: 125k function invocations/month (free)
  // Supabase: 500MB database, 2GB bandwidth
  // Asaas: no hard limit
  const alerts = [];

  if (health?.services) {
    const slow = health.services.filter(s => s.ms > 3000);
    if (slow.length > 0) {
      alerts.push({ level: 'warning', msg: `${slow.map(s => s.name).join(', ')} respondendo lento (>3s)` });
    }
    const down = health.services.filter(s => s.status !== 'ok');
    if (down.length > 0) {
      alerts.push({ level: 'error', msg: `${down.map(s => s.name).join(', ')} FORA DO AR` });
    }
  }

  if (health?.totalMs > 10000) {
    alerts.push({ level: 'warning', msg: `Tempo total de resposta muito alto: ${fmt(health.totalMs)}` });
  }

  if (alerts.length === 0) {
    alerts.push({ level: 'ok', msg: 'Todos os serviços operando normalmente' });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><ChartBarIcon className="w-4 h-4" aria-hidden="true" /> Alertas de Capacidade</h3>
      <div className="space-y-1.5">
        {alerts.map((a, i) => (
          <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
            a.level === 'error' ? 'bg-red-50' : a.level === 'warning' ? 'bg-amber-50' : 'bg-green-50'
          }`}>
            <span className={`w-2.5 h-2.5 rounded-full ${a.level === 'error' ? 'bg-red-500' : a.level === 'warning' ? 'bg-amber-500' : 'bg-green-500'}`} aria-hidden="true" />
            <span className={`text-[11px] font-medium ${
              a.level === 'error' ? 'text-red-700' : a.level === 'warning' ? 'text-amber-700' : 'text-green-700'
            }`}>{a.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Activity Replay ───
function ActivityReplay({ contracts }) {
  const recent = useMemo(() => {
    const activities = [];
    contracts.forEach(c => {
      if (c.status === 'assinado' && c.updated_at) {
        activities.push({ type: 'assinado', name: c.nome_contratante1, time: c.updated_at, Icon: CheckCircleIcon });
      }
      if (c.advbox_status === 'ok' && c.advbox_date) {
        activities.push({ type: 'advbox', name: c.nome_contratante1, time: c.advbox_date, Icon: ScaleIcon });
      }
      // (#28) 'failed' nao e sucesso — antes upload falho aparecia como "Documentos salvos Drive".
      if (c.drive_file_id && c.drive_file_id !== 'uploading' && c.drive_file_id !== 'failed') {
        activities.push({ type: 'drive', name: c.nome_contratante1, time: c.updated_at, Icon: FolderIcon });
      }
      if (c.asaas_status === 'launched') {
        activities.push({ type: 'asaas', name: c.nome_contratante1, time: c.updated_at, Icon: CreditCardIcon });
      }
    });
    return activities.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 15);
  }, [contracts]);

  const typeLabels = { assinado: 'Contrato assinado', advbox: 'Processo criado ADVBOX', drive: 'Documentos salvos Drive', asaas: 'Cobrança lançada Asaas' };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><ArrowPathIcon className="w-4 h-4" aria-hidden="true" /> Atividade Recente</h3>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {recent.length === 0 ? (
          <div className="text-center py-4 text-[11px] text-gray-400">Nenhuma atividade recente</div>
        ) : recent.map((a, i) => {
          const ActIcon = a.Icon;
          return (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50">
              <ActIcon className="w-4 h-4 shrink-0 text-gray-500" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold text-gray-700 truncate">{a.name}</div>
                <div className="text-[9px] text-gray-400">{typeLabels[a.type]}</div>
              </div>
              <span className="text-[9px] text-gray-400 shrink-0">{fmtDateTime(a.time)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Log Capture ───
const LOG_BUFFER = [];
const MAX_LOGS = 50;
if (typeof window !== 'undefined' && !window.__logCaptured) {
  window.__logCaptured = true;
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args) => {
    LOG_BUFFER.unshift({ level: 'error', msg: args.map(a => typeof a === 'object' ? JSON.stringify(a).slice(0, 200) : String(a)).join(' '), time: new Date().toISOString() });
    if (LOG_BUFFER.length > MAX_LOGS) LOG_BUFFER.pop();
    origError.apply(console, args);
  };
  console.warn = (...args) => {
    LOG_BUFFER.unshift({ level: 'warn', msg: args.map(a => typeof a === 'object' ? JSON.stringify(a).slice(0, 200) : String(a)).join(' '), time: new Date().toISOString() });
    if (LOG_BUFFER.length > MAX_LOGS) LOG_BUFFER.pop();
    origWarn.apply(console, args);
  };
}

function LogPanel() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const interval = setInterval(() => setLogs([...LOG_BUFFER]), 2000);
    return () => clearInterval(interval);
  }, []);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><QueueListIcon className="w-4 h-4" aria-hidden="true" /> Console Logs</h3>
        <div className="flex gap-1">
          {['all', 'error', 'warn'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-[8px] font-bold uppercase rounded cursor-pointer ${filter === f ? 'text-white' : 'text-gray-400 bg-gray-100'}`}
              style={filter === f ? { background: f === 'error' ? '#DC2626' : f === 'warn' ? '#D97706' : '#1A2E52' } : {}}>{f}</button>
          ))}
        </div>
      </div>
      <div className="space-y-1 max-h-[200px] overflow-y-auto font-mono">
        {filtered.length === 0 ? (
          <div className="text-center py-3 text-[10px] text-gray-400">Nenhum log</div>
        ) : filtered.map((l, i) => (
          <div key={i} className={`flex items-start gap-2 px-2 py-1 rounded text-[9px] ${l.level === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
            <span className={`shrink-0 w-2 h-2 mt-1 rounded-full ${l.level === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden="true" />
            <span className="flex-1 break-all">{l.msg}</span>
            <span className="shrink-0 text-[8px] text-gray-400">{fmtTime(l.time)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Monitor Panel ───
// ─── Automation History ───
function AutomationHistory() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch_() {
      try {
        const { data } = await supabase.from('automation_log')
          .select('*').order('created_at', { ascending: false }).limit(50);
        setLogs(data || []);
      } catch { /* ignora */ }
      setLoading(false);
    }
    fetch_();
    const interval = setInterval(fetch_, 15000);
    return () => clearInterval(interval);
  }, []);

  const actionIconsMap = { advbox: ScaleIcon, drive: FolderIcon, asaas: CreditCardIcon, zapsign: PencilSquareIcon };
  const statusColors = { ok: 'text-green-600 bg-green-50', error: 'text-red-600 bg-red-50' };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><QueueListIcon className="w-4 h-4" aria-hidden="true" /> Histórico de Automações</h3>
      {loading ? (
        <div className="text-center py-4 text-[10px] text-gray-400">Carregando...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-4 text-[10px] text-gray-400">Nenhuma automação registrada ainda</div>
      ) : (
        <div className="space-y-1 max-h-[350px] overflow-y-auto">
          {logs.map(l => {
            const ActionIconCmp = actionIconsMap[l.action] || Cog6ToothIcon;
            return (
            <div key={l.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] ${statusColors[l.status] || 'bg-gray-50 text-gray-600'}`}>
              <ActionIconCmp className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="font-bold uppercase shrink-0 w-12">{l.action}</span>
              <span className="font-medium truncate flex-1">{l.client_name || '—'}</span>
              <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${l.status === 'ok' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                {l.status}
              </span>
              <span className="text-[8px] text-gray-400 shrink-0">{fmtDateTime(l.created_at)}</span>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AsaasErrorLog() {
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase.from('asaas_error_log').select('*').order('created_at', { ascending: false }).limit(20);
      if (mounted) { setErrors(data || []); setLoading(false); }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { mounted = false; clearInterval(t); };
  }, []);
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><ExclamationTriangleIcon className="w-4 h-4 text-amber-500" aria-hidden="true" /> Asaas · Erros de Sincronização</h3>
        <span className="text-[10px] text-gray-400">{errors.length}</span>
      </div>
      {loading ? (
        <div className="text-[11px] text-gray-400">Carregando...</div>
      ) : errors.length === 0 ? (
        <div className="text-[11px] text-gray-400 inline-flex items-center gap-1"><CheckCircleIcon className="w-3.5 h-3.5 text-green-500" aria-hidden="true" /> Nenhum erro recente</div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {errors.map(e => (
            <div key={e.id} className="bg-red-50 border border-red-100 rounded-lg p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-red-700">{e.source}</span>
                <span className="text-[9px] text-gray-400">{new Date(e.created_at).toLocaleString('pt-BR')}</span>
              </div>
              <div className="text-[10px] text-gray-700 mt-1 break-words">{e.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── (audit) Auditoria de Contratos ───
// Exibe ultimas 100 acoes registradas em contratos_audit (insert/update/archive/unarchive/delete).
// Filtros por acao + email do usuario. Auto-refresh 30s.
// Cada linha expande no clique para mostrar diff/before/after/IDs.

// Tailwind 4 nao processa classes dinamicas (ex: bg-${color}-50) — mapeamento explicito necessario.
const AUDIT_COLOR_CLASSES = {
  green: 'bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-700/30',
  blue: 'bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-700/30',
  amber: 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-700/30',
  sky: 'bg-sky-50 border-sky-200 dark:bg-sky-900/10 dark:border-sky-700/30',
  red: 'bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-700/30',
  gray: 'bg-gray-50 border-gray-200 dark:bg-gray-900/10 dark:border-gray-700/30',
};
const AUDIT_ICON_COLOR = {
  green: 'text-green-600',
  blue: 'text-blue-600',
  amber: 'text-amber-600',
  sky: 'text-sky-600',
  red: 'text-red-600',
  gray: 'text-gray-600',
};
const AUDIT_BADGE_COLOR = {
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-blue-800',
  amber: 'bg-amber-100 text-amber-800',
  sky: 'bg-sky-100 text-sky-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-gray-100 text-gray-800',
};
const AUDIT_ACTION_META = {
  insert: { color: 'green', icon: PlusIcon, label: 'Criado' },
  update: { color: 'blue', icon: PencilIcon, label: 'Atualizado' },
  archive: { color: 'amber', icon: ArchiveBoxIcon, label: 'Arquivado' },
  unarchive: { color: 'sky', icon: ArchiveBoxXMarkIcon, label: 'Desarquivado' },
  delete: { color: 'red', icon: TrashIcon, label: 'Deletado' },
};

// Linha individual do log com expansao on-click.
function AuditLogRow({ log, onOpenContract }) {
  const [open, setOpen] = useState(false);
  const action = log.action;
  const meta = AUDIT_ACTION_META[action] || { color: 'gray', icon: DocumentIcon, label: action };
  const Icon = meta.icon;
  const data = log.after_data || log.before_data || {};
  const nome = data.nome_contratante1 || data.nome_contratante2 || '(sem nome)';
  const ts = log.changed_at ? new Date(log.changed_at).toLocaleString('pt-BR') : '—';
  const colorRow = AUDIT_COLOR_CLASSES[meta.color] || AUDIT_COLOR_CLASSES.gray;
  const colorIcon = AUDIT_ICON_COLOR[meta.color] || AUDIT_ICON_COLOR.gray;
  const colorBadge = AUDIT_BADGE_COLOR[meta.color] || AUDIT_BADGE_COLOR.gray;

  // Diff de campos modificados — usado em action=update.
  const diffFields = (log.changed_fields || []).filter(f =>
    f !== 'updated_at' && f !== 'updated_by'
  );

  return (
    <div className={`rounded-lg border ${colorRow} transition-all`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-2 text-left cursor-pointer"
        aria-expanded={open}
        title="Clique para expandir detalhes"
      >
        <Icon className={`w-4 h-4 ${colorIcon} flex-shrink-0`} aria-hidden="true" />
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${colorBadge}`}>
          {meta.label}
        </span>
        <span className="text-sm flex-1 truncate" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{nome}</span>
        {diffFields.length > 0 && (
          <span className="text-xs text-gray-600 truncate hidden md:block">
            campos: {diffFields.slice(0, 3).join(', ')}{diffFields.length > 3 ? '...' : ''}
          </span>
        )}
        <span className="text-xs text-gray-500 truncate hidden lg:block">{log.user_email || 'system'}</span>
        <span className="text-xs text-gray-400 whitespace-nowrap">{ts}</span>
        {open
          ? <ChevronUpIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" aria-hidden="true" />
          : <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" aria-hidden="true" />}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-current/10 text-xs space-y-2">
          {/* IDs e metadata */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-gray-600">
            <div><span className="font-bold uppercase">Log ID:</span> <span className="font-mono">{log.id}</span></div>
            <div><span className="font-bold uppercase">Contrato ID:</span> <span className="font-mono break-all">{log.contrato_id || '—'}</span></div>
            <div><span className="font-bold uppercase">Usuario:</span> {log.user_email || 'system'}</div>
            <div><span className="font-bold uppercase">Quando:</span> {ts}</div>
          </div>

          {/* Diff visual para action=update */}
          {action === 'update' && diffFields.length > 0 && (
            <div className="bg-white/60 dark:bg-black/10 rounded-lg p-2 border border-gray-200">
              <div className="text-[10px] font-bold uppercase text-gray-500 mb-1.5">
                Diff ({diffFields.length} campo(s) alterado(s))
              </div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {diffFields.map(f => {
                  const before = log.before_data?.[f];
                  const after = log.after_data?.[f];
                  return (
                    <div key={f} className="text-[10px] border-l-2 border-blue-300 pl-2">
                      <div className="font-mono font-bold text-blue-700">{f}</div>
                      <div className="grid grid-cols-2 gap-2 mt-0.5">
                        <div className="bg-red-50 dark:bg-red-900/10 px-1.5 py-1 rounded font-mono break-all">
                          <span className="text-[8px] uppercase text-red-700 font-bold block">antes</span>
                          {before === null || before === undefined
                            ? <span className="italic text-gray-400">(vazio)</span>
                            : <span>{typeof before === 'object' ? JSON.stringify(before) : String(before)}</span>}
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/10 px-1.5 py-1 rounded font-mono break-all">
                          <span className="text-[8px] uppercase text-green-700 font-bold block">depois</span>
                          {after === null || after === undefined
                            ? <span className="italic text-gray-400">(vazio)</span>
                            : <span>{typeof after === 'object' ? JSON.stringify(after) : String(after)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Motivo de arquivamento */}
          {action === 'archive' && log.after_data?.arquivado_motivo && (
            <div className="bg-amber-50 dark:bg-amber-900/10 rounded-lg p-2 border border-amber-200">
              <div className="text-[10px] font-bold uppercase text-amber-700 mb-0.5">Motivo do arquivamento</div>
              <div className="text-xs text-amber-900 dark:text-amber-200 break-words">
                {log.after_data.arquivado_motivo}
              </div>
            </div>
          )}

          {/* Dump completo dos dados perdidos em delete */}
          {action === 'delete' && log.before_data && (
            <details className="bg-red-50 dark:bg-red-900/10 rounded-lg p-2 border border-red-200">
              <summary className="text-[10px] font-bold uppercase text-red-700 cursor-pointer">
                Dados perdidos (dump completo) — clique para expandir
              </summary>
              <pre className="mt-2 text-[9px] font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto bg-white/60 dark:bg-black/20 p-2 rounded">
                {JSON.stringify(log.before_data, null, 2)}
              </pre>
            </details>
          )}

          {/* Dump JSON cru (insert) */}
          {action === 'insert' && log.after_data && (
            <details className="bg-green-50 dark:bg-green-900/10 rounded-lg p-2 border border-green-200">
              <summary className="text-[10px] font-bold uppercase text-green-700 cursor-pointer">
                Dados criados (JSON) — clique para expandir
              </summary>
              <pre className="mt-2 text-[9px] font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto bg-white/60 dark:bg-black/20 p-2 rounded">
                {JSON.stringify(log.after_data, null, 2)}
              </pre>
            </details>
          )}

          {/* Botao "Ver contrato" — abre aba Contratos com filtro pelo nome (best-effort).
              Soft delete: contrato continua existindo. Hard delete: nao tem como abrir. */}
          {action !== 'delete' && log.contrato_id && (
            <div className="flex justify-end pt-1">
              <button
                onClick={(e) => { e.stopPropagation(); onOpenContract?.(log.contrato_id, nome); }}
                className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border border-gray-300 hover:bg-white cursor-pointer inline-flex items-center gap-1"
                style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}
                title="Abrir aba Contratos com este registro"
              >
                <DocumentIcon className="w-3 h-3" aria-hidden="true" />
                Ver contrato
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AuditoriaContratos() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [filterUser, setFilterUser] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('contratos_audit')
        .select('id, contrato_id, action, user_email, changed_fields, changed_at, before_data, after_data')
        .order('changed_at', { ascending: false })
        .limit(100);
      if (filterAction) q = q.eq('action', filterAction);
      if (filterUser) q = q.eq('user_email', filterUser);
      const { data } = await q;
      setLogs(data || []);
    } catch { /* silent — tabela pode nao existir ainda em dev */ }
    setLoading(false);
  }, [filterAction, filterUser]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => {
    const t = setInterval(fetchLogs, 30000);
    return () => clearInterval(t);
  }, [fetchLogs]);

  // "Ver contrato" — usa busca textual na aba Contratos via sessionStorage handoff.
  // Listener na ContratosTab pode pegar isso, ou simplesmente mudar de aba e exibir filtro.
  const handleOpenContract = useCallback((contratoId, nome) => {
    try {
      sessionStorage.setItem('cbc-contratos-search', nome.split(' ')[0] || '');
      window.dispatchEvent(new CustomEvent('cbc:open-tab', { detail: { tab: 'contratos' } }));
    } catch { /* silent */ }
  }, []);

  return (
    <section className="mb-6">
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
        <ClipboardDocumentListIcon className="w-5 h-5" aria-hidden="true" />
        Auditoria de Contratos
        <span className="text-xs text-gray-500 font-normal">({logs.length} ultimas 100 acoes)</span>
      </h3>

      <div className="flex gap-2 mb-3 flex-wrap">
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#1B3A5C] bg-white dark:bg-gray-800"
          style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}
        >
          <option value="">Todas as acoes</option>
          <option value="insert">Criados</option>
          <option value="update">Atualizados</option>
          <option value="archive">Arquivados</option>
          <option value="unarchive">Desarquivados</option>
          <option value="delete">Deletados (raro)</option>
        </select>
        <input
          type="email"
          placeholder="Filtrar por email do usuario..."
          value={filterUser}
          onChange={e => setFilterUser(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#1B3A5C] flex-1 min-w-[180px] bg-white dark:bg-gray-800"
          style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}
        />
        <button
          onClick={fetchLogs}
          className="px-2.5 py-1 text-xs font-bold uppercase rounded-lg cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200 inline-flex items-center gap-1"
          title="Atualizar agora"
        >
          <ArrowPathIcon className="w-3 h-3" aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {loading ? (
        <div className="bg-gray-100 rounded-xl h-32 animate-pulse" />
      ) : logs.length === 0 ? (
        <div className="text-sm text-gray-500 italic inline-flex items-center gap-1.5">
          <CheckCircleIcon className="w-4 h-4 text-gray-400" aria-hidden="true" />
          Nenhuma acao registrada ainda.
        </div>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {logs.map(log => (
            <AuditLogRow key={log.id} log={log} onOpenContract={handleOpenContract} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── (integ-data-15 / observ-7) Dead Letter ───
// Le a VIEW public.vw_automacoes_dead_letter: contratos assinados ha +2h cujas
// automacoes falharam de vez (ADVBOX 'error' ou Drive 'failed'). Destaque vermelho,
// mostra a coluna 'falhas' (rotulo do que falhou). Auto-refresh 30s.
// Tolerante a view inexistente/erro (secao some) e a tabela vazia (estado "tudo ok").
function DeadLetterSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erroView, setErroView] = useState(false);

  const fetchDead = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('vw_automacoes_dead_letter')
        .select('id, nome_contratante1, resort, advbox_status, drive_file_id, drive_failed_reason, falhas, signed_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) { setErroView(true); }
      else { setRows(data || []); setErroView(false); }
    } catch { setErroView(true); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDead();
    const interval = setInterval(fetchDead, 30000);
    return () => clearInterval(interval);
  }, [fetchDead]);

  // view ausente/erro: nao renderiza nada (nao quebra o painel)
  if (erroView) return null;

  return (
    <section className="mb-6">
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
        <ExclamationTriangleIcon className="w-5 h-5 text-red-600" aria-hidden="true" />
        Automações que falharam de vez
        {rows.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
            {rows.length}
          </span>
        )}
        <span className="text-xs text-gray-500 font-normal">(assinados há +2h · ADVBOX erro ou Drive falhou)</span>
      </h3>
      {loading ? (
        <div className="text-sm text-gray-400 italic">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500 italic inline-flex items-center gap-1.5">
          <CheckCircleIcon className="w-4 h-4 text-green-500" aria-hidden="true" />
          Nenhuma automação na fila de falhas definitivas.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(c => (
            <div
              key={c.id}
              className="rounded-lg p-3 flex items-start gap-3"
              style={{ background: 'var(--cbc-danger-bg)', border: '1px solid var(--cbc-danger-border)' }}
            >
              <XCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--cbc-danger)' }} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm break-words" style={{ color: 'var(--cbc-text-primary)' }}>{c.nome_contratante1 || '(sem nome)'}</span>
                  {(c.falhas || '').trim() && (
                    <span className="font-mono px-1.5 py-0.5 rounded text-[11px] font-bold uppercase" style={{ background: 'var(--cbc-danger-border)', color: 'var(--cbc-danger)' }}>
                      {(c.falhas || '').trim()}
                    </span>
                  )}
                </div>
                <div className="text-xs mt-1 break-words" style={{ color: 'var(--cbc-text-secondary)' }}>
                  {c.resort || '—'}
                  {c.advbox_status === 'error' && <span className="ml-2" style={{ color: 'var(--cbc-danger)' }}>ADVBOX: erro</span>}
                  {c.drive_file_id === 'failed' && (
                    <span className="ml-2" style={{ color: 'var(--cbc-danger)' }}>Drive: {c.drive_failed_reason || 'falhou'}</span>
                  )}
                </div>
                <div className="text-xs mt-1 tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>
                  assinado: {c.signed_at ? new Date(c.signed_at).toLocaleString('pt-BR') : '—'}
                  {' '}&middot; atualizado: {c.updated_at ? new Date(c.updated_at).toLocaleString('pt-BR') : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Drive Failed Section ───
// Lista contratos com upload Drive em estado 'failed' com botao de retry.
// Auto-refresh a cada 30s junto com o resto do painel.
function DriveFailedSection() {
  const [failed, setFailed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);

  const fetchFailed = useCallback(async () => {
    try {
      const { data } = await supabase.from('contratos')
        .select('id, nome_contratante1, drive_file_id, drive_error_code, drive_last_error, drive_failed_reason, drive_attempts, drive_last_attempt_at')
        .eq('drive_file_id', 'failed')
        .order('drive_last_attempt_at', { ascending: false })
        .limit(50);
      setFailed(data || []);
    } catch { /* ignora */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchFailed();
    const interval = setInterval(fetchFailed, 30000);
    return () => clearInterval(interval);
  }, [fetchFailed]);

  const resetAndRetry = useCallback(async (id) => {
    setRetryingId(id);
    try {
      const { resetDriveRetry } = await import('../utils/driveRetry');
      await resetDriveRetry(id);
      // Remove otimisticamente — polling vai confirmar (state muda de 'failed' → null → 'uploading' → ok|failed)
      setFailed(prev => prev.filter(c => c.id !== id));
    } catch {
      // Silencia — proximo refresh vai sincronizar
    } finally {
      setRetryingId(null);
    }
  }, []);

  return (
    <section className="mb-6">
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
        <XCircleIcon className="w-5 h-5 text-red-600" aria-hidden="true" />
        Drive falhou
        {failed.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
            {failed.length}
          </span>
        )}
      </h3>
      {loading ? (
        <div className="text-sm text-gray-400 italic">Carregando...</div>
      ) : failed.length === 0 ? (
        <div className="text-sm text-gray-500 italic inline-flex items-center gap-1.5">
          <CheckCircleIcon className="w-4 h-4 text-green-500" aria-hidden="true" />
          Nenhum contrato com upload falhando.
        </div>
      ) : (
        <div className="space-y-2">
          {failed.map(c => {
            const isRetrying = retryingId === c.id;
            return (
              <div
                key={c.id}
                className="bg-red-50 dark:bg-red-900/10 border border-red-200 rounded-lg p-3 flex items-start gap-3"
              >
                <XCircleIcon className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-800 break-words">{c.nome_contratante1 || '(sem nome)'}</div>
                  <div className="text-xs text-red-700 mt-1 break-words">
                    <span className="font-mono bg-red-100 px-1.5 py-0.5 rounded text-[10px]">
                      {c.drive_error_code || 'GENERIC'}
                    </span>
                    {' '}&middot;{' '}
                    {c.drive_failed_reason || (c.drive_last_error ? c.drive_last_error.substring(0, 120) : 'erro desconhecido')}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {c.drive_attempts || 0} tentativa(s) &middot; ultima: {c.drive_last_attempt_at ? new Date(c.drive_last_attempt_at).toLocaleString('pt-BR') : '—'}
                  </div>
                </div>
                <button
                  className="btn-outline text-xs px-3 py-1.5 font-bold uppercase rounded-lg cursor-pointer border-2 shrink-0 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: '#DC2626', color: '#DC2626' }}
                  onClick={() => resetAndRetry(c.id)}
                  disabled={isRetrying}
                  title="Resetar estado e re-tentar upload"
                >
                  {isRetrying ? (
                    <>
                      <span className="w-3 h-3 border-2 border-red-600/30 border-t-red-600 rounded-full animate-spin" />
                      Resetando...
                    </>
                  ) : (
                    <>
                      <ArrowPathIcon className="w-3 h-3" aria-hidden="true" />
                      Tentar novamente
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── (header unificado 20/06) Semaforo unico + "Precisa de acao" ───
// Funde os sinais ACIONAVEIS que o painel JA calcula (health.services +
// contratos) num unico farol. Read-only, sem fetch novo: deriva tudo de
// `health` e `contracts` que o MonitorPanel ja tem em escopo. O detalhe
// (log/cron/dead-letter) continua nas secoes abaixo — aqui e o resumo do topo.
const SEVERITY_TONE = { problema: 'danger', aviso: 'warning' };

// Computa a lista de itens acionaveis a partir do que o painel ja tem.
// Mesma logica de ServiceCard/AutomationQueue/ErrorLog/LoopDetector — so
// reagregada para o topo (nenhuma query nova).
function buildActionItems(health, contracts) {
  const items = [];
  // 1) Servicos do health check (inclui Kommo/ADVBOX/Asaas/ZapSign/Supabase)
  for (const s of (health?.services || [])) {
    if (s?.status && s.status !== 'ok') {
      items.push({ key: `svc:${s.name}`, sev: 'problema', group: 'Serviço fora do ar', label: s.name, detail: s.error || 'indisponível', target: 'farol' });
    } else if (s?.status === 'ok' && s.ms > 3000) {
      items.push({ key: `svcslow:${s.name}`, sev: 'aviso', group: 'Serviço lento', label: s.name, detail: `${fmt(s.ms)} (>3s)`, target: 'farol' });
    }
  }
  // 2) Contratos com automacao falha/travada (mesma deteccao das secoes)
  const now = Date.now();
  for (const c of (contracts || [])) {
    const nome = c.nome_contratante1 || '(sem nome)';
    if (c.status === 'assinado' && c.advbox_status === 'error') {
      items.push({ key: `advbox:${c.id}`, sev: 'problema', group: 'ADVBOX falhou', label: nome, detail: 'erro ao criar cliente/processo', target: 'dead-letter' });
    }
    if (c.status === 'assinado' && c.drive_file_id === 'failed') {
      items.push({ key: `drive:${c.id}`, sev: 'problema', group: 'Drive falhou', label: nome, detail: c.drive_failed_reason || 'upload desistiu após retries', target: 'drive-failed' });
    }
    // travado >5min em processing/uploading = possivel loop (mesma regra do LoopDetector)
    const travado = (c.advbox_status === 'processing' || c.drive_file_id === 'uploading')
      && c.updated_at && (now - new Date(c.updated_at).getTime()) > 5 * 60 * 1000;
    if (travado) {
      items.push({
        key: `loop:${c.id}`, sev: 'aviso', group: c.advbox_status === 'processing' ? 'ADVBOX travado' : 'Drive travado',
        label: nome, detail: 'há mais de 5 min', target: 'loops',
      });
    }
  }
  return items;
}

// Faixa-cartao do topo: circulo grande de semaforo + titulo + 3 contadores.
// Contador de severidade do header — definido em nivel de modulo (evita o erro
// "create components during render" do react-compiler).
function Contador({ n, rotulo, contTone }) {
  const ct = toneStyle(contTone);
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-xl min-w-[64px]"
      style={{ background: ct.bg, border: `1px solid ${ct.border}` }}>
      <span className="text-xl font-bold tabular-nums leading-none" style={{ color: ct.fg }}>{n}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide mt-1" style={{ color: ct.fg }}>{rotulo}</span>
    </div>
  );
}

function UnifiedStatusHeader({ items, totalServices, lastCheck }) {
  const nProblemas = items.filter(i => i.sev === 'problema').length;
  const nAvisos = items.filter(i => i.sev === 'aviso').length;
  // "ok" = quantos checks o painel cobre e estao verdes (servicos saudaveis).
  // Mantém o contador honesto sem inventar fetch novo.
  const nOk = Math.max(0, (totalServices || 0) - items.filter(i => i.target === 'farol').length);

  const nivel = nProblemas ? 'problema' : nAvisos ? 'aviso' : 'ok';
  const tone = nivel === 'ok' ? 'success' : SEVERITY_TONE[nivel];
  const t = toneStyle(tone);

  const titulo = nivel === 'ok'
    ? 'Tudo OK'
    : nProblemas
      ? `Atenção — ${nProblemas} ${nProblemas === 1 ? 'problema' : 'problemas'}${nAvisos ? `, ${nAvisos} aviso${nAvisos === 1 ? '' : 's'}` : ''}`
      : `Atenção — ${nAvisos} aviso${nAvisos === 1 ? '' : 's'}`;
  const subtitulo = nivel === 'ok'
    ? 'Nenhuma automação falha ou serviço fora do ar.'
    : 'Itens acionáveis listados abaixo · detalhe nas seções.';

  return (
    <div className="mb-4 rounded-2xl border p-4 flex items-center gap-4 flex-wrap"
      style={{ background: t.bg, borderColor: t.border }}>
      {/* Circulo grande de semaforo */}
      <span
        className={`w-12 h-12 rounded-full shrink-0 flex items-center justify-center ${nivel !== 'ok' ? 'animate-pulse' : ''}`}
        style={{ background: t.fg }}
        role="status"
        aria-label={titulo}
      >
        <span className="w-5 h-5 rounded-full" style={{ background: 'var(--cbc-bg-card)', opacity: 0.85 }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-bold leading-tight" style={{ color: t.fg }}>{titulo}</div>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--cbc-text-secondary)' }}>
          {subtitulo}
          {lastCheck && <span className="ml-1" style={{ color: 'var(--cbc-text-muted)' }}>· {fmtTime(lastCheck.toISOString())}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Contador n={nProblemas} rotulo="Problemas" contTone="danger" />
        <Contador n={nAvisos} rotulo="Avisos" contTone="warning" />
        <Contador n={nOk} rotulo="OK" contTone="success" />
      </div>
    </div>
  );
}

// Bloco "Precisa de acao": resume os itens acionaveis mais urgentes no topo,
// cada um apontando para a secao original (que continua intacta abaixo).
function PrecisaDeAcao({ items }) {
  if (!items.length) return null;
  const TARGET_LABEL = {
    'farol': 'farol ADVBOX',
    'dead-letter': 'Automações que falharam de vez',
    'drive-failed': 'Drive falhou',
    'loops': 'Possíveis loops',
  };
  // problemas primeiro; dentro do nivel, ordem estavel de chegada.
  const ordenados = [...items].sort((a, b) =>
    (a.sev === b.sev ? 0 : a.sev === 'problema' ? -1 : 1));
  const visiveis = ordenados.slice(0, 8);
  const resto = ordenados.length - visiveis.length;

  return (
    <section className="mb-6">
      <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}>
        <ExclamationTriangleIcon className="w-5 h-5" style={{ color: 'var(--cbc-warning)' }} aria-hidden="true" />
        Precisa de ação
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ color: 'var(--cbc-danger)', background: 'var(--cbc-danger-bg)' }}>
          {items.length}
        </span>
      </h3>
      <div className="space-y-2">
        {visiveis.map(it => {
          const tone = SEVERITY_TONE[it.sev];
          const ct = toneStyle(tone);
          return (
            <div key={it.key}
              className="rounded-lg p-3 flex items-start gap-3"
              style={{ background: ct.bg, border: `1px solid ${ct.border}` }}>
              <StatusDot tone={tone} size="md" className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ color: ct.fg, background: 'var(--cbc-bg-card)' }}>{it.group}</span>
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--cbc-text-primary)' }}>{it.label}</span>
                </div>
                <div className="text-[12px] mt-1" style={{ color: 'var(--cbc-text-secondary)' }}>{it.detail}</div>
              </div>
              <span className="text-[11px] font-semibold shrink-0 self-center whitespace-nowrap hidden sm:inline"
                style={{ color: 'var(--cbc-text-muted)' }}>
                ↓ {TARGET_LABEL[it.target] || 'abaixo'}
              </span>
            </div>
          );
        })}
      </div>
      {resto > 0 && (
        <p className="mt-2 text-[12px] font-semibold" style={{ color: 'var(--cbc-text-muted)' }}>
          + {resto} item(ns) — veja as seções detalhadas abaixo.
        </p>
      )}
    </section>
  );
}

export default function MonitorPanel() {
  const [health, setHealth] = useState(null);
  const [, setHealthLoading] = useState(true);
  const [contracts, setContracts] = useState([]);
  const [firstLoad, setFirstLoad] = useState(true); // (#96) skeleton inicial
  const [lastCheck, setLastCheck] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef(null);

  const checkHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      // (#126) Edge Function /api/health com fallback automatico
      const resp = await API.health();
      const data = await resp.json();
      setHealth(data);
      setLastCheck(new Date());
    } catch {
      setHealth({ status: 'error', services: [], totalMs: 0 });
    }
    setHealthLoading(false);
  }, []);

  const fetchContracts = useCallback(async () => {
    try {
      const { data } = await supabase.from('contratos')
        .select('id, nome_contratante1, status, advbox_status, drive_file_id, drive_failed_reason, asaas_status, updated_at, advbox_date, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      setContracts(data || []);
    } catch { /* ignora */ }
  }, []);

  useEffect(() => {
    Promise.all([checkHealth(), fetchContracts()]).finally(() => setFirstLoad(false));
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        checkHealth();
        fetchContracts();
      }, POLL_INTERVAL);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh]);

  const overallStatus = health?.status === 'healthy' ? 'ok' : 'error';

  // (header unificado 20/06) itens acionaveis derivados do que o painel ja tem
  // em escopo (health.services + contratos). Sem fetch novo: alimenta o farol
  // unico e o bloco "Precisa de acao". Memoizado p/ nao recalcular a cada render.
  const actionItems = useMemo(() => buildActionItems(health, contracts), [health, contracts]);

  // (#96) Skeleton durante o primeiro load
  if (firstLoad && !health && contracts.length === 0) {
    return <SkeletonMonitor />;
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-y-2">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}>
              <ComputerDesktopIcon className="w-5 h-5" aria-hidden="true" /> Monitor do Sistema
              <span className={`w-3 h-3 rounded-full ${overallStatus === 'ok' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            </h2>
            <p className="text-[11px] text-gray-400">
              {lastCheck ? `Última verificação: ${fmtTime(lastCheck.toISOString())}` : 'Verificando...'} · v{health?.version || '?'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
                className="w-3.5 h-3.5 accent-green-600 cursor-pointer" />
              <span className="text-[10px] font-bold text-gray-500">Auto (30s)</span>
            </label>
            <button onClick={() => { checkHealth(); fetchContracts(); }}
              className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200 inline-flex items-center gap-1.5">
              <ArrowPathIcon className="w-3.5 h-3.5" aria-hidden="true" /> Atualizar
            </button>
          </div>
        </div>

        {/* (header unificado 20/06) Semaforo unico — funde health.services +
            automacoes de contrato (ADVBOX/Drive/loops) num farol so, com
            contadores problemas/avisos/ok. Detalhe vive nas secoes abaixo. */}
        <UnifiedStatusHeader
          items={actionItems}
          totalServices={health?.services?.length || 0}
          lastCheck={lastCheck}
        />

        {/* Service Status Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {health?.services ? health.services.map(s => (
            <ServiceCard key={s.name} service={s} />
          )) : Array(5).fill(0).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* (header unificado 20/06) "Precisa de acao" — resume no TOPO os itens
            acionaveis (ADVBOX/Drive falho ou travado, serviço fora do ar),
            cada um apontando para a secao detalhada que continua intacta abaixo. */}
        <PrecisaDeAcao items={actionItems} />

        {/* (varredura 15/06) Banner de automacao morta — primeira coisa da aba:
            serviço fora do ar (health, inclui Kommo) + cron falhado + erros/avisos
            nao vistos do log, agregados em uma faixa de leitura rapida. */}
        <MonitorAlerts health={health} />

        {/* (bot advbox 10/06) Central ADVBOX — primeira secao: status das
            integracoes, teste ao vivo da API e console de erros */}
        <MonitorAdvbox />

        {/* (resilience 28/04) Monitor de saude Supabase — antes da auditoria.
            Mede latencia 1x/min, mostra grafico das ultimas 60 medicoes. */}
        <SupabaseHealthMonitor />

        {/* (audit) Auditoria de Contratos — antes de "Drive falhou".
            Lista insert/update/archive/unarchive/delete com diff visual. */}
        <AuditoriaContratos />

        {/* (integ-data-15 / observ-7) Dead letter — automacoes que falharam de vez
            (view vw_automacoes_dead_letter). Acima de "Drive falhou". */}
        <DeadLetterSection />

        {/* Drive Failed Section (topo — critico) */}
        <DriveFailedSection />

        {/* Loop Detector (only shows when issues found) */}
        <LoopDetector contracts={contracts} />

        {/* (#356) SLOs */}
        <div className="mb-4">
          <Suspense fallback={<div className="text-[11px] text-gray-400 py-3 text-center">Carregando SLOs...</div>}>
            <HealthSlos />
          </Suspense>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {/* Left: Queues + Errors */}
          <div className="space-y-4">
            <AutomationQueue contracts={contracts} />
            <ErrorLog contracts={contracts} />
            <AsaasErrorLog />
            <CapacityAlerts health={health} />
          </div>

          {/* Right: Activity + History + Logs */}
          <div className="space-y-4">
            <AutomationHistory />
            <ActivityReplay contracts={contracts} />
            <LogPanel />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-gray-100 bg-white text-center">
        <span className="text-[9px] text-gray-400 uppercase">
          {contracts.length} contratos monitorados · Health check: {health?.totalMs ? fmt(health.totalMs) : '...'} · {autoRefresh ? 'Auto-refresh ativo' : 'Auto-refresh pausado'}
        </span>
      </div>
    </div>
  );
}
