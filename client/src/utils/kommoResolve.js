// Logica PURA do "Vincular Kommo": monta o preenchimento do formulario a partir
// do lead (Kommo) + Cadastro Unico (clientes) + Arquivo CBC Conversas.
// Regras fechadas com o Paulo (23-24/07):
//  - montarPreenchimento NUNCA preenche 'nome' (vem da API de CPF) nem 'origemCliente'
//    (a origem e aplicada no componente, a partir da sugestao do lead).
//  - Vincular e autoritativo: (re)preenche os campos derivados do lead a cada vinculo
//    (inserir um lead diferente sobrescreve). Campos nao-derivados (cpf, honorarios...) ficam.
//  - Resort auto (tag/cadastro) sempre pede confirmacao.
import { RESORTS } from '../data/clausulas';
import { maskPhone, maskCPF, maskCNPJ, maskCEP, maskRG } from './masks';

// telefone do Kommo vem "55DDDnumero" (so digitos) -> padrao do form "(DD) numero"
function fmtTelefone(t) {
  const d = (t || '').replace(/\D/g, '').slice(-11); // ultimos 11 (dropa o 55)
  return d ? maskPhone(d) : '';
}

// normaliza p/ casar: sem acento, caixa alta, so alfanumerico + espaco
const norm = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const RESORT_BY_NORM = new Map(RESORTS.map((r) => [norm(r), r]));

export function extrairLeadId(link) {
  const m = /\/leads\/detail\/(\d+)/.exec(link || '');
  return m ? m[1] : null;
}

export function matchResort(nome) {
  if (!nome) return '';
  return RESORT_BY_NORM.get(norm(nome)) || '';
}

export function normalizeSexo(g) {
  const v = (g || '').trim().toUpperCase();
  if (v === 'M' || v.startsWith('MASC')) return 'M';
  if (v === 'F' || v.startsWith('FEM')) return 'F';
  return '';
}

// mapeia a bagunca do Cadastro (dezenas de variantes) p/ as 5 opcoes do form
export function normalizeEstadoCivil(v) {
  const n = norm(v);
  if (!n) return '';
  if (n.includes('CASAD')) return 'Casado(a)';
  if (n.includes('SOLTEIR')) return 'Solteiro(a)';
  if (n.includes('DIVORCIAD')) return 'Divorciado(a)';
  if (n.includes('VIUV')) return 'Viúvo(a)';
  if (n.includes('UNIAO') || n.includes('ESTAVEL') || n.includes('AMASIAD') || n.includes('CONVIVENTE')) return 'União Estável';
  return ''; // desconhecido/separado/regime de bens -> usuario preenche
}

// data (ISO/timestamp) -> 'YYYY-MM-DD' sem deslocamento de fuso
function fmtDateISO(v) {
  if (!v) return '';
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

// raw = { contato:{telefone,email}, tags:[nome], cliente:linha_clientes|null,
//         primeiraMsgConversas:iso|null, leadCriadoEm:iso|null }
// atuais = valores ja no form (usado so p/ detectar troca de resort -> resortAlterado)
export function montarPreenchimento(raw, atuais = {}) {
  const { contato = {}, tags = [], cliente = null, primeiraMsgConversas = null, leadCriadoEm = null } = raw || {};
  const campos = {};
  const proveniencia = {};
  const NUNCA = new Set(['origemCliente']); // nome pode vir do Cadastro Unico (nunca do Kommo)
  const resortAntigo = String(atuais.resort || '').trim();

  // vincular e autoritativo: SEMPRE (re)preenche os campos derivados do lead (telefone,
  // resort, endereco/qualificacao do Cadastro, 1a msg). Inserir um lead diferente
  // sobrescreve tudo. Campos NAO derivados do lead (cpf, nome, honorarios...) nao sao tocados.
  const set = (k, v, origem) => {
    if (NUNCA.has(k)) return;
    if (v == null || v === '') return;
    campos[k] = v;
    proveniencia[k] = origem;
  };

  set('telefone', fmtTelefone(contato.telefone), 'kommo'); // telefone do lead

  const clienteConhecido = !!cliente;
  if (clienteConhecido) {
    // cliente ja no Cadastro Unico -> puxa o MAXIMO de dados verificados
    const docDig = String(cliente.cpf_cnpj || '').replace(/\D/g, '');
    const ehPj = cliente.eh_pj === true || docDig.length > 11;
    if (ehPj) {
      set('tipo', 'pj', 'cadastro');
      set('razaoSocial', cliente.nome, 'cadastro'); // nome do master = razao social
      set('cnpj', cliente.cpf_cnpj && maskCNPJ(cliente.cpf_cnpj), 'cadastro');
      set('emailEmpresa', cliente.email, 'cadastro');
      set('cepEmpresa', cliente.cep && maskCEP(cliente.cep), 'cadastro');
      set('enderecoEmpresa', cliente.logradouro, 'cadastro');
      set('numeroEmpresa', cliente.numero, 'cadastro');
      set('bairroEmpresa', cliente.bairro, 'cadastro');
      set('cidadeEmpresa', cliente.cidade, 'cadastro');
      set('ufEmpresa', cliente.uf, 'cadastro');
    } else {
      set('tipo', 'pf', 'cadastro');
      set('nome', cliente.nome, 'cadastro'); // nome verificado do Cadastro (nunca do Kommo)
      set('cpf', cliente.cpf_cnpj && maskCPF(cliente.cpf_cnpj), 'cadastro');
      set('rg', cliente.rg && maskRG(cliente.rg), 'cadastro');
      set('dataNascimento', fmtDateISO(cliente.nascimento), 'cadastro');
      set('profissao', cliente.profissao, 'cadastro');
      set('estadoCivil', normalizeEstadoCivil(cliente.estado_civil), 'cadastro');
      set('sexo', normalizeSexo(cliente.genero), 'cadastro');
      set('nacionalidade', cliente.nacionalidade, 'cadastro');
      set('cep', cliente.cep && maskCEP(cliente.cep), 'cadastro');
      set('endereco', cliente.logradouro, 'cadastro');
      set('numero', cliente.numero, 'cadastro');
      set('complemento', cliente.complemento, 'cadastro');
      set('bairro', cliente.bairro, 'cadastro');
      set('cidade', cliente.cidade, 'cadastro');
      set('uf', cliente.uf, 'cadastro');
      set('email', cliente.email, 'cadastro');
    }
    set('resort', matchResort(cliente.empreendimentos), 'cadastro');
    if (!campos.telefone && cliente.telefone) set('telefone', fmtTelefone(cliente.telefone), 'cadastro');
  }

  if (!campos.email && contato.email) set('email', contato.email, 'kommo'); // fallback: cadastro sem email

  if (campos.resort == null) {
    for (const t of tags) {
      const r = matchResort(t);
      if (r) { set('resort', r, 'tag'); break; }
    }
  }

  if (primeiraMsgConversas) set('dataPrimeiraMensagem', fmtDateISO(primeiraMsgConversas), 'conversas');
  else if (leadCriadoEm) set('dataPrimeiraMensagem', fmtDateISO(leadCriadoEm), 'kommo');

  const resortConfirmar = proveniencia.resort === 'tag' || proveniencia.resort === 'cadastro';
  // resortAlterado = havia um resort diferente e o Kommo trocou -> aviso mais forte
  const resortAlterado = !!(resortAntigo && campos.resort && resortAntigo !== String(campos.resort).trim());
  return { campos, proveniencia, clienteConhecido, resortConfirmar, resortAlterado };
}

// registro da excecao "contrato sem lead no Kommo" (quem/quando/motivo)
export function montarRegistroSemKommo(email, motivo, agoraISO) {
  return {
    user: (email || '').trim().toLowerCase(),
    ts: agoraISO || null,
    motivo: (motivo || '').trim(),
  };
}
