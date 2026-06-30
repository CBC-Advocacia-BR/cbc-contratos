import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { PauseIcon, PlayIcon } from '@heroicons/react/24/outline';

/**
 * Barra de progresso do backfill em tempo real (poll de 5s no bot_config
 * 'backfill_status'). Aparece em todas as sub-abas do painel enquanto o
 * backfill estiver rodando/pausado; some quando concluido ha mais de 1 dia.
 */
export default function BackfillBar() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('bot_config').select('value').eq('key', 'backfill_status').maybeSingle();
    // _now capturado fora do render (regra react-hooks/purity)
    setSt(data?.value ? { ...data.value, _now: Date.now() } : null);
  }, []);

  // fetch inicial + poll de 5s (mesmo padrao dos demais paineis do projeto)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    timer.current = setInterval(load, 5000);
    return () => clearInterval(timer.current);
  }, [load]);

  if (!st || !st.started_at) return null;
  const doneRecently = st.fase === 'concluido' && st.finished_at &&
    ((st._now || 0) - new Date(st.finished_at).getTime()) < 24 * 3600 * 1000;
  if (st.fase === 'concluido' && !doneRecently) return null;

  const total = st.processos_total || 0;
  const feitos = st.processos_feitos || 0;
  const pctAndamentos = total ? Math.min(100, Math.round((feitos / total) * 100)) : 0;
  // fase tarefas: progresso estimado (abertas ~740 + concluidas ~19k -> usa offsets)
  const tarefasFeitas = (st.tarefas_offset_abertas || 0) + (st.tarefas_offset_concluidas || 0);
  const pct = st.fase === 'concluido' ? 100
    : st.fase === 'tarefas' ? Math.min(99, 85 + Math.round(Math.min(1, tarefasFeitas / 20000) * 14))
    : Math.round(pctAndamentos * 0.85); // andamentos = ~85% do trabalho total

  const toggle = async () => {
    setBusy(true);
    const novoAtivo = !st.ativo;
    const value = { ...st, ativo: novoAtivo, updated_at: new Date().toISOString() };
    await supabase.from('bot_config').upsert({ key: 'backfill_status', value, updated_at: new Date().toISOString() });
    if (novoAtivo && st.fase !== 'concluido') {
      // retoma: dispara o proximo lote
      fetch('/.netlify/functions/advbox-backfill-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    }
    await load(); setBusy(false);
  };

  const faseLabel = st.fase === 'andamentos'
    ? `Fase 1/2 — andamentos: ${feitos.toLocaleString('pt-BR')} de ${total ? total.toLocaleString('pt-BR') : '…'} processos`
    : st.fase === 'tarefas'
      ? `Fase 2/2 — tarefas (${st.sub_fase || ''}): ${tarefasFeitas.toLocaleString('pt-BR')} varridas`
      : 'Concluído 🎉';

  return (
    <div className={`rounded-lg border px-3 py-2 mb-2 text-xs ${st.fase === 'concluido'
      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
      : st.ativo ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
      : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <b>📦 Backfill ADVBOX{st.fase !== 'concluido' && !st.ativo ? ' (pausado)' : ''}:</b>
        <span>{faseLabel}</span>
        <span className="opacity-60">· {Number(st.movimentos_gravados || 0).toLocaleString('pt-BR')} andamentos e {Number(st.tarefas_gravadas || 0).toLocaleString('pt-BR')} tarefas gravados · {Number(st.ignoradas || 0).toLocaleString('pt-BR')} ocultas do cliente (vão p/ BI) · lote {st.lote || 0}</span>
        {st.fase !== 'concluido' && (
          <button onClick={toggle} disabled={busy}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-current opacity-70 hover:opacity-100">
            {st.ativo ? <><PauseIcon className="w-3 h-3" />pausar</> : <><PlayIcon className="w-3 h-3" />retomar</>}
          </button>
        )}
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
        <div className={`h-full transition-all duration-700 ${st.fase === 'concluido' ? 'bg-green-500' : 'bg-[#1B3A5C] dark:bg-[#C9A84C]'}`}
          style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between opacity-50">
        <span>{st.erros?.length ? `⚠️ ${st.erros.length} erro(s) — último: ${st.erros[st.erros.length - 1]}` : 'sem erros'}</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
