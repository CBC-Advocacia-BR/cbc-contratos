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

const SUPABASE_URL = 'https://vygczeepvoyaehfchxko.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2N6ZWVwdm95YWVoZmNoeGtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjgxNDYsImV4cCI6MjA4OTcwNDE0Nn0.dFk9CC48V1SlDuFNmtJOkfKf6LSz46aUg6Mpbd7xUjo';
const API_KEYS = (process.env.REST_API_KEYS || 'cbc-api-2026').split(',').map(k => k.trim());
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

// (#156) Cache agressivo em GET — integradores externos repuxam e podem servir cache
// Mutations (POST) sempre sem cache
const GET_CACHE = { 'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60' };
const NO_CACHE  = { 'Cache-Control': 'no-cache, no-store, must-revalidate' };
function headersFor(method) {
  return method === 'GET' ? { ...CORS, ...GET_CACHE } : { ...CORS, ...NO_CACHE };
}

function checkAuth(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  const urlKey = new URL(req.url).searchParams.get('api_key');
  return API_KEYS.includes(token) || API_KEYS.includes(urlKey);
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

  // Auth for all other endpoints
  if (!checkAuth(req)) {
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
      const { data, error } = await supabase
        .from('contratos')
        .select('*')
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
      const { data, error } = await supabase
        .from('contratos')
        .select('id, status, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, created_at, created_by, signed_at, origem_cliente');
      if (error) throw error;

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
