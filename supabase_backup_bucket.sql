-- ============================================================================
-- supabase_backup_bucket.sql   (auditoria #87)
-- Bucket privado para os backups automaticos do banco (function db-backup-cron.mjs).
-- Aplicar UMA vez (via MCP apply_migration ou no SQL editor). NAO aplicado
-- automaticamente por esta sessao.
--
-- O db-backup-cron faz upload/list/remove com a SERVICE ROLE (bypassa a RLS de
-- storage), entao NAO e necessaria policy para o papel anon. Bucket privado =
-- ninguem le sem service role (os backups contem PII — nunca deixar publico).
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('cbc-backups', 'cbc-backups', false)
on conflict (id) do nothing;
