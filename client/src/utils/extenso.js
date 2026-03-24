const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZENAS_ESPECIAIS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function grupoExtenso(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';

  const c = Math.floor(n / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;

  const partes = [];

  if (c > 0) partes.push(CENTENAS[c]);

  if (d === 1) {
    partes.push(DEZENAS_ESPECIAIS[u]);
  } else {
    if (d > 1) partes.push(DEZENAS[d]);
    if (u > 0) partes.push(UNIDADES[u]);
  }

  return partes.join(' e ');
}

export function valorExtenso(valor) {
  if (valor === 0) return 'zero reais';

  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);

  if (inteiro === 0 && centavos > 0) {
    return `${grupoExtenso(centavos)} centavo${centavos > 1 ? 's' : ''}`;
  }

  const partes = [];

  const milhares = Math.floor(inteiro / 1000);
  const resto = inteiro % 1000;

  if (milhares > 0) {
    if (milhares === 1) {
      partes.push('um mil');
    } else {
      partes.push(`${grupoExtenso(milhares)} mil`);
    }
  }

  if (resto > 0) {
    partes.push(grupoExtenso(resto));
  }

  let resultado = partes.join(' e ');

  if (inteiro === 1) {
    resultado += ' real';
  } else {
    resultado += ' reais';
  }

  if (centavos > 0) {
    resultado += ` e ${grupoExtenso(centavos)} centavo${centavos > 1 ? 's' : ''}`;
  }

  return resultado;
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
