// ─────────────────────────────────────────────────────────────────────────
// (auditoria 01/08/2026 — itens 205 e 209) PORTAO DE ENVIO DO CONTRATO.
//
// Esta e a regra que decide se um contrato pode ir para assinatura. Ela vivia dentro do
// App.jsx, que ja acumulava roteador, motor de automacoes e gerador de PDF — e por estar
// la nao tinha teste nenhum, porque testa-la exigia carregar a arvore inteira de
// componentes. Sendo logica pura, nao precisa de React para nada.
//
// E o portao REAL: o atalho de teclado passa so por aqui. Alem de presenca, ele confere
// FORMATO — CPF com digito verificador, e-mail, CNPJ e o link do Kommo no formato
// /leads/detail/{id} (qualquer outra URL quebra em silencio o mover-lead e as notas
// automaticas no CRM).
//
// A LISTA de campos mora em utils/camposObrigatorios.js e um teste compara os dois
// conjuntos: campo que entre em um e nao no outro reprova a suite antes do deploy.
// ─────────────────────────────────────────────────────────────────────────
import { validateCPF, validateEmail, validateCNPJ } from './validation';

export function validateChecklist(data) {
  const issues = [];
  if (!data.numContratantes || data.numContratantes < 1) {
    issues.push({ msg: 'Selecione o numero de contratantes.' });
  }
  for (let i = 0; i < (data.numContratantes || 0); i++) {
    const c = data.contratantes?.[i];
    if (!c) { issues.push({ msg: `Dados do Contratante ${i + 1} ausentes.` }); continue; }
    // (PJ 25/06) Cliente Empresa: alem do bloco da empresa, os campos de pessoa abaixo
    // continuam exigidos e descrevem o REPRESENTANTE LEGAL.
    if (c.tipo === 'pj') {
      const emp = `Contratante ${i + 1} (empresa)`;
      if (!c.razaoSocial?.trim()) issues.push({ msg: `${emp}: Razao social obrigatoria.` });
      if (!c.cnpj?.trim()) issues.push({ msg: `${emp}: CNPJ obrigatorio.` });
      else if (!validateCNPJ(c.cnpj)) issues.push({ msg: `${emp}: CNPJ invalido.` });
      if (!c.emailEmpresa?.trim()) issues.push({ msg: `${emp}: E-mail da empresa obrigatorio.` });
      else if (!validateEmail(c.emailEmpresa)) issues.push({ msg: `${emp}: E-mail da empresa invalido.` });
      if (!c.enderecoEmpresa?.trim()) issues.push({ msg: `${emp}: Endereco da empresa obrigatorio.` });
      if (!c.numeroEmpresa?.trim()) issues.push({ msg: `${emp}: Numero da empresa obrigatorio.` });
      if (!c.bairroEmpresa?.trim()) issues.push({ msg: `${emp}: Bairro da empresa obrigatorio.` });
      if (!c.cidadeEmpresa?.trim()) issues.push({ msg: `${emp}: Cidade da empresa obrigatoria.` });
      if (!c.ufEmpresa?.trim()) issues.push({ msg: `${emp}: UF da empresa obrigatoria.` });
      if (!c.cepEmpresa?.trim()) issues.push({ msg: `${emp}: CEP da empresa obrigatorio.` });
    }
    if (!c.nome?.trim()) issues.push({ msg: `Contratante ${i + 1}: Nome obrigatorio.` });
    if (!c.nacionalidade?.trim()) issues.push({ msg: `Contratante ${i + 1}: Nacionalidade obrigatoria.` });
    if (!c.profissao?.trim()) issues.push({ msg: `Contratante ${i + 1}: Profissao obrigatoria.` });
    if (!c.estadoCivil?.trim()) issues.push({ msg: `Contratante ${i + 1}: Estado civil obrigatorio.` });
    if (!c.cpf?.trim()) issues.push({ msg: `Contratante ${i + 1}: CPF obrigatorio.` });
    else if (!validateCPF(c.cpf)) issues.push({ msg: `Contratante ${i + 1}: CPF invalido.` });
    if (!c.email?.trim()) issues.push({ msg: `Contratante ${i + 1}: E-mail obrigatorio.` });
    else if (!validateEmail(c.email)) issues.push({ msg: `Contratante ${i + 1}: E-mail invalido.` });
    if (!c.rg?.trim()) issues.push({ msg: `Contratante ${i + 1}: RG obrigatorio.` });
    if (!c.dataNascimento?.trim()) issues.push({ msg: `Contratante ${i + 1}: Data de nascimento obrigatoria.` });
    if (!c.telefone?.trim()) issues.push({ msg: `Contratante ${i + 1}: Celular obrigatorio.` });
    // Link Kommo obrigatorio E no formato /leads/detail/{id} (so esse formato habilita
    // mover lead + notas automaticas no CRM — qualquer outra URL quebra silenciosamente).
    if (!c.linkKommo?.trim()) issues.push({ msg: `Contratante ${i + 1}: Link Kommo obrigatorio.` });
    else if (!/\/leads\/detail\/\d+/.test(c.linkKommo.trim())) issues.push({ msg: `Contratante ${i + 1}: Link Kommo invalido (use a URL da conversa no formato .../leads/detail/NUMERO).` });
    if (!c.endereco?.trim()) issues.push({ msg: `Contratante ${i + 1}: Endereco obrigatorio.` });
    if (!c.numero?.trim()) issues.push({ msg: `Contratante ${i + 1}: Numero obrigatorio.` });
    if (!c.bairro?.trim()) issues.push({ msg: `Contratante ${i + 1}: Bairro obrigatorio.` });
    if (!c.cidade?.trim()) issues.push({ msg: `Contratante ${i + 1}: Cidade obrigatoria.` });
    if (!c.uf?.trim()) issues.push({ msg: `Contratante ${i + 1}: UF obrigatoria.` });
    if (!c.cep?.trim()) issues.push({ msg: `Contratante ${i + 1}: CEP obrigatorio.` });
  }
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  if (!resort?.trim()) issues.push({ msg: 'Resort/Empreendimento obrigatorio.' });
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
  if (!tipoAcao?.trim()) issues.push({ msg: 'Tipo de acao obrigatorio.' });
  if (!data.honorarios?.somenteExito && (!data.honorarios?.total || data.honorarios.total <= 0)) {
    issues.push({ msg: 'Valor dos honorarios obrigatorio (ou marque somente exito).' });
  }
  // (#11) campos internos exigidos pelo isFormComplete — antes o atalho Cmd+Enter (que so
  // passa por aqui) deixava enviar contrato sem eles, divergindo do botao "Enviar".
  if (!data.origemCliente) issues.push({ msg: 'Origem do cliente obrigatoria.' });
  if (!data.dataPrimeiraMensagem) issues.push({ msg: 'Data da primeira mensagem obrigatoria.' });
  if (!data.linkGoogleDrive?.trim()) issues.push({ msg: 'Link da pasta Google Drive obrigatorio.' });
  return issues;
}
