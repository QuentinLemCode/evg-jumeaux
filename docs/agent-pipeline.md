# The agent pipeline

## Two doors, not one

A change to the party's leaderboard and a repair of the machinery that builds
it are different things, and conflating them put a broken agent out of reach.

| | product change | repair |
|---|---|---|
| entry | `pipeline.sh "<request>"` | `fix.sh "<what is broken>"` |
| spec | a numbered spec, first | none — `specs/` is the product contract |
| example | «corrige les marges du classement» | «l'agent de specs plante» |
| merges | when the required checks pass | only after a human adds `infra-ok`, if it touches the machinery |

The router (spec 0013) picks the door. The test it applies: does the
leaderboard behave differently afterwards?

### The guarded paths

`terraform/`, `.github/workflows/`, `scripts/agent/`, `.opencode/`, `skills/`
and `AGENTS.md`. A pull request touching any of them fails `Guarded paths`
until a human adds the `infra-ok` label.

This is not distrust of the agent's judgement — it is that these files define
the judgement. An agent able to merge a change to `ci.yml` could weaken the
gate in the very pull request the gate is about to judge, and auto-merge would
honour the weakened one. The rule would be enforcing its own removal, which is
not a rule.

Adding the label is one click, and the check re-runs on it.

The guard lives in its own workflow, `.github/workflows/guard.yml`, and not as
a job in CI. It was a job in CI once, which meant CI had to run on the
`labeled` event, and that cost PR #31 its end-to-end result twice over: the
label run cancelled the code run they shared a concurrency group with, and
then reported `Verdict: skipped` on a commit whose `Verdict` had FAILED —
newest run wins, and a skipped required check satisfies the rule. The pull
request merged two minutes later. Keeping the two workflows apart is what
stops a label from ever answering for the code.


How a sentence typed into Discord becomes a deployed change.

## The chain

```
  human on Discord / Telegram
        │  "ajoute un podium avec des médailles en haut du classement"
        ▼
  ┌───────────────┐   hermes/system-prompt.md + hermes/tools.json
  │    HERMES     │   Talks to people. Routes. Reports. Writes no code.
  └───────┬───────┘
          │  scripts/agent/pipeline.sh "<request>"
          ▼
  ┌───────────────┐   .opencode/agent/spec.md
  │  SPEC AGENT   │   Owns specs/. Writes the contract. Cannot touch src/.
  └───────┬───────┘   Blocks if the request is ambiguous.
          │  READY_FOR_CODE: yes  →  scripts/agent/code.sh <spec>
          ▼
  ┌───────────────┐   .opencode/agent/code.md
  │  CODE AGENT   │   Owns src/. Implements the spec exactly. Cannot touch specs/.
  └───────┬───────┘   Runs typecheck + tests + build, commits.
          │  STATUS: done
          ▼
  ┌───────────────┐   .opencode/agent/review.md   (advisory, never blocks)
  │    REVIEWER   │   Read-only. Diff vs spec vs conventions.
  └───────┬───────┘
          │  scripts/agent/open-pr.sh
          ▼
  ┌───────────────┐
  │ PULL REQUEST  │   auto-merge on. The REQUIRED CHECKS decide, not the agent.
  └───────┬───────┘
          │  GitHub Actions, on main
          ▼
  ┌───────────────┐
  │  PRODUCTION   │   pull image → backup db → migrate → start idle colour →
  │  (app VM)     │   caddy reload → verify /api/health reports the new commit
  └───────────────┘
```

Two machines: everything above the pull request runs on the **agents VM**,
everything below it on the **application VM**. An agent's build cannot slow the
site down, and neither machine holds the other's secrets.

## Why it is split this way

**Hermes never writes code.** A model tuned to hold a conversation on a phone
is not the same tool as one tuned to stay inside a repository's conventions.
Merging the two produces an agent that is chatty in the codebase and terse with
humans. Hermes' job is routing and reporting, and that is all its system prompt
allows.

**The spec agent cannot touch `src/`, and the code agent cannot touch
`specs/`.** This is the load-bearing constraint of the whole design. If one
agent could do both, it would resolve every ambiguity by quietly editing the
spec to match whatever it felt like building, and the spec would stop being a
contract. Because the roles are separate, an ambiguous request has nowhere to
go except back to the human.

**Blocking is a success.** `spec.sh` exits 2 when the spec has open questions;
`code.sh` exits 2 when the spec contradicts the code. The pipeline stops and
tells Hermes exactly what to ask. A pipeline that always exits 0 is a pipeline
that guesses.

**The agent cannot push to main.** It opens a pull request with auto-merge and
the required checks land it. This is the one guardrail that does not depend on
an agent reading its instructions: the branch protection rule holds whatever
the agent decides, and the agent's GitHub token has no admin scope with which
to lift it.

**The gate is verified independently.** `code.sh` re-runs
`typecheck && test && build` itself after the agent claims `STATUS: done`,
because "the tests pass" is the single most common thing an agent is wrong
about.

## The contract between the layers

Every script prints a machine-readable block on its last lines, and that block
— not free-form prose — is what the next layer parses.

| Script | Exit 0 | Exit 2 | Exit 1 |
|---|---|---|---|
| `spec.sh` | spec ready for code | spec written, needs a human | failure |
| `code.sh` | implemented, gate green | blocked or partial | failure |
| `open-pr.sh` | PR open (auto-merge on or reported off) | — | could not open it |
| `pipeline.sh` | PR open | needs a human, nothing pushed | PR step failed |
| `deploy.sh` | deployed and healthy | — | not deployed, or unhealthy |
| `app-exec.sh` | the allowed verb ran | — | refused or unreachable |

Because the contract is shell commands and report blocks, the agent runtime is
replaceable:

```bash
AGENT_RUNTIME=opencode scripts/agent/pipeline.sh "..."   # default
AGENT_RUNTIME=claude   scripts/agent/pipeline.sh "..."   # Claude Code headless
```

Role definitions live once, in `.opencode/agent/*.md`. The Claude Code
subagents in `.claude/agents/*.md` are deliberately thin pointers to those
files so the two runtimes cannot drift apart.

## Running it by hand

The pipeline has no dependency on Hermes, which is how you debug it:

```bash
scripts/agent/status.sh                    # git, PRs, specs, production
scripts/agent/spec.sh "<request>"          # spec only
scripts/agent/code.sh 0004                 # implement a spec
scripts/agent/review.sh 0004               # review the last commit
scripts/agent/open-pr.sh specs/0004-….md   # branch, commit, PR, auto-merge
scripts/agent/pipeline.sh --no-pr "..."    # everything up to the PR
scripts/agent/pr-status.sh                 # where the PRs stand

# the application lives on another VM — six allowlisted verbs get you there
scripts/agent/app-exec.sh status
scripts/agent/app-exec.sh logs caddy
scripts/agent/app-exec.sh rollback
```

Full transcripts land in `.agent-logs/` (git-ignored). When something behaves
strangely, read the transcript before re-running — a second run costs tokens
and usually reproduces the same misunderstanding.

## Guardrails

| Risk | Guardrail |
|---|---|
| An agent deploys a broken build | `code.sh` re-verifies the gate; `deploy.sh` refuses a dirty tree or a non-`main` branch |
| A migration destroys data | `deploy.sh` backs up SQLite before migrating, keeps 20 backups |
| An agent widens its scope | Each role manual forbids it; the reviewer checks the diff against the spec's *Out of scope* |
| Scores get wiped | No tool exists for it. It would need a spec, a code change and a review to become possible |
| A stranger drives the pipeline | Only `DISCORD_ALLOWED_USERS` / `TELEGRAM_ALLOWED_USERS` may call mutating tools |
| An agent ships something unreviewed | It cannot merge its own PR: the required checks do, and they are the gate it already ran |
| An agent gets a shell on the app VM | It does not have one. `app-exec.sh` is six allowlisted verbs over Tailscale SSH |
| A rollback loses results entered since the deploy | `deploy.sh --rollback` reverts code only, never the database, and says so |

## The failure mode to watch for

The pipeline's weak point is a **plausible but wrong spec**. The gate catches
code that does not compile; nothing automated catches a spec that faithfully
describes the wrong feature. That is what the human in the loop is for: read
the spec diff when Hermes reports a change, not just the deploy status.
