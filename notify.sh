#!/usr/bin/env bash
# Sends one or more messages to Telegram via the Supabase relay.
# Usage: ./notify.sh "message1" "message2" ...
# Required env vars: NOTIFY_SECRET

set -euo pipefail

FUNCTION_URL="https://lmgphebvungyqsnqitcg.supabase.co/functions/v1/telegram-notify"

if [[ -z "${NOTIFY_SECRET:-}" ]]; then
  echo "ERROR: NOTIFY_SECRET env var is not set." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 \"message1\" [\"message2\" ...]" >&2
  exit 1
fi

# Build JSON array of messages
MESSAGES_JSON="["
for i in "$@"; do
  # Escape backslashes and double-quotes for JSON
  escaped=$(printf '%s' "$i" | sed 's/\\/\\\\/g; s/"/\\"/g')
  MESSAGES_JSON+="\"${escaped}\","
done
MESSAGES_JSON="${MESSAGES_JSON%,}]"

PAYLOAD="{\"messages\":${MESSAGES_JSON}}"

curl -s -X POST "$FUNCTION_URL" \
  -H "Content-Type: application/json" \
  -H "x-notify-secret: ${NOTIFY_SECRET}" \
  -d "$PAYLOAD"
