import { API_URL } from '../config';

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

// CPF validation + name lookup via backend (cpfcnpj.com.br Pacote 7 / CPF B)
// Returns: { valid, nome, nascimento }
export async function lookupCPF(cpf) {
  const cleanCpf = cpf.replace(/\D/g, '');
  if (cleanCpf.length !== 11) return null;
  if (!validateCPFDigits(cleanCpf)) return { valid: false, nome: '' };
  try {
    const resp = await fetch(`${API_URL}/api/cpf/${cleanCpf}`);
    const data = await resp.json();
    return {
      valid: data.valid !== false,
      nome: data.nome || '',
      nascimento: data.nascimento || '',
    };
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
