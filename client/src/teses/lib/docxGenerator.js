// Geração de DOCX via docx-js (client-side).
// Preserva formatação judicial padrão: Times New Roman 12, 1,5 de
// espaçamento, margens 3/2/3/2 cm (ABNT), justificado.
//
// O timbrado real será inserido posteriormente — por enquanto usamos
// um cabeçalho placeholder com o nome do escritório.

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer,
  PageNumber, LevelFormat, HeadingLevel, convertMillimetersToTwip,
} from 'docx';

const FONT = 'Times New Roman';
const FONT_SIZE = 24; // half-points → 12pt
const LINE = 360;     // twentieths → 1.5

// ~ 3 cm / 2 cm / 3 cm / 2 cm
const MARGINS = {
  top: convertMillimetersToTwip(30),
  bottom: convertMillimetersToTwip(20),
  left: convertMillimetersToTwip(30),
  right: convertMillimetersToTwip(20),
};

/** Converte texto simples com quebras de linha em array de Paragraph. */
function textToParagraphs(text, opts = {}) {
  const lines = String(text || '').split(/\r?\n/);
  return lines.map((line) =>
    new Paragraph({
      alignment: opts.alignment || AlignmentType.JUSTIFIED,
      spacing: { line: LINE, after: 120 },
      children: [new TextRun({ text: line, font: FONT, size: FONT_SIZE, bold: opts.bold })],
    })
  );
}

/** HTML → texto plano muito básico: remove tags e decodifica quebras. */
function htmlToPlain(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Monta o DOCX e retorna um Blob.
 *
 * @param {Object} params
 * @param {Object} params.model        — o modelo usado
 * @param {Array}  params.blocks       — blocos selecionados na ordem final (já com conteúdo preenchido)
 * @param {string} [params.title]      — título/referência opcional
 * @param {string} [params.office]     — nome do escritório para cabeçalho
 */
export async function generatePetitionDocx({ model, blocks, title, office }) {
  const officeName = office || 'Conforto, Bergonsi & Cavalari Advogados';

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: officeName, bold: true, font: FONT, size: 22 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'OAB/SP nº 55.227 — Americana/SP', font: FONT, size: 18 })],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], font: FONT, size: 18 }),
        ],
      }),
    ],
  });

  const children = [];

  // Cabeçalho fixo do modelo (endereçamento)
  if (model?.fixed_header) {
    children.push(...textToParagraphs(model.fixed_header, { alignment: AlignmentType.CENTER, bold: true }));
    children.push(new Paragraph({ children: [new TextRun({ text: '', font: FONT, size: FONT_SIZE })] }));
  }

  // Título / referência
  if (title) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: LINE, after: 240 },
      children: [new TextRun({ text: title, bold: true, font: FONT, size: FONT_SIZE })],
    }));
  }

  // Blocos na ordem
  for (const b of blocks) {
    if (b.title) {
      children.push(new Paragraph({
        spacing: { line: LINE, before: 240, after: 120 },
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: b.title.toUpperCase(), bold: true, font: FONT, size: FONT_SIZE })],
      }));
    }
    const plain = htmlToPlain(b.content);
    children.push(...textToParagraphs(plain));
  }

  // Rodapé fixo (pedidos, local/data, assinatura)
  if (model?.fixed_footer) {
    children.push(new Paragraph({ children: [new TextRun({ text: '', font: FONT, size: FONT_SIZE })] }));
    children.push(...textToParagraphs(model.fixed_footer));
  }

  const doc = new Document({
    creator: 'CBC TESES',
    title: title || model?.name || 'Petição',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: FONT_SIZE },
          paragraph: { spacing: { line: LINE } },
        },
      },
    },
    sections: [{
      properties: {
        page: { margin: MARGINS },
      },
      headers: { default: header },
      footers: { default: footer },
      children,
    }],
  });

  return await Packer.toBlob(doc);
}

/**
 * Dispara download de um Blob no browser.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
