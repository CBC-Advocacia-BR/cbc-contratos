// Pontualidade dos vendedores na videochamada (Regra B). Visivel SO p/ socios
// (o pai gata por SOCIOS_EMAILS; a RPC vendedor_pontualidade tambem confere o e-mail
// no JWT — dupla trava). Auto-carrega 180d e filtra por periodo no cliente.
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { computePontualidade, fmtDur } from '../utils/punctualityCompute';

const PERIODOS = [{ d: 30, l: '30 dias' }, { d: 90, l: '90 dias' }, { d: 180, l: '180 dias' }];

function fmtDH(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}
function fmtHora(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}
const pctCor = (pct) => (pct == null ? 'var(--cbc-text-soft, #64748b)' : pct >= 90 ? 'var(--cbc-success, #16A34A)' : pct >= 75 ? 'var(--cbc-warning, #D97706)' : 'var(--cbc-danger, #DC2626)');

export default function PontualidadePanel() {
  const [rows, setRows] = useState(null);
  const [dias, setDias] = useState(30);
  const [erro, setErro] = useState('');
  const [showCasos, setShowCasos] = useState(false);

  // periodo resolvido no SERVIDOR (RPC usa now() - p_dias) -> sem Date.now() no cliente.
  // setState so no callback do .then/.catch (padrao aceito p/ sincronizar com fonte externa).
  useEffect(() => {
    let vivo = true;
    supabase.rpc('vendedor_pontualidade', { p_dias: dias })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setErro(error.message); setRows([]); } else { setErro(''); setRows(data || []); }
      })
      .catch((e) => { if (vivo) { setErro(e?.message || 'erro'); setRows([]); } });
    return () => { vivo = false; };
  }, [dias]);

  const p = useMemo(() => (rows ? computePontualidade(rows) : null), [rows]);

  return (
    <div className="card p-4 mt-4" style={{ borderTop: '3px solid var(--cbc-gold, #C9A84C)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-navy, #1B3A5C)' }}>
          Pontualidade dos vendedores
        </h3>
        <div className="flex gap-1">
          {PERIODOS.map((pr) => (
            <button key={pr.d} type="button" onClick={() => setDias(pr.d)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-full border"
              style={dias === pr.d
                ? { background: 'var(--cbc-navy, #1B3A5C)', color: '#fff', borderColor: 'var(--cbc-navy, #1B3A5C)' }
                : { background: 'transparent', color: 'var(--cbc-text-soft, #64748b)', borderColor: 'var(--cbc-border, #CBD5E0)' }}>
              {pr.l}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--cbc-text-soft, #64748b)' }}>
        O vendedor deveria estar na sala antes do lead. Conta atraso quando o lead já estava lá e o vendedor entrou depois do horário — medido a partir do horário marcado.
      </p>

      {erro && <p className="text-xs text-red-600">Não carregou: {erro}</p>}
      {!p && !erro && <p className="text-xs" style={{ color: 'var(--cbc-text-soft, #64748b)' }}>Carregando…</p>}

      {p && p.geral.total === 0 && (
        <p className="text-xs" style={{ color: 'var(--cbc-text-soft, #64748b)' }}>Sem videochamadas auditadas no período.</p>
      )}

      {p && p.geral.total > 0 && (
        <>
          {/* resumo geral */}
          <div className="flex flex-wrap gap-4 mb-3 text-xs">
            <span><b style={{ fontSize: 18, color: pctCor(p.geral.pctPontual) }}>{p.geral.pctPontual}%</b> pontualidade</span>
            <span style={{ color: 'var(--cbc-text-soft, #64748b)' }}>{p.geral.total} calls com lead · <b>{p.geral.atrasos}</b> atrasos{p.geral.naoEntrou ? ` · ${p.geral.naoEntrou} não compareceu` : ''}</span>
          </div>

          {/* por vendedor */}
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--cbc-text-soft, #64748b)', textAlign: 'left' }}>
                  <th scope="col" className="py-1.5 pr-3 font-bold uppercase text-[10px]">Vendedor</th>
                  <th scope="col" className="py-1.5 px-2 font-bold uppercase text-[10px] text-center">Pontualidade</th>
                  <th scope="col" className="py-1.5 px-2 font-bold uppercase text-[10px] text-center">Atrasos</th>
                  <th scope="col" className="py-1.5 px-2 font-bold uppercase text-[10px] text-center">Mediano</th>
                  <th scope="col" className="py-1.5 px-2 font-bold uppercase text-[10px] text-center">Pior</th>
                  <th scope="col" className="py-1.5 pl-2 font-bold uppercase text-[10px] text-center">Não veio</th>
                </tr>
              </thead>
              <tbody>
                {p.porVendedor.map((v) => (
                  <tr key={v.vendedora_email} style={{ borderTop: '1px solid var(--cbc-border, #E2E8F0)' }}>
                    <td className="py-2 pr-3 font-semibold capitalize" style={{ color: 'var(--cbc-navy, #1B3A5C)' }}>{v.vendedor}</td>
                    <td className="py-2 px-2 text-center font-bold" style={{ color: pctCor(v.pctPontual) }}>{v.pctPontual}%</td>
                    <td className="py-2 px-2 text-center">{v.atrasos}<span style={{ color: 'var(--cbc-text-soft, #94a3b8)' }}>/{v.total}</span></td>
                    <td className="py-2 px-2 text-center">{fmtDur(v.atrasoMedianoSeg)}</td>
                    <td className="py-2 px-2 text-center">{fmtDur(v.piorSeg)}</td>
                    <td className="py-2 pl-2 text-center" style={{ color: v.naoEntrou ? 'var(--cbc-danger, #DC2626)' : 'inherit' }}>{v.naoEntrou || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* casos especificos */}
          {p.casos.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowCasos((s) => !s)}
                className="text-[11px] font-bold underline underline-offset-2 cursor-pointer" style={{ color: 'var(--cbc-navy, #1B3A5C)' }}>
                {showCasos ? 'Ocultar' : `Ver os ${p.casos.length} casos de atraso`}
              </button>
              {showCasos && (
                <div className="mt-2 rounded-lg border" style={{ borderColor: 'var(--cbc-border, #E2E8F0)', maxHeight: 320, overflowY: 'auto' }}>
                  {p.casos.map((c) => (
                    <div key={c.event_id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-[11px]" style={{ borderBottom: '1px solid var(--cbc-border, #F1F5F9)' }}>
                      <b style={{ color: 'var(--cbc-danger, #DC2626)', minWidth: 62 }}>{fmtDur(c.atraso_seg)}</b>
                      <span className="font-semibold capitalize" style={{ color: 'var(--cbc-navy, #1B3A5C)' }}>{c.vendedor}</span>
                      <span style={{ color: 'var(--cbc-text-soft, #64748b)' }}>{fmtDH(c.scheduled_at)}</span>
                      <span style={{ color: 'var(--cbc-text-soft, #94a3b8)' }}>· {c.cliente_nome || 'cliente'}</span>
                      <span style={{ color: 'var(--cbc-text-soft, #94a3b8)' }}>· lead {fmtHora(c.lead_entrou)} → vendedor {fmtHora(c.vendedor_entrou)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
