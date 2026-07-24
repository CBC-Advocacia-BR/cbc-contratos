// Modal de excecao "contrato sem lead no Kommo": confirma que nao ha lead e
// registra quem/quando/motivo (gravado em contratos.sem_kommo ao salvar).
import { useState } from 'react';
import { montarRegistroSemKommo } from '../utils/kommoResolve';

const MOTIVOS = [
  'Cliente anterior ao Kommo',
  'Indicação direta sem cadastro no Kommo',
  'Migração / contrato retroativo',
  'Atendimento por outro canal (presencial / telefone)',
  'Outro motivo (descrever)',
];

export default function KommoSemVinculoModal({ userEmail, onConfirmar, onCancelar }) {
  const [motivo, setMotivo] = useState('');
  const [outro, setOutro] = useState('');
  const [confirmado, setConfirmado] = useState(false);

  const ehOutro = motivo === 'Outro motivo (descrever)';
  const motivoFinal = ehOutro ? outro.trim() : motivo;
  const podeConfirmar = !!motivoFinal && confirmado;
  const agora = new Date();
  const quando = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

  const confirmar = () => {
    if (!podeConfirmar) return;
    onConfirmar(montarRegistroSemKommo(userEmail, motivoFinal, agora.toISOString()));
  };

  return (
    <div
      role="dialog" aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,32,53,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}
    >
      <div style={{ width: 'min(520px,100%)', background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px -14px rgba(15,32,53,.34)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px 14px', display: 'flex', gap: 13, alignItems: 'flex-start', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FBF1E3', border: '1px solid rgba(180,83,9,.32)', color: '#B45309', fontWeight: 900 }}>!</div>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#1B3A5C' }}>Contrato sem lead no Kommo</h3>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#5E6675' }}>Registro de exceção — fica gravado com responsável e data.</p>
          </div>
        </div>

        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12.5, color: '#5c3406', background: '#FBF1E3', border: '1px solid rgba(180,83,9,.32)', borderRadius: 12, padding: '11px 13px', lineHeight: 1.5 }}>
            Quase todo contrato tem um lead no Kommo. Confirme abaixo <b>apenas</b> se você verificou (nome, telefone, CPF) e o lead realmente não existe.
          </div>

          <div>
            <label className="label-field">Por que não há lead no Kommo? *</label>
            <select className="input-field" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option value="">Selecione o motivo…</option>
              {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {ehOutro && (
            <div>
              <label className="label-field">Descreva o motivo *</label>
              <textarea className="input-field" rows={2} value={outro} onChange={(e) => setOutro(e.target.value)}
                placeholder="Explique por que este contrato não tem lead no Kommo…" />
            </div>
          )}

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, color: '#1a1a1a', lineHeight: 1.45, cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)}
              style={{ width: 18, height: 18, flex: '0 0 auto', marginTop: 1, accentColor: '#1B3A5C', cursor: 'pointer' }} />
            <span>Confirmo que verifiquei e <b>não localizei</b> lead no Kommo para este cliente. Assumo a responsabilidade por criar o contrato como exceção.</span>
          </label>

          <div style={{ background: '#F7FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: '#8A95A5', marginBottom: 8 }}>Este registro ficará gravado</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '3px 0' }}>
              <span style={{ color: '#5E6675' }}>Responsável</span><b style={{ color: '#1B3A5C' }}>{userEmail || '—'}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '3px 0' }}>
              <span style={{ color: '#5E6675' }}>Data / hora</span><b style={{ color: '#1B3A5C' }}>{quando} (BRT)</b>
            </div>
          </div>
        </div>

        <div style={{ padding: '15px 22px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #E2E8F0', background: '#F7FAFC' }}>
          <button type="button" onClick={onCancelar} className="btn-outline" style={{ padding: '10px 18px' }}>Cancelar</button>
          <button type="button" onClick={confirmar} disabled={!podeConfirmar} className="btn-primary"
            style={{ padding: '10px 18px', opacity: podeConfirmar ? 1 : 0.45, cursor: podeConfirmar ? 'pointer' : 'not-allowed' }}>
            Confirmar e liberar formulário
          </button>
        </div>
      </div>
    </div>
  );
}
