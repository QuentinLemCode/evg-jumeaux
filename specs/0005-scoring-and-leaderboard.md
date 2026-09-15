# 0005 — Scoring and leaderboard

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0003, 0004 |
| **Ready for code** | yes |

## Intent

The leaderboard is the social engine of the weekend, so it has to be both
trivially understandable ("I won at palet, I got 10 points") and impossible to
argue with. Every point on a player's total must be traceable to a specific
match, with the base win and any margin bonus shown separately — that itemisation
is what stops the "why do I have 23 and not 10?" conversation.

## Behaviour

### The ledger

1. Points are **never** stored as a mutable total on a player. They are stored
   as an append-only ledger of **point events**, and every total shown anywhere
   in the app is a `SUM` over that ledger.
2. A point event has a type:
   - `match_win` — the base points for winning.
   - `margin_bonus` — the bonus for the score difference.
   - `admin_adjustment` — a manual correction by an admin (0008).
   - `match_reversal` — the compensating negative event written when an admin
     cancels a completed match.
3. Point events are immutable. A correction is a new event, never an edit or a
   delete. The ledger is the audit trail.

### Awarding points

4. Points are awarded exactly once, at the moment a match becomes `completed`.
   Nothing is awarded for `pending`, `active`, `awaiting_validation`,
   `disputed`, `cancelled` or `expired` matches.
5. Every player of the winning side receives:
   - a `match_win` event worth the match's snapshotted `pointsPerWin`, and
   - if the margin bonus applies, a separate `margin_bonus` event.
6. Players of losing sides receive no event at all. Zero is the absence of a
   row, not a row worth zero.
7. Awarding is idempotent: if the award step runs twice for the same match, the
   second run writes nothing. The ledger has a uniqueness constraint on
   (match, player, type) to guarantee it rather than to trust the caller.

### The margin bonus

8. The bonus applies only when the match's snapshotted
   `marginBonusPerPoint` is greater than zero **and** scores were recorded.
9. The margin is `winningScore − max(other sides' scores)`. In a match with
   more than two sides, only the closest runner-up matters.
10. `bonus = margin × marginBonusPerPoint`, capped at the snapshotted
    `marginBonusCap` when one is set.
11. A bonus of zero writes no event — a 13–12 win with a 1-point-per-margin
    rule writes a bonus of 1; a win with margin 0 is impossible, since the
    winner's score is strictly greater (0004 rule 16).
12. The bonus is displayed everywhere as its own line, with its arithmetic
    spelled out: `10 pts (victoire) + 11 pts (écart 13–2 × 1)`.

### The snapshot rule

13. A match stores the scoring rules it was created with. Awarding reads the
    match, never the game. An admin editing *Palet* from 10 to 15 points
    mid-weekend changes nothing about matches already created — including ones
    still in progress.
14. This is the single most important invariant in the app: a leaderboard that
    silently changes retroactively is a leaderboard nobody trusts.

### The leaderboard

15. The leaderboard lists every seeded player, including those with zero points,
    ranked by: total points descending, then wins descending, then matches
    played ascending (fewer matches for the same points ranks higher), then
    name alphabetically.
16. Players tied on all criteria share the same rank number.
17. Each row shows: rank, avatar, name, total points, wins, losses, matches
    played. The top three are visually distinguished.
18. The leaderboard shows the current player's own row in a persistent
    position, so they never have to scroll to find themselves.

## Data model

```
point_events
  id           text primary key
  user_id      text not null references users(id)
  match_id     text references matches(id)        -- null for admin adjustments
  type         text not null   -- match_win | margin_bonus
                               -- | admin_adjustment | match_reversal
  points       integer not null -- signed; negative for reversals
  detail       text not null   -- human-readable arithmetic, French, e.g.
                               -- 'Écart 13–2 × 1 pt'
  created_by   text references users(id)  -- the admin, for manual events
  created_at   integer not null
  unique (match_id, user_id, type)   -- makes awarding idempotent
```

The leaderboard is a single grouped query over `point_events` left-joined onto
`users`, plus a count query over `match_participants` for the win/loss columns.
No materialised total, no cache: a few dozen players and a few hundred matches
do not justify either, and every cache is an opportunity to show a wrong score.

## Authorisation

| Operation | Who |
|---|---|
| View the leaderboard | any authenticated player |
| View any player's point breakdown | any authenticated player |
| Write a `match_win` / `margin_bonus` event | the system, on match completion |
| Write an `admin_adjustment` / `match_reversal` | admin (0008) |
| Edit or delete any point event | nobody, ever |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Award runs twice for a match | The second run writes nothing | (none) |
| Margin bonus enabled but no scores recorded | No bonus event; base points still awarded | (none) |
| Cap lower than the computed bonus | Bonus is the cap, detail states it was capped | « plafonné à X » |
| Admin edits a game's points | Past and in-flight matches keep their snapshot | (notice in the form) |
| Admin cancels a completed match | Reversal events are written, totals drop | « Partie annulée, points retirés » |
| A player has no events | They appear on the leaderboard with 0 points | « Pas encore de points » |

## Acceptance criteria

- [x] No table has a mutable points column; every total in the UI comes from a
      `SUM` over `point_events`.
- [x] Completing a duel writes exactly one `match_win` event, to the winner.
- [x] Completing a team match writes one `match_win` event per player of the
      winning side, each worth the full `pointsPerWin`.
- [x] Losing-side players get no rows.
- [x] With the margin bonus enabled, a 13–2 win at 10 pts + 1 pt/margin writes
      a `match_win` of 10 and a `margin_bonus` of 11, as two rows.
- [x] With `marginBonusCap = 5`, the same match writes a `margin_bonus` of 5 and
      says it was capped.
- [x] With the margin bonus disabled, no `margin_bonus` row is ever written.
- [x] Running the award step twice for the same match leaves the ledger unchanged.
- [x] Editing a game's `pointsPerWin` after a match was created does not change
      that match's award.
- [x] Awarding reads the rules from `matches`, and no code path reads `games`
      during awarding.
- [x] An admin cancelling a completed match writes negative `match_reversal`
      events that bring the affected players' totals back to their prior value.
- [x] The leaderboard includes players with zero points.
- [x] Ranking applies points desc → wins desc → matches asc → name asc.
- [x] Tied players show the same rank number.
- [x] The player's own row is always visible without scrolling.
- [x] Every point event renders its `detail` string in the player's history.
- [x] Unit tests cover: base award, team award, bonus, capped bonus, disabled
      bonus, idempotency, and reversal.

## Out of scope

- Elo or any rating that depends on the opponent's strength.
- Points for participation, for losing, or for streaks.
- Per-game sub-leaderboards. (Noted as a likely next request.)
- Seasons, resets, or archiving the leaderboard.
- Decimal points.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
| 2026-09-14 | Margin bonus made a per-game, admin-enabled option and itemised as its own ledger event | Human decision: the bonus must be visible line-by-line in the score history |
