import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import TesesApp from './teses/TesesApp.jsx'

// Roteamento de nível de aplicação: /teses → CBC TESES, resto → CBC Contratos.
// Detecta via pathname ou via hash (#teses), suportando SPAs hospedados
// com fallback para index.html no Netlify.
const path = window.location.pathname || '/';
const hash = window.location.hash || '';
const isTeses = path.startsWith('/teses') || hash.startsWith('#teses') || hash.startsWith('#/teses');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isTeses ? <TesesApp /> : <App />}
  </StrictMode>,
)
