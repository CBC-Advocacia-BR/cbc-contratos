import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// (#100) Injeta SHA do commit + data do build como constantes globais.
// Falha silenciosa se git nao disponivel no ambiente de build.
let __BUILD_SHA__ = 'dev';
let __BUILD_DATE__ = new Date().toISOString().slice(0, 16).replace('T', ' ');
try {
  __BUILD_SHA__ = execSync('git rev-parse --short HEAD').toString().trim();
} catch { /* sem git */ }

// Rolldown-Vite aceita campo `rolldownOptions` (ainda lê `rollupOptions` por compat).
// Mantemos `rollupOptions` para retrocompat; treeshake explicito abaixo. (#111/#112)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_SHA__: JSON.stringify(__BUILD_SHA__),
    __BUILD_DATE__: JSON.stringify(__BUILD_DATE__),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  build: {
    // Hash consistente: assets de vendor raramente mudam entre deploys,
    // separa-los em chunks permite cache de longo prazo no browser
    rollupOptions: {
      // Multi-entry: portal.html e a pagina publica do cliente (autocontida, sem React)
      input: {
        main: 'index.html',
        portal: 'portal.html',
      },
      // Tree-shake agressivo (#111): assume que módulos sem marcacao nao tem
      // side-effects em imports, permitindo remover codigo nao usado.
      treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
      },
      output: {
        // Vendor libs grandes e raramente mudam -> chunks separados para cache longo
        // React e Supabase ficam em chunks fixos (usados em critical path).
        // Outras libs ficam em chunks auto-gerados para deixar Rolldown otimizar hoisting do helper.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('@sentry')) return 'vendor-sentry'
          // Libs PESADAS e carregadas sob demanda (lazy). Nomea-las com chunk fixo faz a
          // lista HEAVY_LAZY do modulePreload (abaixo) finalmente exclui-las do preload
          // inicial -> primeiro carregamento mais leve. So entram quando a feature e usada.
          if (id.includes('tesseract')) return 'vendor-ocr'            // OCR de CNH
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf' // preview/PDF
          if (id.includes('pdf-lib')) return 'vendor-pdflib'           // split de PDF assinado
          if (id.includes('xlsx')) return 'vendor-excel'               // export Excel
          if (id.includes('/docx/') || id.includes('node_modules/docx')) return 'vendor-docx' // DOCX
          if (id.includes('canvas-confetti')) return 'vendor-confetti' // celebracoes
          if (id.includes('qrcode')) return 'vendor-qrcode'            // QR do Portal/ClientForm
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // modulePreload: desativa polyfill e preloads agressivos de dependencies
    // Nao precisamos de modulepreload em chunks lazy (#112) - economiza bandwidth
    modulePreload: {
      polyfill: false,
      // Remove chunks lazy/pesados do modulepreload — carregam sob demanda
      resolveDependencies: (_filename, deps) => {
        const HEAVY_LAZY = [
          'vendor-pdf', 'vendor-pdflib', 'vendor-docx', 'vendor-excel',
          'vendor-ocr', 'vendor-confetti', 'vendor-qrcode', 'vendor-sentry',
          'index.es', 'purify.es', 'docxGenerator', 'tesseract',
        ];
        return deps.filter(d => !HEAVY_LAZY.some(k => d.includes(k)));
      },
    },
    // Source maps so em desenvolvimento (economiza bandwidth em prod)
    sourcemap: false,
    // Avisa se bundle passar de 650kb. Os chunks grandes (vendor-pdf/pdflib/excel/docx) sao
    // LAZY (so carregam quando a feature e usada) e ficam fora do preload inicial -> nao pesam
    // no primeiro paint. Limite em 650 evita falso-alarme mas ainda avisa se um chunk EAGER inchar.
    chunkSizeWarningLimit: 650,
    // CSS minificacao padrao do Vite (esbuild)
  },
})
