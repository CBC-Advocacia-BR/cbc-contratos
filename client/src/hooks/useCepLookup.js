import { useState, useRef, useCallback } from 'react';

// (#35) useCepLookup — ViaCEP com cache em memoria + sessionStorage.
// Retorna { endereco, bairro, cidade, uf, cep } ou null se nao encontrado.
// Fallback gracioso em offline (null, sem travar a UI).
const MEMORY_CACHE = new Map();
const SESSION_KEY_PREFIX = 'cbc-cep-cache:';

function loadFromSession(cleanCep) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_PREFIX + cleanCep);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToSession(cleanCep, data) {
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + cleanCep, JSON.stringify(data));
  } catch { /* quota exceeded — ignore */ }
}

export function useCepLookup() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const lookup = useCallback(async (cep) => {
    setError(null);
    const clean = String(cep || '').replace(/\D/g, '');
    if (clean.length !== 8) return null;

    // Offline fallback — nao bloqueia, nao chama API
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return null;
    }

    // 1) Cache em memoria
    if (MEMORY_CACHE.has(clean)) {
      return MEMORY_CACHE.get(clean);
    }
    // 2) sessionStorage (persiste entre navegacoes na mesma aba)
    const fromSession = loadFromSession(clean);
    if (fromSession) {
      MEMORY_CACHE.set(clean, fromSession);
      return fromSession;
    }

    // 3) Rede
    // Cancela request anterior se ainda pendente
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignora */ }
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${clean}/json/`, { signal: controller.signal });
      if (!resp.ok) throw new Error('Falha HTTP ViaCEP');
      const data = await resp.json();
      if (data?.erro) {
        setError('CEP nao encontrado');
        return null;
      }
      const normalized = {
        cep: clean,
        endereco: `${data.logradouro || ''}${data.complemento ? ', ' + data.complemento : ''}`.trim(),
        bairro: data.bairro || '',
        cidade: data.localidade || '',
        uf: data.uf || '',
      };
      MEMORY_CACHE.set(clean, normalized);
      saveToSession(clean, normalized);
      return normalized;
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      setError(e.message || 'Erro na consulta CEP');
      return null;
    } finally {
      setLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { lookup, loading, error };
}
