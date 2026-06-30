// (#85) Kanban view dos contratos — read-only por enquanto (drag-drop futuro)
// Recebe a lista ja filtrada de contratos + handler de click
// (#extract-base 20/06) colunas derivam de STATUS_TOKENS.contrato + toneStyle
// (fonte unica, dark-aware); valor -> MoneyValue; superficies/texto -> tokens.

import { memo } from 'react';
import { STATUS_TOKENS, toneStyle } from '../../lib/statusTokens';
import MoneyValue from '../ui/MoneyValue';

const COLUMN_ORDER = ['rascunho', 'enviado_zapsign', 'assinado', 'cancelado'];
const COLUMNS = COLUMN_ORDER.map((id) => {
  const s = STATUS_TOKENS.contrato[id];
  const t = toneStyle(s.tone);
  return { id, label: s.label, Icon: s.Icon, fg: t.fg, bg: t.bg };
});

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

const KanbanCard = memo(function KanbanCard({ contrato, onClick }) {
  const initials = (contrato.nome_contratante1 || '?').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();

  return (
    <button
      type="button"
      onClick={() => onClick && onClick(contrato.id)}
      className="w-full text-left rounded-lg p-2.5 hover:shadow-md hover:border-navy/40 transition-all cursor-pointer"
      style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-6 h-6 rounded-full bg-navy/10 text-navy flex items-center justify-center text-[9px] font-bold shrink-0">
            {initials}
          </div>
          <div className="font-semibold text-[12px] truncate" style={{ color: 'var(--cbc-text-primary)' }}>{contrato.nome_contratante1}</div>
        </div>
      </div>
      {contrato.nome_contratante2 && (
        <div className="text-[10px] truncate -mt-1 mb-1" style={{ color: 'var(--cbc-text-muted)' }}>& {contrato.nome_contratante2}</div>
      )}
      <div className="text-[10px] truncate" style={{ color: 'var(--cbc-text-secondary)' }}>{contrato.resort}</div>
      <div className="text-[9px] truncate" style={{ color: 'var(--cbc-text-muted)' }}>{contrato.tipo_acao}</div>
      <div className="flex items-center justify-between gap-2 mt-2 pt-1.5" style={{ borderTop: '1px solid var(--cbc-border)' }}>
        <span className="text-[10px] font-bold" style={{ color: 'var(--cbc-text-primary)' }}>
          {contrato.honorarios_total > 0 ? <MoneyValue value={contrato.honorarios_total} cents={false} /> : 'Êxito'}
        </span>
        <span className="text-[9px]" style={{ color: 'var(--cbc-text-muted)' }}>{fmtDate(contrato.created_at)}</span>
      </div>
    </button>
  );
});

export default function KanbanView({ contratos, onCardClick }) {
  const grouped = COLUMNS.map(col => ({
    ...col,
    items: contratos.filter(c => (c.status || 'rascunho') === col.id),
  }));

  return (
    <div className="px-3 md:px-4 py-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-sm:flex max-sm:overflow-x-auto max-sm:snap-x max-sm:pb-1">
        {grouped.map(col => {
          const Icon = col.Icon;
          return (
            <div key={col.id} className="rounded-xl p-2.5 flex flex-col min-h-[200px] max-sm:min-w-[80vw] max-sm:snap-center" style={{ background: col.bg }}>
              <div className="flex items-center justify-between gap-2 mb-2 px-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" style={{ color: col.fg }} aria-hidden="true" />
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: col.fg }}>
                    {col.label}
                  </span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center" style={{ color: 'var(--cbc-text-secondary)', background: 'var(--cbc-bg-card)' }}>
                  {col.items.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto" style={{ maxHeight: '60vh' }}>
                {col.items.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-[10px] italic py-6" style={{ color: 'var(--cbc-text-muted)' }}>
                    Vazio
                  </div>
                ) : (
                  col.items.map(c => (
                    <KanbanCard key={c.id} contrato={c} onClick={onCardClick} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
