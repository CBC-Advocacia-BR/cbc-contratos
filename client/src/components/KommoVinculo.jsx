// Passo 1 do Novo Contrato (atras da flag kommo_vinculo): link do Kommo como 1o
// campo + botao "Vincular" que preenche o form a partir do lead + Semaforo de
// prontidao + "Preencher sem vincular" (excecao). Nome NUNCA vem do Kommo.
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useContract } from '../ContractContext';
import { useAuth } from '../AuthContext';
import { montarPreenchimento } from '../utils/kommoResolve';
import KommoSemVinculoModal from './KommoSemVinculoModal';

// campos que moram em `data` (nao no contratante)
const DATA_KEYS = new Set(['resort', 'dataPrimeiraMensagem']);

export default function KommoVinculo({ onDesbloquear, desbloqueado }) {
  const { data, updateData, updateContratante, aplicarVinculo } = useContract();
  const { user } = useAuth();
  const c0 = data.contratantes?.[0] || {};
  const link = c0.linkKommo || '';

  const [estado, setEstado] = useState('idle'); // idle | carregando | vinculado | erro
  const [msg, setMsg] = useState('');
  const [conhecido, setConhecido] = useState(false);
  const [resortConfirmar, setResortConfirmar] = useState(false);
  const [resortOpcoes, setResortOpcoes] = useState(null); // (item 4) cadastro c/ varios resorts
  const [showSemKommo, setShowSemKommo] = useState(false);

  const setLink = (v) => updateContratante(0, { linkKommo: v });

  async function vincular() {
    if (!/\/leads\/detail\/\d+/.test(link)) {
      setEstado('erro'); setMsg('Cole a URL do lead no Kommo (…/leads/detail/NÚMERO).');
      return;
    }
    setEstado('carregando'); setMsg('Lendo o lead no Kommo…');
    try {
      let token = null;
      try { const { data: sess } = await supabase.auth.getSession(); token = sess?.session?.access_token || null; } catch { /* trata abaixo */ }
      if (!token) {
        setEstado('erro'); setMsg('Sessão expirada — recarregue a página (F5), faça login de novo e tente vincular.');
        return;
      }
      const r = await fetch('/.netlify/functions/resolve-kommo-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ link }),
        signal: AbortSignal.timeout(25000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        const detalhe = j.motivo || j.error || `HTTP ${r.status}`;
        setEstado('erro'); setMsg(`Não vinculou: ${detalhe}. Você pode preencher sem vincular.`);
        return;
      }
      const { campos, clienteConhecido, resortConfirmar: rc, resortOpcoes: ro } = montarPreenchimento(j);
      const contratanteCampos = {}; const dataCampos = {};
      for (const [k, v] of Object.entries(campos)) (DATA_KEYS.has(k) ? dataCampos : contratanteCampos)[k] = v;
      if (dataCampos.resort) dataCampos.resortAvisoKommo = true; // resort preenchido -> "confira"
      if (j.origemSugerida) dataCampos.origemCliente = j.origemSugerida; // sugestao (semaforo mostra "confira")
      // Opcao B: Vincular ZERA o formulario inteiro (mantendo so o link) e aplica os campos do lead/Cadastro.
      // Assim nenhum dado de um lead anterior sobra em campo que o novo lead nao preenche.
      aplicarVinculo(link, contratanteCampos, dataCampos);
      const porTelefone = clienteConhecido && j.matchPor === 'telefone';
      setConhecido(!!clienteConhecido); setResortConfirmar(!!rc); setResortOpcoes(ro || null);
      setEstado('vinculado');
      setMsg(clienteConhecido
        ? (porTelefone ? 'Cliente já cadastrado (casado pelo telefone) — dados do Cadastro Único.' : 'Cliente já cadastrado — dados puxados do Cadastro Único.')
        : 'Lead vinculado.');
      onDesbloquear && onDesbloquear();
    } catch (e) {
      const t = e?.name === 'TimeoutError' ? 'demorou demais (timeout 25s)' : (e?.message || 'erro de rede');
      setEstado('erro'); setMsg(`Não vinculou: ${t}. Você pode preencher sem vincular.`);
    }
  }

  // Semaforo (nome NAO entra — vem do CPF)
  const seg = [
    { k: 'Identidade', ok: !!c0.telefone },
    { k: 'Origem', ok: !!data.origemCliente, warn: !!data.origemCliente }, // (item 6) sugestao -> confira
    { k: 'Resort', ok: !!data.resort, warn: resortConfirmar && !!data.resort },
    { k: 'Contrato', ok: !!data.tipoAcao },
  ];

  return (
    <div className="cbc-vinculo-top mb-3 rounded-xl overflow-hidden border" style={{ borderColor: '#C0D0E8', background: '#F7FAFF' }}>
      <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-2" style={{ background: '#1B3A5C' }}>
        <span style={{ background: '#C9A84C', color: '#22303f', borderRadius: 6, padding: '1px 7px' }}>Passo 1</span>
        Vínculo com o Kommo
      </div>
      <div className="p-3">
        <label className="label-field">Link do lead no Kommo *</label>
        <div className="flex gap-2 flex-wrap">
          <input
            className="input-field flex-1"
            style={{ minWidth: 220 }}
            placeholder="https://advocaciacbc.kommo.com/leads/detail/..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={estado === 'carregando'}
          />
          <button
            type="button"
            onClick={vincular}
            disabled={estado === 'carregando'}
            className="btn-primary"
            style={{ padding: '0 20px', opacity: estado === 'carregando' ? 0.6 : 1 }}
          >
            {estado === 'carregando' ? 'Vinculando…' : desbloqueado ? 'Vincular de novo' : 'Vincular'}
          </button>
        </div>

        {msg && (
          <p className={`text-xs mt-2 font-semibold ${estado === 'erro' ? 'text-red-600' : estado === 'vinculado' ? 'text-green-700' : 'text-gray-500'}`}>
            {msg}{conhecido ? ' ✓' : ''}
          </p>
        )}

        {estado === 'vinculado' && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {seg.map((s) => (
              <span key={s.k}
                className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border flex items-center gap-1.5"
                style={s.warn
                  ? { background: '#FBF1E3', color: '#B45309', borderColor: 'rgba(180,83,9,.3)' }
                  : s.ok
                    ? { background: '#EAF6EE', color: '#15803D', borderColor: 'rgba(21,128,61,.28)' }
                    : { background: '#F3F5F8', color: '#5E6675', borderColor: '#CBD5E0' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.7 }} />
                {s.k}{s.warn ? ' · confira' : ''}
              </span>
            ))}
          </div>
        )}

        {estado === 'vinculado' && resortOpcoes && !data.resort && (
          <p className="text-[11px] mt-2 font-semibold" style={{ color: '#B45309' }}>
            ⚠ Este cliente tem histórico em {resortOpcoes.length} resorts: <b>{resortOpcoes.join(' · ')}</b> — escolha o resort deste contrato no campo Resort.
          </p>
        )}

        {data.semKommo ? (
          <div className="mt-3 pt-2.5 border-t flex flex-wrap items-center gap-x-2 gap-y-1" style={{ borderColor: '#E2E8F0' }}>
            <span className="text-[11px] font-bold" style={{ color: '#B45309' }}>⚠ Sem lead no Kommo</span>
            <span className="text-[11px] text-gray-500">registrado por <b>{data.semKommo.user || '—'}</b> · motivo: {data.semKommo.motivo}</span>
          </div>
        ) : !desbloqueado ? (
          <div className="mt-3 pt-2.5 border-t" style={{ borderColor: '#E2E8F0' }}>
            <button
              type="button"
              onClick={() => setShowSemKommo(true)}
              className="text-[11px] font-bold text-gray-500 hover:text-amber-700 underline underline-offset-2 cursor-pointer"
            >
              Não há lead no Kommo? Preencher sem vincular
            </button>
          </div>
        ) : null}
      </div>

      {showSemKommo && (
        <KommoSemVinculoModal
          userEmail={user?.email}
          onCancelar={() => setShowSemKommo(false)}
          onConfirmar={(reg) => { updateData({ semKommo: reg }); setShowSemKommo(false); if (onDesbloquear) onDesbloquear(); }}
        />
      )}
    </div>
  );
}
