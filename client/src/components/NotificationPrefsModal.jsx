// (#205) Modal de preferencias de notificacao — matriz evento x canais
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { Cog6ToothIcon, XMarkIcon } from '@heroicons/react/24/outline';

const EVENTS = [
  { id: 'signature', label: 'Contrato assinado',       desc: 'Quando um cliente termina de assinar' },
  { id: 'sent',      label: 'Contrato enviado',         desc: 'Quando ZapSign confirma o envio' },
  { id: 'mention',   label: '@mencao em comentario',    desc: 'Quando alguem te marca em comentario' },
  { id: 'reminder',  label: 'Lembrete pessoal',         desc: 'Lembretes agendados via botao "Lembrar-me"' },
  { id: 'error',     label: 'Erro de automacao',        desc: 'ADVBOX/Drive falharam ao processar' },
  { id: 'info',      label: 'Informativo do sistema',   desc: 'Atualizacoes/avisos gerais' },
];

const CHANNELS = [
  { id: 'inapp', label: 'In-app',  desc: 'Mostra no sino do header' },
  { id: 'email', label: 'E-mail',  desc: '(em breve)', disabled: true },
  { id: 'push',  label: 'Push',    desc: '(em breve)', disabled: true },
];

const DEFAULT_PREFS = EVENTS.reduce((acc, ev) => {
  acc[ev.id] = { inapp: true, email: false, push: false };
  return acc;
}, {});

export default function NotificationPrefsModal({ userEmail, onClose }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('user_notification_prefs').select('prefs').eq('user_email', userEmail).maybeSingle();
        if (data?.prefs) setPrefs({ ...DEFAULT_PREFS, ...data.prefs });
      } catch (err) {
        console.error('[NotificationPrefs] load', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [userEmail]);

  const toggle = (eventId, channelId) => {
    setPrefs(prev => ({
      ...prev,
      [eventId]: { ...prev[eventId], [channelId]: !prev[eventId]?.[channelId] },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('user_notification_prefs').upsert({
        user_email: userEmail,
        prefs,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success('Preferencias salvas');
      onClose();
    } catch (err) {
      toast.error('Falha ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-xl p-6 text-sm text-gray-500">Carregando preferencias...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="font-bold text-sm text-navy flex items-center gap-2">
            <Cog6ToothIcon className="w-4 h-4" aria-hidden="true" />
            Preferencias de notificacao
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
            <XMarkIcon className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 py-3 max-h-[60vh] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 px-2 font-bold uppercase text-gray-500 text-[9px] tracking-wide">Evento</th>
                {CHANNELS.map(ch => (
                  <th key={ch.id} className="text-center py-1.5 px-2 font-bold uppercase text-gray-500 text-[9px] tracking-wide" title={ch.desc}>
                    {ch.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map(ev => (
                <tr key={ev.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 px-2">
                    <div className="font-semibold text-gray-800">{ev.label}</div>
                    <div className="text-[10px] text-gray-400">{ev.desc}</div>
                  </td>
                  {CHANNELS.map(ch => (
                    <td
                      key={ch.id}
                      className="text-center py-2 px-2"
                      onClick={() => { if (!ch.disabled && window.matchMedia('(pointer: coarse)').matches) toggle(ev.id, ch.id); }}
                    >
                      <input
                        type="checkbox"
                        checked={!!prefs[ev.id]?.[ch.id]}
                        disabled={ch.disabled}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(ev.id, ch.id)}
                        className="w-4 h-4 cursor-pointer accent-navy disabled:opacity-30 disabled:cursor-not-allowed"
                        title={ch.disabled ? ch.desc : `${ev.label} via ${ch.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-[11px] font-bold uppercase text-gray-500 hover:text-gray-700 px-3 py-1.5">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary text-[11px] px-4 py-1.5 disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
