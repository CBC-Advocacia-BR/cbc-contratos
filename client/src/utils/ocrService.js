// Import dinâmico de tesseract.js (lazy) — carrega só na 1ª chamada de OCR (#112)
let _tesseractModule = null;
async function loadTesseract() {
  if (!_tesseractModule) {
    const mod = await import('tesseract.js');
    _tesseractModule = mod.default || mod;
  }
  return _tesseractModule;
}

/**
 * Extract text from image/PDF file using Tesseract.js in the browser
 *
 * @param {File} file — arquivo (imagem ou PDF)
 * @param {Object} [opts] — opcoes
 * @param {(progress: { phase: 'upload'|'pdf'|'ocr', value: number, label: string }) => void} [opts.onProgress]
 *        — callback para progresso granular (0-100)
 */
export async function extractTextFromFile(file, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  let imageSource = file;

  // Fase 1: leitura do arquivo (simulado com FileReader para indicar progresso visual)
  onProgress({ phase: 'upload', value: 0, label: 'Lendo arquivo...' });
  try {
    await readFileWithProgress(file, (pct) => {
      onProgress({ phase: 'upload', value: pct, label: 'Lendo arquivo...' });
    });
  } catch {
    // Se falhar a leitura com progresso, prosseguir normalmente
  }
  onProgress({ phase: 'upload', value: 100, label: 'Arquivo carregado' });

  // Fase 2: conversao PDF -> imagem se necessario
  if (file.type === 'application/pdf') {
    onProgress({ phase: 'pdf', value: 0, label: 'Processando PDF...' });
    imageSource = await pdfToImage(file);
    onProgress({ phase: 'pdf', value: 100, label: 'PDF convertido' });
  }

  // Fase 3: OCR com logger do Tesseract para progresso real
  onProgress({ phase: 'ocr', value: 0, label: 'Reconhecendo texto...' });
  const Tesseract = await loadTesseract();
  const { data } = await Tesseract.recognize(imageSource, 'por', {
    logger: (m) => {
      // Tesseract emite { status: 'recognizing text', progress: 0..1 }
      if (m && typeof m.progress === 'number') {
        const pct = Math.round(m.progress * 100);
        const label = m.status === 'recognizing text'
          ? 'Reconhecendo texto...'
          : m.status === 'loading tesseract core'
            ? 'Carregando motor OCR...'
            : m.status === 'initializing tesseract'
              ? 'Inicializando OCR...'
              : m.status === 'loading language traineddata'
                ? 'Carregando idioma...'
                : m.status === 'initializing api'
                  ? 'Preparando OCR...'
                  : 'Processando OCR...';
        onProgress({ phase: 'ocr', value: pct, label });
      }
    },
  });
  onProgress({ phase: 'ocr', value: 100, label: 'Texto reconhecido' });

  return parseCNHText(data.text);
}

// Le o arquivo em chunks para reportar progresso (retorna ArrayBuffer mas nao usa)
// A ideia e dar feedback visual durante o carregamento inicial.
function readFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        try { onProgress(pct); } catch { /* best-effort */ }
      }
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Erro ao ler arquivo'));
    try { reader.readAsArrayBuffer(file); } catch (e) { reject(e); }
  });
}

/**
 * Convert first page of PDF to image blob
 */
async function pdfToImage(file) {
  // Use PDF.js via CDN if available, otherwise read as data URL
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Try loading pdfjs
  if (!window.pdfjsLib) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    document.head.appendChild(script);
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const pdf = await window.pdfjsLib.getDocument({ data: uint8Array }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}

/**
 * Parse CNH text to extract fields
 */
function parseCNHText(rawText) {
  const text = rawText.toUpperCase();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result = {};

  // Nome - usually after "NOME" or first long capitalized line
  const nomeMatch = text.match(/NOME\s*[:-]?\s*([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇ\s]{5,})/);
  if (nomeMatch) result.nome = cleanName(nomeMatch[1]);

  // CPF
  const cpfMatch = text.match(/(\d{3}[.\s]?\d{3}[.\s]?\d{3}[\s-]?\d{2})/);
  if (cpfMatch) result.cpf = cpfMatch[1].replace(/\s/g, '');

  // RG / Doc Identidade
  const rgMatch = text.match(/(?:DOC\.?\s*IDENTIDADE|RG|IDENTIDADE)\s*[:-]?\s*([\d.-]+)/);
  if (rgMatch) result.rg = rgMatch[1];

  // Data Nascimento
  const nascMatch = text.match(/(?:NASC|NASCIMENTO|DATA\s*NASC)\s*[:-]?\s*(\d{2}[/-]\d{2}[/-]\d{4})/);
  if (nascMatch) result.nascimento = nascMatch[1];

  // Filiação (nome da mãe/pai)
  const filiacaoMatch = text.match(/(?:FILIA[ÇC][ÃA]O|M[ÃA]E)\s*[:-]?\s*([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇ\s]{5,})/);
  if (filiacaoMatch) result.filiacao = cleanName(filiacaoMatch[1]);

  // If no nome found, try to find longest name-like string
  if (!result.nome) {
    for (const line of lines) {
      if (/^[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇ\s]{10,}$/.test(line) && !/HABILITACAO|REPUBLICA|NACIONAL|DETRAN|CATEGORIA/.test(line)) {
        result.nome = cleanName(line);
        break;
      }
    }
  }

  return result;
}

function cleanName(name) {
  return name.replace(/\s+/g, ' ').trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
