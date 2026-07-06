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
    reporters: 'default',
    // (auditoria #61) termometro de cobertura — rode `npm run test:coverage`.
    // Sem threshold obrigatorio de inicio: primeiro medir e tornar visivel; depois,
    // opcionalmente, travar "nao pode cair abaixo do atual" nos modulos ja testados.
    // Requer o pacote @vitest/coverage-v8 (devDependency).
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/utils/**', 'src/components/dashboard/**', 'src/components/funnel/**'],
    },
  },
});
