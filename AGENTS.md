# AGENTS.md — evg-jumeaux

Single source of truth for every agent working on this repository (OpenCode
reads this file natively; `CLAUDE.md` is a symlink to it).

**Read this file completely before touching anything.**

---

## 1. What this project is

A mobile-first web app for a bachelor party ("EVG") weekend. Guests log in,
challenge each other at games (some played in the app, most played in real
life — pétanque, palet, beer pong…), report results, and climb a leaderboard.

It is operated by an autonomous agent pipeline running on a GCP VM: a human
talks to **Hermes** over Discord/Telegram, Hermes delegates to a **spec agent**
then a **code agent**, and the result is deployed to production automatically.

Two hard rules that shape everything:

1. **Spec-driven development.** No code change without a spec change first.
   `specs/` is the contract; `src/` is an implementation detail.
2. **Production is always current.** `main` is deployed. A merge to `main` that
   does not build is an incident, not a inconvenience.

## 2. Repository map

```
AGENTS.md              this file — source of truth for all agents
CLAUDE.md              symlink → AGENTS.md
specs/                 the product contract (numbered, versioned specs)
  README.md            spec index + status board — ALWAYS update it
  TEMPLATE.md          copy this to start a new spec
docs/
  architecture.md      how the app is built and why
  agent-pipeline.md    how Hermes / spec agent / code agent interact
  deployment.md        how production is updated and rolled back
  decisions/           ADRs — one file per irreversible decision
scripts/agent/         the stable CLI contract Hermes calls (spec.sh, code.sh, …)
hermes/                gateway prompt + tool manifest (for the future LLM layer)
src/hermes/            the Telegram gateway itself (spec 0012)
.opencode/agent/       OpenCode agent definitions (spec, code, review)
.claude/agents/        Claude Code subagent definitions (same roles)
skills/                the operating manuals, shared by BOTH runtimes
.claude/skills         symlink → skills/ (Claude Code only looks there)
src/app/               Next.js App Router pages + route handlers
src/lib/               domain logic — the part that must be tested
src/components/        React components (presentational; no domain logic)
e2e/                   end-to-end tests, one tag per spec (§9)
src/db/                Drizzle schema, migrations, seed
terraform/             two GCP VMs (app, agents), Cloudflare DNS + tunnel
.github/workflows/     CI (typecheck + tests) and infra deploy/destroy
```

## 3. Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node **26** (`.nvmrc`, pinned to the patch) | One source of truth: CI, the Docker image and the VM all read it. `nvm use` before anything else. |
| Language | TypeScript, `strict: true` | No `any`, no `@ts-ignore`. Ever. |
| Framework | Next.js 15 (App Router) | Server Components for reads, Server Actions for writes |
| Styling | Tailwind CSS v4 + the "Confetti" design system | Tokens in `src/app/globals.css`; enforced by `npm run lint:design` (spec 0010) |
| Database | SQLite + Drizzle ORM | Single file at `DATABASE_PATH`, volume-mounted on the VM |
| Auth | first name + 6-digit PIN → JWT cookie | `jose`, httpOnly, 4-day expiry |
| Push | Web Push (VAPID) via `web-push` | Requires HTTPS + installed PWA on iOS |
| Validation | Zod | Every Server Action input is parsed, never trusted |
| Tests | Vitest | Domain logic in `src/lib/**` must be covered |

## 4. Commands

```bash
nvm use                # Node 26, from .nvmrc — do this first
npm install            # install dependencies
npm run dev            # dev server on http://localhost:3000
npm run typecheck      # tsc --noEmit — MUST pass before you claim done
npm run lint           # eslint
npm run lint:design    # the Confetti design system (spec 0010) — also MUST pass
npm run lint:migrations # migrations survive a blue/green deploy (§8) — also MUST pass
npm run lint:e2e-coverage # every spec has an end-to-end test (§9) — also MUST pass
npm run e2e            # the end-to-end suite (needs a browser; CI runs it)
npm test               # vitest run (unit tests only, fast)
npm run db:generate    # generate a migration after editing src/db/schema.ts
npm run db:migrate     # apply migrations
npm run db:seed        # seed the static user list and default games
npm run hash-pin 123456  # print an argon2/bcrypt hash for a PIN
npm run build          # production build — the deploy gate
```

```bash
npm run typecheck && npm run lint:design && npm run lint:migrations \
  && npm run lint:e2e-coverage && npm test && npm run build
```

That is the definition of "it works". Run all six before reporting success.
The end-to-end suite itself runs in CI (§9).

## 5. Non-negotiable conventions

### TypeScript
- `strict` is on. Model impossible states out of existence with discriminated
  unions instead of optional fields that "shouldn't" be set together.
- Domain types live in `src/lib/domain/types.ts`. Do not redeclare them.
- Dates are stored as integer Unix milliseconds. Never as strings.
- All money-free integers: points are integers, never floats.

### Layering (enforced by review)
```
src/app        → may import src/lib, src/components
src/components → may import src/lib/domain/types, NEVER src/db
src/lib        → may import src/db
src/db         → imports nothing from the above
src/hermes     → a SEPARATE program (spec 0012): the Telegram gateway. It
                 imports nothing from the app and nothing imports it. It
                 reaches the app the way an outsider does — over HTTP, or
                 through scripts/agent/.
```
A React component that queries the database directly is a bug, even if it works.

### Domain logic
- Every state transition of a match goes through `src/lib/domain/match-state.ts`.
  No route, action, or component may set `matches.status` directly.
- Every point awarded goes through `src/lib/domain/scoring.ts` and is written as
  a row in `point_events`. The leaderboard is a `SUM` over that ledger — never a
  mutable `users.points` column. This makes every point auditable, which the
  product requires ("the bonus must be itemised in the score history").
- Scoring rules are **snapshotted onto the match** at creation time. An admin
  editing a game's points must never retroactively rewrite past results.

### Security
- Session cookie: `httpOnly`, `sameSite=lax`, `secure` in production, 4 days.
- Authorisation is checked server-side in every Server Action via
  `requireUser()` / `requireAdmin()`. Hiding a button is not authorisation.
- The user list is static and seeded. There is no sign-up endpoint. Do not add
  one without a spec change.
- Never log a PIN, a PIN hash, a JWT, or a push subscription key.

### UI — the "Confetti" design system
**Before any change under `src/app/` or `src/components/`, load the
`confetti-ui` skill** (`skills/confetti-ui/SKILL.md`). On a runtime
without skills, read that file directly — it is the operating manual for the
look, and spec 0010 is its contract.

The look is warm cream paper, white sticker cards with a 3px ink border and a
hard unblurred offset shadow, saturated accents, Gabarito for anything
numeric, and one orchestrated reveal per screen. It is not negotiable per
screen: a screen that looks like sober software is a defect.

**Every screen is assembled from the shared parts in spec 0010 §8** —
`PageHeader`, `SectionTitle`, `Card`, `Score` / `Delta`, `StatusBadge`,
`EmptyState`, `ChipRow` / `ChipLink` / `ViewSwitch`, and the `reveal` entrance
helper. A screen that needs a part the list does not have **adds it to the
shared set and to the spec** — never a local one. This is what stops each page
from reinventing its own header and its own list row.

Binding, and checked by `npm run lint:design`:
- **Colours come only from the tokens in `src/app/globals.css`.** A raw hex
  anywhere under `src/app/` or `src/components/` fails the build.
- **No blurred shadows.** Use the `sticker` / `sticker-<accent>` utilities;
  `shadow-lg` and friends fail the build. An accent card's border and shadow
  are always the same accent.
- **11px text floor**, and an explicit `line-height` on every heading.
- **Icons are drawn SVG** from `src/components/ui/Icon.tsx`, never emoji. The
  three exceptions are data or illustration, not interface: `users.avatar`,
  `games.icon`, and a large decorative `EmptyState illustration`.
- **One motion utility per element** — `rise`, `pop` and `drift` each set the
  `animation` shorthand, so two on one element cancel each other silently.
- Mobile-first: design at 390px wide, then let it breathe on desktop.
- Every tappable target is at least 44×44px, filter chips included.
- Every list that can be empty has a designed empty state.
- A journey a guest performs is covered by an end-to-end test (§9).
- French is the user-facing language. English is the language of code,
  comments, commits, and all markdown files. Do not mix them up.

A deliberate exception is annotated in place and scoped to the rule
(`// design-lint-allow:raw-hex — reason`). Never use
`design-lint-allow-file`.

## 6. Spec-driven workflow

The pipeline is: **request → spec → code → pull request → CI → deploy**. Each
step has one owner, and the last two owners are not agents.

```
human (Discord/Telegram)
   │
   ▼
Hermes            orchestrator. Talks to the human, never writes app code.
   │  scripts/agent/spec.sh "<request>"
   ▼
spec agent        owns specs/. Writes/updates the spec, updates the index.
   │  scripts/agent/code.sh <spec-id>
   ▼
code agent        owns src/ and e2e/. Implements exactly the spec, runs the gate.
   │  scripts/agent/open-pr.sh <spec>
   ▼
pull request      auto-merge on. The REQUIRED CHECKS decide whether it lands.
   │
   ▼
GitHub Actions    builds the image, pushes it to GHCR, deploys it with no
                  downtime, verifies /api/health reports the new commit.
```

### How the code agent interacts with GitHub

**It works directly in the checkout, commits, and opens a pull request. It
never pushes to `main` and never deploys.**

```bash
scripts/agent/open-pr.sh specs/0011-photo-wall.md
```

which branches (`agent/0011-photo-wall`), commits, rebases onto `origin/main`,
pushes, opens the PR with the spec's intent and criteria in the body, and arms
auto-merge (`gh pr merge --auto --squash --delete-branch`).

It then **reads the state back from GitHub** rather than trusting the exit
code, and reports one of:

| `AUTO_MERGE` | Meaning |
|---|---|
| `armed` | auto-merge is on; the required checks will merge it |
| `merged` | nothing was blocking it, so it merged on the spot |
| `off` | auto-merge is NOT on — the script names the repository setting at fault, and the PR waits for a human |

`off` is never something to work around. Both causes are repository settings
the agent's token deliberately cannot change.

Why a PR and not a push to main: an agent that can push to main can deploy a
broken build at two in the morning, and no amount of instruction in a markdown
file prevents it. **A branch protection rule does.** The required checks are
the same gate the agent ran locally, so a red check is information — read it,
do not re-run it.

Consequences you must respect:

- **Never `git push origin main`.** Not to "save time", not to fix a red check.
  If the checks are wrong, fix the checks in the PR.
- **Never disable auto-merge or merge manually.** The agent's token cannot
  administer the repository precisely so that it cannot lift the rule that
  constrains it.
- **A green pipeline is not a deployed change.** It is a merged PR; the Deploy
  workflow ships it a few minutes later. Report it that way.
- **One branch per spec.** Two specs in one PR means one red check blocks both.
- If a rebase onto `origin/main` conflicts, `open-pr.sh` stops. That is a human
  decision, not one to force.

### Two machines

The **agents VM** runs Hermes, the agents, the gate and the watcher. The
**application VM** runs only the app. An agent's `npm ci` and build occupy CPU
and memory for minutes; on a shared machine that shows up in the site's
response time, during the party, exactly when it is being used.

So: the agents VM holds no application secret (no `AUTH_SECRET`, no VAPID key,
no tunnel token), and the application VM holds no LLM key and no GitHub token.
Anything an agent needs from the running app goes through
`scripts/agent/app-exec.sh` — an allowlist of seven verbs over Tailscale SSH,
not a shell (`status`, `health`, `ps`, `logs`, `deploy`, `rollback`,
`client-errors`). Do not add an eighth without asking why the existing seven
are not enough.

### Rules for the spec agent
- One spec per coherent feature, numbered `NNNN-kebab-case-title.md`.
- Never edit `src/`. If a request cannot be specified without reading code,
  read the code, then still only write the spec.
- Every spec has explicit **Acceptance criteria** written as checkable
  statements. "Should be fast" is not a criterion; "responds in < 300 ms for
  30 users" is.
- Amending an existing feature means editing its existing spec and adding a
  line to that spec's **Changelog**, not creating spec `0042-fix-the-thing.md`.
- Always update `specs/README.md` (the status board) in the same change.

### Rules for the code agent
- Read the spec, then read the code it touches, then plan, then write.
- Implement the spec and nothing else. Out-of-scope improvements you spot go in
  the spec's **Open questions** section or a new `Ideas` entry — not in the diff.
- If the spec is ambiguous or contradicts the existing code, **stop** and report
  the contradiction back. Do not guess and do not silently pick a reading.
- Before claiming completion: `npm run typecheck && npm test && npm run build`.
- Tick the acceptance criteria checkboxes in the spec as you satisfy them.

### Commits
Conventional commits, present tense, English, one logical change per commit:
```
feat(matches): expire pending invitations after 5 minutes
fix(scoring): itemise margin bonus as its own point event
spec(0004): allow admins to resolve disputed matches
```
Reference the spec: `Spec: specs/0004-match-lifecycle.md`.

The commit lands on a branch, never on `main` — see *How the code agent
interacts with GitHub* above.

## 7. What to do when you are stuck

| Situation | Action |
|---|---|
| Spec is ambiguous | Stop. Report the ambiguity. Do not guess. |
| Spec contradicts code | Stop. Report both readings. The human decides. |
| Change needs a new dependency | Allowed if small and popular; note it in the spec. Anything with native bindings or a paid service needs human approval. |
| Change would break existing data | Write a migration. Never drop a column that holds history, and never in the same release as the code that stops using it (§8). |
| Build fails after your change | Fix it in the pull request. You cannot push a red `main` — the branch protection rule is what stops you, and that is deliberate. |
| A check is red and you disagree with it | Read it. The gate is the one you ran locally, so a difference is information. Never re-run a check hoping for a different answer. |
| A rebase onto `main` conflicts | Stop and report both sides. A human decides. |
| Task is bigger than one spec | Split it into numbered specs and say so. |

## 8. Deploying without downtime — what it costs a migration

Production is deployed **blue/green**: the new image starts on the idle colour,
is proved healthy, and Caddy is then reloaded onto it gracefully. No request is
dropped, and a failed release changes nothing.

That buys zero downtime at one price, and it is a price migrations pay:

> **For a few seconds, the OLD code and the NEW code run against the SAME
> database.** Migrations are applied BEFORE the new colour starts, while the
> previous release is still serving every request.

So a migration must work for **both** releases. This is not a style
preference; getting it wrong takes the site down during the switch, and the
rollback cannot fix it because the schema has already changed.

### Additive only, in one release

| Safe in a single release | Never in a single release |
|---|---|
| a new table | `DROP TABLE`, `DROP COLUMN` |
| a new **nullable** column | a new `NOT NULL` column with no default |
| a new column with a default | `RENAME TO`, `RENAME COLUMN` |
| a new index | narrowing a type, or `ALTER COLUMN` |
| a backfill `UPDATE` | adding `UNIQUE` to a column that has duplicates |

`npm run lint` will not catch this. The CI job **Migrations are additive**
will: it greps the generated SQL and fails the build. If a statement is
genuinely safe despite matching the pattern, annotate that line
`-- additive-ok` and say why.

### Renaming or removing takes three releases (expand / contract)

Wanting to rename `matches.cancel_reason` to `matches.closing_note`:

1. **Expand** — add `closing_note` (nullable). New code writes **both**
   columns and reads `closing_note ?? cancel_reason`. Old code keeps using
   `cancel_reason` and is unaffected. Deploy.
2. **Backfill** — a migration copies `cancel_reason` into `closing_note` where
   it is null. New code now reads only `closing_note`, still writes both.
   Deploy.
3. **Contract** — stop writing `cancel_reason`, then drop it. Deploy.

Three releases over a weekend is fine. One release that renames the column is
a two-minute outage in the middle of a party.

### The other constraint: one SQLite writer

Both colours, plus the sweeper, share one SQLite file. WAL lets readers run
while one writer holds the lock, and `busy_timeout = 5000` absorbs the
overlap — so the few seconds of two live colours are safe. What is **not**
safe is a migration that holds a long write transaction: it blocks the
serving release. Keep migrations to schema changes and small backfills; a
backfill over a large table belongs in a script run deliberately, not in a
migration that gates a deploy.

### Order of operations, for reference

`scripts/agent/deploy.sh` runs on the **application VM**, invoked by GitHub
Actions over Tailscale SSH once a pull request has merged. It does exactly this,
and aborts at the first failure without touching what is serving:

```
pull image ▸ back up SQLite ▸ MIGRATE (old code still serving)
           ▸ start idle colour ▸ wait for healthy
           ▸ rewrite caddy/upstream.conf ▸ caddy reload  ← the switch
           ▸ verify the public /api/health reports the new commit
           ▸ stop the old colour
```

If anything fails before the reload, the old colour is still serving and the
only trace is a backup file. After the reload, the script reverts the upstream
and reloads again.

### Infrastructure is documented, not specified

`specs/` is the **product** contract. Terraform, the compose stack, the CI
pipeline and the deploy scripts are not product behaviour: they change under
`docs/deployment.md`, not under a numbered spec. Do not create a spec for an
infrastructure change, and do not change infrastructure to satisfy a product
spec without saying so.

## 9. Every specified feature is covered end to end

> **Every numbered spec must have at least one end-to-end test.** A spec with
> unit tests only is not done.

This is not a coverage ritual. Unit tests prove the *pieces*: 52 of them cover
the match state machine and the scoring arithmetic, and they would all still
pass if the "Accepter le défi" button were wired to nothing. The flow that
matters — invite, accept, report, validate — needs two people, two sessions
and a server, and nothing but an end-to-end test can prove it works.

### The convention

Tag the `describe` block with the spec it covers:

```ts
test.describe('A match from invitation to points',
  { tag: ['@spec-0004', '@spec-0005'] }, () => { … });
```

That makes the link machine-checkable **and** runnable:

```bash
npm run lint:e2e-coverage          # every spec is tagged somewhere
npx playwright test --grep @spec-0004   # just this feature
npm run e2e                        # the suite (CI runs it on every push)
```

`lint:e2e-coverage` is part of the gate. `npm run e2e` is not: it needs a
browser and a production build, so **CI runs the suite** and the code agent
runs the coverage check plus, where a browser is available,
`--grep @spec-NNNN` for the spec it just touched.

### What goes where

| | End-to-end | Unit |
|---|---|---|
| a journey a guest actually performs | yes | no |
| a rule, a transition, arithmetic | no | yes |
| an authorisation boundary a user can reach | yes | also yes |
| a failure message a player sees | yes | no |
| every branch of a pure function | no | yes |

Do not re-test in a browser what a pure function already proves. End-to-end
tests are slow and their failures are harder to read, so each one must earn
its place by covering something no unit test can reach.

### Fixtures: as little as possible

Tests drive the real interface. The database helper (`e2e/helpers/db.ts`) may
only do two things: **reset** the volatile state between tests, and build the
fixtures the UI genuinely cannot build — which today is exactly one, an
invitation whose five-minute window has already closed.

Seeding a completed match to assert the leaderboard would pass while the real
flow was broken. That is the failure mode this rule exists to prevent.

### When a spec cannot be exercised from a browser

Say so **in the spec**, on its own line, with the reason:

```
E2E coverage: not applicable — <why>
```

`lint:e2e-coverage` honours it. Use it for a spec that is genuinely not
user-reachable, never to avoid writing a test.

### Writing them

`workers: 1` and no parallelism, deliberately: every test shares one server
process, one SQLite file and one in-memory login rate-limiter. A test that
fails a PIN on purpose must therefore use a player **no other test touches** —
the lockout ladder is not reset between tests, and sharing a player there
makes the suite order-dependent in a way that only surfaces weeks later.

The reference viewport is the phone (spec 0009). The desktop project re-runs
`shell.spec.ts` alone, to prove the layout adapts — not every journey again.

## 10. Definition of done

A change is done when all of these are true:

- [ ] The spec exists, is current, and its acceptance criteria are ticked.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint:design` passes (or a scoped exception is annotated with a reason).
- [ ] `npm run lint:migrations` passes.
- [ ] `npm run lint:e2e-coverage` passes — the spec has an end-to-end test
      tagged `@spec-NNNN`, or says in the spec why it cannot have one (§9).
- [ ] `npm test` passes, and new domain logic has tests.
- [ ] `npm run build` passes.
- [ ] `specs/README.md` reflects the new state.
- [ ] The commit message references the spec.
- [ ] Any migration is additive and survives the blue/green overlap (§8).
- [ ] Production has been deployed and `/api/health` reports the new commit —
      not the previous one, which means the container never restarted.
