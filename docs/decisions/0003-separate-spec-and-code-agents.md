# 0003 — Separate spec and code agents

- **Date**: 2026-09-14
- **Status**: accepted

## Context

The app is maintained by talking to Hermes on Discord. The obvious design is
one capable agent that reads the request and edits the repository. The
alternative is a pipeline of narrow agents with disjoint write permissions.

## Decision

Three roles, with permissions that do not overlap:

- **Hermes** talks to people and routes. It writes neither specs nor code.
- **The spec agent** owns `specs/` and is forbidden from touching `src/`.
- **The code agent** owns `src/` and is forbidden from touching `specs/`.

A fourth, read-only reviewer checks the diff against the spec, advisory only.

## Why

A single agent that can edit both the contract and the implementation will,
when it hits an ambiguity, resolve it by quietly editing whichever side is
easier — usually the spec, to match what it already built. At that point the
spec has stopped being a contract and become a changelog of the agent's
choices, and nobody notices for several features.

Because the roles are split, an ambiguous request has nowhere to go except
back to the human: `spec.sh` exits 2 with the open questions, and the pipeline
stops with nothing deployed. Blocking is designed to be a success state.

The split also matches the tools. A model prompted to hold a short conversation
on a phone is not the one you want inside a repository's conventions, and vice
versa.

## Consequences

- Every change costs two agent runs instead of one. For this repository that is
  a few minutes, and it buys a readable contract.
- The role definitions live once, in `.opencode/agent/*.md`; the Claude Code
  subagents in `.claude/agents/*.md` are thin pointers to them so the two
  runtimes cannot drift.
- The contract between stages is a shell command plus a machine-readable report
  block, so the agent runtime is swappable with one environment variable
  (`AGENT_RUNTIME=opencode|claude`).
- `code.sh` re-runs the typecheck/test/build gate itself after the agent claims
  success, because "the tests pass" is the thing agents are most often wrong
  about.
- The remaining weak point is a plausible but wrong spec. Nothing automated
  catches it, which is why the human is asked to read the spec diff.
