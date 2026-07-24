// Regra PURA do feature flag "kommo_vinculo" (config vem de bot_config).
// off por padrao; on se ativo global OU e-mail listado em usuarios[].
export function resolveFlag(config, email) {
  if (!config) return false;
  if (config.ativo === true) return true;
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  const lista = Array.isArray(config.usuarios) ? config.usuarios : [];
  return lista.some((u) => String(u || '').trim().toLowerCase() === e);
}
