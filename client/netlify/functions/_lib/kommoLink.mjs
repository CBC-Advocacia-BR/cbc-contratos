/**
 * Decisao PURA sobre o "Link Kommo" do formulario (sem rede, sem banco).
 * Usado pelo resolve-kommo-lead (modo apenasExistencia) e testado isoladamente.
 *
 * POR QUE ISTO EXISTE (02-03/08/2026): o linkKommo e digitado a mao (REGRA #4) e
 * CONGELA em contratos.dados->contratantes[].linkKommo. Ninguem conferia se o lead
 * existia. Resultado medido em 02/08: 37 leads mortos / 42 contratos (quase todos
 * assinados), com 271 notas de andamento e 57 cobrancas que nunca chegaram ao cliente.
 * Causa mais comum: a equipe mescla leads duplicados na UI do Kommo e o merge APAGA o
 * lead perdedor, mas o contrato segue apontando para o id que morreu.
 *
 * ⚠️ O PONTO DELICADO: `kGet` (_lib/kommo.mjs) LANCA excecao para qualquer HTTP nao-ok,
 * entao "lead nao existe" (404) chega com texto quase igual a "Kommo instavel" (429/500).
 * Confundir os dois quebra a feature nos dois sentidos: tratar 500 como ausencia BLOQUEIA
 * contrato legitimo toda vez que o Kommo oscila; tratar 404 como duvida deixa passar
 * exatamente o lead morto que se quer barrar. Por isso a separacao e explicita e testada.
 */

/** Unica conta Kommo que o nosso token alcanca. */
export const HOST_OFICIAL = 'advocaciacbc.kommo.com';

// Exige a URL completa da conversa. Id solto ("18219824") NAO vale de proposito: sem o
// host nao da para saber se e desta conta, e foi assim que um link de outra conta
// (brunoadvocaciacbccom) entrou num contrato sem ninguem perceber.
const RE_LINK = /^https?:\/\/([^/\s]+)\/leads\/detail\/(\d+)/i;

/**
 * @returns {{veredito:'checar'|'nao_existe'|'invalido', leadId?:string, host?:string, motivo?:string}}
 * 'checar' = formato ok e conta certa -> vale perguntar ao Kommo se existe.
 */
export function classificarLink(link) {
  const s = String(link ?? '').trim();
  if (!s) return { veredito: 'invalido', motivo: 'Link Kommo nao preenchido' };

  const m = s.match(RE_LINK);
  if (!m) {
    return { veredito: 'invalido', motivo: 'Cole a URL da conversa no Kommo (…/leads/detail/NUMERO)' };
  }

  const host = m[1].toLowerCase();
  const leadId = m[2];

  if (host !== HOST_OFICIAL) {
    // Existe na conta dele, mas e inalcancavel para nos: nenhuma nota, cobranca ou
    // movimentacao sai daqui para esse lead. Do ponto de vista do sistema, e um lead morto.
    return { veredito: 'nao_existe', host, leadId, motivo: `Esse link e de outra conta Kommo (${host}). O sistema so consegue enviar para ${HOST_OFICIAL}.` };
  }

  return { veredito: 'checar', host, leadId };
}

// \b nos dois lados: o id do lead pode conter 404 ("/leads/404 HTTP 500") e um status
// 4040 nao existe — sem as bordas, os dois viravam falso "nao existe".
const RE_404 = /\bHTTP\s+404\b/;

/**
 * Traduz a falha do GET ao Kommo em veredito.
 * @returns {{veredito:'nao_existe'|'desconhecido', motivo:string}}
 * 'desconhecido' e o lado SEGURO: nao bloqueia nada (decisao do Paulo em 03/08 —
 * instabilidade do Kommo nunca pode impedir uma assinatura).
 */
export function classificarFalha(erro) {
  const msg = (erro && typeof erro === 'object' && 'message' in erro) ? String(erro.message) : String(erro ?? '');
  if (RE_404.test(msg)) {
    return { veredito: 'nao_existe', motivo: 'Esse lead nao existe mais no Kommo (apagado ou mesclado com outro).' };
  }
  return { veredito: 'desconhecido', motivo: 'Nao foi possivel conferir agora (Kommo indisponivel).' };
}
