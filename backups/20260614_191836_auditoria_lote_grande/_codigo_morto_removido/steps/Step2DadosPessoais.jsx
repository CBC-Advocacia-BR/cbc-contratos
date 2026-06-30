import { useState } from 'react';
import { useContract } from '../ContractContext';
import { maskCPF, maskCEP, maskRG } from '../utils/masks';
import { validateContratante } from '../utils/validation';
import { ESTADOS_CIVIS } from '../data/clausulas';

function FormContratante({ index, contratante, onChange, errors }) {
  const handle = (field, value) => onChange(index, { [field]: value });

  return (
    <div className="card mb-6">
      <h3 className="font-heading text-lg font-bold text-navy mb-4">
        Contratante {index + 1}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="label-field">Nome Completo *</label>
          <input className={`input-field ${errors.nome ? 'input-error' : ''}`}
            value={contratante.nome} onChange={(e) => handle('nome', e.target.value)}
            placeholder="Nome completo do contratante" />
          {errors.nome && <span className="text-red-500 text-xs mt-1">{errors.nome}</span>}
        </div>

        <div>
          <label className="label-field">Nacionalidade *</label>
          <input className={`input-field ${errors.nacionalidade ? 'input-error' : ''}`}
            value={contratante.nacionalidade} onChange={(e) => handle('nacionalidade', e.target.value)}
            placeholder="brasileiro(a)" />
          {errors.nacionalidade && <span className="text-red-500 text-xs mt-1">{errors.nacionalidade}</span>}
        </div>

        <div>
          <label className="label-field">Profissão *</label>
          <input className={`input-field ${errors.profissao ? 'input-error' : ''}`}
            value={contratante.profissao} onChange={(e) => handle('profissao', e.target.value)}
            placeholder="Ex: empresário, agricultor" />
          {errors.profissao && <span className="text-red-500 text-xs mt-1">{errors.profissao}</span>}
        </div>

        <div>
          <label className="label-field">Estado Civil *</label>
          <select className={`input-field ${errors.estadoCivil ? 'input-error' : ''}`}
            value={contratante.estadoCivil} onChange={(e) => handle('estadoCivil', e.target.value)}>
            <option value="">Selecione...</option>
            {ESTADOS_CIVIS.map((ec) => <option key={ec} value={ec}>{ec}</option>)}
          </select>
          {errors.estadoCivil && <span className="text-red-500 text-xs mt-1">{errors.estadoCivil}</span>}
        </div>

        <div>
          <label className="label-field">RG *</label>
          <input className={`input-field ${errors.rg ? 'input-error' : ''}`}
            value={contratante.rg} onChange={(e) => handle('rg', maskRG(e.target.value))}
            placeholder="Número do RG" />
          {errors.rg && <span className="text-red-500 text-xs mt-1">{errors.rg}</span>}
        </div>

        <div>
          <label className="label-field">CPF *</label>
          <input className={`input-field ${errors.cpf ? 'input-error' : ''}`}
            value={contratante.cpf} onChange={(e) => handle('cpf', maskCPF(e.target.value))}
            placeholder="000.000.000-00" />
          {errors.cpf && <span className="text-red-500 text-xs mt-1">{errors.cpf}</span>}
        </div>

        <div className="md:col-span-2">
          <label className="label-field">E-mail *</label>
          <input className={`input-field ${errors.email ? 'input-error' : ''}`}
            type="email" value={contratante.email} onChange={(e) => handle('email', e.target.value)}
            placeholder="email@exemplo.com" />
          {errors.email && <span className="text-red-500 text-xs mt-1">{errors.email}</span>}
        </div>

        <div className="md:col-span-2">
          <label className="label-field">Endereço (Rua, Número) *</label>
          <input className={`input-field ${errors.endereco ? 'input-error' : ''}`}
            value={contratante.endereco} onChange={(e) => handle('endereco', e.target.value)}
            placeholder="Rua Exemplo, 123" />
          {errors.endereco && <span className="text-red-500 text-xs mt-1">{errors.endereco}</span>}
        </div>

        <div>
          <label className="label-field">Bairro *</label>
          <input className={`input-field ${errors.bairro ? 'input-error' : ''}`}
            value={contratante.bairro} onChange={(e) => handle('bairro', e.target.value)}
            placeholder="Bairro" />
          {errors.bairro && <span className="text-red-500 text-xs mt-1">{errors.bairro}</span>}
        </div>

        <div>
          <label className="label-field">Cidade *</label>
          <input className={`input-field ${errors.cidade ? 'input-error' : ''}`}
            value={contratante.cidade} onChange={(e) => handle('cidade', e.target.value)}
            placeholder="Cidade" />
          {errors.cidade && <span className="text-red-500 text-xs mt-1">{errors.cidade}</span>}
        </div>

        <div>
          <label className="label-field">UF *</label>
          <input className={`input-field ${errors.uf ? 'input-error' : ''}`}
            value={contratante.uf} onChange={(e) => handle('uf', e.target.value.toUpperCase().slice(0, 2))}
            placeholder="SP" maxLength={2} />
          {errors.uf && <span className="text-red-500 text-xs mt-1">{errors.uf}</span>}
        </div>

        <div>
          <label className="label-field">CEP *</label>
          <input className={`input-field ${errors.cep ? 'input-error' : ''}`}
            value={contratante.cep} onChange={(e) => handle('cep', maskCEP(e.target.value))}
            placeholder="00000-000" />
          {errors.cep && <span className="text-red-500 text-xs mt-1">{errors.cep}</span>}
        </div>
      </div>
    </div>
  );
}

export default function Step2DadosPessoais() {
  const { data, updateContratante, setCurrentStep } = useContract();
  const [allErrors, setAllErrors] = useState([{}, {}]);

  const handleNext = () => {
    const errs = [];
    let hasError = false;
    for (let i = 0; i < data.numContratantes; i++) {
      const e = validateContratante(data.contratantes[i]);
      errs.push(e);
      if (Object.keys(e).length > 0) hasError = true;
    }
    setAllErrors(errs);
    if (!hasError) setCurrentStep(2);
  };

  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h2 className="font-heading text-2xl font-bold text-navy mb-6 text-center">
        Dados Pessoais dos Contratantes
      </h2>
      {Array.from({ length: data.numContratantes }, (_, i) => (
        <FormContratante
          key={i} index={i}
          contratante={data.contratantes[i]}
          onChange={updateContratante}
          errors={allErrors[i] || {}}
        />
      ))}
      <div className="flex justify-between mt-4">
        <button className="btn-outline" onClick={() => setCurrentStep(0)}>Voltar</button>
        <button className="btn-primary" onClick={handleNext}>Avançar</button>
      </div>
    </div>
  );
}
