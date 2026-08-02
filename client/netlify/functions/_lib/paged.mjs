// (auditoria 01/08/2026 — itens 88/89/90) Paginacao do PostgREST no lado SERVIDOR.
//
// Irmao de client/src/utils/supabasePaged.js — mesma armadilha, outro lado do sistema:
// o PostgREST corta a resposta em 1000 linhas por requisicao (db-max-rows) e um
// `.limit(N)` maior NAO levanta esse teto. Nas functions o efeito e pior que numa tela,
// porque nao ha ninguem olhando: o mapa processo->lead parava de incluir os contratos
// mais novos e eles simplesmente deixavam de receber nota no Kommo, sem erro e sem log.
//
// ⚠️ ORDER BY TOTAL obrigatorio: a ultima coluna da ordenacao precisa ser unica, senao
// linhas repetem ou somem na virada de pagina.

const PAGE = 1000;

/**
 * @param {() => object} build fabrica de query builder — precisa devolver um NOVO a cada
 *   chamada (reusar o mesmo acumula os modificadores e a 2a pagina vem errada).
 * @param {{maxPaginas?: number, aoTruncar?: (n:number)=>void}} [opts]
 */
export async function fetchAllPaged(build, opts = {}) {
  const maxPaginas = opts.maxPaginas ?? 50;
  let todas = [];
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const de = pagina * PAGE;
    const { data, error } = await build().range(de, de + PAGE - 1);
    if (error) throw new Error(`paginacao: ${error.message}`);
    todas = todas.concat(data || []);
    if (!data || data.length < PAGE) return todas;
  }
  // Nunca truncar em silencio (item 107): quem chamou precisa saber que a lista veio pela metade.
  if (opts.aoTruncar) opts.aoTruncar(todas.length);
  return todas;
}
