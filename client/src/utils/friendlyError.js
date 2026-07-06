// (auditoria #38) Traduz erros tecnicos (Supabase/Postgres/rede) para mensagens
// amigaveis em portugues, para o USUARIO nunca ver "duplicate key value violates..."
// na tela. O detalhe tecnico continua devendo ir para o console/Sentry pelo chamador.
//
// Uso: catch (err) { console.error(err); setMsg(friendlyError(err)); }
export function friendlyError(err, fallback = 'Nao foi possivel concluir. Tente novamente.') {
  const raw = (err && (err.message || err.error_description || err.msg || err.hint))
    || (typeof err === 'string' ? err : '');
  const m = String(raw).toLowerCase();
  if (!m) return fallback;

  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed') || m.includes('load failed'))
    return 'Sem conexao com o servidor. Verifique sua internet e tente de novo.';
  if (m.includes('duplicate key') || m.includes('already exists') || m.includes('unique constraint'))
    return 'Este registro ja existe.';
  if (m.includes('row-level security') || m.includes('permission denied') || m.includes('not authorized') || m.includes('jwt expired') || m.includes('invalid claim'))
    return 'Voce nao tem permissao para esta acao (ou a sessao expirou — recarregue a pagina).';
  if (m.includes('timeout') || m.includes('timed out') || m.includes('deadline exceeded'))
    return 'A operacao demorou demais. Tente novamente em instantes.';
  if (m.includes('foreign key') || m.includes('violates') && m.includes('constraint'))
    return 'Nao foi possivel salvar: ha dados relacionados que impedem a operacao.';
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('429'))
    return 'Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.';
  if (m.includes('invalid input syntax') || m.includes('malformed'))
    return 'Algum campo esta com formato invalido.';
  return fallback;
}
