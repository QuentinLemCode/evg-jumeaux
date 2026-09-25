# 0002 — Users and roles

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | — |
| **Ready for code** | yes |

## Intent

The guest list is known before the weekend starts and does not change during
it. Fixing the roster at development time removes a whole class of problems —
no invitations to send, no accounts to moderate, no impostors on the
leaderboard — at the cost of one commit whenever someone is added.

## Behaviour

1. The roster is declared in a seed file that is committed to the repository:
   `src/db/seed/users.ts`. It holds no secret: id, display name, role, avatar.
2. Each player has: a stable id (kebab-case slug), a display name, a role, an
   emoji used as their avatar, and a PIN hash that comes from **outside** the
   repository.
3. There are exactly two roles: `admin` and `user`. There is no role hierarchy
   beyond "an admin can do everything a user can, plus the operations listed in
   0008".
4. Seeding is **idempotent and additive**: running it again inserts players who
   are missing and updates the display name, role, avatar and PIN hash of
   players who already exist. It never deletes a player.
5. A player can never be deleted through the app, because deleting one would
   orphan the matches and points they are part of. Removing someone from the
   weekend means removing them from the seed file; their history stays in the
   database and remains visible.
6. **No PIN and no PIN hash is ever committed.** A 6-digit PIN is a million
   possibilities and bcrypt at cost 12 runs at thousands of guesses a second
   on one GPU, so a published hash is a PIN recoverable in minutes. The
   escalating lockout of 0001 defends the login form and does nothing here:
   the attack never touches it.
7. PIN hashes are supplied at seed time in `SEED_PIN_HASHES`, a JSON object of
   id -> bcrypt hash, **base64-encoded**. Seeding fails, naming the ids, if a
   player has no hash or if a hash is not a complete 60-character bcrypt
   string.
8. Base64 is not decoration: Docker Compose interpolates `$` in the project
   `.env` it also passes to the container as an env_file, so raw JSON arrives
   truncated at the first `$` of `$2b$12$` — and a truncated hash still looks
   like a hash.
9. `npm run generate-users -- <roster-file>` produces both halves from one
   private input: the committed roster, and the base64 secret in
   `.secrets/`, which is gitignored and written mode 0600.
10. The end-to-end suite never uses this roster or these hashes. It seeds its
    own players from `src/db/seed/users.e2e.ts`, selected with
    `SEED_ROSTER=e2e`, which is refused unless the target database is the
    throwaway one under `.e2e/`.
11. At least one player must have the `admin` role. Seeding fails loudly if
    none does.

## Data model

```
users
  id          text primary key      -- 'quentin', 'paul-b'
  name        text not null         -- 'Quentin'
  role        text not null         -- 'admin' | 'user'
  pin_hash    text not null
  avatar      text not null         -- single emoji
  team_id     text                  -- null until chosen (spec 0017)
  created_at  integer not null      -- unix ms
```

A player's team is written once and never changes — not by them, not by an
admin (spec 0017). There is no history to keep, which is why `users.team_id`
is the whole of it.

Existing rows: seeding updates them in place by id. An id is therefore a
permanent identifier and must never be reused for a different person.

## Authorisation

| Operation | Who |
|---|---|
| Read the roster (names + avatars) | any authenticated player |
| Read a player's role | any authenticated player |
| Create, update or delete a player | nobody at runtime — seed only |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Seed contains a duplicate id | Seeding aborts before writing anything | (server log only) |
| Seed contains no admin | Seeding aborts | (server log only) |
| Seed contains a non-hashed PIN | Seeding aborts | (server log only) |
| `SEED_PIN_HASHES` missing, malformed, or short a player | Seeding aborts naming the ids | (server log only) |
| A match references a player no longer in the seed | The player stays in the database and renders normally | — |

## Acceptance criteria

- [x] `npm run db:seed` inserts every player from the seed file.
- [x] Running `npm run db:seed` twice produces the same roster and no duplicates.
- [x] Changing a name or avatar in the seed and re-running updates the existing row.
- [x] Removing a player from the seed file does **not** delete their row.
- [x] Seeding a roster with no admin exits non-zero with an explicit error.
- [x] Seeding a roster with a duplicate id exits non-zero before any write.
- [x] `npm run hash-pin 123456` prints a hash that verifies against `123456`
      and differs between two runs (salted).
- [x] No plain-text PIN appears anywhere in the repository.
- [x] No PIN **hash** appears anywhere in the repository either — the roster
      file carries none, and seeding without `SEED_PIN_HASHES` fails.
- [x] A hash truncated by Compose interpolation is refused rather than seeded.
- [x] The end-to-end suite passes without any real guest's PIN.

## End-to-end coverage

`e2e/auth.spec.ts` `@spec-0002`
- Only seeded names are offered, and an unknown name matches nothing.
- An admin sees the Admin destination; a player does not, and is redirected away from `/admin`.

## Out of scope

- Self-service profile editing (name, avatar). Deliberate: it invites abuse on
  a shared leaderboard, and the roster is small enough to edit in a commit.
- Guest or spectator accounts.
- Teams as persistent entities — teams are formed per match (0004).

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
| 2026-09-18 | PIN hashes move out of the repository into `SEED_PIN_HASHES` | The repository is public, and a 6-digit PIN behind bcrypt cost 12 falls to a GPU in minutes — the committed hashes were the PINs |
| 2026-09-18 | The end-to-end suite gets its own roster | Sharing one list meant the tests needed real guests' PINs, and every change to the guest list broke them |
| 2026-09-23 | Julien and Pierre appended to the roster; `users.team_id` added (spec 0017) | The two twins the weekend is for now head a team each; appended last because `generate-users` assigns avatars positionally |
| 2026-09-24 | A player's team is set once and never changes, by anybody (spec 0017) | The choice is final, so there is no history to keep and no `team_moves` |
| 2026-09-25 | Ravno and Gabriel removed via migration 0005, teamSlug supported in seed | Roster reduced to 13 guests; guests can be assigned teams directly in the seed |
