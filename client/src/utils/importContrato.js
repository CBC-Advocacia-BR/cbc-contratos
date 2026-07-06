// =============================================================
// importContrato.js — orquestra o fluxo de importacao manual
// =============================================================
// Fluxo:
//   1. Salva contrato no banco (com flag imported_manually=true)
//   2. (opcional) Cria cliente + processo no ADVBOX
//   3. (opcional) Faz upload dos PDFs no Google Drive
//   4. (opcional) Cria cobrancas no Asaas
//
// Cada step atualiza onProgress({ steps, current }) em tempo real.
// Em caso de erro num step, registra info e segue (nao aborta o fluxo).
//
// (chatguru removal 2026-05) step ChatGuru removido. Comunicacao
// com cliente agora e manual via link Kommo armazenado em
// contratante.linkKommo.
// =============================================================

import { supabase } from '../lib/supabase';

// Constroi o row para insert na tabela contratos.
// IMPORTANTE: usa as mesmas colunas flat do fluxo padrao (App.jsx::buildContratoRow).
function buildContractRow(data, userEmail) {
  const c1 = data.contratantes?.[0] || {};
  const c2 = data.numContratantes === 2 ? (data.contratantes?.[1] || {}) : {};
  const honorarios = data.honorarios || {};

  // Resolve resort/tipoAcao com fallback de "outro"
  const resort = data.resort === 'outro' ? data.resortCustom : data.resort;
  const tipoAcao = data.tipoAcao === 'outro' ? data.tipoAcaoCustom : data.tipoAcao;

  // dataAssinatura no formato YYYY-MM-DD para signed_at compativel
  const signedAt = data.dataAssinatura
    ? new Date(data.dataAssinatura + 'T12:00:00').toISOString()
    : new Date().toISOString();

  // Snapshot completo em "dados" (mesma estrategia do contrato normal)
  const dadosBlob = {
    ...data,
    importedManually: true,
    importedBy: userEmail,
    importedAt: new Date().toISOString(),
    contratantes: data.contratantes || [],
    honorarios,
    resort,
    tipoAcao,
  };

  return {
    nome_contratante1: c1.nome || '',
    cpf_contratante1: c1.cpf || '',
    email_contratante1: c1.email || '',
    nome_contratante2: c2.nome || null,
    cpf_contratante2: c2.cpf || null,
    email_contratante2: c2.email || null,
    resort: resort || '',
    tipo_acao: tipoAcao || '',
    honorarios_total: honorarios.somenteExito ? 0 : Number(honorarios.total || 0),
    honorarios_parcelas: honorarios.somenteExito ? 0 : Number(honorarios.parcelas || 0),
    honorarios_valor_parcela: honorarios.somenteExito
      ? 0
      : Number(honorarios.valorParcela || 0),
    honorarios_percentual_exito: honorarios.somenteIniciais
      ? 0
      : Number(honorarios.percentualExito || 0),
    data_primeira_parcela: honorarios.dataPrimeiraParcela || null,
    status: 'assinado',
    signed_at: signedAt,
    // Flags de import manual (colunas criadas em supabase_audit_import.sql)
    imported_manually: true,
    imported_by: userEmail || null,
    imported_at: new Date().toISOString(),
    dados: dadosBlob,
    created_by: userEmail || null,
    updated_by: userEmail || null,
  };
}

export async function processImport({
  data,
  anexos,
  automacoes,
  userEmail,
  onProgress,
}) {
  // Monta lista de steps na ordem de execucao
  const steps = [];
  steps.push({ key: 'salvar', label: 'Salvando contrato no banco', status: 'pending' });
  if (automacoes.advbox) {
    steps.push({
      key: 'advbox',
      label: 'ADVBOX: criando cliente + processo',
      status: 'pending',
    });
  }
  if (automacoes.drive) {
    steps.push({
      key: 'drive',
      label: 'Google Drive: upload dos PDFs',
      status: 'pending',
    });
  }
  if (automacoes.asaas) {
    steps.push({
      key: 'asaas',
      label: 'Asaas: criando cobrancas',
      status: 'pending',
    });
  }
  // (chatguru removal) step ChatGuru removido

  // Helper para atualizar status de um step e notificar UI
  const updateStep = (key, status, info) => {
    const idx = steps.findIndex((s) => s.key === key);
    if (idx >= 0) {
      steps[idx] = { ...steps[idx], status, info };
      onProgress({ steps, current: idx });
    }
  };

  onProgress({ steps, current: -1 });

  // ─── STEP 1: salvar contrato no banco ───
  updateStep('salvar', 'running');
  let created;
  try {
    const row = buildContractRow(data, userEmail);
    const { data: insertedRow, error: insErr } = await supabase
      .from('contratos')
      .insert(row)
      .select()
      .single();
    if (insErr) throw insErr;
    created = insertedRow;
    updateStep('salvar', 'ok', `id=${created.id.substring(0, 8)}...`);
  } catch (err) {
    updateStep('salvar', 'error', err.message || 'erro ao salvar');
    // Sem contrato salvo, nao tem sentido seguir
    return { contractId: null, steps, error: err.message };
  }

  // ─── STEP 2: ADVBOX ───
  if (automacoes.advbox) {
    updateStep('advbox', 'running');
    try {
      const advboxPayload = {
        contratantes: data.contratantes,
        numContratantes: data.numContratantes,
        tipoAcao: data.tipoAcao,
        tipoAcaoCustom: data.tipoAcaoCustom,
        origemCliente: data.origemCliente,
        dataAssinatura: data.dataAssinatura,
        dataPrimeiraMensagem: data.dataPrimeiraMensagem || null,
        honorarios: data.honorarios,
        user_email: userEmail,
        observacoesInternas: data.observacoesInternas || '',
        escritorioArcaCustas: data.escritorioArcaCustas || false,
        resort: data.resort,
        resortCustom: data.resortCustom,
        linkGoogleDrive: data.linkGoogleDrive || null,
      };
      const resp = await fetch('/.netlify/functions/advbox-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(advboxPayload),
      });
      const json = await resp.json();
      if (!json.success) {
        throw new Error(json.warnings?.join(', ') || json.error || 'erro ADVBOX');
      }
      // (varredura 15/06) so marca 'ok' se cliente E processo foram criados — igual
      // ao polling (App.jsx) e ao retry manual. Antes marcava 'ok' mesmo sem lawsuit,
      // entao um import com cliente-ok-mas-processo-falho ficava 'ok' e nunca era
      // reprocessado (contrato sem processo no ADVBOX, sem ninguem saber).
      // (#6) so 'ok' se TODOS os contratantes viraram cliente (customersComplete), nao so >0.
      const advOk = json.success && json.customersComplete && !!json.lawsuit?.id;
      await supabase
        .from('contratos')
        .update({
          advbox_status: advOk ? 'ok' : 'error',
          advbox_date: new Date().toISOString(),
          advbox_data: json,
          advbox_lawsuit_id: json.lawsuit?.id || null,
          import_advbox_customer_id: json.customers?.[0]?.id?.toString() || null,
          import_advbox_lawsuit_id: json.lawsuit?.id?.toString() || null,
        })
        .eq('id', created.id);
      const customers = json.customers?.length || 0;
      const lawsuit = json.lawsuit?.id ? `lawsuit=${json.lawsuit.id}` : 'sem processo';
      updateStep('advbox', advOk ? 'ok' : 'error', `${customers} cliente(s), ${lawsuit}`);
    } catch (err) {
      updateStep('advbox', 'error', err.message || 'erro ADVBOX');
    }
  }

  // ─── STEP 3: Google Drive ───
  if (automacoes.drive) {
    updateStep('drive', 'running');
    try {
      const filesPayload = [];
      if (anexos?.contratoPdf?.base64) {
        filesPayload.push({
          name: 'CONTRATO ASSINADO.pdf',
          base64: anexos.contratoPdf.base64,
        });
      }
      if (anexos?.procuracaoPdf?.base64) {
        filesPayload.push({
          name: 'PROCURACAO ASSINADA.pdf',
          base64: anexos.procuracaoPdf.base64,
        });
      }
      if (filesPayload.length === 0) {
        throw new Error('nenhum PDF anexado');
      }
      const resp = await fetch('/.netlify/functions/save-to-drive-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driveFolderUrl: data.linkGoogleDrive,
          files: filesPayload,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error || 'erro Drive');
      }
      const firstFile = json.files?.[0];
      await supabase
        .from('contratos')
        .update({
          drive_file_id: firstFile?.fileId || 'saved',
          drive_file_link: firstFile?.fileUrl || null,
        })
        .eq('id', created.id);
      updateStep('drive', 'ok', `${json.files?.length || 0} arquivo(s)`);
    } catch (err) {
      updateStep('drive', 'error', err.message || 'erro Drive');
    }
  }

  // ─── STEP 4: Asaas ───
  if (automacoes.asaas) {
    updateStep('asaas', 'running');
    try {
      const honorarios = data.honorarios || {};
      const total = Number(honorarios.total || 0);
      const parcelas = Number(honorarios.parcelas || 0);
      if (total <= 0 || parcelas <= 0) {
        throw new Error('honorarios iniciais nao definidos');
      }
      const c1 = data.contratantes?.[0] || {};
      const resortNome = data.resort === 'outro' ? data.resortCustom : data.resort;
      // (#8) asaas-sync despacha por `action`; sem ele caia no default -> HTTP 400 "Invalid action"
      // e a etapa Asaas SEMPRE falhava no import. Forma esperada pelo case 'create-payment'
      // (mesma usada pelo LaunchBtn em AsaasPanel): { action, contratante, honorarios, contractId, resort }.
      const asaasPayload = {
        action: 'create-payment',
        contratante: {
          nome: c1.nome,
          cpf: (c1.cpf || '').replace(/\D/g, ''),
          email: c1.email,
          telefone: c1.telefone,
          endereco: c1.endereco,
          numero: c1.numero,
          bairro: c1.bairro,
          cidade: c1.cidade,
          uf: c1.uf,
          cep: c1.cep,
        },
        honorarios: { total, parcelas, dataPrimeiraParcela: honorarios.dataPrimeiraParcela },
        contractId: created.id,
        resort: resortNome,
      };
      const resp = await fetch('/.netlify/functions/asaas-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asaasPayload),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) {
        throw new Error(json.error || `HTTP ${resp.status}`);
      }
      // (anti-duplicidade 06/07/2026) servidor avisou que o cliente JA tem parcelamento
      // em aberto no Asaas. No import NAO forcamos: grava so o customer_id (evita orfao) e
      // marca a etapa como atencao p/ o operador resolver na aba Asaas.
      if (json.duplicate_warning) {
        if (json.customer?.id) {
          try {
            await supabase.from('contratos').update({ asaas_customer_id: json.customer.id }).eq('id', created.id);
          } catch { /* best-effort */ }
        }
        updateStep('asaas', 'error', 'cliente já tem parcelamento ativo — NÃO lançado (evitar duplicata). Resolver na aba Asaas.');
      } else {
        // (bug de origem corrigido 06/07/2026) PERSISTE o lancamento no contrato. Sem isto o
        // contrato importado ficava com asaas_status=null -> aparecia "Pendente" na aba Asaas e
        // podia ser lancado de novo (a trava #24 so checa asaas_status) -> DUPLICATA.
        try {
          await supabase.from('contratos').update({
            asaas_status: 'launched',
            asaas_payments: json.payment,
            asaas_customer_id: json.customer?.id,
          }).eq('id', created.id);
        } catch { /* best-effort: persistencia nao deve esconder o sucesso do lancamento */ }
        updateStep('asaas', 'ok', `${parcelas} parcela(s) criada(s)`);
      }
    } catch (err) {
      updateStep('asaas', 'error', err.message || 'erro Asaas');
    }
  }

  // (chatguru removal) STEP 5 ChatGuru removido — comunicacao manual

  return { contractId: created.id, steps };
}

// Helper exportado para que o modal possa pre-validar requisitos
// dos checkboxes de automacao sem duplicar regras.
export function checkAutomacaoRequisitos(data, anexos) {
  const c1 = data.contratantes?.[0] || {};
  const honorarios = data.honorarios || {};
  return {
    advbox: !!(c1.nome && c1.cpf),
    drive: !!(
      data.linkGoogleDrive &&
      (anexos?.contratoPdf?.base64 || anexos?.procuracaoPdf?.base64)
    ),
    asaas: !!(
      Number(honorarios.total || 0) > 0 &&
      Number(honorarios.parcelas || 0) > 0 &&
      honorarios.dataPrimeiraParcela
    ),
    // (chatguru removal) chatguru: removido
  };
}
