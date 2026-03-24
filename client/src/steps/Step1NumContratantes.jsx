import { useContract } from '../ContractContext';

export default function Step1NumContratantes() {
  const { data, updateData, setCurrentStep } = useContract();

  const select = (n) => {
    updateData({ numContratantes: n });
    setCurrentStep(1);
  };

  return (
    <div className="card max-w-2xl mx-auto mt-6">
      <h2 className="font-heading text-2xl font-bold text-navy mb-2 text-center">
        Quantos contratantes terá o contrato?
      </h2>
      <p className="text-sm text-gray-500 text-center mb-8">
        Na maioria dos casos, são 2 contratantes (cônjuges).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {[1, 2].map((n) => (
          <button
            key={n}
            onClick={() => select(n)}
            className={`p-8 rounded-xl border-2 transition-all duration-200 cursor-pointer text-center group hover:shadow-lg ${
              data.numContratantes === n
                ? 'border-gold bg-gold/5 shadow-md'
                : 'border-gray-200 hover:border-gold/50'
            }`}
          >
            <div className="text-5xl mb-3">{n === 1 ? '👤' : '👥'}</div>
            <div className="font-heading text-xl font-bold text-navy">
              {n} Contratante{n > 1 ? 's' : ''}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {n === 1 ? 'Pessoa individual' : 'Cônjuges / Parceiros'}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
