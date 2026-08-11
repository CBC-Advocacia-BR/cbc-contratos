/**
 * Worker (background, ate 15 min): backfill do espelho de mensagens (sdr_mensagens)
 * para leads que ja existiam antes do webhook add_message comecar a gravar. Sem isso
 * a fila da aba SDR nasceria vazia para toda conversa anterior ao deploy do webhook.
 *
 * Para cada lead recente do funil Venda, busca os eventos de chat do CONTATO principal
 * (incoming_chat_message + outgoing_chat_message) e grava no espelho, idempotente via
 * kommo_msg_id unico (prefixo 'ev-' para nao colidir com o id que o webhook grava —
 * o webhook usa o id da mensagem, o events API usa o id do EVENTO).
 *
 * ATENCAO (licao de 02/07/2026, medida em producao): os events do Kommo NAO retornam
 * filtrando por lead, so por CONTATO. Mesmo caminho ja usado por
 * kommo-sla-worker-background.mjs (referencia viva deste padrao):
 * /events?filter[type]=<tipo>&filter[entity]=contact&filter[entity_id]=<contactId>
 * &filter[created_at][from]=<unix>&limit=100&page=N
 *
 * Disparo: so pelo despachante sdr-espelho-backfill.mjs (x-bot-key), nunca direto por
 * acesso de navegador.
 */
import { verificarGatilho, respostaNegada } from './_lib/gatilho.mjs';
import { kommoGet } from './_lib/kommo.mjs';
import { supa } from './_lib/supabaseClient.mjs';
import { logAdvbox } from './_lib/botDb.mjs';

const PIPELINE_VENDA = 13760367;
const TIPOS = [['incoming_chat_message', 'in'], ['outgoing_chat_message', 'out']];

async function eventosDoContato(contactId, desdeUnix, tipo) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const d = await kommoGet(
      `/events?filter[type]=${tipo}&filter[entity]=contact&filter[entity_id]=${contactId}`
      + `&filter[created_at][from]=${desdeUnix}&limit=100&page=${page}`
    ).catch(() => null);
    const evs = d?._embedded?.events || [];
    out.push(...evs);
    if (evs.length < 100) break;
  }
  return out;
}

export default async (req) => {
  // worker NAO e agendado (sem `schedule`): so o despachante (com x-bot-key) pode
  // chama-lo — sem isto qualquer acesso direto de navegador disparava o backfill.
  const gate = verificarGatilho(req);
  if (!gate.ok) return respostaNegada(gate);

  let dias = 7;
  try { ({ dias = 7 } = await req.json()); } catch { /* usa o padrao */ }
  dias = Math.min(Math.max(Number(dias) || 7, 1), 30);

  if (!supa) {
    await logAdvbox('sdr', 'erro', 'backfill do espelho sem supabase configurado', {});
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }

  const desdeUnix = Math.floor((Date.now() - dias * 86400000) / 1000);
  const leads = await kommoGet(
    `/leads?filter[pipeline_id]=${PIPELINE_VENDA}&filter[created_at][from]=${desdeUnix}&limit=250&with=contacts`
  ).catch(() => null);
  const lista = leads?._embedded?.leads || [];

  let gravadas = 0;
  for (const lead of lista) {
    const contato = lead?._embedded?.contacts?.[0];
    if (!contato) continue;
    for (const [tipo, direcao] of TIPOS) {
      const evs = await eventosDoContato(contato.id, desdeUnix, tipo);
      const linhas = evs.map((e) => ({
        kommo_msg_id: `ev-${e.id}`,
        lead_id: String(lead.id),
        contact_id: String(contato.id),
        direcao,
        autor_id: Number(e.created_by) || null,
        autor_nome: null,
        tipo: 'texto',
        texto: e?.value_after?.[0]?.message?.text || '',
        criado_em: new Date(Number(e.created_at) * 1000).toISOString(),
      })).filter((l) => l.texto);
      if (!linhas.length) continue;
      const { error } = await supa
        .from('sdr_mensagens')
        .upsert(linhas, { onConflict: 'kommo_msg_id', ignoreDuplicates: true });
      if (!error) gravadas += linhas.length;
      else await logAdvbox('sdr', 'erro', 'backfill: falha ao gravar lote no espelho', { lead: lead.id, erro: error.message });
    }
  }

  await logAdvbox('sdr', 'info', 'backfill do espelho concluido', { leads: lista.length, gravadas, dias });
  return new Response(JSON.stringify({ ok: true, leads: lista.length, gravadas }), { status: 200 });
};
