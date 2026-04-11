import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Button, Card, CardBody, Input, Label, Select, Spinner, EmptyState, Badge } from '../components/ui/Primitives';
import { useRoute } from '../router';
import { useTesesAuth } from '../contexts/AuthContext';

export default function ResortsListPage() {
  const { navigate } = useRoute();
  const { profile, is } = useTesesAuth();
  const [resorts, setResorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ q: '', category: '' });
  const [creating, setCreating] = useState(false);
  const [newResort, setNewResort] = useState({ trade_name: '', category: 'principal' });

  const canWrite = is('admin', 'coordenador');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from('resorts')
        .select('*')
        .order('trade_name');
      if (mounted) { setResorts(data || []); setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    return resorts
      .filter((r) => !filter.category || r.category === filter.category)
      .filter((r) => !filter.q || r.trade_name.toLowerCase().includes(filter.q.toLowerCase())
        || (r.cnpj || '').includes(filter.q));
  }, [resorts, filter]);

  const createResort = async (e) => {
    e.preventDefault();
    if (!newResort.trade_name.trim()) return;
    const { data, error } = await supabase
      .from('resorts')
      .insert({
        trade_name: newResort.trade_name.trim(),
        category: newResort.category,
        created_by: profile?.id || null,
        is_active: true,
      })
      .select()
      .single();
    if (error) { alert(error.message); return; }
    navigate(`/resorts/${data.id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Resorts e grupos econômicos</h1>
          <p className="text-xs text-slate-500">Fichas consolidadas para uso nas petições.</p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancelar' : '+ Nova ficha'}
          </Button>
        )}
      </div>

      {creating && (
        <Card>
          <form onSubmit={createResort}>
            <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Label required>Nome fantasia</Label>
                <Input value={newResort.trade_name} onChange={(e) => setNewResort((v) => ({ ...v, trade_name: e.target.value }))} autoFocus />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={newResort.category} onChange={(e) => setNewResort((v) => ({ ...v, category: e.target.value }))}>
                  <option value="principal">Principal</option>
                  <option value="pontual">Pontual</option>
                </Select>
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button type="submit" variant="success">Criar ficha</Button>
              </div>
            </CardBody>
          </form>
        </Card>
      )}

      <Card>
        <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Buscar</Label>
            <Input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="Nome ou CNPJ" />
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}>
              <option value="">Todas</option>
              <option value="principal">Principal</option>
              <option value="pontual">Pontual</option>
            </Select>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum resort encontrado" description="Ajuste os filtros ou crie uma nova ficha." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-5 py-3">Nome fantasia</th>
                <th className="px-5 py-3">Razão social</th>
                <th className="px-5 py-3">CNPJ</th>
                <th className="px-5 py-3">Grupo</th>
                <th className="px-5 py-3">Categoria</th>
                <th className="px-5 py-3">UF</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/resorts/${r.id}`)}>
                  <td className="px-5 py-3 font-bold text-slate-800">{r.trade_name}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">{r.legal_name || '—'}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">{r.cnpj || '—'}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">{r.economic_group || '—'}</td>
                  <td className="px-5 py-3">
                    <Badge color={r.category === 'principal' ? 'blue' : 'slate'}>
                      {r.category === 'principal' ? 'Principal' : 'Pontual'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">{r.state || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
