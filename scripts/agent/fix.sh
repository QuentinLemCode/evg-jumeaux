#!/usr/bin/env bash
# Repair the machinery — infrastructure, workflows, agent tooling — without a
# product spec.
#
#   scripts/agent/fix.sh "the spec agent crashes on a Gemini turn-order error"
#
# WHY THIS IS NOT pipeline.sh: `specs/` is the PRODUCT contract (AGENTS.md §8).
# A broken systemd unit is not a feature of the party leaderboard and writing a
# numbered spec for it would put noise in the one place that has to stay
# readable. Repairs are a different kind of change and get a different door.
#
# WHAT STOPS THIS FROM BEING A BACKDOOR: the pull request it opens is checked
# by `Guarded paths`, which FAILS whenever infrastructure, workflows or agent
# tooling changed and no human has said yes. The agent can propose a fix to the
# machinery; it cannot merge one.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ $# -ge 1 ]] || die "usage: $0 \"<what is broken>\""
PROBLEM="$1"

log "STEP 0/3 — starting from origin/main"
git fetch --quiet origin main || die "cannot reach origin"
git checkout --quiet main || die "cannot check out main"
git reset --hard --quiet origin/main

BRANCH="agent/fix-$(date -u +%Y%m%dT%H%M%SZ)"
git checkout --quiet -b "$BRANCH"

log "STEP 1/3 — diagnosis and repair"
PROMPT="Something in this repository's own machinery is broken. Diagnose it and fix it.

  ${PROBLEM}

This is a REPAIR, not a feature: do not write a numbered spec, and do not
change product behaviour. You may change infrastructure, workflows, scripts
and agent configuration.

Rules that still bind you:
  - Establish the cause before changing anything. Say what evidence you have.
    A guessed cause that happens to work is worse than none, because it will
    be believed next time.
  - Change the smallest thing that fixes it. Leave what you did not verify.
  - If you cannot establish the cause, say so and stop. Do not try something
    plausible and call it fixed.
  - The gate still applies: npm run typecheck && npm run lint:design && npm test.

Report:
  FIX: <one line: what you changed>
  CAUSE: <the evidence, not the theory>
  VERIFIED: <how you know, or 'not verified'>
  NOTES: <anything a human must still do>"

set +e
FIX_OUT="$(run_agent code "$PROMPT")"; FIX_RC=$?
set -e
printf '%s\n' "$FIX_OUT"

if [[ $FIX_RC -ne 0 ]] || [[ -z "$(git status --porcelain)" ]]; then
  REASON="$(report_field NOTES "$FIX_OUT" || true)"
  cat <<REPORT

FIX: needs-human
CAUSE: $(report_field CAUSE "$FIX_OUT" || echo 'not established')
REASON: ${REASON:-the agent changed nothing and did not say why}
NEXT: this one needs a human — the agent could not establish the cause
REPORT
  exit 2
fi

log "STEP 2/3 — the gate"
if ! run_gate; then
  cat <<REPORT

FIX: needs-human
REASON: the repair does not pass the gate
NEXT: the branch $BRANCH is left in place for a human to look at
REPORT
  exit 2
fi

log "STEP 3/3 — pull request"
git add -A
git commit --quiet -m "fix(machinery): $(report_field FIX "$FIX_OUT" || echo "$PROBLEM")

$(report_field CAUSE "$FIX_OUT" || true)

Opened by scripts/agent/fix.sh. Touching infrastructure, workflows or agent
tooling requires a human to add the 'infra-ok' label before this can merge."
git push --quiet -u origin "$BRANCH"

PR_URL="$(gh pr create --base main --head "$BRANCH" \
  --title "fix(machinery): $(report_field FIX "$FIX_OUT" || echo "$PROBLEM")" \
  --body "$(cat <<BODY
Opened by \`scripts/agent/fix.sh\` — a repair of the machinery, not a product
change, so there is no numbered spec.

**Cause:** $(report_field CAUSE "$FIX_OUT" || echo 'not established')

**Verified:** $(report_field VERIFIED "$FIX_OUT" || echo 'not verified')

**Notes:** $(report_field NOTES "$FIX_OUT" || echo 'none')

If this touches infrastructure, workflows or agent tooling, \`Guarded paths\`
will fail until a human adds the \`infra-ok\` label. That is deliberate: these
are the files that define what the agent is allowed to do.
BODY
)" 2>&1 | tail -1)"

gh pr merge --auto --squash --delete-branch >/dev/null 2>&1 || true

cat <<REPORT

FIX: proposed
PR: $PR_URL
CAUSE: $(report_field CAUSE "$FIX_OUT" || echo 'not established')
NEXT: a human adds the 'infra-ok' label if this touches the machinery, then the checks merge it
REPORT
