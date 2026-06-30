/**
 * Cards vivos de inadimplência na aba Boletos (#23): clientes, total em
 * aberto e maior atraso — com tendência vs ~30 dias atrás quando o histórico
 * diário (inadimplencia_historico, gravado pela régua) tiver acumulado.
 * (#extract-base 20/06) cores -> tokens --cbc-danger/* (dark-aware); R$ -> MoneyValue.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import MoneyValue from './ui/MoneyValue';

function Tendencia({ atual, antigo }) {
  if (antigo == null || antigo === 0) return null;
  const pct = Math.round(((atual - antigo) / antigo) * 100);
  if (!pct) return <span className="text-[10px] font-bold" style={{ color: 'var(--cbc-text-muted)' }}>= estável</span>;
  const subiu = pct > 0; // inadimplência subir é ruim
  return (
    <span className="text-[10px] font-bold" style={{ color: subiu ? 'var(--cbc-danger)' : 'var(--cbc-success)' }}>
      {subiu ? '▲' : '▼'} {Math.abs(pct)}% vs mês passado
    </span>
  );
}

// (R16) refreshToken muda apos cada sync/refresh do painel de Boletos —
// sem isso os cards ficavam congelados no 1o fetch (deps []) e mostravam
// numeros de inadimplencia velhos mesmo depois de sincronizar com o Asaas.
// (unificacao 20/06/2026) Os numeros ATUAIS (clientes/total/maior atraso) vem do
// painel via prop `current` — mesma fonte do cabecalho/lista/faixa fixa, acabando
// com a divergencia (ex.: 54.214 x 53.334). A consulta propria fica SO p/ o baseline
// historico (tendencia vs ~mes passado). Sem `current`, cai no fallback antigo.
export default function InadimplenciaStrip({ refreshToken = 0, current = null }) {
  const [ref, setRef] = useState(null);
  const [fallback, setFallback] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data: hist } = await supabase.from('inadimplencia_historico')
          .select('dia, clientes, total')
          .lte('dia', new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10))
          .order('dia', { ascending: false }).limit(1);
        if (vivo) setRef((hist && hist[0]) || null);
        if (!current) {
          const hoje = new Date().toISOString().slice(0, 10);
          const { data: bols } = await supabase.from('asaas_boletos')
            // (#L12) inclui DUNNING_REQUESTED (negativação) — faz parte do bucket OPEN
            // canônico (ver lib/statusTokens). Antes o fallback subcontava a inadimplência.
            .select('customer_cpf, customer_name, value, due_date')
            .or(`status.eq.OVERDUE,status.eq.DUNNING_REQUESTED,and(status.eq.PENDING,due_date.lt.${hoje})`)
            .limit(5000);
          const grupos = new Set();
          let total = 0, maior = 0;
          const agora = new Date(hoje).getTime();
          for (const b of bols || []) {
            grupos.add((b.customer_cpf || '').replace(/\D/g, '') || b.customer_name);
            total += Number(b.value) || 0;
            const dias = Math.floor((agora - new Date(b.due_date).getTime()) / 86400000);
            if (dias > maior) maior = dias;
          }
          if (vivo) setFallback({ clientes: grupos.size, parcelas: (bols || []).length, total, maior });
        }
      } catch { /* strip é opcional */ }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const d = current || fallback;
  if (!d) return null;
  const cardStyle = { background: 'var(--cbc-danger-bg)', border: '1px solid var(--cbc-danger-border)' };
  return (
    <div className="grid grid-cols-1 min-[480px]:grid-cols-3 gap-2 mb-4">
      <div className="rounded-xl p-3 min-w-0" style={cardStyle}>
        <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--cbc-danger)' }}>Inadimplentes</div>
        <div className="text-lg font-bold max-sm:truncate tabular-nums" style={{ color: 'var(--cbc-danger)' }}>{d.clientes} <span className="text-[11px] font-normal opacity-60">({d.parcelas} parc.)</span></div>
        <Tendencia atual={d.clientes} antigo={ref?.clientes} />
      </div>
      <div className="rounded-xl p-3 min-w-0" style={cardStyle}>
        <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--cbc-danger)' }}>Total em aberto</div>
        <div className="text-lg font-bold max-sm:truncate" style={{ color: 'var(--cbc-danger)' }}><MoneyValue value={d.total} /></div>
        <Tendencia atual={d.total} antigo={ref ? Number(ref.total) : null} />
      </div>
      <div className="rounded-xl p-3 min-w-0" style={cardStyle}>
        <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--cbc-danger)' }}>Maior atraso</div>
        <div className="text-lg font-bold max-sm:truncate tabular-nums" style={{ color: 'var(--cbc-danger)' }}>{d.maior} dias</div>
      </div>
    </div>
  );
}
