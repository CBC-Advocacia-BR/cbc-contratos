/**
 * Health check endpoint — verifies all integrations are reachable
 * GET https://contratos-cbc.netlify.app/.netlify/functions/health
 */

const ASAAS_KEY = process.env.ASAAS_API_KEY;
const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';

async function checkService(name, fn) {
  const start = Date.now();
  try {
    await fn();
    return { name, status: 'ok', ms: Date.now() - start };
  } catch (e) {
    return { name, status: 'error', error: e.message, ms: Date.now() - start };
  }
}

export default async (req) => {
  // (QW#14) keep-warm e preflight CORS mandam OPTIONS — responde sem rodar os
  // checks (que batem em 4+ serviços externos). Evita ~17 mil chamadas/mês inúteis.
  if (req && req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  const checks = await Promise.all([
    checkService('supabase', async () => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/contratos?select=id&limit=1`, {
        headers: { apikey: SUPABASE_KEY },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }),
    checkService('advbox', async () => {
      const r = await fetch('https://app.advbox.com.br/api/v1/customers?limit=1', {
        headers: { Authorization: `Bearer ${process.env.ADVBOX_TOKEN || ''}` },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }),
    checkService('kommo', async () => {
      const r = await fetch('https://advocaciacbc.kommo.com/api/v4/account', {
        headers: { Authorization: `Bearer ${process.env.KOMMO_TOKEN || ''}` },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }),
    checkService('asaas', async () => {
      const r = await fetch('https://api.asaas.com/v3/customers?limit=1', {
        headers: { access_token: ASAAS_KEY },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }),
    checkService('zapsign', async () => {
      const r = await fetch(`https://api.zapsign.com.br/api/v1/docs/?api_token=${process.env.ZAPSIGN_TOKEN || ''}&limit=1`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }),
    // (chatguru removal 2026-05) checkService('chatguru') removido
    checkService('google-apps-script', async () => {
      const r = await fetch('https://script.google.com/macros/s/AKfycbzEzt-t_GDTbUKrzxTLkdOMqYS0Hz_PWcYt7uBcbj7yoKqKdUr89So8gRmsVwhT0cpI5Q/exec', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ test: true }), redirect: 'manual',
      });
      if (r.status !== 302) throw new Error('Expected redirect, got ' + r.status);
    }),
  ]);

  const allOk = checks.every(c => c.status === 'ok');
  const totalMs = checks.reduce((s, c) => s + c.ms, 0);

  return new Response(JSON.stringify({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    totalMs,
    version: '4.0.0',
    services: checks,
  }), {
    status: allOk ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // (#156) Health check pode ser cacheado por 60s — reduz poll em tab Monitor
      // stale-while-revalidate deixa servir valor antigo durante refresh
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',
    },
  });
};

export const config = { path: '/.netlify/functions/health' };
