/**
 * Regras do envio do dossie: quem recebe e como a data e escrita. Modulo PURO.
 * O texto do e-mail fica em dossieTexto.mjs, para separar decisao de copy.
 */

const INTERNO = /@advocaciacbc\.com$/i;
// Maiuscula por decisao do Paulo (12/08/2026), olhando as amostras: na capa o dia
// abre a linha de destaque, e "quinta-feira" em caixa baixa ali fica com cara de
// texto solto. Vale para todos os usos (capa, assunto e corpo), para o material
// nao falar duas linguas.
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
              'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
               'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Decide se esta linha da agenda deve receber o dossie AGORA.
 *
 * A ordem das checagens importa para o log: o motivo devolvido e o PRIMEIRO que
 * barrou, e os mais informativos ("sem_corte", "ja_enviado") vem antes dos mais
 * banais, para o painel nao ficar cheio de "status_nao_agendada" quando na verdade
 * a automacao inteira esta desligada.
 *
 * @returns {{ok: boolean, motivo: string|null}} motivo e um codigo estavel, para log
 */
export function elegivel(linha, config, agora = new Date()) {
  if (!config?.ativo) return { ok: false, motivo: 'desligado' };

  // Sem corte configurado o padrao e NAO enviar. O contrario transformaria um
  // deploy distraido em milhares de e-mails para gente cuja videochamada ja
  // aconteceu semanas atras.
  if (!config.corte_em) return { ok: false, motivo: 'sem_corte' };

  if (linha.dossie_email_em) return { ok: false, motivo: 'ja_enviado' };

  const tentativas = Number(linha.dossie_email_tentativas || 0);
  if (tentativas >= Number(config.max_tentativas || 3)) {
    return { ok: false, motivo: 'tentativas_esgotadas' };
  }

  const visto = linha.primeiro_visto_em ? new Date(linha.primeiro_visto_em) : null;
  if (!visto || visto < new Date(config.corte_em)) {
    return { ok: false, motivo: 'anterior_ao_corte' };
  }

  if (linha.status !== 'agendada') return { ok: false, motivo: 'status_nao_agendada' };

  const quando = linha.scheduled_at ? new Date(linha.scheduled_at) : null;
  if (!quando || quando <= agora) return { ok: false, motivo: 'ja_passou' };

  const email = String(linha.cliente_email || '').trim();
  if (!email) return { ok: false, motivo: 'sem_email' };
  if (INTERNO.test(email)) return { ok: false, motivo: 'email_interno' };

  return { ok: true, motivo: null };
}

/**
 * Estamos em horario civilizado para mandar e-mail?
 *
 * ⚠️ Descoberto na hora de ligar a recuperacao: o worker roda de 15 em 15 minutos,
 * 24 horas por dia, entao os 8 e-mails de recuperacao pendentes sairiam as 3 da
 * manha. E-mail de escritorio chegando de madrugada parece spam, e o material
 * inteiro existe para o escritorio parecer serio.
 *
 * Vale para lembrete e recuperacao. NAO vale para o PDF de apresentacao: aquele
 * sai logo apos o agendamento, e o agendamento so acontece em horario comercial.
 *
 * @param {Date} agora
 * @param {number} inicio hora BRT a partir da qual pode enviar (padrao 7)
 * @param {number} fim    hora BRT ate a qual pode enviar, exclusiva (padrao 20)
 */
export function horarioCivilizado(agora = new Date(), inicio = 7, fim = 20) {
  const hora = Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false,
  }).format(agora)) % 24;
  return hora >= inicio && hora < fim;
}

/**
 * Data e hora por extenso, SEMPRE no horario de Brasilia.
 *
 * REGRA #11 do projeto: o runtime das functions e UTC, e uma chamada as 21h30 BRT
 * ja e o dia seguinte em UTC. Escrever "sexta" numa chamada que o cliente tem na
 * quinta e o erro classico deste projeto (auditoria de datas de 31/07/2026, 27
 * ocorrencias corrigidas). Aqui o fuso e resolvido pelo Intl, que entende
 * calendario, e nao por subtracao de 3 horas.
 *
 * @param {string} iso instante em ISO (o scheduled_at da agenda)
 * @returns {{diaSemana: string, dataExtenso: string, dataCurta: string, hora: string, texto: string}}
 */
export function quandoPorExtenso(iso) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});

  const dia = Number(partes.day);
  const hora24 = Number(partes.hour) % 24;   // algumas implementacoes devolvem 24 na meia-noite
  const minuto = Number(partes.minute);

  // o indice do dia da semana sai de uma data ancorada ao MEIO-DIA BRT, para a
  // hora nunca empurrar o calculo para o dia vizinho
  const ancora = new Date(`${partes.year}-${partes.month}-${partes.day}T12:00:00-03:00`);
  const diaSemana = DIAS[ancora.getUTCDay()];

  const hora = minuto === 0 ? `${hora24}h` : `${hora24}h${String(minuto).padStart(2, '0')}`;
  const dataExtenso = `${dia} de ${MESES[Number(partes.month) - 1]}`;
  const dataCurta = `${String(dia).padStart(2, '0')}/${partes.month}`;

  return {
    diaSemana, dataExtenso, dataCurta, hora,
    texto: `${diaSemana}, ${dataExtenso}, às ${hora}`,
  };
}
