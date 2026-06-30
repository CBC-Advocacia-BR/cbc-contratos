import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { botApi } from './botApi';
import {
  BellAlertIcon, CheckCircleIcon, ClipboardDocumentIcon, ArrowPathIcon, PlayIcon, CheckIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

const KIND_LABEL = { movement: '⚖️ Andamento', task_created: '📋 Tarefa criada', task_completed: '✅ Tarefa concluída' };

// Cabecalho ordenavel (componente estatico — fora do render)
function Th({ col, sort, onSort, children }) {
  const arrow = sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th className="p-2 cursor-pointer select-none hover:opacity-100" onClick={() => onSort(col)} title="Clique para ordenar">
      {children}{arrow}
    </th>
  );
}

export default function BotNovidades() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onlyPending, setOnlyPending] = useState(true);
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [msg, setMsg] = useState('');
  const [busca, setBusca] = useState('');        // pesquisa por processo/cliente (servidor)
  const [buscaInput, setBuscaInput] = useState('');
  const [sort, setSort] = useState({ col: 'created_at', dir: 'desc' });

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('bot_sync_state').select('*').order('created_at', { ascending: false }).limit(200);
    if (onlyPending) q = q.eq('communicated', false);
    const term = busca.trim().replace(/[,%]/g, '');
    if (term) q = q.or(`process_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
    const { data } = await q;
    setRows(data || []);
    const { data: st } = await supabase.from('bot_config').select('value').eq('key', 'monitor_status').maybeSingle();
    setStatus(st?.value || null);
    setLoading(false);
  }, [onlyPending, busca]);

  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const runMonitor = async () => {
    setRunning(true); setMsg('');
    try {
      await fetch('/.netlify/functions/advbox-monitor', { method: 'POST' });
      setMsg('Monitor disparado! Ele roda em segundo plano — atualize em ~1 minuto.');
    } catch (e) { setMsg(`Erro: ${e.message}`); }
    setRunning(false);
  };

  const copyReply = async (row) => {
    if (!row.lawsuit_id) return;
    try {
      const r = await botApi('preview', { lawsuit_id: row.lawsuit_id, customer_name: row.customer_name || '' });
      await navigator.clipboard.writeText(r.reply);
      setCopiedId(row.id); setTimeout(() => setCopiedId(null), 2000);
    } catch (e) { setMsg(`Erro ao gerar resposta: ${e.message}`); }
  };

  const markDone = async (row) => {
    await supabase.from('bot_sync_state')
      .update({ communicated: true, communicated_at: new Date().toISOString() })
      .eq('id', row.id);
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, communicated: true } : r));
  };

  const pendentes = rows.filter(r => !r.communicated).length;

  // ordenacao client-side (clique no cabecalho)
  const toggleSort = (col) => setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }));
  const sorted = useMemo(() => {
    const val = (r) => {
      switch (sort.col) {
        case 'kind': return r.kind || '';
        case 'event_date': return r.event_date || '';
        case 'processo': return `${r.process_number || ''} ${r.customer_name || ''}`;
        case 'title': return r.title || '';
        default: return r.created_at || '';
      }
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => String(val(a)).localeCompare(String(val(b)), 'pt-BR') * dir);
  }, [rows, sort]);
  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <BellAlertIcon className="w-5 h-5 text-amber-600" />
        <div className="flex-1 min-w-[220px]">
          <div className="font-bold text-sm">{pendentes} novidade(s) ainda não comunicada(s) ao cliente</div>
          <div className="text-xs opacity-60">
            {status?.last_run
              ? `Último monitoramento: ${new Date(status.last_run).toLocaleString('pt-BR')} — ${status.movimentos_novos ?? 0} andamentos, ${status.tarefas_criadas ?? 0} tarefas novas, ${status.tarefas_concluidas ?? 0} concluídas, ${status.notas_postadas ?? 0} notas no Kommo`
              : 'O monitor ainda não rodou. Ele roda automaticamente às 09h e 18h.'}
          </div>
        </div>
        <label className="text-xs flex items-center gap-1.5">
          <input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} />
          só não comunicadas
        </label>
        <button className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1" onClick={load}>
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
        <button className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1" onClick={runMonitor} disabled={running}>
          <PlayIcon className="w-3.5 h-3.5" /> Rodar monitor agora
        </button>
      </div>
      {msg && <div className="text-xs p-2 rounded bg-blue-50 dark:bg-blue-900/30">{msg}</div>}
      {status?.erros?.length > 0 && (
        <div className="text-xs p-2 rounded bg-amber-50 dark:bg-amber-900/30">⚠️ Erros no último monitor: {status.erros.slice(0, 3).join(' · ')}</div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
          <input className="input-field w-full pl-8 text-sm" placeholder="Pesquisar por número do processo ou nome do cliente…"
            value={buscaInput} onChange={e => setBuscaInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setBusca(buscaInput)} />
        </div>
        <button className="btn-outline text-xs px-3" onClick={() => setBusca(buscaInput)}>Buscar</button>
        {busca && <button className="text-xs underline opacity-60" onClick={() => { setBusca(''); setBuscaInput(''); }}>limpar</button>}
      </div>

      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide opacity-60 border-b">
              <Th col="kind" sort={sort} onSort={toggleSort}>Tipo</Th>
              <Th col="event_date" sort={sort} onSort={toggleSort}>Data</Th>
              <Th col="processo" sort={sort} onSort={toggleSort}>Processo / Cliente</Th>
              <Th col="title" sort={sort} onSort={toggleSort}>Detalhe</Th>
              <th className="p-2">Kommo</th><th className="p-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-xs opacity-50">
                {loading ? 'Carregando…' : busca ? `Nada encontrado para "${busca}".` : 'Nenhuma novidade registrada ainda. Rode o monitor para buscar andamentos e tarefas no ADVBOX.'}
              </td></tr>
            )}
            {sorted.map(r => (
              <tr key={r.id} className={r.communicated ? 'opacity-50' : ''}>
                <td className="p-2 whitespace-nowrap text-xs">{KIND_LABEL[r.kind] || r.kind}</td>
                <td className="p-2 whitespace-nowrap text-xs">{r.event_date ? r.event_date.split('-').reverse().join('/') : '-'}</td>
                <td className="p-2 text-xs">
                  <div className="font-medium">{r.process_number || (r.lawsuit_id ? `#${r.lawsuit_id}` : '-')}</div>
                  <div className="opacity-60">{r.customer_name || ''}</div>
                </td>
                <td className="p-2 text-xs max-w-md"><div className="line-clamp-2">{r.title}</div></td>
                <td className="p-2 text-xs whitespace-nowrap">{r.kommo_note_posted ? '📝 nota ok' : (r.kommo_lead_id ? 'lead ' + r.kommo_lead_id : '—')}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  {r.lawsuit_id && (
                    <button className="btn-outline text-[11px] px-2 py-1 mr-1" title="Gerar resposta pronta e copiar"
                      onClick={() => copyReply(r)}>
                      {copiedId === r.id ? <CheckIcon className="w-3.5 h-3.5 inline text-green-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5 inline" />}
                      <span className="ml-1">{copiedId === r.id ? 'Copiado!' : 'Resposta pronta'}</span>
                    </button>
                  )}
                  {!r.communicated && (
                    <button className="text-[11px] px-2 py-1 text-green-700 hover:underline" onClick={() => markDone(r)}>
                      <CheckCircleIcon className="w-3.5 h-3.5 inline mr-0.5" />comunicado
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
