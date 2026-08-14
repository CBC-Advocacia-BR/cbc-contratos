/**
 * Quem atende em cada agenda. Modulo PURO e FONTE UNICA do nome do closer.
 *
 * Ideia dos proprios closers, aprovada pelo Paulo em 14/08/2026: cada um tem o seu
 * PDF, com a sua foto. O que muda entre os quatro arquivos do Canva sao duas
 * paginas (a de apresentacao e a "como funciona"); o resto e o mesmo para todos e
 * mora em dossie-miolo.pdf.
 *
 * A CHAVE E O E-MAIL DA AGENDA, que e o dado que o sistema ja tem em maos: o
 * evento foi criado numa agenda especifica, e e essa agenda que define quem vai
 * atender. Nao ha adivinhacao por nome no titulo do evento.
 *
 * ⚠️ marianamaciel@ e a Mariana Beraldo: a caixa postal ficou com o sobrenome
 * antigo. Confirmado pelo Paulo em 14/08/2026, e a razao de o slug do arquivo ser
 * "mariana" e nao "marianamaciel".
 *
 * ⚠️ Este mapa tem um espelho em scripts/dossie/gerar_ativos.py, que e quem escreve
 * o nome DENTRO do PDF. Divergir faria o e-mail dizer um nome e o anexo outro. O
 * teste dossieClosers.test.mjs le a camada de texto dos PDFs gerados e compara com
 * o que esta aqui, entao a divergencia reprova em vez de chegar ao cliente.
 */

export const CLOSERS = {
  'anacristina@advocaciacbc.com': { slug: 'anacristina', tratamento: 'Dra.', nome: 'Ana Cristina Piva' },
  'beatriz@advocaciacbc.com': { slug: 'beatriz', tratamento: 'Dra.', nome: 'Beatriz Cavalcante' },
  'emerson@advocaciacbc.com': { slug: 'emerson', tratamento: 'Dr.', nome: 'Emerson Calista' },
  'marianamaciel@advocaciacbc.com': { slug: 'mariana', tratamento: 'Dra.', nome: 'Mariana Beraldo' },
};

/**
 * Quem atende nesta agenda.
 *
 * Devolve null para agenda que nao esta no mapa, e isso e proposital: no dia em que
 * entrar um closer novo, ou alguem sair, o envio segue funcionando com a versao
 * generica em vez de quebrar em silencio, ou pior, mostrar o rosto do colega errado.
 *
 * @param {string|null} email e-mail da agenda (vendedora_email)
 * @returns {{slug: string, tratamento: string, nome: string, completo: string,
 *            nomeCurto: string, artigo: string, pronome: string} | null}
 */
export function closerDaAgenda(email) {
  const chave = String(email || '').trim().toLowerCase();
  const base = CLOSERS[chave];
  if (!base) return null;

  // genero sai do tratamento, e nao de um campo proprio: dois campos dizendo a
  // mesma coisa e um convite a divergirem
  const feminino = base.tratamento.toLowerCase().startsWith('dra');
  return {
    ...base,
    completo: `${base.tratamento} ${base.nome}`,
    nomeCurto: `${base.tratamento} ${base.nome.split(/\s+/)[0]}`,
    artigo: feminino ? 'a' : 'o',
    pronome: feminino ? 'Ela' : 'Ele',
  };
}
