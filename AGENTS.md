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
hermes/                Hermes gateway configuration + system prompt
.opencode/agent/       OpenCode agent definitions (spec, code, review)
.claude/agents/        Claude Code subagent definitions (same roles)
.claude/skills/        Claude Code skills (write-spec, implement-spec, deploy…)
src/app/               Next.js App Router pages + route handlers
src/lib/               domain logic — the part that must be tested
src/components/        React components (presentational; no domain logic)
src/db/                Drizzle schema, migrations, seed
terraform/             GCP VM, static IP, firewall, startup script
.github/workflows/     CI (typecheck + tests) and infra deploy/destroy
```

## 3. Stack

| Concern | Choice | Notes |
|---|---|---|
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
npm install            # install dependencies
npm run dev            # dev server on http://localhost:3000
npm run typecheck      # tsc --noEmit — MUST pass before you claim done
npm run lint           # eslint
npm run lint:design    # the Confetti design system (spec 0010) — also MUST pass
npm run lint:migrations # migrations survive a blue/green deploy (§8) — also MUST pass
npm test               # vitest run (unit tests only, fast)
npm run db:generate    # generate a migration after editing src/db/schema.ts
npm run db:migrate     # apply migrations
npm run db:seed        # seed the static user list and default games
npm run hash-pin 123456  # print an argon2/bcrypt hash for a PIN
npm run build          # production build — the deploy gate
```

```bash
npm run typecheck && npm run lint:design && npm run lint:migrations \
  && npm test && npm run build
```

That is the definition of "it works". Run all five before reporting success.

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
`confetti-ui` skill** (`.claude/skills/confetti-ui/SKILL.md`). On a runtime
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
- French is the user-facing language. English is the language of code,
  comments, commits, and all markdown files. Do not mix them up.

A deliberate exception is annotated in place and scoped to the rule
(`// design-lint-allow:raw-hex — reason`). Never use
`design-lint-allow-file`.

## 6. Spec-driven workflow

The pipeline is: **request → spec → code → deploy**. Each step has one owner.

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
code agent        owns src/. Implements exactly the spec. Runs the gate.
   │  scripts/agent/deploy.sh
   ▼
production        docker compose build + up on the VM
```

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

## 7. What to do when you are stuck

| Situation | Action |
|---|---|
| Spec is ambiguous | Stop. Report the ambiguity. Do not guess. |
| Spec contradicts code | Stop. Report both readings. The human decides. |
| Change needs a new dependency | Allowed if small and popular; note it in the spec. Anything with native bindings or a paid service needs human approval. |
| Change would break existing data | Write a migration. Never drop a column that holds history, and never in the same release as the code that stops using it (§8). |
| Build fails after your change | Fix it or revert it. Never push a red `main`. |
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

`scripts/agent/deploy.sh` does exactly this, and aborts at the first failure
without touching what is serving:

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

## 9. Definition of done

A change is done when all of these are true:

- [ ] The spec exists, is current, and its acceptance criteria are ticked.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint:design` passes (or a scoped exception is annotated with a reason).
- [ ] `npm run lint:migrations` passes.
- [ ] `npm test` passes, and new domain logic has tests.
- [ ] `npm run build` passes.
- [ ] `specs/README.md` reflects the new state.
- [ ] The commit message references the spec.
- [ ] Any migration is additive and survives the blue/green overlap (§8).
- [ ] Production has been deployed and `/api/health` reports the new commit —
      not the previous one, which means the container never restarted.
