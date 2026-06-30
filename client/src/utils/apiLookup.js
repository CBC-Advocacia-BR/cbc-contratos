// Consulta de CPF agora passa pela Netlify Function /api/cpf-lookup
// (o token fica no servidor, fora do navegador).

// ─── Local cache for CPF lookups (avoid duplicate API calls) ───
const cpfCache = new Map();
const CPF_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ─── Rate limiter: max 1 call per 2 seconds ───
let lastCpfCall = 0;
const CPF_MIN_INTERVAL = 2000;

// ViaCEP - Free public CEP lookup API
export async function lookupCEP(cep) {
  const cleanCep = cep.replace(/\D/g, '');
  if (cleanCep.length !== 8) return null;
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
    const data = await resp.json();
    if (data.erro) return null;
    return {
      endereco: `${data.logradouro || ''}${data.complemento ? ', ' + data.complemento : ''}`,
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
    };
  } catch {
    return null;
  }
}

// ─── Cache local para consultas de CNPJ ───
const cnpjCache = new Map();
const CNPJ_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

// BrasilAPI - consulta publica e gratuita de CNPJ (Receita Federal)
// Preenche razao social + endereco da empresa a partir do numero do CNPJ.
export async function lookupCNPJ(cnpj) {
  const clean = (cnpj || '').replace(/\D/g, '');
  if (clean.length !== 14) return null;

  const cached = cnpjCache.get(clean);
  if (cached && (Date.now() - cached.ts < CNPJ_CACHE_TTL)) {
    return cached.result;
  }

  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || data.message || (!data.razao_social && !data.nome_fantasia)) return null;
    const result = {
      razaoSocial: data.razao_social || data.nome_fantasia || '',
      enderecoEmpresa: [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' ').trim(),
      numeroEmpresa: data.numero || '',
      complementoEmpresa: data.complemento || '',
      bairroEmpresa: data.bairro || '',
      cidadeEmpresa: data.municipio || '',
      ufEmpresa: (data.uf || '').toUpperCase(),
      cepEmpresa: data.cep ? String(data.cep).replace(/\D/g, '').replace(/(\d{5})(\d{3})/, '$1-$2') : '',
      emailEmpresa: (data.email || '').toLowerCase(),
    };
    cnpjCache.set(clean, { result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}

// CPF validation + name lookup direto na API (sem backend)
export async function lookupCPF(cpf) {
  const cleanCpf = cpf.replace(/\D/g, '');
  if (cleanCpf.length !== 11) return null;
  if (!validateCPFDigits(cleanCpf)) return { valid: false, nome: '' };

  // Check local cache first
  const cached = cpfCache.get(cleanCpf);
  if (cached && (Date.now() - cached.ts < CPF_CACHE_TTL)) {
    return cached.result;
  }

  // Rate limiting: wait if called too fast
  const now = Date.now();
  const elapsed = now - lastCpfCall;
  if (elapsed < CPF_MIN_INTERVAL) {
    await new Promise(r => setTimeout(r, CPF_MIN_INTERVAL - elapsed));
  }
  lastCpfCall = Date.now();

  try {
    const resp = await fetch(`/api/cpf-lookup?cpf=${cleanCpf}`);
    const data = await resp.json();

    // A função já traduz "sem créditos"
    if (data?.error === 'SEM_CREDITOS' || data?.['cod-erro'] === 1001 || data?.erro === 1001) {
      return { valid: true, nome: '', error: 'SEM_CREDITOS' };
    }

    if (!data || data.status === 0 || !data.nome) {
      const result = { valid: true, nome: '' };
      cpfCache.set(cleanCpf, { result, ts: Date.now() });
      return result;
    }

    if (data.nome === 'Test Token') {
      const result = { valid: true, nome: 'DADOS DE TESTE', nascimento: '' };
      cpfCache.set(cleanCpf, { result, ts: Date.now() });
      return result;
    }

    const result = {
      valid: true,
      nome: data.nome || '',
      nascimento: data.nascimento || '',
    };
    cpfCache.set(cleanCpf, { result, ts: Date.now() });
    return result;
  } catch {
    return { valid: true, nome: '' };
  }
}

function validateCPFDigits(cpf) {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(cpf[10])) return false;
  return true;
}
