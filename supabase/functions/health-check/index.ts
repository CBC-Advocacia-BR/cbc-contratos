/**
 * Supabase Edge Function — Health Check (Proof of Concept)
 * ------------------------------------------------------------------
 * OTIMIZACAO (#137): migracao de health check para Supabase Edge Functions.
 *
 * POR QUE SUPABASE EDGE:
 *  - Gratuito no free tier: 500k invocacoes/mes (muito acima do uso atual)
 *  - Roda no global edge network (Deno Deploy) — latencia <100ms
 *  - Nao consome bandwidth da Netlify (economia para o plano Pro)
 *  - Ideal para endpoints somente-leitura que fazem fetch externo
 *
 * COMO DEPLOYAR:
 *   1. Instalar CLI: npm i -g supabase
 *   2. Login: supabase login
 *   3. Link do projeto: supabase link --project-ref vygczeepvoyaehfchxko
 *   4. Deploy: supabase functions deploy health-check
 *
 * COMO TESTAR LOCAL:
 *   supabase functions serve health-check
 *
 * URL APOS DEPLOY:
 *   https://vygczeepvoyaehfchxko.supabase.co/functions/v1/health-check
 *
 * AUTENTICACAO:
 *   Por padrao, Supabase Edge Functions exigem JWT (anon key ou user token)
 *   no header Authorization. Para tornar publico (igual ao health da Netlify),
 *   deploy com flag --no-verify-jwt:
 *     supabase functions deploy health-check --no-verify-jwt
 *
 * FRONTEND: nao mudar ainda. Este e um PoC — validar antes de migrar.
 * ------------------------------------------------------------------
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SERVICES: Record<string, string> = {
  asaas: 'https://api.asaas.com/v3/customers?limit=1',
  zapsign: 'https://api.zapsign.com.br/api/v1/docs/',
  chatguru: 'https://s19.chatguru.app',
  apps_script:
    'https://script.google.com/macros/s/AKfycbzEzt-t_GDTbUKrzxTLkdOMqYS0Hz_PWcYt7uBcbj7yoKqKdUr89So8gRmsVwhT0cpI5Q/exec',
  supabase: 'https://vygczeepvoyaehfchxko.supabase.co/rest/v1/',
};

type CheckResult = {
  name: string;
  status: 'ok' | 'error';
  latency: number;
  code?: number;
  error?: string;
};

async function check(name: string, url: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return {
      name,
      status: r.ok ? 'ok' : 'error',
      latency: Date.now() - start,
      code: r.status,
    };
  } catch (e) {
    const err = e as Error;
    return {
      name,
      status: 'error',
      latency: Date.now() - start,
      error: err.message,
    };
  }
}

serve(async () => {
  const results = await Promise.all(
    Object.entries(SERVICES).map(([n, u]) => check(n, u)),
  );
  const allOk = results.every((r) => r.status === 'ok');

  return new Response(
    JSON.stringify({
      status: allOk ? 'healthy' : 'degraded',
      services: results,
      timestamp: new Date().toISOString(),
      runtime: 'supabase-edge',
    }),
    {
      status: allOk ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
});
