import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { buscarClientes, editarCliente, setRelacao as svcSetRelacao, fundirClientes, cpfInvalido, buscarFilaRevisao, resolverFila, buscar360, vincularConjuge as svcVincularConjuge, desvincularConjuge as svcDesvincularConjuge, buscarCpfsDevedores, setKommo as svcSetKommo, buscarProveniencia, buscarCorrecoesAdvbox, buscarPrestacao } from '../utils/clientesService';
import './clientes/clientes.css';

const onlyDigits = (s) => (s || '').replace(/\D/g, '');
const cpfFmt = (s, fmt) => fmt || (() => { const d = onlyDigits(s); if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'); return s || '—'; })();
const telFmt = (s) => { const d = onlyDigits(s); if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3'); if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3'); return s || '—'; };
const idade = (d) => { if (!d) return null; const dt = new Date(d); if (isNaN(dt)) return null; const a = Math.floor((Date.now() - dt.getTime()) / 31557600000); return a > 0 && a < 130 ? a : null; };
const diasDesde = (d) => { if (!d) return null; const dt = new Date(d); if (isNaN(dt)) return null; return Math.floor((Date.now() - dt.getTime()) / 86400000); };
const dataBR = (d) => { if (!d) return null; const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[3]}/${m[2]}/${m[1]}`; const dt = new Date(d); return isNaN(dt) ? null : dt.toLocaleDateString('pt-BR'); };
const reais = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 });
const rowBtn = { fontSize: 11, padding: '2px 7px', marginRight: 4, border: '1px solid #d8dee6', borderRadius: 6, background: '#fff', color: 'var(--c-navy)', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
// dd/mm do aniversario (parse direto da string YYYY-MM-DD p/ evitar deslocamento de fuso)
const aniversarioData = (s) => { if (!s) return null; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[3] + '/' + m[2]; const d = new Date(s); return isNaN(d) ? null : String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const bdayMonth = (s) => { const dd = aniversarioData(s); return dd ? +dd.slice(3) : null; };
const mesAtual = () => new Date().getMonth() + 1; // 1-12
const aniversarioMes = (r) => bdayMonth(r.nascimento) === mesAtual();
const aniversarioProxMes = (r) => bdayMonth(r.nascimento) === (mesAtual() % 12 + 1);
// ordena este mes (offset 0) por dia, depois mes que vem (offset 1) por dia — robusto no virar do ano
const bdayOrder = (s) => { const dd = aniversarioData(s); if (!dd) return 99999; const day = +dd.slice(0, 2), mon = +dd.slice(3); return ((mon - mesAtual() + 12) % 12) * 100 + day; };
const completude = (r) => { const c = [r.nome, r.cpf, r.email, r.telefone, r.nascimento, r.cidade, r.uf]; return Math.round(100 * c.filter(Boolean).length / c.length); };
const normName = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(s a|sa|ltda|me|eireli|epp)\b/g, '').replace(/\s+/g, ' ').trim();
const isEmailOk = (s) => !s || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

// O que importa de fato p/ um cliente: estar no AdvBox e no Kommo.
// (Contrato e Asaas NAO sao pendencia: gerador e recente; conjuge unico no Asaas; casos so de exito.)
function pendencias(r) {
  if (r.relacao !== 'cliente') return [];
  const p = [];
  if (!r.em_advbox) p.push('Sem cadastro no AdvBox');
  if (!r.em_kommo) p.push('Sem vínculo no Kommo');
  return p;
}

export default function ClientesTab({ isAdmin = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('todos');
  const [extra, setExtra] = useState(null);
  const [sort, setSort] = useState({ col: null, dir: 'asc' });
  const [sel, setSel] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState('lista');
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fila, setFila] = useState([]);
  const [correcoes, setCorrecoes] = useState([]);
  const [limit, setLimit] = useState(200);
  const sentinelRef = useRef(null);
  const [devedorCpfs, setDevedorCpfs] = useState(() => new Set());

  const toast = useCallback((msg, err = false) => { const id = Math.random(); setToasts((t) => [...t, { id, msg, err }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800); }, []);

  const recarregar = useCallback(async () => {
    try { setLoading(true); const d = await buscarClientes(); setRows(d); setErro(null); }
    catch (e) { setErro(e.message || 'Falha ao carregar'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);

  const recarregarFila = useCallback(async () => {
    if (!isAdmin) return;
    try { const f = await buscarFilaRevisao(); setFila(f); } catch { /* silencioso (nao-admin/sem acesso) */ }
    try { const c = await buscarCorrecoesAdvbox(); setCorrecoes(c); } catch { /* silencioso */ }
  }, [isAdmin]);
  useEffect(() => { recarregarFila(); }, [recarregarFila]);
  useEffect(() => { buscarCpfsDevedores().then(setDevedorCpfs).catch(() => {}); }, []);

  const resolver = async (item, decisao, args) => {
    try { setBusy(true); await resolverFila(item.id, decisao, args); await recarregarFila(); if (decisao === 'fundir') await recarregar(); toast('Item resolvido'); }
    catch (e) { toast(e.message || 'Erro ao resolver', true); }
    finally { setBusy(false); }
  };

  const onSort = (col) => setSort((s) => (s.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : { col: null, dir: 'asc' }));
  const seta = (col) => (sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const toggleExtra = (k) => setExtra((e) => (e === k ? null : k));
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const editar = async (uid, patch) => {
    if (!isEmailOk(patch.email)) { toast('E-mail inválido', true); return false; }
    try { setBusy(true); await editarCliente(uid, patch); await recarregar(); toast('Alterações salvas'); return true; }
    catch (e) { toast(e.message || 'Erro ao salvar', true); return false; }
    finally { setBusy(false); }
  };
  const marcarRelacao = async (uids, relacao) => {
    try { setBusy(true); const r = await svcSetRelacao(uids, relacao); setSel(new Set()); await recarregar(); toast(`${r?.afetados ?? uids.length} marcado(s) como ${relacao === 'parte_contraria' ? 'parte contrária' : relacao}`); }
    catch (e) { toast(e.message || 'Erro', true); }
    finally { setBusy(false); }
  };
  const fundir = async (sobrevive, absorvidos) => {
    try { setBusy(true); await fundirClientes(sobrevive, absorvidos); setSel(new Set()); await recarregar(); toast(`${absorvidos.length} registro(s) fundido(s)`); }
    catch (e) { toast(e.message || 'Erro', true); }
    finally { setBusy(false); }
  };
  const vincularConjuge = async (a, b) => {
    try { setBusy(true); await svcVincularConjuge(a, b); await recarregar(); toast('Cônjuge vinculado'); return true; }
    catch (e) { toast(e.message || 'Erro ao vincular', true); return false; }
    finally { setBusy(false); }
  };
  const desvincularConjuge = async (uid) => {
    try { setBusy(true); await svcDesvincularConjuge(uid); await recarregar(); toast('Cônjuge desvinculado'); return true; }
    catch (e) { toast(e.message || 'Erro', true); return false; }
    finally { setBusy(false); }
  };
  const salvarKommo = async (uid, lead) => {
    try { setBusy(true); const r = await svcSetKommo(uid, lead); await recarregar(); toast(r?.kommo_lead_id ? 'Kommo vinculado' : 'Kommo desvinculado'); return true; }
    catch (e) { toast(e.message || 'Erro ao vincular Kommo', true); return false; }
    finally { setBusy(false); }
  };

  const passaExtra = (r) => {
    if (!extra) return true;
    if (extra === 'sem_cpf') return !r.cpf && r.relacao !== 'parte_contraria';
    if (extra === 'cpf_invalido') return cpfInvalido(r);
    if (extra === 'pendente') return pendencias(r).length > 0;
    if (extra === 'pc') return r.relacao === 'parte_contraria';
    if (extra === 'aniversario') return aniversarioMes(r) || aniversarioProxMes(r);
    if (extra === 'sem_kommo') return !r.em_kommo && r.relacao !== 'parte_contraria';
    if (extra === 'dev_sem_kommo') return !r.em_kommo && devedorCpfs.has(onlyDigits(r.cpf));
    return true;
  };
  const visible = useMemo(() => {
    const term = onlyDigits(q) || q.toLowerCase().trim();
    let arr = rows.filter((r) => {
      if (tipo === 'clientes' && r.relacao !== 'cliente') return false;
      if (tipo === 'pc' && r.relacao !== 'parte_contraria') return false;
      if (tipo === 'leads' && r.relacao !== 'lead') return false;
      if (!passaExtra(r)) return false;
      if (q && !`${r.nome} ${r.cpf_fmt || ''} ${onlyDigits(r.cpf)} ${r.telefone || ''} ${r.email || ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
    if (sort.col === 'idade') arr = [...arr].sort((a, b) => { const ia = idade(a.nascimento), ib = idade(b.nascimento); if (ia == null && ib == null) return 0; if (ia == null) return 1; if (ib == null) return -1; return sort.dir === 'asc' ? ia - ib : ib - ia; });
    else if (sort.col === 'cidade') arr = [...arr].sort((a, b) => { const ka = `${a.uf || 'ZZ'}|${(a.cidade || 'zzzz').toLowerCase()}`, kb = `${b.uf || 'ZZ'}|${(b.cidade || 'zzzz').toLowerCase()}`; const c = ka.localeCompare(kb, 'pt'); return sort.dir === 'asc' ? c : -c; });
    else if (sort.col === 'atualizado') arr = [...arr].sort((a, b) => { const da = a.atualizado_em ? Date.parse(a.atualizado_em) : 0, db = b.atualizado_em ? Date.parse(b.atualizado_em) : 0; return sort.dir === 'asc' ? da - db : db - da; });
    else if (extra === 'aniversario') arr = [...arr].sort((a, b) => bdayOrder(a.nascimento) - bdayOrder(b.nascimento));
    return arr;
  }, [rows, q, tipo, extra, sort, devedorCpfs]);

  const grupos = useMemo(() => { const by = {}; rows.forEach((r) => { const k = normName(r.nome); if (k) (by[k] = by[k] || []).push(r); }); return Object.values(by).filter((g) => g.length >= 2); }, [rows]);
  const open = rows.find((r) => r.id === openId);
  const { saude, completudeMedia, comCpfPct } = useMemo(() => {
    const cli = rows.filter((r) => r.relacao !== 'parte_contraria');
    const saude = [
      { key: 'sem_cpf', label: 'Sem CPF', n: cli.filter((r) => !r.cpf).length, tone: 'warn' },
      { key: 'cpf_invalido', label: 'CPF inválido', n: rows.filter(cpfInvalido).length, tone: 'bad' },
      { key: 'pendente', label: 'A vincular', n: rows.filter((r) => pendencias(r).length > 0).length, tone: 'warn' },
      { key: 'sem_kommo', label: 'Sem link Kommo', n: cli.filter((r) => !r.em_kommo).length, tone: 'warn' },
      { key: 'dev_sem_kommo', label: 'Devedor sem Kommo', n: rows.filter((r) => !r.em_kommo && devedorCpfs.has(onlyDigits(r.cpf))).length, tone: 'bad' },
      { key: 'pc', label: 'Parte contrária', n: rows.filter((r) => r.relacao === 'parte_contraria').length, tone: 'warn' },
      { key: 'aniversario', label: 'Aniversariantes', n: rows.filter(aniversarioMes).length, n2: rows.filter(aniversarioProxMes).length, tone: 'gold' },
    ];
    const completudeMedia = cli.length ? Math.round(cli.reduce((s, r) => s + completude(r), 0) / cli.length) : 0;
    const comCpfPct = cli.length ? Math.round(100 * cli.filter((r) => r.cpf).length / cli.length) : 0;
    return { saude, completudeMedia, comCpfPct };
  }, [rows, devedorCpfs]);
  const visiveis = visible.slice(0, limit);
  const allSelected = visiveis.length > 0 && visiveis.every((r) => sel.has(r.id));
  const toggleAll = () => setSel(() => (allSelected ? new Set() : new Set(visiveis.map((r) => r.id))));

  // scroll infinito: reseta ao mudar filtro/busca; carrega +200 ao chegar perto do fim
  useEffect(() => { setLimit(200); }, [q, tipo, extra, sort, tab]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) setLimit((l) => (l < visible.length ? l + 200 : l)); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible.length, tab]);

  return (
    <div className="cli-root">
      <div className="pagehead">
        <div><h1>Clientes</h1><div className="sub">Cadastro único · {rows.length} registros{loading ? ' (carregando…)' : ''}</div></div>
        <span className="sync"><i />Cadastro central</span>
      </div>

      {erro && <div className="card" style={{ padding: 14, color: 'var(--c-danger)' }}>Erro: {erro} <button className="btn" style={{ marginLeft: 8 }} onClick={recarregar}>tentar de novo</button></div>}

      <div className="saude">
        {saude.map((c) => (<button key={c.key} className={'scard ' + c.tone + (extra === c.key ? ' active' : '')} onClick={() => toggleExtra(c.key)} disabled={(c.n + (c.n2 || 0)) === 0 && extra !== c.key}><b>{c.n}</b><span>{c.label}</span>{c.n2 > 0 && <em style={{ fontSize: 10, fontStyle: 'normal', opacity: 0.85, marginTop: 1 }}>+{c.n2} mês que vem</em>}</button>))}
        <div className="scard metric"><b>{completudeMedia}%</b><span>Completude média</span></div>
        <div className="scard metric"><b>{comCpfPct}%</b><span>Com CPF</span></div>
      </div>

      <div className="subtabs" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button className={'chip' + (tab === 'lista' ? ' active' : '')} onClick={() => setTab('lista')}>Lista</button>
        <button className={'chip' + (tab === 'dup' ? ' active' : '')} onClick={() => setTab('dup')}>Duplicatas ({grupos.length})</button>
        {isAdmin && <button className={'chip' + (tab === 'revisao' ? ' active' : '') + (fila.length ? ' warn' : '')} onClick={() => setTab('revisao')}>Revisão ({fila.length})</button>}
        {isAdmin && <button className={'chip' + (tab === 'advbox' ? ' active' : '') + (correcoes.length ? ' warn' : '')} onClick={() => setTab('advbox')}>Corrigir no AdvBox ({correcoes.length})</button>}
      </div>

      {tab === 'lista' && <>
        <div className="toolbar">
          <div className="search"><span aria-hidden>🔎</span><input placeholder="buscar por nome, CPF, telefone ou e-mail…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {[['todos', 'Todos'], ['clientes', 'Clientes'], ['pc', 'Parte contrária'], ['leads', 'Leads']].map(([k, l]) => (<button key={k} className={'chip' + (tipo === k ? ' active' : '')} onClick={() => setTipo(k)}>{l}</button>))}
          {extra && <button className="chip warn active" onClick={() => setExtra(null)}>✕ {saude.find((s) => s.key === extra)?.label}</button>}
        </div>

        {sel.size > 0 && isAdmin && (
          <div className="bulkbar">
            <div><b>{sel.size}</b> selecionado(s)</div>
            <div className="actions">
              <button className="btn gold" disabled={busy} onClick={() => marcarRelacao([...sel], 'parte_contraria')}>Marcar parte contrária</button>
              <button className="btn" disabled={busy} onClick={() => marcarRelacao([...sel], 'cliente')}>Marcar cliente</button>
              <button className="btn ghost" style={{ color: '#fff' }} onClick={() => setSel(new Set())}>limpar</button>
            </div>
          </div>
        )}

        <div className="card">
          <table>
            <thead><tr>
              {isAdmin && <th style={{ width: 30 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="selecionar todos" /></th>}
              <th>Nome</th><th>CPF / CNPJ</th><th>Tipo</th><th>Telefone</th>
              <th className="sortable" onClick={() => onSort('idade')}>Idade{seta('idade')}</th>
              <th className="sortable" onClick={() => onSort('cidade')}>Cidade/UF{seta('cidade')}</th>
              <th>Presença</th>
              <th className="sortable" onClick={() => onSort('atualizado')}>Atualizado{seta('atualizado')}</th>
              <th>Ações</th>
            </tr></thead>
            <tbody>
              {visiveis.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)}>
                  {isAdmin && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} aria-label={'selecionar ' + r.nome} /></td>}
                  <td><span className="name">{r.nome || '(sem nome)'}</span>{r.eh_pj && <span className="badge pj">PJ</span>}</td>
                  <td className="tnum" style={cpfInvalido(r) ? { color: 'var(--c-danger)', fontWeight: 700 } : undefined}>{cpfFmt(r.cpf, r.cpf_fmt)}{cpfInvalido(r) && <span className="badge bad" title="dígito verificador inválido">CPF inválido</span>}</td>
                  <td>{r.relacao === 'cliente' && <span className="badge cliente">cliente</span>}{r.relacao === 'parte_contraria' && <span className="badge pc">parte contrária</span>}{r.relacao === 'lead' && <span className="badge lead">lead</span>}</td>
                  <td className="tnum">{telFmt(r.telefone)}</td>
                  <td className="tnum">{idade(r.nascimento) ? idade(r.nascimento) + ' anos' : '—'}{extra === 'aniversario' && aniversarioData(r.nascimento) ? <span style={{ marginLeft: 6, color: 'var(--c-gold-dark)', fontWeight: 700, whiteSpace: 'nowrap' }}>🎂 {aniversarioData(r.nascimento)}</span> : (aniversarioMes(r) && ' 🎂')}</td>
                  <td className="muted">{r.cidade ? `${r.cidade}/${r.uf || ''}` : '—'}</td>
                  <td>{r.em_advbox && <span className="sys">AdvBox</span>}{r.em_asaas && <span className="sys">Asaas</span>}{r.em_kommo && <span className="sys">Kommo</span>}{r.em_contrato && <span className="sys">Contrato</span>}</td>
                  <td className="tnum">{(() => { const dd = diasDesde(r.atualizado_em); if (dd == null) return '—'; const cor = dd <= 7 ? '#16A34A' : dd <= 30 ? '#D97706' : '#DC2626'; return <span title={dataBR(r.atualizado_em) || ''}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: cor, marginRight: 5, verticalAlign: 'middle' }} />{dd}d</span>; })()}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.kommo && <a style={rowBtn} href={`https://advocaciacbc.kommo.com/leads/detail/${r.kommo}`} target="_blank" rel="noreferrer" title="abrir no Kommo">Kommo</a>}
                    {devedorCpfs.get(onlyDigits(r.cpf)) && <button style={rowBtn} title="copiar link do boleto vencido" onClick={() => { navigator.clipboard?.writeText(devedorCpfs.get(onlyDigits(r.cpf))); toast('Link do boleto copiado'); }}>boleto</button>}
                  </td>
                </tr>
              ))}
              {!loading && visiveis.length === 0 && <tr><td colSpan={isAdmin ? 10 : 9} className="empty">Nenhum cliente para este filtro/busca.</td></tr>}
            </tbody>
          </table>
        </div>
        <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
        {visiveis.length < visible.length && <div className="footnote" style={{ justifyContent: 'center', color: 'var(--c-muted)' }}>carregando mais… ({visiveis.length} de {visible.length})</div>}
        <div className="footnote">
          <span>Mostrando <b>{visiveis.length}</b> de <b>{visible.length}</b></span>
          <span>Parte contrária: <b>{rows.filter((r) => r.relacao === 'parte_contraria').length}</b></span>
          <span>A vincular: <b>{rows.filter((r) => pendencias(r).length > 0).length}</b></span>
        </div>
      </>}

      {tab === 'dup' && <div>
        {grupos.length === 0 && <div className="card"><div className="empty">Nenhuma duplicata por nome em aberto. 🎉</div></div>}
        {grupos.slice(0, 50).map((g, i) => <GrupoDup key={i} grupo={g} isAdmin={isAdmin} busy={busy} onFundir={fundir} />)}
        {grupos.length > 50 && <div className="footnote"><span>Mostrando 50 de {grupos.length} grupos.</span></div>}
      </div>}

      {tab === 'revisao' && <FilaRevisao itens={fila} busy={busy} onResolver={resolver} onAbrirFicha={(uid) => { setOpenId(uid); setTab('lista'); }} />}

      {tab === 'advbox' && <CorrecoesAdvbox itens={correcoes} onAbrir={(uid) => { setOpenId(uid); setTab('lista'); }} toast={toast} />}

      {open && <Ficha key={open.id} row={open} isAdmin={isAdmin} busy={busy} clientes={rows} onAbrir={(uid) => setOpenId(uid)} onClose={() => setOpenId(null)} onSave={(patch) => editar(open.id, patch)} onRelacao={(rel) => marcarRelacao([open.id], rel)} onVincular={vincularConjuge} onDesvincular={desvincularConjuge} onSetKommo={(lead) => salvarKommo(open.id, lead)} />}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>)}</div>
    </div>
  );
}

function CorrecoesAdvbox({ itens, onAbrir, toast }) {
  if (!itens.length) return <div className="card"><div className="empty">Nada para corrigir no AdvBox. 🎉</div></div>;
  const copiar = (txt) => { try { navigator.clipboard?.writeText(txt || ''); if (toast) toast('Copiado'); } catch { /* ignore */ } };
  const labelCampo = { nome: 'Nome', email: 'E-mail', telefone: 'Telefone', cidade: 'Cidade', uf: 'UF', nascimento: 'Nascimento' };
  const porCliente = {};
  itens.forEach((it) => { (porCliente[it.cliente_uid] = porCliente[it.cliente_uid] || { nome: it.cliente_nome, advbox: it.advbox_customer_id, uid: it.cliente_uid, campos: [] }).campos.push(it); });
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Correções feitas aqui que ainda divergem do AdvBox. Corrija no AdvBox (cliente {'→'} editar). Quando o AdvBox sincronizar, o item some sozinho.</div>
      {Object.values(porCliente).map((g) => (
        <div className="group" key={g.uid}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--c-navy-dark)' }}>{g.nome} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· AdvBox ID {g.advbox || '—'}</span></h3>
          {g.campos.map((it, i) => (
            <div key={i} style={{ fontSize: 13, padding: '3px 0' }}>
              <b>{labelCampo[it.campo] || it.campo}:</b> <span className="muted" style={{ textDecoration: 'line-through' }}>{it.valor_advbox || '(vazio)'}</span> {'→'} <b style={{ color: 'var(--c-gold-dark)' }}>{it.valor_correto}</b>
              <button style={{ ...rowBtn, marginLeft: 6 }} onClick={() => copiar(it.valor_correto)} title="copiar valor correto">copiar</button>
            </div>
          ))}
          <div style={{ marginTop: 8 }}><button className="btn" onClick={() => onAbrir(g.uid)}>Abrir ficha</button></div>
        </div>
      ))}
    </div>
  );
}

function FilaRevisao({ itens, busy, onResolver, onAbrirFicha }) {
  if (!itens.length) return <div className="card"><div className="empty">Nada para revisar agora. 🎉</div></div>;
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Inconsistências marcadas pela reconciliação. Corrija na ficha (sua edição vence a sincronização) ou marque como resolvido.</div>
      {itens.map((it) => {
        const p = it.payload || {};
        const isNome = it.tipo === 'cpf_nomes_divergentes';
        const isCpf = it.tipo === 'duplicata_cpf_conflito';
        const isColide = it.tipo === 'cpf_colide_outra_linha';
        return (
          <div className="group" key={it.id}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--c-navy-dark)' }}>
              {isNome ? 'Nomes diferentes no mesmo CPF' : isCpf ? 'Mesmo nome e telefone, CPFs diferentes' : isColide ? 'CPF colide com outro registro' : it.tipo}
            </h3>
            {isNome && <div className="muted" style={{ fontSize: 13 }}>AdvBox: <b>{p.nome_advbox}</b> &nbsp;·&nbsp; Asaas: <b>{p.nome_asaas}</b> &nbsp;·&nbsp; CPF {p.cpf}</div>}
            {isCpf && <div className="muted" style={{ fontSize: 13 }}><b>{p.nome}</b> &nbsp;·&nbsp; CPFs: {(p.cpfs || []).join(' / ')}</div>}
            {isColide && <div className="muted" style={{ fontSize: 13 }}>CPF <b>{p.cpf}</b> já pertence a outro registro.</div>}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {it.cliente_uid && <button className="btn" disabled={busy} onClick={() => onAbrirFicha(it.cliente_uid)}>Abrir ficha p/ corrigir</button>}
              <button className="btn ghost" disabled={busy} onClick={() => onResolver(it, 'diferentes')}>Marcar resolvido</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GrupoDup({ grupo, isAdmin, busy, onFundir }) {
  const [keep, setKeep] = useState(grupo[0].id);
  return (
    <div className="group">
      <h3 style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--c-navy-dark)' }}>Possível duplicata — {grupo.length} registros</h3>
      <div className="muted" style={{ fontSize: 12 }}>Mesma entidade com grafias diferentes. Escolha o registro que fica e funda os demais nele.</div>
      {grupo.map((r) => (
        <label key={r.id} className={'cand' + (keep === r.id ? ' keep' : '')}>
          <input type="radio" name={'k' + normName(grupo[0].nome)} checked={keep === r.id} onChange={() => setKeep(r.id)} />
          <div style={{ flex: 1 }}><div className="name">{r.nome}</div><div className="muted" style={{ fontSize: 12 }}>{cpfFmt(r.cpf, r.cpf_fmt)} · AdvBox {r.advbox || '—'}</div></div>
          {keep === r.id && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-gold-dark)' }}>fica</span>}
        </label>
      ))}
      <div style={{ marginTop: 10 }}>
        <button className="btn gold" disabled={!isAdmin || busy} onClick={() => onFundir(keep, grupo.filter((r) => r.id !== keep).map((r) => r.id))}>Fundir {grupo.length - 1} no selecionado</button>
        {!isAdmin && <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>(fusão é ação de admin)</span>}
      </div>
    </div>
  );
}

function Ficha({ row, isAdmin, busy, clientes = [], onAbrir, onClose, onSave, onRelacao, onVincular, onDesvincular, onSetKommo }) {
  const [buf, setBuf] = useState({ nome: row.nome || '', email: row.email || '', telefone: row.telefone || '', nascimento: row.nascimento || '', cidade: row.cidade || '', uf: row.uf || '' });
  const set = (k) => (e) => setBuf((b) => ({ ...b, [k]: e.target.value }));
  const [info, setInfo] = useState(null);
  const [manualFields, setManualFields] = useState(() => new Set());
  const [prestacao, setPrestacao] = useState([]);
  const carregar360 = useCallback(() => { buscar360(row.id).then(setInfo).catch(() => {}); }, [row.id]);
  useEffect(() => {
    let live = true;
    buscar360(row.id).then((d) => { if (live) setInfo(d); }).catch(() => {});
    buscarProveniencia(row.id).then((s) => { if (live) setManualFields(s); }).catch(() => {});
    buscarPrestacao(row.id).then((p) => { if (live) setPrestacao(p); }).catch(() => {});
    return () => { live = false; };
  }, [row.id]);
  const [picker, setPicker] = useState(''); const [pickerOpen, setPickerOpen] = useState(false);
  const [kommoBuf, setKommoBuf] = useState(row.kommo || '');
  const copiar = (txt) => { try { navigator.clipboard?.writeText(txt); } catch { /* ignore */ } };
  const vincular = async (b) => { if ((await onVincular(row.id, b)) !== false) { setPickerOpen(false); setPicker(''); carregar360(); } };
  const desvincular = async () => { if ((await onDesvincular(row.id)) !== false) carregar360(); };
  const matches = picker.trim().length >= 2 ? clientes.filter((x) => x.id !== row.id && x.relacao !== 'parte_contraria' && (x.nome || '').toLowerCase().includes(picker.toLowerCase())).slice(0, 8) : [];
  const ag = idade(row.nascimento); const comp = completude(row); const pend = pendencias(row); const bad = cpfInvalido(row);
  const alertas = info ? [
    info.r_contrato_parado && 'Contrato enviado há +30 dias sem assinar',
    info.r_boleto_velho && 'Boleto vencido há +60 dias',
    info.r_sem_interacao && 'Sem interação há +3 meses',
    (info.conjuge_n_vencidos > 0) && 'Cônjuge com cobrança vencida',
  ].filter(Boolean) : [];
  const risco = alertas.length === 0 ? 'ok' : (info && info.r_boleto_velho) ? 'alto' : 'medio';
  const fld = (campo, label, type) => (<div className="field" key={campo}><label>{label} <span className="seal">{manualFields.has(campo) ? '🔒 manual' : 'AdvBox'}</span></label><input type={type || 'text'} value={buf[campo]} onChange={set(campo)} /></div>);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={'Ficha de ' + row.nome}>
        <header>
          <button className="x" onClick={onClose} aria-label="fechar">×</button>
          <div className="dh-name">{row.nome || '(sem nome)'}</div>
          <div className="dh-sub">{cpfFmt(row.cpf, row.cpf_fmt)} · {row.relacao === 'parte_contraria' ? 'parte contrária' : row.relacao}{row.eh_pj ? ' · PJ' : ''}{ag ? ` · ${ag} anos` : ''}</div>
          <div className="comp-bar"><i style={{ width: comp + '%' }} />{comp}% completo</div>
          {info && (risco === 'ok'
            ? <div style={{ marginTop: 6, fontSize: 12, color: '#16A34A', fontWeight: 700 }}>🟢 Sem alertas</div>
            : <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: risco === 'alto' ? 'var(--c-danger)' : '#D97706' }}>{risco === 'alto' ? '🔴' : '🟡'} {alertas.length} alerta(s)</div>)}
        </header>
        <div className="body">
          {bad && <div className="pend-box bad"><div className="pend-t">⚠ CPF inválido (dígito verificador não confere)</div></div>}
          {pend.length > 0 && <div className="pend-box"><div className="pend-t">⚠ Faltando vincular ({pend.length})</div><ul className="pend">{pend.map((p) => <li key={p}>{p}</li>)}</ul></div>}

          <div className="section-t">Dados (editáveis · sua edição vence a sincronização)</div>
          {fld('nome', 'Nome')}{fld('email', 'E-mail')}{fld('telefone', 'Telefone')}{fld('nascimento', 'Nascimento', 'date')}
          <div style={{ display: 'flex', gap: 10 }}><div style={{ flex: 2 }}>{fld('cidade', 'Cidade')}</div><div style={{ flex: 1 }}>{fld('uf', 'UF')}</div></div>

          <div className="section-t">Presença nos sistemas</div>
          <div className="presence">
            <div className={'pcard' + (row.em_advbox ? '' : ' off')}><div className="pl">AdvBox</div><div className="pv">{row.advbox || (row.em_advbox ? 'sim' : '—')}</div></div>
            <div className={'pcard' + (row.em_asaas ? '' : ' off')}><div className="pl">Asaas</div><div className="pv">{row.asaas || (row.em_asaas ? 'sim' : '—')}</div></div>
            <div className={'pcard' + (row.em_kommo ? '' : ' off')}><div className="pl">Kommo</div><div className="pv">{row.kommo || (row.em_kommo ? 'sim' : '—')}</div></div>
            <div className={'pcard' + (row.em_contrato ? '' : ' off')}><div className="pl">Contrato</div><div className="pv">{row.em_contrato ? 'sim' : '—'}</div></div>
          </div>

          {info && (
            <>
              {alertas.length > 0 && (
                <div className={'pend-box' + (risco === 'alto' ? ' bad' : '')}>
                  <div className="pend-t">⚠ Alertas ({alertas.length})</div>
                  <ul className="pend">{alertas.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}

              <div className="section-t">Resumo 360</div>
              <div className="presence">
                <div className="pcard"><div className="pl">Profissão</div><div className="pv">{info.profissao || '—'}</div></div>
                <div className="pcard"><div className="pl">Estado civil</div><div className="pv">{info.estado_civil || '—'}</div></div>
                <div className="pcard"><div className="pl">Gênero</div><div className="pv">{info.genero || '—'}</div></div>
                <div className="pcard"><div className="pl">Processos</div><div className="pv">{info.qtd_processos ?? 0}</div></div>
                <div className={'pcard' + (info.tem_portal ? '' : ' off')}><div className="pl">Portal</div><div className="pv">{info.tem_portal ? 'ativo' : '—'}</div></div>
              </div>

              {(info.cep || info.logradouro || info.bairro || info.rg || info.nacionalidade) && (
                <>
                  <div className="section-t">Cadastro</div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
                    {(info.logradouro || info.numero || info.bairro) && (
                      <div>📍 {[info.logradouro, info.numero, info.bairro].filter(Boolean).join(', ')}{(info.cidade || info.uf) ? ` — ${[info.cidade, info.uf].filter(Boolean).join('/')}` : ''}{info.cep ? ` · CEP ${info.cep}` : ''}</div>
                    )}
                    {info.complemento && <div>compl. {info.complemento}</div>}
                    {(info.rg || info.nacionalidade) && <div>🪪 {[info.rg && `RG ${info.rg}`, info.nacionalidade].filter(Boolean).join(' · ')}</div>}
                  </div>
                </>
              )}

              <div className="section-t">Financeiro</div>
              <div className="presence">
                <div className="pcard"><div className="pl">Recebido</div><div className="pv">{reais(info.fin_recebido)}</div></div>
                <div className={'pcard' + (info.n_vencidos > 0 ? '' : ' off')}><div className="pl">Vencido</div><div className="pv">{reais(info.valor_vencido)}{info.n_vencidos ? ` (${info.n_vencidos})` : ''}</div></div>
                <div className="pcard"><div className="pl">Próx. venc.</div><div className="pv">{dataBR(info.proximo_venc) || '—'}</div></div>
                <div className="pcard"><div className="pl">Boletos pagos</div><div className="pv">{info.n_pagos ?? 0} de {info.n_boletos ?? 0}</div></div>
              </div>
              {Number(info.valor_total) > 0 && (() => { const pct = Math.min(100, Math.round(100 * Number(info.fin_recebido) / Number(info.valor_total))); return (
                <div style={{ margin: '6px 0' }}>
                  <div style={{ height: 8, background: '#e4eaf0', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', background: 'var(--c-gold, #C9A84C)' }} /></div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{reais(info.fin_recebido)} de {reais(info.valor_total)} em boletos ({pct}%)</div>
                </div>
              ); })()}
              {info.n_vencidos > 0 && info.boleto_vencido_url && <button className="btn" style={{ marginTop: 4 }} onClick={() => copiar(info.boleto_vencido_url)}>Copiar boleto vencido mais antigo</button>}

              {Array.isArray(info.contratos_json) && info.contratos_json.length > 0 && (
                <>
                  <div className="section-t">Contratos ({info.contratos_json.length})</div>
                  {info.contratos_json.slice(0, 6).map((ct, i) => (
                    <div key={i} className="muted" style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid #eef2f6' }}>
                      <b style={{ color: 'var(--c-navy)' }}>{ct.resort || ct.tipo || 'Contrato'}</b> · {ct.status || '—'}{ct.honorario ? ` · ${reais(ct.honorario)}` : ''}{ct.assinado_em ? ` · assinado ${dataBR(ct.assinado_em)}` : ''}
                    </div>
                  ))}
                </>
              )}

              <div className="section-t">Última interação</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {[
                  info.ult_assinatura && `assinatura ${dataBR(info.ult_assinatura)}`,
                  info.ult_pagamento && `pagamento ${dataBR(info.ult_pagamento)}`,
                  info.ult_contrato && `contrato ${dataBR(info.ult_contrato)}`,
                ].filter(Boolean).join(' · ') || 'sem registro'}
              </div>
            </>
          )}

          {prestacao.length > 0 && (
            <>
              <div className="section-t">Prestação de Contas / Petições ({prestacao.length})</div>
              {prestacao.slice(0, 8).map((p, i) => {
                const lbl = p.sistema === 'calculos' ? 'Cálculo' : p.sistema === 'acordos' ? 'Acordo' : p.sistema === 'peticoes' ? 'Petição' : p.sistema;
                const d = p.payload || {};
                const extra = (p.sistema === 'acordos' && d.valor_total) ? ` · ${reais(d.valor_total)}` : (d.status ? ` · ${d.status}` : '');
                return (
                  <div key={i} className="muted" style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid #eef2f6' }}>
                    <b style={{ color: 'var(--c-navy)' }}>{lbl}</b>{p.num_processo ? ` · proc ${p.num_processo}` : ''}{extra}
                  </div>
                );
              })}
            </>
          )}

          <div className="section-t">Vínculo Kommo</div>
          <div className="field">
            <label>Link ou número do lead no Kommo</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ flex: 1 }} placeholder="cole o link do Kommo ou só o número do lead" value={kommoBuf} onChange={(e) => setKommoBuf(e.target.value)} />
              <button className="btn gold" disabled={busy} onClick={async () => { if ((await onSetKommo(kommoBuf)) !== false) carregar360(); }}>Salvar</button>
            </div>
            {row.kommo
              ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Vinculado: lead {row.kommo} · <a href={`https://advocaciacbc.kommo.com/leads/detail/${row.kommo}`} target="_blank" rel="noreferrer" style={{ color: 'var(--c-navy)' }}>abrir no Kommo</a> · apague o campo e salve p/ desvincular</div>
              : <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Sem vínculo. Cole o link do lead (ou só o número) e salve.</div>}
          </div>

          <div className="section-t">Cônjuge / vínculo familiar</div>
          {info && info.conjuge_uid ? (
            <div className="pend-box">
              <div className="pend-t">💑 {info.conjuge_nome || 'Cônjuge vinculado'}</div>
              {info.conjuge_n_boletos > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Cobranças no cônjuge: {info.conjuge_n_boletos}{info.conjuge_n_vencidos > 0 ? ` · ${info.conjuge_n_vencidos} vencida(s) · R$ ${Number(info.conjuge_valor_vencido || 0).toLocaleString('pt-BR')}` : ''}</div>}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => onAbrir(info.conjuge_uid)}>Abrir ficha do cônjuge</button>
                {info.conjuge_n_vencidos > 0 && info.conjuge_boleto_url && <button className="btn ghost" onClick={() => copiar(info.conjuge_boleto_url)}>Copiar boleto do cônjuge</button>}
                {isAdmin && <button className="btn ghost" disabled={busy} onClick={desvincular}>Desvincular</button>}
              </div>
            </div>
          ) : (
            <div>
              {!pickerOpen ? (
                <button className="btn" disabled={!isAdmin || busy} onClick={() => setPickerOpen(true)}>+ Vincular cônjuge</button>
              ) : (
                <div className="card" style={{ padding: 10 }}>
                  <input placeholder="buscar cliente por nome…" value={picker} onChange={(e) => setPicker(e.target.value)} autoFocus style={{ width: '100%', padding: '8px 10px', marginBottom: 6, boxSizing: 'border-box' }} />
                  <div style={{ maxHeight: 200, overflow: 'auto' }}>
                    {matches.map((x) => (
                      <button key={x.id} className="cand" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} disabled={busy} onClick={() => vincular(x.id)}>
                        <div style={{ flex: 1 }}><div className="name">{x.nome}</div><div className="muted" style={{ fontSize: 12 }}>{cpfFmt(x.cpf, x.cpf_fmt)}</div></div>
                      </button>
                    ))}
                    {picker.trim().length >= 2 && matches.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 6 }}>nenhum cliente encontrado</div>}
                    {picker.trim().length < 2 && <div className="muted" style={{ fontSize: 12, padding: 6 }}>digite ao menos 2 letras</div>}
                  </div>
                  <button className="btn ghost" style={{ marginTop: 6, color: 'var(--c-navy)' }} onClick={() => { setPickerOpen(false); setPicker(''); }}>cancelar</button>
                </div>
              )}
            </div>
          )}

          <div className="section-t">Ações {isAdmin ? '' : '(somente admin)'}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {row.relacao !== 'parte_contraria'
              ? <button className="btn gold" disabled={!isAdmin || busy} onClick={() => { onRelacao('parte_contraria'); onClose(); }}>Marcar parte contrária</button>
              : <button className="btn" disabled={!isAdmin || busy} onClick={() => { onRelacao('cliente'); onClose(); }}>Voltar a ser cliente</button>}
          </div>
        </div>
        <footer>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn gold" disabled={busy} onClick={async () => { if ((await onSave(buf)) !== false) onClose(); }}>Salvar</button>
        </footer>
      </aside>
    </>
  );
}
