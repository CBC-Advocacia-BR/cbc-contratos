/**
 * Scheduled: advbox-monitor
 * Roda 2x/dia, TODOS os dias (06:30 e 17:30 BRT — ver `schedule` abaixo, a
 * fonte unica da verdade) e dispara o worker background que:
 *   - busca andamentos novos (GET /last_movements) e tarefas criadas/concluidas
 *   - registra tudo em bot_sync_state (alerta de "novidade nao comunicada")
 *   - posta nota automatica no lead do Kommo (via kommo-note, idempotente)
 * Tambem invocavel manualmente via POST (botao no painel).
 */
import { heartbeat } from './_lib/botDb.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

export default async (req) => {
  try {
    const r = await fetch(`${SELF_URL}/.netlify/functions/advbox-monitor-worker-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: req.headers.get('x-netlify-event') === 'schedule' ? 'cron' : 'manual' }),
    });
    // (auditoria 01/08 — item 95) O heartbeat de SUCESSO nao pode viver aqui.
    // Este arquivo so DESPACHA o worker; o trabalho de verdade (paginacao do ADVBOX,
    // notas, espelho) acontece no advbox-monitor-worker-background, que leva minutos.
    // Gravar "ok" aqui significa: worker morre no meio -> painel continua VERDE. E o
    // mesmo padrao que o proprio asaas-sync-boletos-background documenta como causa de
    // uma falha que passou batida em julho.
    // Aqui registramos apenas que o DESPACHO saiu (e se falhou), com o proprio nome
    // 'advbox-monitor-dispatch'. O heartbeat de 'advbox-monitor' (o vigiado pelo
    // watchdog) e gravado pelo WORKER quando ele termina de verdade.
    await heartbeat('advbox-monitor-dispatch', r.ok, r.ok ? 'worker aceito' : `HTTP ${r.status} ao despachar`);
    return new Response(JSON.stringify({ ok: true, dispatched: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
};

export const config = {
  // Roda TODOS os dias (inclusive sabado/domingo) as 06:30 e 17:30 BRT.
  // Sincronizar no fim de semana mantem o espelho fresco e distribui a carga,
  // evitando o pico de segunda-feira. O bot e o portal leem do espelho.
  schedule: '30 9,20 * * *', // 06:30 e 17:30 BRT, todos os dias
};
