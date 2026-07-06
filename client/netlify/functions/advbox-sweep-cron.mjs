/**
 * Scheduled: advbox-sweep-cron (a cada 20 min, 24/7)  — auditoria #75/#20
 *
 * BACKSTOP server-side do fluxo "assinado -> ADVBOX". Antes, o cadastro do processo
 * no ADVBOX so acontecia enquanto ALGUEM estava com o app aberto (polling de 5min no
 * App.jsx). De noite / fim de semana / feriado, um contrato assinado podia ficar horas
 * sem virar processo (o webhook do ZapSign so muda o status p/ 'assinado', nao dispara
 * o advbox-sync). Este cron roda o MESMO "PART 2" (parte ADVBOX) no servidor.
 *
 * SEGURANCA CONTRA DUPLICIDADE: usa o MESMO claim atomico do App.jsx — um UPDATE
 * condicional (advbox_status -> 'processing' WHERE status IN null/''/error). Se o app
 * e o cron rodarem juntos, so UM ganha o claim (o outro recebe 0 linhas). Portanto
 * coexiste com o polling do cliente sem criar processo 2x.
 *
 * ESCOPO: so a parte ADVBOX (criacao do processo). O Google Drive continua no polling
 * do App.jsx — a logica de lock/orfao/retry dele usa um util do cliente e e mais
 * entrelacada; fica para um proximo passo. (Ver auditoria #75, parte Drive.)
 */
import { supa } from './_lib/supabaseClient.mjs';
import { heartbeat } from './_lib/botDb.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
const jres = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async () => {
  const out = { candidatos: 0, ok: 0, erro: 0, pulados: 0 };
  if (!supa) { await heartbeat('advbox-sweep-cron', false, 'supabase env ausente'); return jres({ ok: false, error: 'supabase env ausente' }); }

  const { data: needs, error } = await supa
    .from('contratos')
    .select('id, dados, advbox_status, advbox_date, advbox_lawsuit_id, advbox_data, signed_at, zapsign_doc_token')
    .eq('status', 'assinado')
    .not('zapsign_doc_token', 'is', null)
    // mesmas condicoes de ADVBOX avaliadas no cliente (null/''/error/processing).
    .or('advbox_status.is.null,advbox_status.eq.error,advbox_status.eq.,advbox_status.eq.processing');
  if (error) { await heartbeat('advbox-sweep-cron', false, error.message); return jres({ ok: false, error: error.message }); }

  for (const c of (needs || [])) {
    if (!c.dados) { out.pulados++; continue; }

    // stuck 'processing' recovery (>5min OU sem advbox_date) — identico ao App.jsx
    const needsAdvbox = c.advbox_status !== 'ok' && (
      !c.advbox_status || c.advbox_status === 'error' ||
      (c.advbox_status === 'processing' && (!c.advbox_date || (Date.now() - new Date(c.advbox_date).getTime() > 5 * 60 * 1000)))
    );
    if (!needsAdvbox) { out.pulados++; continue; }
    out.candidatos++;

    // reseta o 'processing' travado antes do claim (condicional — nao mexe em quem
    // esta legitimamente processando ha <5min)
    if (c.advbox_status === 'processing') {
      await supa.from('contratos').update({ advbox_status: null }).eq('id', c.id).eq('advbox_status', 'processing');
    }

    // CLAIM ATOMICO (a trava). So um caller — app OU este cron — ganha a vaga.
    const { data: claimed } = await supa.from('contratos')
      .update({ advbox_status: 'processing', advbox_date: new Date().toISOString() })
      .eq('id', c.id)
      .or('advbox_status.is.null,advbox_status.eq.error,advbox_status.eq.')
      .select('id');
    if (!claimed?.length) { out.pulados++; continue; } // outro caller pegou primeiro

    try {
      // data de fechamento = data REAL da assinatura (signed_at), nao a data do sync.
      const dataAssin = c.signed_at ? new Date(c.signed_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const advResp = await fetch(`${SELF_URL}/.netlify/functions/advbox-sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...c.dados,
          dataAssinatura: dataAssin,
          // idempotencia no retry: reusa processo/clientes ja criados em vez de duplicar.
          existingLawsuitId: c.advbox_lawsuit_id || null,
          existingCustomers: c.advbox_data?.customers || null,
        }),
      });
      const advResult = await advResp.json();
      // so 'ok' se o PROCESSO (lawsuit) tambem foi criado e TODOS os contratantes viraram cliente.
      const advOk = advResult.success && advResult.customersComplete && !!advResult.lawsuit?.id;
      await supa.from('contratos').update({
        advbox_status: advOk ? 'ok' : 'error',
        advbox_date: new Date().toISOString(), advbox_data: advResult,
        advbox_lawsuit_id: advResult?.lawsuit?.id || null,
      }).eq('id', c.id);
      try { await supa.from('automation_log').insert({ contract_id: c.id, action: 'advbox', status: advOk ? 'ok' : 'error', details: advResult, client_name: c.dados?.contratantes?.[0]?.nome }); } catch { /* best-effort */ }
      if (advResult.warnings?.length) {
        try { await supa.from('automation_log').insert({ contract_id: c.id, action: 'kommo', status: 'aviso', details: { warnings: advResult.warnings }, client_name: c.dados?.contratantes?.[0]?.nome }); } catch { /* best-effort */ }
      }
      if (advOk) out.ok++; else out.erro++;
    } catch (e) {
      await supa.from('contratos').update({ advbox_status: 'error', advbox_date: new Date().toISOString() }).eq('id', c.id);
      try { await supa.from('automation_log').insert({ contract_id: c.id, action: 'advbox', status: 'error', details: { error: e.message }, client_name: c.dados?.contratantes?.[0]?.nome }); } catch { /* best-effort */ }
      out.erro++;
    }
  }

  await heartbeat('advbox-sweep-cron', out.erro === 0, `cand ${out.candidatos}, ok ${out.ok}, erro ${out.erro}`);
  console.log('[advbox-sweep-cron]', JSON.stringify(out));
  return jres({ ok: true, ...out });
};

// A cada 20 min, TODOS os dias — nao depende de ninguem com o app aberto.
export const config = { schedule: '*/20 * * * *' };
