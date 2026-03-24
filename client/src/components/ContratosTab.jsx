import { useState, useEffect, useCallback, useRef } from 'react';
import { API_URL } from '../config';

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy}
      className="shrink-0 px-2 py-1 text-[9px] font-bold uppercase rounded cursor-pointer transition-all"
      style={copied ? { background: '#D1FAE5', color: '#065F46' } : { background: '#EEF4FF', color: '#1B3A5C', border: '1px solid #C0D0E8' }}>
      {copied ? '✓ Copiado' : label || 'Copiar'}
    </button>
  );
}

const STATUS_LABELS = {
  rascunho: { label: 'Rascunho', color: '#9CA3AF', bg: '#F3F4F6' },
  enviado_zapsign: { label: 'Enviado', color: '#2563EB', bg: '#EFF6FF' },
  assinado: { label: 'Assinado', color: '#16A34A', bg: '#F0FDF4' },
  cancelado: { label: 'Cancelado', color: '#DC2626', bg: '#FEF2F2' },
};

function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] || STATUS_LABELS.rascunho;
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap"
      style={{ color: s.color, background: s.bg }}>{s.label}</span>
  );
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatCurrency(val) {
  if (!val) return '—';
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ─── Progress Steps ───
const PROGRESS_STEPS = [
  { key: 'rascunho', label: 'Rascunho', icon: '📝' },
  { key: 'salvo', label: 'Salvo', icon: '💾' },
  { key: 'enviado_zapsign', label: 'Enviado', icon: '📤' },
  { key: 'assinado', label: 'Assinado', icon: '✅' },
];

function getStepIndex(status) {
  if (status === 'assinado') return 3;
  if (status === 'enviado_zapsign') return 2;
  if (status === 'cancelado') return -1;
  return 1; // saved in DB = step 1
}

function ContractProgressBar({ status, createdAt, updatedAt }) {
  const currentIdx = getStepIndex(status);

  if (status === 'cancelado') {
    return (
      <div className="flex items-center gap-1 px-3 py-2 bg-red-50 rounded-lg">
        <span className="text-red-500 text-sm">✕</span>
        <span className="text-[10px] font-bold text-red-500 uppercase">Contrato Cancelado</span>
      </div>
    );
  }

  // Derive dates for each step
  const stepDates = [
    createdAt, // rascunho = created
    createdAt, // salvo = created (saved to DB)
    status === 'enviado_zapsign' || status === 'assinado' ? updatedAt || createdAt : null,
    status === 'assinado' ? updatedAt : null,
  ];

  return (
    <div className="flex items-center w-full px-1 py-2">
      {PROGRESS_STEPS.map((step, i) => {
        const isActive = i <= currentIdx;
        const isCurrent = i === currentIdx;
        const date = stepDates[i];
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-0.5 shrink-0" style={{ minWidth: '40px' }}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] transition-all duration-500 ${
                isCurrent ? 'ring-2 ring-offset-1' : ''
              }`}
                style={{
                  background: isActive ? '#1B3A5C' : '#E5E7EB',
                  color: isActive ? '#fff' : '#9CA3AF',
                  ringColor: isCurrent ? '#1B3A5C' : 'transparent',
                }}>
                {isActive ? step.icon : (i + 1)}
              </div>
              <span className={`text-[8px] font-bold uppercase leading-tight text-center transition-colors duration-300 ${
                isActive ? 'text-[#1B3A5C]' : 'text-gray-400'
              }`}>{step.label}</span>
              {date && isActive ? (
                <span className="text-[7px] text-gray-400 leading-tight">{fmtDateShort(date)}</span>
              ) : (
                <span className="text-[7px] text-transparent leading-tight">00/00</span>
              )}
            </div>
            {i < PROGRESS_STEPS.length - 1 && (
              <div className="flex-1 h-0.5 mx-1 rounded-full transition-all duration-500"
                style={{ background: i < currentIdx ? '#1B3A5C' : '#E5E7EB' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Pagination ───
function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 py-2">
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
        className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 cursor-pointer disabled:opacity-30 disabled:cursor-default text-xs">‹</button>
      {pages.map((p, idx) => (
        p === '...' ? (
          <span key={`dot-${idx}`} className="text-gray-400 text-xs px-1">...</span>
        ) : (
          <button key={p} onClick={() => onPageChange(p)}
            className={`w-7 h-7 rounded text-[10px] font-bold cursor-pointer transition-all ${
              p === page ? 'text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
            style={p === page ? { background: '#1B3A5C' } : {}}>{p}</button>
        )
      ))}
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
        className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 cursor-pointer disabled:opacity-30 disabled:cursor-default text-xs">›</button>
    </div>
  );
}

// ─── Main Component ───
const PAGE_SIZE = 10;

export default function ContratosTab({ onLoadContract }) {
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [syncing, setSyncing] = useState(false);

  const fetchContratos = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (filterStatus) params.set('status', filterStatus);
      const resp = await fetch(`${API_URL}/api/contratos?${params}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setContratos(data.contratos || []);
      setPage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus]);

  const syncZapSign = useCallback(async () => {
    setSyncing(true);
    try {
      const resp = await fetch(`${API_URL}/api/zapsign/sync`, { method: 'POST' });
      const data = await resp.json();
      if (data.synced > 0) await fetchContratos();
    } catch {}
    finally { setSyncing(false); }
  }, [fetchContratos]);

  useEffect(() => { fetchContratos(); }, [fetchContratos]);

  // Auto-sync ZapSign on mount
  useEffect(() => { syncZapSign(); }, []);

  const handleSearchKeyDown = (e) => { if (e.key === 'Enter') fetchContratos(); };

  // Pull to refresh
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const listRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    if (listRef.current && listRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    } else { touchStartY.current = 0; }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!touchStartY.current) return;
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0 && diff < 120) setPullY(diff);
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (pullY > 60) { setRefreshing(true); await fetchContratos(); setRefreshing(false); }
    setPullY(0); touchStartY.current = 0;
  }, [pullY, fetchContratos]);

  const handleViewDetail = async (id) => {
    if (selectedId === id) { setSelectedId(null); setDetail(null); return; }
    setSelectedId(id);
    try {
      const resp = await fetch(`${API_URL}/api/contratos/${id}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setDetail(data);
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Tem certeza que deseja excluir este contrato?')) return;
    try {
      const resp = await fetch(`${API_URL}/api/contratos/${id}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error('Erro ao excluir');
      setContratos(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
    } catch (err) { setError(err.message); }
  };

  const handleLoadContract = (dados) => { if (onLoadContract && dados) onLoadContract(dados); };

  // Selection helpers
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === contratos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contratos.map(c => c.id)));
    }
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Tem certeza que deseja excluir ${selectedIds.size} contrato${selectedIds.size > 1 ? 's' : ''}?`)) return;
    setDeleting(true);
    try {
      const promises = [...selectedIds].map(id =>
        fetch(`${API_URL}/api/contratos/${id}`, { method: 'DELETE' })
      );
      await Promise.all(promises);
      setContratos(prev => prev.filter(c => !selectedIds.has(c.id)));
      if (selectedIds.has(selectedId)) { setSelectedId(null); setDetail(null); }
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch (err) { setError('Erro ao excluir contratos: ' + err.message); }
    finally { setDeleting(false); }
  };

  // Pagination
  const totalPages = Math.ceil(contratos.length / PAGE_SIZE);
  const pagedContratos = contratos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="h-full flex flex-col"
      ref={listRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}>
      {/* Pull to refresh */}
      {(pullY > 0 || refreshing) && (
        <div className="shrink-0 flex items-center justify-center py-2 text-[10px] font-bold uppercase text-gray-500 transition-all"
          style={{ height: refreshing ? 36 : Math.min(pullY, 60), overflow: 'hidden' }}>
          {refreshing ? <span className="animate-spin">&#8635;</span> : pullY > 60 ? <span>Solte para atualizar</span> : <span style={{ opacity: pullY / 60 }}>Puxe para atualizar</span>}
        </div>
      )}

      {/* Search */}
      <div className="p-3 md:p-4 border-b border-gray-200 space-y-2.5">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input type="text" placeholder="Buscar por nome, CPF ou resort..."
              value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleSearchKeyDown}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#1B3A5C] focus:outline-none pr-8" />
            <svg className="absolute right-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button onClick={fetchContratos}
            className="px-3 md:px-4 py-2 text-xs font-bold uppercase rounded-lg text-white cursor-pointer shrink-0"
            style={{ background: '#1B3A5C' }}>Buscar</button>
          <button onClick={syncZapSign} disabled={syncing} title="Sincronizar status ZapSign"
            className={`px-2 py-2 rounded-lg cursor-pointer shrink-0 transition-all ${syncing ? 'animate-spin' : 'hover:bg-gray-100'}`}
            style={{ color: '#1B3A5C' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
          {[
            { value: '', label: 'Todos' },
            { value: 'rascunho', label: 'Rascunhos' },
            { value: 'enviado_zapsign', label: 'Enviados' },
            { value: 'assinado', label: 'Assinados' },
            { value: 'cancelado', label: 'Cancelados' },
          ].map(opt => (
            <button key={opt.value} onClick={() => setFilterStatus(opt.value)}
              className={`px-3 py-1 text-[10px] font-bold uppercase rounded-full cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                filterStatus === opt.value ? 'text-white' : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
              }`}
              style={filterStatus === opt.value ? { background: '#1B3A5C' } : {}}>{opt.label}</button>
          ))}
        </div>
      </div>

      {/* Selection toolbar */}
      {contratos.length > 0 && (
        <div className="px-3 md:px-4 pt-2 flex items-center gap-2">
          {!selectionMode ? (
            <button onClick={() => setSelectionMode(true)}
              className="text-[10px] font-bold uppercase text-gray-400 hover:text-[#1B3A5C] cursor-pointer transition-colors flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              Selecionar
            </button>
          ) : (
            <>
              <button onClick={toggleSelectAll}
                className="text-[10px] font-bold uppercase cursor-pointer transition-colors flex items-center gap-1 px-2 py-1 rounded"
                style={{ color: '#1B3A5C', background: '#EEF4FF' }}>
                {selectedIds.size === contratos.length ? '☑ Desmarcar Todos' : '☐ Selecionar Todos'}
              </button>
              <span className="text-[10px] text-gray-400 font-bold">
                {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
              </span>
              {selectedIds.size > 0 && (
                <button onClick={handleBulkDelete} disabled={deleting}
                  className="text-[10px] font-bold uppercase cursor-pointer transition-colors flex items-center gap-1 px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  {deleting ? 'Excluindo...' : 'Excluir Selecionados'}
                </button>
              )}
              <button onClick={cancelSelection}
                className="text-[10px] font-bold uppercase text-gray-400 hover:text-gray-600 cursor-pointer ml-auto">
                Cancelar
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mx-3 md:mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">Carregando contratos...</div>
        ) : contratos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm font-medium">Nenhum contrato encontrado</p>
            <p className="text-xs mt-1">Os contratos salvos aparecerão aqui</p>
          </div>
        ) : (
          <div className="p-2 md:p-3 space-y-2">
            {pagedContratos.map(c => (
              <div key={c.id} className={`border rounded-lg overflow-hidden transition-all ${
                selectedIds.has(c.id) ? 'border-blue-400 bg-blue-50/30 ring-1 ring-blue-200' : 'border-gray-200'
              }`}>
                <div className="p-3 cursor-pointer hover:bg-gray-50 transition-colors flex gap-2" onClick={() => selectionMode ? toggleSelect(c.id) : handleViewDetail(c.id)}>
                  {selectionMode && (
                    <div className="shrink-0 flex items-start pt-0.5">
                      <input type="checkbox" checked={selectedIds.has(c.id)} readOnly
                        className="w-4 h-4 accent-[#1B3A5C] cursor-pointer rounded" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-gray-800 truncate">{c.nome_contratante1}</div>
                      {c.nome_contratante2 && (
                        <div className="text-[11px] text-gray-400 truncate">& {c.nome_contratante2}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusBadge status={c.status} />
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${selectedId === c.id ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 md:gap-3 mt-1.5 flex-wrap">
                    <span className="text-[10px] text-gray-400">{c.cpf_contratante1}</span>
                    <span className="text-[10px] text-gray-400">{c.resort}</span>
                    <span className="text-[10px] text-gray-400">{fmtDate(c.created_at)}</span>
                    {c.created_by && (
                      <span className="text-[9px] text-blue-500 font-medium" title={c.created_by}>
                        {c.created_by.split('@')[0]}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-gray-600 ml-auto">{formatCurrency(c.honorarios_total)}</span>
                  </div>
                  {/* Progress bar with dates */}
                  <ContractProgressBar status={c.status} createdAt={c.created_at} updatedAt={c.updated_at} />
                  </div>{/* close flex-1 wrapper */}
                </div>

                {selectedId === c.id && detail && (
                  <div className="border-t border-gray-200 bg-gray-50 p-3 md:p-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-gray-400 uppercase font-bold text-[10px]">Contratante 1</span>
                        <p className="text-gray-700">{detail.nome_contratante1}</p>
                        <p className="text-gray-500 break-all">{detail.cpf_contratante1} | {detail.email_contratante1}</p>
                      </div>
                      {detail.nome_contratante2 && (
                        <div>
                          <span className="text-gray-400 uppercase font-bold text-[10px]">Contratante 2</span>
                          <p className="text-gray-700">{detail.nome_contratante2}</p>
                          <p className="text-gray-500 break-all">{detail.cpf_contratante2} | {detail.email_contratante2}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-400 uppercase font-bold text-[10px]">Resort</span>
                        <p className="text-gray-700">{detail.resort}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase font-bold text-[10px]">Tipo de Acao</span>
                        <p className="text-gray-700">{detail.tipo_acao}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase font-bold text-[10px]">Honorarios</span>
                        <p className="text-gray-700">
                          {detail.honorarios_total > 0 ? `${formatCurrency(detail.honorarios_total)} em ${detail.honorarios_parcelas === 1 ? 'à vista' : `${detail.honorarios_parcelas}x de ${formatCurrency(detail.honorarios_valor_parcela)}`}` : 'Somente êxito'}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase font-bold text-[10px]">Exito</span>
                        <p className="text-gray-700">{detail.honorarios_percentual_exito > 0 ? `${detail.honorarios_percentual_exito}%` : 'Sem êxito'}</p>
                      </div>
                      {detail.created_by && (
                        <div>
                          <span className="text-gray-400 uppercase font-bold text-[10px]">Criado por</span>
                          <p className="text-gray-700">{detail.created_by}</p>
                        </div>
                      )}
                      {detail.updated_by && detail.updated_by !== detail.created_by && (
                        <div>
                          <span className="text-gray-400 uppercase font-bold text-[10px]">Atualizado por</span>
                          <p className="text-gray-700">{detail.updated_by}</p>
                        </div>
                      )}
                      {detail.zapsign_doc_token && (
                        <div className="col-span-1 md:col-span-2">
                          <span className="text-gray-400 uppercase font-bold text-[10px]">ZapSign Token</span>
                          <p className="text-gray-700 font-mono text-[11px] break-all">{detail.zapsign_doc_token}</p>
                        </div>
                      )}
                    </div>

                    {/* Signing links — only show when sent but not yet fully signed */}
                    {detail.zapsign_links && detail.zapsign_links.length > 0 && detail.status !== 'assinado' && (
                      <div className="p-3 rounded-lg space-y-2" style={{ background: '#EEF4FF', border: '1px solid #C0D0E8' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#1B3A5C' }}>
                            Links de Assinatura
                          </span>
                          <CopyButton
                            text={detail.zapsign_links.map(s => `${s.name}: ${s.sign_url}`).join('\n')}
                            label="Copiar Todos"
                          />
                        </div>
                        <div className="space-y-1.5">
                          {detail.zapsign_links.map((signer, i) => (
                            <div key={i} className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] font-bold" style={{ color: '#1B3A5C' }}>
                                    {signer.name || `Contratante ${i + 1}`}
                                  </span>
                                  {signer.doc_type && (
                                    <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                      {signer.doc_type}
                                    </span>
                                  )}
                                  {signer.status && (
                                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                                      signer.status === 'signed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                                    }`}>
                                      {signer.status === 'signed' ? 'Assinado' : 'Pendente'}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[9px] text-blue-600 truncate mt-0.5">{signer.sign_url}</p>
                              </div>
                              <CopyButton text={signer.sign_url} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Show links even when signed, for reference */}
                    {detail.zapsign_links && detail.zapsign_links.length > 0 && detail.status === 'assinado' && (
                      <div className="p-3 rounded-lg" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-green-700">
                          ✅ Contrato assinado por {detail.zapsign_links.length} signatario{detail.zapsign_links.length > 1 ? 's' : ''}
                        </span>
                        <div className="mt-1.5 space-y-1">
                          {detail.zapsign_links.map((signer, i) => (
                            <div key={i} className="text-[10px] text-green-800">
                              ✓ {signer.name || `Contratante ${i + 1}`}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
                      {detail.dados && (
                        <button onClick={() => handleLoadContract(detail.dados)}
                          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg text-white cursor-pointer"
                          style={{ background: '#1B3A5C' }}>Carregar no Formulario</button>
                      )}
                      <button onClick={() => handleDelete(c.id)}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg text-red-600 border border-red-200 hover:bg-red-50 cursor-pointer">Excluir</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: pagination + count */}
      <div className="p-2 md:p-3 border-t border-gray-200">
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        <div className="text-center">
          <span className="text-[10px] text-gray-400 uppercase">
            {contratos.length} contrato{contratos.length !== 1 ? 's' : ''} encontrado{contratos.length !== 1 ? 's' : ''}
            {totalPages > 1 && ` — Pagina ${page} de ${totalPages}`}
          </span>
        </div>
      </div>
    </div>
  );
}
