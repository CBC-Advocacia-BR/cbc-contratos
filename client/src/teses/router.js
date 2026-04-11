// Roteador mínimo baseado em location.hash — sem dependências externas.
// O path efetivo é tudo após "#/". Ex: #/models/123 → "/models/123".

import { useEffect, useState, useCallback } from 'react';

function readHash() {
  const h = window.location.hash.replace(/^#/, '');
  if (!h || h === '/') return '/dashboard';
  return h.startsWith('/') ? h : '/' + h;
}

export function useRoute() {
  const [path, setPath] = useState(readHash);
  useEffect(() => {
    const onHash = () => setPath(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((to) => {
    if (!to.startsWith('/')) to = '/' + to;
    window.location.hash = to;
  }, []);

  return { path, navigate };
}

/** Casa /models/:id → { match: true, params: { id } } (muito simplificado). */
export function matchRoute(path, pattern) {
  const pSeg = pattern.split('/').filter(Boolean);
  const aSeg = path.split('/').filter(Boolean);
  if (pSeg.length !== aSeg.length) return null;
  const params = {};
  for (let i = 0; i < pSeg.length; i++) {
    if (pSeg[i].startsWith(':')) params[pSeg[i].slice(1)] = decodeURIComponent(aSeg[i]);
    else if (pSeg[i] !== aSeg[i]) return null;
  }
  return params;
}
