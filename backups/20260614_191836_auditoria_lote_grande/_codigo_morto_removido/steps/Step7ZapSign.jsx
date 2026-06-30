import { useState, useEffect } from 'react';
import { useContract } from '../ContractContext';
import { generateContractHTML } from '../utils/contractHtml';
// pdfGenerator importado dinamicamente (lazy) (#112)
import { sendToZapSign } from '../utils/zapsignService';

const ZAPSIGN_TOKEN_KEY = 'cbc_zapsign_token';

export default function Step7ZapSign() {
  const { data, setCurrentStep } = useContract();
  const [apiToken, setApiToken] = useState(() => {
    try { return localStorage.getItem(ZAPSIGN_TOKEN_KEY) || ''; } catch { return ''; }
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState({});

  useEffect(() => {
    try { localStorage.setItem(ZAPSIGN_TOKEN_KEY, apiToken); } catch {}
  }, [apiToken]);

  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const nomes = data.contratantes.slice(0, data.numContratantes).map(c => c.nome).join(' e ');

  const signatarios = [
    ...data.contratantes.slice(0, data.numContratantes).map(c => ({
      name: c.nome,
      email: c.email,
      qualification: 'Contratante',
    })),
    { name: 'Bruno Cavalari Gomes Camargo', email: 'bruno@cbcadvogados.com.br', qualification: 'Advogado Contratado' },
    { name: 'Paulo Roberto Conforto', email: 'paulo@cbcadvogados.com.br', qualification: 'Advogado Contratado' },
  ];

  const handleSend = async () => {
    if (!apiToken.trim()) {
      setError('Informe o API Token do ZapSign.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const html = generateContractHTML(data, true);
      const docName = `Contrato Honorarios - ${nomes} - ${resort}`;

      // Generate PDF in browser
      const { generatePdfBase64 } = await import('../utils/pdfGenerator');
      const base64Pdf = await generatePdfBase64(html);

      // Send directly to ZapSign API
      const zapResult = await sendToZapSign({
        base64Pdf,
        name: docName,
        signers: signatarios,
        folderPath: `/CBC Contratos/${resort || 'Geral'}/`,
      });

      // Map to expected result format
      setResult({
        token: zapResult.docToken,
        signers: zapResult.signers.map(s => ({
          name: s.name,
          email: s.email,
          token: s.token,
          sign_url: s.signUrl,
          status: s.status,
        })),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [key]: false })), 2000);
  };

  const copyAllLinks = () => {
    if (!result?.signers) return;
    const text = result.signers
      .map(s => `${s.name}: ${s.sign_url}`)
      .join('\n');
    copyToClipboard(text, 'all');
  };

  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h2 className="font-heading text-2xl font-bold text-navy mb-2 text-center">
        Assinatura Digital — ZapSign
      </h2>
      <p className="text-sm text-gray-500 text-center mb-6">
        Envie o contrato para assinatura digital via ZapSign.
      </p>

      {/* API Token */}
      <div className="card mb-6">
        <label className="label-field">API Token do ZapSign *</label>
        <input type="password" className="input-field" placeholder="Cole aqui seu API Token..."
          value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
        <p className="text-xs text-gray-400 mt-1">O token sera salvo localmente para uso futuro.</p>
      </div>

      {/* Signatarios */}
      <div className="card mb-6">
        <h3 className="font-heading text-lg font-bold text-navy mb-4">Signatarios do Documento</h3>
        <div className="space-y-2">
          {signatarios.map((s, i) => (
            <div key={i} className="flex items-center justify-between p-3 bg-cream rounded-lg">
              <div>
                <p className="font-semibold text-navy text-sm">{s.name}</p>
                <p className="text-xs text-gray-500">{s.email}</p>
              </div>
              <span className="text-xs bg-navy/10 text-navy px-2 py-1 rounded-full">{s.qualification}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Send button */}
      {!result && (
        <button className="btn-gold w-full text-lg py-4" onClick={handleSend} disabled={loading}>
          {loading ? 'Gerando PDF e enviando...' : 'Enviar Contrato para Assinatura Digital'}
        </button>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card mt-6 border-green-200 bg-green-50/50">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-green-600 text-xl">&#10003;</span>
            <h3 className="font-heading text-lg font-bold text-green-800">Contrato Enviado com Sucesso!</h3>
          </div>

          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-1">Token do Documento:</p>
            <code className="text-sm bg-white px-3 py-1 rounded border block">{result.token}</code>
          </div>

          <h4 className="font-semibold text-navy mb-3">Links de Assinatura:</h4>
          <div className="space-y-3">
            {result.signers?.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-white rounded-lg border gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-navy text-sm">{s.name}</p>
                  <p className="text-xs text-blue-600 truncate">{s.sign_url}</p>
                </div>
                <button
                  className="btn-outline !py-1.5 !px-3 text-xs whitespace-nowrap"
                  onClick={() => copyToClipboard(s.sign_url, i)}>
                  {copied[i] ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            ))}
          </div>

          <button className="btn-primary w-full mt-4" onClick={copyAllLinks}>
            {copied.all ? 'Links Copiados!' : 'Copiar Todos os Links'}
          </button>
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button className="btn-outline" onClick={() => setCurrentStep(5)}>Voltar</button>
      </div>
    </div>
  );
}
