// (16/10/2026) Resumo automatico das videochamadas pelo Claude.
// Fonte: netlify/functions/_lib/callResumo.mjs e _lib/googleSa.mjs (partes puras).
// O que estes testes travam: o formato exigido do modelo (structured outputs recusa schema
// fora das regras), a nota que vai para o Kommo, o portao de transcricao curta/longa, e a
// trava de impersonacao Google (a chave le o Drive do dominio inteiro).
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  SCHEMA, SISTEMA, PRECOS, MODELO_PADRAO, MIN_CARACTERES, MAX_CARACTERES,
  dataDaChamada, motivoParaPular, montarPedido, validarResumo, marcadorKommo,
  textoNotaKommo, alertasGestao, custoUsd,
} from '../../../netlify/functions/_lib/callResumo.mjs';
import { montarJwt, lerChave, escolherAnexo, exigirVendedora, ESCOPOS } from '../../../netlify/functions/_lib/googleSa.mjs';

const resumoValido = () => ({
  houve_atendimento: true,
  resumo_curto: 'Cliente quer sair do contrato.',
  dados: {
    resort: null, cidade_resort: 'Gramado', ano_compra: 2022, valor_contrato: 68000, valor_parcela: 1100,
    num_parcelas: 60, parcelas_pagas: 30, valor_pago_estimado: 33000, situacao_pagamento: 'inadimplente',
    ja_tentou_distrato: false, proposta_do_resort: 'devolver 10%', qtd_titulares: 2,
    titulares_ausentes: 'esposa', tipo_acao_sugerido: 'Cancelamento de contrato', honorarios_apresentados: 'R$ 2.500 em 5x + 20%',
  },
  incertezas: ['parcelas_pagas: "umas 30"'],
  temperatura: 'morna',
  objecoes: ['decidir com a esposa'],
  proximo_passo: { descricao: 'cliente envia documentos', responsavel: 'cliente', prazo: '2026-10-17' },
  documentos_pendentes: ['contrato'],
  perguntas_nao_feitas: ['nome do resort'],
  alertas: [
    { tipo: 'compliance', gravidade: 'alta', descricao: 'promessa de resultado', trecho: 'a gente garante' },
    { tipo: 'risco_perda', gravidade: 'media', descricao: 'resort ofereceu acordo', trecho: null },
  ],
  nota_kommo: '  Contrato de 2022 em Gramado.  ',
});

// Regras do structured outputs: todo objeto com additionalProperties:false e todas as
// propriedades em required. Um campo novo esquecido no required vira 400 em producao.
function conferirObjetos(no, caminho = 'raiz') {
  if (no && no.type === 'object') {
    expect(no.additionalProperties, `${caminho}: additionalProperties`).toBe(false);
    expect([...no.required].sort(), `${caminho}: required`).toEqual(Object.keys(no.properties).sort());
    for (const [k, v] of Object.entries(no.properties)) conferirObjetos(v, `${caminho}.${k}`);
  }
  if (no && no.type === 'array') conferirObjetos(no.items, `${caminho}[]`);
}

describe('SCHEMA do resumo', () => {
  it('segue as regras de structured outputs em todos os niveis', () => {
    conferirObjetos(SCHEMA);
  });
  it('nao usa restricoes que o structured outputs nao aceita', () => {
    const txt = JSON.stringify(SCHEMA);
    for (const proibido of ['minimum', 'maximum', 'minLength', 'maxLength', '$ref']) {
      expect(txt).not.toContain(`"${proibido}"`);
    }
  });
  it('o exemplo valido passa no validador e corta espacos da nota', () => {
    const r = validarResumo(resumoValido());
    expect(r.nota_kommo).toBe('Contrato de 2022 em Gramado.');
  });
});

describe('validarResumo', () => {
  it('recusa resposta vazia, sem dados ou com temperatura fora da lista', () => {
    expect(() => validarResumo(null)).toThrow();
    expect(() => validarResumo({ ...resumoValido(), dados: null })).toThrow(/dados/);
    expect(() => validarResumo({ ...resumoValido(), temperatura: 'gelada' })).toThrow(/temperatura/);
    expect(() => validarResumo({ ...resumoValido(), houve_atendimento: 'sim' })).toThrow(/houve_atendimento/);
  });
  it('limita o tamanho da nota', () => {
    const r = validarResumo({ ...resumoValido(), nota_kommo: 'x'.repeat(5000) });
    expect(r.nota_kommo.length).toBe(1500);
  });
});

describe('portao da transcricao', () => {
  it('pula transcricao curta (cliente entrou e saiu) e longa (call esquecida aberta)', () => {
    expect(motivoParaPular('')).toBe('transcricao_curta');
    expect(motivoParaPular('a'.repeat(MIN_CARACTERES - 1))).toBe('transcricao_curta');
    expect(motivoParaPular('a'.repeat(MAX_CARACTERES + 1))).toBe('transcricao_longa');
    expect(motivoParaPular('a'.repeat(MIN_CARACTERES + 10))).toBeNull();
  });
});

describe('data da chamada em BRT', () => {
  it('call as 22h BRT continua no mesmo dia (UTC ja virou)', () => {
    // 2026-10-16T01:00Z = 15/10 22h BRT, quinta-feira
    expect(dataDaChamada('2026-10-16T01:00:00Z')).toEqual({ iso: '2026-10-15', diaSemana: 'quinta-feira' });
  });
  it('data invalida vira null', () => {
    expect(dataDaChamada('nada')).toBeNull();
  });
  it('o pedido leva data, dia da semana, vendedora e a transcricao delimitada', () => {
    const p = montarPedido({ vendedora: 'marianamaciel@advocaciacbc.com', clienteNome: 'Marcelo', scheduledAt: '2026-10-15T17:00:00Z' }, '  oi  ');
    expect(p).toContain('2026-10-15 (quinta-feira)');
    expect(p).toContain('marianamaciel@advocaciacbc.com');
    expect(p).toContain('<transcricao>\noi\n</transcricao>');
  });
});

describe('nota do Kommo e alertas', () => {
  it('marcador e um por videochamada', () => {
    expect(marcadorKommo('abc123')).toBe('CBC.call:abc123');
  });
  it('cabecalho com data BR e primeiro nome da vendedora, sem alerta de compliance no texto', () => {
    const r = validarResumo(resumoValido());
    const t = textoNotaKommo(r, { vendedora: 'marianamaciel@advocaciacbc.com', scheduledAt: '2026-10-15T17:00:00Z' });
    expect(t.startsWith('📞 Videochamada 15/10/2026 (marianamaciel), resumo automático')).toBe(true);
    expect(t).toContain('Contrato de 2022 em Gramado.');
    expect(t).not.toContain('garante');
  });
  it('vao para a gestao: todo compliance e qualquer gravidade alta', () => {
    const a = alertasGestao(validarResumo(resumoValido()));
    expect(a.map((x) => x.tipo)).toEqual(['compliance']);
  });
  it('as instrucoes mandam deixar alerta de compliance fora da nota e proibem dado pessoal', () => {
    expect(SISTEMA).toMatch(/Sem os alertas de compliance/);
    expect(SISTEMA).toMatch(/Sem CPF, RG/);
  });
});

describe('custo estimado', () => {
  it('modelo padrao tem preco cadastrado', () => {
    expect(PRECOS[MODELO_PADRAO]).toBeDefined();
  });
  it('14 mil de entrada e 3 mil de saida no Opus 5.5 ~ US$ 0,116', () => {
    expect(custoUsd({ input_tokens: 14000, output_tokens: 3000 }, 'claude-opus-5-5')).toBe(0.116);
  });
  it('modelo desconhecido nao inventa custo', () => {
    expect(custoUsd({ input_tokens: 1 }, 'outro')).toBeNull();
  });
});

describe('googleSa (partes puras)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const chave = {
    client_email: 'cbc-transcricoes@projeto.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  it('JWT assinado em RS256 com sujeito, escopos so de leitura e validade de 1h', () => {
    const jwt = montarJwt(chave, 'beatriz@advocaciacbc.com', 1000);
    const [cab, corpo, ass] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    expect(claims).toMatchObject({ iss: chave.client_email, sub: 'beatriz@advocaciacbc.com', iat: 1000, exp: 4600, aud: chave.token_uri });
    expect(claims.scope.split(' ')).toEqual(ESCOPOS);
    for (const e of ESCOPOS) expect(e).toMatch(/readonly$/);
    const ok = createVerify('RSA-SHA256').update(`${cab}.${corpo}`).verify(publicKey, Buffer.from(ass, 'base64url'));
    expect(ok).toBe(true);
  });

  it('le a chave em JSON puro ou base64, e recusa chave incompleta', () => {
    const json = JSON.stringify(chave);
    expect(lerChave(json).client_email).toBe(chave.client_email);
    expect(lerChave(Buffer.from(json).toString('base64')).client_email).toBe(chave.client_email);
    expect(lerChave('')).toBeNull();
    expect(() => lerChave('{"client_email":"x"}')).toThrow(/private_key/);
  });

  it('so impersona vendedoras da lista (a chave le o Drive do dominio inteiro)', () => {
    expect(exigirVendedora('Beatriz@AdvocaciaCBC.com')).toBe('beatriz@advocaciacbc.com');
    expect(() => exigirVendedora('paulo@advocaciacbc.com')).toThrow(/recusada/);
    expect(() => exigirVendedora('')).toThrow(/recusada/);
  });

  it('prefere a transcricao as anotacoes do Gemini e ignora o que nao e Doc', () => {
    const doc = 'application/vnd.google-apps.document';
    expect(escolherAnexo([
      { fileId: 'g', title: 'Anotações do Gemini', mimeType: doc },
      { fileId: 'v', title: 'Gravação', mimeType: 'video/mp4' },
      { fileId: 't', title: 'Call Marcelo - Transcrição', mimeType: doc },
    ])).toEqual({ fileId: 't', titulo: 'Call Marcelo - Transcrição', tipo: 'transcricao' });
    expect(escolherAnexo([{ fileId: 'g', title: 'Anotações do Gemini', mimeType: doc }]).tipo).toBe('anotacoes_gemini');
    expect(escolherAnexo([{ fileId: 'v', title: 'Transcrição', mimeType: 'video/mp4' }])).toBeNull();
    expect(escolherAnexo(undefined)).toBeNull();
  });
});
