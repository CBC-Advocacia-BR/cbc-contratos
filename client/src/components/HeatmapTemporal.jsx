// (#313) Heatmap Temporal — dias da semana x horas do dia
// Mostra onde estao os picos de criacao de contratos (ultimos 90 dias)
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { CalendarDaysIcon, ClockIcon } from '@heroicons/react/24/outline';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
// Faixa comercial 8h-21h para economizar espaco
const HORAS = Array.from({ length: 14 }, (_, i) => i + 8);

// Converte data UTC para horario America/Sao_Paulo (offset -3)
// Observacao: forma simples sem Intl pro runtime browser (funciona bem para BRT fixo)
function toBrtParts(iso) {
  const d = new Date(iso);
  // Usa Intl para garantir fuso horario correto
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(d);
    const weekdayStr = parts.find(p => p.type === 'weekday')?.value || '';
    const hourStr = parts.find(p => p.type === 'hour')?.value || '0';
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = dayMap[weekdayStr] ?? d.getDay();
    let hour = parseInt(hourStr, 10);
    if (Number.isNaN(hour)) hour = d.getHours();
    if (hour === 24) hour = 0;
    return { dow, hour };
  } catch {
    return { dow: d.getDay(), hour: d.getHours() };
  }
}

// (R8) `contratos` opcional: quando o Dashboard passa os contratos ja carregados,
// filtra os ultimos 90 dias em memoria em vez de refazer o fetch da tabela.
export default function HeatmapTemporal({ contratos = null }) {
  const [fetchLoading, setFetchLoading] = useState(!contratos);
  const [error, setError] = useState('');
  const [fetched, setFetched] = useState(null); // so usado quando NAO ha prop
  const [hovered, setHovered] = useState(null);

  // (R8) com a prop, filtra os ultimos 90 dias em memoria (sem refetch da tabela).
  const rows = useMemo(() => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    if (contratos) return contratos.filter(c => c.created_at && c.created_at >= ninetyDaysAgo);
    return fetched || [];
  }, [contratos, fetched]);
  const loading = contratos ? false : fetchLoading;

  useEffect(() => {
    if (contratos) return; // dados vieram por prop
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    let mounted = true;
    async function load() {
      setFetchLoading(true);
      setError('');
      try {
        const { data, error: dbErr } = await supabase
          .from('contratos')
          .select('id, created_at')
          .gte('created_at', ninetyDaysAgo);
        if (dbErr) throw dbErr;
        if (mounted) setFetched(data || []);
      } catch (e) {
        console.error('[HeatmapTemporal]', e);
        if (mounted) setError('Erro ao carregar heatmap');
      } finally {
        if (mounted) setFetchLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [contratos]);

  const { grid, maxVal, totalEvents } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    let total = 0;
    rows.forEach(r => {
      const { dow, hour } = toBrtParts(r.created_at);
      if (dow < 0 || dow > 6) return;
      if (hour < 0 || hour > 23) return;
      g[dow][hour]++;
      total++;
      if (g[dow][hour] > max) max = g[dow][hour];
    });
    return { grid: g, maxVal: max, totalEvents: total };
  }, [rows]);

  // Escala de cor: navy claro → navy escuro → gold
  function cellColor(val) {
    if (!val) return 'var(--cbc-bg-subtle, #F3F4F6)';
    const ratio = val / (maxVal || 1);
    // Gradiente: 0.15 blue-light, 0.5 navy, 1.0 gold
    if (ratio < 0.33) {
      // azul claro -> navy
      const t = ratio / 0.33;
      const r = Math.round(186 + (27 - 186) * t);
      const g = Math.round(214 + (58 - 214) * t);
      const b = Math.round(234 + (92 - 234) * t);
      return `rgb(${r}, ${g}, ${b})`;
    } else if (ratio < 0.66) {
      // navy -> navy-dark
      const t = (ratio - 0.33) / 0.33;
      const r = Math.round(27 + (15 - 27) * t);
      const g = Math.round(58 + (32 - 58) * t);
      const b = Math.round(92 + (53 - 92) * t);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // navy-dark -> gold (pico)
      const t = (ratio - 0.66) / 0.34;
      const r = Math.round(15 + (201 - 15) * t);
      const g = Math.round(32 + (168 - 32) * t);
      const b = Math.round(53 + (76 - 53) * t);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <CalendarDaysIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-muted)' }} />
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>
            Heatmap Temporal
          </div>
        </div>
        <div className="skeleton h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}>
        <div className="text-[11px] text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4"
      style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', color: 'var(--cbc-text-primary)' }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <CalendarDaysIcon className="w-4 h-4" style={{ color: 'var(--cbc-text-muted)' }} />
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--cbc-text-secondary)' }}>
            Heatmap Temporal — Dias x Horarios Mais Produtivos
          </div>
        </div>
        <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
          <ClockIcon className="w-3 h-3 inline mr-1" />
          Ultimos 90 dias · {totalEvents} contratos · Fuso America/Sao_Paulo
        </div>
      </div>

      {totalEvents === 0 ? (
        <div className="text-center py-8 text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
          Sem dados suficientes nos ultimos 90 dias.
        </div>
      ) : (
        <>
          {/* Grid */}
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
              {/* Header horas — (mobile 06/2026) espaçador sticky alinha com a coluna de dias */}
              <div className="flex items-center gap-0.5 mb-1">
                <div className="cbc-sticky-col w-12 shrink-0" aria-hidden="true" />
                {HORAS.map(h => (
                  <div key={h} className="flex-1 min-w-[22px] max-sm:min-w-[28px] text-center text-[9px] font-bold"
                    style={{ color: 'var(--cbc-text-muted)' }}>
                    {h}h
                  </div>
                ))}
              </div>
              {/* Linhas por dia — (mobile 06/2026) rótulo do dia fica sticky no scroll horizontal */}
              {DIAS_SEMANA.map((diaLabel, diaIdx) => (
                <div key={diaIdx} className="flex items-center gap-0.5 mb-0.5">
                  <div className="cbc-sticky-col w-12 text-[10px] font-bold shrink-0 text-right pr-2"
                    style={{ color: 'var(--cbc-text-secondary)' }}>
                    {diaLabel}
                  </div>
                  {HORAS.map(h => {
                    const val = grid[diaIdx][h] || 0;
                    const bg = cellColor(val);
                    const isTopHour = val > 0 && val >= maxVal * 0.66;
                    return (
                      <div
                        key={h}
                        className="flex-1 min-w-[22px] max-sm:min-w-[28px] h-7 max-sm:h-9 rounded cursor-pointer transition-all hover:scale-110 hover:z-10 relative"
                        style={{ background: bg, color: isTopHour ? '#fff' : 'var(--cbc-text-primary)' }}
                        onMouseEnter={() => setHovered({ dia: diaLabel, hour: h, val })}
                        onMouseLeave={() => setHovered(null)}
                        title={`${diaLabel} ${h}h: ${val} contrato${val !== 1 ? 's' : ''}`}
                      >
                        {val > 0 && (
                          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold">
                            {val}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legenda */}
          <div className="mt-3 pt-3 border-t flex items-center justify-between flex-wrap gap-2"
            style={{ borderColor: 'var(--cbc-border)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--cbc-text-muted)' }}>Menos</span>
              <div className="flex gap-0.5">
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((r, i) => (
                  <div key={i} className="w-4 h-4 rounded"
                    style={{ background: cellColor(Math.round(r * (maxVal || 1))) }} />
                ))}
              </div>
              <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--cbc-text-muted)' }}>Mais</span>
            </div>

            {hovered && (
              <div className="text-[11px] font-bold" style={{ color: 'var(--cbc-text-primary)' }}>
                {hovered.dia} {hovered.hour}h:
                <span className="ml-1" style={{ color: 'var(--cbc-accent)' }}>
                  {hovered.val} contrato{hovered.val !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            <div className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
              Pico: <span className="font-bold" style={{ color: 'var(--cbc-accent)' }}>{maxVal}</span> no horario mais ativo
            </div>
          </div>
        </>
      )}
    </div>
  );
}
