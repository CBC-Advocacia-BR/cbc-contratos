import { useState } from 'react';
import { useContract } from '../ContractContext';
import { CLAUSULAS_PADRAO } from '../data/clausulas';

export default function Step5Clausulas() {
  const { data, getClausulaTexto, updateClausula, resetClausula, isClausulaModificada, setCurrentStep, addClausulaAvulsa, removeClausulaAvulsa } = useContract();
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [showAddClausula, setShowAddClausula] = useState(false);
  const [newTitulo, setNewTitulo] = useState('');
  const [newTexto, setNewTexto] = useState('');

  const startEdit = (cl) => {
    setEditing(cl.id);
    setEditText(getClausulaTexto(cl.id));
  };

  const saveEdit = (id) => {
    updateClausula(id, editText);
    setEditing(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditText('');
  };

  const handleAddClausula = () => {
    if (!newTitulo.trim() || !newTexto.trim()) return;
    addClausulaAvulsa(newTitulo.trim(), newTexto.trim());
    setNewTitulo('');
    setNewTexto('');
    setShowAddClausula(false);
  };

  // Merge standard + avulsas in current order
  const avulsas = (data.clausulasAvulsas || []).map(a => ({ ...a, editavel: true, avulsa: true }));
  const allClausulas = [...CLAUSULAS_PADRAO, ...avulsas];
  const defaultOrder = allClausulas.map(c => c.id);
  const orderedIds = data.clausulasOrder || defaultOrder;
  const clausulasFiltradas = orderedIds.map(id => allClausulas.find(c => c.id === id)).filter(Boolean);

  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h2 className="font-heading text-2xl font-bold text-navy mb-2 text-center">
        Cláusulas do Contrato
      </h2>
      <p className="text-sm text-gray-500 text-center mb-6">
        Revise e edite as cláusulas conforme necessário. As cláusulas automáticas são preenchidas pelos dados inseridos.
      </p>

      <div className="space-y-3">
        {clausulasFiltradas.map((cl) => {
          const isAuto = cl.auto || cl.autoObjeto || cl.autoEscopo;
          const isModified = !isAuto && isClausulaModificada(cl.id);
          const isEditingThis = editing === cl.id;
          const texto = getClausulaTexto(cl.id);

          return (
            <div key={cl.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-heading font-bold text-navy text-sm">{cl.titulo}</h4>
                <div className="flex items-center gap-2">
                  {isAuto && (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">Auto</span>
                  )}
                  {cl.avulsa && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">Avulsa</span>
                  )}
                  {isModified && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">Modificada</span>
                  )}
                </div>
              </div>

              {isAuto ? (
                <p className="text-sm text-gray-500 italic">
                  {cl.autoObjeto
                    ? 'Preenchida automaticamente com a ação e resort selecionados.'
                    : cl.autoEscopo
                    ? 'Preenchida automaticamente com tabela de escopo de atuação.'
                    : 'Preenchida automaticamente com os honorários configurados.'}
                </p>
              ) : isEditingThis ? (
                <div>
                  <textarea
                    className="input-field min-h-[120px] text-sm"
                    rows={6}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="flex gap-2 mt-2">
                    <button className="btn-primary text-sm !py-2 !px-4" onClick={() => saveEdit(cl.id)}>Salvar</button>
                    <button className="btn-outline text-sm !py-2 !px-4" onClick={cancelEdit}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{texto}</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {cl.editavel && (
                      <button
                        className="text-xs text-gold hover:text-gold-dark font-semibold cursor-pointer"
                        onClick={() => startEdit(cl)}
                      >
                        Editar
                      </button>
                    )}
                    {isModified && (
                      <button
                        className="text-xs text-red-500 hover:text-red-700 font-semibold cursor-pointer"
                        onClick={() => resetClausula(cl.id)}
                      >
                        Restaurar Original
                      </button>
                    )}
                    {cl.avulsa && (
                      <button
                        className="text-xs text-red-400 hover:text-red-600 font-semibold cursor-pointer"
                        onClick={() => removeClausulaAvulsa(cl.id)}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Custom Clause */}
      {showAddClausula ? (
        <div className="card mt-4 border-2 border-dashed border-gold/40">
          <h4 className="font-bold text-navy text-sm mb-3">Nova Cláusula</h4>
          <input
            className="input-field mb-2 text-sm"
            placeholder="Título da cláusula..."
            value={newTitulo}
            onChange={(e) => setNewTitulo(e.target.value)}
          />
          <textarea
            className="input-field min-h-[100px] text-sm"
            rows={4}
            placeholder="Texto da cláusula..."
            value={newTexto}
            onChange={(e) => setNewTexto(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button className="btn-primary text-sm !py-2 !px-4" onClick={handleAddClausula}>Adicionar</button>
            <button className="btn-outline text-sm !py-2 !px-4" onClick={() => setShowAddClausula(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button
          className="w-full mt-4 py-2.5 rounded-lg border-2 border-dashed border-gold/40 text-gold hover:bg-gold/5 text-sm font-semibold transition-colors cursor-pointer"
          onClick={() => setShowAddClausula(true)}
        >
          + Adicionar Cláusula Personalizada
        </button>
      )}

      <div className="flex justify-between mt-8">
        <button className="btn-outline" onClick={() => setCurrentStep(3)}>Voltar</button>
        <button className="btn-primary" onClick={() => setCurrentStep(5)}>Avançar para Pré-visualização</button>
      </div>
    </div>
  );
}
