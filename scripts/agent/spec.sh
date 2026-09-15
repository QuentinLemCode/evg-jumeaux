#!/usr/bin/env bash
# Turn a human request into a specification. Called by Hermes.
#
#   scripts/agent/spec.sh "let players challenge a whole team at beer pong"
#
# Prints the spec agent's report. Exit code 0 = ready for code,
# 2 = spec written but blocked on an open question, 1 = failure.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ $# -ge 1 ]] || die "usage: $0 \"<human request>\""
REQUEST="$*"

PROMPT="A human made this request about the EVG app:

---
${REQUEST}
---

Follow your role manual. Classify the request, read the affected specs and the
code they describe, then write or amend the specification. Update
specs/README.md and the spec's Changelog. Finish with the machine-readable
report block exactly as specified."

OUTPUT="$(run_agent spec "$PROMPT")"
printf '%s\n' "$OUTPUT"

READY="$(report_field READY_FOR_CODE "$OUTPUT" || true)"
SPEC_FILE="$(report_field SPEC_FILE "$OUTPUT" || true)"

[[ -n "$SPEC_FILE" ]] || die "spec agent returned no SPEC_FILE — see transcript in $LOG_DIR"

case "${READY,,}" in
  yes) log "spec ready for code: $SPEC_FILE"; exit 0 ;;
  *)   warn "spec $SPEC_FILE is NOT ready for code — open questions need a human"; exit 2 ;;
esac
