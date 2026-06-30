/* Monta o Excel de duplicados do Kommo a partir dos 3 resultados salvos pelo MCP.
   Cada arquivo e o tool-result cru: {"result":"...<untrusted-data-XXX> [{\"tsv\":..}] ..."} */
const fs = require('fs');
const XLSX = require('xlsx');

const KOMMO = 'https://advocaciacbc.kommo.com';
const OUT = '/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/exports/kommo-duplicados/kommo_duplicados_2026-06-23.xlsx';

const TIERS = [
  { file: process.argv[2], sheet: 'MESCLAR (tel+nome)',        rotulo: 'FORTE - mesma pessoa (telefone E nome batem). Mesclar com seguranca.' },
  { file: process.argv[3], sheet: 'Revisar - mesmo telefone',  rotulo: 'MEDIO - mesmo telefone, nomes diferentes. Revisar (familia/erro de digitacao/pessoas distintas).' },
  { file: process.argv[4], sheet: 'Revisar - mesmo nome',      rotulo: 'FRACO - mesmo nome, telefones diferentes. Revisar com cuidado (risco de homonimo).' },
];

function parseTier(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const outer = JSON.parse(raw);
  const inner = outer.result.match(/\[\{"tsv"[\s\S]*\}\]/);
  if (!inner) throw new Error('inner JSON nao encontrado em ' + path);
  const obj = JSON.parse(inner[0])[0];
  const tsv = obj.tsv || '';
  const linhas = tsv.length ? tsv.split('\n') : [];
  const rows = linhas.map(l => {
    const [gnum, qc, nome, telefone, contact_id, lead_ids, n_leads] = l.split('\t');
    return { gnum: +gnum, qc: +qc, nome, telefone, contact_id, lead_ids: lead_ids || '', n_leads: +n_leads };
  });
  return { rows, n_contatos: obj.n_contatos, n_grupos: obj.n_grupos };
}

function linkCell(text, url) { return { t: 's', v: text, l: { Target: url, Tooltip: url } }; }

function buildSheet(rows) {
  const header = ['Grupo', 'Qtd no grupo', 'Nome', 'Telefone', 'Contact ID', 'Abrir contato', 'Nº leads', 'Lead IDs', 'Abrir 1º lead'];
  const aoa = [header];
  for (const r of rows) {
    const firstLead = (r.lead_ids.split(';')[0] || '').trim();
    aoa.push([r.gnum, r.qc, r.nome, r.telefone, r.contact_id, 'abrir contato', r.n_leads, r.lead_ids, 'abrir lead']);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // injeta hyperlinks (col F = idx5 contato, col I = idx8 lead)
  rows.forEach((r, i) => {
    const row = i + 1; // +1 por causa do header
    const cF = XLSX.utils.encode_cell({ r: row, c: 5 });
    ws[cF] = linkCell('abrir contato', `${KOMMO}/contacts/detail/${r.contact_id}`);
    const firstLead = (r.lead_ids.split(';')[0] || '').trim();
    if (firstLead) {
      const cI = XLSX.utils.encode_cell({ r: row, c: 8 });
      ws[cI] = linkCell('abrir lead', `${KOMMO}/leads/detail/${firstLead}`);
    }
  });
  ws['!cols'] = [{ wch: 7 }, { wch: 12 }, { wch: 34 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 22 }, { wch: 12 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 8 } }) };
  if (!ws['!freeze']) ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

const parsed = TIERS.map(t => ({ ...t, ...parseTier(t.file) }));

const wb = XLSX.utils.book_new();

// Resumo
const resumo = [
  ['DUPLICADOS KOMMO - advocaciacbc.kommo.com'],
  ['Gerado em', '2026-06-23'],
  ['Fonte', 'espelho Supabase kommo_leads (sync do dia) - 17.902 leads / 17.850 contatos'],
  ['Criterio do cliente', 'telefone + nome (CPF e campo morto no Kommo)'],
  [''],
  ['Nivel', 'Aba', 'Grupos', 'Contatos duplicados', 'Acao'],
  ['FORTE', TIERS[0].sheet, parsed[0].n_grupos, parsed[0].n_contatos, 'Mesclar com seguranca (mesma pessoa)'],
  ['MEDIO', TIERS[1].sheet, parsed[1].n_grupos, parsed[1].n_contatos, 'Revisar - mesmo telefone, nomes diferentes'],
  ['FRACO', TIERS[2].sheet, parsed[2].n_grupos, parsed[2].n_contatos, 'Revisar - mesmo nome, telefones diferentes (homonimos)'],
  [''],
  ['Como mesclar (manual, no Kommo):'],
  ['1) A API do Kommo NAO mescla registros existentes - so a interface.'],
  ['2) Abra o contato pelo link, ou use Leads > "..." > "Find duplicates" para mesclar em lote.'],
  ['3) Ao mesclar, escolha quais dados manter. Leads vinculados sao preservados.'],
  [''],
  ['Notas:'],
  ['- Telefone normalizado: DDD + ultimos 8 digitos (resolve o 9o digito opcional e o DDI 55).'],
  ['- Nome normalizado: minusculas, sem acento, espacos colapsados.'],
  ['- Uma linha por CONTATO duplicado. "Lead IDs" lista os leads daquele contato.'],
  ['- Multiplos leads num mesmo contato NAO entram como duplicata (podem ser casos distintos).'],
  ['- Os niveis sao visoes independentes: um contato pode aparecer em mais de uma aba.'],
];
const wsR = XLSX.utils.aoa_to_sheet(resumo);
wsR['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 10 }, { wch: 20 }, { wch: 46 }];
XLSX.utils.book_append_sheet(wb, wsR, 'Resumo');

for (const t of parsed) {
  XLSX.utils.book_append_sheet(wb, buildSheet(t.rows), t.sheet);
}

XLSX.writeFile(wb, OUT);
console.log('OK ->', OUT);
console.log('Forte:', parsed[0].n_grupos, 'grupos /', parsed[0].n_contatos, 'contatos');
console.log('Medio:', parsed[1].n_grupos, 'grupos /', parsed[1].n_contatos, 'contatos');
console.log('Fraco:', parsed[2].n_grupos, 'grupos /', parsed[2].n_contatos, 'contatos');
