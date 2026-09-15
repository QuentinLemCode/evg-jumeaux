#!/usr/bin/env bash
# Review the current diff against its spec. Advisory: never blocks a deploy.
#
#   scripts/agent/review.sh [<spec-id|spec-path>]

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SPEC_HINT="${1:-}"
if [[ -z "$SPEC_HINT" ]]; then
  SPEC_HINT="$(git -C "$REPO_ROOT" log -1 --pretty=%B | grep -m1 -oE 'specs/[0-9]{4}-[a-z0-9-]+\.md' || true)"
fi

PROMPT="Review the most recent commit (git show HEAD) against ${SPEC_HINT:-its specification, which you must locate from the commit trailer} and against the conventions in AGENTS.md. Report findings most severe first, each with file:line and the concrete input that breaks it. You are read-only."

run_agent review "$PROMPT"
