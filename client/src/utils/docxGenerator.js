// Imports dinâmicos de 'docx' (lazy) movidos para dentro das funções async (#112)
import { CLAUSULAS_PADRAO } from '../data/clausulas';
import { formatCurrency, valorExtenso } from './extenso';

// Download de Blob sem dependência de file-saver (#111)
function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay a revocao para que download inicie em navegadores mais lentos
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FONT = 'Times New Roman';
const SIZE = 24; // 12pt in half-points
const LINE_SPACING = 360; // 1.5 line spacing (240 = single)

// Cache de modulo 'docx' (carregado sob demanda) (#112)
let _docxModule = null;
async function loadDocx() {
  if (!_docxModule) {
    _docxModule = await import('docx');
  }
  return _docxModule;
}

function makeHelpers(docx) {
  const { TextRun, Paragraph, AlignmentType } = docx;

  function textRun(text, opts = {}) {
    return new TextRun({
      text,
      font: FONT,
      size: SIZE,
      bold: opts.bold || false,
      italics: opts.italics || false,
      allCaps: opts.allCaps || false,
      underline: opts.underline ? {} : undefined,
      ...opts,
    });
  }

  function paragraph(runs, opts = {}) {
    return new Paragraph({
      children: Array.isArray(runs) ? runs : [runs],
      alignment: opts.alignment || AlignmentType.JUSTIFIED,
      spacing: { line: LINE_SPACING, after: opts.after ?? 200 },
      indent: opts.indent ? { firstLine: 720 } : undefined,
      ...opts,
    });
  }

  function titleParagraph(text, underline = false) {
    return new Paragraph({
      children: [textRun(text, { bold: true, underline })],
      alignment: AlignmentType.CENTER,
      spacing: { line: LINE_SPACING, after: 300 },
    });
  }

  function emptyLine() {
    return new Paragraph({ children: [textRun('')], spacing: { line: LINE_SPACING, after: 100 } });
  }

  function signatureLine(name, role) {
    return [
      emptyLine(),
      new Paragraph({
        children: [textRun('___________________________________________')],
        alignment: AlignmentType.CENTER,
        spacing: { line: LINE_SPACING, after: 0 },
      }),
      new Paragraph({
        children: [textRun(name, { bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { line: LINE_SPACING, after: 0 },
      }),
      new Paragraph({
        children: [textRun(role)],
        alignment: AlignmentType.CENTER,
        spacing: { line: LINE_SPACING, after: 200 },
      }),
    ];
  }

  return { textRun, paragraph, titleParagraph, emptyLine, signatureLine };
}

// (PJ 25/06) helpers de Cliente Empresa — espelham contractHtml.js em texto puro (sem markup)
function isPJ(c) {
  return c && c.tipo === 'pj';
}

function nomeAssinaturaDocx(c) {
  if (isPJ(c)) return (c.razaoSocial || '[EMPRESA]').toUpperCase();
  return c?.nome ? c.nome.toUpperCase() : '';
}

// Qualificacao da pessoa (PF = contratante; PJ = representante) SEM o nome no inicio.
function pessoaQualifDocx(c) {
  const parts = [
    c.nacionalidade || 'brasileiro(a)',
    c.estadoCivil || '',
    c.profissao || '',
    c.rg ? `RG: ${c.rg}` : '',
    c.cpf ? `CPF: ${c.cpf}` : '',
    c.email ? `e-mail: ${c.email}` : '',
  ].filter(Boolean);

  let endereco = '';
  if (c.endereco) {
    endereco = `residente e domiciliado na ${c.endereco}`;
    if (c.numero) endereco += `, n ${c.numero}`;
    if (c.complemento) endereco += `, ${c.complemento}`;
    if (c.bairro) endereco += `, no bairro ${c.bairro}`;
    if (c.cidade) endereco += `, na cidade ${c.cidade}`;
    if (c.uf) endereco += `/${c.uf}`;
    if (c.cep) endereco += `, CEP: ${c.cep}`;
  }

  return parts.join(', ') + (endereco ? `, ${endereco}` : '');
}

function empresaSedeDocx(c) {
  let s = `${c.enderecoEmpresa || '___'}`;
  if (c.numeroEmpresa) s += `, n ${c.numeroEmpresa}`;
  if (c.complementoEmpresa) s += `, ${c.complementoEmpresa}`;
  if (c.bairroEmpresa) s += `, no bairro ${c.bairroEmpresa}`;
  if (c.cidadeEmpresa) s += `, na cidade ${c.cidadeEmpresa}`;
  if (c.ufEmpresa) s += `/${c.ufEmpresa}`;
  if (c.cepEmpresa) s += `, CEP: ${c.cepEmpresa}`;
  return s;
}

// Runs com negrito (razao social/representante ou nome PF em bold; resto normal) p/ DOCX.
function qualificacaoRuns(c, textRun, placeholder = '[CONTRATANTE]') {
  if (isPJ(c)) {
    return [
      textRun((c.razaoSocial || '[EMPRESA]').toUpperCase(), { bold: true }),
      textRun(`, pessoa juridica de direito privado, inscrita no CNPJ sob o n ${c.cnpj || '___'}, com sede na ${empresaSedeDocx(c)}, neste ato representada por `),
      textRun((c.nome || '[REPRESENTANTE]').toUpperCase(), { bold: true }),
      textRun(`, ${pessoaQualifDocx(c)}`),
    ];
  }
  return [
    textRun(c.nome ? c.nome.toUpperCase() : placeholder, { bold: true }),
    textRun(`, ${pessoaQualifDocx(c)}`),
  ];
}

function gerarTextoHonorarios(h) {
  const aVista = Number(h.parcelas) === 1;
  // (#32) sem data definida -> placeholder visivel "___" em vez de inventar dia 20 / data vazia.
  const dataPrimeira = h.dataPrimeiraParcela
    ? new Date(h.dataPrimeiraParcela + 'T12:00:00').toLocaleDateString('pt-BR')
    : '___';
  const diaParcela = h.dataPrimeiraParcela
    ? new Date(h.dataPrimeiraParcela + 'T12:00:00').getDate()
    : '___';

  // (#4) à vista (1 parcela) NAO usa a redacao de parcelamento ("e as demais, todo dia X...").
  const pagamento = aVista
    ? `pagos à vista, com vencimento em ${dataPrimeira}`
    : `pagos em ${h.parcelas} parcelas iguais e sucessivas de ${formatCurrency(h.valorParcela)} (${valorExtenso(h.valorParcela)}) cada uma, com vencimento da primeira em ${dataPrimeira} e as demais, todo dia ${diaParcela} dos meses subsequentes`;

  if (h.somenteExito) {
    return `Fica ajustado que o contratante, em remuneração aos serviços contratados, pagará ao contratado honorários de êxito de ${h.percentualExito}% sobre o proveito econômico da ação.`;
  }
  if (h.somenteIniciais) {
    return `Fica ajustado que o contratante, em remuneração aos serviços contratados, pagará ao contratado o valor de ${formatCurrency(h.total)} (${valorExtenso(h.total)}), a serem ${pagamento}.`;
  }
  return `Fica ajustado que o contratante, em remuneração aos serviços contratados, pagará ao contratado, o(s) honorário(s) pactuados da seguinte forma:\n\na) Parte Fixa: ${formatCurrency(h.total)} (${valorExtenso(h.total)}), a serem ${pagamento};\n\nb) Em caso de êxito na demanda, será devido ${h.percentualExito}% de honorários sobre o proveito econômico da ação.`;
}

// Texto da acao a partir do tipoAcao (espelha getTipoAcaoProcuracao do contractHtml.js):
// cobranca e dano moral mantem o nome; o resto vira "rescisao contratual".
function getAcaoTextoDocx(data, resortUpper) {
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
  const nonRescisao = ['ação de cobrança', 'dano moral'];
  const isNonRescisao = tipoAcao && nonRescisao.some(t => tipoAcao.toLowerCase().includes(t.toLowerCase()));
  if (isNonRescisao) return `${tipoAcao.toUpperCase()} REFERENTE AO ${resortUpper}`;
  return `AÇÃO DE RESCISÃO CONTRATUAL EM FACE DE ${resortUpper}`;
}

function getResortName(data) {
  if (data.resort === 'outro') return (data.resortCustom || 'RESORT').toUpperCase();
  return (data.resort || 'RESORT').toUpperCase();
}

export async function generateContractDocx(data) {
  const docx = await loadDocx();
  const { Document, Packer, Paragraph, PageBreak, AlignmentType } = docx;
  const { textRun, paragraph, titleParagraph, emptyLine, signatureLine } = makeHelpers(docx);

  const resort = getResortName(data);
  const h = data.honorarios || {};
  const num = data.numContratantes || 1;
  const c1 = data.contratantes?.[0] || {};
  const c2 = data.contratantes?.[1] || {};

  const children = [];

  // Title
  children.push(titleParagraph('CONTRATO DE PRESTACAO DE SERVICOS E HONORARIOS ADVOCATICIOS'));
  children.push(emptyLine());

  // Preambulo
  const preambulo = ['Pelo presente instrumento particular de prestação de serviços jurídicos, de um lado:'];
  children.push(paragraph([textRun(preambulo[0], { indent: true })]));

  // Contratante 1
  children.push(paragraph(qualificacaoRuns(c1, textRun, '[CONTRATANTE 1]'), { indent: true }));

  // Contratante 2
  if (num === 2 && (c2.nome || c2.razaoSocial)) {
    children.push(paragraph(qualificacaoRuns(c2, textRun, '[CONTRATANTE 2]'), { indent: true }));
  }

  children.push(paragraph([textRun('doravante como contratante, e de outro lado:')]));
  children.push(paragraph([
    textRun('CONFORTO, BERGONSI & CAVALARI SOCIEDADE DE ADVOGADOS', { bold: true }),
    textRun(', CNPJ 56.096.172/0001-65, OAB/SP 55.227, doravante como contratado; têm entre si, justos e avençados, o que adiante segue:'),
  ]));

  // (#2) titulo da acao derivado do tipoAcao (antes era fixo em RESCISAO p/ qualquer acao).
  const acaoTexto = getAcaoTextoDocx(data, resort);
  children.push(paragraph([
    textRun(acaoTexto, { bold: true }),
  ], { alignment: AlignmentType.CENTER }));

  children.push(emptyLine());

  // Clausulas
  const avulsas = (data.clausulasAvulsas || []).map(a => ({ ...a, avulsa: true }));
  const allClausulas = [...CLAUSULAS_PADRAO, ...avulsas];
  const orderedIds = data.clausulasOrder || allClausulas.map(c => c.id);
  const clausulasFiltradas = orderedIds.map(id => allClausulas.find(c => c.id === id)).filter(Boolean);

  for (const cl of clausulasFiltradas) {
    // (#1) paridade com generateContractDocxBlob: pula clausula5 quando escritorio paga custas
    // e gera o texto das clausulas automaticas de Objeto/Escopo (antes saiam em branco -> "continue").
    if (data.escritorioArcaCustas && cl.id === 'clausula5') continue;
    const customText = data.clausulas?.[cl.id];
    let texto = customText || cl.texto;
    if (cl.auto) texto = gerarTextoHonorarios(h);
    if (cl.autoObjeto) texto = `O presente contrato tem por objeto a prestação de serviços advocatícios para propositura e acompanhamento de ação judicial em face de ${resort}.`;
    if (cl.autoEscopo) texto = 'INCLUÍDO: Todas as instâncias e tribunais, defesa em recursos da parte contrária, acompanhamento até o cumprimento da decisão. NÃO INCLUÍDO: Qualquer ação não relacionada à demanda principal.';
    if (!texto) continue;

    // Title of clause
    children.push(paragraph([textRun(cl.titulo, { bold: true })], { after: 100 }));

    // Text — split by newlines
    const lines = texto.split('\n').filter(Boolean);
    for (const line of lines) {
      children.push(paragraph([textRun(line)], { indent: true }));
    }
    children.push(emptyLine());
  }

  // Clausulas avulsas
  if (data.clausulasAvulsas?.length) {
    for (const av of data.clausulasAvulsas) {
      children.push(paragraph([textRun(av.titulo, { bold: true })], { after: 100 }));
      children.push(paragraph([textRun(av.texto)], { indent: true }));
      children.push(emptyLine());
    }
  }

  // Closing
  children.push(paragraph([
    textRun('E por estarem as partes acima contratadas firmam o presente contrato particular para que produza seus legais e regulares efeitos de direito.'),
  ], { indent: true }));
  children.push(emptyLine());
  children.push(paragraph([textRun(`Americana, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.`)], { alignment: AlignmentType.CENTER }));

  // Signatures
  children.push(...signatureLine(nomeAssinaturaDocx(c1) || '[CONTRATANTE 1]', 'Contratante'));
  if (num === 2 && (c2.nome || c2.razaoSocial)) {
    children.push(...signatureLine(nomeAssinaturaDocx(c2) || '[CONTRATANTE 2]', 'Contratante'));
  }
  children.push(...signatureLine('BRUNO CAVALARI GOMES CAMARGO\nOAB/SP 390.509', 'Advogado Contratado'));
  children.push(...signatureLine('PAULO ROBERTO CONFORTO\nOAB/SP 391.151', 'Advogado Contratado'));

  // Page break before procuracao
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // PROCURACAO
  children.push(titleParagraph('PROCURACAO "AD-JUDICIA"', true));
  children.push(emptyLine());

  // Outorgantes
  children.push(paragraph([textRun('OUTORGANTES: ', { bold: true }), ...qualificacaoRuns(c1, textRun, '[CONTRATANTE 1]')]));
  if (num === 2 && (c2.nome || c2.razaoSocial)) {
    children.push(paragraph(qualificacaoRuns(c2, textRun, '[CONTRATANTE 2]')));
  }

  children.push(paragraph([
    textRun('OUTORGADOS: ', { bold: true }),
    // (#15) inclui o escritorio como outorgado (paridade com generateProcuracaoDocxBlob).
    textRun('DR. BRUNO CAVALARI GOMES CAMARGO, advogado, devidamente inscrito na OAB/SP sob n 390.509; DR. PAULO ROBERTO CONFORTO, brasileiro, advogado, devidamente inscrito na OAB/SP sob n 391.151; e CONFORTO, BERGONSI & CAVALARI SOCIEDADE DE ADVOGADOS, CNPJ 56.096.172/0001-65, OAB/SP 55.227'),
  ]));

  children.push(emptyLine());

  // (#2) finalidade da procuracao tambem derivada do tipoAcao (nao mais fixa em RESCISAO).
  const procText = `Pelo presente instrumento de Procuração "Ad-Judicia", o(a) outorgante acima qualificado(a), nomeia e constitui seu bastante procurador, o advogado acima qualificado, com escritório à Rua das Guatemala, n 122, bairro Santo Antônio, na cidade de Americana/SP, onde recebe intimações em geral, a quem confere amplos poderes para o foro em geral, com a cláusula "AD JUDICIA", em qualquer Juízo, Instância ou Tribunal, inclusive representação extrajudicial, podendo propor contra quem de direito as ações competentes e defendê-lo nas contrárias, seguindo umas e outras, até final decisão, usando os recursos legais e acompanhando-os, conferindo-lhe, ainda, poderes para reconhecer a procedência do pedido, confessar, desistir da ação ou do direito sobre o qual se funda a ação, transigir, firmar compromissos ou acordos, receber e dar quitação, declarar situação de pobreza jurídica, agindo em conjunto ou separadamente, podendo ainda substabelecer está a outrem, com ou sem reservas de iguais poderes, especificamente para ajuizar ${acaoTexto}.`;

  children.push(paragraph([textRun(procText)], { indent: true }));
  children.push(emptyLine());
  children.push(paragraph([textRun(`Americana, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.`)], { alignment: AlignmentType.CENTER }));

  children.push(...signatureLine(nomeAssinaturaDocx(c1) || '[CONTRATANTE 1]', 'Outorgante'));
  if (num === 2 && (c2.nome || c2.razaoSocial)) {
    children.push(...signatureLine(nomeAssinaturaDocx(c2) || '[CONTRATANTE 2]', 'Outorgante'));
  }

  // Create document
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch = 1440 twips
          size: { width: 11906, height: 16838 }, // A4
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const clientName = (isPJ(c1) ? c1.razaoSocial : c1.nome) || 'contrato';
  const fileName = `Contrato_${clientName.replace(/\s+/g, '_')}_${resort.replace(/\s+/g, '_')}.docx`;
  saveBlob(blob, fileName);
  return fileName;
}

/**
 * Generate Contract DOCX as blob (for Drive upload — no download)
 */
export async function generateContractDocxBlob(data) {
  const docx = await loadDocx();
  const { Document, Packer, AlignmentType } = docx;
  const { textRun, paragraph, titleParagraph, emptyLine, signatureLine } = makeHelpers(docx);

  const resort = getResortName(data);
  const h = data.honorarios || {};
  const num = data.numContratantes || 1;
  const c1 = data.contratantes?.[0] || {};
  const c2 = data.contratantes?.[1] || {};

  const children = [];
  children.push(titleParagraph('CONTRATO DE PRESTACAO DE SERVICOS ADVOCATICIOS'));
  children.push(emptyLine());

  children.push(paragraph([textRun('Pelo presente instrumento particular de prestação de serviços jurídicos, de um lado:')]));
  children.push(paragraph(qualificacaoRuns(c1, textRun, '[CONTRATANTE 1]')));
  if (num === 2 && (c2.nome || c2.razaoSocial)) {
    children.push(paragraph(qualificacaoRuns(c2, textRun, '[CONTRATANTE 2]')));
  }
  children.push(paragraph([textRun('doravante como contratante, e de outro lado:')]));
  children.push(paragraph([
    textRun('CONFORTO, BERGONSI & CAVALARI SOCIEDADE DE ADVOGADOS', { bold: true }),
    textRun(`, CNPJ 56.096.172/0001-65, OAB/SP 55.227, doravante como contratado; têm entre si, justos e avençados, o que adiante segue: AÇÃO JUDICIAL EM FACE DE ${resort.toUpperCase()}.`),
  ]));
  children.push(emptyLine());

  // Clausulas
  const avulsas = (data.clausulasAvulsas || []).map(a => ({ ...a, avulsa: true }));
  const allClausulas = [...CLAUSULAS_PADRAO, ...avulsas];
  const orderedIds = data.clausulasOrder || allClausulas.map(c => c.id);
  const clausulasFiltradas = orderedIds.map(id => allClausulas.find(c => c.id === id)).filter(Boolean);

  for (const cl of clausulasFiltradas) {
    if (data.escritorioArcaCustas && cl.id === 'clausula5') continue;
    const customText = data.clausulas?.[cl.id];
    let texto = customText || cl.texto;
    if (cl.auto) texto = gerarTextoHonorarios(h);
    if (cl.autoObjeto) texto = `O presente contrato tem por objeto a prestação de serviços advocatícios para propositura e acompanhamento de ação judicial em face de ${resort}.`;
    if (cl.autoEscopo) texto = 'INCLUÍDO: Todas as instâncias e tribunais, defesa em recursos da parte contrária, acompanhamento até o cumprimento da decisão. NÃO INCLUÍDO: Qualquer ação não relacionada à demanda principal.';
    if (!texto) continue;
    children.push(paragraph([textRun(cl.titulo, { bold: true })], { after: 100 }));
    const lines = texto.split('\n').filter(Boolean);
    for (const line of lines) {
      children.push(paragraph([textRun(line)], { indent: true }));
    }
    children.push(emptyLine());
  }

  children.push(paragraph([textRun('E, por estarem de acordo com todas as disposições acima, as partes assinam o presente instrumento eletronicamente.')]));
  children.push(paragraph([textRun('Americana, data da assinatura digital.')], { alignment: AlignmentType.CENTER }));
  children.push(...signatureLine(nomeAssinaturaDocx(c1) || '[CONTRATANTE 1]', 'Cliente - Contratante'));
  if (num === 2 && (c2.nome || c2.razaoSocial)) {
    children.push(...signatureLine(nomeAssinaturaDocx(c2) || '[CONTRATANTE 2]', 'Cliente - Contratante'));
  }
  children.push(...signatureLine('CONFORTO, BERGONSI & CAVALARI\nSOCIEDADE DE ADVOGADOS', 'Contratado - OAB/SP 55.227'));

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, size: { width: 11906, height: 16838 } },
      },
      children,
    }],
  });

  return await Packer.toBlob(doc);
}

/**
 * Generate standalone Procuração DOCX as blob (for Drive upload)
 */
export async function generateProcuracaoDocxBlob(data) {
  const docx = await loadDocx();
  const { Document, Packer, AlignmentType } = docx;
  const { textRun, paragraph, titleParagraph, emptyLine, signatureLine } = makeHelpers(docx);

  const resort = getResortName(data);
  const num = data.numContratantes || 1;
  const c1 = data.contratantes?.[0] || {};
  const c2 = data.contratantes?.[1] || {};
  const children = [];

  // Header
  children.push(paragraph([textRun('CONFORTO, BERGONSI & CAVALARI', { bold: false, size: 18, color: '718096' })], { alignment: AlignmentType.CENTER, after: 40 }));
  children.push(paragraph([textRun('SOCIEDADE DE ADVOGADOS', { bold: false, size: 18, color: '718096' })], { alignment: AlignmentType.CENTER, after: 40 }));
  children.push(paragraph([textRun('OAB/SP 55.227', { bold: false, size: 16, color: '718096' })], { alignment: AlignmentType.CENTER, after: 300 }));

  children.push(titleParagraph('PROCURAÇÃO AD JUDICIA ET EXTRA', true));
  children.push(paragraph([textRun('Instrumento de outorga de poderes', { italics: true, size: 20, color: '666666' })], { alignment: AlignmentType.CENTER, after: 300 }));

  // Outorgantes
  children.push(paragraph([textRun('OUTORGANTE(S): ', { bold: true }), ...qualificacaoRuns(c1, textRun, '[CONTRATANTE 1]')]));
  if (num === 2 && (c2.nome || c2.razaoSocial)) {
    children.push(paragraph(qualificacaoRuns(c2, textRun, '[CONTRATANTE 2]')));
  }

  children.push(paragraph([
    textRun('OUTORGADOS: ', { bold: true }),
    textRun('DR. PAULO ROBERTO CONFORTO, advogado, OAB/SP nº 391.151; DR. BRUNO CAVALARI GOMES CAMARGO, advogado, OAB/SP nº 390.509; CONFORTO, BERGONSI & CAVALARI SOCIEDADE DE ADVOGADOS, CNPJ 56.096.172/0001-65, OAB/SP 55.227. Escritório: Rua Guatemala, 122, Jardim Santo Antônio, Americana/SP.'),
  ]));

  children.push(emptyLine());

  // Determine action text for procuração
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
  const nonRescisao = ['ação de cobrança', 'dano moral'];
  const isNonRescisao = tipoAcao && nonRescisao.some(t => tipoAcao.toLowerCase().includes(t.toLowerCase()));
  const acaoTexto = isNonRescisao
    ? `${tipoAcao.toUpperCase()} REFERENTE AO ${resort.toUpperCase()}`
    : `AÇÃO DE RESCISÃO CONTRATUAL EM FACE DE ${resort.toUpperCase()}`;

  const procText = `Pelo presente instrumento, o(s) OUTORGANTE(S) nomeia(m) e constitui(em) os advogados acima qualificados como bastantes procuradores, conferindo-lhes amplos poderes para o foro em geral, com a cláusula AD JUDICIA ET EXTRA, em qualquer Juízo, Instância ou Tribunal, inclusive para representação extrajudicial. Poderes especiais: reconhecer a procedência do pedido, confessar, desistir, transigir, firmar acordos, receber e dar quitação e declarar situação de pobreza para fins de gratuidade judiciária, atuando em conjunto ou separadamente. Poderão ainda substabelecer este mandato a outrem, com ou sem reserva de iguais poderes.`;

  children.push(paragraph([textRun(procText)], { indent: true }));
  children.push(emptyLine());
  children.push(paragraph([
    textRun('Procuração especialmente outorgada para: ', {}),
    textRun(acaoTexto, { bold: true }),
  ], { indent: true }));
  children.push(emptyLine());
  children.push(paragraph([textRun('Americana, data da assinatura digital.')], { alignment: AlignmentType.LEFT }));

  children.push(...signatureLine(nomeAssinaturaDocx(c1) || '[CONTRATANTE 1]', 'Outorgante'));
  if (num === 2 && (c2.nome || c2.razaoSocial)) {
    children.push(...signatureLine(nomeAssinaturaDocx(c2) || '[CONTRATANTE 2]', 'Outorgante'));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          size: { width: 11906, height: 16838 },
        },
      },
      children,
    }],
  });

  return await Packer.toBlob(doc);
}
