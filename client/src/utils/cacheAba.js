// ─────────────────────────────────────────────────────────────────────────
// (auditoria 01/08/2026 — item 188) Cache de aba com validade.
//
// PROBLEMA: a arvore de abas DESMONTA o painel anterior. Voltar para Boletos,
// Contratos ou Minhas Vendas refazia a consulta inteira — o painel de Boletos
// pagina ~11 mil boletos e ~1,3 mil clientes a cada visita, mesmo cinco segundos
// depois. Quatro paineis ja tinham inventado o seu proprio `let _cached...` no
// topo do arquivo, o que resolve o SKELETON (a lista reaparece na hora) mas nao
// evita a rede: o `useEffect` de carga dispara em toda montagem, e o `lastFetchRef`
// que limitaria isso e um `useRef` — zera junto com o componente.
//
// SOLUCAO: o carimbo de hora mora AQUI, fora do ciclo de vida do React, junto com
// os dados. Quem volta a uma aba dentro da validade pinta do cache e NAO consulta.
// Passada a validade, ainda pinta do cache (para nao piscar) e revalida em segundo
// plano — o padrao "mostra o que tem, confere depois".
//
// REGRA: qualquer gravacao invalida a chave correspondente. Cache que sobrevive a
// uma alteracao mente para o usuario, e numa tela de dinheiro isso e pior do que
// esperar o carregamento.
// ─────────────────────────────────────────────────────────────────────────

/** 5 minutos: o suficiente para ir a outra aba e voltar sem custo. */
export const TTL_PADRAO = 5 * 60 * 1000;

const memoria = new Map(); // chave -> { dados, em }
let acertos = 0;
let faltas = 0;

/**
 * Guarda o resultado de uma consulta. Nao serializa nada: e a propria referencia
 * do array que fica na memoria, entao guardar 11 mil boletos custa zero.
 * (O `sessionStorage` dos paineis antigos precisava de um teto de 3.000 linhas
 * justamente porque `JSON.stringify` de array grande trava a thread principal.)
 */
export function gravarCacheAba(chave, dados) {
  memoria.set(chave, { dados, em: Date.now() });
  return dados;
}

/** Idade do cache em milissegundos, ou null se nunca foi gravado. */
export function idadeCacheAba(chave) {
  const e = memoria.get(chave);
  return e ? Date.now() - e.em : null;
}

/**
 * Os dados sao novos o bastante para PULAR a consulta?
 * E esta a pergunta que troca uma ida ao banco por nada.
 */
export function cacheFresco(chave, ttlMs = TTL_PADRAO) {
  const idade = idadeCacheAba(chave);
  const fresco = idade != null && idade <= ttlMs;
  if (fresco) acertos++; else faltas++;
  return fresco;
}

/**
 * O que houver guardado, novo ou velho — serve para PINTAR a tela enquanto a
 * revalidacao acontece. Nunca use isto para decidir se consulta ou nao; para
 * isso existe `cacheFresco`.
 */
export function lerCacheAba(chave) {
  const e = memoria.get(chave);
  return e ? e.dados : null;
}

/**
 * Descarta o cache. Sem argumento, descarta tudo (logout). Com texto, descarta
 * toda chave que comece por ele — permite invalidar uma familia inteira
 * ('boletos:') depois de uma sincronizacao.
 */
export function invalidarCacheAba(prefixo) {
  if (!prefixo) { memoria.clear(); return; }
  for (const k of [...memoria.keys()]) {
    if (k.startsWith(prefixo)) memoria.delete(k);
  }
}

/**
 * Limpeza total no logout. Os dados guardados aqui incluem CPF e valores de
 * cobranca: nao podem sobreviver a troca de usuario na mesma aba do navegador.
 */
export function limparCacheAba() {
  memoria.clear();
  acertos = 0;
  faltas = 0;
}

/** Para o console do Monitor: quantas consultas o cache evitou. */
export function estatisticasCacheAba() {
  const total = acertos + faltas;
  return {
    chaves: memoria.size,
    acertos,
    faltas,
    aproveitamento: total > 0 ? Math.round((acertos / total) * 100) : null,
  };
}
