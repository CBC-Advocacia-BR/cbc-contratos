// (auditoria 01/08/2026 — item 101) Helpers do Google Drive compartilhados pelas
// Netlify Functions.
//
// POR QUE: `extractFolderId` existia em TRES copias identicas (save-to-drive.mjs,
// save-to-drive-direct.mjs e src/utils/driveRetry.js), e o proprio codigo avisava
// "DUPLICADO — manter em sincronia". Foi exatamente esse tipo de copia divergente que
// causou o bug do mapa do ADVBOX (dois arquivos com o mesmo mapa, um desatualizado, e o
// contrato do Edmar foi para o tipo de acao errado).
//
// ⚠️ RESTA UMA copia proposital em `src/utils/driveRetry.js` (frontend). Ela NAO importa
// daqui de proposito: o app importar de `netlify/functions/` acopla o build do site ao
// codigo de servidor e quebra o site inteiro no dia em que este arquivo usar algo que so
// existe no Node (ver item 211). Sao 6 linhas estaveis; se mudar aqui, mudar la tambem.

// (auditoria 01/08 — item 38, parcial) URL do Apps Script num lugar so.
// Ela estava copiada em 4 arquivos (save-to-drive, save-to-drive-direct, health,
// backup-worker) e funciona como CHAVE: quem a tiver escreve na arvore do Drive do
// escritorio. Estando no repositorio, nao da para rotacionar de verdade.
// Passo 1 (aqui): centralizar e permitir sobrescrever por variavel de ambiente.
// Passo 2 (pendente, precisa do Paulo): publicar uma implantacao NOVA do Apps Script,
// pôr a URL em APPS_SCRIPT_URL no Netlify e desativar a antiga — so entao o valor
// abaixo deixa de valer. Enquanto isso ele fica como reserva para nao quebrar producao.
export const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzEzt-t_GDTbUKrzxTLkdOMqYS0Hz_PWcYt7uBcbj7yoKqKdUr89So8gRmsVwhT0cpI5Q/exec';

/**
 * Extrai o ID da pasta a partir de uma URL do Google Drive.
 * Aceita os formatos `/folders/<id>` e `?id=<id>`; remove o sufixo `-drive_fs`
 * que o app do Drive as vezes acrescenta ao copiar o link.
 * @returns {string|null} o id, ou null se a URL nao tiver um
 */
export function extractFolderId(driveUrl) {
  if (!driveUrl || typeof driveUrl !== 'string') return null;
  const match = driveUrl.match(/(?:folders\/|[?&]id=)([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const id = match[1].replace(/-drive_fs$/, '');
  return id || null;
}
