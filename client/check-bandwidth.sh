#!/bin/bash
[ -f "$HOME/.cbc-netlify-token" ] && . "$HOME/.cbc-netlify-token"
: "${NETLIFY_AUTH_TOKEN:?defina ~/.cbc-netlify-token ou rode: npx netlify login}"
# Monitor bandwidth da Netlify — alerta se passar de 80%
# Uso: ./check-bandwidth.sh
# Rodar via cron local: 0 9,15,21 * * * /caminho/para/check-bandwidth.sh

NETLIFY_AUTH_TOKEN="${NETLIFY_AUTH_TOKEN}"
ACCOUNT_SLUG="paulo-5hbwy1e"
ALERT_THRESHOLD=80  # alertar em 80%
LIMIT_GB=1000       # Pro plan = 1TB = 1000GB

RESPONSE=$(curl -s -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/accounts/$ACCOUNT_SLUG/bandwidth")

USED_BYTES=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('used', 0))")
PERIOD_START=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('period_start_date','')[:10])")
PERIOD_END=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('period_end_date','')[:10])")

USED_GB=$(echo "scale=2; $USED_BYTES / 1073741824" | bc)
USED_PCT=$(echo "scale=1; ($USED_BYTES * 100) / ($LIMIT_GB * 1073741824)" | bc)

echo "=== Netlify Bandwidth Check ==="
echo "Periodo: $PERIOD_START ate $PERIOD_END"
echo "Usado: ${USED_GB} GB / ${LIMIT_GB} GB (${USED_PCT}%)"
echo ""

# Alerta visual no terminal
if (( $(echo "$USED_PCT >= $ALERT_THRESHOLD" | bc -l) )); then
  echo "*** ALERTA: Bandwidth acima de $ALERT_THRESHOLD% ***"
  # macOS notification
  osascript -e "display notification \"Usado: ${USED_GB}GB (${USED_PCT}%)\" with title \"Netlify Bandwidth Alert\" sound name \"Ping\"" 2>/dev/null
  exit 2
fi

if (( $(echo "$USED_PCT >= 50" | bc -l) )); then
  echo "Aviso: bandwidth acima de 50%"
fi

echo "Status: OK"
