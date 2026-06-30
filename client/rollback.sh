#!/bin/bash
[ -f "$HOME/.cbc-netlify-token" ] && . "$HOME/.cbc-netlify-token"
: "${NETLIFY_AUTH_TOKEN:?defina ~/.cbc-netlify-token ou rode: npx netlify login}"
# Rollback de emergencia para deploy anterior
# Uso: ./rollback.sh <deploy_id>  OU  ./rollback.sh  (usa .last-working-deploy)

NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN}"
SITE_ID="d7b38821-22e9-4308-8fda-a8f124a65b72"

DEPLOY_ID="${1:-$(cat .last-working-deploy 2>/dev/null)}"

if [ -z "$DEPLOY_ID" ]; then
  echo "ERRO: Deploy ID nao informado"
  echo "Uso: ./rollback.sh <deploy_id>"
  echo ""
  echo "Deploys recentes:"
  curl -s -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
    "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys?per_page=10" | \
    python3 -c "
import json, sys
for d in json.load(sys.stdin):
  print(f\"  {d['id']} - {d.get('created_at','')[:19]} - {d.get('state','?')}\")"
  exit 1
fi

echo "Fazendo rollback para deploy: $DEPLOY_ID"
read -p "Confirma? (s/n) " CONFIRM
[ "$CONFIRM" = "s" ] || exit 0

curl -X POST -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys/$DEPLOY_ID/restore" && \
  echo "" && echo "Rollback concluido!"
