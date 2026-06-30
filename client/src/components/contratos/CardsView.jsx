// (#85) Cards view — grid alternativo a lista vertical
// (#extract-base 20/06) status -> StatusPill, valor -> MoneyValue,
// superficies/texto -> tokens --cbc-* (dark-aware). Avatar mantido (bg-navy/10).

import { memo } from 'react';
import StatusPill from '../ui/StatusPill';
import MoneyValue from '../ui/MoneyValue';

const ContractCard = memo(function ContractCard({ contrato, onClick }) {
  const initials = (contrato.nome_contratante1 || '?').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const data = contrato.created_at ? new Date(contrato.created_at).toLocaleDateString('pt-BR') : '';

  return (
    <button
      type="button"
      onClick={() => onClick && onClick(contrato.id)}
      className="text-left rounded-xl p-3 hover:shadow-md hover:border-navy/40 transition-all cursor-pointer flex flex-col gap-2"
      style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-full bg-navy/10 text-navy flex items-center justify-center text-xs font-bold shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[13px] truncate" style={{ color: 'var(--cbc-text-primary)' }}>{contrato.nome_contratante1}</div>
            {contrato.nome_contratante2 && (
              <div className="text-[10px] truncate" style={{ color: 'var(--cbc-text-muted)' }}>& {contrato.nome_contratante2}</div>
            )}
          </div>
        </div>
        <StatusPill domain="contrato" status={contrato.status} size="sm" className="shrink-0" />
      </div>
      <div className="text-[11px]" style={{ color: 'var(--cbc-text-secondary)' }}>
        <div className="truncate"><span style={{ color: 'var(--cbc-text-muted)' }}>Resort:</span> {contrato.resort || '—'}</div>
        <div className="truncate"><span style={{ color: 'var(--cbc-text-muted)' }}>Ação:</span> {contrato.tipo_acao || '—'}</div>
      </div>
      <div className="flex items-center justify-between pt-2 text-[10px]" style={{ borderTop: '1px solid var(--cbc-border)' }}>
        <span className="font-bold" style={{ color: 'var(--cbc-text-primary)' }}>
          {contrato.honorarios_total > 0 ? <MoneyValue value={contrato.honorarios_total} /> : 'Êxito'}
        </span>
        <span style={{ color: 'var(--cbc-text-muted)' }}>{data}</span>
      </div>
    </button>
  );
});

export default function CardsView({ contratos, onCardClick }) {
  return (
    <div className="px-3 md:px-4 py-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {contratos.map(c => (
          <ContractCard key={c.id} contrato={c} onClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}
