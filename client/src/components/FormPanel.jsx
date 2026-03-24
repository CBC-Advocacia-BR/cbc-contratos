import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { API_URL } from '../config';
import { useContract } from '../ContractContext';
import { maskCPF, maskCEP, maskRG } from '../utils/masks';
import { lookupCEP, lookupCPF } from '../utils/apiLookup';
import { ESTADOS_CIVIS, RESORTS, HONORARIOS_OPCOES, PERCENTUAIS_EXITO, CLAUSULAS_PADRAO, TIPOS_ACAO } from '../data/clausulas';
import { formatCurrency, valorExtenso } from '../utils/extenso';

// ─── Progress indicator logic ───
function checkContratanteComplete(c) {
  return !!(c.nome && c.nacionalidade && c.profissao && c.estadoCivil && c.rg && c.cpf && c.email && c.cep && c.uf && c.endereco && c.bairro && c.cidade);
}

function useFormProgress(data) {
  return useMemo(() => {
    const sections = [];
    // Contratantes
    const nc = data.numContratantes;
    if (nc > 0) {
      const allDone = data.contratantes.slice(0, nc).every(checkContratanteComplete);
      sections.push({ label: 'Contratantes', done: allDone });
    } else {
      sections.push({ label: 'Contratantes', done: false });
    }
    // Resort + Acao
    const resortOk = data.resort && (data.resort !== 'outro' || data.resortCustom);
    const acaoOk = data.tipoAcao && (data.tipoAcao !== 'outro' || data.tipoAcaoCustom);
    sections.push({ label: 'Resort', done: !!(resortOk && acaoOk) });
    // Honorarios
    const h = data.honorarios;
    const honorariosDone = h.somenteExito
      ? h.percentualExito > 0
      : h.somenteIniciais
        ? !!(h.total > 0 && h.parcelas > 0 && h.dataPrimeiraParcela)
        : !!(h.total > 0 && h.parcelas > 0 && h.dataPrimeiraParcela && h.percentualExito > 0);
    sections.push({ label: 'Honorarios', done: honorariosDone });
    // Clausulas always ok (default text)
    sections.push({ label: 'Clausulas', done: true });
    return sections;
  }, [data]);
}

// ─── Circular Progress ───
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

// ─── Section with animated accordion ───
function Section({ title, children, defaultOpen = true, dark = false, done }) {
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
    <div className="card mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer text-white"
        style={{ background: dark ? '#0F2035' : '#1B3A5C' }}
      >
        <div className="flex items-center gap-2">
          {done !== undefined && (
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-300 ${done ? 'bg-green-400' : 'bg-red-400'}`} />
          )}
          <span className="text-[11px] font-bold uppercase tracking-[1px]">{title}</span>
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
      default: return value.trim().length > 0 ? 'valid' : '';
    }
  }, [value, type]);
}

function ValidationIcon({ status }) {
  if (status === 'valid') return <span className="text-green-500 text-xs ml-1">&#10003;</span>;
  if (status === 'invalid') return <span className="text-red-500 text-xs ml-1">&#10007;</span>;
  return null;
}

function ContratanteForm({ index, contratante, onChange, errors, otherContratante, numContratantes }) {
  const [cepLoading, setCepLoading] = useState(false);
  const [cpfStatus, setCpfStatus] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrStatus, setOcrStatus] = useState(''); // 'success' | 'error' | ''
  const [ocrFields, setOcrFields] = useState({}); // track which fields were filled by OCR
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef(null);

  // Real-time validation
  const vNome = useFieldValidation(contratante.nome, 'nome');
  const vCpf = useFieldValidation(contratante.cpf, 'cpf');
  const vEmail = useFieldValidation(contratante.email, 'email');
  const vCep = useFieldValidation(contratante.cep, 'cep');
  const vRg = useFieldValidation(contratante.rg, 'text');

  const handle = (field, value) => {
    // Clear OCR highlight when user manually edits
    if (ocrFields[field]) setOcrFields(prev => { const n = { ...prev }; delete n[field]; return n; });
    onChange(index, { [field]: value });
  };

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
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const resp = await fetch(`${API_URL}/api/ocr/cnh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      if (!resp.ok) throw new Error('Erro no OCR');
      const data = await resp.json();
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
      setTimeout(() => setOcrStatus(''), 4000);
    }
  }, [index, onChange]);

  const handleCNHUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) processCNHFile(file);
    e.target.value = '';
  }, [processCNHFile]);

  // Smart Tab: auto-trigger CEP lookup on Tab keydown
  const handleCEPKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      const cep = contratante.cep;
      if (cep && cep.replace(/\D/g, '').length === 8) {
        handleCEPLookup();
      }
    }
  }, [contratante.cep]);

  const handleCEPLookup = useCallback(async () => {
    const cep = contratante.cep;
    if (!cep || cep.replace(/\D/g, '').length !== 8) return;
    setCepLoading(true);
    const result = await lookupCEP(cep);
    setCepLoading(false);
    if (result) {
      onChange(index, {
        endereco: result.endereco || contratante.endereco,
        bairro: result.bairro || contratante.bairro,
        cidade: result.cidade || contratante.cidade,
        uf: result.uf || contratante.uf,
      });
    }
  }, [contratante.cep, contratante.endereco, contratante.bairro, contratante.cidade, contratante.uf, index, onChange]);

  // Smart Tab: auto-trigger CPF validation on Tab keydown
  const handleCPFKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      const cpf = contratante.cpf;
      if (cpf && cpf.replace(/\D/g, '').length === 11) {
        handleCPFValidate();
      }
    }
  }, [contratante.cpf]);

  const handleCPFValidate = useCallback(async () => {
    const cpf = contratante.cpf;
    if (!cpf || cpf.replace(/\D/g, '').length !== 11) return;
    // Se nome já foi preenchido (ex: via CNH), não consultar API
    if (contratante.nome && contratante.nome.trim().length > 3) {
      setCpfStatus('valid');
      setTimeout(() => setCpfStatus(''), 3000);
      return;
    }
    setCpfStatus('loading');
    const result = await lookupCPF(cpf);
    if (!result?.valid) {
      setCpfStatus('invalid');
      setTimeout(() => setCpfStatus(''), 3000);
      return;
    }
    setCpfStatus('valid');
    setTimeout(() => setCpfStatus(''), 5000);
    // Auto-fill nome from CPF API
    if (result.nome) {
      onChange(index, { nome: result.nome });
    }
  }, [contratante.cpf, contratante.nome, index, onChange]);

  // "Mesmo endereco" - copy address from contratante 1
  const handleCopyAddress = () => {
    if (!otherContratante) return;
    onChange(index, {
      endereco: otherContratante.endereco,
      complemento: otherContratante.complemento,
      bairro: otherContratante.bairro,
      cidade: otherContratante.cidade,
      uf: otherContratante.uf,
      cep: otherContratante.cep,
    });
  };

  const showCopyAddress = index === 1 && numContratantes === 2 && otherContratante?.endereco;

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
          <label className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide cursor-pointer transition-all ${
            ocrLoading ? 'bg-gray-200 text-gray-400' : ocrStatus === 'success' ? 'bg-green-100 text-green-700' : ocrStatus === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
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
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="label-field">CPF *
            {cpfStatus === 'loading' && <span className="text-blue-500 text-[9px] ml-1 animate-pulse">buscando...</span>}
            {cpfStatus !== 'loading' && <ValidationIcon status={vCpf} />}
          </label>
          <input className={`input-field ${ocrClass('cpf')} ${errors.cpf ? 'input-error' : vCpf === 'valid' ? 'input-valid' : vCpf === 'invalid' ? 'input-invalid' : ''}`}
            value={contratante.cpf} onChange={(e) => handle('cpf', maskCPF(e.target.value))}
            onBlur={handleCPFValidate} onKeyDown={handleCPFKeyDown} placeholder="000.000.000-00" autoFocus={index === 0} />
        </div>
        <div>
          <label className="label-field">RG * <ValidationIcon status={vRg} /></label>
          <input className={`input-field ${ocrClass('rg')} ${errors.rg ? 'input-error' : ''}`}
            value={contratante.rg} onChange={(e) => handle('rg', maskRG(e.target.value))} placeholder="Numero do RG" />
        </div>
        <div className="col-span-2">
          <label className="label-field">Nome Completo * <ValidationIcon status={vNome} /></label>
          <input className={`input-field ${ocrClass('nome')} ${errors.nome ? 'input-error' : vNome === 'valid' ? 'input-valid' : ''}`}
            value={contratante.nome} onChange={(e) => handle('nome', e.target.value)} placeholder="Nome completo" />
        </div>
        <div>
          <label className="label-field">Nacionalidade *</label>
          <input className={`input-field ${ocrClass('nacionalidade')} ${errors.nacionalidade ? 'input-error' : ''}`}
            value={contratante.nacionalidade} onChange={(e) => handle('nacionalidade', e.target.value)} />
        </div>
        <div>
          <label className="label-field">Profissao *</label>
          <input className={`input-field ${ocrClass('profissao')} ${errors.profissao ? 'input-error' : ''}`}
            value={contratante.profissao} onChange={(e) => handle('profissao', e.target.value)} placeholder="Ex: empresario" />
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
          <input className={`input-field ${ocrClass('email')} ${errors.email ? 'input-error' : vEmail === 'valid' ? 'input-valid' : ''}`} type="email"
            value={contratante.email} onChange={(e) => handle('email', e.target.value)} placeholder="email@exemplo.com" />
        </div>

        {showCopyAddress && (
          <div className="col-span-2">
            <button onClick={handleCopyAddress}
              className="w-full py-2 rounded-lg border-2 border-dashed text-xs font-bold uppercase tracking-wide cursor-pointer transition-all hover:bg-blue-50"
              style={{ borderColor: '#1B3A5C', color: '#1B3A5C' }}>
              Mesmo endereco do Contratante 1
            </button>
          </div>
        )}

        <div>
          <label className="label-field">CEP * <ValidationIcon status={vCep} /> {cepLoading && <span className="text-navy text-[9px]">buscando...</span>}</label>
          <input className={`input-field ${ocrClass('cep')} ${errors.cep ? 'input-error' : vCep === 'valid' ? 'input-valid' : ''}`}
            value={contratante.cep} onChange={(e) => handle('cep', maskCEP(e.target.value))}
            onBlur={handleCEPLookup} onKeyDown={handleCEPKeyDown} placeholder="00000-000" />
        </div>
        <div>
          <label className="label-field">UF *</label>
          <input className={`input-field ${ocrClass('uf')} ${errors.uf ? 'input-error' : ''}`}
            value={contratante.uf} onChange={(e) => handle('uf', e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" maxLength={2} />
        </div>
        <div className="col-span-2">
          <label className="label-field">Endereco (Rua, N) *</label>
          <input className={`input-field ${ocrClass('endereco')} ${errors.endereco ? 'input-error' : ''}`}
            value={contratante.endereco} onChange={(e) => handle('endereco', e.target.value)} placeholder="Rua Exemplo, 123" />
        </div>
        <div className="col-span-2">
          <label className="label-field">Complemento</label>
          <input className={`input-field ${ocrClass('complemento')}`}
            value={contratante.complemento || ''} onChange={(e) => handle('complemento', e.target.value)} placeholder="Apto, Bloco, Sala..." />
        </div>
        <div>
          <label className="label-field">Bairro *</label>
          <input className={`input-field ${ocrClass('bairro')} ${errors.bairro ? 'input-error' : ''}`}
            value={contratante.bairro} onChange={(e) => handle('bairro', e.target.value)} placeholder="Bairro" />
        </div>
        <div>
          <label className="label-field">Cidade *</label>
          <input className={`input-field ${ocrClass('cidade')} ${errors.cidade ? 'input-error' : ''}`}
            value={contratante.cidade} onChange={(e) => handle('cidade', e.target.value)} placeholder="Cidade" />
        </div>
      </div>
    </div>
  );
}

// ─── Main FormPanel ───
export default function FormPanel({ onSave, onSendZapSign, onPdfPreview, onPdfSave, onProcuracaoPdf, saving }) {
  const { data, updateData, updateContratante, updateHonorarios, getClausulaTexto, updateClausula, resetClausula, isClausulaModificada, getClausulasOrdenadas, reorderClausulas, addClausulaAvulsa, removeClausulaAvulsa, resetAll } = useContract();
  const [errors, setErrors] = useState([{}, {}]);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showAddClausula, setShowAddClausula] = useState(false);
  const [newClausulaTitulo, setNewClausulaTitulo] = useState('');
  const [newClausulaTexto, setNewClausulaTexto] = useState('');
  const h = data.honorarios;
  const progress = useFormProgress(data);

  const handleClearForm = () => {
    resetAll();
    setShowClearConfirm(false);
  };

  const [validationMsg, setValidationMsg] = useState('');

  // Full form validation
  const validateForm = useCallback(() => {
    const missing = [];
    const newErrors = [{}, {}];
    const num = data.numContratantes || 0;
    if (num === 0) { missing.push('Selecione o numero de contratantes'); }
    for (let i = 0; i < num; i++) {
      const c = data.contratantes[i];
      const label = `Contratante ${i + 1}`;
      const fields = { nome: 'Nome', cpf: 'CPF', rg: 'RG', nacionalidade: 'Nacionalidade', profissao: 'Profissao', estadoCivil: 'Estado Civil', email: 'E-mail', cep: 'CEP', uf: 'UF', endereco: 'Endereco', bairro: 'Bairro', cidade: 'Cidade' };
      for (const [key, name] of Object.entries(fields)) {
        if (!c[key] || !c[key].trim()) { missing.push(`${label}: ${name}`); newErrors[i][key] = true; }
      }
    }
    if (!data.resort || (data.resort === 'outro' && !data.resortCustom)) missing.push('Resort');
    if (!data.tipoAcao || (data.tipoAcao === 'outro' && !data.tipoAcaoCustom)) missing.push('Tipo de Acao');
    const ho = data.honorarios;
    if (!ho.somenteExito) {
      if (!ho.total || ho.total <= 0) missing.push('Valor dos honorarios');
      if (!ho.parcelas || ho.parcelas <= 0) missing.push('Numero de parcelas');
      if (!ho.dataPrimeiraParcela) missing.push('Data da 1a parcela');
    }
    if (!ho.somenteIniciais && (!ho.percentualExito || ho.percentualExito <= 0)) missing.push('Percentual de exito');
    setErrors(newErrors);
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
    return true;
  }, [data]);

  const handleValidatedAction = useCallback((action) => {
    const missing = validateForm();
    if (missing.length > 0) {
      setValidationMsg(`Campos obrigatorios: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` e mais ${missing.length - 3}` : ''}`);
      setTimeout(() => setValidationMsg(''), 5000);
      return;
    }
    action();
  }, [validateForm]);

  const formRef = useRef(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const percent = useMemo(() => Math.round((progress.filter(s => s.done).length / progress.length) * 100), [progress]);

  // Sticky header: show after scrolling past the progress bar
  useEffect(() => {
    const container = formRef.current?.closest('[class*="overflow-y-auto"]') || formRef.current?.parentElement;
    if (!container) return;
    const handleScroll = () => setShowStickyHeader(container.scrollTop > 100);
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const c1 = data.contratantes[0];
  const resortName = data.resort === 'outro' ? data.resortCustom : data.resort;

  return (
    <div ref={formRef} className="px-2 py-2 md:p-3 w-full overflow-hidden relative">
      {/* Sticky Summary Header */}
      {showStickyHeader && (c1?.nome || resortName) && (
        <div className="sticky-summary -mx-2 md:-mx-3 -mt-2 md:-mt-3 mb-2 px-3 py-2 flex items-center justify-between text-white text-[10px]">
          <div className="flex items-center gap-3 min-w-0">
            <CircularProgress percent={percent} />
            <div className="min-w-0">
              {c1?.nome && <div className="font-bold truncate">{c1.nome}</div>}
              {resortName && <div className="opacity-70 truncate">{resortName}{data.tipoAcao ? ` — ${data.tipoAcao}` : ''}</div>}
            </div>
          </div>
          {h.total > 0 && <div className="text-right shrink-0 font-bold">{formatCurrency(h.total)}</div>}
        </div>
      )}

      {/* Progress Bar with Circle */}
      <div className="flex items-center gap-2 mb-3 px-1 overflow-hidden">
        <CircularProgress percent={percent} />
        <div className="flex-1 flex items-center gap-1">
          {progress.map((s, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
              <div className={`w-full h-1.5 rounded-full transition-colors duration-500 ${s.done ? 'bg-green-400' : 'bg-gray-200'}`} />
              <span className={`text-[8px] md:text-[9px] font-bold uppercase truncate transition-colors duration-300 ${s.done ? 'text-green-600' : 'text-gray-400'}`}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* N Contratantes */}
      <Section title="Contratantes" done={progress[0].done}>
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
              <ContratanteForm key={i} index={i} contratante={data.contratantes[i]}
                onChange={updateContratante} errors={errors[i] || {}}
                otherContratante={i === 1 ? data.contratantes[0] : null}
                numContratantes={data.numContratantes} />
            ))}
          </div>
        )}
      </Section>

      {/* Resort */}
      <Section title="Resort" done={progress[1].done}>
        <label className="label-field">Empreendimento / Resort *</label>
        <select
          className="input-field mb-3"
          value={data.resort || ''}
          onChange={(e) => updateData({ resort: e.target.value, resortCustom: '', tipoAcao: '', tipoAcaoCustom: '' })}
        >
          <option value="">Selecione o resort...</option>
          {RESORTS.map(r => <option key={r} value={r}>{r}</option>)}
          <option value="outro">+ Novo Resort</option>
        </select>
        {data.resort === 'outro' && (
          <div className="mb-3">
            <label className="label-field">Nome do Novo Resort *</label>
            <input className="input-field" placeholder="Digite o nome do resort..."
              value={data.resortCustom || ''} onChange={(e) => updateData({ resortCustom: e.target.value })} />
          </div>
        )}

        {data.resort && (
          <div className="mt-1">
            <label className="label-field">Tipo de Acao *</label>
            <select
              className="input-field mb-2"
              value={data.tipoAcao || ''}
              onChange={(e) => updateData({ tipoAcao: e.target.value, tipoAcaoCustom: '' })}
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
          </div>
        )}
      </Section>

      {/* Honorarios */}
      <Section title="Honorarios Advocaticios" dark done={progress[2].done}>
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
          {HONORARIOS_OPCOES.map((opt, idx) => {
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
              <input type="number" className="input-field" value={h.total || ''} onChange={(e) => {
                const total = Number(e.target.value);
                const vp = h.parcelas > 0 ? Math.round((total / h.parcelas) * 100) / 100 : 0;
                updateHonorarios({ total, valorParcela: vp });
              }} />
            </div>
            <div>
              <label className="label-field">Parcelas</label>
              <input type="number" className="input-field" value={h.parcelas || ''} onChange={(e) => {
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
        <input type="date" className="input-field" value={h.dataPrimeiraParcela || ''}
          onChange={(e) => updateHonorarios({ dataPrimeiraParcela: e.target.value })} />
          </>
        )}

        {!h.somenteIniciais && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-gray-500 mt-4 mb-2">
              {h.somenteExito ? 'Honorarios de Exito (%)' : 'Honorarios Contratuais (%)'}
            </div>
            <div className="flex items-center gap-1">
              <input type="number" className="input-field text-center" style={{ maxWidth: '80px' }}
                value={h.percentualExito || ''} min={1} max={100}
                onChange={(e) => updateHonorarios({ percentualExito: Number(e.target.value) || 0 })} />
              <span className="text-sm text-gray-500 font-bold">%</span>
            </div>
          </>
        )}

      </Section>

      {/* Clausulas */}
      <Section title="Clausulas do Contrato" defaultOpen={false} done={progress[3].done}>
        <p className="text-xs text-gray-500 mb-2">Arraste para reordenar. Clique em "Editar" para modificar.</p>
        <div className="space-y-2">
          {(() => {
            const orderedIds = getClausulasOrdenadas();
            const allClausulas = [...CLAUSULAS_PADRAO, ...(data.clausulasAvulsas || []).map(a => ({ ...a, editavel: true, avulsa: true }))];
            const filtered = orderedIds
              .map(id => allClausulas.find(c => c.id === id))
              .filter(Boolean)
              .filter(cl => {
                if (h.somenteExito && ['clausula2_p3', 'clausula2_p5', 'clausula2_p7'].includes(cl.id)) return false;
                if (h.somenteIniciais && ['clausula2_p2'].includes(cl.id)) return false;
                return true;
              });

            // Renumber main clauses dynamically
            let clausulaNum = 0;
            const numberedMap = {};
            filtered.forEach(cl => {
              if (!cl.paragrafo && !cl.id.includes('_p')) {
                clausulaNum++;
                numberedMap[cl.id] = clausulaNum;
              }
            });

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
                  draggable
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

      {/* Action Buttons at bottom */}
      <div className="p-3 space-y-2 pb-6">
        {/* Validation message */}
        {validationMsg && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px] font-medium flex items-start gap-2">
            <svg className="w-4 h-4 shrink-0 mt-0.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span>{validationMsg}</span>
          </div>
        )}

        {/* Completion indicator */}
        {!isFormComplete && (
          <div className="p-2 rounded-lg text-[10px] font-bold uppercase text-center tracking-wide"
            style={{ background: '#FFF8ED', color: '#92400E', border: '1px solid #FDE68A' }}>
            Preencha todos os campos para salvar
          </div>
        )}

        <button
          onClick={() => handleValidatedAction(onSave)}
          disabled={saving || !isFormComplete}
          className="w-full py-3.5 rounded-lg text-white font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#1B3A5C' }}
        >
          {saving ? 'Salvando...' : 'Salvar Contrato'}
        </button>
        <button
          onClick={() => handleValidatedAction(() => { if (onPdfSave) onPdfSave(); })}
          disabled={saving || !isFormComplete}
          className="w-full py-3 rounded-lg font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 flex items-center justify-center gap-2 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, #1B3A5C, #2D5A8C)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          Gerar PDF e Salvar
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
          disabled={saving || !isFormComplete}
          className="w-full py-3.5 rounded-lg text-white font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
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
