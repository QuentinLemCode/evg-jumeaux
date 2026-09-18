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

echo "=== git (agents VM working copy) ==="
echo "branch:  $(git rev-parse --abbrev-ref HEAD)"
echo "commit:  $(git log -1 --pretty='%h %s (%cr)')"
echo "dirty:   $(git status --porcelain | wc -l | tr -d ' ') file(s)"
git fetch --quiet origin main 2>/dev/null || true
echo "behind:  $(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?') commit(s) behind origin/main"

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
