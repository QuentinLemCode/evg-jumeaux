#!/usr/bin/env bash
# The whole spec-driven loop, end to end. This is the entry point Hermes uses
# for "change the app so that ...".
#
#   scripts/agent/pipeline.sh "add a photo wall where everyone can post pictures"
#   scripts/agent/pipeline.sh --no-deploy "..."   # stop after the code agent
#
# It stops at the first step that needs a human, and says which one.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DEPLOY=true
if [[ "${1:-}" == "--no-deploy" ]]; then DEPLOY=false; shift; fi
[[ $# -ge 1 ]] || die "usage: $0 [--no-deploy] \"<human request>\""
REQUEST="$*"

cd "$REPO_ROOT"
require_clean_tree

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

# --- step 4: deploy ---------------------------------------------------------
if ! $DEPLOY; then
  cat <<REPORT

PIPELINE: ok-not-deployed
STAGE: code
SPEC_FILE: $SPEC_FILE
COMMIT: $(git rev-parse --short HEAD)
NEXT: scripts/agent/deploy.sh
REPORT
  exit 0
fi

log "STEP 4/4 — deploy"
log "pushing to origin/main"
git push origin main || die "push failed — the change is committed locally but not deployed"

set +e
DEPLOY_OUT="$("$REPO_ROOT/scripts/agent/deploy.sh")"; DEPLOY_RC=$?
set -e
printf '%s\n' "$DEPLOY_OUT"

if [[ $DEPLOY_RC -ne 0 ]]; then
  cat <<REPORT

PIPELINE: deploy-failed
STAGE: deploy
SPEC_FILE: $SPEC_FILE
NEXT: scripts/agent/deploy.sh --rollback
REPORT
  exit 1
fi

cat <<REPORT

PIPELINE: ok
SPEC_FILE: $SPEC_FILE
COMMIT: $(git rev-parse --short HEAD)
DEPLOYED: yes
SUMMARY: $(report_field SUMMARY "$SPEC_OUT" || echo "$REQUEST")
REPORT
