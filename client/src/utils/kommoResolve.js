// Logica PURA do "Vincular Kommo": monta o preenchimento do formulario a partir
// do lead (Kommo) + Cadastro Unico (clientes) + Arquivo CBC Conversas.
// Regras fechadas com o Paulo (23/07):
//  - NUNCA preenche 'nome' (vem da API de CPF) nem 'origemCliente' (manual).
//  - Nao sobrescreve campo ja digitado.
//  - Resort auto (tag/cadastro) sempre pede confirmacao.
import { RESORTS } from '../data/clausulas';
import { maskPhone } from './masks';

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
// atuais = valores ja no form (nao sobrescreve os preenchidos)
export function montarPreenchimento(raw, atuais = {}) {
  const { contato = {}, tags = [], cliente = null, primeiraMsgConversas = null, leadCriadoEm = null } = raw || {};
  const campos = {};
  const proveniencia = {};
  const NUNCA = new Set(['nome', 'origemCliente']);
  const resortAntigo = String(atuais.resort || '').trim();

  // forcar=true sobrescreve o que ja esta no form (usado so no resort, por decisao do Paulo)
  const set = (k, v, origem, forcar = false) => {
    if (NUNCA.has(k)) return;
    if (v == null || v === '') return;
    if (!forcar) {
      const atual = atuais[k];
      if (atual != null && String(atual).trim() !== '') return; // nao sobrescreve digitacao manual
    }
    campos[k] = v;
    proveniencia[k] = origem;
  };

  set('telefone', fmtTelefone(contato.telefone), 'kommo', true); // telefone do lead SEMPRE (re)formata/sobrescreve

  const clienteConhecido = !!cliente;
  if (clienteConhecido) {
    set('rg', cliente.rg, 'cadastro');
    set('dataNascimento', fmtDateISO(cliente.nascimento), 'cadastro');
    set('profissao', cliente.profissao, 'cadastro');
    set('estadoCivil', normalizeEstadoCivil(cliente.estado_civil), 'cadastro');
    set('sexo', normalizeSexo(cliente.genero), 'cadastro');
    set('nacionalidade', cliente.nacionalidade, 'cadastro');
    set('cep', cliente.cep, 'cadastro');
    set('endereco', cliente.logradouro, 'cadastro');
    set('numero', cliente.numero, 'cadastro');
    set('complemento', cliente.complemento, 'cadastro');
    set('bairro', cliente.bairro, 'cadastro');
    set('cidade', cliente.cidade, 'cadastro');
    set('uf', cliente.uf, 'cadastro');
    set('email', cliente.email, 'cadastro');
    set('resort', matchResort(cliente.empreendimentos), 'cadastro', true); // resort SEMPRE sobrescreve
  }

  set('email', contato.email, 'kommo'); // se o cadastro nao tinha

  if (campos.resort == null) {
    for (const t of tags) {
      const r = matchResort(t);
      if (r) { set('resort', r, 'tag', true); break; } // resort da tag SEMPRE sobrescreve
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
