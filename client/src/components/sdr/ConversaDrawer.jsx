import { useEffect, useState } from 'react';
import { carregarMensagens, enviarMensagem } from './api';
import { janelaAberta, minutosSemResposta, fmtEspera } from '../../utils/sdrRegras';
import { useModalEscape } from '../../hooks/useModalEscape';

const KOMMO = 'https://advocaciacbc.kommo.com/leads/detail/';

/**
 * Gaveta com o historico da conversa, sem tirar o SDR da fila.
 *
 * As mensagens vem do espelho que o kommo-conversas-sync ja mantem (atendimento.mensagens,
 * via public.vw_sdr_mensagens). Responder ainda acontece no Kommo: o envio pelo sistema
 * depende de um teste na conta real (ver o spec, secao 7).
 */
export default function ConversaDrawer({ lead, onFechar }) {
  // O painel monta este componente com key = conversa_id, entao cada conversa comeca
  // com estado proprio. Por isso o "carregando" nasce true no useState em vez de ser
  // ligado dentro do efeito: setState sincrono no corpo do efeito dispara renderizacao
  // em cascata (regra do react-hooks).
  const [msgs, setMsgs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [avisoEnvio, setAvisoEnvio] = useState('');

  useModalEscape(!!lead, onFechar);

  useEffect(() => {
    const id = lead?.conversa_id;
    if (!id) return undefined;
    let vivo = true;
    carregarMensagens(id)
      .then((d) => { if (vivo) setMsgs(d); })
      .catch((e) => { if (vivo) setErro('Não consegui carregar a conversa. ' + (e?.message || '')); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [lead?.conversa_id]);

  if (!lead) return null;

  const agora = new Date();
  const min = minutosSemResposta(lead.ultima_em, agora);
  const aberta = janelaAberta(lead.ultima_em, agora);

  return (
    <>
      <button type="button" aria-label="Fechar conversa" onClick={onFechar}
        className="fixed inset-0 z-40 cursor-default"
        style={{ background: 'rgba(15,32,53,.45)' }} />
      <aside role="dialog" aria-modal="true" aria-label={`Conversa de ${lead.nome || 'lead'}`}
        className="fixed top-0 right-0 bottom-0 z-50 w-[520px] max-w-[94vw] flex flex-col"
        style={{ background: 'var(--cbc-bg-card)', borderLeft: '1px solid var(--cbc-border)' }}>

        <div className="flex items-start gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--cbc-border)' }}>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg truncate">
              {lead.nome || lead.telefone || 'Conversa sem nome'}
            </h3>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--cbc-text-muted)' }}>
              {[
                lead.lead_id ? `lead ${lead.lead_id}` : 'sem lead casado no Kommo',
                lead.resort || 'resort não identificado',
                min != null ? `esperando há ${fmtEspera(min)}` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="text-xl leading-none px-2 py-0.5 rounded"
            style={{ color: 'var(--cbc-text-muted)' }}>✕</button>
        </div>

        <div className="px-4 py-2 text-[11px] border-b flex items-center gap-2"
          style={aberta
            ? { borderColor: 'var(--cbc-success-border)', background: 'var(--cbc-success-bg)', color: 'var(--cbc-success)' }
            : { borderColor: 'var(--cbc-danger-border)', background: 'var(--cbc-danger-bg)', color: 'var(--cbc-danger)' }}>
          <span aria-hidden="true">{aberta ? '✔' : '⚠'}</span>
          <span>
            {aberta
              ? 'Janela de 24 horas aberta: dá para responder à vontade pelo Kommo.'
              : 'Fora da janela de 24 horas. A Meta só aceita template aprovado a partir daqui.'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2"
          style={{ background: 'var(--cbc-bg-subtle)' }}>
          {!lead.conversa_id && (
            <p className="text-sm" style={{ color: 'var(--cbc-text-muted)' }}>
              Não há conversa espelhada para este lead: a linha veio da agenda ou do funil.
            </p>
          )}
          {lead.conversa_id && carregando && (
            <p className="text-sm" style={{ color: 'var(--cbc-text-muted)' }}>Carregando a conversa...</p>
          )}
          {erro && <p className="text-sm" style={{ color: 'var(--cbc-danger)' }}>{erro}</p>}
          {lead.conversa_id && !carregando && !erro && !msgs.length && (
            <p className="text-sm" style={{ color: 'var(--cbc-text-muted)' }}>
              Nenhuma mensagem espelhada para esta conversa.
            </p>
          )}
          {msgs.map((m) => {
            const doCliente = m.autor === 'cliente';
            return (
              <div key={m.id}
                className={`max-w-[82%] px-3 py-2 rounded-xl text-[12.5px] leading-relaxed whitespace-pre-wrap ${doCliente ? 'self-start' : 'self-end'}`}
                style={doCliente
                  ? { background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)', borderBottomLeftRadius: 4 }
                  : { background: 'var(--cbc-success-bg)', border: '1px solid var(--cbc-success-border)', borderBottomRightRadius: 4 }}>
                {!doCliente && m.autor_nome && (
                  <span className="block text-[10px] font-bold mb-0.5" style={{ color: 'var(--cbc-text-muted)' }}>
                    {m.autor_nome}
                  </span>
                )}
                {m.texto || m.midia_label || `[${m.tipo || 'sem texto'}]`}
                <span className="block text-[10px] mt-1" style={{ color: 'var(--cbc-text-muted)' }}>
                  {new Date(m.enviada_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                </span>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--cbc-border)', background: 'var(--cbc-bg-subtle)' }}>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)}
            disabled={!aberta || !lead.lead_id || enviando}
            placeholder={!lead.lead_id ? 'Sem lead no Kommo: não há para onde enviar'
              : aberta ? 'Escreva a resposta...'
              : 'Fora da janela de 24 horas: só template aprovado sai daqui'}
            className="w-full rounded-lg px-3 py-2 text-[12.5px]"
            style={{ minHeight: 62, resize: 'vertical', border: '1px solid var(--cbc-border-strong)',
                     background: aberta && lead.lead_id ? 'var(--cbc-bg-card)' : 'var(--cbc-bg-subtle)',
                     color: 'var(--cbc-text-primary)' }} />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button type="button" className="btn btn-gold btn-sm"
              disabled={!aberta || !lead.lead_id || enviando || !texto.trim()}
              onClick={async () => {
                setEnviando(true); setAvisoEnvio('');
                try {
                  await enviarMensagem(lead.lead_id, texto.trim());
                  setMsgs((m) => m.concat([{ id: `local-${Date.now()}`, autor: 'atendente',
                    autor_nome: 'você, pela aba', texto: texto.trim(), enviada_em: new Date().toISOString() }]));
                  setTexto('');
                  setAvisoEnvio('Enviada pelo número oficial. Ela aparece na conversa do Kommo em alguns segundos.');
                } catch (e) {
                  setAvisoEnvio(e?.message || 'não consegui enviar');
                } finally { setEnviando(false); }
              }}>
              {enviando ? 'Enviando...' : 'Enviar pelo Kommo'}
            </button>
            <span className="text-[11px]" style={{ color: 'var(--cbc-text-muted)' }}>
              Só texto: áudio, imagem e anexo continuam no Kommo.
            </span>
          </div>
          {avisoEnvio && (
            <p className="text-[11px] mt-2" style={{ color: /não consegui|fora da janela|sem |falha/i.test(avisoEnvio) ? 'var(--cbc-danger)' : 'var(--cbc-success)' }}>
              {avisoEnvio}
            </p>
          )}
        </div>

        <div className="px-4 py-3 border-t flex items-center gap-2 flex-wrap"
          style={{ borderColor: 'var(--cbc-border)' }}>
          {lead.lead_id ? (
            <a className="btn btn-primary btn-sm" href={`${KOMMO}${lead.lead_id}`}
              target="_blank" rel="noopener noreferrer">Abrir no Kommo</a>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--cbc-warning)' }}>
              Sem lead casado no Kommo: não há conversa para abrir lá.
            </span>
          )}
          <span className="text-[11px] ml-auto" style={{ color: 'var(--cbc-text-muted)' }}>
            {msgs.length} mensagens espelhadas
          </span>
        </div>
      </aside>
    </>
  );
}
