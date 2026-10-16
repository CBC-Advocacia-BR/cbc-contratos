# Resumo automático das videochamadas (Claude)

Criado em 16/10/2026. **Status: código pronto na branch, ainda NÃO publicado e NÃO ligado.**

## O que faz

Depois de cada videochamada de venda **realizada** (as mesmas que o funil já conta em
`agenda_videochamadas`), a rotina:

1. acha a transcrição do Meet no Google da vendedora (anexo do convite ou pasta Meet Recordings);
2. lê o documento como texto (a transcrição **não** é copiada para o banco);
3. pede ao Claude a ficha do atendimento: dados do contrato do resort, temperatura, objeções,
   próximo passo com data, documentos pendentes, perguntas que faltaram, alertas e a nota para o Kommo;
4. grava tudo em `call_resumos`;
5. alertas de **compliance** (promessa de resultado etc.) vão para o console do Monitor (origem `ia`),
   nunca para a nota do Kommo;
6. se `postar_kommo` estiver ligado e a call tiver lead reconciliado, posta a nota no lead
   (marcador `CBC.call:<event_id>`, nunca duplica).

Nada disso fala com o cliente.

## Peças

| Arquivo | Papel |
|---|---|
| `client/netlify/functions/call-resumo-cron.mjs` | agenda (de hora em hora, :20, 08h20-21h20 BRT, seg-sáb) |
| `client/netlify/functions/call-resumo-worker-background.mjs` | trabalho (background, até 15 min) |
| `client/netlify/functions/_lib/callResumo.mjs` | instruções ao Claude, formato da resposta, nota, custo (puro, testado) |
| `client/netlify/functions/_lib/googleSa.mjs` | conta de serviço: token como a vendedora, achar e ler a transcrição |
| `supabase_call_resumo.sql` | tabela `call_resumos`, RPCs e configuração (nasce desligada) |
| `client/src/utils/__tests__/callResumo.test.js` | 20 testes |

## Para ligar (na ordem)

1. **Chave da Anthropic**: criar em console.anthropic.com e cadastrar `ANTHROPIC_API_KEY` no Netlify.
2. **Conta de serviço Google** (super admin):
   - console.cloud.google.com: projeto, ativar **Google Drive API** e **Google Calendar API**,
     criar conta de serviço e uma chave JSON;
   - admin.google.com → Segurança → Controles de acesso e dados → Controles de API →
     **Delegação em todo o domínio** → ID do cliente da conta de serviço, escopos:
     `https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/drive.readonly`;
   - cadastrar o JSON no Netlify como `GOOGLE_SA_KEY_JSON` (texto puro ou base64).
3. **Banco**: aplicar `supabase_call_resumo.sql`.
4. **Deploy** pelo `client/deploy.sh`.
5. **Conferência de uma call**, antes de ligar a rotina (funciona com ela desligada):
   ```bash
   curl -X POST "https://contratos-cbc.netlify.app/.netlify/functions/call-resumo-worker-background?event_id=<EVENT_ID>" \
     -H "x-bot-key: SUA_BOT_PANEL_KEY"
   ```
   Resultado em `select status, resumo, nota_kommo, custo_usd from call_resumos where event_id='<EVENT_ID>';`
6. Ligar a rotina **sem postar no Kommo** (fase de conferência, sugestão: 1 semana):
   `update bot_config set value = value || '{"ativo": true}' where key='call_resumo';`
7. Conferidas as fichas, ligar a nota no Kommo:
   `update bot_config set value = value || '{"postar_kommo": true}' where key='call_resumo';`

## Configuração (`bot_config.call_resumo`)

| Chave | Padrão | O que faz |
|---|---|---|
| `ativo` | `false` | liga/desliga a rotina inteira |
| `postar_kommo` | `false` | posta a nota no lead do Kommo |
| `modelo` | `claude-opus-5-5` | trocar por `claude-sonnet-5-5` reduz o custo pela metade |
| `esforco` | `medium` | `low`, `medium` ou `high` |
| `max_por_rodada` | `8` | teto de calls por rodada |
| `dias` | `3` | janela de calls olhadas para trás |

## Custo esperado

~200 calls/mês, de 12 a 20 mil tokens de entrada e ~3 mil de saída cada:
**cerca de US$ 24/mês com Opus 5.5** ou **US$ 12/mês com Sonnet 5.5**. A estimativa por call fica
em `call_resumos.custo_usd`.

## Cuidados

- `GOOGLE_SA_KEY_JSON` lê o Drive de **qualquer** conta do domínio. O código só aceita agir como
  as vendedoras de `googleAgenda.VENDEDORAS`; mesmo assim, a chave fica só no Netlify e deve ser
  apagada se a rotina for desativada.
- Status `sem_transcricao` repete até 8 vezes (a cada ~1h). Se ficar nele, a vendedora está com a
  transcrição do Meet desligada.
- `call_resumos` tem RLS ligada sem policy: só as RPCs (com `BOT_RPC_SECRET`) leem e gravam.
  Uma tela para a gestão ver os resumos e alertas é o próximo passo.
