/**
 * De onde sai o primeiro nome que vai na capa do dossie. Modulo PURO.
 *
 * CASCATA: titulo do evento -> nome do lead no Kommo -> sem nome.
 *
 * O titulo vem PRIMEIRO de proposito, contra a intuicao de que "o cadastro vale
 * mais". Medido em 12/08/2026 sobre 334 pares dos ultimos 60 dias: os dois nomes
 * divergem em 63 casos (18,9%), e o titulo ganha quase sempre, porque e o que a
 * vendedora escreveu DEPOIS de falar com a pessoa:
 *
 *   titulo "Patty"    x  Kommo "PATRICIA DE OLIVEIRA MOURA FROS"  (e-mail: pattyfros90@)
 *   titulo "Cidinha"  x  Kommo "MARIA APARECIDA NOGUEIRA E SILVA" (e-mail: cidinhanog@)
 *   titulo "Irasmom"  x  Kommo "SILVA IRASMON"   (Kommo com sobrenome primeiro)
 *   titulo "Robson"   x  Kommo "robsonagnelo98"  (apelido de sistema)
 *
 * Escrever "Ola, Maria" para quem se apresenta como Fatima e pior do que nao
 * escrever nome nenhum: denuncia automacao cega justamente no material que existe
 * para o escritorio parecer serio.
 *
 * COBERTURA: dos 465 eventos dos ultimos 60 dias, 461 (99,1%) tem nome bom no
 * titulo, 4 caem na reserva do Kommo e nenhum fica sem nome.
 */

// Palavras que aparecem em titulo de agenda e NAO sao nome de pessoa.
const NAO_E_NOME = new Set([
  'reagendamento', 'reagendado', 'reagendar', 'remarcado', 'remarcar', 'retorno',
  'call', 'reuniao', 'reunião', 'cliente', 'lead', 'video', 'videochamada',
  'chamada', 'contato', 'teste', 'sem', 'nome', 'confirmar', 'confirmado',
]);

const capitaliza = (n) => (n.length > 1
  ? n[0].toUpperCase() + n.slice(1).toLowerCase()
  : n.toUpperCase());

/** So aceita token que parece nome: 2+ caracteres, todos letras, fora da lista. */
function pareceNome(tok) {
  if (!tok || tok.length < 2) return false;
  // \p{L} cobre acento sem precisar listar caractere a caractere, e ja rejeita
  // digito, que e o que denuncia apelido de sistema ("robsonagnelo98")
  if (!/^\p{L}+$/u.test(tok)) return false;
  return !NAO_E_NOME.has(tok.toLowerCase());
}

const primeiroPedaco = (t) => t.split(/[\s/,.;:-]/u)[0];   // corta no 1o separador

/**
 * Nome a partir do TITULO do evento, que traz o telefone colado no fim
 * ("Fatima +5518997479595", "Joao 91 88151-233").
 */
function tokenDoTitulo(texto) {
  if (!texto) return null;
  let t = String(texto).trim();
  t = t.replace(/[+0-9()\-/\s]+$/u, '');   // tira o telefone do fim
  t = t.replace(/^[^\p{L}]+/u, '');        // tira "*", "-", espaco do comeco
  const tok = primeiroPedaco(t);
  return pareceNome(tok) ? capitaliza(tok) : null;
}

/**
 * Nome a partir do CADASTRO do Kommo.
 *
 * ⚠️ NAO reusa a limpeza do titulo, e o teste existe por causa disto: aplicar o
 * "tira o telefone do fim" aqui comia o 98 de "robsonagnelo98" e devolvia
 * "Robsonagnelo", ou seja, transformava um apelido de sistema em nome de gente.
 * Campo de cadastro nao tem telefone colado, entao digito no token e sinal de que
 * aquilo nao e nome, e o certo e recusar.
 */
function tokenDoCadastro(texto) {
  if (!texto) return null;
  const t = String(texto).trim().replace(/^[^\p{L}]+/u, '');
  const tok = primeiroPedaco(t);
  return pareceNome(tok) ? capitaliza(tok) : null;
}

/**
 * Primeiro nome para a capa do dossie.
 * @param {string|null} tituloEvento titulo do evento na agenda ("Fatima +5518997479595")
 * @param {string|null} [nomeKommo]  nome do lead no Kommo, usado so como reserva
 * @returns {string|null} nome capitalizado, ou null se nenhuma fonte servir
 */
export function primeiroNome(tituloEvento, nomeKommo = null) {
  return tokenDoTitulo(tituloEvento) || tokenDoCadastro(nomeKommo);
}
