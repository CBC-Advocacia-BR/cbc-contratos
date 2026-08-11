import { useCallback, useEffect, useMemo, useState } from 'react';
import { carregarSemResposta, carregarCallsDoDia } from './sdr/api';
import { ordenarFila, grupoDoLead } from '../utils/sdrRegras';
import { ymdLocal } from '../utils/format';
import QuadroSemResposta from './sdr/QuadroSemResposta';
import FilaSdr from './sdr/FilaSdr';
import ConversaDrawer from './sdr/ConversaDrawer';
import FunilKanban from './sdr/FunilKanban';

/** Hora no fuso do escritorio. O runtime pode estar em UTC; a call, nunca. */
const horaBrt = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });
  } catch { return ''; }
};

export default function SdrPanel() {
  const [linhas, setLinhas] = useState([]);
  const [calls, setCalls] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);
  const [secao, setSecao] = useState('fila');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const hoje = ymdLocal(new Date());
      const [sr, cs] = await Promise.all([carregarSemResposta(), carregarCallsDoDia(hoje)]);
      setLinhas(sr || []); setCalls(cs || []);
    } catch (e) {
      // fila vazia por falha de consulta e pior que erro na tela: o SDR acharia que zerou
      setErro('Não consegui carregar a fila. ' + (e?.message || ''));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // A fila junta duas fontes: as conversas sem resposta nossa e as calls do dia.
  // O id de cada item nunca usa lead_id, que pode ser nulo (conversa sem lead casado
  // no Kommo): usa conversa_id ou event_id, que sao unicos de verdade.
  const itens = useMemo(() => {
    const agora = new Date();
    const porLead = new Map();
    const bruto = [];

    (linhas || []).forEach((l) => {
      const item = { id: `c${l.conversa_id}`, lead: { ...l, ultima_direcao: 'in' } };
      bruto.push(item);
      if (l.lead_id) porLead.set(String(l.lead_id), item);
    });

    (calls || []).forEach((c) => {
      const alvo = c.lead_id ? porLead.get(String(c.lead_id)) : null;
      const faltou = c.meet_status === 'no_show';
      const dados = faltou
        ? { faltou_em: c.scheduled_at }
        // confirmado fica falso de proposito: a confirmacao da manha e etapa 4,
        // entao hoje NENHUMA call de hoje esta confirmada, e isso e verdade.
        : { call_em: c.scheduled_at, confirmado: false, hora_call: horaBrt(c.scheduled_at) };
      if (alvo) Object.assign(alvo.lead, dados);
      else bruto.push({ id: `e${c.event_id}`, lead: { lead_id: c.lead_id, nome: c.cliente_nome, ...dados } });
    });

    const idPorLead = new Map(bruto.map((x) => [x.lead, x.id]));
    return ordenarFila(bruto.map((x) => x.lead), agora)
      .map((lead) => ({ id: idPorLead.get(lead), lead, grupo: grupoDoLead(lead, agora) }));
  }, [linhas, calls]);

  if (carregando) {
    return <div className="p-6" style={{ color: 'var(--cbc-text-muted)' }}>Carregando a fila...</div>;
  }

  return (
    <div className="p-4 max-w-[1860px] mx-auto">
      {erro && (
        <div className="mb-3 px-4 py-3 rounded-xl text-sm flex items-center gap-3"
          style={{ background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
          <span>{erro}</span>
          <button type="button" className="btn btn-sm ml-auto" onClick={carregar}>Tentar de novo</button>
        </div>
      )}
      <div className="flex items-center gap-2 mb-3" role="tablist" aria-label="Seções da aba SDR">
        {[['fila', 'Fila e conversas'], ['funil', 'Funil']].map(([k, rotulo]) => (
          <button key={k} type="button" role="tab" aria-selected={secao === k}
            onClick={() => setSecao(k)}
            className="text-xs font-bold px-4 py-2 rounded-full border"
            style={secao === k
              ? { background: 'var(--cbc-navy)', borderColor: 'var(--cbc-navy)', color: '#fff' }
              : { borderColor: 'var(--cbc-border-strong)', color: 'var(--cbc-text-secondary)' }}>
            {rotulo}
          </button>
        ))}
      </div>

      {secao === 'fila' ? (
        <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
          <FilaSdr itens={itens} onAbrir={setAberto} />
          <QuadroSemResposta linhas={linhas} onAbrir={setAberto} />
        </div>
      ) : (
        <FunilKanban onAbrir={setAberto} />
      )}
      <ConversaDrawer key={aberto?.conversa_id || aberto?.lead_id || "vazio"} lead={aberto} onFechar={() => setAberto(null)} />
    </div>
  );
}
