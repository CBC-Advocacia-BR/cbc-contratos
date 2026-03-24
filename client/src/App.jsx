import { useState, useCallback, useEffect, useRef } from 'react';
import { API_URL } from './config';
import { ContractProvider, useContract } from './ContractContext';
import { AuthProvider, useAuth } from './AuthContext';
import LoginScreen from './components/LoginScreen';
import FormPanel from './components/FormPanel';
import LivePreview from './components/LivePreview';
import ZapSignModal from './components/ZapSignModal';
import ContratosTab from './components/ContratosTab';
import Dashboard from './components/Dashboard';
import ShortcutsGuide from './components/ShortcutsGuide';
import PreSendChecklist from './components/PreSendChecklist';
import { useDarkMode } from './hooks/useDarkMode';
import { generateFullDocumentHTML, generateProcuracaoHTML } from './utils/contractHtml';

// ─── Offline queue ───
const OFFLINE_QUEUE_KEY = 'cbc_offline_queue';
function getOfflineQueue() { try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; } }
function saveOfflineQueue(q) { try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); } catch {} }
async function syncOfflineQueue(setSaveMsg) {
  const queue = getOfflineQueue(); if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    try { const r = await fetch(`${API_URL}/api/contratos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) }); if (!r.ok) throw 0; } catch { remaining.push(item); }
  }
  saveOfflineQueue(remaining);
  if (remaining.length === 0 && queue.length > 0) { setSaveMsg(`${queue.length} contrato(s) sincronizado(s)!`); setTimeout(() => setSaveMsg(''), 3000); }
}

function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  return m;
}

function AppContent() {
  const { user, login, logout, loading: authLoading } = useAuth();
  const { data, updateData, resetAll } = useContract();
  const [showZapSign, setShowZapSign] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklistIssues, setChecklistIssues] = useState([]);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewTab, setPreviewTab] = useState('contrato');
  const [mainTab, setMainTab] = useState('novo');
  const [mobileView, setMobileView] = useState('form');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [notifications, setNotifications] = useState([]);
  const [dark, toggleDark] = useDarkMode();
  const isMobile = useIsMobile();

  // SSE notifications
  useEffect(() => {
    let es;
    try {
      es = new EventSource(`${API_URL}/api/notifications/stream`);
      es.addEventListener('contract_status', (e) => {
        const d = JSON.parse(e.data);
        setNotifications(prev => [d, ...prev].slice(0, 20));
        // Browser notification
        if (Notification.permission === 'granted') {
          new Notification('CBC Contratos', { body: d.message, icon: '/favicon.svg' });
        }
      });
    } catch {}
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    return () => { if (es) es.close(); };
  }, []);

  // Online/offline
  useEffect(() => {
    const on = () => { setIsOnline(true); syncOfflineQueue(setSaveMsg); };
    const off = () => setIsOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    syncOfflineQueue(setSaveMsg);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      switch (e.key) {
        case 's': e.preventDefault(); handleSaveContract(); break;
        case 'Enter': e.preventDefault(); handlePreSendCheck(); break;
        case 'n': e.preventDefault(); if (confirm('Limpar formulario?')) resetAll(); break;
        case 'p': e.preventDefault(); handlePdfPreview(); break;
        case 'd': e.preventDefault(); toggleDark(); break;
        case '/': e.preventDefault(); setShowShortcuts(s => !s); break;
        case '1': e.preventDefault(); setMainTab('novo'); break;
        case '2': e.preventDefault(); setMainTab('contratos'); break;
        case '3': e.preventDefault(); setMainTab('dashboard'); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data]);

  const handleSaveContract = useCallback(async (extraFields = {}) => {
    setSaving(true); setSaveMsg('');
    const payload = { ...data, ...extraFields, user_email: user?.email || '' };
    try {
      const resp = await fetch(`${API_URL}/api/contratos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error);
      setSaveMsg('Contrato salvo!'); setTimeout(() => setSaveMsg(''), 3000);
      return result;
    } catch (err) {
      const q = getOfflineQueue(); q.push(payload); saveOfflineQueue(q);
      setSaveMsg('Salvo offline.'); setTimeout(() => setSaveMsg(''), 5000);
      return null;
    } finally { setSaving(false); }
  }, [data, user]);

  const handleLoadContract = useCallback((dados) => { updateData(dados); setMainTab('novo'); }, [updateData]);

  const handlePreSendCheck = useCallback(async () => {
    try {
      const resp = await fetch(`${API_URL}/api/checklist/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await resp.json();
      setChecklistIssues(result.issues || []);
      setShowChecklist(true);
    } catch { setShowZapSign(true); }
  }, [data]);

  const handlePdfPreview = useCallback(async () => {
    try {
      const html = generateFullDocumentHTML(data);
      const resp = await fetch(`${API_URL}/api/generate-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }) });
      if (!resp.ok) throw new Error('Erro ao gerar PDF');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      setShowPdfPreview(true);
    } catch (err) { setSaveMsg('Erro PDF: ' + err.message); setTimeout(() => setSaveMsg(''), 3000); }
  }, [data]);

  const handlePdfSave = useCallback(async () => {
    setSaving(true); setSaveMsg('Gerando PDF...');
    try {
      // 1. Generate PDF
      const html = generateFullDocumentHTML(data);
      const resp = await fetch(`${API_URL}/api/generate-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }) });
      if (!resp.ok) throw new Error('Erro ao gerar PDF');
      const blob = await resp.blob();
      // 2. Download PDF
      const c1 = data.contratantes[0];
      const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
      const nomeFile = `Contrato_${(c1?.nome || 'cliente').replace(/\s+/g, '_')}_${(resort || 'resort').replace(/\s+/g, '_')}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nomeFile; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // 3. Save to DB
      await handleSaveContract();
      setSaveMsg('PDF salvo e contrato registrado!');
    } catch (err) { setSaveMsg('Erro: ' + err.message); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(''), 4000); }
  }, [data, handleSaveContract]);

  const handleProcuracaoPdf = useCallback(async () => {
    setSaving(true); setSaveMsg('Gerando Procuração...');
    try {
      const html = generateProcuracaoHTML(data, false);
      const resp = await fetch(`${API_URL}/api/generate-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }) });
      if (!resp.ok) throw new Error('Erro ao gerar PDF');
      const blob = await resp.blob();
      const c1 = data.contratantes[0];
      const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
      const nomeFile = `Procuracao_${(c1?.nome || 'cliente').replace(/\s+/g, '_')}_${(resort || 'resort').replace(/\s+/g, '_')}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nomeFile; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSaveMsg('Procuração gerada!');
    } catch (err) { setSaveMsg('Erro: ' + err.message); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(''), 4000); }
  }, [data]);

  const offlineCount = getOfflineQueue().length;
  const bg = dark ? '#111827' : '#F0F4F8';
  const headerBg = dark ? '#0F172A' : '#1B3A5C';
  const tabBg = dark ? '#020617' : '#0F2035';

  // Auth loading
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: '#1B3A5C' }}>
        <div className="text-white text-sm font-bold uppercase tracking-wide animate-pulse">Carregando...</div>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return <LoginScreen onLogin={login} />;
  }

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${dark ? 'dark' : ''}`} style={{ background: bg }}>
      {/* Header */}
      <header style={{ background: headerBg }} className="text-white shrink-0">
        <div className="px-3 md:px-6 py-3 md:py-4 flex items-center justify-between gap-2">
          <div className="text-center flex-1 min-w-0">
            <div className="text-[11px] md:text-[13px] font-bold uppercase tracking-[1px] md:tracking-[1.5px] truncate">
              {isMobile ? 'CBC Advogados' : 'Conforto, Bergonsi & Cavalari Advogados'}
            </div>
            <div className="text-[10px] md:text-[11px] opacity-70 tracking-wide mt-0.5">
              OAB/SP n 55227 — Americana - SP
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!isOnline && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/30 text-red-200 font-bold uppercase">
                Offline{offlineCount > 0 && ` (${offlineCount})`}
              </span>
            )}
            {saveMsg && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${saveMsg.startsWith('Erro') ? 'bg-red-500/30' : 'bg-green-500/30'}`}>{saveMsg}</span>
            )}
            {/* Dark mode toggle */}
            <button onClick={toggleDark} className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors" title="Modo escuro (Ctrl+D)">
              {dark ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>
            {/* Shortcuts guide */}
            <button onClick={() => setShowShortcuts(true)} className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors" title="Atalhos (Ctrl+/)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </button>
            {/* User info + logout */}
            {user && (
              <>
                <span className="text-[10px] font-bold opacity-80 hidden md:inline">{user.name}</span>
                <button onClick={logout} className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors opacity-70 hover:opacity-100" title="Sair">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Tabs — hidden on mobile (shown as bottom nav instead) */}
      {!isMobile && (
        <div style={{ background: tabBg }} className="flex shrink-0">
          {['novo', 'contratos', 'dashboard'].map(tab => (
            <button key={tab} onClick={() => setMainTab(tab)}
              className={`flex-1 py-2.5 text-[12px] font-bold uppercase tracking-[1px] cursor-pointer transition-all ${mainTab === tab ? 'text-white bg-white/10' : 'text-white/50 hover:text-white/80'}`}>
              {tab === 'novo' ? 'Novo Contrato' : tab === 'contratos' ? 'Contratos Salvos' : 'Dashboard'}
            </button>
          ))}
        </div>
      )}

      {/* Notification bar */}
      {notifications.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 text-[10px] font-bold text-white flex items-center justify-between" style={{ background: '#16A34A' }}>
          <span>{notifications[0].message}</span>
          <button onClick={() => setNotifications([])} className="text-white/80 hover:text-white cursor-pointer">&times;</button>
        </div>
      )}

      {mainTab === 'novo' ? (
        isMobile ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              {[{ key: 'form', label: 'Formulario' }, { key: 'contrato', label: 'Contrato' }, { key: 'procuracao', label: 'Procuracao' }].map(t => (
                <button key={t.key}
                  onClick={() => { setMobileView(t.key === 'form' ? 'form' : 'preview'); if (t.key !== 'form') setPreviewTab(t.key); }}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-[0.5px] cursor-pointer transition-all ${(t.key === 'form' && mobileView === 'form') || (mobileView === 'preview' && previewTab === t.key) ? 'text-white' : 'text-gray-500 dark:text-gray-400'}`}
                  style={(t.key === 'form' && mobileView === 'form') || (mobileView === 'preview' && previewTab === t.key) ? { background: headerBg } : {}}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {mobileView === 'form' ? (
                <div className="bg-white dark:bg-gray-800 overflow-x-hidden">
                  <FormPanel onSave={() => handleSaveContract()} onSendZapSign={handlePreSendCheck} onPdfPreview={handlePdfPreview} onPdfSave={handlePdfSave} onProcuracaoPdf={handleProcuracaoPdf} saving={saving} />
                </div>
              ) : (
                <div className="p-3" style={{ background: bg }}><LivePreview tab={previewTab} /></div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-[480px] min-w-[420px] overflow-y-auto bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
              <FormPanel onSave={() => handleSaveContract()} onSendZapSign={handlePreSendCheck} onPdfPreview={handlePdfPreview} onPdfSave={handlePdfSave} onProcuracaoPdf={handleProcuracaoPdf} saving={saving} />
            </div>
            <div className="flex-1 flex flex-col overflow-hidden" style={{ background: bg }}>
              <div className="flex shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                {['contrato', 'procuracao'].map(tab => (
                  <button key={tab} onClick={() => setPreviewTab(tab)}
                    className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wide transition-all cursor-pointer ${previewTab === tab ? 'text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    style={previewTab === tab ? { background: headerBg } : {}}>
                    {tab === 'contrato' ? 'Contrato' : 'Procuracao Ad Judicia'}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-4"><LivePreview tab={previewTab} /></div>
            </div>
          </div>
        )
      ) : mainTab === 'contratos' ? (
        <div className="flex-1 overflow-hidden bg-white dark:bg-gray-800"><ContratosTab onLoadContract={handleLoadContract} /></div>
      ) : (
        <div className="flex-1 overflow-hidden" style={{ background: bg }}><Dashboard /></div>
      )}

      {/* Modals */}
      {showZapSign && <ZapSignModal onClose={() => setShowZapSign(false)} onSaveAfterSend={(z) => handleSaveContract({ status: 'enviado_zapsign', zapsign_doc_token: z?.token, zapsign_links: z?.signers })} />}
      {showShortcuts && <ShortcutsGuide onClose={() => setShowShortcuts(false)} />}
      {showChecklist && <PreSendChecklist issues={checklistIssues} onClose={() => setShowChecklist(false)} onProceed={() => { setShowChecklist(false); setShowZapSign(true); }} />}

      {/* PDF Preview Modal */}
      {showPdfPreview && pdfUrl && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { setShowPdfPreview(false); URL.revokeObjectURL(pdfUrl); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 text-white" style={{ background: headerBg }}>
              <span className="text-xs font-bold uppercase tracking-wide">Preview do PDF</span>
              <div className="flex gap-2">
                <a href={pdfUrl} download="contrato_cbc.pdf" className="text-[10px] font-bold uppercase px-3 py-1 bg-white/20 rounded-lg hover:bg-white/30 cursor-pointer">Download</a>
                <button onClick={() => { setShowPdfPreview(false); URL.revokeObjectURL(pdfUrl); }} className="text-white/80 hover:text-white cursor-pointer text-lg">&times;</button>
              </div>
            </div>
            <iframe src={pdfUrl} className="flex-1 w-full" style={{ border: 'none' }} />
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <nav className="shrink-0 flex border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 safe-area-bottom" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
          {[
            { key: 'novo', label: 'Novo', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> },
            { key: 'contratos', label: 'Salvos', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
            { key: 'dashboard', label: 'Dashboard', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
          ].map(t => (
            <button key={t.key} onClick={() => setMainTab(t.key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 cursor-pointer transition-all ${mainTab === t.key ? 'text-navy dark:text-blue-400' : 'text-gray-400'}`}>
              {t.icon}
              <span className="text-[9px] font-bold uppercase">{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ContractProvider>
        <AppContent />
      </ContractProvider>
    </AuthProvider>
  );
}
