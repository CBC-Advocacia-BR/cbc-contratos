/**
 * Netlify Function: Power BI endpoint
 * Returns contratos data in JSON format for Power BI DirectQuery
 * URL: /.netlify/functions/api-powerbi?table=contratos
 * Auth: Bearer token via API_KEY env var
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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
  // (auditoria 01/08 — item 16) ERA `public, s-maxage=300`: a CDN da Netlify guarda a
  // resposta POR URL e ignora o cabecalho de senha, entao um pedido SEM CHAVE podia
  // receber de volta o payload cacheado de um integrador autenticado — com nome e CPF
  // dos clientes dentro. Dado pessoal nunca pode ir para cache compartilhado.
  ...CACHE_PRIVADO,
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  // (auditoria 01/08 — item 19) Limite de requisicoes antes da chave: barra tentativa de
  // adivinhar a chave em massa e download da base inteira em loop. Teto folgado porque o
  // Power BI faz varias chamadas seguidas ao atualizar o painel.
  const rl = await checkRateLimitShared(req, { bucket: 'api-powerbi', max: 120, windowSeconds: 60 });
  if (!rl.allowed) return rateLimitResponse();

  // (item 13) Sem POWERBI_API_KEY configurada, a versao anterior aceitava
  // 'cbc-powerbi-2026' — valor que esta escrito neste repositorio. Agora o endpoint
  // se DESATIVA com uma mensagem clara em vez de ficar aberto em silencio.
  const { chaves, erro } = chavesDaEnv('POWERBI_API_KEY');
  if (erro) {
    return new Response(JSON.stringify({ error: erro }), { status: 503, headers: CORS });
  }
  // (item 14) `?api_key=` fica em log/histórico/Referer. Mantido por ora porque o Power BI
  // do escritorio ja esta configurado assim — a troca para cabecalho Authorization deve
  // ser feita no Power BI antes de virar `permitirUrl: false`.
  // (item 20) comparacao em tempo constante (timingSafeEqual) dentro de `autorizado`.
  if (!autorizado(req, chaves, { permitirUrl: true })) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Provide api_key param or Bearer token.' }), { status: 401, headers: CORS });
  }

  const url = new URL(req.url);
  const table = url.searchParams.get('table') || 'contratos';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000'), 5000);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const status = url.searchParams.get('status');
  const resort = url.searchParams.get('resort');
  const from = url.searchParams.get('from'); // YYYY-MM-DD
  const to = url.searchParams.get('to');

  try {
    if (table === 'contratos') {
      let query = supabase
        .from('contratos')
        // (bug-3) origem_cliente e data_primeira_mensagem top-level estao vazias no banco; o dado real vive no JSONB dados. Alias mantem row.origem_cliente / row.data_primeira_mensagem funcionando
        .select('id, created_at, updated_at, nome_contratante1, cpf_contratante1, email_contratante1, nome_contratante2, cpf_contratante2, resort, tipo_acao, honorarios_total, honorarios_parcelas, honorarios_valor_parcela, honorarios_percentual_exito, data_primeira_parcela, status, created_by, updated_by, zapsign_sent_at, signed_at, origem_cliente:dados->>origemCliente, observacoes_internas, advbox_status, sexo_contratante1, sexo_contratante2, data_primeira_mensagem:dados->>dataPrimeiraMensagem')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (resort) query = query.eq('resort', resort);
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to + 'T23:59:59');

      const { data, error, count } = await query;
      if (error) throw error;

      // Add computed fields for Power BI
      const enriched = (data || []).map(c => ({
        ...c,
        // Jornada de compra (dias entre primeira mensagem e assinatura)
        jornada_compra_dias: c.data_primeira_mensagem && c.signed_at
          ? Math.round((new Date(c.signed_at) - new Date(c.data_primeira_mensagem)) / (1000 * 60 * 60 * 24))
          : null,
        // Tempo até assinatura (dias entre envio ZapSign e assinatura)
        tempo_assinatura_dias: c.zapsign_sent_at && c.signed_at
          ? Math.round((new Date(c.signed_at) - new Date(c.zapsign_sent_at)) / (1000 * 60 * 60 * 24) * 10) / 10
          : null,
        // Mês/Ano para agrupamento
        mes_criacao: c.created_at ? c.created_at.substring(0, 7) : null,
        ano_criacao: c.created_at ? c.created_at.substring(0, 4) : null,
        // Tipo de honorário
        tipo_honorario: (Number(c.honorarios_total) > 0 && Number(c.honorarios_percentual_exito) > 0) ? 'Iniciais + Exito'
          : (Number(c.honorarios_total) === 0 && Number(c.honorarios_percentual_exito) > 0) ? 'Somente Exito'
          : 'Somente Iniciais',
      }));

      return new Response(JSON.stringify({ data: enriched, count: enriched.length, offset, limit }), { headers: CORS });
    }

    if (table === 'dashboard') {
      // Aggregated stats for Power BI dashboard
      // (auditoria 01/08 — item 88) Paginado: sem isto o painel do Power BI publicaria
      // totais calculados sobre no maximo 1000 contratos, sem nenhum sinal de corte.
      const data = await fetchAllPaged(() => supabase
        .from('contratos')
        // (bug-3) origem_cliente / data_primeira_mensagem reais vivem no JSONB dados (top-level vazias); alias mantem c.origem_cliente / c.data_primeira_mensagem. (perf-be-9/dashboard-bi-13) advbox_date entra como fallback de assinatura efetiva
        .select('id, created_at, updated_at, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, status, created_by, signed_at, zapsign_sent_at, advbox_date, origem_cliente:dados->>origemCliente, data_primeira_mensagem:dados->>dataPrimeiraMensagem')
        .order('id'));

      const stats = {
        total: data.length,
        por_status: {},
        por_resort: {},
        por_tipo_acao: {},
        por_mes: {},
        por_usuario: {},
        por_origem: {},
        // (perf-be-9/dashboard-bi-13) agregados financeiros calculados em JS sobre os contratos ja buscados
        receita_por_mes_assinatura: {},   // soma honorarios_total por mes de assinatura efetiva
        assinados_por_mes: {},            // contagem de assinados por mes de assinatura efetiva
        receita_por_resort: {},           // soma honorarios_total por resort (assinados)
      };

      data.forEach(c => {
        stats.por_status[c.status] = (stats.por_status[c.status] || 0) + 1;
        if (c.resort) stats.por_resort[c.resort] = (stats.por_resort[c.resort] || 0) + 1;
        if (c.tipo_acao) stats.por_tipo_acao[c.tipo_acao] = (stats.por_tipo_acao[c.tipo_acao] || 0) + 1;
        if (c.created_at) {
          const mes = c.created_at.substring(0, 7);
          stats.por_mes[mes] = (stats.por_mes[mes] || 0) + 1;
        }
        if (c.created_by) stats.por_usuario[c.created_by] = (stats.por_usuario[c.created_by] || 0) + 1;
        if (c.origem_cliente) stats.por_origem[c.origem_cliente] = (stats.por_origem[c.origem_cliente] || 0) + 1;

        // (perf-be-9/dashboard-bi-13) assinatura efetiva = signed_at -> advbox_date -> updated_at
        const dataAssinatura = c.status === 'assinado' ? (c.signed_at || c.advbox_date || c.updated_at) : null;
        if (dataAssinatura) {
          const mesAss = String(dataAssinatura).substring(0, 7);
          const honor = Number(c.honorarios_total) || 0;
          stats.receita_por_mes_assinatura[mesAss] = (stats.receita_por_mes_assinatura[mesAss] || 0) + honor;
          stats.assinados_por_mes[mesAss] = (stats.assinados_por_mes[mesAss] || 0) + 1;
          if (c.resort) stats.receita_por_resort[c.resort] = (stats.receita_por_resort[c.resort] || 0) + honor;
        }
      });

      return new Response(JSON.stringify(stats), { headers: CORS });
    }

    if (table === 'activity_log') {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return new Response(JSON.stringify({ data: data || [], count: data?.length || 0 }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: 'Table not found. Use: contratos, dashboard, activity_log' }), { status: 404, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/.netlify/functions/api-powerbi' };
