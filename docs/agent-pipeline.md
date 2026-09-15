# The agent pipeline

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
          │  scripts/agent/deploy.sh
          ▼
  ┌───────────────┐
  │  PRODUCTION   │   git pull → backup db → build → migrate → up -d → /api/health
  └───────────────┘
```

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
| `deploy.sh` | deployed and healthy | — | not deployed, or unhealthy |
| `pipeline.sh` | deployed | needs a human, nothing deployed | deploy failed |

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
scripts/agent/status.sh                      # read-only snapshot
scripts/agent/spec.sh "<request>"            # spec only
scripts/agent/code.sh 0004                   # implement a spec
scripts/agent/review.sh 0004                 # review the last commit
scripts/agent/pipeline.sh --no-deploy "..."  # everything except production
scripts/agent/deploy.sh                      # deploy main
scripts/agent/deploy.sh --rollback           # previous commit
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
| A rollback loses results entered since the deploy | `deploy.sh --rollback` reverts code only, never the database, and says so |

## The failure mode to watch for

The pipeline's weak point is a **plausible but wrong spec**. The gate catches
code that does not compile; nothing automated catches a spec that faithfully
describes the wrong feature. That is what the human in the loop is for: read
the spec diff when Hermes reports a change, not just the deploy status.
