/**
 * Lembrete enviado 3 horas antes da videochamada. Módulo PURO.
 *
 * NÃO leva anexo, de propósito: o dossiê já foi quando o agendamento aconteceu, e
 * 4 MB no dia da reunião só atrapalha quem abre no celular.
 *
 * Quatro escolhas de conteúdo, aprovadas pelo Paulo em 12/08/2026:
 *  1. o assunto diz "hoje" e a HORA, que é o que faz abrir no celular;
 *  2. o link do Meet é o botão principal: "não achei o link" causa tanta falta
 *     quanto esquecimento;
 *  3. pede para TESTAR o link antes, e para escolher um lugar calmo com bom sinal,
 *     amarrando o pedido ao motivo ("ouvir bem o seu caso"), que convence mais do
 *     que só pedir;
 *  4. "não vai conseguir? avise" existe para recuperar a agenda da vendedora, que
 *     vale quase tanto quanto o comparecimento.
 *
 * TRÊS HORAS antes, e não uma: uma hora antes só serve para lembrar, já não dá
 * tempo de remarcar nada.
 */
import { escapeHtml } from './validate.mjs';

const ESCRITORIO = 'Conforto, Bergonsi &amp; Cavalari Advogados';
const WHATS_NUMERO = '(19) 98805-1878';
const WHATS_LINK = 'https://wa.me/5519988051878';
const WHATS_LINK_COM_TEXTO = `${WHATS_LINK}?text=${
  encodeURIComponent('Olá! É sobre a minha videochamada de hoje com o escritório.')}`;

const botao = (href, cor, texto) => `<a href="${href}"
  style="display:inline-block;background:${cor};color:#ffffff;text-decoration:none;
         font-weight:bold;font-size:16px;padding:14px 26px;border-radius:8px">${texto}</a>`;

/**
 * @param {{nome: string|null, quando: object, meetLink: string|null,
 *           urlSim: string|null, urlRemarcar: string|null, closer: object|null,
 *           config: object}} p
 *   `quando` é o retorno de quandoPorExtenso(); `closer` o de closerDaAgenda(), que
 *   pode ser null. As urls vêm assinadas por confirmacaoToken; sem elas o e-mail
 *   cai no botão único do WhatsApp.
 * @returns {{assunto: string, html: string, texto: string}}
 */
export function montarLembrete({ nome, quando, meetLink, urlSim, urlRemarcar,
                                closer = null, config = {} }) {
  const assunto = String(config.assunto_lembrete || 'Sua videochamada é hoje às {{hora}}')
    .replace(/\{\{hora\}\}/g, quando.hora)
    .replace(/\{\{primeiro_nome\}\}/g, nome || '')
    .trim();

  const saudacao = nome ? `Olá, ${escapeHtml(nome)}.` : 'Olá!';

  // No dia da conversa o nome de quem vai atender vale de novo: o primeiro e-mail
  // saiu dias antes e a pessoa nao lembra. Aqui vai a forma curta, porque o corpo
  // inteiro deste e-mail cabe numa tela de celular e o nome completo pesaria.
  const comQuem = closer
    ? ` com ${closer.artigo} <strong>${escapeHtml(closer.nomeCurto)}</strong>`
    : ' com o nosso escritório';
  const comQuemTexto = closer
    ? ` com ${closer.artigo} ${closer.nomeCurto}`
    : ' com o nosso escritório';

  // Sem link do Meet o botão principal não existe; o e-mail ainda serve como
  // lembrete, e aponta para o convite da agenda em vez de um botão quebrado.
  const blocoEntrar = meetLink
    ? `<p style="margin:0 0 20px">${botao(meetLink, '#1B3A5C', 'Entrar na videochamada')}</p>
       <p style="margin:0 0 16px"><strong>Teste o link agora</strong>, antes da hora. Se ele pedir
         permissão de câmera e microfone, você autoriza com calma e não perde tempo no começo
         da conversa.</p>`
    : `<p style="margin:0 0 16px">O link está no convite que chegou na sua agenda.
         <strong>Vale abrir agora</strong>, antes da hora, para conferir se funciona no seu
         aparelho.</p>`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:600px">
  <p style="margin:0 0 16px">${saudacao}</p>

  <p style="margin:0 0 20px">Sua videochamada${comQuem} é
    <strong>hoje às ${quando.hora}</strong>.</p>

  ${blocoEntrar}

  <p style="margin:0 0 16px"><strong>Procure um lugar tranquilo e com bom sinal</strong>, de
    internet ou de celular. São de 10 a 15 minutos, e ouvir bem o seu caso faz diferença.</p>

  <p style="margin:0 0 20px">Se puder, tenha em mãos o contrato de compra da cota e o extrato
    ou os comprovantes de pagamento. Se não tiver, tudo bem.</p>

  ${urlSim ? `<p style="margin:0 0 10px"><strong>Nos avise se estará por lá.</strong> É um clique,
    e ajuda a nossa equipe a se organizar.</p>

  <p style="margin:0 0 24px">
    ${botao(urlSim, '#1B7F4B', 'Confirmo que estarei')}
    <span style="display:inline-block;width:8px"></span>
    ${botao(urlRemarcar || WHATS_LINK_COM_TEXTO, '#8A6A12', 'Preciso remarcar')}
  </p>`
    : `<p style="margin:0 0 10px"><strong>Não vai conseguir?</strong> Avise pelo WhatsApp
    <strong>${WHATS_NUMERO}</strong> e a gente remarca.</p>

  <p style="margin:0 0 24px">${botao(WHATS_LINK_COM_TEXTO, '#25D366', 'Falar no WhatsApp')}</p>`}

  <p style="margin:0 0 4px">Até logo,</p>
  <p style="margin:0"><strong>${ESCRITORIO}</strong></p>
</div>`;

  const texto = [
    nome ? `Olá, ${nome}.` : 'Olá!',
    '',
    `Sua videochamada${comQuemTexto} é HOJE às ${quando.hora}.`,
    '',
    meetLink ? `Entrar na videochamada: ${meetLink}` : 'O link está no convite da sua agenda.',
    '',
    'Teste o link agora, antes da hora. Se ele pedir permissão de câmera e microfone,',
    'você autoriza com calma e não perde tempo no começo da conversa.',
    '',
    'Procure um lugar tranquilo e com bom sinal, de internet ou de celular. São de 10 a',
    '15 minutos, e ouvir bem o seu caso faz diferença.',
    '',
    'Se puder, tenha em mãos o contrato de compra da cota e o extrato ou os comprovantes',
    'de pagamento. Se não tiver, tudo bem.',
    '',
    ...(urlSim
      ? ['Nos avise se estará por lá, é um clique:',
         `Confirmo que estarei: ${urlSim}`,
         `Preciso remarcar: ${urlRemarcar || WHATS_LINK}`]
      : [`Não vai conseguir? Avise pelo WhatsApp ${WHATS_NUMERO} e a gente remarca:`,
         WHATS_LINK]),
    '',
    'Até logo,',
    'Conforto, Bergonsi & Cavalari Advogados',
  ].join('\n');

  return { assunto, html, texto };
}
