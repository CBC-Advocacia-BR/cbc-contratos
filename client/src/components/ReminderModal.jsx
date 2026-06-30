// (#215) Lembretes parametrizaveis — quando + mensagem + recorrencia
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';

const PRESETS = [
  { label: 'Em 1 hora',     hours: 1 },
  { label: 'Em 3 horas',    hours: 3 },
  { label: 'Amanha 9h',     custom: 'tomorrow9' },
  { label: 'Em 3 dias',     hours: 24 * 3 },
  { label: 'Em 1 semana',   hours: 24 * 7 },
  { label: 'Personalizado', custom: 'custom' },
];

function computeFireAt(preset, customDate) {
  const now = new Date();
  if (preset.hours) {
    const d = new Date(now.getTime() + preset.hours * 60 * 60 * 1000);
    return d.toISOString();
  }
  if (preset.custom === 'tomorrow9') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  if (preset.custom === 'custom' && customDate) {
    return new Date(customDate).toISOString();
  }
  return null;
}

export default function ReminderModal({ contratoId, contratoNome, userEmail, onClose }) {
  const toast = useToast();
  const [preset, setPreset] = useState(PRESETS[2]); // amanha 9h padrao
  const [customDate, setCustomDate] = useState('');
  const [message, setMessage] = useState(`Acompanhar ${contratoNome || 'contrato'}`);
  const [recurrence, setRecurrence] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const fireAt = computeFireAt(preset, customDate);
    if (!fireAt) { toast.warning('Defina quando o lembrete deve disparar'); return; }
    if (!message.trim()) { toast.warning('Escreva a mensagem do lembrete'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('user_reminders').insert({
        user_email: userEmail,
        contrato_id: contratoId || null,
        message: message.trim(),
        fire_at: fireAt,
        recurrence: recurrence || null,
      });
      if (error) throw error;
      const when = new Date(fireAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      toast.success(`Lembrete agendado para ${when}`);
      onClose();
    } catch (err) {
      toast.error('Falha ao agendar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const fireAt = computeFireAt(preset, customDate);
  const fireAtLabel = fireAt
    ? new Date(fireAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <h3 className="font-bold text-sm text-navy flex items-center gap-2">
            <ClockIcon className="w-4 h-4" aria-hidden="true" />
            Criar lembrete
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
            <XMarkIcon className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">Quando</label>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`px-2.5 py-1.5 text-[11px] font-bold uppercase rounded-md transition-all border ${
                    preset.label === p.label
                      ? 'bg-navy text-white border-navy'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-navy hover:text-navy'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset.custom === 'custom' && (
              <input
                type="datetime-local"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
                className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            )}
            <div className="text-[10px] text-navy mt-1.5 font-semibold">
              Disparar em: <span className="text-gray-700">{fireAtLabel}</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">Mensagem</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              placeholder="O que voce quer lembrar?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-navy focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">Recorrencia</label>
            <select
              value={recurrence}
              onChange={e => setRecurrence(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-navy focus:outline-none"
            >
              <option value="">Uma vez</option>
              <option value="daily">Diariamente</option>
              <option value="weekly">Semanalmente</option>
              <option value="monthly">Mensalmente</option>
            </select>
          </div>
        </div>

        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-[11px] font-bold uppercase text-gray-500 hover:text-gray-700 px-3 py-1.5">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary text-[11px] px-4 py-1.5 disabled:opacity-50">
            {saving ? 'Agendando...' : 'Agendar'}
          </button>
        </div>
      </div>
    </div>
  );
}
