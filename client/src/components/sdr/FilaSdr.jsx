import { fmtEspera, minutosSemResposta } from '../../utils/sdrRegras';
import NotaBadge from './NotaBadge';

/**
 * A fila de trabalho do SDR, ja ordenada pelas regras puras (utils/sdrRegras).
 * A coluna "por que" existe para a linha nao depender de cor: ela DIZ o motivo.
 */
const ROTULO = {
  risco: ['pediu remarcar', 'var(--cbc-danger)'],
  call: ['call hoje sem confirmar', 'var(--cbc-warning)'],
  espera: ['esperando resposta', 'var(--cbc-danger)'],
  semconvite: ['nunca foi convidado', 'var(--cbc-gold-text)'],
  falta: ['faltou', 'var(--cbc-text-muted)'],
};

export default function FilaSdr({ itens, onAbrir, config }) {
  if (!itens?.length) {
    return (
      <div className="card p-8 text-center" style={{ color: 'var(--cbc-text-muted)' }}>
        <strong className="block text-lg mb-1" style={{ color: 'var(--cbc-text-primary)' }}>
          Fila zerada
        </strong>
        Nada pendente agora.
      </div>
    );
  }

  const agora = new Date();
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-baseline gap-3"
        style={{ borderColor: 'var(--cbc-border)' }}>
        <h2 className="font-bold">Fila</h2>
        <span className="text-xs" style={{ color: 'var(--cbc-text-muted)' }}>
          {itens.length} pendências, ordenadas por onde está o dinheiro
        </span>
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        {itens.map(({ id, lead, grupo }) => {
          const [texto, cor] = ROTULO[grupo] || ['', 'var(--cbc-text-muted)'];
          const min = minutosSemResposta(lead.ultima_em, agora);
          const quando = grupo === 'call' || grupo === 'risco'
            ? (lead.hora_call || '')
            : fmtEspera(min);
          return (
            <button key={id} type="button" onClick={() => onAbrir?.(lead)}
              className="w-full text-left grid gap-3 px-4 py-2 border-t items-center hover:bg-[var(--cbc-bg-subtle)]"
              style={{ borderColor: 'var(--cbc-border)', gridTemplateColumns: 'minmax(0,1.4fr) 160px 110px' }}>
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-sm truncate">
                  {lead.nome || lead.telefone || `lead ${lead.lead_id || 'sem vinculo'}`}
                </span>
                <NotaBadge lead={lead} config={config} />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: cor }}>
                {texto}
              </span>
              <span className="text-sm font-bold text-right tabular-nums"
                style={{ color: grupo === 'espera' && min >= 1440 ? 'var(--cbc-danger)' : 'inherit' }}>
                {quando}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
