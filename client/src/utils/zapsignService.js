// (#126) Usa API helper — Edge Function com fallback para Function antiga
// Endpoint Edge: /api/zapsign  |  Fallback: /.netlify/functions/zapsign-proxy
import { API } from './apiEndpoints';

async function callProxy(body) {
  // API.zapsign ja define method/headers/body corretos e faz fallback em caso de falha
  return API.zapsign(body);
}

/**
 * Send document to ZapSign for digital signature
 * (integ-4) O caller DEVE passar contratoId (id do contrato no Supabase) para que
 * o external_id seja ESTAVEL — assim o ZapSign reconhece reenvio do mesmo contrato.
 * Sem contratoId cai no fallback de timestamp (gera novo doc a cada clique).
 */
export async function sendToZapSign({ base64Pdf, name, signers, folderPath = '/CBC Contratos/', contratoId }) {
  // (integ-4) external_id estavel por contrato; timestamp so como fallback
  const externalId = contratoId ? `cbc-contrato-${contratoId}` : `cbc-${Date.now()}`;
  const body = {
    action: 'create',
    name,
    base64_pdf: base64Pdf,
    lang: 'pt-br',
    disable_signer_emails: false,
    brand_primary_color: '#0f1c3f',
    external_id: externalId,
    folder_path: folderPath,
    signers: signers.map(s => {
      const signer = {
        name: s.name,
        email: s.email,
        lock_name: true,
        lock_email: true,
        auth_mode: 'assinaturaTela',
        qualification: s.qualification || 'Contratante',
      };
      if (s.anchorText) signer.signature_anchor_text = s.anchorText;
      return signer;
    }),
  };

  const resp = await callProxy(body);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ZapSign erro (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return {
    docToken: data.token,
    signers: (data.signers || []).map(s => ({
      name: s.name,
      email: s.email,
      token: s.token,
      signUrl: s.sign_url || s.signing_link || `https://app.zapsign.com.br/verificar/${s.token}`,
      status: s.status,
      qualification: s.qualification || '',
    })),
  };
}

/**
 * Check document status on ZapSign
 */
export async function checkZapSignStatus(docToken) {
  const resp = await callProxy({ action: 'status', docToken });
  if (!resp.ok) return null;
  const data = await resp.json();
  return {
    status: data.status,
    signers: (data.signers || []).map(s => ({
      name: s.name,
      email: s.email,
      token: s.token,
      status: s.status,
      signedAt: s.signed_at,
      signUrl: s.sign_url || s.signing_link,
      // (varredura 15/06) preserva rastreio de visualizacao — sem isto o sync
      // manual reescrevia os links zerando times_viewed/first_opened_at/last_view_at,
      // fazendo um contrato ja aberto voltar a aparecer como "Nao abriu".
      times_viewed: s.times_viewed || 0,
      first_opened_at: s.first_opened_at || null,
      last_view_at: s.last_view_at || null,
    })),
  };
}

/**
 * Get the signed file URL from ZapSign
 */
export async function getSignedFileUrl(docToken) {
  const resp = await callProxy({ action: 'download', docToken });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.signed_file || data.original_file || null;
}

/**
 * Save signed document to Google Drive folder
 */
export async function saveSignedDocToDrive(docToken, driveFolderUrl, clientName, clientName2, resort, pageSplit, contractData) {
  // 1. Get the signed file URL from ZapSign
  const signedFileUrl = await getSignedFileUrl(docToken);
  if (!signedFileUrl) throw new Error('Documento assinado não encontrado no ZapSign. O contrato pode não ter sido assinado ainda.');

  // 2. Generate DOCX files if contract data available
  let procDocxBase64 = null;
  let contratoDocxBase64 = null;
  if (contractData) {
    try {
      const { generateProcuracaoDocxBlob, generateContractDocxBlob } = await import('./docxGenerator');
      // Procuração DOCX
      const procBlob = await generateProcuracaoDocxBlob(contractData);
      const procBuf = new Uint8Array(await procBlob.arrayBuffer());
      let bin = ''; for (let i = 0; i < procBuf.length; i++) bin += String.fromCharCode(procBuf[i]);
      procDocxBase64 = btoa(bin);
      // Contrato DOCX
      if (generateContractDocxBlob) {
        const cBlob = await generateContractDocxBlob(contractData);
        const cBuf = new Uint8Array(await cBlob.arrayBuffer());
        let bin2 = ''; for (let i = 0; i < cBuf.length; i++) bin2 += String.fromCharCode(cBuf[i]);
        contratoDocxBase64 = btoa(bin2);
      }
    } catch (e) { console.error('DOCX generation error:', e); }
  }

  // 3. Call Netlify Function — download PDF, split, upload to Drive (+ DOCX)
  // Timeout de 60s para evitar lock orfao se Netlify/Apps Script travar
  const resp = await fetch('/.netlify/functions/save-to-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedFileUrl, driveFolderUrl, pageSplit, procDocxBase64, contratoDocxBase64 }),
    signal: AbortSignal.timeout(60000),
  });

  const result = await resp.json();
  if (!resp.ok || !result.success) {
    const err = new Error(result.error || 'Erro ao salvar no Google Drive');
    err.code = result.error_code || 'GENERIC';
    err.context = result.error_context || 'generic';
    throw err;
  }

  return result;
}

/**
 * Cancel/delete a document on ZapSign
 */
export async function cancelZapSignDoc(docToken) {
  const resp = await callProxy({ action: 'cancel', docToken });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Erro ao cancelar: ${errText}`);
  }
  return true;
}

/**
 * Resend signing notification to a signer
 */
export async function resendSignerNotification(signerToken) {
  const resp = await callProxy({ action: 'resend', signerToken });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Erro ao reenviar: ${errText}`);
  }
  return true;
}

