#!/usr/bin/env bash
# The whole spec-driven loop, end to end. This is the entry point Hermes uses
# for "change the app so that ...".
#
#   scripts/agent/pipeline.sh "add a photo wall where everyone can post pictures"
#   scripts/agent/pipeline.sh --spec-only "..."          # stop after the spec
#   scripts/agent/pipeline.sh --from-spec specs/0011-x.md # resume after approval
#   scripts/agent/pipeline.sh --no-pr "..."              # stop after the code agent
#   scripts/agent/pipeline.sh --watch "..."              # block until the PR merges
#
#   spec ▸ [ a human approves ] ▸ code ▸ review ▸ PULL REQUEST ▸ checks ▸ deploy
#
# Spec 0015 splits the run in two so the human who asked can read the
# specification before any code is written. The one-shot form is kept: it is
# what a human at a terminal wants, and the chat is not the only caller.
#
# The agent does NOT push to main and does NOT deploy. It opens a pull request
# with auto-merge on, and the required checks decide whether it lands.
#
# It stops at the first step that needs a human, and says which one.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MODE=full          # full | spec-only | from-spec
OPEN_PR=true
WATCH=false
FROM_SPEC=""
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --no-pr|--no-deploy) OPEN_PR=false; shift ;;
    --watch)             WATCH=true; shift ;;
    --spec-only)         MODE=spec-only; shift ;;
    --from-spec)
      # `shift 2` with one argument left returns non-zero, and `set -e` then
      # kills the script with no message at all — the caller sees an empty
      # answer and no reason.
      MODE=from-spec; FROM_SPEC="${2:-}"; shift
      if [[ $# -gt 0 ]]; then shift; fi
      ;;
    *)                   die "unknown flag: $1" ;;
  esac
done

cd "$REPO_ROOT"
BASE="${PR_BASE_BRANCH:-main}"

# branch_for <spec-file> — the one place that derives a branch from a spec, so
# the two phases cannot disagree about where the work lives.
branch_for() {
  if [[ "$1" =~ ([0-9]{4})-([a-z0-9-]+)\.md$ ]]; then
    printf 'agent/%s-%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
  else
    return 1
  fi
}

# --- the specification phase --------------------------------------------------
run_spec_phase() {
  local request="$1" total="$2"
  require_clean_tree

  # Every run starts from a current main, so two requests in a row cannot build
  # on each other's unmerged work by accident.
  log "STEP 1/$total — preparation"
  git fetch --quiet origin "$BASE" || die "cannot reach origin"
  git checkout --quiet "$BASE" || die "cannot check out $BASE"
  git reset --hard --quiet "origin/$BASE"

  log "STEP 2/$total — specification"
  set +e
  SPEC_OUT="$("$REPO_ROOT/scripts/agent/spec.sh" "$request")"; SPEC_RC=$?
  set -e
  printf '%s\n' "$SPEC_OUT"
  SPEC_FILE="$(report_field SPEC_FILE "$SPEC_OUT" || true)"

  [[ $SPEC_RC -eq 0 ]] && return 0

  # The reason comes from the agent, never from here. This used to assert "the
  # spec has open questions" for EVERY non-zero exit — including a failure that
  # never reached the model at all — which sent a human looking for questions in
  # a spec that did not exist.
  local questions notes reason
  questions="$(report_field QUESTIONS "$SPEC_OUT" || true)"
  notes="$(report_field NOTES "$SPEC_OUT" || true)"
  if [[ -n "$questions" ]]; then
    reason="$questions"
  elif [[ -n "$notes" ]]; then
    reason="$notes"
  elif [[ -z "${SPEC_OUT//[[:space:]]/}" ]]; then
    reason="the spec agent produced no report at all (exit $SPEC_RC) — it probably never reached the model; see the log above"
  else
    reason="the spec agent exited $SPEC_RC without saying why; see its output above"
  fi
  cat <<REPORT

PIPELINE: needs-human
STAGE: spec
SPEC_FILE: ${SPEC_FILE:-none}
REASON: $reason
NEXT: ${SPEC_FILE:+answer the open questions in $SPEC_FILE, then run: scripts/agent/code.sh $SPEC_FILE}${SPEC_FILE:-fix the failure above and re-run the request}
REPORT
  exit 2
}

# --- everything after the specification ----------------------------------------
run_code_phase() {
  local spec="$1" total="$2" step="$3"

  log "STEP $step/$total — implementation"
  set +e
  CODE_OUT="$("$REPO_ROOT/scripts/agent/code.sh" "$spec")"; CODE_RC=$?
  set -e
  printf '%s\n' "$CODE_OUT"

  if [[ $CODE_RC -ne 0 ]]; then
    cat <<REPORT

PIPELINE: needs-human
STAGE: code
SPEC_FILE: $spec
REASON: $(report_field NOTES "$CODE_OUT" || echo 'the code agent could not finish cleanly')
NEXT: read the transcript in $LOG_DIR, then re-run: scripts/agent/code.sh $spec
REPORT
    exit 2
  fi

  step=$(( step + 1 ))
  log "STEP $step/$total — review"
  REVIEW_OUT="$("$REPO_ROOT/scripts/agent/review.sh" "$spec" || true)"
  printf '%s\n' "$REVIEW_OUT"

  if ! $OPEN_PR; then
    cat <<REPORT

PIPELINE: ok-no-pr
STAGE: code
SPEC_FILE: $spec
COMMIT: $(git rev-parse --short HEAD)
NEXT: scripts/agent/open-pr.sh $spec
REPORT
    exit 0
  fi

  step=$(( step + 1 ))
  log "STEP $step/$total — pull request"
  set +e
  if $WATCH; then
    PR_OUT="$("$REPO_ROOT/scripts/agent/open-pr.sh" --watch "$spec")"; PR_RC=$?
  else
    PR_OUT="$("$REPO_ROOT/scripts/agent/open-pr.sh" "$spec")"; PR_RC=$?
  fi
  set -e
  printf '%s\n' "$PR_OUT"

  if [[ $PR_RC -ne 0 ]]; then
    cat <<REPORT

PIPELINE: pr-failed
STAGE: pull-request
SPEC_FILE: $spec
NEXT: read the transcript in $LOG_DIR, then: scripts/agent/open-pr.sh $spec
REPORT
    exit 1
  fi

  cat <<REPORT

PIPELINE: pr-open
SPEC_FILE: $spec
PR: $(report_field PR "$PR_OUT" || echo unknown)
AUTO_MERGE: $(report_field AUTO_MERGE "$PR_OUT" || echo unknown)
SUMMARY: $(report_field SUMMARY "${SPEC_OUT:-}" || echo "$spec")
NEXT: the required checks merge it, then main builds and deploys. Poll with scripts/agent/pr-status.sh
REPORT
}

case "$MODE" in
  spec-only)
    [[ $# -ge 1 ]] || die "usage: $0 --spec-only \"<human request>\""
    run_spec_phase "$*" 2
    [[ -n "${SPEC_FILE:-}" ]] || die "the spec agent reported no SPEC_FILE, so there is nothing to approve"

    # The specification is COMMITTED and PUSHED, not left in the working tree.
    # A human takes minutes or hours to approve, and in that window the VM's
    # checkout is reset to origin/main by any `refresh_agents` run — which
    # would delete the specification without a trace.
    BRANCH="$(branch_for "$SPEC_FILE")" || die "cannot derive a branch from '$SPEC_FILE'"
    git checkout --quiet -B "$BRANCH"
    git add -A
    TITLE="$(grep -m1 '^# ' "$SPEC_FILE" 2>/dev/null | sed 's/^# *//' || true)"
    git commit --quiet -m "spec: ${TITLE:-$SPEC_FILE}" -m "Spec: $SPEC_FILE" \
      || die "the spec agent changed nothing, so there is nothing to approve"
    git push --quiet --force-with-lease -u origin "$BRANCH" \
      || warn "could not push $BRANCH — the specification is committed locally only"

    cat <<REPORT

PIPELINE: spec-ready
STAGE: spec
SPEC_FILE: $SPEC_FILE
BRANCH: $BRANCH
NEXT: a human approves, then: scripts/agent/pipeline.sh --from-spec $SPEC_FILE
REPORT
    ;;

  from-spec)
    [[ -n "$FROM_SPEC" ]] || die "usage: $0 --from-spec <spec-file>"
    BRANCH="$(branch_for "$FROM_SPEC")" || die "cannot derive a branch from '$FROM_SPEC'"
    require_clean_tree
    git fetch --quiet origin "$BRANCH" 2>/dev/null || true
    if git rev-parse --verify --quiet "$BRANCH" >/dev/null; then
      git checkout --quiet "$BRANCH"
    elif git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
      git checkout --quiet -b "$BRANCH" "origin/$BRANCH"
    else
      die "branch $BRANCH does not exist — was the specification phase run?"
    fi
    [[ -f "$FROM_SPEC" ]] || die "$FROM_SPEC is not on $BRANCH"
    run_code_phase "$FROM_SPEC" 3 1
    ;;

  full)
    [[ $# -ge 1 ]] || die "usage: $0 [--no-pr] [--watch] \"<human request>\""
    run_spec_phase "$*" 5
    [[ -n "${SPEC_FILE:-}" ]] || die "the spec agent reported no SPEC_FILE"
    run_code_phase "$SPEC_FILE" 5 3
    ;;
esac
