#!/usr/bin/env node
// Smoke F0 do bot Ana. Roda local: node client/scripts/smoke-agenda-f0.mjs
// Lê envs do Netlify? NÃO — exportar antes: GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN, KOMMO_TOKEN.
import { getAccessToken } from '../netlify/functions/_lib/googleAgenda.mjs';

const AGENDAS = ['marianamaciel@advocaciacbc.com','beatriz@advocaciacbc.com','emerson@advocaciacbc.com'];
const at = await getAccessToken();

// 1) escopo do token: tokeninfo
const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${at}`)).json();
console.log('scope:', info.scope);
const podeEscrever = /auth\/calendar(\.events)?(\s|$)/.test(info.scope || '');
console.log(podeEscrever ? 'OK escopo de escrita' : 'FALTA re-consentir com https://www.googleapis.com/auth/calendar.events');

// 2) freeBusy nas 3 agendas
const fb = await (await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
  method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ timeMin: new Date().toISOString(), timeMax: new Date(Date.now()+864e5).toISOString(),
    items: AGENDAS.map((id) => ({ id })) }),
})).json();
for (const a of AGENDAS) console.log(a, fb.calendars?.[a]?.errors ? `ERRO ${JSON.stringify(fb.calendars[a].errors)}` : `busy=${(fb.calendars?.[a]?.busy||[]).length}`);

// 3) criar + apagar evento de TESTE com Meet na 1ª agenda ok (amanhã 20h — fora do expediente)
const ini = new Date(Date.now()+864e5); ini.setHours(20,0,0,0);
const ev = await (await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(AGENDAS[0])}/events?conferenceDataVersion=1`, {
  method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ summary: 'TESTE CBC/Ana — apagar', start: { dateTime: ini.toISOString() },
    end: { dateTime: new Date(ini.getTime()+18e5).toISOString() },
    conferenceData: { createRequest: { requestId: `cbc-ana-smoke-${ini.getTime()}` } },
    extendedProperties: { private: { cbc_origem: 'ana', cbc_lead_id: '0' } } }),
})).json();
console.log(ev.id ? `OK evento ${ev.id} meet=${ev.hangoutLink || JSON.stringify(ev.conferenceData?.entryPoints?.[0])}` : `ERRO criar: ${JSON.stringify(ev.error||ev).slice(0,300)}`);
if (ev.id) {
  const del = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(AGENDAS[0])}/events/${ev.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${at}` } });
  console.log('delete status', del.status);
}

// 4) Kommo: outgoing_chat_message por CONTATO (usar um contato com conversa recente — id via argv[2])
const contato = process.argv[2];
if (contato) {
  const r = await (await fetch(`https://advocaciacbc.kommo.com/api/v4/events?filter[type]=outgoing_chat_message&filter[entity]=contact&filter[entity_id][]=${contato}&limit=3`, {
    headers: { Authorization: `Bearer ${process.env.KOMMO_TOKEN}` } })).json().catch(() => null);
  console.log('outgoing events:', (r?._embedded?.events || []).length, (r?._embedded?.events || []).map(e => e.created_at));
} else console.log('PULA teste 4 — rode com: node ... <contact_id de teste>');
