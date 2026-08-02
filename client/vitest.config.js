// Vitest config separado do vite.config.js para nao interferir no build de producao.
// Usa node environment porque os testes alvo sao funcoes puras (utils) e geracao
// de string HTML — nao precisam de DOM.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // (auditoria #55) inclui tambem os testes das Netlify Functions / libs de _lib/
    // (logica pura: validate, mapas, parsers). As functions que tocam rede tem a parte
    // pura testada aqui; a rede em si fica fora.
    include: [
      'src/**/__tests__/**/*.test.{js,jsx}',
      'netlify/functions/**/__tests__/**/*.test.{js,mjs}',
    ],
    exclude: ['node_modules', 'dist'],
    // (auditoria 01/08 — item 227) fixa TZ=America/Sao_Paulo: a logica de data virou
    // sensivel a fuso e o CI roda em UTC. Sem isto o mesmo teste da resultados
    // diferentes no Mac e no GitHub Actions.
    setupFiles: ['./vitest.setup.js'],
    reporters: 'default',
    // (auditoria #61) termometro de cobertura — rode `npm run test:coverage`.
    // Requer o pacote @vitest/coverage-v8 (devDependency).
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/utils/**', 'src/components/dashboard/**', 'src/components/funnel/**'],
      // (auditoria 01/08/2026 — item 300) PISO DE COBERTURA.
      //
      // Sem piso, a cobertura podia cair sem nada apitar: bastava um modulo novo grande
      // sem teste para o numero despencar em silencio, e ninguem olha um relatorio que
      // nunca reclama. Os valores abaixo sao o MEDIDO em 02/08/2026, arredondados para
      // baixo com folga — a regra e "nao pode piorar", nao "tem que ser alto".
      //
      // Por que linhas e statements sao baixos (38%) e funcoes alto (80%): o `include`
      // acima pega utils INTEIROS, inclusive os que so falam com rede/SDK (zapsign,
      // supabasePaged, sessionManager) e que nao se testa sem simular servidor. A parte
      // testavel — as CONTAS — esta bem coberta, e e o que os ramos (73%) mostram.
      //
      // Ao subir a cobertura, SUBA ESTES NUMEROS junto: piso que fica para tras vira
      // enfeite. Nao vale baixar para fazer um teste que falha passar.
      thresholds: {
        statements: 37,
        branches: 71,
        functions: 78,
        lines: 37,
      },
    },
  },
});
