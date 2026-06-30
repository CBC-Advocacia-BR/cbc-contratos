export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateCPF(cpf) {
  // (#L1) formato + digitos verificadores (checksum). Antes so checava o formato, entao
  // um CPF bem-formatado mas invalido (ex.: 123.456.789-00) passava em Salvar/PDF/ZapSign.
  if (!/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf)) return false;
  const d = cpf.replace(/\D/g, '');
  if (/^(\d)\1{10}$/.test(d)) return false; // todos os digitos iguais
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
  let r = (sum * 10) % 11; if (r === 10) r = 0;
  if (r !== parseInt(d[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i], 10) * (11 - i);
  r = (sum * 10) % 11; if (r === 10) r = 0;
  return r === parseInt(d[10], 10);
}

export function validateCNPJ(cnpj) {
  // formato + digitos verificadores (mesma logica de robustez do validateCPF)
  if (!/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(cnpj)) return false;
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false; // todos os digitos iguais
  const calcDigito = (len) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(d[len - i], 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const res = sum % 11;
    return res < 2 ? 0 : 11 - res;
  };
  if (calcDigito(12) !== parseInt(d[12], 10)) return false;
  return calcDigito(13) === parseInt(d[13], 10);
}

export function validateCEP(cep) {
  return /^\d{5}-\d{3}$/.test(cep);
}

export function validateUF(uf) {
  const ufs = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  return ufs.includes(uf.toUpperCase());
}

export function validateContratante(c) {
  const errors = {};
  // (PJ 25/06) Cliente Empresa: valida bloco da empresa antes; os campos de pessoa
  // abaixo passam a descrever o REPRESENTANTE LEGAL (mesmos nomes de campo do PF).
  if ((c.tipo || 'pf') === 'pj') {
    if (!c.razaoSocial?.trim()) errors.razaoSocial = 'Obrigatório';
    if (!c.cnpj?.trim()) errors.cnpj = 'Obrigatório';
    else if (!validateCNPJ(c.cnpj)) errors.cnpj = 'CNPJ inválido (00.000.000/0000-00)';
    if (!c.emailEmpresa?.trim()) errors.emailEmpresa = 'Obrigatório';
    else if (!validateEmail(c.emailEmpresa)) errors.emailEmpresa = 'E-mail inválido';
    if (!c.enderecoEmpresa?.trim()) errors.enderecoEmpresa = 'Obrigatório';
    if (!c.bairroEmpresa?.trim()) errors.bairroEmpresa = 'Obrigatório';
    if (!c.cidadeEmpresa?.trim()) errors.cidadeEmpresa = 'Obrigatório';
    if (!c.ufEmpresa?.trim()) errors.ufEmpresa = 'Obrigatório';
    else if (!validateUF(c.ufEmpresa)) errors.ufEmpresa = 'UF inválida';
    if (!c.cepEmpresa?.trim()) errors.cepEmpresa = 'Obrigatório';
    else if (!validateCEP(c.cepEmpresa)) errors.cepEmpresa = 'CEP inválido (00000-000)';
  }
  if (!c.nome?.trim()) errors.nome = 'Obrigatório';
  if (!c.nacionalidade?.trim()) errors.nacionalidade = 'Obrigatório';
  if (!c.profissao?.trim()) errors.profissao = 'Obrigatório';
  if (!c.estadoCivil) errors.estadoCivil = 'Obrigatório';
  if (!c.rg?.trim()) errors.rg = 'Obrigatório';
  if (!c.cpf?.trim()) errors.cpf = 'Obrigatório';
  else if (!validateCPF(c.cpf)) errors.cpf = 'CPF inválido (000.000.000-00)';
  if (!c.email?.trim()) errors.email = 'Obrigatório';
  else if (!validateEmail(c.email)) errors.email = 'E-mail inválido';
  if (!c.endereco?.trim()) errors.endereco = 'Obrigatório';
  if (!c.bairro?.trim()) errors.bairro = 'Obrigatório';
  if (!c.cidade?.trim()) errors.cidade = 'Obrigatório';
  if (!c.uf?.trim()) errors.uf = 'Obrigatório';
  else if (!validateUF(c.uf)) errors.uf = 'UF inválida';
  if (!c.cep?.trim()) errors.cep = 'Obrigatório';
  else if (!validateCEP(c.cep)) errors.cep = 'CEP inválido (00000-000)';
  return errors;
}
