// (#97, #327) Indicador visual de presenca + alerta de edicao concorrente
// Mostra avatares dos peers + warning amarelo se alguem esta editando

import { useMemo } from 'react';
import { usePresence } from '../../hooks/usePresence';
import { PencilSquareIcon, EyeIcon } from '@heroicons/react/24/outline';

function initialsFromEmail(email) {
  if (!email) return '?';
  const local = email.split('@')[0];
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

// Gera cor consistente a partir do email
function colorFromEmail(email) {
  if (!email) return '#9CA3AF';
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) & 0x7fffffff;
  const palette = ['#1B3A5C', '#C9A84C', '#2563EB', '#16A34A', '#7C3AED', '#DC2626', '#EA580C', '#0891B2'];
  return palette[h % palette.length];
}

export default function PresenceIndicator({ topic, currentUserEmail, mode = 'viewing' }) {
  const { peers } = usePresence({
    topic,
    state: { email: currentUserEmail, mode },
    enabled: !!currentUserEmail && !!topic,
  });

  // Filtra fora o usuario atual e calcula quem esta editando
  const others = useMemo(() => (peers || []).filter(p => p.email !== currentUserEmail), [peers, currentUserEmail]);
  const editing = useMemo(() => others.filter(p => p.mode === 'editing'), [others]);

  if (others.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap" role="status" aria-live="polite">
      {editing.length > 0 && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
          <PencilSquareIcon className="w-3.5 h-3.5" aria-hidden="true" />
          {editing.map(p => p.email.split('@')[0]).join(', ')} {editing.length === 1 ? 'esta editando' : 'estao editando'}
        </div>
      )}
      <div className="flex items-center gap-0.5">
        <EyeIcon className="w-3.5 h-3.5 text-gray-400 mr-0.5" aria-hidden="true" />
        <div className="flex -space-x-1.5">
          {others.slice(0, 5).map(p => (
            <div
              key={p.email}
              title={`${p.email}${p.mode === 'editing' ? ' (editando)' : ' (visualizando)'}`}
              className="w-6 h-6 rounded-full ring-2 ring-white flex items-center justify-center text-[9px] font-bold text-white"
              style={{ background: colorFromEmail(p.email) }}
            >
              {initialsFromEmail(p.email)}
            </div>
          ))}
          {others.length > 5 && (
            <div className="w-6 h-6 rounded-full ring-2 ring-white bg-gray-200 text-gray-600 flex items-center justify-center text-[9px] font-bold">
              +{others.length - 5}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
