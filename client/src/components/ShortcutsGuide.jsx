export default function ShortcutsGuide({ onClose }) {
  const isMac = navigator.platform.includes('Mac');
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { keys: `${mod} + S`, action: 'Salvar contrato' },
    { keys: `${mod} + Enter`, action: 'Enviar para ZapSign' },
    { keys: `${mod} + N`, action: 'Novo contrato (limpar)' },
    { keys: `${mod} + P`, action: 'Visualizar PDF' },
    { keys: `${mod} + 1`, action: 'Aba Novo Contrato' },
    { keys: `${mod} + 2`, action: 'Aba Contratos Salvos' },
    { keys: `${mod} + 3`, action: 'Aba Dashboard' },
    { keys: `${mod} + D`, action: 'Modo escuro' },
    { keys: `${mod} + /`, action: 'Abrir guia de atalhos' },
  ];

  return (
    <div className="fixed inset-0 modal-backdrop-glass z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-glass rounded-xl w-full max-w-md overflow-hidden max-h-[85dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="text-white text-center py-3 px-5" style={{ background: '#1B3A5C' }}>
          <div className="text-[13px] font-bold uppercase tracking-[1px]">Atalhos do Teclado</div>
        </div>
        <div className="p-4 space-y-1.5">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
              <span className="text-sm text-gray-700 dark:text-gray-300">{s.action}</span>
              <kbd className="text-[11px] font-mono px-2 py-1 rounded border border-gray-300 bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 text-gray-600 font-bold">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose}
            className="w-full py-2 rounded-lg border border-gray-300 text-gray-500 font-bold text-xs uppercase cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-400">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
