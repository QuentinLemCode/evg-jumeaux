---
name: implement-spec
description: Implement an existing specification from specs/ in src/, with tests, then run the typecheck + test + build gate. Use when a spec is ready for code. Takes a spec id or path.
---

# Implement a spec

## 1. Establish the contract

Read the spec end to end — including **Out of scope**, **Open questions** and
the **Changelog**. Then read `AGENTS.md` §5 (conventions) and §8 (definition of
done).

**Stop immediately and report `BLOCKED` if:**
- the spec is not marked ready for code, or
- an open question would change what you write, or
- the spec contradicts code that already exists.

Reporting a contradiction is the job. Guessing between two readings is not.

## 2. Read before you write

Read every file you intend to change. Match the surrounding style, naming and
comment density — the diff should be unremarkable to someone reading the file.

## 3. Implement bottom-up (fails fastest)

1. `src/db/schema.ts` → then `npm run db:generate` for the migration.
   **Additive only** — new tables, new nullable columns, new columns with a
   default, new indexes. No drop, no rename, no `NOT NULL` without a default.
   This is not tidiness: the deploy is blue/green, so the previous release
   runs against your schema for a few seconds (`AGENTS.md` §8), and CI fails
   the build on a destructive statement. Renaming takes three releases —
   expand, backfill, contract.
2. `src/lib/domain/**` — pure functions, no I/O. Write the Vitest file next to
   it as you go, covering each acceptance criterion that is a rule.
3. `src/lib/**` — queries, Server Actions. Every action: Zod-parse the input,
   then `requireUser()` / `requireAdmin()`, then act.
4. `src/app/**`, `src/components/**` — UI last. **Load the `confetti-ui`
   skill before writing any of it**: the design system is binding and
   `lint:design` enforces it. Mobile-first at 390px, 44px tap targets, a
   designed empty state for every list.
5. `e2e/**` — at least one end-to-end test for the journey the spec describes,
   tagged `{ tag: '@spec-NNNN' }` on the describe block. A spec with unit tests
   only is **not done** (`AGENTS.md` §9): the unit tests would all still pass
   if the button were wired to nothing. Drive the real interface — the only
   fixtures allowed are a state reset and what the UI genuinely cannot
   produce.

Binding invariants from `AGENTS.md`:
- `matches.status` is written only by `src/lib/domain/match-state.ts`.
- points are written only by `src/lib/domain/scoring.ts`, as `point_events`
  rows. The leaderboard is a `SUM` over that ledger.
- scoring rules are snapshotted on the match at creation; editing a game never
  rewrites past results.

## 4. Run the gate

```bash
npm run typecheck && npm run lint:design && npm run lint:migrations \
  && npm run lint:e2e-coverage && npm test && npm run build
```

The end-to-end suite itself needs a browser and runs in CI. Where one is
available, run the slice you just wrote: `npx playwright test --grep @spec-NNNN`.

All three, every time, and read the real output. If it is red you are not
done. Do not reach for `any`, `as unknown as`, `@ts-ignore`,
`eslint-disable`, or a deleted test to turn it green — those are the failure,
not the fix.

## 5. Close the loop

- Tick the acceptance-criteria checkboxes you now satisfy. Leave the rest
  unticked and explain why in `NOTES`.
- Commit: `feat(matches): expire pending invitations after 5 minutes`, with a
  `Spec: specs/0004-match-lifecycle.md` trailer.

## 6. Report

```
STATUS: done
SPEC_FILE: specs/0004-match-lifecycle.md
COMMIT: <sha>
FILES_CHANGED: 7
TYPECHECK: pass
TESTS: pass (34 passed)
BUILD: pass
CRITERIA_MET: 12/12
NOTES: <deferred items, decisions the human must make>
```

## Never

- Edit `specs/` — that is `write-spec`'s job.
- Widen scope. Good ideas the spec did not ask for go in `NOTES`.
- Push a red `main`.
