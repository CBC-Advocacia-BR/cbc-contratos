/**
 * Netlify Scheduled Function: monitor-watchdog (a cada 30 min)
 * Vigia a saude do sistema SEM depender de ninguem com o app aberto:
 *  (observ-14) chama /api/health e grava o resultado em health_history (uptime real)
 *  (resil-10)  alerta no advbox_api_log quando um servico CAI (transicao ok->erro)
 *  (observ-2)  checa cron_heartbeat: se um robo nao bate o ponto no prazo, alerta
 */
import { db, recordHealth, heartbeat, logAdvbox } from './_lib/botDb.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

// prazo maximo (minutos) sem batida antes de considerar o cron "parado"
const CRON_SLA = {
  'datajud-refresh': 26 * 60,        // 1x/dia
  'reminder-cron': 40,               // a cada 15min
  // (20/06/2026) cobranca-regua REMOVIDA do watchdog — régua desligada (kill-switch
  // em cobranca-regua.mjs). Além disso o SLA de 30h dava falso-positivo nos fins de
  // semana (a régua só roda seg–sex; Fri→Mon ~72h > 30h gerava "Cron sem rodar").
  'asaas-sync-boletos': 14 * 60,     // 2x/dia
  'asaas-sync-customers': 26 * 60,   // 1x/dia
  'advbox-monitor': 14 * 60,         // 2x/dia (seg-sex)
};

export default async () => {
  const out = { health: [], caiu: [], crons_parados: [] };

  // 1) HEALTH ---------------------------------------------------------------
  try {
    const t0 = Date.now();
    const r = await fetch(`${SELF_URL}/api/health`, { signal: AbortSignal.timeout(20000) });
    const elapsed = Date.now() - t0;
    const j = await r.json().catch(() => ({}));
    const services = Array.isArray(j.services) ? j.services : [];

    // estado anterior de cada servico (ultima linha) p/ detectar transicao ok->erro
    const prev = {};
    try {
      const { data: hist } = await db.from('health_history')
        .select('service, ok, checked_at')
        .order('checked_at', { ascending: false }).limit(60);
      for (const h of hist || []) if (!(h.service in prev)) prev[h.service] = h.ok;
    } catch { /* sem historico ainda */ }

    const rows = services.map(s => ({
      service: s.name, ok: s.status === 'ok', latency_ms: s.ms, detail: s.error || null,
    }));
    if (rows.length) {
      await recordHealth(rows);
      out.health = rows.map(r2 => `${r2.service}:${r2.ok ? 'ok' : 'ERRO'}`);
      // (resil-10) alerta so na TRANSICAO ok->erro (evita spam a cada 30min)
      for (const r2 of rows) {
        if (!r2.ok && prev[r2.service] !== false) {
          out.caiu.push(r2.service);
          await logAdvbox('health', 'erro', `Integracao CAIU: ${r2.service} — ${r2.detail || 'sem detalhe'}`.slice(0, 300), { service: r2.service });
        }
      }
    }
  } catch (e) {
    await logAdvbox('health', 'aviso', `watchdog: falha ao consultar /api/health: ${e.message}`.slice(0, 300), {});
  }

  // 2) CRON HEARTBEAT -------------------------------------------------------
  try {
    const { data: hbs } = await db.from('cron_heartbeat').select('job, last_run_at, ok');
    const agora = Date.now();
    for (const hb of hbs || []) {
      const sla = CRON_SLA[hb.job];
      if (!sla) continue;
      const idadeMin = hb.last_run_at ? (agora - new Date(hb.last_run_at).getTime()) / 60000 : Infinity;
      if (idadeMin > sla) {
        out.crons_parados.push(hb.job);
        await logAdvbox('monitor', 'erro', `Cron sem rodar ha ${Math.round(idadeMin)} min (limite ${sla}): ${hb.job}`, { job: hb.job });
      } else if (hb.ok === false) {
        await logAdvbox('monitor', 'aviso', `Cron rodou com erro: ${hb.job}`, { job: hb.job });
      }
    }
  } catch { /* tabela pode estar vazia */ }

  await heartbeat('monitor-watchdog', true,
    `${out.caiu.length} caiu, ${out.crons_parados.length} cron(s) parado(s)`);
  console.log('[monitor-watchdog]', JSON.stringify(out));
  return new Response(JSON.stringify({ ok: true, ...out }), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '*/30 * * * *' };
