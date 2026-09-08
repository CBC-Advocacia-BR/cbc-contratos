// Tags do Kommo que a Ana aplica no lead a partir da qualificacao (resort + situacao da cota).
// Regra do Paulo (08/09/2026): usar SOMENTE tags que ja existem no Kommo, nunca criar.
// PURO (testado em src/utils/__tests__/sdrTags.test.js). A parte de rede fica em sdrFerramentas.
//
// TAGS_RESORT_PREFERIDAS = tags de resort realmente usadas nos funis SDR/Venda/Repescagem
// (levantamento de 1.209 leads em 08/09/2026). O Kommo tem ~1.270 tags, a maioria lixo
// (combinacoes "BRENDA-Ondas Praia", grafias quebradas): sem esta lista o casamento por nome
// cairia em variante errada. A busca ao vivo (GET /leads/tags?query=) so complementa.
export const TAGS_RESORT_PREFERIDAS = {
  54358: 'SOLAR DAS ÁGUAS', 54530: 'ONDAS PRAIA', 57194: 'OLIMPIA PARK RESORT', 86218: 'Salinas Beach Resort',
  54522: 'HOT BEACH', 54638: 'HOT BEACH YOU', 57756: 'PORTO 2 LIFE', 54366: 'THERMAS DE SÃO PEDRO',
  54608: 'PRAIAS DO LAGO', 54636: 'ILHAS DO LAGO', 58248: 'RESORT DO LAGO', 54760: 'BARRETOS COUNTRY CLUB',
  63980: 'LONG BEACH', 54682: 'ROYAL PRIME', 85584: 'AQUALAND', 54654: 'HARD ROCK', 54606: 'ROYAL STAR',
  66826: 'KAWANA', 57058: 'MY MABU', 159856: 'GOLDEN LAGHETTO', 54446: 'GRAN PARADISO', 54684: 'PORTO ALTO',
  126372: 'JERIQUIÁ LAGOA RESORT', 54400: 'OHANA BEACH PARK', 83730: 'GRAMADO PARKS', 57632: 'LAGOA ECO TOWER',
  54604: 'IPIOCA BEACH', 54678: 'ENCONTRO DAS AGUAS', 85898: 'WYNDHAM', 86464: 'Golden Dolphin', 86294: 'GRAN VALLEY',
  61456: 'OIKOS MARAGOGI', 61170: 'GAV MURO ALTO', 58080: 'ALTA VISTA THERMAS', 98272: 'SALINAS PREMIUM',
  200038: 'CASTELOS DO VALE', 86166: 'Solar Pedra da Ilha', 60796: 'MARINA FLAT E NÁUTICA', 86078: 'RIO QUENTE RESORT',
  57182: 'LAGHETTO', 85034: 'MAGIC CITY', 54632: 'GOLDEN TULIP CANELA', 85684: 'GAV GRAN GARDEN', 55556: 'VARANDAS',
  85836: 'Centrinho dos Ingleses', 55604: 'CHINA PARK', 85822: 'Piramide Resort', 202446: 'GRAN RESORT MARAGOGI',
  57928: 'GRANDES LAGOS', 61068: 'BEACH PARK', 85868: 'ATRIUM THERMAS', 86756: 'Amazon', 87052: 'Exclusive Salinas',
  85656: 'Royal Prime Thermas', 57920: 'REFÚGIO DAS LONTRAS', 57184: 'TERRA NOVA', 86742: 'Bella Gramando',
  85596: 'BRAVA MUNDO', 86216: 'HOTEL STILO BORGES', 98270: 'GOLDEN VILLAGIO', 215460: 'EXCLUSIVE RESORT',
};

// Situacao da cota -> tag existente. 'QUITADO' (54550) e 'ATRASO' (54692) sao as que a equipe
// usa de fato (117 e 9 leads); 'Está pagando' (159824) existe e e a unica que descreve quem paga.
export const TAG_SITUACAO = { pagando: 159824, quitada: 54550, parou_de_pagar: 54692 };
export const TAGS_SITUACAO_IDS = Object.values(TAG_SITUACAO);

const RUIDO = new Set(['RESORT', 'RESORTS', 'HOTEL', 'HOTEIS', 'EMPREENDIMENTO', 'COTA', 'DO', 'DA', 'DE', 'DOS', 'DAS', 'E', 'EM', 'NO', 'NA', 'O', 'A']);

export function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const tokens = (s) => normalizar(s).split(' ').filter((t) => t.length >= 2 && !RUIDO.has(t));

/** Palavra-chave p/ a busca ao vivo no Kommo (1o token significativo, ex.: "ONDAS", "SOLAR", "HOT"). */
export function palavraChave(nomeResort) {
  const t = tokens(nomeResort);
  return t.length ? t[0] : null;
}

/**
 * Escolhe a tag de resort que melhor casa com o que o lead disse. candidatos: [{id, name}].
 * Devolve {id, name, score} ou null (score < 60 = nao arrisca: tag errada e pior que nenhuma).
 */
export function escolherTagResort(nomeResort, candidatos = []) {
  const n = normalizar(nomeResort);
  const tn = tokens(nomeResort);
  if (!n || !tn.length) return null;
  const vistos = new Set();
  const todos = [...Object.entries(TAGS_RESORT_PREFERIDAS).map(([id, name]) => ({ id: Number(id), name })), ...(candidatos || [])]
    .filter((c) => c && c.id && c.name && !vistos.has(Number(c.id)) && vistos.add(Number(c.id)));
  let melhor = null;
  for (const c of todos) {
    const cn = normalizar(c.name);
    const tc = tokens(c.name);
    if (!cn || !tc.length) continue;
    let score = 0;
    if (cn === n || tc.join(' ') === tn.join(' ')) score = 100;
    else if (tc.every((t) => tn.includes(t)) || tn.every((t) => tc.includes(t))) score = 80 - Math.min(15, Math.abs(tc.length - tn.length) * 5);
    else {
      // casamento parcial so vale quando a PRIMEIRA palavra do lead esta na tag: "ondas em porto"
      // e Ondas Praia, nao Porto Alto (a 1a palavra e a identidade do resort)
      const comuns = tc.filter((t) => tn.includes(t)).length;
      if (comuns && tc.includes(tn[0]) && comuns >= Math.ceil(Math.max(tc.length, tn.length) / 2)) score = 55 + comuns * 5;
    }
    if (!score) continue;
    if (tc[0] === tn[0]) score += 10;
    if (TAGS_RESORT_PREFERIDAS[c.id]) score += 15;
    if (/-/.test(c.name)) score -= 30; // combinacoes "BRENDA-Ondas Praia", "Ondas Praia-Quitado"
    if (/quitad|conjuge|cônjuge|brenda|bruno|cancelamento|acordo/i.test(c.name)) score -= 30;
    if (!melhor || score > melhor.score || (score === melhor.score && c.name.length < melhor.name.length)) melhor = { id: Number(c.id), name: c.name, score };
  }
  return melhor && melhor.score >= 60 ? melhor : null;
}

/** Conjunto final de tags do lead: mantem as atuais, troca a tag de situacao, soma a de resort. */
export function unirTags(atuaisIds = [], { resortId = null, situacaoId = null } = {}) {
  const out = new Set((atuaisIds || []).map(Number).filter(Number.isFinite));
  if (situacaoId) { for (const s of TAGS_SITUACAO_IDS) if (s !== situacaoId) out.delete(s); out.add(Number(situacaoId)); }
  if (resortId) out.add(Number(resortId));
  return [...out].sort((a, b) => a - b);
}
