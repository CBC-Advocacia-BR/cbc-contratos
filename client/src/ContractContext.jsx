import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CLAUSULAS_PADRAO } from './data/clausulas';
// (item 197) precisa saber QUANDO o usuario logou para trocar a gaveta do rascunho
import { supabase } from './lib/supabase';

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

/** O rascunho tem algum conteudo digitado? (usado na migracao anon -> usuario) */
function temConteudo(d) {
  if (!d) return false;
  const c = d.contratantes?.[0] || {};
  return !!(c.nome || c.cpf || c.email || d.resort || d.tipoAcao);
}

export function ContractProvider({ children }) {
  const [data, setData] = useState(() => loadFromStorage() || defaultState);
  const [currentStep, setCurrentStep] = useState(0);

  // (auditoria 01/08 — item 197) O rascunho e guardado numa "gaveta" por e-mail
  // (getStorageKey). O problema: quando o app abre ANTES do login, a gaveta e a `anon`;
  // se a pessoa loga na MESMA aba, a chave muda para a do e-mail dela, mas o estado em
  // memoria continua o da gaveta anonima. Resultado: ela nao via o proprio rascunho e,
  // na primeira tecla, gravava o formulario vazio POR CIMA do rascunho verdadeiro.
  // Agora o provider reage ao login:
  //   - se a gaveta do usuario tem rascunho, ele e carregado;
  //   - se nao tem e havia algo digitado como anonimo, esse conteudo MIGRA para a gaveta
  //     dele (ninguem perde o que estava preenchendo quando a sessao expirou e voltou).
  const chaveRef = useRef(getStorageKey());
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      const nova = getStorageKey();
      if (nova === chaveRef.current) return;
      const anterior = chaveRef.current;
      chaveRef.current = nova;
      try {
        const salvo = localStorage.getItem(nova);
        if (salvo) {
          setData(JSON.parse(salvo));           // rascunho do usuario tem prioridade
        } else {
          setData((atual) => {
            if (temConteudo(atual)) {
              localStorage.setItem(nova, JSON.stringify(atual)); // migra o que estava digitado
              if (anterior.endsWith('_anon')) localStorage.removeItem(anterior);
              return atual;
            }
            return atual;
          });
        }
      } catch { /* storage indisponivel — segue com o estado atual */ }
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // (auditoria 01/08 — item 170) Gravacao do rascunho com ATRASO (debounce).
  // Antes rodava a cada mudanca de `data`, ou seja, a cada TECLA digitada: serializava o
  // contrato inteiro (com todas as clausulas) e ainda relia o token de sessao dentro do
  // getStorageKey() — duas leituras e duas serializacoes por caractere. E o que fazia o
  // formulario "travar" no iPad e em maquina fraca.
  // O atraso sozinho traria um risco novo: fechar a aba (ou trocar de app no celular)
  // dentro da janela de 500 ms perderia as ultimas letras digitadas. Por isso a gravacao
  // tambem acontece na hora quando a pagina e escondida/fechada — `visibilitychange`
  // e o gancho confiavel no iOS, onde `beforeunload` costuma nao disparar.
  const dataRef = useRef(data);

  useEffect(() => {
    // atualiza o ref DENTRO do efeito (nunca durante o render — o React Compiler
    // proibe, e com razao: escrita em ref no render quebra renderizacao concorrente)
    dataRef.current = data;
    const gravar = () => {
      try {
        localStorage.setItem(getStorageKey(), JSON.stringify(dataRef.current));
      } catch { /* ignore — quota exceeded or private browsing */ }
    };
    const t = setTimeout(gravar, 500);
    const aoEsconder = () => { if (document.visibilityState === 'hidden') gravar(); };
    document.addEventListener('visibilitychange', aoEsconder);
    window.addEventListener('pagehide', gravar);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', aoEsconder);
      window.removeEventListener('pagehide', gravar);
    };
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

  // (vinculo-kommo, item 1 / Opcao B) Vincular = recomecar do zero: zera TODO o
  // formulario (mantendo apenas o link) e aplica os campos vindos do lead/Cadastro.
  // Evita que dados de um lead anterior sobrem em campos que o novo lead nao preenche.
  const aplicarVinculo = useCallback((linkKommo, contratanteCampos = {}, dataCampos = {}) => {
    setData({
      ...defaultState,
      ...dataCampos,
      numContratantes: 1, // o Vincular preenche o contratante 1
      contratantes: [
        { ...defaultContratante(), linkKommo: linkKommo || '', ...contratanteCampos },
        defaultContratante(),
      ],
      honorarios: { ...defaultState.honorarios },
      clausulas: {},
      clausulasOrder: null,
      clausulasAvulsas: [],
      documentosRecebidos: {},
    });
  }, []);

  // (perf 31/05) value memoizado. As funcoes ja sao useCallback estaveis; assim o
  // objeto so e recriado quando 'data' ou 'currentStep' mudam (re-render necessario),
  // evitando recriacao a cada render do provider por causas externas.
  const value = useMemo(() => ({
    data, updateData, updateContratante, updateHonorarios,
    updateClausula, resetClausula, getClausulaTexto, isClausulaModificada,
    getClausulasOrdenadas, reorderClausulas, addClausulaAvulsa, removeClausulaAvulsa,
    getResortName, resetAll, aplicarVinculo, currentStep, setCurrentStep,
  }), [
    data, updateData, updateContratante, updateHonorarios,
    updateClausula, resetClausula, getClausulaTexto, isClausulaModificada,
    getClausulasOrdenadas, reorderClausulas, addClausulaAvulsa, removeClausulaAvulsa,
    getResortName, resetAll, aplicarVinculo, currentStep, setCurrentStep,
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
