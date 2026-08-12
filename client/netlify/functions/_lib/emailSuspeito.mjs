/**
 * Decide se um e-mail de cliente tem cara de erro de digitação. Módulo PURO
 * (a checagem de DNS mora numa função separada, no fim).
 *
 * POR QUE ISTO EXISTE, e o que se descobriu medindo (12/08/2026): dos 476
 * atendimentos dos últimos 60 dias, quatro tinham domínio inexistente por
 * digitação — `gmai.com`, `gmailcom`, `hotmai.com`, `htomail.com`. **Dois dos
 * quatro faltaram à videochamada.**
 *
 * E o prejuízo é maior do que o nosso dossiê: o endereço vai no convite da
 * agenda, então com ele errado **o Google nunca entrega o convite**, e a pessoa
 * fica sem o link do Meet. Ela não faltou, não tinha como entrar.
 *
 * REGRA DE OURO: sugerir, NUNCA corrigir sozinho. Trocar o e-mail de um cliente
 * por conta própria é o tipo de ajuda que um dia acerta a pessoa errada.
 */

// Domínios digitados errado que já apareceram na base, e o que quiseram dizer.
const ERROS_CONHECIDOS = {
  'gmai.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmailcom': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'htomail.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmailcom': 'hotmail.com',
  'homail.com': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahoo.com.b': 'yahoo.com.br',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'hotmail.com.b': 'hotmail.com.br',
  'bol.com': 'bol.com.br',
  'uol.com': 'uol.com.br',
};

// Formato: um @, algo antes, e um domínio com ponto e extensão de 2+ letras.
// Deliberadamente mais frouxo que o RFC: o objetivo é pegar erro de digitação
// óbvio, não reprovar endereço exótico porém válido.
const FORMATO = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * @param {string|null} email
 * @returns {{ok: boolean, motivo: string|null, sugestao: string|null}}
 *   motivo é um código estável, para log e para o texto do aviso
 */
export function avaliarEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { ok: false, motivo: 'vazio', sugestao: null };
  if (!FORMATO.test(e)) return { ok: false, motivo: 'formato', sugestao: null };

  const dominio = e.split('@')[1];
  if (ERROS_CONHECIDOS[dominio]) {
    return {
      ok: false,
      motivo: 'dominio_com_erro_de_digitacao',
      sugestao: `${e.split('@')[0]}@${ERROS_CONHECIDOS[dominio]}`,
    };
  }
  // extensão de 1 letra não existe; costuma ser dedo escorregando (".c", ".b")
  const ext = dominio.split('.').pop();
  if (ext.length < 2) return { ok: false, motivo: 'extensao_curta', sugestao: null };

  return { ok: true, motivo: null, sugestao: null };
}

/** Texto do aviso, usado tanto na nota do Kommo quanto no sino do app. */
export function textoDoAviso({ email, avaliacao, quandoTexto }) {
  const causa = {
    vazio: 'está em branco',
    formato: 'não tem formato de e-mail válido',
    dominio_com_erro_de_digitacao: `tem o domínio "${String(email).split('@')[1]}", que não existe`,
    extensao_curta: 'termina com uma extensão que não existe',
    dominio_sem_servidor: `tem o domínio "${String(email).split('@')[1]}", que não recebe e-mail`,
  }[avaliacao.motivo] || 'parece incorreto';

  return [
    `⚠️ O e-mail do convite da videochamada de ${quandoTexto} ${causa}: ${email}`,
    avaliacao.sugestao ? `Provavelmente seria: ${avaliacao.sugestao}` : null,
    '',
    'Enquanto não for corrigido no evento da agenda, esta pessoa NÃO recebe o convite '
      + 'do Google, ou seja, fica sem o link do Meet, e também não recebe a apresentação '
      + 'do escritório.',
    'Corrija o convidado no evento e o sistema envia sozinho, em até 15 minutos.',
  ].filter((l) => l !== null).join('\n');
}

/**
 * O domínio tem servidor de e-mail? Faz consulta de DNS, então NÃO é puro.
 *
 * FALHA ABERTA de propósito: se o DNS não responder, devolve `true`. Bloquear um
 * envio legítimo por causa de uma consulta de DNS instável seria pior do que
 * deixar passar um endereço ruim, que a validação de formato já filtra na maior
 * parte dos casos.
 */
export async function dominioRecebeEmail(email, timeoutMs = 4000) {
  const dominio = String(email || '').split('@')[1];
  if (!dominio) return false;
  try {
    const { resolveMx } = await import('node:dns/promises');
    const registros = await Promise.race([
      resolveMx(dominio),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ]);
    if (registros === 'timeout') return true;
    return Array.isArray(registros) && registros.length > 0;
  } catch (e) {
    // ENOTFOUND / NXDOMAIN = o dominio nao existe mesmo; qualquer outra coisa
    // e problema nosso de rede, e ai nao se pune o cliente
    const codigo = e?.code || '';
    if (codigo === 'ENOTFOUND' || codigo === 'NXDOMAIN') return false;
    return true;
  }
}
