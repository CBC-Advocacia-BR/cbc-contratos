import * as XLSX from 'xlsx';

export function exportContratosToExcel(data) {
  const rows = data.map(c => ({
    'Nome Contratante 1': c.nome_contratante1,
    'CPF 1': c.cpf_contratante1,
    'Email 1': c.email_contratante1,
    'Nome Contratante 2': c.nome_contratante2 || '',
    'CPF 2': c.cpf_contratante2 || '',
    'Resort': c.resort,
    'Tipo de Acao': c.tipo_acao,
    'Honorarios Total': c.honorarios_total,
    'Parcelas': c.honorarios_parcelas,
    'Valor Parcela': c.honorarios_valor_parcela,
    '% Exito': c.honorarios_percentual_exito,
    '1a Parcela': c.data_primeira_parcela,
    'Status': c.status,
    'ZapSign Token': c.zapsign_doc_token || '',
    'Criado em': c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contratos');

  // Auto-width columns
  const colWidths = Object.keys(rows[0] || {}).map(key => ({
    wch: Math.max(key.length, ...rows.map(r => String(r[key] || '').length)) + 2,
  }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, `contratos_cbc_${new Date().toISOString().split('T')[0]}.xlsx`);
}
