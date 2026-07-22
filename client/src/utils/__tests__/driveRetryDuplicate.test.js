// (auditoria #58) Testa a logica PURA/guardas de driveRetry e duplicateDetector —
// os caminhos que decidem sem tocar o banco (validacao de entrada) e o parser de URL.
import { describe, it, expect } from 'vitest';
import { extractFolderId } from '../driveRetry';
import { checkDuplicate, estimateSignatureTime } from '../duplicateDetector';

describe('driveRetry.extractFolderId', () => {
  it('extrai o folderId de uma URL valida do Drive', () => {
    expect(extractFolderId('https://drive.google.com/drive/folders/AbC-123_xYz')).toBe('AbC-123_xYz');
  });
  it('funciona com querystring depois do id', () => {
    expect(extractFolderId('https://drive.google.com/drive/folders/XYZ?usp=sharing')).toBe('XYZ');
  });
  it('retorna null para URL sem folders/', () => {
    expect(extractFolderId('https://drive.google.com/file/d/123/view')).toBeNull();
  });
  it('retorna null para entrada invalida', () => {
    expect(extractFolderId(null)).toBeNull();
    expect(extractFolderId('')).toBeNull();
    expect(extractFolderId(42)).toBeNull();
  });
  // Google Drive para Desktop gera links no formato open?id=... e cola o sufixo
  // "-drive_fs" no id (caso real: pasta da Terezinha, usuaria Maria Emanuelle).
  it('extrai o id do formato open?id= (Drive Desktop)', () => {
    expect(extractFolderId('https://drive.google.com/open?id=1XF5R7GzMFhqjH1CMPXkr9WVtoCEasqr'))
      .toBe('1XF5R7GzMFhqjH1CMPXkr9WVtoCEasqr');
  });
  it('remove o sufixo -drive_fs do formato open?id=', () => {
    expect(extractFolderId('https://drive.google.com/open?id=1XF5R7GzMFhqjH1CMPXkr9WVtoCEasqr-drive_fs'))
      .toBe('1XF5R7GzMFhqjH1CMPXkr9WVtoCEasqr');
  });
  it('remove o sufixo -drive_fs tambem do formato folders/', () => {
    expect(extractFolderId('https://drive.google.com/drive/folders/1AbC_xYz-drive_fs'))
      .toBe('1AbC_xYz');
  });
  it('funciona com /u/0/folders/ (conta multipla)', () => {
    expect(extractFolderId('https://drive.google.com/drive/u/0/folders/1AbC?usp=sharing'))
      .toBe('1AbC');
  });
  it('funciona com folderview?id=', () => {
    expect(extractFolderId('https://drive.google.com/folderview?id=1AbC_xYz'))
      .toBe('1AbC_xYz');
  });
});

describe('duplicateDetector — guardas (sem tocar o banco)', () => {
  it('sem CPF ou sem resort => nao e duplicata', async () => {
    await expect(checkDuplicate('', 'Resort A')).resolves.toEqual({ isDuplicate: false, existingContracts: [] });
    await expect(checkDuplicate('12345678901', '')).resolves.toEqual({ isDuplicate: false, existingContracts: [] });
  });
  it('CPF com tamanho invalido => nao e duplicata (nao consulta)', async () => {
    await expect(checkDuplicate('123', 'Resort A')).resolves.toEqual({ isDuplicate: false, existingContracts: [] });
    await expect(checkDuplicate('123.456', 'Resort A')).resolves.toEqual({ isDuplicate: false, existingContracts: [] });
  });
  it('estimateSignatureTime sem resort => null', async () => {
    await expect(estimateSignatureTime('')).resolves.toBeNull();
    await expect(estimateSignatureTime(null)).resolves.toBeNull();
  });
});
