#!/usr/bin/env bash
# Zero-downtime deploy of the app image built by CI.
#
#   scripts/agent/deploy.sh --tag sha-a1b2c3d --commit a1b2c3d…
#   scripts/agent/deploy.sh --rollback
#   scripts/agent/deploy.sh --status
#
# Blue/green on one VM: the idle colour is started on the new image, proved
# healthy, and only then does Caddy get a GRACEFUL reload pointing at it. The
# old colour keeps serving until that reload returns, so no request is dropped
# and a failed deploy changes nothing.
#
#   pull ▸ back up db ▸ migrate ▸ start idle colour ▸ prove healthy
#        ▸ caddy reload ▸ verify public health ▸ stop old colour
#
# THE CONSTRAINT THIS IMPOSES: for a few seconds both colours run against the
# same database, so a migration must work for BOTH the old and the new code.
# Additive only. See AGENTS.md §9.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

log()  { printf '\033[36m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[33m[%s] WARN\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[31m[%s] FATAL\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; exit 1; }

[[ -f .env ]] || die ".env is missing — the VM was not provisioned by Terraform"
set -a; source .env; set +a
[[ -f deploy.env ]] && { set -a; source deploy.env; set +a; }

COMPOSE="docker compose"
DATA_DIR="${DATA_DIR:-$REPO_ROOT/data}"
STATE_DIR="$DATA_DIR/deploy"
mkdir -p "$STATE_DIR" "$DATA_DIR/backups"
ACTIVE_FILE="$STATE_DIR/active-color"
PREVIOUS_FILE="$STATE_DIR/previous"
HEALTH_URL="${HEALTH_URL:-https://${SITE_DOMAIN}/api/health}"

TARGET_TAG=""
TARGET_COMMIT=""
ROLLBACK=false
MODE=deploy

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)      TARGET_TAG="${2:?--tag needs a value}"; shift 2 ;;
    --commit)   TARGET_COMMIT="${2:?--commit needs a value}"; shift 2 ;;
    --rollback) ROLLBACK=true; shift ;;
    --status)   MODE=status; shift ;;
    *)          die "unknown argument: $1" ;;
  esac
done

active_color() { [[ -f "$ACTIVE_FILE" ]] && cat "$ACTIVE_FILE" || echo none; }
other_color()  { [[ "$1" == "blue" ]] && echo green || echo blue; }

# --- status -------------------------------------------------------------------
if [[ "$MODE" == "status" ]]; then
  echo "active colour: $(active_color)"
  echo "image:         ${IMAGE_REPOSITORY}:${IMAGE_TAG:-?}"
  echo "commit:        ${GIT_COMMIT:-?}"
  echo "previous:      $([[ -f "$PREVIOUS_FILE" ]] && cat "$PREVIOUS_FILE" || echo none)"
  echo "health:        $(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || echo unreachable)"
  $COMPOSE ps 2>/dev/null || true
  exit 0
fi

# --- rollback target ----------------------------------------------------------
if $ROLLBACK; then
  [[ -f "$PREVIOUS_FILE" ]] || die "no previous deploy recorded — nothing to roll back to"
  # shellcheck disable=SC2162
  read TARGET_TAG TARGET_COMMIT < "$PREVIOUS_FILE"
  warn "rolling back to ${TARGET_TAG} (${TARGET_COMMIT})"
  warn "CODE ONLY — the database is NOT rolled back, because reverting it would"
  warn "destroy results players entered since the deploy."
fi

[[ -n "$TARGET_TAG" ]] || die "usage: $0 --tag <image-tag> [--commit <sha>]"
TARGET_COMMIT="${TARGET_COMMIT:-$TARGET_TAG}"

CURRENT="$(active_color)"
if [[ "$CURRENT" == "none" ]]; then
  TARGET=blue
  log "first deploy — starting on blue"
else
  TARGET="$(other_color "$CURRENT")"
fi
IMAGE="${IMAGE_REPOSITORY}:${TARGET_TAG}"
log "deploying $IMAGE onto '$TARGET' (currently serving: $CURRENT)"

PROFILES_BASE="$(grep -oE 'tunnel|public' <<< "${COMPOSE_PROFILES:-tunnel}" | head -1)"
[[ -n "$PROFILES_BASE" ]] || PROFILES_BASE=tunnel
compose_target() { $COMPOSE --profile "$PROFILES_BASE" --profile "$TARGET" "$@"; }

# --- 1. authenticate and pull -------------------------------------------------
if [[ -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:?}" --password-stdin >/dev/null \
    || die "GHCR login failed"
fi
if [[ -z "${GHCR_TOKEN:-}" ]] && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  # No registry credentials and the image is already here: a local dry run.
  log "using the local image $IMAGE (no registry configured)"
else
  log "pulling $IMAGE"
  docker pull "$IMAGE" >/dev/null || die "cannot pull $IMAGE — nothing was changed"
fi

# --- 2. back up the database BEFORE any migration -----------------------------
if [[ -f "$DATA_DIR/evg.db" ]]; then
  BACKUP="$DATA_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ)-${TARGET_COMMIT:0:7}.db"
  # `.backup` is safe on a live database; `cp` is not.
  if command -v sqlite3 >/dev/null; then
    sqlite3 "$DATA_DIR/evg.db" ".backup '$BACKUP'" || die "backup failed — refusing to migrate"
  else
    cp "$DATA_DIR/evg.db" "$BACKUP"
  fi
  log "database backed up to $BACKUP"
  ls -1t "$DATA_DIR"/backups/*.db 2>/dev/null | tail -n +21 | xargs -r rm --
fi

# --- 3. migrate, with the OLD colour still serving ----------------------------
# This is the moment the additive-only rule pays for itself: the running code
# is the previous release, and it must keep working against the new schema.
log "applying migrations (old colour still serving)"
IMAGE_TAG="$TARGET_TAG" GIT_COMMIT="$TARGET_COMMIT" \
  compose_target run --rm --no-deps "app-$TARGET" npm run db:migrate \
  || die "migration failed — nothing was switched, $CURRENT is still serving"

# --- 4. start the idle colour -------------------------------------------------
log "starting app-$TARGET"
IMAGE_TAG="$TARGET_TAG" GIT_COMMIT="$TARGET_COMMIT" \
  compose_target up -d --no-deps "app-$TARGET" \
  || die "could not start app-$TARGET — $CURRENT is still serving"

abort_target() {
  warn "aborting: stopping app-$TARGET, leaving $CURRENT in place"
  IMAGE_TAG="$TARGET_TAG" compose_target stop "app-$TARGET" >/dev/null 2>&1 || true
  IMAGE_TAG="$TARGET_TAG" compose_target rm -f "app-$TARGET" >/dev/null 2>&1 || true
}

# --- 5. prove it healthy before anyone is sent to it --------------------------
log "waiting for app-$TARGET to report healthy"
CID="$(IMAGE_TAG="$TARGET_TAG" compose_target ps -q "app-$TARGET")"
[[ -n "$CID" ]] || { abort_target; die "app-$TARGET has no container"; }

HEALTHY=false
for _ in $(seq 1 40); do
  STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID" 2>/dev/null || echo gone)"
  [[ "$STATUS" == "healthy" ]] && { HEALTHY=true; break; }
  [[ "$STATUS" == "gone" ]] && break
  sleep 3
done
if ! $HEALTHY; then
  docker logs --tail 40 "$CID" >&2 || true
  abort_target
  die "app-$TARGET never became healthy — $CURRENT is still serving, nothing changed"
fi
log "app-$TARGET is healthy"

# Points Caddy at one colour.
#
# ALWAYS `cat >`, which truncates the file in place and keeps its inode. The
# container bind-mounts this file's directory, and anything that REPLACES the
# file — `sed -i`, `git reset --hard` — would hand it a stale inode and the
# switch would silently do nothing.
write_upstream() {
  cat > caddy/upstream.conf <<UPSTREAM
# The live colour. Rewritten by scripts/agent/deploy.sh and applied with a
# graceful \`caddy reload\`, so requests in flight are never dropped.
reverse_proxy app-$1:3000 {
	health_uri /api/health
	health_interval 5s
	health_timeout 3s
	fail_duration 10s
}
UPSTREAM
}

# --- 6. the switch: rewrite the upstream, reload Caddy gracefully -------------
write_upstream "$TARGET"

log "reloading Caddy onto app-$TARGET"
if ! $COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
  # Put the pointer back before giving up, or a later reload would switch to a
  # colour we are about to stop.
  write_upstream "$CURRENT" 2>/dev/null || true
  abort_target
  die "Caddy reload failed — $CURRENT is still serving"
fi

# --- 7. verify from the outside ----------------------------------------------
log "verifying $HEALTH_URL"
OK=false
for _ in $(seq 1 20); do
  BODY="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  if grep -q '"status":"ok"' <<< "$BODY" && grep -q "$TARGET_COMMIT" <<< "$BODY"; then
    OK=true; break
  fi
  sleep 3
done
if ! $OK; then
  warn "public health check did not report the new commit; rolling the switch back"
  write_upstream "$CURRENT"
  $COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
  abort_target
  die "deploy aborted at verification — $CURRENT is still serving"
fi

# --- 8. record, then retire the old colour -----------------------------------
[[ -f "$ACTIVE_FILE" ]] && printf '%s %s\n' "${IMAGE_TAG:-unknown}" "${GIT_COMMIT:-unknown}" > "$PREVIOUS_FILE"
echo "$TARGET" > "$ACTIVE_FILE"

# .env is what survives a reboot: the systemd unit brings the stack back from it.
python3 - "$TARGET_TAG" "$TARGET_COMMIT" "$PROFILES_BASE,$TARGET" <<'PY'
import os, re, sys
tag, commit, profiles = sys.argv[1], sys.argv[2], sys.argv[3]
values = {'IMAGE_TAG': tag, 'GIT_COMMIT': commit, 'COMPOSE_PROFILES': profiles}
lines = open('.env', encoding='utf-8').read().splitlines()
seen = set()
out = []
for line in lines:
    m = re.match(r'([A-Z0-9_]+)=', line)
    if m and m.group(1) in values:
        out.append(f'{m.group(1)}={values[m.group(1)]}')
        seen.add(m.group(1))
    else:
        out.append(line)
for key, value in values.items():
    if key not in seen:
        out.append(f'{key}={value}')
open('.env', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
PY

if [[ "$CURRENT" != "none" ]]; then
  log "stopping app-$CURRENT"
  $COMPOSE --profile "$PROFILES_BASE" --profile "$CURRENT" stop "app-$CURRENT" || true
  $COMPOSE --profile "$PROFILES_BASE" --profile "$CURRENT" rm -f "app-$CURRENT" || true
fi

# The sweeper is colour-agnostic, so it just moves to the new image. A one
# minute gap costs nothing: expiry is also applied lazily on every read.
#
# IMAGE_TAG has to be passed explicitly, like every other compose call here.
# This script reads the OLD tag into its own environment at startup (that is
# how PREVIOUS_FILE gets it), and Compose prefers the shell over `.env` — so
# without this the sweeper was recreated on the PREVIOUS image every single
# deploy, while `.env` said the new one.
log "restarting the sweeper on the new image"
IMAGE_TAG="$TARGET_TAG" GIT_COMMIT="$TARGET_COMMIT" \
  $COMPOSE --profile "$PROFILES_BASE" --profile "$TARGET" up -d --no-deps sweeper \
  || warn "sweeper restart failed"

docker image prune -a -f --filter 'until=24h' >/dev/null 2>&1 || true

cat <<REPORT

DEPLOY: $($ROLLBACK && echo rolled-back || echo ok)
COLOUR: $TARGET
IMAGE: $IMAGE
COMMIT: $TARGET_COMMIT
HEALTH: ok
DOWNTIME: none (graceful Caddy reload)
NOTES: none
REPORT
