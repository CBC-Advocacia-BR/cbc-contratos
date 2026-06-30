// Imports dinâmicos de html2canvas e jspdf (lazy) — carregam somente ao gerar PDF (#112)
//
// ============================================================
//  Web Worker PDF (#114) — INTEGRADO
// ============================================================
//  Arquivos envolvidos:
//    - src/workers/pdfWorker.js       (Worker que roda jspdf fora do main thread)
//    - src/utils/pdfWorkerClient.js   (helper `composePdfInWorker`)
//
//  Fluxo (quando o Worker esta disponivel):
//    1. html2canvas roda no MAIN thread (precisa de DOM)
//    2. O canvas e convertido em dataUrl e dimensoes sao calculadas
//    3. A composicao jspdf (addImage + output('blob')) acontece no
//       Web Worker — libera o main thread para animacoes da UI
//    4. Se o Worker falhar ou nao for suportado, segue fallback sincrono
//       com jspdf no main thread (comportamento anterior preservado)
//
//  Progress bar preservada: a fase 'compose' agora reporta progresso
//  granular pela faixa de 70-90% enquanto o worker trabalha.
//
//  Vite ja suporta Workers com `new URL(..., import.meta.url)` — testado
//  com o build atual. Nao e preciso alterar vite.config.js.
// ============================================================

let _html2canvas = null;
let _jsPDF = null;

// Contador de geracoes de PDF em andamento. Usado para varrer com seguranca
// os <iframe> de clone que o html2canvas (1.4.1) deixa orfaos quando a
// renderizacao LANCA — a lib so remove esse iframe no caminho de sucesso
// (sem try/finally). So varremos quando nao ha nenhuma geracao ativa, para
// nao apagar o iframe de uma geracao concorrente ainda em uso (LivePreview
// pode disparar geracoes sobrepostas: debounce 700ms + troca de aba).
let _activeGenerations = 0;

async function loadPdfLibs() {
  if (!_html2canvas || !_jsPDF) {
    const [h2cMod, jsPdfMod] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    _html2canvas = h2cMod.default || h2cMod;
    _jsPDF = jsPdfMod.jsPDF || jsPdfMod.default?.jsPDF || jsPdfMod.default;
  }
  return { html2canvas: _html2canvas, jsPDF: _jsPDF };
}

const A4_PAGE_HEIGHT_PX = Math.round(794 * (297 / 210)); // ~1122px for container width 794

/**
 * Push elements past page boundaries so text is never cut.
 * Runs iteratively until no element straddles a page boundary.
 */
async function avoidPageBreaks(container) {
  let changed = true;
  let maxIter = 30;

  while (changed && maxIter-- > 0) {
    changed = false;
    await new Promise(r => requestAnimationFrame(r));

    const containerTop = container.getBoundingClientRect().top;

    // Check all paragraphs, divs, tables — any block element
    const elements = container.querySelectorAll('p, div, table, tr, h1, h2, h3, h4, .no-page-break');

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      const top = rect.top - containerTop;
      const bottom = rect.bottom - containerTop;
      const height = bottom - top;

      // Skip very large elements (>80% of page) or tiny ones
      if (height > A4_PAGE_HEIGHT_PX * 0.8 || height < 10) continue;

      const pageOfTop = Math.floor(top / A4_PAGE_HEIGHT_PX);
      const pageOfBottom = Math.floor((bottom - 1) / A4_PAGE_HEIGHT_PX);

      if (pageOfBottom > pageOfTop) {
        // Element crosses a page boundary — push it to next page
        const nextPageTop = (pageOfTop + 1) * A4_PAGE_HEIGHT_PX;
        const pushNeeded = nextPageTop - top + 2;
        const current = parseFloat(el.style.marginTop || '0');
        el.style.marginTop = (current + pushNeeded) + 'px';
        changed = true;
        break; // Restart after each change
      }
    }
  }
}

/**
 * Generates a PDF from HTML string.
 * Uses html2canvas + avoidPageBreaks to prevent text cutting.
 * Returns { blob, base64, pageCount }
 *
 * @param {string} htmlContent
 * @param {Object} [opts]
 * @param {(p: { phase: string, value: number, label: string }) => void} [opts.onProgress]
 *   — (#97) callback opcional para reportar progresso granular (0-100)
 */
export async function generatePdfFromHtml(htmlContent, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  onProgress({ phase: 'prepare', value: 5, label: 'Preparando documento...' });
  const { html2canvas, jsPDF } = await loadPdfLibs();

  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; left: -9999px; top: 0;
    width: 794px;
    background: white;
    font-family: 'Times New Roman', Times, serif;
    font-size: 11.5pt;
    line-height: 1.6;
    padding: 60px 70px 30px 70px;
    box-sizing: border-box;
  `;
  container.innerHTML = htmlContent;
  document.body.appendChild(container);
  _activeGenerations++;

  try {
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 300));

    // Push elements away from page cuts
    onProgress({ phase: 'layout', value: 25, label: 'Ajustando layout...' });
    await avoidPageBreaks(container);
    await new Promise(r => setTimeout(r, 100));
    onProgress({ phase: 'render', value: 45, label: 'Renderizando paginas...' });

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: 794,
      windowWidth: 794,
    });
    onProgress({ phase: 'compose', value: 65, label: 'Gerando PDF...' });

    // Calcula dimensoes A4 (mm) baseadas no canvas renderizado
    // Usamos um jsPDF provisorio apenas para descobrir o tamanho da pagina;
    // no caminho do worker o PDF real e construido la.
    const tmpPdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = tmpPdf.internal.pageSize.getWidth();
    const pdfHeight = tmpPdf.internal.pageSize.getHeight();

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;

    // Calcula numero de paginas e monta o array de "imagens" reaproveitaveis.
    // Cada item representa a MESMA imagem com offset vertical diferente —
    // jspdf faz o clipping pela area visivel da pagina A4.
    const images = [];
    let heightLeft = imgHeight;
    let position = 0;
    while (heightLeft > 2) {
      images.push({
        dataUrl: imgData,
        format: 'JPEG',
        x: 0,
        y: position,
        width: imgWidth,
        height: imgHeight,
      });
      heightLeft -= pdfHeight;
      position -= pdfHeight;
    }
    const pageCount = images.length || 1;

    let blob = null;
    let base64 = null;

    // Tenta offload no Web Worker. Se falhar, fallback sincrono no main thread.
    let usedWorker = false;
    try {
      const { composePdfInWorker, isPdfWorkerSupported } = await import('./pdfWorkerClient');
      if (isPdfWorkerSupported()) {
        onProgress({ phase: 'compose', value: 72, label: 'Compondo PDF (worker)...' });
        const result = await composePdfInWorker(images, {
          orientation: 'p',
          unit: 'mm',
          format: 'a4',
        });
        blob = result.blob;
        base64 = result.base64;
        usedWorker = true;
        onProgress({ phase: 'compose', value: 90, label: 'PDF composto...' });
      } else {
        throw new Error('worker unsupported');
      }
    } catch (err) {
      // Fallback silencioso: jspdf sincrono no main thread
      if (err && err.message !== 'worker unsupported') {
        console.warn('[pdf] Worker falhou, usando main thread:', err.message);
      }
      const pdf = new jsPDF('p', 'mm', 'a4');
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (i > 0) pdf.addPage();
        pdf.addImage(img.dataUrl, img.format, img.x, img.y, img.width, img.height);
      }
      blob = pdf.output('blob');
      base64 = pdf.output('datauristring').split(',')[1];
    }

    onProgress({
      phase: 'save',
      value: 95,
      label: usedWorker ? 'Finalizando (worker)...' : 'Finalizando...',
    });
    onProgress({ phase: 'done', value: 100, label: 'PDF gerado' });
    return { blob, base64, pageCount };
  } finally {
    // Remocao idempotente do nosso container: .remove() nunca lanca, mesmo
    // que o no ja tenha sido desanexado (evita NotFoundError do removeChild).
    container.remove();
    _activeGenerations--;
    // html2canvas so remove seu <iframe class="html2canvas-container"> no
    // caminho de sucesso; se a renderizacao lancou, ele fica orfao no body.
    // Quando nao ha mais nenhuma geracao em andamento, e seguro varrer os
    // clones remanescentes (nenhum esta legitimamente em uso).
    if (_activeGenerations <= 0) {
      _activeGenerations = 0;
      document.querySelectorAll('iframe.html2canvas-container').forEach((f) => f.remove());
    }
  }
}

/**
 * Generate PDF and return as downloadable blob URL
 */
export async function generatePdfBlobUrl(htmlContent) {
  const { blob } = await generatePdfFromHtml(htmlContent);
  return URL.createObjectURL(blob);
}

/**
 * Generate PDF and trigger download
 * @param {string} htmlContent
 * @param {string} filename
 * @param {Object} [opts] — { onProgress } (#97)
 */
export async function downloadPdf(htmlContent, filename = 'contrato.pdf', opts = {}) {
  const { blob } = await generatePdfFromHtml(htmlContent, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/**
 * Generate PDF and return pure base64 (for ZapSign)
 */
export async function generatePdfBase64(htmlContent) {
  const { base64 } = await generatePdfFromHtml(htmlContent);
  return base64;
}

/**
 * Generate combined PDF: contract + procuração rendered SEPARATELY.
 *
 * @param {string} contractHtml
 * @param {string} procuracaoHtml
 * @param {Object} [opts]
 * @param {(p: { phase: string, value: number, label: string }) => void} [opts.onProgress]
 *   — (#97) reporta progresso combinado: contrato 0-45%, procuracao 45-85%, merge 85-100%
 */
export async function generateFullPdfWithSplit(contractHtml, procuracaoHtml, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  onProgress({ phase: 'contract', value: 0, label: 'Gerando contrato...' });
  const contractResult = await generatePdfFromHtml(contractHtml, {
    onProgress: (p) => onProgress({ phase: 'contract', value: Math.round(p.value * 0.45), label: p.label }),
  });
  onProgress({ phase: 'procuracao', value: 45, label: 'Gerando procuracao...' });
  const procResult = await generatePdfFromHtml(procuracaoHtml, {
    onProgress: (p) => onProgress({ phase: 'procuracao', value: 45 + Math.round(p.value * 0.4), label: p.label }),
  });

  onProgress({ phase: 'merge', value: 85, label: 'Combinando PDFs...' });
  // Merge using pdf-lib
  const { PDFDocument } = await import('pdf-lib');
  const mergedPdf = await PDFDocument.create();

  const contractDoc = await PDFDocument.load(await contractResult.blob.arrayBuffer());
  const procDoc = await PDFDocument.load(await procResult.blob.arrayBuffer());

  const cPages = await mergedPdf.copyPages(contractDoc, contractDoc.getPageIndices());
  cPages.forEach(p => mergedPdf.addPage(p));

  const pPages = await mergedPdf.copyPages(procDoc, procDoc.getPageIndices());
  pPages.forEach(p => mergedPdf.addPage(p));

  const mergedBytes = await mergedPdf.save();
  const mergedBlob = new Blob([mergedBytes], { type: 'application/pdf' });
  onProgress({ phase: 'save', value: 97, label: 'Finalizando...' });

  const reader = new FileReader();
  const base64 = await new Promise(resolve => {
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(mergedBlob);
  });
  onProgress({ phase: 'done', value: 100, label: 'Completo' });

  return {
    base64,
    blob: mergedBlob,
    pageCount: contractResult.pageCount + procResult.pageCount,
    contractPages: contractResult.pageCount,
    procuracaoStartPage: contractResult.pageCount + 1,
  };
}
