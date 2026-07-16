/**
 * (v2 #104) Resumo SEMANAL de trafego — toda segunda 08h BRT: semana fechada vs
 * anterior + top campanhas, no sino in-app e por e-mail (Resend) aos destinatarios
 * da config (default: trio). RH/vagas ficam fora dos numeros (montarResumoSemanal).
 * GET manual livre p/ teste (nao altera nada; so envia o resumo de novo).
 */
import { db, logAdvbox } from './_lib/botDb.mjs';
import { montarResumoSemanal } from './_lib/metaAds.mjs';
import { lerConfig, TRIO } from './_lib/metaTrafego.mjs';
import { sendAlertEmail } from './_lib/alertEmail.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const JSONH = { 'Content-Type': 'application/json' };

export default async () => {
  try {
    const { data: series, error } = await db.rpc('meta_trafego_series', { p_chave: RPC_SECRET, p_dias: 14 });
    if (error) throw new Error(`RPC meta_trafego_series: ${error.message}`);

    const { assunto, linhas } = montarResumoSemanal(series || {});
    const cfg = await lerConfig();
    const dest = cfg.alertas.destinatarios || TRIO;

    for (const email of dest) {
      try {
        await db.from('notifications').insert({
          user_email: email,
          type: 'info',
          title: assunto,
          body: linhas.join('\n'),
          link: null,
        });
      } catch { /* nunca derruba o resumo */ }
    }
    const mail = await sendAlertEmail(assunto, linhas, {
      to: dest,
      titulo: '📊 Resumo semanal — Tráfego Meta',
      rodape: 'Enviado toda segunda 08h pela aba Tráfego do CBC Contratos. Campanhas de vaga (RH) ficam fora destes números.',
    });

    await logAdvbox('meta', 'info', `resumo semanal enviado: ${linhas[0] || ''}`.slice(0, 300), { email: mail.ok ? 'enviado' : (mail.skipped || mail.error), destinatarios: dest.length });
    return new Response(JSON.stringify({ success: true, assunto, linhas, email: mail.ok || mail.skipped || mail.error }), { headers: JSONH });
  } catch (e) {
    await logAdvbox('meta', 'error', `resumo semanal falhou: ${e.message}`, {});
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSONH });
  }
};

export const config = {
  schedule: '0 11 * * 1', // segunda 08h BRT
};
