const STEPS = [
  { label: 'Contratantes', icon: '1' },
  { label: 'Dados Pessoais', icon: '2' },
  { label: 'Ação / Resort', icon: '3' },
  { label: 'Honorários', icon: '4' },
  { label: 'Cláusulas', icon: '5' },
  { label: 'Pré-visualização', icon: '6' },
  { label: 'Assinatura Digital', icon: '7' },
];

export default function Stepper({ current, onStepClick }) {
  return (
    <div className="w-full overflow-x-auto py-4">
      <div className="flex items-center justify-center min-w-[700px] px-4">
        {STEPS.map((step, i) => {
          const isActive = i === current;
          const isDone = i < current;
          return (
            <div key={i} className="flex items-center">
              <button
                onClick={() => onStepClick?.(i)}
                className={`flex flex-col items-center gap-1 cursor-pointer transition-all duration-200 group min-w-[80px] ${
                  i <= current ? '' : 'opacity-50'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200 ${
                  isActive
                    ? 'bg-gold text-white shadow-lg scale-110'
                    : isDone
                    ? 'bg-navy text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {isDone ? '✓' : step.icon}
                </div>
                <span className={`text-xs font-semibold text-center leading-tight ${
                  isActive ? 'text-gold' : isDone ? 'text-navy' : 'text-gray-400'
                }`}>
                  {step.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-0.5 mx-1 mt-[-16px] ${
                  i < current ? 'bg-navy' : 'bg-gray-200'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
