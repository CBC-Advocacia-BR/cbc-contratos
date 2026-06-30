// Modal do Dashboard: seletor de intervalo de datas (por data de ASSINATURA)
// + geracao de um relatorio PDF "bonito" com nome do cliente, cidade/UF e a
// data de assinatura de cada contrato assinado no periodo.
//
// Fonte de dados: fetch dedicado de status='assinado' (independente da janela
// de 18 meses do Dashboard, para nunca perder assinaturas antigas). A data de
// assinatura efetiva usa a MESMA regra do Dashboard (getSignedDate: signed_at
// -> advbox_date -> updated_at). HTML montado por relatorioAssinadosHtml.js e
// renderizado em PDF por downloadPdf (pdfGenerator.js).
import React, { useState, useCallback } from 'react';
import { XMarkIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { getSignedDate } from './compute';
import { buildAssinadosReportHtml } from '../../utils/relatorioAssinadosHtml';
import { downloadPdf } from '../../utils/pdfGenerator';

// Date -> 'YYYY-MM-DD' no fuso local (formato do <input type="date">)
function toInputDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SELECT_COLS =
  'nome_contratante1, status, signed_at, advbox_date, updated_at, arquivado_em, contratantes_j:dados->contratantes';

export default function RelatorioAssinadosModal({ initialStart = null, initialEnd = null, onClose }) {
  const [inicio, setInicio] = useState(toInputDate(initialStart));
  const [fim, setFim] = useState(toInputDate(initialEnd));
  const [incluirArquivados, setIncluirArquivados] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');

  const handleGerar = useCallback(async () => {
    setErro('');
    if (inicio && fim && inicio > fim) {
      setErro('A data inicial não pode ser depois da data final.');
      return;
    }
    setGerando(true);
    try {
      const { data, error } = await supabase
        .from('contratos')
        .select(SELECT_COLS)
        .eq('status', 'assinado');
      if (error) throw error;

      const start = inicio ? new Date(`${inicio}T00:00:00`) : null;
      const end = fim ? new Date(`${fim}T23:59:59.999`) : null;

      const rows = (data || [])
        .filter((c) => incluirArquivados || !c.arquivado_em)
        .map((c) => ({ c, signed: getSignedDate(c) }))
        .filter((x) => {
          if (!x.signed) return false;
          if (start && x.signed < start) return false;
          if (end && x.signed > end) return false;
          return true;
        })
        .sort((a, b) => b.signed - a.signed) // mais recente primeiro
        .map((x) => {
          const ct = (Array.isArray(x.c.contratantes_j) && x.c.contratantes_j[0]) || {};
          return {
            nome: x.c.nome_contratante1 || ct.nome || '',
            cidade: ct.cidade || '',
            uf: ct.uf || '',
            signed: x.signed,
          };
        });

      if (rows.length === 0) {
        setErro('Nenhum contrato assinado encontrado nesse intervalo.');
        setGerando(false);
        return;
      }

      const html = buildAssinadosReportHtml(rows, {
        inicioLabel: start ? start.toLocaleDateString('pt-BR') : null,
        fimLabel: fim ? new Date(`${fim}T00:00:00`).toLocaleDateString('pt-BR') : null,
        geradoEm: new Date(),
      });

      const nomeArq = `contratos-assinados_${inicio || 'inicio'}_a_${fim || 'hoje'}.pdf`;
      await downloadPdf(html, nomeArq);
      onClose();
    } catch (e) {
      setErro('Erro ao gerar o relatório: ' + (e?.message || e));
    } finally {
      setGerando(false);
    }
  }, [inicio, fim, incluirArquivados, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={gerando ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--cbc-bg-card)', border: '1px solid var(--cbc-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex items-center justify-between gap-2"
          style={{ background: 'var(--cbc-navy, #1B3A5C)', color: 'white' }}
        >
          <div className="flex items-center gap-2">
            <DocumentArrowDownIcon className="w-5 h-5" aria-hidden="true" />
            <h3 className="text-sm font-bold tracking-wide">Relatório PDF · Contratos assinados</h3>
          </div>
          <button
            onClick={onClose}
            disabled={gerando}
            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
            aria-label="Fechar"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <p className="text-[11px]" style={{ color: 'var(--cbc-text-secondary)' }}>
            Escolha o intervalo de <strong>datas de assinatura</strong>. O PDF lista cada cliente,
            a cidade/UF do endereço e a data em que assinou.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>
                Data inicial
              </label>
              <input
                type="date"
                value={inicio}
                max={fim || undefined}
                onChange={(e) => setInicio(e.target.value)}
                disabled={gerando}
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--cbc-text-muted)' }}>
                Data final
              </label>
              <input
                type="date"
                value={fim}
                min={inicio || undefined}
                onChange={(e) => setFim(e.target.value)}
                disabled={gerando}
                className="input-field w-full"
              />
            </div>
          </div>

          <p className="text-[10px]" style={{ color: 'var(--cbc-text-muted)' }}>
            Deixe um campo em branco para não limitar aquele lado (ex.: sem data final = até hoje).
          </p>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={incluirArquivados}
              onChange={(e) => setIncluirArquivados(e.target.checked)}
              disabled={gerando}
              className="w-4 h-4 cursor-pointer accent-[#C9A84C] shrink-0"
            />
            <span className="text-[11px]" style={{ color: 'var(--cbc-text-secondary)' }}>
              Incluir contratos arquivados
            </span>
          </label>

          {erro && (
            <div
              className="text-[11px] font-semibold rounded-lg px-3 py-2"
              style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.25)' }}
            >
              {erro}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 flex items-center justify-end gap-2 border-t"
          style={{ borderColor: 'var(--cbc-border)', background: 'var(--cbc-bg-subtle, #FAFAFA)' }}
        >
          <button
            onClick={onClose}
            disabled={gerando}
            className="text-[11px] font-bold uppercase px-4 py-2 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-default"
            style={{ background: 'transparent', color: 'var(--cbc-text-secondary)', border: '1px solid var(--cbc-border)' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleGerar}
            disabled={gerando}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase px-4 py-2 rounded-lg cursor-pointer text-white disabled:opacity-60 disabled:cursor-default"
            style={{ background: 'var(--cbc-navy, #1B3A5C)' }}
          >
            <DocumentArrowDownIcon className="w-4 h-4" aria-hidden="true" />
            {gerando ? 'Gerando…' : 'Gerar PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
