import { CLAUSULAS_PADRAO } from '../data/clausulas';
import { formatCurrency, valorExtenso } from './extenso';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR');
}

function qualificacao(c) {
  if (!c.nome) return '';
  const complemento = c.complemento ? `, ${c.complemento}` : '';
  return `<strong>${c.nome.toUpperCase()}</strong>, ${c.nacionalidade}, ${(c.estadoCivil || '').toLowerCase()}, ${(c.profissao || '').toLowerCase()}, RG: ${c.rg}, CPF: ${c.cpf}, e-mail: ${c.email}, residente e domiciliado na ${c.endereco}${complemento}, no bairro ${c.bairro}, na cidade ${c.cidade}/${c.uf}, CEP: ${c.cep}`;
}

function gerarTextoHonorarios(h) {
  // Modo somente êxito — sem honorários fixos
  if (h.somenteExito) {
    return `Fica ajustado que o contratante, em remuneração aos serviços contratados, pagará ao contratado honorários exclusivamente na modalidade de êxito (<em>ad exitum</em>), da seguinte forma:<br/><br/>Em caso de êxito na demanda, será devido ${h.percentualExito || '___'}% de honorários sobre o proveito econômico da ação.<br/><br/>Não havendo êxito, nenhum valor será devido a título de honorários.`;
  }

  const diaParcela = h.dataPrimeiraParcela
    ? new Date(h.dataPrimeiraParcela + 'T12:00:00').getDate()
    : '___';
  const dataPrimeira = formatDate(h.dataPrimeiraParcela) || '___/___/______';
  const total = h.total || 0;
  const parcelas = h.parcelas || 0;
  const vp = h.valorParcela || 0;

  const parteFixa = parcelas === 1
    ? `a) Parte Fixa: ${total > 0 ? formatCurrency(total) : 'R$ ___'} (${total > 0 ? valorExtenso(total) : '___'}), a serem pagos à vista, com vencimento em ${dataPrimeira};`
    : `a) Parte Fixa: ${total > 0 ? formatCurrency(total) : 'R$ ___'} (${total > 0 ? valorExtenso(total) : '___'}), a serem pagos em ${parcelas || '___'} parcelas iguais e sucessivas de ${vp > 0 ? formatCurrency(vp) : 'R$ ___'} (${vp > 0 ? valorExtenso(vp) : '___'}) cada uma, com vencimento da primeira em ${dataPrimeira} e as demais, todo dia ${diaParcela} dos meses subsequentes;`;

  // Modo somente iniciais — sem honorários de êxito
  if (h.somenteIniciais) {
    return `Fica ajustado que o contratante, em remuneração aos serviços contratados, pagará ao contratado, o(s) honorário(s) pactuados da seguinte forma:<br/><br/>${parteFixa}`;
  }

  return `Fica ajustado que o contratante, em remuneração aos serviços contratados, pagará ao contratado, o(s) honorário(s) pactuados da seguinte forma:<br/><br/>${parteFixa}<br/><br/>b) Em caso de êxito na demanda, será devido ${h.percentualExito || '___'}% de honorários sobre o proveito econômico da ação.`;
}

function getClausulaTexto(clausulas, id) {
  if (clausulas[id] !== undefined) return clausulas[id];
  const c = CLAUSULAS_PADRAO.find(cl => cl.id === id);
  return c ? c.texto : '';
}

function getTipoAcaoTexto(data) {
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  if (!tipoAcao && !resort) return 'AÇÃO DE RESCISÃO CONTRATUAL DE COTA DE MULTIPROPRIEDADE REFERENTE AO ___________';
  const resortUpper = (resort || '___________').toUpperCase();
  const acaoUpper = (tipoAcao || 'RESCISÃO CONTRATUAL DE COTA DE MULTIPROPRIEDADE').toUpperCase();
  return `${acaoUpper} REFERENTE AO ${resortUpper}`;
}

export function generateContractHTML(data, forPdf = false) {
  const { contratantes, numContratantes, honorarios, clausulas } = data;
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const resortUpper = (resort || '___________').toUpperCase();
  const acaoTexto = getTipoAcaoTexto(data);

  const num = numContratantes || 1;
  const contratantesQualif = [];
  for (let i = 0; i < num; i++) {
    const c = contratantes[i];
    if (c && c.nome) {
      contratantesQualif.push(qualificacao(c));
    } else {
      contratantesQualif.push('<strong>[CONTRATANTE ' + (i + 1) + ']</strong>');
    }
  }
  const contratantesTexto = contratantesQualif.join(', ');

  // Filter clauses based on somenteExito mode
  const isSomenteExito = honorarios.somenteExito;
  // Clauses to skip when somente êxito (no fixed fees)
  const skipInSomenteExito = ['clausula2_p3', 'clausula2_p5', 'clausula2_p7'];
  // Clauses to skip when somente iniciais (no exit fees)
  const skipInSomenteIniciais = ['clausula2_p2']; // §2º Honorários de Êxito

  // Build ordered list of clauses (custom order if available, else default + avulsas)
  const avulsas = (data.clausulasAvulsas || []).map(a => ({ ...a, editavel: true, avulsa: true }));
  const allClausulas = [...CLAUSULAS_PADRAO, ...avulsas];
  const defaultOrder = allClausulas.map(c => c.id);
  const orderedIds = data.clausulasOrder || defaultOrder;
  const orderedClausulas = orderedIds
    .map(id => allClausulas.find(c => c.id === id))
    .filter(Boolean);

  let clausulasHtml = '';
  let clausulaNum = 0;
  for (const cl of orderedClausulas) {
    if (isSomenteExito && skipInSomenteExito.includes(cl.id)) continue;
    if (honorarios.somenteIniciais && skipInSomenteIniciais.includes(cl.id)) continue;

    let texto;
    if (cl.auto) {
      texto = gerarTextoHonorarios(honorarios);
    } else if (cl.avulsa) {
      texto = (clausulas[cl.id] || cl.texto || '').replace(/\n/g, '<br/>');
    } else {
      texto = getClausulaTexto(clausulas, cl.id).replace(/\n/g, '<br/>');
    }
    if (cl.paragrafo) {
      clausulasHtml += `<p style="text-indent: 40px;">${texto}</p>\n`;
    } else {
      clausulaNum++;
      const titulo = cl.avulsa ? `${clausulaNum}- ${cl.titulo}: ` : `${clausulaNum}- `;
      clausulasHtml += `<p><strong>${titulo}</strong>${texto}</p>\n`;
    }
  }

  const sigContratantes = [];
  for (let i = 0; i < num; i++) {
    const nome = contratantes[i]?.nome ? contratantes[i].nome.toUpperCase() : '[CONTRATANTE ' + (i + 1) + ']';
    sigContratantes.push(`
      <div style="text-align:center; min-width:200px;">
        <div style="border-top:1px solid #000; width:280px; margin:0 auto;"></div>
        <p style="margin-top:4px;"><strong>${nome}</strong><br/>Contratante</p>
      </div>
    `);
  }

  const sigAdvogados = `
    <div style="display:flex; justify-content:space-around; margin-top:60px; flex-wrap:wrap; gap:30px;">
      <div style="text-align:center;">
        <div style="border-top:1px solid #000; width:280px; margin:0 auto;"></div>
        <p style="margin-top:4px;"><strong>BRUNO CAVALARI GOMES CAMARGO</strong><br/>OAB/SP 390.509</p>
      </div>
      <div style="text-align:center;">
        <div style="border-top:1px solid #000; width:280px; margin:0 auto;"></div>
        <p style="margin-top:4px;"><strong>PAULO ROBERTO CONFORTO</strong><br/>OAB/SP 391.151</p>
      </div>
    </div>
  `;

  const pageStyle = `
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: 1.8;
    text-align: justify;
    color: #000;
    ${forPdf ? 'margin: 0; padding: 0;' : 'padding: 30px 35px;'}
  `;

  return `
    <div style="${pageStyle}">
      <h2 style="text-align:center; font-size:14pt; font-weight:bold; margin-bottom:30px;">
        CONTRATO DE PRESTAÇÃO DE SERVIÇOS E HONORÁRIOS ADVOCATÍCIOS
      </h2>
      <p>Pelo presente instrumento particular de prestação de serviços jurídicos, de um lado:</p>
      <p>${contratantesTexto}, doravante como contratante, e de outro lado:</p>
      <p><strong>CONFORTO E BERGONSI SOCIEDADE DE ADVOGADOS</strong>, CNPJ 56.096.172/0001-65, doravante como contratado; têm entre si, justos e avençados, o que adiante segue: <strong>${acaoTexto}</strong>.</p>
      ${clausulasHtml}
      <p style="margin-top:30px;">E por estarem as partes acima contratadas firmam o presente contrato particular para que produza seus legais e regulares efeitos de direito.</p>
      <p>Americana, data da assinatura digital.</p>
      <div style="display:flex; justify-content:space-around; margin-top:60px; flex-wrap:wrap; gap:30px;">
        ${sigContratantes.join('')}
      </div>
      ${sigAdvogados}
    </div>
  `;
}

export function generateProcuracaoHTML(data, forPdf = false) {
  const { contratantes, numContratantes } = data;
  const acaoTexto = getTipoAcaoTexto(data);
  const num = numContratantes || 1;

  const contratantesQualif = [];
  for (let i = 0; i < num; i++) {
    const c = contratantes[i];
    if (c && c.nome) {
      contratantesQualif.push(qualificacao(c));
    } else {
      contratantesQualif.push('<strong>[CONTRATANTE ' + (i + 1) + ']</strong>');
    }
  }

  const sigProcuracao = [];
  for (let i = 0; i < num; i++) {
    const nome = contratantes[i]?.nome ? contratantes[i].nome.toUpperCase() : '[CONTRATANTE ' + (i + 1) + ']';
    sigProcuracao.push(`
      <div style="text-align:center; margin-top:50px;">
        <div style="border-top:1px solid #000; width:280px; margin:0 auto;"></div>
        <p style="margin-top:4px;"><strong>${nome}</strong></p>
      </div>
    `);
  }

  const pageStyle = `
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: 1.8;
    text-align: justify;
    color: #000;
    ${forPdf ? 'margin: 0; padding: 0;' : 'padding: 30px 35px;'}
  `;

  return `
    <div style="${pageStyle}">
      <h2 style="text-align:center; font-size:14pt; font-weight:bold; text-decoration:underline; margin-bottom:30px;">
        PROCURAÇÃO "AD-JUDICIA"
      </h2>
      <p><strong>OUTORGANTES:</strong> ${contratantesQualif.join(', ')}</p>
      <p><strong>OUTORGADOS:</strong> DR. BRUNO CAVALARI GOMES CAMARGO, advogado, devidamente inscrito na OAB/SP sob nº 390.509 e DR. PAULO ROBERTO CONFORTO, brasileiro, advogado, devidamente inscrito na OAB/SP sob nº 391.151</p>
      <p>Pelo presente instrumento de Procuração "Ad-Judicia", o(a) outorgante acima qualificado(a), nomeia e constitui seu bastante procurador, o advogado acima qualificado, com escritório à Rua das Guatemala, nº 122, bairro Santo Antônio, na cidade de Americana/SP, onde recebe intimações em geral, a quem confere amplos poderes para o foro em geral, com a cláusula "AD JUDICIA", em qualquer Juízo, Instância ou Tribunal, inclusive representação extrajudicial, podendo propor contra quem de direito as ações competentes e defendê-lo nas contrárias, seguindo umas e outras, até final decisão, usando os recursos legais e acompanhando-os, conferindo-lhe, ainda, poderes para reconhecer a procedência do pedido, confessar, desistir da ação ou do direito sobre o qual se funda a ação, transigir, firmar compromissos ou acordos, receber e dar quitação, declarar situação de pobreza jurídica, agindo em conjunto ou separadamente, podendo ainda substabelecer está a outrem, com ou sem reservas de iguais poderes, especificamente para ajuizar ${acaoTexto}.</p>
      <p style="margin-top:30px;">Americana, data da assinatura digital.</p>
      ${sigProcuracao.join('')}
    </div>
  `;
}

// Combined for PDF generation (contract + procuração on separate pages)
export function generateFullDocumentHTML(data) {
  const contractHtml = generateContractHTML(data, true);
  const procuracaoHtml = generateProcuracaoHTML(data, true);
  return contractHtml + '<div class="page-break"></div>' + procuracaoHtml;
}
