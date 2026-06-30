// (#205) Hook de notificacoes — leitura + realtime + actions
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export function useNotifications(userEmail) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const initRef = useRef(false);

  const load = useCallback(async () => {
    if (!userEmail) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_email', userEmail)
        .order('created_at', { ascending: false })
        .limit(100);
      setItems(data || []);
      setUnread((data || []).filter(n => !n.read_at).length);
    } catch (err) {
      console.error('[useNotifications] load', err);
    } finally {
      setLoading(false);
    }
  }, [userEmail]);

  useEffect(() => {
    if (!userEmail || initRef.current) return;
    initRef.current = true;
    load();
  }, [userEmail, load]);

  // Realtime — novos itens chegam ao vivo
  useEffect(() => {
    if (!userEmail) return;
    const channel = supabase
      .channel(`notifications:${userEmail}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_email=eq.${userEmail}` },
        (payload) => {
          setItems(prev => [payload.new, ...prev].slice(0, 100));
          if (!payload.new.read_at) setUnread(c => c + 1);
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_email=eq.${userEmail}` },
        (payload) => {
          setItems(prev => prev.map(n => n.id === payload.new.id ? payload.new : n));
          load();
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userEmail, load]);

  const markRead = useCallback(async (id) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    setUnread(c => Math.max(0, c - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userEmail) return;
    const now = new Date().toISOString();
    await supabase.from('notifications').update({ read_at: now }).eq('user_email', userEmail).is('read_at', null);
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    setUnread(0);
  }, [userEmail]);

  const remove = useCallback(async (id) => {
    await supabase.from('notifications').delete().eq('id', id);
    setItems(prev => prev.filter(n => n.id !== id));
  }, []);

  return { items, unread, loading, markRead, markAllRead, remove, reload: load };
}
