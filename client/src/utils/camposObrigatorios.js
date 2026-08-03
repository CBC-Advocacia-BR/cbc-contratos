// ─────────────────────────────────────────────────────────────────────────
// (auditoria 01/08/2026 — item 205) FONTE UNICA dos campos obrigatorios do contratante.
//
// A regra existia em DOIS lugares com implementacoes diferentes: a lista que o FormPanel
// usa para pintar as bolinhas de progresso e desabilitar os botoes, e a sequencia de
// verificacoes escrita a mao no `validateChecklist` do App, que e o portao real do envio
// (e o unico caminho do atalho de teclado). Duas implementacoes da mesma regra so ficam
// iguais por sorte: um campo novo precisa ser lembrado nos dois lados, e quem esquecer um
// deles cria uma tela que diz "pronto para enviar" e um envio que recusa — ou pior, um
// envio que passa sem um dado que o contrato precisa.
//
// A lista mora aqui. O `validateChecklist` continua sendo o portao (ele valida FORMATO,
// nao so presenca: CPF com digito verificador, e-mail, e o link do Kommo no formato
// /leads/detail/{id}), mas um teste compara os dois conjuntos: se um campo entrar na
// lista e nao no portao — ou o contrario — a suite reprova antes de virar deploy.
// ─────────────────────────────────────────────────────────────────────────

/** Pessoa fisica: tambem sao os campos do REPRESENTANTE LEGAL quando o cliente e empresa. */
export const CONTRATANTE_FIELDS_PF = [
  'nome', 'nacionalidade', 'profissao', 'estadoCivil', 'rg', 'cpf', 'email',
  'dataNascimento', 'telefone', 'linkKommo', 'cep', 'uf', 'endereco', 'numero',
  'bairro', 'cidade',
];

/** Campos que existem SO quando o contratante e empresa (o bloco da pessoa juridica). */
export const CONTRATANTE_FIELDS_EMPRESA = [
  'razaoSocial', 'cnpj', 'emailEmpresa', 'cepEmpresa', 'ufEmpresa',
  'enderecoEmpresa', 'numeroEmpresa', 'bairroEmpresa', 'cidadeEmpresa',
];

/**
 * (PJ 25/06) Cliente Empresa exige o bloco da empresa E os campos de pessoa, que ali
 * descrevem o representante legal — por isso a lista PJ contem a PF inteira.
 */
export const CONTRATANTE_FIELDS_PJ = [...CONTRATANTE_FIELDS_EMPRESA, ...CONTRATANTE_FIELDS_PF];

/** Campos obrigatorios de UM contratante, conforme ele seja pessoa ou empresa. */
export function camposObrigatorios(c) {
  return (c?.tipo === 'pj') ? CONTRATANTE_FIELDS_PJ : CONTRATANTE_FIELDS_PF;
}

/**
 * Campos do contrato que nao pertencem a nenhum contratante. Ficam aqui pelo mesmo
 * motivo: o portao do envio e a tela precisam concordar sobre o que e obrigatorio.
 */
export const CAMPOS_CONTRATO = [
  'resort', 'tipoAcao', 'honorarios', 'origemCliente', 'dataPrimeiraMensagem', 'linkGoogleDrive',
];
