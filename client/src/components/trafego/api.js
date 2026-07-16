// (aba Trafego 14/07/2026) Chamadas as functions da aba. O token da Meta vive
// SO no servidor; aqui vao apenas o refresh (GET livre, upsert idempotente) e
// as acoes (POST com o JWT da sessao — o servidor valida usuario + lista).
import { supabase } from '../../lib/supabase';

const FN = '/.netlify/functions';

/** "Atualizar agora": sincroniza catalogos + metricas do dia corrente. */
export async function atualizarAgora() {
  const r = await fetch(`${FN}/meta-trafego-sync?hoje=1`, { signal: AbortSignal.timeout(60000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
}

/**
 * Executa acao na conta de anuncios (pausar|reativar|orcamento|config).
 * O servidor exige JWT valido + e-mail no trio — aqui so repassamos a sessao.
 */
export async function executarAcao(payload) {
  const { data } = await supabase.auth.getSession();
  const jwt = data?.session?.access_token || '';
  const r = await fetch(`${FN}/meta-trafego-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
}
