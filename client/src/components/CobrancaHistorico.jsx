/**
 * Histórico de Cobrança (sub-aba da aba Boletos, entre "Cobrança" e "Todos boletos").
 * Mistura das propostas 1 (linha do tempo) + 3 (funil por lote): cada DISPARO é um nó
 * cronológico; ao abrir, mostra o funil Enviados → Entregues → Falhas → Recuperados +
 * a lista de clientes com o status real de entrega do Kommo.
 * Fonte: cobranca-historico (RPC cobranca_historico = cobranca_disparos ⋈ kommo_queue).
 * Recursos: filtros (operador/template/período) + busca + reenviar falha + abrir Kommo
 *           + exportar CSV + eficácia por template.
 */
import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import MoneyValue from './ui/MoneyValue';

const BOT_KEY = import.meta.env.VITE_BOT_PANEL_KEY || 'cbc-bot-2026';
const KOMMO_BASE = 'https://advocaciacbc.kommo.com/leads/detail/';

async function callFn(name, body) {
  const r = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-key': BOT_KEY },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const digits = (s) => String(s || '').replace(/\D/g, '');
const TPL = (t) => /^cobranca_\d+$/.test(t || '') ? 'Cobrança ' + String(t).split('_')[1] : (t || '—');
const opName = (e) => {
  const p = String(e || '').split('@')[0].replace(/[._]+/g, ' ').trim();
  return p ? p.split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Sistema';
};
const opIni = (e) => (opName(e).split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'S');
const dataBR = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const horaBR = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const diaKey = (iso) => String(new Date(iso).toLocaleDateString('pt-BR'));
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

function cliStatus(c) {
  if (c.pago) return { t: '★ Recuperado', bg: '#f6efd7', fg: '#8a6d12' };
  if (c.kommo_status === 'failed') return { t: '✕ Falhou', bg: 'var(--cbc-danger-bg,#fbe9e9)', fg: 'var(--cbc-danger)' };
  if (c.kommo_status === 'done') return { t: '✓ Entregue', bg: 'var(--cbc-success-bg,#e7f4ec)', fg: 'var(--cbc-success)' };
  return { t: '⏳ Na fila', bg: 'var(--cbc-warning-bg,#fdf3e6)', fg: 'var(--cbc-warning)' };
}

export default function CobrancaHistorico({ userEmail = '' }) {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(() => new Set());
  const [busca, setBusca] = useState('');
  const [fOp, setFOp] = useState('todos');
  const [fTpl, setFTpl] = useState('todos');
  const [fPer, setFPer] = useState('tudo');
  const [toast, setToast] = useState('');
  const [reenv, setReenv] = useState(() => new Set()); // cpfs reenviando
  const toastT = useRef(null);

  const flash = useCallback((m) => { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 2600); }, []);

  const load = useCallback(async () => {
    setLoading(true); setErro('');
    try { const j = await callFn('cobranca-historico', {}); setRows(j.rows || []); }
    catch (e) { setErro(e.message); }
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  /* (carrega o historico no mount) */

  const operadores = useMemo(() => [...new Set(rows.map((r) => r.disparado_por).filter(Boolean))], [rows]);
  const templates = useMemo(() => [...new Set(rows.map((r) => r.template_name).filter(Boolean))], [rows]);

  const batches = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = `${r.disparado_em}|${r.disparado_por}|${r.template_name}`;
      if (!m.has(k)) m.set(k, { key: k, disparado_em: r.disparado_em, disparado_por: r.disparado_por, template_name: r.template_name, clientes: [] });
      m.get(k).clientes.push(r);
    }
    const arr = [...m.values()].map((b) => {
      const enviados = b.clientes.length;
      const entregues = b.clientes.filter((c) => c.kommo_status === 'done').length;
      const falhas = b.clientes.filter((c) => c.kommo_status === 'failed').length;
      const recuperados = b.clientes.filter((c) => c.pago).length;
      const valorRec = b.clientes.filter((c) => c.pago).reduce((s, c) => s + Number(c.total_em_aberto || 0), 0);
      const valorTotal = b.clientes.reduce((s, c) => s + Number(c.total_em_aberto || 0), 0);
      const cl = [...b.clientes].sort((a, c) =>
        (c.pago ? 1 : 0) - (a.pago ? 1 : 0)
        || (c.kommo_status === 'failed' ? 1 : 0) - (a.kommo_status === 'failed' ? 1 : 0)
        || Number(c.total_em_aberto || 0) - Number(a.total_em_aberto || 0));
      return { ...b, clientes: cl, enviados, entregues, falhas, fila: enviados - entregues - falhas, recuperados, valorRec, valorTotal };
    });
    arr.sort((a, b) => String(b.disparado_em).localeCompare(String(a.disparado_em)));
    return arr;
  }, [rows]);

  // eficácia por template (recuperados / enviados)
  const eficacia = useMemo(() => {
    const m = {};
    for (const r of rows) {
      const k = r.template_name || '—';
      m[k] = m[k] || { tpl: k, enviados: 0, pagos: 0 };
      m[k].enviados++; if (r.pago) m[k].pagos++;
    }
    return Object.values(m).map((x) => ({ ...x, taxa: pct(x.pagos, x.enviados) })).sort((a, b) => b.enviados - a.enviados);
  }, [rows]);

  // recorte por filtros
  const cutISO = useMemo(() => {
    if (fPer === 'tudo') return null;
    const d = new Date();
    if (fPer === 'hoje') { d.setHours(0, 0, 0, 0); return d.toISOString(); }
    d.setDate(d.getDate() - Number(fPer)); return d.toISOString();
  }, [fPer]);
  const termo = busca.trim().toLowerCase();
  const batchesView = useMemo(() => batches
    .filter((b) => (fOp === 'todos' || b.disparado_por === fOp)
      && (fTpl === 'todos' || b.template_name === fTpl)
      && (!cutISO || String(b.disparado_em) >= cutISO))
    .map((b) => {
      if (!termo) return { ...b, mostra: b.clientes, force: false };
      const m = b.clientes.filter((c) => `${c.customer_name || ''} ${digits(c.customer_cpf)}`.toLowerCase().includes(termo));
      return { ...b, mostra: m, force: true };
    })
    .filter((b) => b.mostra.length > 0), [batches, fOp, fTpl, cutISO, termo]);

  const porDia = useMemo(() => {
    const m = new Map();
    for (const b of batchesView) { const d = diaKey(b.disparado_em); if (!m.has(d)) m.set(d, { dia: d, label: dataBR(b.disparado_em), lotes: [] }); m.get(d).lotes.push(b); }
    return [...m.values()];
  }, [batchesView]);

  const totais = useMemo(() => batchesView.reduce((t, b) => ({
    lotes: t.lotes + 1, enviados: t.enviados + b.enviados, entregues: t.entregues + b.entregues,
    falhas: t.falhas + b.falhas, recuperados: t.recuperados + b.recuperados, valorRec: t.valorRec + b.valorRec,
  }), { lotes: 0, enviados: 0, entregues: 0, falhas: 0, recuperados: 0, valorRec: 0 }), [batchesView]);

  const toggle = useCallback((k) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }), []);
  const abrirKommo = useCallback((leadId) => {
    if (!leadId) { flash('Cliente sem lead no Kommo.'); return; }
    window.open(`${KOMMO_BASE}${leadId}`, '_blank', 'noopener');
  }, [flash]);
  const reenviar = useCallback(async (c) => {
    const cpf = digits(c.customer_cpf);
    setReenv((s) => new Set(s).add(cpf));
    try {
      const j = await callFn('cobranca-disparar', { template: c.template_name, cpfs: [cpf], userEmail });
      flash(j.enfileirados ? `↻ Reenviado para ${(c.customer_name || '').split(' ')[0]}` : 'Não reenviou (cliente não está mais elegível ou já pago).');
      await load();
    } catch (e) { flash('Erro ao reenviar: ' + e.message); }
    setReenv((s) => { const n = new Set(s); n.delete(cpf); return n; });
  }, [flash, load, userEmail]);

  const exportCSV = useCallback(() => {
    const lin = [['Data', 'Hora', 'Operador', 'Template', 'Cliente', 'CPF', 'Em aberto', 'Entrega Kommo', 'Recuperado', 'Dias ate pagar', 'Erro']];
    for (const b of batchesView) for (const c of b.mostra) {
      const entrega = c.kommo_status === 'failed' ? 'Falhou' : c.kommo_status === 'done' ? 'Entregue' : 'Na fila';
      lin.push([dataBR(b.disparado_em), horaBR(b.disparado_em), opName(b.disparado_por), TPL(b.template_name),
        c.customer_name || '', digits(c.customer_cpf), String(c.total_em_aberto || 0).replace('.', ','),
        entrega, c.pago ? 'Sim' : '', c.pago && c.dias_ate_pagamento != null ? c.dias_ate_pagamento : '', (c.kommo_erro || '').replace(/[;\n]/g, ' ')]);
    }
    const csv = '﻿' + lin.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `historico-cobranca-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [batchesView]);

  if (loading) return <div className="flex-1 p-8 text-center text-sm" style={{ color: 'var(--cbc-text-muted)' }}>Carregando histórico de cobrança…</div>;
  if (erro) return (
    <div className="flex-1 p-6"><div className="rounded-xl p-4 text-sm" style={{ background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
      Não consegui carregar o histórico: {erro} <button onClick={load} className="ml-2 underline font-bold">tentar de novo</button>
    </div></div>
  );
  if (!batches.length) return (
    <div className="flex-1 p-10 text-center">
      <div className="text-[15px] font-bold" style={{ color: 'var(--cbc-text-primary)' }}>Nenhum disparo ainda</div>
      <div className="text-[12.5px] mt-1 max-w-md mx-auto" style={{ color: 'var(--cbc-text-muted)' }}>
        Quando você disparar cobranças na aba <b>Cobrança</b>, cada lote aparece aqui — quem enviou, para quais clientes e o que o Kommo entregou e converteu.
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
      {toast && <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[300] px-4 py-2.5 rounded-xl text-[13px] font-bold text-white shadow-lg" style={{ background: 'var(--cbc-navy-dark,#0F2035)' }}>{toast}</div>}

      {/* filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 flex-1 min-w-[180px] max-w-[320px]" style={{ border: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-card,#fff)' }}>
          <span aria-hidden="true">🔎</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente ou CPF…" className="bg-transparent outline-none text-[12.5px] w-full" />
          {busca && <button onClick={() => setBusca('')} aria-label="limpar" className="text-[13px]" style={{ color: 'var(--cbc-text-muted)' }}>×</button>}
        </div>
        {operadores.length > 1 && (
          <select value={fOp} onChange={(e) => setFOp(e.target.value)} className="rounded-lg px-2.5 py-2 text-[12px] font-semibold" style={{ border: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-card,#fff)', color: 'var(--cbc-text-secondary)' }}>
            <option value="todos">Todos operadores</option>
            {operadores.map((o) => <option key={o} value={o}>{opName(o)}</option>)}
          </select>
        )}
        <select value={fTpl} onChange={(e) => setFTpl(e.target.value)} className="rounded-lg px-2.5 py-2 text-[12px] font-semibold" style={{ border: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-card,#fff)', color: 'var(--cbc-text-secondary)' }}>
          <option value="todos">Todos templates</option>
          {templates.map((t) => <option key={t} value={t}>{TPL(t)}</option>)}
        </select>
        <div className="inline-flex rounded-lg p-0.5 gap-0.5" style={{ border: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-card,#fff)' }}>
          {[['hoje', 'Hoje'], ['7', '7d'], ['30', '30d'], ['tudo', 'Tudo']].map(([k, l]) => (
            <button key={k} onClick={() => setFPer(k)} aria-pressed={fPer === k}
              className="px-2.5 py-1 text-[11.5px] font-bold rounded-md cursor-pointer"
              style={{ background: fPer === k ? 'var(--cbc-navy)' : 'transparent', color: fPer === k ? '#fff' : 'var(--cbc-text-muted)' }}>{l}</button>
          ))}
        </div>
        <button onClick={exportCSV} className="ml-auto px-3 py-2 text-[11.5px] font-bold uppercase rounded-lg cursor-pointer border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}>⬇ Exportar CSV</button>
      </div>

      {/* eficácia por template */}
      {eficacia.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl px-4 py-2.5" style={{ background: 'var(--cbc-bg-card,#fff)', border: '1px solid var(--cbc-border)' }}>
          <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>Eficácia</span>
          {eficacia.map((x) => (
            <span key={x.tpl} className="inline-flex items-center gap-2 text-[12px] rounded-lg px-2.5 py-1" style={{ background: 'var(--cbc-bg-subtle,#f4f8fd)', border: '1px solid var(--cbc-border)' }}>
              <b style={{ color: 'var(--cbc-navy)' }}>{TPL(x.tpl)}</b>
              <b className="tabular-nums" style={{ color: x.taxa >= 10 ? '#8a6d12' : 'var(--cbc-text-secondary)' }}>{x.taxa}%</b>
              <span style={{ color: 'var(--cbc-text-muted)' }}>{x.pagos}/{x.enviados}</span>
            </span>
          ))}
        </div>
      )}

      {/* resumo do recorte */}
      <div className="flex items-center flex-wrap gap-x-7 gap-y-2 rounded-xl px-5 py-3.5" style={{ background: 'var(--cbc-bg-card,#fff)', border: '1px solid var(--cbc-border)' }}>
        <Stat v={totais.lotes} l="disparos" />
        <Sep />
        <Stat v={`${totais.entregues}/${totais.enviados}`} l="entregues" cor="var(--cbc-success)" />
        <Sep />
        <Stat v={totais.falhas} l="falhas" cor={totais.falhas ? 'var(--cbc-danger)' : 'var(--cbc-text-muted)'} />
        <Sep />
        <Stat v={totais.recuperados} l="recuperados" cor="#8a6d12" />
        <div className="ml-auto text-right">
          <div className="text-[20px] font-bold tabular-nums" style={{ color: '#8a6d12' }}><MoneyValue value={totais.valorRec} /></div>
          <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>recuperado</div>
        </div>
      </div>

      {porDia.length === 0 && <div className="p-8 text-center text-[12.5px]" style={{ color: 'var(--cbc-text-muted)' }}>Nenhum disparo neste filtro.</div>}

      {porDia.map((dia) => (
        <div key={dia.dia}>
          <div className="text-[11px] font-bold uppercase tracking-wider mb-3 ml-1" style={{ color: 'var(--cbc-text-muted)' }}>{dia.label}</div>
          <div className="relative">
            <span className="absolute left-[7px] top-2 bottom-3 w-px" style={{ background: 'var(--cbc-border)' }} aria-hidden="true" />
            {dia.lotes.map((b) => (
              <BatchNode key={b.key} b={b} open={b.force || open.has(b.key)} onToggle={toggle} onKommo={abrirKommo} onReenviar={reenviar} reenv={reenv} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Sep() { return <span className="w-px h-7 self-center" style={{ background: 'var(--cbc-border)' }} aria-hidden="true" />; }
function Stat({ v, l, cor }) {
  return (
    <div>
      <div className="text-[20px] font-bold tabular-nums leading-none" style={{ color: cor || 'var(--cbc-navy)' }}>{v}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide mt-1" style={{ color: 'var(--cbc-text-muted)' }}>{l}</div>
    </div>
  );
}

const BatchNode = memo(function BatchNode({ b, open, onToggle, onKommo, onReenviar, reenv }) {
  const entP = pct(b.entregues, b.enviados);
  const falP = b.falhas ? Math.max(pct(b.falhas, b.enviados), 4) : 0;
  const filP = Math.max(100 - entP - falP, 0);
  const lista = b.mostra || b.clientes;
  return (
    <div className="relative pl-7 pb-3">
      <span className="absolute left-0 top-[19px] w-3.5 h-3.5 rounded-full border-2" aria-hidden="true"
        style={{ borderColor: b.recuperados ? 'var(--cbc-gold,#C9A84C)' : 'var(--cbc-navy)', background: 'var(--cbc-bg-card,#fff)' }} />
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--cbc-bg-card,#fff)', border: '1px solid var(--cbc-border)', boxShadow: '0 1px 3px rgba(15,32,53,.05)' }}>
        <button onClick={() => onToggle(b.key)} aria-expanded={open}
          className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors hover:bg-[var(--cbc-bg-subtle,#f7fafd)]">
          <span className="text-[12px] font-bold w-11 shrink-0 tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}>{horaBR(b.disparado_em)}</span>
          <span className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold text-white shrink-0"
            style={{ background: 'linear-gradient(150deg,var(--cbc-navy-light,#264A72),var(--cbc-navy))' }}>{opIni(b.disparado_por)}</span>
          <span className="min-w-0 flex-1">
            <span className="text-[13px]" style={{ color: 'var(--cbc-text-primary)' }}>
              <b>{opName(b.disparado_por)}</b> disparou{' '}
              <span className="inline-flex items-center gap-1.5 font-bold rounded-md px-1.5 py-0.5 text-[11.5px]" style={{ background: '#eaf0f7', color: 'var(--cbc-navy)', border: '1px solid #d6e1ee' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--cbc-gold,#C9A84C)' }} />{TPL(b.template_name)}
              </span>
            </span>
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>para {b.enviados} clientes</span>
          </span>
          <span className="hidden min-[760px]:flex items-center gap-3 shrink-0">
            <span className="w-[120px] h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--cbc-bg-subtle,#eef2f7)' }}
              title={`${b.entregues} entregues · ${b.falhas} falhas · ${b.fila} na fila`}>
              <i className="block h-full" style={{ width: `${entP}%`, background: 'var(--cbc-success)' }} />
              <i className="block h-full" style={{ width: `${falP}%`, background: 'var(--cbc-danger)' }} />
              <i className="block h-full" style={{ width: `${filP}%`, background: 'var(--cbc-warning)' }} />
            </span>
            <span className="text-right w-[58px]"><b className="text-[14px] tabular-nums">{b.entregues}</b><span className="block text-[9.5px] uppercase font-bold" style={{ color: 'var(--cbc-text-muted)' }}>entregues</span></span>
            <span className="text-right w-[48px]"><b className="text-[14px] tabular-nums" style={{ color: b.falhas ? 'var(--cbc-danger)' : 'var(--cbc-text-muted)' }}>{b.falhas}</b><span className="block text-[9.5px] uppercase font-bold" style={{ color: 'var(--cbc-text-muted)' }}>falhas</span></span>
            <span className="text-right w-[72px]"><b className="text-[14px] tabular-nums" style={{ color: '#8a6d12' }}>{b.recuperados}</b><span className="block text-[9.5px] font-bold tabular-nums" style={{ color: 'var(--cbc-text-muted)' }}><MoneyValue value={b.valorRec} /></span></span>
          </span>
          <span className="shrink-0 text-[12px] transition-transform" style={{ color: 'var(--cbc-text-muted)', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
        </button>

        {open && (
          <div style={{ borderTop: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-subtle,#fbfdff)' }}>
            <div className="px-4 py-3.5 space-y-2 border-b" style={{ borderColor: 'var(--cbc-border)' }}>
              <FunilRow lab="Enviados" w={100} cor="var(--cbc-navy)" val={b.enviados} />
              <FunilRow lab="Entregues" w={entP} cor="var(--cbc-success)" val={b.entregues} sub={`${entP}%`} />
              <FunilRow lab="Falhas" w={falP} cor="var(--cbc-danger)" val={b.falhas} valCor={b.falhas ? 'var(--cbc-danger)' : 'var(--cbc-text-muted)'} />
              <FunilRow lab="Recuperados" w={Math.max(pct(b.recuperados, b.enviados), b.recuperados ? 4 : 0)} cor="var(--cbc-gold,#C9A84C)" val={b.recuperados} valCor="#8a6d12" money={b.valorRec} />
            </div>
            <div>
              {lista.map((c, i) => {
                const st = cliStatus(c);
                const cpf = digits(c.customer_cpf);
                return (
                  <div key={(c.customer_cpf || '') + i} className="grid items-center gap-3 px-4 py-2 border-t first:border-t-0 text-[12.5px]"
                    style={{ gridTemplateColumns: '1fr 84px 116px 150px', borderColor: 'var(--cbc-border)' }}>
                    <div className="min-w-0">
                      <div className="font-bold truncate" style={{ color: 'var(--cbc-text-primary)' }}>{c.customer_name || cpf}</div>
                      <div className="text-[10.5px]" style={{ color: c.kommo_status === 'failed' ? 'var(--cbc-danger)' : 'var(--cbc-text-muted)' }}>
                        {c.dias_atraso != null ? `${c.dias_atraso}d em atraso` : ''}{c.pago && c.dias_ate_pagamento != null ? ` · pagou em ${c.dias_ate_pagamento}d` : ''}
                        {c.kommo_status === 'failed' && c.kommo_erro ? ` · ${c.kommo_erro}` : ''}
                      </div>
                    </div>
                    <span className="text-right font-bold tabular-nums" style={{ color: 'var(--cbc-text-primary)' }}><MoneyValue value={c.total_em_aberto} /></span>
                    <span className="text-right">
                      <span className="inline-flex items-center font-bold rounded-full px-2.5 py-0.5 text-[11px] whitespace-nowrap" style={{ background: st.bg, color: st.fg }}>{st.t}</span>
                    </span>
                    <span className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                      {c.kommo_status === 'failed' && (
                        <button onClick={() => onReenviar(c)} disabled={reenv.has(cpf)}
                          className="text-[11px] font-bold px-2 py-1 rounded cursor-pointer disabled:opacity-40" style={{ color: 'var(--cbc-navy)', border: '1px solid var(--cbc-border)' }}>
                          {reenv.has(cpf) ? '…' : '↻ Reenviar'}
                        </button>
                      )}
                      <button onClick={() => onKommo(c.lead_id)} disabled={!c.lead_id} title={c.lead_id ? 'Abrir conversa no Kommo' : 'Sem lead no Kommo'}
                        className="text-[11px] font-bold px-2 py-1 rounded cursor-pointer text-white disabled:opacity-30" style={{ background: '#2E7CF6' }}>Kommo</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function FunilRow({ lab, w, cor, val, sub, valCor, money }) {
  return (
    <div className="grid items-center gap-3" style={{ gridTemplateColumns: '94px 1fr 92px' }}>
      <span className="text-[11.5px] font-bold" style={{ color: 'var(--cbc-text-muted)' }}>{lab}</span>
      <span className="h-[22px] rounded-md overflow-hidden relative" style={{ background: 'var(--cbc-bg-card,#eef2f7)', border: '1px solid var(--cbc-border)' }}>
        <i className="absolute inset-y-0 left-0 rounded-md block transition-[width] duration-500" style={{ width: `${w}%`, background: cor }} />
      </span>
      <span className="text-right text-[13px] font-bold tabular-nums" style={{ color: valCor || 'var(--cbc-text-primary)' }}>
        {val}{money != null && money > 0 ? <span className="block text-[10px] font-bold" style={{ color: 'var(--cbc-text-muted)' }}><MoneyValue value={money} /></span> : sub ? <span className="text-[10.5px] font-semibold ml-1" style={{ color: 'var(--cbc-text-muted)' }}>{sub}</span> : null}
      </span>
    </div>
  );
}
