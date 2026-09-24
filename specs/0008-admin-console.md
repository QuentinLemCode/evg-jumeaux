# 0008 — Admin console

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0002, 0003, 0004, 0005 |
| **Ready for code** | yes |

## Intent

Things will go wrong in the real world: a match entered against the wrong
person, a phone that died mid-report, a genuine disagreement about who won. An
admin needs to fix those without a developer and without touching the database —
and every fix must be visible, because a silent admin fix is
indistinguishable from cheating.

## Behaviour

### Games

1. Admins create, edit and archive games as specified in 0003.

### Disputes

2. A dashboard lists every `disputed` match, most recent first, with the
   reported result and the dispute reason.
3. An admin resolves a dispute in one of two ways:
   - **Settle it**: choose the winning side, the scores, and state a reason
     of at least 5 characters. The match becomes `completed` and points are
     awarded from the match's snapshotted rules. The reason is recorded on the
     match and shown in the public log — an arbitration nobody can explain is
     indistinguishable from favouritism.
   - **Cancel it**: the match becomes `cancelled` and nobody scores.
4. Both outcomes notify every participant (0006).
5. The resolution records which admin decided it and when.

### Matches

6. An admin can cancel any non-terminal match, at any state, with a reason.
7. An admin can cancel a `completed` match. Doing so writes compensating
   `match_reversal` point events (0005 rule 2) rather than deleting anything,
   and requires a typed confirmation because it changes the leaderboard.
8. An admin cannot edit a completed match's score. The path is: cancel it, then
   the players create a new match. This keeps the ledger append-only and keeps
   every total explicable.
9. An admin can force-expire a stuck `pending` match.

### Manual adjustments

10. An admin can grant or remove points from a player directly, with a mandatory
    reason. This covers the games that will be invented at 2am and never modelled
    in the app.
11. An adjustment is a normal `admin_adjustment` point event: signed, immutable,
    attributed to the admin, and visible in the player's public ledger (0007).
    There is no hidden adjustment.
12. An adjustment must be between −1000 and +1000 points, and the reason must be
    at least 5 characters. A blank reason is the main way a well-meaning admin
    creates an unexplainable leaderboard.

### Visibility — the admin log

13. Admin actions are never silent. Every one of them either notifies the
    affected players or appears in a public ledger, and usually both.
14. The admin console is reachable only from an admin's navigation, and every
    one of its actions re-checks the role server-side.
15. Every admin intervention that touches points or a match's outcome also
    appears on a dedicated **admin log** screen, at `/admin-log`.
16. **The admin log is public.** Every authenticated player can read it — not
    only admins. This is the whole point: a fix nobody can see is
    indistinguishable from cheating, and the people whose scores moved are
    exactly the people who must be able to check.
17. It is reached from the history screen, which offers two views —
    *Parties* and *Journal des admins* — rather than from a sixth navigation
    destination.
18. It lists, newest first, one entry per intervention:
    - the **type**: points adjusted, match cancelled, dispute settled,
      invitation force-expired;
    - the **admin** who did it and **when**;
    - the **subject**: the player, or the game and its sides;
    - the **reason**, in full and never folded behind a "show more".
      Adjustments, cancellations and arbitrations always record one; a
      force-expiry has none, and the entry states the derived fact instead;
    - the **point delta** it caused, signed, or `0` when it moved no points.
19. It can be filtered by type. The unfiltered view is the whole log; no type
    is hidden by default.
20. An intervention that concerns a match links to that match.
21. Entries are derived from what is already recorded — `point_events` rows
    of type `admin_adjustment` or `match_reversal`, and matches whose
    `settled_by` or `cancelled_by` is set. There is no separate audit table,
    so the log cannot drift from the facts it reports.

## Data model

No new tables. The admin log is a read over `point_events` and `matches`
(rule 21). Deriving it rather than writing a parallel audit trail is
deliberate: two records of the same event eventually disagree, and the one
people must be able to trust is the one the points actually come from.

- Dispute resolution writes `matches.winning_side`, `matches.settled_at`,
  `matches.settled_by`, the side scores, and a resolution note.
- Adjustments and reversals are `point_events` rows with `created_by` set to
  the admin's id.

## Authorisation

| Operation | Who |
|---|---|
| Read the admin log (`/admin-log`) | **any authenticated player** |
| Open the admin console | admin |
| Create / edit / archive a game | admin |
| Resolve a dispute | admin |
| Cancel any match | admin |
| Cancel a completed match (with reversal) | admin |
| Force-expire a pending match | admin |
| Adjust a player's points | admin |
| Everything above, called directly without the UI | admin only — 403 otherwise |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Non-admin opens `/admin` | Redirect to the leaderboard | « Réservé aux admins » |
| Non-admin calls an admin action directly | 403, nothing written | « Réservé aux admins » |
| Resolving an already-resolved dispute | Reject, show the current state | « Cette partie a déjà été tranchée » |
| Settling with an inconsistent score | Reject, same rule as a player report | « Le score du gagnant doit être le plus élevé » |
| Cancelling a completed match without typing the confirmation | Nothing happens | « Tape ANNULER pour confirmer » |
| Adjustment with a blank or 4-character reason | Reject | « Explique pourquoi (5 caractères minimum) » |
| Adjustment of 0 points | Reject | « Indique un nombre de points non nul » |
| Adjustment beyond ±1000 | Reject | « Maximum 1000 points » |
| The last admin is removed from the seed | Seeding fails (0002 rule 7) | (server log only) |

## Acceptance criteria

- [x] `/admin` is reachable by an admin and redirects everyone else.
- [x] Every admin Server Action calls `requireAdmin()` and returns an
      authorisation error for a `user` role, independently of the UI.
- [x] The dispute dashboard lists every `disputed` match with its reason.
- [x] Settling a dispute completes the match and awards points from the
      match's snapshot, not from the game's current rules.
- [x] Cancelling a dispute completes nothing and awards nothing.
- [x] Resolving a dispute notifies every participant.
- [x] The resolving admin's id and the resolution time are recorded.
- [x] An admin can cancel a match in any non-terminal state.
- [x] Cancelling a completed match writes negative `match_reversal` events that
      exactly offset that match's awards.
- [x] Cancelling a completed match without the typed confirmation writes nothing.
- [x] There is no code path that edits or deletes an existing `point_events` row.
- [x] An adjustment requires a reason of at least 5 characters and a non-zero
      value within ±1000.
- [x] An adjustment appears in the target player's public ledger, attributed to
      the admin.
- [x] Force-expiring a pending match moves it to `expired` and notifies participants.
- [x] Unit tests cover reversal arithmetic and adjustment validation.
- [x] `/admin-log` is reachable by a `user` role, not only by an admin.
- [x] The history screen offers both views and links to the log.
- [x] Each log entry shows type, admin, timestamp, subject, full reason and
      signed point delta.
- [x] A reason is never truncated or hidden behind a disclosure control.
- [x] An adjustment of +25 to a player appears with `+25` and its reason.
- [x] Cancelling a completed match appears with the negative delta it caused.
- [x] Settling a dispute appears with the points it awarded.
- [x] Force-expiring an invitation appears with a delta of `0`, attributed to
      the admin who did it.
- [x] Settling a dispute without a reason of at least 5 characters is rejected.
- [x] The background sweep expiring an invitation on schedule produces no log
      entry and is attributed to nobody.
- [x] Filtering by type narrows the list; the default shows every type.
- [x] An entry that concerns a match links to that match.
- [x] The log is derived from `point_events` and `matches`; no audit table exists.
- [x] The screen follows spec 0010 §8 (the standard screen anatomy).

## End-to-end coverage

`e2e/admin.spec.ts` `@spec-0008`, `e2e/admin-log.spec.ts` `@spec-0008`
- An adjustment needs a reason of at least 5 characters, and that reason appears in the target's public profile.
- A disputed result awards nothing until an admin decides, and the decision needs a stated reason.
- A plain player reads the admin log, sees the author, the reason in full and the signed delta, and can filter by type.

## Out of scope

- Editing the roster, names, avatars or PINs from the app (0002 is deliberate).
- Impersonating a player.
- Bulk operations, CSV import/export.
- Logging admin actions that move no points and change no outcome (creating
  or editing a game). The log is about points and results, not configuration.
- Resetting the leaderboard.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
| 2026-09-14 | Added the public admin log (rules 15-21); removed "an admin audit log screen" from Out of scope | Human requirement: full transparency on admin score changes, readable by everyone and not only by admins |
| 2026-09-23 | Rules 18 and 21: team moves are a fifth kind of intervention, derived from `team_moves` (spec 0017) | An admin moving a player writes no point event and touches no match, so the log could not otherwise see it |
| 2026-09-24 | Reverted: an admin cannot move a player between teams at all (spec 0017) | A team choice is final for everyone, admins included — so there is no intervention left for the log to carry |
