// prestacaoLedger.js — monta o descritivo de verbas (cliente x escritorio) a partir
// do item ja calculado pela RPC `cliente_prestacao_financeiro`. Espelha EXATAMENTE os
// rotulos e as condicoes de exibicao do documento oficial de Prestacao de Contas
// (prestacao-de-contas/src/js/pdf.js: _buildDocClientSection / _buildDocAdvSection).
// Nao recalcula nada — a RPC ja entregou os numeros prontos; aqui so montamos as linhas.

const n = (v) => Number(v || 0);

// 20 -> "20"; 12.5 -> "12,5" (formato do percentual como aparece na Prestacao)
function pctFmt(v) {
  const x = n(v);
  return x % 1 === 0 ? String(Math.round(x)) : x.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
}

/**
 * @param {object} it item devolvido por cliente_prestacao_financeiro
 * @returns {null | {valorRef, valorRefLabel, cli:{total,rows,pct}, esc:{total,rows,pct}, hasBreakdown}}
 *   rows = [{ label, valor, neg?, plus? }] — `neg` deduz (mostra em vermelho, com "-"),
 *   `plus` soma correcao (verde). Sem flag = valor positivo comum.
 */
export function buildLedgers(it) {
  if (!it) return null;
  const cliTotal = n(it.cli_total);
  const escTotal = n(it.esc_total);

  // ── Lado CLIENTE — "VALORES A RECEBER — CLIENTE" ──
  const cli = [];
  if (n(it.devol) > 0) cli.push({ label: 'Devolução', valor: n(it.devol) });
  if (n(it.multa) > 0) cli.push({ label: 'Multa Art. 523 do CPC', valor: n(it.multa) });
  if (n(it.condominio) > 0) cli.push({ label: 'Despesas Condominiais em Aberto', valor: n(it.condominio), neg: true });
  if (n(it.sucumbContraria) > 0) cli.push({ label: 'Sucumbência (Parte Contrária)', valor: n(it.sucumbContraria), neg: true });
  if (n(it.honVal) > 0) cli.push({ label: `Honorários Contratuais (${pctFmt(it.honPct)}%)`, valor: n(it.honVal), neg: true });
  if (n(it.honAberto) > 0) cli.push({ label: 'Honorários em Aberto', valor: n(it.honAberto), neg: true });
  if (n(it.custC) > 0) cli.push({ label: 'Reembolso de Custas Processuais', valor: n(it.custC) });
  if (n(it.corrCli) > 0.005) cli.push({ label: 'Correção Monetária / Juros', valor: n(it.corrCli), plus: true });

  // ── Lado ESCRITÓRIO — "HONORÁRIOS ADVOCATÍCIOS" ──
  const esc = [];
  if (n(it.honVal) > 0) esc.push({ label: 'Honorários Contratuais', valor: n(it.honVal) });
  if (n(it.sucumb) > 0) esc.push({ label: 'Honorários Sucumbenciais', valor: n(it.sucumb) });
  if (n(it.custE) > 0) esc.push({ label: 'Reembolso de Custas Pagas pelo Escritório', valor: n(it.custE) });
  if (n(it.h523) > 0) esc.push({ label: 'Honorários Art. 523 do CPC', valor: n(it.h523) });
  if (n(it.honAberto) > 0) esc.push({ label: 'Honorários em Aberto', valor: n(it.honAberto) });
  if (n(it.corrAdv) > 0.005) esc.push({ label: 'Correção Monetária / Juros', valor: n(it.corrAdv), plus: true });

  const denom = cliTotal + escTotal;
  const cliPct = denom > 0 ? Math.round((cliTotal / denom) * 100) : 0;
  return {
    valorRef: n(it.valorRef),
    valorRefLabel: it.valorRefLabel || 'Valor',
    cli: { total: cliTotal, rows: cli, pct: cliPct },
    esc: { total: escTotal, rows: esc, pct: 100 - cliPct },
    hasBreakdown: cli.length > 0 || esc.length > 0,
  };
}
