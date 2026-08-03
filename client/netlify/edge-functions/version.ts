/**
 * Netlify Edge Function — /api/version
 * ------------------------------------------------------------------
 * (auditoria 01/08/2026 — item 168) Responde "o que exatamente esta no ar agora?".
 *
 * POR QUE ISTO EXISTE: quando alguem diz que uma tela esta com defeito, a primeira
 * pergunta e se o deploy que corrigiu aquilo chegou a subir. Ate hoje a unica resposta
 * era abrir o painel da Netlify e comparar horarios, ou confiar no numero de versao
 * escrito a mao no cabecalho do app — que so muda quando alguem lembra de mudar.
 *
 * Estes valores vem do PROPRIO ambiente do deploy (a Netlify os injeta), entao nao ha
 * como ficarem desatualizados: se o endpoint responde, e a versao que esta servindo.
 *
 * NAO EXPOE NADA SENSIVEL: identificador de deploy, commit, branch e data. Nenhuma
 * credencial, nenhum nome de tabela, nenhuma informacao sobre o escritorio. O
 * `deploy_id` ja aparece nos cabecalhos de resposta de qualquer requisicao ao site.
 *
 * COMO USAR:
 *   curl https://contratos-cbc.netlify.app/api/version
 *   # confirma se o commit que voce acabou de subir e o que esta atendendo
 * ------------------------------------------------------------------
 */

export default async () => {
  const env = (n: string) => Deno.env.get(n) || null;

  const corpo = {
    // identificador do deploy na Netlify — o mesmo que o ./rollback.sh aceita
    deploy_id: env('DEPLOY_ID'),
    // commit exato que gerou este bundle
    commit: env('COMMIT_REF'),
    commit_curto: (env('COMMIT_REF') || '').slice(0, 7) || null,
    branch: env('BRANCH'),
    // 'production' | 'deploy-preview' | 'branch-deploy'
    contexto: env('CONTEXT'),
    url_do_deploy: env('DEPLOY_URL'),
    // quando ESTA resposta foi gerada (nao a hora do build — a Netlify nao a expoe)
    respondido_em: new Date().toISOString(),
  };

  return new Response(JSON.stringify(corpo, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // nunca cachear: o valor de saber a versao esta em ela ser a de agora
      'cache-control': 'no-store, max-age=0',
      'access-control-allow-origin': '*',
    },
  });
};
