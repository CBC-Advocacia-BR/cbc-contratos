// (#215) Cron de lembretes — Netlify Scheduled Function
// Executa a cada 5min: varre user_reminders com fire_at <= now() AND done_at IS NULL
// Para cada um: insere notification, marca done_at (ou reagenda se recurrence)

import { createClient } from '@supabase/supabase-js';
import { heartbeat } from './_lib/botDb.mjs';

const SUPA_URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = {
  schedule: '*/15 * * * *',  // (perf 31/05) a cada 15 min (era 5) — reduz 66% das execucoes; lembrete pode atrasar ate 15min, aceitavel
};

function nextOccurrence(current, recurrence, after = new Date()) {
  const step = (d) => {
    if (recurrence === 'daily')   d.setDate(d.getDate() + 1);
    else if (recurrence === 'weekly')  d.setDate(d.getDate() + 7);
    else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
    else return false;
    return true;
  };
  const d = new Date(current);
  const afterT = new Date(after).getTime();
  // (varredura 15/06) avanca pelo menos 1 passo e segue avancando ate cair no
  // FUTURO. Antes retornava fire_at+1passo: um lembrete diario atrasado ficava
  // <= now() e re-disparava a cada ciclo (15min) ate "alcancar" o presente.
  let guard = 0;
  do {
    if (!step(d)) return null;
  } while (d.getTime() <= afterT && ++guard < 1000);
  return d.toISOString();
}

export default async () => {
  if (!SUPA_URL || !SUPA_KEY) {
    return new Response('Missing SUPABASE env vars', { status: 500 });
  }

  const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  const { data: due, error } = await sb
    .from('user_reminders')
    .select('id, user_email, contrato_id, message, fire_at, recurrence')
    .lte('fire_at', now)
    .is('done_at', null)
    .limit(200);

  if (error) {
    console.error('[reminder-cron] query', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!due || due.length === 0) {
    await heartbeat('reminder-cron', true, 'nada a disparar'); // (observ-2)
    return new Response(JSON.stringify({ ok: true, fired: 0 }));
  }

  let fired = 0;
  let reSched = 0;

  for (const r of due) {
    try {
      // Insere notificacao
      await sb.from('notifications').insert({
        user_email: r.user_email,
        type: 'reminder',
        title: 'Lembrete',
        body: r.message,
        link: r.contrato_id ? `/?tab=contratos&open=${r.contrato_id}` : null,
        metadata: { reminder_id: r.id, contrato_id: r.contrato_id },
      });

      // Recorrencia: reagenda; senao marca done
      const next = nextOccurrence(r.fire_at, r.recurrence, now);
      if (next) {
        await sb.from('user_reminders').update({ fire_at: next }).eq('id', r.id);
        reSched++;
      } else {
        await sb.from('user_reminders').update({ done_at: new Date().toISOString() }).eq('id', r.id);
      }
      fired++;
    } catch (err) {
      console.error('[reminder-cron] fire', r.id, err);
    }
  }

  await heartbeat('reminder-cron', true, `${fired} disparados`); // (observ-2)
  return new Response(JSON.stringify({ ok: true, fired, reSched, total: due.length }));
};
