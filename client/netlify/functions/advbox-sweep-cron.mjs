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
 * ESCOPO (01/08/2026 — auditoria itens 134 e 126): alem da parte ADVBOX, este cron virou
 * o backstop dos outros dois passos que dependiam do navegador estar aberto:
 *   - GOOGLE DRIVE: apos 6h sem ninguem arquivar, sobe ao menos o PDF assinado (os DOCX
 *     continuam sendo gerados no navegador, unico lugar onde ha como monta-los);
 *   - LINK DE ASSINATURA no WhatsApp: apos 15min sem disparo, chama a function de envio.
 * Os tres blocos usam a MESMA trava atomica do App.jsx, entao navegador e cron nunca
 * duplicam trabalho — quem chegar primeiro ganha, o outro pula.
 */
// (fix 28/07/2026) usa o cliente do botDb, nao o de supabaseClient.mjs: aquele resolve a
// chave por env e cai em VITE_SUPABASE_ANON_KEY, que **nao existe no runtime das Netlify
// Functions** (VITE_* e build-only do frontend) — sem SUPABASE_SERVICE_ROLE_KEY setada o
// client saia null e este cron morria na 1a linha ("supabase env ausente") desde sempre,
// deixando o backstop 24/7 do "assinado -> ADVBOX" desligado. O `db` do botDb tem fallback
// proprio da anon key e sempre funciona (mesma causa/fix do 502 do vinculo-kommo).
import { db as supa, heartbeat, logAdvbox } from './_lib/botDb.mjs';
import { diaBrtDe } from './_lib/dataBrt.mjs';

const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';
// (item 134) o backstop do Drive precisa buscar a URL do PDF assinado no ZapSign
const ZAPSIGN_TOKEN = process.env.ZAPSIGN_TOKEN || '';
const jres = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async () => {
  // (auditoria 01/08 — item 93) ORCAMENTO DE TEMPO.
  // Este cron nao tinha prazo: com fila acumulada (cada contrato faz varias chamadas a
  // APIs externas), ele era MORTO no teto do Netlify no meio de um contrato — que ficava
  // preso em 'processing' ate o proximo ciclo destravar. E o risco cresceu agora que o
  // arquivo cobre tres backstops (ADVBOX + Drive + link de assinatura).
  // 20s deixa margem confortavel dentro do limite de ~26s das functions sincronas deste
  // site: o que nao couber e retomado na proxima rodada (a cada 20 min), sem perda —
  // todos os blocos sao idempotentes e usam claim atomico.
  const PRAZO_MS = 20000;
  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < PRAZO_MS;
  const out = { candidatos: 0, ok: 0, erro: 0, pulados: 0, interrompido: false };
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
    if (!temTempo()) { out.interrompido = true; break; }   // (item 93) retoma na proxima rodada
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
      const dataAssin = diaBrtDe(c.signed_at || Date.now());
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

  // ─── BACKSTOP DO GOOGLE DRIVE (auditoria 01/08 — item 134) ───────────────
  // O arquivamento no Drive continuava SO no polling do navegador: contrato assinado
  // sexta a noite ficava sem pasta ate alguem logar na segunda. O motivo de nunca ter
  // sido portado e que o caminho do cliente tambem gera os DOCX (contrato e procuracao)
  // no navegador — isso o servidor nao faz.
  //
  // A escolha aqui: depois de 6 HORAS sem ninguem arquivar, subir ao menos o PDF
  // ASSINADO (que e o documento que importa) em vez de deixar a pasta vazia. Os DOCX
  // seguem sendo gerados pelo caminho normal quando alguem abre o app — e o registro
  // marca `backstop: true, docx: false` para ficar claro o que foi feito.
  // As 6h dao folga total para o fluxo normal do dia; o backstop so pega o que "dormiu".
  out.drive = { candidatos: 0, ok: 0, erro: 0 };
  try {
    const seisHorasAtras = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: semDrive } = await supa
      .from('contratos')
      .select('id, dados, zapsign_doc_token, pdf_page_split, signed_at, drive_attempts, drive_last_attempt_at')
      .eq('status', 'assinado')
      .is('drive_file_id', null)
      .not('zapsign_doc_token', 'is', null)
      .lt('signed_at', seisHorasAtras)
      .limit(10);                       // teto por rodada: nao estourar o tempo da function

    for (const c of semDrive || []) {
      if (!temTempo()) { out.interrompido = true; break; }
      const link = c.dados?.linkGoogleDrive;
      if (!link) continue;                                   // sem pasta definida: nada a fazer
      if ((c.drive_attempts || 0) >= 3) continue;            // ja esgotou as tentativas do fluxo normal
      out.drive.candidatos++;

      // MESMO claim atomico do App.jsx — se o navegador de alguem estiver fazendo agora,
      // ele ganha e o cron pula (nunca dois uploads do mesmo contrato).
      const { data: claim } = await supa.from('contratos')
        .update({
          drive_file_id: 'uploading',
          drive_last_attempt_at: new Date().toISOString(),
          drive_attempts: (c.drive_attempts || 0) + 1,
        })
        .eq('id', c.id).is('drive_file_id', null).select('id');
      if (!claim?.length) continue;

      try {
        // O save-to-drive exige a URL do PDF assinado (quem chama do navegador ja a tem,
        // porque consultou o ZapSign antes). Aqui buscamos direto na API do ZapSign.
        const zr = await fetch(`https://api.zapsign.com.br/api/v1/docs/${c.zapsign_doc_token}/`, {
          headers: { Authorization: `Bearer ${ZAPSIGN_TOKEN}` },
          signal: AbortSignal.timeout(20000),
        });
        if (!zr.ok) throw new Error(`ZapSign HTTP ${zr.status}`);
        const doc = await zr.json();
        const signedFileUrl = doc.signed_file || doc.original_file;
        if (!signedFileUrl) throw new Error('documento ainda sem arquivo assinado no ZapSign');

        const r = await fetch(`${SELF_URL}/.netlify/functions/save-to-drive`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // sem procDocxBase64/contratoDocxBase64: o servidor nao gera DOCX
          body: JSON.stringify({ signedFileUrl, driveFolderUrl: link, pageSplit: c.pdf_page_split }),
          signal: AbortSignal.timeout(60000),
        });
        const res = await r.json().catch(() => ({}));
        if (!r.ok || !res.success) throw new Error(res.error || `HTTP ${r.status}`);
        await supa.from('contratos').update({
          drive_file_id: res.files?.[0]?.fileId || 'saved',
          drive_file_link: res.files?.[0]?.fileUrl || '',
          drive_last_error: null,
        }).eq('id', c.id);
        await supa.from('automation_log').insert({
          contract_id: c.id, action: 'drive', status: 'ok',
          details: { files: res.files?.length, backstop: true, docx: false },
          client_name: c.dados?.contratantes?.[0]?.nome,
        }).catch(() => {});
        out.drive.ok++;
      } catch (e) {
        // devolve para NULL (e nao 'failed'): o fluxo do navegador, que gera os DOCX,
        // continua podendo assumir na proxima vez que alguem abrir o app.
        await supa.from('contratos').update({
          drive_file_id: null, drive_last_error: String(e.message || e).slice(0, 300),
        }).eq('id', c.id);
        out.drive.erro++;
      }
    }
  } catch { /* backstop nunca derruba a parte ADVBOX acima */ }

  // ─── BACKSTOP DO LINK DE ASSINATURA (auditoria 01/08 — item 126) ─────────
  // O disparo do link por WhatsApp era "atira e esquece" DO NAVEGADOR: o App chamava a
  // function e seguia em frente. Se a aba fechasse, a rede caísse ou a máquina dormisse
  // naquele instante, a chamada nunca chegava — `kommo_assinatura` ficava NULO, o cliente
  // não recebia o link E a nota de aviso ("enviar manualmente") também não era postada.
  // Ninguém ficava sabendo: para o operador, o contrato tinha sido enviado normalmente.
  //
  // 15 minutos de espera: tempo de sobra para o caminho normal do navegador concluir,
  // sem atrasar o cliente (a janela de 24h da Meta é o que realmente corre contra).
  // A function chamada tem trava própria (só dispara uma vez por contrato), então
  // navegador e cron nunca mandam duas mensagens.
  out.assinatura = { candidatos: 0, ok: 0, erro: 0 };
  try {
    const quinzeMin = new Date(Date.now() - 15 * 60000).toISOString();
    const { data: semDisparo } = await supa
      .from('contratos')
      .select('id, nome_contratante1, zapsign_sent_at')
      .eq('status', 'enviado_zapsign')
      .is('kommo_assinatura', null)
      .is('arquivado_em', null)
      .not('zapsign_sent_at', 'is', null)
      .lt('zapsign_sent_at', quinzeMin)
      // só o que foi enviado nas últimas 48h: contrato antigo parado não deve receber
      // agora uma mensagem de "seu link chegou", que soaria fora de contexto.
      .gt('zapsign_sent_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
      .limit(10);

    for (const c of semDisparo || []) {
      if (!temTempo()) { out.interrompido = true; break; }
      out.assinatura.candidatos++;
      try {
        const r = await fetch(`${SELF_URL}/.netlify/functions/kommo-assinatura-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-key': process.env.BOT_PANEL_KEY || '' },
          body: JSON.stringify({ contratoId: c.id }),
          signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        out.assinatura.ok++;
      } catch (e) {
        out.assinatura.erro++;
        await logAdvbox('kommo', 'aviso',
          `Backstop do link de assinatura falhou para "${c.nome_contratante1 || c.id}": ${String(e.message || e).slice(0, 120)}`,
          { contrato_id: c.id });
      }
    }
  } catch { /* backstop nunca derruba as partes acima */ }

  await heartbeat('advbox-sweep-cron', out.erro === 0 && out.drive.erro === 0,
    `advbox ${out.ok}/${out.candidatos} · drive ${out.drive.ok}/${out.drive.candidatos} · assinatura ${out.assinatura.ok}/${out.assinatura.candidatos}${out.interrompido ? ' · INTERROMPIDO por tempo (segue na proxima rodada)' : ''}`);
  console.log('[advbox-sweep-cron]', JSON.stringify(out));
  return jres({ ok: true, ...out });
};

// A cada 20 min, TODOS os dias — nao depende de ninguem com o app aberto.
export const config = { schedule: '*/20 * * * *' };
