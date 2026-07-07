/**
 * Painel COMBINADO de Boletos & Cobrança (aba Boletos · sub-aba "Cobrança").
 * Combina: KPIs (#1) + Saúde/aging que filtra (#4) + visões Por cliente (#7) /
 * Todos os boletos / Estágios-régua (#5) + trilho de Cobrança (#1/#2).
 * Dados: cobranca-listar (devedores c/ lead casado) + asaas_boletos (boletos em
 * aberto, p/ a lista plana e as parcelas por cliente) + cobranca_disparos (métricas).
 * Disparo via cobranca-disparar (dryRun -> confirmar). Anderson é avisado pelos bots.
 *
 * Listas SEM paginação (mostra todos os inadimplentes/boletos/estágios). Para que
 * isso seja barato, as linhas são memoizadas (React.memo) e recebem `selected`
 * como booleano + handlers estáveis (useCallback): marcar 1 checkbox re-renderiza
 * só a linha tocada, não a lista inteira.
 */
import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { supabase } from '../lib/supabase';
import MoneyValue from './ui/MoneyValue';

const KOMMO_BASE = 'https://advocaciacbc.kommo.com/leads/detail/';

const BOT_KEY = import.meta.env.VITE_BOT_PANEL_KEY || 'cbc-bot-2026';
const digits = (s) => String(s || '').replace(/\D/g, '');
const fmtData = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

async function callFn(name, body) {
  const r = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-key': BOT_KEY },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const MATCH = {
  clientes_cpf: { l: 'CPF', c: 'var(--cbc-success)' },
  contrato_link: { l: 'Contrato', c: 'var(--cbc-success)' },
  telefone: { l: 'Telefone', c: 'var(--cbc-success)' },
  telefone_ambiguo: { l: 'Tel. ambíguo', c: 'var(--cbc-warning)' },
  sem_lead: { l: 'Sem lead', c: 'var(--cbc-text-muted)' },
};
const MOTIVO = { sem_lead: 'sem lead', opt_out: 'não perturbe', cooldown: 'cobrado há pouco' };
const FAIXAS = [
  { key: 1, label: '1–7 dias', cor: '#C9A84C', lo: 0, hi: 7 },
  { key: 2, label: '8–30 dias', cor: '#B45309', lo: 8, hi: 30 },
  { key: 3, label: '30–90 dias', cor: '#D9622B', lo: 31, hi: 90 },
  { key: 4, label: '90+ / negativação', cor: '#DC2626', lo: 91, hi: 1e9 },
];
const faixaDe = (dias) => (FAIXAS.find((f) => dias >= f.lo && dias <= f.hi) || FAIXAS[3]).key;
const PADRAO_TPL = { 1: 0, 2: 1, 3: 2, 4: null }; // faixa -> índice de template sugerido

export default function CobrancaPanel({ userEmail = '', onVerHistorico }) {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [data, setData] = useState(null);          // cobranca-listar
  const [boletos, setBoletos] = useState([]);      // asaas_boletos em aberto
  const [metrics, setMetrics] = useState([]);
  const [view, setView] = useState('cliente');     // cliente | boletos | estagio
  const [filtro, setFiltro] = useState(0);         // faixa de atraso (0 = todas)
  const [fCob, setFCob] = useState('todos');       // cobrança: todos|nunca|cobrado|7|15|30 (cobrado há +Nd)
  const [fLead, setFLead] = useState('todos');     // (#9) vínculo com lead: todos|com|sem
  const [sel, setSel] = useState(() => new Set()); // cpfs selecionados (digits)
  const [template, setTemplate] = useState('');
  const [expand, setExpand] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [checando, setChecando] = useState(false);
  const [promById, setPromById] = useState(() => new Map()); // cpf -> promessa de pagamento (#34)
  const [tendencia, setTendencia] = useState([]); // inadimplencia_historico p/ o sparkline (#31)
  const [toast, setToast] = useState('');
  const [autoEnvio, setAutoEnvio] = useState(null); // (cobranca 06/07) saúde do envio automático de boleto
  const toastT = useRef(null);

  const flash = useCallback((msg) => {
    setToast(msg); clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(''), 2200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErro('');
    try {
      const j = await callFn('cobranca-listar', {});
      setData(j);
      setTemplate((t) => t || (j.cfg?.templates || [])[0]?.name || '');
    } catch (e) { setErro(e.message); }
    setLoading(false);
  }, []);

  const loadBoletos = useCallback(async () => {
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const { data: rows } = await supabase.from('asaas_boletos')
        .select('id, customer_name, customer_cpf, value, due_date, status, invoice_url, bank_slip_url, pix_copy_paste')
        .or(`status.eq.OVERDUE,status.eq.DUNNING_REQUESTED,and(status.eq.PENDING,due_date.lt.${hoje})`)
        .limit(5000);
      setBoletos(rows || []);
    } catch { setBoletos([]); }
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const desde = new Date(Date.now() - 90 * 86400000).toISOString();
      const { data: rows } = await supabase.from('cobranca_disparos')
        .select('template_name, resultado, pago, dias_ate_pagamento, total_em_aberto_no_disparo, disparado_em')
        .gte('disparado_em', desde).limit(5000);
      setMetrics(rows || []);
    } catch { setMetrics([]); }
  }, []);

  // (cobranca 06/07) métrica de ENVIO AUTOMÁTICO do boleto pelo bot (entregue vs erro)
  const loadAutoEnvio = useCallback(async () => {
    try {
      const j = await callFn('cobranca-metrica', {});
      if (j?.ok) setAutoEnvio(j);
    } catch { /* silencioso — badge só aparece se vier dado */ }
  }, []);

  const loadProm = useCallback(async () => {
    try {
      const j = await callFn('cobranca-promessa', { action: 'list' });
      const m = new Map();
      for (const p of j.promessas || []) m.set(digits(p.customer_cpf), p);
      setPromById(m);
    } catch { /* silencioso */ }
  }, []);

  const loadTendencia = useCallback(async () => {
    try {
      const { data } = await supabase.from('inadimplencia_historico').select('dia, total').order('dia', { ascending: true }).limit(180);
      setTendencia((data || []).slice(-30));
    } catch { setTendencia([]); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); loadBoletos(); loadMetrics(); loadProm(); loadTendencia(); loadAutoEnvio(); }, [load, loadBoletos, loadMetrics, loadProm, loadTendencia, loadAutoEnvio]);

  // cfg/templates/janela memoizados (estáveis enquanto `data` não muda) — base p/ os demais memos
  const cfg = useMemo(() => data?.cfg || {}, [data]);
  const janela = useMemo(() => cfg.janela_pagamento_dias ?? 7, [cfg]);
  const cooldown = useMemo(() => cfg.cooldown_dias ?? 5, [cfg]);
  const templates = useMemo(() => cfg.templates || [], [cfg]);
  const semSalesbot = templates.length === 0 || !templates.some((t) => t.bot_id);
  const tplSel = useMemo(() => templates.find((t) => t.name === template) || null, [templates, template]);
  const devs = useMemo(() => data?.lista || [], [data]);

  // boletos agrupados por cpf (p/ parcelas por cliente)
  const bolByCpf = useMemo(() => {
    const m = {};
    for (const b of boletos) { const k = digits(b.customer_cpf); (m[k] = m[k] || []).push(b); }
    return m;
  }, [boletos]);

  // KPIs
  const emAberto = useMemo(() => devs.reduce((s, d) => s + (Number(d.total_em_aberto) || 0), 0), [devs]);
  const maiorAtraso = useMemo(() => devs.reduce((m, d) => Math.max(m, Number(d.maior_atraso_dias) || 0), 0), [devs]);
  // recuperado / enviados / pagos nos últimos 90d num único passe sobre `metrics`
  const stats90 = useMemo(() => {
    let recuperado = 0, enviados = 0, pagos = 0;
    for (const r of metrics) {
      if (r.resultado !== 'enfileirado') continue;
      enviados++;
      if (r.pago && Number(r.dias_ate_pagamento) <= janela) { pagos++; recuperado += Number(r.total_em_aberto_no_disparo) || 0; }
    }
    return { recuperado, enviados, pagos };
  }, [metrics, janela]);

  // aging buckets (por devedor)
  const aging = useMemo(() => FAIXAS.map((f) => {
    const ds = devs.filter((d) => faixaDe(Number(d.maior_atraso_dias) || 0) === f.key);
    return { ...f, clientes: ds.length, valor: ds.reduce((s, d) => s + (Number(d.total_em_aberto) || 0), 0) };
  }), [devs]);
  const agMax = Math.max(1, ...aging.map((a) => a.valor));
  // (#35) clientes que entraram em atraso nos ultimos 7 dias
  const novosAtrasos = useMemo(() => devs.filter((d) => { const x = Number(d.maior_atraso_dias) || 0; return x > 0 && x <= 7; }).length, [devs]);
  // (#36) negativados (boleto em DUNNING) — nao disparam (Serasa)
  const negativadosCpfs = useMemo(() => { const s = new Set(); for (const b of boletos) if (b.status === 'DUNNING_REQUESTED') s.add(digits(b.customer_cpf)); return s; }, [boletos]);

  // ranking de eficácia por template (memoizado)
  const ranking = useMemo(() => {
    const m = {};
    for (const r of metrics) {
      if (r.resultado !== 'enfileirado') continue;
      const k = r.template_name || '—';
      m[k] = m[k] || { template: k, enviados: 0, pagos: 0 };
      m[k].enviados++;
      if (r.pago && Number(r.dias_ate_pagamento) <= janela) m[k].pagos++;
    }
    return Object.values(m).map((x) => ({ ...x, taxa: x.enviados ? Math.round((x.pagos / x.enviados) * 100) : 0 })).sort((a, b) => b.taxa - a.taxa);
  }, [metrics, janela]);
  const efDe = (name) => ranking.find((x) => x.template === name)?.taxa;

  // devedores filtrados pela faixa (lista COMPLETA, sem paginação)
  const devsFiltrados = useMemo(() => {
    const hoje = new Date();
    return devs.filter((d) => {
      if (filtro && faixaDe(Number(d.maior_atraso_dias) || 0) !== filtro) return false;
      if (fLead === 'sem' && d.match_source !== 'sem_lead') return false;   // (#9) só sem lead (manual)
      if (fLead === 'com' && d.match_source === 'sem_lead') return false;   // (#9) só com lead
      if (fCob === 'todos') return true;
      const ult = d.ultimo_disparo_em ? Math.floor((hoje - new Date(d.ultimo_disparo_em)) / 86400000) : null;
      if (fCob === 'nunca') return ult == null;
      if (fCob === 'cobrado') return ult != null;
      return ult != null && ult >= Number(fCob); // cobrado há +N dias (passou do cooldown)
    });
  }, [devs, filtro, fCob, fLead]);
  // boletos filtrados + ordenados por vencimento (mais atrasado primeiro)
  const boletosFiltrados = useMemo(() => {
    const hoje = new Date();
    const arr = [];
    for (const b of boletos) {
      const dd = Math.floor((hoje - new Date(b.due_date)) / 86400000);
      const isNeg = b.status === 'DUNNING_REQUESTED';
      if (!filtro || faixaDe(isNeg ? Math.max(dd, 91) : dd) === filtro) arr.push({ b, dd });
    }
    return arr.sort((x, y) => (x.b.due_date || '').localeCompare(y.b.due_date || ''));
  }, [boletos, filtro]);

  // mapa cpf -> devedor (p/ elegibilidade na lista de boletos)
  const devByCpf = useMemo(() => { const m = {}; for (const d of devs) m[digits(d.cpf)] = d; return m; }, [devs]);
  const elegivelCpf = useCallback((cpf) => { const d = devByCpf[cpf]; return !!(d && d.elegivel); }, [devByCpf]);

  const toggle = useCallback((cpf) => setSel((s) => { const n = new Set(s); n.has(cpf) ? n.delete(cpf) : n.add(cpf); return n; }), []);
  const toggleExpand = useCallback((cpf) => setExpand((s) => { const n = new Set(s); n.has(cpf) ? n.delete(cpf) : n.add(cpf); return n; }), []);
  const selCount = sel.size;
  const elegSel = useMemo(() => [...sel].filter((c) => elegivelCpf(c)).length, [sel, elegivelCpf]);

  // cpfs acionáveis visíveis no recorte atual (faixa + visão)
  const cpfsAcionaveis = useMemo(() => {
    const base = view === 'boletos' ? boletosFiltrados.map((x) => digits(x.b.customer_cpf)) : devsFiltrados.map((d) => digits(d.cpf));
    return base.filter((c) => elegivelCpf(c));
  }, [view, boletosFiltrados, devsFiltrados, elegivelCpf]);

  const selecionarAcionaveisVisiveis = useCallback(() => {
    setSel((s) => {
      const todos = cpfsAcionaveis.length > 0 && cpfsAcionaveis.every((c) => s.has(c));
      const n = new Set(s); cpfsAcionaveis.forEach((c) => todos ? n.delete(c) : n.add(c)); return n;
    });
  }, [cpfsAcionaveis]);
  const allState = useMemo(() => {
    if (!cpfsAcionaveis.length) return false;
    const on = cpfsAcionaveis.filter((c) => sel.has(c)).length;
    return on === 0 ? false : (on === cpfsAcionaveis.length ? true : 'mixed');
  }, [cpfsAcionaveis, sel]);

  // (#11) "Cobrar hoje": todos os devedores elegíveis (com lead, fora do cooldown, sem
  // "não perturbe"), ignorando o filtro de faixa — pré-seleção do lote do dia para revisar.
  const acionaveisHoje = useMemo(() => devs.filter((d) => d.elegivel).map((d) => digits(d.cpf)), [devs]);
  const selecionarHoje = useCallback(() => {
    setSel(new Set(acionaveisHoje));
    flash(acionaveisHoje.length ? `🎯 ${acionaveisHoje.length} devedor(es) de hoje selecionados` : 'Nenhum devedor elegível hoje.');
  }, [acionaveisHoje, flash]);

  const copy = useCallback(async (txt, msg) => {
    if (!txt) { flash('Sem dado para copiar.'); return; }
    try { await navigator.clipboard.writeText(txt); flash(msg); } catch { flash('Copie manualmente: ' + txt.slice(0, 40) + '…'); }
  }, [flash]);
  const abrir = useCallback((b) => { const u = b.invoice_url || b.bank_slip_url; if (u) window.open(u, '_blank', 'noopener'); else flash('Boleto sem link.'); }, [flash]);
  const kommo = useCallback((leadId) => {
    if (!leadId) { flash('Cliente sem lead vinculado no Kommo.'); return; }
    window.open(`${KOMMO_BASE}${leadId}`, '_blank', 'noopener');
  }, [flash]);
  const optout = useCallback(async (cpf, on, nome) => {
    try {
      await callFn('cobranca-optout', { cpf, on });
      flash(on ? `🔕 ${nome || 'Cliente'} marcado como não perturbe` : `🔔 ${nome || 'Cliente'} volta a receber cobrança`);
      await load();
    } catch (e) { flash('Erro: ' + e.message); }
  }, [flash, load]);
  const checarPagamentos = useCallback(async () => {
    setChecando(true);
    try {
      const j = await callFn('cobranca-conciliar-now', {});
      flash(j.recuperados ? `✓ ${j.recuperados} pagamento(s) reconhecido(s) como recuperação` : 'Nenhum pagamento novo encontrado.');
      if (j.recuperados) { await load(); await loadMetrics(); }
    } catch (e) { flash('Erro: ' + e.message); }
    setChecando(false);
  }, [flash, load, loadMetrics]);
  const setPromessa = useCallback(async (cpf, data, nome) => {
    try {
      await callFn('cobranca-promessa', { action: 'set', cpf, data: data || null, userEmail });
      flash(data ? `📅 Promessa de ${(nome || '').split(' ')[0] || 'pagamento'} salva` : 'Promessa removida');
      await loadProm();
    } catch (e) { flash('Erro: ' + e.message); }
  }, [flash, loadProm, userEmail]);

  const abrirPreview = async () => {
    if (!template) { flash('Escolha um template.'); return; }
    if (!selCount) { flash('Selecione ao menos um devedor.'); return; }
    setSending(true);
    try { setPreview(await callFn('cobranca-disparar', { template, cpfs: [...sel], dryRun: true, userEmail })); }
    catch (e) { flash(e.message); }
    setSending(false);
  };
  const confirmar = async () => {
    setSending(true);
    try {
      const j = await callFn('cobranca-disparar', { template, cpfs: [...sel], dryRun: false, userEmail });
      setPreview(null); setSel(new Set());
      flash(`✅ ${j.enfileirados} cobrança(s) enfileirada(s).`);
      await load(); await loadMetrics();
    } catch (e) { flash('Erro: ' + e.message); }
    setSending(false);
  };

  const changeView = useCallback((v) => setView(v), []);
  const changeFiltro = useCallback((k) => setFiltro((f) => f === k ? 0 : k), []);

  if (loading) return <div className="flex-1 p-8 text-center text-sm" style={{ color: 'var(--cbc-text-muted)' }}>Carregando boletos &amp; cobrança…</div>;
  if (erro) return (
    <div className="flex-1 p-6">
      <div className="rounded-xl p-4 text-sm" style={{ background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
        Não consegui carregar: {erro} <button onClick={() => { load(); loadBoletos(); }} className="ml-2 underline font-bold">tentar de novo</button>
      </div>
    </div>
  );

  const r = data?.resumo || {};
  const tendDelta = tendencia.length >= 2 ? Number(tendencia[tendencia.length - 1].total || 0) - Number(tendencia[0].total || 0) : 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
      {toast && <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[300] px-4 py-2.5 rounded-xl text-[13px] font-bold text-white shadow-lg" style={{ background: 'var(--cbc-navy-dark, #0F2035)' }}>{toast}</div>}

      {semSalesbot && (
        <div className="rounded-xl p-3 text-[12px]" style={{ background: 'var(--cbc-warning-bg, #fff7ed)', border: '1px solid var(--cbc-warning)', color: 'var(--cbc-warning)' }}>
          <b>Configuração pendente:</b> crie o Salesbot no Kommo e cadastre o <code>bot_id</code> em <code>bot_config.cobranca</code>. O pré-visualizar funciona; o envio fica bloqueado até lá.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 min-[720px]:grid-cols-4 gap-2.5">
        <Kpi titulo="Em aberto" cor="var(--cbc-danger)" v={<MoneyValue value={emAberto} />} d={`${r.total ?? devs.length} inadimplentes`} lead />
        <Kpi titulo="Acionáveis" cor="var(--cbc-success)" v={r.elegiveis ?? 0} d={`${(r.total || 0) - (r.elegiveis || 0)} sem lead`} />
        <Kpi titulo="Maior atraso" cor="var(--cbc-text-primary)" v={`${maiorAtraso} d`} d="por devedor" />
        <Kpi titulo="Recuperado 90d" cor="var(--cbc-success)" v={<MoneyValue value={stats90.recuperado} />} d={`${stats90.pagos}/${stats90.enviados} pagos`} />
      </div>

      {/* (cobranca 06/07) Saúde do ENVIO AUTOMÁTICO do boleto (link + PIX) pelo bot */}
      {autoEnvio && autoEnvio.total > 0 && (() => {
        const ok = autoEnvio.erros === 0;
        return (
          <div className="rounded-xl p-3 flex items-center gap-3 text-[12.5px]"
            style={{ background: ok ? 'var(--cbc-success-bg)' : 'var(--cbc-warning-bg)', border: `1px solid ${ok ? 'var(--cbc-success-border)' : 'var(--cbc-warning-border)'}` }}>
            <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">{ok ? '✅' : '⚠️'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold" style={{ color: ok ? 'var(--cbc-success)' : 'var(--cbc-warning)' }}>
                Envio automático de boleto {ok ? '— funcionando' : '— com erros'}
              </div>
              <div style={{ color: 'var(--cbc-text-secondary)' }}>
                Últimos {autoEnvio.dias} dias: <b>{autoEnvio.entregues}</b> entregue{autoEnvio.entregues === 1 ? '' : 's'} pelo bot · <b>{autoEnvio.erros}</b> com erro{autoEnvio.pendentes ? ` · ${autoEnvio.pendentes} na fila` : ''}
                {autoEnvio.ultimo_erro ? <span title={String(autoEnvio.ultimo_erro)}> — último erro: {String(autoEnvio.ultimo_erro).slice(0, 70)}</span> : ''}
              </div>
            </div>
            {!ok && onVerHistorico && (
              <button onClick={onVerHistorico} className="text-[11px] font-bold px-2.5 py-1 rounded-md cursor-pointer shrink-0 whitespace-nowrap text-white"
                style={{ background: 'var(--cbc-warning)' }} title="Ver as cobranças que falharam e reenviar (aba Histórico de Cobrança)">
                Ver falhas →
              </button>
            )}
            <button onClick={loadAutoEnvio} className="text-[11px] font-bold px-2 py-1 rounded-md cursor-pointer shrink-0"
              style={{ color: 'var(--cbc-text-secondary)', border: '1px solid var(--cbc-border)' }} title="Atualizar">↻</button>
          </div>
        );
      })()}

      {/* Saúde / aging (filtra) */}
      <div className="rounded-xl overflow-hidden grid grid-cols-2 min-[720px]:grid-cols-4" style={{ border: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-card,#fff)' }}>
        {aging.map((a, i) => (
          <button key={a.key} onClick={() => changeFiltro(a.key)} aria-pressed={filtro === a.key}
            className="text-left p-3 cursor-pointer transition-colors relative"
            style={{ borderRight: i < 3 ? '1px solid var(--cbc-border)' : 'none', background: filtro === a.key ? 'var(--cbc-bg-subtle,#f1f5f9)' : 'transparent' }}>
            <div className="text-[11.5px] font-bold flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: a.cor }} />{a.label}</div>
            <div className="flex justify-between items-baseline mt-1.5"><b className="text-[15px] tabular-nums"><MoneyValue value={a.valor} /></b><span className="text-[10.5px]" style={{ color: 'var(--cbc-text-muted)' }}>{a.clientes} clientes</span></div>
            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--cbc-border)' }}><i className="block h-full rounded-full" style={{ width: `${Math.round((a.valor / agMax) * 100)}%`, background: a.cor }} /></div>
            {filtro === a.key && <span className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: 'var(--cbc-navy)' }} />}
          </button>
        ))}
      </div>

      {/* (#35/#36) alertas: novos atrasos da semana + negativados */}
      {(novosAtrasos > 0 || negativadosCpfs.size > 0) && (
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          {novosAtrasos > 0 && <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold" style={{ background: 'var(--cbc-warning-bg,#fdf3e6)', color: 'var(--cbc-warning)' }}>⚠ {novosAtrasos} entraram em atraso esta semana</span>}
          {negativadosCpfs.size > 0 && <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold" style={{ background: 'var(--cbc-danger-bg,#fef2f2)', color: 'var(--cbc-danger)' }}>⛔ {negativadosCpfs.size} negativado(s) · não dispara (Serasa)</span>}
        </div>
      )}

      {/* (#31) tendência da inadimplência (inadimplencia_historico) */}
      {tendencia.length >= 2 && (
        <div className="rounded-xl px-4 py-3" style={{ background: 'var(--cbc-bg-card,#fff)', border: '1px solid var(--cbc-border)' }}>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>Tendência da inadimplência · {tendencia.length} dias</span>
            <span className="text-[11.5px] font-bold tabular-nums inline-flex items-center gap-1" style={{ color: tendDelta > 0 ? 'var(--cbc-danger)' : tendDelta < 0 ? 'var(--cbc-success)' : 'var(--cbc-text-muted)' }}>{tendDelta > 0 ? '▲' : tendDelta < 0 ? '▼' : '•'} <MoneyValue value={Math.abs(tendDelta)} /></span>
          </div>
          <Sparkline pts={tendencia} />
        </div>
      )}

      {/* corpo: trabalho + trilho */}
      <div className="flex flex-col min-[1024px]:flex-row gap-3.5 items-start">
        <div className="flex-1 min-w-0 w-full space-y-3">
          {/* toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg p-0.5 gap-0.5" style={{ border: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-card,#fff)' }}>
              {[['cliente', 'Por cliente'], ['boletos', 'Boletos em aberto'], ['estagio', 'Estágios']].map(([k, l]) => (
                <button key={k} onClick={() => changeView(k)} aria-pressed={view === k}
                  className="px-3 py-1.5 text-[12px] font-bold rounded-md cursor-pointer transition-colors"
                  style={{ background: view === k ? 'var(--cbc-navy)' : 'transparent', color: view === k ? '#fff' : 'var(--cbc-text-muted)' }}>{l}</button>
              ))}
            </div>
            {view !== 'estagio' && acionaveisHoje.length > 0 && (
              <button onClick={selecionarHoje}
                title="Seleciona todos os devedores prontos para cobrar hoje (com lead, fora do cooldown, sem 'não perturbe') — ignora o filtro de faixa."
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[11.5px] font-bold rounded-lg cursor-pointer text-white shadow-sm"
                style={{ background: 'var(--cbc-gold,#C9A84C)' }}>
                🎯 Cobrar hoje ({acionaveisHoje.length})
              </button>
            )}
            {view !== 'estagio' && (
              <select value={fCob} onChange={(e) => setFCob(e.target.value)} title="Filtrar por situação de cobrança"
                className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold cursor-pointer" style={{ border: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-card,#fff)', color: 'var(--cbc-text-secondary)' }}>
                <option value="todos">Cobrança: todos</option>
                <option value="nunca">Nunca cobrado</option>
                <option value="cobrado">Já cobrado</option>
                <option value="7">Cobrado há +7d</option>
                <option value="15">Cobrado há +15d</option>
                <option value="30">Cobrado há +30d</option>
              </select>
            )}
            {view !== 'estagio' && (
              <select value={fLead} onChange={(e) => setFLead(e.target.value)} title="Filtrar por vínculo com lead no Kommo (sem lead = envio manual pelo Anderson)"
                className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold cursor-pointer" style={{ border: '1px solid var(--cbc-border)', background: 'var(--cbc-bg-card,#fff)', color: 'var(--cbc-text-secondary)' }}>
                <option value="todos">Vínculo: todos</option>
                <option value="com">Com lead (automático)</option>
                <option value="sem">Sem lead (manual)</option>
              </select>
            )}
            <span className="text-[12px] ml-auto" style={{ color: 'var(--cbc-text-muted)' }}>
              {filtro ? <>Faixa <b style={{ color: 'var(--cbc-navy)' }}>{FAIXAS[filtro - 1].label}</b></> : 'Todos os inadimplentes'}{fCob !== 'todos' ? <> · <b style={{ color: 'var(--cbc-navy)' }}>{fCob === 'nunca' ? 'nunca cobrado' : fCob === 'cobrado' ? 'já cobrado' : `cobrado há +${fCob}d`}</b></> : ''}
            </span>
            {view !== 'estagio' && (
              <button onClick={selecionarAcionaveisVisiveis} className="px-3 py-1.5 text-[11px] font-bold uppercase rounded-lg cursor-pointer border" style={{ borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}>
                {allState === true ? 'Limpar seleção' : 'Selecionar acionáveis'}
              </button>
            )}
            <button onClick={checarPagamentos} disabled={checando} title="Reconcilia agora os boletos pagos com as cobranças, sem esperar o cron de 12h."
              className="px-3 py-1.5 text-[11px] font-bold uppercase rounded-lg cursor-pointer border disabled:opacity-50" style={{ borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}>
              {checando ? 'Checando…' : '↺ Checar pagamentos'}
            </button>
          </div>

          {view === 'cliente' && <PorCliente {...{ devsFiltrados, bolByCpf, sel, toggle, expand, toggleExpand, allState, selecionarAcionaveisVisiveis, copy, abrir, kommo, optout, cooldown, promById, setPromessa }} />}
          {view === 'boletos' && <TodosBoletos {...{ boletosFiltrados, sel, toggle, elegivelCpf, allState, selecionarAcionaveisVisiveis, copy, abrir }} />}
          {view === 'estagio' && <Estagios {...{ devs, templates, setSel, flash, changeView }} />}

          {ranking.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'var(--cbc-bg-card,#fff)', border: '1px solid var(--cbc-border)' }}>
              <div className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--cbc-text-secondary)' }}>Eficácia por template (90 dias)</div>
              {ranking.map((x) => (
                <div key={x.template} className="flex items-center gap-2 text-[12px] py-0.5">
                  <span className="font-bold w-28 truncate" style={{ color: 'var(--cbc-text-primary)' }}>{x.template}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--cbc-border)' }}><i className="block h-full rounded-full" style={{ width: `${x.taxa}%`, background: x.taxa >= 40 ? 'var(--cbc-success)' : 'var(--cbc-warning)' }} /></div>
                  <span className="w-10 text-right font-bold tabular-nums">{x.taxa}%</span>
                  <span className="w-20 text-right" style={{ color: 'var(--cbc-text-muted)' }}>{x.pagos}/{x.enviados}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* trilho cobrança */}
        <aside className="w-full min-[1024px]:w-[320px] min-[1024px]:sticky min-[1024px]:top-2 shrink-0">
          <div className="rounded-xl p-4" style={{ background: 'var(--cbc-bg-card,#fff)', border: '1px solid var(--cbc-border)' }}>
            <div className="text-[14px] font-bold" style={{ color: 'var(--cbc-text-primary)' }}>Cobrar</div>
            <div className="text-[12px] mb-3" style={{ color: 'var(--cbc-text-muted)' }}><b>{selCount}</b> selecionados · WhatsApp via Kommo</div>
            <div className="space-y-1.5 mb-3">
              {templates.length === 0 && <div className="text-[12px]" style={{ color: 'var(--cbc-text-muted)' }}>Nenhum template em bot_config.cobranca.</div>}
              {templates.map((t) => {
                const ef = efDe(t.name);
                return (
                  <button key={t.name} onClick={() => setTemplate(t.name)} aria-checked={template === t.name} role="radio"
                    className="w-full text-left rounded-lg p-2.5 cursor-pointer transition-colors"
                    style={{ border: `1px solid ${template === t.name ? 'var(--cbc-navy)' : 'var(--cbc-border)'}`, background: template === t.name ? 'var(--cbc-bg-subtle,#f4f8fd)' : 'transparent' }}>
                    <div className="text-[12.5px] font-bold flex items-center gap-2" style={{ color: 'var(--cbc-text-primary)' }}>
                      {t.label || t.name}
                      {!t.bot_id && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--cbc-warning-bg,#fff7ed)', color: 'var(--cbc-warning)' }}>sem bot</span>}
                      {ef != null && <span className="ml-auto text-[11px] font-bold" style={{ color: ef >= 40 ? 'var(--cbc-success)' : 'var(--cbc-warning)' }}>{ef}%</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            {tplSel?.corpo && (
              <div className="rounded-lg p-2.5 text-[11.5px] mb-3 whitespace-pre-wrap" style={{ background: 'var(--cbc-navy-dark,#0F2035)', color: '#E9F0F8', lineHeight: 1.5 }}>
                <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--cbc-gold,#C9A84C)' }}>Prévia · {tplSel.name}</div>
                {tplSel.corpo}
                {Array.isArray(tplSel.botoes) && tplSel.botoes.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-2">{tplSel.botoes.map((b) => <span key={b} className="text-[9.5px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,.12)' }}>{b}</span>)}</div>
                )}
              </div>
            )}
            <button onClick={abrirPreview} disabled={sending || !selCount}
              className="w-full py-2.5 text-[13px] font-bold rounded-lg cursor-pointer text-white disabled:opacity-40" style={{ background: 'var(--cbc-navy)' }}>
              {selCount ? `Cobrar ${elegSel} de ${selCount}` : 'Selecione devedores'}
            </button>
            <div className="text-[11px] mt-2.5 p-2 rounded-lg flex gap-2" style={{ background: 'var(--cbc-info-bg,#eff4ff)', color: 'var(--cbc-text-muted)' }}>
              <span>Ao tocar <b>“Boleto atualizado”</b> ou <b>“Falar com Financeiro”</b>, o bot avisa o <b>Anderson</b>.</span>
            </div>
          </div>
        </aside>
      </div>

      {/* modal preview/confirmar */}
      {preview && (
        <div className="fixed inset-0 modal-backdrop-glass z-[250] flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="modal-glass rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-3" style={{ color: 'var(--cbc-text-primary)' }}>Confirmar cobrança</h3>
            <p className="text-[13px] mb-2" style={{ color: 'var(--cbc-text-secondary)' }}>Template: <b>{tplSel?.label || template}</b></p>
            <div className="rounded-lg p-3 text-[13px] mb-3" style={{ background: 'var(--cbc-bg-subtle,#f8fafc)' }}>
              <div>✅ Vão receber: <b style={{ color: 'var(--cbc-success)' }}>{preview.preview?.enviar ?? 0}</b></div>
              {Object.entries(preview.preview?.pulados || {}).map(([m, n]) => (
                <div key={m} style={{ color: 'var(--cbc-text-muted)' }}>↷ Pulados ({MOTIVO[m] || m}): {n}</div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPreview(null)} className="px-4 py-1.5 text-[12px] font-bold uppercase rounded-lg border cursor-pointer" style={{ borderColor: 'var(--cbc-border)', color: 'var(--cbc-text-secondary)' }}>Cancelar</button>
              <button onClick={confirmar} disabled={sending || (preview.preview?.enviar ?? 0) === 0}
                className="px-4 py-1.5 text-[12px] font-bold uppercase rounded-lg cursor-pointer text-white disabled:opacity-40" style={{ background: 'var(--cbc-navy)' }}>
                {sending ? 'Enviando…' : `Disparar ${preview.preview?.enviar ?? 0}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- subcomponentes ---------- */
function Kpi({ titulo, v, d, cor, lead }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: 'var(--cbc-bg-card,#fff)', border: `1px solid ${lead ? '#E7CFA0' : 'var(--cbc-border)'}` }}>
      <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>{titulo}</div>
      <div className="text-[22px] font-bold tabular-nums leading-tight mt-0.5" style={{ color: cor }}>{v}</div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>{d}</div>
    </div>
  );
}

function Sparkline({ pts }) {
  if (!pts || pts.length < 2) return null;
  const vals = pts.map((p) => Number(p.total) || 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 600, H = 44, range = (max - min) || 1;
  const px = (i) => (i / (pts.length - 1)) * W;
  const py = (v) => H - 2 - ((v - min) / range) * (H - 4);
  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="var(--cbc-danger)" opacity="0.07" />
      <path d={line} fill="none" stroke="var(--cbc-danger)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Chk({ state, disabled, onClick, label }) {
  const on = state === true, mixed = state === 'mixed';
  return (
    <button type="button" role="checkbox" aria-checked={mixed ? 'mixed' : on} aria-label={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-[17px] h-[17px] rounded shrink-0 relative cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ border: `1.5px solid ${on || mixed ? 'var(--cbc-navy)' : 'var(--cbc-border-strong,#cbd5e1)'}`, background: on || mixed ? 'var(--cbc-navy)' : '#fff' }}>
      {on && <span className="absolute" style={{ left: 5, top: 1.5, width: 4, height: 9, border: 'solid #fff', borderWidth: '0 2px 2px 0', transform: 'rotate(45deg)' }} />}
      {mixed && <span className="absolute" style={{ left: 3, top: 7, width: 9, height: 0, borderTop: '2px solid #fff' }} />}
    </button>
  );
}

function VincPill({ d }) {
  const m = MATCH[d.match_source] || MATCH.sem_lead;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap" style={{ background: 'var(--cbc-bg-subtle,#f1f5f9)', color: m.c }}>{m.l}</span>;
}
function CopyActions({ b, copy, abrir }) {
  const link = b.invoice_url || b.bank_slip_url;
  const nome = (b.customer_name || '').split(' ')[0];
  return (
    <span className="flex gap-1 justify-end">
      <button onClick={(e) => { e.stopPropagation(); copy(link, `🔗 Link de ${nome} copiado`); }} disabled={!link} className="text-[11px] font-bold px-1.5 py-1 rounded disabled:opacity-30" style={{ color: 'var(--cbc-navy)' }}>Link</button>
      <button onClick={(e) => { e.stopPropagation(); copy(b.pix_copy_paste, `📋 PIX de ${nome} copiado`); }} disabled={!b.pix_copy_paste} className="text-[11px] font-bold px-1.5 py-1 rounded disabled:opacity-30" style={{ color: 'var(--cbc-navy)' }}>PIX</button>
      <button onClick={(e) => { e.stopPropagation(); abrir(b); }} disabled={!link} className="text-[11px] font-bold px-1.5 py-1 rounded disabled:opacity-30" style={{ color: 'var(--cbc-navy)' }}>Abrir</button>
    </span>
  );
}

/* Linha de cliente memoizada — só re-renderiza quando muda seleção/expansão dela. */
const ClienteRow = memo(function ClienteRow({ d, selected, expanded, parcels, onToggle, onToggleExpand, copy, abrir, kommo, optout, cooldown = 5, promessa, onPromessa }) {
  const cpf = digits(d.cpf);
  const optedOut = d.motivo === 'opt_out';
  const entTxt = d.ultimo_entrega === 'done' ? '✓ entregue' : d.ultimo_entrega === 'failed' ? '✗ falhou' : '⏳ na fila';
  const entCor = d.ultimo_entrega === 'done' ? 'var(--cbc-success)' : d.ultimo_entrega === 'failed' ? 'var(--cbc-danger)' : 'var(--cbc-text-muted)';
  const cobDias = d.ultimo_disparo_em ? Math.floor((new Date() - new Date(d.ultimo_disparo_em)) / 86400000) : null;
  const cobRecente = cobDias != null && cobDias < cooldown; // dentro do cooldown -> aguarde
  const parcs = useMemo(() => (parcels || []).slice().sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')), [parcels]);
  return (
    <div className="border-t" style={{ borderColor: 'var(--cbc-border)' }}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Chk state={selected} disabled={!d.elegivel} onClick={() => onToggle(cpf)} label={`Selecionar ${d.customer_name}`} />
        <button onClick={() => onToggleExpand(cpf)} className="text-[11px] w-3 cursor-pointer" style={{ color: 'var(--cbc-text-muted)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</button>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onToggleExpand(cpf)}>
          <div className="font-bold text-[13px] truncate" style={{ color: 'var(--cbc-text-primary)' }}>{d.customer_name || cpf}</div>
          <div className="text-[10.5px] flex items-center gap-1 flex-wrap" style={{ color: 'var(--cbc-text-muted)' }}>
            <span>{d.parcelas} parc. · maior atraso {d.maior_atraso_dias}d</span>
            {cobDias != null && <span style={{ color: cobRecente ? 'var(--cbc-warning)' : 'var(--cbc-text-muted)', fontWeight: cobRecente ? 700 : 400 }}>· cobrado há {cobDias}d{cobRecente ? ' · aguarde' : ''}</span>}
            {d.ultimo_disparo_em && <span style={{ color: entCor, fontWeight: 700 }}>· {entTxt}</span>}
            {!d.elegivel && d.motivo && <span>· {MOTIVO[d.motivo] || d.motivo}</span>}
            {promessa && <span style={{ color: '#1d4ed8', fontWeight: 700 }}>· 📅 promessa {fmtData(promessa.data_promessa)}</span>}
          </div>
        </div>
        <span className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => kommo(d.lead_id)} disabled={!d.lead_id} title={d.lead_id ? 'Abrir conversa no Kommo' : 'Cliente sem lead vinculado no Kommo'}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded cursor-pointer text-white disabled:opacity-30" style={{ background: '#2E7CF6' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 5.92 2 10.76c0 2.74 1.46 5.18 3.74 6.78-.13.97-.5 2.2-1.2 3.46 1.6-.3 3.1-.9 4.3-1.74.97.26 2 .4 3.16.4 5.52 0 10-3.92 10-8.9C22 5.92 17.52 2 12 2z"/></svg>
            Kommo
          </button>
          <button onClick={() => optout(cpf, !optedOut, d.customer_name)} aria-pressed={optedOut}
            title={optedOut ? 'Voltar a cobrar este cliente' : 'Marcar “não perturbe” (não recebe cobrança)'}
            className="text-[14px] leading-none px-1.5 py-1 rounded cursor-pointer">{optedOut ? '🔕' : '🔔'}</button>
        </span>
        <VincPill d={d} />
        <span className="text-right font-bold tabular-nums w-[88px]" style={{ color: 'var(--cbc-danger)' }}><MoneyValue value={d.total_em_aberto} /></span>
      </div>
      {expanded && (
        <div style={{ background: 'var(--cbc-bg-subtle,#f8fafc)', borderTop: '1px solid var(--cbc-border)' }}>
          <div className="flex items-center gap-2 py-2 text-[11.5px] border-b" style={{ paddingLeft: 52, paddingRight: 12, borderColor: 'var(--cbc-border)' }}>
            <span className="font-bold" style={{ color: 'var(--cbc-text-secondary)' }}>📅 Promessa de pagamento:</span>
            <input type="date" defaultValue={promessa ? String(promessa.data_promessa).slice(0, 10) : ''} onChange={(e) => onPromessa(cpf, e.target.value, d.customer_name)}
              className="rounded border px-2 py-0.5 text-[11.5px]" style={{ borderColor: 'var(--cbc-border)', background: '#fff' }} />
            {promessa && <button onClick={() => onPromessa(cpf, '', d.customer_name)} className="text-[11px] font-bold underline cursor-pointer" style={{ color: 'var(--cbc-text-muted)' }}>limpar</button>}
          </div>
          {parcs.length === 0 && <div className="px-12 py-2.5 text-[11.5px]" style={{ color: 'var(--cbc-text-muted)' }}>Parcelas carregam do Asaas…</div>}
          {parcs.map((b) => (
            <div key={b.id} className="flex items-center gap-3 py-2 text-[12px] border-t first:border-0" style={{ paddingLeft: 52, paddingRight: 12, borderColor: 'var(--cbc-border)' }}>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: b.status === 'DUNNING_REQUESTED' ? 'var(--cbc-warning-bg,#fff7ed)' : 'var(--cbc-danger-bg,#fef2f2)', color: b.status === 'DUNNING_REQUESTED' ? 'var(--cbc-warning)' : 'var(--cbc-danger)' }}>{fmtData(b.due_date)}</span>
              <span className="flex-1" style={{ color: 'var(--cbc-text-secondary)' }}>Parcela honorários</span>
              <span className="font-bold tabular-nums"><MoneyValue value={b.value} /></span>
              <CopyActions b={b} copy={copy} abrir={abrir} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function PorCliente({ devsFiltrados, bolByCpf, sel, toggle, expand, toggleExpand, allState, selecionarAcionaveisVisiveis, copy, abrir, kommo, optout, cooldown, promById, setPromessa }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--cbc-border)' }}>
      <div className="flex items-center gap-3 px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ background: 'var(--cbc-bg-subtle,#f8fafc)', color: 'var(--cbc-text-muted)' }}>
        <Chk state={allState} onClick={selecionarAcionaveisVisiveis} label="Selecionar acionáveis" />
        <span className="flex-1">Cliente · {devsFiltrados.length} inadimplentes</span><span>Em aberto</span>
      </div>
      {devsFiltrados.length === 0 && <div className="p-6 text-center text-[12px]" style={{ color: 'var(--cbc-text-muted)' }}>Nenhum devedor neste filtro.</div>}
      {devsFiltrados.map((d) => {
        const cpf = digits(d.cpf);
        return <ClienteRow key={cpf} d={d} selected={sel.has(cpf)} expanded={expand.has(cpf)} parcels={bolByCpf[cpf]} onToggle={toggle} onToggleExpand={toggleExpand} copy={copy} abrir={abrir} kommo={kommo} optout={optout} cooldown={cooldown} promessa={promById.get(cpf)} onPromessa={setPromessa} />;
      })}
    </div>
  );
}

const BOL_COLS = { gridTemplateColumns: '17px 1.7fr 90px 96px 64px 92px 132px' };
/* Linha de boleto memoizada. */
const BoletoRow = memo(function BoletoRow({ b, dd, selected, disabled, onToggle, copy, abrir }) {
  const cpf = digits(b.customer_cpf);
  const neg = b.status === 'DUNNING_REQUESTED';
  return (
    <div className="grid items-center gap-2 px-3 py-2.5 border-t text-[12.5px]" style={{ ...BOL_COLS, borderColor: 'var(--cbc-border)' }}>
      <Chk state={selected} disabled={disabled} onClick={() => onToggle(cpf)} label="Selecionar" />
      <div className="min-w-0"><div className="font-bold truncate" style={{ color: 'var(--cbc-text-primary)' }}>{b.customer_name || cpf}</div><div className="text-[10px]" style={{ color: neg ? 'var(--cbc-warning)' : 'var(--cbc-text-muted)' }}>{neg ? 'Em negativação' : 'Vencido'}</div></div>
      <span className="text-right font-bold tabular-nums" style={{ color: 'var(--cbc-danger)' }}><MoneyValue value={b.value} /></span>
      <span style={{ color: 'var(--cbc-text-muted)' }}>{fmtData(b.due_date)}</span>
      <span className="text-center"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: dd > 180 ? 'var(--cbc-warning-bg,#fff7ed)' : 'var(--cbc-danger-bg,#fef2f2)', color: dd > 180 ? 'var(--cbc-warning)' : 'var(--cbc-danger)' }}>{dd}d</span></span>
      <span className="text-[10.5px]" style={{ color: 'var(--cbc-text-muted)' }}>{neg ? 'negativação' : ''}</span>
      <CopyActions b={b} copy={copy} abrir={abrir} />
    </div>
  );
});

function TodosBoletos({ boletosFiltrados, sel, toggle, elegivelCpf, allState, selecionarAcionaveisVisiveis, copy, abrir }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--cbc-border)' }}>
      <div className="grid items-center gap-2 px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-wide" style={{ ...BOL_COLS, background: 'var(--cbc-bg-subtle,#f8fafc)', color: 'var(--cbc-text-muted)' }}>
        <Chk state={allState} onClick={selecionarAcionaveisVisiveis} label="Selecionar acionáveis" />
        <span>Cliente · {boletosFiltrados.length}</span><span className="text-right">Valor</span><span>Vencimento</span><span className="text-center">Atraso</span><span>Vínculo</span><span className="text-right">Ações</span>
      </div>
      {boletosFiltrados.length === 0 && <div className="p-6 text-center text-[12px]" style={{ color: 'var(--cbc-text-muted)' }}>Nenhum boleto neste filtro.</div>}
      {boletosFiltrados.map(({ b, dd }) => {
        const cpf = digits(b.customer_cpf);
        return <BoletoRow key={b.id} b={b} dd={dd} selected={sel.has(cpf)} disabled={!elegivelCpf(cpf)} onToggle={toggle} copy={copy} abrir={abrir} />;
      })}
    </div>
  );
}

const Estagios = memo(function Estagios({ devs, templates, setSel, flash, changeView }) {
  const cobrar = (cpf) => { setSel((s) => new Set(s).add(cpf)); changeView('cliente'); flash('Selecionado — confirme no trilho de Cobrança.'); };
  // agrupa por faixa uma vez e ordena cada coluna por valor em aberto (maior primeiro)
  const grupos = useMemo(() => {
    const g = { 1: [], 2: [], 3: [], 4: [] };
    for (const d of devs) g[faixaDe(Number(d.maior_atraso_dias) || 0)].push(d);
    for (const k of Object.keys(g)) g[k].sort((a, b) => (Number(b.total_em_aberto) || 0) - (Number(a.total_em_aberto) || 0));
    return g;
  }, [devs]);
  return (
    <div className="grid grid-cols-1 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-4 gap-2.5 items-start">
      {FAIXAS.map((f) => {
        const items = grupos[f.key] || [];
        const tplIdx = PADRAO_TPL[f.key]; const tpl = tplIdx != null ? templates[tplIdx] : null;
        return (
          <div key={f.key}>
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-t-xl" style={{ background: 'var(--cbc-bg-card,#fff)', border: '1px solid var(--cbc-border)' }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: f.cor }} /><b className="text-[12px]">{f.label}</b>
              <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--cbc-bg-subtle,#f1f5f9)', color: 'var(--cbc-text-muted)' }}>{items.length}</span>
            </div>
            <div className="p-2 rounded-b-xl space-y-2 min-h-[180px]" style={{ background: 'var(--cbc-bg-subtle,#f8fafc)', border: '1px solid var(--cbc-border)', borderTop: 0 }}>
              {items.length === 0 && <div className="text-[11px] text-center py-3" style={{ color: 'var(--cbc-text-muted)' }}>sem itens</div>}
              {items.map((d) => (
                <div key={digits(d.cpf)} className="rounded-lg p-2.5" style={{ background: 'var(--cbc-bg-card,#fff)', border: '1px solid var(--cbc-border)' }}>
                  <div className="text-[12px] font-bold truncate" style={{ color: 'var(--cbc-text-primary)' }}>{d.customer_name}</div>
                  <div className="text-[10.5px]" style={{ color: 'var(--cbc-text-muted)' }}>{d.maior_atraso_dias}d · <MoneyValue value={d.total_em_aberto} /> · {(MATCH[d.match_source] || MATCH.sem_lead).l}</div>
                  {tpl && d.elegivel
                    ? <button onClick={() => cobrar(digits(d.cpf))} className="w-full mt-2 py-1 text-[11px] font-bold rounded-md text-white cursor-pointer" style={{ background: f.cor }}>{tpl.name}</button>
                    : f.key === 4
                      ? <div className="mt-2 text-[10px] font-bold px-2 py-1 rounded text-center" style={{ background: 'var(--cbc-danger-bg,#fef2f2)', color: 'var(--cbc-danger)' }}>Serasa · não dispara</div>
                      : <div className="mt-2 text-[10px] px-2 py-1 rounded text-center" style={{ background: 'var(--cbc-bg-subtle,#f1f5f9)', color: 'var(--cbc-text-muted)' }}>sem lead</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
});
