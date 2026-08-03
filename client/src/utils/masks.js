export function maskCPF(value) {
  return value
    .replace(/\D/g, '')
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function maskCEP(value) {
  return value
    .replace(/\D/g, '')
    .slice(0, 8)
    .replace(/(\d{5})(\d)/, '$1-$2');
}

export function maskCNPJ(value) {
  return value
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function maskRG(value) {
  return value.replace(/[^0-9A-Za-z.\-/ ]/g, '').slice(0, 20);
}

/**
 * (auditoria 01/08/2026 — item 311) A mascara sempre quebrava depois do 5º digito, o que
 * so vale para CELULAR (9 digitos apos o DDD). Telefone FIXO tem 8, e saia deformado:
 * `(11) 34567-890` no lugar de `(11) 3456-7890`. O item pedia "teste que falta"; ao
 * escrever o teste apareceu o defeito que ele teria pego.
 *
 * O tamanho final resolve (11 = celular, 10 = fixo), mas no MEIO da digitacao ele ainda
 * nao existe: com 7 digitos os dois formatos sao possiveis. O desempate e que, desde
 * 2016, todo celular brasileiro comeca com 9 depois do DDD — fixo comeca com 2 a 5.
 * Sem esse sinal, quem digita um celular veria a mascara pular de '3456-7' para
 * '98765-4321' no meio do caminho.
 */
export function maskPhone(value) {
  const d = String(value ?? '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  const ddd = `(${d.slice(0, 2)}) `;
  const resto = d.slice(2);
  const celular = resto.length > 8 || resto[0] === '9';
  // celular: 9 digitos, quebra depois do 5º | fixo: 8 digitos, quebra depois do 4º
  const corte = celular ? 5 : 4;
  if (resto.length <= corte) return ddd + resto;
  return `${ddd}${resto.slice(0, corte)}-${resto.slice(corte)}`;
}
