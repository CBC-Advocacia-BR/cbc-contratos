import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Named imports ajudam tree-shaking em @sentry/react (#111)
import { init as sentryInit, ErrorBoundary as SentryErrorBoundary } from '@sentry/react'
import './index.css'
import App from './App.jsx'

// Sentry error tracking — free tier: 5k erros/mes
// DSN vem de VITE_SENTRY_DSN (env var Netlify).
// Se ausente, Sentry fica desabilitado (sem placeholders invalidos).
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';
const SENTRY_ENABLED = !!SENTRY_DSN && SENTRY_DSN.startsWith('https://') && import.meta.env.PROD;

if (SENTRY_ENABLED) {
  sentryInit({
    dsn: SENTRY_DSN,
    environment: 'production',
    release: import.meta.env.VITE_APP_VERSION || 'unknown',
    tracesSampleRate: 0.1, // 10% das transacoes para performance
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1, // grava replay so quando ha erro
    // Filtra erros conhecidos / nao-acionaveis
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection',
      'NetworkError when attempting to fetch',
      'Load failed', // safari fetch abortado
    ],
    beforeSend(event) {
      // Sanitiza dados sensiveis em mensagens de erro
      if (event.message) {
        event.message = event.message
          .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[CPF]')
          .replace(/\b\d{11}\b/g, '[CPF]');
      }
      return event;
    },
  });
} else if (import.meta.env.PROD) {
  console.warn('[Sentry] desabilitado — defina VITE_SENTRY_DSN no Netlify para ativar');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SentryErrorBoundary fallback={<div className="p-8 text-center text-red-600">Ocorreu um erro. Recarregue a página.</div>}>
      <App />
    </SentryErrorBoundary>
  </StrictMode>,
)

// Remove splash screen after first paint. Only runs once on initial load — internal
// navigation (React Router-free SPA) doesn't remount this file, so no re-trigger.
requestAnimationFrame(() => {
  // Small delay so the user gets to see the splash at least briefly
  setTimeout(() => {
    const splash = document.getElementById('cbc-splash');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => { try { splash.remove(); } catch { /* ignora */ } }, 550);
    }
  }, 300);
});
