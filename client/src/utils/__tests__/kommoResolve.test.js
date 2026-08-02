import { describe, it, expect } from 'vitest';
import {
  extrairLeadId, matchResort, resolveResortTag, normalizeSexo, normalizeEstadoCivil, montarPreenchimento, montarRegistroSemKommo,
} from '../kommoResolve';

describe('resolveResortTag (tag suja do Kommo -> resort canonico)', () => {
  it('exato', () => {
    expect(resolveResortTag('Ondas Praia')).toBe('Ondas Praia');
    expect(resolveResortTag('HOT BEACH')).toBe('Hot Beach');
  });
  it('sufixo apos separador', () => {
    expect(resolveResortTag('Acordos Particular-Ondas Praia')).toBe('Ondas Praia');
    expect(resolveResortTag('ALTA VISTA THERMAS-Quitado')).toBe('Alta Vista'); // resort contido
  });
  it('primeira palavra unica de um resort (tag curta)', () => {
    expect(resolveResortTag('ATRIUM')).toBe('Atrium Thermas');
    expect(resolveResortTag('Aquan Prime Resort')).toBe('Aquan Prime'); // resort contido
  });
  it('pega o resort MAIS especifico quando ha prefixo comum', () => {
    expect(resolveResortTag('Hot Beach You - Quitado')).toBe('Hot Beach You');
  });
  it('resort contido como palavra inteira ("Village Itapirica" tem o resort "Itapirica")', () => {
    expect(resolveResortTag('Village Itapirica')).toBe('Itapirica');
  });
  it('1a palavra unica resolve (ONDAS so comeca "Ondas Praia")', () => {
    expect(resolveResortTag('ONDAS')).toBe('Ondas Praia');
  });
  it('ambiguo por 1a palavra (varios resorts comecam igual) -> nao adivinha', () => {
    expect(resolveResortTag('SOLAR')).toBe('');   // Solar das Águas E Solar Pedra das Ilhas
    expect(resolveResortTag('HOT')).toBe('');     // Hot Beach, Hot Beach You, Hot Springs
  });
  it('sem match -> vazio', () => {
    expect(resolveResortTag('Zzz Qwerty Foobar')).toBe('');
    expect(resolveResortTag('')).toBe('');
  });
});

describe('montarRegistroSemKommo', () => {
  it('estrutura quem/quando/motivo (email minusculo, motivo aparado)', () => {
    const r = montarRegistroSemKommo('Paulo@Advocaciacbc.com', '  Cliente anterior ao Kommo  ', '2026-07-23T17:30:00Z');
    expect(r).toEqual({ user: 'paulo@advocaciacbc.com', ts: '2026-07-23T17:30:00Z', motivo: 'Cliente anterior ao Kommo' });
  });
  it('tolera vazios', () => {
    expect(montarRegistroSemKommo(null, null, null)).toEqual({ user: '', ts: null, motivo: '' });
  });
});

describe('extrairLeadId', () => {
  it('extrai o id do link de detalhe', () => {
    expect(extrairLeadId('https://advocaciacbc.kommo.com/leads/detail/21501586')).toBe('21501586');
    expect(extrairLeadId('https://advocaciacbc.kommo.com/leads/detail/123?x=1')).toBe('123');
  });
  it('retorna null p/ link invalido', () => {
    expect(extrairLeadId('nao eh link')).toBe(null);
    expect(extrairLeadId('')).toBe(null);
    expect(extrairLeadId(null)).toBe(null);
  });
});

describe('normalizeSexo', () => {
  it('mapeia p/ M/F', () => {
    expect(normalizeSexo('M')).toBe('M');
    expect(normalizeSexo('f')).toBe('F');
    expect(normalizeSexo('Masculino')).toBe('M');
    expect(normalizeSexo('feminino')).toBe('F');
    expect(normalizeSexo('')).toBe('');
    expect(normalizeSexo(null)).toBe('');
  });
});

describe('normalizeEstadoCivil (bagunca do Cadastro -> 5 opcoes)', () => {
  it('mapeia variantes', () => {
    expect(normalizeEstadoCivil('CASADO(A)')).toBe('Casado(a)');
    expect(normalizeEstadoCivil('casado')).toBe('Casado(a)');
    expect(normalizeEstadoCivil('CASADO (A)')).toBe('Casado(a)');
    expect(normalizeEstadoCivil('Casado(a) Reg. Comunhão Bens: PARCIAL')).toBe('Casado(a)');
    expect(normalizeEstadoCivil('solteira')).toBe('Solteiro(a)');
    expect(normalizeEstadoCivil('SOLTEIRO(A)')).toBe('Solteiro(a)');
    expect(normalizeEstadoCivil('DIVORCIADO')).toBe('Divorciado(a)');
    expect(normalizeEstadoCivil('VIÚVO(A)')).toBe('Viúvo(a)');
    expect(normalizeEstadoCivil('viúva')).toBe('Viúvo(a)');
    expect(normalizeEstadoCivil('UNIÃO ESTÁVEL')).toBe('União Estável');
    expect(normalizeEstadoCivil('Amasiado(a)')).toBe('União Estável');
    expect(normalizeEstadoCivil('convivente em união estável')).toBe('União Estável');
  });
  it('vazio ou desconhecido -> vazio (usuario preenche)', () => {
    expect(normalizeEstadoCivil('')).toBe('');
    expect(normalizeEstadoCivil(null)).toBe('');
    expect(normalizeEstadoCivil('outros')).toBe('');
  });
});

describe('matchResort (tag/cadastro -> nome canonico da lista)', () => {
  it('casa por normalizacao (sem acento, caixa)', () => {
    expect(matchResort('ONDAS PRAIA')).toBe('Ondas Praia');
    expect(matchResort('SOLAR DAS AGUAS')).toBe('Solar das Águas');
    expect(matchResort('solar das águas')).toBe('Solar das Águas');
  });
  it('sem match -> vazio', () => {
    expect(matchResort('Resort Inexistente XYZ')).toBe('');
    expect(matchResort('')).toBe('');
  });
});

describe('montarPreenchimento', () => {
  it('lead novo: telefone(kommo) + resort da tag(confirmar) + 1a msg do lead; nunca nome/origem', () => {
    const r = montarPreenchimento({
      contato: { telefone: '(22) 99104-8383' },
      tags: ['Ondas Praia'],
      cliente: null,
      primeiraMsgConversas: null,
      leadCriadoEm: '2026-07-23T06:04:00Z',
    });
    expect(r.campos.telefone).toBe('(22) 99104-8383');
    expect(r.proveniencia.telefone).toBe('kommo');
    expect(r.campos.resort).toBe('Ondas Praia');
    expect(r.proveniencia.resort).toBe('tag');
    expect(r.resortConfirmar).toBe(true);
    expect(r.campos.dataPrimeiraMensagem).toBe('2026-07-23');
    expect(r.proveniencia.dataPrimeiraMensagem).toBe('kommo');
    expect(r.clienteConhecido).toBe(false);
    expect(r.campos.nome).toBeUndefined();
    expect(r.campos.origemCliente).toBeUndefined();
  });

  it('cliente conhecido (PF): puxa o MAXIMO do Cadastro (nome+cpf+qualificacao) + 1a msg do CBC Conversas; nunca origem', () => {
    const r = montarPreenchimento({
      contato: { telefone: '5519912345678' }, // Kommo (com 55)
      tags: [],
      cliente: {
        nome: 'Maria da Silva', cpf_cnpj: '12345678909', eh_pj: false,
        rg: '34.567.890-2', nascimento: '1966-03-14', profissao: 'Aposentado(a)',
        estado_civil: 'CASADO(A)', genero: 'F', nacionalidade: 'brasileira',
        cep: '13480000', logradouro: 'Rua das Palmeiras', numero: '210', bairro: 'Centro',
        cidade: 'Limeira', uf: 'SP', complemento: 'Apto 32', email: 'maria@x.com',
        empreendimentos: 'SOLAR DAS AGUAS', telefone: '19997099607', // Cadastro (canonico)
      },
      primeiraMsgConversas: '2026-07-18T13:00:00Z',
      leadCriadoEm: '2026-07-21T13:24:00Z',
    });
    expect(r.clienteConhecido).toBe(true);
    expect(r.campos.tipo).toBe('pf');
    expect(r.campos.nome).toBe('Maria da Silva');       // nome verificado do Cadastro
    expect(r.campos.cpf).toBe('123.456.789-09');         // CPF mascarado
    expect(r.campos.estadoCivil).toBe('Casado(a)');
    expect(r.campos.sexo).toBe('F');
    expect(r.campos.dataNascimento).toBe('1966-03-14');
    expect(r.campos.cep).toBe('13480-000');              // CEP mascarado
    expect(r.campos.cidade).toBe('Limeira');
    expect(r.campos.telefone).toBe('(19) 99709-9607');   // do Cadastro (canonico), nao do Kommo
    expect(r.proveniencia.telefone).toBe('cadastro');
    expect(r.campos.resort).toBe('Solar das Águas');
    expect(r.proveniencia.resort).toBe('cadastro');
    expect(r.campos.dataPrimeiraMensagem).toBe('2026-07-18');
    expect(r.proveniencia.dataPrimeiraMensagem).toBe('conversas');
    expect(r.campos.origemCliente).toBeUndefined();
  });

  it('caso REAL GUSTAVO (lead 5816760): Kommo manda "55DD+8dig" SEM o 9 -> telefone canonico vem do Cadastro', () => {
    const r = montarPreenchimento({
      contato: { telefone: '553192050577' }, // Kommo sem o 9 do celular
      tags: [],
      cliente: { nome: 'GUSTAVO SILVA GUIMARAES', cpf_cnpj: '02871309671', telefone: '31992050577' },
    });
    expect(r.campos.nome).toBe('GUSTAVO SILVA GUIMARAES');
    expect(r.campos.cpf).toBe('028.713.096-71');
    expect(r.campos.telefone).toBe('(31) 99205-0577'); // completo, do Cadastro (nao o (53)... torto do Kommo)
    expect(r.proveniencia.telefone).toBe('cadastro');
  });

  it('fmtTelefone dropa o 55 sem estragar DDD 55 nacional', () => {
    // lead novo (sem cadastro): so o telefone do Kommo, mas com 55 removido corretamente
    const a = montarPreenchimento({ contato: { telefone: '5511987654321' }, tags: [], cliente: null });
    expect(a.campos.telefone).toBe('(11) 98765-4321'); // 13 digitos: dropa 55
    const b = montarPreenchimento({ contato: { telefone: '55987654321' }, tags: [], cliente: null });
    expect(b.campos.telefone).toBe('(55) 98765-4321'); // 11 digitos: DDD 55 nacional, NAO dropa
  });

  it('cliente conhecido (PJ): liga modo empresa (tipo pj + razao social + cnpj + endereco da empresa)', () => {
    const r = montarPreenchimento({
      contato: { telefone: '(11) 98888-7777' },
      tags: [],
      cliente: {
        nome: 'ACME EMPREENDIMENTOS LTDA', cpf_cnpj: '12345678000199', eh_pj: true,
        email: 'contato@acme.com', cep: '01310100', logradouro: 'Av Paulista',
        numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP',
        empreendimentos: 'HOT BEACH',
      },
    });
    expect(r.campos.tipo).toBe('pj');
    expect(r.campos.razaoSocial).toBe('ACME EMPREENDIMENTOS LTDA');
    expect(r.campos.cnpj).toBe('12.345.678/0001-99');
    expect(r.campos.emailEmpresa).toBe('contato@acme.com');
    expect(r.campos.cepEmpresa).toBe('01310-100');
    expect(r.campos.enderecoEmpresa).toBe('Av Paulista');
    expect(r.campos.cidadeEmpresa).toBe('São Paulo');
    expect(r.campos.resort).toBe('Hot Beach');
    expect(r.campos.nome).toBeUndefined();   // nao poe razao social no nome do representante
    expect(r.campos.cpf).toBeUndefined();
  });

  it('detecta PJ pelo tamanho do documento (14 digitos) mesmo sem eh_pj', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [], cliente: { nome: 'X LTDA', cpf_cnpj: '11222333000181' },
    });
    expect(r.campos.tipo).toBe('pj');
    expect(r.campos.cnpj).toBe('11.222.333/0001-81');
  });

  it('telefone: usa o do Cadastro quando o Kommo nao trouxe', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'João', cpf_cnpj: '12345678909', telefone: '5519997099607' },
    });
    expect(r.campos.telefone).toBe('(19) 99709-9607'); // fallback do cadastro
    expect(r.proveniencia.telefone).toBe('cadastro');
  });

  it('caso REAL do teste do Paulo (lead 12820604, Hot Beach, sem cadastro)', () => {
    // dados exatos vindos do Kommo + RPC resolve_kommo_dados (verificados em prod)
    const r = montarPreenchimento({
      contato: { telefone: '5515997312888', email: '' },
      tags: ['HOT BEACH', 'LIMBO'],
      cliente: null,
      primeiraMsgConversas: '2024-07-22T08:54:43.275+00:00',
      leadCriadoEm: '2024-07-22T08:54:00.000Z',
    });
    expect(r.campos.telefone).toBe('(15) 99731-2888'); // formatado, sem o 55
    expect(r.proveniencia.telefone).toBe('kommo');
    expect(r.campos.resort).toBe('Hot Beach');
    expect(r.proveniencia.resort).toBe('tag');
    expect(r.resortConfirmar).toBe(true);
    expect(r.campos.dataPrimeiraMensagem).toBe('2024-07-22');
    expect(r.proveniencia.dataPrimeiraMensagem).toBe('conversas');
    expect(r.clienteConhecido).toBe(false);
    expect(r.campos.nome).toBeUndefined();
    expect(r.campos.origemCliente).toBeUndefined();
  });

  it('telefone 55DDDnumero vira (DD) numero', () => {
    const r = montarPreenchimento({ contato: { telefone: '5515997312888' }, tags: [], cliente: null });
    expect(r.campos.telefone).toBe('(15) 99731-2888');
  });

  it('resort SOBRESCREVE o que ja estava e marca resortAlterado', () => {
    const r = montarPreenchimento(
      { contato: {}, tags: ['Hot Beach'], cliente: null },
      { resort: 'Solar das Águas' }, // ja tinha outro resort no form
    );
    expect(r.campos.resort).toBe('Hot Beach');      // sobrescreveu
    expect(r.proveniencia.resort).toBe('tag');
    expect(r.resortConfirmar).toBe(true);
    expect(r.resortAlterado).toBe(true);            // avisa que trocou
  });

  it('vincular SOBRESCREVE a 1a msg de um vinculo anterior (lead diferente)', () => {
    const r = montarPreenchimento(
      { contato: {}, tags: [], cliente: null, leadCriadoEm: '2026-01-01T12:00:00Z' },
      { dataPrimeiraMensagem: '2020-05-05' }, // valor de um lead vinculado antes
    );
    expect(r.campos.dataPrimeiraMensagem).toBe('2026-01-01');
  });

  it('1a msg noturna usa o DIA LOCAL, nao o dia UTC (fix 31/07/2026)', () => {
    // 22h30 local: a oeste de Greenwich o dia UTC ja e o seguinte — o form
    // deve ficar com o dia em que o cliente de fato mandou a mensagem.
    const noturno = new Date(2026, 0, 1, 22, 30).toISOString();
    const r = montarPreenchimento({ contato: {}, tags: [], cliente: null, leadCriadoEm: noturno });
    expect(r.campos.dataPrimeiraMensagem).toBe('2026-01-01');
  });

  it('telefone SEMPRE reformata, mesmo se ja tinha valor cru (re-vincular)', () => {
    const r = montarPreenchimento(
      { contato: { telefone: '5515997312888' }, tags: [], cliente: null },
      { telefone: '5515997312888' }, // valor cru de um vincular anterior
    );
    expect(r.campos.telefone).toBe('(15) 99731-2888');
  });

  // ── item 4: cadastro com varios resorts ──
  it('cliente com VARIOS resorts no cadastro: nao adivinha, oferece opcoes', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'Gustavo', cpf_cnpj: '02871309671', empreendimentos: 'ONDAS PRAIA, SOLAR DAS AGUAS' },
    });
    expect(r.campos.resort).toBeUndefined();          // nao preenche (ambiguo)
    expect(r.resortOpcoes).toEqual(['Ondas Praia', 'Solar das Águas']);
  });

  it('cliente com 1 resort no cadastro: preenche e nao oferece opcoes', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'Maria', cpf_cnpj: '12345678909', empreendimentos: 'SOLAR DAS AGUAS' },
    });
    expect(r.campos.resort).toBe('Solar das Águas');
    expect(r.resortOpcoes).toBe(null);
  });

  it('varios resorts no cadastro mas a TAG do lead resolve: usa a tag (e ainda avisa o historico)', () => {
    const r = montarPreenchimento({
      contato: {}, tags: ['Ondas Praia'],
      cliente: { nome: 'Gustavo', cpf_cnpj: '02871309671', empreendimentos: 'ONDAS PRAIA, SOLAR DAS AGUAS' },
    });
    expect(r.campos.resort).toBe('Ondas Praia');
    expect(r.proveniencia.resort).toBe('tag');
    expect(r.resortOpcoes).toEqual(['Ondas Praia', 'Solar das Águas']);
  });

  // ── item 8: sexo deduzido do nome ──
  it('sexo deduzido do nome quando o cadastro nao tem genero', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'MARIANA SOUZA', cpf_cnpj: '12345678909', genero: null },
    });
    expect(r.campos.sexo).toBe('F');
    expect(r.proveniencia.sexo).toBe('auto');
  });

  it('sexo do cadastro tem prioridade sobre a deducao do nome', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'MARIA', cpf_cnpj: '12345678909', genero: 'M' },
    });
    expect(r.campos.sexo).toBe('M');
    expect(r.proveniencia.sexo).toBe('cadastro');
  });

  // ── item 1: alerta de genero do cadastro divergente do nome ──
  it('genero do cadastro diverge do nome: usa o cadastro mas SINALIZA conflito (caso real JOAO=F)', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'JOAO BATISTA DOS SANTOS', cpf_cnpj: '79329012868', genero: 'F' },
    });
    expect(r.campos.sexo).toBe('F');            // cadastro ainda manda (editavel)
    expect(r.proveniencia.sexo).toBe('cadastro');
    expect(r.sexoConflito).toEqual({ cadastro: 'F', nome: 'M' }); // alerta
  });

  it('genero do cadastro bate com o nome: sem conflito', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'MARIANA SOUZA', cpf_cnpj: '12345678909', genero: 'F' },
    });
    expect(r.campos.sexo).toBe('F');
    expect(r.sexoConflito).toBe(null);
  });

  it('cadastro sem genero: deduz do nome e NAO marca conflito', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [],
      cliente: { nome: 'JOAO BATISTA', cpf_cnpj: '79329012868', genero: null },
    });
    expect(r.campos.sexo).toBe('M');
    expect(r.proveniencia.sexo).toBe('auto');
    expect(r.sexoConflito).toBe(null);
  });

  // ── item 2: resolvedor de tag suja dentro do fluxo ──
  it('resort da TAG suja (com sufixo) resolve no vinculo', () => {
    const r = montarPreenchimento({ contato: {}, tags: ['Acordos Particular-Ondas Praia'], cliente: null });
    expect(r.campos.resort).toBe('Ondas Praia');
    expect(r.proveniencia.resort).toBe('tag');
  });

  // ── item 3: varias tags de resort distintas -> escolher ──
  it('duas tags de resort distintas: nao adivinha, oferece opcoes', () => {
    const r = montarPreenchimento({ contato: {}, tags: ['Hot Beach', 'ATRIUM'], cliente: null });
    expect(r.campos.resort).toBeUndefined();
    expect(r.resortOpcoes).toEqual(['Hot Beach', 'Atrium Thermas']);
  });

  it('duas tags que apontam o MESMO resort: preenche normal', () => {
    const r = montarPreenchimento({ contato: {}, tags: ['Ondas Praia', 'Acordos-Ondas Praia'], cliente: null });
    expect(r.campos.resort).toBe('Ondas Praia');
  });

  // ── item 8d: completa o 9 do celular ──
  it('telefone de 10 digitos (sem o 9) e completado', () => {
    const r = montarPreenchimento({ contato: { telefone: '554899071790' }, tags: [], cliente: null });
    expect(r.campos.telefone).toBe('(48) 99907-1790'); // DDD + 9 + 8 digitos
  });

  // ── item 1: match por telefone com nomes divergentes ──
  it('match por TELEFONE com nome divergente -> matchDuvidoso', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [], nomeLead: 'PEDRO OLIVEIRA', matchPor: 'telefone',
      cliente: { nome: 'MARIA DA SILVA', cpf_cnpj: '12345678909' },
    });
    expect(r.matchDuvidoso).toEqual({ cadastro: 'MARIA DA SILVA', lead: 'PEDRO OLIVEIRA' });
  });

  it('match por telefone com apelido do mesmo cliente -> NAO alarma (caso real JB)', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [], nomeLead: 'jb batistasantos668', matchPor: 'telefone',
      cliente: { nome: 'JOAO BATISTA DOS SANTOS', cpf_cnpj: '79329012868' },
    });
    expect(r.matchDuvidoso).toBe(null); // "batistasantos668" contem BATISTA/SANTOS
  });

  it('match pelo LEAD (nao telefone): nunca alarma, mesmo com nome diferente', () => {
    const r = montarPreenchimento({
      contato: {}, tags: [], nomeLead: 'QUALQUER COISA', matchPor: 'lead',
      cliente: { nome: 'MARIA DA SILVA', cpf_cnpj: '12345678909' },
    });
    expect(r.matchDuvidoso).toBe(null);
  });
});
