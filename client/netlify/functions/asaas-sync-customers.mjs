/**
 * Sincroniza TODOS os customers do Asaas → Supabase asaas_customers
 * Processa em blocos de 100 por invocação. Body: { offset: 0 }
 *
 * asaas_customers e restrita ao role authenticated; a escrita passa pela RPC
 * security definer asaas_customers_upsert (segredo BOT_RPC_SECRET) — a
 * escrita direta com a chave anon era barrada pelo RLS e congelava o espelho.
 */
import { customerRow, customersUpsert } from './_lib/asaasMirror.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

const ASAAS_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';
const HEADERS = { 'access_token': ASAAS_KEY, 'Content-Type': 'application/json' };

const BLOCK = 100;
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

async function processBlock(offset) {
  const r = await fetch(`${ASAAS_URL}/customers?limit=${BLOCK}&offset=${offset}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`asaas ${r.status}`);
  const data = await r.json();
  const items = data.data || [];
  const hasMore = data.hasMore === true || items.length === BLOCK;
  if (items.length === 0) return { rows: 0, hasMore: false };

  await customersUpsert(items.map(customerRow));
  return { rows: items.length, hasMore };
}

// (perf-be-8) Sync incremental AVALIADO e MANTIDO full nesta passada.
// Motivos (nada trivial/seguro para tornar incremental sem risco de quebrar):
//   (a) A API GET /customers do Asaas NAO expõe filtro por data de
//       modificacao/criacao (so name/email/cpfCnpj/groupName/externalReference
//       + offset/limit). Logo nao da para baixar "so o que mudou" pela API.
//       Pular clientes "ja sincronizados sem mudanca" exigiria, mesmo assim,
//       VARRER todos os customers do Asaas (o trecho caro/serial continua) e
//       ainda ler as linhas atuais do Supabase para diferenciar campo a campo,
//       arriscando deixar de gravar atualizacoes legitimas. Sem ganho no gargalo.
//   (b) Converter para background mudaria o invocador (risco fora do escopo).
// O upsert ja e idempotente; manter full e o comportamento seguro.
async function runFullSync() {
  let offset = 0, total = 0, blocks = 0;
  while (blocks < 200) {
    const r = await processBlock(offset);
    total += r.rows;
    blocks++;
    if (!r.hasMore) break;
    offset += BLOCK;
  }
  return { total, blocks };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  const isScheduled = req.headers.get('x-netlify-event') === 'schedule' || req.method === 'GET';
  try {
    if (isScheduled) {
      const stats = await runFullSync();
      return new Response(JSON.stringify({ success: true, mode: 'scheduled', ...stats }), { headers: CORS });
    }
    const body = await req.json().catch(() => ({}));
    const offset = Number(body.offset) || 0;
    const result = await processBlock(offset);
    const next = result.hasMore ? { offset: offset + BLOCK } : null;
    return new Response(JSON.stringify({ success: true, processed: result.rows, current: { offset }, next, done: !next }), { headers: CORS });
  } catch (err) {
    await logAdvbox('asaas', 'erro', `sync customers: ${err.message}`.slice(0, 300), {});
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = {
  schedule: '0 9 * * *', // 06:00 BRT diário
};
