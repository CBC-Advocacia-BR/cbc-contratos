// Trava anti-substituicao de contratos (17/07/2026).
//
// Contexto: o salvar do formulario fazia UPDATE cego sempre que havia um
// savedContractId na tela. Operador que reaproveitava o formulario (trocando o
// resort para emitir outro contrato do mesmo cliente) SOBRESCREVIA o contrato
// anterior — caso real: 3 contratos assinados da mesma cliente em 16/07 viraram
// 1 so no sistema (2 ficaram orfaos no ZapSign, sem processo e sem cobranca).
//
// Regra de negocio (Paulo, 17/07/2026): mesmos contratantes + resort diferente
// = contratos UNITARIOS. Nunca substituir; cada contrato e uma linha propria.

export const SAVE_MODES = {
  UPDATE: 'update',            // atualiza o contrato carregado (rascunho em edicao)
  INSERT_NOVO: 'insert_novo',  // preserva o original e cria um contrato novo
  PERGUNTAR: 'perguntar',      // rascunho com resort trocado: operador decide
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Decide o destino de um salvar quando ja existe um contrato carregado na tela.
 *
 * @param {object} p
 * @param {string|null} p.statusAtual  status do contrato no BANCO (nao o do form);
 *                                     null/undefined = registro nao encontrado
 * @param {string|null} p.resortAtual  resort gravado no banco
 * @param {string|null} p.resortNovo   resort efetivo do formulario
 * @param {boolean} [p.fluxoEnvio]     true no save do envio ZapSign (doc ja criado —
 *                                     nao pode abrir modal nem abortar)
 * @returns {'update'|'insert_novo'|'perguntar'}
 */
export function decideSaveMode({ statusAtual, resortAtual, resortNovo, fluxoEnvio = false }) {
  // Registro sumiu ou status fora do fluxo conhecido: nunca faz update cego.
  if (statusAtual !== 'rascunho') return SAVE_MODES.INSERT_NOVO;

  const antes = norm(resortAtual);
  const depois = norm(resortNovo);
  const trocouResort = antes !== '' && depois !== '' && antes !== depois;

  if (trocouResort) return fluxoEnvio ? SAVE_MODES.INSERT_NOVO : SAVE_MODES.PERGUNTAR;
  return SAVE_MODES.UPDATE;
}
