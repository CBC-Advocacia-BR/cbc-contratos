// Vitest config separado do vite.config.js para nao interferir no build de producao.
// Usa node environment porque os testes alvo sao funcoes puras (utils) e geracao
// de string HTML — nao precisam de DOM.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    exclude: ['node_modules', 'dist'],
    reporters: 'default',
  },
});
