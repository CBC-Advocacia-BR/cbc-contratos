// Importação de .docx para blocos do modelo.
//
// Usa a biblioteca `mammoth` para converter o Word em HTML preservando
// estrutura básica (parágrafos, headings, negrito, itálico, listas).
// Em seguida, segmentamos o HTML em blocos candidatos usando headings
// como delimitadores — o usuário depois ajusta manualmente.
//
// O carregamento do `mammoth` é dinâmico para não pesar o bundle
// principal (~500 KB) — só entra em cena quando o usuário clica em
// "Importar Word".

/**
 * Converte um ArrayBuffer de .docx em { html, messages }.
 */
export async function docxToHtml(arrayBuffer) {
  const mammothMod = await import('mammoth');
  const mammoth = mammothMod.default || mammothMod;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1",
        "p[style-name='Heading 2'] => h2",
        "p[style-name='Heading 3'] => h3",
        "p[style-name='Título 1'] => h1",
        "p[style-name='Título 2'] => h2",
        "p[style-name='Título 3'] => h3",
      ],
    }
  );
  return { html: result.value || '', messages: result.messages || [] };
}

/**
 * Segmenta o HTML em blocos candidatos usando headings como separadores.
 * Retorna um array de { title, content } — o conteúdo é HTML.
 */
export function segmentIntoBlocks(html) {
  if (!html) return [];
  // Adiciona marcadores antes de cada heading
  const parts = html.split(/(?=<h[1-3]\b)/gi).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    // Sem headings → devolve como bloco único
    return [{ title: 'Bloco único', content: html }];
  }
  return parts.map((part, i) => {
    const m = part.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const titleHtml = m ? m[1] : `Bloco ${i + 1}`;
    const title = titleHtml.replace(/<[^>]+>/g, '').trim().slice(0, 120) || `Bloco ${i + 1}`;
    const content = part.replace(/<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/i, '').trim();
    return { title, content: content || part };
  });
}

/**
 * Extrai candidatos a placeholder de um HTML: tudo o que está entre
 * colchetes ou sublinhados é sugerido como campo variável (comum em
 * petições-template: [NOME DO CLIENTE], ___________, etc.).
 */
export function suggestPlaceholders(html) {
  const plain = html.replace(/<[^>]+>/g, ' ');
  const out = new Set();
  const bracketRe = /\[([^\]]{2,60})\]/g;
  let m;
  while ((m = bracketRe.exec(plain)) !== null) {
    const k = m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (k) out.add(k);
  }
  return [...out];
}
