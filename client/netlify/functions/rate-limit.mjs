/**
 * Rate limiter para Netlify Functions.
 *  - checkRateLimit(req): EM MEMORIA, por-instancia (rapido, mas cada instancia conta
 *    do zero — limita mal em escala). Mantido como fast-path/fallback.
 *  - checkRateLimitShared(req, opts): COMPARTILHADO via Postgres (auditoria #77) — conta
 *    de verdade entre instancias. Cai para o em-memoria se a RPC nao existir/falhar.
 */
import { supa } from './_lib/supabaseClient.mjs';

const WINDOW_MS = 60000; // 1 minute window
const MAX_REQUESTS = 30; // Max 30 requests per minute per IP
const store = new Map();

// (seg-12) x-nf-client-connection-ip e o IP real do cliente na Netlify; usar antes dos demais
export function clientIp(req) {
  return req.headers.get('x-nf-client-connection-ip') ||
         req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         req.headers.get('x-real-ip') ||
         'unknown';
}

// (auditoria #77) Limitador COMPARTILHADO: uma janela por (bucket, ip) contada no banco.
// bucket separa cotas por endpoint (ex.: 'cpf' com teto baixo). Fallback = em-memoria.
export async function checkRateLimitShared(req, { bucket = 'default', max = MAX_REQUESTS, windowSeconds = 60 } = {}) {
  if (!supa) return checkRateLimit(req);
  try {
    const { data, error } = await supa.rpc('rate_limit_hit', {
      p_bucket: bucket, p_ip: clientIp(req), p_window_seconds: windowSeconds, p_max: max,
    });
    if (error || !data) return checkRateLimit(req); // RPC ausente/erro -> fallback seguro
    const row = Array.isArray(data) ? data[0] : data;
    return { allowed: !!row.allowed, remaining: Math.max(0, max - (row.hits || 0)) };
  } catch { return checkRateLimit(req); }
}

export function checkRateLimit(req) {
  const ip = clientIp(req);

  const now = Date.now();
  const key = ip;

  if (!store.has(key)) {
    store.set(key, { count: 1, start: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  const entry = store.get(key);

  if (now - entry.start > WINDOW_MS) {
    // Window expired, reset
    store.set(key, { count: 1, start: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  entry.count++;
  const remaining = Math.max(0, MAX_REQUESTS - entry.count);

  if (entry.count > MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining };
}

export function rateLimitResponse() {
  return new Response(JSON.stringify({ error: 'Too many requests. Try again in 1 minute.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.start > WINDOW_MS * 2) store.delete(key);
  }
}, 300000);
