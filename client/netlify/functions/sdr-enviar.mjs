/**
 * Envia UMA mensagem de texto ao lead pelo WhatsApp oficial, a partir da aba SDR.
 *
 * COMO SAI: nao existe rota REST livre no Kommo (a que existe tem teto de 500/mes no
 * plano atual). O caminho que funciona em producao aqui desde 07/2026, para a cobranca
 * e para o link de assinatura, e gravar o texto num campo do lead e rodar um Salesbot
 * de um bloco so que ecoa esse campo. A operacao composta ja existe na fila e, antes de
 * rodar o bot, CONFERE se o campo gravou: o Kommo aceita o PATCH e trunca em silencio.
 *
 * TRES TRAVAS, nesta ordem:
 *  1) sessao real do Supabase (db.auth.getUser), nunca uma flag vinda do navegador;
 *  2) permissao da aba SDR em user_permissions, ou ser socio;
 *  3) janela de 24h da Meta conferida NO SERVIDOR: uma aba aberta ha horas mostraria
 *     "janela aberta" quando ela ja fechou, e o texto livre seria recusado la fora.
 *
 * POST { leadId, texto, conversaId? }
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { enqueueKommo, drainNow } from './_lib/kommo.mjs';
import { SOCIOS_EMAILS } from './_lib/sdrAcessos.mjs';

const JSONH = { 'Content-Type': 'application/json' };
const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: JSONH });
const LIMITE = 1000; // texto livre no WhatsApp; acima disso e sinal de colagem errada

export default async (req) => {
  if (req.method !== 'POST') return resp(405, { error: 'use POST' });

  let corpo = {};
  try { corpo = await req.json(); } catch { return resp(400, { error: 'corpo invalido' }); }
  const leadId = String(corpo.leadId || '').trim();
  const texto = String(corpo.texto || '').trim();
  if (!leadId) return resp(400, { error: 'lead nao informado' });
  if (!texto) return resp(400, { error: 'escreva a mensagem antes de enviar' });
  if (texto.length > LIMITE) return resp(400, { error: `mensagem muito longa (${texto.length} caracteres, limite ${LIMITE})` });

  // trava 1: quem esta pedindo
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return resp(401, { error: 'sem sessao' });
  const { data: userData, error: authErr } = await db.auth.getUser(jwt);
  const email = (userData?.user?.email || '').toLowerCase();
  if (authErr || !email) return resp(401, { error: 'sessao invalida — faca login de novo' });

  // trava 2: permissao da aba
  if (!SOCIOS_EMAILS.includes(email)) {
    const { data: perm } = await db.from('user_permissions').select('tabs').eq('email', email).maybeSingle();
    if (!perm?.tabs?.sdr) return resp(403, { error: 'sem permissao para a aba SDR' });
  }

  // trava 3: a janela de 24h da Meta, conferida no servidor
  const { data: conversa } = await db
    .from('vw_sdr_sem_resposta')
    .select('conversa_id, janela_aberta, ultima_em')
    .eq('lead_id', leadId)
    .maybeSingle();
  if (!conversa) {
    return resp(409, { error: 'este lead nao tem conversa esperando resposta: a janela so abre com uma mensagem do cliente' });
  }
  if (!conversa.janela_aberta) {
    return resp(409, {
      error: 'fora da janela de 24 horas: a Meta so aceita template aprovado a partir daqui',
      janela_aberta: false,
      ultima_em: conversa.ultima_em,
    });
  }

  const { data: cfg } = await db
    .from('sdr_config')
    .select('kommo_campo_msg_id, kommo_bot_msg_id')
    .eq('id', 1)
    .maybeSingle();
  const fieldId = Number(cfg?.kommo_campo_msg_id) || 2444884;
  const botId = Number(cfg?.kommo_bot_msg_id) || 103102;

  const { data: registro } = await db.from('sdr_envios').insert({
    lead_id: leadId, conversa_id: conversa.conversa_id, texto,
    enviado_por: email, resultado: 'enfileirado',
  }).select('id').maybeSingle();

  try {
    const job = await enqueueKommo('sdr_send', { leadId, fieldId, value: texto, botId });
    // drena na hora: quem clicou esta olhando a tela, nao pode esperar o cron
    const r = await drainNow(job?.id || job);
    if (registro?.id) await db.from('sdr_envios').update({ resultado: 'enviado' }).eq('id', registro.id);
    await logAdvbox('sdr', 'info', 'mensagem enviada pela aba', { lead: leadId, por: email, chars: texto.length });
    return resp(200, { ok: true, lead: leadId, drenado: !!r });
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300);
    if (registro?.id) await db.from('sdr_envios').update({ resultado: 'falhou', erro: msg }).eq('id', registro.id);
    await logAdvbox('sdr', 'erro', 'falha ao enviar mensagem pela aba', { lead: leadId, por: email, erro: msg });
    return resp(502, { error: 'nao consegui enviar agora: ' + msg });
  }
};
