import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { botApi } from './botApi';
import { ArrowPathIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

const PLACEHOLDERS = '{{primeiro_nome}} {{cliente}} {{processo}} {{tipo}} {{fase}} {{advogado}} {{ultimo_andamento}} {{data_ultimo_andamento}} {{prazo_medio}}';

// Quadros do ADVBOX na ordem do funil do escritorio (demais grupos vao para o fim)
const QUADROS = ['MARKETING', 'NEGOCIAÇÃO', 'CONSULTORIA', 'ADMINISTRATIVO', 'JUDICIAL', 'RECURSAL', 'FINANCEIRO', 'ARQUIVAMENTO'];
const normQ = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const quadroOrder = (g) => {
  const i = QUADROS.findIndex(q => normQ(q) === normQ(g));
  return i === -1 ? 999 : i;
};

export default function BotEtapas() {
  const [stages, setStages] = useState([]);     // do ADVBOX (settings)
  const [templates, setTemplates] = useState({}); // stages_id -> row
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [filter, setFilter] = useState('');
  const [soPendentes, setSoPendentes] = useState(false);
  const [novasIds, setNovasIds] = useState(() => new Set());
  const [openGroups, setOpenGroups] = useState(() => new Set(['JUDICIAL'])); // judicial aberto por padrao
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [{ settings }, { data: tpl }, { data: cat }] = await Promise.all([
        botApi('settings'),
        supabase.from('bot_stage_templates').select('*'),
        supabase.from('bot_config').select('value').eq('key', 'catalogo').maybeSingle(),
      ]);
      const rawStages = settings?.stages || settings?.stage || [];
      setStages(rawStages.map(s => ({ id: s.id, name: s.stage || s.name || s.title || `Etapa ${s.id}`, group: s.step || s.group || '' })));
      const map = {};
      for (const t of tpl || []) map[t.stages_id] = t;
      setTemplates(map);
      setNovasIds(new Set(((cat?.value?.novidades?.etapas_novas) || []).map(x => Number(x.id))));
    } catch (e) { setErr(`Erro ao carregar etapas do ADVBOX: ${e.message}`); }
    setLoading(false);
  }, []);

  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const edit = (stageId, field, value) => {
    setTemplates(t => ({ ...t, [stageId]: { ...(t[stageId] || { stages_id: stageId, active: true, template: '', proximos_passos: '', prazo_medio: '' }), [field]: value } }));
  };

  const save = async (stage) => {
    const t = templates[stage.id] || {};
    setSavingId(stage.id);
    const row = {
      stages_id: stage.id, stage_name: stage.name,
      template: t.template || '', proximos_passos: t.proximos_passos || '',
      prazo_medio: t.prazo_medio || '', active: t.active !== false,
      ocultar_cliente: !!t.ocultar_cliente,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('bot_stage_templates').upsert(row, { onConflict: 'stages_id' });
    if (error) setErr(`Erro ao salvar: ${error.message}`);
    else { setSavedId(stage.id); setTimeout(() => setSavedId(null), 1500); }
    setSavingId(null);
  };

  const toggleGroup = (g) => setOpenGroups(prev => {
    const next = new Set(prev);
    const k = normQ(g);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // agrupa por quadro do ADVBOX, na ordem do funil; filtro atravessa os grupos
  const grupos = useMemo(() => {
    const pendente = (s) => { const t = templates[s.id]; return !(t && t.active !== false && (t.template || t.proximos_passos)); };
    const visiveis = stages.filter(s =>
      (!filter || `${s.name} ${s.group}`.toLowerCase().includes(filter.toLowerCase())) &&
      (!soPendentes || pendente(s)));
    const map = new Map();
    for (const s of visiveis) {
      const g = s.group || 'Sem quadro';
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(s);
    }
    return [...map.entries()].sort((a, b) => quadroOrder(a[0]) - quadroOrder(b[0]) || a[0].localeCompare(b[0]));
  }, [stages, filter, soPendentes, templates]);

  if (loading) return <div className="p-6 text-sm opacity-60 flex items-center gap-2"><ArrowPathIcon className="w-4 h-4 animate-spin" />Carregando etapas do ADVBOX…</div>;

  return (
    <div className="space-y-4">
      <div className="card p-4 text-xs opacity-80">
        <b>Como funciona:</b> quando o cliente pergunta do processo, o bot identifica a <b>etapa atual no ADVBOX</b> e
        usa os textos abaixo. <b>Texto da fase</b> explica em linguagem simples o que essa etapa significa;
        <b> próximos passos</b> diz o que acontece agora; <b>prazo médio</b> calibra a expectativa.
        Placeholders disponíveis: <code className="text-[10px]">{PLACEHOLDERS}</code>
      </div>
      {err && <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/30">{err}</div>}
      {stages.length === 0 && <div className="card p-4 text-sm opacity-60">Nenhuma etapa retornada pelo ADVBOX (verifique o token / GET /settings).</div>}
      {stages.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 gap-y-1.5">
          <input className="input-field flex-1 text-sm" placeholder={`Filtrar ${stages.length} etapas (por nome ou quadro)…`}
            value={filter} onChange={e => setFilter(e.target.value)} />
          <label className="text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
            <input type="checkbox" checked={soPendentes} onChange={e => setSoPendentes(e.target.checked)} />
            só pendentes
          </label>
          <span className="text-xs opacity-50 whitespace-nowrap">{Object.keys(templates).length} configurada(s)</span>
        </div>
      )}

      {grupos.map(([quadro, list]) => {
        const aberto = !!filter || openGroups.has(normQ(quadro));
        const configuradas = list.filter(s => templates[s.id]?.template || templates[s.id]?.proximos_passos).length;
        return (
          <div key={quadro} className="card overflow-hidden">
            <button className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => toggleGroup(quadro)}>
              {aberto ? <ChevronDownIcon className="w-4 h-4 shrink-0" /> : <ChevronRightIcon className="w-4 h-4 shrink-0" />}
              <span className="font-bold text-sm uppercase tracking-wide">{quadro || 'Sem quadro'}</span>
              <span className="text-xs opacity-50">{list.length} etapa(s) · {configuradas} configurada(s)</span>
            </button>
            {aberto && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-3">
                {list.map(stage => {
                  const t = templates[stage.id] || {};
                  return (
                    <div key={stage.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-y-1.5 mb-2">
                        <div>
                          <span className="font-bold text-sm">{stage.name}</span>
                          {novasIds.has(Number(stage.id)) && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 uppercase">nova</span>}
                          <span className="text-[10px] opacity-40 ml-2">id {stage.id}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 gap-y-1.5">
                          <label className={`text-xs flex items-center gap-1 cursor-pointer ${t.ocultar_cliente ? 'text-red-600 dark:text-red-400 font-bold' : ''}`}
                            title="O bot não revela o nome técnico desta etapa ao cliente (mostra 'Em andamento com nossa equipe' + os textos parametrizados, se houver)">
                            <input type="checkbox" checked={!!t.ocultar_cliente} onChange={e => edit(stage.id, 'ocultar_cliente', e.target.checked)} />
                            🚫 não revelar ao cliente
                          </label>
                          <label className="text-xs flex items-center gap-1">
                            <input type="checkbox" checked={t.active !== false} onChange={e => edit(stage.id, 'active', e.target.checked)} /> ativa
                          </label>
                          <button className="btn-primary text-xs px-3 py-1.5" onClick={() => save(stage)} disabled={savingId === stage.id}>
                            {savedId === stage.id ? <CheckIcon className="w-3.5 h-3.5 inline" /> : 'Salvar'}
                          </button>
                        </div>
                      </div>
                      <div className="grid md:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] font-bold uppercase tracking-wide opacity-60">Texto da fase (o que significa)</label>
                          <textarea className="input-field w-full text-sm" rows={3}
                            placeholder={'Ex.: Seu processo está na fase de {{fase}}. Isso significa que…'}
                            value={t.template || ''} onChange={e => edit(stage.id, 'template', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold uppercase tracking-wide opacity-60">Próximos passos</label>
                          <textarea className="input-field w-full text-sm" rows={3}
                            placeholder={'Ex.: 👣 Próximo passo: aguardamos a decisão do juiz…'}
                            value={t.proximos_passos || ''} onChange={e => edit(stage.id, 'proximos_passos', e.target.value)} />
                        </div>
                      </div>
                      <div className="mt-2">
                        <label className="text-[11px] font-bold uppercase tracking-wide opacity-60">Prazo médio desta fase</label>
                        <input className="input-field w-full text-sm" placeholder="Ex.: de 3 a 6 meses"
                          value={t.prazo_medio || ''} onChange={e => edit(stage.id, 'prazo_medio', e.target.value)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
