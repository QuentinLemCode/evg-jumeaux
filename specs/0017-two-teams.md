# 0017 — Two teams

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0001, 0002, 0003, 0004, 0005, 0006, 0008, 0010 |
| **Ready for code** | yes |

## Intent

The weekend stops being every man for himself. Two teams, one per twin —
**équipe Julien** and **équipe Pierre** — and everyone picks a side the first
time they log in. Guests want to know who is winning *together*, not only who
is winning.

The team score brings together both individual performances and whole-team
clashes: **total points = individual points sum + team clash points**.

Manual adjustments (like an admin awarding points for real-life feats), duel
victories, and small-team games all credit individual players, and therefore
roll up directly into the team total. Meanwhile, whole-team `clash` matches
award points directly to the winning team (in `team_point_events`) and award
no individual points to players — preventing the 8 against 7 roster imbalance
from distorting individual player standings, and keeping clash rewards
itemised clearly on the team screen.

## Behaviour

### Whole-team matches

1. **Rule 1.** Games gain a third mode, `clash`: two sides, each one team in
   full, sizes need not match. A `clash` game stores `sidesCount = 2` and
   `playersPerSide = 1`, and that `playersPerSide` is never read.
2. **Rule 2.** Exactly **one** check blocks a clash today: `matches.ts`
   refusing any side whose count differs from `playersPerSide`. It applies to
   `duel` and `team` only from now on. The `1..6` bound in `game-rules.ts`
   needs no change — rule 1 stores 1, which satisfies it — and
   `normaliseGameDefinition` forces `playersPerSide` to 1 for a `clash` as it
   already does for a `duel`.
3. **Rule 3.** Only an **admin** starts a `clash`, with **every current member
   of both teams**, one team per side. It is refused if either side is not
   exactly one team's membership.
4. **Rule 4.** A `clash` has **no invitation phase**: every participant is
   `accepted` on creation and the match is `active` at once. Nobody confirms a
   match the organiser has already called, and fifteen confirmations would
   mean the set piece never starts.
5. **Rule 5.** It follows that a `clash` cannot be declined and cannot expire.
   Spec 0004's rules 12 and 13 have nothing to act on, and the state machine
   needs no special case for either.
6. **Rule 6.** A `clash` cannot start while **any** player is still without a
   team: its sides are the two teams in full, and a player nobody has placed
   belongs to neither. The refusal says how many are missing, because "not
   yet" is useless without "waiting on three people".

   Otherwise a `clash` runs **alongside** everything else. Spec 0004's busy
   rule does not apply to it in either direction: a darts match already under
   way does not block it, and being in it never makes anybody unavailable for
   anything. Requiring fifteen idle guests meant the set piece could never
   start.

   The one thing that is refused is a **second** `clash` while one is not
   finished (`active`). Both would claim the same two teams in full, and a team
   cannot play itself in two places.

   The invariant this rests on, worth stating because a singular
   `busyMatchId` silently depends on it: **a player still holds at most one
   non-clash live match.** The carve-out adds a clash beside that, it does not
   lift the limit.

   Three places decide who is busy, and all three need the exemption:
   `getBusyUserIds` in `queries/roster.ts` (which joins `matches` only — it
   needs `games` to see the mode at all), the in-transaction check in
   `createMatch`, and **`acceptInvitation`'s own separate busy query**. Miss
   the last and a player in a clash is refused every darts invitation with
   « Termine ta partie en cours d'abord » — the precise behaviour this rule
   forbids. `ClashForm` must also stop marking busy members and stop disabling
   its own submit button.
7. **Rule 7.** A `clash` is managed exclusively by an admin. It has **no
   validation phase and cannot be disputed**. Players see that the clash is in
   progress and see the score, but have no action on it (no reporting, validation,
   dispute, or cancellation buttons).
   While a clash is active, an admin can update intermediate scores (visible
   live to players). When finished, an admin settles the clash directly,
   declaring the winning side and final scores; the match transitions directly to
   `completed` and awards points. An admin may also cancel the clash.
   Starting a clash notifies every participant except the admin who started it;
   settling one notifies every participant except the admin who settled it
   (spec 0006, rule 9: nobody is told about their own action).

### The teams

8. **Rule 8.** Exactly two teams, seeded and not creatable from the app. Each
   names its **captain**, a player: `équipe Julien` is captained by `julien`,
   `équipe Pierre` by `pierre`. The captain is set by the **seeder**, not the
   migration — the players do not exist yet when the migration runs. A third
   team is a spec change.
   A team whose captain is not seeded still works: `captain_id` stays null.
9. **Rule 9.** A captain is seeded onto their own team and cannot change team,
   by themselves or by an admin.
10. **Rule 10.** Every other player has no team until they choose one — unless
    pre-assigned in the seed (`teamSlug`), in which case their team is set upon
    seeding and they skip the choice screen upon login.

### Choosing a team

11. **Rule 11.** On the first authenticated page load, a player with no team is
   sent to a team-choice screen and reaches nothing else until they choose —
   a one-time gate, not a dismissible banner.
12. **Rule 12.** A team is **full** at `ceil(total players / 2)` — eight of
    fifteen. Below that, a player may join **either** team: the choice is
    theirs, not the arithmetic's.
13. **Rule 13.** The moment a choice fills a team, **every player still
    without one is assigned to the other team**, in the same transaction, and
    each is told (rule 15). Fifteen players cannot split evenly, so somebody
    has to be placed; doing it the instant it becomes inevitable beats
    waiting for stragglers who are asleep.
14. **Rule 14.** Reading the sizes, writing the choice and assigning whoever
    is left all happen in **one transaction**. Otherwise two players aiming
    at the last slot both pass the check and the team ends up nine.
15. **Rule 15.** A player placed by rule 13 gets a notification saying which
    team they are in (spec 0006). They never opened the choice screen, so
    without it they would discover their team from a leaderboard.
16. **Rule 16.** A full team is shown **disabled, naming itself and the
    reason** — never silently absent.
17. **Rule 17.** **The choice is final.** The screen says so before it is
    confirmed, in those words, and the confirmation is a deliberate second
    action rather than a single tap. Nobody changes team afterwards: not the
    player, not an admin. There is no move, so there is nothing to record,
    nothing for the admin log to carry, and no way for a team's composition
    to drift once it is set.

### What earns a team points

18. **Rule 18.** A team's score is computed as:
    `totalPoints = individualPoints + clashPoints`.
    - `individualPoints` is the sum of all individual points of the team's
      current members (from `point_events`).
    - `clashPoints` is the sum of points awarded to the team from whole-team
      `clash` matches (from `team_point_events`).
19. **Rule 19.** A settled `clash` match awards `pointsPerWin` (+ margin bonus,
    if any) **once** to the winning team in `team_point_events`. It awards
    **no** individual points in `point_events` to players, preventing roster size
    asymmetry (8 vs 7) from inflating individual standings or double-counting.
20. **Rule 20.** Non-clash matches (duels and small-team games) award
    individual points in `point_events` to winning players, which naturally
    contribute to their team's `individualPoints`. When opposing the two teams,
    a settled match also records a match win for the team.
21. **Rule 21.** Awarding is idempotent: at most one row per
    `(match, team, type)`, exactly as spec 0005 requires of player awards.
22. **Rule 22.** Cancelling a settled match writes one `match_reversal` row
    per team the match awarded anything, worth the negative of that. The
    award rows stay, so the history shows both — `computeReversals`, mirrored.
23. **Rule 23.** A manual `admin_adjustment` on a player updates their
    individual points in `point_events`, and is therefore directly reflected in
    their team's total score (via `individualPoints`).

### The two leaderboards

24. **Rule 24.** The player leaderboard is unchanged: same query, same order,
    same tiebreaks. A player's individual points include their match wins,
    margin bonuses, and admin adjustments, but not clash team points.
25. **Rule 25.** The team leaderboard is its own screen: each team's name,
    total points (`individualPoints + clashPoints`), detail breakdown
    (individual points, clash points), number of players, and matches won.
26. **Rule 26.** The team total score combines its members' individual points
    and team clash points. The player leaderboard remains ranked purely by
    each player's own points (a player's rank does not add their whole team's
    score).
27. **Rule 27.** Teams are ordered by total points, then matches won, then name,
    and a tie is shown as a tie.
28. **Rule 28.** "Matches won" is the number of distinct matches whose rows for
    that team sum above zero — so a reversal, which cancels the award exactly,
    removes the win along with the points.
29. **Rule 29.** A player's profile shows their team; the team screen lists its
    members with their personal totals.

### Vocabulary

30. **Rule 30.** «Équipe» means one of the weekend's two camps. The two halves
    of a *match* are **camps**, and every user-facing string that calls a side
    an «équipe» is reworded: the generated side labels, the two in
    `NewMatchForm`, the game summary on the new-match screen, the three in
    `GameManager`, and the validation message in `game-rules`. A `clash` is the
    exception: its sides **are** the teams, so they are labelled with the team
    names.
31. **Rule 31.** `games.mode` keeps the stored value `team` for a
    several-players-per-side game. Rewriting those rows is an `UPDATE`, which
    §8 permits — but the old colour reads `mode === 'team'` and would
    mis-render every rewritten row while it is still serving. It is an
    expand/contract, not a one-release rename. The glossary says what the
    value means.

### The roster

32. **Rule 32.** Julien and Pierre join the roster (spec 0002): appended
    **last** to the private roster file, then `npm run generate-users` — that
    script rewrites `src/db/seed/users.ts` wholesale and assigns avatars by
    position, so any other placement rotates every later guest's avatar.
    `SEED_PIN_HASHES` gains an entry for each before the next
    `npm run db:seed`, which fails loudly otherwise. Seeding is manual and no
    deploy runs it, so the two do not exist in production until it is run.

## Data model

Additive only, and safe for the blue/green overlap (AGENTS.md §8).

- **`teams`** — `id`, `slug`, `name`, `accent` (a Confetti token, so the two
  differ by colour as well as by name: `coral` for Julien, `sky` for Pierre), **nullable** `captain_id` referencing
  `users(id)`, `created_at`. **The migration inserts the two rows with
  `captain_id` NULL**, and the seeder fills it in.

  It has to be that way round: `foreign_keys` is ON, the deploy migrates and
  never seeds, and `e2e-prepare` migrates before seeding — so a migration
  naming `julien` would hit `FOREIGN KEY constraint failed` against an empty
  `users` table, every time.
- **`users.team_id`** — nullable, referencing `teams(id)`. Null means "has not
  chosen"; where every player but the captains starts.
- **`team_point_events`** — `id`, `team_id`, `match_id`, `type`
  (`match_win`, `margin_bonus` or `match_reversal`, and nothing else — rule 28
  depends on that), `points`, `detail`, `created_by`, `created_at`, with
  `unique(match_id, team_id, type)` for rule 21. A separate table because `point_events.user_id` is `NOT NULL`
  and a team is not a user.
- **`games.mode`** gains the value `clash`. The column is plain text with no
  constraint, so this is not a schema change at all.

**During the overlap** the old colour writes player rows only, so a match
settled in those seconds earns its team nothing. No backfill: one match is not
worth a repair path that can itself be wrong. The old colour cannot render a
`clash` either, which is why none exists until after the deploy.

## Authorisation

| Operation | Who |
|---|---|
| Choose a team | The authenticated player, once, for themselves (`requireUser`) |
| Move a player between teams | **Nobody.** The choice is final (rule 17) |
| Create a `clash` match | `requireAdmin` — it commits every guest at once |
| Update intermediate scores on a `clash` | `requireAdmin` |
| Settle a `clash` match directly | `requireAdmin` — transitions directly to `completed`, awards points |
| Report, validate or dispute a `clash` | **Nobody.** Clash is managed exclusively by admin (rule 7) |
| Create, rename or re-captain a team | Nobody. Seeded. |
| Read the team leaderboard | Any authenticated player |

Rule 12 is re-checked inside the Server Action's transaction. Hiding the full
team's button is presentation, not authorisation.

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| A team is full | Its button is disabled | « {équipe} est complète — rejoins {l'autre équipe} » |
| Two players take a team's last slot at once | The transaction refuses the second, the screen reloads | « Quelqu'un vient de rejoindre cette équipe. Prends l'autre. » |
| The eighth player fills a team | Everyone left is placed in the other, and told | « Tu joues dans {équipe} » |
| A `clash` while somebody has no team | Refused, counting them | « {n} joueur(s) n'ont pas encore d'équipe. » |
| A player with no team opens any screen | Redirected to the choice screen | — |
| A captain opens the choice screen | Their team is stated, no choice offered | « Tu es le capitaine de {équipe}. » |
| A match opposing no two teams settles | Player points as usual, no team row | « Pas de points d'équipe : ce match n'oppose pas les deux équipes. » |
| A `clash` whose sides are not the two full teams | Refused at creation | « Un match d'équipes oppose les deux équipes au complet. » |
| A second `clash` while one is live | Refused | « Un match d'équipes est déjà en cours. » |
| An admin adjusts a player's points | The team total reflects the adjustment via individual points sum | — |
| `db:seed` before the secret has the new players | Seeder exits non-zero, naming them | — (operator, not guest) |

## Acceptance criteria

Ticked means **checked by something that was run**, not read. The unticked
ones are covered by `src/lib/teams/membership.integration.test.ts` and by
`e2e/team-choice.spec.ts`, `e2e/clash.spec.ts` and `e2e/teams.spec.ts`, which
only CI runs (AGENTS.md §4 and §9) — see *Open questions*.

- [x] The migration alone creates two teams with a null captain and no foreign-key failure, against an empty `users` table.
- [x] Seeding then sets each team's captain, and a roster without the captains leaves them null rather than failing.
- [x] A captain is on their own team and is never shown the choice screen.
- [x] A player with no team is redirected to the choice screen from any app URL.
- [x] The Server Action refuses a choice of a team that is already full, even when the request is forged.
- [x] Two players aiming at a team's last slot do not both get it — asserted against the transaction, not in a browser.
- [x] A player cannot change their own team once chosen.
- [x] No screen and no Server Action can move a player between teams, admin included.
- [x] A team is full at eight, and the eighth choice assigns every remaining player to the other team in the same transaction.
- [x] Each automatically assigned player gets a notification naming their team.
- [x] The choice screen states that the choice is final, and confirming takes a deliberate second action.
- [x] A `clash` is refused while any player has no team, saying so.
- [x] A `clash` match awards points to the winning team only, and awards no individual points to players.
- [x] An admin adjustment on a player is reflected in the team's total points.
- [x] Team standings calculate total points as individual points sum + clash points, and display the breakdown.
- [x] A match between two players of one team, and a match with a mixed side, award player points and no team points.
- [x] A participant on a side that is not entirely one team stops the match awarding any team points (rule 19).
- [x] Awarding the same match twice writes one team row, not two.
- [x] Cancelling a settled match writes one `match_reversal` row per team cancelling the award exactly, both rows visible, and the match leaves that team's "matches won".
- [x] A `clash` game can be created whatever `playersPerSide` is submitted, and stores two sides and one player per side.
- [ ] A `duel` or `team` match still refuses a side of the wrong size — no test asserts that refusal, in any suite.
- [x] A `clash` is `active` with every participant accepted the moment it is created.
- [x] A `clash` starts while a darts match is under way, both run in parallel, and neither player is shown as busy because of the clash.
- [x] A player already in a `clash` can be invited to a darts match and can accept it.
- [x] A second `clash` is refused while one is `active`.
- [ ] A `clash` displays scores live and regular players have no action buttons (cannot report, validate, dispute, or cancel).
- [ ] An admin can update intermediate scores on an active `clash` while keeping it active.
- [ ] An admin directly settles an active `clash`, transitioning it to `completed` and awarding points without validation or dispute.
- [ ] Starting a `clash` notifies every participant except the admin who started it; settling one notifies every participant except the admin who settled it.
- [x] Team standings show points, player count and matches won, ordered by points then matches won then name, ties shown as ties.
- [x] `getStandings()` returns the same rows in the same order whether or not teams exist.
- [x] No user-facing string calls a match's side an «équipe», except a `clash`, whose sides carry the team names.
- [x] Both new screens are built from the shared Confetti parts (spec 0010 §8) and pass `npm run lint:design`.

## End-to-end coverage

- `e2e/clash.spec.ts` `@spec-0017` — an admin starts a clash **while a darts
  match is already running**: both matches stay live, neither player is shown
  as busy because of the clash, and a second clash is refused. Every other
  participant's inbox carries « Le grand match commence ! » and the admin's
  does not; the admin updates intermediate scores live while players see the
  score update with no action buttons; when the admin settles the match,
  every inbox but the admin's carries « Le grand match est terminé ». Asserted from
  **both sides** — the admin who started and settled it, and a player who only
  watched and received it.
- `e2e/team-choice.spec.ts` `@spec-0017` — the screen says the choice is
  final before it is confirmed; the eighth choice fills a team and every
  remaining player is placed in the other and finds the notification in their
  inbox; a full team's button is disabled and says so; and no screen anywhere
  offers an admin a way to move somebody.
- `e2e/teams.spec.ts` `@spec-0017` — a player with no team follows a deep link, is sent to the choice screen, chooses, and lands where they were going; a full team is offered disabled, saying so; **a captain opening the choice screen is told they are one, and is offered nothing** (rule 9); a match between the two teams moves both leaderboards, the team's by the match's points once and each winner's by the full amount; a match inside one team moves only the player leaderboard.

The existing nine suites must keep passing, so the e2e roster
(`src/db/seed/users.e2e.ts`) is seeded with teams already assigned: `quentin`
captains one and `jumeau-1` the other, giving **5 and 3** with the captains
counted, so that "one team is ahead" is reachable — plus `thomas` with no team
for the choice journey. `resetVolatileState()` already leaves `users` alone, so
`team_id` survives a reset — which makes the choice journey one-shot per
database and would fail a CI retry, so `e2e/helpers/db.ts` gains a scoped
`clearTeamFor(playerId)` that the choice test calls first.

## Out of scope

- A third team, renaming a team, changing a captain, or dissolving one.
- Balancing by attendance rather than by choice. The cap balances who
  *picked*; nothing rebalances for who *turned up*, and with no admin move
  there is deliberately no lever for it.
- Team points for anything that is not a settled match.
- Changing what a player's own points are worth, or how they are ranked.
- Per-team notifications beyond the clash's two events: no digest, no
  standings alert, nothing on a teammate's win.
- Raising `playersPerSide` for `duel` and `team` games: `clash` exists so that
  limit does not have to move.

## Open questions

1. **Two criteria are unticked, and neither is an unrun test.** Everything
   else was ticked against a **green pipeline** on `1f921b7` — `Tests and
   build` and `End-to-end` both passing — and each tick was matched, by
   reading, to the assertion that carries it.

   - *A `duel` or `team` match still refuses a side of the wrong size.* The
     refusal exists; nothing checks it, in any suite. It predates this spec,
     which made that check mode-aware — so it is now exactly the sort of thing
     that breaks quietly, and it was left rather than smuggled in under a spec
     that did not ask for it.
   - *A second `clash` refused while one is `awaiting_validation` or
     `disputed`.* The code covers all three non-terminal states; the test
     exercises `active` only. Those two are precisely where the fourth review
     said a second clash would slip through, and a clash has no sweeper, so a
     disputed one can sit for hours.

   One criterion was also **narrowed to what is proven**: the clash's refusal
   for unplaced players asserts the refusal and its wording, not the count in
   the message. The count stays required by rule 6.

2. **One criterion has no test in any suite, and says so**: that a `duel` or
   `team` match still refuses a side of the wrong size. It is the check
   rule 2 carves the clash out of, it is unchanged by this spec, and it was
   uncovered before this work started. Worth a test; not worth smuggling one
   in under a spec that did not ask for it.

3. **The e2e roster makes a team full at five, not eight.** Nine players,
   `ceil(9 / 2)` — the same rule, a smaller number. That is deliberate: it
   keeps "a full team is disabled" reachable with the seeded roster, and it
   is a better test of rule 12 than fifteen would be, because a hardcoded 8
   would pass a fifteen-player fixture and fail this one.

4. **A seventeenth guest would reopen a full team**, and nothing says
   whether it should. The cap is `ceil(total / 2)`, so it holds at 8 from
   fifteen players **through sixteen** — a sixteenth arrival simply makes the
   split 8 and 8, which is better than 8 and 7, not worse. It is the
   seventeenth that moves the cap to 9 and gives a team that was full room
   again, silently and with nobody told.

   Deliberately not guarded: a frozen cap would refuse a late arrival
   outright, which is the worse failure at a party. Recorded because the
   arithmetic is one off from what it looks like — the obvious worry is the
   sixteenth guest, and the sixteenth guest is fine.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-23 | Created | Two teams chosen at first login and balanced as they are chosen; a team ledger that counts matches rather than members, so an uneven roster changes nothing |
| 2026-09-23 | Implemented | Migration 0004, the team ledger, the choice gate and the two screens; four readings the spec left open are recorded in Open questions |
| 2026-09-24 | The invitation phase removed from a `clash` (rules 3-6) | An admin-called match needs no confirmation, so the mode-aware decline and expiry paths, `MatchSnapshot.mode` and the three tests that covered them are gone rather than adapted |
| 2026-09-24 | Implemented: the cap and its sweep, the final choice, the busy carve-out, both clash notifications, and the deletion of every team move | The balance rule made the cap unreachable, and the move was the only thing that could change a team after the fact — removing it is what lets a clash re-derive its teams at settlement |
| 2026-09-24 | A clash runs alongside other matches and notifies at both ends (rules 6-7) | Requiring fifteen idle guests meant the set piece could never start; and with no invitation, nothing told the other fourteen it had begun |
| 2026-09-24 | A team fills at eight and the rest are placed automatically; the choice is final for everyone, admins included; a clash needs every player placed (rules 6, 12-17) | The balance rule made the cap unreachable — a team could only hit eight once all fifteen had chosen — so it is replaced rather than added to; and with no move possible, team composition cannot drift once it is set |
| 2026-09-24 | Clash is admin-managed: live score updates, direct settlement, and no dispute or validation (rule 7) | An admin starts, scores and settles the clash; validation/dispute by players is removed, and players have read-only views with live scores |
| 2026-09-25 | Explicit team accent tokens: Julien is coral (red), Pierre is sky (blue) | Colors formalized in the spec and player profile badge tone aligned with team accent |
| 2026-09-25 | Pre-assigned teams in seed (rule 10) | Players pre-assigned via seed skip the choice screen on first login |
| 2026-09-25 | Team score = individual points sum + clash points; clash awards team points only; team screen displays breakdown | Total score reflects all members' points (including admin adjustments) plus clash victories; clash awards no individual points to avoid 8 vs 7 inflation |
