// Builder puro do HTML do relatorio "Contratos assinados" (PDF do Dashboard).
// Recebe linhas ja filtradas/ordenadas e devolve uma string HTML pronta para o
// generatePdfFromHtml/downloadPdf (pdfGenerator.js). Mantido puro (sem React,
// sem DOM, sem fetch) para ser facilmente testavel em isolamento.
//
// Layout em <table> de proposito: o html2canvas (1.4.1) renderiza tabelas de
// forma muito mais previsivel que flexbox, e o avoidPageBreaks do pdfGenerator
// ja empurra <tr> que cruzam o limite de pagina (linhas nunca sao cortadas).

const NAVY = '#1B3A5C';
const GOLD = '#C9A84C';
const ZEBRA = '#F2F5F8';
const BORDER = '#E4EAF0';

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtData(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR');
}

// rows: [{ nome, cidade, uf, signed }] — signed = Date | string | null
// opts: { inicioLabel, fimLabel, geradoEm }
export function buildAssinadosReportHtml(rows, opts = {}) {
  const lista = Array.isArray(rows) ? rows : [];
  const total = lista.length;

  const inicioLabel = opts.inicioLabel || null;
  const fimLabel = opts.fimLabel || null;
  let periodoTxt;
  if (inicioLabel && fimLabel) periodoTxt = `${inicioLabel} a ${fimLabel}`;
  else if (inicioLabel) periodoTxt = `a partir de ${inicioLabel}`;
  else if (fimLabel) periodoTxt = `até ${fimLabel}`;
  else periodoTxt = 'todo o período';

  const geradoEm = opts.geradoEm instanceof Date ? opts.geradoEm : new Date();
  const geradoTxt = `${geradoEm.toLocaleDateString('pt-BR')} às ${geradoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  const linhasHtml = lista.map((r, i) => {
    const cidade = r.cidade ? escapeHtml(r.cidade) : '';
    const uf = r.uf ? escapeHtml(String(r.uf).toUpperCase()) : '';
    const cidadeUf = cidade ? `${cidade}${uf ? '/' + uf : ''}` : '—';
    const nome = escapeHtml(r.nome) || '—';
    const zebra = i % 2 === 1 ? `background:${ZEBRA};` : '';
    return `<tr style="${zebra}">`
      + `<td style="padding:7px 10px;color:#8A97A6;border-bottom:1px solid ${BORDER};width:38px;">${i + 1}</td>`
      + `<td style="padding:7px 10px;color:#1B1B1B;border-bottom:1px solid ${BORDER};">${nome}</td>`
      + `<td style="padding:7px 10px;color:#444444;border-bottom:1px solid ${BORDER};">${cidadeUf}</td>`
      + `<td style="padding:7px 10px;color:${NAVY};font-weight:bold;text-align:right;white-space:nowrap;border-bottom:1px solid ${BORDER};">${fmtData(r.signed)}</td>`
      + `</tr>`;
  }).join('');

  const corpo = total > 0
    ? `<table style="width:100%;border-collapse:collapse;font-size:11pt;">`
        + `<thead><tr style="background:${NAVY};">`
          + `<th style="text-align:left;color:#ffffff;font-weight:bold;padding:9px 10px;font-size:9.5pt;letter-spacing:0.5px;">#</th>`
          + `<th style="text-align:left;color:#ffffff;font-weight:bold;padding:9px 10px;font-size:9.5pt;letter-spacing:0.5px;">CLIENTE</th>`
          + `<th style="text-align:left;color:#ffffff;font-weight:bold;padding:9px 10px;font-size:9.5pt;letter-spacing:0.5px;">CIDADE/UF</th>`
          + `<th style="text-align:right;color:#ffffff;font-weight:bold;padding:9px 10px;font-size:9.5pt;letter-spacing:0.5px;">ASSINADO EM</th>`
        + `</tr></thead>`
        + `<tbody>${linhasHtml}</tbody>`
      + `</table>`
    : `<div style="padding:40px;text-align:center;color:#8A97A6;font-size:12pt;">Nenhum contrato assinado neste período.</div>`;

  return `<div style="font-family:'Lato','Helvetica Neue',Arial,sans-serif;color:#1B1B1B;">`
    + `<table style="width:100%;border-collapse:collapse;background:${NAVY};">`
      + `<tr>`
        + `<td style="padding:18px 22px;">`
          + `<div style="color:#ffffff;font-size:16pt;font-weight:bold;letter-spacing:0.5px;">CBC ADVOGADOS</div>`
          + `<div style="color:${GOLD};font-size:8pt;letter-spacing:3px;margin-top:3px;">RELATÓRIO INTERNO</div>`
        + `</td>`
        + `<td style="padding:18px 22px;text-align:right;vertical-align:middle;color:${GOLD};font-size:10pt;font-weight:bold;letter-spacing:1px;">CONTRATOS<br/>ASSINADOS</td>`
      + `</tr>`
    + `</table>`
    + `<div style="height:3px;background:${GOLD};"></div>`
    + `<div style="padding:18px 22px 6px;">`
      + `<div style="font-size:15pt;font-weight:bold;color:${NAVY};">Contratos assinados</div>`
      + `<div style="margin-top:8px;font-size:10.5pt;color:#5F5E5A;">`
        + `Período de assinatura: <strong style="color:${NAVY};">${escapeHtml(periodoTxt)}</strong>`
        + `&nbsp;&middot;&nbsp; Total: <strong style="color:${NAVY};">${total}</strong> contrato${total === 1 ? '' : 's'}`
      + `</div>`
    + `</div>`
    + `<div style="padding:10px 22px 0;">${corpo}</div>`
    + `<table style="width:100%;border-collapse:collapse;border-top:1px solid ${BORDER};margin-top:18px;">`
      + `<tr>`
        + `<td style="padding:10px 22px;font-size:8pt;color:#9AA7B8;">Gerado em ${escapeHtml(geradoTxt)} · CBC Contratos</td>`
        + `<td style="padding:10px 22px;font-size:8pt;color:#9AA7B8;text-align:right;">${total} registro${total === 1 ? '' : 's'}</td>`
      + `</tr>`
    + `</table>`
  + `</div>`;
}
