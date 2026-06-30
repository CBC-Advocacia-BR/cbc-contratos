/**
 * Netlify Edge Function — Health Check
 * ------------------------------------------------------------------
 * MIGRACAO (#126): versao Edge da funcao `netlify/functions/health.mjs`.
 *
 * POR QUE EDGE:
 *  - Health check e 100% fetch para APIs externas (sem filesystem, sem
 *    dependencia Node-only), ideal para rodar no edge da Netlify.
 *  - Roda em Deno nos POPs geograficamente proximos do cliente, cortando
 *    a latencia de ~200ms (cold-start Node) para <50ms.
 *  - O endpoint fica exposto em /api/health (novo), enquanto o endpoint
 *    antigo /.netlify/functions/health permanece ativo durante a transicao
 *    — ver netlify.toml.
 *
 * LIMITACOES EDGE:
 *  - Sem `Buffer`, sem `process.version`, sem filesystem.
 *  - CPU total: 50ms. Wall clock: 20s.
 *  - Aqui ficamos bem abaixo — somamos ~500ms wall-clock tipico (fetch
 *    paralelo a 5 servicos externos) e CPU proprio e desprezivel.
 *
 * COMO TESTAR APOS DEPLOY:
 *   curl https://contratos-cbc.netlify.app/api/health
 *
 * FRONTEND: manter chamando `/.netlify/functions/health` por enquanto.
 * Quando a edge for validada, alternar para `/api/health`.
 * ------------------------------------------------------------------
 */

import type { Context } from 'https://edge.netlify.com/';

// Credenciais sao lidas de env vars (Netlify injeta automaticamente no edge).
// Defaults espelham o health.mjs original para manter paridade funcional.
const ASAAS_KEY = Deno.env.get('ASAAS_API_KEY') || '';

const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';

type CheckResult = {
  name: string;
  status: 'ok' | 'error';
  ms: number;
  error?: string;
};

async function checkService(name: string, fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, status: 'ok', ms: Date.now() - start };
  } catch (e) {
    const err = e as Error;
    return { name, status: 'error', error: err.message, ms: Date.now() - start };
  }
}

export default async (_req: Request, _context: Context) => {
  const checks = await Promise.all([
    checkService('supabase', async () => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/contratos?select=id&limit=1`, {
        headers: { apikey: SUPABASE_KEY },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }),
    // (fix 16/06/2026 — bug-monitor-1) ADVBOX e Kommo agora entram no health do edge,
    // igual ao health.mjs. Sem isso, um 401 do Kommo nunca acendia o farol/banner do
    // Monitor (o edge so checava 4 servicos e respondia 200, sem cair no fallback).
    checkService('advbox', async () => {
      const r = await fetch('https://app.advbox.com.br/api/v1/customers?limit=1', {
        headers: { Authorization: `Bearer ${Deno.env.get('ADVBOX_TOKEN') || ''}` },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }),
    checkService('kommo', async () => {
      const r = await fetch('https://advocaciacbc.kommo.com/api/v4/account', {
        headers: { Authorization: `Bearer ${Deno.env.get('KOMMO_TOKEN') || ''}` },
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
      const r = await fetch(
        `https://api.zapsign.com.br/api/v1/docs/?api_token=${Deno.env.get('ZAPSIGN_TOKEN') || ''}&limit=1`,
      );
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }),
    // (chatguru removal 2026-05) checkService('chatguru') removido
    checkService('google-apps-script', async () => {
      const r = await fetch(
        'https://script.google.com/macros/s/AKfycbzEzt-t_GDTbUKrzxTLkdOMqYS0Hz_PWcYt7uBcbj7yoKqKdUr89So8gRmsVwhT0cpI5Q/exec',
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ test: true }),
          redirect: 'manual',
        },
      );
      if (r.status !== 302) throw new Error('Expected redirect, got ' + r.status);
    }),
  ]);

  const allOk = checks.every((c) => c.status === 'ok');
  const totalMs = checks.reduce((s, c) => s + c.ms, 0);

  return new Response(
    JSON.stringify({
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      totalMs,
      version: '4.0.0-edge',
      runtime: 'netlify-edge',
      services: checks,
    }),
    {
      status: allOk ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // (#156) Cache 60s com stale-while-revalidate igual ao health.mjs original
        'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',
      },
    },
  );
};

export const config = {
  path: '/api/health',
  cache: 'manual',
};
