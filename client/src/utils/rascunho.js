// ─────────────────────────────────────────────────────────────────────────
// (auditoria 01/08/2026 — item 36) Onde vive o rascunho do contrato.
//
// O formulario inteiro fica no localStorage do navegador — nome, CPF, RG, endereco e
// e-mail do cliente. Isso e proposital: permite fechar a aba sem perder o que foi
// digitado. O problema era que ele SOBREVIVIA AO LOGOUT: em maquina compartilhada, o
// proximo a sentar abria o console e lia os dados do cliente anterior.
//
// Mora aqui, e nao no ContractContext, porque e funcao pura: o arquivo de componente so
// deve exportar componente (e o proprio lint avisa isso).
// ─────────────────────────────────────────────────────────────────────────

/** Gaveta do rascunho, isolada por usuario — cada um so ve o proprio. */
export function chaveRascunho() {
  try {
    const session = JSON.parse(localStorage.getItem('sb-vygczeepvoyaehfchxko-auth-token') || '{}');
    const email = session?.user?.email || 'anon';
    return `cbc_rascunho_${email.replace(/[^a-z0-9]/gi, '_')}`;
  } catch { return 'cbc_contrato_rascunho'; }
}

/**
 * Apaga o rascunho da maquina.
 *
 * Chamada SO no logout explicito, nunca na expiracao de sessao: sair e uma decisao
 * ("acabei aqui"), enquanto expirar e um acidente — apagar o rascunho de quem apenas
 * ficou um tempo parado seria destruir trabalho sem ninguem ter pedido.
 */
export function limparRascunhoLocal() {
  try {
    localStorage.removeItem(chaveRascunho());
    localStorage.removeItem('cbc_contrato_rascunho'); // chave antiga, pre-isolamento por usuario
  } catch { /* melhor esforco */ }
}
