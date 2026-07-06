// (auditoria #24) Helpers de HTTP compartilhados para as Netlify Functions.
// 38 functions repetiam o mesmo bloco de CORS coladas na mao; aqui fica num carimbo
// unico. Por padrao restringe CORS a origens conhecidas (nao '*') — ao ADOTAR numa
// function, confira se algum integrador externo legitimo precisa ser incluido.
const ALLOWED_ORIGINS = [
  'https://contratos-cbc.netlify.app',
  'http://localhost:5173',
  'http://localhost:4174',
];

export function corsHeaders(origin) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-bot-key',
    'Vary': 'Origin',
  };
}

// Resposta JSON padronizada (com CORS opcional).
export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// Trata o preflight OPTIONS de forma uniforme. Retorna a Response ou null (segue o fluxo).
export function preflight(req) {
  if (req?.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders(req.headers?.get?.('origin')) });
  }
  return null;
}
