#!/usr/bin/env bash
# Decide what a chat message asks for, and answer it when it is a question.
#
#   scripts/agent/route.sh "comment le score est calculé ?"
#   scripts/agent/route.sh --context ctx.txt "et pour le classement ?"
#
# Prints the router's report on stdout:
#
#   DECISION: answer | change | unclear
#   ---
#   <body>
#
# Read-only by construction: the agent has no write, edit or bash tool. The
# gateway parses the first line and never runs anything on a failure (spec
# 0013, rule 12).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CONTEXT_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --context) CONTEXT_FILE="${2:-}"; shift 2 ;;
    --)        shift; break ;;
    *)         break ;;
  esac
done

[[ $# -ge 1 ]] || die "usage: $0 [--context <file>] \"<message>\""
MESSAGE="$1"

# The context is passed as a FILE, not an argument: a conversation contains
# quotes, newlines and whatever a guest typed, and none of that belongs on a
# command line.
CONTEXT="(aucun contexte)"
if [[ -n "$CONTEXT_FILE" ]]; then
  [[ -r "$CONTEXT_FILE" ]] || die "cannot read context file: $CONTEXT_FILE"
  CONTEXT="$(cat "$CONTEXT_FILE")"
fi

PROMPT="A message was sent to the bot. Decide whether it is a question about the app as it is, a request to change the app, or too unclear to place — and if it is a question, answer it. Follow your role manual exactly, including the output shape.

${CONTEXT}

## Le message

${MESSAGE}"

run_agent route "$PROMPT"
