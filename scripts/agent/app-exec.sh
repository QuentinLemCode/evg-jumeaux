#!/usr/bin/env bash
# Runs one of a FIXED SET of commands on the application VM.
#
#   scripts/agent/app-exec.sh status
#   scripts/agent/app-exec.sh logs [service]
#   scripts/agent/app-exec.sh ps
#   scripts/agent/app-exec.sh data
#
# READ-ONLY, since spec 0016. `deploy` and `rollback` were here and are gone:
# the bot that used to call them no longer writes anything, and leaving a
# write verb in the only door between the two machines would make "can the bot
# deploy?" a question about policy instead of a question about the door.
# Deploying happens from `main`, in the Deploy workflow.
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
  deploy|rollback)
    # Spec 0016, rule 3. Named explicitly rather than falling through to the
    # usage text, because the useful answer here is WHY it is gone.
    cat >&2 <<GONE
'$VERB' was removed: this door is read-only (spec 0016).

Deploying happens in the Deploy workflow, from main. To do it by hand, from
the application VM: scripts/agent/deploy.sh --tag <image-tag>
GONE
    exit 1
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
  data)
    # Spec 0016, rules 10-12: a bounded read-only snapshot, as labelled JSON
    # blocks, for the router to answer «qui a gagné le plus de points samedi».
    #
    # Columns are listed ONE BY ONE and never `SELECT *`. The database holds
    # thirteen real people's PIN hashes and their push subscription keys, and
    # `SELECT *` would ship whichever secret a future migration adds to a
    # table that has none today. `push_subscriptions` is absent entirely.
    #
    # The model is never asked to write SQL. At this size the whole dataset
    # fits in a prompt, so composing queries would be a risk with no matching
    # benefit.
    run_there "$(cat <<'SNAPSHOT'
set -e
db=data/evg.db
q() { printf '== %s ==\n' "$1"; sqlite3 -readonly -json "$db" "$2" || echo '[]'; printf '\n'; }
q players "SELECT id, name, role, avatar, created_at FROM users ORDER BY name;"
q games "SELECT id, slug, name, mode, sides_count, players_per_side, points_per_win, margin_bonus_enabled, margin_bonus_per_point, margin_bonus_cap, requires_score, is_active FROM games ORDER BY name;"
q totals "SELECT u.id, u.name, COALESCE(SUM(p.points), 0) AS points, COUNT(p.id) AS events FROM users u LEFT JOIN point_events p ON p.user_id = u.id GROUP BY u.id ORDER BY points DESC;"
q points_by_day "SELECT date(p.created_at / 1000, 'unixepoch') AS day, u.name, SUM(p.points) AS points FROM point_events p JOIN users u ON u.id = p.user_id GROUP BY day, u.id ORDER BY day DESC, points DESC LIMIT 400;"
q point_events "SELECT id, user_id, match_id, type, points, detail, created_by, created_at FROM point_events ORDER BY created_at DESC LIMIT 200;"
q matches "SELECT id, game_id, created_by, status, winning_side, reported_by, reported_at, settled_at, settled_by, cancelled_by, cancel_reason, dispute_reason, disputed_by, created_at, rule_points_per_win, rule_margin_bonus_per_point, rule_margin_bonus_cap, rule_requires_score FROM matches ORDER BY created_at DESC LIMIT 200;"
q match_sides "SELECT match_id, side_index, label, score, validated_at, validated_by FROM match_sides ORDER BY match_id DESC LIMIT 400;"
q match_participants "SELECT match_id, user_id, side_index, invitation_status, responded_at FROM match_participants ORDER BY match_id DESC LIMIT 400;"
SNAPSHOT
)"
    ;;
  *)
    cat >&2 <<USAGE
usage: $0 <status|logs [service]|ps|health|client-errors|data>

Deliberately an allowlist and not a shell, and since spec 0016 deliberately
READ-ONLY: the agents VM can reach the app VM over Tailscale SSH, and reading
is the only thing it has any business doing there.
USAGE
    exit 1
    ;;
esac
