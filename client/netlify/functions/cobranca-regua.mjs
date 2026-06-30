/**
 * Netlify Scheduled Function: cobranca-regua (#21 + #23)
 * Roda em dia útil às 10h30 BRT:
 *
 *  1. Grava o retrato diário da inadimplência (inadimplencia_historico) —
 *     alimenta os cards de tendência da aba Boletos.
 *  2. Régua de cobrança D+1 / D+7 / D+15: boletos PF que VENCERAM há
 *     exatamente 1, 7 ou 15 dias geram lembrete. Uma vez por boleto/etapa
 *     (tabela cobranca_regua). Ações:
 *       - nota no lead Kommo do cliente (regua.notas, padrão LIGADO — interno)
 *       - WhatsApp via Salesbot (regua.ativo, padrão DESLIGADO — fase de teste)
 *
 * Config em bot_config key 'regua': { ativo, notas, etapas:[1,7,15] }.
 */
import { db, getConfig, logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { postNote, setLeadField, runSalesbot } from './_lib/kommo.mjs';

const digits = (s) => String(s || '').replace(/\D/g, '');
const dataBR = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// (20/06/2026) Kill-switch da RÉGUA DE COBRANÇA (lembretes D+1/7/15 — notas Kommo +
// WhatsApp). DESLIGADA a pedido. O snapshot diário de inadimplência (que alimenta a
// tendência da aba Boletos) e a correlação de contatos Kommo seguem rodando.
// Reativar = voltar para true e redeploy.
const REGUA_COBRANCA_ATIVA = false;

async function snapshotInadimplencia() {
  const { error } = await db.rpc('inadimplencia_snapshot');
  if (error) throw new Error(`inadimplencia_snapshot: ${error.message}`);
}

export default async () => {
  const stats = { snapshot: false, etapas: {}, notas: 0, whatsapp: 0, sem_lead: 0, erros: 0 };
  const cfgAll = await getConfig().catch(() => ({}));
  const regua = cfgAll.regua || {};
  const kommoCfg = cfgAll.kommo || {};
  const etapas = Array.isArray(regua.etapas) && regua.etapas.length ? regua.etapas : [1, 7, 15];

  // 1) retrato diario da inadimplencia
  try { await snapshotInadimplencia(); stats.snapshot = true; }
  catch (e) { stats.erros++; await logAdvbox('asaas', 'erro', `snapshot inadimplência: ${e.message}`, {}); }

  // 1b) contatos recebidos no Kommo ONTEM (correlação acessos × ligações) — melhor esforço
  try {
    if (process.env.KOMMO_TOKEN) {
      const ontem = new Date(Date.now() - 86400000);
      const ini = Math.floor(new Date(ontem.toISOString().slice(0, 10) + 'T00:00:00-03:00').getTime() / 1000);
      const fim = ini + 86400;
      let total = 0, page = 1;
      while (page <= 4) {
        const r = await fetch(`https://advocaciacbc.kommo.com/api/v4/events?filter[type]=incoming_chat_message&filter[created_at][from]=${ini}&filter[created_at][to]=${fim}&limit=250&page=${page}`,
          { headers: { 'Authorization': `Bearer ${process.env.KOMMO_TOKEN}` } });
        if (r.status === 204) break;
        if (!r.ok) throw new Error(`Kommo events HTTP ${r.status}`);
        const j = await r.json();
        const n = (j?._embedded?.events || []).length;
        total += n;
        if (n < 250) break;
        page++;
      }
      await db.from('contatos_kommo_diario').upsert({ dia: ontem.toISOString().slice(0, 10), mensagens: total });
      stats.contatos_kommo = total;
    }
  } catch (e) { await logAdvbox('portal', 'aviso', `contatos Kommo (correlação) indisponíveis: ${e.message}`, {}); }

  // 2) regua D+1/7/15 (uma etapa = boletos que venceram ha exatamente N dias)
  try {
    if (REGUA_COBRANCA_ATIVA) for (const dias of etapas) {
      const alvo = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
      const { data: bols, error } = await db.rpc('regua_boletos_do_dia', { p_chave: process.env.BOT_RPC_SECRET || '', p_venc: alvo });
      if (error) throw new Error(error.message);
      const lista = bols || [];
      stats.etapas[`d${dias}`] = lista.length;
      if (!lista.length) continue;

      // mapa CPF -> lead Kommo (via contratos.dados->contratantes.linkKommo)
      const { data: cts } = await db.from('contratos')
        .select('cpf_contratante1, cpf_contratante2, contratantes:dados->contratantes')
        .is('arquivado_em', null).not('dados', 'is', null);
      const leadPorCpf = {};
      for (const ct of cts || []) {
        const link = (ct.contratantes || []).map(c => c?.linkKommo).find(Boolean);
        const m = String(link || '').match(/\/leads\/detail\/(\d+)/);
        if (!m) continue;
        for (const c of [ct.cpf_contratante1, ct.cpf_contratante2]) {
          const d = digits(c);
          if (d.length === 11) leadPorCpf[d] = Number(m[1]);
        }
      }

      for (const b of lista) {
        const cpf = digits(b.customer_cpf);
        if (cpf.length !== 11) continue; // só pessoa física
        // já processado?
        const { data: feito } = await db.from('cobranca_regua').select('boleto_id')
          .eq('boleto_id', b.id).eq('etapa', dias).maybeSingle();
        if (feito) continue;

        const leadId = leadPorCpf[cpf] || null;
        let acao = 'sem_lead';
        // (R14) o bank_slip_url (codigo de barras) expira no vencimento; a partir
        // de D+1 ele ja nao serve. invoice_url e a pagina Asaas que sempre tem PIX
        // atualizado + 2a via do boleto; pix_copy_paste e o codigo PIX direto.
        const linkPag = b.invoice_url || b.bank_slip_url || '';
        const msg = `💰 Régua de cobrança D+${dias} — ${b.customer_name}\n` +
          `Parcela de ${BRL(b.value)} vencida em ${dataBR(b.due_date)}.\n` +
          (linkPag ? `Pagamento (PIX / 2ª via): ${linkPag}\n` : '') +
          (b.pix_copy_paste ? `PIX copia-e-cola: ${b.pix_copy_paste}\n` : '') +
          `— gerado automaticamente pela régua de cobrança.`;

        if (leadId && regua.notas !== false) {
          try { await postNote(leadId, `CBC.regua:${b.id}:${dias}`, msg); acao = 'nota'; stats.notas++; }
          catch { stats.erros++; }
        }
        if (leadId && regua.ativo === true && kommoCfg.ativo && kommoCfg.bot_id && kommoCfg.field_id_lead) {
          try {
            const texto = `Olá! Passando para lembrar da parcela de ${BRL(b.value)} que venceu em ${dataBR(b.due_date)}. ` +
              (linkPag ? `Você pode pagar por PIX ou gerar a 2ª via atualizada do boleto aqui: ${linkPag}` : '') +
              (b.pix_copy_paste ? `\n\nSe preferir, o PIX copia-e-cola:\n${b.pix_copy_paste}` : '') +
              `\n\nQualquer dúvida ou para conversar sobre o pagamento, é só responder esta mensagem. 😊`;
            await setLeadField(leadId, kommoCfg.field_id_lead, texto);
            await runSalesbot(kommoCfg.bot_id, leadId);
            acao = 'whatsapp'; stats.whatsapp++;
          } catch { stats.erros++; }
        }
        if (!leadId) stats.sem_lead++;

        await db.from('cobranca_regua').insert({
          boleto_id: b.id, etapa: dias, customer_cpf: b.customer_cpf,
          customer_name: b.customer_name, valor: b.value, lead_id: leadId, acao,
        });
      }
    }
  } catch (e) { stats.erros++; await logAdvbox('asaas', 'erro', `régua de cobrança: ${e.message}`, stats); }

  await logAdvbox('asaas', stats.erros ? 'aviso' : 'info',
    REGUA_COBRANCA_ATIVA
      ? `Régua de cobrança: ${Object.entries(stats.etapas).map(([k, v]) => `${k}=${v}`).join(' ') || 'nada a cobrar'} — ${stats.notas} notas, ${stats.whatsapp} WhatsApp, ${stats.sem_lead} sem lead${regua.ativo ? '' : ' (envio WhatsApp DESLIGADO)'}`
      : 'Régua de cobrança DESLIGADA (kill-switch) — apenas snapshot de inadimplência',
    stats);
  await heartbeat('cobranca-regua', !stats.erros, `${stats.notas} notas, ${stats.erros} erros`); // (observ-2)
  console.log('[cobranca-regua]', JSON.stringify(stats));
  return new Response('ok');
};

export const config = { schedule: '30 13 * * 1-5' };
