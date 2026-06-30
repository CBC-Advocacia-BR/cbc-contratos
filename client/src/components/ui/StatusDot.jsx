// StatusDot — ponto de status (extract 20/06/2026)
// Substitui as ~7 reimplementacoes de "bolinha colorida + label" do Monitor e o
// dot do SignerName. variant='dark' resolve o fg DARK do token (a ilha navy do
// MonitorAdvbox e sempre escura, independncia do tema do app).
import { toneStyle, getStatus } from '../../lib/statusTokens';

const DOT = { xs: 'w-2 h-2', sm: 'w-2.5 h-2.5', md: 'w-3 h-3' };

// fg dark dos tokens (== :root.dark) — usado na ilha navy mesmo em light mode.
const DARK_FG = {
  success: '#4ADE80',
  danger: '#F87171',
  warning: '#FBBF24',
  info: '#60A5FA',
  neutral: '#8A93A3',
};

export default function StatusDot({
  tone,
  domain,
  status,
  size = 'sm',
  pulse = false,
  label,
  showLabel = false,
  variant = 'light',
  className = '',
}) {
  const resolved = tone || (domain ? getStatus(domain, status).tone : 'neutral');
  const dotColor = variant === 'dark' ? (DARK_FG[resolved] || DARK_FG.neutral) : toneStyle(resolved).fg;
  const text = label || (domain ? getStatus(domain, status).label : '');
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`rounded-full shrink-0 ${DOT[size] || DOT.sm} ${pulse ? 'animate-pulse' : ''}`}
        style={{ background: dotColor }}
        role={showLabel ? undefined : 'status'}
        aria-hidden={showLabel ? 'true' : undefined}
        aria-label={showLabel ? undefined : text || resolved}
      />
      {showLabel && text && (
        <span
          className="text-xs font-semibold"
          style={{ color: variant === 'dark' ? '#E5E7EB' : 'var(--cbc-text-secondary)' }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
