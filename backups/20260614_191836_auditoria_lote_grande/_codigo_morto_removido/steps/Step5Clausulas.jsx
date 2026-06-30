import { useState } from 'react';
import { useContract } from '../ContractContext';
import { CLAUSULAS_PADRAO } from '../data/clausulas';
import { formatCurrency, valorExtenso } from '../utils/extenso';

function gerarTextoHonorarios(h, diaParcela, dataPrimeira) {
  return `Fica ajustado que o contratante, em remuneração aos serviços contratados, pagará ao contratado, o(s) honorário(s) pactuados da seguinte forma:\n\na) Parte Fixa: ${formatCurrency(h.total)} (${valorExtenso(h.total)}), a serem pagos em ${h.parcelas} parcelas iguais e sucessivas de ${formatCurrency(h.valorParcela)} (${valorExtenso(h.valorParcela)}) cada uma, com vencimento da primeira em ${dataPrimeira} e as demais, todo dia ${diaParcela} dos meses subsequentes;\n\nb) Em caso de êxito na demanda, será devido ${h.percentualExito}% de honorários sobre o proveito econômico da ação.`;
}

export default function Step5Clausulas() {
  const { data, getClausulaTexto, updateClausula, resetClausula, isClausulaModificada, setCurrentStep } = useContract();
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');

  const h = data.honorarios;
  const diaParcela = h.dataPrimeiraParcela
    ? new Date(h.dataPrimeiraParcela + 'T12:00:00').getDate()
    : '';
  const dataPrimeira = h.dataPrimeiraParcela
    ? new Date(h.dataPrimeiraParcela + 'T12:00:00').toLocaleDateString('pt-BR')
    : '';
  const textoHonorarios = gerarTextoHonorarios(h, diaParcela, dataPrimeira);

  const startEdit = (cl) => {
    setEditing(cl.id);
    setEditText(getClausulaTexto(cl.id));
  };

  const saveEdit = (id) => {
    updateClausula(id, editText);
    setEditing(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditText('');
  };

  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h2 className="font-heading text-2xl font-bold text-navy mb-2 text-center">
        Cláusulas do Contrato
      </h2>
      <p className="text-sm text-gray-500 text-center mb-6">
        Revise e edite as cláusulas conforme necessário. A cláusula de honorários é preenchida automaticamente.
      </p>

      <div className="space-y-4">
        {CLAUSULAS_PADRAO.map((cl) => {
          const isAuto = cl.auto;
          const isModified = isClausulaModificada(cl.id);
          const isEditing = editing === cl.id;
          const texto = isAuto ? textoHonorarios : getClausulaTexto(cl.id);

          return (
            <div key={cl.id} className={`card ${cl.paragrafo ? 'ml-6 border-l-4 border-l-gold/30' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-heading font-bold text-navy text-sm">
                  {cl.titulo}
                </h4>
                <div className="flex items-center gap-2">
                  {isAuto && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">Auto</span>
                  )}
                  {isModified && !isAuto && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">Modificada</span>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div>
                  <textarea className="input-field min-h-[120px] text-sm" rows={5}
                    value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div className="flex gap-2 mt-2">
                    <button className="btn-primary text-sm !py-2 !px-4" onClick={() => saveEdit(cl.id)}>Salvar</button>
                    <button className="btn-outline text-sm !py-2 !px-4" onClick={cancelEdit}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{texto}</p>
                  {!isAuto && (
                    <div className="flex gap-2 mt-3">
                      <button className="text-xs text-gold hover:text-gold-dark font-semibold cursor-pointer"
                        onClick={() => startEdit(cl)}>
                        Editar
                      </button>
                      {isModified && (
                        <button className="text-xs text-red-500 hover:text-red-700 font-semibold cursor-pointer"
                          onClick={() => resetClausula(cl.id)}>
                          Restaurar Original
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-8">
        <button className="btn-outline" onClick={() => setCurrentStep(3)}>Voltar</button>
        <button className="btn-primary" onClick={() => setCurrentStep(5)}>Avançar para Pré-visualização</button>
      </div>
    </div>
  );
}
