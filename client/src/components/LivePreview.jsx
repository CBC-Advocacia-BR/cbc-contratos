import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useContract } from '../ContractContext';
import { generateContractHTML, generateProcuracaoHTML } from '../utils/contractHtml';
// pdfGenerator importado dinamicamente (lazy) (#112)

// Section mapping: which form fields map to which contract sections
const SECTION_MAP = {
  nome: 'Preambulo — Qualificacao',
  cpf: 'Preambulo — Qualificacao',
  rg: 'Preambulo — Qualificacao',
  nacionalidade: 'Preambulo — Qualificacao',
  profissao: 'Preambulo — Qualificacao',
  estadoCivil: 'Preambulo — Qualificacao',
  email: 'Preambulo — Qualificacao',
  endereco: 'Preambulo — Endereco',
  complemento: 'Preambulo — Endereco',
  bairro: 'Preambulo — Endereco',
  cidade: 'Preambulo — Endereco',
  uf: 'Preambulo — Endereco',
  cep: 'Preambulo — Endereco',
  resort: 'Objeto da Acao',
  tipoAcao: 'Objeto da Acao',
  total: 'Clausula 2a — Honorarios',
  parcelas: 'Clausula 2a — Honorarios',
  valorParcela: 'Clausula 2a — Honorarios',
  percentualExito: 'Clausula 2a — Honorarios',
  dataPrimeiraParcela: 'Clausula 2a — Honorarios',
};

// (mobile 06/2026) iOS/iPadOS Safari renderiza só a 1ª página de PDF em
// <iframe>, sem scroll — o preview ficava inutilizável em touch. Nesses
// dispositivos renderizamos o PRÓPRIO HTML do contrato (mesma fonte do PDF)
// num iframe srcDoc rolável, escalado para caber na tela. Bônus: pula a
// geração de PDF (jspdf/html2canvas) a cada tecla — economia grande de
// CPU/bateria no iPhone. Desktop segue no caminho do PDF, intocado.
const IS_TOUCH_PREVIEW = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const HTML_PAGE_WIDTH = 800; // largura A4 aproximada do HTML do contrato

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
  // (mobile 06/2026) modo HTML touch
  const [htmlDocHeight, setHtmlDocHeight] = useState(1130);
  const [wrapWidth, setWrapWidth] = useState(0);
  const htmlWrapRef = useRef(null);
  const htmlFrameRef = useRef(null);
  const htmlDocHeightRef = useRef(1130);
  // srcDoc com debounce: sem ele, cada tecla recarregava o iframe no iPad
  const [touchHtml, setTouchHtml] = useState(null);

  useEffect(() => {
    if (!IS_TOUCH_PREVIEW) return;
    const el = htmlWrapRef.current;
    if (!el) return;
    const measure = () => setWrapWidth(el.clientWidth || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measureHtmlDoc = useCallback(() => {
    try {
      const frame = htmlFrameRef.current;
      const doc = frame?.contentDocument;
      if (!frame || !doc?.body) return;
      // (fix review 12/06) Mede a altura REAL do conteúdo encolhendo o iframe
      // momentaneamente: scrollHeight nunca fica menor que a altura do próprio
      // iframe, então medir com a altura atual criava um ratchet de +40px a
      // cada reload do srcDoc (crescimento sem limite no iPad).
      const prevH = frame.style.height;
      frame.style.height = '10px';
      const h = doc.body.scrollHeight;
      frame.style.height = prevH;
      const novo = h + 40;
      if (h > 100 && Math.abs(novo - htmlDocHeightRef.current) > 4) {
        htmlDocHeightRef.current = novo;
        setHtmlDocHeight(novo);
      }
    } catch { /* same-origin srcDoc — não deve falhar */ }
  }, []);

  // (perf-fe-13) O HTML e remontado por inteiro a cada mudanca de `data`. O
  // useMemo abaixo ja evita recomputar quando nem `data` nem `tab` mudam (ex.:
  // re-render por zoom/pagina/secao). Quebrar a granularidade (memoizar so
  // cabecalho/clausulas estaveis) exigiria refatorar generateContractHTML p/
  // receber campos isolados — mudanca arriscada que pode alterar o HTML/PDF
  // gerado. Mantido conservador: o custo real foi mitigado pelo debounce de
  // 1200ms + flush no blur (perf-fe-3). Nao remover o useMemo.
  const html = useMemo(() => {
    if (tab === 'procuracao') return generateProcuracaoHTML(data, false);
    return generateContractHTML(data, false);
  }, [data, tab]);

  // (fix review 12/06) Debounce do srcDoc em touch — espelha o debounce de
  // 700ms do caminho PDF; sem isso cada tecla recarregava o iframe inteiro.
  // (fix 14/06) Precisa vir DEPOIS de `const html` — o dep array `[html]` é
  // avaliado no render e dava TDZ ("Cannot access 'html' before initialization").
  useEffect(() => {
    if (!IS_TOUCH_PREVIEW) return;
    if (touchHtml === null) { setTouchHtml(html); return; }
    const t = setTimeout(() => setTouchHtml(html), 600);
    return () => clearTimeout(t);
  }, [html]); // eslint-disable-line react-hooks/exhaustive-deps

  const generatePdf = useCallback(async (htmlContent) => {
    setLoading(true);
    setError('');
    try {
      const { generatePdfFromHtml } = await import('../utils/pdfGenerator');
      const { blob, pageCount: pages } = await generatePdfFromHtml(htmlContent);
      if (pages) setPageCount(pages);
      const url = URL.createObjectURL(blob);
      setPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // (perf-fe-3 / custo-4) Mantem o ultimo HTML pendente para que o blur de um
  // campo possa antecipar a geracao do PDF sem esperar o debounce inteiro.
  const pendingHtmlRef = useRef('');

  // Debounced PDF generation — (mobile 06/2026) pulada em touch (preview HTML)
  // (perf-fe-3 / custo-4) Debounce subiu de 700ms para 1200ms: a geracao de PDF
  // (html2canvas+jspdf) e cara de CPU; menos regeracoes por pausa de digitacao.
  // O blur do campo (focusout, mais abaixo) faz o flush antecipado.
  useEffect(() => {
    if (IS_TOUCH_PREVIEW) return;
    if (html === prevHtmlRef.current) return;
    prevHtmlRef.current = html;
    pendingHtmlRef.current = html;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { pendingHtmlRef.current = ''; generatePdf(html); }, 1200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [html, generatePdf]);

  // Generate on tab change — (mobile 06/2026) pulada em touch
  useEffect(() => {
    if (IS_TOUCH_PREVIEW) return;
    generatePdf(html);
    setCurrentPage(1);
  }, [tab]);

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

      if (/cpf|rg\b|nome|nacionalidade|profiss|estado civil|e-mail|email/.test(allText)) return 'Preambulo — Qualificacao';
      if (/endere|cep|bairro|cidade|complemento|\buf\b/.test(allText)) return 'Preambulo — Endereco';
      if (/resort|acao|empreendimento/.test(allText)) return 'Objeto da Acao';
      if (/honorar|parcela|exito|total|data da 1/.test(allText)) return 'Clausula 2a — Honorarios';
      return null;
    };

    const handleFocusIn = (e) => {
      if (sectionTimerRef.current) clearTimeout(sectionTimerRef.current);
      const section = detectSection(e.target);
      if (section) setActiveSection(section);
    };

    const handleFocusOut = () => {
      sectionTimerRef.current = setTimeout(() => setActiveSection(''), 1500);
      // (perf-fe-3 / custo-4) Ao sair de um campo (desktop), antecipa a geracao
      // do PDF pendente em vez de esperar o restante do debounce de 1200ms.
      if (!IS_TOUCH_PREVIEW && pendingHtmlRef.current) {
        const htmlToFlush = pendingHtmlRef.current;
        pendingHtmlRef.current = '';
        if (debounceRef.current) clearTimeout(debounceRef.current);
        generatePdf(htmlToFlush);
      }
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

  // (mobile 06/2026) Preview HTML para dispositivos touch
  if (IS_TOUCH_PREVIEW) {
    const fitScale = wrapWidth > 0 ? (wrapWidth / HTML_PAGE_WIDTH) * (zoom / 100) : zoom / 100;
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden h-full min-h-[60dvh] flex flex-col" style={{ boxShadow: '0 1px 6px rgba(0,0,0,.09)' }}>
        {/* Toolbar simplificada: zoom (scroll contínuo substitui paginação) */}
        <div className="shrink-0 flex items-center justify-between px-2 py-1 border-b border-gray-100 dark:border-gray-700" style={{ background: 'var(--cbc-bg-subtle, #FAFBFC)' }}>
          <div className="flex items-center gap-1">
            <button onClick={zoomOut} className="w-9 h-9 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 cursor-pointer text-base font-bold no-touch-min" title="Diminuir zoom" aria-label="Diminuir zoom">−</button>
            <button onClick={zoomReset} className="px-2 h-9 rounded text-[11px] font-bold text-gray-500 hover:bg-gray-200 cursor-pointer no-touch-min" title="Restaurar zoom" aria-label="Restaurar zoom">{zoom}%</button>
            <button onClick={zoomIn} className="w-9 h-9 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 cursor-pointer text-base font-bold no-touch-min" title="Aumentar zoom" aria-label="Aumentar zoom">+</button>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide pr-1" style={{ color: 'var(--cbc-text-muted, #6B7280)' }}>
            {tab === 'procuracao' ? 'Procuração' : 'Contrato'}
          </span>
        </div>
        {activeSection && (
          <div className="shrink-0 px-3 py-1.5 flex items-center gap-2"
            style={{ background: 'linear-gradient(90deg, #EEF4FF, #F0F9FF)', borderBottom: '1px solid #C0D0E8' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#1B3A5C' }}>
              Editando: {activeSection}
            </span>
          </div>
        )}
        <div ref={htmlWrapRef} className="flex-1 overflow-auto scroll-smooth-touch" style={{ background: '#E9EDF2' }}>
          <div style={{ width: HTML_PAGE_WIDTH * fitScale, height: htmlDocHeight * fitScale, margin: '0 auto' }}>
            <iframe
              ref={htmlFrameRef}
              srcDoc={touchHtml ?? html}
              onLoad={measureHtmlDoc}
              title={tab === 'procuracao' ? 'Procuração' : 'Contrato'}
              style={{
                width: HTML_PAGE_WIDTH,
                height: htmlDocHeight,
                border: 'none',
                background: 'white',
                transform: `scale(${fitScale})`,
                transformOrigin: 'top left',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </div>
    );
  }

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
                title={`Pagina ${page}`}>
                {page}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
