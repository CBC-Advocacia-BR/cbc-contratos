import { useState } from 'react';
import { useContract } from '../ContractContext';
import { HONORARIOS_OPCOES, PERCENTUAIS_EXITO } from '../data/clausulas';
import { formatCurrency, valorExtenso } from '../utils/extenso';

export default function Step4Honorarios() {
  const { data, updateHonorarios, setCurrentStep } = useContract();
  const h = data.honorarios;
  const [errors, setErrors] = useState({});

  const selectPredefinido = (opt) => {
    updateHonorarios({
      tipo: 'predefinido',
      total: opt.total,
      parcelas: opt.parcelas,
      valorParcela: opt.valorParcela,
    });
  };

  const selectPersonalizado = () => {
    updateHonorarios({ tipo: 'personalizado' });
  };

  const handleNext = () => {
    const e = {};
    if (!h.total || h.total <= 0) e.total = 'Informe o valor';
    if (!h.parcelas || h.parcelas <= 0) e.parcelas = 'Informe as parcelas';
    if (!h.percentualExito) e.percentualExito = 'Selecione o percentual';
    if (!h.dataPrimeiraParcela) e.dataPrimeiraParcela = 'Informe a data';
    setErrors(e);
    if (Object.keys(e).length === 0) setCurrentStep(4);
  };

  const diaParcela = h.dataPrimeiraParcela
    ? new Date(h.dataPrimeiraParcela + 'T12:00:00').getDate()
    : null;

  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h2 className="font-heading text-2xl font-bold text-navy mb-6 text-center">
        Honorários Advocatícios
      </h2>

      {/* Valores pré-definidos */}
      <div className="card mb-6">
        <h3 className="font-heading text-lg font-bold text-navy mb-4">Valor dos Honorários Fixos</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {HONORARIOS_OPCOES.map((opt) => (
            <button key={opt.total}
              onClick={() => selectPredefinido(opt)}
              className={`p-4 rounded-lg border-2 text-left transition-all cursor-pointer ${
                h.tipo === 'predefinido' && h.total === opt.total
                  ? 'border-gold bg-gold/5'
                  : 'border-gray-200 hover:border-gold/30'
              }`}>
              <div className="font-bold text-navy">{formatCurrency(opt.total)}</div>
              <div className="text-sm text-gray-500">
                {opt.parcelas}x de {formatCurrency(opt.valorParcela)}
              </div>
            </button>
          ))}

          <button
            onClick={selectPersonalizado}
            className={`p-4 rounded-lg border-2 text-left transition-all cursor-pointer ${
              h.tipo === 'personalizado' ? 'border-gold bg-gold/5' : 'border-gray-200 hover:border-gold/30'
            }`}>
            <div className="font-bold text-navy">Valor Personalizado</div>
            <div className="text-sm text-gray-500">Definir valores manualmente</div>
          </button>
        </div>

        {h.tipo === 'personalizado' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div>
              <label className="label-field">Valor Total (R$) *</label>
              <input type="number" className={`input-field ${errors.total ? 'input-error' : ''}`}
                value={h.total || ''} onChange={(e) => {
                  const total = Number(e.target.value);
                  const vp = h.parcelas > 0 ? Math.round((total / h.parcelas) * 100) / 100 : 0;
                  updateHonorarios({ total, valorParcela: vp });
                }} />
            </div>
            <div>
              <label className="label-field">Nº Parcelas *</label>
              <input type="number" className={`input-field ${errors.parcelas ? 'input-error' : ''}`}
                value={h.parcelas || ''} onChange={(e) => {
                  const parcelas = Number(e.target.value);
                  const vp = parcelas > 0 ? Math.round((h.total / parcelas) * 100) / 100 : 0;
                  updateHonorarios({ parcelas, valorParcela: vp });
                }} />
            </div>
            <div>
              <label className="label-field">Valor Parcela</label>
              <input type="text" className="input-field bg-gray-50" readOnly
                value={h.valorParcela ? formatCurrency(h.valorParcela) : ''} />
            </div>
          </div>
        )}
      </div>

      {/* Percentual de êxito */}
      <div className="card mb-6">
        <h3 className="font-heading text-lg font-bold text-navy mb-4">Honorários de Êxito (Ad Exitum)</h3>
        <div className="flex flex-wrap gap-3">
          {PERCENTUAIS_EXITO.map((p) => (
            <button key={p}
              onClick={() => updateHonorarios({ percentualExito: p })}
              className={`px-6 py-3 rounded-lg border-2 font-bold transition-all cursor-pointer ${
                h.percentualExito === p
                  ? 'border-gold bg-gold/5 text-gold'
                  : 'border-gray-200 text-navy hover:border-gold/30'
              }`}>
              {p}%
            </button>
          ))}
        </div>
        {errors.percentualExito && <p className="text-red-500 text-xs mt-2">{errors.percentualExito}</p>}
      </div>

      {/* Data 1ª parcela */}
      <div className="card mb-6">
        <h3 className="font-heading text-lg font-bold text-navy mb-4">Data da 1ª Parcela</h3>
        <input type="date" className={`input-field max-w-xs ${errors.dataPrimeiraParcela ? 'input-error' : ''}`}
          value={h.dataPrimeiraParcela || ''}
          onChange={(e) => updateHonorarios({ dataPrimeiraParcela: e.target.value })} />
        {errors.dataPrimeiraParcela && <p className="text-red-500 text-xs mt-2">{errors.dataPrimeiraParcela}</p>}
      </div>

      {/* Resumo */}
      {h.total > 0 && h.dataPrimeiraParcela && (
        <div className="card mb-6 bg-navy/5 border-navy/20">
          <h3 className="font-heading text-lg font-bold text-navy mb-3">Resumo dos Honorários</h3>
          <div className="space-y-1 text-sm">
            <p><strong>Parte Fixa:</strong> {formatCurrency(h.total)} ({valorExtenso(h.total)})</p>
            <p><strong>Parcelamento:</strong> {h.parcelas}x de {formatCurrency(h.valorParcela)} ({valorExtenso(h.valorParcela)})</p>
            <p><strong>1ª Parcela:</strong> {new Date(h.dataPrimeiraParcela + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
            {diaParcela && <p><strong>Demais parcelas:</strong> todo dia {diaParcela} dos meses subsequentes</p>}
            <p><strong>Êxito:</strong> {h.percentualExito}% sobre o proveito econômico</p>
          </div>
        </div>
      )}

      <div className="flex justify-between mt-4">
        <button className="btn-outline" onClick={() => setCurrentStep(2)}>Voltar</button>
        <button className="btn-primary" onClick={handleNext}>Avançar</button>
      </div>
    </div>
  );
}
