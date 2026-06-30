import { describe, it, expect } from 'vitest';
import {
  avaliarElegibilidade, renderMensagem, dedupeKey, resumirPreview, MATCH_OK,
} from '../../../netlify/functions/_lib/cobranca.mjs';

const HOJE = '2026-06-29';
const base = {
  cpf: '111.222.333-44', customer_name: 'Maria Aparecida Silva', total_em_aberto: 900,
  ancora_link: 'https://asaas.com/i/abc', ancora_pix: 'PIX123',
  lead_id: 555, match_source: 'clientes_cpf',
  ultimo_disparo_em: null, ultimo_pago: null,
};

describe('cobranca — elegibilidade', () => {
  it('elegivel quando tem lead de alta confianca e sem disparo recente', () => {
    expect(avaliarElegibilidade(base, { cooldown_dias: 5 }, HOJE)).toEqual({ elegivel: true, motivo: null });
  });

  it('sem_lead quando lead_id ausente', () => {
    expect(avaliarElegibilidade({ ...base, lead_id: null, match_source: 'sem_lead' }, {}, HOJE))
      .toEqual({ elegivel: false, motivo: 'sem_lead' });
  });

  it('sem_lead quando match e telefone_ambiguo (mesmo com lead_id)', () => {
    expect(avaliarElegibilidade({ ...base, lead_id: 999, match_source: 'telefone_ambiguo' }, {}, HOJE))
      .toEqual({ elegivel: false, motivo: 'sem_lead' });
  });

  it('opt_out quando o cpf esta na lista (compara so digitos)', () => {
    const cfg = { optout_cpfs: ['11122233344'] };
    expect(avaliarElegibilidade(base, cfg, HOJE)).toEqual({ elegivel: false, motivo: 'opt_out' });
  });

  it('cooldown quando ultimo disparo nao-pago dentro da janela', () => {
    const dev = { ...base, ultimo_disparo_em: '2026-06-27T10:00:00Z', ultimo_pago: false };
    expect(avaliarElegibilidade(dev, { cooldown_dias: 5 }, HOJE)).toEqual({ elegivel: false, motivo: 'cooldown' });
  });

  it('NAO cooldown se o ultimo disparo ja foi pago (pode cobrar de novo nova divida)', () => {
    const dev = { ...base, ultimo_disparo_em: '2026-06-27T10:00:00Z', ultimo_pago: true };
    expect(avaliarElegibilidade(dev, { cooldown_dias: 5 }, HOJE)).toEqual({ elegivel: true, motivo: null });
  });

  it('NAO cooldown se passou da janela', () => {
    const dev = { ...base, ultimo_disparo_em: '2026-06-10T10:00:00Z', ultimo_pago: false };
    expect(avaliarElegibilidade(dev, { cooldown_dias: 5 }, HOJE)).toEqual({ elegivel: true, motivo: null });
  });
});

describe('cobranca — mensagem e dedupe', () => {
  it('renderMensagem usa template custom e troca placeholders', () => {
    const tpl = { corpo: '{{nome}}, deves {{valor}}. Pague: {{link}} ou PIX {{pix}}' };
    const msg = renderMensagem(base, tpl, HOJE);
    expect(msg).toBe('Maria, deves R$ 900,00. Pague: https://asaas.com/i/abc ou PIX PIX123');
  });

  it('renderMensagem usa primeiro nome e template padrao quando sem corpo', () => {
    const msg = renderMensagem(base, {}, HOJE);
    expect(msg).toContain('Ola Maria!');
    expect(msg).toContain('R$ 900,00');
    expect(msg).toContain('https://asaas.com/i/abc');
  });

  it('dedupeKey normaliza cpf e usa o dia', () => {
    expect(dedupeKey('111.222.333-44', 'lembrete', '2026-06-29')).toBe('cobranca:11122233344:lembrete:20260629');
  });
});

describe('cobranca — resumo do preview', () => {
  it('conta enviaveis e pulados por motivo', () => {
    const devs = [
      base,                                                              // enviar
      { ...base, cpf: '2', lead_id: null, match_source: 'sem_lead' },    // sem_lead
      { ...base, cpf: '3', match_source: 'telefone_ambiguo', lead_id: 7 }, // sem_lead
      { ...base, cpf: '4', ultimo_disparo_em: '2026-06-28T10:00:00Z', ultimo_pago: false }, // cooldown
    ];
    const r = resumirPreview(devs, { cooldown_dias: 5 }, HOJE);
    expect(r.enviar).toBe(1);
    expect(r.pulados).toEqual({ sem_lead: 2, cooldown: 1 });
  });

  it('MATCH_OK nao inclui telefone_ambiguo nem sem_lead', () => {
    expect(MATCH_OK.has('telefone')).toBe(true);
    expect(MATCH_OK.has('telefone_ambiguo')).toBe(false);
    expect(MATCH_OK.has('sem_lead')).toBe(false);
  });
});
