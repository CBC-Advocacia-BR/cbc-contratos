import { useLayoutEffect, useRef, useCallback } from 'react';

// Hook de restauracao de scroll — salva a posicao no sessionStorage e restaura ao montar.
// Uso: const { onScroll, scrollRef } = useScrollRestoration('nome-da-aba');
// Aplicar onScroll no container principal e ref para fallback.
export function useScrollRestoration(tabName) {
  const key = `scroll:${tabName}`;
  const scrollRef = useRef(null);
  const throttleRef = useRef(null);

  // Handler de scroll com throttle de 200ms
  const onScroll = useCallback((e) => {
    const target = e?.currentTarget || e?.target || scrollRef.current;
    if (!target) return;
    if (throttleRef.current) return;
    throttleRef.current = setTimeout(() => {
      try {
        sessionStorage.setItem(key, String(target.scrollTop || 0));
      } catch { /* ignore quota errors */ }
      throttleRef.current = null;
    }, 200);
  }, [key]);

  // Restaurar posicao ao montar (use useLayoutEffect para evitar flicker)
  useLayoutEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved && scrollRef.current) {
        const pos = Number(saved);
        if (pos > 0) {
          // Restaurar em dois frames para garantir que DOM esta pronto
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (scrollRef.current) scrollRef.current.scrollTop = pos;
            });
          });
        }
      }
    } catch { /* ignore sessionStorage errors */ }
    return () => {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
    };
  }, [key]);

  return { onScroll, scrollRef };
}
