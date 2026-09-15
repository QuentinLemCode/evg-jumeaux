# Architecture

## The shape of it

```
                    ┌───────────────────────────────────────────┐
  phone / laptop    │  GCP VM (europe-west1, e2-medium)         │
  ──────────────▶   │                                           │
        :443        │   Caddy ──── reverse proxy ────▶ app      │
                    │   (auto TLS)                     │        │
                    │                                  ▼        │
                    │                        Next.js 15 (node)  │
                    │                                  │        │
                    │                                  ▼        │
                    │                        SQLite (WAL) ◀── sweeper
                    │                        ./data/evg.db      │
                    │                                           │
                    │   Hermes gateway ──▶ spec / code agents   │
                    │   (systemd)          (OpenCode)           │
                    └───────────────────────────────────────────┘
                              ▲ Tailscale SSH only (no port 22)
```

One VM, one Docker network, three containers (`app`, `caddy`, `sweeper`), one
file of data. The agent pipeline lives on the same machine so that a change
requested on Discord can be built and deployed without any external CI in the
loop — see `docs/agent-pipeline.md`.

## Layers

```
src/app        pages and route handlers   (may import lib, components)
src/components React components           (presentational; never touch src/db)
src/lib        domain logic + queries     (may import src/db)
src/db         schema, migrations, seed   (imports nothing above)
```

The rule that matters is the last one: a component that queries the database
directly is a bug even when it works, because it puts a decision somewhere
nobody looks for it.

Inside `src/lib`, one more split carries most of the design:

| Directory | Contains | Pure? |
|---|---|---|
| `lib/domain` | the state machine, scoring, game rules, types | yes — no I/O, fully unit tested |
| `lib/matches` | the bridge that persists a transition | no |
| `lib/queries` | reads | no |
| `lib/actions` | Server Actions: parse → authorise → delegate | no |
| `lib/notifications` | content (pure) and delivery (not) | mixed |

## The three invariants

Everything else in the codebase is negotiable. These are not.

### 1. One state machine

`src/lib/domain/match-state.ts` is the only module that decides a match's next
status, and `matches.status` is written in exactly one place
(`src/lib/matches/apply.ts`, applying what the machine returned).

A match has seven states and a dozen transitions, several of which two people
can attempt at the same second — both accepting the last invitation, one
cancelling while the other validates. Spreading that logic across route
handlers guarantees an eighth state nobody designed. Keeping it in one pure
function means the whole lifecycle is testable without a database, which is why
there are 52 unit tests for it.

### 2. Points are a ledger, never a counter

There is no `users.points` column. Every point is a row in `point_events`, and
every total displayed anywhere is a `SUM` over that table.

This costs a join on every read and buys three things the product actually
needs: the base win and the margin bonus show up as separate itemised lines,
an admin's manual adjustment is visible in the same list as everything else,
and cancelling a completed match is a compensating row rather than an
arithmetic correction nobody can audit. A leaderboard people argue about has to
be able to answer "why do I have 23?" — a counter cannot.

The uniqueness constraint on `(match_id, user_id, type)` makes awarding
idempotent in the database rather than in the caller's good intentions.

### 3. Scoring rules are snapshotted onto the match

A match copies the game's `pointsPerWin`, margin bonus and score requirement at
creation time, and awarding reads the copy. An admin re-tuning *Palet* from 10
to 15 points mid-weekend changes nothing about matches already created.

A leaderboard that silently rewrites itself is a leaderboard nobody trusts, and
this is the cheapest possible way to make that impossible.

## Notable decisions

**SQLite, not Postgres.** A few dozen players and a few hundred matches over
one weekend. WAL mode lets the sweeper write while requests read. A backup is
`sqlite3 .backup`, which the deploy script runs before every migration.
See `docs/decisions/0001-sqlite-over-postgres.md`.

**Server Actions, not a REST API.** There is exactly one client, and it is
rendered by the same process. An HTTP layer in between would be two
serialisation boundaries and a second place to forget an authorisation check.
Every action starts with a Zod parse and a `requireUser()` / `requireAdmin()`.

**Polling, not websockets.** Screens showing other people's actions refresh
every 5–10 seconds and immediately on focus; the invitation countdown ticks
client-side. A websocket for a dozen phones on patchy 4G is more failure modes
than it is worth, and `router.refresh()` preserves scroll position and typed
input, which a reconnect storm would not.

**No data caching in the service worker.** It caches the app shell and serves
an offline page; it never caches an API or page response. Invitations expire in
five minutes, so a stale leaderboard looks current and is worse than an error.

**Static roster.** No sign-up, no email, no password recovery: the guest list
is a committed file (`src/db/seed/users.ts`) and login is a first name plus a
6-digit PIN. It removes account moderation, impostors on the leaderboard, and a
whole class of authentication bugs, at the cost of one commit when someone is
added. Seeding is additive and never deletes a player — deleting one would
orphan their matches and their points.

## Where the risk actually is

| Risk | Mitigation | Residual |
|---|---|---|
| The VM dies | SQLite backed up before each migration, 20 kept | Data since the last deploy is lost — for a weekend, acceptable |
| Two players act at once | The snapshot is read inside the transaction; the second caller gets a no-op error | — |
| Push never arrives | The inbox is the source of truth and is written first | iOS requires the PWA to be installed; the app says so instead of pretending |
| An admin cancels the wrong match | Typed confirmation, compensating ledger rows, participants notified | Nothing is destroyed, so it is recoverable |
| A migration corrupts data | Backup taken before migrating; deploy aborts before restarting if the migration fails | A data repair is a human decision, deliberately not automated |
| An agent ships a bad spec | The human reads the spec diff | This is the real weak point of the pipeline; no automation covers it |
