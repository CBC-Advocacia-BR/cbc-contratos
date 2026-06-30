// =============================================================
// ImportContratoModal.jsx — modal de importacao manual de contrato
// =============================================================
// Wizard de 4 steps:
//   1. Dados basicos do contrato (contratantes, resort, honorarios)
//   2. Anexos (PDFs + link Drive)
//   3. Automacoes (ADVBOX, Drive, Asaas)
//   4. Confirmacao + execucao com timeline em tempo real
//
// NAO mexe no fluxo padrao de criacao via wizard. Apenas cria contrato
// ja com status="assinado" + flag imported_manually=true.
// =============================================================

import { useState, useMemo, useEffect } from 'react';
import {
  XMarkIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  PaperClipIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  PauseCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { maskCPF, maskPhone } from '../utils/masks';
import { validateCPF, validateEmail } from '../utils/validation';
import { useEmpreendimentos } from '../hooks/useEmpreendimentos';
import { TIPOS_ACAO } from '../data/clausulas';
import { processImport, checkAutomacaoRequisitos } from '../utils/importContrato';
import { supabase } from '../lib/supabase';

// ─── Estado inicial ────────────────────────────────────────────
const EMPTY_CONTRATANTE = {
  nome: '',
  cpf: '',
  email: '',
  telefone: '',
  linkKommo: '',
};

const EMPTY_HONORARIOS = {
  modo: 'iniciais_exito', // 'iniciais' | 'exito' | 'iniciais_exito'
  total: '',
  parcelas: '',
  dataPrimeiraParcela: '',
  percentualExito: '',
};

function todayISO() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

// ─── Utils ─────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      // remove prefixo "data:application/pdf;base64,"
      const idx = String(result).indexOf(',');
      resolve(idx >= 0 ? String(result).slice(idx + 1) : String(result));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fmtBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Componente principal ──────────────────────────────────────
export default function ImportContratoModal({ onClose, onImported }) {
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  // Email do usuario logado (para imported_by)
  const [userEmail, setUserEmail] = useState('');
  // Lista de vendedoras (perfil_vendas='vendedora')
  const [vendedoras, setVendedoras] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (mounted && user?.email) setUserEmail(user.email);
      } catch { /* silent */ }
      try {
        const { data } = await supabase
          .from('user_permissions')
          .select('email, display_name, perfil_vendas')
          .eq('perfil_vendas', 'vendedora');
        if (mounted && Array.isArray(data)) setVendedoras(data);
      } catch { /* silent — feature opcional */ }
    })();
    return () => { mounted = false; };
  }, []);

  // ─── Estado do form ──────────────────────────────────────
  const [hasContratante2, setHasContratante2] = useState(false);
  const [contratantes, setContratantes] = useState([{ ...EMPTY_CONTRATANTE }]);
  const [resort, setResort] = useState('');
  const [resortCustom, setResortCustom] = useState('');
  const [tipoAcao, setTipoAcao] = useState('');
  const [tipoAcaoCustom, setTipoAcaoCustom] = useState('');
  const [dataAssinatura, setDataAssinatura] = useState(todayISO());
  const [honorarios, setHonorarios] = useState({ ...EMPTY_HONORARIOS });
  const [pasta, setPasta] = useState('');
  const [vendedora, setVendedora] = useState('');
  const [origemCliente, setOrigemCliente] = useState('');

  // Anexos
  const [anexos, setAnexos] = useState({
    contratoPdf: null, // { name, size, base64 }
    procuracaoPdf: null,
  });
  const [linkGoogleDrive, setLinkGoogleDrive] = useState('');
  const [anexoErro, setAnexoErro] = useState('');

  // Automacoes — default tudo desmarcado
  // (chatguru removal 2026-05) chatguru removido
  const [automacoes, setAutomacoes] = useState({
    advbox: false,
    drive: false,
    asaas: false,
  });

  // Execucao
  const [executing, setExecuting] = useState(false);
  const [execSteps, setExecSteps] = useState([]);
  const [execDone, setExecDone] = useState(false);
  const [execContractId, setExecContractId] = useState(null);
  const [execError, setExecError] = useState('');

  // Validacao por step (calculada)
  const [touched, setTouched] = useState({});

  const { list: resorts } = useEmpreendimentos();

  // Atualiza um campo do contratante
  const setContratanteField = (idx, field, value) => {
    setContratantes((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  // Toggle contratante 2
  const toggleContratante2 = () => {
    if (hasContratante2) {
      setContratantes((prev) => prev.slice(0, 1));
    } else {
      setContratantes((prev) => [...prev, { ...EMPTY_CONTRATANTE }]);
    }
    setHasContratante2(!hasContratante2);
  };

  // ─── Validacao Step 1 ─────────────────────────────────────
  const step1Errors = useMemo(() => {
    const errs = {};
    const c1 = contratantes[0] || {};
    if (!c1.nome?.trim()) errs.c1_nome = 'Obrigatorio';
    if (!c1.cpf?.trim()) errs.c1_cpf = 'Obrigatorio';
    else if (!validateCPF(c1.cpf)) errs.c1_cpf = 'CPF invalido';
    if (c1.email?.trim() && !validateEmail(c1.email)) errs.c1_email = 'E-mail invalido';

    if (hasContratante2) {
      const c2 = contratantes[1] || {};
      if (c2.cpf?.trim() && !validateCPF(c2.cpf)) errs.c2_cpf = 'CPF invalido';
      if (c2.email?.trim() && !validateEmail(c2.email)) errs.c2_email = 'E-mail invalido';
    }

    const resortFinal = resort === 'outro' ? resortCustom?.trim() : resort?.trim();
    if (!resortFinal) errs.resort = 'Obrigatorio';

    const tipoFinal = tipoAcao === 'outro' ? tipoAcaoCustom?.trim() : tipoAcao?.trim();
    if (!tipoFinal) errs.tipoAcao = 'Obrigatorio';

    if (!dataAssinatura) errs.dataAssinatura = 'Obrigatorio';

    // Honorarios — pelo menos um modo deve preencher seus campos
    const modo = honorarios.modo;
    if (modo === 'iniciais' || modo === 'iniciais_exito') {
      if (!Number(honorarios.total) || Number(honorarios.total) <= 0) {
        errs.hon_total = 'Obrigatorio';
      }
    }
    if (modo === 'exito' || modo === 'iniciais_exito') {
      if (
        !Number(honorarios.percentualExito) ||
        Number(honorarios.percentualExito) <= 0
      ) {
        errs.hon_exito = 'Obrigatorio';
      }
    }
    return errs;
  }, [
    contratantes,
    hasContratante2,
    resort,
    resortCustom,
    tipoAcao,
    tipoAcaoCustom,
    dataAssinatura,
    honorarios,
  ]);

  const step1Valid = Object.keys(step1Errors).length === 0;

  // ─── Monta o "data" final para passar ao processImport ───
  const buildFinalData = () => {
    const ctList = contratantes.map((c) => ({
      ...c,
      // garante string vazia em vez de undefined
      nome: c.nome || '',
      cpf: c.cpf || '',
      email: c.email || '',
      telefone: c.telefone || '',
      linkKommo: c.linkKommo || c.linkChatguru || '', // fallback legado
    }));
    // Calcula valorParcela a partir de total/parcelas
    const total = Number(honorarios.total) || 0;
    const parcelas = Number(honorarios.parcelas) || 0;
    const valorParcela = parcelas > 0 ? total / parcelas : 0;

    return {
      contratantes: ctList,
      numContratantes: hasContratante2 ? 2 : 1,
      resort,
      resortCustom,
      tipoAcao,
      tipoAcaoCustom,
      dataAssinatura,
      honorarios: {
        somenteIniciais: honorarios.modo === 'iniciais',
        somenteExito: honorarios.modo === 'exito',
        total,
        parcelas,
        valorParcela,
        dataPrimeiraParcela: honorarios.dataPrimeiraParcela || null,
        percentualExito: Number(honorarios.percentualExito) || 0,
      },
      pasta: pasta || null,
      vendedora: vendedora || null,
      origemCliente: origemCliente || null,
      linkGoogleDrive: linkGoogleDrive || null,
      observacoesInternas: '',
      escritorioArcaCustas: false,
    };
  };

  // ─── Requisitos das automacoes (dinamico) ──────────────
  const requisitosOk = useMemo(
    () => checkAutomacaoRequisitos(buildFinalData(), anexos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contratantes, hasContratante2, honorarios, linkGoogleDrive, anexos]
  );

  // Garante que automacoes desmarcam se requisito quebrar
  useEffect(() => {
    setAutomacoes((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const k of Object.keys(prev)) {
        if (prev[k] && !requisitosOk[k]) {
          next[k] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [requisitosOk]);

  // ─── Handlers de anexos ────────────────────────────────
  const handleFileUpload = async (key, fileList) => {
    setAnexoErro('');
    const file = fileList?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setAnexoErro('Apenas arquivos PDF sao aceitos');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAnexoErro('Arquivo maior que 10MB');
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      setAnexos((prev) => ({
        ...prev,
        [key]: { name: file.name, size: file.size, base64 },
      }));
    } catch (err) {
      setAnexoErro('Erro ao ler arquivo: ' + err.message);
    }
  };

  const removeAnexo = (key) => {
    setAnexos((prev) => ({ ...prev, [key]: null }));
  };

  // ─── Avancar / Voltar ──────────────────────────────────
  const goNext = () => {
    if (step === 1 && !step1Valid) {
      // marca tudo como "touched" pra mostrar erros
      setTouched({
        c1_nome: true,
        c1_cpf: true,
        c1_email: true,
        resort: true,
        tipoAcao: true,
        dataAssinatura: true,
        hon_total: true,
        hon_exito: true,
      });
      return;
    }
    if (step < totalSteps) setStep(step + 1);
  };

  const goBack = () => {
    if (step > 1 && !executing) setStep(step - 1);
  };

  // ─── Executar import ───────────────────────────────────
  const handleExecutar = async () => {
    setExecuting(true);
    setExecError('');
    const data = buildFinalData();
    try {
      const result = await processImport({
        data,
        anexos,
        automacoes,
        userEmail,
        onProgress: ({ steps }) => setExecSteps([...steps]),
      });
      setExecContractId(result.contractId);
      setExecDone(true);
      if (result.error) {
        setExecError(result.error);
      }
    } catch (err) {
      setExecError(err.message || 'Erro inesperado');
    } finally {
      setExecuting(false);
    }
  };

  // Retry de um step individual (apenas advbox/drive/asaas)
  const handleRetryStep = async (key) => {
    const data = buildFinalData();
    // Marca apenas o step alvo como pending e re-executa o fluxo completo
    // (a logica em processImport ja salva contrato so se o "salvar" estiver pending —
    //  como retry e raro e deve criar contrato novo seria bug, entao bloqueamos).
    if (!execContractId) {
      setExecError('Sem contrato base para retry — execute primeiro o passo Salvar.');
      return;
    }
    // Estrategia simples: reaproveita processImport so pra automacao especifica,
    // sem re-criar contrato. Para isso, montamos um fluxo manual aqui.
    const stepIdx = execSteps.findIndex((s) => s.key === key);
    if (stepIdx < 0) return;

    // Cria copia mutavel
    const newSteps = execSteps.map((s, i) =>
      i === stepIdx ? { ...s, status: 'running', info: undefined } : s
    );
    setExecSteps(newSteps);

    try {
      if (key === 'advbox') {
        const resp = await fetch('/.netlify/functions/advbox-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...data,
            user_email: userEmail,
            dataAssinatura: data.dataAssinatura,
          }),
        });
        const json = await resp.json();
        if (!json.success) throw new Error(json.warnings?.join(', ') || json.error || 'erro');
        await supabase
          .from('contratos')
          .update({
            advbox_status: 'ok',
            advbox_date: new Date().toISOString(),
            advbox_data: json,
            advbox_lawsuit_id: json.lawsuit?.id || null,
            import_advbox_customer_id: json.customers?.[0]?.id?.toString() || null,
            import_advbox_lawsuit_id: json.lawsuit?.id?.toString() || null,
          })
          .eq('id', execContractId);
        const customers = json.customers?.length || 0;
        const lawsuit = json.lawsuit?.id ? `lawsuit=${json.lawsuit.id}` : 'sem processo';
        setExecSteps((prev) =>
          prev.map((s, i) =>
            i === stepIdx ? { ...s, status: 'ok', info: `${customers} cliente(s), ${lawsuit}` } : s
          )
        );
      } else if (key === 'drive') {
        const filesPayload = [];
        if (anexos?.contratoPdf?.base64)
          filesPayload.push({ name: 'CONTRATO ASSINADO.pdf', base64: anexos.contratoPdf.base64 });
        if (anexos?.procuracaoPdf?.base64)
          filesPayload.push({
            name: 'PROCURACAO ASSINADA.pdf',
            base64: anexos.procuracaoPdf.base64,
          });
        const resp = await fetch('/.netlify/functions/save-to-drive-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            driveFolderUrl: data.linkGoogleDrive,
            files: filesPayload,
          }),
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) throw new Error(json.error || 'erro');
        await supabase
          .from('contratos')
          .update({
            drive_file_id: json.files?.[0]?.fileId || 'saved',
            drive_file_link: json.files?.[0]?.fileUrl || null,
          })
          .eq('id', execContractId);
        setExecSteps((prev) =>
          prev.map((s, i) =>
            i === stepIdx
              ? { ...s, status: 'ok', info: `${json.files?.length || 0} arquivo(s)` }
              : s
          )
        );
      } else if (key === 'asaas') {
        const total = Number(honorarios.total || 0);
        const parcelas = Number(honorarios.parcelas || 0);
        const c1 = contratantes[0] || {};
        const resp = await fetch('/.netlify/functions/asaas-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome: c1.nome,
            cpf: (c1.cpf || '').replace(/\D/g, ''),
            email: c1.email,
            telefone: c1.telefone,
            valor: total,
            parcelas,
            dataPrimeiraParcela: honorarios.dataPrimeiraParcela,
            descricao: `Honorarios contrato ${data.resort} - ${data.tipoAcao}`,
            contratoId: execContractId,
          }),
        });
        const json = await resp.json();
        if (!resp.ok || json.error) throw new Error(json.error || `HTTP ${resp.status}`);
        setExecSteps((prev) =>
          prev.map((s, i) =>
            i === stepIdx ? { ...s, status: 'ok', info: `${parcelas} parcela(s)` } : s
          )
        );
      }
      // (chatguru removal 2026-05) retry chatguru removido
    } catch (err) {
      setExecSteps((prev) =>
        prev.map((s, i) =>
          i === stepIdx ? { ...s, status: 'error', info: err.message || 'erro' } : s
        )
      );
    }
  };

  const handleFechar = () => {
    if (executing) return;
    if (execDone && execContractId) {
      onImported?.(execContractId);
    } else {
      onClose?.();
    }
  };

  // ─── Render ────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-backdrop-glass"
      onClick={() => { if (window.matchMedia('(pointer: coarse)').matches) handleFechar(); }}
    >
      <div
        className="modal-glass rounded-2xl w-full max-w-[700px] max-h-[90vh] max-sm:max-h-[90dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-white/40 flex items-center justify-between bg-white/40 backdrop-blur dark:bg-gray-900/40 dark:border-gray-700/40">
          <div>
            <div className="text-base font-bold flex items-center gap-2" style={{ color: '#1B3A5C' }}>
              <span aria-hidden="true">📥</span>
              Importar contrato assinado
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Etapa {step} de {totalSteps}
              {step === 1 && ' — Dados basicos'}
              {step === 2 && ' — Anexos (opcional)'}
              {step === 3 && ' — Automacoes'}
              {step === 4 && ' — Confirmacao e execucao'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Progress dots */}
            <div className="hidden sm:flex items-center gap-1">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="w-2 h-2 rounded-full transition-all"
                  style={{
                    background:
                      n < step ? '#16A34A' : n === step ? '#1B3A5C' : 'rgba(0,0,0,0.15)',
                  }}
                  aria-label={`Step ${n}${n === step ? ' (atual)' : ''}`}
                />
              ))}
            </div>
            <button
              onClick={handleFechar}
              disabled={executing}
              className="p-1.5 rounded-lg hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition disabled:opacity-50"
              aria-label="Fechar"
            >
              <XMarkIcon className="w-5 h-5 text-gray-500 dark:text-gray-300" />
            </button>
          </div>
        </div>

        {/* Body — scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-5 text-sm">
          {step === 1 && (
            <Step1
              contratantes={contratantes}
              setContratanteField={setContratanteField}
              hasContratante2={hasContratante2}
              toggleContratante2={toggleContratante2}
              resort={resort}
              setResort={setResort}
              resortCustom={resortCustom}
              setResortCustom={setResortCustom}
              tipoAcao={tipoAcao}
              setTipoAcao={setTipoAcao}
              tipoAcaoCustom={tipoAcaoCustom}
              setTipoAcaoCustom={setTipoAcaoCustom}
              dataAssinatura={dataAssinatura}
              setDataAssinatura={setDataAssinatura}
              honorarios={honorarios}
              setHonorarios={setHonorarios}
              pasta={pasta}
              setPasta={setPasta}
              vendedora={vendedora}
              setVendedora={setVendedora}
              vendedoras={vendedoras}
              origemCliente={origemCliente}
              setOrigemCliente={setOrigemCliente}
              resorts={resorts}
              errors={step1Errors}
              touched={touched}
            />
          )}

          {step === 2 && (
            <Step2
              anexos={anexos}
              handleFileUpload={handleFileUpload}
              removeAnexo={removeAnexo}
              linkGoogleDrive={linkGoogleDrive}
              setLinkGoogleDrive={setLinkGoogleDrive}
              anexoErro={anexoErro}
            />
          )}

          {step === 3 && (
            <Step3
              automacoes={automacoes}
              setAutomacoes={setAutomacoes}
              requisitosOk={requisitosOk}
            />
          )}

          {step === 4 && (
            <Step4
              data={buildFinalData()}
              anexos={anexos}
              automacoes={automacoes}
              execSteps={execSteps}
              execDone={execDone}
              execError={execError}
              onRetry={handleRetryStep}
            />
          )}
        </div>

        {/* Footer fixo */}
        <div className="shrink-0 px-5 py-3 border-t border-white/40 bg-white/40 backdrop-blur flex items-center gap-2 dark:bg-gray-900/40 dark:border-gray-700/40">
          {step > 1 && !execDone && (
            <button
              onClick={goBack}
              disabled={executing}
              className="px-3 py-1.5 text-xs font-bold uppercase rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Voltar
            </button>
          )}
          <div className="flex-1" />
          {!execDone && (
            <button
              onClick={handleFechar}
              disabled={executing}
              className="px-3 py-1.5 text-xs font-bold uppercase rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancelar
            </button>
          )}
          {step < totalSteps && (
            <button
              onClick={goNext}
              disabled={step === 1 && !step1Valid}
              className="px-4 py-1.5 text-xs font-bold uppercase rounded-lg text-white flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              style={{ background: '#1B3A5C' }}
              title={step === 1 && !step1Valid ? 'Preencha os campos obrigatorios' : ''}
            >
              Avancar <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {step === totalSteps && !execDone && !executing && (
            <button
              onClick={handleExecutar}
              className="px-5 py-2 text-xs font-bold uppercase rounded-lg text-white flex items-center gap-1.5"
              style={{ background: '#16A34A' }}
            >
              <CheckCircleIcon className="w-4 h-4" /> Importar e processar
            </button>
          )}
          {execDone && (
            <button
              onClick={handleFechar}
              className="px-4 py-1.5 text-xs font-bold uppercase rounded-lg text-white flex items-center gap-1"
              style={{ background: '#1B3A5C' }}
            >
              Fechar e ver contrato
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===============================================================
//  STEP 1 — Dados basicos
// ===============================================================
function Step1({
  contratantes,
  setContratanteField,
  hasContratante2,
  toggleContratante2,
  resort,
  setResort,
  resortCustom,
  setResortCustom,
  tipoAcao,
  setTipoAcao,
  tipoAcaoCustom,
  setTipoAcaoCustom,
  dataAssinatura,
  setDataAssinatura,
  honorarios,
  setHonorarios,
  pasta,
  setPasta,
  vendedora,
  setVendedora,
  vendedoras,
  origemCliente,
  setOrigemCliente,
  resorts,
  errors,
  touched,
}) {
  const showErr = (key) => touched[key] && errors[key];

  const inputCls = (errKey) =>
    `w-full border rounded-lg px-3 py-2 text-sm focus:outline-none transition ${
      showErr(errKey)
        ? 'border-red-400 focus:border-red-500'
        : 'border-gray-300 focus:border-[#1B3A5C] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
    }`;

  const labelCls = 'block text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1';

  return (
    <div className="space-y-5">
      {/* ── Contratante 1 ── */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#1B3A5C' }}>
          Contratante 1
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className={labelCls}>Nome completo *</label>
            <input
              type="text"
              value={contratantes[0]?.nome || ''}
              onChange={(e) => setContratanteField(0, 'nome', e.target.value)}
              className={inputCls('c1_nome')}
              placeholder="Maria Souza"
            />
            {showErr('c1_nome') && <ErrText msg={errors.c1_nome} />}
          </div>
          <div>
            <label className={labelCls}>CPF *</label>
            <input
              type="text"
              value={contratantes[0]?.cpf || ''}
              onChange={(e) => setContratanteField(0, 'cpf', maskCPF(e.target.value))}
              className={inputCls('c1_cpf')}
              placeholder="000.000.000-00"
            />
            {showErr('c1_cpf') && <ErrText msg={errors.c1_cpf} />}
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input
              type="email"
              value={contratantes[0]?.email || ''}
              onChange={(e) => setContratanteField(0, 'email', e.target.value)}
              className={inputCls('c1_email')}
              placeholder="maria@exemplo.com"
            />
            {showErr('c1_email') && <ErrText msg={errors.c1_email} />}
          </div>
          <div>
            <label className={labelCls}>Telefone</label>
            <input
              type="text"
              value={contratantes[0]?.telefone || ''}
              onChange={(e) => setContratanteField(0, 'telefone', maskPhone(e.target.value))}
              className={inputCls('c1_telefone')}
              placeholder="(11) 99999-9999"
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Link Kommo</label>
            <input
              type="url"
              value={contratantes[0]?.linkKommo || ''}
              onChange={(e) => setContratanteField(0, 'linkKommo', e.target.value)}
              className={inputCls('c1_kommo')}
              placeholder="https://advocaciacbc.kommo.com/leads/detail/..."
            />
          </div>
        </div>
      </section>

      {/* ── Contratante 2 (opcional) ── */}
      <section>
        <button
          type="button"
          onClick={toggleContratante2}
          className="text-[11px] font-bold uppercase flex items-center gap-1.5 transition"
          style={{ color: hasContratante2 ? '#DC2626' : '#1B3A5C' }}
        >
          {hasContratante2 ? <TrashIcon className="w-3.5 h-3.5" /> : <PlusIcon className="w-3.5 h-3.5" />}
          {hasContratante2 ? 'Remover segundo contratante' : 'Adicionar segundo contratante'}
        </button>

        {hasContratante2 && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 border-l-2 border-gray-200 dark:border-gray-700 pl-3">
            <div className="md:col-span-2">
              <label className={labelCls}>Nome completo</label>
              <input
                type="text"
                value={contratantes[1]?.nome || ''}
                onChange={(e) => setContratanteField(1, 'nome', e.target.value)}
                className={inputCls('c2_nome')}
              />
            </div>
            <div>
              <label className={labelCls}>CPF</label>
              <input
                type="text"
                value={contratantes[1]?.cpf || ''}
                onChange={(e) => setContratanteField(1, 'cpf', maskCPF(e.target.value))}
                className={inputCls('c2_cpf')}
                placeholder="000.000.000-00"
              />
              {touched.c2_cpf && errors.c2_cpf && <ErrText msg={errors.c2_cpf} />}
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={contratantes[1]?.email || ''}
                onChange={(e) => setContratanteField(1, 'email', e.target.value)}
                className={inputCls('c2_email')}
              />
              {touched.c2_email && errors.c2_email && <ErrText msg={errors.c2_email} />}
            </div>
            <div>
              <label className={labelCls}>Telefone</label>
              <input
                type="text"
                value={contratantes[1]?.telefone || ''}
                onChange={(e) => setContratanteField(1, 'telefone', maskPhone(e.target.value))}
                className={inputCls('c2_telefone')}
              />
            </div>
          </div>
        )}
      </section>

      {/* ── Detalhes do contrato ── */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#1B3A5C' }}>
          Detalhes do contrato
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className={labelCls}>Resort *</label>
            <select
              value={resort}
              onChange={(e) => setResort(e.target.value)}
              className={inputCls('resort')}
            >
              <option value="">Selecione...</option>
              {resorts.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value="outro">Outro (especificar)</option>
            </select>
            {resort === 'outro' && (
              <input
                type="text"
                value={resortCustom}
                onChange={(e) => setResortCustom(e.target.value)}
                placeholder="Nome do resort"
                className={`${inputCls('resort')} mt-2`}
              />
            )}
            {showErr('resort') && <ErrText msg={errors.resort} />}
          </div>
          <div>
            <label className={labelCls}>Tipo de acao *</label>
            <select
              value={tipoAcao}
              onChange={(e) => setTipoAcao(e.target.value)}
              className={inputCls('tipoAcao')}
            >
              <option value="">Selecione...</option>
              {TIPOS_ACAO.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="outro">Outro</option>
            </select>
            {tipoAcao === 'outro' && (
              <input
                type="text"
                value={tipoAcaoCustom}
                onChange={(e) => setTipoAcaoCustom(e.target.value)}
                placeholder="Tipo de acao"
                className={`${inputCls('tipoAcao')} mt-2`}
              />
            )}
            {showErr('tipoAcao') && <ErrText msg={errors.tipoAcao} />}
          </div>
          <div>
            <label className={labelCls}>Data de assinatura *</label>
            <input
              type="date"
              value={dataAssinatura}
              onChange={(e) => setDataAssinatura(e.target.value)}
              className={inputCls('dataAssinatura')}
            />
            {showErr('dataAssinatura') && <ErrText msg={errors.dataAssinatura} />}
          </div>
        </div>
      </section>

      {/* ── Honorarios ── */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#1B3A5C' }}>
          Honorarios *
        </h3>
        <div className="flex flex-wrap gap-3 mb-3 text-[11px]">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={honorarios.modo === 'iniciais'}
              onChange={() => setHonorarios({ ...honorarios, modo: 'iniciais' })}
              className="accent-[#1B3A5C]"
            />
            Apenas iniciais
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={honorarios.modo === 'exito'}
              onChange={() => setHonorarios({ ...honorarios, modo: 'exito' })}
              className="accent-[#1B3A5C]"
            />
            Apenas exito
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={honorarios.modo === 'iniciais_exito'}
              onChange={() => setHonorarios({ ...honorarios, modo: 'iniciais_exito' })}
              className="accent-[#1B3A5C]"
            />
            Iniciais + Exito
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(honorarios.modo === 'iniciais' || honorarios.modo === 'iniciais_exito') && (
            <>
              <div>
                <label className={labelCls}>Valor iniciais (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={honorarios.total}
                  onChange={(e) => setHonorarios({ ...honorarios, total: e.target.value })}
                  className={inputCls('hon_total')}
                  placeholder="3000"
                />
                {showErr('hon_total') && <ErrText msg={errors.hon_total} />}
              </div>
              <div>
                <label className={labelCls}>Numero de parcelas</label>
                <input
                  type="number"
                  min="1"
                  value={honorarios.parcelas}
                  onChange={(e) => setHonorarios({ ...honorarios, parcelas: e.target.value })}
                  className={inputCls('hon_parcelas')}
                  placeholder="10"
                />
              </div>
              <div>
                <label className={labelCls}>Data primeira parcela</label>
                <input
                  type="date"
                  value={honorarios.dataPrimeiraParcela}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) =>
                    setHonorarios({ ...honorarios, dataPrimeiraParcela: e.target.value })
                  }
                  className={inputCls('hon_data')}
                />
                {honorarios.dataPrimeiraParcela && (() => {
                  const today = new Date(); today.setHours(0, 0, 0, 0);
                  const due = new Date(honorarios.dataPrimeiraParcela + 'T12:00:00');
                  if (due < today) return <p className="text-[10px] text-red-600 mt-1">⚠ Data ja passou — Asaas rejeita</p>;
                  return null;
                })()}
              </div>
            </>
          )}
          {(honorarios.modo === 'exito' || honorarios.modo === 'iniciais_exito') && (
            <div>
              <label className={labelCls}>Percentual exito (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={honorarios.percentualExito}
                onChange={(e) =>
                  setHonorarios({ ...honorarios, percentualExito: e.target.value })
                }
                className={inputCls('hon_exito')}
                placeholder="20"
              />
              {showErr('hon_exito') && <ErrText msg={errors.hon_exito} />}
            </div>
          )}
        </div>
      </section>

      {/* ── Atribuicao (opcional) ── */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2 text-gray-500">
          Atribuicao (opcional)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Pasta</label>
            <select
              value={pasta}
              onChange={(e) => setPasta(e.target.value)}
              className={inputCls('pasta')}
            >
              <option value="">Sem pasta</option>
              <option value="Bruno 1">Bruno 1</option>
              <option value="Bruno 2">Bruno 2</option>
              <option value="Paulo 2">Paulo 2</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Vendedora</label>
            <select
              value={vendedora}
              onChange={(e) => setVendedora(e.target.value)}
              className={inputCls('vendedora')}
            >
              <option value="">Selecione...</option>
              {vendedoras.map((v) => (
                <option key={v.email} value={v.email}>
                  {v.display_name || v.email.split('@')[0]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Origem cliente</label>
            <select
              value={origemCliente}
              onChange={(e) => setOrigemCliente(e.target.value)}
              className={inputCls('origem')}
            >
              <option value="">Nao especificada</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="FORMULARIO">Formulario</option>
              <option value="ORGANICO">Organico</option>
              <option value="GOOGLE">Google</option>
              <option value="FACEBOOK">Facebook</option>
              <option value="INDICACAO">Indicacao</option>
              <option value="OUTROS">Outros</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}

function ErrText({ msg }) {
  return <div className="text-[10px] text-red-600 mt-1 font-medium">{msg}</div>;
}

// ===============================================================
//  STEP 2 — Anexos
// ===============================================================
function Step2({ anexos, handleFileUpload, removeAnexo, linkGoogleDrive, setLinkGoogleDrive, anexoErro }) {
  return (
    <div className="space-y-5">
      <div className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
        Anexos sao opcionais. Se voce ja possui o contrato e a procuracao em PDF, anexe-os abaixo
        para que possamos arquiva-los automaticamente no Google Drive.
      </div>

      <FileSlot
        label="PDF do contrato assinado"
        accept=".pdf"
        anexo={anexos.contratoPdf}
        onChange={(files) => handleFileUpload('contratoPdf', files)}
        onRemove={() => removeAnexo('contratoPdf')}
      />

      <FileSlot
        label="PDF da procuracao assinada"
        accept=".pdf"
        anexo={anexos.procuracaoPdf}
        onChange={(files) => handleFileUpload('procuracaoPdf', files)}
        onRemove={() => removeAnexo('procuracaoPdf')}
      />

      {anexoErro && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px]">
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          {anexoErro}
        </div>
      )}

      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
          Link da pasta Google Drive
        </label>
        <input
          type="url"
          value={linkGoogleDrive}
          onChange={(e) => setLinkGoogleDrive(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/XXX..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1B3A5C] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <div className="flex items-start gap-1.5 mt-1.5 text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          NAO PODE SER PASTA DE DOCUMENTOS DE WHATSAPP
        </div>
      </div>

      <div className="text-[11px] text-gray-500 dark:text-gray-400 italic leading-snug border-l-2 border-gray-200 dark:border-gray-700 pl-2">
        Se anexar PDFs e fornecer link da pasta, posso fazer upload automatico no Drive na etapa
        seguinte.
      </div>
    </div>
  );
}

function FileSlot({ label, accept, anexo, onChange, onRemove }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
        {label}
      </label>
      {!anexo ? (
        <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#1B3A5C] dark:border-gray-600 dark:hover:border-blue-400 transition">
          <PaperClipIcon className="w-4 h-4 text-gray-500" />
          <span className="text-xs text-gray-600 dark:text-gray-300">Selecionar arquivo</span>
          <span className="ml-auto text-[10px] text-gray-400">max 10MB, .pdf</span>
          <input
            type="file"
            accept={accept}
            onChange={(e) => onChange(e.target.files)}
            className="hidden"
          />
        </label>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg">
          <CheckCircleIcon className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-green-800 dark:text-green-300 truncate">
              {anexo.name}
            </div>
            <div className="text-[10px] text-green-600 dark:text-green-400">
              {fmtBytes(anexo.size)}
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-800/40"
            aria-label="Remover"
          >
            <TrashIcon className="w-3.5 h-3.5 text-green-700 dark:text-green-400" />
          </button>
        </div>
      )}
    </div>
  );
}

// ===============================================================
//  STEP 3 — Automacoes
// ===============================================================
function Step3({ automacoes, setAutomacoes, requisitosOk }) {
  const items = [
    {
      key: 'advbox',
      titulo: 'ADVBOX — criar cliente e processo',
      descricao:
        'Cria cliente no ADVBOX e abre processo na etapa "ASSINADO AUTOMACAO". Atribuido a Paulo Conforto. Requer: dados completos do contratante.',
      requisitoLabel: 'dados completos do contratante',
    },
    {
      key: 'drive',
      titulo: 'Google Drive — subir PDFs',
      descricao:
        'Faz upload do contrato e procuracao assinados para a pasta indicada. Requer: link da pasta + pelo menos um PDF anexado.',
      requisitoLabel: 'link da pasta + 1 PDF anexado',
    },
    {
      key: 'asaas',
      titulo: 'Asaas — criar cobrancas',
      descricao:
        'Cria boleto + PIX para os honorarios iniciais com vencimento na data informada. Requer: honorarios iniciais > 0, parcelas > 0, data primeira parcela.',
      requisitoLabel: 'iniciais + parcelas + data 1a parcela',
    },
    // (chatguru removal 2026-05) automacao ChatGuru removida — comunicacao via Kommo manual
  ];

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed mb-2">
        Selecione apenas as automacoes que deseja rodar agora. Cada item exige requisitos
        especificos — quando faltar algo, o checkbox fica desabilitado.
      </div>

      {items.map((item) => {
        const ok = requisitosOk[item.key];
        const checked = !!automacoes[item.key];
        return (
          <label
            key={item.key}
            className={`flex items-start gap-3 px-3 py-3 rounded-lg border transition ${
              ok
                ? 'border-gray-200 hover:border-[#1B3A5C] cursor-pointer dark:border-gray-700 dark:hover:border-blue-400'
                : 'border-gray-200 bg-gray-50 dark:bg-gray-800/40 dark:border-gray-700 opacity-60 cursor-not-allowed'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!ok}
              onChange={(e) => setAutomacoes({ ...automacoes, [item.key]: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-[#1B3A5C] cursor-pointer disabled:cursor-not-allowed"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
                  {item.titulo}
                </span>
                {ok ? (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Requisitos OK
                  </span>
                ) : (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                    Falta: {item.requisitoLabel}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 leading-snug">
                {item.descricao}
              </div>
              {item.warning && (
                <div className="flex items-start gap-1.5 mt-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                  <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {item.warning}
                </div>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ===============================================================
//  STEP 4 — Confirmacao + execucao
// ===============================================================
function Step4({ data, anexos, automacoes, execSteps, execDone, execError, onRetry }) {
  const c1 = data.contratantes?.[0] || {};
  const honorarios = data.honorarios || {};
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;

  const hasExec = execSteps && execSteps.length > 0;

  // Resumo do honorario
  let honStr = '';
  if (honorarios.somenteExito) {
    honStr = `Apenas ${honorarios.percentualExito || 0}% de exito`;
  } else if (honorarios.somenteIniciais) {
    honStr = `R$ ${(honorarios.total || 0).toLocaleString('pt-BR')}`;
  } else {
    honStr = `R$ ${(honorarios.total || 0).toLocaleString('pt-BR')} + ${
      honorarios.percentualExito || 0
    }% exito`;
  }

  return (
    <div className="space-y-4">
      {!hasExec && (
        <>
          <Card titulo="Contrato">
            <KV label="Cliente" value={c1.nome || '—'} />
            <KV label="CPF" value={c1.cpf || '—'} />
            {data.numContratantes === 2 && data.contratantes?.[1]?.nome && (
              <KV label="Cliente 2" value={data.contratantes[1].nome} />
            )}
            <KV label="Resort" value={resort || '—'} />
            <KV label="Tipo" value={tipoAcao || '—'} />
            <KV label="Honorarios" value={honStr} />
            <KV
              label="Data assinatura"
              value={
                data.dataAssinatura
                  ? new Date(data.dataAssinatura + 'T12:00:00').toLocaleDateString('pt-BR')
                  : '—'
              }
            />
            {data.pasta && <KV label="Pasta" value={data.pasta} />}
            {data.vendedora && <KV label="Vendedora" value={data.vendedora} />}
          </Card>

          <Card titulo="Anexos">
            <KV
              label="Contrato PDF"
              value={
                anexos.contratoPdf ? (
                  <span className="text-green-700">
                    ✓ {anexos.contratoPdf.name} ({fmtBytes(anexos.contratoPdf.size)})
                  </span>
                ) : (
                  <span className="text-gray-400">— nao anexado</span>
                )
              }
            />
            <KV
              label="Procuracao PDF"
              value={
                anexos.procuracaoPdf ? (
                  <span className="text-green-700">
                    ✓ {anexos.procuracaoPdf.name} ({fmtBytes(anexos.procuracaoPdf.size)})
                  </span>
                ) : (
                  <span className="text-gray-400">— nao anexado</span>
                )
              }
            />
            <KV
              label="Pasta Drive"
              value={
                data.linkGoogleDrive ? (
                  <span className="text-green-700 break-all">{data.linkGoogleDrive}</span>
                ) : (
                  <span className="text-gray-400">— nao informada</span>
                )
              }
            />
          </Card>

          <Card titulo="Automacoes a rodar">
            <AutoLine label="ADVBOX (cliente + processo)" on={automacoes.advbox} />
            <AutoLine label="Google Drive (upload PDFs)" on={automacoes.drive} />
            <AutoLine label="Asaas (cobrancas)" on={automacoes.asaas} />
          </Card>

          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 text-blue-800 dark:text-blue-200 text-[11px]">
            <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            Ao clicar em "Importar e processar", o contrato sera salvo no banco com flag
            <strong className="mx-1">imported_manually=true</strong> e cada automacao acima sera
            disparada na sequencia.
          </div>
        </>
      )}

      {/* Timeline de execucao */}
      {hasExec && (
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#1B3A5C' }}>
            Execucao
          </div>
          {execSteps.map((s, i) => (
            <ExecLine
              key={s.key}
              idx={i + 1}
              total={execSteps.length}
              step={s}
              onRetry={
                s.status === 'error' && s.key !== 'salvar' ? () => onRetry(s.key) : null
              }
            />
          ))}

          {execDone && (
            <div className="mt-4 px-3 py-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/40">
              <div className="flex items-center gap-2 text-sm font-bold text-green-800 dark:text-green-300">
                <CheckCircleIcon className="w-5 h-5" />
                {(() => {
                  const okCount = execSteps.filter((s) => s.status === 'ok').length;
                  return `Contrato importado: ${okCount} de ${execSteps.length} automacoes concluidas`;
                })()}
              </div>
              {execSteps.some((s) => s.status === 'error') && (
                <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                  Algumas automacoes falharam — voce pode tentar novamente individualmente.
                </div>
              )}
            </div>
          )}

          {execError && !execDone && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 text-red-700 dark:text-red-300 text-xs">
              {execError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Card simples
function Card({ titulo, children }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/40 p-3.5 space-y-1">
      <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: '#1B3A5C' }}>
        {titulo}
      </div>
      {children}
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="text-gray-500 dark:text-gray-400 w-28 shrink-0">{label}:</span>
      <span className="text-gray-800 dark:text-gray-100 font-medium flex-1 min-w-0">{value}</span>
    </div>
  );
}

function AutoLine({ label, on }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {on ? (
        <CheckCircleIcon className="w-4 h-4 text-green-600" />
      ) : (
        <span className="w-4 h-4 inline-block" aria-hidden="true">
          <span className="block w-3 h-[2px] bg-gray-300 mt-[7px] mx-auto" />
        </span>
      )}
      <span
        className={
          on ? 'font-medium text-gray-800 dark:text-gray-100' : 'text-gray-400 line-through'
        }
      >
        {label}
      </span>
      {!on && <span className="text-[9px] text-gray-400">(nao marcado)</span>}
    </div>
  );
}

function ExecLine({ idx, total, step, onRetry }) {
  const map = {
    pending: { icon: <PauseCircleIcon className="w-4 h-4 text-gray-400" />, label: 'aguardando', cls: 'text-gray-500' },
    running: { icon: <ClockIcon className="w-4 h-4 text-blue-600 animate-spin" />, label: 'em progresso', cls: 'text-blue-700' },
    ok: { icon: <CheckCircleIcon className="w-4 h-4 text-green-600" />, label: 'OK', cls: 'text-green-700' },
    error: { icon: <XCircleIcon className="w-4 h-4 text-red-600" />, label: 'erro', cls: 'text-red-700' },
  };
  const cur = map[step.status] || map.pending;
  return (
    <div className="flex items-start gap-2.5 text-[11px] px-3 py-2 rounded-lg bg-white/60 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
      <span className="text-gray-400 font-mono w-12 shrink-0">[{idx}/{total}]</span>
      <div className="shrink-0 mt-0.5">{cur.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-800 dark:text-gray-100">{step.label}</span>
          <span className={`text-[10px] font-bold uppercase ${cur.cls}`}>{cur.label}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/30 flex items-center gap-1"
            >
              <ArrowPathIcon className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>
        {step.info && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 break-words">
            {step.info}
          </div>
        )}
      </div>
    </div>
  );
}
