/**
 * Decisao PURA sobre erro TERMINAL da fila do Kommo (sem rede, sem banco).
 * Modulo separado p/ ser testavel — mesmo padrao de asaasEventos/comissaoCalculo.
 *
 * ERRO 226 (investigacao 02/08/2026): `POST /leads/{id}/notes` devolvendo
 * {"code":226,"message":"Error 226."} significa **o lead alvo nao existe** (apagado,
 * mesclado na UI do Kommo, ou id de outra conta). E o equivalente, no endpoint de
 * notas, do "Lead not found" que o `PATCH /leads/{id}` devolve. Nao esta documentado
 * em lugar nenhum publico.
 *
 * PROVA: POST de nota no lead 999999999 (id que nunca existiu) devolve exatamente o
 * mesmo 226, com texto ASCII puro e marcador inedito. Isso derruba as duas hipoteses
 * naturais: NAO e emoji de 4 bytes (isso e real, mas so afeta CAMPO personalizado —
 * ver kommoText.mjs) e NAO e duplicidade (a idempotencia por marcador esta correta).
 *
 * ARMADILHA: `GET /leads/{id}/notes` num lead morto nao devolve 404, devolve VAZIO.
 * Por isso a checagem de duplicidade do kommo-note passa sem lancar excecao e so o
 * POST estoura — quem le o codigo esperando o GET falhar primeiro se engana.
 *
 * Consequencia: lead que nao existe nunca volta a existir; retentar e desperdicio puro
 * (271 jobs x 6 tentativas = ~1.600 chamadas inuteis a API entre 19/06 e 02/08/2026).
 */

// `"code":226` exato. O (?!\d) impede que 2260/1226 — ou um lead cujo id contenha 226 —
// caiam no caminho terminal por engano.
const RE_226 = /"code"\s*:\s*226(?!\d)/;
const RE_LEAD_NOT_FOUND = /lead not found/i;

/**
 * @returns {{terminal: boolean, motivo: string|null}} motivo e um codigo estavel,
 * gravado no banco e lido pelo painel — nao mudar sem migrar os registros existentes.
 */
export function ehErroTerminal(erro) {
  const s = typeof erro === 'string' ? erro : '';
  if (!s) return { terminal: false, motivo: null };
  if (RE_226.test(s) || RE_LEAD_NOT_FOUND.test(s)) {
    return { terminal: true, motivo: 'lead_inexistente' };
  }
  return { terminal: false, motivo: null };
}

// Operacoes que escrevem DIRETO no lead: se o lead morreu, todas morrem junto.
const KINDS_LEAD = new Set(['note', 'lead_field', 'lead_move', 'cobranca_send', 'assinatura_send']);

const naoVazio = (v) => (v == null || v === '' ? null : String(v));

/**
 * De qual lead este job depende (ou null se nao depende de nenhum).
 * Usado p/ NAO enfileirar trabalho para lead ja conhecido como morto.
 *
 * `contact_field` fica de fora de proposito: contato e outra entidade no Kommo e
 * sobrevive ao lead apagado — bloquear por tabela de lead morto seria errado.
 */
export function leadIdAlvo(kind, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (KINDS_LEAD.has(kind)) return naoVazio(p.leadId);
  // salesbot: opSalesbot() usa entityType='leads' por padrao quando nao vem no payload.
  if (kind === 'salesbot') {
    const tipo = p.entityType == null ? 'leads' : String(p.entityType);
    return tipo === 'leads' ? naoVazio(p.entityId) : null;
  }
  // task: createKommoTask() sempre passa entityType explicito — aqui exigimos explicito
  // p/ nao chutar que uma tarefa sem tipo e de lead.
  if (kind === 'task') {
    return String(p.entityType) === 'leads' ? naoVazio(p.entityId) : null;
  }
  return null;
}
