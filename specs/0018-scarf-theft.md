# 0018 — Scarf theft

| | |
|---|---|
| **Status** | ready-for-code |
| **Owner** | spec agent |
| **Depends on** | 0002, 0005, 0007, 0008, 0010, 0017 |
| **Ready for code** | yes |

## Intent

A permanent real-world mini-game running in parallel throughout the weekend:
"vol de foulard" (scarf theft). Guests can stealthily steal another player's
scarf. When a theft happens, an admin records it in the app, awarding points to
the thief (defaulting to 2 points, adjustable by the admin). Each player has a
visible "vol de fod" score showing both their theft count and theft points, and
every theft is logged in the public admin log for transparency.

## Behaviour

### Awarding a scarf theft

1. **Rule 1.** An admin can assign a scarf theft (« vol de foulard ») to any
   player from the admin console (`/admin`).
2. **Rule 2.** By default, a scarf theft awards **2 points**. The admin can
   adjust the points (integer, non-zero, between -1000 and 1000) in the
   assignment form before submitting.
3. **Rule 3.** The admin selects only the thief (the player who scored). No
   victim is recorded in the data model.
4. **Rule 4.** The admin can provide an optional comment / note describing the
   theft (e.g. location, anecdote). If omitted, the detail defaults to
   « Vol de foulard (+X pts) » (or « -X pts » if negative). If provided, it is
   formatted as « Vol de foulard (+X pts) — <note> ».
5. **Rule 5.** Points awarded for a scarf theft are added to the recipient
   player's tournament score and counted in the individual leaderboard
   (`/leaderboard`) and profile (`/players/[id]`).
6. **Rule 6.** Every scarf theft is recorded as an immutable point event in the
   ledger (`point_events` with `type = 'scarf_theft'`), attributed to the admin
   who assigned it, with a timestamp and the detail string.

### "Vol de fod" score

7. **Rule 7.** Each player possesses a visible "vol de fod" score, displaying
   both the number of thefts and the cumulative points earned from thefts:
   e.g. « 3 vols · 6 pts » (or « 0 vol · 0 pt » when none).
8. **Rule 8.** The "vol de fod" score is displayed:
   - On the player's profile (`/players/[id]`) as a dedicated stat card in the
     stats grid.
   - On the leaderboard (`/leaderboard`) in the row description alongside the
     match record (e.g. « 3 V · 1 D · 2 vols (4 pts) »).

### Transparency and admin log

9. **Rule 9.** Scarf thefts are public interventions and appear in the public
   admin log (`/admin-log`). Every authenticated player can see who was awarded
   the theft, how many points were given, the optional admin note, which admin
   recorded it, and when.
10. **Rule 10.** Scarf theft events appear in the recipient's public ledger in
    their profile (`/players/[id]`).

### Team points and tournament reset

11. **Rule 11.** Team points (spec 0017): baseline behavior follows manual
    adjustments (spec 0017, rule 23), meaning scarf theft points affect the
    individual player's total. When team standings aggregate individual
    players' points, scarf theft points are naturally included in that sum.
12. **Rule 12.** A tournament reset (spec 0008, rules 22-25) clears all scarf
    thefts and resets every player's "vol de fod" score to zero.

## Data model

Purely additive schema change (AGENTS.md §8):

- `point_events.type` includes `'scarf_theft'` alongside `'match_win'`,
  `'margin_bonus'`, `'admin_adjustment'`, `'match_reversal'`.
- A scarf theft row has `matchId = null`, `userId` pointing to the thief,
  `type = 'scarf_theft'`, `points` set to the awarded amount, `detail`
  describing the theft with the optional admin note, and `createdBy` pointing
  to the admin.
- A player's "vol de fod" count is `COUNT(*)` where `type = 'scarf_theft'` and
  points sum is `COALESCE(SUM(points), 0)` where `type = 'scarf_theft'`.

## Authorisation

| Operation | Who |
|---|---|
| Assign a scarf theft | admin |
| View any player's "vol de fod" score | any authenticated player |
| View scarf thefts in the admin log | any authenticated player |
| View scarf thefts in player profile ledger | any authenticated player |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Non-admin attempts to assign a scarf theft | 403 / redirect to `/leaderboard` | « Réservé aux admins » |
| Unknown player id | Reject | « Joueur inconnu » |
| Point value is 0 | Reject | « Indique un nombre de points non nul » |
| Point value is empty | Reject | « Indique le nombre de points » |
| Point value out of bounds | Reject | « Maximum 1000 points » |

## Acceptance criteria

- [ ] An admin can assign a scarf theft to any player from `/admin`.
- [ ] The scarf theft assignment form defaults to 2 points.
- [ ] The admin can modify the point value before submitting.
- [ ] The admin can optionally specify an explanatory note.
- [ ] Submitting awards the points to the target player and records a `scarf_theft` row in `point_events`.
- [ ] The points are reflected in the player's total on `/leaderboard` and `/players/[id]`.
- [ ] Each player's "vol de fod" score (count and points) is displayed on their profile and on the leaderboard.
- [ ] Each scarf theft appears in the public admin log (`/admin-log`) showing the admin, recipient player, points awarded, and timestamp.
- [ ] Each scarf theft appears in the recipient player's public ledger on `/players/[id]`.
- [ ] Non-admins cannot invoke the scarf theft action (rejected with 403).
- [ ] Setting 0 points is rejected with an error message.
- [ ] Tournament reset (spec 0008) deletes all scarf thefts and resets every player's "vol de fod" score to 0.

## End-to-end coverage

`e2e/admin.spec.ts` `{ tag: '@spec-0018' }`
- An admin assigns a scarf theft of 2 points to a player: the player's total points and "vol de fod" score increase on `/leaderboard`, and the entry appears in `/admin-log` and in `/players/[id]`.

## Out of scope

- Player self-reporting of scarf thefts without admin intervention.
- Victim penalty or recording.
- Automated verification (QR code, NFC, or photo proof).
- Complex stealing rules (e.g. cooldown periods, immunities).

## Open questions

None. All questions answered by product human on 2026-09-25:
- Score "vol de fod" displays both theft count and cumulative theft points.
- Victim is not tracked; only the thief is selected.
- Optional admin note is supported.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-25 | Created (draft) | Initial specification from human request |
| 2026-09-25 | Promoted to ready-for-code | Resolved all open questions with product human |
