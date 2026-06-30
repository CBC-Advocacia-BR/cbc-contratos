/**
 * save-to-drive-direct
 * Variante de save-to-drive sem dependencia do ZapSign.
 * Aceita arquivos ja em base64 + driveFolderUrl e faz upload via
 * Apps Script (mesmo POST -> 302 -> GET do save-to-drive existente).
 *
 * Use case: Importar contrato manualmente — usuario anexa PDFs ja
 * assinados off-line e queremos arquiva-los na pasta do Drive sem
 * passar pelo fluxo ZapSign.
 */

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzEzt-t_GDTbUKrzxTLkdOMqYS0Hz_PWcYt7uBcbj7yoKqKdUr89So8gRmsVwhT0cpI5Q/exec';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function extractFolderId(driveUrl) {
  if (!driveUrl) return null;
  const match = driveUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function callAppsScript(payload) {
  // Step 1: POST -> 302 redirect
  const postResp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
    redirect: 'manual',
  });

  if (postResp.status === 302 || postResp.status === 301) {
    const redirectUrl = postResp.headers.get('location');
    if (!redirectUrl) throw new Error('Apps Script redirect sem URL');
    const getResp = await fetch(redirectUrl, { redirect: 'follow' });
    const text = await getResp.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Apps Script resposta invalida: ' + text.substring(0, 300));
    }
  }

  const text = await postResp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'Apps Script erro (HTTP ' + postResp.status + '): ' + text.substring(0, 300)
    );
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Body JSON invalido' }), {
      status: 400,
      headers: CORS,
    });
  }

  const { driveFolderUrl, files } = payload || {};
  if (!driveFolderUrl) {
    return new Response(JSON.stringify({ error: 'driveFolderUrl requerido' }), {
      status: 400,
      headers: CORS,
    });
  }
  if (!Array.isArray(files) || files.length === 0) {
    return new Response(JSON.stringify({ error: 'files requerido (array nao vazio)' }), {
      status: 400,
      headers: CORS,
    });
  }

  const folderId = extractFolderId(driveFolderUrl);
  if (!folderId) {
    return new Response(
      JSON.stringify({ error: 'Folder ID invalido no link: ' + driveFolderUrl }),
      { status: 400, headers: CORS }
    );
  }

  // Sanity check: cada arquivo precisa de name + base64
  for (const f of files) {
    if (!f?.name || !f?.base64) {
      return new Response(
        JSON.stringify({ error: 'cada file precisa { name, base64 }' }),
        { status: 400, headers: CORS }
      );
    }
  }

  let gasResult;
  try {
    gasResult = await callAppsScript({ folderId, files });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: CORS,
    });
  }

  if (!gasResult?.success) {
    return new Response(
      JSON.stringify({ error: gasResult?.error || 'Erro no Google Drive' }),
      { status: 500, headers: CORS }
    );
  }

  return new Response(
    JSON.stringify({ success: true, files: gasResult.files }),
    { status: 200, headers: CORS }
  );
};

export const config = { path: '/.netlify/functions/save-to-drive-direct' };
