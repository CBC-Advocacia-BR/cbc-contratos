import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, CardBody, CardHeader, Button, Input, Label, Spinner, EmptyState } from '../components/ui/Primitives';
import { useTesesAuth } from '../contexts/AuthContext';

export default function ThemesPage() {
  const { is, profile } = useTesesAuth();
  const canWrite = is('admin', 'coordenador');
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('themes').select('*').order('display_order');
      setThemes(data || []);
      setLoading(false);
    })();
  }, []);

  const createTheme = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const { data, error } = await supabase
      .from('themes')
      .insert({ name: newName.trim(), display_order: (themes[themes.length - 1]?.display_order || 0) + 10, created_by: profile?.id || null })
      .select()
      .single();
    if (error) { alert(error.message); return; }
    setThemes((t) => [...t, data]);
    setNewName('');
  };

  const toggleActive = async (t) => {
    const { error } = await supabase.from('themes').update({ is_active: !t.is_active }).eq('id', t.id);
    if (!error) setThemes((arr) => arr.map((x) => (x.id === t.id ? { ...x, is_active: !x.is_active } : x)));
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Temas jurídicos</h1>
        <p className="text-xs text-slate-500">Organização dos modelos por área/tipo de peça.</p>
      </div>

      {canWrite && (
        <Card>
          <form onSubmit={createTheme}>
            <CardBody className="flex items-end gap-3">
              <div className="flex-1">
                <Label>Novo tema</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Exceções de suspeição" />
              </div>
              <Button type="submit" variant="success">Criar</Button>
            </CardBody>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>
      ) : themes.length === 0 ? (
        <EmptyState title="Nenhum tema cadastrado" />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {themes.map((t) => (
              <li key={t.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800">{t.name}</div>
                  {t.description && <div className="text-xs text-slate-500">{t.description}</div>}
                </div>
                {canWrite && (
                  <Button size="sm" variant={t.is_active ? 'outline' : 'success'} onClick={() => toggleActive(t)}>
                    {t.is_active ? 'Desativar' : 'Ativar'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
