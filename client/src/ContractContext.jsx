import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { CLAUSULAS_PADRAO } from './data/clausulas';

const ContractContext = createContext();

function getStorageKey() {
  try {
    const session = JSON.parse(localStorage.getItem('sb-vygczeepvoyaehfchxko-auth-token') || '{}');
    const email = session?.user?.email || 'anon';
    return `cbc_rascunho_${email.replace(/[^a-z0-9]/gi, '_')}`;
  } catch { return 'cbc_contrato_rascunho'; }
}

const defaultContratante = () => ({
  // (PJ 25/06) tipo discrimina Pessoa Fisica (padrao) vs Pessoa Juridica (Cliente Empresa).
  // Em PJ, os campos de pessoa abaixo (nome, cpf, rg, endereco...) descrevem o REPRESENTANTE
  // LEGAL — assim genero/mascaras/validacao/lookup CEP/qualificacao funcionam sem ramificacao.
  tipo: 'pf',
  nome: '',
  sexo: '', // M ou F
  nacionalidade: 'brasileiro(a)',
  profissao: '',
  estadoCivil: '',
  rg: '',
  cpf: '',
  email: '',
  endereco: '',
  numero: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
  complemento: '',
  telefone: '',
  linkKommo: '',
  dataNascimento: '',
  // ─── Campos exclusivos de Pessoa Juridica (empresa) ───
  razaoSocial: '',
  cnpj: '',
  emailEmpresa: '',
  enderecoEmpresa: '',
  numeroEmpresa: '',
  bairroEmpresa: '',
  cidadeEmpresa: '',
  ufEmpresa: '',
  cepEmpresa: '',
  complementoEmpresa: '',
});

function getDefaultVencimento() {
  const hoje = new Date();
  const dia = hoje.getDate();
  let mes = hoje.getMonth();
  let ano = hoje.getFullYear();
  if (dia > 17) {
    mes += 1;
    if (mes > 11) { mes = 0; ano += 1; }
  }
  const m = String(mes + 1).padStart(2, '0');
  return `${ano}-${m}-20`;
}

const defaultState = {
  numContratantes: 0,
  contratantes: [defaultContratante(), defaultContratante()],
  resort: '',
  resortCustom: '',
  tipoAcao: '',
  tipoAcaoCustom: '',
  honorarios: {
    tipo: 'predefinido',
    total: 3000,
    parcelas: 10,
    valorParcela: 300,
    percentualExito: 20,
    dataPrimeiraParcela: getDefaultVencimento(),
    somenteExito: false,
    somenteIniciais: false,
  },
  clausulas: {},
  clausulasOrder: null, // null = default order; array of IDs = custom order
  clausulasAvulsas: [], // [{ id, titulo, texto }]
  escritorioArcaCustas: false, // Se marcado, escritório paga as custas processuais
  naoMandarMensagem: false, // (chatguru removal 2026-05) flag legado — sem efeito apos remocao do envio automatico
  documentosRecebidos: {}, // Checklist de documentos: { rg: true, cpf: true, ... }
  observacoesInternas: '', // Notas internas que NÃO aparecem no contrato
  origemCliente: '', // Origem do cliente (interno — não aparece no contrato)
  dataPrimeiraMensagem: '', // Data da primeira mensagem do cliente
  linkGoogleDrive: '', // Link da pasta do cliente no Google Drive
  zapSignToken: '',
};

function loadFromStorage() {
  try {
    const key = getStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

export function ContractProvider({ children }) {
  const [data, setData] = useState(() => loadFromStorage() || defaultState);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(data));
    } catch { /* ignore — quota exceeded or private browsing */ }
  }, [data]);

  const updateData = useCallback((updates) => {
    setData(prev => ({ ...prev, ...updates }));
  }, []);

  const updateContratante = useCallback((index, updates) => {
    setData(prev => {
      const contratantes = [...prev.contratantes];
      contratantes[index] = { ...contratantes[index], ...updates };
      return { ...prev, contratantes };
    });
  }, []);

  const updateHonorarios = useCallback((updates) => {
    setData(prev => ({
      ...prev,
      honorarios: { ...prev.honorarios, ...updates },
    }));
  }, []);

  const updateClausula = useCallback((id, texto) => {
    setData(prev => ({
      ...prev,
      clausulas: { ...prev.clausulas, [id]: texto },
    }));
  }, []);

  const resetClausula = useCallback((id) => {
    setData(prev => {
      const clausulas = { ...prev.clausulas };
      delete clausulas[id];
      return { ...prev, clausulas };
    });
  }, []);

  const getClausulaTexto = useCallback((id) => {
    if (data.clausulas[id] !== undefined) return data.clausulas[id];
    const c = CLAUSULAS_PADRAO.find(cl => cl.id === id);
    return c ? c.texto : '';
  }, [data.clausulas]);

  const isClausulaModificada = useCallback((id) => {
    return data.clausulas[id] !== undefined;
  }, [data.clausulas]);

  // Get the effective order of clausulas (default or custom)
  const getClausulasOrdenadas = useCallback(() => {
    const allIds = CLAUSULAS_PADRAO.map(c => c.id);
    const avulsaIds = (data.clausulasAvulsas || []).map(a => a.id);
    const defaultOrder = [...allIds, ...avulsaIds];
    return data.clausulasOrder || defaultOrder;
  }, [data.clausulasOrder, data.clausulasAvulsas]);

  // Reorder clausulas
  const reorderClausulas = useCallback((fromIndex, toIndex) => {
    setData(prev => {
      const currentOrder = prev.clausulasOrder || [...CLAUSULAS_PADRAO.map(c => c.id), ...(prev.clausulasAvulsas || []).map(a => a.id)];
      const newOrder = [...currentOrder];
      const [moved] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, moved);
      return { ...prev, clausulasOrder: newOrder };
    });
  }, []);

  // Add custom clause
  const addClausulaAvulsa = useCallback((titulo, texto) => {
    setData(prev => {
      const id = `avulsa_${Date.now()}`;
      const avulsas = [...(prev.clausulasAvulsas || []), { id, titulo, texto }];
      const currentOrder = prev.clausulasOrder || [...CLAUSULAS_PADRAO.map(c => c.id), ...(prev.clausulasAvulsas || []).map(a => a.id)];
      return { ...prev, clausulasAvulsas: avulsas, clausulasOrder: [...currentOrder, id] };
    });
  }, []);

  // Remove custom clause
  const removeClausulaAvulsa = useCallback((id) => {
    setData(prev => {
      const avulsas = (prev.clausulasAvulsas || []).filter(a => a.id !== id);
      const order = (prev.clausulasOrder || []).filter(i => i !== id);
      const clausulas = { ...prev.clausulas };
      delete clausulas[id];
      return { ...prev, clausulasAvulsas: avulsas, clausulasOrder: order.length ? order : null, clausulas };
    });
  }, []);

  const getResortName = useCallback(() => {
    return data.resort === 'outro' ? data.resortCustom : data.resort;
  }, [data.resort, data.resortCustom]);

  const resetAll = useCallback(() => {
    setData(defaultState);
    setCurrentStep(0);
    try { localStorage.removeItem(getStorageKey()); } catch { /* ignore */ }
  }, []);

  // (perf 31/05) value memoizado. As funcoes ja sao useCallback estaveis; assim o
  // objeto so e recriado quando 'data' ou 'currentStep' mudam (re-render necessario),
  // evitando recriacao a cada render do provider por causas externas.
  const value = useMemo(() => ({
    data, updateData, updateContratante, updateHonorarios,
    updateClausula, resetClausula, getClausulaTexto, isClausulaModificada,
    getClausulasOrdenadas, reorderClausulas, addClausulaAvulsa, removeClausulaAvulsa,
    getResortName, resetAll, currentStep, setCurrentStep,
  }), [
    data, updateData, updateContratante, updateHonorarios,
    updateClausula, resetClausula, getClausulaTexto, isClausulaModificada,
    getClausulasOrdenadas, reorderClausulas, addClausulaAvulsa, removeClausulaAvulsa,
    getResortName, resetAll, currentStep, setCurrentStep,
  ]);

  return (
    <ContractContext.Provider value={value}>
      {children}
    </ContractContext.Provider>
  );
}

export function useContract() {
  return useContext(ContractContext);
}
