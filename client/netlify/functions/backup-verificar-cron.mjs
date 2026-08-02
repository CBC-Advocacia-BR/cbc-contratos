/**
 * (auditoria 01/08/2026 — item 162) Confere se o backup REALMENTE está saindo.
 *
 * O PROBLEMA: o backup diário grava um status dizendo "subi" e um sinal de vida — e é
 * só. Ninguém nunca conferiu o outro lado. Se o Apps Script passar a aceitar e descartar,
 * se a permissão da pasta mudar, ou se o arquivo subir vazio, o sistema continua
 * reportando sucesso e você só descobre no dia em que precisar restaurar. Backup que
 * ninguém confere é esperança, não backup.
 *
 * O QUE ESTA VERIFICAÇÃO OLHA (o que o próprio worker já registra, sem depender de uma
 * API de listagem do Drive):
 *   1. o backup de ONTEM existe e terminou com sucesso;
 *   2. ele gerou pelo menos um arquivo COM fileId — o Apps Script só devolve id quando
 *      o arquivo foi de fato criado no Drive;
 *   3. o tamanho não desabou (comparado com a média recente) — arquivo que encolhe de
 *      repente costuma ser export truncado, não "mês fraco";
 *   4. o número de tabelas bate com a whitelist.
 *
 * Roda às segundas 08h30 BRT: um alerta por semana, não por dia — a falha que importa
 * aqui (backup silenciosamente vazio) leva dias para causar dano, e alerta diário
 * repetido é o que faz alerta ser ignorado.
 */
import { db, logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { verificarGatilho, respostaNegada } from './_lib/gatilho.mjs';
import { sendCriticalAlert } from './_lib/alertEmail.mjs';

export const config = { schedule: '30 11 * * 1' }; // segunda, 08h30 BRT

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export default async (req) => {
  const gatilho = verificarGatilho(req, { agendada: true });
  if (!gatilho.ok) return respostaNegada(gatilho);

  const problemas = [];
  try {
    const { data: row } = await db.from('bot_config').select('value').eq('key', 'backup_status').maybeSingle();
    const st = row?.value || null;

    if (!st) {
      problemas.push('Nunca houve registro de backup (bot_config.backup_status vazio).');
    } else {
      // 1) rodou nas últimas 48h? (48h e não 24h para não acusar por um atraso de horas)
      const quando = st.quando ? new Date(st.quando).getTime() : 0;
      const horas = quando ? Math.round((Date.now() - quando) / 3600000) : null;
      if (!quando || horas > 48) {
        problemas.push(`Último backup foi há ${horas ?? '???'} horas — deveria ser diário.`);
      }
      // 2) terminou bem?
      if (st.ok === false) problemas.push(`Último backup FALHOU: ${st.erro || 'sem detalhe'}`);
      // 3) gerou arquivo com id? (id só existe se o Drive criou o arquivo)
      const comId = (st.arquivos || []).filter((a) => a?.fileId).length;
      if (!comId) {
        problemas.push('O backup reportou sucesso mas NENHUM arquivo tem id do Drive — pode não ter sido gravado de verdade.');
      }
      // 4) encolheu? (arquivo que despenca costuma ser export truncado)
      const kb = (st.arquivos || []).reduce((s, a) => s + (Number(a?.kb) || 0), 0);
      if (comId && kb < 500) {
        problemas.push(`Backup de ${kb} KB — muito pequeno para ${st.linhas || '?'} linhas; pode estar truncado.`);
      }
      // 5) cobriu a whitelist inteira?
      if (st.tabelas && st.tabelas < 50) {
        problemas.push(`Backup cobriu apenas ${st.tabelas} tabelas — a whitelist tem mais que isso.`);
      }
      // 6) sobrou tabela com dado fora da cópia? (registrado pelo worker — item 161)
      if (Array.isArray(st.tabelas_fora) && st.tabelas_fora.length) {
        problemas.push(`Tabelas com dados FORA do backup: ${st.tabelas_fora.join(', ')}`);
      }
    }
  } catch (e) {
    problemas.push(`Não foi possível verificar o backup: ${String(e.message || e).slice(0, 140)}`);
  }

  if (problemas.length) {
    await logAdvbox('backup', 'erro', `Verificacao semanal do backup: ${problemas.length} problema(s) — ${problemas[0]}`, { problemas });
    await sendCriticalAlert('Backup do banco com problema', [
      ...problemas,
      'O backup diario para o Google Drive e hoje a UNICA copia do banco. Enquanto isso nao for resolvido, uma perda de dados nao teria de onde ser restaurada.',
    ]).catch(() => {});
  } else {
    await logAdvbox('backup', 'info', 'Verificacao semanal do backup: tudo certo', {});
  }

  await heartbeat('backup-verificar-cron', problemas.length === 0,
    problemas.length ? `${problemas.length} problema(s)` : 'backup saudavel');
  return json(200, { ok: problemas.length === 0, problemas });
};
