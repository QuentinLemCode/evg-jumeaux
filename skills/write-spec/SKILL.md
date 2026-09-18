---
name: write-spec
description: Write or amend a specification in specs/ from a human request. Use whenever a request would change what the product does — before any code is written. Handles numbering, the template, the status board in specs/README.md, and the changelog.
---

# Write a spec

Spec-driven development: the spec changes first, always. This skill produces
the spec only — implementing it is `implement-spec`.

## 1. Decide what kind of change this is

Read `specs/README.md`, then grep `specs/` for the feature area.

| The request… | Do this |
|---|---|
| changes an existing behaviour | edit that feature's existing spec |
| adds a behaviour to an existing feature | edit that spec, extend its criteria |
| is a whole new feature | create a new numbered spec |
| is a bug report | the spec was wrong or silent — correct it and add the case to the acceptance criteria |
| spans several features | split into several specs, and say so |

Never create a new spec to patch an old one. `0004-match-lifecycle.md` gets
amended; `0031-fix-match-bug.md` must not exist.

## 2. Pick the number (new specs only)

```bash
ls specs/ | grep -E '^[0-9]{4}-' | sort | tail -3
```
Take the next integer, zero-padded to 4 digits. Kebab-case the title:
`specs/0010-photo-wall.md`.

## 3. Write it

```bash
cp specs/TEMPLATE.md specs/0010-photo-wall.md
```

Fill every section. The sections that actually matter:

- **Acceptance criteria** — the deliverable. Each is a checkbox a reviewer can
  mark true or false with no judgement call. Cover the happy path, every
  failure case, every authorisation rule, and concurrency where two people can
  act at once.
- **Data model** — new tables/columns, and what happens to rows that already
  exist. History is never dropped.
- **Authorisation** — who may call this, checked server-side.
- **End-to-end coverage** — name the one or two journeys a guest actually
  performs that prove the feature works. The code agent turns them into tests
  tagged `@spec-NNNN`, and the build fails without one. If the feature is not
  reachable from a browser, write `E2E coverage: not applicable — <why>`.
- **Out of scope** — write this down. It is what stops the code agent
  from widening the diff.
- **Open questions** — anything you had to guess. If a guess would change the
  implementation, the spec is not ready for code.

Behaviour, not implementation: "the invitation expires 5 minutes after it is
sent", never "add a setTimeout".

## 4. Update the status board and the changelog

`specs/README.md` — one row per spec: id, title, status, one-line summary.
The spec's own **Changelog** — a dated line saying what changed and why.

## 5. Report

```
SPEC_ID: 0010
SPEC_FILE: specs/0010-photo-wall.md
ACTION: created
SUMMARY: <one sentence>
OPEN_QUESTIONS: none
READY_FOR_CODE: yes
```

`READY_FOR_CODE: no` if an open question would change the implementation.
Blocking is a correct outcome. Guessing is not.

## Never

- Edit `src/`, `public/`, or `terraform/` in this skill.
- Invent a product decision the human did not make.
- Write a spec longer than ~250 lines — that is two specs.
- Write it in French. User-facing strings are French; markdown is English.
