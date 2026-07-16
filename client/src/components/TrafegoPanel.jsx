// (aba Trafego 14/07/2026) Trafego pago Meta dentro do sistema — campanhas,
// criativos, rankings, alertas e a ponte "do anuncio ao contrato".
// Spec: docs/superpowers/specs/2026-07-14-aba-trafego-pago-design.md
// Dados: meta_campanhas / meta_anuncios / meta_ads_diario (espelho diario) +
// meta_ads_mensal (ponte comercial). Logica pura em trafego/compute.js (testada).
// Acoes (pausar/orcamento/config): so Paulo/Bruno/Lorenza — o SERVIDOR valida
// (JWT + lista); aqui os botoes so ficam desabilitados p/ os demais (UX).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import {
  ArrowPathIcon, PauseCircleIcon, PlayCircleIcon, BanknotesIcon,
  ExclamationTriangleIcon, ArrowTopRightOnSquareIcon, BellAlertIcon,
} from '@heroicons/react/24/outline';
import { computeTrafego, computeComercialMensal, FREQ_SATURACAO } from './trafego/compute';
import { atualizarAgora, executarAcao } from './trafego/api';

const SERIF = "'Cormorant Garamond', Georgia, serif";
const TRAFEGO_ACAO_EMAILS = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com', 'lorenza@advocaciacbc.com'];

const fmtInt = (n) => (n || 0).toLocaleString('pt-BR');
const fmtBRL = (v, casas = 0) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas }));
const fmtPct = (v, casas = 1) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`);
const fmtMes = (ym) => (ym ? `${ym.slice(5)}/${ym.slice(2, 4)}` : '—');

function diaStr(d) { return d.toISOString().slice(0, 10); }
function hojeBrt() { return new Date(Date.now() - 3 * 3600 * 1000); }

const PERIODOS = [
  { key: '7d', label: '7 dias' },
  { key: '14d', label: '14 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'mes', label: 'Mês atual' },
  { key: 'mes_passado', label: 'Mês passado' },
];

function rangeDoPeriodo(key) {
  const hoje = hojeBrt();
  const fim = diaStr(hoje);
  if (key === 'mes') return { inicio: `${fim.slice(0, 7)}-01`, fim };
  if (key === 'mes_passado') {
    const m = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
    const ultimo = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 0));
    return { inicio: diaStr(m), fim: diaStr(ultimo) };
  }
  const dias = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[key] || 7;
  const ini = new Date(hoje.getTime() - (dias - 1) * 86400000);
  return { inicio: diaStr(ini), fim };
}

function DeltaBadge({ valor, invertido = false }) {
  if (valor == null) return null;
  const bom = invertido ? valor < 0 : valor > 0;
  const cor = valor === 0 ? 'var(--cbc-text-muted, #6B7280)' : bom ? 'var(--cbc-success, #16A34A)' : 'var(--cbc-danger, #DC2626)';
  return (
    <span className="text-[11px] font-bold" style={{ color: cor }}>
      {valor > 0 ? '▲' : '▼'} {Math.abs(valor).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
    </span>
  );
}

function KpiCard({ label, valor, delta, invertido, hint }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
      <span className="text-[10px] font-bold uppercase tracking-[1.2px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>{label}</span>
      <span className="leading-none" style={{ fontFamily: SERIF, fontSize: '1.9rem', fontWeight: 700, color: 'var(--cbc-text-primary, #1B3A5C)' }}>{valor}</span>
      <span className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
        <DeltaBadge valor={delta} invertido={invertido} />{hint}
      </span>
    </div>
  );
}

/** Grafico diario: barras = leads; linha = gasto (escala propria). SVG puro, tokens. */
function SerieChart({ serie }) {
  if (!serie.length) return <div className="text-[12px] py-6 text-center" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Sem dados no período.</div>;
  const W = 900; const H = 180; const pad = 8;
  const maxLeads = Math.max(...serie.map((s) => s.leads), 1);
  const maxGasto = Math.max(...serie.map((s) => s.gasto), 1);
  const bw = (W - pad * 2) / serie.length;
  const pontos = serie.map((s, i) => `${pad + i * bw + bw / 2},${H - 20 - (s.gasto / maxGasto) * (H - 40)}`).join(' ');
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 560 }} role="img" aria-label="Leads e gasto por dia">
        {serie.map((s, i) => (
          <g key={s.dia}>
            <rect x={pad + i * bw + 2} y={H - 20 - (s.leads / maxLeads) * (H - 40)} width={Math.max(bw - 4, 2)} height={(s.leads / maxLeads) * (H - 40)} rx="2"
              fill="var(--cbc-gold, #C9A84C)" opacity="0.85">
              <title>{`${s.dia}: ${s.leads} leads · ${fmtBRL(s.gasto)} · CPL ${fmtBRL(s.cpl, 2)}`}</title>
            </rect>
            {(serie.length <= 31 || i % 7 === 0) && (
              <text x={pad + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--cbc-text-muted, #9CA3AF)">{s.dia.slice(8)}</text>
            )}
          </g>
        ))}
        <polyline points={pontos} fill="none" stroke="var(--cbc-navy-light, #264A72)" strokeWidth="2" opacity="0.9" />
      </svg>
      <div className="flex gap-4 text-[10px] pt-1" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1" style={{ background: 'var(--cbc-gold, #C9A84C)' }} />Leads/dia</span>
        <span><span className="inline-block w-4 h-0.5 align-middle mr-1" style={{ background: 'var(--cbc-navy-light, #264A72)' }} />Gasto (escala própria)</span>
      </div>
    </div>
  );
}

const RANKING_TABS = [
  { key: 'ctr', label: 'Top CTR' },
  { key: 'cpl', label: 'Melhor CPL' },
  { key: 'leads', label: 'Mais leads' },
  { key: 'hook', label: 'Hook rate' },
];

export default function TrafegoPanel() {
  const { user } = useAuth() || {};
  const podeOperar = TRAFEGO_ACAO_EMAILS.includes((user?.email || '').toLowerCase());

  const [periodo, setPeriodo] = useState('7d');
  const [campanhas, setCampanhas] = useState([]);
  const [anuncios, setAnuncios] = useState([]);
  const [diario, setDiario] = useState([]);
  const [mensal, setMensal] = useState([]);
  const [videochamadas, setVideochamadas] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [alertCfg, setAlertCfg] = useState(null);
  const [ultimoSync, setUltimoSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [mostrarPausadas, setMostrarPausadas] = useState(false);
  const [rankTab, setRankTab] = useState('ctr');
  const [modalOrcamento, setModalOrcamento] = useState(null); // campanha em edicao
  const [valorOrcamento, setValorOrcamento] = useState('');
  const [confirmacao, setConfirmacao] = useState(null); // { acao, campanha }
  const [executando, setExecutando] = useState(false);

  const fetchData = useCallback(async () => {
    setErr('');
    try {
      const corte = diaStr(new Date(Date.now() - 200 * 86400000));
      const [camp, ads, dia, men, vc, ctr, cfg] = await Promise.all([
        supabase.from('meta_campanhas').select('*').order('nome'),
        supabase.from('meta_anuncios').select('ad_id, campaign_id, nome, status, thumbnail_url, permalink'),
        supabase.from('meta_ads_diario').select('dia, level, entity_id, campaign_id, gasto, conversas_iniciadas, leads_form, impressoes, alcance, cliques, cliques_link, frequencia, video_3s').gte('dia', corte).limit(50000),
        supabase.from('meta_ads_mensal').select('mes, conversas_iniciadas, leads_form, gasto'),
        supabase.from('vw_funil_videochamadas').select('status, scheduled_at'),
        supabase.from('contratos').select('id, status, zapsign_sent_at, signed_at, advbox_date, updated_at, arquivado_em').order('created_at', { ascending: false }).limit(20000),
        supabase.from('bot_config').select('value').eq('key', 'meta_trafego').maybeSingle(),
      ]);
      setCampanhas(camp.data || []);
      setAnuncios(ads.data || []);
      setDiario(dia.data || []);
      setMensal(men.data || []);
      setVideochamadas(vc.data || []);
      setContratos(ctr.data || []);
      setAlertCfg({ ativo: true, cpl_mult: 2, cpl_gasto_min_dia: 100, queda_leads_pct: 50, ...(cfg.data?.value?.alertas || {}) });
      const maxSync = (dia.data || []).reduce((m, r) => (r.synced_at > m ? r.synced_at : m), '') || null;
      setUltimoSync(maxSync);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const range = useMemo(() => rangeDoPeriodo(periodo), [periodo]);
  const t = useMemo(
    () => computeTrafego({ diario, campanhas, anuncios, inicio: range.inicio, fim: range.fim }),
    [diario, campanhas, anuncios, range]
  );
  const comercial = useMemo(
    () => computeComercialMensal({ mensal, videochamadas, contratos, meses: 6 }),
    [mensal, videochamadas, contratos]
  );

  const campanhasVisiveis = useMemo(
    () => t.campanhas.filter((c) => mostrarPausadas || c.status === 'ACTIVE' || c.gasto > 0),
    [t.campanhas, mostrarPausadas]
  );

  const handleAtualizar = async () => {
    setRefreshing(true); setMsg('');
    try {
      const r = await atualizarAgora();
      setMsg(`Atualizado: ${r.diario} linha(s) do dia sincronizadas.`);
      await fetchData();
    } catch (e) { setErr(`Atualizar falhou: ${e.message}`); }
    finally { setRefreshing(false); setTimeout(() => setMsg(''), 5000); }
  };

  const handleAcao = async () => {
    if (!confirmacao) return;
    setExecutando(true); setErr('');
    try {
      const { acao, campanha, valor } = confirmacao;
      await executarAcao({ acao, campaign_id: campanha.campaign_id, valor });
      setMsg(`Feito: ${acao} em "${campanha.nome}".`);
      setConfirmacao(null); setModalOrcamento(null);
      await fetchData();
    } catch (e) { setErr(`Ação falhou: ${e.message}`); }
    finally { setExecutando(false); setTimeout(() => setMsg(''), 6000); }
  };

  const salvarAlertas = async () => {
    setExecutando(true); setErr('');
    try {
      await executarAcao({ acao: 'config', alertas: alertCfg });
      setMsg('Limites de alerta salvos.');
    } catch (e) { setErr(`Salvar config falhou: ${e.message}`); }
    finally { setExecutando(false); setTimeout(() => setMsg(''), 5000); }
  };

  if (loading) {
    return <div className="h-full grid place-items-center" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
      <span className="text-sm font-bold uppercase tracking-wide animate-pulse">Carregando tráfego…</span>
    </div>;
  }

  const semDados = !diario.length;

  // (fix scroll 15/07) raiz com h-full (receita do Dashboard): dentro do
  // TabScrollContainer (div block com overflow-hidden), flex-1 e inerte e o
  // painel crescia junto com o conteudo — clipava sem rolar.
  return (
    <div className="h-full overflow-y-auto page-enter" style={{ background: 'var(--cbc-bg, #F0F4F8)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 flex flex-col gap-6">

        {/* Cabecalho */}
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 style={{ fontFamily: SERIF, fontSize: '2.4rem', fontWeight: 700, lineHeight: 1, color: 'var(--cbc-text-primary, #1B3A5C)' }}>Tráfego</h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              Campanhas Meta (CA - CBC Distratos) · {ultimoSync ? `último sync ${new Date(ultimoSync).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'aguardando 1º sync'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {PERIODOS.map((p) => (
              <button key={p.key} onClick={() => setPeriodo(p.key)}
                className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-all btn-press"
                style={periodo === p.key
                  ? { background: 'var(--cbc-navy, #1B3A5C)', color: '#fff' }
                  : { background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                {p.label}
              </button>
            ))}
            <button onClick={handleAtualizar} disabled={refreshing}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-all btn-press"
              style={{ background: 'var(--cbc-gold, #C9A84C)', color: '#1B3A5C' }}>
              <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" /> Atualizar agora
            </button>
          </div>
        </header>

        {(err || msg) && (
          <div className="rounded-xl px-4 py-2.5 text-[13px] font-semibold"
            style={err
              ? { background: 'color-mix(in srgb, var(--cbc-danger, #DC2626) 10%, transparent)', color: 'var(--cbc-danger, #DC2626)' }
              : { background: 'color-mix(in srgb, var(--cbc-success, #16A34A) 10%, transparent)', color: 'var(--cbc-success, #15803D)' }}>
            {err || msg}
          </div>
        )}

        {semDados && (
          <div className="rounded-2xl p-6 text-[13px]" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-muted, #6B7280)' }}>
            Ainda não há métricas diárias no espelho. Clique em <strong>Atualizar agora</strong> (dia corrente) — o histórico completo chega com o backfill/cron diário.
          </div>
        )}

        {/* KPIs */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Investido" valor={fmtBRL(t.kpis.gasto)} delta={t.kpis.delta.gasto} hint="vs período anterior" />
          <KpiCard label="Leads" valor={fmtInt(t.kpis.leads)} delta={t.kpis.delta.leads} hint="conversas + forms" />
          <KpiCard label="CPL" valor={fmtBRL(t.kpis.cpl, 2)} delta={t.kpis.delta.cpl} invertido hint="custo por lead" />
          <KpiCard label="CTR" valor={fmtPct(t.kpis.ctr, 2)} delta={t.kpis.delta.ctr} hint="cliques no link" />
          <KpiCard label="CPM" valor={fmtBRL(t.kpis.cpm, 2)} hint="por mil impressões" />
          <KpiCard label="Frequência" valor={t.kpis.frequencia ? t.kpis.frequencia.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'} hint={`saturação ≥ ${FREQ_SATURACAO}`} />
        </section>

        {/* Serie diaria */}
        <section className="rounded-3xl p-5 sm:p-6" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="text-[11px] font-bold uppercase tracking-[1.5px] mb-3" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
            Dia a dia no período <span className="font-normal normal-case tracking-normal">({range.inicio.slice(8)}/{range.inicio.slice(5, 7)} a {range.fim.slice(8)}/{range.fim.slice(5, 7)})</span>
          </div>
          <SerieChart serie={t.serie} />
        </section>

        {/* Campanhas */}
        <section className="rounded-3xl overflow-hidden" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <div className="text-[11px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>Campanhas</div>
            <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              <input type="checkbox" checked={mostrarPausadas} onChange={(e) => setMostrarPausadas(e.target.checked)} /> mostrar pausadas sem gasto
            </label>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-[12.5px]" style={{ minWidth: 780 }}>
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  <th className="px-5 py-2">Campanha</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Orçamento/dia</th>
                  <th className="px-3 py-2 text-right">Gasto</th>
                  <th className="px-3 py-2 text-right">Leads</th>
                  <th className="px-3 py-2 text-right">CPL</th>
                  <th className="px-3 py-2 text-right">CTR</th>
                  <th className="px-3 py-2 text-right">Leads 7d</th>
                  <th className="px-3 py-2 text-right pr-5">Ações</th>
                </tr>
              </thead>
              <tbody>
                {campanhasVisiveis.map((c) => (
                  <tr key={c.campaign_id} style={{ borderTop: '1px solid var(--cbc-border, #E5E7EB)' }}>
                    <td className="px-5 py-2.5">
                      <div className="font-semibold flex items-center gap-2" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                        {c.nome}
                        {c.atencao && (
                          <span title={c.atencao === 'zerada' ? 'Ativa sem gasto no período' : 'CPL bem acima da média da conta'}>
                            <ExclamationTriangleIcon className="w-4 h-4" style={{ color: 'var(--cbc-warning, #D97706)' }} aria-hidden="true" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={c.status === 'ACTIVE'
                          ? { background: 'color-mix(in srgb, var(--cbc-success, #16A34A) 14%, transparent)', color: 'var(--cbc-success, #15803D)' }
                          : { background: 'var(--cbc-bg-subtle, #F3F4F6)', color: 'var(--cbc-text-muted, #6B7280)' }}>
                        {c.status === 'ACTIVE' ? 'ATIVA' : c.status === 'PAUSED' ? 'PAUSADA' : (c.status || '—')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(c.orcamento_diario)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtBRL(c.gasto)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(c.leads)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(c.cpl, 2)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(c.ctr, 2)}</td>
                    <td className="px-3 py-2.5 text-right"><DeltaBadge valor={c.tendencia7d} /></td>
                    <td className="px-3 py-2.5 pr-5">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.status === 'ACTIVE' ? (
                          <button disabled={!podeOperar} title={podeOperar ? 'Pausar campanha' : 'Só sócios + Lorenza'}
                            onClick={() => setConfirmacao({ acao: 'pausar', campanha: c })}
                            className="p-1.5 rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed btn-press"
                            style={{ border: '1px solid var(--cbc-border, #E5E7EB)' }}>
                            <PauseCircleIcon className="w-5 h-5" style={{ color: 'var(--cbc-warning, #D97706)' }} aria-hidden="true" />
                          </button>
                        ) : (
                          <button disabled={!podeOperar} title={podeOperar ? 'Reativar campanha' : 'Só sócios + Lorenza'}
                            onClick={() => setConfirmacao({ acao: 'reativar', campanha: c })}
                            className="p-1.5 rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed btn-press"
                            style={{ border: '1px solid var(--cbc-border, #E5E7EB)' }}>
                            <PlayCircleIcon className="w-5 h-5" style={{ color: 'var(--cbc-success, #16A34A)' }} aria-hidden="true" />
                          </button>
                        )}
                        <button disabled={!podeOperar} title={podeOperar ? 'Editar orçamento diário' : 'Só sócios + Lorenza'}
                          onClick={() => { setModalOrcamento(c); setValorOrcamento(c.orcamento_diario ? String(c.orcamento_diario) : ''); }}
                          className="p-1.5 rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed btn-press"
                          style={{ border: '1px solid var(--cbc-border, #E5E7EB)' }}>
                          <BanknotesIcon className="w-5 h-5" style={{ color: 'var(--cbc-navy-light, #264A72)' }} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Criativos / rankings */}
        <section className="rounded-3xl p-5 sm:p-6" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="text-[11px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>Melhores criativos</div>
            <div className="flex gap-1.5">
              {RANKING_TABS.map((r) => (
                <button key={r.key} onClick={() => setRankTab(r.key)}
                  className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide cursor-pointer btn-press"
                  style={rankTab === r.key
                    ? { background: 'var(--cbc-navy, #1B3A5C)', color: '#fff' }
                    : { background: 'var(--cbc-bg-subtle, #F3F4F6)', color: 'var(--cbc-text-muted, #6B7280)' }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {t.rankings[rankTab].length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
              Sem criativos elegíveis no período (mínimo de impressões p/ ranquear).
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {t.rankings[rankTab].map((a, i) => (
                <div key={a.ad_id} className="rounded-2xl overflow-hidden flex flex-col" style={{ border: '1px solid var(--cbc-border, #E5E7EB)' }}>
                  <div className="relative" style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)', aspectRatio: '1.91/1' }}>
                    {a.thumbnail_url
                      ? <img src={a.thumbnail_url} alt={a.nome} className="w-full h-full object-cover" loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      : null}
                    <span className="absolute top-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(15,32,53,.75)', color: '#fff' }}>#{i + 1}</span>
                    {a.saturando && (
                      <span className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--cbc-warning, #D97706)', color: '#fff' }}>saturando</span>
                    )}
                  </div>
                  <div className="p-2.5 flex flex-col gap-1 flex-1">
                    <div className="text-[11.5px] font-semibold leading-tight truncate" title={a.nome} style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{a.nome}</div>
                    <div className="text-[10.5px] tabular-nums" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                      {rankTab === 'ctr' && <>CTR <strong>{fmtPct(a.ctr, 2)}</strong> · {fmtInt(a.leads)} leads</>}
                      {rankTab === 'cpl' && <>CPL <strong>{fmtBRL(a.cpl, 2)}</strong> · {fmtInt(a.leads)} leads</>}
                      {rankTab === 'leads' && <><strong>{fmtInt(a.leads)}</strong> leads · CPL {fmtBRL(a.cpl, 2)}</>}
                      {rankTab === 'hook' && <>Hook <strong>{fmtPct(a.hookRate, 1)}</strong> · freq {a.frequencia ? a.frequencia.toFixed(1) : '—'}</>}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{fmtBRL(a.gasto)} gastos</div>
                    {a.permalink && (
                      <a href={a.permalink} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-navy-light, #264A72)' }}>
                        Ver anúncio <ArrowTopRightOnSquareIcon className="w-3 h-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Do anuncio ao contrato */}
        <section className="rounded-3xl overflow-hidden" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="px-5 py-4 text-[11px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)', borderBottom: '1px solid var(--cbc-border, #E5E7EB)' }}>
            Do anúncio ao contrato <span className="font-normal normal-case tracking-normal">(por mês-calendário; atribuição lead a lead virá com o espelho Kommo)</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-[12.5px]" style={{ minWidth: 640 }}>
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  <th className="px-5 py-2">Mês</th>
                  <th className="px-3 py-2 text-right">Leads Meta</th>
                  <th className="px-3 py-2 text-right">Videochamadas</th>
                  <th className="px-3 py-2 text-right">Enviados</th>
                  <th className="px-3 py-2 text-right">Assinados</th>
                  <th className="px-3 py-2 text-right">Investido</th>
                  <th className="px-3 py-2 text-right pr-5">Custo/assinado</th>
                </tr>
              </thead>
              <tbody>
                {comercial.map((m) => (
                  <tr key={m.mes} style={{ borderTop: '1px solid var(--cbc-border, #E5E7EB)' }}>
                    <td className="px-5 py-2 font-semibold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtMes(m.mes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(m.leads)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(m.videochamadas)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(m.enviados)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtInt(m.assinados)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(m.gasto)}</td>
                    <td className="px-3 py-2 pr-5 text-right tabular-nums font-bold" style={{ color: 'var(--cbc-gold-dark, #B8860B)' }}>{fmtBRL(m.custoPorAssinado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Alertas */}
        <section className="rounded-3xl p-5 sm:p-6 flex flex-col gap-3" style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
            <BellAlertIcon className="w-4 h-4" aria-hidden="true" /> Alertas automáticos <span className="font-normal normal-case tracking-normal">(sino + e-mail, 1×/dia por tipo)</span>
          </div>
          {alertCfg && (
            <div className="flex items-end gap-4 flex-wrap text-[12px]">
              <label className="flex items-center gap-2 font-semibold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                <input type="checkbox" checked={!!alertCfg.ativo} disabled={!podeOperar}
                  onChange={(e) => setAlertCfg({ ...alertCfg, ativo: e.target.checked })} /> Ativos
              </label>
              <label className="flex flex-col gap-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                CPL estoura acima de (× média 28d)
                <input type="number" step="0.1" min="1.1" className="input-field w-28" disabled={!podeOperar}
                  value={alertCfg.cpl_mult} onChange={(e) => setAlertCfg({ ...alertCfg, cpl_mult: Number(e.target.value) })} />
              </label>
              <label className="flex flex-col gap-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                Gasto mínimo no dia (R$)
                <input type="number" step="10" min="0" className="input-field w-28" disabled={!podeOperar}
                  value={alertCfg.cpl_gasto_min_dia} onChange={(e) => setAlertCfg({ ...alertCfg, cpl_gasto_min_dia: Number(e.target.value) })} />
              </label>
              <label className="flex flex-col gap-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                Queda de leads na semana (%)
                <input type="number" step="5" min="5" max="95" className="input-field w-28" disabled={!podeOperar}
                  value={alertCfg.queda_leads_pct} onChange={(e) => setAlertCfg({ ...alertCfg, queda_leads_pct: Number(e.target.value) })} />
              </label>
              {podeOperar && (
                <button onClick={salvarAlertas} disabled={executando}
                  className="btn-primary px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide cursor-pointer btn-press">
                  Salvar limites
                </button>
              )}
            </div>
          )}
        </section>

        <p className="text-[10px] text-center pb-2" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
          Métricas da Meta atualizam retroativamente por ~3 dias (o sync refaz D-1 a D-3). Leads = conversas iniciadas + formulários.
        </p>
      </div>

      {/* Modal de confirmacao (pausar/reativar/orcamento) */}
      {(confirmacao || modalOrcamento) && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(15,32,53,.55)' }}
          onClick={() => { if (!executando) { setConfirmacao(null); setModalOrcamento(null); } }}>
          <div className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--cbc-bg-card, #fff)' }} onClick={(e) => e.stopPropagation()}>
            {modalOrcamento && !confirmacao ? (
              <>
                <div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>Editar orçamento diário</div>
                <div className="text-[12.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  Campanha <strong>{modalOrcamento.nome}</strong> · atual: {fmtBRL(modalOrcamento.orcamento_diario)}
                </div>
                <input type="number" min="1" step="1" className="input-field" autoFocus value={valorOrcamento}
                  onChange={(e) => setValorOrcamento(e.target.value)} placeholder="Novo valor em R$/dia" />
                <div className="flex justify-end gap-2">
                  <button className="btn-outline px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer" onClick={() => setModalOrcamento(null)}>Cancelar</button>
                  <button className="btn-primary px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer"
                    disabled={!Number(valorOrcamento) || Number(valorOrcamento) < 1}
                    onClick={() => setConfirmacao({ acao: 'orcamento', campanha: modalOrcamento, valor: Number(valorOrcamento) })}>
                    Continuar
                  </button>
                </div>
              </>
            ) : confirmacao && (
              <>
                <div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>Confirmar ação na conta de anúncios</div>
                <div className="text-[13px] leading-relaxed" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                  {confirmacao.acao === 'pausar' && <>Pausar a campanha <strong>{confirmacao.campanha.nome}</strong>? Ela para de veicular imediatamente.</>}
                  {confirmacao.acao === 'reativar' && <>Reativar a campanha <strong>{confirmacao.campanha.nome}</strong>? Ela volta a gastar o orçamento diário ({fmtBRL(confirmacao.campanha.orcamento_diario)}).</>}
                  {confirmacao.acao === 'orcamento' && <>Alterar o orçamento de <strong>{confirmacao.campanha.nome}</strong>: {fmtBRL(confirmacao.campanha.orcamento_diario)} → <strong>{fmtBRL(confirmacao.valor)}</strong>/dia?</>}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>A ação é registrada (quem/quando/antes→depois) e reversível pela própria aba.</div>
                <div className="flex justify-end gap-2">
                  <button className="btn-outline px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer" disabled={executando}
                    onClick={() => { setConfirmacao(null); setModalOrcamento(null); }}>Cancelar</button>
                  <button className="btn-primary px-4 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer" disabled={executando} onClick={handleAcao}>
                    {executando ? 'Executando…' : 'Confirmar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
