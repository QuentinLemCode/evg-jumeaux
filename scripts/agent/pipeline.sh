#!/usr/bin/env bash
# The whole spec-driven loop, end to end. This is the entry point Hermes uses
# for "change the app so that ...".
#
#   scripts/agent/pipeline.sh "add a photo wall where everyone can post pictures"
#   scripts/agent/pipeline.sh --no-pr "..."    # stop after the code agent
#   scripts/agent/pipeline.sh --watch "..."    # block until the PR merges
#
#   spec ▸ code ▸ review ▸ PULL REQUEST ▸ (required checks) ▸ auto-merge ▸ deploy
#
# The agent does NOT push to main and does NOT deploy. It opens a pull request
# with auto-merge on, and the required checks decide whether it lands. Deploying
# is then the Deploy workflow's job, from main.
#
# It stops at the first step that needs a human, and says which one.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

OPEN_PR=true
WATCH=false
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --no-pr|--no-deploy) OPEN_PR=false; shift ;;
    --watch)             WATCH=true; shift ;;
    *)                   die "unknown flag: $1" ;;
  esac
done
[[ $# -ge 1 ]] || die "usage: $0 [--no-pr] [--watch] \"<human request>\""
REQUEST="$*"

cd "$REPO_ROOT"
require_clean_tree

# Every run starts from a current main, so two requests in a row cannot build
# on each other's unmerged work by accident.
BASE="${PR_BASE_BRANCH:-main}"
log "STEP 0/4 — starting from origin/$BASE"
git fetch --quiet origin "$BASE" || die "cannot reach origin"
git checkout --quiet "$BASE" || die "cannot check out $BASE"
git reset --hard --quiet "origin/$BASE"

# --- step 1: spec -----------------------------------------------------------
log "STEP 1/4 — specification"
set +e
SPEC_OUT="$("$REPO_ROOT/scripts/agent/spec.sh" "$REQUEST")"; SPEC_RC=$?
set -e
printf '%s\n' "$SPEC_OUT"
SPEC_FILE="$(report_field SPEC_FILE "$SPEC_OUT" || true)"

if [[ $SPEC_RC -ne 0 ]]; then
  cat <<REPORT

PIPELINE: needs-human
STAGE: spec
SPEC_FILE: ${SPEC_FILE:-none}
REASON: the spec has open questions that would change the implementation
NEXT: answer the open questions in ${SPEC_FILE:-the spec}, then run: scripts/agent/code.sh ${SPEC_FILE:-<spec>}
REPORT
  exit 2
fi

# --- step 2: code -----------------------------------------------------------
log "STEP 2/4 — implementation"
set +e
CODE_OUT="$("$REPO_ROOT/scripts/agent/code.sh" "$SPEC_FILE")"; CODE_RC=$?
set -e
printf '%s\n' "$CODE_OUT"

if [[ $CODE_RC -ne 0 ]]; then
  cat <<REPORT

PIPELINE: needs-human
STAGE: code
SPEC_FILE: $SPEC_FILE
REASON: $(report_field NOTES "$CODE_OUT" || echo 'the code agent could not finish cleanly')
NEXT: read the transcript in $LOG_DIR, then re-run: scripts/agent/code.sh $SPEC_FILE
REPORT
  exit 2
fi

# --- step 3: review (advisory) ----------------------------------------------
log "STEP 3/4 — review (advisory)"
REVIEW_OUT="$("$REPO_ROOT/scripts/agent/review.sh" "$SPEC_FILE" || true)"
printf '%s\n' "$REVIEW_OUT"

# --- step 4: pull request ---------------------------------------------------
if ! $OPEN_PR; then
  cat <<REPORT

PIPELINE: ok-no-pr
STAGE: code
SPEC_FILE: $SPEC_FILE
COMMIT: $(git rev-parse --short HEAD)
NEXT: scripts/agent/open-pr.sh $SPEC_FILE
REPORT
  exit 0
fi

log "STEP 4/4 — pull request"
set +e
if $WATCH; then
  PR_OUT="$("$REPO_ROOT/scripts/agent/open-pr.sh" --watch "$SPEC_FILE")"; PR_RC=$?
else
  PR_OUT="$("$REPO_ROOT/scripts/agent/open-pr.sh" "$SPEC_FILE")"; PR_RC=$?
fi
set -e
printf '%s\n' "$PR_OUT"

if [[ $PR_RC -ne 0 ]]; then
  cat <<REPORT

PIPELINE: pr-failed
STAGE: pull-request
SPEC_FILE: $SPEC_FILE
NEXT: read the transcript in $LOG_DIR, then: scripts/agent/open-pr.sh $SPEC_FILE
REPORT
  exit 1
fi

cat <<REPORT

PIPELINE: pr-open
SPEC_FILE: $SPEC_FILE
PR: $(report_field PR "$PR_OUT" || echo unknown)
AUTO_MERGE: $(report_field AUTO_MERGE "$PR_OUT" || echo unknown)
SUMMARY: $(report_field SUMMARY "$SPEC_OUT" || echo "$REQUEST")
NEXT: the required checks merge it, then main builds and deploys. Poll with scripts/agent/pr-status.sh
REPORT
