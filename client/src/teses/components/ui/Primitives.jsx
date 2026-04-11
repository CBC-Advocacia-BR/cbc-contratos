// Primitivas de UI para o CBC TESES.
// Mantemos uma camada fina no lugar do shadcn/ui para não ter de instalar
// nem configurar Radix, preservando o mesmo visual limpo e profissional.

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };
  const variants = {
    primary: 'bg-slate-800 text-white hover:bg-slate-700',
    secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
    ghost: 'text-slate-700 hover:bg-slate-100',
    outline: 'border border-slate-300 text-slate-800 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  };
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right, className = '' }) {
  return (
    <div className={`px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide truncate">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function CardBody({ className = '', children }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

export function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-slate-500 outline-none bg-white ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = '', rows = 4, ...props }) {
  return (
    <textarea
      rows={rows}
      className={`w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-slate-500 outline-none bg-white ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', children, ...props }) {
  return (
    <select
      className={`w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-slate-500 outline-none bg-white ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ children, required, className = '', htmlFor }) {
  return (
    <label htmlFor={htmlFor} className={`block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1 ${className}`}>
      {children}
      {required && <span className="text-red-600 ml-0.5">*</span>}
    </label>
  );
}

const STATUS_STYLES = {
  rascunho: 'bg-slate-100 text-slate-700 border-slate-300',
  em_revisao: 'bg-yellow-50 text-yellow-800 border-yellow-300',
  aprovado: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  obsoleto: 'bg-red-50 text-red-800 border-red-300',
};
const STATUS_LABELS = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  aprovado: 'Aprovado',
  obsoleto: 'Obsoleto',
};

export function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.rascunho;
  const label = STATUS_LABELS[status] || status;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${style}`}>
      {label}
    </span>
  );
}

export function Badge({ children, color = 'slate', className = '' }) {
  const map = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-100 text-blue-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    yellow: 'bg-yellow-100 text-yellow-800',
    red: 'bg-red-100 text-red-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[color] || map.slate} ${className}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="text-center py-16 px-6 border-2 border-dashed border-slate-200 rounded-xl bg-white">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">{title}</h3>
      {description && <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'w-4 h-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-2xl' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-2xl w-full ${width} max-h-[90vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer text-xl leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ message, type = 'info', onClose }) {
  if (!message) return null;
  const styles = {
    info: 'bg-slate-800 text-white',
    success: 'bg-emerald-600 text-white',
    error: 'bg-red-600 text-white',
  };
  return (
    <div className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm ${styles[type]} flex items-center gap-3`}>
      <span>{message}</span>
      {onClose && (
        <button onClick={onClose} className="opacity-80 hover:opacity-100">&times;</button>
      )}
    </div>
  );
}
