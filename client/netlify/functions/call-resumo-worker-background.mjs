/**
 * WORKER do resumo automatico das videochamadas de venda (16/10/2026).
 * Agendado pelo dispatcher `call-resumo-cron.mjs` (padrao zapsign-lembrete / backup).
 * Background (ate 15 min): cada resumo leva de 20 s a 1 min no Claude, nao cabe nos ~26 s
 * de uma function comum.
 *
 * Fluxo por videochamada REALIZADA (agenda_videochamadas, via RPC call_resumo_pendentes):
 *   1. acha a transcricao do Meet no Google da vendedora (conta de servico, so leitura);
 *   2. le o Doc como texto (a transcricao NAO e gravada no banco — LGPD);
 *   3. pede ao Claude a ficha do atendimento em JSON (structured outputs, _lib/callResumo);
 *   4. grava em call_resumos; alerta de compliance vai para o console do Monitor;
 *   5. se bot_config.call_resumo.postar_kommo = true e houver lead, posta a nota no Kommo
 *      (kommo-note, idempotente pelo marcador CBC.call:<event_id>).
 *
 * Seguranca de operacao:
 *  - kill-switch bot_config.call_resumo.ativo (nasce false) e postar_kommo (nasce false);
 *  - teto por rodada (max_por_rodada) e orcamento de tempo de 12 min;
 *  - re-tentativa espacada so para "sem transcricao"/"erro", ate 8 vezes (na RPC);
 *  - impersonacao Google limitada a lista de vendedoras (_lib/googleSa.exigirVendedora);
 *  - nada aqui fala com o cliente.
 *
 * Disparo manual (conferencia), com cabecalho x-bot-key = BOT_PANEL_KEY:
 *   POST /.netlify/functions/call-resumo-worker-background?event_id=<id>
 *   -> processa SO essa call, mesmo com a rotina desligada (nao posta no Kommo se
 *      postar_kommo=false). O resultado fica em call_resumos.
 */
import Anthropic from '@anthropic-ai/sdk';
import { db, getConfig, heartbeat, logAdvbox } from './_lib/botDb.mjs';
import { verificarGatilho } from './_lib/gatilho.mjs';
import { acharTranscricao, lerDocComoTexto } from './_lib/googleSa.mjs';
import {
  MODELO_PADRAO, SISTEMA, SCHEMA, montarPedido, motivoParaPular, validarResumo,
  marcadorKommo, textoNotaKommo, alertasGestao, custoUsd,
} from './_lib/callResumo.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const SELF = process.env.URL || 'https://contratos-cbc.netlify.app';
const JOB = 'call-resumo-worker';
const ORCAMENTO_MS = 12 * 60 * 1000;
// Fallback do servidor quando um classificador de seguranca recusa (Opus/Sonnet 5.5).
const COM_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

async function gravar(row) {
  const { error } = await db.rpc('call_resumo_gravar', { p_chave: RPC_SECRET, p_row: row });
  if (error) throw new Error(`call_resumo_gravar: ${error.message}`);
}

/** Chama o Claude e devolve { resumo, usage, stop } — sem rede alem da Anthropic. */
async function resumir(client, cfg, call, transcricao) {
  const modelo = cfg.modelo || MODELO_PADRAO;
  const params = {
    model: modelo,
    max_tokens: 16000,
    system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
    output_config: {
      effort: cfg.esforco || 'medium',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [{
      role: 'user',
      content: montarPedido({ vendedora: call.vendedora_email, clienteNome: call.cliente_nome, scheduledAt: call.scheduled_at }, transcricao),
    }],
  };
  const resp = COM_FALLBACK.has(modelo)
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);

  if (resp.stop_reason === 'refusal') return { recusado: true, usage: resp.usage, modelo: resp.model };
  if (resp.stop_reason === 'max_tokens') throw new Error('resposta cortada (max_tokens)');
  const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { resumo: validarResumo(JSON.parse(texto)), usage: resp.usage, modelo: resp.model };
}

async function postarKommo(call, resumo) {
  const r = await fetch(`${SELF}/.netlify/functions/kommo-note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leadId: call.lead_id,
      marker: marcadorKommo(call.event_id),
      text: textoNotaKommo(resumo, { vendedora: call.vendedora_email, scheduledAt: call.scheduled_at }),
    }),
    signal: AbortSignal.timeout(25000),
  });
  // kommo-note responde 200 ate no erro: o que vale e o campo ok
  const j = await r.json().catch(() => ({}));
  const ok = r.ok && j.ok === true;
  await db.rpc('call_resumo_kommo', { p_chave: RPC_SECRET, p_event_id: call.event_id, p_ok: ok, p_erro: ok ? null : (j.error || j.reason || `HTTP ${r.status}`) });
  return ok;
}

/** Processa uma call. Devolve o status gravado. Erros de rede da Anthropic sobem. */
async function processar(client, cfg, call, { postar }) {
  const base = { event_id: call.event_id, vendedora_email: call.vendedora_email, lead_id: call.lead_id, scheduled_at: call.scheduled_at };

  let achado;
  try {
    achado = await acharTranscricao({ vendedora: call.vendedora_email, eventId: call.event_id, scheduledAt: call.scheduled_at });
  } catch (e) {
    await gravar({ ...base, status: 'erro', erro: `google: ${e.message}`.slice(0, 300) });
    return 'erro';
  }
  if (!achado) {
    await gravar({ ...base, status: 'sem_transcricao' });
    return 'sem_transcricao';
  }
  const meta = { ...base, transcricao_file_id: achado.fileId, transcricao_tipo: achado.tipo, transcricao_origem: achado.origem };

  const texto = await lerDocComoTexto(call.vendedora_email, achado.fileId);
  const pular = motivoParaPular(texto);
  if (pular) {
    await gravar({ ...meta, status: pular, transcricao_chars: texto.length });
    return pular;
  }

  const out = await resumir(client, cfg, call, texto);
  const custo = custoUsd(out.usage, out.modelo);
  const uso = { modelo: out.modelo, tokens_entrada: out.usage?.input_tokens ?? null, tokens_saida: out.usage?.output_tokens ?? null, custo_usd: custo };
  if (out.recusado) {
    await gravar({ ...meta, ...uso, status: 'recusado', transcricao_chars: texto.length });
    await logAdvbox('ia', 'aviso', `resumo de call recusado pelo modelo (${call.vendedora_email}, ${call.event_id})`, { event_id: call.event_id });
    return 'recusado';
  }

  const r = out.resumo;
  const alertas = alertasGestao(r);
  const status = r.houve_atendimento ? 'ok' : 'sem_atendimento';
  await gravar({
    ...meta, ...uso, status,
    transcricao_chars: texto.length,
    resumo: r,
    temperatura: r.temperatura,
    alerta_compliance: alertas.some((a) => a.tipo === 'compliance'),
    nota_kommo: r.houve_atendimento ? textoNotaKommo(r, { vendedora: call.vendedora_email, scheduledAt: call.scheduled_at }) : null,
  });

  if (alertas.length) {
    await logAdvbox('ia', 'aviso', `call ${call.vendedora_email.split('@')[0]}: ${alertas.map((a) => `[${a.tipo}] ${a.descricao}`).join(' | ')}`.slice(0, 480),
      { event_id: call.event_id, lead_id: call.lead_id, alertas });
  }
  if (status === 'ok' && postar && call.lead_id) await postarKommo(call, r);
  return status;
}

export default async (req) => {
  const v = verificarGatilho(req);
  if (!v.ok) return; // background: a resposta nao chega a ninguem; so nao trabalha

  const url = new URL(req.url);
  const eventoManual = url.searchParams.get('event_id');
  const inicio = Date.now();
  const contagem = {};
  try {
    const cfg = (await getConfig()).call_resumo || {};
    if (!eventoManual && !cfg.ativo) {
      await heartbeat(JOB, true, 'desligado (bot_config.call_resumo.ativo=false)');
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY nao configurada');
    if (!process.env.GOOGLE_SA_KEY_JSON) throw new Error('GOOGLE_SA_KEY_JSON nao configurada');
    if (!RPC_SECRET) throw new Error('BOT_RPC_SECRET nao configurada');

    const { data: fila, error } = eventoManual
      ? await db.rpc('call_resumo_um', { p_chave: RPC_SECRET, p_event_id: eventoManual })
      : await db.rpc('call_resumo_pendentes', { p_chave: RPC_SECRET, p_dias: cfg.dias || 3, p_limite: cfg.max_por_rodada || 8 });
    if (error) throw new Error(`fila: ${error.message}`);

    const client = new Anthropic(); // le ANTHROPIC_API_KEY
    const postar = cfg.postar_kommo === true;
    for (const call of fila || []) {
      if (Date.now() - inicio > ORCAMENTO_MS) { contagem.adiadas = (contagem.adiadas || 0) + 1; continue; }
      try {
        const st = await processar(client, cfg, call, { postar });
        contagem[st] = (contagem[st] || 0) + 1;
      } catch (e) {
        // Chave invalida ou limite de uso: parar a rodada inteira (as outras falhariam igual).
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw e;
        if (e instanceof Anthropic.RateLimitError) { contagem.limite_api = 1; break; }
        await gravar({ event_id: call.event_id, vendedora_email: call.vendedora_email, lead_id: call.lead_id, scheduled_at: call.scheduled_at, status: 'erro', erro: String(e.message).slice(0, 300) }).catch(() => {});
        contagem.erro = (contagem.erro || 0) + 1;
      }
    }

    const resumo = Object.entries(contagem).map(([k, n]) => `${k}=${n}`).join(', ') || 'nada pendente';
    if ((fila || []).length) await logAdvbox('ia', contagem.erro ? 'aviso' : 'info', `resumo de calls: ${resumo}`, { contagem, manual: !!eventoManual });
    await heartbeat(JOB, true, resumo);
  } catch (e) {
    await logAdvbox('ia', 'erro', `resumo de calls falhou: ${e.message}`.slice(0, 300), { contagem });
    await heartbeat(JOB, false, e.message);
  }
};
