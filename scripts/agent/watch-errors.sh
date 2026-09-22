#!/usr/bin/env bash
# Watches the running app and alerts with a short diagnosis when it breaks.
#
# Run every 2 minutes by the `evg-watch-errors` systemd timer, ON THE AGENTS
# VM — not on the machine it watches. That is deliberate: a watcher installed
# on the app VM cannot report that the app VM is dead, which is the one failure
# you most want to hear about. Watching from outside also keeps the agent
# toolchain (and the LLM key) off the application host.
#
#   scripts/agent/watch-errors.sh          # normal run
#   scripts/agent/watch-errors.sh --test   # send a test alert and exit
#
# APP_HOST (a tailnet name) switches it to remote mode: health over HTTPS,
# logs and disk over Tailscale SSH. Unset, it inspects the local stack, which
# is what makes it runnable on the app VM itself while debugging.
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

# This script deliberately does not use lib.sh — it must run standalone, with
# looser strictness than the pipeline. But it does need opencode on PATH, and
# not having it is exactly why every alert said "diagnostic automatique
# indisponible": systemd gives it none.
# shellcheck source=scripts/agent/path.sh
source "$(dirname "${BASH_SOURCE[0]}")/path.sh"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

for f in /home/hermes/.hermes/.env "$REPO_ROOT/.env" "$REPO_ROOT/deploy.env"; do
  # shellcheck disable=SC1090
  [[ -f "$f" ]] && { set -a; source "$f"; set +a; }
done

HEALTH_URL="${HEALTH_URL:-https://${SITE_DOMAIN:-localhost}/api/health}"
APP_HOST="${APP_HOST:-}"

# The allowlisted bridge, for the verbs that are not raw commands.
app_exec() {
  "$REPO_ROOT/scripts/agent/app-exec.sh" "$@" 2>&1
}

# One shim, so the rest of the script does not care whether the app is here or
# one tailnet hop away.
app() {
  if [[ -n "$APP_HOST" ]]; then
    ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes \
      "hermes@$APP_HOST" "cd ~/site && $*" 2>&1
  else
    ( cd "$REPO_ROOT" && eval "$*" ) 2>&1
  fi
}
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
    # 150s, not 90: enough for a model that reads a file or two, still
    # short enough that the alert is an alert. Measured, not guessed.
    timeout 150 opencode run --agent diagnose --auto "$prompt" 2>/dev/null | tail -8 || echo ""
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

  # Diagnosing and then doing nothing is what a log file already does. If the
  # diagnosis held, try the repair — it opens a pull request that cannot merge
  # without a human label, so "propose" is the strongest thing it can do.
  propose_repair "$diagnosis"
}

# --- propose a repair, once, and say what came of it -------------------------
propose_repair() {
  local diagnosis="$1"
  [[ "${WATCH_AUTOFIX:-1}" == "1" ]] || return 0
  # No diagnosis means no cause, and a repair without a cause is a guess.
  [[ -n "${diagnosis// /}" ]] || return 0
  [[ -x "$REPO_ROOT/scripts/agent/fix.sh" ]] || return 0

  local summary
  summary="$(printf '%s' "$diagnosis" | tr '\n' ' ' | cut -c1-300)"

  echo "watch: proposing a repair" >&2
  local out rc
  out="$("$REPO_ROOT/scripts/agent/fix.sh" "$summary" 2>&1)"; rc=$?

  local pr
  pr="$(printf '%s\n' "$out" | grep -m1 -E '^PR:' | sed -E 's/^PR:[[:space:]]*//')"

  if [[ $rc -eq 3 ]]; then
    return 0  # another repair is already running; nothing new to say
  elif [[ -n "$pr" ]]; then
    "$NOTIFY" "🔧 Correction proposée" "$pr

Elle attend le label infra-ok si elle touche à l'infrastructure.

$(printf '%s\n' "$out" | grep -E '^(CAUSE|FIX):' || true)"
  else
    "$NOTIFY" "🔧 Réparation non aboutie" "L'agent n'a pas pu corriger ça tout seul.

$(printf '%s\n' "$out" | tail -12)"
  fi
}

# --- 1. is it up? ------------------------------------------------------------
HEALTH_BODY="$(curl -fsS --max-time 8 "$HEALTH_URL" 2>&1)"
HEALTH_RC=$?

if [[ $HEALTH_RC -ne 0 ]] || ! grep -q '"status":"ok"' <<< "$HEALTH_BODY"; then
  EVIDENCE="$HEALTH_URL ne répond pas correctement.

Réponse : ${HEALTH_BODY:-(aucune)}

Conteneurs :
$(app "docker compose ps" | head -12)

Derniers logs :
$(app "docker compose logs --since $WINDOW --tail 40" | tail -40)"
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
APP_ERRORS="$(app "docker compose logs --since $WINDOW --no-color" \
  | grep -aiE 'error|fatal|unhandled|SQLITE_|ECONNREFUSED|migration failed|delivery failed' \
  | grep -avE 'favicon|GET /_next|npm notice|Permission denied' \
  | tail -25)"

if [[ -n "${APP_ERRORS// /}" ]]; then
  alert "⚠️ Erreurs dans les logs EVG" "Sur les dernières ${WINDOW} :

${APP_ERRORS}

Santé : ${HEALTH_BODY}"
fi

# --- 3. failures in guests' BROWSERS ----------------------------------------
# Everything above reads the server. A render crash, a rejected promise on
# patchy 4G, a broken service worker — none of those appear in a container log,
# and a guest who sees a broken screen just puts their phone away (spec 0011).
CLIENT_ERRORS="$(app_exec client-errors)"
if [[ -n "${CLIENT_ERRORS// /}" ]] && ! grep -qiE 'no such table|unable to open|Permission denied' <<< "$CLIENT_ERRORS"; then
  # One alert per group: the bridge stamped these rows as it read them, so a
  # recurrence stays quiet.
  while IFS= read -r -d '---' GROUP; do
    [[ -n "${GROUP// /}" ]] || continue
    alert "🐞 Erreur dans le navigateur d'un joueur" "$GROUP

Détail complet : https://${SITE_DOMAIN:-localhost}/admin/errors"
  done <<< "$CLIENT_ERRORS"
fi

# --- 4. disk, because SQLite fails in confusing ways when it is full --------
DISK_USE="$(app "df --output=pcent ." | tail -1 | tr -dc '0-9')"
if [[ -n "$DISK_USE" ]] && (( DISK_USE > 85 )); then
  alert "🟠 Disque presque plein sur la VM applicative" \
    "Utilisation : ${DISK_USE} %.
Une base SQLite sur un disque plein échoue de façon déroutante — purge les
sauvegardes (data/backups) et les images Docker inutilisées.

$(app "df -h ." | tail -2)"
fi

exit 0
