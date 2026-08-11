import { pontuar } from '../../utils/sdrPontuacao';

/**
 * Selo da nota do lead. Quem nao tem resort nem valor mostra "a apurar", nao zero:
 * ausencia de informacao nao e julgamento sobre o lead.
 */
const CORES = {
  quente: { background: 'var(--cbc-gold)', borderColor: 'var(--cbc-gold-dark)', color: 'var(--cbc-navy-dark)' },
  morno: { background: 'var(--cbc-info-bg)', borderColor: 'var(--cbc-info-border)', color: 'var(--cbc-info)' },
  frio: { background: 'var(--cbc-bg-subtle)', borderColor: 'var(--cbc-border-strong)', color: 'var(--cbc-text-secondary)' },
  apurar: { background: 'transparent', borderColor: 'var(--cbc-border-strong)', color: 'var(--cbc-text-muted)', borderStyle: 'dashed' },
};

export default function NotaBadge({ lead, config }) {
  const { nota, faixa, faltando } = pontuar(lead, config);
  const titulo = nota == null
    ? 'Nota a apurar: falta o resort e o valor pago. A fórmula ainda está em avaliação.'
    : faltando.length
      ? `Nota parcial: falta ${faltando.join(' e ')}`
      : 'Nota completa';

  return (
    <span title={titulo}
      className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border tabular-nums shrink-0"
      style={{ borderWidth: 1, borderStyle: 'solid', ...CORES[faixa] }}>
      {nota == null ? '—' : nota} {nota == null ? 'a apurar' : faixa}
    </span>
  );
}
