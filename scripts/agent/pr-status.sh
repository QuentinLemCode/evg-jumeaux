#!/usr/bin/env bash
# Where the agent's open pull requests stand. Read-only.
#
#   scripts/agent/pr-status.sh          # every open PR
#   scripts/agent/pr-status.sh 42       # one PR, with its checks
#
# Hermes polls this to answer "is it live yet?" without guessing.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"
command -v gh >/dev/null || die "gh is not installed"

if [[ -n "${1:-}" ]]; then
  gh pr view "$1" --json number,title,state,isDraft,mergeable,autoMergeRequest,url \
    --template '{{printf "#%v" .number}} {{.title}}
state: {{.state}}  mergeable: {{.mergeable}}  auto-merge: {{if .autoMergeRequest}}enabled{{else}}off{{end}}
{{.url}}

'
  echo "checks:"
  gh pr checks "$1" 2>&1 | sed 's/^/  /'
  exit 0
fi

OPEN="$(gh pr list --state open --json number,title,headRefName,autoMergeRequest \
  --template '{{range .}}{{printf "#%v" .number}}  {{.headRefName}}  {{if .autoMergeRequest}}auto-merge{{else}}manual{{end}}  {{.title}}
{{end}}')"

if [[ -z "${OPEN// /}" ]]; then
  echo "no open pull requests"
else
  echo "open pull requests:"
  printf '%s' "$OPEN" | sed 's/^/  /'
  echo
  echo "checks on the most recent:"
  gh pr checks "$(gh pr list --state open --limit 1 --json number --jq '.[0].number')" 2>&1 | sed 's/^/  /'
fi

echo
echo "last merged:"
gh pr list --state merged --limit 3 --json number,title,mergedAt \
  --template '{{range .}}  {{printf "#%v" .number}}  {{.mergedAt}}  {{.title}}
{{end}}'
