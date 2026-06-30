// (#308) Preferências de KPIs persistidas por usuário em localStorage.
// Redesign 12/06/2026: removidos KPIs mortos (pendente_boletos, leads_ativos —
// mostravam "—" desde a remoção da aba Leads) e adicionados assinados_mes e
// pipeline_aberto. Chaves antigas salvas são filtradas automaticamente.
import { useState, useCallback } from 'react';

export const KPI_KEYS = [
  'assinados_mes',
  'valor_mes',
  'meta_mensal',
  'total_contratos',
  'total_assinados',
  'taxa_conversao',
  'ticket_medio',
  'tempo_medio_assinatura',
  'pendente_zapsign',
  'pipeline_aberto',
  'pendente_advbox',
  'pendente_drive',
  'cancelados_mes',
  'top_resort_mes',
];

export const KPI_META = {
  assinados_mes: { label: 'Assinados no Mês', desc: 'Assinaturas do mês corrente, com variação vs mês anterior' },
  valor_mes: { label: 'Receita do Mês', desc: 'Honorários iniciais dos contratos assinados no mês corrente' },
  meta_mensal: { label: 'Meta Mensal', desc: 'Progresso de assinaturas vs meta do mês' },
  total_contratos: { label: 'Contratos no Escopo', desc: 'Total de contratos do recorte filtrado' },
  total_assinados: { label: 'Assinados no Escopo', desc: 'Contratos assinados do recorte filtrado' },
  taxa_conversao: { label: 'Conversão de Enviados', desc: 'Assinados ÷ enviados para assinatura (funil cumulativo)' },
  ticket_medio: { label: 'Ticket Médio', desc: 'Média de honorários iniciais por contrato assinado' },
  tempo_medio_assinatura: { label: 'Criação → Assinatura', desc: 'Dias médios entre criar o contrato e o cliente assinar' },
  pendente_zapsign: { label: 'Aguardando Assinatura', desc: 'Contratos enviados ao ZapSign ainda não assinados (carteira ativa)' },
  pipeline_aberto: { label: 'Honorários a Assinar', desc: 'Soma dos honorários dos contratos aguardando assinatura' },
  pendente_advbox: { label: 'Pendentes ADVBOX', desc: 'Assinados ainda não sincronizados com o ADVBOX' },
  pendente_drive: { label: 'Pendentes Drive', desc: 'Assinados sem upload concluído no Google Drive' },
  cancelados_mes: { label: 'Cancelados no Mês', desc: 'Contratos cancelados no mês corrente' },
  top_resort_mes: { label: 'Top Resort do Mês', desc: 'Resort com mais assinaturas no mês corrente' },
};

export const DEFAULT_KPIS = [
  'assinados_mes',
  'valor_mes',
  'meta_mensal',
  'taxa_conversao',
  'pendente_zapsign',
  'ticket_medio',
];

export function useKpiPreferences(userEmail) {
  const key = `cbc-kpis:${(userEmail || 'default').toLowerCase()}`;
  const [selected, setSelected] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return DEFAULT_KPIS;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_KPIS;
      const valid = parsed.filter(k => KPI_KEYS.includes(k));
      return valid.length > 0 ? valid : DEFAULT_KPIS;
    } catch {
      return DEFAULT_KPIS;
    }
  });

  const toggle = useCallback((k) => {
    setSelected(prev => {
      const next = prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k];
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, [key]);

  const reset = useCallback(() => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    setSelected(DEFAULT_KPIS);
  }, [key]);

  const setMany = useCallback((arr) => {
    const clean = Array.isArray(arr) ? arr.filter(k => KPI_KEYS.includes(k)) : [];
    setSelected(clean);
    try { localStorage.setItem(key, JSON.stringify(clean)); } catch { /* quota */ }
  }, [key]);

  return { selected, toggle, reset, setMany, allKeys: KPI_KEYS, meta: KPI_META };
}
