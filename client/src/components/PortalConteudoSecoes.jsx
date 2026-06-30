/**
 * Seções de CONTEÚDO da aba Portal do Cliente:
 *  1. Perguntas dos clientes ("Pergunte aqui" do portal) — responder com SLA
 *  2. FAQ do portal (CRUD)
 *  3. Educação por fase da jornada (textos/FAQ por marco; vazio = padrão)
 * Tudo via Supabase direto (sessão autenticada do sistema).
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  TrashIcon, PlusIcon, CheckIcon, ChatBubbleBottomCenterTextIcon,
  ChatBubbleLeftRightIcon, StarIcon, BookOpenIcon, UserGroupIcon, XMarkIcon, AcademicCapIcon,
} from '@heroicons/react/24/outline';

const MARCOS = [
  ['m0', 'Contrato (preparação)'], ['m1', 'Distribuição'], ['m2', 'Citação'],
  ['m3', 'Sentença'], ['m4', 'Cumprimento de sentença'], ['m5', 'Êxito (valores recebidos)'],
];

// ---------- helpers de bot_config (JSONB por key) reutilizados pelos editores ----------
function useBotConfig(key) {
  const [value, setValue] = useState(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('bot_config').select('value').eq('key', key).maybeSingle();
    setValue(data?.value || {});
  }, [key]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  const save = useCallback(async (v) => {
    await supabase.from('bot_config').upsert({ key, value: v, updated_at: new Date().toISOString() });
  }, [key]);
  return [value, setValue, save];
}

// cabeçalho padrão de card de conteúdo (ícone + título + subtítulo)
function CardConteudo({ icon: Icon, titulo, sub, children, footer }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-[#C9A84C] shrink-0" />}
        <h3 className="text-[13px] font-bold uppercase tracking-wide opacity-80 flex-1 min-w-0">
          {titulo}{sub && <span className="opacity-50 font-normal normal-case"> — {sub}</span>}
        </h3>
      </div>
      <div className="p-3 space-y-2.5">{children}</div>
      {footer && <div className="px-3 pb-3 flex justify-end">{footer}</div>}
    </div>
  );
}

// botão Salvar com feedback (… / Salvo!)
function BtnSalvar({ onClick, rotulo = 'Salvar' }) {
  const [st, setSt] = useState('');
  const run = async () => { setSt('saving'); try { await onClick(); setSt('saved'); setTimeout(() => setSt(''), 2000); } catch { setSt(''); } };
  return (
    <button onClick={run} disabled={st === 'saving'}
      className="px-4 py-2 rounded-lg bg-[#1B3A5C] dark:bg-[#C9A84C] dark:text-gray-900 text-white text-[11.5px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5 transition-all hover:opacity-90">
      {st === 'saved' ? <><CheckIcon className="w-4 h-4" /> Salvo!</> : st === 'saving' ? 'Salvando…' : rotulo}
    </button>
  );
}
const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/50';

export function PerguntasClientes({ onPending } = {}) {
  const [lista, setLista] = useState(null);
  const [resp, setResp] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('portal_perguntas')
      .select('id, nome, pergunta, resposta, status, criado_em')
      .order('status', { ascending: false }) // pendente > respondida (alfabético: r>p? não — ordenar abaixo)
      .order('criado_em', { ascending: false }).limit(60);
    const ordenada = (data || []).sort((a, b) => (a.status === 'pendente' ? -1 : 1) - (b.status === 'pendente' ? -1 : 1));
    setLista(ordenada);
    if (onPending) onPending(ordenada.filter((q) => q.status === 'pendente').length);
  }, [onPending]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const responder = async (q) => {
    const texto = (resp[q.id] || '').trim();
    if (texto.length < 3) return;
    setBusy(q.id);
    await supabase.from('portal_perguntas').update({
      resposta: texto, status: 'respondida',
      respondida_em: new Date().toISOString(), respondida_por: 'painel',
    }).eq('id', q.id);
    setBusy(null);
    load();
  };

  const pendentes = (lista || []).filter((q) => q.status === 'pendente');
  if (lista === null) return null;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        <ChatBubbleBottomCenterTextIcon className="w-4 h-4 text-[#C9A84C]" />
        <h3 className="text-[13px] font-bold uppercase tracking-wide opacity-80 flex-1">
          Perguntas dos clientes <span className="opacity-50 font-normal normal-case">— SLA prometido no portal: 1 dia útil</span>
        </h3>
        {pendentes.length > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-600 text-white">{pendentes.length} pendente(s)</span>}
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-700/50 max-h-96 overflow-y-auto">
        {!lista.length && <p className="px-4 py-4 text-[12px] opacity-50">Nenhuma pergunta ainda — elas chegam pela aba “Dúvidas” do portal.</p>}
        {lista.map((q) => (
          <div key={q.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[13px]"><b>{q.nome || 'Cliente'}</b>: {q.pergunta}</div>
              <span className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${q.status === 'pendente'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>{q.status}</span>
            </div>
            <div className="text-[10.5px] opacity-50 mt-0.5">{new Date(q.criado_em).toLocaleString('pt-BR')}</div>
            {q.status === 'pendente' ? (
              <div className="flex gap-2 mt-2">
                <input type="text" className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-[12.5px]"
                  placeholder="Escreva a resposta (aparece no portal do cliente)…"
                  value={resp[q.id] || ''} onChange={(e) => setResp((p) => ({ ...p, [q.id]: e.target.value }))} />
                <button onClick={() => responder(q)} disabled={busy === q.id}
                  className="px-3 py-1.5 rounded-lg bg-[#1B3A5C] text-white text-[11px] font-bold disabled:opacity-50">
                  {busy === q.id ? '…' : 'Responder'}
                </button>
              </div>
            ) : (
              <p className="text-[12px] mt-1.5 px-3 py-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-900/20">{q.resposta}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FaqPortal() {
  const [faq, setFaq] = useState(null);
  const [novo, setNovo] = useState({ pergunta: '', resposta: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('portal_faq')
      .select('id, pergunta, resposta, ordem, ativo').order('ordem').limit(50);
    setFaq(data || []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (novo.pergunta.trim().length < 5 || novo.resposta.trim().length < 5) return;
    setBusy(true);
    await supabase.from('portal_faq').insert({
      pergunta: novo.pergunta.trim(), resposta: novo.resposta.trim(),
      ordem: ((faq || []).reduce((m, f) => Math.max(m, f.ordem), 0) + 10),
    });
    setNovo({ pergunta: '', resposta: '' }); setBusy(false); load();
  };
  const toggle = async (f) => { await supabase.from('portal_faq').update({ ativo: !f.ativo }).eq('id', f.id); load(); };
  const remover = async (f) => { await supabase.from('portal_faq').delete().eq('id', f.id); load(); };

  if (faq === null) return null;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-[13px] font-bold uppercase tracking-wide opacity-80">
          FAQ do portal <span className="opacity-50 font-normal normal-case">— aba “Dúvidas” que todos os clientes veem</span>
        </h3>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-700/50 max-h-80 overflow-y-auto">
        {faq.map((f) => (
          <div key={f.id} className={`px-4 py-2.5 flex items-start gap-2 ${f.ativo ? '' : 'opacity-45'}`}>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-bold">{f.pergunta}</div>
              <div className="text-[12px] opacity-70 truncate">{f.resposta}</div>
            </div>
            <button onClick={() => toggle(f)} title={f.ativo ? 'Ocultar do portal' : 'Reativar'}
              className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded border ${f.ativo
                ? 'border-gray-200 dark:border-gray-600 opacity-70' : 'border-emerald-300 text-emerald-600'}`}>
              {f.ativo ? 'Ocultar' : 'Ativar'}
            </button>
            <button onClick={() => remover(f)} title="Excluir" className="shrink-0 p-1 text-red-400 hover:text-red-600">
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
        <input type="text" className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-[12.5px]"
          placeholder="Nova pergunta…" value={novo.pergunta} onChange={(e) => setNovo((p) => ({ ...p, pergunta: e.target.value }))} />
        <div className="flex gap-2">
          <input type="text" className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-[12.5px]"
            placeholder="Resposta…" value={novo.resposta} onChange={(e) => setNovo((p) => ({ ...p, resposta: e.target.value }))} />
          <button onClick={add} disabled={busy}
            className="px-3 py-2 rounded-lg bg-[#1B3A5C] text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50">
            <PlusIcon className="w-4 h-4" /> Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}

export function EducacaoPortal() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('bot_config').select('value').eq('key', 'portal_educacao').maybeSingle();
    setCfg(data?.value || {});
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const edit = (mk, campo, valor) => setCfg((c) => ({ ...c, [mk]: { ...(c?.[mk] || {}), [campo]: valor } }));
  const salvar = async () => {
    setSaving(true);
    await supabase.from('bot_config').upsert({ key: 'portal_educacao', value: cfg || {}, updated_at: new Date().toISOString() });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  if (cfg === null) return null;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <AcademicCapIcon className="w-4 h-4 text-[#C9A84C] shrink-0" />
          <h3 className="text-[13px] font-bold uppercase tracking-wide opacity-80">Educação por fase da jornada</h3>
        </div>
        <p className="text-[11px] opacity-55 mt-0.5">
          “Entenda esta fase”, “O que NÃO vai acontecer” e FAQ exibidos no portal por marco. <b>Vazio = texto padrão</b> (já revisado).
          FAQ: quantas linhas quiser, no formato <code>Pergunta? | Resposta</code>.
        </p>
      </div>
      <div className="p-3 space-y-2">
        {MARCOS.map(([mk, label]) => {
          const m = cfg[mk] || {};
          return (
            <details key={mk} className="border border-gray-100 dark:border-gray-700 rounded-lg">
              <summary className="px-3 py-2 text-[12.5px] font-bold cursor-pointer">{label}</summary>
              <div className="p-3 space-y-2">
                <textarea className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-[12.5px]" rows={2}
                  placeholder="Entenda esta fase (vazio = padrão)" value={m.entenda || ''} onChange={(e) => edit(mk, 'entenda', e.target.value)} />
                <textarea className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-[12.5px]" rows={2}
                  placeholder="O que NÃO vai acontecer agora (vazio = padrão)" value={m.nao_acontece || ''} onChange={(e) => edit(mk, 'nao_acontece', e.target.value)} />
                <textarea className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-[12.5px] font-mono" rows={3}
                  placeholder={'Posso viajar? | Pode. Se algo precisar de você, avisamos.\n(uma pergunta por linha)'}
                  value={m.faq_texto || ''} onChange={(e) => edit(mk, 'faq_texto', e.target.value)} />
              </div>
            </details>
          );
        })}
        <div className="flex justify-end">
          <button onClick={salvar} disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[11.5px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
            {saved ? <><CheckIcon className="w-4 h-4" /> Salvo!</> : saving ? 'Salvando…' : 'Salvar educação'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContatoPortal() {
  const [v, setV, save] = useBotConfig('portal_contato');
  if (v === null) return null;
  return (
    <CardConteudo icon={ChatBubbleLeftRightIcon} titulo="Contato no portal" sub="WhatsApp e horário do botão “Falar com a equipe”"
      footer={<BtnSalvar onClick={() => save({ whatsapp: (v.whatsapp || '').trim(), horario: (v.horario || '').trim() })} />}>
      <div className="grid sm:grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide opacity-60 mb-1">WhatsApp (com DDD)</label>
          <input className={inputCls} placeholder="(19) 99805-1878" value={v.whatsapp || ''} onChange={(e) => setV({ ...v, whatsapp: e.target.value })} />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide opacity-60 mb-1">Horário de atendimento</label>
          <input className={inputCls} placeholder="de segunda a sexta, das 9h às 18h" value={v.horario || ''} onChange={(e) => setV({ ...v, horario: e.target.value })} />
        </div>
      </div>
      <p className="text-[11px] opacity-50">Sem o número, o botão de WhatsApp não aparece no portal. O cliente abre o WhatsApp já com nome e processo preenchidos.</p>
    </CardConteudo>
  );
}

export function ReviewPortal() {
  const [v, setV, save] = useBotConfig('portal_review');
  if (v === null) return null;
  return (
    <CardConteudo icon={StarIcon} titulo="Avaliação no Google" sub="link oferecido a quem dá nota 9–10 no NPS"
      footer={<BtnSalvar onClick={() => save({ url: (v.url || '').trim() })} />}>
      <input className={inputCls} placeholder="https://g.page/r/…/review" value={v.url || ''} onChange={(e) => setV({ ...v, url: e.target.value })} />
      <p className="text-[11px] opacity-50">Cole o link direto de avaliação do Google. Vazio = o convite de avaliação não aparece no portal.</p>
    </CardConteudo>
  );
}

export function ExplicadorPortal() {
  const [v, setV, save] = useBotConfig('portal_explicador');
  if (v === null) return null;
  const itens = v.itens || [];
  const setItem = (i, campo, val) => setV({ ...v, itens: itens.map((it, k) => (k === i ? { ...it, [campo]: val } : it)) });
  const add = () => setV({ ...v, itens: [...itens, { t: '', d: '' }] });
  const rm = (i) => setV({ ...v, itens: itens.filter((_, k) => k !== i) });
  return (
    <CardConteudo icon={BookOpenIcon} titulo="“Por que um processo demora?”" sub="acordeão da aba Dúvidas que acalma a ansiedade"
      footer={<BtnSalvar onClick={() => save({ itens: itens.filter((it) => (it.t || '').trim() && (it.d || '').trim()).map((it) => ({ t: it.t.trim(), d: it.d.trim() })) })} />}>
      {!itens.length && <p className="text-[11px] opacity-50">Sem itens cadastrados — o portal usa os 4 textos padrão já revisados. Adicione itens só para personalizar.</p>}
      {itens.map((it, i) => (
        <div key={i} className="rounded-lg border border-gray-100 dark:border-gray-700 p-2.5 space-y-1.5 relative">
          <button onClick={() => rm(i)} className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600"><XMarkIcon className="w-4 h-4" /></button>
          <input className={inputCls} placeholder="Título (ex.: A maior parte do tempo, seu caso está na fila do juiz)" value={it.t || ''} onChange={(e) => setItem(i, 't', e.target.value)} />
          <textarea className={inputCls} rows={2} placeholder="Explicação em linguagem simples…" value={it.d || ''} onChange={(e) => setItem(i, 'd', e.target.value)} />
        </div>
      ))}
      <button onClick={add} className="text-[11.5px] font-bold text-[#1B3A5C] dark:text-[#C9A84C] inline-flex items-center gap-1 hover:opacity-80"><PlusIcon className="w-4 h-4" /> Adicionar item</button>
    </CardConteudo>
  );
}

export function EquipePortal() {
  const [v, setV, save] = useBotConfig('portal_equipe');
  if (v === null) return null;
  const fotos = v.fotos || [];
  const set = (i, val) => setV({ ...v, fotos: fotos.map((f, k) => (k === i ? val : f)) });
  const add = () => setV({ ...v, fotos: [...fotos, ''] });
  const rm = (i) => setV({ ...v, fotos: fotos.filter((_, k) => k !== i) });
  return (
    <CardConteudo icon={UserGroupIcon} titulo="Fotos da equipe" sub="rostos do escritório no portal (até 8)"
      footer={<BtnSalvar onClick={() => save({ fotos: fotos.map((f) => (f || '').trim()).filter(Boolean).slice(0, 8) })} />}>
      {!fotos.length && <p className="text-[11px] opacity-50">Sem fotos — a seção “Quem cuida do seu caso” fica oculta. Cole URLs públicas de imagens quadradas.</p>}
      {fotos.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          {f
            ? <img src={f} alt="" className="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-gray-600 shrink-0" />
            : <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 shrink-0" />}
          <input className={inputCls} placeholder="https://…/foto.jpg" value={f || ''} onChange={(e) => set(i, e.target.value)} />
          <button onClick={() => rm(i)} className="p-1 text-red-400 hover:text-red-600 shrink-0"><XMarkIcon className="w-4 h-4" /></button>
        </div>
      ))}
      {fotos.length < 8 && <button onClick={add} className="text-[11.5px] font-bold text-[#1B3A5C] dark:text-[#C9A84C] inline-flex items-center gap-1 hover:opacity-80"><PlusIcon className="w-4 h-4" /> Adicionar foto</button>}
    </CardConteudo>
  );
}

export function CorrelacaoCard() {
  const [d, setD] = useState(null);

   
  useEffect(() => {
    (async () => {
      const desde = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
      const [{ data: ac }, { data: ct }] = await Promise.all([
        supabase.from('portal_acessos_diario').select('dia, qtd').gte('dia', desde).order('dia'),
        supabase.from('contatos_kommo_diario').select('dia, mensagens').gte('dia', desde).order('dia'),
      ]);
      const mapa = {};
      for (const a of ac || []) mapa[a.dia] = { dia: a.dia, acessos: a.qtd, contatos: 0 };
      for (const c of ct || []) (mapa[c.dia] = mapa[c.dia] || { dia: c.dia, acessos: 0 }).contatos = c.mensagens;
      setD(Object.values(mapa).sort((a, b) => a.dia.localeCompare(b.dia)));
    })();
  }, []);

  if (!d || !d.length) return null;
  const max = Math.max(1, ...d.map((x) => Math.max(x.acessos || 0, x.contatos || 0)));
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h3 className="text-[12px] font-bold uppercase tracking-wide opacity-70">Portal × contatos no WhatsApp (14 dias)</h3>
      <p className="text-[11px] opacity-55 mt-0.5">A tese: quanto mais acessos ao portal, menos mensagens chegam. Os contatos do Kommo são coletados 1×/dia.</p>
      <div className="flex items-end gap-1.5 h-24 mt-3">
        {d.map((x) => (
          <div key={x.dia} className="flex-1 flex items-end gap-[2px]" title={`${x.dia}: ${x.acessos || 0} acessos · ${x.contatos || 0} contatos`}>
            <div className="flex-1 rounded-t bg-[#1B3A5C]" style={{ height: `${Math.max(4, ((x.acessos || 0) / max) * 100)}%` }} />
            <div className="flex-1 rounded-t bg-[#C9A84C]" style={{ height: `${Math.max(4, ((x.contatos || 0) / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-2 text-[10.5px] opacity-60">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1" style={{ background: '#1B3A5C' }} />acessos ao portal</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1" style={{ background: '#C9A84C' }} />mensagens recebidas (Kommo)</span>
      </div>
    </div>
  );
}
