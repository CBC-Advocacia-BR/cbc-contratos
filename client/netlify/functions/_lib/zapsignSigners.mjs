/**
 * (auditoria 01/08/2026 — item 204) Leitura dos signatários do ZapSign: FONTE ÚNICA.
 *
 * A mesma conta existia em TRÊS lugares, e já tinha divergido:
 *   1. `App.jsx`            — verificação automática a cada 5 min (formato cru da API)
 *   2. `ContratosTab.jsx`   — botão "sincronizar ZapSign" (formato já normalizado por
 *                             `zapsignService`: `signUrl`/`signedAt` em vez de
 *                             `sign_url`/`signed_at`)
 *   3. `zapsign-webhook.mjs`— o webhook do servidor (formato cru)
 *
 * Os três decidem a MESMA coisa: o contrato virou "assinado"? Qual a data real da
 * assinatura? Como fica a lista de links? É a decisão que muda o status de um contrato —
 * e, com três cópias, uma correção feita numa nunca chegava nas outras. É exatamente o
 * padrão que produziu o bug do mapa do ADVBOX (duas cópias fora de sincronia).
 *
 * `lerSignatarios` aceita os DOIS formatos de campo, então serve aos três chamadores sem
 * que nenhum precise converter nada antes.
 */

/** Pega o primeiro campo presente (a API e o normalizador usam nomes diferentes). */
const campo = (obj, ...nomes) => {
  for (const n of nomes) {
    const v = obj?.[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

/**
 * @param {Array} signers lista crua da API do ZapSign OU já normalizada
 * @param {Date}  agora   injetável para teste
 * @returns {{links: Array, todosAssinaram: boolean, algumRecusou: boolean, assinadoEm: string|null, total: number}}
 */
export function lerSignatarios(signers, agora = new Date()) {
  const lista = Array.isArray(signers) ? signers : [];

  const links = lista.map((s) => ({
    name: campo(s, 'name'),
    email: campo(s, 'email'),
    token: campo(s, 'token'),
    sign_url: campo(s, 'sign_url', 'signing_link', 'signUrl'),
    status: campo(s, 'status'),
    signed_at: campo(s, 'signed_at', 'signedAt'),
    // rastreio de visualização (usado pela nota "abriu e não assinou")
    times_viewed: Number(campo(s, 'times_viewed', 'timesViewed')) || 0,
    first_opened_at: campo(s, 'first_opened_at', 'firstOpenedAt'),
    last_view_at: campo(s, 'last_view_at', 'lastViewAt'),
  }));

  // Lista VAZIA nunca conta como "todos assinaram" — `[].every()` é true em JavaScript,
  // e sem esta guarda um documento sem signatários viraria contrato assinado sozinho.
  const todosAssinaram = lista.length > 0 && lista.every((s) => campo(s, 'status') === 'signed');
  const algumRecusou = lista.some((s) => campo(s, 'status') === 'refused');

  // Data REAL da assinatura = a do ÚLTIMO signatário. Sem isto o `signed_at` ficava
  // vazio e os relatórios de prazo, produção e comissão caíam numa aproximação
  // (signed_at -> advbox_date -> updated_at).
  const datas = links.map((l) => l.signed_at).filter(Boolean).sort();
  const assinadoEm = todosAssinaram
    ? (datas.length ? datas[datas.length - 1] : agora.toISOString())
    : null;

  return { links, todosAssinaram, algumRecusou, assinadoEm, total: lista.length };
}

/**
 * A lista de links mudou em relação à guardada? Evita gravação (e linha de auditoria)
 * a cada verificação quando nada aconteceu — a verificação roda de 5 em 5 minutos.
 */
export function linksMudaram(anteriores, novos) {
  return JSON.stringify(anteriores || []) !== JSON.stringify(novos || []);
}
