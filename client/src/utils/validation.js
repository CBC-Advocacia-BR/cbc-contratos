export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateCPF(cpf) {
  return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf);
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
