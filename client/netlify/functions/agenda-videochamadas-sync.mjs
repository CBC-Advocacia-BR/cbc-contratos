/**
 * Netlify Function (agendada): sincroniza as videochamadas (atendimentos de venda) das
 * agendas das vendedoras (Google) para o Supabase, alimentando as etapas "Agendada" e
 * "Realizada" do funil. SOMENTE LEITURA da agenda. Status pela cor do evento.
 *
 * Janela: [hoje-180d, hoje+30d], paginado. Upsert idempotente via RPC protegida por
 * BOT_RPC_SECRET (a tabela agenda_videochamadas tem RLS fechada por causa do PII de cliente).
 */
import { db, logAdvbox, heartbeat, getConfig } from './_lib/botDb.mjs';
import { getAccessToken, listEvents, classifyEvent, VENDEDORAS } from './_lib/googleAgenda.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const JANELA_ATRAS_DIAS = 180;
const JANELA_FRENTE_DIAS = 30;

/**
 * Resolve a lista de agendas (emails) a CONSULTAR no Google a partir da config.
 * CRITICAL: NÃO filtra por `ativa`. `ativa` governa SLOTS (quem recebe novo agendamento,
 * ver agendaSlots.mjs) — não o espelho. Encolher aqui o universo consultado faria o
 * agenda_videochamadas_sweep (RPC) marcar como excluída toda a agenda de uma vendedora que
 * ficou de fora só por estar inativa/de férias, mesmo ela tendo compromissos reais no
 * Calendar (sweep em massa). Retorna TODAS as vendedoras da config com email válido (string
 * contendo '@'). Robusto a config malformada: `vendedoras` que não seja array, ou itens
 * null/sem email, são ignorados silenciosamente; se a lista resultante ficar vazia (config
 * ausente, vazia, malformada, ou leitura falhou), cai no `fallback` (export VENDEDORAS).
 * Camada 2 de defesa (a scoped sweep via p_vendedoras) cobre o caso de esta função falhar
 * silenciosamente na config; ver supabase_agenda_bot.sql.
 */
export function resolverAgendas(cfgAll, fallback) {
  const lista = cfgAll?.agenda_bot?.vendedoras;
  const arr = Array.isArray(lista) ? lista : [];
  const agendas = arr
    .filter((v) => v && typeof v.email === 'string' && v.email.includes('@'))
    .map((v) => v.email);
  return { agendas: agendas.length ? agendas : fallback };
}

export default async () => {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const at = await getAccessToken();
    const timeMin = new Date(Date.now() - JANELA_ATRAS_DIAS * 864e5).toISOString();
    const timeMax = new Date(Date.now() + JANELA_FRENTE_DIAS * 864e5).toISOString();

    // Config-driven: usa bot_config.agenda_bot.vendedoras (TODAS, sem filtrar ativa — ver
    // resolverAgendas); cai na lista fixa VENDEDORAS se a config vier vazia/ausente/malformada
    // ou a leitura falhar (nunca trava o sync por causa disso).
    const cfgAll = await getConfig().catch(() => ({}));
    const { agendas } = resolverAgendas(cfgAll, VENDEDORAS);

    let totalEventos = 0;
    const rows = [];
    for (const cal of agendas) {
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
    // CRITICAL (camada 2): escopado por p_vendedoras=agendas — o sweep so pode apagar linhas das
    // vendedoras REALMENTE consultadas nesta rodada. Sem isso, qualquer motivo (bug, config
    // malformada, falha parcial) que reduza `agendas` faria o sweep varrer TODAS as vendedoras
    // (inclusive as que ficaram de fora), nao so as consultadas. Defesa em profundidade a
    // resolverAgendas (camada 1, acima).
    let excluidas = 0;
    if (rows.length > 0) {
      const ids = rows.map((r) => r.event_id);
      const { data: sw, error: swErr } = await db.rpc('agenda_videochamadas_sweep', {
        p_chave: RPC_SECRET, p_win_ini: timeMin, p_win_fim: timeMax, p_event_ids: ids, p_vendedoras: agendas,
      });
      if (swErr) throw new Error('sweep: ' + swErr.message);
      excluidas = sw || 0;
    }

    // (21/07/2026) Reconciliacao agenda<->Kommo: casa o telefone do TITULO do evento
    // com o espelho kommo_leads (fone_chave: ignora 55/9o digito) e grava lead_id +
    // kommo_match nas linhas novas (kommo_match IS NULL). Best-effort: nunca derruba o sync.
    let match = null;
    try {
      const { data: m } = await db.rpc('agenda_kommo_match', { p_chave: RPC_SECRET });
      match = m;
    } catch { /* best-effort */ }

    // (12/08/2026) Dossie institucional por e-mail ao lead. Vai DEPOIS do upsert e
    // do match com o Kommo de proposito: o worker precisa da linha ja gravada e,
    // quando houver, do nome do lead como reserva.
    //
    // Com `await`, e nao fire-and-forget: a licao do item 96 da auditoria e que
    // fetch sem await morre quando a function responde, e foi assim que o backup
    // diario passou 16 dias sem rodar sem ninguem perceber.
    let dossie = null;
    try {
      const r = await fetch(`${process.env.URL}/.netlify/functions/videochamada-dossie-worker`, {
        method: 'POST',
        headers: { 'x-cbc-interno': RPC_SECRET },
        signal: AbortSignal.timeout(25000),
      });
      dossie = await r.json().catch(() => null);
    } catch (e) {
      // nunca derruba o sync das agendas, que alimenta o funil inteiro
      await logAdvbox('dossie', 'erro', `despacho do dossie falhou: ${e.message}`.slice(0, 200), {}).catch(() => {});
    }

    await logAdvbox('agenda', 'info', `videochamadas: ${rows.length} atendimentos de ${totalEventos} eventos (${agendas.length} agendas)${excluidas ? `, ${excluidas} excluidas` : ''}${match ? `, match kommo: ${JSON.stringify(match)}` : ''}`, { atendimentos: rows.length, totalEventos, excluidas, match }).catch(() => {});
    // (observ 28/07) heartbeat p/ o watchdog enxergar: o token Google que sustenta as
    // agendas ja expirou uma vez (23/07) sem alerta.
    await heartbeat('agenda-videochamadas-sync', true, `${rows.length} atendimentos de ${totalEventos} eventos`);
    return json({ ok: true, agendas: agendas.length, total_eventos: totalEventos, atendimentos: rows.length, upserted, excluidas, match, dossie });
  } catch (e) {
    await logAdvbox('agenda', 'erro', `videochamadas sync falhou: ${e.message}`.slice(0, 300), {}).catch(() => {});
    await heartbeat('agenda-videochamadas-sync', false, e.message);
    return json({ ok: false, error: e.message }, 500);
  }
};

// (12/08/2026) De 45 para 15 minutos, a pedido do Paulo, por causa do dossie: a
// espera do lead nao vem do envio (3,5s), vem de QUANDO o sistema descobre o
// agendamento. Espera maxima cai de 45 para 15 min, media de ~19 para ~7,5.
//
// ⚠️ `*/45` nao era "a cada 45 min": em cron isso dispara nos minutos 0 e 45, com
// vaos alternados de 45 e 15 min. `*/15` e regular de verdade (0, 15, 30, 45).
//
// Custo: 96 execucoes por dia em vez de 48, com 4 leituras de agenda cada. A cota
// do Google e de 1 milhao de consultas por dia, entao o limite real esta longe.
export const config = { schedule: '*/15 * * * *' };
