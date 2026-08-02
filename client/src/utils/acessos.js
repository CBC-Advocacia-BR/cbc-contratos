// (auditoria 01/08/2026 — item 206) FONTE UNICA de quem tem acesso privilegiado.
//
// A mesma lista de e-mails estava escrita A MAO em 6 arquivos do frontend
// (App, Dashboard ×2, SociosDashboard, TrafegoPanel, ClientesTab, BoletosPanel) — e mais
// uma vez DENTRO de uma funcao SQL (vendedor_pontualidade). Incluir ou remover alguem
// exigia lembrar de todos os lugares; esquecer um vira furo de acesso silencioso — quem
// saiu da sociedade continua vendo o painel financeiro numa tela que ninguem lembrou de
// atualizar.
//
// ⚠️ ISTO NAO E SEGURANCA DE VERDADE, e visibilidade de tela: a checagem roda no
// navegador. O que realmente protege dado sensivel e a RLS/RPC no banco (ex.: a RPC de
// pontualidade confere o e-mail do sócio dentro do proprio SQL). O caminho definitivo e
// mover estas listas para `user_permissions`, e ai esta constante deixa de existir.

/** Socios: veem o Dashboard de Socios e a Saude do Funil. */
export const SOCIOS_EMAILS = [
  'paulo@advocaciacbc.com',
  'bruno@advocaciacbc.com',
  'lorenza@advocaciacbc.com',
];

/** Quem pode ver investimento/CPL (custo de anuncio) no funil do Dashboard. */
export const ADS_CUSTO_EMAILS = SOCIOS_EMAILS;

/** Quem pode EXECUTAR acoes na conta de anuncios (pausar campanha, mudar orcamento).
 *  A trava de verdade e no servidor (meta-trafego-action valida o JWT e confere a lista);
 *  aqui so decide se o botao aparece habilitado. */
export const TRAFEGO_ACAO_EMAILS = SOCIOS_EMAILS;

/** Compara e-mail do usuario com uma lista, sem susto de maiuscula/espaco. */
export function emailEstaNaLista(email, lista) {
  const e = String(email || '').trim().toLowerCase();
  return !!e && lista.some((x) => x.toLowerCase() === e);
}

/** Atalho: este usuario e socio? */
export const ehSocio = (email) => emailEstaNaLista(email, SOCIOS_EMAILS);
