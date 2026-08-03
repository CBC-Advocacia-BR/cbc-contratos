/**
 * (auditoria 01/08/2026 — item 302) Portao de "nao piorar" do lint.
 *
 * O repo tem 19 erros de lint HERDADOS (react-hooks/react-refresh, em sua maioria
 * cosmeticos) que ninguem vai zerar hoje. Sem trava, `npm run lint` reprova sempre,
 * todo mundo aprende a ignorar, e um erro NOVO passa igual ao baseline velho — foi
 * exatamente por isso que o CI usava `|| echo warning`.
 *
 * Aqui a conta e outra: erro novo reprova; erro antigo corrigido e comemorado (e pede
 * para BAIXAR o baseline, travando o ganho). Mesmo numero usado pelo CI.
 */
import { execFileSync } from 'node:child_process';

const BASELINE = Number(process.env.BASELINE_ERROS || 18);

let saida = '[]';
try {
  saida = execFileSync('npx', ['eslint', '.', '-f', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  // eslint sai com codigo 1 quando ha erro — a saida JSON continua valida no stdout
  saida = e.stdout || '[]';
}

const arquivos = JSON.parse(saida);
const erros = arquivos.reduce((s, f) => s + f.errorCount, 0);
const avisos = arquivos.reduce((s, f) => s + f.warningCount, 0);

if (erros > BASELINE) {
  console.error(`\nLint PIOROU: ${erros} erros (baseline ${BASELINE}).`);
  const piores = arquivos.filter((f) => f.errorCount > 0)
    .sort((a, b) => b.errorCount - a.errorCount).slice(0, 10);
  for (const f of piores) console.error(`  ${f.errorCount.toString().padStart(3)}  ${f.filePath.split('/client/').pop()}`);
  console.error('\nRode `npm run lint` para ver o erro novo.\n');
  process.exit(1);
}

if (erros < BASELINE) {
  console.log(`Lint MELHOROU: ${erros} erros (baseline ${BASELINE}).`);
  console.log('Baixe BASELINE_ERROS em .github/workflows/ci.yml e em scripts/lint-gate.mjs para travar o ganho.');
} else {
  console.log(`Lint estavel: ${erros} erros (baseline ${BASELINE}), ${avisos} avisos.`);
}
