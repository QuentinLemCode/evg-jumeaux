#!/usr/bin/env bash
# Shared helpers for the agent pipeline. Sourced, never executed directly.
#
# The pipeline deliberately talks to the coding agents through this one file so
# that Hermes only ever depends on a stable shell contract, not on a particular
# agent CLI. Swapping one runtime for another is one env var.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT

# antigravity | opencode | claude
AGENT_RUNTIME="${AGENT_RUNTIME:-antigravity}"

# PATH for agy and opencode, which no non-interactive shell inherits. See
# path.sh.
# shellcheck source=scripts/agent/path.sh
source "$(dirname "${BASH_SOURCE[0]}")/path.sh"
LOG_DIR="${AGENT_LOG_DIR:-$REPO_ROOT/.agent-logs}"
# `|| true`: a directory we cannot create is handled per-run below, and must not
# stop the agent from running at all.
mkdir -p "$LOG_DIR" 2>/dev/null || true

log()  { printf '\033[36m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[33m[%s] WARN\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[31m[%s] FATAL\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; exit 1; }

# Antigravity's execution mode.
#
# `accept-edits` for every role, the read-only ones included. `plan` was the
# obvious choice for those — until the spec agent, whose entire job is to WRITE
# `specs/NNNN-*.md`, which is exactly what plan mode exists to prevent.
#
# So the read-only roles stay read-only by what their manuals forbid and by
# what they are asked to do, not by the CLI's mode. That is weaker, and worth
# saying out loud: under OpenCode, `route` could not write a file because its
# tool list did not include one. Here it could. Spec 0013 rule 2 is now a
# promise the prompt makes rather than one the runtime enforces.
agent_mode() {
  echo "${AGENT_MODE:-accept-edits}"
}

# The role manual, inlined into the prompt.
#
# Antigravity discovers agents from somewhere its documentation does not say,
# so depending on `--agent` would mean depending on a guess. The manuals are a
# few kilobytes and they are the same files OpenCode loads, so there is exactly
# one source of truth either way.
agent_manual() {
  local role="$1" f="$REPO_ROOT/.opencode/agent/$1.md"
  [[ -r "$f" ]] || { warn "no role manual for '$role' at $f"; return 0; }
  # Strip the YAML frontmatter: it configures OpenCode and means nothing here.
  awk 'BEGIN{n=0} /^---$/{n++; next} n>=2 || n==0' "$f"
}

AGENT_RETRYABLE='model turn are not supported|Function call is missing a thought_signature'
AGENT_ATTEMPTS="${AGENT_ATTEMPTS:-3}"

run_agent() {
  local role="$1" prompt="$2"
  local attempt=1

  while :; do
    local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    local transcript="$LOG_DIR/${stamp}-${role}.log"

    # The transcript is best-effort. It used to be `| tee "$transcript"`, and
    # when the directory turned out to be root-owned — one `sudo ./status.sh`
    # is enough — tee died, took the agent's ENTIRE OUTPUT with it, and the
    # caller saw an empty report. Losing a log is a nuisance; losing the
    # report is a lie.
    if ! ( : >> "$transcript" ) 2>/dev/null; then
      warn "cannot write $transcript ($(stat -c '%U owns %n' "$LOG_DIR" 2>/dev/null || echo "$LOG_DIR missing")) — continuing without a transcript"
      transcript=/dev/null
    fi

    log "running '$role' agent via $AGENT_RUNTIME (attempt $attempt/$AGENT_ATTEMPTS, transcript: $transcript)"

    case "$AGENT_RUNTIME" in
      antigravity)
        command -v agy >/dev/null || die "agy not found in PATH (see docs/deployment.md)"
        local mode; mode="$(agent_mode)"
        # --dangerously-skip-permissions: nothing may wait for a human. A
        # pipeline that stops on a prompt nobody will ever see is worse than
        # one that fails, because it fails silently and holds the lock.
        # The prompt is ATTACHED to --print, and that is not a style choice.
        # `--print` takes an optional value, so `--print --model x "$prompt"`
        # makes agy read "--model" as the prompt and silently ignore the real
        # one — it says so itself, with exit code 2:
        #
        #   Error: --print took "--model" as its prompt, so the intended
        #   prompt was left as an argument and ignored.
        local instructions
        instructions="$(agent_manual "$role")

---

$prompt"
        ( cd "$REPO_ROOT" && agy \
            --print="$instructions" \
            --model "${AGENT_MODEL:-gemini-3.8-flash}" \
            --effort "${AGENT_EFFORT:-high}" \
            --mode "$mode" \
            --output-format text \
            --print-timeout 0 \
            --dangerously-skip-permissions ) 2>&1 | tee "$transcript"
        ;;
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
        die "unknown AGENT_RUNTIME '$AGENT_RUNTIME' (expected: antigravity | opencode | claude)"
        ;;
    esac

    # Retry only the client bug above, and only while attempts remain. Any
    # other failure is ours and must be reported, not papered over.
    if [[ "$transcript" != /dev/null ]] \
      && grep -qE "$AGENT_RETRYABLE" "$transcript" 2>/dev/null \
      && (( attempt < AGENT_ATTEMPTS )); then
      warn "the client lost a thought signature (attempt $attempt) — retrying"
      attempt=$(( attempt + 1 ))
      sleep 3
      continue
    fi
    return 0
  done
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
