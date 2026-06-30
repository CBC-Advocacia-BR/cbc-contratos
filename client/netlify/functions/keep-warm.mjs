/**
 * Netlify Function — Keep-Warm
 * ------------------------------------------------------------------
 * OTIMIZACAO (#127): Mitigacao de cold-start.
 *
 * O QUE FAZ:
 *   Cron que mantem "quentes" as funcoes criticas com pings periodicos.
 *   Sem isso, uma funcao Netlify que fica ociosa >15min sofre cold-start
 *   de 1-3s no proximo request — experiencia ruim para o usuario.
 *
 * COMO:
 *   Schedule roda a cada 10 minutos (ver config abaixo). Para cada funcao
 *   na lista FUNCTIONS_TO_WARM, dispara um OPTIONS request — e baixo
 *   overhead porque:
 *   - OPTIONS nao executa logica de negocio na maioria das funcoes
 *     (apenas retorna headers CORS)
 *   - Mesmo assim obriga o container a acordar, mantendo-o quente
 *
 * CUSTO vs ECONOMIA:
 *   - 10 min => 144 invocacoes/dia => 4.320/mes desta funcao
 *   - Cada invocacao dispara 4 sub-requisicoes HEAD/OPTIONS = 17.280 hits/mes
 *   - Free tier da Netlify: 125k invocacoes/mes — ainda bem abaixo.
 *   - Schedule "*​/5 * * * *" (288/dia = 8.640/mes) seria o dobro, sem
 *     ganho proporcional. 10min e o ponto doce.
 *   - Paulo pode reduzir para "*​/15 * * * *" (96/dia) se quiser ainda
 *     mais economia — cold-start raro porem possivel.
 *
 * QUAIS FUNCOES AQUECER:
 *   - health: usada pelo health-indicator do header a cada 60s
 *   - zapsign-proxy: chamada no polling de automacoes (App.jsx)
 *   - advbox-sync: disparada apos assinatura, nao pode demorar
 *   - save-to-drive: disparada apos assinatura, nao pode demorar
 *
 * COMO TESTAR MANUAL:
 *   curl https://contratos-cbc.netlify.app/.netlify/functions/keep-warm
 * ------------------------------------------------------------------
 */

// (p1-scale 31/05) advbox-sync e save-to-drive sairam daqui: sao funcoes on-demand
// (rodam apos assinatura, quando o usuario ja espera), entao aquecimento periodico so
// gerava invocacoes/bandwidth sem ganho real. Mantidas so as de baixa latencia.
const FUNCTIONS_TO_WARM = [
  'health',
  'zapsign-proxy',
];

const BASE = process.env.URL || 'https://contratos-cbc.netlify.app';

export default async () => {
  const results = await Promise.allSettled(
    FUNCTIONS_TO_WARM.map((fn) =>
      fetch(`${BASE}/.netlify/functions/${fn}`, {
        method: 'OPTIONS',
        // Header minimo — nao consome quase nada de bandwidth
        headers: { 'X-Keep-Warm': 'true' },
      })
        .then((r) => ({ fn, ok: r.ok, status: r.status }))
        .catch((e) => ({ fn, ok: false, error: e.message })),
    ),
  );

  const summary = {
    timestamp: new Date().toISOString(),
    total: FUNCTIONS_TO_WARM.length,
    warmed: results.filter((r) => r.status === 'fulfilled' && r.value?.ok).length,
    results: results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason)),
  };

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  // (custo-7) A cada 15 minutos — health/zapsign-proxy ja ficam quentes enquanto
  // alguem usa o app (health-check do header a cada 2-5min); 10->15 corta ~1/3 das
  // invocacoes sem piora perceptivel de cold start.
  schedule: '*/15 * * * *',
};
