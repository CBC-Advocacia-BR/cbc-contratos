import { supabase } from '../lib/supabase';

/**
 * Log an action to the action_log table
 * @param {string} action - 'create', 'edit', 'send_zapsign', 'signed', 'delete', 'view', 'export'
 * @param {string|null} contratoId - UUID of the contract
 * @param {object} details - Additional details
 */
export async function logAction(action, contratoId = null, details = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('action_log').insert({
      user_id: user.id,
      user_email: user.email,
      action,
      contrato_id: contratoId,
      details,
    });
  } catch {
    // Silent fail — logging should never break the app
  }
}

/**
 * Get action history for a contract
 */
export async function getContractHistory(contratoId) {
  const { data } = await supabase
    .from('action_log')
    .select('*')
    .eq('contrato_id', contratoId)
    .order('created_at', { ascending: false })
    .limit(50);
  return data || [];
}

/**
 * Get recent actions across all contracts
 */
export async function getRecentActions(limit = 20) {
  const { data } = await supabase
    .from('action_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}
