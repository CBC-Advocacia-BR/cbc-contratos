import { describe, it, expect } from 'vitest';
import { montarLembrete } from '../dossieLembrete.mjs';
import { quandoPorExtenso } from '../dossieVideochamada.mjs';

const QUANDO = quandoPorExtenso('2026-08-13T13:30:00Z');   // 10h30 BRT
const MEET = 'https://meet.google.com/abc-defg-hij';
const base = (extra = {}) => montarLembrete({
  nome: 'Sueli', quando: QUANDO, meetLink: MEET, config: {}, ...extra,
});

describe('assunto', () => {
  it('diz HOJE e a hora, que e o que faz abrir no celular', () => {
    expect(base().assunto).toBe('Sua videochamada é hoje às 10h30');
  });

  it('e trocavel sem deploy', () => {
    const r = base({ config: { assunto_lembrete: '{{primeiro_nome}}, é hoje às {{hora}}' } });
    expect(r.assunto).toBe('Sueli, é hoje às 10h30');
  });
});

describe('corpo', () => {
  it('poe o link do Meet como botao principal', () => {
    const h = base().html;
    expect(h).toContain(MEET);
    expect(h).toContain('Entrar na videochamada');
  });

  it('pede para testar o link antes', () => {
    expect(base().html).toContain('Teste o link agora');
    expect(base().texto).toContain('Teste o link agora');
  });

  it('pede ambiente calmo e bom sinal, com o motivo junto', () => {
    const h = base().html;
    expect(h).toContain('lugar tranquilo e com bom sinal');
    expect(h).toContain('ouvir bem o seu caso faz diferença');
  });

  it('oferece remarcar pelo WhatsApp', () => {
    const h = base().html;
    expect(h).toContain('(19) 98805-1878');
    expect(h).toContain('https://wa.me/5519988051878');
    expect(h).toContain('Não vai conseguir?');
  });

  it('repete a duracao nova, nao a antiga', () => {
    expect(base().html).toContain('10 a 15 minutos');
    expect(base().html).not.toContain('30 minutos');
  });

  it('funciona sem o link do Meet, sem botao quebrado', () => {
    // ate a sincronizacao passar a guardar o link, ou se o evento perder a
    // conferencia, o lembrete ainda precisa servir
    const r = base({ meetLink: null });
    expect(r.html).not.toContain('Entrar na videochamada');
    expect(r.html).toContain('convite que chegou na sua agenda');
    expect(r.html).not.toContain('href="null"');
    expect(r.texto).not.toContain('null');
  });

  it('funciona sem nome', () => {
    const r = base({ nome: null });
    expect(r.html).toContain('Olá!');
    expect(r.html).not.toContain('undefined');
  });

  it('escapa o nome', () => {
    expect(base({ nome: '<b>x</b>' }).html).toContain('&lt;b&gt;');
  });

  it('nao leva anexo nenhum mencionado', () => {
    // o dossie ja foi no agendamento; 4 MB no dia da reuniao so atrapalha
    expect(base().html).not.toContain('anexo');
    expect(base().texto).not.toContain('anexo');
  });

  it('nunca usa travessao', () => {
    const r = base();
    expect(r.assunto + r.html + r.texto).not.toMatch(/[—–]/);
  });

  it('tem versao em texto puro', () => {
    const t = base().texto;
    expect(t).toContain('HOJE às 10h30');
    expect(t).toContain(MEET);
    expect(t).not.toMatch(/<[a-z]/i);
  });
});
