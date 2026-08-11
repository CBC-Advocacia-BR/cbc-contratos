import { useEffect, useState } from 'react';
import { carregarConfig, salvarConfig } from './api';

/**
 * Parametros da operacao do SDR. So socios editam; o SDR ve e nao muda.
 *
 * Os pesos da nota ficam aqui de proposito: a formula esta em avaliacao, e enquanto nao
 * fechar, mudar um numero nesta tela recalcula a fila inteira sem precisar de deploy.
 */
const CAMPOS = [
  { grupo: 'Atendimento', itens: [
    { k: 'grade_inicio', r: 'Começa', tipo: 'time' },
    { k: 'grade_fim', r: 'Termina', tipo: 'time' },
    { k: 'sla_meta_min', r: 'Meta de SLA (min)', tipo: 'number' },
    { k: 'segura_horario_ate', r: 'Segura o horário até', tipo: 'time' },
    { k: 'max_remarcacoes', r: 'Máximo de remarcações', tipo: 'number' },
  ] },
  { grupo: 'Pontuação do lead', itens: [
    { k: 'peso_valor', r: 'Peso do valor pago', tipo: 'number' },
    { k: 'peso_resort', r: 'Peso do resort', tipo: 'number' },
    { k: 'peso_quitado', r: 'Peso da cota quitada', tipo: 'number' },
    { k: 'piso_valor', r: 'Piso de valor que conta como alto', tipo: 'number' },
    { k: 'limiar_topo', r: 'Nota a partir da qual vai para o topo', tipo: 'number' },
  ] },
  { grupo: 'Disparos', itens: [
    { k: 'teto_disparo_dia', r: 'Teto por dia', tipo: 'number' },
    { k: 'dias_reinclusao', r: 'Não repetir antes de (dias)', tipo: 'number' },
  ] },
];

export default function ConfigSdr({ podeEditar, onSalvo }) {
  const [cfg, setCfg] = useState(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    let vivo = true;
    carregarConfig()
      .then((d) => { if (vivo) setCfg(d); })
      .catch((e) => { if (vivo) setErro('Não consegui carregar a configuração. ' + (e?.message || '')); });
    return () => { vivo = false; };
  }, []);

  const gravar = async () => {
    setSalvando(true); setErro(''); setAviso('');
    try {
      await salvarConfig(cfg);
      setAviso('Configuração salva. A nota da fila já usa os valores novos.');
      onSalvo?.(cfg);
    } catch (e) {
      setErro('Não consegui salvar. ' + (e?.message || ''));
    } finally {
      setSalvando(false);
    }
  };

  if (erro && !cfg) {
    return <div className="p-4 rounded-xl text-sm"
      style={{ background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>{erro}</div>;
  }
  if (!cfg) return <div className="p-6" style={{ color: 'var(--cbc-text-muted)' }}>Carregando...</div>;

  return (
    <div className="card overflow-hidden max-w-[900px]">
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--cbc-border)' }}>
        <h2 className="font-bold">Configuração</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>
          {podeEditar ? 'Só Paulo, Bruno e Lorenza editam.' : 'Você vê os parâmetros, mas quem edita são os sócios.'}
        </p>
      </div>

      <div className="px-4 py-3 text-[12px] flex items-start gap-2 border-b"
        style={{ background: 'var(--cbc-warning-bg)', borderColor: 'var(--cbc-warning-border)', color: 'var(--cbc-warning)' }}>
        <span aria-hidden="true">⚠</span>
        <span>
          <strong>A fórmula da nota ainda está em avaliação.</strong> Os pesos abaixo são um rascunho
          para a tela ter o que mostrar. Enquanto não fechar, o selo exibe <strong>“a apurar”</strong> para
          quem não tem resort nem valor, em vez de inventar um número. O histórico de faltas
          <strong> não entra na nota</strong>, por decisão de 11/08: faltar pode ter sido falha do processo,
          já que nenhum lembrete jamais foi enviado nos 2.938 agendamentos do histórico.
        </span>
      </div>

      {CAMPOS.map(({ grupo, itens }) => (
        <div key={grupo} className="px-4 py-3 border-b" style={{ borderColor: 'var(--cbc-border)' }}>
          <span className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--cbc-text-muted)' }}>{grupo}</span>
          <div className="grid gap-3 mt-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            {itens.map(({ k, r, tipo }) => (
              <label key={k} className="block">
                <span className="block text-[10.5px] font-bold uppercase tracking-wide mb-1"
                  style={{ color: 'var(--cbc-text-muted)' }}>{r}</span>
                <input type={tipo} value={cfg[k] ?? ''} disabled={!podeEditar}
                  onChange={(e) => setCfg({ ...cfg, [k]: tipo === 'number' ? Number(e.target.value) : e.target.value })}
                  className="input-field w-full" />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--cbc-border)' }}>
        <span className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--cbc-text-muted)' }}>Resorts prioritários</span>
        <div className="flex gap-1.5 flex-wrap mt-2">
          {(cfg.resorts_prioritarios || []).map((r) => (
            <span key={r} className="text-[11px] font-bold px-2 py-0.5 rounded-full border"
              style={{ background: 'var(--cbc-success-bg)', borderColor: 'var(--cbc-success-border)', color: 'var(--cbc-success)' }}>
              {r}
            </span>
          ))}
          <span className="text-[11px] px-2 py-0.5" style={{ color: 'var(--cbc-text-muted)' }}>
            Hot Beach comum fica fora de propósito: fecha 5,8%.
          </span>
        </div>
      </div>

      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        {aviso && <span className="text-xs" style={{ color: 'var(--cbc-success)' }}>{aviso}</span>}
        {erro && <span className="text-xs" style={{ color: 'var(--cbc-danger)' }}>{erro}</span>}
        <span className="text-[11px] ml-auto" style={{ color: 'var(--cbc-text-muted)' }}>
          Toda alteração fica registrada com quem mudou e quando.
        </span>
        <button type="button" className="btn btn-primary" disabled={!podeEditar || salvando} onClick={gravar}>
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
