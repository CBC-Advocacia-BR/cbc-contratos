/**
 * Nota do lead (lead score). Logica PURA: sem React, sem rede, sem banco.
 *
 * A FORMULA ESTA EM AVALIACAO (decisao do Paulo em 11/08/2026). Por isso nada aqui e
 * fixo: os pesos, o piso de valor e a lista de resorts prioritarios vem da configuracao,
 * e mudar um numero na tela recalcula a fila inteira sem deploy.
 *
 * Duas regras que NAO sao de gosto, e sim do que os dados do escritorio mostram:
 *
 *  - Sem resort E sem valor a nota nao existe: devolve null, e a tela mostra "a apurar".
 *    Zero seria lido como julgamento ("esse lead nao vale nada") quando na verdade e
 *    ausencia de informacao. Lead sem resort identificado agenda 3,4%; com resort, entre
 *    39% e 59% — a diferenca e o dado, nao o lead.
 *
 *  - O historico de faltas NAO entra na conta (decisao do Paulo em 11/08). Ele aparece
 *    como selo na linha, porque faltar pode ter sido falha do processo: nenhum lembrete
 *    jamais foi enviado nos 2.938 agendamentos do historico.
 */

export const CONFIG_PADRAO = {
  peso_valor: 40,
  peso_resort: 35,
  peso_quitado: 25,
  piso_valor: 40000,
  limiar_topo: 70,
  resorts_prioritarios: ['Hot Beach You', 'Hard Rock', 'Barretos Country', 'Ondas Praia', 'Solar das Águas'],
};

const num = (v, padrao) => (Number.isFinite(Number(v)) ? Number(v) : padrao);

/**
 * @returns {{nota:number|null, faltando:string[], faixa:'quente'|'morno'|'frio'|'apurar'}}
 */
export function pontuar(lead, config = CONFIG_PADRAO) {
  const c = { ...CONFIG_PADRAO, ...(config || {}) };
  if (!lead) return { nota: null, faltando: ['valor', 'resort'], faixa: 'apurar' };

  const faltando = [];
  let nota = 0;

  const valor = Number(lead.valor_pago);
  if (Number.isFinite(valor) && valor > 0) {
    // acima do piso soma o peso cheio; abaixo, uma fracao — ter o dado ja vale algo
    nota += valor >= num(c.piso_valor, 40000)
      ? num(c.peso_valor, 40)
      : Math.round(num(c.peso_valor, 40) * 0.4);
  } else {
    faltando.push('valor');
  }

  if (lead.resort) {
    const prioritarios = Array.isArray(c.resorts_prioritarios) ? c.resorts_prioritarios : [];
    nota += prioritarios.includes(lead.resort)
      ? num(c.peso_resort, 35)
      : Math.round(num(c.peso_resort, 35) * 0.4);
  } else {
    faltando.push('resort');
  }

  if (lead.situacao_cota === 'quitada') nota += num(c.peso_quitado, 25);

  // o julgamento do SDR sobrepoe a conta: ele ve audio, urgencia e tom, que a nota nao ve
  if (lead.quente) nota = Math.max(nota, 90);

  if (faltando.length >= 2 && !lead.quente) {
    return { nota: null, faltando, faixa: 'apurar' };
  }

  const limiar = num(c.limiar_topo, 70);
  const faixa = nota >= limiar ? 'quente' : nota >= Math.round(limiar * 0.57) ? 'morno' : 'frio';
  return { nota, faltando, faixa };
}

/** Passa do limiar? E quem vai para o topo, em vez do rodizio. */
export function vaiParaTopo(lead, config = CONFIG_PADRAO) {
  const { nota } = pontuar(lead, config);
  return nota != null && nota >= num((config || CONFIG_PADRAO).limiar_topo, 70);
}
