import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  Card, CardBody, CardHeader, Button, Spinner, EmptyState, Badge,
} from '../components/ui/Primitives';
import { diffModelSnapshots } from '../lib/versionDiff';
import { useRoute } from '../router';

const KIND_LABELS = {
  'meta': 'Metadados',
  'block-changed': 'Bloco alterado',
  'block-added': 'Bloco adicionado',
  'block-removed': 'Bloco removido',
  'placeholder-added': 'Campo adicionado',
  'placeholder-removed': 'Campo removido',
};

const KIND_COLORS = {
  'meta': 'blue',
  'block-changed': 'yellow',
  'block-added': 'emerald',
  'block-removed': 'red',
  'placeholder-added': 'emerald',
  'placeholder-removed': 'red',
};

export default function VersionHistoryPage({ modelId }) {
  const { navigate } = useRoute();
  const [model, setModel] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);

  useEffect(() => {
    (async () => {
      const [m, v] = await Promise.all([
        supabase.from('models').select('*').eq('id', modelId).maybeSingle(),
        supabase.from('model_versions').select('*').eq('model_id', modelId).order('version_number', { ascending: false }),
      ]);
      setModel(m.data || null);
      setVersions(v.data || []);
      if (v.data?.length >= 2) {
        setCompareA(v.data[1].id);
        setCompareB(v.data[0].id);
      } else if (v.data?.length === 1) {
        setCompareB(v.data[0].id);
      }
      setLoading(false);
    })();
  }, [modelId]);

  const diffItems = useMemo(() => {
    const va = versions.find((x) => x.id === compareA);
    const vb = versions.find((x) => x.id === compareB);
    if (!va || !vb) return null;
    return diffModelSnapshots(va.snapshot, vb.snapshot);
  }, [versions, compareA, compareB]);

  if (loading) return <div className="flex items-center gap-2 text-slate-500"><Spinner /> Carregando...</div>;
  if (!model) return <EmptyState title="Modelo não encontrado" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <button onClick={() => navigate(`/models/${modelId}`)} className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer">← voltar ao modelo</button>
          <h1 className="text-xl font-bold text-slate-800 mt-1">{model.name}</h1>
          <p className="text-xs text-slate-500">Histórico de versões aprovadas e diff visual.</p>
        </div>
        <Badge color="slate">{versions.length} versão(ões)</Badge>
      </div>

      {versions.length === 0 ? (
        <EmptyState title="Sem histórico" description="Este modelo ainda não foi aprovado." />
      ) : (
        <>
          <Card>
            <CardHeader title="Linha do tempo" />
            <CardBody>
              <ul className="divide-y divide-slate-100">
                {versions.map((v) => (
                  <li key={v.id} className="py-2 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-slate-800">v{v.version_number}</div>
                      <div className="text-slate-500">
                        {v.change_description || 'sem descrição'} ·{' '}
                        {new Date(v.created_at).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-slate-500">
                        <input type="radio" name="compareA" checked={compareA === v.id} onChange={() => setCompareA(v.id)} /> A
                      </label>
                      <label className="flex items-center gap-1 text-slate-500">
                        <input type="radio" name="compareB" checked={compareB === v.id} onChange={() => setCompareB(v.id)} /> B
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Diff A → B"
              subtitle="Comparação entre as versões selecionadas"
              right={
                <Button variant="outline" size="sm" onClick={() => { const tmp = compareA; setCompareA(compareB); setCompareB(tmp); }}>
                  ↔ Inverter
                </Button>
              }
            />
            <CardBody>
              {!compareA || !compareB ? (
                <div className="text-xs text-slate-500">Selecione duas versões para comparar.</div>
              ) : !diffItems || diffItems.length === 0 ? (
                <div className="text-xs text-slate-500">Nenhuma diferença encontrada.</div>
              ) : (
                <div className="space-y-4">
                  {diffItems.map((d, i) => (
                    <div key={i} className="border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge color={KIND_COLORS[d.kind] || 'slate'}>{KIND_LABELS[d.kind] || d.kind}</Badge>
                        <span className="text-xs font-bold text-slate-700">{d.field || d.title}</span>
                      </div>
                      {d.html && (
                        <div
                          className="text-xs leading-relaxed whitespace-pre-wrap bg-slate-50 p-2 rounded"
                          dangerouslySetInnerHTML={{ __html: d.html }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
