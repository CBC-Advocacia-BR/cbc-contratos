/**
 * Detecta gênero pelo primeiro nome usando regras da língua portuguesa.
 * Baseado em terminações mais comuns e lista de nomes ambíguos.
 * Retorna 'M', 'F' ou null (indefinido)
 */

// Nomes femininos comuns que não seguem a regra de terminação
const FEMININOS = new Set([
  'ALICE','BEATRIZ','CRIS','INES','IRIS','JACI','JURACI','LUIZA','MABEL',
  'MERCEDES','RAQUEL','RUTH','SUELI','SOLANGE','DENISE','ELIANE','ELISA',
  'ELISABETE','ELIZABETH','ESTER','GISELE','GRACE','IRENE','IVONE','JAQUELINE',
  'JENNIFER','JOSIANE','JOYCE','KAREN','KARINE','LILIAN','LILIANE','LOURDES',
  'MADALENA','MAGALI','MARGARIDA','MARILENE','MARISTELA','MARLENE','MICHELE',
  'MIRIAM','NAIR','NEIDE','NICOLE','NOEMI','RACHEL','ROSANE','ROSILENE',
  'SIMONE','SIRLEI','TAIS','THAMIRIS','VIVIAN','VIVIANE','CARMEN',
  'CELESTE','CIBELE','DOLORES','EDITH','ELLEN','ESTHER','GISLAINE','HELOISA',
  'IRACEMA','ISIS','IVETE','JANE','JUSSARA','KATIA','KELEN','LETICIA',
  'LILIAN','MABEL','MARCIA','MARLI','MIRELA','NADIA','NEUZA','PIETRA',
  'PRISCILA','RENATA','SILVANA','SONIA','SUELY','VALERIA','VANESSA','ZELIA',
]);

// Nomes masculinos comuns que terminam em A
const MASCULINOS_EM_A = new Set([
  'AYRTON','JOSUE','NIKOLAS','LUCA','ENZO','NOAH','DAVI','ELIAS','LUCAS',
  'MATIAS','TOBIAS','JEOVA','BATISTA','EVANGELISTA','SOUSA','MOURA',
]);

// Nomes ambíguos (usados por ambos os gêneros)
const AMBIGUOS = new Set([
  'ARIEL','DARCI','JACI','JURACI','MAURI','NERI','SADI','SUELI',
]);

/**
 * Detecta gênero pelo primeiro nome
 * @param {string} fullName - Nome completo
 * @returns {'M'|'F'|null}
 */
export function detectGenderByName(fullName) {
  if (!fullName || typeof fullName !== 'string') return null;

  const firstName = fullName.trim().split(/\s+/)[0].toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (!firstName || firstName.length < 2) return null;

  // Check explicit lists first
  if (FEMININOS.has(firstName)) return 'F';
  if (MASCULINOS_EM_A.has(firstName)) return 'M';
  if (AMBIGUOS.has(firstName)) return null;

  // Rule-based detection by ending
  const lastChar = firstName.slice(-1);
  const last2 = firstName.slice(-2);
  const last3 = firstName.slice(-3);

  // Strong feminine indicators
  if (lastChar === 'A') return 'F'; // Maria, Ana, Paula, Fernanda
  if (last2 === 'CE' || last2 === 'NE' || last2 === 'LE') return 'F'; // Beatrice, Elaine, Michele
  if (last3 === 'ETH' || last3 === 'ITH') return 'F'; // Elizabeth, Judith

  // Strong masculine indicators
  if (lastChar === 'O') return 'M'; // João, Pedro, Paulo
  if (last2 === 'ON' || last2 === 'OS' || last2 === 'OR') return 'M'; // Anderson, Carlos, Heitor
  if (last2 === 'EL' || last2 === 'AL' || last2 === 'IL') return 'M'; // Rafael, Cristal, Murilo excl.
  if (last2 === 'ER' || last2 === 'AR' || last2 === 'IR') return 'M'; // Walter, Edgar
  if (last2 === 'US' || last2 === 'ES') return 'M'; // Marcus, Moises
  if (lastChar === 'N' || lastChar === 'R' || lastChar === 'L' || lastChar === 'S') return 'M';

  // Default: unknown
  return null;
}

/**
 * Ajusta campos do formulário baseado no gênero detectado
 * @param {string} nome - Nome completo
 * @param {object} currentData - Dados atuais do contratante
 * @returns {object} - Updates a aplicar
 */
export function getGenderUpdates(nome, currentData) {
  const gender = detectGenderByName(nome);
  if (!gender) return {};

  const updates = {};

  // Auto-set sexo if not already set
  if (!currentData.sexo) {
    updates.sexo = gender;
  }

  // Adjust nacionalidade
  const nac = (currentData.nacionalidade || '').toLowerCase();
  if (gender === 'F') {
    if (nac === 'brasileiro(a)' || nac === 'brasileiro') updates.nacionalidade = 'brasileira';
  } else {
    if (nac === 'brasileiro(a)' || nac === 'brasileira') updates.nacionalidade = 'brasileiro';
  }

  // Adjust estado civil
  const ec = (currentData.estadoCivil || '').toLowerCase();
  if (gender === 'F') {
    if (ec === 'casado') updates.estadoCivil = 'Casada';
    if (ec === 'solteiro') updates.estadoCivil = 'Solteira';
    if (ec === 'divorciado') updates.estadoCivil = 'Divorciada';
    if (ec === 'viuvo' || ec === 'viúvo') updates.estadoCivil = 'Viúva';
  } else {
    if (ec === 'casada') updates.estadoCivil = 'Casado';
    if (ec === 'solteira') updates.estadoCivil = 'Solteiro';
    if (ec === 'divorciada') updates.estadoCivil = 'Divorciado';
    if (ec === 'viúva' || ec === 'viuva') updates.estadoCivil = 'Viúvo';
  }

  // Adjust profissão based on gender
  if (currentData.profissao) {
    updates.profissao = adjustProfissaoGender(currentData.profissao, gender);
  }

  return updates;
}

/**
 * Ajusta gênero da profissão
 * @param {string} profissao
 * @param {'M'|'F'} gender
 * @returns {string}
 */
export function adjustProfissaoGender(profissao, gender) {
  if (!profissao || !gender) return profissao;
  const p = profissao.trim();
  const pLower = p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Profissões que não mudam (neutras)
  const neutras = [
    'estudante', 'agente', 'gerente', 'assistente', 'analista', 'artista',
    'atleta', 'chefe', 'cliente', 'comerciante', 'dentista', 'economista',
    'eletricista', 'estagiario', 'farmaceutico', 'fisioterapeuta', 'jornalista',
    'motorista', 'pediatra', 'piloto', 'policial', 'recepcionista', 'taxista',
    'terapeuta', 'vigilante', 'do lar', 'aposentado', 'autonomo', 'militar',
  ];
  if (neutras.some(n => pLower === n || pLower === n.replace(/o$/, 'a'))) {
    // For aposentado/autonomo, still adjust
  }

  // Map of masculine → feminine
  const MASC_FEM = {
    'empresario': 'empresaria',
    'empresário': 'empresária',
    'advogado': 'advogada',
    'professor': 'professora',
    'engenheiro': 'engenheira',
    'medico': 'medica',
    'médico': 'médica',
    'enfermeiro': 'enfermeira',
    'contador': 'contadora',
    'administrador': 'administradora',
    'vendedor': 'vendedora',
    'cozinheiro': 'cozinheira',
    'psicologo': 'psicologa',
    'psicólogo': 'psicóloga',
    'secretario': 'secretaria',
    'secretário': 'secretária',
    'bancario': 'bancaria',
    'bancário': 'bancária',
    'operador': 'operadora',
    'cabeleireiro': 'cabeleireira',
    'corretor': 'corretora',
    'consultor': 'consultora',
    'coordenador': 'coordenadora',
    'supervisor': 'supervisora',
    'diretor': 'diretora',
    'promotor': 'promotora',
    'pedagogo': 'pedagoga',
    'arquiteto': 'arquiteta',
    'fotografo': 'fotografa',
    'fotógrafo': 'fotógrafa',
    'biologo': 'biologa',
    'biólogo': 'bióloga',
    'decorador': 'decoradora',
    'servidor publico': 'servidora publica',
    'servidor público': 'servidora pública',
    'funcionario publico': 'funcionaria publica',
    'funcionário público': 'funcionária pública',
    'auxiliar administrativo': 'auxiliar administrativa',
    'tecnico': 'tecnica',
    'técnico': 'técnica',
    'pedreiro': 'pedreira',
    'padeiro': 'padeira',
    'costureiro': 'costureira',
    'aposentado': 'aposentada',
    'autonomo': 'autonoma',
    'autônomo': 'autônoma',
    'produtor': 'produtora',
    'instrutor': 'instrutora',
    'inspetor': 'inspetora',
    'assessor': 'assessora',
    'pastor': 'pastora',
    'vereador': 'vereadora',
    'programador': 'programadora',
    'desenvolvedor': 'desenvolvedora',
    'desempregado': 'desempregada',
    'comerciario': 'comerciaria',
    'comerciário': 'comerciária',
    'mecanico': 'mecanica',
    'mecânico': 'mecânica',
    'eletricista': 'eletricista',
    'caminhoneiro': 'caminhoneira',
    'garcom': 'garconete',
    'garçom': 'garçonete',
    'porteiro': 'porteira',
    'zelador': 'zeladora',
    'lavrador': 'lavradora',
    'agricultor': 'agricultora',
    'pescador': 'pescadora',
    'marceneiro': 'marceneira',
    'pintor': 'pintora',
    'soldado': 'soldada',
    'bombeiro': 'bombeira',
    'policial militar': 'policial militar',
    'carteiro': 'carteira',
    'ator': 'atriz',
    'cantor': 'cantora',
    'escritor': 'escritora',
    'tradutor': 'tradutora',
  };

  // Build reverse map (feminine → masculine)
  const FEM_MASC = {};
  for (const [m, f] of Object.entries(MASC_FEM)) {
    FEM_MASC[f] = m;
  }

  if (gender === 'F') {
    // Check if current is masculine → convert to feminine
    const femVersion = MASC_FEM[pLower] || MASC_FEM[p.toLowerCase()];
    if (femVersion) {
      // Preserve original casing style
      if (p[0] === p[0].toUpperCase()) return femVersion.charAt(0).toUpperCase() + femVersion.slice(1);
      if (p === p.toUpperCase()) return femVersion.toUpperCase();
      return femVersion;
    }
    // Generic rule: ends in 'o' → change to 'a'
    if (p.endsWith('o') && p.length > 3) {
      const result = p.slice(0, -1) + 'a';
      // Verify it's not already feminine
      if (!FEM_MASC[result.toLowerCase()]) return result;
      return result;
    }
    if (p.endsWith('O') && p === p.toUpperCase() && p.length > 3) {
      return p.slice(0, -1) + 'A';
    }
    // 'or' → 'ora'
    if (pLower.endsWith('or') && p.length > 3) {
      if (p === p.toUpperCase()) return p + 'A';
      return p + 'a';
    }
  } else {
    // Check if current is feminine → convert to masculine
    const mascVersion = FEM_MASC[pLower] || FEM_MASC[p.toLowerCase()];
    if (mascVersion) {
      if (p[0] === p[0].toUpperCase()) return mascVersion.charAt(0).toUpperCase() + mascVersion.slice(1);
      if (p === p.toUpperCase()) return mascVersion.toUpperCase();
      return mascVersion;
    }
    // Generic rule: ends in 'a' → change to 'o'
    if (p.endsWith('a') && p.length > 3 && !neutras.some(n => pLower === n)) {
      const result = p.slice(0, -1) + 'o';
      if (!MASC_FEM[result.toLowerCase()]) return result; // avoid double conversion
      return result;
    }
    if (p.endsWith('A') && p === p.toUpperCase() && p.length > 3 && !neutras.some(n => pLower === n)) {
      return p.slice(0, -1) + 'O';
    }
    // 'ora' → 'or'
    if (pLower.endsWith('ora') && p.length > 4) {
      if (p === p.toUpperCase()) return p.slice(0, -1);
      return p.slice(0, -1);
    }
  }

  return p;
}
