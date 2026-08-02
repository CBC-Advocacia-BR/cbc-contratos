// ⚠️ CODIGO INATIVO (auditoria 01/08/2026 — item 215)
// Nenhum arquivo do app importa este modulo hoje (conferido por varredura em src/).
// Mantido no repositorio porque a REGRA #1 do projeto proibe apagar arquivos — mas NAO
// confie nele como se estivesse rodando: se precisar deste comportamento, confirme
// primeiro que alguem realmente o chama.
// Obs.: aponta para o servidor Node em localhost:3001, APOSENTADO em 20/06/2026.
// API base URL - uses env var in production, localhost in dev
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
