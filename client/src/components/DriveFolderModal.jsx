import { useState, useEffect, useRef } from 'react';
import { FolderIcon, XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { updateDriveFolder, extractFolderId } from '../utils/driveRetry';

/**
 * Modal para atribuir/trocar pasta do Google Drive de um contrato.
 * Apos salvar, dispara verificacao em background (ver startDriveVerification no ContratosTab).
 *
 * Props:
 *   contract: { id, dados: { linkGoogleDrive?, ... } }
 *   onClose: () => void — fecha modal
 *   onSaved: (contractId) => void — chamado apos save bem-sucedido (para disparar verificacao e refresh)
 */
export default function DriveFolderModal({ contract, onClose, onSaved }) {
  const [folderUrl, setFolderUrl] = useState(contract?.dados?.linkGoogleDrive || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && !saving) { e.preventDefault(); onClose?.(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saving, onClose]);

  const folderId = extractFolderId(folderUrl);
  const valid = !!folderId;

  async function handleSave() {
    if (!folderUrl.trim()) { setError('Cole o link da pasta'); return; }
    if (!valid) {
      setError('Link invalido. Use o formato: https://drive.google.com/drive/folders/XXXXX');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await updateDriveFolder(contract.id, folderUrl.trim());
      onSaved?.(contract.id);
      onClose?.();
    } catch (e) {
      setError('Erro ao salvar: ' + (e?.message || 'falha desconhecida'));
      setSaving(false);
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && valid && !saving) { e.preventDefault(); handleSave(); }
  };

  return (
    <div
      className="modal-backdrop-glass fixed inset-0 z-[90] flex items-center justify-center p-4"
      onClick={() => !saving && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cbc-drive-folder-modal-title"
    >
      <div
        className="modal-glass rounded-2xl w-full max-w-lg p-6 max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: '#E8F0FE' }}
          >
            <FolderIcon className="w-6 h-6" style={{ color: '#1A73E8' }} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              id="cbc-drive-folder-modal-title"
              className="font-bold text-base mb-1"
              style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}
            >
              Atribuir pasta do Google Drive
            </h3>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}>
              Cole o link da pasta compartilhada com o Apps Script do escritorio. Apos salvar, as automacoes
              de upload vao ser tentadas automaticamente.
            </p>
          </div>
          <button
            onClick={() => !saving && onClose?.()}
            disabled={saving}
            className="shrink-0 p-1 rounded cursor-pointer hover:bg-gray-100 disabled:opacity-50"
            aria-label="Fechar"
          >
            <XMarkIcon className="w-5 h-5" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }} aria-hidden="true" />
          </button>
        </div>

        <div className="mb-3">
          <label className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}>
            URL da pasta
          </label>
          <input
            ref={inputRef}
            type="url"
            className="input-field w-full"
            placeholder="https://drive.google.com/drive/folders/..."
            value={folderUrl}
            onChange={(e) => { setFolderUrl(e.target.value); setError(''); }}
            onKeyDown={handleKeyDown}
            disabled={saving}
            autoComplete="off"
            spellCheck={false}
            aria-label="URL da pasta do Google Drive"
          />
          {folderUrl && !valid && (
            <p className="text-[11px] mt-1.5" style={{ color: '#DC2626' }}>
              Link invalido. Use o formato: <span className="font-mono">drive.google.com/drive/folders/XXXXX</span>
            </p>
          )}
          {valid && (
            <p className="text-[11px] mt-1.5" style={{ color: '#16A34A' }}>
              ID da pasta reconhecido: <span className="font-mono bg-green-50 px-1.5 py-0.5 rounded">{folderId}</span>
            </p>
          )}
        </div>

        <div
          className="flex items-start gap-2 p-3 rounded-lg mb-4"
          style={{ background: '#FEF3C7', border: '1px solid #FCD34D' }}
        >
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#B45309' }} aria-hidden="true" />
          <div className="text-[11px] leading-relaxed" style={{ color: '#92400E' }}>
            Certifique-se que a pasta esta compartilhada com a conta do Apps Script com permissao de editor.
            Sem isso, o upload vai continuar falhando.
          </div>
        </div>

        {error && (
          <div
            className="flex items-start gap-2 p-3 rounded-lg mb-4"
            style={{ background: '#FEE2E2', border: '1px solid #FCA5A5' }}
          >
            <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#B91C1C' }} aria-hidden="true" />
            <span className="text-[11px]" style={{ color: '#991B1B' }}>{error}</span>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => !saving && onClose?.()}
            disabled={saving}
            className="btn-outline px-4 py-2 text-xs font-bold uppercase rounded-lg cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !valid}
            className="btn-primary px-4 py-2 text-xs font-bold uppercase rounded-lg text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            title={valid ? 'Salvar e tentar automacoes' : 'Cole um link valido para habilitar'}
          >
            {saving ? (
              <>
                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar e tentar automacoes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
