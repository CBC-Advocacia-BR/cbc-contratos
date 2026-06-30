// Drive retry utilities — stub temporario (outro agent sobrescreve com implementacao final)
// Gerencia tentativas de upload para Google Drive: reset de retry, atualizacao de pasta.
//
// Colunas relevantes em `contratos`:
//   drive_file_id        — null | 'uploading' | 'failed' | valor real (fileId do Drive)
//   drive_file_link      — URL do arquivo no Drive
//   drive_attempts       — numero de tentativas realizadas
//   drive_last_attempt_at — timestamp da ultima tentativa
//   drive_last_error     — mensagem de erro da ultima tentativa
//   drive_error_code     — FOLDER_NOT_FOUND | NO_PERMISSION | PDF_ERROR | ZAPSIGN_ERROR | TIMEOUT | GENERIC
//   drive_failed_reason  — descricao resumida da razao da falha final
//
// Estado do drive_file_id:
//   null       → nunca tentou OU liberado para nova tentativa
//   'uploading' → em progresso (lock ativo)
//   'failed'   → desistiu apos max attempts OU erro deterministico
//   outro      → sucesso (fileId do Drive)

import { supabase } from '../lib/supabase';

/**
 * Reseta o estado de retry do Drive para um contrato.
 * Libera o lock, zera contador de tentativas e limpa erros.
 * Proxima iteracao do polling do App.jsx vai re-tentar o upload.
 *
 * @param {string|number} id — id do contrato
 * @returns {Promise<void>}
 */
export async function resetDriveRetry(id) {
  if (!id) throw new Error('id do contrato obrigatorio');
  const { error } = await supabase
    .from('contratos')
    .update({
      drive_file_id: null,
      drive_file_link: null,
      drive_attempts: 0,
      drive_last_attempt_at: null,
      drive_last_error: null,
      drive_error_code: null,
      drive_failed_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Atualiza a pasta do Google Drive atribuida a um contrato e libera retry.
 * Edita o campo `dados.linkGoogleDrive` e zera o estado de erro do Drive.
 * Proxima iteracao do polling do App.jsx vai tentar o upload com a nova pasta.
 *
 * @param {string|number} id — id do contrato
 * @param {string} url — URL da pasta do Google Drive (formato: https://drive.google.com/drive/folders/XXXXX)
 * @returns {Promise<void>}
 */
export async function updateDriveFolder(id, url) {
  if (!id) throw new Error('id do contrato obrigatorio');
  if (!url || typeof url !== 'string') throw new Error('URL da pasta obrigatoria');

  // Le dados atuais para fazer merge no JSONB
  const { data: current, error: readErr } = await supabase
    .from('contratos')
    .select('dados')
    .eq('id', id)
    .single();
  if (readErr) throw readErr;

  const dados = { ...(current?.dados || {}), linkGoogleDrive: url.trim() };

  const { error } = await supabase
    .from('contratos')
    .update({
      dados,
      // Libera retry: limpa lock e erros
      drive_file_id: null,
      drive_file_link: null,
      drive_attempts: 0,
      drive_last_attempt_at: null,
      drive_last_error: null,
      drive_error_code: null,
      drive_failed_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Extrai o folderId de uma URL do Google Drive.
 * Formato esperado: https://drive.google.com/drive/folders/XXXXX
 *
 * @param {string} url
 * @returns {string|null} folderId ou null se formato invalido
 */
export function extractFolderId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}
