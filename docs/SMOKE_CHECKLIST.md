# Smoke Checklist — Pós-Deploy

Rodar este checklist **após cada deploy** (`./deploy.sh`). Tempo estimado: 5 minutos.

Se qualquer item falhar → **rollback imediato** (`./rollback.sh`) e investigar com calma.

---

## 1. Build saudável (1 min)

- [ ] Saída do `deploy.sh` mostra `=== DEPLOY CONCLUIDO ===` sem erro
- [ ] `dist/assets/*.js` — nenhum chunk maior que ~500KB (ver tabela do `[3/4]`)
- [ ] URL https://contratos-cbc.netlify.app responde 200

## 2. Login funciona (30s)

- [ ] Abrir https://contratos-cbc.netlify.app em aba anônima
- [ ] Tela de login carrega com logo e campos
- [ ] Login com `paulo@advocaciacbc.com` funciona
- [ ] Console DevTools sem erro vermelho

## 3. Abas críticas abrem (1 min)

Para cada aba, clicar e confirmar que renderiza sem erro:

- [ ] **Novo** — wizard mostra Step 1
- [ ] **Contratos** — lista carrega (mesmo que vazia)
- [ ] **Dashboard** — KPIs aparecem (números, não skeleton infinito)
- [ ] **Monitor** — health indicators aparecem (verde/amarelo)
- [ ] **Admin** (se você for admin) — lista de usuários
- [ ] **Leads** (se tiver permissão) — lista carrega

## 4. Fluxo de criação (1 min)

- [ ] Aba Novo → Step 1 → escolher 1 contratante
- [ ] Step 2 → preencher nome + CPF (qualquer válido)
- [ ] Step 3 → escolher resort
- [ ] **Não clicar em "Salvar"** — só validar que o wizard avança sem travar
- [ ] Cancelar / fechar form

## 5. Realtime + Supabase (30s)

- [ ] DevTools → Network → filtrar `wss://` ou `realtime`
- [ ] Conexão WebSocket Supabase ativa (status 101)
- [ ] DevTools → Console — sem erro `WebSocket closed` ou `connection refused`

## 6. Bandwidth (30s)

- [ ] `./check-bandwidth.sh` retorna `Status: OK`
- [ ] Se acima de 50%, anotar valor para acompanhar tendência

## 7. Sentry (30s)

- [ ] (Quando Sentry estiver configurado) Painel Sentry mostra zero erros novos nos últimos 5 minutos
- [ ] Não há erro listado com `release` igual ao deploy atual

## 8. Funções Netlify críticas (30s)

Abrir DevTools → Network e exercitar:

- [ ] Aba Monitor → health check mostra os 4 serviços (Supabase, Asaas, ZapSign, Apps Script). ChatGuru foi removido em 23/05/2026.
- [ ] Nenhuma chamada a `/.netlify/functions/*` ou `/api/*` retornando 5xx

---

## Se um item falhar

1. Anotar **qual item, hora, e mensagem de erro** (screenshot do console se possível)
2. Rodar `./rollback.sh` (usa `.last-working-deploy` automaticamente)
3. Confirmar smoke #1, #2, #3 voltaram a funcionar após rollback
4. Investigar com calma o que falhou — corrigir → novo deploy → smoke novamente

## Quando deploy é "alto risco"

Se a mudança tocou: `App.jsx`, `AuthContext.jsx`, `ContractContext.jsx`, `FormPanel.jsx`, `Dashboard.jsx`, `ContratosTab.jsx`, schema Supabase, ou função Netlify que dispara automação:

- Rodar smoke completo
- **Observar 1h** antes de fechar
- Voltar e checar Sentry/console novamente após 1h
