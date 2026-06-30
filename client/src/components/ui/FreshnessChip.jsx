// FreshnessChip — frescor / tempo relativo (extract 20/06/2026)
// Substitui as 3 copias de fmtRel (Monitor/Boletos). <time> com title absoluto.
import { timeAgo, fmtDateTimeBR } from '../../utils/format';

export default function FreshnessChip({ iso, prefix = '', emphasis = false, className = '' }) {
  const rel = timeAgo(iso);
  return (
    <time
      dateTime={iso || undefined}
      title={iso ? fmtDateTimeBR(iso) : undefined}
      className={`text-xs ${emphasis ? 'font-semibold' : ''} ${className}`}
      style={{ color: 'var(--cbc-text-muted)' }}
    >
      {prefix ? `${prefix} ` : ''}
      {rel}
    </time>
  );
}
