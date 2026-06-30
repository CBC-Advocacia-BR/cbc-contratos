import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Fuse from 'fuse.js';
import { supabase } from '../lib/supabase';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export default function GlobalSearch({ onClose, onSelectContract }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  // (#72) Pool recente para fuzzy — cache em memoria
  const [recentPool, setRecentPool] = useState([]);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const maxResults = 10;

  // (#72) Pre-carrega pool de contratos recentes para fuzzy search
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from('contratos')
          .select('id, nome_contratante1, nome_contratante2, cpf_contratante1, cpf_contratante2, resort, tipo_acao, status, created_at, honorarios_total')
          .order('created_at', { ascending: false })
          .limit(500);
        if (!cancelled && data) setRecentPool(data);
      } catch { /* ignora */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // (#72) Fuse instance — fuzzy search no pool local para tolerar erros de digitacao
  const fuse = useMemo(() => {
    if (!recentPool.length) return null;
    return new Fuse(recentPool, {
      threshold: 0.3,
      keys: ['nome_contratante1', 'nome_contratante2', 'resort'],
      includeScore: false,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  }, [recentPool]);

  // Normalizar digits para busca de CPF (exato)
  const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

  const search = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      // (#270) Date search — DD/MM/AAAA
      const dateMatch = q.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dateMatch) {
        const [, d, m, y] = dateMatch;
        const searchDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        const { data } = await supabase.from('contratos')
          .select('id, nome_contratante1, nome_contratante2, cpf_contratante1, cpf_contratante2, resort, tipo_acao, status, created_at, honorarios_total')
          .gte('created_at', searchDate + 'T00:00:00')
          .lt('created_at', searchDate + 'T23:59:59')
          .order('created_at', { ascending: false })
          .limit(maxResults);
        setResults(data || []);
        setSelected(0);
        setLoading(false);
        return;
      }
      // (#270) Month search — MM/AAAA
      const monthMatch = q.match(/^(\d{1,2})\/(\d{4})$/);
      if (monthMatch) {
        const [, m, y] = monthMatch;
        const searchMonth = `${y}-${m.padStart(2,'0')}`;
        const nextMonth = Number(m) === 12 ? `${Number(y)+1}-01` : `${y}-${String(Number(m)+1).padStart(2,'0')}`;
        const { data } = await supabase.from('contratos')
          .select('id, nome_contratante1, nome_contratante2, cpf_contratante1, cpf_contratante2, resort, tipo_acao, status, created_at, honorarios_total')
          .gte('created_at', searchMonth + '-01T00:00:00')
          .lt('created_at', nextMonth + '-01T00:00:00')
          .order('created_at', { ascending: false })
          .limit(maxResults);
        setResults(data || []);
        setSelected(0);
        setLoading(false);
        return;
      }

      // (#72) Se parecer CPF (so digitos), buscar exato no Supabase
      const digits = onlyDigits(q);
      if (digits.length >= 11) {
        // CPF completo — busca exata
        const { data } = await supabase.from('contratos')
          .select('id, nome_contratante1, nome_contratante2, cpf_contratante1, cpf_contratante2, resort, tipo_acao, status, created_at, honorarios_total')
          .or(`cpf_contratante1.ilike.%${digits}%,cpf_contratante2.ilike.%${digits}%`)
          .order('created_at', { ascending: false })
          .limit(maxResults);
        setResults(data || []);
        setSelected(0);
        setLoading(false);
        return;
      }

      // (#72) Fuzzy search local primeiro — tolera erros de digitacao em nome/resort
      if (fuse && q.length >= 2) {
        const fuzzyResults = fuse.search(q, { limit: maxResults }).map(r => r.item);
        if (fuzzyResults.length > 0) {
          setResults(fuzzyResults);
          setSelected(0);
          setLoading(false);
          return;
        }
      }

      // Fallback: busca no Supabase (ilike) se fuzzy nao retornar nada
      const { data } = await supabase.from('contratos')
        .select('id, nome_contratante1, nome_contratante2, cpf_contratante1, cpf_contratante2, resort, tipo_acao, status, created_at, honorarios_total')
        .or(`nome_contratante1.ilike.%${q}%,cpf_contratante1.ilike.%${q}%,resort.ilike.%${q}%,nome_contratante2.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(maxResults);
      setResults(data || []);
      setSelected(0);
    } catch { /* ignora */ }
    setLoading(false);
  }, [fuse]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[selected]) {
      onSelectContract(results[selected]);
      onClose();
    }
  };

  const statusColors = {
    rascunho: { bg: '#F3F4F6', text: '#6B7280' },
    enviado_zapsign: { bg: '#EFF6FF', text: '#2563EB' },
    assinado: { bg: '#F0FDF4', text: '#16A34A' },
    cancelado: { bg: '#FEF2F2', text: '#DC2626' },
  };

  return (
    /* (mobile 06/2026) cbc-search-wrap encosta o modal no topo do phone
       (teclado iOS ocupa a metade de baixo); botão X visível em touch */
    <div className='cbc-search-wrap fixed inset-0 modal-backdrop-glass z-[100] flex items-start justify-center pt-[15vh]' onClick={onClose}>
      <div className='modal-glass rounded-2xl w-full max-w-lg overflow-hidden' onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className='flex items-center gap-3 px-4 py-3 border-b border-gray-100'>
          <MagnifyingGlassIcon className='w-5 h-5 text-gray-400 shrink-0' aria-hidden='true' />
          {/* (fix review 12/06) sem type='search' — WebKit desktop renderizava o ✕
              nativo; inputMode basta para o teclado mobile */}
          <input ref={inputRef} inputMode='search' enterKeyHint='search' value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
            className='flex-1 text-sm outline-none placeholder-gray-400 min-w-0' placeholder='Buscar por nome, CPF, resort ou data (DD/MM/AAAA)...' />
          <kbd className='hidden md:inline text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono'>ESC</kbd>
          <button type='button' onClick={onClose} aria-label='Fechar busca'
            className='md:hidden shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 cursor-pointer no-touch-min text-lg'>
            &times;
          </button>
        </div>

        {/* Results */}
        {/* (mobile-9) desktop mantem 350px; no phone usa altura relativa a viewport
            visivel (dvh) p/ resultados caberem acima do teclado iOS */}
        <div className='max-h-[350px] max-sm:max-h-[45dvh] overflow-y-auto'>
          {loading && <div className='px-4 py-3 text-[11px] text-gray-400 text-center'>Buscando...</div>}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div className='px-4 py-6 text-center text-gray-400 text-sm'>Nenhum resultado para "{query}"</div>
          )}
          {/* (#268) Grouped search results */}
          {(() => {
            const grouped = {};
            let flatIndex = 0;
            results.forEach(r => {
              const g = r.status === 'assinado' ? 'Assinados' : r.status === 'enviado_zapsign' ? 'Enviados' : r.status === 'rascunho' ? 'Rascunhos' : 'Outros';
              (grouped[g] = grouped[g] || []).push({ ...r, _flatIndex: flatIndex++ });
            });
            const groupOrder = ['Assinados', 'Enviados', 'Rascunhos', 'Outros'];
            return groupOrder.filter(g => grouped[g]?.length > 0).map(g => (
              <div key={g}>
                <div className='text-[9px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1 mt-1'>{g} ({grouped[g].length})</div>
                {grouped[g].map(r => {
                  const sc = statusColors[r.status] || statusColors.rascunho;
                  // (R6) sinaliza quando o match veio do 2o contratante (nome ou CPF) —
                  // sem isso o usuario ve so o nome do 1o e acha que achou o contrato errado.
                  const q = (query || '').trim().toLowerCase();
                  const qDig = onlyDigits(query);
                  const n1 = (r.nome_contratante1 || '').toLowerCase();
                  const n2 = (r.nome_contratante2 || '').toLowerCase();
                  const c1 = onlyDigits(r.cpf_contratante1);
                  const c2 = onlyDigits(r.cpf_contratante2);
                  const via2 = r.nome_contratante2 && (
                    (q.length >= 2 && n2.includes(q) && !n1.includes(q)) ||
                    (qDig.length >= 3 && c2.includes(qDig) && !c1.includes(qDig))
                  );
                  return (
                    <div key={r.id}
                      onClick={() => { onSelectContract(r); onClose(); }}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${r._flatIndex === selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <div className='flex-1 min-w-0'>
                        <div className='font-semibold text-sm truncate' style={{ color: '#1A2E52' }}>{r.nome_contratante1}</div>
                        <div className='flex items-center gap-2 text-[10px] text-gray-400'>
                          <span>{r.cpf_contratante1}</span>
                          <span>{r.resort}</span>
                          <span>{new Date(r.created_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                        {via2 && (
                          <div className='text-[10px] font-semibold truncate' style={{ color: '#B45309' }}>
                            ↳ encontrado pelo 2º contratante: {r.nome_contratante2}
                          </div>
                        )}
                      </div>
                      <span className='px-2 py-0.5 rounded-full text-[9px] font-bold uppercase shrink-0'
                        style={{ background: sc.bg, color: sc.text }}>
                        {r.status === 'enviado_zapsign' ? 'Enviado' : r.status}
                      </span>
                      <span className='text-sm font-bold shrink-0' style={{ color: '#1A2E52' }}>
                        {r.honorarios_total > 0 ? `R$ ${Number(r.honorarios_total).toLocaleString('pt-BR')}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className='px-4 py-2 border-t border-gray-100 flex items-center gap-3 text-[9px] text-gray-400'>
            <span>↑↓ navegar</span>
            <span>↵ selecionar</span>
            <span>ESC fechar</span>
          </div>
        )}
      </div>
    </div>
  );
}
