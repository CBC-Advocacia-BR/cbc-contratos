import { supabase } from '../lib/supabase';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Try to acquire an editing lock on a contract
 * Returns { locked: true, by: email } if someone else is editing
 * Returns { locked: false } if lock acquired successfully
 */
export async function acquireLock(contratoId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { locked: true, by: 'unknown' };

  // Check if someone else is editing
  const { data: contract } = await supabase
    .from('contratos')
    .select('editing_by, editing_since')
    .eq('id', contratoId)
    .single();

  if (contract?.editing_by && contract.editing_by !== user.email) {
    const since = new Date(contract.editing_since).getTime();
    const now = Date.now();
    // Lock expired after 5 minutes
    if (now - since < LOCK_TIMEOUT_MS) {
      return { locked: true, by: contract.editing_by };
    }
  }

  // Acquire lock
  await supabase
    .from('contratos')
    .update({ editing_by: user.email, editing_since: new Date().toISOString() })
    .eq('id', contratoId);

  return { locked: false };
}

/**
 * Release the editing lock
 */
export async function releaseLock(contratoId) {
  await supabase
    .from('contratos')
    .update({ editing_by: null, editing_since: null })
    .eq('id', contratoId);
}

/**
 * Refresh lock (heartbeat) — call every 60s while editing
 */
export async function refreshLock(contratoId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('contratos')
    .update({ editing_since: new Date().toISOString() })
    .eq('id', contratoId)
    .eq('editing_by', user.email);
}
