// (auditoria 01/08/2026 — itens 13/14/16/20) Autenticacao das APIs de integracao
// (api-rest, api-powerbi) num lugar so. Antes cada uma repetia o mesmo bloco e
// carregava os mesmos quatro defeitos:
//
//  13) SENHA DE FABRICA: `process.env.X || 'cbc-powerbi-2026'`. Se a variavel some do
//      Netlify (ou nunca foi criada), a funcao passa a aceitar uma senha que esta
//      ESCRITA NO REPOSITORIO — e ninguem percebe, porque tudo continua respondendo.
//      Aqui a ausencia (ou o uso do default conhecido) vira 503 explicito.
//  14) CHAVE NA URL: `?api_key=...` fica gravada em log de servidor, historico do
//      navegador e cabecalho Referer. Passa a ser aceita apenas em modo legado
//      explicito, para nao derrubar integrador antigo de uma vez.
//  16) CACHE PUBLICO: respostas com nome/CPF saiam como `public, s-maxage=120`. A CDN
//      guarda por URL e ignora o cabecalho de senha — uma requisicao SEM CHAVE podia
//      receber a resposta cacheada de um integrador autenticado. Agora `private, no-store`.
//  20) COMPARACAO `!==`: para no primeiro caractere errado e, em tese, permite
//      descobrir a chave medindo o tempo de resposta. Trocado por timingSafeEqual.
import { timingSafeEqual } from 'node:crypto';

// Defaults publicados no repositorio — nunca podem valer como senha.
export const SENHAS_DE_FABRICA = new Set([
  'cbc-api-2026', 'cbc-powerbi-2026', 'cbc-bot-2026',
]);

/** Comparacao de segredo em tempo constante (aceita tamanhos diferentes sem vazar). */
export function segredoIgual(a, b) {
  const A = Buffer.from(String(a ?? ''), 'utf8');
  const B = Buffer.from(String(b ?? ''), 'utf8');
  if (A.length !== B.length || A.length === 0) return false;
  return timingSafeEqual(A, B);
}

/**
 * Le as chaves validas de uma env. Devolve { chaves, erro }.
 * `erro` preenchido = a function deve responder 503 e NAO atender: e melhor a
 * integracao parar com uma mensagem clara do que continuar aberta com senha publica.
 */
export function chavesDaEnv(nomeEnv) {
  const bruto = String(process.env[nomeEnv] || '').trim();
  if (!bruto) {
    return { chaves: [], erro: `${nomeEnv} nao configurada no Netlify — endpoint desativado por seguranca.` };
  }
  const chaves = bruto.split(',').map((k) => k.trim()).filter(Boolean);
  const fracas = chaves.filter((k) => SENHAS_DE_FABRICA.has(k));
  if (fracas.length) {
    return { chaves: [], erro: `${nomeEnv} esta com uma senha de fabrica publicada no repositorio — troque o valor no Netlify.` };
  }
  if (!chaves.length) {
    return { chaves: [], erro: `${nomeEnv} vazia — endpoint desativado por seguranca.` };
  }
  return { chaves, erro: null };
}

/**
 * Confere a chave do pedido. Aceita `Authorization: Bearer <chave>` e, so quando
 * `permitirUrl` for true, tambem `?api_key=` (modo legado, para nao derrubar um
 * integrador antigo no mesmo dia da mudanca).
 */
export function autorizado(req, chaves, { permitirUrl = false } = {}) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token && chaves.some((k) => segredoIgual(token, k))) return true;
  if (permitirUrl) {
    const urlKey = new URL(req.url).searchParams.get('api_key');
    if (urlKey && chaves.some((k) => segredoIgual(urlKey, k))) return true;
  }
  return false;
}

/**
 * Cabecalhos de cache para resposta COM DADO PESSOAL.
 * `private` impede a CDN de guardar; `no-store` impede ate o navegador.
 */
export const CACHE_PRIVADO = { 'Cache-Control': 'private, no-store, max-age=0' };
