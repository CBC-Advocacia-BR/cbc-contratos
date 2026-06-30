// (mobile 06/2026) Sheet de navegação aberto pelo item "Mais" do dock.
// Resolve o problema crítico do mobile: 9 abas eram INACESSÍVEIS no iPhone e
// no iPad portrait porque o dock fixo só tinha Novo/Salvos/Dashboard.
// Renderizado APENAS quando o dock está visível — zero impacto em desktop.
import { XMarkIcon, MagnifyingGlassIcon, SparklesIcon } from '@heroicons/react/24/outline';

export default function MobileNavSheet({
  tabs,            // [{ key, label, Icon }] — já filtradas por permissão
  activeTab,
  onSelect,        // (key) => void
  onClose,
  onOpenSearch,
  onOpenChangeLog,
  version,
}) {
  return (
    <>
      <div className="cbc-navsheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="cbc-navsheet" role="dialog" aria-modal="true" aria-label="Navegação">
        <div className="cbc-navsheet-grab" aria-hidden="true" />
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted)' }}>
            Todas as abas
          </div>
          <button
            type="button"
            onClick={onClose}
            className="touch-target rounded-lg cursor-pointer"
            style={{ color: 'var(--cbc-text-muted)' }}
            aria-label="Fechar navegação"
          >
            <XMarkIcon className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {tabs.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`cbc-navsheet-item ${activeTab === key ? 'is-active' : ''}`}
              onClick={() => { onSelect(key); onClose(); }}
              aria-current={activeTab === key ? 'page' : undefined}
            >
              {Icon && <Icon className="w-6 h-6" aria-hidden="true" />}
              <span className="px-1 leading-tight">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--cbc-border)' }}>
          <button
            type="button"
            onClick={() => { onClose(); onOpenSearch?.(); }}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-bold uppercase cursor-pointer"
            style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}
          >
            <MagnifyingGlassIcon className="w-4 h-4" aria-hidden="true" />
            Buscar contrato
          </button>
          <button
            type="button"
            onClick={() => { onClose(); onOpenChangeLog?.(); }}
            className="flex items-center justify-center gap-1.5 rounded-xl py-3 px-4 text-[11px] font-bold cursor-pointer"
            style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-muted)' }}
            aria-label="Novidades da versão"
          >
            <SparklesIcon className="w-4 h-4" aria-hidden="true" />
            v{version}
          </button>
        </div>
      </div>
    </>
  );
}
