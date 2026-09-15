# 0002 — An append-only point ledger instead of a points column

- **Date**: 2026-09-14
- **Status**: accepted

## Context

The leaderboard is the social engine of the weekend, and it will be argued
about. Three requirements landed on it at once:

1. the margin bonus must be itemised in the score history, separately from the
   base win, with its arithmetic visible;
2. admins must be able to award points for games that were never modelled;
3. an admin must be able to cancel a completed match that was entered wrongly.

A `users.points` integer satisfies none of them without a second table anyway.

## Decision

No mutable total anywhere. Every point is an immutable row in `point_events`
(`match_win`, `margin_bonus`, `admin_adjustment`, `match_reversal`), and every
total the app displays is a `SUM` over that table. Corrections are new rows;
nothing is ever edited or deleted.

## Why

- **Every total is explicable.** A player's profile lists the rows and their
  sum, so "why do I have 23 and not 10?" is answered by the screen rather than
  by an argument.
- **Idempotent awarding is a database guarantee.** The unique index on
  `(match_id, user_id, type)` makes a double award a no-op, instead of trusting
  every caller to check first.
- **Admin actions cannot be quiet.** An adjustment is a row in the same public
  list as everything else, attributed to the admin, with a mandatory reason.
- **Cancelling a completed match is arithmetic, not surgery.** Compensating
  negative rows bring the totals back and leave the original award visible.

## Consequences

- The leaderboard is a grouped query on every read; there is no cached total.
  At this scale that is cheaper than the risk of a stale cache showing someone
  the wrong score.
- `point_events` only grows. For a weekend that is a few hundred rows.
- Code outside `src/lib/domain/scoring.ts` must never invent a point value, and
  the reviewer checks for it. This is stated as a binding rule in `AGENTS.md`.
