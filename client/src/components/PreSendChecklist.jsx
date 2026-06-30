import { useState, useEffect, useMemo } from 'react';
import { useContract } from '../ContractContext';
import { formatCurrency } from '../utils/extenso';
import { validateCNPJ } from '../utils/validation';
import {
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon,
  InformationCircleIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';

// ─── Email MX verification (lightweight check) ───
async function verifyEmailMX(email) {
  if (!email || !email.includes('@')) return { valid: false, reason: 'Email invalido' };
  // Use a free DNS API to check MX records
  const domain = email.split('@')[1];
  try {
    const resp = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
    const data = await resp.json();
    if (data.Answer && data.Answer.length > 0) return { valid: true };
    if (data.Status === 3) return { valid: false, reason: `Dominio ${domain} nao existe` };
    return { valid: false, reason: `Dominio ${domain} nao recebe emails` };
  } catch {
    // (ux-16) consulta externa falhou: estado NEUTRO, nao marcar como aprovado
    return { unknown: true, reason: 'Nao foi possivel verificar (sem conexao com o DNS)' };
  }
}

// ─── CEP vs City verification ───
async function verifyCEPCity(cep, city, uf) {
  if (!cep || cep.replace(/\D/g, '').length !== 8) return null;
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${cep.replace(/\D/g, '')}/json/`);
    const data = await resp.json();
    if (data.erro) return { match: false, reason: 'CEP nao encontrado' };
    const cepCity = (data.localidade || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const inputCity = (city || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const cepUf = (data.uf || '').toUpperCase();
    const inputUf = (uf || '').toUpperCase();
    const cityMatch = cepCity === inputCity;
    const ufMatch = cepUf === inputUf;
    if (!cityMatch || !ufMatch) {
      return { match: false, reason: `CEP corresponde a ${data.localidade}/${data.uf}, mas foi preenchido ${city}/${uf}` };
    }
    return { match: true };
  } catch {
    // (ux-16) consulta externa falhou: estado NEUTRO, nao marcar como conferido
    return { unknown: true, reason: 'Nao foi possivel verificar (sem conexao com o ViaCEP)' };
  }
}

function CheckItem({ label, status, detail, severity = 'error' }) {
  const icons = {
    pass: <CheckIcon className="w-4 h-4 text-green-500" aria-hidden="true" />,
    fail: <XMarkIcon className={`w-4 h-4 ${severity === 'warning' ? 'text-amber-500' : 'text-red-500'}`} aria-hidden="true" />,
    loading: <ArrowPathIcon className="w-4 h-4 text-blue-500 animate-spin" aria-hidden="true" />,
    info: <InformationCircleIcon className="w-4 h-4 text-blue-500" aria-hidden="true" />,
    // (ux-16) estado neutro: consulta externa falhou, nem aprovado nem reprovado
    unknown: <QuestionMarkCircleIcon className="w-4 h-4 text-gray-400" aria-hidden="true" />,
  };
  const bgMap = {
    pass: 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800',
    fail: severity === 'warning' ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800',
    loading: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800',
    info: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800',
    // (ux-16) estado neutro: cinza, sem cor de aprovacao/erro
    unknown: 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700',
  };

  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg border ${bgMap[status]}`}>
      <span className="shrink-0 mt-0.5 w-5 text-center">{icons[status]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold text-gray-800 dark:text-gray-200">{label}</div>
        {detail && <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{detail}</div>}
      </div>
    </div>
  );
}

export default function PreSendChecklist({ issues, onProceed, onClose }) {
  const { data } = useContract();
  const [emailChecks, setEmailChecks] = useState({});
  const [cepChecks, setCepChecks] = useState({});
  const [reviewed, setReviewed] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const hasErrors = issues.length > 0;
  const num = data.numContratantes || 0;

  // Run async checks on mount
  useEffect(() => {
    if (hasErrors) return;
    // Email MX checks
    for (let i = 0; i < num; i++) {
      const c = data.contratantes?.[i];
      if (c?.email) {
        setEmailChecks(prev => ({ ...prev, [i]: { status: 'loading' } }));
        verifyEmailMX(c.email).then(result => {
          setEmailChecks(prev => ({ ...prev, [i]: result }));
        });
      }
    }
    // CEP vs City checks
    for (let i = 0; i < num; i++) {
      const c = data.contratantes?.[i];
      if (c?.cep && c?.cidade) {
        setCepChecks(prev => ({ ...prev, [i]: { status: 'loading' } }));
        verifyCEPCity(c.cep, c.cidade, c.uf).then(result => {
          setCepChecks(prev => ({ ...prev, [i]: result }));
        });
      }
    }
  }, []);

  // Build comprehensive check list
  const checks = useMemo(() => {
    if (hasErrors) return [];
    const list = [];

    for (let i = 0; i < num; i++) {
      const c = data.contratantes?.[i];
      const prefix = num > 1 ? `Contratante ${i + 1}` : 'Contratante';
      const isPJ = c?.tipo === 'pj';

      // (PJ 25/06) Bloco da empresa — razao social, CNPJ, e-mail da empresa (que assina no ZapSign)
      if (isPJ) {
        list.push({ label: `${prefix}: Razao social`, status: c?.razaoSocial?.trim() ? 'pass' : 'fail', detail: c?.razaoSocial || 'Nao preenchida' });
        const cnpjOk = validateCNPJ(c?.cnpj || '');
        list.push({ label: `${prefix}: CNPJ`, status: cnpjOk ? 'pass' : 'fail', detail: cnpjOk ? c.cnpj : (c?.cnpj ? 'CNPJ invalido' : 'Nao preenchido') });
        list.push({ label: `${prefix}: E-mail da empresa (assina)`, status: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c?.emailEmpresa || '') ? 'pass' : 'fail', detail: c?.emailEmpresa || 'Nao preenchido — o convite ZapSign vai para este e-mail' });
      }

      const quemNome = isPJ ? 'Nome do representante' : 'Nome completo';
      // Name check (>= 2 words)
      const nameWords = (c?.nome || '').trim().split(/\s+/).length;
      list.push({
        label: `${prefix}: ${quemNome}`,
        status: nameWords >= 2 ? 'pass' : 'fail',
        detail: nameWords < 2 ? 'Nome parece incompleto. Verifique se incluiu nome e sobrenome.' : c.nome,
      });

      // CPF
      list.push({ label: `${prefix}: CPF${isPJ ? ' do representante' : ''}`, status: c?.cpf ? 'pass' : 'fail', detail: c?.cpf || 'Nao preenchido' });

      // Email MX
      const emCheck = emailChecks[i];
      list.push({
        label: `${prefix}: Email verificado`,
        // (ux-16) unknown = consulta externa falhou, estado neutro (cinza), nao conta como ok
        status: !emCheck ? 'loading' : emCheck.status === 'loading' ? 'loading' : emCheck.unknown ? 'unknown' : emCheck.valid ? 'pass' : 'fail',
        detail: emCheck?.reason || c?.email || '',
        severity: 'warning',
      });

      // CEP vs City
      const cCheck = cepChecks[i];
      if (cCheck !== undefined && cCheck !== null) {
        list.push({
          label: `${prefix}: CEP corresponde a cidade`,
          // (ux-16) unknown = consulta externa falhou, estado neutro (cinza), nao conta como ok
          status: !cCheck ? 'loading' : cCheck.status === 'loading' ? 'loading' : cCheck.unknown ? 'unknown' : cCheck.match ? 'pass' : 'fail',
          detail: cCheck?.reason || 'CEP e cidade conferem',
          severity: 'warning',
        });
      }

      // Celular
      list.push({ label: `${prefix}: Celular`, status: (c?.telefone || '').replace(/\D/g, '').length >= 10 ? 'pass' : 'fail', detail: c?.telefone || 'Nao preenchido' });

      // Link Kommo (obrigatorio)
      list.push({ label: `${prefix}: Link Kommo`, status: c?.linkKommo?.startsWith('http') ? 'pass' : 'fail', detail: c?.linkKommo?.startsWith('http') ? 'OK' : 'Obrigatorio (cole a URL da conversa Kommo)' });
    }

    // Resort
    const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
    list.push({ label: 'Resort/Empreendimento', status: resort ? 'pass' : 'fail', detail: resort || 'Nao selecionado' });

    // Tipo de acao
    const tipo = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
    list.push({ label: 'Tipo de acao', status: tipo ? 'pass' : 'fail', detail: tipo || 'Nao selecionado' });

    // Honorarios
    const h = data.honorarios;
    if (h.somenteExito) {
      list.push({ label: 'Honorarios: Somente exito', status: h.percentualExito > 0 ? 'pass' : 'fail', detail: `${h.percentualExito}%` });
    } else if (h.somenteIniciais) {
      list.push({ label: 'Honorarios: Somente iniciais', status: h.total > 0 ? 'pass' : 'fail', detail: formatCurrency(h.total) });
    } else {
      list.push({ label: 'Honorarios fixos', status: h.total > 0 ? 'pass' : 'fail', detail: `${formatCurrency(h.total)} em ${h.parcelas}x` });
      list.push({ label: 'Honorarios de exito', status: h.percentualExito > 0 ? 'pass' : 'fail', detail: `${h.percentualExito}%` });
    }

    // Origem
    list.push({ label: 'Origem do cliente', status: data.origemCliente ? 'pass' : 'fail', detail: data.origemCliente || 'Nao informada', severity: 'warning' });

    return list;
  }, [data, emailChecks, cepChecks, hasErrors, num]);

  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'fail' && c.severity === 'warning').length;
  const errorCount = failCount - warnCount;
  const loadingCount = checks.filter(c => c.status === 'loading').length;
  // (ux-16) verificacoes externas que nao puderam ser feitas (neutro) nao podem virar "Tudo OK"
  const unknownCount = checks.filter(c => c.status === 'unknown').length;
  const allPassed = failCount === 0 && unknownCount === 0 && !hasErrors;
  const canProceed = errorCount === 0 && !hasErrors && loadingCount === 0;

  // Review summary data
  const reviewData = useMemo(() => {
    const c1 = data.contratantes?.[0] || {};
    const c2 = num > 1 ? data.contratantes?.[1] || {} : null;
    const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
    const tipo = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;
    const h = data.honorarios;
    return { c1, c2, resort, tipo, h, num };
  }, [data, num]);

  return (
    <div className="fixed inset-0 modal-backdrop-glass z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-glass rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="text-white text-center py-3 px-5 shrink-0"
          style={{ background: hasErrors ? '#DC2626' : allPassed ? '#16A34A' : '#D97706' }}>
          <div className="text-[13px] font-bold uppercase tracking-[1px]">
            {hasErrors ? 'Campos Obrigatorios Pendentes' : allPassed ? 'Verificacao Completa' : 'Verificacao Pre-Envio'}
          </div>
          <div className="text-[11px] opacity-80 mt-0.5">
            {hasErrors
              ? `${issues.length} campo(s) obrigatorio(s) faltando`
              /* (ux-16) unknown = verificacao externa nao realizada; nao anunciar "Tudo OK" */
              : `${checks.length} verificacoes | ${failCount > 0 ? `${warnCount} aviso(s)` : unknownCount > 0 ? `${unknownCount} nao verificado(s)` : 'Tudo OK'}`}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {hasErrors ? (
            <div className="space-y-1.5">
              {issues.map((issue, i) => (
                <CheckItem key={i} label={issue.msg} status="fail" />
              ))}
            </div>
          ) : showReview ? (
            /* ─── Revisão Final Obrigatória ─── */
            <div className="space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 text-center mb-2">
                Revisao Final — Confira todos os dados
              </div>

              {/* Contratante 1 */}
              <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Contratante 1</div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div><span className="text-gray-400">Nome:</span> <strong>{reviewData.c1.nome}</strong></div>
                  <div><span className="text-gray-400">CPF:</span> <strong>{reviewData.c1.cpf}</strong></div>
                  <div><span className="text-gray-400">RG:</span> <strong>{reviewData.c1.rg}</strong></div>
                  <div><span className="text-gray-400">Email:</span> <strong>{reviewData.c1.email}</strong></div>
                  <div><span className="text-gray-400">Celular:</span> <strong>{reviewData.c1.telefone}</strong></div>
                  <div><span className="text-gray-400">Profissao:</span> <strong>{reviewData.c1.profissao}</strong></div>
                  <div className="col-span-2"><span className="text-gray-400">Endereco:</span> <strong>{reviewData.c1.endereco}{reviewData.c1.numero ? `, ${reviewData.c1.numero}` : ''} — {reviewData.c1.cidade}/{reviewData.c1.uf}</strong></div>
                </div>
              </div>

              {/* Contratante 2 */}
              {reviewData.c2 && (
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Contratante 2</div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div><span className="text-gray-400">Nome:</span> <strong>{reviewData.c2.nome}</strong></div>
                    <div><span className="text-gray-400">CPF:</span> <strong>{reviewData.c2.cpf}</strong></div>
                    <div><span className="text-gray-400">Email:</span> <strong>{reviewData.c2.email}</strong></div>
                    <div><span className="text-gray-400">Celular:</span> <strong>{reviewData.c2.telefone}</strong></div>
                  </div>
                </div>
              )}

              {/* Ação e Honorários */}
              <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Contrato</div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div><span className="text-gray-400">Resort:</span> <strong>{reviewData.resort}</strong></div>
                  <div><span className="text-gray-400">Acao:</span> <strong>{reviewData.tipo}</strong></div>
                  {!reviewData.h.somenteExito && (
                    <div><span className="text-gray-400">Honorarios:</span> <strong>{formatCurrency(reviewData.h.total)} em {reviewData.h.parcelas}x</strong></div>
                  )}
                  {!reviewData.h.somenteIniciais && (
                    <div><span className="text-gray-400">Exito:</span> <strong>{reviewData.h.percentualExito}%</strong></div>
                  )}
                </div>
              </div>

              {/* Confirmação */}
              <label className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 cursor-pointer">
                <input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#1B3A5C] cursor-pointer" />
                <span className="text-[11px] font-bold text-amber-800 dark:text-amber-200">
                  Confirmo que revisei todos os dados e estao corretos
                </span>
              </label>
            </div>
          ) : (
            /* ─── Checklist Visual ─── */
            <div className="space-y-1.5">
              {checks.map((check, i) => (
                <CheckItem key={i} {...check} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2 shrink-0">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-500 font-bold text-xs uppercase cursor-pointer hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
            aria-label="Fechar">
            {hasErrors ? 'Corrigir' : 'Cancelar'}
          </button>
          {!hasErrors && !showReview && (
            <button onClick={() => setShowReview(true)} disabled={loadingCount > 0}
              className="flex-1 py-2.5 rounded-lg text-white font-bold text-xs uppercase cursor-pointer disabled:opacity-50"
              style={{ background: canProceed ? '#1B3A5C' : '#D97706' }}>
              {loadingCount > 0 ? 'Verificando...' : warnCount > 0 ? `Continuar (${warnCount} aviso${warnCount > 1 ? 's' : ''})` : 'Revisar e Enviar'}
            </button>
          )}
          {showReview && (
            <button onClick={onProceed} disabled={!reviewed}
              className="flex-1 py-2.5 rounded-lg text-white font-bold text-xs uppercase cursor-pointer disabled:opacity-40 transition-all flex items-center justify-center gap-1"
              style={{ background: reviewed ? '#16A34A' : '#9CA3AF' }}>
              {reviewed ? (<>Enviar para ZapSign <CheckIcon className="w-3.5 h-3.5" aria-hidden="true" /></>) : 'Confirme a revisao acima'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
