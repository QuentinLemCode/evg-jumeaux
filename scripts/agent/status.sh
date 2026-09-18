#!/usr/bin/env bash
# One-screen answer to "what is the state of the project and of production?"
# Hermes calls this to answer questions without touching anything.
#
# It runs on the AGENTS VM, so anything about the running application is read
# over the narrow bridge (scripts/agent/app-exec.sh) rather than locally.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"
for f in /home/hermes/.hermes/.env "$REPO_ROOT/.env"; do
  # shellcheck disable=SC1090
  [[ -f "$f" ]] && { set -a; source "$f"; set +a; }
done
HEALTH_URL="${HEALTH_URL:-https://${SITE_DOMAIN:-localhost}/api/health}"

# Run as hermes, not root: the checkout is hermes-owned and git refuses to
# read a repository owned by someone else ("dubious ownership"), which turns
# this whole section into three identical fatals.
if [ "$(id -u)" = "0" ] && [ -d "$REPO_ROOT/.git" ] \
  && [ "$(stat -c %U "$REPO_ROOT/.git" 2>/dev/null)" != "root" ]; then
  echo "NOTE: running as root on a $(stat -c %U "$REPO_ROOT/.git")-owned checkout."
  echo "      Re-run as that user:  su - hermes -c 'cd ~/site && scripts/agent/status.sh'"
  echo
fi

echo "=== git (agents VM working copy) ==="
echo "branch:  $(git rev-parse --abbrev-ref HEAD)"
echo "commit:  $(git log -1 --pretty='%h %s (%cr)')"
echo "dirty:   $(git status --porcelain | wc -l | tr -d ' ') file(s)"
git fetch --quiet origin main 2>/dev/null || true
echo "behind:  $(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?') commit(s) behind origin/main"

echo
echo "=== gateway and watcher (this VM) ==="
# Asked first because it is the question a silent Telegram raises, and the
# answer is not in the git state below.

# The gateway is a long-running service: active or it is not working.
if systemctl list-unit-files hermes-gateway.service >/dev/null 2>&1; then
  STATE="$(systemctl is-active hermes-gateway 2>/dev/null || true)"
  printf 'hermes-gateway: %s\n' "${STATE:-unknown}"
  if [ "$STATE" != "active" ]; then
    journalctl -u hermes-gateway -n 3 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
  fi
else
  echo "hermes-gateway: not installed on this machine"
fi

# The watcher is the opposite shape: a oneshot fired by a TIMER, so the service
# being inactive is the normal state and only the timer says anything useful.
if systemctl list-unit-files evg-watch-errors.timer >/dev/null 2>&1; then
  printf 'evg-watch-errors.timer: %s' "$(systemctl is-active evg-watch-errors.timer 2>/dev/null || echo unknown)"
  printf ' — last run %s, result %s\n' \
    "$(systemctl show -p ExecMainStartTimestamp --value evg-watch-errors.service 2>/dev/null || echo never)" \
    "$(systemctl show -p Result --value evg-watch-errors.service 2>/dev/null || echo '?')"
  if [ "$(systemctl show -p Result --value evg-watch-errors.service 2>/dev/null)" != "success" ]; then
    journalctl -u evg-watch-errors -n 3 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
  fi
else
  echo "evg-watch-errors.timer: not installed on this machine"
fi

# The gateway is a SEPARATE program this repository does not ship. Without it
# there is nothing listening on Discord or Telegram, however well configured
# the tokens are.
if [ ! -x /home/hermes/.local/bin/hermes ]; then
  echo "hermes binary: MISSING at /home/hermes/.local/bin/hermes"
  echo "  the gateway cannot run — see hermes/README.md"
fi

echo
echo "=== pull requests ==="
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh pr list --state open --limit 5 \
    --json number,title,headRefName,autoMergeRequest \
    --template '{{range .}}  #{{.number}} {{.headRefName}} ({{if .autoMergeRequest}}auto-merge{{else}}manual{{end}}) — {{.title}}
{{end}}' 2>/dev/null || echo "  (could not list)"
  [[ -z "$(gh pr list --state open --json number --jq '.[0].number' 2>/dev/null)" ]] && echo "  none open"
else
  echo "  gh unavailable or unauthenticated"
fi

echo
echo "=== specs ==="
if [[ -f specs/README.md ]]; then
  grep -E '^\| *`?[0-9]{4}' specs/README.md || echo "(status board empty)"
else
  echo "(no specs/README.md)"
fi

echo
echo "=== production (application VM) ==="
if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null; then echo; else echo "unreachable: $HEALTH_URL"; fi
"$REPO_ROOT/scripts/agent/app-exec.sh" status 2>&1 | sed 's/^/  /' || echo "  (app VM unreachable over the tailnet)"

echo
echo "=== recent agent runs ==="
ls -1t "$LOG_DIR"/*.log 2>/dev/null | head -5 | while read -r f; do
  echo "$(basename "$f")  ($(wc -l < "$f" | tr -d ' ') lines)"
done
