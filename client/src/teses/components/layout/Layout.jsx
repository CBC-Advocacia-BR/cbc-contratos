import { useEffect, useState } from 'react';
import { useTesesAuth } from '../../contexts/AuthContext';
import { useRoute } from '../../router';
import { supabase } from '../../lib/supabaseClient';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊', roles: ['admin', 'coordenador', 'especialista', 'operacional'] },
  { key: 'generator', label: 'Gerar Petição', icon: '📝', roles: ['admin', 'coordenador', 'especialista', 'operacional'] },
  { key: 'history', label: 'Histórico', icon: '🗂', roles: ['admin', 'coordenador', 'especialista', 'operacional'] },
  { key: 'models', label: 'Modelos', icon: '📑', roles: ['admin', 'coordenador', 'especialista'] },
  { key: 'resorts', label: 'Resorts', icon: '🏨', roles: ['admin', 'coordenador'] },
  { key: 'approvals', label: 'Aprovações', icon: '✅', roles: ['admin', 'coordenador'] },
  { key: 'themes', label: 'Temas', icon: '🏷', roles: ['admin', 'coordenador'] },
  { key: 'users', label: 'Usuários', icon: '👥', roles: ['admin'] },
  { key: 'settings', label: 'Configurações', icon: '⚙', roles: ['admin'] },
];

export default function Layout({ children }) {
  const { profile, role, signOut } = useTesesAuth();
  const { path, navigate } = useRoute();
  const currentKey = (path.split('/')[1] || 'dashboard');
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!profile?.id) return;
    let mounted = true;
    (async () => {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', profile.id)
        .eq('is_read', false);
      if (mounted) setUnread(count || 0);
    })();
    const ch = supabase
      .channel(`notif-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}` },
        () => setUnread((u) => u + 1)
      )
      .subscribe();
    return () => { mounted = false; supabase.removeChannel?.(ch); };
  }, [profile?.id]);

  return (
    <div className="h-screen flex bg-slate-50 text-slate-800">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-900 text-slate-100 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-[11px] uppercase tracking-[2px] text-slate-400 font-bold">CBC</div>
          <div className="text-lg font-bold text-white mt-0.5">TESES</div>
          <div className="text-[10px] text-slate-500 mt-1">Gestão de modelos e petições</div>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV.filter((i) => !i.roles || i.roles.includes(role || 'operacional')).map((item) => {
            const active = currentKey === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navigate('/' + item.key)}
                className={`w-full text-left px-5 py-2.5 text-sm flex items-center gap-3 transition-colors ${
                  active ? 'bg-slate-800 text-white border-l-4 border-blue-400' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border-l-4 border-transparent cursor-pointer'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="px-5 py-3 border-t border-slate-800 text-[10px] text-slate-500">
          v1.0 · {role || '—'}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 h-14 px-6 flex items-center justify-between shrink-0">
          <div className="text-sm font-bold text-slate-700 uppercase tracking-wide">
            {NAV.find((n) => n.key === currentKey)?.label || 'CBC TESES'}
          </div>
          <div className="flex items-center gap-4">
            <button
              className="relative p-2 rounded-lg hover:bg-slate-100 cursor-pointer"
              onClick={() => navigate('/notifications')}
              title="Notificações"
            >
              <span className="text-lg">🔔</span>
              {unread > 0 && (
                <span className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
            <div className="flex items-center gap-3 text-sm">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
                {(profile?.full_name || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="hidden md:block text-left">
                <div className="font-bold text-slate-800 text-xs">{profile?.full_name || '—'}</div>
                <div className="text-[10px] text-slate-500 capitalize">{role || 'sem perfil'}</div>
              </div>
            </div>
            <button onClick={signOut} className="text-xs text-slate-500 hover:text-red-600 cursor-pointer">
              Sair
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
