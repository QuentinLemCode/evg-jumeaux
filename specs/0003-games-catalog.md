# 0003 — Games catalog

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0002 |
| **Ready for code** | yes |

## Intent

Most of the games are played in the real world — palet, pétanque, beer pong,
darts — and the app only records who won. New games get invented during the
weekend, so admins must be able to add one in under a minute, from a phone,
without a developer.

## Behaviour

1. A **game** is a type of contest, not an instance of one. "Palet" is a game;
   Tuesday's palet match between Paul and Hugo is a match (0004).
2. A game declares its shape:
   - `mode`: `duel` (each side is one player) or `team` (each side is several).
   - `sidesCount`: how many sides face each other, 2 to 4.
   - `playersPerSide`: 1 for a duel; 2 to 6 for a team game.
   - Total participants is therefore `sidesCount × playersPerSide`, from 2 to 24.
3. A game declares its scoring:
   - `pointsPerWin`: leaderboard points awarded to **each player of the winning
     side**, 1 to 100.
   - `marginBonusEnabled`: whether a margin bonus applies.
   - `marginBonusPerPoint`: leaderboard points per unit of score difference,
     0 to 20. Only meaningful when the bonus is enabled.
   - `marginBonusCap`: the maximum bonus, or none.
   - `requiresScore`: whether reporting a result demands numeric scores.
     Enabling the margin bonus forces this to true — a margin cannot be
     computed without scores.
4. A game can be **archived** (`isActive: false`). An archived game cannot start
   new matches but stays visible in history, and its past matches keep their
   points.
5. Editing a game's scoring rules affects **future matches only**. Matches
   already created keep the rules they were created with (see 0005).
6. Games are listed to players ordered by: active first, then by number of
   matches played, descending. This puts the weekend's actual favourites at the
   top without anyone configuring anything.
7. A game's name is unique, case-insensitively.

## Data model

```
games
  id                     text primary key   -- uuid
  slug                   text not null unique
  name                   text not null
  description            text
  icon                   text not null      -- single emoji
  mode                   text not null      -- 'duel' | 'team'
  sides_count            integer not null   -- 2..4
  players_per_side       integer not null   -- 1..6 (1 when mode = 'duel')
  points_per_win         integer not null   -- 1..100
  margin_bonus_enabled   integer not null   -- 0 | 1
  margin_bonus_per_point integer not null   -- 0..20
  margin_bonus_cap       integer            -- null = uncapped
  requires_score         integer not null   -- 0 | 1
  is_active              integer not null   -- 0 | 1
  created_by             text not null references users(id)
  created_at             integer not null
  updated_at             integer not null
```

Default games are seeded so the app is usable on first boot: *Palet*,
*Pierre-feuille-ciseaux*, *Pétanque* (team), *Beer pong* (team).

## Authorisation

| Operation | Who |
|---|---|
| List games | any authenticated player |
| View a game | any authenticated player |
| Create a game | admin |
| Edit a game | admin |
| Archive / restore a game | admin |
| Delete a game | nobody — archiving is the only removal |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Name already taken | Reject, keep the form filled | « Un jeu porte déjà ce nom » |
| `mode = duel` with `playersPerSide > 1` | Reject | « Un duel oppose des joueurs seuls » |
| `mode = team` with `playersPerSide < 2` | Reject | « Une équipe compte au moins 2 joueurs » |
| Margin bonus enabled with `marginBonusPerPoint = 0` | Reject | « Indique combien de points rapporte chaque point d'écart » |
| Margin bonus enabled while `requiresScore` is off | `requiresScore` is forced on | (silent, explained in the form) |
| Non-admin calls a mutating action directly | 403, nothing written | « Réservé aux admins » |
| Archiving a game with matches in progress | Allowed; running matches finish normally | (informational notice) |

## Acceptance criteria

- [x] An admin can create a game from the app with all the fields above.
- [x] A non-admin sees no create/edit control, **and** a direct call to the
      create, edit or archive action returns an authorisation error.
- [x] Creating a game whose name matches an existing one, ignoring case, fails.
- [x] `mode = duel` forces `playersPerSide` to 1 and the form reflects it.
- [x] Enabling the margin bonus forces `requiresScore` on.
- [x] A game with the margin bonus enabled and `marginBonusPerPoint = 0` is rejected.
- [x] An archived game cannot be chosen when creating a match.
- [x] An archived game still appears in the history of past matches.
- [x] Editing `pointsPerWin` leaves the points of already-completed matches unchanged.
- [x] The games list is ordered active-first, then by match count descending.
- [x] The four default games exist after `npm run db:seed`.

## End-to-end coverage

`e2e/admin.spec.ts` `@spec-0003`
- An admin creates a game and a player can start it immediately, with no redeploy.
- A duplicate name, ignoring case, is refused.
- An archived game leaves the catalog and stays in the admin list.

## Out of scope

- Per-game custom rules text beyond the free-text description.
- Handicaps, brackets, tournaments, or seasons.
- Games with more than 4 sides, or asymmetric sides (2 vs 3).
- Draws. A match has exactly one winning side; a game with no winner is
  cancelled instead (0004).

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
