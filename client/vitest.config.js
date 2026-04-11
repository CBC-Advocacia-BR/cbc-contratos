import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/teses/**/*.test.{js,jsx}'],
    setupFiles: ['./src/teses/__tests__/setup.js'],
  },
});
