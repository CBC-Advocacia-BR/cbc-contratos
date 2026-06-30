/**
 * Métricas do bot (item 37): taxa de resolução sem humano, perguntas mais
 * comuns, intenções, horários de pico — para ir melhorando o bot com dados.
 * Fonte: RPC bot_metricas (agrega bot_messages + bot_conversations).
 */
import { useEffect, useState, useCallback } from 'react';
import { botApi } from './botApi';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

const PERIODOS = [7, 30, 90];

function Card({ titulo, valor, sub, destaque }) {
  return (
    <div className={`rounded-xl border p-4 ${destaque
      ? 'border-[#C9A84C]/60 bg-[#C9A84C]/10'
      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-60 font-bold">{titulo}</div>
      <div className="text-2xl font-bold mt-1" style={{ fontFamily: 'Cormorant Garamond, serif' }}>{valor}</div>
      {sub && <div className="text-[11px] opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
}

function Barra({ rotulo, qtd, max, sufixo }) {
  const pct = max > 0 ? Math.max(4, Math.round((qtd / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-40 truncate shrink-0" title={rotulo}>{rotulo}</div>
      <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-700/60 overflow-hidden">
        <div className="h-full rounded bg-[#1B3A5C] dark:bg-[#C9A84C]" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-12 text-right font-bold tabular-nums">{qtd}{sufixo || ''}</div>
    </div>
  );
}

export default function BotMetricas() {
  const [dias, setDias] = useState(30);
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  const load = useCallback(async (d) => {
    setBusy(true); setErro('');
    try {
      const r = await botApi('metrics', { dias: d });
      setM(r.metricas);
    } catch (e) { setErro(e.message); }
    setBusy(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(dias);
  }, [dias, load]);

  const intMax = Math.max(1, ...(m?.intencoes || []).map(i => i.qtd));
  const pergMax = Math.max(1, ...(m?.top_perguntas || []).map(i => i.qtd));
  const horaMax = Math.max(1, ...(m?.por_hora || []).map(i => i.qtd));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs opacity-60">Conversas e mensagens do bot (simulador + WhatsApp) no período.</p>
        <div className="flex items-center gap-1">
          {PERIODOS.map(p => (
            <button key={p} onClick={() => setDias(p)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${dias === p
                ? 'bg-[#1B3A5C] text-white dark:bg-[#C9A84C] dark:text-gray-900'
                : 'bg-gray-100 dark:bg-gray-700 opacity-70 hover:opacity-100'}`}>
              {p} dias
            </button>
          ))}
          <button onClick={() => load(dias)} title="Atualizar"
            className="p-1.5 rounded-full bg-gray-100 dark:bg-gray-700 hover:opacity-80">
            <ArrowPathIcon className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {erro && <div className="text-xs text-red-600 dark:text-red-400">{erro}</div>}
      {!m && busy && <div className="p-8 text-center text-sm opacity-50 animate-pulse">Carregando métricas…</div>}

      {m && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card destaque titulo="Taxa de resolução sem humano"
              valor={m.taxa_resolucao === null || m.taxa_resolucao === undefined ? '—' : `${m.taxa_resolucao}%`}
              sub={`${(m.conversas || 0) - (m.conversas_escaladas || 0)} de ${m.conversas || 0} conversas sem escalar`} />
            <Card titulo="Conversas" valor={m.conversas || 0} sub={`${m.clientes_distintos || 0} cliente(s) distinto(s)`} />
            <Card titulo="Mensagens recebidas" valor={m.mensagens_recebidas || 0} sub={`${m.mensagens_enviadas || 0} respostas enviadas`} />
            <Card titulo="Escaladas p/ humano" valor={m.conversas_escaladas || 0}
              sub={(m.escaladas_recentes || []).slice(0, 2).map(e => e.cliente || 'sem nome').join(', ') || 'nenhuma no período'} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider opacity-70">Intenções mais acionadas</h3>
              {(m.intencoes || []).length === 0 && <p className="text-xs opacity-50">Sem mensagens no período.</p>}
              {(m.intencoes || []).map(i => <Barra key={i.intent} rotulo={i.intent} qtd={i.qtd} max={intMax} />)}
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider opacity-70">Horários de pico (BRT)</h3>
              {(m.por_hora || []).length === 0 && <p className="text-xs opacity-50">Sem mensagens no período.</p>}
              {(m.por_hora || []).map(h => (
                <Barra key={h.hora} rotulo={`${String(h.hora).padStart(2, '0')}h`} qtd={h.qtd} max={horaMax} />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider opacity-70">Perguntas mais comuns</h3>
            <p className="text-[11px] opacity-50">Use esta lista para criar/ajustar intenções, glossário e templates — é o radar de melhoria contínua do bot.</p>
            {(m.top_perguntas || []).length === 0 && <p className="text-xs opacity-50">Sem perguntas no período.</p>}
            {(m.top_perguntas || []).map(p => <Barra key={p.pergunta} rotulo={p.pergunta} qtd={p.qtd} max={pergMax} sufixo="×" />)}
          </div>
        </>
      )}
    </div>
  );
}
