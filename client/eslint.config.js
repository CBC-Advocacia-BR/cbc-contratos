import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // (auditoria 01/08/2026 — item 302) `backups/` guarda copias congeladas de arquivos
  // (REGRA #1 do projeto: nunca apagar, sempre copiar antes de editar). O eslint estava
  // lintando esse arquivo MORTO como se fosse codigo vivo: 42 dos 82 problemas vinham
  // dali. Alem do ruido, isso impedia a unica coisa que importa — enxergar se um erro
  // NOVO entrou no codigo de verdade. `prototipos/` e a mesma coisa (mockups descartaveis).
  globalIgnores(['dist', 'backups', 'prototipos', 'coverage']),
  // (item 302) Estes dois nao rodam no NAVEGADOR e por isso apareciam como erro:
  //   vitest.setup.js roda no Node (usa `process`), portal-sw.js e service worker
  //   (`self`, `clients`). Declarar o ambiente certo elimina 2 erros FALSOS — que sao
  //   os piores, porque ensinam a ignorar a lista inteira.
  {
    files: ['vitest.setup.js', 'vite.config.js', 'netlify/functions/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['public/*-sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      // (quality-4) __BUILD_SHA__/__BUILD_DATE__ sao injetados pelo Vite (define) — globals validos
      globals: { ...globals.browser, __BUILD_SHA__: 'readonly', __BUILD_DATE__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
