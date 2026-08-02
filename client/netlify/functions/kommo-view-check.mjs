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
// (fix 28/07/2026) usava createClient com SERVICE_ROLE || VITE_SUPABASE_ANON_KEY: as duas
// sao undefined no runtime das Functions (VITE_* e build-only), entao a funcao morria no
// guard 'missing env' a cada 30 min e a nota #18 NUNCA foi postada pelo servidor. Passa a
// usar o `db` do botDb (fallback proprio da anon) — mesma causa do sweep-cron/vinculo-kommo.
import { db as sb, heartbeat } from './_lib/botDb.mjs';

const ZAP_TOKEN = process.env.ZAPSIGN_TOKEN;
const ZAP_API = 'https://api.zapsign.com.br/api/v1';
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

export default async () => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (!ZAP_TOKEN) { await heartbeat('kommo-view-check', false, 'ZAPSIGN_TOKEN ausente'); return json({ error: 'missing env (zapsign)' }, 500); }

  // Contratos enviados ao ZapSign, ainda sem a nota "abriu" postada.
  // (auditoria 01/08 — item 112) Antes: ate 300 contratos por rodada, uma chamada ao
  // ZapSign para CADA um, a cada 30 minutos — 14 mil chamadas por dia no pior caso, sem
  // controle de ritmo. Cresce junto com o pipeline e esbarra no limite da API justo na
  // hora de pico, quando ha mais contratos aguardando assinatura.
  //
  // Tres travas, sem perder nenhum contrato:
  //  1) so os enviados nos ULTIMOS 30 DIAS — passado disso o cliente nao vai "abrir e
  //     assinar agora", e a nota de follow-up ja perdeu o sentido;
  //  2) teto de 60 por rodada, do mais ANTIGO para o mais novo, para a fila girar;
  //  3) orcamento de tempo (a function e sincrona, teto de ~26s neste site).
  const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: pend, error } = await sb
    .from('contratos')
    .select('id, zapsign_doc_token, contratantes_j:dados->contratantes')
    .eq('status', 'enviado_zapsign')
    .not('zapsign_doc_token', 'is', null)
    .or('kommo_view_noted.is.null,kommo_view_noted.eq.false')
    .gt('zapsign_sent_at', trintaDias)
    .order('zapsign_sent_at', { ascending: true })
    .limit(60);

  if (error) return json({ error: error.message }, 500);

  const PRAZO_MS = 20000;
  const inicio = Date.now();
  let checked = 0, noted = 0, skipped = 0, interrompido = false;
  for (const c of (pend || [])) {
    if (Date.now() - inicio > PRAZO_MS) { interrompido = true; break; }
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

  await heartbeat('kommo-view-check', true, `${checked} checados, ${noted} nota(s) postada(s)${interrompido ? ' · interrompido por tempo (segue na proxima rodada)' : ''}`).catch(() => {});
  return json({ ok: true, checked, noted, skipped });
};

// A cada 30 min. (#18 e um follow-up, nao precisa de tempo real; o webhook do ZapSign
// continua cuidando da deteccao de assinatura.)
export const config = { schedule: '*/30 * * * *' };
