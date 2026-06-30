import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { botApi } from './botApi';
import { PlusIcon, TrashIcon, MagnifyingGlassIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

export default function BotTestadores() {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({ phone: '', name: '' });
  const [linkFor, setLinkFor] = useState(null); // id do testador buscando cliente
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bot_testers').select('*').order('created_at');
    if (error) setErr(error.message); else setRows(data || []);
  }, []);
  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const phone = draft.phone.replace(/\D/g, '');
    if (phone.length < 10) { setErr('Telefone inválido — use DDI+DDD+número, ex.: 5519999999999'); return; }
    const { error } = await supabase.from('bot_testers').insert({ phone, name: draft.name.trim() || 'Testador' });
    if (error) { setErr(error.message); return; }
    setDraft({ phone: '', name: '' }); setErr(''); load();
  };

  const remove = async (row) => {
    await supabase.from('bot_testers').delete().eq('id', row.id);
    load();
  };

  const toggle = async (row) => {
    await supabase.from('bot_testers').update({ active: !row.active }).eq('id', row.id);
    load();
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await botApi('search_customers', { query });
      setResults(r.customers || []);
    } catch (e) { setErr(e.message); setResults([]); }
    setSearching(false);
  };

  const link = async (tester, customer) => {
    await supabase.from('bot_testers').update({ advbox_customer_id: customer.id, advbox_customer_name: customer.name }).eq('id', tester.id);
    setLinkFor(null); setResults(null); setQuery(''); load();
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 text-xs opacity-80">
        <b>Modo teste seguro:</b> no WhatsApp (via Kommo), o bot <b>só responde a números cadastrados aqui</b> —
        clientes reais nunca recebem resposta automática durante os testes. Vincule cada testador a um cliente do
        ADVBOX para “se passar por ele”; dá para trocar a qualquer momento aqui ou pelo WhatsApp com
        <code> #cliente nome</code> / <code>#processo número</code>.
      </div>
      {err && <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/30">{err}</div>}

      <div className="card p-4 grid md:grid-cols-12 gap-2 items-end">
        <div className="md:col-span-4">
          <label className="text-[11px] font-bold uppercase opacity-60">Telefone (com DDI)</label>
          <input className="input-field w-full text-sm" placeholder="5519999999999" value={draft.phone}
            onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} />
        </div>
        <div className="md:col-span-6">
          <label className="text-[11px] font-bold uppercase opacity-60">Nome do testador</label>
          <input className="input-field w-full text-sm" placeholder="Ex.: Paulo (celular pessoal)" value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        </div>
        <div className="md:col-span-2">
          <button className="btn-primary w-full py-2 flex items-center justify-center gap-1" onClick={add}>
            <PlusIcon className="w-4 h-4" /> Adicionar
          </button>
        </div>
      </div>

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase opacity-60 border-b">
            <th className="p-2">Telefone</th><th className="p-2">Testador</th><th className="p-2">Simulando cliente</th><th className="p-2">Status</th><th className="p-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-xs opacity-50">Nenhum testador cadastrado. Adicione seu celular pessoal acima.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className={r.active ? '' : 'opacity-40'}>
                <td className="p-2 font-mono text-xs">{r.phone}</td>
                <td className="p-2">{r.name}</td>
                <td className="p-2 text-xs">
                  {r.advbox_customer_name
                    ? <span className="px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">{r.advbox_customer_name}</span>
                    : <span className="opacity-50">— identificação pelo telefone real</span>}
                  <button className="text-[11px] underline ml-2 opacity-60 hover:opacity-100"
                    onClick={() => { setLinkFor(linkFor === r.id ? null : r.id); setResults(null); setQuery(''); }}>
                    {r.advbox_customer_id ? 'trocar' : 'vincular cliente'}
                  </button>
                  {linkFor === r.id && (
                    <div className="mt-2 p-2 border rounded-lg bg-gray-50 dark:bg-gray-800">
                      <div className="flex gap-1">
                        <input className="input-field flex-1 text-xs" placeholder="Nome ou CPF no ADVBOX" value={query}
                          onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
                        <button className="btn-outline px-2" onClick={search}>
                          {searching ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <MagnifyingGlassIcon className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      {results && (
                        <div className="mt-1 max-h-36 overflow-auto">
                          {results.length === 0 && <div className="text-[11px] opacity-50 p-1">Nada encontrado.</div>}
                          {results.map(c => (
                            <button key={c.id} className="block w-full text-left text-xs p-1.5 hover:bg-white dark:hover:bg-gray-700 rounded" onClick={() => link(r, c)}>
                              {c.name} <span className="opacity-50">{c.identification || ''} · {c.lawsuits} processo(s)</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="p-2">
                  <button className={`text-[11px] px-2 py-0.5 rounded-full ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`} onClick={() => toggle(r)}>
                    {r.active ? 'ativo' : 'inativo'}
                  </button>
                </td>
                <td className="p-2 text-right">
                  <button className="opacity-40 hover:opacity-100 hover:text-red-600" onClick={() => remove(r)}><TrashIcon className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
