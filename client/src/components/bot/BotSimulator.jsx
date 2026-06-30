import { useState, useRef, useEffect, useCallback } from 'react';
import { botApi } from './botApi';
import {
  PaperAirplaneIcon, ArrowPathIcon, MagnifyingGlassIcon, UserCircleIcon,
  ScaleIcon, ClipboardDocumentIcon, CheckIcon,
} from '@heroicons/react/24/outline';

const newChannel = () => `painel-${Math.random().toString(36).slice(2, 10)}`;

const SUGESTOES = [
  'Como está meu processo?',
  'Tem alguma novidade?',
  'Tenho audiência marcada?',
  'O que vocês estão fazendo no meu caso?',
  'Quero falar com meu advogado',
  'Quanto falta pagar?',
];

export default function BotSimulator() {
  const [channel, setChannel] = useState(newChannel);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [identity, setIdentity] = useState(null); // {id, name, identification}
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const reset = () => { setChannel(newChannel()); setMessages([]); setIdentity(null); };

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true); setResults(null);
    try {
      // numero CNJ? busca processo; senao busca cliente
      if (/^\d{7}-?\d{2}\.?\d{4}/.test(q.replace(/\s/g, ''))) {
        const r = await botApi('search_lawsuit', { process_number: q });
        if (r.lawsuit) {
          const cust = (r.lawsuit.customers || []).find(c => c.origin !== 'PARTE CONTRARIA') || (r.lawsuit.customers || [])[0];
          setResults(cust ? [{ id: cust.customer_id, name: cust.name, identification: cust.identification, processo: r.lawsuit.process_number }] : []);
        } else setResults([]);
      } else {
        const r = await botApi('search_customers', { query: q });
        setResults(r.customers || []);
      }
    } catch (e) {
      setResults([]);
      setMessages(m => [...m, { role: 'sys', text: `Erro na busca: ${e.message}` }]);
    } finally { setSearching(false); }
  }, [query]);

  const pick = (c) => {
    setIdentity(c); setResults(null); setQuery('');
    setMessages(m => [...m, { role: 'sys', text: `Você agora está simulando ${c.name}${c.identification ? ` (${c.identification})` : ''}. Converse como se fosse o cliente.` }]);
  };

  const send = async (textArg) => {
    const text = (textArg || input).trim();
    if (!text || sending) return;
    setInput(''); setSending(true);
    setMessages(m => [...m, { role: 'user', text }]);
    try {
      const r = await botApi('chat', {
        channel, text,
        customerId: identity?.id || undefined,
        customerName: identity?.name || undefined,
      });
      setMessages(m => [...m, { role: 'bot', text: r.reply, intent: r.intent, escalate: r.escalate, ms: r.meta?.ms }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'sys', text: `Erro: ${e.message}` }]);
    } finally { setSending(false); }
  };

  const copy = async (text, idx) => {
    try { await navigator.clipboard.writeText(text); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500); } catch { /* sem clipboard */ }
  };

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* Identidade */}
      <div className="card p-4 md:col-span-1 max-sm:order-2">
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-2">
          <UserCircleIcon className="w-4 h-4" /> Quem você está simulando
        </h3>
        {identity ? (
          <div className="text-sm bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-3">
            <div className="font-bold">{identity.name}</div>
            {identity.identification && <div className="text-xs opacity-70">CPF: {identity.identification}</div>}
            {identity.processo && <div className="text-xs opacity-70">Processo: {identity.processo}</div>}
            <button className="text-xs underline mt-1 opacity-70 hover:opacity-100" onClick={() => setIdentity(null)}>trocar</button>
          </div>
        ) : (
          <p className="text-xs opacity-60 mb-2">Busque QUALQUER cliente ou processo do ADVBOX para testar — por nome, CPF ou número CNJ. Sem seleção, o bot pedirá CPF (fluxo real de identificação).</p>
        )}
        <div className="flex gap-1">
          <input className="input-field flex-1 text-sm" placeholder="Nome, CPF ou nº do processo"
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
          <button className="btn-outline px-3" onClick={search} disabled={searching} title="Buscar no ADVBOX">
            {searching ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <MagnifyingGlassIcon className="w-4 h-4" />}
          </button>
        </div>
        {results && (
          <div className="mt-2 max-h-48 overflow-auto divide-y divide-gray-100 dark:divide-gray-700 border rounded-lg">
            {results.length === 0 && <div className="p-2 text-xs opacity-60">Nada encontrado no ADVBOX.</div>}
            {results.map((c, i) => (
              <button key={i} className="block w-full text-left p-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => pick(c)}>
                <span className="font-medium">{c.name}</span>
                <span className="text-xs opacity-60 ml-1">{c.identification || ''}{c.lawsuits ? ` · ${c.lawsuits} processo(s)` : ''}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-4">
          <h4 className="text-[11px] font-bold uppercase tracking-wide opacity-60 mb-1">Perguntas de teste</h4>
          <div className="flex flex-wrap gap-1">
            {SUGESTOES.map(s => (
              <button key={s} className="text-xs px-2 py-1 rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
          <p className="text-[11px] opacity-50 mt-3">Comandos: <code>#cliente nome</code>, <code>#processo 0001234-...</code>, <code>#reset</code>, <code>#ajuda</code></p>
        </div>
      </div>

      {/* Chat */}
      <div className="card p-0 md:col-span-2 flex flex-col max-sm:order-1 max-sm:h-[55dvh] max-sm:min-h-0!" style={{ minHeight: 480 }}>
        <div className="card-header flex items-center justify-between px-4 py-2">
          <span className="flex items-center gap-2 text-sm"><ScaleIcon className="w-4 h-4" /> Simulador — converse como o cliente</span>
          <button className="text-xs underline opacity-80 hover:opacity-100" onClick={reset}>
            <ArrowPathIcon className="w-3 h-3 inline mr-1" />nova conversa
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900/40">
          {messages.length === 0 && (
            <div className="text-center text-sm opacity-50 mt-10">
              Envie uma mensagem como se fosse o cliente no WhatsApp.<br />
              Ex.: “Oi, queria saber do meu processo”
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap shadow-sm ${
                m.role === 'user' ? 'bg-[#1B3A5C] text-white rounded-br-sm'
                : m.role === 'bot' ? 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-bl-sm'
                : 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs'
              }`}>
                {m.text}
                {m.role === 'bot' && (
                  <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700">
                    {m.intent && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">{m.intent}</span>}
                    {m.escalate && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-700">escalado</span>}
                    {m.ms && <span className="text-[10px] opacity-40">{(m.ms / 1000).toFixed(1)}s</span>}
                    <button className="ml-auto opacity-40 hover:opacity-100" title="Copiar resposta" onClick={() => copy(m.text, i)}>
                      {copiedIdx === i ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && <div className="text-xs opacity-50 animate-pulse">bot consultando o ADVBOX…</div>}
          <div ref={bottomRef} />
        </div>
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <input className="input-field flex-1" placeholder="Digite como se fosse o cliente…"
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()} disabled={sending} />
          <button className="btn-primary px-4" onClick={() => send()} disabled={sending || !input.trim()}>
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
