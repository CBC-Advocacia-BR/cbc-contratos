// (#99) Comentarios internos por contrato — thread com @mentions
// Realtime via Supabase channel. Edit/delete proprio dentro de 5min.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../Toast';
import {
  ChatBubbleLeftEllipsisIcon,
  PaperAirplaneIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

const EDIT_WINDOW_MS = 5 * 60 * 1000;

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

// Extrai @emails do texto: @paulo@advocaciacbc.com
function extractMentions(body) {
  const re = /@([\w._-]+@[\w._-]+\.\w+)/g;
  const set = new Set();
  let m;
  while ((m = re.exec(body)) !== null) set.add(m[1].toLowerCase());
  return [...set];
}

export default function ContractComments({ contratoId, currentUserEmail, currentUserId }) {
  const toast = useToast();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(null); // {id, body}
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('contrato_comentarios')
        .select('*')
        .eq('contrato_id', contratoId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setComments(data || []);
    } catch (err) {
      console.error('[Comments] load', err);
    } finally {
      setLoading(false);
    }
  }, [contratoId]);

  useEffect(() => { load(); }, [load]);

  // Realtime: novos comentarios aparecem ao vivo
  useEffect(() => {
    if (!contratoId) return;
    const channel = supabase
      .channel(`comments-${contratoId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'contrato_comentarios', filter: `contrato_id=eq.${contratoId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setComments(prev => prev.some(c => c.id === payload.new.id) ? prev : [...prev, payload.new]);
          } else if (payload.eventType === 'UPDATE') {
            setComments(prev => prev.map(c => c.id === payload.new.id ? payload.new : c));
          } else if (payload.eventType === 'DELETE') {
            setComments(prev => prev.filter(c => c.id !== payload.old.id));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [contratoId]);

  const handleSubmit = async () => {
    const text = body.trim();
    if (!text) return;
    setPosting(true);
    try {
      const mentions = extractMentions(text);
      const { error } = await supabase.from('contrato_comentarios').insert({
        contrato_id: contratoId,
        user_id: currentUserId,
        user_email: currentUserEmail,
        body: text,
        mentions,
      });
      if (error) throw error;
      setBody('');
      // Realtime trara o novo registro; nao precisa reload
      toast.success('Comentario adicionado');
    } catch (err) {
      toast.error('Falha ao comentar: ' + err.message);
    } finally {
      setPosting(false);
    }
  };

  const handleSubmitEdit = async () => {
    const text = editing.body.trim();
    if (!text) return;
    try {
      const mentions = extractMentions(text);
      const { error } = await supabase
        .from('contrato_comentarios')
        .update({ body: text, mentions, edited_at: new Date().toISOString() })
        .eq('id', editing.id);
      if (error) throw error;
      setEditing(null);
      toast.success('Comentario atualizado');
    } catch (err) {
      toast.error('Falha ao editar: ' + err.message);
    }
  };

  const handleDelete = async (c) => {
    if (!confirm('Excluir este comentario?')) return;
    try {
      const { error } = await supabase.from('contrato_comentarios').delete().eq('id', c.id);
      if (error) throw error;
      toast.success('Comentario excluido');
    } catch (err) {
      toast.error('Falha ao excluir: ' + err.message);
    }
  };

  const canEdit = (c) => {
    if (c.user_id !== currentUserId) return false;
    const age = Date.now() - new Date(c.created_at).getTime();
    return age < EDIT_WINDOW_MS;
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <ChatBubbleLeftEllipsisIcon className="w-4 h-4 text-navy" aria-hidden="true" />
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-navy">
          Comentarios internos {comments.length > 0 ? `(${comments.length})` : ''}
        </h4>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto pr-1 mb-2.5">
        {loading ? (
          <div className="text-[11px] text-gray-400 italic py-3 text-center">Carregando...</div>
        ) : comments.length === 0 ? (
          <div className="text-[11px] text-gray-400 italic py-3 text-center">
            Nenhum comentario. Use @email para mencionar colegas.
          </div>
        ) : (
          comments.map(c => {
            const isMe = c.user_id === currentUserId;
            const isEditing = editing?.id === c.id;
            return (
              <div key={c.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                <div className="w-6 h-6 rounded-full bg-navy/15 text-navy flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                  {(c.user_email || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className={`flex-1 min-w-0 ${isMe ? 'text-right' : ''}`}>
                  <div className={`inline-block max-w-full text-left rounded-lg px-2.5 py-1.5 ${isMe ? 'bg-navy/10' : 'bg-gray-100'}`}>
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editing.body}
                          onChange={e => setEditing({ ...editing, body: e.target.value })}
                          rows={2}
                          className="w-full border border-gray-300 rounded text-[12px] px-2 py-1 focus:outline-none focus:border-navy"
                        />
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => setEditing(null)} className="text-[10px] px-2 py-0.5 text-gray-500 hover:text-gray-700">
                            <XMarkIcon className="w-3 h-3 inline" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={handleSubmitEdit} className="text-[10px] px-2 py-0.5 text-green-600 hover:bg-green-50 rounded">
                            <CheckIcon className="w-3 h-3 inline" aria-hidden="true" /> Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-[10px] font-bold text-navy mb-0.5">
                          {(c.user_email || '').split('@')[0]}
                          <span className="text-[9px] text-gray-400 font-normal ml-1.5">
                            {relTime(c.created_at)}
                            {c.edited_at && <span title={new Date(c.edited_at).toLocaleString('pt-BR')}> · editado</span>}
                          </span>
                        </div>
                        <div className="text-[12px] text-gray-800 whitespace-pre-wrap break-words leading-snug">
                          {c.body.split(/(@[\w._-]+@[\w._-]+\.\w+)/g).map((part, i) =>
                            part.startsWith('@') ? (
                              <span key={i} className="text-blue-600 font-semibold">{part}</span>
                            ) : (
                              <span key={i}>{part}</span>
                            )
                          )}
                        </div>
                        {isMe && canEdit(c) && (
                          <div className="flex justify-end gap-0.5 mt-1">
                            <button type="button" onClick={() => setEditing({ id: c.id, body: c.body })} className="text-[9px] text-gray-500 hover:text-navy p-0.5">
                              <PencilIcon className="w-3 h-3" aria-hidden="true" />
                            </button>
                            <button type="button" onClick={() => handleDelete(c)} className="text-[9px] text-gray-500 hover:text-red-600 p-0.5">
                              <TrashIcon className="w-3 h-3" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-1.5 items-end">
        <textarea
          ref={inputRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSubmit(); } }}
          placeholder="Escreva um comentario... (use @email para mencionar)"
          rows={2}
          disabled={posting}
          className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-navy resize-none"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={posting || !body.trim()}
          className="btn-primary text-[10px] px-3 py-2 disabled:opacity-40 flex items-center gap-1 shrink-0"
          title="Enviar (Ctrl+Enter)"
        >
          <PaperAirplaneIcon className="w-3.5 h-3.5" aria-hidden="true" />
          Enviar
        </button>
      </div>
    </div>
  );
}
