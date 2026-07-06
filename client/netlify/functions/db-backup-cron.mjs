/**
 * Scheduled: db-backup-cron (diario 06:00 UTC = 03:00 BRT) — auditoria #87
 *
 * Backup automatico do banco. O antigo backup (server/ + S3) foi APOSENTADO em
 * 20/06/2026 e NADA salva os dados desde entao. Este cron exporta as tabelas-chave do
 * CBC Contratos para JSON e sobe num bucket privado do Supabase Storage, com retencao
 * de 30 dias. (Decisao do Paulo 06/07: "os dois" — esta funcao + ligar o PITR do Pro.)
 *
 * REQUISITOS p/ FUNCIONAR:
 *  1) SUPABASE_SERVICE_ROLE_KEY no Netlify — upload em bucket privado bypassa a RLS de
 *     storage. Sem ela, o cron loga um aviso e sai SEM quebrar (nao ha o que subir).
 *  2) Bucket 'cbc-backups' criado — migracao supabase_backup_bucket.sql.
 */
import { supa, usingServiceRole } from './_lib/supabaseClient.mjs';
import { heartbeat, logAdvbox } from './_lib/botDb.mjs';

const TABELAS = ['contratos', 'contrato_comentarios', 'empreendimentos', 'user_permissions', 'user_views'];
const BUCKET = 'cbc-backups';
const RETENCAO_DIAS = 30;
const jres = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async () => {
  const stats = { tabelas: {}, erros: [] };
  if (!supa) { await heartbeat('db-backup-cron', false, 'supabase env ausente'); return jres({ ok: false, error: 'sem env' }); }
  if (!usingServiceRole) {
    // Sem service role, o upload em bucket privado falharia — nao adianta exportar.
    await logAdvbox('backup', 'aviso', 'db-backup-cron: SUPABASE_SERVICE_ROLE_KEY ausente — backup automatico NAO executado (upload em bucket privado exige service role). Configure-a ou ative o PITR do Supabase.', {});
    await heartbeat('db-backup-cron', false, 'sem service role');
    return jres({ ok: false, error: 'sem service role' });
  }

  // 1) exporta cada tabela (paginado p/ nao estourar memoria)
  const dump = {};
  for (const t of TABELAS) {
    try {
      const linhas = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supa.from(t).select('*').range(from, from + PAGE - 1);
        if (error) throw error;
        linhas.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      dump[t] = linhas;
      stats.tabelas[t] = linhas.length;
    } catch (e) { stats.erros.push(`${t}: ${e.message}`.slice(0, 150)); }
  }

  // 2) sobe o JSON no bucket privado (nome com timestamp)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const path = `cbc-backup-${stamp}.json`;
  try {
    const body = JSON.stringify({ gerado_em: new Date().toISOString(), stats: stats.tabelas, dados: dump });
    const { error: upErr } = await supa.storage.from(BUCKET).upload(path, body, { contentType: 'application/json', upsert: true });
    if (upErr) throw upErr;
  } catch (e) {
    stats.erros.push(`upload: ${e.message}`.slice(0, 150));
    await logAdvbox('backup', 'erro', `db-backup-cron: upload falhou: ${e.message}`.slice(0, 300), stats);
    await heartbeat('db-backup-cron', false, `upload falhou`.slice(0, 120));
    return jres({ ok: false, ...stats });
  }

  // 3) retencao: remove backups mais antigos que RETENCAO_DIAS
  try {
    const { data: files } = await supa.storage.from(BUCKET).list('', { limit: 1000 });
    const corte = Date.now() - RETENCAO_DIAS * 86400000;
    const velhos = (files || []).filter((f) => f.created_at && new Date(f.created_at).getTime() < corte).map((f) => f.name);
    if (velhos.length) await supa.storage.from(BUCKET).remove(velhos);
  } catch { /* retencao best-effort */ }

  await logAdvbox('backup', stats.erros.length ? 'aviso' : 'info',
    `Backup do banco OK: ${Object.entries(stats.tabelas).map(([k, v]) => `${k}=${v}`).join(', ')}${stats.erros.length ? ` — ${stats.erros.length} erro(s)` : ''}`, stats);
  await heartbeat('db-backup-cron', stats.erros.length === 0, `${Object.values(stats.tabelas).reduce((a, b) => a + b, 0)} linhas`);
  return jres({ ok: true, path, ...stats });
};

export const config = { schedule: '0 6 * * *' }; // 06:00 UTC = 03:00 BRT (como o antigo backup)
