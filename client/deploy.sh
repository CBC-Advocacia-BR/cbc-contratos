#!/bin/bash
[ -f "$HOME/.cbc-netlify-token" ] && . "$HOME/.cbc-netlify-token"
: "${NETLIFY_AUTH_TOKEN:?defina ~/.cbc-netlify-token ou rode: npx netlify login}"
# Deploy script para CBC Contratos
#
# Uso: ./deploy.sh [--no-auto-rollback] [--pular-instalacao]
#
#   --no-auto-rollback   nao reverte sozinho se o smoke pos-deploy falhar
#                        (use para inspecionar um deploy quebrado)
#   --pular-instalacao   nao roda `npm ci` antes de construir (mais rapido,
#                        mas usa o node_modules que estiver na maquina)
#   --ajuda              mostra este texto
#
# (auditoria 01/08/2026 — item 310) A ajuda documentava um `--force` que NUNCA
# existiu no codigo. Ler a ajuda e descobrir na pratica que o flag nao faz nada e
# pior do que nao ter ajuda.
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
INSTALAR=1
for arg in "$@"; do
  case "$arg" in
    --no-auto-rollback) AUTO_ROLLBACK=0 ;;
    --pular-instalacao) INSTALAR=0 ;;
    --ajuda|-h|--help)
      sed -n '4,12p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *)
      echo "🛑 Flag desconhecido: $arg  (use --ajuda)"
      exit 1 ;;
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

# (auditoria 01/08/2026 — item 165) As sentinelas acima sao de CONTEUDO: elas pegam o
# codigo de marco, mas nao impediriam deployar de uma branch de experimento com o
# conteudo certo. O incidente de 02/07 comecou exatamente assim. Agora o deploy exige
# confirmacao explicita quando a branch nao e uma das de trabalho, e avisa se ha
# alteracao nao commitada (o que sai daqui tem de existir no git — item 163).
case "$BRANCH" in
  main|agendamentos-design) ;;
  *)
    echo "⚠️  Branch atual: $BRANCH (o normal e main ou agendamentos-design)."
    printf "   Deployar assim mesmo? [s/N] "
    read -r resp < /dev/tty || resp=""
    case "$resp" in s|S|sim|Sim) ;; *) echo "🛑 Deploy cancelado."; exit 1 ;; esac ;;
esac
if [ -n "$(git status --porcelain -- src netlify portal.html 2>/dev/null)" ]; then
  echo "⚠️  Ha alteracoes NAO COMMITADAS em src/, netlify/ ou portal.html."
  echo "   O que for para producao precisa existir no git — senao so a sua maquina tem."
  git status --short -- src netlify portal.html | head -8
  printf "   Deployar assim mesmo? [s/N] "
  read -r resp < /dev/tty || resp=""
  case "$resp" in s|S|sim|Sim) ;; *) echo "🛑 Deploy cancelado. Commite antes."; exit 1 ;; esac
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

# (auditoria 01/08/2026 — item 308) O CI usa `npm ci`, que instala EXATAMENTE as
# versoes do package-lock. O deploy local nao reinstalava nada: usava o node_modules
# que estivesse na maquina, que pode estar velho ou ter pacote instalado a mao. Ou seja,
# o que o CI aprovava e o que ia para producao podiam ser arvores de dependencia
# diferentes — e a diferenca so apareceria em producao.
if [ "$INSTALAR" = "1" ]; then
  echo ""
  echo "[2/6] Instalando dependencias travadas (npm ci)..."
  npm ci --silent
  echo "   ✓ node_modules igual ao do CI"
else
  echo ""
  echo "[2/6] Instalacao PULADA (--pular-instalacao) — usando o node_modules atual."
fi

# 3. Testes (portao — aborta o deploy se algum teste falhar) (bug-9)
echo ""
echo "[3/6] Rodando testes (vitest)..."
npm test

# 3. Build
echo ""
echo "[4/6] Rodando build..."
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
echo "[5/6] Tamanhos dos bundles:"
du -sh dist/assets/*.js 2>/dev/null | sort -hr | head -10

# 5. Deploy direto em producao (sem preview draft)
echo ""
echo "[6/6] Publicando em producao..."
# (25/06) netlify-cli 26+ devolve "Project not found. Please rerun netlify link" quando
# se passa --site=<id> no deploy. A via confiavel e o estado LINKADO (.netlify/state.json).
# Garantimos o vinculo correto de forma idempotente (funciona ate em checkout novo) e
# publicamos SEM --site.
mkdir -p .netlify
printf '{\n\t"siteId": "%s"\n}\n' "$SITE_ID" > .netlify/state.json

# (auditoria 01/08 — item 156) Mapas de codigo NAO vao para producao.
# O build gera .map (sourcemap: 'hidden') para que um erro do Sentry possa ser lido em
# codigo legivel em vez de "a.b is not a function" no arquivo minificado. Mas publicar os
# .map junto com o site entrega o CODIGO-FONTE inteiro a qualquer visitante.
# Por isso: os mapas ficam no dist local (dao para depurar aqui) e sao APAGADOS logo
# antes de subir. Quando o envio ao Sentry for configurado (SENTRY_AUTH_TOKEN +
# org/projeto), o upload entra AQUI, antes do rm.
MAPAS=$(find dist -name '*.map' 2>/dev/null | wc -l | tr -d ' ')
if [ "$MAPAS" != "0" ]; then
  echo "[deploy] removendo $MAPAS mapa(s) de codigo do dist (nao vao para producao)"
  find dist -name '*.map' -delete
fi

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
# (auditoria 01/08/2026 — item 166) O smoke reprovava DEPLOY BOM e nao pegava desastre.
# Aconteceu de verdade em 02/08: o /api/health devolveu 502 num instante de troca de
# versao, o auto-rollback disparou e reverteu uma publicacao correta. O /api/health pinga
# CINCO servicos externos — um 502 ali fala do Kommo ou do Asaas, nao do nosso deploy.
# Agora: (1) cada checagem tenta 3 vezes antes de condenar, (2) entrou uma FUNCTION comum
# no teste — o incidente do worktree em 22/07 quebrou o pacote das functions e o smoke
# passou feliz, porque so olhava o site e o health.
tenta3() { # $1 = url ; ecoa o melhor codigo obtido em ate 3 tentativas
  local url="$1" melhor="000" c
  for _ in 1 2 3; do
    c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$url" || echo "000")
    case "$c" in 200|204|404) echo "$c"; return ;; esac
    melhor="$c"; sleep 4
  done
  echo "$melhor"
}

SMOKE_OK=1
HOME_CODE=$(tenta3 "https://${SITE_NAME}.netlify.app/")
HEALTH_CODE=$(tenta3 "https://${SITE_NAME}.netlify.app/api/health")
# function comum (nao agendada, sem efeito colateral): prova que o PACOTE das functions
# subiu inteiro. Sem isto, um bundle quebrado passa despercebido ate alguem reclamar.
FUNC_CODE=$(tenta3 "https://${SITE_NAME}.netlify.app/.netlify/functions/portal-manifest")
echo "   home: HTTP $HOME_CODE · health: HTTP $HEALTH_CODE · function: HTTP $FUNC_CODE"
[ "$HOME_CODE" = "200" ] || SMOKE_OK=0
case "$HEALTH_CODE" in 200|204|404) ;; *) SMOKE_OK=0 ;; esac
case "$FUNC_CODE" in 200|204|401|403|404) ;; *) SMOKE_OK=0 ;; esac
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
