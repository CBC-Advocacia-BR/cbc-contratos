/**
 * Logica PURA do painel de Cobranca de Inadimplentes (testavel sem rede/DB).
 * Usada por cobranca-disparar.mjs e cobranca-listar.mjs.
 *
 * Um "devedor" aqui e uma linha da RPC cobranca_inadimplentes:
 *   { cpf, customer_name, total_em_aberto, parcelas, maior_atraso_dias,
 *     boleto_ancora_id, ancora_link, ancora_pix, ancora_due,
 *     lead_id, match_source, ultimo_disparo_em, ultimo_template, ultimo_resultado, ultimo_pago }
 */

export const digits = (s) => String(s || '').replace(/\D/g, '');
export const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// match_sources de ALTA CONFIANCA (envio automatico permitido). 'telefone_ambiguo' e
// 'sem_lead' NAO entram (risco de mandar pra pessoa errada / sem destino).
export const MATCH_OK = new Set(['clientes_cpf', 'contrato_link', 'telefone']);

/**
 * Decide se um devedor pode ser cobrado AGORA com este config.
 * Retorna { elegivel, motivo }. motivo: sem_lead | opt_out | cooldown | null.
 */
export function avaliarElegibilidade(dev, cfg = {}, hojeISO) {
  const optout = (cfg.optout_cpfs || []).map(digits);
  if (optout.includes(digits(dev.cpf))) return { elegivel: false, motivo: 'opt_out' };

  if (!dev.lead_id || !MATCH_OK.has(dev.match_source)) return { elegivel: false, motivo: 'sem_lead' };

  const cooldown = Number(cfg.cooldown_dias || 0);
  if (cooldown > 0 && dev.ultimo_disparo_em && !dev.ultimo_pago) {
    const ref = new Date(`${String(hojeISO).slice(0, 10)}T00:00:00Z`).getTime();
    const ult = new Date(dev.ultimo_disparo_em).getTime();
    const diasDesde = Math.floor((ref - ult) / 86400000);
    if (diasDesde >= 0 && diasDesde < cooldown) return { elegivel: false, motivo: 'cooldown' };
  }
  return { elegivel: true, motivo: null };
}

/**
 * Texto da cobranca que vai para o campo do lead (o Salesbot exibe esse campo).
 * Usa tpl.corpo com placeholders {{nome}} {{valor}} {{link}} {{pix}}; senao, padrao.
 */
export function renderMensagem(dev, tpl = {}, _hojeISO) {
  const nome = String(dev.customer_name || '').trim().split(/\s+/)[0] || '';
  const valor = BRL(dev.total_em_aberto);
  const link = dev.ancora_link || '';
  const pix = dev.ancora_pix || '';
  const base = tpl.corpo
    || 'Ola {{nome}}! Identificamos em aberto o valor de {{valor}} referente a honorarios. '
     + 'Para regularizar por PIX ou gerar a 2a via atualizada: {{link}}';
  return base
    .replace(/{{\s*nome\s*}}/g, nome)
    .replace(/{{\s*valor\s*}}/g, valor)
    .replace(/{{\s*link\s*}}/g, link)
    .replace(/{{\s*pix\s*}}/g, pix)
    .trim();
}

/** Chave idempotente do disparo (1 por devedor/template/dia). */
export function dedupeKey(cpf, templateName, hojeISO) {
  return `cobranca:${digits(cpf)}:${templateName}:${String(hojeISO).slice(0, 10).replace(/-/g, '')}`;
}

/** Resumo de contagem por motivo (para o preview/dryRun). */
export function resumirPreview(devedores, cfg, hojeISO) {
  const out = { enviar: 0, pulados: {} };
  for (const d of devedores) {
    const { elegivel, motivo } = avaliarElegibilidade(d, cfg, hojeISO);
    if (elegivel) out.enviar++;
    else out.pulados[motivo] = (out.pulados[motivo] || 0) + 1;
  }
  return out;
}
