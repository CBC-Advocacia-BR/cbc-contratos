import { useEffect } from 'react';
import { DocumentDuplicateIcon } from '@heroicons/react/24/outline';

// (trava 17/07/2026) Rascunho carregado com RESORT trocado: o operador decide se
// esta criando um contrato NOVO (mesmo cliente, outro resort — caso comum de
// multipropriedade) ou corrigindo o rascunho existente. Nao e confirmacao
// destrutiva: sao duas acoes legitimas, por isso nao usa ConfirmDestructive.
export default function SaveDecisionModal({ isOpen, resortAntes, resortDepois, onCriarNovo, onCorrigir, onCancel }) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop-glass fixed inset-0 z-[100] flex items-center justify-center p-4 max-sm:items-start max-sm:pt-10 overflow-y-auto"
      onClick={() => onCancel?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cbc-save-decision-title"
    >
      <div className="modal-glass rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#FEF3C7' }}>
            <DocumentDuplicateIcon className="w-6 h-6" style={{ color: '#D97706' }} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="cbc-save-decision-title" className="font-bold text-sm mb-1" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
              Resort alterado — criar contrato novo?
            </h3>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}>
              Este rascunho foi salvo para <strong>{resortAntes || '—'}</strong> e o formulário agora
              está em <strong>{resortDepois || '—'}</strong>. Outro resort = outro contrato: criar um
              NOVO mantém o rascunho original intacto. Use "Corrigir" apenas se o resort anterior
              estava errado.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => onCriarNovo?.()}
            className="btn-primary btn-press w-full px-4 py-2.5 rounded-lg text-sm font-bold cursor-pointer"
          >
            Criar contrato NOVO ({resortDepois || 'novo resort'})
          </button>
          <button
            onClick={() => onCorrigir?.()}
            className="w-full px-4 py-2.5 rounded-lg border-2 text-sm font-bold cursor-pointer transition-colors"
            style={{
              borderColor: 'var(--cbc-border, #D1D5DB)',
              color: 'var(--cbc-text-primary, #1A2E52)',
              background: 'var(--cbc-surface, white)',
            }}
          >
            Corrigir este rascunho (era erro de digitação)
          </button>
          <button
            onClick={() => onCancel?.()}
            className="w-full px-4 py-2 text-[12px] font-bold cursor-pointer"
            style={{ color: 'var(--cbc-text-secondary, #4B5563)', background: 'transparent', border: 'none' }}
          >
            Cancelar (não salvar agora)
          </button>
        </div>
      </div>
    </div>
  );
}
