/**
 * WORKER do dossie da videochamada. Chamado pelo agenda-videochamadas-sync ao fim
 * de cada rodada (aos :00 e :45 de cada hora) e tambem por HTTP com x-bot-key.
 *
 * NAO tem `schedule` de proposito: a Netlify responde 403 a qualquer chamada HTTP
 * externa feita a uma function AGENDADA (bloqueio na borda, antes do codigo rodar).
 * Sem isto nao daria para disparar a mao no dia do teste. Mesmo padrao de
 * backup-diario -> backup-worker-background e zapsign-lembrete-cron -> worker.
 *
 * ⚠️ NADA e enviado enquanto bot_config.dossie_videochamada tiver ativo=false ou
 * corte_em nulo. Sao duas travas independentes, e existem porque a tabela tem 3.043
 * linhas antigas cuja videochamada aconteceu semanas atras: sem elas, o primeiro
 * deploy viraria um disparo em massa para gente que ja foi atendida.
 */
import { db, logAdvbox, heartbeat, getConfig } from './_lib/botDb.mjs';
import { primeiroNome } from './_lib/dossieNome.mjs';
import { elegivel, quandoPorExtenso } from './_lib/dossieVideochamada.mjs';
import { montarEmail } from './_lib/dossieTexto.mjs';
import { montarDossie, ativosDisponiveis } from './_lib/dossiePdf.mjs';
import { enviarPeloGmail } from './_lib/gmailEnviar.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const DE = 'Conforto, Bergonsi & Cavalari Advogados <institucional@advocaciacbc.com>';
const ANEXO = 'CBC-Advogados-Apresentacao.pdf';
const TETO_POR_RODADA = 25;   // 8 videochamadas por dia util: folga de 3x

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

export default async (req) => {
  // duas portas: o sync interno (que conhece o BOT_RPC_SECRET) e o disparo manual
  // do painel (BOT_PANEL_KEY). Comparacao direta basta: nenhuma das duas e
  // adivinhavel e o endpoint nao expoe dado, so age.
  const chavePainel = process.env.BOT_PANEL_KEY || '';
  const interna = !!RPC_SECRET && req.headers.get('x-cbc-interno') === RPC_SECRET;
  const doPainel = !!chavePainel && req.headers.get('x-bot-key') === chavePainel;
  if (!interna && !doPainel) return json(401, { ok: false, error: 'nao autorizado' });

  const resumo = { enviados: 0, pulados: 0, falhas: 0, detalhe: [] };
  try {
    // Conferido ANTES de qualquer coisa, e a cada rodada: o empacotador da Netlify
    // ignora arquivo que nao seja importado por JS, e sem o `included_files` do
    // netlify.toml os PDF e as fontes simplesmente nao sobem. Como os ativos so
    // sao lidos ao montar um dossie, um sistema desligado nunca revelaria a falta,
    // e a descoberta viria no dia da virada de chave, com cliente esperando.
    const ativos = ativosDisponiveis();
    if (!ativos.ok) {
      const msg = `ativos do dossie ausentes no servidor: ${ativos.faltando.join(', ')}`;
      await logAdvbox('dossie', 'erro', msg, ativos).catch(() => {});
      await heartbeat('videochamada-dossie', false, msg);
      return json(500, { ok: false, error: msg, ativos });
    }

    const cfg = (await getConfig())?.dossie_videochamada || {};
    const modoTeste = cfg.modo_teste !== false;          // padrao: teste
    const emailTeste = cfg.email_teste || 'paulo@advocaciacbc.com';

    const { data: linhas, error } = await db.rpc('dossie_pendentes', {
      p_chave: RPC_SECRET, p_limite: TETO_POR_RODADA,
    });
    if (error) throw new Error(`dossie_pendentes: ${error.message}`);

    const agora = new Date();
    for (const linha of linhas || []) {
      const veredito = elegivel(linha, cfg, agora);
      if (!veredito.ok) {
        resumo.pulados += 1;
        resumo.detalhe.push({ event_id: linha.event_id, pulado: veredito.motivo });
        continue;
      }

      const nome = primeiroNome(linha.titulo, linha.nome_kommo);
      const quando = quandoPorExtenso(linha.scheduled_at);
      const { assunto, html, texto, responderPara } = montarEmail({
        nome, quando, vendedoraEmail: linha.vendedora_email, config: cfg,
      });

      let resultado;
      try {
        const pdf = await montarDossie({ nome, quandoTexto: quando.texto });
        resultado = await enviarPeloGmail({
          de: DE,
          para: modoTeste ? emailTeste : linha.cliente_email,
          responderPara: cfg.responder_para === 'institucional' ? null : responderPara,
          assunto, html, texto,
          anexo: { nome: ANEXO, bytes: pdf },
        });
      } catch (e) {
        // montagem do PDF nunca deve derrubar a rodada inteira: uma linha ruim
        // faria as outras 24 ficarem sem dossie
        resultado = { ok: false, erro: `montagem: ${String(e?.message || e).slice(0, 180)}` };
      }

      // marca SEMPRE, com sucesso ou com erro: e o que impede a linha de ser
      // tentada para sempre e o que faz o teto de tentativas valer
      const { error: erroMarca } = await db.rpc('dossie_marcar', {
        p_chave: RPC_SECRET, p_event_id: linha.event_id,
        p_erro: resultado.ok ? null : resultado.erro,
      });
      if (erroMarca) {
        // se a marcacao falha o e-mail JA saiu, entao isto precisa gritar: a
        // proxima rodada mandaria de novo para a mesma pessoa
        await logAdvbox('dossie', 'erro',
          `dossie enviado mas NAO marcado (${linha.event_id}): ${erroMarca.message}`.slice(0, 300),
          { event_id: linha.event_id, risco: 'reenvio' }).catch(() => {});
      }

      if (resultado.ok) {
        resumo.enviados += 1;
        resumo.detalhe.push({ event_id: linha.event_id, enviado: true, teste: modoTeste });
      } else {
        resumo.falhas += 1;
        resumo.detalhe.push({ event_id: linha.event_id, erro: resultado.erro });
        await logAdvbox('dossie', 'erro',
          `dossie falhou p/ ${linha.event_id}: ${resultado.erro}`.slice(0, 300),
          { event_id: linha.event_id }).catch(() => {});
      }
    }

    const msg = `dossie: ${resumo.enviados} enviados, ${resumo.pulados} pulados, `
              + `${resumo.falhas} falhas${modoTeste ? ' (MODO TESTE)' : ''} | ativos ok`;
    if (resumo.enviados || resumo.falhas) {
      await logAdvbox('dossie', resumo.falhas ? 'aviso' : 'info', msg, resumo).catch(() => {});
    }
    await heartbeat('videochamada-dossie', true, msg);
    return json(200, { ok: true, modo_teste: modoTeste, ativos: ativos.bytes, ...resumo });
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300);
    await logAdvbox('dossie', 'erro', `worker do dossie falhou: ${msg}`, {}).catch(() => {});
    await heartbeat('videochamada-dossie', false, msg);
    return json(500, { ok: false, error: msg });
  }
};
