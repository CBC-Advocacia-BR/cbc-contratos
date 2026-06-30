// ═══════════════════════════════════════════════════════════════════════
// VendasPanel — painel "Minhas Vendas" para vendedora/assistente
// ═══════════════════════════════════════════════════════════════════════
// Filtra contratos do proprio usuario (via perfil_vendas em user_permissions)
// - perfil_vendas = 'vendedora'  -> contratos onde vendedora_email = user.email
// - perfil_vendas = 'assistente' -> contratos da parceira (vendedora_parceira_email)
//
// Duas views:
// 1) Planilha: tabela editavel tipo Excel (inline editing)
// 2) Kanban: 7 colunas ordenadas conforme pipeline ADVBOX
//
// Recursos:
// - Barra de comissao prevista do mes
// - Drawer lateral ao clicar em contrato
// - Novo Lead card (ficha rapida / gerar contrato / importar existente)
// - Export Excel com colunas da planilha
// ═══════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { usePersistedFilter } from '../hooks/usePersistedFilters';
import { useDebounce } from '../hooks/useDebounce';
import ErrorState from './ErrorState';
import ConfirmDestructive from './ConfirmDestructive';
import { SkeletonDashboard } from './Skeleton';
import {
  TableCellsIcon,
  ViewColumnsIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  PlusIcon,
  XMarkIcon,
  CheckCircleIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  DocumentArrowUpIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
  CurrencyDollarIcon,
  ArrowPathIcon,
  UserPlusIcon,
  BuildingOfficeIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';

// ───────────────────────────────────────────────────────────────────────
// CONSTANTES E HELPERS
// ───────────────────────────────────────────────────────────────────────

// Colunas do kanban na ordem do pipeline
const KANBAN_COLS = [
  { key: 'novo_lead',              label: 'Novo Lead',                    emoji: 'NEW',   color: '#FCE7F3', borderColor: '#F9A8D4', textColor: '#9D174D' },
  { key: 'aguardando_assinatura',  label: 'Aguardando assinatura',        emoji: 'SIGN',  color: '#FEF3C7', borderColor: '#FCD34D', textColor: '#92400E' },
  { key: 'aguardando_documentos',  label: 'Aguardando documentos',        emoji: 'DOCS',  color: '#FED7AA', borderColor: '#FB923C', textColor: '#9A3412' },
  { key: 'enviado_operacional',    label: 'Enviado Operacional',          emoji: 'OP',    color: '#DBEAFE', borderColor: '#60A5FA', textColor: '#1E3A8A' },
  { key: 'distribuido',            label: 'Distribuido',                  emoji: 'DIST',  color: '#BFDBFE', borderColor: '#3B82F6', textColor: '#1E40AF' },
  { key: 'aguardando_guia',        label: 'Aguardando guia',              emoji: 'GUIA',  color: '#E9D5FF', borderColor: '#A78BFA', textColor: '#6B21A8' },
  { key: 'guia_juntada',           label: 'Guia Juntada',                 emoji: 'OK',    color: '#D1FAE5', borderColor: '#34D399', textColor: '#065F46' },
];

const PASTAS = [
  { key: 'bruno_1', label: 'Bruno 1' },
  { key: 'bruno_2', label: 'Bruno 2' },
  { key: 'paulo_2', label: 'Paulo 2' },
];

const COLORS = {
  navy: '#1B3A5C',
  navy2: '#0F2035',
  gold: '#C9A84C',
  green: '#16A34A',
  red: '#DC2626',
  yellow: '#D97706',
  blue: '#2563EB',
  gray: '#9CA3AF',
};

const DIA_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

// Helper: formatar data DD/MM ou DD/MM/AA
function formatDateBR(iso, short = true) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    if (short) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  } catch {
    return '—';
  }
}

function formatMoney(v) {
  const n = Number(v) || 0;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

// Retorna {inicio, fim} do periodo mensal configuravel (dia 20 -> 19)
function getPeriodoMes(refDate = new Date(), startDay = 20) {
  const d = new Date(refDate);
  let inicio, fim;
  if (d.getDate() >= startDay) {
    inicio = new Date(d.getFullYear(), d.getMonth(), startDay);
    fim = new Date(d.getFullYear(), d.getMonth() + 1, startDay - 1);
  } else {
    inicio = new Date(d.getFullYear(), d.getMonth() - 1, startDay);
    fim = new Date(d.getFullYear(), d.getMonth(), startDay - 1);
  }
  inicio.setHours(0, 0, 0, 0);
  fim.setHours(23, 59, 59, 999);
  return { inicio, fim };
}

// Labels de meses em PT-BR
const MESES_PT = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Lista opcoes de mes ultimos 6 + atual + proximo
function buildMonthOptions() {
  const arr = [];
  const now = new Date();
  for (let offset = -5; offset <= 1; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    arr.push({ key, label: MESES_PT[d.getMonth()], year: d.getFullYear(), month: d.getMonth() });
  }
  return arr;
}

// Determinar coluna kanban do contrato (fallback se kanban_col nao setado)
function deriveKanbanCol(contrato) {
  if (contrato.kanban_col) return contrato.kanban_col;
  const status = contrato.status;
  if (status === 'rascunho' || status === 'enviado_zapsign') return 'aguardando_assinatura';
  if (status === 'assinado' && !contrato.peticao_distribuida_em) return 'enviado_operacional';
  if (contrato.peticao_distribuida_em) return 'distribuido';
  return 'novo_lead';
}

// Mapa de badges para origem_cliente
const ORIGEM_COLORS = {
  whatsapp: { bg: '#DCFCE7', text: '#166534' },
  instagram: { bg: '#FCE7F3', text: '#9D174D' },
  facebook: { bg: '#DBEAFE', text: '#1E3A8A' },
  indicacao: { bg: '#FEF3C7', text: '#92400E' },
  site: { bg: '#E0E7FF', text: '#3730A3' },
  google: { bg: '#FEE2E2', text: '#991B1B' },
};

function getOrigemColor(origem) {
  if (!origem) return { bg: '#F3F4F6', text: '#6B7280' };
  const key = String(origem).toLowerCase();
  return ORIGEM_COLORS[key] || { bg: '#F3F4F6', text: '#6B7280' };
}

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════

// (perf 31/05) Cache em memoria da lista de vendas — reaparece instantaneo ao voltar pra aba (sem skeleton).
let _cachedVendasContratos = null;

export default function VendasPanel() {
  const { user } = useAuth();

  // Perfil do usuario (vendedora/assistente)
  const [userPerms, setUserPerms] = useState(null);
  const [permsLoading, setPermsLoading] = useState(true);

  // Contratos carregados do banco
  const [contratos, setContratos] = useState(_cachedVendasContratos || []);
  const [loading, setLoading] = useState(!_cachedVendasContratos);
  // (perf 31/05) Mantem o cache sincronizado com a lista exibida.
  useEffect(() => { _cachedVendasContratos = contratos; }, [contratos]);
  const [error, setError] = useState('');

  // Leads rapidos (aba novo_lead)
  const [leadsRapidos, setLeadsRapidos] = useState([]);

  // Guias de custas (para saber quais contratos tem guia)
  const [guias, setGuias] = useState({}); // id_contrato -> guia

  // Promocoes ativas
  const [promocoes, setPromocoes] = useState([]);

  // Regras de comissao
  const [regras, setRegras] = useState(null);

  // View toggle (planilha | kanban), persistido
  const [view, setView] = usePersistedFilter('vendas-view', 'view', 'planilha');

  // Filtros
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [mesFiltro, setMesFiltro] = usePersistedFilter('vendas-view', 'mes', '');
  const [statusFiltro, setStatusFiltro] = usePersistedFilter('vendas-view', 'status', 'todos');
  const [pastaFiltro, setPastaFiltro] = usePersistedFilter('vendas-view', 'pasta', 'todas');

  // Drawer lateral (contrato aberto)
  const [drawerContrato, setDrawerContrato] = useState(null);

  // Modal confirm (usado para drag/drop ADVBOX warning)
  const [confirmModal, setConfirmModal] = useState(null);

  // Feedback visual de save em celulas (id_contrato + coluna)
  const [savingCell, setSavingCell] = useState(null);
  const [savedCell, setSavedCell] = useState(null);

  // Toast de novo lead / conversao etc.
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  // ─── Carregar permissoes do usuario ───
  // (admin-override) Carrega tambem todos os users para derivar lista de vendedoras
  // quando o atual for admin (permite visualizar vendas de qualquer vendedora).
  const [allUsers, setAllUsers] = useState([]);
  const [adminViewEmail, setAdminViewEmail] = useState(() => {
    try {
      return localStorage.getItem(`cbc-vendas-admin-filter:${(user?.email || '').toLowerCase()}`) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (!user?.email) {
      setPermsLoading(false);
      return;
    }
    // Query all users em um unico fetch — usamos para derivar is_admin do usuario atual
    // e lista de vendedoras (quando admin) para o dropdown do modo admin.
    supabase
      .from('user_permissions')
      .select('email, display_name, is_admin, perfil_vendas, vendedora_parceira_email')
      .order('display_name')
      .then(({ data }) => {
        const list = data || [];
        setAllUsers(list);
        const me = list.find(u => (u.email || '').toLowerCase() === (user.email || '').toLowerCase());
        setUserPerms(me || {});
        setPermsLoading(false);
      })
      .catch(() => {
        setAllUsers([]);
        setUserPerms({});
        setPermsLoading(false);
      });
  }, [user?.email]);

  // (admin-override) derivar flag de admin
  const isAdmin = useMemo(() => !!userPerms?.is_admin, [userPerms]);

  // (admin-override) lista de vendedoras para dropdown (so admin enxerga)
  const vendedorasAdminList = useMemo(() => {
    if (!isAdmin) return [];
    return allUsers.filter(u => u.perfil_vendas === 'vendedora');
  }, [isAdmin, allUsers]);

  // Determinar email filtro (com override de admin)
  // - admin + dropdown definido -> usa email escolhido
  // - admin + dropdown vazio -> null significa "todas as vendedoras" (sem filtro)
  // - vendedora -> proprio email
  // - assistente -> parceira
  const vendedoraEmail = useMemo(() => {
    if (!userPerms) return null;
    if (isAdmin) return (adminViewEmail || '').toLowerCase() || null;
    if (userPerms.perfil_vendas === 'vendedora') return (user?.email || '').toLowerCase();
    if (userPerms.perfil_vendas === 'assistente') return (userPerms.vendedora_parceira_email || '').toLowerCase();
    return null;
  }, [userPerms, user?.email, isAdmin, adminViewEmail]);

  // ─── Carregar contratos ───
  // (admin-override) admin sem vendedora selecionada -> ve TODOS os contratos.
  // Caso contrario filtra por vendedora_email.
  const fetchContratos = useCallback(async () => {
    // Gate: sem email filtro, so admin pode carregar (visao consolidada)
    if (!vendedoraEmail && !isAdmin) return;
    setLoading(true);
    setError('');
    try {
      let query = supabase
        .from('contratos')
        .select('id, nome_contratante1, nome_contratante2, cpf_contratante1, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, status, created_at, updated_at, created_by, dados, zapsign_doc_token, advbox_process_number, advbox_lawsuit_id, advbox_stage, advbox_step, kanban_col, pasta, vendedora_email, assistente_email, agenda_marcada, fim_de_semana_atendimento, promocao_sazonal_id, valor_pago_cota, data_primeira_mensagem, peticao_distribuida_em, signed_at, origem_cliente')
        .order('created_at', { ascending: false });
      if (vendedoraEmail) {
        query = query.eq('vendedora_email', vendedoraEmail);
      }
      const { data, error: dbError } = await query;
      if (dbError) throw dbError;
      setContratos(data || []);
    } catch {
      // Pode ser que colunas novas (pasta, vendedora_email etc) nao existam ainda.
      // Fallback: query minima
      try {
        const { data, error: e2 } = await supabase
          .from('contratos')
          .select('id, nome_contratante1, cpf_contratante1, resort, tipo_acao, honorarios_total, status, created_at, dados')
          .order('created_at', { ascending: false })
          .limit(100);
        if (e2) throw e2;
        setContratos(data || []);
      } catch {
        setError('Erro ao carregar contratos. Verifique se o SQL supabase_vendas_comissoes.sql foi aplicado.');
      }
    } finally {
      setLoading(false);
    }
  }, [vendedoraEmail, isAdmin]);

  // ─── Carregar leads rapidos ───
  // (admin-override) sem vendedora escolhida o admin nao carrega leads rapidos
  // (contextualizados a uma vendedora); lista fica vazia.
  const fetchLeads = useCallback(async () => {
    if (!vendedoraEmail) { setLeadsRapidos([]); return; }
    try {
      const { data, error: e } = await supabase
        .from('vendas_leads_rapidos')
        .select('*')
        .eq('vendedora_email', vendedoraEmail)
        .eq('arquivado', false)
        .is('convertido_contrato_id', null)
        .order('created_at', { ascending: false });
      if (e) throw e;
      setLeadsRapidos(data || []);
    } catch {
      // tabela pode nao existir ainda — empty state gracioso
      setLeadsRapidos([]);
    }
  }, [vendedoraEmail]);

  // ─── Carregar guias de custas ───
  const fetchGuias = useCallback(async (contratoIds) => {
    if (!contratoIds || contratoIds.length === 0) {
      setGuias({});
      return;
    }
    try {
      const { data, error: e } = await supabase
        .from('vendas_guias_custas')
        .select('*')
        .in('contrato_id', contratoIds);
      if (e) throw e;
      const map = {};
      (data || []).forEach((g) => { map[g.contrato_id] = g; });
      setGuias(map);
    } catch {
      setGuias({});
    }
  }, []);

  // ─── Carregar promocoes ativas ───
  const fetchPromocoes = useCallback(async () => {
    try {
      const now = new Date().toISOString().split('T')[0];
      const { data, error: e } = await supabase
        .from('vendas_promocoes_sazonais')
        .select('*')
        .eq('ativo', true)
        .lte('data_inicio', now)
        .gte('data_fim', now);
      if (e) throw e;
      setPromocoes(data || []);
    } catch {
      setPromocoes([]);
    }
  }, []);

  // ─── Carregar regras de comissao ───
  const fetchRegras = useCallback(async () => {
    try {
      const { data, error: e } = await supabase
        .from('vendas_comissao_regras')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (e) throw e;
      setRegras(data);
    } catch {
      setRegras(null);
    }
  }, []);

  // Disparar todos os fetches quando vendedoraEmail for conhecido
  // (admin-override) admin sem vendedora selecionada tambem carrega (visao consolidada)
  useEffect(() => {
    if (vendedoraEmail || isAdmin) {
      fetchContratos();
      fetchLeads();
      fetchPromocoes();
      fetchRegras();
    }
  }, [vendedoraEmail, isAdmin, fetchContratos, fetchLeads, fetchPromocoes, fetchRegras]);

  // Fetch guias sempre que contratos mudar
  useEffect(() => {
    if (contratos.length > 0) {
      fetchGuias(contratos.map((c) => c.id));
    }
  }, [contratos, fetchGuias]);

  // Auto-refresh a cada 60s (respeitando visibilidade)
  // (admin-override) roda tambem quando admin esta em modo consolidado (sem email)
  useEffect(() => {
    if (!vendedoraEmail && !isAdmin) return;
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchContratos();
        fetchLeads();
      }
    }, 60000);
    return () => clearInterval(iv);
  }, [vendedoraEmail, isAdmin, fetchContratos, fetchLeads]);

  // ─── FILTROS E DERIVACOES ───

  // Filtrar contratos conforme toolbar
  const contratosFiltrados = useMemo(() => {
    let arr = contratos;

    // Filtro de mes (se escolhido)
    if (mesFiltro) {
      const [year, month] = mesFiltro.split('-').map(Number);
      const refDate = new Date(year, (month || 1) - 1, 15);
      const startDay = regras?.periodo_inicio_dia || 20;
      const { inicio, fim } = getPeriodoMes(refDate, startDay);
      arr = arr.filter((c) => {
        const ref = c.signed_at || c.created_at;
        if (!ref) return false;
        const d = new Date(ref);
        return d >= inicio && d <= fim;
      });
    }

    // Filtro de status
    if (statusFiltro === 'assinados') arr = arr.filter((c) => c.status === 'assinado');
    else if (statusFiltro === 'distribuidos') arr = arr.filter((c) => !!c.peticao_distribuida_em);
    else if (statusFiltro === 'comissionaveis') arr = arr.filter((c) => c.peticao_distribuida_em && guias[c.id]?.paga_em);

    // Filtro de pasta
    if (pastaFiltro !== 'todas') arr = arr.filter((c) => c.pasta === pastaFiltro);

    // Busca fuzzy simples
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      arr = arr.filter((c) => {
        const nome = (c.nome_contratante1 || '').toLowerCase();
        const resort = (c.resort || '').toLowerCase();
        const cpf = (c.cpf_contratante1 || '').toLowerCase();
        return nome.includes(q) || resort.includes(q) || cpf.includes(q);
      });
    }

    return arr;
  }, [contratos, mesFiltro, statusFiltro, pastaFiltro, debouncedSearch, guias, regras]);

  // Agrupar em colunas kanban
  const contratosPorColuna = useMemo(() => {
    const map = {};
    KANBAN_COLS.forEach((c) => { map[c.key] = []; });
    contratosFiltrados.forEach((c) => {
      const col = deriveKanbanCol(c);
      if (map[col]) map[col].push(c);
      else map.novo_lead.push(c);
    });
    return map;
  }, [contratosFiltrados]);

  // ─── CALCULO DE COMISSAO PREVIA ───
  // (admin-override) admin sem vendedora selecionada -> nao faz sentido calcular
  // comissao consolidada (split depende do perfil); mostra placeholder.
  const comissaoPrevia = useMemo(() => {
    if (!regras) return { total: 0, countElegivel: 0, countTotal: 0 };
    if (isAdmin && !adminViewEmail) {
      return { total: 0, countElegivel: 0, countTotal: contratos.filter((c) => c.status !== 'cancelado').length, adminConsolidado: true };
    }

    const startDay = regras.periodo_inicio_dia || 20;
    const { inicio, fim } = getPeriodoMes(new Date(), startDay);

    // Contratos elegiveis: distribuido + guia paga + no periodo
    const elegiveis = contratos.filter((c) => {
      if (c.status === 'cancelado') return false;
      if (!c.peticao_distribuida_em) return false;
      if (!guias[c.id]?.paga_em) return false;
      const ref = c.signed_at || c.created_at;
      if (!ref) return false;
      const d = new Date(ref);
      return d >= inicio && d <= fim;
    });

    const totalContratos = elegiveis.length;
    if (totalContratos === 0) {
      return { total: 0, countElegivel: 0, countTotal: contratos.filter((c) => c.status !== 'cancelado').length };
    }

    // Aplicar faixa de comissao (por # contratos)
    const faixasIniciais = regras.faixas_iniciais || [];
    const faixasExito = regras.faixas_exito || [];
    const multFds = regras.multiplicador_fim_semana || 2.0;
    const bonusThreshold = regras.bonus_contratos_threshold || 100;
    const bonusValor = regras.bonus_valor || 1000.0;
    const splitVendedora = regras.split_vendedora_pct || 0.70;
    const splitAssistente = regras.split_assistente_pct || 0.30;

    function findFaixa(faixas, n) {
      for (const f of faixas) {
        if (n >= f.min && (f.max === null || n <= f.max)) return f.valor;
      }
      return 0;
    }

    const valorIniciais = findFaixa(faixasIniciais, totalContratos);
    const valorExito = findFaixa(faixasExito, totalContratos);

    let total = 0;
    let fdsCount = 0;
    elegiveis.forEach((c) => {
      const temFds = !!c.fim_de_semana_atendimento;
      if (temFds) fdsCount++;
      const peso = temFds ? multFds : 1.0;
      // iniciais + exito (supomos que contrato pode ter ambos)
      const base = valorIniciais + valorExito;
      total += base * peso;
    });

    // Bonus por atingir threshold
    if (totalContratos >= bonusThreshold) {
      total += bonusValor;
    }

    // Split conforme perfil
    // (admin-override) se admin esta impersonando uma vendedora especifica, aplicamos
    // o split de vendedora (ja que adminViewEmail so permite escolher vendedoras).
    if (isAdmin && adminViewEmail) {
      total = total * splitVendedora;
    } else if (userPerms?.perfil_vendas === 'vendedora') {
      total = total * splitVendedora;
    } else if (userPerms?.perfil_vendas === 'assistente') {
      total = total * splitAssistente;
    }

    return {
      total,
      countElegivel: totalContratos,
      countTotal: contratos.filter((c) => c.status !== 'cancelado').length,
      fdsCount,
      valorIniciais,
      valorExito,
    };
  }, [contratos, regras, guias, userPerms, isAdmin, adminViewEmail]);

  // ─── MUTACOES ───

  const updateContrato = useCallback(async (id, patch, cellKey = null) => {
    if (cellKey) setSavingCell(cellKey);
    try {
      const { error: e } = await supabase.from('contratos').update(patch).eq('id', id);
      if (e) throw e;
      // Update local
      setContratos((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      if (cellKey) {
        setSavedCell(cellKey);
        setTimeout(() => setSavedCell(null), 400);
      }
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message, 'error');
    } finally {
      setSavingCell(null);
    }
  }, [showToast]);

  // Handler para mover contrato entre colunas (drag/drop)
  const handleMoveColuna = useCallback(async (contratoId, novaCol) => {
    // Aviso: mover manualmente sai de sincronia com ADVBOX
    setConfirmModal({
      title: 'Mover de coluna?',
      message: 'Mover manualmente pode sair de sincronia com ADVBOX. O sincronizador noturno vai sobrescrever a coluna com base no estagio/passo atual no ADVBOX. Continuar?',
      confirmText: 'MOVER',
      onConfirm: async () => {
        await updateContrato(contratoId, { kanban_col: novaCol });
        setConfirmModal(null);
      },
    });
  }, [updateContrato]);

  // Export Excel
  const handleExport = useCallback(async () => {
    const XLSX = await import('xlsx');
    const rows = contratosFiltrados.map((c) => {
      const tel = c.dados?.contratantes?.[0]?.telefone || '';
      const dia = c.signed_at ? DIA_LABELS[new Date(c.signed_at).getDay()] : '';
      const guia = guias[c.id];
      const guiaStatus = !guia ? '—' : guia.paga_em ? `paga em ${formatDateBR(guia.paga_em, false)}` : 'aguardando pagamento';
      return {
        'Nome Cliente': c.nome_contratante1 || '',
        'Telefone': tel,
        'Link Kommo': c.dados?.contratantes?.[0]?.linkKommo || '',
        'Resort': c.resort || '',
        'Pasta': (PASTAS.find((p) => p.key === c.pasta)?.label) || '',
        'Origem': c.origem_cliente || '',
        'Primeiro Contato': formatDateBR(c.data_primeira_mensagem, false),
        'Assinado': c.status === 'assinado' ? 'Sim' : 'Nao',
        'Tipo Acao': c.tipo_acao || '',
        'Protocolo': formatDateBR(c.peticao_distribuida_em, false),
        'N Processo': c.advbox_process_number || '',
        'Guia': guiaStatus,
        'Agenda': c.agenda_marcada ? 'Sim' : 'Nao',
        'Fim de Semana': c.fim_de_semana_atendimento ? 'Sim' : 'Nao',
        'Promocao': (promocoes.find((p) => p.id === c.promocao_sazonal_id)?.nome) || '',
        'Valor Pago Cota': Number(c.valor_pago_cota) || 0,
        'Honorarios (R$)': Number(c.honorarios_total) || 0,
        '% Exito': Number(c.honorarios_percentual_exito) || 0,
        'Dia fechamento': dia,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comissoes');
    const colWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...rows.map((r) => String(r[key] || '').length)) + 2,
    }));
    ws['!cols'] = colWidths;
    const date = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Comissoes_${(user?.email || 'vendedora').split('@')[0]}_${date}.xlsx`);
  }, [contratosFiltrados, guias, promocoes, user?.email]);

  // ═══════════════════════════════════════════════════════════════════════
  // GATE DE PERMISSAO
  // ═══════════════════════════════════════════════════════════════════════

  if (permsLoading) {
    return <SkeletonDashboard />;
  }

  // (admin-override) admin tem acesso mesmo sem perfil_vendas definido
  if ((!userPerms || !userPerms.perfil_vendas) && !isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center p-8" style={{ background: 'var(--cbc-bg, #F9FAFB)' }}>
        <div className="max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: '#FEF3C7' }}>
            <ExclamationTriangleIcon className="w-8 h-8" style={{ color: '#D97706' }} />
          </div>
          <h2 className="text-base font-bold mb-2" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
            Acesso nao autorizado
          </h2>
          <p className="text-xs" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
            Seu usuario nao tem um perfil de vendas configurado. Peca ao Paulo para definir <code className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-mono">perfil_vendas</code> (vendedora ou assistente) em <code className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-mono">user_permissions</code>.
          </p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER PRINCIPAL
  // ═══════════════════════════════════════════════════════════════════════

  const mesOptions = buildMonthOptions();

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: 'var(--cbc-bg, #F9FAFB)' }}>
      {/* ───── TOOLBAR COMPACTA ───── */}
      <div className="shrink-0 border-b px-3 md:px-4 py-2.5 flex flex-wrap items-center gap-2" style={{ background: 'var(--cbc-surface, white)', borderColor: 'var(--cbc-border, #E5E7EB)' }}>
        {/* Toggle view */}
        <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
          <button
            onClick={() => setView('planilha')}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5 transition-colors cursor-pointer"
            style={{
              background: view === 'planilha' ? COLORS.navy : 'transparent',
              color: view === 'planilha' ? 'white' : 'var(--cbc-text-secondary, #6B7280)',
            }}
          >
            <TableCellsIcon className="w-3.5 h-3.5" />
            Planilha
          </button>
          <button
            onClick={() => setView('kanban')}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5 transition-colors cursor-pointer"
            style={{
              background: view === 'kanban' ? COLORS.navy : 'transparent',
              color: view === 'kanban' ? 'white' : 'var(--cbc-text-secondary, #6B7280)',
            }}
          >
            <ViewColumnsIcon className="w-3.5 h-3.5" />
            Kanban
          </button>
        </div>

        {/* Busca */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--cbc-text-tertiary, #9CA3AF)' }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente, resort, CPF..."
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-200"
            style={{ borderColor: 'var(--cbc-border, #E5E7EB)', background: 'var(--cbc-surface, white)', color: 'var(--cbc-text-primary, #1A2E52)' }}
          />
        </div>

        {/* Mes */}
        <select
          value={mesFiltro}
          onChange={(e) => setMesFiltro(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border cursor-pointer"
          style={{ borderColor: 'var(--cbc-border, #E5E7EB)', background: 'var(--cbc-surface, white)', color: 'var(--cbc-text-primary, #1A2E52)' }}
        >
          <option value="">Todos os meses</option>
          {mesOptions.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} {m.year}
            </option>
          ))}
        </select>

        {/* Status */}
        <select
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border cursor-pointer"
          style={{ borderColor: 'var(--cbc-border, #E5E7EB)', background: 'var(--cbc-surface, white)', color: 'var(--cbc-text-primary, #1A2E52)' }}
        >
          <option value="todos">Todos status</option>
          <option value="assinados">Assinados</option>
          <option value="distribuidos">Distribuidos</option>
          <option value="comissionaveis">Comissionaveis</option>
        </select>

        {/* Pasta */}
        <select
          value={pastaFiltro}
          onChange={(e) => setPastaFiltro(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border cursor-pointer"
          style={{ borderColor: 'var(--cbc-border, #E5E7EB)', background: 'var(--cbc-surface, white)', color: 'var(--cbc-text-primary, #1A2E52)' }}
        >
          <option value="todas">Todas pastas</option>
          {PASTAS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>

        {/* Export */}
        <button
          onClick={handleExport}
          className="px-3 py-1.5 text-[11px] font-bold uppercase rounded-lg cursor-pointer transition-colors flex items-center gap-1.5 ml-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40 max-[1366px]:min-h-[44px]"
          style={{ background: 'var(--cbc-navy)', color: 'white' }}
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" />
          Export
        </button>

        {/* Refresh */}
        <button
          onClick={() => { fetchContratos(); fetchLeads(); }}
          className="p-1.5 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40 max-[1366px]:min-h-[44px] max-[1366px]:min-w-[44px] flex items-center justify-center"
          style={{ background: 'transparent', color: 'var(--cbc-text-secondary, #6B7280)' }}
          title="Atualizar"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* (admin-override) Banner de Modo Admin — permite visualizar vendas de qualquer vendedora */}
      {isAdmin && (
        <div
          className="shrink-0 border-b px-3 md:px-4 py-2.5 flex items-center gap-3 flex-wrap"
          style={{
            background: 'linear-gradient(90deg, var(--cbc-accent, #C9A84C), var(--cbc-accent-hover, #B8860B))',
            color: 'white',
            borderColor: 'var(--cbc-border, #E5E7EB)',
          }}
        >
          <LockClosedIcon className="w-4 h-4 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wide">Modo Admin</span>
          <label className="text-[10px] uppercase tracking-wide opacity-90 font-bold">Ver como:</label>
          <select
            value={adminViewEmail}
            onChange={(e) => {
              const v = e.target.value;
              setAdminViewEmail(v);
              try {
                localStorage.setItem(`cbc-vendas-admin-filter:${(user?.email || '').toLowerCase()}`, v);
              } catch { /* ignore */ }
            }}
            className="text-xs px-2 py-1 rounded border cursor-pointer"
            style={{
              background: 'rgba(255,255,255,0.15)',
              borderColor: 'rgba(255,255,255,0.3)',
              color: 'white',
            }}
          >
            <option value="" className="text-gray-900">— Todas as vendedoras —</option>
            {vendedorasAdminList.map((v) => (
              <option key={v.email} value={v.email} className="text-gray-900">
                {v.display_name || v.email}
              </option>
            ))}
          </select>
          <span className="text-[11px] opacity-90 ml-auto">
            {adminViewEmail
              ? `Vendo: ${vendedorasAdminList.find((v) => v.email === adminViewEmail)?.display_name || adminViewEmail}`
              : 'Visao consolidada'}
          </span>
        </div>
      )}

      {/* ───── BARRA DE COMISSAO PREVISTA ───── */}
      <div className="shrink-0 border-b px-3 md:px-4 py-2.5" style={{ background: 'linear-gradient(90deg, rgba(201,168,76,0.08), rgba(27,58,92,0.04))', borderColor: 'var(--cbc-border, #E5E7EB)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <CurrencyDollarIcon className="w-5 h-5 shrink-0" style={{ color: COLORS.gold }} />
          {comissaoPrevia.adminConsolidado ? (
            <div className="flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
                Selecione uma vendedora para ver comissao prevista.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
                {isAdmin && adminViewEmail ? 'Comissao prevista do mes:' : 'Minha comissao prevista do mes:'}
              </span>
              <strong className="text-sm font-bold tabular-nums" style={{ color: 'var(--cbc-navy)' }}>{formatMoney(comissaoPrevia.total)}</strong>
              <span className="text-[11px] px-1.5 py-0.5 rounded-md font-bold uppercase" style={{ background: 'var(--cbc-warning-bg)', color: 'var(--cbc-warning)' }}>Previsao</span>
            </div>
          )}
          <div className="h-4 w-px" style={{ background: 'var(--cbc-border, #E5E7EB)' }} />
          <div className="flex items-center gap-1.5 text-xs">
            <span style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Contratos elegiveis:</span>
            <strong className="font-bold tabular-nums" style={{ color: 'var(--cbc-navy)' }}>{comissaoPrevia.countElegivel}/{comissaoPrevia.countTotal}</strong>
          </div>
          {/* Mini progress bar */}
          <div className="flex-1 min-w-[120px] max-w-xs h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--cbc-border, rgba(0,0,0,0.06))' }}>
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.min(100, (comissaoPrevia.countElegivel / Math.max(1, comissaoPrevia.countTotal)) * 100)}%`,
                background: `linear-gradient(90deg, var(--cbc-accent), var(--cbc-navy))`,
              }}
            />
          </div>
        </div>
      </div>

      {/* ───── CONTEUDO PRINCIPAL (PLANILHA OU KANBAN) ───── */}
      <div className="flex-1 overflow-hidden">
        {loading && contratos.length === 0 ? (
          <SkeletonDashboard />
        ) : error ? (
          <div className="p-6">
            <ErrorState
              title="Nao foi possivel carregar vendas"
              message={error}
              suggestion="Verifique a conexao com o Supabase e se o SQL de vendas foi aplicado."
              onRetry={fetchContratos}
            />
          </div>
        ) : view === 'planilha' ? (
          <PlanilhaView
            contratos={contratosFiltrados}
            guias={guias}
            promocoes={promocoes}
            onUpdate={updateContrato}
            onOpenDrawer={setDrawerContrato}
            savingCell={savingCell}
            savedCell={savedCell}
          />
        ) : (
          <KanbanView
            contratosPorColuna={contratosPorColuna}
            guias={guias}
            leadsRapidos={leadsRapidos}
            vendedoraEmail={vendedoraEmail}
            assistenteEmail={userPerms?.perfil_vendas === 'assistente' ? user?.email : null}
            onMoveColuna={handleMoveColuna}
            onOpenDrawer={setDrawerContrato}
            onReloadLeads={fetchLeads}
            onReloadContratos={fetchContratos}
            showToast={showToast}
          />
        )}
      </div>

      {/* ───── DRAWER LATERAL ───── */}
      {drawerContrato && (
        <ContractDrawer
          contrato={drawerContrato}
          guia={guias[drawerContrato.id]}
          promocoes={promocoes}
          onClose={() => setDrawerContrato(null)}
          onUpdate={updateContrato}
          onReloadGuias={() => fetchGuias(contratos.map((c) => c.id))}
          user={user}
          showToast={showToast}
        />
      )}

      {/* ───── MODAL CONFIRM ───── */}
      {confirmModal && (
        <ConfirmDestructive
          isOpen={true}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          confirmLabel={confirmModal.confirmLabel || 'Confirmar'}
          cancelLabel="Cancelar"
          danger={false}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* ───── TOAST ───── */}
      {toast && (
        <div
          className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold toast-above-dock"
          style={{
            background: toast.type === 'error' ? '#FEE2E2' : '#D1FAE5',
            color: toast.type === 'error' ? '#991B1B' : '#065F46',
            border: `1px solid ${toast.type === 'error' ? '#FECACA' : '#A7F3D0'}`,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SUB-COMPONENTE: PLANILHA VIEW
// ═══════════════════════════════════════════════════════════════════════

function PlanilhaView({ contratos, guias, promocoes, onUpdate, onOpenDrawer, savingCell, savedCell }) {
  // Mobile: phone (<768) ou tablet em retrato (<=1024 e altura > largura, ex: iPad portrait)
  const checkMobileViewport = () =>
    typeof window !== 'undefined' &&
    (window.innerWidth < 768 || (window.innerWidth <= 1024 && window.innerHeight > window.innerWidth));
  const [isMobile, setIsMobile] = useState(checkMobileViewport());

  useEffect(() => {
    const onResize = () => setIsMobile(
      window.innerWidth < 768 || (window.innerWidth <= 1024 && window.innerHeight > window.innerWidth)
    );
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (contratos.length === 0) {
    return (
      <div className="p-8 text-center">
        <BuildingOfficeIcon className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--cbc-text-tertiary, #9CA3AF)' }} />
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>Nenhum contrato encontrado</p>
        <p className="text-xs" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>Ajuste os filtros ou crie um novo lead na visao Kanban.</p>
      </div>
    );
  }

  // Mobile: render como lista de cards verticais
  if (isMobile) {
    return (
      <div className="h-full overflow-y-auto p-3 space-y-2">
        {contratos.map((c) => (
          <MobileCard
            key={c.id}
            contrato={c}
            guia={guias[c.id]}
            promocoes={promocoes}
            onUpdate={onUpdate}
            onOpenDrawer={onOpenDrawer}
          />
        ))}
      </div>
    );
  }

  // Desktop: tabela editavel
  return (
    <div className="h-full overflow-auto">
      <table className="text-[11px] w-full border-collapse" style={{ background: 'var(--cbc-surface, white)' }}>
        <thead className="sticky top-0 z-10">
          <tr style={{ background: COLORS.navy, color: 'white' }}>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Cliente</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Tel</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Chat</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Resort</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Pasta</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Origem</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">1 Contato</th>
            <th className="px-2 py-2 text-center font-bold uppercase tracking-wider text-[9px]">Assin.</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Docs</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Tipo</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Protocolo</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">N Processo</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Guia</th>
            <th className="px-2 py-2 text-center font-bold uppercase tracking-wider text-[9px]">Agenda</th>
            <th className="px-2 py-2 text-center font-bold uppercase tracking-wider text-[9px]">FDS</th>
            <th className="px-2 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Promo</th>
            <th className="px-2 py-2 text-right font-bold uppercase tracking-wider text-[9px]">Cota</th>
            <th className="px-2 py-2 text-right font-bold uppercase tracking-wider text-[9px]">Honor.</th>
            <th className="px-2 py-2 text-right font-bold uppercase tracking-wider text-[9px]">% Ex.</th>
            <th className="px-2 py-2 text-center font-bold uppercase tracking-wider text-[9px]">Dia</th>
            <th className="px-2 py-2 text-center font-bold uppercase tracking-wider text-[9px]">Com.</th>
          </tr>
        </thead>
        <tbody>
          {contratos.map((c) => (
            <PlanilhaRow
              key={c.id}
              contrato={c}
              guia={guias[c.id]}
              promocoes={promocoes}
              onUpdate={onUpdate}
              onOpenDrawer={onOpenDrawer}
              savingCell={savingCell}
              savedCell={savedCell}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Linha da planilha com edicao inline ───
function PlanilhaRow({ contrato, guia, promocoes, onUpdate, onOpenDrawer, savingCell, savedCell }) {
  const c = contrato;
  const tel = c.dados?.contratantes?.[0]?.telefone || '';
  const chatLink = c.dados?.contratantes?.[0]?.linkKommo || '';
  const isFds = !!c.fim_de_semana_atendimento;
  const diaSem = c.signed_at ? DIA_LABELS[new Date(c.signed_at).getDay()] : '—';

  // Status comissao
  const comissaoStatus = useMemo(() => {
    if (c.status === 'cancelado') return { label: 'Nao elegivel', bg: 'var(--cbc-bg-subtle)', text: 'var(--cbc-text-muted)' };
    if (c.peticao_distribuida_em && guia?.paga_em) return { label: 'Elegivel', bg: 'var(--cbc-success-bg)', text: 'var(--cbc-success)' };
    if (c.status === 'assinado') return { label: 'Pendente', bg: 'var(--cbc-warning-bg)', text: 'var(--cbc-warning)' };
    return { label: 'Pendente', bg: 'var(--cbc-bg-subtle)', text: 'var(--cbc-text-muted)' };
  }, [c, guia]);

  const guiaLabel = !guia ? '—' : guia.paga_em ? `paga ${formatDateBR(guia.paga_em)}` : 'aguardando pgto';
  const guiaBg = !guia ? 'var(--cbc-bg-subtle)' : guia.paga_em ? 'var(--cbc-success-bg)' : 'var(--cbc-warning-bg)';
  const guiaText = !guia ? 'var(--cbc-text-muted)' : guia.paga_em ? 'var(--cbc-success)' : 'var(--cbc-warning)';

  const origemCol = getOrigemColor(c.origem_cliente);

  // Placeholder docs — calculo real fica no drawer
  const docsLabel = '—';

  return (
    <tr
      className="border-b hover:bg-blue-50/30 transition-colors cursor-pointer"
      style={{
        borderColor: 'var(--cbc-border-subtle, #F3F4F6)',
        background: isFds ? 'rgba(201,168,76,0.06)' : undefined,
      }}
      onClick={() => onOpenDrawer(c)}
    >
      <td className="px-2 py-1.5 font-semibold truncate max-w-[160px]" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
        {c.nome_contratante1 || '—'}
      </td>
      <td className="px-2 py-1.5 text-[10px] whitespace-nowrap" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
        {tel || '—'}
      </td>
      <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
        {chatLink ? (
          <a
            href={chatLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase"
            style={{ background: '#EEF4FF', color: COLORS.navy, border: '1px solid #C0D0E8' }}
          >
            <ChatBubbleLeftRightIcon className="w-3 h-3" />
            Abrir
          </a>
        ) : <span className="text-[10px]" style={{ color: 'var(--cbc-text-tertiary, #9CA3AF)' }}>—</span>}
      </td>
      <td className="px-2 py-1.5 truncate max-w-[140px]" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
        {c.resort || '—'}
      </td>
      {/* Pasta: editavel inline */}
      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
        <EditableCell
          type="select"
          value={c.pasta || ''}
          options={[{ value: '', label: '—' }, ...PASTAS.map((p) => ({ value: p.key, label: p.label }))]}
          onSave={(v) => onUpdate(c.id, { pasta: v || null }, `${c.id}:pasta`)}
          saving={savingCell === `${c.id}:pasta`}
          saved={savedCell === `${c.id}:pasta`}
        />
      </td>
      <td className="px-2 py-1.5">
        {c.origem_cliente ? (
          <span className="px-1.5 py-0.5 rounded text-[11px] font-bold uppercase" style={{ background: origemCol.bg, color: origemCol.text }}>
            {c.origem_cliente}
          </span>
        ) : <span className="text-[11px]" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>—</span>}
      </td>
      <td className="px-2 py-1.5 text-[10px] whitespace-nowrap" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
        {formatDateBR(c.data_primeira_mensagem)}
      </td>
      <td className="px-2 py-1.5 text-center">
        {c.status === 'assinado' ? (
          <CheckCircleIcon className="w-4 h-4 mx-auto" style={{ color: COLORS.green }} />
        ) : (
          <span className="text-[10px]" style={{ color: 'var(--cbc-text-tertiary, #9CA3AF)' }}>pend.</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-[10px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
        {docsLabel}
      </td>
      <td className="px-2 py-1.5 text-[10px] truncate max-w-[120px]" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
        {c.tipo_acao || '—'}
      </td>
      <td className="px-2 py-1.5 text-[10px] whitespace-nowrap" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
        {formatDateBR(c.peticao_distribuida_em)}
      </td>
      <td className="px-2 py-1.5 text-[10px] whitespace-nowrap font-mono" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
        {c.advbox_process_number || '—'}
      </td>
      <td className="px-2 py-1.5" onClick={(e) => { e.stopPropagation(); onOpenDrawer(c); }}>
        <span className="px-1.5 py-0.5 rounded text-[11px] font-bold cursor-pointer whitespace-nowrap" style={{ background: guiaBg, color: guiaText }}>
          {guiaLabel}
        </span>
      </td>
      {/* Agenda */}
      <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
        <label htmlFor={`agenda-${c.id}`} className="inline-flex items-center justify-center cursor-pointer max-[1366px]:min-w-[44px] max-[1366px]:min-h-[44px]">
          <span className="sr-only">Agenda marcada</span>
          <input
            id={`agenda-${c.id}`}
            type="checkbox"
            checked={!!c.agenda_marcada}
            onChange={(e) => onUpdate(c.id, { agenda_marcada: e.target.checked }, `${c.id}:agenda`)}
            className="w-4 h-4 cursor-pointer focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
          />
        </label>
      </td>
      {/* FDS */}
      <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
        <label htmlFor={`fds-${c.id}`} className="inline-flex items-center justify-center cursor-pointer max-[1366px]:min-w-[44px] max-[1366px]:min-h-[44px]">
          <span className="sr-only">Fim de semana</span>
          <input
            id={`fds-${c.id}`}
            type="checkbox"
            checked={!!c.fim_de_semana_atendimento}
            onChange={(e) => onUpdate(c.id, { fim_de_semana_atendimento: e.target.checked }, `${c.id}:fds`)}
            className="w-4 h-4 cursor-pointer focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
          />
        </label>
      </td>
      {/* Promocao */}
      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
        <EditableCell
          type="select"
          value={c.promocao_sazonal_id || ''}
          options={[
            { value: '', label: 'nenhuma' },
            ...promocoes.map((p) => ({ value: p.id, label: p.nome })),
          ]}
          onSave={(v) => onUpdate(c.id, { promocao_sazonal_id: v || null }, `${c.id}:promo`)}
          saving={savingCell === `${c.id}:promo`}
          saved={savedCell === `${c.id}:promo`}
        />
      </td>
      {/* Valor pago cota */}
      <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
        <EditableCell
          type="number"
          value={c.valor_pago_cota || 0}
          disabled={(c.tipo_acao || '').toLowerCase().includes('cancel')}
          onSave={(v) => onUpdate(c.id, { valor_pago_cota: Number(v) || 0 }, `${c.id}:cota`)}
          saving={savingCell === `${c.id}:cota`}
          saved={savedCell === `${c.id}:cota`}
          format={(v) => formatMoney(v)}
        />
      </td>
      <td className="px-2 py-1.5 text-right font-semibold text-[10px] whitespace-nowrap" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
        {formatMoney(c.honorarios_total)}
      </td>
      <td className="px-2 py-1.5 text-right text-[10px]" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
        {c.honorarios_percentual_exito ? `${c.honorarios_percentual_exito}%` : '—'}
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="px-1.5 py-0.5 rounded text-[11px] font-bold uppercase" style={{ background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-secondary)' }}>
          {diaSem}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="px-1.5 py-0.5 rounded text-[11px] font-bold uppercase whitespace-nowrap" style={{ background: comissaoStatus.bg, color: comissaoStatus.text }}>
          {comissaoStatus.label}
        </span>
      </td>
    </tr>
  );
}

// ─── Celula editavel (select ou input) ───
function EditableCell({ type = 'text', value, options, onSave, saving, saved, disabled, format }) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (String(localValue) !== String(value)) onSave(localValue);
  };

  const cellStyle = {
    borderColor: saved ? COLORS.green : 'transparent',
    borderWidth: 1,
    borderStyle: 'solid',
    transition: 'border-color 300ms',
  };

  if (disabled) {
    return (
      <span className="text-[10px] italic" style={{ color: 'var(--cbc-text-tertiary, #9CA3AF)' }}>
        {type === 'number' ? formatMoney(0) : '—'}
      </span>
    );
  }

  if (type === 'select') {
    return (
      <select
        value={localValue || ''}
        onChange={(e) => {
          setLocalValue(e.target.value);
          onSave(e.target.value);
        }}
        className="w-full text-[10px] px-1.5 py-1 rounded border cursor-pointer bg-transparent focus:outline-none"
        style={cellStyle}
        disabled={saving}
      >
        {(options || []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="text-[10px] cursor-pointer px-1.5 py-1 rounded hover:bg-gray-100"
        style={cellStyle}
      >
        {format ? format(value) : (value || '—')}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type={type}
      value={localValue === null || localValue === undefined ? '' : localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setLocalValue(value); setEditing(false); }
      }}
      step={type === 'number' ? '0.01' : undefined}
      className="w-full text-[10px] px-1.5 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
      style={cellStyle}
    />
  );
}

// ─── Card mobile (planilha em mobile) ───
function MobileCard({ contrato, guia, onOpenDrawer }) {
  const c = contrato;
  return (
    <div
      className="rounded-lg p-3 border cursor-pointer"
      style={{
        background: c.fim_de_semana_atendimento ? 'rgba(201,168,76,0.08)' : 'var(--cbc-surface, white)',
        borderColor: 'var(--cbc-border, #E5E7EB)',
      }}
      onClick={() => onOpenDrawer(c)}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm truncate" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
            {c.nome_contratante1 || '—'}
          </div>
          <div className="text-[11px] truncate" style={{ color: 'var(--cbc-text-secondary, #6B7280)' }}>
            {c.resort || '—'}
          </div>
        </div>
        {c.status === 'assinado' && (
          <CheckCircleIcon className="w-4 h-4 shrink-0" style={{ color: COLORS.green }} />
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="px-1.5 py-0.5 rounded font-bold tabular-nums" style={{ background: 'var(--cbc-warning-bg)', color: 'var(--cbc-warning)' }}>
          {formatMoney(c.honorarios_total)}
        </span>
        {c.peticao_distribuida_em && (
          <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: 'var(--cbc-info-bg)', color: 'var(--cbc-info)' }}>
            Dist. {formatDateBR(c.peticao_distribuida_em)}
          </span>
        )}
        {guia?.paga_em && (
          <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: 'var(--cbc-success-bg)', color: 'var(--cbc-success)' }}>
            Guia OK
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SUB-COMPONENTE: KANBAN VIEW
// ═══════════════════════════════════════════════════════════════════════

function KanbanView({
  contratosPorColuna,
  guias,
  leadsRapidos,
  vendedoraEmail,
  assistenteEmail,
  onMoveColuna,
  onOpenDrawer,
  onReloadLeads,
  onReloadContratos,
  showToast,
}) {
  const [draggedId, setDraggedId] = useState(null);

  return (
    <div className="h-full overflow-x-auto">
      <div className="flex gap-3 p-3 md:p-4 h-full" style={{ minWidth: 'max-content' }}>
        {KANBAN_COLS.map((col) => (
          <KanbanColumn
            key={col.key}
            col={col}
            contratos={contratosPorColuna[col.key] || []}
            leadsRapidos={col.key === 'novo_lead' ? leadsRapidos : []}
            guias={guias}
            vendedoraEmail={vendedoraEmail}
            assistenteEmail={assistenteEmail}
            onOpenDrawer={onOpenDrawer}
            draggedId={draggedId}
            onDragStart={setDraggedId}
            onDragEnd={() => setDraggedId(null)}
            onDrop={(contratoId) => {
              if (contratoId) onMoveColuna(contratoId, col.key);
            }}
            onMoveColuna={onMoveColuna}
            onReloadLeads={onReloadLeads}
            onReloadContratos={onReloadContratos}
            showToast={showToast}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  col,
  contratos,
  leadsRapidos,
  guias,
  vendedoraEmail,
  assistenteEmail,
  onOpenDrawer,
  draggedId,
  onDragStart,
  onDragEnd,
  onDrop,
  onMoveColuna,
  onReloadLeads,
  onReloadContratos,
  showToast,
}) {
  const [dragOver, setDragOver] = useState(false);
  const count = contratos.length + (col.key === 'novo_lead' ? leadsRapidos.length : 0);

  return (
    <div
      className="w-72 shrink-0 flex flex-col rounded-xl border-2 overflow-hidden"
      style={{
        borderColor: dragOver ? col.borderColor : 'transparent',
        background: col.color,
        minHeight: 200,
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDrop(e.dataTransfer.getData('contratoId'));
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b" style={{ borderColor: col.borderColor + '50' }}>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: col.borderColor, color: col.textColor }}>
            {col.emoji}
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: col.textColor }}>
            {col.label}
          </span>
        </div>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.6)', color: col.textColor }}>
          {count}
        </span>
      </div>

      {/* Cards + Novo Lead */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {col.key === 'novo_lead' && (
          <NovoLeadCard
            vendedoraEmail={vendedoraEmail}
            assistenteEmail={assistenteEmail}
            onReload={onReloadLeads}
            onReloadContratos={onReloadContratos}
            showToast={showToast}
          />
        )}

        {/* Leads rapidos (so na coluna novo_lead) */}
        {col.key === 'novo_lead' &&
          leadsRapidos.map((lead) => (
            <LeadRapidoCard key={`lead-${lead.id}`} lead={lead} onReload={onReloadLeads} showToast={showToast} />
          ))}

        {/* Contratos */}
        {contratos.map((c) => (
          <ContratoKanbanCard
            key={c.id}
            contrato={c}
            guia={guias[c.id]}
            onClick={() => onOpenDrawer(c)}
            onDragStart={() => onDragStart(c.id)}
            onDragEnd={onDragEnd}
            isDragging={draggedId === c.id}
            colKey={col.key}
            onMove={onMoveColuna ? (novaCol) => onMoveColuna(c.id, novaCol) : undefined}
          />
        ))}

        {contratos.length === 0 && col.key !== 'novo_lead' && (
          <div className="p-4 text-center text-[10px] italic" style={{ color: col.textColor, opacity: 0.5 }}>
            sem contratos
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card de contrato no kanban ───
function ContratoKanbanCard({ contrato, guia, onClick, onDragStart, onDragEnd, isDragging, colKey, onMove }) {
  const c = contrato;
  const isFds = !!c.fim_de_semana_atendimento;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('contratoId', c.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="rounded-lg p-2.5 cursor-pointer transition-all hover:shadow-md"
      style={{
        background: 'rgba(255,255,255,0.95)',
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? 'scale(0.97)' : 'scale(1)',
        border: isFds ? `2px solid ${COLORS.gold}` : '1px solid rgba(0,0,0,0.08)',
      }}
    >
      <div className="font-bold text-[12px] truncate mb-0.5" style={{ color: COLORS.navy }}>
        {c.nome_contratante1 || '—'}
      </div>
      <div className="text-[10px] truncate mb-1.5" style={{ color: '#6B7280' }}>
        {c.resort || '—'}
      </div>
      <div className="flex items-center gap-1 flex-wrap text-[11px]">
        {c.honorarios_total && (
          <span className="px-1 py-0.5 rounded font-bold tabular-nums" style={{ background: 'var(--cbc-warning-bg)', color: 'var(--cbc-warning)' }}>
            {formatMoney(c.honorarios_total)}
          </span>
        )}
        {c.status === 'assinado' && (
          <CheckCircleIcon className="w-3 h-3" style={{ color: COLORS.green }} />
        )}
        {c.agenda_marcada && (
          <CalendarDaysIcon className="w-3 h-3" style={{ color: COLORS.blue }} />
        )}
        {guia?.paga_em && (
          <CurrencyDollarIcon className="w-3 h-3" style={{ color: COLORS.green }} />
        )}
        {isFds && (
          <SparklesIcon className="w-3 h-3" style={{ color: COLORS.gold }} />
        )}
      </div>
      {/* Mover entre colunas (touch-only — drag nao dispara em touch) */}
      {onMove && (
        <div className="cbc-touch-only items-center mt-1.5" onClick={(e) => e.stopPropagation()}>
          <select
            value=""
            onChange={(e) => { if (e.target.value) onMove(e.target.value); }}
            aria-label="Mover para coluna"
            className="w-full rounded border px-1.5 py-1 text-[11px] font-semibold"
            style={{ borderColor: 'rgba(0,0,0,0.12)', color: '#6B7280', background: 'rgba(255,255,255,0.9)' }}
          >
            <option value="">Mover para...</option>
            {KANBAN_COLS.filter((k) => k.key !== colKey).map((k) => (
              <option key={k.key} value={k.key}>{k.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ─── Card de lead rapido (pre-contrato) ───
function LeadRapidoCard({ lead, onReload, showToast }) {
  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm(`Arquivar lead "${lead.nome}"?`)) return;
    try {
      await supabase.from('vendas_leads_rapidos').update({ arquivado: true }).eq('id', lead.id);
      showToast('Lead arquivado');
      onReload();
    } catch (err) {
      showToast('Erro ao arquivar: ' + err.message, 'error');
    }
  };

  const handleConvert = (e) => {
    e.stopPropagation();
    // Dispara evento global para trocar aba para "novo"
    window.dispatchEvent(new CustomEvent('cbc:openNovoFromLead', {
      detail: {
        nome: lead.nome,
        telefone: lead.telefone,
        kommoLink: lead.kommo_link,
        leadRapidoId: lead.id,
      },
    }));
    window.dispatchEvent(new CustomEvent('cbc:switchTab', { detail: { tab: 'novo' } }));
  };

  return (
    <div
      className="rounded-lg p-2.5 cursor-pointer transition-all hover:shadow-md relative"
      style={{
        background: 'rgba(255,255,255,0.95)',
        border: '1px dashed #F9A8D4',
      }}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[12px] truncate" style={{ color: COLORS.navy }}>
            {lead.nome}
          </div>
          <div className="text-[10px] truncate" style={{ color: '#6B7280' }}>
            {lead.telefone || '—'}
          </div>
        </div>
        <button
          onClick={handleDelete}
          className="p-0.5 rounded hover:bg-red-100"
          title="Arquivar lead"
        >
          <XMarkIcon className="w-3 h-3" style={{ color: 'var(--cbc-danger)' }} />
        </button>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {lead.kommo_link && (
          <a
            href={lead.kommo_link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex items-center gap-0.5"
            style={{ background: '#EEF4FF', color: COLORS.navy }}
          >
            <ChatBubbleLeftRightIcon className="w-2.5 h-2.5" />
            Kommo
          </a>
        )}
        <button
          onClick={handleConvert}
          className="px-1.5 py-0.5 rounded text-[11px] font-bold uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
          style={{ background: 'var(--cbc-navy)', color: 'white' }}
        >
          Gerar contrato
        </button>
      </div>
    </div>
  );
}

// ─── Card "+ Novo Lead" no topo da coluna novo_lead ───
function NovoLeadCard({ vendedoraEmail, assistenteEmail, onReload, onReloadContratos, showToast }) {
  const [expanded, setExpanded] = useState(false);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [kommoLink, setKommoLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [importModal, setImportModal] = useState(false);

  const reset = () => {
    setNome(''); setTelefone(''); setKommoLink('');
  };

  const handleSaveFichaRapida = async () => {
    if (!nome.trim()) {
      showToast('Nome obrigatorio', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error: e } = await supabase.from('vendas_leads_rapidos').insert({
        vendedora_email: vendedoraEmail,
        assistente_email: assistenteEmail,
        nome: nome.trim(),
        telefone: telefone.trim() || null,
        kommo_link: kommoLink.trim() || null,
      });
      if (e) throw e;
      showToast('Lead criado');
      reset();
      setExpanded(false);
      onReload();
    } catch (err) {
      if (String(err.message || '').toLowerCase().includes('does not exist')) {
        showToast('Tabela vendas_leads_rapidos nao existe. Rode o SQL.', 'error');
      } else {
        showToast('Erro: ' + err.message, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleGerarContrato = () => {
    if (!nome.trim()) {
      showToast('Nome obrigatorio para gerar contrato', 'error');
      return;
    }
    // Envia dados ao App para pre-preencher o step 1
    window.dispatchEvent(new CustomEvent('cbc:openNovoFromLead', {
      detail: { nome: nome.trim(), telefone: telefone.trim(), kommoLink: kommoLink.trim() },
    }));
    window.dispatchEvent(new CustomEvent('cbc:switchTab', { detail: { tab: 'novo' } }));
    reset();
    setExpanded(false);
  };

  return (
    <>
      <div
        className="rounded-lg border-2 border-dashed p-2.5"
        style={{ borderColor: '#F9A8D4', background: 'rgba(255,255,255,0.85)' }}
      >
        {!expanded ? (
          <button
            onClick={() => setExpanded(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold uppercase cursor-pointer transition-all hover:bg-pink-50"
            style={{ color: '#9D174D' }}
          >
            <PlusIcon className="w-4 h-4" />
            Novo Lead
          </button>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-bold uppercase" style={{ color: '#9D174D' }}>
                Novo Lead
              </span>
              <button
                onClick={() => { setExpanded(false); reset(); }}
                className="p-0.5 rounded hover:bg-pink-50"
              >
                <XMarkIcon className="w-3 h-3" style={{ color: '#9D174D' }} />
              </button>
            </div>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome Cliente"
              className="w-full px-2 py-1.5 text-[11px] rounded border focus:outline-none focus:ring-1 focus:ring-pink-300"
              style={{ borderColor: '#F9A8D4' }}
            />
            <input
              type="text"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="Telefone"
              className="w-full px-2 py-1.5 text-[11px] rounded border focus:outline-none focus:ring-1 focus:ring-pink-300"
              style={{ borderColor: '#F9A8D4' }}
            />
            <input
              type="text"
              value={kommoLink}
              onChange={(e) => setKommoLink(e.target.value)}
              placeholder="Link Kommo (URL da conversa/lead)"
              className="w-full px-2 py-1.5 text-[11px] rounded border focus:outline-none focus:ring-1 focus:ring-pink-300"
              style={{ borderColor: '#F9A8D4' }}
            />
            {kommoLink && (
              <a
                href={kommoLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold uppercase"
                style={{ background: '#EEF4FF', color: COLORS.navy }}
              >
                <ChatBubbleLeftRightIcon className="w-3 h-3" />
                Abrir Kommo
              </a>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={handleSaveFichaRapida}
                disabled={saving}
                className="px-1.5 py-1.5 rounded text-[10px] font-bold uppercase cursor-pointer disabled:opacity-50"
                style={{ background: '#9D174D', color: 'white' }}
              >
                {saving ? '...' : 'Ficha rapida'}
              </button>
              <button
                onClick={handleGerarContrato}
                className="px-1.5 py-1.5 rounded text-[11px] font-bold uppercase cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
                style={{ background: 'var(--cbc-navy)', color: 'white' }}
              >
                Gerar contrato
              </button>
            </div>
            <button
              onClick={() => setImportModal(true)}
              className="w-full px-1.5 py-1.5 rounded text-[10px] font-bold uppercase cursor-pointer flex items-center justify-center gap-1"
              style={{ background: 'transparent', color: '#9D174D', border: '1px dashed #F9A8D4' }}
            >
              <UserPlusIcon className="w-3 h-3" />
              Importar lead existente
            </button>
          </div>
        )}
      </div>

      {importModal && (
        <ImportLeadModal
          vendedoraEmail={vendedoraEmail}
          assistenteEmail={assistenteEmail}
          onClose={() => setImportModal(false)}
          onReload={() => { onReload(); onReloadContratos?.(); }}
          showToast={showToast}
        />
      )}
    </>
  );
}

// ─── Modal importar lead existente (tabela leads) ───
// (cleanup 20260418_152512) aba Leads removida, mas a tabela `leads` ainda existe no banco
// (Meta Ads -> Make.com pode continuar populando). Import segue funcional; se a tabela
// vier a ser dropada futuramente, o catch torna o fluxo gracioso (lista vazia).
function ImportLeadModal({ vendedoraEmail, assistenteEmail, onClose, onReload, showToast }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    supabase
      .from('leads')
      .select('id, nome, telefone, quando_comprou, ainda_pagando, received_at, contato_tentativas')
      .order('received_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setLeads(data || []);
        setLoading(false);
      })
      .catch(() => { setLeads([]); setLoading(false); });
  }, []);

  const handleImport = async (lead) => {
    try {
      const { error: e } = await supabase.from('vendas_leads_rapidos').insert({
        vendedora_email: vendedoraEmail,
        assistente_email: assistenteEmail,
        nome: lead.nome,
        telefone: lead.telefone,
        observacao: `Importado de Leads (Meta Ads). Qdo comprou: ${lead.quando_comprou || '—'}. Pagando: ${lead.ainda_pagando === true ? 'sim' : lead.ainda_pagando === false ? 'nao' : '—'}`,
      });
      if (e) throw e;
      showToast('Lead importado');
      onReload();
      onClose();
    } catch (err) {
      showToast('Erro ao importar: ' + err.message, 'error');
    }
  };

  const filtered = leads.filter((l) =>
    !search || l.nome?.toLowerCase().includes(search.toLowerCase()) || l.telefone?.includes(search),
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold text-sm" style={{ color: COLORS.navy }}>Importar lead existente</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 border-b">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome ou telefone..."
            className="w-full px-3 py-2 text-xs rounded border focus:outline-none focus:ring-2 focus:ring-blue-200"
            style={{ borderColor: '#E5E7EB' }}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="p-8 text-center text-xs" style={{ color: '#6B7280' }}>Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs" style={{ color: '#6B7280' }}>Nenhum lead encontrado</div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((l) => (
                <button
                  key={l.id}
                  onClick={() => handleImport(l)}
                  className="w-full text-left p-3 rounded-lg border hover:bg-blue-50 transition-colors"
                  style={{ borderColor: '#E5E7EB' }}
                >
                  <div className="font-bold text-[13px]" style={{ color: COLORS.navy }}>{l.nome}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: '#6B7280' }}>
                    {l.telefone || '—'} · {formatDateBR(l.received_at, false)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SUB-COMPONENTE: DRAWER LATERAL (detalhes do contrato)
// ═══════════════════════════════════════════════════════════════════════

function ContractDrawer({ contrato, guia, promocoes, onClose, onUpdate, onReloadGuias, user, showToast }) {
  const c = contrato;
  const [docs, setDocs] = useState({ requisitos: [], enviados: [], loading: true });
  const [showGuiaForm, setShowGuiaForm] = useState(false);

  // Load docs requisitos + enviados
  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const tipoAcao = c.tipo_acao || '*';
        const resort = c.resort || '*';

        // Primeiro busca requisitos especificos para resort+tipo, se nao, cai no fallback
        // Padrao: resort='*' OR tipo_acao='*'
        const { data: req, error: eReq } = await supabase
          .from('vendas_documentos_requisitos')
          .select('*, tipo:vendas_documentos_tipos(id, nome, categoria)')
          .or(`and(resort.eq.${resort},tipo_acao.eq.${tipoAcao}),and(resort.eq.*,tipo_acao.eq.*)`)
          .order('ordem', { ascending: true });
        if (eReq) throw eReq;

        const { data: env, error: eEnv } = await supabase
          .from('vendas_documentos_enviados')
          .select('*')
          .eq('contrato_id', c.id);
        if (eEnv) throw eEnv;

        if (!canceled) {
          setDocs({ requisitos: req || [], enviados: env || [], loading: false });
        }
      } catch {
        if (!canceled) setDocs({ requisitos: [], enviados: [], loading: false });
      }
    }
    load();
    return () => { canceled = true; };
  }, [c.id, c.resort, c.tipo_acao]);

  // ESC fecha drawer
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const kommoLink = c.dados?.contratantes?.[0]?.linkKommo;
  const tel = c.dados?.contratantes?.[0]?.telefone;

  // Status comissao UI
  // (mesma paleta tokenizada do badge compacto em PlanilhaRow.comissaoStatus)
  let commStatus = null;
  if (c.status === 'cancelado') {
    commStatus = { tipo: 'nao_elegivel', text: 'Nao elegivel (cancelado)', bg: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-muted)', border: 'var(--cbc-border)' };
  } else if (c.peticao_distribuida_em && guia?.paga_em) {
    commStatus = { tipo: 'elegivel', text: 'Elegivel para comissao', bg: 'var(--cbc-success-bg)', color: 'var(--cbc-success)', border: 'var(--cbc-success-border)' };
  } else {
    commStatus = { tipo: 'aguardando', text: 'Aguardando distribuicao + guia paga', bg: 'var(--cbc-warning-bg)', color: 'var(--cbc-warning)', border: 'var(--cbc-warning-border)' };
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full overflow-y-auto shadow-2xl flex flex-col"
        style={{ background: 'var(--cbc-surface, white)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base truncate" style={{ color: COLORS.navy }}>
              {c.nome_contratante1 || '—'}
            </h3>
            <p className="text-[11px] truncate" style={{ color: '#6B7280' }}>
              {c.resort || '—'} · {c.tipo_acao || '—'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-1 rounded hover:bg-gray-100 shrink-0 max-sm:min-w-[44px] max-sm:min-h-[44px] max-sm:inline-flex max-sm:items-center max-sm:justify-center">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Quick actions */}
        <div className="shrink-0 px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: 'var(--cbc-border, #E5E7EB)' }}>
          {kommoLink && (
            <a
              href={kommoLink}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded text-[10px] font-bold uppercase flex items-center gap-1"
              style={{ background: '#EEF4FF', color: COLORS.navy, border: '1px solid #C0D0E8' }}
            >
              <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
              Kommo
            </a>
          )}
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('cbc:switchTab', { detail: { tab: 'contratos', searchId: c.id } }));
              onClose();
            }}
            className="px-3 py-1.5 rounded text-[10px] font-bold uppercase flex items-center gap-1"
            style={{ background: 'transparent', color: '#6B7280', border: '1px solid #E5E7EB' }}
          >
            <DocumentTextIcon className="w-3.5 h-3.5" />
            Ver contrato
          </button>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 1. Informacoes basicas */}
          <DrawerSection title="Informacoes">
            <InfoRow label="CPF" value={c.cpf_contratante1 || '—'} />
            <InfoRow label="Telefone" value={tel || '—'} />
            <InfoRow label="Status contrato" value={<StatusBadge status={c.status} />} />
            <InfoRow label="Origem" value={c.origem_cliente || '—'} />
            <InfoRow label="1 contato" value={formatDateBR(c.data_primeira_mensagem, false)} />
            <InfoRow label="Assinado em" value={formatDateBR(c.signed_at, false)} />
          </DrawerSection>

          {/* 2. Venda */}
          <DrawerSection title="Venda">
            <div className="grid grid-cols-2 gap-2">
              <DrawerField label="Pasta">
                <select
                  value={c.pasta || ''}
                  onChange={(e) => onUpdate(c.id, { pasta: e.target.value || null })}
                  className="w-full text-[11px] px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
                  style={{ borderColor: '#E5E7EB', background: 'white' }}
                >
                  <option value="">—</option>
                  {PASTAS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </DrawerField>
              <DrawerField label="Promocao">
                <select
                  value={c.promocao_sazonal_id || ''}
                  onChange={(e) => onUpdate(c.id, { promocao_sazonal_id: e.target.value || null })}
                  className="w-full text-[11px] px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
                  style={{ borderColor: '#E5E7EB', background: 'white' }}
                >
                  <option value="">nenhuma</option>
                  {promocoes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </DrawerField>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <label htmlFor={`drawer-agenda-${c.id}`} className="flex items-center gap-1.5 text-[11px] cursor-pointer max-[1366px]:min-h-[44px]" style={{ color: 'var(--cbc-text-secondary)' }}>
                <input
                  id={`drawer-agenda-${c.id}`}
                  type="checkbox"
                  checked={!!c.agenda_marcada}
                  onChange={(e) => onUpdate(c.id, { agenda_marcada: e.target.checked })}
                  className="w-4 h-4 focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
                />
                Agenda marcada
              </label>
              <label htmlFor={`drawer-fds-${c.id}`} className="flex items-center gap-1.5 text-[11px] cursor-pointer max-[1366px]:min-h-[44px]" style={{ color: 'var(--cbc-text-secondary)' }}>
                <input
                  id={`drawer-fds-${c.id}`}
                  type="checkbox"
                  checked={!!c.fim_de_semana_atendimento}
                  onChange={(e) => onUpdate(c.id, { fim_de_semana_atendimento: e.target.checked })}
                  className="w-4 h-4 focus-visible:ring-2 focus-visible:ring-[color:var(--cbc-navy)]/40"
                />
                Fim de semana
              </label>
            </div>
            <div className="mt-2">
              <DrawerField label="Valor pago (cota) em R$">
                <input
                  type="number"
                  step="0.01"
                  value={c.valor_pago_cota || 0}
                  onChange={(e) => onUpdate(c.id, { valor_pago_cota: Number(e.target.value) || 0 })}
                  className="w-full text-[11px] px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
                  style={{ borderColor: '#E5E7EB', background: 'white' }}
                />
              </DrawerField>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <InfoRow label="Honorarios" value={formatMoney(c.honorarios_total)} />
              <InfoRow label="% Exito" value={c.honorarios_percentual_exito ? `${c.honorarios_percentual_exito}%` : '—'} />
            </div>
          </DrawerSection>

          {/* 3. Documentacao */}
          <DrawerSection title="Documentacao">
            <DocsSection docs={docs} contratoId={c.id} user={user} onReload={() => {
              supabase.from('vendas_documentos_enviados').select('*').eq('contrato_id', c.id).then(({ data }) => {
                setDocs((d) => ({ ...d, enviados: data || [] }));
              });
            }} showToast={showToast} />
          </DrawerSection>

          {/* 4. Guia de custas */}
          <DrawerSection title="Guia de custas">
            {guia ? (
              <div className="space-y-1.5 text-[11px]">
                <InfoRow label="Valor" value={formatMoney(guia.valor)} />
                <InfoRow label="Emitida em" value={formatDateBR(guia.emitida_em, false)} />
                <InfoRow label="Enviada cliente" value={formatDateBR(guia.enviada_cliente_em, false)} />
                <InfoRow label="Paga em" value={formatDateBR(guia.paga_em, false)} />
                <InfoRow label="Juntada em" value={formatDateBR(guia.juntada_em, false)} />
                {guia.comprovante_url && (
                  <a
                    href={guia.comprovante_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-bold uppercase flex items-center gap-1"
                    style={{ color: COLORS.blue }}
                  >
                    <DocumentArrowUpIcon className="w-3.5 h-3.5" />
                    {guia.comprovante_nome || 'Ver comprovante'}
                  </a>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setShowGuiaForm(true)}
                    className="px-2 py-1 rounded text-[10px] font-bold uppercase"
                    style={{ background: '#EEF4FF', color: COLORS.navy, border: '1px solid #C0D0E8' }}
                  >
                    Editar
                  </button>
                  {!guia.juntada_em && (
                    <button
                      onClick={async () => {
                        // 1. UPDATE guia
                        try {
                          await supabase.from('vendas_guias_custas').update({
                            juntada_em: new Date().toISOString(),
                            juntada_por: user?.email,
                          }).eq('id', guia.id);
                        } catch (err) {
                          showToast('Erro ao marcar guia: ' + err.message, 'error');
                          return;
                        }

                        // 2. Criar task ADVBOX (se houver lawsuit_id)
                        const lawsuitId = c.advbox_lawsuit_id;
                        if (lawsuitId) {
                          try {
                            const resp = await fetch('/.netlify/functions/advbox-create-task', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                contractId: c.id,
                                lawsuitId: lawsuitId,
                                taskType: 'juntar_guia',
                              }),
                            });
                            const r = await resp.json().catch(() => ({}));
                            if (r.success) {
                              showToast(`Task ADVBOX criada: ${r.task || 'OK'}`);
                            } else {
                              showToast(`Guia marcada. Aviso: falha ao criar task ADVBOX (${r.error || 'erro'})`, 'error');
                            }
                          } catch (e) {
                            showToast(`Guia marcada. Aviso: erro ao criar task: ${e.message}`, 'error');
                          }
                        } else {
                          showToast('Guia marcada como juntada. (Sem lawsuit_id ADVBOX — task nao criada.)');
                        }

                        onReloadGuias();
                      }}
                      className="px-2 py-1 rounded text-[10px] font-bold uppercase"
                      style={{ background: COLORS.green, color: 'white' }}
                    >
                      Marcar como Juntada
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <p className="text-[11px] italic mb-2" style={{ color: '#6B7280' }}>
                  Nenhuma guia criada ainda.
                </p>
                <button
                  onClick={() => setShowGuiaForm(true)}
                  className="px-3 py-1.5 rounded text-[10px] font-bold uppercase flex items-center gap-1"
                  style={{ background: COLORS.navy, color: 'white' }}
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Criar guia
                </button>
              </div>
            )}

            {showGuiaForm && (
              <GuiaForm
                contratoId={c.id}
                guiaExistente={guia}
                user={user}
                onClose={() => setShowGuiaForm(false)}
                onSaved={() => {
                  setShowGuiaForm(false);
                  onReloadGuias();
                }}
                showToast={showToast}
              />
            )}
          </DrawerSection>

          {/* 5. Status comissao */}
          <DrawerSection title="Status comissao">
            <div
              className="rounded-lg p-3 flex items-start gap-2"
              style={{ background: commStatus.bg, border: `1px solid ${commStatus.border}` }}
            >
              <div className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: commStatus.color }}>
                {commStatus.tipo === 'elegivel' ? (
                  <CheckCircleIcon className="w-3.5 h-3.5" style={{ color: 'white' }} />
                ) : commStatus.tipo === 'aguardando' ? (
                  <ClockIcon className="w-3.5 h-3.5" style={{ color: 'white' }} />
                ) : (
                  <XMarkIcon className="w-3.5 h-3.5" style={{ color: 'white' }} />
                )}
              </div>
              <div>
                <div className="font-bold text-[12px]" style={{ color: commStatus.color }}>
                  {commStatus.text}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--cbc-text-secondary)' }}>
                  Calculo oficial feito mensalmente pelo sistema. Valor previsto na barra superior.
                </div>
              </div>
            </div>
          </DrawerSection>
        </div>
      </div>
    </div>
  );
}

// ─── Drawer helpers ───
function DrawerSection({ title, children }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--cbc-border, #E5E7EB)', background: 'var(--cbc-surface, white)' }}>
      <div className="text-[9px] font-bold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] py-0.5">
      <span style={{ color: '#6B7280' }}>{label}</span>
      <span className="font-semibold" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
        {value}
      </span>
    </div>
  );
}

function DrawerField({ label, children }) {
  return (
    <div>
      <label className="block text-[9px] font-bold uppercase mb-0.5" style={{ color: '#6B7280' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    rascunho: { bg: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-muted)' },
    enviado_zapsign: { bg: 'var(--cbc-warning-bg)', color: 'var(--cbc-warning)' },
    assinado: { bg: 'var(--cbc-success-bg)', color: 'var(--cbc-success)' },
    cancelado: { bg: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' },
  };
  const cfg = map[status] || map.rascunho;
  return (
    <span className="px-1.5 py-0.5 rounded text-[11px] font-bold uppercase" style={{ background: cfg.bg, color: cfg.color }}>
      {status || '—'}
    </span>
  );
}

// ─── Docs section (dentro do drawer) ───
function DocsSection({ docs, contratoId, user, onReload, showToast }) {
  if (docs.loading) {
    return <div className="text-[11px] italic" style={{ color: '#6B7280' }}>Carregando documentos...</div>;
  }

  // Merge enviados por documento_tipo_id (mais recente por tipo)
  const enviadosMap = {};
  docs.enviados.forEach((e) => {
    if (!enviadosMap[e.documento_tipo_id] || new Date(e.enviado_em) > new Date(enviadosMap[e.documento_tipo_id].enviado_em)) {
      enviadosMap[e.documento_tipo_id] = e;
    }
  });

  if (docs.requisitos.length === 0) {
    return (
      <div className="text-[11px] italic" style={{ color: '#6B7280' }}>
        Nenhum requisito de documentos cadastrado para este resort+tipo. Admin pode configurar em Parametrizacao de Vendas.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {docs.requisitos.map((r) => {
        const env = enviadosMap[r.documento_tipo_id];
        let statusIcon = null;
        let statusColor = '';
        if (!env) { statusIcon = <XMarkIcon className="w-3.5 h-3.5" />; statusColor = 'var(--cbc-text-muted)'; }
        else if (env.status === 'validado') { statusIcon = <CheckCircleIcon className="w-3.5 h-3.5" />; statusColor = 'var(--cbc-success)'; }
        else if (env.status === 'rejeitado') { statusIcon = <ExclamationTriangleIcon className="w-3.5 h-3.5" />; statusColor = 'var(--cbc-danger)'; }
        else { statusIcon = <ClockIcon className="w-3.5 h-3.5" />; statusColor = 'var(--cbc-warning)'; }

        const obrigCor = r.obrigatoriedade === 'obrigatorio' ? 'var(--cbc-danger)' : r.obrigatoriedade === 'condicional' ? 'var(--cbc-warning)' : 'var(--cbc-text-muted)';
        const tipoNome = r.tipo?.nome || (typeof r.documento_tipo_id === 'string' ? r.documento_tipo_id.slice(0, 8) : '—');

        return (
          <div key={r.id} className="flex items-center gap-2 text-[11px] p-2 rounded border" style={{ borderColor: '#E5E7EB' }}>
            <span style={{ color: statusColor }}>{statusIcon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>{tipoNome}</div>
              <div className="text-[11px] uppercase font-bold" style={{ color: obrigCor }}>{r.obrigatoriedade}</div>
            </div>
            <DocUploadButton documentoTipoId={r.documento_tipo_id} contratoId={contratoId} user={user} onReload={onReload} showToast={showToast} />
          </div>
        );
      })}
    </div>
  );
}

function DocUploadButton({ documentoTipoId, contratoId, user, onReload, showToast }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Arquivo maior que 5MB. Configurar Supabase Storage.', 'error');
      return;
    }
    setUploading(true);
    try {
      // TODO(storage): quando Supabase Storage estiver configurado, upload pra bucket em vez de base64.
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result;
          const { error: e } = await supabase.from('vendas_documentos_enviados').insert({
            contrato_id: contratoId,
            documento_tipo_id: documentoTipoId,
            arquivo_url: base64,
            arquivo_nome: file.name,
            enviado_por: user?.email || 'desconhecido',
          });
          if (e) throw e;
          showToast('Documento enviado');
          onReload();
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      showToast('Erro: ' + err.message, 'error');
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="px-2 py-1 rounded text-[9px] font-bold uppercase cursor-pointer disabled:opacity-50"
        style={{ background: '#EEF4FF', color: COLORS.navy, border: '1px solid #C0D0E8' }}
      >
        {uploading ? '...' : 'Upload'}
      </button>
    </>
  );
}

// ─── Form de guia de custas ───
function GuiaForm({ contratoId, guiaExistente, user, onClose, onSaved, showToast }) {
  const [valor, setValor] = useState(guiaExistente?.valor || '');
  const [emitidaEm, setEmitidaEm] = useState(guiaExistente?.emitida_em || '');
  const [enviadaClienteEm, setEnviadaClienteEm] = useState(guiaExistente?.enviada_cliente_em?.split?.('T')?.[0] || '');
  const [pagaEm, setPagaEm] = useState(guiaExistente?.paga_em || '');
  const [observacao, setObservacao] = useState(guiaExistente?.observacao || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!valor) {
      showToast('Valor obrigatorio', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        contrato_id: contratoId,
        valor: Number(valor),
        emitida_em: emitidaEm || null,
        enviada_cliente_em: enviadaClienteEm || null,
        enviada_por: user?.email,
        paga_em: pagaEm || null,
        observacao: observacao || null,
      };
      if (guiaExistente) {
        const { error: e } = await supabase.from('vendas_guias_custas').update(payload).eq('id', guiaExistente.id);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from('vendas_guias_custas').insert(payload);
        if (e) throw e;
      }
      showToast(guiaExistente ? 'Guia atualizada' : 'Guia criada');
      onSaved();
    } catch (err) {
      showToast('Erro: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm" style={{ color: COLORS.navy }}>
            {guiaExistente ? 'Editar guia' : 'Nova guia de custas'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2">
          <DrawerField label="Valor (R$)">
            <input
              type="number" step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
              style={{ borderColor: '#E5E7EB' }}
            />
          </DrawerField>
          <DrawerField label="Emitida em">
            <input
              type="date"
              value={emitidaEm}
              onChange={(e) => setEmitidaEm(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
              style={{ borderColor: '#E5E7EB' }}
            />
          </DrawerField>
          <DrawerField label="Enviada ao cliente">
            <input
              type="date"
              value={enviadaClienteEm}
              onChange={(e) => setEnviadaClienteEm(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
              style={{ borderColor: '#E5E7EB' }}
            />
          </DrawerField>
          <DrawerField label="Paga em">
            <input
              type="date"
              value={pagaEm}
              onChange={(e) => setPagaEm(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
              style={{ borderColor: '#E5E7EB' }}
            />
          </DrawerField>
          <DrawerField label="Observacao">
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              className="w-full text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-300"
              style={{ borderColor: '#E5E7EB' }}
            />
          </DrawerField>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[11px] font-bold uppercase"
            style={{ background: 'transparent', color: '#6B7280', border: '1px solid #E5E7EB' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded text-[11px] font-bold uppercase disabled:opacity-50"
            style={{ background: COLORS.navy, color: 'white' }}
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
