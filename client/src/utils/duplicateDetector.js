import { supabase } from '../lib/supabase';

// Cache to avoid repeated queries
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * Check if a contract already exists for the given CPF + Resort
 * Returns: { isDuplicate, existingContracts: [{id, status, created_at, resort}] }
 */
export async function checkDuplicate(cpf, resort) {
  if (!cpf || !resort) return { isDuplicate: false, existingContracts: [] };

  const cleanCpf = cpf.replace(/\D/g, '');
  if (cleanCpf.length !== 11) return { isDuplicate: false, existingContracts: [] };

  const cacheKey = `${cleanCpf}_${resort}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;

  try {
    const { data, error } = await supabase
      .from('contratos')
      .select('id, status, created_at, resort, nome_contratante1')
      .or(`cpf_contratante1.eq.${cleanCpf},cpf_contratante2.eq.${cleanCpf}`)
      .eq('resort', resort)
      .neq('status', 'cancelado')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    const result = {
      isDuplicate: (data?.length || 0) > 0,
      existingContracts: (data || []).map(c => ({
        id: c.id,
        status: c.status,
        created_at: c.created_at,
        resort: c.resort,
        nome: c.nome_contratante1,
      })),
    };

    cache.set(cacheKey, { result, ts: Date.now() });
    return result;
  } catch {
    return { isDuplicate: false, existingContracts: [] };
  }
}

/**
 * Estimate time to signature based on historical data for same resort
 * Returns: { avgDays, medianDays, sampleSize }
 */
export async function estimateSignatureTime(resort) {
  if (!resort) return null;

  const cacheKey = `sig_${resort}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;

  try {
    const { data, error } = await supabase
      .from('contratos')
      .select('created_at, zapsign_sent_at, signed_at')
      .eq('resort', resort)
      .eq('status', 'assinado')
      .not('zapsign_sent_at', 'is', null)
      .not('signed_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data?.length) return null;

    const durations = data
      .map(c => {
        const sent = new Date(c.zapsign_sent_at);
        const signed = new Date(c.signed_at);
        const diffMs = signed - sent;
        return diffMs > 0 ? diffMs / (1000 * 60 * 60 * 24) : null; // days
      })
      .filter(d => d !== null && d < 30); // exclude outliers > 30 days

    if (!durations.length) return null;

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const sorted = [...durations].sort((a, b) => a - b);
    // (varredura 15/06) mediana real: media dos dois centrais quando a amostra e par
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    const result = {
      avgDays: Math.round(avg * 10) / 10,
      medianDays: Math.round(median * 10) / 10,
      sampleSize: durations.length,
    };

    cache.set(cacheKey, { result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}
