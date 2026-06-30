/**
 * Netlify BACKGROUND Function: viacep-enrich-background
 * Enriquecimento de ENDERECO via ViaCEP (API publica dos Correios, gratuita).
 *
 * Le os CEPs (8 digitos) dos clientes ativos que ainda faltam cidade/bairro/uf,
 * busca cada CEP ainda nao cacheado na ViaCEP e grava em public.cep_cache (cache
 * faithful, persistente — CEP->cidade quase nunca muda). A APLICACAO no golden
 * e feita por core.cep_aplicar() (roda no ciclo diario in-DB).
 *
 * Disparado fire-and-forget pelo snapshot do AdvBox (6h30/17h30 BRT). Como so
 * busca CEP NAO cacheado, depois do backlog inicial cada rodada custa quase nada.
 */
import { db } from './_lib/botDb.mjs';

const VIACEP = (cep) => `https://viacep.com.br/ws/${cep}/json/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAP = 1500;       // teto de CEPs por rodada (seguranca)
const DELAY_MS = 200;   // ~5 req/s — gentil com a ViaCEP

const mk = (cep, j, erro) => ({
  cep,
  logradouro: (j && j.logradouro) || null,
  bairro: (j && j.bairro) || null,
  localidade: (j && j.localidade) || null,
  uf: (j && j.uf) || null,
  ibge: (j && j.ibge) || null,
  erro: !!erro,
  fetched_at: new Date().toISOString(),
});

export default async () => {
  const started = Date.now();
  const stats = { candidatos: 0, buscados: 0, ok: 0, erro: 0 };
  try {
    // 1) CEPs pendentes via RPC SECURITY DEFINER (o anon key nao le o golden direto;
    //    a RPC ja exclui os ja cacheados e os ja completos)
    const { data: ceps, error } = await db.rpc('ceps_pendentes', { p_limite: CAP });
    if (error) throw new Error('ceps_pendentes: ' + error.message);
    const toFetch = Array.isArray(ceps) ? ceps : [];
    stats.candidatos = toFetch.length;

    // 2) busca ViaCEP + grava em lotes via RPC (nao perde progresso se travar)
    let buffer = [];
    const flush = async () => { if (buffer.length) { await db.rpc('cep_cache_gravar', { p_rows: buffer }); buffer = []; } };
    for (const cep of toFetch) {
      stats.buscados++;
      try {
        const r = await fetch(VIACEP(cep), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) { buffer.push(mk(cep, null, true)); stats.erro++; }
        else {
          const j = await r.json();
          if (j && j.erro) { buffer.push(mk(cep, null, true)); stats.erro++; }
          else { buffer.push(mk(cep, j, false)); stats.ok++; }
        }
      } catch { buffer.push(mk(cep, null, true)); stats.erro++; }
      if (buffer.length >= 100) await flush();
      await sleep(DELAY_MS);
    }
    await flush();
  } catch (e) { stats.fatal = String(e.message || e).slice(0, 200); }

  stats.duracao_s = Math.round((Date.now() - started) / 1000);
  try {
    await db.from('bot_config').upsert({
      key: 'viacep_status',
      value: { last_run: new Date(started).toISOString(), ...stats },
      updated_at: new Date().toISOString(),
    });
  } catch { /* nao critico */ }
  console.log('[viacep]', JSON.stringify(stats));
  return new Response('ok');
};

export const config = { path: '/.netlify/functions/viacep-enrich-background' };
