#!/usr/bin/env node
// Diagnostico da cadeia da Ana (SDR de IA) para UM telefone: percorre config -> horario -> testador
// -> contatos/leads no Kommo -> gatilho -> estado da conversa -> historico -> rastro (webhook/saidas)
// -> turnos -> fila do Kommo -> credenciais externas, e diz onde a cadeia para.
//
// Uso (com as envs de producao carregadas: KOMMO_TOKEN, BOT_RPC_SECRET, SUPABASE_SERVICE_ROLE_KEY,
//      GOOGLE_OAUTH_*, ANTHROPIC_API_KEY, GROQ_API_KEY):
//   node scripts/ana-diagnostico.mjs 5519993388370
//   node scripts/ana-diagnostico.mjs --saude          (so o retrato geral das ultimas 24h)
import { db, getConfig, findTesterByPhone, getConversation } from '../netlify/functions/_lib/botDb.mjs';
import { kommoGet, extractPhones } from '../netlify/functions/_lib/kommo.mjs';
import { gradeDeConfig, foraDoHorario } from '../netlify/functions/_lib/sdrHorario.mjs';
import { situacaoDoLead } from '../netlify/functions/_lib/sdrGatilhos.mjs';

const RPC_SECRET = process.env.BOT_RPC_SECRET || '';
const ok = (t) => console.log(`  ✓ ${t}`);
const bad = (t) => console.log(`  ✗ ${t}`);
const info = (t) => console.log(`    ${t}`);
const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-';

async function saude(horas = 24) {
  const { data, error } = await db.rpc('sdr_ia_saude', { p_chave: RPC_SECRET, p_horas: horas });
  console.log(`\n== SAUDE DA CADEIA (ultimas ${horas}h) ==`);
  if (error) { bad(`sdr_ia_saude: ${error.message}`); return; }
  console.log(JSON.stringify(data, null, 2));
}

async function diagnostico(fone) {
  const digitos = String(fone).replace(/\D/g, '');
  console.log(`\n== DIAGNOSTICO DA ANA para ${digitos} ==`);
  const paradas = [];

  // 1. config
  const cfg = (await getConfig()).agenda_bot || {};
  console.log('\n[1] Config (bot_config.agenda_bot)');
  cfg.ativo ? ok('ativo = true') : (bad('ativo = false (a Ana nao responde ninguem)'), paradas.push('inativo'));
  info(`modo_teste = ${cfg.modo_teste} · teste_ignora_horario = ${cfg.regras?.teste_ignora_horario} · modelo = ${cfg.llm?.modelo} · salesbot ${cfg.kommo?.salesbot_id} · campo ${cfg.kommo?.campo_ana_id}`);

  // 2. horario
  console.log('\n[2] Horario (grade do SDR)');
  const { data: gradeRows, error: gErr } = await db.rpc('sdr_ia_grade', { p_chave: RPC_SECRET });
  const grade = gradeDeConfig(Array.isArray(gradeRows) ? gradeRows[0] : gradeRows, cfg.regras || {});
  if (gErr) bad(`sdr_ia_grade: ${gErr.message} (usando cfg.regras)`);
  const fora = foraDoHorario(new Date(), grade, cfg.regras?.feriados || []);
  const bypass = !!(cfg.modo_teste && cfg.regras?.teste_ignora_horario);
  info(`grade ${grade.inicio}-${grade.fim} dias ${grade.dias.join(',')} · agora ${fmt(new Date())} · fora do horario: ${fora} · bypass de teste: ${bypass}`);
  (fora || bypass) ? ok('a Ana esta de plantao agora') : (bad('horario comercial: a Ana fica calada (humano atende)'), paradas.push('horario comercial'));

  // 3. testador
  console.log('\n[3] Testador (modo_teste)');
  if (cfg.modo_teste) {
    const t = await findTesterByPhone(digitos);
    t ? ok(`telefone esta em bot_testers (${t.name})`) : (bad('telefone NAO esta em bot_testers: em modo_teste a Ana ignora'), paradas.push('nao testador'));
  } else ok('modo_teste desligado: qualquer lead e atendido');

  // 4. contatos e leads no Kommo
  console.log('\n[4] Kommo: contatos com esse telefone e seus leads');
  const busca = await kommoGet(`/contacts?query=${digitos.slice(-8)}&with=leads`);
  const contatos = busca?._embedded?.contacts || [];
  if (!contatos.length) { bad('nenhum contato no Kommo com esse telefone'); paradas.push('sem contato'); }
  const pipelines = await kommoGet('/leads/pipelines');
  const nomePipe = {}; const nomeStatus = {};
  for (const p of pipelines?._embedded?.pipelines || []) { nomePipe[p.id] = p.name; for (const s of p._embedded?.statuses || []) nomeStatus[s.id] = s.name; }
  let algumGatilho = false;
  for (const c of contatos) {
    const fones = extractPhones(c);
    info(`contato ${c.id} "${c.name}" fones ${fones.join('/')}`);
    const leads = (c._embedded?.leads || []).map((l) => Number(l.id)).sort((a, b) => b - a);
    for (const id of leads) {
      const lead = await kommoGet(`/leads/${id}`);
      if (!lead) { info(`  lead ${id}: nao encontrado`); continue; }
      const g = (cfg.gatilhos || []).find((x) => Number(x.pipeline_id) === Number(lead.pipeline_id));
      const sit = situacaoDoLead({ lead, cfg, ultimaMsgEscritorio: null });
      const linha = `  lead ${id} · ${nomePipe[lead.pipeline_id] || lead.pipeline_id} > ${nomeStatus[lead.status_id] || lead.status_id} · gatilho: ${g ? (g.desde_inicio ? 'desde o inicio' : 'apos roteiro') : 'NAO'} · situacao (sem ultima msg): ${sit ? sit.acao : 'nenhuma'}`;
      g ? ok(linha) : info(linha);
      if (g && sit) algumGatilho = true;
    }
  }
  if (contatos.length && !algumGatilho) { bad('nenhum lead deste contato cai num gatilho (pipeline SDR/Teste Paulo + etapa atendivel)'); paradas.push('fora do gatilho'); }

  // 5. estado da conversa
  console.log('\n[5] Estado da conversa (bot_conversations)');
  const conv = await getConversation(`agenda:${digitos}`);
  if (!conv) info('sem estado ainda (primeira conversa)');
  else {
    const e = conv.context || {};
    info(`lead ${e.lead_id} · situacao ${e.situacao} · escalado ${!!e.escalado} · encerrado ${!!e.encerrado} · pausada_ate ${fmt(e.pausada_ate)} · ultima_fala_ana ${fmt(e.ultima_fala_ana)} · agendamento ${e.agendamento?.inicio ? fmt(e.agendamento.inicio) : '-'} · nota ${e.nota ?? '-'}`);
    if (e.encerrado) { bad('conversa ENCERRADA pela Ana: ela nao volta a responder este lead'); paradas.push('encerrado'); }
    if (e.pausada_ate && new Date(e.pausada_ate) > new Date()) { bad(`PAUSADA ate ${fmt(e.pausada_ate)} (humano falou ou teto de custo)`); paradas.push('pausada'); }
  }

  // 6. rastro (webhook + saidas) dos contatos
  console.log('\n[6] Rastro das ultimas 24h (webhook recebido / saidas do worker)');
  const ids = contatos.map((c) => String(c.id));
  const { data: logs } = await db.from('advbox_api_log').select('created_at,nivel,mensagem,contexto').eq('origem', 'ana')
    .gte('created_at', new Date(Date.now() - 864e5).toISOString()).order('created_at', { ascending: false }).limit(200);
  const meus = (logs || []).filter((l) => ids.includes(String(l.contexto?.contactId || '')));
  if (!meus.length) info('nenhum rastro para esses contatos (o webhook do Kommo nao chegou, ou a mensagem foi para outro numero)');
  for (const l of meus.slice(0, 12)) info(`${fmt(l.created_at)} [${l.nivel}] ${l.mensagem} ${JSON.stringify(l.contexto).slice(0, 160)}`);

  // 7. turnos
  console.log('\n[7] Turnos da Ana (sdr_ia_turnos) nas ultimas 24h');
  const { data: turnos } = await db.from('sdr_ia_turnos').select('recebido_em,situacao,stop_reason,entrada,resposta,ferramentas,custo_usd,latencia_ms,erro,entrega')
    .in('contact_id', ids.map(Number)).gte('recebido_em', new Date(Date.now() - 864e5).toISOString()).order('recebido_em', { ascending: false }).limit(10);
  if (!turnos?.length) info('nenhum turno (a Ana nao chegou a chamar a Claude)');
  for (const t of turnos || []) {
    info(`${fmt(t.recebido_em)} ${t.situacao} · ${t.stop_reason} · ${t.latencia_ms} ms · US$ ${t.custo_usd} · ferramentas ${(t.ferramentas || []).map((f) => f.nome).join(',') || '-'} · entrega ${t.entrega ? (t.entrega.bot_ok ? 'ok' : 'FALHOU ' + t.entrega.erro) : '?'}${t.erro ? ' · ERRO ' + t.erro : ''}`);
    info(`   lead: ${(t.entrada || '').slice(0, 80)}`);
    info(`   ana:  ${(t.resposta || '').slice(0, 120)}`);
  }

  // 8. fila do Kommo
  console.log('\n[8] Fila do Kommo (kommo_queue) para os leads');
  const leadIds = contatos.flatMap((c) => (c._embedded?.leads || []).map((l) => String(l.id)));
  const { data: jobs } = await db.from('kommo_queue').select('kind,status,attempts,last_error,created_at,payload').order('created_at', { ascending: false }).limit(300);
  const meusJobs = (jobs || []).filter((j) => leadIds.includes(String(j.payload?.leadId || j.payload?.entityId || ''))).slice(0, 8);
  if (!meusJobs.length) info('nenhum job para esses leads');
  for (const j of meusJobs) (j.status === 'failed' ? bad : info)(`${fmt(j.created_at)} ${j.kind} ${j.status} tent.${j.attempts}${j.last_error ? ' · ' + j.last_error.slice(0, 100) : ''}`);

  // 9. credenciais externas
  console.log('\n[9] Credenciais externas');
  for (const [nome, envs] of [['Anthropic', ['ANTHROPIC_API_KEY']], ['Groq (audio)', ['GROQ_API_KEY']], ['Google Agenda', ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN']], ['Kommo', ['KOMMO_TOKEN']], ['RPC Supabase', ['BOT_RPC_SECRET']]]) {
    const falta = envs.filter((e) => !process.env[e]);
    falta.length ? bad(`${nome}: falta ${falta.join(', ')}`) : ok(`${nome}: envs presentes`);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.llm?.modelo || 'claude-opus-5', messages: [{ role: 'user', content: 'oi' }] }) });
    const j = await r.json();
    j.input_tokens ? ok('Anthropic responde (chave e credito ok)') : (bad(`Anthropic: ${j.error?.message || JSON.stringify(j).slice(0, 120)}`), paradas.push('anthropic'));
  }
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
    const j = await r.json();
    const escreve = /calendar\.events(?!\.readonly)|auth\/calendar(\s|$)/.test(j.scope || '');
    j.access_token ? (escreve ? ok('Google: token valido com ESCRITA') : (bad('Google: token so de LEITURA (nao cria evento)'), paradas.push('google readonly'))) : (bad(`Google: ${j.error_description || j.error}`), paradas.push('google'));
  }

  console.log('\n== CONCLUSAO ==');
  if (!paradas.length) console.log('  Nada bloqueia: se a mensagem chegou ao numero certo, a Ana deve responder. Se nao respondeu, olhe o item [6]: sem "webhook recebido" = o Kommo nao chamou (numero errado ou webhook desativado).');
  else console.log(`  A cadeia para em: ${paradas.join(' → ')}`);
}

const arg = process.argv[2];
if (!arg || arg === '--saude') { await saude(Number(process.argv[3] || 24)); }
else { await diagnostico(arg); await saude(24); }
