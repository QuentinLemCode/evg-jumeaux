#!/usr/bin/env bash
# Watches the running app and alerts with a short diagnosis when it breaks.
#
# Run every 2 minutes by the `evg-watch-errors` systemd timer.
#
#   scripts/agent/watch-errors.sh          # normal run
#   scripts/agent/watch-errors.sh --test   # send a test alert and exit
#
# Three properties it was built for:
#
#  - It DEDUPLICATES. The first version of an alerting script always ends up
#    sending the same stack trace every two minutes until somebody mutes the
#    channel, at which point real alerts are lost too. Each distinct problem
#    alerts once per cooldown window.
#  - The LLM is optional. A short diagnosis is nice; an alert that never
#    arrives because the model timed out is not. The diagnosis step has a hard
#    timeout and falls back to the raw evidence.
#  - It says RECOVERED. An alert channel that only ever reports failures
#    teaches you to ignore it.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

[[ -f .env ]] && { set -a; source .env; set +a; }
[[ -f deploy.env ]] && { set -a; source deploy.env; set +a; }

HEALTH_URL="${HEALTH_URL:-https://${SITE_DOMAIN:-localhost}/api/health}"
STATE_DIR="${DATA_DIR:-$REPO_ROOT/data}/watch"
mkdir -p "$STATE_DIR"
SEEN_FILE="$STATE_DIR/seen"
DOWN_FILE="$STATE_DIR/down"
WINDOW="${WATCH_WINDOW:-3m}"
COOLDOWN_SECONDS="${WATCH_COOLDOWN:-7200}"   # 2 h per distinct problem
NOTIFY="$REPO_ROOT/scripts/agent/notify.sh"
touch "$SEEN_FILE"

if [[ "${1:-}" == "--test" ]]; then
  "$NOTIFY" "🧪 Test des alertes EVG" "Si tu lis ça, le canal fonctionne."
  exit $?
fi

# --- deduplication -----------------------------------------------------------
# Fingerprint on the SHAPE of the message, not its text: timestamps, ids and
# numbers are stripped so the same fault does not look new every time.
fingerprint() {
  python3 - <<'PY'
import hashlib, re, sys
text = sys.stdin.read()
text = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'UUID', text, flags=re.I)
text = re.sub(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*', 'TS', text)
text = re.sub(r'\b\d+\b', 'N', text)
text = re.sub(r'\s+', ' ', text).strip()
print(hashlib.sha256(text.encode()).hexdigest()[:16])
PY
}

already_alerted() {
  local fp="$1" now last
  now="$(date +%s)"
  last="$(grep -E "^${fp} " "$SEEN_FILE" 2>/dev/null | tail -1 | awk '{print $2}')"
  [[ -n "$last" ]] && (( now - last < COOLDOWN_SECONDS ))
}

mark_alerted() {
  local fp="$1" now
  now="$(date +%s)"
  grep -vE "^${fp} " "$SEEN_FILE" > "$SEEN_FILE.tmp" 2>/dev/null || true
  mv "$SEEN_FILE.tmp" "$SEEN_FILE"
  printf '%s %s\n' "$fp" "$now" >> "$SEEN_FILE"
  # Keep the file from growing without bound over a long weekend.
  tail -200 "$SEEN_FILE" > "$SEEN_FILE.tmp" && mv "$SEEN_FILE.tmp" "$SEEN_FILE"
}

# --- a short diagnosis, best effort -----------------------------------------
diagnose() {
  local evidence="$1"
  command -v opencode >/dev/null || { echo ""; return; }
  local prompt="Voici des erreurs remontées par l'application EVG en production.
Réponds en français, en 3 lignes MAXIMUM, sans préambule :
1. ce qui casse, en une phrase ;
2. la cause la plus probable ;
3. la première chose à vérifier.
N'invente rien : si les logs ne suffisent pas, dis-le.

---
${evidence}
---"
  # A hard timeout, because an alert that waits on a model is not an alert.
  # `timeout` is GNU coreutils — present on the VM, absent on macOS.
  if command -v timeout >/dev/null; then
    timeout 90 opencode run --agent diagnose --auto "$prompt" 2>/dev/null | tail -8 || echo ""
  else
    opencode run --agent diagnose --auto "$prompt" 2>/dev/null | tail -8 || echo ""
  fi
}

alert() {
  local title="$1" evidence="$2" fp
  fp="$(printf '%s' "$evidence" | fingerprint)"
  if already_alerted "$fp"; then
    echo "watch: already alerted on $fp within the cooldown" >&2
    return 0
  fi

  local diagnosis
  diagnosis="$(diagnose "$evidence")"
  local body
  if [[ -n "${diagnosis// /}" ]]; then
    body="${diagnosis}

— — —
${evidence}"
  else
    # No model, or it timed out: send the evidence anyway.
    body="(diagnostic automatique indisponible)

${evidence}"
  fi

  "$NOTIFY" "$title" "$body" && mark_alerted "$fp"
}

# --- 1. is it up? ------------------------------------------------------------
HEALTH_BODY="$(curl -fsS --max-time 8 "$HEALTH_URL" 2>&1)"
HEALTH_RC=$?

if [[ $HEALTH_RC -ne 0 ]] || ! grep -q '"status":"ok"' <<< "$HEALTH_BODY"; then
  EVIDENCE="$HEALTH_URL ne répond pas correctement.

Réponse : ${HEALTH_BODY:-(aucune)}

Conteneurs :
$(docker compose ps 2>&1 | head -12)

Derniers logs :
$(docker compose logs --since "$WINDOW" --tail 40 2>&1 | tail -40)"
  alert "🔴 EVG est indisponible" "$EVIDENCE"
  date +%s > "$DOWN_FILE"
  exit 1
fi

# It answers: if it was down, say so. A channel that only reports failures
# gets muted.
if [[ -f "$DOWN_FILE" ]]; then
  DOWN_FOR=$(( $(date +%s) - $(cat "$DOWN_FILE") ))
  rm -f "$DOWN_FILE"
  "$NOTIFY" "🟢 EVG est de nouveau en ligne" \
    "Indisponible pendant environ $(( DOWN_FOR / 60 )) min.
$HEALTH_BODY" || true
fi

# --- 2. errors in the logs, even while it answers ----------------------------
APP_ERRORS="$(docker compose logs --since "$WINDOW" --no-color 2>/dev/null \
  | grep -aiE 'error|fatal|unhandled|SQLITE_|ECONNREFUSED|migration failed|delivery failed' \
  | grep -avE 'favicon|GET /_next|npm notice' \
  | tail -25)"

if [[ -n "${APP_ERRORS// /}" ]]; then
  alert "⚠️ Erreurs dans les logs EVG" "Sur les dernières ${WINDOW} :

${APP_ERRORS}

Santé : ${HEALTH_BODY}"
fi

# --- 3. disk, because SQLite fails in confusing ways when it is full --------
DISK_USE="$(df --output=pcent "$REPO_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9')"
if [[ -n "$DISK_USE" ]] && (( DISK_USE > 85 )); then
  alert "🟠 Disque presque plein sur la VM EVG" \
    "Utilisation : ${DISK_USE} %.
Une base SQLite sur un disque plein échoue de façon déroutante — purge les
sauvegardes (data/backups) et les images Docker inutilisées.

$(df -h "$REPO_ROOT" 2>&1 | tail -2)"
fi

exit 0
