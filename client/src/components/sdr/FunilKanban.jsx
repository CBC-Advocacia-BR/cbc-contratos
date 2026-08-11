import { useEffect, useMemo, useState } from 'react';
import { carregarFunilEtapas, carregarFunilCards } from './api';

const KOMMO = 'https://advocaciacbc.kommo.com/leads/detail/';
const POR_ETAPA = 12;

/**
 * O funil do Kommo em kanban, so leitura.
 *
 * A etapa de cada lead vem de kommo_lead_status (16 mil linhas, sincronizadas de 10 em
 * 10 minutos pelo kommo-conversas-sync). NAO vem de kommo_leads: la o pipeline_id esta
 * nulo nas 19 mil linhas, e quem confiasse nele veria um funil vazio.
 *
 * Cada coluna mostra os 12 leads mais recentes e diz quantos mais existem: arrastar card
 * e mover etapa no Kommo sao escrita, e ficam para quando as etapas novas forem criadas.
 */
export default function FunilKanban({ onAbrir }) {
  const [etapas, setEtapas] = useState([]);
  const [cards, setCards] = useState([]);
  const [funil, setFunil] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarFunilEtapas()
      .then((d) => {
        if (!vivo) return;
        setEtapas(d);
        const principal = d.find((e) => e.pipeline_id === 13760367) || d[0];
        setFunil(principal?.pipeline_id ?? null);
      })
      .catch((e) => { if (vivo) setErro('Não consegui carregar o funil. ' + (e?.message || '')); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!funil) return undefined;
    let vivo = true;
    carregarFunilCards(funil, POR_ETAPA)
      .then((d) => { if (vivo) setCards(d); })
      .catch(() => { if (vivo) setCards([]); });
    return () => { vivo = false; };
  }, [funil]);

  const funis = useMemo(() => {
    const m = new Map();
    etapas.forEach((e) => {
      const at = m.get(e.pipeline_id) || { id: e.pipeline_id, nome: e.pipeline_nome, leads: 0 };
      at.leads += e.leads || 0;
      m.set(e.pipeline_id, at);
    });
    return [...m.values()].sort((a, b) => b.leads - a.leads);
  }, [etapas]);

  const colunas = useMemo(() => {
    const doFunil = etapas.filter((e) => e.pipeline_id === funil).sort((a, b) => a.ordem - b.ordem);
    return doFunil.map((e) => ({
      ...e,
      cards: cards.filter((c) => c.status_id === e.status_id),
    }));
  }, [etapas, cards, funil]);

  if (carregando) {
    return <div className="p-6" style={{ color: 'var(--cbc-text-muted)' }}>Carregando o funil...</div>;
  }
  if (erro) {
    return <div className="p-4 rounded-xl text-sm"
      style={{ background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>{erro}</div>;
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b flex-wrap"
        style={{ borderColor: 'var(--cbc-border)' }}>
        <h2 className="font-bold mr-2">Funil do Kommo</h2>
        {funis.map((f) => (
          <button key={f.id} type="button" onClick={() => setFunil(f.id)}
            aria-pressed={f.id === funil}
            className="text-xs font-bold px-3 py-1 rounded-full border"
            style={f.id === funil
              ? { background: 'var(--cbc-navy)', borderColor: 'var(--cbc-navy)', color: '#fff' }
              : { borderColor: 'var(--cbc-border-strong)', color: 'var(--cbc-text-secondary)' }}>
            {f.nome} <span className="opacity-70 tabular-nums">{f.leads.toLocaleString('pt-BR')}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-3 overflow-x-auto p-3 items-start">
        {colunas.map((c) => {
          const resto = (c.leads || 0) - c.cards.length;
          return (
            <div key={c.status_id} className="flex-none w-[250px] rounded-xl border flex flex-col max-h-[520px]"
              style={{ background: 'var(--cbc-bg-subtle)', borderColor: 'var(--cbc-border)' }}>
              <h3 className="text-[11px] font-bold uppercase tracking-wide px-3 py-2 border-b flex items-center gap-2"
                style={{ borderColor: 'var(--cbc-border)' }}>
                <span className="truncate">{c.status_nome}</span>
                <span className="ml-auto tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>
                  {(c.leads || 0).toLocaleString('pt-BR')}
                </span>
              </h3>
              <div className="overflow-y-auto p-2 flex flex-col gap-2">
                {!c.cards.length && (
                  <p className="text-[11px] italic px-1 py-2" style={{ color: 'var(--cbc-text-muted)' }}>
                    {c.leads ? 'nenhum lead recente com nome' : 'etapa vazia'}
                  </p>
                )}
                {c.cards.map((l) => (
                  <div key={l.lead_id} className="rounded-lg border p-2"
                    style={{ background: 'var(--cbc-bg-card)', borderColor: 'var(--cbc-border)' }}>
                    <button type="button" onClick={() => onAbrir?.(l)}
                      className="block w-full text-left font-bold text-[12.5px] truncate">
                      {l.nome || l.telefone || `lead ${l.lead_id}`}
                    </button>
                    <div className="text-[10.5px] mt-0.5 flex items-center gap-2"
                      style={{ color: 'var(--cbc-text-muted)' }}>
                      <span className="truncate">{l.resort || 'sem resort'}</span>
                      <a href={`${KOMMO}${l.lead_id}`} target="_blank" rel="noopener noreferrer"
                        className="ml-auto shrink-0 font-bold" style={{ color: 'var(--cbc-info)' }}>Kommo</a>
                    </div>
                  </div>
                ))}
                {resto > 0 && (
                  <p className="text-[11px] italic px-1" style={{ color: 'var(--cbc-text-muted)' }}>
                    e mais {resto.toLocaleString('pt-BR')} leads
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 text-[11px] border-t"
        style={{ borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-muted)' }}>
        Etapas e contagens reais, sincronizadas de 10 em 10 minutos. Cada coluna mostra os {POR_ETAPA} leads
        mais recentes. Mover card entre etapas é escrita no Kommo e entra junto com as três etapas novas.
      </div>
    </div>
  );
}
