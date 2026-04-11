// Utilidades para descobrir e preencher placeholders em blocos de modelo.
//
// Um placeholder no conteúdo do bloco é escrito como {{chave}}.
// O "model.placeholders" armazena a definição (label, tipo, fonte automática).

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function extractPlaceholderKeys(content = '') {
  const keys = new Set();
  let m;
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  while ((m = re.exec(content)) !== null) keys.add(m[1]);
  return [...keys];
}

/** HTML-escape básico para interpolação segura em HTML. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Substitui {{key}} em uma string de texto plano pelos valores dados. */
export function fillPlainText(text, values) {
  return String(text || '').replace(PLACEHOLDER_RE, (_, key) => {
    const v = values?.[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Substitui em HTML com escape de valor. */
export function fillHtml(html, values) {
  return String(html || '').replace(PLACEHOLDER_RE, (_, key) => {
    const v = values?.[key];
    return v === undefined || v === null ? '' : escapeHtml(v);
  });
}

/** Mapeamento: auto_source -> função que extrai valor do bundle de dados. */
export function resolveAutoSource(source, ctx) {
  const { advbox, datajud, resort } = ctx || {};
  const lawsuit = advbox?.lawsuit || {};
  const customer = advbox?.customer || {};
  switch (source) {
    case 'advbox_customer_name': return customer?.name || customer?.full_name || '';
    case 'advbox_customer_cpf': return customer?.cpf || '';
    case 'advbox_customer_cnpj': return customer?.cnpj || '';
    case 'advbox_process_number': return lawsuit?.process_number || lawsuit?.numero || '';
    case 'advbox_process_type': return lawsuit?.type || lawsuit?.tipo || '';
    case 'advbox_process_stage': return lawsuit?.stage || lawsuit?.fase || '';
    case 'advbox_responsible': return lawsuit?.responsible?.name || lawsuit?.responsavel || '';
    case 'advbox_folder': return lawsuit?.folder || lawsuit?.pasta || '';
    case 'datajud_classe': return lawsuit?.classe || datajud?.classe || '';
    case 'datajud_assunto': return lawsuit?.assunto || datajud?.assunto || '';
    case 'datajud_vara': return lawsuit?.vara || datajud?.vara || '';
    case 'datajud_comarca': return lawsuit?.comarca || datajud?.comarca || '';
    case 'datajud_juiz': return lawsuit?.juiz || datajud?.juiz || '';
    case 'datajud_data_distribuicao': return lawsuit?.data_distribuicao || datajud?.data_distribuicao || '';
    case 'resort_razao_social': return resort?.legal_name || '';
    case 'resort_cnpj': return resort?.cnpj || '';
    case 'resort_endereco': return resort?.address || '';
    case 'resort_grupo': return resort?.economic_group || '';
    case 'resort_empresas_grupo': {
      const rows = (resort?.companies || [])
        .map((c) => `${c.legal_name}${c.cnpj ? ` (CNPJ ${c.cnpj})` : ''}`);
      return rows.join('; ');
    }
    case 'resort_argumentos_defesa': {
      const arr = Array.isArray(resort?.typical_defense_arguments)
        ? resort.typical_defense_arguments : [];
      return arr.map((a) => `• ${a.argument || a}`).join('\n');
    }
    case 'resort_contra_argumentos': {
      const arr = Array.isArray(resort?.cbc_counter_arguments)
        ? resort.cbc_counter_arguments : [];
      return arr.map((a) => `• ${a.counter_argument || a}`).join('\n');
    }
    case 'manual':
    default:
      return '';
  }
}

/**
 * A partir de uma lista de placeholder definitions e do bundle de contexto,
 * devolve um objeto com valores iniciais pré-preenchidos.
 */
export function buildInitialValues(placeholderDefs = [], ctx = {}) {
  const out = {};
  for (const p of placeholderDefs) {
    let v = '';
    if (p.auto_source && p.auto_source !== 'manual') {
      v = resolveAutoSource(p.auto_source, ctx);
    }
    if (!v && p.default_value) v = p.default_value;
    out[p.key] = v;
  }
  return out;
}
