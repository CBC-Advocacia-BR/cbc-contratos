import { useState } from 'react';
import { useContract } from '../ContractContext';
import { generateContractHTML, generateProcuracaoHTML, generateFullDocumentHTML } from '../utils/contractHtml';

const API_TOKEN = 'c88bf943-6227-4dcd-a258-8b769e65358ceb3510ae-25f3-4dc1-a4c0-09f8db97bb5e';

export default function ZapSignModal({ onClose, onSaveAfterSend }) {
  const { data } = useContract();
  const [loading, setLoading] = useState(false);
  const [loadingType, setLoadingType] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState({});

  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const nomes = data.contratantes.slice(0, data.numContratantes).map(c => c.nome).filter(Boolean).join(' e ');

  const signatarios = [
    ...data.contratantes.slice(0, data.numContratantes).filter(c => c.nome).map(c => ({
      name: c.nome, email: c.email, qualification: 'Contratante',
    })),
  ];

  const handleSend = async (type) => {
    setLoading(true);
    setLoadingType(type);
    setError('');
    setResult(null);
    try {
      let html;
      let docName;
      if (type === 'contrato') {
        html = generateContractHTML(data, false);
        docName = `Contrato - ${nomes} - ${resort}`;
      } else if (type === 'procuracao') {
        html = generateProcuracaoHTML(data, false);
        docName = `Procuracao - ${nomes} - ${resort}`;
      } else {
        html = generateFullDocumentHTML(data);
        docName = `Contrato + Procuracao - ${nomes} - ${resort}`;
      }

      const resp = await fetch('/api/zapsign/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiToken: API_TOKEN, html, sandbox: false,
          name: docName, resort,
          signers: signatarios.map(s => ({
            name: s.name, email: s.email, lock_name: true, lock_email: true,
            auth_mode: 'assinaturaTela', qualification: s.qualification,
          })),
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Erro ao enviar');
      const docLabel = type === 'contrato' ? 'Contrato' : type === 'procuracao' ? 'Procuração' : 'Contrato + Procuração';
      // Add doc_type to each signer for display purposes
      const enrichedSigners = (json.signers || []).map(s => ({ ...s, doc_type: docLabel }));
      const enrichedResult = { ...json, signers: enrichedSigners, doc_type: docLabel, type };
      setResult(enrichedResult);
      if (onSaveAfterSend) onSaveAfterSend(enrichedResult);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); setLoadingType(''); }
  };

  const copyText = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(p => ({ ...p, [key]: true }));
    setTimeout(() => setCopied(p => ({ ...p, [key]: false })), 2000);
  };

  const copyAll = () => {
    if (!result?.signers) return;
    copyText(result.signers.map(s => `${s.name}: ${s.sign_url}`).join('\n'), 'all');
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ boxShadow: '0 4px 24px rgba(0,0,0,.15)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="text-white text-center py-3 px-5 rounded-t-xl" style={{ background: '#1B3A5C' }}>
          <div className="text-[13px] font-bold uppercase tracking-[1px]">Enviar para ZapSign</div>
          <div className="text-[11px] opacity-70 mt-0.5">Assinatura Digital com Validade Juridica</div>
        </div>

        <div className="p-5">
          {/* Signatários */}
          <div className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-[1px] mb-2" style={{ color: '#1B3A5C' }}>Signatarios</div>
            <div className="space-y-1.5">
              {signatarios.map((s, i) => (
                <div key={i} className="flex justify-between items-center p-3 rounded-lg text-sm" style={{ background: '#F0F4F8' }}>
                  <div>
                    <p className="font-bold text-sm" style={{ color: '#1A1A1A' }}>{s.name}</p>
                    <p className="text-[11px] text-gray-500">{s.email}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white" style={{ background: '#1B3A5C' }}>{s.qualification}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Send buttons */}
          {!result && (
            <div className="space-y-2">
              <button className="w-full py-3 rounded-lg text-white font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#0F2035' }}
                onClick={() => handleSend('completo')} disabled={loading}>
                {loadingType === 'completo' ? 'Enviando...' : 'Enviar Contrato + Procuracao'}
              </button>
              <div className="flex gap-2">
                <button className="flex-1 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: '#EEF4FF', color: '#1B3A5C', border: '1px solid #C0D0E8' }}
                  onClick={() => handleSend('contrato')} disabled={loading}>
                  {loadingType === 'contrato' ? 'Enviando...' : 'Somente Contrato'}
                </button>
                <button className="flex-1 py-2.5 rounded-lg font-bold text-[10px] uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: '#EEF4FF', color: '#1B3A5C', border: '1px solid #C0D0E8' }}
                  onClick={() => handleSend('procuracao')} disabled={loading}>
                  {loadingType === 'procuracao' ? 'Enviando...' : 'Somente Procuracao'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          {result && (
            <div className="mt-4 p-4 rounded-xl" style={{ background: '#EEF4FF', border: '1px solid #C0D0E8' }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-green-600 text-lg">✓</span>
                <div>
                  <p className="font-bold text-sm" style={{ color: '#1B3A5C' }}>Enviado com sucesso!</p>
                  <p className="text-[10px] text-gray-500">
                    {result.type === 'contrato' ? 'Contrato' : result.type === 'procuracao' ? 'Procuracao' : 'Contrato + Procuracao'}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {result.signers?.map((s, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200 text-sm gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-xs" style={{ color: '#1B3A5C' }}>{s.name}</p>
                      <p className="text-[10px] text-blue-600 truncate">{s.sign_url}</p>
                    </div>
                    <button className="text-[11px] text-white px-3 py-1.5 rounded-lg cursor-pointer font-bold shrink-0" style={{ background: '#1B3A5C' }}
                      onClick={() => copyText(s.sign_url, i)}>{copied[i] ? 'Copiado!' : 'Copiar'}</button>
                  </div>
                ))}
              </div>
              <button className="w-full mt-3 py-2.5 rounded-lg text-white font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90"
                style={{ background: '#0F2035' }}
                onClick={copyAll}>
                {copied.all ? 'Links Copiados!' : 'Copiar Todos os Links'}
              </button>
            </div>
          )}

          <button className="w-full mt-3 py-2.5 rounded-lg border border-gray-300 text-gray-500 font-bold text-xs uppercase tracking-wide cursor-pointer hover:bg-gray-50 transition-all"
            onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
