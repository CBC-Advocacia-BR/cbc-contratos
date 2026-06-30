/* DIAGNOSTICO DA FONTE DOS DUPLICADOS (Kommo API v4, somente leitura).
 * Pega a amostra de leads "recriados" (sample_dup_lead_ids.json) e descobre QUEM/QUAL CANAL
 * os cria: created_by do lead e do contato, source/canal, pipeline e etapa, tags.
 *
 * Uso (token vem do Netlify; rode na pasta deste arquivo):
 *   KOMMO_TOKEN="<token>" node diagnostico_fonte_kommo.cjs
 *   # para pegar o token: npx netlify-cli env:get KOMMO_TOKEN --site d7b38821-22e9-4308-8fda-a8f124a65b72
 *
 * Nada e escrito no Kommo. Apenas GET.
 */
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.KOMMO_TOKEN || '';
const BASE = 'https://advocaciacbc.kommo.com/api/v4';
if (!TOKEN) { console.error('ERRO: defina KOMMO_TOKEN no ambiente.'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample_dup_lead_ids.json'), 'utf8'));

let last = 0;
async function throttle() { const w = 220 - (Date.now() - last); if (w > 0) await new Promise(r => setTimeout(r, w)); last = Date.now(); }
async function kget(p) {
  for (let a = 0; a < 4; a++) {
    await throttle();
    const r = await fetch(`${BASE}${p}`, { headers: H });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 1500 * (a + 1))); continue; }
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`GET ${p} HTTP ${r.status} ${(await r.text().catch(()=>'')).slice(0,200)}`);
    return r.json();
  }
  throw new Error(`GET ${p} 429 esgotado`);
}

function tally(map, key) { const k = key == null ? '(vazio)' : String(key); map.set(k, (map.get(k) || 0) + 1); }
function report(titulo, map, resolve, total) {
  console.log(`\n== ${titulo} ==`);
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, n]) => {
    const lbl = resolve ? (resolve[k] || k) : k;
    console.log(`  ${String(n).padStart(5)}  ${((n/total)*100).toFixed(0).padStart(3)}%  ${lbl}`);
  });
}

(async () => {
  console.log(`Amostra: ${sample.length} leads duplicados (recriados). Resolvendo metadados...`);
  // mapas de id->nome
  const users = {}; let up = 1;
  while (up <= 10) { const r = await kget(`/users?limit=250&page=${up}`); const it = r?._embedded?.users || []; it.forEach(u => users[u.id] = u.name); if (it.length < 250) break; up++; }
  users['0'] = '0 = API / integracao / sistema (sem usuario humano)';

  const pipelines = {}, statuses = {};
  const pp = await kget('/leads/pipelines');
  for (const pl of pp?._embedded?.pipelines || []) {
    pipelines[pl.id] = pl.name;
    for (const st of pl._embedded?.statuses || []) statuses[`${pl.id}:${st.id}`] = `${pl.name} > ${st.name}`;
  }
  const sources = {}; const sr = await kget('/sources?limit=250').catch(() => null);
  for (const s of sr?._embedded?.sources || []) sources[s.id] = `${s.name}${s.external_id ? ' ('+s.external_id+')' : ''}`;

  // busca os leads em lotes de 250, com contatos
  const cbLead = new Map(), srcLead = new Map(), pipeMap = new Map(), tagMap = new Map();
  const mainContactIds = new Set();
  let okLeads = 0;
  for (let i = 0; i < sample.length; i += 250) {
    const ids = sample.slice(i, i + 250);
    const qs = ids.map(id => `filter[id][]=${encodeURIComponent(id)}`).join('&');
    const r = await kget(`/leads?${qs}&with=contacts,source_id&limit=250`);
    for (const ld of r?._embedded?.leads || []) {
      okLeads++;
      tally(cbLead, ld.created_by);
      tally(srcLead, ld.source_id);
      tally(pipeMap, `${ld.pipeline_id}:${ld.status_id}`);
      for (const t of ld._embedded?.tags || []) tally(tagMap, t.name);
      const main = (ld._embedded?.contacts || []).find(c => c.is_main) || (ld._embedded?.contacts || [])[0];
      if (main) mainContactIds.add(main.id);
    }
  }

  // busca os contatos principais p/ ver QUEM cria o CONTATO
  const cbContact = new Map(); const cids = [...mainContactIds]; let okC = 0;
  for (let i = 0; i < cids.length; i += 250) {
    const qs = cids.slice(i, i + 250).map(id => `filter[id][]=${encodeURIComponent(id)}`).join('&');
    const r = await kget(`/contacts?${qs}&limit=250`);
    for (const c of r?._embedded?.contacts || []) { okC++; tally(cbContact, c.created_by); }
  }

  console.log(`\nLeads lidos: ${okLeads}/${sample.length} | contatos principais lidos: ${okC}`);
  report('QUEM CRIA O CONTATO duplicado (created_by do contato)', cbContact, users, okC || 1);
  report('QUEM CRIA O LEAD duplicado (created_by do lead)', cbLead, users, okLeads || 1);
  report('CANAL / SOURCE do lead (source_id)', srcLead, sources, okLeads || 1);
  report('PIPELINE > ETAPA onde caem', pipeMap, statuses, okLeads || 1);
  report('TAGS mais comuns', tagMap, null, okLeads || 1);
  console.log('\nLeitura: created_by repetido (mesmo usuario/integracao) + um source/canal dominante = a torneira.');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
