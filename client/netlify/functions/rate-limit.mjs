/**
 * Simple in-memory rate limiter for Netlify Functions.
 * Note: Each function instance has its own memory, so this is per-instance.
 * For true rate limiting across instances, use Redis/KV store.
 */

const WINDOW_MS = 60000; // 1 minute window
const MAX_REQUESTS = 30; // Max 30 requests per minute per IP
const store = new Map();

export function checkRateLimit(req) {
  // (seg-12) x-nf-client-connection-ip e o IP real do cliente na Netlify; usar antes dos demais
  const ip = req.headers.get('x-nf-client-connection-ip') ||
             req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             req.headers.get('x-real-ip') ||
             'unknown';

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
