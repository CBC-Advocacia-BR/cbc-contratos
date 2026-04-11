// Editor rico leve baseado em contenteditable.
//
// Oferece formatação básica (negrito, itálico, sublinhado, listas,
// alinhamento) via document.execCommand + inserção inteligente de
// placeholders via autocomplete ao digitar `{{`.
//
// Em vez de TipTap/Quill (ambos pesam muito e exigem muito
// wiring), usamos a API nativa do browser — suficiente para petições,
// onde o que importa é o texto e placeholders, não formatação avançada.

import { useEffect, useRef, useState, useCallback } from 'react';

const TOOLBAR = [
  { cmd: 'bold',       label: 'B',      title: 'Negrito (Ctrl+B)',     className: 'font-bold' },
  { cmd: 'italic',     label: 'I',      title: 'Itálico (Ctrl+I)',     className: 'italic' },
  { cmd: 'underline',  label: 'U',      title: 'Sublinhado (Ctrl+U)',  className: 'underline' },
  { cmd: 'separator' },
  { cmd: 'justifyLeft',   label: '⇤', title: 'Alinhar à esquerda' },
  { cmd: 'justifyCenter', label: '≡', title: 'Centralizar' },
  { cmd: 'justifyRight',  label: '⇥', title: 'Alinhar à direita' },
  { cmd: 'justifyFull',   label: '☰', title: 'Justificar' },
  { cmd: 'separator' },
  { cmd: 'insertOrderedList',   label: '1.', title: 'Lista numerada' },
  { cmd: 'insertUnorderedList', label: '•',  title: 'Lista com marcadores' },
  { cmd: 'separator' },
  { cmd: 'removeFormat', label: '⌫', title: 'Limpar formatação' },
];

export default function RichEditor({
  value = '',
  onChange,
  disabled = false,
  placeholderKeys = [],
  rows = 8,
  placeholder = '',
}) {
  const ref = useRef(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const [autocompletePos, setAutocompletePos] = useState({ top: 0, left: 0 });
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Sincroniza conteúdo externo → interno (evita sobrescrever durante digitação)
  useEffect(() => {
    if (!ref.current) return;
    if (ref.current.innerHTML !== value) ref.current.innerHTML = value || '';
  }, [value]);

  const emit = useCallback(() => {
    if (!ref.current) return;
    onChange?.(ref.current.innerHTML);
  }, [onChange]);

  const exec = (cmd) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(cmd, false, null);
    emit();
  };

  const filteredKeys = placeholderKeys
    .filter((k) => k.toLowerCase().includes(autocompleteQuery.toLowerCase()))
    .slice(0, 8);

  const insertPlaceholder = (key) => {
    if (!ref.current) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);

    // Apaga o que já está após o `{{` incompleto
    const n = autocompleteQuery.length + 2;
    for (let i = 0; i < n; i++) {
      range.setStart(range.endContainer, Math.max(0, range.endOffset - 1));
      range.deleteContents();
    }

    const text = document.createTextNode(`{{${key}}}`);
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    setShowAutocomplete(false);
    setAutocompleteQuery('');
    emit();
  };

  const handleKeyDown = (e) => {
    if (showAutocomplete) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filteredKeys.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredKeys[selectedIdx]) { e.preventDefault(); insertPlaceholder(filteredKeys[selectedIdx]); return; }
      }
      if (e.key === 'Escape') { setShowAutocomplete(false); return; }
    }
  };

  const handleInput = () => {
    if (!ref.current) return;
    emit();
    // Detecta `{{` aberto até cursor → ativa autocomplete
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.endContainer;
    const offset = range.endOffset;
    const text = (node.nodeValue || '').slice(0, offset);
    const m = text.match(/\{\{([a-zA-Z0-9_]*)$/);
    if (m) {
      setAutocompleteQuery(m[1]);
      setShowAutocomplete(true);
      setSelectedIdx(0);
      // Posição: usa getBoundingClientRect do range clonado
      const r = range.cloneRange();
      const rect = r.getBoundingClientRect();
      const editorRect = ref.current.getBoundingClientRect();
      setAutocompletePos({
        top: rect.bottom - editorRect.top + 4,
        left: rect.left - editorRect.left,
      });
    } else {
      setShowAutocomplete(false);
    }
  };

  const handleBlur = () => {
    // Pequeno delay para permitir clique no autocomplete
    setTimeout(() => setShowAutocomplete(false), 150);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        {TOOLBAR.map((t, i) => {
          if (t.cmd === 'separator') return <span key={i} className="w-px h-5 bg-slate-300 mx-1" />;
          return (
            <button
              key={t.cmd}
              type="button"
              disabled={disabled}
              title={t.title}
              onMouseDown={(e) => { e.preventDefault(); exec(t.cmd); }}
              className={`w-7 h-7 rounded text-sm text-slate-700 hover:bg-slate-200 cursor-pointer ${t.className || ''} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {t.label}
            </button>
          );
        })}
        {placeholderKeys.length > 0 && (
          <span className="text-[10px] text-slate-400 ml-2">
            Digite <code className="bg-slate-100 px-1 rounded">{'{{'}</code> para inserir placeholder
          </span>
        )}
      </div>

      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="rich-editor w-full border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-500 bg-white"
        style={{ minHeight: `${rows * 1.6}em`, lineHeight: 1.6 }}
        data-placeholder={placeholder}
      />

      {showAutocomplete && filteredKeys.length > 0 && (
        <div
          className="absolute z-10 bg-white border border-slate-300 rounded-lg shadow-lg py-1 text-xs min-w-[180px]"
          style={{ top: autocompletePos.top, left: autocompletePos.left }}
        >
          {filteredKeys.map((k, i) => (
            <div
              key={k}
              className={`px-3 py-1.5 cursor-pointer ${i === selectedIdx ? 'bg-slate-100' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertPlaceholder(k); }}
            >
              <code>{`{{${k}}}`}</code>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .rich-editor[data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
