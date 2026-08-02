/**
 * Netlify Function: Public REST API for CBC Contratos
 * Endpoints:
 *   GET  /api/contratos          — list contracts (paginated)
 *   GET  /api/contratos/:id      — get single contract
 *   POST /api/contratos          — create contract
 *   GET  /api/stats              — dashboard stats
 *   GET  /api/health             — health check
 *
 * Auth: Bearer token or api_key query param
 */
import { createClient } from '@supabase/supabase-js';
import { chavesDaEnv, autorizado, CACHE_PRIVADO } from './_lib/apiAuth.mjs';
import { fetchAllPaged } from './_lib/paged.mjs';
import { checkRateLimitShared, rateLimitResponse } from './rate-limit.mjs';

const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

// (auditoria 01/08 — item 16) O GET servia `public, s-maxage=120` numa resposta que
// leva nome, CPF e e-mail dos clientes. A CDN guarda POR URL e nao enxerga o cabecalho
// de senha: uma requisicao sem chave nenhuma podia receber o cache de um integrador
// autenticado. Agora GET e POST usam o mesmo cabecalho privado.
const NO_CACHE  = { 'Cache-Control': 'no-cache, no-store, must-revalidate' };
function headersFor(method) {
  return method === 'GET' ? { ...CORS, ...CACHE_PRIVADO } : { ...CORS, ...NO_CACHE };
}

// (itens 13/14/20) senha de fabrica ('cbc-api-2026', publicada no repositorio) deixou de
// valer; comparacao em tempo constante; `?api_key=` so em modo legado.
function checkAuth(req) {
  const { chaves, erro } = chavesDaEnv('REST_API_KEYS');
  if (erro) return { ok: false, erro };
  return { ok: autorizado(req, chaves, { permitirUrl: true }), erro: null };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace('/.netlify/functions/api-rest', '');

  // Health check — no auth needed
  if (path === '/health' || path === '') {
    return new Response(JSON.stringify({
      status: 'ok',
      version: '2.0',
      endpoints: ['/api/contratos', '/api/contratos/:id', '/api/stats', '/api/health'],
      docs: 'Contact CBC Advogados for API documentation',
    }), { headers: headersFor('GET') });
  }

  // (auditoria 01/08 — item 19) Limite de requisicoes ANTES da checagem de chave: sem
  // isto dava para testar chaves em massa (forca bruta) ou baixar a base inteira em
  // loop. O limitador compartilhado (contado no banco) ja existia no projeto e so nao
  // tinha sido ligado aqui. Bucket proprio para nao competir com a cota do portal.
  const rl = await checkRateLimitShared(req, { bucket: 'api-rest', max: 60, windowSeconds: 60 });
  if (!rl.allowed) return rateLimitResponse();

  // Auth for all other endpoints
  const auth = checkAuth(req);
  // (item 13) env ausente/fraca: 503 com motivo, em vez de continuar aberto aceitando a
  // senha publicada no repositorio. Erro explicito e diagnosticavel no Monitor.
  if (auth.erro) {
    return new Response(JSON.stringify({ error: auth.erro }), { status: 503, headers: headersFor(req.method) });
  }
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Provide api_key param or Authorization Bearer token.' }), { status: 401, headers: headersFor(req.method) });
  }

  try {
    // GET /api/contratos — list
    if (path === '/contratos' && req.method === 'GET') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const status = url.searchParams.get('status');
      const resort = url.searchParams.get('resort');
      const cpf = url.searchParams.get('cpf');
      const search = url.searchParams.get('search');

      let query = supabase
        .from('contratos')
        .select('id, created_at, updated_at, nome_contratante1, cpf_contratante1, nome_contratante2, cpf_contratante2, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, status, created_by, signed_at, origem_cliente', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (resort) query = query.eq('resort', resort);
      if (cpf) query = query.or(`cpf_contratante1.eq.${cpf.replace(/\D/g, '')},cpf_contratante2.eq.${cpf.replace(/\D/g, '')}`);
      if (search) {
        // (varredura 15/06) neutraliza injecao de filtro PostgREST: , ( ) * % tem
        // significado na expressao .or() — removidos antes de interpolar o input.
        const safe = String(search).replace(/[,()*%]/g, ' ').trim().slice(0, 80);
        if (safe) query = query.or(`nome_contratante1.ilike.%${safe}%,nome_contratante2.ilike.%${safe}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({
        data: data || [],
        total: count || 0,
        limit,
        offset,
        has_more: (offset + limit) < (count || 0),
      }), { headers: headersFor('GET') });
    }

    // GET /api/contratos/:id — single
    if (path.startsWith('/contratos/') && req.method === 'GET') {
      const id = path.replace('/contratos/', '');
      // (auditoria 01/08 — item 17) Era `select('*')`: a listagem escolhia colunas com
      // cuidado, mas o DETALHE devolvia a linha inteira do banco — observacoes internas,
      // dados bancarios, o JSONB `dados` completo e as colunas de automacao. Um
      // integrador externo enxergava muito mais do que precisa. Mesmas colunas da
      // listagem + os campos de acompanhamento que fazem sentido para quem integra.
      const { data, error } = await supabase
        .from('contratos')
        .select('id, created_at, updated_at, nome_contratante1, cpf_contratante1, email_contratante1, nome_contratante2, cpf_contratante2, resort, tipo_acao, honorarios_total, honorarios_parcelas, honorarios_valor_parcela, honorarios_percentual_exito, data_primeira_parcela, status, created_by, signed_at, zapsign_sent_at, advbox_date, arquivado_em, origem_cliente')
        .eq('id', id)
        .single();
      if (error) throw error;
      if (!data) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: headersFor('GET') });
      return new Response(JSON.stringify(data), { headers: headersFor('GET') });
    }

    // POST /api/contratos — create
    if (path === '/contratos' && req.method === 'POST') {
      const body = await req.json();
      const required = ['nome_contratante1', 'cpf_contratante1', 'resort'];
      for (const field of required) {
        if (!body[field]) {
          return new Response(JSON.stringify({ error: `Field '${field}' is required` }), { status: 400, headers: headersFor('POST') });
        }
      }

      const record = {
        nome_contratante1: body.nome_contratante1,
        cpf_contratante1: (body.cpf_contratante1 || '').replace(/\D/g, ''),
        email_contratante1: body.email_contratante1 || null,
        nome_contratante2: body.nome_contratante2 || null,
        cpf_contratante2: body.cpf_contratante2 ? body.cpf_contratante2.replace(/\D/g, '') : null,
        resort: body.resort,
        tipo_acao: body.tipo_acao || null,
        honorarios_total: body.honorarios_total || 0,
        honorarios_percentual_exito: body.honorarios_percentual_exito || 0,
        honorarios_parcelas: body.honorarios_parcelas || null,
        honorarios_valor_parcela: body.honorarios_valor_parcela || null,
        data_primeira_parcela: body.data_primeira_parcela || null,
        status: 'rascunho',
        created_by: body.created_by || 'api',
        origem_cliente: body.origem_cliente || null,
        observacoes_internas: body.observacoes_internas || null,
      };

      const { data, error } = await supabase.from('contratos').insert(record).select().single();
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, id: data.id, created_at: data.created_at }), { status: 201, headers: headersFor('POST') });
    }

    // GET /api/stats — dashboard stats
    if (path === '/stats' && req.method === 'GET') {
      // (auditoria 01/08 — item 88) Sem paginacao o PostgREST corta em 1000 linhas e os
      // TOTAIS saem menores que a realidade — um relatorio que mente sem avisar. E o
      // mesmo defeito que bagunçou o funil em julho, aqui na porta de saida da API.
      const data = await fetchAllPaged(() => supabase
        .from('contratos')
        .select('id, status, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, created_at, created_by, signed_at, origem_cliente')
        .order('id'));

      const stats = {
        total: data.length,
        por_status: {},
        por_resort: {},
        por_tipo_acao: {},
        por_usuario: {},
        por_origem: {},
        valor_total_honorarios: 0,
      };

      data.forEach(c => {
        stats.por_status[c.status] = (stats.por_status[c.status] || 0) + 1;
        if (c.resort) stats.por_resort[c.resort] = (stats.por_resort[c.resort] || 0) + 1;
        if (c.tipo_acao) stats.por_tipo_acao[c.tipo_acao] = (stats.por_tipo_acao[c.tipo_acao] || 0) + 1;
        if (c.created_by) stats.por_usuario[c.created_by] = (stats.por_usuario[c.created_by] || 0) + 1;
        if (c.origem_cliente) stats.por_origem[c.origem_cliente] = (stats.por_origem[c.origem_cliente] || 0) + 1;
        stats.valor_total_honorarios += Number(c.honorarios_total) || 0;
      });

      return new Response(JSON.stringify(stats), { headers: headersFor('GET') });
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found', available: ['/health', '/contratos', '/contratos/:id', '/stats'] }), { status: 404, headers: headersFor(req.method) });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: headersFor(req.method) });
  }
};

export const config = { path: '/.netlify/functions/api-rest/*' };
