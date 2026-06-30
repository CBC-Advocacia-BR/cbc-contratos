import { supabase } from '../lib/supabase';

const SESSION_ID = crypto.randomUUID();

/**
 * Register this session as active. If another session exists, it gets overwritten.
 */
export async function registerSession() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const deviceInfo = `${navigator.userAgent.substring(0, 80)} | ${new Date().toLocaleString('pt-BR')}`;

  await supabase.from('active_sessions').upsert({
    user_id: user.id,
    session_id: SESSION_ID,
    device_info: deviceInfo,
    started_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

/**
 * Check if this session is still the active one
 * Returns false if another device took over
 */
export async function isSessionActive() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('active_sessions')
    .select('session_id')
    .eq('user_id', user.id)
    .single();

  return data?.session_id === SESSION_ID;
}

/**
 * Update last_seen timestamp (heartbeat)
 */
export async function heartbeat() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('active_sessions')
    .update({ last_seen: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('session_id', SESSION_ID);
}

/**
 * Remove session on logout
 */
export async function removeSession() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('active_sessions')
    .delete()
    .eq('user_id', user.id)
    .eq('session_id', SESSION_ID);
}

export function getSessionId() {
  return SESSION_ID;
}
