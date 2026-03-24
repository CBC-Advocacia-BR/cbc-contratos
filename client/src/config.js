// API base URL - uses env var in production, localhost in dev
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
