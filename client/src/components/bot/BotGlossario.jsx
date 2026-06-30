import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { glossaryTranslateLocal } from './botApi';
import { PlusIcon, TrashIcon, CheckIcon, BeakerIcon } from '@heroicons/react/24/outline';

const EMPTY = { term: '', match_type: 'contains', translation: '', priority: 100, active: true };

export default function BotGlossario() {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(EMPTY);
  const [savedId, setSavedId] = useState(null);
  const [test, setTest] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bot_glossary').select('*').order('priority').order('id');
    if (error) setErr(error.message); else setRows(data || []);
  }, []);
  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.term.trim() || !draft.translation.trim()) return;
    const { error } = await supabase.from('bot_glossary').insert({ ...draft, priority: Number(draft.priority) || 100 });
    if (error) { setErr(error.message); return; }
    setDraft(EMPTY); load();
  };

  const update = async (row, patch) => {
    const next = { ...row, ...patch };
    setRows(rs => rs.map(r => r.id === row.id ? next : r));
    const { error } = await supabase.from('bot_glossary').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id);
    if (error) setErr(error.message);
    else { setSavedId(row.id); setTimeout(() => setSavedId(null), 1200); }
  };

  const remove = async (row) => {
    await supabase.from('bot_glossary').update({ active: false }).eq('id', row.id);
    load();
  };

  const testMatch = test.trim() ? glossaryTranslateLocal(test, rows) : null;

  return (
    <div className="space-y-4">
      <div className="card p-4 text-xs opacity-80">
        <b>Tradutor de juridiquês:</b> quando um andamento do tribunal contém o <b>termo</b>, o bot mostra a
        <b> tradução</b> em linguagem simples no lugar do texto técnico. Prioridade menor = avaliado primeiro
        (use prioridade baixa para termos específicos, alta para genéricos). Termos sem correspondência podem ser
        traduzidos pela IA (aba Config) ou exibidos como vieram do tribunal.
      </div>
      {err && <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/30">{err}</div>}

      {/* testar */}
      <div className="card p-4">
        <label className="text-[11px] font-bold uppercase tracking-wide opacity-60 flex items-center gap-1"><BeakerIcon className="w-3.5 h-3.5" /> Testar tradução</label>
        <input className="input-field w-full text-sm mt-1" placeholder='Cole um andamento real, ex.: "Conclusos para despacho"'
          value={test} onChange={e => setTest(e.target.value)} />
        {test.trim() && (
          <div className={`mt-2 text-sm p-2 rounded ${testMatch ? 'bg-green-50 dark:bg-green-900/20' : 'bg-amber-50 dark:bg-amber-900/20'}`}>
            {testMatch
              ? <>✅ Casou com <b>“{testMatch.term}”</b> → {testMatch.translation}</>
              : '⚠️ Nenhum termo do glossário casou — o bot mostraria o texto original (ou usaria a IA, se ativa).'}
          </div>
        )}
      </div>

      {/* novo termo */}
      <div className="card p-4 grid md:grid-cols-12 gap-2 items-end">
        <div className="md:col-span-3">
          <label className="text-[11px] font-bold uppercase opacity-60">Termo (juridiquês)</label>
          <input className="input-field w-full text-sm" value={draft.term} onChange={e => setDraft(d => ({ ...d, term: e.target.value }))} placeholder="Ex.: Conclusos para sentença" />
        </div>
        <div className="md:col-span-2">
          <label className="text-[11px] font-bold uppercase opacity-60">Tipo</label>
          <select className="input-field w-full text-sm" value={draft.match_type} onChange={e => setDraft(d => ({ ...d, match_type: e.target.value }))}>
            <option value="contains">contém</option><option value="exact">exato</option><option value="regex">regex</option>
          </select>
        </div>
        <div className="md:col-span-5">
          <label className="text-[11px] font-bold uppercase opacity-60">Tradução (linguagem simples)</label>
          <input className="input-field w-full text-sm" value={draft.translation} onChange={e => setDraft(d => ({ ...d, translation: e.target.value }))} placeholder="Ex.: O processo está com o juiz para a decisão final" />
        </div>
        <div className="md:col-span-1">
          <label className="text-[11px] font-bold uppercase opacity-60">Prior.</label>
          <input type="number" className="input-field w-full text-sm" value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} />
        </div>
        <div className="md:col-span-1">
          <button className="btn-primary w-full py-2 flex justify-center" onClick={add}><PlusIcon className="w-4 h-4" /></button>
        </div>
      </div>

      {/* lista */}
      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase opacity-60 border-b">
            <th className="p-2">Termo</th><th className="p-2">Tipo</th><th className="p-2">Tradução</th><th className="p-2">Prior.</th><th className="p-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.filter(r => r.active).map(r => (
              <tr key={r.id}>
                <td className="p-2 w-56"><input className="input-field w-full text-xs" value={r.term} onChange={e => update(r, { term: e.target.value })} /></td>
                <td className="p-2 w-24 text-xs">{r.match_type}</td>
                <td className="p-2"><input className="input-field w-full text-xs" value={r.translation} onChange={e => update(r, { translation: e.target.value })} /></td>
                <td className="p-2 w-16"><input type="number" className="input-field w-full text-xs" value={r.priority} onChange={e => update(r, { priority: Number(e.target.value) || 100 })} /></td>
                <td className="p-2 w-16 text-right whitespace-nowrap">
                  {savedId === r.id && <CheckIcon className="w-3.5 h-3.5 inline text-green-600 mr-1" />}
                  <button className="opacity-40 hover:opacity-100 hover:text-red-600" title="Desativar" onClick={() => remove(r)}><TrashIcon className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
