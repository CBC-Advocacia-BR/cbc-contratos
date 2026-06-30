import { useContract } from '../ContractContext';
import { generateContractHTML } from '../utils/contractHtml';

export default function Step6Preview() {
  const { data, setCurrentStep } = useContract();
  const html = generateContractHTML(data, false);

  return (
    <div className="max-w-4xl mx-auto mt-6">
      <h2 className="font-heading text-2xl font-bold text-navy mb-2 text-center">
        Pré-visualização do Contrato
      </h2>
      <p className="text-sm text-gray-500 text-center mb-6">
        Revise o contrato completo antes de enviar para assinatura digital.
      </p>

      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 mb-6"
        style={{ fontFamily: "'Times New Roman', Times, serif" }}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      <div className="flex justify-between mt-4">
        <button className="btn-outline" onClick={() => setCurrentStep(4)}>Voltar às Cláusulas</button>
        <button className="btn-gold" onClick={() => setCurrentStep(6)}>Enviar para Assinatura Digital</button>
      </div>
    </div>
  );
}
