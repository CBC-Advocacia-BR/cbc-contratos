import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { API_URL } from '../config';
import { useContract } from '../ContractContext';
import { generateContractHTML, generateProcuracaoHTML } from '../utils/contractHtml';

// Section mapping: which form fields map to which contract sections
const SECTION_MAP = {
  nome: 'Preâmbulo — Qualificação',
  cpf: 'Preâmbulo — Qualificação',
  rg: 'Preâmbulo — Qualificação',
  nacionalidade: 'Preâmbulo — Qualificação',
  profissao: 'Preâmbulo — Qualificação',
  estadoCivil: 'Preâmbulo — Qualificação',
  email: 'Preâmbulo — Qualificação',
  endereco: 'Preâmbulo — Endereço',
  complemento: 'Preâmbulo — Endereço',
  bairro: 'Preâmbulo — Endereço',
  cidade: 'Preâmbulo — Endereço',
  uf: 'Preâmbulo — Endereço',
  cep: 'Preâmbulo — Endereço',
  resort: 'Objeto da Ação',
  tipoAcao: 'Objeto da Ação',
  total: 'Cláusula 2ª — Honorários',
  parcelas: 'Cláusula 2ª — Honorários',
  valorParcela: 'Cláusula 2ª — Honorários',
  percentualExito: 'Cláusula 2ª — Honorários',
  dataPrimeiraParcela: 'Cláusula 2ª — Honorários',
};

export default function LivePreview({ tab }) {
  const { data } = useContract();
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(100);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeSection, setActiveSection] = useState('');
  const debounceRef = useRef(null);
  const prevHtmlRef = useRef('');
  const iframeRef = useRef(null);

  const html = useMemo(() => {
    if (tab === 'procuracao') return generateProcuracaoHTML(data, false);
    return generateContractHTML(data, false);
  }, [data, tab]);

  const generatePdf = useCallback(async (htmlContent) => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${API_URL}/api/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlContent, returnPageCount: true }),
      });
      if (!resp.ok) throw new Error('Erro ao gerar PDF');
      // Check if response has page count header
      const pages = resp.headers.get('X-Page-Count');
      if (pages) setPageCount(parseInt(pages) || 0);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced PDF generation
  useEffect(() => {
    if (html === prevHtmlRef.current) return;
    prevHtmlRef.current = html;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => generatePdf(html), 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [html, generatePdf]);

  // Generate on tab change
  useEffect(() => { generatePdf(html); setCurrentPage(1); }, [tab]);

  // Cleanup
  useEffect(() => { return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }; }, []);

  // Listen for focus events on form fields to show section highlight
  const sectionTimerRef = useRef(null);
  useEffect(() => {
    const detectSection = (input) => {
      if (!input || input.tagName !== 'INPUT' && input.tagName !== 'SELECT' && input.tagName !== 'TEXTAREA') return null;
      const name = input.name || '';
      const placeholder = (input.placeholder || '').toLowerCase();
      const labelEl = input.closest('div')?.querySelector('.label-field') || input.previousElementSibling;
      const label = (labelEl?.textContent || '').toLowerCase();
      const allText = `${name} ${label} ${placeholder}`;

      if (/cpf|rg\b|nome|nacionalidade|profiss|estado civil|e-mail|email/.test(allText)) return 'Preâmbulo — Qualificação';
      if (/endere|cep|bairro|cidade|complemento|\buf\b/.test(allText)) return 'Preâmbulo — Endereço';
      if (/resort|acao|empreendimento/.test(allText)) return 'Objeto da Ação';
      if (/honorar|parcela|exito|total|data da 1/.test(allText)) return 'Cláusula 2ª — Honorários';
      return null;
    };

    const handleFocusIn = (e) => {
      if (sectionTimerRef.current) clearTimeout(sectionTimerRef.current);
      const section = detectSection(e.target);
      if (section) setActiveSection(section);
    };

    const handleFocusOut = () => {
      sectionTimerRef.current = setTimeout(() => setActiveSection(''), 1500);
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      if (sectionTimerRef.current) clearTimeout(sectionTimerRef.current);
    };
  }, []);

  const zoomIn = () => setZoom(z => Math.min(z + 20, 200));
  const zoomOut = () => setZoom(z => Math.max(z - 20, 50));
  const zoomReset = () => setZoom(100);

  // Navigate to page via PDF viewer URL hash
  const goToPage = (page) => {
    setCurrentPage(page);
    if (iframeRef.current && pdfUrl) {
      iframeRef.current.src = `${pdfUrl}#page=${page}`;
    }
  };

  // Estimate page count from content if header not available
  const estimatedPages = pageCount || (tab === 'procuracao' ? 1 : (data.numContratantes === 2 ? 4 : 3));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden h-full flex flex-col" style={{ boxShadow: '0 1px 6px rgba(0,0,0,.09)' }}>
      {/* Toolbar: zoom + page nav + section indicator */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1 border-b border-gray-100 dark:border-gray-700" style={{ background: '#FAFBFC' }}>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 cursor-pointer text-xs font-bold" title="Zoom -">−</button>
          <button onClick={zoomReset} className="px-1.5 h-6 rounded text-[9px] font-bold text-gray-500 hover:bg-gray-200 cursor-pointer" title="Reset zoom">{zoom}%</button>
          <button onClick={zoomIn} className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 cursor-pointer text-xs font-bold" title="Zoom +">+</button>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          {/* Page navigation */}
          <button onClick={() => goToPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-200 cursor-pointer disabled:opacity-30 disabled:cursor-default text-[10px]">‹</button>
          <span className="text-[9px] font-bold text-gray-500 min-w-[40px] text-center">{currentPage}/{estimatedPages}</span>
          <button onClick={() => goToPage(Math.min(estimatedPages, currentPage + 1))} disabled={currentPage >= estimatedPages}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-200 cursor-pointer disabled:opacity-30 disabled:cursor-default text-[10px]">›</button>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-[9px] font-bold uppercase tracking-wide animate-pulse" style={{ color: '#1B3A5C' }}>
              Gerando...
            </span>
          )}
          {error && <span className="text-[9px] font-bold text-red-500">{error}</span>}
        </div>
      </div>

      {/* Active section indicator — shows which part of the contract you're editing */}
      {activeSection && (
        <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 transition-all duration-300"
          style={{ background: 'linear-gradient(90deg, #EEF4FF, #F0F9FF)', borderBottom: '1px solid #C0D0E8' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
          <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: '#1B3A5C' }}>
            Editando: {activeSection}
          </span>
        </div>
      )}

      {/* Main content: PDF viewer + minimap */}
      <div className="flex-1 flex overflow-hidden">
        {/* PDF viewer */}
        {pdfUrl ? (
          <div className="flex-1 overflow-auto relative">
            <iframe
              ref={iframeRef}
              src={pdfUrl}
              className="border-none"
              style={{
                width: `${zoom}%`,
                height: `${zoom}%`,
                minWidth: '100%',
                minHeight: '100%',
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top left',
              }}
              title={tab === 'procuracao' ? 'Procuracao' : 'Contrato'}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            {loading ? 'Gerando preview...' : 'Preencha o formulario para visualizar'}
          </div>
        )}

        {/* Minimap — page thumbnails sidebar */}
        {pdfUrl && estimatedPages > 1 && (
          <div className="w-10 shrink-0 border-l border-gray-100 dark:border-gray-700 overflow-y-auto flex flex-col items-center gap-1.5 py-2"
            style={{ background: '#F8FAFC' }}>
            {Array.from({ length: estimatedPages }, (_, i) => i + 1).map(page => (
              <button key={page} onClick={() => goToPage(page)}
                className={`w-7 h-9 rounded border text-[8px] font-bold flex items-center justify-center cursor-pointer transition-all ${
                  currentPage === page
                    ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-300'
                    : 'border-gray-200 bg-white text-gray-400 hover:border-gray-400 hover:bg-gray-50'
                }`}
                title={`Página ${page}`}>
                {page}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
