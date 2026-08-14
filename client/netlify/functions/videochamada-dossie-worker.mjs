/**
 * WORKER do e-mail da videochamada. Chamado pelo agenda-videochamadas-sync ao fim
 * de cada rodada (de 15 em 15 min) e tambem por HTTP com x-bot-key.
 *
 * Faz TRES coisas, na mesma rodada, porque as tres dependem da mesma config, do
 * mesmo Gmail e do mesmo ritmo:
 *   1. DOSSIE     ao detectar o agendamento, com o PDF personalizado;
 *   2. AVISO      quando o e-mail do convite parece digitado errado, por nota no
 *                 Kommo (se houver lead) ou pelo sino do app para a vendedora;
 *   3. LEMBRETE   3 horas antes da chamada, sem anexo, com o link do Meet.
 *
 * NAO tem `schedule` de proposito: a Netlify responde 403 a qualquer chamada HTTP
 * externa feita a uma function AGENDADA, e o disparo manual e necessario em teste.
 *
 * ⚠️ NADA sai enquanto bot_config.dossie_videochamada tiver ativo=false ou
 * corte_em nulo. Sao duas travas independentes.
 */
import { db, logAdvbox, heartbeat, getConfig } from './_lib/botDb.mjs';
import { primeiroNome } from './_lib/dossieNome.mjs';
import { elegivel, quandoPorExtenso, horarioCivilizado } from './_lib/dossieVideochamada.mjs';
import { montarEmail } from './_lib/dossieTexto.mjs';
import { montarLembrete } from './_lib/dossieLembrete.mjs';
import { montarRecuperacao } from './_lib/dossieRecuperacao.mjs';
import { montarDossie, ativosDisponiveis } from './_lib/dossiePdf.mjs';
import { closerDaAgenda } from './_lib/dossieClosers.mjs';
import { enviarPeloGmail } from './_lib/gmailEnviar.mjs';
import { avaliarEmail, textoDoAviso } from './_lib/emailSuspeito.mjs';
import { linkConfirmacao } from './_lib/confirmacaoToken.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const DE = 'Conforto, Bergonsi & Cavalari Advogados <institucional@advocaciacbc.com>';
const ANEXO = 'CBC-Advogados-Apresentacao.pdf';
const TETO_POR_RODADA = 25;
const HORAS_LEMBRETE_PADRAO = 3;   // decisao do Paulo: 3h da tempo de remarcar; 1h nao

// ⚠️ Medido em producao: cada dossie leva ~3,5s (montar 4 MB + subir ao Gmail), e
// 17 seguidos levaram 55s, alem do tempo de uma function sincrona. A guarda para
// e deixa o resto para a rodada seguinte, 15 min depois.
const LIMITE_MS = 20000;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

/** Avisa a equipe do e-mail suspeito: nota no Kommo se houver lead, senao o sino. */
async function avisarEmailSuspeito(linha, avaliacao, quandoTexto) {
  const texto = textoDoAviso({ email: linha.cliente_email, avaliacao, quandoTexto });
  let canal = null;

  if (linha.lead_id) {
    try {
      const r = await fetch(`${process.env.URL}/.netlify/functions/kommo-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: String(linha.lead_id),
          marker: `CBC.email.suspeito:${linha.event_id}`,
          text: texto,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) canal = 'kommo';
    } catch { /* cai no sino */ }
  }

  // Sem lead (ou com o Kommo fora), o aviso vai pelo sino do app para a vendedora
  // dona da agenda: e ela quem corrige o convidado no evento.
  if (!canal) {
    const { error } = await db.from('notifications').insert({
      user_email: linha.vendedora_email,
      type: 'error',
      title: '⚠️ E-mail do convite parece digitado errado',
      body: texto,
      metadata: { origem: 'dossie', event_id: linha.event_id, email: linha.cliente_email },
    });
    if (!error) canal = 'sino';
  }
  return canal;
}

/**
 * Modo AMOSTRA: manda um exemplar de um dos textos para quem pedir, com dados de
 * exemplo. Existe porque revisar copy olhando codigo nao funciona, e esperar um
 * atendimento real para ver como o e-mail chega e lento demais.
 *
 * POST { amostra: 'dossie' | 'lembrete' | 'recuperacao', para: 'alguem@...',
 *        agenda?: 'beatriz@advocaciacbc.com' }
 * `agenda` escolhe de qual closer sai o PDF e o nome no texto; sem ela vale a Ana.
 * Exige x-bot-key. So envia para endereco @advocaciacbc.com: amostra e coisa
 * interna, e um erro de digitacao aqui mandaria texto de teste para um cliente.
 */
async function enviarAmostra({ amostra, para, agenda, cfg }) {
  const destino = String(para || '').trim().toLowerCase();
  if (!/@advocaciacbc\.com$/.test(destino)) {
    return { ok: false, erro: 'amostra so vai para endereco do escritorio' };
  }

  const nome = 'Sueli';
  const quando = quandoPorExtenso(new Date(Date.now() + 3 * 3600e3).toISOString());
  const ontem = quandoPorExtenso(new Date(Date.now() - 20 * 3600e3).toISOString());
  const vendedora = String(agenda || 'anacristina@advocaciacbc.com').trim().toLowerCase();
  const closer = closerDaAgenda(vendedora);

  if (amostra === 'lembrete') {
    // com os MESMOS botoes assinados que vao no e-mail real; o id 'AMOSTRA-' faz o
    // endpoint publico mostrar a tela de verdade sem gravar nada
    const base = process.env.URL || 'https://contratos-cbc.netlify.app';
    const idAmostra = 'AMOSTRA-lembrete';
    const m = montarLembrete({
      nome, quando, meetLink: 'https://meet.google.com/exemplo-teste-abc', closer, config: cfg,
      urlSim: linkConfirmacao(base, idAmostra, 'sim', RPC_SECRET),
      urlRemarcar: linkConfirmacao(base, idAmostra, 'remarcar', RPC_SECRET),
    });
    return enviarPeloGmail({
      de: DE, para: destino, responderPara: vendedora,
      assunto: `[AMOSTRA] ${m.assunto}`, html: m.html, texto: m.texto,
    });
  }

  if (amostra === 'recuperacao') {
    const m = montarRecuperacao({ nome, quandoFaltou: ontem, config: cfg });
    return enviarPeloGmail({
      de: DE, para: destino, responderPara: vendedora,
      assunto: `[AMOSTRA] ${m.assunto}`, html: m.html, texto: m.texto,
    });
  }

  if (amostra === 'dossie') {
    const m = montarEmail({ nome, quando, vendedoraEmail: vendedora, closer, config: cfg });
    const pdf = await montarDossie({
      nome, quandoTexto: quando.texto, closerSlug: closer?.slug || null,
    });
    return enviarPeloGmail({
      de: DE, para: destino, responderPara: vendedora,
      assunto: `[AMOSTRA${closer ? ` ${closer.nome.split(/\s+/)[0]}` : ''}] ${m.assunto}`,
      html: m.html, texto: m.texto,
      anexo: { nome: ANEXO, bytes: pdf },
    });
  }

  return { ok: false, erro: `amostra desconhecida: ${amostra}` };
}

export default async (req) => {
  const chavePainel = process.env.BOT_PANEL_KEY || '';
  const interna = !!RPC_SECRET && req.headers.get('x-cbc-interno') === RPC_SECRET;
  const doPainel = !!chavePainel && req.headers.get('x-bot-key') === chavePainel;
  if (!interna && !doPainel) return json(401, { ok: false, error: 'nao autorizado' });

  // amostra: caminho curto, nao mexe em fila nem marca nada no banco
  let corpo = {};
  try { corpo = await req.json(); } catch { /* rodada normal nao manda corpo */ }
  if (corpo?.amostra) {
    if (!doPainel) return json(403, { ok: false, error: 'amostra exige x-bot-key' });
    const cfg = (await getConfig())?.dossie_videochamada || {};
    const r = await enviarAmostra({
      amostra: corpo.amostra, para: corpo.para, agenda: corpo.agenda, cfg,
    });
    return json(r.ok ? 200 : 400, {
      ok: r.ok, amostra: corpo.amostra, para: corpo.para, agenda: corpo.agenda, erro: r.erro,
    });
  }

  const resumo = {
    enviados: 0, pulados: 0, falhas: 0,
    avisos_email: 0, lembretes: 0, lembretes_falha: 0,
    recuperacoes: 0, recuperacoes_falha: 0, detalhe: [],
  };

  try {
    // Conferido a cada rodada: o empacotador da Netlify ignora arquivo que nao
    // seja importado por JS, e sem os ativos o envio quebra so na hora do envio.
    const ativos = ativosDisponiveis();
    if (!ativos.ok) {
      const msg = `ativos do PDF de apresentacao ausentes no servidor: ${ativos.faltando.join(', ')}`;
      await logAdvbox('dossie', 'erro', msg, ativos).catch(() => {});
      await heartbeat('videochamada-dossie', false, msg);
      return json(500, { ok: false, error: msg, ativos });
    }

    const cfg = (await getConfig())?.dossie_videochamada || {};
    const modoTeste = cfg.modo_teste !== false;
    const emailTeste = cfg.email_teste || 'paulo@advocaciacbc.com';
    const horasLembrete = Number(cfg.lembrete_horas || HORAS_LEMBRETE_PADRAO);
    const paraQuem = (real) => (modoTeste ? emailTeste : real);

    const agora = new Date();
    const comecou = Date.now();
    const acabouOTempo = () => Date.now() - comecou > LIMITE_MS;

    // ── 1. DOSSIE (e o aviso de e-mail errado, que mora no mesmo laco) ──────
    const { data: pendentes, error } = await db.rpc('dossie_pendentes', {
      p_chave: RPC_SECRET, p_limite: TETO_POR_RODADA,
    });
    if (error) throw new Error(`dossie_pendentes: ${error.message}`);

    for (const linha of pendentes || []) {
      if (acabouOTempo()) { resumo.parou_por_tempo = true; break; }

      const veredito = elegivel(linha, cfg, agora);
      if (!veredito.ok) {
        resumo.pulados += 1;
        resumo.detalhe.push({ event_id: linha.event_id, pulado: veredito.motivo });
        continue;
      }

      // O e-mail vem digitado a mao no convite. Endereco errado nao e so o nosso
      // dossie indo para o vazio: o convite do Google tambem nao chega, e a
      // pessoa fica sem o link do Meet. Entao AVISA e nao envia.
      const avaliacao = avaliarEmail(linha.cliente_email);
      if (!avaliacao.ok) {
        const quando = quandoPorExtenso(linha.scheduled_at);
        if (!linha.email_aviso_em) {
          const canal = await avisarEmailSuspeito(linha, avaliacao, quando.texto);
          if (canal) {
            await db.rpc('email_aviso_marcar', { p_chave: RPC_SECRET, p_event_id: linha.event_id });
            resumo.avisos_email += 1;
            resumo.detalhe.push({ event_id: linha.event_id, aviso: avaliacao.motivo, canal });
          }
        }
        resumo.pulados += 1;
        resumo.detalhe.push({ event_id: linha.event_id, pulado: `email_${avaliacao.motivo}` });
        continue;
      }

      const nome = primeiroNome(linha.titulo, linha.nome_kommo);
      const quando = quandoPorExtenso(linha.scheduled_at);
      // quem atende sai da AGENDA em que o evento nasceu, nao do titulo
      const closer = closerDaAgenda(linha.vendedora_email);
      const { assunto, html, texto, responderPara } = montarEmail({
        nome, quando, vendedoraEmail: linha.vendedora_email, closer, config: cfg,
      });

      let resultado;
      try {
        const pdf = await montarDossie({
          nome, quandoTexto: quando.texto, closerSlug: closer?.slug || null,
        });
        resultado = await enviarPeloGmail({
          de: DE,
          para: paraQuem(linha.cliente_email),
          responderPara: cfg.responder_para === 'institucional' ? null : responderPara,
          assunto, html, texto,
          anexo: { nome: ANEXO, bytes: pdf },
        });
      } catch (e) {
        resultado = { ok: false, erro: `montagem: ${String(e?.message || e).slice(0, 180)}` };
      }

      const { error: erroMarca } = await db.rpc('dossie_marcar', {
        p_chave: RPC_SECRET, p_event_id: linha.event_id,
        p_erro: resultado.ok ? null : resultado.erro,
      });
      if (erroMarca) {
        await logAdvbox('dossie', 'erro',
          `PDF de apresentacao enviado mas NAO marcado (${linha.event_id}): ${erroMarca.message}`.slice(0, 300),
          { event_id: linha.event_id, risco: 'reenvio' }).catch(() => {});
      }

      if (resultado.ok) {
        resumo.enviados += 1;
        // o closer vai no log: "generico" no painel e o sinal de que uma agenda
        // entrou sem estar no mapa, e ninguem saberia de outro jeito
        resumo.detalhe.push({
          event_id: linha.event_id, enviado: true, teste: modoTeste,
          closer: closer?.slug || 'generico',
        });
      } else {
        resumo.falhas += 1;
        resumo.detalhe.push({ event_id: linha.event_id, erro: resultado.erro });
        await logAdvbox('dossie', 'erro',
          `PDF de apresentacao falhou p/ ${linha.event_id}: ${resultado.erro}`.slice(0, 300),
          { event_id: linha.event_id }).catch(() => {});
      }
    }

    // ── 2. LEMBRETE de 3 horas antes ───────────────────────────────────────
    // Independe de o dossie ter saido: quem agendou com menos de 3h de
    // antecedencia recebe so o lembrete, e ainda assim vale.
    // A janela vale para lembrete e recuperacao, nao para o PDF de apresentacao:
    // aquele sai logo apos o agendamento, que so acontece em horario comercial.
    const civil = horarioCivilizado(agora, Number(cfg.hora_inicio ?? 7), Number(cfg.hora_fim ?? 20));
    if (!civil) resumo.fora_da_janela = true;

    if (civil && cfg.ativo && cfg.corte_em) {
      const { data: paraLembrar, error: erroLembrete } = await db.rpc('lembrete_pendentes', {
        p_chave: RPC_SECRET, p_horas: horasLembrete, p_limite: TETO_POR_RODADA,
      });
      if (erroLembrete) throw new Error(`lembrete_pendentes: ${erroLembrete.message}`);

      for (const linha of paraLembrar || []) {
        if (acabouOTempo()) { resumo.parou_por_tempo = true; break; }

        // mesmo corte do dossie: nao lembrar quem e anterior a virada de chave
        if (new Date(linha.primeiro_visto_em) < new Date(cfg.corte_em)) continue;
        if (!avaliarEmail(linha.cliente_email).ok) continue;

        const nome = primeiroNome(linha.titulo, linha.nome_kommo);
        const quando = quandoPorExtenso(linha.scheduled_at);
        // links assinados: sem a assinatura ninguem confirma presenca em nome de
        // outro cliente varrendo ids de agenda, que nao sao secretos
        const base = process.env.URL || 'https://contratos-cbc.netlify.app';
        const { assunto, html, texto } = montarLembrete({
          nome, quando, meetLink: linha.meet_link, config: cfg,
          closer: closerDaAgenda(linha.vendedora_email),
          urlSim: linkConfirmacao(base, linha.event_id, 'sim', RPC_SECRET),
          urlRemarcar: linkConfirmacao(base, linha.event_id, 'remarcar', RPC_SECRET),
        });

        const r = await enviarPeloGmail({
          de: DE,
          para: paraQuem(linha.cliente_email),
          responderPara: cfg.responder_para === 'institucional' ? null : linha.vendedora_email,
          assunto, html, texto,
        });

        await db.rpc('lembrete_marcar', {
          p_chave: RPC_SECRET, p_event_id: linha.event_id, p_erro: r.ok ? null : r.erro,
        });

        if (r.ok) {
          resumo.lembretes += 1;
          resumo.detalhe.push({ event_id: linha.event_id, lembrete: true, teste: modoTeste });
        } else {
          resumo.lembretes_falha += 1;
          await logAdvbox('dossie', 'erro',
            `lembrete falhou p/ ${linha.event_id}: ${r.erro}`.slice(0, 300),
            { event_id: linha.event_id }).catch(() => {});
        }
      }
    }

    // ── 3. RECUPERACAO de quem faltou ──────────────────────────────────────
    // O filtro mora na RPC recuperacao_pendentes, e cada linha dele saiu de um
    // caso real: a auditoria do Meet como fonte, a cor da agenda como VETO (7
    // casos onde as fontes discordam, 3 deles clientes que fecharam contrato) e
    // quem ja remarcou sozinho fora.
    if (civil && cfg.ativo && cfg.corte_em && cfg.recuperacao !== false) {
      const { data: faltosos, error: erroRec } = await db.rpc('recuperacao_pendentes', {
        p_chave: RPC_SECRET, p_limite: 25,
      });
      if (erroRec) throw new Error(`recuperacao_pendentes: ${erroRec.message}`);

      for (const linha of faltosos || []) {
        if (acabouOTempo()) { resumo.parou_por_tempo = true; break; }
        if (new Date(linha.primeiro_visto_em) < new Date(cfg.corte_em)) continue;
        if (!avaliarEmail(linha.cliente_email).ok) continue;

        const nome = primeiroNome(linha.titulo, linha.nome_kommo);
        const { assunto, html, texto } = montarRecuperacao({
          nome, quandoFaltou: quandoPorExtenso(linha.scheduled_at), config: cfg,
        });

        const r = await enviarPeloGmail({
          de: DE,
          para: paraQuem(linha.cliente_email),
          responderPara: cfg.responder_para === 'institucional' ? null : linha.vendedora_email,
          assunto, html, texto,
        });

        await db.rpc('recuperacao_marcar', {
          p_chave: RPC_SECRET, p_event_id: linha.event_id, p_erro: r.ok ? null : r.erro,
        });

        if (r.ok) {
          resumo.recuperacoes += 1;
          resumo.detalhe.push({ event_id: linha.event_id, recuperacao: true, teste: modoTeste });
        } else {
          resumo.recuperacoes_falha += 1;
          await logAdvbox('dossie', 'erro',
            `recuperacao falhou p/ ${linha.event_id}: ${r.erro}`.slice(0, 300),
            { event_id: linha.event_id }).catch(() => {});
        }
      }
    }

    const msg = `PDF de apresentacao: ${resumo.enviados} enviados, ${resumo.pulados} pulados, `
              + `${resumo.falhas} falhas | lembretes: ${resumo.lembretes}`
              + `${resumo.lembretes_falha ? ` (${resumo.lembretes_falha} falha)` : ''}`
              + `${resumo.recuperacoes ? ` | recuperacao: ${resumo.recuperacoes}` : ''}`
              + `${resumo.avisos_email ? ` | ${resumo.avisos_email} aviso(s) de e-mail errado` : ''}`
              + `${modoTeste ? ' (MODO TESTE)' : ''}`
              + `${resumo.parou_por_tempo ? ', parou no tempo' : ''}`
              + `${resumo.fora_da_janela ? ' | fora da janela de horario' : ''}`;
    if (resumo.enviados || resumo.falhas || resumo.lembretes || resumo.avisos_email
        || resumo.recuperacoes || resumo.recuperacoes_falha) {
      const nivel = (resumo.falhas || resumo.lembretes_falha || resumo.recuperacoes_falha)
        ? 'aviso' : 'info';
      await logAdvbox('dossie', nivel, msg, resumo).catch(() => {});
    }
    await heartbeat('videochamada-dossie', true, msg);
    return json(200, { ok: true, modo_teste: modoTeste, ativos: ativos.bytes, ...resumo });
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300);
    await logAdvbox('dossie', 'erro', `worker do PDF de apresentacao falhou: ${msg}`, {}).catch(() => {});
    await heartbeat('videochamada-dossie', false, msg);
    return json(500, { ok: false, error: msg });
  }
};
