/**
 * Netlify BACKGROUND Function: advbox-snapshot-worker-background
 * Espelho de CADASTROS do ADVBOX -> Supabase (disparado pelo monitor 6h30/17h30):
 *
 *  1. bi_processos  — carteira completa (upsert; nao cresce) +
 *     bi_processos_log — diario de MUDANCAS (etapa, quadro, responsavel,
 *     honorarios, encerramento) => habilita analise de tempo-por-etapa no BI
 *  2. bi_clientes   — cadastro de clientes (origem, cidade, nascimento...)
 *  3. bi_financeiro — lancamentos (receita/despesa, vencimento vs pagamento)
 *
 * Custo: ~100-130 GETs por rodada a 15/min (~8 min). E disparado em SEQUENCIA
 * pelo monitor (nunca em paralelo) para o conjunto somar no maximo 15 req/min.
 */
import * as adv from './_lib/advbox.mjs';
import { db, logAdvbox, bulkRecordSyncItems, hashKey } from './_lib/botDb.mjs';

const PAGE = 50;
const MAX_PAGES = 100;
const dateOr = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)) ? s.slice(0, 10) : null;
// nascimento do ADVBOX vem em formatos variados (DD/MM/AAAA br, AAAA-MM-DD, ISO). Normaliza p/ AAAA-MM-DD.
const birthOr = (s) => {
  if (s === null || s === undefined || s === '') return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);      // AAAA-MM-DD ou ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);          // DD/MM/AAAA
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/^(\d{2})-(\d{2})-(\d{4})/);            // DD-MM-AAAA
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};
const txt = (v) => (v === null || v === undefined || v === '') ? null : String(v);

// campos do processo que geram linha no diario quando mudam
const LOG_FIELDS = ['etapa', 'quadro', 'responsavel', 'fees_money', 'status_closure', 'exit_production', 'exit_execution'];

// (#32) pessoa fisica? — mesma regra da funcao SQL _cliente_pf
const PJ_RE = /(LTDA|S\/A|S\.A|EIRELI|EMPREENDIMENT|INCORPORADORA|ADMINISTRADORA|HOTELEIRA|CONSTRUTORA|\bSPE\b|COMERCIALIZA|PARTICIPACOES|MULTIPROPRIEDADE|TURISMO|VIAGENS|RESORT|IMOBILIARI|CONDOMINIO|\bCLUB\b|BANCO|SEGURADORA|COOPERATIVA|ASSOCIACAO)/i;
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function ehPF(nome, doc, origem) {
  if (semAcento(origem).toUpperCase().trim() === 'PARTE CONTRARIA') return false;
  if (String(doc || '').replace(/\D/g, '').length === 14) return false;
  return !PJ_RE.test(semAcento(nome));
}

function lawsuitRow(ls) {
  const clientesArr = (ls.customers || []).filter(c => c.origin !== 'PARTE CONTRARIA');
  const clientes = clientesArr.map(c => c.name).join(', ');
  const contraria = (ls.customers || []).filter(c => c.origin === 'PARTE CONTRARIA').map(c => c.name).join(', ');
  // (portal-1/2/8) IDs dos clientes do processo -> portal/bot casam por identificador
  // unico (nao por nome), eliminando o risco de homonimo ver o caso de outra pessoa.
  const customerIds = clientesArr.map(c => Number(c.id)).filter(n => Number.isFinite(n));
  return {
    lawsuit_id: ls.id,
    process_number: txt(ls.process_number), protocol_number: txt(ls.protocol_number), folder: txt(ls.folder),
    process_date: dateOr(ls.process_date), tipo: txt(ls.type), grupo: txt(ls.group),
    quadro: txt(ls.step), etapa: txt(ls.stage), stages_id: ls.stages_id || null,
    responsavel: txt(ls.responsible),
    fees_expec: Number(ls.fees_expec) || null, fees_money: Number(ls.fees_money) || null,
    contingency: Number(ls.contingency) || null,
    status_closure: txt(ls.status_closure), exit_production: txt(ls.exit_production), exit_execution: txt(ls.exit_execution),
    clientes: clientes || null, parte_contraria: contraria || null,
    customer_ids: customerIds.length ? customerIds : null,
    criado_em_advbox: txt(ls.created_at), atualizado_em: new Date().toISOString(),
  };
}

async function upsertChunks(table, rows, pk) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict: pk });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export default async () => {
  adv.setThrottle(15);
  const stats = { processos: 0, processos_novos: 0, mudancas: 0, clientes: 0, financeiro: 0, erros: [] };
  const started = new Date();

  // ---------- 1) CARTEIRA + DIARIO DE MUDANCAS ----------
  try {
    const prev = new Map();
    {
      // (perf-be-10) carrega so as colunas usadas no diff (lawsuit_id + LOG_FIELDS),
      // pegada de memoria minima. Paginado via .range() porque o PostgREST corta em
      // 1000 linhas por padrao — sem isso o 'prev' viria truncado (carteira > 1000),
      // furando a deteccao de mudanca e marcando processos antigos como "novos".
      const PREV_PAGE = 1000;
      for (let from = 0; ; from += PREV_PAGE) {
        const { data, error } = await db.from('bi_processos')
          .select('lawsuit_id, etapa, quadro, responsavel, fees_money, status_closure, exit_production, exit_execution')
          .range(from, from + PREV_PAGE - 1);
        if (error) throw new Error(`bi_processos prev: ${error.message}`);
        for (const r of data || []) prev.set(Number(r.lawsuit_id), r);
        if (!data || data.length < PREV_PAGE) break;
      }
    }
    const rows = []; const logs = []; const novos = [];
    for (let off = 0, page = 0; page < MAX_PAGES; off += PAGE, page++) {
      const { items } = await adv.getLawsuitsPage(off, PAGE);
      if (!items.length) break;
      for (const ls of items) {
        const row = lawsuitRow(ls);
        rows.push(row);
        const old = prev.get(Number(ls.id));
        if (old) {
          for (const f of LOG_FIELDS) {
            const de = old[f] === null || old[f] === undefined ? null : String(old[f]);
            const para = row[f] === null || row[f] === undefined ? null : String(row[f]);
            if (de !== para) logs.push({ lawsuit_id: ls.id, process_number: row.process_number, campo: f, de, para });
          }
        } else if (prev.size > 0) {
          // processo NOVO no ADVBOX (nao existia na rodada anterior)
          novos.push(row);
        }
      }
      if (items.length < PAGE) break;
    }
    await upsertChunks('bi_processos', rows, 'lawsuit_id');

    // (#36) funil historico: retrato diario da carteira por quadro/etapa
    try {
      const dia = new Date().toISOString().slice(0, 10);
      const cont = {};
      for (const r of rows) {
        const k = `${r.quadro || '—'}|${r.etapa || '—'}`;
        cont[k] = (cont[k] || 0) + 1;
      }
      const funil = Object.entries(cont).map(([k, qtd]) => {
        const [quadro, etapa] = k.split('|');
        return { dia, quadro, etapa, qtd };
      });
      for (let i = 0; i < funil.length; i += 500) {
        await db.from('bi_funil_historico').upsert(funil.slice(i, i + 500), { onConflict: 'dia,quadro,etapa' });
      }
    } catch (e) { stats.erros.push(`funil historico: ${e.message}`.slice(0, 150)); }
    for (let i = 0; i < logs.length; i += 500) {
      const { error } = await db.from('bi_processos_log').insert(logs.slice(i, i + 500));
      if (error) throw new Error(`bi_processos_log: ${error.message}`);
    }
    stats.processos = rows.length; stats.mudancas = logs.length;

    // ---------- 1b) PROCESSO NOVO: importa o historico COMPLETO de andamentos ----------
    // Um processo cadastrado hoje pode trazer anos de andamentos importados do
    // tribunal — o monitor incremental so pegaria os futuros. Aqui puxamos o
    // historico inteiro (1 GET por processo novo; entra como historico, sem
    // alerta de novidade). Cap de 40/rodada por seguranca (excedente: proxima rodada).
    for (const novo of novos.slice(0, 40)) {
      try {
        const movs = await adv.getMovements(novo.lawsuit_id, 1000);
        const movRows = movs.map(mv => ({
          kind: 'movement',
          item_key: `${novo.lawsuit_id}:${mv.date}:${hashKey(mv.title || '')}`,
          lawsuit_id: novo.lawsuit_id,
          process_number: mv.process_number || novo.process_number || null,
          customer_name: typeof mv.customers === 'string' ? mv.customers : (novo.clientes || null),
          title: (mv.title || '').slice(0, 1000), event_date: mv.date || null,
          payload: { header: mv.header || null, processo_novo: true },
          communicated: true, communicated_at: new Date().toISOString(),
        }));
        if (movRows.length) await bulkRecordSyncItems(movRows);
        stats.processos_novos++;
      } catch (e) {
        stats.erros.push(`historico proc novo ${novo.lawsuit_id}: ${e.message}`.slice(0, 150));
        await logAdvbox('snapshot', 'erro', `histórico do processo novo ${novo.lawsuit_id} falhou: ${e.message}`, { lawsuit_id: novo.lawsuit_id });
      }
    }
    if (novos.length > 40) {
      await logAdvbox('snapshot', 'aviso', `${novos.length} processos novos detectados; histórico de ${novos.length - 40} fica para a próxima rodada`, {});
    }
  } catch (e) { stats.erros.push(`processos: ${e.message}`.slice(0, 150)); }

  // ---------- 2) CLIENTES ----------
  try {
    const rows = [];
    for (let off = 0, page = 0; page < MAX_PAGES; off += PAGE, page++) {
      const { items } = await adv.getCustomersPage(off, PAGE);
      if (!items.length) break;
      for (const c of items) {
        rows.push({
          customer_id: c.id, nome: txt(c.name), cpf_cnpj: txt(c.identification),
          email: txt(c.email), celular: txt(c.cellphone), telefone: txt(c.phone),
          cidade: txt(c.city), uf: txt(c.state), profissao: txt(c.occupation),
          estado_civil: txt(c.civil_status), genero: txt(c.gender),
          nascimento: birthOr(c.birthdate ?? c.birth_date ?? c.birthday ?? c.date_birth), origem: txt(c.origin), criado_em_advbox: txt(c.created_at),
          qtd_processos: (c.lawsuits || []).length,
          eh_pf: ehPF(c.name, c.identification, c.origin),
          // endereco do AdvBox: street=logradouro(+nº/compl inline), region=bairro,
          // postalcode=cep, document=RG (identification ja e o CPF/CNPJ)
          logradouro: txt(c.street), cep: txt(c.postalcode), bairro: txt(c.region), rg: txt(c.document),
          atualizado_em: new Date().toISOString(),
        });
      }
      if (items.length < PAGE) break;
    }
    await upsertChunks('bi_clientes', rows, 'customer_id');
    stats.clientes = rows.length;
    stats.clientes_com_nascimento = rows.filter((r) => r.nascimento).length;
    stats.clientes_com_endereco = rows.filter((r) => r.logradouro || r.cep).length;
  } catch (e) { stats.erros.push(`clientes: ${e.message}`.slice(0, 150)); }

  // ---------- 3) FINANCEIRO ----------
  try {
    const rows = [];
    for (let off = 0, page = 0; page < MAX_PAGES; off += PAGE, page++) {
      const { items } = await adv.getTransactionsPage(off, PAGE);
      if (!items.length) break;
      for (const t of items) {
        rows.push({
          transaction_id: t.id, tipo: txt(t.entry_type),
          vencimento: dateOr(t.date_due), pagamento: dateOr(t.date_payment), competencia: txt(t.competence),
          valor: Number(t.amount) || null, descricao: txt(t.description), responsavel: txt(t.responsible),
          categoria: txt(t.category), lawsuit_id: t.lawsuit_id || null, processo: txt(t.process_number),
          cliente: txt(t.name), cpf_cnpj: txt(t.identification),
          banco_debito: txt(t.debit_bank), banco_credito: txt(t.credit_bank), centro_custo: txt(t.cost_center),
          atualizado_em: new Date().toISOString(),
        });
      }
      if (items.length < PAGE) break;
    }
    await upsertChunks('bi_financeiro', rows, 'transaction_id');
    stats.financeiro = rows.length;
  } catch (e) { stats.erros.push(`financeiro: ${e.message}`.slice(0, 150)); }

  try {
    await db.from('bot_config').upsert({
      key: 'snapshot_status',
      value: { last_run: started.toISOString(), duracao_s: Math.round((Date.now() - started.getTime()) / 1000), ...stats },
      updated_at: new Date().toISOString(),
    });
  } catch { /* nao critico */ }
  for (const e of stats.erros) await logAdvbox('snapshot', 'erro', e, { run: started.toISOString() });
  await logAdvbox('snapshot', stats.erros.length ? 'aviso' : 'info',
    `Espelho de cadastros atualizado: ${stats.processos} processos (${stats.mudancas} mudanças de fase${stats.processos_novos ? `, ${stats.processos_novos} novos c/ histórico importado` : ''}), ${stats.clientes} clientes, ${stats.financeiro} lançamentos${stats.erros.length ? ` — ${stats.erros.length} erro(s)` : ''}`,
    stats);
  // enriquecimento ViaCEP (fire-and-forget): cacheia CEPs novos p/ o ciclo noturno aplicar
  try { await fetch('https://contratos-cbc.netlify.app/.netlify/functions/viacep-enrich-background', { method: 'POST' }); } catch { /* nao critico */ }
  console.log('[advbox-snapshot]', JSON.stringify(stats));
  return new Response('ok');
};

export const config = { path: '/.netlify/functions/advbox-snapshot-worker-background' };
