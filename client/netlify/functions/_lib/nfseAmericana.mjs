/**
 * NFS-e Nacional - emissao DIRETA na Prefeitura de Americana/SP (bypass do Asaas).
 *
 * Modulo NUCLEO (montagem + assinatura da DPS). Ainda NAO esta plugado no fluxo:
 * o gatilho (asaas-webhook), o banco e a UI entram numa proxima etapa. Tudo aqui
 * e puro/testavel; o envio HTTP (mTLS) so roda com o certificado A1 real.
 *
 * Padrao: NFS-e Nacional, layout DPS gov.br (NAO e o ABRASF legado).
 *  - Endpoint REST de Americana: POST {base}/dps/recepcao  body JSON { dpsXmlGZipB64 }
 *  - Auth: mTLS com e-CNPJ A1 (ICP-Brasil) + XML assinado (XMLDSig enveloped)
 *  - Resposta sincrona devolve a NFS-e + chave de 50 digitos (fallback assincrono -> consulta)
 *
 * Fontes (confirmadas em fonte primaria):
 *  - exemplosAPI.zip oficial de Americana (dps.json -> campo "dpsXmlGZipB64";
 *    dps_Assinado.xml -> assinatura rsa-sha1 + C14N inclusiva, Reference URI="#<Id infDPS>")
 *  - Anexo I oficial gov.br v1.00/1.01 + DPS_v1.00.xsd (regEspTrib 0..6; pAliq opcional)
 *  - Manual de integracao NFS-e Nacional de Americana v1.4 (endpoints)
 *
 * Validado em HOMOLOGACAO (americanahomologacao.nfe.com.br) em 17/06/2026:
 *  - mTLS + A1 + assinatura SHA-1 + envelope { dpsXmlGZipB64 }: OK (prefeitura processou a DPS).
 *  - O layout EXIGE versao 1.01 (erro L2127 com 1.00). 1.01 NAO exige o grupo IBS/CBS na transicao.
 *  - No 1.01 o grupo tribMun NAO tem mais 'pAliq' (removido na Reforma) — e Sociedade de
 *    Profissionais nunca envia aliquota mesmo. A DPS deste modulo ja sai estruturalmente valida.
 *  - As pendencias restantes sao do CADASTRO de homologacao do CNPJ, NAO do payload:
 *      L939 = regime 'Sociedade de Profissionais' nao marcado no cadastro de homologacao;
 *      L940 = opcao do Simples Nacional diverge do registro da RFB em homologacao.
 *    Em PRODUCAO o cadastro ja esta correto (Nao Optante + Sociedade de Profissionais) — a
 *    NFS-e real do escritorio (emitida via Asaas) comprova. cTribMun '005' idem (consta na nota real).
 */
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import https from 'node:https';

// --- Dados fixos do prestador (publicos, imutaveis) ---
export const PRESTADOR = {
  cnpj: '56096172000165',   // 56.096.172/0001-65 - CONFORTO E BERGONSI SOCIEDADE DE ADVOGADOS
  im: '123030',             // Inscricao Municipal em Americana
  cMun: '3501608',          // Americana/SP (codigo IBGE)
  opSimpNac: 1,             // 1 = Nao Optante pelo Simples Nacional
  regEspTrib: 6,            // 6 = Sociedade de Profissionais (ISS fixo)
  cTribNac: '171401',       // 17.14.01 - Advocacia (item da lista LC 116)
  cTribMun: '005',          // codigo municipal do servico (Americana) - conferir
  cNBS: '113012000',        // 1.1301.20.00
  email: 'lorenza@advocaciacbc.com',
  fone: '1988051878',
};

// --- Ambientes ---
export const AMBIENTES = {
  homologacao: { tpAmb: 2, base: 'https://americanahomologacao.nfe.com.br/api/adn' },
  producao: { tpAmb: 1, base: 'https://nfse.americana.sp.gov.br/api/adn' },
};

const NS = 'http://www.sped.fazenda.gov.br/nfse';
const VERSAO_DPS_PADRAO = '1.01'; // Americana homologacao exige 1.01 (erro L2127 com 1.00)

// ─────────────────────────── helpers ───────────────────────────

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const zeros = (v, len) => soDigitos(v).padStart(len, '0').slice(-len);
const dinheiro = (v) => Number(v || 0).toFixed(2);

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// elemento simples (omitido quando vazio)
function el(nome, valor) {
  if (valor == null || valor === '') return '';
  return `<${nome}>${escXml(valor)}</${nome}>`;
}

/**
 * Monta o atributo Id da infDPS (45 chars): "DPS" + IBGE(7) + tipoInsc(1) + Insc(14)
 * + serie(5) + nDPS(15). tipoInsc: 1=CPF, 2=CNPJ.
 */
export function montarIdDps({ cMun, cnpj, cpf, serie, nDPS }) {
  const insc = cnpj ? zeros(cnpj, 14) : zeros(cpf, 14);
  const tipoInsc = cnpj ? '2' : '1';
  return 'DPS' + zeros(cMun, 7) + tipoInsc + insc + zeros(serie, 5) + zeros(nDPS, 15);
}

/**
 * Monta o XML da DPS (minificado, sem espacos entre tags - importante p/ assinatura).
 * @returns {{ xml: string, id: string }}
 *
 * opts:
 *  - ambiente: 'homologacao' | 'producao' (define tpAmb)
 *  - serie, nDPS: numero sequencial da DPS (o caller controla a sequencia)
 *  - dhEmi: ISO com timezone (-03:00). default: agora
 *  - dCompet: 'AAAA-MM-DD'. default: data de dhEmi
 *  - valor: valor do servico (numero)
 *  - descricao: xDescServ
 *  - tomador: { cpf?, cnpj?, nome, email?, end?: { cMun, cep, logradouro, numero, complemento, bairro } }
 *  - prestador: override do PRESTADOR (opcional)
 *  - versao: '1.00' (default) | '1.01'
 *  - verAplic: identificador do app emissor
 */
export function buildDpsXml(opts) {
  const {
    ambiente = 'producao',
    serie,
    nDPS,
    dhEmi,
    dCompet,
    valor,
    descricao = 'Prestacao de servicos advocaticios',
    tomador = {},
    prestador = PRESTADOR,
    versao = VERSAO_DPS_PADRAO,
    verAplic = 'cbc-contratos-1',
  } = opts;

  const amb = AMBIENTES[ambiente] || AMBIENTES.producao;
  const emi = dhEmi || new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00');
  const compet = dCompet || emi.slice(0, 10);

  const id = montarIdDps({ cMun: prestador.cMun, cnpj: prestador.cnpj, serie, nDPS });

  // --- prestador: o sistema municipal completa nome/endereco pelo cadastro (IM) ---
  const prestXml =
    '<prest>' +
    el('CNPJ', soDigitos(prestador.cnpj)) +
    el('IM', prestador.im) +
    el('fone', soDigitos(prestador.fone)) +
    el('email', prestador.email) +
    '<regTrib>' +
    el('opSimpNac', prestador.opSimpNac) +
    el('regEspTrib', prestador.regEspTrib) +
    '</regTrib>' +
    '</prest>';

  // --- tomador (opcional). PF (so CPF): endereco nao e exigido p/ advocacia s/ retencao ---
  let tomaXml = '';
  if (tomador && (tomador.cpf || tomador.cnpj || tomador.nome)) {
    const ident = tomador.cnpj
      ? el('CNPJ', soDigitos(tomador.cnpj))
      : el('CPF', zeros(tomador.cpf, 11));
    let endXml = '';
    if (tomador.end && tomador.end.cMun) {
      const e = tomador.end;
      endXml =
        '<end><endNac>' +
        el('cMun', zeros(e.cMun, 7)) +
        el('CEP', zeros(e.cep, 8)) +
        '</endNac>' +
        el('xLgr', e.logradouro) +
        el('nro', e.numero) +
        el('xCpl', e.complemento) +
        el('xBairro', e.bairro) +
        '</end>';
    }
    tomaXml =
      '<toma>' +
      ident +
      el('xNome', tomador.nome) +
      endXml +
      el('fone', soDigitos(tomador.fone)) +
      el('email', tomador.email) +
      '</toma>';
  }

  // --- servico ---
  const servXml =
    '<serv>' +
    '<locPrest>' +
    el('cLocPrestacao', prestador.cMun) +
    '</locPrest>' +
    '<cServ>' +
    el('cTribNac', prestador.cTribNac) +
    el('cTribMun', prestador.cTribMun) +
    el('xDescServ', descricao) +
    el('cNBS', prestador.cNBS) +
    '</cServ>' +
    '</serv>';

  // --- valores: Sociedade de Profissionais -> SEM pAliq/BC/ISSQN (regras E0604/E1307) ---
  const valoresXml =
    '<valores>' +
    '<vServPrest>' +
    el('vServ', dinheiro(valor)) +
    '</vServPrest>' +
    '<trib>' +
    '<tribMun>' +
    el('tribISSQN', 1) +
    el('tpRetISSQN', 1) +
    '</tribMun>' +
    '<totTrib>' +
    '<vTotTrib>' +
    el('vTotTribFed', '0.00') +
    el('vTotTribEst', '0.00') +
    el('vTotTribMun', '0.00') +
    '</vTotTrib>' +
    '</totTrib>' +
    '</trib>' +
    '</valores>';

  const infDps =
    `<infDPS Id="${id}">` +
    el('tpAmb', amb.tpAmb) +
    el('dhEmi', emi) +
    el('verAplic', verAplic) +
    el('serie', serie) +
    el('nDPS', nDPS) +
    el('dCompet', compet) +
    el('tpEmit', 1) +
    el('cLocEmi', prestador.cMun) +
    prestXml +
    tomaXml +
    servXml +
    valoresXml +
    '</infDPS>';

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS versao="${versao}" xmlns="${NS}">` +
    infDps +
    '</DPS>';

  return { xml, id };
}

// ─────────────────────────── certificado A1 ───────────────────────────

/**
 * Le um certificado A1 (.pfx/.p12 e-CNPJ) e extrai chave + cert em PEM.
 * @param pfxBase64 conteudo do .pfx em base64 (env NFSE_CERT_PFX_BASE64)
 * @param senha senha do .pfx (env NFSE_CERT_SENHA)
 */
export function loadCert(pfxBase64, senha) {
  const der = forge.util.decode64(String(pfxBase64 || '').trim());
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);

  const keyOid = forge.pki.oids.pkcs8ShroudedKeyBag;
  const keyBag = p12.getBags({ bagType: keyOid })[keyOid]?.[0];
  if (!keyBag) throw new Error('NFSe: chave privada nao encontrada no .pfx');
  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

  const certOid = forge.pki.oids.certBag;
  const certBags = p12.getBags({ bagType: certOid })[certOid] || [];
  // escolhe o cert folha (com chave correspondente) - normalmente o primeiro
  const certBag = certBags[0];
  if (!certBag) throw new Error('NFSe: certificado nao encontrado no .pfx');
  const cert = certBag.cert;
  const certificatePem = forge.pki.certificateToPem(cert);
  const certificateClean = certificatePem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
    .replace(/\r?\n/g, '')
    .trim();

  if (cert.validity && cert.validity.notAfter < new Date()) {
    throw new Error('NFSe: certificado A1 expirado em ' + cert.validity.notAfter.toISOString());
  }
  return { privateKeyPem, certificatePem, certificateClean };
}

// ─────────────────────────── assinatura XMLDSig ───────────────────────────

/**
 * Assina a infDPS (enveloped). Por padrao usa SHA-1 (igual ao exemplo oficial de
 * Americana); passe { algo: 'sha256' } para o padrao nacional, se a homologacao exigir.
 */
export function signDps(xml, cert, { algo = 'sha1' } = {}) {
  const sha256 = algo === 'sha256';
  const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

  const sig = new SignedXml({
    privateKey: cert.privateKeyPem,
    publicCert: cert.certificatePem,
    signatureAlgorithm: sha256
      ? 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
      : 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: C14N,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    digestAlgorithm: sha256
      ? 'http://www.w3.org/2001/04/xmlenc#sha256'
      : 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      C14N,
    ],
  });

  // Signature como ultimo filho de <DPS>, depois de </infDPS> (enveloped)
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='infDPS']", action: 'after' },
  });

  let signed = sig.getSignedXml();

  // garante <KeyInfo><X509Data><X509Certificate> (igual ao exemplo oficial)
  if (!/<(\w+:)?X509Certificate>/.test(signed)) {
    const keyInfo =
      '<KeyInfo><X509Data><X509Certificate>' +
      cert.certificateClean +
      '</X509Certificate></X509Data></KeyInfo>';
    signed = signed.replace(/<\/SignatureValue>/, '</SignatureValue>' + keyInfo);
  }
  return signed;
}

// ─────────────────────────── empacotamento ───────────────────────────

/** XML assinado -> { dpsXmlGZipB64 } (corpo do POST /dps/recepcao) */
export function toDpsEnvelope(signedXml) {
  return { dpsXmlGZipB64: gzipSync(Buffer.from(signedXml, 'utf8')).toString('base64') };
}

/** decodifica um campo *XmlGZipB64 de volta para XML (resposta da NFS-e) */
export function fromGzipB64(b64) {
  return gunzipSync(Buffer.from(String(b64 || ''), 'base64')).toString('utf8');
}

// ─────────────────────────── transporte mTLS ───────────────────────────
// (incluido para a proxima etapa; o fetch global do Node nao suporta client cert)

function httpsMtls(url, { method = 'GET', headers = {}, body } = {}, cert) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers,
        key: cert.privateKeyPem,
        cert: cert.certificatePem,
        // producao: manter rejectUnauthorized true (cadeia ICP-Brasil)
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Envia a DPS assinada (POST {base}/dps/recepcao). Requer cert (mTLS). */
export async function enviarDps(signedXml, { ambiente = 'producao', cert }) {
  const amb = AMBIENTES[ambiente] || AMBIENTES.producao;
  const body = JSON.stringify(toDpsEnvelope(signedXml));
  const resp = await httpsMtls(
    `${amb.base}/dps/recepcao`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
    },
    cert,
  );
  let json = null;
  try { json = JSON.parse(resp.text); } catch { /* deixa text cru */ }
  return { status: resp.status, json, raw: resp.text };
}

/** Consulta a DPS pelo numero (fallback assincrono). */
export async function consultarDps(numeroDps, { ambiente = 'producao', cert }) {
  const amb = AMBIENTES[ambiente] || AMBIENTES.producao;
  const resp = await httpsMtls(`${amb.base}/dps/chave-acesso/${numeroDps}`, { method: 'GET' }, cert);
  return { status: resp.status, raw: resp.text };
}
