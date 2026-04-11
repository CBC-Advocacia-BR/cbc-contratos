// Cliente DataJud — passa pelo backend proxy (autenticação por API key CNJ).
// Endpoint esperado no backend:
//   GET /api/teses/datajud?process_number=XXXXX

import { API_URL } from '../../config';

export async function fetchDatajudProcess(processNumber) {
  try {
    const r = await fetch(
      `${API_URL}/api/teses/datajud?process_number=${encodeURIComponent(processNumber)}`
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Merge DataJud data on top of Advbox bundle, preenchendo campos ausentes.
 * Nunca sobrescreve dados que já vieram do Advbox.
 */
export function mergeDatajudIntoBundle(bundle, datajud) {
  if (!datajud) return bundle;
  const out = { ...bundle };
  out.datajud = datajud;
  const src = datajud?.hits?.hits?.[0]?._source || datajud;
  if (!out.lawsuit) out.lawsuit = {};
  out.lawsuit.classe = out.lawsuit.classe || src?.classe?.nome || null;
  out.lawsuit.assunto = out.lawsuit.assunto || src?.assuntos?.[0]?.nome || null;
  out.lawsuit.vara = out.lawsuit.vara || src?.orgaoJulgador?.nome || null;
  out.lawsuit.comarca = out.lawsuit.comarca || src?.orgaoJulgador?.municipio || null;
  out.lawsuit.tribunal = out.lawsuit.tribunal || src?.tribunal || null;
  out.lawsuit.data_distribuicao = out.lawsuit.data_distribuicao || src?.dataAjuizamento || null;
  return out;
}
