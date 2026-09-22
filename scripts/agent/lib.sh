#!/usr/bin/env bash
# Shared helpers for the agent pipeline. Sourced, never executed directly.
#
# The pipeline deliberately talks to the coding agents through this one file so
# that Hermes only ever depends on a stable shell contract, not on a particular
# agent CLI. Swapping OpenCode for Claude Code is one env var.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT

# opencode | claude
AGENT_RUNTIME="${AGENT_RUNTIME:-opencode}"

# PATH for opencode, which no non-interactive shell inherits. See path.sh.
# shellcheck source=scripts/agent/path.sh
source "$(dirname "${BASH_SOURCE[0]}")/path.sh"
LOG_DIR="${AGENT_LOG_DIR:-$REPO_ROOT/.agent-logs}"
# `|| true`: a directory we cannot create is handled per-run below, and must not
# stop the agent from running at all.
mkdir -p "$LOG_DIR" 2>/dev/null || true

log()  { printf '\033[36m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[33m[%s] WARN\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[31m[%s] FATAL\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; exit 1; }

# run_agent <role: spec|code|review> <prompt>
#
# Prints the agent's final message on stdout (that is the machine-readable
# report the callers parse) and tees the full transcript to .agent-logs/.
run_agent() {
  local role="$1" prompt="$2"
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local transcript="$LOG_DIR/${stamp}-${role}.log"

  # The transcript is best-effort. It used to be `| tee "$transcript"`, and when
  # the directory turned out to be root-owned — one `sudo ./status.sh` is enough
  # — tee died, took the agent's ENTIRE OUTPUT with it, and the caller saw an
  # empty report. Losing a log is a nuisance; losing the report is a lie.
  if ! ( : >> "$transcript" ) 2>/dev/null; then
    warn "cannot write $transcript ($(stat -c '%U owns %n' "$LOG_DIR" 2>/dev/null || echo "$LOG_DIR missing")) — continuing without a transcript"
    transcript=/dev/null
  fi

  log "running '$role' agent via $AGENT_RUNTIME (transcript: $transcript)"

  case "$AGENT_RUNTIME" in
    opencode)
      command -v opencode >/dev/null || die "opencode not found in PATH"
      ( cd "$REPO_ROOT" && opencode run \
          --agent "$role" \
          --auto \
          --title "${role}: ${prompt:0:60}" \
          "$prompt" ) 2>&1 | tee "$transcript"
      ;;
    claude)
      command -v claude >/dev/null || die "claude not found in PATH"
      local subagent="${role}-agent"
      ( cd "$REPO_ROOT" && claude -p \
          --permission-mode acceptEdits \
          "Delegate this to the ${subagent} subagent and return its report verbatim: ${prompt}" \
        ) 2>&1 | tee "$transcript"
      ;;
    *)
      die "unknown AGENT_RUNTIME '$AGENT_RUNTIME' (expected: opencode | claude)"
      ;;
  esac
}

# report_field <key> <text> — pull "KEY: value" out of an agent report
report_field() {
  local key="$1" text="$2"
  printf '%s\n' "$text" | grep -m1 -E "^[[:space:]]*${key}:" | sed -E "s/^[[:space:]]*${key}:[[:space:]]*//" | tr -d '\r'
}

require_clean_tree() {
  git -C "$REPO_ROOT" diff --quiet && git -C "$REPO_ROOT" diff --cached --quiet \
    || die "working tree is dirty — commit or stash before running the pipeline"
}

run_gate() {
  log "gate: typecheck"
  ( cd "$REPO_ROOT" && npm run --silent typecheck ) || return 1
  log "gate: design system"
  ( cd "$REPO_ROOT" && npm run --silent lint:design ) || return 1
  log "gate: migrations are additive"
  ( cd "$REPO_ROOT" && npm run --silent lint:migrations ) || return 1
  log "gate: every spec has an end-to-end test"
  ( cd "$REPO_ROOT" && npm run --silent lint:e2e-coverage ) || return 1
  log "gate: tests"
  ( cd "$REPO_ROOT" && npm test --silent ) || return 1
  log "gate: build"
  ( cd "$REPO_ROOT" && npm run --silent build ) || return 1
  log "gate: green"
}
