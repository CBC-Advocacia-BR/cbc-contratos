/**
 * Aba "Portal do Cliente" — gestão dos links de acesso ao portal público.
 *
 * Visão geral (sem busca): contadores, TODOS os clientes prontos para
 * receber link (CPF + processo, sem link ativo) e as inconsistências de
 * vínculo ADVBOX × Asaas × Kommo com orientação de correção.
 * Busca (nome/CPF): situação do link por cliente + copiar/WhatsApp/renovar.
 * Backend: netlify/functions/portal-admin.mjs (auth x-bot-key).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MagnifyingGlassIcon, LinkIcon, ClipboardDocumentIcon, CheckIcon,
  ArrowPathIcon, NoSymbolIcon, DevicePhoneMobileIcon, EyeIcon, SparklesIcon,
  ExclamationTriangleIcon, ChevronDownIcon, DocumentArrowDownIcon, TableCellsIcon,
  Squares2X2Icon, UsersIcon, PencilSquareIcon, ChatBubbleLeftRightIcon, ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import {
  PerguntasClientes, FaqPortal, EducacaoPortal, CorrelacaoCard,
  ContatoPortal, ReviewPortal, ExplicadorPortal, EquipePortal,
} from './PortalConteudoSecoes';

const SECOES = [
  { id: 'geral', label: 'Visão geral', icon: Squares2X2Icon },
  { id: 'clientes', label: 'Clientes & Links', icon: UsersIcon },
  { id: 'conteudo', label: 'Conteúdo do portal', icon: PencilSquareIcon },
  { id: 'duvidas', label: 'Dúvidas', icon: ChatBubbleLeftRightIcon },
];

// categorias do export (chave, titulo da seção, nome da aba Excel, colunas)
const EXPORT_CATS = [
  ['sem_cpf', 'Cliente sem CPF no ADVBOX', 'Sem CPF', ['nome', 'processos', 'celular']],
  ['sem_asaas', 'Cliente sem cobranças no Asaas', 'Sem Asaas', ['nome', 'cpf', 'processos', 'celular']],
  ['contrato_sem_kommo', 'Contrato sem link do lead Kommo', 'Sem Kommo', ['contrato_id', 'nome', 'cpf', 'status']],
  ['contrato_sem_advbox', 'Contrato sem processo no ADVBOX', 'Sem ADVBOX', ['contrato_id', 'nome', 'cpf', 'status']],
  ['contrato_cpf_fora_advbox', 'CPF do contrato não encontrado no ADVBOX', 'CPF divergente', ['contrato_id', 'nome', 'cpf', 'status']],
  ['marcados_so_exito', 'Marcados como só êxito (sem honorários iniciais)', 'So exito', ['nome', 'customer_id', 'marcado_por', 'marcado_em']],
];

const BOT_KEY = import.meta.env.VITE_BOT_PANEL_KEY || 'cbc-bot-2026';

async function api(action, params = {}) {
  const r = await fetch('/.netlify/functions/portal-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-key': BOT_KEY },
    body: JSON.stringify({ action, ...params }),
  });
  const d = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

const tituloCase = (s) => String(s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const dataBR = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const relativo = (iso) => {
  if (!iso) return 'nunca acessado';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'acessado hoje';
  if (dias === 1) return 'acessado ontem';
  return `acessado há ${dias} dias`;
};
const waLink = (celular, primeiroNome, url) => {
  let d = String(celular || '').replace(/\D/g, '');
  if (!d) return null;
  if (!d.startsWith('55')) d = '55' + d;
  const msg = `Olá, ${primeiroNome}! Aqui é do CBC Advogados. 😊\n\nCriamos um portal exclusivo para você acompanhar o andamento do seu processo e seus pagamentos:\n\n${url}\n\nÉ só tocar no link — não precisa de senha. Qualquer dúvida, estamos à disposição!`;
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
};

/* ---------- card de resultado da BUSCA ---------- */
function ClienteCard({ c, onAtualizado }) {
  const [busy, setBusy] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [confirmaRenovar, setConfirmaRenovar] = useState(false);
  const [confirmaDesativar, setConfirmaDesativar] = useState(false); // (QW#16) confirmacao do desativar
  const primeiro = tituloCase((c.nome || '').trim().split(/\s+/)[0]);
  const link = c.link;

  const run = async (acao, fn) => {
    setBusy(acao);
    try { await fn(); } catch (e) { alert(`Não deu certo: ${e.message}`); }
    setBusy(''); setConfirmaRenovar(false); setConfirmaDesativar(false);
  };
  const gerar = () => run('gerar', async () => {
    const r = await api('create', { customer_id: c.customer_id });
    onAtualizado({ ...c, link: { token: r.token, url: r.link, ativo: true, acessos: 0, ultimo_acesso: null, criado_em: new Date().toISOString() } });
  });
  const renovar = () => run('renovar', async () => {
    const r = await api('rotate', { customer_id: c.customer_id });
    onAtualizado({ ...c, link: { token: r.token, url: r.link, ativo: true, acessos: 0, ultimo_acesso: null, criado_em: new Date().toISOString() } });
  });
  const desativar = () => run('desativar', async () => {
    await api('toggle', { token: link.token, ativo: false });
    onAtualizado({ ...c, link: { ...link, ativo: false } });
  });
  const copiar = () => {
    navigator.clipboard.writeText(link.url).then(() => {
      setCopiado(true); setTimeout(() => setCopiado(false), 2400);
    });
  };

  const wa = link?.ativo ? waLink(c.celular, primeiro, link.url) : null;

  return (
    <div className={`relative rounded-xl border bg-white dark:bg-gray-800 p-4 transition-shadow hover:shadow-md ${
      link?.ativo
        ? 'border-2 border-[color:var(--cbc-accent)]'
        : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-[color:var(--cbc-text-primary)] dark:text-white truncate" style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 19 }}>
            {tituloCase(c.nome)}
          </h3>
          <div className="text-[12px] text-[color:var(--cbc-text-secondary)] mt-0.5 flex flex-wrap gap-x-3">
            {c.cpf && <span className="tabular-nums">CPF {c.cpf}</span>}
            {c.cidade && <span>{c.cidade}</span>}
            <span>{c.processos} processo{c.processos === 1 ? '' : 's'}</span>
            {c.celular && <span className="inline-flex items-center gap-1 tabular-nums"><DevicePhoneMobileIcon className="w-3.5 h-3.5" />{c.celular}</span>}
          </div>
        </div>
        {link ? (
          <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
            link.ativo ? 'bg-[color:var(--cbc-success-bg)] text-[color:var(--cbc-success)] border border-[color:var(--cbc-success-border)]'
                       : 'bg-gray-100 text-[color:var(--cbc-text-secondary)] dark:bg-gray-700 dark:text-gray-300'}`}>
            {link.ativo ? 'link ativo' : 'desativado'}
          </span>
        ) : (
          <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-[color:var(--cbc-warning-bg)] text-[color:var(--cbc-warning)] border border-[color:var(--cbc-warning-border)]">sem link</span>
        )}
      </div>

      {link?.ativo && (
        <div className="mt-3">
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 px-3 py-2">
            <LinkIcon className="w-4 h-4 shrink-0 text-[color:var(--cbc-gold-dark)]" />
            <code className="text-[12px] truncate flex-1 text-[color:var(--cbc-text-secondary)]">{link.url}</code>
          </div>
          <div className="text-[11px] text-[color:var(--cbc-text-muted)] mt-1.5 flex items-center gap-3">
            <span className="inline-flex items-center gap-1 tabular-nums"><EyeIcon className="w-3.5 h-3.5" />{link.acessos} acesso{link.acessos === 1 ? '' : 's'} · {relativo(link.ultimo_acesso)}</span>
            <span className="tabular-nums">criado em {dataBR(link.criado_em)}</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!link || !link.ativo ? (
          <button onClick={gerar} disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[color:var(--cbc-accent)] text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40">
            <SparklesIcon className={`w-4 h-4 ${busy === 'gerar' ? 'animate-spin' : ''}`} />
            {link ? 'Gerar novo link' : 'Gerar link do portal'}
          </button>
        ) : (
          <>
            <button onClick={copiar}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40 ${
                copiado ? 'bg-[color:var(--cbc-success)] text-white' : 'bg-[color:var(--cbc-accent)] text-white hover:opacity-90'}`}>
              {copiado ? <CheckIcon className="w-4 h-4" /> : <ClipboardDocumentIcon className="w-4 h-4" />}
              {copiado ? 'Copiado!' : 'Copiar link'}
            </button>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[color:var(--cbc-success)] text-white text-xs font-bold hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-success)]/40">
                <DevicePhoneMobileIcon className="w-4 h-4" /> Enviar no WhatsApp
              </a>
            )}
            {confirmaRenovar ? (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="text-[color:var(--cbc-text-secondary)]">O link antigo deixa de funcionar. Confirmar?</span>
                <button onClick={renovar} disabled={!!busy} className="px-2.5 py-1.5 rounded-lg bg-[color:var(--cbc-warning)] text-white font-bold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-warning)]/40">
                  {busy === 'renovar' ? '…' : 'Sim, renovar'}
                </button>
                <button onClick={() => setConfirmaRenovar(false)} className="px-2 py-1.5 text-[color:var(--cbc-text-secondary)] hover:text-[color:var(--cbc-text-primary)] font-bold">cancelar</button>
              </span>
            ) : (
              <button onClick={() => setConfirmaRenovar(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-xs font-bold text-[color:var(--cbc-text-secondary)] hover:text-[color:var(--cbc-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40">
                <ArrowPathIcon className="w-4 h-4" /> Renovar
              </button>
            )}
            {confirmaDesativar ? (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="text-[color:var(--cbc-text-secondary)]">O cliente perde o acesso ao portal. Confirmar?</span>
                <button onClick={desativar} disabled={!!busy} className="px-2.5 py-1.5 rounded-lg bg-[color:var(--cbc-danger)] text-white font-bold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-danger)]/40">
                  {busy === 'desativar' ? '…' : 'Sim, desativar'}
                </button>
                <button onClick={() => setConfirmaDesativar(false)} className="px-2 py-1.5 text-[color:var(--cbc-text-secondary)] hover:text-[color:var(--cbc-text-primary)] font-bold">cancelar</button>
              </span>
            ) : (
              <button onClick={() => setConfirmaDesativar(true)} disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[color:var(--cbc-danger-border)] text-[color:var(--cbc-danger)] text-xs font-bold hover:bg-[color:var(--cbc-danger-bg)] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-danger)]/40">
                <NoSymbolIcon className="w-4 h-4" /> Desativar
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- visão geral: linha de "pronto para gerar" ---------- */
function Selo({ ok, rotulo }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded border ${
      ok ? 'bg-[color:var(--cbc-success-bg)] text-[color:var(--cbc-success)] border-[color:var(--cbc-success-border)]'
         : 'bg-[color:var(--cbc-danger-bg)] text-[color:var(--cbc-danger)] border-[color:var(--cbc-danger-border)]'}`}>
      {ok ? '✓' : '✕'} {rotulo}
    </span>
  );
}

function ProntoRow({ p }) {
  const [estado, setEstado] = useState(null); // null | {url} | 'gerando'
  const [copiado, setCopiado] = useState(false);
  const primeiro = tituloCase((p.nome || '').trim().split(/\s+/)[0]);

  const gerar = async () => {
    setEstado('gerando');
    try {
      const r = await api('create', { customer_id: p.customer_id });
      setEstado({ url: r.link });
    } catch (e) { alert(`Não deu certo: ${e.message}`); setEstado(null); }
  };
  const copiar = (url) => navigator.clipboard.writeText(url).then(() => {
    setCopiado(true); setTimeout(() => setCopiado(false), 2000);
  });
  const wa = estado?.url ? waLink(p.celular, primeiro, estado.url) : null;

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5 px-3 border-b border-gray-100 dark:border-gray-700/60 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold truncate">{tituloCase(p.nome)}</div>
        <div className="text-[11px] text-[color:var(--cbc-text-secondary)] flex flex-wrap gap-x-2.5">
          <span className="tabular-nums">{p.cpf}</span>
          <span className="tabular-nums">{p.processos} proc.</span>
          {p.celular && <span className="tabular-nums">{p.celular}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Selo ok={p.tem_asaas} rotulo="Asaas" />
        <Selo ok={p.tem_kommo} rotulo="Kommo" />
      </div>
      {estado?.url ? (
        <div className="flex items-center gap-1.5">
          <button onClick={() => copiar(estado.url)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40 ${copiado ? 'bg-[color:var(--cbc-success)] text-white' : 'bg-[color:var(--cbc-accent)] text-white'}`}>
            {copiado ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[color:var(--cbc-success)] text-white text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-success)]/40">
            <DevicePhoneMobileIcon className="w-3.5 h-3.5" /> WhatsApp
          </a>}
        </div>
      ) : (
        <button onClick={gerar} disabled={estado === 'gerando'}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[color:var(--cbc-gold-dark)] text-[color:var(--cbc-gold-dark)] dark:text-[color:var(--cbc-gold)] dark:border-[color:var(--cbc-gold)]/60 text-[11px] font-bold hover:bg-[color:var(--cbc-gold)]/10 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-gold-dark)]/40">
          <SparklesIcon className={`w-3.5 h-3.5 ${estado === 'gerando' ? 'animate-spin' : ''}`} /> Gerar link
        </button>
      )}
    </div>
  );
}

/* ---------- visão geral: seção de inconsistências ---------- */
const INC_INFO = {
  sem_cpf: {
    titulo: 'Cliente sem CPF no ADVBOX',
    como: 'Sem CPF não há vínculo com Asaas, contrato nem portal de pagamentos. Corrija no cadastro do cliente dentro do ADVBOX — o espelho atualiza no próximo sync. Use o telefone para confirmar o CPF com o cliente.',
    cols: (i) => `${tituloCase(i.nome)} · ${i.processos} proc.${i.celular ? ` · ${i.celular}` : ''}`,
  },
  sem_asaas: {
    titulo: 'Cliente sem cobranças no Asaas',
    como: 'Tem CPF e processo, mas nenhum boleto no CPF. Pode ser CPF divergente entre Asaas e ADVBOX, pagamento por fora — ou contrato só de êxito, sem honorários iniciais: nesse caso, marque "Só êxito" que o cliente sai desta lista.',
    cols: (i) => `${tituloCase(i.nome)} · ${i.cpf || ''} · ${i.processos} proc.`,
    acaoRotulo: 'Só êxito',
  },
  contrato_sem_kommo: {
    titulo: 'Contrato sem link do lead Kommo',
    como: 'Abra o contrato no sistema e cole o link do lead (Kommo) no cadastro do contratante — é o que liga o portal/bot às conversas do WhatsApp.',
    cols: (i) => `${tituloCase(i.nome)} · contrato #${i.contrato_id} (${i.status})`,
  },
  contrato_sem_advbox: {
    titulo: 'Contrato sem processo no ADVBOX',
    como: 'O contrato foi assinado mas o processo não foi vinculado/criado no ADVBOX. Use a sincronização ADVBOX do contrato.',
    cols: (i) => `${tituloCase(i.nome)} · contrato #${i.contrato_id} (${i.status})`,
  },
  contrato_cpf_fora_advbox: {
    titulo: 'CPF do contrato não encontrado no ADVBOX',
    como: 'O CPF do contratante não bate com nenhum cliente do ADVBOX — provavelmente digitado diferente em um dos dois. Confira e padronize.',
    cols: (i) => `${tituloCase(i.nome)} · contrato #${i.contrato_id} (${i.status})`,
  },
};

function IncSection({ chave, dados, onAcao }) {
  const [aberto, setAberto] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const info = INC_INFO[chave];
  if (!info || !dados || !dados.qtd) return null;
  const agir = async (item) => {
    setBusyId(item.customer_id);
    try { await onAcao(item); } catch (e) { alert(`Não deu certo: ${e.message}`); }
    setBusyId(null);
  };
  return (
    <div className="rounded-xl border border-[color:var(--cbc-warning-border)] bg-[color:var(--cbc-warning-bg)] overflow-hidden">
      <button onClick={() => setAberto(!aberto)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-warning)]/40 rounded-xl">
        <ExclamationTriangleIcon className="w-4 h-4 text-[color:var(--cbc-warning)] shrink-0" />
        <span className="text-[13px] font-bold flex-1 text-[color:var(--cbc-text-primary)]">{info.titulo}</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[color:var(--cbc-warning)] text-white tabular-nums">{dados.qtd}</span>
        <ChevronDownIcon className={`w-4 h-4 text-[color:var(--cbc-text-secondary)] transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div className="px-4 pb-4">
          <p className="text-[12px] text-[color:var(--cbc-text-secondary)] mb-2">{info.como}</p>
          <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700/50 max-h-64 overflow-y-auto">
            {(dados.lista || []).map((i, idx) => (
              <div key={idx} className="px-3 py-1.5 text-[12px] flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate">{info.cols(i)}</span>
                {info.acaoRotulo && onAcao && (
                  <button onClick={() => agir(i)} disabled={busyId === i.customer_id}
                    className="shrink-0 text-[11px] font-bold px-2 py-1 rounded border border-[color:var(--cbc-gold-dark)] text-[color:var(--cbc-gold-dark)] dark:text-[color:var(--cbc-gold)] dark:border-[color:var(--cbc-gold)]/60 hover:bg-[color:var(--cbc-gold)]/10 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-gold-dark)]/40">
                    {busyId === i.customer_id ? '…' : `✓ ${info.acaoRotulo}`}
                  </button>
                )}
              </div>
            ))}
          </div>
          {dados.qtd > (dados.lista || []).length && (
            <p className="text-[11px] text-[color:var(--cbc-text-muted)] mt-1.5 tabular-nums">Mostrando {(dados.lista || []).length} de {dados.qtd} — o PDF/Excel traz a lista completa.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- exportações (listas completas via action 'export') ---------- */
async function exportarExcel() {
  const [d, XLSX] = await Promise.all([api('export'), import('xlsx')]);
  const wb = XLSX.utils.book_new();
  for (const [key, , aba, cols] of EXPORT_CATS) {
    const rows = (d[key] || []).map((r) => {
      const o = {};
      cols.forEach((c) => { o[c] = r[c] ?? ''; });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ info: 'nenhum registro' }]);
    XLSX.utils.book_append_sheet(wb, ws, aba);
  }
  XLSX.writeFile(wb, `divergencias_portal_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function exportarPdf() {
  const [d, jspdf] = await Promise.all([api('export'), import('jspdf')]);
  const doc = new jspdf.jsPDF();
  const W = doc.internal.pageSize.getWidth();
  let y = 18;
  const quebra = (alt = 6) => { if (y > 278) { doc.addPage(); y = 18; } y += alt; };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor('#1B3A5C');
  doc.text('Divergências de vínculo — Portal do Cliente', 14, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor('#666666');
  y += 6;
  doc.text(`CBC Advogados · gerado em ${new Date().toLocaleString('pt-BR')}`, 14, y);
  for (const [key, titulo, , cols] of EXPORT_CATS) {
    const rows = d[key] || [];
    quebra(12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor('#1B3A5C');
    doc.text(`${titulo} (${rows.length})`, 14, y);
    doc.setDrawColor('#C9A84C'); doc.line(14, y + 1.5, W - 14, y + 1.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor('#222222');
    if (!rows.length) { quebra(); doc.text('— nenhum registro —', 14, y); continue; }
    for (const r of rows) {
      const linha = cols.map((c) => r[c] ?? '').filter((v) => v !== '').join('  ·  ');
      const partes = doc.splitTextToSize(linha, W - 28);
      for (const p of partes) { quebra(4.6); doc.text(String(p), 14, y); }
    }
  }
  doc.save(`divergencias_portal_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/* ---------- (#46) links ativos com filtro "nunca acessou" ---------- */
function LinksAtivos({ links }) {
  const [filtro, setFiltro] = useState('todos');
  const [copiado, setCopiado] = useState('');
  const lista = (links || []).filter((l) => filtro === 'nunca' ? !l.acessos : true);
  const copiar = (l) => navigator.clipboard.writeText(`https://contratos-cbc.netlify.app/portal?t=${l.token}`)
    .then(() => { setCopiado(l.token); setTimeout(() => setCopiado(''), 2000); });
  if (!(links || []).length) return null;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-wrap gap-2">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-[color:var(--cbc-text-secondary)] tabular-nums">Links ativos ({(links || []).length})</h3>
        <div className="flex gap-1.5">
          {[['todos', 'Todos'], ['nunca', `Nunca acessou (${(links || []).filter((l) => !l.acessos).length})`]].map(([v, label]) => (
            <button key={v} onClick={() => setFiltro(v)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40 ${filtro === v
                ? 'bg-[color:var(--cbc-accent)] text-white dark:bg-[color:var(--cbc-gold)] dark:text-gray-900'
                : 'bg-gray-100 dark:bg-gray-700 text-[color:var(--cbc-text-secondary)] hover:text-[color:var(--cbc-text-primary)]'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-700/50">
        {lista.map((l) => {
          const primeiro = tituloCase((l.nome || '').trim().split(/\s+/)[0]);
          const wa = waLink(l.celular, primeiro, `https://contratos-cbc.netlify.app/portal?t=${l.token}`);
          return (
            <div key={l.token} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12px]">
              <span className="flex-1 min-w-0 truncate font-bold">{tituloCase(l.nome)}</span>
              <span className={`shrink-0 tabular-nums ${l.acessos ? 'text-[color:var(--cbc-text-secondary)]' : 'text-[color:var(--cbc-warning)] font-bold'}`}>
                {l.acessos ? `${l.acessos} acesso${l.acessos > 1 ? 's' : ''} · ${relativo(l.ultimo_acesso)}` : 'nunca acessou'}
              </span>
              <button onClick={() => copiar(l)} className={`shrink-0 px-2 py-1 rounded text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40 ${copiado === l.token ? 'bg-[color:var(--cbc-success)] text-white' : 'bg-[color:var(--cbc-accent)] text-white'}`}>
                {copiado === l.token ? 'Copiado' : 'Copiar'}
              </button>
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="shrink-0 px-2 py-1 rounded bg-[color:var(--cbc-success)] text-white text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-success)]/40">WhatsApp</a>}
            </div>
          );
        })}
        {!lista.length && <p className="px-4 py-3 text-[12px] text-[color:var(--cbc-text-muted)]">Todo mundo já acessou. 🎉</p>}
      </div>
    </div>
  );
}

/* ---------- (#47 + #11) engajamento + NPS ---------- */
function EngajamentoNps({ engajamento, nps }) {
  const dias = engajamento?.por_dia || [];
  const max = Math.max(1, ...dias.map((d) => d.qtd));
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-[color:var(--cbc-text-secondary)]">Acessos ao portal (14 dias)</h3>
        {dias.length === 0 && <p className="text-[12px] text-[color:var(--cbc-text-muted)] mt-2">Sem acessos registrados ainda.</p>}
        <div className="flex items-end gap-1 h-20 mt-3">
          {dias.map((d) => (
            <div key={d.dia} className="flex-1 rounded-t bg-[color:var(--cbc-accent)] dark:bg-[color:var(--cbc-gold)]" title={`${d.dia}: ${d.qtd}`}
              style={{ height: `${Math.max(6, (d.qtd / max) * 100)}%` }} />
          ))}
        </div>
        {(engajamento?.top || []).length > 0 && (
          <p className="text-[11px] text-[color:var(--cbc-text-secondary)] mt-3">
            Mais engajados: {(engajamento.top || []).slice(0, 3).map((t) => `${tituloCase((t.nome || '').split(/\s+/)[0])} (${t.acessos})`).join(' · ')}
          </p>
        )}
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-[color:var(--cbc-text-secondary)]">NPS do portal</h3>
        {!nps?.respostas && <p className="text-[12px] text-[color:var(--cbc-text-muted)] mt-2">Nenhuma avaliação ainda — a pesquisa aparece no rodapé do portal.</p>}
        {nps?.respostas > 0 && (
          <>
            <div className="flex items-baseline gap-3 mt-2">
              <span className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'Cormorant Garamond, serif' }}>{nps.media}</span>
              <span className="text-[11.5px] text-[color:var(--cbc-text-secondary)] tabular-nums">{nps.respostas} resposta{nps.respostas > 1 ? 's' : ''} · {nps.promotores} promotor(es) · {nps.detratores} detrator(es)</span>
            </div>
            <div className="mt-2 space-y-1.5 max-h-28 overflow-y-auto">
              {(nps.recentes || []).map((r, i) => (
                <p key={i} className="text-[11.5px] text-[color:var(--cbc-text-secondary)]">“{r.comentario}” <span className="text-[color:var(--cbc-text-muted)]">— {tituloCase((r.nome || '').split(/\s+/)[0])}, nota {r.nota}</span></p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- métricas de uso do portal (ranking de funções, horários) ---------- */
const ALVO_LABEL = {
  'tab:proc': 'Aba "Meu caso"', 'tab:pag': 'Aba "Pagamentos"', 'tab:faq': 'Aba "Dúvidas"', 'tab:acordo': 'Aba "Acordo"',
  copiar_pix: 'Copiar PIX', ver_boleto: 'Ver boleto', extrato_pdf: 'Baixar extrato PDF', lembrete_cal: 'Lembrete no calendário',
  ouvir_resumo: 'Ouvir resumo (voz)', whatsapp: 'Botão WhatsApp', pergunta: 'Enviar pergunta', nps: 'Avaliar (NPS)', ver_historico: 'Ver histórico completo',
};
function MetricasPortal() {
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let vivo = true;
    (async () => { try { const d = await api('metricas'); if (vivo) setM(d); } catch { /* silencioso */ } if (vivo) setBusy(false); })();
    return () => { vivo = false; };
  }, []);
  if (busy) return null;
  if (!m || !m.eventos_total) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-[color:var(--cbc-text-secondary)]">Uso do portal — ranking de funções</h3>
        <p className="text-[12px] text-[color:var(--cbc-text-muted)] mt-2">As métricas de uso (cliques, funções mais usadas e horários) começam a aparecer assim que os clientes navegarem no portal.</p>
      </div>
    );
  }
  const rank = m.ranking_funcoes || [];
  const maxR = Math.max(1, ...rank.map((x) => x.qtd));
  const horas = m.por_hora || [];
  const maxH = Math.max(1, ...horas.map((x) => x.qtd));
  const horaMap = {};
  horas.forEach((h) => { horaMap[h.hora] = h.qtd; });
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-[color:var(--cbc-text-secondary)]">Funções mais usadas</h3>
        <div className="space-y-1.5 mt-3">
          {rank.slice(0, 12).map((x) => (
            <div key={x.alvo} className="flex items-center gap-2">
              <span className="text-[11.5px] w-36 shrink-0 truncate" title={ALVO_LABEL[x.alvo] || x.alvo}>{ALVO_LABEL[x.alvo] || x.alvo}</span>
              <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded h-3">
                <div className="h-3 rounded bg-[color:var(--cbc-accent)] dark:bg-[color:var(--cbc-gold)]" style={{ width: `${(x.qtd / maxR) * 100}%` }} />
              </div>
              <span className="text-[11px] text-[color:var(--cbc-text-secondary)] w-9 text-right tabular-nums">{x.qtd}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[color:var(--cbc-text-secondary)] mt-3 tabular-nums">{m.eventos_30d} interações nos últimos 30 dias{m.tempo_medio ? ` · tempo médio na página: ${m.tempo_medio}s` : ''}</p>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-[color:var(--cbc-text-secondary)]">Horários de acesso</h3>
        <div className="flex items-end gap-[2px] h-24 mt-3">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="flex-1 rounded-t bg-[color:var(--cbc-accent)] dark:bg-[color:var(--cbc-gold)]" title={`${h}h: ${horaMap[h] || 0}`}
              style={{ height: `${Math.max(3, ((horaMap[h] || 0) / maxH) * 100)}%` }} />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-[color:var(--cbc-text-muted)] mt-1 tabular-nums"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      </div>
    </div>
  );
}

function Stat({ rotulo, valor, destaque }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${destaque
      ? 'border-[color:var(--cbc-gold-dark)]/60 bg-[color:var(--cbc-gold)]/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
      <div className="text-xl font-bold tabular-nums" style={{ fontFamily: 'Cormorant Garamond, serif' }}>{valor ?? '—'}</div>
      <div className="text-[11px] uppercase tracking-wider text-[color:var(--cbc-text-secondary)] font-bold mt-0.5">{rotulo}</div>
    </div>
  );
}

/* (portal-19) Quando a equipe RESPONDE uma duvida (status -> 'respondida' em
 * portal_perguntas), avisa o cliente por push ("Respondemos sua pergunta").
 * A acao de salvar a resposta vive em PortalConteudoSecoes (outro arquivo), entao
 * detectamos a transicao por realtime aqui e disparamos o push pelo token da
 * pergunta — best-effort: se o push falhar, a resposta NAO e afetada.
 * Dedupe por id (ref) + janela de 90s p/ ignorar updates historicos/de backfill. */
function PerguntasComPush({ onPending }) {
  const jaAvisado = useRef(new Set());
  useEffect(() => {
    const enviarPush = async (q) => {
      if (!q?.token || q.status !== 'respondida') return;
      if (jaAvisado.current.has(q.id)) return;
      // so notifica respostas recentes (evita re-disparo em updates antigos)
      const ts = q.respondida_em ? new Date(q.respondida_em).getTime() : Date.now();
      if (Number.isFinite(ts) && Date.now() - ts > 90000) return;
      jaAvisado.current.add(q.id);
      const primeiro = tituloCase(String(q.nome || '').trim().split(/\s+/)[0] || '');
      try {
        await fetch('/.netlify/functions/portal-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-key': BOT_KEY },
          body: JSON.stringify({
            acao: 'enviar', t: q.token,
            titulo: 'Respondemos sua pergunta',
            corpo: primeiro ? `${primeiro}, sua dúvida foi respondida. Toque para ver.` : 'Sua dúvida foi respondida. Toque para ver.',
            url: `/portal?t=${q.token}`,
          }),
        });
      } catch { /* best-effort: a resposta ja foi salva, o push e secundario */ }
    };
    const channel = supabase
      .channel('portal-perguntas-push-rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'portal_perguntas' },
        (payload) => enviarPush(payload.new))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);
  return <PerguntasClientes onPending={onPending} />;
}

export default function PortalClientePanel() {
  const [secao, setSecao] = useState('geral');
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');
  const [diag, setDiag] = useState(null);
  const [diagBusy, setDiagBusy] = useState(true);
  const [mostrar, setMostrar] = useState(30);
  const [pendentes, setPendentes] = useState(0);
  const timer = useRef(null);

  const carregarDiag = useCallback(async () => {
    setDiagBusy(true);
    try { const d = await api('diagnostico'); setDiag(d); }
    catch (e) { setErro(e.message); }
    setDiagBusy(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregarDiag();
    // contagem de dúvidas pendentes p/ o badge da aba (head count, barato)
    supabase.from('portal_perguntas').select('id', { count: 'exact', head: true }).eq('status', 'pendente')
      .then(({ count }) => setPendentes(count || 0));
  }, [carregarDiag]);

  const buscar = useCallback((texto) => {
    clearTimeout(timer.current);
    if (texto.trim().length < 3) { setResultados(null); setBuscando(false); return; }
    setBuscando(true);
    timer.current = setTimeout(async () => {
      try {
        setErro('');
        const r = await api('search', { q: texto.trim() });
        setResultados(r.clientes);
      } catch (e) { setErro(e.message); setResultados([]); }
      setBuscando(false);
    }, 450);
  }, []);

  const atualizar = (novo) => {
    setResultados((rs) => (rs || []).map((c) => (c.customer_id === novo.customer_id ? novo : c)));
  };

  const [exportando, setExportando] = useState('');
  const exportar = async (tipo) => {
    setExportando(tipo);
    try { await (tipo === 'pdf' ? exportarPdf() : exportarExcel()); }
    catch (e) { alert(`Exportação falhou: ${e.message}`); }
    setExportando('');
  };

  // marca cliente como "só êxito" -> sai da lista sem_asaas na hora
  const marcarSoExito = async (item) => {
    await api('flag_so_exito', { customer_id: item.customer_id, nome: item.nome });
    setDiag((d) => {
      if (!d) return d;
      const sa = d.inconsistencias?.sem_asaas || {};
      return {
        ...d,
        resumo: { ...d.resumo, marcados_so_exito: (d.resumo?.marcados_so_exito || 0) + 1 },
        inconsistencias: {
          ...d.inconsistencias,
          sem_asaas: {
            qtd: Math.max(0, (sa.qtd || 1) - 1),
            lista: (sa.lista || []).filter((i) => i.customer_id !== item.customer_id),
          },
        },
      };
    });
  };

  const emBusca = q.trim().length >= 3;
  const r = diag?.resumo || {};
  const incs = diag?.inconsistencias || {};
  const diagSkeleton = (
    <div className="space-y-3"><div className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" /><div className="h-48 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" /></div>
  );

  return (
    <div className="h-full flex flex-col">
      <style>{`@keyframes portalSec{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}.portal-sec{animation:portalSec .3s ease-out}`}</style>

      {/* ---------- cabeçalho fixo: título + sub-navegação + busca ---------- */}
      <div className="shrink-0 max-w-5xl mx-auto w-full px-4 pt-5">
        <div className="flex items-end justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[color:var(--cbc-text-primary)] dark:text-white font-bold leading-none" style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 28 }}>
              Portal do Cliente
            </h2>
            <p className="text-xs text-[color:var(--cbc-text-secondary)] mt-1">Central do portal — gere links, edite tudo que o cliente vê e responda dúvidas.</p>
          </div>
          <a href="https://contratos-cbc.netlify.app/portal" target="_blank" rel="noopener"
            className="group inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-full bg-[color:var(--cbc-gold)]/15 text-[color:var(--cbc-gold-dark)] dark:text-[color:var(--cbc-gold)] font-bold border border-[color:var(--cbc-gold)]/30 hover:bg-[color:var(--cbc-gold)]/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-gold-dark)]/40">
            Abrir portal do cliente
            <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {SECOES.map((s) => {
              const ativa = secao === s.id && !emBusca;
              return (
                <button key={s.id} onClick={() => { setSecao(s.id); setQ(''); }}
                  className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40 ${ativa
                    ? 'bg-[color:var(--cbc-accent)] text-white dark:bg-[color:var(--cbc-gold)] dark:text-gray-900 shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-700/60 text-[color:var(--cbc-text-secondary)] hover:text-[color:var(--cbc-text-primary)]'}`}>
                  <s.icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{s.label}</span>
                  {s.id === 'duvidas' && pendentes > 0 && (
                    <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold inline-flex items-center justify-center tabular-nums ${ativa ? 'bg-white/30 text-white dark:bg-gray-900/25 dark:text-gray-900' : 'bg-[color:var(--cbc-warning)] text-white'}`}>
                      {pendentes > 99 ? '99+' : pendentes}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="relative ml-auto flex-1 min-w-[180px] max-w-xs">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--cbc-text-muted)]" />
            <input type="text" value={q} onChange={(e) => { setQ(e.target.value); buscar(e.target.value); }}
              placeholder="Buscar cliente / CPF…"
              className="w-full pl-9 pr-3 py-2 rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-[12.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-gold-dark)]/60" />
          </div>
        </div>
        <div className="mt-3 h-px bg-gradient-to-r from-[color:var(--cbc-gold)]/50 via-[color:var(--cbc-gold)]/15 to-transparent" />
      </div>

      {/* ---------- corpo ---------- */}
      <div className="flex-1 overflow-y-auto">
        <div key={emBusca ? 'busca' : secao} className="portal-sec max-w-5xl mx-auto w-full p-4 space-y-4">
          {erro && <p className="text-xs text-[color:var(--cbc-danger)]">{erro}</p>}

          {/* modo busca (sobrepõe a seção ativa) */}
          {emBusca ? (
            <>
              {buscando && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />)}</div>}
              {!buscando && resultados !== null && resultados.length === 0 && !erro && (
                <div className="text-center py-12 text-[color:var(--cbc-text-muted)]"><p className="text-sm">Nenhum cliente encontrado com “{q}” no espelho do ADVBOX.</p></div>
              )}
              {!buscando && (resultados || []).map((c) => <ClienteCard key={c.customer_id} c={c} onAtualizado={atualizar} />)}
            </>
          ) : (
            <>
              {/* ===== Visão geral ===== */}
              {secao === 'geral' && (diag ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                    <Stat rotulo="Clientes ADVBOX" valor={r.clientes_advbox} />
                    <Stat rotulo="Com processo" valor={r.com_processo} />
                    <Stat rotulo="Links ativos" valor={r.links_ativos} destaque />
                    <Stat rotulo="Prontos p/ gerar" valor={r.prontos_para_gerar} />
                    <Stat rotulo="Contratos ativos" valor={r.contratos_ativos} />
                  </div>
                  <EngajamentoNps engajamento={diag.engajamento} nps={diag.nps} />
                  <MetricasPortal />
                  <CorrelacaoCard />
                </>
              ) : diagSkeleton)}

              {/* ===== Clientes & Links ===== */}
              {secao === 'clientes' && (diag ? (
                <>
                  <LinksAtivos links={diag.links} />
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                      <h3 className="text-[13px] font-bold uppercase tracking-wide text-[color:var(--cbc-text-secondary)]">
                        Links prontos para gerar <span className="text-[color:var(--cbc-text-muted)] font-normal normal-case">— cliente com CPF e processo, ainda sem link</span>
                      </h3>
                      <button onClick={carregarDiag} title="Atualizar" className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40">
                        <ArrowPathIcon className={`w-4 h-4 text-[color:var(--cbc-text-secondary)] ${diagBusy ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    {(diag.prontos || []).slice(0, mostrar).map((p) => <ProntoRow key={p.customer_id} p={p} />)}
                    {!(diag.prontos || []).length && <p className="px-4 py-4 text-[12px] text-[color:var(--cbc-text-muted)]">Nenhum cliente pendente — todos os elegíveis já têm link. 🎉</p>}
                    {(diag.prontos || []).length > mostrar && (
                      <button onClick={() => setMostrar((m) => m + 50)}
                        className="w-full py-2.5 text-[12px] font-bold text-[color:var(--cbc-text-secondary)] hover:text-[color:var(--cbc-text-primary)] border-t border-gray-100 dark:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40">
                        Mostrar mais ({(diag.prontos || []).length - mostrar} restantes na lista)
                      </button>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <h3 className="text-[13px] font-bold uppercase tracking-wide text-[color:var(--cbc-text-secondary)]">
                        Inconsistências de vínculo <span className="text-[color:var(--cbc-text-muted)] font-normal normal-case">— o que impede a experiência completa no portal</span>
                      </h3>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => exportar('pdf')} disabled={!!exportando}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-[11px] font-bold text-[color:var(--cbc-text-secondary)] hover:text-[color:var(--cbc-text-primary)] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40">
                          <DocumentArrowDownIcon className={`w-4 h-4 ${exportando === 'pdf' ? 'animate-pulse' : ''}`} /> PDF completo
                        </button>
                        <button onClick={() => exportar('xlsx')} disabled={!!exportando}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-[11px] font-bold text-[color:var(--cbc-text-secondary)] hover:text-[color:var(--cbc-text-primary)] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-accent)]/40">
                          <TableCellsIcon className={`w-4 h-4 ${exportando === 'xlsx' ? 'animate-pulse' : ''}`} /> Excel completo
                        </button>
                      </div>
                    </div>
                    {r.marcados_so_exito > 0 && (
                      <p className="text-[11px] text-[color:var(--cbc-text-secondary)] mb-2 tabular-nums">{r.marcados_so_exito} cliente(s) marcados como “só êxito” (sem honorários iniciais) — fora da lista do Asaas.</p>
                    )}
                    <div className="space-y-2">
                      <IncSection chave="sem_cpf" dados={incs.sem_cpf} />
                      <IncSection chave="sem_asaas" dados={incs.sem_asaas} onAcao={marcarSoExito} />
                      <IncSection chave="contrato_sem_kommo" dados={incs.contrato_sem_kommo} />
                      <IncSection chave="contrato_sem_advbox" dados={incs.contrato_sem_advbox} />
                      <IncSection chave="contrato_cpf_fora_advbox" dados={incs.contrato_cpf_fora_advbox} />
                    </div>
                  </div>
                </>
              ) : diagSkeleton)}

              {/* ===== Conteúdo do portal (todos os parâmetros editáveis) ===== */}
              {secao === 'conteudo' && (
                <>
                  <div className="rounded-xl border border-[color:var(--cbc-gold)]/30 bg-[color:var(--cbc-gold)]/10 px-4 py-3 flex items-start gap-2.5">
                    <SparklesIcon className="w-5 h-5 text-[color:var(--cbc-gold-dark)] shrink-0 mt-0.5" />
                    <p className="text-[12px] leading-relaxed text-[color:var(--cbc-text-primary)]">
                      Tudo que o cliente vê no portal, editável aqui. <b>Campos vazios usam o texto padrão</b> já revisado — preencha só para personalizar. As mudanças aparecem no próximo acesso do cliente.
                    </p>
                  </div>
                  <EducacaoPortal />
                  <FaqPortal />
                  <ContatoPortal />
                  <ExplicadorPortal />
                  <ReviewPortal />
                  <EquipePortal />
                </>
              )}

              {/* ===== Dúvidas dos clientes ===== */}
              {/* (portal-19) wrapper avisa o cliente por push ao responder */}
              {secao === 'duvidas' && <PerguntasComPush onPending={setPendentes} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
