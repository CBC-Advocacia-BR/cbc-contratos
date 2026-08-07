// ─────────────────────────────────────────────────────────────────────────
// RECONCILIACAO POS-QUEDA (06/08/2026)
//
// PARA QUE SERVE
// Quando o banco volta de uma queda, os dados nao voltam sozinhos ao dia: durante a
// janela fora do ar, webhooks chegaram e nao puderam ser gravados, e as rotinas
// agendadas que caiam naquele horario simplesmente nao rodaram. Esta function e o passo
// que fecha essa lacuna, e ate hoje era feita a mao (foi assim no incidente de
// 17/07/2026, com os crons re-disparados um a um).
//
// O QUE TORNA ISTO VIAVEL
// O sistema e "espelho": quase tudo aqui e copia de uma fonte externa (Asaas, ZapSign,
// ADVBOX, Kommo, Meta) que continuou guardando a verdade enquanto o banco estava fora.
// Entao o dado nao se perdeu — ficou desatualizado. Re-sincronizar recupera.
//
// ⚠️ O LIMITE HONESTO DESTA FUNCTION
// Uma function AGENDADA da Netlify devolve 403 a qualquer chamada HTTP externa (bloqueio
// na borda, antes do codigo rodar). Por isso so da para re-disparar as rotinas que tem
// um WORKER separado, sem `schedule`. As demais ficam na lista `manual` da resposta, e
// precisam do botao "Run now" no painel da Netlify. Preferi listar o que nao consigo
// fazer a fingir cobertura total.
//
// COMO CHAMAR A MAO
//   curl -X POST "https://contratos-cbc.netlify.app/.netlify/functions/pos-queda-reconciliar" \
//        -H "x-bot-key: SUA_BOT_PANEL_KEY"
// ─────────────────────────────────────────────────────────────────────────

import { db, heartbeat, logAdvbox } from './_lib/botDb.mjs';
import { avisarIncidente } from './_lib/avisoResiliente.mjs';
import { RESSINCRONIZAR, agendadasNaJanela } from './_lib/reconciliacao.mjs';

const SELF = process.env.URL || 'https://contratos-cbc.netlify.app';
const CHAVE = process.env.BOT_PANEL_KEY || '';

async function dispararWorker(nome) {
  try {
    const r = await fetch(`${SELF}/.netlify/functions/${nome}`, {
      method: 'POST',
      headers: { 'x-bot-key': CHAVE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ origem: 'pos-queda-reconciliar' }),
      signal: AbortSignal.timeout(25000),
    });
    return { nome, ok: r.ok, status: r.status };
  } catch (e) {
    return { nome, ok: false, erro: e.message };
  }
}

/** Conferencias que revelam trabalho que ficou pela metade. Nunca lanca. */
async function conferirIntegridade() {
  const achados = [];
  try {
    const { count } = await db.from('kommo_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed');
    if (count > 0) achados.push(`fila do Kommo com ${count} job(s) falhado(s): nota ou mensagem pode ter se perdido`);
  } catch (e) { achados.push(`nao consegui conferir a fila do Kommo: ${e.message}`); }

  try {
    // contrato assinado ha mais de 3 dias sem cobranca lancada (mesma regra do watchdog)
    const limite = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data } = await db.from('contratos')
      .select('id, nome_cliente, signed_at, asaas_payment_id')
      .eq('status', 'assinado').lt('signed_at', limite).is('asaas_payment_id', null)
      .limit(20);
    if (data?.length) achados.push(`${data.length} contrato(s) assinado(s) ha mais de 3 dias sem cobranca lancada`);
  } catch { /* coluna pode variar; nao e o foco desta function */ }

  return achados;
}

export default async (req) => {
  // autenticacao: mesma chave dos paineis internos
  const chaveEnviada = req.headers.get('x-bot-key') || '';
  if (!CHAVE || chaveEnviada !== CHAVE) {
    return new Response(JSON.stringify({ ok: false, erro: 'nao autorizado' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const t0 = Date.now();
  let corpo = {};
  try { corpo = await req.json(); } catch { /* chamada sem corpo e valida */ }

  const fim = new Date().toISOString();
  // sem janela informada, assume as ultimas 2 horas (cobre a queda tipica com folga)
  const inicio = corpo.foraDesde || new Date(Date.now() - 2 * 3600000).toISOString();

  const out = { janela: { inicio, fim }, ressincronizado: [], manual: [], integridade: [] };

  // 1) re-disparar o que da para re-disparar, em sequencia (a maquina e pequena: uma
  //    enxurrada de syncs simultaneos e justamente o tipo de carga que derruba de novo)
  for (const r of RESSINCRONIZAR) {
    const res = await dispararWorker(r.nome);
    out.ressincronizado.push({ ...res, porque: r.porque });
  }

  // 2) listar o que precisa de mao humana
  out.manual = agendadasNaJanela(inicio, fim).map((a) => ({
    rotina: a.nome,
    critico: a.critico,
    obs: a.obs || null,
    como: `painel da Netlify > Logs & metrics > Functions > ${a.nome} > Run now`,
  }));

  // 3) conferencias de integridade
  out.integridade = await conferirIntegridade();

  const falhas = out.ressincronizado.filter((r) => !r.ok);
  const precisaGente = out.manual.filter((m) => m.critico);

  const resumo = `reconciliacao: ${out.ressincronizado.length - falhas.length}/${out.ressincronizado.length} re-sincronizados`
    + `${falhas.length ? `, ${falhas.length} falhou` : ''}`
    + `${out.manual.length ? `, ${out.manual.length} rotina(s) precisam de Run now` : ''}`
    + `${out.integridade.length ? `, ${out.integridade.length} achado(s) de integridade` : ''}`;

  await logAdvbox('infra', falhas.length || precisaGente.length ? 'erro' : 'aviso', resumo.slice(0, 300), out);

  // so incomoda uma pessoa quando ha algo que so ela pode fazer
  if (precisaGente.length || falhas.length || out.integridade.length) {
    await avisarIncidente({
      titulo: 'Reconciliacao pos-queda concluida com pendencias',
      detalhe: [
        resumo,
        ...precisaGente.map((m) => `RODAR A MAO: ${m.rotina} (${m.como})`),
        ...out.integridade,
      ].join(' | '),
      severidade: 'critico',
    });
  }

  await heartbeat('pos-queda-reconciliar', falhas.length === 0, resumo.slice(0, 200));
  console.log('[pos-queda-reconciliar]', JSON.stringify(out));

  return new Response(JSON.stringify({ ok: falhas.length === 0, resumo, ...out, ms: Date.now() - t0 }),
    { headers: { 'Content-Type': 'application/json' } });
};

export const config = { path: '/.netlify/functions/pos-queda-reconciliar' };
