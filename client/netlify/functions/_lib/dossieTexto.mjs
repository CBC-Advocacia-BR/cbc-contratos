/**
 * Assunto e corpo do e-mail que acompanha o dossie. Modulo PURO.
 *
 * TRES ESCOLHAS DE CONTEUDO, e o porque de cada uma:
 *  1. o corpo REPETE o essencial do anexo (duracao, que nao precisa decidir nada,
 *     o que ajuda ter em maos): anexo de 4,5 MB muita gente nao abre no celular;
 *  2. o bloco "nossos dados" existe so para desarmar a objecao de golpe, que e o
 *     objetivo numero um do material, e e justamente o que falta no PDF do Canva
 *     (que nao traz o endereco do escritorio em pagina nenhuma);
 *  3. sem travessao em lugar nenhum (REGRA #6 do CLAUDE.md).
 *
 * O Responder-para vai na VENDEDORA: nao a poe como destinataria, mas faz a
 * resposta do lead chegar em quem vai atende-lo, em vez de morrer numa caixa
 * institucional. Trocavel por bot_config.dossie_videochamada.responder_para.
 *
 * Assunto sobrescrivel por bot_config, sem deploy.
 */
import { escapeHtml } from './validate.mjs';

const ESCRITORIO = 'Conforto, Bergonsi &amp; Cavalari Advogados';
const OAB = 'OAB/SP 55.227';
const CNPJ = '56.096.172/0001-65';
const ENDERECO = 'Rua Guatemala, 122, Jardim Santo Antônio, Americana/SP, CEP 13465-761';

const preencher = (modelo, vars) =>
  String(modelo).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));

/**
 * @param {{nome: string|null, quando: object, vendedoraEmail: string, config: object}} p
 *   `quando` e o retorno de quandoPorExtenso()
 * @returns {{assunto: string, html: string, texto: string, responderPara: string}}
 */
export function montarEmail({ nome, quando, vendedoraEmail, config = {} }) {
  const vars = {
    primeiro_nome: nome || '',
    dia_semana: quando.diaSemana,
    data_curta: quando.dataCurta,
    data_extenso: quando.dataExtenso,
    hora: quando.hora,
  };

  const assunto = preencher(
    config.assunto || 'Sua videochamada de {{dia_semana}} ({{data_curta}}), às {{hora}}',
    vars,
  ).trim();

  const saudacao = nome ? `Olá, ${escapeHtml(nome)}.` : 'Olá!';

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:600px">
  <p style="margin:0 0 16px">${saudacao}</p>

  <p style="margin:0 0 16px">Sua videochamada com o nosso escritório está confirmada para
    <strong>${quando.diaSemana}, ${quando.dataExtenso}, às ${quando.hora}</strong>.
    O link já está no convite que chegou na sua agenda.</p>

  <p style="margin:0 0 16px">Enviamos este e-mail para que você chegue à conversa sabendo com
    quem está falando. Em anexo vai uma apresentação do escritório: quem somos, os sócios,
    como conduzimos um caso do início ao fim e como funciona a videochamada.</p>

  <p style="margin:0 0 8px"><strong>Sobre a conversa</strong></p>
  <p style="margin:0 0 16px">Dura cerca de 30 minutos e serve para entendermos a sua situação.
    Você não precisa decidir nada durante a chamada. Se puder, tenha em mãos o contrato de
    compra da cota e o extrato ou os comprovantes de pagamento. Se não tiver, tudo bem: a
    conversa acontece do mesmo jeito.</p>

  <p style="margin:0 0 8px"><strong>Nossos dados, se quiser conferir</strong></p>
  <p style="margin:0 0 16px;color:#4b5563">Conforto, Bergonsi &amp; Cavalari Sociedade de
    Advogados, ${OAB}, CNPJ ${CNPJ}.<br>${ENDERECO}.<br>
    Inscrição consultável no site da OAB/SP e em confortobergonsi.com.br.</p>

  <p style="margin:0 0 16px">Se precisar remarcar, é só responder este e-mail.</p>

  <p style="margin:0 0 4px">Até ${quando.diaSemana},</p>
  <p style="margin:0 0 24px"><strong>${ESCRITORIO}</strong></p>

  <p style="margin:0;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px">
    Você recebeu esta mensagem porque agendou uma videochamada com o escritório. É informativa
    e não constitui oferta de serviço nem parecer jurídico.</p>
</div>`;

  const texto = [
    nome ? `Olá, ${nome}.` : 'Olá!',
    '',
    `Sua videochamada com o nosso escritório está confirmada para ${quando.texto}.`,
    'O link já está no convite que chegou na sua agenda.',
    '',
    'Enviamos este e-mail para que você chegue à conversa sabendo com quem está falando.',
    'Em anexo vai uma apresentação do escritório.',
    '',
    'Sobre a conversa: dura cerca de 30 minutos e serve para entendermos a sua situação.',
    'Você não precisa decidir nada durante a chamada. Se puder, tenha em mãos o contrato de',
    'compra da cota e o extrato ou os comprovantes de pagamento. Se não tiver, tudo bem.',
    '',
    'Nossos dados, se quiser conferir:',
    `Conforto, Bergonsi & Cavalari Sociedade de Advogados, ${OAB}, CNPJ ${CNPJ}.`,
    `${ENDERECO}.`,
    '',
    'Se precisar remarcar, é só responder este e-mail.',
    '',
    `Até ${quando.diaSemana},`,
    'Conforto, Bergonsi & Cavalari Advogados',
  ].join('\n');

  return { assunto, html, texto, responderPara: vendedoraEmail };
}
