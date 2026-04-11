import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, CardBody, Input, Label, Select, Spinner, EmptyState } from '../components/ui/Primitives';
import { useTesesAuth } from '../contexts/AuthContext';

export default function HistoryPage() {
  const { is } = useTesesAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ q: '', from: '', to: '' });
  const [modelsById, setModelsById] = useState({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from('generated_petitions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      const ms = await supabase.from('models').select('id,name');
      if (!mounted) return;
      setItems(data || []);
      setModelsById(Object.fromEntries((ms.data || []).map((m) => [m.id, m])));
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    return items.filter((p) => {
      if (filter.q) {
        const q = filter.q.toLowerCase();
        const hay = [p.customer_name, p.process_number, modelsById[p.model_id]?.name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter.from && new Date(p.created_at) < new Date(filter.from)) return false;
      if (filter.to && new Date(p.created_at) > new Date(filter.to + 'T23:59:59')) return false;
      return true;
    });
  }, [items, filter, modelsById]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Histórico de petições</h1>
        <p className="text-xs text-slate-500">{is('admin', 'coordenador') ? 'Todas as petições da equipe.' : 'Suas petições geradas.'}</p>
      </div>

      <Card>
        <CardBody className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label>Buscar</Label>
            <Input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="Cliente, processo, modelo" />
          </div>
          <div>
            <Label>De</Label>
            <Input type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <Label>Até</Label>
            <Input type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhuma petição encontrada" description="Ajuste os filtros ou gere sua primeira petição." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-5 py-3">Data</th>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Processo</th>
                <th className="px-5 py-3">Modelo (versão)</th>
                <th className="px-5 py-3">Blocos</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3 text-xs text-slate-500">{new Date(p.created_at).toLocaleString('pt-BR')}</td>
                  <td className="px-5 py-3 font-bold text-slate-800">{p.customer_name || '—'}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">{p.process_number || '—'}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    {modelsById[p.model_id]?.name || '—'} <span className="text-slate-400">v{p.model_version}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{(p.selected_blocks || []).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
