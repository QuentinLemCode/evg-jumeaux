---
name: review-changes
description: Review the current diff against its specification and the AGENTS.md conventions before it is deployed. Use after implement-spec and before deploy-production, or when asked to review a change.
---

# Review a change against its spec

Read-only. You report; you do not fix.

## 1. Get the diff and the spec

```bash
git diff main...HEAD    # or: git diff HEAD
```
Find the spec from the commit's `Spec:` trailer. If the diff has no spec,
that is the first finding — spec-driven development was bypassed.

## 2. Check, most important first

**Correctness against the spec.** Walk every acceptance criterion and mark it
true or false *from the code*, not from the commit message. Criteria ticked in
the spec but not actually implemented are the highest-severity finding there is.

**Authorisation.** Every Server Action starts with a Zod parse and then
`requireUser()` or `requireAdmin()`. A hidden button is not authorisation.
Check specifically that a non-admin cannot reach admin actions by calling them
directly, and that a player cannot report or validate a match they are not in.

**Domain invariants.**
- Only `src/lib/domain/match-state.ts` writes `matches.status`.
- Only `src/lib/domain/scoring.ts` writes points, as `point_events` rows.
- Scoring rules are read from the match snapshot, never live from `games`.
- The leaderboard is a `SUM` over the ledger, not a stored counter.

**Layering** (`AGENTS.md` §5): `src/components` must not touch `src/db`.

**End-to-end coverage** (`AGENTS.md` §9). A spec touched by this diff must
have a test tagged `@spec-NNNN`. Then check the test actually drives the
interface: one that seeds a completed match to assert the leaderboard passes
while the real flow is broken, which is the whole failure this rule prevents.

**Design system** (spec 0010), for any UI diff: colours from tokens only, no
blurred shadows, 11px text floor, drawn SVG icons rather than emoji, one
motion utility per element, 44px tap targets. Every `design-lint-allow`
annotation is scoped to a rule and carries a reason.

**Concurrency.** Two players acting at once: both accept the last invitation,
both report a result, one cancels while the other validates. Does the code
have a guard, or does it race?

**Scope creep.** Anything in the diff the spec did not ask for.

**Type honesty.** `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`,
weakened types, deleted or skipped tests.

## 3. Report

Findings most severe first. For each: `file:line`, what is wrong, and the
concrete input or sequence that breaks it. A finding without a failure case is
a suggestion — label it as one.

If the diff is clean, say so in one line. Do not manufacture findings to look
thorough.
