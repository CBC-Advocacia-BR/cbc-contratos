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
import { detectGenderByName } from './genderDetector';

// telefone do Kommo pode vir "55DD+numero" -> padrao do form "(DD) numero".
// dropa o codigo de pais 55 SO quando ele existe (12-13 digitos), nunca de um
// numero nacional que por acaso comece com DDD 55 (11 digitos).
function fmtTelefone(t) {
  let d = (t || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2); // codigo de pais BR
  d = d.slice(-11);
  // (item 8) todo numero e WhatsApp (celular): se veio com 10 digitos (DDD+8), falta o
  // 9 do celular -> completa (DDD + 9 + 8 digitos = 11).
  if (d.length === 10) d = d.slice(0, 2) + '9' + d.slice(2);
  return d ? maskPhone(d) : '';
}

// normaliza p/ casar: sem acento, caixa alta, so alfanumerico + espaco
const norm = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const RESORT_BY_NORM = new Map(RESORTS.map((r) => [norm(r), r]));

// (item 2) apoio ao resolvedor de tags sujas do Kommo.
// 1a palavra do resort -> resorts que comecam com ela (p/ tags curtas tipo "ATRIUM").
const RESORT_FIRST_WORD = new Map();
for (const r of RESORTS) {
  const w = norm(r).split(' ')[0];
  if (!RESORT_FIRST_WORD.has(w)) RESORT_FIRST_WORD.set(w, []);
  RESORT_FIRST_WORD.get(w).push(r);
}
// resorts do mais longo p/ o mais curto (p/ o "contido na tag" pegar o mais especifico).
const RESORTS_BY_LEN = RESORTS.map((r) => [norm(r), r]).sort((a, b) => b[0].length - a[0].length);
// apelidos curados p/ casos irregulares que as regras nao pegam (tag suja -> canonico).
const RESORT_ALIASES = {}; // ex.: { 'NOME SUJO': 'Resort Canonico' } — estende quando aparecer

// (item 2) resolve uma TAG suja do Kommo p/ um resort da lista. Ordem: exato -> apelido
// -> partes separadas por -/| -> resort contido na tag (mais especifico, palavra inteira)
// -> 1a palavra que seja unica de um resort.
export function resolveResortTag(tag) {
  const n = norm(tag);
  if (!n) return '';
  if (RESORT_BY_NORM.has(n)) return RESORT_BY_NORM.get(n);
  if (RESORT_ALIASES[n]) return RESORT_ALIASES[n];
  for (const parte of n.split(/[-/|]/)) {
    const p = parte.trim();
    if (RESORT_BY_NORM.has(p)) return RESORT_BY_NORM.get(p); // "Acordos Particular-Ondas Praia"
  }
  const padded = ` ${n} `;
  for (const [rn, r] of RESORTS_BY_LEN) {
    if (rn.length >= 5 && padded.includes(` ${rn} `)) return r; // "ALTA VISTA THERMAS-Quitado" contem "Alta Vista"
  }
  const w = n.split(' ')[0];
  const cand = RESORT_FIRST_WORD.get(w);
  if (cand && cand.length === 1 && w.length >= 4) return cand[0]; // "ATRIUM" -> "Atrium Thermas" (unica)
  return '';
}

// resorts distintos resolvidos de uma lista de strings (partes do cadastro ou tags)
const resortsDistintos = (strs) => [...new Set((strs || []).map(resolveResortTag).filter(Boolean))];

// (item 1) nomes "parecidos" p/ validar o match por telefone: algum token >=4 do nome
// do Cadastro aparece dentro do nome do lead (tolera apelido "jb batistasantos668").
function nomesParecidos(nomeCad, nomeLead) {
  const b = norm(nomeLead).replace(/ /g, '');
  const toks = norm(nomeCad).split(' ').filter((t) => t.length >= 4);
  if (!toks.length || !b) return true; // sem base p/ comparar -> nao alarma
  return toks.some((t) => b.includes(t));
}

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
  const { contato = {}, tags = [], cliente = null, primeiraMsgConversas = null, leadCriadoEm = null, nomeLead = '', matchPor = null } = raw || {};
  const campos = {};
  const proveniencia = {};
  const NUNCA = new Set(['origemCliente']); // nome pode vir do Cadastro Unico (nunca do Kommo)
  const resortAntigo = String(atuais.resort || '').trim();
  let resortOpcoes = null; // (itens 3/4) varios resorts (cadastro ou tags) -> usuario escolhe
  let sexoConflito = null; // (item 1) genero do cadastro diverge do nome -> alerta

  // vincular e autoritativo: SEMPRE (re)preenche os campos derivados do lead (telefone,
  // resort, endereco/qualificacao do Cadastro, 1a msg). Inserir um lead diferente
  // sobrescreve tudo. Campos NAO derivados do lead (cpf, nome, honorarios...) nao sao tocados.
  const set = (k, v, origem) => {
    if (NUNCA.has(k)) return;
    if (v == null || v === '') return;
    campos[k] = v;
    proveniencia[k] = origem;
  };

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
      const sexoCad = normalizeSexo(cliente.genero);
      const sexoNome = cliente.nome ? detectGenderByName(cliente.nome) : null;
      if (sexoCad) {
        set('sexo', sexoCad, 'cadastro');
        if (sexoNome && sexoNome !== sexoCad) sexoConflito = { cadastro: sexoCad, nome: sexoNome }; // (item 1) alerta: cadastro diverge do nome
      } else if (sexoNome) {
        set('sexo', sexoNome, 'auto'); // (item 8) deduz do nome quando o cadastro nao tem genero
      }
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
    // (itens 2/4) resort do cadastro: pode ter VARIOS ("ONDAS PRAIA, SOLAR DAS AGUAS").
    // 1 -> preenche; 2+ -> nao adivinha, oferece p/ escolher; 0 -> deixa p/ a tag/manual.
    const resortsCad = resortsDistintos(String(cliente.empreendimentos || '').split(/[;,]/));
    if (resortsCad.length === 1) set('resort', resortsCad[0], 'cadastro');
    else if (resortsCad.length > 1) resortOpcoes = resortsCad;
    set('telefone', fmtTelefone(cliente.telefone), 'cadastro'); // numero canonico do Cadastro (11 digitos, com o 9)
  }

  if (!campos.telefone) set('telefone', fmtTelefone(contato.telefone), 'kommo'); // lead novo, ou cadastro sem telefone
  if (!campos.email && contato.email) set('email', contato.email, 'kommo'); // fallback: cadastro sem email

  if (campos.resort == null) {
    // (itens 2/3) tags sujas ("Acordos-Ondas Praia", "ATRIUM"); varias distintas -> escolher
    const resortsTag = resortsDistintos(tags);
    if (resortsTag.length === 1) set('resort', resortsTag[0], 'tag');
    else if (resortsTag.length > 1) resortOpcoes = resortOpcoes || resortsTag;
  }

  if (primeiraMsgConversas) set('dataPrimeiraMensagem', fmtDateISO(primeiraMsgConversas), 'conversas');
  else if (leadCriadoEm) set('dataPrimeiraMensagem', fmtDateISO(leadCriadoEm), 'kommo');

  const resortConfirmar = proveniencia.resort === 'tag' || proveniencia.resort === 'cadastro';
  // resortAlterado = havia um resort diferente e o Kommo trocou -> aviso mais forte
  const resortAlterado = !!(resortAntigo && campos.resort && resortAntigo !== String(campos.resort).trim());
  // (item 1) casou por TELEFONE mas os nomes divergem -> pode ser pessoa errada
  let matchDuvidoso = null;
  if (clienteConhecido && matchPor === 'telefone' && nomeLead && cliente.nome && !nomesParecidos(cliente.nome, nomeLead)) {
    matchDuvidoso = { cadastro: cliente.nome, lead: nomeLead };
  }
  return { campos, proveniencia, clienteConhecido, resortConfirmar, resortAlterado, resortOpcoes, sexoConflito, matchDuvidoso };
}

// registro da excecao "contrato sem lead no Kommo" (quem/quando/motivo)
export function montarRegistroSemKommo(email, motivo, agoraISO) {
  return {
    user: (email || '').trim().toLowerCase(),
    ts: agoraISO || null,
    motivo: (motivo || '').trim(),
  };
}
