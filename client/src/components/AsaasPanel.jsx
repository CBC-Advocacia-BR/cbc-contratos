import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { FixedSizeList } from 'react-window';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { SkeletonAsaas } from './Skeleton';
import ErrorState from './ErrorState';
import { usePersistedFilter } from '../hooks/usePersistedFilters';
import StatusPill from './ui/StatusPill';
import MoneyValue from './ui/MoneyValue';
import FreshnessChip from './ui/FreshnessChip';
import { isPaidStatus, isNeutralStatus, isRemovedStatus } from '../lib/statusTokens';
import {
  CreditCardIcon,
  DocumentIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
  CurrencyDollarIcon,
  UserIcon,
  ChartBarIcon,
  PencilSquareIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  DevicePhoneMobileIcon,
  ArrowPathIcon,
  Cog6ToothIcon,
  Bars3Icon,
  LightBulbIcon,
  ClockIcon,
  CheckIcon,
  PencilIcon,
  XCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

const PROXY = '/.netlify/functions/asaas-sync';

// Retry wrapper with exponential backoff
const callAsaas = async (action, payload = {}, retries = 3) => {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!r.ok && r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await new Promise(res => setTimeout(res, 300 * Math.pow(2, i)));
    }
  }
  throw lastErr;
};

const fmt = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const fmtDT = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const initials = email => (email || '').split('@')[0].slice(0, 2).toUpperCase();
const avatarColor = s => {
  const colors = ['#1A2E52', '#C8973A', '#16A34A', '#7C3AED', '#D97706', '#0891B2', '#DB2777', '#059669'];
  let h = 0; for (const c of (s || '')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return colors[Math.abs(h) % colors.length];
};

// NF status label
const NF_STATUS_LABEL = {
  SCHEDULED: { label: 'Agendada', color: '#7C3AED', bg: '#F5F3FF' },
  AUTHORIZED: { label: 'Emitida', color: '#16A34A', bg: '#F0FDF4' },
  PROCESSING_CANCELLATION: { label: 'Cancelando', color: '#D97706', bg: '#FFFBEB' },
  CANCELED: { label: 'Cancelada', color: '#6B7280', bg: '#F3F4F6' },
  ERROR: { label: 'Erro', color: '#DC2626', bg: '#FEF2F2' },
  SYNCHRONIZED: { label: 'Sincronizada', color: '#0891B2', bg: '#ECFEFF' },
};

// ─── Launch Button ───
function LaunchBtn({ contract, onDone }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [selIdx, setSelIdx] = useState(0);
  // (anti-duplicidade 06/07/2026) parcelamentos em aberto do cliente devolvidos
  // pelo servidor (duplicate_warning); null = sem aviso pendente.
  const [warning, setWarning] = useState(null);
  // (chatguru removal 2026-05) chatguruSent removido — asaas-sync nao envia mais via ChatGuru
  const d = contract.dados || {};
  const num = d.numContratantes || 1;
  const multi = num === 2 && d.contratantes?.[1]?.nome;

  if (contract._launched || done) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-green-600 inline-flex items-center gap-1"><CheckCircleIcon className="w-3.5 h-3.5" aria-hidden="true" /> Lançado</span>
      </div>
    );
  }

  const go = async (e, force = false) => {
    e?.stopPropagation();
    setLoading(true); setErr('');
    if (!force) setWarning(null);
    let claimedLock = false;
    try {
      const c = d.contratantes[selIdx];
      if (!c?.cpf) throw new Error('CPF não encontrado');
      // (#24) trava atomica antes de criar a cobranca — evita cobranca DUPLICADA no Asaas
      // em duplo-clique ou lancamento concorrente (manual + automatico). Padrao REGRA #3.
      const { data: claimed } = await supabase.from('contratos')
        .update({ asaas_status: 'launching' })
        .eq('id', contract.id)
        .or('asaas_status.is.null,asaas_status.eq.error')
        .select('id');
      if (!claimed || claimed.length === 0) throw new Error('Cobrança já está sendo lançada ou já foi lançada — aguarde/atualize a lista.');
      claimedLock = true;
      const resort = d.resort === 'outro' ? d.resortCustom : d.resort;
      const res = await callAsaas('create-payment', { contratante: c, honorarios: d.honorarios, contractId: contract.id, resort, force });

      // (fix D 01/06/2026) Mesmo se payment falhou, se backend retornou customer.id,
      // gravamos no banco para evitar customer orfao no Asaas (caso Celso).
      if (res.customer?.id && contract.asaas_customer_id !== res.customer.id) {
        try {
          await supabase.from('contratos').update({
            asaas_customer_id: res.customer.id,
          }).eq('id', contract.id);
        } catch { /* best-effort: persistir customer_id nao deve bloquear o lancamento */ }
      }

      // (anti-duplicidade 06/07/2026) cliente ja tem parcelamento em aberto no Asaas.
      // Libera a trava (volta p/ null, nao fica preso em 'launching') e mostra o aviso;
      // o usuario decide via "Lancar mesmo assim" (rechama go com force=true).
      if (res.duplicate_warning) {
        try {
          await supabase.from('contratos').update({ asaas_status: null })
            .eq('id', contract.id).eq('asaas_status', 'launching');
        } catch { /* best-effort */ }
        claimedLock = false;
        setWarning(res.existing || []);
        return;
      }

      if (!res.success) {
        // (fix B 01/06/2026) Mensagem detalhada do erro Asaas. Asaas retorna JSON
        // com `errors: [{code, description}]` — parseamos para mostrar texto amigavel.
        const errMsg = res.payment_error || res.error || 'Erro desconhecido';
        let friendly = errMsg;
        try {
          const parsed = JSON.parse(errMsg);
          if (Array.isArray(parsed?.errors)) {
            friendly = parsed.errors.map(e => e.description || e.code).join('; ');
          }
        } catch { /* nao e JSON — usa string crua */ }
        throw new Error(friendly);
      }

      try {
        await supabase.from('contratos').update({
          asaas_customer_id: res.customer?.id,
          asaas_payments: res.payment,
          asaas_status: 'launched',
        }).eq('id', contract.id);
      } catch { /* best-effort: a persistencia falhar nao deve esconder o sucesso do lancamento */ }
      setDone(true);
      // (chatguru removal 2026-05) chatguruSent setter removido
      if (onDone) onDone(contract.id, res);
    } catch (e) {
      setErr(e.message);
      // (#24) libera a trava (volta p/ 'error') SO se nos a pegamos — permite nova tentativa
      // sem reabrir a janela de duplicacao (so reseta o nosso 'launching').
      if (claimedLock) { try { await supabase.from('contratos').update({ asaas_status: 'error' }).eq('id', contract.id).eq('asaas_status', 'launching'); } catch { /* best-effort */ } }
    }
    finally { setLoading(false); }
  };

  return (
    <div className="flex items-center gap-1.5">
      {multi && (
        <select className="text-[10px] md:text-[11px] border rounded-md px-2 py-1.5 min-h-[32px] bg-white max-w-[110px] cursor-pointer touch-manipulation" value={selIdx}
          onChange={e => setSelIdx(Number(e.target.value))} onClick={e => e.stopPropagation()}>
          {d.contratantes.slice(0, num).map((c, i) => <option key={i} value={i}>{c.nome?.split(' ')[0]}</option>)}
        </select>
      )}
      <button onClick={go} disabled={loading}
        className="px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1 hover:opacity-90 disabled:opacity-50 text-white"
        style={{ background: '#1A2E52' }}>
        {loading ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <CreditCardIcon className="w-3.5 h-3.5" aria-hidden="true" />}
        {loading ? '...' : 'Lançar'}
      </button>
      {err && <ExclamationTriangleIcon className="w-3.5 h-3.5 text-red-500" title={err} aria-label={err} />}

      {/* (anti-duplicidade 06/07/2026) aviso de parcelamento em aberto — decisao Paulo: avisar e deixar confirmar */}
      {warning && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center modal-backdrop-glass p-3"
          onClick={(e) => { e.stopPropagation(); setWarning(null); }}>
          <div className="modal-glass rounded-xl w-full max-w-[520px] max-h-[85dvh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center gap-2.5" style={{ background: '#B45309' }}>
              <ExclamationTriangleIcon className="w-5 h-5 text-white shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-white font-bold text-sm">Cliente já tem cobrança em aberto</h3>
                <p className="text-[10px] text-white/70 truncate">{contract.nome_contratante1} · confira antes de lançar de novo</p>
              </div>
            </div>
            <div className="p-4 overflow-y-auto space-y-2" style={{ background: 'var(--cbc-surface, #fff)' }}>
              <p className="text-xs" style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}>
                Encontrei <b>{warning.length}</b> parcelamento(s) com parcela em aberto no Asaas para este cliente.
                Lançar outra cobrança agora pode <b>duplicar</b>.
              </p>
              {warning.map((g, i) => (
                <div key={g.key || i} className="border rounded-lg p-2.5 text-xs" style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}>
                  <div className="font-bold" style={{ color: '#92400E' }}>{g.description || 'Cobrança'}</div>
                  <div className="mt-0.5" style={{ color: '#78350F' }}>
                    {g.openCount} parcela(s) em aberto{g.installmentTotal ? ` de ${g.installmentTotal}` : ''} · {fmt(g.openValue)}
                  </div>
                  <div className="mt-0.5" style={{ color: '#A16207' }}>Vencimentos: {fmtD(g.firstDue)} → {fmtD(g.lastDue)}</div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t flex items-center justify-end gap-2" style={{ background: 'var(--cbc-surface, #fff)' }}>
              <button onClick={(e) => { e.stopPropagation(); setWarning(null); }}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border cursor-pointer hover:opacity-80"
                style={{ borderColor: 'var(--cbc-border, #D1D5DB)', color: 'var(--cbc-text-secondary, #4B5563)' }}>
                Cancelar
              </button>
              <button onClick={(e) => go(e, true)} disabled={loading}
                className="px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                style={{ background: '#B45309' }}>
                {loading ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
                {loading ? 'Lançando...' : 'Lançar mesmo assim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Verify Check ───
function VerifyCheck({ contract, userEmail }) {
  const [checked, setChecked] = useState(!!contract.asaas_verified_by);
  const [verifier, setVerifier] = useState(contract.asaas_verified_by || '');
  if (!contract._launched && contract.asaas_status !== 'launched') return null;
  const toggle = async (e) => {
    e?.stopPropagation();
    const newVal = !checked;
    setChecked(newVal);
    const update = newVal
      ? { asaas_verified_by: userEmail, asaas_verified_at: new Date().toISOString() }
      : { asaas_verified_by: null, asaas_verified_at: null };
    setVerifier(newVal ? userEmail : '');
    try { await supabase.from('contratos').update(update).eq('id', contract.id); } catch { /* best-effort: estado de verificacao ja refletido na UI */ }
  };
  return (
    <label className="flex items-center gap-1.5 cursor-pointer min-h-[44px] max-[1366px]:min-h-[44px]" onClick={e => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={toggle} className="w-3.5 h-3.5 accent-green-600 cursor-pointer rounded" />
      <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: checked ? 'var(--cbc-success)' : 'var(--cbc-text-secondary)' }}>
        {checked ? (
          <>
            <CheckIcon className="w-3 h-3" aria-hidden="true" />
            {(verifier || userEmail).split('@')[0]}
          </>
        ) : 'Conferir'}
      </span>
    </label>
  );
}

// ─── NF Badge (inline) ───
function NFBadge({ contract, nfInfo, onClick }) {
  if (!contract._launched) {
    return <span className="text-[9px] text-gray-300">—</span>;
  }
  if (!nfInfo) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
        style={{ background: '#FFFBEB', color: '#D97706' }}
        title="Aguardando pagamento para emissão da NF">
        <ClockIcon className="w-3 h-3 inline mr-0.5" aria-hidden="true" />Aguardando
      </span>
    );
  }
  const st = NF_STATUS_LABEL[nfInfo.status] || { label: nfInfo.status || '?', color: '#6B7280', bg: '#F3F4F6' };
  return (
    <button onClick={e => { e.stopPropagation(); onClick(contract); }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer hover:opacity-80"
      style={{ background: st.bg, color: st.color }}
      title={`Última NF: ${st.label}${nfInfo.effectiveDate ? ' em ' + fmtD(nfInfo.effectiveDate) : ''}`}>
      <DocumentIcon className="w-3 h-3" aria-hidden="true" /> {st.label}
      {nfInfo.effectiveDate && <span className="opacity-70">· {fmtD(nfInfo.effectiveDate).slice(0, 5)}</span>}
    </button>
  );
}

// ─── NF Popover (item 32) ───
function NFDetailsModal({ contract, onClose }) {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const inst = contract.asaas_payments?.installment;
        const custId = contract.asaas_customer_id;
        if (!inst && !custId) { setErr('Sem dados Asaas'); setLoading(false); return; }
        const res = await callAsaas('list-invoices', inst ? { installmentId: inst } : { customerId: custId });
        setInvoices(res.data || []);
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, [contract.id]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center modal-backdrop-glass p-3" onClick={onClose}>
      <div className="modal-glass rounded-xl w-full max-w-[640px] max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between" style={{ background: '#1A2E52' }}>
          <div>
            <h3 className="text-white font-bold text-sm flex items-center gap-2"><DocumentIcon className="w-4 h-4" aria-hidden="true" /> Notas Fiscais · {contract.nome_contratante1}</h3>
            <p className="text-[10px] text-white/60">{invoices.length} nota(s) encontrada(s)</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl px-2">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="text-center text-gray-400 text-sm py-8">Carregando notas fiscais...</div>}
          {err && <div className="text-center text-red-500 text-sm py-8 flex items-center justify-center gap-1.5"><ExclamationTriangleIcon className="w-4 h-4" aria-hidden="true" /> {err}</div>}
          {!loading && !err && invoices.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-8">
              Nenhuma nota fiscal encontrada.<br />
              <span className="text-[10px]">As NFs são emitidas automaticamente após cada pagamento confirmado.</span>
            </div>
          )}
          {!loading && invoices.length > 0 && (
            <div className="space-y-2">
              {invoices.map(inv => {
                const st = NF_STATUS_LABEL[inv.status] || { label: inv.status, color: '#6B7280', bg: '#F3F4F6' };
                return (
                  <div key={inv.id} className="border border-gray-200 rounded-lg p-3 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                          {inv.number && <span className="text-[11px] font-mono text-gray-600">NF #{inv.number}</span>}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1 space-y-0.5">
                          <div className="flex items-center gap-1"><CalendarDaysIcon className="w-3 h-3" aria-hidden="true" /> Emissão: {fmtD(inv.effectiveDate) || '—'}</div>
                          <div className="flex items-center gap-1"><CurrencyDollarIcon className="w-3 h-3" aria-hidden="true" /> Valor: {fmt(inv.value)}</div>
                          {inv.rpsNumber && <div>RPS: {inv.rpsNumber}/{inv.rpsSerie}</div>}
                          {inv.observations && <div className="italic text-gray-400">{inv.observations}</div>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        {inv.pdfUrl && <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-600 font-bold hover:bg-blue-100">PDF</a>}
                        {inv.xmlUrl && <a href={inv.xmlUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] px-2 py-1 rounded bg-gray-50 text-gray-600 font-bold hover:bg-gray-100">XML</a>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Drawer com detalhes + timeline + NFs (items 33, 35) ───
function ContractDrawer({ contract, onClose }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const inst = contract.asaas_payments?.installment;
        if (inst) {
          const res = await callAsaas('get-installment-details', { installmentId: inst });
          if (res.success) setDetails(res);
        }
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, [contract.id]);

  const d = contract.dados || {};
  const h = d.honorarios || {};
  const payments = details?.payments || [];
  const invoices = details?.invoices || [];

  // Timeline events (icon agora e um componente Heroicon)
  const events = [];
  events.push({ label: 'Contrato criado', date: contract.created_at, Icon: PencilIcon, who: contract.created_by });
  if (contract._launched || contract.asaas_status === 'launched') {
    events.push({ label: 'Cobrança lançada no Asaas', date: contract.asaas_payments?.dateCreated || null, Icon: CreditCardIcon });
  }
  payments.forEach(p => {
    if (p.paymentDate || p.clientPaymentDate) {
      events.push({ label: `Parcela paga (${fmt(p.value)})`, date: p.paymentDate || p.clientPaymentDate, Icon: CheckCircleIcon });
    }
  });
  invoices.forEach(inv => {
    if (inv.effectiveDate) events.push({ label: `NF ${NF_STATUS_LABEL[inv.status]?.label || inv.status} #${inv.number || ''}`, date: inv.effectiveDate, Icon: DocumentIcon });
  });
  if (contract.asaas_verified_by) {
    events.push({ label: `Conferido por ${contract.asaas_verified_by.split('@')[0]}`, date: contract.asaas_verified_at, Icon: CheckIcon });
  }
  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/30" onClick={onClose}>
      <div className="bg-white w-full max-w-[560px] h-full overflow-y-auto shadow-2xl animate-[slideIn_0.2s_ease]" onClick={e => e.stopPropagation()}>
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        {/* Header */}
        <div className="sticky top-0 p-4 border-b z-10 flex items-start justify-between" style={{ background: '#1A2E52' }}>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase text-white/60 font-bold">Detalhes do contrato</div>
            <h2 className="text-white text-base font-bold truncate">{contract.nome_contratante1}</h2>
            <div className="text-[10px] text-white/70">{contract.cpf_contratante1} · {contract.resort}</div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl px-2 leading-none">×</button>
        </div>

        {/* Resumo */}
        <div className="p-4 border-b bg-gray-50 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-[9px] text-gray-400 uppercase font-bold">Total</div><div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{fmt(h.total)}</div></div>
          <div><div className="text-[9px] text-gray-400 uppercase font-bold">Parcelas</div><div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{h.parcelas || 1}x</div></div>
          <div><div className="text-[9px] text-gray-400 uppercase font-bold">1º Venc</div><div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{fmtD(h.dataPrimeiraParcela)}</div></div>
        </div>

        {/* Timeline */}
        <div className="p-4 border-b">
          <h3 className="text-[11px] font-bold uppercase text-gray-500 mb-3 flex items-center gap-1.5"><ChartBarIcon className="w-3.5 h-3.5" aria-hidden="true" /> Timeline</h3>
          {events.length === 0 ? (
            <div className="text-[11px] text-gray-400">Sem eventos registrados.</div>
          ) : (
            <div className="space-y-2">
              {events.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  {ev.Icon ? <ev.Icon className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" aria-hidden="true" /> : <span className="w-4 h-4 flex-shrink-0" />}
                  <div className="flex-1">
                    <div className="font-semibold text-gray-700">{ev.label}</div>
                    <div className="text-[9px] text-gray-400">{fmtDT(ev.date)}{ev.who && ` · ${ev.who.split('@')[0]}`}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notas Fiscais */}
        <div className="p-4 border-b">
          <h3 className="text-[11px] font-bold uppercase text-gray-500 mb-3 flex items-center gap-1.5"><DocumentIcon className="w-3.5 h-3.5" aria-hidden="true" /> Notas Fiscais</h3>
          {loading && <div className="text-[11px] text-gray-400">Carregando...</div>}
          {err && <div className="text-[11px] text-red-500 flex items-center gap-1"><ExclamationTriangleIcon className="w-3 h-3" aria-hidden="true" /> {err}</div>}
          {!loading && !err && invoices.length === 0 && (
            <div className="text-[11px] text-gray-400 flex items-center gap-1"><ClockIcon className="w-3 h-3" aria-hidden="true" /> Nenhuma NF emitida. Aguardando pagamento das parcelas.</div>
          )}
          {invoices.map(inv => {
            const st = NF_STATUS_LABEL[inv.status] || { label: inv.status, color: '#6B7280', bg: '#F3F4F6' };
            return (
              <div key={inv.id} className="border rounded-lg p-2 mb-2 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    {inv.number && <span className="text-[10px] font-mono text-gray-600">#{inv.number}</span>}
                    <span className="text-[10px] text-gray-600">{fmt(inv.value)}</span>
                  </div>
                  <div className="text-[9px] text-gray-400 mt-0.5">Emissão: {fmtD(inv.effectiveDate) || '—'}</div>
                </div>
                <div className="flex gap-1">
                  {inv.pdfUrl && <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-bold">PDF</a>}
                  {inv.xmlUrl && <a href={inv.xmlUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-600 font-bold">XML</a>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Parcelas */}
        {payments.length > 0 && (
          <div className="p-4 border-b">
            <h3 className="text-[11px] font-bold uppercase text-gray-500 mb-3 flex items-center gap-1.5"><CreditCardIcon className="w-3.5 h-3.5" aria-hidden="true" /> Parcelas ({payments.length})</h3>
            <div className="space-y-1">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between text-[10px] border rounded px-2 py-1.5">
                  <div>
                    <span className="font-semibold">{fmt(p.value)}</span>
                    <span className="text-gray-400 ml-2">Venc: {fmtD(p.dueDate)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      p.status === 'RECEIVED' || p.status === 'CONFIRMED' ? 'bg-green-50 text-green-700' :
                      p.status === 'OVERDUE' ? 'bg-red-50 text-red-700' :
                      'bg-yellow-50 text-yellow-700'
                    }`}>{p.status}</span>
                    {p.invoiceUrl && <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold">boleto</a>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lançado por (item 41) */}
        {contract.created_by && (
          <div className="p-4 border-b">
            <h3 className="text-[11px] font-bold uppercase text-gray-500 mb-2 flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5" aria-hidden="true" /> Lançado por</h3>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold" style={{ background: avatarColor(contract.created_by) }}>
                {initials(contract.created_by)}
              </div>
              <div>
                <div className="text-[11px] font-semibold">{contract.created_by}</div>
                <div className="text-[9px] text-gray-400">{fmtDT(contract.created_at)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Editor inline de data primeira parcela (clica → date input → salva) ───
// (inline-edit 01/06/2026) Permite alterar dataPrimeiraParcela direto no AsaasPanel
// sem precisar abrir o contrato no FormPanel. Bloqueia se ja lancado (boleto Asaas
// existe — pra alterar precisa fazer no painel Asaas, nao basta atualizar o banco).
const DueDateEditor = memo(function DueDateEditor({ contract, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef(null);
  const h = contract.dados?.honorarios || {};
  const currentDate = h.dataPrimeiraParcela || '';
  const isLaunched = !!contract._launched;
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // Native showPicker quando disponivel (Chrome/Edge) — abre calendario direto
      try { inputRef.current.showPicker?.(); } catch { /* fallback: foco normal */ }
    }
  }, [editing]);

  const handleSave = async (newDate) => {
    if (!newDate || newDate === currentDate) { setEditing(false); return; }
    // Valida data futura
    if (newDate < todayStr) {
      setErrorMsg('Data ja passou — Asaas rejeita');
      setTimeout(() => setErrorMsg(''), 3000);
      return;
    }
    setSaving(true); setErrorMsg('');
    try {
      // Le dados atual + merge + escreve (race condition aceita pq atualizacoes
      // de data sao raras e quase nunca concorrentes para o mesmo contrato).
      const { data: row, error: readErr } = await supabase
        .from('contratos').select('dados').eq('id', contract.id).single();
      if (readErr) throw readErr;
      const newDados = {
        ...(row?.dados || {}),
        honorarios: { ...((row?.dados || {}).honorarios || {}), dataPrimeiraParcela: newDate },
      };
      const { error: updErr } = await supabase.from('contratos')
        .update({ dados: newDados }).eq('id', contract.id);
      if (updErr) throw updErr;
      onUpdate?.(contract.id, newDate, newDados);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      setEditing(false);
    } catch (e) {
      setErrorMsg(e.message || 'erro ao salvar');
      setTimeout(() => setErrorMsg(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  if (isLaunched) {
    return (
      <div className="text-gray-500 cursor-not-allowed" title="Boleto Asaas ja emitido — alterar vencimento no painel Asaas">
        {fmtD(currentDate)}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="relative">
        <input
          ref={inputRef}
          type="date"
          defaultValue={currentDate}
          min={todayStr}
          disabled={saving}
          onBlur={(e) => { if (!saving) handleSave(e.target.value); }}
          onChange={(e) => handleSave(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
          className="w-full text-[10px] border border-blue-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
        {errorMsg && (
          <div className="absolute top-full left-0 mt-0.5 px-1.5 py-0.5 bg-red-600 text-white text-[9px] rounded whitespace-nowrap z-30">
            {errorMsg}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Clique para alterar data da 1a parcela"
      className="w-full px-1 py-0.5 rounded cursor-pointer transition-colors text-[11px] tabular-nums focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy)]/40 focus:outline-none"
      style={savedFlash
        ? { background: 'var(--cbc-success-bg)', color: 'var(--cbc-success)' }
        : { color: 'var(--cbc-text-primary)' }}>
      {fmtD(currentDate)}
      {savedFlash && <CheckIcon className="w-2.5 h-2.5 inline ml-0.5" aria-hidden="true" />}
    </button>
  );
});

// ─── Row (virtual) ───
const Row = memo(function Row({ index, style, data }) {
  const { items, compact, nfMap, payStatusByContract, highlightedIds, userEmail, onDone, onRowClick, onNFClick, onExclude, onRestore, onUpdateDueDate } = data;
  const c = items[index];
  if (!c) return null;
  const d = c.dados || {};
  const h = d.honorarios || {};
  const nome = c.nome_contratante1 || '—';
  const nfInfo = nfMap[c.asaas_payments?.installment] || null;
  const payStatus = payStatusByContract?.[c.id] || null;
  const highlighted = highlightedIds.has(c.id);
  const isExcluded = !!c._excluded;

  return (
    <div style={style}
      className={`flex items-center border-b border-gray-50 hover:bg-white cursor-pointer text-[11px] transition-colors max-sm:min-w-[930px] ${highlighted ? 'bg-yellow-50' : ''}`}
      onClick={() => onRowClick(c)}>
      {/* Cliente */}
      <div className="px-3 flex-1 min-w-0 relative group/name">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0" style={{ background: avatarColor(c.created_by || 'x') }} title={c.created_by || 'Desconhecido'}>
            {initials(c.created_by || '??')}
          </div>
          <span className="font-semibold truncate" style={{ color: 'var(--cbc-text-primary)' }}>{nome}</span>
          {c.nome_contratante2 && <span className="text-[9px] text-gray-400">+1</span>}
        </div>
        {!compact && <div className="text-[9px] text-gray-400 ml-7">{c.cpf_contratante1}</div>}

        {/* Hover preview tooltip (item 36) */}
        <div className="absolute left-3 top-full mt-1 z-50 hidden group-hover/name:block pointer-events-none">
          <div className="bg-white rounded-lg shadow-2xl border border-gray-200 p-3 w-72 text-[10px]">
            <div className="font-bold text-[11px] mb-1" style={{ color: 'var(--cbc-text-primary)' }}>{nome}</div>
            <div className="text-gray-500 mb-2">{c.cpf_contratante1}</div>
            <div className="grid grid-cols-2 gap-1 text-gray-600">
              <div><span className="text-gray-400">Resort:</span> {c.resort || '—'}</div>
              <div><span className="text-gray-400">Valor:</span> {fmt(h.total)}</div>
              <div><span className="text-gray-400">Parcelas:</span> {h.parcelas || 1}x</div>
              <div><span className="text-gray-400">1º Venc:</span> {fmtD(h.dataPrimeiraParcela)}</div>
              <div className="col-span-2"><span className="text-gray-400">Criado:</span> {fmtDT(c.created_at)}</div>
              {c.created_by && <div className="col-span-2"><span className="text-gray-400">Por:</span> {c.created_by}</div>}
            </div>
          </div>
        </div>
      </div>
      {/* Resort */}
      <div className="px-2 w-[140px] text-gray-600 truncate">{c.resort}</div>
      {/* Valor */}
      <div className="px-2 w-[90px] text-right font-semibold" style={{ color: 'var(--cbc-text-primary)' }}>{fmt(h.total)}</div>
      {/* Parc */}
      <div className="px-2 w-[45px] text-center text-gray-500">{h.parcelas || 1}x</div>
      {/* 1° Venc — editor inline (inline-edit 01/06/2026) */}
      <div className="px-2 w-[80px] text-center" onClick={e => e.stopPropagation()}>
        <DueDateEditor contract={c} onUpdate={onUpdateDueDate} />
      </div>
      {/* Pagamento — pior status dos boletos do contrato (hero-financeiro 20/06/2026) */}
      <div className="px-2 w-[110px] flex justify-center">
        {payStatus
          ? <StatusPill domain="pagamento" status={payStatus} size="sm" />
          : <span className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>—</span>}
      </div>
      {/* Asaas */}
      <div className="px-2 w-[140px] text-center" onClick={e => e.stopPropagation()}>
        <LaunchBtn contract={c} onDone={onDone} userEmail={userEmail} />
      </div>
      {/* NF */}
      <div className="px-2 w-[110px] text-center">
        <NFBadge contract={c} nfInfo={nfInfo} onClick={onNFClick} />
      </div>
      {/* Conferido */}
      <div className="px-2 w-[130px] text-center">
        <VerifyCheck contract={c} userEmail={userEmail} />
      </div>
      {/* (exclusao 01/06/2026) Botao Excluir/Restaurar */}
      <div className="px-2 w-[40px] text-center" onClick={e => e.stopPropagation()}>
        {isExcluded ? (
          <button onClick={() => onRestore?.(c)}
            title="Restaurar para a lista de cobrancas"
            className="text-gray-400 hover:text-green-600 transition-colors cursor-pointer"
            aria-label="Restaurar contrato">
            <ArrowPathIcon className="w-3.5 h-3.5 inline" aria-hidden="true" />
          </button>
        ) : (
          <button onClick={() => onExclude?.(c)}
            title={c._launched ? 'Excluir da lista (cobranca ja lancada — recomendado restaurar antes de novas operacoes)' : 'Excluir cliente da lista de cobrancas'}
            className="text-gray-300 hover:text-red-500 transition-colors cursor-pointer"
            aria-label="Excluir da lista">
            <XCircleIcon className="w-4 h-4 inline" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Skeleton (item 60) ───
const SkeletonRows = ({ count = 10 }) => (
  <div className="space-y-0">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="flex items-center px-3 py-3 border-b border-gray-50 animate-pulse">
        <div className="w-6 h-6 rounded-full bg-gray-200 mr-2" />
        <div className="h-3 bg-gray-200 rounded flex-1 mr-3" />
        <div className="h-3 bg-gray-200 rounded w-20 mr-3" />
        <div className="h-3 bg-gray-200 rounded w-16 mr-3" />
        <div className="h-6 bg-gray-200 rounded w-24" />
      </div>
    ))}
  </div>
);

// ─── PDF Report ───
// Retorna a data de lançamento de um contrato (prioriza asaas_payments.dateCreated, fallback created_at)
function launchDate(c) {
  return c.asaas_payments?.dateCreated || c.created_at || null;
}

async function genReport(allContracts) {
  // (counter-fix 01/06/2026) Relatorio PDF tambem ignora excluidos.
  const contracts = allContracts.filter(c => !c._excluded);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const w = pdf.internal.pageSize.getWidth();
  const now = new Date();
  const monthStr = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const currentYM = now.toISOString().slice(0, 7); // YYYY-MM

  // Header
  pdf.setFontSize(16); pdf.setTextColor(26, 46, 82);
  pdf.text('RELATÓRIO DE HONORÁRIOS — CBC', w / 2, 20, { align: 'center' });
  pdf.setFontSize(10); pdf.setTextColor(100);
  pdf.text(`${monthStr} · ${now.toLocaleString('pt-BR')}`, w / 2, 28, { align: 'center' });
  pdf.setDrawColor(200, 151, 58); pdf.line(20, 34, w - 20, 34);

  // Resumo do mês atual (só lançados neste mês, sem excluidos)
  const launchedThisMonth = contracts.filter(c => {
    if (!c._launched) return false;
    const d = launchDate(c);
    return d && d.slice(0, 7) === currentYM;
  });
  const totalMonth = launchedThisMonth.reduce((s, c) => s + (Number(c.dados?.honorarios?.total) || 0), 0);
  const totalAll = contracts.filter(c => c._launched).reduce((s, c) => s + (Number(c.dados?.honorarios?.total) || 0), 0);

  pdf.setFillColor(240, 244, 248);
  pdf.rect(20, 38, w - 40, 16, 'F');
  pdf.setFontSize(9); pdf.setTextColor(26, 46, 82);
  pdf.text(`Lançado em ${monthStr}:`, 24, 44);
  pdf.setFontSize(11); pdf.setFont(undefined, 'bold');
  pdf.text(fmt(totalMonth), 24, 50);
  pdf.setFont(undefined, 'normal'); pdf.setFontSize(8); pdf.setTextColor(100);
  pdf.text(`${launchedThisMonth.length} contrato(s) lançado(s) neste mês`, 24, 53);

  pdf.setFontSize(9); pdf.setTextColor(26, 46, 82);
  pdf.text(`Total no relatório:`, w - 24, 44, { align: 'right' });
  pdf.setFontSize(11); pdf.setFont(undefined, 'bold');
  pdf.text(fmt(totalAll), w - 24, 50, { align: 'right' });
  pdf.setFont(undefined, 'normal'); pdf.setFontSize(8); pdf.setTextColor(100);
  pdf.text(`${contracts.filter(c => c._launched).length} lançado(s) · ${contracts.length} total`, w - 24, 53, { align: 'right' });

  // Header da tabela
  let y = 64;
  pdf.setFontSize(7); pdf.setTextColor(100);
  const cols = [
    { h: 'DATA LANÇ.', x: 22 },
    { h: 'CLIENTE', x: 45 },
    { h: 'RESORT', x: 92 },
    { h: 'VALOR', x: 128 },
    { h: 'PARC', x: 150 },
    { h: 'STATUS', x: 160 },
    { h: 'CONFERIDO', x: 178 },
  ];
  cols.forEach(c => pdf.text(c.h, c.x, y));
  y += 4; pdf.setDrawColor(230); pdf.line(20, y, w - 20, y); y += 4;

  pdf.setTextColor(50);
  for (const c of contracts) {
    if (y > 275) { pdf.addPage(); y = 20; }
    const h = c.dados?.honorarios || {};
    const val = h.somenteExito ? 0 : (Number(h.total) || 0);
    const ld = launchDate(c);
    const ldStr = ld ? new Date(ld).toLocaleDateString('pt-BR') : '—';
    const isThisMonth = ld && ld.slice(0, 7) === currentYM;
    pdf.setFontSize(7);
    // Destaca data se for do mês atual
    if (isThisMonth) { pdf.setTextColor(200, 151, 58); pdf.setFont(undefined, 'bold'); }
    pdf.text(ldStr, 22, y);
    pdf.setTextColor(50); pdf.setFont(undefined, 'normal');
    pdf.text((c.nome_contratante1 || '').substring(0, 26), 45, y);
    pdf.text((c.resort || '').substring(0, 20), 92, y);
    pdf.text(fmt(val), 128, y);
    pdf.text(`${h.parcelas || 1}x`, 152, y);
    const st = c._launched ? 'Lançado' : 'Pendente';
    pdf.setTextColor(st === 'Lançado' ? 22 : 150, st === 'Lançado' ? 163 : 150, st === 'Lançado' ? 74 : 150);
    pdf.text(st, 160, y);
    pdf.setTextColor(50);
    pdf.text(c.asaas_verified_by ? c.asaas_verified_by.split('@')[0].substring(0, 10) : '—', 178, y);
    y += 4.5;
  }

  y += 4; pdf.setDrawColor(200, 151, 58); pdf.line(20, y, w - 20, y); y += 7;
  pdf.setFontSize(10); pdf.setTextColor(26, 46, 82);
  pdf.text(`TOTAL GERAL: ${fmt(totalAll)}`, 22, y);
  pdf.text(`${contracts.length} contrato(s)`, w - 22, y, { align: 'right' });

  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `Honorarios_${currentYM}.pdf`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Main Panel ───
export default function AsaasPanel() {
  const { user } = useAuth();
  const userEmail = user?.email || '';
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // (#51) Filtros persistidos em localStorage
  const [search, setSearch] = usePersistedFilter('asaas', 'search', '');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = usePersistedFilter('asaas', 'filter', 'all');
  const [filterResort, setFilterResort] = usePersistedFilter('asaas', 'filterResort', '');
  const [filterCreator, setFilterCreator] = usePersistedFilter('asaas', 'filterCreator', '');
  const [showFilters, setShowFilters] = useState(false);
  const [launchedMap, setLaunchedMap] = useState({});
  const [compact, setCompact] = useState(() => localStorage.getItem('asaas_compact') === '1');
  const [drawerContract, setDrawerContract] = useState(null);
  const [nfModalContract, setNFModalContract] = useState(null);
  const [nfMap, setNfMap] = useState({}); // installmentId → last invoice
  const [nfSyncing, setNfSyncing] = useState(false);
  // (hero-financeiro 20/06/2026) Espelho de boletos por customer_id -> agregados
  // financeiros reais (Recebido/Em aberto/Vencido) + pior status por customer.
  const [boletoAgg, setBoletoAgg] = useState({
    recebidoMes: 0, emAberto: 0, vencido: 0,
    nRecebidoMes: 0, nEmAberto: 0, nVencido: 0,
    statusByCustomer: {}, // customer_id -> 'OVERDUE' | 'PENDING' | 'RECEIVED'
  });
  const [boletoSync, setBoletoSync] = useState(null); // ISO do ultimo sync (asaas_sync_state)
  const [highlightedIds, setHighlightedIds] = useState(new Set());
  const listRef = useRef(null);
  const containerRef = useRef(null);
  const [listHeight, setListHeight] = useState(600);

  // Filtros de data
  const [dateMode, setDateMode] = usePersistedFilter('asaas', 'dateMode', 'vencimento'); // vencimento | pagamento | ambos
  const [dateFrom, setDateFrom] = usePersistedFilter('asaas', 'dateFrom', '');
  const [dateTo, setDateTo] = usePersistedFilter('asaas', 'dateTo', '');
  const [filterMonth, setFilterMonth] = usePersistedFilter('asaas', 'filterMonth', '');

  // Sort (per-user)
  const [sort, setSort] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`asaas_sort_${userEmail}`) || 'null') || { col: null, dir: 'asc' }; }
    catch { return { col: null, dir: 'asc' }; }
  });
  useEffect(() => {
    if (userEmail) localStorage.setItem(`asaas_sort_${userEmail}`, JSON.stringify(sort));
  }, [sort, userEmail]);
  const toggleSort = (col) => setSort(s => s.col === col ? (s.dir === 'asc' ? { col, dir: 'desc' } : { col: null, dir: 'asc' }) : { col, dir: 'asc' });
  const sortArrow = (col) => sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';

  // Debounce search (item 62)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Persist compact mode
  useEffect(() => { localStorage.setItem('asaas_compact', compact ? '1' : '0'); }, [compact]);

  // Cache + fetch (item 59)
  const fetch_ = useCallback(async (useCache = false) => {
    if (useCache) {
      try {
        const cached = sessionStorage.getItem('asaas_contracts_cache');
        if (cached) {
          const { data, ts } = JSON.parse(cached);
          if (Date.now() - ts < 60000) { // 60s cache
            setContracts(data.map(c => ({ ...c, _launched: c.asaas_status === 'launched' })));
            setLoading(false);
          }
        }
      } catch { /* ignora cache invalido */ }
    }
    try {
      const { data, error: dbError } = await supabase.from('contratos')
        .select('id, nome_contratante1, nome_contratante2, cpf_contratante1, resort, honorarios_total, honorarios_parcelas, status, created_at, created_by, dados, asaas_status, asaas_customer_id, asaas_payments, asaas_verified_by, asaas_verified_at, asaas_excluded_at, asaas_excluded_by, asaas_excluded_reason')
        .eq('status', 'assinado').order('created_at', { ascending: false });
      if (dbError) throw dbError;
      const list = (data || []).filter(c => {
        const h = c.dados?.honorarios;
        return h && !h.somenteExito && (Number(h.total) || 0) > 0;
      }).map(c => ({ ...c, _launched: c.asaas_status === 'launched' || launchedMap[c.id], _excluded: !!c.asaas_excluded_at }));
      setContracts(list);
      setLoadError('');
      try { sessionStorage.setItem('asaas_contracts_cache', JSON.stringify({ data: list, ts: Date.now() })); } catch { /* best-effort: cache de sessao opcional */ }
    } catch {
      // (#100) Mensagem generica
      setLoadError('Erro ao carregar contratos Asaas');
    }
    finally { setLoading(false); }
  }, [launchedMap]);

  useEffect(() => { fetch_(true); }, []); // eslint-disable-line

  // Revalidate on focus
  useEffect(() => {
    const onFocus = () => fetch_(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetch_]);

  // Realtime subscription (item 40)
  // (resilience 28/04) Channel ja com nome fixo + event=UPDATE. So reage a mudanca
  // de status Asaas em contratos existentes — INSERT/DELETE nao sao relevantes aqui.
  useEffect(() => {
    const channel = supabase.channel('asaas-contracts')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contratos' }, payload => {
        const id = payload.new?.id;
        if (!id) return;
        setContracts(prev => prev.map(c => c.id === id ? { ...c, ...payload.new, _launched: payload.new.asaas_status === 'launched' || c._launched } : c));
        setHighlightedIds(prev => new Set(prev).add(id));
        setTimeout(() => {
          setHighlightedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        }, 2000);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Fetch NF map (one API call, global recent invoices)
  const syncNFs = useCallback(async () => {
    setNfSyncing(true);
    try {
      const res = await callAsaas('list-invoices', {});
      const map = {};
      (res.data || []).forEach(inv => {
        const key = inv.installment || inv.payment;
        if (!key) return;
        // Keep most recent per key
        if (!map[key] || (inv.effectiveDate || '') > (map[key].effectiveDate || '')) map[key] = inv;
      });
      setNfMap(map);
    } catch (e) { console.error('NF sync:', e); }
    finally { setNfSyncing(false); }
  }, []);

  // Auto-sync NFs after contracts load
  useEffect(() => { if (contracts.length > 0) syncNFs(); }, [contracts.length, syncNFs]);

  // (hero-financeiro 20/06/2026) Carrega o espelho de boletos (asaas_boletos) escopado
  // aos customers dos contratos lancados e agrega por bucket de pagamento.
  // - JOIN: boleto.customer_id <-> contrato.asaas_customer_id (sempre presente p/
  //   lancados — 117/117 verificados). external_reference e null com frequencia, por
  //   isso NAO e usado como chave.
  // - Recebido (mes): soma value dos boletos PAID com payment_date no mes corrente.
  // - Em aberto: soma value dos OPEN (nao-pago/nao-removido/nao-neutro) com due_date >= hoje.
  // - Vencido: soma value dos OPEN com due_date < hoje.
  // - statusByCustomer: pior status entre os boletos do customer (vencido > pendente > pago).
  // Tabela so e legivel pelo role `authenticated` (RLS) — ok, painel roda logado.
  const loadBoletoAgg = useCallback(async () => {
    const custIds = [...new Set(
      contracts.filter(c => c.asaas_customer_id).map(c => c.asaas_customer_id)
    )];
    if (custIds.length === 0) {
      setBoletoAgg({ recebidoMes: 0, emAberto: 0, vencido: 0, nRecebidoMes: 0, nEmAberto: 0, nVencido: 0, statusByCustomer: {} });
      return;
    }
    try {
      // Busca em lotes de customer_id (evita URL gigante no .in()).
      const todayStr = new Date().toISOString().slice(0, 10);
      const ymStr = todayStr.slice(0, 7);
      let rows = [];
      const CHUNK = 80;
      for (let i = 0; i < custIds.length; i += CHUNK) {
        const slice = custIds.slice(i, i + CHUNK);
        const { data, error } = await supabase.from('asaas_boletos')
          .select('customer_id,status,value,due_date,payment_date')
          .in('customer_id', slice);
        if (error) throw error;
        rows = rows.concat(data || []);
      }
      let recebidoMes = 0, emAberto = 0, vencido = 0;
      let nRecebidoMes = 0, nEmAberto = 0, nVencido = 0;
      // ranking p/ pior status: vencido(3) > pendente(2) > pago(1) > nada(0)
      const rank = { OVERDUE: 3, PENDING: 2, RECEIVED: 1 };
      const worstByCustomer = {}; // customer_id -> codigo do pior status
      for (const b of rows) {
        const val = Number(b.value) || 0;
        const st = b.status;
        if (isRemovedStatus(st) || isNeutralStatus(st)) continue; // removidos/neutros nao contam
        let bucketStatus = null;
        if (isPaidStatus(st)) {
          bucketStatus = 'RECEIVED';
          if ((b.payment_date || '').slice(0, 7) === ymStr) { recebidoMes += val; nRecebidoMes++; }
        } else {
          // OPEN: vencido se due_date < hoje, senao pendente
          const venc = (b.due_date || '') && (b.due_date < todayStr);
          if (venc) { bucketStatus = 'OVERDUE'; vencido += val; nVencido++; }
          else { bucketStatus = 'PENDING'; emAberto += val; nEmAberto++; }
        }
        if (bucketStatus && b.customer_id) {
          const prev = worstByCustomer[b.customer_id];
          if (!prev || rank[bucketStatus] > rank[prev]) worstByCustomer[b.customer_id] = bucketStatus;
        }
      }
      setBoletoAgg({ recebidoMes, emAberto, vencido, nRecebidoMes, nEmAberto, nVencido, statusByCustomer: worstByCustomer });
      const { data: state } = await supabase.from('asaas_sync_state')
        .select('value').eq('key', 'boletos_last_sync').maybeSingle();
      setBoletoSync(state?.value || new Date().toISOString());
    } catch (e) {
      // best-effort: o hero financeiro e complementar — falha nao derruba a aba.
      console.error('boleto agg:', e);
    }
  }, [contracts]);

  // Recarrega o agregado quando a lista de customers lancados muda.
  const launchedCustomerKey = useMemo(
    () => contracts.filter(c => c.asaas_customer_id).map(c => c.asaas_customer_id).sort().join(','),
    [contracts]
  );
  useEffect(() => { loadBoletoAgg(); }, [launchedCustomerKey]); // eslint-disable-line

  // Resize observer for virtual list
  useEffect(() => {
    if (!containerRef.current) return;
    const update = () => {
      const h = containerRef.current?.getBoundingClientRect().height || 600;
      setListHeight(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const handleDone = (id) => {
    setLaunchedMap(p => ({ ...p, [id]: true }));
    setContracts(p => p.map(c => c.id === id ? { ...c, _launched: true } : c));
  };

  // (inline-edit 01/06/2026) Callback do DueDateEditor — atualiza state local
  // apos save bem-sucedido para refletir nova data imediatamente sem refetch.
  const handleUpdateDueDate = useCallback((id, newDate, newDados) => {
    setContracts(p => p.map(c => c.id === id ? { ...c, dados: newDados } : c));
  }, []);

  // (exclusao 01/06/2026) Modal de confirmacao + handlers de exclude/restore.
  // Exclusao = soft delete da listagem Asaas (3 campos: at, by, reason).
  // Contrato em si NAO e apagado — so flagged.
  const [excludeModal, setExcludeModal] = useState(null); // { contract, reason }
  const [excludeReason, setExcludeReason] = useState('');
  const handleExcludeRequest = (contract) => {
    setExcludeReason('');
    setExcludeModal(contract);
  };
  const handleExcludeConfirm = async () => {
    if (!excludeModal) return;
    const id = excludeModal.id;
    try {
      const now = new Date().toISOString();
      await supabase.from('contratos').update({
        asaas_excluded_at: now,
        asaas_excluded_by: userEmail,
        asaas_excluded_reason: excludeReason.trim() || null,
      }).eq('id', id);
      setContracts(p => p.map(c => c.id === id ? {
        ...c,
        _excluded: true,
        asaas_excluded_at: now,
        asaas_excluded_by: userEmail,
        asaas_excluded_reason: excludeReason.trim() || null,
      } : c));
      setExcludeModal(null);
      setExcludeReason('');
    } catch (e) {
      alert('Erro ao excluir: ' + (e.message || 'desconhecido'));
    }
  };
  const handleRestore = async (contract) => {
    if (!window.confirm(`Restaurar "${contract.nome_contratante1}" para a lista de cobranças?`)) return;
    try {
      await supabase.from('contratos').update({
        asaas_excluded_at: null,
        asaas_excluded_by: null,
        asaas_excluded_reason: null,
      }).eq('id', contract.id);
      setContracts(p => p.map(c => c.id === contract.id ? {
        ...c,
        _excluded: false,
        asaas_excluded_at: null,
        asaas_excluded_by: null,
        asaas_excluded_reason: null,
      } : c));
    } catch (e) {
      alert('Erro ao restaurar: ' + (e.message || 'desconhecido'));
    }
  };

  const resorts = useMemo(() => [...new Set(contracts.map(c => c.resort).filter(Boolean))].sort(), [contracts]);
  const creators = useMemo(() => [...new Set(contracts.map(c => c.created_by).filter(Boolean))].sort(), [contracts]);
  const months = useMemo(() => {
    const m = new Set();
    contracts.forEach(c => { if (c.created_at) m.add(c.created_at.slice(0, 7)); });
    return [...m].sort().reverse();
  }, [contracts]);

  const filtered = useMemo(() => {
    let list = [...contracts];
    // (exclusao 01/06/2026) Filtro padrao oculta excluidos da lista principal.
    // Aba "Excluidos" inverte para mostrar SO excluidos.
    if (filter === 'excluded') {
      list = list.filter(c => c._excluded);
    } else {
      list = list.filter(c => !c._excluded);
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(c => (c.nome_contratante1 || '').toLowerCase().includes(q) || (c.cpf_contratante1 || '').includes(q) || (c.resort || '').toLowerCase().includes(q));
    }
    if (filter === 'pending') list = list.filter(c => !c._launched);
    if (filter === 'launched') list = list.filter(c => c._launched);
    if (filter === 'unverified') list = list.filter(c => c._launched && !c.asaas_verified_by);
    if (filterResort) list = list.filter(c => c.resort === filterResort);
    if (filterMonth) list = list.filter(c => c.created_at?.startsWith(filterMonth));
    if (filterCreator) list = list.filter(c => c.created_by === filterCreator);

    // Filtro de data com seletor (vencimento | pagamento | ambos)
    if (dateFrom || dateTo) {
      const from = dateFrom || '0000-00-00';
      const to = dateTo || '9999-99-99';
      list = list.filter(c => {
        const vencDate = c.dados?.honorarios?.dataPrimeiraParcela || '';
        const nf = nfMap[c.asaas_payments?.installment];
        const pagDate = nf?.effectiveDate || '';
        const vencMatch = vencDate >= from && vencDate <= to;
        const pagMatch = pagDate && pagDate >= from && pagDate <= to;
        if (dateMode === 'vencimento') return vencMatch;
        if (dateMode === 'pagamento') return pagMatch;
        return vencMatch || pagMatch; // ambos
      });
    }
    if (sort.col) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      const getVal = (c) => {
        switch (sort.col) {
          case 'cliente': return (c.nome_contratante1 || '').toLowerCase();
          case 'resort': return (c.resort || '').toLowerCase();
          case 'valor': return Number(c.dados?.honorarios?.total) || 0;
          case 'parc': return Number(c.dados?.honorarios?.parcelas) || 0;
          case 'venc': return c.dados?.honorarios?.dataPrimeiraParcela || '';
          case 'asaas': return c._launched ? 1 : 0;
          case 'pagamento': {
            // ordena por severidade: vencido(3) > pendente(2) > pago(1) > sem boleto(0)
            const st = c.asaas_customer_id ? boletoAgg.statusByCustomer?.[c.asaas_customer_id] : null;
            return st === 'OVERDUE' ? 3 : st === 'PENDING' ? 2 : st === 'RECEIVED' ? 1 : 0;
          }
          case 'nf': {
            const nf = nfMap[c.asaas_payments?.installment];
            return nf?.effectiveDate || '';
          }
          case 'conferido': return c.asaas_verified_by ? 1 : 0;
          default: return 0;
        }
      };
      list.sort((a, b) => {
        const va = getVal(a), vb = getVal(b);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }
    return list;
  }, [contracts, debouncedSearch, filter, filterResort, filterMonth, filterCreator, dateFrom, dateTo, dateMode, nfMap, sort, boletoAgg]);

  const stats = useMemo(() => {
    // (counter-fix 01/06/2026) Exclui da contagem contratos excluidos da lista.
    // - Total, Lançados, Conferidos: contam apenas NAO-excluidos
    // - Pendentes: contam NAO-excluidos E NAO-lançados (pendentes reais de cobrança)
    // - Excluídos tem seu proprio contador no filtro pill
    const active = contracts.filter(c => !c._excluded);
    const launched = active.filter(c => c._launched).length;
    const pending = active.filter(c => !c._launched).length;
    const verified = active.filter(c => c.asaas_verified_by).length;
    const excluded = contracts.filter(c => c._excluded).length;
    const totalVal = active.filter(c => c._launched).reduce((s, c) => s + (Number(c.dados?.honorarios?.total) || 0), 0);
    return { total: active.length, launched, pending, verified, excluded, totalVal };
  }, [contracts]);

  // (lançado-mes 20/06/2026) Honorarios LANCADOS no mes corrente + comparativo com o
  // mes passado. Usa launchDate(c) (asaas_payments.dateCreated -> created_at) e soma
  // dados.honorarios.total dos contratos lancados nao-excluidos. Mesma base do resumo
  // do PDF (genReport) — agora e o indicador UNICO do topo da aba.
  const lancadoMes = useMemo(() => {
    const now = new Date();
    const ymAtual = now.toISOString().slice(0, 7);
    const ymAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
    let mesVal = 0, mesN = 0, antVal = 0, antN = 0;
    for (const c of contracts) {
      if (!c._launched || c._excluded) continue;
      const d = launchDate(c);
      if (!d) continue;
      const m = d.slice(0, 7);
      const v = Number(c.dados?.honorarios?.total) || 0;
      if (m === ymAtual) { mesVal += v; mesN++; }
      else if (m === ymAnterior) { antVal += v; antN++; }
    }
    const delta = antVal > 0 ? Math.round(((mesVal - antVal) / antVal) * 100) : null;
    return { mesVal, mesN, antVal, antN, delta };
  }, [contracts]);

  // (hero-financeiro 20/06/2026) Map contrato.id -> pior status de pagamento,
  // derivado do agregado de boletos por customer (asaas_customer_id). null = sem boleto.
  const payStatusByContract = useMemo(() => {
    const m = {};
    const byCust = boletoAgg.statusByCustomer || {};
    for (const c of contracts) {
      const st = c.asaas_customer_id ? byCust[c.asaas_customer_id] : null;
      if (st) m[c.id] = st;
    }
    return m;
  }, [contracts, boletoAgg]);

  const rowHeight = compact ? 36 : 52;
  const itemData = useMemo(() => ({
    items: filtered, compact, nfMap, payStatusByContract, highlightedIds, userEmail,
    onDone: handleDone, onRowClick: setDrawerContract, onNFClick: setNFModalContract,
    onExclude: handleExcludeRequest, onRestore: handleRestore,
    onUpdateDueDate: handleUpdateDueDate,
  }), [filtered, compact, nfMap, payStatusByContract, highlightedIds, userEmail, handleUpdateDueDate]);

  // (#96) Skeleton na primeira carga
  if (loading && contracts.length === 0 && !loadError) {
    return <SkeletonAsaas />;
  }

  // (#100) ErrorState quando fetch inicial falhou e nao ha cache
  if (loadError && contracts.length === 0) {
    return (
      <div className='h-full flex items-center justify-center bg-white'>
        <ErrorState
          icon={<ExclamationTriangleIcon className="w-8 h-8 text-amber-500" aria-hidden="true" />}
          title='Nao foi possivel carregar contratos Asaas'
          message='Verifique sua conexao ou tente novamente.'
          suggestion='Se o problema persistir, recarregue a pagina.'
          onRetry={() => { setLoadError(''); fetch_(false); }}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white max-sm:overflow-x-auto">
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-y-1.5">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}><CreditCardIcon className="w-5 h-5" aria-hidden="true" /> Cobranças Asaas</h2>
            <p className="text-[11px] text-gray-400">Honorários iniciais · Boleto + PIX · NF após pagamento</p>
          </div>
          <div className="flex gap-2 flex-wrap gap-y-1.5">
            <button onClick={() => setCompact(c => !c)} title="Alternar modo compacto"
              className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer border flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy)]/40 focus:outline-none"
              style={compact
                ? { background: 'var(--cbc-info-bg)', borderColor: 'var(--cbc-info-border)', color: 'var(--cbc-info)' }
                : { borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}>
              <Bars3Icon className="w-3 h-3" aria-hidden="true" /> {compact ? 'Compacto' : 'Normal'}
            </button>
            <div className="flex items-center gap-1.5">
              <button onClick={syncNFs} disabled={nfSyncing} title="Sincronizar notas fiscais"
                className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1">
                {nfSyncing ? <ClockIcon className="w-3 h-3 animate-pulse" aria-hidden="true" /> : <DocumentIcon className="w-3 h-3" aria-hidden="true" />} Sync NF
              </button>
              {/* Frescor do espelho de boletos (asaas_sync_state) — hero-financeiro 20/06/2026 */}
              {boletoSync && <FreshnessChip iso={boletoSync} prefix="Atualizado" />}
            </div>
            <button onClick={() => fetch_(false)} aria-label="Recarregar" title="Recarregar" className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer border border-gray-200 text-gray-500 hover:bg-gray-50"><ArrowPathIcon className="w-3 h-3" aria-hidden="true" /></button>
            <button onClick={() => genReport(filtered)} className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer hover:opacity-90 text-white flex items-center gap-1" style={{ background: '#C8973A' }}><DocumentIcon className="w-3 h-3" aria-hidden="true" /> PDF</button>
          </div>
        </div>

        {/* (lançado-mes 20/06/2026) Indicador UNICO: honorarios lançados no mes +
            comparativo com o mes passado. Recebido/Em aberto/Vencido sairam daqui —
            status de pagamento dos boletos vive na aba Boletos. */}
        <div className="mb-4">
          <div className="rounded-xl p-3.5 flex items-center gap-3 flex-wrap"
            style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', borderTop: '3px solid var(--cbc-accent)' }}>
            <div className="flex-1 min-w-[200px]">
              <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>
                Honorários lançados no mês
              </div>
              <div className="flex items-baseline gap-2.5 flex-wrap mt-0.5">
                <span style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 700, color: 'var(--cbc-text-primary)', lineHeight: 1 }}>
                  <MoneyValue value={lancadoMes.mesVal} />
                </span>
                {lancadoMes.delta !== null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={lancadoMes.delta >= 0
                      ? { background: 'var(--cbc-success-bg)', color: 'var(--cbc-success)' }
                      : { background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
                    {lancadoMes.delta >= 0 ? '▲' : '▼'} {Math.abs(lancadoMes.delta)}% vs mês passado
                  </span>
                )}
              </div>
              <div className="text-[11px] mt-1.5" style={{ color: 'var(--cbc-text-muted)' }}>
                {lancadoMes.mesN} contrato(s) lançado(s) neste mês · mês passado <span style={{ color: 'var(--cbc-text-secondary)' }}>{fmt(lancadoMes.antVal)}</span> ({lancadoMes.antN})
              </div>
            </div>
          </div>
        </div>

        {/* Faixa secundaria — contagens operacionais (antiga faixa de KPIs) */}
        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mb-4 text-[11px]" style={{ color: 'var(--cbc-text-secondary)' }}>
          <span><strong style={{ color: 'var(--cbc-text-primary)' }}>{stats.total}</strong> contratos</span>
          <span><strong style={{ color: 'var(--cbc-success)' }}>{stats.launched}</strong> lançados</span>
          <span><strong style={{ color: 'var(--cbc-warning)' }}>{stats.pending}</strong> pendentes</span>
          <span><strong style={{ color: 'var(--cbc-text-primary)' }}>{stats.verified}</strong> conferidos</span>
        </div>

        {/* Search + Status filters */}
        <div className="flex gap-2 items-center flex-wrap gap-y-1.5">
          <input type="text" placeholder="Buscar nome, CPF, resort..." value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
          {['all', 'pending', 'launched', 'unverified', 'excluded'].map(f => {
            const labels = { all: 'Todos', pending: 'Pendentes', launched: 'Lançados', unverified: 'S/ conferir', excluded: 'Excluídos' };
            const excludedCount = contracts.filter(c => c._excluded).length;
            const active = filter === f;
            const pillStyle = active
              ? { background: f === 'excluded' ? 'var(--cbc-danger)' : 'var(--cbc-navy)', color: '#fff' }
              : f === 'excluded'
                ? { background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }
                : { background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-secondary)' };
            return (
              <button key={f} onClick={() => setFilter(f)}
                className="px-2.5 py-1.5 text-[10px] font-bold uppercase rounded-full cursor-pointer transition-all whitespace-nowrap focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy)]/40 focus:outline-none"
                style={pillStyle}>
                {labels[f]}{f === 'excluded' && excludedCount > 0 ? ` (${excludedCount})` : ''}
              </button>
            );
          })}
          <button onClick={() => setShowFilters(!showFilters)}
            className={`px-2.5 py-1.5 text-[9px] font-bold uppercase rounded-full cursor-pointer flex items-center gap-1 ${showFilters ? 'text-white' : 'text-gray-400 bg-gray-100'}`}
            style={showFilters ? { background: '#C8973A' } : {}}><Cog6ToothIcon className="w-3 h-3" aria-hidden="true" /> Filtros</button>
        </div>

        {showFilters && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[8px] font-bold uppercase text-gray-400 mb-1 block">Resort</label>
                <select value={filterResort} onChange={e => setFilterResort(e.target.value)} className="w-full border rounded px-2 py-1 text-[10px] bg-white">
                  <option value="">Todos</option>
                  {resorts.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[8px] font-bold uppercase text-gray-400 mb-1 block">Mês de criação</label>
                <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="w-full border rounded px-2 py-1 text-[10px] bg-white">
                  <option value="">Todos</option>
                  {months.map(m => <option key={m} value={m}>{new Date(m + '-15').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[8px] font-bold uppercase text-gray-400 mb-1 block">Criado por</label>
                <select value={filterCreator} onChange={e => setFilterCreator(e.target.value)} className="w-full border rounded px-2 py-1 text-[10px] bg-white">
                  <option value="">Todos</option>
                  {creators.map(c => <option key={c} value={c}>{c.split('@')[0]}</option>)}
                </select>
              </div>
            </div>

            {/* Filtros de data */}
            <div className="border-t pt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[8px] font-bold uppercase text-gray-400 flex items-center gap-1"><CalendarDaysIcon className="w-2.5 h-2.5" aria-hidden="true" /> Filtrar por data:</span>
                {[
                  { v: 'vencimento', l: 'Vencimento' },
                  { v: 'pagamento', l: 'Pagamento' },
                  { v: 'ambos', l: 'Ambos' },
                ].map(m => (
                  <button key={m.v} onClick={() => setDateMode(m.v)}
                    className={`px-2 py-1 text-[9px] font-bold rounded-full ${dateMode === m.v ? 'text-white' : 'text-gray-500 bg-white border'}`}
                    style={dateMode === m.v ? { background: '#1A2E52' } : {}}>
                    {m.l}
                  </button>
                ))}
                {(dateFrom || dateTo) && (
                  <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[9px] text-red-500 font-bold ml-auto">Limpar</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[8px] font-bold uppercase text-gray-400 mb-1 block">De</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full border rounded px-2 py-1 text-[10px] bg-white" />
                </div>
                <div>
                  <label className="text-[8px] font-bold uppercase text-gray-400 mb-1 block">Até</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full border rounded px-2 py-1 text-[10px] bg-white" />
                </div>
              </div>
              {dateMode === 'pagamento' && (
                <p className="text-[9px] text-gray-400 mt-1 italic flex items-center gap-1"><LightBulbIcon className="w-2.5 h-2.5" aria-hidden="true" /> Pagamento usa a data de emissão da NF (requer Sync NF)</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sticky Header (item 39) */}
      <div className="flex items-center border-b bg-gray-50 text-[9px] font-bold uppercase text-gray-400 sticky top-0 z-10 py-2 select-none max-sm:min-w-[930px]">
        <div className="px-3 flex-1 cursor-pointer hover:text-gray-700" onClick={() => toggleSort('cliente')}>Cliente{sortArrow('cliente')}</div>
        <div className="px-2 w-[140px] cursor-pointer hover:text-gray-700" onClick={() => toggleSort('resort')}>Resort{sortArrow('resort')}</div>
        <div className="px-2 w-[90px] text-right cursor-pointer hover:text-gray-700" onClick={() => toggleSort('valor')}>Valor{sortArrow('valor')}</div>
        <div className="px-2 w-[45px] text-center cursor-pointer hover:text-gray-700" onClick={() => toggleSort('parc')}>Parc{sortArrow('parc')}</div>
        <div className="px-2 w-[80px] text-center cursor-pointer hover:text-gray-700" onClick={() => toggleSort('venc')}>1° Venc{sortArrow('venc')}</div>
        <div className="px-2 w-[110px] text-center cursor-pointer hover:text-gray-700" onClick={() => toggleSort('pagamento')}>Pagamento{sortArrow('pagamento')}</div>
        <div className="px-2 w-[140px] text-center cursor-pointer hover:text-gray-700" onClick={() => toggleSort('asaas')}>Asaas{sortArrow('asaas')}</div>
        <div className="px-2 w-[110px] text-center cursor-pointer hover:text-gray-700" onClick={() => toggleSort('nf')}>NF{sortArrow('nf')}</div>
        <div className="px-2 w-[130px] text-center cursor-pointer hover:text-gray-700" onClick={() => toggleSort('conferido')}>Conferido{sortArrow('conferido')}</div>
        <div className="px-2 w-[40px] text-center" title="Excluir/Restaurar">×</div>
      </div>

      {/* (exclusao 01/06/2026) Banner na sub-view Excluidos: info de audit por contrato */}
      {filter === 'excluded' && filtered.length > 0 && (
        <div className="bg-red-50 border-y border-red-200 px-3 py-2 text-[11px] text-red-700">
          <strong>Contratos excluídos da lista de cobranças.</strong>
          {' '}Clique no ícone <ArrowPathIcon className="w-3 h-3 inline" aria-hidden="true" /> para restaurar.
          O contrato em si não foi deletado — apenas removido desta listagem.
        </div>
      )}

      {/* (exclusao 01/06/2026) Tabela detalhada de audit na sub-view Excluidos */}
      {filter === 'excluded' && filtered.length > 0 ? (
        <div ref={containerRef} className="flex-1 bg-gray-50 overflow-auto">
          <table className="w-full text-[11px] max-sm:min-w-[820px]">
            <thead className="sticky top-0 bg-white border-b border-gray-200">
              <tr className="text-left text-gray-500 font-bold uppercase text-[9px]">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-2">CPF</th>
                <th className="px-2">Resort</th>
                <th className="px-2 text-right">Valor</th>
                <th className="px-2">Excluído em</th>
                <th className="px-2">Por</th>
                <th className="px-2">Motivo</th>
                <th className="px-2 text-center">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const d = c.dados || {};
                const h = d.honorarios || {};
                return (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-white">
                    <td className="px-3 py-2 font-semibold" style={{ color: 'var(--cbc-text-primary)' }}>{c.nome_contratante1 || '—'}</td>
                    <td className="px-2 text-gray-500">{c.cpf_contratante1}</td>
                    <td className="px-2 text-gray-500 truncate max-w-[140px]">{c.resort || '—'}</td>
                    <td className="px-2 text-right font-semibold">{fmt(h.total)}</td>
                    <td className="px-2 text-gray-500">{fmtDT(c.asaas_excluded_at)}</td>
                    <td className="px-2 text-gray-500">{c.asaas_excluded_by?.split('@')[0] || '—'}</td>
                    <td className="px-2 text-gray-600 italic truncate max-w-[200px]" title={c.asaas_excluded_reason || ''}>
                      {c.asaas_excluded_reason || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 text-center">
                      <button onClick={() => handleRestore(c)}
                        className="text-green-600 hover:text-green-700 cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-green-50"
                        title="Restaurar para a lista">
                        <ArrowPathIcon className="w-3 h-3" aria-hidden="true" />
                        <span className="text-[10px] font-bold">Restaurar</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
      /* Virtual list */
      <div ref={containerRef} className="flex-1 bg-gray-50 overflow-hidden max-sm:min-w-[820px]">
        {loading ? (
          <SkeletonRows count={12} />
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">Nenhum contrato encontrado</div>
        ) : (
          <FixedSizeList
            ref={listRef}
            height={listHeight}
            itemCount={filtered.length}
            itemSize={rowHeight}
            itemData={itemData}
            width="100%"
          >
            {Row}
          </FixedSizeList>
        )}
      </div>
      )}

      {/* Footer */}
      <div className="p-2 border-t border-gray-100 bg-white text-center">
        <span className="text-[9px] text-gray-400 uppercase">
          {filtered.length} contrato(s) · {stats.launched} lançado(s) · {stats.verified} conferido(s) · {Object.keys(nfMap).length} NFs sincronizadas
        </span>
      </div>

      {/* Drawer */}
      {drawerContract && <ContractDrawer contract={drawerContract} onClose={() => setDrawerContract(null)} userEmail={userEmail} />}
      {/* NF Modal */}
      {nfModalContract && <NFDetailsModal contract={nfModalContract} onClose={() => setNFModalContract(null)} />}
      {/* (exclusao 01/06/2026) Modal de confirmacao de exclusao */}
      {excludeModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setExcludeModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: '#FEE2E2' }}>
                <TrashIcon className="w-5 h-5" style={{ color: '#DC2626' }} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-base text-gray-900">Excluir da lista de cobranças?</h3>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  <strong>{excludeModal.nome_contratante1}</strong> · {excludeModal.cpf_contratante1}
                </p>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-[11px] text-amber-800 leading-relaxed">
                O contrato <strong>não será deletado</strong> — apenas removido desta listagem de cobranças.
                Pode ser restaurado na aba "Excluídos". Audit: data, usuário e motivo serão registrados.
              </p>
            </div>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Motivo (opcional)</span>
              <textarea
                value={excludeReason}
                onChange={e => setExcludeReason(e.target.value)}
                placeholder="Ex: cliente desistiu, cobrança paga fora do sistema, duplicidade..."
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-[12px] focus:border-red-400 focus:outline-none resize-none"
                rows={3}
                maxLength={500}
              />
              <span className="text-[9px] text-gray-400">{excludeReason.length}/500</span>
            </label>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setExcludeModal(null)}
                className="flex-1 px-4 py-2 text-[12px] font-bold uppercase rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer">
                Cancelar
              </button>
              <button onClick={handleExcludeConfirm}
                className="flex-1 px-4 py-2 text-[12px] font-bold uppercase rounded-lg text-white cursor-pointer"
                style={{ background: '#DC2626' }}>
                Excluir da lista
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
