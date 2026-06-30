# 🚨 Runbook de Emergência — CBC Contratos

> **Manual de "o que fazer quando algo dá errado"**, em linguagem simples.
> Pensado para você (Paulo) ou qualquer pessoa da equipe agir sob pressão, mesmo sem ser técnico.
> Atualizado em 31/05/2026 (produção v6.4.0).

## Como usar este manual
1. Ache o sintoma na lista abaixo (o que o usuário está vendo).
2. Siga os passos **na ordem**, do mais simples ao mais técnico.
3. Se chegar no fim de uma seção e não resolveu, chame o desenvolvedor (Claude Code) com o print do erro.

## 🔗 Links que você vai usar
- **Site (produção):** https://contratos-cbc.netlify.app
- **Painel Netlify (hospedagem):** https://app.netlify.com/projects/contratos-cbc
- **Logs das funções:** https://app.netlify.com/projects/contratos-cbc/logs/functions
- **Painel Supabase (banco):** https://supabase.com/dashboard/project/vygczeepvoyaehfchxko
- **Status do Supabase:** https://status.supabase.com
- **Status do Netlify:** https://www.netlifystatus.com
- **Pasta do projeto no Mac:** `/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos`

---

## 1. 🌐 O site não abre / está fora do ar

**Sintoma:** a página não carrega, dá erro, ou fica em branco para todos.

1. **Confirme se é só você:** abra o site no celular (4G, fora do Wi-Fi) ou peça pra alguém testar. Se abre pra outros, é a sua internet/navegador — limpe o cache (Ctrl+Shift+R) e tente de novo.
2. **Veja se o Netlify caiu:** abra https://www.netlifystatus.com. Se estiver com incidente, é geral — só esperar (não há o que fazer).
3. **Veja o último deploy:** https://app.netlify.com/projects/contratos-cbc/deploys. Se o último deploy está "Failed" (vermelho) ou quebrou o site:
   - **Reverter para a versão anterior (rollback):** abra o Terminal e cole:
     ```bash
     cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client"
     ./rollback.sh
     ```
   - Isso volta para o último deploy que funcionava. Aguarde ~1 min e teste o site.
4. Se ainda assim não voltar, chame o desenvolvedor com o print da tela de erro.

---

## 2. 🐢 Site lento / "estourou o limite" (bandwidth)

**Sintoma:** site lento para todos, ou aviso da Netlify de limite atingido (plano Pro = 1TB/mês).

1. **Cheque o uso:** no Terminal:
   ```bash
   cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client"
   ./check-bandwidth.sh
   ```
2. Se está perto/acima de 1TB: o maior consumidor histórico é o **polling do ZapSign** e a **aba de Leads**. Reduza o uso (peça pra equipe não deixar abas abertas à toa) e avise o desenvolvedor para acelerar as otimizações pendentes (webhook ZapSign, etc.).
3. Em último caso, a Netlify cobra excedente — não derruba o site na hora. Sem pânico.

---

## 3. 🗄️ Banco de dados (Supabase) com problema

**Sintoma:** "Erro ao carregar dados", listas vazias, nada salva.

1. **Veja se o Supabase caiu:** https://status.supabase.com. Se tiver incidente, é geral — esperar.
2. **Veja erros no banco:** painel Supabase → menu **Logs** → **Postgres / API**. Procure mensagens em vermelho recentes.
3. **Erro de permissão ("row-level security" / "permission denied"):** significa que uma operação foi barrada pelas regras de acesso (RLS). Isso pode acontecer depois de mexer em políticas. Chame o desenvolvedor — é correção de RLS (rápida, mas técnica).
4. **Banco "pausado":** projetos Supabase no plano grátis pausam após inatividade. No painel, se aparecer "Project paused", clique em **Restore/Resume**.

---

## 4. ✍️ Assinaturas não funcionam (ZapSign)

**Sintoma:** contrato não vai para assinatura, ou status não atualiza após o cliente assinar.

1. **Status do ZapSign:** confira no painel do ZapSign se o serviço está no ar e se ainda há saldo/documentos disponíveis no plano.
2. **Token expirado:** se o envio falha com erro de autenticação, o token do ZapSign pode ter expirado. Precisa renovar no ZapSign e atualizar no Netlify (variável `ZAPSIGN_TOKEN`). Chame o desenvolvedor.
3. **Assinou mas não atualizou no sistema:** o sistema confere a cada 5 min como backup. Espere 5 min. Se não atualizar, abra o contrato → use o botão de **reprocessar/atualizar status**. Se persistir, o webhook do ZapSign pode estar desconfigurado — chame o desenvolvedor.

---

## 5. 💰 Cobranças / Boletos (Asaas) com problema

**Sintoma:** inadimplência/boletos com números errados ou desatualizados; boleto não gerado.

1. **Números desatualizados na aba Boletos:** clique no botão **"Sync Asaas"** dentro da aba para forçar a atualização.
2. **Se o sync der erro de permissão:** isso aconteceu em maio/2026 — a função grava no banco como "anônimo" e o RLS bloqueava. **Solução definitiva:** configurar a `SUPABASE_SERVICE_ROLE_KEY` no Netlify (ver seção 9). Enquanto isso, há policies temporárias (`temp_anon_*`) que mantêm funcionando.
3. **NF (nota fiscal) não emitida:** a NF sai automaticamente quando o pagamento é confirmado (via webhook do Asaas). Se faltou, confira nos logs das funções (`asaas-webhook`). Pode reemitir manualmente pelo painel do Asaas.
4. **Conferência:** o número de inadimplência do sistema pode diferir do site do Asaas porque o sistema conta "tudo vencido e não pago" e o Asaas conta o status formal "OVERDUE" + juros. Os dois estão certos para definições diferentes (documentado).

---

## 6. ⚙️ Automações travadas (ADVBOX / Google Drive)

**Sintoma:** contrato assinado mas não foi para o ADVBOX, ou PDF não arquivou no Drive.

1. **Abra a aba "Monitor"** — ela mostra as filas e os erros das últimas 24h.
2. **Contrato travado em "uploading" (Drive):** o sistema solta sozinho travas órfãs após 5 min e tenta de novo. Espere. Se não, use o botão de **reprocessar** no contrato.
3. **ADVBOX não recebeu o processo:** confira no Monitor se há erro. Tente reprocessar. Se o token do ADVBOX expirou, precisa renovar (chame o desenvolvedor).
4. **As automações só rodam com alguém usando o sistema** (rodam no navegador a cada 5 min). Se ninguém abriu o sistema, elas não rodam — abra e deixe aberto por alguns minutos.

---

## 7. 🔐 "Não consigo acessar uma aba" / permissões

1. Cada usuário tem permissões (quais abas vê). Quem ajusta é o **admin** (você, paulo@advocaciacbc.com) na **aba Admin**.
2. Se um usuário novo não vê nada: confira na aba Admin se ele tem as abas marcadas.
3. **Você (Paulo) é admin-mestre e nunca deve perder o acesso.** Se isso acontecer, é um problema de RLS/permissão — chame o desenvolvedor.

---

## 8. ↩️ Como reverter um deploy ruim (rollback)

Se uma atualização quebrou algo:
```bash
cd "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client"
./rollback.sh
```
Volta para a última versão que funcionava (~1 min). O número da versão de rollback aparece no fim de cada deploy (guardado em `.last-working-deploy`).

---

## 9. 🔑 Configurar a chave de serviço (resolve vários problemas de fundo)

Muitos problemas de gravação no banco (boletos, lembretes, automações) vêm de a `SUPABASE_SERVICE_ROLE_KEY` **não estar configurada** no Netlify. Como resolver:

**A) Pegar a chave (Supabase):**
1. Abra: https://supabase.com/dashboard/project/vygczeepvoyaehfchxko/settings/api
2. Em **"Project API keys"**, ache **`service_role`** (aviso vermelho "secret"). Clique no olhinho 👁 para revelar e em **Copy**.
   > ⚠️ Chave secreta — nunca cole em chat/e-mail/print. Só no Netlify.

**B) Colar (Netlify):**
1. Abra: https://app.netlify.com/projects/contratos-cbc/configuration/env
2. **Add a variable** → Key: `SUPABASE_SERVICE_ROLE_KEY` → Value: cole a chave → **Create**.

**C)** Avise o desenvolvedor para fazer o redeploy e fechar a segurança (RLS).

---

## 10. 🆘 Quando e como chamar o desenvolvedor

Chame (Claude Code) quando:
- O rollback não resolveu.
- Há erro de RLS/permissão.
- Token de integração expirou (ZapSign/ADVBOX/Asaas).
- Qualquer erro que você não entende.

**O que enviar junto:** print da tela do erro + o que você estava fazendo + horário. Quanto mais detalhe, mais rápido resolve.

---

## ⚠️ Regras de ouro (nunca faça sob pânico)
- **Nunca apague dados** (contratos, boletos, clientes) tentando "limpar" um problema.
- **Nunca rode comandos** que você não entende copiados da internet.
- **Sempre tente o rollback primeiro** — é seguro e reversível.
- Backups do banco rodam **todo dia às 03:00** (local + S3). Em caso extremo, dá para restaurar (com o desenvolvedor).
