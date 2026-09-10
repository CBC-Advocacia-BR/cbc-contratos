// (10/09/2026) Resposta do ZapSign ao lembrete em massa. O 429 `cooldown_period` era
// contado como FALHA: 417 "falhas" em 36 dias e heartbeat vermelho quase toda rodada
// das 16h, sem nenhum lembrete de fato perdido.
import { describe, it, expect } from 'vitest';
import { classificarReenvio } from '../zapsignLembrete.mjs';

// Corpo real gravado no advbox_api_log (o ZapSign escapa acento como í), com um
// sufixo de tempo restante hipotetico: o formato real ainda nao foi visto, porque o
// codigo antigo cortava o texto em 160 caracteres, bem antes dele.
const CORPO_COOLDOWN =
  '{"success": false, "error_code": "cooldown_period", "message": "Aguarde o per\\u00edodo de ' +
  'cooldown para reenviar as notifica\\u00e7\\u00f5es em massa. Tempo restante: 7h 12min"}';

describe('classificarReenvio', () => {
  it('2xx e enviado', () => {
    expect(classificarReenvio(200, '{"success": true}')).toEqual({ tipo: 'enviado' });
  });

  it('429 cooldown_period vira cooldown, nao falha', () => {
    const r = classificarReenvio(429, CORPO_COOLDOWN);
    expect(r.tipo).toBe('cooldown');
    expect(r.mensagem).toContain('período de cooldown');
  });

  it('guarda o tempo restante que o corte de 160 caracteres perdia', () => {
    const r = classificarReenvio(429, CORPO_COOLDOWN);
    expect(r.mensagem).toContain('Tempo restante: 7h 12min');
  });

  it('limita a mensagem a 300 caracteres', () => {
    const longo = JSON.stringify({ error_code: 'cooldown_period', message: 'x'.repeat(1000) });
    expect(classificarReenvio(429, longo).mensagem).toHaveLength(300);
  });

  it('429 sem cooldown_period e limite de conta: continua falha', () => {
    const r = classificarReenvio(429, '{"error_code": "rate_limit", "message": "Too many requests"}');
    expect(r.tipo).toBe('falha');
    expect(r.erro).toMatch(/^ZapSign 429: /);
  });

  it('400 document_not_in_progress continua falha (documento ja fechado no ZapSign)', () => {
    const r = classificarReenvio(400, '{"success": false, "error_code": "document_not_in_progress"}');
    expect(r).toEqual({ tipo: 'falha', erro: 'ZapSign 400: {"success": false, "error_code": "document_not_in_progress"}' });
  });

  it('502 em HTML nao quebra o parse e e falha', () => {
    const r = classificarReenvio(502, '<html><head><title>502 Bad Gateway</title></head></html>');
    expect(r.tipo).toBe('falha');
    expect(r.erro).toMatch(/^ZapSign 502: <html>/);
  });

  it('corpo vazio ou nulo nao quebra', () => {
    expect(classificarReenvio(500, null).tipo).toBe('falha');
    expect(classificarReenvio(429, '').tipo).toBe('falha');
  });
});
