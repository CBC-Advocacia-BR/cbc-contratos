/**
 * Scheduled: bandwidth-check-cron (06h/12h/18h BRT) — auditoria #93
 *
 * Move o check de bandwidth que rodava no MAC do Paulo (check-bandwidth.sh via cron
 * local — so avisava se o computador estivesse ligado) para a NUVEM. Consulta a API
 * da Netlify e, se passar de 80% do plano (1TB), registra ALERTA no console do Monitor
 * (advbox_api_log) e bate o ponto p/ o watchdog vigiar.
 *
 * REQUISITO: env NETLIFY_AUTH_TOKEN no Netlify (mesmo token do deploy — read-only aqui;
 * idealmente um token com escopo so de leitura). Sem ela, loga aviso e sai sem quebrar.
 * Complemento (acao do Paulo): um monitor de uptime EXTERNO (UptimeRobot/Better Stack)
 * batendo em /api/health — isso um cron interno nao substitui (se o site cair, ele cai junto).
 */
import { heartbeat, logAdvbox } from './_lib/botDb.mjs';

const ACCOUNT_SLUG = 'paulo-5hbwy1e';
const LIMIT_BYTES = 1000 * 1073741824; // Pro = 1TB
const ALERTA_PCT = 80;
const jres = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async () => {
  const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
  if (!TOKEN) {
    await logAdvbox('infra', 'aviso', 'bandwidth-check: NETLIFY_AUTH_TOKEN ausente no Netlify — nao da p/ consultar o consumo. Configure a env (token read-only).', {});
    await heartbeat('bandwidth-check-cron', false, 'sem token');
    return jres({ ok: false, error: 'sem token' });
  }
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/bandwidth`, {
      headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Netlify API HTTP ${r.status}`);
    const j = await r.json();
    const used = Number(j.used || 0);
    const pct = Math.round((used / LIMIT_BYTES) * 1000) / 10;
    const usedGb = Math.round((used / 1073741824) * 100) / 100;
    const msg = `Bandwidth Netlify: ${usedGb}GB / 1000GB (${pct}%) — periodo ${String(j.period_start_date).slice(0, 10)}..${String(j.period_end_date).slice(0, 10)}`;
    if (pct >= ALERTA_PCT) {
      await logAdvbox('infra', 'erro', `ALERTA ${msg} — acima de ${ALERTA_PCT}%`, { pct, usedGb });
    } else if (pct >= 50) {
      await logAdvbox('infra', 'aviso', msg, { pct, usedGb });
    }
    await heartbeat('bandwidth-check-cron', true, `${pct}%`);
    return jres({ ok: true, pct, usedGb });
  } catch (e) {
    await logAdvbox('infra', 'erro', `bandwidth-check falhou: ${e.message}`.slice(0, 300), {});
    await heartbeat('bandwidth-check-cron', false, String(e.message).slice(0, 120));
    return jres({ ok: false, error: e.message });
  }
};

export const config = { schedule: '0 9,15,21 * * *' }; // 06h/12h/18h BRT (como o cron local antigo)
