// (16/10/2026) Resumo automatico da videochamada de venda pelo Claude.
//
// Modulo PURO (sem rede, sem Supabase): instrucoes ao modelo, formato exigido da resposta
// (JSON Schema para structured outputs), normalizacao do que volta, texto da nota do Kommo
// e estimativa de custo. A function `call-resumo-worker-background.mjs` so orquestra.
// Padrao do projeto: decisao testavel em _lib/, function so faz rede
// (ver utils/__tests__/callResumo.test.js).
//
// O que NUNCA muda sem falar com o Paulo:
//  - nada aqui fala com o cliente: a nota vai para o lead do Kommo (equipe) e os alertas
//    ficam no banco/Monitor;
//  - o modelo nao inventa: campo que nao aparece na conversa volta null.

export const MODELO_PADRAO = 'claude-opus-5-5';

// US$ por milhao de tokens (entrada, saida) — tabela de 06/10/2026. So para a estimativa
// gravada em call_resumos.custo_usd; a fatura real e a do console da Anthropic.
export const PRECOS = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.10, 0.50],
};

// Transcricao muito longa costuma ser call que ficou aberta sem ninguem (ou duas calls
// no mesmo link). Nao cortamos em silencio: a linha fica marcada para conferencia humana.
export const MAX_CARACTERES = 300_000;
// Abaixo disto nao houve conversa de verdade (cliente entrou e saiu, so a vendedora falou).
export const MIN_CARACTERES = 1_500;

export const SISTEMA = `Voce trabalha no escritorio CBC Advogados (Conforto, Bergonsi & Cavalari), especializado em acoes de rescisao e revisao de contratos de multipropriedade (time-sharing) de resorts.

Voce recebe a transcricao automatica de uma videochamada do Google Meet entre uma vendedora do escritorio e um potencial cliente. Sua tarefa e preencher a ficha do atendimento para a equipe, no formato JSON pedido.

Regras:
- Use somente o que foi dito na conversa. Se um dado nao aparece, devolva null (ou lista vazia). Nunca estime nem complete com suposicao.
- Quando o cliente falar de forma vaga ("umas 30 parcelas", "uns 60 mil"), preencha o numero e registre o campo em "incertezas".
- A transcricao automatica erra nomes e numeros. Se um valor parecer impossivel ou contraditorio, prefira null e explique em "incertezas".
- Datas relativas ("sexta", "semana que vem") devem virar data AAAA-MM-DD usando a data da chamada informada.
- Valores em reais como numero (68000, nao "R$ 68 mil").
- "houve_atendimento" e false quando a transcricao nao e uma conversa de venda com o cliente (so a vendedora falando, teste, reuniao interna, cliente que entrou e saiu).
- Tipos de acao usados pelo escritorio, para "tipo_acao_sugerido": Cancelamento de contrato, Distrato por atraso, Devolucao 80%, Devolucao 50%, Revisao de Distrato, Cota quitada sem matricula, Acao de cobranca, Dano moral, Outros. Sugira apenas se a conversa der base; e uma sugestao para a equipe, nao uma decisao.

Alertas (lista "alertas"), escritos para a gestao do escritorio:
- "compliance": a vendedora prometeu ou garantiu resultado ("a gente garante", "voce vai receber tudo"), deu informacao juridica claramente errada, pressionou o cliente de forma abusiva ou combinou algo fora do padrao (desconto, prazo, condicao especial). Copie o trecho exato em "trecho". O Codigo de Etica da OAB veda promessa de resultado.
- "risco_perda": sinal concreto de que o cliente pode desistir ou fechar com outro (resort oferecendo acordo, outro advogado, prazo correndo).
- "outro": qualquer ponto que a gestao precisa saber e nao cabe acima.
Nao gere alerta por cortesia; lista vazia e um resultado normal.

"nota_kommo": texto curto (ate 900 caracteres) para a nota do lead no CRM, lido pela equipe comercial. Comece com o essencial do caso, depois objecoes e por fim o proximo passo com data. Sem CPF, RG, e-mail, telefone ou endereco. Sem os alertas de compliance (eles vao so para a gestao). Portugues do Brasil, direto, sem floreio.`;

const strOuNull = { type: ['string', 'null'] };
const numOuNull = { type: ['number', 'null'] };
const intOuNull = { type: ['integer', 'null'] };
const boolOuNull = { type: ['boolean', 'null'] };
const listaTexto = { type: 'array', items: { type: 'string' } };

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['houve_atendimento', 'resumo_curto', 'dados', 'incertezas', 'temperatura', 'objecoes',
    'proximo_passo', 'documentos_pendentes', 'perguntas_nao_feitas', 'alertas', 'nota_kommo'],
  properties: {
    houve_atendimento: { type: 'boolean' },
    resumo_curto: { type: 'string', description: '2 a 4 frases sobre o caso e o desfecho da chamada' },
    dados: {
      type: 'object',
      additionalProperties: false,
      required: ['resort', 'cidade_resort', 'ano_compra', 'valor_contrato', 'valor_parcela', 'num_parcelas',
        'parcelas_pagas', 'valor_pago_estimado', 'situacao_pagamento', 'ja_tentou_distrato',
        'proposta_do_resort', 'qtd_titulares', 'titulares_ausentes', 'tipo_acao_sugerido',
        'honorarios_apresentados'],
      properties: {
        resort: strOuNull,
        cidade_resort: strOuNull,
        ano_compra: intOuNull,
        valor_contrato: numOuNull,
        valor_parcela: numOuNull,
        num_parcelas: intOuNull,
        parcelas_pagas: intOuNull,
        valor_pago_estimado: numOuNull,
        situacao_pagamento: { type: 'string', enum: ['em_dia', 'inadimplente', 'quitado', 'nao_informado'] },
        ja_tentou_distrato: boolOuNull,
        proposta_do_resort: { ...strOuNull, description: 'oferta que o resort fez ao cliente, se houver' },
        qtd_titulares: intOuNull,
        titulares_ausentes: { ...strOuNull, description: 'quem mais assina o contrato e nao participou' },
        tipo_acao_sugerido: strOuNull,
        honorarios_apresentados: { ...strOuNull, description: 'como a vendedora apresentou os honorarios' },
      },
    },
    incertezas: { ...listaTexto, description: 'campos preenchidos com informacao vaga ou duvidosa, e por que' },
    temperatura: { type: 'string', enum: ['quente', 'morna', 'fria'] },
    objecoes: listaTexto,
    proximo_passo: {
      type: 'object',
      additionalProperties: false,
      required: ['descricao', 'responsavel', 'prazo'],
      properties: {
        descricao: { type: 'string' },
        responsavel: { type: 'string', enum: ['cliente', 'vendedora', 'escritorio', 'indefinido'] },
        prazo: { ...strOuNull, description: 'AAAA-MM-DD' },
      },
    },
    documentos_pendentes: listaTexto,
    perguntas_nao_feitas: { ...listaTexto, description: 'informacoes importantes para o caso que a vendedora nao perguntou' },
    alertas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'gravidade', 'descricao', 'trecho'],
        properties: {
          tipo: { type: 'string', enum: ['compliance', 'risco_perda', 'outro'] },
          gravidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          descricao: { type: 'string' },
          trecho: strOuNull,
        },
      },
    },
    nota_kommo: { type: 'string' },
  },
};

const DIAS = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];

/** Data da chamada em BRT (AAAA-MM-DD + dia da semana), para o modelo resolver "sexta". */
export function dataDaChamada(scheduledAtIso) {
  const d = new Date(scheduledAtIso);
  if (Number.isNaN(d.getTime())) return null;
  const brt = new Date(d.getTime() - 3 * 3600e3); // Brasil sem horario de verao (ver _lib/dataBrt.mjs)
  return { iso: brt.toISOString().slice(0, 10), diaSemana: DIAS[brt.getUTCDay()] };
}

/** Avalia se a transcricao serve para resumo. Retorna null se sim, ou o motivo para pular. */
export function motivoParaPular(texto) {
  const n = (texto || '').trim().length;
  if (n < MIN_CARACTERES) return 'transcricao_curta';
  if (n > MAX_CARACTERES) return 'transcricao_longa';
  return null;
}

/** Mensagem do usuario: contexto da chamada + transcricao. */
export function montarPedido({ vendedora, clienteNome, scheduledAt }, transcricao) {
  const data = dataDaChamada(scheduledAt);
  const cab = [
    'Dados da chamada:',
    `- Data: ${data ? `${data.iso} (${data.diaSemana})` : 'desconhecida'}`,
    `- Vendedora: ${vendedora || 'desconhecida'}`,
    `- Cliente (nome no convite da agenda): ${clienteNome || 'desconhecido'}`,
  ].join('\n');
  return `${cab}\n\n<transcricao>\n${transcricao.trim()}\n</transcricao>`;
}

const TEMPERATURAS = new Set(['quente', 'morna', 'fria']);

/**
 * Confere o que o modelo devolveu. Structured outputs ja garante o formato; isto protege
 * contra o caso em que a resposta nao veio (recusa, corte por max_tokens) e corta excessos.
 */
export function validarResumo(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('resposta vazia');
  if (typeof obj.houve_atendimento !== 'boolean') throw new Error('houve_atendimento ausente');
  if (!obj.dados || typeof obj.dados !== 'object') throw new Error('dados ausentes');
  if (!TEMPERATURAS.has(obj.temperatura)) throw new Error(`temperatura invalida: ${obj.temperatura}`);
  if (typeof obj.nota_kommo !== 'string') throw new Error('nota_kommo ausente');
  return {
    ...obj,
    nota_kommo: obj.nota_kommo.trim().slice(0, 1500),
    alertas: Array.isArray(obj.alertas) ? obj.alertas : [],
  };
}

/** Marcador da nota no Kommo: um por videochamada, garante que nunca duplica. */
export function marcadorKommo(eventId) {
  return `CBC.call:${eventId}`;
}

/** Texto final da nota (o kommo-note acrescenta o marcador no fim). */
export function textoNotaKommo(resumo, { vendedora, scheduledAt }) {
  const data = dataDaChamada(scheduledAt);
  const dataBr = data ? data.iso.split('-').reverse().join('/') : '';
  const quem = (vendedora || '').split('@')[0];
  const cab = `📞 Videochamada${dataBr ? ` ${dataBr}` : ''}${quem ? ` (${quem})` : ''}, resumo automático`;
  return `${cab}\n\n${resumo.nota_kommo}`;
}

/** Alertas que vao para a gestao (log do Monitor). */
export function alertasGestao(resumo) {
  return (resumo.alertas || []).filter((a) => a.tipo === 'compliance' || a.gravidade === 'alta');
}

/** Estimativa em US$ a partir do usage da resposta. */
export function custoUsd(usage, modelo) {
  const p = PRECOS[modelo];
  if (!p || !usage) return null;
  const entrada = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25
    + (usage.cache_read_input_tokens || 0) * 0.1;
  const saida = usage.output_tokens || 0;
  return Math.round(((entrada * p[0] + saida * p[1]) / 1e6) * 10000) / 10000;
}
