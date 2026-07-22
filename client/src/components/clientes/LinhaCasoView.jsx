// Ficha "Linha do Caso" (21/07/2026) — a visao principal ao clicar no nome do cliente.
// Layout escolhido pelo Paulo (mockups prototipos/ficha-cliente-redesign): espinha
// cronologica central + no HOJE + satelites. A edicao continua no drawer antigo (Ficha),
// aberto pelo botao "Editar dados".
import { useEffect, useMemo, useState } from 'react';
import { buscar360, buscarAcoesDrive, buscarDadosBancarios, buscarLinhaCaso } from '../../utils/clientesService';
import { buildLinhaCaso, dataBRLC, reaisLC, idadeDe } from '../../utils/linhaCaso';

const TIPO_LABEL = { marco: 'Marco', etapa: 'Etapa', tribunal: 'Tribunal', equipe: 'Equipe', financeiro: 'Financeiro', relacionamento: 'Relacionamento' };

function hojeISO() { return new Date().toISOString().slice(0, 10); }

export default function LinhaCasoView({ row, onClose, onEditar, onAbrir }) {
  const [info, setInfo] = useState(null);
  const [acoes, setAcoes] = useState([]);
  const [lc, setLc] = useState(null);
  const [banc, setBanc] = useState(null);
  const [expandTl, setExpandTl] = useState(false);
  const hoje = hojeISO();

  useEffect(() => {
    let live = true;
    buscar360(row.id).then((d) => { if (live) setInfo(d); }).catch(() => {});
    buscarAcoesDrive(row.id).then((a) => { if (live) setAcoes(a); }).catch(() => {});
    buscarLinhaCaso(row.id).then((d) => { if (live) setLc(d || {}); }).catch(() => { if (live) setLc({}); });
    buscarDadosBancarios(row.id).then((b) => { if (live) setBanc(b); }).catch(() => {});
    return () => { live = false; };
  }, [row.id]);

  const modelo = useMemo(() => (lc == null ? null
    : buildLinhaCaso({ row, info: info || {}, acoes, lc, hoje })), [row, info, acoes, lc, hoje]);

  const copiar = (txt) => { try { navigator.clipboard?.writeText(txt); } catch { /* ignore */ } };
  const idade = idadeDe(row.nascimento, hoje);
  const qual = [idade ? `${idade} anos` : null, info?.profissao, info?.estado_civil,
    [row.cidade, row.uf].filter(Boolean).join('/') || null,
    row.relacao === 'parte_contraria' ? 'parte contraria' : null].filter(Boolean).join(' · ');

  // eventos visiveis: colapsa o meio quando a espinha e longa
  const eventos = modelo?.eventos || [];
  const CAP = 14;
  const visiveis = (expandTl || eventos.length <= CAP)
    ? eventos
    : [...eventos.slice(0, 4), { colapsado: eventos.length - 12 }, ...eventos.slice(-8)];

  const h = modelo?.hojeNode;
  const trilhaExec = h?.emExecucao ? (
    /LEVANTAMENTO/i.test(h.etapa || '') ? 3 : /PENHORA/i.test(h.etapa || '') ? 2 : 1
  ) : 0;

  return (
    <>
      <div className="scrim lc-scrim" onClick={onClose} />
      <section className="lc-modal" role="dialog" aria-label={'Linha do caso de ' + row.nome}>
        <header className="lc-head">
          <button className="x lc-x" onClick={onClose} aria-label="fechar">×</button>
          <div className="lc-head-top">
            <div style={{ minWidth: 0 }}>
              <div className="lc-nome">{row.nome || '(sem nome)'}</div>
              <div className="lc-qual">{qual || '—'}</div>
            </div>
            <div className="lc-acoes">
              <button className="btn gold btn-press" onClick={onEditar}>Editar dados</button>
              <button className="btn" onClick={() => copiar([row.nome, row.cpf_fmt, row.telefone, row.email].filter(Boolean).join(' · '))}>Copiar dados</button>
            </div>
          </div>
          {modelo && modelo.chips.length > 0 && (
            <div className="lc-chips">
              {modelo.chips.map((c, i) => (
                <span key={i} className={'lc-chip ' + c.tipo}>{c.txt}</span>
              ))}
            </div>
          )}
          <div className="lc-fields">
            <div><span>CPF</span><b className="tnum">{row.cpf_fmt || '—'}</b></div>
            <div><span>Nascimento</span><b className="tnum">{dataBRLC(row.nascimento) || '—'}</b></div>
            <div><span>Telefone</span><b className="tnum">{row.telefone || '—'}</b></div>
            <div><span>E-mail</span><b>{row.email || '—'}</b></div>
            <div className="wide"><span>Endereço</span><b>{[info?.logradouro, info?.bairro].filter(Boolean).join(', ') || '—'}{info?.cep ? ` · CEP ${info.cep}` : ''}</b></div>
          </div>
        </header>

        {!modelo ? (
          <div className="lc-body"><div className="muted" style={{ padding: 30, textAlign: 'center' }}>Carregando a linha do caso…</div></div>
        ) : (
        <div className="lc-body">
          {/* satelite esquerdo */}
          <aside className="lc-sat">
            <div className="lc-pan">
              <h3>Investimento {modelo.investimento.cotas > 0 && <small>{modelo.investimento.cotas} cota(s)</small>}</h3>
              {acoes.filter((a) => !a.fora_censo).map((a) => (
                <div key={a.id} className="lc-cota">
                  <b>{a.resort || 'Resort a identificar'}</b>
                  {a.unidade_cota && <div className="muted lc-sm">{a.unidade_cota}</div>}
                  <div className="lc-cota-l tnum">
                    <span>{a.data_contrato_compra ? `compra ${dataBRLC(a.data_contrato_compra)}` : 'data de compra pendente'}</span>
                    <b>{a.valor_pago != null ? reaisLC(a.valor_pago) : 'valor pendente'}</b>
                  </div>
                  {a.drive_folder_link && <a className="lc-link" href={a.drive_folder_link} target="_blank" rel="noreferrer">Abrir pasta ↗</a>}
                  {a.needs_review && <span className="lc-chip warn" style={{ marginLeft: 6 }}>revisar</span>}
                </div>
              ))}
              {acoes.filter((a) => !a.fora_censo).length === 0 && (
                <div className="muted lc-sm">Nenhuma ação minerada — valor e resort aguardam mineração do Drive.</div>
              )}
              {modelo.investimento.total != null && (
                <div className="lc-total">
                  <span>Total investido</span>
                  <b className="tnum">{reaisLC(modelo.investimento.total)}</b>
                  {modelo.investimento.percExito > 0 && (
                    <i>Êxito potencial ({modelo.investimento.percExito}%): {reaisLC(modelo.investimento.total * modelo.investimento.percExito / 100)}</i>
                  )}
                </div>
              )}
            </div>
            {info?.conjuge_uid && (
              <div className="lc-pan">
                <h3>Cônjuge</h3>
                <b style={{ fontSize: 13 }}>{info.conjuge_nome || 'Vinculado'}</b>
                {info.conjuge_n_vencidos > 0 && <div className="lc-sm" style={{ color: 'var(--c-danger)' }}>{info.conjuge_n_vencidos} cobrança(s) vencida(s)</div>}
                <div style={{ marginTop: 6 }}>
                  <button className="btn" onClick={() => onAbrir(info.conjuge_uid)}>Abrir ficha do cônjuge</button>
                </div>
              </div>
            )}
            {(h?.responsavel || h?.tarefasAbertas != null) && (
              <div className="lc-pan">
                <h3>Equipe no caso</h3>
                {h.responsavel && <div className="lc-sm"><b>{h.responsavel}</b> · responsável</div>}
                {h.tarefasAbertas != null && (
                  <span className={'lc-chip ' + (h.tarefasAbertas > 0 ? 'info' : 'ok')} style={{ marginTop: 6 }}>
                    {h.tarefasAbertas === 0 ? 'nada pendente com a equipe' : `${h.tarefasAbertas} tarefa(s) aberta(s)`}
                  </span>
                )}
              </div>
            )}
          </aside>

          {/* espinha central */}
          <div className="lc-spine">
            {eventos.length === 0 && (
              <div className="lc-pan"><div className="muted lc-sm">Sem eventos datados ainda — a linha cresce conforme o caso anda.</div></div>
            )}
            {visiveis.map((e, i) => e.colapsado ? (
              <button key={'col' + i} className="lc-ev lc-colapso" onClick={() => setExpandTl(true)}>
                <span className="lc-ev-data" />
                <span className="lc-ev-dot mut" />
                <span className="lc-ev-card muted">+ {e.colapsado} eventos — expandir linha completa</span>
              </button>
            ) : (
              <div key={e.data + e.titulo} className={'lc-ev t-' + e.tipo}>
                <span className="lc-ev-data tnum">{dataBRLC(e.data)}</span>
                <span className={'lc-ev-dot ' + e.tipo + (e.destaque ? ' hi' : '')} />
                <div className={'lc-ev-card' + (e.destaque ? ' hi' : '')}>
                  <span className="lc-ev-tipo">{TIPO_LABEL[e.tipo] || ''}</span>
                  <b>{e.titulo}</b>
                  {e.sub && <div className="muted lc-sm">{e.sub}</div>}
                  {e.prescricao && (
                    <div className="lc-presc">
                      <i style={{ width: e.prescricao.pct + '%' }} />
                      <span className="tnum">Prescrição {e.prescricao.anosTxt} ({e.prescricao.pct}%){e.prescricao.interrompida ? ' — interrompida no ajuizamento' : ''}</span>
                    </div>
                  )}
                  {e.interrompePrescricao && <span className="lc-chip ok" style={{ marginTop: 4 }}>prescrição interrompida — as réguas param aqui</span>}
                </div>
              </div>
            ))}
            {modelo.andamentosTotal > (lc?.andamentos?.length || 0) && (
              <div className="muted lc-sm" style={{ margin: '2px 0 8px 108px' }}>
                {modelo.andamentosTotal} andamentos no total (mostrando os {lc.andamentos.length} últimos)
              </div>
            )}

            {/* NO HOJE */}
            {(h?.etapa || h?.repassePendente) && (
              <div className="lc-ev t-hoje">
                <span className="lc-ev-data tnum"><b>hoje</b></span>
                <span className="lc-ev-dot hoje" />
                <div className="lc-hoje">
                  <span className="lc-hoje-k">HOJE · FASE ATUAL</span>
                  {h.repassePendente ? (
                    <>
                      <div className="lc-hoje-t">O dinheiro está na conta — falta repassar</div>
                      <div className="lc-hoje-valor tnum">{reaisLC(h.repassePendente.valorCliente)}</div>
                      <div className="lc-hoje-sub">a repassar à cliente · escritório retém {reaisLC(h.repassePendente.valorEscritorio)}
                        {h.repassePendente.diasAguardando != null ? ` · aguardando há ${h.repassePendente.diasAguardando} dias` : ''}</div>
                      {banc && (
                        <div className="lc-banc tnum">
                          {[banc.banco, banc.agencia && `ag ${banc.agencia}`, banc.conta && `cc ${banc.conta}`, banc.chave_pix && `PIX ${banc.tipo_pix || ''} ${banc.chave_pix}`].filter(Boolean).join(' · ')}
                          {banc.fonte === 'conjuge' && ' (conta do cônjuge)'}
                          <button className="btn lc-btn-inv" onClick={() => copiar([banc.banco, banc.agencia, banc.conta, banc.chave_pix].filter(Boolean).join(' '))}>Copiar</button>
                        </div>
                      )}
                      {!banc && <div className="lc-hoje-sub" style={{ color: 'var(--c-gold)' }}>sem dados bancários cadastrados — pedir à cliente</div>}
                    </>
                  ) : (
                    <>
                      <div className="lc-hoje-t">{[h.quadro, h.etapa].filter(Boolean).join(' — ') || 'Situação a apurar'}</div>
                      {h.diasNaEtapa != null && <span className="lc-chip gold-d">há {h.diasNaEtapa < 1 ? 'menos de 1 dia' : Math.round(h.diasNaEtapa) + ' dias'} nesta etapa</span>}
                    </>
                  )}
                  {(h.processo || h.responsavel) && (
                    <div className="lc-hoje-meta tnum">
                      {h.processo && <span>proc <b>{h.processo}</b></span>}
                      {h.responsavel && <span>resp. <b>{h.responsavel}</b></span>}
                    </div>
                  )}
                  {trilhaExec > 0 && !h.repassePendente && (
                    <div className="lc-trilha">
                      {['SISBAJUD', 'Penhora', 'Levantamento'].map((s, i2) => (
                        <span key={s} className={'lc-passo' + (i2 + 1 === trilhaExec ? ' on' : i2 + 1 < trilhaExec ? ' done' : '')}>{i2 + 1} · {s}</span>
                      ))}
                      <span className="lc-passo dinheiro">→ dinheiro de volta</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* futuro */}
            {modelo.futuros.map((f, i) => (
              <div key={'fut' + i} className="lc-ev t-futuro">
                <span className="lc-ev-data tnum">{f.data ? dataBRLC(f.data) : 'próximo'}</span>
                <span className="lc-ev-dot futuro" />
                <div className={'lc-ev-card futuro' + (f.urgente ? ' urg' : '')}><b>{f.titulo}</b></div>
              </div>
            ))}
            <div className="muted lc-sm" style={{ margin: '4px 0 0 108px' }}>Linha do caso · atualizada em {dataBRLC(hoje)}</div>
          </div>

          {/* satelite direito */}
          <aside className="lc-sat">
            <div className="lc-pan">
              <h3>Honorários</h3>
              {modelo.investimento.percExito != null && (
                <div className="lc-hl"><span>Êxito</span><b>{modelo.investimento.percExito}%{modelo.investimento.percExito === 0 ? ' — não se aplica' : ' sobre o recuperado'}</b></div>
              )}
              {Number(info?.valor_total) > 0 ? (
                <>
                  <div className="lc-fin tnum"><b>{reaisLC(info.fin_recebido)}</b><span> de {reaisLC(info.valor_total)}</span></div>
                  <div className="lc-seg" aria-hidden>
                    {Array.from({ length: Math.min(24, info.n_boletos || 0) }, (_, i) => (
                      <i key={i} className={i < (info.n_pagos || 0) ? 'pg' : ''} />
                    ))}
                  </div>
                  <div className="lc-hl tnum"><span>{info.n_pagos ?? 0} de {info.n_boletos ?? 0} parcelas</span><b>{info.n_vencidos > 0 ? `${info.n_vencidos} vencida(s)` : '0 vencidas'}</b></div>
                  {info.proximo_venc && <div className="lc-hl tnum"><span>Próximo venc.</span><b>{dataBRLC(info.proximo_venc)}</b></div>}
                  {lc?.nfs > 0 && <span className="lc-chip info">{lc.nfs} NF(s) emitida(s)</span>}
                  {info.n_vencidos === 0 && <span className="lc-chip ok" style={{ marginLeft: 4 }}>cliente adimplente</span>}
                </>
              ) : <div className="muted lc-sm">Sem cobranças no Asaas.</div>}
            </div>
            {Array.isArray(lc?.mles) && lc.mles.some((m) => m.recebido_em) && (
              <div className="lc-pan lc-pan-rec">
                <h3>Recuperado</h3>
                {lc.mles.filter((m) => m.recebido_em).map((m, i) => (
                  <div key={i}>
                    <div className="lc-fin tnum"><b style={{ color: 'var(--c-ok)' }}>{reaisLC(m.valor_recebido)}</b></div>
                    <div className="lc-sm muted tnum">recebido em {dataBRLC(m.recebido_em)}{m.num_processo ? ` · proc ${m.num_processo}` : ''}</div>
                    <div className="lc-hl tnum"><span>Cliente</span><b>{reaisLC(m.valor_cliente)}</b></div>
                    <div className="lc-hl tnum"><span>Escritório</span><b>{reaisLC(m.valor_escritorio)}</b></div>
                    {!m.repassado_em
                      ? <span className="lc-chip warn">repasse pendente</span>
                      : <span className="lc-chip ok">repassado em {dataBRLC(m.repassado_em)}</span>}
                  </div>
                ))}
              </div>
            )}
            {(lc?.kommo || row.kommo || lc?.portal) && (
              <div className="lc-pan">
                <h3>Relacionamento</h3>
                {(lc?.kommo?.lead_id || row.kommo) && (
                  <div className="lc-hl"><span>Kommo</span>
                    <a className="lc-link" href={`https://advocaciacbc.kommo.com/leads/detail/${lc?.kommo?.lead_id || row.kommo}`} target="_blank" rel="noreferrer">abrir conversa ↗</a>
                  </div>
                )}
                {lc?.kommo?.tel_diverge && <div className="lc-sm" style={{ color: 'var(--c-warn)' }}>⚠ telefone no Kommo difere da ficha — conferir antes de ligar</div>}
                {lc?.portal && (
                  <div className="lc-hl"><span>Portal</span>
                    <b>{lc.portal.acessos > 0 ? `último acesso ${dataBRLC(lc.portal.ultimo_acesso) || '—'}` : 'nunca acessou'}</b>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
        )}
      </section>
    </>
  );
}
