// Componente reutilizavel de barra de progresso
// Props:
//   value: 0-100 (percentual)
//   label: texto descritivo acima da barra
//   color: cor do preenchimento (default navy CBC)
//   size: 'sm' | 'md' | 'lg' (default 'md')
//   showPercent: boolean (default true)
//   indeterminate: boolean — modo de progresso indeterminado com animacao
export default function ProgressBar({
  value = 0,
  label,
  color = '#1B3A5C',
  size = 'md',
  showPercent = true,
  indeterminate = false,
}) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const heights = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' };
  const barHeight = heights[size] || heights.md;

  return (
    <div className='w-full'>
      {(label || showPercent) && (
        <div className='flex items-center justify-between mb-1 gap-2'>
          {label && (
            <span className='text-[10px] font-bold uppercase tracking-wide text-gray-500 truncate'>
              {label}
            </span>
          )}
          {showPercent && !indeterminate && (
            <span className='text-[10px] font-bold text-gray-600 shrink-0' style={{ color }}>
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}
      <div
        className={`w-full rounded-full overflow-hidden bg-gray-100 ${barHeight}`}
        role='progressbar'
        aria-valuenow={indeterminate ? undefined : Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progresso'}
      >
        {indeterminate ? (
          <div
            className={`${barHeight} rounded-full progress-indeterminate`}
            style={{ background: color, width: '40%' }}
          />
        ) : (
          <div
            className={`${barHeight} rounded-full transition-all duration-300 ease-out`}
            style={{ width: `${pct}%`, background: color }}
          />
        )}
      </div>
      <style>{`
        @keyframes progressIndeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        .progress-indeterminate {
          animation: progressIndeterminate 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
