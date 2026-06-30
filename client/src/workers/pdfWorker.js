// ============================================================
//  Web Worker — composicao de PDF com jspdf fora do main thread
// ============================================================
//
//  Objetivo: offload da composicao final de PDF (jspdf.addImage
//  + output('blob')) para nao travar a UI durante renderizacao
//  de contratos grandes.
//
//  LIMITE IMPORTANTE: `html2canvas` NAO PODE rodar aqui porque
//  depende de DOM, getComputedStyle e fonts. Por isso, o main
//  thread renderiza o canvas via html2canvas e envia apenas o
//  dataUrl / metadados dimensionais para este worker. O worker
//  se encarrega da montagem final do PDF.
//
//  Formato de mensagem:
//    { images: [{ dataUrl, x?, y?, width, height, pageBreak }...],
//      options: { orientation, unit, format, ... }  // params jsPDF }
//
//  Resposta:
//    { success: true, blob }   ou   { success: false, error }
//
//  Ativacao: este worker e um proof-of-concept. Veja
//  `pdfWorkerClient.js` para o helper de uso e
//  `pdfGenerator.js` para o ponto de integracao (atualmente
//  nao cabledo para evitar quebrar a progress bar implementada
//  na Fase 1 — explicacao completa no final de pdfGenerator.js).
//
// ============================================================

import { jsPDF } from 'jspdf';

self.onmessage = async (e) => {
  const { images, options } = e.data || {};
  try {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Nenhuma imagem enviada para o worker');
    }

    // Defaults compativeis com o pdfGenerator.js atual (A4 retrato em mm)
    const pdfOpts = {
      orientation: 'p',
      unit: 'mm',
      format: 'a4',
      ...(options || {}),
    };
    const pdf = new jsPDF(pdfOpts);

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      // Adiciona pagina antes de cada imagem exceto a primeira,
      // a menos que o chamador ja tenha pedido pageBreak explicito
      if (i > 0 && img.pageBreak !== false) {
        pdf.addPage();
      }
      const format = img.format || 'JPEG';
      const x = typeof img.x === 'number' ? img.x : 0;
      const y = typeof img.y === 'number' ? img.y : 0;
      pdf.addImage(img.dataUrl, format, x, y, img.width, img.height);
    }

    const blob = pdf.output('blob');
    const base64 = pdf.output('datauristring').split(',')[1];

    self.postMessage({
      success: true,
      blob,
      base64,
      pageCount: images.length,
    });
  } catch (err) {
    self.postMessage({
      success: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
