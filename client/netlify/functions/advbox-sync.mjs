/**
 * Netlify Function: ADVBOX sync proxy
 * Creates customers and lawsuits in ADVBOX when called
 * Bypasses CORS/Cloudflare blocking
 */
import { logAdvbox } from './_lib/botDb.mjs';
// (#9) Mapeamentos ADVBOX (origem + tipo de acao) vem de uma FONTE UNICA compartilhada,
// testada em vitest — antes havia uma 2a copia no client que divergiu (bug Revisao de Distrato).
import { getOrigemId, getTipoAcaoId } from './_lib/advboxMaps.mjs';

const ADVBOX_TOKEN = process.env.ADVBOX_TOKEN;
const ADVBOX_URL = 'https://app.advbox.com.br/api/v1';
const HEADERS = {
  'Authorization': `Bearer ${ADVBOX_TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (CBC-Contratos)',
};

const STAGE_ASSINADO_AUTOMACAO = 3795429;
const RESPONSAVEL_PADRAO = 241495;

// Kommo (CRM) — apos criar cliente + processo no ADVBOX, move o lead para a
// etapa "ADVBOX" no funil "Venda". Token via env var (server-side, nunca no bundle).
const KOMMO_TOKEN = process.env.KOMMO_TOKEN || '';
const KOMMO_BASE = 'https://advocaciacbc.kommo.com/api/v4';
const KOMMO_PIPELINE_VENDA = 13760367; // funil "Venda"
const KOMMO_STAGE_ADVBOX = 106388919;  // etapa "ADVBOX" dentro do funil "Venda"
const KOMMO_FIELD_DRIVE = 2426274;     // campo personalizado "Drive" do lead (texto)
const SELF_URL = process.env.URL || 'https://contratos-cbc.netlify.app';

function normalizeText(text) {
  if (!text) return '';
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function profissaoMasculino(p) {
  if (!p) return '';
  p = normalizeText(p);
  const map = {
    'EMPRESARIA': 'EMPRESARIO', 'AUTONOMA': 'AUTONOMO', 'APOSENTADA': 'APOSENTADO',
    'ADVOGADA': 'ADVOGADO', 'PROFESSORA': 'PROFESSOR', 'ENFERMEIRA': 'ENFERMEIRO',
    'MEDICA': 'MEDICO', 'ENGENHEIRA': 'ENGENHEIRO', 'ADMINISTRADORA': 'ADMINISTRADOR',
    'CONTADORA': 'CONTADOR', 'VENDEDORA': 'VENDEDOR', 'COZINHEIRA': 'COZINHEIRO',
    'DONA DE CASA': 'DO LAR', 'PSICOLOGA': 'PSICOLOGO', 'SECRETARIA': 'SECRETARIO',
    'FUNCIONARIA PUBLICA': 'FUNCIONARIO PUBLICO', 'SERVIDORA PUBLICA': 'SERVIDOR PUBLICO',
    'AUXILIAR ADMINISTRATIVA': 'AUXILIAR ADMINISTRATIVO', 'BANCARIA': 'BANCARIO',
    'OPERADORA': 'OPERADOR', 'COSTUREIRA': 'COSTUREIRO', 'CABELEIREIRA': 'CABELEIREIRO',
    'CORRETORA': 'CORRETOR', 'CONSULTORA': 'CONSULTOR', 'COORDENADORA': 'COORDENADOR',
    'SUPERVISORA': 'SUPERVISOR', 'DIRETORA': 'DIRETOR', 'PROMOTORA': 'PROMOTOR',
    'PEDAGOGA': 'PEDAGOGO', 'FARMACEUTICA': 'FARMACEUTICO', 'ARQUITETA': 'ARQUITETO',
    'FOTOGRAFA': 'FOTOGRAFO', 'BIOLOGA': 'BIOLOGO', 'DECORADORA': 'DECORADOR',
  };
  if (map[p]) return map[p];
  const neutros = ['ISTA', 'NTE', 'URE', 'GEM'];
  if (!neutros.some(n => p.endsWith(n)) && p.endsWith('A') && p.length > 3) return p.slice(0, -1) + 'O';
  return p;
}

function detectGender(c) {
  // 1) Campo sexo explicito (preenchido pela deteccao do formulario)
  if (c.sexo === 'F' || c.sexo === 'M') return c.sexo;
  // 2) Nacionalidade com marca de genero (os dois sentidos)
  const nac = (c.nacionalidade || '').toLowerCase();
  if (nac.includes('brasileira')) return 'F';
  if (nac.includes('brasileiro')) return 'M';
  // 3) Profissao em forma feminina: profissaoMasculino() converte fem->masc;
  //    se o resultado mudou, a profissao original estava no feminino.
  const profRaw = normalizeText(c.profissao);
  if (profRaw && profissaoMasculino(c.profissao) !== profRaw) return 'F';
  // 4) Estado civil com marca de genero (ex.: "Solteira" sem o "(a)")
  const ec = (c.estadoCivil || '').toLowerCase();
  if (/\b(casada|divorciada|viuva|solteira|companheira)\b/.test(ec)) return 'F';
  if (/\b(casado|divorciado|viuvo|solteiro|companheiro)\b/.test(ec)) return 'M';
  // 5) Heuristica de nome: nomes brasileiros terminados em "a" sao majoritariamente
  //    femininos (so dispara quando nenhum outro sinal existe; excecoes masculinas).
  const first = normalizeText(c.nome).split(/\s+/)[0] || '';
  const excMasc = ['LUCA', 'JOSHUA', 'NICOLA', 'NOA', 'JEREMIAS', 'ELIAS', 'TOBIAS', 'MATIAS', 'DARLA'];
  if (first.length > 2 && first.endsWith('A') && !excMasc.includes(first)) return 'F';
  return 'M';
}

function formatCEP(cep) {
  const clean = (cep || '').replace(/\D/g, '');
  if (clean.length === 8) return `${clean.slice(0, 5)}-${clean.slice(5)}`;
  return clean;
}

async function findCustomerByCPF(cpf) {
  const clean = (cpf || '').replace(/\D/g, '');
  if (clean.length !== 11) return null;
  try {
    // (perf-be-6 / integ-6) busca DIRETA por CPF (?identification) em vez de baixar
    // a lista inteira de clientes do ADVBOX — antes isso ficava lento e gastava cota
    // conforme a base crescia, e podia travar o retro/retry em "error" numa base grande.
    const resp = await fetch(`${ADVBOX_URL}/customers?identification=${encodeURIComponent(clean)}&limit=5`, {
      headers: HEADERS, signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    const list = result.data || result.customers || (Array.isArray(result) ? result : []);
    const match = list.find(c => (c.identification || '').replace(/\D/g, '') === clean) || list[0];
    if (match) return { id: match.id, name: match.name, existing: true };
  } catch { /* ignore */ }
  return null;
}

// (PJ 25/06) busca cliente por CPF (11) OU CNPJ (14) — generaliza findCustomerByCPF.
async function findCustomerByIdentification(idClean) {
  const clean = (idClean || '').replace(/\D/g, '');
  if (clean.length !== 11 && clean.length !== 14) return null;
  try {
    const resp = await fetch(`${ADVBOX_URL}/customers?identification=${encodeURIComponent(clean)}&limit=5`, {
      headers: HEADERS, signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    const list = result.data || result.customers || (Array.isArray(result) ? result : []);
    const match = list.find(c => (c.identification || '').replace(/\D/g, '') === clean) || list[0];
    if (match) return { id: match.id, name: match.name, existing: true };
  } catch { /* ignore */ }
  return null;
}

// (PJ) Resumo do representante legal p/ o campo notes do cliente PJ (ADVBOX nao tem campo nativo).
function resumoRepresentante(c) {
  return `Representante legal: ${normalizeText(c.nome)}`
    + (c.cpf ? `, CPF: ${c.cpf}` : '')
    + (c.rg ? `, RG: ${normalizeText(c.rg)}` : '')
    + (c.email ? `, e-mail: ${normalizeText(c.email)}` : '')
    + (c.telefone ? `, tel: ${c.telefone}` : '');
}

async function createCustomer(c, origem) {
  const isPJ = c.tipo === 'pj';
  const idClean = ((isPJ ? c.cnpj : c.cpf) || '').replace(/\D/g, '');
  // Montar endereço com número e complemento (empresa quando PJ, pessoa quando PF/representante)
  let street = normalizeText(isPJ ? c.enderecoEmpresa : c.endereco);
  const numero = isPJ ? c.numeroEmpresa : c.numero;
  const complemento = isPJ ? c.complementoEmpresa : c.complemento;
  if (numero) street += ', N ' + normalizeText(numero);
  if (complemento) street += ', ' + normalizeText(complemento);

  // notes padrao quando o caller nao definiu _notes (PJ inclui o representante legal)
  const defaultNotes = [
    isPJ ? resumoRepresentante(c) : '',
    c.linkKommo ? `Kommo: ${c.linkKommo}` : '',
  ].filter(Boolean).join('\n') || null;

  const body = {
    // (PJ) cliente PJ: name = razao social, identification = CNPJ, e-mail/endereco da empresa;
    // os campos de pessoa (genero/estado civil/profissao/nacionalidade/RG/nascimento) sao do
    // individuo — nao se aplicam a empresa, entao ficam vazios. O representante vai em notes.
    name: normalizeText(isPJ ? c.razaoSocial : c.nome),
    identification: idClean,
    users_id: RESPONSAVEL_PADRAO,
    customers_origins_id: getOrigemId(origem),
    email: normalizeText(isPJ ? c.emailEmpresa : c.email),
    gender: isPJ ? null : detectGender(c),
    civil_status: isPJ ? '' : normalizeText(c.estadoCivil),
    occupation: isPJ ? '' : profissaoMasculino(c.profissao),
    cellphone: c.telefone || c.celular || null,
    street: street,
    region: normalizeText(isPJ ? c.bairroEmpresa : c.bairro),
    city: normalizeText(isPJ ? c.cidadeEmpresa : c.cidade),
    state: ((isPJ ? c.ufEmpresa : c.uf) || '').toUpperCase(),
    country: 'BRASIL',
    postalcode: formatCEP(isPJ ? c.cepEmpresa : c.cep),
    nationality: isPJ ? '' : normalizeText(c.nacionalidade),
    document: isPJ ? null : (c.rg || null),
    birthdate: isPJ ? null : (c.dataNascimento || null), // YYYY-MM-DD (ADVBOX expoe o campo como "birthdate", nao "birthday")
    notes: c._notes || defaultNotes,
  };

  const resp = await fetch(`${ADVBOX_URL}/customers`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    // ADVBOX bloqueia CPF/CNPJ/nome duplicados com erro de validacao em PT/Laravel
    // (keyed por identification/name), NAO com "duplicate"/"already exists" em ingles.
    // Antes de falhar, tenta SEMPRE recuperar o cliente existente por identificacao —
    // findCustomerByIdentification e idempotente e devolve null se nao achar (NUNCA deleta).
    const existing = await findCustomerByIdentification(idClean);
    if (existing) return { ...existing, existing: true };
    throw new Error(JSON.stringify(err.errors || err.message || err));
  }

  const data = await resp.json();
  return { id: data.customers_id || data.id, name: body.name };
}

/**
 * Client already exists in ADVBOX — API does not support PUT/PATCH.
 * Just return the existing client and log which fields may be outdated.
 */

// Map user emails to ADVBOX user IDs
const USER_MAP = {
  'paulo@advocaciacbc.com': 241495,      // PAULO CONFORTO
  'paulo.conforto@outlook.com': 241495,
  'bruno@advocaciacbc.com': 242882,       // BRUNO CAVALARI
  'grazie@advocaciacbc.com': 242673,      // GRAZIE MORAES (242675 era a ISABELA BUZINARI)
  'juliane@advocaciacbc.com': 242676,     // JULIANE SOLIGO
  'leonardo@advocaciacbc.com': 242677,    // LEONARDO BOAVENTURA
  'isabela@advocaciacbc.com': 242675,     // ISABELA BUZINARI
  'lucas@advocaciacbc.com': 242679,       // LUCAS CONFORTO
  'mariana@advocaciacbc.com': 242681,     // MARIANA LACERDA
};

function getResponsavelId(email) {
  if (!email) return RESPONSAVEL_PADRAO;
  const lower = email.toLowerCase();
  return USER_MAP[lower] || RESPONSAVEL_PADRAO;
}

async function createLawsuit(customerIds, tipoAcao, dataFechamento, dataCadastro, honorarios, responsavelEmail, observacoes, resort, contratantes, linkGoogleDrive) {
  const responsavelId = getResponsavelId(responsavelEmail);
  const body = {
    customers_id: customerIds,
    type_lawsuits_id: getTipoAcaoId(tipoAcao),
    users_id: responsavelId,
    stages_id: STAGE_ASSINADO_AUTOMACAO,
  };
  // Data de fechamento = data que o cliente assinou no ZapSign
  if (dataFechamento) body.status_closure = dataFechamento;
  // Data de cadastro = data da primeira mensagem do cliente
  if (dataCadastro) body.created_at = dataCadastro;

  // Anotações gerais — resort como primeira linha
  const notesParts = [];
  if (resort) notesParts.push(`Resort: ${resort}`);

  // Check elderly priority (60+ years)
  if (contratantes) {
    for (const ct of contratantes) {
      if (ct?.dataNascimento) {
        const birth = new Date(ct.dataNascimento + 'T12:00:00');
        const age = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        if (age >= 60) {
          notesParts.push(`PEDIR PRIORIDADE DE IDOSO - ${ct.nome} (${age} anos)`);
        }
      }
    }
  }
  if (honorarios) {
    const total = Number(honorarios.total) || 0;
    const exitoPct = Number(honorarios.percentualExito) || 0;
    const somenteExito = honorarios.somenteExito;
    const somenteIniciais = honorarios.somenteIniciais;

    if (!somenteExito && total > 0) body.fees_money = total;
    body.contingency = !somenteIniciais && exitoPct > 0 ? exitoPct : 0;

    // Info completa para anotações
    if (somenteExito) {
      notesParts.push('Honorários iniciais: SEM (somente êxito)');
      notesParts.push(`Percentual de honorários de êxito: ${exitoPct}%`);
    } else if (somenteIniciais) {
      notesParts.push(`Honorários iniciais: R$ ${total.toLocaleString('pt-BR')}`);
      notesParts.push('Honorários de êxito: SEM (somente iniciais)');
    } else {
      notesParts.push(`Honorários iniciais: R$ ${total.toLocaleString('pt-BR')}`);
      notesParts.push(`Percentual de honorários de êxito: ${exitoPct}%`);
    }
  }
  if (observacoes) notesParts.push(observacoes);
  // Link da pasta Google Drive do cliente — última linha sempre
  if (linkGoogleDrive) notesParts.push(`Pasta Google Drive: ${linkGoogleDrive}`);
  body.notes = notesParts.join('\n\n');

  const resp = await fetch(`${ADVBOX_URL}/lawsuits`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(JSON.stringify(err.errors || err.message || err));
  }

  const data = await resp.json();
  return { id: data.lawsuits_id || data.id };
}

// Extrai o ID numerico do lead a partir da URL do Kommo
// (formato: https://advocaciacbc.kommo.com/leads/detail/12345678)
function extrairLeadIdKommo(link) {
  if (!link) return null;
  const m = String(link).match(/\/leads\/detail\/(\d+)/);
  return m ? m[1] : null;
}

// Move um lead para a etapa ADVBOX do funil Venda (PATCH idempotente)
async function moverLeadKommo(leadId, linkDrive) {
  if (!KOMMO_TOKEN) throw new Error('KOMMO_TOKEN nao configurado');
  const body = { pipeline_id: KOMMO_PIPELINE_VENDA, status_id: KOMMO_STAGE_ADVBOX };
  // Preenche o campo personalizado "Drive" do lead no mesmo PATCH (sem custo extra)
  if (linkDrive) {
    body.custom_fields_values = [{ field_id: KOMMO_FIELD_DRIVE, values: [{ value: String(linkDrive) }] }];
  }
  const resp = await fetch(`${KOMMO_BASE}/leads/${leadId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${KOMMO_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${errTxt.slice(0, 200)}`);
  }
  return resp.json().catch(() => ({}));
}

// Monta o texto da nota de resumo do negocio (#14)
function montarResumoNota({ resort, tipo, honorarios, escritorioArcaCustas, contratantes, linkGoogleDrive, num }) {
  const linhas = [`📋 Contrato assinado${resort ? ` — ${resort}` : ''}`];
  if (tipo) linhas.push(`• Ação: ${tipo}`);
  if (honorarios) {
    const total = Number(honorarios.total) || 0;
    const exito = Number(honorarios.percentualExito) || 0;
    const partes = [];
    if (!honorarios.somenteExito && total > 0) partes.push(`iniciais R$ ${total.toLocaleString('pt-BR')}`);
    if (!honorarios.somenteIniciais && exito > 0) partes.push(`êxito ${exito}%`);
    if (partes.length) linhas.push(`• Honorários: ${partes.join(' • ')}`);
  }
  linhas.push(`• Custas: ${escritorioArcaCustas ? 'escritório adianta' : 'cliente paga'}`);
  const nomes = (contratantes || []).slice(0, num).map(c => c?.nome).filter(Boolean);
  if (nomes.length) linhas.push(`• Contratante${nomes.length > 1 ? 's' : ''}: ${nomes.join(', ')}`);
  if (linkGoogleDrive) linhas.push(`• Pasta no Drive: ${linkGoogleDrive}`);
  return linhas.join('\n');
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  try {
    const { contratantes, numContratantes, tipoAcao, tipoAcaoCustom, origemCliente, dataAssinatura, dataPrimeiraMensagem, honorarios, user_email, observacoesInternas, escritorioArcaCustas, resort: rawResort, resortCustom, linkGoogleDrive, existingLawsuitId, existingCustomers } = await req.json();
    const tipo = tipoAcao === 'outro' ? tipoAcaoCustom : tipoAcao;
    const resort = rawResort === 'outro' ? resortCustom : rawResort;
    // Data de fechamento = data que assinou no ZapSign
    const dataFechamento = dataAssinatura || new Date().toISOString().split('T')[0];
    // Data de cadastro = data da primeira mensagem do cliente
    const dataCadastro = dataPrimeiraMensagem || null;
    const num = numContratantes || 1;
    const warnings = [];
    let customers = [];
    // (#6) Quantos contratantes (com nome) deveriam virar cliente — base do customersComplete.
    const expectedCount = (contratantes || []).slice(0, num).filter(c => c?.nome).length;

    // (#7) Idempotencia: se o retry ja traz os clientes criados, reusa em vez de recriar.
    if (Array.isArray(existingCustomers) && existingCustomers.filter(c => c && c.id).length >= expectedCount && expectedCount > 0) {
      customers = existingCustomers.filter(c => c && c.id);
    } else {
      // Create customers — add cônjuge info to notes when 2 contratantes
      for (let i = 0; i < num; i++) {
        const c = contratantes?.[i];
        if (!c || !c.nome) continue;

        // Build notes with Kommo link + cônjuge info (+ representante legal quando PJ)
        const notesParts = [];
        if (c.tipo === 'pj') notesParts.push(resumoRepresentante(c));
        if (c.linkKommo) notesParts.push(`Kommo: ${c.linkKommo}`);
        if (num === 2) {
          const otherIdx = i === 0 ? 1 : 0;
          const other = contratantes?.[otherIdx];
          if (other?.nome) notesParts.push(`Conjuge de ${normalizeText(other.nome)}`);
        }
        c._notes = notesParts.join('\n');

        try {
          const result = await createCustomer(c, origemCliente);
          if (result) {
            customers.push(result);
            if (result.existing) warnings.push(`${normalizeText(c.nome)}: ja existia no ADVBOX`);
          }
        } catch (err) {
          warnings.push(`Erro cliente ${c.nome}: ${err.message}`);
        }
      }
    }

    // (#6) Só completo quando TODOS os contratantes (com nome) viraram cliente.
    const customersComplete = expectedCount > 0 && customers.length >= expectedCount;

    // Create lawsuit (#7: reusa o processo ja criado no retry — nunca duplica)
    let lawsuit = null;
    if (existingLawsuitId) {
      lawsuit = { id: existingLawsuitId, reused: true };
    } else if (customers.length > 0 && customersComplete) {
      try {
        // Append custas info to observações
        let obs = observacoesInternas || '';
        if (escritorioArcaCustas) {
          obs = obs ? `O ESCRITÓRIO PAGA AS CUSTAS PROCESSUAIS\n\n${obs}` : 'O ESCRITÓRIO PAGA AS CUSTAS PROCESSUAIS';
        }
        lawsuit = await createLawsuit(customers.map(c => c.id), tipo, dataFechamento, dataCadastro, honorarios, user_email, obs, resort, contratantes, linkGoogleDrive);
      } catch (err) {
        warnings.push(`Erro processo: ${err.message}`);
      }
    } else if (customers.length > 0 && !customersComplete) {
      // (#6) cria cliente(s) mas NAO o processo enquanto faltar contratante — evita
      // processo com parte faltando. Fica como warning e o polling re-tenta.
      warnings.push(`Processo nao criado: ${customers.length}/${expectedCount} contratantes criados no ADVBOX`);
    }

    // Kommo — mover lead(s) para a etapa ADVBOX no funil Venda.
    // So roda apos cliente + processo criados no ADVBOX (regra de negocio).
    // Falha aqui NAO derruba o ADVBOX: vira warning. PATCH e idempotente,
    // entao o retry do ADVBOX no Monitor re-tenta o Kommo sem efeito colateral.
    let kommo = null;
    if (lawsuit && KOMMO_TOKEN) {
      const moved = [];
      const seen = new Set();
      const resumoTexto = montarResumoNota({ resort, tipo, honorarios, escritorioArcaCustas, contratantes, linkGoogleDrive, num });
      for (let i = 0; i < num; i++) {
        const leadId = extrairLeadIdKommo(contratantes?.[i]?.linkKommo);
        if (!leadId || seen.has(leadId)) continue;
        seen.add(leadId);
        try {
          await moverLeadKommo(leadId, linkGoogleDrive);
          moved.push(leadId);
          // #14: nota de resumo do negocio no lead (idempotente via kommo-note)
          try {
            await fetch(`${SELF_URL}/.netlify/functions/kommo-note`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ leadId, marker: 'CBC.resumo', text: resumoTexto }),
            });
          } catch (e) {
            // (integ-19) nota best-effort, mas registra a falha p/ aparecer no Monitor
            await logAdvbox('kommo', 'aviso', `nota resumo lead ${leadId} falhou: ${e.message}`.slice(0, 300), { leadId });
          }
        } catch (err) {
          // (integ-19) falha ao mover o lead no Kommo (token expirado etc.) vira aviso
          // central no advbox_api_log em vez de so um warning que some na resposta.
          warnings.push(`Kommo lead ${leadId}: ${err.message}`);
          await logAdvbox('kommo', 'erro', `mover lead ${leadId} falhou: ${err.message}`.slice(0, 300), { leadId });
        }
      }
      kommo = { moved, pipeline: 'Venda', stage: 'ADVBOX' };
    } else if (lawsuit && !KOMMO_TOKEN) {
      warnings.push('Kommo: KOMMO_TOKEN nao configurado no Netlify — lead nao movido');
    }

    return new Response(JSON.stringify({ success: true, customers, customersComplete, expectedCount, lawsuit, kommo, warnings }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

export const config = { path: '/.netlify/functions/advbox-sync' };
