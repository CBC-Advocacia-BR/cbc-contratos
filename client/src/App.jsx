import React, { useState, useCallback, useEffect, useRef, useLayoutEffect, lazy, Suspense } from 'react';
import * as Sentry from '@sentry/react';
import { reportErro } from './utils/reportError';
import { supabase } from './lib/supabase';
import { ContractProvider, useContract } from './ContractContext';
import { AuthProvider, useAuth } from './AuthContext';
import LoginScreen from './components/LoginScreen';
import FormPanel from './components/FormPanel';
import LivePreview from './components/LivePreview';
import ZapSignModal from './components/ZapSignModal';
import ProgressBar from './components/ProgressBar';
import {
  SkeletonDashboard,
  SkeletonContratosTab,
  SkeletonMonitor,
  SkeletonIntegracoes,
  SkeletonAdmin,
  SkeletonBoletos,
  SkeletonAsaas,
} from './components/Skeleton';
// (#27) Lazy load heavy tabs — loaded only when first accessed
// (perf-fe-14) ContratosTab (~2000 linhas) e (perf-fe-5) GlobalSearch (puxa fuse.js)
// saem do bundle inicial — carregam so quando a aba/busca abre.
const ContratosTab = lazy(() => import('./components/ContratosTab'));
const GlobalSearch = lazy(() => import('./components/GlobalSearch'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const AsaasPanel = lazy(() => import('./components/AsaasPanel'));
const BoletosPanel = lazy(() => import('./components/BoletosPanel'));
const MonitorPanel = lazy(() => import('./components/MonitorPanel'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
// LeadsTab removido — aba Leads desativada (cleanup 20260418_152512)
// IntegracoesPanel removido — aba Integracoes desativada (cleanup 20260418_152512)
// (chatguru removal 2026-05) ChatguruAutomationsPanel removido — comunicacao agora via Kommo manual
// (#306) Dashboard Socios — lazy, restrito por email
const SociosDashboard = lazy(() => import('./components/SociosDashboard'));
const FunnelHealthPanel = lazy(() => import('./components/FunnelHealthPanel'));
const TrafegoPanel = lazy(() => import('./components/TrafegoPanel'));
// Vendas Fase 2 — painel do vendedor/assistente e parametrizacao (admin)
const VendasPanel = lazy(() => import('./components/VendasPanel'));
const VendasParametrizacaoPanel = lazy(() => import('./components/VendasParametrizacaoPanel'));
// Bot ADVBOX (autoatendimento Kommo x ADVBOX) — versao de teste (06/2026)
const BotAdvboxPanel = lazy(() => import('./components/BotAdvboxPanel'));
// Portal do Cliente — gestao dos links de acesso (06/2026)
const PortalClientePanel = lazy(() => import('./components/PortalClientePanel'));
// Cadastro unico de clientes (golden record) — aba nova 06/2026
const ClientesTab = lazy(() => import('./components/ClientesTab'));

// (perf 31/05) Prefetch das abas lazy ao passar o mouse / focar o botao: o codigo da
// aba chega "quentinho" antes do clique. Usa o MESMO path do lazy() acima, entao o
// bundler reaproveita o chunk (import() dedupa) — NAO adiciona peso ao bundle inicial.
const TAB_PREFETCH = {
  dashboard: () => import('./components/Dashboard'),
  asaas: () => import('./components/AsaasPanel'),
  boletos: () => import('./components/BoletosPanel'),
  monitor: () => import('./components/MonitorPanel'),
  admin: () => import('./components/AdminPanel'),
  socios: () => import('./components/SociosDashboard'),
  funil: () => import('./components/FunnelHealthPanel'),
  trafego: () => import('./components/TrafegoPanel'),
  vendas: () => import('./components/VendasPanel'),
  parametrizacao_vendas: () => import('./components/VendasParametrizacaoPanel'),
  bot: () => import('./components/BotAdvboxPanel'),
  portal: () => import('./components/PortalClientePanel'),
  clientes: () => import('./components/ClientesTab'),
};
const _prefetchedTabs = new Set();
function prefetchTab(key) {
  if (!key || _prefetchedTabs.has(key) || !TAB_PREFETCH[key]) return;
  _prefetchedTabs.add(key);
  TAB_PREFETCH[key]().catch(() => _prefetchedTabs.delete(key)); // se falhar, permite tentar de novo
}

const ASAAS_USERS = ['paulo@advocaciacbc.com', 'paulo.conforto@outlook.com', 'bruno@advocaciacbc.com', 'anderson@advocaciacbc.com', 'lorenza@advocaciacbc.com', 'lucas@advocaciacbc.com'];
// (#306) Socios — emails com acesso ao Dashboard Socios (restrito por email, nao por is_admin)
const SOCIOS_EMAILS = ['paulo@advocaciacbc.com', 'bruno@advocaciacbc.com'];

// (v6.2.0) Controle de retry do upload para Google Drive
// - MAX_ATTEMPTS: apos X falhas, marca 'failed' e para de tentar
// - RETRY_INTERVAL: intervalo minimo entre tentativas (evita loop infinito)
// - LOCK_TIMEOUT: tempo apos o qual lock 'uploading' eh considerado orfao
// - DETERMINISTIC_ERRORS: erros que nao adianta retentar (precisa intervencao)
const DRIVE_MAX_ATTEMPTS = 3;
const DRIVE_RETRY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos
const DRIVE_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
const DRIVE_FAILED_RETRY_MS = 6 * 60 * 60 * 1000; // 6h: 'failed' antigo se auto-cura e tenta de novo
const DRIVE_DETERMINISTIC_ERRORS = ['FOLDER_NOT_FOUND', 'NO_PERMISSION', 'ZAPSIGN_ERROR'];
// Erros TRANSITÓRIOS (chunk velho após deploy, rede, timeout): NÃO são falha do
// contrato — não consomem tentativa nem viram 'failed'; apenas retentam depois.
const isTransientDriveError = (msg) => /dynamically imported module|failed to fetch|load failed|networkerror|err_network|timeout|getaddrinfo|ECONNRESET|socket hang up|fetch failed/i.test(String(msg || ''));
import ShortcutsGuide from './components/ShortcutsGuide';
import PreSendChecklist from './components/PreSendChecklist';
import { useDarkMode } from './hooks/useDarkMode';
import { useDensity } from './hooks/useDensity';
import { useDeviceType, applyDeviceClass } from './hooks/useDeviceType';
import ChangeLog, { VERSIONS, NewVersionBanner } from './components/ChangeLog';
// (#126) Helper API — Edge Functions com fallback para /.netlify/functions/*
import { API } from './utils/apiEndpoints';
import { celebrateCBC } from './utils/confetti';
import { celebrations, getMonthlyGoal } from './utils/celebrations';
import ConfirmDestructive from './components/ConfirmDestructive';
import SaveDecisionModal from './components/SaveDecisionModal';
import { decideSaveMode, SAVE_MODES } from './utils/saveGuard';
import UndoToast from './components/UndoToast';
import { useUndo } from './hooks/useUndo';
import { ToastProvider } from './components/Toast';
import NotificationCenter from './components/NotificationCenter';
import ActivityFeed from './components/ActivityFeed';
import NotificationPrefsModal from './components/NotificationPrefsModal';
import { generateContractHTML, generateProcuracaoHTML } from './utils/contractHtml';
// pdfGenerator importado dinamicamente em cada handler (lazy) (#112)
import { validateEmail, validateCPF, validateCNPJ } from './utils/validation';
import {
  CreditCardIcon,
  DocumentIcon,
  ComputerDesktopIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  DocumentTextIcon,
  ChartBarIcon,
  BoltIcon,
  BriefcaseIcon,
  BanknotesIcon,
  DocumentCheckIcon,
  ChatBubbleLeftRightIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  FunnelIcon,
  MegaphoneIcon,
} from '@heroicons/react/24/outline';
// (mobile 06/2026) Sheet de navegação do dock — abas além das 3 fixas
import MobileNavSheet from './components/MobileNavSheet';

// (mobile 06/2026) Labels das abas para o sheet de navegação mobile
const MOBILE_TAB_LABELS = {
  novo: 'Novo Contrato',
  contratos: 'Contratos',
  vendas: 'Minhas Vendas',
  dashboard: 'Dashboard',
  socios: 'Sócios',
  funil: 'Saúde do Funil',
  trafego: 'Tráfego',
  asaas: 'Asaas',
  boletos: 'Boletos',
  bot: 'Bot ADVBOX',
  portal: 'Portal Cliente',
  monitor: 'Monitor',
  admin: 'Admin',
  parametrizacao_vendas: 'Param. Vendas',
};

// Mapa de ícones de abas
// (cleanup 20260418_152512) removidos: leads, integracoes, comissoes_socios
const TAB_ICONS = {
  asaas: CreditCardIcon,
  boletos: DocumentIcon,
  // (chatguru removal) chatguru: removido
  monitor: ComputerDesktopIcon,
  admin: Cog6ToothIcon,
  dashboard: ChartBarIcon,
  contratos: DocumentTextIcon,
  novo: PlusIcon,
  socios: BriefcaseIcon,
  funil: FunnelIcon,
  trafego: MegaphoneIcon,
  vendas: BanknotesIcon,
  parametrizacao_vendas: DocumentCheckIcon,
  bot: ChatBubbleLeftRightIcon,
  portal: LinkIcon,
};

// (quality-14) intervalos das automacoes com nome (em vez de numeros magicos)
const POLL_INTERVAL_MS = 5 * 60 * 1000;          // varredura de automacoes (ZapSign/ADVBOX/Drive)
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;  // bolinha de saude no cabecalho

// ─── Offline queue (localStorage-based, syncs to Supabase) ───
const OFFLINE_QUEUE_KEY = 'cbc_offline_queue';
function getOfflineQueue() { try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; } }
function saveOfflineQueue(q) { try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); } catch { /* best-effort */ } }
async function syncOfflineQueue(setSaveMsg) {
  const queue = getOfflineQueue(); if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    try {
      const row = buildContratoRow(item);
      const { error } = await supabase.from('contratos').insert(row);
      if (error) throw error;
    } catch { remaining.push(item); }
  }
  saveOfflineQueue(remaining);
  if (remaining.length === 0 && queue.length > 0) { setSaveMsg(`${queue.length} contrato(s) sincronizado(s)!`); setTimeout(() => setSaveMsg(''), 3000); }
}

// Build a flat row for the contratos table from form data
function buildContratoRow(data) {
  const c1 = data.contratantes?.[0] || {};
  const c2 = data.numContratantes === 2 ? (data.contratantes?.[1] || {}) : {};
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
  // (perf-be-14) extrai o lead do Kommo p/ a coluna dedicada — o mapa processo->lead
  // do servidor deixa de abrir o JSON dos contratantes.
  const leadLink = (data.contratantes || []).map((c) => c?.linkKommo).find((l) => /\/leads\/detail\/\d+/.test(l || ''));
  const kommoLeadId = leadLink ? Number((String(leadLink).match(/\/leads\/detail\/(\d+)/) || [])[1]) : null;
  // (PJ 25/06) Para Cliente Empresa, as colunas denormalizadas (usadas em listas/busca/export)
  // representam a EMPRESA (razao social + CNPJ + e-mail da empresa). Os dados do representante
  // legal seguem completos no JSONB `dados`. Nenhuma coluna nova e criada na tabela.
  return {
    nome_contratante1: (c1.tipo === 'pj' ? c1.razaoSocial : c1.nome) || '',
    cpf_contratante1: (c1.tipo === 'pj' ? c1.cnpj : c1.cpf) || '',
    email_contratante1: (c1.tipo === 'pj' ? c1.emailEmpresa : c1.email) || '',
    nome_contratante2: (c2.tipo === 'pj' ? c2.razaoSocial : c2.nome) || null,
    cpf_contratante2: (c2.tipo === 'pj' ? c2.cnpj : c2.cpf) || null,
    email_contratante2: (c2.tipo === 'pj' ? c2.emailEmpresa : c2.email) || null,
    resort: resort || '',
    tipo_acao: tipoAcao || '',
    honorarios_total: data.honorarios?.somenteExito ? 0 : (data.honorarios?.total || 0),
    honorarios_parcelas: data.honorarios?.somenteExito ? 0 : (data.honorarios?.parcelas || 0),
    honorarios_valor_parcela: data.honorarios?.somenteExito ? 0 : (data.honorarios?.valorParcela || 0),
    honorarios_percentual_exito: data.honorarios?.somenteIniciais ? 0 : (data.honorarios?.percentualExito || 0),
    status: data.status || 'rascunho',
    zapsign_doc_token: data.zapsign_doc_token || null,
    zapsign_links: data.zapsign_links || null,
    pdf_page_split: data.pdf_page_split || null,
    kommo_lead_id: kommoLeadId, // (perf-be-14)
    dados: data,
    created_by: data.user_email || null,
    updated_by: data.user_email || null,
  };
}

// ─── Local checklist validation ───
function validateChecklist(data) {
  const issues = [];
  if (!data.numContratantes || data.numContratantes < 1) {
    issues.push({ msg: 'Selecione o numero de contratantes.' });
  }
  for (let i = 0; i < (data.numContratantes || 0); i++) {
    const c = data.contratantes?.[i];
    if (!c) { issues.push({ msg: `Dados do Contratante ${i + 1} ausentes.` }); continue; }
    // (PJ 25/06) Cliente Empresa: alem do bloco da empresa, os campos de pessoa abaixo
    // continuam exigidos e descrevem o REPRESENTANTE LEGAL.
    if (c.tipo === 'pj') {
      const emp = `Contratante ${i + 1} (empresa)`;
      if (!c.razaoSocial?.trim()) issues.push({ msg: `${emp}: Razao social obrigatoria.` });
      if (!c.cnpj?.trim()) issues.push({ msg: `${emp}: CNPJ obrigatorio.` });
      else if (!validateCNPJ(c.cnpj)) issues.push({ msg: `${emp}: CNPJ invalido.` });
      if (!c.emailEmpresa?.trim()) issues.push({ msg: `${emp}: E-mail da empresa obrigatorio.` });
      else if (!validateEmail(c.emailEmpresa)) issues.push({ msg: `${emp}: E-mail da empresa invalido.` });
      if (!c.enderecoEmpresa?.trim()) issues.push({ msg: `${emp}: Endereco da empresa obrigatorio.` });
      if (!c.numeroEmpresa?.trim()) issues.push({ msg: `${emp}: Numero da empresa obrigatorio.` });
      if (!c.bairroEmpresa?.trim()) issues.push({ msg: `${emp}: Bairro da empresa obrigatorio.` });
      if (!c.cidadeEmpresa?.trim()) issues.push({ msg: `${emp}: Cidade da empresa obrigatoria.` });
      if (!c.ufEmpresa?.trim()) issues.push({ msg: `${emp}: UF da empresa obrigatoria.` });
      if (!c.cepEmpresa?.trim()) issues.push({ msg: `${emp}: CEP da empresa obrigatorio.` });
    }
    if (!c.nome?.trim()) issues.push({ msg: `Contratante ${i + 1}: Nome obrigatorio.` });
    if (!c.nacionalidade?.trim()) issues.push({ msg: `Contratante ${i + 1}: Nacionalidade obrigatoria.` });
    if (!c.profissao?.trim()) issues.push({ msg: `Contratante ${i + 1}: Profissao obrigatoria.` });
    if (!c.estadoCivil?.trim()) issues.push({ msg: `Contratante ${i + 1}: Estado civil obrigatorio.` });
    if (!c.cpf?.trim()) issues.push({ msg: `Contratante ${i + 1}: CPF obrigatorio.` });
    else if (!validateCPF(c.cpf)) issues.push({ msg: `Contratante ${i + 1}: CPF invalido.` });
    if (!c.email?.trim()) issues.push({ msg: `Contratante ${i + 1}: E-mail obrigatorio.` });
    else if (!validateEmail(c.email)) issues.push({ msg: `Contratante ${i + 1}: E-mail invalido.` });
    if (!c.rg?.trim()) issues.push({ msg: `Contratante ${i + 1}: RG obrigatorio.` });
    if (!c.dataNascimento?.trim()) issues.push({ msg: `Contratante ${i + 1}: Data de nascimento obrigatoria.` });
    if (!c.telefone?.trim()) issues.push({ msg: `Contratante ${i + 1}: Celular obrigatorio.` });
    // Link Kommo obrigatorio E no formato /leads/detail/{id} (so esse formato habilita
    // mover lead + notas automaticas no CRM — qualquer outra URL quebra silenciosamente).
    if (!c.linkKommo?.trim()) issues.push({ msg: `Contratante ${i + 1}: Link Kommo obrigatorio.` });
    else if (!/\/leads\/detail\/\d+/.test(c.linkKommo.trim())) issues.push({ msg: `Contratante ${i + 1}: Link Kommo invalido (use a URL da conversa no formato .../leads/detail/NUMERO).` });
    if (!c.endereco?.trim()) issues.push({ msg: `Contratante ${i + 1}: Endereco obrigatorio.` });
    if (!c.numero?.trim()) issues.push({ msg: `Contratante ${i + 1}: Numero obrigatorio.` });
    if (!c.bairro?.trim()) issues.push({ msg: `Contratante ${i + 1}: Bairro obrigatorio.` });
    if (!c.cidade?.trim()) issues.push({ msg: `Contratante ${i + 1}: Cidade obrigatoria.` });
    if (!c.uf?.trim()) issues.push({ msg: `Contratante ${i + 1}: UF obrigatoria.` });
    if (!c.cep?.trim()) issues.push({ msg: `Contratante ${i + 1}: CEP obrigatorio.` });
  }
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  if (!resort?.trim()) issues.push({ msg: 'Resort/Empreendimento obrigatorio.' });
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
  if (!tipoAcao?.trim()) issues.push({ msg: 'Tipo de acao obrigatorio.' });
  if (!data.honorarios?.somenteExito && (!data.honorarios?.total || data.honorarios.total <= 0)) {
    issues.push({ msg: 'Valor dos honorarios obrigatorio (ou marque somente exito).' });
  }
  // (#11) campos internos exigidos pelo isFormComplete — antes o atalho Cmd+Enter (que so
  // passa por aqui) deixava enviar contrato sem eles, divergindo do botao "Enviar".
  if (!data.origemCliente) issues.push({ msg: 'Origem do cliente obrigatoria.' });
  if (!data.dataPrimeiraMensagem) issues.push({ msg: 'Data da primeira mensagem obrigatoria.' });
  if (!data.linkGoogleDrive?.trim()) issues.push({ msg: 'Link da pasta Google Drive obrigatorio.' });
  return issues;
}

// (#229) Error Boundary — catches crashes in individual tabs
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <ExclamationTriangleIcon className="w-12 h-12 text-amber-500" aria-hidden="true" />
          <div className="text-sm font-bold text-gray-700">Algo deu errado nesta secao</div>
          <div className="text-xs text-gray-500 max-w-sm">{this.state.error?.message}</div>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white cursor-pointer" style={{ background: '#1B3A5C' }}>
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// (iPad 2026-06) useIsMobile mantido para retro-compat, mas internamente usa
// useDeviceType. "mobile" agora significa "sem espaco para top tabs": phone
// sempre + tablet portrait (iPad Air 13" portrait = 1024x1366 ainda comporta
// top tabs, mas mantemos legado <768 para nao quebrar checks).
function useIsMobile() {
  const [m, setM] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  return m;
}

// (#32) Autosave indicator — shows "Salvo ha Xmin"
function AutosaveIndicator({ savedAt }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const update = () => {
      const diff = Math.round((Date.now() - savedAt.getTime()) / 1000);
      if (diff < 10) setLabel('Salvo agora');
      else if (diff < 60) setLabel(`Salvo ha ${diff}s`);
      else if (diff < 3600) setLabel(`Salvo ha ${Math.floor(diff / 60)}min`);
      else setLabel(`Salvo ha ${Math.floor(diff / 3600)}h`);
    };
    update();
    const t = setInterval(update, 10000);
    return () => clearInterval(t);
  }, [savedAt]);
  return (
    <span className="hidden md:flex items-center gap-1 text-[9px] font-bold text-green-300/80 bg-white/5 px-2 py-0.5 rounded-full">
      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
      {label}
    </span>
  );
}

// (#27) Lazy loading fallback — mantido como loading generico
function TabFallback({ skeleton }) {
  if (skeleton) return skeleton;
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-8 h-8 border-3 border-gray-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-2" />
        <div className="text-xs text-gray-400">Carregando...</div>
      </div>
    </div>
  );
}

// (#74) Scroll restoration wrapper — salva/restaura scroll por aba.
// Como os paineis internos tem scroll proprio (overflow-y-auto), registramos
// listener em modo capture para interceptar o primeiro elemento scrollavel.
function TabScrollContainer({ tabKey, className = '', style, children, innerRef }) {
  const localRef = useRef(null);
  const containerRef = innerRef || localRef;
  const throttleRef = useRef(null);
  const sessionKey = `scroll:${tabKey}`;

  // Encontrar o primeiro descendente scrollavel
  const findScrollable = useCallback(() => {
    const root = containerRef.current;
    if (!root) return null;
    // Percorre DFS e pega o primeiro com scrollHeight > clientHeight e overflow auto/scroll
    const walk = (el) => {
      if (!el || el.nodeType !== 1) return null;
      const cs = window.getComputedStyle(el);
      const oy = cs.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
        return el;
      }
      for (const child of el.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(root);
  }, [containerRef]);

  // Handler de scroll (throttle 200ms) em modo capture
  const handleScroll = useCallback((e) => {
    const target = e.target;
    if (!target || !containerRef.current) return;
    // Verifica se o target esta dentro do wrapper desta aba
    if (!containerRef.current.contains(target)) return;
    if (throttleRef.current) return;
    throttleRef.current = setTimeout(() => {
      try { sessionStorage.setItem(sessionKey, String(target.scrollTop || 0)); } catch { /* ignore */ }
      throttleRef.current = null;
    }, 200);
  }, [sessionKey, containerRef]);

  // Anexar listener em capture
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.addEventListener('scroll', handleScroll, true);
    return () => {
      root.removeEventListener('scroll', handleScroll, true);
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
    };
  }, [handleScroll, containerRef]);

  // Restaurar ao montar (apos descendente scrollavel estar disponivel)
  useLayoutEffect(() => {
    try {
      const saved = sessionStorage.getItem(sessionKey);
      if (!saved) return;
      const pos = Number(saved);
      if (pos <= 0) return;
      // Tentativas em cascata: o filho scrollavel pode ainda nao estar montado
      let attempts = 0;
      const tryRestore = () => {
        const scrollable = findScrollable();
        if (scrollable) {
          scrollable.scrollTop = pos;
          return;
        }
        if (attempts++ < 8) {
          requestAnimationFrame(tryRestore);
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(tryRestore));
    } catch { /* ignore */ }
  }, [sessionKey, findScrollable]);

  return (
    <div ref={containerRef} className={className} style={style}>
      {children}
    </div>
  );
}

function AppContent() {
  const { user, login, loginWithGoogle, logout, loading: authLoading, loginWarnings, dismissWarnings } = useAuth();
  const { data, updateData, resetAll } = useContract();
  const [showZapSign, setShowZapSign] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklistIssues, setChecklistIssues] = useState([]);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewTab, setPreviewTab] = useState('contrato');
  // (#67) Persistir aba ativa entre sessoes — fallback 'novo' se vazio/invalido
  const [mainTab, setMainTab] = useState(() => {
    try {
      const saved = localStorage.getItem('cbc:mainTab');
      return saved || 'novo';
    } catch { return 'novo'; }
  });
  useEffect(() => {
    try { localStorage.setItem('cbc:mainTab', mainTab); } catch { /* localStorage indisponivel */ }
  }, [mainTab]);
  const [mobileView, setMobileView] = useState('form');
  const [focusMode, setFocusMode] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // (mobile 06/2026) Sheet de navegação aberto pelo item "Mais" do dock
  const [showNavSheet, setShowNavSheet] = useState(false);
  const [userPerms, setUserPerms] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [notifications, setNotifications] = useState([]);
  const [celebrationName, setCelebrationName] = useState('');
  const [healthStatus, setHealthStatus] = useState('ok'); // 'ok' | 'slow' | 'error'
  const [savedContractId, setSavedContractId] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null); // (#32) autosave indicator
  const [portalPendentes, setPortalPendentes] = useState(0); // badge: dúvidas do portal sem resposta
  // (#97) Progresso granular para geracao de PDF
  const [pdfProgress, setPdfProgress] = useState(null);
  const [dark, toggleDark] = useDarkMode();
  const [density, setDensity] = useDensity();
  const [showDensityMenu, setShowDensityMenu] = useState(false);
  // (#205) Preferencias de notificacao
  const [showNotifPrefs, setShowNotifPrefs] = useState(false);
  const isMobile = useIsMobile();
  // (iPad 2026-06) Device detection rico: class + orientation + pointer
  const device = useDeviceType();
  useEffect(() => { applyDeviceClass(device); }, [device]);
  // badge da aba Portal: conta dúvidas pendentes (recarrega ao trocar de aba + a cada 2 min)
  useEffect(() => {
    let vivo = true;
    const contar = () => supabase.from('portal_perguntas').select('id', { count: 'exact', head: true }).eq('status', 'pendente')
      .then(({ count }) => { if (vivo) setPortalPendentes(count || 0); }).catch(() => {});
    contar();
    const t = setInterval(contar, 120000);
    return () => { vivo = false; clearInterval(t); };
  }, [mainTab]);

  // (#16) Confirmacao destrutiva global — permite qualquer tab disparar
  const [destructiveConfirm, setDestructiveConfirm] = useState(null);
  // (trava 17/07/2026) rascunho carregado com resort trocado: operador decide novo vs corrigir
  const [saveDecision, setSaveDecision] = useState(null);
  // (#17) Undo system global (10s timeout)
  const undoCtrl = useUndo(10000);
  // (resilience 28/04) Banner global de degradacao do Supabase. Disparado pelo
  // utilitario safeQuery (utils/supabaseSafe.js) ou por fallback de cache em
  // ContratosTab. Auto-hide em 30s.
  const [supabaseDegraded, setSupabaseDegraded] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      setSupabaseDegraded(e.detail);
      // Auto-hide depois de 30s
      const t = setTimeout(() => setSupabaseDegraded(null), 30000);
      return () => clearTimeout(t);
    };
    window.addEventListener('cbc:supabase-degraded', handler);
    return () => window.removeEventListener('cbc:supabase-degraded', handler);
  }, []);

  // Supabase realtime notifications for contract status changes
  // (resilience 28/04) Nome fixo do channel — antes usava Date.now() e vazava
  // conexao a cada mount, esgotando o pool PostgreSQL. Cleanup garantido pelo
  // removeChannel no return. Filtro: apenas UPDATE em contratos (assinatura).
  useEffect(() => {
    const channel = supabase
      .channel('contratos-status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contratos' }, (payload) => {
        const row = payload.new;
        if (row.status === 'assinado') {
          const msg = { message: `Contrato de ${row.nome_contratante1} foi assinado!`, status: row.status, id: row.id };
          setNotifications(prev => [msg, ...prev].slice(0, 20));
          // 🎉 PRA CIMA CBC! Confetti celebration
          celebrateCBC();
          // (#23) Celebracoes contextuais — rapidas, milestones, meta mensal
          // Checagens em background, nao bloqueiam o fluxo
          (async () => {
            try {
              // Assinatura rapida (< 1h entre envio e assinatura)
              const sentAt = payload.old?.updated_at && payload.old?.status === 'enviado_zapsign'
                ? new Date(payload.old.updated_at).getTime() : null;
              const signedAt = row.signed_at ? new Date(row.signed_at).getTime() : Date.now();
              if (sentAt && signedAt) {
                const mins = Math.round((signedAt - sentAt) / 60000);
                if (mins > 0 && mins < 60) {
                  setTimeout(() => celebrations.fastSignature(mins), 4800);
                }
              }
              // Milestones + meta mensal — busca contagem atual
              const { count: totalSigned } = await supabase
                .from('contratos').select('id', { count: 'exact', head: true }).eq('status', 'assinado');
              if (totalSigned === 100) setTimeout(() => celebrations.milestone100(), 5200);
              else if (totalSigned === 500) setTimeout(() => celebrations.milestone500(), 5200);
              else if (totalSigned && [50, 200, 300, 400, 1000].includes(totalSigned)) {
                setTimeout(() => celebrations.milestone(totalSigned), 5200);
              }
              // Meta mensal
              const now = new Date();
              const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
              const { count: thisMonth } = await supabase
                .from('contratos').select('id', { count: 'exact', head: true })
                .eq('status', 'assinado').gte('signed_at', monthStart);
              const goal = getMonthlyGoal();
              if (thisMonth && thisMonth >= goal) {
                setTimeout(() => celebrations.monthlyGoal(thisMonth, goal), 5800);
              }
            } catch { /* celebracoes nao podem bloquear o fluxo */ }
          })();
          // (#5) Dynamic favicon — green check when signed
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 32; canvas.height = 32;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#16A34A';
            ctx.beginPath(); ctx.arc(16, 16, 16, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'white';
            ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('\u2713', 16, 17);
            const link = document.querySelector("link[rel*='icon']");
            if (link) { link.href = canvas.toDataURL(); setTimeout(() => { link.href = '/favicon.png'; }, 8000); }
          } catch { /* favicon best-effort */ }
          // (#16) Celebration banner
          setCelebrationName(row.nome_contratante1 || '');
          setTimeout(() => setCelebrationName(''), 4500);
          if (Notification.permission === 'granted') {
            new Notification('🏆 PRA CIMA CBC!', { body: msg.message, icon: '/favicon.png' });
          }
          // ADVBOX + Drive auto-sync handled by pollZapSign (no duplicate calls here)
        }
      })
      .subscribe();

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Global polling — ZapSign status check + ADVBOX sync + Drive save
  useEffect(() => {
    async function runAutomations() {
      // (custo-2 / perf-be-12) nao roda com a aba em segundo plano: o webhook do
      // ZapSign ja atualiza em tempo real, entao varrer o banco e chamar funcoes a
      // cada 5min em N abas ocultas so gasta invocacoes/banda a toa.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        // === PART 1: Check pending ZapSign signatures ===
        const { data: pending } = await supabase
          .from('contratos')
          .select('id, zapsign_doc_token, zapsign_links')
          .eq('status', 'enviado_zapsign')
          .not('zapsign_doc_token', 'is', null);

        for (const contract of (pending || [])) {
          try {
            // (#126) Migrado para Edge Function /api/zapsign com fallback
            const resp = await API.zapsign({ action: 'status', docToken: contract.zapsign_doc_token });
            if (!resp.ok) continue;
            const doc = await resp.json();
            const signers = doc.signers || [];
            const updatedLinks = signers.map(s => ({
              name: s.name, email: s.email, token: s.token,
              sign_url: s.sign_url || s.signing_link, status: s.status, signed_at: s.signed_at,
              times_viewed: s.times_viewed || 0,
              first_opened_at: s.first_opened_at || null,
              last_view_at: s.last_view_at || null,
            }));
            const allSigned = signers.length > 0 && signers.every(s => s.status === 'signed');

            // (#6) A nota Kommo #18 "abriu e nao assinou" saiu daqui — agora roda no
            // servidor (function agendada kommo-view-check), 24h, sem depender do app aberto.

            if (allSigned) {
              // (bug-4) grava a data REAL de assinatura (ultimo signatario). Antes o
              // polling so mudava o status e signed_at ficava vazio -> relatorios de
              // prazo/producao/comissao usavam aproximacao (signed_at -> advbox_date -> updated_at).
              const datasAssinatura = signers.map(s => s.signed_at).filter(Boolean).sort();
              const signedAt = datasAssinatura.length ? datasAssinatura[datasAssinatura.length - 1] : new Date().toISOString();
              await supabase.from('contratos')
                .update({ status: 'assinado', signed_at: signedAt, zapsign_links: updatedLinks, updated_at: new Date().toISOString() })
                .eq('id', contract.id).eq('status', 'enviado_zapsign');
            } else {
              // Guard: nao escreve se signers nao mudaram (evita audit spam — abr/2026)
              const prev = JSON.stringify(contract.zapsign_links || []);
              const next = JSON.stringify(updatedLinks);
              if (prev === next) continue;
              await supabase.from('contratos').update({ zapsign_links: updatedLinks }).eq('id', contract.id);
            }
          } catch (e) { reportErro('zapsign-poll', e, { contractId: contract.id }); }
        }

        // === PART 2: Process signed contracts missing ADVBOX or Drive ===
        // (auditoria #75) A parte ADVBOX agora TAMBEM roda no servidor 24/7 via
        // netlify/functions/advbox-sweep-cron.mjs (mesmo claim atomico — coexistem sem
        // duplicar). Este polling do cliente segue como caminho rapido quando o app esta
        // aberto e continua responsavel pelo Google Drive.
        const { data: needsProcessing } = await supabase
          .from('contratos')
          .select('id, zapsign_doc_token, dados, pdf_page_split, advbox_status, advbox_date, advbox_lawsuit_id, advbox_data, signed_at, drive_file_id, drive_attempts, drive_last_attempt_at, drive_last_error, drive_error_code')
          .eq('status', 'assinado')
          .not('zapsign_doc_token', 'is', null)
          // (QW#7) so traz quem realmente pode precisar de ADVBOX ou Drive — antes baixava
          // o JSONB 'dados' de TODOS os assinados a cada 5min (a maioria ja 100% processada).
          // Cobre as mesmas condicoes avaliadas no cliente: needsAdvbox (null/''/error/processing)
          // + Drive (sem upload, lock 'uploading' OU 'failed' p/ a auto-cura de 6h). 'ok'+'saved' nao sao trazidos.
          .or('advbox_status.is.null,advbox_status.eq.error,advbox_status.eq.,advbox_status.eq.processing,drive_file_id.is.null,drive_file_id.eq.uploading,drive_file_id.eq.failed');

        for (const c of (needsProcessing || [])) {
          if (!c.dados) continue;

          // ADVBOX — with stuck 'processing' recovery (>5min OU advbox_date ausente = retry)
          const needsAdvbox = c.advbox_status !== 'ok' && (
            !c.advbox_status || c.advbox_status === 'error' ||
            (c.advbox_status === 'processing' && (!c.advbox_date || (Date.now() - new Date(c.advbox_date).getTime() > 5 * 60 * 1000)))
          );
          if (needsAdvbox) {
            // Reset stuck 'processing' to null first
            if (c.advbox_status === 'processing') {
              await supabase.from('contratos').update({ advbox_status: null }).eq('id', c.id).eq('advbox_status', 'processing');
            }
            const { data: claimed } = await supabase.from('contratos')
              .update({ advbox_status: 'processing', advbox_date: new Date().toISOString() })
              .eq('id', c.id)
              .or('advbox_status.is.null,advbox_status.eq.error,advbox_status.eq.')
              .select('id');
            if (claimed?.length > 0) {
              try {
                // (#18) data de fechamento = data REAL da assinatura (signed_at), nao a data do sync.
                const dataAssin = c.signed_at ? new Date(c.signed_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                const advResp = await fetch('/.netlify/functions/advbox-sync', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...c.dados,
                    dataAssinatura: dataAssin,
                    // (#7) idempotencia no retry: reusa o processo/clientes ja criados em vez de duplicar.
                    existingLawsuitId: c.advbox_lawsuit_id || null,
                    existingCustomers: c.advbox_data?.customers || null,
                  }),
                });
                const advResult = await advResp.json();
                // (QW#2) so considera OK se o PROCESSO (lawsuit) tambem foi criado.
                // Antes: cliente criado + lawsuit falho (vira warning) marcava 'ok' e o
                // contrato ficava sem processo (lead nao movia no Kommo, datajud nunca
                // achava). Agora vira 'error' e entra no retry do polling/Monitor.
                // (#6) exige customersComplete: TODOS os contratantes viraram cliente (nao so >0).
                const advOk = advResult.success && advResult.customersComplete && !!advResult.lawsuit?.id;
                await supabase.from('contratos').update({
                  advbox_status: advOk ? 'ok' : 'error',
                  advbox_date: new Date().toISOString(), advbox_data: advResult,
                  advbox_lawsuit_id: advResult?.lawsuit?.id || null,
                }).eq('id', c.id);
                // Log to automation_log
                try { await supabase.from('automation_log').insert({ contract_id: c.id, action: 'advbox', status: advOk ? 'ok' : 'error', details: advResult, client_name: c.dados?.contratantes?.[0]?.nome }); } catch { /* log best-effort */ }
                // (QW#6) Avisos do Kommo (ex.: token 401) deixam de morrer no console:
                // viram um registro 'aviso' visível no log de automações.
                if (advResult.warnings?.length) {
                  try { await supabase.from('automation_log').insert({ contract_id: c.id, action: 'kommo', status: 'aviso', details: { warnings: advResult.warnings }, client_name: c.dados?.contratantes?.[0]?.nome }); } catch { /* log best-effort */ }
                }
                console.log('ADVBOX:', c.id, advOk ? 'OK' : advResult.warnings);
              } catch (e) {
                await supabase.from('contratos').update({ advbox_status: 'error', advbox_date: new Date().toISOString() }).eq('id', c.id);
                try { await supabase.from('automation_log').insert({ contract_id: c.id, action: 'advbox', status: 'error', details: { error: e.message }, client_name: c.dados?.contratantes?.[0]?.nome }); } catch { /* log best-effort */ }
                reportErro('advbox-sync', e, { contractId: c.id });
              }
            }
          }

          // Google Drive — atomic lock com controle de retry robusto (v6.2.0)
          // Auto-recovery: libera lock 'uploading' se passou > 5min E ainda tem tentativas disponiveis.
          // Se ja esgotou tentativas, marca 'failed' e nao retenta.
          if (c.dados.linkGoogleDrive && c.drive_file_id === 'uploading') {
            const lockIdade = c.drive_last_attempt_at
              ? (Date.now() - new Date(c.drive_last_attempt_at).getTime())
              : Infinity;
            if (lockIdade > DRIVE_LOCK_TIMEOUT_MS) {
              // So libera se ainda tem tentativas disponiveis
              if ((c.drive_attempts || 0) < DRIVE_MAX_ATTEMPTS) {
                await supabase.from('contratos').update({ drive_file_id: null })
                  .eq('id', c.id).eq('drive_file_id', 'uploading');
                try {
                  await supabase.from('automation_log').insert({
                    contract_id: c.id,
                    action: 'drive',
                    status: 'lock_released',
                    details: { error: 'Lock orfao liberado apos 5min', attempts: c.drive_attempts || 0 },
                    client_name: c.dados?.contratantes?.[0]?.nome,
                  });
                } catch { /* log best-effort */ }
                c.drive_file_id = null; // refresh local state para tentar agora
              } else {
                // Ja bateu max attempts, marcar failed
                await supabase.from('contratos').update({
                  drive_file_id: 'failed',
                  drive_failed_reason: 'Max tentativas atingido (lock orfao repetido)',
                }).eq('id', c.id);
                try {
                  await supabase.from('automation_log').insert({
                    contract_id: c.id,
                    action: 'drive',
                    status: 'failed',
                    details: { error: 'Max tentativas atingido (lock orfao repetido)', attempts: c.drive_attempts || 0 },
                    client_name: c.dados?.contratantes?.[0]?.nome,
                  });
                } catch { /* log best-effort */ }
                continue; // pula para proximo contrato
              }
            }
          }

          // Auto-cura: 'failed' antigo (> 6h) volta a tentar. Cobre falhas
          // transitórias que esgotaram tentativas antes desta correção (chunk
          // velho pós-deploy, rede) — nunca fica preso para sempre.
          if (c.dados.linkGoogleDrive && c.drive_file_id === 'failed') {
            const idadeFalha = c.drive_last_attempt_at ? (Date.now() - new Date(c.drive_last_attempt_at).getTime()) : Infinity;
            if (idadeFalha > DRIVE_FAILED_RETRY_MS) {
              const { data: healed } = await supabase.from('contratos')
                .update({ drive_file_id: null, drive_attempts: 0 })
                .eq('id', c.id).eq('drive_file_id', 'failed').select('id');
              if (healed?.length) { c.drive_file_id = null; c.drive_attempts = 0; }
            }
          }

          // Condicoes para tentar upload:
          // 1. Tem link Google Drive
          // 2. drive_file_id eh null (nao foi feito nem esta em progresso)
          // 3. drive_attempts < MAX_ATTEMPTS
          // 4. Passou >= RETRY_INTERVAL desde ultima tentativa (ou nunca tentou)
          if (c.dados.linkGoogleDrive && !c.drive_file_id) {
            const attempts = c.drive_attempts || 0;
            if (attempts >= DRIVE_MAX_ATTEMPTS) {
              continue; // ja atingiu limite, nao tenta mais
            }
            const sinceLastAttempt = c.drive_last_attempt_at
              ? (Date.now() - new Date(c.drive_last_attempt_at).getTime())
              : Infinity;
            if (sinceLastAttempt < DRIVE_RETRY_INTERVAL_MS) {
              continue; // muito cedo para retentar
            }

            // Claim atomico: reserva a vaga antes de gastar recursos
            const { data: driveClaimed } = await supabase.from('contratos')
              .update({
                drive_file_id: 'uploading',
                drive_last_attempt_at: new Date().toISOString(),
                drive_attempts: attempts + 1,
              })
              .eq('id', c.id)
              .is('drive_file_id', null)
              .select('id');

            if (driveClaimed?.length > 0) {
              try {
                const { saveSignedDocToDrive } = await import('./utils/zapsignService');
                const d = c.dados;
                const driveResult = await saveSignedDocToDrive(
                  c.zapsign_doc_token, d.linkGoogleDrive,
                  d.contratantes?.[0]?.nome || 'cliente',
                  d.contratantes?.[1]?.nome || null,
                  d.resort === 'outro' ? d.resortCustom : d.resort,
                  c.pdf_page_split, d
                );
                // Sucesso: zera contador e limpa erros
                await supabase.from('contratos').update({
                  drive_file_id: driveResult.files?.[0]?.fileId || 'saved',
                  drive_file_link: driveResult.files?.[0]?.fileUrl || '',
                  drive_attempts: 0,
                  drive_last_error: null,
                  drive_error_code: null,
                  drive_failed_reason: null,
                }).eq('id', c.id);
                try {
                  await supabase.from('automation_log').insert({
                    contract_id: c.id,
                    action: 'drive',
                    status: 'ok',
                    details: { files: driveResult.files?.length, attempts: attempts + 1 },
                    client_name: d.contratantes?.[0]?.nome,
                  });
                } catch { /* log best-effort */ }
                console.log('Drive:', c.id, driveResult.files?.length, 'arquivo(s)');
              } catch (e) {
                const errCode = e?.code || 'GENERIC';
                const errMsg = e?.message || String(e);
                const isDeterministic = DRIVE_DETERMINISTIC_ERRORS.includes(errCode);
                // transitório (chunk velho pós-deploy, rede): não conta tentativa, não falha
                const transient = !isDeterministic && isTransientDriveError(errMsg);
                const newAttempts = attempts + 1;
                const shouldFail = !transient && (isDeterministic || newAttempts >= DRIVE_MAX_ATTEMPTS);
                await supabase.from('contratos').update({
                  drive_file_id: shouldFail ? 'failed' : null,
                  drive_attempts: transient ? attempts : newAttempts, // transitório devolve a tentativa
                  drive_last_error: errMsg.substring(0, 500),
                  drive_error_code: transient ? 'TRANSIENT' : errCode,
                  drive_failed_reason: shouldFail
                    ? (isDeterministic ? `Erro deterministico: ${errCode}` : `Max tentativas (${newAttempts}) atingido`)
                    : null,
                }).eq('id', c.id);
                try {
                  await supabase.from('automation_log').insert({
                    contract_id: c.id,
                    action: 'drive',
                    status: shouldFail ? 'failed' : 'error',
                    details: {
                      error: errMsg,
                      error_code: errCode,
                      attempts: newAttempts,
                      will_retry: !shouldFail,
                    },
                    // (bug-1) 'd' era const do bloco try -> indefinido aqui no catch,
                    // o que quebrava o log do erro de Drive (ReferenceError engolido).
                    client_name: c.dados?.contratantes?.[0]?.nome,
                  });
                } catch { /* log best-effort */ }
                reportErro('drive-upload', e, { contractId: c.id, errCode, errMsg });
              }
            }
          }
        }
      } catch (e) { reportErro('automation-poll', e); }
    }

    runAutomations();
    // 30s -> 120s (abr/2026): reduz audit spam ~4x sem perda perceptivel pra usuaria
    // (#225) Polling reduzido de 2min -> 5min: webhook ZapSign (zapsign-webhook.mjs)
    // ja atualiza status em tempo real; polling vira backup + drive/advbox.
    const interval = setInterval(runAutomations, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // (#230) Health check visual
  useEffect(() => {
    const checkHealth = async () => {
      // (perf 31/05) Pula o health-check quando a aba esta oculta — economiza
      // invocacoes da Function sem prejudicar nada (o ponto de saude so importa visivel).
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const start = Date.now();
        // (#126) Migrado para Edge Function /api/health com fallback
        // O timeout de 8s ja esta no callWithFallback dentro do API helper
        const r = await API.health();
        const elapsed = Date.now() - start;
        if (!r.ok) { setHealthStatus('error'); return; }
        const data = await r.json();
        const anyDown = data.services?.some(s => s.status === 'error');
        if (anyDown) setHealthStatus('error');
        else if (elapsed > 3000) setHealthStatus('slow');
        else setHealthStatus('ok');
      } catch { setHealthStatus('error'); }
    };
    checkHealth();
    // (custo-8) 5min em vez de 2min: a saude dos servicos raramente muda em 2min e
    // o indicador ja pausa com a aba oculta — corta ~60% das chamadas por usuario.
    const t = setInterval(checkHealth, HEALTH_CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  // Load user permissions
  useEffect(() => {
    if (!user?.email) return;
    supabase.from('user_permissions').select('tabs, is_admin, display_name').eq('email', user.email.toLowerCase()).single()
      .then(({ data }) => {
        if (data) setUserPerms(data);
        else {
          // Auto-create with defaults
          // (cleanup 20260418_152512) removidos: leads, integracoes, comissoes_socios
          supabase.from('user_permissions').insert({ email: user.email.toLowerCase(), display_name: user.email.split('@')[0], tabs: { novo: true, contratos: true, dashboard: true, asaas: false, boletos: false, monitor: false, admin: false, vendas: false, parametrizacao_vendas: false } }).then(() => {
            setUserPerms({ tabs: { novo: true, contratos: true, dashboard: true } });
          });
        }
      });
  }, [user?.email]);

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
      if (e.key === 'Escape') { if (focusMode) setFocusMode(false); if (showSearch) setShowSearch(false); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // (#17) Cmd+Z / Ctrl+Z — Desfazer ultima acao reversivel pendente.
      // Nao interfere em inputs de texto/contenteditable (permite undo nativo nas caixas de edicao).
      if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        const target = e.target;
        const tag = target?.tagName;
        const isEditable = target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA';
        if (!isEditable && undoCtrl.lastAction) {
          e.preventDefault();
          undoCtrl.undo();
          return;
        }
      }
      switch (e.key) {
        case 'k': e.preventDefault(); setShowSearch(s => !s); break;
        case 's': e.preventDefault(); handleSaveContract(); break;
        case 'Enter': e.preventDefault(); handlePreSendCheck(); break;
        case 'n': e.preventDefault(); setDestructiveConfirm({
          title: 'Limpar formulario?',
          message: 'Todos os dados preenchidos serao perdidos. Esta acao nao pode ser desfeita.',
          confirmText: 'LIMPAR',
          onConfirm: () => { resetAll(); setSavedContractId(null); setDestructiveConfirm(null); },
        }); break;
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
  }, [data, undoCtrl.lastAction, undoCtrl.undo, resetAll]);

  // (#vendas-fase6) Listener para evento cbc:switchTab (troca aba programaticamente)
  useEffect(() => {
    const handler = (e) => {
      const { tab } = e.detail || {};
      if (tab) setMainTab(tab);
    };
    window.addEventListener('cbc:switchTab', handler);
    return () => window.removeEventListener('cbc:switchTab', handler);
  }, []);

  // (#vendas-fase6) Listener para converter lead rapido em novo contrato.
  // VendasPanel dispara cbc:openNovoFromLead com { nome, telefone, kommoLink }.
  // Trocamos para aba 'novo' e repassamos via cbc:prefillNovoContract para o FormPanel.
  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail || {};
      setMainTab('novo');
      // Delay para garantir que o FormPanel esteja montado antes do prefill
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('cbc:prefillNovoContract', { detail }));
      }, 300);
    };
    window.addEventListener('cbc:openNovoFromLead', handler);
    return () => window.removeEventListener('cbc:openNovoFromLead', handler);
  }, []);

  const savingRef = useRef(false);
  const handleSaveContract = useCallback(async (extraFields = {}, forceMode = null) => {
    if (savingRef.current) return null; // Prevent duplicate submissions
    savingRef.current = true;
    setSaving(true); setSaveMsg('');
    const payload = { ...data, ...extraFields, user_email: user?.email || '' };
    try {
      const row = buildContratoRow(payload);
      let result;
      // (trava 17/07/2026) Contrato ja enviado/assinado NUNCA e sobrescrito pelo
      // formulario — vira contrato NOVO (caso Fernanda 16/07: 3 assinados viraram 1).
      // Rascunho com resort trocado: modal pergunta (salvar manual) ou vira novo
      // (fluxo de envio, onde o doc ZapSign ja foi criado e nao da p/ abortar).
      let saveMode = SAVE_MODES.UPDATE;
      if (savedContractId) {
        if (forceMode) {
          saveMode = forceMode;
        } else {
          const { data: atualDb } = await supabase.from('contratos')
            .select('status, resort').eq('id', savedContractId).maybeSingle();
          const resortNovo = payload.resort === 'outro' ? payload.resortCustom : payload.resort;
          saveMode = decideSaveMode({
            statusAtual: atualDb?.status,
            resortAtual: atualDb?.resort,
            resortNovo,
            fluxoEnvio: extraFields?.status === 'enviado_zapsign',
          });
          if (saveMode === SAVE_MODES.PERGUNTAR) {
            setSaveDecision({ resortAntes: atualDb?.resort, resortDepois: resortNovo, extraFields });
            return null; // nao salva ainda — o modal decide e rechama com forceMode
          }
        }
      }
      if (savedContractId && saveMode === SAVE_MODES.UPDATE) {
        // Update existing contract instead of creating duplicate
        const { created_by: _created_by, ...updateRow } = row;
        const { data: updated, error } = await supabase.from('contratos')
          .update({ ...updateRow, updated_at: new Date().toISOString() })
          .eq('id', savedContractId)
          .select().single();
        if (error) throw error;
        result = updated;
        setSaveMsg('Contrato atualizado!');
      } else {
        // First save OU trava anti-substituicao — insert new
        const eraTrava = !!savedContractId;
        const { data: inserted, error } = await supabase.from('contratos').insert(row).select().single();
        if (error) throw error;
        result = inserted;
        setSavedContractId(inserted.id);
        setSaveMsg(eraTrava
          ? 'Contrato NOVO criado — o anterior foi preservado (contratos sao unitarios por resort).'
          : 'Contrato salvo!');
        // (#23) Celebracoes contextuais — primeiro contrato do dia + novo resort
        try {
          celebrations.firstOfDay();
          const resortName = payload.resort === 'outro' ? payload.resortCustom : payload.resort;
          if (resortName) {
            // Verifica se este resort ja apareceu em outro contrato
            const { count } = await supabase
              .from('contratos')
              .select('id', { count: 'exact', head: true })
              .eq('resort', resortName)
              .neq('id', inserted.id);
            if ((count || 0) === 0) {
              celebrations.newResort(resortName);
            }
          }
        } catch { /* celebracoes nao podem falhar */ }
      }
      setLastSavedAt(new Date()); // (#32) track save time
      setTimeout(() => setSaveMsg(''), 3000);
      return result;
    } catch (err) {
      // (bug-10/ux-1) so trata como "offline" se estiver REALMENTE sem internet.
      // Online + banco recusou = erro real: mostra o motivo e NAO finge que salvou
      // (antes qualquer falha virava "Salvo offline" e o trabalho sumia numa fila do navegador).
      const semInternet = typeof navigator !== 'undefined' && navigator.onLine === false;
      const enviandoZap = extraFields?.status === 'enviado_zapsign';
      if (semInternet && !enviandoZap) {
        const q = getOfflineQueue(); q.push(payload); saveOfflineQueue(q);
        setSaveMsg('Sem internet — salvo offline, sincroniza quando a conexao voltar.');
        setTimeout(() => setSaveMsg(''), 6000);
        return null;
      }
      // (bug-2/ux-2) erro real. Se foi no fluxo de envio ao ZapSign, o documento JA
      // pode existir no ZapSign — avisa para NAO reenviar duplicado e conferir a lista.
      setSaveMsg(enviandoZap
        ? `ATENCAO: o ZapSign foi gerado mas NAO consegui registrar o contrato (${err.message || 'erro'}). Confira na lista de Contratos antes de reenviar.`
        : `Erro ao salvar: ${err.message || err}. Tente novamente.`);
      setTimeout(() => setSaveMsg(''), 9000);
      try { Sentry.captureException(err, { tags: { area: 'handleSaveContract' }, extra: { enviandoZap } }); } catch { /* sentry opcional */ }
      return null;
    } finally { setSaving(false); savingRef.current = false; }
  }, [data, user, savedContractId]);

  const handleLoadContract = useCallback((dados, contractId) => {
    const doLoad = () => {
      updateData(dados);
      if (contractId) setSavedContractId(contractId);
      setMainTab('novo');
    };
    // (ux-4) se ha um rascunho NOVO em andamento (ainda nao salvo) com conteudo,
    // confirma antes de sobrescrever — antes carregava por cima e o trabalho sumia sem aviso.
    const rascunhoNaoSalvo = !savedContractId && !!String(data?.contratantes?.[0]?.nome || '').trim();
    if (rascunhoNaoSalvo && contractId !== savedContractId) {
      setDestructiveConfirm({
        title: 'Substituir o cadastro em andamento?',
        message: 'Voce tem um contrato em preenchimento que ainda nao foi salvo. Carregar outro vai substituir o que esta na tela.',
        confirmText: 'SUBSTITUIR',
        onConfirm: () => { doLoad(); setDestructiveConfirm(null); },
      });
      return;
    }
    doLoad();
  }, [updateData, data, savedContractId]);

  const handlePreSendCheck = useCallback(() => {
    const issues = validateChecklist(data);
    setChecklistIssues(issues);
    setShowChecklist(true);
  }, [data]);

  const handlePdfPreview = useCallback(async () => {
    // (#97) Inicia progresso
    setPdfProgress({ phase: 'prepare', value: 0, label: 'Iniciando...' });
    try {
      const { generateFullPdfWithSplit } = await import('./utils/pdfGenerator');
      const contractHtml = generateContractHTML(data, true);
      const procuracaoHtml = generateProcuracaoHTML(data, true);
      const result = await generateFullPdfWithSplit(contractHtml, procuracaoHtml, {
        onProgress: (p) => setPdfProgress(p),
      });
      const url = URL.createObjectURL(result.blob);
      setPdfUrl(url);
      setShowPdfPreview(true);
    } catch (err) { setSaveMsg('Erro PDF: ' + err.message); setTimeout(() => setSaveMsg(''), 3000); }
    finally { setTimeout(() => setPdfProgress(null), 500); }
  }, [data]);

  const handlePdfSave = useCallback(async () => {
    setSaving(true); setSaveMsg('Gerando PDF...');
    setPdfProgress({ phase: 'prepare', value: 0, label: 'Iniciando...' });
    try {
      const { generateFullPdfWithSplit } = await import('./utils/pdfGenerator');
      const contractHtml = generateContractHTML(data, true);
      const procuracaoHtml = generateProcuracaoHTML(data, true);
      const result = await generateFullPdfWithSplit(contractHtml, procuracaoHtml, {
        onProgress: (p) => setPdfProgress(p),
      });
      const c1 = data.contratantes[0];
      const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
      const nomeFile = `Contrato_${(c1?.nome || 'cliente').replace(/\s+/g, '_')}_${(resort || 'resort').replace(/\s+/g, '_')}.pdf`;
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a'); a.href = url; a.download = nomeFile; a.click();
      URL.revokeObjectURL(url);
      // Save to DB
      await handleSaveContract();
      setSaveMsg('PDF salvo e contrato registrado!');
    } catch (err) { setSaveMsg('Erro: ' + err.message); }
    finally { setSaving(false); setTimeout(() => { setSaveMsg(''); setPdfProgress(null); }, 800); }
  }, [data, handleSaveContract]);

  const handleProcuracaoPdf = useCallback(async () => {
    setSaving(true); setSaveMsg('Gerando Procuracao...');
    setPdfProgress({ phase: 'prepare', value: 0, label: 'Iniciando...' });
    try {
      const { downloadPdf } = await import('./utils/pdfGenerator');
      const html = generateProcuracaoHTML(data, false);
      const c1 = data.contratantes[0];
      const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
      const nomeFile = `Procuracao_${(c1?.nome || 'cliente').replace(/\s+/g, '_')}_${(resort || 'resort').replace(/\s+/g, '_')}.pdf`;
      // Usa generatePdfFromHtml internamente via downloadPdf; passamos onProgress para downloadPdf
      await downloadPdf(html, nomeFile, { onProgress: (p) => setPdfProgress(p) });
      setSaveMsg('Procuracao gerada!');
    } catch (err) { setSaveMsg('Erro: ' + err.message); }
    finally { setSaving(false); setTimeout(() => { setSaveMsg(''); setPdfProgress(null); }, 800); }
  }, [data]);

  const offlineCount = getOfflineQueue().length;
  // Theme-aware colors via CSS vars (adapts to light/dark)
  const bg = dark ? '#0A0F1A' : '#F0F4F8';
  const headerBg = dark ? '#0A0F1A' : '#1B3A5C';
  const tabBg = dark ? '#111827' : '#0F2035';

  // (mobile 06/2026) Dock visível = phone OU tablet em portrait (mesma condição
  // de sempre, agora centralizada). Quando true, top tabs somem e o layout
  // ganha um spacer no rodapé para o conteúdo não terminar sob o dock.
  const dockVisible = isMobile || (device.isTablet && device.isPortrait);
  // (mobile-13) com um modal aberto, o dock aparecia nas bordas atras dele (poluicao
  // visual + toque acidental). Esconde o dock enquanto houver modal de tela cheia.
  const anyModalOpen = showZapSign || showSearch || showChangeLog || showChecklist ||
    showShortcuts || showNotifPrefs || showPdfPreview || !!destructiveConfirm || !!saveDecision;

  // (ux-11) ao SAIR da aba Novo com um rascunho ainda nao salvo no banco, avisa de
  // forma discreta (nao bloqueia) que o trabalho so esta neste navegador.
  const prevTabRef = useRef(mainTab);
  useEffect(() => {
    const prev = prevTabRef.current;
    prevTabRef.current = mainTab;
    if (prev === 'novo' && mainTab !== 'novo' && !savedContractId && String(data?.contratantes?.[0]?.nome || '').trim()) {
      setSaveMsg('Rascunho ainda nao salvo no servidor (so neste navegador). Clique em Salvar para registrar.');
      setTimeout(() => setSaveMsg(''), 6000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  // (mobile 06/2026) Mesmo filtro de permissão das top tabs, reutilizado pelo
  // sheet de navegação — mantém as duas navegações sempre em sincronia.
  const tabAllowed = (tab) => {
    if (tab === 'socios') return SOCIOS_EMAILS.includes((user?.email || '').toLowerCase());
    // (#17) "Saúde do Funil" — mesmo gating dos Sócios (so Paulo e Bruno).
    if (tab === 'funil') return SOCIOS_EMAILS.includes((user?.email || '').toLowerCase());
    // (#L19) is_admin SEMPRE mantem a aba Admin — evita auto-lockout caso o flag tabs.admin
    // seja desmarcado por engano (o checkbox da propria linha do admin era editavel).
    if (tab === 'admin' && userPerms?.is_admin) return true;
    if (!userPerms?.tabs) return ['novo', 'contratos', 'dashboard'].includes(tab);
    return userPerms.tabs[tab];
  };
  const allowedTabKeys = ['novo', 'contratos', 'clientes', 'vendas', 'dashboard', 'socios', 'funil', 'trafego', 'asaas', 'boletos', 'bot', 'portal', 'monitor', 'admin', 'parametrizacao_vendas'].filter(tabAllowed);

  // Auth loading
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: dark ? '#0A0F1A' : '#1B3A5C' }}>
        <div className="text-white text-sm font-bold uppercase tracking-wide animate-pulse">Carregando...</div>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return <LoginScreen onLogin={login} onGoogleLogin={loginWithGoogle} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: bg }}>
      {/* Login Anomaly Warning Banner */}
      {loginWarnings?.length > 0 && (
        <div className="shrink-0 px-4 py-2 flex items-center justify-between gap-3" style={{ background: '#FEF2F2', borderBottom: '2px solid #DC2626' }}>
          <div className="flex items-center gap-2 min-w-0">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600 shrink-0" aria-hidden="true" />
            <div className="text-[11px] font-bold text-red-800">
              {loginWarnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          </div>
          <button onClick={dismissWarnings} className="text-red-500 hover:text-red-700 text-xs font-bold cursor-pointer shrink-0 px-2 py-1 rounded hover:bg-red-100">
            Entendi
          </button>
        </div>
      )}
      {/* (resilience 28/04) Banner global de degradacao Supabase. Disparado por
          safeQuery (utils/supabaseSafe.js) ou fallback de cache em ContratosTab.
          Auto-hide em 30s, dismissable. */}
      {supabaseDegraded && (
        <div className="shrink-0 px-4 py-2 flex items-center gap-2 text-sm border-b-2 border-amber-400 bg-amber-100 dark:bg-amber-900/30 dark:border-amber-700">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0" aria-hidden="true" />
          <span className="text-amber-800 dark:text-amber-200 min-w-0 truncate">
            Conectividade lenta — {supabaseDegraded.msg}
          </span>
          <button
            onClick={() => setSupabaseDegraded(null)}
            className="ml-auto text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 font-bold text-xs uppercase px-2 py-1 rounded hover:bg-amber-200/60 dark:hover:bg-amber-800/40 cursor-pointer shrink-0"
          >
            Fechar
          </button>
        </div>
      )}
      {/* Header */}
      <header style={{ background: headerBg, paddingTop: 'env(safe-area-inset-top, 0)' }} className="text-white shrink-0">
        <div className="px-3 md:px-6 py-2 md:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* (#118) WebP com fallback PNG — reduz ~40% vs PNG */}
            <picture>
              <source srcSet="/logo-white.webp" type="image/webp" />
              <img src="/logo-white.png" alt="CBC" className="w-8 h-8 md:w-10 md:h-10 shrink-0" width="40" height="40" />
            </picture>
            <div className="min-w-0">
              <div className="text-[11px] md:text-[13px] font-bold uppercase tracking-[1px] md:tracking-[1.5px] truncate">
                {isMobile ? 'CBC Advogados' : 'Conforto, Bergonsi & Cavalari Advogados'}
              </div>
              <div className="text-[10px] md:text-[11px] opacity-70 tracking-wide">
                OAB/SP n 55227 — Americana - SP
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!isOnline && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/30 text-red-200 font-bold uppercase">
                Offline{offlineCount > 0 && ` (${offlineCount})`}
              </span>
            )}
            {saveMsg && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full max-md:inline-block max-md:max-w-[36vw] max-md:truncate max-md:align-middle ${saveMsg.startsWith('Erro') ? 'bg-red-500/30' : 'bg-green-500/30'}`}>{saveMsg}</span>
            )}
            {/* (mobile 06/2026) Busca global em touch — Cmd+K não existe sem teclado */}
            {device.isTouchDevice && (
              <button
                onClick={() => setShowSearch(true)}
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
                title="Buscar contratos"
                aria-label="Buscar contratos"
              >
                <MagnifyingGlassIcon className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            {/* (#93) Feed de atividade global */}
            {user?.email && <ActivityFeed />}
            {/* (#205) Centro de notificacoes (DB-backed) */}
            {user?.email && (
              <NotificationCenter userEmail={user.email} onOpenPrefs={() => setShowNotifPrefs(true)} />
            )}
            {/* Dark mode toggle */}
            <button onClick={toggleDark} className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors" title={dark ? 'Modo claro (Ctrl+D)' : 'Modo escuro (Ctrl+D)'} aria-label="Alternar modo escuro">
              {dark ? (
                /* Sun icon — shown in dark mode to toggle to light */
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                /* Moon icon — shown in light mode to toggle to dark */
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>
            {/* Density selector — (mobile 06/2026) oculto no phone: header lotado;
                densidade segue acessível no desktop/tablet landscape */}
            {!isMobile && (
            <div className="relative">
              <button
                onClick={() => setShowDensityMenu(s => !s)}
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
                title={`Densidade: ${density === 'compact' ? 'Compacto' : density === 'spacious' ? 'Espacoso' : 'Confortavel'}`}
                aria-label="Ajustar densidade"
                aria-haspopup="true"
                aria-expanded={showDensityMenu}
              >
                {/* Density icon — horizontal lines stack (tightness varies) */}
                {density === 'compact' ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                ) : density === 'spacious' ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 18h16" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                )}
              </button>
              {showDensityMenu && (
                <>
                  {/* Backdrop to close on outside click */}
                  <div className="fixed inset-0 z-30" onClick={() => setShowDensityMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-40 rounded-lg shadow-xl py-1 z-40 overflow-hidden"
                    style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}>
                    <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider opacity-60">Densidade</div>
                    {[
                      { key: 'compact', label: 'Compacto', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16', mobileOk: true },
                      { key: 'comfortable', label: 'Confortavel', icon: 'M4 6h16M4 12h16M4 18h16', mobileOk: true },
                      { key: 'spacious', label: 'Espacoso', icon: 'M4 6h16M4 18h16', mobileOk: false },
                    ].filter(o => !isMobile || o.mobileOk).map(o => (
                      <button key={o.key}
                        onClick={() => { setDensity(o.key); setShowDensityMenu(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-colors text-left ${density === o.key ? 'font-bold' : ''}`}
                        style={{ background: density === o.key ? 'var(--cbc-bg-elevated)' : 'transparent' }}
                      >
                        <svg className="w-3.5 h-3.5 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={o.icon} />
                        </svg>
                        <span className="flex-1">{o.label}</span>
                        {density === o.key && (
                          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            )}
            {/* New version notification banner + versão + atalhos —
                (mobile 06/2026) ocultos no phone (migram pro sheet "Mais") */}
            {!isMobile && (
              <>
                <NewVersionBanner onClick={() => setShowChangeLog(true)} />
                {/* Version / Changelog */}
                <button onClick={() => setShowChangeLog(true)} className="px-2 py-1 rounded-lg hover:bg-white/10 cursor-pointer transition-colors flex items-center gap-1"
                  title={`Historico de versoes — build ${typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev'} (${typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''})`}>
                  <span className="text-[9px] font-bold opacity-70">v{VERSIONS[0]?.version}</span>
                </button>
                {/* Shortcuts guide — atalhos de teclado não existem em touch puro */}
                <button onClick={() => setShowShortcuts(true)} className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors" title="Atalhos (Ctrl+/)" aria-label="Atalhos de teclado">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </button>
              </>
            )}
            {/* User info + logout */}
            {user && (
              <>
                {/* (#32) Autosave indicator */}
                {lastSavedAt && mainTab === 'novo' && (
                  <AutosaveIndicator savedAt={lastSavedAt} />
                )}
                {/* (#4) Breadcrumb */}
                <div className="hidden md:flex items-center gap-1 text-[9px] text-white/40 font-bold uppercase tracking-wider">
                  <span>CBC</span>
                  <span>/</span>
                  <span className="text-white/70">{
                    mainTab === 'novo' ? 'Novo Contrato' :
                    mainTab === 'contratos' ? 'Contratos Salvos' :
                    mainTab === 'clientes' ? 'Clientes' :
                    mainTab === 'dashboard' ? 'Dashboard' :
                    mainTab === 'asaas' ? 'Asaas' :
                    mainTab === 'boletos' ? 'Boletos' :
                    mainTab === 'monitor' ? 'Monitor' :
                    mainTab === 'admin' ? 'Admin' :
                    mainTab === 'socios' ? 'Dashboard Socios' :
                    mainTab === 'funil' ? 'Saúde do Funil' :
                    mainTab === 'trafego' ? 'Tráfego' :
                    mainTab === 'vendas' ? 'Minhas Vendas' :
                    mainTab === 'parametrizacao_vendas' ? 'Parametrizacao Vendas' :
                    mainTab === 'bot' ? 'Bot ADVBOX' :
                    mainTab === 'portal' ? 'Portal do Cliente' : mainTab
                  }</span>
                </div>
                {/* (#230) Health indicator */}
                <div className="cbc-tooltip hidden md:flex items-center" data-tooltip={healthStatus === 'ok' ? 'Todos os servicos online' : healthStatus === 'slow' ? 'Servicos lentos' : 'Servico offline'}>
                  <span className={`w-2 h-2 rounded-full ${healthStatus === 'ok' ? 'bg-green-400' : healthStatus === 'slow' ? 'bg-yellow-400' : 'bg-red-400'}`}
                    style={{ boxShadow: healthStatus === 'ok' ? '0 0 6px #22C55E' : healthStatus === 'slow' ? '0 0 6px #EAB308' : '0 0 6px #EF4444' }} />
                </div>
                <span className="text-[10px] font-bold opacity-80 hidden md:inline">{user.name}</span>
                <button onClick={logout} className="touch-target p-2.5 rounded-lg hover:bg-white/10 active:bg-white/20 cursor-pointer transition-colors opacity-70 hover:opacity-100" title="Sair" aria-label="Sair do sistema">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Tabs — hidden em mobile small + tablet portrait (substituido por dock flutuante) */}
      {!dockVisible && (
        <div style={{ background: tabBg }} className="cbc-toptabs flex shrink-0 overflow-x-auto scrollbar-hide">
          {/* (cleanup 20260418_152512) removidos: leads, integracoes, comissoes_socios */}
          {/* (mobile 06/2026) filtro extraído p/ tabAllowed — compartilhado com o sheet mobile */}
          {allowedTabKeys.map((tab, idx) => {
            const TabIcon = TAB_ICONS[tab];
            // (nav 26/06) separador sutil entre grupos logicos (Criar | Analise | Financeiro |
            // Integracoes | Gestao) — quebra a lista plana de 12 abas sem mudar ordem/comportamento.
            const groupStart = idx > 0 && ['dashboard', 'asaas', 'bot', 'admin'].includes(tab);
            const label = tab === 'novo' ? 'Novo Contrato'
              : tab === 'contratos' ? 'Contratos Salvos'
              : tab === 'clientes' ? 'Clientes'
              : tab === 'asaas' ? 'Asaas'
              : tab === 'boletos' ? 'Boletos'
              : tab === 'monitor' ? 'Monitor'
              : tab === 'admin' ? 'Admin'
              : tab === 'socios' ? 'Socios'
              : tab === 'funil' ? 'Saúde do Funil'
              : tab === 'trafego' ? 'Tráfego'
              : tab === 'vendas' ? 'Minhas Vendas'
              : tab === 'parametrizacao_vendas' ? 'Param. Vendas'
              : tab === 'bot' ? 'Bot ADVBOX'
              : tab === 'portal' ? 'Portal Cliente'
              : 'Dashboard';
            return (
              <React.Fragment key={tab}>
                {groupStart && <span aria-hidden="true" className="self-stretch my-2 w-px shrink-0 bg-white/15" />}
              <button onClick={() => setMainTab(tab)}
                onMouseEnter={() => prefetchTab(tab)} onFocus={() => prefetchTab(tab)}
                className={`flex-1 min-w-[110px] py-3 md:py-3.5 text-[12px] font-bold uppercase tracking-[1px] cursor-pointer transition-all flex items-center justify-center gap-2 relative ${mainTab === tab ? 'text-white' : 'text-white/55 hover:text-white/90 active:text-white'}`}
                aria-current={mainTab === tab ? 'page' : undefined}>
                {TabIcon && <TabIcon className="w-4 h-4" aria-hidden="true" />}
                <span>{label}</span>
                {tab === 'portal' && portalPendentes > 0 && (
                  <span title={`${portalPendentes} dúvida(s) sem resposta`}
                    className="min-w-[17px] h-[17px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold inline-flex items-center justify-center">
                    {portalPendentes > 99 ? '99+' : portalPendentes}
                  </span>
                )}
                {mainTab === tab && (
                  <span aria-hidden="true" className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[3px] rounded-full" style={{ background: 'var(--cbc-gold)', boxShadow: '0 0 12px var(--cbc-gold)' }} />
                )}
              </button>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Notification bar */}
      {notifications.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 text-[10px] font-bold text-white flex items-center justify-between" style={{ background: '#16A34A' }}>
          <span>{notifications[0].message}</span>
          <button onClick={() => setNotifications([])} className="text-white/80 hover:text-white cursor-pointer">&times;</button>
        </div>
      )}

      {/* (#16) Celebration banner */}
      {celebrationName && (
        <div className="celebration-banner shrink-0 px-4 py-2.5 text-center text-white font-bold text-sm tracking-wide z-50 shadow-lg">
          PRA CIMA CBC! {celebrationName} assinou o contrato!
        </div>
      )}

      {mainTab === 'novo' ? (
        dockVisible ? (
          /* (mobile 06/2026) Branch mobile agora cobre TAMBÉM iPad portrait —
             antes caía no layout desktop espremido (form 480px + preview) */
          <div className="flex-1 flex flex-col overflow-hidden tab-fade-enter" key="novo">
            {/* (iPad 2026-06) Segmented control glass — substitui tabs flat */}
            <div className="shrink-0 px-3 pt-3 pb-2 bg-white border-b border-gray-100 dark:bg-gray-900">
              <div className="flex p-1 rounded-xl bg-gray-100 dark:bg-gray-800" role="tablist" aria-label="Visualizacao do contrato">
                {[{ key: 'form', label: 'Formulario' }, { key: 'contrato', label: 'Contrato' }, { key: 'procuracao', label: 'Procuracao' }].map(t => {
                  const isActive = (t.key === 'form' && mobileView === 'form') || (mobileView === 'preview' && previewTab === t.key);
                  return (
                    <button key={t.key} type="button" role="tab" aria-selected={isActive}
                      onClick={() => { setMobileView(t.key === 'form' ? 'form' : 'preview'); if (t.key !== 'form') setPreviewTab(t.key); }}
                      className={`flex-1 min-h-[40px] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.5px] cursor-pointer transition-all rounded-lg ${isActive ? 'text-white shadow-md' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                      style={isActive ? { background: headerBg } : {}}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* (mobile 06/2026) FormPanel permanece MONTADO ao alternar para o
                  preview (display:none) — antes desmontava e perdia OCR em
                  andamento + estado das seções */}
              <div className={`bg-white overflow-x-hidden ${mobileView === 'form' ? '' : 'hidden'}`}>
                <FormPanel onSave={() => handleSaveContract()} onSendZapSign={handlePreSendCheck} onPdfPreview={handlePdfPreview} onPdfSave={handlePdfSave} onProcuracaoPdf={handleProcuracaoPdf} saving={saving} onClear={() => setSavedContractId(null)} loadedContractId={savedContractId} currentUserEmail={user?.email} />
              </div>
              {mobileView !== 'form' && (
                <div className="p-3 h-full" style={{ background: bg }}><LivePreview tab={previewTab} /></div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden relative tab-fade-enter" key="novo-desktop">
            {/* (iPad 2026-06) Form panel — largura adaptativa por device.
                Mobile: 100%, iPad portrait: 100%, iPad landscape: 540px, desktop: 480px. */}
            <div className={`overflow-y-auto bg-white border-r border-gray-200 transition-all duration-300 ${
              focusMode ? 'w-full max-w-[800px] mx-auto border-r-0'
              : device.isTablet && device.isLandscape ? 'w-[540px] min-w-[500px]'
              : 'w-[480px] min-w-[420px]'
            }`}>
              <FormPanel onSave={() => handleSaveContract()} onSendZapSign={handlePreSendCheck} onPdfPreview={handlePdfPreview} onPdfSave={handlePdfSave} onProcuracaoPdf={handleProcuracaoPdf} saving={saving} onClear={() => setSavedContractId(null)} loadedContractId={savedContractId} currentUserEmail={user?.email} />
            </div>

            {/* Preview panel — hidden in focus mode */}
            {!focusMode && (
              <div className="flex-1 flex flex-col overflow-hidden" style={{ background: bg }}>
                <div className="flex shrink-0 bg-white border-b border-gray-200">
                  {['contrato', 'procuracao'].map(tab => (
                    <button key={tab} onClick={() => setPreviewTab(tab)}
                      className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wide transition-all cursor-pointer ${previewTab === tab ? 'text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                      style={previewTab === tab ? { background: headerBg } : {}}>
                      {tab === 'contrato' ? 'Contrato' : 'Procuracao Ad Judicia'}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto p-4"><LivePreview tab={previewTab} /></div>
              </div>
            )}

            {/* Focus mode toggle */}
            <button
              onClick={() => setFocusMode(f => !f)}
              className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all shadow-lg hover:scale-110"
              style={{ background: focusMode ? '#C8973A' : '#1A2E52', color: 'white' }}
              title={focusMode ? 'Mostrar preview (Esc)' : 'Modo foco — esconder preview'}
              aria-label={focusMode ? 'Mostrar pré-visualização' : 'Modo foco — esconder pré-visualização'}
            >
              {focusMode ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              )}
            </button>
          </div>
        )
      ) : mainTab === 'contratos' ? (
        <TabScrollContainer key={`tab-${mainTab}`} tabKey="contratos" className="flex-1 overflow-hidden bg-white page-enter"><Suspense fallback={<SkeletonContratosTab />}><ContratosTab onLoadContract={handleLoadContract} onRequestDestructiveConfirm={setDestructiveConfirm} onRegisterUndo={undoCtrl.register} /></Suspense></TabScrollContainer>
      ) : mainTab === 'clientes' && tabAllowed('clientes') ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonContratosTab />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="clientes" className="flex-1 overflow-hidden page-enter"><ClientesTab isAdmin={!!userPerms?.is_admin} /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'vendas' && userPerms?.tabs?.vendas ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonDashboard />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="vendas" className="flex-1 overflow-hidden page-enter"><div className="page-enter" key="tab-vendas"><VendasPanel /></div></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'parametrizacao_vendas' && userPerms?.tabs?.parametrizacao_vendas ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonAdmin />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="parametrizacao_vendas" className="flex-1 overflow-hidden bg-white page-enter"><div className="page-enter" key="tab-parametrizacao-vendas"><VendasParametrizacaoPanel /></div></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'trafego' && userPerms?.tabs?.trafego ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonDashboard />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="trafego" className="flex-1 overflow-hidden page-enter"><TrafegoPanel /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'asaas' && userPerms?.tabs?.asaas ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonAsaas />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="asaas" className="flex-1 overflow-hidden bg-white page-enter"><AsaasPanel /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'boletos' && userPerms?.tabs?.boletos ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonBoletos />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="boletos" className="flex-1 overflow-hidden bg-white page-enter"><BoletosPanel userEmail={user?.email || ''} /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'bot' && userPerms?.tabs?.bot ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonIntegracoes />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="bot" className="flex-1 overflow-hidden bg-white page-enter"><BotAdvboxPanel /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'portal' && userPerms?.tabs?.portal ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonIntegracoes />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="portal" className="flex-1 overflow-hidden bg-white page-enter"><PortalClientePanel /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'monitor' && userPerms?.tabs?.monitor ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonMonitor />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="monitor" className="flex-1 overflow-hidden bg-gray-50 page-enter"><MonitorPanel /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'admin' && tabAllowed('admin') ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonAdmin />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="admin" className="flex-1 overflow-hidden bg-white page-enter"><AdminPanel /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'socios' && SOCIOS_EMAILS.includes((user?.email || '').toLowerCase()) ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonDashboard />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="socios" className="flex-1 overflow-hidden page-enter"><SociosDashboard /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : mainTab === 'funil' && SOCIOS_EMAILS.includes((user?.email || '').toLowerCase()) ? (
        <Suspense fallback={<TabFallback skeleton={<SkeletonDashboard />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="funil" className="flex-1 overflow-hidden page-enter"><FunnelHealthPanel /></TabScrollContainer></ErrorBoundary></Suspense>
      ) : (
        <Suspense fallback={<TabFallback skeleton={<SkeletonDashboard />} />}><ErrorBoundary><TabScrollContainer key={`tab-${mainTab}`} tabKey="dashboard" className="flex-1 overflow-hidden page-enter" style={{ background: bg }}><Dashboard /></TabScrollContainer></ErrorBoundary></Suspense>
      )}

      {/* (mobile 06/2026) Spacer: devolve a altura do dock fixo ao layout —
          o conteúdo das abas deixa de terminar escondido sob o dock.
          Só renderiza quando o dock está visível (zero efeito em desktop). */}
      {dockVisible && <div className="dock-spacer" aria-hidden="true" />}

      {/* Modals */}
      {showZapSign && <ZapSignModal onClose={() => setShowZapSign(false)} onSaveAfterSend={async (z) => {
        const saved = await handleSaveContract({ status: 'enviado_zapsign', zapsign_doc_token: z?.token, zapsign_links: z?.signers, pdf_page_split: z?.pageSplit });
        // (assinatura 02/07/2026) disparo automatico do link via Kommo/WhatsApp, SO dentro
        // da janela de 24h da Meta; fora dela a function posta nota no lead e a faixa M2
        // (ContratosTab) avisa a equipe p/ enviar manualmente. Sem re-tentativa automatica.
        // Fire-and-forget: function idempotente (lock em kommo_assinatura) + kill-switch
        // em bot_config.kommo.assinatura.ativo.
        if (saved?.id) {
          fetch('/.netlify/functions/kommo-assinatura-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-bot-key': import.meta.env.VITE_BOT_PANEL_KEY || '' },
            body: JSON.stringify({ contratoId: saved.id }),
            keepalive: true,
          }).catch(() => {});
        }
        setSaveMsg('Contrato enviado para ZapSign. Dentro da janela de 24h o link segue automático pelo WhatsApp — confira a faixa no contrato.');
      }} />}
      {/* Global Search (Cmd+K) */}
      {showSearch && <Suspense fallback={null}><GlobalSearch onClose={() => setShowSearch(false)} onSelectContract={(c) => {
        // (ux-6) abre o contrato escolhido na busca (antes so trocava de aba e a pessoa
        // tinha que procurar de novo). Reusa o evento global cbc:openContract da ContratosTab;
        // delay p/ a aba (lazy) montar e registrar o listener.
        setMainTab('contratos');
        if (c?.id) setTimeout(() => window.dispatchEvent(new CustomEvent('cbc:openContract', { detail: { id: c.id } })), 400);
      }} /></Suspense>}

      {/* Floating Quick Create Button (#232) —
          (mobile 06/2026) oculto quando o dock está visível (redundante com o
          item "Novo" e colidia com o dock); ganha safe-area no tablet landscape */}
      {mainTab !== 'novo' && !dockVisible && (
        <button onClick={() => { resetAll(); setSavedContractId(null); setMainTab('novo'); }}
          className="cbc-fab fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white text-2xl cursor-pointer transition-all hover:scale-110 z-40"
          style={{ background: 'linear-gradient(135deg, #1A2E52, #2D5A8C)' }}
          title="Novo contrato (Cmd+N)">
          +
        </button>
      )}

      {showShortcuts && <ShortcutsGuide onClose={() => setShowShortcuts(false)} />}
      {showChangeLog && <ChangeLog onClose={() => setShowChangeLog(false)} />}
      {showChecklist && <PreSendChecklist issues={checklistIssues} onClose={() => setShowChecklist(false)} onProceed={() => { setShowChecklist(false); setShowZapSign(true); }} />}

      {/* (#97) Toast flutuante com progresso de geracao de PDF */}
      {pdfProgress && (
        <div className='fixed bottom-6 right-6 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80 max-w-[calc(100vw-3rem)]'
          role='status' aria-live='polite'>
          <div className='flex items-center gap-2 mb-2'>
            <svg className='w-4 h-4 animate-spin text-blue-600' fill='none' viewBox='0 0 24 24' aria-hidden='true'>
              <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4'/>
              <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'/>
            </svg>
            <span className='text-xs font-bold uppercase tracking-wide text-gray-700'>Gerando PDF</span>
          </div>
          <ProgressBar
            value={pdfProgress.value || 0}
            label={pdfProgress.label || 'Processando...'}
            color='#1B3A5C'
            size='sm'
          />
        </div>
      )}

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

      {/* (#17) Toast de desfazer — flutuante bottom-right */}
      <UndoToast
        lastAction={undoCtrl.lastAction}
        expiresAt={undoCtrl.expiresAt}
        onUndo={async () => {
          const ok = await undoCtrl.undo();
          setSaveMsg(ok ? 'Acao desfeita.' : 'Nao foi possivel desfazer.');
          setTimeout(() => setSaveMsg(''), 2500);
        }}
        onDismiss={undoCtrl.clear}
      />

      {/* (#16) Modal de confirmacao destrutiva global */}
      <ConfirmDestructive
        isOpen={!!destructiveConfirm}
        title={destructiveConfirm?.title}
        message={destructiveConfirm?.message}
        confirmText={destructiveConfirm?.confirmText || 'DELETAR'}
        confirmLabel={destructiveConfirm?.confirmLabel}
        onConfirm={destructiveConfirm?.onConfirm}
        onCancel={() => setDestructiveConfirm(null)}
      />

      {/* (trava 17/07/2026) Rascunho com resort trocado: criar novo vs corrigir */}
      <SaveDecisionModal
        isOpen={!!saveDecision}
        resortAntes={saveDecision?.resortAntes}
        resortDepois={saveDecision?.resortDepois}
        onCriarNovo={() => { const ef = saveDecision?.extraFields || {}; setSaveDecision(null); handleSaveContract(ef, SAVE_MODES.INSERT_NOVO); }}
        onCorrigir={() => { const ef = saveDecision?.extraFields || {}; setSaveDecision(null); handleSaveContract(ef, SAVE_MODES.UPDATE); }}
        onCancel={() => setSaveDecision(null)}
      />

      {/* (#205) Modal de preferencias de notificacao */}
      {showNotifPrefs && user?.email && (
        <NotificationPrefsModal userEmail={user.email} onClose={() => setShowNotifPrefs(false)} />
      )}

      {/* (iPad 2026-06) Bottom Dock — glass floating em mobile/portrait.
          Aparece como pill flutuante centralizado, fora do flow do layout,
          respeita safe-area do home indicator. Tap pra trocar aba. */}
      {dockVisible && !anyModalOpen && (
        <nav className="dock-floating safe-bottom" aria-label="Navegacao principal">
          {[
            { key: 'novo', label: 'Novo', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> },
            { key: 'contratos', label: 'Salvos', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
            { key: 'dashboard', label: 'Dashboard', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
          ].map(t => (
            <button key={t.key}
              type="button"
              onClick={() => setMainTab(t.key)}
              onMouseEnter={() => prefetchTab(t.key)} onFocus={() => prefetchTab(t.key)}
              className={`dock-floating-item ${mainTab === t.key ? 'is-active' : ''}`}
              aria-current={mainTab === t.key ? 'page' : undefined}
              aria-label={t.label}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
          {/* (mobile 06/2026) 4º item "Mais" — destrava as 9 abas que eram
              inacessíveis no iPhone/iPad portrait (Boletos, Monitor, Admin…) */}
          <button
            type="button"
            onClick={() => setShowNavSheet(true)}
            className={`dock-floating-item ${!['novo', 'contratos', 'dashboard'].includes(mainTab) ? 'is-active' : ''}`}
            aria-label="Mais abas"
            aria-haspopup="dialog"
            aria-expanded={showNavSheet}
          >
            <Squares2X2Icon className="w-5 h-5" aria-hidden="true" />
            <span>Mais</span>
          </button>
        </nav>
      )}

      {/* (mobile 06/2026) Sheet de navegação com todas as abas permitidas */}
      {showNavSheet && dockVisible && (
        <MobileNavSheet
          tabs={allowedTabKeys.map(k => ({ key: k, label: MOBILE_TAB_LABELS[k] || k, Icon: TAB_ICONS[k] }))}
          activeTab={mainTab}
          onSelect={setMainTab}
          onClose={() => setShowNavSheet(false)}
          onOpenSearch={() => setShowSearch(true)}
          onOpenChangeLog={() => setShowChangeLog(true)}
          version={VERSIONS[0]?.version}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ContractProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </ContractProvider>
    </AuthProvider>
  );
}
