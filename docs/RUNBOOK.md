# Runbook de Incidentes — CBC Contratos

Procedimentos de resposta para incidentes operacionais. Use quando algo estiver quebrado em produção.

> **Antes de tudo**: tem um incidente real acontecendo? Verifique [docs/SMOKE_CHECKLIST.md](SMOKE_CHECKLIST.md) primeiro pra confirmar o sintoma.

---

## Índice

1. [Site fora do ar (502/503/504)](#1-site-fora-do-ar)
2. [Login não funciona](#2-login-nao-funciona)
3. [Supabase indisponível](#3-supabase-indisponivel)
4. [ZapSign indisponível ou erro 401](#4-zapsign-indisponivel-ou-erro-401)
5. [Asaas indisponível](#5-asaas-indisponivel)
6. ~~ChatGuru indisponível~~ — removido em 23/05/2026
7. [Google Apps Script (Drive) indisponível](#7-google-apps-script-drive-indisponivel)
8. [ADVBOX indisponível](#8-advbox-indisponivel)
9. [Contrato travado em "uploading" (Drive)](#9-contrato-travado-em-uploading-drive)
10. [Contrato com automação ADVBOX presa](#10-contrato-com-automacao-advbox-presa)
11. [Bandwidth Netlify acima de 80%](#11-bandwidth-netlify-acima-de-80)
12. [Erro pós-deploy descoberto >5min depois](#12-erro-pos-deploy-descoberto-tarde)
13. [Suspeita de vazamento de token](#13-suspeita-de-vazamento-de-token)
14. [Login em horário/local anômalo (alerta)](#14-login-anomalo)

---

## 1. Site fora do ar

**Sintoma**: https://contratos-cbc.netlify.app retorna 5xx ou não carrega.

### Diagnóstico
```bash
curl -sI https://contratos-cbc.netlify.app | head -3
```

### Resposta

1. **Status do Netlify**: https://www.netlifystatus.com/ — se for incidente do provider, **aguardar** (não há como acelerar).
2. **Se Netlify OK**, verificar último deploy: https://app.netlify.com/projects/contratos-cbc/deploys
3. **Se último deploy é o suspeito**:
   ```bash
   cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client"
   ./rollback.sh
   ```
4. Avisar usuários ativos no WhatsApp se downtime > 5 min.

### Pós-incidente
- Anotar timestamp + causa em [INCIDENTS.md](#registro-de-incidentes-criar-conforme-acontecem)
- Se causa for build com `--prod` ruim: documentar o erro e adicionar ao smoke checklist

---

## 2. Login não funciona

**Sintoma**: usuário válido recebe "credenciais inválidas" ou tela trava após enviar.

### Diagnóstico
1. Aba anônima — descarta cache local
2. Console DevTools (F12) — buscar erro com `supabase.co/auth`
3. Testar com seu email (admin)

### Resposta

| Causa provável | Ação |
|---|---|
| Supabase down | Ver seção 3 |
| Token JWT expirado em massa | Limpar `localStorage.clear()` no console e relogar |
| Domínio Supabase rotacionado | Verificar `VITE_SUPABASE_URL` em `client/src/lib/supabase.js` ainda aponta pra projeto certo |
| Política RLS bloqueando | Supabase Studio → Auth → Logs |

### Acesso de emergência
Se ninguém consegue logar e há trabalho urgente: usar Supabase Studio direto (https://supabase.com/dashboard/project/vygczeepvoyaehfchxko) para visualizar/editar dados.

---

## 3. Supabase indisponível

**Sintoma**: Health check Monitor mostra Supabase como erro. App carrega mas não busca dados.

### Diagnóstico
```bash
curl -s "https://vygczeepvoyaehfchxko.supabase.co/rest/v1/contratos?select=id&limit=1" \
  -H "apikey: $(grep VITE_SUPABASE_ANON_KEY client/src/lib/supabase.js | head -1)"
```

### Resposta

1. **Status Supabase**: https://status.supabase.com/
2. Se for outage: nada a fazer no nosso lado, só aguardar.
3. Se for problema de quota (free tier): considerar upgrade emergencial em https://supabase.com/dashboard/project/vygczeepvoyaehfchxko/settings/billing
4. Comunicar usuários: "Sistema temporariamente indisponível devido a problema no banco. ETA: aguardando."

### Mitigação parcial
- ContratosTab tem cache IndexedDB dos últimos 100 contratos (resiliência 28/04). Usuário pode visualizar offline mas não criar novos.

---

## 4. ZapSign indisponível ou erro 401

**Sintoma**:
- Aba Monitor: ZapSign como erro
- Ao enviar contrato: "Falha ao enviar para assinatura"

### Diagnóstico
```bash
curl -s "https://api.zapsign.com.br/api/v1/docs/?api_token=TOKEN&limit=1"
```

### Resposta

| Erro | Causa | Ação |
|---|---|---|
| 401 | Token revogado/expirado | Painel ZapSign → renovar token → atualizar `ZAPSIGN_TOKEN` no Netlify |
| 5xx | Outage ZapSign | Aguardar; status: https://status.zapsign.com.br |
| Timeout | Rate limit | Aguardar 5min, tentar de novo |

### Fallback
- Contratos podem ser baixados como PDF/DOCX e enviados manualmente pelo botão "Baixar contrato".
- Comunicar cliente que assinatura digital está indisponível e usar via tradicional temporariamente.

---

## 5. Asaas indisponível

**Sintoma**: Boletos não geram após assinatura. Aba Monitor → Asaas vermelho.

### Diagnóstico
```bash
curl -s "https://api.asaas.com/v3/customers?limit=1" -H "access_token: TOKEN"
```

### Resposta

| Erro | Ação |
|---|---|
| 401 | Renovar `ASAAS_API_KEY` no painel Asaas + atualizar Netlify env |
| Conta com restrição (compliance) | Contatar suporte Asaas pelo painel |
| 5xx | Status: https://status.asaas.com — aguardar |

### Fallback
Boleto pode ser gerado manualmente no painel Asaas pelo CPF do cliente. Linha digitável copia/cola pro WhatsApp.

---

## 6. ~~ChatGuru indisponível~~ — REMOVIDO (23/05/2026)

ChatGuru foi removido do sistema em 23/05/2026 (v6.4.0). Migração para Kommo em andamento.

**Sintoma**: cliente reclama que nao recebeu mensagem automatica de WhatsApp.

**Resposta atual**: confirmar manualmente via conversa Kommo. Envio automatico
de WhatsApp NAO existe mais — operador envia link/mensagem via conversa Kommo
do contratante (campo `linkKommo` no contrato).

Templates HSM aprovados pelo Meta + integracao Chats API Kommo planejados
para v6.5.0 (envio automatico de volta).

---

## 7. Google Apps Script (Drive) indisponível

**Sintoma**: Contratos assinados ficam com `drive_file_id = 'failed'` ou `'uploading'`.

### Diagnóstico
- Logs Apps Script: https://script.google.com (selecionar o projeto CBC)
- Verificar quota do Google (limite de 6 min de execução, 6 horas/dia)

### Resposta

1. Se erro de quota (limite diário Google): aguardar próximo dia BRT.
2. Se script com erro:
   - Abrir Apps Script → Editor
   - Deploy → New deployment → atualizar URL
   - Atualizar URL em `client/netlify/functions/save-to-drive.mjs` se mudou

### Recovery
Após Apps Script voltar:
```sql
-- Liberar contratos travados em 'uploading' há >5min (já automático no App.jsx, mas força manual aqui)
UPDATE contratos SET drive_file_id = NULL WHERE drive_file_id = 'uploading' AND drive_last_attempt_at < now() - interval '5 minutes';
```

App.jsx vai retentar automaticamente.

---

## 8. ADVBOX indisponível

**Sintoma**: Contratos assinados não aparecem no ADVBOX. `advbox_status` fica null/processing.

### Diagnóstico
Logs da function: https://app.netlify.com/projects/contratos-cbc/logs/functions → `advbox-sync`

### Resposta

| Erro | Ação |
|---|---|
| 401 | **Token comprometido** (já está hardcoded no bundle frontend!). Rotacionar em ADVBOX painel + atualizar `ADVBOX_TOKEN` no Netlify + atualizar fallback hardcoded em `client/src/utils/advboxService.js:6` (idealmente: remover o fallback) |
| 5xx | Aguardar |

### Recovery
Após ADVBOX voltar, rerun manual via Aba Monitor → "Retry ADVBOX" no contrato afetado.

---

## 9. Contrato travado em "uploading" (Drive)

**Sintoma**: Cliente assinou, mas no painel está há horas como "uploading" ou contrato não aparece no Drive.

### Resposta

1. **Auto-recovery já existe** ([App.jsx:349-360](../client/src/App.jsx)): se `drive_file_id = 'uploading'` por >5min, libera lock e retenta. Aguardar 10 min antes de intervir.
2. Se persistir após 10 min:
   ```sql
   -- Reset manual no Supabase Studio
   UPDATE contratos SET drive_file_id = NULL, drive_attempts = 0
   WHERE id = 'UUID_DO_CONTRATO_AQUI';
   ```
3. App.jsx vai retentar.
4. Se falhar 3+ vezes, ver logs `save-to-drive` no Netlify e contatar suporte Apps Script.

---

## 10. Contrato com automação ADVBOX presa

**Sintoma**: Status `advbox_status = 'processing'` há >10min.

### Resposta
```sql
-- No Supabase Studio
UPDATE contratos SET advbox_status = NULL
WHERE id = 'UUID' AND advbox_status = 'processing';
```

App.jsx detecta e retenta. Se persistir, ver seção 8.

---

## 11. Bandwidth Netlify acima de 80%

**Sintoma**: `./check-bandwidth.sh` alerta + notificação macOS.

### Resposta imediata

1. **Identificar ofensor**: Netlify dashboard → Analytics → top assets/functions
2. **Mitigação rápida**:
   - Pausar `keep-warm` cron (Netlify dashboard → Functions → keep-warm → disable schedule)
   - Pausar `datajud-refresh` se ofensor (Netlify dashboard)
3. Se >95% e fim do mês perto: avaliar upgrade temporário ou aceitar overage ($55/100GB).

### Análise pós-incidente
Auditar com [client/check-bandwidth.sh](../client/check-bandwidth.sh) histórico. Causa comum:
- Polling não-otimizado (ZapSign, Leads)
- `select('*')` em listas com `dados` JSONB grande
- Imagens não comprimidas

Implementar mitigação no próximo batch.

---

## 12. Erro pós-deploy descoberto tarde

**Sintoma**: Deploy foi feito há >1h, agora descobriu bug.

### Resposta

1. **Avaliar criticidade**:
   - **Crítico** (login quebrado, contratos não salvam): rollback imediato (`./rollback.sh`)
   - **Não-crítico** (visual bug, feature secundária): fix forward com novo deploy
2. **Comunicar** se afeta usuários ativos no WhatsApp do escritório
3. **Após resolver**: registrar em incidents

### Como saber se rollback é seguro
- Se nenhum dado novo foi gravado dependendo da feature do deploy ruim: rollback seguro
- Se houve writes que dependem de schema novo: avaliar com mais cuidado (rollback do code mas não do DB)

---

## 13. Suspeita de vazamento de token

**Sintoma**: Cobranças/operações estranhas em ADVBOX, ZapSign, Asaas. Logs Sentry/Netlify mostram acessos suspeitos.

### Resposta imediata (em ordem)

1. **Revogar token comprometido** no painel do serviço (ADVBOX, ZapSign, Asaas, Kommo)
2. Gerar novo token
3. Atualizar Netlify env vars
4. Trigger redeploy: Netlify dashboard → Deploys → Trigger deploy → Clear cache and deploy
5. Auditar uso indevido nos logs do serviço afetado
6. Se houver dano financeiro: contatar suporte do serviço + considerar boletim de ocorrência

### Prevenção
- Tokens hardcoded no frontend (ADVBOX, CPF-API atualmente) **devem** ser movidos para Netlify Functions assim que possível.
- Rotacionar tokens trimestralmente como prática.

---

## 14. Login anômalo

**Sintoma**: `activity_log` registra login fora do horário (6h-23h BRT) ou fora do Brasil. Usuário reporta acesso não-feito.

### Resposta

1. **Forçar logout do usuário**:
   ```sql
   DELETE FROM active_sessions WHERE user_id = (SELECT id FROM auth.users WHERE email = 'EMAIL_AFETADO');
   ```
2. Pedir ao usuário pra resetar senha via "Esqueci a senha"
3. Verificar `audit_log` e `action_log` por ações suspeitas:
   ```sql
   SELECT * FROM action_log WHERE user_email = 'EMAIL' AND created_at > now() - interval '24 hours' ORDER BY created_at DESC;
   ```
4. Se houver alteração suspeita em contrato: usar `contratos_audit` para reverter pra versão anterior:
   ```sql
   SELECT before_data FROM contratos_audit WHERE contrato_id = 'UUID' AND changed_at < 'TIMESTAMP_DO_ATAQUE' ORDER BY changed_at DESC LIMIT 1;
   ```
5. Considerar habilitar 2FA via Supabase (em config Auth)

---

## Registro de incidentes (criar conforme acontecem)

Sugestão: criar `docs/INCIDENTS.md` com formato:

```markdown
## YYYY-MM-DD HH:MM — Título curto

**Sintoma**: o que o usuário viu
**Detectado por**: como (smoke, alerta, usuário)
**Causa raiz**: o que causou
**Resolução**: o que foi feito
**Tempo até resolução**: HH:MM
**Lições**: o que mudaria pra evitar
```

Reler `INCIDENTS.md` mensalmente para extrair padrões e prevenir recorrência.

---

## Contatos de emergência

- **Paulo Conforto**: paulo@advocaciacbc.com (admin master)
- **Netlify support**: https://www.netlify.com/support/
- **Supabase support**: https://supabase.com/support
- **ZapSign suporte**: WhatsApp do painel
- **Asaas suporte**: chat no painel
- **Kommo suporte**: chat no painel `advocaciacbc.kommo.com`
