// AutomationPipeline — timeline de automacoes (extract 20/06/2026)
// Generaliza o ContractProgressBar (7-dots) do ContratosTab. Melhoria vs original:
// etapas pendentes mostram o icone esmaecido (antes ficavam vazias e ilegiveis),
// e o rotulo sobe de 7px -> 11px. Recebe PROGRESS_STEPS/getCompletedSteps intactos.
export default function AutomationPipeline({
  steps,
  completed = {},
  activeKey,
  accent = 'var(--cbc-accent)',
  className = '',
}) {
  return (
    <div className={`flex items-center w-full ${className}`} role="list">
      {steps.map((step, i) => {
        const done = !!completed[step.key];
        const isLast = i === steps.length - 1;
        const nextKey = steps[i + 1]?.key;
        const isActive = step.key === activeKey && done && !completed[nextKey];
        const Icon = step.Icon;
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0" role="listitem">
            <div className="flex flex-col items-center gap-0.5 shrink-0" style={{ minWidth: '32px' }}>
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${isActive ? 'animate-pulse' : ''}`}
                style={{
                  background: done ? (isActive ? 'var(--cbc-warning)' : accent) : 'var(--cbc-bg-subtle)',
                  color: done ? '#fff' : 'var(--cbc-text-muted)',
                  border: done ? 'none' : '1px solid var(--cbc-border)',
                  boxShadow: done ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                }}
                aria-label={`${step.label}${done ? ' — concluído' : ' — pendente'}`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
              </div>
              <span
                className="cbc-step-label text-[11px] font-semibold leading-tight text-center"
                style={{
                  color: done
                    ? isActive
                      ? 'var(--cbc-warning)'
                      : 'var(--cbc-text-primary)'
                    : 'var(--cbc-text-muted)',
                }}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className="flex-1 h-[2px] mx-0.5 rounded-full transition-all duration-300"
                style={{ background: done ? accent : 'var(--cbc-border)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
