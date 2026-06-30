import { useState } from 'react';
import { useContract } from '../ContractContext';
import { generateContractHTML, generateProcuracaoHTML } from '../utils/contractHtml';
// pdfGenerator importado dinamicamente (lazy) (#112)
import { sendToZapSign } from '../utils/zapsignService';
import { DocumentIcon, CloudArrowUpIcon, Cog6ToothIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import { useRipple } from '../hooks/useRipple';

// (ux-12) Traduz erros do ZapSign (tecnicos/ingles) para mensagens claras em PT
function traduzErroZapSign(err) {
  const raw = (err && err.message) ? String(err.message) : String(err || '');
  const lower = raw.toLowerCase();
  // Sem conexao / falha de rede
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed') || lower.includes('load failed')) {
    return 'Sem conexao — verifique a internet e tente novamente.';
  }
  // Autenticacao com o ZapSign
  if (raw.includes('(401)') || raw.includes('(403)') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return 'Falha de autenticacao com o ZapSign. Avise o administrador.';
  }
  // Dados invalidos (validacao da API)
  if (raw.includes('(422)') || raw.includes('(400)')) {
    return 'Dados invalidos: confira email/CPF do contratante e tente novamente.';
  }
  // Limite de requisicoes
  if (raw.includes('(429)')) {
    return 'Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente de novo.';
  }
  // Erro interno do ZapSign
  if (raw.includes('(500)') || raw.includes('(502)') || raw.includes('(503)')) {
    return 'O ZapSign esta instavel no momento. Tente novamente em alguns minutos.';
  }
  // Default: mensagem generica + detalhe tecnico curto
  const detalhe = raw.length > 120 ? `${raw.slice(0, 120)}...` : raw;
  return `Nao foi possivel enviar para o ZapSign.${detalhe ? ` (${detalhe})` : ''}`;
}

// ─── Visual Progress Steps ───
const SEND_STEPS = [
  { id: 'pdf', label: 'Gerando PDF', Icon: DocumentIcon },
  { id: 'upload', label: 'Enviando para ZapSign', Icon: CloudArrowUpIcon },
  { id: 'process', label: 'Processando documento', Icon: Cog6ToothIcon },
  { id: 'done', label: 'Pronto!', Icon: CheckCircleIcon },
];

function SendProgress({ currentStep }) {
  return (
    <div className="py-4">
      <div className="flex items-center justify-between px-2">
        {SEND_STEPS.map((step, i) => {
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          const Icon = step.Icon;
          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                  isDone ? 'bg-green-100 scale-100 text-green-600' : isActive ? 'bg-blue-100 scale-110 animate-pulse text-blue-600' : 'bg-gray-100 scale-90 opacity-40 text-gray-500'
                }`}>
                  {isDone ? <CheckCircleSolid className="w-6 h-6" aria-hidden="true" /> : <Icon className="w-5 h-5" aria-hidden="true" />}
                </div>
                <span className={`text-[9px] font-bold uppercase mt-1 transition-all ${
                  isDone ? 'text-green-600' : isActive ? 'text-blue-600' : 'text-gray-300'
                }`}>
                  {step.label}
                </span>
              </div>
              {i < SEND_STEPS.length - 1 && (
                <div className={`w-6 h-0.5 shrink-0 -mt-4 mx-0.5 rounded transition-all duration-500 ${isDone ? 'bg-green-300' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ZapSignModal({ onClose, onSaveAfterSend }) {
  const { data } = useContract();
  const [loading, setLoading] = useState(false);
  const [loadingType, setLoadingType] = useState('');
  const [sendStep, setSendStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState({});
  const ripple = useRipple();

  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const nomes = data.contratantes.slice(0, data.numContratantes).map(c => c.nome).filter(Boolean).join(' e ');

  // (PJ 25/06) Cliente Empresa: assina o representante legal (c.nome), mas o convite do
  // ZapSign vai para o e-mail da EMPRESA (decisao do Paulo). PF segue com o e-mail da pessoa.
  const signatarios = data.contratantes.slice(0, data.numContratantes).filter(c => c.nome).map((c) => ({
    name: c.nome,
    email: c.tipo === 'pj' ? (c.emailEmpresa || c.email) : c.email,
    qualification: 'Contratante',
  }));

  const handleSend = async (type) => {
    setLoading(true);
    setLoadingType(type);
    setError('');
    setResult(null);
    try {
      setSendStep(0); // Gerando PDF
      let html;
      let docName;
      if (type === 'contrato') {
        html = generateContractHTML(data, false);
        docName = `Contrato - ${nomes} - ${resort}`;
      } else if (type === 'procuracao') {
        html = generateProcuracaoHTML(data, false);
        docName = `Procuracao - ${nomes} - ${resort}`;
      } else {
        docName = `Contrato + Procuracao - ${nomes} - ${resort}`;
      }

      // Generate PDF as base64 in the browser
      const { generatePdfBase64, generateFullPdfWithSplit } = await import('../utils/pdfGenerator');
      let base64Pdf;
      let pageSplit = null;
      if (type === 'completo') {
        const contractHtml = generateContractHTML(data, true);
        const procuracaoHtml = generateProcuracaoHTML(data, true);
        const splitResult = await generateFullPdfWithSplit(contractHtml, procuracaoHtml);
        base64Pdf = splitResult.base64;
        pageSplit = { contractPages: splitResult.contractPages, procuracaoStartPage: splitResult.procuracaoStartPage, totalPages: splitResult.pageCount };
      } else {
        base64Pdf = await generatePdfBase64(html);
      }

      setSendStep(1); // Enviando para ZapSign

      // Send directly to ZapSign API
      const zapResult = await sendToZapSign({
        base64Pdf,
        name: docName,
        signers: signatarios,
        folderPath: `/CBC Contratos/${resort || 'Geral'}/`,
        // (integ-4) external_id estavel por contrato p/ o ZapSign detectar reenvio.
        // App.jsx deveria propagar o savedContractId; usamos data.id quando disponivel.
        contratoId: data.id,
      });

      setSendStep(2); // Processando

      const docLabel = type === 'contrato' ? 'Contrato' : type === 'procuracao' ? 'Procuracao' : 'Contrato + Procuracao';
      // Map result to expected format
      const enrichedSigners = (zapResult.signers || []).map(s => ({
        name: s.name,
        email: s.email,
        token: s.token,
        sign_url: s.signUrl,
        status: s.status,
        doc_type: docLabel,
      }));
      const enrichedResult = {
        token: zapResult.docToken,
        signers: enrichedSigners,
        doc_type: docLabel,
        type,
        pageSplit,
      };
      setSendStep(3); // Done!
      setResult(enrichedResult);
      if (onSaveAfterSend) onSaveAfterSend(enrichedResult);
    } catch (err) { setError(traduzErroZapSign(err)); } // (ux-12) mensagem em PT
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
    <div className="fixed inset-0 modal-backdrop-glass z-50 flex items-center justify-center p-4" onClick={() => { if (!loading) onClose(); }}>
      <div className="modal-glass rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="text-white text-center py-3 px-5 rounded-t-xl" style={{ background: '#1B3A5C' }}>
          <div className="text-[13px] font-bold uppercase tracking-[1px]">Enviar para ZapSign</div>
          <div className="text-[11px] opacity-70 mt-0.5">Assinatura Digital com Validade Juridica</div>
        </div>

        <div className="p-5">
          {/* Signatarios */}
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

          {/* Visual progress steps during send */}
          {loading && <SendProgress currentStep={sendStep} />}

          {/* Send buttons */}
          {!result && !loading && (
            <div className="space-y-2">
              <button className="btn-ripple btn-press w-full py-3 rounded-lg text-white font-bold text-xs uppercase tracking-wide cursor-pointer transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#0F2035' }}
                onMouseDown={ripple}
                onClick={() => handleSend('completo')} disabled={loading}>
                {loadingType === 'completo' ? 'Gerando PDF e enviando...' : 'Enviar Contrato + Procuracao'}
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
                <CheckCircleSolid className="w-5 h-5 text-green-600" aria-hidden="true" />
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
