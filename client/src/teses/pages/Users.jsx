import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, Button, Select, Spinner, EmptyState, Badge } from '../components/ui/Primitives';
import { useTesesAuth } from '../contexts/AuthContext';

const ROLES = [
  { value: 'admin', label: 'Administrador' },
  { value: 'coordenador', label: 'Coordenador' },
  { value: 'especialista', label: 'Especialista' },
  { value: 'operacional', label: 'Operacional' },
];

export default function UsersPage() {
  const { is } = useTesesAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('*').order('full_name');
      setUsers(data || []);
      setLoading(false);
    })();
  }, []);

  const updateRole = async (id, role) => {
    await supabase.from('profiles').update({ role }).eq('id', id);
    setUsers((arr) => arr.map((u) => (u.id === id ? { ...u, role } : u)));
  };

  const toggleActive = async (u) => {
    await supabase.from('profiles').update({ is_active: !u.is_active }).eq('id', u.id);
    setUsers((arr) => arr.map((x) => (x.id === u.id ? { ...x, is_active: !x.is_active } : x)));
  };

  if (!is('admin')) {
    return <EmptyState title="Acesso restrito" description="Apenas administradores podem gerenciar usuários." />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Usuários do sistema</h1>
        <p className="text-xs text-slate-500">Atribua papéis e temas aos usuários da equipe.</p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>
      ) : users.length === 0 ? (
        <EmptyState title="Nenhum usuário cadastrado" description="Usuários são criados automaticamente no primeiro login via Google." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-5 py-3">Nome / E-mail</th>
                <th className="px-5 py-3">Perfil</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Temas</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="px-5 py-3">
                    <div className="font-bold text-slate-800">{u.full_name}</div>
                    <div className="text-[11px] text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-5 py-3 w-48">
                    <Select value={u.role} onChange={(e) => updateRole(u.id, e.target.value)}>
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </Select>
                  </td>
                  <td className="px-5 py-3">
                    <Badge color={u.is_active ? 'emerald' : 'slate'}>{u.is_active ? 'Ativo' : 'Inativo'}</Badge>
                  </td>
                  <td className="px-5 py-3 text-[10px] text-slate-500">
                    {(u.themes || []).length} tema(s)
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => toggleActive(u)}>
                      {u.is_active ? 'Desativar' : 'Ativar'}
                    </Button>
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
