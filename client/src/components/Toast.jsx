// Sistema universal de toasts — provider + hook + render
// Uso:
//   import { useToast } from './Toast';
//   const toast = useToast();
//   toast.success('Contrato salvo');
//   toast.error('Falha ao enviar', { action: { label: 'Tentar', onClick: () => ... } });
//
// Posicao top-right, stack max 4, auto-dismiss 3s padrao
// Respeita prefers-reduced-motion

import { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircleIcon,
  error: ExclamationCircleIcon,
  warning: ExclamationTriangleIcon,
  info: InformationCircleIcon,
};

const TYPE_STYLES = {
  success: { bg: 'bg-green-50', border: 'border-green-200', icon: 'text-green-600', text: 'text-green-900' },
  error:   { bg: 'bg-red-50',   border: 'border-red-200',   icon: 'text-red-600',   text: 'text-red-900' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', text: 'text-amber-900' },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-200',  icon: 'text-blue-600',  text: 'text-blue-900' },
};

const MAX_STACK = 4;
const DEFAULT_DURATION = 3000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idCounter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 220);
  }, []);

  const push = useCallback((message, opts = {}) => {
    const id = ++idCounter.current;
    const type = opts.type || 'info';
    const duration = opts.duration != null ? opts.duration : DEFAULT_DURATION;
    const action = opts.action || null;
    setToasts(prev => {
      const next = [...prev, { id, message, type, action, leaving: false }];
      // Limita stack: descarta os mais antigos
      if (next.length > MAX_STACK) next.splice(0, next.length - MAX_STACK);
      return next;
    });
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  const api = {
    push,
    dismiss,
    info: (msg, opts) => push(msg, { ...opts, type: 'info' }),
    success: (msg, opts) => push(msg, { ...opts, type: 'success' }),
    warning: (msg, opts) => push(msg, { ...opts, type: 'warning' }),
    error: (msg, opts) => push(msg, { ...opts, type: 'error' }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastRenderer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastRenderer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    /* (mobile 06/2026) posição saiu do inline-style para .cbc-toast-stack:
       desktop mantém top:76px/right:20px; no phone vira full-width sob o
       header com safe-area (antes estourava a viewport de 375px) */
    <div
      aria-live="polite"
      aria-atomic="false"
      className="cbc-toast-stack"
    >
      {toasts.map(t => {
        const Icon = ICONS[t.type] || InformationCircleIcon;
        const s = TYPE_STYLES[t.type] || TYPE_STYLES.info;
        return (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`${s.bg} ${s.border} ${s.text} border rounded-xl shadow-lg flex items-start gap-2.5 px-3.5 py-2.5 ${t.leaving ? 'cbc-toast-leave' : 'cbc-toast-enter'}`}
            style={{
              pointerEvents: 'auto',
              backdropFilter: 'blur(6px)',
              backgroundColor: undefined, // mantem do tailwind class
            }}
          >
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${s.icon}`} aria-hidden="true" />
            <div className="flex-1 text-[13px] font-medium leading-snug">
              {t.message}
              {t.action && (
                <button
                  type="button"
                  onClick={() => { t.action.onClick(); onDismiss(t.id); }}
                  className={`block mt-1 text-[12px] font-bold uppercase tracking-wide underline underline-offset-2 ${s.icon} hover:opacity-80`}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className={`shrink-0 -mr-1 -mt-1 p-1 rounded-md hover:bg-black/5 ${s.icon}`}
              aria-label="Fechar"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback silencioso para nao quebrar componentes fora do provider em testes/storybook
    return {
      push: () => 0, dismiss: () => {},
      info: () => 0, success: () => 0, warning: () => 0, error: () => 0,
    };
  }
  return ctx;
}
