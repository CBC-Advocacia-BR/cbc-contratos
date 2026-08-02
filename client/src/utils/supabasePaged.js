// (auditoria 01/08/2026 — item 85) Fonte UNICA de paginacao do PostgREST.
//
// POR QUE ISSO EXISTE: o PostgREST corta a resposta em 1000 linhas por requisicao
// (db-max-rows) e um .limit(N) MAIOR NAO LEVANTA ESSE TETO — `.limit(20000)` devolve
// 1000 linhas exatamente como se nao houvesse limit nenhum, sem erro e sem aviso.
// Foi assim que o funil exibiu 112 calls no lugar de 191 em julho/26 (fix 28/07) e
// e o mesmo defeito que a auditoria de 01/08 encontrou em mais 8 telas (Socios,
// Trafego, relatorios, cobranca, clientes).
//
// A implementacao nasceu em utils/funilSources.js e ficou presa la; TrafegoPanel,
// NegativacaoPanel e BoletosPanel reimplementaram cada um o seu laco. Agora ha um so.
//
// ⚠️ ORDER BY TOTAL E OBRIGATORIO: com empates o Postgres nao garante a mesma ordem
// entre paginas e uma linha pode repetir ou sumir na virada. Toda consulta paginada
// precisa terminar numa coluna UNICA (id, event_id, lawsuit_id...). Se a ordenacao
// util empata (scheduled_at, due_date, nome), acrescente a coluna unica como ultimo
// criterio — ela nao precisa estar no select.
import { supabase } from '../lib/supabase';

export const PAGE = 1000;

/**
 * Pagina com .range() ate a ultima pagina.
 * @param {() => object} build precisa devolver um query builder NOVO a cada chamada —
 *   reusar o mesmo acumula os modificadores e a 2a pagina vem errada.
 * @param {{maxPaginas?: number, onCorte?: (total:number) => void}} [opts]
 *   maxPaginas: trava de seguranca contra laco infinito (default 100 = 100 mil linhas).
 *   onCorte: chamado se a trava for atingida — NUNCA truncar em silencio (auditoria #107).
 */
export async function fetchAllPaged(build, opts = {}) {
  const maxPaginas = opts.maxPaginas ?? 100;
  let all = [];
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const from = pagina * PAGE;
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) return all;
  }
  // Chegou no teto: a lista esta INCOMPLETA. Avisa quem chamou em vez de mentir.
  if (opts.onCorte) opts.onCorte(all.length);
  else console.warn(`[supabasePaged] corte em ${all.length} linhas (maxPaginas=${maxPaginas})`);
  return all;
}

/**
 * Atalho para o caso comum: tabela/view + colunas + ordenacao unica.
 * @param {string} tabela nome da tabela ou view
 * @param {string} colunas lista de colunas do select
 * @param {{order?: string|string[], ascending?: boolean, filtros?: (q:object)=>object}} [opts]
 *   order: coluna(s) de ordenacao — a ULTIMA precisa ser unica.
 *   filtros: recebe o builder e devolve o builder com .eq()/.in()/.gte() aplicados.
 */
export function fetchTablePaged(tabela, colunas, opts = {}) {
  const cols = Array.isArray(opts.order) ? opts.order : [opts.order || 'id'];
  const asc = opts.ascending !== false;
  return fetchAllPaged(() => {
    let q = supabase.from(tabela).select(colunas);
    if (opts.filtros) q = opts.filtros(q);
    for (const c of cols) q = q.order(c, { ascending: asc });
    return q;
  }, opts);
}

/**
 * Contagem REAL no banco (head:true nao traz linhas e ignora o teto de 1000).
 * Use sempre que a tela so precisa do numero — contar no navegador uma lista
 * truncada faz a fila "empacada com 1.500 jobs" aparecer como estavel em 1.000.
 */
export async function countExact(tabela, filtros) {
  let q = supabase.from(tabela).select('*', { count: 'exact', head: true });
  if (filtros) q = filtros(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
