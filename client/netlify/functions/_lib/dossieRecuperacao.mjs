/**
 * E-mail de recuperação: sai no dia seguinte para quem não compareceu. Módulo PURO.
 *
 * A base do projeto registra que a SEGUNDA CHANCE converte 60,4%, contra 22,3% de
 * falta na primeira. Hoje quem falta simplesmente some, então este é provavelmente
 * o maior dinheiro parado do fluxo.
 *
 * GATILHOS DE VENDA (pedido do Paulo, 12/08/2026), e como cada um foi construído
 * para ser VERDADE, não truque:
 *
 *  AUTORIDADE  números do acervo próprio, conferidos no banco: 3.516 ações desde
 *              2017, em 215 empreendimentos. Não é adjetivo, é contagem.
 *
 *  URGÊNCIA    a prescrição. É a única urgência honesta deste negócio: o prazo
 *              existe na lei, corre sozinho e não foi inventado para vender.
 *              Escrita sem prometer prazo específico, porque ele varia com o caso
 *              e afirmar número viraria consulta jurídica por e-mail.
 *
 *  ESCASSEZ    a agenda. ⚠️ Só é honesta se for real. O texto fala em "os horários
 *              da semana costumam fechar", que descreve o padrão, e não "restam 2
 *              vagas", que seria número inventado.
 *
 * ⚠️ RISCO A CONSIDERAR: o Provimento 205/2021 do CFOAB pede publicidade
 * informativa, com discrição e sobriedade, e veda captação de clientela. Gatilho de
 * venda em peça de escritório de advocacia anda perto dessa linha. A decisão é do
 * Paulo, advogado; o texto foi escrito para ficar do lado informativo dela.
 */
import { escapeHtml } from './validate.mjs';

const ESCRITORIO = 'Conforto, Bergonsi &amp; Cavalari Advogados';
const WHATS_LINK = 'https://wa.me/5519988051878';
const WHATS_COM_TEXTO = `${WHATS_LINK}?text=${
  encodeURIComponent('Olá! Não consegui participar da videochamada e gostaria de remarcar.')}`;

const botao = (href, texto) => `<a href="${href}"
  style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;
         font-weight:bold;font-size:16px;padding:14px 26px;border-radius:8px">${texto}</a>`;

/**
 * @param {{nome: string|null, quandoFaltou: object, config: object}} p
 * @returns {{assunto: string, html: string, texto: string}}
 */
export function montarRecuperacao({ nome, quandoFaltou, config = {} }) {
  const assunto = String(config.assunto_recuperacao
    || 'Podemos remarcar a sua conversa, {{primeiro_nome}}?')
    .replace(/\{\{primeiro_nome\}\}/g, nome || '')
    .replace(/,\s*\?/, '?')            // sem nome, não deixa vírgula órfã
    .trim();

  const saudacao = nome ? `Olá, ${escapeHtml(nome)}.` : 'Olá!';
  const quando = quandoFaltou?.diaSemana
    ? `${quandoFaltou.diaSemana.toLowerCase()}, às ${quandoFaltou.hora},`
    : '';

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:600px">
  <p style="margin:0 0 16px">${saudacao}</p>

  <p style="margin:0 0 16px">Tínhamos uma conversa marcada ${quando} e você não conseguiu
    participar. Acontece, e remarcar não custa nada.</p>

  <p style="margin:0 0 16px">Antes de você decidir, duas coisas que valem saber.</p>

  <p style="margin:0 0 8px"><strong>O tempo corre a favor de quem vendeu a cota.</strong></p>
  <p style="margin:0 0 16px">O direito de discutir um contrato de multipropriedade e pedir de
    volta o que foi pago tem prazo, e ele corre sozinho, com você tomando providência ou não.
    Não acaba amanhã, mas cada mês que passa é um mês a menos, e há casos em que essa diferença
    é de milhares de reais.</p>

  <p style="margin:0 0 8px"><strong>A conversa não compromete você a nada.</strong></p>
  <p style="margin:0 0 16px">São de 10 a 15 minutos. A gente olha o seu contrato e o seu extrato
    e diz com franqueza se há caso ou não. Quando não há, a gente fala, e você não perdeu nada
    além de quinze minutos.</p>

  <p style="margin:0 0 20px">Desde 2017 já conduzimos <strong>mais de 3.500 ações</strong> desse
    tipo, em <strong>215 empreendimentos</strong> diferentes. É o mesmo caso, repetido milhares
    de vezes, o que quer dizer que a sua situação provavelmente não é inédita para nós.</p>

  <p style="margin:0 0 12px">${botao(WHATS_COM_TEXTO, 'Remarcar pelo WhatsApp')}</p>

  <p style="margin:0 0 20px;color:#4b5563;font-size:14px">Os horários da semana costumam fechar
    rápido, então quanto antes você escolher, mais opção de dia e de hora você tem.</p>

  <p style="margin:0 0 16px">E se preferir não seguir com isso agora, tudo bem. Este é o único
    e-mail que enviaremos sobre a conversa que não aconteceu.</p>

  <p style="margin:0"><strong>${ESCRITORIO}</strong></p>

  <p style="margin:20px 0 0;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px">
    Conforto, Bergonsi &amp; Cavalari Sociedade de Advogados, OAB/SP 55.227.
    Mensagem informativa, não constitui oferta de serviço nem parecer jurídico.</p>
</div>`;

  const texto = [
    nome ? `Olá, ${nome}.` : 'Olá!',
    '',
    `Tínhamos uma conversa marcada ${quando} e você não conseguiu participar.`,
    'Acontece, e remarcar não custa nada.',
    '',
    'O TEMPO CORRE A FAVOR DE QUEM VENDEU A COTA.',
    'O direito de discutir um contrato de multipropriedade e pedir de volta o que foi pago',
    'tem prazo, e ele corre sozinho. Cada mês que passa é um mês a menos.',
    '',
    'A CONVERSA NÃO COMPROMETE VOCÊ A NADA.',
    'São de 10 a 15 minutos. A gente olha o seu contrato e diz com franqueza se há caso.',
    'Quando não há, a gente fala.',
    '',
    'Desde 2017 já conduzimos mais de 3.500 ações desse tipo, em 215 empreendimentos.',
    '',
    `Remarcar pelo WhatsApp: ${WHATS_LINK}`,
    '',
    'Os horários da semana costumam fechar rápido, então quanto antes você escolher,',
    'mais opção de dia e de hora você tem.',
    '',
    'E se preferir não seguir agora, tudo bem. Este é o único e-mail que enviaremos',
    'sobre a conversa que não aconteceu.',
    '',
    'Conforto, Bergonsi & Cavalari Advogados',
  ].join('\n');

  return { assunto, html, texto };
}
