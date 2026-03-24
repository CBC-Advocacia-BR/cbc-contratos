import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../config';
import { exportContratosToExcel } from '../utils/excelExport';

function formatCurrency(val) {
  if (!val) return 'R$ 0,00';
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function StatCard({ label, value, sub, color = '#1B3A5C' }) {
  return (
    <div className="p-3 md:p-4 rounded-xl bg-white border border-gray-200">
      <div className="text-[9px] md:text-[10px] font-bold uppercase tracking-[1px] text-gray-400 mb-1">{label}</div>
      <div className="text-xl md:text-2xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] md:text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function BarChart({ data, labelKey, valueKey, title }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d[valueKey] || 0));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-[10px] font-bold uppercase tracking-[1px] text-gray-400 mb-3">{title}</div>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] md:text-[11px] text-gray-600 w-24 md:w-36 truncate shrink-0">{d[labelKey]}</span>
            <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: max > 0 ? `${(d[valueKey] / max) * 100}%` : '0%', background: '#1B3A5C' }}
              />
            </div>
            <span className="text-[11px] font-bold text-gray-700 w-8 text-right">{d[valueKey]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, allLabel = 'Todos' }) {
  return (
    <div className="flex-1 min-w-0">
      <label className="text-[9px] font-bold uppercase tracking-[1px] text-gray-400 block mb-0.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-xs focus:border-[#1B3A5C] focus:outline-none bg-white cursor-pointer"
      >
        <option value="">{allLabel}</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

const RECENTES_PER_PAGE = 5;

function RecentContractsTable({ recentes }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(recentes.length / RECENTES_PER_PAGE);
  const paged = recentes.slice((page - 1) * RECENTES_PER_PAGE, page * RECENTES_PER_PAGE);

  const statusColors = {
    assinado: { bg: '#F0FDF4', color: '#16A34A', label: 'Assinado' },
    enviado_zapsign: { bg: '#EFF6FF', color: '#2563EB', label: 'Enviado' },
    rascunho: { bg: '#F3F4F6', color: '#9CA3AF', label: 'Rascunho' },
    cancelado: { bg: '#FEF2F2', color: '#DC2626', label: 'Cancelado' },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold uppercase tracking-[1px] text-gray-400">Ultimos Contratos</div>
        <span className="text-[9px] text-gray-400">{recentes.length} total</span>
      </div>
      <div className="space-y-2">
        {paged.map((c, i) => {
          const st = statusColors[c.status] || statusColors.rascunho;
          return (
            <div key={i} className="p-2.5 rounded-lg" style={{ background: '#F0F4F8' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-gray-800">{c.nome_contratante1}</span>
                    <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 truncate">{c.resort} | {c.tipo_acao}</div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-bold block" style={{ color: '#1B3A5C' }}>{formatCurrency(c.honorarios_total)}</span>
                  <span className="text-[10px] text-gray-400">{new Date(c.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-3 pt-3 border-t border-gray-100">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 cursor-pointer disabled:opacity-30 disabled:cursor-default text-xs">‹</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || (p >= page - 1 && p <= page + 1))
            .map((p, idx, arr) => {
              const showDots = idx > 0 && p - arr[idx - 1] > 1;
              return (
                <span key={p}>
                  {showDots && <span className="text-gray-400 text-xs px-0.5">...</span>}
                  <button onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded text-[10px] font-bold cursor-pointer transition-all ${p === page ? 'text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                    style={p === page ? { background: '#1B3A5C' } : {}}>{p}</button>
                </span>
              );
            })}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 cursor-pointer disabled:opacity-30 disabled:cursor-default text-xs">›</button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [filterMes, setFilterMes] = useState('');
  const [filterResort, setFilterResort] = useState('');
  const [filterTipoAcao, setFilterTipoAcao] = useState('');
  const [filterDataInicio, setFilterDataInicio] = useState('');
  const [filterDataFim, setFilterDataFim] = useState('');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterMes) params.set('mes', filterMes);
      if (filterResort) params.set('resort', filterResort);
      if (filterTipoAcao) params.set('tipo_acao', filterTipoAcao);
      if (filterDataInicio) params.set('data_inicio', filterDataInicio);
      if (filterDataFim) params.set('data_fim', filterDataFim);
      const resp = await fetch(`${API_URL}/api/dashboard?${params}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setStats(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterMes, filterResort, filterTipoAcao, filterDataInicio, filterDataFim]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const hasFilters = filterMes || filterResort || filterTipoAcao || filterDataInicio || filterDataFim;

  const clearFilters = () => {
    setFilterMes('');
    setFilterResort('');
    setFilterTipoAcao('');
    setFilterDataInicio('');
    setFilterDataFim('');
  };

  const handleExportExcel = async () => {
    try {
      const resp = await fetch(`${API_URL}/api/export/contratos`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      exportContratosToExcel(data);
    } catch (err) { alert('Erro ao exportar: ' + err.message); }
  };

  if (loading && !stats) return (
    <div className="flex items-center justify-center py-12 text-gray-400 text-sm">Carregando dashboard...</div>
  );

  if (error) return (
    <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
  );

  if (!stats) return null;

  const filtros = stats.filtros || {};

  return (
    <div className="p-3 md:p-4 space-y-3 md:space-y-4 overflow-y-auto h-full">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-bold uppercase tracking-[1px] text-gray-400">Filtros</div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-[10px] font-bold uppercase text-red-500 hover:underline cursor-pointer"
            >
              Limpar filtros
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
          <FilterSelect
            label="Mes"
            value={filterMes}
            onChange={setFilterMes}
            allLabel="Todos os meses"
            options={(filtros.meses || []).map(m => ({ value: m.key, label: m.label }))}
          />
          <FilterSelect
            label="Resort"
            value={filterResort}
            onChange={setFilterResort}
            allLabel="Todos os resorts"
            options={(filtros.resorts || []).map(r => ({ value: r, label: r }))}
          />
          <FilterSelect
            label="Tipo de Acao"
            value={filterTipoAcao}
            onChange={setFilterTipoAcao}
            allLabel="Todos os tipos"
            options={(filtros.tiposAcao || []).map(t => ({ value: t, label: t }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="block text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Data Inicio</label>
            <input type="date" value={filterDataInicio} onChange={e => setFilterDataInicio(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:border-[#1B3A5C] focus:outline-none" />
          </div>
          <div>
            <label className="block text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Data Fim</label>
            <input type="date" value={filterDataFim} onChange={e => setFilterDataFim(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:border-[#1B3A5C] focus:outline-none" />
          </div>
        </div>
        {hasFilters && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {filterMes && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#EEF4FF', color: '#1B3A5C' }}>
                {filtros.meses?.find(m => m.key === filterMes)?.label || filterMes}
                <button onClick={() => setFilterMes('')} className="ml-1 cursor-pointer">&times;</button>
              </span>
            )}
            {filterResort && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#EEF4FF', color: '#1B3A5C' }}>
                {filterResort}
                <button onClick={() => setFilterResort('')} className="ml-1 cursor-pointer">&times;</button>
              </span>
            )}
            {filterTipoAcao && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#EEF4FF', color: '#1B3A5C' }}>
                {filterTipoAcao}
                <button onClick={() => setFilterTipoAcao('')} className="ml-1 cursor-pointer">&times;</button>
              </span>
            )}
            {filterDataInicio && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#EEF4FF', color: '#1B3A5C' }}>
                De: {new Date(filterDataInicio + 'T12:00:00').toLocaleDateString('pt-BR')}
                <button onClick={() => setFilterDataInicio('')} className="ml-1 cursor-pointer">&times;</button>
              </span>
            )}
            {filterDataFim && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#EEF4FF', color: '#1B3A5C' }}>
                Ate: {new Date(filterDataFim + 'T12:00:00').toLocaleDateString('pt-BR')}
                <button onClick={() => setFilterDataFim('')} className="ml-1 cursor-pointer">&times;</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <StatCard label="Total Contratos" value={stats.totalContratos} />
        <StatCard label="Valor Total" value={formatCurrency(stats.valorTotal)} color="#16A34A" />
        <StatCard label="Enviados ZapSign" value={stats.porStatus?.enviado_zapsign || 0} color="#2563EB" />
        <StatCard label="Assinados" value={stats.porStatus?.assinado || 0} color="#16A34A"
          sub={stats.totalContratos > 0 ? `${Math.round((stats.porStatus?.assinado || 0) / stats.totalContratos * 100)}% taxa` : ''} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
        <BarChart data={stats.porResort} labelKey="resort" valueKey="count" title="Contratos por Resort" />
        <BarChart data={stats.porTipoAcao} labelKey="acao" valueKey="count" title="Contratos por Tipo de Acao" />
      </div>

      <BarChart data={stats.porMes} labelKey="mes" valueKey="count" title="Contratos por Mes" />

      {/* Status breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-[10px] font-bold uppercase tracking-[1px] text-gray-400 mb-3">Status dos Contratos</div>
        <div className="grid grid-cols-4 gap-3">
          {[
            { key: 'rascunho', label: 'Rascunhos', color: '#9CA3AF' },
            { key: 'enviado_zapsign', label: 'Enviados', color: '#2563EB' },
            { key: 'assinado', label: 'Assinados', color: '#16A34A' },
            { key: 'cancelado', label: 'Cancelados', color: '#DC2626' },
          ].map(s => (
            <div key={s.key} className="text-center p-3 rounded-lg" style={{ background: s.color + '10' }}>
              <div className="text-xl font-bold" style={{ color: s.color }}>{stats.porStatus?.[s.key] || 0}</div>
              <div className="text-[10px] font-bold uppercase" style={{ color: s.color }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Honorário Type Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-[10px] font-bold uppercase tracking-[1px] text-gray-400 mb-3">Tipo de Honorarios</div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'ambos', label: 'Iniciais + Êxito', icon: '💰', color: '#1B3A5C', desc: 'Valor fixo + % de êxito' },
            { key: 'somente_exito', label: 'Somente Êxito', icon: '🎯', color: '#7C3AED', desc: 'Apenas ad exitum' },
            { key: 'somente_iniciais', label: 'Somente Iniciais', icon: '📋', color: '#D97706', desc: 'Apenas valor fixo' },
          ].map(tipo => {
            const count = stats.porTipoHonorario?.[tipo.key] || 0;
            const pct = stats.totalContratos > 0 ? Math.round(count / stats.totalContratos * 100) : 0;
            return (
              <div key={tipo.key} className="text-center p-3 rounded-lg relative overflow-hidden" style={{ background: tipo.color + '08', border: `1px solid ${tipo.color}20` }}>
                <div className="text-2xl mb-1">{tipo.icon}</div>
                <div className="text-xl font-bold" style={{ color: tipo.color }}>{count}</div>
                <div className="text-[10px] font-bold uppercase" style={{ color: tipo.color }}>{tipo.label}</div>
                <div className="text-[9px] text-gray-400 mt-0.5">{pct}% do total</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Conversion Funnel */}
      {stats.totalContratos > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-[10px] font-bold uppercase tracking-[1px] text-gray-400 mb-3">Funil de Conversao</div>
          <div className="space-y-2">
            {[
              { label: 'Rascunhos', count: stats.porStatus?.rascunho || 0, color: '#9CA3AF' },
              { label: 'Enviados ZapSign', count: stats.porStatus?.enviado_zapsign || 0, color: '#2563EB' },
              { label: 'Assinados', count: stats.porStatus?.assinado || 0, color: '#16A34A' },
            ].map((step, i, arr) => {
              const maxCount = Math.max(...arr.map(s => s.count), 1);
              const pct = i > 0 && arr[i - 1].count > 0 ? Math.round(step.count / arr[i - 1].count * 100) : null;
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-gray-600 w-32">{step.label}</span>
                    <div className="flex-1 h-8 bg-gray-100 rounded-lg overflow-hidden relative">
                      <div className="h-full rounded-lg transition-all flex items-center justify-end pr-2"
                        style={{ width: `${Math.max((step.count / maxCount) * 100, 8)}%`, background: step.color }}>
                        <span className="text-[11px] font-bold text-white">{step.count}</span>
                      </div>
                    </div>
                    {pct !== null && (
                      <span className="text-[10px] font-bold w-12 text-right" style={{ color: pct >= 50 ? '#16A34A' : '#DC2626' }}>
                        {pct}%
                      </span>
                    )}
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resort Performance Heatmap */}
      {stats.porResort?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-[10px] font-bold uppercase tracking-[1px] text-gray-400 mb-3">Performance por Resort</div>
          <div className="space-y-2">
            {stats.porResort.map((r, i) => {
              const valorMedio = stats.totalContratos > 0 ? Math.round(stats.valorTotal / stats.totalContratos) : 0;
              return (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: '#F0F4F8' }}>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-gray-800">{r.resort}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="text-xs font-bold" style={{ color: '#1B3A5C' }}>{r.count}</span>
                      <span className="text-[10px] text-gray-400 ml-1">contratos</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top 5 resorts do mês */}
      {stats.topResortsDoMes?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-gray-400">
              Top 5 Empreendimentos — Assinados no Mes
            </div>
            <span className="text-[9px] text-gray-400">
              {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </span>
          </div>
          <div className="space-y-2">
            {stats.topResortsDoMes.map((r, i) => {
              const max = stats.topResortsDoMes[0]?.count || 1;
              const medals = ['🥇', '🥈', '🥉'];
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm w-6 text-center shrink-0">{medals[i] || `${i + 1}º`}</span>
                  <span className="text-[11px] text-gray-700 w-36 truncate shrink-0 font-medium">{r.resort}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${(r.count / max) * 100}%`,
                      background: i === 0 ? '#C9A84C' : i === 1 ? '#8B9CB6' : i === 2 ? '#A67C52' : '#1B3A5C'
                    }} />
                  </div>
                  <span className="text-[11px] font-bold w-8 text-right" style={{ color: '#1B3A5C' }}>{r.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent contracts with pagination */}
      {stats.recentes?.length > 0 && (
        <RecentContractsTable recentes={stats.recentes} />
      )}

      {/* Export button */}
      <div className="flex justify-center pb-4">
        <button onClick={handleExportExcel}
          className="px-6 py-2.5 rounded-lg text-white font-bold text-xs uppercase tracking-wide cursor-pointer hover:opacity-90"
          style={{ background: '#1B3A5C' }}>
          Exportar para Excel
        </button>
      </div>
    </div>
  );
}
