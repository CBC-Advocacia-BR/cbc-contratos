import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react';
import { useContract } from '../ContractContext';
// ocrService importado dinamicamente ao processar CNH (lazy) (#112)
import ProgressBar from './ProgressBar';
import { maskCPF, maskCEP, maskRG, maskPhone, maskCNPJ } from '../utils/masks';
import { lookupCPF, lookupCNPJ } from '../utils/apiLookup';
import { validateCNPJ } from '../utils/validation';
import { useCepLookup } from '../hooks/useCepLookup';
import { supabase } from '../lib/supabase';
import { ESTADOS_CIVIS, HONORARIOS_OPCOES, PERCENTUAIS_EXITO, CLAUSULAS_PADRAO, TIPOS_ACAO } from '../data/clausulas';
import { useEmpreendimentos } from '../hooks/useEmpreendimentos';
import { formatCurrency } from '../utils/extenso';
import { detectConflicts, getConflictColor } from '../utils/clausulaConflicts';
import { getGenderUpdates, adjustProfissaoGender } from '../utils/genderDetector';
// docxGenerator importado dinamicamente ao gerar DOCX (lazy) (#112)
import { checkDuplicate, estimateSignatureTime } from '../utils/duplicateDetector';
import {
  UserIcon,
  BuildingOffice2Icon,
  CurrencyDollarIcon,
  ClipboardDocumentListIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline';

// Mapeamento severity -> Heroicon (alinhado com getConflictColor().icon)
const CONFLICT_ICON_MAP = {
  error: NoSymbolIcon,
  warning: ExclamationTriangleIcon,
  info: InformationCircleIcon,
};
function ConflictIcon({ iconKey, className, style }) {
  const Cmp = CONFLICT_ICON_MAP[iconKey];
  if (!Cmp) return <span className={className} style={style}>•</span>;
  return <Cmp className={className} style={style} aria-hidden="true" />;
}
import { useRipple } from '../hooks/useRipple';
import { useToast } from './Toast';
import PresenceIndicator from './contratos/PresenceIndicator';

// (#36) Validacao cruzada de data de nascimento — retorna {level, message} ou null
function evaluateBirthDate(value) {
  if (!value) return null;
  const d = new Date(value + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d > today) {
    return { level: 'error', message: 'Data de nascimento no futuro — verifique' };
  }
  const ageMs = today - d;
  const age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
  if (age > 120) return { level: 'error', message: `Idade calculada: ${age} anos — data parece incorreta` };
  if (age < 18)  return { level: 'warning', message: `Atencao: contratante menor de idade (${age} anos)` };
  if (age >= 60) return { level: 'senior', message: `Prioridade Idoso ativada (${age} anos)` };
  return null;
}

// ─── Progress indicator logic ───
const CONTRATANTE_FIELDS_PF = ['nome', 'nacionalidade', 'profissao', 'estadoCivil', 'rg', 'cpf', 'email', 'dataNascimento', 'telefone', 'linkKommo', 'cep', 'uf', 'endereco', 'numero', 'bairro', 'cidade'];
// (PJ 25/06) Cliente Empresa: bloco da empresa + representante legal (reaproveita os campos
// de pessoa do PF — nome/cpf/rg/endereco... descrevem o representante).
const CONTRATANTE_FIELDS_PJ = ['razaoSocial', 'cnpj', 'emailEmpresa', 'cepEmpresa', 'ufEmpresa', 'enderecoEmpresa', 'numeroEmpresa', 'bairroEmpresa', 'cidadeEmpresa', 'nome', 'nacionalidade', 'profissao', 'estadoCivil', 'rg', 'cpf', 'email', 'dataNascimento', 'telefone', 'linkKommo', 'cep', 'uf', 'endereco', 'numero', 'bairro', 'cidade'];

function contratanteFields(c) {
  return (c?.tipo === 'pj') ? CONTRATANTE_FIELDS_PJ : CONTRATANTE_FIELDS_PF;
}

function checkContratanteComplete(c) {
  return contratanteFields(c).every(f => !!(c[f]));
}

function countContratanteFields(c) {
  return contratanteFields(c).filter(f => !!(c[f])).length;
}

function useFormProgress(data) {
  return useMemo(() => {
    const sections = [];
    // Contratantes
    const nc = data.numContratantes;
    if (nc > 0) {
      const allDone = data.contratantes.slice(0, nc).every(checkContratanteComplete);
      const totalFields = data.contratantes.slice(0, nc).reduce((sum, c) => sum + contratanteFields(c).length, 0);
      const filledFields = data.contratantes.slice(0, nc).reduce((sum, c) => sum + countContratanteFields(c), 0);
      sections.push({ label: 'Contratantes', done: allDone, filled: filledFields, total: totalFields, iconKey: 'user' });
    } else {
      sections.push({ label: 'Contratantes', done: false, filled: 0, total: 1, iconKey: 'user' });
    }
    // Resort + Acao
    const resortOk = data.resort && (data.resort !== 'outro' || data.resortCustom);
    const acaoOk = data.tipoAcao && (data.tipoAcao !== 'outro' || data.tipoAcaoCustom);
    const resortFilled = (resortOk ? 1 : 0) + (acaoOk ? 1 : 0);
    sections.push({ label: 'Resort', done: !!(resortOk && acaoOk), filled: resortFilled, total: 2, iconKey: 'resort' });
    // Honorarios
    const h = data.honorarios;
    const hFields = [];
    if (!h.somenteExito) hFields.push(h.total > 0, h.parcelas > 0, !!h.dataPrimeiraParcela);
    if (!h.somenteIniciais) hFields.push(h.percentualExito > 0);
    if (h.somenteExito) hFields.push(h.percentualExito > 0);
    if (h.somenteIniciais) hFields.push(h.total > 0, h.parcelas > 0, !!h.dataPrimeiraParcela);
    const hFilled = hFields.filter(Boolean).length;
    const hTotal = hFields.length || 1;
    const honorariosDone = hFilled === hTotal;
    sections.push({ label: 'Honorarios', done: honorariosDone, filled: hFilled, total: hTotal, iconKey: 'money' });
    // Clausulas always ok
    sections.push({ label: 'Clausulas', done: true, filled: 1, total: 1, iconKey: 'clipboard' });
    // Dados Internos
    const intFields = [!!data.origemCliente, !!data.dataPrimeiraMensagem, !!(data.linkGoogleDrive?.trim())];
    const intFilled = intFields.filter(Boolean).length;
    sections.push({ label: 'Internos', done: intFilled === intFields.length, filled: intFilled, total: intFields.length, icon: 'ℹ️' });
    return sections;
  }, [data]);
}

// ─── Top 30 profissões mais comuns ───
const PROFISSOES_COMUNS = [
  'Empresário(a)', 'Autônomo(a)', 'Aposentado(a)', 'Do Lar', 'Professor(a)',
  'Advogado(a)', 'Engenheiro(a)', 'Médico(a)', 'Enfermeiro(a)', 'Vendedor(a)',
  'Contador(a)', 'Administrador(a)', 'Funcionário(a) Público(a)', 'Servidor(a) Público(a)',
  'Comerciante', 'Motorista', 'Bancário(a)', 'Técnico(a)', 'Policial Militar',
  'Dentista', 'Psicólogo(a)', 'Corretor(a)', 'Consultor(a)', 'Analista',
  'Programador(a)', 'Eletricista', 'Mecânico(a)', 'Agricultor(a)', 'Estudante',
  'Desempregado(a)',
];

// ─── Circular Progress ───
function ConflictDetector() {
  const { data, getClausulaTexto, isClausulaModificada } = useContract();
  const conflicts = useMemo(() => detectConflicts(data, getClausulaTexto, isClausulaModificada), [data]);

  if (!conflicts.length) return null;

  return (
    <div className="px-3 pt-3">
      <div className="space-y-1.5">
        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {conflicts.length} conflito(s) detectado(s)
        </div>
        {conflicts.map((c, i) => {
          const color = getConflictColor(c.severity);
          return (
            <div key={i} className="p-2.5 rounded-lg text-[11px] leading-snug" style={{ background: color.bg, border: `1px solid ${color.border}` }}>
              <div className="flex items-start gap-1.5">
                <ConflictIcon iconKey={color.icon} className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: color.text }} />
                <div>
                  <div className="font-medium" style={{ color: color.text }}>{c.message}</div>
                  <div className="text-[10px] mt-0.5 opacity-70" style={{ color: color.text }}>{c.fix}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CircularProgress({ percent }) {
  const r = 16, c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" className="progress-circle">
      <circle cx="21" cy="21" r={r} fill="none" stroke="#E5E7EB" strokeWidth="3" />
      <circle cx="21" cy="21" r={r} fill="none" stroke="#22C55E" strokeWidth="3"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      <text x="21" y="21" textAnchor="middle" dy="0.35em" fontSize="10" fontWeight="bold" fill="#1B3A5C"
        style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>{percent}%</text>
    </svg>
  );
}

// ─── Section Icons (Heroicons components) ───
const SECTION_ICONS = {
  'Contratantes': <UserIcon className="w-4 h-4" aria-hidden="true" />,
  'Resort': <BuildingOffice2Icon className="w-4 h-4" aria-hidden="true" />,
  'Honorarios Advocaticios': <CurrencyDollarIcon className="w-4 h-4" aria-hidden="true" />,
  'Clausulas': <ClipboardDocumentListIcon className="w-4 h-4" aria-hidden="true" />,
  'Informacoes Internas': <InformationCircleIcon className="w-4 h-4" aria-hidden="true" />,
};

// Mini icons (12px) para progress chips
const PROGRESS_ICON_MAP = {
  user: UserIcon,
  resort: BuildingOffice2Icon,
  money: CurrencyDollarIcon,
  clipboard: ClipboardDocumentListIcon,
};
function ProgressIcon({ iconKey, done }) {
  if (done) return <CheckCircleIcon className="w-3 h-3 text-green-600" aria-hidden="true" />;
  const Cmp = PROGRESS_ICON_MAP[iconKey];
  if (!Cmp) return null;
  return <Cmp className="w-3 h-3" aria-hidden="true" />;
}

// ─── Tooltip ───
function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-[9px] text-white whitespace-nowrap z-50"
          style={{ background: '#1B3A5C', animation: 'fadeIn 0.15s ease' }}>
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent" style={{ borderTopColor: '#1B3A5C' }} />
        </span>
      )}
    </span>
  );
}

// ─── Section with animated accordion ───
function Section({ title, children, defaultOpen = true, dark = false, done, icon, filled, total, id }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef(null);
  const [maxH, setMaxH] = useState(defaultOpen ? '5000px' : '0px');

  useEffect(() => {
    if (open) {
      setMaxH(contentRef.current ? `${contentRef.current.scrollHeight + 100}px` : '5000px');
    } else {
      setMaxH('0px');
    }
  }, [open]);

  // Update maxH when content changes while open
  useEffect(() => {
    if (open && contentRef.current) {
      const observer = new MutationObserver(() => {
        setMaxH(`${contentRef.current.scrollHeight + 100}px`);
      });
      observer.observe(contentRef.current, { childList: true, subtree: true, attributes: true });
      return () => observer.disconnect();
    }
  }, [open]);

  return (
    <div className="card mb-3" id={id}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer text-white sticky top-0 z-[8]"
        style={{ background: dark ? '#0F2035' : '#1B3A5C' }}
      >
        <div className="flex items-center gap-2">
          {icon && (
            typeof icon === 'string'
              ? <span className="text-sm">{icon}</span>
              : <span className="flex items-center">{icon}</span>
          )}
          {done !== undefined && (
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-300 ${done ? 'bg-green-400' : 'bg-red-400'}`} />
          )}
          <span className="text-[11px] font-bold uppercase tracking-[1px]">{title}</span>
          {filled !== undefined && total !== undefined && total > 0 && (
            <span className={`text-[9px] font-bold ml-1.5 px-1.5 py-0.5 rounded-full ${done ? 'bg-green-400/20 text-green-200' : 'bg-white/10 text-white/60'}`}>
              {filled}/{total}
            </span>
          )}
        </div>
        <span className={`text-white/60 transition-transform duration-300 text-xs ${open ? 'rotate-180' : ''}`}>&#9662;</span>
      </button>
      <div ref={contentRef} className="section-content" style={{ maxHeight: maxH, padding: open ? undefined : 0 }}>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Contratante Form ───
// ─── Real-time field validation ───
function useFieldValidation(value, type) {
  return useMemo(() => {
    if (!value || value.length === 0) return '';
    switch (type) {
      case 'cpf': {
        const d = value.replace(/\D/g, '');
        if (d.length < 11) return '';
        if (/^(\d)\1{10}$/.test(d)) return 'invalid';
        let s = 0; for (let i = 0; i < 9; i++) s += parseInt(d[i]) * (10 - i);
        let r = (s * 10) % 11; if (r >= 10) r = 0; if (r !== parseInt(d[9])) return 'invalid';
        s = 0; for (let i = 0; i < 10; i++) s += parseInt(d[i]) * (11 - i);
        r = (s * 10) % 11; if (r >= 10) r = 0; if (r !== parseInt(d[10])) return 'invalid';
        return 'valid';
      }
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'valid' : value.includes('@') ? '' : '';
      case 'cep': return value.replace(/\D/g, '').length === 8 ? 'valid' : '';
      case 'nome': return value.trim().split(/\s+/).length >= 2 ? 'valid' : '';
      case 'phone': { const d = value.replace(/\D/g, ''); return d.length >= 10 ? 'valid' : ''; }
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'valid' : '';
      case 'url': return value.startsWith('http') ? 'valid' : '';
      default: return value.trim().length > 0 ? 'valid' : '';
    }
  }, [value, type]);
}

function ValidationIcon({ status }) {
  if (status === 'valid') return <span className="text-green-500 text-xs ml-1">&#10003;</span>;
  if (status === 'invalid') return <span className="text-red-500 text-xs ml-1">&#10007;</span>;
  return null;
}

// (perf-fe-4) Implementacao crua — embrulhada em React.memo abaixo (ContratanteForm).
// Os handlers vindos do contexto (onChange/updateContratante) ja sao useCallback estaveis,
// entao ao digitar num contratante o outro nao re-renderiza.
function ContratanteFormBase({ index, contratante, onChange, errors, otherContratante, numContratantes }) {
  const toast = useToast(); // (ux-3) movido p/ cima — usado no aviso de SEM_CREDITOS do CPF
  const [cpfStatus, setCpfStatus] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrStatus, setOcrStatus] = useState(''); // 'success' | 'error' | ''
  const [ocrFields, setOcrFields] = useState({}); // track which fields were filled by OCR
  // (#97) Progresso granular de OCR: { phase, value, label }
  const [ocrProgress, setOcrProgress] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef(null);
  // (#35) CEP autocomplete — hook com cache + validacao
  const { lookup: cepLookup, loading: cepLoading, error: cepError } = useCepLookup();
  // Rastreia campos que o usuario editou manualmente apos preenchimento de CEP (nao sobrescrever)
  const manualEditsRef = useRef({ endereco: false, bairro: false, cidade: false, uf: false });
  // Debounce timer para lookup automatico ao completar CEP
  const cepDebounceRef = useRef(null);
  // Ultimo CEP ja consultado (evita lookups duplicados ao tabular)
  const lastLookedCepRef = useRef('');

  // Name autocomplete from contract history
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameSearchRef = useRef(null);
  const nameInputRef = useRef(null);

  const searchClientByName = useCallback(async (query) => {
    if (!query || query.trim().length < 3) { setNameSuggestions([]); return; }
    if (nameSearchRef.current) clearTimeout(nameSearchRef.current);
    nameSearchRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('contratos')
          .select('dados, nome_contratante1, nome_contratante2, cpf_contratante1, resort')
          .or(`nome_contratante1.ilike.%${query.trim()}%,nome_contratante2.ilike.%${query.trim()}%`)
          .order('created_at', { ascending: false })
          .limit(5);
        if (data && data.length > 0) {
          const results = [];
          const seen = new Set();
          for (const row of data) {
            const contratantes = row.dados?.contratantes || [];
            for (const c of contratantes) {
              if (c?.nome && c.nome.toLowerCase().includes(query.trim().toLowerCase())) {
                const key = (c.cpf || '').replace(/\D/g, '') + c.nome;
                if (!seen.has(key)) {
                  seen.add(key);
                  results.push({ ...c, resort: row.resort });
                }
              }
            }
          }
          setNameSuggestions(results.slice(0, 5));
          setShowSuggestions(results.length > 0);
        } else {
          setNameSuggestions([]);
        }
      } catch { setNameSuggestions([]); }
    }, 300);
  }, []);

  const fillFromClient = useCallback((client) => {
    const updates = {};
    const allFields = ['nome', 'sexo', 'nacionalidade', 'profissao', 'estadoCivil', 'rg', 'cpf', 'email', 'dataNascimento', 'telefone', 'linkKommo', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep',
      // (PJ 25/06) traz tambem os dados da empresa quando o cliente historico for PJ
      'tipo', 'razaoSocial', 'cnpj', 'emailEmpresa', 'enderecoEmpresa', 'numeroEmpresa', 'complementoEmpresa', 'bairroEmpresa', 'cidadeEmpresa', 'ufEmpresa', 'cepEmpresa'];
    for (const f of allFields) {
      if (f === 'tipo') { updates.tipo = client.tipo || 'pf'; continue; }
      updates[f] = client[f] || ''; // Always set — clears complemento if source is empty
    }
    onChange(index, updates);
    setShowSuggestions(false);
    setNameSuggestions([]);
  }, [index, onChange]);

  // Real-time validation
  const vNome = useFieldValidation(contratante.nome, 'nome');
  const vCpf = useFieldValidation(contratante.cpf, 'cpf');
  const vEmail = useFieldValidation(contratante.email, 'email');
  const vCep = useFieldValidation(contratante.cep, 'cep');
  const vRg = useFieldValidation(contratante.rg, 'text');

  const handle = (field, value) => {
    // Clear OCR highlight when user manually edits
    if (ocrFields[field]) setOcrFields(prev => { const n = { ...prev }; delete n[field]; return n; });
    // (#35) Marca edicao manual de campos de endereco — para nao sobrescrever em lookups futuros
    if (field in manualEditsRef.current) {
      manualEditsRef.current[field] = true;
    }
    // Se o usuario alterou o CEP, reseta os flags de edicao manual e o cache do ultimo lookup
    if (field === 'cep') {
      manualEditsRef.current = { endereco: false, bairro: false, cidade: false, uf: false };
      lastLookedCepRef.current = '';
    }
    const updates = { [field]: value };
    // Auto-detect gender when name changes
    if (field === 'nome' && value.trim().split(/\s+/).length >= 1) {
      const genderUpdates = getGenderUpdates(value, contratante);
      Object.assign(updates, genderUpdates);
    }
    onChange(index, updates);
  };

  // (PJ 25/06) setter simples dos campos da empresa (sem deteccao de genero/CEP do rep)
  const handleEmpresa = (field, value) => onChange(index, { [field]: value });

  // (PJ) Busca automatica de CNPJ (BrasilAPI) — preenche razao social + endereco da empresa.
  const [cnpjStatus, setCnpjStatus] = useState(''); // '', 'loading', 'found', 'notfound'
  const lastLookedCnpjRef = useRef('');
  const handleCNPJLookup = useCallback(async () => {
    const clean = (contratante.cnpj || '').replace(/\D/g, '');
    if (clean.length !== 14) return;
    if (lastLookedCnpjRef.current === clean) return;
    lastLookedCnpjRef.current = clean;
    setCnpjStatus('loading');
    const result = await lookupCNPJ(contratante.cnpj);
    if (!result) { setCnpjStatus('notfound'); setTimeout(() => setCnpjStatus(''), 4000); return; }
    const updates = {};
    // nao sobrescreve o que o usuario ja preencheu manualmente
    const setIfEmpty = (k) => { if (result[k] && !contratante[k]) updates[k] = result[k]; };
    ['razaoSocial', 'enderecoEmpresa', 'numeroEmpresa', 'complementoEmpresa', 'bairroEmpresa', 'cidadeEmpresa', 'ufEmpresa', 'cepEmpresa', 'emailEmpresa'].forEach(setIfEmpty);
    if (Object.keys(updates).length) onChange(index, updates);
    setCnpjStatus('found');
    setTimeout(() => setCnpjStatus(''), 4000);
  }, [contratante, index, onChange]);

  // (PJ) lookup de CEP da empresa (reaproveita useCepLookup; sem UI de loading propria)
  const handleCepEmpresaLookup = useCallback(async () => {
    const clean = (contratante.cepEmpresa || '').replace(/\D/g, '');
    if (clean.length !== 8) return;
    const result = await cepLookup(contratante.cepEmpresa);
    if (!result) return;
    const updates = {};
    if (result.endereco && !contratante.enderecoEmpresa) updates.enderecoEmpresa = result.endereco;
    if (result.bairro && !contratante.bairroEmpresa) updates.bairroEmpresa = result.bairro;
    if (result.cidade && !contratante.cidadeEmpresa) updates.cidadeEmpresa = result.cidade;
    if (result.uf && !contratante.ufEmpresa) updates.ufEmpresa = result.uf;
    if (Object.keys(updates).length) onChange(index, updates);
  }, [contratante, cepLookup, index, onChange]);

  // OCR highlight: returns class if field was recently filled by OCR
  const ocrClass = (field) => ocrFields[field] ? 'ocr-highlight' : '';

  // Drag & drop handlers
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      processCNHFile(file);
    }
  }, []);

  const processCNHFile = useCallback(async (file) => {
    setOcrLoading(true);
    setOcrStatus('');
    setOcrProgress({ phase: 'upload', value: 0, label: 'Iniciando...' });
    try {
      // (#97) Callback de progresso granular: upload -> pdf -> ocr
      const { extractTextFromFile } = await import('../utils/ocrService');
      const data = await extractTextFromFile(file, {
        onProgress: (p) => setOcrProgress(p),
      });
      console.log('OCR response:', data);
      const updates = {};
      const filledFields = {};
      const fieldMap = { nome: 'nome', cpf: 'cpf', rg: 'rg', nacionalidade: 'nacionalidade', email: 'email', estadoCivil: 'estadoCivil', profissao: 'profissao', endereco: 'endereco', bairro: 'bairro', cidade: 'cidade', uf: 'uf', cep: 'cep' };
      for (const [key, field] of Object.entries(fieldMap)) {
        if (data[key] && (key === 'nacionalidade' ? data[key] !== 'brasileiro(a)' : true)) {
          updates[field] = data[key];
          filledFields[field] = true;
        }
      }
      // (#29) data de nascimento: o OCR devolve "nascimento" em dd/mm/yyyy; o input date
      // espera yyyy-mm-dd. Antes nao estava no fieldMap e o valor era descartado.
      if (data.nascimento) {
        const m = String(data.nascimento).match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
        if (m) { updates.dataNascimento = `${m[3]}-${m[2]}-${m[1]}`; filledFields.dataNascimento = true; }
      }
      if (Object.keys(updates).length > 0) {
        onChange(index, updates);
        setOcrFields(filledFields);
        setOcrStatus('success');
        // Clear OCR highlights after 3 seconds
        setTimeout(() => setOcrFields({}), 3000);
      } else {
        console.warn('OCR: nenhum campo extraido. Raw text:', data.rawText?.substring(0, 300));
        setOcrStatus('error');
      }
    } catch {
      setOcrStatus('error');
    } finally {
      setOcrLoading(false);
      // Manter barra visivel por breve momento para feedback
      setTimeout(() => setOcrProgress(null), 700);
      setTimeout(() => setOcrStatus(''), 4000);
    }
  }, [index, onChange]);

  const handleCNHUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) processCNHFile(file);
    e.target.value = '';
  }, [processCNHFile]);

  // (#35) Aplica resultado do lookup respeitando edicoes manuais (cidade/UF etc.)
  const applyCepResult = useCallback((result) => {
    if (!result) return;
    const manual = manualEditsRef.current;
    const updates = {};
    const filled = {};
    if (result.endereco && !manual.endereco) { updates.endereco = result.endereco; filled.endereco = true; }
    if (result.bairro && !manual.bairro) { updates.bairro = result.bairro; filled.bairro = true; }
    if (result.cidade && !manual.cidade) { updates.cidade = result.cidade; filled.cidade = true; }
    if (result.uf && !manual.uf) { updates.uf = result.uf; filled.uf = true; }
    if (Object.keys(updates).length > 0) {
      onChange(index, updates);
      // Pulse visual nos campos auto-preenchidos (2s)
      setOcrFields(prev => ({ ...prev, ...filled }));
      setTimeout(() => setOcrFields(prev => {
        const n = { ...prev };
        for (const k of Object.keys(filled)) delete n[k];
        return n;
      }), 2100);
    }
  }, [index, onChange]);

  const handleCEPLookup = useCallback(async () => {
    const cep = contratante.cep;
    const clean = (cep || '').replace(/\D/g, '');
    if (clean.length !== 8) return;
    if (lastLookedCepRef.current === clean) return; // evita repetir
    lastLookedCepRef.current = clean;
    const result = await cepLookup(cep);
    if (result) applyCepResult(result);
  }, [contratante.cep, cepLookup, applyCepResult]);

  // Smart Tab: dispara lookup ao pressionar Tab em CEP completo
  const handleCEPKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      const cep = contratante.cep;
      if (cep && cep.replace(/\D/g, '').length === 8) {
        handleCEPLookup();
      }
    }
  }, [contratante.cep, handleCEPLookup]);

  // (#35) Auto-lookup com debounce de 300ms ao completar 8 digitos
  useEffect(() => {
    const clean = (contratante.cep || '').replace(/\D/g, '');
    if (cepDebounceRef.current) { clearTimeout(cepDebounceRef.current); cepDebounceRef.current = null; }
    if (clean.length !== 8) return;
    if (lastLookedCepRef.current === clean) return;
    cepDebounceRef.current = setTimeout(() => {
      handleCEPLookup();
    }, 300);
    return () => {
      if (cepDebounceRef.current) { clearTimeout(cepDebounceRef.current); cepDebounceRef.current = null; }
    };
  }, [contratante.cep, handleCEPLookup]);

  // Smart Tab: auto-trigger CPF validation on Tab keydown.
  // (varredura 15/06) funcao simples (nao memoizada) p/ sempre fechar sobre o
  // handleCPFValidate atual — antes era useCallback com deps [contratante.cpf],
  // mas handleCPFValidate depende tambem de nome/index/onChange: ao mudar so o
  // nome, o Tab chamava uma versao defasada do validador (stale closure).
  const handleCPFKeyDown = (e) => {
    if (e.key === 'Tab') {
      const cpf = contratante.cpf;
      if (cpf && cpf.replace(/\D/g, '').length === 11) {
        handleCPFValidate();
      }
    }
  };

  const handleCPFValidate = useCallback(async () => {
    const cpf = contratante.cpf;
    if (!cpf || cpf.replace(/\D/g, '').length !== 11) return;
    setCpfStatus('loading');

    // 1) Primeiro: buscar no histórico do Supabase (grátis, sem gastar crédito)
    try {
      const cpfClean = cpf.replace(/\D/g, '');
      const cpfFormatted = cpf;
      const { data: historico } = await supabase
        .from('contratos')
        .select('dados')
        .or(`cpf_contratante1.eq.${cpfClean},cpf_contratante1.eq.${cpfFormatted},cpf_contratante2.eq.${cpfClean},cpf_contratante2.eq.${cpfFormatted}`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (historico?.length > 0 && historico[0].dados) {
        const d = historico[0].dados;
        // Find which contratante matches this CPF
        const contratantes = d.contratantes || [];
        const match = contratantes.find(c => c?.cpf?.replace(/\D/g, '') === cpfClean);
        if (match && match.nome) {
          setCpfStatus('history');
          setTimeout(() => setCpfStatus(''), 5000);
          const updates = {};
          const allFields = ['nome', 'sexo', 'nacionalidade', 'profissao', 'estadoCivil', 'rg', 'email', 'dataNascimento', 'telefone', 'linkKommo', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'];
          for (const f of allFields) { updates[f] = match[f] || ''; }
          onChange(index, updates);
          return;
        }
      }
    } catch { /* ignore - fallback to API */ }

    // 2) Depois: chamar API de CPF (gasta crédito)
    const result = await lookupCPF(cpf);
    if (result?.error === 'SEM_CREDITOS') {
      // (ux-3) Sem creditos: NAO marcar como valido (bolinha verde falsa) — estado neutro
      // de aviso + toast amarelo discreto (sem alert bloqueante).
      setCpfStatus('sem_creditos');
      setTimeout(() => setCpfStatus(''), 5000);
      toast.warning('Consulta de CPF sem creditos — preencha o nome manualmente. Avisar o Bruno p/ recarregar.');
      return;
    }
    if (!result?.valid) {
      setCpfStatus('invalid');
      setTimeout(() => setCpfStatus(''), 3000);
      return;
    }
    setCpfStatus('valid');
    setTimeout(() => setCpfStatus(''), 5000);
    if (result.nome) {
      onChange(index, { nome: result.nome });
    }
  }, [contratante.cpf, contratante.nome, index, onChange]);

  // (#34) Copia rapida do contratante 1 — varios escopos
  const copyFrom = (fields, label) => {
    if (!otherContratante) return;
    const updates = {};
    let count = 0;
    for (const f of fields) {
      const v = otherContratante[f];
      if (v != null && v !== '') { updates[f] = v; count++; }
    }
    if (count === 0) {
      toast.warning(`Contratante 1 nao tem ${label} preenchido`);
      return;
    }
    onChange(index, updates);
    toast.success(`${label} copiado do Contratante 1`);
  };
  const handleCopyAll = () => copyFrom(
    ['sexo','nacionalidade','profissao','estadoCivil','email','telefone','linkKommo','cep','uf','endereco','numero','complemento','bairro','cidade'],
    'Todos os dados'
  );
  const handleCopyAddress = () => copyFrom(
    ['cep','uf','endereco','numero','complemento','bairro','cidade'],
    'Endereco'
  );
  const handleCopyContact = () => copyFrom(['telefone','linkKommo'], 'Telefone + Kommo');
  const handleCopyEmail = () => copyFrom(['email'], 'E-mail');
  const handleCopySocial = () => copyFrom(['sexo','nacionalidade','profissao','estadoCivil'], 'Dados sociais');

  const showCopyOptions = index === 1 && numContratantes === 2 && (otherContratante?.endereco || otherContratante?.telefone || otherContratante?.email);

  return (
    <div className="mb-3" ref={dropRef} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* Drag & Drop Zone */}
      {dragging && (
        <div className="drop-zone active rounded-xl p-6 mb-3 flex flex-col items-center justify-center gap-2 text-center">
          <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span className="text-sm font-bold text-blue-600">Solte a CNH aqui</span>
          <span className="text-[10px] text-gray-500">PDF ou imagem</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold uppercase tracking-[1px]" style={{ color: '#1B3A5C' }}>
          Contratante {index + 1}
        </div>
        <div className="flex items-center gap-2">
          {/* (mobile 06/2026) max-[1366px]: alvo ≥44px em touch — era ~22px */}
          <label className={`flex items-center gap-1 px-2 py-1 max-[1366px]:min-h-[44px] max-[1366px]:px-3 max-[1366px]:text-[11px] rounded-md text-[9px] font-bold uppercase tracking-wide cursor-pointer transition-all ${
            ocrLoading ? 'bg-gray-200 text-gray-600' : ocrStatus === 'success' ? 'bg-green-100 text-green-800' : ocrStatus === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
          }`}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {ocrLoading ? 'Lendo...' : ocrStatus === 'success' ? 'Extraido!' : ocrStatus === 'error' ? 'Erro' : 'CNH'}
            <input type="file" accept="image/*,.pdf,application/pdf" className="hidden" onChange={handleCNHUpload} disabled={ocrLoading} />
          </label>
          {checkContratanteComplete(contratante) && (
            <span className="text-green-600 text-[10px] font-bold uppercase">Completo</span>
          )}
        </div>
      </div>
      {/* (#97) Progress bar granular durante OCR */}
      {(ocrLoading || ocrProgress) && ocrProgress && (
        <div className='mb-3 p-2.5 rounded-lg bg-blue-50/60 border border-blue-200'>
          <ProgressBar
            value={ocrProgress.value || 0}
            label={ocrProgress.label || 'Processando...'}
            color={ocrProgress.phase === 'upload' ? '#2563EB' : ocrProgress.phase === 'pdf' ? '#7C3AED' : '#1B3A5C'}
            size='sm'
          />
          <div className='flex items-center gap-2 mt-1.5'>
            {['upload', 'pdf', 'ocr'].map((ph) => {
              const currentPhase = ocrProgress.phase;
              const phaseOrder = { upload: 0, pdf: 1, ocr: 2 };
              const isActive = ph === currentPhase;
              const isDone = phaseOrder[ph] < phaseOrder[currentPhase];
              return (
                <div key={ph} className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide ${
                  isDone ? 'text-green-600' : isActive ? 'text-blue-600' : 'text-gray-400'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isDone ? 'bg-green-500' : isActive ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`} />
                  {ph === 'upload' ? 'Arquivo' : ph === 'pdf' ? 'PDF' : 'OCR'}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* (PJ 25/06) Tipo de contratante: Pessoa Fisica x Pessoa Juridica (Empresa) */}
      <div className="flex gap-2 mb-3">
        {[{ v: 'pf', label: 'Pessoa Fisica' }, { v: 'pj', label: 'Pessoa Juridica (Empresa)' }].map((opt) => (
          <button key={opt.v} type="button"
            onClick={() => onChange(index, { tipo: opt.v })}
            className={`flex-1 py-2 max-[1366px]:min-h-[44px] rounded-lg border-2 text-[11px] font-bold uppercase tracking-wide transition-all cursor-pointer ${
              (contratante.tipo || 'pf') === opt.v ? 'text-white border-transparent' : 'border-gray-200 text-gray-500 hover:border-navy/30'
            }`}
            style={(contratante.tipo || 'pf') === opt.v ? { background: '#1B3A5C' } : {}}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* (PJ) Bloco de dados da empresa — so quando Pessoa Juridica */}
      {contratante.tipo === 'pj' && (
        <div className="mb-3 rounded-lg border border-gray-200 p-3" style={{ background: '#F7F9FC' }}>
          <div className="flex items-center gap-1.5 mb-2.5 text-[11px] font-bold uppercase tracking-[1px]" style={{ color: '#1B3A5C' }}>
            <BuildingOffice2Icon className="w-4 h-4" aria-hidden="true" /> Dados da Empresa
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <label className="label-field">CNPJ *
                {cnpjStatus === 'loading' && <span className="text-blue-500 text-[9px] ml-1 animate-pulse normal-case">buscando...</span>}
                {cnpjStatus === 'found' && <span className="text-green-600 text-[9px] ml-1 font-bold normal-case">&#9733; Empresa encontrada</span>}
                {cnpjStatus === 'notfound' && <span className="text-amber-600 text-[9px] ml-1 font-bold normal-case">nao encontrado — preencha manualmente</span>}
              </label>
              <input className={`input-field ${errors.cnpj ? 'input-error' : ''}`}
                value={contratante.cnpj || ''} onChange={(e) => handleEmpresa('cnpj', maskCNPJ(e.target.value))}
                onBlur={handleCNPJLookup} placeholder="00.000.000/0000-00" inputMode="numeric" autoComplete="off" enterKeyHint="next" />
            </div>
            <div className="col-span-2">
              <label className="label-field">Razao Social *</label>
              <input className={`input-field ${errors.razaoSocial ? 'input-error' : ''}`}
                value={contratante.razaoSocial || ''} onChange={(e) => handleEmpresa('razaoSocial', e.target.value)} placeholder="Razao social da empresa" enterKeyHint="next" />
            </div>
            <div className="col-span-2">
              <label className="label-field">E-mail da Empresa *</label>
              <input className={`input-field ${errors.emailEmpresa ? 'input-error' : ''}`} type="email"
                inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="next"
                value={contratante.emailEmpresa || ''} onChange={(e) => handleEmpresa('emailEmpresa', e.target.value)} placeholder="empresa@exemplo.com" />
            </div>
            <div>
              <label className="label-field">CEP da Empresa *</label>
              <input className={`input-field ${errors.cepEmpresa ? 'input-error' : ''}`}
                value={contratante.cepEmpresa || ''} onChange={(e) => handleEmpresa('cepEmpresa', maskCEP(e.target.value))}
                onBlur={handleCepEmpresaLookup} placeholder="00000-000" inputMode="numeric" autoComplete="off" />
            </div>
            <div>
              <label className="label-field">UF *</label>
              <input className={`input-field ${errors.ufEmpresa ? 'input-error' : ''}`}
                value={contratante.ufEmpresa || ''} onChange={(e) => handleEmpresa('ufEmpresa', e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" maxLength={2}
                autoCapitalize="characters" autoCorrect="off" enterKeyHint="next" />
            </div>
            <div className="col-span-2">
              <label className="label-field">Endereco (Rua) *</label>
              <input className={`input-field ${errors.enderecoEmpresa ? 'input-error' : ''}`}
                value={contratante.enderecoEmpresa || ''} onChange={(e) => handleEmpresa('enderecoEmpresa', e.target.value)} placeholder="Rua / Avenida" enterKeyHint="next" />
            </div>
            <div>
              <label className="label-field">Numero *</label>
              <input className={`input-field ${errors.numeroEmpresa ? 'input-error' : ''}`}
                value={contratante.numeroEmpresa || ''} onChange={(e) => handleEmpresa('numeroEmpresa', e.target.value)} placeholder="123" inputMode="numeric" enterKeyHint="next" />
            </div>
            <div>
              <label className="label-field">Complemento</label>
              <input className="input-field"
                value={contratante.complementoEmpresa || ''} onChange={(e) => handleEmpresa('complementoEmpresa', e.target.value)} placeholder="Sala, Andar..." />
            </div>
            <div>
              <label className="label-field">Bairro *</label>
              <input className={`input-field ${errors.bairroEmpresa ? 'input-error' : ''}`}
                value={contratante.bairroEmpresa || ''} onChange={(e) => handleEmpresa('bairroEmpresa', e.target.value)} placeholder="Bairro" enterKeyHint="next" />
            </div>
            <div>
              <label className="label-field">Cidade *</label>
              <input className={`input-field ${errors.cidadeEmpresa ? 'input-error' : ''}`}
                value={contratante.cidadeEmpresa || ''} onChange={(e) => handleEmpresa('cidadeEmpresa', e.target.value)} placeholder="Cidade" enterKeyHint="next" />
            </div>
          </div>
        </div>
      )}

      {/* (PJ) Divisor: os campos abaixo descrevem o representante legal quando PJ */}
      {contratante.tipo === 'pj' && (
        <div className="flex items-center gap-2 mb-2 text-[11px] font-bold uppercase tracking-[1px]" style={{ color: '#1B3A5C' }}>
          <UserIcon className="w-4 h-4" aria-hidden="true" /> Representante Legal
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="label-field">CPF *
            {cpfStatus === 'loading' && <span className="text-blue-500 text-[9px] ml-1 animate-pulse">buscando...</span>}
            {cpfStatus === 'history' && <span className="text-purple-600 text-[9px] ml-1 font-bold">&#9733; Cliente encontrado</span>}
            {/* (ux-3) Aviso discreto de consulta sem creditos — nem verde nem erro */}
            {cpfStatus === 'sem_creditos' && <span className="text-amber-600 text-[9px] ml-1 font-bold normal-case">sem creditos — preencha o nome</span>}
            {cpfStatus !== 'loading' && cpfStatus !== 'history' && cpfStatus !== 'sem_creditos' && <ValidationIcon status={vCpf} />}
          </label>
          <input className={`input-field ${ocrClass('cpf')} ${errors.cpf ? 'input-error' : vCpf === 'valid' ? 'input-valid' : vCpf === 'invalid' ? 'input-invalid' : ''}`}
            value={contratante.cpf} onChange={(e) => handle('cpf', maskCPF(e.target.value))}
            onBlur={handleCPFValidate} onKeyDown={handleCPFKeyDown} placeholder="000.000.000-00" autoFocus={index === 0}
            inputMode="numeric" autoComplete="off" enterKeyHint="next" />
        </div>
        <div>
          <label className="label-field">RG * <ValidationIcon status={vRg} /></label>
          <input className={`input-field ${ocrClass('rg')} ${errors.rg ? 'input-error' : ''}`}
            value={contratante.rg} onChange={(e) => handle('rg', maskRG(e.target.value))} placeholder="Numero do RG"
            inputMode="numeric" enterKeyHint="next" />
        </div>
        <div className="col-span-2 relative">
          <label className="label-field">Nome Completo * <ValidationIcon status={vNome} /></label>
          <input ref={nameInputRef}
            className={`input-field ${ocrClass('nome')} ${errors.nome ? 'input-error' : vNome === 'valid' ? 'input-valid' : ''}`}
            value={contratante.nome}
            onChange={(e) => { handle('nome', e.target.value); searchClientByName(e.target.value); }}
            onFocus={() => { if (nameSuggestions.length > 0) setShowSuggestions(true); }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="Nome completo — digite para buscar clientes anteriores"
            autoComplete="off" enterKeyHint="next" />
          {showSuggestions && nameSuggestions.length > 0 && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden" style={{ maxHeight: '220px', overflowY: 'auto' }}>
              <div className="px-3 py-1.5 bg-purple-50 border-b border-purple-100">
                <span className="text-[9px] font-bold uppercase text-purple-600 tracking-wide">Clientes encontrados no historico</span>
              </div>
              {nameSuggestions.map((s, i) => (
                <button key={i}
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-blue-50 cursor-pointer transition-colors border-b border-gray-100 last:border-0"
                  onMouseDown={(e) => { e.preventDefault(); fillFromClient(s); }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-gray-800">{s.nome}</span>
                      <span className="text-[10px] text-gray-400 ml-2">{s.cpf}</span>
                    </div>
                    <span className="text-[9px] font-bold text-purple-500 uppercase px-2 py-0.5 rounded-full bg-purple-50">Preencher</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {[s.email, s.cidade && `${s.cidade}/${s.uf}`, s.resort].filter(Boolean).join(' · ')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="label-field">Sexo *</label>
          <select className={`input-field ${errors.sexo ? 'input-error' : ''}`}
            value={contratante.sexo || ''} onChange={(e) => {
              const sexo = e.target.value;
              const updates = { sexo };
              // Auto-ajustar nacionalidade
              if (sexo === 'M' && (contratante.nacionalidade === 'brasileiro(a)' || contratante.nacionalidade === 'brasileira')) updates.nacionalidade = 'brasileiro';
              if (sexo === 'F' && (contratante.nacionalidade === 'brasileiro(a)' || contratante.nacionalidade === 'brasileiro')) updates.nacionalidade = 'brasileira';
              // (varredura 15/06) removido o auto-ajuste de genero do estado civil:
              // ESTADOS_CIVIS so tem formas neutras ('Casado(a)', 'Solteiro(a)'...),
              // entao as comparacoes ('casado'/'casada') nunca casavam (codigo morto)
              // e "corrigi-las" gravaria um valor fora das opcoes do select.
              // Auto-ajustar profissão
              if (contratante.profissao && sexo) {
                updates.profissao = adjustProfissaoGender(contratante.profissao, sexo);
              }
              onChange(index, updates);
            }}>
            <option value="">Selecione...</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
        </div>
        <div>
          <label className="label-field">Nacionalidade *</label>
          <input className={`input-field ${ocrClass('nacionalidade')} ${errors.nacionalidade ? 'input-error' : ''}`}
            value={contratante.nacionalidade} onChange={(e) => handle('nacionalidade', e.target.value)} enterKeyHint="next" />
        </div>
        <div>
          <label className="label-field">Profissao *</label>
          <div className="relative">
            <input className={`input-field ${ocrClass('profissao')} ${errors.profissao ? 'input-error' : ''}`}
              value={contratante.profissao} onChange={(e) => handle('profissao', e.target.value)}
              placeholder="Ex: empresario" list={`profissoes-${index}`} autoComplete="off" enterKeyHint="next" />
            <datalist id={`profissoes-${index}`}>
              {PROFISSOES_COMUNS.map(p => <option key={p} value={p} />)}
            </datalist>
          </div>
        </div>
        <div>
          <label className="label-field">Estado Civil *</label>
          <select className={`input-field ${ocrClass('estadoCivil')} ${errors.estadoCivil ? 'input-error' : ''}`}
            value={contratante.estadoCivil} onChange={(e) => handle('estadoCivil', e.target.value)}>
            <option value="">Selecione...</option>
            {ESTADOS_CIVIS.map(ec => <option key={ec} value={ec}>{ec}</option>)}
          </select>
        </div>
        <div>
          <label className="label-field">E-mail * <ValidationIcon status={vEmail} /></label>
          {/* (mobile-2/mobile-6) email sem auto-capitalize/correcao + teclado certo */}
          <input className={`input-field ${ocrClass('email')} ${errors.email ? 'input-error' : vEmail === 'valid' ? 'input-valid' : ''}`} type="email"
            inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" enterKeyHint="next"
            value={contratante.email} onChange={(e) => handle('email', e.target.value)} placeholder="email@exemplo.com" />
        </div>
        <div>
          <label className="label-field">Celular * {contratante.telefone?.replace(/\D/g,'').length >= 10 ? <ValidationIcon status="valid" /> : null}</label>
          <input className={`input-field ${errors.telefone ? 'input-error' : ''}`}
            value={contratante.telefone || ''} onChange={(e) => handle('telefone', maskPhone(e.target.value))} placeholder="(00) 00000-0000"
            type="tel" inputMode="tel" autoComplete="tel-national" />
        </div>
        <div>
          <label className="label-field">Data de Nascimento *</label>
          {/* (ux-15) nao pode ser futura — max trava o seletor; evaluateBirthDate ja avisa abaixo */}
          <input className={`input-field ${errors.dataNascimento ? 'input-error' : ''}`}
            type="date" max={new Date().toISOString().slice(0, 10)}
            value={contratante.dataNascimento || ''} onChange={(e) => handle('dataNascimento', e.target.value)} />
          {(() => {
            const w = evaluateBirthDate(contratante.dataNascimento);
            if (!w) return null;
            const Icon = w.level === 'error' ? NoSymbolIcon : w.level === 'senior' ? CheckCircleIcon : ExclamationTriangleIcon;
            return (
              <div className={`cbc-date-warning is-${w.level}`} role="status">
                <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{w.message}</span>
              </div>
            );
          })()}
        </div>
        <div className="col-span-2">
          <label className="label-field">Link Kommo * {contratante.linkKommo?.startsWith('http') ? <ValidationIcon status="valid" /> : null}</label>
          <input className={`input-field ${errors.linkKommo ? 'input-error' : ''}`}
            inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next"
            value={contratante.linkKommo || ''} onChange={(e) => handle('linkKommo', e.target.value)} placeholder="https://advocaciacbc.kommo.com/leads/detail/..." title="Cole aqui a URL da conversa/lead no Kommo. Campo obrigatorio." />
        </div>

        {showCopyOptions && (
          <div className="col-span-2 space-y-1.5">
            <button type="button" onClick={handleCopyAll} className="cbc-copy-btn w-full" data-mode="all" title="Copia todos os dados do contratante 1 (mantem CPF/RG/Nome do contratante 2)">
              Copiar tudo do Contratante 1
            </button>
            <div className="cbc-copy-row">
              <button type="button" onClick={handleCopyAddress} className="cbc-copy-btn" title="CEP, endereco, numero, complemento, bairro, cidade, UF">
                Endereco
              </button>
              <button type="button" onClick={handleCopyContact} className="cbc-copy-btn" title="Telefone e link Kommo">
                Telefone + Kommo
              </button>
              <button type="button" onClick={handleCopyEmail} className="cbc-copy-btn" title="E-mail">
                E-mail
              </button>
              <button type="button" onClick={handleCopySocial} className="cbc-copy-btn" title="Sexo, nacionalidade, profissao, estado civil">
                Dados sociais
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="label-field flex items-center gap-1.5">
            CEP * <ValidationIcon status={vCep} />
            {cepLoading && (
              <span className="inline-flex items-center gap-1 text-navy text-[9px] font-semibold normal-case">
                <span className="w-2.5 h-2.5 border-[1.5px] border-navy/30 border-t-navy rounded-full animate-spin" />
                buscando...
              </span>
            )}
          </label>
          <input className={`input-field ${ocrClass('cep')} ${errors.cep || cepError ? 'input-error' : vCep === 'valid' ? 'input-valid' : ''}`}
            value={contratante.cep} onChange={(e) => handle('cep', maskCEP(e.target.value))}
            onBlur={handleCEPLookup} onKeyDown={handleCEPKeyDown} placeholder="00000-000"
            inputMode="numeric" autoComplete="postal-code" />
          {cepError && (
            <div className="text-[10px] text-red-600 mt-0.5 font-semibold">CEP nao encontrado</div>
          )}
        </div>
        <div>
          <label className="label-field">UF *</label>
          <input className={`input-field ${ocrClass('uf')} ${errors.uf ? 'input-error' : ''}`}
            value={contratante.uf} onChange={(e) => handle('uf', e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" maxLength={2}
            autoCapitalize="characters" autoCorrect="off" enterKeyHint="next" />
        </div>
        <div>
          <label className="label-field">Endereco (Rua) *</label>
          <input className={`input-field ${ocrClass('endereco')} ${errors.endereco ? 'input-error' : ''}`}
            value={contratante.endereco} onChange={(e) => handle('endereco', e.target.value)} placeholder="Rua Exemplo" enterKeyHint="next" />
        </div>
        <div>
          <label className="label-field">Numero *</label>
          <input className={`input-field ${errors.numero ? 'input-error' : ''}`}
            value={contratante.numero || ''} onChange={(e) => handle('numero', e.target.value)} placeholder="123"
            inputMode="numeric" enterKeyHint="next" />
        </div>
        <div className="col-span-2">
          <label className="label-field">Complemento</label>
          <input className={`input-field ${ocrClass('complemento')}`}
            value={contratante.complemento || ''} onChange={(e) => handle('complemento', e.target.value)} placeholder="Apto, Bloco, Sala..." />
        </div>
        <div>
          <label className="label-field">Bairro *</label>
          <input className={`input-field ${ocrClass('bairro')} ${errors.bairro ? 'input-error' : ''}`}
            value={contratante.bairro} onChange={(e) => handle('bairro', e.target.value)} placeholder="Bairro" enterKeyHint="next" />
        </div>
        <div>
          <label className="label-field">Cidade *</label>
          <input className={`input-field ${ocrClass('cidade')} ${errors.cidade ? 'input-error' : ''}`}
            value={contratante.cidade} onChange={(e) => handle('cidade', e.target.value)} placeholder="Cidade" enterKeyHint="next" />
        </div>
      </div>
    </div>
  );
}

// (perf-fe-4) React.memo evita re-render do contratante nao editado a cada tecla.
const ContratanteForm = memo(ContratanteFormBase);

// ─── Main FormPanel ───
export default function FormPanel({ onSave, onSendZapSign, onPdfSave, onProcuracaoPdf, saving, onClear, loadedContractId, currentUserEmail }) {
  const { data, updateData, updateContratante, updateHonorarios, getClausulaTexto, updateClausula, resetClausula, isClausulaModificada, getClausulasOrdenadas, reorderClausulas, addClausulaAvulsa, removeClausulaAvulsa, resetAll } = useContract();
  const { list: empreendimentos, addEmpreendimento } = useEmpreendimentos();
  const [errors, setErrors] = useState([{}, {}]);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showAddClausula, setShowAddClausula] = useState(false);
  const [newClausulaTitulo, setNewClausulaTitulo] = useState('');
  const [newClausulaTexto, setNewClausulaTexto] = useState('');
  const h = data.honorarios;
  const progress = useFormProgress(data);
  const ripple = useRipple();
  // (mobile-3) Em aparelhos de toque o HTML5 drag "agarra" o dedo e trava o scroll;
  // desligamos draggable nas clausulas (o reorder por toque usa os botoes ↑/↓).
  const isTouchDevice = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches, []);

  // Duplicate detection
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [signatureEstimate, setSignatureEstimate] = useState(null);

  // (#vendas-fase6) Prefill vindo de lead rapido convertido no VendasPanel
  // App.jsx dispara cbc:prefillNovoContract apos trocar para aba 'novo'.
  // Preenchemos somente campos basicos do primeiro contratante; o resto
  // do formulario o usuario completa normalmente.
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      const nome = (d.nome || '').trim();
      const telefone = (d.telefone || '').trim();
      // Aceita kommoLink/kommo (novos) + chatguruLink/chatguru (legado QR codes antigos)
      const kommoLink = (d.kommoLink || d.kommo || d.chatguruLink || d.chatguru || '').trim();
      const updates = {};
      if (nome) updates.nome = nome;
      if (telefone) updates.telefone = telefone;
      if (kommoLink) updates.linkKommo = kommoLink;
      if (Object.keys(updates).length > 0) {
        // Garante que tem pelo menos 1 contratante selecionado
        if (!data.numContratantes || data.numContratantes < 1) {
          updateData({ numContratantes: 1 });
        }
        updateContratante(0, updates);
      }
    };
    window.addEventListener('cbc:prefillNovoContract', handler);
    return () => window.removeEventListener('cbc:prefillNovoContract', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // (#13) verifica duplicata (CPF+resort) de TODOS os contratantes, nao so do primeiro.
    const resort = data.resort;
    if (!resort || resort === 'outro') { setDuplicateWarning(null); return; }
    const num = data.numContratantes || 1;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < num; i++) {
        // (PJ 25/06) deteccao de duplicata e por CPF+resort; no PJ o CPF e do representante
        // (que pode representar varias empresas), entao nao serve de chave — pulamos.
        if (data.contratantes?.[i]?.tipo === 'pj') continue;
        const cpf = data.contratantes?.[i]?.cpf?.replace(/\D/g, '');
        if (cpf?.length !== 11) continue;
        const result = await checkDuplicate(cpf, resort);
        if (cancelled) return;
        if (result.isDuplicate) { setDuplicateWarning({ ...result, contratanteIdx: i }); return; }
      }
      if (!cancelled) setDuplicateWarning(null);
    })();
    return () => { cancelled = true; };
  }, [data.contratantes?.[0]?.cpf, data.contratantes?.[1]?.cpf, data.numContratantes, data.resort]);

  useEffect(() => {
    const resort = data.resort;
    if (resort && resort !== 'outro') {
      estimateSignatureTime(resort).then(setSignatureEstimate);
    }
  }, [data.resort]);

  const handleClearForm = () => {
    resetAll();
    if (onClear) onClear();
    setShowClearConfirm(false);
  };

  const [, setValidationMsg] = useState('');
  const [validationErrors, setValidationErrors] = useState(null); // grouped errors for detailed display
  const [globalFieldErrors, setGlobalFieldErrors] = useState({}); // non-contratante field errors

  // Full form validation — returns grouped errors by section
  const validateForm = useCallback(() => {
    const missing = [];
    const grouped = {};
    const newErrors = [{}, {}];
    const gfe = {}; // global field errors

    const addError = (section, field, label) => {
      if (!grouped[section]) grouped[section] = [];
      grouped[section].push(label);
      missing.push(label);
    };

    const num = data.numContratantes || 0;
    if (num === 0) { addError('Contratantes', 'numContratantes', 'Selecione o numero de contratantes'); }
    for (let i = 0; i < num; i++) {
      const c = data.contratantes[i];
      const sec = num > 1 ? `Contratante ${i + 1}` : 'Contratante';
      // (PJ 25/06) PJ valida o bloco da empresa + os campos do representante legal (que reusam
      // os nomes de campo do PF). PF mantem a lista original.
      const fields = c.tipo === 'pj'
        ? { razaoSocial: 'Razao Social', cnpj: 'CNPJ', emailEmpresa: 'E-mail da empresa', cepEmpresa: 'CEP da empresa', ufEmpresa: 'UF da empresa', enderecoEmpresa: 'Endereco da empresa', numeroEmpresa: 'Numero da empresa', bairroEmpresa: 'Bairro da empresa', cidadeEmpresa: 'Cidade da empresa', nome: 'Nome do representante', cpf: 'CPF do representante', rg: 'RG do representante', nacionalidade: 'Nacionalidade do representante', profissao: 'Profissao do representante', estadoCivil: 'Estado Civil do representante', email: 'E-mail do representante', dataNascimento: 'Data de Nascimento do representante', linkKommo: 'Link Kommo', cep: 'CEP do representante', uf: 'UF do representante', endereco: 'Endereco do representante', numero: 'Numero do representante', bairro: 'Bairro do representante', cidade: 'Cidade do representante' }
        : { nome: 'Nome', cpf: 'CPF', rg: 'RG', nacionalidade: 'Nacionalidade', profissao: 'Profissao', estadoCivil: 'Estado Civil', email: 'E-mail', dataNascimento: 'Data de Nascimento', linkKommo: 'Link Kommo', cep: 'CEP', uf: 'UF', endereco: 'Endereco', numero: 'Numero', bairro: 'Bairro', cidade: 'Cidade' };
      for (const [key, name] of Object.entries(fields)) {
        if (!c[key] || !c[key].trim()) { addError(sec, key, name); newErrors[i][key] = true; }
      }
      // (PJ) CNPJ bem-formatado mas invalido (digito verificador) nao pode passar.
      if (c.tipo === 'pj' && c.cnpj?.trim() && !validateCNPJ(c.cnpj.trim())) {
        addError(sec, 'cnpj', 'CNPJ invalido (00.000.000/0000-00)'); newErrors[i].cnpj = true;
      }
      // (#12) Link Kommo precisa ser a URL da conversa no formato /leads/detail/{id} — e
      // exatamente esse formato que as automacoes leem p/ mover lead + postar notas no CRM.
      // Qualquer outra URL passava na validacao mas quebrava a integracao silenciosamente.
      if (c.linkKommo?.trim() && !/\/leads\/detail\/\d+/.test(c.linkKommo.trim())) {
        addError(sec, 'linkKommo', 'Link Kommo (use a URL .../leads/detail/NUMERO)'); newErrors[i].linkKommo = true;
      }
    }
    if (!data.resort || (data.resort === 'outro' && !data.resortCustom)) { addError('Resort / Acao', 'resort', 'Resort'); gfe.resort = true; }
    if (!data.tipoAcao || (data.tipoAcao === 'outro' && !data.tipoAcaoCustom)) { addError('Resort / Acao', 'tipoAcao', 'Tipo de Acao'); gfe.tipoAcao = true; }
    const ho = data.honorarios;
    if (!ho.somenteExito) {
      if (!ho.total || ho.total <= 0) { addError('Honorarios', 'total', 'Valor total'); gfe.total = true; }
      if (!ho.parcelas || ho.parcelas <= 0) { addError('Honorarios', 'parcelas', 'Numero de parcelas'); gfe.parcelas = true; }
      if (!ho.dataPrimeiraParcela) { addError('Honorarios', 'dataPrimeiraParcela', 'Data da 1a parcela'); gfe.dataPrimeiraParcela = true; }
      else {
        // (fix A 01/06/2026) Bloqueia data passada — Asaas rejeita boletos com dueDate < hoje.
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const due = new Date(ho.dataPrimeiraParcela + 'T12:00:00');
        if (due < today) {
          addError('Honorarios', 'dataPrimeiraParcela', 'Data da 1a parcela ja passou (Asaas rejeita)');
          gfe.dataPrimeiraParcela = true;
        }
      }
    }
    if (!ho.somenteIniciais && (!ho.percentualExito || ho.percentualExito <= 0)) { addError('Honorarios', 'percentualExito', 'Percentual de exito'); gfe.percentualExito = true; }
    if (!data.origemCliente) { addError('Dados Internos', 'origemCliente', 'Origem do Cliente'); gfe.origemCliente = true; }
    if (!data.dataPrimeiraMensagem) { addError('Dados Internos', 'dataPrimeiraMensagem', 'Data da Primeira Mensagem'); gfe.dataPrimeiraMensagem = true; }
    if (!data.linkGoogleDrive || !data.linkGoogleDrive.trim()) { addError('Dados Internos', 'linkGoogleDrive', 'Link Google Drive'); gfe.linkGoogleDrive = true; }

    setErrors(newErrors);
    setGlobalFieldErrors(gfe);
    if (missing.length > 0) setValidationErrors(grouped);
    else setValidationErrors(null);
    return missing;
  }, [data]);

  const isFormComplete = useMemo(() => {
    const num = data.numContratantes || 0;
    if (num === 0) return false;
    for (let i = 0; i < num; i++) {
      if (!checkContratanteComplete(data.contratantes[i])) return false;
    }
    if (!data.resort || (data.resort === 'outro' && !data.resortCustom)) return false;
    if (!data.tipoAcao || (data.tipoAcao === 'outro' && !data.tipoAcaoCustom)) return false;
    const ho = data.honorarios;
    if (!ho.somenteExito && (!ho.total || !ho.parcelas || !ho.dataPrimeiraParcela)) return false;
    if (!ho.somenteIniciais && (!ho.percentualExito || ho.percentualExito <= 0)) return false;
    if (!data.origemCliente) return false;
    if (!data.dataPrimeiraMensagem) return false;
    if (!data.linkGoogleDrive || !data.linkGoogleDrive.trim()) return false;
    return true;
  }, [data]);

  const handleValidatedAction = useCallback((action) => {
    const missing = validateForm();
    if (missing.length > 0) {
      setValidationMsg(`${missing.length} campo${missing.length > 1 ? 's' : ''} obrigatorio${missing.length > 1 ? 's' : ''} faltando`);
      // Scroll to first error field
      setTimeout(() => {
        const firstError = formRef.current?.querySelector('.input-error');
        if (firstError) {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstError.classList.add('shake-error');
          setTimeout(() => firstError.classList.remove('shake-error'), 600);
        }
      }, 100);
      // (#38) Pulse empty required fields
      setTimeout(() => {
        const inputs = document.querySelectorAll('.input-field');
        inputs.forEach(el => {
          if (!el.value?.trim() && el.closest('[data-required]')) {
            el.classList.add('required-empty');
            setTimeout(() => el.classList.remove('required-empty'), 4500);
          }
        });
      }, 50);
      return;
    }
    setValidationErrors(null);
    setGlobalFieldErrors({});
    action();
  }, [validateForm]);

  const formRef = useRef(null);
  const [, setShowStickyHeader] = useState(false);
  const percent = useMemo(() => Math.round((progress.filter(s => s.done).length / progress.length) * 100), [progress]);

  // Sticky header: show after scrolling past the progress bar
  useEffect(() => {
    const container = formRef.current?.closest('[class*="overflow-y-auto"]') || formRef.current?.parentElement;
    if (!container) return;
    const handleScroll = () => setShowStickyHeader(container.scrollTop > 100);
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div ref={formRef} className="px-2 py-2 md:p-3 w-full overflow-hidden relative">
      {/* (#97, #327) Presenca em tempo real — apenas quando rascunho carregado */}
      {loadedContractId && currentUserEmail && (
        <div className="mb-2 flex justify-end">
          <PresenceIndicator topic={`contrato:${loadedContractId}`} currentUserEmail={currentUserEmail} mode="editing" />
        </div>
      )}
      {/* (ux-5) Banner discreto — deixa claro que esta editando um contrato ja salvo */}
      {loadedContractId && (
        <div className="mb-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
          style={{ background: '#FFF8ED', color: '#92400E', border: '1px solid #FDE68A' }}>
          <PencilSquareIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Editando contrato existente</span>
        </div>
      )}
      {/* Clear Form Button — top of form */}
      <div className="flex justify-end mb-1">
        <button
          onClick={() => setShowClearConfirm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-400 text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-all hover:bg-red-50 hover:border-red-300 hover:text-red-500"
          title="Limpar todos os dados do formulário"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Limpar Formulário
        </button>
      </div>
      {/* Unified Progress Bar */}
      <div className="mb-3 px-1">
        <div className="flex items-center gap-3 mb-2">
          <CircularProgress percent={percent} />
          <div className="flex-1 grid grid-cols-5 gap-2">
            {progress.map((s, i) => {
              const pct = s.total > 0 ? Math.round((s.filled / s.total) * 100) : 0;
              const sectionIds = ['section-contratantes', 'section-resort', 'section-honorarios', 'section-clausulas', 'section-internos'];
              return (
                <div key={i} className="min-w-0 cursor-pointer group" onClick={() => {
                  // (#34) Scroll to section with smooth animation
                  const el = document.getElementById(sectionIds[i]);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1 group-hover:ring-2 group-hover:ring-blue-200 transition-all">
                    <div className="h-full rounded-full transition-all duration-500" style={{
                      width: `${pct}%`,
                      background: s.done ? '#22C55E' : pct > 0 ? '#C8973A' : '#E5E7EB',
                    }} />
                  </div>
                  <div className="flex items-center justify-center gap-0.5 group-hover:scale-105 transition-transform">
                    <ProgressIcon iconKey={s.iconKey} done={s.done} />
                    <span className={`text-[8px] font-bold uppercase truncate ${s.done ? 'text-green-600' : pct > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* N Contratantes */}
      <Section title="Contratantes" id="section-contratantes" done={progress[0].done} icon={SECTION_ICONS['Contratantes']} filled={progress[0].filled} total={progress[0].total}>
        <div className="flex gap-2 mb-3">
          {[1, 2].map(n => (
            <button key={n}
              onClick={() => updateData({ numContratantes: n })}
              className={`flex-1 py-2.5 rounded-lg border-2 text-xs font-bold uppercase tracking-wide transition-all cursor-pointer ${
                data.numContratantes === n
                  ? 'text-white border-transparent'
                  : 'border-gray-200 text-gray-500 hover:border-navy/30'
              }`}
              style={data.numContratantes === n ? { background: '#1B3A5C' } : {}}>
              {n === 1 ? '1 Contratante' : '2 Contratantes'}
            </button>
          ))}
        </div>

        {data.numContratantes > 0 && (
          <div>
            {Array.from({ length: data.numContratantes }, (_, i) => (
              <div key={i}>
                {i === 1 && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
                    <span className="text-[10px] font-bold uppercase tracking-[2px] px-3 py-1 rounded-full" style={{ background: '#EEF4FF', color: '#1B3A5C' }}>
                      Contratante 2
                    </span>
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
                  </div>
                )}
                <ContratanteForm key={i} index={i} contratante={data.contratantes[i]}
                  onChange={updateContratante} errors={errors[i] || {}}
                  otherContratante={i === 1 ? data.contratantes[0] : null}
                  numContratantes={data.numContratantes} />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Resort */}
      <Section title="Resort" id="section-resort" done={progress[1].done} icon={SECTION_ICONS['Resort']} filled={progress[1].filled} total={progress[1].total}>
        <label className="label-field">Empreendimento / Resort *</label>
        {/* (ux-18) Combobox com busca por digitacao (datalist) — substitui o <select> gigante de ~99 opcoes.
            Valor salvo em data.resort permanece igual (nome exato do empreendimento ou 'outro' p/ resort livre). */}
        <input
          list="cbc-resorts-datalist"
          className={`input-field mb-3 ${globalFieldErrors.resort ? 'input-error' : ''}`}
          placeholder="Digite para buscar o resort..."
          value={data.resort === 'outro' ? (data.resortCustom || '') : (data.resort || '')}
          onChange={(e) => {
            const v = e.target.value;
            const trigger = '+ Novo empreendimento...';
            if (!v) {
              updateData({ resort: '', resortCustom: '', tipoAcao: '', tipoAcaoCustom: '' });
            } else if (v === trigger) {
              updateData({ resort: 'outro', resortCustom: '', tipoAcao: '', tipoAcaoCustom: '' });
            } else if (empreendimentos.includes(v)) {
              updateData({ resort: v, resortCustom: '', tipoAcao: '', tipoAcaoCustom: '' });
            } else {
              // Texto livre = novo empreendimento (mesma semantica da antiga opcao "Outro")
              updateData({ resort: 'outro', resortCustom: v, tipoAcao: '', tipoAcaoCustom: '' });
            }
            setGlobalFieldErrors(p => ({...p, resort: false}));
          }}
          autoComplete="off"
        />
        <datalist id="cbc-resorts-datalist">
          {empreendimentos.map(r => <option key={r} value={r} />)}
          <option value="+ Novo empreendimento..." />
        </datalist>
        {data.resort === 'outro' && (
          <div className="mb-3">
            <label className="label-field">Nome do Novo Empreendimento *</label>
            <div className="flex gap-2">
              <input className="input-field flex-1" placeholder="Digite o nome do empreendimento..."
                value={data.resortCustom || ''} onChange={(e) => updateData({ resortCustom: e.target.value })} />
              {data.resortCustom?.trim() && (
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-gold text-white text-xs font-bold cursor-pointer hover:bg-gold-dark whitespace-nowrap"
                  onClick={async () => {
                    const nome = data.resortCustom.trim();
                    await addEmpreendimento(nome);
                    updateData({ resort: nome, resortCustom: '' });
                  }}
                  title="Adicionar à lista permanente (sincroniza com outros sistemas)"
                >
                  + Salvar na lista
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">Clique em "+ Salvar na lista" para sincronizar com a Prestação de Contas.</p>
          </div>
        )}

        {data.resort && (
          <div className="mt-1">
            <label className="label-field">Tipo de Acao *</label>
            <select
              className={`input-field mb-2 ${globalFieldErrors.tipoAcao ? 'input-error' : ''}`}
              value={data.tipoAcao || ''}
              onChange={(e) => { updateData({ tipoAcao: e.target.value, tipoAcaoCustom: '' }); setGlobalFieldErrors(p => ({...p, tipoAcao: false})); }}
            >
              <option value="">Selecione o tipo de acao...</option>
              {TIPOS_ACAO.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
              <option value="outro">Outros (especificar)</option>
            </select>
            {data.tipoAcao === 'outro' && (
              <input className="input-field" placeholder="Especifique o tipo de acao..."
                value={data.tipoAcaoCustom || ''} onChange={(e) => updateData({ tipoAcaoCustom: e.target.value })} />
            )}

            {data.tipoAcao && (
              <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: '#EEF4FF', border: '1px solid #C0D0E8' }}>
                <div className="flex justify-between">
                  <span className="text-gray-500">Resort</span>
                  <span className="font-bold" style={{ color: '#1B3A5C' }}>{data.resort === 'outro' ? data.resortCustom : data.resort}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">Acao</span>
                  <span className="font-bold" style={{ color: '#1B3A5C' }}>{data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao}</span>
                </div>
              </div>
            )}

            {/* Duplicate warning */}
            {duplicateWarning && (
              <div className="mt-3 p-3 rounded-lg text-xs border" style={{ background: 'var(--cbc-warning-bg)', borderColor: 'var(--cbc-warning-border)' }}>
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 shrink-0" style={{ color: 'var(--cbc-warning)' }} aria-hidden="true" />
                  <div>
                    <div className="font-bold mb-1" style={{ color: 'var(--cbc-warning)' }}>Contrato duplicado detectado!</div>
                    <div style={{ color: 'var(--cbc-text-secondary)' }}>
                      Este CPF ja possui {duplicateWarning.existingContracts.length} contrato(s) para o mesmo resort:
                    </div>
                    {duplicateWarning.existingContracts.map((c, i) => {
                      const statusLabel = c.status === 'assinado' ? 'Assinado' : c.status === 'enviado_zapsign' ? 'Enviado' : 'Rascunho';
                      const StatusIcon = c.status === 'assinado' ? CheckCircleIcon : c.status === 'enviado_zapsign' ? PaperAirplaneIcon : PencilSquareIcon;
                      return (
                        <div key={i} className="mt-1 text-[11px] flex items-center gap-1" style={{ color: 'var(--cbc-text-secondary)' }}>
                          <span>•</span>
                          <span>{c.nome} —</span>
                          <StatusIcon className="w-3 h-3 inline shrink-0" aria-hidden="true" />
                          <span>{statusLabel} — {new Date(c.created_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Signature time estimate */}
            {signatureEstimate && signatureEstimate.sampleSize >= 3 && (
              <div className="mt-2 p-2.5 rounded-lg text-[11px] flex items-center gap-2" style={{ background: 'var(--cbc-success-bg)', border: '1px solid var(--cbc-success-border)' }}>
                <span aria-hidden="true">⏱️</span>
                <span style={{ color: 'var(--cbc-success)' }}>
                  Tempo medio ate assinatura para este resort: <strong>{signatureEstimate.avgDays} dias</strong> (base: {signatureEstimate.sampleSize} contratos)
                </span>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Honorarios */}
      <Section title="Honorarios Advocaticios" id="section-honorarios" dark done={progress[2].done} icon={SECTION_ICONS['Honorarios Advocaticios']} filled={progress[2].filled} total={progress[2].total}>
        {/* Modo de honorários: 3 opções */}
        <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-gray-500 mb-2">Tipo de Honorarios:</div>
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {[
            { key: 'ambos', label: 'Iniciais + Exito', desc: 'Valor fixo + % de êxito' },
            { key: 'somenteExito', label: 'Somente Exito', desc: 'Apenas % ad exitum' },
            { key: 'somenteIniciais', label: 'Somente Iniciais', desc: 'Apenas valor fixo' },
          ].map(modo => {
            const modoAtual = h.somenteExito ? 'somenteExito' : h.somenteIniciais ? 'somenteIniciais' : 'ambos';
            const isActive = modoAtual === modo.key;
            return (
              <button key={modo.key}
                onClick={() => updateHonorarios({
                  somenteExito: modo.key === 'somenteExito',
                  somenteIniciais: modo.key === 'somenteIniciais',
                })}
                className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                  isActive ? 'border-transparent text-white' : 'border-gray-200 hover:border-navy/30 bg-white'
                }`}
                style={isActive ? { background: '#1B3A5C' } : {}}>
                <div className={`text-[10px] font-bold uppercase tracking-wide ${isActive ? 'text-white' : 'text-gray-700'}`}>{modo.label}</div>
                <div className={`text-[8px] mt-0.5 ${isActive ? 'text-white/60' : 'text-gray-400'}`}>{modo.desc}</div>
              </button>
            );
          })}
        </div>

        {!h.somenteExito && (
          <>
        <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-gray-500 mb-2">Valor fixo:</div>
        <div className="grid grid-cols-2 gap-2">
          {HONORARIOS_OPCOES.map((opt) => {
            const isSelected = h.tipo === 'predefinido' && h.total === opt.total && h.parcelas === opt.parcelas;
            return (
            <button key={`${opt.total}-${opt.parcelas}`}
              onClick={() => updateHonorarios({ tipo: 'predefinido', total: opt.total, parcelas: opt.parcelas, valorParcela: opt.valorParcela })}
              className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer text-xs ${
                isSelected ? 'border-transparent text-white' : 'border-gray-200 hover:border-navy/30 bg-white'
              }`}
              style={isSelected ? { background: '#1B3A5C' } : {}}>
              <div className={`font-bold ${isSelected ? 'text-white' : 'text-navy'}`}>{formatCurrency(opt.total)}</div>
              <div className={isSelected ? 'text-white/70' : 'text-gray-500'}>{opt.parcelas === 1 ? opt.label : `${opt.parcelas}x ${formatCurrency(opt.valorParcela)}`}</div>
            </button>
            );
          })}
          <button
            onClick={() => updateHonorarios({ tipo: 'personalizado' })}
            className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer text-xs col-span-2 ${
              h.tipo === 'personalizado' ? 'border-transparent text-white' : 'border-gray-200 hover:border-navy/30 bg-white'
            }`}
            style={h.tipo === 'personalizado' ? { background: '#1B3A5C' } : {}}>
            <div className="font-bold">Valor Personalizado</div>
          </button>
        </div>

        {h.tipo === 'personalizado' && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div>
              <label className="label-field">Total (R$)</label>
              <input type="number" inputMode="decimal" className="input-field" value={h.total || ''} onChange={(e) => {
                const total = Number(e.target.value);
                const vp = h.parcelas > 0 ? Math.round((total / h.parcelas) * 100) / 100 : 0;
                updateHonorarios({ total, valorParcela: vp });
              }} />
            </div>
            <div>
              <label className="label-field">Parcelas</label>
              <input type="number" inputMode="numeric" className="input-field" value={h.parcelas || ''} onChange={(e) => {
                const parcelas = Number(e.target.value);
                const vp = parcelas > 0 ? Math.round((h.total / parcelas) * 100) / 100 : 0;
                updateHonorarios({ parcelas, valorParcela: vp });
              }} />
            </div>
            <div>
              <label className="label-field">Valor/Parc.</label>
              <input className="input-field bg-gray-50" readOnly value={h.valorParcela ? formatCurrency(h.valorParcela) : ''} />
            </div>
          </div>
        )}

        <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-gray-500 mt-4 mb-2">Data da 1a Parcela:</div>
        <input type="date" className={`input-field ${globalFieldErrors.dataPrimeiraParcela ? 'input-error' : ''}`} value={h.dataPrimeiraParcela || ''}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => { updateHonorarios({ dataPrimeiraParcela: e.target.value }); setGlobalFieldErrors(p => ({...p, dataPrimeiraParcela: false})); }} />
        {h.dataPrimeiraParcela && (() => {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const due = new Date(h.dataPrimeiraParcela + 'T12:00:00');
          if (due < today) return <p className="text-[10px] text-red-600 mt-1">⚠ Data ja passou — Asaas rejeita boletos com vencimento no passado</p>;
          return null;
        })()}
          </>
        )}

        {!h.somenteIniciais && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-gray-500 mt-4 mb-2">
              {h.somenteExito ? 'Honorarios de Exito (%)' : 'Honorarios Contratuais (%)'}
            </div>
            <div className="flex items-center gap-1">
              <input type="number" inputMode="decimal" className="input-field text-center" style={{ maxWidth: '80px' }}
                value={h.percentualExito || ''} min={1} max={100}
                onChange={(e) => updateHonorarios({ percentualExito: Number(e.target.value) || 0 })} />
              <span className="text-sm text-gray-500 font-bold">%</span>
            </div>
          </>
        )}

      </Section>

      {/* Clausulas */}
      <Section title="Clausulas do Contrato" id="section-clausulas" defaultOpen={false} done={progress[3].done} icon={SECTION_ICONS['Clausulas']}>
        <p className="text-xs text-gray-500 mb-2">Arraste para reordenar. Clique em "Editar" para modificar.</p>
        <div className="space-y-2">
          {(() => {
            const orderedIds = getClausulasOrdenadas();
            const allClausulas = [...CLAUSULAS_PADRAO, ...(data.clausulasAvulsas || []).map(a => ({ ...a, editavel: true, avulsa: true }))];
            const filtered = orderedIds
              .map(id => allClausulas.find(c => c.id === id))
              .filter(Boolean)
              .filter(Boolean);

            // Renumber main clauses dynamically
            let clausulaNum = 0;
            const numberedMap = {};
            filtered.forEach(cl => {
              if (!cl.paragrafo && !cl.id.includes('_p')) {
                clausulaNum++;
                numberedMap[cl.id] = clausulaNum;
              }
            });

            // (mobile 06/2026) Reordenação por toque: HTML5 drag-and-drop não
            // dispara no iOS/iPadOS — botões ↑/↓ (visíveis só em hover:none)
            // reutilizam a mesma reorderClausulas do drag
            const moveClausulaBy = (fromIdx, toIdx) => {
              if (toIdx < 0 || toIdx >= filtered.length) return;
              const fullOrder = getClausulasOrdenadas();
              const fromId = filtered[fromIdx]?.id;
              const toId = filtered[toIdx]?.id;
              if (fromId && toId) {
                const fI = fullOrder.indexOf(fromId);
                const tI = fullOrder.indexOf(toId);
                if (fI >= 0 && tI >= 0) reorderClausulas(fI, tI);
              }
            };

            return filtered.map((cl, idx) => {
              const isAuto = cl.auto;
              const isAvulsa = cl.avulsa;
              const isModified = isClausulaModificada(cl.id);
              const isEditing = editing === cl.id;
              const num = numberedMap[cl.id];
              const displayTitle = num && !isAvulsa
                ? cl.titulo.replace(/Cláusula \d+ª/, `Cláusula ${num}ª`)
                : isAvulsa && num
                  ? `Cláusula ${num}ª — ${cl.titulo}`
                  : cl.titulo;

              const textoH = h.somenteExito
                ? `Somente êxito: ${h.percentualExito}% ad exitum`
                : h.somenteIniciais
                  ? h.dataPrimeiraParcela ? `${formatCurrency(h.total)} em ${h.parcelas}x (sem êxito)` : 'Preencha os honorarios acima'
                  : h.dataPrimeiraParcela
                    ? `${formatCurrency(h.total)} em ${h.parcelas}x + ${h.percentualExito}% exito`
                    : 'Preencha os honorarios acima';

              return (
                <div key={cl.id}
                  draggable={!isTouchDevice} /* (mobile-3) sem drag em touch — usa ↑/↓ */
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(idx)); e.currentTarget.style.opacity = '0.5'; }}
                  onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; }}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderTop = '2px solid #1B3A5C'; }}
                  onDragLeave={(e) => { e.currentTarget.style.borderTop = ''; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderTop = '';
                    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
                    if (!isNaN(fromIdx) && fromIdx !== idx) {
                      // Map from filtered index back to full order index
                      const fullOrder = getClausulasOrdenadas();
                      const fromId = filtered[fromIdx]?.id;
                      const toId = filtered[idx]?.id;
                      if (fromId && toId) {
                        const fI = fullOrder.indexOf(fromId);
                        const tI = fullOrder.indexOf(toId);
                        if (fI >= 0 && tI >= 0) reorderClausulas(fI, tI);
                      }
                    }
                  }}
                  className={`rounded-lg border text-xs overflow-hidden cursor-grab active:cursor-grabbing ${cl.paragrafo ? 'ml-3' : ''}`}
                  style={isModified && !isAuto ? { background: '#FFF8ED', borderColor: '#E8D5A8' } : isAvulsa ? { background: '#F0FDF4', borderColor: '#86EFAC' } : { borderColor: '#E4EAF0' }}>
                  <div className="flex items-center justify-between px-3 py-2" style={{ background: isAvulsa ? '#ECFDF5' : cl.paragrafo ? '#F8FAFC' : '#EEF4FF', borderBottom: '1px solid #E4EAF0' }}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-gray-400 cursor-grab text-sm shrink-0">⠿</span>
                      {/* (mobile 06/2026) ↑/↓ para touch — só aparecem em hover:none */}
                      <span className="cbc-touch-reorder shrink-0 items-center gap-0.5">
                        <button type="button" disabled={idx === 0} onClick={() => moveClausulaBy(idx, idx - 1)}
                          className="w-8 h-8 rounded-md flex items-center justify-center text-gray-500 disabled:opacity-25 cursor-pointer no-touch-min"
                          style={{ background: 'rgba(27,58,92,0.08)' }} aria-label="Mover cláusula para cima">↑</button>
                        <button type="button" disabled={idx === filtered.length - 1} onClick={() => moveClausulaBy(idx, idx + 1)}
                          className="w-8 h-8 rounded-md flex items-center justify-center text-gray-500 disabled:opacity-25 cursor-pointer no-touch-min"
                          style={{ background: 'rgba(27,58,92,0.08)' }} aria-label="Mover cláusula para baixo">↓</button>
                      </span>
                      <span className="font-bold truncate" style={{ color: '#1B3A5C', fontSize: '11px' }}>{displayTitle}</span>
                    </div>
                    <div className="flex gap-1.5 items-center shrink-0">
                      {isAuto && <span className="text-[10px] px-2 py-0.5 rounded-full text-white" style={{ background: '#1B3A5C' }}>Auto</span>}
                      {isAvulsa && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">Avulsa</span>}
                      {isModified && !isAuto && !isAvulsa && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">Editada</span>}
                    </div>
                  </div>

                  {isAuto ? (
                    <p className="text-gray-600 px-3 py-2 text-[11px]">{textoH}</p>
                  ) : isEditing ? (
                    <div className="p-3">
                      <textarea className="input-field text-xs min-h-[80px]" rows={3}
                        value={editText} onChange={(e) => setEditText(e.target.value)} />
                      <div className="flex gap-1.5 mt-2">
                        <button className="text-[11px] text-white px-3 py-1.5 rounded-lg font-bold cursor-pointer" style={{ background: '#1B3A5C' }}
                          onClick={() => { updateClausula(cl.id, editText); setEditing(null); }}>Salvar</button>
                        <button className="text-[11px] border border-gray-300 px-3 py-1.5 rounded-lg cursor-pointer"
                          onClick={() => setEditing(null)}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 py-2">
                      <p className="text-gray-600 line-clamp-2 text-[11px] leading-relaxed">{getClausulaTexto(cl.id) || cl.texto}</p>
                      <div className="flex gap-3 mt-1.5">
                        <button className="text-[11px] font-bold cursor-pointer hover:underline" style={{ color: '#1B3A5C' }}
                          onClick={() => { setEditing(cl.id); setEditText(getClausulaTexto(cl.id) || cl.texto); }}>Editar</button>
                        {isModified && !isAvulsa && (
                          <button className="text-[11px] text-red-600 font-bold cursor-pointer hover:underline"
                            onClick={() => resetClausula(cl.id)}>Restaurar</button>
                        )}
                        {isAvulsa && (
                          <button className="text-[11px] text-red-600 font-bold cursor-pointer hover:underline"
                            onClick={() => removeClausulaAvulsa(cl.id)}>Remover</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>

        {/* Add custom clause */}
        {showAddClausula ? (
          <div className="mt-3 p-3 rounded-lg border border-dashed border-green-400 bg-green-50/50">
            <div className="text-[10px] font-bold uppercase tracking-wide text-green-700 mb-2">Nova Clausula Avulsa</div>
            <input type="text" placeholder="Titulo da clausula (ex: Clausula Especial — Garantias)"
              value={newClausulaTitulo} onChange={e => setNewClausulaTitulo(e.target.value)}
              className="input-field text-xs mb-2" />
            <textarea placeholder="Texto da clausula..."
              value={newClausulaTexto} onChange={e => setNewClausulaTexto(e.target.value)}
              className="input-field text-xs min-h-[60px]" rows={3} />
            <div className="flex gap-1.5 mt-2">
              <button className="text-[11px] text-white px-3 py-1.5 rounded-lg font-bold cursor-pointer" style={{ background: '#16A34A' }}
                onClick={() => {
                  if (newClausulaTitulo.trim() && newClausulaTexto.trim()) {
                    addClausulaAvulsa(newClausulaTitulo.trim(), newClausulaTexto.trim());
                    setNewClausulaTitulo(''); setNewClausulaTexto(''); setShowAddClausula(false);
                  }
                }}>Adicionar</button>
              <button className="text-[11px] border border-gray-300 px-3 py-1.5 rounded-lg cursor-pointer"
                onClick={() => { setShowAddClausula(false); setNewClausulaTitulo(''); setNewClausulaTexto(''); }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddClausula(true)}
            className="mt-3 w-full py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-green-400 hover:text-green-600 text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-all flex items-center justify-center gap-1.5">
            <span className="text-base">+</span> Adicionar Clausula Avulsa
          </button>
        )}
      </Section>

      {/* Detecção de Conflitos */}
      <ConflictDetector />

      {/* Dados Internos (não aparecem no contrato) */}
      <div id="section-internos" className="px-3 pt-3 space-y-2.5">
        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Dados Internos <span className="font-normal text-gray-300">— nao aparecem no contrato</span>
        </div>

        {/* Origem do Cliente */}
        <div>
          <label className="label-field">Origem do Cliente *</label>
          <select
            className={`input-field text-xs ${globalFieldErrors.origemCliente ? 'input-error' : ''}`}
            value={data.origemCliente || ''}
            onChange={(e) => { updateData({ origemCliente: e.target.value }); setGlobalFieldErrors(p => ({...p, origemCliente: false})); }}
          >
            <option value="">Selecione a origem...</option>
            <option value="Facebook">Facebook</option>
            <option value="Trafego pago">Trafego pago</option>
            <option value="Formulario">Formulario</option>
            <option value="Google">Google</option>
            <option value="Indicacao">Indicacao</option>
            <option value="Instagram">Instagram</option>
            <option value="Organico">Organico</option>
            <option value="Outros">Outros</option>
          </select>
        </div>

        {/* Data da primeira mensagem */}
        <div>
          <label className="label-field">Data da Primeira Mensagem *</label>
          <input
            type="date"
            className={`input-field text-xs ${globalFieldErrors.dataPrimeiraMensagem ? 'input-error' : ''}`}
            value={data.dataPrimeiraMensagem || ''}
            max={new Date().toISOString().slice(0, 10)} /* (ux-15) nao pode ser futura */
            onChange={(e) => { updateData({ dataPrimeiraMensagem: e.target.value }); setGlobalFieldErrors(p => ({...p, dataPrimeiraMensagem: false})); }}
          />
          {/* (ux-15) Aviso se a data digitada/colada for futura — 1a mensagem nunca esta no futuro */}
          {data.dataPrimeiraMensagem && (() => {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const d = new Date(data.dataPrimeiraMensagem + 'T12:00:00');
            if (d > today) return <p className="text-[10px] text-amber-600 mt-0.5 font-semibold">Data no futuro — verifique a data da primeira mensagem</p>;
            return null;
          })()}
        </div>

        {/* Escritório arca com custas */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer py-2">
            <input
              type="checkbox"
              className="w-4 h-4 accent-[#1B3A5C] cursor-pointer rounded"
              checked={data.escritorioArcaCustas || false}
              onChange={(e) => updateData({ escritorioArcaCustas: e.target.checked })}
            />
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#1B3A5C' }}>
              Escritório arca com as custas processuais
            </span>
          </label>
        </div>

        {/* Não mandar mensagem automática */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer py-2">
            <input
              type="checkbox"
              className="w-4 h-4 accent-red-500 cursor-pointer rounded"
              checked={data.naoMandarMensagem || false}
              onChange={(e) => updateData({ naoMandarMensagem: e.target.checked })}
            />
            <span className="text-xs font-bold uppercase tracking-wide text-red-500">
              Não mandar mensagem automática
            </span>
          </label>
        </div>

        {/* Link Google Drive */}
        <div>
          <label className="label-field">
            Link Google Drive *
            <span
              className="ml-2 inline-block align-middle text-[10px] font-bold text-red-700 bg-red-100 border border-red-300 px-2 py-0.5 rounded normal-case dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/50"
              style={{ letterSpacing: 0 }}
            >
              NAO PODE SER PASTA DE DOCUMENTOS DE WHATSAPP
            </span>
          </label>
          <input
            type="url"
            className={`input-field text-xs ${globalFieldErrors.linkGoogleDrive ? 'input-error' : ''}`}
            placeholder="https://drive.google.com/drive/folders/..."
            value={data.linkGoogleDrive || ''}
            onChange={(e) => { updateData({ linkGoogleDrive: e.target.value }); setGlobalFieldErrors(p => ({...p, linkGoogleDrive: false})); }}
          />
        </div>

        {/* Observações Internas */}
        <div>
          <label className="label-field">Observacoes Internas</label>
          <textarea
            className="input-field text-xs"
            rows={2}
            placeholder="Anotacoes internas: indicacao, observacoes sobre o cliente, etc."
            value={data.observacoesInternas || ''}
            onChange={(e) => updateData({ observacoesInternas: e.target.value })}
          />
        </div>
      </div>

      {/* Action Buttons at bottom */}
      <div className="p-3 space-y-2 pb-6">
        {/* Detailed validation errors panel */}
        {validationErrors && (
          <div className="rounded-xl overflow-hidden border border-red-300 bg-red-50 shake-error">
            <div className="px-3 py-2 bg-red-500 text-white text-[11px] font-bold uppercase tracking-wide flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Campos obrigatorios faltando
              <button onClick={() => { setValidationErrors(null); setGlobalFieldErrors({}); }}
                className="ml-auto text-white/70 hover:text-white cursor-pointer text-lg leading-none">&times;</button>
            </div>
            <div className="p-3 space-y-2 max-h-[200px] overflow-y-auto">
              {Object.entries(validationErrors).map(([section, fields]) => (
                <div key={section}>
                  <div className="text-[10px] font-bold uppercase text-red-800 mb-1">{section}</div>
                  <div className="flex flex-wrap gap-1">
                    {fields.map((f, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold border border-red-200">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completion indicator */}
        {!isFormComplete && !validationErrors && (
          <div className="p-2 rounded-lg text-[10px] font-bold uppercase text-center tracking-wide"
            style={{ background: '#FFF8ED', color: '#92400E', border: '1px solid #FDE68A' }}>
            Preencha todos os campos para salvar
          </div>
        )}

        <button
          onClick={() => handleValidatedAction(onSave)}
          onMouseDown={ripple}
          disabled={saving || !isFormComplete}
          className="btn-ripple btn-press w-full py-3.5 rounded-lg text-white font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#1B3A5C' }}
        >
          {/* (ux-5) Texto reflete edicao de contrato carregado */}
          {saving ? 'Salvando...' : loadedContractId ? 'Atualizar Contrato' : 'Salvar Contrato'}
        </button>
        <button
          onClick={() => handleValidatedAction(() => { if (onPdfSave) onPdfSave(); })}
          onMouseDown={ripple}
          disabled={saving || !isFormComplete}
          className="btn-ripple btn-press w-full py-3 rounded-lg font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 flex items-center justify-center gap-2 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, #1B3A5C, #2D5A8C)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          Gerar PDF e Salvar
        </button>
        <button
          onClick={() => handleValidatedAction(async () => {
            try {
              const { generateContractDocx } = await import('../utils/docxGenerator');
              await generateContractDocx(data);
            } catch (err) { alert('Erro ao gerar DOCX: ' + err.message); }
          })}
          disabled={saving || !isFormComplete}
          className="w-full py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#EEF4FF', color: '#1B3A5C', border: '1px solid #C0D0E8' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Exportar DOCX (Word)
        </button>
        <button
          onClick={() => handleValidatedAction(() => { if (onProcuracaoPdf) onProcuracaoPdf(); })}
          disabled={saving || !isFormComplete}
          className="w-full py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#EEF4FF', color: '#1B3A5C', border: '1px solid #C0D0E8' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          Gerar Procuracao (sem assinatura)
        </button>
        <button
          onClick={() => handleValidatedAction(onSendZapSign)}
          onMouseDown={ripple}
          disabled={saving || !isFormComplete}
          className="btn-ripple btn-press w-full py-3.5 rounded-lg text-white font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#0F2035' }}
        >
          Enviar para ZapSign
        </button>
        <button
          onClick={() => setShowClearConfirm(true)}
          className="w-full py-2.5 rounded-lg border border-red-300 text-red-500 font-bold text-[10px] uppercase tracking-wide cursor-pointer transition-all hover:bg-red-50"
        >
          Limpar Formulario
        </button>
      </div>

      {/* Clear confirmation modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowClearConfirm(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold mb-2" style={{ color: '#1B3A5C' }}>Limpar Formulario?</h3>
              <p className="text-xs text-gray-500 mb-4">Todos os dados preenchidos serao apagados. Esta acao nao pode ser desfeita.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-500 font-bold text-xs uppercase cursor-pointer hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleClearForm}
                  className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-bold text-xs uppercase cursor-pointer hover:bg-red-600"
                >
                  Sim, Limpar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
