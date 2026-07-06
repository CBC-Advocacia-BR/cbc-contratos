import { useEffect, useState } from 'react';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';

// (#17) Toast persistente bottom-right com botao Desfazer + contador de segundos.
// Props:
//   lastAction: { label, ... } | null
//   expiresAt: timestamp (ms) | null
//   onUndo: () => void
//   onDismiss: () => void
export default function UndoToast({ lastAction, expiresAt, onUndo, onDismiss }) {
  // (auditoria #60) `now` inicia lazy com o relogio atual (nunca 0/stale), evitando
  // o setState SINCRONO dentro do effect (que a regra react-hooks/set-state-in-effect
  // sinaliza como re-render em cascata). O intervalo mantem o contador fresco.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastAction) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [lastAction]);

  if (!lastAction) return null;

  const secondsLeft = Math.max(0, Math.ceil(((expiresAt || 0) - now) / 1000));
  if (secondsLeft <= 0) return null;

  return (
    /* (mobile 06/2026) posição via .cbc-undo-toast: desktop idêntico
       (bottom-right); no phone/tablet-portrait vira full-width ACIMA do dock
       (antes cobria o item Dashboard do dock e estourava em 375px) */
    <div
      className="cbc-undo-toast animate-undo-slide-in"
      role="status"
      aria-live="polite"
    >
      <div
        className="flex items-center gap-3 rounded-xl shadow-2xl px-4 py-3 text-white"
        style={{
          background: 'linear-gradient(135deg, #1F2937, #111827)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span className="text-sm font-semibold flex-1 min-w-0 truncate">{lastAction.label}</span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1 text-sm font-bold underline decoration-2 underline-offset-4 hover:text-amber-300 cursor-pointer shrink-0"
          title="Desfazer (Cmd+Z)"
          aria-label="Desfazer"
        >
          <ArrowUturnLeftIcon className="w-4 h-4" aria-hidden="true" />
          Desfazer
        </button>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded-md shrink-0 tabular-nums"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}
          aria-hidden="true"
        >
          {secondsLeft}s
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-white/50 hover:text-white cursor-pointer text-base leading-none shrink-0"
            title="Fechar"
            aria-label="Fechar toast"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}
