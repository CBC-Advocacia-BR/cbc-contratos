import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  Button, Card, CardBody, CardHeader, Input, Label, Select, Spinner,
  Textarea, Badge, EmptyState,
} from '../components/ui/Primitives';
import { useRoute } from '../router';
import { useTesesAuth } from '../contexts/AuthContext';

const COMPANY_TYPES = [
  { value: 'holding', label: 'Holding' },
  { value: 'spe', label: 'SPE' },
  { value: 'securitizadora', label: 'Securitizadora' },
  { value: 'operadora', label: 'Operadora' },
  { value: 'incorporadora', label: 'Incorporadora' },
  { value: 'administradora', label: 'Administradora' },
  { value: 'outra', label: 'Outra' },
];

const FREQUENCIES = [
  { value: 'frequente', label: 'Frequente' },
  { value: 'ocasional', label: 'Ocasional' },
  { value: 'raro', label: 'Raro' },
];

const SUCCESS_RATES = [
  { value: 'alto', label: 'Alto' },
  { value: 'médio', label: 'Médio' },
  { value: 'baixo', label: 'Baixo' },
];

export default function ResortEditorPage({ resortId }) {
  const { navigate } = useRoute();
  const { profile, is } = useTesesAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resort, setResort] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [tab, setTab] = useState('cadastro');
  const [notice, setNotice] = useState(null);

  const canEdit = is('admin', 'coordenador');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [r, c] = await Promise.all([
        supabase.from('resorts').select('*').eq('id', resortId).maybeSingle(),
        supabase.from('resort_companies').select('*').eq('resort_id', resortId).order('legal_name'),
      ]);
      if (!mounted) return;
      setResort(r.data || null);
      setCompanies(c.data || []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [resortId]);

  const update = (patch) => setResort((r) => ({ ...r, ...patch }));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('resorts')
      .update({
        trade_name: resort.trade_name,
        legal_name: resort.legal_name,
        cnpj: resort.cnpj,
        address: resort.address,
        city: resort.city,
        state: resort.state,
        category: resort.category,
        economic_group: resort.economic_group,
        typical_defense_arguments: resort.typical_defense_arguments,
        cbc_counter_arguments: resort.cbc_counter_arguments,
        favorable_precedents: resort.favorable_precedents,
        procedural_behavior: resort.procedural_behavior,
        internal_notes: resort.internal_notes,
        updated_by: profile?.id || null,
      })
      .eq('id', resortId);
    setSaving(false);
    if (error) setNotice({ type: 'error', msg: error.message });
    else setNotice({ type: 'success', msg: 'Ficha salva.' });
  };

  // ─── Empresas do grupo ──────────────────────────────
  const addCompany = async () => {
    const { data, error } = await supabase
      .from('resort_companies')
      .insert({
        resort_id: resortId,
        legal_name: 'Nova empresa',
        company_type: 'outra',
        is_active: true,
      })
      .select()
      .single();
    if (error) { alert(error.message); return; }
    setCompanies((c) => [...c, data]);
  };

  const updateCompany = (id, patch) =>
    setCompanies((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const persistCompany = async (id) => {
    const comp = companies.find((c) => c.id === id);
    if (!comp) return;
    const { error } = await supabase
      .from('resort_companies')
      .update({
        legal_name: comp.legal_name,
        cnpj: comp.cnpj,
        company_type: comp.company_type,
        relationship_description: comp.relationship_description,
        address: comp.address,
        city: comp.city,
        state: comp.state,
        notes: comp.notes,
      })
      .eq('id', id);
    if (error) setNotice({ type: 'error', msg: error.message });
    else setNotice({ type: 'success', msg: 'Empresa salva.' });
  };

  const deleteCompany = async (id) => {
    if (!confirm('Remover esta empresa?')) return;
    await supabase.from('resort_companies').delete().eq('id', id);
    setCompanies((c) => c.filter((x) => x.id !== id));
  };

  // ─── JSONB helpers (arrays) ─────────────────────────
  const updateArrayItem = (field, index, patch) => {
    const arr = [...(resort[field] || [])];
    arr[index] = { ...arr[index], ...patch };
    update({ [field]: arr });
  };
  const addArrayItem = (field, blank) =>
    update({ [field]: [...(resort[field] || []), blank] });
  const removeArrayItem = (field, index) => {
    const arr = [...(resort[field] || [])];
    arr.splice(index, 1);
    update({ [field]: arr });
  };

  if (loading) return <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>;
  if (!resort) return <EmptyState title="Resort não encontrado" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <button onClick={() => navigate('/resorts')} className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer">← voltar</button>
          <h1 className="text-xl font-bold text-slate-800 mt-1">{resort.trade_name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge color={resort.category === 'principal' ? 'blue' : 'slate'}>
              {resort.category === 'principal' ? 'Principal' : 'Pontual'}
            </Badge>
            {resort.economic_group && <Badge color="purple">{resort.economic_group}</Badge>}
          </div>
        </div>
        {canEdit && (
          <Button onClick={save} disabled={saving}>
            {saving ? <Spinner /> : 'Salvar ficha'}
          </Button>
        )}
      </div>

      {notice && (
        <div className={`rounded-lg px-3 py-2 text-xs ${notice.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          {notice.msg}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200 flex-wrap">
        {[
          { key: 'cadastro', label: 'Cadastro' },
          { key: 'empresas', label: `Empresas (${companies.length})` },
          { key: 'defesa', label: 'Argumentos' },
          { key: 'precedentes', label: 'Jurisprudência' },
          { key: 'comportamento', label: 'Comportamento' },
          { key: 'notas', label: 'Notas' },
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

      {tab === 'cadastro' && (
        <Card>
          <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <Label required>Nome fantasia</Label>
              <Input disabled={!canEdit} value={resort.trade_name || ''} onChange={(e) => update({ trade_name: e.target.value })} />
            </div>
            <div>
              <Label>Categoria</Label>
              <Select disabled={!canEdit} value={resort.category || 'principal'} onChange={(e) => update({ category: e.target.value })}>
                <option value="principal">Principal</option>
                <option value="pontual">Pontual</option>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Razão social</Label>
              <Input disabled={!canEdit} value={resort.legal_name || ''} onChange={(e) => update({ legal_name: e.target.value })} />
            </div>
            <div>
              <Label>CNPJ</Label>
              <Input disabled={!canEdit} value={resort.cnpj || ''} onChange={(e) => update({ cnpj: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Endereço</Label>
              <Input disabled={!canEdit} value={resort.address || ''} onChange={(e) => update({ address: e.target.value })} />
            </div>
            <div>
              <Label>UF</Label>
              <Input disabled={!canEdit} value={resort.state || ''} onChange={(e) => update({ state: e.target.value })} maxLength={2} />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input disabled={!canEdit} value={resort.city || ''} onChange={(e) => update({ city: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Grupo econômico</Label>
              <Input disabled={!canEdit} value={resort.economic_group || ''} onChange={(e) => update({ economic_group: e.target.value })} placeholder="Ex: WAM Group" />
            </div>
          </CardBody>
        </Card>
      )}

      {tab === 'empresas' && (
        <div className="space-y-3">
          {canEdit && (
            <div className="flex justify-end">
              <Button onClick={addCompany}>+ Adicionar empresa</Button>
            </div>
          )}
          {companies.length === 0 ? (
            <EmptyState title="Nenhuma empresa cadastrada" description="Adicione as empresas que compõem o grupo econômico." />
          ) : (
            companies.map((c) => (
              <Card key={c.id}>
                <CardHeader
                  title={c.legal_name}
                  subtitle={COMPANY_TYPES.find((t) => t.value === c.company_type)?.label || '—'}
                  right={
                    canEdit && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => persistCompany(c.id)}>Salvar</Button>
                        <Button size="sm" variant="danger" onClick={() => deleteCompany(c.id)}>Remover</Button>
                      </div>
                    )
                  }
                />
                <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <Label required>Razão social</Label>
                    <Input disabled={!canEdit} value={c.legal_name || ''} onChange={(e) => updateCompany(c.id, { legal_name: e.target.value })} />
                  </div>
                  <div>
                    <Label>CNPJ</Label>
                    <Input disabled={!canEdit} value={c.cnpj || ''} onChange={(e) => updateCompany(c.id, { cnpj: e.target.value })} />
                  </div>
                  <div>
                    <Label>Tipo</Label>
                    <Select disabled={!canEdit} value={c.company_type || 'outra'} onChange={(e) => updateCompany(c.id, { company_type: e.target.value })}>
                      {COMPANY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>Vínculo / descrição</Label>
                    <Input disabled={!canEdit} value={c.relationship_description || ''} onChange={(e) => updateCompany(c.id, { relationship_description: e.target.value })} placeholder="Ex: SPE proprietária do empreendimento X" />
                  </div>
                </CardBody>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'defesa' && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Argumentos típicos de defesa"
              right={canEdit && <Button size="sm" onClick={() => addArrayItem('typical_defense_arguments', { argument: '', frequency: 'frequente', legal_basis: '' })}>+ Adicionar</Button>}
            />
            <CardBody className="space-y-3">
              {(resort.typical_defense_arguments || []).length === 0 && <div className="text-xs text-slate-500">Nenhum argumento cadastrado.</div>}
              {(resort.typical_defense_arguments || []).map((a, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-start border-b border-slate-100 pb-3">
                  <div className="md:col-span-3">
                    <Label>Argumento</Label>
                    <Textarea disabled={!canEdit} rows={2} value={a.argument || ''} onChange={(e) => updateArrayItem('typical_defense_arguments', i, { argument: e.target.value })} />
                  </div>
                  <div>
                    <Label>Frequência</Label>
                    <Select disabled={!canEdit} value={a.frequency || 'frequente'} onChange={(e) => updateArrayItem('typical_defense_arguments', i, { frequency: e.target.value })}>
                      {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>Fundamento legal</Label>
                    <Input disabled={!canEdit} value={a.legal_basis || ''} onChange={(e) => updateArrayItem('typical_defense_arguments', i, { legal_basis: e.target.value })} />
                  </div>
                  {canEdit && (
                    <div className="md:col-span-6 flex justify-end">
                      <Button size="sm" variant="danger" onClick={() => removeArrayItem('typical_defense_arguments', i)}>Remover</Button>
                    </div>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Contra-argumentos CBC"
              right={canEdit && <Button size="sm" onClick={() => addArrayItem('cbc_counter_arguments', { defense_argument_ref: '', counter_argument: '', legal_basis: '', success_rate: 'alto' })}>+ Adicionar</Button>}
            />
            <CardBody className="space-y-3">
              {(resort.cbc_counter_arguments || []).length === 0 && <div className="text-xs text-slate-500">Nenhum contra-argumento cadastrado.</div>}
              {(resort.cbc_counter_arguments || []).map((c, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-6 gap-3 border-b border-slate-100 pb-3">
                  <div className="md:col-span-3">
                    <Label>Contra-argumento</Label>
                    <Textarea disabled={!canEdit} rows={2} value={c.counter_argument || ''} onChange={(e) => updateArrayItem('cbc_counter_arguments', i, { counter_argument: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Fundamento</Label>
                    <Input disabled={!canEdit} value={c.legal_basis || ''} onChange={(e) => updateArrayItem('cbc_counter_arguments', i, { legal_basis: e.target.value })} />
                  </div>
                  <div>
                    <Label>Taxa de êxito</Label>
                    <Select disabled={!canEdit} value={c.success_rate || 'alto'} onChange={(e) => updateArrayItem('cbc_counter_arguments', i, { success_rate: e.target.value })}>
                      {SUCCESS_RATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                  </div>
                  {canEdit && (
                    <div className="md:col-span-6 flex justify-end">
                      <Button size="sm" variant="danger" onClick={() => removeArrayItem('cbc_counter_arguments', i)}>Remover</Button>
                    </div>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'precedentes' && (
        <Card>
          <CardHeader
            title="Jurisprudência favorável"
            right={canEdit && <Button size="sm" onClick={() => addArrayItem('favorable_precedents', { tribunal: '', case_number: '', rapporteur: '', date: '', summary: '', theme: '' })}>+ Adicionar</Button>}
          />
          <CardBody className="space-y-3">
            {(resort.favorable_precedents || []).length === 0 && <div className="text-xs text-slate-500">Nenhum precedente cadastrado.</div>}
            {(resort.favorable_precedents || []).map((p, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-6 gap-3 border-b border-slate-100 pb-3">
                <div>
                  <Label>Tribunal</Label>
                  <Input disabled={!canEdit} value={p.tribunal || ''} onChange={(e) => updateArrayItem('favorable_precedents', i, { tribunal: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label>Número</Label>
                  <Input disabled={!canEdit} value={p.case_number || ''} onChange={(e) => updateArrayItem('favorable_precedents', i, { case_number: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label>Relator</Label>
                  <Input disabled={!canEdit} value={p.rapporteur || ''} onChange={(e) => updateArrayItem('favorable_precedents', i, { rapporteur: e.target.value })} />
                </div>
                <div>
                  <Label>Data</Label>
                  <Input disabled={!canEdit} value={p.date || ''} onChange={(e) => updateArrayItem('favorable_precedents', i, { date: e.target.value })} />
                </div>
                <div className="md:col-span-6">
                  <Label>Ementa (resumo)</Label>
                  <Textarea disabled={!canEdit} rows={2} value={p.summary || ''} onChange={(e) => updateArrayItem('favorable_precedents', i, { summary: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label>Tema</Label>
                  <Input disabled={!canEdit} value={p.theme || ''} onChange={(e) => updateArrayItem('favorable_precedents', i, { theme: e.target.value })} />
                </div>
                {canEdit && (
                  <div className="md:col-span-4 flex justify-end items-end">
                    <Button size="sm" variant="danger" onClick={() => removeArrayItem('favorable_precedents', i)}>Remover</Button>
                  </div>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {tab === 'comportamento' && (
        <Card>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={!!resort.procedural_behavior?.files_embargos}
                  onChange={(e) => update({ procedural_behavior: { ...(resort.procedural_behavior || {}), files_embargos: e.target.checked } })}
                />
                Opõe embargos à execução
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={!!resort.procedural_behavior?.requests_installments_916}
                  onChange={(e) => update({ procedural_behavior: { ...(resort.procedural_behavior || {}), requests_installments_916: e.target.checked } })}
                />
                Pede parcelamento (art. 916 CPC)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={!!resort.procedural_behavior?.has_seizable_assets}
                  onChange={(e) => update({ procedural_behavior: { ...(resort.procedural_behavior || {}), has_seizable_assets: e.target.checked } })}
                />
                Tem patrimônio penhorável
              </label>
            </div>
            <div>
              <Label>Estratégia preferida de defesa</Label>
              <Input disabled={!canEdit} value={resort.procedural_behavior?.preferred_defense_strategy || ''} onChange={(e) => update({ procedural_behavior: { ...(resort.procedural_behavior || {}), preferred_defense_strategy: e.target.value } })} />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea disabled={!canEdit} rows={4} value={resort.procedural_behavior?.observations || ''} onChange={(e) => update({ procedural_behavior: { ...(resort.procedural_behavior || {}), observations: e.target.value } })} />
            </div>
          </CardBody>
        </Card>
      )}

      {tab === 'notas' && (
        <Card>
          <CardBody>
            <Label>Notas internas (apenas coordenação)</Label>
            <Textarea disabled={!canEdit} rows={12} value={resort.internal_notes || ''} onChange={(e) => update({ internal_notes: e.target.value })} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
