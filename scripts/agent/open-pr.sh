#!/usr/bin/env bash
# Turns the code agent's work into a pull request, and lets CI decide whether
# it lands.
#
#   scripts/agent/open-pr.sh specs/0011-photo-wall.md
#   scripts/agent/open-pr.sh --watch specs/0011-photo-wall.md
#
# The agent never pushes to main. It pushes a branch, opens a PR and turns on
# auto-merge; the required checks are what merge it. That is the point: an
# agent that can push to main can deploy a broken build at 2 a.m., and no
# amount of instructions in a markdown file prevents it — a branch protection
# rule does.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WATCH=false
if [[ "${1:-}" == "--watch" ]]; then WATCH=true; shift; fi
SPEC="${1:-}"

cd "$REPO_ROOT"
command -v gh >/dev/null || die "gh is not installed — see docs/deployment.md"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated (GH_TOKEN missing?)"

BASE="${PR_BASE_BRANCH:-main}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# --- 1. a branch, never main --------------------------------------------------
if [[ "$BRANCH" == "$BASE" ]]; then
  if [[ -n "$SPEC" && "$SPEC" =~ ([0-9]{4})-([a-z0-9-]+)\.md$ ]]; then
    BRANCH="agent/${BASH_REMATCH[1]}-${BASH_REMATCH[2]}"
  else
    BRANCH="agent/$(date -u +%Y%m%d-%H%M%S)"
  fi
  log "creating branch $BRANCH"
  git checkout -b "$BRANCH" >/dev/null 2>&1 || die "could not create $BRANCH"
fi

# --- 2. commit whatever the agent left behind --------------------------------
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "committing the working tree"
  git add -A
  SUBJECT="chore(agent): apply ${SPEC:-pending change}"
  if [[ -n "$SPEC" ]]; then
    TITLE="$(grep -m1 '^# ' "$SPEC" 2>/dev/null | sed 's/^# *//' || true)"
    [[ -n "$TITLE" ]] && SUBJECT="feat: ${TITLE}"
  fi
  git commit --quiet -m "$SUBJECT" -m "Spec: ${SPEC:-none}" \
    || die "nothing to commit and nothing staged"
fi

git rev-parse --verify --quiet "$BASE" >/dev/null || git fetch --quiet origin "$BASE"
if [[ "$(git rev-list --count "origin/$BASE..HEAD" 2>/dev/null || echo 0)" == "0" ]]; then
  die "no commits ahead of origin/$BASE — there is nothing to open a PR for"
fi

# --- 3. rebase onto the base, because auto-merge needs to be up to date ------
log "rebasing onto origin/$BASE"
git fetch --quiet origin "$BASE"
git rebase --quiet "origin/$BASE" || {
  git rebase --abort 2>/dev/null || true
  die "rebase onto origin/$BASE conflicts — a human has to resolve this"
}

log "pushing $BRANCH"
git push --quiet --force-with-lease -u origin "$BRANCH" || die "push failed"

# --- 4. the pull request ------------------------------------------------------
BODY_FILE="$(mktemp)"
{
  echo "Opened by the code agent from \`${SPEC:-an unspecified change}\`."
  echo
  if [[ -n "$SPEC" && -f "$SPEC" ]]; then
    echo "## Spec"
    echo
    sed -n '/^## Intent/,/^## /p' "$SPEC" | sed '$d' | sed '1d'
    echo
    echo "## Acceptance criteria"
    echo
    grep -E '^- \[[ x]\]' "$SPEC" | head -25
    echo
  fi
  cat <<'NOTE'
## How this lands

Auto-merge is on. The required checks decide — this PR merges itself when they
pass, and sits here if they do not. Nothing deploys until it is merged, and the
deploy then verifies `/api/health` reports this commit.

If a check is red, read it rather than re-running it: the gate is the same one
the agent ran locally, so a difference is information.
NOTE
} > "$BODY_FILE"

PR_TITLE="$(git log -1 --pretty=%s)"
if gh pr view --json url --jq .url >/dev/null 2>&1; then
  log "a pull request already exists for $BRANCH, updating it"
else
  gh pr create --base "$BASE" --head "$BRANCH" \
    --title "$PR_TITLE" --body-file "$BODY_FILE" >/dev/null \
    || die "could not open the pull request"
fi
rm -f "$BODY_FILE"

PR_URL="$(gh pr view --json url --jq .url)"
PR_NUMBER="$(gh pr view --json number --jq .number)"
log "pull request #$PR_NUMBER — $PR_URL"

# --- 5. auto-merge, asked for AND verified -----------------------------------
#
# `gh pr merge --auto` exiting 0 is not proof: it can also merge the PR on the
# spot when nothing is blocking it. So the state is read back from GitHub
# rather than inferred from an exit code, and a failure prints what GitHub
# actually said instead of a guess.
AUTO=false
MERGE_ERR="$(gh pr merge "$PR_NUMBER" --auto --squash --delete-branch 2>&1)" && MERGE_OK=true || MERGE_OK=false

# `autoMergeRequest` is non-null only while auto-merge is armed; once it fires
# the PR is simply MERGED.
AUTO_STATE="$(gh pr view "$PR_NUMBER" --json autoMergeRequest,state \
  --jq 'if .state == "MERGED" then "merged" elif .autoMergeRequest then "armed" else "off" end' 2>/dev/null || echo unknown)"

case "$AUTO_STATE" in
  armed)
    AUTO=true
    log "auto-merge armed — the required checks will merge it"
    ;;
  merged)
    AUTO=true
    log "nothing was blocking it: the pull request merged immediately"
    ;;
  *)
    warn "auto-merge is NOT armed${MERGE_ERR:+ — gh said: $MERGE_ERR}"
    # Name the cause rather than listing the possibilities. These two are the
    # only ones that produce this, and both are repository settings a human
    # has to fix; the agent's token deliberately cannot.
    if [ "$(gh api "repos/{owner}/{repo}" --jq .allow_auto_merge 2>/dev/null)" != "true" ]; then
      warn "cause: Settings > General > Pull Requests > Allow auto-merge is OFF"
    elif ! gh api "repos/{owner}/{repo}/rules/branches/$BASE" \
      --jq '.[] | select(.type=="required_status_checks")' 2>/dev/null | grep -q .; then
      warn "cause: no required status check on '$BASE' — auto-merge has nothing to wait for"
    else
      warn "cause: unclear; both repository settings look correct"
    fi
    warn "see README.md > Repository settings — the PR stays open for a human to merge"
    ;;
esac
$MERGE_OK || true

if $WATCH; then
  log "waiting for the checks"
  if gh pr checks "$PR_NUMBER" --watch --fail-fast; then
    log "checks are green"
  else
    warn "checks failed — the PR will not merge"
  fi
fi

STATE="$(gh pr view "$PR_NUMBER" --json state --jq .state)"
cat <<REPORT

PR: $PR_URL
NUMBER: $PR_NUMBER
BRANCH: $BRANCH
BASE: $BASE
AUTO_MERGE: $AUTO_STATE
STATE: $STATE
NEXT: $($AUTO && echo "the required checks merge it, then main deploys" || echo "a human must merge it")
REPORT
