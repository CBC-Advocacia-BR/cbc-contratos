// StatusPill — pilula de status unica (extract 20/06/2026)
// Substitui StatusBadge (ContratosTab), STATUS_META (CardsView), o chip do
// Kanban, e os renders de status do Boletos/Asaas. Deriva tudo de STATUS_TOKENS
// + toneStyle (dark-aware). Sempre icone+rotulo (nao depende so de cor) e >=12px.
import { getStatus, toneStyle } from '../../lib/statusTokens';

const SIZES = {
  sm: 'text-xs px-2 py-0.5 gap-1',
  md: 'text-[13px] px-2.5 py-1 gap-1.5',
};

export default function StatusPill({
  domain,
  status,
  size = 'sm',
  showIcon = true,
  label,
  className = '',
}) {
  const s = getStatus(domain, status);
  const t = toneStyle(s.tone);
  const Icon = s.Icon;
  return (
    <span
      role="status"
      className={`inline-flex items-center font-semibold rounded-full whitespace-nowrap ${SIZES[size] || SIZES.sm} ${className}`}
      style={{ color: t.fg, background: t.bg, border: `1px solid ${t.border}` }}
    >
      {showIcon && Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      {label || s.label}
    </span>
  );
}
