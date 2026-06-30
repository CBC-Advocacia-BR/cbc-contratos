// (#8/#9) Protege o mapeamento ADVBOX (tipo de acao + origem -> ID) — REGRA #10.
// Fonte UNICA: netlify/functions/_lib/advboxMaps.mjs (usado pela function advbox-sync).
// Um erro aqui faz o processo ser aberto com o tipo ERRADO no CRM juridico (caso Edmar).
import { describe, it, expect } from 'vitest';
import { getTipoAcaoId, getOrigemId, TIPO_ACAO_MAP, ORIGEM_MAP } from '../../../netlify/functions/_lib/advboxMaps.mjs';

const OUTROS = 2187483;

describe('getTipoAcaoId — mapeamento fixo (REGRA #10)', () => {
  it('casa os tipos exatos com o ID correto', () => {
    expect(getTipoAcaoId('Acao de cobranca')).toBe(2151644);
    expect(getTipoAcaoId('Cancelamento de contrato')).toBe(2151645);
    expect(getTipoAcaoId('Cota quitada sem matricula')).toBe(2151646);
    expect(getTipoAcaoId('Dano moral')).toBe(2187482);
    expect(getTipoAcaoId('Devolucao 80%')).toBe(2151642);
    expect(getTipoAcaoId('Devolucao 50%')).toBe(2151643);
    expect(getTipoAcaoId('Distrato por atraso')).toBe(2151641);
    expect(getTipoAcaoId('Revisao de Distrato')).toBe(2392340);
    expect(getTipoAcaoId('Execucao Honorarios')).toBe(2182736);
  });

  it('ignora acento e maiusculas (como vem do formulario)', () => {
    expect(getTipoAcaoId('Ação de Cobrança')).toBe(2151644);
    expect(getTipoAcaoId('DANO MORAL')).toBe(2187482);
    expect(getTipoAcaoId('execução honorários')).toBe(2182736);
    expect(getTipoAcaoId('Revisão de Distrato')).toBe(2392340); // o caso do bug do Edmar
  });

  it('Revisao de Distrato NAO cai em Outros nem em Distrato por Atraso', () => {
    expect(getTipoAcaoId('Revisão de Distrato')).not.toBe(OUTROS);
    expect(getTipoAcaoId('Revisão de Distrato')).not.toBe(2151641); // != Distrato por atraso
    // e "Distrato por Atraso" tambem nao pode ser confundido com Revisao
    expect(getTipoAcaoId('Distrato por Atraso')).toBe(2151641);
  });

  it('cai no fallback por palavra-chave', () => {
    expect(getTipoAcaoId('cobranca judicial extra')).toBe(2151644);
    expect(getTipoAcaoId('pedido de dano moral coletivo')).toBe(2187482);
    expect(getTipoAcaoId('rescisao por atraso na obra')).toBe(2151641);
    expect(getTipoAcaoId('cota ja quitada')).toBe(2151646);
    expect(getTipoAcaoId('revisao do distrato assinado')).toBe(2392340);
  });

  it('80/50 ancorados: valor monetario solto NAO vira Devolucao 80/50%', () => {
    expect(getTipoAcaoId('Devolução 80%')).toBe(2151642);
    expect(getTipoAcaoId('Devolução 50%')).toBe(2151643);
    expect(getTipoAcaoId('distrato 80')).toBe(2151642);
    // texto com "80" solto (ex.: um valor) nao deve mapear p/ Devolucao 80%
    expect(getTipoAcaoId('acao indenizatoria de R$ 80 mil')).not.toBe(2151642);
  });

  it('usa Outros para entrada vazia ou desconhecida', () => {
    expect(getTipoAcaoId('')).toBe(OUTROS);
    expect(getTipoAcaoId(null)).toBe(OUTROS);
    expect(getTipoAcaoId(undefined)).toBe(OUTROS);
    expect(getTipoAcaoId('assunto totalmente aleatorio xyz')).toBe(OUTROS);
  });

  it('sempre devolve um numero', () => {
    for (const t of ['Acao de cobranca', 'foo', '', 'Dano moral', 'Revisao de Distrato']) {
      expect(typeof getTipoAcaoId(t)).toBe('number');
    }
  });

  it('todo ID do mapa e um numero positivo e unico', () => {
    const ids = Object.values(TIPO_ACAO_MAP);
    for (const id of ids) expect(Number.isInteger(id) && id > 0).toBe(true);
    expect(new Set(ids).size).toBe(ids.length); // sem IDs duplicados
  });
});

describe('getOrigemId', () => {
  it('reconhece origens conhecidas com o ID certo', () => {
    expect(getOrigemId('Facebook')).toBe(557269);
    expect(getOrigemId('Instagram')).toBe(557271);
    expect(getOrigemId('tráfego pago')).toBe(568498);
  });
  it('desconhecida cai no mesmo ID de Outros', () => {
    expect(getOrigemId('origem inexistente 123')).toBe(ORIGEM_MAP['Outros']);
    expect(getOrigemId('')).toBe(ORIGEM_MAP['Outros']);
  });
});
