// HealthCard — card de integracao/serviço (extract 20/06/2026)
// Substitui JobCard (MonitorAdvbox) e ServiceCard (MonitorPanel). Compoe
// StatusDot + FreshnessChip. variant='dark' p/ a ilha navy do Monitor.
import StatusDot from './StatusDot';
import FreshnessChip from './FreshnessChip';

export default function HealthCard({
  title,
  status = 'ok',
  detail,
  sub,
  freshness,
  freshnessPrefix = 'Última',
  variant = 'light',
  onClick,
  className = '',
}) {
  const isDark = variant === 'dark';
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left rounded-xl p-3 w-full ${onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''} ${className}`}
      style={
        isDark
          ? { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }
          : { background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }
      }
    >
      <div className="flex items-center gap-2 mb-1">
        <StatusDot domain="saude" status={status} variant={variant} />
        <span
          className="text-[13px] font-semibold truncate"
          style={{ color: isDark ? '#E5E7EB' : 'var(--cbc-text-primary)' }}
        >
          {title}
        </span>
      </div>
      {detail && (
        <div className="text-xs" style={{ color: isDark ? '#9CA3AF' : 'var(--cbc-text-secondary)' }}>
          {detail}
        </div>
      )}
      {sub && (
        <div className="text-xs mt-0.5" style={{ color: isDark ? '#8A93A3' : 'var(--cbc-text-muted)' }}>
          {sub}
        </div>
      )}
      {freshness && (
        <div className="mt-1">
          <FreshnessChip iso={freshness} prefix={freshnessPrefix} />
        </div>
      )}
    </Wrapper>
  );
}
