// Distribuição geográfica dos clientes (por UF/cidade dos contratantes).
// Redesign 12/06/2026:
//  - Select enxuto: puxa só dados->contratantes em vez do JSONB `dados`
//    inteiro (que inclui cláusulas — economia grande de banda)
//  - Exclui contratos arquivados (consistente com o resto do Dashboard)
//  - Tokens --cbc-* para funcionar em dark mode
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { MapPinIcon } from '@heroicons/react/24/outline';

const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS',
  'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC',
  'SE', 'SP', 'TO',
]);

const RANK_COLORS = ['#C9A84C', '#9AA7B8', '#B0793F'];

// (R8) Constroi a lista de localizacoes a partir de linhas de contrato (carteira ativa).
// Aceita tanto o alias `contratantes_j` (fetch) quanto `dados.contratantes` (realtime).
function buildLocations(contratos) {
  const locations = [];
  (contratos || []).forEach(c => {
    if (c.arquivado_em) return; // carteira ativa apenas
    const cts = c.contratantes_j || c.dados?.contratantes || [];
    cts.forEach(ct => {
      if (ct?.uf || ct?.cidade) {
        locations.push({
          uf: (ct.uf || '').toUpperCase(),
          cidade: ct.cidade || '',
          resort: c.resort || '',
          valor: Number(c.honorarios_total) || 0,
          status: c.status,
        });
      }
    });
  });
  return locations;
}

// (R8) `rows` opcional: quando o Dashboard passa os contratos ja carregados, NAO
// refaz o fetch (elimina uma varredura da tabela inteira). Sem a prop, busca sozinho.
export default function GeoHeatmap({ rows = null }) {
  const [fetched, setFetched] = useState(null);     // so usado quando NAO ha prop
  const [fetchLoading, setFetchLoading] = useState(!rows);
  const [viewMode, setViewMode] = useState('estado'); // 'estado' | 'cidade'
  const [showAllCities, setShowAllCities] = useState(false); // (R11)

  // (R8) com a prop `rows`, deriva direto (sem fetch). Sem ela, usa o que o fetch trouxe.
  const data = useMemo(() => {
    const src = rows || fetched;
    return src ? buildLocations(src) : [];
  }, [rows, fetched]);
  const loading = rows ? false : fetchLoading;

  useEffect(() => {
    if (rows) return; // dados vieram por prop — nada a buscar
    let mounted = true;
    async function fetchData() {
      setFetchLoading(true);
      const { data: contratos } = await supabase
        .from('contratos')
        .select('contratantes_j:dados->contratantes, resort, honorarios_total, status, arquivado_em')
        .order('created_at', { ascending: false });
      if (mounted && contratos) setFetched(contratos);
      if (mounted) setFetchLoading(false);
    }
    fetchData();
    return () => { mounted = false; };
  }, [rows]);

  // Agrupamento por estado
  const byEstado = useMemo(() => {
    const map = {};
    data.forEach(d => {
      if (!d.uf || !UFS_VALIDAS.has(d.uf)) return;
      if (!map[d.uf]) map[d.uf] = { count: 0, valor: 0, cidades: {} };
      map[d.uf].count++;
      map[d.uf].valor += d.valor;
      const cidade = d.cidade || 'N/I';
      map[d.uf].cidades[cidade] = (map[d.uf].cidades[cidade] || 0) + 1;
    });
    return Object.entries(map)
      .map(([uf, info]) => ({
        uf,
        count: info.count,
        valor: info.valor,
        topCidade: Object.entries(info.cidades).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
        cidadesCount: Object.keys(info.cidades).length,
      }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  // Agrupamento por cidade
  const byCidade = useMemo(() => {
    const map = {};
    data.forEach(d => {
      const key = `${d.cidade || 'N/I'}-${d.uf || ''}`;
      if (!map[key]) map[key] = { cidade: d.cidade || 'N/I', uf: d.uf || '', count: 0, valor: 0 };
      map[key].count++;
      map[key].valor += d.valor;
    });
    // (R11) lista completa — o slice de exibicao fica na renderizacao, p/ o contador
    // do rodape ('Cidades') refletir o total real, nao no maximo de 20.
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [data]);

  const maxCount = byEstado[0]?.count || 1;

  const cardStyle = {
    background: 'var(--cbc-bg-card)',
    border: '1px solid var(--cbc-border)',
    boxShadow: 'var(--cbc-shadow)',
  };

  const Header = (
    <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 min-w-0">
        <MapPinIcon className="w-4 h-4 shrink-0" style={{ color: 'var(--cbc-text-muted)' }} aria-hidden="true" />
        <div className="text-[11px] font-bold uppercase tracking-[1.2px] truncate" style={{ color: 'var(--cbc-text-secondary)' }}>
          Distribuição geográfica
        </div>
      </div>
      <div className="flex items-center rounded-lg p-0.5" style={{ background: 'var(--cbc-bg-subtle)', border: '1px solid var(--cbc-border)' }}>
        {[{ k: 'estado', l: 'Por estado' }, { k: 'cidade', l: 'Por cidade' }].map(opt => (
          <button
            key={opt.k}
            type="button"
            onClick={() => setViewMode(opt.k)}
            className="px-2 py-1 rounded-md text-[9px] font-bold uppercase cursor-pointer transition-all"
            style={viewMode === opt.k
              ? { background: 'var(--cbc-accent)', color: 'var(--cbc-bg)' }
              : { color: 'var(--cbc-text-muted)' }}
          >
            {opt.l}
          </button>
        ))}
      </div>
    </div>
  );

  if (loading) return (
    <div className="rounded-xl p-4" style={cardStyle}>
      {Header}
      <div className="skeleton h-40 w-full rounded-lg" />
    </div>
  );

  if (data.length === 0) return (
    <div className="rounded-xl p-4" style={cardStyle}>
      {Header}
      <div className="text-center text-xs py-8" style={{ color: 'var(--cbc-text-muted)' }}>
        Sem dados de localização nos contratos ativos.
      </div>
    </div>
  );

  return (
    <div className="rounded-xl p-4" style={cardStyle}>
      {Header}

      {viewMode === 'estado' ? (
        <div className="space-y-1.5">
          {byEstado.map(d => {
            const intensity = Math.max(0.18, d.count / maxCount);
            return (
              <div key={d.uf} className="flex items-center gap-2 p-1.5 rounded-lg">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-black text-white shrink-0"
                  style={{ background: `rgba(27, 58, 92, ${0.35 + intensity * 0.65})` }}
                >
                  {d.uf}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${(d.count / maxCount) * 100}%`, background: 'var(--cbc-info)' }}
                      />
                    </div>
                    <span className="text-[11px] font-bold w-7 text-right" style={{ color: 'var(--cbc-text-primary)' }}>{d.count}</span>
                  </div>
                  <div className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--cbc-text-muted)' }}>
                    {d.topCidade && `Principal: ${d.topCidade}`}
                    {d.cidadesCount > 1 && ` (+${d.cidadesCount - 1} cidade${d.cidadesCount - 1 === 1 ? '' : 's'})`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1">
          {(showAllCities ? byCidade : byCidade.slice(0, 20)).map((d, i) => {
            const cityMax = byCidade[0]?.count || 1;
            return (
              <div key={`${d.cidade}-${d.uf}`} className="flex items-center gap-2 p-1.5 rounded-lg">
                <span
                  className="w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center shrink-0"
                  style={i < 3
                    ? { background: RANK_COLORS[i], color: '#fff' }
                    : { background: 'var(--cbc-bg-subtle)', color: 'var(--cbc-text-muted)' }}
                  aria-label={`${i + 1}º lugar`}
                >
                  {i + 1}
                </span>
                <span className="text-[11px] w-32 truncate shrink-0" style={{ color: 'var(--cbc-text-secondary)' }}>
                  {d.cidade}/{d.uf}
                </span>
                <div className="flex-1 h-3.5 rounded-full overflow-hidden" style={{ background: 'var(--cbc-bg-subtle)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(d.count / cityMax) * 100}%`, background: i < 3 ? RANK_COLORS[i] : 'var(--cbc-info)' }}
                  />
                </div>
                <span className="text-[10px] font-bold w-6 text-right" style={{ color: 'var(--cbc-text-primary)' }}>{d.count}</span>
              </div>
            );
          })}
          {byCidade.length > 20 && (
            <button
              type="button"
              onClick={() => setShowAllCities((v) => !v)}
              className="w-full text-[10px] font-bold uppercase py-1.5 cursor-pointer hover:underline"
              style={{ color: 'var(--cbc-accent)' }}
            >
              {showAllCities ? 'Mostrar menos' : `Mostrar todas (${byCidade.length})`}
            </button>
          )}
        </div>
      )}

      {/* Resumo */}
      <div className="mt-3 pt-3 grid grid-cols-3 gap-2" style={{ borderTop: '1px solid var(--cbc-border)' }}>
        {[
          { v: byEstado.length, l: 'Estados' },
          { v: byCidade.length, l: 'Cidades' },
          { v: data.length, l: 'Clientes' },
        ].map(item => (
          <div key={item.l} className="text-center">
            <div className="text-lg font-bold" style={{ color: 'var(--cbc-text-primary)' }}>{item.v}</div>
            <div className="text-[9px] uppercase font-bold" style={{ color: 'var(--cbc-text-muted)' }}>{item.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
