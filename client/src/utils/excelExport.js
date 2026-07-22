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

// Padroniza estado civil para a forma MASCULINA (pedido do Paulo p/ o export do trio).
// Normaliza tambem os formatos do ADVBOX ("CASADO(A)") e variacoes de grafia.
function estadoCivilMasculino(ec) {
  const s = (ec || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!s) return '';
  if (s.includes('uniao') || s.includes('estavel')) return 'União estável';
  if (s.startsWith('casad')) return 'Casado';
  if (s.startsWith('solteir')) return 'Solteiro';
  if (s.startsWith('divorciad') || s.startsWith('separad')) return 'Divorciado';
  if (s.startsWith('viuv')) return 'Viúvo';
  return ec; // desconhecido: mantem o original
}

// Export do painel de Clientes para o trio (Paulo/Bruno/Lorenza). `rows` vem da RPC
// cliente_export_planilha. Profissao e estado civil saem PADRONIZADOS para o masculino.
export async function exportClientesPlanilha(rows) {
  const XLSX = await import('xlsx');
  const { adjustProfissaoGender } = await import('./genderDetector');

  const data = (rows || []).map((r) => ({
    'CPF': r.cpf || '',
    'Nome completo': r.nome || '',
    'Nome completo conjuge': r.conjuge_nome || '',
    'Telefone': r.telefone || '',
    'Telefone conjuge': r.conjuge_telefone || '',
    'E-mail': r.email || '',
    'E-mail conjuge': r.conjuge_email || '',
    'Valor total investido nas cotas': r.valor_investido != null ? Number(r.valor_investido) : '',
    'Cidade domicilio': r.cidade || '',
    'Estado domicilio': r.uf || '',
    'Data de compra da cota': r.data_compra ? new Date(`${r.data_compra}T00:00:00`).toLocaleDateString('pt-BR') : '',
    'Resort': r.resort || '',
    'Idade': r.idade != null ? r.idade : '',
    'Idade conjuge': r.conjuge_idade != null ? r.conjuge_idade : '',
    'Profissao (padrao masc.)': r.profissao ? adjustProfissaoGender(r.profissao, 'M') : '',
    'Estado civil (padrao masc.)': estadoCivilMasculino(r.estado_civil),
    'Percentual de honorarios': r.honorarios_perc != null ? Number(r.honorarios_perc) : '',
    'Valor honorarios iniciais': r.honorarios_iniciais != null ? Number(r.honorarios_iniciais) : '',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');

  const colWidths = Object.keys(data[0] || {}).map((key) => ({
    wch: Math.min(48, Math.max(key.length, ...data.map((r) => String(r[key] ?? '').length)) + 2),
  }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, `clientes_cbc_${new Date().toISOString().split('T')[0]}.xlsx`);
  return data.length;
}
