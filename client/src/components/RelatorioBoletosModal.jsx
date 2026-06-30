/**
 * Relatório parametrizado de boletos (aba Boletos) — PDF e Excel.
 * Filtros: período (por vencimento ou pagamento), status e cliente.
 * Lê asaas_boletos direto (sessão autenticada do sistema) e gera os
 * arquivos no navegador (jspdf / xlsx carregados sob demanda).
 */
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { XMarkIcon, DocumentArrowDownIcon, TableCellsIcon } from '@heroicons/react/24/outline';

const PAGOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'];
const STATUS_OPCOES = [
  { v: 'todos', label: 'Todos' },
  { v: 'pagos', label: 'Pagos' },
  { v: 'abertos', label: 'Em aberto (pend. + venc.)' },
  { v: 'pendentes', label: 'Pendentes' },
  { v: 'vencidos', label: 'Vencidos' },
];
const COLS = ['cliente', 'cpf', 'valor', 'liquido', 'status', 'vencimento', 'pagamento', 'parcela', 'tipo', 'descricao'];
const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
// (R13) cobre TODOS os status do Asaas usados no painel — antes faltavam 7 e o
// relatorio mostrava o codigo cru em ingles (ex.: "AWAITING_RISK_ANALYSIS").
const STATUS_PT = {
  RECEIVED: 'Pago', CONFIRMED: 'Confirmado', RECEIVED_IN_CASH: 'Pago (dinheiro)', DUNNING_RECEIVED: 'Recuperado',
  PENDING: 'Pendente', OVERDUE: 'Vencido', DELETED: 'Excluído', REFUNDED: 'Estornado',
  REFUND_REQUESTED: 'Estorno solicitado', REFUND_IN_PROGRESS: 'Estornando',
  CHARGEBACK_REQUESTED: 'Chargeback', CHARGEBACK_DISPUTE: 'Em disputa',
  AWAITING_CHARGEBACK_REVERSAL: 'Aguard. estorno', AWAITING_RISK_ANALYSIS: 'Análise risco',
  DUNNING_REQUESTED: 'Em negativação',
};

export default function RelatorioBoletosModal({ open, onClose }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ tipo: 'detalhado', base: 'due_date', ini: hoje.slice(0, 8) + '01', fim: '', status: 'todos', cliente: '' });
  const [busy, setBusy] = useState('');
  const [erro, setErro] = useState('');
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  if (!open) return null;

  async function buscar() {
    let q = supabase.from('asaas_boletos')
      .select('customer_name, customer_cpf, value, net_value, status, due_date, payment_date, description, installment_number, installment_total, billing_type');
    if (f.ini) q = q.gte(f.base, f.ini);
    if (f.fim) q = q.lte(f.base, f.fim);
    if (f.base === 'payment_date') q = q.not('payment_date', 'is', null);
    if (f.status === 'pagos') q = q.in('status', PAGOS);
    if (f.status === 'abertos') q = q.in('status', ['PENDING', 'OVERDUE']);
    if (f.status === 'pendentes') q = q.eq('status', 'PENDING');
    // (R12) "vencidos" tambem pega PENDING cujo vencimento ja passou — o Asaas
    // demora a virar p/ OVERDUE, entao so olhar status escondia inadimplentes.
    if (f.status === 'vencidos') q = q.or(`status.eq.OVERDUE,and(status.eq.PENDING,due_date.lt.${hoje})`);
    if (f.status === 'todos') q = q.not('status', 'in', '("DELETED")');
    const t = f.cliente.trim();
    if (t) {
      const d = t.replace(/\D/g, '');
      q = d.length >= 5 ? q.or(`customer_name.ilike.%${t}%,customer_cpf.ilike.%${d}%`) : q.ilike('customer_name', `%${t}%`);
    }
    const { data, error } = await q.order(f.base, { ascending: true }).limit(5000);
    if (error) throw new Error(error.message);
    return (data || []).map((b) => ({
      cliente: b.customer_name || '',
      cpf: b.customer_cpf || '',
      valor: Number(b.value) || 0,
      liquido: Number(b.net_value) || 0,
      status: STATUS_PT[b.status] || b.status,
      vencimento: dataBR(b.due_date),
      pagamento: dataBR(b.payment_date),
      parcela: b.installment_number && b.installment_total ? `${b.installment_number}/${b.installment_total}` : '',
      tipo: b.billing_type || '',
      descricao: b.description || '',
    }));
  }

  // inadimplência por cliente: total em aberto + tempo desde o 1º inadimplemento,
  // ordenado do maior valor em aberto para o menor
  async function buscarInadimplencia() {
    let q = supabase.from('asaas_boletos')
      .select('customer_name, customer_cpf, value, due_date')
      .or(`status.eq.OVERDUE,and(status.eq.PENDING,due_date.lt.${hoje})`);
    if (f.ini) q = q.gte('due_date', f.ini);
    if (f.fim) q = q.lte('due_date', f.fim);
    const t = f.cliente.trim();
    if (t) {
      const d = t.replace(/\D/g, '');
      q = d.length >= 5 ? q.or(`customer_name.ilike.%${t}%,customer_cpf.ilike.%${d}%`) : q.ilike('customer_name', `%${t}%`);
    }
    const { data, error } = await q.limit(5000);
    if (error) throw new Error(error.message);
    const grupos = {};
    for (const b of data || []) {
      const chave = (b.customer_cpf || '').replace(/\D/g, '') || b.customer_name || '?';
      const g = grupos[chave] || (grupos[chave] = { cliente: b.customer_name || '', cpf: b.customer_cpf || '', parcelas: 0, total: 0, primeiro: b.due_date });
      g.parcelas += 1;
      g.total += Number(b.value) || 0;
      if (b.due_date && b.due_date < g.primeiro) g.primeiro = b.due_date;
    }
    const agora = new Date(hoje).getTime();
    return Object.values(grupos)
      .map((g) => ({
        ...g,
        primeiro_venc: dataBR(g.primeiro),
        dias_atraso: Math.max(0, Math.floor((agora - new Date(g.primeiro).getTime()) / 86400000)),
      }))
      .sort((a, b) => b.total - a.total);
  }

  const descreveFiltros = () =>
    `${f.base === 'due_date' ? 'Por vencimento' : 'Por pagamento'}${f.ini ? ` de ${dataBR(f.ini)}` : ''}${f.fim ? ` até ${dataBR(f.fim)}` : ''}` +
    ` · Status: ${STATUS_OPCOES.find((s) => s.v === f.status)?.label}${f.cliente.trim() ? ` · Cliente: ${f.cliente.trim()}` : ''}`;

  async function gerar(tipo) {
    setBusy(tipo); setErro('');
    try {
      if (f.tipo === 'inadimplencia') { await gerarInadimplencia(tipo); setBusy(''); return; }
      const rows = await buscar();
      if (!rows.length) { setErro('Nenhum boleto encontrado com esses filtros.'); setBusy(''); return; }
      const total = rows.reduce((s, r) => s + r.valor, 0);
      const liquido = rows.reduce((s, r) => s + r.liquido, 0);
      const nome = `boletos_${f.ini || 'inicio'}_${f.fim || 'hoje'}`;

      if (tipo === 'xlsx') {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        const resumo = [
          { campo: 'Filtros', valor: descreveFiltros() },
          { campo: 'Boletos', valor: rows.length },
          { campo: 'Valor total', valor: total },
          { campo: 'Valor líquido', valor: liquido },
          { campo: 'Gerado em', valor: new Date().toLocaleString('pt-BR') },
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => {
          const o = {}; COLS.forEach((c) => { o[c] = r[c]; }); return o;
        })), 'Boletos');
        XLSX.writeFile(wb, `${nome}.xlsx`);
      } else {
        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF({ orientation: 'landscape' });
        const W = doc.internal.pageSize.getWidth();
        let y = 16;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor('#1B3A5C');
        doc.text('Relatório de Boletos — CBC Advogados', 14, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor('#555555');
        y += 5.5; doc.text(`${descreveFiltros()} · gerado em ${new Date().toLocaleString('pt-BR')}`, 14, y);
        y += 5.5;
        doc.setFont('helvetica', 'bold'); doc.setTextColor('#1B3A5C');
        doc.text(`${rows.length} boletos · Total ${BRL(total)} · Líquido ${BRL(liquido)}`, 14, y);
        doc.setDrawColor('#C9A84C'); doc.line(14, y + 2, W - 14, y + 2);
        // colunas fixas (paisagem)
        const X = { cliente: 14, cpf: 96, venc: 126, pgto: 148, valor: 170, status: 196, parcela: 224, desc: 238 };
        const cab = () => {
          y += 7; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor('#1B3A5C');
          doc.text('Cliente', X.cliente, y); doc.text('CPF', X.cpf, y); doc.text('Venc.', X.venc, y);
          doc.text('Pgto.', X.pgto, y); doc.text('Valor', X.valor, y); doc.text('Status', X.status, y);
          doc.text('Parc.', X.parcela, y); doc.text('Descrição', X.desc, y);
          doc.setFont('helvetica', 'normal'); doc.setTextColor('#222222');
        };
        cab();
        for (const r of rows) {
          y += 5;
          if (y > 195) { doc.addPage(); y = 14; cab(); y += 5; }
          doc.text(String(r.cliente).slice(0, 45), X.cliente, y);
          doc.text(String(r.cpf), X.cpf, y);
          doc.text(r.vencimento, X.venc, y);
          doc.text(r.pagamento, X.pgto, y);
          doc.text(BRL(r.valor), X.valor, y);
          doc.text(String(r.status), X.status, y);
          doc.text(String(r.parcela), X.parcela, y);
          doc.text(String(r.descricao).slice(0, 32), X.desc, y);
        }
        doc.save(`${nome}.pdf`);
      }
    } catch (e) { setErro(e.message); }
    setBusy('');
  }

  async function gerarInadimplencia(tipo) {
    const rows = await buscarInadimplencia();
    if (!rows.length) { setErro('Nenhum cliente inadimplente com esses filtros. 🎉'); return; }
    const total = rows.reduce((s, r) => s + r.total, 0);
    const parcelas = rows.reduce((s, r) => s + r.parcelas, 0);
    const maiorAtraso = Math.max(...rows.map((r) => r.dias_atraso));
    const nome = `inadimplencia_${hoje}`;
    const filtros = `Vencidos até ${dataBR(hoje)}${f.ini ? ` · vencimento de ${dataBR(f.ini)}` : ''}${f.fim ? ` até ${dataBR(f.fim)}` : ''}${f.cliente.trim() ? ` · Cliente: ${f.cliente.trim()}` : ''}`;

    if (tipo === 'xlsx') {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        { campo: 'Filtros', valor: filtros },
        { campo: 'Clientes inadimplentes', valor: rows.length },
        { campo: 'Parcelas vencidas', valor: parcelas },
        { campo: 'Total em aberto', valor: total },
        { campo: 'Maior atraso (dias)', valor: maiorAtraso },
        { campo: 'Gerado em', valor: new Date().toLocaleString('pt-BR') },
      ]), 'Resumo');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => ({
        cliente: r.cliente, cpf: r.cpf, parcelas_vencidas: r.parcelas, total_em_aberto: r.total,
        primeiro_vencimento: r.primeiro_venc, dias_em_atraso: r.dias_atraso,
      }))), 'Inadimplentes');
      XLSX.writeFile(wb, `${nome}.xlsx`);
    } else {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'landscape' });
      const W = doc.internal.pageSize.getWidth();
      let y = 16;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor('#1B3A5C');
      doc.text('Inadimplência por Cliente — CBC Advogados', 14, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor('#555555');
      y += 5.5; doc.text(`${filtros} · gerado em ${new Date().toLocaleString('pt-BR')}`, 14, y);
      y += 5.5;
      doc.setFont('helvetica', 'bold'); doc.setTextColor('#DC2626');
      doc.text(`${rows.length} clientes · ${parcelas} parcelas vencidas · Total em aberto ${BRL(total)} · maior atraso ${maiorAtraso} dias`, 14, y);
      doc.setDrawColor('#C9A84C'); doc.line(14, y + 2, W - 14, y + 2);
      const X = { n: 14, cliente: 22, cpf: 116, parc: 150, total: 172, primeiro: 206, dias: 240 };
      const cab = () => {
        y += 7; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor('#1B3A5C');
        doc.text('#', X.n, y); doc.text('Cliente', X.cliente, y); doc.text('CPF', X.cpf, y);
        doc.text('Parcelas', X.parc, y); doc.text('Total em aberto', X.total, y);
        doc.text('1º vencimento', X.primeiro, y); doc.text('Dias em atraso', X.dias, y);
        doc.setFont('helvetica', 'normal'); doc.setTextColor('#222222');
      };
      cab();
      rows.forEach((r, i) => {
        y += 5;
        if (y > 195) { doc.addPage(); y = 14; cab(); y += 5; }
        doc.text(String(i + 1), X.n, y);
        doc.text(String(r.cliente).slice(0, 52), X.cliente, y);
        doc.text(String(r.cpf), X.cpf, y);
        doc.text(String(r.parcelas), X.parc, y);
        doc.setFont('helvetica', 'bold');
        doc.text(BRL(r.total), X.total, y);
        doc.setFont('helvetica', 'normal');
        doc.text(r.primeiro_venc, X.primeiro, y);
        doc.text(`${r.dias_atraso}`, X.dias, y);
      });
      doc.save(`${nome}.pdf`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,32,53,.55)' }} onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg p-5 max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-[#1B3A5C] dark:text-white" style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22 }}>
            Relatório de boletos
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><XMarkIcon className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 text-xs font-bold uppercase tracking-wide opacity-60">Tipo de relatório</label>
          <div className="col-span-2 grid grid-cols-2 gap-2">
            {[['detalhado', 'Boletos (detalhado)'], ['inadimplencia', 'Inadimplência por cliente']].map(([v, label]) => (
              <button key={v} onClick={() => { set('tipo', v); if (v === 'inadimplencia') set('ini', ''); }}
                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${f.tipo === v
                  ? 'bg-[#1B3A5C] text-white border-[#1B3A5C]'
                  : 'border-gray-200 dark:border-gray-600 opacity-70 hover:opacity-100'}`}>
                {label}
              </button>
            ))}
          </div>

          <label className="col-span-2 text-xs font-bold uppercase tracking-wide opacity-60">
            {f.tipo === 'inadimplencia' ? 'Período do vencimento (opcional)' : 'Período'}
          </label>
          {f.tipo === 'detalhado' && (
            <select value={f.base} onChange={(e) => set('base', e.target.value)}
              className="col-span-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
              <option value="due_date">Por data de vencimento</option>
              <option value="payment_date">Por data de pagamento</option>
            </select>
          )}
          <input type="date" value={f.ini} onChange={(e) => set('ini', e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
          <input type="date" value={f.fim} onChange={(e) => set('fim', e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />

          {f.tipo === 'detalhado' && (
            <>
              <label className="text-xs font-bold uppercase tracking-wide opacity-60 self-center">Status</label>
              <select value={f.status} onChange={(e) => set('status', e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700">
                {STATUS_OPCOES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </>
          )}

          <label className="text-xs font-bold uppercase tracking-wide opacity-60 self-center">Cliente</label>
          <input value={f.cliente} onChange={(e) => set('cliente', e.target.value)} placeholder="nome ou CPF (opcional)"
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
        </div>

        {erro && <p className="text-xs text-red-600 dark:text-red-400 mt-3">{erro}</p>}
        <p className="text-[11px] opacity-50 mt-3">
          {f.tipo === 'inadimplencia'
            ? 'Lista cada cliente com parcelas vencidas: total em aberto (do maior para o menor), nº de parcelas e dias desde o primeiro inadimplemento.'
            : 'Deixe as datas vazias para incluir tudo. Limite de 5.000 boletos por relatório.'}
        </p>

        <div className="flex gap-2 mt-4">
          <button onClick={() => gerar('pdf')} disabled={!!busy}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-xs font-bold hover:opacity-90 disabled:opacity-50">
            <DocumentArrowDownIcon className={`w-4 h-4 ${busy === 'pdf' ? 'animate-bounce' : ''}`} /> {busy === 'pdf' ? 'Gerando…' : 'Gerar PDF'}
          </button>
          <button onClick={() => gerar('xlsx')} disabled={!!busy}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-white text-xs font-bold hover:opacity-90 disabled:opacity-50" style={{ background: '#1D6F42' }}>
            <TableCellsIcon className={`w-4 h-4 ${busy === 'xlsx' ? 'animate-bounce' : ''}`} /> {busy === 'xlsx' ? 'Gerando…' : 'Gerar Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}
