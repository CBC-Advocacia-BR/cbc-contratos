// (auditoria 01/08/2026 — item 155) Rede de captura de erro para as Netlify Functions.
//
// O PROBLEMA: o Sentry só existe no site (src/main.jsx). Nas 78 functions, um erro não
// tratado vira um `console.error` que mora no painel da Netlify — com retenção curta —
// ou simplesmente some. Numa investigação de três semanas atrás não há o que ler. E as
// functions são justamente onde mora o dinheiro: emissão de nota fiscal, cobrança,
// criação de processo, arquivamento de contrato.
//
// POR QUE NÃO O SDK DO SENTRY AQUI: cada function é empacotada sozinha; somar o SDK a
// ~15 delas engorda o bundle e o cold start, e ainda exigiria uma env nova. O projeto já
// tem o lugar certo para isso — a tabela `advbox_api_log`, que é o console da aba
// Monitor, onde o Paulo já procura quando algo dá errado. Este wrapper leva o erro para
// lá, com contexto, sem dependência nova.
//
// USO:
//   export default comCaptura('asaas-webhook', async (req) => { ... });
//
// O handler continua igual; o wrapper só entra em cena quando ele LANÇA.
import { logAdvbox, heartbeat } from './botDb.mjs';

/**
 * @param {string} nome identificador curto da function (aparece no Monitor)
 * @param {(req: Request, ctx?: unknown) => Promise<Response>} handler
 * @param {{origem?: string, heartbeatEmFalha?: boolean}} [opts]
 *   origem: categoria no console do Monitor (default 'function')
 *   heartbeatEmFalha: também marca o cron como falho (use em functions agendadas)
 */
export function comCaptura(nome, handler, opts = {}) {
  const origem = opts.origem || 'function';
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      const msg = String(e?.message || e);
      // Contexto mínimo para reproduzir: método, caminho e a pilha resumida. Nunca o
      // corpo da requisição — ele costuma trazer CPF, nome e telefone de cliente.
      const contexto = {
        function: nome,
        metodo: req?.method || '?',
        caminho: (() => { try { return new URL(req.url).pathname; } catch { return '?'; } })(),
        stack: String(e?.stack || '').split('\n').slice(0, 4).join(' | ').slice(0, 500),
      };
      await logAdvbox(origem, 'erro', `[${nome}] falhou: ${msg}`.slice(0, 300), contexto).catch(() => {});
      if (opts.heartbeatEmFalha) await heartbeat(nome, false, msg.slice(0, 200)).catch(() => {});

      // Resposta genérica: detalhe técnico fica no Monitor, não vai para quem chamou
      // (item 42 — mensagens de erro cruas entregam nome de tabela e caminho de arquivo).
      return new Response(JSON.stringify({ ok: false, error: 'erro interno' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
  };
}
