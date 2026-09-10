// Intérprete IA da Ana. LLM NUNCA fala com o lead — só devolve JSON p/ o engine.
// Padrão de chamada Anthropic: fetch direto (igual botEngine.mjs). STT: Groq ou OpenAI.
const INTENCOES = ['responde_qualificacao','aceita_slot','propoe_horario','recusa','pergunta_preco','pede_humano','saudacao','outro'];

export function montarPromptInterprete({ mensagem, estado, agoraISO }) {
  const system = [
    'Você extrai dados de mensagens de WhatsApp de leads de um escritório de advocacia especializado em distrato (cancelamento) de cotas de multipropriedade/timeshare de resorts.',
    'Responda APENAS com a chamada da tool `interpretacao` (JSON). Nunca escreva texto livre.',
    'Regras: horario_proposto sempre ISO-8601 com offset -03:00 interpretando expressões relativas a AGORA;',
    'horario_aceito_idx é o índice (0-based) do slot ofertado que o lead aceitou, se aceitou;',
    'valor_aprox é a string como o lead disse (ex.: "uns 20 mil"); situacao é "pagando" ou "quitado";',
    'confianca (0-1) reflete sua certeza global. Se a mensagem for ambígua/fora do domínio, intencao="outro" e confianca baixa.',
  ].join('\n');
  const user = JSON.stringify({
    agora: agoraISO,
    etapa_da_conversa: estado.etapa,
    dados_ja_coletados: estado.dados,
    slots_ofertados: (estado.slots_ofertados || []).map((s, i) => ({ idx: i, inicio: s.inicio })),
    mensagem_do_lead: mensagem,
  });
  return { system, user };
}

const TOOL_INTERPRETACAO = {
  name: 'interpretacao', description: 'Interpretação estruturada da mensagem do lead',
  input_schema: { type: 'object', additionalProperties: false, required: ['intencao', 'confianca'],
    properties: {
      intencao: { type: 'string', enum: INTENCOES },
      resort: { type: ['string', 'null'] }, situacao: { type: ['string', 'null'], enum: ['pagando', 'quitado', null] },
      valor_aprox: { type: ['string', 'null'] },
      horario_aceito_idx: { type: ['integer', 'null'] }, horario_proposto: { type: ['string', 'null'] },
      pede_humano: { type: 'boolean' }, pergunta_preco: { type: 'boolean' },
      confianca: { type: 'number' },
    } },
};

export function validarInterpretacao(o) {
  if (!o || !INTENCOES.includes(o.intencao)) return null;
  const iso = (s) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : null);
  return {
    intencao: o.intencao,
    resort: typeof o.resort === 'string' && o.resort.trim() ? o.resort.trim() : null,
    situacao: o.situacao === 'pagando' || o.situacao === 'quitado' ? o.situacao : null,
    valor_aprox: typeof o.valor_aprox === 'string' && o.valor_aprox.trim() ? o.valor_aprox.trim() : null,
    horario_aceito_idx: Number.isInteger(o.horario_aceito_idx) && o.horario_aceito_idx >= 0 ? o.horario_aceito_idx : null,
    horario_proposto: iso(o.horario_proposto),
    pede_humano: !!o.pede_humano, pergunta_preco: !!o.pergunta_preco,
    confianca: Math.max(0, Math.min(1, Number(o.confianca) || 0)),
  };
}

export async function interpretar({ mensagem, estado, cfg }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { intencao: 'outro', confianca: 0, erro: 'sem_ANTHROPIC_API_KEY' };
  const { system, user } = montarPromptInterprete({ mensagem, estado, agoraISO: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T') + '-03:00' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: cfg.llm?.modelo || 'claude-sonnet-5', max_tokens: cfg.llm?.max_tokens || 700,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [{ ...TOOL_INTERPRETACAO, strict: true }],
        tool_choice: { type: 'tool', name: 'interpretacao' },
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json();
    if (!r.ok) return { intencao: 'outro', confianca: 0, erro: `anthropic_${r.status}:${JSON.stringify(j?.error || '').slice(0, 120)}` };
    const tu = (j.content || []).find((b) => b.type === 'tool_use');
    const v = validarInterpretacao(tu?.input);
    return v || { intencao: 'outro', confianca: 0, erro: 'parse' };
  } catch (e) { return { intencao: 'outro', confianca: 0, erro: e.message }; }
}

export async function transcrever({ url, cfg }) {
  try {
    const audio = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!audio.ok) return { erro: `download_${audio.status}` };
    const blob = await audio.blob();
    if (blob.size > 25 * 1024 * 1024) return { erro: 'muito_grande' };
    const groq = cfg.stt?.provedor !== 'openai' && process.env.GROQ_API_KEY;
    const endpoint = groq ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
    const key = groq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
    if (!key) return { erro: 'sem_chave_stt' };
    const fd = new FormData();
    fd.append('file', blob, 'audio.ogg');
    fd.append('model', cfg.stt?.modelo || (groq ? 'whisper-large-v3-turbo' : 'whisper-1'));
    fd.append('language', 'pt');
    const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    if (!r.ok) return { erro: `stt_${r.status}:${JSON.stringify(j?.error || '').slice(0, 120)}` };
    return { texto: (j.text || '').trim() };
  } catch (e) { return { erro: e.message }; }
}
