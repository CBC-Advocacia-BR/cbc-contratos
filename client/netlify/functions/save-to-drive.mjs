/**
 * Netlify Function: Complete flow — download signed PDF from ZapSign,
 * split into contract + procuração, upload both to Google Drive via Apps Script.
 * Handles Google's 302 redirect manually.
 *
 * v6.2.0 (2026-04-24): error categorization + structured error responses
 * to enable robust retry logic on the client side.
 */

import { PDFDocument } from 'pdf-lib';

// (integ-12) URL do Apps Script via env, com a URL atual como fallback (nao quebra ate a env ser configurada)
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzEzt-t_GDTbUKrzxTLkdOMqYS0Hz_PWcYt7uBcbj7yoKqKdUr89So8gRmsVwhT0cpI5Q/exec';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Categoriza um erro para permitir decisao de retry no client.
 * Codigos deterministicos (FOLDER_NOT_FOUND, NO_PERMISSION, ZAPSIGN_ERROR)
 * nao valem retentar automaticamente — precisam intervencao humana.
 */
function categorizeError(err, context) {
  const msg = (err?.message || String(err || '')).toLowerCase();
  if (msg.includes('no item with the given id') || msg.includes('file not found') || msg.includes('folder not found')) {
    return 'FOLDER_NOT_FOUND';
  }
  if (msg.includes('permission') || msg.includes('access') || msg.includes('403')) {
    return 'NO_PERMISSION';
  }
  if (msg.includes('pdf') || msg.includes('invalid pdf')) {
    return 'PDF_ERROR';
  }
  if (context === 'zapsign' || msg.includes('zapsign') || msg.includes('404')) {
    return 'ZAPSIGN_ERROR';
  }
  if (msg.includes('timeout') || msg.includes('abort')) {
    return 'TIMEOUT';
  }
  return 'GENERIC';
}

function errorResponse(err, ctx, status = 500) {
  const errMsg = err?.message || String(err || 'Erro desconhecido');
  return new Response(JSON.stringify({
    error: errMsg,
    error_code: categorizeError(err, ctx),
    error_context: ctx,
  }), { status, headers: CORS });
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function extractFolderId(driveUrl) {
  if (!driveUrl) return null;
  const match = driveUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function splitPdfWithReport(pdfBytes, contractPages, originalTotalPages) {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const signedTotalPages = srcDoc.getPageCount();

  const reportStartPage = originalTotalPages;
  const reportIndices = signedTotalPages > originalTotalPages
    ? Array.from({ length: signedTotalPages - originalTotalPages }, (_, i) => i + reportStartPage)
    : [];

  const procStartPage = contractPages;
  const procEndPage = originalTotalPages;

  // Contract + report
  const contractDoc = await PDFDocument.create();
  const contractIndices = Array.from({ length: Math.min(contractPages, signedTotalPages) }, (_, i) => i);
  const copiedContract = await contractDoc.copyPages(srcDoc, [...contractIndices, ...reportIndices]);
  copiedContract.forEach(p => contractDoc.addPage(p));

  // Procuração + report
  let procBase64 = null;
  if (procStartPage < procEndPage) {
    const procDoc = await PDFDocument.create();
    const procIndices = Array.from({ length: procEndPage - procStartPage }, (_, i) => i + procStartPage);
    const copiedProc = await procDoc.copyPages(srcDoc, [...procIndices, ...reportIndices]);
    copiedProc.forEach(p => procDoc.addPage(p));
    procBase64 = bufferToBase64(await procDoc.save());
  }

  return {
    contractBase64: bufferToBase64(await contractDoc.save()),
    procuracaoBase64: procBase64,
  };
}

/**
 * Call Google Apps Script handling the 302 redirect manually.
 * Step 1: POST to script.google.com → get 302 redirect URL
 * Step 2: GET the redirect URL → get the JSON response
 */
async function callAppsScriptOnce(payload) {
  // Step 1: POST — get redirect URL
  const postResp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
    redirect: 'manual', // Don't follow automatically
  });

  if (postResp.status === 302 || postResp.status === 301) {
    const redirectUrl = postResp.headers.get('location');
    if (!redirectUrl) throw new Error('Apps Script redirect sem URL');

    // Step 2: GET the redirect URL
    const getResp = await fetch(redirectUrl, { redirect: 'follow' });
    const text = await getResp.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Apps Script resposta invalida: ' + text.substring(0, 300));
    }
  }

  // (integ-12) sinaliza erro temporario (5xx) para o retry decidir se retenta
  if (postResp.status >= 500) {
    const text = await postResp.text();
    const e = new Error('Apps Script erro (HTTP ' + postResp.status + '): ' + text.substring(0, 300));
    e.transient = true;
    throw e;
  }

  // No redirect — try to parse directly
  const text = await postResp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Apps Script erro (HTTP ' + postResp.status + '): ' + text.substring(0, 300));
  }
}

/**
 * (integ-12) Wrapper com 1-2 retentativas para erros temporarios do Apps Script
 * (5xx / rede / timeout). Esperas crescentes: 2s depois 5s. Erros nao-transitorios
 * (resposta JSON invalida, 4xx) nao retentam.
 */
async function callAppsScript(payload) {
  const delays = [2000, 5000]; // 1a retentativa apos 2s, 2a apos 5s
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await callAppsScriptOnce(payload);
    } catch (err) {
      lastErr = err;
      // so retenta erro temporario marcado ou falha de rede (fetch lanca TypeError)
      const isTransient = err?.transient === true || err?.name === 'TypeError'
        || /timeout|abort|network|fetch failed|ECONN|ETIMEDOUT/i.test(err?.message || '');
      if (!isTransient || attempt === delays.length) throw err;
      console.warn('(integ-12) Apps Script falha temporaria, retentando em ' + delays[attempt] + 'ms:', err?.message);
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return errorResponse(new Error('Body JSON invalido'), 'generic', 400);
  }

  const { signedFileUrl, driveFolderUrl, pageSplit, procDocxBase64, contratoDocxBase64, docxBase64 } = payload || {};

  if (!signedFileUrl) {
    return new Response(JSON.stringify({
      error: 'signedFileUrl required',
      error_code: 'GENERIC',
      error_context: 'generic',
    }), { status: 400, headers: CORS });
  }

  // 1. Download signed PDF from ZapSign
  let pdfBytes;
  try {
    const pdfResp = await fetch(signedFileUrl);
    if (!pdfResp.ok) {
      throw new Error('Falha ao baixar PDF assinado do ZapSign (HTTP ' + pdfResp.status + ')');
    }
    pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());
  } catch (err) {
    return errorResponse(err, 'zapsign');
  }

  // 2. Split PDF
  let files = [];
  try {
    if (pageSplit && pageSplit.contractPages > 0 && pageSplit.totalPages > 0) {
      const { contractBase64, procuracaoBase64 } = await splitPdfWithReport(
        pdfBytes, pageSplit.contractPages, pageSplit.totalPages
      );
      files.push({ name: 'CONTRATO DE HONORÁRIOS ASSINADO.pdf', base64: contractBase64 });
      if (procuracaoBase64) {
        files.push({ name: 'PROCURAÇÃO ASSINADA.pdf', base64: procuracaoBase64 });
      }
    } else {
      files.push({ name: 'CONTRATO DE HONORÁRIOS ASSINADO.pdf', base64: bufferToBase64(pdfBytes) });
    }
  } catch (err) {
    return errorResponse(err, 'pdf');
  }

  // 3. Add DOCX files (nao critico — se falhar, segue sem eles)
  try {
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (contratoDocxBase64) {
      files.push({ name: 'CONTRATO DE HONORÁRIOS ASSINADO.docx', base64: contratoDocxBase64, mimeType: docxMime });
    }
    const procDocx = procDocxBase64 || docxBase64; // backwards compat
    if (procDocx) {
      files.push({ name: 'PROCURAÇÃO ASSINADA.docx', base64: procDocx, mimeType: docxMime });
    }
  } catch (err) {
    // Log mas nao aborta — DOCX eh bonus
    console.error('DOCX attach error (nao fatal):', err);
  }

  // 4. If driveFolderUrl provided, upload to Google Drive
  if (driveFolderUrl) {
    const folderId = extractFolderId(driveFolderUrl);
    if (!folderId) {
      return new Response(JSON.stringify({
        error: 'Folder ID invalido no link: ' + driveFolderUrl,
        error_code: 'FOLDER_NOT_FOUND',
        error_context: 'generic',
      }), { status: 400, headers: CORS });
    }

    let gasResult;
    try {
      gasResult = await callAppsScript({ folderId, files });
    } catch (err) {
      return errorResponse(err, 'apps_script');
    }

    if (!gasResult?.success) {
      const gasErr = new Error(gasResult?.error || 'Erro no Google Drive');
      return errorResponse(gasErr, 'apps_script');
    }

    return new Response(JSON.stringify({ success: true, files: gasResult.files }), { status: 200, headers: CORS });
  }

  // No Drive URL — just return split files as base64 (for download)
  return new Response(JSON.stringify({ success: true, files }), { status: 200, headers: CORS });
};

export const config = { path: '/.netlify/functions/save-to-drive' };
