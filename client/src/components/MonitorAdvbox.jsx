/**
 * MonitorAdvbox — Central de Integrações ADVBOX (aba Monitor)
 * Painel de operações em navy profundo (contraste deliberado com os cards
 * claros do restante da aba): status das 5 integrações, teste ao vivo da API
 * e console de erros persistente (tabela advbox_api_log, alimentada por
 * todos os workers).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  ScaleIcon, BoltIcon, SignalIcon, ChevronDownIcon, ChevronRightIcon,
  CheckCircleIcon, ExclamationTriangleIcon, EyeIcon, ArrowPathIcon,
  ClockIcon, HeartIcon, QueueListIcon,
} from '@heroicons/react/24/outline';

const BOT_KEY = import.meta.env.VITE_BOT_PANEL_KEY || 'cbc-bot-2026';

const fmtRel = (iso) => {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)}h`;
  return `há ${Math.round(min / 1440)}d`;
};
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

// status de um job pela idade da última execução vs cadência esperada
function jobStatus(lastRun, maxHoras, temErro) {
  if (!lastRun) return 'pendente';
  if (temErro) return 'aviso';
  const horas = (Date.now() - new Date(lastRun).getTime()) / 3600000;
  return horas > maxHoras ? 'atrasado' : 'ok';
}

const STATUS_UI = {
  ok:       { dot: '#34D399', label: 'OK',        text: 'text-emerald-300' },
  aviso:    { dot: '#FBBF24', label: 'COM AVISOS', text: 'text-amber-300' },
  atrasado: { dot: '#F87171', label: 'ATRASADO',   text: 'text-red-300' },
  pendente: { dot: '#CBD5E1', label: 'AGUARDANDO', text: 'text-slate-300' },
};

function JobCard({ title, lastRun, maxHoras, temErro, detail, sub }) {
  const st = STATUS_UI[jobStatus(lastRun, maxHoras, temErro)];
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 hover:bg-white/[0.07] transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/90">{title}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full" style={{ background: st.dot, boxShadow: `0 0 8px ${st.dot}` }} />
          <span className={`text-[11px] font-bold tracking-wider ${st.text}`}>{st.label}</span>
        </span>
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-white/75 leading-relaxed">{detail}</div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-white/70 font-mono">
        <span>{sub || ''}</span>
        <span title={fmtDT(lastRun)} className="tabular-nums">{fmtRel(lastRun)}</span>
      </div>
    </div>
  );
}

const NIVEL_UI = {
  erro:  { chip: 'bg-red-500/20 text-red-300 border-red-400/30', label: 'ERRO' },
  aviso: { chip: 'bg-amber-500/20 text-amber-300 border-amber-400/30', label: 'AVISO' },
  info:  { chip: 'bg-sky-500/20 text-sky-300 border-sky-400/30', label: 'INFO' },
};

// (observ-2) Saude dos robos (crons) — le public.cron_heartbeat.
// Vermelho se ok=false ou batida muito antiga (>90 min); verde se recente.
// Componente isolado: leitura/poll proprios, nao mexe nas secoes existentes.
// Tolerante a tabela vazia (ainda sem heartbeats gravados) e a erro de query.
const CRON_STALE_MIN = 90; // batida considerada velha apos 90 min
function CronHeartbeats() {
  const [rows, setRows] = useState([]);
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      try {
        const { data, error } = await supabase.from('cron_heartbeat')
          .select('job, last_run_at, ok, detail')
          .order('last_run_at', { ascending: false, nullsFirst: false })
          .limit(40);
        if (error) throw error;
        if (vivo) { setRows(data || []); setErro(false); }
      } catch { if (vivo) setErro(true); }
      if (vivo) setCarregou(true);
    };
    carregar();
    const t = setInterval(carregar, 60000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const estado = (r) => {
    if (r.ok === false) return 'falhou';
    if (!r.last_run_at) return 'pendente';
    const min = (Date.now() - new Date(r.last_run_at).getTime()) / 60000;
    return min > CRON_STALE_MIN ? 'atrasado' : 'ok';
  };
  const cor = { ok: '#34D399', atrasado: '#F87171', falhou: '#F87171', pendente: '#CBD5E1' };
  const algumRuim = rows.some(r => ['falhou', 'atrasado'].includes(estado(r)));
  const vazio = carregou && !erro && rows.length === 0;

  return (
    <div className="px-4 pb-3">
      <div className="rounded-xl bg-[#0A1626]/60 border border-white/10 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/80">
            <ClockIcon className="w-3.5 h-3.5 text-[#C9A84C]" /> Saúde dos robôs (tarefas agendadas)
          </span>
          {rows.length > 0 && (
            <span className={`text-[11px] font-bold tracking-wider ${algumRuim ? 'text-red-300' : 'text-emerald-300'}`}>
              {algumRuim ? 'ATENÇÃO' : 'EM DIA'}
            </span>
          )}
        </div>
        {!carregou ? (
          <div className="text-[11px] text-white/60 font-mono">carregando…</div>
        ) : erro ? (
          <div className="text-[11px] text-amber-200/90 font-mono flex items-center gap-1.5">
            <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" /> não foi possível carregar agora
          </div>
        ) : vazio ? (
          <div className="text-[11px] text-white/60 font-mono">nenhuma batida registrada ainda</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
            {rows.map(r => {
              const st = estado(r);
              return (
                <div key={r.job} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5"
                  title={r.detail || ''}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cor[st], boxShadow: `0 0 6px ${cor[st]}` }} />
                  <span className="text-[11px] font-mono text-white/80 truncate flex-1">{r.job}</span>
                  <span className="text-[11px] font-mono text-white/70 shrink-0 tabular-nums" title={fmtDT(r.last_run_at)}>{fmtRel(r.last_run_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// (observ-14) Mini-resumo de saude por servico — le public.health_history.
// Para cada service: ultima checagem (ok/lento) e % de OK nas ultimas 24h.
// Componente isolado e tolerante a tabela vazia / erro de query.
function HealthSummary() {
  const [rows, setRows] = useState([]);
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      try {
        const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data, error } = await supabase.from('health_history')
          .select('service, ok, latency_ms, checked_at')
          .gte('checked_at', desde)
          .order('checked_at', { ascending: false })
          .limit(2000);
        if (error) throw error;
        if (vivo) { setRows(data || []); setErro(false); }
      } catch { if (vivo) setErro(true); }
      if (vivo) setCarregou(true);
    };
    carregar();
    const t = setInterval(carregar, 60000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  // agrega por service: como rows vem em ordem desc, o 1º de cada service e a ultima checagem
  const servicos = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      let s = map.get(r.service);
      if (!s) { s = { service: r.service, ultima: r, total: 0, oks: 0 }; map.set(r.service, s); }
      s.total += 1;
      if (r.ok) s.oks += 1;
    }
    return [...map.values()].sort((a, b) => a.service.localeCompare(b.service));
  }, [rows]);

  const vazio = carregou && !erro && servicos.length === 0;

  return (
    <div className="px-4 pb-3">
      <div className="rounded-xl bg-[#0A1626]/60 border border-white/10 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/80">
            <HeartIcon className="w-3.5 h-3.5 text-[#C9A84C]" /> Saúde por serviço (24h)
          </span>
        </div>
        {!carregou ? (
          <div className="text-[11px] text-white/60 font-mono">carregando…</div>
        ) : erro ? (
          <div className="text-[11px] text-amber-200/90 font-mono flex items-center gap-1.5">
            <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" /> não foi possível carregar agora
          </div>
        ) : vazio ? (
          <div className="text-[11px] text-white/60 font-mono">nenhuma checagem nas últimas 24h</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
            {servicos.map(s => {
              const pct = s.total ? Math.round((s.oks / s.total) * 100) : 0;
              const okAgora = s.ultima?.ok;
              const lento = okAgora && (s.ultima?.latency_ms ?? 0) > 2000;
              const dot = !okAgora ? '#F87171' : lento ? '#FBBF24' : '#34D399';
              const pctText = pct >= 99 ? 'text-emerald-300' : pct >= 90 ? 'text-amber-300' : 'text-red-300';
              return (
                <div key={s.service} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5"
                  title={`${s.oks}/${s.total} OK · última ${fmtDT(s.ultima?.checked_at)}`}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot, boxShadow: `0 0 6px ${dot}` }} />
                  <span className="text-[11px] font-mono text-white/80 truncate flex-1">{s.service}</span>
                  <span className="text-[11px] font-mono text-white/70 shrink-0 tabular-nums">{s.ultima?.latency_ms != null ? `${s.ultima.latency_ms}ms` : '—'}</span>
                  <span className={`text-[11px] font-bold font-mono shrink-0 tabular-nums ${pctText}`}>{pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Fila de escritas no Kommo (kommo_queue) — todas as integracoes. Mostra pendentes/
// processando/falhas por integracao, item mais antigo e ultimas falhas.
const FONTE_LABEL = {
  'asaas-link': 'Link Asaas', 'bot': 'Bot WhatsApp', 'cobranca': 'Cobranca',
  'note': 'Notas', 'advbox-sync': 'Assinatura', 'monitor': 'Monitor', 'kommo': 'Outros',
};
function KommoQueuePanel() {
  const [d, setD] = useState(null);
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState(false);
  const [proc, setProc] = useState(false);
  const carregar = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('kommo_queue')
        .select('status, source, kind, attempts, run_after, created_at, last_error')
        .in('status', ['pending', 'processing', 'failed'])
        .order('created_at', { ascending: false }).limit(2000);
      if (error) throw error;
      setErro(false);
      const list = data || [];
      const porStatus = { pending: 0, processing: 0, failed: 0 };
      const porFonte = {};
      let oldest = null;
      for (const r of list) {
        porStatus[r.status] = (porStatus[r.status] || 0) + 1;
        const f = r.source || 'kommo';
        porFonte[f] = porFonte[f] || { pending: 0, processing: 0, failed: 0 };
        porFonte[f][r.status] = (porFonte[f][r.status] || 0) + 1;
        if (r.status === 'pending' && (!oldest || r.created_at < oldest)) oldest = r.created_at;
      }
      const falhas = list.filter(r => r.status === 'failed').slice(0, 8);
      const oldMin = oldest ? Math.round((Date.now() - new Date(oldest).getTime()) / 60000) : 0;
      const cor = porStatus.failed > 0 ? '#DC2626' : (porStatus.pending > 20 || oldMin > 10) ? '#D97706' : '#16A34A';
      setD({ porStatus, porFonte, oldest, falhas, cor });
    } catch { setD(null); setErro(true); } finally { setCarregou(true); }
  }, []);
  useEffect(() => {
    let vivo = true;
    carregar();
    const t = setInterval(() => { if (vivo) carregar(); }, 15000);
    return () => { vivo = false; clearInterval(t); };
  }, [carregar]);

  const processarAgora = async () => {
    setProc(true);
    try {
      await fetch('/.netlify/functions/kommo-queue-worker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: BOT_KEY }),
      });
      await new Promise(r => setTimeout(r, 1200));
      await carregar();
    } catch { /* ignora */ } finally { setProc(false); }
  };

  const { porStatus, porFonte, oldest, falhas, cor } = d || {};
  const fontes = porFonte ? Object.entries(porFonte).sort((a, b) => (b[1].pending + b[1].failed) - (a[1].pending + a[1].failed)) : [];

  return (
    <div className="px-4 pb-3">
      <div className="rounded-xl bg-[#0A1626]/60 border border-white/10 p-3">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/80">
            <QueueListIcon className="w-3.5 h-3.5 text-[#C9A84C]" /> Fila de integrações Kommo
            {d && <span className="w-2 h-2 rounded-full" style={{ background: cor, boxShadow: `0 0 8px ${cor}` }} />}
          </span>
          <button onClick={processarAgora} disabled={proc}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-white/[0.06] hover:bg-white/[0.12] text-white/85 border border-white/10 inline-flex items-center gap-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60">
            <ArrowPathIcon className={`w-3 h-3 ${proc ? 'animate-spin' : ''}`} /> Processar agora
          </button>
        </div>
        {!carregou ? (
          <div className="text-[11px] text-white/60 font-mono">carregando…</div>
        ) : erro ? (
          <div className="text-[11px] text-amber-200/90 font-mono flex items-center gap-1.5">
            <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" /> não foi possível carregar agora
          </div>
        ) : (<>
        {/* contadores gerais */}
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {[
            { l: 'Pendentes', v: porStatus.pending, c: '#D97706' },
            { l: 'Processando', v: porStatus.processing, c: '#2563EB' },
            { l: 'Falhas', v: porStatus.failed, c: '#DC2626' },
          ].map(s => (
            <div key={s.l} className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-center">
              <div className="text-base font-bold tabular-nums" style={{ color: s.v ? s.c : 'rgba(255,255,255,.7)' }}>{s.v}</div>
              <div className="text-[10px] font-bold uppercase text-white/65">{s.l}</div>
            </div>
          ))}
        </div>
        {oldest && porStatus.pending > 0 && (
          <div className="text-[11px] text-white/65 font-mono mb-2">item mais antigo na fila: {fmtRel(oldest)}</div>
        )}
        {/* por integracao */}
        {fontes.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
            {fontes.map(([f, c]) => (
              <div key={f} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-2.5 py-1.5">
                <span className="text-[11px] font-mono text-white/80 truncate flex-1">{FONTE_LABEL[f] || f}</span>
                <span className="flex items-center gap-1.5 text-[11px] font-mono shrink-0 tabular-nums">
                  {c.pending ? <span className="text-amber-300" title="pendentes">{c.pending}p</span> : null}
                  {c.processing ? <span className="text-blue-300" title="processando">{c.processing}…</span> : null}
                  {c.failed ? <span className="text-red-300" title="falhas">{c.failed}✕</span> : null}
                  {!c.pending && !c.processing && !c.failed ? <span className="text-emerald-300">ok</span> : null}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-emerald-300/90 font-mono flex items-center gap-1.5">
            <CheckCircleIcon className="w-3.5 h-3.5" /> fila vazia — tudo sincronizado
          </div>
        )}
        {/* ultimas falhas */}
        {falhas.length > 0 && (
          <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-1">
            {falhas.map((r, i) => (
              <div key={i} className="text-[11px] font-mono text-red-200/90 flex items-start gap-1.5">
                <ExclamationTriangleIcon className="w-3 h-3 mt-0.5 shrink-0 text-red-300/80" />
                <span className="truncate">[{FONTE_LABEL[r.source] || r.source}] {r.kind} · {r.attempts}x · {(r.last_error || '').slice(0, 80)}</span>
              </div>
            ))}
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}

export default function MonitorAdvbox() {
  const [cfg, setCfg] = useState({});
  const [logs, setLogs] = useState([]);
  const [filtroNivel, setFiltroNivel] = useState('todos');
  const [filtroOrigem, setFiltroOrigem] = useState('todas');
  const [aberto, setAberto] = useState(null);
  const [ping, setPing] = useState(null);
  const [pingando, setPingando] = useState(false);
  const [ultimoEvento, setUltimoEvento] = useState(null);

  const load = useCallback(async () => {
    const [{ data: cfgRows }, { data: logRows }, { data: ev }] = await Promise.all([
      supabase.from('bot_config').select('key, value')
        .in('key', ['monitor_status', 'snapshot_status', 'backfill_status', 'catalogo', 'kommo']),
      supabase.from('advbox_api_log').select('*').order('created_at', { ascending: false }).limit(80),
      supabase.from('bot_sync_state').select('created_at').order('created_at', { ascending: false }).limit(1),
    ]);
    const obj = {};
    for (const r of cfgRows || []) obj[r.key] = r.value || {};
    setCfg(obj); setLogs(logRows || []); setUltimoEvento(ev?.[0]?.created_at || null);
  }, []);

  // fetch inicial + refresh 60s (padrao do MonitorPanel)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const testarApi = async () => {
    setPingando(true); setPing(null);
    try {
      const r = await fetch('/.netlify/functions/advbox-bot-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-key': BOT_KEY },
        body: JSON.stringify({ action: 'advbox_health' }),
      });
      setPing(await r.json());
    } catch (e) { setPing({ online: false, erro: e.message }); }
    setPingando(false);
    load();
  };

  const marcarVisto = async (row) => {
    await supabase.from('advbox_api_log').update({ visto: true }).eq('id', row.id);
    setLogs(ls => ls.map(l => l.id === row.id ? { ...l, visto: true } : l));
  };
  const marcarTodosVistos = async () => {
    await supabase.from('advbox_api_log').update({ visto: true }).eq('visto', false);
    setLogs(ls => ls.map(l => ({ ...l, visto: true })));
  };

  const origens = useMemo(() => ['todas', ...new Set(logs.map(l => l.origem))], [logs]);
  const visiveis = logs.filter(l =>
    (filtroNivel === 'todos' || l.nivel === filtroNivel) &&
    (filtroOrigem === 'todas' || l.origem === filtroOrigem));
  const naoVistos = logs.filter(l => !l.visto && l.nivel === 'erro').length;

  const mon = cfg.monitor_status || {};
  const snap = cfg.snapshot_status || {};
  const back = cfg.backfill_status || {};
  const cat = cfg.catalogo || {};
  const kommoAtivo = !!cfg.kommo?.ativo;
  const monErros = (mon.erros || []).length > 0;
  const snapErros = (snap.erros || []).length > 0;

  // saude geral da secao (para o farol do header)
  const algumAtrasado = [jobStatus(mon.last_run, 26, monErros), jobStatus(snap.last_run, 26, snapErros)].includes('atrasado');
  const farol = naoVistos > 0 || algumAtrasado ? '#F87171' : (monErros || snapErros) ? '#FBBF24' : '#34D399';

  return (
    <section className="mb-6 rounded-2xl overflow-hidden border border-[#0F2035] shadow-lg"
      style={{ background: 'linear-gradient(160deg, #0F2035 0%, #1B3A5C 70%, #1e4066 100%)' }}>
      {/* header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
            <ScaleIcon className="w-5 h-5 text-[#C9A84C]" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
              ADVBOX · Central de Integrações
              <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: farol, boxShadow: `0 0 10px ${farol}` }} />
            </h3>
            <p className="text-[11px] text-white/65 font-mono">
              último evento registrado {fmtRel(ultimoEvento)} · sincronização 6h30/17h30 seg–sex
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ping && (
            <span className={`text-[11px] font-mono px-2 py-1 rounded border ${ping.online
              ? 'border-emerald-400/30 text-emerald-300 bg-emerald-500/10'
              : 'border-red-400/30 text-red-300 bg-red-500/10'}`}>
              {ping.online ? `● online · ${ping.ms}ms · ${ping.etapas} etapas/${ping.tarefas} tarefas` : `● falhou: ${(ping.erro || '').slice(0, 40)}`}
            </span>
          )}
          <button onClick={testarApi} disabled={pingando}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer
                       bg-[#C9A84C] text-[#0F2035] hover:bg-[#d9b85c] disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors">
            {pingando ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <SignalIcon className="w-3.5 h-3.5" />}
            Testar API agora
          </button>
        </div>
      </div>

      {/* grid de integracoes */}
      <div className="px-4 py-3 grid grid-cols-2 lg:grid-cols-5 gap-2">
        <JobCard title="Sincronização" lastRun={mon.last_run} maxHoras={26} temErro={monErros}
          detail={mon.last_run ? `${mon.movimentos_novos ?? 0} andamentos · ${(mon.tarefas_criadas ?? 0) + (mon.tarefas_concluidas ?? 0)} tarefas` : 'aguardando 1ª execução'}
          sub={`${mon.notas_postadas ?? 0} notas Kommo`} />
        <JobCard title="Cadastros (BI)" lastRun={snap.last_run} maxHoras={26} temErro={snapErros}
          detail={snap.last_run ? `${snap.processos ?? 0} processos · ${snap.clientes ?? 0} clientes` : 'aguardando 1ª execução'}
          sub={`${snap.mudancas ?? 0} mudanças de fase · ${snap.duracao_s ?? 0}s`} />
        <JobCard title="Carga histórica" lastRun={back.finished_at || back.updated_at} maxHoras={999999}
          temErro={(back.erros || []).length > 0}
          detail={back.fase === 'concluido' ? `concluído · ${Number(back.movimentos_gravados || 0).toLocaleString('pt-BR')} andamentos` : `fase ${back.fase || '—'} (${back.ativo ? 'rodando' : 'parado'})`}
          sub={`${Number(back.tarefas_gravadas || 0).toLocaleString('pt-BR')} tarefas`} />
        <JobCard title="Catálogo etapas" lastRun={cat.synced_at} maxHoras={26} temErro={false}
          detail={cat.stages ? `${cat.stages.length} etapas · ${(cat.tasks || []).length} tipos de tarefa` : 'aguardando 1ª sincronização'}
          sub={(cat.novidades?.etapas_novas?.length || cat.novidades?.tarefas_novas?.length) ? '🆕 novidades detectadas' : 'sem mudanças'} />
        <JobCard title="Bot WhatsApp" lastRun={kommoAtivo ? new Date().toISOString() : null} maxHoras={999999} temErro={false}
          detail={kommoAtivo ? 'ativo — respondendo testadores' : 'desativado (Config do bot)'}
          sub={kommoAtivo ? 'webhook Kommo conectado' : 'simulador segue disponível'} />
      </div>

      {/* (observ-2) saude dos robos (crons) — apenas acrescenta, some se sem dados */}
      <CronHeartbeats />

      {/* (observ-14) mini-resumo de saude por servico (health_history) */}
      <HealthSummary />

      {/* fila de escritas Kommo (todas as integracoes) */}
      <KommoQueuePanel />

      {/* console de erros */}
      <div className="mx-4 mb-4 rounded-xl bg-[#0A1626]/80 border border-white/10">
        <div className="px-3 py-2 flex items-center justify-between flex-wrap gap-2 border-b border-white/[0.06]">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/80">
            <BoltIcon className="w-3.5 h-3.5 text-[#C9A84C]" /> Console de eventos
            {naoVistos > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-red-500/30 text-red-100 border border-red-400/40 animate-pulse">
                {naoVistos} erro(s) não lido(s)
              </span>
            )}
          </span>
          <div className="flex items-center gap-1.5 text-[11px]">
            {['todos', 'erro', 'aviso', 'info'].map(n => (
              <button key={n} onClick={() => setFiltroNivel(n)}
                className={`px-2 py-0.5 rounded font-mono uppercase cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60 ${filtroNivel === n ? 'bg-[#C9A84C] text-[#0F2035] font-bold' : 'text-white/65 hover:text-white'}`}>
                {n}
              </button>
            ))}
            <label className="sr-only" htmlFor="advbox-filtro-fonte">Filtrar por fonte</label>
            <select id="advbox-filtro-fonte" value={filtroOrigem} onChange={e => setFiltroOrigem(e.target.value)}
              title="Fonte do evento"
              className="bg-white/10 text-white/85 text-[11px] rounded px-1.5 py-0.5 border border-white/10 font-mono cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60">
              {origens.map(o => <option key={o} value={o} className="text-gray-900">{o === 'todas' ? 'todas as fontes' : o}</option>)}
            </select>
            {naoVistos > 0 && (
              <button onClick={marcarTodosVistos} className="text-white/65 hover:text-white underline decoration-dotted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60 rounded">
                marcar todos como lidos
              </button>
            )}
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.05]">
          {visiveis.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-white/60 font-mono flex items-center justify-center gap-2">
              <CheckCircleIcon className="w-4 h-4 text-emerald-400/80" /> nenhum evento {filtroNivel !== 'todos' ? `de nível "${filtroNivel}"` : ''} registrado
            </div>
          )}
          {visiveis.map(l => {
            const ui = NIVEL_UI[l.nivel] || NIVEL_UI.info;
            const exp = aberto === l.id;
            return (
              <div key={l.id} className={`px-3 py-2 ${!l.visto && l.nivel === 'erro' ? 'bg-red-500/[0.06]' : ''}`}>
                <button className="w-full flex items-start gap-2 text-left cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60 rounded" onClick={() => setAberto(exp ? null : l.id)}>
                  {exp ? <ChevronDownIcon className="w-3 h-3 mt-1 text-white/60 shrink-0" /> : <ChevronRightIcon className="w-3 h-3 mt-1 text-white/60 shrink-0" />}
                  <span className={`shrink-0 mt-0.5 px-1.5 rounded text-[11px] font-bold border ${ui.chip}`}>{ui.label}</span>
                  <span className="shrink-0 mt-0.5 text-[11px] font-mono text-white/65 uppercase w-16 truncate max-sm:hidden" title={`Fonte: ${l.origem}`}>{l.origem}</span>
                  <span className="flex-1 text-[11px] font-mono text-white/85 group-hover:text-white leading-snug max-sm:min-w-0 max-sm:truncate">{l.mensagem}</span>
                  <span className="shrink-0 text-[11px] font-mono text-white/65 mt-0.5 tabular-nums" title={fmtDT(l.created_at)}>{fmtRel(l.created_at)}</span>
                </button>
                {exp && (
                  <div className="ml-5 mt-2 mb-1">
                    <pre className="text-[11px] font-mono text-emerald-200/90 bg-black/30 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap border border-white/[0.06]">
{JSON.stringify(l.contexto || {}, null, 2)}
                    </pre>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[11px] font-mono text-white/60">{fmtDT(l.created_at)} · id {l.id}</span>
                      {!l.visto && (
                        <button onClick={() => marcarVisto(l)}
                          className="text-[11px] text-emerald-300/90 hover:text-emerald-200 underline decoration-dotted cursor-pointer inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60 rounded">
                          <EyeIcon className="w-3 h-3" /> marcar como lido
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* rodape de orientacao */}
      {naoVistos > 0 && (
        <div className="px-4 pb-3 -mt-1 flex items-center gap-2 text-[11px] text-amber-200/90">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" />
          Há erros não tratados. Clique no evento para ver o contexto completo — e se precisar de ajuda, copie a mensagem e reporte ao Claude no Codex.
        </div>
      )}
    </section>
  );
}
