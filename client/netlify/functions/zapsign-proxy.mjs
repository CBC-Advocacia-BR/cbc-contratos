const ZAPSIGN_TOKEN = process.env.ZAPSIGN_TOKEN;
const ZAPSIGN_URL = 'https://api.zapsign.com.br';

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
// (#156) Status e operacoes dinamicas — nunca cachear (senao perdemos atualizacao de assinatura)
const NO_CACHE = { 'Cache-Control': 'no-cache, no-store, must-revalidate' };

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  try {
    const body = await req.json();
    const { action, ...payload } = body;

    let url, method = 'POST';

    switch (action) {
      case 'create':
        url = `${ZAPSIGN_URL}/api/v1/docs/?api_token=${ZAPSIGN_TOKEN}`;
        break;
      case 'status':
        url = `${ZAPSIGN_URL}/api/v1/docs/${payload.docToken}/?api_token=${ZAPSIGN_TOKEN}`;
        method = 'GET';
        break;
      case 'cancel':
        // Delete/cancel a document
        url = `${ZAPSIGN_URL}/api/v1/docs/${payload.docToken}/?api_token=${ZAPSIGN_TOKEN}`;
        method = 'DELETE';
        break;
      case 'download':
        // Get signed file URL
        url = `${ZAPSIGN_URL}/api/v1/docs/${payload.docToken}/?api_token=${ZAPSIGN_TOKEN}`;
        method = 'GET';
        break;
      case 'resend':
        // Resend signing notification to a signer
        url = `${ZAPSIGN_URL}/api/v1/signers/${payload.signerToken}/notify/?api_token=${ZAPSIGN_TOKEN}`;
        method = 'POST';
        break;
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { ...CORS, ...NO_CACHE } });
    }

    const fetchOptions = { method, headers: { 'Content-Type': 'application/json' } };
    if (method === 'POST' && action !== 'resend') fetchOptions.body = JSON.stringify(payload);

    const resp = await fetch(url, fetchOptions);
    const data = await resp.text();

    // For download action, extract the signed file URL
    if (action === 'download' && resp.ok) {
      try {
        const doc = JSON.parse(data);
        return new Response(JSON.stringify({
          signed_file: doc.signed_file || null,
          original_file: doc.original_file || null,
          status: doc.status,
          name: doc.name,
        }), { status: 200, headers: { ...CORS, ...NO_CACHE } });
      } catch {}
    }

    return new Response(data, { status: resp.status, headers: { ...CORS, ...NO_CACHE } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, ...NO_CACHE } });
  }
};

export const config = { path: '/.netlify/functions/zapsign-proxy' };
