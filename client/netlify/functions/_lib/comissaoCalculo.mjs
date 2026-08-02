/**
 * (auditoria 01/08/2026 — item 296) Contas puras da comissao dos vendedores, isoladas
 * aqui para poder ser testadas.
 *
 * POR QUE: `commission-calculator.mjs` roda 1x por mes, sozinho, e o resultado vira
 * PAGAMENTO. Se a janela do periodo deslizar um dia, contratos entram ou saem do mes
 * errado; se a faixa escolher o degrau vizinho, a pessoa recebe a mais ou a menos. Nada
 * disso da erro na tela — so aparece na conferencia manual, se alguem conferir.
 *
 * O periodo de apuracao NAO e o mes civil: vai do dia 20 de um mes ao dia 19 do seguinte
 * (`diaInicio` configuravel). Datas em UTC de proposito — sao dias-calendario de
 * fechamento, nao instantes.
 */

/**
 * Janela de apuracao que TERMINA no mes informado.
 * Ex.: '2026-08' com diaInicio 20 -> de 2026-07-20 a 2026-08-19.
 */
export function getPeriodFromMonth(yyyymm, diaInicio = 20) {
  const [year, month] = String(yyyymm).split('-').map(Number);
  // mes 1-12 => Date UTC mes eh 0-11
  const endDate = new Date(Date.UTC(year, month - 1, diaInicio - 1, 23, 59, 59));
  const startDate = new Date(Date.UTC(year, month - 2, diaInicio, 0, 0, 0));
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

/**
 * Periodo corrente a partir de uma data.
 * - antes do dia de inicio: a janela fecha no dia (diaInicio-1) DESTE mes
 * - do dia de inicio em diante: fecha no dia (diaInicio-1) do mes SEGUINTE
 */
export function currentPeriodFromDate(date = new Date(), diaInicio = 20) {
  const d = new Date(date);
  const day = d.getUTCDate();
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1; // 1-12

  if (day < diaInicio) {
    return getPeriodFromMonth(`${year}-${String(month).padStart(2, '0')}`, diaInicio);
  }
  month += 1;
  if (month > 12) { month = 1; year += 1; }
  return getPeriodFromMonth(`${year}-${String(month).padStart(2, '0')}`, diaInicio);
}

/**
 * Degrau da tabela de comissao para uma quantidade de contratos.
 * Faixas: [{min, max, valor}] — `max` nulo/ausente = "daqui para cima".
 * Devolve null quando a quantidade nao cai em nenhum degrau (ex.: 0 contratos).
 */
export function getFaixa(faixas, count) {
  if (!Array.isArray(faixas)) return null;
  for (const f of faixas) {
    const min = Number(f.min);
    const max = f.max === null || f.max === undefined ? null : Number(f.max);
    if (count >= min && (max === null || count <= max)) {
      return { faixa: `${min}-${max ?? '+'}`, valor: Number(f.valor) || 0 };
    }
  }
  return null;
}

/** A promocao vale para este contrato? (data de assinatura + filtros de resort/tipo) */
export function isPromocaoAplicavel(promo, contrato) {
  const sigDate = (contrato.signed_at || '').slice(0, 10);
  if (!sigDate) return false;
  if (sigDate < promo.data_inicio || sigDate > promo.data_fim) return false;
  if (promo.resort_filtro && promo.resort_filtro !== contrato.resort) return false;
  if (promo.tipo_acao_filtro && promo.tipo_acao_filtro !== contrato.tipo_acao) return false;
  return true;
}
