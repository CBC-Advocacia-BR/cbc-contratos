// Conversão de petição para PDF.
//
// Preferência: enviar o DOCX para o backend (LibreOffice headless) e
// receber o PDF de volta. Fallback: gerar PDF direto a partir do HTML
// de pré-visualização via window.print().

import { API_URL } from '../../config';

export async function convertDocxToPdf(blob) {
  try {
    const form = new FormData();
    form.append('file', blob, 'peticao.docx');
    const r = await fetch(`${API_URL}/api/teses/docx-to-pdf`, { method: 'POST', body: form });
    if (!r.ok) throw new Error('backend indisponível');
    return await r.blob();
  } catch {
    return null;
  }
}

/** Abre a janela de impressão com o HTML dado — usuário escolhe "Salvar como PDF". */
export function printHtmlAsPdf(html, title = 'Petição CBC') {
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
    <title>${title}</title>
    <style>
      @page { size: A4; margin: 3cm 2cm; }
      body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; text-align: justify; }
      h1,h2,h3 { text-transform: uppercase; }
      .bloco-titulo { font-weight: 700; text-transform: uppercase; margin-top: 1.2em; }
    </style>
  </head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch { /* usuário cancelou ou bloqueio de popup */ }
  }, 400);
}
