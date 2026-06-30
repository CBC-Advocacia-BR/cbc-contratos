// (#97, #327) Presence channel — Supabase Realtime presence sem writes em DB
// Uso:
//   const { peers } = usePresence({ topic: `contrato:${id}`, state: { email, mode: 'viewing' } });
//   peers = [{ key, email, mode, joinedAt, online_at }, ...]
//
// Custo: WebSocket persistente (presence) — irrisorio para <=20 usuarios

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export function usePresence({ topic, state, enabled = true }) {
  const [peers, setPeers] = useState([]);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!enabled || !topic || !state?.email) return undefined;

    const ch = supabase.channel(`presence:${topic}`, {
      config: {
        presence: { key: state.email },
      },
    });

    ch.on('presence', { event: 'sync' }, () => {
      const presenceState = ch.presenceState();
      const flat = [];
      for (const key of Object.keys(presenceState)) {
        const arr = presenceState[key] || [];
        for (const item of arr) {
          flat.push({ key, ...item });
        }
      }
      // Deduplica por email (mesmo usuario em 2 tabs aparece 1x — mantem mais recente)
      const byEmail = new Map();
      for (const p of flat) {
        const existing = byEmail.get(p.email);
        if (!existing || (p.online_at && p.online_at > existing.online_at)) {
          byEmail.set(p.email, p);
        }
      }
      setPeers([...byEmail.values()]);
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ ...state, online_at: new Date().toISOString() });
      }
    });

    channelRef.current = ch;
    return () => {
      try { ch.untrack(); } catch { /* ignore cleanup */ }
      try { supabase.removeChannel(ch); } catch { /* ignore cleanup */ }
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, state?.email, state?.mode, enabled]);

  // Permite atualizar o state (ex: mudar de 'viewing' para 'editing') sem recriar canal
  const updateState = async (patch) => {
    const ch = channelRef.current;
    if (!ch) return;
    try { await ch.track({ ...state, ...patch, online_at: new Date().toISOString() }); } catch { /* ignore */ }
  };

  return { peers, updateState };
}
