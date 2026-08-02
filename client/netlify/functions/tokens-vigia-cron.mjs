/**
 * (auditoria 01/08/2026 — item 128) Vigia dos tokens das integrações.
 *
 * O PROBLEMA: hoje um token só se manifesta quando JÁ quebrou — e o sintoma chega
 * disfarçado. O refresh token do Google expirou em 23/07 e ninguém soube; a agenda
 * simplesmente parou de trazer videochamadas, e o funil exibiu "poucas calls este mês"
 * como se fosse resultado comercial. O token do Kommo é long-lived (vence um dia), o da
 * Meta é de system user ("nunca expira", mas morre com troca de senha, remoção de
 * permissão ou revisão do app) e o do ZapSign/ADVBOX podem ser rotacionados por engano.
 *
 * O QUE ESTE CRON FAZ: uma vez por dia, faz a chamada MAIS BARATA de cada API só para
 * confirmar que a credencial ainda vale — e avisa ANTES de o dado sumir da tela.
 * Nenhuma chamada altera nada (tudo leitura), e cada uma tem prazo curto.
 *
 * Não confundir com o /health: aquele responde "o serviço está no ar" a quem pergunta;
 * este responde "NOSSA credencial ainda é aceita" e cobra sozinho quando não é.
 */
import { logAdvbox, heartbeat } from './_lib/botDb.mjs';
import { verificarGatilho, respostaNegada } from './_lib/gatilho.mjs';
import { sendCriticalAlert } from './_lib/alertEmail.mjs';

export const config = { schedule: '0 11 * * *' }; // 08h BRT

const TIMEOUT = 12000;
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** Cada checagem devolve {nome, ok, detalhe}. Nunca lança — uma falha não derruba as outras. */
async function checar(nome, fn) {
  try {
    const detalhe = await fn();
    return { nome, ok: true, detalhe: detalhe || 'válido' };
  } catch (e) {
    return { nome, ok: false, detalhe: String(e?.message || e).slice(0, 160) };
  }
}

async function pegar(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT) });
  const texto = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`HTTP ${r.status} ${texto.slice(0, 100)}`);
  return texto;
}

export default async (req) => {
  const gatilho = verificarGatilho(req, { agendada: true });
  if (!gatilho.ok) return respostaNegada(gatilho);

  const checagens = [];

  // ── Kommo: /account é o endpoint mais leve que exige token válido ──
  if (process.env.KOMMO_TOKEN) {
    checagens.push(checar('Kommo', async () => {
      await pegar('https://advocaciacbc.kommo.com/api/v4/account', {
        headers: { Authorization: `Bearer ${process.env.KOMMO_TOKEN}` },
      });
      return 'conta acessível';
    }));
  }

  // ── Meta: /debug_token diz se o token está válido E quando expira ──
  if (process.env.META_ADS_TOKEN) {
    checagens.push(checar('Meta Ads', async () => {
      const t = encodeURIComponent(process.env.META_ADS_TOKEN);
      const texto = await pegar(`https://graph.facebook.com/v23.0/debug_token?input_token=${t}&access_token=${t}`);
      const info = JSON.parse(texto)?.data || {};
      if (info.is_valid === false) throw new Error(`token inválido: ${info.error?.message || 'sem detalhe'}`);
      // expires_at 0 = não expira (system user). Se tiver data, avisa com antecedência.
      if (info.expires_at) {
        const dias = Math.round((info.expires_at * 1000 - Date.now()) / 86400000);
        if (dias <= 15) throw new Error(`token expira em ${dias} dia(s) — renovar antes que o funil zere`);
        return `válido, expira em ${dias} dias`;
      }
      return 'válido (system user, sem expiração)';
    }));
  }

  // ── ZapSign: lista 1 documento só para provar que o token é aceito ──
  if (process.env.ZAPSIGN_TOKEN) {
    checagens.push(checar('ZapSign', async () => {
      await pegar(`https://api.zapsign.com.br/api/v1/docs/?api_token=${encodeURIComponent(process.env.ZAPSIGN_TOKEN)}&page=1`);
      return 'API respondendo com o token';
    }));
  }

  // ── ADVBOX: /settings é leitura pura e barata ──
  if (process.env.ADVBOX_TOKEN) {
    checagens.push(checar('ADVBOX', async () => {
      await pegar('https://app.advbox.com.br/api/v1/settings', {
        headers: { Authorization: `Bearer ${process.env.ADVBOX_TOKEN}` },
      });
      return 'settings acessível';
    }));
  }

  // ── Asaas: /finance/balance é o mais leve que exige a chave ──
  if (process.env.ASAAS_API_KEY) {
    checagens.push(checar('Asaas', async () => {
      await pegar('https://api.asaas.com/v3/finance/balance', {
        headers: { access_token: process.env.ASAAS_API_KEY },
      });
      return 'chave aceita';
    }));
  }

  const resultados = await Promise.all(checagens);
  const quebrados = resultados.filter((r) => !r.ok);

  for (const r of resultados) {
    await logAdvbox('tokens', r.ok ? 'info' : 'erro',
      `Credencial ${r.nome}: ${r.ok ? 'OK' : 'FALHOU'} — ${r.detalhe}`, { integracao: r.nome });
  }

  if (quebrados.length) {
    // Token quebrado é o tipo de falha que se disfarça de "mês fraco": merece e-mail.
    // `sendCriticalAlert(assunto, linhas[])` — a lib monta a lista em HTML; passar uma
    // string unica viraria um item so, com as quebras de linha perdidas.
    await sendCriticalAlert(
      `${quebrados.length} credencial(is) de integracao com problema`,
      [
        ...quebrados.map((r) => `${r.nome}: ${r.detalhe}`),
        'Enquanto a credencial nao for renovada, os dados dessa integracao param de atualizar — e as telas seguem mostrando os numeros antigos, sem aviso.',
      ],
    ).catch(() => {});
  }

  const resumo = resultados.map((r) => `${r.nome}:${r.ok ? 'ok' : 'FALHOU'}`).join(' ');
  await heartbeat('tokens-vigia-cron', quebrados.length === 0, resumo);
  return json(200, { ok: quebrados.length === 0, checadas: resultados.length, resultados });
};
