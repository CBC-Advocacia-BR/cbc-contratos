import * as Sentry from '@sentry/react';

// (auditoria #59) Wrapper unico para reportar erro ao Sentry sem repetir o
// try/catch em volta do proprio Sentry em todo canto. SEMPRE loga no console
// tambem (visivel em dev) e NUNCA lanca. O Sentry so envia de fato se estiver
// inicializado (VITE_SENTRY_DSN em producao — ver main.jsx); caso contrario e no-op.
//
// Uso: catch (e) { reportErro('advbox-sync', e, { contractId: c.id }); }
export function reportErro(area, err, extra) {
  try { console.error(`[${area}]`, err, extra ?? ''); } catch { /* ignora */ }
  try {
    const e = err instanceof Error ? err : new Error(String((err && err.message) || err || 'erro desconhecido'));
    Sentry.captureException(e, { tags: { area }, extra });
  } catch { /* sentry opcional — nunca derruba o fluxo */ }
}
