import { useEffect, useState } from 'react';
import { janelaAberta, minutosSemResposta, fmtEspera } from '../../utils/sdrRegras';
import NotaBadge from './NotaBadge';

/**
 * Uma linha por conversa cuja ULTIMA mensagem foi do cliente. A mais antiga no topo.
 *
 * O relogio conta desde a ultima mensagem DELE, e a coluna de janela mostra o limite
 * da Meta: passando de 24h, so sai template aprovado. Sem isso na tela, o SDR digita
 * uma resposta que nunca vai sair.
 */
export default function QuadroSemResposta({ linhas, onAbrir, config }) {
  const [, setTique] = useState(0);
  useEffect(() => {
    // o cronometro anda de minuto em minuto: espera aqui se mede em horas, nao em segundos
    const t = setInterval(() => setTique((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const agora = new Date();
  const ordenadas = [...(linhas || [])].sort(
    (a, b) => new Date(a.ultima_em) - new Date(b.ultima_em)
  );
  const fora = ordenadas.filter((l) => !janelaAberta(l.ultima_em, agora)).length;

  if (!ordenadas.length) {
    return (
      <div className="card p-8 text-center" style={{ color: 'var(--cbc-text-muted)' }}>
        <strong className="block text-lg mb-1" style={{ color: 'var(--cbc-text-primary)' }}>
          Ninguém esperando
        </strong>
        Todas as conversas abertas já foram respondidas.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-wrap"
        style={{ borderColor: 'var(--cbc-border)' }}>
        <h2 className="font-bold">Sem resposta nossa</h2>
        <span className="text-xs" style={{ color: 'var(--cbc-text-muted)' }}>
          {ordenadas.length} conversas, a mais antiga no topo
        </span>
        {fora > 0 && (
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
            {fora} fora da janela de 24h
          </span>
        )}
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        {ordenadas.map((l) => {
          const min = minutosSemResposta(l.ultima_em, agora);
          const aberta = janelaAberta(l.ultima_em, agora);
          return (
            <button key={l.conversa_id} type="button" onClick={() => onAbrir?.(l)}
              className="w-full text-left grid gap-3 px-4 py-2 border-t items-center hover:bg-[var(--cbc-bg-subtle)]"
              style={{ borderColor: 'var(--cbc-border)', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1.5fr) 110px 96px' }}>
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-sm truncate">
                  {l.nome || l.telefone || `lead ${l.lead_id || 'sem vinculo'}`}
                </span>
                <NotaBadge lead={l} config={config} />
              </span>
              <span className="text-xs truncate" style={{ color: 'var(--cbc-text-muted)' }}>
                {l.ultima_mensagem || '(sem texto)'}
              </span>
              <span className="text-sm font-bold text-right tabular-nums"
                style={{ color: min >= 1440 ? 'var(--cbc-danger)' : min >= 720 ? 'var(--cbc-warning)' : 'inherit' }}>
                {fmtEspera(min)}
              </span>
              <span className="text-[11px] font-bold text-center px-2 py-0.5 rounded-full"
                style={aberta
                  ? { background: 'var(--cbc-success-bg)', color: 'var(--cbc-success)' }
                  : { background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
                {aberta ? 'janela aberta' : 'só template'}
              </span>
            </button>
          );
        })}
      </div>
      <div className="px-4 py-2 text-[11px] border-t"
        style={{ borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-muted)' }}>
        O relógio conta desde a última mensagem do cliente. Passando de 24 horas a Meta fecha a
        janela e só sai template aprovado.
      </div>
    </div>
  );
}
