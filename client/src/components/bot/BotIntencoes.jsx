import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { classifyIntentLocal } from './botApi';
import { PlusIcon, TrashIcon, CheckIcon, BeakerIcon } from '@heroicons/react/24/outline';

const ACTIONS = [
  { value: 'andamento', label: 'Consultar andamento (ADVBOX)' },
  { value: 'audiencia', label: 'Audiências / agenda (ADVBOX)' },
  { value: 'tarefas', label: 'O que o escritório está fazendo (ADVBOX)' },
  { value: 'template', label: 'Resposta fixa (texto abaixo)' },
  { value: 'humano', label: 'Escalar para humano (cria tarefa no Kommo)' },
];

const EMPTY = { intent_key: '', name: '', keywords: '', action: 'template', response_template: '', priority: 100, active: true };

export default function BotIntencoes() {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(EMPTY);
  const [savedId, setSavedId] = useState(null);
  const [test, setTest] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bot_intents').select('*').order('priority');
    if (error) setErr(error.message); else setRows(data || []);
  }, []);
  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const kwToArray = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

  const add = async () => {
    if (!draft.intent_key.trim() || !draft.name.trim()) return;
    const { error } = await supabase.from('bot_intents').insert({
      ...draft,
      intent_key: draft.intent_key.trim().toLowerCase().replace(/\s+/g, '_'),
      keywords: kwToArray(draft.keywords),
      priority: Number(draft.priority) || 100,
    });
    if (error) { setErr(error.message); return; }
    setDraft(EMPTY); load();
  };

  const update = async (row, patch) => {
    const next = { ...row, ...patch };
    setRows(rs => rs.map(r => r.id === row.id ? next : r));
    const { error } = await supabase.from('bot_intents').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id);
    if (error) setErr(error.message);
    else { setSavedId(row.id); setTimeout(() => setSavedId(null), 1200); }
  };

  const testMatch = test.trim() ? classifyIntentLocal(test, rows) : null;

  return (
    <div className="space-y-4">
      <div className="card p-4 text-xs opacity-80">
        <b>Classificador de intenção:</b> o bot lê a mensagem do cliente e procura as <b>palavras-chave</b> (sem acentos,
        sem diferenciar maiúsculas). A intenção de <b>menor prioridade numérica</b> vence em caso de empate.
        Mensagens sem correspondência caem no texto “fallback” (aba Config).
      </div>
      {err && <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/30">{err}</div>}

      <div className="card p-4">
        <label className="text-[11px] font-bold uppercase tracking-wide opacity-60 flex items-center gap-1"><BeakerIcon className="w-3.5 h-3.5" /> Testar classificação</label>
        <input className="input-field w-full text-sm mt-1" placeholder='Ex.: "oi, queria saber se o juiz já decidiu"'
          value={test} onChange={e => setTest(e.target.value)} />
        {test.trim() && (
          <div className={`mt-2 text-sm p-2 rounded ${testMatch ? 'bg-green-50 dark:bg-green-900/20' : 'bg-amber-50 dark:bg-amber-900/20'}`}>
            {testMatch ? <>✅ Intenção: <b>{testMatch.name}</b> ({testMatch.intent_key}) → ação: {testMatch.action}</> : '⚠️ Nenhuma intenção casou — cairia no fallback.'}
          </div>
        )}
      </div>

      {rows.filter(r => r.active).map(r => (
        <div key={r.id} className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-sm">{r.name} <span className="text-[10px] opacity-40">({r.intent_key})</span></span>
            <div className="flex items-center gap-2">
              {savedId === r.id && <CheckIcon className="w-4 h-4 text-green-600" />}
              <input type="number" className="input-field w-16 text-xs" title="Prioridade (menor vence)" value={r.priority}
                onChange={e => update(r, { priority: Number(e.target.value) || 100 })} />
              <button className="opacity-40 hover:opacity-100 hover:text-red-600" title="Desativar" onClick={() => update(r, { active: false }) && load()}>
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold uppercase opacity-60">Palavras-chave (separadas por vírgula)</label>
              <textarea className="input-field w-full text-xs" rows={2} value={(r.keywords || []).join(', ')}
                onChange={e => update(r, { keywords: kwToArray(e.target.value) })} />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase opacity-60">Ação</label>
              <select className="input-field w-full text-sm" value={r.action} onChange={e => update(r, { action: e.target.value })}>
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              {['template', 'humano'].includes(r.action) && (
                <textarea className="input-field w-full text-xs mt-1" rows={2} placeholder="Resposta enviada ao cliente…"
                  value={r.response_template || ''} onChange={e => update(r, { response_template: e.target.value })} />
              )}
            </div>
          </div>
        </div>
      ))}

      {/* nova intencao */}
      <div className="card p-4 grid md:grid-cols-12 gap-2 items-end">
        <div className="md:col-span-2">
          <label className="text-[11px] font-bold uppercase opacity-60">Chave</label>
          <input className="input-field w-full text-sm" value={draft.intent_key} onChange={e => setDraft(d => ({ ...d, intent_key: e.target.value }))} placeholder="ex.: indicacao" />
        </div>
        <div className="md:col-span-3">
          <label className="text-[11px] font-bold uppercase opacity-60">Nome</label>
          <input className="input-field w-full text-sm" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Ex.: Indicação de amigo" />
        </div>
        <div className="md:col-span-4">
          <label className="text-[11px] font-bold uppercase opacity-60">Palavras-chave</label>
          <input className="input-field w-full text-sm" value={draft.keywords} onChange={e => setDraft(d => ({ ...d, keywords: e.target.value }))} placeholder="indicar, indicação, amigo quer processar" />
        </div>
        <div className="md:col-span-2">
          <label className="text-[11px] font-bold uppercase opacity-60">Ação</label>
          <select className="input-field w-full text-sm" value={draft.action} onChange={e => setDraft(d => ({ ...d, action: e.target.value }))}>
            {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <div className="md:col-span-1">
          <button className="btn-primary w-full py-2 flex justify-center" onClick={add}><PlusIcon className="w-4 h-4" /></button>
        </div>
        {['template', 'humano'].includes(draft.action) && (
          <div className="md:col-span-12">
            <textarea className="input-field w-full text-xs" rows={2} placeholder="Resposta fixa para esta intenção…"
              value={draft.response_template} onChange={e => setDraft(d => ({ ...d, response_template: e.target.value }))} />
          </div>
        )}
      </div>
    </div>
  );
}
