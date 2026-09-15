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
   `src/db/seed/users.ts`.
2. Each player has: a stable id (kebab-case slug), a display name, a role, a
   PIN hash, and an emoji used as their avatar.
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
6. PIN hashes are generated with `npm run hash-pin <pin>` and pasted into the
   seed. The plain PIN is never committed.
7. At least one player must have the `admin` role. Seeding fails loudly if none
   does.

## Data model

```
users
  id          text primary key      -- 'quentin', 'paul-b'
  name        text not null         -- 'Quentin'
  role        text not null         -- 'admin' | 'user'
  pin_hash    text not null
  avatar      text not null         -- single emoji
  created_at  integer not null      -- unix ms
```

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
