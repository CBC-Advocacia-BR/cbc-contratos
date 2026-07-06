// (auditoria #88/#89) E-mail de ALERTA CRITICO. Decisao do Paulo (06/07/2026):
// enviar e-mail para paulo@advocaciacbc.com SOMENTE quando houver erro CRITICO no
// sistema (integracao caida, robo parado, mensagens perdidas) — nunca para avisos.
//
// Provedor: Resend (API HTTP simples, SEM dependencia npm). Setup (unico passo do Paulo):
//   1) criar conta gratuita em resend.com e gerar uma API key -> env RESEND_API_KEY (Netlify)
//   2) verificar o dominio advocaciacbc.com no Resend (ou, p/ teste rapido, deixar
//      ALERT_EMAIL_FROM = 'onboarding@resend.dev', que o Resend ja aceita sem verificar).
// Sem RESEND_API_KEY, sendCriticalAlert e NO-OP (retorna skipped) — nao quebra nada.
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const ALERT_TO = process.env.ALERT_EMAIL_TO || 'paulo@advocaciacbc.com';
const ALERT_FROM = process.env.ALERT_EMAIL_FROM || 'alertas@advocaciacbc.com';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Envia UM e-mail de alerta critico. `linhas` = lista de problemas.
 * Retorna { ok:true } | { ok:false, skipped } | { ok:false, error }.
 */
export async function sendCriticalAlert(subject, linhas = []) {
  if (!RESEND_KEY) return { ok: false, skipped: 'RESEND_API_KEY ausente' };
  const corpo = (Array.isArray(linhas) ? linhas : [String(linhas)]).filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
    <h2 style="color:#B91C1C;margin:0 0 8px">🚨 Alerta crítico — CBC Contratos</h2>
    <p style="color:#333;margin:0 0 12px">O monitor detectou ${corpo.length} problema(s) crítico(s) no sistema:</p>
    <ul style="color:#111">${corpo.map((l) => `<li style="margin:4px 0">${escapeHtml(l)}</li>`).join('')}</ul>
    <p style="color:#666;font-size:12px;margin-top:16px">Enviado automaticamente pelo monitor-watchdog (a cada 30 min, com limite de 1 e-mail a cada 2h). Detalhes no console do Monitor, aba ADVBOX. Você só recebe este e-mail quando há erro crítico — não para avisos.</p>
  </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject: `🚨 CBC Contratos: ${subject}`, html }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { ok: false, error: `Resend HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 150)}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
