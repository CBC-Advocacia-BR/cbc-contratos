// Views da aba "Agendamento Videochamada" (bot Ana) — Métricas / Agenda / Conversas / Simulador.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { computeFunilAna, agruparAgenda } from './compute';
import { toneStyle } from '../../lib/statusTokens';
import {
  ArrowPathIcon, ArrowTopRightOnSquareIcon, ExclamationTriangleIcon, ChevronDownIcon, ChevronUpIcon,
} from '@heroicons/react/24/outline';

/* ─── estilos utilitários — só tokens --cbc-* (fallback = valor "light" do index.css) ─── */
const mutedTxt = { color: 'var(--cbc-text-muted, #5E6675)' };
const cartaoCls = 'rounded-2xl border p-4 space-y-3';
const cartaoStyle = { borderColor: 'var(--cbc-border, #E2E8F0)', background: 'var(--cbc-bg-card, #FFFFFF)' };
const campoAreaCls = 'w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40';
const campoStyle = { borderColor: 'var(--cbc-border, #E2E8F0)', background: 'var(--cbc-bg-card, #FFFFFF)', color: 'var(--cbc-text-primary, #1B3A5C)' };
const seletorCls = 'rounded-lg border px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40';
const botaoCls = 'px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40';
const linkBtnCls = 'text-[11px] font-bold uppercase tracking-wide inline-flex items-center gap-1 cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 rounded';

function Cartao({ titulo, dica, children }) {
  return (
    <div className={cartaoCls} style={cartaoStyle}>
      <div>
        <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{titulo}</h3>
        {dica && <p className="text-xs mt-0.5" style={mutedTxt}>{dica}</p>}
      </div>
      {children}
    </div>
  );
}

/** Selo de status/etapa — mesmo princípio do StatusPill (components/ui), mas sem
 *  depender de um "domain" pré-cadastrado em STATUS_TOKENS (agenda/etapa não têm um
 *  registrado; criar um só para isto extrapolaria o escopo dos 3 arquivos da Task 12). */
function Selo({ tone, children }) {
  const t = toneStyle(tone);
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
      style={{ color: t.fg, background: t.bg, border: `1px solid ${t.border}` }}>
      {children}
    </span>
  );
}

const fmtDataSP = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtHoraSP = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const fmtDataHoraSP = (iso) => `${fmtDataSP(iso)} ${fmtHoraSP(iso)}`;
// yyyy-mm-dd em America/Sao_Paulo — mesmo formato usado por agenda_bot_metricas(p_de, p_ate) e por compute.js/ymdSP.
const ymdSP = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

// ═══════════════════════════════════════════════════════════════════════════
// MetricasView
// ═══════════════════════════════════════════════════════════════════════════
const PERIODOS_METRICAS = [7, 30, 90];

function BarraFunil({ rotulo, n, pctTotal, pctAnterior, primeira }) {
  const largura = Math.min(100, Math.max(pctTotal, n > 0 ? 3 : 0));
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-32 shrink-0 truncate" title={rotulo}>{rotulo}</div>
      <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: 'var(--cbc-bg-subtle, #F7FAFC)' }}>
        <div className="h-full rounded" style={{ width: `${largura}%`, background: 'var(--cbc-navy, #1B3A5C)' }} />
      </div>
      <div className="w-10 text-right font-bold tabular-nums">{n}</div>
      <div className="w-16 text-right tabular-nums shrink-0" style={mutedTxt}>{primeira ? '—' : `${pctAnterior}% ant.`}</div>
    </div>
  );
}

function CardStat({ titulo, valor, dica }) {
  return (
    <div className={cartaoCls} style={cartaoStyle}>
      <div className="text-[10.5px] font-bold uppercase tracking-wide" style={mutedTxt}>{titulo}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{valor}</div>
      {dica && <div className="text-[11px]" style={mutedTxt}>{dica}</div>}
    </div>
  );
}

const fmtDuracao = (seg) => {
  if (!seg || seg <= 0) return '—';
  if (seg < 60) return `${Math.round(seg)}s`;
  const min = seg / 60;
  if (min < 60) return `${min.toFixed(1)} min`;
  return `${(min / 60).toFixed(1)} h`;
};

export function MetricasView() {
  const [dias, setDias] = useState(30);
  const [m, setM] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async (d) => {
    setCarregando(true); setErro('');
    const hoje = new Date();
    const pAte = ymdSP(hoje);
    const pDe = ymdSP(new Date(hoje.getTime() - (d - 1) * 86400000));
    const { data, error } = await supabase.rpc('agenda_bot_metricas', { p_de: pDe, p_ate: pAte });
    setCarregando(false);
    if (error) { setErro(error.message); return; }
    setM(data);
  }, []);

  // fetch inicial + toda troca de período via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregar(dias); }, [dias, carregar]);

  const r = useMemo(() => (m ? computeFunilAna(m) : null), [m]);
  const primeiraEtapaN = r?.etapas?.[0]?.n || 0;
  const porVendedora = useMemo(
    () => Object.entries(r?.porVendedora || {}).sort((a, b) => b[1] - a[1]),
    [r],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs" style={mutedTxt}>Funil da Ana no período (fonte: bot_conversations + agenda_videochamadas, ao vivo).</p>
        <div className="flex items-center gap-1">
          {PERIODOS_METRICAS.map((d) => (
            <button key={d} type="button" onClick={() => setDias(d)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer ${dias === d ? 'text-white' : ''}`}
              style={dias === d
                ? { background: 'var(--cbc-navy, #1B3A5C)' }
                : { background: 'var(--cbc-bg-subtle, #F7FAFC)', color: 'var(--cbc-text-secondary, #4A5568)' }}>
              {d} dias
            </button>
          ))}
          <button type="button" onClick={() => carregar(dias)} title="Atualizar" aria-label="Atualizar métricas"
            className="p-1.5 rounded-full cursor-pointer" style={{ background: 'var(--cbc-bg-subtle, #F7FAFC)' }}>
            <ArrowPathIcon className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} style={{ color: 'var(--cbc-text-secondary, #4A5568)' }} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Controller: baseline vem da análise ChatGuru (histórico), NUNCA medição ao vivo do
          "antes" — em especial a taxa de conexão pré-Ana não tem número (é estimativa). Os
          3 números abaixo (resposta/agendado/no-show) são os já documentados no design spec
          (docs/superpowers/specs/2026-07-21-...-design.md), não inventados aqui. */}
      <div className="rounded-xl border px-3 py-2 text-xs" style={{ ...mutedTxt, borderColor: 'var(--cbc-border, #E2E8F0)', background: 'var(--cbc-bg-subtle, #F7FAFC)' }}>
        A comparação <b>"antes × depois da Ana"</b> usa como referência a análise do histórico do ChatGuru (13.884 conversas, out/2023–jun/2026): 1ª resposta mediana histórica <b>6,5h</b>, <b>~38,5h</b> até "agendado", no-show histórico <b>≈24%</b> (124/511). É uma <b>baseline de contexto, não uma medição ao vivo</b> — em particular, a <b>taxa de conexão pré-Ana é uma estimativa</b> (não há "antes" medido por <code>bot_messages</code>, já que o bot não existia). Os números abaixo são medidos ao vivo, só do período pós-Ana selecionado.
      </div>

      {erro && (
        <div className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--cbc-danger, #B91C1C)' }}>
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0" aria-hidden="true" />{erro}
        </div>
      )}
      {!r && carregando && <div className="p-8 text-center text-sm animate-pulse" style={mutedTxt}>Carregando métricas…</div>}

      {r && (
        <>
          <div className={cartaoCls} style={cartaoStyle}>
            <div className="flex items-center justify-between flex-wrap gap-1">
              <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>Funil</h3>
              {r.handoffs > 0 && <span className="text-[11px]" style={mutedTxt}>{r.handoffs} handoff(s) p/ humano no período</span>}
            </div>
            {r.etapas.map((e, i) => (
              <BarraFunil key={e.chave} rotulo={e.rotulo} n={e.n} pctAnterior={e.pctDoAnterior}
                pctTotal={primeiraEtapaN > 0 ? Math.round((e.n / primeiraEtapaN) * 100) : 0} primeira={i === 0} />
            ))}
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <CardStat titulo="Taxa de agendamento" valor={`${r.taxas.agendamento}%`} dica="Agendadas / conversas iniciadas" />
            <CardStat titulo="Taxa de comparecimento" valor={`${r.taxas.comparecimento}%`} dica="Realizadas / (realizadas + no-show)" />
            <CardStat titulo="Taxa de fechamento" valor={`${r.taxas.fechamento}%`} dica="Fechou / realizadas" />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className={cartaoCls} style={cartaoStyle}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>Por vendedora</h3>
              {porVendedora.length === 0 && <p className="text-xs" style={mutedTxt}>Sem agendamentos no período.</p>}
              {porVendedora.length > 0 && (
                <table className="w-full text-xs">
                  <tbody>
                    {porVendedora.map(([email, qtd]) => (
                      <tr key={email} className="border-t first:border-t-0" style={{ borderColor: 'var(--cbc-border, #E2E8F0)' }}>
                        <td className="py-1.5 pr-2 truncate">{email}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums">{qtd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <CardStat titulo="Tempo mediano de 1ª resposta" valor={fmtDuracao(r.tempoRespostaSeg)}
              dica="Do lead à 1ª resposta da Ana, no período (pós-Ana, ao vivo)" />
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AgendaView
// ═══════════════════════════════════════════════════════════════════════════
const STATUS_TONE = { agendada: 'info', realizada: 'success', fechou: 'success', no_show: 'danger', excluida: 'neutral' };
const STATUS_LABEL = { agendada: 'Agendada', realizada: 'Realizada', fechou: 'Fechou', no_show: 'No-show', excluida: 'Cancelada' };
const SECOES_AGENDA = [['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['semana', 'Próximos dias'], ['passadas', 'Passadas']];

/** DD/MM/AAAA HH:MM (horário de Brasília) → ISO com offset fixo -03:00 — mesma premissa de
 *  amanha10hSP em agenda-admin.mjs (Brasil sem horário de verão desde 2019). */
function parseDataHoraBR(txt) {
  const m = String(txt || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:00-03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function LinhaAgenda({ linha, mostrarData, onAcao, ocupado }) {
  const tone = STATUS_TONE[linha.status] || 'neutral';
  const label = STATUS_LABEL[linha.status] || linha.status;

  const desfecho = (e) => {
    const status = e.target.value;
    e.target.value = '';
    if (!status) return;
    onAcao({ acao: 'desfecho', event_id: linha.event_id, vendedora_email: linha.vendedora_email, status });
  };

  const reagendar = () => {
    const txt = window.prompt('Novo horário (DD/MM/AAAA HH:MM, horário de Brasília):', fmtDataHoraSP(linha.scheduled_at));
    if (txt == null) return;
    const novoInicio = parseDataHoraBR(txt);
    if (!novoInicio) { window.alert('Data/hora inválida. Use o formato DD/MM/AAAA HH:MM.'); return; }
    onAcao({ acao: 'reagendar', event_id: linha.event_id, vendedora_email: linha.vendedora_email, novo_inicio: novoInicio });
  };

  const cancelar = () => {
    if (!window.confirm(`Cancelar a videochamada de ${linha.cliente_nome || 'sem nome'} (${fmtDataHoraSP(linha.scheduled_at)})?`)) return;
    onAcao({ acao: 'cancelar', event_id: linha.event_id, vendedora_email: linha.vendedora_email });
  };

  return (
    <tr className="border-t" style={{ borderColor: 'var(--cbc-border, #E2E8F0)' }}>
      <td className="py-2 pr-2 tabular-nums whitespace-nowrap">{mostrarData ? fmtDataHoraSP(linha.scheduled_at) : fmtHoraSP(linha.scheduled_at)}</td>
      <td className="py-2 pr-2">{linha.cliente_nome || <span style={mutedTxt}>sem nome</span>}</td>
      <td className="py-2 pr-2 whitespace-nowrap" style={mutedTxt}>{linha.telefone || '—'}</td>
      <td className="py-2 pr-2 whitespace-nowrap" style={mutedTxt}>{linha.vendedora_email || '—'}</td>
      <td className="py-2 pr-2 whitespace-nowrap">
        <Selo tone={tone}>{label}</Selo>{linha.origem === 'manual' && <span className="text-[10px] ml-1" style={mutedTxt}>manual</span>}
      </td>
      <td className="py-2 pr-2">
        {linha.lead_id
          ? (
            <a href={`https://advocaciacbc.kommo.com/leads/detail/${linha.lead_id}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-bold hover:opacity-80" style={{ color: 'var(--cbc-info, #1D4ED8)' }}>
              abrir lead <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )
          : <span style={mutedTxt}>—</span>}
      </td>
      <td className="py-2 pl-2">
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <select disabled={ocupado} defaultValue="" onChange={desfecho} className={seletorCls} style={campoStyle} aria-label="Marcar desfecho">
            <option value="">Desfecho ▾</option>
            <option value="realizada">Realizada</option>
            <option value="no_show">No-show</option>
            <option value="fechou">Fechou</option>
          </select>
          <button type="button" disabled={ocupado} onClick={reagendar} className={botaoCls}
            style={{ border: '1px solid var(--cbc-border, #E2E8F0)', color: 'var(--cbc-text-secondary, #4A5568)' }}>Reagendar</button>
          <button type="button" disabled={ocupado} onClick={cancelar} className={botaoCls}
            style={{ border: '1px solid var(--cbc-danger-border, #FCA5A5)', color: 'var(--cbc-danger, #B91C1C)' }}>Cancelar</button>
        </div>
      </td>
    </tr>
  );
}

export function AgendaView({ chamarAdmin }) {
  const [linhas, setLinhas] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    const desde = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error } = await supabase.from('vw_agenda_painel').select('*').gte('scheduled_at', desde);
    setCarregando(false);
    if (error) { setErro(error.message); return; }
    setLinhas(data || []);
  }, []);

  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregar(); }, [carregar]);

  const grupos = useMemo(() => agruparAgenda(linhas || [], new Date().toISOString()), [linhas]);
  const vazio = linhas && Object.values(grupos).every((g) => g.length === 0);

  const executarAcao = async (body) => {
    setOcupado(true); setErro('');
    try {
      const res = await chamarAdmin(body);
      if (res?.error) setErro(res.error);
    } catch (e) { setErro(e.message); }
    setOcupado(false);
    carregar(); // recarrega após ação, sucesso ou erro (a linha pode ter mudado mesmo com aviso)
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs" style={mutedTxt}>Últimos 30 dias + próximos agendamentos (vw_agenda_painel — inclui eventos manuais, marcados "manual").</p>
        <button type="button" onClick={carregar} title="Atualizar" aria-label="Atualizar agenda" className="p-1.5 rounded-full cursor-pointer shrink-0" style={{ background: 'var(--cbc-bg-subtle, #F7FAFC)' }}>
          <ArrowPathIcon className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} style={{ color: 'var(--cbc-text-secondary, #4A5568)' }} aria-hidden="true" />
        </button>
      </div>

      {erro && (
        <div className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--cbc-danger, #B91C1C)' }}>
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0" aria-hidden="true" />{erro}
        </div>
      )}
      {!linhas && carregando && <div className="p-8 text-center text-sm animate-pulse" style={mutedTxt}>Carregando agenda…</div>}

      {linhas && SECOES_AGENDA.map(([chave, titulo]) => {
        const itens = grupos[chave] || [];
        if (!itens.length) return null;
        return (
          <div key={chave} className={cartaoCls} style={cartaoStyle}>
            <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
              {titulo} <span className="font-normal text-xs" style={mutedTxt}>({itens.length})</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[720px]">
                <thead>
                  <tr className="text-left" style={mutedTxt}>
                    <th className="pb-1.5 pr-2 font-bold uppercase text-[10.5px]">{chave === 'semana' || chave === 'passadas' ? 'Quando' : 'Hora'}</th>
                    <th className="pb-1.5 pr-2 font-bold uppercase text-[10.5px]">Nome</th>
                    <th className="pb-1.5 pr-2 font-bold uppercase text-[10.5px]">Telefone</th>
                    <th className="pb-1.5 pr-2 font-bold uppercase text-[10.5px]">Vendedora</th>
                    <th className="pb-1.5 pr-2 font-bold uppercase text-[10.5px]">Status</th>
                    <th className="pb-1.5 pr-2 font-bold uppercase text-[10.5px]">Lead</th>
                    <th className="pb-1.5 pl-2 font-bold uppercase text-[10.5px] text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((linha) => (
                    <LinhaAgenda key={linha.event_id} linha={linha} onAcao={executarAcao} ocupado={ocupado}
                      mostrarData={chave === 'semana' || chave === 'passadas'} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {vazio && <p className="text-sm text-center py-8" style={mutedTxt}>Nenhuma videochamada nos últimos 30 dias nem agendada.</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ConversasView
// ═══════════════════════════════════════════════════════════════════════════
// etapa → [rótulo, tom]. Vocabulário completo de agendaEngine.mjs (decidir/estadoInicial).
const ETAPA_META = {
  abertura: ['Abertura', 'neutral'],
  qual_resort: ['Qualificando: resort', 'info'],
  qual_situacao: ['Qualificando: situação', 'info'],
  qual_valor: ['Qualificando: valor', 'info'],
  oferta: ['Oferta de horário', 'warning'],
  negociacao: ['Negociando horário', 'warning'],
  pos_noshow: ['Pós no-show', 'danger'],
  confirmado: ['Confirmado', 'success'],
  handoff: ['Handoff p/ humano', 'danger'],
};

const estaPausada = (pausadaAte) => !!pausadaAte && new Date(pausadaAte) > new Date();

function LinhaMensagem({ msg }) {
  const out = msg.direction === 'out';
  return (
    <div className={`text-xs rounded-lg px-2.5 py-1.5 max-w-[85%] ${out ? 'ml-auto' : ''}`}
      style={{ background: out ? 'var(--cbc-info-bg, #EFF6FF)' : 'var(--cbc-bg-subtle, #F7FAFC)', color: 'var(--cbc-text-primary, #1B3A5C)' }}>
      <div>{msg.text}</div>
      <div className="text-[10px] mt-0.5" style={mutedTxt}>{fmtDataHoraSP(msg.created_at)}{msg.intent ? ` · ${msg.intent}` : ''}</div>
    </div>
  );
}

function LinhaConversa({ conversa, onAcao, ocupado }) {
  const [aberta, setAberta] = useState(false);
  const [mensagens, setMensagens] = useState(null);
  const [carregandoMsgs, setCarregandoMsgs] = useState(false);

  const ctx = conversa.context || {};
  const [etapaLabel, etapaTone] = ETAPA_META[ctx.etapa] || [ctx.etapa || '—', 'neutral'];
  const pausada = estaPausada(ctx.pausada_ate);
  const dados = ctx.dados || {};

  const abrirFechar = async () => {
    const vaiAbrir = !aberta;
    setAberta(vaiAbrir);
    // Recarrega a cada reabertura (não só na 1ª vez) — a conversa pode ter avançado
    // desde a última vez que esta linha foi expandida, mesmo sem um refresh da lista toda.
    if (vaiAbrir) {
      setCarregandoMsgs(true);
      const { data } = await supabase.from('bot_messages').select('id, direction, text, intent, created_at')
        .eq('conversation_id', conversa.id).order('created_at', { ascending: false }).limit(20);
      setMensagens((data || []).slice().reverse());
      setCarregandoMsgs(false);
    }
  };

  const pausarRetomar = () => onAcao({ acao: 'pausar_lead', lead_id: ctx.lead_id, horas: pausada ? 0 : 24, channel: conversa.channel });

  return (
    <div className={cartaoCls} style={cartaoStyle}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{conversa.customer_name || 'sem nome'}</div>
          <div className="text-[11px]" style={mutedTxt}>{conversa.channel} · atualizado {fmtDataHoraSP(conversa.updated_at)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Selo tone={etapaTone}>{etapaLabel}</Selo>
          {pausada && <Selo tone="warning">pausada até {fmtDataHoraSP(ctx.pausada_ate)}</Selo>}
        </div>
      </div>

      <div className="text-xs" style={mutedTxt}>
        Resort: <b style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{dados.resort || '—'}</b>
        {' · '}Situação: <b style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{dados.situacao || '—'}</b>
        {' · '}Valor aprox.: <b style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>{dados.valor_aprox || '—'}</b>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" disabled={ocupado || !ctx.lead_id} onClick={pausarRetomar} className={botaoCls}
          style={{ border: '1px solid var(--cbc-border, #E2E8F0)', color: 'var(--cbc-text-secondary, #4A5568)' }}
          title={ctx.lead_id ? '' : 'Conversa sem lead_id — não é possível pausar/retomar'}>
          {pausada ? 'Retomar' : 'Pausar 24h'}
        </button>
        <button type="button" onClick={abrirFechar} className={`${botaoCls} inline-flex items-center gap-1`}
          style={{ border: '1px solid var(--cbc-border, #E2E8F0)', color: 'var(--cbc-text-secondary, #4A5568)' }}>
          {aberta ? <ChevronUpIcon className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDownIcon className="w-3.5 h-3.5" aria-hidden="true" />}
          {aberta ? 'Ocultar mensagens' : 'Ver últimas mensagens'}
        </button>
      </div>

      {aberta && (
        <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: 'var(--cbc-border, #E2E8F0)' }}>
          {carregandoMsgs && <p className="text-xs" style={mutedTxt}>Carregando mensagens…</p>}
          {mensagens && mensagens.length === 0 && <p className="text-xs" style={mutedTxt}>Sem mensagens registradas.</p>}
          {mensagens && mensagens.map((msg) => <LinhaMensagem key={msg.id} msg={msg} />)}
        </div>
      )}
    </div>
  );
}

export function ConversasView({ chamarAdmin }) {
  const [conversas, setConversas] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    const { data, error } = await supabase.from('bot_conversations')
      .select('id, channel, customer_name, context, updated_at')
      .like('channel', 'agenda:%').order('updated_at', { ascending: false }).limit(50);
    setCarregando(false);
    if (error) { setErro(error.message); return; }
    setConversas(data || []);
  }, []);

  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregar(); }, [carregar]);

  const executarAcao = async (body) => {
    setOcupado(true); setErro('');
    try {
      const res = await chamarAdmin(body);
      if (res?.error) setErro(res.error);
    } catch (e) { setErro(e.message); }
    setOcupado(false);
    carregar();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs" style={mutedTxt}>Últimas 50 conversas da Ana (channel agenda:%), mais recentes primeiro.</p>
        <button type="button" onClick={carregar} title="Atualizar" aria-label="Atualizar conversas" className="p-1.5 rounded-full cursor-pointer shrink-0" style={{ background: 'var(--cbc-bg-subtle, #F7FAFC)' }}>
          <ArrowPathIcon className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} style={{ color: 'var(--cbc-text-secondary, #4A5568)' }} aria-hidden="true" />
        </button>
      </div>

      {erro && (
        <div className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--cbc-danger, #B91C1C)' }}>
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0" aria-hidden="true" />{erro}
        </div>
      )}
      {!conversas && carregando && <div className="p-8 text-center text-sm animate-pulse" style={mutedTxt}>Carregando conversas…</div>}
      {conversas && conversas.length === 0 && <p className="text-sm text-center py-8" style={mutedTxt}>Nenhuma conversa da Ana ainda.</p>}

      <div className="space-y-2.5">
        {(conversas || []).map((c) => <LinhaConversa key={c.id} conversa={c} onAcao={executarAcao} ocupado={ocupado} />)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SimuladorView
// ═══════════════════════════════════════════════════════════════════════════
// Formato idêntico ao retorno de estadoInicial({lead_id:0}) em agendaEngine.mjs — reproduzido
// aqui como literal (não importado) porque o arquivo real vive em netlify/functions/_lib
// (código de servidor); o simulador só precisa de um JSON com a MESMA forma.
const ESTADO_INICIAL_EXEMPLO = {
  etapa: 'abertura',
  lead_id: 0,
  contact_id: null,
  nome: '',
  dados: { resort: null, situacao: null, valor_aprox: null },
  slots_ofertados: [],
  recusas: 0,
  reagendamentos: 0,
  agendamento: { event_id: null, inicio: null, vendedora: null, meet_link: null },
  pausada_ate: null,
  origem: 'venda',
};

export function SimuladorView({ chamarAdmin, cfg }) {
  const [mensagem, setMensagem] = useState('Oi, quero cancelar minha cota');
  const [estadoTexto, setEstadoTexto] = useState(JSON.stringify(ESTADO_INICIAL_EXEMPLO, null, 2));
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const simular = async () => {
    setErro('');
    if (!mensagem.trim()) { setErro('Escreva a mensagem do lead.'); return; }
    let estado;
    try { estado = JSON.parse(estadoTexto); }
    catch { setErro('JSON do estado inválido — corrija antes de simular.'); return; }

    setCarregando(true); setResultado(null);
    try {
      const res = await chamarAdmin({ acao: 'simular', mensagem, estado });
      if (res?.error) setErro(res.error); else setResultado(res);
    } catch (e) { setErro(e.message); }
    setCarregando(false);
  };

  const usarNovoEstado = () => {
    if (resultado?.novoEstado) setEstadoTexto(JSON.stringify(resultado.novoEstado, null, 2));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border px-3 py-2 text-xs font-bold flex items-center gap-2"
        style={{ borderColor: 'var(--cbc-info-border, #BFDBFE)', background: 'var(--cbc-info-bg, #EFF6FF)', color: 'var(--cbc-info, #1D4ED8)' }}>
        <ExclamationTriangleIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
        Simulação não toca Kommo/Google — só chama a IA (interpretação) e o motor de decisão da Ana.
      </div>

      {cfg?.llm && (
        <p className="text-[11px]" style={mutedTxt}>
          Roda com a config atual: modelo <b>{cfg.llm.modelo}</b>, confiança mínima <b>{cfg.llm.confianca_minima}</b> — mude em Config antes de simular se quiser testar outro valor.
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <Cartao titulo="Mensagem do lead">
          <textarea rows={3} className={campoAreaCls} style={campoStyle} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
        </Cartao>
        <Cartao titulo="Estado da conversa (JSON)" dica="Editável — troque etapa/dados para simular qualquer ponto do fluxo">
          <textarea rows={10} className={`${campoAreaCls} font-mono`} style={campoStyle} value={estadoTexto} onChange={(e) => setEstadoTexto(e.target.value)} />
        </Cartao>
      </div>

      {erro && (
        <div className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--cbc-danger, #B91C1C)' }}>
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0" aria-hidden="true" />{erro}
        </div>
      )}

      <button type="button" onClick={simular} disabled={carregando}
        className="px-5 py-2 rounded-lg text-sm font-bold uppercase tracking-wide cursor-pointer text-white disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'var(--cbc-navy, #1B3A5C)' }}>
        {carregando ? 'Simulando…' : 'Simular'}
      </button>

      {resultado && (
        <div className="grid md:grid-cols-3 gap-3">
          <Cartao titulo="interp"><pre className="text-[11px] overflow-x-auto" style={mutedTxt}>{JSON.stringify(resultado.interp, null, 2)}</pre></Cartao>
          <Cartao titulo="acoes"><pre className="text-[11px] overflow-x-auto" style={mutedTxt}>{JSON.stringify(resultado.acoes, null, 2)}</pre></Cartao>
          <Cartao titulo="novoEstado">
            <pre className="text-[11px] overflow-x-auto" style={mutedTxt}>{JSON.stringify(resultado.novoEstado, null, 2)}</pre>
            <button type="button" onClick={usarNovoEstado} className={linkBtnCls} style={{ color: 'var(--cbc-info, #1D4ED8)' }}>
              Usar como próximo estado
            </button>
          </Cartao>
        </div>
      )}
    </div>
  );
}
