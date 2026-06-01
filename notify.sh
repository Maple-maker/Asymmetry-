#!/usr/bin/env bash
# Sends a push notification to ntfy topic 'asymmetry-radar' via Supabase pg_net.
# Usage: ./notify.sh "Title" "Message body"
# Requires: supabase CLI authenticated, or run via Claude MCP directly.
#
# From Claude sessions: use execute_sql MCP tool instead:
#   SELECT notify_ntfy('Title', 'Message body');

set -euo pipefail

TITLE="${1:-Asymmetry Radar}"
BODY="${2:-No message provided}"
PROJECT_ID="lmgphebvungyqsnqitcg"

# Escape single quotes for SQL
SAFE_TITLE="${TITLE//\'/\'\'}"
SAFE_BODY="${BODY//\'/\'\'}"

supabase db execute --project-ref "$PROJECT_ID" \
  "SELECT notify_ntfy('${SAFE_TITLE}', '${SAFE_BODY}');"
