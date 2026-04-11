import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, CardBody, Button, Spinner, EmptyState, Badge } from '../components/ui/Primitives';
import { useTesesAuth } from '../contexts/AuthContext';
import { useRoute } from '../router';

const TYPE_LABELS = {
  model_submitted: 'Modelo submetido',
  model_approved: 'Modelo aprovado',
  model_rejected: 'Modelo rejeitado',
  model_updated: 'Modelo atualizado',
  model_obsoleted: 'Modelo obsoleto',
  resort_updated: 'Ficha de resort atualizada',
};

const TYPE_COLORS = {
  model_submitted: 'yellow',
  model_approved: 'emerald',
  model_rejected: 'red',
  model_updated: 'blue',
  model_obsoleted: 'slate',
  resort_updated: 'purple',
};

export default function NotificationsPage() {
  const { profile } = useTesesAuth();
  const { navigate } = useRoute();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(100);
      setItems(data || []);
      setLoading(false);
    })();
  }, [profile?.id]);

  const markAllRead = async () => {
    if (!profile?.id) return;
    await supabase.from('notifications').update({ is_read: true }).eq('recipient_id', profile.id).eq('is_read', false);
    setItems((arr) => arr.map((n) => ({ ...n, is_read: true })));
  };

  const open = (n) => {
    if (!n.is_read) {
      supabase.from('notifications').update({ is_read: true }).eq('id', n.id);
    }
    if (n.reference_type === 'model' && n.reference_id) navigate(`/models/${n.reference_id}`);
    else if (n.reference_type === 'resort' && n.reference_id) navigate(`/resorts/${n.reference_id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Notificações</h1>
          <p className="text-xs text-slate-500">Atualizações do sistema em tempo real.</p>
        </div>
        <Button variant="outline" onClick={markAllRead}>Marcar tudo como lido</Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>
      ) : items.length === 0 ? (
        <EmptyState title="Sem notificações" description="Você será avisado quando houver novidades." />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {items.map((n) => (
              <li
                key={n.id}
                className={`px-5 py-3 flex items-start gap-4 cursor-pointer hover:bg-slate-50 ${!n.is_read ? 'bg-blue-50/40' : ''}`}
                onClick={() => open(n)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge color={TYPE_COLORS[n.type] || 'slate'}>{TYPE_LABELS[n.type] || n.type}</Badge>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                  </div>
                  <div className="font-bold text-slate-800 mt-1 text-sm">{n.title}</div>
                  {n.message && <div className="text-xs text-slate-600 mt-1">{n.message}</div>}
                </div>
                <div className="text-[10px] text-slate-400 shrink-0">
                  {new Date(n.created_at).toLocaleString('pt-BR')}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
