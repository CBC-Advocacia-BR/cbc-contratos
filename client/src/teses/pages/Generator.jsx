import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  Button, Card, CardBody, CardHeader, Input, Label, Select, Spinner, Badge,
  Textarea, EmptyState,
} from '../components/ui/Primitives';
import { useTesesAuth } from '../contexts/AuthContext';
import { fetchProcessBundle } from '../lib/advbox';
import { fetchDatajudProcess, mergeDatajudIntoBundle } from '../lib/datajud';
import {
  buildInitialValues, fillHtml, fillPlainText, extractPlaceholderKeys,
} from '../lib/placeholders';
import { downloadBlob } from '../lib/downloadBlob';
import { convertDocxToPdf, printHtmlAsPdf } from '../lib/pdfGenerator';
import { loadModelWithFallback, getCachedModelList, getCachedResorts } from '../lib/offlineCache';
import { useDragList } from '../hooks/useDragList';

const STEPS = [
  { key: 'processo', label: '1. Processo' },
  { key: 'modelo', label: '2. Modelo' },
  { key: 'resort', label: '3. Resort' },
  { key: 'blocos', label: '4. Blocos' },
  { key: 'campos', label: '5. Campos' },
  { key: 'preview', label: '6. Revisão' },
];

export default function GeneratorPage() {
  const { profile } = useTesesAuth();
  const [step, setStep] = useState('processo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [processNumber, setProcessNumber] = useState('');
  const [bundle, setBundle] = useState(null);

  const [models, setModels] = useState([]);
  const [themes, setThemes] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [modelBlocks, setModelBlocks] = useState([]);
  const [modelPlaceholders, setModelPlaceholders] = useState([]);

  const [resorts, setResorts] = useState([]);
  const [selectedResortId, setSelectedResortId] = useState(null);
  const [selectedResort, setSelectedResort] = useState(null);

  const [selectedBlockIds, setSelectedBlockIds] = useState([]);
  const [blockOrder, setBlockOrder] = useState([]);
  const [values, setValues] = useState({});

  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Carrega modelos aprovados + temas (online) com fallback para cache local
  useEffect(() => {
    (async () => {
      try {
        const [m, t, r] = await Promise.all([
          supabase.from('models').select('*').eq('status', 'aprovado').order('name'),
          supabase.from('themes').select('*').eq('is_active', true).order('display_order'),
          supabase.from('resorts').select('id,trade_name,legal_name,cnpj,economic_group,state,category').eq('is_active', true).order('trade_name'),
        ]);
        if (m.data?.length) {
          setModels(m.data);
          setThemes(t.data || []);
          setResorts(r.data || []);
          return;
        }
      } catch { /* cai no cache */ }
      // Fallback offline
      const cached = getCachedModelList();
      setModels(cached);
      setResorts(getCachedResorts());
    })();
  }, []);

  // Carrega resort completo ao escolher
  useEffect(() => {
    if (!selectedResortId) { setSelectedResort(null); return; }
    (async () => {
      const [r, c] = await Promise.all([
        supabase.from('resorts').select('*').eq('id', selectedResortId).maybeSingle(),
        supabase.from('resort_companies').select('*').eq('resort_id', selectedResortId),
      ]);
      if (r.data) setSelectedResort({ ...r.data, companies: c.data || [] });
    })();
  }, [selectedResortId]);

  // Carrega blocos + placeholders ao escolher modelo (com fallback offline)
  useEffect(() => {
    if (!selectedModelId) { setSelectedModel(null); return; }
    (async () => {
      const result = await loadModelWithFallback(selectedModelId);
      if (!result) return;
      const { model, blocks, placeholders: phs } = result;
      setSelectedModel(model);
      setModelBlocks(blocks);
      setModelPlaceholders(phs);
      const sel = blocks.filter((x) => x.is_required || x.is_default_selected).map((x) => x.id);
      setSelectedBlockIds(sel);
      setBlockOrder(blocks.map((x) => x.id));
    })();
  }, [selectedModelId]);

  // Atualiza valores quando placeholders/resort/bundle mudam
  useEffect(() => {
    if (!modelPlaceholders.length) { setValues({}); return; }
    const init = buildInitialValues(modelPlaceholders, {
      advbox: bundle,
      datajud: bundle?.datajud,
      resort: selectedResort,
    });
    setValues((v) => ({ ...init, ...v })); // preserva edições manuais
  }, [modelPlaceholders, bundle, selectedResort]);

  const searchProcess = async () => {
    if (!processNumber) return;
    setBusy(true);
    setError(null);
    try {
      let b = await fetchProcessBundle(processNumber);
      const datajud = await fetchDatajudProcess(processNumber);
      b = mergeDatajudIntoBundle(b, datajud);
      setBundle(b);

      // Sugere modelos a partir de keywords em movimentações
      const movText = (b.movements || [])
        .map((m) => (typeof m === 'string' ? m : (m.description || m.text || m.title || '')))
        .join(' ').toLowerCase();
      const sug = models.filter((m) => {
        const kws = (m.trigger_keywords || []).concat(m.trigger_movements || []);
        return kws.some((k) => k && movText.includes(String(k).toLowerCase()));
      });
      setSuggested(sug);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const skipProcess = () => {
    setBundle({ lawsuit: null, customer: null, movements: [], publications: [] });
    setStep('modelo');
  };

  const advanceToResort = () => {
    if (selectedModel?.requires_resort_data) setStep('resort');
    else { setSelectedResort(null); setStep('blocos'); }
  };

  // ─── Blocos: render ─────────────────────────────────
  const orderedBlocks = useMemo(
    () => blockOrder.map((id) => modelBlocks.find((b) => b.id === id)).filter(Boolean),
    [blockOrder, modelBlocks]
  );

  const toggleBlock = (id) => {
    const blk = modelBlocks.find((b) => b.id === id);
    if (!blk || blk.is_required) return;
    setSelectedBlockIds((prev) => {
      const exists = prev.includes(id);
      if (exists) return prev.filter((x) => x !== id);
      let next = [...prev, id];
      // Aplica exclusividade mútua
      if (blk.mutually_exclusive_group) {
        next = next.filter((otherId) => {
          const other = modelBlocks.find((b) => b.id === otherId);
          return other?.id === id || other?.mutually_exclusive_group !== blk.mutually_exclusive_group;
        });
      }
      return next;
    });
  };

  const moveInOrder = (id, dir) => {
    setBlockOrder((order) => {
      const idx = order.indexOf(id);
      if (idx < 0) return order;
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= order.length) return order;
      const next = [...order];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  // DnD nativo nos cards de bloco
  const orderedForDnd = useMemo(
    () => blockOrder.map((id) => modelBlocks.find((b) => b.id === id)).filter(Boolean),
    [blockOrder, modelBlocks]
  );
  const setOrderedForDnd = (arr) => setBlockOrder(arr.map((b) => b.id));
  const blockDnd = useDragList(orderedForDnd, setOrderedForDnd);

  // Descobre placeholders efetivamente usados na seleção
  const usedPlaceholderKeys = useMemo(() => {
    const set = new Set();
    const toScan = [
      selectedModel?.fixed_header,
      selectedModel?.fixed_footer,
      ...orderedBlocks
        .filter((b) => selectedBlockIds.includes(b.id))
        .map((b) => b.content),
    ];
    for (const text of toScan) extractPlaceholderKeys(text).forEach((k) => set.add(k));
    return set;
  }, [selectedModel, orderedBlocks, selectedBlockIds]);

  const visiblePlaceholders = useMemo(
    () => modelPlaceholders.filter((p) => usedPlaceholderKeys.has(p.key)),
    [modelPlaceholders, usedPlaceholderKeys]
  );

  // ─── Pré-visualização (HTML) ────────────────────────
  const previewHtml = useMemo(() => {
    if (!selectedModel) return '';
    const parts = [];
    if (selectedModel.fixed_header) {
      parts.push(`<p style="text-align:center;font-weight:bold;white-space:pre-wrap;">${fillHtml(selectedModel.fixed_header, values)}</p>`);
    }
    const ob = orderedBlocks.filter((b) => selectedBlockIds.includes(b.id));
    for (const b of ob) {
      parts.push(`<h4 class="bloco-titulo">${b.title}</h4>`);
      parts.push(`<div>${fillHtml(b.content, values)}</div>`);
    }
    if (selectedModel.fixed_footer) {
      parts.push(`<p style="white-space:pre-wrap;margin-top:2em;">${fillHtml(selectedModel.fixed_footer, values)}</p>`);
    }
    return parts.join('\n');
  }, [selectedModel, orderedBlocks, selectedBlockIds, values]);

  // ─── Geração ────────────────────────────────────────
  const generate = async (alsoPdf = false) => {
    if (!selectedModel) return;
    setBusy(true);
    try {
      // Code splitting: carrega docxGenerator apenas quando usuário gera.
      // Isso reduz o bundle inicial (~500 KB de docx-js).
      const { generatePetitionDocx } = await import('../lib/docxGenerator');
      const finalBlocks = orderedBlocks
        .filter((b) => selectedBlockIds.includes(b.id))
        .map((b) => ({ title: b.title, content: fillPlainText(b.content, values) }));
      const modelForDocx = {
        ...selectedModel,
        fixed_header: fillPlainText(selectedModel.fixed_header, values),
        fixed_footer: fillPlainText(selectedModel.fixed_footer, values),
      };
      const blob = await generatePetitionDocx({
        model: modelForDocx,
        blocks: finalBlocks,
        title: selectedModel.name,
      });

      const baseName = `${selectedModel.name}_${(values.nome_cliente || bundle?.customer?.name || 'cliente').toString().replace(/\s+/g, '_')}`;
      downloadBlob(blob, `${baseName}.docx`);

      if (alsoPdf) {
        const pdf = await convertDocxToPdf(blob);
        if (pdf) downloadBlob(pdf, `${baseName}.pdf`);
        else printHtmlAsPdf(previewHtml, baseName);
      }

      // Registro da petição gerada
      await supabase.from('generated_petitions').insert({
        model_id: selectedModel.id,
        model_version: selectedModel.version || 1,
        resort_id: selectedResort?.id || null,
        generated_by: profile?.id,
        process_number: processNumber || bundle?.lawsuit?.process_number || null,
        advbox_lawsuit_id: bundle?.lawsuit?.id || null,
        customer_name: values.nome_cliente || bundle?.customer?.name || null,
        customer_identification: values.cpf_cliente || bundle?.customer?.cpf || null,
        selected_blocks: selectedBlockIds,
        block_order: blockOrder,
        filled_placeholders: values,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Gerar petição</h1>
        <p className="text-xs text-slate-500">Fluxo guiado — do processo ao DOCX em poucos cliques.</p>
      </div>

      {offline && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-900 text-xs px-3 py-2">
          📴 <strong>Modo offline</strong> — usando modelos em cache local. A busca no Advbox/DataJud
          e o registro da petição ficarão indisponíveis até reconectar.
        </div>
      )}

      {/* Stepper */}
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s) => {
          const active = step === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setStep(s.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase border cursor-pointer ${
                active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">{error}</div>}

      {/* Step 1: Processo */}
      {step === 'processo' && (
        <Card>
          <CardHeader title="Dados do processo" subtitle="Informe o número para busca no Advbox + DataJud" />
          <CardBody className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <Label>Número do processo (CNJ)</Label>
                <Input value={processNumber} onChange={(e) => setProcessNumber(e.target.value)} placeholder="0000000-00.0000.0.00.0000" />
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={searchProcess} disabled={busy || !processNumber}>
                  {busy ? <Spinner /> : 'Buscar'}
                </Button>
                <Button variant="ghost" onClick={skipProcess}>Pular etapa</Button>
              </div>
            </div>

            {bundle && (
              <Card className="bg-slate-50">
                <CardBody className="text-xs text-slate-700">
                  {bundle.error && <div className="text-red-600 mb-2">Erro: {bundle.error}</div>}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div><strong>Cliente:</strong> {bundle.customer?.name || '—'}</div>
                    <div><strong>Classe:</strong> {bundle.lawsuit?.classe || '—'}</div>
                    <div><strong>Vara:</strong> {bundle.lawsuit?.vara || '—'}</div>
                    <div><strong>Comarca:</strong> {bundle.lawsuit?.comarca || '—'}</div>
                    <div><strong>Movimentações:</strong> {(bundle.movements || []).length}</div>
                  </div>
                </CardBody>
              </Card>
            )}

            {bundle && (
              <div className="flex justify-end">
                <Button onClick={() => setStep('modelo')}>Continuar →</Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Step 2: Modelo */}
      {step === 'modelo' && (
        <div className="space-y-4">
          {suggested.length > 0 && (
            <Card className="border-blue-300">
              <CardHeader title="✨ Sugestões automáticas" subtitle="Com base nas últimas movimentações" />
              <CardBody className="space-y-2">
                {suggested.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedModelId(m.id); advanceToResort(); }}
                    className="w-full text-left px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 cursor-pointer"
                  >
                    <div className="text-sm font-bold text-slate-800">{m.name}</div>
                    {m.description && <div className="text-[11px] text-slate-600">{m.description}</div>}
                  </button>
                ))}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Todos os modelos aprovados" />
            <CardBody>
              {themes.map((t) => {
                const ms = models.filter((m) => m.theme_id === t.id);
                if (!ms.length) return null;
                return (
                  <div key={t.id} className="mb-4">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">{t.name}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {ms.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { setSelectedModelId(m.id); }}
                          className={`text-left px-3 py-2 rounded-lg border cursor-pointer hover:border-slate-400 ${
                            selectedModelId === m.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                          }`}
                        >
                          <div className="text-sm font-bold text-slate-800">{m.name}</div>
                          {m.description && <div className="text-[11px] text-slate-500">{m.description}</div>}
                          <div className="mt-1">
                            <Badge color="slate">v{m.version}</Badge>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {models.length === 0 && <EmptyState title="Nenhum modelo aprovado disponível" />}
              {selectedModelId && (
                <div className="flex justify-end mt-4">
                  <Button onClick={advanceToResort}>Continuar →</Button>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Step 3: Resort */}
      {step === 'resort' && (
        <Card>
          <CardHeader title="Ficha de resort" subtitle="Este modelo usa dados da ficha do resort / grupo econômico" />
          <CardBody className="space-y-3">
            <Label>Selecionar resort</Label>
            <Select value={selectedResortId || ''} onChange={(e) => setSelectedResortId(e.target.value)}>
              <option value="">— selecione —</option>
              {resorts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.trade_name} {r.economic_group ? `(${r.economic_group})` : ''}
                </option>
              ))}
            </Select>
            {selectedResort && (
              <Card className="bg-slate-50">
                <CardBody className="text-xs text-slate-700 space-y-1">
                  <div><strong>Razão social:</strong> {selectedResort.legal_name || '—'}</div>
                  <div><strong>CNPJ:</strong> {selectedResort.cnpj || '—'}</div>
                  <div><strong>Grupo:</strong> {selectedResort.economic_group || '—'}</div>
                  <div><strong>Empresas cadastradas:</strong> {selectedResort.companies?.length || 0}</div>
                </CardBody>
              </Card>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setStep('blocos')} disabled={!selectedResort}>Continuar →</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 4: Blocos */}
      {step === 'blocos' && selectedModel && (
        <Card>
          <CardHeader title="Blocos do modelo" subtitle="Selecione, arraste para reordenar, e ajuste a ordem dos blocos da petição" />
          <CardBody className="space-y-2">
            {orderedBlocks.map((b, i) => {
              const checked = selectedBlockIds.includes(b.id);
              return (
                <div
                  key={b.id}
                  {...blockDnd.getItemProps(b)}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${checked ? 'border-slate-800 bg-slate-50' : 'border-slate-200'}`}
                >
                  <span className="cursor-grab text-slate-400 mt-1 select-none" title="Arrastar para reordenar">⋮⋮</span>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    disabled={b.is_required}
                    onChange={() => toggleBlock(b.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-800">{i + 1}. {b.title}</span>
                      {b.is_required && <Badge color="red">Obrigatório</Badge>}
                      {b.group_name && <Badge color="blue">{b.group_name}</Badge>}
                      {b.mutually_exclusive_group && <Badge color="purple">⊕ {b.mutually_exclusive_group}</Badge>}
                    </div>
                    {b.description && <div className="text-xs text-slate-500 mt-1">{b.description}</div>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="ghost" onClick={() => moveInOrder(b.id, 'up')}>↑</Button>
                    <Button size="sm" variant="ghost" onClick={() => moveInOrder(b.id, 'down')}>↓</Button>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button onClick={() => setStep('campos')}>Continuar →</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 5: Campos */}
      {step === 'campos' && (
        <Card>
          <CardHeader title="Preenchimento dos campos" subtitle={`${visiblePlaceholders.length} campo(s) usado(s) pelos blocos selecionados`} />
          <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visiblePlaceholders.length === 0 && <div className="text-xs text-slate-500">Não há campos a preencher nesta seleção.</div>}
            {visiblePlaceholders.map((p) => (
              <div key={p.id}>
                <Label required={p.is_required}>{p.label}</Label>
                {p.field_type === 'textarea' ? (
                  <Textarea
                    rows={3}
                    value={values[p.key] || ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                    placeholder={p.help_text || ''}
                  />
                ) : (
                  <Input
                    type={p.field_type === 'date' ? 'date' : p.field_type === 'number' || p.field_type === 'currency' ? 'number' : 'text'}
                    value={values[p.key] || ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                    placeholder={p.help_text || ''}
                  />
                )}
                {p.auto_source && p.auto_source !== 'manual' && (
                  <div className="text-[10px] text-slate-400 mt-1">Preenchido automaticamente: {p.auto_source}</div>
                )}
              </div>
            ))}
            <div className="md:col-span-2 flex justify-end">
              <Button onClick={() => setStep('preview')}>Revisar →</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 6: Preview */}
      {step === 'preview' && (
        <Card>
          <CardHeader
            title="Pré-visualização"
            subtitle="Confira o conteúdo final antes de gerar o DOCX"
            right={
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => generate(false)} disabled={busy}>
                  {busy ? <Spinner /> : 'Gerar DOCX'}
                </Button>
                <Button variant="primary" onClick={() => generate(true)} disabled={busy}>
                  Gerar DOCX + PDF
                </Button>
              </div>
            }
          />
          <CardBody>
            <div
              className="prose max-w-none text-sm leading-relaxed p-6 bg-white border border-slate-200 rounded-lg"
              style={{ fontFamily: 'Times New Roman, serif' }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
