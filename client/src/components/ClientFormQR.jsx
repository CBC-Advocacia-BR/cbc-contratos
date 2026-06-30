import { useState, useEffect, useRef } from 'react';
import { CheckIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { maskCPF, maskRG, maskCEP } from '../utils/masks';
// qrcode importado dinamicamente no useEffect (lazy) - #112

/**
 * QR Code modal: generates a link that the client can open on their phone
 * to fill their personal data. Data is stored in Supabase `client_forms` table
 * and the lawyer can import it with one click.
 *
 * Flow:
 * 1. Lawyer clicks "QR Code" button
 * 2. System generates unique form ID and QR code
 * 3. Client scans QR, fills data on phone
 * 4. Client submits → data saved to Supabase
 * 5. Lawyer sees notification and imports data into form
 */

import { supabase } from '../lib/supabase';

export function ClientFormLink({ onImport, onClose }) {
  const [formId, setFormId] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);

  // Generate unique form ID and QR code on mount
  useEffect(() => {
    const id = crypto.randomUUID().split('-')[0];
    setFormId(id);

    const baseUrl = window.location.origin;
    const formUrl = `${baseUrl}?clientForm=${id}`;

    // Lazy-load qrcode somente quando necessario (#112)
    import('qrcode').then(mod => {
      const QRCode = mod.default || mod;
      QRCode.toDataURL(formUrl, {
        width: 280,
        margin: 2,
        color: { dark: '#1B3A5C', light: '#FFFFFF' },
      }).then(url => setQrDataUrl(url));
    });

    // Start polling for submissions
    setPolling(true);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (!polling || !formId) return;
    const check = async () => {
      const { data } = await supabase
        .from('client_forms')
        .select('*')
        .eq('form_id', formId)
        .order('created_at', { ascending: false });
      if (data?.length > 0) setSubmissions(data);
    };
    check();
    // (p1-scale 31/05) Realtime instantaneo para novas submissoes + poll de fallback
    // relaxado de 5s -> 20s. Se a tabela client_forms nao estiver na publicacao
    // realtime, o poll garante a entrega; com realtime ativo o poll vira so reconciliacao.
    const channel = supabase
      .channel(`client_forms:${formId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'client_forms', filter: `form_id=eq.${formId}` },
        (payload) => {
          setSubmissions((prev) => (prev.some((s) => s.id === payload.new.id) ? prev : [payload.new, ...prev]));
        }
      )
      .subscribe();
    pollRef.current = setInterval(check, 60000); // (perf 31/05) 20s -> 60s; o realtime ja entrega na hora, isto e so reconciliacao
    return () => {
      clearInterval(pollRef.current);
      supabase.removeChannel(channel);
    };
  }, [polling, formId]);

  const formUrl = `${window.location.origin}?clientForm=${formId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(formUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImport = (sub) => {
    onImport({
      nome: sub.nome || '',
      nacionalidade: sub.nacionalidade || 'brasileiro(a)',
      profissao: sub.profissao || '',
      estadoCivil: sub.estado_civil || '',
      rg: sub.rg || '',
      cpf: sub.cpf || '',
      email: sub.email || '',
      endereco: sub.endereco || '',
      complemento: sub.complemento || '',
      bairro: sub.bairro || '',
      cidade: sub.cidade || '',
      uf: sub.uf || '',
      cep: sub.cep || '',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-glass" onClick={onClose}>
      <div className="modal-glass rounded-2xl max-w-sm w-full mx-4 p-6 max-h-[85dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-center font-bold text-lg mb-1" style={{ color: '#1B3A5C' }}>
          Formulario do Cliente
        </h3>
        <p className="text-center text-[11px] text-gray-500 mb-4">
          O cliente escaneia o QR Code e preenche seus dados no celular
        </p>

        {qrDataUrl && (
          <div className="flex justify-center mb-4">
            <img src={qrDataUrl} alt="QR Code" className="rounded-xl shadow" />
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <input
            readOnly
            value={formUrl}
            className="flex-1 text-[10px] px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 truncate"
          />
          <button onClick={copyLink}
            aria-label={copied ? 'Copiado' : 'Copiar'}
            className="px-3 py-2 rounded-lg text-[10px] font-bold text-white cursor-pointer shrink-0 flex items-center justify-center"
            style={{ background: copied ? '#16A34A' : '#1B3A5C' }}>
            {copied ? <CheckIcon className="w-3.5 h-3.5" aria-hidden="true" /> : 'Copiar'}
          </button>
        </div>

        {submissions.length > 0 && (
          <div className="space-y-2 mb-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-green-600 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {submissions.length} resposta(s) recebida(s)
            </div>
            {submissions.map((sub, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-gray-800 dark:text-gray-200">{sub.nome || 'Sem nome'}</div>
                  <div className="text-[10px] text-gray-500">{sub.cpf} | {sub.email}</div>
                </div>
                <button onClick={() => handleImport(sub)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white cursor-pointer"
                  style={{ background: '#16A34A' }}>
                  Importar
                </button>
              </div>
            ))}
          </div>
        )}

        {submissions.length === 0 && (
          <div className="text-center text-[10px] text-gray-400 mb-4 flex items-center justify-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Aguardando preenchimento do cliente...
          </div>
        )}

        <button onClick={onClose}
          className="w-full py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-bold text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
          Fechar
        </button>
      </div>
    </div>
  );
}

/**
 * Public form that the client fills out on their phone.
 * Rendered when URL has ?clientForm=ID parameter.
 */
export function ClientPublicForm({ formId }) {
  const [form, setForm] = useState({
    nome: '', nacionalidade: 'brasileiro(a)', profissao: '', estado_civil: '',
    rg: '', cpf: '', email: '', endereco: '', complemento: '',
    bairro: '', cidade: '', uf: '', cep: '',
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handle = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleCEP = async (cep) => {
    handle('cep', cep);
    const clean = cep.replace(/\D/g, '');
    if (clean.length === 8) {
      try {
        const r = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
        const d = await r.json();
        if (!d.erro) {
          setForm(p => ({
            ...p,
            endereco: d.logradouro || p.endereco,
            bairro: d.bairro || p.bairro,
            cidade: d.localidade || p.cidade,
            uf: d.uf || p.uf,
          }));
        }
      } catch { /* ignore */ }
    }
  };

  const submit = async () => {
    if (!form.nome || !form.cpf || !form.email) {
      setError('Preencha nome, CPF e email');
      return;
    }
    setSending(true);
    setError('');
    try {
      const { error: dbErr } = await supabase
        .from('client_forms')
        .insert({ form_id: formId, ...form });
      if (dbErr) throw dbErr;
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6" style={{ background: '#F0F4F8' }}>
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="mb-4 flex justify-center">
            <CheckCircleIcon className="w-14 h-14 text-green-500" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: '#1B3A5C' }}>Dados Enviados!</h2>
          <p className="text-sm text-gray-500">Seus dados foram recebidos pelo escritorio. Pode fechar esta pagina.</p>
        </div>
      </div>
    );
  }

  const inputClass = "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-300";

  return (
    <div className="min-h-[100dvh] p-4 pb-8" style={{ background: '#F0F4F8' }}>
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6 pt-4">
          <h1 className="text-lg font-bold" style={{ color: '#1B3A5C' }}>CBC Advogados</h1>
          <p className="text-xs text-gray-500">Preencha seus dados pessoais</p>
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Nome Completo *</label>
            <input className={inputClass} type="text" autoComplete="name" enterKeyHint="next" value={form.nome} onChange={e => handle('nome', e.target.value)} placeholder="Nome completo" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">CPF *</label>
              <input className={inputClass} type="text" value={form.cpf} onChange={e => handle('cpf', maskCPF(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" maxLength={14} enterKeyHint="next" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">RG</label>
              <input className={inputClass} type="text" inputMode="numeric" value={form.rg} onChange={e => handle('rg', maskRG(e.target.value))} placeholder="RG" maxLength={20} enterKeyHint="next" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Email *</label>
            <input className={inputClass} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={form.email} onChange={e => handle('email', e.target.value)} placeholder="email@exemplo.com" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Nacionalidade</label>
              <input className={inputClass} type="text" enterKeyHint="next" value={form.nacionalidade} onChange={e => handle('nacionalidade', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Profissao</label>
              <input className={inputClass} type="text" enterKeyHint="next" value={form.profissao} onChange={e => handle('profissao', e.target.value)} placeholder="Ex: empresario" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Estado Civil</label>
            <select className={inputClass} value={form.estado_civil} onChange={e => handle('estado_civil', e.target.value)}>
              <option value="">Selecione...</option>
              <option value="Solteiro(a)">Solteiro(a)</option>
              <option value="Casado(a)">Casado(a)</option>
              <option value="Divorciado(a)">Divorciado(a)</option>
              <option value="Viuvo(a)">Viuvo(a)</option>
              <option value="Uniao Estavel">Uniao Estavel</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">CEP</label>
              <input className={inputClass} type="text" autoComplete="postal-code" value={form.cep} onChange={e => handleCEP(maskCEP(e.target.value))} placeholder="00000-000" inputMode="numeric" maxLength={9} enterKeyHint="next" />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Endereco</label>
              <input className={inputClass} type="text" autoComplete="address-line1" enterKeyHint="next" value={form.endereco} onChange={e => handle('endereco', e.target.value)} placeholder="Rua, numero" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Complemento</label>
            <input className={inputClass} type="text" autoComplete="address-line2" enterKeyHint="next" value={form.complemento} onChange={e => handle('complemento', e.target.value)} placeholder="Apto, bloco, etc." />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Bairro</label>
              <input className={inputClass} type="text" enterKeyHint="next" value={form.bairro} onChange={e => handle('bairro', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Cidade</label>
              <input className={inputClass} type="text" autoComplete="address-level2" enterKeyHint="next" value={form.cidade} onChange={e => handle('cidade', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 block mb-1">UF</label>
              <input className={inputClass} type="text" autoComplete="address-level1" enterKeyHint="done" maxLength={2} value={form.uf} onChange={e => handle('uf', e.target.value.toUpperCase())} placeholder="SP" />
            </div>
          </div>

          {error && <div className="text-xs text-red-600 text-center font-medium">{error}</div>}

          <button onClick={submit} disabled={sending}
            className="w-full py-3.5 rounded-lg text-white font-bold text-sm cursor-pointer transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: '#1B3A5C' }}>
            {sending ? 'Enviando...' : 'Enviar Dados'}
          </button>
        </div>

        <p className="text-[9px] text-gray-400 text-center mt-4">
          Conforto, Bergonsi & Cavalari Advogados — OAB/SP 55227
        </p>
      </div>
    </div>
  );
}
