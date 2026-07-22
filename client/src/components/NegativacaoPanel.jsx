import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { computeNegativacaoCandidates, resumoNegativacao, NEGATIVACAO_FEE, computeRecuperado, RECUPERACAO_JANELA_DIAS } from '../utils/negativacao';

// Negativação Serasa (22/07/2026) — Mockup B: sub-aba "console" da aba Boletos.
// Candidatos +90 dias, KPIs (incl. custo R$ 9,90/negativação), e acompanhamento das
// negativações em andamento/recuperadas. Ação sensível: confirma antes de disparar.

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PROXY = '/.netlify/functions/asaas-sync';

async function callAsaas(action, payload = {}) {
  const r = await fetch(PROXY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  return r.json();
}

// Rótulos dos status de negativação do Asaas
const DUN_STATUS = {
  PROCESSED: { t: 'No Serasa', cls: 'red' },
  AWAITING_APPROVAL: { t: 'Em análise', cls: 'blue' },
  PENDING: { t: 'Processando', cls: 'blue' },
  PAID: { t: 'Recuperado', cls: 'green' },
  PARTIALLY_PAID: { t: 'Pago parcial', cls: 'green' },
  CANCELLED: { t: 'Cancelado', cls: 'grey' },
  DENIED: { t: 'Negado', cls: 'grey' },
};
const badgeStyle = {
  red: { background: '#fdecec', color: 'var(--cbc-danger,#B91C1C)' },
  amb: { background: '#fef3e2', color: 'var(--cbc-warning,#D97706)' },
  green: { background: '#e7f6ec', color: 'var(--cbc-success,#15803D)' },
  blue: { background: '#e7effd', color: 'var(--cbc-info,#1D4ED8)' },
  grey: { background: '#eef1f4', color: 'var(--cbc-text-muted,#5E6675)' },
};

function Badge({ cls, children }) {
  return <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap" style={badgeStyle[cls] || badgeStyle.grey}>{children}</span>;
}

function Kpi({ value, label, accent, sub, highlight }) {
  const cor = accent || 'var(--cbc-navy,#1B3A5C)';
  return (
    <div className="rounded-xl p-4 border" style={{
      borderColor: accent ? cor : 'var(--cbc-border,#E2E8F0)',
      background: highlight
        ? 'linear-gradient(160deg, rgba(21,128,61,.07), rgba(255,255,255,0) 60%), var(--cbc-bg-card,#fff)'
        : 'var(--cbc-bg-card,#fff)',
    }}>
      <div className="text-[22px] font-black leading-none" style={{ color: cor }}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide mt-1.5" style={{ color: 'var(--cbc-text-muted,#5E6675)' }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5 leading-tight" style={{ color: 'var(--cbc-text-secondary,#4A5568)' }}>{sub}</div>}
    </div>
  );
}

export default function NegativacaoPanel({ userEmail = '' }) {
  const [boletos, setBoletos] = useState([]);
  const [dunnings, setDunnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(() => new Set());       // customerIds selecionados
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState(null);            // resumo do último disparo
  const [dunNames, setDunNames] = useState(() => new Map()); // paymentId -> nome (negativados)
  const [custByPayment, setCustByPayment] = useState(() => new Map()); // paymentId -> customer_id
  const [paidBoletos, setPaidBoletos] = useState([]);    // boletos pagos dos clientes negativados

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // boletos vencidos (mirror) — paginado defensivamente
      const bo = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await supabase.from('asaas_boletos')
          .select('id, status, due_date, value, customer_id, customer_cpf, customer_name')
          .eq('status', 'OVERDUE').range(from, from + 999);
        if (error) break;
        bo.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      setBoletos(bo);
      const dr = await callAsaas('list-dunnings');
      const duns = dr?.dunnings || [];
      setDunnings(duns);
      // (22/07) resolve o nome das negativações: os boletos negativados NÃO são
      // OVERDUE (viram DUNNING_REQUESTED), então não vêm no load acima. Busco pelos
      // payment ids das negativações p/ o painel "em andamento" mostrar quem é.
      const payIds = [...new Set(duns.map((d) => d.payment).filter(Boolean))];
      if (payIds.length) {
        const { data: dn } = await supabase.from('asaas_boletos')
          .select('id, customer_name, customer_id').in('id', payIds);
        const nomes = new Map(); const custMap = new Map(); const custIds = new Set();
        for (const b of (dn || [])) {
          if (b.id) { nomes.set(b.id, b.customer_name); if (b.customer_id) { custMap.set(b.id, b.customer_id); custIds.add(b.customer_id); } }
        }
        setDunNames(nomes); setCustByPayment(custMap);
        // (22/07) valor recuperado: parcelas PAGAS dos clientes negativados (a janela
        // de 60d pós-negativação é aplicada na lógica pura computeRecuperado).
        if (custIds.size) {
          const { data: pg } = await supabase.from('asaas_boletos')
            .select('id, customer_id, value, payment_date, status')
            .in('customer_id', [...custIds])
            .in('status', ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'])
            .not('payment_date', 'is', null);
          setPaidBoletos(pg || []);
        }
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const candidatos = useMemo(
    () => computeNegativacaoCandidates({ boletos }),
    [boletos]);
  const resumo = useMemo(() => resumoNegativacao(candidatos), [candidatos]);
  const recuperado = useMemo(
    () => computeRecuperado({ dunnings, custByPayment, paidBoletos }),
    [dunnings, custByPayment, paidBoletos]);

  // negativações já feitas por paymentId (evita re-oferecer quem já está negativado)
  const negatByPayment = useMemo(() => {
    const m = new Map();
    for (const d of dunnings) if (d.payment) m.set(d.payment, d);
    return m;
  }, [dunnings]);
  const nomePorPayment = useMemo(() => {
    const m = new Map(dunNames); // nomes dos boletos negativados (não-OVERDUE)
    for (const b of boletos) if (b.id) m.set(b.id, b.customer_name);
    return m;
  }, [boletos, dunNames]);

  const visiveis = candidatos;

  const dunAtivas = dunnings.filter((d) => ['PROCESSED', 'AWAITING_APPROVAL', 'PENDING'].includes(d.status)).length;
  const dunRecup = dunnings.filter((d) => ['PAID', 'PARTIALLY_PAID'].includes(d.status)).length;

  const prontosSelecionaveis = visiveis.filter((c) => c.pronto && c.paymentIdMaisAntigo && !negatByPayment.has(c.paymentIdMaisAntigo));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selAll = () => setSel(new Set(prontosSelecionaveis.map((c) => c.customerId)));
  const selNone = () => setSel(new Set());
  const selCands = candidatos.filter((c) => sel.has(c.customerId) && c.pronto && c.paymentIdMaisAntigo);
  const custoSel = Math.round(selCands.length * NEGATIVACAO_FEE * 100) / 100;
  const valorNegativado = Math.round(selCands.reduce((s, c) => s + (c.valorMaisAntigo || 0), 0) * 100) / 100;

  const dispararLote = async () => {
    setRunning(true);
    const res = { ok: 0, falha: 0, faltaDados: 0, erros: [] };
    for (const c of selCands) {
      try {
        const r = await callAsaas('create-dunning', {
          paymentId: c.paymentIdMaisAntigo, customerId: c.customerId,
          description: 'Honorarios advocaticios em aberto', userEmail,
        });
        if (r?.success) res.ok += 1;
        else if (r?.missingFields) { res.faltaDados += 1; res.erros.push(`${c.nome}: falta ${r.missingFields.join(', ')}`); }
        else { res.falha += 1; res.erros.push(`${c.nome}: ${r?.error || 'erro'}`); }
      } catch (e) { res.falha += 1; res.erros.push(`${c.nome}: ${e.message}`); }
    }
    setRunning(false); setConfirmOpen(false); setTyped(''); setSel(new Set()); setResult(res);
    load();
  };

  // (22/07) cancelar uma negativação ativa (canBeCancelled). Sem tarifa. Confirmação leve.
  const [cancelAlvo, setCancelAlvo] = useState(null); // { id, nome }
  const [cancelando, setCancelando] = useState(false);
  const cancelar = async () => {
    if (!cancelAlvo) return;
    setCancelando(true);
    try {
      const r = await callAsaas('cancel-dunning', { dunningId: cancelAlvo.id, userEmail });
      setResult(r?.success
        ? { ok: 1, falha: 0, faltaDados: 0, erros: [], cancelou: cancelAlvo.nome }
        : { ok: 0, falha: 1, faltaDados: 0, erros: [`${cancelAlvo.nome}: ${r?.error || 'erro ao cancelar'}`] });
    } catch (e) { setResult({ ok: 0, falha: 1, faltaDados: 0, erros: [`${cancelAlvo.nome}: ${e.message}`] }); }
    setCancelando(false); setCancelAlvo(null); load();
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-4" style={{ background: 'var(--cbc-bg,#F0F4F8)' }}>
      {/* KPIs — "Total em aberto" (dívida) ao lado de "Valor recuperado" (o que voltou) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Kpi value={resumo.total} label="Candidatos +90 dias" accent="var(--cbc-danger,#B91C1C)" />
        <Kpi value={fmt(resumo.totalEmAberto)} label="Total em aberto" accent="var(--cbc-danger,#B91C1C)" />
        <Kpi
          value={<span>↑ {fmt(recuperado.valorRecuperado)}</span>}
          label="Valor recuperado"
          accent="var(--cbc-success,#15803D)"
          highlight
          sub={recuperado.boletosRecuperados > 0
            ? `${recuperado.boletosRecuperados} parcela(s) · ${recuperado.clientesRecuperados} cliente(s) · até ${RECUPERACAO_JANELA_DIAS} dias`
            : `pagas até ${RECUPERACAO_JANELA_DIAS} dias após negativar`}
        />
        <Kpi value={dunAtivas} label="Negativações ativas" />
        <Kpi value={fmt(resumo.custoTodosProntos)} label={`Custo p/ os ${resumo.prontos} · R$ 9,90 c/u`} />
      </div>

      {result && (
        <div className="mb-4 rounded-lg px-4 py-3 text-[13px]" style={result.falha && !result.ok
          ? { background: '#fdecec', border: '1px solid var(--cbc-danger,#B91C1C)', color: 'var(--cbc-danger,#B91C1C)' }
          : { background: '#e7f6ec', border: '1px solid var(--cbc-success,#15803D)', color: 'var(--cbc-success,#15803D)' }}>
          {result.cancelou
            ? <><b>Negativação cancelada:</b> {result.cancelou} · sem custo.</>
            : <><b>Negativação concluída:</b> {result.ok} enviada(s) ao Serasa
                {result.faltaDados ? ` · ${result.faltaDados} bloqueada(s) por falta de dado` : ''}
                {result.falha ? ` · ${result.falha} com erro` : ''}.</>}
          {result.erros.length > 0 && <div className="mt-1 text-[11px] opacity-90">{result.erros.slice(0, 5).join(' · ')}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Candidatos */}
        <div className="lg:col-span-3 bg-white rounded-xl border overflow-hidden" style={{ borderColor: 'var(--cbc-border,#E2E8F0)' }}>
          <div className="px-4 py-3 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--cbc-border,#E2E8F0)' }}>
            <span className="text-[13px] font-extrabold uppercase tracking-wide" style={{ color: 'var(--cbc-navy,#1B3A5C)' }}>Candidatos à negativação</span>
            <span className="ml-auto text-[11px] font-bold px-3 py-1 rounded-full" style={{ background: 'var(--cbc-bg-subtle,#F7FAFC)', color: 'var(--cbc-text-secondary,#4A5568)' }}>{candidatos.length} clientes · +90 dias</span>
          </div>
          <div className="px-4 py-2 text-[11px] flex items-start gap-1.5" style={{ background: '#eef3fb', color: 'var(--cbc-text-secondary,#4A5568)' }}>
            <span aria-hidden="true">ℹ️</span>
            <span>A negativação é <b>por parcela</b>: enviamos ao Serasa a <b>parcela vencida mais antiga</b> de cada cliente (não o total). A marca no CPF já pressiona a dívida inteira.</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-[13px]" style={{ color: 'var(--cbc-text-muted,#5E6675)' }}>Carregando candidatos…</div>
          ) : visiveis.length === 0 ? (
            <div className="p-8 text-center text-[13px]" style={{ color: 'var(--cbc-text-muted,#5E6675)' }}>Nenhum cliente com atraso acima de 90 dias. 🎉</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex items-center gap-3 px-4 py-2 text-[11px] font-bold" style={{ background: 'var(--cbc-bg-subtle,#F7FAFC)', color: 'var(--cbc-text-secondary,#4A5568)' }}>
                <input type="checkbox" className="w-4 h-4" style={{ accentColor: 'var(--cbc-danger,#B91C1C)' }}
                  checked={sel.size > 0 && sel.size === prontosSelecionaveis.length} onChange={(e) => e.target.checked ? selAll() : selNone()} />
                <span>Selecionar todos prontos</span>
                <span className="ml-auto rounded-full px-3 py-0.5 text-white text-[11px]" style={{ background: 'var(--cbc-navy,#1B3A5C)' }}>{sel.size} selecionado(s)</span>
              </div>
              <table className="w-full text-[13px]">
                <thead><tr style={{ color: 'var(--cbc-text-muted,#5E6675)' }} className="text-[10px] uppercase tracking-wide">
                  <th className="text-left px-4 py-2 w-8"></th><th className="text-left px-2 py-2">Cliente</th>
                  <th className="text-left px-2 py-2">Atraso</th><th className="text-right px-2 py-2">Negativa · total</th>
                  <th className="text-left px-2 py-2">Situação</th><th className="px-2 py-2"></th>
                </tr></thead>
                <tbody>
                  {visiveis.map((c) => {
                    const jaNeg = c.paymentIdMaisAntigo && negatByPayment.has(c.paymentIdMaisAntigo);
                    const podeSel = c.pronto && !jaNeg;
                    return (
                      <tr key={c.customerId || c.cpf} className="border-t" style={{ borderColor: '#eef2f6' }}>
                        <td className="px-4 py-2.5"><input type="checkbox" className="w-4 h-4" style={{ accentColor: 'var(--cbc-danger,#B91C1C)' }}
                          disabled={!podeSel} checked={sel.has(c.customerId)} onChange={() => toggle(c.customerId)} /></td>
                        <td className="px-2 py-2.5">
                          <div className="font-bold" style={{ color: 'var(--cbc-text-primary,#1B3A5C)' }}>{c.nome || '—'}</div>
                          <div className="text-[11px]" style={{ color: 'var(--cbc-text-muted,#5E6675)' }}>{c.parcelasVencidas} parcela(s) em aberto</div>
                        </td>
                        <td className="px-2 py-2.5"><Badge cls={c.diasAtraso > 300 ? 'red' : 'amb'}>{c.diasAtraso} d</Badge></td>
                        <td className="px-2 py-2.5 text-right">
                          <div className="font-extrabold tabular-nums" style={{ color: 'var(--cbc-text-primary,#1B3A5C)' }}>{fmt(c.valorMaisAntigo)}</div>
                          <div className="text-[10px] tabular-nums" style={{ color: 'var(--cbc-text-muted,#5E6675)' }}>de {fmt(c.totalVencido)} em aberto</div>
                        </td>
                        <td className="px-2 py-2.5">{jaNeg ? <Badge cls="blue">Já negativado</Badge> : <Badge cls="green">Pronto</Badge>}</td>
                        <td className="px-2 py-2.5 text-right">
                          {podeSel && (
                            <button onClick={() => { setSel(new Set([c.customerId])); setConfirmOpen(true); }}
                              className="text-[11px] font-extrabold uppercase tracking-wide px-3 py-1.5 rounded-lg cursor-pointer border transition-colors"
                              style={{ color: 'var(--cbc-danger,#B91C1C)', borderColor: 'var(--cbc-danger,#B91C1C)' }}>Negativar</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center gap-3 px-4 py-3 border-t" style={{ background: 'var(--cbc-bg-subtle,#F7FAFC)', borderColor: 'var(--cbc-border,#E2E8F0)' }}>
                <span className="text-[11px]" style={{ color: 'var(--cbc-text-muted,#5E6675)' }}>Selecione vários para negativar em lote · custo R$ 9,90 por negativação</span>
                <button disabled={selCands.length === 0} onClick={() => setConfirmOpen(true)}
                  className="ml-auto text-[11px] font-extrabold uppercase tracking-wide px-4 py-2 rounded-lg text-white cursor-pointer disabled:opacity-40"
                  style={{ background: 'var(--cbc-danger,#B91C1C)' }}>⚖️ Negativar selecionados ({selCands.length})</button>
              </div>
            </div>
          )}
        </div>

        {/* Andamento */}
        <div className="lg:col-span-2 bg-white rounded-xl border overflow-hidden h-fit" style={{ borderColor: 'var(--cbc-border,#E2E8F0)' }}>
          <div className="px-4 py-3 border-b text-[13px] font-extrabold uppercase tracking-wide" style={{ borderColor: 'var(--cbc-border,#E2E8F0)', color: 'var(--cbc-navy,#1B3A5C)' }}>Negativações em andamento</div>
          {dunnings.length === 0 ? (
            <div className="p-6 text-center text-[12px]" style={{ color: 'var(--cbc-text-muted,#5E6675)' }}>Nenhuma negativação registrada ainda.</div>
          ) : dunnings.slice(0, 12).map((d) => {
            const s = DUN_STATUS[d.status] || { t: d.status, cls: 'grey' };
            return (
              <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 border-t text-[13px]" style={{ borderColor: '#eef2f6' }}>
                <div className="min-w-0">
                  <div className="font-bold truncate" style={{ color: 'var(--cbc-text-primary,#1B3A5C)' }}>{nomePorPayment.get(d.payment) || 'Cliente'}</div>
                  <div className="text-[11px]" style={{ color: 'var(--cbc-text-muted,#5E6675)' }}>{fmt(d.value)} · tarifa {fmt(d.feeValue)}</div>
                </div>
                <div className="ml-auto text-right flex items-center gap-2">
                  <Badge cls={s.cls}>{s.t}</Badge>
                  {d.canBeCancelled && (
                    <button onClick={() => setCancelAlvo({ id: d.id, nome: nomePorPayment.get(d.payment) || 'Cliente' })}
                      className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-lg cursor-pointer border transition-colors"
                      style={{ color: 'var(--cbc-text-secondary,#4A5568)', borderColor: 'var(--cbc-border,#E2E8F0)' }}
                      title="Cancelar esta negativação no Serasa (sem custo)">Cancelar</button>
                  )}
                </div>
              </div>
            );
          })}
          <div className="px-4 py-2.5 border-t text-[11px]" style={{ borderColor: 'var(--cbc-border,#E2E8F0)', color: 'var(--cbc-text-muted,#5E6675)' }}>
            {dunnings.length} negativação(ões) no total · {dunAtivas} ativas · {dunRecup} recuperadas
          </div>
        </div>
      </div>

      {/* Modal de confirmação */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(15,32,53,.55)' }} onClick={() => !running && setConfirmOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 text-white flex items-center gap-3" style={{ background: 'var(--cbc-danger,#B91C1C)' }}>
              <span className="text-xl">⚖️</span><div className="font-bold text-[15px]">Confirmar negativação no Serasa</div>
            </div>
            <div className="p-5">
              <p className="text-[13px] mb-3" style={{ color: 'var(--cbc-text-secondary,#4A5568)' }}>
                Você vai negativar <b>{selCands.length} cliente(s)</b> no Serasa. De cada um, negativa a <b>parcela vencida mais antiga</b> (não o total da dívida). O Serasa notifica por carta (10 dias para pagar); se pagar, a baixa é automática.
              </p>
              <div className="rounded-lg p-3 mb-3 text-[13px]" style={{ background: 'var(--cbc-bg-subtle,#F7FAFC)' }}>
                <div className="flex justify-between py-1"><span>Negativações (1 parcela por cliente)</span><b>{selCands.length}</b></div>
                <div className="flex justify-between py-1"><span>Valor negativado (parcelas)</span><b>{fmt(valorNegativado)}</b></div>
                <div className="flex justify-between py-1"><span>Tarifa unitária</span><b>{fmt(NEGATIVACAO_FEE)}</b></div>
                <div className="flex justify-between py-1 border-t mt-1 pt-2" style={{ borderColor: 'var(--cbc-border,#E2E8F0)' }}><span className="font-bold">Custo total (débito do saldo Asaas)</span><b style={{ color: 'var(--cbc-danger,#B91C1C)' }}>{fmt(custoSel)}</b></div>
              </div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--cbc-text-secondary,#4A5568)' }}>Digite <span className="font-mono px-1 rounded" style={{ background: '#fdecec', color: 'var(--cbc-danger,#B91C1C)' }}>NEGATIVAR</span> para confirmar</label>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={running} autoFocus
                className="w-full border-2 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
                style={{ borderColor: typed.trim().toUpperCase() === 'NEGATIVAR' ? 'var(--cbc-success,#15803D)' : 'var(--cbc-border,#E2E8F0)' }} />
            </div>
            <div className="px-5 py-4 flex gap-2 justify-end border-t" style={{ borderColor: 'var(--cbc-border,#E2E8F0)', background: 'var(--cbc-bg-subtle,#F7FAFC)' }}>
              <button onClick={() => !running && setConfirmOpen(false)} className="px-4 py-2 rounded-lg border text-sm font-bold cursor-pointer" style={{ borderColor: 'var(--cbc-border,#E2E8F0)', color: 'var(--cbc-text-secondary,#4A5568)' }}>Cancelar</button>
              <button disabled={running || typed.trim().toUpperCase() !== 'NEGATIVAR'} onClick={dispararLote}
                className="px-4 py-2 rounded-lg text-white text-sm font-bold cursor-pointer disabled:opacity-40" style={{ background: 'var(--cbc-danger,#B91C1C)' }}>
                {running ? 'Negativando…' : `⚖️ Confirmar (${fmt(custoSel)})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cancelamento de negativação (sem custo) */}
      {cancelAlvo && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(15,32,53,.55)' }} onClick={() => !cancelando && setCancelAlvo(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 text-white flex items-center gap-3" style={{ background: 'var(--cbc-navy,#1B3A5C)' }}>
              <span className="text-xl">↩️</span><div className="font-bold text-[15px]">Cancelar negativação no Serasa</div>
            </div>
            <div className="p-5">
              <p className="text-[13px]" style={{ color: 'var(--cbc-text-secondary,#4A5568)' }}>
                Retirar a negativação de <b>{cancelAlvo.nome}</b> do Serasa. O nome deixa de ficar negativado. <b>Sem custo.</b> Use quando o cliente pagou/negociou ou a negativação foi indevida.
              </p>
            </div>
            <div className="px-5 py-4 flex gap-2 justify-end border-t" style={{ borderColor: 'var(--cbc-border,#E2E8F0)', background: 'var(--cbc-bg-subtle,#F7FAFC)' }}>
              <button onClick={() => !cancelando && setCancelAlvo(null)} className="px-4 py-2 rounded-lg border text-sm font-bold cursor-pointer" style={{ borderColor: 'var(--cbc-border,#E2E8F0)', color: 'var(--cbc-text-secondary,#4A5568)' }}>Voltar</button>
              <button disabled={cancelando} onClick={cancelar}
                className="px-4 py-2 rounded-lg text-white text-sm font-bold cursor-pointer disabled:opacity-40" style={{ background: 'var(--cbc-navy,#1B3A5C)' }}>
                {cancelando ? 'Cancelando…' : '↩️ Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
