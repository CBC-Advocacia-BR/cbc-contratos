import { useState } from 'react';
import { useContract } from '../ContractContext';
import { useEmpreendimentos } from '../hooks/useEmpreendimentos';

export default function Step3Resort() {
  const { data, updateData, setCurrentStep } = useContract();
  const { list: resorts, addEmpreendimento } = useEmpreendimentos();
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newResort, setNewResort] = useState('');

  const handleNext = () => {
    const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
    if (!resort?.trim()) {
      setError('Selecione ou informe o resort.');
      return;
    }
    setError('');
    setCurrentStep(3);
  };

  const handleAddNew = async () => {
    if (!newResort.trim()) return;
    await addEmpreendimento(newResort.trim());
    updateData({ resort: newResort.trim(), resortCustom: '' });
    setNewResort('');
    setShowAdd(false);
  };

  return (
    <div className="card max-w-2xl mx-auto mt-6">
      <h2 className="font-heading text-2xl font-bold text-navy mb-2 text-center">
        Ação e Resort
      </h2>
      <p className="text-sm text-gray-500 text-center mb-6">
        Selecione o resort referente à ação de rescisão contratual de cota de multipropriedade.
      </p>

      <div className="space-y-3">
        {resorts.map((r) => (
          <label key={r}
            className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
              data.resort === r ? 'border-gold bg-gold/5' : 'border-gray-200 hover:border-gold/30'
            }`}>
            <input type="radio" name="resort" className="accent-gold w-4 h-4"
              checked={data.resort === r}
              onChange={() => updateData({ resort: r, resortCustom: '' })} />
            <span className="font-semibold text-navy">{r}</span>
          </label>
        ))}

        <label className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
          data.resort === 'outro' ? 'border-gold bg-gold/5' : 'border-gray-200 hover:border-gold/30'
        }`}>
          <input type="radio" name="resort" className="accent-gold w-4 h-4"
            checked={data.resort === 'outro'}
            onChange={() => updateData({ resort: 'outro' })} />
          <span className="font-semibold text-navy">Outro (especificar)</span>
        </label>

        {data.resort === 'outro' && (
          <input className="input-field mt-2" placeholder="Nome do resort..."
            value={data.resortCustom || ''}
            onChange={(e) => updateData({ resortCustom: e.target.value })} />
        )}
      </div>

      {/* Add new to permanent list */}
      {showAdd ? (
        <div className="mt-4 flex gap-2">
          <input
            className="input-field flex-1"
            placeholder="Nome do novo empreendimento..."
            value={newResort}
            onChange={(e) => setNewResort(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddNew()}
          />
          <button className="btn-primary !px-3 !py-2 text-sm" onClick={handleAddNew}>Salvar</button>
          <button className="btn-outline !px-3 !py-2 text-sm" onClick={() => { setShowAdd(false); setNewResort(''); }}>Cancelar</button>
        </div>
      ) : (
        <button
          className="mt-4 w-full py-2 rounded-lg border border-dashed border-gold/40 text-gold hover:bg-gold/5 text-sm font-semibold transition-colors cursor-pointer"
          onClick={() => setShowAdd(true)}
        >
          + Adicionar novo empreendimento à lista
        </button>
      )}

      {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

      <div className="flex justify-between mt-8">
        <button className="btn-outline" onClick={() => setCurrentStep(1)}>Voltar</button>
        <button className="btn-primary" onClick={handleNext}>Avançar</button>
      </div>
    </div>
  );
}
