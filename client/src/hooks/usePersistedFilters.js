import { useState, useEffect, useRef } from 'react';

// Hook para persistir filtros em localStorage (chave: filters:<tab>)
// Retorna [state, setState] igual useState, mas carrega valor salvo no init.
export function usePersistedFilter(tabName, fieldName, defaultValue) {
  const key = `filters:${tabName}`;
  // Inicializar com valor do localStorage se existir
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;
      const obj = JSON.parse(raw);
      if (obj && Object.prototype.hasOwnProperty.call(obj, fieldName)) {
        return obj[fieldName];
      }
      return defaultValue;
    } catch {
      return defaultValue;
    }
  });

  // Salvar ao mudar (debounce simples)
  const saveRef = useRef(null);
  useEffect(() => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        const obj = raw ? JSON.parse(raw) : {};
        obj[fieldName] = value;
        localStorage.setItem(key, JSON.stringify(obj));
      } catch { /* ignore quota/JSON errors */ }
    }, 150);
    return () => { if (saveRef.current) clearTimeout(saveRef.current); };
  }, [key, fieldName, value]);

  return [value, setValue];
}

// Versao batch — salva o objeto inteiro de uma vez (util quando ha muitos filtros)
export function usePersistedFilterState(tabName, initialState) {
  const key = `filters:${tabName}`;
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initialState;
      const saved = JSON.parse(raw);
      return { ...initialState, ...saved };
    } catch {
      return initialState;
    }
  });

  const saveRef = useRef(null);
  useEffect(() => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* quota */ }
    }, 150);
    return () => { if (saveRef.current) clearTimeout(saveRef.current); };
  }, [key, state]);

  return [state, setState];
}
