/**
 * Netlify Function (agendada): sincroniza as videochamadas (atendimentos de venda) das
 * agendas das vendedoras (Google) para o Supabase, alimentando as etapas "Agendada" e
 * "Realizada" do funil. SOMENTE LEITURA da agenda. Status pela cor do evento.
 *
 * Janela: [hoje-180d, hoje+30d], paginado. Upsert idempotente via RPC protegida por
 * BOT_RPC_SECRET (a tabela agenda_videochamadas tem RLS fechada por causa do PII de cliente).
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { getAccessToken, listEvents, classifyEvent, VENDEDORAS } from './_lib/googleAgenda.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const JANELA_ATRAS_DIAS = 180;
const JANELA_FRENTE_DIAS = 30;

export default async () => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const at = await getAccessToken();
    const timeMin = new Date(Date.now() - JANELA_ATRAS_DIAS * 864e5).toISOString();
    const timeMax = new Date(Date.now() + JANELA_FRENTE_DIAS * 864e5).toISOString();

    let totalEventos = 0;
    const rows = [];
    for (const cal of VENDEDORAS) {
      const eventos = await listEvents(cal, timeMin, timeMax, at);
      totalEventos += eventos.length;
      for (const ev of eventos) {
        const c = classifyEvent(ev, cal);
        if (c) rows.push(c);
      }
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await db.rpc('agenda_videochamadas_upsert', { p_chave: RPC_SECRET, p_rows: rows.slice(i, i + 200) });
      if (error) throw new Error('upsert: ' + error.message);
      upserted += data || 0;
    }

    // Exclusao: marca status 'excluida' os atendimentos LIVE da janela que sumiram da agenda
    // (foram apagados). Auto-corrige: se o evento reaparecer, o upsert acima sobrescreve de volta.
    // So roda com lista de ids ativos NAO-vazia (a RPC tambem se protege) p/ nao zerar tudo num
    // sync transitorio. Nao toca em linhas de backfill (source <> 'live').
    let excluidas = 0;
    if (rows.length > 0) {
      const ids = rows.map((r) => r.event_id);
      const { data: sw, error: swErr } = await db.rpc('agenda_videochamadas_sweep', {
        p_chave: RPC_SECRET, p_win_ini: timeMin, p_win_fim: timeMax, p_event_ids: ids,
      });
      if (swErr) throw new Error('sweep: ' + swErr.message);
      excluidas = sw || 0;
    }

    await logAdvbox('agenda', 'info', `videochamadas: ${rows.length} atendimentos de ${totalEventos} eventos (${VENDEDORAS.length} agendas)${excluidas ? `, ${excluidas} excluidas` : ''}`, { atendimentos: rows.length, totalEventos, excluidas }).catch(() => {});
    return json({ ok: true, agendas: VENDEDORAS.length, total_eventos: totalEventos, atendimentos: rows.length, upserted, excluidas });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `videochamadas sync falhou: ${e.message}`.slice(0, 300), {}).catch(() => {});
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = { schedule: '*/45 * * * *' };
