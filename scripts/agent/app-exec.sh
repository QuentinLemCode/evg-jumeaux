#!/usr/bin/env bash
# Runs one of a FIXED SET of commands on the application VM.
#
#   scripts/agent/app-exec.sh status
#   scripts/agent/app-exec.sh rollback
#   scripts/agent/app-exec.sh deploy sha-a1b2c3d
#   scripts/agent/app-exec.sh logs [service]
#   scripts/agent/app-exec.sh ps
#
# Hermes and the watcher live on the agents VM; the app lives on another one.
# This is the only door between them, and it is an ALLOWLIST rather than a
# shell: the agents VM holds a Tailscale SSH grant to the app VM, and an agent
# with an open shell there would eventually use it.
#
# `client-errors` is the seventh verb, and it earns its place: the watcher has
# to see browser failures (spec 0011, rule 21) and there is no other path to
# them. It runs ONE fixed query and stamps what it read, so a group is
# reported once — deliberately not a Server Action, because the watcher has no
# session and an endpoint that alerts without one would be public.
#
# With APP_HOST unset it runs locally, which is what makes it usable while
# debugging on the app VM itself.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
for f in /home/hermes/.hermes/.env "$REPO_ROOT/.env"; do
  # shellcheck disable=SC1090
  [[ -f "$f" ]] && { set -a; source "$f"; set +a; }
done

APP_HOST="${APP_HOST:-}"
VERB="${1:-}"
shift || true

run_there() {
  if [[ -n "$APP_HOST" ]]; then
    ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes \
      "hermes@$APP_HOST" "cd ~/site && $1"
  else
    ( cd "$REPO_ROOT" && eval "$1" )
  fi
}

case "$VERB" in
  status)
    run_there 'scripts/agent/deploy.sh --status'
    ;;
  rollback)
    run_there 'scripts/agent/deploy.sh --rollback'
    ;;
  deploy)
    TAG="${1:?usage: app-exec.sh deploy <image-tag>}"
    # The tag is the only free-form value that crosses, so validate its shape
    # rather than trusting whatever produced it.
    [[ "$TAG" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo "invalid image tag: $TAG" >&2; exit 1; }
    run_there "scripts/agent/deploy.sh --tag '$TAG'"
    ;;
  logs)
    SERVICE="${1:-}"
    if [[ -n "$SERVICE" ]]; then
      case "$SERVICE" in
        app-blue|app-green|caddy|cloudflared|sweeper) ;;
        *) echo "unknown service: $SERVICE" >&2; exit 1 ;;
      esac
      run_there "docker compose logs --tail 80 --no-color $SERVICE"
    else
      run_there 'docker compose logs --tail 80 --no-color'
    fi
    ;;
  ps)
    run_there 'docker compose ps'
    ;;
  health)
    run_there 'curl -fsS --max-time 5 http://localhost:8080/api/health || echo unreachable'
    ;;
  client-errors)
    # Reads the groups nobody has been told about yet, then stamps them so the
    # next run stays quiet. Read-and-mark in one call, because two calls could
    # alert twice if the second one failed.
    run_there "sqlite3 -readonly data/evg.db \"SELECT 'KIND=' || kind || ' COUNT=' || occurrences || ' PATH=' || path || ' BROWSER=' || COALESCE(last_browser,'?') || ' USER=' || COALESCE(last_user_id,'(non connecte)') || ' COMMIT=' || COALESCE(app_commit,'?') || char(10) || 'MESSAGE=' || message || char(10) || 'STACK=' || COALESCE(substr(stack,1,700),'(aucune)') || char(10) || '---' FROM client_errors WHERE alerted_at IS NULL AND resolved_at IS NULL ORDER BY last_seen_at DESC LIMIT 5;\" && sqlite3 data/evg.db \"UPDATE client_errors SET alerted_at = strftime('%s','now') * 1000 WHERE alerted_at IS NULL AND resolved_at IS NULL;\""
    ;;
  *)
    cat >&2 <<USAGE
usage: $0 <status|deploy <tag>|rollback|logs [service]|ps|health|client-errors>

Deliberately an allowlist and not a shell: the agents VM can reach the app VM
over Tailscale SSH, and these are the only things it has any business doing
there.
USAGE
    exit 1
    ;;
esac
