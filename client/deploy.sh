#!/bin/bash
[ -f "$HOME/.cbc-netlify-token" ] && . "$HOME/.cbc-netlify-token"
: "${NETLIFY_AUTH_TOKEN:?defina ~/.cbc-netlify-token ou rode: npx netlify login}"
# Deploy script para CBC Contratos
# Uso: ./deploy.sh [--force]
#
# Sempre faz deploy DIRETO EM PRODUCAO (sem preview intermediario,
# para economizar bandwidth na Netlify).

set -e

NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN}"
SITE_ID="d7b38821-22e9-4308-8fda-a8f124a65b72"
SITE_NAME="contratos-cbc"

# (auditoria #95) Por padrao, se o smoke-test pos-deploy falhar, revertemos sozinhos
# para o ultimo deploy OK. Use --no-auto-rollback para inspecionar um deploy quebrado.
AUTO_ROLLBACK=1
for arg in "$@"; do
  case "$arg" in
    --no-auto-rollback) AUTO_ROLLBACK=0 ;;
  esac
done

cd "$(dirname "$0")"

echo "=== CBC Contratos Deploy ==="
echo "Site: $SITE_NAME (.netlify.app)"
echo ""

# 0. TRAVA ANTI-REGRESSAO (incidente 02/07/2026: build com o repo no main antigo
# publicou o app de MARCO — tela antiga + login apontando p/ backend Render morto).
# Sentinelas: o AuthContext atual importa lib/supabase; o chat do portal existe.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
if ! grep -q "from './lib/supabase'" src/AuthContext.jsx 2>/dev/null; then
  echo "🛑 ABORTADO: src/ parece ser a versao ANTIGA (marco/2026) — AuthContext sem Supabase."
  echo "   Branch atual: $BRANCH. Volte ao codigo de producao (main atualizado)"
  echo "   ou restaure de backups/. NAO deploye este estado."
  exit 1
fi
if [ ! -f "netlify/functions/portal-chat.mjs" ]; then
  echo "🛑 ABORTADO: netlify/functions/portal-chat.mjs ausente — worktree incompleto."
  echo "   Restaure as funcoes do chat (backups/20260702_054729_pre_checkout_recuperacao)."
  exit 1
fi
if ! grep -qi "conversas" portal.html 2>/dev/null; then
  echo "🛑 ABORTADO: portal.html (raiz do client/, entry do Vite) sem a aba Conversas."
  echo "   O canonico do portal e client/portal.html — nao o public/. Ver CHAT-PORTAL.md."
  exit 1
fi
echo "   ✓ sanidade do codigo-fonte OK (branch: $BRANCH)"

# 1. Salvar deploy atual antes de fazer o novo (rollback de emergencia)
echo "[1/4] Salvando deploy atual como backup de rollback..."
CURRENT_DEPLOY=$(curl -s -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites/$SITE_ID" | \
  python3 -c "import json,sys; print(json.load(sys.stdin).get('published_deploy',{}).get('id',''))")

if [ -n "$CURRENT_DEPLOY" ]; then
  echo "   Ultimo deploy OK: $CURRENT_DEPLOY (rollback: ./rollback.sh $CURRENT_DEPLOY)"
  echo "$CURRENT_DEPLOY" > .last-working-deploy
else
  echo "   AVISO: nao foi possivel obter ultimo deploy"
fi

# 2. Testes (portao — aborta o deploy se algum teste falhar) (bug-9)
echo ""
echo "[2/5] Rodando testes (vitest)..."
npm test

# 3. Build
echo ""
echo "[3/5] Rodando build..."
npm run build

# (auditoria #91) Sanidade do build: complementa as sentinelas de texto com uma
# verificacao de COMPORTAMENTO — dist tem que existir com index.html e um bundle JS
# de tamanho plausivel. Um build "verde" mas vazio/quebrado nao passa mais batido.
if [ ! -f dist/index.html ]; then
  echo "🛑 ABORTADO: dist/index.html nao existe apos o build."
  exit 1
fi
JS_BYTES=$(find dist/assets -name '*.js' -exec cat {} + 2>/dev/null | wc -c | tr -d ' ')
if [ "${JS_BYTES:-0}" -lt 200000 ]; then
  echo "🛑 ABORTADO: bundle JS suspeito (${JS_BYTES:-0} bytes < 200KB) — build provavelmente quebrado."
  exit 1
fi
echo "   ✓ build sanity OK (JS ~$((JS_BYTES/1024)) KB)"

# 4. Verificar tamanho do bundle (alerta se gigante)
echo ""
echo "[4/5] Tamanhos dos bundles:"
du -sh dist/assets/*.js 2>/dev/null | sort -hr | head -10

# 5. Deploy direto em producao (sem preview draft)
echo ""
echo "[5/5] Publicando em producao..."
# (25/06) netlify-cli 26+ devolve "Project not found. Please rerun netlify link" quando
# se passa --site=<id> no deploy. A via confiavel e o estado LINKADO (.netlify/state.json).
# Garantimos o vinculo correto de forma idempotente (funciona ate em checkout novo) e
# publicamos SEM --site.
mkdir -p .netlify
printf '{\n\t"siteId": "%s"\n}\n' "$SITE_ID" > .netlify/state.json
NETLIFY_AUTH_TOKEN="$NETLIFY_AUTH_TOKEN" npx netlify-cli deploy \
  --prod \
  --dir=dist \
  --functions=netlify/functions \
  --message="$(date +%Y-%m-%d_%H:%M) deploy"

echo ""
echo "=== DEPLOY CONCLUIDO ==="
echo "URL: https://${SITE_NAME}.netlify.app"
echo "Rollback: ./rollback.sh $CURRENT_DEPLOY"

# 6. Smoke test pos-deploy (bug-9): confirma que o site e a funcao health respondem.
# Nao usa 'set -e' aqui — um smoke falho AVISA e sugere rollback, nao mata o script.
echo ""
echo "[smoke] Verificando producao..."
SMOKE_OK=1
HOME_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${SITE_NAME}.netlify.app/" || echo "000")
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${SITE_NAME}.netlify.app/api/health" || echo "000")
echo "   home: HTTP $HOME_CODE · health: HTTP $HEALTH_CODE"
[ "$HOME_CODE" = "200" ] || SMOKE_OK=0
case "$HEALTH_CODE" in 200|204|404) ;; *) SMOKE_OK=0 ;; esac
if [ "$SMOKE_OK" = "1" ]; then
  echo "   ✅ smoke OK"
else
  echo "   ⚠️  SMOKE FALHOU (home=$HOME_CODE health=$HEALTH_CODE)."
  if [ "$AUTO_ROLLBACK" = "1" ] && [ -n "$CURRENT_DEPLOY" ]; then
    # (auditoria #95) reverte sozinho para o ultimo deploy OK — nao deixa site quebrado no ar.
    echo "   ↩️  AUTO-ROLLBACK: restaurando $CURRENT_DEPLOY..."
    RB_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
      "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys/$CURRENT_DEPLOY/restore")
    echo "   restore HTTP $RB_CODE — revertido para o ultimo deploy OK."
    echo "   (Para publicar mesmo assim e inspecionar: ./deploy.sh --no-auto-rollback)"
  else
    echo "   Para reverter: ./rollback.sh $CURRENT_DEPLOY"
  fi
fi
