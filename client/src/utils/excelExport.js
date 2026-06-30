// Import dinâmico de xlsx (lazy) — carrega só ao exportar (#112)
// Usado apenas pelo Dashboard, que agora exporta o escopo FILTRADO.
// (R10) opts.periodoLabel entra no nome do arquivo p/ não colidir e ser autoexplicativo.
export async function exportContratosToExcel(data, opts = {}) {
  const XLSX = await import('xlsx');

  const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

  const rows = data.map(c => ({
    'Nome Contratante 1': c.nome_contratante1,
    'CPF/CNPJ 1': c.cpf_contratante1,
    'Email 1': c.email_contratante1,
    'Nome Contratante 2': c.nome_contratante2 || '',
    'CPF/CNPJ 2': c.cpf_contratante2 || '',
    'Resort': c.resort,
    'Tipo de Acao': c.tipo_acao,
    'Honorarios Total': c.honorarios_total,
    'Parcelas': c.honorarios_parcelas,
    'Valor Parcela': c.honorarios_valor_parcela,
    '% Exito': c.honorarios_percentual_exito,
    '1a Parcela': c.data_primeira_parcela,
    'Status': c.status,
    'Criado por': c.created_by || '',
    'ZapSign Token': c.zapsign_doc_token || '',
    'Criado em': fmtData(c.created_at),
    'Assinado em': fmtData(c.signed_at || (c.status === 'assinado' ? c.advbox_date : null)),
    'Arquivado em': fmtData(c.arquivado_em),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contratos');

  // Auto-width columns
  const colWidths = Object.keys(rows[0] || {}).map(key => ({
    wch: Math.max(key.length, ...rows.map(r => String(r[key] || '').length)) + 2,
  }));
  ws['!cols'] = colWidths;

  const periodo = (opts.periodoLabel || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const sufixo = periodo ? `_${periodo}` : '';
  XLSX.writeFile(wb, `contratos_cbc${sufixo}_${new Date().toISOString().split('T')[0]}.xlsx`);
}
