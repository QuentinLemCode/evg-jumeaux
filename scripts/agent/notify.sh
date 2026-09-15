#!/usr/bin/env bash
# Sends one message to every configured channel. Used by the error watcher.
#
#   scripts/agent/notify.sh "title" "body"
#   echo "body" | scripts/agent/notify.sh "title" -
#
# Every configured channel is tried, and the exit code says whether AT LEAST
# ONE got through. An alert that silently fails to send is worse than no alert,
# so this never swallows a total failure.
#
# Channels, in order of preference:
#   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  — arrives from the Hermes bot itself
#   DISCORD_WEBHOOK_URL                    — needs no gateway process alive,
#                                            so it works when Hermes is what
#                                            is broken

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
for f in "$REPO_ROOT/deploy.env" "$REPO_ROOT/.env" /home/hermes/.hermes/.env; do
  # shellcheck disable=SC1090
  [[ -f "$f" ]] && { set -a; source "$f"; set +a; }
done

TITLE="${1:?usage: notify.sh <title> <body|->}"
BODY="${2:?usage: notify.sh <title> <body|->}"
[[ "$BODY" == "-" ]] && BODY="$(cat)"

MESSAGE="$TITLE"$'\n'"$BODY"
SENT=0

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  if curl -fsS --max-time 15 -o /dev/null \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${MESSAGE}" \
      --data-urlencode "disable_web_page_preview=true"; then
    SENT=$((SENT + 1))
  else
    echo "notify: telegram failed" >&2
  fi
fi

if [[ -n "${DISCORD_WEBHOOK_URL:-}" ]]; then
  # Discord caps a message at 2000 characters and rejects the whole payload
  # over it, so truncate rather than lose the alert.
  PAYLOAD="$(python3 - "$MESSAGE" <<'PY'
import json, sys
text = sys.argv[1]
if len(text) > 1900:
    text = text[:1900] + "\n… (tronqué)"
print(json.dumps({"content": text, "username": "Hermes"}))
PY
)"
  if curl -fsS --max-time 15 -o /dev/null -H 'Content-Type: application/json' \
      -d "$PAYLOAD" "$DISCORD_WEBHOOK_URL"; then
    SENT=$((SENT + 1))
  else
    echo "notify: discord failed" >&2
  fi
fi

if [[ "$SENT" -eq 0 ]]; then
  echo "notify: NO channel configured or all failed — the alert did not leave the box" >&2
  echo "$MESSAGE" >&2
  exit 1
fi
exit 0
