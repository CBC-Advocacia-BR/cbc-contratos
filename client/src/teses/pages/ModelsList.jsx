import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Button, Card, CardBody, Input, Select, StatusBadge, Spinner, EmptyState, Label } from '../components/ui/Primitives';
import { useRoute } from '../router';
import { useTesesAuth } from '../contexts/AuthContext';

export default function ModelsListPage() {
  const { navigate } = useRoute();
  const { profile, is } = useTesesAuth();
  const [models, setModels] = useState([]);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ theme: '', status: '', q: '' });
  const [creating, setCreating] = useState(false);
  const [newModel, setNewModel] = useState({ name: '', theme_id: '', description: '' });

  const canWrite = is('admin', 'coordenador', 'especialista');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [m, t] = await Promise.all([
        supabase
          .from('models')
          .select('id,name,description,status,version,theme_id,updated_at,created_by')
          .order('updated_at', { ascending: false }),
        supabase.from('themes').select('*').eq('is_active', true).order('display_order'),
      ]);
      if (!mounted) return;
      setModels(m.data || []);
      setThemes(t.data || []);
      if (t.data?.length) setNewModel((v) => ({ ...v, theme_id: t.data[0].id }));
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    return models
      .filter((m) => !filter.theme || m.theme_id === filter.theme)
      .filter((m) => !filter.status || m.status === filter.status)
      .filter((m) => !filter.q || m.name.toLowerCase().includes(filter.q.toLowerCase()));
  }, [models, filter]);

  const themesById = useMemo(() => Object.fromEntries(themes.map((t) => [t.id, t])), [themes]);

  const createModel = async (e) => {
    e.preventDefault();
    if (!newModel.name.trim() || !newModel.theme_id) return;
    const { data, error } = await supabase
      .from('models')
      .insert({
        name: newModel.name.trim(),
        theme_id: newModel.theme_id,
        description: newModel.description,
        created_by: profile?.id || null,
        status: 'rascunho',
        version: 1,
      })
      .select()
      .single();
    if (error) { alert(error.message); return; }
    setCreating(false);
    setNewModel({ name: '', theme_id: themes[0]?.id || '', description: '' });
    navigate(`/models/${data.id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Modelos de petição</h1>
          <p className="text-xs text-slate-500">Banco de modelos do escritório.</p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancelar' : '+ Novo modelo'}
          </Button>
        )}
      </div>

      {creating && (
        <Card>
          <form onSubmit={createModel}>
            <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Label required>Nome do modelo</Label>
                <Input
                  value={newModel.name}
                  onChange={(e) => setNewModel((v) => ({ ...v, name: e.target.value }))}
                  placeholder="Ex: Impugnação à exceção — Modelo padrão"
                  autoFocus
                />
              </div>
              <div>
                <Label required>Tema</Label>
                <Select
                  value={newModel.theme_id}
                  onChange={(e) => setNewModel((v) => ({ ...v, theme_id: e.target.value }))}
                >
                  {themes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-3">
                <Label>Descrição</Label>
                <Input
                  value={newModel.description}
                  onChange={(e) => setNewModel((v) => ({ ...v, description: e.target.value }))}
                  placeholder="Quando usar este modelo"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button type="submit" variant="success">Criar rascunho</Button>
              </div>
            </CardBody>
          </form>
        </Card>
      )}

      <Card>
        <CardBody className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label>Buscar</Label>
            <Input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="Nome do modelo" />
          </div>
          <div>
            <Label>Tema</Label>
            <Select value={filter.theme} onChange={(e) => setFilter((f) => ({ ...f, theme: e.target.value }))}>
              <option value="">Todos</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
              <option value="">Todos</option>
              <option value="rascunho">Rascunho</option>
              <option value="em_revisao">Em revisão</option>
              <option value="aprovado">Aprovado</option>
              <option value="obsoleto">Obsoleto</option>
            </Select>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando modelos...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nenhum modelo encontrado"
          description="Crie seu primeiro modelo ou ajuste os filtros de busca."
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-5 py-3">Nome</th>
                <th className="px-5 py-3">Tema</th>
                <th className="px-5 py-3">Versão</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/models/${m.id}`)}
                >
                  <td className="px-5 py-3">
                    <div className="font-bold text-slate-800">{m.name}</div>
                    {m.description && <div className="text-[11px] text-slate-500">{m.description}</div>}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">{themesById[m.theme_id]?.name || '—'}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">v{m.version}</td>
                  <td className="px-5 py-3"><StatusBadge status={m.status} /></td>
                  <td className="px-5 py-3 text-xs text-slate-500">
                    {new Date(m.updated_at).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
