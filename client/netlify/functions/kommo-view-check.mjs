/**
 * Netlify Function (agendada): nota Kommo #18 "abriu o contrato e nao assinou".
 *
 * (#6) Antes essa nota so era postada pelo polling do App.jsx — ou seja, SO rodava com
 * o sistema aberto no navegador de alguem. Agora roda no servidor a cada 30 min, 24h.
 * Idempotente: marca `kommo_view_noted` no contrato e o kommo-note nao duplica a nota.
 *
 * Varre contratos `enviado_zapsign` ainda sem a nota, consulta o ZapSign (times_viewed)
 * e, se o cliente abriu mas nao assinou, posta a nota de follow-up no lead do Kommo.
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ZAP_TOKEN = process.env.ZAPSIGN_TOKEN;
const ZAP_API = 'https://api.zapsign.com.br/api/v1';
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

export default async () => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (!SUPA_URL || !SUPA_KEY || !ZAP_TOKEN) return json({ error: 'missing env (supabase/zapsign)' }, 500);

  const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

  // Contratos enviados ao ZapSign, ainda sem a nota "abriu" postada.
  const { data: pend, error } = await sb
    .from('contratos')
    .select('id, zapsign_doc_token, contratantes_j:dados->contratantes')
    .eq('status', 'enviado_zapsign')
    .not('zapsign_doc_token', 'is', null)
    .or('kommo_view_noted.is.null,kommo_view_noted.eq.false')
    .limit(300);

  if (error) return json({ error: error.message }, 500);

  let checked = 0, noted = 0, skipped = 0;
  for (const c of (pend || [])) {
    checked++;
    try {
      const r = await fetch(`${ZAP_API}/docs/${c.zapsign_doc_token}/`, {
        headers: { Authorization: `Bearer ${ZAP_TOKEN}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) { skipped++; continue; }
      const doc = await r.json();
      const signers = doc.signers || [];
      const allSigned = signers.length > 0 && signers.every(s => s.status === 'signed');
      if (allSigned) { skipped++; continue; } // ja assinou -> o fluxo de assinatura cuida

      const abriu = signers.find(s => (s.times_viewed || 0) > 0 && s.status !== 'signed');
      const linkKommo = (c.contratantes_j || []).map(x => x?.linkKommo).find(l => /\/leads\/detail\/\d+/.test(l || ''));
      if (!abriu || !linkKommo) { skipped++; continue; }

      // Data/hora em BRT (REGRA #11: datas server-side em America/Sao_Paulo).
      const ultima = abriu.last_view_at
        ? new Date(abriu.last_view_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—';
      const texto = ['👀 Abriu o contrato e ainda não assinou', `• Visualizações: ${abriu.times_viewed}`, `• Última: ${ultima}`, '→ Bom momento para um follow-up.'].join('\n');

      const noteResp = await fetch(`${SELF_URL}/.netlify/functions/kommo-note`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkKommo, marker: 'CBC.abriu', text: texto }),
      });
      const noteJson = await noteResp.json().catch(() => ({}));
      // So marca idempotencia se a nota foi postada OU ja existia ({ok:true}); senao re-tenta no proximo ciclo.
      if (noteJson.ok) {
        await sb.from('contratos').update({ kommo_view_noted: true }).eq('id', c.id);
        noted++;
      }
    } catch { /* best-effort: o proximo ciclo re-tenta */ }
  }

  return json({ ok: true, checked, noted, skipped });
};

// A cada 30 min. (#18 e um follow-up, nao precisa de tempo real; o webhook do ZapSign
// continua cuidando da deteccao de assinatura.)
export const config = { schedule: '*/30 * * * *' };
