import { useEffect, useRef, useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

// (#16) Confirmacao com digitacao obrigatoria para acoes destrutivas irreversiveis.
// Usuario precisa digitar exatamente `confirmText` para habilitar o botao.
// ESC cancela, Enter confirma (se match).
export default function ConfirmDestructive({
  isOpen,
  title = 'Confirmar acao destrutiva',
  message,
  confirmText = 'DELETAR',
  confirmLabel,
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
  danger = true,
}) {
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const match = typed.trim().toUpperCase() === String(confirmText).trim().toUpperCase();

  // Reset state + autofocus on open
  useEffect(() => {
    if (isOpen) {
      setTyped('');
      setLoading(false);
      // Foco automatico (delay pra animacao do modal)
      const t = setTimeout(() => { inputRef.current?.focus(); }, 80);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // ESC cancela
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!loading) onCancel?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, loading, onCancel]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!match || loading) return;
    setLoading(true);
    try {
      await onConfirm?.();
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && match && !loading) {
      e.preventDefault();
      handleConfirm();
    }
  };

  return (
    /* (mobile 06/2026) max-sm: ancora no topo — o teclado iOS cobria o input
       e os botões quando o modal era centrado verticalmente no iPhone */
    <div
      className="modal-backdrop-glass fixed inset-0 z-[100] flex items-center justify-center p-4 max-sm:items-start max-sm:pt-10 overflow-y-auto"
      onClick={() => !loading && onCancel?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cbc-confirm-destructive-title"
    >
      <div
        className="modal-glass rounded-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: danger ? '#FEE2E2' : '#FEF3C7' }}
          >
            <ExclamationTriangleIcon
              className="w-6 h-6"
              style={{ color: danger ? '#DC2626' : '#D97706' }}
              aria-hidden="true"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              id="cbc-confirm-destructive-title"
              className="font-bold text-sm mb-1"
              style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}
            >
              {title}
            </h3>
            {message && (
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}>
                {message}
              </p>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}>
            Para confirmar, digite <span className="font-mono px-1.5 py-0.5 rounded" style={{ background: '#FEE2E2', color: '#B91C1C' }}>{confirmText}</span>
          </label>
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder={confirmText}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-full border-2 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none transition-colors disabled:opacity-50"
            style={{
              borderColor: match ? '#16A34A' : '#E5E7EB',
              background: 'var(--cbc-surface, white)',
              color: 'var(--cbc-text-primary, #1A2E52)',
            }}
            aria-label={`Digite ${confirmText} para confirmar`}
          />
          {typed && !match && (
            <p className="text-[11px] mt-1.5" style={{ color: '#DC2626' }}>
              Texto diferente. Digite exatamente: <strong>{confirmText}</strong>
            </p>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => !loading && onCancel?.()}
            disabled={loading}
            className="px-4 py-2 rounded-lg border text-sm font-bold cursor-pointer disabled:opacity-50 transition-colors"
            style={{
              borderColor: 'var(--cbc-border, #D1D5DB)',
              color: 'var(--cbc-text-secondary, #4B5563)',
              background: 'var(--cbc-surface, white)',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!match || loading}
            className="px-4 py-2 rounded-lg text-white text-sm font-bold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: danger ? '#DC2626' : '#D97706',
              boxShadow: match && !loading ? '0 4px 12px rgba(220, 38, 38, 0.3)' : 'none',
            }}
            title={match ? 'Confirmar (Enter)' : `Digite ${confirmText} para habilitar`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Processando...
              </span>
            ) : (
              confirmLabel || confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
