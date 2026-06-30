/**
 * Motor do Bot ADVBOX — identifica o cliente, classifica a intencao,
 * consulta o ADVBOX e monta a resposta parametrizada.
 * Usado pelo simulador do painel e pelo worker do webhook Kommo.
 */
import * as adv from './advbox.mjs';
import {
  db,
  getConfig, getStageTemplates, getTaskTemplates, getGlossary, getIntents,
  getConversation, upsertConversation, logMessage, getAiCache, setAiCache, updateTester,
  getVisibilityConfig, isHiddenFromClient, getExtrato,
} from './botDb.mjs';

// ---------- helpers ----------
export function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
export function render(template, vars) {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) =>
    (vars[k] === undefined || vars[k] === null) ? '' : String(vars[k]));
}
function fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}
function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function daysSince(iso) {
  const d = new Date(String(iso || '').slice(0, 10));
  return Number.isFinite(d.getTime()) ? Math.floor((Date.now() - d.getTime()) / 86400000) : 9999;
}
function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16) + '_' + s.length;
}
const firstName = (n) => String(n || '').trim().split(/\s+/)[0]
  .toLowerCase().replace(/^./, c => c.toUpperCase());

// (portal-6) frase de retorno do atendimento humano/financeiro sensivel ao relogio.
// Replica a logica de dia util do portal-data.mjs (feriados forenses de Americana/SP,
// fuso America/Sao_Paulo) — versao pequena equivalente, pois la nao e exportada.
const _NOW_SP = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
function _pascoaUTC(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451);
  return Date.UTC(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
const _FERIADOS_FIXOS = new Set(['04-21', '05-01', '06-13', '07-09', '08-27', '09-07', '10-12', '11-02', '11-15', '11-20']);
function _ehFeriado(d) {
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (mmdd >= '12-20' || mmdd <= '01-20') return true; // recesso do Judiciario
  if (_FERIADOS_FIXOS.has(mmdd)) return true;
  const ano = d.getFullYear(), p = _pascoaUTC(ano);
  const dif = Math.round((Date.UTC(ano, d.getMonth(), d.getDate()) - p) / 86400000);
  return dif === -48 || dif === -47 || dif === -2 || dif === 60; // Carnaval, Sexta Santa, Corpus Christi
}
function _ehDiaUtil(d) {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !_ehFeriado(d);
}
// Retorna a frase certa: "ainda hoje" (dia util, horario comercial 9-18h),
// "amanha pela manha" (dia util, antes das 9h) ou "no proximo dia util".
function fraseRetorno() {
  const sp = _NOW_SP();
  if (_ehDiaUtil(sp)) {
    const h = sp.getHours();
    if (h >= 9 && h < 18) return 'Você receberá retorno ainda hoje, em horário comercial.';
    if (h < 9) return 'Você receberá retorno amanhã pela manhã, em horário comercial.';
  }
  // fim de tarde/noite, fim de semana ou feriado -> proximo dia util
  return 'Você receberá retorno no próximo dia útil, em horário comercial.';
}

// ---------- traducao de juridiques ----------
export function glossaryTranslate(title, glossary) {
  const norm = normalize(title);
  for (const g of glossary) {
    const term = normalize(g.term);
    if (!term) continue;
    if (g.match_type === 'exact' && norm === term) return g.translation;
    if (g.match_type === 'regex') {
      try { if (new RegExp(g.term, 'i').test(title)) return g.translation; } catch { /* regex invalida */ }
    }
    if ((g.match_type || 'contains') === 'contains' && norm.includes(term)) return g.translation;
  }
  return null;
}

async function aiTranslate(title, iaCfg) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !iaCfg?.ativa) return null;
  const hash = hashText(normalize(title));
  const cached = await getAiCache(hash);
  if (cached) return cached;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: iaCfg.modelo || 'claude-opus-4-8',
        max_tokens: 300,
        messages: [{ role: 'user', content: `${iaCfg.instrucao || 'Traduza para linguagem simples:'}\n\n"${title.slice(0, 600)}"` }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    if (text) { await setAiCache(hash, title, text); return text; }
  } catch { /* IA indisponivel — segue sem traducao */ }
  return null;
}

export async function translateMovement(title, glossary, iaCfg) {
  const g = glossaryTranslate(title, glossary);
  if (g) return g;
  const ai = await aiTranslate(title, iaCfg);
  return ai || title;
}

// ---------- classificador de intencao ----------
export function classifyIntent(text, intents) {
  const norm = ' ' + normalize(text) + ' ';
  let best = null;
  for (const it of intents) {
    for (const kw of it.keywords || []) {
      const k = normalize(kw);
      if (k && norm.includes(k)) {
        if (!best || it.priority < best.priority) best = it;
        break;
      }
    }
  }
  return best; // null = fallback
}

// ---------- montagem da resposta de andamento ----------
function matchTaskTemplate(item, taskTemplates) {
  const id = item.task_id || item.tasks_id || null;
  if (id) {
    const byId = taskTemplates.find(t => Number(t.task_id) === Number(id));
    if (byId) return byId;
  }
  const name = normalize(item.task || item.task_name || item.title || '');
  return taskTemplates.find(t => name && normalize(t.task_name) === name) || null;
}

export async function buildLawsuitAnswer(lawsuitId, deps) {
  const { cfg, stageTemplates, taskTemplates, glossary, customerName } = deps;
  const tplCfg = cfg.template_andamento || {};
  const geral = cfg.geral || {};
  const ia = cfg.ia || {};

  // Fonte primária = ESPELHO Supabase (rápido, sem rate limit, igual ao portal).
  // ADVBOX ao vivo só como FALLBACK quando o processo ainda não foi sincronizado.
  let lawsuit, movements = [], pending = [], completed = [], stageHidden = false;
  let resumo = null;
  try { ({ data: resumo } = await db.rpc('bot_lawsuit_resumo', { p_lawsuit_id: lawsuitId })); } catch { resumo = null; }
  if (resumo && resumo.lawsuit) {
    lawsuit = resumo.lawsuit;
    movements = resumo.movements || [];
    pending = resumo.pending || [];        // já filtrados p/ o cliente no RPC
    completed = resumo.completed || [];
    const vis = await getVisibilityConfig();
    stageHidden = vis.hiddenStageIds.has(Number(lawsuit.stages_id));
  } else {
    lawsuit = await adv.getLawsuit(lawsuitId);
    if (!lawsuit) return { reply: 'Não consegui localizar os dados deste processo agora. Vou pedir para a equipe verificar e te retornamos em breve!', meta: { erro: 'lawsuit_nao_encontrado' } };
    movements = await adv.getMovements(lawsuitId, 3);
    try { pending = await adv.getHistory(lawsuitId, 'pending'); } catch { /* sem tarefas */ }
    try { completed = await adv.getHistory(lawsuitId, 'completed'); } catch { /* sem tarefas */ }
    const vis = await getVisibilityConfig();
    const taskName = (it) => it.task || it.task_name || it.title || '';
    const taskIdOf = (it) => it.task_id || it.tasks_id || null;
    pending = pending.filter(it => !isHiddenFromClient(taskName(it), taskIdOf(it), vis));
    completed = completed.filter(it => !isHiddenFromClient(taskName(it), taskIdOf(it), vis));
    stageHidden = vis.hiddenStageIds.has(Number(lawsuit.stages_id));
    if (stageHidden) { pending = []; completed = []; }
  }

  // timeline traduzida
  const lines = [];
  for (const mv of movements) {
    const texto = await translateMovement(mv.title || '', glossary, ia);
    lines.push(render(tplCfg.linha_timeline || '• {{data}} — {{texto}}', { data: fmtDate(mv.date), texto }));
  }
  const timeline = lines.length ? lines.join('\n') : '• Ainda não há movimentações registradas pelos tribunais para este processo.';

  // texto parametrizado da fase
  const st = stageTemplates.find(s => Number(s.stages_id) === Number(lawsuit.stages_id));
  const baseVars = {
    cliente: customerName || (lawsuit.customers || [])[0]?.name || '',
    primeiro_nome: firstName(customerName || (lawsuit.customers || [])[0]?.name || ''),
    processo: lawsuit.process_number || lawsuit.protocol_number || `(pasta ${lawsuit.folder || lawsuit.id})`,
    tipo: lawsuit.type || '',
    fase: stageHidden ? 'Em andamento com nossa equipe' : (lawsuit.stage || st?.stage_name || ''),
    advogado: lawsuit.responsible || '',
    data_ultimo_andamento: movements.length ? fmtDate(movements[0].date) : '',
    ultimo_andamento: movements.length ? await translateMovement(movements[0].title || '', glossary, ia) : '',
    timeline,
    prazo_medio: st?.prazo_medio || '',
  };
  const textoFase = st?.template ? render(st.template, baseVars) : '';
  const proximos = st?.proximos_passos
    ? render(st.proximos_passos, baseVars) + (st?.prazo_medio ? `\n⏳ Prazo médio desta fase: ${st.prazo_medio}` : '')
    : '';

  // tarefas: o que o escritorio esta fazendo / fez
  const RECENT_DAYS = 30;
  const pendTexts = [];
  for (const item of pending.slice(0, 5)) {
    const t = matchTaskTemplate(item, taskTemplates);
    pendTexts.push(t?.texto_pendente ? `• ${render(t.texto_pendente, baseVars)}` : `• ${item.task || item.task_name || 'Tarefa interna em andamento'}`);
  }
  const compRecent = completed.filter(c => {
    const when = (c.users || []).map(u => u.completed).find(Boolean) || c.date_deadline || c.date;
    return daysSince(when) <= RECENT_DAYS;
  });
  const compTexts = [];
  for (const item of compRecent.slice(0, 5)) {
    const t = matchTaskTemplate(item, taskTemplates);
    const when = (item.users || []).map(u => u.completed).find(Boolean) || item.date_deadline || item.date;
    compTexts.push(t?.texto_concluida
      ? `• ${render(t.texto_concluida, baseVars)} (${fmtDate(when)})`
      : `• ${item.task || item.task_name || 'Tarefa'} — concluída em ${fmtDate(when)}`);
  }
  let emAndamento = '';
  if (compTexts.length) emAndamento += (tplCfg.titulo_concluidas || '✅ *O que já fizemos recentemente:*\n') + compTexts.join('\n') + '\n\n';
  if (pendTexts.length) emAndamento += (tplCfg.titulo_em_andamento || '🛠 *O que estamos fazendo agora:*\n') + pendTexts.join('\n') + '\n\n';

  let reply = render(tplCfg.corpo || '{{timeline}}', { ...baseVars, texto_fase: textoFase, em_andamento: emAndamento, proximos_passos: proximos })
    .replace(/\n{3,}/g, '\n\n').trim();

  // sem novidade ha muito tempo -> mensagem que acalma
  if (movements.length && daysSince(movements[0].date) > 15 && geral.sem_novidade) {
    reply += '\n\n' + render(geral.sem_novidade, baseVars);
  }

  return { reply, lawsuit, meta: { lawsuit_id: lawsuit.id, fase: baseVars.fase, movs: movements.length } };
}

async function buildAudienciaAnswer(lawsuitId, deps) {
  let pending = [];
  try { pending = await adv.getHistory(lawsuitId, 'pending'); } catch { /* ignora */ }
  const isAud = (s) => /audi[e]ncia|peri[c]ia|julgamento|sessao/.test(normalize(s));
  const future = pending.filter(p => isAud(p.task || p.task_name || '') || p.local);
  if (!future.length) {
    return { reply: 'No momento não há audiência ou perícia marcada no seu processo. Assim que alguma data for definida, você será avisado(a) com antecedência e com todas as orientações. 📅' };
  }
  const lines = future.slice(0, 3).map(p => {
    const when = p.start_date || p.date || p.date_deadline;
    const hora = p.start_time ? ` às ${p.start_time}` : '';
    const local = p.local ? `\n   📍 ${p.local}` : '';
    return `• *${p.task || p.task_name || 'Compromisso'}* — ${fmtDate(when)}${hora}${local}`;
  });
  return { reply: `📅 Encontrei o(s) seguinte(s) compromisso(s) no seu processo:\n\n${lines.join('\n')}\n\nMais perto da data entraremos em contato com todas as orientações. Qualquer dúvida, é só chamar!` };
}

async function buildTarefasAnswer(lawsuitId, deps) {
  const r = await buildLawsuitAnswer(lawsuitId, deps);
  return r; // a resposta de andamento ja inclui as secoes de tarefas
}

// ---------- lista de processos (multi-processo) ----------
async function listLawsuitsForChoice(customer, deps) {
  const raw = (customer.lawsuits || []).slice(0, 5);
  const options = [];
  for (let i = 0; i < raw.length; i++) {
    const ls = await adv.getLawsuit(raw[i].lawsuit_id || raw[i].id).catch(() => null);
    const num = raw[i].process_number || ls?.process_number || `pasta ${ls?.folder || raw[i].lawsuit_id}`;
    const extra = ls ? ` (${[ls.type, ls.stage].filter(Boolean).join(' — ')})` : '';
    options.push({ lawsuit_id: raw[i].lawsuit_id || raw[i].id, label: `${i + 1}️⃣ ${num}${extra}` });
  }
  return options;
}

// ---------- menu financeiro (#18): 2ª via, PIX, parcelas, humano ----------
async function respostaFinanceira(opcao, { conversation, channel, log, vars, intentKey }) {
  const limpa = { ...(conversation.context || {}) };
  delete limpa.awaiting;
  await upsertConversation(channel, { context: limpa });

  if (opcao === '4') {
    // (portal-6) retorno sensivel a hora/dia util (era fixo "ainda hoje")
    const reply = `Claro${vars.primeiro_nome ? ', ' + vars.primeiro_nome : ''}! Vou te conectar com nossa equipe financeira — eles podem emitir boletos, ajustar datas e conversar sobre renegociação. ${fraseRetorno()} 💛`;
    await upsertConversation(channel, { escalated: true });
    await log(reply, intentKey, { escalate: true, financeiro: true });
    return { reply, intent: intentKey, escalate: true, conversation };
  }

  const ext = await getExtrato(conversation.customer_id);
  let reply;
  if (!ext || (!ext.qtd_pagos && !ext.qtd_pendentes)) {
    reply = `${vars.primeiro_nome ? vars.primeiro_nome + ', n' : 'N'}ão localizei cobranças no seu CPF aqui no nosso financeiro. Se você acredita que isso é um engano, responda *4* que eu encaminho para a equipe verificar! 💛`;
  } else if (opcao === '1') {
    const p = ext.proxima;
    reply = p?.boleto_url
      ? `📄 *2ª via do boleto* — R$ ${fmtMoney(p.valor)}, vence ${fmtDate(p.vencimento)}${p.atrasada ? ' (em atraso)' : ''}${p.parcela ? ` · parcela ${p.parcela}` : ''}:\n\n${p.boleto_url}\n\nSe preferir pagar por PIX, responda *2*. 😊`
      : `Você não tem nenhuma parcela em aberto no momento — tudo em dia! ✅`;
  } else if (opcao === '2') {
    const p = ext.proxima;
    reply = p?.pix
      ? `💠 *PIX copia-e-cola da ${p.parcela ? `parcela ${p.parcela}` : 'próxima parcela'}* — R$ ${fmtMoney(p.valor)} (vence ${fmtDate(p.vencimento)}${p.atrasada ? ' — em atraso' : ''}):\n\n${p.pix}\n\nÉ só copiar o código acima e colar no app do seu banco, na opção *Pix → Pix copia e cola*. Qualquer dúvida, me chame!`
      : `Não encontrei um código PIX disponível agora. Responda *1* para a 2ª via do boleto ou *4* para falar com o financeiro. 😊`;
  } else { // '3' parcelas
    const linhas = [`💰 *Suas parcelas:*`];
    if (ext.qtd_pendentes) linhas.push(`📌 Faltam *${ext.qtd_pendentes}* parcela${ext.qtd_pendentes > 1 ? 's' : ''} — total de *R$ ${fmtMoney(ext.total_pendente)}*`);
    else linhas.push(`✅ Nenhuma parcela em aberto — tudo quitado!`);
    if (ext.qtd_pagos) linhas.push(`✅ Já pagas: ${ext.qtd_pagos} (R$ ${fmtMoney(ext.total_pago)})${ext.ultimo_pago ? ` — última em ${fmtDate(ext.ultimo_pago.data)}` : ''}`);
    if (ext.qtd_atrasados) linhas.push(`⚠️ ${ext.qtd_atrasados} em atraso — se precisar renegociar, responda *4*.`);
    if (ext.proxima) linhas.push(`\n📅 Próximo vencimento: ${fmtDate(ext.proxima.vencimento)} — R$ ${fmtMoney(ext.proxima.valor)}\nResponda *1* para o boleto ou *2* para o PIX.`);
    reply = linhas.join('\n');
  }
  await log(reply, intentKey, { financeiro: true, opcao });
  return { reply, intent: intentKey, escalate: false, conversation };
}

// ---------- comandos de testador (#...) ----------
async function handleTesterCommand(text, ctx) {
  const { conversation, tester, channel } = ctx;
  const cmd = text.trim();
  const lower = normalize(cmd);

  if (lower === '#reset') {
    await upsertConversation(channel, { customer_id: null, customer_name: '', context: {}, escalated: false });
    return { reply: '🔄 Conversa reiniciada. Identificação e contexto limpos.\nUse #cliente <nome ou CPF> ou #processo <número CNJ> para escolher quem você quer simular.' };
  }
  if (lower === '#ajuda' || lower === '#help') {
    return { reply: '🧪 *Comandos de teste:*\n#cliente <nome ou CPF> — simular um cliente do ADVBOX\n#processo <número CNJ> — consultar qualquer processo\n#reset — limpar a conversa\n#ajuda — esta mensagem\n\nFora dos comandos, converse normalmente como se fosse o cliente.' };
  }
  const mProc = cmd.match(/^#processo\s+(.+)$/i);
  if (mProc) {
    const ls = await adv.searchLawsuitByNumber(mProc[1]);
    if (!ls) return { reply: `Não encontrei no ADVBOX o processo "${mProc[1]}". Confira o número (precisa estar cadastrado no ADVBOX).` };
    const cust = (ls.customers || []).find(c => c.origin !== 'PARTE CONTRARIA') || (ls.customers || [])[0];
    await upsertConversation(channel, {
      customer_id: cust?.customer_id || null,
      customer_name: cust?.name || '',
      context: { selected_lawsuit_id: ls.id, awaiting: null },
    });
    if (tester?.id) await updateTester(tester.id, { advbox_customer_id: cust?.customer_id || null, advbox_customer_name: cust?.name || '' });
    return { reply: `✅ Agora você está simulando *${cust?.name || 'cliente do processo'}* no processo *${ls.process_number || ls.protocol_number || ls.id}*.\nPergunte algo como "como está meu processo?"`, refreshed: true };
  }
  const mCli = cmd.match(/^#cliente\s+(.+)$/i);
  if (mCli) {
    const found = await adv.searchCustomers(mCli[1]);
    if (!found.length) return { reply: `Não encontrei cliente no ADVBOX para "${mCli[1]}".` };
    if (found.length === 1) {
      const c = found[0];
      await upsertConversation(channel, { customer_id: c.id, customer_name: c.name, context: { awaiting: null } });
      if (tester?.id) await updateTester(tester.id, { advbox_customer_id: c.id, advbox_customer_name: c.name });
      return { reply: `✅ Agora você está simulando *${c.name}* (${c.identification || 'sem CPF'}).\nPergunte algo como "como está meu processo?"`, refreshed: true };
    }
    const options = found.slice(0, 5).map((c, i) => ({ customer_id: c.id, label: `${i + 1}️⃣ ${c.name} (${c.identification || 's/ CPF'})`, name: c.name }));
    await upsertConversation(channel, { context: { awaiting: 'customer_choice', options } });
    return { reply: `Encontrei ${found.length} clientes. Qual deles?\n\n${options.map(o => o.label).join('\n')}\n\nResponda com o número.` };
  }
  return { reply: 'Comando não reconhecido. Use #ajuda para ver os comandos de teste.' };
}

// ---------- handler principal ----------
/**
 * @param {object} p
 * @param {string} p.channel  'sim:<id>' ou 'wa:<phone>'
 * @param {string} p.text     mensagem recebida
 * @param {object} [p.tester] registro de bot_testers (modo WhatsApp)
 * @param {number} [p.customerId] forca identidade (simulador do painel)
 * @param {string} [p.customerName]
 * @returns {{reply, intent, escalate, conversation, meta}}
 */
export async function handleMessage(p) {
  const { channel, text } = p;
  const [cfg, intents, glossary, stageTemplates, taskTemplates] = await Promise.all([
    getConfig(), getIntents(), getGlossary(), getStageTemplates(), getTaskTemplates(),
  ]);
  const geral = cfg.geral || {};
  const deps = { cfg, stageTemplates, taskTemplates, glossary };

  let conversation = await getConversation(channel) ||
    await upsertConversation(channel, { context: {} });

  const log = async (reply, intent, meta = {}) => {
    await logMessage(conversation.id, 'in', text, intent, {});
    await logMessage(conversation.id, 'out', reply, intent, meta);
  };

  // 0) comandos de teste (#...)
  if (text.trim().startsWith('#')) {
    const r = await handleTesterCommand(text, { conversation, tester: p.tester, channel });
    await log(r.reply, 'comando');
    return { reply: r.reply, intent: 'comando', escalate: false, conversation };
  }

  // 1) identidade forcada pelo simulador
  if (p.customerId && Number(conversation.customer_id) !== Number(p.customerId)) {
    conversation = await upsertConversation(channel, {
      customer_id: p.customerId, customer_name: p.customerName || '', context: {},
    });
  }

  const ctx = conversation.context || {};

  // 2) respostas a escolhas pendentes (numero)
  const choiceNum = text.trim().match(/^([1-5])\b/);
  if (ctx.awaiting === 'fin_menu' && choiceNum && ['1', '2', '3', '4'].includes(choiceNum[1])) {
    return await respostaFinanceira(choiceNum[1], {
      conversation, channel, log,
      vars: { primeiro_nome: firstName(conversation.customer_name || '') },
      intentKey: 'financeiro',
    });
  }
  if (ctx.awaiting === 'process_choice' && choiceNum && (ctx.options || [])[Number(choiceNum[1]) - 1]) {
    const opt = ctx.options[Number(choiceNum[1]) - 1];
    conversation = await upsertConversation(channel, { context: { ...ctx, awaiting: null, options: null, selected_lawsuit_id: opt.lawsuit_id } });
    const ans = await buildLawsuitAnswer(opt.lawsuit_id, { ...deps, customerName: conversation.customer_name });
    await log(ans.reply, ctx.pending_intent || 'andamento', ans.meta);
    return { reply: ans.reply, intent: ctx.pending_intent || 'andamento', escalate: false, conversation, meta: ans.meta };
  }
  if (ctx.awaiting === 'customer_choice' && choiceNum && (ctx.options || [])[Number(choiceNum[1]) - 1]) {
    const opt = ctx.options[Number(choiceNum[1]) - 1];
    conversation = await upsertConversation(channel, { customer_id: opt.customer_id, customer_name: opt.name || '', context: {} });
    if (p.tester?.id) await updateTester(p.tester.id, { advbox_customer_id: opt.customer_id, advbox_customer_name: opt.name || '' });
    const reply = `✅ Agora você está simulando *${opt.name}*. Pergunte algo como "como está meu processo?"`;
    await log(reply, 'comando');
    return { reply, intent: 'comando', escalate: false, conversation };
  }

  // 3) aguardando CPF para identificacao
  if (ctx.awaiting === 'cpf') {
    const cust = await adv.findCustomerByCPF(text);
    if (cust) {
      conversation = await upsertConversation(channel, { customer_id: cust.id, customer_name: cust.name, context: {} });
    } else {
      const reply = 'Hmm, não localizei esse CPF em nosso sistema. Pode conferir os números? Se preferir, posso pedir para um atendente te ajudar — é só dizer "falar com atendente".';
      await log(reply, 'identificacao');
      return { reply, intent: 'identificacao', escalate: false, conversation };
    }
  }

  // 4) identificacao
  if (!conversation.customer_id) {
    let cust = null;
    if (p.tester?.advbox_customer_id) cust = await adv.getCustomer(p.tester.advbox_customer_id).catch(() => null);
    if (!cust && channel.startsWith('wa:')) {
      const fone = channel.slice(3);
      // 1º: índice local de telefone (espelho) — instantâneo, sem ADVBOX
      let idx = null;
      try { ({ data: idx } = await db.rpc('bot_fone_lookup', { p_fone: fone })); } catch { idx = null; }
      if (idx && idx.length === 1) cust = { id: idx[0].advbox_customer_id, name: idx[0].nome };
      // telefone compartilhado (vários clientes) -> deixa cair no CPF p/ desambiguar
      // 2º: fallback ADVBOX ao vivo só se o índice não resolveu
      if (!cust && (!idx || idx.length === 0)) cust = await adv.findCustomerByPhone(fone).catch(() => null);
    }
    if (cust) {
      conversation = await upsertConversation(channel, { customer_id: cust.id, customer_name: cust.name, context: conversation.context || {} });
    } else {
      await upsertConversation(channel, { context: { ...ctx, awaiting: 'cpf' } });
      const reply = render(geral.nao_identificado || 'Pode me informar o CPF do titular?', {});
      await log(reply, 'identificacao');
      return { reply, intent: 'identificacao', escalate: false, conversation };
    }
  }

  // 5) classifica intencao — numeros soltos do menu inicial viram atalhos
  const ATALHO_MENU = { '1': 'como esta meu processo', '2': 'tenho audiencia marcada', '3': 'financeiro', '4': 'falar com atendente' };
  const textoIntent = (!ctx.awaiting && /^[1-4]$/.test(text.trim())) ? ATALHO_MENU[text.trim()] : text;
  const intent = classifyIntent(textoIntent, intents);
  // nome vem da conversa (definido na identificação) — sem chamar o ADVBOX a cada mensagem
  const customerName = conversation.customer_name || '';
  const vars = { cliente: customerName, primeiro_nome: firstName(customerName) };

  const needLawsuit = intent && ['andamento', 'audiencia', 'tarefas'].includes(intent.action);

  if (needLawsuit) {
    // (portal-2) processos do ESPELHO casados pelo ID do cliente (nao pelo nome) — antes
    // um homonimo podia receber no WhatsApp o processo de outra pessoa. Fallback por nome
    // so p/ processos ainda nao indexados (customer_ids null); e fallback final na API
    // ADVBOX por id se o espelho vier vazio.
    let lawsuits = [];
    try {
      const custId = Number(conversation.customer_id);
      const nomeSafe = String(customerName || '').replace(/[,()*]/g, ' ').trim();
      const q = (Number.isFinite(custId) && custId > 0)
        ? db.from('bi_processos').select('lawsuit_id, process_number, tipo, etapa')
            .or(`customer_ids.cs.{${custId}},and(customer_ids.is.null,clientes.ilike.*${nomeSafe}*)`).limit(10)
        : db.from('bi_processos').select('lawsuit_id, process_number, tipo, etapa').ilike('clientes', `%${customerName}%`).limit(10);
      const { data: procs } = await q;
      if (procs && procs.length) lawsuits = procs.map(pr => ({ lawsuit_id: pr.lawsuit_id, process_number: pr.process_number, type: pr.tipo, stage: pr.etapa }));
    } catch { /* tenta fallback abaixo */ }
    if (!lawsuits.length) { const c = await adv.getCustomer(conversation.customer_id).catch(() => null); lawsuits = c?.lawsuits || []; }
    let lawsuitId = (conversation.context || {}).selected_lawsuit_id || null;
    if (!lawsuitId && lawsuits.length === 1) lawsuitId = lawsuits[0].lawsuit_id || lawsuits[0].id;

    if (!lawsuitId && lawsuits.length === 0) {
      const reply = `${render(geral.saudacao || '', vars)}\nNão encontrei processos ativos vinculados ao seu cadastro. Se você acredita que isso é um engano, me avise que encaminho para a equipe verificar!`;
      await log(reply, intent.intent_key);
      return { reply, intent: intent.intent_key, escalate: false, conversation };
    }
    if (!lawsuitId && lawsuits.length > 1) {
      const options = lawsuits.slice(0, 5).map((l, i) => {
        const id = l.lawsuit_id || l.id;
        const num = l.process_number || `pasta ${id}`;
        const extra = (l.type || l.stage) ? ` (${[l.type, l.stage].filter(Boolean).join(' — ')})` : '';
        return { lawsuit_id: id, label: `${i + 1}️⃣ ${num}${extra}` };
      });
      await upsertConversation(channel, { context: { awaiting: 'process_choice', options, pending_intent: intent.intent_key } });
      const reply = render(geral.multi_processo || 'Qual processo? {{lista}}', {
        ...vars, qtd: options.length, lista: options.map(o => o.label).join('\n'),
      });
      await log(reply, intent.intent_key);
      return { reply, intent: intent.intent_key, escalate: false, conversation };
    }

    const builder = intent.action === 'audiencia' ? buildAudienciaAnswer
      : intent.action === 'tarefas' ? buildTarefasAnswer
      : buildLawsuitAnswer;
    const ans = await builder(lawsuitId, { ...deps, customerName });
    await log(ans.reply, intent.intent_key, ans.meta || {});
    return { reply: ans.reply, intent: intent.intent_key, escalate: false, conversation, meta: ans.meta };
  }

  // financeiro: menu interativo (#18) — 2ª via, PIX, parcelas, falar com financeiro
  if (intent && intent.action === 'financeiro') {
    const norm = normalize(text);
    // atalhos diretos pelas palavras (sem passar pelo menu)
    if (/\bpix\b/.test(norm)) return await respostaFinanceira('2', { conversation, channel, log, vars, intentKey: intent.intent_key });
    if (/(2a? via|segunda via|\bboleto\b)/.test(norm)) return await respostaFinanceira('1', { conversation, channel, log, vars, intentKey: intent.intent_key });
    if (/(quantas|faltam|restam|quanto falta|quanto devo|quanto paguei|extrato)/.test(norm)) return await respostaFinanceira('3', { conversation, channel, log, vars, intentKey: intent.intent_key });
    if (/(falar|atendente|humano|negociar|renegociar)/.test(norm)) return await respostaFinanceira('4', { conversation, channel, log, vars, intentKey: intent.intent_key });
    const reply = `💰 *Financeiro* — como posso te ajudar${vars.primeiro_nome ? ', ' + vars.primeiro_nome : ''}?\n\n1️⃣ 2ª via do boleto\n2️⃣ Código PIX (copia e cola)\n3️⃣ Quantas parcelas faltam\n4️⃣ Falar com o financeiro\n\nResponda com o número da opção. 😊`;
    await upsertConversation(channel, { context: { ...(conversation.context || {}), awaiting: 'fin_menu' } });
    await log(reply, intent.intent_key);
    return { reply, intent: intent.intent_key, escalate: false, conversation };
  }

  if (intent && intent.action === 'humano') {
    // (portal-6) anexa retorno sensivel a hora/dia util (template generico nao sabe a hora)
    const reply = render(intent.response_template || 'Vou te conectar com um atendente!', vars).trim() + ' ' + fraseRetorno();
    await upsertConversation(channel, { escalated: true });
    await log(reply, intent.intent_key, { escalate: true });
    return { reply, intent: intent.intent_key, escalate: true, conversation };
  }

  if (intent && intent.action === 'template') {
    const reply = render(intent.response_template || '', vars) || render(geral.fallback || '', vars);
    await log(reply, intent.intent_key);
    return { reply, intent: intent.intent_key, escalate: false, conversation };
  }

  // saudacao simples?
  if (/^(oi|ola|bom dia|boa tarde|boa noite|opa|e ai)\b/.test(normalize(text))) {
    const reply = `${render(geral.saudacao || 'Olá!', vars)}\n\n${render(geral.fallback || '', vars)}`.trim();
    await log(reply, 'saudacao');
    return { reply, intent: 'saudacao', escalate: false, conversation };
  }

  // fallback
  const reply = render(geral.fallback || 'Não entendi. Pode reformular?', vars);
  await log(reply, 'fallback');
  return { reply, intent: 'fallback', escalate: false, conversation };
}
