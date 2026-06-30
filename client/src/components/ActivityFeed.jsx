// (#93) Feed de atividade global — botao ao lado do sino no header
// Lista ultimas atividades (contratos criados/atualizados/assinados, automacoes, comentarios)
// Janela configuravel pelo usuario (24h, 7d, 30d) — persistida em localStorage

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  BoltIcon,
  DocumentTextIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChatBubbleLeftIcon,
  ArrowPathIcon,
  AdjustmentsHorizontalIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { BoltIcon as BoltSolid } from '@heroicons/react/24/solid';

const WINDOW_OPTIONS = [
  { value: '24h', label: '24h', hours: 24 },
  { value: '7d',  label: '7 dias',  hours: 24 * 7 },
  { value: '30d', label: '30 dias', hours: 24 * 30 },
];

const STORAGE_KEY = 'cbc_activity_window';

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function activityIcon(type) {
  switch (type) {
    case 'created':  return DocumentTextIcon;
    case 'sent':     return PaperAirplaneIcon;
    case 'signed':   return CheckCircleIcon;
    case 'cancelled':return XCircleIcon;
    case 'comment':  return ChatBubbleLeftIcon;
    case 'automation': return ArrowPathIcon;
    default: return BoltIcon;
  }
}

function activityColor(type) {
  switch (type) {
    case 'created':  return '#6B7280';
    case 'sent':     return '#2563EB';
    case 'signed':   return '#16A34A';
    case 'cancelled':return '#DC2626';
    case 'comment':  return '#7C3AED';
    case 'automation': return '#C9A84C';
    default: return '#6B7280';
  }
}

export default function ActivityFeed() {
  const [open, setOpen] = useState(false);
  const [window, setWindowOpt] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || '24h'; } catch { return '24h'; }
  });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // all | mine | signatures | errors
  const [me, setMe] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setMe(user.email);
    })();
  }, []);

  const opt = WINDOW_OPTIONS.find(o => o.value === window) || WINDOW_OPTIONS[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - opt.hours * 60 * 60 * 1000).toISOString();
      const events = [];

      // Contratos criados/atualizados
      const { data: contratos } = await supabase
        .from('contratos')
        .select('id, nome_contratante1, status, created_at, updated_at, created_by, updated_by, resort')
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(50);
      for (const c of (contratos || [])) {
        const isNew = c.created_at === c.updated_at;
        const type = isNew ? 'created'
          : c.status === 'assinado' ? 'signed'
          : c.status === 'enviado_zapsign' ? 'sent'
          : c.status === 'cancelado' ? 'cancelled'
          : 'created';
        events.push({
          id: `c:${c.id}:${c.updated_at}`,
          type,
          actor: c.updated_by || c.created_by || 'sistema',
          target: c.nome_contratante1,
          targetId: c.id,
          extra: c.resort,
          at: c.updated_at,
        });
      }

      // Automacoes (ADVBOX, Drive, etc)
      const { data: autos } = await supabase
        .from('automation_log')
        .select('id, contrato_id, automation, status, message, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(30);
      for (const a of (autos || [])) {
        events.push({
          id: `a:${a.id}`,
          type: a.status === 'error' ? 'cancelled' : 'automation',
          actor: 'sistema',
          target: `${a.automation}${a.message ? ' — ' + a.message.slice(0, 60) : ''}`,
          targetId: a.contrato_id,
          at: a.created_at,
        });
      }

      // Comentarios novos (#99)
      const { data: comments } = await supabase
        .from('contrato_comentarios')
        .select('id, contrato_id, user_email, body, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(30);
      for (const cm of (comments || [])) {
        events.push({
          id: `m:${cm.id}`,
          type: 'comment',
          actor: cm.user_email,
          target: cm.body.slice(0, 80),
          targetId: cm.contrato_id,
          at: cm.created_at,
        });
      }

      events.sort((a, b) => new Date(b.at) - new Date(a.at));
      setItems(events.slice(0, 80));
    } catch (err) {
      console.error('[ActivityFeed] load', err);
    } finally {
      setLoading(false);
    }
  }, [opt.hours]);

  useEffect(() => { if (open) load(); }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleWindow = (w) => {
    setWindowOpt(w);
    try { localStorage.setItem(STORAGE_KEY, w); } catch { /* ignora */ }
  };

  const filtered = items.filter(e => {
    if (filter === 'mine') return e.actor === me;
    if (filter === 'signatures') return e.type === 'signed';
    if (filter === 'errors') return e.type === 'cancelled';
    return true;
  });

  const handleItemClick = (e) => {
    if (e.targetId) {
      window.dispatchEvent(new CustomEvent('cbc:switchTab', { detail: { tab: 'contratos' } }));
      window.dispatchEvent(new CustomEvent('cbc:openContract', { detail: { id: e.targetId } }));
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
        title="Atividade recente"
        aria-label="Feed de atividade"
      >
        {open ? <BoltSolid className="w-5 h-5 text-amber-300" aria-hidden="true" /> : <BoltIcon className="w-5 h-5 text-white/85" aria-hidden="true" />}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-50 w-96 max-w-[94vw] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden max-sm:fixed max-sm:inset-x-2 max-sm:top-auto max-sm:bottom-[calc(var(--bottom-dock-height,64px)+var(--safe-bottom)+16px)] max-sm:w-auto max-sm:max-h-[55dvh]" style={{ animation: 'fadeIn .15s ease' }}>
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <BoltIcon className="w-4 h-4 text-navy" aria-hidden="true" />
              <span className="text-[11px] font-bold uppercase text-navy">Atividade</span>
            </div>
            <div className="inline-flex bg-white rounded-md border border-gray-200 p-0.5">
              {WINDOW_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => handleWindow(o.value)}
                  className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded transition-all ${
                    window === o.value ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1 overflow-x-auto">
            {[
              { id: 'all',         label: 'Tudo' },
              { id: 'mine',        label: 'Meus' },
              { id: 'signatures',  label: 'Assinaturas' },
              { id: 'errors',      label: 'Erros' },
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full transition-all ${
                  filter === f.id ? 'bg-navy text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="max-h-[420px] overflow-y-auto max-sm:max-h-[calc(55dvh-84px)]">
            {loading ? (
              <div className="px-4 py-8 text-center text-[11px] text-gray-400">Carregando...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] text-gray-400">
                Nenhuma atividade {filter !== 'all' ? `(${filter})` : ''} em {opt.label}
              </div>
            ) : (
              filtered.map(e => {
                const Icon = activityIcon(e.type);
                const color = activityColor(e.type);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => handleItemClick(e)}
                    className="w-full text-left px-3 py-2 border-b border-gray-100 last:border-0 hover:bg-blue-50 flex items-start gap-2 transition-colors"
                  >
                    <div className="shrink-0 mt-0.5">
                      <Icon className="w-3.5 h-3.5" style={{ color }} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-700 leading-snug">
                        <span className="font-semibold">{(e.actor || '').split('@')[0]}</span>
                        <span className="text-gray-500">{' '}—{' '}</span>
                        <span>{e.target}</span>
                      </div>
                      <div className="text-[9px] text-gray-400 mt-0.5">
                        {e.extra ? `${e.extra} · ` : ''}{relTime(e.at)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
