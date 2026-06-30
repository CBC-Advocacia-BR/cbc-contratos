// ============================================================
//  pdfWorkerClient — helper para usar o Worker de composicao PDF
// ============================================================
//
//  Uso:
//    import { composePdfInWorker } from './pdfWorkerClient';
//    const blob = await composePdfInWorker(images, options);
//
//  - Instancia o worker uma unica vez (modulo-level cache)
//  - Detecta suporte a Worker (fallback no-op se nao houver)
//  - Promessifica a comunicacao por mensagem com isolamento de
//    handler por chamada (evita race entre geracoes simultaneas)
//
//  IMPORTANTE: o Vite suporta Web Workers nativamente via
//  `new Worker(new URL('...', import.meta.url), { type: 'module' })`.
//  O bundling separa o chunk do worker automaticamente.
//
// ============================================================

let worker = null;
let workerSupported = null; // null = nao testado, true/false apos teste

function getWorker() {
  if (workerSupported === false) return null;
  if (worker) return worker;

  try {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      workerSupported = false;
      return null;
    }
    worker = new Worker(
      new URL('../workers/pdfWorker.js', import.meta.url),
      { type: 'module' }
    );
    workerSupported = true;
    return worker;
  } catch (err) {
    // Ambientes sem suporte (alguns iOS antigos, sandboxes etc.)
    console.warn('[pdfWorkerClient] Worker nao disponivel:', err.message);
    workerSupported = false;
    worker = null;
    return null;
  }
}

/**
 * Compoe um PDF em um Web Worker usando jspdf.
 *
 * @param {Array<{ dataUrl: string, width: number, height: number, x?: number, y?: number, format?: string, pageBreak?: boolean }>} images
 *   Cada elemento representa uma pagina (ou um pedaco a adicionar sem page break).
 * @param {Object} [options] Opcoes do construtor jsPDF (orientation, unit, format, ...)
 * @returns {Promise<{ blob: Blob, base64: string, pageCount: number }>}
 *
 * Lanca Error se o worker falhar ou nao estiver disponivel. Chamador
 * deve capturar e fazer fallback para geracao no main thread se desejado.
 */
export function composePdfInWorker(images, options = {}) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      reject(new Error('Web Worker nao suportado neste ambiente'));
      return;
    }

    // Handler isolado para esta chamada — remove-se apos receber resposta.
    // Isso evita que uma geracao antiga capture a resposta de uma nova.
    const handler = (e) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      const data = e.data || {};
      if (data.success) {
        resolve({
          blob: data.blob,
          base64: data.base64,
          pageCount: data.pageCount,
        });
      } else {
        reject(new Error(data.error || 'Erro desconhecido no worker de PDF'));
      }
    };

    const errorHandler = (err) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      reject(new Error('Erro no worker: ' + (err.message || err.toString())));
    };

    w.addEventListener('message', handler);
    w.addEventListener('error', errorHandler);
    w.postMessage({ images, options });
  });
}

/**
 * Retorna true se o Worker esta disponivel (testado ou ainda nao testado).
 * Util para decidir se vale a pena tentar chamar `composePdfInWorker`.
 */
export function isPdfWorkerSupported() {
  if (workerSupported === null) {
    // Trigger do teste sem criar o worker ainda
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      workerSupported = false;
      return false;
    }
    return true; // assume ate falhar na primeira chamada
  }
  return workerSupported;
}

/**
 * Termina o worker (libera memoria). Util em testes ou ao fazer
 * unmount completo da app. Em SPA normal nao precisa ser chamado.
 */
export function terminatePdfWorker() {
  if (worker) {
    try { worker.terminate(); } catch { /* ignora */ }
    worker = null;
  }
}
