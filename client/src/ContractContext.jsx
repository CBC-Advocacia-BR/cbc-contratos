import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { CLAUSULAS_PADRAO } from './data/clausulas';

const ContractContext = createContext();

const STORAGE_KEY = 'cbc_contrato_rascunho';

const defaultContratante = () => ({
  nome: '',
  nacionalidade: 'brasileiro(a)',
  profissao: '',
  estadoCivil: '',
  rg: '',
  cpf: '',
  email: '',
  endereco: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
  complemento: '',
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
  zapSignToken: '',
};

function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

export function ContractProvider({ children }) {
  const [data, setData] = useState(() => loadFromStorage() || defaultState);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
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
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <ContractContext.Provider value={{
      data, updateData, updateContratante, updateHonorarios,
      updateClausula, resetClausula, getClausulaTexto, isClausulaModificada,
      getClausulasOrdenadas, reorderClausulas, addClausulaAvulsa, removeClausulaAvulsa,
      getResortName, resetAll, currentStep, setCurrentStep,
    }}>
      {children}
    </ContractContext.Provider>
  );
}

export function useContract() {
  return useContext(ContractContext);
}
