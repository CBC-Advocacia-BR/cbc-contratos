// MoneyValue — valor monetario padronizado (extract 20/06/2026)
// tabular-nums sempre (alinhamento vertical de colunas de R$) e >=13px por
// padrao. Herda cor do contexto (nao forca), salvo prop muted.
import { fmtBRL, fmtBRL0 } from '../../utils/format';

export default function MoneyValue({
  value,
  cents = true,
  muted = false,
  align,
  className = '',
  title,
}) {
  const txt = cents ? fmtBRL(value) : fmtBRL0(value);
  return (
    <span
      className={`tabular-nums ${align === 'right' ? 'text-right' : ''} ${className}`}
      style={{
        fontVariantNumeric: 'tabular-nums',
        color: muted ? 'var(--cbc-text-muted)' : undefined,
      }}
      title={title}
    >
      {txt}
    </span>
  );
}
