#!/usr/bin/env bash
# One-screen answer to "what is the state of the project and of production?"
# Hermes calls this to answer questions without touching anything.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"
[[ -f .env ]] && set -a && source .env && set +a
HEALTH_URL="${HEALTH_URL:-https://${SITE_DOMAIN:-localhost}/api/health}"

echo "=== git ==="
echo "branch:  $(git rev-parse --abbrev-ref HEAD)"
echo "commit:  $(git log -1 --pretty='%h %s (%cr)')"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
echo "dirty:   $DIRTY file(s)"
echo "behind:  $(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?') commit(s) behind origin/main"

echo
echo "=== specs ==="
if [[ -f specs/README.md ]]; then
  grep -E '^\| *`?[0-9]{4}' specs/README.md || echo "(status board empty)"
else
  echo "(no specs/README.md)"
fi

echo
echo "=== production ==="
if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null; then echo; else echo "unreachable: $HEALTH_URL"; fi

echo
echo "=== containers ==="
docker compose ps 2>/dev/null || echo "(docker compose unavailable here)"

echo
echo "=== recent agent runs ==="
ls -1t "$LOG_DIR"/*.log 2>/dev/null | head -5 | while read -r f; do
  echo "$(basename "$f")  ($(wc -l < "$f" | tr -d ' ') lines)"
done
