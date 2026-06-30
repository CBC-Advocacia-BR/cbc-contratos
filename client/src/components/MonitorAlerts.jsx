/**
 * MonitorAlerts — Banner de "automação morta" no topo da aba Monitor.
 *
 * Resume, em UMA faixa de fácil leitura, se alguma automação está quebrada ou
 * parada AGORA — para nunca mais ficar dias quebrado sem ninguém ver (lição do
 * token Kommo, 11-12/06: ficou 3 dias em 401 e só aparecia "0 notas Kommo"
 * perdido no log).
 *
 * Agrega 3 sinais que JÁ existem (não cria dependência nova):
 *   1. health.services[] (API.health) com status != ok  -> serviço fora do ar
 *      (inclui o Kommo, que o health.mjs pinga em /account)
 *   2. cron_heartbeat com ok=false                       -> robô falhou
 *   3. advbox_api_log nivel erro/aviso e visto=false (24h, agrupado por mensagem)
 *
 * Read-only: não altera nenhuma automação. Tolerante a tabela vazia / erro de
 * query (as seções somem em silêncio, como os vizinhos do painel).
 */
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  ExclamationTriangleIcon, CheckCircleIcon, ArrowDownIcon,
} from '@heroicons/react/24/outline';

const MAX_ITENS = 8; // limita o tamanho da faixa; o resto vira "+N"

function fmtRel(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)}h`;
  return `há ${Math.round(min / 1440)}d`;
}

export default function MonitorAlerts({ health }) {
  const [logRows, setLogRows] = useState([]);
  const [cronRows, setCronRows] = useState([]);

  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      try {
        const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data } = await supabase.from('advbox_api_log')
          .select('origem, nivel, mensagem, created_at')
          .neq('nivel', 'info')
          .eq('visto', false)
          .gte('created_at', desde)
          .order('created_at', { ascending: false })
          .limit(500);
        if (vivo) setLogRows(data || []);
      } catch { /* silent — some se a tabela nao existir */ }
      try {
        const { data } = await supabase.from('cron_heartbeat')
          .select('job, last_run_at, ok, detail')
          .eq('ok', false)
          .limit(40);
        if (vivo) setCronRows(data || []);
      } catch { /* silent */ }
    };
    carregar();
    const t = setInterval(carregar, 60000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const alerts = useMemo(() => {
    const out = [];
    // 1) serviços fora do ar (health check) — cobre Kommo/ADVBOX/Asaas/ZapSign/Supabase
    for (const s of (health?.services || [])) {
      if (s?.status && s.status !== 'ok') {
        out.push({ level: 'erro', key: `svc:${s.name}`, text: `Serviço ${s.name} indisponível (${s.status})`, hint: 'health check' });
      }
    }
    // 2) crons que falharam (ok=false)
    for (const c of cronRows) {
      out.push({ level: 'erro', key: `cron:${c.job}`, text: `Robô "${c.job}" falhou`, hint: c.detail || '', when: c.last_run_at });
    }
    // 3) erros/avisos não vistos no log (agrupados por origem+mensagem, com contagem)
    const grp = new Map();
    for (const r of logRows) {
      const k = `${r.origem}|${r.mensagem}`;
      let g = grp.get(k);
      if (!g) { g = { level: r.nivel === 'erro' ? 'erro' : 'aviso', origem: r.origem, mensagem: r.mensagem, count: 0, when: r.created_at }; grp.set(k, g); }
      g.count += 1;
    }
    for (const g of grp.values()) {
      out.push({ level: g.level, key: `log:${g.origem}:${g.mensagem}`, text: `${g.origem}: ${g.mensagem}`, count: g.count, when: g.when });
    }
    // erros primeiro; dentro do nível, mais recorrentes/recentes primeiro
    out.sort((a, b) => {
      if (a.level !== b.level) return a.level === 'erro' ? -1 : 1;
      return (b.count || 0) - (a.count || 0);
    });
    return out;
  }, [health, cronRows, logRows]);

  const nErros = alerts.filter(a => a.level === 'erro').length;
  const nAvisos = alerts.length - nErros;
  const nivel = nErros ? 'erro' : nAvisos ? 'aviso' : 'ok';

  // tudo certo — faixa fina verde (confirma que o monitor está olhando)
  if (nivel === 'ok') {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
        <CheckCircleIcon className="w-5 h-5 text-green-600 shrink-0" aria-hidden="true" />
        <span className="text-[12px] font-semibold text-green-800">Automações operando normalmente — nenhum erro ou serviço fora do ar.</span>
      </div>
    );
  }

  const ehErro = nivel === 'erro';
  const wrap = ehErro
    ? 'border-red-300 bg-red-50'
    : 'border-amber-300 bg-amber-50';
  const titleColor = ehErro ? 'text-red-800' : 'text-amber-800';
  const iconColor = ehErro ? 'text-red-600' : 'text-amber-600';
  const visiveis = alerts.slice(0, MAX_ITENS);
  const resto = alerts.length - visiveis.length;

  const titulo = ehErro
    ? `Ação necessária — ${nErros} ${nErros === 1 ? 'problema' : 'problemas'}${nAvisos ? ` + ${nAvisos} aviso(s)` : ''}`
    : `Atenção — ${nAvisos} aviso(s)`;

  return (
    <div className={`mb-4 rounded-xl border ${wrap} px-4 py-3`}>
      <div className="flex items-center gap-2 mb-2">
        <ExclamationTriangleIcon className={`w-5 h-5 ${iconColor} shrink-0`} aria-hidden="true" />
        <span className={`text-[13px] font-bold ${titleColor}`}>{titulo}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500">
          <ArrowDownIcon className="w-3 h-3" aria-hidden="true" /> detalhes abaixo (console / farol)
        </span>
      </div>
      <ul className="space-y-1">
        {visiveis.map(a => (
          <li key={a.key} className="flex items-start gap-2 text-[12px]">
            <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${a.level === 'erro' ? 'bg-red-500' : 'bg-amber-500'}`} />
            <span className="text-gray-700 leading-snug">
              {a.text}
              {a.count > 1 && <span className="ml-1 font-bold text-gray-500">({a.count}×)</span>}
              {a.when && <span className="ml-1 text-[10px] text-gray-400">· {fmtRel(a.when)}</span>}
            </span>
          </li>
        ))}
      </ul>
      {resto > 0 && (
        <p className="mt-1.5 text-[11px] font-semibold text-gray-500">+ {resto} item(ns) — veja o console de eventos abaixo.</p>
      )}
    </div>
  );
}
