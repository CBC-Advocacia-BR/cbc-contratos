// (resilience 28/04) Wrapper para queries Supabase com timeout + notificacao
// automatica via CustomEvent. NAO migra queries existentes — introduz um utilitario
// para uso gradual quando arquivos forem mexidos.
//
// Uso:
//   import { safeQuery } from '../utils/supabaseSafe';
//   const { data, error, slow, timeout } = await safeQuery(
//     () => supabase.from('contratos').select('id, nome').limit(50)
//   );
//
// Eventos disparados:
//   window.dispatchEvent('cbc:supabase-degraded', { detail: { msg, ts } })
//   App.jsx escuta e mostra banner global por 30s.

const DEFAULT_TIMEOUT = 15000;
const SLOW_THRESHOLD = 5000;

let pendingNotify = null;

/**
 * Executa uma query Supabase com timeout configuravel + sinal de "lento".
 * Em caso de timeout, retorna { data: null, error: { code: 'TIMEOUT' }, timeout: true }
 * — nao lanca excecao, deixando o caller decidir como recuperar.
 */
export async function safeQuery(queryFn, opts = {}) {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const start = performance.now();
  let timedOut = false;

  const timer = new Promise((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error('TIMEOUT'));
    }, timeout);
  });

  try {
    const result = await Promise.race([queryFn(), timer]);
    const elapsed = performance.now() - start;
    if (elapsed > SLOW_THRESHOLD) {
      notifyDegraded(`Conexao lenta: ${Math.round(elapsed)}ms`);
    }
    return { ...result, slow: elapsed > SLOW_THRESHOLD, elapsed };
  } catch (err) {
    if (timedOut) {
      notifyDegraded('Supabase nao respondeu em ' + (timeout / 1000) + 's');
      return {
        data: null,
        error: { message: 'Timeout', code: 'TIMEOUT' },
        timeout: true,
        elapsed: performance.now() - start,
      };
    }
    throw err;
  }
}

/**
 * Dispara CustomEvent informando degradacao da conexao. Debounce de 100ms para
 * agrupar multiplas queries lentas em um unico banner.
 */
function notifyDegraded(msg) {
  if (pendingNotify) clearTimeout(pendingNotify);
  pendingNotify = setTimeout(() => {
    try {
      window.dispatchEvent(new CustomEvent('cbc:supabase-degraded', {
        detail: { msg, ts: Date.now() },
      }));
    } catch { /* SSR/test envs */ }
  }, 100);
}
