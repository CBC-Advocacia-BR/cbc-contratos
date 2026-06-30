/**
 * API Endpoints — Edge Functions com fallback para Functions normais
 * ------------------------------------------------------------------
 * MIGRACAO (#126): este modulo faz o frontend apontar para os endpoints
 * Edge `/api/*` (Deno, <50ms global) em vez dos antigos Node Functions
 * `/.netlify/functions/*` (cold start 1-3s).
 *
 * Estrategia: se o endpoint Edge falhar (timeout, 5xx, erro de rede),
 * caimos automaticamente para o endpoint antigo. Isso garante que a
 * UX nao quebra caso a Edge Function esteja fora do ar ou com bug.
 *
 * Uso:
 *   import { API } from './utils/apiEndpoints';
 *   await API.health();
 *   await API.zapsign({ action: 'status', docToken: '...' });
 *
 * Body/headers identicos aos esperados pelas Functions antigas — a
 * paridade e garantida nos arquivos `netlify/edge-functions/*.ts`.
 * ------------------------------------------------------------------
 */

/**
 * Chama endpoint Edge com fallback para Function antiga.
 * - Timeout de 8s no edge (AbortSignal) para nao pendurar requests.
 * - Se edge responder com erro HTTP ou lancar excecao, tenta o fallback.
 * - O fallback NAO tem timeout adicional (preserva comportamento original).
 */
export async function callWithFallback(edgePath, fallbackPath, options = {}) {
  try {
    const resp = await fetch(edgePath, {
      ...options,
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) return resp;
    // Edge respondeu mas com erro HTTP — tenta fallback
    throw new Error(`edge ${resp.status}`);
  } catch (err) {
    console.warn(
      `[edge fallback] ${edgePath} falhou (${err.message}), tentando ${fallbackPath}`
    );
    return fetch(fallbackPath, options);
  }
}

/**
 * Objeto API — chamadas semanticas dos 3 endpoints migrados.
 * Cada funcao retorna uma Response (Promise) — mesma API do `fetch`.
 */
export const API = {
  /**
   * Health check — GET /api/health (fallback: /.netlify/functions/health)
   * Sem body; usado pelo header visual e pelo MonitorPanel.
   */
  health: () =>
    callWithFallback('/api/health', '/.netlify/functions/health', {}),

  /**
   * ZapSign proxy — POST /api/zapsign (fallback: /.netlify/functions/zapsign-proxy)
   * Body aceita { action: 'create' | 'status' | 'cancel' | 'download' | 'resend', ...payload }
   */
  zapsign: (body) =>
    callWithFallback('/api/zapsign', '/.netlify/functions/zapsign-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
