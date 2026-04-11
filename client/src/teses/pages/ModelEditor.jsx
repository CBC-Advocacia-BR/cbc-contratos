import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  Button, Card, CardBody, CardHeader, Input, Label, Select, Spinner,
  StatusBadge, Textarea, Badge, EmptyState,
} from '../components/ui/Primitives';
import { useRoute } from '../router';
import { useTesesAuth } from '../contexts/AuthContext';

const AUTO_SOURCES = [
  { value: 'manual', label: 'Preencher manualmente' },
  { value: 'advbox_customer_name', label: 'Advbox — nome do cliente' },
  { value: 'advbox_customer_cpf', label: 'Advbox — CPF do cliente' },
  { value: 'advbox_customer_cnpj', label: 'Advbox — CNPJ do cliente' },
  { value: 'advbox_process_number', label: 'Advbox — número do processo' },
  { value: 'advbox_process_type', label: 'Advbox — tipo do processo' },
  { value: 'advbox_process_stage', label: 'Advbox — fase do processo' },
  { value: 'advbox_responsible', label: 'Advbox — advogado responsável' },
  { value: 'advbox_folder', label: 'Advbox — pasta' },
  { value: 'datajud_classe', label: 'DataJud — classe processual' },
  { value: 'datajud_assunto', label: 'DataJud — assunto' },
  { value: 'datajud_vara', label: 'DataJud — vara' },
  { value: 'datajud_comarca', label: 'DataJud — comarca' },
  { value: 'datajud_juiz', label: 'DataJud — juiz' },
  { value: 'datajud_data_distribuicao', label: 'DataJud — data de distribuição' },
  { value: 'resort_razao_social', label: 'Resort — razão social' },
  { value: 'resort_cnpj', label: 'Resort — CNPJ' },
  { value: 'resort_endereco', label: 'Resort — endereço' },
  { value: 'resort_grupo', label: 'Resort — grupo econômico' },
  { value: 'resort_empresas_grupo', label: 'Resort — empresas do grupo' },
  { value: 'resort_argumentos_defesa', label: 'Resort — argumentos de defesa' },
  { value: 'resort_contra_argumentos', label: 'Resort — contra-argumentos CBC' },
];

const FIELD_TYPES = [
  { value: 'text', label: 'Texto curto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'number', label: 'Número' },
  { value: 'currency', label: 'Valor R$' },
  { value: 'date', label: 'Data' },
  { value: 'select', label: 'Seleção única' },
  { value: 'multi_select', label: 'Seleção múltipla' },
];

export default function ModelEditorPage({ modelId }) {
  const { navigate } = useRoute();
  const { profile, is } = useTesesAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [model, setModel] = useState(null);
  const [themes, setThemes] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [placeholders, setPlaceholders] = useState([]);
  const [tab, setTab] = useState('metadados');
  const [notice, setNotice] = useState(null);

  const isOwner = model?.created_by && profile?.id === model?.created_by;
  const canEdit = is('admin', 'coordenador') || (is('especialista') && isOwner && model?.status !== 'aprovado');
  const canApprove = is('admin', 'coordenador') && model?.status === 'em_revisao';

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [m, t, b, p] = await Promise.all([
        supabase.from('models').select('*').eq('id', modelId).maybeSingle(),
        supabase.from('themes').select('*').order('display_order'),
        supabase.from('model_blocks').select('*').eq('model_id', modelId).order('display_order'),
        supabase.from('placeholders').select('*').eq('model_id', modelId).order('display_order'),
      ]);
      if (!mounted) return;
      if (m.error) setNotice({ type: 'error', msg: m.error.message });
      setModel(m.data || null);
      setThemes(t.data || []);
      setBlocks(b.data || []);
      setPlaceholders(p.data || []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [modelId]);

  const updateField = (key, value) => setModel((m) => ({ ...m, [key]: value }));

  const saveModel = async () => {
    if (!canEdit || !model) return;
    setSaving(true);
    const { error } = await supabase
      .from('models')
      .update({
        name: model.name,
        description: model.description,
        theme_id: model.theme_id,
        fixed_header: model.fixed_header,
        fixed_footer: model.fixed_footer,
        requires_resort_data: model.requires_resort_data,
        requires_calculation: model.requires_calculation,
        trigger_movements: model.trigger_movements || [],
        trigger_keywords: model.trigger_keywords || [],
      })
      .eq('id', modelId);
    setSaving(false);
    if (error) setNotice({ type: 'error', msg: error.message });
    else setNotice({ type: 'success', msg: 'Modelo salvo.' });
  };

  const submitForReview = async () => {
    if (!canEdit) return;
    const { error } = await supabase
      .from('models')
      .update({ status: 'em_revisao' })
      .eq('id', modelId);
    if (error) { setNotice({ type: 'error', msg: error.message }); return; }
    // cria notificação para coordenadores/admins
    const { data: coords } = await supabase.from('profiles').select('id').in('role', ['coordenador', 'admin']).eq('is_active', true);
    if (coords?.length) {
      await supabase.from('notifications').insert(
        coords.map((c) => ({
          recipient_id: c.id,
          type: 'model_submitted',
          title: 'Modelo submetido para aprovação',
          message: `O modelo "${model.name}" foi submetido para revisão.`,
          reference_type: 'model',
          reference_id: modelId,
        }))
      );
    }
    setModel((m) => ({ ...m, status: 'em_revisao' }));
    setNotice({ type: 'success', msg: 'Enviado para revisão.' });
  };

  const approveModel = async () => {
    if (!canApprove) return;
    const newVersion = (model.version || 1) + 1;
    // Cria snapshot da versão aprovada
    const snapshot = { model, blocks, placeholders };
    await supabase.from('model_versions').insert({
      model_id: modelId,
      version_number: newVersion,
      snapshot,
      change_description: 'Aprovado',
      changed_by: profile?.id,
      approved_by: profile?.id,
      approved_at: new Date().toISOString(),
    });
    const { error } = await supabase
      .from('models')
      .update({ status: 'aprovado', version: newVersion, approved_by: profile?.id, approved_at: new Date().toISOString() })
      .eq('id', modelId);
    if (error) { setNotice({ type: 'error', msg: error.message }); return; }
    // Notifica o autor
    if (model.created_by) {
      await supabase.from('notifications').insert({
        recipient_id: model.created_by,
        type: 'model_approved',
        title: 'Seu modelo foi aprovado',
        message: `O modelo "${model.name}" foi aprovado (v${newVersion}).`,
        reference_type: 'model',
        reference_id: modelId,
      });
    }
    setModel((m) => ({ ...m, status: 'aprovado', version: newVersion }));
    setNotice({ type: 'success', msg: 'Modelo aprovado.' });
  };

  const rejectModel = async () => {
    if (!canApprove) return;
    const comments = prompt('Motivo da rejeição:');
    if (!comments) return;
    await supabase.from('models').update({ status: 'rascunho', review_comments: comments }).eq('id', modelId);
    if (model.created_by) {
      await supabase.from('notifications').insert({
        recipient_id: model.created_by,
        type: 'model_rejected',
        title: 'Seu modelo foi rejeitado',
        message: `Motivo: ${comments}`,
        reference_type: 'model',
        reference_id: modelId,
      });
    }
    setModel((m) => ({ ...m, status: 'rascunho', review_comments: comments }));
    setNotice({ type: 'success', msg: 'Modelo devolvido para rascunho.' });
  };

  const setObsolete = async () => {
    if (!is('admin', 'coordenador')) return;
    if (!confirm('Marcar este modelo como obsoleto?')) return;
    await supabase.from('models').update({ status: 'obsoleto' }).eq('id', modelId);
    setModel((m) => ({ ...m, status: 'obsoleto' }));
  };

  // ─── Blocos ──────────────────────────────────────────────
  const addBlock = async () => {
    const order = (blocks[blocks.length - 1]?.display_order || 0) + 10;
    const { data, error } = await supabase
      .from('model_blocks')
      .insert({
        model_id: modelId,
        title: 'Novo bloco',
        content: '',
        display_order: order,
        is_required: false,
        is_default_selected: true,
        created_by: profile?.id || null,
      })
      .select()
      .single();
    if (error) { alert(error.message); return; }
    setBlocks((b) => [...b, data]);
  };

  const updateBlock = async (id, patch) => {
    setBlocks((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const persistBlock = async (id) => {
    const blk = blocks.find((b) => b.id === id);
    if (!blk) return;
    const { error } = await supabase
      .from('model_blocks')
      .update({
        title: blk.title,
        description: blk.description,
        content: blk.content,
        is_required: blk.is_required,
        is_default_selected: blk.is_default_selected,
        group_name: blk.group_name,
        mutually_exclusive_group: blk.mutually_exclusive_group,
      })
      .eq('id', id);
    if (error) setNotice({ type: 'error', msg: error.message });
    else setNotice({ type: 'success', msg: 'Bloco salvo.' });
  };

  const deleteBlock = async (id) => {
    if (!confirm('Remover este bloco?')) return;
    await supabase.from('model_blocks').delete().eq('id', id);
    setBlocks((b) => b.filter((x) => x.id !== id));
  };

  const moveBlock = async (id, dir) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= blocks.length) return;
    const a = blocks[idx], b = blocks[swap];
    await Promise.all([
      supabase.from('model_blocks').update({ display_order: b.display_order }).eq('id', a.id),
      supabase.from('model_blocks').update({ display_order: a.display_order }).eq('id', b.id),
    ]);
    const next = [...blocks];
    next[idx] = { ...b, display_order: a.display_order };
    next[swap] = { ...a, display_order: b.display_order };
    next.sort((x, y) => x.display_order - y.display_order);
    setBlocks(next);
  };

  // ─── Placeholders ────────────────────────────────────────
  const addPlaceholder = async () => {
    const order = (placeholders[placeholders.length - 1]?.display_order || 0) + 10;
    const key = `campo_${placeholders.length + 1}`;
    const { data, error } = await supabase
      .from('placeholders')
      .insert({
        model_id: modelId,
        key,
        label: 'Novo campo',
        field_type: 'text',
        auto_source: 'manual',
        is_required: true,
        display_order: order,
      })
      .select()
      .single();
    if (error) { alert(error.message); return; }
    setPlaceholders((p) => [...p, data]);
  };

  const updatePlaceholder = (id, patch) =>
    setPlaceholders((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const persistPlaceholder = async (id) => {
    const ph = placeholders.find((p) => p.id === id);
    if (!ph) return;
    const { error } = await supabase
      .from('placeholders')
      .update({
        key: ph.key,
        label: ph.label,
        field_type: ph.field_type,
        auto_source: ph.auto_source,
        is_required: ph.is_required,
        default_value: ph.default_value,
        help_text: ph.help_text,
      })
      .eq('id', id);
    if (error) setNotice({ type: 'error', msg: error.message });
    else setNotice({ type: 'success', msg: 'Campo salvo.' });
  };

  const deletePlaceholder = async (id) => {
    if (!confirm('Remover este campo?')) return;
    await supabase.from('placeholders').delete().eq('id', id);
    setPlaceholders((p) => p.filter((x) => x.id !== id));
  };

  if (loading) return <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando modelo...</div>;
  if (!model) return <EmptyState title="Modelo não encontrado" description="Pode ter sido removido." />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/models')} className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer">← voltar</button>
            <StatusBadge status={model.status} />
            <Badge color="slate">v{model.version}</Badge>
          </div>
          <h1 className="text-xl font-bold text-slate-800 mt-1 truncate">{model.name}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <Button variant="secondary" onClick={saveModel} disabled={saving}>
              {saving ? <Spinner /> : 'Salvar'}
            </Button>
          )}
          {canEdit && model.status === 'rascunho' && (
            <Button variant="primary" onClick={submitForReview}>Enviar para revisão</Button>
          )}
          {canApprove && (
            <>
              <Button variant="success" onClick={approveModel}>Aprovar</Button>
              <Button variant="danger" onClick={rejectModel}>Rejeitar</Button>
            </>
          )}
          {is('admin', 'coordenador') && model.status !== 'obsoleto' && (
            <Button variant="outline" onClick={setObsolete}>Marcar obsoleto</Button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`rounded-lg px-3 py-2 text-xs ${notice.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          {notice.msg}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {[
          { key: 'metadados', label: 'Metadados' },
          { key: 'blocos', label: `Blocos (${blocks.length})` },
          { key: 'campos', label: `Campos (${placeholders.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-bold uppercase cursor-pointer border-b-2 ${
              tab === t.key ? 'text-slate-900 border-slate-900' : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'metadados' && (
        <Card>
          <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label required>Nome</Label>
              <Input disabled={!canEdit} value={model.name || ''} onChange={(e) => updateField('name', e.target.value)} />
            </div>
            <div>
              <Label required>Tema</Label>
              <Select disabled={!canEdit} value={model.theme_id || ''} onChange={(e) => updateField('theme_id', e.target.value)}>
                {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Opções</Label>
              <div className="flex flex-wrap gap-3 pt-2 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={!!model.requires_resort_data}
                    onChange={(e) => updateField('requires_resort_data', e.target.checked)}
                  />
                  Requer ficha de resort
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={!!model.requires_calculation}
                    onChange={(e) => updateField('requires_calculation', e.target.checked)}
                  />
                  Requer cálculo
                </label>
              </div>
            </div>
            <div className="md:col-span-2">
              <Label>Descrição (para o operacional)</Label>
              <Textarea
                disabled={!canEdit}
                value={model.description || ''}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Quando usar este modelo"
              />
            </div>
            <div>
              <Label>Cabeçalho fixo (endereçamento)</Label>
              <Textarea
                disabled={!canEdit}
                rows={5}
                value={model.fixed_header || ''}
                onChange={(e) => updateField('fixed_header', e.target.value)}
                placeholder="EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO..."
              />
            </div>
            <div>
              <Label>Rodapé fixo (pedidos + assinatura)</Label>
              <Textarea
                disabled={!canEdit}
                rows={5}
                value={model.fixed_footer || ''}
                onChange={(e) => updateField('fixed_footer', e.target.value)}
                placeholder="Nestes termos, pede deferimento. Local/data. Advogado."
              />
            </div>
            <div>
              <Label>Palavras-chave de sugestão automática</Label>
              <Input
                disabled={!canEdit}
                value={(model.trigger_keywords || []).join(', ')}
                onChange={(e) => updateField('trigger_keywords', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                placeholder="sisbajud, embargos, cumprimento"
              />
              <p className="text-[10px] text-slate-500 mt-1">Separe por vírgula. Disparará sugestão quando movimentações do processo contiverem estas palavras.</p>
            </div>
            <div>
              <Label>Movimentações-gatilho</Label>
              <Input
                disabled={!canEdit}
                value={(model.trigger_movements || []).join(', ')}
                onChange={(e) => updateField('trigger_movements', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                placeholder="embargos, sentença"
              />
            </div>
          </CardBody>
        </Card>
      )}

      {tab === 'blocos' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Os blocos são as unidades que o operacional poderá (des)marcar e reordenar na hora de gerar a petição.
              Use <code className="bg-slate-100 px-1 rounded">{'{{chave}}'}</code> para referenciar placeholders.
            </p>
            {canEdit && <Button onClick={addBlock}>+ Adicionar bloco</Button>}
          </div>
          {blocks.length === 0 ? (
            <EmptyState title="Sem blocos" description="Adicione o primeiro bloco do modelo." />
          ) : (
            blocks.map((b, i) => (
              <Card key={b.id}>
                <CardHeader
                  title={`Bloco ${i + 1}`}
                  subtitle={b.title}
                  right={
                    canEdit && (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => moveBlock(b.id, 'up')}>↑</Button>
                        <Button size="sm" variant="ghost" onClick={() => moveBlock(b.id, 'down')}>↓</Button>
                        <Button size="sm" variant="secondary" onClick={() => persistBlock(b.id)}>Salvar</Button>
                        <Button size="sm" variant="danger" onClick={() => deleteBlock(b.id)}>Remover</Button>
                      </div>
                    )
                  }
                />
                <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <Label required>Título</Label>
                    <Input disabled={!canEdit} value={b.title || ''} onChange={(e) => updateBlock(b.id, { title: e.target.value })} />
                  </div>
                  <div>
                    <Label>Grupo visual</Label>
                    <Input disabled={!canEdit} value={b.group_name || ''} onChange={(e) => updateBlock(b.id, { group_name: e.target.value })} placeholder="Ex: Teses de defesa" />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Descrição (quando marcar?)</Label>
                    <Input disabled={!canEdit} value={b.description || ''} onChange={(e) => updateBlock(b.id, { description: e.target.value })} />
                  </div>
                  <div>
                    <Label>Grupo mutuamente exclusivo</Label>
                    <Input
                      disabled={!canEdit}
                      value={b.mutually_exclusive_group || ''}
                      onChange={(e) => updateBlock(b.id, { mutually_exclusive_group: e.target.value })}
                      placeholder="Ex: tese-principal"
                    />
                  </div>
                  <div className="md:col-span-3 flex gap-5 text-xs">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" disabled={!canEdit} checked={!!b.is_required} onChange={(e) => updateBlock(b.id, { is_required: e.target.checked })} />
                      Obrigatório
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" disabled={!canEdit} checked={!!b.is_default_selected} onChange={(e) => updateBlock(b.id, { is_default_selected: e.target.checked })} />
                      Marcado por padrão
                    </label>
                  </div>
                  <div className="md:col-span-3">
                    <Label required>Conteúdo</Label>
                    <Textarea
                      disabled={!canEdit}
                      rows={8}
                      value={b.content || ''}
                      onChange={(e) => updateBlock(b.id, { content: e.target.value })}
                      placeholder="Texto do bloco. Use {{chave}} para placeholders."
                    />
                  </div>
                </CardBody>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'campos' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Defina cada placeholder (campo variável) usado nos blocos. A chave é o que aparece entre
              <code className="bg-slate-100 px-1 rounded mx-1">{'{{chaves}}'}</code>.
            </p>
            {canEdit && <Button onClick={addPlaceholder}>+ Adicionar campo</Button>}
          </div>
          {placeholders.length === 0 ? (
            <EmptyState title="Sem campos" description="Adicione os placeholders do modelo." />
          ) : (
            <Card>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="px-4 py-3">Chave</th>
                    <th className="px-4 py-3">Rótulo</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Fonte automática</th>
                    <th className="px-4 py-3">Obrigatório</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {placeholders.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="px-4 py-2">
                        <Input disabled={!canEdit} value={p.key} onChange={(e) => updatePlaceholder(p.id, { key: e.target.value })} />
                      </td>
                      <td className="px-4 py-2">
                        <Input disabled={!canEdit} value={p.label || ''} onChange={(e) => updatePlaceholder(p.id, { label: e.target.value })} />
                      </td>
                      <td className="px-4 py-2">
                        <Select disabled={!canEdit} value={p.field_type} onChange={(e) => updatePlaceholder(p.id, { field_type: e.target.value })}>
                          {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </Select>
                      </td>
                      <td className="px-4 py-2">
                        <Select disabled={!canEdit} value={p.auto_source || 'manual'} onChange={(e) => updatePlaceholder(p.id, { auto_source: e.target.value })}>
                          {AUTO_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </Select>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="checkbox" disabled={!canEdit} checked={!!p.is_required} onChange={(e) => updatePlaceholder(p.id, { is_required: e.target.checked })} />
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {canEdit && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => persistPlaceholder(p.id)}>Salvar</Button>
                            <Button size="sm" variant="danger" className="ml-2" onClick={() => deletePlaceholder(p.id)}>X</Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
