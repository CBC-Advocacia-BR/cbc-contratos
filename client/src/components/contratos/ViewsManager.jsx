// (#92) Views (filtros salvos) compartilhaveis na aba Contratos
// Salva: filterStatus, search, showArquivados, viewMode

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../Toast';
import {
  BookmarkIcon,
  BookmarkSquareIcon,
  TrashIcon,
  ShareIcon,
  ChevronDownIcon,
  PlusCircleIcon,
} from '@heroicons/react/24/outline';

export default function ViewsManager({ currentFilters, onApplyView }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newShared, setNewShared] = useState(false);
  const wrapRef = useRef(null);

  const loadViews = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_views')
        .select('id, name, filters, is_shared, view_mode, user_id, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setViews(data || []);
    } catch (err) {
      toast.error('Falha ao carregar views: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (open) loadViews(); }, [open, loadViews]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSave = async () => {
    const name = newName.trim();
    if (!name) { toast.warning('De um nome a view'); return; }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessao expirou');
      const { error } = await supabase.from('user_views').insert({
        user_id: user.id,
        name,
        filters: currentFilters.filters || {},
        view_mode: currentFilters.viewMode || 'list',
        is_shared: newShared,
      });
      if (error) throw error;
      toast.success(`View "${name}" salva`);
      setShowSaveModal(false);
      setNewName('');
      setNewShared(false);
      loadViews();
    } catch (err) {
      toast.error('Falha ao salvar view: ' + err.message);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Excluir view "${name}"?`)) return;
    try {
      const { error } = await supabase.from('user_views').delete().eq('id', id);
      if (error) throw error;
      toast.success(`View "${name}" excluida`);
      loadViews();
    } catch (err) {
      toast.error('Falha ao excluir: ' + err.message);
    }
  };

  const handleApply = (view) => {
    onApplyView(view);
    setOpen(false);
    toast.info(`View "${view.name}" aplicada`);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-all"
        style={{ background: open ? '#1B3A5C' : '#EEF4FF', color: open ? '#fff' : '#1B3A5C', border: '1px solid #C0D0E8' }}
        title="Views salvas (filtros)"
      >
        <BookmarkIcon className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden md:inline">Views</span>
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 z-40 w-72 max-sm:left-0 max-sm:right-auto max-sm:w-[min(18rem,calc(100vw-2rem))] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden" style={{ animation: 'fadeIn .15s ease' }}>
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-gray-500">Views salvas</span>
            <button
              type="button"
              onClick={() => setShowSaveModal(true)}
              className="flex items-center gap-1 text-[10px] font-bold uppercase text-navy hover:text-navy-light"
              title="Salvar filtros atuais como view"
            >
              <PlusCircleIcon className="w-3.5 h-3.5" aria-hidden="true" />
              Nova
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-4 text-center text-[11px] text-gray-400">Carregando...</div>
            ) : views.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-gray-400">
                Nenhuma view salva.<br />
                <button type="button" onClick={() => setShowSaveModal(true)} className="text-navy underline mt-1">
                  Salvar a atual
                </button>
              </div>
            ) : (
              views.map(v => (
                <div key={v.id} className="px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0 flex items-start gap-2 group">
                  <button type="button" onClick={() => handleApply(v)} className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-1.5">
                      <BookmarkSquareIcon className="w-3.5 h-3.5 text-navy shrink-0" aria-hidden="true" />
                      <span className="text-[12px] font-semibold text-gray-800 truncate">{v.name}</span>
                      {v.is_shared && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700 bg-amber-100 border border-amber-200 px-1 py-0.5 rounded font-bold uppercase">
                          <ShareIcon className="w-2.5 h-2.5" aria-hidden="true" /> Equipe
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5 ml-5">
                      {[
                        v.view_mode && v.view_mode !== 'list' ? v.view_mode : null,
                        v.filters?.filterStatus,
                        v.filters?.search ? `"${v.filters.search}"` : null,
                      ].filter(Boolean).join(' · ') || 'Todos os contratos'}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(v.id, v.name)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded transition-all"
                    title="Excluir view"
                  >
                    <TrashIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSaveModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="font-bold text-sm text-navy">Salvar view</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Salva os filtros e modo de visualizacao atuais</p>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">Nome</label>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                  placeholder="Ex: Pendencias do mes"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-navy focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newShared}
                  onChange={e => setNewShared(e.target.checked)}
                  className="w-4 h-4 accent-navy cursor-pointer"
                />
                <span className="text-[12px] text-gray-700">Compartilhar com a equipe (read-only)</span>
              </label>
            </div>
            <div className="px-4 py-3 bg-gray-50 flex justify-end gap-2">
              <button type="button" onClick={() => setShowSaveModal(false)} className="text-[11px] font-bold uppercase text-gray-500 hover:text-gray-700 px-3 py-1.5">
                Cancelar
              </button>
              <button type="button" onClick={handleSave} className="btn-primary text-[11px] px-4 py-1.5">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
