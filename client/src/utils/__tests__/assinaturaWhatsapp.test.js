// Disparo de links de assinatura via Kommo/WhatsApp (02/07/2026).
// Protege as regras aprovadas pelo Paulo:
//  - mesmo lead p/ 2 contratantes => UMA mensagem com os dois links (nunca duplicar)
//  - janela de 24h com margem de seguranca (fora => nao envia, aviso manual)
// Fonte: netlify/functions/_lib/assinaturaWhatsapp.mjs (modulo PURO, padrao advboxMaps).
import { describe, it, expect } from 'vitest';
import {
  extrairLeadIdAssinatura, primeiroNome, parearSigners,
  agruparPorLead, montarMensagem, janelaAberta,
} from '../../../netlify/functions/_lib/assinaturaWhatsapp.mjs';

const CFG = { msg_1: 'Olá, {nome}! Link: {link}', msg_2: 'Links:\n{links}' };

describe('extrairLeadIdAssinatura', () => {
  it('extrai o id de uma URL de lead', () => {
    expect(extrairLeadIdAssinatura('https://advocaciacbc.kommo.com/leads/detail/5663306')).toBe('5663306');
    expect(extrairLeadIdAssinatura('https://advocaciacbc.kommo.com/leads/detail/123/')).toBe('123');
  });
  it('aceita digitos puros', () => {
    expect(extrairLeadIdAssinatura('987')).toBe('987');
  });
  it('rejeita links que nao sao de lead', () => {
    expect(extrairLeadIdAssinatura('https://advocaciacbc.kommo.com/contacts/detail/5')).toBe(null);
    expect(extrairLeadIdAssinatura('')).toBe(null);
    expect(extrairLeadIdAssinatura(null)).toBe(null);
  });
});

describe('primeiroNome', () => {
  it('capitaliza o primeiro nome', () => {
    expect(primeiroNome('MARIA APARECIDA SOUZA')).toBe('Maria');
    expect(primeiroNome('  joão carlos ')).toBe('João');
  });
  it('fallback para vazio', () => {
    expect(primeiroNome('')).toBe('Cliente');
    expect(primeiroNome(null)).toBe('Cliente');
  });
});

describe('parearSigners', () => {
  const contratantes = [
    { nome: 'Maria Aparecida Souza', email: 'maria@gmail.com', linkKommo: 'https://advocaciacbc.kommo.com/leads/detail/111' },
    { nome: 'João Carlos Souza', email: 'joao@hotmail.com', linkKommo: 'https://advocaciacbc.kommo.com/leads/detail/222' },
  ];

  it('casa por e-mail mesmo com ordem embaralhada', () => {
    const signers = [
      { name: 'João Carlos Souza', email: 'JOAO@hotmail.com', sign_url: 'https://zs/b' },
      { name: 'Maria Aparecida Souza', email: 'maria@gmail.com', sign_url: 'https://zs/a' },
    ];
    const pares = parearSigners(signers, contratantes);
    expect(pares[0].contratante.nome).toBe('João Carlos Souza');
    expect(pares[0].leadId).toBe('222');
    expect(pares[1].leadId).toBe('111');
  });

  it('PJ: casa pelo e-mail da empresa (emailEmpresa)', () => {
    const cs = [{ nome: 'Ana Rep Legal', tipo: 'pj', email: 'ana@pessoal.com', emailEmpresa: 'contato@empresa.com', linkKommo: 'https://advocaciacbc.kommo.com/leads/detail/333' }];
    const signers = [{ name: 'Ana Rep Legal', email: 'contato@empresa.com', sign_url: 'https://zs/c' }];
    const pares = parearSigners(signers, cs);
    expect(pares[0].leadId).toBe('333');
  });

  it('fallback por nome quando e-mails divergem', () => {
    const signers = [{ name: 'maria aparecida souza', email: 'outro@x.com', sign_url: 'https://zs/a' }];
    const pares = parearSigners(signers, contratantes);
    expect(pares[0].contratante.nome).toBe('Maria Aparecida Souza');
  });

  it('fallback por indice quando nada casa', () => {
    const signers = [
      { name: 'X', email: 'x@x.com', sign_url: 'https://zs/a' },
      { name: 'Y', email: 'y@y.com', sign_url: 'https://zs/b' },
    ];
    const pares = parearSigners(signers, contratantes);
    expect(pares[0].contratante.nome).toBe('Maria Aparecida Souza');
    expect(pares[1].contratante.nome).toBe('João Carlos Souza');
  });

  it('aceita signUrl como alias de sign_url', () => {
    const signers = [{ name: 'Maria Aparecida Souza', email: 'maria@gmail.com', signUrl: 'https://zs/alias' }];
    const pares = parearSigners(signers, contratantes);
    expect(pares[0].link).toBe('https://zs/alias');
  });
});

describe('agruparPorLead', () => {
  const mk = (nome, link, leadId) => ({
    signer: { name: nome }, link,
    contratante: { nome }, leadId,
  });

  it('mesmo lead para os dois => UM grupo com os dois links (regra do Paulo)', () => {
    const { grupos, invalidos } = agruparPorLead([
      mk('Maria Aparecida Souza', 'https://zs/a', '111'),
      mk('João Carlos Souza', 'https://zs/b', '111'),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].leadId).toBe('111');
    expect(grupos[0].itens).toHaveLength(2);
    expect(invalidos).toHaveLength(0);
  });

  it('leads distintos => um grupo por lead', () => {
    const { grupos } = agruparPorLead([
      mk('Maria', 'https://zs/a', '111'),
      mk('João', 'https://zs/b', '222'),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map(g => g.leadId)).toEqual(['111', '222']);
  });

  it('mesmo lead + mesmo link => nao duplica item', () => {
    const { grupos } = agruparPorLead([
      mk('Maria', 'https://zs/a', '111'),
      mk('Maria', 'https://zs/a', '111'),
    ]);
    expect(grupos[0].itens).toHaveLength(1);
  });

  it('sem leadId valido => vai para invalidos', () => {
    const { grupos, invalidos } = agruparPorLead([
      mk('Maria', 'https://zs/a', null),
    ]);
    expect(grupos).toHaveLength(0);
    expect(invalidos).toEqual(['Maria']);
  });

  it('signer sem link nao entra no grupo', () => {
    const { grupos, invalidos } = agruparPorLead([
      mk('Maria', '', '111'),
    ]);
    expect(grupos).toHaveLength(0);
    expect(invalidos).toEqual(['Maria']);
  });
});

describe('montarMensagem', () => {
  it('1 link usa msg_1 com nome e link', () => {
    const msg = montarMensagem([{ nome: 'MARIA APARECIDA', link: 'https://zs/a' }], CFG);
    expect(msg).toBe('Olá, Maria! Link: https://zs/a');
  });
  it('2 links usa msg_2 com uma linha por pessoa (os dois links presentes)', () => {
    const msg = montarMensagem([
      { nome: 'Maria Aparecida', link: 'https://zs/a' },
      { nome: 'João Carlos', link: 'https://zs/b' },
    ], CFG);
    expect(msg).toContain('https://zs/a');
    expect(msg).toContain('https://zs/b');
    expect(msg).toContain('*Maria*');
    expect(msg).toContain('*João*');
    expect(msg).not.toContain('{links}');
    expect(msg.split('\n')).toHaveLength(3); // 'Links:' + 2 linhas
  });
});

describe('janelaAberta', () => {
  const now = '2026-07-02T14:00:00.000Z';
  const hAtras = (h) => new Date(Date.parse(now) - h * 3600000).toISOString();

  it('mensagem ha 2h => aberta', () => {
    const r = janelaAberta(hAtras(2), now, 60);
    expect(r.aberta).toBe(true);
    expect(r.horas).toBeCloseTo(2, 1);
  });
  it('mensagem ha 23h30 com margem de 60min => fechada (23h de limite util)', () => {
    expect(janelaAberta(hAtras(23.5), now, 60).aberta).toBe(false);
  });
  it('mensagem ha 22h59 com margem de 60min => aberta', () => {
    expect(janelaAberta(hAtras(22.98), now, 60).aberta).toBe(true);
  });
  it('sem mensagem => fechada', () => {
    expect(janelaAberta(null, now, 60)).toEqual({ aberta: false, horas: null });
    expect(janelaAberta(undefined, now, 60).aberta).toBe(false);
  });
  it('timestamp invalido => fechada', () => {
    expect(janelaAberta('abc', now, 60).aberta).toBe(false);
  });
  it('aceita epoch em segundos (formato dos events do Kommo)', () => {
    const epochSec = Math.floor((Date.parse(now) - 2 * 3600000) / 1000);
    expect(janelaAberta(epochSec, now, 60).aberta).toBe(true);
  });
});
