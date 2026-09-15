#!/usr/bin/env bash
# Implement an existing specification. Called by Hermes after spec.sh.
#
#   scripts/agent/code.sh 0004
#   scripts/agent/code.sh specs/0004-match-lifecycle.md
#
# Exit code 0 = implemented and the gate is green, 2 = blocked or partial,
# 1 = failure.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ $# -ge 1 ]] || die "usage: $0 <spec-id|spec-path>"
ARG="$1"

if [[ -f "$REPO_ROOT/$ARG" ]]; then
  SPEC="$ARG"
else
  SPEC="$(cd "$REPO_ROOT" && ls specs/${ARG}-*.md 2>/dev/null | head -1)"
  [[ -n "$SPEC" ]] || die "no spec matches '$ARG' (looked for specs/${ARG}-*.md)"
fi
log "implementing $SPEC"

PROMPT="Implement the specification in ${SPEC}.

Follow your role manual: read the spec end to end, stop and report BLOCKED if
it is not ready for code or contradicts the existing implementation, implement
bottom-up with tests, then run 'npm run typecheck && npm test && npm run build'
and paste the real output. Tick the acceptance criteria you satisfy, commit with
a conventional-commit message carrying a 'Spec: ${SPEC}' trailer, and finish
with the machine-readable report block exactly as specified."

OUTPUT="$(run_agent code "$PROMPT")"
printf '%s\n' "$OUTPUT"

STATUS="$(report_field STATUS "$OUTPUT" || true)"
case "${STATUS,,}" in
  done)
    log "verifying the gate independently of the agent's claim"
    run_gate || die "agent reported STATUS: done but the gate is red"
    log "implementation complete and verified"
    exit 0
    ;;
  blocked|partial)
    warn "agent reported STATUS: ${STATUS} — a human needs to look at this"
    exit 2
    ;;
  *)
    die "code agent returned no usable STATUS — see transcript in $LOG_DIR"
    ;;
esac
