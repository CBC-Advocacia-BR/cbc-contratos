import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { normalize } from './botApi';
import { WrenchScrewdriverIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

/**
 * Painel de pendencias de parametrizacao — alimentado pelo catalogo que o
 * monitor sincroniza 2x/dia com o GET /settings do ADVBOX:
 *  - quantas etapas/tarefas ainda estao sem texto configurado
 *  - o que foi INCLUIDO ou EXCLUIDO no ADVBOX nos ultimos 30 dias
 *    (exclusoes tem o template desativado automaticamente)
 */
export default function BotPendencias({ onGoTo }) {
  const [info, setInfo] = useState(null);

  const load = useCallback(async () => {
    const [{ data: cfgRows }, { data: stageTpl }, { data: taskTpl }] = await Promise.all([
      supabase.from('bot_config').select('key, value').in('key', ['catalogo', 'monitor']),
      supabase.from('bot_stage_templates').select('stages_id, template, proximos_passos, active'),
      supabase.from('bot_task_templates').select('task_id, texto_pendente, texto_concluida, active, ocultar_cliente'),
    ]);
    const cfg = {};
    for (const r of cfgRows || []) cfg[r.key] = r.value || {};
    const cat = cfg.catalogo;
    if (!cat?.stages?.length) { setInfo({ semCatalogo: true }); return; }

    const ignoreTerms = (cfg.monitor?.tarefas_ignoradas || []).map(normalize);
    const isIgnored = (name) => ignoreTerms.some(t => t && normalize(name).includes(t));

    const stageOk = new Set((stageTpl || []).filter(t => t.active && (t.template || t.proximos_passos)).map(t => Number(t.stages_id)));
    const taskOk = new Set((taskTpl || []).filter(t => t.active && (t.texto_pendente || t.texto_concluida)).map(t => Number(t.task_id)));

    // ocultas do cliente (por flag ou termo) nao precisam de texto -> fora das pendencias
    const ocultasIds = new Set((taskTpl || []).filter(t => t.ocultar_cliente).map(t => Number(t.task_id)));
    const tarefasConsideradas = cat.tasks.filter(t => !isIgnored(t.name) && !ocultasIds.has(Number(t.id)));
    const etapasPend = cat.stages.filter(s => !stageOk.has(Number(s.id)));
    const tarefasPend = tarefasConsideradas.filter(t => !taskOk.has(Number(t.id)));
    const nov = cat.novidades || {};

    setInfo({
      etapasTotal: cat.stages.length, etapasPend: etapasPend.length,
      tarefasTotal: tarefasConsideradas.length, tarefasPend: tarefasPend.length,
      ignoradas: cat.tasks.length - tarefasConsideradas.length,
      novidades: nov, syncedAt: cat.synced_at,
    });
  }, []);

  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (!info) return null;
  if (info.semCatalogo) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 mb-2 text-xs opacity-70">
        ⚙️ O catálogo de etapas/tarefas será sincronizado na próxima rodada do monitor (9h/18h).
      </div>
    );
  }

  const nov = info.novidades || {};
  const chips = [];
  if (nov.etapas_novas?.length) chips.push(`🆕 ${nov.etapas_novas.length} etapa(s) nova(s): ${nov.etapas_novas.slice(0, 3).map(x => x.name).join(', ')}${nov.etapas_novas.length > 3 ? '…' : ''}`);
  if (nov.etapas_removidas?.length) chips.push(`🗑 ${nov.etapas_removidas.length} etapa(s) removida(s) do ADVBOX (template desativado automaticamente)`);
  if (nov.tarefas_novas?.length) chips.push(`🆕 ${nov.tarefas_novas.length} tipo(s) de tarefa novo(s): ${nov.tarefas_novas.slice(0, 3).map(x => x.name).join(', ')}${nov.tarefas_novas.length > 3 ? '…' : ''}`);
  if (nov.tarefas_removidas?.length) chips.push(`🗑 ${nov.tarefas_removidas.length} tipo(s) de tarefa removido(s) (template desativado)`);

  const tudoOk = info.etapasPend === 0 && info.tarefasPend === 0 && chips.length === 0;
  if (tudoOk) return null; // nada pendente — nao ocupa espaco

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 px-3 py-2 mb-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <WrenchScrewdriverIcon className="w-4 h-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
        <b>Parametrização pendente:</b>
        <button className="underline decoration-dotted hover:opacity-70" onClick={() => onGoTo?.('etapas')}>
          {info.etapasPend} de {info.etapasTotal} etapas sem texto
        </button>
        <span className="opacity-40">·</span>
        <button className="underline decoration-dotted hover:opacity-70" onClick={() => onGoTo?.('tarefas')}>
          {info.tarefasPend} de {info.tarefasTotal} tarefas sem texto
        </button>
        {info.ignoradas > 0 && <span className="opacity-50">({info.ignoradas} ignoradas fora da conta)</span>}
        <button className="ml-auto opacity-50 hover:opacity-100" title="Atualizar" onClick={load}>
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      {chips.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {chips.map((c, i) => <div key={i} className="opacity-80">{c}</div>)}
        </div>
      )}
      {info.syncedAt && <div className="mt-0.5 opacity-40">catálogo sincronizado {new Date(info.syncedAt).toLocaleString('pt-BR')}</div>}
    </div>
  );
}
