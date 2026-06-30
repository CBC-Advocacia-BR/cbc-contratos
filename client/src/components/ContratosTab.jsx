import { useState, useEffect, useCallback, useRef, memo } from 'react';
// (perf-fe-1) avaliado: nao virtualizado — as linhas EXPANDEM no lugar (altura
// variavel: detalhe, links de assinatura, comentarios), e FixedSizeList cortaria o
// detalhe aberto. Mesma decisao ja tomada no BoletosPanel. Import mantido (#168) por
// nao fazer parte do escopo desta task; nenhuma <List> e usada nesta aba.
import { FixedSizeList as List } from 'react-window'; // (#168) — nao usado (ver perf-fe-1 acima)
import { supabase } from '../lib/supabase';
import { checkZapSignStatus, saveSignedDocToDrive, getSignedFileUrl } from '../utils/zapsignService';
import { SkeletonContratosTab } from './Skeleton';
import ErrorState from './ErrorState';
import DriveFolderModal from './DriveFolderModal';
import ImportContratoModal from './ImportContratoModal';
import { usePersistedFilter } from '../hooks/usePersistedFilters';
import { useDebounce } from '../hooks/useDebounce'; // (#119)
// (resilience 28/04) Cache IndexedDB dos ultimos 100 contratos — fallback offline
import { cacheContracts, getCachedContracts } from '../utils/contractsCache';
import { maskCPF } from '../utils/masks';
import StatusPill from './ui/StatusPill';
import AutomationPipeline from './ui/AutomationPipeline';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CheckCircleIcon,
  FolderIcon,
  FolderPlusIcon,
  UserIcon,
  ScaleIcon,
  FunnelIcon,
  EyeIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  CheckIcon,
  XMarkIcon,
  InformationCircleIcon,
  ArchiveBoxIcon,
  ArchiveBoxXMarkIcon,
  TrashIcon,
  DocumentArrowUpIcon,
  ListBulletIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
// (#85, #92, #99) Lote 2 — views alternativas + filtros salvos + comentarios
import KanbanView from './contratos/KanbanView';
import CardsView from './contratos/CardsView';
import ViewsManager from './contratos/ViewsManager';
import ContractComments from './contratos/ContractComments';
// (#97, #327) Lote 3 — presenca em tempo real
import PresenceIndicator from './contratos/PresenceIndicator';
// (#215) Lote 4 — lembretes parametrizaveis
import ReminderModal from './ReminderModal';
import { BellAlertIcon } from '@heroicons/react/24/outline';

function AdvboxSyncButton({ dados, dataAssinatura, contractId, existingLawsuitId, existingCustomers }) {
  const [status, setStatus] = useState(''); // '' | 'loading' | 'success' | 'error'
  const [msg, setMsg] = useState('');

  const handleSync = async (e) => {
    if (e) e.stopPropagation();
    setStatus('loading');
    setMsg('');
    // (integ-data-2) trava atomica igual a do robo automatico (App.jsx): so processa
    // se conseguir marcar 'processing'. Evita criar cliente + PROCESSO duplicados no
    // ADVBOX quando o clique manual coincide com o ciclo automatico (advbox-sync sempre
    // cria um lawsuit novo). Se outro fluxo ja pegou, avisa em vez de duplicar.
    if (contractId) {
      const { data: claimed } = await supabase.from('contratos')
        .update({ advbox_status: 'processing', advbox_date: new Date().toISOString() })
        .eq('id', contractId)
        .or('advbox_status.is.null,advbox_status.eq.error,advbox_status.eq.')
        .select('id');
      if (!claimed || claimed.length === 0) {
        setStatus('error');
        setMsg('Ja esta sendo processado — aguarde');
        setTimeout(() => { setStatus(''); setMsg(''); }, 6000);
        return;
      }
    }
    try {
      const resp = await fetch('/.netlify/functions/advbox-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...dados,
          dataAssinatura: dataAssinatura || new Date().toISOString().split('T')[0],
          // (#7) idempotencia: reusa processo/clientes ja criados em vez de duplicar.
          existingLawsuitId: existingLawsuitId || null,
          existingCustomers: existingCustomers || null,
        }),
      });
      const result = await resp.json();
      // (integ-data-2) persiste o resultado igual ao robo (QW#2: so 'ok' se houve lawsuit)
      // para o ciclo automatico nao reprocessar o mesmo contrato.
      // (#6) exige customersComplete: todos os contratantes viraram cliente, nao so >0.
      const advOk = result.success && result.customersComplete && !!result.lawsuit?.id;
      if (contractId) {
        await supabase.from('contratos').update({
          advbox_status: advOk ? 'ok' : 'error',
          advbox_date: new Date().toISOString(), advbox_data: result,
          advbox_lawsuit_id: result?.lawsuit?.id || null,
        }).eq('id', contractId);
      }
      if (result.success && result.customers?.length > 0) {
        setStatus('success');
        setMsg(`${result.customers.length} cliente(s)${result.lawsuit ? ' + processo' : ''} criado(s)`);
      } else {
        setStatus('error');
        setMsg(result.warnings?.join('; ') || result.error || 'Erro desconhecido');
      }
    } catch (err) {
      // libera a trava (volta p/ error) p/ o robo poder re-tentar
      if (contractId) { try { await supabase.from('contratos').update({ advbox_status: 'error' }).eq('id', contractId); } catch { /* best-effort */ } }
      setStatus('error');
      setMsg(err.message);
    }
    setTimeout(() => { setStatus(''); setMsg(''); }, 8000);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={handleSync} disabled={status === 'loading'}
        className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-all flex items-center gap-1"
        style={
          status === 'success' ? { background: '#D1FAE5', color: '#065F46' } :
          status === 'error' ? { background: '#FEE2E2', color: '#991B1B' } :
          { background: '#EEF4FF', color: '#1B3A5C', border: '1px solid #C0D0E8' }
        }>
        {status === 'loading' ? (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
        ) : status === 'success' ? <CheckIcon className="w-3 h-3" aria-hidden="true" /> : status === 'error' ? <XMarkIcon className="w-3 h-3" aria-hidden="true" /> : (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        )}
        {status === 'loading' ? 'Sincronizando...' : status === 'success' ? 'Sincronizado!' : status === 'error' ? 'Erro' : 'Enviar ADVBOX'}
      </button>
      {msg && <span className="text-[9px] text-gray-500 max-w-[200px] truncate">{msg}</span>}
    </div>
  );
}

function DownloadSignedButton({ contract }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  if (!contract.zapsign_doc_token || contract.status !== 'assinado') return null;

  const handleDownload = async (e) => {
    e.stopPropagation();
    setLoading(true); setMsg('');
    try {
      const signedFileUrl = await getSignedFileUrl(contract.zapsign_doc_token);
      if (!signedFileUrl) throw new Error('PDF não encontrado');

      const pageSplit = contract.pdf_page_split;
      const resp = await fetch('/.netlify/functions/save-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedFileUrl, pageSplit }),
      });
      const result = await resp.json();
      if (!result.success) throw new Error(result.error);

      // Download each file
      // TODO(mobile): loop de a.click() em sequencia — Safari/iOS costuma bloquear
      // multiplos downloads programaticos no mesmo gesto (so o 1o arquivo baixa).
      // Considerar no futuro: zipar os arquivos ou baixar 1 por vez com confirmacao.
      for (const file of result.files) {
        const byteChars = atob(file.base64);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArr], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = file.name; a.click();
        URL.revokeObjectURL(url);
      }
      setMsg(`${result.files.length} arquivo(s)`);
    } catch (err) { setMsg(err.message); }
    finally { setLoading(false); setTimeout(() => setMsg(''), 4000); }
  };

  return (
    <button onClick={handleDownload} disabled={loading}
      className="px-2.5 py-1 text-[9px] font-bold uppercase rounded-lg cursor-pointer transition-all flex items-center gap-1 shrink-0"
      style={{ background: '#EEF4FF', color: '#1B3A5C', border: '1px solid #C0D0E8' }}>
      {loading ? (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
      )}
      {loading ? '...' : msg || 'Baixar'}
    </button>
  );
}

// SaveToDriveButton — agora com protecao contra re-upload duplicado
// Props:
//   contract: dados do contrato (com drive_file_id)
//   onRequestDestructiveConfirm?: (payload) => void — para confirmacao de duplicacao (digitar SUBIR DUPLICADO)
//   onShowToast?: (msg, level) => void — toast feedback (level: success|error|info|warning)
function SaveToDriveButton({ contract, onRequestDestructiveConfirm, onShowToast }) {
  const [status, setStatus] = useState(''); // '' | 'loading' | 'success' | 'error'
  const [, setMsg] = useState('');

  const driveLink = contract.dados?.linkGoogleDrive;
  if (!driveLink || !contract.zapsign_doc_token) return null;

  // Estado atual do drive_file_id:
  //   null/undefined → nunca tentado ou liberado (permite direto)
  //   'uploading'    → lock ativo (bloqueia com aviso "aguarde")
  //   'failed'       → desistiu (permite retry com aviso)
  //   outro valor    → sucesso (bloqueia com ConfirmDestructive pra evitar duplicata)
  const driveFileId = contract.drive_file_id;
  const isUploading = driveFileId === 'uploading';
  const hasFailed = driveFileId === 'failed';
  const hasRealFile = driveFileId && !['uploading', 'failed'].includes(driveFileId);

  const doUpload = async () => {
    setStatus('loading');
    setMsg('');
    try {
      const clientName = contract.dados?.contratantes?.[0]?.nome || 'cliente';
      const clientName2 = contract.dados?.contratantes?.[1]?.nome || null;
      const resort = contract.dados?.resort === 'outro' ? contract.dados?.resortCustom : contract.dados?.resort;
      const result = await saveSignedDocToDrive(contract.zapsign_doc_token, driveLink, clientName, clientName2, resort, contract.pdf_page_split, contract.dados);
      setStatus('success');
      setMsg(result.files?.[0]?.name || 'Salvo!');
      // Save drive info to DB
      // (#9) saveSignedDocToDrive devolve { success, files:[{fileId,fileUrl,...}] } — ler de
      // files[0] (igual ao robo em App.jsx). Antes lia result.fileId/webViewLink (sempre
      // undefined), gravava drive_file_id null e o polling re-subia o arquivo (duplicata).
      await supabase.from('contratos').update({
        drive_file_id: result.files?.[0]?.fileId || 'saved',
        drive_file_link: result.files?.[0]?.fileUrl || '',
      }).eq('id', contract.id);
      onShowToast?.('Upload concluido no Drive.', 'success');
    } catch (err) {
      setStatus('error');
      setMsg(err.message || 'Erro');
      onShowToast?.(`Erro ao salvar no Drive: ${err.message || 'falha'}`, 'error');
    }
    setTimeout(() => { setStatus(''); setMsg(''); }, 8000);
  };

  const handleSave = async (e) => {
    if (e) e.stopPropagation();

    // Bloqueio 1: upload em andamento
    if (isUploading) {
      const startedAt = contract.drive_last_attempt_at || contract.updated_at;
      const diffMin = startedAt ? Math.ceil((Date.now() - new Date(startedAt).getTime()) / 60000) : null;
      onShowToast?.(
        `Upload em andamento${diffMin != null ? ` ha ${diffMin} min` : ''}. Aguarde antes de tentar novamente.`,
        'warning'
      );
      return;
    }

    // Bloqueio 2: arquivo real ja existe → exige confirmacao (evitar duplicata)
    if (hasRealFile) {
      if (onRequestDestructiveConfirm) {
        onRequestDestructiveConfirm({
          title: 'Subir arquivos duplicados no Drive?',
          message: `Este contrato ja possui arquivos no Google Drive.\n\nSubir novamente vai criar ARQUIVOS DUPLICADOS na pasta.\n\nDigite SUBIR DUPLICADO para confirmar.`,
          confirmText: 'SUBIR DUPLICADO',
          onConfirm: async () => {
            onRequestDestructiveConfirm(null);
            await doUpload();
          },
        });
        return;
      }
      // Fallback sem modal
      if (!confirm('Este contrato ja possui arquivos no Drive. Subir novamente vai duplicar. Confirmar?')) return;
      await doUpload();
      return;
    }

    // Caso 3: falha anterior — retry esperado, apenas avisa
    if (hasFailed) {
      onShowToast?.('Tentando novamente apos falha anterior...', 'info');
    }

    // Caso 4: null — primeira tentativa (ou apos reset), direto
    await doUpload();
  };

  // Already saved?
  if (contract.drive_file_link && hasRealFile) {
    return (
      <div className="flex items-center gap-1.5">
        <a href={contract.drive_file_link} target="_blank" rel="noopener noreferrer"
          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer flex items-center gap-1"
          style={{ background: '#E8F5E9', color: '#2E7D32', border: '1px solid #C8E6C9' }}
          onClick={e => e.stopPropagation()}>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M7.71 3.5L1.15 15l4.58 7.5h13.54l4.58-7.5L17.29 3.5H7.71zm.58 1h8.42l5.48 9.5H2.81l5.48-9.5z"/></svg>
          Ver no Drive
        </a>
        {/* Botao secundario "Subir novamente" — sempre passa pela protecao ConfirmDestructive */}
        <button
          onClick={handleSave}
          disabled={status === 'loading'}
          title="Subir de novo (cria duplicata — exige confirmacao)"
          className="px-2 py-1.5 text-[9px] font-bold uppercase rounded-lg cursor-pointer transition-all border border-gray-200 text-gray-500 hover:bg-gray-50"
        >
          {status === 'loading' ? '...' : 'Subir de novo'}
        </button>
      </div>
    );
  }

  return (
    <button onClick={handleSave} disabled={status === 'loading' || isUploading}
      title={isUploading ? 'Upload em andamento, aguarde' : hasFailed ? 'Tentar novamente (apos falha)' : 'Salvar no Drive'}
      className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-all flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
      style={
        status === 'success' ? { background: '#D1FAE5', color: '#065F46' } :
        status === 'error' ? { background: '#FEE2E2', color: '#991B1B' } :
        isUploading ? { background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' } :
        hasFailed ? { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' } :
        { background: '#E8F0FE', color: '#1A73E8', border: '1px solid #C0D0E8' }
      }>
      {status === 'loading' || isUploading ? (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
      ) : (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M7.71 3.5L1.15 15l4.58 7.5h13.54l4.58-7.5L17.29 3.5H7.71zm.58 1h8.42l5.48 9.5H2.81l5.48-9.5z"/></svg>
      )}
      {status === 'loading' ? 'Salvando...' :
       status === 'success' ? 'Salvo!' :
       status === 'error' ? 'Erro' :
       isUploading ? 'Enviando...' :
       hasFailed ? 'Tentar de novo' :
       'Salvar no Drive'}
    </button>
  );
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy}
      className="shrink-0 px-2 py-1 text-[9px] font-bold uppercase rounded cursor-pointer transition-all flex items-center gap-1"
      style={copied ? { background: '#D1FAE5', color: '#065F46' } : { background: '#EEF4FF', color: '#1B3A5C', border: '1px solid #C0D0E8' }}>
      {copied ? (<><CheckIcon className="w-2.5 h-2.5" aria-hidden="true" /> Copiado</>) : (label || 'Copiar')}
    </button>
  );
}

// (#extract-base 20/06) StatusBadge delega ao StatusPill (fonte unica
// STATUS_TOKENS.contrato, dark-aware, icone+label >=12px). Mantem a API
// <StatusBadge status=.../> usada pela lista.
const StatusBadge = memo(function StatusBadge({ status }) {
  return <StatusPill domain="contrato" status={status} size="sm" />;
});

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

function formatCurrency(val) {
  if (!val) return '—';
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ─── Progress Steps (Heroicons) ───
// (chatguru removal 2026-05) step 'chatguru' removido — 6 etapas em vez de 7
const PROGRESS_STEPS = [
  { key: 'salvo', label: 'Salvo', Icon: ArrowDownTrayIcon },
  { key: 'aguardando', label: 'Aguardando', Icon: ClockIcon },
  { key: 'assinado', label: 'Assinado', Icon: CheckCircleIcon },
  { key: 'drive', label: 'Pasta', Icon: FolderIcon },
  { key: 'advbox_cliente', label: 'Cliente ADVBOX', Icon: UserIcon },
  { key: 'advbox_processo', label: 'Processo ADVBOX', Icon: ScaleIcon },
  { key: 'kommo', label: 'Kommo', Icon: FunnelIcon },
];

function getCompletedSteps(contract) {
  const steps = {};
  steps.salvo = true; // Always true if in DB

  const status = contract.status;
  const hasZapSign = !!contract.zapsign_doc_token;
  const signers = contract.zapsign_links || [];
  const allSigned = signers.length > 0 && signers.every(s => s.status === 'signed');

  steps.aguardando = hasZapSign || status === 'enviado_zapsign' || status === 'assinado';
  steps.assinado = status === 'assinado' || allSigned;
  // (varredura 15/06) 'uploading'/'failed' sao sentinelas de lock/erro, nao um file_id
  // real — a etapa "Pasta" acendia verde durante upload em andamento ou apos falha.
  steps.drive = !!contract.drive_file_id && !['uploading', 'failed'].includes(contract.drive_file_id);
  steps.advbox_cliente = contract.advbox_status === 'ok' || contract.advbox_status === 'processing';
  steps.advbox_processo = contract.advbox_status === 'ok';
  // Kommo — lead movido para a etapa ADVBOX no funil Venda (so apos automacao OK).
  // Le do alias leve do SELECT (kommo_j) ou do advbox_data completo (realtime/detail).
  // (#L7) coalescer por PRESENCA, nao truthiness: [] e truthy, entao um kommo_j.moved vazio
  // escondia um advbox_data.kommo.moved preenchido (ex.: apos merge do realtime).
  const kommoMoved = contract.kommo_j?.moved?.length ? contract.kommo_j.moved : (contract.advbox_data?.kommo?.moved || []);
  steps.kommo = kommoMoved.length > 0;

  return steps;
}

const SignerName = memo(function SignerName({ signer, index, kommoLink }) {
  const [copied, setCopied] = useState(false);
  const signed = signer.status === 'signed';
  const hasUrl = !signed && signer.sign_url;
  const views = signer.times_viewed || 0;
  const lastView = signer.last_view_at ? new Date(signer.last_view_at).toLocaleString('pt-BR') : null;

  const handleClick = (e) => {
    e.stopPropagation();
    if (!hasUrl) return;
    navigator.clipboard.writeText(signer.sign_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="flex items-center gap-1 relative">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${signed ? 'bg-green-500' : views > 0 ? 'bg-blue-400' : 'bg-amber-400 animate-pulse'}`} />
      {hasUrl ? (
        <button
          type="button"
          onClick={handleClick}
          className="text-left text-[11px] font-semibold transition-all text-amber-700 cursor-pointer hover:underline hover:text-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A5C]/40 rounded"
          title="Clique para copiar link de assinatura"
        >
          {signer.name || `Contratante ${index + 1}`}: {copied ? <span className="inline-flex items-center gap-0.5"><CheckIcon className="w-3 h-3 inline" aria-hidden="true" /> Link copiado!</span> : signed ? 'Assinado' : 'Pendente'}
        </button>
      ) : (
        <span
          className={`text-[11px] font-semibold transition-all ${signed ? 'text-green-700' : 'text-amber-700'}`}
          title={signed ? 'Já assinou' : ''}
        >
          {signer.name || `Contratante ${index + 1}`}: {signed ? 'Assinado' : 'Pendente'}
        </span>
      )}
      {!signed && views > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full cursor-default">
          <EyeIcon className="w-3 h-3" aria-hidden="true" /> {views}x {lastView && <span className="text-[11px] font-normal text-blue-600 ml-0.5">· {lastView}</span>}
        </span>
      )}
      {!signed && views === 0 && (
        <span className="text-[11px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-full">Não abriu</span>
      )}
      {kommoLink && (
        <a href={kommoLink} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-green-600 hover:text-green-700 hover:scale-125 transition-all cursor-pointer shrink-0" title="Abrir conversa no Kommo"
          aria-label="Abrir conversa no Kommo">
          <ChatBubbleLeftRightIcon className="w-4 h-4" aria-hidden="true" />
        </a>
      )}
      {copied && (
        <div className="absolute -top-7 left-0 px-2 py-1 bg-green-600 text-white text-[11px] font-bold rounded shadow-lg whitespace-nowrap z-50"
          style={{ animation: 'fadeIn 0.2s ease' }}>
          Link copiado!
        </div>
      )}
    </div>
  );
});

const ContractProgressBar = memo(function ContractProgressBar({ status, signers, contratantes, contract }) {
  const completed = contract ? getCompletedSteps(contract) : {};

  if (status === 'cancelado') {
    return (
      <div className="flex items-center gap-1 px-3 py-2 bg-red-50 rounded-lg">
        <XCircleIcon className="w-4 h-4 text-red-500" aria-hidden="true" />
        <span className="text-[10px] font-bold text-red-500 uppercase">Contrato Cancelado</span>
      </div>
    );
  }

  // (#extract-base 20/06) timeline -> primitivo AutomationPipeline (mesma logica
  // de PROGRESS_STEPS/getCompletedSteps; etapas pendentes agora mostram o icone
  // esmaecido e o rotulo sobe de 7px -> 11px). Pulsa "aguardando" quando ativo.
  return (<>
    <AutomationPipeline steps={PROGRESS_STEPS} completed={completed} activeKey="aguardando" className="py-2" />
    {/* Per-signer status when enviado_zapsign and has multiple signers */}
    {signers && signers.length > 0 && (status === 'enviado_zapsign' || status === 'assinado') && (
      <div className="flex items-center gap-3 px-1 mt-1 flex-wrap">
        {signers.map((s, i) => {
          // Match signer to contratante by name to get Kommo link
          const match = (contratantes || []).find(c => c?.nome && s.name && c.nome.toLowerCase() === s.name.toLowerCase());
          return <SignerName key={i} signer={s} index={i} kommoLink={match?.linkKommo} />;
        })}
      </div>
    )}
  </>
  );
});

// ─── ContratoRow (perf-fe-2) ───
// Cartao COLAPSADO da linha da lista, isolado em React.memo. So a linha cujas props
// mudam re-renderiza — antes qualquer mudanca de estado (abrir detalhe, selecao,
// realtime de OUTRA linha) re-renderizava a lista inteira inline.
// O detalhe EXPANDIDO fica no componente pai (acoplado a `detail`/handlers) — aqui so
// vive o cabecalho que renderiza para TODA linha. Props sao primitivas/estaveis:
//   contract (linha), isSelected/isExpanded (bool), selectionMode (bool),
//   onToggleSelect/onViewDetail (callbacks estaveis: useCallback no pai).
const ContratoRow = memo(function ContratoRow({ contract: c, isSelected, isExpanded, selectionMode, onToggleSelect, onViewDetail }) {
  return (
    <div className="dense-row cursor-pointer transition-colors flex gap-2 active:bg-gray-50/60" onClick={() => selectionMode ? onToggleSelect(c.id) : onViewDetail(c.id)}>
      {selectionMode && (
        <div className="shrink-0 flex items-start pt-0.5">
          <input type="checkbox" checked={isSelected} readOnly
            className="w-5 h-5 accent-[#1B3A5C] cursor-pointer rounded" />
        </div>
      )}
      <div className="flex-1 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 group/name relative">
          <div className="font-semibold text-sm text-gray-800 truncate">{c.nome_contratante1}</div>
          {c.nome_contratante2 && (
            <div className="text-[11px] text-gray-400 truncate">& {c.nome_contratante2}</div>
          )}
          {/* Hover preview tooltip */}
          <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover/name:block">
            <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-3 w-64 text-[10px]" style={{ animation: 'fadeIn 0.15s ease' }}>
              <div className="font-bold text-sm mb-1.5" style={{ color: '#1A2E52' }}>{c.nome_contratante1}</div>
              <div className="space-y-1 text-gray-600">
                <div className="flex justify-between"><span className="text-gray-400">CPF</span><span>{c.cpf_contratante1}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Resort</span><span className="font-medium">{c.resort}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Tipo</span><span>{c.tipo_acao}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Valor</span><span className="font-bold" style={{ color: '#1A2E52' }}>{c.honorarios_total > 0 ? formatCurrency(c.honorarios_total) : 'Somente êxito'}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Criado</span><span>{fmtDateTime(c.created_at)}</span></div>
                {c.created_by && <div className="flex justify-between"><span className="text-gray-400">Por</span><span>{c.created_by.split('@')[0]}</span></div>}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={c.status} />
          {c.status === 'assinado' && c.zapsign_doc_token && (
            <DownloadSignedButton contract={c} />
          )}
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      <div className="flex items-center gap-2 md:gap-3 mt-1.5 flex-wrap">
        <span className="text-[10px] text-gray-400">{c.cpf_contratante1}</span>
        <span className="text-[10px] text-gray-400">{c.resort}</span>
        <span className="text-[10px] text-gray-400">{fmtDateTime(c.created_at)}</span>
        {c.created_by && (
          <span className="text-[9px] text-blue-500 font-medium" title={c.created_by}>
            {c.created_by.split('@')[0]}
          </span>
        )}
        {/* (audit) Badge cinza para contratos arquivados (visivel quando toggle "Ver arquivados" ON) */}
        {c.arquivado_em && (
          <span
            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{ background: '#E5E7EB', color: '#4B5563' }}
            title={`Arquivado por ${c.arquivado_por || 'sistema'}${c.arquivado_motivo ? ' — ' + c.arquivado_motivo : ''}`}
          >
            <ArchiveBoxIcon className="w-2.5 h-2.5" aria-hidden="true" />
            Arquivado {new Date(c.arquivado_em).toLocaleDateString('pt-BR')}
            {c.arquivado_por ? ` por ${c.arquivado_por.split('@')[0]}` : ''}
          </span>
        )}
        {/* (import) Badge roxo para contratos importados manualmente */}
        {c.imported_manually && (
          <span
            className="ml-1 inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-100 border border-purple-300 px-1.5 py-0.5 rounded normal-case dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700/50"
            title={`Importado manualmente${c.imported_at ? ' em ' + new Date(c.imported_at).toLocaleDateString('pt-BR') : ''}${c.imported_by ? ' por ' + c.imported_by : ''}`}
          >
            <span aria-hidden="true">📥</span>
            Importado
          </span>
        )}
        <span className="text-xs font-semibold text-gray-600 ml-auto">{c.honorarios_total > 0 ? formatCurrency(c.honorarios_total) : (c.honorarios_percentual_exito > 0 ? `Êxito ${c.honorarios_percentual_exito}%` : 'Somente êxito')}</span>
      </div>
      {/* Progress bar with dates */}
      <ContractProgressBar status={c.status} signers={c.zapsign_links} contratantes={c.dados?.contratantes} contract={c} />
      </div>{/* close flex-1 wrapper */}
    </div>
  );
});

// ─── Pagination ───
function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 py-2">
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
        className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 cursor-pointer disabled:opacity-30 disabled:cursor-default text-xs">‹</button>
      {pages.map((p, idx) => (
        p === '...' ? (
          <span key={`dot-${idx}`} className="text-gray-400 text-xs px-1">...</span>
        ) : (
          <button key={p} onClick={() => onPageChange(p)}
            className={`w-7 h-7 rounded text-[10px] font-bold cursor-pointer transition-all ${
              p === page ? 'text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
            style={p === page ? { background: '#1B3A5C' } : {}}>{p}</button>
        )
      ))}
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
        className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 cursor-pointer disabled:opacity-30 disabled:cursor-default text-xs">›</button>
    </div>
  );
}

// ─── Toast inline simples (feedback de upload/retry Drive) ───
// Fica no canto inferior-esquerdo pra nao colidir com UndoToast (bottom-right).
// level: 'success' | 'error' | 'warning' | 'info'
function LocalToast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => onDismiss?.(), toast.duration || 5000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const levelStyle = {
    success: { bg: '#16A34A', border: 'rgba(255,255,255,0.2)' },
    error: { bg: '#DC2626', border: 'rgba(255,255,255,0.2)' },
    warning: { bg: '#D97706', border: 'rgba(255,255,255,0.2)' },
    info: { bg: '#2563EB', border: 'rgba(255,255,255,0.2)' },
  }[toast.level] || { bg: '#1F2937', border: 'rgba(255,255,255,0.08)' };

  const Icon = toast.level === 'success' ? CheckCircleIcon :
               toast.level === 'error' ? XCircleIcon :
               toast.level === 'warning' ? ExclamationTriangleIcon :
               InformationCircleIcon;

  return (
    <div
      className="toast-above-dock fixed z-[95] bottom-4 left-4 max-w-md animate-undo-slide-in"
      role="status"
      aria-live="polite"
    >
      <div
        className="flex items-start gap-3 rounded-xl shadow-2xl px-4 py-3 text-white"
        style={{ background: levelStyle.bg, border: `1px solid ${levelStyle.border}` }}
      >
        <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="text-sm font-medium flex-1 min-w-0 break-words">{toast.msg}</span>
        <button
          onClick={onDismiss}
          className="text-white/60 hover:text-white cursor-pointer text-base leading-none shrink-0"
          aria-label="Fechar"
        >&times;</button>
      </div>
    </div>
  );
}

// (audit) Modal opcional para capturar motivo do arquivamento.
// Textarea opcional. Apos "Continuar", chama onConfirm(motivo) que dispara o ConfirmDestructive padrao.
function ArchiveReasonModal({ modal, onCancel }) {
  const [motivo, setMotivo] = useState('');
  useEffect(() => { setMotivo(''); }, [modal]);
  if (!modal) return null;
  const isBulk = !!modal.isBulk;
  const titulo = isBulk
    ? `Arquivar ${modal.count} contrato(s)?`
    : `Arquivar contrato?`;
  const sub = isBulk
    ? `${modal.assinadoCount > 0 ? `Inclui ${modal.assinadoCount} assinado(s). ` : ''}Os contratos podem ser desarquivados depois pelo admin.`
    : `Contrato de ${modal.contractName}. Pode ser desarquivado depois pelo admin.`;

  return (
    <div
      className="modal-backdrop-glass fixed inset-0 z-[99] flex items-center justify-center p-4"
      onClick={() => onCancel?.()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-glass rounded-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#FEF3C7' }}>
            <ArchiveBoxIcon className="w-6 h-6" style={{ color: '#D97706' }} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm mb-1" style={{ color: 'var(--cbc-text-primary, #1A2E52)' }}>
              {titulo}
            </h3>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}>
              {sub}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--cbc-text-secondary, #4B5563)' }}>
            Motivo do arquivamento (opcional)
          </label>
          <textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            rows={3}
            placeholder="Ex.: cliente desistiu, contrato substituido, duplicado, etc."
            className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A5C]/40 transition-colors"
            style={{
              borderColor: '#E5E7EB',
              background: 'var(--cbc-surface, white)',
              color: 'var(--cbc-text-primary, #1A2E52)',
            }}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onCancel?.()}
            className="px-4 py-2 rounded-lg border text-sm font-bold cursor-pointer transition-colors"
            style={{
              borderColor: 'var(--cbc-border, #D1D5DB)',
              color: 'var(--cbc-text-secondary, #4B5563)',
              background: 'var(--cbc-surface, white)',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              const m = motivo.trim() || null;
              onCancel?.();
              modal.onConfirm?.(m);
            }}
            className="px-4 py-2 rounded-lg text-white text-sm font-bold cursor-pointer transition-all"
            style={{ background: '#D97706' }}
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───
// (p1-scale 06/05) Pagina maior porque agora a paginacao e server-side com range().
// Carrega 50 por chunk via infinite scroll (IntersectionObserver) — escala ate dezenas
// de milhares de linhas sem trazer tudo de uma vez.
const PAGE_SIZE = 50;

// (ux-8) Opcoes de ordenacao da lista. column/ascending vao direto pro .order()
// do fetch paginado (server-side). nullsFirst:false garante que linhas sem o valor
// (ex: assinatura ausente, honorarios nulos) caiam pro fim em ordem desc.
// Colunas: created_at, nome_contratante1, honorarios_total, signed_at — todas existem
// na tabela (signed_at nao esta no SELECT, mas .order aceita coluna fora do select).
const SORT_OPTIONS = [
  { id: 'recent',     label: 'Mais recentes',         column: 'created_at',         ascending: false },
  { id: 'oldest',     label: 'Mais antigos',          column: 'created_at',         ascending: true  },
  { id: 'name_az',    label: 'Nome (A-Z)',            column: 'nome_contratante1',  ascending: true  },
  { id: 'value_desc', label: 'Maior valor',           column: 'honorarios_total',   ascending: false },
  { id: 'signed',     label: 'Assinados recentemente', column: 'signed_at',          ascending: false },
];
function getSortOption(id) {
  return SORT_OPTIONS.find(o => o.id === id) || SORT_OPTIONS[0];
}

// (perf 31/05) Cache em memoria da lista — reaparece instantaneo ao voltar pra aba (sem skeleton).
let _cachedContratosList = null;

export default function ContratosTab({ onLoadContract, onRequestDestructiveConfirm }) {
  const [contratos, setContratos] = useState(_cachedContratosList || []);
  const [loading, setLoading] = useState(!_cachedContratosList);
  // (perf 31/05) Mantem o cache em memoria sincronizado com a lista exibida (cobre realtime/exclusoes).
  useEffect(() => { _cachedContratosList = contratos; }, [contratos]);
  // (#51) Filtros persistidos em localStorage
  const [search, setSearch] = usePersistedFilter('contratos', 'search', '');
  const [filterStatus, setFilterStatus] = usePersistedFilter('contratos', 'filterStatus', '');
  // (ux-8) Ordenacao da lista (persistida). Cada opcao mapeia para coluna+direcao
  // aplicados no .order() do fetch paginado. Default mantem o comportamento antigo
  // (created_at desc). Colunas usadas existem no SELECT/tabela.
  const [sortBy, setSortBy] = usePersistedFilter('contratos', 'sortBy', 'recent');
  // (#119) Debounce — evita fetch a cada tecla; 300ms e um bom equilibrio UX/bw
  const debouncedSearch = useDebounce(search, 300);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  // (p1-scale 06/05) Paginacao server-side: page = chunk index (0-based).
  // totalCount vem do count: 'exact' do Supabase. hasMore = ainda tem mais paginas.
  // loadingMore = chunk subsequente em fetch (skeleton no fim da lista).
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // (audit) Toggle "Ver arquivados" + flag de admin (controla desarquivar/hard delete)
  const [showArquivados, setShowArquivados] = usePersistedFilter('contratos', 'showArquivados', false);
  const [isAdmin, setIsAdmin] = useState(false);
  // (#85) View mode — list (padrao) | cards | kanban — persistido por usuario
  const [viewMode, setViewMode] = usePersistedFilter('contratos', 'viewMode', 'list');
  // (#99) Usuario atual — para gravar comentarios e validar permissao de edicao
  const [currentUser, setCurrentUser] = useState(null);
  // (#215) Modal de lembrete por contrato
  const [reminderFor, setReminderFor] = useState(null); // { id, nome }
  // (audit) Modal opcional de motivo do arquivamento
  const [archiveModal, setArchiveModal] = useState(null); // { ids: [...], onConfirm: fn, isBulk: bool, count: number }
  // (import) Modal de importacao manual de contrato assinado
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importToast, setImportToast] = useState('');

  const [syncing, setSyncing] = useState(false);

  // (audit) Carrega flag is_admin do user_permissions
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) return;
        if (mounted) setCurrentUser({ id: user.id, email: user.email });
        const { data } = await supabase.from('user_permissions')
          .select('is_admin').eq('email', user.email.toLowerCase()).single();
        if (mounted) setIsAdmin(!!data?.is_admin);
      } catch { /* silent — assume nao-admin */ }
    })();
    return () => { mounted = false; };
  }, []);

  // Toast local (feedback de Drive upload/retry)
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, level = 'info', duration = 5000) => {
    setToast({ msg, level, duration, ts: Date.now() });
  }, []);

  // Modal de atribuir/trocar pasta do Drive. Valor = contract id, ou null.
  const [driveFolderModalContractId, setDriveFolderModalContractId] = useState(null);

  // Verificadores em andamento (contractId → intervalId) para limpar no unmount
  const verificationsRef = useRef(new Map());

  useEffect(() => {
    // Copia referencia no mount — ref nunca muda em si, so o conteudo.
    // Necessario pra evitar warning do react-hooks/exhaustive-deps no cleanup.
    const store = verificationsRef.current;
    return () => {
      store.forEach(id => clearInterval(id));
      store.clear();
    };
  }, []);

  // (p1-scale 06/05) Mantemos uma ref ao length de contratos para evitar
  // dependencia circular em fetchPage (e tambem usado em loadMore).
  // Declarada antes de fetchPage para evitar qualquer ambiguidade de TDZ.
  const contratosLenRef = useRef(0);
  contratosLenRef.current = contratos.length;

  // (p1-scale 06/05) Fetch paginado server-side via .range().
  // pageNum 0-based; append=true concatena na lista existente (infinite scroll).
  // count: 'exact' retorna o total para o sentinel "X de Y".
  const fetchPage = useCallback(async (pageNum, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const from = pageNum * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // (ux-8) Ordenacao dinamica aplicada NO fetch paginado (server-side), junto do
      // .range() — essencial: ordenar so no client quebraria com paginacao. nullsFirst
      // false manda nulos pro fim. Desempate por created_at desc p/ ordem estavel
      // quando a coluna primaria empata (ex: varios honorarios iguais).
      const sortOpt = getSortOption(sortBy);
      let query = supabase
        .from('contratos')
        .select('id, nome_contratante1, nome_contratante2, cpf_contratante1, resort, tipo_acao, honorarios_total, honorarios_percentual_exito, status, created_at, updated_at, created_by, zapsign_links, zapsign_doc_token, pdf_page_split, contratantes_j:dados->contratantes, advbox_status, kommo_j:advbox_data->kommo, drive_file_id, drive_file_link, drive_attempts, drive_last_attempt_at, drive_last_error, drive_error_code, drive_failed_reason, arquivado_em, arquivado_por, arquivado_motivo, imported_manually, imported_by, imported_at', { count: 'exact' })
        .order(sortOpt.column, { ascending: sortOpt.ascending, nullsFirst: false });
      if (sortOpt.column !== 'created_at') {
        query = query.order('created_at', { ascending: false });
      }
      query = query.range(from, to);

      // (audit) Soft delete — listagem padrao oculta arquivados.
      // Toggle "Ver arquivados" inverte a query (so arquivados).
      if (showArquivados) {
        query = query.not('arquivado_em', 'is', null);
      } else {
        query = query.is('arquivado_em', null);
      }

      if (filterStatus) {
        query = query.eq('status', filterStatus);
      }
      if (debouncedSearch) {
        // (#L6) vírgula/parênteses são separadores/grupos no filtro .or() do PostgREST —
        // sem sanitizar, uma busca com "," quebrava a query inteira. Trocamos por espaço.
        const safe = debouncedSearch.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
        const ors = [
          `nome_contratante1.ilike.%${safe}%`,
          `nome_contratante2.ilike.%${safe}%`,
          `cpf_contratante1.ilike.%${safe}%`,
          `resort.ilike.%${safe}%`,
        ];
        // (QW#10) busca por CPF tambem aceita SO digitos: o CPF e salvo formatado
        // (123.456.789-00), entao reformatamos os digitos com maskCPF p/ casar com o
        // armazenado, e cobrimos os dois contratantes.
        const digits = debouncedSearch.replace(/\D/g, '');
        if (digits.length >= 3) {
          const masked = maskCPF(digits);
          ors.push(`cpf_contratante1.ilike.%${masked}%`, `cpf_contratante2.ilike.%${masked}%`);
        }
        query = query.or(ors.join(','));
      }

      const { data, error: dbError, count } = await query;
      if (dbError) throw dbError;

      // (p1-scale 31/05) Antes trazia o JSONB 'dados' inteiro (5-20KB/linha) so para a
      // barra de progresso ler dados.contratantes. Agora extrai so esse sub-campo via
      // JSON-path e reconstroi o shape minimo. Eventos de realtime trazem dados completo,
      // o que continua compativel (a lista so le c.dados?.contratantes).
      const fetched = (data || []).map(({ contratantes_j, ...rest }) => ({
        ...rest,
        dados: { contratantes: contratantes_j || [] },
      }));
      // (p1-scale) Append acumula; replace zera (filtros mudaram ou primeira pagina)
      // (#21) dedup por id ao concatenar paginas — INSERT/DELETE concorrente desloca o
      // offset e o realtime pode ja ter inserido a mesma linha; sem dedup, duplicava.
      setContratos(prev => {
        if (!append) return fetched;
        const seen = new Set(prev.map(c => c.id));
        return [...prev, ...fetched.filter(f => !seen.has(f.id))];
      });
      const total = count || 0;
      setTotalCount(total);
      // hasMore = quantidade ja carregada < total no banco
      const loadedSoFar = (append ? (contratosLenRef.current + fetched.length) : fetched.length);
      setHasMore(loadedSoFar < total);

      // (resilience 28/04) Cache IndexedDB dos ultimos 100 — em segundo plano,
      // nao bloqueia a UI. Usado como fallback offline se o Supabase cair.
      // So cacheia listagem padrao (nao arquivados, sem filtros) — esses sao os
      // mais relevantes para uso offline. Cacheia apenas a primeira pagina.
      if (!append && !showArquivados && !filterStatus && !debouncedSearch && fetched.length) {
        cacheContracts(fetched);
      }
      return fetched;
    } catch {
      // (resilience 28/04) Tenta servir do cache local antes de mostrar erro.
      // So usa cache na primeira pagina (sem filtros). Append nao tenta cache.
      if (!append) {
        try {
          const cached = await getCachedContracts();
          if (cached.length > 0) {
            setContratos(cached);
            setTotalCount(cached.length);
            setHasMore(false);
            window.dispatchEvent(new CustomEvent('cbc:supabase-degraded', {
              detail: {
                msg: `Mostrando ${cached.length} contratos do cache local. Reconecte para dados atualizados.`,
                ts: Date.now(),
              },
            }));
            return cached;
          }
        } catch { /* cache indisponivel */ }
      }
      // (#100) Erro generico + ErrorState inline
      setError('Erro ao carregar contratos');
      return [];
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [debouncedSearch, filterStatus, showArquivados, sortBy]); // (ux-8) sortBy dispara refetch da 1a pagina

  // (p1-scale 06/05) Wrapper compativel com a chamada antiga em varios pontos
  // (botao "Buscar", retry, pull-to-refresh, etc.). Sempre busca a primeira pagina.
  const fetchContratos = useCallback(async () => {
    setPage(0);
    return fetchPage(0, false);
  }, [fetchPage]);

  // (p1-scale 06/05) Carrega proxima pagina (infinite scroll). Idempotente:
  // ignora chamadas concorrentes e quando ja carregou tudo.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    const nextPage = page + 1;
    await fetchPage(nextPage, true);
    setPage(nextPage);
  }, [loadingMore, hasMore, loading, page, fetchPage]);

  const syncZapSign = useCallback(async () => {
    setSyncing(true);
    try {
      // Fetch all contracts with enviado_zapsign status that have a doc token
      const { data: pending } = await supabase
        .from('contratos')
        .select('id, zapsign_doc_token, zapsign_links')
        .eq('status', 'enviado_zapsign')
        .not('zapsign_doc_token', 'is', null);

      let synced = 0;
      for (const contract of (pending || [])) {
        try {
          const result = await checkZapSignStatus(contract.zapsign_doc_token);
          if (!result) continue;

          // Check if all signers have signed
          const allSigned = result.signers.every(s => s.status === 'signed');
          if (allSigned && result.signers.length > 0) {
            // Update to signed status
            const updatedLinks = result.signers.map(s => ({
              name: s.name,
              email: s.email,
              token: s.token,
              sign_url: s.signUrl,
              status: s.status,
              signed_at: s.signedAt,
              // (varredura 15/06) preserva o rastreio de visualizacao no sync manual
              times_viewed: s.times_viewed || 0,
              first_opened_at: s.first_opened_at || null,
              last_view_at: s.last_view_at || null,
            }));
            // (bug-4) grava a data REAL de assinatura (ultimo signatario) tambem neste
            // caminho manual, igual ao polling e ao webhook — evita signed_at vazio.
            const datasAssinatura = result.signers.map(s => s.signedAt).filter(Boolean).sort();
            const signedAt = datasAssinatura.length ? datasAssinatura[datasAssinatura.length - 1] : new Date().toISOString();
            const { data: updated } = await supabase
              .from('contratos')
              .update({ status: 'assinado', signed_at: signedAt, zapsign_links: updatedLinks, updated_at: new Date().toISOString() })
              .eq('id', contract.id)
              .eq('status', 'enviado_zapsign') // Optimistic lock: only if still pending
              .select('id');
            if (!updated?.length) continue; // Already updated by another user
            synced++;

            // ADVBOX + Drive auto-sync handled by App.jsx pollZapSign (centralized, no duplicates)
          } else {
            // Update signer statuses
            const updatedLinks = result.signers.map(s => ({
              name: s.name,
              email: s.email,
              token: s.token,
              sign_url: s.signUrl,
              status: s.status,
              signed_at: s.signedAt,
              // (varredura 15/06) preserva o rastreio de visualizacao no sync manual
              times_viewed: s.times_viewed || 0,
              first_opened_at: s.first_opened_at || null,
              last_view_at: s.last_view_at || null,
            }));
            // Guard: nao escreve se signers nao mudaram (evita audit spam — abr/2026)
            const prev = JSON.stringify(contract.zapsign_links || []);
            const next = JSON.stringify(updatedLinks);
            if (prev === next) continue;
            await supabase
              .from('contratos')
              .update({ zapsign_links: updatedLinks })
              .eq('id', contract.id);
          }
        } catch { /* ignora falha por contrato */ }
      }
      if (synced > 0) await fetchContratos();
    } catch { /* best-effort sync */ }
    finally { setSyncing(false); }
  }, [fetchContratos]);

  useEffect(() => { fetchContratos(); }, [fetchContratos]);

  // Supabase Realtime — live updates without page reload (stable, no re-subscription)
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  // (#20) refs p/ os filtros ativos — o realtime assina uma vez (deps []); ler o state
  // direto no callback pegaria valor velho (stale closure). Ref sempre atualiza no render.
  const showArquivadosRef = useRef(showArquivados);
  showArquivadosRef.current = showArquivados;
  const filterStatusRef = useRef(filterStatus);
  filterStatusRef.current = filterStatus;
  const sortByRef = useRef(sortBy);
  sortByRef.current = sortBy;

  useEffect(() => {
    // (resilience 28/04) Nome fixo do channel — antes usava 'contratos-rt-' + Date.now()
    // e vazava conexao a cada mount, esgotando o pool PostgreSQL. Cleanup garantido
    // pelo removeChannel no return. Tres listeners separados (INSERT/UPDATE/DELETE)
    // ja sao especificos — nao usa event='*'.
    // (p1-scale 06/05) Com paginacao server-side, INSERT pode chegar pelo realtime
    // antes do refetch — entao dedupamos por id pra nao duplicar quando o fetch
    // tambem traz o mesmo registro. totalCount ajustado em INSERT/DELETE.
    const channel = supabase
      .channel('contratos-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contratos' }, (payload) => {
        const row = payload.new;
        // (#20) so adiciona se casar com os filtros ativos (arquivado/status).
        const arquivada = row.arquivado_em != null;
        const fits = (showArquivadosRef.current ? arquivada : !arquivada) &&
          (!filterStatusRef.current || row.status === filterStatusRef.current);
        if (!fits) return;
        // (#L8) so insere no topo quando a ordenacao e "mais recentes" (created_at desc).
        // Em outras ordens a posicao correta exigiria reordenar — o contador sobe (a linha
        // existe) e o refetch/poll a traz na posicao certa.
        if (sortByRef.current === 'recent') {
          setContratos(prev => {
            if (prev.find(c => c.id === row.id)) return prev;
            return [row, ...prev];
          });
        }
        setTotalCount(c => c + 1);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contratos' }, (payload) => {
        const row = payload.new;
        // (#20) se o UPDATE tirou a linha dos filtros ativos (arquivada, ou status != filtro),
        // remove da lista em vez de deixa-la visivel e desatualizada.
        const arquivada = row.arquivado_em != null;
        const fits = (showArquivadosRef.current ? arquivada : !arquivada) &&
          (!filterStatusRef.current || row.status === filterStatusRef.current);
        if (!fits) {
          setContratos(prev => prev.filter(c => c.id !== row.id));
        } else {
          setContratos(prev => prev.map(c => c.id === row.id ? { ...c, ...row } : c));
        }
        if (selectedIdRef.current === row.id) {
          supabase.from('contratos').select('*').eq('id', row.id).single()
            .then(({ data }) => { if (data) setDetail(data); });
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'contratos' }, (payload) => {
        setContratos(prev => prev.filter(c => c.id !== payload.old.id));
        setTotalCount(c => Math.max(0, c - 1));
        if (selectedIdRef.current === payload.old.id) { setSelectedId(null); setDetail(null); }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []); // Stable — never re-subscribes

  // Auto-sync ZapSign on mount + every 30s (stable interval, no leak)
  const contratosRef = useRef(contratos);
  contratosRef.current = contratos;

  useEffect(() => {
    // Polling consolidado em App.jsx (abr/2026):
    // o setInterval de 30s daqui era o segundo poller paralelo, dobrando UPDATEs
    // em contratos e enchendo contratos_audit (~30k linhas/dia).
    // Mantido apenas o sync inicial no mount.
    syncZapSign();
  }, []); // Stable — single sync on mount

  // Verificador de automacoes Drive apos atribuir/trocar pasta.
  // Checa a cada 30s se o upload completou; timeout 15 min.
  const startDriveVerification = useCallback((contractId) => {
    if (!contractId) return;
    // Se ja tiver verificacao em andamento pra esse contrato, nao duplica
    if (verificationsRef.current.has(contractId)) return;

    const startedAt = Date.now();
    const CHECK_INTERVAL = 30 * 1000;
    const TIMEOUT = 15 * 60 * 1000;

    showToast('Verificando automacoes do Drive... (ate 15 min)', 'info', 6000);

    const intervalId = setInterval(async () => {
      try {
        const { data } = await supabase.from('contratos')
          .select('drive_file_id, drive_error_code, drive_last_error, drive_file_link')
          .eq('id', contractId).single();

        const elapsed = Date.now() - startedAt;
        const fid = data?.drive_file_id;

        if (fid && fid !== 'uploading' && fid !== 'failed') {
          clearInterval(intervalId);
          verificationsRef.current.delete(contractId);
          showToast('Upload concluido no Drive.', 'success', 6000);
          await fetchContratos();
        } else if (fid === 'failed') {
          clearInterval(intervalId);
          verificationsRef.current.delete(contractId);
          const errCode = data.drive_error_code || 'GENERIC';
          const errMsg = (data.drive_last_error || '').substring(0, 80);
          showToast(`Upload falhou: ${errCode}${errMsg ? ' - ' + errMsg : ''}`, 'error', 8000);
          await fetchContratos();
        } else if (elapsed > TIMEOUT) {
          clearInterval(intervalId);
          verificationsRef.current.delete(contractId);
          showToast('Verificacao expirou. Confira o status manualmente.', 'warning', 8000);
        }
      } catch {
        // Silencia erros transitorios; proxima iteracao tenta de novo
      }
    }, CHECK_INTERVAL);

    verificationsRef.current.set(contractId, intervalId);
  }, [showToast]);

  // Reset de retry — libera drive_file_id e zera contadores.
  // Proxima iteracao do polling do App.jsx vai re-tentar automaticamente.
  const handleResetDriveRetry = useCallback(async (contractId) => {
    if (!contractId) return;
    try {
      const { resetDriveRetry } = await import('../utils/driveRetry');
      await resetDriveRetry(contractId);
      showToast('Tentativa resetada. Upload sera tentado novamente em segundos.', 'info', 6000);
      startDriveVerification(contractId);
      await fetchContratos();
    } catch (e) {
      showToast('Erro ao resetar: ' + (e?.message || 'falha'), 'error', 6000);
    }
  }, [showToast, startDriveVerification, fetchContratos]);

  // Callback apos salvar nova pasta no modal — dispara verificacao.
  const handleDriveFolderSaved = useCallback((contractId) => {
    showToast('Pasta atribuida. Iniciando upload em segundos...', 'success', 5000);
    startDriveVerification(contractId);
    fetchContratos();
  }, [showToast, startDriveVerification, fetchContratos]);

  const handleSearchKeyDown = (e) => { if (e.key === 'Enter') fetchContratos(); };

  // Pull to refresh
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const listRef = useRef(null);
  // (mobile fix 12/06) Ref do container que REALMENTE rola (div.flex-1.overflow-y-auto
  // dos resultados). Declarado aqui para o pull-to-refresh checar scrollTop;
  // tambem e o `root` do IntersectionObserver do infinite scroll (ver useEffect abaixo).
  const scrollContainerRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    // (mobile fix 12/06) O gesto so arma quando o container scrollavel de verdade
    // (scrollContainerRef) esta no topo. listRef e o wrapper externo que nunca rola
    // (scrollTop sempre 0), entao qualquer arrasto disparava o pull-to-refresh.
    const scroller = scrollContainerRef.current;
    if (scroller && scroller.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    } else { touchStartY.current = 0; }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!touchStartY.current) return;
    // (mobile fix 12/06) Se o container rolou durante o gesto, desarma o pull.
    const scroller = scrollContainerRef.current;
    if (scroller && scroller.scrollTop > 0) { touchStartY.current = 0; setPullY(0); return; }
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0 && diff < 120) setPullY(diff);
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (pullY > 60) { setRefreshing(true); await fetchContratos(); setRefreshing(false); }
    setPullY(0); touchStartY.current = 0;
  }, [pullY, fetchContratos]);

  const handleViewDetail = useCallback(async (id) => {
    if (selectedId === id) { setSelectedId(null); setDetail(null); return; }
    setSelectedId(id);
    try {
      const { data, error: dbError } = await supabase
        .from('contratos')
        .select('*')
        .eq('id', id)
        .single();
      if (dbError) throw dbError;
      setDetail(data);
    } catch (err) { setError(err.message); }
  }, [selectedId]);

  // (#205) Abrir contrato via evento global (NotificationCenter, ActivityFeed)
  useEffect(() => {
    const handler = (e) => {
      const id = e?.detail?.id;
      if (id) {
        setViewMode('list');
        handleViewDetail(id);
      }
    };
    window.addEventListener('cbc:openContract', handler);
    return () => window.removeEventListener('cbc:openContract', handler);
  }, [handleViewDetail, setViewMode]);

  // (audit) Arquiva via RPC arquivar_contrato — substitui o DELETE.
  // Reversivel via "Desarquivar" no toggle "Ver arquivados".
  const doArchiveContract = async (id, motivo = null) => {
    try {
      const { error: rpcError } = await supabase.rpc('arquivar_contrato', {
        p_id: id,
        p_motivo: motivo || null,
      });
      if (rpcError) throw rpcError;
      // Remove da listagem padrao (oculta arquivados)
      setContratos(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
    } catch (err) {
      setError('Erro ao arquivar: ' + (err.message || 'falha desconhecida'));
      throw err;
    }
  };

  // (audit) Desarquiva via RPC — apenas admin. Trigger valida no banco tambem.
  const doUnarchiveContract = async (id) => {
    try {
      const { error: rpcError } = await supabase.rpc('desarquivar_contrato', { p_id: id });
      if (rpcError) throw rpcError;
      // Sai da listagem de arquivados (volta pra ativos)
      setContratos(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
    } catch (err) {
      setError('Erro ao desarquivar: ' + (err.message || 'falha desconhecida'));
    }
  };

  // (audit) Hard delete — apenas admin, em contratos JA arquivados.
  // Substitui o antigo "Excluir". Trigger valida is_admin no banco.
  const doHardDelete = async (id) => {
    try {
      const { error: dbError } = await supabase.from('contratos').delete().eq('id', id);
      if (dbError) throw dbError;
      setContratos(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
    } catch (err) {
      setError('Erro ao deletar permanentemente: ' + (err.message || 'falha'));
    }
  };

  // (audit) Handler principal — substitui handleDelete antigo.
  // Para contratos ATIVOS: arquiva (com modal de motivo + ConfirmDestructive ARQUIVAR).
  // Para contratos JA ARQUIVADOS: opcao de desarquivar (admin) ou hard delete (admin).
  const handleArchive = async (id) => {
    const contract = contratos.find(c => c.id === id);
    if (!contract) return;
    // Ja arquivado? Nao deveria chegar aqui pelo fluxo padrao (botao muda).
    if (contract.arquivado_em) return;

    // Pede motivo (textarea opcional) + confirmacao com digitacao
    setArchiveModal({
      isBulk: false,
      count: 1,
      contractName: contract.nome_contratante1 || 'cliente',
      onConfirm: async (motivo) => {
        // Apos motivo capturado, dispara ConfirmDestructive padrao
        if (onRequestDestructiveConfirm) {
          onRequestDestructiveConfirm({
            title: 'Arquivar contrato?',
            message: `Contrato de ${contract.nome_contratante1 || 'cliente'} sera arquivado. O contrato pode ser desarquivado depois pelo admin.`,
            confirmText: 'ARQUIVAR',
            onConfirm: async () => {
              try {
                await doArchiveContract(id, motivo);
                onRequestDestructiveConfirm(null);
              } catch { onRequestDestructiveConfirm(null); }
            },
          });
        } else if (confirm('Arquivar contrato? Pode ser desarquivado depois.')) {
          await doArchiveContract(id, motivo);
        }
      },
    });
  };

  // (audit) Hard delete handler — apenas admin, contrato ja arquivado.
  const handleHardDelete = async (id) => {
    const contract = contratos.find(c => c.id === id);
    if (!contract || !isAdmin) return;
    if (onRequestDestructiveConfirm) {
      onRequestDestructiveConfirm({
        title: 'Deletar permanentemente?',
        message: `O contrato de ${contract.nome_contratante1 || 'cliente'} sera REMOVIDO do banco. Acao IRREVERSIVEL.`,
        confirmText: 'DELETAR PERMANENTEMENTE',
        onConfirm: async () => {
          await doHardDelete(id);
          onRequestDestructiveConfirm(null);
        },
      });
    } else if (confirm('DELETAR PERMANENTEMENTE? Acao irreversivel.')) {
      await doHardDelete(id);
    }
  };

  const handleLoadContract = (dados, contractId) => { if (onLoadContract && dados) onLoadContract(dados, contractId); };

  // Selection helpers
  // (perf-fe-2) useCallback p/ ser prop estavel do ContratoRow memoizado.
  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === contratos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contratos.map(c => c.id)));
    }
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // (audit) Bulk archive — substitui bulk delete.
  // Loop chamando RPC arquivar_contrato. Cada falha individual nao bloqueia o resto.
  const executeBulkArchive = async (ids, motivo = null) => {
    setDeleting(true);
    let arquivados = 0;
    let jaArquivados = 0;
    let erros = 0;
    try {
      for (const id of ids) {
        try {
          const { error: rpcError } = await supabase.rpc('arquivar_contrato', {
            p_id: id,
            p_motivo: motivo || null,
          });
          if (rpcError) {
            // Codigo 42P01 = ja arquivado (erro custom da RPC)
            if (rpcError.code === '42P01' || /ja arquivado/i.test(rpcError.message || '')) {
              jaArquivados++;
            } else {
              erros++;
            }
          } else {
            arquivados++;
          }
        } catch { erros++; }
      }
      setContratos(prev => prev.filter(c => !selectedIds.has(c.id)));
      if (selectedIds.has(selectedId)) { setSelectedId(null); setDetail(null); }
      setSelectedIds(new Set());
      setSelectionMode(false);
      // Resumo no error/info bar
      let msg = `${arquivados} arquivado(s)`;
      if (jaArquivados > 0) msg += `, ${jaArquivados} ja estavam arquivados`;
      if (erros > 0) msg += `, ${erros} erro(s)`;
      setError(erros > 0 ? msg : '');
      // Recarrega pra refletir estado real do banco
      await fetchContratos();
    } catch (err) { setError('Erro ao arquivar lote: ' + err.message); }
    finally { setDeleting(false); }
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const assinadoCount = ids.filter(id => contratos.find(c => c.id === id)?.status === 'assinado').length;

    setArchiveModal({
      isBulk: true,
      count: ids.length,
      assinadoCount,
      onConfirm: async (motivo) => {
        if (onRequestDestructiveConfirm) {
          onRequestDestructiveConfirm({
            title: `Arquivar ${ids.length} contrato(s)?`,
            message: `${assinadoCount > 0 ? `Inclui ${assinadoCount} contrato(s) assinado(s). ` : ''}Os contratos podem ser desarquivados depois pelo admin.`,
            confirmText: 'ARQUIVAR',
            onConfirm: async () => {
              await executeBulkArchive(ids, motivo);
              onRequestDestructiveConfirm(null);
            },
          });
        } else if (confirm(`Arquivar ${ids.length} contrato(s)? Pode ser desarquivado depois.`)) {
          await executeBulkArchive(ids, motivo);
        }
      },
    });
  };

  // (p1-scale 06/05) Paginacao server-side: agora `contratos` ja e a lista
  // acumulada (1 pagina por chunk). Sem slice no client. Totais vem do banco.
  const sentinelRef = useRef(null);
  // (pagination fix 23/05/2026) O scroll acontece DENTRO de div.flex-1.overflow-y-auto,
  // nao na viewport. Precisamos passar esse container como `root` do
  // IntersectionObserver, senao o sentinel nunca entra em viewport e infinite
  // scroll trava em 50 de N. (mobile fix 12/06: scrollContainerRef foi movido
  // para junto do pull-to-refresh, mais acima — mesmo ref, mesmo uso aqui.)

  // (p1-scale) IntersectionObserver para infinite scroll. Dispara loadMore
  // quando o sentinel entra em viewport do container scrollavel (200px de margem).
  // Re-observa quando contratos.length ou viewMode mudam (sentinel re-renderiza).
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    // root: scrollContainerRef.current (container interno) — fallback null se ainda
    // nao montou (raro, mas defensive). Observer e re-criado quando viewMode muda
    // porque sentinel pode estar em outra posicao no DOM.
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore();
      }
    }, { root: scrollContainerRef.current || null, rootMargin: '200px' });
    obs.observe(node);
    return () => obs.disconnect();
  }, [loadMore, hasMore, contratos.length, viewMode]);

  return (
    <div className="h-full flex flex-col bg-white"
      ref={listRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}>
      {/* Pull to refresh */}
      {(pullY > 0 || refreshing) && (
        <div className="shrink-0 flex items-center justify-center py-2 text-[10px] font-bold uppercase text-gray-500 transition-all"
          style={{ height: refreshing ? 36 : Math.min(pullY, 60), overflow: 'hidden' }}>
          {refreshing ? <span className="animate-spin">&#8635;</span> : pullY > 60 ? <span>Solte para atualizar</span> : <span style={{ opacity: pullY / 60 }}>Puxe para atualizar</span>}
        </div>
      )}

      {/* Search */}
      <div className="p-3 md:p-4 border-b border-gray-100 space-y-2.5 bg-white">
        <div className="flex gap-2 max-sm:flex-wrap">
          <div className="flex-1 relative min-w-0 max-sm:basis-full">
            <input type="text" placeholder="Buscar por nome, CPF ou resort..." enterKeyHint="search" autoComplete="off"
              value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleSearchKeyDown}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#1B3A5C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A5C]/40 pr-8" />
            <svg className="absolute right-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button onClick={fetchContratos}
            className="px-3 md:px-4 py-2 text-xs font-bold uppercase rounded-lg text-white cursor-pointer shrink-0"
            style={{ background: '#1B3A5C' }}>Buscar</button>
          <button onClick={syncZapSign} disabled={syncing} title="Sincronizar status ZapSign"
            className={`px-2 py-2 rounded-lg cursor-pointer shrink-0 transition-all ${syncing ? 'animate-spin' : 'hover:bg-gray-100'}`}
            style={{ color: '#1B3A5C' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
          {/* (import) Botao para importar contrato ja assinado externamente */}
          <button
            onClick={() => setImportModalOpen(true)}
            className="btn-outline text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0"
            title="Importar contrato ja assinado (externo ao fluxo padrao)"
          >
            <DocumentArrowUpIcon className="w-4 h-4" aria-hidden="true" />
            <span className="hidden md:inline">Importar contrato assinado</span>
            <span className="inline md:hidden">Importar</span>
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1 items-center">
          {[
            { value: '', label: 'Todos' },
            { value: 'rascunho', label: 'Rascunhos' },
            { value: 'enviado_zapsign', label: 'Enviados' },
            { value: 'assinado', label: 'Assinados' },
            { value: 'cancelado', label: 'Cancelados' },
          ].map(opt => (
            <button key={opt.value} onClick={() => setFilterStatus(opt.value)}
              className={`px-3 py-1 text-[10px] font-bold uppercase rounded-full cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                filterStatus === opt.value ? 'text-white' : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
              }`}
              style={filterStatus === opt.value ? { background: '#1B3A5C' } : {}}>{opt.label}</button>
          ))}
          {/* (audit) Toggle "Ver arquivados" — separa da listagem padrao */}
          <label
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer transition-all whitespace-nowrap shrink-0 border"
            style={showArquivados
              ? { background: '#FEF3C7', borderColor: '#F59E0B', color: '#92400E' }
              : { background: 'transparent', borderColor: '#D1D5DB', color: '#6B7280' }}
            title="Mostrar somente contratos arquivados (soft delete)"
          >
            <input
              type="checkbox"
              checked={showArquivados}
              onChange={e => setShowArquivados(e.target.checked)}
              className="w-3 h-3 cursor-pointer accent-amber-600"
            />
            <ArchiveBoxIcon className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase">Ver arquivados</span>
          </label>
        </div>

        {/* (#85, #92) View mode + Views salvas */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex bg-gray-100 rounded-lg p-0.5 border border-gray-200">
            {[
              { id: 'list',   label: 'Lista',   Icon: ListBulletIcon },
              { id: 'cards',  label: 'Cards',   Icon: Squares2X2Icon },
              { id: 'kanban', label: 'Kanban',  Icon: ViewColumnsIcon },
            ].map(opt => {
              const active = viewMode === opt.id;
              const Icon = opt.Icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setViewMode(opt.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide rounded-md transition-all cursor-pointer ${
                    active ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
                  }`}
                  title={`Visualizar como ${opt.label}`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              );
            })}
          </div>
          {/* (ux-8) Seletor de ordenacao da lista — muda o .order() do fetch paginado */}
          <label className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            <span className="hidden sm:inline">Ordenar</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-[11px] font-semibold text-gray-700 bg-white cursor-pointer focus:border-[#1B3A5C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A5C]/40"
              title="Ordenar contratos"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <ViewsManager
            currentFilters={{
              filters: { filterStatus, search, showArquivados },
              viewMode,
            }}
            onApplyView={(view) => {
              const f = view.filters || {};
              if (typeof f.filterStatus === 'string') setFilterStatus(f.filterStatus);
              if (typeof f.search === 'string') setSearch(f.search);
              if (typeof f.showArquivados === 'boolean') setShowArquivados(f.showArquivados);
              if (view.view_mode) setViewMode(view.view_mode);
            }}
          />
        </div>
      </div>

      {/* Selection toolbar */}
      {contratos.length > 0 && (
        <div className="px-3 md:px-4 pt-2 flex items-center gap-2">
          {!selectionMode ? (
            <button onClick={() => setSelectionMode(true)}
              className="text-[10px] font-bold uppercase text-gray-400 hover:text-[#1B3A5C] cursor-pointer transition-colors flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              Selecionar
            </button>
          ) : (
            <>
              <button onClick={toggleSelectAll}
                className="text-[10px] font-bold uppercase cursor-pointer transition-colors flex items-center gap-1 px-2 py-1 rounded"
                style={{ color: '#1B3A5C', background: '#EEF4FF' }}>
                {selectedIds.size === contratos.length ? (
                  <><CheckCircleIcon className="w-3 h-3" aria-hidden="true" /> Desmarcar Todos</>
                ) : (
                  <><span className="w-3 h-3 border-[1.5px] border-current rounded-sm" aria-hidden="true" /> Selecionar Todos</>
                )}
              </button>
              <span className="text-[10px] text-gray-400 font-bold">
                {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
              </span>
              {selectedIds.size > 0 && (
                <button onClick={handleBulkArchive} disabled={deleting}
                  className="text-[10px] font-bold uppercase cursor-pointer transition-colors flex items-center gap-1 px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  title="Arquivar contratos selecionados (reversivel pelo admin)">
                  <ArchiveBoxIcon className="w-3 h-3" aria-hidden="true" />
                  {deleting ? 'Arquivando...' : 'Arquivar Selecionados'}
                </button>
              )}
              <button onClick={cancelSelection}
                className="text-[10px] font-bold uppercase text-gray-400 hover:text-gray-600 cursor-pointer ml-auto">
                Cancelar
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mx-3 md:mx-4 mt-3">
          <ErrorState
            inline
            icon={<ExclamationTriangleIcon className="w-4 h-4" aria-hidden="true" />}
            title='Nao foi possivel carregar contratos'
            message='Verifique sua conexao ou tente novamente.'
            suggestion='Se o problema persistir, recarregue a pagina.'
            onRetry={() => { setError(''); fetchContratos(); }}
          />
        </div>
      )}

      {/* Results */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto bg-gray-50">
        {loading && contratos.length === 0 ? (
          <SkeletonContratosTab />
        ) : contratos.length === 0 ? (
          // (#68) Empty state com CTA contextual: distingue "sem contratos" vs "filtros sem match"
          (() => {
            const hasFilters = !!(debouncedSearch || filterStatus || showArquivados);
            return (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 px-4">
                <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {hasFilters ? (
                  <>
                    <p className="text-sm font-medium text-gray-600">Nenhum contrato corresponde aos filtros</p>
                    <p className="text-xs mt-1 text-gray-400 mb-4">Tente ajustar a busca, status ou arquivados.</p>
                    <button
                      onClick={() => { setSearch(''); setFilterStatus(''); setShowArquivados(false); }}
                      className="btn-outline btn-press btn-ripple text-xs px-4 py-2"
                    >
                      Limpar filtros
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-600">Voce ainda nao tem contratos salvos</p>
                    <p className="text-xs mt-1 text-gray-400 mb-4">Crie seu primeiro contrato para comecar.</p>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('cbc:switchTab', { detail: { tab: 'novo' } }))}
                      className="btn-primary btn-press btn-ripple text-xs px-4 py-2"
                    >
                      Criar primeiro contrato
                    </button>
                  </>
                )}
              </div>
            );
          })()
        ) : viewMode === 'kanban' ? (
          <KanbanView contratos={contratos} onCardClick={(id) => { setViewMode('list'); handleViewDetail(id); }} />
        ) : viewMode === 'cards' ? (
          <CardsView contratos={contratos} onCardClick={(id) => { setViewMode('list'); handleViewDetail(id); }} />
        ) : (
          <div className="dense-card md:p-4" style={{ padding: 'var(--cbc-pad-card)' }}>
            {/* (perf-fe-1) avaliado: NAO virtualizado — linhas expansiveis de altura
                variavel; infinite scroll (IntersectionObserver) ja limita o DOM por chunk. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cbc-gap)' }}>
            {contratos.map(c => (
              <div key={c.id} className={`bg-white rounded-xl shadow-sm border transition-all card-elevated-tap ${
                selectedIds.has(c.id) ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100 hover:shadow-md hover:border-gray-200'
              }`}>
                {/* (perf-fe-2) Cartao colapsado extraido p/ ContratoRow (React.memo) — so
                    a linha cujas props mudam re-renderiza. Props primitivas/estaveis. */}
                <ContratoRow
                  contract={c}
                  isSelected={selectedIds.has(c.id)}
                  isExpanded={selectedId === c.id}
                  selectionMode={selectionMode}
                  onToggleSelect={toggleSelect}
                  onViewDetail={handleViewDetail}
                />

                {selectedId === c.id && detail && (
                  <div className="border-t border-gray-100 bg-white p-4 md:p-5 space-y-4">
                    {/* (#97, #327) Quem mais esta vendo este contrato */}
                    {currentUser && (
                      <PresenceIndicator topic={`contrato:${detail.id}`} currentUserEmail={currentUser.email} mode="viewing" />
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">Contratante 1</span>
                        <p className="text-gray-700">{detail.nome_contratante1}</p>
                        <p className="text-gray-500 break-all">{detail.cpf_contratante1} | {detail.email_contratante1}</p>
                      </div>
                      {detail.nome_contratante2 && (
                        <div>
                          <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">Contratante 2</span>
                          <p className="text-gray-700">{detail.nome_contratante2}</p>
                          <p className="text-gray-500 break-all">{detail.cpf_contratante2} | {detail.email_contratante2}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">Resort</span>
                        <p className="text-gray-700">{detail.resort}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">Tipo de Acao</span>
                        <p className="text-gray-700">{detail.tipo_acao}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">Honorarios Iniciais</span>
                        <p className="text-gray-700">
                          {detail.dados?.honorarios?.somenteExito
                            ? 'Sem honorarios iniciais'
                            : detail.honorarios_total > 0
                              ? `${formatCurrency(detail.honorarios_total)} em ${detail.honorarios_parcelas === 1 ? 'a vista' : `${detail.honorarios_parcelas}x de ${formatCurrency(detail.honorarios_valor_parcela)}`}`
                              : 'Sem honorarios iniciais'}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">Honorarios de Exito</span>
                        <p className="text-gray-700">
                          {detail.dados?.honorarios?.somenteIniciais
                            ? 'Sem honorarios de exito'
                            : detail.honorarios_percentual_exito > 0
                              ? `${detail.honorarios_percentual_exito}%`
                              : 'Sem honorarios de exito'}
                        </p>
                      </div>
                      {detail.created_by && (
                        <div>
                          <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">Criado por</span>
                          <p className="text-gray-700">{detail.created_by}</p>
                        </div>
                      )}
                      {detail.updated_by && detail.updated_by !== detail.created_by && (
                        <div>
                          <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">Atualizado por</span>
                          <p className="text-gray-700">{detail.updated_by}</p>
                        </div>
                      )}
                      {detail.zapsign_doc_token && (
                        <div className="col-span-1 md:col-span-2">
                          <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wide">ZapSign Token</span>
                          <p className="text-gray-700 font-mono text-[11px] break-all">{detail.zapsign_doc_token}</p>
                        </div>
                      )}
                    </div>

                    {/* Signing links — only show when sent but not yet fully signed */}
                    {detail.zapsign_links && detail.zapsign_links.length > 0 && detail.status !== 'assinado' && (
                      <div className="p-3 rounded-lg space-y-2" style={{ background: '#EEF4FF', border: '1px solid #C0D0E8' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#1B3A5C' }}>
                            Links de Assinatura
                          </span>
                          <CopyButton
                            text={detail.zapsign_links.map(s => `${s.name}: ${s.sign_url}`).join('\n')}
                            label="Copiar Todos"
                          />
                        </div>
                        <div className="space-y-1.5">
                          {detail.zapsign_links.map((signer, i) => (
                            <div key={i} className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] font-bold" style={{ color: '#1B3A5C' }}>
                                    {signer.name || `Contratante ${i + 1}`}
                                  </span>
                                  {signer.doc_type && (
                                    <span className="text-[11px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                      {signer.doc_type}
                                    </span>
                                  )}
                                  {signer.status && (
                                    <span className={`text-[11px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                                      signer.status === 'signed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {signer.status === 'signed' ? 'Assinado' : 'Pendente'}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-blue-700 truncate mt-0.5">{signer.sign_url}</p>
                              </div>
                              <CopyButton text={signer.sign_url} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Show links even when signed, for reference */}
                    {detail.zapsign_links && detail.zapsign_links.length > 0 && detail.status === 'assinado' && (
                      <div className="p-3 rounded-lg" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-green-700">
                          Contrato assinado por {detail.zapsign_links.length} signatario{detail.zapsign_links.length > 1 ? 's' : ''}
                        </span>
                        <div className="mt-1.5 space-y-1">
                          {detail.zapsign_links.map((signer, i) => (
                            <div key={i} className="text-[10px] text-green-800">
                              {signer.name || `Contratante ${i + 1}`}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Alerta: pasta do Drive nao atribuida (bloqueia automacoes) */}
                    {!detail.dados?.linkGoogleDrive && (
                      <div className="bg-yellow-50 border border-yellow-300 p-3 rounded-lg my-2 flex items-start gap-3">
                        <ExclamationTriangleIcon className="w-5 h-5 text-yellow-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-yellow-800">Pasta Google Drive nao atribuida</div>
                          <div className="text-xs text-yellow-700 mt-1">
                            As automacoes de upload nao rodam ate voce atribuir uma pasta do Drive.
                          </div>
                        </div>
                        <button
                          onClick={() => setDriveFolderModalContractId(detail.id)}
                          className="btn-primary text-xs px-3 py-1.5 font-bold uppercase rounded-lg text-white cursor-pointer inline-flex items-center gap-1 shrink-0"
                          style={{ background: '#1B3A5C' }}
                        >
                          <FolderPlusIcon className="w-3.5 h-3.5" aria-hidden="true" />
                          Atribuir pasta
                        </button>
                      </div>
                    )}

                    {/* Alerta: upload Drive falhou (depois de max attempts OU erro deterministico) */}
                    {detail.drive_file_id === 'failed' && (
                      <div className="bg-red-50 border border-red-300 p-3 rounded-lg my-2 flex items-start gap-3">
                        <XCircleIcon className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-red-800">Upload Drive falhou</div>
                          <div className="text-xs text-red-700 mt-1 break-words">
                            <span className="font-mono bg-red-100 px-1 py-0.5 rounded text-[10px]">
                              {detail.drive_error_code || 'GENERIC'}
                            </span>
                            {' '}
                            &mdash; {detail.drive_failed_reason || detail.drive_last_error || 'Erro desconhecido'}
                          </div>
                          {detail.drive_attempts > 0 && (
                            <div className="text-[11px] text-red-700 mt-1">
                              {detail.drive_attempts} tentativa(s) &middot; ultima: {detail.drive_last_attempt_at ? new Date(detail.drive_last_attempt_at).toLocaleString('pt-BR') : '—'}
                            </div>
                          )}
                          {detail.drive_error_code === 'FOLDER_NOT_FOUND' && (
                            <div className="text-xs text-red-600 mt-2">
                              A pasta do Drive nao foi encontrada ou o script nao tem acesso. Troque a pasta e tente novamente.
                            </div>
                          )}
                          {detail.drive_error_code === 'NO_PERMISSION' && (
                            <div className="text-xs text-red-600 mt-2">
                              O Apps Script nao tem permissao de editor na pasta. Compartilhe e tente de novo.
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            onClick={() => setDriveFolderModalContractId(detail.id)}
                            className="btn-primary text-xs px-3 py-1 font-bold uppercase rounded-lg text-white cursor-pointer inline-flex items-center gap-1"
                            style={{ background: '#1B3A5C' }}
                          >
                            <FolderIcon className="w-3 h-3" aria-hidden="true" />
                            Trocar pasta
                          </button>
                          <button
                            onClick={() => handleResetDriveRetry(detail.id)}
                            className="btn-outline text-xs px-3 py-1 font-bold uppercase rounded-lg cursor-pointer inline-flex items-center gap-1 border-2"
                            style={{ borderColor: '#DC2626', color: '#DC2626' }}
                          >
                            <ArrowPathIcon className="w-3 h-3" aria-hidden="true" />
                            Tentar de novo
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
                      {detail.dados && (
                        <button onClick={() => handleLoadContract(detail.dados, detail.id)}
                          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg text-white cursor-pointer"
                          style={{ background: '#1B3A5C' }}>Carregar no Formulario</button>
                      )}
                      {/* (#215) Lembrar-me sobre este contrato */}
                      {currentUser && (
                        <button onClick={() => setReminderFor({ id: detail.id, nome: detail.nome_contratante1 })}
                          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer border-2 border-amber-300 text-amber-700 hover:bg-amber-50 inline-flex items-center gap-1">
                          <BellAlertIcon className="w-3 h-3" aria-hidden="true" />
                          Lembrar-me
                        </button>
                      )}
                      {detail.status === 'assinado' && (
                        <span className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg flex items-center gap-1 ${
                          detail.advbox_status === 'ok' ? 'bg-green-100 text-green-700' :
                          detail.advbox_status === 'processing' ? 'bg-blue-100 text-blue-600' :
                          detail.advbox_status === 'error' ? 'bg-red-100 text-red-600' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {detail.advbox_status === 'ok' ? (<><CheckIcon className="w-3 h-3" aria-hidden="true" /> ADVBOX Sincronizado</>) :
                           detail.advbox_status === 'processing' ? (<><ClockIcon className="w-3 h-3" aria-hidden="true" /> ADVBOX Processando...</>) :
                           detail.advbox_status === 'error' ? (<><XMarkIcon className="w-3 h-3" aria-hidden="true" /> ADVBOX Erro</>) :
                           (<><ClockIcon className="w-3 h-3" aria-hidden="true" /> ADVBOX Pendente</>)}
                        </span>
                      )}
                      {/* (QW#12) retry manual do ADVBOX direto no contrato quando deu erro
                          ou ficou pendente — reaproveita o AdvboxSyncButton (antes nao era usado) */}
                      {detail.status === 'assinado' && (detail.advbox_status === 'error' || !detail.advbox_status) && detail.dados && (
                        <AdvboxSyncButton dados={detail.dados} contractId={detail.id} dataAssinatura={detail.signed_at ? String(detail.signed_at).split('T')[0] : undefined} existingLawsuitId={detail.advbox_lawsuit_id} existingCustomers={detail.advbox_data?.customers} />
                      )}
                      {detail.status === 'assinado' && detail.zapsign_doc_token && detail.dados?.linkGoogleDrive && (
                        <SaveToDriveButton
                          contract={detail}
                          onRequestDestructiveConfirm={onRequestDestructiveConfirm}
                          onShowToast={showToast}
                        />
                      )}
                      {/* Botao "Trocar pasta" sempre disponivel quando ja ha pasta (permite corrigir antes de falhar) */}
                      {detail.status === 'assinado' && detail.dados?.linkGoogleDrive && detail.drive_file_id !== 'failed' && (
                        <button
                          onClick={() => setDriveFolderModalContractId(detail.id)}
                          title="Trocar pasta do Drive"
                          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg cursor-pointer border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1"
                        >
                          <FolderIcon className="w-3 h-3" aria-hidden="true" />
                          Trocar pasta
                        </button>
                      )}
                      {/* (audit) Acoes de arquivamento — substitui o antigo "Excluir".
                          - Contrato ATIVO: botao "Arquivar" (soft delete, reversivel).
                          - Contrato ARQUIVADO + admin: botoes "Desarquivar" + "Deletar permanentemente". */}
                      {!c.arquivado_em ? (
                        <button onClick={() => handleArchive(c.id)}
                          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg text-amber-700 border border-amber-300 hover:bg-amber-50 cursor-pointer inline-flex items-center gap-1"
                          title="Arquivar contrato (reversivel pelo admin)">
                          <ArchiveBoxIcon className="w-3 h-3" aria-hidden="true" />
                          Arquivar
                        </button>
                      ) : (
                        <>
                          {isAdmin && (
                            <button onClick={() => doUnarchiveContract(c.id)}
                              className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg text-sky-700 border border-sky-300 hover:bg-sky-50 cursor-pointer inline-flex items-center gap-1"
                              title="Desarquivar contrato (admin)">
                              <ArchiveBoxXMarkIcon className="w-3 h-3" aria-hidden="true" />
                              Desarquivar
                            </button>
                          )}
                          {isAdmin && (
                            <button onClick={() => handleHardDelete(c.id)}
                              className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg text-red-600 border border-red-200 hover:bg-red-50 cursor-pointer inline-flex items-center gap-1"
                              title="Deletar permanentemente (admin, irreversivel)">
                              <TrashIcon className="w-3 h-3" aria-hidden="true" />
                              Excluir permanente
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* (#99) Comentarios internos */}
                    {currentUser && (
                      <ContractComments
                        contratoId={detail.id}
                        currentUserId={currentUser.id}
                        currentUserEmail={currentUser.email}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
            </div>
          </div>
        )}

        {/* (pagination fix 23/05/2026) Sentinel do infinite scroll movido para FORA
            do ternario viewMode — agora funciona nos 3 modos: list, cards, kanban.
            IntersectionObserver com root=scrollContainerRef dispara loadMore. */}
        {hasMore && !loading && contratos.length > 0 && (
          <div ref={sentinelRef} className="py-6 text-center text-[11px] font-bold uppercase tracking-wide text-gray-500 tabular-nums">
            {loadingMore ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-2">
                  <ArrowPathIcon className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Carregando mais...</span>
                </div>
                {/* Skeletons inline (3 linhas) — feedback visual coerente com Skeleton.jsx */}
                <div className="space-y-2 mt-2 px-4">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                      <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
                      <div className="h-2 bg-gray-100 rounded w-1/3" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <span>Mostrando {contratos.length} de {totalCount} — role para carregar mais</span>
            )}
          </div>
        )}
      </div>

      {/* Footer: contador (paginacao real e via infinite scroll) */}
      <div className="p-2 md:p-3 border-t border-gray-100 bg-white">
        <div className="text-center">
          <span className="text-[11px] text-gray-500 uppercase tabular-nums">
            {totalCount > 0 ? (
              <>
                {contratos.length} de {totalCount} contrato{totalCount !== 1 ? 's' : ''}
                {!hasMore && contratos.length > 0 && ' (todos carregados)'}
              </>
            ) : (
              <>{contratos.length} contrato{contratos.length !== 1 ? 's' : ''} encontrado{contratos.length !== 1 ? 's' : ''}</>
            )}
          </span>
        </div>
      </div>

      {/* Modal: atribuir/trocar pasta do Google Drive */}
      {driveFolderModalContractId != null && (() => {
        const c = (detail && detail.id === driveFolderModalContractId)
          ? detail
          : contratos.find(x => x.id === driveFolderModalContractId);
        if (!c) return null;
        return (
          <DriveFolderModal
            contract={c}
            onClose={() => setDriveFolderModalContractId(null)}
            onSaved={handleDriveFolderSaved}
          />
        );
      })()}

      {/* Toast local (feedback de Drive upload/retry) */}
      <LocalToast toast={toast} onDismiss={() => setToast(null)} />

      {/* (audit) Modal opcional de motivo do arquivamento */}
      <ArchiveReasonModal modal={archiveModal} onCancel={() => setArchiveModal(null)} />

      {/* (import) Modal de importacao manual de contrato assinado */}
      {importModalOpen && (
        <ImportContratoModal
          onClose={() => setImportModalOpen(false)}
          onImported={(contractId) => {
            setImportModalOpen(false);
            setImportToast('Contrato importado com sucesso!');
            setTimeout(() => setImportToast(''), 5000);
            fetchContratos();
            // Auto-expand do contrato importado para facilitar revisao
            if (contractId) {
              setSelectedId(contractId);
            }
          }}
        />
      )}

      {/* (import) Toast de sucesso de import */}
      {importToast && (
        <div
          className="toast-above-dock fixed bottom-6 right-6 z-[110] px-4 py-2.5 rounded-lg shadow-xl text-sm font-bold flex items-center gap-2 animate-[fadeIn_0.2s_ease]"
          style={{ background: '#16A34A', color: '#FFFFFF' }}
          role="status"
        >
          <CheckCircleIcon className="w-4 h-4" aria-hidden="true" />
          {importToast}
        </div>
      )}

      {/* (#215) Modal de lembrete parametrizavel */}
      {reminderFor && currentUser && (
        <ReminderModal
          contratoId={reminderFor.id}
          contratoNome={reminderFor.nome}
          userEmail={currentUser.email}
          onClose={() => setReminderFor(null)}
        />
      )}
    </div>
  );
}
