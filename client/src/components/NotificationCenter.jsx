// (#205) Centro de notificacoes — sino + drawer com lista
// Click em item: marca como lida + navega via link

import { useState, useEffect, useRef } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { useToast } from './Toast';
import {
  BellIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  BellAlertIcon,
  ChatBubbleLeftIcon,
  ClockIcon,
  Cog6ToothIcon,
  XMarkIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { BellIcon as BellSolid } from '@heroicons/react/24/solid';

const ICONS = {
  signature: CheckCircleIcon,
  mention:   ChatBubbleLeftIcon,
  reminder:  ClockIcon,
  error:     ExclamationCircleIcon,
  info:      InformationCircleIcon,
};

const COLORS = {
  signature: '#16A34A',
  mention:   '#2563EB',
  reminder:  '#C9A84C',
  error:     '#DC2626',
  info:      '#6B7280',
};

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
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default function NotificationCenter({ userEmail, onOpenPrefs }) {
  const { items, unread, loading, markRead, markAllRead, remove } = useNotifications(userEmail);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = async (n) => {
    if (!n.read_at) await markRead(n.id);
    if (n.link) {
      // Suporta tab=... e open=<contractId>
      const url = new URL(n.link, window.location.origin);
      const tab = url.searchParams.get('tab');
      const open = url.searchParams.get('open');
      if (tab) window.dispatchEvent(new CustomEvent('cbc:switchTab', { detail: { tab } }));
      if (open) window.dispatchEvent(new CustomEvent('cbc:openContract', { detail: { id: open } }));
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
        title="Notificacoes"
        aria-label={`Notificacoes${unread > 0 ? ` (${unread} nao lidas)` : ''}`}
      >
        {unread > 0 ? (
          <BellSolid className="w-5 h-5 text-amber-300" aria-hidden="true" />
        ) : (
          <BellIcon className="w-5 h-5 text-white/85" aria-hidden="true" />
        )}
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-navy">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-50 w-80 max-w-[92vw] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden max-sm:fixed max-sm:inset-x-2 max-sm:top-auto max-sm:bottom-[calc(var(--bottom-dock-height,64px)+var(--safe-bottom)+16px)] max-sm:w-auto max-sm:max-h-[55dvh]" style={{ animation: 'fadeIn .15s ease' }}>
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <div className="flex items-center gap-1.5">
              <BellAlertIcon className="w-4 h-4 text-navy" aria-hidden="true" />
              <span className="text-[11px] font-bold uppercase text-navy">Notificacoes</span>
              {unread > 0 && (
                <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                  {unread} nao lida{unread > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button type="button" onClick={markAllRead} className="text-[9px] font-bold uppercase text-navy hover:text-navy-light px-1.5 py-0.5">
                  Marcar tudo
                </button>
              )}
              {onOpenPrefs && (
                <button type="button" onClick={() => { onOpenPrefs(); setOpen(false); }} className="p-1 text-gray-400 hover:text-navy" title="Preferencias">
                  <Cog6ToothIcon className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto max-sm:max-h-[calc(55dvh-44px)]">
            {loading ? (
              <div className="px-4 py-8 text-center text-[11px] text-gray-400">Carregando...</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] text-gray-400">
                <BellIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" aria-hidden="true" />
                Sem notificacoes ainda
              </div>
            ) : (
              items.map(n => {
                const Icon = ICONS[n.type] || InformationCircleIcon;
                const color = COLORS[n.type] || '#6B7280';
                return (
                  <div
                    key={n.id}
                    className={`px-3 py-2 border-b border-gray-100 last:border-0 flex items-start gap-2 hover:bg-blue-50 cursor-pointer group ${!n.read_at ? 'bg-blue-50/60' : ''}`}
                    onClick={() => handleClick(n)}
                  >
                    <div className="shrink-0 mt-0.5">
                      <Icon className="w-4 h-4" style={{ color }} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-[12px] font-semibold text-gray-800 truncate ${!n.read_at ? 'font-bold' : ''}`}>
                          {n.title}
                        </span>
                        {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />}
                      </div>
                      {n.body && (
                        <div className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{n.body}</div>
                      )}
                      <div className="text-[9px] text-gray-400 mt-0.5">{relTime(n.created_at)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); remove(n.id); toast.info('Notificacao removida'); }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                      title="Remover"
                    >
                      <TrashIcon className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
