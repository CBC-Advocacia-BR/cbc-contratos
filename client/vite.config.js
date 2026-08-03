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
  // (auditoria 01/08/2026 — item 313) AQUI havia um proxy `/api -> localhost:3001`
  // apontando para o servidor Express que foi APOSENTADO em 20/06/2026. Em
  // desenvolvimento, toda chamada a /api batia num endereco morto e o erro parecia do
  // codigo, nao da configuracao. Removido: em producao o /api e servido pelas edge
  // functions da Netlify, e utils/apiEndpoints.js ja cai para /.netlify/functions/*.
  // Para rodar as functions na sua maquina, use `npx netlify dev` no lugar de `npm run
  // dev` — ele serve o Vite e as functions na mesma porta.

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
          // (auditoria 01/08 — item 169) ORDEM IMPORTA. O teste `id.includes('/react/')`
          // casa com QUALQUER pacote cujo caminho contenha "/react/" — inclusive
          // `@sentry/react` e `@heroicons/react`. Como ele vinha ANTES, as regras de
          // @sentry (linha abaixo) e dos icones nunca disparavam: os dois iam parar no
          // vendor-react, que TODO usuario baixa antes de ver a tela (o `vendor-sentry`
          // citado no HEAVY_LAZY nem chegava a existir no dist). Agora os casos
          // especificos vem primeiro e o React usa caminho ancorado em node_modules.
          if (id.includes('@sentry')) return 'vendor-sentry'
          if (id.includes('@heroicons')) return 'vendor-icons'
          if (id.includes('react-dom') || id.includes('node_modules/react/') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('@supabase')) return 'vendor-supabase'
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
    // (auditoria 01/08 — item 156) `hidden` em vez de false: GERA os mapas de codigo,
    // mas NAO adiciona o comentario //# sourceMappingURL no bundle. Ou seja:
    //  - o navegador do usuario nao baixa nada a mais (zero custo de banda, que era o
    //    motivo do `false` original);
    //  - os arquivos .map ficam no dist para serem enviados ao Sentry no deploy.
    // Sem eles, todo erro de tela branca chega como "a.b is not a function" num arquivo
    // minificado — ilegivel, e impossivel saber qual linha do nosso codigo quebrou.
    // ⚠️ Os .map NAO devem ser publicados junto com o site (expoem o codigo-fonte). Ver a
    // regra de bloqueio em public/_headers e o passo de envio ao Sentry no deploy.sh.
    sourcemap: 'hidden',
    // Avisa se bundle passar de 650kb. Os chunks grandes (vendor-pdf/pdflib/excel/docx) sao
    // LAZY (so carregam quando a feature e usada) e ficam fora do preload inicial -> nao pesam
    // no primeiro paint. Limite em 650 evita falso-alarme mas ainda avisa se um chunk EAGER inchar.
    chunkSizeWarningLimit: 650,
    // CSS minificacao padrao do Vite (esbuild)
  },
})
