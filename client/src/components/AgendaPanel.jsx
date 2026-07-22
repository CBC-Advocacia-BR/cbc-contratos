// Aba "Agendamento Videochamada" — bot Ana (Task 12). Shell + 8 sub-abas.
// Estrutura conforme o esqueleto do brief (.superpowers/sdd/task-12-brief.md, Step 1):
// mesmos hooks/nomes/fluxo; únicos ajustes são 2 nomes de token CSS que não existem em
// index.css (--cbc-text/--cbc-primary) trocados pelos equivalentes reais, com fallback
// hex (mesmo padrão de TrafegoPanel/AdminPanel — nunca hex "solto" fora de um var()).
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ConfigMensagens, ConfigRegras, ConfigVendedoras, ConfigGeral } from './agenda/ConfigForms';
import { MetricasView, AgendaView, ConversasView, SimuladorView } from './agenda/AgendaViews';

const SUBS = [
  ['metricas', 'Métricas'], ['agenda', 'Agenda'], ['conversas', 'Conversas'], ['simulador', 'Simulador'],
  ['mensagens', 'Mensagens'], ['regras', 'Regras'], ['vendedoras', 'Vendedoras'], ['config', 'Config'],
];

export default function AgendaPanel() {
  const [sub, setSub] = useState('metricas');
  const [cfg, setCfg] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('bot_config').select('value').eq('key', 'agenda_bot').single();
    if (error) setErro(error.message); else setCfg(data.value);
  }, []);
  // fetch inicial via efeito (mesmo padrao dos demais paineis do projeto — BotConfig/BotMetricas)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregar(); }, [carregar]);

  const salvarCfg = useCallback(async (novo) => {
    setSalvando(true);
    const { error } = await supabase.from('bot_config')
      .update({ value: novo, updated_at: new Date().toISOString() }).eq('key', 'agenda_bot');
    setSalvando(false);
    if (error) { setErro(error.message); return false; }
    setCfg(novo); return true;
  }, []);

  const chamarAdmin = useCallback(async (body) => {
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch('/.netlify/functions/agenda-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.session?.access_token || ''}` },
      body: JSON.stringify(body),
    });
    return r.json();
  }, []);

  if (erro) return <div className="p-6" style={{ color: 'var(--cbc-danger, #B91C1C)' }}>Erro: {erro}</div>;
  if (!cfg) return <div className="p-6" style={{ color: 'var(--cbc-text-muted, #5E6675)' }}>Carregando…</div>;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6" style={{ color: 'var(--cbc-text-primary, #1B3A5C)' }}>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold">Agendamento Videochamada — Ana</h1>
        <span className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: cfg.ativo ? 'var(--cbc-success, #15803D)' : 'var(--cbc-warning, #B45309)', color: 'var(--cbc-bg, #F0F4F8)' }}>
          {cfg.ativo ? (cfg.modo_teste ? 'ATIVA (modo teste)' : 'ATIVA') : 'DESLIGADA'}
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto mb-4 border-b" style={{ borderColor: 'var(--cbc-border, #E2E8F0)' }}>
        {SUBS.map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`px-3 py-2 text-sm whitespace-nowrap cursor-pointer ${sub === k ? 'font-semibold border-b-2' : ''}`}
            style={sub === k ? { borderColor: 'var(--cbc-navy, #1B3A5C)' } : {}}>{label}</button>
        ))}
      </div>
      {sub === 'metricas' && <MetricasView />}
      {sub === 'agenda' && <AgendaView chamarAdmin={chamarAdmin} />}
      {sub === 'conversas' && <ConversasView chamarAdmin={chamarAdmin} />}
      {sub === 'simulador' && <SimuladorView chamarAdmin={chamarAdmin} cfg={cfg} />}
      {sub === 'mensagens' && <ConfigMensagens cfg={cfg} salvar={salvarCfg} salvando={salvando} />}
      {sub === 'regras' && <ConfigRegras cfg={cfg} salvar={salvarCfg} salvando={salvando} />}
      {sub === 'vendedoras' && <ConfigVendedoras cfg={cfg} salvar={salvarCfg} salvando={salvando} />}
      {sub === 'config' && <ConfigGeral cfg={cfg} salvar={salvarCfg} salvando={salvando} />}
    </div>
  );
}
