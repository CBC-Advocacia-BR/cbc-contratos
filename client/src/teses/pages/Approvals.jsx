import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, CardBody, CardHeader, StatusBadge, Spinner, EmptyState, Button } from '../components/ui/Primitives';
import { useRoute } from '../router';

export default function ApprovalsPage() {
  const { navigate } = useRoute();
  const [pending, setPending] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [p, r] = await Promise.all([
        supabase.from('models').select('id,name,description,updated_at,version').eq('status', 'em_revisao').order('updated_at', { ascending: false }),
        supabase.from('models').select('id,name,version,approved_at').eq('status', 'aprovado').order('approved_at', { ascending: false }).limit(10),
      ]);
      setPending(p.data || []);
      setRecent(r.data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Painel de aprovações</h1>
        <p className="text-xs text-slate-500">Coordenação de modelos submetidos pela equipe.</p>
      </div>

      <Card>
        <CardHeader title={`Pendentes (${pending.length})`} subtitle="Aguardando revisão" />
        <CardBody>
          {pending.length === 0 ? (
            <div className="text-xs text-slate-500">Nada pendente no momento. 👌</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pending.map((m) => (
                <li key={m.id} className="py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800">{m.name}</div>
                    {m.description && <div className="text-xs text-slate-500">{m.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status="em_revisao" />
                    <Button size="sm" onClick={() => navigate(`/models/${m.id}`)}>Revisar</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recém aprovados" />
        <CardBody>
          {recent.length === 0 ? (
            <div className="text-xs text-slate-500">Nenhum modelo aprovado recentemente.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((m) => (
                <li key={m.id} className="py-2 flex items-center justify-between text-xs">
                  <button onClick={() => navigate(`/models/${m.id}`)} className="font-bold text-slate-800 hover:text-blue-600 cursor-pointer">
                    {m.name} · v{m.version}
                  </button>
                  <span className="text-slate-400">{m.approved_at ? new Date(m.approved_at).toLocaleDateString('pt-BR') : '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
