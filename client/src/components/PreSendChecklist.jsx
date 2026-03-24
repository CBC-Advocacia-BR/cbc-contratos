import { useState } from 'react';

export default function PreSendChecklist({ issues, onProceed, onClose }) {
  const allValid = issues.length === 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="text-white text-center py-3 px-5" style={{ background: allValid ? '#16A34A' : '#DC2626' }}>
          <div className="text-[13px] font-bold uppercase tracking-[1px]">
            {allValid ? 'Tudo Pronto!' : 'Verificacao Pre-Envio'}
          </div>
          <div className="text-[11px] opacity-80 mt-0.5">
            {allValid ? 'Contrato pronto para envio' : `${issues.length} problema${issues.length > 1 ? 's' : ''} encontrado${issues.length > 1 ? 's' : ''}`}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {allValid ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Todos os campos foram validados com sucesso.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="text-xs text-red-700 dark:text-red-300">{issue.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-500 font-bold text-xs uppercase cursor-pointer hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400">
            {allValid ? 'Cancelar' : 'Corrigir'}
          </button>
          {allValid && (
            <button onClick={onProceed}
              className="flex-1 py-2.5 rounded-lg text-white font-bold text-xs uppercase cursor-pointer"
              style={{ background: '#1B3A5C' }}>
              Enviar para ZapSign
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
