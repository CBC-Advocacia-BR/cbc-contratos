import { useState, useRef, useCallback, useEffect } from 'react';

// (#17) Undo system — gerencia fila (1 ultima) de acoes desfaziveis com timeout.
// Cada action: { type, label, undoFn, data, id? }
// Apos `timeout` ms, a acao expira e nao pode ser desfeita.
export function useUndo(timeout = 10000) {
  const [lastAction, setLastAction] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLastAction(null);
    setExpiresAt(null);
  }, []);

  const register = useCallback((action) => {
    if (!action || typeof action.undoFn !== 'function') return;
    // Limpa timer anterior
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const withId = { ...action, id: action.id || `undo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
    setLastAction(withId);
    setExpiresAt(Date.now() + timeout);
    timerRef.current = setTimeout(() => {
      setLastAction(null);
      setExpiresAt(null);
      timerRef.current = null;
    }, timeout);
  }, [timeout]);

  const undo = useCallback(async () => {
    const current = lastAction;
    if (!current?.undoFn) return false;
    // Limpa imediatamente para evitar double-undo
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLastAction(null);
    setExpiresAt(null);
    try {
      await current.undoFn();
      return true;
    } catch (err) {
      console.error('Undo falhou:', err);
      return false;
    }
  }, [lastAction]);

  // Cleanup no unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { lastAction, expiresAt, register, undo, clear };
}
