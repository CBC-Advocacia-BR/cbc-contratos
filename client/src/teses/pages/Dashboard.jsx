import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, CardBody, CardHeader, Spinner, StatusBadge, Badge } from '../components/ui/Primitives';
import { useTesesAuth } from '../contexts/AuthContext';
import { useRoute } from '../router';

function StatCard({ label, value, hint }) {
  return (
    <Card>
      <CardBody>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{label}</div>
        <div className="text-3xl font-bold text-slate-800 mt-1">{value ?? '—'}</div>
        {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const { profile, is } = useTesesAuth();
  const { navigate } = useRoute();
  const [stats, setStats] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [recentPetitions, setRecentPetitions] = useState([]);
  const [topModels, setTopModels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const thirtyDays = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [petitionsCount, modelsCount, resortsCount, pending, recent] = await Promise.all([
        supabase.from('generated_petitions').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDays),
        supabase.from('models').select('*', { count: 'exact', head: true }).eq('status', 'aprovado'),
        supabase.from('resorts').select('*', { count: 'exact', head: true }).eq('is_active', true),
        is('admin', 'coordenador')
          ? supabase.from('models').select('id,name,updated_at,created_by,theme_id').eq('status', 'em_revisao').order('updated_at', { ascending: false }).limit(8)
          : Promise.resolve({ data: [] }),
        supabase
          .from('generated_petitions')
          .select('id, model_id, process_number, customer_name, created_at')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      const { data: topModelsData } = await supabase
        .from('generated_petitions')
        .select('model_id')
        .gte('created_at', thirtyDays)
        .limit(500);

      if (!mounted) return;

      setStats({
        petitions30: petitionsCount.count || 0,
        approvedModels: modelsCount.count || 0,
        activeResorts: resortsCount.count || 0,
      });
      setPendingApprovals(pending?.data || []);
      setRecentPetitions(recent?.data || []);

      // Agrupa topModelsData em ranking
      if (topModelsData?.length) {
        const counts = {};
        topModelsData.forEach((r) => { counts[r.model_id] = (counts[r.model_id] || 0) + 1; });
        const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 5);
        if (ids.length) {
          const { data: models } = await supabase
            .from('models')
            .select('id,name')
            .in('id', ids);
          if (mounted) setTopModels((models || []).map((m) => ({ ...m, count: counts[m.id] })));
        }
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [is]);

  if (loading) return <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">
          Olá, {profile?.full_name?.split(' ')[0] || 'usuário'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">Visão geral dos últimos 30 dias.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Petições geradas" value={stats.petitions30} hint="últimos 30 dias" />
        <StatCard label="Modelos aprovados" value={stats.approvedModels} hint="em uso pela equipe" />
        <StatCard label="Resorts cadastrados" value={stats.activeResorts} hint="ativos na base" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {is('admin', 'coordenador') && (
          <Card>
            <CardHeader
              title="Aprovações pendentes"
              subtitle={`${pendingApprovals.length} modelo(s) aguardando revisão`}
            />
            <CardBody>
              {pendingApprovals.length === 0 ? (
                <div className="text-xs text-slate-500">Nada pendente. 👌</div>
              ) : (
                <ul className="space-y-2">
                  {pendingApprovals.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => navigate(`/models/${m.id}`)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between cursor-pointer"
                      >
                        <span className="text-sm font-medium text-slate-800 truncate">{m.name}</span>
                        <StatusBadge status="em_revisao" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Petições recentes" subtitle="Histórico dos últimos dias" />
          <CardBody>
            {recentPetitions.length === 0 ? (
              <div className="text-xs text-slate-500">Nenhuma petição gerada recentemente.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentPetitions.map((p) => (
                  <li key={p.id} className="py-2 flex items-center justify-between text-xs">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 truncate">{p.customer_name || '—'}</div>
                      <div className="text-slate-500 truncate">Proc. {p.process_number || '—'}</div>
                    </div>
                    <div className="text-slate-400 shrink-0 ml-3">
                      {new Date(p.created_at).toLocaleDateString('pt-BR')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Top modelos (últimos 30 dias)" />
          <CardBody>
            {topModels.length === 0 ? (
              <div className="text-xs text-slate-500">Sem uso suficiente para ranking.</div>
            ) : (
              <ul className="space-y-2">
                {topModels.map((m, i) => (
                  <li key={m.id} className="flex items-center justify-between">
                    <span className="text-sm text-slate-800">
                      <span className="text-slate-400 font-bold mr-2">#{i + 1}</span>
                      {m.name}
                    </span>
                    <Badge color="blue">{m.count} uso(s)</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
