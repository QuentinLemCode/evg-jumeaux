#!/usr/bin/env bash
# Decide what a chat message asks for, and answer it when it is a question.
#
#   scripts/agent/route.sh "comment le score est calculé ?"
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

[[ $# -ge 1 ]] || die "usage: $0 \"<message>\""
MESSAGE="$1"

PROMPT="A message was sent to the bot. Decide whether it is a question about the app as it is, a request to change the app, or too unclear to place — and if it is a question, answer it. Follow your role manual exactly, including the output shape. The message is:

${MESSAGE}"

run_agent route "$PROMPT"
