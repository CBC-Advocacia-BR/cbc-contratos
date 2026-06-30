/**
 * Netlify Edge Function — ZapSign Proxy
 * ------------------------------------------------------------------
 * MIGRACAO (#126): versao Edge da funcao `netlify/functions/zapsign-proxy.mjs`.
 *
 * POR QUE EDGE:
 *  - Proxy puro: body in, body out. Zero logica pesada.
 *  - Roda no POP do usuario em vez de em `us-east-1` — reduz a distancia
 *    de cada requisicao para a API ZapSign (sediada no Brasil) quando o
 *    cliente tambem esta no Brasil (latencia ~40ms menor por call).
 *  - Cold start no edge e ~10x mais rapido que Node Functions.
 *
 * LIMITACOES EDGE:
 *  - Deno runtime — `fetch`, `Request`, `Response`, `URLSearchParams` sao
 *    nativos. Nada do que fazemos aqui depende de Node APIs.
 *  - 50ms CPU / 20s wall-clock — cada proxy ZapSign leva <1s tipico.
 *
 * COMO TESTAR APOS DEPLOY:
 *   curl -X POST https://contratos-cbc.netlify.app/api/zapsign \
 *     -H 'Content-Type: application/json' \
 *     -d '{"action":"status","docToken":"..."}'
 *
 * FRONTEND: ainda aponta para `/.netlify/functions/zapsign-proxy`. Manter
 * assim ate que este endpoint seja validado em producao.
 * ------------------------------------------------------------------
 */

import type { Context } from 'https://edge.netlify.com/';

const ZAPSIGN_TOKEN =
  Deno.env.get('ZAPSIGN_TOKEN');
const ZAPSIGN_URL = 'https://api.zapsign.com.br';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

// (#156) Status e operacoes dinamicas — nunca cachear
const NO_CACHE = { 'Cache-Control': 'no-cache, no-store, must-revalidate' };

type ZapAction = 'create' | 'status' | 'cancel' | 'download' | 'resend';
type Payload = {
  action: ZapAction;
  docToken?: string;
  signerToken?: string;
  [key: string]: unknown;
};

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      status: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const body = (await req.json()) as Payload;
    const { action, ...payload } = body;

    let url: string;
    let method: 'GET' | 'POST' | 'DELETE' = 'POST';

    switch (action) {
      case 'create':
        url = `${ZAPSIGN_URL}/api/v1/docs/?api_token=${ZAPSIGN_TOKEN}`;
        break;
      case 'status':
        url = `${ZAPSIGN_URL}/api/v1/docs/${payload.docToken}/?api_token=${ZAPSIGN_TOKEN}`;
        method = 'GET';
        break;
      case 'cancel':
        url = `${ZAPSIGN_URL}/api/v1/docs/${payload.docToken}/?api_token=${ZAPSIGN_TOKEN}`;
        method = 'DELETE';
        break;
      case 'download':
        url = `${ZAPSIGN_URL}/api/v1/docs/${payload.docToken}/?api_token=${ZAPSIGN_TOKEN}`;
        method = 'GET';
        break;
      case 'resend':
        url = `${ZAPSIGN_URL}/api/v1/signers/${payload.signerToken}/notify/?api_token=${ZAPSIGN_TOKEN}`;
        method = 'POST';
        break;
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...CORS, ...NO_CACHE },
        });
    }

    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (method === 'POST' && action !== 'resend') {
      fetchOptions.body = JSON.stringify(payload);
    }

    const resp = await fetch(url, fetchOptions);
    const data = await resp.text();

    // Para download, extraimos somente os campos relevantes do doc
    if (action === 'download' && resp.ok) {
      try {
        const doc = JSON.parse(data);
        return new Response(
          JSON.stringify({
            signed_file: doc.signed_file || null,
            original_file: doc.original_file || null,
            status: doc.status,
            name: doc.name,
          }),
          { status: 200, headers: { ...CORS, ...NO_CACHE } },
        );
      } catch {
        // Se nao conseguir parsear, cai no retorno padrao abaixo
      }
    }

    return new Response(data, {
      status: resp.status,
      headers: { ...CORS, ...NO_CACHE },
    });
  } catch (err) {
    const e = err as Error;
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...CORS, ...NO_CACHE },
    });
  }
};

export const config = {
  path: '/api/zapsign',
  cache: 'manual',
};
