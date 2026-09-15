# 0004 — Match lifecycle

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0002, 0003, 0006 |
| **Ready for code** | yes |

## Intent

The whole point of the app: two players (or two teams) decide to play, the app
records it, and the result cannot be quietly falsified by the winner. Everything
happens between people standing next to each other, so the flow must survive
interruptions — a phone locking, someone walking away, a match abandoned
halfway.

## States

```
                   all invitations accepted
   pending ─────────────────────────────────▶ active
     │                                          │
     │ any decline / 5 min elapse / cancel      │ a participant reports
     ▼                                          ▼
 cancelled ◀──── cancel ──────────────  awaiting_validation
 (or expired)                                   │
                                   validate ────┼──── dispute
                                        │       │        │
                                        ▼       │        ▼
                                   completed    │    disputed
                                  (points)      │        │
                                                │   admin resolves
                                                │        │
                                                └────────┴─▶ completed | cancelled
```

Terminal states: `completed`, `cancelled`, `expired`.

## Behaviour

### Creating a match

1. Any authenticated player who is not **busy** creates a match by choosing an
   active game, then filling every side with players.
2. The creator is always a participant, on side 1, and is automatically
   accepted.
3. The creator picks the other participants from the roster. Players who are
   busy are shown as unavailable and cannot be selected.
4. For a team game, the creator assigns each participant to a side. The match
   cannot be created until every side has exactly `playersPerSide` players.
5. On creation the match is `pending`, and each non-creator participant has a
   `pending` invitation. Each of them is notified (0006).
6. The invitation deadline is **5 minutes after creation**, stored on the match.
   It is the same deadline for everyone, not per invitation.

### Busy — the one-match-at-a-time rule

7. A player is **busy** when they participate in a match whose status is
   `active`, `awaiting_validation` or `disputed`, **or** when their invitation
   is `accepted` in a `pending` match.
8. A busy player cannot create a match, cannot be invited, and cannot accept an
   invitation. They may still decline one.
9. A player with several invitations open may therefore accept only the first;
   accepting one leaves the others, which they should decline — the app does
   not decline them automatically, because the other matches may still be
   re-formed with a different player.

### Responding to invitations

10. An invited player accepts or declines from the match screen. The screen
    shows a live countdown to the deadline.
11. When the last pending invitation is accepted, the match becomes `active`
    and everyone is notified that it has started.
12. If any invited player declines, the match becomes `cancelled` immediately.
    One refusal is enough — there is no partial re-forming.
13. When the deadline passes with at least one invitation still pending, the
    match becomes `expired`. Expiry is evaluated both by a background sweep
    every minute and lazily whenever the match is read, so a stale `pending`
    match is never shown as joinable.

### Reporting the result

14. Any participant of an `active` match reports the result: the winning side,
    and — if the game requires scores — one score per side.
15. The reporter is expected to be on the winning side, and the form defaults to
    that, but a player on a losing side may also report. What matters is who
    validates (rule 18), not who reports.
16. Scores, when required, must be integers ≥ 0, and the winning side's score
    must be strictly greater than every other side's. The app rejects a report
    that contradicts itself.
17. Reporting moves the match to `awaiting_validation` and notifies the other
    sides.

### Validating the result

18. Validation is owed by **every side other than the reporter's**: one player
    per side is enough. A side validates once, by any of its members.
19. When the last owed side validates, the match becomes `completed`, points are
    awarded (0005), and everyone is notified.
20. Any player who owes validation may instead **dispute** it, with an optional
    reason. The match becomes `disputed`, no points are awarded, and the admins
    are notified.
21. A disputed match is resolved only by an admin (0008), who either completes
    it with a winning side and scores they set, or cancels it.
22. There is no deadline on validation. An unvalidated match stays
    `awaiting_validation` until someone acts, and shows as pending on both
    players' screens. Deliberate: an automatic validation would let a cheater
    win by waiting.

### Cancelling

23. Any participant cancels a `pending` or `active` match. It becomes
    `cancelled`, nobody scores, and everyone is notified.
24. From `awaiting_validation` onwards, only an admin can cancel — otherwise a
    losing player could cancel instead of validating.
25. A `completed` match can be cancelled only by an admin, which reverses its
    points by writing compensating ledger rows (0005). It is never deleted.

## Data model

```
matches
  id                      text primary key
  game_id                 text not null references games(id)
  created_by              text not null references users(id)
  status                  text not null   -- pending|active|awaiting_validation
                                          -- |disputed|completed|cancelled|expired
  invitation_expires_at   integer not null
  -- scoring rules snapshotted at creation, never read live from games (0005)
  rule_points_per_win        integer not null
  rule_margin_bonus_per_point integer not null
  rule_margin_bonus_cap      integer
  rule_requires_score        integer not null
  winning_side            integer          -- set on report / admin resolution
  reported_by             text references users(id)
  reported_at             integer
  settled_at              integer
  cancelled_by            text references users(id)
  cancel_reason           text
  dispute_reason          text
  created_at              integer not null
  updated_at              integer not null

match_sides
  match_id   text not null references matches(id)
  side_index integer not null   -- 1..sidesCount
  label      text not null      -- 'Équipe 1' or the single player's name
  score      integer            -- null until reported
  validated_at integer          -- null until this side validates
  validated_by text references users(id)
  primary key (match_id, side_index)

match_participants
  match_id          text not null references matches(id)
  user_id           text not null references users(id)
  side_index        integer not null
  invitation_status text not null   -- 'pending' | 'accepted' | 'declined'
  responded_at      integer
  primary key (match_id, user_id)
```

A partial index enforces the busy rule cheaply: participants of non-terminal
matches are queried by `user_id`.

## Authorisation

| Operation | Who |
|---|---|
| Create a match | any authenticated, non-busy player |
| Accept an invitation | the invited player, if not busy |
| Decline an invitation | the invited player |
| Report a result | any participant of an `active` match |
| Validate a result | a player of a side that owes validation |
| Dispute a result | a player of a side that owes validation |
| Cancel a `pending` / `active` match | any participant, or an admin |
| Cancel from `awaiting_validation` onwards | admin only |
| Resolve a dispute | admin only |
| View a match | any authenticated player — matches are public |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| Busy player creates a match | Reject | « Tu as déjà une partie en cours » |
| Inviting a busy player | Reject, and the player is shown unavailable | « X est déjà en partie » |
| Accepting after the deadline | Reject, match marked expired | « L'invitation a expiré » |
| Accepting while busy | Reject | « Termine ta partie en cours d'abord » |
| Two players accept the last invitation at once | The transition runs once; the second call is a no-op returning the current state | (none) |
| Two players report at once | The first wins; the second sees the reported result | « Le résultat vient d'être saisi » |
| Report with a losing score for the winning side | Reject | « Le score du gagnant doit être le plus élevé » |
| Report with a missing score when the game requires it | Reject | « Renseigne le score de chaque camp » |
| Validating a match one is not in | 403 | « Tu ne participes pas à cette partie » |
| Validating one's own report | Reject | « L'autre camp doit valider » |
| Validating twice for the same side | No-op | (none) |
| Team has the wrong number of players | Reject at creation | « Il manque des joueurs dans l'équipe X » |
| Same player on two sides | Reject | « Un joueur ne peut pas être dans deux camps » |

## Acceptance criteria

- [x] A non-busy player can create a duel and a team match; the creator is on
      side 1 and pre-accepted.
- [x] Busy players are not selectable as opponents, and inviting one by a direct
      action call is rejected.
- [x] A created match is `pending` with `invitation_expires_at` exactly 5 minutes
      after `created_at`.
- [x] Every non-creator participant receives an invitation notification (0006).
- [x] Accepting the last pending invitation moves the match to `active` and sets
      no points.
- [x] A single decline moves the match to `cancelled`.
- [x] A `pending` match read after its deadline reports `expired`, without
      waiting for the sweep.
- [x] The background sweep marks overdue `pending` matches `expired`.
- [x] An accepted player is busy; they cannot create or accept another match.
- [x] A player whose match is `completed` is no longer busy.
- [x] Reporting on an `active` match sets `awaiting_validation`, the winning
      side and the scores, and awards no points yet.
- [x] A report whose winning side does not have the strictly highest score is rejected.
- [x] A report missing a score for a game with `requiresScore` is rejected.
- [x] The reporter's own side cannot validate; only the other sides can.
- [x] In a 2-side match, one validation completes the match and awards points.
- [x] In a 3-side match, every non-reporting side must validate before completion.
- [x] A dispute sets `disputed`, awards no points, and notifies the admins.
- [x] A participant can cancel a `pending` or `active` match; nobody scores.
- [x] A participant cannot cancel from `awaiting_validation`; an admin can.
- [x] Every status transition in the diagram is implemented in
      `src/lib/domain/match-state.ts`, and no other module writes `matches.status`.
- [x] A transition attempted from a state that does not allow it is rejected
      with the current state in the error, and nothing is written.
- [x] Unit tests cover every legal transition and at least one illegal one per state.

## End-to-end coverage

`e2e/match-lifecycle.spec.ts` `@spec-0004`
- Two real browsers: invite, accept, report 13–2, validate, points awarded.
- One refusal cancels the match and nobody scores.
- A busy player cannot be invited, and cannot start a second match.
- A report whose winner does not have the highest score is refused.
- An invitation past its deadline can no longer be accepted.

## Out of scope

- Draws and ties (a game with no winner is cancelled).
- Re-forming an expired or declined match with a substitute player — create a
  new match.
- Asymmetric sides, handicaps, tournaments, brackets.
- Editing a completed match's score. An admin cancels it and a new match is
  created.
- Spectator or referee roles.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
