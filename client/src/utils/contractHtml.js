import { CLAUSULAS_PADRAO } from '../data/clausulas';
import { formatCurrency, valorExtenso } from './extenso';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR');
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function getMesPrimeiraParcela(dateStr) {
  if (!dateStr) return '___';
  const d = new Date(dateStr + 'T12:00:00');
  return MESES[d.getMonth()];
}

function isPJ(c) {
  return c && c.tipo === 'pj';
}

// (PJ 25/06) nome que aparece na linha de assinatura: razao social (PJ) ou nome (PF)
function nomeAssinatura(c) {
  if (isPJ(c)) return (c.razaoSocial || `[EMPRESA]`).toUpperCase();
  return c?.nome ? c.nome.toUpperCase() : '';
}

// Bloco de endereco no padrao da casa ("..., nº X, compl, no bairro Y, na cidade Z/UF, CEP: ...")
function enderecoTexto(endereco, numero, complemento, bairro, cidade, uf, cep) {
  const num = numero ? `, nº ${numero}` : '';
  const comp = complemento ? `, ${complemento}` : '';
  return `${endereco || '___'}${num}${comp}, no bairro ${bairro || '___'}, na cidade ${cidade || '___'}/${uf || '___'}, CEP: ${cep || '___'}`;
}

// (enderecos distintos 14/07/2026) Compara o endereco de dois contratantes
// (normalizado) para decidir entre a linha compartilhada "Residente(s) e
// domiciliado(s) em" e o endereco embutido na qualificacao de cada um.
function normEnderecoCampo(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function mesmoEndereco(a, b) {
  const campos = ['endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'];
  return campos.every(k => normEnderecoCampo(a && a[k]) === normEnderecoCampo(b && b[k]));
}

// Qualificacao do representante legal (reaproveita os campos de pessoa do contratante).
// 'curta' omite o endereco residencial (usada na caixa PARTES do PF).
function qualificacaoPessoa(c, { curta = false } = {}) {
  const base = `${c.nacionalidade || 'brasileiro(a)'}, ${(c.estadoCivil || '').toLowerCase()}, ${(c.profissao || '').toLowerCase()}, RG: ${c.rg || '___'}, CPF: ${c.cpf || '___'}, e-mail: ${c.email || '___'}`;
  if (curta) return base;
  return `${base}, residente e domiciliado na ${enderecoTexto(c.endereco, c.numero, c.complemento, c.bairro, c.cidade, c.uf, c.cep)}`;
}

// Qualificacao da empresa (PJ) + representante. Sempre completa (com sede + endereco do rep),
// para refletir o padrao do contrato-exemplo da CBC.
function qualificacaoPJ(c) {
  const sede = enderecoTexto(c.enderecoEmpresa, c.numeroEmpresa, c.complementoEmpresa, c.bairroEmpresa, c.cidadeEmpresa, c.ufEmpresa, c.cepEmpresa);
  return `<strong>${(c.razaoSocial || '[EMPRESA]').toUpperCase()}</strong>, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${c.cnpj || '___'}, com sede na ${sede}, neste ato representada por <strong>${(c.nome || '[REPRESENTANTE]').toUpperCase()}</strong>, ${qualificacaoPessoa(c)}`;
}

function qualificacao(c) {
  if (!c) return '';
  if (isPJ(c)) return qualificacaoPJ(c);
  if (!c.nome) return '';
  return `<strong>${c.nome.toUpperCase()}</strong>, ${qualificacaoPessoa(c)}`;
}

// Versao curta para a caixa PARTES do contrato (PF sem endereco; PJ sempre completa).
function qualificacaoCurta(c) {
  if (!c) return '';
  if (isPJ(c)) return qualificacaoPJ(c);
  if (!c.nome) return '';
  return `<strong>${c.nome.toUpperCase()}</strong>, ${qualificacaoPessoa(c, { curta: true })}`;
}

// Used in PROCURAÇÃO — most actions are "rescisão contratual" except cobrança and dano moral
function getTipoAcaoProcuracao(data) {
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const resortUpper = (resort || '___________').toUpperCase();

  // Cobrança and Dano Moral keep their original name
  const nonRescisao = ['ação de cobrança', 'dano moral'];
  const isNonRescisao = tipoAcao && nonRescisao.some(t => tipoAcao.toLowerCase().includes(t.toLowerCase()));

  if (isNonRescisao) {
    return `${tipoAcao.toUpperCase()} REFERENTE AO ${resortUpper}`;
  }
  return `AÇÃO DE RESCISÃO CONTRATUAL EM FACE DE ${resortUpper}`;
}

// ─── Cláusula 1: Objeto e Natureza ───────────────────────────────────────────
function gerarTextoObjeto(data) {
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const resortNome = resort || '[NOME DO RESORT/EMPRESA]';

  return `
    <p style="text-align:justify; margin:0 0 8px;">a) O presente contrato tem por objeto a prestação de serviços advocatícios para propositura e acompanhamento de <strong>ação judicial</strong> em face de <strong>${resortNome}</strong>.</p>
    <p style="text-align:justify; margin:0 0 8px;">b) Advocacia é obrigação de meio, não de resultado. O ESCRITÓRIO se compromete a empregar todos os meios jurídicos disponíveis em defesa do CLIENTE, mas não pode garantir prazo de encerramento nem resultado específico, pois a decisão final cabe ao Poder Judiciário.</p>
    <div style="border-left:4px solid #C8973A; background:#FFF8E7; padding:8px 14px; margin:10px 0; font-style:italic; font-size:10.5pt; color:#5A3E00;">
      ✦ <strong>EM PALAVRAS SIMPLES:</strong> O advogado fará tudo que a lei permite. O resultado final depende do juiz — não é possível garantir prazo ou vitória.
    </div>
    <p style="text-align:justify; margin:0;">c) O contrato abrange todas as fases do processo desde o ajuizamento até o trânsito em julgado e o cumprimento de sentença (fase de execução).</p>
  `;
}

// ─── Cláusula 2: Escopo ──────────────────────────────────────────────────────
function gerarTextoEscopo() {
  return `
    <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">
      <tr>
        <td style="width:50%; padding:8px 12px; background:#E8F5E9; border:1px solid #C8E6C9; vertical-align:top;">
          <div style="font-weight:bold; color:#2E7D32; margin-bottom:6px; font-size:10.5pt;">✅ INCLUÍDO</div>
          <p style="margin:2px 0; font-size:10.5pt;">• Todas as instâncias e tribunais</p>
          <p style="margin:2px 0; font-size:10.5pt;">• Defesa em recursos da parte contrária</p>
          <p style="margin:2px 0; font-size:10.5pt;">• Acompanhamento até o cumprimento da decisão</p>
        </td>
        <td style="width:50%; padding:8px 12px; background:#FEEBEE; border:1px solid #FFCDD2; vertical-align:top;">
          <div style="font-weight:bold; color:#C62828; margin-bottom:6px; font-size:10.5pt;">❌ NÃO INCLUÍDO</div>
          <p style="margin:2px 0; font-size:10.5pt;">• Qualquer ação não relacionada à demanda principal</p>
        </td>
      </tr>
    </table>
    <p style="text-align:justify; margin:0;">c) Em caso de recurso interposto pela parte contrária, o ESCRITÓRIO atuará na defesa dos interesses do CLIENTE. Poderá, contudo, abster-se de interpor recurso que, por convicção jurídica fundamentada, não apresente perspectiva de resultado útil, comunicando previamente o CLIENTE.</p>
  `;
}

// ─── Cláusula 3: Honorários ──────────────────────────────────────────────────
function gerarTextoHonorarios(h) {
  const dataPrimeira = formatDate(h.dataPrimeiraParcela) || '___/___/______';
  const diaParcela = h.dataPrimeiraParcela
    ? new Date(h.dataPrimeiraParcela + 'T12:00:00').getDate()
    : '___';
  const total = h.total || 0;
  const parcelas = h.parcelas || 0;
  const vp = h.valorParcela || 0;
  const exito = h.percentualExito || '___';
  const mesPrimeira = getMesPrimeiraParcela(h.dataPrimeiraParcela);

  const parteFixaTexto = parcelas === 1
    ? `${total > 0 ? formatCurrency(total) : 'R$ ___'} (${total > 0 ? valorExtenso(total) : '___'}), pagos à vista, com vencimento em ${dataPrimeira}`
    : `${total > 0 ? formatCurrency(total) : 'R$ ___'} (${total > 0 ? valorExtenso(total) : '___'}), pagos em ${parcelas || '___'} parcelas mensais de ${vp > 0 ? formatCurrency(vp) : 'R$ ___'} (${vp > 0 ? valorExtenso(vp) : '___'}) cada, com vencimento da primeira em ${dataPrimeira} (${mesPrimeira}) e as demais todo dia ${diaParcela} dos meses subsequentes`;

  // Mini summary table at top of clause
  let summaryTable = '';
  if (h.somenteExito) {
    summaryTable = `
      <table style="width:100%; border-collapse:collapse; margin-bottom:12px; background:#F2F4F8; border:1px solid #D9DDED;">
        <tr>
          <td style="padding:10px 14px; text-align:center; border-right:1px solid #D9DDED;">
            <div style="font-size:8.5pt; color:#5A6A85; font-weight:bold; letter-spacing:0.5px; margin-bottom:4px;">HONORÁRIO FIXO</div>
            <div style="font-size:11pt; color:#1A2E52; font-weight:bold;">—</div>
            <div style="font-size:8.5pt; color:#5A6A85;">Não aplicável</div>
          </td>
          <td style="padding:10px 14px; text-align:center;">
            <div style="font-size:8.5pt; color:#5A6A85; font-weight:bold; letter-spacing:0.5px; margin-bottom:4px;">HONORÁRIO DE ÊXITO</div>
            <div style="font-size:16pt; color:#C8973A; font-weight:bold;">${exito}%</div>
            <div style="font-size:8.5pt; color:#5A6A85;">Sobre o valor efetivamente recebido</div>
          </td>
        </tr>
      </table>
      <div style="background:#E8F5E9; border:1px solid #C8E6C9; border-left:4px solid #4CAF50; padding:8px 12px; margin-bottom:10px; font-size:10.5pt; color:#1B5E20;">
        ✅ <strong>Êxito: só paga quando ganhar.</strong> O honorário de êxito só é cobrado quando você ganhar a ação e receber o dinheiro. O escritório descontará o percentual antes de repassar o valor.
      </div>
    `;
  } else if (h.somenteIniciais) {
    summaryTable = `
      <table style="width:100%; border-collapse:collapse; margin-bottom:12px; background:#F2F4F8; border:1px solid #D9DDED;">
        <tr>
          <td style="padding:10px 14px; text-align:center;">
            <div style="font-size:8.5pt; color:#5A6A85; font-weight:bold; letter-spacing:0.5px; margin-bottom:4px;">HONORÁRIO FIXO</div>
            <div style="font-size:14pt; color:#1A2E52; font-weight:bold;">${total > 0 ? formatCurrency(total) : 'R$ X.XXX,00'}</div>
            <div style="font-size:8.5pt; color:#5A6A85;">${parcelas > 1 ? `${parcelas}x de ${vp > 0 ? formatCurrency(vp) : 'R$ XXX,00'} · venc. dia ${diaParcela}` : 'À vista · venc. ' + dataPrimeira}</div>
          </td>
        </tr>
      </table>
    `;
  } else {
    summaryTable = `
      <table style="width:100%; border-collapse:collapse; margin-bottom:12px; background:#F2F4F8; border:1px solid #D9DDED;">
        <tr>
          <td style="padding:10px 14px; text-align:center; border-right:1px solid #D9DDED; width:50%;">
            <div style="font-size:8.5pt; color:#5A6A85; font-weight:bold; letter-spacing:0.5px; margin-bottom:4px;">HONORÁRIO FIXO</div>
            <div style="font-size:14pt; color:#1A2E52; font-weight:bold;">${total > 0 ? formatCurrency(total) : 'R$ X.XXX,00'}</div>
            <div style="font-size:8.5pt; color:#5A6A85;">${parcelas > 1 ? `${parcelas}x de ${vp > 0 ? formatCurrency(vp) : 'R$ XXX,00'} · venc. dia ${diaParcela}` : 'À vista · venc. ' + dataPrimeira}</div>
          </td>
          <td style="padding:10px 14px; text-align:center; width:50%;">
            <div style="font-size:8.5pt; color:#5A6A85; font-weight:bold; letter-spacing:0.5px; margin-bottom:4px;">HONORÁRIO DE ÊXITO</div>
            <div style="font-size:16pt; color:#C8973A; font-weight:bold;">${exito}%</div>
            <div style="font-size:8.5pt; color:#5A6A85;">Sobre o valor efetivamente recebido</div>
          </td>
        </tr>
      </table>
      <div style="background:#E8F5E9; border:1px solid #C8E6C9; border-left:4px solid #4CAF50; padding:8px 12px; margin-bottom:10px; font-size:10.5pt; color:#1B5E20;">
        ✅ <strong>Êxito: só paga quando ganhar.</strong> O honorário de êxito só é cobrado quando você ganhar a ação e receber o dinheiro. O escritório descontará o percentual antes de repassar o valor.
      </div>
    `;
  }

  if (h.somenteExito) {
    return summaryTable + `
      <p style="text-align:justify; margin:0 0 8px;">Fica ajustado que o CLIENTE pagará ao ESCRITÓRIO honorários exclusivamente na modalidade de êxito (<em>ad exitum</em>):</p>
      <p style="text-align:justify; margin:0 0 8px;">a) <strong>Honorários de Êxito (<em>Ad Exitum</em>):</strong> ${exito}% sobre o proveito econômico efetivamente obtido, assim entendido o valor constante da sentença ou do acordo homologado, atualizado até a data do efetivo recebimento.</p>
      <p style="text-align:justify; margin:0 0 8px;">b) Os honorários de êxito são devidos no momento do efetivo recebimento dos valores pelo CLIENTE ou se for feito acordo — que só poderá ser celebrado com a sua expressa concordância. O ESCRITÓRIO está autorizado a deduzir o percentual diretamente do valor recebido.</p>
      <p style="text-align:justify; margin:0;">c) <strong>Honorários de sucumbência:</strong> Os honorários sucumbenciais fixados pelo juízo pertencem exclusivamente ao ESCRITÓRIO, nos termos do art. 23 da Lei 8.906/94, e por força de lei não se compensam com os honorários contratuais.</p>
    `;
  }

  if (h.somenteIniciais) {
    return summaryTable + `
      <p style="text-align:justify; margin:0 0 8px;">Fica ajustado que o CLIENTE pagará ao ESCRITÓRIO os honorários pactuados da seguinte forma:</p>
      <p style="text-align:justify; margin:0 0 8px;">a) <strong>Parte Fixa (Honorários Iniciais):</strong> ${parteFixaTexto}.</p>
      <p style="text-align:justify; margin:0 0 8px;">b) <strong>Honorários de sucumbência:</strong> Os honorários sucumbenciais fixados pelo juízo pertencem exclusivamente ao ESCRITÓRIO, nos termos do art. 23 da Lei 8.906/94.</p>
      <p style="text-align:justify; margin:0 0 8px;">c) <strong>Inadimplemento:</strong> O atraso ou não pagamento de qualquer parcela implica multa de 10% sobre o valor em aberto, acrescida de juros de 1% ao mês, a partir do vencimento. Havendo inadimplemento superior a 30 (trinta) dias, o ESCRITÓRIO poderá suspender os serviços após notificação prévia de 5 (cinco) dias úteis ao CLIENTE.</p>
      <p style="text-align:justify; margin:0;">d) <strong>Forma de pagamento:</strong> As parcelas mensais serão pagas exclusivamente pelo sistema ASAAS, mediante cobrança enviada por WhatsApp.</p>
    `;
  }

  return summaryTable + `
    <p style="text-align:justify; margin:0 0 8px;">Fica ajustado que o CLIENTE pagará ao ESCRITÓRIO os honorários pactuados da seguinte forma:</p>
    <p style="text-align:justify; margin:0 0 8px;">a) <strong>Parte Fixa (Honorários Iniciais):</strong> ${parteFixaTexto}.</p>
    <p style="text-align:justify; margin:0 0 8px;">b) <strong>Honorários de Êxito (<em>Ad Exitum</em>):</strong> ${exito}% sobre o proveito econômico efetivamente obtido, assim entendido o valor constante da sentença ou do acordo homologado, atualizado até a data do efetivo recebimento.</p>
    <p style="text-align:justify; margin:0 0 8px;">c) Os honorários de êxito são devidos no momento do efetivo recebimento dos valores pelo CLIENTE ou se for feito acordo — que só poderá ser celebrado com a sua expressa concordância. O ESCRITÓRIO está autorizado a deduzir o percentual diretamente do valor recebido.</p>
    <p style="text-align:justify; margin:0 0 8px;">d) <strong>Honorários de sucumbência:</strong> Os honorários sucumbenciais fixados pelo juízo pertencem exclusivamente ao ESCRITÓRIO, nos termos do art. 23 da Lei 8.906/94, e por força de lei não se compensam com os honorários contratuais.</p>
    <p style="text-align:justify; margin:0 0 8px;">e) <strong>Inadimplemento:</strong> O atraso ou não pagamento de qualquer parcela implica multa de 10% sobre o valor em aberto, acrescida de juros de 1% ao mês, a partir do vencimento. Havendo inadimplemento superior a 30 (trinta) dias, o ESCRITÓRIO poderá suspender os serviços após notificação prévia de 5 (cinco) dias úteis ao CLIENTE.</p>
    <p style="text-align:justify; margin:0;">f) <strong>Forma de pagamento:</strong> As parcelas mensais serão pagas exclusivamente pelo sistema ASAAS, mediante cobrança enviada por WhatsApp.</p>
  `;
}

function gerarResumoHonorarios(h) {
  const total = h.total || 0;
  const parcelas = h.parcelas || 0;
  const vp = h.valorParcela || 0;
  const exito = h.percentualExito || '___';

  let fixosText = null;
  let exitoText = null;

  if (!h.somenteExito) {
    fixosText = parcelas === 1
      ? `${total > 0 ? formatCurrency(total) : 'R$ ___'} — à vista`
      : `${total > 0 ? formatCurrency(total) : 'R$ ___'} — parcelado em ${parcelas}× de ${vp > 0 ? formatCurrency(vp) : 'R$ ___'}`;
  }
  if (!h.somenteIniciais) {
    exitoText = `${exito}% sobre o valor efetivamente recuperado`;
  }

  return { fixosText, exitoText };
}

function getClausulaTexto(clausulas, id) {
  if (clausulas[id] !== undefined) return clausulas[id];
  const c = CLAUSULAS_PADRAO.find(cl => cl.id === id);
  return c ? c.texto : '';
}

// (perf-fe-13) Esta funcao remonta o HTML inteiro a cada chamada (uma string
// unica). O LivePreview ja a envolve num useMemo([data, tab]) e o caminho do
// PDF tem debounce; partir o HTML em pedacos memoizados (cabecalho/clausulas
// estaveis) exigiria mudar a assinatura e o cache aqui — risco de alterar o
// documento gerado. Decidido manter a montagem completa por seguranca.
export function generateContractHTML(data, forPdf = false) {
  const { contratantes, numContratantes, honorarios, clausulas } = data;
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const { fixosText, exitoText } = gerarResumoHonorarios(honorarios);

  const num = numContratantes || 1;
  const c0 = contratantes[0];

  // (enderecos distintos 14/07/2026) A caixa PARTES compacta (qualificacao curta +
  // linha "Residente(s) e domiciliado(s) em" com o endereco do 1o contratante) so vale
  // quando TODOS os PF preenchidos moram no mesmo endereco e o 1o contratante e PF.
  // Caso contrario, cada PF leva o proprio endereco embutido na qualificacao (mesmo
  // formato da procuracao) e a linha compartilhada e omitida — o contrato nunca pode
  // declarar domicilio comum para quem mora em enderecos diferentes.
  // PJ ja embute sede + endereco do representante na propria qualificacao.
  const pfsAtivos = [];
  for (let i = 0; i < num; i++) {
    const c = contratantes[i];
    if (c && !isPJ(c) && (c.nome || c.endereco)) pfsAtivos.push(c);
  }
  const enderecoUnico = pfsAtivos.length > 0 && pfsAtivos.every(c => mesmoEndereco(c, pfsAtivos[0]));
  const partesCompactas = enderecoUnico && c0 && !isPJ(c0);

  // PARTES client list
  const partesItems = [];
  for (let i = 0; i < num; i++) {
    const c = contratantes[i];
    if (c && (c.nome || c.razaoSocial)) {
      partesItems.push(partesCompactas ? qualificacaoCurta(c) : qualificacao(c));
    } else {
      partesItems.push(`<strong>[CONTRATANTE ${i + 1}]</strong>`);
    }
  }

  // (PJ 25/06) PF: linha "Residente e domiciliado em" do 1o contratante. Plural conforme
  // o numero de PFs (PJ nao entra na contagem — a sede ja esta na qualificacao dela).
  const pluralPf = pfsAtivos.length > 1;
  const enderecoLine = (partesCompactas && c0.endereco)
    ? ` Residente${pluralPf ? 's' : ''} e domiciliado${pluralPf ? 's' : ''} em: "${c0.endereco}${c0.numero ? ', nº ' + c0.numero : ''}${c0.complemento ? ', ' + c0.complemento : ''}, ${c0.bairro || ''}, ${c0.cidade || ''}/${c0.uf || ''}, CEP: ${c0.cep || '___'}".`
    : '';

  // Build clauses
  const avulsas = (data.clausulasAvulsas || []).map(a => ({ ...a, editavel: true, avulsa: true }));
  const allClausulas = [...CLAUSULAS_PADRAO, ...avulsas];
  const defaultOrder = allClausulas.map(c => c.id);
  const orderedIds = data.clausulasOrder || defaultOrder;
  const orderedClausulas = orderedIds.map(id => allClausulas.find(c => c.id === id)).filter(Boolean);

  let clausulasHtml = '';
  let clausulaNum = 0;
  for (const cl of orderedClausulas) {
    // Skip clause 5 (despesas processuais) when escritório arca com custas
    if (data.escritorioArcaCustas && cl.id === 'clausula5') continue;

    let bodyHtml;

    if (cl.autoObjeto) {
      bodyHtml = gerarTextoObjeto(data);
    } else if (cl.autoEscopo) {
      bodyHtml = gerarTextoEscopo();
    } else if (cl.auto) {
      bodyHtml = gerarTextoHonorarios(honorarios);
    } else {
      const texto = cl.avulsa
        ? (clausulas[cl.id] || cl.texto || '')
        : getClausulaTexto(clausulas, cl.id);
      bodyHtml = `<p style="text-align:justify; margin:0 0 8px;">${texto.replace(/\n\n/g, '</p><p style="text-align:justify; margin:0 0 8px;">').replace(/\n/g, '<br/>')}</p>`;
    }

    clausulaNum++;
    const tituloLabel = cl.avulsa
      ? `CLÁUSULA ${clausulaNum}ª — ${(cl.titulo || '').toUpperCase()}`
      : `CLÁUSULA ${clausulaNum}ª — ${(cl.titulo || '').replace(/^Cláusula \d+ª — /i, '').toUpperCase()}`;

    clausulasHtml += `
      <div class="no-page-break" style="margin-bottom:10px;">
        <div style="background:#1A2E52; color:white; padding:7px 14px; font-weight:bold; font-size:10pt; margin-bottom:10px; letter-spacing:0.3px; font-family:'Helvetica Neue',Arial,sans-serif;">
          ${tituloLabel}
        </div>
        <div style="padding:0 2px; font-size:11.5pt; line-height:1.75;">
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  // Signature blocks with ZapSign anchor markers
  const sigContratantes = [];
  for (let i = 0; i < num; i++) {
    const nome = nomeAssinatura(contratantes[i]) || `[CONTRATANTE ${i + 1}]`;
    sigContratantes.push(`
      <div style="text-align:center; min-width:160px; flex:1; padding:0 8px;">
        <div style="border-top:1.5px solid #333; width:200px; margin:0 auto;"></div>
        <p style="margin-top:5px; font-size:10pt; line-height:1.4;"><strong>${nome}</strong><br/>CLIENTE — CONTRATANTE</p>
      </div>
    `);
  }

  const pageStyle = forPdf
    ? 'font-family:"Times New Roman",Times,serif; font-size:11.5pt; line-height:1.6; color:#000; margin:0; padding:0;'
    : 'font-family:"Times New Roman",Times,serif; font-size:11.5pt; line-height:1.6; color:#000; padding:14px 20px;';

  return `
    <div style="${pageStyle}">

      <!-- CBC Header -->
      <div style="text-align:center; color:#718096; font-size:9pt; font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:1.5px; margin-bottom:2px;">CONFORTO, BERGONSI &amp; CAVALARI</div>
      <div style="text-align:center; color:#718096; font-size:9pt; font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:0.5px; margin-bottom:2px;">SOCIEDADE DE ADVOGADOS</div>
      <div style="text-align:center; color:#718096; font-size:7.5pt; font-family:'Helvetica Neue',Arial,sans-serif; margin-bottom:18px;">OAB/SP 55.227</div>

      <!-- Main Title -->
      <h1 style="text-align:center; font-family:Georgia,'Times New Roman',serif; font-size:19pt; font-weight:bold; color:#1A2E52; line-height:1.3; margin:0 0 22px;">
        CONTRATO DE PRESTAÇÃO DE<br/>SERVIÇOS ADVOCATÍCIOS
      </h1>

      <!-- PARTES CONTRATANTES box -->
      <div class="no-page-break" style="margin-bottom:14px; background:#F2F4F8; border:1px solid #E2E8F0; border-left:4px solid #C8973A; padding:11px 15px;">
        <p style="font-weight:bold; margin:0 0 8px; color:#1A2E52; font-size:10pt; font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:0.3px;">PARTES CONTRATANTES</p>
        <p style="margin:0 0 5px; text-align:justify; font-size:11pt;"><strong>CLIENTE(S):</strong> ${partesItems.join('; ')}.${enderecoLine}</p>
        <p style="margin:0; text-align:justify; font-size:11pt;"><strong>ESCRITÓRIO:</strong> CONFORTO, BERGONSI &amp; CAVALARI SOCIEDADE DE ADVOGADOS, CNPJ 56.096.172/0001-65, OAB/SP 55.227, Rua Guatemala, 122, Jardim Santo Antônio, Americana/SP.</p>
      </div>

      <!-- RESUMO DO CONTRATO box -->
      <div class="no-page-break" style="margin-bottom:22px; border:1px solid #E2E8F0;">
        <div style="padding:8px 14px; background:#1A2E52; color:white; font-weight:bold; font-size:10pt; font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:0.3px;">📋 RESUMO DO CONTRATO</div>
        <table style="width:100%; border-collapse:collapse;">
          <tr style="background:#F2F4F8;">
            <td style="padding:6px 14px; white-space:nowrap; border-right:1px solid #E2E8F0; font-size:10.5pt; width:38%;">⚖️ <strong>Serviço</strong></td>
            <td style="padding:6px 14px; font-size:10.5pt;">Ação Judicial — ${resort || '[NOME DO RESORT]'}</td>
          </tr>
          ${fixosText ? `
          <tr>
            <td style="padding:6px 14px; white-space:nowrap; border-right:1px solid #E2E8F0; font-size:10.5pt;">💰 <strong>Honorários Fixos</strong></td>
            <td style="padding:6px 14px; font-size:10.5pt;">${fixosText}</td>
          </tr>
          ` : ''}
          ${exitoText ? `
          <tr style="background:#F2F4F8;">
            <td style="padding:6px 14px; white-space:nowrap; border-right:1px solid #E2E8F0; font-size:10.5pt;">🏆 <strong>Honorários de Êxito</strong></td>
            <td style="padding:6px 14px; font-size:10.5pt;">${exitoText}</td>
          </tr>
          ` : ''}
          <tr${exitoText ? '' : ' style="background:#F2F4F8;"'}>
            <td style="padding:6px 14px; white-space:nowrap; border-right:1px solid #E2E8F0; font-size:10.5pt;${exitoText ? ' background:#fff;' : ''}">📱 <strong>Comunicação oficial</strong></td>
            <td style="padding:6px 14px; font-size:10.5pt;${exitoText ? ' background:#fff;' : ''}">WhatsApp: (19) 98805-1878 — exclusivamente</td>
          </tr>
          <tr${exitoText ? ' style="background:#F2F4F8;"' : ''}>
            <td style="padding:6px 14px; white-space:nowrap; border-right:1px solid #E2E8F0; font-size:10.5pt;${exitoText ? '' : ' background:#fff;'}">💳 <strong>Pagamentos</strong></td>
            <td style="padding:6px 14px; font-size:10.5pt;${exitoText ? '' : ' background:#fff;'}">Via sistema ASAAS (link enviado por WhatsApp)</td>
          </tr>
        </table>
      </div>

      <!-- Contract Clauses -->
      ${clausulasHtml}

      <!-- Sign-off + Signatures — single block, never split -->
      <div class="no-page-break signatures-block">
        <p style="text-align:justify; margin:14px 0 4px;">E, por estarem de acordo com todas as disposições acima, as partes assinam o presente instrumento eletronicamente.</p>
        <p style="margin:0 0 28px;">Americana, data da assinatura digital.</p>
        <div style="display:flex; justify-content:space-around; flex-wrap:wrap; gap:16px;">
          ${sigContratantes.join('')}
          <div style="text-align:center; min-width:160px; flex:1; padding:0 8px;">
            <div style="border-top:1.5px solid #333; width:200px; margin:0 auto;"></div>
            <p style="margin-top:5px; font-size:10pt; line-height:1.4;"><strong>CONFORTO, BERGONSI &amp; CAVALARI<br/>SOCIEDADE DE ADVOGADOS</strong><br/>CONTRATADO — OAB/SP 55.227</p>
          </div>
        </div>
      </div>

    </div>
  `;
}

export function generateProcuracaoHTML(data, forPdf = false) {
  const { contratantes, numContratantes } = data;
  const acaoTexto = getTipoAcaoProcuracao(data);
  const num = numContratantes || 1;

  const outorgantesQualif = [];
  for (let i = 0; i < num; i++) {
    const c = contratantes[i];
    if (c && (c.nome || c.razaoSocial)) {
      outorgantesQualif.push(qualificacao(c));
    } else {
      outorgantesQualif.push(`<strong>[CONTRATANTE ${i + 1}]</strong>`);
    }
  }

  const sigProcuracao = [];
  for (let i = 0; i < num; i++) {
    const nome = nomeAssinatura(contratantes[i]) || `[CONTRATANTE ${i + 1}]`;
    sigProcuracao.push(`
      <div style="text-align:center; margin-top:40px;">
        <div style="border-top:1.5px solid #333; width:200px; margin:0 auto;"></div>
        <p style="margin-top:5px; font-size:10pt;"><strong>${nome}</strong><br/>OUTORGANTE</p>
      </div>
    `);
  }

  const pageStyle = forPdf
    ? 'font-family:"Times New Roman",Times,serif; font-size:11.5pt; line-height:1.6; color:#000; margin:0; padding:0;'
    : 'font-family:"Times New Roman",Times,serif; font-size:11.5pt; line-height:1.6; color:#000; padding:14px 20px;';

  return `
    <div class="procuracao-start" style="${pageStyle}">

      <!-- CBC Header + Title — never split -->
      <div class="no-page-break">
        <div style="text-align:center; color:#718096; font-size:9pt; font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:1.5px; margin-bottom:2px;">CONFORTO, BERGONSI &amp; CAVALARI</div>
        <div style="text-align:center; color:#718096; font-size:9pt; font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:0.5px; margin-bottom:2px;">SOCIEDADE DE ADVOGADOS</div>
        <div style="text-align:center; color:#718096; font-size:7.5pt; font-family:'Helvetica Neue',Arial,sans-serif; margin-bottom:18px;">OAB/SP 55.227</div>
        <h2 style="text-align:center; font-family:Georgia,'Times New Roman',serif; font-size:15pt; font-weight:bold; text-decoration:underline; margin:0 0 6px; color:#1A2E52;">
          PROCURAÇÃO AD JUDICIA ET EXTRA
        </h2>
        <p style="text-align:center; font-style:italic; color:#666; font-size:10pt; margin:0 0 20px;">Instrumento de outorga de poderes</p>
      </div>

      <p style="text-align:justify; margin:0 0 10px;"><strong>OUTORGANTE(S):</strong> ${outorgantesQualif.join('; ')}.</p>

      <p style="text-align:justify; margin:0 0 10px;"><strong>OUTORGADOS:</strong> DR. PAULO ROBERTO CONFORTO, advogado, OAB/SP nº 391.151; DR. BRUNO CAVALARI GOMES CAMARGO, advogado, OAB/SP nº 390.509; CONFORTO, BERGONSI &amp; CAVALARI SOCIEDADE DE ADVOGADOS, CNPJ 56.096.172/0001-65, OAB/SP 55.227. Escritório: Rua Guatemala, 122, Jardim Santo Antônio, Americana/SP.</p>

      <p style="text-align:justify; margin:0 0 10px;">Pelo presente instrumento, o(s) OUTORGANTE(S) nomeia(m) e constitui(em) os advogados acima qualificados como bastantes procuradores, conferindo-lhes amplos poderes para o foro em geral, com a cláusula AD JUDICIA ET EXTRA, em qualquer Juízo, Instância ou Tribunal, inclusive para representação extrajudicial. Poderes especiais: reconhecer a procedência do pedido, confessar, desistir, transigir, firmar acordos, receber e dar quitação e declarar situação de pobreza para fins de gratuidade judiciária, atuando em conjunto ou separadamente. Poderão ainda substabelecer este mandato a outrem, com ou sem reserva de iguais poderes.</p>

      <p style="text-align:justify; margin:0 0 20px;">Procuração especialmente outorgada para: <strong>${acaoTexto}</strong>.</p>

      <p style="margin:0;">Americana, data da assinatura digital.</p>

      <div class="no-page-break">
        ${sigProcuracao.join('')}
      </div>
    </div>
  `;
}

// Combined for PDF generation (contract + procuração on separate pages)
export function generateFullDocumentHTML(data) {
  const contractHtml = generateContractHTML(data, true);
  const procuracaoHtml = generateProcuracaoHTML(data, true);
  return contractHtml + procuracaoHtml;
}
