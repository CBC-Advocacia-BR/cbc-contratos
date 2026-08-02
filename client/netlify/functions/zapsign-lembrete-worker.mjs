/**
 * WORKER dos lembretes de assinatura (chamavel por HTTP com x-bot-key).
 * Agendado pelo dispatcher `zapsign-lembrete-cron.mjs` — ver o porque la.
 *
 * (auditoria 01/08/2026 — itens 113/320) Cobranca automatica de assinatura.
 *
 * PROBLEMA: 51 contratos aguardando assinatura, 35 parados ha mais de 7 dias e 20 ha
 * mais de 30. Cada um e dinheiro ja vendido morrendo na fila, e a unica cobranca era
 * alguem lembrar de cutucar o cliente na mao.
 *
 * POR QUE UM CRON NOSSO (e nao so o lembrete nativo do ZapSign): o campo
 * `reminder_every_n_days` so pode ser definido na CRIACAO do documento — o PUT de
 * atualizacao aceita apenas name/date_limit_to_sign/folder. Ou seja, os documentos JA
 * enviados nunca receberiam lembrete nativo. Este cron usa
 * `POST /api/v1/docs/{token}/resend-notifications-bulk/`, que reenvia a notificacao a
 * todos os signatarios PENDENTES do documento — funciona para novos e antigos, e deixa
 * o controle (kill-switch, teto, horario, registro) do nosso lado.
 *
 * Decisao do Paulo (01/08): enviar TODO DIA por e-mail, para todos os pendentes.
 *
 * SEGURANCA DE OPERACAO (o que impede isto de virar spam ou de repetir):
 *  - kill-switch em bot_config.zapsign_lembrete.ativo (desliga sem redeploy);
 *  - so 1 rodada por dia por contrato (marca `ultimo_lembrete_em` em advbox_data);
 *  - teto diario configuravel (`max_por_dia`) — evita disparo em massa acidental;
 *  - `dias_min` / `dias_max`: idade do envio em que o lembrete faz sentido;
 *  - `?simular=1` lista quem receberia SEM enviar nada (use antes do disparo real);
 *  - heartbeat + log no Monitor (itens 141-144: cron sem heartbeat morre em silencio).
 *
 * Disparo manual: POST/GET com `x-bot-key` (ou ?key=) — ver BOT_PANEL_KEY.
 */
import { db, heartbeat, logAdvbox } from './_lib/botDb.mjs';

// SEM `schedule` de proposito: a Netlify responde 403 a qualquer chamada HTTP externa
// feita a uma function AGENDADA. Como este trabalho precisa poder ser disparado a mao
// (o mutirao dos pendentes), a logica mora aqui e quem tem horario e o dispatcher
// `zapsign-lembrete-cron.mjs`. Mesmo padrao ja usado por backup-diario -> backup-worker.

const ZAPSIGN_URL = 'https://api.zapsign.com.br';
const ZAPSIGN_TOKEN = process.env.ZAPSIGN_TOKEN || '';
const PANEL_KEY = process.env.BOT_PANEL_KEY || '';

const PADRAO = {
  ativo: true,
  max_por_dia: 60,     // teto de seguranca (hoje ha ~51 pendentes)
  dias_min: 1,         // nao cutuca quem recebeu o link hoje
  dias_max: 120,       // acima disso o contrato provavelmente esfriou — decisao humana
  intervalo_dias: 1,   // "todo dia" (Paulo 01/08). Suba p/ 2/3 se virar incomodo.
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** Reenvia a notificacao a TODOS os signatarios pendentes de um documento. */
async function reenviar(docToken) {
  const r = await fetch(
    `${ZAPSIGN_URL}/api/v1/docs/${docToken}/resend-notifications-bulk/?api_token=${ZAPSIGN_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) },
  );
  const texto = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`ZapSign ${r.status}: ${texto.slice(0, 200)}`);
  return texto;
}

export default async (req) => {
  const url = new URL(req.url);
  const agendado = req.headers.get('x-netlify-event') === 'schedule';
  const chave = req.headers.get('x-bot-key') || url.searchParams.get('key') || '';
  const simular = url.searchParams.get('simular') === '1';

  // (item 9) so o agendador da Netlify OU alguem com a chave dispara isto. Sem a trava,
  // qualquer visitante conseguiria mandar e-mail aos clientes em nome do escritorio.
  if (!agendado) {
    if (!PANEL_KEY) return json(503, { ok: false, error: 'BOT_PANEL_KEY nao configurada — disparo manual desativado.' });
    if (chave !== PANEL_KEY) return json(401, { ok: false, error: 'nao autorizado' });
  }
  if (!ZAPSIGN_TOKEN) {
    await heartbeat('zapsign-lembrete-cron', false, 'ZAPSIGN_TOKEN ausente');
    return json(503, { ok: false, error: 'ZAPSIGN_TOKEN nao configurado' });
  }

  try {
    const { data: cfgRow } = await db.from('bot_config').select('value').eq('key', 'zapsign_lembrete').maybeSingle();
    const cfg = { ...PADRAO, ...(cfgRow?.value || {}) };
    if (!cfg.ativo && !simular) {
      await heartbeat('zapsign-lembrete-cron', true, 'desligado na config');
      return json(200, { ok: true, desligado: true });
    }

    const hoje = new Date();
    const limiteNovo = new Date(hoje.getTime() - cfg.dias_min * 86400000).toISOString();
    const limiteVelho = new Date(hoje.getTime() - cfg.dias_max * 86400000).toISOString();

    // Pendentes = enviados ao ZapSign, ainda nao assinados, vivos (nao arquivados/cancelados).
    //
    // (02/08/2026 — decisao do Paulo: "lembrar TODOS os contratos pendentes de assinatura")
    // ⚠️ O filtro antes exigia `zapsign_sent_at`, e **12 dos 23 pendentes estao com essa
    // data NULA** (o mais antigo de 25/05) — provavelmente enviados por um caminho que nao
    // gravou a data. Eles ficavam invisiveis para o lembrete PARA SEMPRE, sem ninguem notar.
    // Agora a referencia e `zapsign_sent_at` OU, na falta dela, `created_at`: todo contrato
    // pendente entra na conta. A janela (dias_min/dias_max) continua valendo sobre essa
    // data de referencia — ela existe para nao cutucar quem recebeu o link hoje nem quem ja
    // esfriou faz meses.
    const { data: brutos, error } = await db
      .from('contratos')
      .select('id, nome_contratante1, zapsign_doc_token, zapsign_sent_at, created_at, advbox_data')
      .eq('status', 'enviado_zapsign')
      .not('zapsign_doc_token', 'is', null)
      .is('arquivado_em', null)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`supabase: ${error.message}`);

    // data de referencia + janela, aplicadas aqui (o filtro no banco nao alcanca o coalesce)
    const dentroDaJanela = (c) => {
      const ref = c.zapsign_sent_at || c.created_at;
      if (!ref) return false;
      return ref <= limiteNovo && ref >= limiteVelho;
    };
    const pendentes = (brutos || []).filter(dentroDaJanela).slice(0, cfg.max_por_dia);

    const agoraMs = Date.now();
    const elegiveis = (pendentes || []).filter((c) => {
      const ultimo = c.advbox_data?.zapsign_lembrete?.ultimo_em;
      if (!ultimo) return true;
      // respeita o intervalo (1 = todo dia) e garante idempotencia se o cron rodar 2x
      return (agoraMs - new Date(ultimo).getTime()) >= cfg.intervalo_dias * 86400000;
    });

    if (simular) {
      await heartbeat('zapsign-lembrete-cron', true, `simulacao: ${elegiveis.length} elegiveis`);
      return json(200, {
        ok: true, simulacao: true, total_pendentes: (pendentes || []).length,
        elegiveis: elegiveis.length,
        lista: elegiveis.map((c) => ({
          id: c.id, cliente: c.nome_contratante1,
          enviado_em: c.zapsign_sent_at,
          // sem data de envio registrada, a referencia e a criacao do contrato
          referencia: c.zapsign_sent_at ? 'envio' : 'criacao do contrato',
          dias_parado: Math.floor((agoraMs - new Date(c.zapsign_sent_at || c.created_at).getTime()) / 86400000),
        })),
      });
    }

    let enviados = 0;
    const falhas = [];
    for (const c of elegiveis) {
      try {
        await reenviar(c.zapsign_doc_token);
        enviados++;
        // marca DENTRO de advbox_data (jsonb ja existente) — sem coluna nova
        const advbox = { ...(c.advbox_data || {}) };
        advbox.zapsign_lembrete = {
          ultimo_em: new Date().toISOString(),
          total: (advbox.zapsign_lembrete?.total || 0) + 1,
        };
        await db.from('contratos').update({ advbox_data: advbox }).eq('id', c.id);
      } catch (e) {
        falhas.push({ id: c.id, erro: String(e.message || e).slice(0, 160) });
      }
      await new Promise((r) => setTimeout(r, 300)); // respiro entre chamadas
    }

    const msg = `lembrete de assinatura: ${enviados} enviados, ${falhas.length} falhas (${elegiveis.length} elegiveis de ${(pendentes || []).length} pendentes)`;
    await logAdvbox('zapsign', falhas.length ? 'aviso' : 'info', msg, { enviados, falhas });
    await heartbeat('zapsign-lembrete-cron', falhas.length === 0, msg);
    return json(200, { ok: true, enviados, falhas, elegiveis: elegiveis.length });
  } catch (e) {
    const msg = String(e.message || e);
    await logAdvbox('zapsign', 'erro', `lembrete de assinatura falhou: ${msg}`, {});
    await heartbeat('zapsign-lembrete-cron', false, msg);
    return json(500, { ok: false, error: 'falha ao processar lembretes' });
  }
};
