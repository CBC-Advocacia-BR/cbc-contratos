import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../utils/friendlyError';
import { SkeletonBoletos } from './Skeleton';
import ErrorState from './ErrorState';
import RelatorioBoletosModal from './RelatorioBoletosModal';
import InadimplenciaStrip from './InadimplenciaStrip';
import CobrancaPanel from './CobrancaPanel';
import CobrancaHistorico from './CobrancaHistorico';
import { usePersistedFilter } from '../hooks/usePersistedFilters';
import { isPaidStatus, isNeutralStatus, isRemovedStatus } from '../lib/statusTokens';
import StatusPill from './ui/StatusPill';
import MoneyValue from './ui/MoneyValue';
import {
  DocumentIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  FireIcon,
  EyeIcon,
  DocumentTextIcon,
  HashtagIcon,
  DevicePhoneMobileIcon,
  ReceiptPercentIcon,
  StarIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  CalendarDaysIcon,
  LightBulbIcon,
  TrophyIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  Bars3Icon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';

const fmt = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const daysUntil = d => {
  if (!d) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(d + 'T12:00:00');
  return Math.floor((due - now) / 86400000);
};
const onlyDigits = s => (s || '').replace(/\D/g, '');
// Normaliza removendo acentos e caracteres especiais (busca "joao" → "João")
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '').toLowerCase();

// Status de pagamento agora vem de StatusPill (domain="pagamento") +
// STATUS_TOKENS — o mapa local de cores/labels (STATUS) foi removido na
// migracao para a UI primitiva (20/06/2026).

// Buckets de status (PAID / NEUTRAL / REMOVED / OPEN) — fonte UNICA em
// lib/statusTokens (derivada de STATUS_TOKENS.pagamento). Paridade com a versao
// anterior garantida por utils/__tests__/statusTokens.test.js. OPEN (nao-pago,
// nao-neutro, nao-removido) = inadimplencia. isPaidStatus/isNeutralStatus/
// isRemovedStatus sao importados do mesmo modulo (ver topo do arquivo).
// (fix 31/05) DUNNING_RECEIVED conta como pago (bucket PAID), nao infla inadimplencia.

// Toast simples
function useToast() {
  const [msg, setMsg] = useState('');
  const show = useCallback((m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); }, []);
  const T = msg ? <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-2xl z-[200] animate-[fadeIn_0.2s] toast-above-dock">{msg}</div> : null;
  return [T, show];
}

// Copiar texto
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Download boleto PDF
async function downloadBoleto(boleto) {
  if (!boleto.bank_slip_url) return;
  try {
    const r = await fetch(boleto.bank_slip_url);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const inst = boleto.installment_number ? `_${boleto.installment_number}` : '';
    const name = (boleto.customer_name || boleto.id).replace(/[^\w]+/g, '_');
    a.download = `Boleto_${name}${inst}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(boleto.bank_slip_url, '_blank');
  }
}

function PreviewModal({ boleto, onClose }) {
  if (!boleto) return null;
  return (
    <div className="fixed inset-0 modal-backdrop-glass z-[250] flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-glass rounded-xl w-full max-w-4xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-3 border-b flex items-center justify-between">
          <div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary)' }}>
            {boleto.customer_name} · {fmt(boleto.value)} · vence {fmtD(boleto.due_date)}
          </div>
          <div className="flex gap-2">
            <button onClick={() => downloadBoleto(boleto)} className="px-3 py-1 rounded bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 inline-flex items-center gap-1"><DocumentIcon className="w-3.5 h-3.5" aria-hidden="true" /> Baixar</button>
            <button onClick={onClose} className="px-3 py-1 rounded bg-gray-100 text-gray-600 text-[10px] font-bold hover:bg-gray-200">Fechar</button>
          </div>
        </div>
        <iframe src={boleto.bank_slip_url} className="flex-1 w-full" title="Boleto" />
      </div>
    </div>
  );
}

function NotesModal({ customer, userEmail, onClose, onToast }) {
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('asaas_customer_notes')
      .select('*').eq('customer_id', customer.id).order('created_at', { ascending: false });
    setNotes(data || []);
    setLoading(false);
  }, [customer.id]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    if (!newNote.trim()) return;
    const { error } = await supabase.from('asaas_customer_notes').insert({
      customer_id: customer.id, note: newNote.trim(), author_email: userEmail || null,
    });
    if (error) { console.error('[BoletosPanel] add nota:', error); onToast('⚠️ ' + friendlyError(error)); return; }
    setNewNote('');
    load();
  };
  return (
    <div className="fixed inset-0 modal-backdrop-glass z-[250] flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-glass rounded-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b">
          <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><PencilSquareIcon className="w-4 h-4" aria-hidden="true" /> Notas · {customer.name}</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? <div className="text-center text-gray-400 text-xs">Carregando...</div> :
            notes.length === 0 ? <div className="text-center text-gray-400 text-xs">Nenhuma nota ainda</div> :
            notes.map(n => (
              <div key={n.id} className="bg-yellow-50 border border-yellow-100 rounded-lg p-2">
                <div className="text-[11px] text-gray-700 whitespace-pre-wrap">{n.note}</div>
                <div className="text-[9px] text-gray-400 mt-1">
                  {n.author_email?.split('@')[0] || 'anônimo'} · {new Date(n.created_at).toLocaleString('pt-BR')}
                </div>
              </div>
            ))}
        </div>
        <div className="p-3 border-t flex gap-2">
          <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Nova observação..."
            className="flex-1 border rounded-lg px-2 py-1 text-[11px] resize-none" rows={2} />
          <div className="flex flex-col gap-1">
            <button onClick={add} className="px-3 py-1 rounded-lg text-white text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40" style={{ background: 'var(--cbc-navy)' }}>Salvar</button>
            <button onClick={onClose} className="px-3 py-1 rounded-lg border border-gray-200 text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40" style={{ color: 'var(--cbc-text-secondary)' }}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

async function genExecutivePDF(stats) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const w = pdf.internal.pageSize.getWidth();
  const now = new Date();
  const monthStr = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  pdf.setFillColor(26, 46, 82);
  pdf.rect(0, 0, w, 24, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
  pdf.text('RELATÓRIO EXECUTIVO · BOLETOS', 20, 12);
  pdf.setFontSize(9); pdf.setFont(undefined, 'normal');
  pdf.text(`${monthStr} · Gerado em ${now.toLocaleString('pt-BR')}`, 20, 18);
  pdf.setTextColor(30, 30, 30);
  let y = 36;
  const totalEmitido = (stats.totalPending || 0) + (stats.totalOverdue || 0) + (stats.totalPaid || 0);
  const lines = [
    ['Total de clientes', String(stats.clients)],
    ['Boletos pendentes', `${stats.pending} · ${fmt(stats.totalPending)}`],
    ['Boletos vencidos', `${stats.overdue} · ${fmt(stats.totalOverdue)}`],
    ['Boletos pagos', `${stats.paid} · ${fmt(stats.totalPaid)}`],
    ['Total emitido', fmt(totalEmitido)],
    ['Taxa de inadimplência', `${stats.inadimp.toFixed(2)}%`],
  ];
  pdf.setFontSize(10);
  lines.forEach(([l, v]) => {
    pdf.setFont(undefined, 'normal'); pdf.text(l, 22, y);
    pdf.setFont(undefined, 'bold'); pdf.text(v, w - 22, y, { align: 'right' });
    y += 7;
  });
  y += 6;
  pdf.setFont(undefined, 'bold'); pdf.setFontSize(11);
  pdf.setTextColor(220, 38, 38);
  pdf.text('TOP 10 CALOTEIROS', 22, y); y += 7;
  pdf.setTextColor(30, 30, 30); pdf.setFontSize(9);
  (stats.topDebtors || []).forEach((d, i) => {
    pdf.setFont(undefined, 'normal');
    pdf.text(`${i + 1}. ${d.name}`, 22, y);
    pdf.setFont(undefined, 'bold');
    pdf.text(fmt(d.total), w - 22, y, { align: 'right' });
    y += 6;
  });
  const blob = pdf.output('blob');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Relatorio_Boletos_${now.toISOString().slice(0, 7)}.pdf`;
  a.click();
}

async function genDelinquencyReport(customers, customerStats) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const w = pdf.internal.pageSize.getWidth();
  const now = new Date();
  pdf.setFillColor(220, 38, 38);
  pdf.rect(0, 0, w, 20, 'F');
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(13); pdf.setFont(undefined, 'bold');
  pdf.text('INADIMPLÊNCIA POR CLIENTE', 20, 12);
  pdf.setTextColor(30, 30, 30);
  let y = 32;
  pdf.setFontSize(8); pdf.setFont(undefined, 'bold');
  pdf.text('CLIENTE', 22, y);
  pdf.text('VENCIDO', 120, y);
  pdf.text('DIAS', 155, y);
  pdf.text('TOTAL', 180, y);
  y += 5;
  pdf.line(20, y, w - 20, y); y += 4;
  pdf.setFont(undefined, 'normal');
  const rows = customers
    .map(c => ({ c, s: customerStats[c.id] || {} }))
    .filter(x => (x.s.overdueTotal || 0) > 0)
    .sort((a, b) => (b.s.overdueTotal || 0) - (a.s.overdueTotal || 0));
  rows.forEach(({ c, s }) => {
    if (y > 280) { pdf.addPage(); y = 20; }
    const name = (c.name || '').slice(0, 48);
    pdf.text(name, 22, y);
    pdf.text(fmt(s.overdueTotal), 120, y);
    pdf.text(String(s.maxOverdueDays || 0), 155, y);
    pdf.text(fmt(s.total || 0), 180, y);
    y += 5;
  });
  y += 6;
  pdf.setFont(undefined, 'bold');
  pdf.text(`TOTAL: ${rows.length} clientes inadimplentes`, 22, y);
  const blob = pdf.output('blob');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Inadimplencia_${now.toISOString().slice(0, 10)}.pdf`;
  a.click();
}

// Carrega logo PNG como dataURL para embed no jsPDF
let _logoCache = null;
async function loadLogoDataURL() {
  if (_logoCache) return _logoCache;
  try {
    const r = await fetch('/logo-white.png');
    const blob = await r.blob();
    _logoCache = await new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
    return _logoCache;
  } catch { return null; }
}

// Gera descritivo de pagamento (apenas boletos pagos) em PDF e retorna bytes
async function buildPaymentStatementPDF(clientName, paidBoletos, { withNFsNote = true } = {}) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const logo = await loadLogoDataURL();

  // Header com logo
  pdf.setFillColor(26, 46, 82);
  pdf.rect(0, 0, w, 30, 'F');
  if (logo) {
    try { pdf.addImage(logo, 'PNG', 15, 6, 18, 18); } catch { /* logo opcional no cabecalho */ }
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(13); pdf.setFont(undefined, 'bold');
  pdf.text('CONFORTO, BERGONSI & CAVALARI', 38, 14);
  pdf.setFontSize(9); pdf.setFont(undefined, 'normal');
  pdf.text('Sociedade de Advogados · OAB/SP 55.227', 38, 19);
  pdf.text('Rua Guatemala, 122 · Jd. Santo Antônio · Americana/SP', 38, 24);

  pdf.setTextColor(26, 46, 82);
  pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
  pdf.text('DESCRITIVO DE PAGAMENTOS', w / 2, 44, { align: 'center' });

  pdf.setTextColor(80, 80, 80);
  pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
  pdf.text(`Cliente: `, 15, 54);
  pdf.setFont(undefined, 'bold');
  pdf.text(clientName, 32, 54);
  pdf.setFont(undefined, 'normal');
  pdf.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, 15, 60);

  // Tabela
  let y = 72;
  pdf.setFillColor(240, 244, 248);
  pdf.rect(15, y - 5, w - 30, 8, 'F');
  pdf.setTextColor(26, 46, 82);
  pdf.setFontSize(9); pdf.setFont(undefined, 'bold');
  pdf.text('DATA PAG.', 17, y);
  pdf.text('DESCRIÇÃO', 42, y);
  pdf.text('NF', 138, y);
  pdf.text('VALOR', w - 17, y, { align: 'right' });
  y += 8;

  pdf.setTextColor(30, 30, 30);
  pdf.setFont(undefined, 'normal'); pdf.setFontSize(9);

  const sorted = [...paidBoletos].sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''));
  let total = 0;
  sorted.forEach((b, idx) => {
    if (y > h - 30) {
      pdf.addPage();
      y = 20;
    }
    if (idx % 2 === 0) {
      pdf.setFillColor(250, 250, 252);
      pdf.rect(15, y - 4, w - 30, 7, 'F');
    }
    const val = Number(b.value || 0);
    total += val;
    const desc = (b.description || '—').slice(0, 55);
    const hasNF = !!b.nf_number;
    const nf = hasNF ? String(b.nf_number) : 'Manual*';
    pdf.text(fmtD(b.payment_date || b.due_date), 17, y);
    pdf.text(desc, 42, y);
    if (!hasNF) {
      pdf.setTextColor(200, 151, 58);
      pdf.setFont(undefined, 'bold');
    }
    pdf.text(nf, 138, y);
    if (!hasNF) {
      pdf.setTextColor(30, 30, 30);
      pdf.setFont(undefined, 'normal');
    }
    pdf.text(fmt(val), w - 17, y, { align: 'right' });
    y += 7;
  });

  // Total
  y += 4;
  pdf.setDrawColor(200, 151, 58);
  pdf.setLineWidth(0.5);
  pdf.line(15, y, w - 15, y);
  y += 7;
  pdf.setFillColor(26, 46, 82);
  pdf.rect(w - 95, y - 6, 80, 10, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(11); pdf.setFont(undefined, 'bold');
  pdf.text('TOTAL PAGO', w - 92, y + 1);
  pdf.text(fmt(total), w - 17, y + 1, { align: 'right' });

  // Aviso de NFs manuais
  const hasManual = sorted.some(b => !b.nf_number);
  if (hasManual) {
    y += 14;
    if (y > h - 30) { pdf.addPage(); y = 20; }
    pdf.setFillColor(255, 250, 235);
    pdf.setDrawColor(200, 151, 58);
    pdf.setLineWidth(0.3);
    pdf.rect(15, y - 5, w - 30, 16, 'FD');
    pdf.setTextColor(200, 151, 58);
    pdf.setFontSize(9); pdf.setFont(undefined, 'bold');
    pdf.text('* NOTA FISCAL EMITIDA MANUALMENTE', 18, y);
    pdf.setTextColor(80, 80, 80);
    pdf.setFont(undefined, 'normal'); pdf.setFontSize(8);
    pdf.text('Os itens marcados como "Manual*" possuem nota fiscal emitida manualmente pelo escritório,', 18, y + 4);
    pdf.text('fora do Asaas. Para obter uma cópia, favor entrar em contato com o setor financeiro.', 18, y + 8);
  }

  // Rodapé
  pdf.setTextColor(120, 120, 120);
  pdf.setFontSize(7); pdf.setFont(undefined, 'normal');
  const footerText = withNFsNote
    ? 'Documento gerado automaticamente pelo sistema interno CBC. As notas fiscais correspondentes seguem anexas.'
    : 'Documento gerado automaticamente pelo sistema interno CBC.';
  pdf.text(footerText, w / 2, h - 12, { align: 'center' });

  return new Uint8Array(pdf.output('arraybuffer'));
}

async function downloadPaymentStatement(clientName, paidBoletos) {
  const bytes = await buildPaymentStatementPDF(clientName, paidBoletos, { withNFsNote: false });
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Descritivo_${clientName.replace(/\s+/g, '_')}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Merge: descritivo + todas as NFs em 1 único PDF
async function mergeStatementAndNFs(clientName, paidBoletos, nfUrls) {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  // 1º doc: descritivo
  try {
    const statementBytes = await buildPaymentStatementPDF(clientName, paidBoletos, { withNFsNote: true });
    const src = await PDFDocument.load(statementBytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  } catch (e) { console.error('statement merge error', e); }
  // NFs
  for (const url of nfUrls) {
    try {
      const bytes = await fetch(url).then(r => r.arrayBuffer());
      const src = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    } catch (e) { console.error('nf merge error', url, e); }
  }
  const out = await merged.save();
  const blob = new Blob([out], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `NFs_${clientName.replace(/\s+/g, '_')}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function fetchBoletoCode(paymentId) {
  const r = await fetch('/.netlify/functions/asaas-boleto-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId }),
  });
  return r.json();
}

// ─── Row ───
function BoletoRow({ boleto, isClosest, onCopyPix, onOpenNF, onPreview, onToast, compact }) {
  const [copyingCode, setCopyingCode] = useState(false); // (QW#13) loading do copiar linha digitavel
  const days = daysUntil(boleto.due_date);
  const isPaid = isPaidStatus(boleto.status);
  const isNeutral = isNeutralStatus(boleto.status);
  const isRemoved = isRemovedStatus(boleto.status);
  const isPending = !isPaid && !isNeutral && !isRemoved;

  let dayLabel = '';
  if (isPending && days !== null) {
    if (days < 0) dayLabel = `${Math.abs(days)}d atrasado`;
    else if (days === 0) dayLabel = 'vence hoje';
    else dayLabel = `em ${days}d`;
  }

  // Urgência: vermelho (vencido), laranja (<=3d), amarelo (<=7d), verde (>7d), cinza (pago)
  // (side-tab removido) O sinal de urgencia agora vira uma bolinha tokenizada na propria
  // linha, em vez de uma borda colorida a esquerda. A linha "mais proxima" (isClosest)
  // recebe borda navy de 2px (selecao) + tint do warning.
  let urgencyColor = 'transparent';
  if (isPending && days !== null) {
    if (days < 0) urgencyColor = 'var(--cbc-danger)';
    else if (days <= 3) urgencyColor = 'var(--cbc-danger)';
    else if (days <= 7) urgencyColor = 'var(--cbc-warning)';
    else urgencyColor = 'var(--cbc-success)';
  }

  return (
    <div className={`flex items-center px-3 ${compact ? 'py-1.5' : 'py-2.5'} border-b border-gray-50 hover:bg-gray-50 text-[11px] max-sm:flex-wrap ${isRemoved ? 'opacity-60' : ''}`}
      style={{
        borderLeft: isClosest ? '2px solid var(--cbc-navy)' : '2px solid transparent',
        background: isClosest ? 'var(--cbc-warning-bg)' : undefined,
      }}>
      {isClosest && <FireIcon className="mr-2 w-4 h-4" style={{ color: 'var(--cbc-warning)' }} aria-label="Boleto com vencimento mais proximo" title="Boleto com vencimento mais próximo" />}
      {isPending && urgencyColor !== 'transparent' && (
        <span className="mr-2 w-2 h-2 rounded-full shrink-0" style={{ background: urgencyColor }} aria-hidden="true" />
      )}
      {/* Status */}
      <div className="w-[110px] shrink-0 flex">
        <StatusPill domain="pagamento" status={boleto.status} size="sm" />
      </div>
      {/* Parcela */}
      <div className="px-2 w-[60px] text-center text-[11px] tabular-nums" style={{ color: 'var(--cbc-text-secondary)' }}>
        {boleto.installment_number ? `${boleto.installment_number}/${boleto.installment_total}` : '—'}
      </div>
      {/* Venc */}
      <div className="px-2 w-[110px]">
        <div className="font-semibold tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}>{fmtD(boleto.due_date)}</div>
        {dayLabel && (
          <div className="text-[11px] font-medium tabular-nums"
            style={{ color: days < 0 ? 'var(--cbc-danger)' : days <= 3 ? 'var(--cbc-warning)' : 'var(--cbc-text-muted)' }}>
            {dayLabel}
          </div>
        )}
      </div>
      {/* Valor */}
      <div className="px-2 w-[100px] flex justify-end" style={{ color: 'var(--cbc-text-primary)' }}>
        <MoneyValue value={boleto.value} className="font-bold tabular-nums" />
      </div>
      {/* Descrição */}
      <div className="px-2 flex-1 truncate text-[11px]" style={{ color: 'var(--cbc-text-secondary)' }}>{boleto.description || '—'}</div>
      {/* Ações — boleto removido nao expoe nenhuma acao (abrir/linha digitavel/PIX/NF) */}
      <div className="px-2 flex items-center gap-1 max-sm:w-full max-sm:justify-end">
        {isRemoved && <span className="text-[11px] font-semibold italic" style={{ color: 'var(--cbc-text-muted)' }}>boleto removido</span>}
        {!isRemoved && boleto.bank_slip_url && (
          <>
            <button onClick={() => onPreview(boleto)}
              className="px-2 py-1 rounded bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 inline-flex items-center" title="Visualizar boleto" aria-label="Visualizar boleto">
              <EyeIcon className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button onClick={() => downloadBoleto(boleto)}
              className="px-2 py-1 rounded bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 inline-flex items-center" title="Baixar PDF" aria-label="Baixar PDF">
              <DocumentIcon className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button disabled={copyingCode} onClick={async () => {
              if (copyingCode) return;
              setCopyingCode(true);
              try {
                const d = await fetchBoletoCode(boleto.id);
                if (d.success && d.identificationField) {
                  await copyText(d.identificationField);
                  onToast('Linha digitavel copiada');
                } else onToast('Erro ao obter codigo');
              } finally { setCopyingCode(false); }
            }}
              className="px-2 py-1 rounded bg-indigo-50 text-indigo-600 text-[11px] font-bold hover:bg-indigo-100 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-wait" title="Copiar linha digitável" aria-label="Copiar linha digitavel">
              {copyingCode
                ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                : <HashtagIcon className="w-3.5 h-3.5" aria-hidden="true" />}
              {copyingCode ? 'Copiando...' : 'Copiar código'}
            </button>
          </>
        )}
        {isPending && boleto.pix_copy_paste && (
          <button onClick={() => onCopyPix(boleto.pix_copy_paste)}
            className="px-2 py-1 rounded bg-green-50 text-green-700 font-bold text-[9px] hover:bg-green-100 inline-flex items-center gap-1" title="Copiar código PIX">
            <DevicePhoneMobileIcon className="w-3.5 h-3.5" aria-hidden="true" /> PIX
          </button>
        )}
        {isPaid && boleto.nf_pdf_url && (
          <button onClick={() => onOpenNF(boleto)}
            className="px-2 py-1 rounded bg-purple-50 text-purple-700 font-bold text-[9px] hover:bg-purple-100 inline-flex items-center gap-1" title="Imprimir NF">
            <ReceiptPercentIcon className="w-3.5 h-3.5" aria-hidden="true" /> NF
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Client Card colapsável ───
// (perf 31/05) memoizado — so re-renderiza quando as props desta linha mudam, em vez
// de re-renderizar todos os cards a cada render do painel. Exige handlers estaveis (useCallback).
const ClientCard = memo(function ClientCard({ customer, statusFilter, compact, custStat, isFav, onToggleFav, onCopyPix, onOpenNF, onPreview, onPrintAllNFs, onToast, onOpenNotes, leadId, isSel, onSel }) {
  const [open, setOpen] = useState(false);
  const [boletos, setBoletos] = useState(null);
  const [loadingB, setLoadingB] = useState(false);

  const loadBoletos = async (forceRefresh = false) => {
    if (boletos !== null && !forceRefresh) return;
    setLoadingB(true);
    try {
      // Atualiza boletos do cliente direto do Asaas (on-demand)
      try {
        await fetch('/.netlify/functions/asaas-sync-customer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: customer.id }),
        });
      } catch { /* best-effort: segue lendo do banco mesmo se o sync on-demand falhar */ }
      const { data, error } = await supabase.from('asaas_boletos')
        .select('*').eq('customer_id', customer.id).order('due_date', { ascending: true });
      if (error) throw error;
      setBoletos(data || []);
    } catch (e) { onToast('Erro: ' + e.message); setBoletos([]); }
    finally { setLoadingB(false); }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadBoletos();
  };

  const clientName = customer.name || 'Sem nome';
  const cpf = customer.cpf_cnpj || '—';

  // (perf-fe-15) Filtro/ordenacao dos boletos do cliente memoizado: antes rodava
  // inline no JSX a cada render do card aberto. Recalcula so quando os boletos
  // carregados ou o statusFilter mudam.
  const filteredBoletos = useMemo(() => {
    if (!boletos || boletos.length === 0) return [];
    const _todayStr = new Date().toISOString().slice(0, 10);
    return boletos.filter(b => {
      const paid = isPaidStatus(b.status);
      const neutral = isNeutralStatus(b.status);
      const removed = isRemovedStatus(b.status);
      const overdue = !paid && !neutral && !removed && b.due_date && b.due_date < _todayStr;
      const pending = !paid && !neutral && !removed && !overdue;
      if (statusFilter === 'pending') return pending;
      if (statusFilter === 'overdue') return overdue;
      if (statusFilter === 'paid') return paid;
      return !neutral; // 'all' esconde neutros; removidos seguem (secao "Removidos")
    });
  }, [boletos, statusFilter]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-2 overflow-hidden shadow-sm dense-text">
      <div className="w-full dense-row flex items-center justify-between hover:bg-gray-50 text-left">
        <input type="checkbox" checked={!!isSel} onChange={() => onSel(customer.id)} onClick={(e) => e.stopPropagation()}
          aria-label={`Selecionar ${clientName}`} className="ml-2 cursor-pointer shrink-0" />
        <button onClick={toggle} aria-expanded={open}
          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer text-left rounded-lg max-[1366px]:min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40">
          <span className="text-xs w-4 inline-flex justify-center max-[1366px]:min-w-[44px]" style={{ color: 'var(--cbc-text-muted)' }} aria-hidden="true">{open ? '▼' : '▶'}</span>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: 'var(--cbc-navy)' }}>
            {clientName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm truncate" style={{ color: 'var(--cbc-text-primary)' }}>{clientName}</h3>
            <div className="text-[10px] text-gray-500">{cpf}{customer.email ? ` · ${customer.email}` : ''}</div>
          </div>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          {custStat?.overdueTotal > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-50 text-red-600">
              {fmt(custStat.overdueTotal)} · {custStat.maxOverdueDays}d
            </span>
          )}
          {custStat?.total > 0 && (
            <span className="text-[10px] text-gray-500">{fmt(custStat.total)}</span>
          )}
          {leadId && (
            <button onClick={() => window.open(`https://advocaciacbc.kommo.com/leads/detail/${leadId}`, '_blank', 'noopener')}
              className="cursor-pointer inline-flex items-center hover:opacity-80" style={{ color: '#2E7CF6' }} title="Abrir conversa no Kommo" aria-label="Abrir no Kommo">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 5.92 2 10.76c0 2.74 1.46 5.18 3.74 6.78-.13.97-.5 2.2-1.2 3.46 1.6-.3 3.1-.9 4.3-1.74.97.26 2 .4 3.16.4 5.52 0 10-3.92 10-8.9C22 5.92 17.52 2 12 2z"/></svg>
            </button>
          )}
          <button onClick={() => onOpenNotes(customer)} className="cursor-pointer text-gray-500 hover:text-blue-600 inline-flex items-center" title="Notas" aria-label="Notas">
            <PencilSquareIcon className="w-4 h-4" aria-hidden="true" />
          </button>
          <button onClick={() => onToggleFav(customer.id)} className="cursor-pointer inline-flex items-center text-amber-500 hover:text-amber-600" title="Favoritar" aria-label={isFav ? 'Remover favorito' : 'Favoritar'}>
            {isFav ? <StarSolid className="w-4 h-4" aria-hidden="true" /> : <StarIcon className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t">
          {loadingB ? (
            <div className="p-4 text-center text-gray-400 text-xs">Carregando boletos...</div>
          ) : !boletos || boletos.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-xs">Nenhum boleto para este cliente.</div>
          ) : filteredBoletos.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-xs">Nenhum boleto neste filtro.</div>
          ) : (
            <ClientDetails clientName={clientName} boletos={filteredBoletos} compact={compact} onCopyPix={onCopyPix} onOpenNF={onOpenNF} onPreview={onPreview} onToast={onToast} onPrintAllNFs={onPrintAllNFs} />
          )}
        </div>
      )}
    </div>
  );
});

function ClientDetails({ clientName, boletos, compact, onCopyPix, onOpenNF, onPreview, onToast, onPrintAllNFs }) {
  const pending = boletos.filter(b => !isPaidStatus(b.status) && !isNeutralStatus(b.status) && !isRemovedStatus(b.status));
  const paid = boletos.filter(b => isPaidStatus(b.status));
  const removed = boletos.filter(b => isRemovedStatus(b.status));
  const totalPending = pending.reduce((s, b) => s + Number(b.value || 0), 0);
  const totalPaid = paid.reduce((s, b) => s + Number(b.value || 0), 0);

  // Ordenar: pendentes por due_date ASC (mais antigo primeiro), pagos por payment_date DESC
  const sortedPending = [...pending].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  const sortedPaid = [...paid].sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''));
  const sortedRemoved = [...removed].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  const closestId = sortedPending[0]?.id;

  const nfUrls = paid.filter(b => b.nf_pdf_url).map(b => b.nf_pdf_url);
  const [printingAll, setPrintingAll] = useState(false);

  const printAllNFs = async () => {
    setPrintingAll(true);
    try {
      await mergeStatementAndNFs(clientName, paid, nfUrls);
      onPrintAllNFs('PDF com descritivo + NFs gerado');
    } catch (e) {
      onPrintAllNFs('Erro ao gerar PDF: ' + e.message);
    } finally {
      setPrintingAll(false);
    }
  };

  const printStatementOnly = async () => {
    try {
      await downloadPaymentStatement(clientName, paid);
      onPrintAllNFs('Descritivo gerado');
    } catch (e) {
      onPrintAllNFs('Erro: ' + e.message);
    }
  };

  return (
    <div>
      <div className="px-4 py-2 bg-slate-50 flex items-center justify-end gap-4 border-b">
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase text-gray-400">Pendente</div>
          <div className="text-sm font-bold text-orange-600">{fmt(totalPending)} <span className="text-[9px] text-gray-400">({pending.length})</span></div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase text-gray-400">Pago</div>
          <div className="text-sm font-bold text-green-600">{fmt(totalPaid)} <span className="text-[9px] text-gray-400">({paid.length})</span></div>
        </div>
        {paid.length > 0 && (
          <button onClick={printStatementOnly}
            className="px-3 py-2 text-[10px] font-bold rounded-lg text-white hover:opacity-90 inline-flex items-center gap-1.5"
            style={{ background: 'var(--cbc-gold)' }} title="Descritivo de pagamento">
            <ClipboardDocumentListIcon className="w-3.5 h-3.5" aria-hidden="true" /> Descritivo
          </button>
        )}
        {nfUrls.length > 0 && (
          <button onClick={printAllNFs} disabled={printingAll}
            className="px-3 py-2 text-[10px] font-bold rounded-lg text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            style={{ background: 'var(--cbc-info)' }} title="Descritivo + todas NFs">
            {printingAll ? <><ArrowPathIcon className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Gerando...</> : <><ReceiptPercentIcon className="w-3.5 h-3.5" aria-hidden="true" /> Descritivo + {nfUrls.length} NF(s)</>}
          </button>
        )}
      </div>

      {/* Boletos pendentes */}
      {pending.length > 0 && (
        <div>
          <div className="px-3 py-1.5 bg-orange-50 text-[9px] font-bold uppercase text-orange-700">
            ⏳ Pendentes ({pending.length}) — o primeiro é o mais antigo
          </div>
          {sortedPending.map(b => (
            <BoletoRow key={b.id} boleto={b} isClosest={b.id === closestId} onCopyPix={onCopyPix} onOpenNF={onOpenNF} onPreview={onPreview} onToast={onToast} compact={compact} />
          ))}
        </div>
      )}

      {/* Boletos pagos */}
      {paid.length > 0 && (
        <details>
          <summary className="px-3 py-1.5 bg-green-50 text-[9px] font-bold uppercase text-green-700 cursor-pointer hover:bg-green-100 flex items-center gap-1">
            <CheckCircleIcon className="w-3 h-3" aria-hidden="true" /> Pagos ({paid.length}) — clique para expandir
          </summary>
          {sortedPaid.map(b => (
            <BoletoRow key={b.id} boleto={b} isClosest={false} onCopyPix={onCopyPix} onOpenNF={onOpenNF} compact={true} />
          ))}
        </details>
      )}

      {/* Boletos removidos — so registro: nao contam como divida e nao tem acoes */}
      {removed.length > 0 && (
        <details>
          <summary className="px-3 py-1.5 bg-gray-50 text-[9px] font-bold uppercase text-gray-500 cursor-pointer hover:bg-gray-100 flex items-center gap-1">
            <TrashIcon className="w-3 h-3" aria-hidden="true" /> Removidos ({removed.length}) — não contam como inadimplência
          </summary>
          {sortedRemoved.map(b => (
            <BoletoRow key={b.id} boleto={b} isClosest={false} onCopyPix={onCopyPix} onOpenNF={onOpenNF} compact={true} />
          ))}
        </details>
      )}
    </div>
  );
}

// ─── Main Panel ───
// (perf 31/05) Cache em memoria (modulo) das listas — instantaneo ao voltar pra aba,
// SEM serializar (evita o "trava" do JSON.stringify de ~11k linhas). Vive enquanto a aba
// do navegador estiver aberta; some no reload (fetchData repopula). Skeleton ja e
// condicionado a customers.length===0, entao nao pisca ao mostrar o cache.
let _cachedBoletosCustomers = null;
let _cachedBoletosRaw = null;

export default function BoletosPanel({ userEmail = '' }) {
  const [customers, setCustomers] = useState(() => {
    if (_cachedBoletosCustomers) return _cachedBoletosCustomers; // cache em memoria (instantaneo ao voltar pra aba)
    try { return JSON.parse(sessionStorage.getItem('boletos_customers') || '[]'); } catch { return []; }
  });
  // Lista crua de boletos (campos minimos) — fonte unica para todos os stats derivados.
  const [rawBoletos, setRawBoletos] = useState(() => {
    if (_cachedBoletosRaw) return _cachedBoletosRaw;
    try { return JSON.parse(sessionStorage.getItem('boletos_raw') || '[]'); } catch { return []; }
  });
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('boletos_sort') || 'name');
  const [overdueDaysFilter, setOverdueDaysFilter] = useState(0); // 0 = sem filtro
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('boletos_favorites') || '[]'); } catch { return []; }
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // (#51) Filtros persistidos em localStorage
  const [search, setSearch] = usePersistedFilter('boletos', 'search', '');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [kommoSyncing, setKommoSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null); // { phase, current, total, label }
  const [lastSync, setLastSync] = useState(null);
  const [syncErr, setSyncErr] = useState(null); // ultimo erro de sync recente (#25)
  const [leadByCpf, setLeadByCpf] = useState(() => new Map()); // CPF -> kommo_lead_id (#21)
  const [selCust, setSelCust] = useState(() => new Set());      // clientes selecionados (#22)
  // (R16) incrementa a cada carga concluida -> os cards de InadimplenciaStrip
  // re-consultam o Asaas em vez de ficarem presos no 1o fetch.
  const [refreshTick, setRefreshTick] = useState(0);
  const [statusFilter, setStatusFilter] = usePersistedFilter('boletos', 'statusFilter', 'all');
  // Filtro de inadimplencia entre datas (aplicado ao due_date dos boletos vencidos)
  const [dueFrom, setDueFrom] = usePersistedFilter('boletos', 'dueFrom', '');
  const [dueTo, setDueTo] = usePersistedFilter('boletos', 'dueTo', '');
  const [compact, setCompact] = useState(() => localStorage.getItem('boletos_compact') === '1');
  const [showRelatorio, setShowRelatorio] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [previewBoleto, setPreviewBoleto] = useState(null);
  const [notesCustomer, setNotesCustomer] = useState(null);
  // sub-aba ativa; lembra a ultima usada (localStorage). 'cobranca' = combinado · 'historico' · 'lista'
  const [view, setView] = useState(() => { try { const v = localStorage.getItem('cbc_boletos_subtab'); return ['cobranca', 'historico', 'lista'].includes(v) ? v : 'cobranca'; } catch { return 'cobranca'; } });
  useEffect(() => { try { localStorage.setItem('cbc_boletos_subtab', view); } catch { /* ignore */ } }, [view]);
  const [Toast, showToast] = useToast();

  useEffect(() => { localStorage.setItem('boletos_compact', compact ? '1' : '0'); }, [compact]);
  useEffect(() => { localStorage.setItem('boletos_sort', sortBy); }, [sortBy]);
  useEffect(() => { localStorage.setItem('boletos_favorites', JSON.stringify(favorites)); }, [favorites]);
  const toggleFav = useCallback((id) => setFavorites(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]), []);
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // (QW#5) marca a hora do ultimo fetch p/ throttlar o refetch ao voltar a aba
  const lastFetchRef = useRef(0);

  // Fetch customers (paginado) + stats agregadas
  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const PAGE = 1000;
    try {
      // Customers
      let all = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from('asaas_customers')
          // (QW#8) so as 4 colunas usadas (id/name/cpf_cnpj/email) — antes '*' trazia 13
          // colunas (endereco/telefones/datas) p/ ~1.3k linhas sem necessidade.
          .select('id, name, cpf_cnpj, email').order('name', { ascending: true }).range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      setCustomers(all);
      _cachedBoletosCustomers = all; // atualiza cache em memoria
      // (perf 31/05) So cacheia se for pequeno — serializar arrays grandes a cada
      // carga trava a thread principal. Acima do limite, limpa o cache antigo.
      try { if (all.length <= 3000) sessionStorage.setItem('boletos_customers', JSON.stringify(all)); else sessionStorage.removeItem('boletos_customers'); } catch { /* best-effort: cache de sessao opcional */ }

      // Carrega lista crua (apenas campos minimos) — stats sao derivados via useMemo
      let raw = [];
      let bFrom = 0;
      while (true) {
        const { data: chunk, error: be } = await supabase.from('asaas_boletos')
          .select('status,value,customer_id,due_date,payment_date').range(bFrom, bFrom + PAGE - 1);
        if (be) throw be;
        raw = raw.concat(chunk || []);
        if (!chunk || chunk.length < PAGE) break;
        bFrom += PAGE;
      }
      setRawBoletos(raw);
      _cachedBoletosRaw = raw; // atualiza cache em memoria
      // (perf 31/05) ~11k boletos: nao serializar no sessionStorage (trava a UI).
      try { if (raw.length <= 3000) sessionStorage.setItem('boletos_raw', JSON.stringify(raw)); else sessionStorage.removeItem('boletos_raw'); } catch { /* best-effort: cache de sessao opcional */ }

      const { data: state } = await supabase.from('asaas_sync_state').select('value').eq('key', 'boletos_last_sync').maybeSingle();
      setLastSync(state?.value || null);
      setRefreshTick((t) => t + 1); // (R16) avisa os cards de inadimplencia
    } catch {
      // (#100) Mensagem generica + ErrorState inline
      setLoadError('Erro ao carregar dados de cobrancas');
    }
    finally { setLoading(false); lastFetchRef.current = Date.now(); }
  }, []);

  // Stats derivados de rawBoletos + filtro de datas. Reativo a dueFrom/dueTo.
  // O filtro de datas se aplica AO due_date dos boletos vencidos:
  //   - boleto vencido fora do range nao conta como inadimplencia.
  //   - boletos pagos/pendentes nao sao filtrados pelo range (so o card "vencidos").
  const { boletoStats, customersByStatus, customerStats } = useMemo(() => {
    const stats = { pending: 0, overdue: 0, paid: 0, totalPending: 0, totalOverdue: 0, totalPaid: 0, topDebtors: [], clientsOverdue: 0, maxOverdue: 0 };
    const byStatus = { pending: new Set(), overdue: new Set(), paid: new Set() };
    const debtorMap = new Map();
    const perCust = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const inDueRange = (d) => {
      if (!dueFrom && !dueTo) return true;
      if (!d) return false;
      if (dueFrom && d < dueFrom) return false;
      if (dueTo && d > dueTo) return false;
      return true;
    };
    rawBoletos.forEach(b => {
      const v = Number(b.value || 0);
      const cid = b.customer_id;
      const isPaid = isPaidStatus(b.status);
      const isNeutral = isNeutralStatus(b.status);
      const isRemoved = isRemovedStatus(b.status);
      if (cid && !isNeutral && !isRemoved) {
        if (!perCust[cid]) perCust[cid] = { total: 0, overdueTotal: 0, maxOverdueDays: 0, lastPayment: null };
        perCust[cid].total += v;
      }
      // Removido (excluido no Asaas) nao e divida: fora de inadimplencia/pendente/total.
      if (isNeutral || isRemoved) return;
      const isOverdue = !isPaid && b.due_date && b.due_date < todayStr;
      const isPending = !isPaid && !isOverdue;
      if (isPending) {
        stats.pending++; stats.totalPending += v;
        if (cid) byStatus.pending.add(cid);
      } else if (isOverdue) {
        // Filtro por data: vencidos sao filtrados pelo due_date
        if (!inDueRange(b.due_date)) return;
        stats.overdue++; stats.totalOverdue += v;
        if (cid) {
          byStatus.overdue.add(cid);
          debtorMap.set(cid, (debtorMap.get(cid) || 0) + v);
          perCust[cid].overdueTotal += v;
          if (b.due_date) {
            const d = new Date(b.due_date + 'T12:00:00');
            const days = Math.floor((today - d) / 86400000);
            if (days > perCust[cid].maxOverdueDays) perCust[cid].maxOverdueDays = days;
            if (days > stats.maxOverdue) stats.maxOverdue = days;
          }
        }
      } else if (isPaid) {
        // Filtro por data: pagos sao filtrados pelo payment_date (fallback due_date)
        // Mantem a taxa de inadimplencia do periodo coerente (vencidos vs pagos do mesmo range).
        if (!inDueRange(b.payment_date || b.due_date)) return;
        stats.paid++; stats.totalPaid += v;
        if (cid) {
          byStatus.paid.add(cid);
          if (b.payment_date && (!perCust[cid].lastPayment || b.payment_date > perCust[cid].lastPayment)) {
            perCust[cid].lastPayment = b.payment_date;
          }
        }
      }
    });
    stats.clientsOverdue = byStatus.overdue.size;
    const nameById = new Map(customers.map(c => [c.id, c.name || 'Sem nome']));
    stats.topDebtors = [...debtorMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, total]) => ({ id, name: nameById.get(id) || id, total, days: perCust[id]?.maxOverdueDays || 0 }));
    return { boletoStats: stats, customersByStatus: byStatus, customerStats: perCust };
  }, [rawBoletos, customers, dueFrom, dueTo]);

  // Auto-refresh ao voltar à aba — (QW#5) com throttle de 60s: antes recarregava
  // ~13 mil linhas (boletos + clientes) a cada alt-tab. O realtime de asaas_customers
  // ja mantem a lista fresca, entao 60s nao tem perda perceptivel.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchRef.current > 60000) fetchData();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Trigger manual sync em blocos (customers + boletos)
  const manualSync = async () => {
    setSyncing(true);
    setSyncProgress({ phase: 'customers', current: 0, total: 1500, label: 'Clientes' });
    let totalProcessed = 0;
    try {
      // 1. Customers
      let custOffset = 0;
      while (true) {
        const r = await fetch('/.netlify/functions/asaas-sync-customers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset: custOffset }),
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error || 'erro customers');
        totalProcessed += data.processed || 0;
        custOffset += 100;
        setSyncProgress({ phase: 'customers', current: custOffset, total: Math.max(1500, custOffset + 100), label: 'Clientes' });
        if (data.done) break;
      }
      // 2. Boletos — (#L13) mesma cobertura do sync de fundo (STATUSES): inclui CONFIRMED
      // e RECEIVED_IN_CASH, que o manual antes nao sincronizava.
      const phases = ['PENDING', 'OVERDUE', 'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
      for (let pi = 0; pi < phases.length; pi++) {
        let cursor = { status: phases[pi], offset: 0 };
        while (cursor) {
          setSyncProgress({ phase: 'boletos', current: cursor.offset, total: Math.max(1000, cursor.offset + 100), label: `Boletos ${phases[pi]} (${pi + 1}/${phases.length})` });
          const r = await fetch('/.netlify/functions/asaas-sync-boletos', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cursor),
          });
          const data = await r.json();
          if (!data.success) throw new Error(data.error || 'erro boletos');
          totalProcessed += data.processed || 0;
          if (data.next && data.next.status === cursor.status) cursor = data.next;
          else break;
          if (data.done) break;
        }
      }
      setSyncProgress({ phase: 'done', current: 1, total: 1, label: `${totalProcessed} registros atualizados` });
      await fetchData();
      setTimeout(() => setSyncProgress(null), 1500);
    } catch (e) {
      showToast('⚠️ Erro: ' + e.message);
      setSyncProgress(null);
    } finally {
      setSyncing(false);
    }
  };

  // Sincroniza o link do carne no campo "Asaas" do lead Kommo (escrita real)
  const syncKommo = async () => {
    setKommoSyncing(true);
    try {
      const r = await fetch('/.netlify/functions/kommo-asaas-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: import.meta.env.VITE_BOT_PANEL_KEY || 'cbc-bot-2026' }),
      });
      const d = await r.json();
      // (#L15) a function emite resumo.enfileirado (escritas reais); nao existe "gravado",
      // entao o contador mostrava sempre 0. "ok" = inalterado + mantido (link ja correto).
      if (d.success) {
        const re = d.resumo || {};
        const ok = (re.inalterado || 0) + (re.mantido || 0);
        showToast(`Kommo: ${re.enfileirado || 0} atualizado(s) · ${ok} ok · ${re.erro || 0} erro(s)`);
      }
      else showToast('⚠️ ' + (d.error || 'erro ao sincronizar Kommo'));
    } catch (e) { showToast('⚠️ ' + e.message); }
    finally { setKommoSyncing(false); }
  };

  // Realtime
  // (resilience 28/04) Mantido event='*' — o handler so chama fetchData() (refetch
  // completo), entao precisa reagir a INSERT (novo cliente Asaas), UPDATE (status)
  // e DELETE (raro mas possivel). Volume razoavel pois ha muitos boletos.
  // Channel name ja era fixo, sem vazamento.
  useEffect(() => {
    // (perf #13) DEBOUNCE do refetch: o sync 2x/dia mexe em varios clientes de uma
    // vez; sem isso, cada evento disparava um fetchData() completo (~1,3k clientes +
    // ~11k boletos), gerando dezenas de recargas em sequencia que travavam a tela.
    // Agrupa as rajadas numa janela de 2,5s e pula quando a aba esta oculta.
    let timer = null;
    const scheduleRefetch = () => {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fetchData(); }, 2500);
    };
    const channel = supabase.channel('boletos-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asaas_customers' }, scheduleRefetch)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
  }, [fetchData]);

  // Filter + sort customers
  const filteredCustomers = useMemo(() => {
    const q = norm(debouncedSearch.trim());
    const qDigits = onlyDigits(debouncedSearch);
    let list = customers;
    if (statusFilter !== 'all') {
      const allowed = customersByStatus[statusFilter] || new Set();
      list = list.filter(c => allowed.has(c.id));
    }
    if (overdueDaysFilter > 0) {
      list = list.filter(c => (customerStats[c.id]?.maxOverdueDays || 0) >= overdueDaysFilter);
    }
    if (q) {
      list = list.filter(c => {
        const name = norm(c.name || '');
        const cpf = onlyDigits(c.cpf_cnpj || '');
        return name.includes(q) || (qDigits && cpf.includes(qDigits));
      });
    }
    // Sort
    const favSet = new Set(favorites);
    const sorted = [...list].sort((a, b) => {
      // favoritos sempre primeiro
      const fa = favSet.has(a.id), fb = favSet.has(b.id);
      if (fa !== fb) return fa ? -1 : 1;
      const sa = customerStats[a.id] || {};
      const sb = customerStats[b.id] || {};
      switch (sortBy) {
        case 'total': return (sb.total || 0) - (sa.total || 0);
        case 'lastPayment': return (sb.lastPayment || '').localeCompare(sa.lastPayment || '');
        case 'overdueDays': return (sb.maxOverdueDays || 0) - (sa.maxOverdueDays || 0);
        case 'name':
        default: return (a.name || '').localeCompare(b.name || '');
      }
    });
    return sorted;
  }, [customers, debouncedSearch, statusFilter, customersByStatus, overdueDaysFilter, customerStats, sortBy, favorites]);

  const stats = useMemo(() => {
    // Inadimplência: vencido / (vencido + pago) — só considera boletos cuja data já chegou
    const baseVencida = (boletoStats.totalOverdue || 0) + (boletoStats.totalPaid || 0);
    const inadimp = baseVencida > 0 ? ((boletoStats.totalOverdue || 0) / baseVencida) * 100 : 0;
    return { ...boletoStats, clients: customers.length, inadimp };
  }, [boletoStats, customers]);

  const relativeSync = useMemo(() => {
    if (!lastSync) return 'nunca sincronizado';
    const diff = Math.floor((nowTick - new Date(lastSync).getTime()) / 60000);
    if (diff < 1) return 'agora mesmo';
    if (diff < 60) return `há ${diff} min`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.floor(h / 24)}d`;
  }, [lastSync, nowTick]);

  // (#23) saude do sync por cor: ate 12h verde, ate 24h ambar, senao vermelho (ou nunca)
  const syncHealth = useMemo(() => {
    if (!lastSync) return { cor: 'var(--cbc-danger)' };
    const min = Math.floor((nowTick - new Date(lastSync).getTime()) / 60000);
    if (min <= 720) return { cor: 'var(--cbc-success)' };
    if (min <= 1440) return { cor: 'var(--cbc-warning)' };
    return { cor: 'var(--cbc-danger)' };
  }, [lastSync, nowTick]);

  // (#25) alerta de falha do sync: ultimo erro do asaas_error_log nas ultimas 24h
  useEffect(() => {
    let live = true;
    supabase.from('asaas_error_log').select('message, created_at').order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (!live) return;
        const e = (data || [])[0];
        setSyncErr(e && (new Date() - new Date(e.created_at)) < 86400000 ? e : null);
      }, () => {});
    return () => { live = false; };
  }, []);

  // (#21) mapa CPF -> kommo_lead_id (do cadastro unico) p/ o botao "Kommo" nos cards
  useEffect(() => {
    let live = true;
    supabase.from('clientes').select('cpf_cnpj, kommo_lead_id').not('kommo_lead_id', 'is', null).limit(6000)
      .then(({ data }) => {
        if (!live) return;
        const m = new Map();
        for (const r of data || []) {
          const c = onlyDigits(r.cpf_cnpj || ''); const l = String(r.kommo_lead_id || '');
          if (c.length === 11 && /^[0-9]+$/.test(l)) m.set(c, l);
        }
        setLeadByCpf(m);
      }, () => {});
    return () => { live = false; };
  }, []);

  const copyPix = useCallback(async (code) => {
    const ok = await copyText(code);
    showToast(ok ? '📱 Código PIX copiado!' : '⚠️ Erro ao copiar');
  }, [showToast]);
  const openNF = useCallback((b) => {
    if (b.nf_pdf_url) window.open(b.nf_pdf_url, '_blank');
  }, []);
  // (#22) selecao em massa + exportar selecionados (CSV)
  const toggleSelCust = useCallback((id) => setSelCust((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const exportSel = useCallback(() => {
    const byId = new Map(customers.map((c) => [c.id, c]));
    const lin = [['Nome', 'CPF', 'Email', 'Em aberto', 'Vencido', 'Dias atraso']];
    for (const id of selCust) {
      const c = byId.get(id); if (!c) continue;
      const s = customerStats[id] || {};
      lin.push([c.name || '', c.cpf_cnpj || '', c.email || '', String(s.total || 0).replace('.', ','), String(s.overdueTotal || 0).replace('.', ','), s.maxOverdueDays || 0]);
    }
    const csv = '﻿' + lin.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `clientes-selecionados-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [selCust, customers, customerStats]);

  // (#96) Skeleton ao carregar pela primeira vez
  if (loading && customers.length === 0 && !loadError) {
    return <SkeletonBoletos />;
  }

  // (#100) ErrorState quando falha o fetch inicial e nao ha cache
  if (loadError && customers.length === 0) {
    return (
      <div className='h-full flex items-center justify-center bg-gray-50'>
        <ErrorState
          icon={<ExclamationTriangleIcon className="w-8 h-8 text-amber-500" aria-hidden="true" />}
          title='Nao foi possivel carregar cobrancas'
          message='Verifique sua conexao ou tente novamente.'
          suggestion='Se o problema persistir, recarregue a pagina.'
          onRetry={() => { setLoadError(''); fetchData(); }}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>

      {/* Sub-abas: Boletos | Cobranca de inadimplentes */}
      <div className="flex gap-1 px-4 pt-3 bg-white border-b" role="tablist" aria-label="Visão de boletos">
        {[['cobranca', 'Cobrança'], ['historico', 'Histórico de Cobrança'], ['lista', 'Todos boletos']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className="px-4 py-2 text-[12px] font-bold uppercase tracking-wide rounded-t-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
            style={{
              color: view === k ? 'var(--cbc-navy)' : 'var(--cbc-text-muted)',
              borderBottom: view === k ? '2px solid var(--cbc-gold)' : '2px solid transparent',
            }}>{l}</button>
        ))}
      </div>

      {/* legenda da sub-aba ativa — diz "pra que serve cada aba" (#2) */}
      <div className="px-4 py-1.5 bg-white border-b text-[11.5px]" style={{ color: 'var(--cbc-text-secondary)' }}>
        {view === 'cobranca' ? 'Cobrar inadimplentes pelo WhatsApp (Kommo) e acompanhar os boletos em aberto.'
          : view === 'historico' ? 'O que já foi disparado: quem enviou, para quais clientes e o que o Kommo entregou e converteu.'
          : 'Toda a carteira de boletos — pendentes, vencidos e pagos — com detalhe por cliente.'}
      </div>

      {view === 'cobranca' ? (
        <CobrancaPanel userEmail={userEmail} onVerHistorico={() => setView('historico')} />
      ) : view === 'historico' ? (
        <CobrancaHistorico userEmail={userEmail} />
      ) : (
      <>
      {/* Cabecalho + lista rolam JUNTOS num unico container (fix: antes so a lista rolava
          e o topo ficava travado). Footer fica de fora -> continua fixo embaixo. */}
      <div className="flex-1 overflow-y-auto min-h-0">
      {/* Header */}
      <div className="p-4 border-b bg-white">
        {syncErr && (
          <div className="mb-3 rounded-lg px-3 py-2 text-[12px] flex items-start gap-2" style={{ background: 'var(--cbc-warning-bg,#fdf3e6)', border: '1px solid var(--cbc-warning)', color: 'var(--cbc-warning)' }}>
            <span aria-hidden="true">⚠</span>
            <span><b>A última sincronização do Asaas registrou um erro</b> ({new Date(syncErr.created_at).toLocaleString('pt-BR')}): {String(syncErr.message || '').slice(0, 180)}</span>
          </div>
        )}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><DocumentIcon className="w-5 h-5" aria-hidden="true" /> Boletos Asaas</h2>
            <p className="text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
              Busque cliente por nome ou CPF · atualizado <span style={{ color: syncHealth.cor, fontWeight: 700 }}>{relativeSync}</span>
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {['paulo@advocaciacbc.com','paulo.conforto@outlook.com','bruno@advocaciacbc.com','anderson@advocaciacbc.com'].includes((userEmail||'').toLowerCase()) && (
              <button onClick={() => genExecutivePDF(stats)}
                className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer hover:opacity-90 text-white inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
                style={{ background: 'var(--cbc-gold)' }}><DocumentIcon className="w-3.5 h-3.5" aria-hidden="true" /> Executivo</button>
            )}
            <button onClick={() => genDelinquencyReport(customers, customerStats)}
              className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer hover:opacity-90 text-white inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
              style={{ background: 'var(--cbc-danger)' }}><DocumentIcon className="w-3.5 h-3.5" aria-hidden="true" /> Inadimplência</button>
            <button onClick={() => setShowRelatorio(true)}
              className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer border hover:bg-amber-50 inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
              style={{ borderColor: 'var(--cbc-gold)', color: 'var(--cbc-text-primary)' }}>
              <DocumentIcon className="w-3.5 h-3.5" aria-hidden="true" /> Relatório
            </button>
            <button onClick={() => setCompact(c => !c)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer border inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40 ${compact ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 hover:bg-gray-50'}`}
              style={compact ? undefined : { color: 'var(--cbc-text-secondary)' }}>
              <Bars3Icon className="w-3.5 h-3.5" aria-hidden="true" /> {compact ? 'Compacto' : 'Normal'}
            </button>
            <button onClick={manualSync} disabled={syncing}
              className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
              style={{ background: 'var(--cbc-navy)' }}>
              {syncing ? <><ArrowPathIcon className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Sincronizando...</> : <><ArrowPathIcon className="w-3.5 h-3.5" aria-hidden="true" /> Sync Asaas</>}
            </button>
            {['paulo@advocaciacbc.com','paulo.conforto@outlook.com','bruno@advocaciacbc.com','anderson@advocaciacbc.com'].includes((userEmail||'').toLowerCase()) && (
              <button onClick={syncKommo} disabled={kommoSyncing}
                className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
                style={{ background: 'var(--cbc-info)' }} title="Atualiza o link do carne no campo Asaas dos leads no Kommo">
                {kommoSyncing ? <><ArrowPathIcon className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Kommo...</> : <><ArrowPathIcon className="w-3.5 h-3.5" aria-hidden="true" /> Sync Kommo</>}
              </button>
            )}
          </div>
        </div>
        <InadimplenciaStrip refreshToken={refreshTick} current={{ clientes: stats.clientsOverdue, parcelas: stats.overdue, total: stats.totalOverdue, maior: stats.maxOverdue }} />

        {/* Stats */}
        {/* (unificacao 20/06) Inadimplentes e Total Vencido sairam daqui — agora
            vivem so na faixa de Inadimplencia acima (fonte unica + tendencia). */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { l: 'Clientes', v: stats.clients, c: 'var(--cbc-navy)', bg: 'var(--cbc-bg)' },
            { l: 'Boletos Vencidos', v: stats.overdue, c: 'var(--cbc-danger)', bg: 'var(--cbc-danger-bg)' },
            { l: 'Inadimplência', v: `${stats.inadimp.toFixed(1)}%`, c: 'var(--cbc-info)', bg: 'var(--cbc-info-bg)' },
          ].map((s, i) => (
            <div key={i} className="rounded-lg p-2 text-center min-w-0" style={{ background: s.bg }}>
              <div className={`${s.sm ? 'text-sm' : 'text-lg'} font-bold truncate tabular-nums`} style={{ color: s.c }}>{s.v}</div>
              <div className="text-[10px] font-bold uppercase truncate" style={{ color: s.c }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Top Caloteiros */}
        {stats.topDebtors && stats.topDebtors.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-100 bg-red-50/40 px-3 py-2">
            <div className="text-[10px] font-bold uppercase text-red-700 mb-1 flex items-center gap-1"><TrophyIcon className="w-3 h-3" aria-hidden="true" /> Top Caloteiros</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-x-4 max-sm:max-h-44 max-sm:overflow-y-auto">
              {stats.topDebtors.map((d, i) => (
                <button key={d.id} onClick={() => setSearch(d.name)}
                  className="flex items-center justify-between text-left hover:bg-red-100/60 rounded px-1.5 py-0.5 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[9px] font-bold text-red-400 w-4 flex-shrink-0">{i + 1}º</span>
                    <span className="text-[10px] font-semibold text-gray-700 truncate">{d.name}</span>
                  </div>
                  <span className="text-[10px] font-bold text-red-600 ml-2 whitespace-nowrap flex-shrink-0">
                    {fmt(d.total)} <span className="text-red-400 font-normal">· {d.days}d</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-3">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input type="text" placeholder="Buscar cliente por nome completo ou CPF..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>
          )}
        </div>

        {/* Filtros + ordenação */}
        {/* (mobile-11) No phone (max-sm) a fileira vira blocos empilhados (status / periodo /
            atraso / ordenacao). Os wrappers usam contents no desktop -> layout desktop intocado;
            viram blocos flex so no max-sm. */}
        <div className="flex gap-2 items-center flex-wrap max-sm:flex-col max-sm:items-stretch">
          {/* Bloco status — controle segmentado unico (item ativo navy preenchido) */}
          <div
            className="inline-flex rounded-lg overflow-hidden max-sm:w-full"
            style={{ border: '1px solid var(--cbc-border)' }}
            role="group"
            aria-label="Filtrar boletos por status"
          >
          {[
            { k: 'all', l: 'Todos' },
            { k: 'pending', l: 'Pendentes' },
            { k: 'overdue', l: 'Vencidos' },
            { k: 'paid', l: 'Pagos' },
          ].map((f, i) => {
            const active = statusFilter === f.k;
            return (
              <button key={f.k} onClick={() => setStatusFilter(f.k)}
                aria-pressed={active}
                className="px-3 py-1.5 text-[11px] font-bold uppercase cursor-pointer transition-colors max-sm:flex-1"
                style={{
                  background: active ? 'var(--cbc-accent)' : 'var(--cbc-bg-card)',
                  color: active ? '#fff' : 'var(--cbc-text-secondary)',
                  borderLeft: i === 0 ? 'none' : '1px solid var(--cbc-border)',
                }}>
                {f.l}
              </button>
            );
          })}
          </div>
          <div className="h-4 w-px bg-gray-200 max-sm:hidden" />
          {/* Bloco periodo */}
          <div className="contents max-sm:flex max-sm:flex-wrap max-sm:gap-2 max-sm:items-center">
          <label className="text-[9px] font-bold text-gray-500 uppercase">Vencimento entre</label>
          <input type="date" value={dueFrom} onChange={e => setDueFrom(e.target.value)}
            className="border rounded px-2 py-1 text-[10px] bg-white" title="Data inicial do vencimento" />
          <span className="text-[10px] text-gray-400">e</span>
          <input type="date" value={dueTo} onChange={e => setDueTo(e.target.value)}
            className="border rounded px-2 py-1 text-[10px] bg-white" title="Data final do vencimento" />
          {(dueFrom || dueTo) && (
            <button onClick={() => { setDueFrom(''); setDueTo(''); }}
              className="text-[10px] text-gray-400 hover:text-red-500 underline" title="Limpar filtro de datas">limpar</button>
          )}
          </div>
          <div className="h-4 w-px bg-gray-200 max-sm:hidden" />
          {/* Bloco atraso */}
          <div className="contents max-sm:flex max-sm:flex-wrap max-sm:gap-2 max-sm:items-center">
          <label className="text-[9px] font-bold text-gray-500 uppercase">Vencido há mais de</label>
          <select value={overdueDaysFilter} onChange={e => setOverdueDaysFilter(Number(e.target.value))}
            className="border rounded px-2 py-1 text-[10px] bg-white">
            <option value={0}>—</option>
            <option value={7}>7 dias</option>
            <option value={15}>15 dias</option>
            <option value={30}>30 dias</option>
            <option value={60}>60 dias</option>
            <option value={90}>90 dias</option>
          </select>
          </div>
          <div className="h-4 w-px bg-gray-200 max-sm:hidden" />
          {/* Bloco ordenacao */}
          <div className="contents max-sm:flex max-sm:flex-wrap max-sm:gap-2 max-sm:items-center">
          <label className="text-[9px] font-bold text-gray-500 uppercase">Ordenar</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="border rounded px-2 py-1 text-[10px] bg-white">
            <option value="name">Nome</option>
            <option value="total">Valor total</option>
            <option value="overdueDays">Dias em atraso</option>
            <option value="lastPayment">Último pagamento</option>
          </select>
          {favorites.length > 0 && (
            <span className="text-[9px] text-yellow-600 font-bold ml-auto flex items-center gap-1 max-sm:ml-0"><StarSolid className="w-3 h-3 text-yellow-500" aria-hidden="true" /> {favorites.length} favorito(s)</span>
          )}
          </div>
        </div>
      </div>

      {/* (#22) barra de selecao em massa */}
      {selCust.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ background: 'var(--cbc-navy)', color: '#fff' }}>
          <b className="text-[12px]">{selCust.size} cliente(s) selecionado(s)</b>
          <button onClick={exportSel} className="ml-auto px-3 py-1 rounded-md text-[11px] font-bold cursor-pointer" style={{ background: '#fff', color: 'var(--cbc-navy)' }}>⬇ Exportar CSV</button>
          <button onClick={() => setSelCust(new Set())} className="px-3 py-1 rounded-md text-[11px] font-bold cursor-pointer text-white" style={{ border: '1px solid rgba(255,255,255,.4)' }}>Limpar</button>
        </div>
      )}

      {/* List (sem scroll proprio — rola junto no container acima) */}
      <div>
        {/* Barra-resumo sticky: gruda no topo da rolagem da lista (navy fino) */}
        <div
          className="sticky top-0 z-20 flex items-center gap-4 px-4 py-2 text-white flex-wrap"
          style={{ background: 'var(--cbc-accent)' }}
        >
          <div className="flex items-baseline gap-1.5 min-w-0">
            <MoneyValue value={stats.totalOverdue} className="text-sm font-bold text-white" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/70">vencido</span>
          </div>
          <span className="h-3.5 w-px bg-white/25" aria-hidden="true" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tabular-nums">{stats.inadimp.toFixed(1)}%</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/70">inadimplência</span>
          </div>
          <span className="h-3.5 w-px bg-white/25" aria-hidden="true" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tabular-nums">{stats.clients}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/70">clientes</span>
          </div>
          {/* Frescor do ultimo sync. Usa o relativeSync ja memoizado (mesma fonte do
              header). FreshnessChip nao serve aqui: fixa color inline = --cbc-text-muted,
              ilegivel sobre o navy. Mantem o <time> semantico e contraste branco. */}
          <time
            dateTime={lastSync || undefined}
            title={lastSync ? new Date(lastSync).toLocaleString('pt-BR') : undefined}
            className="ml-auto text-xs font-medium text-white/75 whitespace-nowrap inline-flex items-center gap-1.5"
          >
            <span className="w-2 h-2 rounded-full" style={{ background: syncHealth.cor }} aria-hidden="true" />sync {relativeSync}
          </time>
        </div>
        <div className="p-4">
        {loading && customers.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3 animate-pulse">
                <div className="w-4 h-4 rounded bg-gray-100" />
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="flex-1">
                  <div className="h-3 bg-gray-200 rounded w-1/3 mb-2" />
                  <div className="h-2 bg-gray-100 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-12">
            {debouncedSearch ? 'Nenhum cliente encontrado para a busca.' : 'Nenhum cliente sincronizado. Clique em "Sync Asaas".'}
          </div>
        ) : (
          // (perf-fe-11) Mantido o .map (sem react-window) DE PROPOSITO. Diferente da aba
          // Asaas (linhas de tabela com altura fixa, ideais p/ FixedSizeList), aqui cada
          // ClientCard e COLAPSAVEL: ao expandir carrega boletos via fetch (assincrono) e
          // cresce p/ altura grande e variavel (+ o <details> "Pagos" interno muda a altura
          // depois de montado). FixedSizeList recortaria o card aberto; VariableSizeList
          // exigiria medir/resetar altura por item apos cada fetch e cada toggle de <details>,
          // o que e fragil e arriscaria CORTAR conteudo de cobranca em producao. O custo de
          // render ja e controlado porque ClientCard e memo() e so o card aberto monta as
          // linhas de boleto (cards fechados renderizam so o cabecalho). Trade-off seguro:
          // priorizar NAO quebrar a expansao.
          filteredCustomers.map(c => (
            <ClientCard key={c.id} customer={c} statusFilter={statusFilter} compact={compact}
              custStat={customerStats[c.id]} isFav={favorites.includes(c.id)} onToggleFav={toggleFav}
              onCopyPix={copyPix} onOpenNF={openNF} onPreview={setPreviewBoleto} onOpenNotes={setNotesCustomer}
              onPrintAllNFs={showToast} onToast={showToast} leadId={leadByCpf.get(onlyDigits(c.cpf_cnpj || ''))}
              isSel={selCust.has(c.id)} onSel={toggleSelCust} />
          ))
        )}
        </div>
      </div>
      </div>{/* fim do container rolavel (cabecalho + lista) */}

      {/* Footer */}
      <div className="p-2 border-t bg-white text-center">
        <span className="text-[9px] text-gray-400 uppercase">
          {filteredCustomers.length} de {customers.length} cliente(s) · sync diário 06:00 · atualização por cliente on-demand
        </span>
      </div>

      {Toast}

      <PreviewModal boleto={previewBoleto} onClose={() => setPreviewBoleto(null)} />
      {notesCustomer && <NotesModal customer={notesCustomer} userEmail={userEmail} onClose={() => setNotesCustomer(null)} onToast={showToast} />}

      {/* Modal de progresso do sync */}
      {syncProgress && (
        <div className="fixed inset-0 modal-backdrop-glass z-[300] flex items-center justify-center p-4">
          <div className="modal-glass rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <ArrowPathIcon className="w-8 h-8 text-blue-600 animate-spin" aria-hidden="true" />
              <div>
                <h3 className="font-bold text-sm" style={{ color: 'var(--cbc-text-primary)' }}>Sincronizando com Asaas</h3>
                <p className="text-[11px] text-gray-400">Não feche esta janela</p>
              </div>
            </div>
            <div className="mb-2 flex justify-between text-[11px] font-semibold text-gray-600">
              <span>{syncProgress.label}</span>
              <span>{syncProgress.current}{syncProgress.phase !== 'done' ? ` / ~${syncProgress.total}` : ''}</span>
            </div>
            <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (syncProgress.current / Math.max(1, syncProgress.total)) * 100)}%`,
                  background: syncProgress.phase === 'done' ? 'var(--cbc-success)' : 'var(--cbc-navy)',
                }} />
            </div>
            {syncProgress.phase === 'done' && (
              <div className="mt-3 text-center text-[11px] font-bold text-green-600 inline-flex items-center gap-1 justify-center w-full"><CheckCircleIcon className="w-4 h-4" aria-hidden="true" /> Concluído</div>
            )}
          </div>
        </div>
      )}
      <RelatorioBoletosModal open={showRelatorio} onClose={() => setShowRelatorio(false)} />
      </>
      )}
    </div>
  );
}
