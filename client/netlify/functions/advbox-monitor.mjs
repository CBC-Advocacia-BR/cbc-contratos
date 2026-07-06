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
    await fetch(`${SELF_URL}/.netlify/functions/advbox-monitor-worker-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: req.headers.get('x-netlify-event') === 'schedule' ? 'cron' : 'manual' }),
    });
    await heartbeat('advbox-monitor', true, 'worker disparado'); // (observ-2)
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
