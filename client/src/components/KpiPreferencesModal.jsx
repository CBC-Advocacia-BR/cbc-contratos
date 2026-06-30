// (#308) Modal para personalizar KPIs do Dashboard
import React from 'react';
import { XMarkIcon, ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { KPI_KEYS, KPI_META, DEFAULT_KPIS } from '../hooks/useKpiPreferences';

export default function KpiPreferencesModal({ selected, onToggle, onReset, onSelectAll, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between gap-2"
          style={{ background: 'var(--cbc-navy, #1B3A5C)', color: 'white' }}>
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="w-5 h-5" aria-hidden="true" />
            <h3 className="text-sm font-bold tracking-wide">Personalizar KPIs</h3>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
            aria-label="Fechar">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          <p className="text-[11px] mb-3" style={{ color: 'var(--cbc-text-secondary)' }}>
            Selecione os KPIs que voce deseja visualizar no seu Dashboard. A escolha e persistida localmente por usuario.
          </p>

          <div className="space-y-1.5">
            {KPI_KEYS.map(k => {
              const meta = KPI_META[k] || { label: k, desc: '' };
              const checked = selected.includes(k);
              return (
                <label key={k}
                  className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${checked ? 'ring-1' : ''}`}
                  style={{
                    borderColor: checked ? 'var(--cbc-gold, #C9A84C)' : 'var(--cbc-border)',
                    background: checked ? 'rgba(201,168,76,0.08)' : 'var(--cbc-bg-subtle, transparent)',
                  }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(k)}
                    className="mt-0.5 w-4 h-4 cursor-pointer accent-[#C9A84C] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{meta.label}</div>
                    <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>{meta.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        {/* (mobile 06/2026) flex-wrap: em 375px os 3 botões + contador não cabiam */}
        <div className="px-4 py-3 flex items-center justify-between gap-2 border-t flex-wrap"
          style={{ borderColor: 'var(--cbc-border)', background: 'var(--cbc-bg-subtle, #FAFAFA)' }}>
          <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
            {selected.length} selecionado(s) · {KPI_KEYS.length - selected.length} ocultos
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onSelectAll}
              className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg cursor-pointer"
              style={{ background: 'transparent', color: 'var(--cbc-text-secondary)', border: '1px solid var(--cbc-border)' }}
            >
              Selecionar todos
            </button>
            <button
              onClick={onReset}
              className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg cursor-pointer inline-flex items-center gap-1"
              style={{ background: 'transparent', color: '#D97706', border: '1px solid #FCD34D' }}
            >
              <ArrowPathIcon className="w-3 h-3" aria-hidden="true" />
              Padrao
            </button>
            <button
              onClick={onClose}
              className="text-[11px] font-bold uppercase px-4 py-1.5 rounded-lg cursor-pointer text-white"
              style={{ background: 'var(--cbc-navy, #1B3A5C)' }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
