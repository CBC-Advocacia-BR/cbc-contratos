import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { botApi, normalize } from './botApi';
import { ArrowPathIcon, CheckIcon } from '@heroicons/react/24/outline';

export default function BotTarefas() {
  const [tasks, setTasks] = useState([]);       // tipos de tarefa do ADVBOX
  const [templates, setTemplates] = useState({}); // task_id -> row
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [filter, setFilter] = useState('');
  const [soPendentes, setSoPendentes] = useState(false);
  const [novasIds, setNovasIds] = useState(() => new Set());
  const [ignoreTerms, setIgnoreTerms] = useState([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [{ settings }, { data: tpl }, { data: cfgRows }] = await Promise.all([
        botApi('settings'),
        supabase.from('bot_task_templates').select('*'),
        supabase.from('bot_config').select('key, value').in('key', ['catalogo', 'monitor']),
      ]);
      const raw = settings?.tasks || settings?.task || [];
      setTasks(raw.map(t => ({ id: t.id, name: t.task || t.name || t.title || `Tarefa ${t.id}` })));
      const map = {};
      for (const t of tpl || []) map[t.task_id] = t;
      setTemplates(map);
      const cfg = {};
      for (const r of cfgRows || []) cfg[r.key] = r.value || {};
      setNovasIds(new Set(((cfg.catalogo?.novidades?.tarefas_novas) || []).map(x => Number(x.id))));
      setIgnoreTerms(cfg.monitor?.tarefas_ignoradas || []);
    } catch (e) { setErr(`Erro ao carregar tipos de tarefa do ADVBOX: ${e.message}`); }
    setLoading(false);
  }, []);

  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const edit = (taskId, field, value) => {
    setTemplates(t => ({ ...t, [taskId]: { ...(t[taskId] || { task_id: taskId, active: true, texto_pendente: '', texto_concluida: '', notificar: false }), [field]: value } }));
  };

  const save = async (task) => {
    const t = templates[task.id] || {};
    setSavingId(task.id);
    const { error } = await supabase.from('bot_task_templates').upsert({
      task_id: task.id, task_name: task.name,
      texto_pendente: t.texto_pendente || '', texto_concluida: t.texto_concluida || '',
      notificar: !!t.notificar, active: t.active !== false,
      ocultar_cliente: !!t.ocultar_cliente,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'task_id' });
    if (error) setErr(`Erro ao salvar: ${error.message}`);
    else { setSavedId(task.id); setTimeout(() => setSavedId(null), 1500); }
    setSavingId(null);
  };

  // salva o toggle de visibilidade na hora (sem precisar clicar em Salvar)
  const toggleOcultar = async (task, value) => {
    edit(task.id, 'ocultar_cliente', value);
    const t = { ...(templates[task.id] || {}), ocultar_cliente: value };
    await supabase.from('bot_task_templates').upsert({
      task_id: task.id, task_name: task.name,
      texto_pendente: t.texto_pendente || '', texto_concluida: t.texto_concluida || '',
      notificar: !!t.notificar, active: t.active !== false, ocultar_cliente: value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'task_id' });
    setSavedId(task.id); setTimeout(() => setSavedId(null), 1200);
  };

  if (loading) return <div className="p-6 text-sm opacity-60 flex items-center gap-2"><ArrowPathIcon className="w-4 h-4 animate-spin" />Carregando tipos de tarefa do ADVBOX…</div>;

  const isIgnored = (name) => ignoreTerms.some(term => term && normalize(name).includes(normalize(term)));
  const pendente = (task) => { const t = templates[task.id]; return !(t && t.active !== false && (t.texto_pendente || t.texto_concluida)); };
  const visible = tasks.filter(t =>
    (!filter || t.name.toLowerCase().includes(filter.toLowerCase())) &&
    (!soPendentes || (pendente(t) && !isIgnored(t.name))));
  const configured = Object.values(templates).filter(t => t.texto_pendente || t.texto_concluida).length;

  return (
    <div className="space-y-4">
      <div className="card p-4 text-xs opacity-80">
        <b>“O que o escritório está fazendo”:</b> para cada tipo de tarefa do ADVBOX, defina como o bot descreve a
        tarefa ao cliente quando ela está <b>pendente</b> e quando foi <b>concluída</b>.
        <b> 🚫 Ocultar do cliente</b> = a tarefa nunca aparece para o cliente (bot, notas do Kommo, novidades),
        mas <b>continua indo para o banco e para o BI</b> normalmente — use para tarefas internas
        (comentários, publicação tratada, conferências). <b>{configured}</b> de {tasks.length} tipos com texto.
      </div>
      {err && <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/30">{err}</div>}
      <div className="flex flex-wrap items-center gap-3 gap-y-1.5">
        <input className="input-field flex-1 text-sm" placeholder="Filtrar tipos de tarefa…" value={filter} onChange={e => setFilter(e.target.value)} />
        <label className="text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={soPendentes} onChange={e => setSoPendentes(e.target.checked)} />
          só pendentes
        </label>
      </div>
      {visible.map(task => {
        const t = templates[task.id] || {};
        const has = t.texto_pendente || t.texto_concluida;
        return (
          <div key={task.id} className={`card p-3 ${has ? 'border-l-4 border-l-green-500' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-y-1.5 mb-1.5">
              <span className="font-bold text-sm">
                {task.name}
                {novasIds.has(Number(task.id)) && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 uppercase">nova</span>}
                {isIgnored(task.name) && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 opacity-70 uppercase">ignorada</span>}
                <span className="text-[10px] opacity-40 ml-2">id {task.id}</span>
              </span>
              <div className="flex flex-wrap items-center gap-3 gap-y-1.5">
                <label className={`text-xs flex items-center gap-1 cursor-pointer ${t.ocultar_cliente || isIgnored(task.name) ? 'text-red-600 dark:text-red-400 font-bold' : ''}`}
                  title="Oculta do cliente: não aparece nas respostas do bot, não vira nota no Kommo nem alerta de novidade. Continua indo para o banco/BI normalmente.">
                  <input type="checkbox" checked={!!t.ocultar_cliente || isIgnored(task.name)} disabled={isIgnored(task.name)}
                    onChange={e => toggleOcultar(task, e.target.checked)} />
                  🚫 ocultar do cliente{isIgnored(task.name) ? ' (regra automática)' : ''}
                </label>
                <label className="text-xs flex items-center gap-1" title="Marcar como relevante para comunicar o cliente quando concluída">
                  <input type="checkbox" checked={!!t.notificar} onChange={e => edit(task.id, 'notificar', e.target.checked)} /> relevante p/ cliente
                </label>
                <button className="btn-primary text-xs px-3 py-1" onClick={() => save(task)} disabled={savingId === task.id}>
                  {savedId === task.id ? <CheckIcon className="w-3.5 h-3.5 inline" /> : 'Salvar'}
                </button>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              <input className="input-field text-sm" placeholder="Pendente — ex.: estamos elaborando o seu recurso"
                value={t.texto_pendente || ''} onChange={e => edit(task.id, 'texto_pendente', e.target.value)} />
              <input className="input-field text-sm" placeholder="Concluída — ex.: protocolamos o recurso no tribunal"
                value={t.texto_concluida || ''} onChange={e => edit(task.id, 'texto_concluida', e.target.value)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
