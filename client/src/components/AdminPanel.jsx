import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { SkeletonAdmin } from './Skeleton';
// (resilience 28/04) Cache offline IndexedDB
import { clearCache as clearContractsCache } from '../utils/contractsCache';
import {
  PlusIcon,
  DocumentTextIcon,
  ChartBarIcon,
  CreditCardIcon,
  DocumentIcon,
  ComputerDesktopIcon,
  Cog6ToothIcon,
  BoltIcon,
  ExclamationTriangleIcon,
  BanknotesIcon,
  DocumentCheckIcon,
  ChatBubbleLeftRightIcon,
  LinkIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

// (cleanup 20260418_152512) removidos: leads, integracoes, comissoes_socios
const TAB_LIST = [
  { key: 'novo', label: 'Novo Contrato', Icon: PlusIcon },
  { key: 'contratos', label: 'Contratos Salvos', Icon: DocumentTextIcon },
  { key: 'clientes', label: 'Clientes', Icon: UserGroupIcon },
  { key: 'dashboard', label: 'Dashboard', Icon: ChartBarIcon },
  { key: 'asaas', label: 'Asaas', Icon: CreditCardIcon },
  { key: 'boletos', label: 'Boletos', Icon: DocumentIcon },
  // (chatguru removal 2026-05) Aba ChatGuru removida
  { key: 'monitor', label: 'Monitor', Icon: ComputerDesktopIcon },
  { key: 'admin', label: 'Admin', Icon: Cog6ToothIcon },
  { key: 'vendas', label: 'Minhas Vendas', Icon: BanknotesIcon },
  { key: 'parametrizacao_vendas', label: 'Parametrizacao Vendas', Icon: DocumentCheckIcon },
  { key: 'bot', label: 'Bot ADVBOX', Icon: ChatBubbleLeftRightIcon },
  { key: 'portal', label: 'Portal do Cliente', Icon: LinkIcon },
];

function UserRow({ user, onUpdate, vendedoras }) {
  const [tabs, setTabs] = useState(user.tabs || {});
  const [saving, setSaving] = useState(false);
  const [perfilVendas, setPerfilVendas] = useState(user.perfil_vendas || '');
  const [vendedoraParceira, setVendedoraParceira] = useState(user.vendedora_parceira_email || '');
  const [savingVendas, setSavingVendas] = useState(false);

  const toggle = async (tabKey) => {
    const newTabs = { ...tabs, [tabKey]: !tabs[tabKey] };
    setTabs(newTabs);
    setSaving(true);
    await supabase.from('user_permissions').update({ tabs: newTabs, updated_at: new Date().toISOString() }).eq('id', user.id);
    setSaving(false);
    if (onUpdate) onUpdate();
  };

  const handlePerfilChange = async (newPerfil) => {
    setPerfilVendas(newPerfil);
    // Se mudar para algo que nao eh assistente, limpa vendedora parceira
    const newParceira = newPerfil === 'assistente' ? vendedoraParceira : '';
    if (newPerfil !== 'assistente') setVendedoraParceira('');
    setSavingVendas(true);
    await supabase.from('user_permissions').update({
      perfil_vendas: newPerfil || null,
      vendedora_parceira_email: newParceira || null,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    setSavingVendas(false);
    if (onUpdate) onUpdate();
  };

  const handleParceiraChange = async (newEmail) => {
    setVendedoraParceira(newEmail);
    setSavingVendas(true);
    await supabase.from('user_permissions').update({
      vendedora_parceira_email: newEmail || null,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    setSavingVendas(false);
    if (onUpdate) onUpdate();
  };

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50/50">
        <td className="px-4 py-3 sticky left-0 z-10 cbc-sticky-col"
          style={{ background: 'var(--cbc-bg-card, #FFFFFF)' }}>
          <div className="font-semibold text-sm" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{user.display_name || user.email.split('@')[0]}</div>
          <div className="text-[11px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{user.email}</div>
        </td>
        {TAB_LIST.map(t => (
          <td key={t.key} className="px-2 py-3 text-center">
            <label className="inline-flex items-center justify-center cursor-pointer min-w-[44px] min-h-[44px] max-[1366px]:min-w-[44px] max-[1366px]:min-h-[44px]">
              <input type="checkbox" checked={!!tabs[t.key]} onChange={() => toggle(t.key)}
                className="w-4 h-4 accent-green-600 cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 focus-visible:outline-none"
                disabled={t.key === 'admin' && !user.is_admin} />
            </label>
          </td>
        ))}
        <td className="px-3 py-3 text-center">
          {user.is_admin && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold"
              style={{ background: 'var(--cbc-info-bg, #EDE9FE)', color: 'var(--cbc-info, #6D28D9)' }}>ADMIN</span>
          )}
          {saving && <span className="text-[11px] animate-pulse ml-1" style={{ color: 'var(--cbc-info, #2563EB)' }}>Salvando...</span>}
        </td>
      </tr>
      {/* NOVA SECAO: Equipe de Vendas — mini-form em cada linha */}
      <tr className="border-b border-gray-100">
        <td colSpan={TAB_LIST.length + 2} className="px-4 pb-3">
          <div className="mt-1 p-3 rounded"
            style={{ background: 'var(--cbc-bg-elevated, #F9FAFB)', border: '1px solid var(--cbc-border, #E5E7EB)' }}>
            <div className="text-[10px] font-bold uppercase mb-2 tracking-wider"
              style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
              Equipe de Vendas
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-[10px] font-bold uppercase tracking-wide"
                style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>Perfil:</label>
              <select
                value={perfilVendas || ''}
                onChange={(e) => handlePerfilChange(e.target.value)}
                className="text-xs px-2 py-1 rounded border cursor-pointer"
                style={{
                  background: 'var(--cbc-bg-card, #FFFFFF)',
                  borderColor: 'var(--cbc-border, #D1D5DB)',
                  color: 'var(--cbc-text-primary, #111827)',
                }}
              >
                <option value="">— Nao participa —</option>
                <option value="vendedora">Vendedora</option>
                <option value="assistente">Assistente</option>
              </select>
              {perfilVendas === 'assistente' && (
                <>
                  <label className="text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>Vendedora parceira:</label>
                  <select
                    value={vendedoraParceira || ''}
                    onChange={(e) => handleParceiraChange(e.target.value)}
                    className="text-xs px-2 py-1 rounded border cursor-pointer"
                    style={{
                      background: 'var(--cbc-bg-card, #FFFFFF)',
                      borderColor: 'var(--cbc-border, #D1D5DB)',
                      color: 'var(--cbc-text-primary, #111827)',
                    }}
                  >
                    <option value="">— Selecione a vendedora parceira —</option>
                    {vendedoras.filter(v => v.email !== user.email).map(v => (
                      <option key={v.email} value={v.email}>{v.display_name || v.email}</option>
                    ))}
                  </select>
                </>
              )}
              {savingVendas && <span className="text-[11px] animate-pulse" style={{ color: 'var(--cbc-info, #2563EB)' }}>Salvando...</span>}
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

function AddUserModal({ onClose, onAdded }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    if (!email.includes('@')) { setError('Email inválido'); return; }
    setLoading(true); setError('');
    try {
      // (cleanup 20260418_152512) removidos: leads, integracoes, comissoes_socios
      const defaultTabs = {
        novo: true,
        contratos: true,
        dashboard: true,
        asaas: false,
        boletos: false,
        monitor: false,
        admin: false,
        vendas: false,
        parametrizacao_vendas: false,
      };
      const { error: dbErr } = await supabase.from('user_permissions').insert({
        email: email.toLowerCase().trim(), display_name: name.trim() || null, tabs: defaultTabs,
      });
      if (dbErr) throw dbErr;
      if (onAdded) onAdded();
      onClose();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5"
        style={{ background: 'var(--cbc-bg-card, #FFFFFF)', color: 'var(--cbc-text-primary, #111827)' }}
        onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-sm mb-4" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>Adicionar Usuário</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Email *</label>
            <input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 focus-visible:outline-none" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }} placeholder="usuario@advocaciacbc.com" />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase block mb-1" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Nome</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 focus-visible:outline-none" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }} placeholder="Nome completo" />
          </div>
          {error && <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--cbc-danger, #DC2626)' }}><ExclamationTriangleIcon className="w-3.5 h-3.5" aria-hidden="true" /> {error}</div>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2 rounded-lg border text-sm font-bold cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 focus-visible:outline-none" style={{ borderColor: 'var(--cbc-border, #D1D5DB)', color: 'var(--cbc-text-secondary, #6B7280)' }}>Cancelar</button>
            <button onClick={handleAdd} disabled={loading}
              className="flex-1 py-2 rounded-lg text-white text-sm font-bold cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 focus-visible:outline-none"
              style={{ background: 'var(--cbc-navy, #1B3A5C)' }}>{loading ? 'Salvando...' : 'Adicionar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      // Incluir perfil_vendas e vendedora_parceira_email no SELECT
      const { data } = await supabase.from('user_permissions')
        .select('id, email, display_name, is_admin, tabs, perfil_vendas, vendedora_parceira_email, updated_at, created_at')
        .order('email');
      setUsers(data || []);
    } catch { /* ignora */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Derivar lista de vendedoras (perfil_vendas='vendedora') para o dropdown do assistente
  const vendedoras = useMemo(() => users.filter(u => u.perfil_vendas === 'vendedora'), [users]);

  // (#96) Skeleton loading inicial
  if (loading && users.length === 0) {
    return <SkeletonAdmin />;
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cbc-bg-canvas, #FFFFFF)' }}>
      <div className="p-5 border-b" style={{ borderColor: 'var(--cbc-border, #F3F4F6)' }}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}><Cog6ToothIcon className="w-5 h-5" aria-hidden="true" /> Painel de Administração</h2>
            <p className="text-[11px]" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Gerenciar permissões de acesso dos usuários</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 text-[11px] font-bold uppercase rounded-lg cursor-pointer text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--cbc-navy,#1B3A5C)]/40 focus-visible:outline-none"
            style={{ background: 'var(--cbc-navy, #1B3A5C)' }}>+ Adicionar Usuário</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--cbc-text-muted, #9CA3AF)' }}>Carregando...</div>
        ) : (
          <div className="rounded-xl border shadow-sm overflow-hidden"
            style={{ background: 'var(--cbc-bg-card, #FFFFFF)', borderColor: 'var(--cbc-border, #F3F4F6)' }}>
            <div className="lg:hidden px-4 py-1.5 text-[11px] flex items-center gap-1 border-b"
              style={{ color: 'var(--cbc-text-secondary, #6B7280)', borderColor: 'var(--cbc-border, #F3F4F6)' }}>
              <span aria-hidden="true">↔</span> Deslize para ver todas as colunas
            </div>
            <div className="overflow-x-auto cbc-matrix-scroll">
            <table className="w-full text-sm max-lg:min-w-[900px]">
              <thead style={{ background: 'var(--cbc-bg-elevated, #F9FAFB)', borderBottom: '1px solid var(--cbc-border, #F3F4F6)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-[11px] font-bold uppercase sticky left-0 z-20 cbc-sticky-col" style={{ color: 'var(--cbc-text-muted, #6B7280)', background: 'var(--cbc-bg-elevated, #F9FAFB)' }}>Usuário</th>
                  {TAB_LIST.map(t => {
                    const TIcon = t.Icon;
                    return (
                      <th key={t.key} className="text-center px-2 py-3 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
                        <TIcon className="w-4 h-4 mx-auto mb-0.5" aria-hidden="true" />
                        <div>{t.label}</div>
                      </th>
                    );
                  })}
                  <th className="text-center px-3 py-3 text-[10px] font-bold uppercase" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>Cargo</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => <UserRow key={u.id} user={u} onUpdate={fetchUsers} vendedoras={vendedoras} />)}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--cbc-border, #F3F4F6)' }}>
        <span className="text-[11px] uppercase tabular-nums" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>{users.length} usuário(s) cadastrado(s)</span>
        {/* (resilience 28/04) Limpar cache offline de contratos */}
        <button
          onClick={async () => {
            await clearContractsCache();
            try {
              localStorage.removeItem('cbc-supabase-health-history');
            } catch { /* ignore */ }
            alert('Cache local de contratos e historico Supabase removidos.');
          }}
          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer border hover:bg-gray-50 dark:hover:bg-gray-800"
          style={{ borderColor: 'var(--cbc-border, #E5E7EB)', color: 'var(--cbc-text-muted, #6B7280)' }}
          title="Remove os contratos salvos offline (IndexedDB) e o historico do monitor Supabase"
        >
          Limpar cache local
        </button>
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onAdded={fetchUsers} />}
    </div>
  );
}
