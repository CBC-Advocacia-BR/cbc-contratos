import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { SkeletonAdmin } from './Skeleton';
import ErrorState from './ErrorState';
import ConfirmDestructive from './ConfirmDestructive';
import { useEmpreendimentos } from '../hooks/useEmpreendimentos';
import { TIPOS_ACAO } from '../data/clausulas';
import {
  Cog6ToothIcon,
  DocumentTextIcon,
  CurrencyDollarIcon,
  SparklesIcon,
  FlagIcon,
  ChartBarIcon,
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  TagIcon,
  ListBulletIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';

// ============================================================
// Helpers
// ============================================================
const STAR = '*'; // coringa para regra padrao
const LABEL_STAR = '\u2605 PADRAO';

const OBRIGATORIEDADE_OPTS = [
  { value: 'obrigatorio', label: 'Obrigatorio' },
  { value: 'opcional', label: 'Opcional' },
  { value: 'condicional', label: 'Condicional' },
];

const TIPO_PROMO_OPTS = [
  { value: 'equiparar_exito_iniciais', label: 'Equiparar so-exito a iniciais+exito' },
  { value: 'multiplicador', label: 'Multiplicador customizado' },
  { value: 'valor_fixo', label: 'Valor fixo extra por contrato' },
];

function formatBRL(v) {
  if (v === null || v === undefined || v === '') return 'R$ 0,00';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseNumber(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function formatDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return iso; }
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  try {
    const a = new Date(from + 'T00:00:00');
    const b = new Date(to + 'T00:00:00');
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  } catch { return 0; }
}

function isMissingTableError(err) {
  const msg = err?.message || '';
  return /relation .* does not exist/i.test(msg) || /schema cache/i.test(msg) || /could not find the table/i.test(msg);
}

// ============================================================
// Toast global (ligado ao pattern do App.jsx)
// ============================================================
function ToastMsg({ msg }) {
  if (!msg) return null;
  const isErr = /^(Erro|Falha)/i.test(msg);
  return (
    <div className={`px-3 py-2 rounded-lg text-xs font-bold mb-3 ${isErr ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-green-100 text-green-800 border border-green-200'}`}>
      {msg}
    </div>
  );
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function VendasParametrizacaoPanel() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(null); // null=loading, true=ok, false=bloqueado
  const [subTab, setSubTab] = useState('documentos');
  const [destructiveConfirm, setDestructiveConfirm] = useState(null);

  // Gate de acesso: apenas admins
  useEffect(() => {
    let canceled = false;
    (async () => {
      if (!user?.email) {
        if (!canceled) setIsAdmin(false);
        return;
      }
      try {
        const { data } = await supabase
          .from('user_permissions')
          .select('is_admin')
          .eq('email', user.email)
          .single();
        if (!canceled) setIsAdmin(!!data?.is_admin);
      } catch {
        if (!canceled) setIsAdmin(false);
      }
    })();
    return () => { canceled = true; };
  }, [user]);

  if (isAdmin === null) return <SkeletonAdmin />;

  if (!isAdmin) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8" style={{ background: 'var(--cbc-bg, #F0F4F8)' }}>
        <ErrorState
          title="Acesso restrito"
          message="Este painel e visivel apenas para administradores (Paulo e Bruno)."
          suggestion="Se voce precisa de acesso, solicite ao Paulo."
          icon={<ExclamationTriangleIcon className="w-10 h-10" />}
        />
      </div>
    );
  }

  const subTabs = [
    { key: 'documentos', label: 'Documentos', Icon: DocumentTextIcon },
    { key: 'comissao', label: 'Comissao', Icon: CurrencyDollarIcon },
    { key: 'promocoes', label: 'Promocoes', Icon: SparklesIcon },
    { key: 'metas', label: 'Metas', Icon: FlagIcon },
    { key: 'expectativa', label: 'Expectativa Honorarios', Icon: ChartBarIcon },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--cbc-bg, #F0F4F8)' }}>
      {/* Header + sub-tabs */}
      <div className="shrink-0 border-b" style={{ background: 'var(--cbc-bg-card, white)', borderColor: 'var(--cbc-border, #E5E7EB)' }}>
        <div className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Cog6ToothIcon className="w-5 h-5" style={{ color: 'var(--cbc-accent, #1B3A5C)' }} aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
                Parametrizacao de Vendas
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
                Documentos, comissoes, promocoes, metas e expectativa de honorarios
              </p>
            </div>
          </div>
        </div>

        {/* Tabs estilo pill */}
        <div className="flex gap-1 px-4 pb-3 pt-1 overflow-x-auto">
          {subTabs.map(t => {
            const TIcon = t.Icon;
            const active = subTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setSubTab(t.key)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-all rounded-full whitespace-nowrap"
                style={{
                  background: active ? 'var(--cbc-accent, #1B3A5C)' : 'var(--cbc-bg-subtle, #F3F4F6)',
                  color: active ? '#fff' : 'var(--cbc-text-secondary, #6B7280)',
                  border: `1px solid ${active ? 'var(--cbc-accent, #1B3A5C)' : 'var(--cbc-border, #E5E7EB)'}`,
                }}
              >
                <TIcon className="w-4 h-4" aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conteudo */}
      <div className="flex-1 overflow-y-auto">
        {subTab === 'documentos' && <DocumentosTab setDestructiveConfirm={setDestructiveConfirm} />}
        {subTab === 'comissao' && <ComissaoTab />}
        {subTab === 'promocoes' && <PromocoesTab setDestructiveConfirm={setDestructiveConfirm} />}
        {subTab === 'metas' && <MetasTab />}
        {subTab === 'expectativa' && <ExpectativaTab />}
      </div>

      <ConfirmDestructive
        isOpen={!!destructiveConfirm}
        title={destructiveConfirm?.title}
        message={destructiveConfirm?.message}
        confirmText={destructiveConfirm?.confirmText || 'DELETAR'}
        onConfirm={destructiveConfirm?.onConfirm}
        onCancel={() => setDestructiveConfirm(null)}
      />
    </div>
  );
}

// ============================================================
// TAB 1: DOCUMENTOS
// ============================================================
function DocumentosTab({ setDestructiveConfirm }) {
  const { list: resorts } = useEmpreendimentos();
  const [resortSel, setResortSel] = useState(STAR);
  const [tipoAcaoSel, setTipoAcaoSel] = useState(STAR);

  const [tiposDoc, setTiposDoc] = useState([]);
  const [requisitos, setRequisitos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [showCatalogo, setShowCatalogo] = useState(false);

  const resortOpts = useMemo(() => [STAR, ...resorts], [resorts]);
  const tipoOpts = useMemo(() => [STAR, ...TIPOS_ACAO], []);

  const loadTipos = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('vendas_documentos_tipos')
        .select('*')
        .order('nome');
      if (error) throw error;
      setTiposDoc(data || []);
      return { ok: true };
    } catch (e) {
      if (isMissingTableError(e)) {
        setFatalError({
          title: 'Tabelas de vendas nao criadas',
          message: 'As tabelas de parametrizacao ainda nao existem no banco.',
          suggestion: 'Rode o SQL em supabase_vendas_comissoes.sql no Supabase SQL Editor.',
        });
      }
      return { ok: false, error: e };
    }
  }, []);

  const loadRequisitos = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('vendas_documentos_requisitos')
        .select('*')
        .eq('resort', resortSel)
        .eq('tipo_acao', tipoAcaoSel)
        .order('ordem');
      if (error) throw error;
      setRequisitos(data || []);
    } catch (e) {
      if (isMissingTableError(e)) {
        setFatalError({
          title: 'Tabelas de vendas nao criadas',
          message: 'As tabelas de parametrizacao ainda nao existem no banco.',
          suggestion: 'Rode o SQL em supabase_vendas_comissoes.sql no Supabase SQL Editor.',
        });
      }
    }
  }, [resortSel, tipoAcaoSel]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const r = await loadTipos();
      if (r.ok) await loadRequisitos();
      setLoading(false);
    })();
  }, [loadTipos, loadRequisitos]);

  const showToast = (msg) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const addLinha = () => {
    if (tiposDoc.length === 0) {
      showToast('Erro: catalogo de documentos vazio. Abra "Gerenciar catalogo" para cadastrar.');
      return;
    }
    const novaLinha = {
      id: null, // ainda nao salvou
      resort: resortSel,
      tipo_acao: tipoAcaoSel,
      documento_tipo_id: tiposDoc[0].id,
      obrigatoriedade: 'obrigatorio',
      condicao_doc_faltante_id: null,
      condicao_descricao: '',
      ordem: (requisitos.length + 1) * 10,
      _edited: true,
    };
    setRequisitos([...requisitos, novaLinha]);
  };

  const removeLinha = (idx) => {
    const linha = requisitos[idx];
    if (!linha.id) {
      // ainda nao salvou no banco — remove local
      setRequisitos(requisitos.filter((_, i) => i !== idx));
      return;
    }
    setDestructiveConfirm({
      title: 'Remover requisito?',
      message: `Este requisito sera removido da combinacao ${resortSel === STAR ? LABEL_STAR : resortSel} / ${tipoAcaoSel === STAR ? LABEL_STAR : tipoAcaoSel}.`,
      confirmText: 'DELETAR',
      onConfirm: async () => {
        try {
          await supabase.from('vendas_documentos_requisitos').delete().eq('id', linha.id);
          setDestructiveConfirm(null);
          setRequisitos(requisitos.filter((_, i) => i !== idx));
          showToast('Requisito removido.');
        } catch (e) {
          setDestructiveConfirm(null);
          showToast('Erro: ' + e.message);
        }
      },
    });
  };

  const updateLinha = (idx, patch) => {
    setRequisitos(requisitos.map((r, i) => i === idx ? { ...r, ...patch, _edited: true } : r));
  };

  const saveLinha = async (idx) => {
    const l = requisitos[idx];
    if (!l.documento_tipo_id) {
      showToast('Erro: selecione um documento.');
      return;
    }
    const payload = {
      resort: l.resort,
      tipo_acao: l.tipo_acao,
      documento_tipo_id: l.documento_tipo_id,
      obrigatoriedade: l.obrigatoriedade,
      condicao_doc_faltante_id: l.obrigatoriedade === 'condicional' ? l.condicao_doc_faltante_id : null,
      condicao_descricao: l.obrigatoriedade === 'condicional' ? (l.condicao_descricao || '') : null,
      ordem: Number(l.ordem) || 0,
    };
    try {
      if (l.id) {
        const { error } = await supabase.from('vendas_documentos_requisitos').update(payload).eq('id', l.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('vendas_documentos_requisitos').insert(payload).select().single();
        if (error) throw error;
        // atualiza id local
        setRequisitos(prev => prev.map((r, i) => i === idx ? { ...data, _edited: false } : r));
      }
      if (l.id) updateLinha(idx, { _edited: false });
      showToast('Salvo!');
    } catch (e) {
      showToast('Erro: ' + e.message);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="max-w-5xl mx-auto animate-pulse space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl" style={{ background: 'var(--cbc-bg-subtle, #E5E7EB)' }} />)}
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="p-8">
        <ErrorState
          title={fatalError.title}
          message={fatalError.message}
          suggestion={fatalError.suggestion}
          icon={<InformationCircleIcon className="w-10 h-10" />}
        />
      </div>
    );
  }

  return (
    <div className="p-5 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Sub-titulo */}
        <div className="mb-4">
          <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
            Documentos exigidos por resort + tipo de acao
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
            Use <strong>{LABEL_STAR}</strong> para criar a regra generica. Combinacoes especificas substituem o padrao.
          </p>
        </div>

        {/* Seletor */}
        <div className="card p-4 mb-4" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12 }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Resort</label>
              <select
                value={resortSel}
                onChange={e => setResortSel(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm cursor-pointer"
                style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
              >
                {resortOpts.map(r => (
                  <option key={r} value={r}>{r === STAR ? LABEL_STAR : r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Tipo de Acao</label>
              <select
                value={tipoAcaoSel}
                onChange={e => setTipoAcaoSel(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm cursor-pointer"
                style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
              >
                {tipoOpts.map(t => (
                  <option key={t} value={t}>{t === STAR ? LABEL_STAR : t}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCatalogo(true)}
                className="px-3 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer flex items-center gap-1.5 border-2"
                style={{ borderColor: 'var(--cbc-accent, #1B3A5C)', color: 'var(--cbc-accent, #1B3A5C)', background: 'var(--cbc-bg-card, white)' }}
              >
                <TagIcon className="w-4 h-4" aria-hidden="true" />
                Gerenciar Catalogo
              </button>
            </div>
          </div>
          {(resortSel === STAR && tipoAcaoSel === STAR) ? (
            <div className="mt-3 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)', color: 'var(--cbc-text-secondary, #6B7280)' }}>
              Voce esta editando a regra <strong>PADRAO</strong> que se aplica quando nenhuma combinacao especifica existe.
            </div>
          ) : (
            <div className="mt-3 px-3 py-2 rounded-lg text-[11px]" style={{ background: '#FEF3C7', color: '#92400E' }}>
              <strong>Combinacao especifica:</strong> os requisitos aqui substituem o padrao para esta dupla resort+tipo.
            </div>
          )}
        </div>

        {/* Toast */}
        <ToastMsg msg={saveMsg} />

        {/* Tabela editavel */}
        <div className="card overflow-hidden" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12 }}>
          <div className="card-header flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--cbc-accent, #1B3A5C)', color: '#fff' }}>
            <span className="text-[11px] font-bold uppercase tracking-wide">Requisitos desta combinacao</span>
            <button
              onClick={addLinha}
              className="px-3 py-1 text-[10px] font-bold uppercase rounded-md cursor-pointer flex items-center gap-1 bg-white/15 hover:bg-white/25"
            >
              <PlusIcon className="w-3.5 h-3.5" aria-hidden="true" />
              Adicionar
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Documento</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Obrigatoriedade</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Condicional (se X faltar)</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Descricao</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-right" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Ordem</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-right" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {requisitos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-[12px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                      Nenhum requisito para esta combinacao. Clique em "Adicionar" para comecar.
                    </td>
                  </tr>
                ) : requisitos.map((l, idx) => {
                  const outrosTipos = tiposDoc.filter(t => t.id !== l.documento_tipo_id);
                  return (
                    <tr key={l.id || `new-${idx}`} className="border-b hover:bg-gray-50/50" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                      <td className="px-3 py-2">
                        <select
                          value={l.documento_tipo_id || ''}
                          onChange={e => updateLinha(idx, { documento_tipo_id: e.target.value })}
                          className="w-full border rounded px-2 py-1 text-xs cursor-pointer"
                          style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
                        >
                          <option value="">-- selecione --</option>
                          {tiposDoc.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={l.obrigatoriedade}
                          onChange={e => updateLinha(idx, { obrigatoriedade: e.target.value })}
                          className="w-full border rounded px-2 py-1 text-xs cursor-pointer"
                          style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
                        >
                          {OBRIGATORIEDADE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={l.condicao_doc_faltante_id || ''}
                          onChange={e => updateLinha(idx, { condicao_doc_faltante_id: e.target.value || null })}
                          disabled={l.obrigatoriedade !== 'condicional'}
                          className="w-full border rounded px-2 py-1 text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
                        >
                          <option value="">--</option>
                          {outrosTipos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={l.condicao_descricao || ''}
                          onChange={e => updateLinha(idx, { condicao_descricao: e.target.value })}
                          disabled={l.obrigatoriedade !== 'condicional'}
                          placeholder="Ex: Caso extrato nao seja possivel obter"
                          className="w-full border rounded px-2 py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          value={l.ordem ?? 0}
                          onChange={e => updateLinha(idx, { ordem: parseInt(e.target.value) || 0 })}
                          className="w-16 border rounded px-2 py-1 text-xs text-right"
                          style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => saveLinha(idx)}
                            className="px-2 py-1 text-[10px] font-bold uppercase rounded cursor-pointer text-white flex items-center gap-1"
                            style={{ background: l._edited ? '#16A34A' : 'var(--cbc-accent, #1B3A5C)' }}
                            title="Salvar linha"
                          >
                            <CheckIcon className="w-3 h-3" aria-hidden="true" />
                            Salvar
                          </button>
                          <button
                            onClick={() => removeLinha(idx)}
                            className="px-2 py-1 text-[10px] font-bold uppercase rounded cursor-pointer bg-red-500 text-white hover:bg-red-600 flex items-center gap-1"
                            title="Remover"
                          >
                            <TrashIcon className="w-3 h-3" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCatalogo && (
        <CatalogoDocumentosModal
          tiposDoc={tiposDoc}
          onClose={() => setShowCatalogo(false)}
          onReload={async () => {
            await loadTipos();
            await loadRequisitos();
          }}
          setDestructiveConfirm={setDestructiveConfirm}
        />
      )}
    </div>
  );
}

// ============================================================
// Modal: Catalogo de tipos de documentos
// ============================================================
function CatalogoDocumentosModal({ tiposDoc, onClose, onReload, setDestructiveConfirm }) {
  const [editing, setEditing] = useState(null); // objeto ou {} para novo
  const [saveMsg, setSaveMsg] = useState('');

  const showToast = (msg) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const handleSave = async (tipo) => {
    const payload = {
      nome: (tipo.nome || '').trim(),
      categoria: (tipo.categoria || '').trim() || null,
      descricao: (tipo.descricao || '').trim() || null,
      ativo: tipo.ativo !== false,
    };
    if (!payload.nome) {
      showToast('Erro: nome obrigatorio.');
      return;
    }
    try {
      if (tipo.id) {
        const { error } = await supabase.from('vendas_documentos_tipos').update(payload).eq('id', tipo.id);
        if (error) throw error;
        showToast('Atualizado!');
      } else {
        const { error } = await supabase.from('vendas_documentos_tipos').insert(payload);
        if (error) throw error;
        showToast('Criado!');
      }
      setEditing(null);
      await onReload();
    } catch (e) {
      showToast('Erro: ' + e.message);
    }
  };

  const handleDelete = (tipo) => {
    setDestructiveConfirm({
      title: 'Deletar tipo de documento?',
      message: `O tipo "${tipo.nome}" sera removido e todos os requisitos que o usam serao apagados tambem (cascade).`,
      confirmText: 'DELETAR',
      onConfirm: async () => {
        try {
          await supabase.from('vendas_documentos_tipos').delete().eq('id', tipo.id);
          setDestructiveConfirm(null);
          await onReload();
          showToast('Removido.');
        } catch (e) {
          setDestructiveConfirm(null);
          showToast('Erro: ' + e.message);
        }
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 modal-backdrop-glass" onClick={onClose}>
      <div
        className="modal-glass rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--cbc-bg-card, white)' }}
      >
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
          <div>
            <h3 className="font-bold text-sm" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
              Catalogo de tipos de documentos
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
              {tiposDoc.length} tipo(s) cadastrado(s)
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing({ nome: '', categoria: '', descricao: '', ativo: true })}
              className="px-3 py-1.5 text-[11px] font-bold uppercase rounded-lg cursor-pointer text-white flex items-center gap-1.5"
              style={{ background: 'var(--cbc-accent, #1B3A5C)' }}
            >
              <PlusIcon className="w-4 h-4" aria-hidden="true" />
              Novo
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" title="Fechar">
              <XMarkIcon className="w-5 h-5" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <ToastMsg msg={saveMsg} />

          {editing && (
            <div className="card p-4 mb-4" style={{ background: 'var(--cbc-bg-subtle, #F9FAFB)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12 }}>
              <h4 className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
                {editing.id ? 'Editar tipo' : 'Novo tipo'}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Nome *</label>
                  <input
                    type="text"
                    value={editing.nome || ''}
                    onChange={e => setEditing({ ...editing, nome: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Categoria</label>
                  <input
                    type="text"
                    value={editing.categoria || ''}
                    onChange={e => setEditing({ ...editing, categoria: e.target.value })}
                    placeholder="ex: identidade, resort, financeiro"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Descricao</label>
                  <input
                    type="text"
                    value={editing.descricao || ''}
                    onChange={e => setEditing({ ...editing, descricao: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing.ativo !== false}
                    onChange={e => setEditing({ ...editing, ativo: e.target.checked })}
                    className="w-4 h-4 accent-green-600 cursor-pointer"
                  />
                  <span className="text-xs" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>Ativo (disponivel para uso)</span>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => handleSave(editing)} className="px-3 py-1.5 text-[11px] font-bold uppercase rounded-lg cursor-pointer text-white" style={{ background: 'var(--cbc-accent, #1B3A5C)' }}>
                  Salvar
                </button>
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-[11px] font-bold uppercase rounded-lg cursor-pointer border" style={{ borderColor: 'var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-secondary, #6B7280)' }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
            <div className="overflow-x-auto">
            <table className="w-full text-sm max-md:min-w-[640px]">
              <thead>
                <tr style={{ background: 'var(--cbc-bg-subtle, #F9FAFB)' }}>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Nome</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Categoria</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Descricao</th>
                  <th className="text-center px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Ativo</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {tiposDoc.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-[12px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Nenhum tipo cadastrado.</td></tr>
                ) : tiposDoc.map(t => (
                  <tr key={t.id} className="border-t hover:bg-gray-50/50" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                    <td className="px-3 py-2 font-semibold text-xs" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{t.nome}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{t.categoria || '-'}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{t.descricao || '-'}</td>
                    <td className="px-3 py-2 text-center">
                      {t.ativo !== false ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700">ATIVO</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-gray-200 text-gray-600">INATIVO</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setEditing(t)} className="p-1 rounded hover:bg-gray-100" title="Editar">
                          <PencilSquareIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }} aria-hidden="true" />
                        </button>
                        <button onClick={() => handleDelete(t)} className="p-1 rounded hover:bg-red-50" title="Deletar">
                          <TrashIcon className="w-4 h-4 text-red-500" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TAB 2: COMISSAO (Regras Globais)
// ============================================================
const COMISSAO_DEFAULTS = {
  faixas_iniciais: [
    { min: 1, max: 20, valor: 90 },
    { min: 21, max: 40, valor: 100 },
    { min: 41, max: 60, valor: 110 },
    { min: 61, max: null, valor: 120 },
  ],
  faixas_exito: [
    { min: 1, max: 20, valor: 20 },
    { min: 21, max: 40, valor: 30 },
    { min: 41, max: 60, valor: 40 },
    { min: 61, max: null, valor: 50 },
  ],
  multiplicador_fim_semana: 2.0,
  bonus_contratos_threshold: 100,
  bonus_valor: 1000,
  split_vendedora_pct: 0.70,
  split_assistente_pct: 0.30,
  periodo_inicio_dia: 20,
};

function ComissaoTab() {
  const [regras, setRegras] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const [previewContratos, setPreviewContratos] = useState(23);
  const [previewFds, setPreviewFds] = useState(5);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('vendas_comissao_regras').select('*').eq('id', 1).single();
      if (error) throw error;
      setRegras({
        faixas_iniciais: data.faixas_iniciais || COMISSAO_DEFAULTS.faixas_iniciais,
        faixas_exito: data.faixas_exito || COMISSAO_DEFAULTS.faixas_exito,
        multiplicador_fim_semana: Number(data.multiplicador_fim_semana) || 2.0,
        bonus_contratos_threshold: Number(data.bonus_contratos_threshold) || 100,
        bonus_valor: Number(data.bonus_valor) || 1000,
        split_vendedora_pct: Number(data.split_vendedora_pct) || 0.7,
        split_assistente_pct: Number(data.split_assistente_pct) || 0.3,
        periodo_inicio_dia: Number(data.periodo_inicio_dia) || 20,
      });
    } catch (e) {
      if (isMissingTableError(e)) {
        setFatalError({
          title: 'Tabelas de vendas nao criadas',
          message: 'A tabela vendas_comissao_regras nao existe ainda.',
          suggestion: 'Rode o SQL em supabase_vendas_comissoes.sql no Supabase SQL Editor.',
        });
      } else {
        // se o row ainda nao existe, usa defaults
        setRegras({ ...COMISSAO_DEFAULTS });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const handleSave = async () => {
    if (!regras) return;
    setSaving(true);
    const vend = parseNumber(regras.split_vendedora_pct, 0.7);
    const assist = 1 - vend;
    try {
      const payload = {
        id: 1,
        faixas_iniciais: regras.faixas_iniciais,
        faixas_exito: regras.faixas_exito,
        multiplicador_fim_semana: parseNumber(regras.multiplicador_fim_semana, 2.0),
        bonus_contratos_threshold: Math.round(parseNumber(regras.bonus_contratos_threshold, 100)),
        bonus_valor: parseNumber(regras.bonus_valor, 1000),
        split_vendedora_pct: vend,
        split_assistente_pct: assist,
        periodo_inicio_dia: Math.round(parseNumber(regras.periodo_inicio_dia, 20)),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('vendas_comissao_regras').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      showToast('Regras salvas!');
    } catch (e) {
      showToast('Erro: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = () => {
    setRegras({ ...COMISSAO_DEFAULTS });
    showToast('Valores padrao restaurados (ainda nao salvos).');
  };

  // Preview calc
  const preview = useMemo(() => {
    if (!regras) return null;
    const n = Math.max(0, Math.round(previewContratos));
    const fds = Math.max(0, Math.min(n, Math.round(previewFds)));
    // Descobre valor unitario "iniciais" pela faixa final (total)
    const faixaAplicavel = (regras.faixas_iniciais || []).find(f => n >= f.min && (f.max === null || n <= f.max)) || { valor: 0 };
    const valorUnit = parseNumber(faixaAplicavel.valor, 0);
    const mult = parseNumber(regras.multiplicador_fim_semana, 2.0);
    const regulares = n - fds;
    const subRegulares = regulares * valorUnit;
    const subFds = fds * valorUnit * mult;
    const bruto = subRegulares + subFds;
    const bonus = n >= parseNumber(regras.bonus_contratos_threshold, 100) ? parseNumber(regras.bonus_valor, 1000) : 0;
    const brutoComBonus = bruto + bonus;
    const vendPct = parseNumber(regras.split_vendedora_pct, 0.7);
    const vend = brutoComBonus * vendPct;
    const assist = brutoComBonus - vend;
    return {
      valorUnit, regulares, fds, subRegulares, subFds, bruto, bonus, brutoComBonus, vend, assist, faixa: faixaAplicavel,
    };
  }, [regras, previewContratos, previewFds]);

  if (loading) return <div className="p-6"><div className="animate-pulse h-96 rounded-xl" style={{ background: 'var(--cbc-bg-subtle, #E5E7EB)' }} /></div>;
  if (fatalError) {
    return (
      <div className="p-8">
        <ErrorState title={fatalError.title} message={fatalError.message} suggestion={fatalError.suggestion} icon={<InformationCircleIcon className="w-10 h-10" />} />
      </div>
    );
  }
  if (!regras) return null;

  return (
    <div className="p-5 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>Regras globais de comissao</h3>
          <p className="text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
            Valores aplicados a todas as vendedoras. Ha apenas UMA configuracao ativa (id=1).
          </p>
        </div>

        <ToastMsg msg={saveMsg} />

        {/* Faixas Iniciais */}
        <FaixasEditor
          titulo="Faixas - Honorarios Iniciais + Exito"
          descricao="Valor R$ por contrato segundo o # de contratos no mes."
          faixas={regras.faixas_iniciais}
          onChange={(faixas) => setRegras({ ...regras, faixas_iniciais: faixas })}
        />

        {/* Faixas Exito */}
        <FaixasEditor
          titulo="Faixas - So Exito"
          descricao="Valor R$ por contrato que e apenas de exito (sem honorarios iniciais)."
          faixas={regras.faixas_exito}
          onChange={(faixas) => setRegras({ ...regras, faixas_exito: faixas })}
        />

        {/* Parametros gerais */}
        <div className="card p-4" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12 }}>
          <h4 className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
            Parametros gerais
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputNumField
              label="Multiplicador Fim de Semana"
              hint="Contratos assinados no fds valem X vezes."
              value={regras.multiplicador_fim_semana}
              onChange={v => setRegras({ ...regras, multiplicador_fim_semana: v })}
              step="0.1"
            />
            <InputNumField
              label="Threshold de Bonus (# contratos)"
              hint="Qtd minima no mes para ganhar o bonus."
              value={regras.bonus_contratos_threshold}
              onChange={v => setRegras({ ...regras, bonus_contratos_threshold: v })}
            />
            <InputNumField
              label="Valor do Bonus (R$)"
              hint="Valor fixo pago quando atinge o threshold."
              value={regras.bonus_valor}
              onChange={v => setRegras({ ...regras, bonus_valor: v })}
              step="10"
            />
            <InputNumField
              label="Dia inicial do periodo"
              hint="Dia do mes em que comeca a contagem (fecha no dia anterior do mes seguinte)."
              value={regras.periodo_inicio_dia}
              onChange={v => setRegras({ ...regras, periodo_inicio_dia: Math.max(1, Math.min(28, parseInt(v) || 20)) })}
              min="1"
              max="28"
            />
            <InputNumField
              label="Split Vendedora (%)"
              hint="Percentual do bruto que vai pra vendedora."
              value={Math.round(regras.split_vendedora_pct * 100)}
              onChange={v => {
                const pct = Math.max(0, Math.min(100, parseNumber(v, 70))) / 100;
                setRegras({ ...regras, split_vendedora_pct: pct, split_assistente_pct: 1 - pct });
              }}
              min="0"
              max="100"
              step="1"
            />
            <InputNumField
              label="Split Assistente (%)"
              hint="Auto-calculado = 100 - vendedora."
              value={Math.round((1 - regras.split_vendedora_pct) * 100)}
              onChange={() => { /* readonly */ }}
              readOnly
            />
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: 'var(--cbc-accent, #1B3A5C)' }}
            >
              <CheckIcon className="w-4 h-4" aria-hidden="true" />
              {saving ? 'Salvando...' : 'Salvar alteracoes'}
            </button>
            <button
              onClick={handleRestore}
              className="px-4 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer border-2 flex items-center gap-1.5"
              style={{ borderColor: 'var(--cbc-accent, #1B3A5C)', color: 'var(--cbc-accent, #1B3A5C)', background: 'var(--cbc-bg-card, white)' }}
            >
              <ArrowPathIcon className="w-4 h-4" aria-hidden="true" />
              Restaurar padrao
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="card p-4" style={{ background: 'var(--cbc-bg-subtle, #FEF3C7)', border: '1px solid #F59E0B', borderRadius: 12 }}>
          <h4 className="text-[11px] font-bold uppercase tracking-wide mb-3 flex items-center gap-1.5" style={{ color: '#92400E' }}>
            <SparklesIcon className="w-4 h-4" aria-hidden="true" />
            Preview - exemplo calculado em tempo real
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: '#92400E' }}># Contratos iniciais no mes</label>
              <input
                type="number"
                value={previewContratos}
                onChange={e => setPreviewContratos(parseInt(e.target.value) || 0)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ background: 'white', color: '#1A2E52', borderColor: '#F59E0B' }}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: '#92400E' }}># Contratos fim de semana (subset)</label>
              <input
                type="number"
                value={previewFds}
                onChange={e => setPreviewFds(parseInt(e.target.value) || 0)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ background: 'white', color: '#1A2E52', borderColor: '#F59E0B' }}
              />
            </div>
          </div>
          {preview && (
            <div className="bg-white rounded-lg p-3 text-[12px] leading-relaxed" style={{ color: '#1A2E52' }}>
              <div className="font-bold mb-1">Calculo:</div>
              <div>
                Faixa aplicavel: <strong>{preview.faixa.min}-{preview.faixa.max === null ? '+' : preview.faixa.max}</strong> = {formatBRL(preview.valorUnit)}/contrato
              </div>
              <div className="mt-1">
                {preview.regulares} regulares x {formatBRL(preview.valorUnit)} + {preview.fds} fds x {formatBRL(preview.valorUnit)} x {regras.multiplicador_fim_semana}<br />
                = {formatBRL(preview.subRegulares)} + {formatBRL(preview.subFds)} = <strong>{formatBRL(preview.bruto)} bruto</strong>
              </div>
              {preview.bonus > 0 && (
                <div className="mt-1 text-green-700 font-bold">+ Bonus {formatBRL(preview.bonus)} (atingiu {regras.bonus_contratos_threshold} contratos)</div>
              )}
              <div className="mt-2 pt-2 border-t flex flex-wrap gap-4" style={{ borderColor: '#F59E0B' }}>
                <span>Vendedora ({Math.round(regras.split_vendedora_pct * 100)}%): <strong className="text-green-700">{formatBRL(preview.vend)}</strong></span>
                <span>Assistente ({Math.round((1 - regras.split_vendedora_pct) * 100)}%): <strong className="text-blue-700">{formatBRL(preview.assist)}</strong></span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InputNumField({ label, hint, value, onChange, readOnly = false, ...rest }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wide block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        readOnly={readOnly}
        {...rest}
        className="w-full border rounded-lg px-3 py-2 text-sm read-only:opacity-60 read-only:cursor-not-allowed"
        style={{ background: readOnly ? 'var(--cbc-bg-subtle, #F3F4F6)' : 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}
      />
      {hint && <p className="text-[10px] mt-1" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{hint}</p>}
    </div>
  );
}

function FaixasEditor({ titulo, descricao, faixas, onChange }) {
  const add = () => {
    const last = faixas[faixas.length - 1];
    const novoMin = last ? ((last.max || 0) + 1) : 1;
    onChange([...faixas, { min: novoMin, max: novoMin + 19, valor: 0 }]);
  };
  const remove = (idx) => onChange(faixas.filter((_, i) => i !== idx));
  const update = (idx, patch) => onChange(faixas.map((f, i) => i === idx ? { ...f, ...patch } : f));

  return (
    <div className="card p-4" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12 }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{titulo}</h4>
          <p className="text-[10px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{descricao}</p>
        </div>
        <button onClick={add} className="px-2.5 py-1 text-[10px] font-bold uppercase rounded cursor-pointer flex items-center gap-1 text-white" style={{ background: 'var(--cbc-accent, #1B3A5C)' }}>
          <PlusIcon className="w-3.5 h-3.5" aria-hidden="true" />
          Faixa
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left text-[10px] font-bold uppercase px-2 py-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Min</th>
            <th className="text-left text-[10px] font-bold uppercase px-2 py-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Max (vazio = infinito)</th>
            <th className="text-left text-[10px] font-bold uppercase px-2 py-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Valor por contrato (R$)</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {faixas.map((f, idx) => (
            <tr key={idx} className="border-t" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
              <td className="px-2 py-1.5">
                <input type="number" value={f.min ?? ''} onChange={e => update(idx, { min: parseInt(e.target.value) || 0 })}
                  className="w-20 border rounded px-2 py-1 text-xs"
                  style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
              </td>
              <td className="px-2 py-1.5">
                <input type="number" value={f.max ?? ''} onChange={e => update(idx, { max: e.target.value === '' ? null : (parseInt(e.target.value) || 0) })}
                  className="w-24 border rounded px-2 py-1 text-xs"
                  style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
              </td>
              <td className="px-2 py-1.5">
                <input type="number" value={f.valor ?? ''} onChange={e => update(idx, { valor: parseNumber(e.target.value, 0) })}
                  step="1"
                  className="w-28 border rounded px-2 py-1 text-xs"
                  style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <button onClick={() => remove(idx)} className="p-1 rounded hover:bg-red-50">
                  <TrashIcon className="w-4 h-4 text-red-500" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// TAB 3: PROMOCOES SAZONAIS
// ============================================================
function PromocoesTab({ setDestructiveConfirm }) {
  const { list: resorts } = useEmpreendimentos();
  const [promocoes, setPromocoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('vendas_promocoes_sazonais').select('*').order('data_inicio', { ascending: false });
      if (error) throw error;
      setPromocoes(data || []);
    } catch (e) {
      if (isMissingTableError(e)) {
        setFatalError({
          title: 'Tabelas de vendas nao criadas',
          message: 'A tabela vendas_promocoes_sazonais nao existe ainda.',
          suggestion: 'Rode o SQL em supabase_vendas_comissoes.sql no Supabase SQL Editor.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const handleSave = async (promo) => {
    const regra = { tipo: promo.regra_tipo };
    if (promo.regra_tipo === 'multiplicador') regra.valor = parseNumber(promo.regra_valor, 1);
    else if (promo.regra_tipo === 'valor_fixo') regra.valor = parseNumber(promo.regra_valor, 0);

    const payload = {
      nome: (promo.nome || '').trim(),
      descricao: (promo.descricao || '').trim() || null,
      data_inicio: promo.data_inicio,
      data_fim: promo.data_fim,
      regra,
      resort_filtro: promo.resort_filtro || null,
      tipo_acao_filtro: promo.tipo_acao_filtro || null,
      ativo: promo.ativo !== false,
    };
    if (!payload.nome || !payload.data_inicio || !payload.data_fim) {
      showToast('Erro: nome, data inicio e fim sao obrigatorios.');
      return;
    }
    try {
      if (promo.id) {
        const { error } = await supabase.from('vendas_promocoes_sazonais').update(payload).eq('id', promo.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vendas_promocoes_sazonais').insert(payload);
        if (error) throw error;
      }
      setEditing(null);
      showToast('Salvo!');
      await load();
    } catch (e) {
      showToast('Erro: ' + e.message);
    }
  };

  const handleDelete = (promo) => {
    setDestructiveConfirm({
      title: 'Deletar promocao?',
      message: `A promocao "${promo.nome}" sera removida permanentemente.`,
      confirmText: 'DELETAR',
      onConfirm: async () => {
        try {
          await supabase.from('vendas_promocoes_sazonais').delete().eq('id', promo.id);
          setDestructiveConfirm(null);
          await load();
          showToast('Removida.');
        } catch (e) {
          setDestructiveConfirm(null);
          showToast('Erro: ' + e.message);
        }
      },
    });
  };

  const toggleAtivo = async (promo) => {
    try {
      await supabase.from('vendas_promocoes_sazonais').update({ ativo: !promo.ativo }).eq('id', promo.id);
      await load();
    } catch (e) {
      showToast('Erro: ' + e.message);
    }
  };

  if (loading) return <div className="p-6"><div className="animate-pulse h-96 rounded-xl" style={{ background: 'var(--cbc-bg-subtle, #E5E7EB)' }} /></div>;
  if (fatalError) {
    return (
      <div className="p-8">
        <ErrorState title={fatalError.title} message={fatalError.message} suggestion={fatalError.suggestion} icon={<InformationCircleIcon className="w-10 h-10" />} />
      </div>
    );
  }

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-5 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>Promocoes sazonais</h3>
            <p className="text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
              Promocoes aplicadas automaticamente com base no periodo vigente.
            </p>
          </div>
          <button
            onClick={() => setEditing({
              nome: '', descricao: '', data_inicio: hoje, data_fim: hoje, regra_tipo: 'equiparar_exito_iniciais', regra_valor: null, resort_filtro: '', tipo_acao_filtro: '', ativo: true,
            })}
            className="px-3 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer text-white flex items-center gap-1.5"
            style={{ background: 'var(--cbc-accent, #1B3A5C)' }}
          >
            <PlusIcon className="w-4 h-4" aria-hidden="true" />
            Nova promocao
          </button>
        </div>

        <ToastMsg msg={saveMsg} />

        {/* Cards grid */}
        {promocoes.length === 0 ? (
          <div className="card p-8 text-center text-[12px]" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12, color: 'var(--cbc-text-muted, #9CA3AF)' }}>
            Nenhuma promocao cadastrada. Clique em "Nova promocao" para comecar.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {promocoes.map(p => {
              const diasRestantes = daysBetween(hoje, p.data_fim);
              const emAndamento = p.ativo && hoje >= p.data_inicio && hoje <= p.data_fim;
              const terminada = hoje > p.data_fim;
              const naoIniciada = hoje < p.data_inicio;
              const borderColor = emAndamento ? '#16A34A' : (terminada ? '#9CA3AF' : (naoIniciada ? '#2563EB' : '#F59E0B'));
              const bgTint = emAndamento ? 'rgba(22,163,74,.08)' : (terminada ? 'rgba(156,163,175,.08)' : (naoIniciada ? 'rgba(37,99,235,.08)' : 'rgba(245,158,11,.08)'));
              const statusLabel = !p.ativo ? 'PAUSADA' : (emAndamento ? 'ATIVA' : (terminada ? 'ENCERRADA' : 'AGENDADA'));

              return (
                <div key={p.id} className="rounded-xl p-4 border-2" style={{ borderColor, background: `linear-gradient(135deg, ${bgTint} 0%, var(--cbc-bg-card, white) 100%)` }}>
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h4 className="font-bold text-sm" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{p.nome}</h4>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white" style={{ background: borderColor }}>{statusLabel}</span>
                  </div>
                  {p.descricao && <p className="text-[11px] mb-2" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{p.descricao}</p>}
                  <div className="text-[11px] space-y-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
                    <div>De {formatDate(p.data_inicio)} ate {formatDate(p.data_fim)}</div>
                    {emAndamento && <div className="font-bold" style={{ color: '#16A34A' }}>Faltam {diasRestantes} dia{diasRestantes === 1 ? '' : 's'}</div>}
                    {naoIniciada && <div className="font-bold" style={{ color: '#2563EB' }}>Inicia em {daysBetween(hoje, p.data_inicio)} dia(s)</div>}
                    {p.resort_filtro && <div>Resort: <strong>{p.resort_filtro}</strong></div>}
                    {p.tipo_acao_filtro && <div>Tipo: <strong>{p.tipo_acao_filtro}</strong></div>}
                    <div>
                      Regra: <strong>{(TIPO_PROMO_OPTS.find(t => t.value === p.regra?.tipo) || {}).label || p.regra?.tipo}</strong>
                      {p.regra?.valor !== undefined && p.regra?.valor !== null && <> ({p.regra.tipo === 'multiplicador' ? `${p.regra.valor}x` : formatBRL(p.regra.valor)})</>}
                    </div>
                  </div>
                  <div className="flex gap-1 mt-3 pt-2 border-t" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                    <button onClick={() => setEditing({ ...p, regra_tipo: p.regra?.tipo || 'equiparar_exito_iniciais', regra_valor: p.regra?.valor ?? null })} className="flex-1 px-2 py-1 text-[10px] font-bold uppercase rounded cursor-pointer border" style={{ borderColor: 'var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-secondary, #6B7280)' }}>
                      <PencilSquareIcon className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                      Editar
                    </button>
                    <button onClick={() => toggleAtivo(p)} className="flex-1 px-2 py-1 text-[10px] font-bold uppercase rounded cursor-pointer border" style={{ borderColor: p.ativo ? '#D97706' : '#16A34A', color: p.ativo ? '#D97706' : '#16A34A' }}>
                      {p.ativo ? 'Pausar' : 'Ativar'}
                    </button>
                    <button onClick={() => handleDelete(p)} className="px-2 py-1 text-[10px] font-bold uppercase rounded cursor-pointer bg-red-500 text-white" title="Deletar">
                      <TrashIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {editing && (
          <PromocaoEditModal
            promo={editing}
            resorts={resorts}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

function PromocaoEditModal({ promo, resorts, onSave, onCancel }) {
  const [form, setForm] = useState(promo);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 modal-backdrop-glass" onClick={onCancel}>
      <div className="modal-glass rounded-2xl w-full max-w-xl p-5" onClick={e => e.stopPropagation()} style={{ background: 'var(--cbc-bg-card, white)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
            {form.id ? 'Editar promocao' : 'Nova promocao'}
          </h3>
          <button onClick={onCancel} className="p-1 rounded hover:bg-gray-100">
            <XMarkIcon className="w-5 h-5" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="Nome *">
            <input type="text" value={form.nome || ''} onChange={e => setForm({ ...form, nome: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
          </Field>
          <Field label="Descricao">
            <textarea value={form.descricao || ''} onChange={e => setForm({ ...form, descricao: e.target.value })}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Data inicio *">
              <input type="date" value={form.data_inicio || ''} onChange={e => setForm({ ...form, data_inicio: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
            </Field>
            <Field label="Data fim *">
              <input type="date" value={form.data_fim || ''} onChange={e => setForm({ ...form, data_fim: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Resort (filtro opcional)">
              <select value={form.resort_filtro || ''} onChange={e => setForm({ ...form, resort_filtro: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm cursor-pointer"
                style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                <option value="">Todos</option>
                {resorts.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Tipo de acao (filtro opcional)">
              <select value={form.tipo_acao_filtro || ''} onChange={e => setForm({ ...form, tipo_acao_filtro: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm cursor-pointer"
                style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                <option value="">Todos</option>
                {TIPOS_ACAO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Regra *">
            <select value={form.regra_tipo} onChange={e => setForm({ ...form, regra_tipo: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm cursor-pointer"
              style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }}>
              {TIPO_PROMO_OPTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          {(form.regra_tipo === 'multiplicador' || form.regra_tipo === 'valor_fixo') && (
            <Field label={form.regra_tipo === 'multiplicador' ? 'Multiplicador (ex: 1.5)' : 'Valor fixo (R$) adicional por contrato'}>
              <input type="number" value={form.regra_valor ?? ''} onChange={e => setForm({ ...form, regra_valor: e.target.value })}
                step={form.regra_tipo === 'multiplicador' ? '0.1' : '1'}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
            </Field>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.ativo !== false} onChange={e => setForm({ ...form, ativo: e.target.checked })} className="w-4 h-4 accent-green-600 cursor-pointer" />
            <span className="text-xs" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>Ativo (pode ser aplicado)</span>
          </label>
        </div>

        <div className="flex gap-2 justify-end mt-4 pt-3 border-t" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
          <button onClick={onCancel} className="px-4 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer border"
            style={{ borderColor: 'var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-secondary, #6B7280)', background: 'var(--cbc-bg-card, white)' }}>
            Cancelar
          </button>
          <button onClick={() => onSave(form)} className="px-4 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer text-white"
            style={{ background: 'var(--cbc-accent, #1B3A5C)' }}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wide block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{label}</label>
      {children}
    </div>
  );
}

// ============================================================
// TAB 4: METAS
// ============================================================
function MetasTab() {
  const [monthOffset, setMonthOffset] = useState(0); // 0 = mes atual
  const [vendedoras, setVendedoras] = useState([]);
  const [metas, setMetas] = useState({}); // { email: meta }
  const [realizado, setRealizado] = useState({}); // { email: {contratos,valor} }
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [periodoInicioDia, setPeriodoInicioDia] = useState(20);

  // Calcula periodo corrente baseado no dia 20
  const periodo = useMemo(() => {
    const now = new Date();
    let baseMonth = now.getMonth() + monthOffset;
    let baseYear = now.getFullYear();
    while (baseMonth < 0) { baseMonth += 12; baseYear -= 1; }
    while (baseMonth > 11) { baseMonth -= 12; baseYear += 1; }

    // Periodo: dia X do mes (base-1) ate dia (X-1) do mes base
    const prevMonthDate = new Date(baseYear, baseMonth - 1, periodoInicioDia);
    const thisMonthDate = new Date(baseYear, baseMonth, periodoInicioDia - 1);
    const inicio = prevMonthDate.toISOString().slice(0, 10);
    const fim = thisMonthDate.toISOString().slice(0, 10);
    const label = `${prevMonthDate.toLocaleDateString('pt-BR')} a ${thisMonthDate.toLocaleDateString('pt-BR')}`;
    return { inicio, fim, label, mesRef: `${String(baseMonth + 1).padStart(2, '0')}/${baseYear}` };
  }, [monthOffset, periodoInicioDia]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // busca dia inicio do periodo
      const { data: regras } = await supabase.from('vendas_comissao_regras').select('periodo_inicio_dia').eq('id', 1).single();
      if (regras?.periodo_inicio_dia) setPeriodoInicioDia(regras.periodo_inicio_dia);

      // vendedoras = user_permissions com perfil_vendas='vendedora'
      const { data: users, error: userErr } = await supabase
        .from('user_permissions')
        .select('email, display_name, perfil_vendas')
        .eq('perfil_vendas', 'vendedora')
        .order('email');
      if (userErr) throw userErr;
      setVendedoras(users || []);

      // metas existentes deste periodo
      const { data: metasList, error: metasErr } = await supabase
        .from('vendas_metas')
        .select('*')
        .eq('periodo_inicio', periodo.inicio);
      if (metasErr) {
        if (isMissingTableError(metasErr)) throw metasErr;
      }
      const mmap = {};
      (metasList || []).forEach(m => { mmap[m.vendedora_email] = m; });
      setMetas(mmap);

      // realizado: contratos assinados no periodo
      const { data: contratos } = await supabase
        .from('contratos')
        .select('vendedora_email, honorarios_total, status, signed_at')
        .gte('signed_at', periodo.inicio)
        .lte('signed_at', periodo.fim)
        .in('status', ['assinado']);
      const rmap = {};
      (contratos || []).forEach(c => {
        if (!c.vendedora_email) return;
        if (!rmap[c.vendedora_email]) rmap[c.vendedora_email] = { contratos: 0, valor: 0 };
        rmap[c.vendedora_email].contratos += 1;
        rmap[c.vendedora_email].valor += parseNumber(c.honorarios_total, 0);
      });
      setRealizado(rmap);
    } catch (e) {
      if (isMissingTableError(e)) {
        setFatalError({
          title: 'Tabelas de vendas nao criadas',
          message: 'A tabela vendas_metas nao existe ainda.',
          suggestion: 'Rode o SQL em supabase_vendas_comissoes.sql no Supabase SQL Editor.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const updateMeta = (email, patch) => {
    setMetas({ ...metas, [email]: { ...(metas[email] || {}), vendedora_email: email, periodo_inicio: periodo.inicio, periodo_fim: periodo.fim, ...patch, _edited: true } });
  };

  const saveMeta = async (email) => {
    const m = metas[email];
    if (!m) return;
    const payload = {
      vendedora_email: email,
      periodo_inicio: periodo.inicio,
      periodo_fim: periodo.fim,
      meta_contratos: m.meta_contratos ? Math.round(parseNumber(m.meta_contratos, 0)) : null,
      meta_valor_brl: m.meta_valor_brl ? parseNumber(m.meta_valor_brl, 0) : null,
      observacao: (m.observacao || '').trim() || null,
    };
    try {
      if (m.id) {
        const { error } = await supabase.from('vendas_metas').update(payload).eq('id', m.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('vendas_metas').upsert(payload, { onConflict: 'vendedora_email,periodo_inicio' }).select().single();
        if (error) throw error;
        setMetas(prev => ({ ...prev, [email]: { ...data, _edited: false } }));
      }
      showToast(`Meta de ${email.split('@')[0]} salva!`);
      // refresh somente se upsert deu id
      if (m.id) updateMeta(email, { _edited: false });
    } catch (e) {
      showToast('Erro: ' + e.message);
    }
  };

  const aplicarParaTodas = () => {
    const first = vendedoras[0];
    if (!first) return;
    const m = metas[first.email] || {};
    const { meta_contratos, meta_valor_brl } = m;
    if (!meta_contratos && !meta_valor_brl) {
      showToast('Erro: defina valores na primeira linha antes de aplicar.');
      return;
    }
    const updated = { ...metas };
    vendedoras.forEach(v => {
      updated[v.email] = {
        ...(updated[v.email] || {}),
        vendedora_email: v.email,
        periodo_inicio: periodo.inicio,
        periodo_fim: periodo.fim,
        meta_contratos,
        meta_valor_brl,
        _edited: true,
      };
    });
    setMetas(updated);
    showToast('Aplicado em memoria. Clique em "Salvar" em cada linha.');
  };

  if (loading) return <div className="p-6"><div className="animate-pulse h-96 rounded-xl" style={{ background: 'var(--cbc-bg-subtle, #E5E7EB)' }} /></div>;
  if (fatalError) {
    return (
      <div className="p-8">
        <ErrorState title={fatalError.title} message={fatalError.message} suggestion={fatalError.suggestion} icon={<InformationCircleIcon className="w-10 h-10" />} />
      </div>
    );
  }

  return (
    <div className="p-5 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Seletor de mes + acoes */}
        <div className="card p-4 mb-4" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12 }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button onClick={() => setMonthOffset(o => o - 1)} className="p-2 rounded-lg cursor-pointer border" style={{ borderColor: 'var(--cbc-border, #E5E7EB)', background: 'var(--cbc-bg-card, white)' }} title="Mes anterior">
                <ChevronLeftIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }} aria-hidden="true" />
              </button>
              <div className="px-3 py-1 rounded-lg" style={{ background: 'var(--cbc-bg-subtle, #F9FAFB)' }}>
                <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Periodo</div>
                <div className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{periodo.label}</div>
              </div>
              <button onClick={() => setMonthOffset(o => o + 1)} className="p-2 rounded-lg cursor-pointer border" style={{ borderColor: 'var(--cbc-border, #E5E7EB)', background: 'var(--cbc-bg-card, white)' }} title="Proximo mes">
                <ChevronRightIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }} aria-hidden="true" />
              </button>
              {monthOffset !== 0 && (
                <button onClick={() => setMonthOffset(0)} className="px-2 py-1 text-[10px] font-bold uppercase rounded cursor-pointer text-white" style={{ background: 'var(--cbc-accent, #1B3A5C)' }}>
                  Hoje
                </button>
              )}
            </div>
            <button onClick={aplicarParaTodas} className="px-3 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer border-2 flex items-center gap-1.5"
              style={{ borderColor: 'var(--cbc-accent, #1B3A5C)', color: 'var(--cbc-accent, #1B3A5C)', background: 'var(--cbc-bg-card, white)' }}>
              <Squares2X2Icon className="w-4 h-4" aria-hidden="true" />
              Aplicar meta 1a linha para todas
            </button>
          </div>
        </div>

        <ToastMsg msg={saveMsg} />

        {/* Tabela */}
        <div className="card overflow-hidden" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12 }}>
          <div className="overflow-x-auto">
          <table className="w-full text-sm max-lg:min-w-[760px]">
            <thead>
              <tr style={{ background: 'var(--cbc-bg-subtle, #F9FAFB)' }}>
                <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Vendedora</th>
                <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Meta Contratos</th>
                <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Meta Valor R$</th>
                <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Realizado</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>% Atingido</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Observacao</th>
                <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {vendedoras.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-[12px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                  Nenhuma vendedora cadastrada (perfil_vendas='vendedora' em user_permissions).
                </td></tr>
              ) : vendedoras.map(v => {
                const m = metas[v.email] || {};
                const r = realizado[v.email] || { contratos: 0, valor: 0 };
                const metaC = parseNumber(m.meta_contratos, 0);
                const metaV = parseNumber(m.meta_valor_brl, 0);
                const pctC = metaC > 0 ? Math.min(100, (r.contratos / metaC) * 100) : 0;
                const pctV = metaV > 0 ? Math.min(100, (r.valor / metaV) * 100) : 0;
                const pct = Math.max(pctC, pctV);
                const pctColor = pct >= 100 ? '#16A34A' : pct >= 75 ? '#2563EB' : pct >= 50 ? '#D97706' : '#DC2626';
                return (
                  <tr key={v.email} className="border-t" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-xs" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{v.display_name || v.email.split('@')[0]}</div>
                      <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>{v.email}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" value={m.meta_contratos ?? ''} onChange={e => updateMeta(v.email, { meta_contratos: e.target.value })}
                        className="w-20 border rounded px-2 py-1 text-xs text-right"
                        style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" value={m.meta_valor_brl ?? ''} onChange={e => updateMeta(v.email, { meta_valor_brl: e.target.value })}
                        step="100"
                        className="w-28 border rounded px-2 py-1 text-xs text-right"
                        style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="text-xs font-semibold" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{r.contratos} contratos</div>
                      <div className="text-[10px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{formatBRL(r.valor)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle, #E5E7EB)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pctColor }} />
                        </div>
                        <span className="text-[10px] font-bold w-10 text-right" style={{ color: pctColor }}>{Math.round(pct)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" value={m.observacao || ''} onChange={e => updateMeta(v.email, { observacao: e.target.value })}
                        placeholder="Observacao"
                        className="w-full border rounded px-2 py-1 text-xs"
                        style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => saveMeta(v.email)}
                        className="px-2 py-1 text-[10px] font-bold uppercase rounded cursor-pointer text-white flex items-center gap-1 ml-auto"
                        style={{ background: m._edited ? '#16A34A' : 'var(--cbc-accent, #1B3A5C)' }}
                      >
                        <CheckIcon className="w-3 h-3" aria-hidden="true" />
                        Salvar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TAB 5: EXPECTATIVA DE HONORARIOS
// ============================================================
function ExpectativaTab() {
  const { list: resorts } = useEmpreendimentos();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [editing, setEditing] = useState(null); // {resort, tipo_acao}
  const [viewMode, setViewMode] = useState('matrix'); // 'matrix' | 'list'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('vendas_expectativa_honorarios').select('*').order('resort');
      if (error) throw error;
      setDados(data || []);
    } catch (e) {
      if (isMissingTableError(e)) {
        setFatalError({
          title: 'Tabelas de vendas nao criadas',
          message: 'A tabela vendas_expectativa_honorarios nao existe ainda.',
          suggestion: 'Rode o SQL em supabase_vendas_comissoes.sql no Supabase SQL Editor.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 3000);
  };

  // indexa por resort+tipo
  const matrix = useMemo(() => {
    const m = {};
    dados.forEach(d => {
      if (!m[d.resort]) m[d.resort] = {};
      m[d.resort][d.tipo_acao] = d;
    });
    return m;
  }, [dados]);

  const saveCelula = async (form) => {
    const payload = {
      resort: form.resort,
      tipo_acao: form.tipo_acao,
      valor_medio_sentenca: form.valor_medio_sentenca !== '' ? parseNumber(form.valor_medio_sentenca, null) : null,
      percentual_praticado: form.percentual_praticado !== '' ? parseNumber(form.percentual_praticado, null) : null,
      tempo_medio_meses: form.tempo_medio_meses !== '' ? Math.round(parseNumber(form.tempo_medio_meses, null)) : null,
      observacao: (form.observacao || '').trim() || null,
      updated_at: new Date().toISOString(),
    };
    try {
      const { error } = await supabase.from('vendas_expectativa_honorarios').upsert(payload, { onConflict: 'resort,tipo_acao' });
      if (error) throw error;
      showToast('Salvo!');
      setEditing(null);
      await load();
    } catch (e) {
      showToast('Erro: ' + e.message);
    }
  };

  if (loading) return <div className="p-6"><div className="animate-pulse h-96 rounded-xl" style={{ background: 'var(--cbc-bg-subtle, #E5E7EB)' }} /></div>;
  if (fatalError) {
    return (
      <div className="p-8">
        <ErrorState title={fatalError.title} message={fatalError.message} suggestion={fatalError.suggestion} icon={<InformationCircleIcon className="w-10 h-10" />} />
      </div>
    );
  }

  // resorts com ao menos um dado preenchido + os principais primeiros
  const resortsAtivos = resorts.slice(0, 40); // pra nao explodir a matriz

  return (
    <div className="p-5 md:p-6">
      <div className="max-w-full mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>Expectativa de Honorarios</h3>
            <p className="text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
              Valor medio de sentenca, percentual praticado e tempo medio por resort x tipo de acao.
            </p>
          </div>
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--cbc-bg-subtle, #F3F4F6)' }}>
            <button onClick={() => setViewMode('matrix')}
              className="px-2.5 py-1 text-[10px] font-bold uppercase rounded cursor-pointer flex items-center gap-1"
              style={{ background: viewMode === 'matrix' ? 'var(--cbc-bg-card, white)' : 'transparent', color: viewMode === 'matrix' ? 'var(--cbc-accent, #1B3A5C)' : 'var(--cbc-text-secondary, #6B7280)' }}>
              <Squares2X2Icon className="w-3.5 h-3.5" aria-hidden="true" />
              Matriz
            </button>
            <button onClick={() => setViewMode('list')}
              className="px-2.5 py-1 text-[10px] font-bold uppercase rounded cursor-pointer flex items-center gap-1"
              style={{ background: viewMode === 'list' ? 'var(--cbc-bg-card, white)' : 'transparent', color: viewMode === 'list' ? 'var(--cbc-accent, #1B3A5C)' : 'var(--cbc-text-secondary, #6B7280)' }}>
              <ListBulletIcon className="w-3.5 h-3.5" aria-hidden="true" />
              Lista
            </button>
          </div>
        </div>

        <ToastMsg msg={saveMsg} />

        {viewMode === 'matrix' ? (
          <div className="card overflow-auto" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12, maxHeight: '70vh' }}>
            <table className="text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr style={{ background: 'var(--cbc-bg-subtle, #F9FAFB)' }}>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase sticky left-0 z-20" style={{ color: 'var(--cbc-text-secondary, #6B7280)', background: 'var(--cbc-bg-subtle, #F9FAFB)', minWidth: 180 }}>Resort</th>
                  {TIPOS_ACAO.map(t => (
                    <th key={t} className="text-center px-3 py-2 text-[10px] font-bold uppercase whitespace-nowrap" style={{ color: 'var(--cbc-text-secondary, #6B7280)', minWidth: 140 }}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resortsAtivos.map(r => (
                  <tr key={r} className="border-t" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                    <td className="px-3 py-2 font-semibold text-xs sticky left-0 z-10" style={{ color: 'var(--cbc-text-primary, #1A2E52)', background: 'var(--cbc-bg-card, white)' }}>{r}</td>
                    {TIPOS_ACAO.map(t => {
                      const d = matrix[r]?.[t];
                      const hasData = !!d;
                      return (
                        <td key={t} className="px-2 py-1 text-center">
                          <button
                            onClick={() => setEditing({
                              resort: r,
                              tipo_acao: t,
                              valor_medio_sentenca: d?.valor_medio_sentenca ?? '',
                              percentual_praticado: d?.percentual_praticado ?? '',
                              tempo_medio_meses: d?.tempo_medio_meses ?? '',
                              observacao: d?.observacao || '',
                            })}
                            className="w-full px-2 py-1.5 rounded border cursor-pointer hover:opacity-80 transition-all"
                            style={{
                              background: hasData ? 'rgba(22,163,74,.08)' : 'var(--cbc-bg-subtle, #F9FAFB)',
                              borderColor: hasData ? '#16A34A' : 'var(--cbc-border, #E5E7EB)',
                              color: 'var(--cbc-text-primary, #1A2E52)',
                            }}
                            title={hasData ? `${formatBRL(d.valor_medio_sentenca)} / ${d.percentual_praticado}% / ${d.tempo_medio_meses}m` : 'Editar'}
                          >
                            {hasData ? (
                              <div>
                                <div className="text-[10px] font-bold">{formatBRL(d.valor_medio_sentenca)}</div>
                                <div className="text-[9px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
                                  {d.percentual_praticado ?? '-'}% / {d.tempo_medio_meses ?? '-'}m
                                </div>
                              </div>
                            ) : (
                              <span className="text-[10px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Editar</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card overflow-hidden" style={{ background: 'var(--cbc-bg-card, white)', border: '1px solid var(--cbc-border, #E5E7EB)', borderRadius: 12 }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--cbc-bg-subtle, #F9FAFB)' }}>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Resort</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Tipo de acao</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Valor medio</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>% praticado</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Tempo (meses)</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Observacao</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {dados.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-[12px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>
                    Nenhum dado cadastrado. Use a visualizacao em Matriz para preencher.
                  </td></tr>
                ) : dados.map(d => (
                  <tr key={d.id} className="border-t" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
                    <td className="px-3 py-2 font-semibold text-xs" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{d.resort}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{d.tipo_acao}</td>
                    <td className="px-3 py-2 text-right text-xs">{d.valor_medio_sentenca ? formatBRL(d.valor_medio_sentenca) : '-'}</td>
                    <td className="px-3 py-2 text-right text-xs">{d.percentual_praticado ?? '-'}{d.percentual_praticado != null && '%'}</td>
                    <td className="px-3 py-2 text-right text-xs">{d.tempo_medio_meses ?? '-'}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{d.observacao || '-'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setEditing({
                        resort: d.resort,
                        tipo_acao: d.tipo_acao,
                        valor_medio_sentenca: d.valor_medio_sentenca ?? '',
                        percentual_praticado: d.percentual_praticado ?? '',
                        tempo_medio_meses: d.tempo_medio_meses ?? '',
                        observacao: d.observacao || '',
                      })} className="p-1 rounded hover:bg-gray-100">
                        <PencilSquareIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editing && (
          <ExpectativaEditModal form={editing} onSave={saveCelula} onCancel={() => setEditing(null)} />
        )}
      </div>
    </div>
  );
}

function ExpectativaEditModal({ form, onSave, onCancel }) {
  const [data, setData] = useState(form);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 modal-backdrop-glass" onClick={onCancel}>
      <div className="modal-glass rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()} style={{ background: 'var(--cbc-bg-card, white)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-sm" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>Expectativa - celula</h3>
            <p className="text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
              {data.resort} / {data.tipo_acao}
            </p>
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-gray-100">
            <XMarkIcon className="w-5 h-5" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Valor medio sentenca (R$)">
            <input type="number" value={data.valor_medio_sentenca ?? ''} onChange={e => setData({ ...data, valor_medio_sentenca: e.target.value })}
              step="100"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
          </Field>
          <Field label="% praticado">
            <input type="number" value={data.percentual_praticado ?? ''} onChange={e => setData({ ...data, percentual_praticado: e.target.value })}
              step="0.5"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
          </Field>
          <Field label="Tempo medio ate sentenca (meses)">
            <input type="number" value={data.tempo_medio_meses ?? ''} onChange={e => setData({ ...data, tempo_medio_meses: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
          </Field>
          <Field label="Observacao">
            <textarea value={data.observacao || ''} onChange={e => setData({ ...data, observacao: e.target.value })}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--cbc-bg-card, white)', color: 'var(--cbc-text-primary, #1A2E52)', borderColor: 'var(--cbc-border, #E5E7EB)' }} />
          </Field>
        </div>

        <div className="flex gap-2 justify-end mt-4 pt-3 border-t" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
          <button onClick={onCancel} className="px-4 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer border"
            style={{ borderColor: 'var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-secondary, #6B7280)', background: 'var(--cbc-bg-card, white)' }}>
            Cancelar
          </button>
          <button onClick={() => onSave(data)} className="px-4 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer text-white"
            style={{ background: 'var(--cbc-accent, #1B3A5C)' }}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
