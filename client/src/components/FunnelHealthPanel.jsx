// (#17) Saude do Funil — painel executivo (visivel so p/ Paulo e Bruno, gating por email
// igual ao Sócios). Mostra o funil Criados -> Enviados -> Assinados, conversoes, tempos
// medianos por etapa, gargalos (parados ha >7 dias) e a tendencia de conversao por mes.
// Token-driven (--cbc-*) p/ funcionar em light/dark; sem hex inline (evita o bug de dark
// mode quebrado flagrado na auditoria).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { computeFunnel, computeSla } from './funnel/funnelCompute';
import { fetchProcessosDistribuidos, fetchProcessosGuiaPaga, fetchVideochamadasFunil, fetchMetaAdsFunil, fetchFunilSla } from '../utils/funilSources';
import { fetchAllPaged } from '../utils/supabasePaged';
import PontualidadePanel from './PontualidadePanel';

const SERIF = "'Cormorant Garamond', Georgia, serif";
const fmtDias = (d) => (d == null ? '—' : `${(Math.round(d * 10) / 10).toLocaleString('pt-BR')} d`);
const fmtPct = (p) => `${Math.round(p)}%`;
const fmtInt = (n) => (n || 0).toLocaleString('pt-BR');
// (leads Meta 14/07/2026) moeda p/ investimento (inteiro) e custo por lead (2 casas)
const fmtBRL = (v, casas = 0) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas }));
const fmtMesCurto = (ym) => (ym ? `${ym.slice(5)}/${ym.slice(2, 4)}` : '—');

// Largura proporcional do funil com piso de 26% (p/ a barra de assinados sempre caber o rotulo)
const larguraFunil = (valor, base) => `${Math.max(16, base > 0 ? (valor / base) * 100 : 0)}%`;

function MetricTempo({ label, valor, hint }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-1"
      style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
      <span className="text-[10px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>{label}</span>
      <span className="leading-none mt-1" style={{ fontFamily: SERIF, fontSize: '2.4rem', fontWeight: 600, color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtDias(valor)}</span>
      <span className="text-[11px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{hint}</span>
    </div>
  );
}

function FunilBarra({ rotulo, valor, base, corVar, destaque }) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-28 shrink-0 text-right">
        <div className="text-[11px] font-bold uppercase tracking-[1px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>{rotulo}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="h-14 rounded-xl flex items-center px-5 transition-all duration-700 ease-out"
          style={{
            width: larguraFunil(valor, base),
            background: destaque
              ? 'linear-gradient(100deg, var(--cbc-navy, #1B3A5C), var(--cbc-gold, #C9A84C))'
              : `linear-gradient(100deg, ${corVar}, var(--cbc-navy-light, #264A72))`,
            boxShadow: '0 6px 18px -8px rgba(15,32,53,.45)',
          }}>
          <span className="text-white leading-none" style={{ fontFamily: SERIF, fontSize: '1.9rem', fontWeight: 700 }}>{fmtInt(valor)}</span>
        </div>
      </div>
    </div>
  );
}

export default function FunnelHealthPanel() {
  const [rows, setRows] = useState(null);
  const [vchamadas, setVchamadas] = useState([]); // etapas Agendada/Realizada (vw_funil_videochamadas)
  const [metaAds, setMetaAds] = useState([]);     // 1a etapa: leads de campanha (meta_ads_mensal)
  const [sla, setSla] = useState([]);             // (item 239) SLA de 1a resposta por dia (vw_funil_sla)
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      // (auditoria 01/08 — item 222) `.limit(20000)` nao levanta o teto de 1000 do
      // PostgREST; a Saude do Funil passaria a subcontar em silencio junto com o
      // Dashboard e o Trafego. Ordem TOTAL (created_at empata, id desempata).
      const data = await fetchAllPaged(() =>
        supabase
          .from('contratos')
          .select('id, nome_contratante1, resort, status, created_at, updated_at, zapsign_sent_at, signed_at, advbox_date, advbox_lawsuit_id, arquivado_em')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }));
      // (fix funil 28/07/2026) As 4 consultas vêm de utils/funilSources.js, a MESMA
      // fonte do Dashboard (antes eram cópias que já tinham divergido) e que PAGINA
      // com .range(): sem isso o PostgREST cortava em 1000 linhas e as videochamadas
      // (view com 2.883 linhas) apareciam pela metade.
      const merged = data || [];
      // (etapa "Distribuídos") data de conclusão da tarefa "DISTRIBUIR AÇÃO" por processo.
      try {
        const distSet = new Set((await fetchProcessosDistribuidos()).map((r) => String(r.lawsuit_id)));
        for (const c of merged) c.distribuido = distSet.has(String(c.advbox_lawsuit_id));
      } catch { /* etapa degrada p/ 0 se a view falhar */ }
      // (etapa "Guia Paga/JEC") processo passou da citação no ADVBOX (guia paga ou JEC).
      try {
        const gpSet = new Set((await fetchProcessosGuiaPaga()).map((r) => String(r.lawsuit_id)));
        for (const c of merged) c.guia_paga = gpSet.has(String(c.advbox_lawsuit_id));
      } catch { /* etapa degrada p/ 0 se a view falhar */ }
      try {
        setVchamadas(await fetchVideochamadasFunil());
      } catch { setVchamadas([]); }
      // (leads Meta) 1a etapa do funil — leads de campanha por mes. Tabela vazia/sem
      // permissao -> etapa some do painel (leadsMeta null), sem quebrar o resto.
      try {
        setMetaAds(await fetchMetaAdsFunil(true));
      } catch { setMetaAds([]); }
      // (auditoria 01/08 — item 239) SLA de 1a resposta: medido desde 11/07 e nunca exibido.
      // View vazia / sem permissao -> bloco some, sem quebrar o resto do painel.
      try {
        setSla(await fetchFunilSla());
      } catch { setSla([]); }
      setRows(merged);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const f = useMemo(() => (rows ? computeFunnel(rows, undefined, vchamadas, metaAds) : null), [rows, vchamadas, metaAds]);
  // (item 239) resumo do SLA de 1a resposta — logica pura, testada em funnelCompute.test.js
  const slaResumo = useMemo(() => computeSla(sla), [sla]);
  const maxConv = useMemo(() => (f ? Math.max(1, ...f.tendencia.map((t) => t.conversao)) : 1), [f]);
  // Escala ÚNICA p/ TODAS as barras do funil (leads + vídeo + contratos): largura ∝ valor, maior = 100%.
  const baseFunil = useMemo(() => (f ? Math.max(f.leadsMeta?.total || 0, f.videochamadas?.agendadas || 0, f.funil.enviados, 1) : 1), [f]);

  if (loading && !f) {
    return <div className="h-full grid place-items-center" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
      <span className="text-sm font-bold uppercase tracking-wide animate-pulse">Carregando funil…</span>
    </div>;
  }
  if (err) {
    return <div className="h-full grid place-items-center text-sm" style={{ color: 'var(--cbc-danger, #DC2626)' }}>{err}</div>;
  }

  // (fix scroll 15/07, achado via aba Trafego) raiz com h-full (receita do Dashboard):
  // dentro do TabScrollContainer (div block com overflow-hidden), flex-1 e inerte e o
  // conteudo abaixo da 1a dobra ficava CLIPADO sem rolagem.
  return (
    <div className="h-full overflow-y-auto page-enter" style={{ background: 'var(--cbc-bg, #F0F4F8)' }}>
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-7 flex flex-col gap-7">

        {/* Cabecalho editorial */}
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 style={{ fontFamily: SERIF, fontSize: '2.6rem', fontWeight: 700, lineHeight: 1, color: 'var(--cbc-text-primary, #1B3A5C)' }}>
              Saúde do Funil
            </h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              Do contrato criado à assinatura — conversão, tempos e gargalos.
            </p>
          </div>
          <button onClick={fetchData} disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-all btn-press"
            style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-primary, #1B3A5C)' }}>
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Atualizar
          </button>
        </header>

        {/* Funil + conversoes */}
        <section className="rounded-3xl p-7 sm:p-8 flex flex-col gap-5"
          style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)', boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}>
          <div className="flex flex-col gap-5">
            {/* (leads Meta 14/07/2026) 1a etapa do funil — leads das campanhas (conversas
                iniciadas + lead forms, insights mensais). Sem dados -> secao oculta. */}
            {f.leadsMeta && (
              <>
                <div className="pl-32 text-[10px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  Campanhas Meta · desde {fmtMesCurto(f.leadsMeta.desde)}
                </div>
                <FunilBarra rotulo="Leads de campanha" valor={f.leadsMeta.total} base={baseFunil} corVar="var(--cbc-gold, #C9A84C)" />
                <div className="pl-32 text-[11px] tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  {fmtBRL(f.leadsMeta.gasto)} investidos · custo por lead {fmtBRL(f.leadsMeta.cpl, 2)}
                </div>
                {f.leadsMeta.pctAgendada != null && (
                  <div className="pl-32 text-[11px] font-bold tracking-wide" style={{ color: 'var(--cbc-info, #2563EB)' }}>
                    ▼ {f.leadsMeta.pctAgendada < 1 ? `${f.leadsMeta.pctAgendada.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : fmtPct(f.leadsMeta.pctAgendada)} viram videochamada agendada
                  </div>
                )}
                {/* (auditoria — item 230) o percentual acima compara janelas iguais: so os meses
                    em que as duas fontes existem. Sem esta linha o leitor supunha que ele valia
                    para o total de leads mostrado logo acima, e a conversao parecia pior. */}
                {f.leadsMeta.janelaComparavel?.mesesIgnorados > 0 && (
                  <div className="pl-32 text-[10px] tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                    (percentual calculado de {fmtMesCurto(f.leadsMeta.janelaComparavel.desde)} em diante, quando as videochamadas passaram a ser registradas:{' '}
                    {f.leadsMeta.janelaComparavel.calls.toLocaleString('pt-BR')} de {f.leadsMeta.janelaComparavel.leads.toLocaleString('pt-BR')} leads)
                  </div>
                )}
              </>
            )}
            {/* (auditoria 01/08 — item 239) ENTRE o lead e a videochamada existe uma etapa que
                nunca apareceu no funil: alguém precisa RESPONDER o lead. O tempo até a 1ª
                resposta é medido desde 11/07 e ficava só no banco. O número que importa não é
                o tempo médio — é quantos nunca receberam resposta nenhuma. */}
            {slaResumo && (
              <>
                <div className="pl-32 text-[10px] font-bold uppercase tracking-[1.5px] pt-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                  Atendimento ao lead · desde {slaResumo.desde?.slice(8, 10)}/{slaResumo.desde?.slice(5, 7)}
                </div>
                <div className="pl-32 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[11px] tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  <span>
                    <strong style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtInt(slaResumo.atendidos)}</strong>
                    {' '}de {fmtInt(slaResumo.leads)} leads receberam resposta
                  </span>
                  {slaResumo.minutosAteResponder != null && (
                    <span>1ª resposta em <strong style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{Math.round(slaResumo.minutosAteResponder)} min</strong> (tempo médio)</span>
                  )}
                  {slaResumo.atendidos > 0 && (
                    <span>{fmtPct(slaResumo.pctEngajou)} voltaram a falar</span>
                  )}
                </div>
                {slaResumo.nuncaRespondidos > 0 && (
                  <div className="pl-32 text-[11px] font-bold tracking-wide" style={{ color: 'var(--cbc-danger, #DC2626)' }}>
                    ✕ {fmtInt(slaResumo.nuncaRespondidos)} lead{slaResumo.nuncaRespondidos > 1 ? 's' : ''} ({fmtPct(slaResumo.pctNuncaRespondidos)}) nunca recebe{slaResumo.nuncaRespondidos > 1 ? 'ram' : 'u'} resposta
                  </div>
                )}
              </>
            )}
            {/* (videochamadas) etapas do topo — Agendada/Realizada ALL-TIME (da agenda do Google). */}
            <div className="pl-32 text-[10px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              Videochamadas · total
            </div>
            <FunilBarra rotulo="Agendada" valor={f.videochamadas.agendadas} base={baseFunil} corVar="var(--cbc-info, #2563EB)" />
            {f.videochamadas.pct != null && (
              <div className="pl-32 text-[11px] font-bold tracking-wide" style={{ color: 'var(--cbc-info, #2563EB)' }}>
                ▼ {f.videochamadas.pct}% compareceram
              </div>
            )}
            <FunilBarra rotulo="Realizada" valor={f.videochamadas.realizadas} base={baseFunil} corVar="var(--cbc-info, #2563EB)" />
            {f.videochamadas.futuras > 0 && (
              <div className="pl-32 text-[11px] tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                + {f.videochamadas.futuras} agendada{f.videochamadas.futuras > 1 ? 's' : ''} para os próximos dias
              </div>
            )}
            {f.videochamadas.excluidas > 0 && (
              <div className="pl-32 text-[11px] tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                {f.videochamadas.excluidas} excluída{f.videochamadas.excluidas > 1 ? 's' : ''} da agenda · não contam
              </div>
            )}
            <div className="pl-32 text-[10px] font-bold uppercase tracking-[1.5px] pt-1" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
              Contratos
            </div>
            <FunilBarra rotulo="Contratos enviados para assinatura" valor={f.funil.enviados} base={baseFunil} corVar="var(--cbc-navy-light, #264A72)" />
            <div className="pl-32 text-[11px] font-bold tracking-wide" style={{ color: 'var(--cbc-info, #2563EB)' }}>
              ▼ {fmtPct(f.conversao.enviadoAssinado)} dos enviados assinam
            </div>
            <FunilBarra rotulo="Assinados" valor={f.funil.assinados} base={baseFunil} destaque />
            <div className="pl-32 text-[11px] font-bold tracking-wide" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              ▼ distribuídos = têm nº de processo no ADVBOX
            </div>
            <FunilBarra rotulo="Distribuídos" valor={f.distribuidos.total} base={baseFunil} corVar="var(--cbc-success, #16A34A)" />
            <div className="pl-32 text-[11px] font-bold tracking-wide" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              ▼ guia paga / JEC no ADVBOX (citação, audiência agendada ou custas pagas)
            </div>
            <FunilBarra rotulo="Guia Paga/JEC" valor={f.guiaPaga} base={baseFunil} corVar="var(--cbc-gold-dark, #B8860B)" />
            <div className="pl-32 text-[11px] tracking-wide" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
              passou da citação no ADVBOX · subconjunto dos distribuídos
            </div>
          </div>
          <div className="mt-2 pt-4 flex items-baseline gap-3" style={{ borderTop: '1px dashed var(--cbc-border, #E5E7EB)' }}>
            <span className="text-[11px] font-bold uppercase tracking-[1.5px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>Conversão total</span>
            <span style={{ fontFamily: SERIF, fontSize: '2rem', fontWeight: 700, color: 'var(--cbc-gold-text, #8A6A12)' }}>{fmtPct(f.conversao.enviadoAssinado)}</span>
            <span className="text-[12px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>enviado → assinado</span>
          </div>
        </section>

        {/* Tempos medianos por etapa */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricTempo label="Criação → Envio" valor={f.tempos.criacaoEnvioDias} hint="mediana, do cadastro ao ZapSign" />
          <MetricTempo label="Envio → Assinatura" valor={f.tempos.envioAssinaturaDias} hint="mediana, do ZapSign à assinatura" />
          <MetricTempo label="Jornada total" valor={f.tempos.jornadaTotalDias} hint="mediana, criação → assinatura" />
        </section>

        {/* Gargalo */}
        <section className="rounded-3xl overflow-hidden"
          style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="px-6 py-4 flex items-center gap-3"
            style={{ background: f.gargalo.travados > 0 ? 'color-mix(in srgb, var(--cbc-warning, #D97706) 12%, transparent)' : 'transparent', borderBottom: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0" style={{ color: 'var(--cbc-warning, #D97706)' }} aria-hidden="true" />
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
                {f.gargalo.travados > 0
                  ? `${f.gargalo.travados} contrato(s) parados há mais de ${f.gargalo.limiteDias} dias`
                  : `Nenhum contrato parado há mais de ${f.gargalo.limiteDias} dias`}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>Enviados ao ZapSign e ainda sem assinatura — bons candidatos a follow-up.</div>
            </div>
          </div>
          {f.gargalo.lista.length > 0 && (
            <ul className="divide-y" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
              {f.gargalo.lista.map((c) => (
                <li key={c.id} className="px-6 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{c.nome || '—'}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{c.resort || '—'}</div>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
                    style={{ background: 'color-mix(in srgb, var(--cbc-warning, #D97706) 16%, transparent)', color: 'var(--cbc-warning, #B45309)' }}>
                    {c.dias} dias
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Tendencia mensal de conversao */}
        <section className="rounded-3xl p-6 sm:p-7"
          style={{ background: 'var(--cbc-bg-card, #fff)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
          <div className="text-[11px] font-bold uppercase tracking-[1.5px] mb-5" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
            Conversão por mês <span className="font-normal normal-case tracking-normal">(assinados ÷ criados, por mês de criação)</span>
          </div>
          {f.tendencia.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Sem dados suficientes.</div>
          ) : (
            <div className="flex items-end justify-between gap-3 h-44">
              {f.tendencia.map((t) => (
                <div key={t.mes} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{fmtPct(t.conversao)}</span>
                  <div className="w-full rounded-t-lg transition-all duration-700 ease-out"
                    style={{ height: `${Math.max(4, (t.conversao / maxConv) * 100)}%`, background: 'linear-gradient(180deg, var(--cbc-gold, #C9A84C), var(--cbc-navy, #1B3A5C))', minHeight: 4 }} />
                  <span className="text-[10px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{t.mes.slice(5)}/{t.mes.slice(2, 4)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Pontualidade dos vendedores (este painel já é restrito a sócios) */}
        <PontualidadePanel />

        <p className="text-[10px] text-center pb-2" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
          Arquivados e cancelados ficam fora do funil. Tempos usam mediana (robusta a casos extremos).
          {f.leadsMeta && ' Leads = conversas iniciadas atribuídas às campanhas Meta (+ formulários); orgânico/indicação não entram nessa etapa.'}
        </p>
      </div>
    </div>
  );
}
