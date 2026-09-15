# 0007 — Profiles and history

| | |
|---|---|
| **Status** | implemented |
| **Owner** | spec agent |
| **Depends on** | 0004, 0005 |
| **Ready for code** | yes |

## Intent

The leaderboard says who is winning; the history says why. People will argue
about results all weekend, and the app settles the argument by showing exactly
which matches happened, who was in them, what the scores were, and how each
point was earned.

## Behaviour

### Global history

0. The history screen has two views, switched in place: **Parties** (this
   spec) and **Journal des admins** (spec 0008, rules 15-21). Both are
   public. The admin log sits here rather than in the admin console because
   it is written for the players whose scores moved, not for the admins.
1. A history screen lists every match that has reached a terminal state
   (`completed`, `cancelled`, `expired`), most recent first, paginated 20 at a
   time.
2. Matches in progress are listed separately, above the history, so a player can
   see what is happening right now at the party.
3. Each history row shows: the game's icon and name, the sides with their
   players, the score if any, the winner, and a relative timestamp
   ("il y a 12 min").
4. Cancelled and expired matches are shown, visibly greyed, with the reason.
   Hiding them would let a player quietly retry a match until they win one.
5. The history can be filtered by game and by player.

### Match detail

6. A match screen shows its full timeline: created, each invitation response,
   started, reported, validated or disputed, resolved — each with its actor and
   timestamp.
7. It shows the points awarded, itemised per player: base win and margin bonus
   as separate lines with their arithmetic (0005 rule 12).
8. It shows the scoring rules the match was created with, so a player comparing
   two matches of the same game sees why the awards differ.

### Player profile

9. A profile screen is reachable from any occurrence of a player's name.
10. It shows: avatar, name, role, rank, total points, matches played, wins,
    losses, win rate, and current status (busy or available).
11. It shows a per-game breakdown: matches played and won per game.
12. It shows the player's full point ledger, most recent first: every event with
    its date, type, detail string and value, including admin adjustments and
    reversals. The sum of the column equals the total shown at the top, and that
    is verifiable by eye — which is the point.
13. It shows the player's match history, filtered to them.
14. Every player's profile is visible to every authenticated player. There is
    nothing private in it.

## Data model

No new tables. Everything is a read over `matches`, `match_sides`,
`match_participants` and `point_events`.

The match timeline is derived from the timestamp columns already on those
tables rather than from a separate event log: the states are few and their
order is fixed, so a dedicated audit table would add writes without adding
information.

## Authorisation

| Operation | Who |
|---|---|
| View the global history | any authenticated player |
| View any match's detail | any authenticated player |
| View any player's profile and ledger | any authenticated player |

## Failure cases

| Case | Behaviour | User-facing message (French) |
|---|---|---|
| No matches yet | Designed empty state with a link to start one | « Aucune partie pour le moment. Lance la première ! » |
| Player has no matches | Empty state on the profile | « X n'a pas encore joué » |
| Unknown match id | 404 page | « Cette partie n'existe plus » |
| Unknown player id | 404 page | « Joueur inconnu » |
| Player removed from the seed | Profile still renders from the database row | (none) |

## Acceptance criteria

- [x] The history lists terminal matches most recent first, 20 per page.
- [x] Matches in progress are listed above the history, not mixed into it.
- [x] Cancelled and expired matches appear, greyed, with their reason.
- [x] The history filters by game and by player.
- [x] A match screen shows every timeline step with actor and timestamp.
- [x] A match screen itemises base points and margin bonus as separate lines
      with their arithmetic.
- [x] A match screen shows the snapshotted scoring rules.
- [x] A profile shows rank, points, played, won, lost and win rate.
- [x] A profile shows the per-game breakdown.
- [x] A profile lists every point event, and the column sums to the displayed total.
- [x] Admin adjustments and reversals are visible in the ledger, labelled as such.
- [x] Every player name in the app links to that player's profile.
- [x] Every list has a designed empty state.
- [x] The history screen offers the Parties / Journal des admins switch, and
      both views are reachable by a `user` role.

## Out of scope

- Charts, graphs, or progression over time.
- Head-to-head records between two specific players. (Noted: likely next request.)
- Exporting or sharing a profile.
- Photos or comments attached to a match.

## Open questions

None.

## Changelog

| Date | Change | Why |
|---|---|---|
| 2026-09-14 | Created | Initial harness and application bootstrap |
| 2026-09-14 | History gains a second, public view: the admin log | Human requirement on transparency; the log belongs with the history a player reads, not in the admin console |
